# ComPallette | Connected, Trustworthy Zone Tracking & Environmental Monitoring

ComPallette is an on-site, industrial safety platform for **personnel and asset zone tracking, truthful environmental monitoring, and resilient store-and-forward telemetry** in subterranean and GPS-denied environments. Mining is the initial production context.

The system operates under a strict physical principle: **local sensing, safety alarms, and autonomous store-and-forward queuing operate continuously without internet connectivity or surface backend availability**.

---

## 1. Operating Model & Core Principles

```
[Mobile Wearable Tag]  ──(Direct RF Link: Hop=1)──>  [Stationary Anchor]  ──(painlessMesh)──>  [Gateway Bridge]  ──(HTTP/REST or MQTT/TLS)──>  [Surface Backend (Django)]
      (Personnel / Asset)                                   (Fixed Zone Reference)                       (Border Router)                                    (PostgreSQL & React Cockpit)
```

1. **Automatic Direct-Anchor Zone Tracking**:
   $$\text{Wearable} \longrightarrow \text{Directly connected stationary anchor (hop } = 1\text{)} \longrightarrow \text{Anchor's registered physical zone}$$
   - Wearables actively associate with qualified stationary infrastructure.
   - When stationary infrastructure is unreachable, nearby wearables may relay traffic across the mesh; **a relay node carries messages, but its location is never inherited by the originating wearable**.
   - Location observations are classified with explicit evidence badges: `DIRECT_ANCHOR`, `STATIONARY`, `LAST_KNOWN`, `SIMULATED`, `MANUAL_OVERRIDE`, or `UNKNOWN`.

2. **Truthful Sensing**:
   - Environmental channels preserve canonical physical units and provenance throughout the entire pipeline:
     - Temperature: Degrees Celsius (°C)
     - Relative Humidity: Percentage (%)
     - Barometric Pressure: Pascals (Pa)
     - Gas Resistance: Ohms (Ω)
     - Carbon Monoxide: Parts per million (ppm) — *legacy MQ-7 hardware only*
   - **Zero Fabricated Readings**: Carbon monoxide (CO) values are **never** estimated, derived, or fabricated from BME688 gas resistance. BME688 devices report `has_co: false`.

3. **Crash-Resilient Store-and-Forward (LittleFS)**:
   - Gateways and nodes buffer packets in flash-backed persistent storage (`/compallette_buffer.jsonl`) via LittleFS.
   - Two-tier priority queue ensures life-safety alerts (`MAN_DOWN`, `PANIC_SOS`, `GAS_CRITICAL`) preempt routine periodic telemetry.
   - Packets are preserved through brownouts and power restarts until the surface database issues a matching persistence receipt (`status: "ok"`).
   - Fails-closed retention policy: rejects new packets when full rather than overwriting unacknowledged safety records.

4. **Cryptographic Device Trust**:
   - Gateways and nodes validate local enrollment through `/device-trust.json` and `/gateway-credentials.json` on LittleFS.
   - Packet envelopes require a valid installation UUID (`COMPALLETTE_INSTALLATION_ID`) and boot nonce.
   - Gateway uplinks require individual credentials verified against Django's `GatewayRegistration`.

---

## 2. Current Status & Verification Evidence

All test suites and hardware targets pass verification:

| Layer | Test Suite | Result | Details |
|---|---|---|---|
| **Backend API** | Django REST Framework (`manage.py test`) | **60 / 60 Passed** | Auth, wire v2 validation, gateway registration, direct-anchor ingestion, alert remediation, multi-site isolation. |
| **Frontend UI** | Vitest (`npm test`) | **35 / 35 Passed** | Session isolation, 5s live polling, direct-anchor evidence badges, alert resolution drafts, keyboard navigation. |
| **ESP32 Firmware** | Arduino CLI (`adafruit_feather_esp32s3`) | **Clean Build (Code 0)** | 1,441,879 B (50%) Program Flash, 87,900 B (26%) Dynamic RAM. Zero warnings. |
| **Hardware Link** | Physical ESP32-S3 Gateway + Wearable | **Verified** | Wi-Fi Station connected to `Innov_Hub`, mDNS resolved `innovation-hub03.local` -> `192.168.1.176`, LittleFS mounted, live telemetry flowing. |

---

## 3. Repository Architecture

```
ComPallete/
├── ComPallete/                 # ESP32 / ESP32-S3 C++ Firmware (Arduino IDE / Arduino CLI)
│   ├── ComPallete.ino         # Main firmware entrypoint, scheduling, CLI, and dual-mode dispatch
│   ├── Config.h               # Central configuration: hardware profiles, pinouts, intervals, thresholds
│   ├── Protocol.h / .cpp      # Wire v2 message envelopes, canonical BME688 codecs, serialization
│   ├── NodeConfigManager.h/.cpp # NVS persistent storage, sequence numbering, runtime commissioning
│   ├── DeviceTrust.h / .cpp   # LittleFS enrollment bundle, HMAC signing, and self-healing trust
│   ├── OfflineBuffer.h / .cpp # Flash-backed store-and-forward queue (LittleFS), priority preempting
│   ├── GatewayManager.h / .cpp# Wi-Fi STA management, mDNS resolver, HTTP REST & WebSocket uplink
│   ├── MqttUplink.h / .cpp    # TLS/MQTT gateway transport
│   ├── SensorHAL.h / .cpp     # Hardware Abstraction Layer (BME688, MQ-7, MPU6050, Battery ADC)
│   ├── ZoneTracker.h / .cpp   # Wearable proximity state machine, anchor beacon scoring, hysteresis
│   └── CaptivePortalManager.h/.cpp # SoftAP commissioning web server (fallback mode)
│
├── backend/
│   ├── django/                # Production Backend: Django REST Framework & PostgreSQL
│   │   ├── mining_api/        # Wire v2 ingestion, device trust, models, and operator endpoints
│   │   ├── Dockerfile         # Python 3.12 production container
│   │   └── manage.py          # Django administrative and maintenance entrypoint
│   └── rocket/                # Experimental Rust Rocket backend (retained for comparison)
│
├── frontend/
│   └── react/                 # React 18 / TypeScript / Vite Industrial Cockpit Dashboard
│       ├── src/               # Operator views, zone maps, alert remediation modals, evidence badges
│       └── tests/             # Vitest test suite for UI workflows and API contracts
│
├── device-keys/               # Protected local directory containing <hardware_id>.json keys (mounted :ro)
├── docker-compose.yml         # Production stack: Django API, PostgreSQL, React UI, Watchdog
├── docker-compose.mqtt.yml    # Mosquitto MQTT/TLS broker overlay
└── docs/                      # Architectural specifications and verification runbooks
```

---

## 4. Hardware Profiles & Pin Mapping

The firmware includes dedicated hardware profiles selectable in `ComPallete/Config.h`:
- `PROFILE_FEATHER_ESP32S3_BME`: Adafruit Feather ESP32-S3 (4MB Flash / 2MB PSRAM) + BME688 + MPU6050
- `PROFILE_GENERIC_ESP32S3`: Freenove ESP32-S3 WROOM / Dev Module
- `PROFILE_GENERIC_ESP32`: Classic ESP32 (WROOM-32 / WROVER)

### Pin Assignments

| Peripheral Subsystem | Feather ESP32-S3 (`PROFILE_FEATHER_ESP32S3_BME`) | Classic ESP32 (`PROFILE_GENERIC_ESP32`) | Notes |
|---|---|---|---|
| **I2C SDA (BME688 & MPU6050)** | `GPIO 3` | `GPIO 21` | Hardware I2C (Wire) |
| **I2C SCL (BME688 & MPU6050)** | `GPIO 4` | `GPIO 22` | Hardware I2C (Wire) |
| **Battery Voltage ADC** | `GPIO 9` | `GPIO 35` (ADC1_CH7) | 1:2 resistor divider (100k/100k) |
| **MQ-7 CO Gas Sensor** | `GPIO 10` (ADC1_CH9) | `GPIO 34` (ADC1_CH6) | Legacy MQ-7 hardware only |
| **Emergency SOS Button** | `GPIO 5` | `GPIO 19` | Active LOW with internal pull-up |
| **Hardware Alarm Buzzer** | `GPIO 6` | `GPIO 18` | 3.3V active piezo buzzer |
| **Status Indicator LED** | `GPIO 13` (or NeoPixel `GPIO 33`) | `GPIO 2` | Heartbeat and alarm indicator |
| **BOOT Setup Button** | `GPIO 0` | `GPIO 0` | Hold >= 3s on boot for SoftAP setup |

---

## 5. Embedded Firmware Setup & Flashing

### Requirements
- **Arduino IDE 2.x** or **Arduino CLI** (version `1.1.1` or later)
- **ESP32 Board Package**: Espressif `esp32` version **`3.3.12`**
- **Libraries**:
  - `painlessMesh` (`1.5.7`)
  - `ArduinoJson` (`7.4.3`)
  - `Adafruit BME680 / BME688 Library`
  - `Adafruit MPU6050`
  - `Adafruit BusIO` & `Adafruit Unified Sensor`

### Flashing via Arduino CLI

From the repository root (adjust COM port for your OS):

**Windows**:
```powershell
& "C:\Users\innovation_hub\AppData\Local\Programs\arduino-ide\resources\app\lib\backend\resources\arduino-cli.exe" compile --fqbn esp32:esp32:adafruit_feather_esp32s3:DebugLevel=info ComPallete/ComPallete.ino
& "C:\Users\innovation_hub\AppData\Local\Programs\arduino-ide\resources\app\lib\backend\resources\arduino-cli.exe" upload -p COM3 --fqbn esp32:esp32:adafruit_feather_esp32s3:DebugLevel=info ComPallete/ComPallete.ino
```

**Linux / macOS**:
```bash
arduino-cli compile --fqbn esp32:esp32:adafruit_feather_esp32s3:DebugLevel=info ComPallete/ComPallete.ino
arduino-cli upload -p /dev/ttyACM0 --fqbn esp32:esp32:adafruit_feather_esp32s3:DebugLevel=info ComPallete/ComPallete.ino
```

### Flashing via Arduino IDE
1. Open `ComPallete/ComPallete.ino`.
2. Under **Tools > Board**, select **Adafruit Feather ESP32-S3 2MB PSRAM** (or `ESP32S3 Dev Module`).
3. Set **USB CDC On Boot**: `Enabled` (required for native USB serial output).
4. Set **Partition Scheme**: `Huge APP (3MB No OTA/1MB SPIFFS)` or `Minimal SPIFFS (1.9MB APP with OTA)`.
5. Set **Core Debug Level** to **Info** for production.
6. Select the COM / serial port and click **Upload**.

See [Firmware logging](docs/firmware-logging.md) for board-specific output routing, build levels, and verification.

---

## 6. Interactive Serial Monitor CLI

The firmware provides a real-time, non-blocking serial CLI operating at **115200 baud**:

| Command | Action / Output |
|---|---|
| `help` or `?` | Displays full CLI reference menu. |
| `status` | Prints live telemetry (temperatures, humidity, pressure, gas resistance, battery, heap, peers, zone). |
| `trust` | Displays cryptographic device trust status, hardware chip ID, installation UUID, and LittleFS storage metrics. |
| `trust-init [key] [cred]` | Initializes or re-enrolls `/device-trust.json` and gateway credentials directly on LittleFS over serial. |
| `trust-wipe` | Wipes trust files from LittleFS for decommissioning or clean re-enrollment. |
| `buffer` | Displays store-and-forward queue depths (RAM and Flash), flushed count, and dropped count. |
| `testpost` | Dispatches an authentic test heartbeat packet to verify uplink persistence and server receipt. |
| `wifi` | Displays Wi-Fi station status, SSID, IP address, router gateway, and RSSI. |
| `mdns <host>` | Resolves a `.local` domain over Multicast DNS (e.g. `mdns innovation-hub03.local`). |
| `id <name>` | Sets node badge ID in NVS and updates gateway credentials (e.g. `id GATEWAY` or `id MINER-106`). |
| `role <0\|1\|2>` | Configures node operational role (`0`: Wearable, `1`: Anchor, `2`: Gateway). |
| `zone [name\|auto]` | Views or sets zone. Wearables support `zone auto` (proximity tracking) or manual test override. |
| `key [token]` | Views or updates the 32+ character gateway API key in NVS. |
| `api [url]` | Views or sets the upstream backend REST URL in NVS. |
| `uplink [ssid] [pass]` | Views or updates the Gateway's router uplink credentials in NVS. |
| `setup` | Forces the node into SoftAP Captive Portal commissioning mode and restarts. |
| `portal` | Prints the active SoftAP SSID and temporary random WPA2 password. |
| `mesh` | Re-enables Production Mesh mode and restarts. |
| `scan` | Scans the hardware I2C bus for sensors (MPU6050 at `0x68`, BME688 at `0x76`/`0x77`). |
| `reset` | Factory resets all persistent NVS settings. |
| `reboot` | Performs a clean software restart of the microcontroller. |

---

## 7. Backend Setup (Docker Stack)

The backend runs Django REST Framework with PostgreSQL, Celery watchdog, and React operator frontend.

### 1. Environment Configuration

Copy `.env.example` to `.env` and configure your environment:

```ini
# Core Security
SECRET_KEY=your_generated_django_secret_key_at_least_50_chars
DEBUG=0
ALLOWED_HOSTS=localhost,127.0.0.1,192.168.1.176,innovation-hub03.local

# Installation Context
COMPALLETTE_INSTALLATION_ID=6cb490b5-fdeb-4372-a197-a93ca7b5e92e
COMPALLETTE_DEVICE_KEY_DIR=./device-keys

# Database
DB_NAME=compallette_db
DB_USER=compallette_user
DB_PASSWORD=compallette_secure_password
DB_HOST=db
DB_PORT=5432
```

### 2. Device Key Directory Setup

Device enrollment keys reside in `./device-keys/` (mounted read-only to `/run/device-keys:ro` in containers).

Create `./device-keys/<hardware_chip_id>.json` for each physical device:
```json
{
  "hardware_id": "A7C520",
  "site_id": 1,
  "installation_id": "6cb490b5-fdeb-4372-a197-a93ca7b5e92e",
  "key": "81d90b66c01d92d9e8fb30095b2c9d6fb44ec96f6a4339a33a39908d420386c0",
  "ntp_host": "innovation-hub03.local"
}
```

### 3. Launch Services

```bash
docker compose up -d --build
```

- **React Cockpit**: `http://localhost:3000` (or `http://192.168.1.176:3000`)
- **Django REST API**: `http://localhost:8000`
- **PostgreSQL**: `localhost:5432`

### 4. Create Operator Account

```bash
docker exec -it compallette_backend_django python manage.py createsuperuser
```

---

## 8. Frontend Setup (React Industrial Cockpit)

The operator interface is built with **React 18, TypeScript, Tailwind CSS, and Vite**.

### Features
- **Live Zone Map**: Displays mobile wearable positions updated via qualified direct-anchor associations.
- **Location Evidence Badges**: Real-time indication of observation quality (`DIRECT_ANCHOR`, `STATIONARY`, `LAST_KNOWN`, `SIMULATED`, `UNKNOWN`).
- **Safety Alert Remediation**: Modal workflow requiring operator-authored justification notes before an alert can be resolved.
- **Session Isolation**: Drafts and filters are strictly scoped to the active operator and wiped on session logout.
- **5-Second Live Polling**: Automatic polling cadence for telemetry, node status, and incidents.

### Local Development (without Docker)
```bash
cd frontend/react
npm install
npm run dev
```

Run test suite:
```bash
npm test
```

---

## 9. Automated Testing & Verification

Run the full verification battery across all components:

### Backend Tests (Django)
```bash
docker exec compallette_backend_django python manage.py test
```
*Expected*: `Ran 60 tests in ~25s: OK`

### Frontend Tests (Vitest)
```bash
cd frontend/react
npm test
```
*Expected*: `Test Files: 5 passed (5), Tests: 35 passed (35)`

### Firmware Compilation Check
```bash
arduino-cli compile --fqbn esp32:esp32:adafruit_feather_esp32s3:DebugLevel=info ComPallete/ComPallete.ino
```
*Expected*: Exit code 0, 0 compilation errors.

---

## 10. API Specification Summary

| Method | Endpoint | Description | Auth Required |
|---|---|---|---|
| `GET` | `/health/` | Health check, deployment revision, contract version | Public |
| `POST` | `/api/v1/auth/session` | Operator login | Username & Password |
| `POST` | `/api/v1/telemetry` | Environmental measurements ingestion | `X-Gateway-ID` & `X-API-Key` |
| `POST` | `/api/v1/alert` | Emergency incident ingestion | `X-Gateway-ID` & `X-API-Key` |
| `POST` | `/api/v1/heartbeat` | Gateway & node keep-alive | `X-Gateway-ID` & `X-API-Key` |
| `GET` | `/api/v1/system/summary` | Operational aggregates and live active nodes | Operator Session |
| `GET` | `/api/v1/alerts` | List safety alerts | Operator Session |
| `POST` | `/api/v1/alerts/{id}/ack` | Acknowledge safety alert | Operator Session |
| `POST` | `/api/v1/alerts/{id}/resolve`| Resolve alert with operator resolution notes | Operator Session |
| `GET` | `/api/v1/gateways?site={id}` | List registered gateways | Operator Session |

---

## 11. Security & Compliance Notes

1. **Physical Safety Boundary**: Physical acknowledge button holds on wearable hardware remain authoritative. Server resolutions never silence or disable a physical hardware alarm.
2. **Read-Only Secret Storage**: `./device-keys/` is mounted read-only (`:ro`) into container environments. Keys are never serialized or returned through the API.
3. **Audit Trail**: Every alert transition (creation, physical acknowledgement, operator assignment, operator resolution) records an immutable entry in the `AuditEntry` table with the operator ID, timestamp, and context.
