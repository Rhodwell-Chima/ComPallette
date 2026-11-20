#pragma once
#include <Arduino.h>
#include <ArduinoJson.h>
#include <Preferences.h>
#include <time.h>
#include "NodeConfigManager.h"

// Returns true only for a platform command envelope (including commands for peers).
// Commissioning changes identity only; existing local safety thresholds are preserved.
inline bool handlePlatformCommand(const String& message, std::function<void(const String&)> reply) {
  StaticJsonDocument<2048> command;
  if (deserializeJson(command, message) || !command.containsKey("command_id") || !command.containsKey("kind")) return false;
  const String kind = command["kind"] | "";
  const String id = command["command_id"] | "";
  const String hardware = command["hardware_id"] | "";
  if (hardware != nodeConfigManager.getChipId()) return true;
  if (kind != "PROVISION" && kind != "DIAGNOSTIC") return true;
  const String target = command["node_id"] | "";
  const int64_t expires = command["expires_at"] | 0LL;
  const uint64_t issued = command["issued_at_ms"] | 0ULL;
  bool allowed = time(nullptr) >= 1700000000 && expires > time(nullptr) && id.length() == 36 && issued > 0;
  Preferences journal;
  if (!journal.begin("compcommands", false)) return true;
  const String priorId = journal.getString("id", "");
  const uint64_t priorIssued = journal.getULong64("issued", 0);
  const bool duplicate = priorId == id && journal.getBool("done", false);
  String state = "REJECTED";
  if (duplicate) state = "DEVICE_CONFIRMED";
  else if (allowed && issued > priorIssued) {
    if (kind == "DIAGNOSTIC" && target == nodeConfigManager.getDeviceId()) state = "DEVICE_CONFIRMED";
    if (kind == "PROVISION") {
      const String role = command["payload"]["role"] | "";
      const String zone = command["payload"]["zone"] | "UNASSIGNED";
      if (target.length() > 0 && target.length() < 24 && zone.length() < 24 && (role == "WEARABLE" || role == "ANCHOR")) {
        const auto current = nodeConfigManager.get();
        // Journal intent before applying an idempotent identity update. A restart can
        // repeat this same assignment safely; no threshold or alarm control is accepted.
        journal.putString("id", id); journal.putBool("done", false);
        if (nodeConfigManager.setAssignment(target.c_str(), role == "ANCHOR" ? ROLE_STATIONARY_ANCHOR : ROLE_WEARABLE,
                                            zone.c_str(), current.co_warning_ppm, current.co_critical_ppm)) state = "DEVICE_CONFIRMED";
      }
    }
    if (state == "DEVICE_CONFIRMED") {
      journal.putString("id", id); journal.putULong64("issued", issued); journal.putBool("done", true);
    }
  }
  journal.end();
  StaticJsonDocument<1024> result;
  result["ver"] = 1; result["type"] = "COMMAND_RESULT";
  const uint32_t seq = nodeConfigManager.nextSequence();
  if (!seq) return true;
  result["seq"] = seq; result["sender"] = nodeConfigManager.getDeviceId();
  result["role"] = nodeRoleToString(nodeConfigManager.getRole());
  result["zone"] = "UNASSIGNED"; result["uptime"] = millis();
  result["payload"]["command_id"] = id; result["payload"]["node_id"] = target;
  result["payload"]["hardware_id"] = hardware; result["payload"]["state"] = state;
  result["payload"]["free_heap"] = ESP.getFreeHeap();
  String output; serializeJson(result, output); reply(output);
  if (state == "DEVICE_CONFIRMED" && kind == "PROVISION" && !duplicate) {
    delay(1000); ESP.restart();
  }
  return true;
}
