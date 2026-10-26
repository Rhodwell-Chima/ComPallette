#include "painlessMesh.h"
#include <ArduinoJson.h>
#include "Config.h"
#include "Protocol.h"
#include "GatewayManager.h"
#include "SensorHAL.h"
#include "NodeConfigManager.h"
#include "CaptivePortalManager.h"

// ============================================================================
// COMPALLETTE - SUBTERRANEAN MESH MONITORING NODE FIRMWARE (Dynamic Provisioning)
// ============================================================================

// --- GLOBAL INSTANCES ---
painlessMesh mesh;
Scheduler userScheduler;

#if (CURRENT_ROLE == ROLE_GATEWAY)
GatewayManager gatewayManager;
#endif

// Monotonic sequence counter for packets emitted by this node
static uint32_t g_messageSequence = 0;

// Track mesh network topology
int lastNodeCount = 0;

// Factory reset button tracking (hold SOS button >= 6s to erase NVS and enter Setup)
static uint32_t g_buttonHoldStartTime = 0;
static bool     g_resetArmed = false;

// Task declarations
void sendTelemetryTask();
void sendHeartbeatTask();
void sendProvRequestTask();

Task taskSendTelemetry(TELEMETRY_INTERVAL_MS, TASK_FOREVER, &sendTelemetryTask);
Task taskSendHeartbeat(HEARTBEAT_INTERVAL_MS, TASK_FOREVER, &sendHeartbeatTask);
Task taskSendProvRequest(8000, TASK_FOREVER, &sendProvRequestTask);

// ----------------------------------------------------------------------------
// IMMEDIATE ALERT DISPATCHER (Event-Driven)
// ----------------------------------------------------------------------------
void sendAlertEvent(AlertSeverity severity, const char* code, const char* details, float triggerVal) {
  MessageEnvelope env;
  env.version = PROTOCOL_VERSION;
  env.msg_type = MSG_ALERT;
  env.seq = ++g_messageSequence;
  strncpy(env.sender_id, nodeConfigManager.getDeviceId(), sizeof(env.sender_id) - 1);
  strncpy(env.role, nodeRoleToString(nodeConfigManager.getRole()), sizeof(env.role) - 1);
  strncpy(env.zone_id, nodeConfigManager.getZoneId(), sizeof(env.zone_id) - 1);
  env.uptime_ms = millis();

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

    Serial.println("\n**************************************************************");
    Serial.printf("[ALERT TX] Dispatched %s emergency event!\n", alertSeverityToString(severity));
    Serial.printf("   |-- Origin  : %s (%s) @ %s\n", env.sender_id, env.role, env.zone_id);
    Serial.printf("   |-- Code    : %s\n", alert.alert_code);
    Serial.printf("   |-- Value   : %.2f\n", alert.trigger_value);
    Serial.printf("   |-- Details : %s\n", alert.details);
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
  } else if (currentNodeCount > lastNodeCount) {
    Serial.println("[INFO] Mesh layout expanded with a new link.");
  }

  lastNodeCount = currentNodeCount;
}

void receivedCallback(uint32_t from, String &msg) {
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

#if (CURRENT_ROLE == ROLE_GATEWAY)
  // If operating as gateway bridge, forward packet to upstream backend
  gatewayManager.handleIncomingMeshPacket(from, msg);
#endif

  // Handle Option 1: Downlink Provisioning Assignment from Gateway
  if (env.msg_type == MSG_PROV_ASSIGN) {
    ProvisioningAssignData assign;
    if (deserializeProvAssign(msg, assign)) {
      if (strcmp(assign.target_chip, nodeConfigManager.getChipId()) == 0) {
        Serial.println("\n==============================================================");
        Serial.printf("[PROV] OTA Mesh Assignment Received for Chip #%s!\n", assign.target_chip);
        Serial.printf("  |-- Assigned ID  : %s\n", assign.assigned_id);
        Serial.printf("  |-- Target Role  : %s\n", assign.role);
        Serial.printf("  |-- Target Zone  : %s\n", assign.zone_id);
        Serial.println("==============================================================");

        NodeRole r = (strcmp(assign.role, "GATEWAY") == 0) ? ROLE_GATEWAY :
                     (strcmp(assign.role, "ANCHOR") == 0) ? ROLE_STATIONARY_ANCHOR : ROLE_WEARABLE;

        nodeConfigManager.setAssignment(assign.assigned_id, r, assign.zone_id, assign.co_warn, assign.co_crit);

        // Stop captive portal since node is now successfully provisioned
        captivePortal.stop();

        // Transmit confirmation back across mesh
        MessageEnvelope confEnv;
        confEnv.version = PROTOCOL_VERSION;
        confEnv.msg_type = MSG_PROV_CONFIRM;
        confEnv.seq = ++g_messageSequence;
        strncpy(confEnv.sender_id, assign.assigned_id, sizeof(confEnv.sender_id) - 1);
        strncpy(confEnv.role, assign.role, sizeof(confEnv.role) - 1);
        strncpy(confEnv.zone_id, assign.zone_id, sizeof(confEnv.zone_id) - 1);
        confEnv.uptime_ms = millis();

        ProvisioningConfirmData conf;
        strncpy(conf.chip_id, assign.target_chip, sizeof(conf.chip_id) - 1);
        strncpy(conf.status, "SUCCESS_COMMISSIONED", sizeof(conf.status) - 1);

        String confPkt;
        if (serializeProvConfirm(confEnv, conf, confPkt)) {
          mesh.sendBroadcast(confPkt);
        }

        if (assign.reboot_now) {
          Serial.println("[PROV] Rebooting node in 1 second to enter production mode...");
          delay(1000);
          ESP.restart();
        }
      }
    }
    return;
  }

  // Handle Standard v1 protocol packets
  switch (env.msg_type) {
    case MSG_TELEMETRY:
      Serial.printf("\n[TELEMETRY v%u | Seq #%u] %s (%s) @ %s | CO: %.1f ppm | Batt: %.2f V\n",
                    env.version, env.seq, env.sender_id, env.role, env.zone_id, telem.co_ppm, telem.battery_v);
      break;

    case MSG_ALERT:
      Serial.println("\n**************************************************************");
      Serial.printf(" [EMERGENCY ALERT] Severity: %s | Origin: %s @ %s\n",
                    alertSeverityToString(alert.severity), env.sender_id, env.zone_id);
      Serial.printf("   |-- Code    : %s\n", alert.alert_code);
      Serial.printf("   |-- Details : %s\n", alert.details);
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

// Periodic Telemetry Task (runs on wearable miner tags)
void sendTelemetryTask() {
  if (nodeConfigManager.getRole() != ROLE_WEARABLE) {
    return;
  }

  MessageEnvelope env;
  env.version = PROTOCOL_VERSION;
  env.msg_type = MSG_TELEMETRY;
  env.seq = ++g_messageSequence;
  strncpy(env.sender_id, nodeConfigManager.getDeviceId(), sizeof(env.sender_id) - 1);
  strncpy(env.role, nodeRoleToString(nodeConfigManager.getRole()), sizeof(env.role) - 1);
  strncpy(env.zone_id, nodeConfigManager.getZoneId(), sizeof(env.zone_id) - 1);
  env.uptime_ms = millis();

  SensorReadings readings = sensorHAL.read();

  TelemetryData data;
  data.co_ppm = readings.co_ppm;
  data.temp_c = readings.temp_c;
  data.humidity_pct = readings.humidity_pct;
  data.fall_detected = readings.fall_detected;
  data.battery_v = readings.battery_v;
  data.is_simulated = readings.is_simulated;
  data.sensor_ok = readings.sensor_ok;

  // Emergency panic button
  if (readings.panic_pressed) {
    sensorHAL.setAlarmIndication(true, SEVERITY_CRITICAL);
    sendAlertEvent(SEVERITY_CRITICAL, "PANIC_SOS", "Miner triggered physical SOS panic button", 1.0f);
  }

  // Threshold alerts
  if (data.fall_detected) {
    sensorHAL.setAlarmIndication(true, SEVERITY_CRITICAL);
    sendAlertEvent(SEVERITY_CRITICAL, "MAN_DOWN", "Miner fall confirmed via IMU (impact + inactivity)", readings.accel_magnitude);
  }
  if (data.co_ppm >= nodeConfigManager.get().co_critical_ppm) {
    sensorHAL.setAlarmIndication(true, SEVERITY_CRITICAL);
    sendAlertEvent(SEVERITY_CRITICAL, "GAS_CO_CRITICAL", "Dangerous CO concentration detected", data.co_ppm);
  } else if (data.co_ppm >= nodeConfigManager.get().co_warning_ppm) {
    sensorHAL.setAlarmIndication(true, SEVERITY_WARNING);
    sendAlertEvent(SEVERITY_WARNING, "GAS_CO_HIGH", "CO concentration exceeded warning limit", data.co_ppm);
  } else if (!data.fall_detected && !readings.panic_pressed) {
    sensorHAL.setAlarmIndication(false);
  }

  String packet;
  if (serializeTelemetry(env, data, packet)) {
    mesh.sendBroadcast(packet);
    Serial.printf("\n[TX TELEMETRY #%u] %s\n", env.seq, packet.c_str());
  }
}

// Keep-Alive Heartbeat Task
void sendHeartbeatTask() {
  MessageEnvelope env;
  env.version = PROTOCOL_VERSION;
  env.msg_type = MSG_HEARTBEAT;
  env.seq = ++g_messageSequence;
  strncpy(env.sender_id, nodeConfigManager.getDeviceId(), sizeof(env.sender_id) - 1);
  strncpy(env.role, nodeRoleToString(nodeConfigManager.getRole()), sizeof(env.role) - 1);
  strncpy(env.zone_id, nodeConfigManager.getZoneId(), sizeof(env.zone_id) - 1);
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
  }
}

// Provisioning Request Announcement Task (Option 1: runs on unprovisioned nodes)
void sendProvRequestTask() {
  if (nodeConfigManager.isProvisioned()) {
    taskSendProvRequest.disable();
    return;
  }

  MessageEnvelope env;
  env.version = PROTOCOL_VERSION;
  env.msg_type = MSG_PROV_REQ;
  env.seq = ++g_messageSequence;
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
  req.mq_healthy = s.mq_healthy;
  req.mpu_healthy = s.mpu_healthy;

  String packet;
  if (serializeProvRequest(env, req, packet)) {
    mesh.sendBroadcast(packet);
    Serial.printf("\n[PROV TX BEACON] Emitted enrollment announcement for Chip #%s over mesh\n", req.chip_id);
  }
}

// ----------------------------------------------------------------------------
// SETUP & INITIALIZATION
// ----------------------------------------------------------------------------
void setup() {
  Serial.begin(115200);
  delay(1000);

  // 1. Initialize Dynamic NVS Configuration Subsystem
  nodeConfigManager.begin();

  // 2. Initialize Hardware Abstraction Layer (MQ-7, MPU6050, Battery ADC)
  sensorHAL.begin();

  // 3. Option 3: If node is uncommissioned, launch local Wi-Fi Captive Portal
  if (!nodeConfigManager.isProvisioned()) {
    captivePortal.begin();
  }

  // 4. Initialize Mesh Network using dynamic credentials from NVS
  mesh.setDebugMsgTypes(ERROR | STARTUP);
  mesh.init(nodeConfigManager.getMeshPrefix(),
            nodeConfigManager.getMeshPassword(),
            &userScheduler,
            nodeConfigManager.getMeshChannel());

  mesh.onReceive(&receivedCallback);
  mesh.onNewConnection(&newConnectionCallback);
  mesh.onChangedConnections(&changedConnectionCallback);

  // 5. Register scheduled tasks
  userScheduler.addTask(taskSendHeartbeat);
  taskSendHeartbeat.enable();

  if (nodeConfigManager.isProvisioned()) {
    if (nodeConfigManager.getRole() == ROLE_WEARABLE) {
      userScheduler.addTask(taskSendTelemetry);
      taskSendTelemetry.enable();
    }
  } else {
    // Option 1: Uncommissioned nodes periodically request dynamic enrollment
    userScheduler.addTask(taskSendProvRequest);
    taskSendProvRequest.enable();
  }

#if (CURRENT_ROLE == ROLE_GATEWAY)
  gatewayManager.begin();
#endif

  Serial.printf("[INIT] Mesh online. Chip Mesh Node ID: %u\n", mesh.getNodeId());
}

// ----------------------------------------------------------------------------
// MAIN LOOP
// ----------------------------------------------------------------------------
void loop() {
  // Drives mesh packet routing & scheduler
  mesh.update();

  // Option 3: Handle captive portal client requests if setup AP is active
  if (captivePortal.isActive()) {
    captivePortal.update();
  }

  // Check physical emergency panic button
  if (sensorHAL.checkPanicButton()) {
    sensorHAL.setAlarmIndication(true, SEVERITY_CRITICAL);
    sendAlertEvent(SEVERITY_CRITICAL, "PANIC_SOS", "Miner activated emergency panic button", 1.0f);
  }

  // Hardware Safety Override: Long-press SOS button (>= 6s) triggers Factory Reset
  if (digitalRead(PIN_SOS_BUTTON) == LOW) {
    if (g_buttonHoldStartTime == 0) {
      g_buttonHoldStartTime = millis();
    } else if (millis() - g_buttonHoldStartTime >= 6000 && !g_resetArmed) {
      g_resetArmed = true;
      Serial.println("\n[HAL] FACTORY RESET TRIGGERED! Wiping NVS configuration...");
      // Strobe LED and buzzer to warn operator
      for (int i = 0; i < 5; i++) {
        digitalWrite(PIN_STATUS_LED, HIGH);
        digitalWrite(PIN_BUZZER, HIGH);
        delay(80);
        digitalWrite(PIN_STATUS_LED, LOW);
        digitalWrite(PIN_BUZZER, LOW);
        delay(80);
      }
      nodeConfigManager.clear();
      delay(500);
      ESP.restart();
    }
  } else {
    g_buttonHoldStartTime = 0;
  }

#if (CURRENT_ROLE == ROLE_GATEWAY)
  gatewayManager.update();
#endif
}
