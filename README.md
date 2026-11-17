# COMPALLETTE | Underground Mining Safety Platform

IoT-based subterranean safety monitoring system designed for underground mines (with primary calibration for Zambian copperbelt mining conditions). Integrates ESP32 wireless mesh networks (`MineMesh_Zambia`), multi-hazard detection (CO, falls, microclimate), automated emergency alarming, subterranean spatial digital twins, and modular backends for high-throughput edge telemetry ingestion.

---

## Table of Contents
1. [Repository Architecture](#repository-architecture)
2. [Embedded Firmware Setup (ESP32 & Freenove)](#embedded-firmware-setup-esp32--freenove)
   - [Supported Hardware](#supported-hardware)
   - [Hardware Pin Mapping](#hardware-pin-mapping)
   - [Flashing via Arduino IDE](#flashing-via-arduino-ide)
   - [SoftAP Captive Portal Commissioning](#softap-captive-portal-commissioning)
   - [Interactive Serial Monitor CLI](#interactive-serial-monitor-cli)
3. [Backend Setup](#backend-setup)
   - [Full Stack via Docker Compose](#1-full-stack-via-docker-compose)
   - [High-Performance Rust (Rocket) Backend via Docker](#2-high-performance-rust-rocket-backend)
   - [Local Native Django Setup](#3-local-native-django-setup)
   - [Local Native Rust Rocket Setup](#4-local-native-rust-rocket-setup)
4. [Frontend Setup (React Industrial Cockpit)](#frontend-setup-react-industrial-cockpit)
5. [Testing, Simulation & Benchmarking](#testing-simulation--benchmarking)
6. [Wire-Protocol API Contract (v1)](#wire-protocol-api-contract-v1)
7. [RSSI Feasibility Trial](#rssi-feasibility-trial)

---

## Repository Architecture

```
ComPallete/
├── ComPallete/                 # ESP32 Firmware Sketch (Arduino IDE / PlatformIO)
│   ├── ComPallete.ino         # Main entrypoint with dual-mode dispatch & Serial CLI
│   ├── Config.h               # Network parameters, thresholds, roles, pinouts
│   ├── Protocol.h / .cpp      # Wire-protocol v1 envelopes, seq numbers, legacy codec
│   ├── NodeConfigManager.h/.cpp # NVS persistent storage & runtime dynamic commissioning
│   ├── CaptivePortalManager.h/.cpp # Isolated SoftAP & mobile setup web server
│   ├── GatewayManager.h / .cpp# Wi-Fi STA uplink, exponential backoff, HTTP dispatch
│   ├── SensorHAL.h / .cpp     # Resilient Hardware Abstraction (MQ-7, MPU6050, ADC)
│   └── OfflineBuffer.h / .cpp # Priority queue preemption (alerts first), LittleFS flash buffer
│
├── backend/                    # Multi-Backend Implementations (Benchmarking & Parity)
│   ├── django/                # Production API: Django REST Framework / PostgreSQL
│   └── rocket/                # Experimental comparison implementation (not deployed by Compose)
│
├── frontend/                   # Multi-Frontend Implementations
│   └── react/                 # React 18 / TypeScript / Vite / Canvas 2.5D Mine Twin
│
├── server/                     # Legacy standalone prototype (not a production fallback)
├── tests/                      # Automated unit tests & wire-contract verification
└── tools/                      # Subterranean mesh simulators & load benchmark harness
```

---

## Embedded Firmware Setup (ESP32 & Freenove)

### Supported Hardware
The firmware includes automatic chip and board detection for:
- **Freenove ESP32-WROOM** (Standard classic ESP32, CP2102/CH340 USB-to-UART)
- **Freenove ESP32-WROVER / ESP32-CAM** (Classic ESP32 with external PSRAM)
- **Freenove ESP32-S3 WROOM / CAM** (ESP32-S3 dual-core, native USB CDC on GPIO 19/20)

### Hardware Pin Mapping

| Peripheral Subsystem | ESP32 Classic (WROOM / WROVER) | ESP32-S3 (Freenove S3) | Notes |
|---|---|---|---|
| **MQ-7 CO Gas Sensor** | `GPIO 34` (ADC1_CH6) | `GPIO 4` (ADC1_CH3) | Analog 0-3.3V input |
| **MPU-6050 IMU SDA** | `GPIO 21` | `GPIO 8` | Standard hardware I2C |
| **MPU-6050 IMU SCL** | `GPIO 22` | `GPIO 9` | Standard hardware I2C |
| **Battery ADC Divider** | `GPIO 35` (ADC1_CH7) | `GPIO 5` (ADC1_CH4) | 1:2 resistor divider (100k/100k) |
| **Emergency SOS Button** | `GPIO 19` | `GPIO 14` | Active LOW with internal pull-up |
| **Onboard Status LED** | `GPIO 2` | `GPIO 2` (or WS2812) | Heartbeat and alarm indicator |
| **Active Alarm Buzzer** | `GPIO 18` | `GPIO 18` | 3.3V active piezo buzzer |
| **BOOT Setup Button** | `GPIO 0` | `GPIO 0` | Hold >= 3s to enter SoftAP setup mode |

---

### Flashing via Arduino IDE

#### 1. Install ESP32 Board Package
1. In Arduino IDE, open **File > Preferences**.
2. In **Additional boards manager URLs**, add:
   ```text
   https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_index.json
   ```
3. Open **Tools > Board > Boards Manager**, search for `esp32` by Espressif Systems, and install version `3.3.12`.

#### 2. Install Required Libraries
Open **Tools > Manage Libraries** and install:
- **`painlessMesh` version `1.5.7`** (by painlessMesh contributors)
- **`ArduinoJson`** (version 6.21.x or 7.x by Benoit Blanchon)
- **`Adafruit MPU6050`** (by Adafruit)
- **`Adafruit BusIO`** & **`Adafruit Unified Sensor`**

#### 3. Board Settings in Arduino IDE
For **Freenove ESP32-WROOM / WROVER**:
- **Board**: `ESP32 Dev Module`
- **Upload Speed**: `921600` (or `115200` if connection is noisy)
- **Flash Frequency**: `80MHz`
- **Flash Size**: `4MB (32Mb)`
- **Partition Scheme**: `Huge APP (3MB No OTA/1MB SPIFFS)` or `Default 4MB with spiffs`
- **Core Debug Level**: `None` (or `Info` for verbose diagnostics)

For **Freenove ESP32-S3**:
- **Board**: `ESP32S3 Dev Module`
- **USB CDC On Boot**: `Enabled` *(Crucial for Serial Monitor over native USB)*
- **Upload Mode**: `UART0 / Hardware CDC`
- **Partition Scheme**: `Huge APP (3MB No OTA/1MB SPIFFS)`

#### 4. Upload Firmware
1. Connect your ESP32 to your PC via USB.
2. Select the correct COM port under **Tools > Port**.
3. Open `ComPallete/ComPallete.ino`.
4. Click **Upload**.

---

### SoftAP Captive Portal Commissioning

When a node is uncommissioned (fresh flash or factory reset), it automatically isolates the Wi-Fi radio into a **Dedicated SoftAP Captive Portal** (painlessMesh is paused to guarantee 100% reliable AP association).

```
+--------------------------------------------------------------+
|         COMPALLETTE LOCAL WI-FI CAPTIVE PORTAL ONLINE        |
+--------------------------------------------------------------+
  |-- SoftAP SSID    : Compallette-Setup-XXXX
  |-- Setup Password : <temporary WPA2 password printed on serial>
  |-- Portal URL     : http://192.168.4.1
```

#### Step-by-Step Commissioning Walkthrough:
1. **Trigger Setup Mode**:
   - On an already-configured node, either **hold the onboard BOOT button (GPIO 0) for 3 seconds**, OR
   - Open Serial Monitor and type `setup`.
2. **Connect to Wi-Fi**:
   - On your smartphone, tablet, or laptop, connect to the protected setup Wi-Fi network:
     `Compallette-Setup-<CHIP_ID>` (e.g. `Compallette-Setup-8F4C2A`).
   - Enter the temporary password printed on the node's serial console. The password is generated fresh for each setup-AP start and is deliberately not stored in NVS. If you miss it, type `portal` in Serial Monitor while the setup AP is active to print it again.
   - A firmware version that printed the password before generating it cannot recover that old password. Flash the corrected firmware, enter `setup` again, and use the newly generated password.
3. **Open Portal**:
   - The captive portal prompt will appear automatically.
   - Alternatively, open any browser and navigate to `http://192.168.4.1`.
4. **Configure Node Profile**:
   - **Operational Role**:
     - `Wearable Miner Tag`: Emits periodic telemetry, battery, and fall detection.
     - `Stationary Anchor`: Serves as tunnel location reference and mesh router.
     - `Gateway Bridge`: Connects to surface Wi-Fi and bridges mesh packets to the REST API backend. Configure the same 32–63 character API key as `COMPALLETTE_API_KEY` in the backend environment.
   - **Assigned Badge ID**: e.g., `MINER-106`, `ANCHOR-LVL2-Z01`, `GW-SURFACE-01`.
   - **Subterranean Zone**:
     - For **Stationary Anchors & Gateways**: Physical tunnel drift/stope where the node is bolted/mounted (e.g., `LEVEL-2-NORTH-DRIFT`, `LEVEL-3-ACTIVE-STOPE`).
     - For **Wearable Miner Tags**: Handled automatically via **Option 1 Dynamic Proximity Tracking**. Mobile miner tags continuously listen for nearby stationary anchor beacons and dynamically adopt the zone of the nearest anchor as miners roam through underground tunnels.
   - **Mesh SSID & Channel**: Default `MineMesh_Zambia` on Channel `6`. The Gateway's surface router must use the same 2.4 GHz channel. ESP32 mesh AP and Wi-Fi station mode share one radio channel.
5. **Save & Commission**:
   - Click **Save & Commission Node**.
   - Configuration is committed to NVS flash, and the node automatically reboots into **Production Mesh Mode**.

#### Gateway ingestion check

After commissioning a Gateway, run `testpost` at 115200 baud. A successful result is an HTTP `2xx` response followed by `GW DIRECT TEST SUCCESS`. HTTP `401` or `403` means that the device reached Django but its saved Gateway API key is absent or differs from `COMPALLETTE_API_KEY` in the backend deployment. Re-enter the exact protected deployment key in the captive portal's **Gateway API Key** field, save, allow the Gateway to restart, and run `testpost` again. Do not add the key to source code or paste it into serial logs.

---

### Interactive Serial Monitor CLI

The firmware includes a full-featured, non-blocking serial command-line interface running at **115200 baud**. You can control and inspect the node without physical access to the device:

| Command | Action |
|---|---|
| `help` or `?` | Displays all available CLI commands and usage instructions |
| `status` | Prints live telemetry (CO ppm, IMU acceleration vector, battery voltage/percentage, dynamic subterranean zone, nearest anchor, heap, uptime, mesh peers) |
| `setup` | Forces node into SoftAP Captive Portal commissioning mode and restarts |
| `portal` or `credentials` | Prints the active SoftAP SSID and temporary setup password to the physical serial console only |
| `mesh` | Exits setup mode, marks node as commissioned, and boots into Production Mesh |
| `scan` | Scans the I2C bus (detecting MPU6050 address `0x68`). Wi-Fi spectrum scans are intentionally disabled because they disrupt the live mesh radio. |
| `role <0\|1\|2>` | Changes operational role (`0`: Wearable, `1`: Anchor, `2`: Gateway) and persists to NVS |
| `id <name>` | Updates node device ID (e.g., `id MINER-109`) and commits to NVS |
| `zone [name\|auto]` | Displays current zone; for Wearables: `zone <name>` sets test override, `zone auto` resumes dynamic anchor tracking. For Anchors/Gateways: sets fixed zone in NVS |
| `reset` | Performs factory reset (wipes NVS credentials) and restarts into setup portal |
| `reboot` | Performs a clean software restart of the ESP32 |

---

### Gateway radio and mesh channel

The Gateway uses painlessMesh `1.5.7` as the sole owner of the ESP32 station interface. It initializes the mesh with the explicit TCP port and commissioned channel, then uses `stationManual()` for the surface router. Do not add a separate `WiFi.begin()` loop to the Gateway transport manager.

The Gateway's 2.4 GHz router and every commissioned mesh node must use the same channel. The default is channel `6`; configure the `Innov_Hub` 2.4 GHz radio to a fixed channel `6`, or commission every node with the router's fixed channel before deployment. `Innov_Hub` may continue to offer its 5 GHz radio, including on a different channel, under the same SSID and password: ESP32-WROOM and ESP32-S3 join the separate 2.4 GHz BSSID only. The Gateway logs its configured mesh channel and the router's actual channel after association. A mismatch is an operational configuration fault that can cause peer disconnects.

Each boot logs an ESP reset-reason code, and production-mesh startup logs the node ID, TCP port, and radio channel. The Gateway also logs router association, DHCP completion, and disconnect reason. These lines distinguish a real MCU reboot from mesh peer changes or a Wi-Fi association retry.

---

## Backend Setup

### 1. Production-shaped local stack via Docker Compose
Starts PostgreSQL, the Django API, a separate watchdog worker, and the React dashboard. Create a local `.env` from `.env.example` and replace every placeholder with unique secrets before starting:
```bash
cp .env.example .env
docker compose up --build
```
- **Cockpit Dashboard**: `http://localhost:3000`
- **Django REST API**: `http://localhost:8000`
- **PostgreSQL Database**: `localhost:5432`

---

The React dashboard requires a Django staff account. Create one with `docker compose exec backend python manage.py createsuperuser`, then sign in through the dashboard. This is an interactive, one-time bootstrap action; ComPallette never creates a default operator account or stores an operator password in source control. Device ingestion uses the shared `COMPALLETTE_API_KEY` from `.env`; configure that same value in each Gateway's protected setup portal. Credentials are currently shared across Gateways and the embedded HTTP client does not yet establish TLS. Use this Compose setup only on a trusted development network; production deployment still needs HTTPS termination and a per-device credential/rotation policy.

### Deploying dashboard changes and verifying readiness

A container restart does **not** rebuild the React static bundle. Every frontend or backend source deployment must use a build and recreation step. Set the same immutable source revision for the frontend and Django health response before deployment:

```powershell
$env:COMPALLETTE_BUILD_REVISION = (git rev-parse --short HEAD)
docker compose up -d --build --force-recreate backend frontend watchdog
docker compose exec backend python manage.py check_deployment_readiness
curl.exe http://localhost:3000/health/
```

`check_deployment_readiness` fails until the database is migrated, at least one active staff operator exists, and a non-development build revision is supplied when `DEBUG=0`. The dashboard header shows `UI <revision> · API <revision>`; the revisions must match. `http://localhost:3000` is the browser entry point and proxies dashboard API calls to Django. Port `8000` remains the Gateway/device ingestion and backend diagnostic endpoint, not the dashboard origin.

### 2. Experimental Rust Backend
The Rocket implementation is retained for comparison only. It is not part of the supported production Compose topology and has not been shown to match the Django security, validation, and delivery contract.

---

### 3. Local Native Django Setup

For local Python development without Docker:

```bash
cd backend/django

# 1. Create and activate a virtual environment
python -m venv venv
# On Windows PowerShell:
.\venv\Scripts\Activate.ps1
# On Linux/macOS:
source venv/bin/activate

# 2. Install dependencies
pip install -r requirements.txt

# 3. Configure required settings in the shell before running.
# SECRET_KEY and COMPALLETTE_API_KEY must each be unique values of at least 32 characters.
# DB_HOST absent selects SQLite for development.
# PowerShell example (use generated values, not these placeholders):
# $env:SECRET_KEY = '<generated-secret>'
# $env:COMPALLETTE_API_KEY = '<generated-device-key>'
# 4. Apply database migrations
python manage.py migrate

# 4. (Optional) Create an administrative superuser
python manage.py createsuperuser

# 5. Start the development server
python manage.py runserver 0.0.0.0:8000
```
Run node status monitoring separately during local development with `python manage.py run_watchdog`.

---

### 4. Local Native Rust Rocket Setup

For native Rust development:

```bash
cd backend/rocket

# 1. Ensure Rust toolchain is installed (via https://rustup.rs)
rustc --version
cargo --version

# 2. Run the Rocket ingestion engine
cargo run --release
```
The server will bind to `0.0.0.0:8000`. You can pass environment variables such as:
```bash
# Windows PowerShell
$env:COMPALLETTE_API_KEY="compallette-mining-secret-key-v1"
cargo run --release
```

---

## Frontend Setup (React Industrial Cockpit)

The dashboard is built with React 18, TypeScript, Vite, and an interactive HTML5 Canvas 2.5D Mine Digital Twin.

```bash
cd frontend/react

# 1. Install dependencies
npm install

# 2. Configure environment (optional, defaults to http://localhost:8000)
# Create .env.local:
# VITE_API_BASE_URL=http://localhost:8000

# 3. Start development server
npm run dev
```
Open `http://localhost:5173` (or `http://localhost:3000` in Docker) to view real-time miner tags, alert incidents, and environmental gauges.

---

## Testing, Simulation & Benchmarking

### 1. Subterranean Mesh Traffic Simulator
Simulate 10+ underground wearable miner nodes and stationary anchors streaming packets to the backend:
```bash
python tools/simulate_mesh.py --forward-to http://127.0.0.1:8000
```

### 2. Automated Wire API Contract Verification
Verify that your backend (Django or Rocket) strictly complies with the v1 API wire specification:
```bash
python tests/test_api_contract.py --url http://127.0.0.1:8000
```

### 3. High-Load Benchmarking (Django vs. Rocket)
Stress-test ingestion throughput and measure p50/p95/p99 latency under simulated emergency storms:
```bash
# Benchmark Django API
python tools/benchmark_load.py --url http://127.0.0.1:8000 --requests 1000 --concurrency 20

# Benchmark Rocket API
python tools/benchmark_load.py --url http://127.0.0.1:8001 --requests 1000 --concurrency 20
```

---

## Wire-Protocol API Contract (v1)

| Method | Endpoint | Description | Auth Required |
|---|---|---|---|
| `GET` | `/health` | Service health, engine identification, and deployed build revision | No |
| `POST` | `/api/v1/telemetry` | Time-series miner telemetry ingestion | `X-API-Key` |
| `POST` | `/api/v1/alert` | High-priority safety hazard ingestion | `X-API-Key` |
| `POST` | `/api/v1/heartbeat` | Background mesh node keep-alive | `X-API-Key` |
| `GET` | `/api/v1/system/summary` | Real-time KPI counters | Operator Session |
| `GET` | `/api/v1/provision/pending` | Pending device assignments | Staff Operator Session |
| `POST` | `/api/v1/provision/assign` | Assign device identity and zone | Staff Operator Session + CSRF |
| `POST` | `/api/v1/alerts/{id}/ack` | Safety officer incident acknowledgement | Staff Operator Session + CSRF |
| `POST` | `/api/v1/alerts/{id}/resolve` | Incident resolution & root-cause logging | Staff Operator Session + CSRF |
| `POST` | `/api/v1/provision/request` | Gateway forwards uncommissioned node request | `X-API-Key` |
| `POST` | `/api/v1/provision/confirm` | Gateway confirms commissioning | `X-API-Key` |

Operator sessions are established at `POST /api/v1/auth/session`; first request `GET /api/v1/auth/csrf` to obtain the CSRF cookie. Dashboard reads and operator workflows require a signed-in session. Provision assignment and alert lifecycle actions record the authenticated username rather than trusting an officer name in the request body. Node ingestion and provisioning gateway routes require the configured device API key.

## RSSI Feasibility Trial

RSSI-based zones are **not enabled**. Legacy beacon-driven wearable zone changes are compile-time disabled until direct-link measurements pass the pilot. The firmware contains opt-in serial diagnostics for direct association evidence only; it does not infer zones from RSSI. To collect trial data, temporarily set `ENABLE_RADIO_DIAGNOSTICS` to `1` in `ComPallete/RadioDiagnostics.h`, flash the board, and restore the default (`0`) after the trial. The logger samples every five seconds and prints local STA/AP MACs, the current STA parent BSSID/RSSI/channel, and associated SoftAP child MAC/RSSI. It does not scan channels or alter the mesh.

Run direct-link trials with one wearable and one Anchor, then swap WROOM and S3 roles. Collect stationary samples at each intended zone with varied distance, orientation, body placement, and obstruction. Add a third node as a relay and verify only direct parent/child associations create RSSI records. Record Arduino ESP32 Core `3.3.12`, painlessMesh `1.5.7`, AsyncTCP, and ArduinoJson versions with each run. This checkout does not identify its AsyncTCP or ArduinoJson installations, so those still need recording in the trial report.

Do not treat relayed application messages as direct RSSI evidence. Only advance to coarse-zone inference after held-out zone accuracy is at least 95% and static trials show no more than one false zone change per worker-hour. Those are pilot gates for operational decision support, not safety certification. If the gate fails, keep observations experimental and do not present inferred zones as confirmed locations.

### Operator alert resolution contract

`POST /api/v1/alerts/{id}/resolve` requires a JSON `notes` string containing non-whitespace operator-authored resolution evidence. The API trims valid notes. Missing, null, non-string, empty, or whitespace-only values return HTTP 400 with `{"error":"Resolution notes are required."}` and leave alert state and audit history unchanged. Existing permission checks and authenticated operator attribution still apply.

Deploy the updated operator frontend before or alongside this stricter API validation. Other clients must supply notes; no database migration or rewrite of historical resolutions is required. Frontend alert drafts are kept separately by site and alert in memory for the authenticated session, and are cleared on logout or reload.
