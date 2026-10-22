#include "GatewayManager.h"

GatewayManager::GatewayManager()
  : m_ssid(UPLINK_WIFI_SSID),
    m_password(UPLINK_WIFI_PASSWORD),
    m_backendUrl(BACKEND_BASE_URL),
    m_apiKey(BACKEND_API_KEY),
    m_state(GW_STATE_DISCONNECTED),
    m_lastStateCheckMs(0),
    m_lastTransmitMs(0),
    m_backoffStartMs(0),
    m_currentBackoffMs(GW_RECONNECT_MIN_MS),
    m_consecutiveFailures(0) {}

GatewayManager::~GatewayManager() {}

bool GatewayManager::begin(
  const char* ssid,
  const char* password,
  const char* backendUrl,
  const char* apiKey
) {
  m_ssid = ssid;
  m_password = password;
  m_backendUrl = backendUrl;
  m_apiKey = apiKey;

  Serial.println("\n==============================================================");
  Serial.println("         COMPALLETTE - GATEWAY BRIDGE INITIALIZATION          ");
  Serial.printf("  Target Uplink SSID : %s\n", m_ssid);
  Serial.printf("  Backend URL        : %s\n", m_backendUrl.c_str());
  Serial.printf("  Gateway ID         : %s\n", ACTIVE_DEVICE_ID);
  Serial.println("==============================================================");

  // Initialize offline buffer (mounts LittleFS or falls back to RAM)
  m_buffer.begin(BUFFER_MAX_RAM_ITEMS, BUFFER_MAX_FLASH_ITEMS);

  // Start Wi-Fi station connection while preserving painlessMesh Wi-Fi AP
  WiFi.begin(m_ssid, m_password);
  m_state = GW_STATE_CONNECTING;
  m_lastStateCheckMs = millis();

  return true;
}

const char* GatewayManager::getStateString() const {
  switch (m_state) {
    case GW_STATE_CONNECTED:    return "CONNECTED";
    case GW_STATE_CONNECTING:   return "CONNECTING";
    case GW_STATE_BACKOFF:      return "BACKOFF";
    case GW_STATE_DISCONNECTED: return "DISCONNECTED";
    default:                    return "UNKNOWN";
  }
}

void GatewayManager::handleIncomingMeshPacket(uint32_t fromNodeId, const String& rawMsg) {
  MessageEnvelope env;
  TelemetryData telem;
  AlertData alert;
  HeartbeatData hb;
  bool isLegacy = false;

  bool parsed = deserializePacket(rawMsg, env, telem, alert, hb, isLegacy);
  if (!parsed) {
    Serial.printf("[GW REJECT] Malformed mesh packet from %u dropped.\n", fromNodeId);
    return;
  }

  // Determine priority: All emergency alerts or legacy fall detections are high priority
  bool isPriority = (env.msg_type == MSG_ALERT) || (isLegacy && telem.fall_detected);

  // Push to persistent buffer
  m_buffer.push(rawMsg, env.msg_type, isPriority);

  Serial.printf("[GW INGEST] Buffered packet from %s (Type: %s | Priority: %s | Queue Size: %u)\n",
                env.sender_id,
                messageTypeToString(env.msg_type),
                isPriority ? "HIGH" : "NORMAL",
                m_buffer.count());
}

void GatewayManager::update() {
  uint32_t now = millis();

  // 1. Connection Monitoring (Every 1500ms)
  if (now - m_lastStateCheckMs >= 1500) {
    m_lastStateCheckMs = now;
    checkConnection();
  }

  // 2. Handle Exponential Backoff Timer
  if (m_state == GW_STATE_BACKOFF) {
    if (now - m_backoffStartMs >= m_currentBackoffMs) {
      Serial.printf("[GW BACKOFF END] Retrying uplink connection (Waited: %u ms)...\n",
                    m_currentBackoffMs);
      m_state = (WiFi.status() == WL_CONNECTED) ? GW_STATE_CONNECTED : GW_STATE_CONNECTING;
    } else {
      return; // Still waiting out backoff interval
    }
  }

  // 3. Process & Flush Queued Packets
  if (m_state == GW_STATE_CONNECTED && !m_buffer.isEmpty()) {
    // Pace HTTP requests (minimum 60ms between packets to prevent socket choking)
    if (now - m_lastTransmitMs >= 60) {
      m_lastTransmitMs = now;

      BufferedItem item;
      if (m_buffer.peek(item)) {
        bool sent = forwardPacket(item);
        if (sent) {
          m_buffer.pop();
          resetBackoff();
        } else {
          triggerBackoff();
        }
      }
    }
  }
}

void GatewayManager::checkConnection() {
  wl_status_t status = WiFi.status();

  if (status == WL_CONNECTED) {
    if (m_state != GW_STATE_CONNECTED && m_state != GW_STATE_BACKOFF) {
      m_state = GW_STATE_CONNECTED;
      Serial.println("\n[GW UPLINK] Wi-Fi Station CONNECTED!");
      Serial.printf("   |-- Gateway IP Address : %s\n", WiFi.localIP().toString().c_str());
      Serial.printf("   |-- Pending Queue Size : %u packets\n", m_buffer.count());
    }
  } else if (status == WL_DISCONNECTED || status == WL_IDLE_STATUS || status == WL_CONNECTION_LOST) {
    if (m_state == GW_STATE_CONNECTED) {
      Serial.println("\n[GW UPLINK WARNING] Wi-Fi disconnected! Switching to offline buffering.");
    }
    m_state = GW_STATE_DISCONNECTED;
    // Attempt non-blocking reconnection
    WiFi.begin(m_ssid, m_password);
  }
}

String GatewayManager::resolveEndpoint(MessageType type) {
  switch (type) {
    case MSG_ALERT:     return ENDPOINT_ALERT;
    case MSG_HEARTBEAT: return ENDPOINT_HEARTBEAT;
    case MSG_TELEMETRY:
    default:            return ENDPOINT_TELEMETRY;
  }
}

bool GatewayManager::forwardPacket(const BufferedItem& item) {
  String url = m_backendUrl + resolveEndpoint(item.type);

  HTTPClient http;
  if (!http.begin(url)) {
    Serial.printf("[GW HTTP ERROR] Unable to parse URL: %s\n", url.c_str());
    return false;
  }

  http.setTimeout(BACKEND_TIMEOUT_MS);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-API-Key", m_apiKey);
  http.addHeader("X-Gateway-ID", ACTIVE_DEVICE_ID);
  http.addHeader("X-Packet-Priority", item.isPriority ? "HIGH" : "NORMAL");

  int httpCode = http.POST(item.rawJson);

  if (httpCode >= 200 && httpCode < 300) {
    Serial.printf("[GW FORWARD SUCCESS] Flushed %s packet to %s (HTTP %d | Remaining: %u)\n",
                  item.isPriority ? "CRITICAL ALERT" : "TELEMETRY",
                  url.c_str(),
                  httpCode,
                  m_buffer.count() - 1);
    http.end();
    return true;
  }

  // Handle Client-Side Errors (400 Bad Request / 422 Unprocessable)
  // Drop the bad packet so it doesn't perpetually block the buffer queue
  if (httpCode == 400 || httpCode == 422) {
    Serial.printf("[GW CLIENT ERROR] Backend rejected packet with HTTP %d. Dropping invalid payload to unblock queue.\n",
                  httpCode);
    http.end();
    m_buffer.pop(); // Discard unparseable packet
    return true;
  }

  // Server error (5xx) or Network timeout/connection failure (< 0)
  Serial.printf("[GW UPLINK ERROR] Failed to send to backend (HTTP %d: %s). Packet retained in buffer.\n",
                httpCode,
                httpCode < 0 ? http.errorToString(httpCode).c_str() : "Server Error");
  http.end();
  return false;
}

void GatewayManager::triggerBackoff() {
  m_consecutiveFailures++;
  m_backoffStartMs = millis();
  m_state = GW_STATE_BACKOFF;

  // Exponential backoff: min 2000ms, doubles each failure up to max 60000ms
  m_currentBackoffMs = GW_RECONNECT_MIN_MS * (1 << (m_consecutiveFailures > 5 ? 5 : m_consecutiveFailures));
  if (m_currentBackoffMs > GW_RECONNECT_MAX_MS) {
    m_currentBackoffMs = GW_RECONNECT_MAX_MS;
  }

  Serial.printf("[GW BACKOFF] Failures: %u | Backoff penalty: %u ms | Buffered items: %u\n",
                m_consecutiveFailures, m_currentBackoffMs, m_buffer.count());
}

void GatewayManager::resetBackoff() {
  if (m_consecutiveFailures > 0) {
    Serial.println("[GW RECOVERY] Uplink stabilized. Backoff penalty reset.");
  }
  m_consecutiveFailures = 0;
  m_currentBackoffMs = GW_RECONNECT_MIN_MS;
}
