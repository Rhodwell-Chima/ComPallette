#include "MqttUplink.h"
#include <LittleFS.h>
#include <ArduinoJson.h>
#include <time.h>

bool MqttUplink::begin(const String& uri, const String& gateway, const String& credential) {
  if (!uri.startsWith("mqtts://")) return false;
  // CA provisioning is explicit; never disable certificate/hostname verification.
  File certificate = LittleFS.open("/mqtt-ca.pem", "r");
  if (!certificate) { Serial.println("[MQTT] Missing /mqtt-ca.pem; transport disabled."); return false; }
  ca = certificate.readString(); certificate.close();
  identity = gateway;
  prefix = "compallette/v1/gateways/" + identity;
  incoming = xQueueCreate(8, sizeof(Incoming));
  if (!incoming) return false;
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
  if (!client) return false;
  esp_mqtt_client_register_event(client, MQTT_EVENT_ANY, event, this);
  return esp_mqtt_client_start(client) == ESP_OK;
}

void MqttUplink::event(void* arg, esp_event_base_t, int32_t, void* data) {
  static_cast<MqttUplink*>(arg)->receive(static_cast<esp_mqtt_event_handle_t>(data));
}

void MqttUplink::receive(esp_mqtt_event_handle_t evt) {
  if (evt->event_id == MQTT_EVENT_CONNECTED) {
    connected = true;
    esp_mqtt_client_subscribe(client, (prefix + "/receipts").c_str(), 1);
    esp_mqtt_client_subscribe(client, (prefix + "/commands").c_str(), 1);
  } else if (evt->event_id == MQTT_EVENT_DISCONNECTED) connected = false;
  else if (evt->event_id == MQTT_EVENT_DATA) {
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
      xQueueSend(incoming, &message, 0);
    }
  }
}

void MqttUplink::update(OfflineBuffer& buffer, std::function<void(const String&)> downlink) {
  if (!client || !incoming) return;
  Incoming incomingMessage;
  while (xQueueReceive(incoming, &incomingMessage, 0) == pdTRUE) {
    StaticJsonDocument<2048> message;
    if (deserializeJson(message, incomingMessage.body)) continue;
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
        matched = message["status"] == "ok"
          && String(message["node_id"] | "") == String(eventJson["sender"] | "")
          && (message["seq"] | 0UL) == (eventJson["seq"] | 0UL)
          && String(message["event_type"] | "") == String(eventJson["type"] | "");
      }
      if (matched) { buffer.pop(); lastPublish = 0; }
    } else if (String(incomingMessage.topic).endsWith("/commands")) {
      const String kind = message["kind"] | "";
      // Require a trusted local time source; never execute commands with unknown expiry.
      if (time(nullptr) < 1700000000 || (message["expires_at"] | 0LL) <= time(nullptr)) continue;
      if (kind != "PROVISION" && kind != "DIAGNOSTIC") continue;
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
  if (esp_mqtt_client_enqueue(client, topic.c_str(), body.c_str(), body.length(), 1, 0, true) >= 0) lastPublish = millis();
  // Only a matching application receipt removes an event from the persistent buffer.
}
