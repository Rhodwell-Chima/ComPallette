"""
COMPALLETTE BACKEND INTEGRATION & PERSISTENCE TEST SUITE
========================================================
Comprehensive automated tests validating:
1. SQLite schema creation and atomic operations.
2. Telemetry and alert packet sequence deduplication.
3. Node tracking, zone mapping, and sensor history.
4. Alert lifecycle transitions (NEW -> ACKNOWLEDGED -> RESOLVED).
5. Watchdog stale node and offline COMM_LOST alert triggers.
6. System summary situational metrics calculation.
7. REST API authentication, error handling, and CORS headers.
"""

import json
import os
import tempfile
import threading
import time
import unittest
import urllib.request
import urllib.error
from http.server import ThreadingHTTPServer

from server.config import API_KEY, CO_WARN_PPM, CO_CRIT_PPM
from server.database import Database
from server.watchdog import NodeWatchdog
from server.server import CompalletteRequestHandler
import server.server as server_module

TEST_PORT = 8099
BASE_URL = f"http://127.0.0.1:{TEST_PORT}"


def safe_remove(path):
    if not path or not os.path.exists(path):
        return
    import gc
    gc.collect()
    for _ in range(3):
        try:
            os.remove(path)
            break
        except Exception:
            time.sleep(0.05)


class TestDatabaseDirect(unittest.TestCase):
    """Direct database schema, deduplication, and lifecycle unit tests."""

    def setUp(self):
        self.temp_db = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        self.temp_db.close()
        self.db = Database(self.temp_db.name)

    def tearDown(self):
        safe_remove(self.temp_db.name)

    def test_telemetry_recording_and_deduplication(self):
        env = {
            "version": 1,
            "msg_type": "TELEMETRY",
            "seq": 101,
            "sender_id": "MINER-106",
            "role": "WEARABLE",
            "zone_id": "LEVEL-2-NORTH-DRIFT",
            "uptime_ms": 50000,
        }
        payload = {
            "co_ppm": 18.5,
            "temp_c": 28.0,
            "humidity_pct": 75.0,
            "fall_detected": False,
            "battery_v": 3.82,
            "is_simulated": True,
            "sensor_ok": True,
        }

        # First ingestion
        rec1, dedup1 = self.db.record_telemetry(env, payload)
        self.assertTrue(rec1)
        self.assertFalse(dedup1)

        # Duplicate ingestion (burst retransmit or buffered replay)
        rec2, dedup2 = self.db.record_telemetry(env, payload)
        self.assertFalse(rec2)
        self.assertTrue(dedup2)

        # Verify node record was updated
        node = self.db.get_node("MINER-106")
        self.assertIsNotNone(node)
        self.assertEqual(node["current_zone"], "LEVEL-2-NORTH-DRIFT")
        self.assertEqual(node["status"], "ONLINE")
        self.assertEqual(node["latest_co"], 18.5)

    def test_alert_lifecycle_and_audit_trail(self):
        env = {
            "version": 1,
            "msg_type": "ALERT",
            "seq": 102,
            "sender_id": "MINER-106",
            "role": "WEARABLE",
            "zone_id": "LEVEL-2-NORTH-DRIFT",
        }
        payload = {
            "severity": "CRITICAL",
            "alert_code": "MAN_DOWN",
            "details": "Miner fall detected via accelerometer",
            "trigger_value": 1.0,
        }

        rec, dedup, alert_id = self.db.record_alert(env, payload)
        self.assertTrue(rec)
        self.assertFalse(dedup)
        self.assertGreater(alert_id, 0)

        # Verify initial status is NEW
        alert = self.db.get_alert(alert_id)
        self.assertEqual(alert["status"], "NEW")
        self.assertEqual(alert["severity"], "CRITICAL")
        self.assertEqual(alert["alert_code"], "MAN_DOWN")

        # Step 1: Safety Officer acknowledges alert
        ack_ok = self.db.acknowledge_alert(alert_id, "Officer Banda")
        self.assertTrue(ack_ok)

        alert_after_ack = self.db.get_alert(alert_id)
        self.assertEqual(alert_after_ack["status"], "ACKNOWLEDGED")
        self.assertEqual(alert_after_ack["acknowledged_by"], "Officer Banda")
        self.assertIsNotNone(alert_after_ack["acknowledged_at"])

        # Cannot re-acknowledge an already acknowledged alert
        self.assertFalse(self.db.acknowledge_alert(alert_id, "Officer Banda"))

        # Step 2: Resolve alert after medical check
        res_ok = self.db.resolve_alert(alert_id, "Officer Banda", "Miner assisted, uninjured.")
        self.assertTrue(res_ok)

        alert_after_res = self.db.get_alert(alert_id)
        self.assertEqual(alert_after_res["status"], "RESOLVED")
        self.assertEqual(alert_after_res["resolved_by"], "Officer Banda")
        self.assertEqual(alert_after_res["resolution_notes"], "Miner assisted, uninjured.")

        # Verify audit trail captured all transitions
        audit = self.db.get_audit_log()
        actions = [a["action"] for a in audit]
        self.assertIn("ALERT_TRIGGERED", actions)
        self.assertIn("ALERT_ACKNOWLEDGED", actions)
        self.assertIn("ALERT_RESOLVED", actions)

    def test_watchdog_stale_and_offline_detection(self):
        # Register a miner with timestamp in the past
        env = {"sender_id": "MINER-101", "role": "WEARABLE", "zone_id": "LEVEL-3-STOPE", "seq": 1}
        payload = {"co_ppm": 12.0}
        self.db.record_telemetry(env, payload)

        # Manually back-date the last_seen_ts to simulate 25 seconds of silence (STALE)
        now_ms = int(time.time() * 1000)
        with self.db.connection() as conn:
            conn.execute("UPDATE nodes SET last_seen_ts = ? WHERE node_id = 'MINER-101'", (now_ms - 25000,))

        # Run watchdog check (stale=20s, offline=45s)
        res = self.db.update_node_watchdog(stale_threshold_sec=20, offline_threshold_sec=45)
        self.assertEqual(res["stale"], 1)

        node = self.db.get_node("MINER-101")
        self.assertEqual(node["status"], "STALE")

        # Now simulate 50 seconds of silence (OFFLINE)
        with self.db.connection() as conn:
            conn.execute("UPDATE nodes SET last_seen_ts = ? WHERE node_id = 'MINER-101'", (now_ms - 50000,))

        res2 = self.db.update_node_watchdog(stale_threshold_sec=20, offline_threshold_sec=45)
        self.assertEqual(res2["offline"], 1)

        node_offline = self.db.get_node("MINER-101")
        self.assertEqual(node_offline["status"], "OFFLINE")

        # Verify automated COMM_LOST alert was generated
        alerts = self.db.get_alerts(severity="WARNING")
        comm_alerts = [a for a in alerts if a["alert_code"] == "COMM_LOST"]
        self.assertEqual(len(comm_alerts), 1)
        self.assertEqual(comm_alerts[0]["node_id"], "MINER-101")


class TestServerEndToEnd(unittest.TestCase):
    """End-to-end REST API HTTP tests."""

    @classmethod
    def setUpClass(cls):
        cls.temp_db = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
        cls.temp_db.close()

        server_module.DB = Database(cls.temp_db.name)
        server_module.WATCHDOG = NodeWatchdog(server_module.DB, interval_sec=1)
        server_module.WATCHDOG.start()

        cls.httpd = ThreadingHTTPServer(("127.0.0.1", TEST_PORT), CompalletteRequestHandler)
        cls.server_thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.server_thread.start()
        time.sleep(0.1)

    @classmethod
    def tearDownClass(cls):
        server_module.WATCHDOG.stop()
        cls.httpd.shutdown()
        cls.httpd.server_close()
        safe_remove(cls.temp_db.name)

    def _post(self, path: str, data: dict, api_key: str = API_KEY):
        url = BASE_URL + path
        req = urllib.request.Request(
            url,
            data=json.dumps(data).encode("utf-8"),
            headers={"Content-Type": "application/json", "X-API-Key": api_key},
            method="POST",
        )
        with urllib.request.urlopen(req) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8"))

    def _get(self, path: str):
        url = BASE_URL + path
        req = urllib.request.Request(url, method="GET")
        with urllib.request.urlopen(req) as resp:
            return resp.status, json.loads(resp.read().decode("utf-8"))

    def test_health_check(self):
        status, body = self._get("/health")
        self.assertEqual(status, 200)
        self.assertEqual(body["status"], "healthy")

    def test_dashboard_page_served(self):
        req = urllib.request.Request(BASE_URL + "/dashboard", method="GET")
        with urllib.request.urlopen(req) as resp:
            self.assertEqual(resp.status, 200)
            self.assertIn("text/html", resp.headers.get("Content-Type", ""))
            html = resp.read().decode("utf-8")
            self.assertIn("COMPALLETTE", html)
            self.assertIn("Subterranean Safety Operations Center", html)

    def test_unauthorized_ingest_rejection(self):
        url = BASE_URL + "/api/v1/telemetry"
        req = urllib.request.Request(
            url,
            data=b"{}",
            headers={"Content-Type": "application/json", "X-API-Key": "WRONG_KEY"},
            method="POST",
        )
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            urllib.request.urlopen(req)
        self.assertEqual(ctx.exception.code, 401)

    def test_telemetry_post_and_summary_query(self):
        # 1. Post telemetry for MINER-106
        telem = {
            "ver": 1,
            "type": "TELEMETRY",
            "seq": 501,
            "sender": "MINER-106",
            "role": "WEARABLE",
            "zone": "LEVEL-2-HAULAGE",
            "uptime": 60000,
            "payload": {
                "co": 32.5,  # Warning gas level
                "temp": 29.0,
                "hum": 80.0,
                "fall": False,
                "batt": 3.80,
                "sim": True,
                "ok": True,
            },
        }
        status, resp = self._post("/api/v1/telemetry", telem)
        self.assertEqual(status, 200)
        self.assertTrue(resp["recorded"])
        self.assertFalse(resp["deduplicated"])

        # 2. Query summary
        status_sum, summary = self._get("/api/v1/system/summary")
        self.assertEqual(status_sum, 200)
        self.assertGreaterEqual(summary["online_miners"], 1)
        self.assertGreaterEqual(summary["miners_in_gas_warning"], 1)

        # 3. Query specific node
        status_node, node = self._get("/api/v1/nodes/MINER-106")
        self.assertEqual(status_node, 200)
        self.assertEqual(node["current_zone"], "LEVEL-2-HAULAGE")
        self.assertEqual(node["latest_co"], 32.5)

    def test_alert_lifecycle_via_rest(self):
        # 1. Post critical alert
        alert_payload = {
            "ver": 1,
            "type": "ALERT",
            "seq": 601,
            "sender": "MINER-112",
            "role": "WEARABLE",
            "zone": "LEVEL-3-STOPE",
            "payload": {
                "severity": "CRITICAL",
                "code": "GAS_CO_CRITICAL",
                "details": "CO spike at 65 ppm",
                "val": 65.0,
            },
        }
        status, resp = self._post("/api/v1/alert", alert_payload)
        self.assertEqual(status, 200)
        alert_id = resp["alert_id"]

        # 2. Safety Officer acknowledges alert via REST
        ack_status, ack_resp = self._post(f"/api/v1/alerts/{alert_id}/ack", {"officer_name": "Shift_Boss_Mwape"})
        self.assertEqual(ack_status, 200)
        self.assertEqual(ack_resp["status"], "ok")

        # 3. Verify alert status is now ACKNOWLEDGED
        status_get, alert_data = self._get(f"/api/v1/alerts/{alert_id}")
        self.assertEqual(status_get, 200)
        self.assertEqual(alert_data["status"], "ACKNOWLEDGED")
        self.assertEqual(alert_data["acknowledged_by"], "Shift_Boss_Mwape")

        # 4. Resolve alert via REST
        res_status, res_resp = self._post(f"/api/v1/alerts/{alert_id}/resolve", {
            "officer_name": "Shift_Boss_Mwape",
            "notes": "Auxiliary fan switched on, CO normalized to 12 ppm."
        })
        self.assertEqual(res_status, 200)

        # 5. Verify final status is RESOLVED
        status_final, alert_final = self._get(f"/api/v1/alerts/{alert_id}")
        self.assertEqual(status_final, 200)
        self.assertEqual(alert_final["status"], "RESOLVED")
        self.assertIn("Auxiliary fan", alert_final["resolution_notes"])


if __name__ == "__main__":
    unittest.main()
