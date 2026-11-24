#include "DeviceTrust.h"
#include "Protocol.h"
#include <string.h>

// ----------------------------------------------------------------------------
// Helper Functions: Enum-to-String Conversions
// ----------------------------------------------------------------------------

const char* messageTypeToString(MessageType type) {
  switch (type) {
    case MSG_HEARTBEAT:      return "HEARTBEAT";
    case MSG_TELEMETRY:      return "TELEMETRY";
    case MSG_ALERT:          return "ALERT";
    case MSG_LOCAL_ACK:      return "LOCAL_ACK";
    case MSG_ACK:            return "ACK";
    case MSG_PROV_REQ:       return "PROV_REQ";
    case MSG_PROV_ASSIGN:    return "PROV_ASSIGN";
    case MSG_PROV_CONFIRM:   return "PROV_CONFIRM";
    case MSG_COMMAND_RESULT: return "COMMAND_RESULT";
    default:                 return "UNKNOWN";
  }
}

MessageType stringToMessageType(const char* str) {
  if (!str) return MSG_UNKNOWN;
  if (strcmp(str, "COMMAND_RESULT") == 0) return MSG_COMMAND_RESULT;
  if (strcmp(str, "TELEMETRY") == 0)      return MSG_TELEMETRY;
  if (strcmp(str, "ALERT") == 0)          return MSG_ALERT;
  if (strcmp(str, "LOCAL_ACK") == 0)      return MSG_LOCAL_ACK;
  if (strcmp(str, "HEARTBEAT") == 0)      return MSG_HEARTBEAT;
  if (strcmp(str, "ACK") == 0)            return MSG_ACK;
  if (strcmp(str, "PROV_REQ") == 0)       return MSG_PROV_REQ;
  if (strcmp(str, "PROV_ASSIGN") == 0)    return MSG_PROV_ASSIGN;
  if (strcmp(str, "PROV_CONFIRM") == 0)   return MSG_PROV_CONFIRM;
  return MSG_UNKNOWN;
}

const char* alertSeverityToString(AlertSeverity sev) {
  switch (sev) {
    case SEVERITY_INFO:     return "INFO";
    case SEVERITY_WARNING:  return "WARNING";
    case SEVERITY_CRITICAL: return "CRITICAL";
    default:                return "NONE";
  }
}

AlertSeverity stringToAlertSeverity(const char* str) {
  if (!str) return SEVERITY_NONE;
  if (strcmp(str, "CRITICAL") == 0) return SEVERITY_CRITICAL;
  if (strcmp(str, "WARNING") == 0)  return SEVERITY_WARNING;
  if (strcmp(str, "INFO") == 0)     return SEVERITY_INFO;
  return SEVERITY_NONE;
}

// ----------------------------------------------------------------------------
// Validation
// ----------------------------------------------------------------------------

bool validateEnvelope(const MessageEnvelope& env) {
  if (env.version != 1 && env.version != 2 && env.version != 0) {
    return false;
  }
  if (env.msg_type == MSG_UNKNOWN) {
    return false;
  }
  if (strlen(env.sender_id) == 0) {
    return false;
  }
  return true;
}

// Helper to write anchor context into JSON document
static void writeAnchorContext(JsonObject root, const MessageEnvelope& env) {
  if (strlen(env.anchor_id) > 0 || strlen(env.link_state) > 0) {
    JsonObject anchor = root["anchor"].to<JsonObject>();
    anchor["id"] = env.anchor_id;
    anchor["zone"] = env.anchor_zone;
    anchor["state"] = strlen(env.link_state) > 0 ? env.link_state : "CURRENT";
    anchor["hop"] = (int)env.hop_distance;
    anchor["rssi"] = (int)env.rssi;
  }
}

// ----------------------------------------------------------------------------
// Serialization Functions
// ----------------------------------------------------------------------------

bool serializeTelemetry(const MessageEnvelope& env, const TelemetryData& data, String& outJson) {
  StaticJsonDocument<1536> doc;

  doc["installation_id"] = DeviceTrust::installation();
  doc["ver"]    = env.version;
  doc["type"]   = messageTypeToString(env.msg_type);
  doc["seq"]    = env.seq;
  doc["sender"] = env.sender_id;
  doc["role"]   = env.role;
  doc["zone"]   = env.zone_id;
  doc["uptime"] = env.uptime_ms;

  writeAnchorContext(doc.as<JsonObject>(), env);

  JsonObject payload = doc["payload"].to<JsonObject>();
  // Canonical BME688 metrics
  payload["temp"]     = serialized(String(data.temp_c, 1));
  payload["hum"]      = serialized(String(data.humidity_pct, 1));
  payload["press"]    = serialized(String(data.pressure_pa, 0));
  payload["gas_res"]  = serialized(String(data.gas_resistance_ohm, 0));
  payload["gas_valid"] = data.bme_gas_valid;
  payload["warming"]  = data.bme_warming;
  payload["batt"]     = serialized(String(data.battery_v, 2));
  payload["batt_pct"] = serialized(String(data.battery_pct, 1));
  payload["fall"]     = data.fall_detected;
  payload["sim"]      = data.is_simulated;
  payload["ok"]       = data.sensor_ok;

  // Only populate co if legacy hardware explicitly has CO sensor
  if (data.has_co) {
    payload["co"] = serialized(String(data.co_ppm, 1));
  }

  outJson = "";
  return !doc.overflowed() && (serializeJson(doc, outJson) > 0);
}

bool serializeAlert(const MessageEnvelope& env, const AlertData& alert, String& outJson) {
  StaticJsonDocument<1280> doc;

  doc["installation_id"] = DeviceTrust::installation();
  doc["ver"]    = env.version;
  doc["type"]   = messageTypeToString(env.msg_type);
  doc["seq"]    = env.seq;
  doc["sender"] = env.sender_id;
  doc["role"]   = env.role;
  doc["zone"]   = env.zone_id;
  doc["uptime"] = env.uptime_ms;

  writeAnchorContext(doc.as<JsonObject>(), env);

  JsonObject payload = doc["payload"].to<JsonObject>();
  payload["severity"] = alertSeverityToString(alert.severity);
  payload["code"]     = alert.alert_code;
  payload["details"]  = alert.details;
  payload["val"]      = serialized(String(alert.trigger_value, 2));

  outJson = "";
  return !doc.overflowed() && (serializeJson(doc, outJson) > 0);
}

bool serializeLocalAck(const MessageEnvelope& env, const LocalAckData& ack, String& outJson) {
  StaticJsonDocument<768> doc;

  doc["installation_id"] = DeviceTrust::installation();
  doc["ver"]    = env.version;
  doc["type"]   = "LOCAL_ACK";
  doc["seq"]    = env.seq;
  doc["sender"] = env.sender_id;
  doc["role"]   = env.role;
  doc["zone"]   = env.zone_id;
  doc["uptime"] = env.uptime_ms;

  writeAnchorContext(doc.as<JsonObject>(), env);

  JsonObject payload = doc["payload"].to<JsonObject>();
  payload["cleared"]  = ack.cleared_alarms;
  payload["held_ms"]  = ack.held_ms;
  payload["device"]   = ack.device_id;

  outJson = "";
  return !doc.overflowed() && (serializeJson(doc, outJson) > 0);
}

bool serializeHeartbeat(const MessageEnvelope& env, const HeartbeatData& hb, String& outJson) {
  StaticJsonDocument<896> doc;

  doc["installation_id"] = DeviceTrust::installation();
  doc["ver"]    = env.version;
  doc["type"]   = messageTypeToString(env.msg_type);
  doc["seq"]    = env.seq;
  doc["sender"] = env.sender_id;
  doc["role"]   = env.role;
  doc["zone"]   = env.zone_id;
  doc["uptime"] = env.uptime_ms;

  writeAnchorContext(doc.as<JsonObject>(), env);

  JsonObject payload = doc["payload"].to<JsonObject>();
  payload["heap"]     = hb.free_heap;
  payload["nodes"]    = hb.mesh_node_count;
  payload["batt"]     = serialized(String(hb.battery_v, 2));
  payload["batt_pct"] = serialized(String(hb.battery_pct, 1));

  outJson = "";
  return !doc.overflowed() && (serializeJson(doc, outJson) > 0);
}

bool serializeProvRequest(const MessageEnvelope& env, const ProvisioningRequestData& req, String& outJson) {
  StaticJsonDocument<1536> doc;
  doc["installation_id"] = DeviceTrust::installation();
  doc["ver"]    = env.version;
  doc["type"]   = messageTypeToString(env.msg_type);
  doc["seq"]    = env.seq;
  doc["sender"] = env.sender_id;
  doc["role"]   = env.role;
  doc["zone"]   = env.zone_id;
  doc["uptime"] = env.uptime_ms;

  JsonObject payload = doc["payload"].to<JsonObject>();
  payload["chip_mac"] = req.chip_mac;
  payload["chip_id"]  = req.chip_id;
  payload["mesh_id"]  = req.mesh_node_id;
  payload["fw_ver"]   = req.fw_version;
  payload["batt"]     = serialized(String(req.battery_v, 2));
  payload["bme_ok"]   = req.bme_healthy;
  payload["mq_ok"]    = req.mq_healthy;
  payload["mpu_ok"]   = req.mpu_healthy;

  DeviceTrust::clockRequest(payload);
  outJson = "";
  return !doc.overflowed() && (serializeJson(doc, outJson) > 0);
}

bool serializeProvAssign(const MessageEnvelope& env, const ProvisioningAssignData& assign, String& outJson) {
  StaticJsonDocument<1024> doc;
  doc["installation_id"] = DeviceTrust::installation();
  doc["ver"]    = env.version;
  doc["type"]   = messageTypeToString(env.msg_type);
  doc["seq"]    = env.seq;
  doc["sender"] = env.sender_id;
  doc["role"]   = env.role;
  doc["zone"]   = env.zone_id;
  doc["uptime"] = env.uptime_ms;

  JsonObject payload = doc["payload"].to<JsonObject>();
  payload["target_chip"] = assign.target_chip;
  payload["assigned_id"] = assign.assigned_id;
  payload["role"]        = assign.role;
  payload["zone"]        = assign.zone_id;
  payload["co_warn"]     = serialized(String(assign.co_warn, 1));
  payload["co_crit"]     = serialized(String(assign.co_crit, 1));
  payload["reboot"]      = assign.reboot_now;

  outJson = "";
  return !doc.overflowed() && (serializeJson(doc, outJson) > 0);
}

bool serializeProvConfirm(const MessageEnvelope& env, const ProvisioningConfirmData& conf, String& outJson) {
  StaticJsonDocument<768> doc;
  doc["installation_id"] = DeviceTrust::installation();
  doc["ver"]    = env.version;
  doc["type"]   = messageTypeToString(env.msg_type);
  doc["seq"]    = env.seq;
  doc["sender"] = env.sender_id;
  doc["role"]   = env.role;
  doc["zone"]   = env.zone_id;
  doc["uptime"] = env.uptime_ms;

  JsonObject payload = doc["payload"].to<JsonObject>();
  payload["chip_id"] = conf.chip_id;
  payload["status"]  = conf.status;

  outJson = "";
  return !doc.overflowed() && (serializeJson(doc, outJson) > 0);
}

// ----------------------------------------------------------------------------
// Deserialization & Legacy Compatibility
// ----------------------------------------------------------------------------

bool deserializePacket(
  const String& jsonStr,
  MessageEnvelope& outEnv,
  TelemetryData& outTelemetry,
  AlertData& outAlert,
  HeartbeatData& outHb,
  bool& outIsLegacy
) {
  outIsLegacy = false;

  memset(&outEnv, 0, sizeof(outEnv));
  memset(&outTelemetry, 0, sizeof(outTelemetry));
  memset(&outAlert, 0, sizeof(outAlert));
  memset(&outHb, 0, sizeof(outHb));

  if (jsonStr.length() == 0) return false;

  StaticJsonDocument<2048> doc;
  DeserializationError error = deserializeJson(doc, jsonStr);
  if (error) return false;

  // --- 1. Check for Legacy Unversioned Payload ---
  if (!doc.containsKey("ver") && doc.containsKey("miner_id")) {
    outIsLegacy = true;
    outEnv.version = 0;
    outEnv.msg_type = MSG_TELEMETRY;
    outEnv.seq = 0;
    outEnv.uptime_ms = 0;
    const char* legacyMiner = doc["miner_id"] | "LEGACY_NODE";
    strncpy(outEnv.sender_id, legacyMiner, sizeof(outEnv.sender_id) - 1);
    strncpy(outEnv.role, "WEARABLE", sizeof(outEnv.role) - 1);
    strncpy(outEnv.zone_id, "UNASSIGNED", sizeof(outEnv.zone_id) - 1);

    outTelemetry.co_ppm        = doc["co"] | 0.0f;
    outTelemetry.has_co        = true;
    outTelemetry.fall_detected = doc["fall"] | false;
    outTelemetry.temp_c        = 0.0f;
    outTelemetry.humidity_pct  = 0.0f;
    outTelemetry.pressure_pa   = 101325.0f;
    outTelemetry.gas_resistance_ohm = 0.0f;
    outTelemetry.battery_v     = 0.0f;
    outTelemetry.battery_pct   = 0.0f;
    outTelemetry.is_simulated  = true;
    outTelemetry.sensor_ok     = true;
    return true;
  }

  // --- 2. Standard Protocol (v1 or v2) ---
  if (!doc.containsKey("ver") || !doc.containsKey("type") || !doc.containsKey("sender")) {
    return false;
  }

  outEnv.version = doc["ver"] | 1;
  outEnv.seq = doc["seq"] | 0;
  outEnv.uptime_ms = doc["uptime"] | 0;

  const char* typeStr = doc["type"] | "UNKNOWN";
  outEnv.msg_type = stringToMessageType(typeStr);

  const char* senderStr = doc["sender"] | "";
  strncpy(outEnv.sender_id, senderStr, sizeof(outEnv.sender_id) - 1);

  const char* roleStr = doc["role"] | "UNKNOWN";
  strncpy(outEnv.role, roleStr, sizeof(outEnv.role) - 1);

  const char* zoneStr = doc["zone"] | "";
  strncpy(outEnv.zone_id, zoneStr, sizeof(outEnv.zone_id) - 1);

  // Unpack Anchor Context if present
  if (doc.containsKey("anchor") && doc["anchor"].is<JsonObject>()) {
    JsonObject anchor = doc["anchor"].as<JsonObject>();
    const char* aId = anchor["id"] | "";
    const char* aZone = anchor["zone"] | "";
    const char* aState = anchor["state"] | "CURRENT";
    strncpy(outEnv.anchor_id, aId, sizeof(outEnv.anchor_id) - 1);
    strncpy(outEnv.anchor_zone, aZone, sizeof(outEnv.anchor_zone) - 1);
    strncpy(outEnv.link_state, aState, sizeof(outEnv.link_state) - 1);
    outEnv.hop_distance = (int8_t)(anchor["hop"] | 1);
    outEnv.rssi = (int8_t)(anchor["rssi"] | 0);
  }

  if (!validateEnvelope(outEnv)) {
    return false;
  }

  JsonObject payload = doc["payload"].as<JsonObject>();
  if (payload.isNull()) return false;

  switch (outEnv.msg_type) {
    case MSG_TELEMETRY:
      outTelemetry.temp_c            = payload["temp"] | (payload["temp_c"] | 0.0f);
      outTelemetry.humidity_pct      = payload["hum"] | (payload["humidity_pct"] | 0.0f);
      outTelemetry.pressure_pa       = payload["press"] | (payload["pressure_pa"] | 101325.0f);
      outTelemetry.gas_resistance_ohm = payload["gas_res"] | (payload["gas_resistance_ohm"] | 0.0f);
      outTelemetry.bme_gas_valid     = payload["gas_valid"] | true;
      outTelemetry.bme_warming       = payload["warming"] | false;
      outTelemetry.bme_healthy       = (outTelemetry.temp_c > -40.0f && outTelemetry.temp_c < 85.0f);
      outTelemetry.battery_v         = payload["batt"] | (payload["battery_v"] | 0.0f);
      outTelemetry.battery_pct       = payload["batt_pct"] | (payload["battery_pct"] | 0.0f);
      outTelemetry.fall_detected     = payload["fall"] | (payload["fall_detected"] | false);
      outTelemetry.is_simulated      = payload["sim"] | (payload["is_simulated"] | false);
      outTelemetry.sensor_ok         = payload["ok"] | (payload["sensor_ok"] | true);
      if (payload.containsKey("co") || payload.containsKey("co_ppm")) {
        outTelemetry.co_ppm = payload["co"] | (payload["co_ppm"] | 0.0f);
        outTelemetry.has_co = true;
      } else {
        outTelemetry.co_ppm = 0.0f;
        outTelemetry.has_co = false;
      }
      return true;

    case MSG_ALERT: {
      const char* sevStr = payload["severity"] | "NONE";
      outAlert.severity = stringToAlertSeverity(sevStr);
      const char* codeStr = payload["code"] | (payload["alert_code"] | "UNKNOWN");
      strncpy(outAlert.alert_code, codeStr, sizeof(outAlert.alert_code) - 1);
      const char* detStr = payload["details"] | "";
      strncpy(outAlert.details, detStr, sizeof(outAlert.details) - 1);
      outAlert.trigger_value = payload["val"] | (payload["trigger_value"] | 0.0f);
      return true;
    }

    case MSG_HEARTBEAT:
      outHb.free_heap       = payload["heap"] | (payload["free_heap"] | 0);
      outHb.mesh_node_count = payload["nodes"] | 0;
      outHb.battery_v       = payload["batt"] | (payload["battery_v"] | 0.0f);
      outHb.battery_pct     = payload["batt_pct"] | 0.0f;
      return true;

    case MSG_LOCAL_ACK:
    case MSG_COMMAND_RESULT:
    case MSG_PROV_REQ:
    case MSG_PROV_ASSIGN:
    case MSG_PROV_CONFIRM:
      return true;

    default:
      return false;
  }
}

bool deserializeLocalAck(const String& jsonStr, MessageEnvelope& outEnv, LocalAckData& outAck) {
  memset(&outEnv, 0, sizeof(outEnv));
  memset(&outAck, 0, sizeof(outAck));
  StaticJsonDocument<1024> doc;
  if (deserializeJson(doc, jsonStr)) return false;

  outEnv.version = doc["ver"] | 2;
  outEnv.msg_type = MSG_LOCAL_ACK;
  outEnv.seq = doc["seq"] | 0;
  outEnv.uptime_ms = doc["uptime"] | 0;
  const char* sender = doc["sender"] | "";
  strncpy(outEnv.sender_id, sender, sizeof(outEnv.sender_id) - 1);
  const char* role = doc["role"] | "WEARABLE";
  strncpy(outEnv.role, role, sizeof(outEnv.role) - 1);
  const char* zone = doc["zone"] | "";
  strncpy(outEnv.zone_id, zone, sizeof(outEnv.zone_id) - 1);

  JsonObject payload = doc["payload"].as<JsonObject>();
  if (payload.isNull()) return false;
  outAck.cleared_alarms = payload["cleared"] | 0;
  outAck.held_ms = payload["held_ms"] | 2000;
  const char* dev = payload["device"] | sender;
  strncpy(outAck.device_id, dev, sizeof(outAck.device_id) - 1);
  return true;
}

bool deserializeProvAssign(const String& jsonStr, ProvisioningAssignData& outAssign) {
  memset(&outAssign, 0, sizeof(outAssign));
  StaticJsonDocument<1024> doc;
  if (deserializeJson(doc, jsonStr)) return false;

  JsonObject payload = doc["payload"].as<JsonObject>();
  if (payload.isNull()) return false;

  const char* target = payload["target_chip"] | "";
  const char* id = payload["assigned_id"] | "";
  const char* role = payload["role"] | "WEARABLE";
  const char* zone = payload["zone"] | "UNASSIGNED";

  strncpy(outAssign.target_chip, target, sizeof(outAssign.target_chip) - 1);
  strncpy(outAssign.assigned_id, id, sizeof(outAssign.assigned_id) - 1);
  strncpy(outAssign.role, role, sizeof(outAssign.role) - 1);
  strncpy(outAssign.zone_id, zone, sizeof(outAssign.zone_id) - 1);
  outAssign.co_warn = payload["co_warn"] | 25.0f;
  outAssign.co_crit = payload["co_crit"] | 50.0f;
  outAssign.reboot_now = payload["reboot"] | true;

  return (strlen(outAssign.target_chip) > 0 && strlen(outAssign.assigned_id) > 0);
}

bool deserializeProvRequest(const String& jsonStr, ProvisioningRequestData& outReq) {
  memset(&outReq, 0, sizeof(outReq));
  StaticJsonDocument<1024> doc;
  if (deserializeJson(doc, jsonStr)) return false;

  JsonObject payload = doc["payload"].as<JsonObject>();
  if (payload.isNull()) return false;

  const char* mac = payload["chip_mac"] | "";
  const char* chip = payload["chip_id"] | "";
  const char* fw = payload["fw_ver"] | "1.0.0";

  strncpy(outReq.chip_mac, mac, sizeof(outReq.chip_mac) - 1);
  strncpy(outReq.chip_id, chip, sizeof(outReq.chip_id) - 1);
  outReq.mesh_node_id = payload["mesh_id"] | 0;
  strncpy(outReq.fw_version, fw, sizeof(outReq.fw_version) - 1);
  outReq.battery_v = payload["batt"] | 0.0f;
  outReq.bme_healthy = payload["bme_ok"] | false;
  outReq.mq_healthy = payload["mq_ok"] | false;
  outReq.mpu_healthy = payload["mpu_ok"] | false;

  return (strlen(outReq.chip_id) > 0);
}

bool deserializeProvConfirm(const String& jsonStr, ProvisioningConfirmData& outConfirm) {
  memset(&outConfirm, 0, sizeof(outConfirm));
  StaticJsonDocument<768> doc;
  if (deserializeJson(doc, jsonStr)) return false;

  JsonObject payload = doc["payload"].as<JsonObject>();
  if (payload.isNull()) return false;

  const char* chip = payload["chip_id"] | "";
  const char* status = payload["status"] | "";

  strncpy(outConfirm.chip_id, chip, sizeof(outConfirm.chip_id) - 1);
  strncpy(outConfirm.status, status, sizeof(outConfirm.status) - 1);

  return (strlen(outConfirm.chip_id) > 0);
}
