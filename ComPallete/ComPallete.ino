#include "DeviceTrust.h"
#include "CommandHandler.h"
#include "painlessMesh.h"
#include <ArduinoJson.h>
#include <esp_system.h>
#include "Config.h"
#include "Protocol.h"
#include "GatewayManager.h"
#include "SensorHAL.h"
#include "NodeConfigManager.h"
#include "CaptivePortalManager.h"
#include "ZoneTracker.h"
#include "RadioDiagnostics.h"

// ============================================================================
// COMPALLETTE - SUBTERRANEAN MESH MONITORING NODE FIRMWARE (Dynamic Provisioning)
// ============================================================================

// --- GLOBAL INSTANCES ---
painlessMesh mesh;
Scheduler userScheduler;
ZoneTracker zoneTracker;
GatewayManager gatewayManager;

// Track mesh network topology
int lastNodeCount = 0;

// SoftAP Setup button tracking (hold onboard BOOT button Pin 0 >= 3s to enter SoftAP Setup)
static uint32_t g_bootButtonHoldStartTime = 0;
static bool     g_bootSetupArmed = false;

// Forward declarations
void handleSerialCLI();
void printDiagnosticBanner();
void printHelpMenu();
void printStatusDashboard();
void runI2CScan();
void runWiFiScan();
void printBootDiagnostics();
void gatewayWiFiEvent(WiFiEvent_t event, WiFiEventInfo_t info);
int  calculateHopDistance(uint32_t targetNodeId);

// Task declarations
void sendTelemetryTask();
void sendHeartbeatTask();
void sendProvRequestTask();
void sendLocalAckEvent(uint8_t clearedAlarms, uint32_t heldMs);

Task taskSendTelemetry(TELEMETRY_INTERVAL_MS, TASK_FOREVER, &sendTelemetryTask);
Task taskSendHeartbeat(HEARTBEAT_INTERVAL_MS, TASK_FOREVER, &sendHeartbeatTask);
Task taskSendProvRequest(8000, TASK_FOREVER, &sendProvRequestTask);

// ----------------------------------------------------------------------------
// IMMEDIATE ALERT DISPATCHER (Event-Driven)
// ----------------------------------------------------------------------------
void sendAlertEvent(AlertSeverity severity, const char* code, const char* details, float triggerVal) {
  if (captivePortal.isActive() || !nodeConfigManager.isProvisioned() || !DeviceTrust::ready()) return;
  MessageEnvelope env;
  env.version = PROTOCOL_VERSION;
  env.msg_type = MSG_ALERT;
  env.seq = nodeConfigManager.nextSequence();
  if (env.seq == 0) return;
  strncpy(env.sender_id, nodeConfigManager.getDeviceId(), sizeof(env.sender_id) - 1);
  strncpy(env.role, nodeRoleToString(nodeConfigManager.getRole()), sizeof(env.role) - 1);
  const char* activeZone = (nodeConfigManager.getRole() == ROLE_WEARABLE) ? zoneTracker.getCurrentZone() : nodeConfigManager.getZoneId();
  strncpy(env.zone_id, activeZone, sizeof(env.zone_id) - 1);
  env.uptime_ms = millis();

  // Populate direct anchor context
  strncpy(env.anchor_id, zoneTracker.getNearestAnchorId(), sizeof(env.anchor_id) - 1);
  strncpy(env.anchor_zone, zoneTracker.getCurrentZone(), sizeof(env.anchor_zone) - 1);
  strncpy(env.link_state, zoneTracker.getLinkStateString(), sizeof(env.link_state) - 1);
  env.hop_distance = (int8_t)zoneTracker.getHopDistance();
  env.rssi = (int8_t)zoneTracker.getRssi();

  AlertData alert;
  alert.severity = severity;
  strncpy(alert.alert_code, code, sizeof(alert.alert_code) - 1);
  strncpy(alert.details, details, sizeof(alert.details) - 1);
  alert.trigger_value = triggerVal;

  String packet;
  if (serializeAlert(env, alert, packet)) {
    int burstCount = (severity == SEVERITY_CRITICAL) ? ALERT_BURST_COUNT : 1;
    for (int i = 0; i < burstCount; i++) {
      mesh.sendBroadcast(packet);
      if (i < burstCount - 1) {
        delay(20);
      }
    }

    if (nodeConfigManager.getRole() == ROLE_GATEWAY) {
      gatewayManager.handleIncomingMeshPacket(mesh.getNodeId(), packet);
    }

    Serial.println("\n**************************************************************");
    Serial.printf("[ALERT TX] Dispatched %s emergency event!\n", alertSeverityToString(severity));
    Serial.printf("   |-- Origin  : %s (%s) @ %s (Anchor: %s | State: %s)\n",
                  env.sender_id, env.role, env.zone_id, env.anchor_id, env.link_state);
    Serial.printf("   |-- Code    : %s\n", alert.alert_code);
    Serial.printf("   |-- Value   : %.2f\n", alert.trigger_value);
    Serial.printf("   |-- Details : %s\n", alert.details);
    Serial.println("**************************************************************");
  }
}

void sendLocalAckEvent(uint8_t clearedAlarms, uint32_t heldMs) {
  if (captivePortal.isActive() || !nodeConfigManager.isProvisioned() || !DeviceTrust::ready()) return;
  MessageEnvelope env;
  env.version = PROTOCOL_VERSION;
  env.msg_type = MSG_LOCAL_ACK;
  env.seq = nodeConfigManager.nextSequence();
  if (env.seq == 0) return;
  strncpy(env.sender_id, nodeConfigManager.getDeviceId(), sizeof(env.sender_id) - 1);
  strncpy(env.role, nodeRoleToString(nodeConfigManager.getRole()), sizeof(env.role) - 1);
  const char* activeZone = (nodeConfigManager.getRole() == ROLE_WEARABLE) ? zoneTracker.getCurrentZone() : nodeConfigManager.getZoneId();
  strncpy(env.zone_id, activeZone, sizeof(env.zone_id) - 1);
  env.uptime_ms = millis();

  strncpy(env.anchor_id, zoneTracker.getNearestAnchorId(), sizeof(env.anchor_id) - 1);
  strncpy(env.anchor_zone, zoneTracker.getCurrentZone(), sizeof(env.anchor_zone) - 1);
  strncpy(env.link_state, zoneTracker.getLinkStateString(), sizeof(env.link_state) - 1);
  env.hop_distance = (int8_t)zoneTracker.getHopDistance();
  env.rssi = (int8_t)zoneTracker.getRssi();

  LocalAckData ack;
  ack.cleared_alarms = clearedAlarms;
  ack.held_ms = heldMs;
  strncpy(ack.device_id, nodeConfigManager.getDeviceId(), sizeof(ack.device_id) - 1);

  String packet;
  if (serializeLocalAck(env, ack, packet)) {
    mesh.sendBroadcast(packet);
    if (nodeConfigManager.getRole() == ROLE_GATEWAY) {
      gatewayManager.handleIncomingMeshPacket(mesh.getNodeId(), packet);
    }
    Serial.println("\n**************************************************************");
    Serial.printf("[LOCAL ACK TX] Acknowledge hold (%u ms) transmitted (Cleared: 0x%02X)\n", heldMs, clearedAlarms);
    Serial.println("**************************************************************");
  }
}

// ----------------------------------------------------------------------------
// NETWORK EVENT CALLBACKS
// ----------------------------------------------------------------------------
void newConnectionCallback(uint32_t nodeId) {
  Serial.println("\n==============================================");
  Serial.printf("[ALERT] New device joined the mesh network! Node ID: %u\n", nodeId);
  Serial.println("==============================================");
}

void changedConnectionCallback() {
  SimpleList<uint32_t> nodeList = mesh.getNodeList();
  int currentNodeCount = nodeList.size();

  Serial.println("\n----------------------------------------------");
  Serial.println("[NETWORK UPDATE] Mesh layout/topology changed!");
  Serial.printf("--> Total active nodes in tunnel network: %d\n", currentNodeCount + 1);

  if (currentNodeCount < lastNodeCount) {
    Serial.println("[ALERT] A node has DISCONNECTED or dropped out of range!");
    if (nodeConfigManager.getRole() == ROLE_WEARABLE && zoneTracker.hasAnchor()) {
      uint32_t anchorNode = zoneTracker.getNearestAnchorNodeId();
      bool anchorStillPresent = false;
      for (auto it = nodeList.begin(); it != nodeList.end(); ++it) {
        if (*it == anchorNode) {
          anchorStillPresent = true;
          break;
        }
      }
      if (!anchorStillPresent) {
        zoneTracker.handleDirectDisconnect(anchorNode);
      }
    }
  } else if (currentNodeCount > lastNodeCount) {
    Serial.println("[INFO] Mesh layout expanded with a new link.");
  }

  lastNodeCount = currentNodeCount;
}

// Gateway radio events are diagnostic only. painlessMesh remains responsible
// for station association and reconnection through stationManual().
void gatewayWiFiEvent(WiFiEvent_t event, WiFiEventInfo_t info) {
  switch (event) {
    case ARDUINO_EVENT_WIFI_STA_CONNECTED:
      Serial.println("[GW RADIO] Router association accepted; waiting for DHCP.");
      break;
    case ARDUINO_EVENT_WIFI_STA_GOT_IP:
      Serial.printf("[GW RADIO] Router DHCP complete: %s | Channel: %u\n",
                    WiFi.localIP().toString().c_str(), WiFi.channel());
      break;
    case ARDUINO_EVENT_WIFI_STA_DISCONNECTED:
      Serial.printf("[GW RADIO] Router station disconnected (reason %d). "
                    "painlessMesh will manage the retry.\n",
                    info.wifi_sta_disconnected.reason);
      break;
    default:
      break;
  }
}

// ----------------------------------------------------------------------------
// TOPOLOGY & PROXIMITY HELPER
// ----------------------------------------------------------------------------
int calculateHopDistance(uint32_t targetNodeId) {
  if (targetNodeId == 0) return 99;

  String subJson = mesh.subConnectionJson();
  if (subJson.length() < 5) {
    return 99; // Never default to 1-hop when topology is unverified!
  }

  StaticJsonDocument<1024> doc;
  DeserializationError err = deserializeJson(doc, subJson);
  if (!err && doc.is<JsonArray>()) {
    JsonArray arr = doc.as<JsonArray>();
    for (JsonObject obj : arr) {
      if (obj["nodeId"].as<uint32_t>() == targetNodeId) {
        return 1; // Immediate direct 1-hop neighbor
      }
      if (obj.containsKey("subs") && obj["subs"].is<JsonArray>()) {
        for (JsonObject sub : obj["subs"].as<JsonArray>()) {
          if (sub["nodeId"].as<uint32_t>() == targetNodeId) {
            return 2; // 2 hops away in mesh tree
          }
        }
      }
    }
  }

  return 99; // Not a verified direct neighbor
}

void receivedCallback(uint32_t from, String &msg) {
  if (handlePlatformCommand(msg, [](const String& response) { mesh.sendBroadcast(response); })) return;
  MessageEnvelope env;
  TelemetryData telem;
  AlertData alert;
  HeartbeatData hb;
  bool isLegacy = false;

  bool ok = deserializePacket(msg, env, telem, alert, hb, isLegacy);
  if (!ok) {
    Serial.printf("\n[ERROR] Malformed or unparseable packet from Node %u\n", from);
    return;
  }

  // If operating as gateway bridge, forward packet to upstream backend
  if (nodeConfigManager.getRole() == ROLE_GATEWAY) {
    gatewayManager.handleIncomingMeshPacket(from, msg);
  }

  // Automatic Zone Tracking (Direct stationary anchor association)
  if (nodeConfigManager.getRole() == ROLE_WEARABLE) {
    bool isStationary = (strcmp(env.role, "ANCHOR") == 0 || strcmp(env.role, "GATEWAY") == 0);
    int hops = calculateHopDistance(from);
    int rssi = env.rssi != 0 ? env.rssi : -65;
    zoneTracker.handleAnchorBeacon(env.sender_id, env.zone_id, from, hops, rssi, isStationary);
  }

  // Handle Option 1: Downlink Provisioning Assignment from Gateway
  if (env.msg_type == MSG_PROV_ASSIGN) {
    Serial.println("[PROV] Legacy uncorrelated assignment rejected; use platform commands.");
    return;
  }

  // Handle Standard v1/v2 protocol packets
  switch (env.msg_type) {
    case MSG_TELEMETRY:
      Serial.printf("\n[TELEMETRY v%u | Seq #%u] %s (%s) @ %s | T: %.1f C | H: %.1f %% | P: %.0f Pa | Batt: %.2f V\n",
                    env.version, env.seq, env.sender_id, env.role, env.zone_id, telem.temp_c, telem.humidity_pct, telem.pressure_pa, telem.battery_v);
      break;

    case MSG_ALERT:
      Serial.println("\n**************************************************************");
      Serial.printf(" [EMERGENCY ALERT] Severity: %s | Origin: %s @ %s\n",
                    alertSeverityToString(alert.severity), env.sender_id, env.zone_id);
      Serial.printf("   |-- Code    : %s\n", alert.alert_code);
      Serial.printf("   |-- Details : %s\n", alert.details);
      Serial.println("**************************************************************");
      break;

    case MSG_LOCAL_ACK:
      Serial.println("\n**************************************************************");
      Serial.printf(" [LOCAL ALARM ACKNOWLEDGED] Device: %s @ %s\n", env.sender_id, env.zone_id);
      Serial.println("**************************************************************");
      break;

    case MSG_HEARTBEAT:
      Serial.printf("\n[HEARTBEAT] Node: %s (%s) | Free Heap: %u B | Peers: %d\n",
                    env.sender_id, env.role, hb.free_heap, hb.mesh_node_count);
      break;

    default:
      break;
  }
}

// ----------------------------------------------------------------------------
// SCHEDULED TASKS
// ----------------------------------------------------------------------------

// Periodic Telemetry Task (runs on wearable miner tags, and gateway nodes for desk testing)
void sendTelemetryTask() {
  if (nodeConfigManager.getRole() != ROLE_WEARABLE && nodeConfigManager.getRole() != ROLE_GATEWAY) {
    return;
  }

  SensorReadings readings = sensorHAL.read();

  TelemetryData data;
  data.temp_c = readings.temp_c;
  data.humidity_pct = readings.humidity_pct;
  data.pressure_pa = readings.pressure_pa;
  data.gas_resistance_ohm = readings.gas_resistance_ohm;
  data.bme_healthy = readings.bme_healthy;
  data.bme_warming = readings.bme_warming;
  data.bme_gas_valid = readings.bme_gas_valid;
  data.battery_v = readings.battery_v;
  data.battery_pct = readings.battery_pct;
  data.fall_detected = readings.fall_detected;
  data.is_simulated = readings.is_simulated;
  data.sensor_ok = readings.sensor_ok;
  data.co_ppm = readings.co_ppm;
  data.has_co = readings.mq_healthy;

  // Threshold alerts
  if (data.fall_detected) {
    sendAlertEvent(SEVERITY_CRITICAL, "MAN_DOWN", "Miner fall confirmed via IMU (impact + inactivity)", readings.accel_magnitude);
  }
  // CO thresholds only apply to legacy MQ-7 devices that actually measure CO!
  if (data.has_co) {
    if (data.co_ppm >= nodeConfigManager.get().co_critical_ppm) {
      sensorHAL.raiseAlarm(Safety::GasCritical);
      sendAlertEvent(SEVERITY_CRITICAL, "GAS_CO_CRITICAL", "Dangerous CO concentration detected", data.co_ppm);
    } else if (data.co_ppm >= nodeConfigManager.get().co_warning_ppm) {
      sensorHAL.raiseAlarm(Safety::GasWarning);
      sendAlertEvent(SEVERITY_WARNING, "GAS_CO_HIGH", "CO concentration exceeded warning limit", data.co_ppm);
    }
  }

  if (captivePortal.isActive() || !nodeConfigManager.isProvisioned() || !DeviceTrust::ready()) return;
  MessageEnvelope env;
  env.version = PROTOCOL_VERSION;
  env.msg_type = MSG_TELEMETRY;
  env.seq = nodeConfigManager.nextSequence();
  if (env.seq == 0) return;
  strncpy(env.sender_id, nodeConfigManager.getDeviceId(), sizeof(env.sender_id) - 1);
  strncpy(env.role, nodeRoleToString(nodeConfigManager.getRole()), sizeof(env.role) - 1);
  const char* activeTelemZone = (nodeConfigManager.getRole() == ROLE_WEARABLE) ? zoneTracker.getCurrentZone() : nodeConfigManager.getZoneId();
  strncpy(env.zone_id, activeTelemZone, sizeof(env.zone_id) - 1);
  env.uptime_ms = millis();

  // Populate direct anchor context
  strncpy(env.anchor_id, zoneTracker.getNearestAnchorId(), sizeof(env.anchor_id) - 1);
  strncpy(env.anchor_zone, zoneTracker.getCurrentZone(), sizeof(env.anchor_zone) - 1);
  strncpy(env.link_state, zoneTracker.getLinkStateString(), sizeof(env.link_state) - 1);
  env.hop_distance = (int8_t)zoneTracker.getHopDistance();
  env.rssi = (int8_t)zoneTracker.getRssi();

  String packet;
  if (serializeTelemetry(env, data, packet)) {
    mesh.sendBroadcast(packet);
    Serial.printf("[TX TELEM v%u #%u] %s @ %s (%s) | T: %.1f C | H: %.1f %% | P: %.0f Pa | Gas: %.0f Ohm | Batt: %.2f V (~%.0f%%)\n",
                  env.version, env.seq, env.sender_id, env.zone_id, env.link_state,
                  data.temp_c, data.humidity_pct, data.pressure_pa, data.gas_resistance_ohm,
                  data.battery_v, data.battery_pct);

    if (nodeConfigManager.getRole() == ROLE_GATEWAY) {
      gatewayManager.handleIncomingMeshPacket(mesh.getNodeId(), packet);
    }
  }
}

// Keep-Alive Heartbeat Task
void sendHeartbeatTask() {
  MessageEnvelope env;
  env.version = PROTOCOL_VERSION;
  env.msg_type = MSG_HEARTBEAT;
  env.seq = nodeConfigManager.nextSequence();
  if (env.seq == 0) return;
  strncpy(env.sender_id, nodeConfigManager.getDeviceId(), sizeof(env.sender_id) - 1);
  strncpy(env.role, nodeRoleToString(nodeConfigManager.getRole()), sizeof(env.role) - 1);
  const char* activeHbZone = (nodeConfigManager.getRole() == ROLE_WEARABLE) ? zoneTracker.getCurrentZone() : nodeConfigManager.getZoneId();
  strncpy(env.zone_id, activeHbZone, sizeof(env.zone_id) - 1);
  env.uptime_ms = millis();

  HeartbeatData hb;
  hb.free_heap = ESP.getFreeHeap();
  hb.mesh_node_count = mesh.getNodeList().size();
  hb.battery_v = sensorHAL.read().battery_v;

  String packet;
  if (serializeHeartbeat(env, hb, packet)) {
    mesh.sendBroadcast(packet);
    Serial.printf("\n[TX HEARTBEAT #%u] %s (%s) | Free Heap: %u B | Peers: %d\n",
                  env.seq, env.sender_id, env.role, hb.free_heap, hb.mesh_node_count);

    if (nodeConfigManager.getRole() == ROLE_GATEWAY) {
      gatewayManager.handleIncomingMeshPacket(mesh.getNodeId(), packet);
    }
  }
}

// Provisioning Request Announcement Task (Option 1: runs on unprovisioned nodes)
void sendProvRequestTask() {
  if (!DeviceTrust::ready()) return;

  MessageEnvelope env;
  env.version = PROTOCOL_VERSION;
  env.msg_type = MSG_PROV_REQ;
  env.seq = nodeConfigManager.nextSequence();
  if (env.seq == 0) return;
  strncpy(env.sender_id, nodeConfigManager.getDeviceId(), sizeof(env.sender_id) - 1);
  strncpy(env.role, "UNASSIGNED", sizeof(env.role) - 1);
  strncpy(env.zone_id, "UNASSIGNED", sizeof(env.zone_id) - 1);
  env.uptime_ms = millis();

  SensorReadings s = sensorHAL.read();

  ProvisioningRequestData req;
  strncpy(req.chip_mac, nodeConfigManager.getChipMac(), sizeof(req.chip_mac) - 1);
  strncpy(req.chip_id, nodeConfigManager.getChipId(), sizeof(req.chip_id) - 1);
  req.mesh_node_id = mesh.getNodeId();
  strncpy(req.fw_version, "1.1.0", sizeof(req.fw_version) - 1);
  req.battery_v = s.battery_v;
  req.bme_healthy = s.bme_healthy;
  req.mq_healthy = s.mq_healthy;
  req.mpu_healthy = s.mpu_healthy;

  String packet;
  if (serializeProvRequest(env, req, packet)) {
    if (nodeConfigManager.getRole() == ROLE_GATEWAY) gatewayManager.handleIncomingMeshPacket(mesh.getNodeId(), packet);
    else mesh.sendBroadcast(packet);
    Serial.printf("\n[PROV TX BEACON] Emitted enrollment announcement for Chip #%s over mesh\n", req.chip_id);
  }
}

// ----------------------------------------------------------------------------
// DIAGNOSTIC STARTUP BANNER & SYSTEM SUMMARY
// ----------------------------------------------------------------------------
void printDiagnosticBanner() {
  Serial.println();
  Serial.println("================================================================================");
  Serial.println("         COMPALLETTE | SUBTERRANEAN MINING SAFETY PLATFORM (FIRMWARE v1.2)      ");
  Serial.println("================================================================================");
  Serial.printf("  [SYS] Silicon Architecture     : %s\n", 
#if defined(CONFIG_IDF_TARGET_ESP32S3)
    "ESP32-S3 (Freenove S3 / Native USB CDC)"
#elif defined(CONFIG_IDF_TARGET_ESP32)
    "ESP32 Classic (Freenove WROOM / WROVER)"
#else
    "Generic ESP32"
#endif
  );
  Serial.printf("  [SYS] CPU Clock Speed          : %u MHz\n", ESP.getCpuFreqMHz());
  Serial.printf("  [SYS] Silicon Revision         : %u\n", ESP.getChipRevision());
  Serial.printf("  [SYS] Free Internal Heap       : %u bytes\n", ESP.getFreeHeap());
  Serial.printf("  [SYS] Flash Storage Size       : %u MB\n", ESP.getFlashChipSize() / (1024 * 1024));
  Serial.printf("  [SYS] Hardware Chip MAC        : %s\n", nodeConfigManager.getChipMac());
  Serial.printf("  [SYS] Hardware Chip ID         : %s\n", nodeConfigManager.getChipId());
  Serial.println("--------------------------------------------------------------------------------");
  Serial.printf("  [CFG] Commissioning State      : %s\n",
                nodeConfigManager.isProvisioned() ? "COMMISSIONED (Production Mesh Mode)" : "UNCOMMISSIONED (SoftAP Setup Mode)");
  Serial.printf("  [CFG] Active Device ID         : %s\n", nodeConfigManager.getDeviceId());
  Serial.printf("  [CFG] Assigned Role            : %s\n", nodeRoleToString(nodeConfigManager.getRole()));
  if (nodeConfigManager.getRole() == ROLE_WEARABLE) {
    Serial.printf("  [CFG] Subterranean Zone        : %s (Option 1 Dynamic Proximity Tracking)\n", zoneTracker.getCurrentZone());
  } else {
    Serial.printf("  [CFG] Subterranean Zone        : %s (Fixed Stationary Reference)\n", nodeConfigManager.getZoneId());
  }
  Serial.printf("  [CFG] Mesh Network             : %s (Channel %d)\n", nodeConfigManager.getMeshPrefix(), nodeConfigManager.getMeshChannel());
  if (nodeConfigManager.getRole() == ROLE_GATEWAY) {
    Serial.printf("  [CFG] Uplink Wi-Fi (GW)        : %s\n", nodeConfigManager.getUplinkSsid());
    Serial.printf("  [CFG] Upstream Backend URL     : %s\n", nodeConfigManager.getBackendUrl());
  }
  Serial.println("--------------------------------------------------------------------------------");
  Serial.println("  [CLI] Type 'help' in Serial Monitor for interactive diagnostics & configuration.");
  Serial.println("================================================================================\n");
  Serial.flush();
}

// ----------------------------------------------------------------------------
// INTERACTIVE SERIAL CLI (Command-Line Interface)
// ----------------------------------------------------------------------------
void printHelpMenu() {
  Serial.println("\n+--------------------------------------------------------------+");
  Serial.println("|              COMPALLETTE SERIAL CLI COMMAND LIST             |");
  Serial.println("+--------------------------------------------------------------+");
  Serial.println("  help            - Display this command reference");
  Serial.println("  status          - Print full real-time telemetry & system health");
  Serial.println("  setup           - Switch to SoftAP Captive Portal mode and restart");
  Serial.println("  portal          - Show the active SoftAP SSID and temporary password");
  Serial.println("  mesh            - Switch to Production Mesh mode and restart");
  Serial.println("  scan            - Scan I2C bus; Wi-Fi spectrum scan is disabled for radio safety");
  Serial.println("  role <0|1|2>    - Change operational role (0:Wearable, 1:Anchor, 2:Gateway)");
  Serial.println("  id <name>       - Change device badge ID (e.g., id MINER-108)");
  Serial.println("  zone [name|auto]- Change or view subterranean zone (Wearables support 'zone auto')");
  Serial.println("  wifi            - Display Wi-Fi station status, IP, and RSSI");
  Serial.println("  mdns <host>     - Query Multicast DNS to resolve a .local hostname");
  Serial.println("  testpost        - Verify a heartbeat using explicitly selected HTTP recovery");
  Serial.println("  trust           - Display device trust enrollment status & LittleFS details");
  Serial.println("  trust-init [key]- Initialize /device-trust.json and gateway credentials on LittleFS");
  Serial.println("  trust-wipe      - Wipe device trust credentials from LittleFS");
  Serial.println("  buffer          - Display store-and-forward queue depths & drop counters");
  Serial.println("  buffer-archive <installation UUID> - Preserve old queue for cutover (export archive afterward)");
  Serial.println("  api [url]       - View or set the backend REST API URL in NVS");
  Serial.println("  key [token]     - View or set the 32+ character gateway API key in NVS");
  Serial.println("  uplink [ssid] [pass] - View or set uplink Wi-Fi credentials in NVS");
  Serial.println("  reset           - Factory reset all persistent NVS settings");
  Serial.println("  reboot          - Perform a software restart of the ESP32");
  Serial.println("+--------------------------------------------------------------+\n");
}

void printStatusDashboard() {
  SensorReadings s = sensorHAL.read();
  uint32_t upSec = millis() / 1000;
  uint32_t upMin = upSec / 60;
  upSec %= 60;

  Serial.println("\n+--------------------------------------------------------------+");
  Serial.println("|               COMPALLETTE LIVE STATUS DASHBOARD              |");
  Serial.println("+--------------------------------------------------------------+");
  Serial.printf("  Node ID       : %s (%s)\n", nodeConfigManager.getDeviceId(), nodeRoleToString(nodeConfigManager.getRole()));
  if (nodeConfigManager.getRole() == ROLE_WEARABLE) {
    Serial.printf("  Zone (Dynamic): %s [%s]\n",
                  zoneTracker.getCurrentZone(),
                  zoneTracker.isAutoTracking() ? "AUTO (Nearest Anchor)" : "MANUAL TEST OVERRIDE");
    if (zoneTracker.hasAnchor()) {
      Serial.printf("  Nearest Anchor: %s (Heard %u s ago | Hop: %d | RSSI: %d dBm)\n",
                    zoneTracker.getNearestAnchorId(),
                    (unsigned)(zoneTracker.getTimeSinceLastBeaconMs() / 1000),
                    zoneTracker.getHopDistance(),
                    zoneTracker.getRssi());
    } else {
      Serial.println("  Nearest Anchor: NONE (Listening for stationary tunnel anchors...)");
    }
  } else {
    Serial.printf("  Zone (Fixed)  : %s\n", nodeConfigManager.getZoneId());
  }
  Serial.printf("  Uptime        : %u min %u sec\n", upMin, upSec);
  Serial.printf("  Free Heap     : %u bytes\n", ESP.getFreeHeap());
  Serial.printf("  Active Mode   : %s\n", captivePortal.isActive() ? "SOFTAP SETUP (Captive Portal)" : "PRODUCTION MESH");

  if (captivePortal.isActive()) {
    Serial.printf("  SoftAP SSID   : %s (IP: 192.168.4.1)\n", captivePortal.getSsid());
  } else {
    SimpleList<uint32_t> peers = mesh.getNodeList();
    Serial.printf("  Mesh Node ID  : %u | Connected Peers: %d\n", mesh.getNodeId(), (int)peers.size());
    Serial.printf("  Mesh Radio    : TCP port %u | Commissioned channel %u\n",
                  MESH_PORT, nodeConfigManager.getMeshChannel());
    if (nodeConfigManager.getRole() == ROLE_GATEWAY) {
      Serial.printf("  Router Link   : Wi-Fi status %d | Current channel %u\n",
                    (int)WiFi.status(), WiFi.channel());
    }
  }

  Serial.println("  -- Sensor Readings --");
  Serial.printf("  CO Gas        : %.1f ppm [%s]\n", s.co_ppm, 
                s.co_ppm >= nodeConfigManager.get().co_critical_ppm ? "CRITICAL ALARM" :
                (s.co_ppm >= nodeConfigManager.get().co_warning_ppm ? "WARNING" : "NORMAL"));
  Serial.printf("  Temperature   : %.1f C\n", s.temp_c);
  Serial.printf("  Humidity      : %.1f %%\n", s.humidity_pct);
  Serial.printf("  IMU Accel     : %.2f g (Fall: %s)\n", s.accel_magnitude, s.fall_detected ? "FALL CONFIRMED" : "CLEAR");
  Serial.printf("  Battery       : %.2f V (~%.0f%%)\n", s.battery_v, s.battery_pct);
  Serial.printf("  Hardware HAL  : MQ-7 [%s] | MPU6050 [%s] | ADC [%s]\n",
                s.mq_healthy ? "OK" : "SIM", s.mpu_healthy ? "OK" : "SIM", s.battery_healthy ? "OK" : "SIM");
  Serial.println("+--------------------------------------------------------------+\n");
}

void runI2CScan() {
  Serial.println("\n[I2C] Scanning I2C bus (pins SDA=" + String(PIN_I2C_SDA) + ", SCL=" + String(PIN_I2C_SCL) + ")...");
  int nDevices = 0;
  for (uint8_t address = 1; address < 127; ++address) {
    Wire.beginTransmission(address);
    uint8_t error = Wire.endTransmission();
    if (error == 0) {
      Serial.printf("  |-- Found I2C device at 0x%02X", address);
      if (address == 0x68 || address == 0x69) {
        Serial.print(" (MPU-6050 6-Axis IMU)");
      }
      Serial.println();
      nDevices++;
    }
  }
  if (nDevices == 0) {
    Serial.println("  |-- No I2C devices detected. Check SDA/SCL pull-up resistors or wiring.");
  } else {
    Serial.printf("  |-- Total %d I2C device(s) found.\n", nDevices);
  }
}

void runWiFiScan() {
  // An active scan changes the shared Wi-Fi radio state. On an ESP32 running
  // painlessMesh it can disconnect the STA or move a mesh peer off-channel.
  Serial.println("\n[WIFI] Spectrum scan is disabled while firmware is running.");
  Serial.println("  |-- Use an external 2.4 GHz Wi-Fi analyser to inspect router channels.");
  Serial.println("  |-- The configured mesh channel is shown at production-mesh startup.");
}

void printBootDiagnostics() {
  Serial.printf("[BOOT] ESP reset reason code: %d | millis() reset to 0\n",
                static_cast<int>(esp_reset_reason()));
}

void handleSerialCLI() {
  static char cliBuf[256];
  static size_t cliIndex = 0;

  while (Serial.available() > 0) {
    char c = Serial.read();
    if (c == '\r' || c == '\n') {
      if (cliIndex == 0) continue;
      cliBuf[cliIndex] = '\0';

      // Trim leading spaces
      char* cmd = cliBuf;
      while (*cmd == ' ') cmd++;

      if (strcmp(cmd, "help") == 0 || strcmp(cmd, "?") == 0) {
        printHelpMenu();
      } else if (strcmp(cmd, "status") == 0) {
        printStatusDashboard();
      } else if (strcmp(cmd, "setup") == 0) {
        Serial.println("\n[CLI] Entering SoftAP Setup Mode (Captive Portal)...");
        nodeConfigManager.enterSetupMode();
        delay(200);
        ESP.restart();
      } else if (strcmp(cmd, "portal") == 0 || strcmp(cmd, "credentials") == 0) {
        if (captivePortal.isActive()) {
          captivePortal.printCredentials();
        } else {
          Serial.println("[CLI] Captive portal is not active. Run 'setup' and wait for the node to restart.");
        }
      } else if (strcmp(cmd, "mesh") == 0) {
        Serial.println("\n[CLI] Transitioning node to Production Mesh Mode...");
        NodeConfig cfg = nodeConfigManager.get();
        cfg.mesh_configured = true;
        cfg.is_provisioned = cfg.role == ROLE_GATEWAY;
        nodeConfigManager.save(cfg);
        delay(200);
        ESP.restart();
      } else if (strcmp(cmd, "scan") == 0) {
        runI2CScan();
        runWiFiScan();
      } else if (strncmp(cmd, "role ", 5) == 0) {
        int r = atoi(cmd + 5);
        if (r >= 0 && r <= 2) {
          NodeConfig cfg = nodeConfigManager.get();
          cfg.role = (NodeRole)r;
          if (!nodeConfigManager.save(cfg)) return;
          Serial.printf("[CLI] Node role updated to: %s\n", nodeRoleToString(cfg.role));
        } else {
          Serial.println("[CLI ERROR] Invalid role. Use: 0 (Wearable), 1 (Anchor), 2 (Gateway)");
        }
      } else if (strncmp(cmd, "id ", 3) == 0) {
        char* newId = cmd + 3;
        while (*newId == ' ') newId++;
        if (strlen(newId) > 0) {
          NodeConfig cfg = nodeConfigManager.get();
          strncpy(cfg.device_id, newId, sizeof(cfg.device_id) - 1);
          if (!nodeConfigManager.save(cfg)) return;
          Serial.printf("[CLI] Device ID updated to: %s\n", cfg.device_id);
        }
      } else if (strncmp(cmd, "zone", 4) == 0) {
        char* newZone = cmd + 4;
        while (*newZone == ' ') newZone++;
        if (strlen(newZone) == 0) {
          const char* curZ = (nodeConfigManager.getRole() == ROLE_WEARABLE) ? zoneTracker.getCurrentZone() : nodeConfigManager.getZoneId();
          Serial.printf("  Zone          : %s\n", curZ);
          if (nodeConfigManager.getRole() == ROLE_WEARABLE) {
            Serial.printf("  Tracking Mode : %s\n", zoneTracker.isAutoTracking() ? "AUTO (Option 1 Anchor Proximity)" : "MANUAL TEST OVERRIDE");
            if (zoneTracker.hasAnchor()) {
              Serial.printf("  Nearest Anchor: %s (Heard %u s ago | Hop: %d | RSSI: %d dBm)\n",
                            zoneTracker.getNearestAnchorId(),
                            (unsigned)(zoneTracker.getTimeSinceLastBeaconMs() / 1000),
                            zoneTracker.getHopDistance(),
                            zoneTracker.getRssi());
            } else {
              Serial.println("  Nearest Anchor: NONE (Listening for stationary tunnel anchors...)");
            }
            Serial.println("  Usage: 'zone <name>' for manual test override, 'zone auto' to resume auto-tracking");
          }
        } else if (strcmp(newZone, "auto") == 0) {
          if (nodeConfigManager.getRole() == ROLE_WEARABLE) {
            zoneTracker.resumeAutoTracking();
          } else {
            Serial.println("[CLI] 'zone auto' is only applicable to Wearable tags. Stationary anchors require a fixed zone.");
          }
        } else {
          if (nodeConfigManager.getRole() == ROLE_WEARABLE) {
            zoneTracker.setManualOverride(newZone);
            Serial.printf("[CLI] Wearable test zone override set to: %s (Type 'zone auto' to resume proximity tracking)\n", newZone);
          } else {
            NodeConfig cfg = nodeConfigManager.get();
            strncpy(cfg.zone_id, newZone, sizeof(cfg.zone_id) - 1);
            if (!nodeConfigManager.save(cfg)) return;
            Serial.printf("[CLI] Stationary node zone updated to: %s\n", cfg.zone_id);
          }
        }
      } else if (strcmp(cmd, "wifi") == 0) {
        Serial.println("\n+--------------------------------------------------------------+");
        Serial.println("|                  WI-FI & UPLINK STATUS                       |");
        Serial.println("+--------------------------------------------------------------+");
        Serial.printf("  Wi-Fi Status  : %s\n", (WiFi.status() == WL_CONNECTED) ? "CONNECTED" : "DISCONNECTED");
        if (WiFi.status() == WL_CONNECTED) {
          Serial.printf("  Connected SSID: %s\n", WiFi.SSID().c_str());
          Serial.printf("  IP Address    : %s\n", WiFi.localIP().toString().c_str());
          Serial.printf("  Subnet Mask   : %s\n", WiFi.subnetMask().toString().c_str());
          Serial.printf("  Router Gateway: %s\n", WiFi.gatewayIP().toString().c_str());
          Serial.printf("  Signal (RSSI) : %d dBm\n", WiFi.RSSI());
        }
        Serial.printf("  Configured GW : %s\n", nodeConfigManager.getUplinkSsid());
        Serial.printf("  Backend URL   : %s\n", nodeConfigManager.getBackendUrl());
        Serial.printf("  Gateway State : %s\n", gatewayManager.getStateString());
        Serial.println("+--------------------------------------------------------------+\n");
      } else if (strncmp(cmd, "mdns ", 5) == 0) {
        char* host = cmd + 5;
        while (*host == ' ') host++;
        if (strlen(host) > 0) {
          IPAddress ip = gatewayManager.resolveMdns(host);
          if ((uint32_t)ip != 0) {
            Serial.printf("[CLI] mDNS Resolution: '%s' -> %s\n", host, ip.toString().c_str());
          } else {
            Serial.printf("[CLI ERROR] Could not resolve '%s' via Multicast DNS.\n", host);
          }
        } else {
          Serial.println("[CLI] Usage: mdns <hostname> (e.g., mdns innovation-hub03.local)");
        }
      } else if (strcmp(cmd, "testpost") == 0) {
        Serial.println("\n[CLI] Generating and dispatching live test heartbeat...");
        MessageEnvelope env;
        env.version = PROTOCOL_VERSION;
        env.msg_type = MSG_HEARTBEAT;
        env.seq = nodeConfigManager.nextSequence();
        if (env.seq == 0) return;
        strncpy(env.sender_id, nodeConfigManager.getDeviceId(), sizeof(env.sender_id) - 1);
        strncpy(env.role, nodeRoleToString(nodeConfigManager.getRole()), sizeof(env.role) - 1);
        strncpy(env.zone_id, (nodeConfigManager.getRole() == ROLE_WEARABLE) ? zoneTracker.getCurrentZone() : nodeConfigManager.getZoneId(), sizeof(env.zone_id) - 1);
        env.uptime_ms = millis();

        HeartbeatData hb;
        hb.free_heap = ESP.getFreeHeap();
        hb.mesh_node_count = mesh.getNodeList().size();
        hb.battery_v = sensorHAL.read().battery_v;

        String packet;
        if (serializeHeartbeat(env, hb, packet)) {
          bool ok = gatewayManager.sendDirectTestPacket(packet, MSG_HEARTBEAT);
          if (ok) {
            Serial.println("[CLI] Test heartbeat successfully pushed to backend! Check dashboard.");
          } else {
            Serial.println("[CLI ERROR] Test heartbeat was not accepted. Inspect the response above; Verify the protected local credential bundle and gateway activation.");
          }
        }
      } else if (strncmp(cmd, "api", 3) == 0) {
        char* newApi = cmd + 3;
        while (*newApi == ' ') newApi++;
        if (strlen(newApi) > 0) {
          NodeConfig cfg = nodeConfigManager.get();
          strncpy(cfg.backend_url, newApi, sizeof(cfg.backend_url) - 1);
          if (!nodeConfigManager.save(cfg)) return;
          Serial.printf("[CLI] Backend REST URL updated to: %s\n", cfg.backend_url);
        } else {
          Serial.printf("[CLI] Current Backend URL: %s\n", nodeConfigManager.getBackendUrl());
          Serial.println("  Usage: api <url> (e.g., api http://innovation-hub03.local:8000)");
        }
      } else if (strncmp(cmd, "key", 3) == 0 || strncmp(cmd, "apikey", 6) == 0) {
        char* newKey = strchr(cmd, ' ');
        if (newKey) {
          while (*newKey == ' ') newKey++;
        }
        if (newKey && strlen(newKey) > 0) {
          if (strlen(newKey) >= 32) {
            NodeConfig cfg = nodeConfigManager.get();
            strncpy(cfg.backend_api_key, newKey, sizeof(cfg.backend_api_key) - 1);
            if (!nodeConfigManager.save(cfg)) return;
            Serial.printf("[CLI] Gateway API Key updated (length %u): %s\n", (unsigned)strlen(cfg.backend_api_key), cfg.backend_api_key);
          } else {
            Serial.printf("[CLI ERROR] API key must be at least 32 characters (got %u).\n", (unsigned)strlen(newKey));
          }
        } else {
          const char* curKey = nodeConfigManager.getBackendApiKey();
          Serial.printf("  Gateway API Key: %s (Length: %u)\n", strlen(curKey) >= 4 ? "***configured***" : "(none)", (unsigned)strlen(curKey));
          Serial.println("  Usage: key <32+ character api key>");
        }
      } else if (strncmp(cmd, "uplink", 6) == 0) {
        char* args = cmd + 6;
        while (*args == ' ') args++;
        if (strlen(args) > 0) {
          char ssidBuf[32] = {0};
          char passBuf[64] = {0};
          char* space = strchr(args, ' ');
          if (space) {
            *space = '\0';
            strncpy(ssidBuf, args, sizeof(ssidBuf) - 1);
            char* p = space + 1;
            while (*p == ' ') p++;
            strncpy(passBuf, p, sizeof(passBuf) - 1);
          } else {
            strncpy(ssidBuf, args, sizeof(ssidBuf) - 1);
          }
          NodeConfig cfg = nodeConfigManager.get();
          strncpy(cfg.uplink_ssid, ssidBuf, sizeof(cfg.uplink_ssid) - 1);
          strncpy(cfg.uplink_password, passBuf, sizeof(cfg.uplink_password) - 1);
          if (!nodeConfigManager.save(cfg)) return;
          Serial.printf("[CLI] Uplink Wi-Fi credentials updated: SSID='%s'\n", cfg.uplink_ssid);
        } else {
          Serial.printf("[CLI] Uplink Wi-Fi: SSID='%s'\n", nodeConfigManager.getUplinkSsid());
          Serial.println("  Usage: uplink <ssid> [password]");
        }
      } else if (strncmp(cmd, "buffer-archive ", 15) == 0) {
        if (nodeConfigManager.getRole() != ROLE_GATEWAY
            || !gatewayManager.getBuffer().archiveForCutover(String(cmd + 15))) {
          Serial.println("[CLI] Archive refused. Use the current installation UUID, valid local trust, and an empty archive destination.");
        }
      } else if (strcmp(cmd, "trust") == 0 || strcmp(cmd, "trust-status") == 0) {
        DeviceTrust::printStatus();
      } else if (strncmp(cmd, "trust-init", 10) == 0) {
        char* args = cmd + 10;
        while (*args == ' ') args++;
        char keyBuf[65] = {0};
        char credBuf[65] = {0};
        if (strlen(args) > 0) {
          char* space = strchr(args, ' ');
          if (space) {
            *space = '\0';
            strncpy(keyBuf, args, sizeof(keyBuf) - 1);
            char* p = space + 1;
            while (*p == ' ') p++;
            strncpy(credBuf, p, sizeof(credBuf) - 1);
          } else {
            strncpy(keyBuf, args, sizeof(keyBuf) - 1);
          }
        }
        bool ok = DeviceTrust::provision(strlen(keyBuf) > 0 ? keyBuf : nullptr,
                                         strlen(credBuf) > 0 ? credBuf : nullptr);
        if (ok) {
          Serial.println("[CLI] Device trust successfully provisioned and verified.");
        } else {
          Serial.println("[CLI ERROR] Failed to provision device trust. Run 'trust' for diagnostics.");
        }
      } else if (strcmp(cmd, "trust-wipe") == 0) {
        DeviceTrust::wipe();
      } else if (strcmp(cmd, "buffer") == 0) {
        if (nodeConfigManager.getRole() == ROLE_GATEWAY) {
          OfflineBuffer& buf = gatewayManager.getBuffer();
          Serial.println("\n+--------------------------------------------------------------+");
          Serial.println("|               GATEWAY STORE-AND-FORWARD BUFFER               |");
          Serial.println("+--------------------------------------------------------------+");
          Serial.printf("  Flash Storage  : %s\n", buf.isFlashAvailable() ? "AVAILABLE (LittleFS Mounted)" : "UNAVAILABLE (RAM Fallback Only)");
          Serial.printf("  Queued Packets : %u (Priority: %u | Standard: %u)\n",
                        buf.count(), buf.getPriorityCount(), buf.getStandardCount());
          Serial.printf("  Total Flushed  : %u\n", buf.getTotalFlushed());
          Serial.printf("  Total Dropped  : %u\n", buf.getTotalDropped());
          Serial.println("+--------------------------------------------------------------+\n");
        } else {
          Serial.println("[CLI] Node is not running as Gateway; store-and-forward queue is inactive.");
        }
      } else if (strcmp(cmd, "reset") == 0) {
        Serial.println("\n[CLI] Performing factory reset (wiping NVS)...");
        nodeConfigManager.clear();
        delay(300);
        ESP.restart();
      } else if (strcmp(cmd, "reboot") == 0 || strcmp(cmd, "restart") == 0) {
        Serial.println("\n[CLI] Restarting ESP32...");
        delay(100);
        ESP.restart();
      } else {
        Serial.printf("[CLI] Unknown command: '%s'. Type 'help' for available commands.\n", cmd);
      }

      cliIndex = 0;
    } else if (cliIndex < sizeof(cliBuf) - 1) {
      cliBuf[cliIndex++] = c;
    }
  }
}

// ----------------------------------------------------------------------------
// SETUP & INITIALIZATION
// ----------------------------------------------------------------------------
void setup() {
  Serial.begin(115200);

  // On ESP32-S3, Serial runs via native USB CDC which needs time to enumerate.
  // Wait up to 3 seconds for the USB host to connect, or proceed headless.
  uint32_t serialWaitStart = millis();
  while (!Serial && (millis() - serialWaitStart < 3000)) {
    delay(10);
  }
  delay(200);
  printBootDiagnostics();

  // 1. Initialize Dynamic NVS Configuration Subsystem
  nodeConfigManager.begin();
  zoneTracker.begin((nodeConfigManager.getRole() == ROLE_WEARABLE) ? "UNASSIGNED" : nodeConfigManager.getZoneId());
  printDiagnosticBanner();

  // If onboard BOOT button (GPIO 0) is held during startup, force into SoftAP setup mode.
  // Skip if already unprovisioned to prevent reboot loops (user may still be holding button).
  pinMode(PIN_BOOT_BUTTON, INPUT_PULLUP);
  delay(50); // Debounce settle
  if (digitalRead(PIN_BOOT_BUTTON) == LOW && nodeConfigManager.isProvisioned()) {
    Serial.println("\n[SETUP] Onboard BOOT button (GPIO 0) held during startup!");
    Serial.println("[SETUP] Forcing direct entry into SoftAP Setup Mode (Captive Portal)...");
    nodeConfigManager.enterSetupMode();
  }

  // 2. Initialize Hardware Abstraction Layer (MQ-7, MPU6050, Battery ADC)
  sensorHAL.begin();
  if (!DeviceTrust::begin()) {
    Serial.println("[TRUST WARNING] Local enrollment trust missing; remote commands and operational traffic disabled.");
  } else {
    Serial.printf("[TRUST] Local enrollment trust verified. Installation: %s | Hardware: %s\n",
                  DeviceTrust::installation(), nodeConfigManager.getChipId());
  }

  // 3. Operational Mode Dispatch
  if (!nodeConfigManager.meshConfigured()) {
    // MODE: SOFTAP CAPTIVE PORTAL COMMISSIONING
    // Radio is dedicated solely to SoftAP. Mesh is halted to prevent Wi-Fi channel/AP collision!
    Serial.println("\n[MODE] ======================================================================");
    Serial.println("[MODE] >>> NODE UNCOMMISSIONED: Entering SoftAP Setup Mode (Captive Portal) <<<");
    Serial.println("[MODE] Mesh radio paused to guarantee 100% stable SoftAP commissioning.");
    Serial.println("[MODE] ======================================================================");
    captivePortal.begin();
  } else {
    // MODE: PRODUCTION WIRELESS MESH
    Serial.println("\n[MODE] ======================================================================");
    Serial.println("[MODE] >>> NODE COMMISSIONED: Entering Production Mesh Mode <<<");
    Serial.printf(" [MODE] Role: %s | Zone: %s | ID: %s\n",
                  nodeRoleToString(nodeConfigManager.getRole()),
                  (nodeConfigManager.getRole() == ROLE_WEARABLE) ? zoneTracker.getCurrentZone() : nodeConfigManager.getZoneId(),
                  nodeConfigManager.getDeviceId());
    Serial.println("[MODE] ======================================================================");

    // painlessMesh 1.5.7 signature is (ssid, password, scheduler, port,
    // connectMode, channel). Keep the TCP port and radio channel explicit.
    uint8_t meshChannel = nodeConfigManager.getMeshChannel();
    if (meshChannel < 1 || meshChannel > 13) {
      Serial.printf("[MESH CONFIG WARNING] Invalid commissioned channel %u; using default channel %u.\n",
                    meshChannel, MESH_CHANNEL);
      meshChannel = MESH_CHANNEL;
    }
    mesh.setDebugMsgTypes(ERROR | STARTUP);
    mesh.init(nodeConfigManager.getMeshPrefix(),
              nodeConfigManager.getMeshPassword(),
              &userScheduler,
              MESH_PORT,
              WIFI_AP_STA,
              meshChannel);

    // All production nodes expect the Gateway root. This helps a partitioned
    // node continue searching for the path to the configured bridge.
    mesh.setContainsRoot(true);

    mesh.onReceive(&receivedCallback);
    mesh.onNewConnection(&newConnectionCallback);
    mesh.onChangedConnections(&changedConnectionCallback);

    // Register scheduled tasks
    userScheduler.addTask(taskSendProvRequest);
    taskSendProvRequest.enable();
    userScheduler.addTask(taskSendHeartbeat);
    if (nodeConfigManager.getRole() == ROLE_STATIONARY_ANCHOR) {
      taskSendHeartbeat.setInterval(ANCHOR_BEACON_INTERVAL_MS);
    }
    if (nodeConfigManager.isProvisioned()) taskSendHeartbeat.enable();

    // Enable telemetry for WEARABLE tags, or GATEWAY nodes (Desk Testing Mode)
    if (nodeConfigManager.isProvisioned() && (nodeConfigManager.getRole() == ROLE_WEARABLE || nodeConfigManager.getRole() == ROLE_GATEWAY)) {
      userScheduler.addTask(taskSendTelemetry);
      taskSendTelemetry.enable();
    }

    if (nodeConfigManager.getRole() == ROLE_GATEWAY) {
      // Configure the router association through painlessMesh. The library
      // owns station scanning and reconnects, avoiding competing WiFi.begin()
      // calls against the mesh STA interface.
      mesh.setRoot(true);
      WiFi.onEvent(gatewayWiFiEvent);
      mesh.stationManual(nodeConfigManager.getUplinkSsid(),
                         nodeConfigManager.getUplinkPassword());

      gatewayManager.setDownlinkCallback([](const String& downlinkMsg) {
        StaticJsonDocument<2048> command;
        if (!deserializeJson(command, downlinkMsg) && String(command["hardware_id"] | "") == nodeConfigManager.getChipId()) {
          handlePlatformCommand(downlinkMsg, [](const String& response) { gatewayManager.handleIncomingMeshPacket(0, response); });
          return;
        }
        Serial.println("\n**************************************************************");
        Serial.println("[DOWNLINK BROADCAST] Re-broadcasting surface command to mesh!");
        Serial.printf("   |-- Payload: %s\n", downlinkMsg.c_str());
        Serial.println("**************************************************************");
        mesh.sendBroadcast(downlinkMsg);
      });

      gatewayManager.begin(
        nodeConfigManager.getUplinkSsid(),
        nodeConfigManager.getUplinkPassword(),
        nodeConfigManager.getBackendUrl(),
        nodeConfigManager.getBackendApiKey(),
        nodeConfigManager.getDeviceId(),
        meshChannel
      );
    }

    Serial.printf("[INIT] Mesh online. Node ID: %u | TCP port: %u | Radio channel: %u\n",
                  mesh.getNodeId(), MESH_PORT, meshChannel);
  }
}

// ----------------------------------------------------------------------------
// MAIN LOOP
// ----------------------------------------------------------------------------
void loop() {
  uint32_t now = millis();

  // High-rate emergency input processing (debouncing SOS and Acknowledge buttons)
  sensorHAL.updateEmergencyInputs(now);

  // Check physical acknowledge button hold (>= 2000 ms to clear active alarms)
  uint8_t clearedAlarms = sensorHAL.checkAlarmAcknowledge(now);
  if (clearedAlarms != 0) {
    sendLocalAckEvent(clearedAlarms, 2000);
  }

  // Check physical emergency panic button
  if (sensorHAL.checkPanicButton()) {
    sensorHAL.setAlarmIndication(true, SEVERITY_CRITICAL);
    if (!captivePortal.isActive()) {
      sendAlertEvent(SEVERITY_CRITICAL, "PANIC_SOS", "Miner activated emergency panic button", 1.0f);
    }
  }

  static uint32_t lastLocalSample = 0;
  if ((captivePortal.isActive() || !nodeConfigManager.isProvisioned()) && now - lastLocalSample >= TELEMETRY_INTERVAL_MS) {
    lastLocalSample = now;
    sendTelemetryTask(); // Local sensing and alarm decisions precede transport guards.
  }

  // Drives dynamic subterranean zone tracking (Option 1: Anchor Proximity)
  zoneTracker.update();

  // Immediate movement event check (emits boundary crossing updates promptly)
  if (nodeConfigManager.getRole() == ROLE_WEARABLE && zoneTracker.consumeMovementEvent()) {
    Serial.println("\n[ZONE TRACKER] Boundary crossing detected! Emitting immediate telemetry...");
    sendTelemetryTask();
  }

  // Option 3: Handle captive portal client requests if setup AP is active
  if (captivePortal.isActive()) {
    captivePortal.update();
  } else {
    // Drives mesh packet routing & scheduler
    mesh.update();
    radioDiagnosticsUpdate(mesh.getNodeId(), nodeConfigManager.getDeviceId());

    if (nodeConfigManager.getRole() == ROLE_GATEWAY) {
      gatewayManager.update();
    }
  }

  // Non-blocking Serial CLI Command Parser
  handleSerialCLI();

  // SoftAP Configuration Trigger: Hold onboard BOOT button (GPIO 0) >= 3s
  if (digitalRead(PIN_BOOT_BUTTON) == LOW) {
    if (g_bootButtonHoldStartTime == 0) {
      g_bootButtonHoldStartTime = millis();
    } else if (millis() - g_bootButtonHoldStartTime >= 3000 && !g_bootSetupArmed) {
      g_bootSetupArmed = true;
      Serial.println("\n==============================================================");
      Serial.println("[SETUP] Onboard BOOT button (GPIO 0) held for 3 seconds!");
      Serial.println("[SETUP] Release button now... rebooting into SoftAP Setup Mode.");
      Serial.println("==============================================================");
      Serial.flush();
      // Audible and visual indication
      for (int i = 0; i < 4; i++) {
        digitalWrite(PIN_STATUS_LED, HIGH);
        digitalWrite(PIN_BUZZER, HIGH);
        delay(70);
        digitalWrite(PIN_STATUS_LED, LOW);
        digitalWrite(PIN_BUZZER, LOW);
        delay(70);
      }
      nodeConfigManager.enterSetupMode();

      // Wait for user to physically release the BOOT button before restarting
      Serial.println("[SETUP] Waiting for BOOT button release...");
      Serial.flush();
      while (digitalRead(PIN_BOOT_BUTTON) == LOW) {
        delay(50);
      }
      delay(300); // Extra debounce after release
      Serial.println("[SETUP] BOOT button released. Restarting now...");
      Serial.flush();
      delay(200);
      ESP.restart();
    }
  } else {
    g_bootButtonHoldStartTime = 0;
  }
}
