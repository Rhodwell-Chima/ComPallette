#include "DeviceTrust.h"
#include "NodeConfigManager.h"
#include <LittleFS.h>
#include <mbedtls/md.h>
#include <esp_timer.h>
#include <esp_system.h>
#include <sys/time.h>

namespace {
uint8_t key[32] = {};
char installationId[37] = {};
char bootChallenge[33] = {};
char syncChallenge[33] = {};
bool configured = false;
uint32_t requestAt = 0;
int64_t synchronizedAt = 0;
int64_t synchronizedEpochMs = 0;

int hexValue(char value) {
  if (value >= '0' && value <= '9') return value - '0';
  if (value >= 'a' && value <= 'f') return value - 'a' + 10;
  if (value >= 'A' && value <= 'F') return value - 'A' + 10;
  return -1;
}
void nonce(char* output) {
  uint8_t bytes[16]; esp_fill_random(bytes, sizeof(bytes));
  for (size_t i = 0; i < sizeof(bytes); ++i) sprintf(output + i * 2, "%02x", bytes[i]);
}
bool digest(const String& input, char* output) {
  uint8_t bytes[32];
  if (mbedtls_md_hmac(mbedtls_md_info_from_type(MBEDTLS_MD_SHA256), key, sizeof(key),
                      reinterpret_cast<const uint8_t*>(input.c_str()), input.length(), bytes)) return false;
  for (size_t i = 0; i < sizeof(bytes); ++i) sprintf(output + i * 2, "%02x", bytes[i]);
  return true;
}
}

bool DeviceTrust::begin() {
  configured = false;
  if (!LittleFS.begin(false)) return false;
  File file = LittleFS.open("/device-trust.json", "r");
  StaticJsonDocument<1024> document;
  if (!file || deserializeJson(document, file)) return false;
  file.close();
  const String hardware = document["hardware_id"] | "";
  const String installation = document["installation_id"] | "";
  const String hex = document["key"] | "";
  if (hardware != nodeConfigManager.getChipId() || installation.length() != 36 || hex.length() != 64) return false;
  for (size_t i = 0; i < sizeof(key); ++i) {
    int high = hexValue(hex[i * 2]), low = hexValue(hex[i * 2 + 1]);
    if (high < 0 || low < 0) return false;
    key[i] = (high << 4) | low;
  }
  strlcpy(installationId, installation.c_str(), sizeof(installationId));
  nonce(bootChallenge);
  if (nodeConfigManager.getRole() == ROLE_GATEWAY) {
    File credentials = LittleFS.open("/gateway-credentials.json", "r");
    StaticJsonDocument<768> gateway;
    if (!credentials || deserializeJson(gateway, credentials)
        || String(gateway["installation_id"] | "") != installation
        || String(gateway["hardware_id"] | "") != hardware
        || String(gateway["node_id"] | "") != nodeConfigManager.getDeviceId()
        || gateway["site_id"].as<int>() != document["site_id"].as<int>()
        || !nodeConfigManager.loadGatewayCredential(gateway["credential"] | "")) return false;
    credentials.close();
    // TLS needs a local wall clock before the first broker connection. Certificate
    // checks remain enabled. Only the configured on-site host is queried.
    const char* host = document["ntp_host"] | "";
    if (*host) configTime(0, 0, host);
  }
  configured = true;
  return true;
}
bool DeviceTrust::ready() { return configured; }
const char* DeviceTrust::installation() { return installationId; }
const char* DeviceTrust::bootNonce() { return bootChallenge; }
bool DeviceTrust::clockValid() {
  return configured && synchronizedEpochMs > 0 && esp_timer_get_time() - synchronizedAt < 90000000LL;
}
int64_t DeviceTrust::nowSeconds() {
  return clockValid() ? (synchronizedEpochMs + (esp_timer_get_time() - synchronizedAt) / 1000) / 1000 : 0;
}
void DeviceTrust::sign(JsonDocument& body, JsonObject frame) {
  if (!configured) return;
  body["installation_id"] = installationId;
  body["hardware_id"] = nodeConfigManager.getChipId();
  body["boot_nonce"] = bootChallenge;
  String encoded; serializeJson(body, encoded);
  char mac[65];
  if (!digest(encoded, mac)) return;
  frame["signed_body"] = encoded;
  frame["mac"] = mac;
  frame["hardware_id"] = nodeConfigManager.getChipId();
}
void DeviceTrust::clockRequest(JsonObject payload) {
  if (!configured) return;
  nonce(syncChallenge); requestAt = millis();
  StaticJsonDocument<512> body;
  body["kind"] = "TIME_REQUEST";
  body["sync_nonce"] = syncChallenge;
  sign(body, payload["clock_request"].to<JsonObject>());
}
bool DeviceTrust::decode(JsonVariantConst frame, JsonDocument& body) {
  if (!configured || !frame["signed_body"].is<const char*>() || !frame["mac"].is<const char*>()) return false;
  String encoded = frame["signed_body"].as<String>();
  String supplied = frame["mac"].as<String>();
  if (encoded.length() > 1536 || supplied.length() != 64) return false;
  char expected[65];
  if (!digest(encoded, expected)) return false;
  uint8_t difference = 0;
  for (size_t i = 0; i < 64; ++i) difference |= expected[i] ^ supplied[i];
  if (difference || deserializeJson(body, encoded)) return false;
  return String(body["installation_id"] | "") == installationId
    && String(body["hardware_id"] | "") == nodeConfigManager.getChipId()
    && String(body["boot_nonce"] | "") == bootChallenge;
}
bool DeviceTrust::applyTime(JsonVariantConst body) {
  if (String(body["kind"] | "") != "TIME_RESPONSE" || !syncChallenge[0]
      || String(body["sync_nonce"] | "") != syncChallenge || millis() - requestAt > 15000) return false;
  int64_t epoch = body["server_time_ms"] | 0LL;
  if (epoch < 1700000000000LL) return false;
  synchronizedEpochMs = epoch;
  synchronizedAt = esp_timer_get_time();
  syncChallenge[0] = 0; // A signed response is accepted once, for this challenge.
  timeval value = { static_cast<time_t>(epoch / 1000), static_cast<suseconds_t>((epoch % 1000) * 1000) };
  settimeofday(&value, nullptr);
  return true;
}
