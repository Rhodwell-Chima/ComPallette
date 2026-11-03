#include "CaptivePortalManager.h"

// Global instance
CaptivePortalManager captivePortal;

#define DNS_PORT 53

CaptivePortalManager::CaptivePortalManager()
  : _active(false),
    _server(80),
    _rebootTargetMs(0),
    _rebootPending(false) {
  _apSsid[0] = '\0';
}

bool CaptivePortalManager::begin() {
  if (_active) return true;

  const char* chipId = nodeConfigManager.getChipId();
  snprintf(_apSsid, sizeof(_apSsid), "Compallette-Setup-%s", chipId);

  Serial.println("\n+--------------------------------------------------------------+");
  Serial.println("|         COMPALLETTE LOCAL WI-FI CAPTIVE PORTAL ONLINE        |");
  Serial.println("+--------------------------------------------------------------+");
  Serial.printf("  |-- SoftAP SSID    : %s (OPEN / NO PASSWORD)\n", _apSsid);
  Serial.printf("  |-- SoftAP Channel : 1\n");
  Serial.println("  |-- Portal URL     : http://192.168.4.1");

  // Clean Wi-Fi state before starting AP to avoid radio conflict
  WiFi.disconnect(true, true);
  WiFi.mode(WIFI_OFF);
  delay(100);

  WiFi.mode(WIFI_AP);
  delay(50);

  IPAddress apIP(192, 168, 4, 1);
  IPAddress gateway(192, 168, 4, 1);
  IPAddress netMsk(255, 255, 255, 0);
  if (!WiFi.softAPConfig(apIP, gateway, netMsk)) {
    Serial.println("  |-- [WARN] softAPConfig failed; using default AP IP.");
  }

  bool ok = WiFi.softAP(_apSsid, nullptr, 1, 0, 4);
  if (!ok) {
    Serial.println("  |-- [ERROR] WiFi.softAP() failed to start AP broadcast!");
    return false;
  }

  Serial.printf("  |-- SoftAP IP      : %s\n", WiFi.softAPIP().toString().c_str());
  Serial.printf("  |-- SoftAP MAC     : %s\n", WiFi.softAPmacAddress().c_str());

  // Start captive DNS server to redirect all requests to 192.168.4.1
  _dnsServer.setErrorReplyCode(DNSReplyCode::NoError);
  _dnsServer.start(DNS_PORT, "*", apIP);

  // Bind Web Server Routes
  _server.on("/", HTTP_GET, [this]() { handleRoot(); });
  _server.on("/save", HTTP_POST, [this]() { handleSave(); });
  _server.on("/api/sensors", HTTP_GET, [this]() { handleSensorApi(); });

  // Captive Portal detection probes (iOS, Android, Windows)
  _server.on("/generate_204", [this]() { handleRoot(); });
  _server.on("/hotspot-detect.html", [this]() { handleRoot(); });
  _server.on("/ncsi.txt", [this]() { handleRoot(); });
  _server.onNotFound([this]() { handleNotFound(); });

  _server.begin();
  _active = true;

  Serial.println("  |-- Web Server     : Listening on port 80");
  Serial.println("  |-- DNS Server     : Captive DNS redirecting all traffic to 192.168.4.1");
  Serial.println("+--------------------------------------------------------------+");
  Serial.println("Connect a smartphone or PC to the Wi-Fi network above to configure.\n");
  return true;
}

void CaptivePortalManager::update() {
  if (!_active) return;

  _dnsServer.processNextRequest();
  _server.handleClient();

  // Execute delayed reboot after saving
  if (_rebootPending && millis() > _rebootTargetMs) {
    Serial.println("\n[PORTAL] Rebooting node to apply new configuration...");
    delay(100);
    ESP.restart();
  }
}

void CaptivePortalManager::stop() {
  if (!_active) return;
  _dnsServer.stop();
  _server.stop();
  WiFi.softAPdisconnect(true);
  WiFi.mode(WIFI_OFF);
  _active = false;
  Serial.println("[PORTAL] Captive portal stopped. SoftAP offline.");
}

void CaptivePortalManager::handleRoot() {
  String html = buildPortalHtml();
  _server.send(200, "text/html", html);
}

void CaptivePortalManager::handleSave() {
  NodeConfig cfg = nodeConfigManager.get();

  if (_server.hasArg("device_id") && _server.arg("device_id").length() > 0) {
    strncpy(cfg.device_id, _server.arg("device_id").c_str(), sizeof(cfg.device_id) - 1);
  }

  if (_server.hasArg("role")) {
    int r = _server.arg("role").toInt();
    cfg.role = (NodeRole)r;
  }

  if (cfg.role == ROLE_WEARABLE) {
    // Wearable tag location is determined dynamically via nearby stationary anchors (Option 1)
    strncpy(cfg.zone_id, "UNASSIGNED", sizeof(cfg.zone_id) - 1);
  } else if (_server.hasArg("zone_id") && _server.arg("zone_id").length() > 0) {
    strncpy(cfg.zone_id, _server.arg("zone_id").c_str(), sizeof(cfg.zone_id) - 1);
  }

  if (_server.hasArg("m_ssid") && _server.arg("m_ssid").length() > 0) {
    strncpy(cfg.mesh_prefix, _server.arg("m_ssid").c_str(), sizeof(cfg.mesh_prefix) - 1);
  }

  if (_server.hasArg("m_pass") && _server.arg("m_pass").length() > 0) {
    strncpy(cfg.mesh_password, _server.arg("m_pass").c_str(), sizeof(cfg.mesh_password) - 1);
  }

  if (_server.hasArg("m_chan")) {
    cfg.mesh_channel = (uint8_t)_server.arg("m_chan").toInt();
  }

  if (_server.hasArg("gw_ssid")) {
    strncpy(cfg.uplink_ssid, _server.arg("gw_ssid").c_str(), sizeof(cfg.uplink_ssid) - 1);
  }

  if (_server.hasArg("gw_pass")) {
    strncpy(cfg.uplink_password, _server.arg("gw_pass").c_str(), sizeof(cfg.uplink_password) - 1);
  }

  if (_server.hasArg("api_url")) {
    strncpy(cfg.backend_url, _server.arg("api_url").c_str(), sizeof(cfg.backend_url) - 1);
  }

  // Save to persistent flash NVS
  nodeConfigManager.save(cfg);

  String response = "<!DOCTYPE html><html><head><meta name='viewport' content='width=device-width,initial-scale=1'>"
                    "<style>body{font-family:-apple-system,sans-serif;background:#0c0c0f;color:#e4e4e7;padding:24px;text-align:center;}"
                    ".card{background:#131316;border:1px solid #27272a;border-radius:8px;padding:24px;max-width:420px;margin:30px auto;box-shadow:0 8px 24px rgba(0,0,0,0.5);}"
                    "h2{color:#22c55e;margin-top:0;font-size:20px;}"
                    "p{color:#a1a1aa;font-size:14px;line-height:1.5;}"
                    ".badge{display:inline-block;padding:6px 12px;background:#2563eb;color:#fff;border-radius:4px;font-family:monospace;font-size:14px;margin:12px 0;}"
                    ".reboot{color:#3b82f6;font-size:12px;font-weight:600;margin-top:16px;}</style></head><body>"
                    "<div class='card'>"
                    "<h2>✓ Configuration Committed</h2>"
                    "<p>Node has been successfully provisioned:</p>"
                    "<div class='badge'>" + String(cfg.device_id) + " (" + String(nodeRoleToString(cfg.role)) + ")</div>"
                    "<p>Assigned Zone: <strong>" + String(cfg.zone_id) + "</strong></p>"
                    "<p class='reboot'>Rebooting into production mesh network in 2 seconds...</p>"
                    "</div></body></html>";

  _server.send(200, "text/html", response);

  // Trigger non-blocking restart in 2 seconds
  _rebootTargetMs = millis() + 2000;
  _rebootPending = true;
}

void CaptivePortalManager::handleSensorApi() {
  SensorReadings r = sensorHAL.read();
  char buf[256];
  snprintf(buf, sizeof(buf),
           "{\"co\":%.1f,\"temp\":%.1f,\"hum\":%.1f,\"fall\":%s,\"batt\":%.2f,\"accel_g\":%.2f,\"mq_ok\":%s,\"mpu_ok\":%s}",
           r.co_ppm, r.temp_c, r.humidity_pct,
           r.fall_detected ? "true" : "false",
           r.battery_v, r.accel_magnitude,
           r.mq_healthy ? "true" : "false",
           r.mpu_healthy ? "true" : "false");
  _server.send(200, "application/json", buf);
}

void CaptivePortalManager::handleNotFound() {
  _server.sendHeader("Location", String("http://192.168.4.1/"), true);
  _server.send(302, "text/plain", "");
}

String CaptivePortalManager::buildPortalHtml() {
  const NodeConfig& cfg = nodeConfigManager.get();
  SensorReadings s = sensorHAL.read();

  String html = "<!DOCTYPE html><html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'>"
                "<title>Compallette Node Provisioning</title>"
                "<style>"
                "*{box-sizing:border-box;margin:0;padding:0;}"
                "body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#0c0c0f;color:#e4e4e7;padding:16px;font-size:13px;line-height:1.5;}"
                ".container{max-width:480px;margin:0 auto;}"
                ".header{display:flex;align-items:center;justify-content:space-between;padding:12px 0;border-bottom:1px solid #27272a;margin-bottom:16px;}"
                ".brand{font-size:16px;font-weight:700;color:#3b82f6;letter-spacing:-0.3px;}"
                ".chip-pill{font-family:monospace;font-size:11px;background:#18181b;padding:3px 8px;border-radius:4px;border:1px solid #27272a;color:#a1a1aa;}"
                ".card{background:#131316;border:1px solid #27272a;border-radius:6px;padding:14px;margin-bottom:14px;}"
                ".card-title{font-size:11px;font-weight:700;text-transform:uppercase;color:#71717a;letter-spacing:0.4px;margin-bottom:10px;}"
                ".metric-row{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:6px;}"
                ".metric-cell{background:#0c0c0f;border:1px solid #27272a;border-radius:4px;padding:6px;text-align:center;}"
                ".metric-lbl{font-size:9px;color:#71717a;text-transform:uppercase;}"
                ".metric-val{font-size:13px;font-weight:700;font-family:monospace;color:#38bdf8;margin-top:2px;}"
                "label{display:block;font-size:11px;font-weight:600;color:#a1a1aa;margin:10px 0 4px 0;}"
                "input,select{width:100%;background:#0c0c0f;border:1px solid #27272a;color:#fff;border-radius:4px;padding:8px 10px;font-size:13px;font-family:inherit;}"
                "input:focus,select:focus{outline:none;border-color:#2563eb;}"
                ".btn{width:100%;background:#2563eb;color:#fff;border:none;border-radius:4px;padding:10px;font-size:13px;font-weight:600;cursor:pointer;margin-top:16px;transition:0.2s;}"
                ".btn:hover{background:#1d4ed8;}"
                ".status-safe{color:#22c55e;}.status-warn{color:#eab308;}.status-crit{color:#ef4444;}"
                "</style></head><body>"
                "<div class='container'>"
                "<div class='header'>"
                "<span class='brand'>Compallette</span>"
                "<span class='chip-pill'>" + String(cfg.chip_id) + " (" + String(cfg.chip_mac) + ")</span>"
                "</div>"

                "<div class='card'>"
                "<div class='card-title'>Live Hardware Diagnostics</div>"
                "<div class='metric-row'>"
                "<div class='metric-cell'><div class='metric-lbl'>MQ-7 Gas</div><div class='metric-val " + String(s.co_ppm >= 25 ? "status-warn" : "status-safe") + "'>" + String(s.co_ppm, 1) + " ppm</div></div>"
                "<div class='metric-cell'><div class='metric-lbl'>IMU Vector</div><div class='metric-val'>" + String(s.accel_magnitude, 2) + " g</div></div>"
                "<div class='metric-cell'><div class='metric-lbl'>LiPo Batt</div><div class='metric-val'>" + String(s.battery_v, 2) + " V</div></div>"
                "</div>"
                "<div style='font-size:10px;color:#71717a;margin-top:4px;'>"
                "Hardware Status: " + String(s.mq_healthy ? "MQ-7 OK &bull; " : "MQ-7 Disconnected &bull; ") +
                String(s.mpu_healthy ? "MPU6050 OK &bull; " : "IMU Disconnected &bull; ") +
                String(s.battery_healthy ? "ADC Calibrated" : "ADC Floating") +
                "</div>"
                "</div>"

                "<form method='POST' action='/save' class='card'>"
                "<div class='card-title'>Node Commissioning Profile</div>"

                "<label for='role'>Operational Role</label>"
                "<select name='role' id='role' onchange='handleRoleChange()'>"
                "<option value='0' " + String(cfg.role == ROLE_WEARABLE ? "selected" : "") + ">Wearable Miner Tag (Mobile)</option>"
                "<option value='1' " + String(cfg.role == ROLE_STATIONARY_ANCHOR ? "selected" : "") + ">Stationary Tunnel Anchor (Fixed)</option>"
                "<option value='2' " + String(cfg.role == ROLE_GATEWAY ? "selected" : "") + ">Shaft / Surface Gateway Bridge</option>"
                "</select>"

                "<label for='device_id'>Assigned Badge / Node ID</label>"
                "<input type='text' name='device_id' id='device_id' value='" + String(cfg.device_id) + "' required placeholder='e.g. MINER-106 or ANCHOR-LVL2'>"

                "<div id='zone_container'>"
                "<label for='zone_id'>Subterranean Anchor Zone</label>"
                "<select name='zone_id' id='zone_id'>"
                "<option value='SURFACE-PORTAL' " + String(strcmp(cfg.zone_id, "SURFACE-PORTAL") == 0 ? "selected" : "") + ">Surface Portal (0m)</option>"
                "<option value='LEVEL-1-STATION' " + String(strcmp(cfg.zone_id, "LEVEL-1-STATION") == 0 ? "selected" : "") + ">Level 1 Station (-100m)</option>"
                "<option value='LEVEL-2-NORTH-DRIFT' " + String(strcmp(cfg.zone_id, "LEVEL-2-NORTH-DRIFT") == 0 ? "selected" : "") + ">Level 2 North Drift (-250m)</option>"
                "<option value='LEVEL-2-HAULAGE-WAY' " + String(strcmp(cfg.zone_id, "LEVEL-2-HAULAGE-WAY") == 0 ? "selected" : "") + ">Level 2 Haulage Way (-250m)</option>"
                "<option value='LEVEL-3-ACTIVE-STOPE' " + String(strcmp(cfg.zone_id, "LEVEL-3-ACTIVE-STOPE") == 0 ? "selected" : "") + ">Level 3 Active Stope (-450m)</option>"
                "</select>"
                "<div id='zone_help' style='font-size:11px;color:#a1a1aa;margin-top:4px;'>Stationary mounting location.</div>"
                "</div>"

                "<label for='m_ssid'>Mesh Network SSID</label>"
                "<input type='text' name='m_ssid' id='m_ssid' value='" + String(cfg.mesh_prefix) + "'>"

                "<label for='m_chan'>Mesh Wi-Fi Channel</label>"
                "<input type='number' name='m_chan' id='m_chan' value='" + String(cfg.mesh_channel) + "' min='1' max='13'>"

                "<div id='gw_container' style='display:none;margin-top:10px;padding-top:10px;border-top:1px dashed #27272a;'>"
                "<div style='font-size:12px;font-weight:700;color:#38bdf8;margin-bottom:6px;'>Gateway Surface Uplink Config</div>"
                "<label for='gw_ssid'>Uplink Wi-Fi SSID</label>"
                "<input type='text' name='gw_ssid' id='gw_ssid' value='" + String(cfg.uplink_ssid) + "' placeholder='e.g. Innov_Hub'>"
                "<label for='gw_pass'>Uplink Wi-Fi Password</label>"
                "<input type='password' name='gw_pass' id='gw_pass' value='" + String(cfg.uplink_password) + "' placeholder='Wi-Fi Password'>"
                "<label for='api_url'>Backend URL / mDNS Host</label>"
                "<input type='text' name='api_url' id='api_url' value='" + String(cfg.backend_url) + "' placeholder='http://innovation-hub03.local:8000'>"
                "</div>"

                "<button type='submit' class='btn'>Save &amp; Commission Node</button>"
                "</form>"

                "<script>"
                "function handleRoleChange(){"
                "  var r = document.getElementById('role').value;"
                "  var z = document.getElementById('zone_id');"
                "  var h = document.getElementById('zone_help');"
                "  var gw = document.getElementById('gw_container');"
                "  if(r === '0'){"
                "    z.disabled = true;"
                "    h.innerText = 'Option 1 Active: Wearable tag dynamically adopts location from nearest stationary anchor.';"
                "    h.style.color = '#38bdf8';"
                "    gw.style.display = 'none';"
                "  } else if(r === '2'){"
                "    z.disabled = false;"
                "    h.innerText = 'Fixed physical tunnel zone where gateway is mounted.';"
                "    h.style.color = '#a1a1aa';"
                "    gw.style.display = 'block';"
                "  } else {"
                "    z.disabled = false;"
                "    h.innerText = 'Fixed physical tunnel zone where this stationary node is bolted/mounted.';"
                "    h.style.color = '#a1a1aa';"
                "    gw.style.display = 'none';"
                "  }"
                "}"
                "window.onload = handleRoleChange;"
                "</script>"

                "<div style='text-align:center;font-size:11px;color:#52525b;margin-top:10px;'>"
                "Compallette IoT Underground Safety Platform &bull; Zambia"
                "</div>"
                "</div></body></html>";

  return html;
}
