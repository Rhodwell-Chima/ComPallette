#ifndef CAPTIVE_PORTAL_MANAGER_H
#define CAPTIVE_PORTAL_MANAGER_H

#include <Arduino.h>
#include <WiFi.h>
#include <WebServer.h>
#include <DNSServer.h>
#include "NodeConfigManager.h"
#include "SensorHAL.h"

// ============================================================================
// COMPALLETTE - LOCAL WI-FI CAPTIVE PORTAL (OPTION 3)
// ============================================================================
// Spins up a temporary SoftAP on the ESP32 ("Compallette-Setup-XXXX") with captive
// DNS hijacking on 192.168.4.1. Allows underground electricians and shift supervisors
// to dynamically commission or re-assign wearable tags and stationary anchors
// directly from any smartphone browser without burning firmware or needing surface Wi-Fi.

class CaptivePortalManager {
public:
  CaptivePortalManager();

  // Launches SoftAP and starts Web/DNS servers
  bool begin();

  // Non-blocking pump to handle incoming DNS and HTTP requests
  void update();

  // Shuts down SoftAP and servers to release Wi-Fi for mesh networking
  void stop();

  bool isActive() const { return _active; }

private:
  bool        _active;
  WebServer   _server;
  DNSServer   _dnsServer;
  uint32_t    _rebootTargetMs;
  bool        _rebootPending;

  // Web routes
  void handleRoot();
  void handleSave();
  void handleSensorApi();
  void handleNotFound();

  // Generates mobile-optimized HTML portal
  String buildPortalHtml();
};

extern CaptivePortalManager captivePortal;

#endif // CAPTIVE_PORTAL_MANAGER_H
