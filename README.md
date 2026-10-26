# COMPALLETTE | Underground Mining Safety Platform

IoT-based subterranean safety monitoring system designed for underground mines (with primary calibration for Zambian mining conditions). Integrates ESP32 wireless mesh networks (`MineMesh_Zambia`), multi-hazard detection (CO, falls, microclimate), automated emergency alarming, subterranean spatial digital twins, and modular backends for high-throughput edge telemetry ingestion.

---

## Repository Structure

```
ComPallete/
├── ComPallete/                 # ESP32 Firmware Sketch (Arduino IDE / PlatformIO)
│   ├── ComPallete.ino         # Main entrypoint sketch with role-based dispatch
│   ├── Config.h               # Network parameters, thresholds, roles, pinouts
│   ├── Protocol.h / .cpp      # Wire-protocol v1 envelopes, seq numbers, legacy codec
│   ├── GatewayManager.h / .cpp# Wi-Fi STA uplink, exponential backoff, HTTP dispatch
│   └── OfflineBuffer.h / .cpp # Priority queue preemption (alerts first), LittleFS flash buffer
│
├── backend/                    # Multi-Backend Implementations (Benchmarking & Parity)
│   ├── django/                # Python 5 / Django REST Framework / PostgreSQL
│   └── rocket/                # Rust 1.78+ / Rocket 0.5 (High-throughput async target)
│
├── frontend/                   # Multi-Frontend Implementations
│   └── react/                 # React 18 / TypeScript / Vite / Canvas 2.5D Mine Twin
│
├── server/                     # Standalone Python HTTP server (emergency zero-dep fallback)
├── tests/                      # Automated unit tests & wire-contract verification
└── tools/                      # Subterranean mesh simulators & load benchmark harness
```

---

## Quick Start

### 1. Full Stack via Docker Compose
To start PostgreSQL, the Django backend, and the React frontend:
```bash
docker compose up --build
```
* **Monitoring Dashboard**: `http://localhost:3000`
* **Backend API & Admin**: `http://localhost:8000`

### 2. High-Performance Rust (Rocket) Backend
To run the high-throughput Rust Rocket service alongside PostgreSQL and React:
```bash
docker compose --profile rocket up backend-rocket frontend db
```
* **Rocket API**: `http://localhost:8001` (or mapped to 8000)

### 3. Local Native Development

**Django Backend:**
```bash
cd backend/django
python manage.py runserver 8000
```
*(Automatically uses SQLite `compallette_dev.sqlite3` when Postgres is not running)*

**React Frontend:**
```bash
cd frontend/react
npm install
npm run dev
```

**ESP32 Mesh Simulator (Packets -> Backend):**
```bash
python tools/simulate_mesh.py --forward-to http://127.0.0.1:8000
```

---

## Benchmarking Backends (Django vs. Rocket)

Run the load benchmark harness to evaluate throughput, latency distribution (p50/p95/p99), and error rates under emergency packet storms:

```bash
# Benchmark Django
python tools/benchmark_load.py --url http://127.0.0.1:8000 --requests 1000 --concurrency 20

# Benchmark Rocket
python tools/benchmark_load.py --url http://127.0.0.1:8001 --requests 1000 --concurrency 20
```

---

## Wire-Protocol API Contract (v1)

All backends adhere to the following wire specification:

| Method | Endpoint | Description | Auth Required |
|---|---|---|---|
| `GET` | `/health` | Service health & engine identification | No |
| `POST` | `/api/v1/telemetry` | Time-series miner telemetry ingestion | `X-API-Key` |
| `POST` | `/api/v1/alert` | High-priority safety hazard ingestion | `X-API-Key` |
| `POST` | `/api/v1/heartbeat` | Background mesh node keep-alive | `X-API-Key` |
| `GET` | `/api/v1/system/summary` | Real-time KPI counters & watchdog check | No |
| `POST` | `/api/v1/alerts/{id}/ack` | Safety officer incident acknowledgement | Operator Session |
| `POST` | `/api/v1/alerts/{id}/resolve` | Incident resolution & root-cause logging | Operator Session |

Run contract verification against any running backend:
```bash
python tests/test_api_contract.py --url http://127.0.0.1:8000
```
