#pragma once
#include <Arduino.h>
#include <mqtt_client.h>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>
#include <functional>
#include "OfflineBuffer.h"

// All buffer mutations and mesh callbacks run on the Arduino task, never the MQTT task.
class MqttUplink {
public:
  bool begin(const String& uri, const String& gateway, const String& credential);
  void update(OfflineBuffer& buffer, std::function<void(const String&)> downlink);
  bool isConnected() const { return connected; }
private:
  struct Incoming { char topic[160]; char body[2048]; };
  esp_mqtt_client_handle_t client = nullptr;
  QueueHandle_t incoming = nullptr;
  String ca, identity, prefix, partialTopic, partialBody;
  volatile bool connected = false;
  uint32_t lastPublish = 0;
  static void event(void* arg, esp_event_base_t base, int32_t id, void* data);
  void receive(esp_mqtt_event_handle_t event);
};
