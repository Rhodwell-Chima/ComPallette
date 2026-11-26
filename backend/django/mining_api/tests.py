import json
import time
import tempfile
from io import StringIO
from django.test import TestCase, override_settings
from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.management import call_command
from rest_framework.test import APIClient
from rest_framework import status
from .models import (
    Node, NodeRole, NodeStatus, TelemetryRecord, SafetyAlert, AlertSeverity,
    AlertStatus, AuditEntry, ProvisioningRequest, ProvisioningStatus, MeasurementReading,
    Site, LocationEvidence, Zone, SiteMembership, MembershipRole,
)
from .views import check_and_update_watchdog


@override_settings(COMPALLETTE_INSTALLATION_ID='00000000-0000-4000-8000-000000000001')
class MiningApiTests(TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        config = override_settings(COMPALLETTE_DEVICE_KEY_DIR=self.directory.name)
        config.enable()
        self.addCleanup(config.disable)
        self.client = APIClient()
        self.api_key = 'isolated-test-gateway-key-at-least-32-characters'
        self.auth_headers = {'HTTP_X_API_KEY': self.api_key}
        self.operator = get_user_model().objects.create_user(username='test-operator', password='test-password', is_staff=True)
        self.client.force_authenticate(user=self.operator)
        self.site = Site.objects.get(code='MINING-PILOT')
        self.operator.is_superuser = True
        self.operator.save()
        from .models import GatewayRegistration
        from django.contrib.auth.hashers import make_password
        gateway_node = Node.objects.create(node_id='GW-SURFACE-01', role='GATEWAY', site=self.site, organisation=self.site.organisation, commissioned=True)
        self.gateway = GatewayRegistration.objects.create(credentials_installed=True, node=gateway_node, site=self.site, credential_hash=make_password(self.api_key))
        self.auth_headers['HTTP_X_GATEWAY_ID'] = gateway_node.pk


    def test_operator_reads_and_actions_require_authentication(self):
        anonymous = APIClient()
        self.assertEqual(anonymous.get('/api/v1/nodes').status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertEqual(anonymous.get('/api/v1/provision/pending').status_code, status.HTTP_401_UNAUTHORIZED)
        self.assertEqual(anonymous.post('/api/v1/provision/assign', {}, format='json').status_code, status.HTTP_401_UNAUTHORIZED)

    def test_operator_session_login_requires_csrf_and_sets_session(self):
        client = APIClient(enforce_csrf_checks=True)
        csrf_response = client.get('/api/v1/auth/csrf')
        token = csrf_response.json()['csrfToken']
        login_response = client.post(
            '/api/v1/auth/session', {'username': 'test-operator', 'password': 'test-password'},
            format='json', HTTP_X_CSRFTOKEN=token,
        )
        self.assertEqual(login_response.status_code, status.HTTP_200_OK)
        self.assertTrue(client.get('/api/v1/auth/session').json()['authenticated'])

        self.assertEqual(client.get('/api/v1/system/summary').status_code, status.HTTP_200_OK)
        self.assertEqual(client.get('/api/v1/nodes').status_code, status.HTTP_200_OK)
        self.assertEqual(client.get('/api/v1/provision/pending').status_code, status.HTTP_200_OK)

        client.logout()
        self.assertEqual(client.get('/api/v1/nodes').status_code, status.HTTP_401_UNAUTHORIZED)

    def test_site_member_can_log_in_without_django_staff_flag(self):
        member = get_user_model().objects.create_user(username='site-viewer', password='viewer-password')
        SiteMembership.objects.create(
            user=member,
            organisation=self.site.organisation,
            site=self.site,
            role=MembershipRole.VIEWER,
        )
        client = APIClient(enforce_csrf_checks=True)
        token = client.get('/api/v1/auth/csrf').json()['csrfToken']
        response = client.post(
            '/api/v1/auth/session', {'username': 'site-viewer', 'password': 'viewer-password'},
            format='json', HTTP_X_CSRFTOKEN=token,
        )
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertIn('view', response.json()['capabilities'])
        self.assertFalse(response.json()['is_staff'])

    def test_wire_envelope_rejects_wrong_type_and_invalid_values(self):
        invalid = {
            "installation_id": settings.COMPALLETTE_INSTALLATION_ID, "ver": 1, "type": "HEARTBEAT", "seq": 0, "sender": "MINER-INVALID",
            "role": "UNKNOWN", "zone": "LEVEL-1", "uptime": 1, "payload": {},
        }
        response = self.client.post('/api/v1/telemetry', invalid, format='json', **self.auth_headers)
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.json()['error_code'], 'VALIDATION_ERROR')

    def test_gateway_heartbeat_wire_format_is_accepted(self):
        payload = {
            "installation_id": settings.COMPALLETTE_INSTALLATION_ID, "ver": 1,
            "type": "HEARTBEAT",
            "seq": 2,
            "sender": "GW-SURFACE-01",
            "role": "GATEWAY",
            "zone": "UNASSIGNED",
            "uptime": 15000,
            "payload": {"heap": 207544, "nodes": 1, "batt": 3.70},
        }
        response = self.client.post('/api/v1/heartbeat', payload, format='json', **self.auth_headers)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.json()['node_id'], 'GW-SURFACE-01')

    def test_operator_identity_is_taken_from_session_not_request_body(self):
        alert = SafetyAlert.objects.create(
            site=self.site, node=Node.objects.create(node_id='MINER-AUTH', last_seen_ts=int(time.time() * 1000), organisation=self.site.organisation, site=self.site),
            alert_code='TEST', created_at=int(time.time() * 1000),
        )
        response = self.client.post(f'/api/v1/alerts/{alert.id}/ack', {'officer_name': 'forged'}, format='json')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        alert.refresh_from_db()
        self.assertEqual(alert.acknowledged_by, 'test-operator')

    def test_health_check(self):
        response = self.client.get('/api/v1/health')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        data = response.json()
        self.assertEqual(data['status'], 'healthy')
        self.assertEqual(data['service'], 'Compallette Mining Safety Django Backend')
        self.assertEqual(data['build_revision'], settings.COMPALLETTE_BUILD_REVISION)

    @override_settings(COMPALLETTE_BUILD_REVISION='test-build')
    def test_deployment_readiness_accepts_migrated_database_with_staff_operator(self):
        output = StringIO()
        with tempfile.TemporaryDirectory() as directory, override_settings(COMPALLETTE_DEVICE_KEY_DIR=directory):
            call_command('check_deployment_readiness', stdout=output)
        report = json.loads(output.getvalue())
        self.assertTrue(report['ready'])
        self.assertGreaterEqual(report['active_staff_operators'], 1)

    def test_unauthorized_ingest_rejected(self):
        # Missing API Key
        response = self.client.post('/api/v1/telemetry', {}, format='json')
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

        # Invalid API Key
        response = self.client.post('/api/v1/telemetry', {}, format='json', HTTP_X_API_KEY='wrong-key')
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_telemetry_ingest_and_deduplication(self):
        Node.objects.create(node_id='MINER-106', role='WEARABLE', site=self.site, organisation=self.site.organisation, commissioned=True)
        payload = {
            "installation_id": settings.COMPALLETTE_INSTALLATION_ID, "ver": 1,
            "type": "TELEMETRY",
            "seq": 101,
            "sender": "MINER-106",
            "role": "WEARABLE",
            "zone": "LEVEL-250-SOUTH",
            "uptime": 45000,
            "payload": {
                "co": 18.5,
                "temp": 28.2,
                "hum": 74.0,
                "fall": False,
                "batt": 4.12,
                "sim": True,
                "ok": True
            }
        }

        # First ingest
        res1 = self.client.post('/api/v1/telemetry', payload, format='json', **self.auth_headers)
        self.assertEqual(res1.status_code, status.HTTP_200_OK)
        body1 = res1.json()
        self.assertTrue(body1['recorded'])
        self.assertFalse(body1['deduplicated'])

        # Verify Node model updated
        node = Node.objects.get(node_id="MINER-106")
        self.assertEqual(node.current_zone, "UNASSIGNED")
        self.assertEqual(node.latest_co, 18.5)
        self.assertEqual(node.status, NodeStatus.ONLINE)

        # Duplicate ingest with same seq
        res2 = self.client.post('/api/v1/telemetry', payload, format='json', **self.auth_headers)
        self.assertEqual(res2.status_code, status.HTTP_200_OK)
        body2 = res2.json()
        self.assertFalse(body2['recorded'])
        self.assertTrue(body2['deduplicated'])

        # Ensure only 1 record created in database
        self.assertEqual(TelemetryRecord.objects.filter(node=node).count(), 1)

    def test_legacy_telemetry_without_restart_safe_identity_is_rejected(self):
        legacy_packet = {
            "miner_id": "MINER-LEGACY-01",
            "co": 12.0,
            "fall": False
        }
        res = self.client.post('/api/v1/telemetry', legacy_packet, format='json', **self.auth_headers)
        self.assertEqual(res.status_code, status.HTTP_400_BAD_REQUEST)

    def test_alert_lifecycle(self):
        Node.objects.create(node_id='MINER-107', role='WEARABLE', site=self.site, organisation=self.site.organisation, commissioned=True)
        # Ingest an alert
        alert_payload = {
            "installation_id": settings.COMPALLETTE_INSTALLATION_ID, "ver": 1,
            "type": "ALERT",
            "seq": 201,
            "sender": "MINER-107",
            "role": "WEARABLE",
            "zone": "STOPE-4B",
            "uptime": 90000,
            "payload": {
                "severity": "CRITICAL",
                "code": "GAS_CO_CRITICAL",
                "val": 58.4,
                "details": "Carbon monoxide concentration exceeded 50 ppm threshold"
            }
        }
        res = self.client.post('/api/v1/alert', alert_payload, format='json', **self.auth_headers)
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        alert_id = res.json()['alert_id']

        # Verify alert exists in database
        alert = SafetyAlert.objects.get(id=alert_id)
        self.assertEqual(alert.severity, AlertSeverity.CRITICAL)
        self.assertEqual(alert.status, AlertStatus.NEW)

        # Acknowledge alert
        ack_res = self.client.post(f'/api/v1/alerts/{alert_id}/acknowledge', {'officer': 'SAFETY-OFFICER-MUTALE'}, format='json')
        self.assertEqual(ack_res.status_code, status.HTTP_200_OK)
        alert.refresh_from_db()
        self.assertEqual(alert.status, AlertStatus.ACKNOWLEDGED)
        self.assertEqual(alert.acknowledged_by, 'test-operator')

        # Resolve alert
        res_res = self.client.post(f'/api/v1/alerts/{alert_id}/resolve', {
            'officer': 'SAFETY-OFFICER-MUTALE',
            'notes': 'Ventilation fan #4 re-engaged, air cleared to 8 ppm'
        }, format='json')
        self.assertEqual(res_res.status_code, status.HTTP_200_OK)
        alert.refresh_from_db()
        self.assertEqual(alert.status, AlertStatus.RESOLVED)
        self.assertEqual(alert.resolved_by, 'test-operator')

        # Check audit log records
        actions = list(AuditEntry.objects.values_list('action', flat=True))
        self.assertIn('ALERT_TRIGGERED', actions)
        self.assertIn('ALERT_ACKNOWLEDGED', actions)
        self.assertIn('ALERT_RESOLVED', actions)

    def test_resolution_requires_operator_authored_notes(self):
        node = Node.objects.create(node_id='RESOLUTION-TEST', site=self.site)
        alert = SafetyAlert.objects.create(site=self.site, node=node, alert_code='TEST', created_at=1)
        before = AuditEntry.objects.count()
        for body in ({}, {'notes': None}, {'notes': 12}, {'notes': []}, {'notes': {}}, {'notes': ''}, {'notes': '  \n\t'}):
            with self.subTest(body=body):
                response = self.client.post(f'/api/v1/alerts/{alert.id}/resolve', body, format='json')
                self.assertEqual(response.status_code, 400)
                self.assertEqual(response.json(), {'error': 'Resolution notes are required.'})
                alert.refresh_from_db()
                self.assertEqual(alert.status, AlertStatus.NEW)
                self.assertIsNone(alert.resolved_at)
                self.assertEqual(alert.resolution_notes, '')
                self.assertEqual(AuditEntry.objects.count(), before)
        response = self.client.post(f'/api/v1/alerts/{alert.id}/resolve', {'notes': '  Ventilation checked; reading verified.  '}, format='json')
        self.assertEqual(response.status_code, 200)
        alert.refresh_from_db()
        self.assertEqual(alert.resolution_notes, 'Ventilation checked; reading verified.')
        self.assertEqual(alert.resolved_by, self.operator.username)
        self.assertEqual(alert.status, AlertStatus.RESOLVED)
        self.assertEqual(AuditEntry.objects.filter(action='ALERT_RESOLVED', site=self.site).count(), 1)

    def test_heartbeat_and_watchdog(self):
        Node.objects.create(node_id='ANCHOR-02', role='ANCHOR', site=self.site, organisation=self.site.organisation, commissioned=True)
        # Ingest heartbeat
        hb = {
            "installation_id": settings.COMPALLETTE_INSTALLATION_ID, "ver": 1,
            "type": "HEARTBEAT",
            "seq": 5,
            "sender": "ANCHOR-02",
            "role": "ANCHOR",
            "zone": "LEVEL-100-WEST",
            "uptime": 60000,
            "payload": {
                "batt": 4.15,
                "free_heap": 184000
            }
        }
        res = self.client.post('/api/v1/heartbeat', hb, format='json', **self.auth_headers)
        self.assertEqual(res.status_code, status.HTTP_200_OK)

        node = Node.objects.get(node_id="ANCHOR-02")
        self.assertEqual(node.status, NodeStatus.ONLINE)

        # Force node to be stale (> 15s ago)
        node.last_seen_ts = int((time.time() - 25) * 1000)
        node.save()

        check_and_update_watchdog()
        node.refresh_from_db()
        self.assertEqual(node.status, NodeStatus.STALE)

        # Force node to be offline (> 45s ago)
        node.last_seen_ts = int((time.time() - 60) * 1000)
        node.save()

        check_and_update_watchdog()
        node.refresh_from_db()
        self.assertEqual(node.status, NodeStatus.OFFLINE)

        # Verify COMM_LOST alert auto-generated
        comm_alert = SafetyAlert.objects.filter(node=node, alert_code='COMM_LOST').first()
        self.assertIsNotNone(comm_alert)

    def test_system_summary_kpis(self):
        # Populate miner in gas warning
        Node.objects.create(
            node_id="MINER-DANGER",
            role=NodeRole.WEARABLE,
            current_zone="LEVEL-450-NORTH",
            last_seen_ts=int(time.time() * 1000),
            status=NodeStatus.ONLINE,
            latest_co=35.0, # Warning >= 25
            organisation=self.site.organisation,
            site=self.site,
        )

        res = self.client.get('/api/v1/system/summary')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        data = res.json()
        self.assertGreaterEqual(data['online_miners'], 1)
        self.assertGreaterEqual(data['miners_in_gas_warning'], 1)

    def test_dynamic_provisioning_flow(self):
        import uuid
        from .models import DeviceDiscovery
        from .commands import command_result
        packet = {'installation_id': settings.COMPALLETTE_INSTALLATION_ID, 'ver': 1, 'type': 'PROV_REQ', 'seq': 1, 'sender': 'NEW-CHIP', 'role': 'UNASSIGNED',
                  'zone': 'UNASSIGNED', 'uptime': 1, 'payload': {'chip_id': '8F4C2A'}}
        response = self.client.post('/api/v1/provision/request', packet, format='json', **self.auth_headers)
        self.assertEqual(response.status_code, 200)
        discovery = DeviceDiscovery.objects.get(hardware_id='8F4C2A')
        response = self.client.post('/api/v1/commands', {'operation_id': str(uuid.uuid4()), 'gateway_id': self.gateway.pk,
            'discovery_id': discovery.pk, 'expected_version': discovery.version, 'kind': 'PROVISION', 'node_id': 'NEW-TRACKER', 'role': 'WEARABLE'}, format='json')
        self.assertEqual(response.status_code, 201)
        node = Node.objects.get(pk='NEW-TRACKER')
        self.assertFalse(node.commissioned)
        self.assertEqual(node.status, 'OFFLINE')
        command_result(self.gateway, {'command_id': response.json()['command_id'], 'node_id': node.pk,
            'hardware_id': '8F4C2A', 'state': 'DEVICE_CONFIRMED'})
        node.refresh_from_db()
        self.assertTrue(node.commissioned)
        self.assertEqual(node.location_evidence, 'UNKNOWN')

    def test_industrial_operator_views_use_persisted_site_data(self):
        Node.objects.create(node_id='MINER-PLATFORM', role='WEARABLE', site=self.site, organisation=self.site.organisation, commissioned=True)
        Zone.objects.create(site=self.site, code='LEVEL-1-STATION', name='Level 1 Station')
        payload = {
            "installation_id": settings.COMPALLETTE_INSTALLATION_ID, "ver": 1, "type": "TELEMETRY", "seq": 901, "sender": "MINER-PLATFORM",
            "role": "WEARABLE", "zone": "LEVEL-1-STATION", "uptime": 1000,
            "payload": {"co": 12.5, "temp": 25.4, "hum": 62.0, "fall": False, "batt": 3.9, "sim": False, "ok": True},
        }
        response = self.client.post('/api/v1/telemetry', payload, format='json', **self.auth_headers)
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        node = Node.objects.get(node_id='MINER-PLATFORM')
        self.assertEqual(node.site, self.site)
        self.assertEqual(node.location_evidence, LocationEvidence.UNKNOWN)
        self.assertEqual(MeasurementReading.objects.filter(node=node).count(), 3)

        environment = self.client.get(f'/api/v1/environment/overview?site={self.site.id}')
        self.assertEqual(environment.status_code, status.HTTP_200_OK)
        self.assertEqual({channel['measurement_key'] for channel in environment.json()['channels']}, {'co_ppm', 'temperature_c', 'humidity_pct'})

        twin = self.client.get(f'/api/v1/digital-twin?site={self.site.id}')
        self.assertEqual(twin.status_code, status.HTTP_200_OK)
        self.assertEqual(twin.json()['topology'], [])
        self.assertEqual(twin.json()['topology_status'], 'UNAVAILABLE_PENDING_VALIDATED_DIRECT_LINK_EVIDENCE')

    def test_alert_can_be_assigned_with_authenticated_actor_attribution(self):
        node = Node.objects.create(node_id='MINER-ASSIGN', organisation=self.site.organisation, site=self.site, last_seen_ts=int(time.time() * 1000))
        alert = SafetyAlert.objects.create(site=self.site, node=node, alert_code='CHECK', created_at=int(time.time() * 1000))
        response = self.client.post(f'/api/v1/alerts/{alert.id}/assign', {'notes': 'Investigating ventilation.'}, format='json')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        alert.refresh_from_db()
        self.assertEqual(alert.status, AlertStatus.INVESTIGATING)
        self.assertEqual(alert.assigned_to, self.operator)
        self.assertTrue(AuditEntry.objects.filter(action='ALERT_ASSIGNED', site=self.site).exists())
