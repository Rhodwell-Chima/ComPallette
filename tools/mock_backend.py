#!/usr/bin/env python3
"""
COMPALLETTE MOCK BACKEND SERVICE
================================
Lightweight HTTP ingestion server mimicking the mine surface monitoring backend.
Receives telemetry, emergency alerts, and heartbeats from the gateway bridge.
Supports simulated network outages to test gateway offline buffering.
"""

import argparse
import json
import threading
from http.server import HTTPServer, BaseHTTPRequestHandler
import sys

API_KEY = "compallette-mining-secret-key-v1"

class BackendState:
    def __init__(self):
        self.lock = threading.Lock()
        self.outage_enabled = False
        self.total_received = 0
        self.telemetry_count = 0
        self.alert_count = 0
        self.heartbeat_count = 0
        self.received_packets = []

    def reset(self):
        with self.lock:
            self.outage_enabled = False
            self.total_received = 0
            self.telemetry_count = 0
            self.alert_count = 0
            self.heartbeat_count = 0
            self.received_packets.clear()

STATE = BackendState()

class MockBackendHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        # Suppress default noisy access logs unless error
        pass

    def do_POST(self):
        # 1. Check if simulated outage is active
        if STATE.outage_enabled and self.path != "/api/v1/outage":
            self.send_response(503)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"status":"error","message":"Service Unavailable (Simulated Outage)"}')
            return

        # 2. Outage control endpoint
        if self.path == "/api/v1/outage":
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length) if length > 0 else b"{}"
            try:
                data = json.loads(body)
                STATE.outage_enabled = bool(data.get("enabled", True))
            except Exception:
                STATE.outage_enabled = True

            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            resp = json.dumps({"status": "ok", "outage_active": STATE.outage_enabled})
            self.wfile.write(resp.encode("utf-8"))
            return

        # 3. Authenticate API Key
        client_key = self.headers.get("X-API-Key")
        if client_key != API_KEY:
            self.send_response(401)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"status":"error","message":"Invalid API Key"}')
            return

        # 4. Read Payload
        content_len = int(self.headers.get("Content-Length", 0))
        post_data = self.rfile.read(content_len).decode("utf-8")

        try:
            payload = json.loads(post_data)
        except json.JSONDecodeError:
            self.send_response(400)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"status":"error","message":"Malformed JSON"}')
            return

        with STATE.lock:
            STATE.total_received += 1
            STATE.received_packets.append(payload)

            if self.path == "/api/v1/telemetry":
                STATE.telemetry_count += 1
                sender = payload.get("sender", "UNKNOWN")
                zone = payload.get("zone", "UNKNOWN")
                co = payload.get("payload", {}).get("co", 0.0)
                fall = payload.get("payload", {}).get("fall", False)
                print(f"[BACKEND INGEST] Telemetry from {sender} @ {zone} | CO: {co} ppm | Fall: {fall}")

            elif self.path == "/api/v1/alert":
                STATE.alert_count += 1
                sender = payload.get("sender", "UNKNOWN")
                zone = payload.get("zone", "UNKNOWN")
                sev = payload.get("payload", {}).get("severity", "NONE")
                code = payload.get("payload", {}).get("code", "UNKNOWN")
                details = payload.get("payload", {}).get("details", "")
                print("\n" + "#" * 65)
                print(f" [BACKEND ALARM RECEIVED] Severity: {sev} | Code: {code}")
                print(f" --> Origin: {sender} | Zone: {zone}")
                print(f" --> Details: {details}")
                print("#" * 65 + "\n")

            elif self.path == "/api/v1/heartbeat":
                STATE.heartbeat_count += 1
                sender = payload.get("sender", "UNKNOWN")
                heap = payload.get("payload", {}).get("heap", 0)
                print(f"[BACKEND HEARTBEAT] Node: {sender} | Free Heap: {heap} B")

            else:
                self.send_response(404)
                self.end_headers()
                return

        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(b'{"status":"ok","message":"Ingested successfully"}')

    def do_GET(self):
        if self.path == "/api/v1/status":
            with STATE.lock:
                status_dict = {
                    "status": "online",
                    "outage_simulated": STATE.outage_enabled,
                    "total_received": STATE.total_received,
                    "telemetry_count": STATE.telemetry_count,
                    "alert_count": STATE.alert_count,
                    "heartbeat_count": STATE.heartbeat_count,
                }
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(status_dict).encode("utf-8"))
        else:
            self.send_response(404)
            self.end_headers()


def run_mock_server(port=8080):
    server = HTTPServer(("127.0.0.1", port), MockBackendHandler)
    print("=" * 65)
    print(f"  COMPALLETTE SURFACE MONITORING BACKEND (MOCK)  ")
    print(f"  Listening on http://127.0.0.1:{port}")
    print(f"  API Key: {API_KEY}")
    print("=" * 65)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down backend server...")
        server.server_close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Compallette Mock Surface Backend")
    parser.add_argument("--port", type=int, default=8080, help="Port to listen on (default: 8080)")
    args = parser.parse_args()
    run_mock_server(port=args.port)
