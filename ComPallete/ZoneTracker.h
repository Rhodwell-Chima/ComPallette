#ifndef ZONE_TRACKER_H
#define ZONE_TRACKER_H

#include <Arduino.h>

// ============================================================================
// COMPALLETTE - DYNAMIC ANCHOR PROXIMITY ZONE TRACKER (Option 1)
// ============================================================================
// Wearable miner tags automatically detect their physical subterranean zone
// by tracking periodic beacons from stationary tunnel anchors and gateways.
// ============================================================================

class ZoneTracker {
public:
  ZoneTracker();

  // Initialize with optional fallback zone (e.g. "UNASSIGNED")
  void begin(const char* initialZone = "UNASSIGNED");

  // Periodic housekeeping (checks anchor signal staleness / expiry)
  void update();

  // Ingest incoming beacon / heartbeat from a stationary anchor or gateway
  void handleAnchorBeacon(
    const char* anchorId,
    const char* zoneId,
    uint32_t anchorNodeId,
    int hopDistance = 1,
    int rssi = 0
  );

  // Active zone string for outgoing telemetry and alert message envelopes
  const char* getCurrentZone() const;

  // Spatial reference anchor details
  const char* getNearestAnchorId() const;
  uint32_t getNearestAnchorNodeId() const;
  uint32_t getLastHeardMs() const;
  uint32_t getTimeSinceLastBeaconMs() const;
  int getHopDistance() const;
  int getRssi() const;
  bool isAutoTracking() const;
  bool isStale() const;
  bool hasAnchor() const;

  // Manual test / simulation overrides (e.g. via Serial CLI on single-board bench)
  void setManualOverride(const char* zoneId);
  void resumeAutoTracking();

private:
  char     _currentZone[32];
  char     _nearestAnchorId[24];
  uint32_t _nearestAnchorNodeId;
  uint32_t _lastHeardMs;
  int      _hopDistance;
  int      _rssi;
  bool     _autoTracking;
  bool     _hasAnchor;
  bool     _staleLogged;
};

#endif // ZONE_TRACKER_H
