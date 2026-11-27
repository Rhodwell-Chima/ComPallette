#include "NodeConfigManager.h"
#include <esp_system.h>
#include <esp_mac.h>
#include <ArduinoJson.h>
#include "Logging.h"

static const char* const CONFIG_TAG = "CP_CONFIG";

// Global configuration manager instance
NodeConfigManager nodeConfigManager;

NodeConfigManager::NodeConfigManager() : _sequenceNext(1), _sequenceReservedThrough(0), _sequenceReady(false) {
  memset(&_config, 0, sizeof(_config));
}

void NodeConfigManager::initHardwareIdentity() {
  uint8_t mac[6];
  esp_efuse_mac_get_default(mac);

  // IEEE MAC string: "XX:XX:XX:XX:XX:XX"
  snprintf(_config.chip_mac, sizeof(_config.chip_mac),
           "%02X:%02X:%02X:%02X:%02X:%02X",
           mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);

  // Unique 6-character hex suffix from last 3 MAC octets: e.g. "8F4C2A"
  snprintf(_config.chip_id, sizeof(_config.chip_id),
           "%02X%02X%02X", mac[3], mac[4], mac[5]);
}

bool NodeConfigManager::begin() {
  initHardwareIdentity();
  _sequenceReady = _sequencePrefs.begin("compseq", false);
  const uint32_t persistedThrough = _sequenceReady ? _sequencePrefs.getULong("seq_hi", 0) : 0;
  _sequenceNext = persistedThrough + 1;
  _sequenceReservedThrough = persistedThrough;

  if (!_prefs.begin("compallette", false)) {
    ESP_LOGE(CONFIG_TAG, "Configuration NVS unavailable; loading defaults");
    load();
    return false;
  }

  const bool loaded = load();
  if (!loaded) {
    _config.is_provisioned = false;
    _config.mesh_configured = false;
    ESP_LOGW(CONFIG_TAG, "Configuration load failed; mesh and commissioning flags cleared");
  } else {
    ESP_LOGI(CONFIG_TAG, "Configuration loaded; role=%s", nodeRoleToString(_config.role));
  }
  printConfig();
  return loaded;
}

uint32_t NodeConfigManager::nextSequence() {
  if (!_sequenceReady) {
    static DiagnosticInterval<ARDUHAL_LOG_LEVEL_ERROR> sequenceLog;
    if (sequenceLog.ready()) ESP_LOGE(CONFIG_TAG, "Sequence NVS unavailable; event sequence allocation blocked");
    return 0;
  }
  if (_sequenceNext == 0 || _sequenceNext > _sequenceReservedThrough) {
    const uint32_t persistedThrough = _sequencePrefs.getULong("seq_hi", 0);
    const uint32_t reserveThrough = persistedThrough + 256;
    if (reserveThrough < persistedThrough || reserveThrough > 2147483647UL) {
      static DiagnosticInterval<ARDUHAL_LOG_LEVEL_ERROR> exhaustedLog;
      if (exhaustedLog.ready()) ESP_LOGE(CONFIG_TAG, "Event sequence space exhausted");
      return 0;
    }
    if (_sequencePrefs.putULong("seq_hi", reserveThrough) == 0) {
      static DiagnosticInterval<ARDUHAL_LOG_LEVEL_ERROR> reserveLog;
      if (reserveLog.ready()) ESP_LOGE(CONFIG_TAG, "Event sequence range reservation failed");
      return 0;
    }
    _sequenceNext = persistedThrough + 1;
    _sequenceReservedThrough = reserveThrough;
  }
  return _sequenceNext++;
}

bool NodeConfigManager::load() {
  // Check if node has ever been provisioned
  _config.is_provisioned = _prefs.getBool("prov", false);
  _config.mesh_configured = _prefs.getBool("mesh_ready", _config.is_provisioned);

  if (_config.is_provisioned) {
    String devId = _prefs.getString("dev_id", "");
    strncpy(_config.device_id, devId.c_str(), sizeof(_config.device_id) - 1);

    _config.role = (NodeRole)_prefs.getUChar("role", (uint8_t)ROLE_WEARABLE);

    String zone = _prefs.getString("zone", ACTIVE_ZONE_ID);
    strncpy(_config.zone_id, zone.c_str(), sizeof(_config.zone_id) - 1);

    String mSsid = _prefs.getString("m_ssid", MESH_PREFIX);
    strncpy(_config.mesh_prefix, mSsid.c_str(), sizeof(_config.mesh_prefix) - 1);

    String mPass = _prefs.getString("m_pass", MESH_PASSWORD);
    strncpy(_config.mesh_password, mPass.c_str(), sizeof(_config.mesh_password) - 1);

    _config.mesh_channel = _prefs.getUChar("m_chan", MESH_CHANNEL);

    String gwSsid = _prefs.getString("gw_ssid", UPLINK_WIFI_SSID);
    strncpy(_config.uplink_ssid, gwSsid.c_str(), sizeof(_config.uplink_ssid) - 1);

    String gwPass = _prefs.getString("gw_pass", UPLINK_WIFI_PASSWORD);
    strncpy(_config.uplink_password, gwPass.c_str(), sizeof(_config.uplink_password) - 1);

    String api = _prefs.getString("api_url", BACKEND_BASE_URL);
    strncpy(_config.backend_url, api.c_str(), sizeof(_config.backend_url) - 1);
    String apiKey = _prefs.getString("api_key", BACKEND_DEFAULT_API_KEY);
    strncpy(_config.backend_api_key, apiKey.c_str(), sizeof(_config.backend_api_key) - 1);

    _config.co_warning_ppm = _prefs.getFloat("co_warn", CO_THRESHOLD_WARNING_PPM);
    _config.co_critical_ppm = _prefs.getFloat("co_crit", CO_THRESHOLD_CRITICAL_PPM);
  } else {
    // Unprovisioned node: check if previous configuration exists to pre-fill setup portal
    String devId = _prefs.getString("dev_id", "");
    if (devId.length() > 0) {
      strncpy(_config.device_id, devId.c_str(), sizeof(_config.device_id) - 1);
    } else {
      snprintf(_config.device_id, sizeof(_config.device_id), "PROV-%s", _config.chip_id);
    }

    _config.role = (NodeRole)_prefs.getUChar("role", (uint8_t)ROLE_WEARABLE);

    if (_config.role == ROLE_WEARABLE) {
      strncpy(_config.zone_id, "UNASSIGNED", sizeof(_config.zone_id) - 1);
    } else {
      String zone = _prefs.getString("zone", ACTIVE_ZONE_ID);
      strncpy(_config.zone_id, zone.c_str(), sizeof(_config.zone_id) - 1);
    }

    String mSsid = _prefs.getString("m_ssid", MESH_PREFIX);
    strncpy(_config.mesh_prefix, mSsid.c_str(), sizeof(_config.mesh_prefix) - 1);

    String mPass = _prefs.getString("m_pass", MESH_PASSWORD);
    strncpy(_config.mesh_password, mPass.c_str(), sizeof(_config.mesh_password) - 1);

    _config.mesh_channel = _prefs.getUChar("m_chan", MESH_CHANNEL);

    String gwSsid = _prefs.getString("gw_ssid", UPLINK_WIFI_SSID);
    strncpy(_config.uplink_ssid, gwSsid.c_str(), sizeof(_config.uplink_ssid) - 1);

    String gwPass = _prefs.getString("gw_pass", UPLINK_WIFI_PASSWORD);
    strncpy(_config.uplink_password, gwPass.c_str(), sizeof(_config.uplink_password) - 1);

    String api = _prefs.getString("api_url", BACKEND_BASE_URL);
    strncpy(_config.backend_url, api.c_str(), sizeof(_config.backend_url) - 1);
    String apiKey = _prefs.getString("api_key", BACKEND_DEFAULT_API_KEY);
    strncpy(_config.backend_api_key, apiKey.c_str(), sizeof(_config.backend_api_key) - 1);

    _config.co_warning_ppm = _prefs.getFloat("co_warn", CO_THRESHOLD_WARNING_PPM);
    _config.co_critical_ppm = _prefs.getFloat("co_crit", CO_THRESHOLD_CRITICAL_PPM);
  }

  const String snapshot = _prefs.getString("config_v2", "");
  if (snapshot.length()) {
    StaticJsonDocument<2048> record;
    if (deserializeJson(record, snapshot) || record["schema"] != 2) return false;
    _config.mesh_configured = record["mesh_ready"] | false;
    _config.is_provisioned = record["prov"] | false;
    strlcpy(_config.device_id, record["dev_id"] | "", sizeof(_config.device_id));
    _config.role = static_cast<NodeRole>(record["role"].as<uint8_t>());
    strlcpy(_config.zone_id, record["zone"] | "UNASSIGNED", sizeof(_config.zone_id));
    strlcpy(_config.mesh_prefix, record["m_ssid"] | MESH_PREFIX, sizeof(_config.mesh_prefix));
    strlcpy(_config.mesh_password, record["m_pass"] | MESH_PASSWORD, sizeof(_config.mesh_password));
    _config.mesh_channel = record["m_chan"] | MESH_CHANNEL;
    strlcpy(_config.uplink_ssid, record["gw_ssid"] | "", sizeof(_config.uplink_ssid));
    strlcpy(_config.uplink_password, record["gw_pass"] | "", sizeof(_config.uplink_password));
    strlcpy(_config.backend_url, record["api_url"] | BACKEND_BASE_URL, sizeof(_config.backend_url));
    _config.co_warning_ppm = record["co_warn"] | CO_THRESHOLD_WARNING_PPM;
    _config.co_critical_ppm = record["co_crit"] | CO_THRESHOLD_CRITICAL_PPM;
    if (record.containsKey("api_key") && strlen(record["api_key"] | "") >= 32) {
      strlcpy(_config.backend_api_key, record["api_key"], sizeof(_config.backend_api_key));
    } else if (strlen(_config.backend_api_key) < 32) {
      strlcpy(_config.backend_api_key, BACKEND_DEFAULT_API_KEY, sizeof(_config.backend_api_key));
    }
  }

  // One NVS value makes the commissioned identity atomic across power loss.
  const String assignment = _prefs.getString("assignment", "");
  if (assignment.length()) {
    StaticJsonDocument<384> record;
    if (deserializeJson(record, assignment) || !record["id"].is<const char*>()
        || !record["zone"].is<const char*>()) return false;
    strlcpy(_config.device_id, record["id"], sizeof(_config.device_id));
    strlcpy(_config.zone_id, record["zone"], sizeof(_config.zone_id));
    _config.role = static_cast<NodeRole>(record["role"].as<uint8_t>());
    _config.co_warning_ppm = record["co_warn"];
    _config.co_critical_ppm = record["co_crit"];
    _config.is_provisioned = true;
  }
  return true;
}

bool NodeConfigManager::save(const NodeConfig& cfg, bool localReport) {
  StaticJsonDocument<2048> record;
  record["schema"] = 2;
  record["mesh_ready"] = cfg.mesh_configured;
  record["prov"] = cfg.is_provisioned;
  record["dev_id"] = cfg.device_id;
  record["role"] = static_cast<uint8_t>(cfg.role);
  record["zone"] = cfg.zone_id;
  record["m_ssid"] = cfg.mesh_prefix;
  record["m_pass"] = cfg.mesh_password;
  record["m_chan"] = cfg.mesh_channel;
  record["gw_ssid"] = cfg.uplink_ssid;
  record["gw_pass"] = cfg.uplink_password;
  record["api_url"] = cfg.backend_url;
  record["co_warn"] = cfg.co_warning_ppm;
  record["co_crit"] = cfg.co_critical_ppm;
  record["api_key"] = cfg.backend_api_key;
  String encoded;
  if (record.overflowed() || !serializeJson(record, encoded)
      || _prefs.putString("config_v2", encoded) != encoded.length()) {
    if (localReport) Serial.println("[NVS] Configuration write failed; previous settings retained.");
    else ESP_LOGE(CONFIG_TAG, "Configuration write failed; current settings retained");
    return false;
  }
  _config = cfg;

  if (localReport) {
    Serial.println("\n[NVS] New node configuration committed to persistent flash.");
    printConfig();
  } else {
    ESP_LOGI(CONFIG_TAG, "Configuration committed to NVS");
  }
  return true;
}

bool NodeConfigManager::setAssignment(const char* deviceId, NodeRole role, const char* zoneId, float coWarn, float coCrit) {
  if (!deviceId || !zoneId || !*deviceId || strlen(deviceId) >= sizeof(_config.device_id)
      || strlen(zoneId) >= sizeof(_config.zone_id)
      || (role != ROLE_WEARABLE && role != ROLE_STATIONARY_ANCHOR)) return false;
  StaticJsonDocument<384> record;
  record["id"] = deviceId;
  record["role"] = static_cast<uint8_t>(role);
  record["zone"] = role == ROLE_WEARABLE ? "UNASSIGNED" : zoneId;
  record["co_warn"] = coWarn;
  record["co_crit"] = coCrit;
  String encoded;
  if (record.overflowed() || !serializeJson(record, encoded)
      || _prefs.putString("assignment", encoded) != encoded.length()) return false;
  _config.is_provisioned = true;
  strlcpy(_config.device_id, deviceId, sizeof(_config.device_id));
  strlcpy(_config.zone_id, role == ROLE_WEARABLE ? "UNASSIGNED" : zoneId, sizeof(_config.zone_id));
  _config.role = role;
  _config.co_warning_ppm = coWarn;
  _config.co_critical_ppm = coCrit;

  ESP_LOGI(CONFIG_TAG, "Commissioning assignment committed; role=%s", nodeRoleToString(_config.role));
  return true;
}

void NodeConfigManager::clear() {
  if (!_prefs.clear()) { Serial.println("[NVS] Reset failed; stored configuration retained."); return; }
  _config.is_provisioned = false;
  _config.mesh_configured = false;
  _prefs.putBool("mesh_ready", false);
  snprintf(_config.device_id, sizeof(_config.device_id), "PROV-%s", _config.chip_id);
  _config.role = ROLE_WEARABLE;
  strncpy(_config.zone_id, "UNASSIGNED", sizeof(_config.zone_id) - 1);
  Serial.println("\n[NVS] FACTORY RESET: All persistent parameters wiped. Node uncommissioned.");
}

void NodeConfigManager::enterSetupMode(bool localReport) {
  NodeConfig setup = _config;
  setup.mesh_configured = false; setup.is_provisioned = false;
  if (!save(setup, localReport)) return;
  if (_prefs.isKey("assignment") && !_prefs.remove("assignment")) {
    if (localReport) Serial.println("[NVS] Cannot clear commissioning; setup mode refused.");
    else ESP_LOGE(CONFIG_TAG, "Could not clear saved commissioning assignment");
    return;
  }
  _config.is_provisioned = false;
  _config.mesh_configured = false;
  _prefs.putBool("mesh_ready", false);
  _prefs.putBool("prov", false);
  if (localReport) Serial.println("\n[NVS] SETUP MODE: Node uncommissioned. Preserved current configuration for SoftAP.");
  else ESP_LOGI(CONFIG_TAG, "Commissioning cleared for setup mode");
}

bool NodeConfigManager::loadGatewayCredential(const char* credential) {
  if (!credential || strlen(credential) < 32 || strlen(credential) >= sizeof(_config.backend_api_key)) return false;
  strlcpy(_config.backend_api_key, credential, sizeof(_config.backend_api_key));
  return true;
}

void NodeConfigManager::printConfig() {
  Serial.println("\n==============================================================");
  Serial.println("           COMPALLETTE DYNAMIC CONFIGURATION STATUS           ");
  Serial.println("==============================================================");
  Serial.printf("  Hardware Chip ID   : %s (MAC: %s)\n", _config.chip_id, _config.chip_mac);
  Serial.printf("  Provisioned State  : %s\n", _config.is_provisioned ? "COMMISSIONED (Production)" : "UNCOMMISSIONED (Setup Mode)");
  Serial.printf("  Active Device ID   : %s\n", _config.device_id);
  Serial.printf("  Assigned Role      : %s\n", nodeRoleToString(_config.role));
  if (_config.role == ROLE_WEARABLE) {
    Serial.println("  Observed Zone      : UNKNOWN (radio inference disabled)");
  } else {
    Serial.printf("  Installation Zone  : %s (Configured)\n", _config.zone_id);
  }
  Serial.printf("  Mesh Network       : %s (CH %d)\n", _config.mesh_prefix, _config.mesh_channel);
  if (_config.role == ROLE_GATEWAY) {
    Serial.printf("  Uplink Wi-Fi       : %s\n", _config.uplink_ssid);
    Serial.printf("  Backend REST URL   : %s\n", _config.backend_url);
  }
  Serial.println("==============================================================\n");
  Serial.flush();
}
