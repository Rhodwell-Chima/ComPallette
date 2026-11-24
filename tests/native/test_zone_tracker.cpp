#include "Arduino.h"
#include "../../ComPallete/ZoneTracker.h"
#include <assert.h>
#include <stdio.h>

uint32_t g_mock_millis = 1000;

int main() {
  ZoneTracker tracker;
  tracker.begin("UNASSIGNED");

  // 1. Initial state
  assert(tracker.getLinkState() == ZONE_LINK_UNKNOWN);
  assert(strcmp(tracker.getCurrentZone(), "UNASSIGNED") == 0);
  assert(!tracker.consumeMovementEvent());

  // 2. Direct stationary anchor beacon (hop = 1) -> CURRENT
  tracker.handleAnchorBeacon("ANCHOR-01", "ZONE-A", 1001, 1, -60, true);
  assert(tracker.getLinkState() == ZONE_LINK_CURRENT);
  assert(strcmp(tracker.getCurrentZone(), "ZONE-A") == 0);
  assert(tracker.consumeMovementEvent());
  assert(!tracker.consumeMovementEvent()); // Consumed

  // 3. Multi-hop packet (hop = 2) must NEVER alter location
  tracker.handleAnchorBeacon("ANCHOR-02", "ZONE-B", 1002, 2, -50, true);
  assert(tracker.getLinkState() == ZONE_LINK_CURRENT);
  assert(strcmp(tracker.getCurrentZone(), "ZONE-A") == 0);
  assert(!tracker.consumeMovementEvent());

  // 4. Wearable relay (isStationary = false) must NEVER alter location
  tracker.handleAnchorBeacon("WEARABLE-99", "ZONE-C", 1099, 1, -40, false);
  assert(tracker.getLinkState() == ZONE_LINK_CURRENT);
  assert(strcmp(tracker.getCurrentZone(), "ZONE-A") == 0);
  assert(!tracker.consumeMovementEvent());

  // 5. Handover sequence between zones:
  // When CURRENT in ZONE-A (-60 dBm), hear ANCHOR-02 in ZONE-B (-62 dBm within 2s)
  g_mock_millis += 1000;
  tracker.handleAnchorBeacon("ANCHOR-02", "ZONE-B", 1002, 1, -62, true);
  assert(tracker.getLinkState() == ZONE_LINK_TRANSITIONING);
  assert(tracker.consumeMovementEvent());

  // Candidate evaluation window passes (1.5s)
  g_mock_millis += 1600;
  tracker.update();
  assert(tracker.getLinkState() == ZONE_LINK_CURRENT);
  assert(strcmp(tracker.getCurrentZone(), "ZONE-B") == 0);
  assert(tracker.consumeMovementEvent());

  // 6. Direct anchor beacon timeout (20 seconds) -> degrades to LAST_KNOWN
  g_mock_millis += 21000;
  tracker.update();
  assert(tracker.getLinkState() == ZONE_LINK_LAST_KNOWN);
  assert(strcmp(tracker.getCurrentZone(), "ZONE-B") == 0); // Zone preserved as last known
  assert(tracker.consumeMovementEvent());

  // 7. Direct link disconnect event
  // First re-establish link in ZONE-B
  tracker.handleAnchorBeacon("ANCHOR-02", "ZONE-B", 1002, 1, -60, true);
  assert(tracker.getLinkState() == ZONE_LINK_CURRENT);
  assert(tracker.consumeMovementEvent());
  // Disconnect from anchor
  tracker.handleDirectDisconnect(1002);
  assert(tracker.getLinkState() == ZONE_LINK_LAST_KNOWN);
  assert(tracker.consumeMovementEvent());

  puts("ZoneTracker direct-anchor state-machine tests passed successfully!");
  return 0;
}
