#include "RadioDiagnostics.h"

#if ENABLE_RADIO_DIAGNOSTICS
#include <esp_wifi.h>

namespace {
constexpr uint32_t SAMPLE_INTERVAL_MS = 5000;
uint32_t lastSampleMs = 0;
bool identityLogged = false;

void printMac(const uint8_t* mac) {
  Serial.printf("%02X:%02X:%02X:%02X:%02X:%02X",
                mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
}
}
#endif

void radioDiagnosticsUpdate(uint32_t meshNodeId, const char* deviceId) {
#if ENABLE_RADIO_DIAGNOSTICS
  const uint32_t now = millis();
  if (now - lastSampleMs < SAMPLE_INTERVAL_MS) return;
  lastSampleMs = now;

  if (!identityLogged) {
    uint8_t staMac[6]{};
    uint8_t apMac[6]{};
    const esp_err_t staResult = esp_wifi_get_mac(WIFI_IF_STA, staMac);
    const esp_err_t apResult = esp_wifi_get_mac(WIFI_IF_AP, apMac);
    Serial.printf("RADIO,identity,%s,%u,%lu,sta=", deviceId, meshNodeId, (unsigned long)now);
    if (staResult == ESP_OK) printMac(staMac); else Serial.printf("error:%d", (int)staResult);
    Serial.printf(",ap=");
    if (apResult == ESP_OK) printMac(apMac); else Serial.printf("error:%d", (int)apResult);
    Serial.println();
    identityLogged = true;
  }

  wifi_ap_record_t parent{};
  const esp_err_t parentResult = esp_wifi_sta_get_ap_info(&parent);
  if (parentResult == ESP_OK) {
    Serial.printf("RADIO,parent,%s,%u,%lu,", deviceId, meshNodeId, (unsigned long)now);
    printMac(parent.bssid);
    Serial.printf(",%d,%u\n", parent.rssi, parent.primary);
  } else {
    Serial.printf("RADIO,parent,%s,%u,%lu,unavailable,%d\n",
                  deviceId, meshNodeId, (unsigned long)now, (int)parentResult);
  }

  wifi_sta_list_t children{};
  const esp_err_t childResult = esp_wifi_ap_get_sta_list(&children);
  if (childResult == ESP_OK) {
    for (int i = 0; i < children.num; ++i) {
      Serial.printf("RADIO,child,%s,%u,%lu,", deviceId, meshNodeId, (unsigned long)now);
      printMac(children.sta[i].mac);
      Serial.printf(",%d\n", children.sta[i].rssi);
    }
  } else {
    Serial.printf("RADIO,children,%s,%u,%lu,unavailable,%d\n",
                  deviceId, meshNodeId, (unsigned long)now, (int)childResult);
  }
#else
  (void)meshNodeId;
  (void)deviceId;
#endif
}
