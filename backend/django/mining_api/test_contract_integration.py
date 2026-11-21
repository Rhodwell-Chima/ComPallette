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
from .models import Organisation, Site, SiteMembership, Node, GatewayRegistration, DeviceDiscovery, DeviceCommand, QuarantinedEvent, AuditEntry
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
