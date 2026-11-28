from datetime import timedelta
from uuid import uuid4

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from .models import (
    Asset, AssetCustody, DeviceAssignment, GatewayRegistration, IngestedEvent, LocationObservation,
    Node, Organisation, Personnel, Site, SiteMembership, SiteTransfer, Zone,
)


class AssetWorkflowTests(TestCase):
    def setUp(self):
        self.org = Organisation.objects.create(name='Mining operations', slug='mining-operations')
        self.site = Site.objects.create(organisation=self.org, name='Mining Pilot Site', code='PILOT')
        self.destination = Site.objects.create(organisation=self.org, name='North Site', code='NORTH')
        self.viewer = self.operator('viewer', 'VIEWER')
        self.supervisor = self.operator('supervisor', 'OPERATIONS')
        self.competitor = self.operator('competitor', 'OPERATIONS')
        self.client = APIClient()
        self.client.force_login(self.supervisor)
        self.asset = Asset.objects.create(site=self.site, organisation=self.org, name='Dewatering pump 04',
                                          identifier='PUMP-004', asset_type='Pump')
        self.custodian = Personnel.objects.create(site=self.site, organisation=self.org, display_name='Mwamba Phiri', identifier='PER-0082')
        self.tracker = Node.objects.create(node_id='TAG-014', site=self.site, organisation=self.org,
                                           commissioned=True, is_simulated=False, status='OFFLINE', last_seen_ts=1)
        self.path = f'/api/v1/entities/assets/{self.asset.pk}'

    def operator(self, username, role):
        user = get_user_model().objects.create_user(username=username)
        SiteMembership.objects.create(user=user, site=self.site, organisation=self.org, role=role)
        SiteMembership.objects.create(user=user, site=self.destination, organisation=self.org, role=role)
        return user

    def action(self, action, *, path=None, version=None, operation_id=None, **changes):
        self.asset.refresh_from_db()
        return self.client.post(path or self.path, {
            'action': action, 'expected_version': version or self.asset.version, 'operation_id': operation_id or str(uuid4()), **changes,
        }, format='json')

    def list_assets(self, **params):
        response = self.client.get('/api/v1/assets', {'site_id': self.site.pk, 'page': 1, **params})
        self.assertEqual(response.status_code, 200, response.data)
        return response.json()

    def test_registration_duplicate_and_leading_zero(self):
        registration = '/api/v1/assets'
        fields = {'name': '  Vent pump  ', 'identifier': '  00004  ', 'site': self.site.pk,
                  'asset_type': '', 'operational_status': 'LEGACY_SERVICE', 'assigned_node': self.tracker.pk}
        response = self.client.post(registration, fields, format='json')
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual((response.data['name'], response.data['identifier'], response.data['operational_status']),
                         ('Vent pump', '00004', 'LEGACY_SERVICE'))
        self.assertIsNone(response.data['assigned_node'])
        self.assertIsNone(response.data['custodian'])
        duplicate = self.client.post(registration, {**fields, 'site': self.destination.pk}, format='json')
        self.assertEqual(duplicate.status_code, 400)
        self.assertIn('identifier', duplicate.data)
        self.client.force_login(self.viewer)
        self.assertEqual(self.client.post(registration, fields, format='json').status_code, 403)

    def test_server_pagination_filters_before_order_and_clamps(self):
        Asset.objects.bulk_create([
            Asset(site=self.site, organisation=self.org, name='Same pump', identifier=f'P-{index:03}',
                  asset_type='Pump', operational_status='MAINTENANCE' if index < 10 else 'ACTIVE', archived=index == 54)
            for index in range(55)
        ])
        Asset.objects.create(site=self.destination, organisation=self.org, name='Other pump', identifier='OTHER', asset_type='Pump')
        pages = [self.list_assets(page=page, classification='pump', sort='name', direction='desc') for page in (1, 2, 3)]
        ids = [row['id'] for data in pages for row in data['assets']]
        self.assertEqual([len(data['assets']) for data in pages], [25, 25, 5])
        self.assertEqual(len(ids), len(set(ids)))
        self.assertEqual({data['count'] for data in pages}, {55})
        self.assertEqual(pages[0]['site_total'], 55)
        self.assertEqual(self.list_assets(status='MAINTENANCE', custody='unissued', tracker='unassigned', q='same')['count'], 10)
        self.assertEqual(self.list_assets(archive='archived', page='invalid')['count'], 1)
        self.assertEqual(self.list_assets(page=1000, page_size=50)['page'], 2)
        legacy = self.client.get('/api/v1/assets', {'site': self.site.pk}).json()
        self.assertEqual(set(legacy), {'assets', 'count'})
        self.assertEqual(legacy['count'], 56)

    def test_custody_and_tracker_are_independent_and_replay_is_idempotent(self):
        hidden = Personnel.objects.create(site=self.site, organisation=self.org, display_name='Archived operator',
                                           identifier='ARCHIVED', archived=True)
        eligible = self.client.get('/api/v1/assets/eligible-custodians', {'site_id': self.site.pk, 'q': '0082'}).json()
        self.assertEqual(eligible['personnel'], [{'id': self.custodian.pk, 'display_name': self.custodian.display_name,
                                                  'identifier': self.custodian.identifier}])
        self.assertEqual(self.action('custody', personnel_id=hidden.pk).status_code, 404)
        original = str(uuid4())
        issued = self.action('custody', version=1, operation_id=original, personnel_id=self.custodian.pk)
        self.assertEqual(issued.status_code, 200, issued.data)
        self.assertEqual(self.action('custody', version=1, operation_id=original, personnel_id=self.custodian.pk).data, issued.data)
        self.client.force_login(self.competitor)
        self.assertEqual(self.action('custody', version=1, personnel_id=self.custodian.pk).status_code, 409)
        self.assertEqual(self.action('assign', node_id=self.tracker.pk).status_code, 200)
        competing_asset = Asset.objects.create(site=self.site, organisation=self.org, identifier='COMP', name='Other asset')
        self.assertEqual(self.action('assign', path=f'/api/v1/entities/assets/{competing_asset.pk}', version=1, node_id=self.tracker.pk).status_code, 409)
        self.assertEqual(self.action('edit', changes={'asset_type': '', 'operational_status': 'MAINTENANCE'}).status_code, 200)
        detail = self.client.get(self.path).json()
        self.assertEqual(detail['custodian']['identifier'], self.custodian.identifier)
        self.assertIsNotNone(detail['custodian']['started_at'])
        self.assertEqual(detail['node_id'], self.tracker.pk)
        self.assertEqual(detail['asset_type'], '')
        self.assertEqual(detail['operational_status'], 'MAINTENANCE')
        self.assertEqual(self.list_assets(custody='issued', tracker='assigned')['count'], 1)
        self.assertEqual(self.action('return', relationship_id=detail['current_custody'][0]['id'], reason='Returned').status_code, 200)
        row = self.client.get(self.path).json()
        self.assertIsNone(row['custodian'])
        self.assertEqual(row['node_id'], self.tracker.pk)
        self.assertEqual(self.action('custody', personnel_id=self.custodian.pk).status_code, 200)
        self.assertEqual(self.action('release', relationship_id=row['current_assignments'][0]['id'], reason='Replace battery').status_code, 200)
        row = self.client.get(self.path).json()
        self.assertEqual(row['custodian']['id'], self.custodian.pk)
        self.assertIsNone(row['assigned_node'])
        self.assertEqual(len(row['assignment_history']), 1)
        self.assertEqual(AssetCustody.objects.filter(asset=self.asset).count(), 2)
        person = self.client.get(f'/api/v1/entities/personnel/{self.custodian.pk}').json()
        self.assertEqual(person['custody_history'][0]['asset_identifier'], self.asset.identifier)
        self.assertIsNone(person['custody_history'][0]['ended_at'])

    def test_exact_transfer_and_archive_impact(self):
        preview = lambda: self.client.get(self.path, {'preview_destination': self.destination.pk}).json()
        zero = preview()
        self.assertEqual((zero['assignment_ids'], zero['custody_ids']), ([], []))
        self.assertEqual(self.action('assign', node_id=self.tracker.pk).status_code, 200)
        one = preview()
        self.assertEqual(one['trackers'][0]['node_id'], self.tracker.pk)
        self.assertEqual(one['custody_ids'], [])
        self.assertEqual(self.action('custody', personnel_id=self.custodian.pk).status_code, 200)
        two = preview()
        self.assertEqual(two['custodians'][0]['person_name'], self.custodian.display_name)
        self.assertEqual(self.action('transfer', destination_site=self.destination.pk, reason='Reallocate',
                                     confirmed_relationships={key: one[key] for key in ('assignment_ids', 'custody_ids')}).status_code, 409)
        SiteMembership.objects.filter(user=self.supervisor, site=self.destination).update(role='VIEWER')
        self.assertEqual(self.client.get(self.path, {'preview_destination': self.destination.pk}).status_code, 403)
        self.assertEqual(self.action('transfer', destination_site=self.destination.pk, reason='Reallocate',
                                     confirmed_relationships={key: two[key] for key in ('assignment_ids', 'custody_ids')}).status_code, 403)
        SiteMembership.objects.filter(user=self.supervisor, site=self.destination).update(role='OPERATIONS')
        self.assertEqual(self.action('transfer', destination_site=self.destination.pk, reason='Reallocate',
                                     confirmed_relationships={key: two[key] for key in ('assignment_ids', 'custody_ids')}).status_code, 200)
        self.assertEqual(self.list_assets()['count'], 0)
        new_site = self.client.get(self.path).json()
        self.assertEqual(new_site['site'], self.destination.pk)
        self.assertEqual(new_site['transfer_history'][0]['source_name'], self.site.name)
        self.assertEqual(SiteTransfer.objects.count(), 1)
        self.assertIsNotNone(new_site['assignment_history'][0]['ended_at'])
        self.assertIsNotNone(new_site['custody_history'][0]['ended_at'])
        self.assertIsNone(new_site['current_zone'])
        tracker = Node.objects.create(node_id='DEST-TAG', site=self.destination, organisation=self.org, commissioned=True)
        person = Personnel.objects.create(site=self.destination, organisation=self.org, identifier='P-SITE', display_name='Alternate')
        self.assertEqual(self.action('assign', node_id=tracker.pk).status_code, 200)
        self.assertEqual(self.action('custody', personnel_id=person.pk).status_code, 200)
        archive = self.client.get(self.path, {'preview_archive': 1}).json()
        affected = {key: archive[key] for key in ('assignment_ids', 'custody_ids')}
        self.assertEqual(self.action('archive', reason='End of service', confirmed_relationships=affected).status_code, 200)
        self.assertEqual(self.action('edit', changes={'name': 'Cannot change'}).status_code, 409)
        self.client.force_login(self.viewer)
        detail = self.client.get(self.path).json()
        self.assertTrue(detail['archived'])
        self.assertEqual((detail['current_assignments'], detail['current_custody']), ([], []))
        self.assertEqual(len(detail['assignment_history']), 2)
        self.assertEqual(detail['audit'], [])
        self.assertNotIn('started_actor', detail['assignment_history'][0])
        archived = self.client.get('/api/v1/assets', {'site_id': self.destination.pk, 'page': 1, 'archive': 'archived'}).json()
        self.assertEqual(archived['count'], 1)

    def test_transfer_with_no_relationships_or_only_custody(self):
        for with_custody in (False, True):
            if with_custody:
                self.assertEqual(self.action('custody', personnel_id=self.custodian.pk).status_code, 200)
            preview = self.client.get(self.path, {'preview_destination': self.destination.pk}).json()
            self.assertEqual(preview['assignment_ids'], [])
            self.assertEqual(len(preview['custody_ids']), int(with_custody))
            confirmed = {field: preview[field] for field in ('assignment_ids', 'custody_ids')}
            response = self.action('transfer', destination_site=self.destination.pk, confirmed_relationships=confirmed, reason='Reallocated')
            self.assertEqual(response.status_code, 200, response.data)
            self.assertFalse(AssetCustody.objects.filter(asset=self.asset, ended_at__isnull=True).exists())
            self.assertEqual(self.list_assets()['count'], 0)
            Asset.objects.filter(pk=self.asset.pk).update(site=self.site)

    def test_location_requires_capture_during_current_assignment(self):
        gateway_node = Node.objects.create(node_id='GW', site=self.site, organisation=self.org, role='GATEWAY')
        gateway = GatewayRegistration.objects.create(node=gateway_node, site=self.site, credential_hash='test-only')
        zone = Zone.objects.create(site=self.site, code='HAULAGE', name='Level 2 Haulage')
        old_zone = Zone.objects.create(site=self.site, code='OLD-HAULAGE', name='Earlier location')
        self.assertEqual(self.action('assign', node_id=self.tracker.pk).status_code, 200)
        assignment = DeviceAssignment.objects.get(asset=self.asset)
        DeviceAssignment.objects.filter(pk=assignment.pk).update(started_at=timezone.now() - timedelta(hours=1))
        assignment.refresh_from_db()

        def observation(sequence, captured, zone):
            event = IngestedEvent.objects.create(node=self.tracker, gateway=gateway, site=self.site, event_type='HEARTBEAT',
                                                 sequence=sequence, assignment_at_receipt=assignment, payload={})
            return LocationObservation.objects.create(node=self.tracker, event=event, zone=zone, site=self.site,
                                                      reported_zone=zone.code, captured_at=captured, quality='CONFIRMED')

        observation(1, assignment.started_at - timedelta(minutes=1), old_zone)
        observation(2, None, old_zone)
        for record in (self.list_assets()['assets'][0], self.client.get(self.path).json()):
            self.assertIsNone(record['current_zone'])
            self.assertEqual(record['location_evidence'], 'UNKNOWN')
            self.assertEqual(record['node_status'], 'OFFLINE')
        actual = observation(3, assignment.started_at + timedelta(minutes=1), zone)
        observation(4, None, old_zone)
        for record in (self.list_assets()['assets'][0], self.client.get(self.path).json(),
                       self.client.get(f'/api/v1/assets/{self.asset.pk}').json()):
            self.assertEqual(record['current_zone'], zone.code)
            self.assertEqual(record['location_observed_at'], int(actual.captured_at.timestamp() * 1000))
            self.assertEqual(record['location_evidence'], 'CONFIRMED')
        self.assertEqual(len(self.client.get(self.path).json()['location_observations']), 4)
