# ComPallete firmware logging

## Build and output

ComPallete uses direct `ESP_LOGE/W/I/D/V` calls with static component tags. The verified toolchain is Arduino CLI 1.1.1, Arduino-ESP32 3.3.12, and bundled ESP-IDF 5.5.5. The application uses ArduinoJson 7.4.3, painlessMesh 1.5.7, Async TCP 3.6.1, and TaskScheduler 4.1.1. Preferences, WiFi, Networking, Update, SPIFFS, FS, HTTPClient, NetworkClientSecure, ESPmDNS, Wire, WebServer, DNSServer, Async UDP, LittleFS, and Hash are bundled at Arduino-ESP32 3.3.12. The firmware selects wearable, anchor, or gateway operation from commissioning state at runtime.

The Arduino header loads `esp_log.h` and, with `CONFIG_ARDUHAL_ESP_LOG` enabled and `USE_ESP_IDF_LOG` undefined, maps `ESP_LOGx` to Arduino's `log_x` with the supplied component tag in the output. The board menu sets `CORE_DEBUG_LEVEL`, which controls `ARDUHAL_LOG_LEVEL`. The bundled native ESP-IDF logging path is Log V1 with an Error default and maximum. Native `LOG_LOCAL_LEVEL` and `esp_log_level_set()` apply to that path. The Arduino-remapped application calls use compile-time filtering, including when the SDK supports dynamic levels for its own tags. [Arduino core mapping](https://github.com/espressif/arduino-esp32/blob/3.3.12/cores/esp32/esp32-hal-log.h) · [ESP-IDF logging](https://docs.espressif.com/projects/esp-idf/en/v5.5.5/esp32s3/api-reference/system/log.html)

Select **Tools → Core Debug Level → Info** for production. Arduino's board default can be None if the option is omitted. Use Debug on a lab build, Error for quiet diagnosis, or None to test the absence of application diagnostics. Warn enables errors and warnings. Reserve Verbose for controlled investigation. The board option also affects Arduino and libraries compiled with that level. In this core, HTTPClient Debug includes host and URI information, and Verbose can include a URL or raw response headers. Use synthetic endpoints and credentials when collecting those traces. painlessMesh retains its independent `ERROR | STARTUP` selection. ROM, bootloader, precompiled IDF components, and intentional Serial output have their own settings and can still emit output with Core Debug Level set to None. [Arduino board options](https://docs.espressif.com/projects/arduino-esp32/en/latest/guides/tools_menu.html) · [HTTPClient logging source](https://github.com/espressif/arduino-esp32/blob/3.3.12/libraries/HTTPClient/src/HTTPClient.cpp)

From the repository root, use these production build commands. Substitute `debug`, `error`, or `none` for verification. The generic S3 build must explicitly select its hardware profile.

```powershell
arduino-cli compile --warnings all --fqbn 'esp32:esp32:esp32:PartitionScheme=huge_app,DebugLevel=info' ComPallete
arduino-cli compile --warnings all --fqbn 'esp32:esp32:esp32s3:PartitionScheme=huge_app,CDCOnBoot=cdc,DebugLevel=info' --build-property 'compiler.cpp.extra_flags=-DACTIVE_HARDWARE_PROFILE=PROFILE_GENERIC_ESP32S3' ComPallete
arduino-cli compile --warnings all --fqbn 'esp32:esp32:adafruit_feather_esp32s3:DebugLevel=info' ComPallete
```

| Profile | Arduino `Serial` selected by the board options | Application logger |
| --- | --- | --- |
| Generic ESP32 | UART0 at 115200 | Arduino HAL debug output, default UART0 |
| Generic ESP32-S3 | Hardware USB Serial/JTAG CDC with the options above | Arduino HAL debug output, default UART0 through the ROM output path |
| Feather ESP32-S3 BME | USB-OTG CDC with the default Feather options | Arduino HAL debug output, default UART0 through the ROM output path |

The Arduino logger calls `log_printf` and the ROM output routine. USB CDC and USB Serial/JTAG have their own debug redirection hooks. The sketch keeps the existing board defaults, uses `Serial.begin(115200)` for the CLI, and retains its headless enumeration timeout. For an S3 console with CLI output alone, check the UART0 connector and board USB mode. Native IDF, ROM, or boot messages may also appear over USB Serial/JTAG. Physical routing and attached versus detached behavior still require a bench check. [Arduino Serial aliases](https://github.com/espressif/arduino-esp32/blob/3.3.12/cores/esp32/HardwareSerial.h) · [Arduino log output implementation](https://github.com/espressif/arduino-esp32/blob/3.3.12/cores/esp32/esp32-hal-uart.c)

Multiline Serial reports keep their existing formatting. On a shared destination, a Wi-Fi callback or library task can interleave its diagnostics with a report or `RADIO,` record. There is no global lock across commands. Use a None build for CLI transcript comparisons and radio tool captures, and verify whether independent library output also reaches the capture.

## Levels and tags

| Level | Use |
| --- | --- |
| Error | A required operation failed, such as snapshot commit, sequence reservation, TLS validation, or priority retention |
| Warning | Degradation or rejected input, such as a lost direct anchor, an invalid packet, or a failed upstream request |
| Info | Startup, initialization, configuration commit, and state transitions |
| Debug | Bounded packet lengths, sequence numbers, counts, transport stages, or retry context |
| Verbose | Detailed lab-only traces. The production sketch has no Verbose calls |

| Tag | Component |
| --- | --- |
| `CP_BOOT` | Reset reason and operating mode |
| `CP_MESH`, `CP_WIFI` | Mesh peers, downlink broadcast, station link, and channel |
| `CP_PROTO`, `CP_PROV` | Packet parsing and dispatch, enrollment announcements and rejection |
| `CP_ALERT` | Local SOS and man-down detection, acknowledgement, and mesh submission |
| `CP_GW`, `CP_DNS` | Gateway lifecycle, ingest, retry, and multicast DNS |
| `CP_HTTP`, `CP_MQTT`, `CP_WS` | Transport setup and results. WebSocket code is conditional on the existing build flag |
| `CP_BUFFER` | Queue restore, capacity, and snapshot failures |
| `CP_SENSOR`, `CP_IMU`, `CP_POWER` | Hardware profile, sensor availability, and initialization |
| `CP_ZONE` | Direct anchor transitions and location evidence |
| `CP_CONFIG`, `CP_TRUST`, `CP_PORTAL` | NVS, local trust, and captive portal lifecycle |

Use literal formats and file-local tags. Prefer allowlisted values such as enum numbers, byte counts, and verified status codes. Keep credentials, URLs, identities, payloads, and arbitrary text outside diagnostics. Fixed format strings and numeric fields prevent incoming control characters from entering the new logs. Keep ordinary logging out of ISRs and critical sections. MQTT callbacks accumulate receive overflow counts and TLS verification flags. The Arduino task reports them.

```cpp
// Correct. The storage operation executes at every build level.
const bool stored = buffer.push(json, type, priority);
if (!stored) ESP_LOGE(TAG, "Queue write failed");

// Incorrect. Filtering would also remove the write.
ESP_LOGD(TAG, "Stored=%d", buffer.push(json, type, priority));
```

Use `DiagnosticInterval` from `Logging.h` at busy call sites owned by one execution context. It admits the first occurrence, uses unsigned elapsed time across `millis()` rollover, and avoids reading the clock at a disabled build level. The default interval is 10 seconds per call site. Incoming alert diagnostics use one second to bound burst duplicates. Actual events, retries, sensor reads, and queue operations retain their existing schedules. Check the owning layer for an existing diagnostic before adding a new one. A buffer rejection or flash failure can already be reported by `CP_BUFFER`.

## Migration inventory

Line references below identify the original `6dee64f16f512883d129271fa127ca7edfffe78a` sources. Related lines are grouped by their consumer and purpose.

| Original file and lines or function | Classification and purpose | Result and rationale |
| --- | --- | --- |
| `ComPallete.ino:98–105, 141–143` | Sensitive diagnostic, alert submission and local alarm clear | `CP_ALERT` Error/Warning/Info. Distinguish failed serialization, mesh acceptance, and rejection. Omit identities, zone, and alert content |
| `ComPallete.ino:151–180` | Diagnostic and redundant diagnostics, peer lifecycle | `CP_MESH` Info/Debug. Bound peer joins and topology callbacks. `CP_ZONE` owns direct-anchor loss |
| `ComPallete.ino:191–201` | Sensitive diagnostic, router association and DHCP | `CP_WIFI` Debug/Info/Warning. Preserve channel and numeric disconnect reason |
| `ComPallete.ino:249–298` | Sensitive diagnostic, mesh packet parsing and events | `CP_PROTO` Warning/Debug, `CP_PROV` Warning, `CP_ALERT` Warning/Info. Drop raw fields and rate-limit receive diagnostics |
| `ComPallete.ino:371–444` | Sensitive diagnostic, scheduled dispatch | `CP_PROTO` and `CP_PROV` Debug. Report message metadata and dispatch stage |
| `ComPallete.ino:452–607` | User interface and CLI output, boot banner, help, status and scans | Preserve tables, local values, prompts, formatting, and flush |
| `ComPallete.ino:611–612` | Diagnostic, reset reason | `CP_BOOT` Info/Warning. Report the SDK reset reason and flag watchdog or brownout resets |
| `ComPallete.ino:handleSerialCLI`, `setup`, `loop` | Serial transport, CLI and physical BOOT interface | Preserve input, initialization, timing, prompts, responses, and flushes. Shared helpers select local presentation for explicit commands and BOOT actions |
| `ComPallete.ino:924–954, 1003–1021, 1059` | Sensitive and redundant diagnostics, trust, mode, channel, downlink, location event | `CP_TRUST` Error/Info, `CP_BOOT` Info, `CP_MESH` Warning/Info/Debug, `CP_ZONE` Debug. Omit installation, node, site and payload values |
| `GatewayManager.cpp:44–58, 104–122` | Sensitive diagnostics, setup, parse, queue activity | `CP_GW` Info/Error/Warning/Debug. Name the actual configured transport and leave queue rejection details to storage |
| `GatewayManager.cpp:153–179, 243–244` | Sensitive diagnostics, WebSocket setup, state and frames | `CP_WS` Debug/Warning/Info. Remove targets and frames, report frame acceptance only |
| `GatewayManager.cpp:222–223, 278–350, 564–570` | Sensitive and redundant diagnostics, backoff, station and DNS | `CP_GW` Debug/Info, `CP_WIFI` Warning, `CP_DNS` Info/Warning/Debug. Preserve explicit `mdns` output. Wi-Fi callback owns station association and disconnection |
| `GatewayManager.cpp:426, 480–522, 535–549` | Sensitive diagnostics and CLI output, HTTP request, rejection and test result | `CP_HTTP` Error/Warning/Debug. Preserve test decisions and an always-visible numeric HTTP result. Drop server body excerpts and request targets |
| `MqttUplink.cpp:begin, receive, update` | Diagnostic, selected transport failure, state, ingress and receipt | `CP_MQTT` Error/Warning/Info/Debug. Report from the sketch task using bounded numeric metadata |
| `OfflineBuffer.cpp:31–66, 166–317` | Diagnostic and redundant diagnostics, mount, enqueue, eviction, and snapshot | `CP_BUFFER` Info/Warning/Error/Debug. Report queue capacity, storage failure stage and restore totals. Remove success claims made before durable write or unverified backup recovery |
| `OfflineBuffer.cpp:126` | CLI output, archive confirmation | Preserve local export instruction |
| `SensorHAL.cpp:105–162, 196–402` | Diagnostic, profile, initialization and availability | `CP_SENSOR`, `CP_POWER`, `CP_IMU` Info/Warning. Drop incidental sampled values from startup success logs |
| `SensorHAL.cpp:433–645` | Diagnostic, alarm events and detector reset | `CP_ALERT` Warning/Info and `CP_IMU` Debug. Local detection and acknowledgement remain distinct from transport |
| `SensorHAL.cpp:171–182, 688–708` | User interface, hardware startup summary and flushes | Preserve intentional report and existing timing |
| `ZoneTracker.cpp:58–84, 139–143, 197–200, 236` | Sensitive diagnostic, direct anchor lifecycle | `CP_ZONE` Warning/Info. Log evidence state and RSSI without anchors or exact zones. Include expiry to UNKNOWN |
| `ZoneTracker.cpp:309, 316` | CLI output, explicit manual override and auto-tracking | Preserve the original local confirmations |
| `DeviceTrust.cpp:90` | Diagnostic, credential bundle creation | `CP_TRUST` Debug. Report the creation attempt. Boot separately reports whether trust verified |
| `DeviceTrust.cpp:134–201` | CLI output, trust provisioning, wipe, and status | Preserve local command responses and formatting |
| `NodeConfigManager.cpp:35–59, 204–236, 256–263` | Diagnostic, sensitive diagnostic, and shared CLI output | `CP_CONFIG` Error/Warning/Info. Report persistence and role without device or zone values. Preserve the command-facing NVS messages on explicit local paths |
| `NodeConfigManager.cpp:241–248, 273–291` | CLI output and startup presentation | Preserve factory reset result and the formatted local configuration report |
| `CaptivePortalManager.cpp:41–46, 114` | Diagnostic, AP startup and stop | `CP_PORTAL` Warning/Error/Info. Report address fallback, startup failure, and stopped state |
| `CaptivePortalManager.cpp:52–101` | Commissioning output and user interface | Preserve setup credentials, AP information, connection instructions, and reboot notice. `CP_PORTAL` Warning/Info records DNS startup failure and the active mode |
| `RadioDiagnostics.cpp:printMac, radioDiagnosticsUpdate` | Machine-readable output | Preserve every existing `RADIO,` field and delimiter |
| `Protocol.cpp`, `CommandHandler.h`, storage and identity helpers | Packet/credential formatting and persistence rather than console output | Keep protocol helpers, `sprintf`/ `snprintf` used for identifiers, parser decisions, and file `print` calls. Diagnose packet failures at their callers |

The baseline contains 397 Serial calls, including input and flush. The migration leaves 244 Serial calls, including two testpost report sites. That is 242 retained baseline calls and 155 migrated or consolidated sites. The resulting firmware sources contain 124 `ESP_LOGx` sites, including new observation of MQTT transport and receipt errors. Examples include replacing a multiline alert dump with a count of accepted mesh submissions, replacing an HTTP response excerpt with status and byte count, and replacing a claim of backup restoration with a commit error and unverified recovery.

Local reports still expose operational information. Restrict access to commissioning UART and USB ports and exclude raw local transcripts from shared logs. The legacy `key`/ `apikey` setter echoes the supplied key. `trust` shows the boot nonce and device and installation identities. The portal displays its temporary setup password, and local startup, status, and radio reports can show identifiers and endpoints. `Config.h` provides mesh and uplink password defaults. Any defaults that match deployed credentials should be replaced and rotated separately.

## Verification

The baseline was a clean `main` checkout at `6dee64f16f512883d129271fa127ca7edfffe78a`. Source review compared protected CLI bodies, Serial initialization, reads and flushes, protocol and safety headers, and all radio output with that commit. The only changes inside the main CLI parser are arguments selecting the existing local report paths. The testpost transport helper displays an HTTP status or transport code in place of the raw server error body.

Changes under `ComPallete/` are in `Logging.h`, `ComPallete.ino`, `CaptivePortalManager.cpp`, `DeviceTrust.cpp`, `GatewayManager.cpp/.h`, `MqttUplink.cpp/.h`, `NodeConfigManager.cpp/.h`, `OfflineBuffer.cpp`, `SensorHAL.cpp`, and `ZoneTracker.cpp`. `README.md` selects Info for production. Test support consists of `tests/native/esp_log.h`, `tests/native/test_diagnostic_interval.cpp`, and `tests/firmware/LoggingProbe/LoggingProbe.ino`.

### Host and binary checks

- The standalone Feather severity probe was compiled at None, Error, Warn, Info, Debug, and Verbose. ELF string checks found the expected cumulative severity markers and both intentional Serial markers at each setting.
- Native C++ tests passed for the zone evidence state machine and safety logic on the original and migrated firmware. The diagnostic interval test passed at time zero and across rollover. The tests were compiled with `-Wall -Wextra -Werror`.
- Python regression discovery ran 44 tests in the Linux project image with one live-fixture skip. It covered the protocol reference validator, buffer behavior, sensors, provisioning, and the mock gateway and backend. Windows discovery ran the same tests with one additional POSIX-only skip.
- The isolated Django SQLite run completed 82 tests with one skip using `mining_api.tests`, `mining_api.test_contract_integration`, `mining_api.test_platform`, and `mining_api.test_v2_tracking`.
- Source checks audited the literal format and argument boundaries of all 124 application log sites. The checked arguments exclude received text, raw bodies, credentials, identifiers, and protocol operations. Synthetic input capture remains part of the bench check.

```sh
g++ -std=c++17 -Wall -Wextra -Werror -Itests/native tests/native/test_zone_tracker.cpp ComPallete/ZoneTracker.cpp -o /tmp/compallete-zone && /tmp/compallete-zone
g++ -std=c++17 -Wall -Wextra -Werror -Itests/native tests/native/test_safety_logic.cpp -o /tmp/compallete-safety && /tmp/compallete-safety
g++ -std=c++17 -Wall -Wextra -Werror -Itests/native tests/native/test_diagnostic_interval.cpp -o /tmp/compallete-log-interval && /tmp/compallete-log-interval
python -m unittest discover -s tests -p 'test_*.py'
```

Physical tests, runtime heap and stack measurements, serial line volume, and sensor, scheduler, and alarm timing are pending.

### Build size comparison

All twelve builds passed. Each cell is flash bytes / static RAM bytes as reported by Arduino CLI. In every migrated image, the checked CLI, NVS error, testpost and commissioning strings were present. The checked application messages matched the Error, Warning, Info and Debug level boundaries.

| Profile | Original None | Migrated None | Migrated Error | Migrated Info | Migrated Debug |
| --- | ---: | ---: | ---: | ---: | ---: |
| Generic ESP32 | 1,421,151 / 57,528 | 1,408,847 / 57,536 | 1,462,659 / 57,824 | 1,480,399 / 57,960 | 1,494,859 / 58,040 |
| Generic ESP32-S3 | 1,393,933 / 55,936 | 1,381,653 / 55,944 | 1,436,373 / 56,216 | 1,454,461 / 56,352 | 1,469,029 / 56,432 |
| Feather ESP32-S3 BME | 1,441,879 / 87,900 | 1,429,663 / 87,908 | 1,485,823 / 88,212 | 1,504,215 / 88,348 | 1,518,547 / 88,428 |

Compared with the original default, the new production Info setting adds 4.17%–4.34% flash and 416–448 static RAM bytes. None saves 12,216–12,304 flash bytes and adds 8 static RAM bytes.

The original release commands used the board-default None setting. Compare that baseline with the migrated None build for the effect of compiling out automatic diagnostics. On Feather, a second baseline at the same Debug setting measured 1,510,751 flash bytes and 88,108 static RAM bytes. The migrated Debug build uses 7,796 additional flash bytes (0.52%) and 320 additional static RAM bytes (0.36%). The difference above 5% when comparing the old None build with Debug includes the cost of changing the board-wide level.

The matrix used `--warnings all` and per-profile temporary build paths. The compiler still reports existing format warnings in the protected Serial banner and status reports. Their source and output format were preserved. The optional WebSocket path is disabled in `Config.h` and the local installation lacks its client library.

The opt-in radio build passed for generic ESP32-S3 at None. Its ELF retained the `RADIO,identity`, `RADIO,parent`, `RADIO,child`, and `RADIO,children` format markers and matched the expected None filtering. It used 1,382,349 flash bytes and 55,952 static RAM bytes. To reproduce it, use the S3 command above with `DebugLevel=none` and replace the extra flags property with `compiler.cpp.extra_flags=-DACTIVE_HARDWARE_PROFILE=PROFILE_GENERIC_ESP32S3 -DENABLE_RADIO_DIAGNOSTICS=1`. The ordinary release leaves this instrumentation disabled.

### Bench verification

1. Compile `tests/firmware/LoggingProbe` with the same FQBN and board options as the firmware. On an authorized lab board, capture both UART0 and the configured USB port. The two Serial marker lines are expected at all levels. The ESP markers should appear cumulatively up to the configured level. The probe is a separate sketch.
2. Run the existing help list and aliases with Info, Debug, Error, and None. Compare the original and migrated transcripts for both CR and LF. Include overlong and invalid input. Use synthetic credentials, a lab installation, and an empty test archive destination when exercising commands that change state. Verify `RADIO,` parsing against the capture workflow.
3. Compare cold boot and monitor reconnection with and without a monitor. Track minimum heap, stack high-water where available, packet and log volume, and sensor, alarm, and scheduler timing during actual lab workloads. Investigate differences above 5% and any regression affecting a safety timing requirement.
4. With isolated nodes and test credentials, exercise direct-anchor acquisition/loss, Wi-Fi and MQTT interruption, HTTP recovery, a mismatched receipt, and a restart with queued events. Verify priority retention and snapshot recovery using a test fixture, including full queue and safely injected write failure.
5. Feed synthetic malformed frames and control characters. Check that transport and application diagnostics remain single-line and that credentials and bodies are absent from `CP_*` lines. Confirm SOS, man-down and acknowledgement using controlled inputs and isolated downstream routing.

If diagnostics are absent, first check Core Debug Level and the logger's UART0 destination. If CLI output is absent, check the board's CDC selection and monitor port or UART0 baud.

## Optional follow-up

A bench capture harness could record both ports and compare transcript and timing measurements against the baseline.
