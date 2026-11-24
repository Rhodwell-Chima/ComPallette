#include "OfflineBuffer.h"
#include <FS.h>
#include <LittleFS.h>
#include "DeviceTrust.h"

OfflineBuffer::OfflineBuffer()
  : m_maxRamItems(BUFFER_MAX_RAM_ITEMS),
    m_maxFlashItems(BUFFER_MAX_FLASH_ITEMS),
    m_flashAvailable(false),
    m_cutoverBlocked(false),
    m_totalFlushed(0),
    m_totalDropped(0),
    m_priorityBurst(0),
    m_peekedPriority(true) {}

OfflineBuffer::~OfflineBuffer() {}

bool OfflineBuffer::begin(size_t maxRamItems, size_t maxFlashItems) {
  m_cutoverBlocked = false;
  m_maxRamItems = maxRamItems;
  m_maxFlashItems = maxFlashItems;

  m_priorityQueue.clear();
  m_standardQueue.clear();
  m_priorityBurst = 0;
  m_peekedPriority = true;

  // Attempt to mount LittleFS for persistent crash-resilient storage
  if (LittleFS.begin(false) || LittleFS.begin(true)) {
    m_flashAvailable = true;
    Serial.println("[BUFFER] LittleFS mounted successfully. Restoring persistent queue...");
    loadFromFlash();
  } else {
    m_flashAvailable = false;
    Serial.println("[BUFFER WARNING] LittleFS mount failed! Durable ingestion disabled; local sensing and alarms remain active.");
  }

  Serial.printf("[BUFFER INIT] Max RAM: %u | Max Flash: %u | Restored Items: %u\n",
                m_maxRamItems, m_maxFlashItems, count());
  return true;
}

bool OfflineBuffer::push(const String& packetJson, MessageType type, bool isPriority) {
  if (!m_flashAvailable || m_cutoverBlocked || packetJson.length() == 0) {
    return false;
  }

  // Check overall capacity limit
  const size_t maxItems = (m_maxRamItems < m_maxFlashItems) ? m_maxRamItems : m_maxFlashItems;
  if (maxItems == 0) return false;
  if (count() >= maxItems) {
    ++m_totalDropped;
    Serial.println("[BUFFER FULL] Cannot retain new packet; existing unacknowledged events preserved.");
    return false;
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

  // Do not report a packet as retained if the durable write failed.
  if (!syncToFlash()) {
    if (isPriority) m_priorityQueue.pop_back();
    else m_standardQueue.pop_back();
    ++m_totalDropped;
    return false;
  }
  return true;
}

bool OfflineBuffer::peek(BufferedItem& outItem) {
  if (m_cutoverBlocked) return false;
  // Permit a routine packet after a bounded run of priority packets.
  const bool choosePriority = !m_priorityQueue.empty() &&
    (m_standardQueue.empty() || m_priorityBurst < 5);
  if (choosePriority) {
    m_peekedPriority = true;
    outItem = m_priorityQueue.front();
    return true;
  }

  if (!m_standardQueue.empty()) {
    m_peekedPriority = false;
    outItem = m_standardQueue.front();
    return true;
  }

  return false;
}

bool OfflineBuffer::pop() {
  if (m_cutoverBlocked) return false;
  auto& queue = m_peekedPriority ? m_priorityQueue : m_standardQueue;
  if (queue.empty()) return false;
  BufferedItem retained = queue.front();
  queue.erase(queue.begin());
  if (!syncToFlash()) {
    queue.insert(queue.begin(), retained);
    return false;
  }
  if (m_peekedPriority) { if (m_priorityBurst < 255) ++m_priorityBurst; }
  else m_priorityBurst = 0;
  ++m_totalFlushed;
  return true;
}

bool OfflineBuffer::archiveForCutover(const String& installation) {
  const char* archive = "/queue-precutover.jsonl";
  if (!m_flashAvailable || !DeviceTrust::ready() || installation != DeviceTrust::installation()
      || LittleFS.exists(archive) || !LittleFS.exists(BUFFER_FLASH_FILE)) return false;
  // Atomic rename preserves all old bytes, including records that cannot be parsed.
  // Never overwrite an earlier archive or silently import it into a new installation.
  if (!LittleFS.rename(BUFFER_FLASH_FILE, archive)) return false;
  m_priorityQueue.clear(); m_standardQueue.clear(); m_priorityBurst = 0;
  m_cutoverBlocked = false;
  Serial.println("[BUFFER] Archived previous queue to /queue-precutover.jsonl. Export and retain it in the cutover record.");
  return true;
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
  const size_t maxItems = (m_maxRamItems < m_maxFlashItems) ? m_maxRamItems : m_maxFlashItems;
  return count() >= maxItems;
}

void OfflineBuffer::clear() {
  m_priorityQueue.clear();
  m_standardQueue.clear();

  if (m_flashAvailable && LittleFS.exists(BUFFER_FLASH_FILE)) {
    LittleFS.remove(BUFFER_FLASH_FILE);
  }
  if (m_flashAvailable && LittleFS.exists("/compallette_queue.tmp")) LittleFS.remove("/compallette_queue.tmp");
  if (m_flashAvailable && LittleFS.exists("/compallette_queue.bak")) LittleFS.remove("/compallette_queue.bak");
}

void OfflineBuffer::evictOldestStandard() {
  if (!m_standardQueue.empty()) {
    m_standardQueue.erase(m_standardQueue.begin());
    m_totalDropped++;
    Serial.printf("[BUFFER EVICT] Dropped oldest routine telemetry packet to preserve capacity (Total Dropped: %u)\n",
                  m_totalDropped);
  }
}

bool OfflineBuffer::syncToFlash() {
  if (!m_flashAvailable || m_cutoverBlocked) {
    return false;
  }

  // If buffer is completely empty, remove file to reclaim flash space
  if (isEmpty()) {
    if (LittleFS.exists(BUFFER_FLASH_FILE)) {
      if (!LittleFS.remove(BUFFER_FLASH_FILE)) return false;
    }
    if (LittleFS.exists("/compallette_queue.tmp")) LittleFS.remove("/compallette_queue.tmp");
    if (LittleFS.exists("/compallette_queue.bak")) LittleFS.remove("/compallette_queue.bak");
    return true;
  }

  const char* tempPath = "/compallette_queue.tmp";
  const char* backupPath = "/compallette_queue.bak";
  File f = LittleFS.open(tempPath, "w");
  if (!f) {
    Serial.println("[BUFFER ERROR] Failed to open flash file for writing!");
    return false;
  }

  bool writeOk = true;
  // Priority queue items written first
  for (const auto& item : m_priorityQueue) {
    String line = "PRIO|" + String((int)item.type) + "|" + String(item.queuedTimestampMs) + "|" + item.rawJson + "\n";
    if (f.print(line) != line.length()) writeOk = false;
  }

  // Followed by standard queue items
  for (const auto& item : m_standardQueue) {
    String line = "NORM|" + String((int)item.type) + "|" + String(item.queuedTimestampMs) + "|" + item.rawJson + "\n";
    if (f.print(line) != line.length()) writeOk = false;
  }

  f.flush();
  f.close();
  if (!writeOk) {
    LittleFS.remove(tempPath);
    Serial.println("[BUFFER ERROR] Flash queue write was incomplete; retained previous durable snapshot.");
    return false;
  }

  if (LittleFS.exists(backupPath)) LittleFS.remove(backupPath);
  if (LittleFS.exists(BUFFER_FLASH_FILE) && !LittleFS.rename(BUFFER_FLASH_FILE, backupPath)) {
    LittleFS.remove(tempPath);
    Serial.println("[BUFFER ERROR] Could not stage previous queue snapshot.");
    return false;
  }
  if (!LittleFS.rename(tempPath, BUFFER_FLASH_FILE)) {
    if (LittleFS.exists(backupPath)) LittleFS.rename(backupPath, BUFFER_FLASH_FILE);
    Serial.println("[BUFFER ERROR] Could not commit queue snapshot; previous snapshot restored.");
    return false;
  }
  if (LittleFS.exists(backupPath)) LittleFS.remove(backupPath);
  return true;
}

void OfflineBuffer::loadFromFlash() {
  const char* backupPath = "/compallette_queue.bak";
  const char* tempPath = "/compallette_queue.tmp";
  if (!m_flashAvailable) return;
  if (!LittleFS.exists(BUFFER_FLASH_FILE) && LittleFS.exists(backupPath)) {
    LittleFS.rename(backupPath, BUFFER_FLASH_FILE);
  }
  if (LittleFS.exists(BUFFER_FLASH_FILE)) {
    if (LittleFS.exists(backupPath)) LittleFS.remove(backupPath);
    if (LittleFS.exists(tempPath)) LittleFS.remove(tempPath);
  }
  if (!LittleFS.exists(BUFFER_FLASH_FILE)) {
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
      m_cutoverBlocked = true;
      Serial.println("[BUFFER BLOCKED] Corrupted stored record requires local review; snapshot preserved.");
      continue;
    }

    String tag = line.substring(0, firstPipe);
    int typeInt = line.substring(firstPipe + 1, secondPipe).toInt();
    uint32_t ts = (uint32_t)line.substring(secondPipe + 1, thirdPipe).toInt();
    String rawJson = line.substring(thirdPipe + 1);

    StaticJsonDocument<2048> stored;
    if (deserializeJson(stored, rawJson) || !DeviceTrust::ready()
        || String(stored["installation_id"] | "") != DeviceTrust::installation()) {
      m_cutoverBlocked = true;
      Serial.println("[BUFFER BLOCKED] Queue belongs to an old/unknown installation. Explicit archive required.");
    }
    MessageEnvelope env{};
    TelemetryData telem{};
    AlertData alert{};
    HeartbeatData heartbeat{};
    bool legacy = false;
    if (typeInt <= MSG_UNKNOWN || typeInt > MSG_COMMAND_RESULT ||
        !deserializePacket(rawJson, env, telem, alert, heartbeat, legacy) ||
        env.msg_type != (MessageType)typeInt) {
      m_cutoverBlocked = true;
      Serial.println("[BUFFER BLOCKED] Invalid persisted record requires local review; snapshot preserved.");
      continue;
    }

    if (count() >= m_maxRamItems) {
      m_cutoverBlocked = true;
      Serial.println("[BUFFER BLOCKED] Stored queue exceeds RAM capacity; snapshot preserved for local export.");
      break;
    }
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
