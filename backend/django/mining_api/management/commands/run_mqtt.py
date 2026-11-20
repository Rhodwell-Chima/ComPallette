"""One supervised MQTT consumer/outbox process, never imported by web workers."""
import json
import os
import time
from django.core.management.base import BaseCommand, CommandError
from django.db import close_old_connections, transaction
from django.utils import timezone
from django.db.models import F
from mining_api.ingestion import ingest
from mining_api.commands import command_result, command_frame
from mining_api.models import GatewayRegistration, DeviceCommand
from rest_framework.exceptions import APIException


class Command(BaseCommand):
    help = 'Run the TLS MQTT ingestion and durable command outbox worker.'

    def handle(self, *args, **options):
        import paho.mqtt.client as mqtt
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

        def received(client, userdata, message):
            close_old_connections()
            try:
                parts = message.topic.split('/')
                gateway_id = parts[3]
                gateway = GatewayRegistration.objects.select_related('site', 'node').get(
                    node_id=gateway_id, active=True, site__active=True, node__archived=False)
                data = json.loads(message.payload)
                if message.retain:
                    raise ValueError('Retained event/result is forbidden.')
                if not isinstance(data, dict): raise ValueError('Payload must be an object.')
                result = command_result(gateway, data) if parts[4] == 'results' else ingest(gateway, data)
                client.publish(f'compallette/v1/gateways/{gateway_id}/receipts', json.dumps(result), qos=1, retain=False)
                client.ack(message.mid, message.qos)
            except (ValueError, GatewayRegistration.DoesNotExist, APIException) as exc:
                # Permanent rejections are acknowledged to the broker, but never reported
                # as persisted events to the gateway. Its local queue requires operator review.
                self.stderr.write(f'Rejected MQTT packet: {type(exc).__name__}')
                client.ack(message.mid, message.qos)
            except Exception as exc:
                # DB/network errors leave the broker delivery unacknowledged for replay.
                self.stderr.write(f'MQTT processing deferred: {type(exc).__name__}')
                client.disconnect()
            finally:
                close_old_connections()

        client.on_connect = connected
        client.on_message = received
        client.connect(os.environ['MQTT_HOST'], int(os.environ.get('MQTT_PORT', '8883')), 30)
        try:
            while True:
                result = client.loop(timeout=1)
                if result != mqtt.MQTT_ERR_SUCCESS:
                    time.sleep(1)
                    try: client.reconnect()
                    except OSError: continue
                close_old_connections()
                now = timezone.now()
                DeviceCommand.objects.exclude(state__in=['DEVICE_CONFIRMED', 'REJECTED', 'EXPIRED']).filter(expires_at__lte=now).update(state='EXPIRED')
                if not client.is_connected(): continue
                for command in DeviceCommand.objects.filter(state__in=['QUEUED', 'SENT'], expires_at__gt=now, gateway__active=True).select_related('node', 'gateway')[:100]:
                    if command.sent_at and (now-command.sent_at).total_seconds() < 5: continue
                    published = client.publish(f'compallette/v1/gateways/{command.gateway.node_id}/commands',
                        json.dumps(command_frame(command)), qos=1, retain=False)
                    if published.rc == mqtt.MQTT_ERR_SUCCESS:
                        DeviceCommand.objects.filter(pk=command.pk, state__in=['QUEUED', 'SENT']).update(
                            state='SENT', sent_at=now, attempts=F('attempts')+1)
        except KeyboardInterrupt:
            client.disconnect()
