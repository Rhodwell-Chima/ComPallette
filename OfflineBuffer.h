#ifndef OFFLINE_BUFFER_H
#define OFFLINE_BUFFER_H

#include <Arduino.h>
#include <vector>
#include "Config.h"
#include "Protocol.h"

// ============================================================================
// COMPALLETTE - OFFLINE STORE-AND-FORWARD BUFFER
// ============================================================================
// Provides resilient queuing for mesh telemetry and emergency alerts when
// uplink connection to the surface backend is severed.
//
// Key features:
// - Two-tier priority queue (Critical alerts preempt routine telemetry)
// - Flash-backed persistence via LittleFS to survive reboots/power cycles
// - Head-of-line eviction of oldest routine telemetry when capacity is reached
// - Graceful RAM-only fallback if flash storage is unavailable

struct BufferedItem {
  String        rawJson;
  MessageType   type;
  bool          isPriority;
  uint32_t      queuedTimestampMs;
};

class OfflineBuffer {
public:
  OfflineBuffer();
  ~OfflineBuffer();

  // Initializes LittleFS flash storage and restores any un-flushed packets from previous run
  bool begin(size_t maxRamItems = BUFFER_MAX_RAM_ITEMS, size_t maxFlashItems = BUFFER_MAX_FLASH_ITEMS);

  // Enqueues a packet. If isPriority is true, places in priority queue.
  bool push(const String& packetJson, MessageType type, bool isPriority);

  // Peeks at the next highest-priority packet ready for transmission
  bool peek(BufferedItem& outItem);

  // Removes the item after successful transmission
  bool pop();

  // Queue capacity and sizing
  size_t count() const;
  size_t getPriorityCount() const;
  size_t getStandardCount() const;
  bool isEmpty() const;
  bool isFull() const;

  // Diagnostics and metrics
  size_t getTotalFlushed() const { return m_totalFlushed; }
  size_t getTotalDropped() const { return m_totalDropped; }
  bool isFlashAvailable() const { return m_flashAvailable; }

  // Clears in-memory and persistent storage
  void clear();

  // Flushes dirty in-memory state to LittleFS persistent file
  void syncToFlash();

private:
  size_t m_maxRamItems;
  size_t m_maxFlashItems;
  bool   m_flashAvailable;

  std::vector<BufferedItem> m_priorityQueue;
  std::vector<BufferedItem> m_standardQueue;

  size_t m_totalFlushed;
  size_t m_totalDropped;

  void loadFromFlash();
  void evictOldestStandard();
};

#endif // OFFLINE_BUFFER_H
