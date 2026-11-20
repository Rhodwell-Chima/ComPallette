import uuid
from django.test import TestCase
from django.contrib.auth import get_user_model
from django.contrib.auth.hashers import make_password
from django.db import IntegrityError, transaction
from rest_framework.test import APIClient
from .models import (Organisation, Site, SiteMembership, Node, Personnel, Asset,
    SafetyAlert, GatewayRegistration, IngestedEvent, DeviceAssignment, LocationObservation)
from .operations import mutate, Conflict
from .ingestion import ingest


class PlatformIntegrityTests(TestCase):
    def setUp(self):
        self.org = Organisation.objects.create(name='Isolated test', slug='isolated-test')
        self.a = Site.objects.create(organisation=self.org, name='A', code='A')
        self.b = Site.objects.create(organisation=self.org, name='B', code='B')
        self.operator = get_user_model().objects.create_user(username='operator')
        SiteMembership.objects.create(user=self.operator, organisation=self.org, site=self.a, role='OPERATIONS')
        SiteMembership.objects.create(user=self.operator, organisation=self.org, site=self.b, role='VIEWER')
        self.admin = get_user_model().objects.create_superuser(username='admin', password='isolated-only')
        self.node = Node.objects.create(node_id='TRACK-01', organisation=self.org, site=self.a, commissioned=True)
        self.person = Personnel.objects.create(organisation=self.org, site=self.a, identifier='P1', display_name='Person')
        self.asset = Asset.objects.create(organisation=self.org, site=self.a, identifier='A1', name='Equipment')
        gateway_node = Node.objects.create(node_id='GW-01', role='GATEWAY', organisation=self.org, site=self.a, commissioned=True)
        self.gateway = GatewayRegistration.objects.create(node=gateway_node, site=self.a, credential_hash=make_password('test-key'))
        self.client = APIClient(); self.client.force_authenticate(self.operator)

    def operation(self, action, **kwargs):
        return {'operation_id': str(uuid.uuid4()), 'action': action, 'expected_version': 1, **kwargs}

    def event(self, seq=1):
        return {'ver': 1, 'type': 'HEARTBEAT', 'seq': seq, 'sender': self.node.pk,
                'role': 'WEARABLE', 'zone': 'UNASSIGNED', 'uptime': 10, 'payload': {'heap': 1024, 'batt': 3.7}}

    def test_capabilities_cannot_leak_between_sites(self):
        other = Node.objects.create(node_id='OTHER', site=self.b, organisation=self.org)
        alert = SafetyAlert.objects.create(node=other, site=self.b, seq=1, alert_code='TEST', created_at=1)
        self.assertEqual(self.client.post(f'/api/v1/alerts/{alert.pk}/ack', {}, format='json').status_code, 403)
        alert.refresh_from_db(); self.assertEqual(alert.status, 'NEW')

    def test_staff_without_memberships_has_no_access(self):
        staff = get_user_model().objects.create_user(username='staff', is_staff=True)
        from .access import permitted_sites, operator_capabilities
        self.assertFalse(permitted_sites(staff).exists())
        self.assertEqual(operator_capabilities(staff, self.a), [])

    def test_assignment_exclusivity_and_retry(self):
        payload = self.operation('assign', node_id=self.node.pk)
        first = mutate(self.operator, 'personnel', self.person.pk, payload)
        self.assertEqual(mutate(self.operator, 'personnel', self.person.pk, payload), first)
        with self.assertRaises(Conflict):
            mutate(self.operator, 'assets', self.asset.pk, self.operation('assign', node_id=self.node.pk))
        self.assertEqual(DeviceAssignment.objects.count(), 1)
        with self.assertRaises(IntegrityError), transaction.atomic():
            DeviceAssignment.objects.create(node=self.node, asset=self.asset, site=self.a, started_by=self.operator)

    def test_transfer_preserves_event_site_and_closes_assignment(self):
        mutate(self.operator, 'personnel', self.person.pk, self.operation('assign', node_id=self.node.pk))
        ingest(self.gateway, self.event())
        self.node.refresh_from_db()
        from .operations import preview_transfer
        affected = preview_transfer(self.node, self.b)
        mutate(self.admin, 'devices', self.node.pk, self.operation('transfer', expected_version=self.node.version,
            destination_site=self.b.pk, confirmed_relationships=affected, reason='Relocation'))
        self.assertEqual(IngestedEvent.objects.get().site_id, self.a.pk)
        self.assertIsNotNone(DeviceAssignment.objects.get().ended_at)
        self.node.refresh_from_db(); self.assertEqual(self.node.site_id, self.b.pk)

    def test_heartbeat_keeps_registered_site_and_deduplicates(self):
        first = ingest(self.gateway, self.event())
        second = ingest(self.gateway, self.event())
        self.assertTrue(first['recorded']); self.assertTrue(second['deduplicated'])
        self.node.refresh_from_db(); self.assertEqual(self.node.site_id, self.a.pk)
        self.assertEqual(LocationObservation.objects.count(), 1)
        self.assertEqual(self.node.location_evidence, 'UNKNOWN')

    def test_older_event_does_not_overwrite_live_state(self):
        ingest(self.gateway, self.event(20))
        event = self.event(10); event['payload']['batt'] = 1
        ingest(self.gateway, event)
        self.node.refresh_from_db()
        self.assertEqual(self.node.last_seq, 20); self.assertEqual(self.node.battery_v, 3.7)

    def test_operator_list_works_and_uses_explicit_identity(self):
        self.client.force_authenticate(self.admin)
        response = self.client.get('/api/v1/users', {'site': self.a.pk})
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(response.json()['users'][0]['assigned_personnel_id'])

    def test_read_only_site_cannot_mutate_entity(self):
        self.asset.site = self.b; self.asset.save()
        from rest_framework.exceptions import PermissionDenied
        with self.assertRaises(PermissionDenied):
            mutate(self.operator, 'assets', self.asset.pk, self.operation('edit', changes={'name': 'Changed'}))

    def test_membership_cannot_escalate_or_demote_admin(self):
        SiteMembership.objects.filter(user=self.operator, site=self.a).update(role='ORG_ADMIN')
        other = get_user_model().objects.create_user(username='other')
        url = f'/api/v1/access/memberships?site={self.a.pk}'
        self.assertEqual(self.client.post(url, {'username': other.username, 'role': 'ORG_ADMIN'}, format='json').status_code, 403)
        SiteMembership.objects.create(user=other, site=self.a, organisation=self.org, role='ORG_ADMIN')
        self.assertEqual(self.client.post(url, {'username': other.username, 'role': 'VIEWER'}, format='json').status_code, 403)
        self.assertEqual(SiteMembership.objects.get(user=other).role, 'ORG_ADMIN')

    def test_site_creation_requires_authority_in_target_organisation(self):
        SiteMembership.objects.filter(user=self.operator, site=self.a).update(role='ORG_ADMIN')
        foreign = Organisation.objects.create(name='Foreign', slug='foreign')
        foreign_site = Site.objects.create(organisation=foreign, name='Foreign', code='FOREIGN')
        SiteMembership.objects.create(user=self.operator, organisation=foreign, site=foreign_site, role='VIEWER')
        response = self.client.post(f'/api/v1/sites?site={self.a.pk}', {'organisation': foreign.pk, 'name': 'Forbidden', 'code': 'BAD'}, format='json')
        self.assertEqual(response.status_code, 403)
        self.assertFalse(Site.objects.filter(code='BAD').exists())

    def test_account_patch_works_on_postgres(self):
        self.client.force_authenticate(self.admin)
        response = self.client.patch(f'/api/v1/users/{self.operator.pk}?site={self.a.pk}', {'role': 'SAFETY'}, format='json')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(SiteMembership.objects.get(user=self.operator, site=self.a).role, 'SAFETY')

    def test_layout_version_and_foreign_zone_validation(self):
        from .models import FacilityLayout, Zone
        self.client.force_authenticate(self.admin)
        url = f'/api/v1/sites/{self.a.pk}/layout'
        self.assertEqual(self.client.get(url).json()['version'], 0)
        self.assertFalse(FacilityLayout.objects.filter(site=self.a).exists())
        zone = Zone.objects.create(site=self.b, name='Foreign', code='FOREIGN')
        geometry = {'features': [{'id': 'stable-feature', 'properties': {'zone_id': zone.pk}}]}
        self.assertEqual(self.client.put(url, {'geometry': geometry, 'expected_version': 0}, format='json').status_code, 400)
        data = {'geometry': {'features': []}, 'expected_version': 0}
        self.assertEqual(self.client.put(url, data, format='json').status_code, 200)
        self.assertEqual(self.client.put(url, data, format='json').status_code, 409)
        self.assertEqual(FacilityLayout.objects.get(site=self.a).version, 1)

    def test_gateway_id_cannot_contain_topic_wildcards(self):
        self.client.force_authenticate(self.admin)
        response = self.client.post('/api/v1/gateways', {'site': self.a.pk, 'node_id': 'bad/+#', 'hardware_id': 'HW1'}, format='json')
        self.assertEqual(response.status_code, 400)
        self.assertFalse(Node.objects.filter(pk='bad/+#').exists())

    def test_watchdog_preserves_site_and_records_recurring_loss(self):
        from .views import check_and_update_watchdog
        Node.objects.filter(pk=self.node.pk).update(status='ONLINE', last_seen_ts=1)
        check_and_update_watchdog()
        first = SafetyAlert.objects.get(node=self.node, alert_code='COMM_LOST')
        self.assertEqual(first.site_id, self.a.pk)
        check_and_update_watchdog()
        self.assertEqual(SafetyAlert.objects.filter(node=self.node).count(), 1)
        first.status = 'RESOLVED'; first.save()
        Node.objects.filter(pk=self.node.pk).update(status='ONLINE', last_seen_ts=2)
        check_and_update_watchdog()
        self.assertEqual(SafetyAlert.objects.filter(node=self.node).count(), 2)
        self.assertFalse(SafetyAlert.objects.filter(node=self.gateway.node).exists())

    def test_invalid_command_id_is_validation_error(self):
        from .commands import command_result
        from rest_framework.exceptions import ValidationError
        with self.assertRaises(ValidationError):
            command_result(self.gateway, {'command_id': 'invalid'})

    def test_transferred_device_hides_history_from_other_site(self):
        ingest(self.gateway, self.event())
        Node.objects.filter(pk=self.node.pk).update(site=self.b)
        viewer = get_user_model().objects.create_user(username='destination-viewer')
        SiteMembership.objects.create(user=viewer, organisation=self.org, site=self.b, role='VIEWER')
        self.client.force_authenticate(viewer)
        response = self.client.get(f'/api/v1/entities/devices/{self.node.pk}')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['location_observations'], [])

    def test_long_entity_name_returns_400_without_mutation(self):
        response = self.client.post(f'/api/v1/entities/personnel/{self.person.pk}', self.operation('edit', changes={'display_name': 'x' * 121}), format='json')
        self.assertEqual(response.status_code, 400)
        self.person.refresh_from_db()
        self.assertEqual(self.person.display_name, 'Person')

    def test_viewer_cannot_read_audit_endpoint(self):
        response = self.client.get(f'/api/v1/audit?site={self.b.pk}')
        self.assertEqual(response.status_code, 403)

    def test_explicit_account_link_never_matches_a_name(self):
        same_name = get_user_model().objects.create_user(username='same-name', first_name='Person')
        SiteMembership.objects.create(user=same_name, organisation=self.org, site=self.a, role='VIEWER')
        self.person.refresh_from_db(); self.assertIsNone(self.person.user_id)
        result = mutate(self.admin, 'personnel', self.person.pk, self.operation('link_user', user_id=same_name.pk))
        self.person.refresh_from_db(); self.assertEqual(self.person.user_id, same_name.pk)
        self.assertEqual(result['status'], 'ok')

    def test_password_reset_requires_explicit_password(self):
        self.client.force_authenticate(self.admin)
        url = f'/api/v1/users/{self.operator.pk}/reset-password?site={self.a.pk}'
        self.assertEqual(self.client.post(url, {}, format='json').status_code, 400)
        self.assertEqual(self.client.post(url, {'password': 'Isolated-only-strong-Secret-2937'}, format='json').status_code, 200)
        self.operator.refresh_from_db()
        self.assertTrue(self.operator.check_password('Isolated-only-strong-Secret-2937'))

    def test_late_command_result_is_recorded_without_reviving_command(self):
        from .models import DeviceCommand, AuditEntry
        from .commands import command_result
        from django.utils import timezone
        from datetime import timedelta
        command = DeviceCommand.objects.create(gateway=self.gateway, node=self.node, actor=self.admin,
            kind='DIAGNOSTIC', expires_at=timezone.now() - timedelta(seconds=1))
        message = {'command_id': str(command.pk), 'node_id': self.node.pk, 'hardware_id': self.node.hardware_id, 'state': 'DEVICE_CONFIRMED'}
        first = command_result(self.gateway, message)
        second = command_result(self.gateway, message)
        self.assertEqual(first, second)
        self.assertEqual(first['state'], 'EXPIRED')
        self.assertEqual(first['received_state'], 'DEVICE_CONFIRMED')
        self.assertEqual(AuditEntry.objects.filter(action='COMMAND_RESULT').count(), 1)


from django.test import TransactionTestCase
from django.db import connection, close_old_connections
from unittest import skipUnless
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier


@skipUnless(connection.vendor == 'postgresql', 'Row-lock concurrency requires PostgreSQL')
class AssignmentConcurrencyTests(TransactionTestCase):
    def test_simultaneous_checkout_has_one_winner(self):
        org = Organisation.objects.create(name='Concurrency', slug='concurrency')
        site = Site.objects.create(organisation=org, name='Concurrency', code='TEST')
        node = Node.objects.create(node_id='SHARED', site=site, organisation=org, commissioned=True)
        people = [Personnel.objects.create(organisation=org, site=site, identifier=f'P{i}', display_name=f'P{i}') for i in range(2)]
        users = [get_user_model().objects.create_user(username=f'op{i}') for i in range(2)]
        for user in users: SiteMembership.objects.create(user=user, site=site, organisation=org, role='OPERATIONS')
        barrier = Barrier(2)
        def checkout(i):
            close_old_connections()
            try:
                barrier.wait(timeout=10)
                mutate(users[i], 'personnel', people[i].pk, {'operation_id': str(uuid.uuid4()),
                    'expected_version': 1, 'action': 'assign', 'node_id': node.pk})
                return 'ok'
            except Conflict:
                return 'conflict'
            finally:
                close_old_connections()
        with ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(checkout, range(2)))
        self.assertCountEqual(results, ['ok', 'conflict'])
        self.assertEqual(DeviceAssignment.objects.filter(ended_at__isnull=True).count(), 1)
