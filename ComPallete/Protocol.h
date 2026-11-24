#ifndef PROTOCOL_H
#define PROTOCOL_H

#include <Arduino.h>
#include <ArduinoJson.h>
#include "Config.h"

// ============================================================================
// COMPALLETTE - TELEMETRY & ALERT PACKET PROTOCOL SPECIFICATION (v2)
// ============================================================================
// Wire version 2 supports:
// - Canonical environmental metrics (temperature, humidity, pressure, gas resistance)
// - BME688 without CO fabrication (raw gas resistance in ohms)
// - Direct anchor context (anchor ID, zone, link state, hop distance, RSSI)
// - Local physical alarm acknowledgement events
// - Backward compatibility with legacy Wire Version 1 and unversioned packets

#define PROTOCOL_VERSION 2

// ----------------------------------------------------------------------------
// Enumerations
// ----------------------------------------------------------------------------
enum MessageType {
  MSG_UNKNOWN = 0,
  MSG_HEARTBEAT,
  MSG_TELEMETRY,
  MSG_ALERT,
  MSG_LOCAL_ACK,
  MSG_ACK,
  MSG_PROV_REQ,
  MSG_PROV_ASSIGN,
  MSG_PROV_CONFIRM,
  MSG_COMMAND_RESULT
};

enum AlertSeverity {
  SEVERITY_NONE = 0,
  SEVERITY_INFO,
  SEVERITY_WARNING,
  SEVERITY_CRITICAL
};

// ----------------------------------------------------------------------------
// Protocol Data Structures
// ----------------------------------------------------------------------------

// Standardized message envelope wrapping every packet
struct MessageEnvelope {
  uint8_t       version;              // Protocol version (1 or 2)
  MessageType   msg_type;             // Type of message
  uint32_t      seq;                  // Incremental sequence counter
  char          sender_id[24];        // Device / Personnel identifier
  char          role[20];             // "WEARABLE", "ANCHOR", "GATEWAY"
  char          zone_id[24];          // Spatial anchor/zone (e.g., "ZONE-A")
  uint32_t      uptime_ms;            // Sender uptime in ms
  // Wire v2 Anchor Proximity Context
  char          anchor_id[24];        // Nearest stationary anchor ID (e.g. "ANCHOR-Z01")
  char          anchor_zone[24];      // Anchor physical zone
  char          link_state[16];       // "CURRENT", "TRANSITIONING", "AMBIGUOUS", "LAST_KNOWN", "UNKNOWN"
  int8_t        hop_distance;         // 1 = direct anchor, >1 = relay
  int8_t        rssi;                 // Signal strength in dBm
};

// Telemetry Payload (periodic environmental and device status)
struct TelemetryData {
  float   temp_c;                     // Ambient temperature (Celsius)
  float   humidity_pct;               // Relative humidity (%)
  float   pressure_pa;                // Barometric pressure (Pascals)
  float   gas_resistance_ohm;         // Raw BME688 gas resistance (Ohms)
  bool    bme_healthy;                // BME688 health state
  bool    bme_warming;                // Gas heater conditioning / warmup flag
  bool    bme_gas_valid;              // Gas reading validity
  float   battery_v;                  // Battery voltage
  float   battery_pct;                // Battery percentage (0-100%)
  bool    fall_detected;              // True if fall/man-down condition detected
  bool    is_simulated;               // True if data is synthetic
  bool    sensor_ok;                  // True if sensors healthy
  float   co_ppm;                     // Carbon Monoxide in ppm (legacy hardware only)
  bool    has_co;                     // False for BME688, true for legacy MQ-7
};

// Alert Payload (event-driven safety events)
struct AlertData {
  AlertSeverity severity;             // INFO, WARNING, CRITICAL
  char          alert_code[24];       // e.g. "MAN_DOWN", "PANIC_SOS", "GAS_CRITICAL"
  char          details[64];          // Human-readable summary
  float         trigger_value;        // Reading that triggered alert
};

// Local Physical Alarm Acknowledgement Event
struct LocalAckData {
  uint8_t       cleared_alarms;       // Mask of alarms cleared by hold
  uint32_t      held_ms;              // Duration button was held (>= 2000 ms)
  char          device_id[24];        // Device identifier
};

// Heartbeat Payload (device health & mesh statistics)
struct HeartbeatData {
  uint32_t  free_heap;                // Free heap memory in bytes
  int       mesh_node_count;          // Number of peers visible to this node
  float     battery_v;                // Battery voltage
  float     battery_pct;              // Battery percentage
};

// ----------------------------------------------------------------------------
// Provisioning Wire Structures
// ----------------------------------------------------------------------------

struct ProvisioningRequestData {
  char      chip_mac[20];             // Factory IEEE MAC address
  char      chip_id[16];              // Hardware hex chip identifier
  uint32_t  mesh_node_id;             // painlessMesh local chip ID
  char      fw_version[12];           // Firmware version
  float     battery_v;                // Measured battery voltage
  bool      bme_healthy;              // Environmental sensor status
  bool      mq_healthy;               // Legacy MQ gas sensor status
  bool      mpu_healthy;              // MPU6050 IMU status
};

struct ProvisioningAssignData {
  char      target_chip[16];          // Target hardware chip ID
  char      assigned_id[24];          // Assigned badge ID
  char      role[20];                 // "WEARABLE", "ANCHOR", "GATEWAY"
  char      zone_id[32];              // Assigned zone
  float     co_warn;                  // Warning limit
  float     co_crit;                  // Evacuation limit
  bool      reboot_now;               // True to trigger restart
};

struct ProvisioningConfirmData {
  char      chip_id[16];              // Confirmed hardware chip ID
  char      status[24];               // "SUCCESS_COMMISSIONED"
};

// ----------------------------------------------------------------------------
// Helper Functions: Enum-to-String Conversions
// ----------------------------------------------------------------------------
const char* messageTypeToString(MessageType type);
MessageType stringToMessageType(const char* str);

const char* alertSeverityToString(AlertSeverity sev);
AlertSeverity stringToAlertSeverity(const char* str);

// ----------------------------------------------------------------------------
// Serialization Functions
// ----------------------------------------------------------------------------
bool serializeTelemetry(const MessageEnvelope& env, const TelemetryData& data, String& outJson);
bool serializeAlert(const MessageEnvelope& env, const AlertData& alert, String& outJson);
bool serializeLocalAck(const MessageEnvelope& env, const LocalAckData& ack, String& outJson);
bool serializeHeartbeat(const MessageEnvelope& env, const HeartbeatData& hb, String& outJson);
bool serializeProvRequest(const MessageEnvelope& env, const ProvisioningRequestData& req, String& outJson);
bool serializeProvAssign(const MessageEnvelope& env, const ProvisioningAssignData& assign, String& outJson);
bool serializeProvConfirm(const MessageEnvelope& env, const ProvisioningConfirmData& conf, String& outJson);

// ----------------------------------------------------------------------------
// Deserialization & Validation Functions
// ----------------------------------------------------------------------------
bool deserializePacket(
  const String& jsonStr,
  MessageEnvelope& outEnv,
  TelemetryData& outTelemetry,
  AlertData& outAlert,
  HeartbeatData& outHb,
  bool& outIsLegacy
);

bool deserializeLocalAck(const String& jsonStr, MessageEnvelope& outEnv, LocalAckData& outAck);
bool deserializeProvAssign(const String& jsonStr, ProvisioningAssignData& outAssign);
bool deserializeProvRequest(const String& jsonStr, ProvisioningRequestData& outReq);
bool deserializeProvConfirm(const String& jsonStr, ProvisioningConfirmData& outConfirm);

bool validateEnvelope(const MessageEnvelope& env);

#endif // PROTOCOL_H
