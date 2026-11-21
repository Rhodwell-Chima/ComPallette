"""Opt-in HTTP recovery contract checks against an isolated Django installation.
Requires COMPALLETTE_CONTRACT_TEST=isolated, COMPALLETTE_GATEWAY_ID,
COMPALLETTE_INSTALLATION_ID, COMPALLETTE_TEST_NODE and COMPALLETTE_GATEWAY_KEY_FILE.
The test node must already be commissioned in the gateway's site.
"""

import argparse
import json
import sys
import unittest
import urllib.request
import urllib.error

import os

from pathlib import Path
API_KEY = ""
GATEWAY_ID = os.environ.get("COMPALLETTE_GATEWAY_ID", "")
INSTALLATION_ID = os.environ.get("COMPALLETTE_INSTALLATION_ID", "")
TEST_NODE = os.environ.get("COMPALLETTE_TEST_NODE", "")


class BackendContractTestSuite(unittest.TestCase):
    base_url = os.environ.get("COMPALLETTE_URL", "http://127.0.0.1:8000")

    @classmethod
    def setUpClass(cls):
        global API_KEY
        key_file = os.environ.get("COMPALLETTE_GATEWAY_KEY_FILE")
        if os.environ.get("COMPALLETTE_CONTRACT_TEST") != "isolated" or not all([GATEWAY_ID, INSTALLATION_ID, TEST_NODE, key_file]):
            raise unittest.SkipTest("Explicit isolated installation and commissioned gateway/node fixtures are required")
        API_KEY = Path(key_file).read_text(encoding="utf-8").strip()
        try:
            req = urllib.request.Request(f"{cls.base_url}/health")
            with urllib.request.urlopen(req, timeout=0.8):
                pass
        except Exception:
            raise unittest.SkipTest(f"Live backend server is not running at {cls.base_url} (skip contract test during offline test discovery)")

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
            "installation_id": INSTALLATION_ID,
            "ver": 1,
            "type": "TELEMETRY",
            "seq": 901,
            "sender": TEST_NODE,
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
        status, data = self._request("POST", "/api/v1/telemetry", body=envelope, headers={"X-API-Key": API_KEY, "X-Gateway-ID": GATEWAY_ID})
        self.assertEqual(status, 200)
        self.assertEqual(data.get("status"), "ok")
        self.assertEqual(data.get("node_id"), TEST_NODE)
        self.assertFalse(data.get("quarantined", False))
        self.assertEqual(data.get("installation_id"), INSTALLATION_ID)

    def test_04_operator_dashboard_requires_session(self):
        status, data = self._request("GET", "/api/v1/system/summary")
        self.assertEqual(status, 401)
        self.assertIn("detail", data)


if __name__ == "__main__":
    unittest.main()
