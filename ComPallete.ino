#include "painlessMesh.h"
#include <ArduinoJson.h>

#define MESH_PREFIX "MineMesh_Zambia"
#define MESH_PASSWORD "SecureMine123"
#define MESH_PORT 5555

// --- NODE CONFIGURATION ---
// Set to TRUE for fixed infrastructure nodes, FALSE for wearable tags
const bool NODE_IS_STATIONARY = true;
const String MINER_ID = "MINER-106";  // Only used if mobile (wearable)

painlessMesh mesh;
Scheduler userScheduler;

// Track the total number of nodes to help spot network drops/joins
int lastNodeCount = 0;

void sendDataTask();
Task taskSendData(5000, TASK_FOREVER, &sendDataTask);

// --- NETWORK EVENT MONITORING CALLBACKS ---

// 1. EVENT: Triggered when a new device physically joins your tunnel mesh
void newConnectionCallback(uint32_t nodeId) {
  Serial.println("\n==============================================");
  Serial.printf("[ALERT] New device has JOINED the mesh network!\n");
  Serial.printf("--> Connected Node ID: %u\n", nodeId);
  Serial.println("==============================================");
}

// 2. EVENT: Triggered whenever a device roams, switches links, or disconnects
void changedConnectionCallback() {
  SimpleList<uint32_t> nodeList = mesh.getNodeList();
  int currentNodeCount = nodeList.size();

  Serial.println("\n----------------------------------------------");
  Serial.println("[NETWORK UPDATE] Mesh layout/topology changed!");
  Serial.printf("--> Total active nodes in tunnel network: %d\n", currentNodeCount + 1);  // +1 includes this node

  // Detect structural changes
  if (currentNodeCount < lastNodeCount) {
    Serial.println("[ALERT] A node has DISCONNECTED or dropped out of range!");
  } else if (currentNodeCount > lastNodeCount) {
    Serial.println("[INFO] Mesh layout expanded with a new link.");
  } else {
    Serial.println("[ROAMING] A wearable node just re-routed its path to a different node.");
  }

  // Print a live directory of all active Node IDs detected underground
  Serial.print("--> Active Node Directory: ");
  SimpleList<uint32_t>::iterator node = nodeList.begin();
  while (node != nodeList.end()) {
    Serial.printf("[%u] ", *node);
    node++;
  }
  Serial.println("\n----------------------------------------------");

  lastNodeCount = currentNodeCount;
}

// 3. EVENT: Triggered when data packets arrive from the network
void receivedCallback(uint32_t from, String &msg) {
  StaticJsonDocument<256> doc;
  DeserializationError error = deserializeJson(doc, msg);

  if (!error) {
    String miner = doc["miner_id"].as<String>();
    float co = doc["co"].as<float>();
    bool fall = doc["fall"].as<bool>();

    Serial.printf("\n[DATA PACKET] Received from Node ID: %u\n", from);
    Serial.printf("   |-- Personnel ID: %s\n", miner.c_str());
    Serial.printf("   |-- Gas Monitor : Carbon Monoxide: %.1f ppm\n", co);
    Serial.printf("   |-- Fall Sensor : %s\n", fall ? "!! ALERT: MAN DOWN DETECTED !!" : "Status OK");
    Serial.println("----------------------------------------------");
  } else {
    Serial.printf("Failed to parse incoming JSON from %u\n", from);
  }
}

// --- TELEMETRY BROADCAST TASK ---
void sendDataTask() {
  if (NODE_IS_STATIONARY) {
    // Stationary backbone nodes focus on routing and maintaining mesh infrastructure
    return;
  }

  // Generate simulated sensor payloads for the wearable tag
  StaticJsonDocument<256> doc;
  doc["miner_id"] = MINER_ID;
  doc["co"] = random(10, 30);           // Simulated CO levels
  doc["fall"] = (random(0, 100) > 97);  // 3% chance to simulate a fall

  String meshPacket;
  serializeJson(doc, meshPacket);

  // Broadcast across the ad-hoc mesh
  mesh.sendBroadcast(meshPacket);
  Serial.println("\n[TX] Broadcasted telemetry packet up the mesh: " + meshPacket);
}

// --- SETUP & INITIALIZATION ---
void setup() {
  Serial.begin(115200);
  delay(1000);

  Serial.println("\n==============================================");
  Serial.println("  STARTING SUBTERRANEAN MESH MONITORING NODE  ");
  Serial.println("==============================================");

  // Initialize network configuration
  mesh.setDebugMsgTypes(ERROR | STARTUP);
  mesh.init(MESH_PREFIX, MESH_PASSWORD, &userScheduler, MESH_PORT);

  // Bind core mesh event triggers
  mesh.onReceive(&receivedCallback);
  mesh.onNewConnection(&newConnectionCallback);
  mesh.onChangedConnections(&changedConnectionCallback);

  // Configure tasks
  userScheduler.addTask(taskSendData);
  taskSendData.enable();

  Serial.printf("[INIT] Node online. Unique Chip Mesh ID: %u\n", mesh.getNodeId());
  if (NODE_IS_STATIONARY) {
    Serial.println("[ROLE] Configured as: STATIONARY BACKBONE NODE");
  } else {
    Serial.printf("[ROLE] Configured as: WEARABLE TRACKING TAG (%s)\n", MINER_ID.c_str());
  }
  Serial.println("==============================================\n");
}

void loop() {
  // Keeps the background mesh processes active and routing packets
  mesh.update();
}