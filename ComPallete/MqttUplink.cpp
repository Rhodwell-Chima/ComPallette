#include "MqttUplink.h"
#include <LittleFS.h>
#include <ArduinoJson.h>
#include <time.h>
#include "DeviceTrust.h"
#include "Logging.h"
#include "NodeConfigManager.h"

static const char* const MQTT_TAG = "CP_MQTT";

bool MqttUplink::begin(const String& uri, const String& gateway, const String& credential) {
  if (!DeviceTrust::ready() || !uri.startsWith("mqtts://")) {
    ESP_LOGE(MQTT_TAG, "MQTT requires local trust and a TLS endpoint");
    return false;
  }
  // CA provisioning is explicit; never disable certificate/hostname verification.
  File certificate = LittleFS.open("/mqtt-ca.pem", "r");
  if (!certificate) {
    ESP_LOGE(MQTT_TAG, "Required MQTT CA certificate unavailable; transport disabled");
    return false;
  }
  ca = certificate.readString(); certificate.close();
  identity = gateway;
  prefix = "compallette/v1/gateways/" + identity;
  incoming = xQueueCreate(8, sizeof(Incoming));
  if (!incoming) {
    ESP_LOGE(MQTT_TAG, "MQTT receive queue allocation failed");
    return false;
  }
  esp_mqtt_client_config_t config = {};
  config.broker.address.uri = uri.c_str();
  config.broker.verification.certificate = ca.c_str();
  config.credentials.username = identity.c_str();
  config.credentials.client_id = identity.c_str();
  config.credentials.authentication.password = credential.c_str();
  config.session.disable_clean_session = true;
  config.session.keepalive = 30;
  config.buffer.size = 2048;
  config.network.reconnect_timeout_ms = 3000;
  client = esp_mqtt_client_init(&config);
  if (!client) {
    ESP_LOGE(MQTT_TAG, "MQTT client initialization failed");
    return false;
  }
  esp_mqtt_client_register_event(client, MQTT_EVENT_ANY, event, this);
  const esp_err_t result = esp_mqtt_client_start(client);
  if (result != ESP_OK) ESP_LOGE(MQTT_TAG, "MQTT client start failed; error=%d", static_cast<int>(result));
  return result == ESP_OK;
}

void MqttUplink::event(void* arg, esp_event_base_t, int32_t, void* data) {
  static_cast<MqttUplink*>(arg)->receive(static_cast<esp_mqtt_event_handle_t>(data));
}

void MqttUplink::receive(esp_mqtt_event_handle_t evt) {
  if (evt->event_id == MQTT_EVENT_CONNECTED) {
    connected = true;
    esp_mqtt_client_subscribe(client, (prefix + "/receipts").c_str(), 1);
    esp_mqtt_client_subscribe(client, (prefix + "/commands").c_str(), 1);
  } else if (evt->event_id == MQTT_EVENT_DISCONNECTED) {
    connected = false;
  } else if (evt->event_id == MQTT_EVENT_ERROR && ARDUHAL_LOG_LEVEL >= ARDUHAL_LOG_LEVEL_ERROR) {
    if (evt->error_handle && evt->error_handle->error_type == MQTT_ERROR_TYPE_TCP_TRANSPORT) {
      const uint32_t flags = evt->error_handle->esp_tls_cert_verify_flags;
      if (flags) tlsVerifyFlags.fetch_or(flags, std::memory_order_relaxed);
    }
  } else if (evt->event_id == MQTT_EVENT_DATA) {
    if (evt->retain || evt->total_data_len >= 2048 || evt->total_data_len <= 0) return;
    if (evt->current_data_offset == 0) {
      partialTopic = String(evt->topic, evt->topic_len);
      partialBody = "";
    }
    if (static_cast<int>(partialBody.length()) != evt->current_data_offset) return;
    partialBody += String(evt->data, evt->data_len);
    if (static_cast<int>(partialBody.length()) == evt->total_data_len) {
      Incoming message = {};
      strlcpy(message.topic, partialTopic.c_str(), sizeof(message.topic));
      strlcpy(message.body, partialBody.c_str(), sizeof(message.body));
      // Overflow leaves events buffered; the sender retries rather than claiming delivery.
      if (xQueueSend(incoming, &message, 0) != pdTRUE && ARDUHAL_LOG_LEVEL >= ARDUHAL_LOG_LEVEL_WARN) {
        droppedIncoming.fetch_add(1, std::memory_order_relaxed);
      }
    }
  }
}

void MqttUplink::update(OfflineBuffer& buffer, std::function<void(const String&)> downlink) {
  if (!client || !incoming) return;
  if (ARDUHAL_LOG_LEVEL >= ARDUHAL_LOG_LEVEL_WARN) {
    const bool brokerConnected = isConnected();
    if (brokerConnected != reportedConnected) {
      reportedConnected = brokerConnected;
      if (brokerConnected) {
        ESP_LOGI(MQTT_TAG, "Broker connected");
      } else {
        static DiagnosticInterval<ARDUHAL_LOG_LEVEL_WARN> disconnectLog;
        if (disconnectLog.ready()) ESP_LOGW(MQTT_TAG, "Broker disconnected");
      }
    }
  }
  static DiagnosticInterval<ARDUHAL_LOG_LEVEL_ERROR> tlsLog;
  if (ARDUHAL_LOG_LEVEL >= ARDUHAL_LOG_LEVEL_ERROR &&
      tlsVerifyFlags.load(std::memory_order_relaxed) && tlsLog.ready()) {
    const uint32_t flags = tlsVerifyFlags.exchange(0, std::memory_order_relaxed);
    ESP_LOGE(MQTT_TAG, "Broker TLS certificate validation failed; flags=0x%" PRIX32, flags);
  }
  static DiagnosticInterval<ARDUHAL_LOG_LEVEL_WARN> overflowLog;
  if (ARDUHAL_LOG_LEVEL >= ARDUHAL_LOG_LEVEL_WARN &&
      droppedIncoming.load(std::memory_order_relaxed) && overflowLog.ready()) {
    const uint32_t dropped = droppedIncoming.exchange(0, std::memory_order_relaxed);
    ESP_LOGW(MQTT_TAG, "MQTT receive queue overflow; dropped=%" PRIu32, dropped);
  }
  Incoming incomingMessage;
  while (xQueueReceive(incoming, &incomingMessage, 0) == pdTRUE) {
    StaticJsonDocument<2048> message;
    if (deserializeJson(message, incomingMessage.body)) {
      static DiagnosticInterval<ARDUHAL_LOG_LEVEL_WARN> parseLog;
      if (parseLog.ready()) ESP_LOGW(MQTT_TAG, "Malformed MQTT message rejected");
      continue;
    }
    if (String(incomingMessage.topic).endsWith("/receipts")) {
      BufferedItem head;
      if (!buffer.peek(head)) continue;
      StaticJsonDocument<2048> eventJson;
      if (deserializeJson(eventJson, head.rawJson)) continue;
      bool matched = false;
      if (eventJson["type"] == "COMMAND_RESULT") {
        matched = String(message["command_id"] | "") == String(eventJson["payload"]["command_id"] | "")
          && String(message["received_state"] | "") == String(eventJson["payload"]["state"] | "");
      } else {
        matched = String(message["installation_id"] | "") == DeviceTrust::installation()
          && message["status"] == "ok"
          && String(message["node_id"] | "") == String(eventJson["sender"] | "")
          && (message["seq"] | 0UL) == (eventJson["seq"] | 0UL)
          && String(message["event_type"] | "") == String(eventJson["type"] | "");
      }
      if (matched) {
        static DiagnosticInterval<ARDUHAL_LOG_LEVEL_DEBUG> receiptLog;
        if (receiptLog.ready()) ESP_LOGD(MQTT_TAG, "Matching persistence receipt verified");
        if (message["control"].is<JsonObject>() && downlink) { String control; serializeJson(message["control"], control); downlink(control); }
        buffer.pop(); lastPublish = 0;
      } else {
        static DiagnosticInterval<ARDUHAL_LOG_LEVEL_WARN> mismatchLog;
        if (mismatchLog.ready()) ESP_LOGW(MQTT_TAG, "Persistence receipt did not match the queue head");
      }
    } else if (String(incomingMessage.topic).endsWith("/commands")) {
      if (!message["signed_body"].is<const char*>() || !message["mac"].is<const char*>()) continue;
      StaticJsonDocument<1024> receipt;
      const uint32_t sequence = nodeConfigManager.nextSequence();
      if (!sequence) continue;
      receipt["ver"] = 1; receipt["type"] = "COMMAND_RESULT"; receipt["seq"] = sequence;
      receipt["installation_id"] = DeviceTrust::installation();
      receipt["sender"] = nodeConfigManager.getDeviceId(); receipt["role"] = "GATEWAY";
      receipt["zone"] = "UNASSIGNED"; receipt["uptime"] = millis();
      JsonObject payload = receipt["payload"].to<JsonObject>();
      payload["installation_id"] = DeviceTrust::installation();
      payload["kind"] = "GATEWAY_RECEIPT";
      payload["command_id"] = message["command_id"];
      payload["node_id"] = message["node_id"];
      payload["state"] = "GATEWAY_RECEIVED";
      String raw; serializeJson(receipt, raw);
      if (!buffer.push(raw, MSG_COMMAND_RESULT, true)) continue;
      if (downlink) downlink(String(incomingMessage.body));
    }
  }
  if (!connected || buffer.isEmpty() || (lastPublish && millis() - lastPublish < 5000)) return;
  BufferedItem item;
  if (!buffer.peek(item)) return;
  StaticJsonDocument<2048> packet;
  if (deserializeJson(packet, item.rawJson)) return;
  String body = item.rawJson;
  String topic = prefix + "/events";
  if (packet["type"] == "COMMAND_RESULT") {
    body = ""; serializeJson(packet["payload"], body); topic = prefix + "/results";
  }
  const int messageId = esp_mqtt_client_enqueue(client, topic.c_str(), body.c_str(), body.length(), 1, 0, true);
  if (messageId >= 0) {
    lastPublish = millis();
    static DiagnosticInterval<ARDUHAL_LOG_LEVEL_DEBUG> publishLog;
    if (publishLog.ready()) ESP_LOGD(MQTT_TAG, "MQTT client queued publication; bytes=%zu", body.length());
  } else {
    static DiagnosticInterval<ARDUHAL_LOG_LEVEL_WARN> publishFailureLog;
    if (publishFailureLog.ready()) ESP_LOGW(MQTT_TAG, "MQTT client rejected publication; result=%d", messageId);
  }
  // Only a matching application receipt removes an event from the persistent buffer.
}
