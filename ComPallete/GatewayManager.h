#ifndef GATEWAY_MANAGER_H
#define GATEWAY_MANAGER_H

#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <ESPmDNS.h>
#include "Config.h"

#if ENABLE_WEBSOCKET_UPLINK
#include <WebSocketsClient.h>
#endif

#include "Protocol.h"
#include "OfflineBuffer.h"

// ============================================================================
// COMPALLETTE - GATEWAY BRIDGE & UPLINK MANAGER
// ============================================================================
// Bridges painlessMesh subterranean packets to an external HTTPS/REST server
// or real-time bi-directional WebSocket connection with automated HTTP fallback.
// Observes the painlessMesh-managed Wi-Fi STA uplink, resolves mDNS hostnames,
// retries backend delivery, and flushes the offline buffer. painlessMesh owns
// station association and mesh reconnection on the shared ESP32 radio.

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

  // Initializes gateway transport after the caller has configured the
  // painlessMesh bridge station with stationManual().
  bool begin(
    const char* ssid = UPLINK_WIFI_SSID,
    const char* password = UPLINK_WIFI_PASSWORD,
    const char* backendUrl = BACKEND_BASE_URL,
    const char* apiKey = "",
    const char* deviceId = ACTIVE_DEVICE_ID,
    uint8_t meshChannel = MESH_CHANNEL
  );

  // Periodic non-blocking tick called from main loop or scheduler
  void update();

  // Ingests an incoming mesh packet, identifies priority, and enqueues to buffer
  void handleIncomingMeshPacket(uint32_t fromNodeId, const String& rawMsg);

  // Uplink state queries
  GatewayState getState() const { return m_state; }
  bool isConnected() const { return m_state == GW_STATE_CONNECTED; }
  bool isWebSocketConnected() const { return m_wsConnected; }
  const char* getStateString() const;

  // Downlink callback for re-broadcasting surface emergency packets to underground mesh
  typedef std::function<void(const String&)> DownlinkCallback;
  void setDownlinkCallback(DownlinkCallback cb) { m_downlinkCb = cb; }

  // Diagnostics & Manual Testing
  OfflineBuffer& getBuffer() { return m_buffer; }
  uint32_t getConsecutiveFailures() const { return m_consecutiveFailures; }
  uint32_t getCurrentBackoffMs() const { return m_currentBackoffMs; }
  const String& getBackendUrl() const { return m_backendUrl; }
  const String& getUplinkSsid() const { return m_ssid; }
  
  // mDNS resolution query (returns resolved IPAddress, or INADDR_NONE on error)
  IPAddress resolveMdns(const String& hostname);
  bool resolveMdnsHost(const String& rawUrl, String& outResolvedUrl);

  // Send an immediate test packet over HTTP
  bool sendDirectTestPacket(const String& jsonPayload, MessageType type = MSG_HEARTBEAT);

private:
  String      m_ssid;
  String      m_password;
  String      m_backendUrl;
  String      m_apiKey;
  String      m_deviceId;
  uint8_t     m_meshChannel;

  GatewayState m_state;
  OfflineBuffer m_buffer;

  uint32_t m_lastStateCheckMs;
  uint32_t m_lastTransmitMs;
  uint32_t m_backoffStartMs;
  uint32_t m_currentBackoffMs;
  uint32_t m_consecutiveFailures;

  // mDNS Resolution & Caching
  bool        m_mdnsInitialized;
  String      m_cachedHost;
  IPAddress   m_cachedIp;
  uint32_t    m_cacheExpireMs;

  // WebSocket Subsystem (Real-time Streaming with HTTP Fallback)
#if ENABLE_WEBSOCKET_UPLINK
  WebSocketsClient m_wsClient;
  bool             m_wsConnected;
  bool             m_wsInitialized;
  DownlinkCallback m_downlinkCb;

  void initWebSocket();
  void handleWsEvent(WStype_t type, uint8_t * payload, size_t length);
#else
  bool             m_wsConnected;
  DownlinkCallback m_downlinkCb;
#endif

  void checkConnection();
  bool forwardPacket(const BufferedItem& item);
  String resolveEndpoint(MessageType type);
  void triggerBackoff();
  void resetBackoff();
};

#endif // GATEWAY_MANAGER_H
