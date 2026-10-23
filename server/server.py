"""
COMPALLETTE CENTRALIZED REST INGESTION & MONITORING SERVER
==========================================================
Provides multi-threaded HTTP endpoints for subterranean gateway telemetry
ingestion, alert lifecycle state transitions, node status queries,
and real-time underground mining situational awareness.
"""

import argparse
import json
import os
import sys
import urllib.parse
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from typing import Optional

# Ensure repository root is in sys.path so 'server' package is always found
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if REPO_ROOT not in sys.path:
    sys.path.insert(0, REPO_ROOT)

try:
    from server.config import SERVER_HOST, SERVER_PORT, API_KEY, DB_PATH
    from server.database import Database
    from server.watchdog import NodeWatchdog
except ModuleNotFoundError:
    from config import SERVER_HOST, SERVER_PORT, API_KEY, DB_PATH
    from database import Database
    from watchdog import NodeWatchdog

# Shared singletons initialized on startup
DB: Optional[Database] = None
WATCHDOG: Optional[NodeWatchdog] = None


class CompalletteRequestHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        # Override to provide concise log output
        sys.stderr.write(f"[HTTP] {self.command} {self.path} - {args[0]} {args[1]}\n")

    def _send_json(self, status_code: int, data: dict):
        body = json.dumps(data, indent=2).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-API-Key, X-Gateway-ID")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        """Handles CORS preflight checks."""
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-API-Key, X-Gateway-ID")
        self.end_headers()

    def _read_json_body(self):
        content_len = int(self.headers.get("Content-Length", 0))
        if content_len == 0:
            return None
        body = self.rfile.read(content_len).decode("utf-8")
        try:
            return json.loads(body)
        except json.JSONDecodeError:
            return None

    def _verify_auth(self) -> bool:
        """Verifies API key header for ingestion and administrative actions."""
        client_key = self.headers.get("X-API-Key")
        return client_key == API_KEY

    # -------------------------------------------------------------------------
    # GET Handlers
    # -------------------------------------------------------------------------

    def do_GET(self):
        parsed_url = urllib.parse.urlparse(self.path)
        path = parsed_url.path.rstrip("/")
        query = urllib.parse.parse_qs(parsed_url.query)

        if path == "/health":
            self._send_json(200, {
                "status": "healthy",
                "service": "Compallette Underground Mining Safety Server",
                "version": "1.0.0",
                "database": DB.db_path if DB else "uninitialized",
            })
            return

        if path in ("", "/", "/dashboard", "/index.html"):
            dashboard_file = os.path.join(os.path.dirname(__file__), "dashboard.html")
            if os.path.exists(dashboard_file):
                with open(dashboard_file, "r", encoding="utf-8") as f:
                    content = f.read().encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(content)))
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(content)
                return

        if path == "/api/v1/system/summary":
            summary = DB.get_system_summary()
            self._send_json(200, summary)
            return

        if path == "/api/v1/nodes":
            nodes = DB.get_nodes()
            self._send_json(200, {"nodes": nodes, "count": len(nodes)})
            return

        if path.startswith("/api/v1/nodes/"):
            parts = path.split("/")
            if len(parts) == 5:
                # /api/v1/nodes/<node_id>
                node_id = parts[4]
                node = DB.get_node(node_id)
                if node:
                    self._send_json(200, node)
                else:
                    self._send_json(404, {"error": "Node not found", "node_id": node_id})
                return
            elif len(parts) == 6 and parts[5] == "history":
                # /api/v1/nodes/<node_id>/history
                node_id = parts[4]
                limit = int(query.get("limit", [50])[0])
                history = DB.get_node_history(node_id, limit=limit)
                self._send_json(200, {"node_id": node_id, "history": history, "count": len(history)})
                return

        if path == "/api/v1/alerts":
            status_filter = query.get("status", [None])[0]
            sev_filter = query.get("severity", [None])[0]
            limit = int(query.get("limit", [100])[0])
            alerts = DB.get_alerts(status=status_filter, severity=sev_filter, limit=limit)
            self._send_json(200, {"alerts": alerts, "count": len(alerts)})
            return

        if path.startswith("/api/v1/alerts/"):
            parts = path.split("/")
            if len(parts) == 5:
                # /api/v1/alerts/<alert_id>
                try:
                    aid = int(parts[4])
                    alert = DB.get_alert(aid)
                    if alert:
                        self._send_json(200, alert)
                    else:
                        self._send_json(404, {"error": "Alert not found", "alert_id": aid})
                    return
                except ValueError:
                    self._send_json(400, {"error": "Invalid alert ID format"})
                    return

        if path == "/api/v1/audit":
            limit = int(query.get("limit", [100])[0])
            audit = DB.get_audit_log(limit=limit)
            self._send_json(200, {"audit_log": audit, "count": len(audit)})
            return

        self._send_json(404, {"error": "Endpoint not found", "path": path})

    # -------------------------------------------------------------------------
    # POST Handlers (Ingestion & Lifecycle)
    # -------------------------------------------------------------------------

    def do_POST(self):
        parsed_url = urllib.parse.urlparse(self.path)
        path = parsed_url.path.rstrip("/")

        # --- Ingestion Endpoints (Require API Authentication) ---
        if path in ("/api/v1/telemetry", "/api/v1/alert", "/api/v1/heartbeat"):
            if not self._verify_auth():
                self._send_json(401, {"error": "Unauthorized: Invalid or missing X-API-Key"})
                return

            data = self._read_json_body()
            if not data or not isinstance(data, dict):
                self._send_json(400, {"error": "Bad Request: Malformed JSON payload"})
                return

            # Normalize envelope & payload structure (supports v1 and legacy)
            is_legacy = ("ver" not in data and "miner_id" in data)
            if is_legacy:
                envelope = {
                    "version": 0,
                    "msg_type": "TELEMETRY",
                    "seq": 0,
                    "sender_id": data.get("miner_id", "LEGACY_NODE"),
                    "role": "WEARABLE",
                    "zone_id": "UNASSIGNED",
                    "uptime_ms": 0,
                }
                payload = {
                    "co_ppm": data.get("co", 0.0),
                    "fall_detected": data.get("fall", False),
                    "is_simulated": True,
                    "sensor_ok": True,
                }
            else:
                envelope = {
                    "version": data.get("ver", 1),
                    "msg_type": data.get("type", "TELEMETRY"),
                    "seq": data.get("seq", 0),
                    "sender_id": data.get("sender", "UNKNOWN"),
                    "role": data.get("role", "WEARABLE"),
                    "zone_id": data.get("zone", "UNASSIGNED"),
                    "uptime_ms": data.get("uptime", 0),
                }
                payload = data.get("payload", {})
                if not isinstance(payload, dict):
                    self._send_json(400, {"error": "Missing or invalid nested 'payload' object"})
                    return

            # Dispatch based on endpoint
            if path == "/api/v1/telemetry":
                recorded, deduped = DB.record_telemetry(envelope, payload)
                self._send_json(200, {
                    "status": "ok",
                    "recorded": recorded,
                    "deduplicated": deduped,
                    "node_id": envelope["sender_id"],
                    "seq": envelope["seq"],
                })
                return

            elif path == "/api/v1/alert":
                recorded, deduped, alert_id = DB.record_alert(envelope, payload)
                self._send_json(200, {
                    "status": "ok",
                    "recorded": recorded,
                    "deduplicated": deduped,
                    "alert_id": alert_id,
                    "node_id": envelope["sender_id"],
                })
                return

            elif path == "/api/v1/heartbeat":
                recorded, deduped = DB.record_heartbeat(envelope, payload)
                self._send_json(200, {
                    "status": "ok",
                    "node_id": envelope["sender_id"],
                })
                return

        # --- Alert Lifecycle Actions ---
        if path.startswith("/api/v1/alerts/") and (path.endswith("/ack") or path.endswith("/resolve")):
            parts = path.split("/")
            try:
                alert_id = int(parts[4])
                action = parts[5]
            except (ValueError, IndexError):
                self._send_json(400, {"error": "Invalid URL path structure for alert action"})
                return

            body = self._read_json_body() or {}
            officer = body.get("officer_name", "Safety_Officer")

            if action == "ack":
                success = DB.acknowledge_alert(alert_id, officer)
                if success:
                    self._send_json(200, {"status": "ok", "message": f"Alert #{alert_id} acknowledged", "alert_id": alert_id})
                else:
                    self._send_json(404, {"error": "Alert not found or already acknowledged/resolved", "alert_id": alert_id})
                return

            elif action == "resolve":
                notes = body.get("notes", "Hazard cleared.")
                success = DB.resolve_alert(alert_id, officer, notes)
                if success:
                    self._send_json(200, {"status": "ok", "message": f"Alert #{alert_id} resolved", "alert_id": alert_id})
                else:
                    self._send_json(404, {"error": "Alert not found or already resolved", "alert_id": alert_id})
                return

        self._send_json(404, {"error": "Endpoint not found", "path": path})


def start_server(host=SERVER_HOST, port=SERVER_PORT, db_path=None):
    global DB, WATCHDOG
    DB = Database(db_path=db_path)
    WATCHDOG = NodeWatchdog(DB)
    WATCHDOG.start()

    server = ThreadingHTTPServer((host, port), CompalletteRequestHandler)
    print("=" * 70)
    print("      COMPALLETTE CENTRALIZED UNDERGROUND SAFETY BACKEND        ")
    print("=" * 70)
    print(f"[*] Server Listening on : http://{host}:{port}")
    print(f"[*] Database Path       : {DB.db_path}")
    print(f"[*] API Authentication  : Enabled (API Key required for ingestion)")
    print("=" * 70)

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[SHUTDOWN] Stopping server...")
    finally:
        WATCHDOG.stop()
        server.server_close()
        print("[SHUTDOWN] Server cleanly terminated.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Compallette Monitoring Backend")
    parser.add_argument("--host", type=str, default=SERVER_HOST, help="Host to bind to")
    parser.add_argument("--port", type=int, default=SERVER_PORT, help="Port to bind to")
    parser.add_argument("--db", type=str, default=None, help="Path to SQLite database file")
    args = parser.parse_args()

    start_server(host=args.host, port=args.port, db_path=args.db)
