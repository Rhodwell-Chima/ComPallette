import json
import time
from django.test import TestCase
from django.conf import settings
from rest_framework.test import APIClient
from rest_framework import status
from .models import (
    Node, NodeRole, NodeStatus, TelemetryRecord, SafetyAlert, AlertSeverity,
    AlertStatus, AuditEntry, ProvisioningRequest, ProvisioningStatus
)


class MiningApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.api_key = settings.COMPALLETTE_API_KEY
        self.auth_headers = {'HTTP_X_API_KEY': self.api_key}

    def test_health_check(self):
        response = self.client.get('/api/v1/health')
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        data = response.json()
        self.assertEqual(data['status'], 'healthy')
        self.assertEqual(data['service'], 'Compallette Mining Safety Django Backend')

    def test_unauthorized_ingest_rejected(self):
        # Missing API Key
        response = self.client.post('/api/v1/telemetry', {}, format='json')
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

        # Invalid API Key
        response = self.client.post('/api/v1/telemetry', {}, format='json', HTTP_X_API_KEY='wrong-key')
        self.assertEqual(response.status_code, status.HTTP_401_UNAUTHORIZED)

    def test_telemetry_ingest_and_deduplication(self):
        payload = {
            "ver": 1,
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
        self.assertEqual(node.current_zone, "LEVEL-250-SOUTH")
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

    def test_legacy_telemetry_ingest(self):
        legacy_packet = {
            "miner_id": "MINER-LEGACY-01",
            "co": 12.0,
            "fall": False
        }
        res = self.client.post('/api/v1/telemetry', legacy_packet, format='json', **self.auth_headers)
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        self.assertTrue(res.json()['recorded'])

        node = Node.objects.get(node_id="MINER-LEGACY-01")
        self.assertEqual(node.latest_co, 12.0)

    def test_alert_lifecycle(self):
        # Ingest an alert
        alert_payload = {
            "ver": 1,
            "type": "ALERT",
            "seq": 201,
            "sender": "MINER-107",
            "role": "WEARABLE",
            "zone": "STOPE-4B",
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
        self.assertEqual(alert.acknowledged_by, 'SAFETY-OFFICER-MUTALE')

        # Resolve alert
        res_res = self.client.post(f'/api/v1/alerts/{alert_id}/resolve', {
            'officer': 'SAFETY-OFFICER-MUTALE',
            'notes': 'Ventilation fan #4 re-engaged, air cleared to 8 ppm'
        }, format='json')
        self.assertEqual(res_res.status_code, status.HTTP_200_OK)
        alert.refresh_from_db()
        self.assertEqual(alert.status, AlertStatus.RESOLVED)
        self.assertEqual(alert.resolved_by, 'SAFETY-OFFICER-MUTALE')

        # Check audit log records
        actions = list(AuditEntry.objects.values_list('action', flat=True))
        self.assertIn('ALERT_TRIGGERED', actions)
        self.assertIn('ALERT_ACKNOWLEDGED', actions)
        self.assertIn('ALERT_RESOLVED', actions)

    def test_heartbeat_and_watchdog(self):
        # Ingest heartbeat
        hb = {
            "ver": 1,
            "type": "HEARTBEAT",
            "seq": 5,
            "sender": "ANCHOR-02",
            "role": "ANCHOR",
            "zone": "LEVEL-100-WEST",
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

        # Query summary (which triggers watchdog pass)
        sum_res = self.client.get('/api/v1/system/summary')
        self.assertEqual(sum_res.status_code, status.HTTP_200_OK)
        node.refresh_from_db()
        self.assertEqual(node.status, NodeStatus.STALE)

        # Force node to be offline (> 45s ago)
        node.last_seen_ts = int((time.time() - 60) * 1000)
        node.save()

        # Query summary again
        sum_res = self.client.get('/api/v1/system/summary')
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
            latest_co=35.0 # Warning >= 25
        )

        res = self.client.get('/api/v1/system/summary')
        self.assertEqual(res.status_code, status.HTTP_200_OK)
        data = res.json()
        self.assertGreaterEqual(data['online_miners'], 1)
        self.assertGreaterEqual(data['miners_in_gas_warning'], 1)

    def test_dynamic_provisioning_flow(self):
        # 1. Gateway forwards PROV_REQ from uncommissioned chip
        prov_pkt = {
            "ver": 1,
            "type": "PROV_REQ",
            "seq": 1,
            "sender": "PROV-8F4C2A",
            "role": "UNASSIGNED",
            "zone": "UNASSIGNED",
            "uptime": 12000,
            "payload": {
                "chip_mac": "24:6F:28:8F:4C:2A",
                "chip_id": "8F4C2A",
                "mesh_id": 2408359146,
                "fw_ver": "1.1.0",
                "batt": 3.92,
                "mq_ok": True,
                "mpu_ok": True
            }
        }
        res_req = self.client.post('/api/v1/provision/request', prov_pkt, format='json', **self.auth_headers)
        self.assertEqual(res_req.status_code, status.HTTP_200_OK)
        self.assertEqual(res_req.json()['chip_id'], '8F4C2A')

        # 2. Query pending unassigned nodes for dashboard UI
        res_pending = self.client.get('/api/v1/provision/pending')
        self.assertEqual(res_pending.status_code, status.HTTP_200_OK)
        pending_list = res_pending.json()['pending_nodes']
        self.assertEqual(len(pending_list), 1)
        self.assertEqual(pending_list[0]['chip_id'], '8F4C2A')
        self.assertTrue(pending_list[0]['mq_healthy'])

        # 3. Dispatcher commissions the node
        assign_body = {
            "chip_id": "8F4C2A",
            "device_id": "MINER-106",
            "role": "WEARABLE",
            "zone_id": "LEVEL-3-ACTIVE-STOPE",
            "officer_name": "Supervisor_Moses"
        }
        res_assign = self.client.post('/api/v1/provision/assign', assign_body, format='json')
        self.assertEqual(res_assign.status_code, status.HTTP_200_OK)
        assign_data = res_assign.json()
        self.assertEqual(assign_data['assigned_id'], 'MINER-106')
        self.assertIn('downlink_frame', assign_data)
        downlink = assign_data['downlink_frame']
        self.assertEqual(downlink['type'], 'PROV_ASSIGN')
        self.assertEqual(downlink['payload']['target_chip'], '8F4C2A')
        self.assertEqual(downlink['payload']['assigned_id'], 'MINER-106')

        # Verify Node pre-created in Node table
        node = Node.objects.get(node_id='MINER-106')
        self.assertEqual(node.current_zone, 'LEVEL-3-ACTIVE-STOPE')

        # 4. Gateway confirms node acknowledged commissioning
        res_confirm = self.client.post('/api/v1/provision/confirm', {"chip_id": "8F4C2A"}, format='json')
        self.assertEqual(res_confirm.status_code, status.HTTP_200_OK)
        self.assertEqual(res_confirm.json()['status'], 'confirmed')

        # Verify pending list is now empty
        res_pending_after = self.client.get('/api/v1/provision/pending')
        self.assertEqual(len(res_pending_after.json()['pending_nodes']), 0)
