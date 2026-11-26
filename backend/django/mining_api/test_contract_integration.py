import json
import tempfile
import uuid
from io import StringIO
from unittest.mock import patch
from types import SimpleNamespace
from django.db import OperationalError
from pathlib import Path
from datetime import timedelta
from django.test import TestCase, override_settings
from django.contrib.auth import get_user_model
from django.contrib.auth.hashers import make_password
from django.utils import timezone
from django.core.management import call_command, CommandError
from rest_framework.test import APIClient
from .models import (
    Organisation, Site, SiteMembership, Node, GatewayRegistration, DeviceDiscovery,
    DeviceCommand, QuarantinedEvent, AuditEntry, DeviceCapability, MeasurementReading,
)
from .serializers import NodeSerializer
from .device_trust import sign, verify
from .commands import command_frame

INSTALLATION = '11111111-1111-4111-8111-111111111111'
KEY = bytes.fromhex('ab' * 32)  # Isolated test key, never a deployment credential.


@override_settings(COMPALLETTE_INSTALLATION_ID=INSTALLATION)
class ContractIntegrationTests(TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        config = override_settings(COMPALLETTE_DEVICE_KEY_DIR=self.directory.name)
        config.enable(); self.addCleanup(config.disable)
        self.org = Organisation.objects.create(name='Contract test', slug='contract-test')
        self.site = Site.objects.create(organisation=self.org, name='Contract test', code='CONTRACT')
        self.operator = get_user_model().objects.create_superuser(username='contract-admin', password='test-only')
        self.client = APIClient(); self.client.force_authenticate(self.operator)
        gateway = Node.objects.create(node_id='GW-TEST', hardware_id='ABCDEF', role='GATEWAY', organisation=self.org, site=self.site, commissioned=True)
        self.gateway = GatewayRegistration.objects.create(node=gateway, site=self.site, credentials_installed=True, credential_hash=make_password('isolated-gateway-key'))
        self.headers = {'HTTP_X_GATEWAY_ID': gateway.pk, 'HTTP_X_API_KEY': 'isolated-gateway-key'}
        Path(self.directory.name, '123ABC.json').write_text(json.dumps({'installation_id': INSTALLATION, 'site_id': self.site.pk, 'hardware_id': '123ABC', 'key': KEY.hex()}))

    def discover(self):
        request = {'kind': 'TIME_REQUEST', 'installation_id': INSTALLATION, 'hardware_id': '123ABC', 'boot_nonce': 'a' * 32, 'sync_nonce': 'b' * 32}
        packet = {'installation_id': INSTALLATION, 'ver': 1, 'type': 'PROV_REQ', 'seq': 1, 'sender': 'PROV-123ABC', 'role': 'UNASSIGNED', 'zone': 'UNASSIGNED', 'uptime': 1,
                  'payload': {'chip_id': '123ABC', 'clock_request': sign(request, KEY)}}
        response = self.client.post('/api/v1/provision/request', packet, format='json', **self.headers)
        self.assertEqual(response.status_code, 200, response.data)
        control = verify(response.json()['control'], KEY)
        self.assertEqual(control['kind'], 'TIME_RESPONSE')
        self.assertEqual(control['sync_nonce'], request['sync_nonce'])
        return DeviceDiscovery.objects.get(hardware_id='123ABC')

    def queue(self):
        discovery = self.discover()
        payload = {'operation_id': str(uuid.uuid4()), 'gateway_id': self.gateway.pk, 'node_id': 'TRACK-TEST', 'kind': 'PROVISION', 'discovery_id': discovery.pk, 'role': 'WEARABLE', 'expected_version': discovery.version}
        response = self.client.post('/api/v1/commands', payload, format='json')
        self.assertEqual(response.status_code, 201, response.data)
        return DeviceCommand.objects.get(pk=response.json()['command_id']), payload

    def result(self, command, key=KEY):
        body = {'installation_id': INSTALLATION, 'hardware_id': '123ABC', 'boot_nonce': 'a' * 32, 'kind': 'COMMAND_RESULT', 'command_id': str(command.pk), 'node_id': command.node_id, 'state': 'DEVICE_CONFIRMED'}
        return {'hardware_id': '123ABC', **sign(body, key)}

    def test_signed_enrollment_command_and_confirmation(self):
        command, payload = self.queue()
        body = verify(command_frame(command), KEY)
        self.assertEqual(body['boot_nonce'], 'a' * 32)
        self.assertEqual(body['node_id'], 'TRACK-TEST')
        repeat = self.client.post('/api/v1/commands', payload, format='json')
        self.assertEqual(repeat.status_code, 200)
        changed = self.client.post('/api/v1/commands', {**payload, 'role': 'ANCHOR'}, format='json')
        self.assertEqual(changed.status_code, 409)
        response = self.client.post('/api/v1/provision/confirm', self.result(command), format='json', **self.headers)
        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(Node.objects.get(pk='TRACK-TEST').commissioned)
        self.client.post('/api/v1/provision/confirm', self.result(command), format='json', **self.headers)
        self.assertEqual(AuditEntry.objects.filter(action='COMMAND_RESULT').count(), 1)

    def test_queued_command_delivered_in_gateway_uplink_receipt(self):
        command, payload = self.queue()
        self.assertEqual(command.state, 'QUEUED')

        # Gateway sends a routine heartbeat
        hb_packet = {
            'installation_id': INSTALLATION,
            'ver': 1,
            'type': 'HEARTBEAT',
            'seq': 200,
            'sender': 'GW-TEST',
            'role': 'GATEWAY',
            'zone': 'SURFACE-PORTAL',
            'uptime': 5000,
            'payload': {'heap': 200000, 'batt': 3.9, 'peers': 2}
        }
        response = self.client.post('/api/v1/heartbeat', hb_packet, format='json', **self.headers)
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn('control', data)
        control = verify(data['control'], KEY)
        self.assertEqual(control['command_id'], str(command.pk))
        self.assertEqual(control['kind'], 'PROVISION')
        self.assertEqual(control['node_id'], 'TRACK-TEST')

        command.refresh_from_db()
        self.assertEqual(command.state, 'SENT')

    def test_forged_confirmation_cannot_commission_device(self):
        command, _ = self.queue()
        response = self.client.post('/api/v1/provision/confirm', self.result(command, bytes(32)), format='json', **self.headers)
        self.assertEqual(response.status_code, 403)
        self.assertFalse(Node.objects.get(pk='TRACK-TEST').commissioned)

    def test_a_different_enrolled_device_cannot_reject_another_devices_command(self):
        command, _ = self.queue()
        peer_key = bytes.fromhex('cd' * 32)
        Path(self.directory.name, 'PEER.json').write_text(json.dumps({
            'installation_id': INSTALLATION, 'site_id': self.site.pk, 'hardware_id': 'PEER', 'key': peer_key.hex(),
        }), encoding='utf-8')
        body = {'installation_id': INSTALLATION, 'hardware_id': 'PEER', 'kind': 'COMMAND_RESULT',
                'command_id': str(command.pk), 'node_id': command.node_id, 'state': 'REJECTED'}
        response = self.client.post('/api/v1/provision/confirm', {'hardware_id': 'PEER', **sign(body, peer_key)}, format='json', **self.headers)
        self.assertEqual(response.status_code, 400)
        command.refresh_from_db()
        self.assertEqual(command.state, 'QUEUED')

    def test_django_staff_flag_alone_does_not_satisfy_bootstrap_readiness(self):
        self.operator.is_superuser = False
        self.operator.save()
        with self.assertRaises(CommandError):
            call_command('check_deployment_readiness', stdout=StringIO())

    def test_expired_confirmation_is_recorded_but_not_commissioned(self):
        command, _ = self.queue()
        command.expires_at = timezone.now() - timedelta(seconds=1); command.save()
        response = self.client.post('/api/v1/provision/confirm', self.result(command), format='json', **self.headers)
        self.assertEqual(response.json()['state'], 'EXPIRED')
        self.assertEqual(response.json()['received_state'], 'DEVICE_CONFIRMED')
        self.assertFalse(Node.objects.get(pk='TRACK-TEST').commissioned)

    def test_gateway_receipt_cannot_claim_execution(self):
        command, _ = self.queue()
        packet = {'installation_id': INSTALLATION, 'kind': 'GATEWAY_RECEIPT', 'command_id': str(command.pk), 'node_id': command.node_id, 'state': 'DEVICE_CONFIRMED'}
        self.assertEqual(self.client.post('/api/v1/provision/confirm', packet, format='json', **self.headers).status_code, 400)
        packet['state'] = 'GATEWAY_RECEIVED'
        self.assertEqual(self.client.post('/api/v1/provision/confirm', packet, format='json', **self.headers).status_code, 200)
        self.assertFalse(Node.objects.get(pk='TRACK-TEST').commissioned)

    def test_unknown_events_are_durable_and_old_installation_is_rejected(self):
        packet = {'installation_id': INSTALLATION, 'ver': 1, 'type': 'HEARTBEAT', 'seq': 3, 'sender': 'UNKNOWN', 'role': 'WEARABLE', 'zone': 'UNASSIGNED', 'uptime': 1, 'payload': {'heap': 1000, 'batt': 3.7}}
        for _ in range(2):
            response = self.client.post('/api/v1/heartbeat', packet, format='json', **self.headers)
            self.assertEqual(response.status_code, 200)
            self.assertTrue(response.json()['quarantined'])
        self.assertEqual(QuarantinedEvent.objects.count(), 1)
        packet['installation_id'] = str(uuid.uuid4())
        response = self.client.post('/api/v1/heartbeat', packet, format='json', **self.headers)
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()['error_code'], 'INSTALLATION_MISMATCH')

    def test_registration_never_returns_credentials(self):
        response = self.client.post('/api/v1/gateways', {'operation_id': str(uuid.uuid4()), 'site': self.site.pk, 'node_id': 'NEW-GW', 'hardware_id': '999AAA'}, format='json')
        self.assertEqual(response.status_code, 201)
        self.assertNotIn('credential', response.json())
        self.assertFalse(response.json()['credentials_installed'])
        self.assertFalse(Node.objects.get(pk='NEW-GW').commissioned)

    def test_unauthenticated_and_forbidden_are_distinct(self):
        self.assertEqual(APIClient().get('/api/v1/gateways', {'site': self.site.pk}).status_code, 401)
        viewer = get_user_model().objects.create_user(username='contract-viewer')
        SiteMembership.objects.create(user=viewer, organisation=self.org, site=self.site, role='VIEWER')
        self.client.force_authenticate(viewer)
        self.assertEqual(self.client.get('/api/v1/provision/pending', {'site': self.site.pk}).status_code, 403)
        self.assertEqual(self.client.get('/api/v1/platform/bootstrap').json()['contract_version'], 2)

    def test_local_key_provisioning_binds_context_without_printing_secret(self):
        with tempfile.TemporaryDirectory() as output_directory:
            output = StringIO()
            call_command('provision_device_trust', hardware_id='456DEF', site=self.site.pk,
                         output_directory=output_directory, ntp_host='time.local', stdout=output)
            device = json.loads(Path(output_directory, 'device-trust.json').read_text(encoding='utf-8'))
            server = json.loads(Path(self.directory.name, '456DEF.json').read_text(encoding='utf-8'))
            self.assertEqual(device, server)
            self.assertEqual(device['installation_id'], INSTALLATION)
            self.assertEqual(device['site_id'], self.site.pk)
            self.assertEqual(len(bytes.fromhex(device['key'])), 32)
            self.assertNotIn(device['key'], output.getvalue())
            with self.assertRaises(CommandError):
                call_command('provision_device_trust', hardware_id='456DEF', site=self.site.pk,
                             output_directory=output_directory, stdout=output)
            self.assertEqual(json.loads(Path(output_directory, 'device-trust.json').read_text(encoding='utf-8')), device)

    @override_settings(COMPALLETTE_INSTALLATION_ID='')
    def test_readiness_rejects_unconfigured_installation(self):
        output = StringIO()
        with self.assertRaises(CommandError):
            call_command('check_deployment_readiness', stdout=output)
        self.assertFalse(json.loads(output.getvalue())['ready'])
        response = self.client.post('/api/v1/heartbeat', {'type': 'HEARTBEAT'}, format='json', **self.headers)
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()['error_code'], 'INSTALLATION_NOT_CONFIGURED')

    @override_settings(COMPALLETTE_DEVICE_KEY_DIR='')
    def test_readiness_rejects_missing_key_storage(self):
        with self.assertRaises(CommandError):
            call_command('check_deployment_readiness', stdout=StringIO())

    def test_gateway_activation_requires_matching_bundle_and_verified_broker(self):
        Path(self.directory.name, 'ABCDEF.json').write_text(json.dumps({
            'installation_id': INSTALLATION, 'site_id': self.site.pk,
            'hardware_id': 'ABCDEF', 'key': KEY.hex(),
        }), encoding='utf-8')
        self.gateway.credentials_installed = False
        self.gateway.save()
        with tempfile.TemporaryDirectory() as directory:
            output = StringIO()
            arguments = {'gateway': self.gateway.pk, 'actor': self.operator.username,
                         'directory': directory, 'stdout': output}
            call_command('provision_gateway_credentials', 'prepare', **arguments)
            bundle = json.loads(Path(directory, 'gateway-credentials.json').read_text(encoding='utf-8'))
            self.assertNotIn(bundle['credential'], output.getvalue())
            self.gateway.refresh_from_db()
            self.assertFalse(self.gateway.credentials_installed)
            verifier = 'mining_api.management.commands.provision_gateway_credentials.verify_broker'
            with patch(verifier, side_effect=CommandError('TLS unavailable')):
                with self.assertRaises(CommandError):
                    call_command('provision_gateway_credentials', 'activate', broker_host='isolated', ca_file='test-ca', **arguments)
            self.gateway.refresh_from_db()
            self.assertFalse(self.gateway.credentials_installed)
            with patch(verifier) as probe:
                call_command('provision_gateway_credentials', 'activate', broker_host='isolated', ca_file='test-ca', **arguments)
                probe.assert_called_once_with('isolated', 8883, 'test-ca', 'GW-TEST', bundle['credential'])
            self.gateway.refresh_from_db()
            self.assertTrue(self.gateway.credentials_installed)

    def test_mqtt_batch_rolls_back_all_events_on_database_failure(self):
        from .management.commands.run_mqtt import persist_deliveries
        from .ingestion import ingest
        packet = {'installation_id': INSTALLATION, 'ver': 1, 'type': 'HEARTBEAT', 'seq': 7,
                  'sender': 'UNKNOWN-BATCH', 'role': 'WEARABLE', 'zone': 'UNASSIGNED',
                  'uptime': 10, 'payload': {'heap': 1000, 'batt': 3.7}}
        message = SimpleNamespace(topic='compallette/v1/gateways/GW-TEST/events', payload=json.dumps(packet), retain=False)
        calls = 0

        def fail_second(gateway, data):
            nonlocal calls
            calls += 1
            if calls == 2:
                raise OperationalError('Isolated injected database failure')
            return ingest(gateway, data)

        with patch('mining_api.management.commands.run_mqtt.ingest', side_effect=fail_second):
            with self.assertRaises(OperationalError):
                persist_deliveries([message, message])
        self.assertFalse(QuarantinedEvent.objects.exists())
        self.assertFalse(DeviceDiscovery.objects.exists())
        results = persist_deliveries([message, message])
        self.assertEqual(QuarantinedEvent.objects.count(), 1)
        self.assertFalse(results[0][2]['deduplicated'])
        self.assertTrue(results[1][2]['deduplicated'])

    def test_gateway_request_retry_is_idempotent_and_stale_rotation_conflicts(self):
        payload = {'operation_id': str(uuid.uuid4()), 'site': self.site.pk, 'node_id': 'IDEMP-GW', 'hardware_id': 'IDEMP'}
        first = self.client.post('/api/v1/gateways', payload, format='json')
        repeated = self.client.post('/api/v1/gateways', payload, format='json')
        self.assertEqual(first.status_code, 201)
        self.assertEqual(repeated.status_code, 200)
        self.assertEqual(first.json(), repeated.json())
        changed = self.client.post('/api/v1/gateways', {**payload, 'hardware_id': 'OTHER'}, format='json')
        self.assertEqual(changed.status_code, 409)
        rotation = {'operation_id': str(uuid.uuid4()), 'site': self.site.pk, 'gateway_id': first.json()['gateway_id'], 'action': 'rotate', 'expected_version': 1}
        self.assertEqual(self.client.post('/api/v1/gateways', rotation, format='json').status_code, 201)
        self.assertEqual(self.client.post('/api/v1/gateways', rotation, format='json').status_code, 200)
        self.assertEqual(self.client.post('/api/v1/gateways', {**rotation, 'operation_id': str(uuid.uuid4())}, format='json').status_code, 409)


class DeviceKeyManagementEdgeCaseTests(TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        config = override_settings(
            COMPALLETTE_INSTALLATION_ID=INSTALLATION,
            COMPALLETTE_DEVICE_KEY_DIR=self.directory.name,
        )
        config.enable()
        self.addCleanup(config.disable)
        self.org = Organisation.objects.create(name='Key Org', slug='key-org')
        self.site = Site.objects.create(organisation=self.org, name='Key Site', code='KEY')
        self.operator = get_user_model().objects.create_superuser(username='key-admin', password='test-only')
        self.client = APIClient()
        self.client.force_authenticate(self.operator)
        gateway_node = Node.objects.create(node_id='GW-KEY', hardware_id='GWKEY01', role='GATEWAY', organisation=self.org, site=self.site, commissioned=True)
        self.gateway = GatewayRegistration.objects.create(node=gateway_node, site=self.site, credentials_installed=True, credential_hash=make_password('test-gw-key'))
        self.headers = {'HTTP_X_GATEWAY_ID': gateway_node.pk, 'HTTP_X_API_KEY': 'test-gw-key'}

    def test_ensure_device_key_auto_generates_valid_256bit_key(self):
        from .device_trust import ensure_device_key, device_key
        key_bytes = ensure_device_key('AUTO01', self.site.pk)
        self.assertEqual(len(key_bytes), 32)
        key_file = Path(self.directory.name, 'AUTO01.json')
        self.assertTrue(key_file.exists())
        data = json.loads(key_file.read_text(encoding='utf-8'))
        self.assertEqual(data['installation_id'], INSTALLATION)
        self.assertEqual(data['site_id'], self.site.pk)
        self.assertEqual(data['hardware_id'], 'AUTO01')
        self.assertEqual(bytes.fromhex(data['key']), key_bytes)
        self.assertEqual(device_key('AUTO01', self.site.pk), key_bytes)

    def test_ensure_device_key_with_explicit_preshared_hex_key(self):
        from .device_trust import ensure_device_key, device_key
        custom_hex = 'ef' * 32
        key_bytes = ensure_device_key('CUSTOM01', self.site.pk, secret_hex=custom_hex)
        self.assertEqual(key_bytes, bytes.fromhex(custom_hex))
        data = json.loads(Path(self.directory.name, 'CUSTOM01.json').read_text(encoding='utf-8'))
        self.assertEqual(data['key'], custom_hex)
        self.assertEqual(device_key('CUSTOM01', self.site.pk), bytes.fromhex(custom_hex))

    def test_ensure_device_key_idempotence_preserves_existing_key(self):
        from .device_trust import ensure_device_key
        first_key = ensure_device_key('IDEMP01', self.site.pk)
        second_key = ensure_device_key('IDEMP01', self.site.pk)
        self.assertEqual(first_key, second_key)

    def test_ensure_device_key_rejects_invalid_hardware_ids(self):
        from .device_trust import ensure_device_key
        from rest_framework.exceptions import ValidationError
        with self.assertRaises(ValidationError):
            ensure_device_key('../traversal', self.site.pk)
        with self.assertRaises(ValidationError):
            ensure_device_key('bad/slash', self.site.pk)
        with self.assertRaises(ValidationError):
            ensure_device_key('spaces not allowed', self.site.pk)
        with self.assertRaises(ValidationError):
            ensure_device_key('x' * 33, self.site.pk)
        with self.assertRaises(ValidationError):
            ensure_device_key('', self.site.pk)

    def test_ensure_device_key_rejects_invalid_hex_keys(self):
        from .device_trust import ensure_device_key
        from rest_framework.exceptions import ValidationError
        with self.assertRaises(ValidationError):
            ensure_device_key('BADKEY01', self.site.pk, secret_hex='tooshort')
        with self.assertRaises(ValidationError):
            ensure_device_key('BADKEY01', self.site.pk, secret_hex='ab' * 16)
        with self.assertRaises(ValidationError):
            ensure_device_key('BADKEY01', self.site.pk, secret_hex='ab' * 33)
        with self.assertRaises(ValidationError):
            ensure_device_key('BADKEY01', self.site.pk, secret_hex='zz' * 32)

    def test_ensure_device_key_recovers_from_corrupted_key_file(self):
        from .device_trust import ensure_device_key
        corrupt_file = Path(self.directory.name, 'CORRUPT01.json')
        corrupt_file.write_text('{invalid_json:', encoding='utf-8')
        key_bytes = ensure_device_key('CORRUPT01', self.site.pk)
        self.assertEqual(len(key_bytes), 32)
        data = json.loads(corrupt_file.read_text(encoding='utf-8'))
        self.assertEqual(bytes.fromhex(data['key']), key_bytes)

    def test_ensure_device_key_missing_key_dir_raises_permission_denied(self):
        from .device_trust import ensure_device_key
        from rest_framework.exceptions import PermissionDenied
        with override_settings(COMPALLETTE_DEVICE_KEY_DIR=''):
            with self.assertRaises(PermissionDenied):
                ensure_device_key('NODIR', self.site.pk)

    def test_commands_view_provisioning_auto_generates_key_and_queues_command(self):
        request_frame = {'kind': 'TIME_REQUEST', 'installation_id': INSTALLATION, 'hardware_id': 'AUTO-DISC', 'boot_nonce': 'c' * 32, 'sync_nonce': 'd' * 32}
        packet = {'installation_id': INSTALLATION, 'ver': 1, 'type': 'PROV_REQ', 'seq': 1, 'sender': 'PROV-AUTODISC', 'role': 'UNASSIGNED', 'zone': 'UNASSIGNED', 'uptime': 1,
                  'payload': {'chip_id': 'AUTO-DISC', 'clock_request': request_frame}}
        self.client.post('/api/v1/provision/request', packet, format='json', **self.headers)
        discovery = DeviceDiscovery.objects.get(hardware_id='AUTO-DISC')

        cmd_payload = {
            'operation_id': str(uuid.uuid4()),
            'gateway_id': self.gateway.pk,
            'node_id': 'NODE-AUTODISC',
            'kind': 'PROVISION',
            'discovery_id': discovery.pk,
            'role': 'WEARABLE',
            'expected_version': discovery.version,
        }
        res = self.client.post('/api/v1/commands', cmd_payload, format='json')
        self.assertEqual(res.status_code, 201)
        self.assertTrue(Path(self.directory.name, 'AUTO-DISC.json').exists())

        node = Node.objects.get(node_id='NODE-AUTODISC')
        self.assertEqual(node.hardware_id, 'AUTO-DISC')
        self.assertFalse(node.commissioned)
        command = DeviceCommand.objects.get(pk=res.json()['command_id'])
        self.assertEqual(command.state, 'QUEUED')

    def test_commands_view_provisioning_with_custom_device_key(self):
        custom_key_hex = '12' * 32
        request_frame = {'kind': 'TIME_REQUEST', 'installation_id': INSTALLATION, 'hardware_id': 'CUSTOM-DISC', 'boot_nonce': 'e' * 32, 'sync_nonce': 'f' * 32}
        packet = {'installation_id': INSTALLATION, 'ver': 1, 'type': 'PROV_REQ', 'seq': 1, 'sender': 'PROV-CUSTOM', 'role': 'UNASSIGNED', 'zone': 'UNASSIGNED', 'uptime': 1,
                  'payload': {'chip_id': 'CUSTOM-DISC', 'clock_request': request_frame}}
        self.client.post('/api/v1/provision/request', packet, format='json', **self.headers)
        discovery = DeviceDiscovery.objects.get(hardware_id='CUSTOM-DISC')

        cmd_payload = {
            'operation_id': str(uuid.uuid4()),
            'gateway_id': self.gateway.pk,
            'node_id': 'NODE-CUSTOM',
            'kind': 'PROVISION',
            'discovery_id': discovery.pk,
            'role': 'WEARABLE',
            'device_key': custom_key_hex,
            'expected_version': discovery.version,
        }
        res = self.client.post('/api/v1/commands', cmd_payload, format='json')
        self.assertEqual(res.status_code, 201)
        data = json.loads(Path(self.directory.name, 'CUSTOM-DISC.json').read_text(encoding='utf-8'))
        self.assertEqual(data['key'], custom_key_hex)

    def test_commands_view_provisioning_rejects_invalid_custom_device_key(self):
        request_frame = {'kind': 'TIME_REQUEST', 'installation_id': INSTALLATION, 'hardware_id': 'BAD-HEX', 'boot_nonce': '1' * 32, 'sync_nonce': '2' * 32}
        packet = {'installation_id': INSTALLATION, 'ver': 1, 'type': 'PROV_REQ', 'seq': 1, 'sender': 'PROV-BADHEX', 'role': 'UNASSIGNED', 'zone': 'UNASSIGNED', 'uptime': 1,
                  'payload': {'chip_id': 'BAD-HEX', 'clock_request': request_frame}}
        self.client.post('/api/v1/provision/request', packet, format='json', **self.headers)
        discovery = DeviceDiscovery.objects.get(hardware_id='BAD-HEX')

        cmd_payload = {
            'operation_id': str(uuid.uuid4()),
            'gateway_id': self.gateway.pk,
            'node_id': 'NODE-BADHEX',
            'kind': 'PROVISION',
            'discovery_id': discovery.pk,
            'role': 'WEARABLE',
            'device_key': 'not-a-valid-hex-string',
            'expected_version': discovery.version,
        }
        res = self.client.post('/api/v1/commands', cmd_payload, format='json')
        self.assertEqual(res.status_code, 400)


class DiscoveryAndQuarantineResolutionTests(TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        config = override_settings(
            COMPALLETTE_INSTALLATION_ID=INSTALLATION,
            COMPALLETTE_DEVICE_KEY_DIR=self.directory.name,
        )
        config.enable()
        self.addCleanup(config.disable)
        self.org = Organisation.objects.create(name='Quarantine Org', slug='quarantine-org')
        self.site = Site.objects.create(organisation=self.org, name='Quarantine Site', code='QUAR')
        self.operator = get_user_model().objects.create_superuser(username='quar-admin', password='test-only')
        self.client = APIClient()
        self.client.force_authenticate(self.operator)
        gateway_node = Node.objects.create(node_id='GW-QUAR', hardware_id='GWQUAR01', role='GATEWAY', organisation=self.org, site=self.site, commissioned=True)
        self.gateway = GatewayRegistration.objects.create(node=gateway_node, site=self.site, credentials_installed=True, credential_hash=make_password('test-gw-quar-key'))
        self.headers = {'HTTP_X_GATEWAY_ID': gateway_node.pk, 'HTTP_X_API_KEY': 'test-gw-quar-key'}

    def test_commission_confirmation_clears_discovery_and_all_quarantine_records(self):
        hardware = 'RESOLVE01'
        key = KEY
        Path(self.directory.name, f'{hardware}.json').write_text(json.dumps({
            'installation_id': INSTALLATION, 'site_id': self.site.pk, 'hardware_id': hardware, 'key': key.hex()
        }))

        request_frame = {'kind': 'TIME_REQUEST', 'installation_id': INSTALLATION, 'hardware_id': hardware, 'boot_nonce': '7' * 32, 'sync_nonce': '8' * 32}
        prov_packet = {'installation_id': INSTALLATION, 'ver': 1, 'type': 'PROV_REQ', 'seq': 1, 'sender': f'PROV-{hardware}', 'role': 'UNASSIGNED', 'zone': 'UNASSIGNED', 'uptime': 1,
                       'payload': {'chip_id': hardware, 'clock_request': sign(request_frame, key)}}
        res = self.client.post('/api/v1/provision/request', prov_packet, format='json', **self.headers)
        self.assertEqual(res.status_code, 200)

        hb_packet1 = {'installation_id': INSTALLATION, 'ver': 1, 'type': 'HEARTBEAT', 'seq': 2, 'sender': f'PROV-{hardware}', 'role': 'UNASSIGNED', 'zone': 'UNASSIGNED', 'uptime': 2, 'payload': {'heap': 1000, 'batt': 3.8}}
        hb_packet2 = {'installation_id': INSTALLATION, 'ver': 1, 'type': 'HEARTBEAT', 'seq': 3, 'sender': hardware, 'role': 'UNASSIGNED', 'zone': 'UNASSIGNED', 'uptime': 3, 'payload': {'heap': 1000, 'batt': 3.8}}
        res1 = self.client.post('/api/v1/heartbeat', hb_packet1, format='json', **self.headers)
        res2 = self.client.post('/api/v1/heartbeat', hb_packet2, format='json', **self.headers)
        self.assertEqual(res1.status_code, 200)
        self.assertEqual(res2.status_code, 200)

        self.assertTrue(DeviceDiscovery.objects.filter(gateway=self.gateway, hardware_id=hardware).exists())
        self.assertGreaterEqual(QuarantinedEvent.objects.filter(site=self.site).count(), 2)

        discovery = DeviceDiscovery.objects.get(hardware_id=hardware)
        cmd_payload = {
            'operation_id': str(uuid.uuid4()),
            'gateway_id': self.gateway.pk,
            'node_id': 'TAG-RESOLVED',
            'kind': 'PROVISION',
            'discovery_id': discovery.pk,
            'role': 'WEARABLE',
            'expected_version': discovery.version,
        }
        cmd_res = self.client.post('/api/v1/commands', cmd_payload, format='json')
        self.assertEqual(cmd_res.status_code, 201)
        command_id = cmd_res.json()['command_id']

        confirm_body = {'installation_id': INSTALLATION, 'hardware_id': hardware, 'boot_nonce': '7' * 32, 'kind': 'COMMAND_RESULT', 'command_id': command_id, 'node_id': 'TAG-RESOLVED', 'state': 'DEVICE_CONFIRMED'}
        confirm_packet = {'hardware_id': hardware, **sign(confirm_body, key)}
        confirm_res = self.client.post('/api/v1/provision/confirm', confirm_packet, format='json', **self.headers)
        self.assertEqual(confirm_res.status_code, 200)

        node = Node.objects.get(node_id='TAG-RESOLVED')
        self.assertTrue(node.commissioned)
        self.assertEqual(node.status, 'ONLINE')

        self.assertFalse(DeviceDiscovery.objects.filter(gateway=self.gateway, hardware_id=hardware).exists())
        self.assertFalse(QuarantinedEvent.objects.filter(site=self.site, sender_id=hardware).exists())
        self.assertFalse(QuarantinedEvent.objects.filter(site=self.site, sender_id=f'PROV-{hardware}').exists())
        self.assertFalse(QuarantinedEvent.objects.filter(site=self.site, sender_id='TAG-RESOLVED').exists())

    def test_gateways_view_exposes_payload_and_excludes_commissioned_hardware(self):
        hardware = 'DISC-PAYLOAD'
        packet = {'installation_id': INSTALLATION, 'ver': 1, 'type': 'PROV_REQ', 'seq': 1, 'sender': f'PROV-{hardware}', 'role': 'UNASSIGNED', 'zone': 'UNASSIGNED', 'uptime': 1,
                  'payload': {'chip_id': hardware, 'batt': 3.84, 'bme_healthy': True, 'mq_healthy': False, 'chip_mac': 'AA:BB:CC:DD:EE:FF'}}
        self.client.post('/api/v1/provision/request', packet, format='json', **self.headers)

        res = self.client.get(f'/api/v1/gateways?site={self.site.pk}')
        self.assertEqual(res.status_code, 200)
        discoveries = res.json()['discoveries']
        match = next((d for d in discoveries if d['hardware_id'] == hardware), None)
        self.assertIsNotNone(match)
        self.assertIn('payload', match)
        self.assertEqual(match['payload']['payload']['batt'], 3.84)
        self.assertTrue(match['payload']['payload']['bme_healthy'])

        Node.objects.create(node_id='TAG-COMMISSIONED', hardware_id=hardware, site=self.site, organisation=self.org, role='WEARABLE', commissioned=True)
        res2 = self.client.get(f'/api/v1/gateways?site={self.site.pk}')
        discoveries2 = res2.json()['discoveries']
        self.assertFalse(any(d['hardware_id'] == hardware for d in discoveries2))

    def test_rejected_command_preserves_discovery_and_quarantine(self):
        hardware = 'REJECT01'
        key = KEY
        Path(self.directory.name, f'{hardware}.json').write_text(json.dumps({
            'installation_id': INSTALLATION, 'site_id': self.site.pk, 'hardware_id': hardware, 'key': key.hex()
        }))
        request_frame = {'kind': 'TIME_REQUEST', 'installation_id': INSTALLATION, 'hardware_id': hardware, 'boot_nonce': '9' * 32, 'sync_nonce': '0' * 32}
        prov_packet = {'installation_id': INSTALLATION, 'ver': 1, 'type': 'PROV_REQ', 'seq': 1, 'sender': f'PROV-{hardware}', 'role': 'UNASSIGNED', 'zone': 'UNASSIGNED', 'uptime': 1,
                       'payload': {'chip_id': hardware, 'clock_request': sign(request_frame, key)}}
        self.client.post('/api/v1/provision/request', prov_packet, format='json', **self.headers)
        discovery = DeviceDiscovery.objects.get(hardware_id=hardware)

        cmd_payload = {
            'operation_id': str(uuid.uuid4()),
            'gateway_id': self.gateway.pk,
            'node_id': 'TAG-REJECTED',
            'kind': 'PROVISION',
            'discovery_id': discovery.pk,
            'role': 'WEARABLE',
            'expected_version': discovery.version,
        }
        cmd_res = self.client.post('/api/v1/commands', cmd_payload, format='json')
        command_id = cmd_res.json()['command_id']

        confirm_body = {'installation_id': INSTALLATION, 'hardware_id': hardware, 'boot_nonce': '9' * 32, 'kind': 'COMMAND_RESULT', 'command_id': command_id, 'node_id': 'TAG-REJECTED', 'state': 'REJECTED'}
        confirm_packet = {'hardware_id': hardware, **sign(confirm_body, key)}
        res = self.client.post('/api/v1/provision/confirm', confirm_packet, format='json', **self.headers)
        self.assertEqual(res.status_code, 200)

        node = Node.objects.get(node_id='TAG-REJECTED')
        self.assertFalse(node.commissioned)
        self.assertTrue(DeviceDiscovery.objects.filter(hardware_id=hardware).exists())
        self.assertTrue(QuarantinedEvent.objects.filter(site=self.site, sender_id=f'PROV-{hardware}').exists())

    def test_confirmation_hardware_mismatch_fails_and_preserves_records(self):
        hardware_a = 'HW-DEV-A'
        hardware_b = 'HW-DEV-B'
        key_a = KEY
        key_b = bytes.fromhex('ba' * 32)
        Path(self.directory.name, f'{hardware_a}.json').write_text(json.dumps({
            'installation_id': INSTALLATION, 'site_id': self.site.pk, 'hardware_id': hardware_a, 'key': key_a.hex()
        }))
        Path(self.directory.name, f'{hardware_b}.json').write_text(json.dumps({
            'installation_id': INSTALLATION, 'site_id': self.site.pk, 'hardware_id': hardware_b, 'key': key_b.hex()
        }))

        request_frame = {'kind': 'TIME_REQUEST', 'installation_id': INSTALLATION, 'hardware_id': hardware_a, 'boot_nonce': 'a' * 32, 'sync_nonce': 'b' * 32}
        prov_packet = {'installation_id': INSTALLATION, 'ver': 1, 'type': 'PROV_REQ', 'seq': 1, 'sender': f'PROV-{hardware_a}', 'role': 'UNASSIGNED', 'zone': 'UNASSIGNED', 'uptime': 1,
                       'payload': {'chip_id': hardware_a, 'clock_request': sign(request_frame, key_a)}}
        self.client.post('/api/v1/provision/request', prov_packet, format='json', **self.headers)
        discovery = DeviceDiscovery.objects.get(hardware_id=hardware_a)

        cmd_payload = {
            'operation_id': str(uuid.uuid4()),
            'gateway_id': self.gateway.pk,
            'node_id': 'NODE-TARGET-A',
            'kind': 'PROVISION',
            'discovery_id': discovery.pk,
            'role': 'WEARABLE',
            'expected_version': discovery.version,
        }
        cmd_res = self.client.post('/api/v1/commands', cmd_payload, format='json')
        command_id = cmd_res.json()['command_id']

        tampered_body = {'installation_id': INSTALLATION, 'hardware_id': hardware_b, 'boot_nonce': 'a' * 32, 'kind': 'COMMAND_RESULT', 'command_id': command_id, 'node_id': 'NODE-TARGET-A', 'state': 'DEVICE_CONFIRMED'}
        tampered_packet = {'hardware_id': hardware_b, **sign(tampered_body, key_b)}
        res = self.client.post('/api/v1/provision/confirm', tampered_packet, format='json', **self.headers)
        self.assertEqual(res.status_code, 400)
        self.assertFalse(Node.objects.get(node_id='NODE-TARGET-A').commissioned)
        self.assertTrue(DeviceDiscovery.objects.filter(hardware_id=hardware_a).exists())


class BME688AtmosphericTelemetryTests(TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        config = override_settings(
            COMPALLETTE_INSTALLATION_ID=INSTALLATION,
            COMPALLETTE_DEVICE_KEY_DIR=self.directory.name,
        )
        config.enable()
        self.addCleanup(config.disable)
        self.org = Organisation.objects.create(name='BME Org', slug='bme-org')
        self.site = Site.objects.create(organisation=self.org, name='BME Site', code='BMESITE')
        self.operator = get_user_model().objects.create_superuser(username='bme-admin', password='test-only')
        self.client = APIClient()
        self.client.force_authenticate(self.operator)
        gw_node = Node.objects.create(node_id='GW-BME', hardware_id='GWBME01', role='GATEWAY', organisation=self.org, site=self.site, commissioned=True)
        self.gateway = GatewayRegistration.objects.create(node=gw_node, site=self.site, credentials_installed=True, credential_hash=make_password('test-gw-bme-key'))
        self.headers = {'HTTP_X_GATEWAY_ID': gw_node.pk, 'HTTP_X_API_KEY': 'test-gw-bme-key'}
        self.node = Node.objects.create(
            node_id='NODE-BME-1', hardware_id='BMEHW01', role='WEARABLE',
            organisation=self.org, site=self.site, commissioned=True,
            last_seq=10
        )

    def test_bme688_telemetry_updates_node_and_capabilities_short_keys(self):
        packet = {
            'installation_id': INSTALLATION, 'ver': 1, 'type': 'TELEMETRY', 'seq': 11,
            'sender': self.node.node_id, 'role': 'WEARABLE', 'zone': 'UNASSIGNED', 'uptime': 1000,
            'payload': {
                'press': 101325.0,
                'gas_res': 45000,
                'temp': 24.5,
                'hum': 55.0,
                'batt': 3.82,
                'ok': True,
            }
        }
        res = self.client.post('/api/v1/telemetry', packet, format='json', **self.headers)
        self.assertEqual(res.status_code, 200)

        self.node.refresh_from_db()
        self.assertEqual(self.node.latest_pressure, 101325.0)
        self.assertEqual(self.node.latest_gas_resistance, 45000)
        self.assertEqual(self.node.latest_temp, 24.5)
        self.assertEqual(self.node.latest_hum, 55.0)
        self.assertEqual(self.node.last_seq, 11)

        press_cap = DeviceCapability.objects.filter(node=self.node, measurement_key='pressure_pa').first()
        gas_cap = DeviceCapability.objects.filter(node=self.node, measurement_key='gas_resistance_ohm').first()
        self.assertIsNotNone(press_cap)
        self.assertIsNotNone(gas_cap)
        self.assertTrue(MeasurementReading.objects.filter(node=self.node, capability=press_cap, value=101325.0).exists())
        self.assertTrue(MeasurementReading.objects.filter(node=self.node, capability=gas_cap, value=45000).exists())

    def test_bme688_telemetry_updates_node_descriptive_keys(self):
        packet = {
            'installation_id': INSTALLATION, 'ver': 1, 'type': 'TELEMETRY', 'seq': 12,
            'sender': self.node.node_id, 'role': 'WEARABLE', 'zone': 'UNASSIGNED', 'uptime': 1200,
            'payload': {
                'pressure_pa': 98500.0,
                'gas_resistance_ohm': 120000,
                'temp_c': 26.0,
                'humidity_pct': 60.0,
                'battery_v': 3.9,
            }
        }
        res = self.client.post('/api/v1/telemetry', packet, format='json', **self.headers)
        self.assertEqual(res.status_code, 200)

        self.node.refresh_from_db()
        self.assertEqual(self.node.latest_pressure, 98500.0)
        self.assertEqual(self.node.latest_gas_resistance, 120000)

    def test_out_of_order_telemetry_does_not_overwrite_latest_atmospheric_values(self):
        self.node.latest_pressure = 101325.0
        self.node.latest_gas_resistance = 45000
        self.node.last_seq = 20
        self.node.save()

        packet = {
            'installation_id': INSTALLATION, 'ver': 1, 'type': 'TELEMETRY', 'seq': 15,
            'sender': self.node.node_id, 'role': 'WEARABLE', 'zone': 'UNASSIGNED', 'uptime': 500,
            'payload': {
                'press': 95000.0,
                'gas_res': 20000,
                'temp': 20.0,
                'batt': 3.7,
            }
        }
        res = self.client.post('/api/v1/telemetry', packet, format='json', **self.headers)
        self.assertEqual(res.status_code, 200)

        self.node.refresh_from_db()
        self.assertEqual(self.node.latest_pressure, 101325.0)
        self.assertEqual(self.node.latest_gas_resistance, 45000)
        self.assertEqual(self.node.last_seq, 20)

    def test_telemetry_omitting_pressure_preserves_existing_atmospheric_values(self):
        self.node.latest_pressure = 101325.0
        self.node.latest_gas_resistance = 45000
        self.node.last_seq = 10
        self.node.save()

        packet = {
            'installation_id': INSTALLATION, 'ver': 1, 'type': 'TELEMETRY', 'seq': 11,
            'sender': self.node.node_id, 'role': 'WEARABLE', 'zone': 'UNASSIGNED', 'uptime': 1100,
            'payload': {
                'temp': 28.0,
                'hum': 62.0,
                'batt': 3.75,
            }
        }
        res = self.client.post('/api/v1/telemetry', packet, format='json', **self.headers)
        self.assertEqual(res.status_code, 200)

        self.node.refresh_from_db()
        self.assertEqual(self.node.latest_pressure, 101325.0)
        self.assertEqual(self.node.latest_gas_resistance, 45000)
        self.assertEqual(self.node.latest_temp, 28.0)
        self.assertEqual(self.node.last_seq, 11)

    def test_node_serializer_and_api_expose_atmospheric_telemetry(self):
        self.node.latest_pressure = 101500.0
        self.node.latest_gas_resistance = 52000
        self.node.save()

        serializer = NodeSerializer(self.node)
        self.assertEqual(serializer.data['latest_pressure'], 101500.0)
        self.assertEqual(serializer.data['latest_gas_resistance'], 52000)

        res_list = self.client.get(f'/api/v1/nodes?site={self.site.pk}')
        self.assertEqual(res_list.status_code, 200)
        nodes = res_list.json()['nodes']
        node_item = next(n for n in nodes if n['node_id'] == self.node.node_id)
        self.assertEqual(node_item['latest_pressure'], 101500.0)
        self.assertEqual(node_item['latest_gas_resistance'], 52000)

        res_detail = self.client.get(f'/api/v1/nodes/{self.node.node_id}')
        self.assertEqual(res_detail.status_code, 200)
        self.assertEqual(res_detail.json()['node']['latest_pressure'], 101500.0)
        self.assertEqual(res_detail.json()['node']['latest_gas_resistance'], 52000)
