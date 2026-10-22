"""
COMPALLETTE OFFLINE BUFFER UNIT & INTEGRITY TESTS
=================================================
Validates queue semantics, priority preemption, capacity limits,
head-of-line eviction, and persistence serialization logic.
"""

import json
import os
import tempfile
import time
import unittest


class PythonOfflineBuffer:
    """Python reference implementation mirroring OfflineBuffer.cpp behavior."""

    def __init__(self, max_ram=10, max_flash=20, flash_path=None):
        self.max_ram = max_ram
        self.max_flash = max_flash
        self.flash_path = flash_path

        self.priority_queue = []
        self.standard_queue = []
        self.total_flushed = 0
        self.total_dropped = 0

    def count(self):
        return len(self.priority_queue) + len(self.standard_queue)

    def is_empty(self):
        return self.count() == 0

    def push(self, raw_json, msg_type="TELEMETRY", is_priority=False):
        if not raw_json:
            return False

        # Capacity management
        if self.count() >= self.max_flash:
            if self.standard_queue:
                # Evict oldest standard telemetry to protect priority space
                self.standard_queue.pop(0)
                self.total_dropped += 1
            else:
                # Buffer is 100% priority items
                self.priority_queue.pop(0)
                self.total_dropped += 1

        item = {
            "raw": raw_json,
            "type": msg_type,
            "priority": is_priority,
            "ts": int(time.time() * 1000),
        }

        if is_priority:
            self.priority_queue.append(item)
        else:
            self.standard_queue.append(item)

        self.sync_to_flash()
        return True

    def peek(self):
        # Priority preemption: alerts always serviced before routine telemetry
        if self.priority_queue:
            return self.priority_queue[0]
        if self.standard_queue:
            return self.standard_queue[0]
        return None

    def pop(self):
        if self.priority_queue:
            item = self.priority_queue.pop(0)
            self.total_flushed += 1
            self.sync_to_flash()
            return item
        if self.standard_queue:
            item = self.standard_queue.pop(0)
            self.total_flushed += 1
            self.sync_to_flash()
            return item
        return None

    def sync_to_flash(self):
        if not self.flash_path:
            return
        if self.is_empty():
            if os.path.exists(self.flash_path):
                os.remove(self.flash_path)
            return

        with open(self.flash_path, "w", encoding="utf-8") as f:
            for item in self.priority_queue:
                f.write(f"PRIO|{item['type']}|{item['ts']}|{item['raw']}\n")
            for item in self.standard_queue:
                f.write(f"NORM|{item['type']}|{item['ts']}|{item['raw']}\n")

    def load_from_flash(self):
        if not self.flash_path or not os.path.exists(self.flash_path):
            return

        self.priority_queue.clear()
        self.standard_queue.clear()

        with open(self.flash_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                parts = line.split("|", 3)
                if len(parts) != 4:
                    continue  # Skip corrupted line
                tag, mtype, ts, raw = parts
                item = {
                    "raw": raw,
                    "type": mtype,
                    "priority": (tag == "PRIO"),
                    "ts": int(ts),
                }
                if tag == "PRIO":
                    self.priority_queue.append(item)
                else:
                    self.standard_queue.append(item)


class TestOfflineBuffer(unittest.TestCase):

    def setUp(self):
        self.temp_file = tempfile.NamedTemporaryFile(delete=False)
        self.temp_file.close()

    def tearDown(self):
        if os.path.exists(self.temp_file.name):
            os.remove(self.temp_file.name)

    def test_fifo_ordering_standard(self):
        buf = PythonOfflineBuffer(max_flash=10, flash_path=self.temp_file.name)
        buf.push('{"seq": 1}', "TELEMETRY", is_priority=False)
        buf.push('{"seq": 2}', "TELEMETRY", is_priority=False)
        buf.push('{"seq": 3}', "TELEMETRY", is_priority=False)

        self.assertEqual(buf.count(), 3)
        self.assertEqual(buf.peek()["raw"], '{"seq": 1}')
        self.assertEqual(buf.pop()["raw"], '{"seq": 1}')
        self.assertEqual(buf.pop()["raw"], '{"seq": 2}')
        self.assertEqual(buf.pop()["raw"], '{"seq": 3}')
        self.assertTrue(buf.is_empty())

    def test_priority_preemption(self):
        """Verify that emergency alerts pushed AFTER telemetry are popped FIRST."""
        buf = PythonOfflineBuffer(max_flash=10, flash_path=self.temp_file.name)

        # 3 routine telemetry packets
        buf.push('{"telem": 1}', "TELEMETRY", is_priority=False)
        buf.push('{"telem": 2}', "TELEMETRY", is_priority=False)
        buf.push('{"telem": 3}', "TELEMETRY", is_priority=False)

        # Spontaneous critical alert arrives later
        buf.push('{"alert": "MAN_DOWN"}', "ALERT", is_priority=True)

        # Peek & Pop must yield the critical alert FIRST
        self.assertEqual(buf.peek()["raw"], '{"alert": "MAN_DOWN"}')
        popped_alert = buf.pop()
        self.assertEqual(popped_alert["raw"], '{"alert": "MAN_DOWN"}')
        self.assertTrue(popped_alert["priority"])

        # Remaining telemetry served in order
        self.assertEqual(buf.pop()["raw"], '{"telem": 1}')
        self.assertEqual(buf.pop()["raw"], '{"telem": 2}')
        self.assertEqual(buf.pop()["raw"], '{"telem": 3}')
        self.assertTrue(buf.is_empty())

    def test_capacity_and_eviction_protects_alerts(self):
        """Verify that when buffer reaches max capacity, oldest telemetry is evicted, not alerts."""
        buf = PythonOfflineBuffer(max_flash=4, flash_path=self.temp_file.name)

        # Enqueue 1 priority alert and 3 telemetry packets (Total: 4 = capacity)
        buf.push('{"alert": 1}', "ALERT", is_priority=True)
        buf.push('{"telem": 1}', "TELEMETRY", is_priority=False)
        buf.push('{"telem": 2}', "TELEMETRY", is_priority=False)
        buf.push('{"telem": 3}', "TELEMETRY", is_priority=False)

        self.assertEqual(buf.count(), 4)
        self.assertEqual(buf.total_dropped, 0)

        # Push a 5th packet (overflow)
        buf.push('{"telem": 4}', "TELEMETRY", is_priority=False)

        self.assertEqual(buf.count(), 4)
        self.assertEqual(buf.total_dropped, 1)  # telem 1 dropped

        # Verify alert 1 was NOT evicted
        self.assertEqual(buf.pop()["raw"], '{"alert": 1}')
        # Remaining items are telem 2, 3, 4
        self.assertEqual(buf.pop()["raw"], '{"telem": 2}')
        self.assertEqual(buf.pop()["raw"], '{"telem": 3}')
        self.assertEqual(buf.pop()["raw"], '{"telem": 4}')
        self.assertTrue(buf.is_empty())

    def test_persistence_reboot_restore(self):
        """Verify buffer survives node reset/crash and restores from persistent storage."""
        buf1 = PythonOfflineBuffer(max_flash=10, flash_path=self.temp_file.name)
        buf1.push('{"alert": "GAS_SPIKE"}', "ALERT", is_priority=True)
        buf1.push('{"telem": "CO_22"}', "TELEMETRY", is_priority=False)
        buf1.push('{"telem": "CO_23"}', "TELEMETRY", is_priority=False)

        # Simulate power cut / node reboot by creating a fresh buffer instance pointing to same file
        buf2 = PythonOfflineBuffer(max_flash=10, flash_path=self.temp_file.name)
        buf2.load_from_flash()

        self.assertEqual(buf2.count(), 3)
        # Verify priority alert is still at head of restored queue
        self.assertEqual(buf2.pop()["raw"], '{"alert": "GAS_SPIKE"}')
        self.assertEqual(buf2.pop()["raw"], '{"telem": "CO_22"}')
        self.assertEqual(buf2.pop()["raw"], '{"telem": "CO_23"}')
        self.assertTrue(buf2.is_empty())

    def test_corrupted_storage_recovery(self):
        """Verify that corrupted lines in flash do not crash the buffer or prevent valid items loading."""
        with open(self.temp_file.name, "w", encoding="utf-8") as f:
            f.write("PRIO|ALERT|1000|{\"alert\":1}\n")
            f.write("CORRUPTED_LINE_WITHOUT_PIPES\n")
            f.write("NORM|BAD_LINE\n")
            f.write("NORM|TELEMETRY|1002|{\"telem\":2}\n")

        buf = PythonOfflineBuffer(max_flash=10, flash_path=self.temp_file.name)
        buf.load_from_flash()

        # Should recover 2 valid items and ignore corrupted ones
        self.assertEqual(buf.count(), 2)
        self.assertEqual(buf.pop()["raw"], '{"alert":1}')
        self.assertEqual(buf.pop()["raw"], '{"telem":2}')
        self.assertTrue(buf.is_empty())


if __name__ == "__main__":
    unittest.main()
