#pragma once

#include <Arduino.h>
#include <esp_log.h>
#include <inttypes.h>

// One instance per diagnostic and execution context. Unsigned elapsed time
// keeps the interval valid when millis() wraps.
template <int Level, uint32_t IntervalMs = 10000>
class DiagnosticInterval {
 public:
  bool ready() {
    if (ARDUHAL_LOG_LEVEL < Level) return false;
    const uint32_t now = millis();
    if (reported && now - lastReport < IntervalMs) return false;
    lastReport = now;
    reported = true;
    return true;
  }

 private:
  uint32_t lastReport = 0;
  bool reported = false;
};
