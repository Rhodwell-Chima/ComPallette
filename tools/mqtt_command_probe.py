"""Exercise signed provisioning and diagnostics through the isolated real broker."""
import argparse
import json
import os
from pathlib import Path
from queue import Queue, Empty
import time
import uuid
from datetime import timedelta

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'compallette.settings')
import django
django.setup()
from django.conf import settings
from django.contrib.auth import get_user_model
from django.utils import timezone
from rest_framework.test import APIClient
from mining_api.models import GatewayRegistration, DeviceDiscovery, DeviceCommand, Node, AuditEntry
from mining_api.device_trust import sign, verify
import paho.mqtt.client as mqtt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', required=True)
    options = parser.parse_args()
    if settings.DATABASES['default']['NAME'] != 'compallette_mqtt_verification':
        raise RuntimeError('Refusing a non-verification database.')
    directory = Path(options.directory)
    installation = settings.COMPALLETTE_INSTALLATION_ID
    gateway = GatewayRegistration.objects.get(node_id='GW-VERIFY')
    hardware, target = 'ACDC01', 'VERIFY-CONTROL'
    if Node.objects.filter(pk=target).exists():
        raise RuntimeError('This one-shot probe requires a fresh control fixture.')
    key = bytes.fromhex('a1' * 32)
    (directory / f'{hardware}.json').write_text(json.dumps({'hardware_id': hardware, 'site_id': gateway.site_id,
        'installation_id': installation, 'key': key.hex()}), encoding='utf-8')
    messages = Queue()
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id='isolated-command-probe')
    client.username_pw_set('GW-VERIFY', 'isolated-gateway-test-password')
    client.tls_set(ca_certs=str(directory / 'server.crt'))
    prefix = 'compallette/v1/gateways/GW-VERIFY/'

    def connected(client, userdata, flags, reason, properties):
        if reason.is_failure:
            messages.put(('error', {}))
        else:
            client.subscribe([(prefix + 'commands', 1), (prefix + 'receipts', 1)])

    client.on_connect = connected
    client.on_subscribe = lambda *args: messages.put(('subscribed', {}))
    client.on_message = lambda client, userdata, message: messages.put((message.topic, json.loads(message.payload)))

    def await_message(predicate, seconds=15):
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            try:
                topic, body = messages.get(timeout=max(0.1, deadline - time.monotonic()))
            except Empty:
                break
            if predicate(topic, body):
                return body
        raise RuntimeError('Expected MQTT control/receipt did not arrive.')

    def publish(channel, data):
        client.publish(prefix + channel, json.dumps(data), qos=1).wait_for_publish(10)

    client.connect('localhost', 8883, 30)
    client.loop_start()
    try:
        await_message(lambda topic, body: topic == 'subscribed')
        clock = {'kind': 'TIME_REQUEST', 'hardware_id': hardware, 'installation_id': installation,
                 'boot_nonce': 'b' * 32, 'sync_nonce': 'c' * 32}
        publish('events', {'installation_id': installation, 'ver': 1, 'type': 'PROV_REQ', 'seq': 1,
            'sender': 'PROV-' + hardware, 'role': 'UNASSIGNED', 'zone': 'UNASSIGNED', 'uptime': 1000,
            'payload': {'chip_id': hardware, 'clock_request': sign(clock, key)}})
        receipt = await_message(lambda topic, body: body.get('node_id') == 'PROV-' + hardware and 'control' in body)
        reply = verify(receipt['control'], key)
        assert reply['kind'] == 'TIME_RESPONSE' and reply['sync_nonce'] == clock['sync_nonce']
        user, _ = get_user_model().objects.get_or_create(username='isolated-command-operator', defaults={'is_superuser': True, 'is_staff': True})
        api = APIClient(); api.force_authenticate(user)
        discovery = DeviceDiscovery.objects.get(gateway=gateway, hardware_id=hardware)
        request = {'operation_id': str(uuid.uuid4()), 'gateway_id': gateway.pk, 'kind': 'PROVISION',
                   'discovery_id': discovery.pk, 'node_id': target, 'role': 'WEARABLE', 'expected_version': discovery.version}
        response = api.post('/api/v1/commands', request, format='json', HTTP_HOST='localhost')
        assert response.status_code == 201, response.data
        command_id = response.json()['command_id']
        frame = await_message(lambda topic, body: topic.endswith('/commands') and body.get('command_id') == command_id)
        body = verify(frame, key)
        assert body['boot_nonce'] == clock['boot_nonce'] and body['node_id'] == target and body['kind'] == 'PROVISION'
        publish('results', {'kind': 'GATEWAY_RECEIPT', 'installation_id': installation,
            'command_id': command_id, 'node_id': target, 'state': 'GATEWAY_RECEIVED'})
        await_message(lambda topic, body: body.get('command_id') == command_id and body.get('received_state') == 'GATEWAY_RECEIVED')
        assert not Node.objects.get(pk=target).commissioned

        def confirmation(identity):
            return {'hardware_id': hardware, **sign({'kind': 'COMMAND_RESULT', 'installation_id': installation,
                'hardware_id': hardware, 'boot_nonce': clock['boot_nonce'], 'node_id': target,
                'command_id': identity, 'state': 'DEVICE_CONFIRMED'}, key)}

        for _ in range(2):
            publish('results', confirmation(command_id))
            result = await_message(lambda topic, body: body.get('command_id') == command_id and body.get('received_state') == 'DEVICE_CONFIRMED')
            assert result['state'] == 'DEVICE_CONFIRMED'
        assert Node.objects.get(pk=target).commissioned
        assert AuditEntry.objects.filter(action='COMMAND_RESULT', metadata__command_id=command_id,
            metadata__received_state='DEVICE_CONFIRMED').count() == 1
        response = api.post('/api/v1/commands', {'operation_id': str(uuid.uuid4()), 'gateway_id': gateway.pk,
            'node_id': target, 'kind': 'DIAGNOSTIC', 'expected_version': Node.objects.get(pk=target).version}, format='json', HTTP_HOST='localhost')
        assert response.status_code == 201, response.data
        diagnostic_id = response.json()['command_id']
        diagnostic = await_message(lambda topic, body: topic.endswith('/commands') and body.get('command_id') == diagnostic_id)
        assert verify(diagnostic, key)['kind'] == 'DIAGNOSTIC'
        DeviceCommand.objects.filter(pk=diagnostic_id).update(expires_at=timezone.now() - timedelta(seconds=1))
        publish('results', confirmation(diagnostic_id))
        expired = await_message(lambda topic, body: body.get('command_id') == diagnostic_id)
        assert expired['state'] == 'EXPIRED'
        report = {'signed_time': True, 'signed_provisioning': True, 'gateway_receipt_did_not_commission': True,
                  'device_confirmation_commissioned': True, 'duplicate_confirmation_audit_count': 1,
                  'late_diagnostic_state': expired['state'], 'passed': True, 'physical_hardware_verified': False}
        (directory / 'command-report.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
        print(json.dumps(report))
    finally:
        client.disconnect(); client.loop_stop()


if __name__ == '__main__':
    main()
