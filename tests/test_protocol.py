"""
COMPALLETTE PROTOCOL UNIT & REGRESSION TEST SUITE
=================================================
Verifies packet schemas, JSON serialization/deserialization rules,
legacy backwards-compatibility, error handling, and alert logic.
"""

import json
import unittest


class ProtocolValidator:
    """Python reference validator mirroring Protocol.cpp logic."""

    PROTOCOL_VERSION = 1
    VALID_TYPES = {"TELEMETRY", "ALERT", "HEARTBEAT", "ACK"}
    VALID_ROLES = {"WEARABLE", "ANCHOR", "GATEWAY", "UNKNOWN"}
    VALID_SEVERITIES = {"CRITICAL", "WARNING", "INFO", "NONE"}

    @classmethod
    def parse_packet(cls, json_str: str):
        if not json_str or not json_str.strip():
            return None, "Empty payload"

        try:
            data = json.loads(json_str)
        except json.JSONDecodeError as e:
            return None, f"JSON syntax error: {e}"

        # 1. Legacy check
        if "ver" not in data and "miner_id" in data:
            return {
                "is_legacy": True,
                "envelope": {
                    "version": 0,
                    "msg_type": "TELEMETRY",
                    "seq": 0,
                    "sender_id": data.get("miner_id", "LEGACY_NODE"),
                    "role": "WEARABLE",
                    "zone_id": "UNASSIGNED",
                    "uptime_ms": 0,
                },
                "payload": {
                    "co_ppm": float(data.get("co", 0.0)),
                    "fall_detected": bool(data.get("fall", False)),
                    "temp_c": 0.0,
                    "humidity_pct": 0.0,
                    "battery_v": 0.0,
                    "is_simulated": True,
                    "sensor_ok": True,
                },
            }, None

        # 2. Standard Protocol (v1)
        if "ver" not in data or "type" not in data or "sender" not in data:
            return None, "Missing mandatory envelope headers (ver, type, sender)"

        if data["ver"] != cls.PROTOCOL_VERSION:
            return None, f"Unsupported protocol version: {data['ver']}"

        msg_type = data["type"]
        if msg_type not in cls.VALID_TYPES:
            return None, f"Unsupported message type: {msg_type}"

        sender = data["sender"]
        if not sender or not isinstance(sender, str):
            return None, "Invalid sender identifier"

        payload = data.get("payload")
        if not isinstance(payload, dict):
            return None, "Missing or non-object payload"

        envelope = {
            "version": data["ver"],
            "msg_type": msg_type,
            "seq": int(data.get("seq", 0)),
            "sender_id": sender,
            "role": data.get("role", "UNKNOWN"),
            "zone_id": data.get("zone", ""),
            "uptime_ms": int(data.get("uptime", 0)),
        }

        if msg_type == "TELEMETRY":
            parsed_payload = {
                "co_ppm": float(payload.get("co", 0.0)),
                "temp_c": float(payload.get("temp", 0.0)),
                "humidity_pct": float(payload.get("hum", 0.0)),
                "fall_detected": bool(payload.get("fall", False)),
                "battery_v": float(payload.get("batt", 0.0)),
                "is_simulated": bool(payload.get("sim", False)),
                "sensor_ok": bool(payload.get("ok", True)),
            }
        elif msg_type == "ALERT":
            sev = payload.get("severity", "NONE")
            if sev not in cls.VALID_SEVERITIES:
                return None, f"Invalid alert severity: {sev}"
            parsed_payload = {
                "severity": sev,
                "alert_code": str(payload.get("code", "UNKNOWN")),
                "details": str(payload.get("details", "")),
                "trigger_value": float(payload.get("val", 0.0)),
            }
        elif msg_type == "HEARTBEAT":
            parsed_payload = {
                "free_heap": int(payload.get("heap", 0)),
                "mesh_node_count": int(payload.get("nodes", 0)),
                "battery_v": float(payload.get("batt", 0.0)),
            }
        else:
            parsed_payload = payload

        return {
            "is_legacy": False,
            "envelope": envelope,
            "payload": parsed_payload,
        }, None


class TestCompalletteProtocol(unittest.TestCase):

    def test_telemetry_packet_valid(self):
        sample = {
            "ver": 1,
            "type": "TELEMETRY",
            "seq": 105,
            "sender": "MINER-106",
            "role": "WEARABLE",
            "zone": "ZONE-B-DRIFT-04",
            "uptime": 125000,
            "payload": {
                "co": 18.5,
                "temp": 28.2,
                "hum": 78.4,
                "fall": False,
                "batt": 3.82,
                "sim": True,
                "ok": True,
            },
        }
        raw = json.dumps(sample)
        result, err = ProtocolValidator.parse_packet(raw)
        self.assertIsNone(err)
        self.assertFalse(result["is_legacy"])
        self.assertEqual(result["envelope"]["version"], 1)
        self.assertEqual(result["envelope"]["seq"], 105)
        self.assertEqual(result["envelope"]["sender_id"], "MINER-106")
        self.assertEqual(result["payload"]["co_ppm"], 18.5)
        self.assertFalse(result["payload"]["fall_detected"])
        self.assertTrue(result["payload"]["is_simulated"])

    def test_alert_packet_valid(self):
        sample = {
            "ver": 1,
            "type": "ALERT",
            "seq": 106,
            "sender": "MINER-106",
            "role": "WEARABLE",
            "zone": "ZONE-B-DRIFT-04",
            "uptime": 125100,
            "payload": {
                "severity": "CRITICAL",
                "code": "MAN_DOWN",
                "details": "Miner fall detected via accelerometer",
                "val": 1.0,
            },
        }
        raw = json.dumps(sample)
        result, err = ProtocolValidator.parse_packet(raw)
        self.assertIsNone(err)
        self.assertEqual(result["envelope"]["msg_type"], "ALERT")
        self.assertEqual(result["payload"]["severity"], "CRITICAL")
        self.assertEqual(result["payload"]["alert_code"], "MAN_DOWN")
        self.assertEqual(result["payload"]["trigger_value"], 1.0)

    def test_heartbeat_packet_valid(self):
        sample = {
            "ver": 1,
            "type": "HEARTBEAT",
            "seq": 12,
            "sender": "ANCHOR-Z02-L3",
            "role": "ANCHOR",
            "zone": "ZONE-B-DRIFT-04",
            "uptime": 360000,
            "payload": {
                "heap": 178240,
                "nodes": 5,
                "batt": 3.95,
            },
        }
        raw = json.dumps(sample)
        result, err = ProtocolValidator.parse_packet(raw)
        self.assertIsNone(err)
        self.assertEqual(result["envelope"]["msg_type"], "HEARTBEAT")
        self.assertEqual(result["payload"]["free_heap"], 178240)
        self.assertEqual(result["payload"]["mesh_node_count"], 5)

    def test_legacy_backward_compatibility(self):
        # Exact legacy payload generated by original ComPallete.ino
        legacy_raw = '{"miner_id":"MINER-106","co":24.5,"fall":true}'
        result, err = ProtocolValidator.parse_packet(legacy_raw)
        self.assertIsNone(err)
        self.assertTrue(result["is_legacy"])
        self.assertEqual(result["envelope"]["version"], 0)
        self.assertEqual(result["envelope"]["sender_id"], "MINER-106")
        self.assertEqual(result["envelope"]["role"], "WEARABLE")
        self.assertEqual(result["payload"]["co_ppm"], 24.5)
        self.assertTrue(result["payload"]["fall_detected"])
        self.assertTrue(result["payload"]["is_simulated"])

    def test_malformed_json_rejection(self):
        bad_cases = [
            "",
            "   ",
            "{bad_json: true,",
            '{"ver": 1, "type": "UNKNOWN"}',
            '{"ver": 2, "type": "TELEMETRY", "sender": "X", "payload": {}}',  # Unsupported version
            '{"ver": 1, "type": "TELEMETRY", "sender": ""}',                   # Empty sender
            '{"ver": 1, "type": "TELEMETRY", "sender": "X", "payload": "not_an_object"}',
        ]
        for bad in bad_cases:
            result, err = ProtocolValidator.parse_packet(bad)
            self.assertIsNone(result, f"Expected rejection for: {bad}")
            self.assertIsNotNone(err)

    def test_safety_thresholds(self):
        # Test warning & critical threshold boundaries per Zambian/OSHA mining limits
        co_warn_limit = 25.0
        co_crit_limit = 50.0

        readings = [
            (10.0, "NORMAL"),
            (24.9, "NORMAL"),
            (25.0, "WARNING"),
            (35.0, "WARNING"),
            (49.9, "WARNING"),
            (50.0, "CRITICAL"),
            (120.0, "CRITICAL"),
        ]
        for val, expected_state in readings:
            if val >= co_crit_limit:
                state = "CRITICAL"
            elif val >= co_warn_limit:
                state = "WARNING"
            else:
                state = "NORMAL"
            self.assertEqual(state, expected_state, f"Mismatch for CO level {val}")


if __name__ == "__main__":
    unittest.main()
