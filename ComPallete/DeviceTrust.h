#pragma once
#include <Arduino.h>
#include <ArduinoJson.h>

namespace DeviceTrust {
bool begin();
bool ready();
const char* installation();
const char* bootNonce();
int64_t nowSeconds();
bool clockValid();
void clockRequest(JsonObject payload);
bool decode(JsonVariantConst frame, JsonDocument& body);
bool applyTime(JsonVariantConst body);
void sign(JsonDocument& body, JsonObject frame);
}
