#ifndef GATEWAY_MANAGER_H
#define GATEWAY_MANAGER_H

#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include "Config.h"
#include "Protocol.h"
#include "OfflineBuffer.h"

// ============================================================================
// COMPALLETTE - GATEWAY BRIDGE & UPLINK MANAGER
// ============================================================================
// Bridges painlessMesh subterranean packets to an external HTTPS/REST server.
// Manages Wi-Fi STA uplink, exponential backoff retries, and offline buffer flushes.

enum GatewayState {
  GW_STATE_DISCONNECTED = 0,
  GW_STATE_CONNECTING,
  GW_STATE_CONNECTED,
  GW_STATE_BACKOFF
};

class GatewayManager {
public:
  GatewayManager();
  ~GatewayManager();

  // Initializes gateway subsystem, offline buffer, and Wi-Fi uplink connection
  bool begin(
    const char* ssid = UPLINK_WIFI_SSID,
    const char* password = UPLINK_WIFI_PASSWORD,
    const char* backendUrl = BACKEND_BASE_URL,
    const char* apiKey = BACKEND_API_KEY
  );

  // Periodic non-blocking tick called from main loop or scheduler
  void update();

  // Ingests an incoming mesh packet, identifies priority, and enqueues to buffer
  void handleIncomingMeshPacket(uint32_t fromNodeId, const String& rawMsg);

  // Uplink state queries
  GatewayState getState() const { return m_state; }
  bool isConnected() const { return m_state == GW_STATE_CONNECTED; }
  const char* getStateString() const;

  // Diagnostics
  OfflineBuffer& getBuffer() { return m_buffer; }
  uint32_t getConsecutiveFailures() const { return m_consecutiveFailures; }
  uint32_t getCurrentBackoffMs() const { return m_currentBackoffMs; }

private:
  const char* m_ssid;
  const char* m_password;
  String      m_backendUrl;
  String      m_apiKey;

  GatewayState m_state;
  OfflineBuffer m_buffer;

  uint32_t m_lastStateCheckMs;
  uint32_t m_lastTransmitMs;
  uint32_t m_backoffStartMs;
  uint32_t m_currentBackoffMs;
  uint32_t m_consecutiveFailures;

  void checkConnection();
  bool forwardPacket(const BufferedItem& item);
  String resolveEndpoint(MessageType type);
  void triggerBackoff();
  void resetBackoff();
};

#endif // GATEWAY_MANAGER_H
