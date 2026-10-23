"""
COMPALLETTE NODE WATCHDOG SERVICE
=================================
Background daemon monitoring keep-alive telemetry from underground nodes.
Automatically detects stale nodes and raises COMM_LOST alerts when miners
or stationary anchors drop off the subterranean mesh.
"""

import os
import sys
import threading
import time
from typing import Optional

# Ensure repository root is in sys.path
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if REPO_ROOT not in sys.path:
    sys.path.insert(0, REPO_ROOT)

try:
    from server.config import (
        STALE_THRESHOLD_SECONDS,
        OFFLINE_THRESHOLD_SECONDS,
        WATCHDOG_CHECK_INTERVAL,
    )
    from server.database import Database
except ModuleNotFoundError:
    from config import (
        STALE_THRESHOLD_SECONDS,
        OFFLINE_THRESHOLD_SECONDS,
        WATCHDOG_CHECK_INTERVAL,
    )
    from database import Database


class NodeWatchdog:
    def __init__(
        self,
        db: Database,
        stale_sec: int = STALE_THRESHOLD_SECONDS,
        offline_sec: int = OFFLINE_THRESHOLD_SECONDS,
        interval_sec: int = WATCHDOG_CHECK_INTERVAL,
    ):
        self.db = db
        self.stale_sec = stale_sec
        self.offline_sec = offline_sec
        self.interval_sec = interval_sec

        self._stop_event = threading.Event()
        self._thread: Optional[threading.Thread] = None

    def start(self):
        """Starts the watchdog monitoring thread in daemon mode."""
        if self._thread and self._thread.is_alive():
            return
        self._stop_event.clear()
        self._thread = threading.Thread(target=self._run_loop, daemon=True, name="NodeWatchdogThread")
        self._thread.start()
        print(f"[WATCHDOG] Node inactivity monitor started (Interval: {self.interval_sec}s | Stale: {self.stale_sec}s | Offline: {self.offline_sec}s)")

    def stop(self):
        """Signals the watchdog thread to stop and joins."""
        if self._thread and self._thread.is_alive():
            self._stop_event.set()
            self._thread.join(timeout=2.0)
            print("[WATCHDOG] Node monitor stopped.")

    def run_check_once(self):
        """Performs a single evaluation pass (useful for tests)."""
        res = self.db.update_node_watchdog(self.stale_sec, self.offline_sec)
        if res["stale"] > 0 or res["offline"] > 0:
            print(f"[WATCHDOG UPDATE] Flagged {res['stale']} stale nodes, {res['offline']} offline nodes.")
        return res

    def _run_loop(self):
        while not self._stop_event.is_set():
            try:
                self.run_check_once()
            except Exception as e:
                print(f"[WATCHDOG ERROR] Exception during watchdog check: {e}")
            self._stop_event.wait(self.interval_sec)
