#ifndef RADIO_DIAGNOSTICS_H
#define RADIO_DIAGNOSTICS_H

#include <Arduino.h>

// Measurement-only instrumentation for the WROOM/S3 radio feasibility trial.
// Leave disabled in normal operation; it does not infer or change worker zones.
#ifndef ENABLE_RADIO_DIAGNOSTICS
#define ENABLE_RADIO_DIAGNOSTICS 0
#endif

void radioDiagnosticsUpdate(uint32_t meshNodeId, const char* deviceId);

#endif
