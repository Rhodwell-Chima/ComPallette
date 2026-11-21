"""Opt-in integration/load harness, restricted to a dedicated throwaway database."""
import json
import threading
import time
from pathlib import Path

from django.conf import settings
from django.contrib.auth.hashers import make_password
from django.core.management.base import BaseCommand, CommandError
from mining_api.installation import installation_id
from mining_api.models import Organisation, Site, Node, GatewayRegistration, IngestedEvent


class Command(BaseCommand):
    help = 'Run isolated TLS MQTT receipt, ACL, replay and optional 100-device load verification.'

    def add_arguments(self, parser):
        parser.add_argument('--seconds', type=int, default=5)
        parser.add_argument('--ca-file', required=True)
        parser.add_argument('--report', required=True)
        parser.add_argument('--sequence-start', type=int, default=1)

    def handle(self, *args, **options):
        if settings.DATABASES['default']['NAME'] != 'compallette_mqtt_verification':
            raise CommandError('This harness only runs against compallette_mqtt_verification.')
        duration = options['seconds']
        if duration < 1 or duration > 1800:
            raise CommandError('Choose 1 to 1800 seconds.')
        import paho.mqtt.client as mqtt
        org, _ = Organisation.objects.get_or_create(slug='mqtt-verification', defaults={'name': 'Isolated MQTT verification'})
        site, _ = Site.objects.get_or_create(code='MQTT-VERIFY', defaults={'name': 'Isolated MQTT verification', 'organisation': org})
        for name, password in [('GW-VERIFY', 'isolated-gateway-test-password'), ('GW-FOREIGN', 'isolated-foreign-test-password')]:
            node, _ = Node.objects.get_or_create(node_id=name, defaults={'role': 'GATEWAY', 'site': site, 'organisation': org, 'commissioned': True})
            GatewayRegistration.objects.update_or_create(node=node, defaults={'site': site, 'active': True, 'credentials_installed': True, 'credential_hash': make_password(password)})
        devices = [f'VERIFY-{index:03d}' for index in range(100)]
        for name in devices:
            Node.objects.get_or_create(node_id=name, defaults={'role': 'WEARABLE', 'site': site, 'organisation': org, 'commissioned': True, 'is_simulated': True})
        acknowledged, duplicate_receipts, received_topics = set(), set(), set()
        connected, subscribed = threading.Event(), threading.Event()
        lock = threading.Lock()
        client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id='isolated-load-gateway')
        client.username_pw_set('GW-VERIFY', 'isolated-gateway-test-password')
        client.tls_set(ca_certs=options['ca_file'])
        client.max_inflight_messages_set(100)

        def on_connect(client, userdata, flags, reason, properties):
            if reason.is_failure:
                return
            connected.set()
            client.subscribe([('compallette/v1/gateways/GW-VERIFY/receipts', 1),
                              ('compallette/v1/gateways/GW-FOREIGN/receipts', 1)])

        def on_message(client, userdata, message):
            data = json.loads(message.payload)
            with lock:
                received_topics.add(message.topic)
                identity = (data.get('node_id'), data.get('seq'))
                if data.get('installation_id') == installation_id() and data.get('status') == 'ok':
                    acknowledged.add(identity)
                    if data.get('deduplicated'):
                        duplicate_receipts.add(identity)

        client.on_connect = on_connect
        client.on_subscribe = lambda *args: subscribed.set()
        client.on_message = on_message
        client.connect('localhost', 8883, 30)
        client.loop_start()
        before = IngestedEvent.objects.filter(node_id__in=devices).count()
        topic = 'compallette/v1/gateways/GW-VERIFY/events'
        first_sequence = options['sequence_start']
        if first_sequence <= 0 or IngestedEvent.objects.filter(node_id__in=devices, sequence__gte=first_sequence).exists():
            client.disconnect(); client.loop_stop()
            raise CommandError('Use a fresh sequence range for this run.')

        def packet(name, sequence):
            return {'installation_id': installation_id(), 'ver': 1, 'type': 'HEARTBEAT',
                    'sender': name, 'seq': sequence, 'role': 'WEARABLE', 'zone': 'UNASSIGNED',
                    'uptime': sequence * 1000, 'payload': {'heap': 100000, 'batt': 3.7, 'sim': True}}

        expected = set()
        started = time.monotonic()
        try:
            if not connected.wait(15) or not subscribed.wait(15):
                raise CommandError('Gateway could not connect and subscribe over TLS.')
            from paho.mqtt.publish import single
            single('compallette/v1/gateways/GW-FOREIGN/receipts', json.dumps({'acl_probe': True}),
                   hostname='localhost', port=8883, qos=1,
                   auth={'username': 'compallette-ingestion', 'password': 'isolated-worker-test-password'},
                   tls={'ca_certs': options['ca_file']})
            # If the write ACL is broken, this would persist a distinct event through
            # the second registered gateway, so a missing receipt alone cannot pass.
            forbidden_sequence = first_sequence + duration + 1000
            client.publish('compallette/v1/gateways/GW-FOREIGN/events', json.dumps(packet(devices[0], forbidden_sequence)), qos=1).wait_for_publish(10)
            for second in range(duration):
                tick = time.monotonic()
                sequence = first_sequence + second
                for name in devices:
                    expected.add((name, sequence))
                    client.publish(topic, json.dumps(packet(name, sequence)), qos=1)
                if second and second % 60 == 0:
                    self.stdout.write(json.dumps({'elapsed_seconds': second, 'sent': len(expected), 'receipts': len(acknowledged)}))
                    self.stdout.flush()
                time.sleep(max(0, 1 - (time.monotonic() - tick)))
            deadline = time.monotonic() + 120
            while time.monotonic() < deadline and not expected.issubset(acknowledged):
                time.sleep(0.1)
            for name in devices:
                client.publish(topic, json.dumps(packet(name, first_sequence)), qos=1)
            replay = {(name, first_sequence) for name in devices}
            deadline = time.monotonic() + 30
            while time.monotonic() < deadline and not replay.issubset(duplicate_receipts):
                time.sleep(0.1)
            after = IngestedEvent.objects.filter(node_id__in=devices).count()
            forbidden_stored = IngestedEvent.objects.filter(node_id=devices[0], sequence=forbidden_sequence).exists()
            report = {'duration_seconds': duration, 'elapsed_seconds': round(time.monotonic() - started, 2),
                      'devices': 100, 'events_sent': len(expected), 'events_persisted': after - before,
                      'missing_receipts': len(expected - acknowledged), 'replay_receipts': len(replay & duplicate_receipts),
                      'forbidden_publish_persisted': forbidden_stored,
                      'foreign_receipt_received': 'compallette/v1/gateways/GW-FOREIGN/receipts' in received_topics}
            report['passed'] = (after - before == len(expected) and expected.issubset(acknowledged)
                                and replay.issubset(duplicate_receipts) and not forbidden_stored
                                and not report['foreign_receipt_received'])
            Path(options['report']).write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
            self.stdout.write(json.dumps(report))
            if not report['passed']:
                raise CommandError('MQTT verification failed; inspect the recorded report.')
        finally:
            client.disconnect()
            client.loop_stop()
