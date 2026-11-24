#include "ZoneTracker.h"

#define ZONE_DIRECT_EXPIRY_MS       20000   // 20s direct anchor evidence expiry
#define ZONE_HANDOVER_EVAL_MS        1500   // 1.5s stable candidate observation window
#define ZONE_COMPLETE_EXPIRY_MS    900000   // 15 minutes before falling to UNKNOWN

ZoneTracker::ZoneTracker()
  : _nearestAnchorNodeId(0),
    _linkState(ZONE_LINK_UNKNOWN),
    _lastHeardMs(0),
    _hopDistance(99),
    _rssi(0),
    _autoTracking(true),
    _movementEvent(false),
    _candidateNodeId(0),
    _candidateFirstHeardMs(0),
    _candidateRssi(0) {
  strncpy(_currentZone, "UNASSIGNED", sizeof(_currentZone) - 1);
  _currentZone[sizeof(_currentZone) - 1] = '\0';
  strncpy(_nearestAnchorId, "NONE", sizeof(_nearestAnchorId) - 1);
  _nearestAnchorId[sizeof(_nearestAnchorId) - 1] = '\0';
  strncpy(_candidateAnchorId, "NONE", sizeof(_candidateAnchorId) - 1);
  _candidateAnchorId[sizeof(_candidateAnchorId) - 1] = '\0';
  strncpy(_candidateZone, "UNASSIGNED", sizeof(_candidateZone) - 1);
  _candidateZone[sizeof(_candidateZone) - 1] = '\0';
}

void ZoneTracker::begin(const char* initialZone) {
  if (initialZone && strlen(initialZone) > 0 && strcmp(initialZone, "UNASSIGNED") != 0 && strcmp(initialZone, "AUTO_DETECT") != 0) {
    strncpy(_currentZone, initialZone, sizeof(_currentZone) - 1);
  } else {
    strncpy(_currentZone, "UNASSIGNED", sizeof(_currentZone) - 1);
  }
  _currentZone[sizeof(_currentZone) - 1] = '\0';
  _nearestAnchorNodeId = 0;
  strncpy(_nearestAnchorId, "NONE", sizeof(_nearestAnchorId) - 1);
  _nearestAnchorId[sizeof(_nearestAnchorId) - 1] = '\0';
  _linkState = (strcmp(_currentZone, "UNASSIGNED") == 0) ? ZONE_LINK_UNKNOWN : ZONE_LINK_LAST_KNOWN;
  _lastHeardMs = 0;
  _hopDistance = 99;
  _rssi = 0;
  _autoTracking = true;
  _movementEvent = false;
  _candidateNodeId = 0;
  _candidateFirstHeardMs = 0;
}

void ZoneTracker::update() {
  if (!_autoTracking) return;

  uint32_t now = millis();

  // 1. Check 20-second direct link expiry
  if (_linkState == ZONE_LINK_CURRENT) {
    if (now - _lastHeardMs >= ZONE_DIRECT_EXPIRY_MS) {
      _linkState = ZONE_LINK_LAST_KNOWN;
      _movementEvent = true;
      Serial.println("\n--------------------------------------------------------------");
      Serial.printf("[ZONE EXPIRED] Direct anchor beacon from %s timed out (> %u s)!\n",
                    _nearestAnchorId, (unsigned)(ZONE_DIRECT_EXPIRY_MS / 1000));
      Serial.printf("               Location degraded to LAST_KNOWN: %s\n", _currentZone);
      Serial.println("--------------------------------------------------------------");
    }
  } else if (_linkState == ZONE_LINK_TRANSITIONING) {
    // If handover candidate took too long to confirm, evaluate
    if (_candidateNodeId != 0 && (now - _candidateFirstHeardMs >= ZONE_HANDOVER_EVAL_MS)) {
      // Handover confirmed!
      strncpy(_currentZone, _candidateZone, sizeof(_currentZone) - 1);
      _currentZone[sizeof(_currentZone) - 1] = '\0';
      strncpy(_nearestAnchorId, _candidateAnchorId, sizeof(_nearestAnchorId) - 1);
      _nearestAnchorId[sizeof(_nearestAnchorId) - 1] = '\0';
      _nearestAnchorNodeId = _candidateNodeId;
      _lastHeardMs = now;
      _rssi = _candidateRssi;
      _linkState = ZONE_LINK_CURRENT;
      _movementEvent = true;
      _candidateNodeId = 0;
      _candidateFirstHeardMs = 0;

      Serial.println("\n==============================================================");
      Serial.printf("[ZONE HANDOVER COMPLETE] Transitioned into: %s\n", _currentZone);
      Serial.printf("  |-- Direct Anchor : %s (Node: %u | RSSI: %d dBm)\n",
                    _nearestAnchorId, _nearestAnchorNodeId, _rssi);
      Serial.println("==============================================================");
    }
  } else if (_linkState == ZONE_LINK_LAST_KNOWN) {
    if (_lastHeardMs > 0 && (now - _lastHeardMs >= ZONE_COMPLETE_EXPIRY_MS)) {
      _linkState = ZONE_LINK_UNKNOWN;
      strncpy(_currentZone, "UNASSIGNED", sizeof(_currentZone) - 1);
      _movementEvent = true;
    }
  }
}

void ZoneTracker::handleAnchorBeacon(
  const char* anchorId,
  const char* zoneId,
  uint32_t anchorNodeId,
  int hopDistance,
  int rssi,
  bool isStationary
) {
  if (!_autoTracking) return;

  // RULE 1: Only stationary nodes establish location.
  // Wearable relays carry messages, but their location is never inherited!
  if (!isStationary) {
    return;
  }

  // RULE 2: Direct radio link only (hopDistance == 1).
  // Multi-hop routed packets cannot establish direct proximity.
  if (hopDistance != 1) {
    return;
  }

  if (!zoneId || strlen(zoneId) == 0 || strcmp(zoneId, "UNASSIGNED") == 0) {
    return;
  }

  uint32_t now = millis();

  // If no anchor currently associated or state is LAST_KNOWN / UNKNOWN:
  if (_linkState == ZONE_LINK_UNKNOWN || _linkState == ZONE_LINK_LAST_KNOWN) {
    bool zoneChanged = (strncmp(_currentZone, zoneId, sizeof(_currentZone)) != 0);
    strncpy(_currentZone, zoneId, sizeof(_currentZone) - 1);
    _currentZone[sizeof(_currentZone) - 1] = '\0';
    if (anchorId && strlen(anchorId) > 0) {
      strncpy(_nearestAnchorId, anchorId, sizeof(_nearestAnchorId) - 1);
      _nearestAnchorId[sizeof(_nearestAnchorId) - 1] = '\0';
    }
    _nearestAnchorNodeId = anchorNodeId;
    _lastHeardMs = now;
    _hopDistance = 1;
    _rssi = rssi;
    _linkState = ZONE_LINK_CURRENT;
    _movementEvent = true;

    Serial.println("\n==============================================================");
    Serial.printf("[ZONE ACQUIRED] Direct stationary anchor acquired: %s\n", _nearestAnchorId);
    Serial.printf("  |-- Physical Zone: %s (Changed: %s)\n", _currentZone, zoneChanged ? "YES" : "NO");
    Serial.printf("  |-- Signal RSSI  : %d dBm (Direct 1-Hop)\n", _rssi);
    Serial.println("==============================================================");
    return;
  }

  // If this beacon is from our current direct anchor:
  if (_nearestAnchorNodeId == anchorNodeId ||
      (anchorId && strcmp(_nearestAnchorId, anchorId) == 0)) {
    _lastHeardMs = now;
    _rssi = rssi;
    _hopDistance = 1;
    // If we were transitioning and our current anchor refreshed with strong signal, clear candidate
    if (_linkState == ZONE_LINK_TRANSITIONING && rssi > -70) {
      _candidateNodeId = 0;
      _candidateFirstHeardMs = 0;
      _linkState = ZONE_LINK_CURRENT;
    }
    return;
  }

  // If this beacon is from a DIFFERENT direct stationary anchor:
  bool sameZone = (strncmp(_currentZone, zoneId, sizeof(_currentZone)) == 0);
  if (sameZone) {
    // Both anchors belong to the same zone; switch anchor reference if newer has better RSSI
    if (rssi > _rssi || (now - _lastHeardMs > 5000)) {
      if (anchorId && strlen(anchorId) > 0) {
        strncpy(_nearestAnchorId, anchorId, sizeof(_nearestAnchorId) - 1);
        _nearestAnchorId[sizeof(_nearestAnchorId) - 1] = '\0';
      }
      _nearestAnchorNodeId = anchorNodeId;
      _lastHeardMs = now;
      _rssi = rssi;
    }
    return;
  }

  // Candidate anchor is in a DIFFERENT zone -> Handover evaluation!
  if (_linkState == ZONE_LINK_CURRENT) {
    // If current anchor has not been heard in >= 5000ms OR candidate RSSI is much stronger:
    if ((now - _lastHeardMs >= 5000) || (rssi > _rssi + 8)) {
      // Immediate handover
      strncpy(_currentZone, zoneId, sizeof(_currentZone) - 1);
      _currentZone[sizeof(_currentZone) - 1] = '\0';
      if (anchorId && strlen(anchorId) > 0) {
        strncpy(_nearestAnchorId, anchorId, sizeof(_nearestAnchorId) - 1);
        _nearestAnchorId[sizeof(_nearestAnchorId) - 1] = '\0';
      }
      _nearestAnchorNodeId = anchorNodeId;
      _lastHeardMs = now;
      _rssi = rssi;
      _linkState = ZONE_LINK_CURRENT;
      _movementEvent = true;
      _candidateNodeId = 0;
      _candidateFirstHeardMs = 0;

      Serial.println("\n==============================================================");
      Serial.printf("[ZONE HANDOVER] Direct crossing detected into: %s\n", _currentZone);
      Serial.printf("  |-- New Anchor : %s (RSSI: %d dBm)\n", _nearestAnchorId, _rssi);
      Serial.println("==============================================================");
    } else {
      // Start transition state
      _linkState = ZONE_LINK_TRANSITIONING;
      _movementEvent = true;
      _candidateNodeId = anchorNodeId;
      if (anchorId) strncpy(_candidateAnchorId, anchorId, sizeof(_candidateAnchorId) - 1);
      strncpy(_candidateZone, zoneId, sizeof(_candidateZone) - 1);
      _candidateFirstHeardMs = now;
      _candidateRssi = rssi;
    }
  } else if (_linkState == ZONE_LINK_TRANSITIONING) {
    // If candidate has been observed consistently
    if (_candidateNodeId == anchorNodeId) {
      _candidateRssi = rssi;
      if (now - _candidateFirstHeardMs >= ZONE_HANDOVER_EVAL_MS) {
        strncpy(_currentZone, _candidateZone, sizeof(_currentZone) - 1);
        _currentZone[sizeof(_currentZone) - 1] = '\0';
        strncpy(_nearestAnchorId, _candidateAnchorId, sizeof(_nearestAnchorId) - 1);
        _nearestAnchorId[sizeof(_nearestAnchorId) - 1] = '\0';
        _nearestAnchorNodeId = _candidateNodeId;
        _lastHeardMs = now;
        _rssi = _candidateRssi;
        _linkState = ZONE_LINK_CURRENT;
        _movementEvent = true;
        _candidateNodeId = 0;
        _candidateFirstHeardMs = 0;
      }
    }
  }
}

void ZoneTracker::handleDirectDisconnect(uint32_t disconnectedNodeId) {
  if (_nearestAnchorNodeId != 0 && disconnectedNodeId == _nearestAnchorNodeId) {
    _linkState = ZONE_LINK_LAST_KNOWN;
    _movementEvent = true;
    Serial.println("\n[ZONE DISCONNECT] Immediate link disconnection from active anchor!");
  }
  if (_candidateNodeId != 0 && disconnectedNodeId == _candidateNodeId) {
    _candidateNodeId = 0;
    _candidateFirstHeardMs = 0;
    if (_linkState == ZONE_LINK_TRANSITIONING) {
      _linkState = ZONE_LINK_CURRENT;
      _movementEvent = true;
    }
  }
}

bool ZoneTracker::consumeMovementEvent() {
  bool event = _movementEvent;
  _movementEvent = false;
  return event;
}

const char* ZoneTracker::getCurrentZone() const {
  return _currentZone;
}

ZoneLinkState ZoneTracker::getLinkState() const {
  return _linkState;
}

const char* ZoneTracker::getLinkStateString() const {
  return zoneLinkStateToString(_linkState);
}

const char* ZoneTracker::getNearestAnchorId() const {
  return _nearestAnchorId;
}

uint32_t ZoneTracker::getNearestAnchorNodeId() const {
  return _nearestAnchorNodeId;
}

uint32_t ZoneTracker::getLastHeardMs() const {
  return _lastHeardMs;
}

uint32_t ZoneTracker::getTimeSinceLastBeaconMs() const {
  return (_lastHeardMs == 0) ? 999999 : (millis() - _lastHeardMs);
}

int ZoneTracker::getHopDistance() const {
  return _hopDistance;
}

int ZoneTracker::getRssi() const {
  return _rssi;
}

bool ZoneTracker::isAutoTracking() const {
  return _autoTracking;
}

bool ZoneTracker::isStale() const {
  return (_linkState == ZONE_LINK_LAST_KNOWN || _linkState == ZONE_LINK_UNKNOWN);
}

bool ZoneTracker::hasAnchor() const {
  return (_nearestAnchorNodeId != 0 && _linkState == ZONE_LINK_CURRENT);
}

void ZoneTracker::setManualOverride(const char* zoneId) {
  if (zoneId && strlen(zoneId) > 0) {
    strncpy(_currentZone, zoneId, sizeof(_currentZone) - 1);
    _currentZone[sizeof(_currentZone) - 1] = '\0';
    _linkState = ZONE_LINK_CURRENT;
    _autoTracking = false;
    _movementEvent = true;
    Serial.printf("[ZONE OVERRIDE] Manual zone set: %s (Auto-tracking paused)\n", _currentZone);
  }
}

void ZoneTracker::resumeAutoTracking() {
  _autoTracking = true;
  _movementEvent = true;
  Serial.println("[ZONE OVERRIDE] Auto-tracking resumed.");
}
