#include "ZoneTracker.h"
#include "Config.h"

#define ZONE_DIRECT_STICKY_MS   15000   // Prefer 1-hop direct anchor for at least 15s before fallback
#define ZONE_EXPIRY_TIMEOUT_MS  60000   // Mark anchor link stale after 60s without beacon

ZoneTracker::ZoneTracker()
  : _nearestAnchorNodeId(0),
    _lastHeardMs(0),
    _hopDistance(99),
    _rssi(0),
    _autoTracking(true),
    _hasAnchor(false),
    _staleLogged(false) {
  strncpy(_currentZone, "UNASSIGNED", sizeof(_currentZone) - 1);
  _currentZone[sizeof(_currentZone) - 1] = '\0';
  strncpy(_nearestAnchorId, "NONE", sizeof(_nearestAnchorId) - 1);
  _nearestAnchorId[sizeof(_nearestAnchorId) - 1] = '\0';
}

void ZoneTracker::begin(const char* initialZone) {
  if (initialZone && strlen(initialZone) > 0 && strcmp(initialZone, "UNASSIGNED") != 0 && strcmp(initialZone, "AUTO_DETECT") != 0) {
    strncpy(_currentZone, initialZone, sizeof(_currentZone) - 1);
  } else {
    strncpy(_currentZone, "UNASSIGNED", sizeof(_currentZone) - 1);
  }
  _currentZone[sizeof(_currentZone) - 1] = '\0';
  _autoTracking = true;
  _hasAnchor = false;
  _staleLogged = false;
}

void ZoneTracker::update() {
  if (!_autoTracking || !_hasAnchor) {
    return;
  }

  uint32_t now = millis();
  if (now - _lastHeardMs >= ZONE_EXPIRY_TIMEOUT_MS) {
    if (!_staleLogged) {
      Serial.println("\n--------------------------------------------------------------");
      Serial.printf("[ZONE STALE] No beacon received from %s for > %u seconds!\n",
                    _nearestAnchorId, (unsigned)(ZONE_EXPIRY_TIMEOUT_MS / 1000));
      Serial.printf("             Retaining last confirmed safety zone: %s\n", _currentZone);
      Serial.println("--------------------------------------------------------------");
      _staleLogged = true;
    }
  }
}

void ZoneTracker::handleAnchorBeacon(
  const char* anchorId,
  const char* zoneId,
  uint32_t anchorNodeId,
  int hopDistance,
  int rssi
) {
  if (!_autoTracking) {
    return; // Manual test override active
  }

  if (!zoneId || strlen(zoneId) == 0 || strcmp(zoneId, "UNASSIGNED") == 0) {
    return;
  }

  uint32_t now = millis();

  // If we already have a 1-hop direct anchor heard recently, ignore multi-hop relays
  if (_hasAnchor && _hopDistance <= 1 && hopDistance > 1) {
    if (now - _lastHeardMs < ZONE_DIRECT_STICKY_MS) {
      return; // Stick with the direct 1-hop anchor
    }
  }

  bool zoneChanged = (strncmp(_currentZone, zoneId, sizeof(_currentZone)) != 0);

  // Adopt new anchor reference
  strncpy(_currentZone, zoneId, sizeof(_currentZone) - 1);
  _currentZone[sizeof(_currentZone) - 1] = '\0';

  if (anchorId && strlen(anchorId) > 0) {
    strncpy(_nearestAnchorId, anchorId, sizeof(_nearestAnchorId) - 1);
    _nearestAnchorId[sizeof(_nearestAnchorId) - 1] = '\0';
  }

  _nearestAnchorNodeId = anchorNodeId;
  _lastHeardMs = now;
  _hopDistance = hopDistance;
  _rssi = rssi;
  _hasAnchor = true;
  _staleLogged = false;

  if (zoneChanged) {
    Serial.println("\n==============================================================");
    Serial.printf("[ZONE ROAM] Miner moved into: %s\n", _currentZone);
    Serial.printf("  |-- Nearest Anchor : %s (Node ID: %u)\n", _nearestAnchorId, _nearestAnchorNodeId);
    Serial.printf("  |-- Hop Distance   : %d hop(s)\n", _hopDistance);
    if (_rssi != 0) {
      Serial.printf("  |-- Signal RSSI    : %d dBm\n", _rssi);
    }
    Serial.println("==============================================================");
  }
}

const char* ZoneTracker::getCurrentZone() const {
  return _currentZone;
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
  if (!_hasAnchor) return 0;
  return millis() - _lastHeardMs;
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
  if (!_hasAnchor) return true;
  return (millis() - _lastHeardMs >= ZONE_EXPIRY_TIMEOUT_MS);
}

bool ZoneTracker::hasAnchor() const {
  return _hasAnchor;
}

void ZoneTracker::setManualOverride(const char* zoneId) {
  if (!zoneId || strlen(zoneId) == 0) return;
  strncpy(_currentZone, zoneId, sizeof(_currentZone) - 1);
  _currentZone[sizeof(_currentZone) - 1] = '\0';
  _autoTracking = false;
  strncpy(_nearestAnchorId, "MANUAL_OVERRIDE", sizeof(_nearestAnchorId) - 1);
  _nearestAnchorId[sizeof(_nearestAnchorId) - 1] = '\0';
  _hopDistance = 0;
  _hasAnchor = true;
  _staleLogged = false;
  Serial.printf("[ZONE] Manual test override activated: %s (Auto-tracking paused)\n", _currentZone);
}

void ZoneTracker::resumeAutoTracking() {
  _autoTracking = true;
  _staleLogged = false;
  Serial.println("[ZONE] Resumed automatic anchor proximity tracking.");
}
