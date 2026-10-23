"""
COMPALLETTE DATABASE & PERSISTENCE ENGINE
=========================================
Manages SQLite schema, sequence deduplication, atomic transaction updates,
alert lifecycle state transitions, and audit logging.
"""

import os
import sys
import sqlite3
import time
from contextlib import contextmanager
from typing import Dict, List, Optional, Tuple, Any

# Ensure repository root is in sys.path
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if REPO_ROOT not in sys.path:
    sys.path.insert(0, REPO_ROOT)

try:
    from server.config import DB_PATH, CO_WARN_PPM, CO_CRIT_PPM
except ModuleNotFoundError:
    from config import DB_PATH, CO_WARN_PPM, CO_CRIT_PPM


class Database:
    def __init__(self, db_path: Optional[str] = None):
        self.db_path = db_path or DB_PATH
        db_dir = os.path.dirname(self.db_path)
        if db_dir and not os.path.exists(db_dir):
            os.makedirs(db_dir, exist_ok=True)
        self.init_db()

    def get_connection(self) -> sqlite3.Connection:
        """Returns a thread-safe connection configured with WAL journal mode."""
        conn = sqlite3.connect(self.db_path, timeout=10.0)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL;")
        conn.execute("PRAGMA synchronous=NORMAL;")
        return conn

    @contextmanager
    def connection(self):
        """Context manager yielding an auto-closing sqlite connection with commit on success."""
        conn = self.get_connection()
        try:
            with conn:
                yield conn
        finally:
            conn.close()

    def init_db(self):
        """Initializes tables, unique constraints, and indices."""
        conn = self.get_connection()
        try:
            with conn:
                conn.executescript("""
                CREATE TABLE IF NOT EXISTS nodes (
                    node_id TEXT PRIMARY KEY,
                    role TEXT NOT NULL,
                    current_zone TEXT,
                    last_seen_ts INTEGER NOT NULL,
                    last_seq INTEGER DEFAULT 0,
                    battery_v REAL DEFAULT 0.0,
                    free_heap INTEGER DEFAULT 0,
                    status TEXT DEFAULT 'ONLINE',
                    is_simulated INTEGER DEFAULT 1,
                    sensor_ok INTEGER DEFAULT 1,
                    latest_co REAL DEFAULT 0.0,
                    latest_temp REAL DEFAULT 0.0,
                    latest_hum REAL DEFAULT 0.0
                );

                CREATE TABLE IF NOT EXISTS telemetry (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    node_id TEXT NOT NULL,
                    seq INTEGER NOT NULL,
                    zone TEXT,
                    co_ppm REAL,
                    temp_c REAL,
                    humidity_pct REAL,
                    fall_detected INTEGER DEFAULT 0,
                    battery_v REAL,
                    is_simulated INTEGER DEFAULT 1,
                    sensor_ok INTEGER DEFAULT 1,
                    uptime_ms INTEGER,
                    received_at INTEGER NOT NULL,
                    UNIQUE(node_id, seq)
                );

                CREATE TABLE IF NOT EXISTS alerts (
                    alert_id INTEGER PRIMARY KEY AUTOINCREMENT,
                    node_id TEXT NOT NULL,
                    zone TEXT,
                    severity TEXT NOT NULL,
                    alert_code TEXT NOT NULL,
                    details TEXT,
                    trigger_value REAL,
                    status TEXT DEFAULT 'NEW',
                    created_at INTEGER NOT NULL,
                    acknowledged_at INTEGER,
                    acknowledged_by TEXT,
                    resolved_at INTEGER,
                    resolved_by TEXT,
                    resolution_notes TEXT,
                    seq INTEGER,
                    UNIQUE(node_id, seq, alert_code)
                );

                CREATE TABLE IF NOT EXISTS audit_log (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp INTEGER NOT NULL,
                    actor TEXT NOT NULL,
                    action TEXT NOT NULL,
                    details TEXT
                );

                CREATE INDEX IF NOT EXISTS idx_telemetry_node_ts ON telemetry(node_id, received_at DESC);
                CREATE INDEX IF NOT EXISTS idx_alerts_status ON alerts(status, severity);
                """)
        finally:
            conn.close()

    # -------------------------------------------------------------------------
    # Ingestion & Deduplication
    # -------------------------------------------------------------------------

    def record_telemetry(self, envelope: Dict[str, Any], payload: Dict[str, Any]) -> Tuple[bool, bool]:
        """
        Records telemetry packet.
        Returns (recorded: bool, deduplicated: bool).
        """
        now = int(time.time() * 1000)
        node_id = envelope.get("sender_id", envelope.get("sender", "UNKNOWN"))
        seq = int(envelope.get("seq", 0))
        role = envelope.get("role", "WEARABLE")
        zone = envelope.get("zone_id", envelope.get("zone", "UNASSIGNED"))
        uptime_ms = int(envelope.get("uptime_ms", envelope.get("uptime", 0)))

        # Support both short wire-format keys and verbose model keys
        co_ppm = float(payload.get("co", payload.get("co_ppm", 0.0)))
        temp_c = float(payload.get("temp", payload.get("temp_c", 0.0)))
        hum = float(payload.get("hum", payload.get("humidity_pct", 0.0)))
        fall = 1 if payload.get("fall", payload.get("fall_detected", False)) else 0
        batt = float(payload.get("batt", payload.get("battery_v", 0.0)))
        sim = 1 if payload.get("sim", payload.get("is_simulated", True)) else 0
        sok = 1 if payload.get("ok", payload.get("sensor_ok", True)) else 0

        conn = self.get_connection()
        try:
            with conn:
                # Check for existing sequence number from this node (deduplication)
                existing = conn.execute(
                    "SELECT 1 FROM telemetry WHERE node_id = ? AND seq = ?",
                    (node_id, seq)
                ).fetchone()

                if existing:
                    return False, True

                # Insert new telemetry
                conn.execute("""
                    INSERT INTO telemetry (
                        node_id, seq, zone, co_ppm, temp_c, humidity_pct,
                        fall_detected, battery_v, is_simulated, sensor_ok,
                        uptime_ms, received_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (node_id, seq, zone, co_ppm, temp_c, hum, fall, batt, sim, sok, uptime_ms, now))

                # Upsert active node record
                conn.execute("""
                    INSERT INTO nodes (
                        node_id, role, current_zone, last_seen_ts, last_seq,
                        battery_v, status, is_simulated, sensor_ok,
                        latest_co, latest_temp, latest_hum
                    ) VALUES (?, ?, ?, ?, ?, ?, 'ONLINE', ?, ?, ?, ?, ?)
                    ON CONFLICT(node_id) DO UPDATE SET
                        role = excluded.role,
                        current_zone = excluded.current_zone,
                        last_seen_ts = excluded.last_seen_ts,
                        last_seq = excluded.last_seq,
                        battery_v = excluded.battery_v,
                        status = 'ONLINE',
                        is_simulated = excluded.is_simulated,
                        sensor_ok = excluded.sensor_ok,
                        latest_co = excluded.latest_co,
                        latest_temp = excluded.latest_temp,
                        latest_hum = excluded.latest_hum
                """, (node_id, role, zone, now, seq, batt, sim, sok, co_ppm, temp_c, hum))

                return True, False
        finally:
            conn.close()

    def record_alert(self, envelope: Dict[str, Any], payload: Dict[str, Any]) -> Tuple[bool, bool, int]:
        """
        Records an emergency or safety alert.
        Returns (recorded: bool, deduplicated: bool, alert_id: int).
        """
        now = int(time.time() * 1000)
        node_id = envelope.get("sender_id", envelope.get("sender", "UNKNOWN"))
        seq = int(envelope.get("seq", 0))
        role = envelope.get("role", "WEARABLE")
        zone = envelope.get("zone_id", envelope.get("zone", "UNASSIGNED"))

        sev = payload.get("severity", "WARNING")
        code = payload.get("code", payload.get("alert_code", "UNKNOWN"))
        details = payload.get("details", "")
        val = float(payload.get("val", payload.get("trigger_value", 0.0)))

        conn = self.get_connection()
        try:
            with conn:
                existing = conn.execute(
                    "SELECT alert_id FROM alerts WHERE node_id = ? AND seq = ? AND alert_code = ?",
                    (node_id, seq, code)
                ).fetchone()

                if existing:
                    return False, True, existing["alert_id"]

                cur = conn.execute("""
                    INSERT INTO alerts (
                        node_id, zone, severity, alert_code, details,
                        trigger_value, status, created_at, seq
                    ) VALUES (?, ?, ?, ?, ?, ?, 'NEW', ?, ?)
                """, (node_id, zone, sev, code, details, val, now, seq))
                alert_id = cur.lastrowid

                # Audit log
                conn.execute("""
                    INSERT INTO audit_log (timestamp, actor, action, details)
                    VALUES (?, ?, 'ALERT_TRIGGERED', ?)
                """, (now, node_id, f"Severity: {sev} | Code: {code} | Zone: {zone} | Val: {val}"))

                # Update node's last seen status
                conn.execute("""
                    INSERT INTO nodes (node_id, role, current_zone, last_seen_ts, status)
                    VALUES (?, ?, ?, ?, 'ONLINE')
                    ON CONFLICT(node_id) DO UPDATE SET
                        last_seen_ts = excluded.last_seen_ts,
                        current_zone = excluded.current_zone,
                        status = 'ONLINE'
                """, (node_id, role, zone, now))

                return True, False, alert_id
        finally:
            conn.close()

    def record_heartbeat(self, envelope: Dict[str, Any], payload: Dict[str, Any]) -> Tuple[bool, bool]:
        """Records node heartbeat and updates health status."""
        now = int(time.time() * 1000)
        node_id = envelope.get("sender_id", envelope.get("sender", "UNKNOWN"))
        role = envelope.get("role", "ANCHOR")
        zone = envelope.get("zone_id", envelope.get("zone", "UNASSIGNED"))
        heap = int(payload.get("heap", payload.get("free_heap", 0)))
        batt = float(payload.get("batt", payload.get("battery_v", 0.0)))

        conn = self.get_connection()
        try:
            with conn:
                conn.execute("""
                    INSERT INTO nodes (node_id, role, current_zone, last_seen_ts, battery_v, free_heap, status)
                    VALUES (?, ?, ?, ?, ?, ?, 'ONLINE')
                    ON CONFLICT(node_id) DO UPDATE SET
                        last_seen_ts = excluded.last_seen_ts,
                        battery_v = excluded.battery_v,
                        free_heap = excluded.free_heap,
                        status = 'ONLINE'
                """, (node_id, role, zone, now, batt, heap))
                return True, False
        finally:
            conn.close()

    # -------------------------------------------------------------------------
    # Alert Lifecycle Management
    # -------------------------------------------------------------------------

    def acknowledge_alert(self, alert_id: int, officer_name: str) -> bool:
        """Transitions alert from NEW to ACKNOWLEDGED."""
        now = int(time.time() * 1000)
        conn = self.get_connection()
        try:
            with conn:
                cur = conn.execute("""
                    UPDATE alerts
                    SET status = 'ACKNOWLEDGED',
                        acknowledged_at = ?,
                        acknowledged_by = ?
                    WHERE alert_id = ? AND status = 'NEW'
                """, (now, officer_name, alert_id))

                if cur.rowcount > 0:
                    conn.execute("""
                        INSERT INTO audit_log (timestamp, actor, action, details)
                        VALUES (?, ?, 'ALERT_ACKNOWLEDGED', ?)
                    """, (now, officer_name, f"Alert #{alert_id} acknowledged by {officer_name}"))
                    return True
                return False
        finally:
            conn.close()

    def resolve_alert(self, alert_id: int, officer_name: str, notes: str = "") -> bool:
        """Transitions alert to RESOLVED."""
        now = int(time.time() * 1000)
        conn = self.get_connection()
        try:
            with conn:
                cur = conn.execute("""
                    UPDATE alerts
                    SET status = 'RESOLVED',
                        resolved_at = ?,
                        resolved_by = ?,
                        resolution_notes = ?
                    WHERE alert_id = ? AND status != 'RESOLVED'
                """, (now, officer_name, notes, alert_id))

                if cur.rowcount > 0:
                    conn.execute("""
                        INSERT INTO audit_log (timestamp, actor, action, details)
                        VALUES (?, ?, 'ALERT_RESOLVED', ?)
                    """, (now, officer_name, f"Alert #{alert_id} resolved: {notes}"))
                    return True
                return False
        finally:
            conn.close()

    # -------------------------------------------------------------------------
    # Watchdog & Stale Node Detection
    # -------------------------------------------------------------------------

    def update_node_watchdog(self, stale_threshold_sec: int, offline_threshold_sec: int) -> Dict[str, int]:
        """
        Scans nodes and flags STALE or OFFLINE states.
        Raises COMM_LOST alert when an active miner goes offline.
        """
        now = int(time.time() * 1000)
        stale_limit = now - (stale_threshold_sec * 1000)
        offline_limit = now - (offline_threshold_sec * 1000)

        conn = self.get_connection()
        try:
            with conn:
                # 1. Flag Stale Nodes
                cur_stale = conn.execute("""
                    UPDATE nodes
                    SET status = 'STALE'
                    WHERE last_seen_ts < ? AND last_seen_ts >= ? AND status = 'ONLINE'
                """, (stale_limit, offline_limit))
                flagged_stale = cur_stale.rowcount

                # 2. Find nodes about to transition to OFFLINE to generate alerts
                dropping_nodes = conn.execute("""
                    SELECT node_id, role, current_zone FROM nodes
                    WHERE last_seen_ts < ? AND status != 'OFFLINE'
                """, (offline_limit,)).fetchall()

                for node in dropping_nodes:
                    nid = node["node_id"]
                    zone = node["current_zone"]
                    role = node["role"]

                    # Generate automated COMM_LOST safety alert
                    conn.execute("""
                        INSERT INTO alerts (
                            node_id, zone, severity, alert_code, details,
                            trigger_value, status, created_at, seq
                        ) VALUES (?, ?, 'WARNING', 'COMM_LOST', ?, 0.0, 'NEW', ?, 0)
                    """, (nid, zone, f"Node {nid} ({role}) lost underground communication in {zone}", now))

                    conn.execute("""
                        INSERT INTO audit_log (timestamp, actor, action, details)
                        VALUES (?, 'SYSTEM_WATCHDOG', 'COMM_LOST', ?)
                    """, (now, f"Node {nid} marked OFFLINE in {zone}"))

                # Update status to OFFLINE
                cur_offline = conn.execute("""
                    UPDATE nodes
                    SET status = 'OFFLINE'
                    WHERE last_seen_ts < ? AND status != 'OFFLINE'
                """, (offline_limit,))
                flagged_offline = cur_offline.rowcount

            return {"stale": flagged_stale, "offline": flagged_offline}
        finally:
            conn.close()

    # -------------------------------------------------------------------------
    # Query Methods
    # -------------------------------------------------------------------------

    def get_nodes(self) -> List[Dict[str, Any]]:
        conn = self.get_connection()
        try:
            rows = conn.execute("SELECT * FROM nodes ORDER BY node_id ASC").fetchall()
            return [dict(r) for r in rows]
        finally:
            conn.close()

    def get_node(self, node_id: str) -> Optional[Dict[str, Any]]:
        conn = self.get_connection()
        try:
            row = conn.execute("SELECT * FROM nodes WHERE node_id = ?", (node_id,)).fetchone()
            return dict(row) if row else None
        finally:
            conn.close()

    def get_node_history(self, node_id: str, limit: int = 50) -> List[Dict[str, Any]]:
        conn = self.get_connection()
        try:
            rows = conn.execute("""
                SELECT * FROM telemetry
                WHERE node_id = ?
                ORDER BY received_at DESC
                LIMIT ?
            """, (node_id, limit)).fetchall()
            return [dict(r) for r in rows]
        finally:
            conn.close()

    def get_alerts(self, status: Optional[str] = None, severity: Optional[str] = None, limit: int = 100) -> List[Dict[str, Any]]:
        query = "SELECT * FROM alerts WHERE 1=1"
        params = []
        if status:
            query += " AND status = ?"
            params.append(status)
        if severity:
            query += " AND severity = ?"
            params.append(severity)
        query += " ORDER BY created_at DESC LIMIT ?"
        params.append(limit)

        conn = self.get_connection()
        try:
            rows = conn.execute(query, params).fetchall()
            return [dict(r) for r in rows]
        finally:
            conn.close()

    def get_alert(self, alert_id: int) -> Optional[Dict[str, Any]]:
        conn = self.get_connection()
        try:
            row = conn.execute("SELECT * FROM alerts WHERE alert_id = ?", (alert_id,)).fetchone()
            return dict(row) if row else None
        finally:
            conn.close()

    def get_audit_log(self, limit: int = 100) -> List[Dict[str, Any]]:
        conn = self.get_connection()
        try:
            rows = conn.execute("SELECT * FROM audit_log ORDER BY timestamp DESC LIMIT ?", (limit,)).fetchall()
            return [dict(r) for r in rows]
        finally:
            conn.close()

    def get_system_summary(self) -> Dict[str, Any]:
        """Calculates high-level mine situational metrics for safety officers."""
        conn = self.get_connection()
        try:
            total_nodes = conn.execute("SELECT COUNT(*) FROM nodes").fetchone()[0]
            online_miners = conn.execute("SELECT COUNT(*) FROM nodes WHERE role = 'WEARABLE' AND status = 'ONLINE'").fetchone()[0]
            stale_nodes = conn.execute("SELECT COUNT(*) FROM nodes WHERE status = 'STALE'").fetchone()[0]
            offline_nodes = conn.execute("SELECT COUNT(*) FROM nodes WHERE status = 'OFFLINE'").fetchone()[0]

            new_alerts = conn.execute("SELECT COUNT(*) FROM alerts WHERE status = 'NEW'").fetchone()[0]
            crit_alerts = conn.execute("SELECT COUNT(*) FROM alerts WHERE status = 'NEW' AND severity = 'CRITICAL'").fetchone()[0]
            ack_alerts = conn.execute("SELECT COUNT(*) FROM alerts WHERE status = 'ACKNOWLEDGED'").fetchone()[0]

            gas_warnings = conn.execute(
                "SELECT COUNT(*) FROM nodes WHERE latest_co >= ? AND latest_co < ?",
                (CO_WARN_PPM, CO_CRIT_PPM)
            ).fetchone()[0]
            gas_critical = conn.execute(
                "SELECT COUNT(*) FROM nodes WHERE latest_co >= ?",
                (CO_CRIT_PPM,)
            ).fetchone()[0]

            last_telemetry = conn.execute("SELECT MAX(received_at) FROM telemetry").fetchone()[0]

            return {
                "total_nodes_tracked": total_nodes,
                "online_miners": online_miners,
                "stale_nodes": stale_nodes,
                "offline_nodes": offline_nodes,
                "active_unacknowledged_alerts": new_alerts,
                "critical_emergencies": crit_alerts,
                "acknowledged_in_progress": ack_alerts,
                "miners_in_gas_warning": gas_warnings,
                "miners_in_gas_critical": gas_critical,
                "last_packet_received_ms": last_telemetry or 0,
            }
        finally:
            conn.close()
