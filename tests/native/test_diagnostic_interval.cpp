#define ARDUHAL_LOG_LEVEL ARDUHAL_LOG_LEVEL_INFO
#include "../../ComPallete/Logging.h"
#include <assert.h>

uint32_t g_mock_millis = 0;

int main() {
  DiagnosticInterval<ARDUHAL_LOG_LEVEL_DEBUG> disabled;
  assert(!disabled.ready());

  DiagnosticInterval<ARDUHAL_LOG_LEVEL_WARN, 100> interval;
  assert(interval.ready()); // Time zero is a valid first report.
  assert(!interval.ready());
  g_mock_millis = 99;
  assert(!interval.ready());
  g_mock_millis = 100;
  assert(interval.ready());

  DiagnosticInterval<ARDUHAL_LOG_LEVEL_ERROR, 100> rollover;
  g_mock_millis = UINT32_MAX - 49;
  assert(rollover.ready());
  g_mock_millis = 49;
  assert(!rollover.ready());
  g_mock_millis = 50;
  assert(rollover.ready());

  puts("Diagnostic interval tests passed");
}
