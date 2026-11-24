#ifndef CONFIG_H
#define CONFIG_H

#include <Arduino.h>
#include <string.h>

// ============================================================================
// COMPALLETTE - SYSTEM CONFIGURATION & NODE PROFILE
// ============================================================================
// This configuration file centralizes all network parameters, node identity,
// timing, threshold limits, hardware pin mappings, sensor calibration constants,
// gateway settings, and offline store-and-forward buffer policies.

// ----------------------------------------------------------------------------
// 1. Mesh Network Configuration
// ----------------------------------------------------------------------------
#define MESH_PREFIX     "MineMesh_Zambia"
#define MESH_PASSWORD   "SecureMine123"
#define MESH_PORT       5555
#define MESH_CHANNEL    11                  // Must match the Gateway's 2.4 GHz router channel

// ----------------------------------------------------------------------------
// 2. Node Roles & Operational Profile
// ----------------------------------------------------------------------------
enum NodeRole {
  ROLE_WEARABLE = 0,          // Mobile miner wearable tag (collects telemetry & sends alerts)
  ROLE_STATIONARY_ANCHOR = 1, // Fixed underground infrastructure / location reference
  ROLE_GATEWAY = 2            // Border router bridging painlessMesh to IP infrastructure
};

inline const char* nodeRoleToString(NodeRole role) {
  switch (role) {
    case ROLE_WEARABLE:          return "WEARABLE";
    case ROLE_STATIONARY_ANCHOR: return "ANCHOR";
    case ROLE_GATEWAY:           return "GATEWAY";
    default:                     return "UNKNOWN";
  }
}

inline NodeRole stringToNodeRole(const char* str) {
  if (!str) return ROLE_WEARABLE;
  if (strcmp(str, "GATEWAY") == 0) return ROLE_GATEWAY;
  if (strcmp(str, "ANCHOR") == 0)  return ROLE_STATIONARY_ANCHOR;
  return ROLE_WEARABLE;
}

// --- ACTIVE NODE CONFIGURATION ---
// Set the operational role for this physical device build:
#define CURRENT_ROLE            ROLE_GATEWAY

// Identifier for this node:
// - For wearable: Unique miner badge / personnel ID (e.g., "MINER-106")
// - For anchor: Physical tunnel zone identifier (e.g., "ANCHOR-Z02-L3")
// - For gateway: Gateway ID (e.g., "GW-SURFACE-01")
#define ACTIVE_DEVICE_ID        "GW-SURFACE-01"

// Physical tunnel zone name (primarily used by stationary anchors):
#define ACTIVE_ZONE_ID          "ZONE-B-DRIFT-04"

// ----------------------------------------------------------------------------
// 3. Timing & Task Scheduling (milliseconds)
// ----------------------------------------------------------------------------
#define TELEMETRY_INTERVAL_MS   5000       // Regular telemetry interval for wearable nodes
#define HEARTBEAT_INTERVAL_MS   30000      // Node health & keep-alive ping for wearables / gateways
#define ANCHOR_BEACON_INTERVAL_MS 5000     // Fast beacon cadence for stationary anchors (Option 1 proximity)
#define ENABLE_EXPERIMENTAL_BEACON_ZONE_TRACKING 0 // Disabled until direct-link RSSI pilot passes
#define ALERT_RETRY_INTERVAL_MS 1000       // Fast retransmit cadence during active emergency
#define ALERT_BURST_COUNT       3          // Number of immediate retransmits for high-severity alerts

// ----------------------------------------------------------------------------
// 4. Safety & Threshold Limits (Mining Safety Benchmarks)
// ----------------------------------------------------------------------------
// Carbon Monoxide (CO) concentration thresholds in parts per million (ppm)
// Based on international (OSHA/NIOSH) and Zambian underground mining limits:
#define CO_THRESHOLD_WARNING_PPM   25.0f   // Time-weighted average exposure alert
#define CO_THRESHOLD_CRITICAL_PPM  50.0f   // Immediate evacuation threshold

// Battery monitoring (1S Li-Ion / LiPo 18650 cell):
#define BATTERY_VOLTAGE_FULL       4.20f   // Maximum 100% cell voltage
#define BATTERY_VOLTAGE_NOMINAL    3.70f   // Nominal cell voltage
#define BATTERY_VOLTAGE_LOW        3.35f   // Low battery warning threshold
#define BATTERY_VOLTAGE_EMPTY      3.00f   // Critical shutdown / brownout threshold

// ----------------------------------------------------------------------------
// 5. Named Hardware Profiles & Interface Pin Definitions
// ----------------------------------------------------------------------------
#define PROFILE_GENERIC_ESP32        1
#define PROFILE_GENERIC_ESP32S3      2
#define PROFILE_FEATHER_ESP32S3_BME  3

#ifndef ACTIVE_HARDWARE_PROFILE
  #if defined(ARDUINO_ADAFRUIT_FEATHER_ESP32S3) || defined(BOARD_FEATHER_ESP32S3) || defined(CONFIG_IDF_TARGET_ESP32S3)
    #define ACTIVE_HARDWARE_PROFILE PROFILE_FEATHER_ESP32S3_BME
  #else
    #define ACTIVE_HARDWARE_PROFILE PROFILE_GENERIC_ESP32
  #endif
#endif

#if (ACTIVE_HARDWARE_PROFILE == PROFILE_FEATHER_ESP32S3_BME)
// --- Adafruit Feather ESP32-S3 (4MB Flash / 2MB PSRAM) + BME688 + MPU6050 ---
// Uses board-defined pins and preserves native USB (GPIO 19/20)
#define PIN_STATUS_LED          13         // Built-in red status LED (GPIO 13)
#define PIN_I2C_POWER           7          // STEMMA QT / I2C switchable power pin (GPIO 7)
#define PIN_I2C_SDA             3          // STEMMA QT / Hardware I2C SDA (GPIO 3)
#define PIN_I2C_SCL             4          // STEMMA QT / Hardware I2C SCL (GPIO 4)
#define PIN_BUZZER              18         // Active emergency alarm buzzer (GPIO 18 / A0)
#define PIN_SOS_BUTTON          14         // Dedicated physical SOS panic button (GPIO 14 / A4, active LOW)
#define PIN_ACK_BUTTON          15         // Separate physical alarm acknowledge button (GPIO 15 / A3, active LOW)
#define PIN_BOOT_BUTTON         0          // Onboard BOOT button for SoftAP Setup (GPIO 0, active LOW)
#define USE_ONBOARD_BATTERY_GAUGE true     // Feather onboard I2C fuel gauge (MAX17048 or LC709203F)
#define PIN_GAS_ANALOG          -1         // Disabled on BME688 profile (I2C digital gas resistance)
#define PIN_BATTERY_ADC         -1         // Disabled on Feather S3 profile (uses onboard I2C gauge)

#elif (ACTIVE_HARDWARE_PROFILE == PROFILE_GENERIC_ESP32S3)
// --- Generic ESP32-S3 Pin Mapping ---
#define PIN_STATUS_LED          2          // Onboard status LED (GPIO 2)
#define PIN_BUZZER              18         // Active emergency alarm buzzer (GPIO 18)
#define PIN_SOS_BUTTON          14         // Emergency panic button (GPIO 14)
#define PIN_ACK_BUTTON          12         // Separate physical alarm acknowledge button (GPIO 12)
#define PIN_BOOT_BUTTON         0          // Onboard BOOT button for SoftAP Setup Mode (GPIO 0)
#define PIN_GAS_ANALOG          4          // ADC1_CH3 analog gas sensor pin (GPIO 4)
#define PIN_BATTERY_ADC         5          // ADC1_CH4 battery divider pin (GPIO 5)
#define PIN_I2C_SDA             8          // ESP32-S3 standard hardware I2C SDA (GPIO 8)
#define PIN_I2C_SCL             9          // ESP32-S3 standard hardware I2C SCL (GPIO 9)
#define USE_ONBOARD_BATTERY_GAUGE false

#else
// --- Classic ESP32 (WROOM / WROVER) Pin Mapping ---
#define PIN_STATUS_LED          2          // Onboard status LED (GPIO 2)
#define PIN_BUZZER              18         // Active emergency alarm buzzer (GPIO 18)
#define PIN_SOS_BUTTON          19         // Emergency panic button (GPIO 19, active LOW, pull-up)
#define PIN_ACK_BUTTON          23         // Separate physical alarm acknowledge button (GPIO 23, active LOW)
#define PIN_BOOT_BUTTON         0          // Onboard BOOT button for SoftAP Setup Mode (GPIO 0, active LOW, pull-up)
#define PIN_GAS_ANALOG          34         // ADC1_CH6 analog gas sensor pin (GPIO 34, input only)
#define PIN_BATTERY_ADC         35         // ADC1_CH7 battery divider pin (GPIO 35, input only)
#define PIN_I2C_SDA             21         // I2C SDA for MPU6050 IMU & sensors (GPIO 21)
#define PIN_I2C_SCL             22         // I2C SCL for MPU6050 IMU & sensors (GPIO 22)
#define USE_ONBOARD_BATTERY_GAUGE false
#endif

// I2C Sensor Bus Addresses
#define BME688_I2C_ADDR_DEFAULT    0x77       // Primary BME688 I2C address
#define BME688_I2C_ADDR_ALT        0x76       // Alternate BME688 I2C address
#define MAX17048_I2C_ADDR          0x36       // Feather ESP32-S3 MAX17048 fuel gauge
#define LC709203F_I2C_ADDR         0x0B       // Earlier Feather LC709203F fuel gauge

// ----------------------------------------------------------------------------
// 6. Sensor Calibration Constants (Phase 5 Hardware Abstraction Layer)
// ----------------------------------------------------------------------------
// Auto-detect hardware: if sensors are missing or disconnected, gracefully
// falls back to safe/synthetic mode without blocking or halting node operations.
#define SENSOR_AUTO_DETECT      true

// Force simulation flag (if true, bypasses hardware even if sensors are attached):
#define SIMULATE_SENSORS        false

// Battery ADC Voltage Divider Calibration:
// Default assuming R1 = 100k, R2 = 100k divider (ratio = (100k+100k)/100k = 2.0)
#define BATTERY_DIVIDER_RATIO      2.0f
#define BATTERY_ADC_CALIBRATION    1.035f     // Trimming factor for ESP32 ADC non-linearity

// MQ-7 Carbon Monoxide Gas Sensor Calibration:
#define MQ7_RL_VALUE               10000.0f   // Load resistor on module (10k ohms)
#define MQ7_RO_CLEAN_AIR           10000.0f   // Baseline sensor resistance R0 in clean air
#define MQ7_CURVE_A                99.04f     // Power-law regression scale parameter (CO)
#define MQ7_CURVE_B                -1.518f    // Power-law regression exponent (CO)
#define MQ7_VREF                   3.3f       // ESP32 ADC reference voltage
#define MQ7_PREHEAT_TIME_MS        60000      // 60-second recommended preheat duration

// MPU6050 Fall Detection ("Man Down") Parameters:
#define MPU6050_I2C_ADDR           0x68       // Default I2C address (AD0 low)
#define MPU6050_I2C_ADDR_ALT       0x69       // Alternate address (AD0 high)
#define FALL_FREE_FALL_G           0.50f      // Acceleration threshold indicating free fall (<0.50g)
#define FALL_IMPACT_G              2.60f      // Acceleration threshold indicating impact (>2.60g)
#define FALL_INACTIVITY_MS         1500       // Post-impact stillness window (ms) to confirm fall

// ----------------------------------------------------------------------------
// 7. Gateway & Upstream Infrastructure Configuration
// ----------------------------------------------------------------------------
// Parameters used when CURRENT_ROLE is configured as ROLE_GATEWAY
#define UPLINK_WIFI_SSID        "Innov_Hub"
#define UPLINK_WIFI_PASSWORD    "V!brant2025#1nnov"
#define BACKEND_BASE_URL        "http://innovation-hub03.local:8000"
#define BACKEND_TIMEOUT_MS      4000       // HTTP request timeout in ms
#define BACKEND_DEFAULT_API_KEY "compallette_gateway_secret_key_32bytes"

// Backend API REST & WebSocket endpoints
#define ENDPOINT_TELEMETRY      "/api/v1/telemetry"
#define ENDPOINT_ALERT          "/api/v1/alert"
#define ENDPOINT_HEARTBEAT      "/api/v1/heartbeat"
#define ENDPOINT_PROV_REQUEST   "/api/v1/provision/request"
#define ENDPOINT_PROV_CONFIRM   "/api/v1/provision/confirm"
#define ENDPOINT_WS_GATEWAY     "/api/v1/ws/gateway"

// WebSocket Gateway Streaming Uplink (true = Persistent WS stream; false = Stabilized HTTP REST)
// NOTE: Setting to true requires selecting "Minimal SPIFFS (1.9MB APP)" or "Huge APP (3MB No OTA)"
// in the Arduino IDE 'Tools -> Partition Scheme' menu to accommodate WebSocket + Mesh flash footprint.
#define ENABLE_WEBSOCKET_UPLINK false

// Gateway reconnection backoff timings (milliseconds)
#define GW_RECONNECT_MIN_MS     2000       // Initial retry delay
#define GW_RECONNECT_MAX_MS     60000      // Max exponential backoff ceiling

// ----------------------------------------------------------------------------
// 8. Offline Buffer & Store-and-Forward Configuration
// ----------------------------------------------------------------------------
#define BUFFER_MAX_RAM_ITEMS    50         // In-memory queue items (~10 KB heap)
#define BUFFER_MAX_FLASH_ITEMS  500        // Persistent LittleFS queue items (~100 KB flash)
#define BUFFER_FLASH_FILE       "/compallette_buffer.jsonl"

#endif // CONFIG_H
