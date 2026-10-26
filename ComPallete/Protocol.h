#ifndef PROTOCOL_H
#define PROTOCOL_H

#include <Arduino.h>
#include <ArduinoJson.h>
#include "Config.h"

// ============================================================================
// COMPALLETTE - TELEMETRY & ALERT PACKET PROTOCOL SPECIFICATION (v1)
// ============================================================================

#define PROTOCOL_VERSION 1

// ----------------------------------------------------------------------------
// Enumerations
// ----------------------------------------------------------------------------
enum MessageType {
  MSG_UNKNOWN = 0,
  MSG_HEARTBEAT,
  MSG_TELEMETRY,
  MSG_ALERT,
  MSG_ACK,
  MSG_PROV_REQ,
  MSG_PROV_ASSIGN,
  MSG_PROV_CONFIRM
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
  uint8_t       version;              // Protocol version (1)
  MessageType   msg_type;             // Type of message
  uint32_t      seq;                  // Incremental sequence counter for deduplication & loss tracking
  char          sender_id[24];        // Device / Personnel identifier (e.g., "MINER-106")
  char          role[20];             // "WEARABLE", "ANCHOR", "GATEWAY"
  char          zone_id[24];          // Spatial anchor/zone (e.g., "ZONE-B-DRIFT-04")
  uint32_t      uptime_ms;            // Sender uptime in ms
};

// Telemetry Payload (periodic environmental and device status)
struct TelemetryData {
  float   co_ppm;                     // Carbon Monoxide in ppm
  float   temp_c;                     // Ambient temperature (Celsius)
  float   humidity_pct;               // Relative humidity (%)
  bool    fall_detected;              // True if fall/man-down condition detected
  float   battery_v;                  // Battery voltage
  bool    is_simulated;               // True if data is synthetic, false if physical hardware
  bool    sensor_ok;                  // True if sensor is healthy, false if faulted/disconnected
};

// Alert Payload (event-driven safety events)
struct AlertData {
  AlertSeverity severity;             // INFO, WARNING, CRITICAL
  char          alert_code[24];       // e.g. "MAN_DOWN", "SOS_MANUAL", "GAS_CO_HIGH", "GAS_CO_CRITICAL"
  char          details[64];          // Human-readable summary
  float         trigger_value;        // Reading that triggered alert (e.g., 55.4 ppm)
};

// Heartbeat Payload (device health & mesh statistics)
struct HeartbeatData {
  uint32_t  free_heap;                // Free heap memory in bytes
  int       mesh_node_count;          // Number of peers visible to this node
  float     battery_v;                // Battery voltage
};

// ----------------------------------------------------------------------------
// Provisioning Wire Structures (Option 1: Over-The-Air Mesh Enrollment)
// ----------------------------------------------------------------------------

// Uncommissioned node enrollment announcement beacon (Upstream to Gateway)
struct ProvisioningRequestData {
  char      chip_mac[20];             // Factory IEEE MAC address
  char      chip_id[16];              // Hardware hex chip identifier
  uint32_t  mesh_node_id;             // painlessMesh local chip ID
  char      fw_version[12];           // Firmware version
  float     battery_v;                // Measured battery voltage
  bool      mq_healthy;               // MQ gas sensor status
  bool      mpu_healthy;              // MPU6050 IMU status
};

// Downlink provisioning assignment frame from Gateway to Node (Downstream)
struct ProvisioningAssignData {
  char      target_chip[16];          // Target hardware chip ID
  char      assigned_id[24];          // Assigned badge ID (e.g. "MINER-106")
  char      role[20];                 // "WEARABLE", "ANCHOR", "GATEWAY"
  char      zone_id[32];              // Assigned tunnel zone
  float     co_warn;                  // Warning limit (ppm)
  float     co_crit;                  // Evacuation limit (ppm)
  bool      reboot_now;               // True to trigger immediate node restart
};

// Commissioning completion confirmation (Upstream to Gateway)
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

// Note: nodeRoleToString() and stringToNodeRole() are declared inline in Config.h

// ----------------------------------------------------------------------------
// Serialization Functions
// ----------------------------------------------------------------------------
bool serializeTelemetry(const MessageEnvelope& env, const TelemetryData& data, String& outJson);
bool serializeAlert(const MessageEnvelope& env, const AlertData& alert, String& outJson);
bool serializeHeartbeat(const MessageEnvelope& env, const HeartbeatData& hb, String& outJson);
bool serializeProvRequest(const MessageEnvelope& env, const ProvisioningRequestData& req, String& outJson);
bool serializeProvAssign(const MessageEnvelope& env, const ProvisioningAssignData& assign, String& outJson);
bool serializeProvConfirm(const MessageEnvelope& env, const ProvisioningConfirmData& conf, String& outJson);

// ----------------------------------------------------------------------------
// Deserialization & Validation Functions
// ----------------------------------------------------------------------------
// Parses an incoming JSON string into typed envelope and payload structures.
// Automatically recognizes and translates legacy unversioned payloads for backward compatibility.
bool deserializePacket(
  const String& jsonStr,
  MessageEnvelope& outEnv,
  TelemetryData& outTelemetry,
  AlertData& outAlert,
  HeartbeatData& outHb,
  bool& outIsLegacy
);

bool deserializeProvAssign(const String& jsonStr, ProvisioningAssignData& outAssign);
bool deserializeProvRequest(const String& jsonStr, ProvisioningRequestData& outReq);
bool deserializeProvConfirm(const String& jsonStr, ProvisioningConfirmData& outConfirm);

// Validates essential envelope headers (sender_id non-empty, valid version, valid type)
bool validateEnvelope(const MessageEnvelope& env);

#endif // PROTOCOL_H
