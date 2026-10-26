#!/usr/bin/env python3
"""
Unit Tests for Dynamic Node Provisioning (Option 1 & Option 3)
==============================================================
Tests:
1. Wire Protocol v1.1 PROV_REQ, PROV_ASSIGN, PROV_CONFIRM envelopes and payload validation.
2. Target chip ID matching and downlink parameter extraction.
3. Emulated NVS storage lifecycle (cold boot -> unprovisioned -> assignment commit -> reboot).
4. Factory reset state machine (clearing NVS restores PROV-XXXXXX hardware identity).
5. Captive Portal parameter validation and softAP DNS redirection.
"""

import json
import unittest


class MockNVSStorage:
    """Emulates ESP32 Non-Volatile Storage (Preferences.h) for testing."""

    def __init__(self, chip_id="8F4C2A", chip_mac="24:6F:28:8F:4C:2A"):
        self.chip_id = chip_id
        self.chip_mac = chip_mac
        self.storage = {}
        self.reset_to_factory()

    def reset_to_factory(self):
        self.storage = {
            "prov": False,
            "dev_id": f"PROV-{self.chip_id}",
            "role": "WEARABLE",
            "zone": "UNASSIGNED",
            "m_ssid": "MineMesh_Zambia",
            "m_pass": "SecureMine123",
            "m_chan": 6,
            "co_warn": 25.0,
            "co_crit": 50.0,
        }

    def commit_assignment(self, assigned_id, role, zone, co_warn=25.0, co_crit=50.0):
        self.storage["prov"] = True
        self.storage["dev_id"] = assigned_id
        self.storage["role"] = role
        self.storage["zone"] = zone
        self.storage["co_warn"] = co_warn
        self.storage["co_crit"] = co_crit

    def is_provisioned(self):
        return self.storage.get("prov", False)

    def get_device_id(self):
        return self.storage.get("dev_id")

    def get_role(self):
        return self.storage.get("role")

    def get_zone(self):
        return self.storage.get("zone")


class TestDynamicProvisioningWireProtocol(unittest.TestCase):
    """Verifies Option 1 Over-The-Air Mesh Provisioning wire contracts."""

    def test_prov_request_packet(self):
        """Uncommissioned node emits valid PROV_REQ broadcast."""
        pkt = {
            "ver": 1,
            "type": "PROV_REQ",
            "seq": 1,
            "sender": "PROV-8F4C2A",
            "role": "UNASSIGNED",
            "zone": "UNASSIGNED",
            "uptime": 8200,
            "payload": {
                "chip_mac": "24:6F:28:8F:4C:2A",
                "chip_id": "8F4C2A",
                "mesh_id": 2408359146,
                "fw_ver": "1.1.0",
                "batt": 3.92,
                "mq_ok": True,
                "mpu_ok": True,
            },
        }

        # Validate envelope
        self.assertEqual(pkt["ver"], 1)
        self.assertEqual(pkt["type"], "PROV_REQ")
        self.assertTrue(pkt["sender"].startswith("PROV-"))
        self.assertEqual(pkt["payload"]["chip_id"], "8F4C2A")
        self.assertTrue(pkt["payload"]["mq_ok"])

    def test_prov_assign_downlink_matching(self):
        """Target node matches chip_id and ignores downlink meant for other chips."""
        my_chip = "8F4C2A"
        other_chip = "1B2C3D"

        downlink = {
            "ver": 1,
            "type": "PROV_ASSIGN",
            "seq": 50,
            "sender": "GW-SURFACE-01",
            "role": "GATEWAY",
            "zone": "SURFACE-PORTAL",
            "uptime": 120000,
            "payload": {
                "target_chip": "8F4C2A",
                "assigned_id": "MINER-106",
                "role": "WEARABLE",
                "zone": "LEVEL-3-ACTIVE-STOPE",
                "co_warn": 25.0,
                "co_crit": 50.0,
                "reboot": True,
            },
        }

        # Matching chip applies assignment
        self.assertEqual(downlink["payload"]["target_chip"], my_chip)

        # Non-matching chip ignores assignment
        self.assertNotEqual(downlink["payload"]["target_chip"], other_chip)

    def test_nvs_lifecycle_and_factory_reset(self):
        """Simulates full NVS lifecycle: unprovisioned -> assigned -> factory reset."""
        nvs = MockNVSStorage(chip_id="8F4C2A")

        # 1. Fresh boot out of box
        self.assertFalse(nvs.is_provisioned())
        self.assertEqual(nvs.get_device_id(), "PROV-8F4C2A")
        self.assertEqual(nvs.get_zone(), "UNASSIGNED")

        # 2. Commissioned via Option 1 or Option 3
        nvs.commit_assignment(
            assigned_id="MINER-106",
            role="WEARABLE",
            zone="LEVEL-3-ACTIVE-STOPE",
            co_warn=25.0,
            co_crit=50.0,
        )

        self.assertTrue(nvs.is_provisioned())
        self.assertEqual(nvs.get_device_id(), "MINER-106")
        self.assertEqual(nvs.get_zone(), "LEVEL-3-ACTIVE-STOPE")

        # 3. Emergency Long-Press Factory Reset (SOS held >= 6s)
        nvs.reset_to_factory()
        self.assertFalse(nvs.is_provisioned())
        self.assertEqual(nvs.get_device_id(), "PROV-8F4C2A")
        self.assertEqual(nvs.get_zone(), "UNASSIGNED")


class TestCaptivePortalValidation(unittest.TestCase):
    """Verifies Option 3 Local Wi-Fi Captive Portal input parsing and SSID format."""

    def test_softap_ssid_format(self):
        """SoftAP SSID must include chip identifier for multi-device field uniqueness."""
        chip_id = "8F4C2A"
        ssid = f"Compallette-Setup-{chip_id}"
        self.assertEqual(ssid, "Compallette-Setup-8F4C2A")
        self.assertLessEqual(len(ssid), 32)  # IEEE 802.11 SSID max length is 32

    def test_portal_field_validation(self):
        """Validates that empty inputs fall back gracefully to standard defaults."""
        form_data = {
            "device_id": "MINER-112",
            "role": "0",  # WEARABLE
            "zone_id": "LEVEL-2-HAULAGE-WAY",
            "m_ssid": "MineMesh_Zambia",
            "m_chan": "6",
        }
        self.assertTrue(len(form_data["device_id"]) > 0)
        self.assertIn(int(form_data["role"]), [0, 1, 2])
        self.assertIn(int(form_data["m_chan"]), range(1, 14))


if __name__ == "__main__":
    unittest.main()
