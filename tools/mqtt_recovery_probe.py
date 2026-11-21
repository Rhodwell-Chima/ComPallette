"""Isolated broker recovery probe; never targets an application database."""
import argparse
import json
import os
import threading
import time
from pathlib import Path

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'compallette.settings')
import django
django.setup()
from django.conf import settings
from mining_api.models import Node, Site, IngestedEvent
import paho.mqtt.client as mqtt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('phase', choices=['stage', 'verify', 'auth-accepted', 'auth-rejected'])
    parser.add_argument('--ca-file', required=True)
    parser.add_argument('--report', required=True)
    options = parser.parse_args()
    if settings.DATABASES['default']['NAME'] != 'compallette_mqtt_verification':
        raise RuntimeError('Refusing a non-verification database.')
    auth_probe = options.phase.startswith('auth-')
    username = 'GW-FOREIGN' if auth_probe else 'GW-VERIFY'
    password = 'isolated-foreign-test-password' if auth_probe else 'isolated-gateway-test-password'
    connected, subscribed = threading.Event(), threading.Event()
    accepted, receipts, duplicates = [], set(), set()
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id='isolated-recovery-probe')
    client.username_pw_set(username, password)
    client.tls_set(ca_certs=options.ca_file)

    def on_connect(client, userdata, flags, reason, properties):
        accepted.append(not reason.is_failure)
        if not reason.is_failure and not auth_probe:
            client.subscribe('compallette/v1/gateways/GW-VERIFY/receipts', qos=1)
        connected.set()

    def on_message(client, userdata, message):
        data = json.loads(message.payload)
        if data.get('node_id') == 'VERIFY-RECOVERY' and data.get('installation_id') == settings.COMPALLETTE_INSTALLATION_ID:
            receipts.add(data.get('seq'))
            if data.get('deduplicated'):
                duplicates.add(data.get('seq'))

    client.on_connect = on_connect
    client.on_subscribe = lambda *args: subscribed.set()
    client.on_message = on_message
    client.connect('localhost', 8883, 30)
    client.loop_start()
    try:
        if not connected.wait(15):
            raise RuntimeError('No broker connection result.')
        if auth_probe:
            passed = accepted[0] == (options.phase == 'auth-accepted')
            report = {'phase': options.phase, 'broker_accepted': accepted[0], 'passed': passed}
        else:
            if accepted != [True] or not subscribed.wait(15):
                raise RuntimeError('Recovery probe could not subscribe.')
            site = Site.objects.get(code='MQTT-VERIFY')
            node, _ = Node.objects.get_or_create(node_id='VERIFY-RECOVERY', defaults={
                'site': site, 'organisation': site.organisation, 'role': 'WEARABLE', 'commissioned': True, 'is_simulated': True})
            if options.phase == 'verify':
                deadline = time.monotonic() + 30
                while IngestedEvent.objects.filter(node=node).count() < 10 and time.monotonic() < deadline:
                    time.sleep(0.1)
                if IngestedEvent.objects.filter(node=node).count() != 10:
                    raise RuntimeError('Broker did not replay all staged deliveries after restart.')
            for sequence in range(1, 11):
                packet = {'installation_id': settings.COMPALLETTE_INSTALLATION_ID, 'ver': 1, 'type': 'HEARTBEAT',
                          'sender': node.pk, 'role': 'WEARABLE', 'seq': sequence, 'zone': 'UNASSIGNED',
                          'uptime': sequence * 1000, 'payload': {'heap': 10000, 'batt': 3.7, 'sim': True}}
                client.publish('compallette/v1/gateways/GW-VERIFY/events', json.dumps(packet), qos=1).wait_for_publish(10)
            if options.phase == 'verify':
                deadline = time.monotonic() + 30
                while len(receipts) < 10 and time.monotonic() < deadline:
                    time.sleep(0.1)
            count = IngestedEvent.objects.filter(node=node).count()
            passed = count == 0 if options.phase == 'stage' else count == 10 and len(receipts) == 10 and len(duplicates) == 10
            report = {'phase': options.phase, 'persisted': count, 'receipts': len(receipts), 'duplicate_receipts': len(duplicates), 'passed': passed}
        Path(options.report).write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
        print(json.dumps(report))
        if not report['passed']:
            raise RuntimeError('Recovery/authentication probe failed.')
    finally:
        client.disconnect()
        client.loop_stop()


if __name__ == '__main__':
    main()
