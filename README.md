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
│   ├── django/                # Python 3.12 / Django REST Framework / PostgreSQL
│   └── rocket/                # Rust (Latest) / Rocket 0.5 (High-throughput async target)
│
├── frontend/                   # Multi-Frontend Implementations
│   └── react/                 # React 18 / TypeScript / Vite / Canvas 2.5D Mine Twin
│
├── server/                     # Standalone Python HTTP server (emergency zero-dep fallback)
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
3. Open **Tools > Board > Boards Manager**, search for `esp32` by Espressif Systems, and install version `2.0.14` or `3.x`.

#### 2. Install Required Libraries
Open **Tools > Manage Libraries** and install:
- **`painlessMesh`** (by painlessMesh contributors)
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
  |-- SoftAP SSID    : Compallette-Setup-XXXX (OPEN)
  |-- Portal URL     : http://192.168.4.1
```

#### Step-by-Step Commissioning Walkthrough:
1. **Trigger Setup Mode**:
   - On an already-configured node, either **hold the onboard BOOT button (GPIO 0) for 3 seconds**, OR
   - Open Serial Monitor and type `setup`.
2. **Connect to Wi-Fi**:
   - On your smartphone, tablet, or laptop, connect to the open Wi-Fi network:
     `Compallette-Setup-<CHIP_ID>` (e.g. `Compallette-Setup-8F4C2A`).
3. **Open Portal**:
   - The captive portal prompt will appear automatically.
   - Alternatively, open any browser and navigate to `http://192.168.4.1`.
4. **Configure Node Profile**:
   - **Operational Role**:
     - `Wearable Miner Tag`: Emits periodic telemetry, battery, and fall detection.
     - `Stationary Anchor`: Serves as tunnel location reference and mesh router.
     - `Gateway Bridge`: Connects to surface Wi-Fi and bridges mesh packets to the REST API backend.
   - **Assigned Badge ID**: e.g., `MINER-106`, `ANCHOR-LVL2-Z01`, `GW-SURFACE-01`.
   - **Subterranean Zone**:
     - For **Stationary Anchors & Gateways**: Physical tunnel drift/stope where the node is bolted/mounted (e.g., `LEVEL-2-NORTH-DRIFT`, `LEVEL-3-ACTIVE-STOPE`).
     - For **Wearable Miner Tags**: Handled automatically via **Option 1 Dynamic Proximity Tracking**. Mobile miner tags continuously listen for nearby stationary anchor beacons and dynamically adopt the zone of the nearest anchor as miners roam through underground tunnels.
   - **Mesh SSID & Channel**: Default `MineMesh_Zambia` on Channel `6`.
5. **Save & Commission**:
   - Click **Save & Commission Node**.
   - Configuration is committed to NVS flash, and the node automatically reboots into **Production Mesh Mode**.

---

### Interactive Serial Monitor CLI

The firmware includes a full-featured, non-blocking serial command-line interface running at **115200 baud**. You can control and inspect the node without physical access to the device:

| Command | Action |
|---|---|
| `help` or `?` | Displays all available CLI commands and usage instructions |
| `status` | Prints live telemetry (CO ppm, IMU acceleration vector, battery voltage/percentage, dynamic subterranean zone, nearest anchor, heap, uptime, mesh peers) |
| `setup` | Forces node into SoftAP Captive Portal commissioning mode and restarts |
| `mesh` | Exits setup mode, marks node as commissioned, and boots into Production Mesh |
| `scan` | Scans I2C bus (detecting MPU6050 address `0x68`) and performs a 2.4 GHz Wi-Fi spectrum scan |
| `role <0\|1\|2>` | Changes operational role (`0`: Wearable, `1`: Anchor, `2`: Gateway) and persists to NVS |
| `id <name>` | Updates node device ID (e.g., `id MINER-109`) and commits to NVS |
| `zone [name\|auto]` | Displays current zone; for Wearables: `zone <name>` sets test override, `zone auto` resumes dynamic anchor tracking. For Anchors/Gateways: sets fixed zone in NVS |
| `reset` | Performs factory reset (wipes NVS credentials) and restarts into setup portal |
| `reboot` | Performs a clean software restart of the ESP32 |

---

## Backend Setup

### 1. Full Stack via Docker Compose
Starts PostgreSQL, the Python/Django REST API, and the React frontend dashboard:
```bash
docker compose up --build
```
- **Cockpit Dashboard**: `http://localhost:3000`
- **Django REST API**: `http://localhost:8000`
- **PostgreSQL Database**: `localhost:5432`

---

### 2. High-Performance Rust (Rocket) Backend
To run the high-throughput Rust Rocket service alongside PostgreSQL and the React frontend:
```bash
docker compose --profile rocket up -d backend-rocket frontend db
```
- **Rocket REST API**: `http://localhost:8001` (or mapped to `8000`)
- **Health Check**: `curl http://localhost:8001/health`

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

# 3. Apply database migrations (uses SQLite compallette_dev.sqlite3 automatically when Postgres is absent)
python manage.py migrate

# 4. (Optional) Create an administrative superuser
python manage.py createsuperuser

# 5. Start the development server
python manage.py runserver 0.0.0.0:8000
```

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
| `GET` | `/health` | Service health & engine identification | No |
| `POST` | `/api/v1/telemetry` | Time-series miner telemetry ingestion | `X-API-Key` |
| `POST` | `/api/v1/alert` | High-priority safety hazard ingestion | `X-API-Key` |
| `POST` | `/api/v1/heartbeat` | Background mesh node keep-alive | `X-API-Key` |
| `GET` | `/api/v1/system/summary` | Real-time KPI counters & watchdog check | No |
| `POST` | `/api/v1/alerts/{id}/ack` | Safety officer incident acknowledgement | Operator Session |
| `POST` | `/api/v1/alerts/{id}/resolve` | Incident resolution & root-cause logging | Operator Session |
