#ifndef CONFIG_H
#define CONFIG_H

#include <Arduino.h>

// ============================================================================
// COMPALLETTE - SYSTEM CONFIGURATION & NODE PROFILE
// ============================================================================
// This configuration file centralizes all network parameters, node identity,
// timing, threshold limits, and hardware pin mappings.

// ----------------------------------------------------------------------------
// 1. Mesh Network Configuration
// ----------------------------------------------------------------------------
#define MESH_PREFIX     "MineMesh_Zambia"
#define MESH_PASSWORD   "SecureMine123"
#define MESH_PORT       5555
#define MESH_CHANNEL    6                  // Fixed Wi-Fi channel for fast mesh convergence

// ----------------------------------------------------------------------------
// 2. Node Roles & Operational Profile
// ----------------------------------------------------------------------------
enum NodeRole {
  ROLE_WEARABLE = 0,          // Mobile miner wearable tag (collects telemetry & sends alerts)
  ROLE_STATIONARY_ANCHOR = 1, // Fixed underground infrastructure / location reference
  ROLE_GATEWAY = 2            // Border router bridging painlessMesh to IP infrastructure
};

// --- ACTIVE NODE CONFIGURATION ---
// Set the operational role for this physical device build:
#define CURRENT_ROLE            ROLE_WEARABLE

// Identifier for this node:
// - For wearable: Unique miner badge / personnel ID (e.g., "MINER-106")
// - For anchor: Physical tunnel zone identifier (e.g., "ANCHOR-Z02-L3")
// - For gateway: Gateway ID (e.g., "GW-SURFACE-01")
#define ACTIVE_DEVICE_ID        "MINER-106"

// Physical tunnel zone name (primarily used by stationary anchors):
#define ACTIVE_ZONE_ID          "ZONE-B-DRIFT-04"

// ----------------------------------------------------------------------------
// 3. Timing & Task Scheduling (milliseconds)
// ----------------------------------------------------------------------------
#define TELEMETRY_INTERVAL_MS   5000       // Regular telemetry interval for wearable nodes
#define HEARTBEAT_INTERVAL_MS   30000      // Node health & keep-alive ping
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
#define BATTERY_VOLTAGE_NOMINAL    3.70f   // Nominal cell voltage
#define BATTERY_VOLTAGE_LOW        3.35f   // Low battery warning threshold
#define BATTERY_VOLTAGE_EMPTY      3.00f   // Critical shutdown / brownout threshold

// ----------------------------------------------------------------------------
// 5. Hardware Interface Pin Definitions (ESP32)
// ----------------------------------------------------------------------------
// Reserved GPIO assignments for future physical sensor and actuator integration
#define PIN_STATUS_LED          2          // Onboard / external status LED (GPIO 2)
#define PIN_BUZZER              18         // Active emergency alarm buzzer
#define PIN_SOS_BUTTON          19         // Emergency panic button (active LOW, pull-up)
#define PIN_GAS_ANALOG          34         // ADC pin for analog gas sensor (input only)
#define PIN_I2C_SDA             21         // I2C SDA for environmental sensors / IMU
#define PIN_I2C_SCL             22         // I2C SCL for environmental sensors / IMU

// ----------------------------------------------------------------------------
// 6. Sensor Simulation & Integrity Flag
// ----------------------------------------------------------------------------
// IMPORTANT: Mark whether sensor readings originate from physical hardware
// or synthetic test data generators to prevent unvalidated lab data from being
// mistaken for real-world mine readings.
#define SIMULATE_SENSORS        true

#endif // CONFIG_H
