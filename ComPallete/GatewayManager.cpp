#include "DeviceTrust.h"
#include "GatewayManager.h"
#include "Logging.h"

static const char* const GW_TAG = "CP_GW";
static const char* const WIFI_TAG = "CP_WIFI";
static const char* const HTTP_TAG = "CP_HTTP";
static const char* const DNS_TAG = "CP_DNS";
#if ENABLE_WEBSOCKET_UPLINK
static const char* const WS_TAG = "CP_WS";
#endif

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


  if (m_apiKey.length() < 32) {
    ESP_LOGE(GW_TAG, "Provisioned API key missing or too short; uplink disabled");
    m_state = GW_STATE_DISCONNECTED;
    return false;
  }

  // Initialize offline buffer (mounts LittleFS or falls back to RAM)
  m_buffer.begin(BUFFER_MAX_RAM_ITEMS, BUFFER_MAX_FLASH_ITEMS);
  m_useMqtt = m_backendUrl.startsWith("mqtts://");
  if (m_useMqtt && !m_mqtt.begin(m_backendUrl, m_deviceId, m_apiKey)) return false;

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

  ESP_LOGI(GW_TAG, "Gateway initialized; uplink=%s channel=%u",
           m_useMqtt ? "MQTT over TLS" : (ENABLE_WEBSOCKET_UPLINK ? "WebSocket with HTTP fallback" : "HTTP"),
           static_cast<unsigned>(m_meshChannel));
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

void GatewayManager::handleIncomingMeshPacket(uint32_t, const String& rawMsg) {
  MessageEnvelope env{};
  TelemetryData telem{};
  AlertData alert{};
  HeartbeatData hb{};
  bool isLegacy = false;

  bool parsed = deserializePacket(rawMsg, env, telem, alert, hb, isLegacy);
  if (!parsed) {
    static DiagnosticInterval<ARDUHAL_LOG_LEVEL_WARN> rejectedLog;
    if (rejectedLog.ready()) ESP_LOGW(GW_TAG, "Malformed gateway packet rejected; bytes=%zu", rawMsg.length());
    return;
  }

  // Priority detection: All emergency alerts or legacy fall detections get high priority
  bool isPriority = (env.msg_type == MSG_ALERT) || (isLegacy && telem.fall_detected);

  // Push to persistent buffer
  if (!m_buffer.push(rawMsg, env.msg_type, isPriority)) return;
  static DiagnosticInterval<ARDUHAL_LOG_LEVEL_DEBUG> ingestLog;
  if (ingestLog.ready()) {
    ESP_LOGD(GW_TAG, "Packet retained; type=%u priority=%u queued=%zu",
             static_cast<unsigned>(env.msg_type), static_cast<unsigned>(isPriority), m_buffer.count());
  }
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

  ESP_LOGD(WS_TAG, "Starting WebSocket client; port=%u", static_cast<unsigned>(port));

  m_wsClient.begin(hostStr.c_str(), port, wsPath.c_str());
  m_wsClient.setExtraHeaders(extraHeaders.c_str());
  m_wsClient.setReconnectInterval(3000);
  m_wsInitialized = true;
}

void GatewayManager::handleWsEvent(WStype_t type, uint8_t * payload, size_t length) {
  switch (type) {
    case WStype_DISCONNECTED: {
      static DiagnosticInterval<ARDUHAL_LOG_LEVEL_WARN> disconnectLog;
      m_wsConnected = false;
      if (disconnectLog.ready()) ESP_LOGW(WS_TAG, "WebSocket disconnected");
      break;
    }
    case WStype_CONNECTED:
      m_wsConnected = true;
      ESP_LOGI(WS_TAG, "WebSocket connected");
      break;

    case WStype_TEXT: {
      String msg = String((char*)payload);
      static DiagnosticInterval<ARDUHAL_LOG_LEVEL_DEBUG> frameLog;
      if (frameLog.ready()) ESP_LOGD(WS_TAG, "Text frame received; bytes=%zu", length);
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
      ESP_LOGD(GW_TAG, "Retrying uplink; backoff_ms=%" PRIu32, m_currentBackoffMs);
      m_state = (WiFi.status() == WL_CONNECTED) ? GW_STATE_CONNECTED : GW_STATE_CONNECTING;
    } else {
      return; // Still waiting out backoff interval
    }
  }

  if (m_useMqtt) {
    m_mqtt.update(m_buffer, m_downlinkCb);
    return;
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
          static DiagnosticInterval<ARDUHAL_LOG_LEVEL_DEBUG> sendLog;
          if (sendLog.ready()) ESP_LOGD(WS_TAG, "WebSocket accepted frame; type=%u",
                                       static_cast<unsigned>(item.type));
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
      ESP_LOGD(GW_TAG, "Station available for uplink; queued=%zu", m_buffer.count());

      if (WiFi.channel() != m_meshChannel) {
        ESP_LOGW(WIFI_TAG, "Router channel %u differs from commissioned mesh channel %u",
                 static_cast<unsigned>(WiFi.channel()), static_cast<unsigned>(m_meshChannel));
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
          ESP_LOGI(DNS_TAG, "mDNS responder initialized");
        } else {
          ESP_LOGW(DNS_TAG, "mDNS responder initialization failed");
        }
      }
    }
  } else {
    if (m_state == GW_STATE_CONNECTED) {
      ESP_LOGD(GW_TAG, "Station unavailable; uplink paused; status=%d", static_cast<int>(status));
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

IPAddress GatewayManager::resolveMdns(const String& hostname, bool localReport) {
  if (WiFi.status() != WL_CONNECTED) {
    if (localReport) Serial.println("[mDNS] Wi-Fi not connected. Cannot query mDNS.");
    else ESP_LOGD(DNS_TAG, "mDNS lookup skipped; station disconnected");
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

  if (localReport) Serial.printf("[mDNS] Querying Multicast DNS for '%s.local'...\n", clean.c_str());
  IPAddress ip = MDNS.queryHost(clean.c_str(), 2500);

  if (localReport) {
    if ((uint32_t)ip != 0) {
      Serial.printf("[mDNS] Successfully resolved '%s.local' -> %s\n", clean.c_str(), ip.toString().c_str());
    } else {
      Serial.printf("[mDNS] Could not resolve '%s.local' within 2500ms.\n", clean.c_str());
    }
  } else if ((uint32_t)ip != 0) {
    ESP_LOGD(DNS_TAG, "mDNS lookup succeeded");
  } else {
    static DiagnosticInterval<ARDUHAL_LOG_LEVEL_WARN> lookupLog;
    if (lookupLog.ready()) ESP_LOGW(DNS_TAG, "mDNS lookup timed out");
  }

  return ip;
}

bool GatewayManager::resolveMdnsHost(const String& rawUrl, String& outResolvedUrl, bool localReport) {
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
  IPAddress ip = resolveMdns(host, localReport);
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
    case MSG_COMMAND_RESULT: return ENDPOINT_PROV_CONFIRM;
    case MSG_TELEMETRY:
    default:               return ENDPOINT_TELEMETRY;
  }
}

bool GatewayManager::forwardPacket(const BufferedItem& item, bool localReport) {
  static DiagnosticInterval<ARDUHAL_LOG_LEVEL_ERROR> urlLog;
  static DiagnosticInterval<ARDUHAL_LOG_LEVEL_ERROR> authLog;
  static DiagnosticInterval<ARDUHAL_LOG_LEVEL_WARN> receiptLog;
  static DiagnosticInterval<ARDUHAL_LOG_LEVEL_WARN> rejectedLog;
  static DiagnosticInterval<ARDUHAL_LOG_LEVEL_WARN> uplinkLog;
  static DiagnosticInterval<ARDUHAL_LOG_LEVEL_DEBUG> confirmedLog;
  String rawUrl = m_backendUrl + resolveEndpoint(item.type);
  String finalUrl;
  resolveMdnsHost(rawUrl, finalUrl, localReport);

  HTTPClient http;
  if (!http.begin(finalUrl)) {
    if (localReport) Serial.println("[GW TEST] Unable to initialize HTTP request.");
    if (urlLog.ready()) ESP_LOGE(HTTP_TAG, "Unable to initialize HTTP request");
    return false;
  }

  http.setTimeout(BACKEND_TIMEOUT_MS);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-API-Key", m_apiKey);
  http.addHeader("X-Gateway-ID", m_deviceId);
  http.addHeader("X-Packet-Priority", item.isPriority ? "HIGH" : "NORMAL");

  String body = item.rawJson;
  if (item.type == MSG_COMMAND_RESULT) {
    StaticJsonDocument<2048> packet;
    if (deserializeJson(packet, body)) { http.end(); return false; }
    body = "";
    serializeJson(packet["payload"], body);
  } else if (DeviceTrust::ready()) {
    StaticJsonDocument<2048> packet;
    if (!deserializeJson(packet, body)) {
      const char* instId = packet["installation_id"] | "";
      if (strlen(instId) == 0) {
        packet["installation_id"] = DeviceTrust::installation();
        body = "";
        serializeJson(packet, body);
      }
    }
  }
  int httpCode = http.POST(body);
  if (localReport) Serial.printf("[GW TEST] HTTP result: %d\n", httpCode);
  if (httpCode >= 200 && httpCode < 300) {
    StaticJsonDocument<2048> receipt;
    StaticJsonDocument<2048> packet;
    bool matched = !deserializeJson(receipt, http.getString()) && !deserializeJson(packet, item.rawJson);
    if (matched && item.type == MSG_COMMAND_RESULT) {
      matched = String(receipt["command_id"] | "") == String(packet["payload"]["command_id"] | "")
        && String(receipt["received_state"] | "") == String(packet["payload"]["state"] | "");
    } else if (matched) {
      matched = receipt["status"] == "ok"
        && String(receipt["installation_id"] | "") == DeviceTrust::installation()
        && String(receipt["node_id"] | "") == String(packet["sender"] | "")
        && (receipt["seq"] | 0UL) == (packet["seq"] | 0UL)
        && String(receipt["event_type"] | "") == String(packet["type"] | "");
    }
    if (matched && receipt["control"].is<JsonObject>() && m_downlinkCb) {
      String control; serializeJson(receipt["control"], control); m_downlinkCb(control);
    }
    http.end();
    if (matched) {
      if (confirmedLog.ready()) ESP_LOGD(HTTP_TAG, "Matching persistence receipt verified; status=%d", httpCode);
    } else if (receiptLog.ready()) {
      ESP_LOGW(HTTP_TAG, "Persistence receipt missing or mismatched; status=%d", httpCode);
    }
    return matched;
  }

  // Only a Django-issued validation code proves the event can never be
  // accepted. Other 4xx failures (host policy, credentials, proxy policy)
  // remain queued for operator correction and later replay.
  if (httpCode == 400 || httpCode == 422) {
    const int responseSize = http.getSize();
    String responseBody = http.getString();
    bool permanentlyInvalid = false;
    StaticJsonDocument<256> responseDoc;
    if (!deserializeJson(responseDoc, responseBody)) {
      const char* errorCode = responseDoc["error_code"] | "";
      permanentlyInvalid = strcmp(errorCode, "VALIDATION_ERROR") == 0;
    }
    if (rejectedLog.ready()) {
      ESP_LOGW(HTTP_TAG, "Event rejected; status=%d type=%u validation_error=%u response_bytes=%d",
               httpCode, static_cast<unsigned>(item.type), static_cast<unsigned>(permanentlyInvalid), responseSize);
    }
    http.end();
    return false;
  }

  // Authorization failures block forwarding. Other failures remain retryable.
  if (httpCode == 401 || httpCode == 403) {
    if (authLog.ready()) ESP_LOGE(HTTP_TAG, "Uplink authorization rejected; status=%d", httpCode);
  } else if (uplinkLog.ready()) {
    ESP_LOGW(HTTP_TAG, "Uplink request failed; status=%d", httpCode);
  }
  http.end();

  // Invalidate mDNS cache on network failure so it will re-query host next attempt
  if (httpCode < 0) {
    m_cacheExpireMs = 0;
  }

  return false;
}

bool GatewayManager::sendDirectTestPacket(const String& jsonPayload, MessageType type) {
  if (m_useMqtt) {
    Serial.println("[GW TEST] HTTP recovery is not selected. Use MQTT status diagnostics; transport will not switch automatically.");
    return false;
  }
  if (WiFi.status() != WL_CONNECTED || !DeviceTrust::ready()) {
    Serial.println("[GW TEST] Uplink or local trust unavailable; persistence cannot be confirmed.");
    return false;
  }
  BufferedItem item;
  item.rawJson = jsonPayload;
  item.type = type;
  item.isPriority = false;
  item.queuedTimestampMs = millis();
  const bool confirmed = forwardPacket(item, true);
  Serial.println(confirmed ? "[GW TEST] Matching database persistence receipt received."
                           : "[GW TEST] Persistence not confirmed. Check registration, transport and server diagnostics.");
  return confirmed;
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

  ESP_LOGD(GW_TAG, "Uplink retry scheduled; failures=%u backoff_ms=%" PRIu32 " queued=%zu",
           static_cast<unsigned>(m_consecutiveFailures), m_currentBackoffMs, m_buffer.count());
}

void GatewayManager::resetBackoff() {
  if (m_consecutiveFailures > 0) {
    ESP_LOGI(GW_TAG, "Uplink retry backoff cleared after a successful forward");
  }
  m_consecutiveFailures = 0;
  m_currentBackoffMs = GW_RECONNECT_MIN_MS;
}
