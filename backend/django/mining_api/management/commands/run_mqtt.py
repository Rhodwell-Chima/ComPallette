"""One supervised MQTT consumer/outbox process, never imported by web workers."""
import json
import os
import time
from django.core.management.base import BaseCommand, CommandError
from django.db import close_old_connections, connections, transaction
from django.utils import timezone
from django.db.models import F, Case, When, Value
from mining_api.ingestion import ingest
from mining_api.commands import command_frame
from mining_api.device_trust import accept_result
from mining_api.models import GatewayRegistration, DeviceCommand
from rest_framework.exceptions import APIException


@transaction.atomic
def persist_deliveries(messages):
    """Commit a bounded batch before returning any application/broker receipts."""
    outcomes = []
    for message in messages:
        try:
            parts = message.topic.split('/')
            gateway = GatewayRegistration.objects.select_related('site', 'node').get(
                node_id=parts[3], active=True, credentials_installed=True,
                site__organisation__active=True, site__active=True, node__archived=False)
            data = json.loads(message.payload)
            if message.retain or not isinstance(data, dict):
                raise ValueError('Retained or non-object event/result is forbidden.')
            result = accept_result(gateway, data) if parts[4] == 'results' else ingest(gateway, data)
            outcomes.append((message, parts[3], result, None))
        except (ValueError, GatewayRegistration.DoesNotExist, APIException) as error:
            outcomes.append((message, None, None, type(error).__name__))
    return outcomes


class Command(BaseCommand):
    help = 'Run the TLS MQTT ingestion and durable command outbox worker.'

    def handle(self, *args, **options):
        import paho.mqtt.client as mqtt
        # This single-threaded worker has no HTTP request lifecycle. Reusing its
        # connection avoids a PostgreSQL handshake for every received packet;
        # close_old_connections still recycles failed/expired connections.
        connections['default'].settings_dict['CONN_MAX_AGE'] = 60
        required = ['MQTT_HOST', 'MQTT_CA_FILE', 'MQTT_USERNAME', 'MQTT_PASSWORD_FILE']
        if any(not os.environ.get(k) for k in required):
            raise CommandError('Configure MQTT_HOST, MQTT_CA_FILE, MQTT_USERNAME and MQTT_PASSWORD_FILE.')
        with open(os.environ['MQTT_PASSWORD_FILE']) as secret:
            password = secret.read().strip()
        client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id='compallette-ingestion',
                             protocol=mqtt.MQTTv311, clean_session=False, manual_ack=True)
        client.username_pw_set(os.environ['MQTT_USERNAME'], password)
        client.tls_set(ca_certs=os.environ['MQTT_CA_FILE'])
        client.reconnect_delay_set(min_delay=1, max_delay=30)

        def connected(client, userdata, flags, reason_code, properties):
            if not reason_code.is_failure:
                client.subscribe([('compallette/v1/gateways/+/events', 1), ('compallette/v1/gateways/+/results', 1)])

        pending = []
        batch_started = None

        def received(client, userdata, message):
            nonlocal batch_started
            if not pending:
                batch_started = time.monotonic()
            pending.append(message)

        def flush_pending():
            nonlocal batch_started
            if not pending:
                return
            messages = pending[:]
            pending.clear()
            batch_started = None
            close_old_connections()
            try:
                outcomes = persist_deliveries(messages)
                # The outer batch transaction has committed. QoS acknowledgements
                # and persistence receipts are never emitted from inside it.
                for message, gateway_id, result, rejected in outcomes:
                    if rejected:
                        self.stderr.write(f'Rejected MQTT packet: {rejected}')
                    else:
                        client.publish(f'compallette/v1/gateways/{gateway_id}/receipts', json.dumps(result), qos=1, retain=False)
                    client.ack(message.mid, message.qos)
            except Exception as error:
                self.stderr.write(f'MQTT batch deferred: {type(error).__name__}')
                # All writes roll back and all messages remain unacknowledged.
                # The persistent broker session redelivers them on reconnect.
                client.disconnect()
            finally:
                close_old_connections()

        client.on_connect = connected
        client.on_message = received
        client.connect(os.environ['MQTT_HOST'], int(os.environ.get('MQTT_PORT', '8883')), 30)
        next_outbox_scan = 0
        try:
            while True:
                result = client.loop(timeout=0.01)
                if pending and (len(pending) >= 32 or time.monotonic() - batch_started >= 0.01):
                    flush_pending()
                if result != mqtt.MQTT_ERR_SUCCESS:
                    time.sleep(1)
                    try: client.reconnect()
                    except OSError: continue
                close_old_connections()
                if time.monotonic() < next_outbox_scan:
                    continue
                next_outbox_scan = time.monotonic() + 1
                now = timezone.now()
                DeviceCommand.objects.exclude(state__in=['DEVICE_CONFIRMED', 'REJECTED', 'EXPIRED']).filter(expires_at__lte=now).update(state='EXPIRED')
                if not client.is_connected(): continue
                for command in DeviceCommand.objects.filter(state__in=['QUEUED', 'SENT', 'GATEWAY_RECEIVED'], expires_at__gt=now, gateway__active=True, gateway__credentials_installed=True, gateway__site__active=True, gateway__site__organisation__active=True).select_related('node', 'gateway')[:100]:
                    if command.sent_at and (now-command.sent_at).total_seconds() < 5: continue
                    try:
                        frame = command_frame(command)
                    except APIException:
                        continue  # Remains queued until authenticated discovery or expiry.
                    published = client.publish(f'compallette/v1/gateways/{command.gateway.node_id}/commands',
                        json.dumps(frame), qos=1, retain=False)
                    if published.rc == mqtt.MQTT_ERR_SUCCESS:
                        DeviceCommand.objects.filter(pk=command.pk, state__in=['QUEUED', 'SENT', 'GATEWAY_RECEIVED']).update(
                            state=Case(When(state='QUEUED', then=Value('SENT')), default=F('state')), sent_at=now, attempts=F('attempts')+1)
        except KeyboardInterrupt:
            client.disconnect()
