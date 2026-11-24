#pragma once
#include <stdint.h>
#include <stddef.h>
#include <string.h>
#include <stdio.h>
#include <stdarg.h>

extern uint32_t g_mock_millis;
inline uint32_t millis() { return g_mock_millis; }

struct MockSerial {
  void println(const char* = "") {}
  void printf(const char*, ...) {}
};

inline MockSerial Serial;
