#include "OfflineBuffer.h"
#include <FS.h>
#include <LittleFS.h>

OfflineBuffer::OfflineBuffer()
  : m_maxRamItems(BUFFER_MAX_RAM_ITEMS),
    m_maxFlashItems(BUFFER_MAX_FLASH_ITEMS),
    m_flashAvailable(false),
    m_totalFlushed(0),
    m_totalDropped(0) {}

OfflineBuffer::~OfflineBuffer() {
  clear();
}

bool OfflineBuffer::begin(size_t maxRamItems, size_t maxFlashItems) {
  m_maxRamItems = maxRamItems;
  m_maxFlashItems = maxFlashItems;

  m_priorityQueue.clear();
  m_standardQueue.clear();

  // Attempt to mount LittleFS for persistent crash-resilient storage
  if (LittleFS.begin(true)) {
    m_flashAvailable = true;
    Serial.println("[BUFFER] LittleFS mounted successfully. Restoring persistent queue...");
    loadFromFlash();
  } else {
    m_flashAvailable = false;
    Serial.println("[BUFFER WARNING] LittleFS mount failed! Operating in volatile RAM-only mode.");
  }

  Serial.printf("[BUFFER INIT] Max RAM: %u | Max Flash: %u | Restored Items: %u\n",
                m_maxRamItems, m_maxFlashItems, count());
  return true;
}

bool OfflineBuffer::push(const String& packetJson, MessageType type, bool isPriority) {
  if (packetJson.length() == 0) {
    return false;
  }

  // Check overall capacity limit
  if (count() >= m_maxFlashItems) {
    // Evict oldest standard telemetry to preserve buffer space for critical data
    if (!m_standardQueue.empty()) {
      evictOldestStandard();
    } else {
      // Extremely rare: buffer is 100% full of un-flushed priority alerts
      Serial.println("[BUFFER CRITICAL] Buffer fully saturated with priority alerts! Dropping oldest alert.");
      m_priorityQueue.erase(m_priorityQueue.begin());
      m_totalDropped++;
    }
  }

  BufferedItem item;
  item.rawJson = packetJson;
  item.type = type;
  item.isPriority = isPriority;
  item.queuedTimestampMs = millis();

  if (isPriority) {
    m_priorityQueue.push_back(item);
    Serial.printf("[BUFFER PRIORITY] Enqueued CRITICAL alert (Priority Count: %u)\n",
                  m_priorityQueue.size());
  } else {
    m_standardQueue.push_back(item);
  }

  // Persist updated queue to flash
  syncToFlash();
  return true;
}

bool OfflineBuffer::peek(BufferedItem& outItem) {
  // Always service priority queue first (Emergency alerts preempt routine telemetry)
  if (!m_priorityQueue.empty()) {
    outItem = m_priorityQueue.front();
    return true;
  }

  if (!m_standardQueue.empty()) {
    outItem = m_standardQueue.front();
    return true;
  }

  return false;
}

bool OfflineBuffer::pop() {
  if (!m_priorityQueue.empty()) {
    m_priorityQueue.erase(m_priorityQueue.begin());
    m_totalFlushed++;
    syncToFlash();
    return true;
  }

  if (!m_standardQueue.empty()) {
    m_standardQueue.erase(m_standardQueue.begin());
    m_totalFlushed++;
    syncToFlash();
    return true;
  }

  return false;
}

size_t OfflineBuffer::count() const {
  return m_priorityQueue.size() + m_standardQueue.size();
}

size_t OfflineBuffer::getPriorityCount() const {
  return m_priorityQueue.size();
}

size_t OfflineBuffer::getStandardCount() const {
  return m_standardQueue.size();
}

bool OfflineBuffer::isEmpty() const {
  return count() == 0;
}

bool OfflineBuffer::isFull() const {
  return count() >= m_maxFlashItems;
}

void OfflineBuffer::clear() {
  m_priorityQueue.clear();
  m_standardQueue.clear();

  if (m_flashAvailable && LittleFS.exists(BUFFER_FLASH_FILE)) {
    LittleFS.remove(BUFFER_FLASH_FILE);
  }
}

void OfflineBuffer::evictOldestStandard() {
  if (!m_standardQueue.empty()) {
    m_standardQueue.erase(m_standardQueue.begin());
    m_totalDropped++;
    Serial.printf("[BUFFER EVICT] Dropped oldest routine telemetry packet to preserve capacity (Total Dropped: %u)\n",
                  m_totalDropped);
  }
}

void OfflineBuffer::syncToFlash() {
  if (!m_flashAvailable) {
    return;
  }

  // If buffer is completely empty, remove file to reclaim flash space
  if (isEmpty()) {
    if (LittleFS.exists(BUFFER_FLASH_FILE)) {
      LittleFS.remove(BUFFER_FLASH_FILE);
    }
    return;
  }

  File f = LittleFS.open(BUFFER_FLASH_FILE, "w");
  if (!f) {
    Serial.println("[BUFFER ERROR] Failed to open flash file for writing!");
    return;
  }

  // Priority queue items written first
  for (const auto& item : m_priorityQueue) {
    f.printf("PRIO|%d|%u|%s\n", (int)item.type, item.queuedTimestampMs, item.rawJson.c_str());
  }

  // Followed by standard queue items
  for (const auto& item : m_standardQueue) {
    f.printf("NORM|%d|%u|%s\n", (int)item.type, item.queuedTimestampMs, item.rawJson.c_str());
  }

  f.close();
}

void OfflineBuffer::loadFromFlash() {
  if (!m_flashAvailable || !LittleFS.exists(BUFFER_FLASH_FILE)) {
    return;
  }

  File f = LittleFS.open(BUFFER_FLASH_FILE, "r");
  if (!f) {
    Serial.println("[BUFFER ERROR] Could not open flash file for reading.");
    return;
  }

  size_t loadedPrio = 0;
  size_t loadedNorm = 0;

  while (f.available()) {
    String line = f.readStringUntil('\n');
    line.trim();
    if (line.length() == 0) continue;

    // Expected format: TAG|TYPE|TIMESTAMP|RAW_JSON
    int firstPipe = line.indexOf('|');
    int secondPipe = line.indexOf('|', firstPipe + 1);
    int thirdPipe = line.indexOf('|', secondPipe + 1);

    if (firstPipe == -1 || secondPipe == -1 || thirdPipe == -1) {
      Serial.println("[BUFFER WARNING] Skipping corrupted line in flash buffer.");
      continue;
    }

    String tag = line.substring(0, firstPipe);
    int typeInt = line.substring(firstPipe + 1, secondPipe).toInt();
    uint32_t ts = (uint32_t)line.substring(secondPipe + 1, thirdPipe).toInt();
    String rawJson = line.substring(thirdPipe + 1);

    BufferedItem item;
    item.type = (MessageType)typeInt;
    item.queuedTimestampMs = ts;
    item.rawJson = rawJson;

    if (tag == "PRIO") {
      item.isPriority = true;
      m_priorityQueue.push_back(item);
      loadedPrio++;
    } else {
      item.isPriority = false;
      m_standardQueue.push_back(item);
      loadedNorm++;
    }
  }

  f.close();
  Serial.printf("[BUFFER RESTORED] Loaded %u priority alerts, %u standard packets from flash.\n",
                loadedPrio, loadedNorm);
}
