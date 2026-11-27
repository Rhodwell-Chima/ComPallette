#include <Arduino.h>
#include <esp_log.h>

static const char* const TAG = "CP_LOG_PROBE";

void setup() {
  Serial.begin(115200);
  const uint32_t started = millis();
  while (!Serial && millis() - started < 3000) delay(10);

  Serial.println("CP_PROBE_SERIAL_BEGIN");
  ESP_LOGE(TAG, "CP_PROBE_ERROR");
  ESP_LOGW(TAG, "CP_PROBE_WARNING");
  ESP_LOGI(TAG, "CP_PROBE_INFO");
  ESP_LOGD(TAG, "CP_PROBE_DEBUG");
  ESP_LOGV(TAG, "CP_PROBE_VERBOSE");
  Serial.println("CP_PROBE_SERIAL_END");
}

void loop() {}
