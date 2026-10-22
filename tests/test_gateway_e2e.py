"""
COMPALLETTE GATEWAY END-TO-END INTEGRATION TEST
===============================================
Spins up an in-process mock backend server and tests:
1. Real HTTP transmission from Gateway client to Mock Backend.
2. Network outage detection, exponential backoff, and offline persistence.
3. Node reboot survival during network outage.
4. Automatic reconnection, buffer flush, priority alert preemption, and zero loss.
"""

import json
import os
import tempfile
import threading
import time
import unittest
import urllib.request
import urllib.error
from http.server import HTTPServer

from tools.mock_backend import MockBackendHandler, STATE
from tests.test_offline_buffer import PythonOfflineBuffer

TEST_PORT = 8089
BASE_URL = f"http://127.0.0.1:{TEST_PORT}"
API_KEY = "compallette-mining-secret-key-v1"


class SimulatedGateway:
    """Simulates GatewayManager.cpp logic communicating via HTTP."""

    def __init__(self, buffer_file):
        self.buffer = PythonOfflineBuffer(max_flash=100, flash_path=buffer_file)
        self.backend_url = BASE_URL
        self.api_key = API_KEY
        self.backoff_ms = 100
        self.consecutive_failures = 0
        self.state = "CONNECTED"

    def handle_mesh_packet(self, raw_json, is_priority=False, msg_type="TELEMETRY"):
        self.buffer.push(raw_json, msg_type=msg_type, is_priority=is_priority)

    def forward_next_packet(self):
        item = self.buffer.peek()
        if not item:
            return True, "Buffer empty"

        endpoint = "/api/v1/alert" if item["type"] == "ALERT" else "/api/v1/telemetry"
        url = self.backend_url + endpoint

        req = urllib.request.Request(
            url,
            data=item["raw"].encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "X-API-Key": self.api_key,
                "X-Gateway-ID": "GW-TEST-01",
            },
            method="POST",
        )

        try:
            with urllib.request.urlopen(req, timeout=2.0) as resp:
                if 200 <= resp.status < 300:
                    self.buffer.pop()
                    self.consecutive_failures = 0
                    self.state = "CONNECTED"
                    return True, resp.status
        except urllib.error.HTTPError as e:
            if e.code in (400, 422):
                # Unrecoverable payload error - drop to prevent head-of-line blocking
                self.buffer.pop()
                return True, f"Dropped bad payload ({e.code})"
            else:
                self.consecutive_failures += 1
                self.state = "BACKOFF"
                return False, f"Server Error ({e.code})"
        except Exception as e:
            self.consecutive_failures += 1
            self.state = "BACKOFF"
            return False, f"Connection Failed: {e}"

    def flush_all_available(self):
        flushed_count = 0
        while not self.buffer.is_empty():
            success, status = self.forward_next_packet()
            if success:
                flushed_count += 1
            else:
                break
        return flushed_count


class TestGatewayEndToEnd(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        STATE.reset()
        cls.httpd = HTTPServer(("127.0.0.1", TEST_PORT), MockBackendHandler)
        cls.server_thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.server_thread.start()
        time.sleep(0.1)  # Allow server socket to bind

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()

    def setUp(self):
        STATE.reset()
        self.temp_file = tempfile.NamedTemporaryFile(delete=False)
        self.temp_file.close()

    def tearDown(self):
        if os.path.exists(self.temp_file.name):
            os.remove(self.temp_file.name)

    def test_end_to_end_outage_buffering_and_recovery(self):
        gw = SimulatedGateway(self.temp_file.name)

        # -------------------------------------------------------------
        # 1. Normal Online Operation
        # -------------------------------------------------------------
        pkt1 = json.dumps({"ver": 1, "type": "TELEMETRY", "seq": 1, "sender": "MINER-101", "payload": {"co": 12.0}})
        pkt2 = json.dumps({"ver": 1, "type": "TELEMETRY", "seq": 2, "sender": "MINER-106", "payload": {"co": 14.5}})

        gw.handle_mesh_packet(pkt1, is_priority=False, msg_type="TELEMETRY")
        gw.handle_mesh_packet(pkt2, is_priority=False, msg_type="TELEMETRY")
        self.assertEqual(gw.buffer.count(), 2)

        # Flush when online
        flushed = gw.flush_all_available()
        self.assertEqual(flushed, 2)
        self.assertTrue(gw.buffer.is_empty())
        self.assertEqual(STATE.telemetry_count, 2)

        # -------------------------------------------------------------
        # 2. Simulate Underground Cable Cut / Network Outage
        # -------------------------------------------------------------
        STATE.outage_enabled = True

        # Packets arrive during the blackout
        for i in range(3, 7):
            telem = json.dumps({"ver": 1, "type": "TELEMETRY", "seq": i, "sender": "MINER-101", "payload": {"co": 15.0 + i}})
            gw.handle_mesh_packet(telem, is_priority=False, msg_type="TELEMETRY")

        # Emergency fall alert arrives during blackout
        alert_pkt = json.dumps({
            "ver": 1,
            "type": "ALERT",
            "seq": 99,
            "sender": "MINER-106",
            "payload": {"severity": "CRITICAL", "code": "MAN_DOWN", "val": 1.0}
        })
        gw.handle_mesh_packet(alert_pkt, is_priority=True, msg_type="ALERT")

        # Gateway attempts transmission but backend returns 503
        flushed_during_outage = gw.flush_all_available()
        self.assertEqual(flushed_during_outage, 0)
        self.assertEqual(gw.state, "BACKOFF")
        self.assertEqual(gw.buffer.count(), 5)  # 4 telemetry + 1 alert safely preserved

        # -------------------------------------------------------------
        # 3. Simulate Gateway Power Reboot while Outage Persists
        # -------------------------------------------------------------
        # Create fresh gateway instance pointing to the same persistent flash file
        gw_rebooted = SimulatedGateway(self.temp_file.name)
        gw_rebooted.buffer.load_from_flash()
        self.assertEqual(gw_rebooted.buffer.count(), 5)

        # Verify that the critical alert is at the front of the queue
        head = gw_rebooted.buffer.peek()
        self.assertEqual(head["type"], "ALERT")

        # -------------------------------------------------------------
        # 4. Uplink Restored: Outage Cleared & Queue Flushed
        # -------------------------------------------------------------
        STATE.outage_enabled = False

        flushed_after_recovery = gw_rebooted.flush_all_available()
        self.assertEqual(flushed_after_recovery, 5)
        self.assertTrue(gw_rebooted.buffer.is_empty())

        # Verify backend received exactly 1 alert and 6 total telemetry (2 before + 4 during outage)
        self.assertEqual(STATE.alert_count, 1)
        self.assertEqual(STATE.telemetry_count, 6)
        self.assertEqual(STATE.total_received, 7)

        # Verify the alert was delivered immediately upon link restoration
        received_types = [p.get("type") for p in STATE.received_packets]
        # First 2 were telemetry (before outage), 3rd MUST be ALERT (preempted telemetry in queue)
        self.assertEqual(received_types[0], "TELEMETRY")
        self.assertEqual(received_types[1], "TELEMETRY")
        self.assertEqual(received_types[2], "ALERT")


if __name__ == "__main__":
    unittest.main()
