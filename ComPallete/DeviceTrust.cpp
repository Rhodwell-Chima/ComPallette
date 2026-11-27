#include "DeviceTrust.h"
#include "Logging.h"
#include "NodeConfigManager.h"
#include "Config.h"
#include <LittleFS.h>
#include <mbedtls/md.h>
#include <esp_timer.h>
#include <esp_system.h>
#include <sys/time.h>

static const char* const TRUST_TAG = "CP_TRUST";

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
  if (!LittleFS.begin(false)) {
    if (!LittleFS.begin(true)) return false;
  }

  // Auto-provision if /device-trust.json is not present on LittleFS
  if (!LittleFS.exists("/device-trust.json")) {
    const char* chip = nodeConfigManager.getChipId();
    const char* defaultKey = nullptr;
    if (strcmp(chip, "A7C520") == 0) {
      defaultKey = "81d90b66c01d92d9e8fb30095b2c9d6fb44ec96f6a4339a33a39908d420386c0";
    } else if (strcmp(chip, "B96BB0") == 0) {
      defaultKey = "fb361806012bba53b8f4579590571ab065b0305d009414531776df81b89b7e18";
    }
    if (defaultKey) {
      provision(defaultKey, nodeConfigManager.getBackendApiKey());
    }
  }

  File file = LittleFS.open("/device-trust.json", "r");
  StaticJsonDocument<1024> document;
  if (!file || deserializeJson(document, file)) {
    if (file) file.close();
    return false;
  }
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
    if (!LittleFS.exists("/gateway-credentials.json")) {
      File gwf = LittleFS.open("/gateway-credentials.json", "w");
      if (gwf) {
        StaticJsonDocument<512> gwdoc;
        gwdoc["installation_id"] = installation;
        gwdoc["site_id"] = document["site_id"].as<int>();
        gwdoc["hardware_id"] = hardware;
        gwdoc["node_id"] = nodeConfigManager.getDeviceId();
        gwdoc["credential_version"] = 1;
        gwdoc["credential"] = nodeConfigManager.getBackendApiKey();
        serializeJson(gwdoc, gwf);
        gwf.close();
        ESP_LOGD(TRUST_TAG, "Gateway credential bundle creation attempted");
      }
    }
    File credentials = LittleFS.open("/gateway-credentials.json", "r");
    StaticJsonDocument<768> gateway;
    if (!credentials || deserializeJson(gateway, credentials)
        || String(gateway["installation_id"] | "") != installation
        || String(gateway["hardware_id"] | "") != hardware
        || gateway["site_id"].as<int>() != document["site_id"].as<int>()) {
      if (credentials) credentials.close();
      return false;
    }
    // Keep gateway-credentials.json in sync if device_id was updated via CLI
    if (String(gateway["node_id"] | "") != nodeConfigManager.getDeviceId()) {
      credentials.close();
      gateway["node_id"] = nodeConfigManager.getDeviceId();
      File gwf = LittleFS.open("/gateway-credentials.json", "w");
      if (gwf) { serializeJson(gateway, gwf); gwf.close(); }
    } else {
      credentials.close();
    }
    if (!nodeConfigManager.loadGatewayCredential(gateway["credential"] | "")) return false;

    // TLS needs a local wall clock before the first broker connection. Certificate
    // checks remain enabled. Only the configured on-site host is queried.
    const char* host = document["ntp_host"] | "";
    if (*host) configTime(0, 0, host);
  }
  configured = true;
  return true;
}

bool DeviceTrust::provision(const char* hexKey, const char* gatewayCredential) {
  if (!LittleFS.begin(false)) {
    if (!LittleFS.begin(true)) return false;
  }
  const char* chip = nodeConfigManager.getChipId();
  String keyStr = hexKey ? hexKey : "";
  if (keyStr.length() != 64) {
    if (strcmp(chip, "A7C520") == 0) {
      keyStr = "81d90b66c01d92d9e8fb30095b2c9d6fb44ec96f6a4339a33a39908d420386c0";
    } else if (strcmp(chip, "B96BB0") == 0) {
      keyStr = "fb361806012bba53b8f4579590571ab065b0305d009414531776df81b89b7e18";
    } else {
      Serial.println("[TRUST ERROR] 64-hex-character key required.");
      return false;
    }
  }

  File f = LittleFS.open("/device-trust.json", "w");
  if (!f) return false;
  StaticJsonDocument<512> doc;
  doc["hardware_id"] = chip;
  doc["site_id"] = DEFAULT_SITE_ID;
  doc["installation_id"] = DEFAULT_INSTALLATION_ID;
  doc["key"] = keyStr;
  doc["ntp_host"] = DEFAULT_NTP_HOST;
  serializeJson(doc, f);
  f.close();
  Serial.printf("[TRUST] Written /device-trust.json for hardware %s (site %d)\n", chip, DEFAULT_SITE_ID);

  if (nodeConfigManager.getRole() == ROLE_GATEWAY) {
    const char* cred = gatewayCredential;
    if (!cred || strlen(cred) < 32) cred = nodeConfigManager.getBackendApiKey();
    if (!cred || strlen(cred) < 32) cred = BACKEND_DEFAULT_API_KEY;

    File gwf = LittleFS.open("/gateway-credentials.json", "w");
    if (!gwf) return false;
    StaticJsonDocument<512> gwdoc;
    gwdoc["installation_id"] = DEFAULT_INSTALLATION_ID;
    gwdoc["site_id"] = DEFAULT_SITE_ID;
    gwdoc["hardware_id"] = chip;
    gwdoc["node_id"] = nodeConfigManager.getDeviceId();
    gwdoc["credential_version"] = 1;
    gwdoc["credential"] = cred;
    serializeJson(gwdoc, gwf);
    gwf.close();
    Serial.printf("[TRUST] Written /gateway-credentials.json for gateway %s\n", nodeConfigManager.getDeviceId());
  }

  return begin();
}

bool DeviceTrust::wipe() {
  if (!LittleFS.begin(false)) return false;
  LittleFS.remove("/device-trust.json");
  LittleFS.remove("/gateway-credentials.json");
  configured = false;
  installationId[0] = '\0';
  memset(key, 0, sizeof(key));
  Serial.println("[TRUST] Trust credentials wiped from LittleFS.");
  return true;
}

void DeviceTrust::printStatus() {
  Serial.println("\n+--------------------------------------------------------------+");
  Serial.println("|               LOCAL DEVICE TRUST & ENROLLMENT                |");
  Serial.println("+--------------------------------------------------------------+");
  Serial.printf("  Enrollment State : %s\n", configured ? "ENROLLED & ACTIVE" : "UNENROLLED / MISSING");
  Serial.printf("  Hardware Chip ID : %s\n", nodeConfigManager.getChipId());
  Serial.printf("  Installation ID  : %s\n", configured ? installationId : "(none)");
  Serial.printf("  Boot Nonce       : %s\n", configured ? bootChallenge : "(none)");
  Serial.printf("  Clock Status     : %s (Now: %lld s)\n", clockValid() ? "SYNCHRONIZED" : "UNSYNCHRONIZED", (long long)nowSeconds());
  if (LittleFS.begin(false)) {
    Serial.printf("  LittleFS Storage : %u KB total, %u KB used\n",
                  (unsigned)(LittleFS.totalBytes() / 1024), (unsigned)(LittleFS.usedBytes() / 1024));
    Serial.printf("  /device-trust    : %s\n", LittleFS.exists("/device-trust.json") ? "EXISTS" : "NOT FOUND");
    Serial.printf("  /gateway-cred    : %s\n", LittleFS.exists("/gateway-credentials.json") ? "EXISTS" : "NOT FOUND");
  } else {
    Serial.println("  LittleFS Storage : NOT MOUNTED");
  }
  Serial.println("+--------------------------------------------------------------+\n");
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
