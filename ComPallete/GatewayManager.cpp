#include "GatewayManager.h"

GatewayManager::GatewayManager()
  : m_ssid(UPLINK_WIFI_SSID),
    m_password(UPLINK_WIFI_PASSWORD),
    m_backendUrl(BACKEND_BASE_URL),
    m_apiKey(""),
    m_deviceId(ACTIVE_DEVICE_ID),
    m_meshChannel(MESH_CHANNEL),
    m_state(GW_STATE_DISCONNECTED),
    m_lastStateCheckMs(0),
    m_lastTransmitMs(0),
    m_backoffStartMs(0),
    m_currentBackoffMs(GW_RECONNECT_MIN_MS),
    m_consecutiveFailures(0),
    m_mdnsInitialized(false),
    m_cachedHost(""),
    m_cachedIp(0, 0, 0, 0),
    m_cacheExpireMs(0),
    m_wsConnected(false),
#if ENABLE_WEBSOCKET_UPLINK
    m_wsInitialized(false),
#endif
    m_downlinkCb(nullptr) {}

GatewayManager::~GatewayManager() {}

bool GatewayManager::begin(
  const char* ssid,
  const char* password,
  const char* backendUrl,
  const char* apiKey,
  const char* deviceId,
  uint8_t meshChannel
) {
  m_ssid = (ssid && strlen(ssid) > 0) ? ssid : UPLINK_WIFI_SSID;
  m_password = password ? password : UPLINK_WIFI_PASSWORD;
  m_backendUrl = (backendUrl && strlen(backendUrl) > 0) ? backendUrl : BACKEND_BASE_URL;
  m_apiKey = (apiKey && strlen(apiKey) > 0) ? apiKey : "";
  m_deviceId = (deviceId && strlen(deviceId) > 0) ? deviceId : ACTIVE_DEVICE_ID;
  m_meshChannel = meshChannel;

  Serial.println("\n==============================================================");
  Serial.println("         COMPALLETTE - GATEWAY BRIDGE INITIALIZATION          ");
  Serial.printf("  Target Uplink SSID : %s\n", m_ssid.c_str());
  Serial.printf("  Backend REST URL   : %s\n", m_backendUrl.c_str());
  Serial.printf("  Gateway Node ID    : %s\n", m_deviceId.c_str());
  Serial.printf("  Required Radio Ch. : %u\n", m_meshChannel);
#if ENABLE_WEBSOCKET_UPLINK
  Serial.println("  Real-time Uplink   : WebSocket Streaming (with HTTP Fallback)");
#else
  Serial.println("  Real-time Uplink   : HTTP REST Polling");
#endif
  Serial.println("==============================================================");

  if (m_apiKey.length() < 32) {
    Serial.println("[GW CONFIG ERROR] A provisioned API key of at least 32 characters is required; uplink disabled.");
    m_state = GW_STATE_DISCONNECTED;
    return false;
  }

  // Initialize offline buffer (mounts LittleFS or falls back to RAM)
  m_buffer.begin(BUFFER_MAX_RAM_ITEMS, BUFFER_MAX_FLASH_ITEMS);

#if ENABLE_WEBSOCKET_UPLINK
  // Register WebSocket event handler
  m_wsClient.onEvent([this](WStype_t type, uint8_t * payload, size_t length) {
    this->handleWsEvent(type, payload, length);
  });
#endif

  // painlessMesh 1.5.7 owns the station connection through stationManual().
  // Calling WiFi.begin() here would compete with its mesh scan/reconnect task
  // for the ESP32's only STA interface.
  m_state = GW_STATE_CONNECTING;
  m_lastStateCheckMs = millis();

  return true;
}

const char* GatewayManager::getStateString() const {
  switch (m_state) {
    case GW_STATE_CONNECTED:
      return m_wsConnected ? "CONNECTED (WebSocket Stream)" : "CONNECTED (HTTP REST Fallback)";
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

  // Priority detection: All emergency alerts or legacy fall detections get high priority
  bool isPriority = (env.msg_type == MSG_ALERT) || (isLegacy && telem.fall_detected);

  // Push to persistent buffer
  if (!m_buffer.push(rawMsg, env.msg_type, isPriority)) {
    Serial.printf("[GW DROP] Could not retain packet from %s (priority=%s). Total dropped=%u\n",
                  env.sender_id, isPriority ? "yes" : "no", m_buffer.getTotalDropped());
    return;
  }

  Serial.printf("[GW INGEST] Buffered packet from %s (Type: %s | Priority: %s | Queue Size: %u)\n",
                env.sender_id,
                messageTypeToString(env.msg_type),
                isPriority ? "HIGH" : "NORMAL",
                m_buffer.count());
}

#if ENABLE_WEBSOCKET_UPLINK
void GatewayManager::initWebSocket() {
  String finalUrl;
  resolveMdnsHost(m_backendUrl, finalUrl);

  // Extract host and port from URL (e.g. http://192.168.1.176:8000)
  int protoEnd = finalUrl.indexOf("://");
  int hostStart = (protoEnd != -1) ? protoEnd + 3 : 0;
  int slashIdx = finalUrl.indexOf('/', hostStart);
  int colonIdx = finalUrl.indexOf(':', hostStart);

  String hostStr;
  uint16_t port = 8000;

  if (colonIdx != -1 && (slashIdx == -1 || colonIdx < slashIdx)) {
    hostStr = finalUrl.substring(hostStart, colonIdx);
    int portEnd = (slashIdx != -1) ? slashIdx : finalUrl.length();
    port = (uint16_t)finalUrl.substring(colonIdx + 1, portEnd).toInt();
  } else if (slashIdx != -1) {
    hostStr = finalUrl.substring(hostStart, slashIdx);
    port = (finalUrl.startsWith("https")) ? 443 : 80;
  } else {
    hostStr = finalUrl.substring(hostStart);
  }

  String wsPath = String(ENDPOINT_WS_GATEWAY);
  String extraHeaders = "X-API-Key: " + m_apiKey + "\r\nX-Gateway-ID: " + m_deviceId + "\r\n";

  Serial.println("\n--------------------------------------------------------------");
  Serial.println("[GW WS] Initializing WebSocket Uplink client...");
  Serial.printf("  |-- Target Host : %s:%u\n", hostStr.c_str(), port);
  Serial.printf("  |-- Target Path : %s\n", wsPath.c_str());
  Serial.println("--------------------------------------------------------------");

  m_wsClient.begin(hostStr.c_str(), port, wsPath.c_str());
  m_wsClient.setExtraHeaders(extraHeaders.c_str());
  m_wsClient.setReconnectInterval(3000);
  m_wsInitialized = true;
}

void GatewayManager::handleWsEvent(WStype_t type, uint8_t * payload, size_t length) {
  switch (type) {
    case WStype_DISCONNECTED:
      m_wsConnected = false;
      Serial.println("\n[GW WS WARNING] WebSocket disconnected. Running on HTTP REST fallback mode.");
      break;

    case WStype_CONNECTED:
      m_wsConnected = true;
      Serial.printf("\n[GW WS CONNECTED] Streaming socket established to backend! (Server: %s)\n", (char*)payload);
      break;

    case WStype_TEXT: {
      String msg = String((char*)payload);
      Serial.printf("\n[GW WS DOWNLINK RX] Received message from surface: %s\n", msg.c_str());
      if (m_downlinkCb) {
        m_downlinkCb(msg);
      }
      break;
    }

    case WStype_BIN:
    case WStype_ERROR:
    case WStype_FRAGMENT_TEXT_START:
    case WStype_FRAGMENT_BIN_START:
    case WStype_FRAGMENT:
    case WStype_FRAGMENT_FIN:
    default:
      break;
  }
}
#endif

void GatewayManager::update() {
  uint32_t now = millis();

  // 1. Observe the painlessMesh-managed station connection (every 1500ms).
  if (now - m_lastStateCheckMs >= 1500) {
    m_lastStateCheckMs = now;
    checkConnection();
  }

#if ENABLE_WEBSOCKET_UPLINK
  // Maintain WebSocket loop if Wi-Fi STA is connected
  if (WiFi.status() == WL_CONNECTED) {
    if (!m_wsInitialized) {
      initWebSocket();
    }
    m_wsClient.loop();
  } else {
    m_wsConnected = false;
  }
#endif

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
#if ENABLE_WEBSOCKET_UPLINK
    if (m_wsConnected) {
      // Over WebSocket: Ultra-low latency framing!
      BufferedItem item;
      if (m_buffer.peek(item)) {
        bool sent = m_wsClient.sendTXT(item.rawJson);
        if (sent) {
          Serial.printf("[GW WS FORWARD] Streamed %s (Remaining: %u)\n",
                        messageTypeToString(item.type), m_buffer.count() - 1);
          m_buffer.pop();
          resetBackoff();
        }
      }
    } else {
#endif
      // Over HTTP REST: Fallback mode (minimum 60ms between requests)
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
#if ENABLE_WEBSOCKET_UPLINK
    }
#endif
  }
}

void GatewayManager::checkConnection() {
  wl_status_t status = WiFi.status();

  if (status == WL_CONNECTED) {
    if (m_state != GW_STATE_CONNECTED && m_state != GW_STATE_BACKOFF) {
      m_state = GW_STATE_CONNECTED;
      Serial.println("\n[GW UPLINK] Wi-Fi Station CONNECTED!");
      Serial.printf("   |-- Gateway IP Address : %s\n", WiFi.localIP().toString().c_str());
      Serial.printf("   |-- Router Gateway IP  : %s\n", WiFi.gatewayIP().toString().c_str());
      Serial.printf("   |-- Subnet Mask        : %s\n", WiFi.subnetMask().toString().c_str());
      Serial.printf("   |-- Uplink RSSI        : %d dBm\n", WiFi.RSSI());
      Serial.printf("   |-- Router Channel     : %u\n", WiFi.channel());
      Serial.printf("   |-- Pending Queue Size : %u packets\n", m_buffer.count());

      if (WiFi.channel() != m_meshChannel) {
        Serial.printf("[GW RADIO WARNING] Router channel %u differs from commissioned mesh channel %u. "
                      "ESP32 AP+STA uses one channel; align the router and mesh before deployment.\n",
                      WiFi.channel(), m_meshChannel);
      }

      // Initialize mDNS Responder on the ESP32
      if (!m_mdnsInitialized) {
        String mdnsHost = m_deviceId;
        mdnsHost.toLowerCase();
        mdnsHost.replace('_', '-');
        if (mdnsHost.length() == 0) {
          mdnsHost = "compallette-gw";
        }

        if (MDNS.begin(mdnsHost.c_str())) {
          m_mdnsInitialized = true;
          MDNS.addService("compallette", "tcp", 80);
          MDNS.addServiceTxt("compallette", "tcp", "role", "gateway");
          Serial.printf("   |-- mDNS Responder     : Active (http://%s.local)\n", mdnsHost.c_str());
        } else {
          Serial.println("   |-- [WARN] MDNS.begin() failed to initialize.");
        }
      }
    }
  } else {
    if (m_state == GW_STATE_CONNECTED) {
      Serial.printf("\n[GW UPLINK WARNING] Wi-Fi station unavailable (status %d). Switching to offline buffering.\n",
                    (int)status);
    }
    m_state = GW_STATE_DISCONNECTED;
    m_wsConnected = false;
    // Invalidate cached IP upon Wi-Fi loss
    m_cachedIp = IPAddress(0, 0, 0, 0);
    m_cacheExpireMs = 0;
    // painlessMesh 1.5.7 schedules the reconnect for the station configured
    // by stationManual(); do not issue a competing WiFi.begin() here.
  }
}

IPAddress GatewayManager::resolveMdns(const String& hostname) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[mDNS] Wi-Fi not connected. Cannot query mDNS.");
    return IPAddress(0, 0, 0, 0);
  }

  // Ensure MDNS subsystem is active
  if (!m_mdnsInitialized) {
    MDNS.begin("compallette-gw");
    m_mdnsInitialized = true;
  }

  String clean = hostname;
  clean.trim();
  if (clean.endsWith(".local") || clean.endsWith(".LOCAL")) {
    clean = clean.substring(0, clean.length() - 6);
  }

  Serial.printf("[mDNS] Querying Multicast DNS for '%s.local'...\n", clean.c_str());
  IPAddress ip = MDNS.queryHost(clean.c_str(), 2500);

  if ((uint32_t)ip != 0) {
    Serial.printf("[mDNS] Successfully resolved '%s.local' -> %s\n", clean.c_str(), ip.toString().c_str());
  } else {
    Serial.printf("[mDNS] Could not resolve '%s.local' within 2500ms.\n", clean.c_str());
  }

  return ip;
}

bool GatewayManager::resolveMdnsHost(const String& rawUrl, String& outResolvedUrl) {
  int protoEnd = rawUrl.indexOf("://");
  if (protoEnd == -1) {
    outResolvedUrl = rawUrl;
    return true;
  }

  int hostStart = protoEnd + 3;
  int slashIdx = rawUrl.indexOf('/', hostStart);
  int colonIdx = rawUrl.indexOf(':', hostStart);

  int hostEnd;
  if (colonIdx != -1 && (slashIdx == -1 || colonIdx < slashIdx)) {
    hostEnd = colonIdx;
  } else if (slashIdx != -1) {
    hostEnd = slashIdx;
  } else {
    hostEnd = rawUrl.length();
  }

  String host = rawUrl.substring(hostStart, hostEnd);
  host.trim();

  // If not a .local domain, return as-is
  if (!host.endsWith(".local") && !host.endsWith(".LOCAL")) {
    outResolvedUrl = rawUrl;
    return true;
  }

  // Check cached IP address
  uint32_t now = millis();
  if (m_cachedHost.equalsIgnoreCase(host) && now < m_cacheExpireMs && (uint32_t)m_cachedIp != 0) {
    outResolvedUrl = rawUrl.substring(0, hostStart) + m_cachedIp.toString() + rawUrl.substring(hostEnd);
    return true;
  }

  // Resolve via mDNS
  IPAddress ip = resolveMdns(host);
  if ((uint32_t)ip != 0) {
    m_cachedHost = host;
    m_cachedIp = ip;
    m_cacheExpireMs = now + 60000; // Cache for 60 seconds
    outResolvedUrl = rawUrl.substring(0, hostStart) + ip.toString() + rawUrl.substring(hostEnd);
    return true;
  }

  // Fallback to original URL if mDNS failed
  outResolvedUrl = rawUrl;
  return false;
}

String GatewayManager::resolveEndpoint(MessageType type) {
  switch (type) {
    case MSG_ALERT:        return ENDPOINT_ALERT;
    case MSG_HEARTBEAT:    return ENDPOINT_HEARTBEAT;
    case MSG_PROV_REQ:     return ENDPOINT_PROV_REQUEST;
    case MSG_PROV_CONFIRM: return ENDPOINT_PROV_CONFIRM;
    case MSG_TELEMETRY:
    default:               return ENDPOINT_TELEMETRY;
  }
}

bool GatewayManager::forwardPacket(const BufferedItem& item) {
  String rawUrl = m_backendUrl + resolveEndpoint(item.type);
  String finalUrl;
  resolveMdnsHost(rawUrl, finalUrl);

  HTTPClient http;
  if (!http.begin(finalUrl)) {
    Serial.printf("[GW HTTP ERROR] Unable to parse URL: %s\n", finalUrl.c_str());
    return false;
  }

  http.setTimeout(BACKEND_TIMEOUT_MS);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-API-Key", m_apiKey);
  http.addHeader("X-Gateway-ID", m_deviceId);
  http.addHeader("X-Packet-Priority", item.isPriority ? "HIGH" : "NORMAL");

  int httpCode = http.POST(item.rawJson);

  if (httpCode >= 200 && httpCode < 300) {
    Serial.printf("[GW FORWARD SUCCESS] Flushed %s packet to %s (HTTP %d | Remaining: %u)\n",
                  item.isPriority ? "CRITICAL ALERT" : messageTypeToString(item.type),
                  finalUrl.c_str(),
                  httpCode,
                  m_buffer.count() - 1);
    http.end();
    return true;
  }

  // Only a Django-issued validation code proves the event can never be
  // accepted. Other 4xx failures (host policy, credentials, proxy policy)
  // remain queued for operator correction and later replay.
  if (httpCode == 400 || httpCode == 422) {
    uint32_t rejectedSeq = 0;
    const char* rejectedSender = "unknown";
    StaticJsonDocument<512> diagnosticDoc;
    if (!deserializeJson(diagnosticDoc, item.rawJson)) {
      rejectedSeq = diagnosticDoc["seq"] | 0UL;
      rejectedSender = diagnosticDoc["sender"] | "unknown";
    }

    const int responseSize = http.getSize();
    String responseBody = http.getString();
    bool permanentlyInvalid = false;
    StaticJsonDocument<256> responseDoc;
    if (!deserializeJson(responseDoc, responseBody)) {
      const char* errorCode = responseDoc["error_code"] | "";
      permanentlyInvalid = strcmp(errorCode, "VALIDATION_ERROR") == 0;
    }
    responseBody.replace('\r', ' ');
    responseBody.replace('\n', ' ');
    if (responseBody.length() > 160) responseBody.remove(160);

    if (permanentlyInvalid) {
      Serial.printf("[GW INVALID EVENT] HTTP %d for %s %s #%u; discarding permanently invalid event. Response (%d B): %s\n",
                    httpCode, messageTypeToString(item.type), rejectedSender, rejectedSeq,
                    responseSize, responseBody.c_str());
      http.end();
      return true;
    }
    if (responseBody.length() > 0) {
      Serial.printf("[GW CONFIG ERROR] HTTP %d for %s %s #%u; retaining packet for recovery. Response (%d B): %s\n",
                    httpCode, messageTypeToString(item.type), rejectedSender, rejectedSeq,
                    responseSize, responseBody.c_str());
    } else {
      Serial.printf("[GW CONFIG ERROR] HTTP %d for %s %s #%u; retaining packet for recovery (response size: %d B).\n",
                    httpCode, messageTypeToString(item.type), rejectedSender, rejectedSeq, responseSize);
    }
    http.end();
    return false;
  }

  // Server error (5xx) or Network timeout/connection failure (< 0)
  Serial.printf("[GW UPLINK ERROR] Failed to send to backend (HTTP %d: %s). Packet retained in buffer.\n",
                httpCode,
                httpCode < 0 ? http.errorToString(httpCode).c_str() : "Server Error");
  http.end();

  // Invalidate mDNS cache on network failure so it will re-query host next attempt
  if (httpCode < 0) {
    m_cacheExpireMs = 0;
  }

  return false;
}

bool GatewayManager::sendDirectTestPacket(const String& jsonPayload, MessageType type) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[GW TEST ERROR] Cannot send test packet: Wi-Fi STA is NOT connected!");
    return false;
  }

  String rawUrl = m_backendUrl + resolveEndpoint(type);
  String finalUrl;
  resolveMdnsHost(rawUrl, finalUrl);

  Serial.println("\n--------------------------------------------------------------");
  Serial.printf("[GW DIRECT TEST] Dispatching test POST to: %s\n", finalUrl.c_str());
  Serial.printf("[GW DIRECT TEST] Payload: %s\n", jsonPayload.c_str());

  HTTPClient http;
  if (!http.begin(finalUrl)) {
    Serial.println("[GW DIRECT TEST] HTTPClient::begin() failed.");
    return false;
  }

  http.setTimeout(BACKEND_TIMEOUT_MS);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-API-Key", m_apiKey);
  http.addHeader("X-Gateway-ID", m_deviceId);

  int httpCode = http.POST(jsonPayload);
  Serial.printf("[GW DIRECT TEST] Response Code: %d (%s)\n",
                httpCode,
                httpCode > 0 ? "HTTP Response" : http.errorToString(httpCode).c_str());

  if (httpCode >= 200 && httpCode < 300) {
    String resp = http.getString();
    Serial.printf("[GW DIRECT TEST SUCCESS] Server returned: %s\n", resp.c_str());
    http.end();
    return true;
  }

  if (httpCode > 0) {
    String response = http.getString();
    if (httpCode == HTTP_CODE_UNAUTHORIZED || httpCode == HTTP_CODE_FORBIDDEN) {
      Serial.printf("[GW DIRECT TEST AUTH ERROR] Backend rejected the Gateway credential (HTTP %d). Re-enter the Gateway API key through the captive portal; do not print or share that key. Response: %s\n",
                    httpCode, response.c_str());
    } else {
      Serial.printf("[GW DIRECT TEST ERROR] Backend rejected the request (HTTP %d). Response: %s\n",
                    httpCode, response.c_str());
    }
  }

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
