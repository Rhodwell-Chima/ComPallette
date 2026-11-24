from django.test import TestCase, override_settings
from django.conf import settings
from django.contrib.auth.hashers import make_password
from .models import (Organisation, Site, Node, Zone, GatewayRegistration,
    IngestedEvent, LocationObservation, MeasurementReading, DeviceCapability,
    AuditEntry, LocationEvidence)
from .ingestion import ingest


INSTALLATION = '22222222-2222-4222-8222-222222222222'


@override_settings(COMPALLETTE_INSTALLATION_ID=INSTALLATION)
class WireV2AndTrackingTests(TestCase):
    def setUp(self):
        self.org = Organisation.objects.create(name='Tracking Org', slug='tracking-org')
        self.site = Site.objects.create(organisation=self.org, name='Test Mine', code='MINE-1')
        self.zone_north = Zone.objects.create(site=self.site, code='ZONE-NORTH', name='North Drift')
        self.zone_south = Zone.objects.create(site=self.site, code='ZONE-SOUTH', name='South Stope')

        gw_node = Node.objects.create(
            node_id='GW-01', hardware_id='GW_HW_01', role='GATEWAY',
            organisation=self.org, site=self.site, commissioned=True
        )
        self.gateway = GatewayRegistration.objects.create(
            node=gw_node, site=self.site, credentials_installed=True,
            credential_hash=make_password('test-key')
        )

        self.wearable = Node.objects.create(
            node_id='WEAR-01', hardware_id='WEAR_HW_01', role='WEARABLE',
            organisation=self.org, site=self.site, commissioned=True
        )

    def test_direct_anchor_tracking_establishes_current_location(self):
        """G1 & G2: Direct 1-hop stationary anchor link updates wearable to CURRENT location."""
        packet = {
            'installation_id': INSTALLATION,
            'ver': 2,
            'type': 'TELEMETRY',
            'seq': 101,
            'sender': self.wearable.node_id,
            'role': 'WEARABLE',
            'zone': 'ZONE-NORTH',
            'uptime': 5000,
            'anchor': {
                'id': 'ANCHOR-N1',
                'zone': 'ZONE-NORTH',
                'state': 'CURRENT',
                'hop': 1,
                'rssi': -62
            },
            'payload': {
                'temp_c': 24.1,
                'humidity_pct': 52.0,
                'pressure_pa': 101325,
                'gas_resistance_ohm': 55000,
                'batt': 4.10,
                'ok': True
            }
        }
        receipt = ingest(self.gateway, packet)
        self.assertTrue(receipt['recorded'])
        self.wearable.refresh_from_db()
        self.assertEqual(self.wearable.current_zone, 'ZONE-NORTH')
        self.assertEqual(self.wearable.zone_ref, self.zone_north)
        self.assertEqual(self.wearable.location_evidence, LocationEvidence.CURRENT)
        self.assertGreater(self.wearable.location_observed_at, 0)

        obs = LocationObservation.objects.filter(node=self.wearable).latest('received_at')
        self.assertEqual(obs.source, 'DIRECT_ANCHOR')
        self.assertEqual(obs.quality, 'VALID')
        self.assertEqual(obs.zone, self.zone_north)

    def test_multi_hop_relay_never_sets_location(self):
        """Rule: A relay carries messages; its location is never inherited by originating wearable."""
        packet = {
            'installation_id': INSTALLATION,
            'ver': 2,
            'type': 'TELEMETRY',
            'seq': 102,
            'sender': self.wearable.node_id,
            'role': 'WEARABLE',
            'zone': 'ZONE-SOUTH',
            'uptime': 8000,
            'anchor': {
                'id': 'RELAY-W2',
                'zone': 'ZONE-SOUTH',
                'state': 'UNKNOWN',
                'hop': 3,  # Multi-hop mesh relay
                'rssi': -85
            },
            'payload': {
                'temp_c': 22.0,
                'humidity_pct': 50.0,
                'batt': 3.9
            }
        }
        receipt = ingest(self.gateway, packet)
        self.assertTrue(receipt['recorded'])
        self.wearable.refresh_from_db()
        self.assertEqual(self.wearable.location_evidence, LocationEvidence.UNKNOWN)
        self.assertIsNone(self.wearable.zone_ref)

    def test_bme688_environmental_readings_truthful_without_co(self):
        """G3: BME688 environmental channels retain units without fabricated CO values."""
        packet = {
            'installation_id': INSTALLATION,
            'ver': 2,
            'type': 'TELEMETRY',
            'seq': 103,
            'sender': self.wearable.node_id,
            'role': 'WEARABLE',
            'zone': 'ZONE-NORTH',
            'uptime': 12000,
            'payload': {
                'temp_c': 26.5,
                'humidity_pct': 58.3,
                'pressure_pa': 100800,
                'gas_resistance_ohm': 78200,
                'batt': 4.02,
                'battery_pct': 85.0,
                'ok': True
            }
        }
        receipt = ingest(self.gateway, packet)
        self.assertTrue(receipt['recorded'])

        caps = DeviceCapability.objects.filter(node=self.wearable).values_list('measurement_key', flat=True)
        self.assertIn('temperature_c', caps)
        self.assertIn('humidity_pct', caps)
        self.assertIn('pressure_pa', caps)
        self.assertIn('gas_resistance_ohm', caps)
        self.assertNotIn('co_ppm', caps)  # Absolutely no CO capability for BME688!

        readings = MeasurementReading.objects.filter(node=self.wearable)
        reading_keys = set(readings.values_list('measurement_key', flat=True))
        self.assertEqual(reading_keys, {'temperature_c', 'humidity_pct', 'pressure_pa', 'gas_resistance_ohm'})

        p_reading = readings.get(measurement_key='pressure_pa')
        self.assertEqual(p_reading.value, 100800)
        self.assertEqual(p_reading.unit, 'Pa')

        g_reading = readings.get(measurement_key='gas_resistance_ohm')
        self.assertEqual(g_reading.value, 78200)
        self.assertEqual(g_reading.unit, 'Ω')

    def test_transitioning_and_last_known_evidence(self):
        """G1 & G7: Handover transition and expired link degrade location evidence truthfully."""
        # 1. Establish current in North
        packet1 = {
            'installation_id': INSTALLATION, 'ver': 2, 'type': 'TELEMETRY', 'seq': 104,
            'sender': self.wearable.node_id, 'role': 'WEARABLE', 'zone': 'ZONE-NORTH', 'uptime': 20000,
            'anchor': {'id': 'A-N1', 'zone': 'ZONE-NORTH', 'state': 'CURRENT', 'hop': 1, 'rssi': -60},
            'payload': {'temp_c': 24.0, 'batt': 4.0}
        }
        ingest(self.gateway, packet1)
        self.wearable.refresh_from_db()
        self.assertEqual(self.wearable.location_evidence, LocationEvidence.CURRENT)

        # 2. Movement starts: transition to South
        packet2 = {
            'installation_id': INSTALLATION, 'ver': 2, 'type': 'TELEMETRY', 'seq': 105,
            'sender': self.wearable.node_id, 'role': 'WEARABLE', 'zone': 'ZONE-SOUTH', 'uptime': 22000,
            'anchor': {'id': 'A-S1', 'zone': 'ZONE-SOUTH', 'state': 'TRANSITIONING', 'hop': 1, 'rssi': -70},
            'payload': {'temp_c': 24.2, 'batt': 4.0}
        }
        ingest(self.gateway, packet2)
        self.wearable.refresh_from_db()
        self.assertEqual(self.wearable.location_evidence, LocationEvidence.TRANSITIONING)
        self.assertEqual(self.wearable.current_zone, 'ZONE-SOUTH')

        # 3. Connection lost: drops to LAST_KNOWN
        packet3 = {
            'installation_id': INSTALLATION, 'ver': 2, 'type': 'TELEMETRY', 'seq': 106,
            'sender': self.wearable.node_id, 'role': 'WEARABLE', 'zone': 'ZONE-SOUTH', 'uptime': 45000,
            'anchor': {'id': 'A-S1', 'zone': 'ZONE-SOUTH', 'state': 'LAST_KNOWN', 'hop': 1, 'rssi': -88},
            'payload': {'temp_c': 24.3, 'batt': 3.95}
        }
        ingest(self.gateway, packet3)
        self.wearable.refresh_from_db()
        self.assertEqual(self.wearable.location_evidence, LocationEvidence.LAST_KNOWN)

    def test_local_ack_audit_and_separation(self):
        """G4: Physical acknowledge button hold dispatches LOCAL_ACK and records audited evidence."""
        packet = {
            'installation_id': INSTALLATION,
            'ver': 2,
            'type': 'LOCAL_ACK',
            'seq': 107,
            'sender': self.wearable.node_id,
            'role': 'WEARABLE',
            'zone': 'ZONE-NORTH',
            'uptime': 50000,
            'anchor': {'id': 'A-N1', 'zone': 'ZONE-NORTH', 'state': 'CURRENT', 'hop': 1, 'rssi': -60},
            'payload': {
                'cleared_alarms': 1,
                'held_ms': 2000,
                'device_id': self.wearable.node_id
            }
        }
        receipt = ingest(self.gateway, packet)
        self.assertTrue(receipt['recorded'])

        entry = AuditEntry.objects.filter(actor=self.wearable.node_id, action='LOCAL_ALARM_ACKNOWLEDGED').first()
        self.assertIsNotNone(entry)
        self.assertIn('2000 ms', entry.details)
        self.assertEqual(entry.metadata.get('cleared_alarms'), 1)
