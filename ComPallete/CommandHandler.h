#pragma once
#include <Arduino.h>
#include <ArduinoJson.h>
#include <Preferences.h>
#include <time.h>
#include "NodeConfigManager.h"
#include "DeviceTrust.h"

// Returns true only for a platform command envelope (including commands for peers).
// Commissioning changes identity only; existing local safety thresholds are preserved.
inline bool handlePlatformCommand(const String& message, std::function<void(const String&)> reply) {
  StaticJsonDocument<2048> frame;
  if (deserializeJson(frame, message)) return false;
  if (!frame.containsKey("signed_body")) return frame.containsKey("command_id");
  StaticJsonDocument<1536> command;
  if (!DeviceTrust::decode(frame.as<JsonVariantConst>(), command)) return true;
  if (String(command["kind"] | "") == "TIME_RESPONSE") {
    DeviceTrust::applyTime(command.as<JsonVariantConst>());
    return true;
  }
  const String kind = command["kind"] | "";
  const String id = command["command_id"] | "";
  const String hardware = command["hardware_id"] | "";
  if (hardware != nodeConfigManager.getChipId()) return true;
  if (kind != "PROVISION" && kind != "DIAGNOSTIC") return true;
  const String target = command["node_id"] | "";
  const int64_t expires = command["expires_at"] | 0LL;
  const uint64_t issued = command["issued_at_ms"] | 0ULL;
  bool allowed = DeviceTrust::clockValid() && expires > DeviceTrust::nowSeconds()
    && expires <= DeviceTrust::nowSeconds() + 305 && issued <= static_cast<uint64_t>(DeviceTrust::nowSeconds() + 5) * 1000 && id.length() == 36 && issued > 0;
  Preferences journal;
  if (!journal.begin("compcommands", false)) return true;
  StaticJsonDocument<384> completed;
  const String saved = journal.getString("completed", "");
  if (saved.length() && deserializeJson(completed, saved)) { journal.end(); return true; }
  const bool sameInstallation = String(completed["installation_id"] | "") == DeviceTrust::installation();
  const String priorId = sameInstallation ? String(completed["id"] | "") : String("");
  const uint64_t priorIssued = sameInstallation ? (completed["issued"] | 0ULL) : 0ULL;
  bool stillApplied = nodeConfigManager.isProvisioned() && target == nodeConfigManager.getDeviceId();
  if (kind == "PROVISION") {
    const String expectedRole = command["payload"]["role"] | "";
    const String expectedZone = expectedRole == "WEARABLE" ? "UNASSIGNED" : String(command["payload"]["zone"] | "UNASSIGNED");
    stillApplied = stillApplied && expectedRole == nodeRoleToString(nodeConfigManager.getRole())
      && expectedZone == nodeConfigManager.getZoneId();
  }
  const bool duplicate = priorId == id && stillApplied;
  String state = "REJECTED";
  if (duplicate) state = "DEVICE_CONFIRMED";
  else if (allowed && (issued > priorIssued || priorId == id)) {
    if (kind == "DIAGNOSTIC" && target == nodeConfigManager.getDeviceId()) state = "DEVICE_CONFIRMED";
    if (kind == "PROVISION") {
      const String role = command["payload"]["role"] | "";
      const String zone = command["payload"]["zone"] | "UNASSIGNED";
      if (target.length() > 0 && target.length() < 24 && zone.length() < 24 && (role == "WEARABLE" || role == "ANCHOR")) {
        const auto current = nodeConfigManager.get();
        // Apply an atomic, idempotent identity update. A restart can
        // repeat this same assignment safely; no threshold or alarm control is accepted.
        if (nodeConfigManager.setAssignment(target.c_str(), role == "ANCHOR" ? ROLE_STATIONARY_ANCHOR : ROLE_WEARABLE,
                                            zone.c_str(), current.co_warning_ppm, current.co_critical_ppm)) state = "DEVICE_CONFIRMED";
      }
    }
    if (state == "DEVICE_CONFIRMED") {
      completed["id"] = id; completed["issued"] = issued;
      completed["installation_id"] = DeviceTrust::installation();
      String encoded; serializeJson(completed, encoded);
      if (journal.putString("completed", encoded) != encoded.length()) {
        // Do not confirm or reboot without a durable duplicate-execution record.
        // Provisioning can safely retry the same atomic identity assignment.
        journal.end(); return true;
      }
    }
  }
  journal.end();
  StaticJsonDocument<2048> result;
  result["installation_id"] = DeviceTrust::installation();
  result["ver"] = 1; result["type"] = "COMMAND_RESULT";
  const uint32_t seq = nodeConfigManager.nextSequence();
  if (!seq) return true;
  result["seq"] = seq; result["sender"] = nodeConfigManager.getDeviceId();
  result["role"] = nodeRoleToString(nodeConfigManager.getRole());
  result["zone"] = "UNASSIGNED"; result["uptime"] = millis();
  StaticJsonDocument<768> confirmation;
  confirmation["kind"] = "COMMAND_RESULT";
  confirmation["command_id"] = id;
  confirmation["node_id"] = target;
  confirmation["state"] = state;
  confirmation["free_heap"] = ESP.getFreeHeap();
  DeviceTrust::sign(confirmation, result["payload"].to<JsonObject>());
  result["payload"]["command_id"] = id;
  result["payload"]["state"] = state;
  String output; serializeJson(result, output); reply(output);
  if (state == "DEVICE_CONFIRMED" && kind == "PROVISION" && !duplicate) {
    delay(1000); ESP.restart();
  }
  return true;
}
