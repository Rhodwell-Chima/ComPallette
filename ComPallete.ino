#include "painlessMesh.h"
#include <ArduinoJson.h>
#include "Config.h"
#include "Protocol.h"

// ============================================================================
// COMPALLETTE - SUBTERRANEAN MESH MONITORING NODE FIRMWARE
// ============================================================================

// --- GLOBAL INSTANCES ---
painlessMesh mesh;
Scheduler userScheduler;

// Backward-compatibility alias for legacy code references
const bool NODE_IS_STATIONARY = (CURRENT_ROLE != ROLE_WEARABLE);
const String MINER_ID = ACTIVE_DEVICE_ID;

// Monotonic sequence counter for packets emitted by this node
static uint32_t g_messageSequence = 0;

// Track mesh network topology
int lastNodeCount = 0;

// Task declarations
void sendTelemetryTask();
void sendHeartbeatTask();

Task taskSendTelemetry(TELEMETRY_INTERVAL_MS, TASK_FOREVER, &sendTelemetryTask);
Task taskSendHeartbeat(HEARTBEAT_INTERVAL_MS, TASK_FOREVER, &sendHeartbeatTask);

// ----------------------------------------------------------------------------
// IMMEDIATE ALERT DISPATCHER (Event-Driven)
// ----------------------------------------------------------------------------
// Bypasses regular telemetry timer to instantly dispatch critical alerts.
void sendAlertEvent(AlertSeverity severity, const char* code, const char* details, float triggerVal) {
  MessageEnvelope env;
  env.version = PROTOCOL_VERSION;
  env.msg_type = MSG_ALERT;
  env.seq = ++g_messageSequence;
  strncpy(env.sender_id, ACTIVE_DEVICE_ID, sizeof(env.sender_id) - 1);
  strncpy(env.role, nodeRoleToString(CURRENT_ROLE), sizeof(env.role) - 1);
  strncpy(env.zone_id, ACTIVE_ZONE_ID, sizeof(env.zone_id) - 1);
  env.uptime_ms = millis();

  AlertData alert;
  alert.severity = severity;
  strncpy(alert.alert_code, code, sizeof(alert.alert_code) - 1);
  strncpy(alert.details, details, sizeof(alert.details) - 1);
  alert.trigger_value = triggerVal;

  String packet;
  if (serializeAlert(env, alert, packet)) {
    // For critical alerts, burst retransmit to maximize probability of arrival
    int burstCount = (severity == SEVERITY_CRITICAL) ? ALERT_BURST_COUNT : 1;
    for (int i = 0; i < burstCount; i++) {
      mesh.sendBroadcast(packet);
      if (i < burstCount - 1) {
        delay(20); // Small backoff between burst packets
      }
    }

    Serial.println("\n**************************************************************");
    Serial.printf("[ALERT TX] Dispatched %s emergency event!\n", alertSeverityToString(severity));
    Serial.printf("   |-- Code    : %s\n", alert.alert_code);
    Serial.printf("   |-- Value   : %.2f\n", alert.trigger_value);
    Serial.printf("   |-- Details : %s\n", alert.details);
    Serial.printf("   |-- Raw JSON: %s\n", packet.c_str());
    Serial.println("**************************************************************");
  }
}

// ----------------------------------------------------------------------------
// NETWORK EVENT CALLBACKS
// ----------------------------------------------------------------------------

// 1. EVENT: New physical device joins the tunnel mesh
void newConnectionCallback(uint32_t nodeId) {
  Serial.println("\n==============================================");
  Serial.printf("[ALERT] New device has JOINED the mesh network!\n");
  Serial.printf("--> Connected Node ID: %u\n", nodeId);
  Serial.println("==============================================");
}

// 2. EVENT: Mesh topology / routing table changes
void changedConnectionCallback() {
  SimpleList<uint32_t> nodeList = mesh.getNodeList();
  int currentNodeCount = nodeList.size();

  Serial.println("\n----------------------------------------------");
  Serial.println("[NETWORK UPDATE] Mesh layout/topology changed!");
  Serial.printf("--> Total active nodes in tunnel network: %d\n", currentNodeCount + 1);

  if (currentNodeCount < lastNodeCount) {
    Serial.println("[ALERT] A node has DISCONNECTED or dropped out of range!");
  } else if (currentNodeCount > lastNodeCount) {
    Serial.println("[INFO] Mesh layout expanded with a new link.");
  } else {
    Serial.println("[ROAMING] A wearable node just re-routed its path.");
  }

  Serial.print("--> Active Node Directory: ");
  SimpleList<uint32_t>::iterator node = nodeList.begin();
  while (node != nodeList.end()) {
    Serial.printf("[%u] ", *node);
    node++;
  }
  Serial.println("\n----------------------------------------------");

  lastNodeCount = currentNodeCount;
}

// 3. EVENT: Incoming packet received from mesh
void receivedCallback(uint32_t from, String &msg) {
  MessageEnvelope env;
  TelemetryData telem;
  AlertData alert;
  HeartbeatData hb;
  bool isLegacy = false;

  bool ok = deserializePacket(msg, env, telem, alert, hb, isLegacy);
  if (!ok) {
    Serial.printf("\n[ERROR] Malformed or unparseable packet from Node %u: %s\n", from, msg.c_str());
    return;
  }

  // Handle Legacy format packets
  if (isLegacy) {
    Serial.println("\n[DATA PACKET - LEGACY FORMAT]");
    Serial.printf("   |-- Origin Node ID : %u\n", from);
    Serial.printf("   |-- Personnel ID   : %s\n", env.sender_id);
    Serial.printf("   |-- Gas Monitor    : CO %.1f ppm (Simulated: YES)\n", telem.co_ppm);
    Serial.printf("   |-- Fall Sensor    : %s\n", telem.fall_detected ? "!! ALERT: MAN DOWN !!" : "OK");
    Serial.println("----------------------------------------------");
    return;
  }

  // Handle Standard v1 protocol packets
  switch (env.msg_type) {
    case MSG_TELEMETRY:
      Serial.printf("\n[TELEMETRY v%u | Seq #%u] From: %s (%s) @ Node: %u\n",
                    env.version, env.seq, env.sender_id, env.role, from);
      Serial.printf("   |-- Last Known Zone : %s\n", env.zone_id[0] ? env.zone_id : "N/A");
      Serial.printf("   |-- CO Gas Level    : %.1f ppm %s\n",
                    telem.co_ppm,
                    telem.co_ppm >= CO_THRESHOLD_CRITICAL_PPM ? "[CRITICAL!]" :
                    telem.co_ppm >= CO_THRESHOLD_WARNING_PPM ? "[WARNING]" : "[NORMAL]");
      Serial.printf("   |-- Ambient Climate : %.1f °C | %.1f%% RH\n", telem.temp_c, telem.humidity_pct);
      Serial.printf("   |-- Fall Status     : %s\n", telem.fall_detected ? "!! MAN DOWN DETECTED !!" : "Normal");
      Serial.printf("   |-- Battery Voltage : %.2f V\n", telem.battery_v);
      Serial.printf("   |-- Sensor Health   : %s (Data source: %s)\n",
                    telem.sensor_ok ? "HEALTHY" : "FAULT",
                    telem.is_simulated ? "SIMULATED" : "HARDWARE");
      Serial.printf("   |-- Node Uptime     : %u s\n", env.uptime_ms / 1000);
      Serial.println("----------------------------------------------");
      break;

    case MSG_ALERT:
      Serial.println("\n**************************************************************");
      Serial.printf(" [EMERGENCY ALERT] Severity: %s\n", alertSeverityToString(alert.severity));
      Serial.printf("   |-- Origin Device   : %s (Role: %s, Node ID: %u)\n", env.sender_id, env.role, from);
      Serial.printf("   |-- Reported Zone   : %s\n", env.zone_id[0] ? env.zone_id : "UNKNOWN");
      Serial.printf("   |-- Alert Code      : %s\n", alert.alert_code);
      Serial.printf("   |-- Trigger Value   : %.2f\n", alert.trigger_value);
      Serial.printf("   |-- Details         : %s\n", alert.details);
      Serial.printf("   |-- Message Seq #   : %u\n", env.seq);
      Serial.println("**************************************************************");
      break;

    case MSG_HEARTBEAT:
      Serial.printf("\n[HEARTBEAT] Node: %s (%s) | Free Heap: %u bytes | Visible Peers: %d | Batt: %.2f V\n",
                    env.sender_id, env.role, hb.free_heap, hb.mesh_node_count, hb.battery_v);
      break;

    default:
      Serial.printf("\n[PACKET] Received unsupported message type: %s\n", messageTypeToString(env.msg_type));
      break;
  }
}

// ----------------------------------------------------------------------------
// SCHEDULED TASKS
// ----------------------------------------------------------------------------

// Regular Telemetry Broadcast Task (runs on wearable tags)
void sendTelemetryTask() {
  if (CURRENT_ROLE != ROLE_WEARABLE) {
    // Stationary infrastructure and gateway nodes route packets; they do not emit miner telemetry
    return;
  }

  MessageEnvelope env;
  env.version = PROTOCOL_VERSION;
  env.msg_type = MSG_TELEMETRY;
  env.seq = ++g_messageSequence;
  strncpy(env.sender_id, ACTIVE_DEVICE_ID, sizeof(env.sender_id) - 1);
  strncpy(env.role, nodeRoleToString(CURRENT_ROLE), sizeof(env.role) - 1);
  strncpy(env.zone_id, ACTIVE_ZONE_ID, sizeof(env.zone_id) - 1);
  env.uptime_ms = millis();

  TelemetryData data;
  if (SIMULATE_SENSORS) {
    // Simulated sensor readings with probabilistic hazard events
    data.co_ppm = (float)random(100, 320) / 10.0f; // 10.0 to 32.0 ppm
    data.temp_c = 26.0f + (float)random(0, 80) / 10.0f; // 26.0 to 34.0 °C
    data.humidity_pct = 70.0f + (float)random(0, 250) / 10.0f; // 70% to 95%
    data.fall_detected = (random(0, 100) > 97); // 3% random fall trigger
    data.battery_v = 3.85f - ((float)(millis() % 3600000) / 3600000.0f) * 0.2f;
    data.is_simulated = true;
    data.sensor_ok = true;
  } else {
    // Reserved for physical hardware sensor sampling in Phase 5
    data.co_ppm = 0.0f;
    data.temp_c = 0.0f;
    data.humidity_pct = 0.0f;
    data.fall_detected = false;
    data.battery_v = 3.7f;
    data.is_simulated = false;
    data.sensor_ok = false;
  }

  // Check for immediate emergency threshold breaches
  if (data.fall_detected) {
    sendAlertEvent(SEVERITY_CRITICAL, "MAN_DOWN", "Miner fall detected via accelerometer", 1.0f);
  }
  if (data.co_ppm >= CO_THRESHOLD_CRITICAL_PPM) {
    sendAlertEvent(SEVERITY_CRITICAL, "GAS_CO_CRITICAL", "Dangerous CO concentration detected", data.co_ppm);
  } else if (data.co_ppm >= CO_THRESHOLD_WARNING_PPM) {
    sendAlertEvent(SEVERITY_WARNING, "GAS_CO_HIGH", "CO concentration exceeded warning limit", data.co_ppm);
  }

  String packet;
  if (serializeTelemetry(env, data, packet)) {
    mesh.sendBroadcast(packet);
    Serial.printf("\n[TX TELEMETRY #%u] %s\n", env.seq, packet.c_str());
  }
}

// Keep-Alive & Health Heartbeat Task (runs on all active nodes)
void sendHeartbeatTask() {
  MessageEnvelope env;
  env.version = PROTOCOL_VERSION;
  env.msg_type = MSG_HEARTBEAT;
  env.seq = ++g_messageSequence;
  strncpy(env.sender_id, ACTIVE_DEVICE_ID, sizeof(env.sender_id) - 1);
  strncpy(env.role, nodeRoleToString(CURRENT_ROLE), sizeof(env.role) - 1);
  strncpy(env.zone_id, ACTIVE_ZONE_ID, sizeof(env.zone_id) - 1);
  env.uptime_ms = millis();

  HeartbeatData hb;
  hb.free_heap = ESP.getFreeHeap();
  hb.mesh_node_count = mesh.getNodeList().size();
  hb.battery_v = 3.80f;

  String packet;
  if (serializeHeartbeat(env, hb, packet)) {
    mesh.sendBroadcast(packet);
    Serial.printf("\n[TX HEARTBEAT #%u] Free Heap: %u B | Mesh Peers: %d\n",
                  env.seq, hb.free_heap, hb.mesh_node_count);
  }
}

// ----------------------------------------------------------------------------
// SETUP & INITIALIZATION
// ----------------------------------------------------------------------------
void setup() {
  Serial.begin(115200);
  delay(1000);

  Serial.println("\n==============================================================");
  Serial.println("         COMPALLETTE - UNDERGROUND MESH SAFETY NODE           ");
  Serial.printf("  Firmware Version : 1.0.0 (Protocol v%u)\n", PROTOCOL_VERSION);
  Serial.printf("  Device ID        : %s\n", ACTIVE_DEVICE_ID);
  Serial.printf("  Assigned Role    : %s\n", nodeRoleToString(CURRENT_ROLE));
  Serial.printf("  Tunnel Zone      : %s\n", ACTIVE_ZONE_ID);
  Serial.printf("  Data Mode        : %s\n", SIMULATE_SENSORS ? "SYNTHETIC SIMULATION" : "PHYSICAL HARDWARE");
  Serial.println("==============================================================");

  // Initialize painlessMesh
  mesh.setDebugMsgTypes(ERROR | STARTUP);
  mesh.init(MESH_PREFIX, MESH_PASSWORD, &userScheduler, MESH_PORT);

  // Bind mesh event triggers
  mesh.onReceive(&receivedCallback);
  mesh.onNewConnection(&newConnectionCallback);
  mesh.onChangedConnections(&changedConnectionCallback);

  // Register scheduled tasks
  userScheduler.addTask(taskSendHeartbeat);
  taskSendHeartbeat.enable();

  if (CURRENT_ROLE == ROLE_WEARABLE) {
    userScheduler.addTask(taskSendTelemetry);
    taskSendTelemetry.enable();
  }

  Serial.printf("[INIT] Mesh online. Unique Chip Mesh ID: %u\n", mesh.getNodeId());
  Serial.println("==============================================================\n");
}

// ----------------------------------------------------------------------------
// MAIN LOOP
// ----------------------------------------------------------------------------
void loop() {
  // Drives mesh packet routing, heartbeat timers, and task scheduling
  mesh.update();
}
