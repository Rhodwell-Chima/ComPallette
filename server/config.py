"""
COMPALLETTE SERVER CONFIGURATION
================================
Centralized configuration parameters for the Compallette monitoring backend,
database paths, API security, and node watchdog timeout limits.
"""

import os

# Server Network Settings
SERVER_HOST = os.getenv("COMPALLETTE_HOST", "0.0.0.0")
SERVER_PORT = int(os.getenv("COMPALLETTE_PORT", 8080))

# Database Settings
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DEFAULT_DB_PATH = os.path.join(BASE_DIR, "data", "compallette.db")
DB_PATH = os.getenv("COMPALLETTE_DB_PATH", DEFAULT_DB_PATH)

# Security Credentials
# Shared secret key matching Config.h BACKEND_API_KEY for gateway authentication
API_KEY = os.getenv("COMPALLETTE_API_KEY", "compallette-mining-secret-key-v1")

# Watchdog Node Inactivity Thresholds (Seconds)
# Underground nodes normally report every 5s; silence triggers safety warnings
STALE_THRESHOLD_SECONDS = int(os.getenv("COMPALLETTE_STALE_SEC", 20))
OFFLINE_THRESHOLD_SECONDS = int(os.getenv("COMPALLETTE_OFFLINE_SEC", 45))
WATCHDOG_CHECK_INTERVAL = int(os.getenv("COMPALLETTE_WATCHDOG_INTERVAL", 5))

# Gas Threshold Limits (PPM Carbon Monoxide)
CO_WARN_PPM = 25.0
CO_CRIT_PPM = 50.0
