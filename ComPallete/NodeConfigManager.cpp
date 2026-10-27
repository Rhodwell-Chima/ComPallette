#include "NodeConfigManager.h"
#include <esp_system.h>
#include <esp_mac.h>

// Global configuration manager instance
NodeConfigManager nodeConfigManager;

NodeConfigManager::NodeConfigManager() {
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

  if (!_prefs.begin("compallette", false)) {
    Serial.println("[NVS] Warning: Failed to open NVS namespace 'compallette'. Using factory defaults.");
    load();
    return false;
  }

  load();
  printConfig();
  return true;
}

bool NodeConfigManager::load() {
  // Check if node has ever been provisioned
  _config.is_provisioned = _prefs.getBool("prov", false);

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

    String zone = _prefs.getString("zone", "UNASSIGNED");
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

    _config.co_warning_ppm = _prefs.getFloat("co_warn", CO_THRESHOLD_WARNING_PPM);
    _config.co_critical_ppm = _prefs.getFloat("co_crit", CO_THRESHOLD_CRITICAL_PPM);
  }

  return true;
}

bool NodeConfigManager::save(const NodeConfig& cfg) {
  _config = cfg;
  _config.is_provisioned = true;

  _prefs.putBool("prov", true);
  _prefs.putString("dev_id", _config.device_id);
  _prefs.putUChar("role", (uint8_t)_config.role);
  _prefs.putString("zone", _config.zone_id);
  _prefs.putString("m_ssid", _config.mesh_prefix);
  _prefs.putString("m_pass", _config.mesh_password);
  _prefs.putUChar("m_chan", _config.mesh_channel);
  _prefs.putString("gw_ssid", _config.uplink_ssid);
  _prefs.putString("gw_pass", _config.uplink_password);
  _prefs.putString("api_url", _config.backend_url);
  _prefs.putFloat("co_warn", _config.co_warning_ppm);
  _prefs.putFloat("co_crit", _config.co_critical_ppm);

  Serial.println("\n[NVS] New node configuration committed to persistent flash.");
  printConfig();
  return true;
}

bool NodeConfigManager::setAssignment(const char* deviceId, NodeRole role, const char* zoneId, float coWarn, float coCrit) {
  _config.is_provisioned = true;
  strncpy(_config.device_id, deviceId, sizeof(_config.device_id) - 1);
  _config.role = role;
  strncpy(_config.zone_id, zoneId, sizeof(_config.zone_id) - 1);
  _config.co_warning_ppm = coWarn;
  _config.co_critical_ppm = coCrit;

  _prefs.putBool("prov", true);
  _prefs.putString("dev_id", _config.device_id);
  _prefs.putUChar("role", (uint8_t)_config.role);
  _prefs.putString("zone", _config.zone_id);
  _prefs.putFloat("co_warn", _config.co_warning_ppm);
  _prefs.putFloat("co_crit", _config.co_critical_ppm);

  Serial.printf("\n[NVS] Node commissioned successfully: ID=%s, Role=%s, Zone=%s\n",
                _config.device_id, nodeRoleToString(_config.role), _config.zone_id);
  return true;
}

void NodeConfigManager::clear() {
  _prefs.clear();
  _config.is_provisioned = false;
  snprintf(_config.device_id, sizeof(_config.device_id), "PROV-%s", _config.chip_id);
  _config.role = ROLE_WEARABLE;
  strncpy(_config.zone_id, "UNASSIGNED", sizeof(_config.zone_id) - 1);
  Serial.println("\n[NVS] FACTORY RESET: All persistent parameters wiped. Node uncommissioned.");
}

void NodeConfigManager::enterSetupMode() {
  _config.is_provisioned = false;
  _prefs.putBool("prov", false);
  Serial.println("\n[NVS] SETUP MODE: Node uncommissioned. Preserved current configuration for SoftAP.");
}

void NodeConfigManager::printConfig() {
  Serial.println("\n==============================================================");
  Serial.println("           COMPALLETTE DYNAMIC CONFIGURATION STATUS           ");
  Serial.println("==============================================================");
  Serial.printf("  Hardware Chip ID   : %s (MAC: %s)\n", _config.chip_id, _config.chip_mac);
  Serial.printf("  Provisioned State  : %s\n", _config.is_provisioned ? "COMMISSIONED (Production)" : "UNCOMMISSIONED (Setup Mode)");
  Serial.printf("  Active Device ID   : %s\n", _config.device_id);
  Serial.printf("  Assigned Role      : %s\n", nodeRoleToString(_config.role));
  Serial.printf("  Tunnel Zone        : %s\n", _config.zone_id);
  Serial.printf("  Mesh Network       : %s (CH %d)\n", _config.mesh_prefix, _config.mesh_channel);
  if (_config.role == ROLE_GATEWAY) {
    Serial.printf("  Uplink Wi-Fi       : %s\n", _config.uplink_ssid);
    Serial.printf("  Backend REST URL   : %s\n", _config.backend_url);
  }
  Serial.println("==============================================================\n");
  Serial.flush();
}
