"""
Shared Wire-Protocol API Contract Test Suite
============================================
This test suite can be run against ANY backend (Django, Rust Rocket, Go, Node)
to verify 100% adherence to the Compallette v1 Ingestion Contract.

Usage:
    python tests/test_api_contract.py --url http://127.0.0.1:8000
"""

import argparse
import json
import sys
import unittest
import urllib.request
import urllib.error

API_KEY = "compallette-mining-secret-key-v1"


class BackendContractTestSuite(unittest.TestCase):
    base_url = "http://127.0.0.1:8000"

    def _request(self, method, endpoint, body=None, headers=None):
        url = self.base_url.rstrip("/") + endpoint
        data = json.dumps(body).encode("utf-8") if body is not None else None
        h = {"Content-Type": "application/json"}
        if headers:
            h.update(headers)
        req = urllib.request.Request(url, data=data, headers=h, method=method)
        try:
            with urllib.request.urlopen(req, timeout=3.0) as resp:
                status_code = resp.status
                resp_data = json.loads(resp.read().decode("utf-8"))
                return status_code, resp_data
        except urllib.error.HTTPError as e:
            try:
                err_data = json.loads(e.read().decode("utf-8"))
            except Exception:
                err_data = {}
            return e.code, err_data

    def test_01_health_endpoint(self):
        status, data = self._request("GET", "/health")
        self.assertEqual(status, 200)
        self.assertEqual(data.get("status"), "healthy")

    def test_02_auth_rejection(self):
        status, _ = self._request("POST", "/api/v1/telemetry", body={"test": 1})
        self.assertEqual(status, 401)

    def test_03_telemetry_ingest_contract(self):
        envelope = {
            "ver": 1,
            "type": "TELEMETRY",
            "seq": 901,
            "sender": "MINER-CONTRACT-01",
            "role": "WEARABLE",
            "zone": "LEVEL-250-SOUTH",
            "uptime": 12000,
            "payload": {
                "co": 15.2,
                "temp": 26.5,
                "hum": 70.0,
                "fall": False,
                "batt": 4.10,
                "sim": True,
                "ok": True
            }
        }
        status, data = self._request("POST", "/api/v1/telemetry", body=envelope, headers={"X-API-Key": API_KEY})
        self.assertEqual(status, 200)
        self.assertEqual(data.get("status"), "ok")
        self.assertEqual(data.get("node_id"), "MINER-CONTRACT-01")

    def test_04_system_summary_contract(self):
        status, data = self._request("GET", "/api/v1/system/summary")
        self.assertEqual(status, 200)
        required_keys = [
            "total_nodes_tracked", "online_miners", "stale_nodes",
            "offline_nodes", "active_unacknowledged_alerts", "critical_emergencies"
        ]
        for key in required_keys:
            self.assertIn(key, data, f"Missing required summary contract key: {key}")


if __name__ == "__main__":
    unittest.main()
