#ifndef ZONE_TRACKER_H
#define ZONE_TRACKER_H

#include <Arduino.h>
#include "Config.h"

// ============================================================================
// COMPALLETTE - DIRECT ANCHOR CONNECTION ZONE TRACKER
// ============================================================================
// Automatic zone tracking operates on the strict model:
// Wearable -> directly connected stationary anchor -> anchor's registered zone.
//
// Rules:
// 1. Direct radio/mesh adjacency only (hopDistance == 1). Routed multi-hop
//    packets or general mesh membership NEVER establish location.
// 2. Only stationary nodes (ROLE_STATIONARY_ANCHOR / GATEWAY) provide location.
//    Wearable relays carry messages but their location is never inherited.
// 3. Location states:
//    - CURRENT: Fresh qualifying direct-anchor evidence (<20s).
//    - TRANSITIONING: Handover in progress between zones.
//    - AMBIGUOUS: Available evidence cannot support one zone reliably.
//    - LAST_KNOWN: Previous direct link expired (>20s) or disconnected.
//    - UNKNOWN: No qualifying anchor has been seen.
// 4. Movement events are generated immediately upon confirmed zone change or
//    link state transition.
// ============================================================================

enum ZoneLinkState : uint8_t {
  ZONE_LINK_UNKNOWN = 0,
  ZONE_LINK_CURRENT = 1,
  ZONE_LINK_TRANSITIONING = 2,
  ZONE_LINK_AMBIGUOUS = 3,
  ZONE_LINK_LAST_KNOWN = 4
};

inline const char* zoneLinkStateToString(ZoneLinkState state) {
  switch (state) {
    case ZONE_LINK_CURRENT:       return "CURRENT";
    case ZONE_LINK_TRANSITIONING: return "TRANSITIONING";
    case ZONE_LINK_AMBIGUOUS:     return "AMBIGUOUS";
    case ZONE_LINK_LAST_KNOWN:    return "LAST_KNOWN";
    default:                      return "UNKNOWN";
  }
}

class ZoneTracker {
public:
  ZoneTracker();

  // Initialize tracker
  void begin(const char* initialZone = "UNASSIGNED");

  // Periodic housekeeping (checks 20s expiry and transition timeouts)
  void update();

  // Ingest incoming beacon from a node
  // Only qualifying direct stationary nodes will influence location!
  void handleAnchorBeacon(
    const char* anchorId,
    const char* zoneId,
    uint32_t anchorNodeId,
    int hopDistance,
    int rssi = 0,
    bool isStationary = true
  );

  // Ingest notification of direct link disconnection
  void handleDirectDisconnect(uint32_t disconnectedNodeId);

  // Current zone and state queries
  const char* getCurrentZone() const;
  ZoneLinkState getLinkState() const;
  const char* getLinkStateString() const;
  const char* getNearestAnchorId() const;
  uint32_t getNearestAnchorNodeId() const;
  uint32_t getLastHeardMs() const;
  uint32_t getTimeSinceLastBeaconMs() const;
  int getHopDistance() const;
  int getRssi() const;
  bool isAutoTracking() const;
  bool isStale() const;
  bool hasAnchor() const;

  // Immediate movement event check (returns true once per zone/state change)
  bool consumeMovementEvent();

  // Manual test / simulation overrides
  void setManualOverride(const char* zoneId);
  void resumeAutoTracking();

private:
  char          _currentZone[32];
  char          _nearestAnchorId[24];
  uint32_t      _nearestAnchorNodeId;
  ZoneLinkState _linkState;
  uint32_t      _lastHeardMs;
  int           _hopDistance;
  int           _rssi;
  bool          _autoTracking;
  bool          _movementEvent;

  // Handover evaluation state
  char          _candidateAnchorId[24];
  char          _candidateZone[32];
  uint32_t      _candidateNodeId;
  uint32_t      _candidateFirstHeardMs;
  int           _candidateRssi;
};

#endif // ZONE_TRACKER_H
