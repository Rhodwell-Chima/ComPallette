#ifndef NODE_CONFIG_MANAGER_H
#define NODE_CONFIG_MANAGER_H

#include <Arduino.h>
#include <Preferences.h>
#include "Config.h"

// ============================================================================
// COMPALLETTE - NODE CONFIGURATION MANAGER (NVS PERSISTENCE)
// ============================================================================
// Manages node operational parameters stored in ESP32 Flash Non-Volatile Storage (NVS).
// Allows runtime dynamic provisioning via Option 1 (OTA Mesh) and Option 3 (Captive Portal),
// eliminating the need to hardcode ("burn") worker IDs and roles into firmware binaries.

struct NodeConfig {
  bool      mesh_configured = false;
  bool      is_provisioned;            // True if configured, false if fresh out-of-box
  char      device_id[24];             // Assigned ID (e.g. "MINER-106" or "ANCHOR-LVL2")
  NodeRole  role;                      // ROLE_WEARABLE, ROLE_STATIONARY_ANCHOR, ROLE_GATEWAY
  char      zone_id[32];               // Physical mine zone name (e.g. "LEVEL-3-ACTIVE-STOPE")
  char      mesh_prefix[32];           // Mesh network prefix / SSID
  char      mesh_password[32];         // Mesh encryption key
  uint8_t   mesh_channel;              // Fixed Wi-Fi channel
  char      uplink_ssid[32];           // Surface Wi-Fi SSID (Gateway role only)
  char      uplink_password[64];       // Surface Wi-Fi Password (Gateway role only)
  char      backend_url[64];           // REST API URL
  char      backend_api_key[64];       // Gateway device credential
  float     co_warning_ppm;            // OSHA warning limit (ppm)
  float     co_critical_ppm;           // NIOSH evacuation limit (ppm)
  char      chip_id[16];               // Unique 6-hex factory chip identifier (e.g. "8F4C2A")
  char      chip_mac[20];              // Standard IEEE MAC string (e.g. "24:6F:28:8F:4C:2A")
};

class NodeConfigManager {
public:
  NodeConfigManager();

  // Initializes NVS and loads persistent parameters
  bool begin();

  // Load configuration from NVS partition
  bool load();

  // Save updated configuration structure to NVS
  bool save(const NodeConfig& cfg, bool localReport = false);

  // Set individual provisioning assignment and commit to NVS
  bool setAssignment(const char* deviceId, NodeRole role, const char* zoneId, float coWarn = 25.0f, float coCrit = 50.0f);

  // Returns a reboot-safe monotonically increasing event sequence. Reserves
  // sequence blocks in NVS to limit flash wear while preventing reuse.
  uint32_t nextSequence();

  // Erase all persistent configurations (Factory Reset)
  void clear();

  // Enter SoftAP setup mode (unprovisions node so portal starts, preserving current parameters)
  void enterSetupMode(bool localReport = false);

  // Accessors
  const NodeConfig& get() const { return _config; }
  bool meshConfigured() const { return _config.mesh_configured; }
  bool isProvisioned() const { return _config.is_provisioned; }
  const char* getDeviceId() const { return _config.device_id; }
  NodeRole getRole() const { return _config.role; }
  const char* getZoneId() const { return _config.zone_id; }
  const char* getChipId() const { return _config.chip_id; }
  const char* getChipMac() const { return _config.chip_mac; }
  const char* getMeshPrefix() const { return _config.mesh_prefix; }
  const char* getMeshPassword() const { return _config.mesh_password; }
  uint8_t getMeshChannel() const { return _config.mesh_channel; }
  const char* getUplinkSsid() const { return _config.uplink_ssid; }
  const char* getUplinkPassword() const { return _config.uplink_password; }
  const char* getBackendUrl() const { return _config.backend_url; }
  const char* getBackendApiKey() const { return _config.backend_api_key; }

  // Only the protected local file loader supplies gateway credentials.
  bool loadGatewayCredential(const char* credential);

  // Print diagnostic summary to Serial
  void printConfig();

private:
  Preferences _prefs;
  Preferences _sequencePrefs;
  NodeConfig  _config;
  uint32_t _sequenceNext;
  uint32_t _sequenceReservedThrough;
  bool _sequenceReady;

  // Reads hardware eFuse MAC to generate permanent hardware chip identity
  void initHardwareIdentity();
};

extern NodeConfigManager nodeConfigManager;

#endif // NODE_CONFIG_MANAGER_H
