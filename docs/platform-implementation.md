# General platform implementation and release gates

The implementation is under verification. Do not run a reset or live cutover merely because migrations apply.

## Contracts

- `/api/v1/entities/{personnel|assets|devices}/{id}`: GET linked record/history, POST atomic operation.
- Operations require `operation_id` (UUID), `expected_version`, and `action`. Assignment uses `node_id`; custody uses `personnel_id`; release/return uses `relationship_id`. Transfer requires `destination_site`, `reason`, and `confirmed_relationships` returned by GET `?preview_destination=<id>`. Archive requires the displayed active relationship IDs and a reason.
- `/api/v1/devices/eligible?site=<id>&q=<query>` lists commissioned, free tracking devices.
- `/api/v1/gateways?site=<id>` returns gateways, discoveries and command history. Register/rotate returns a secret once; install the same credential in the broker and gateway through protected deployment tooling. Revocation immediately blocks application processing; remove its broker password and disconnect its broker session as well.
- `/api/v1/commands` queues PROVISION or DIAGNOSTIC only, with `operation_id`, `gateway_id`, `node_id` and (for provisioning) `discovery_id`, `role`, optional `zone_id`.
- Legacy `/provision/assign` returns 410. Provisioning confirmation requires a correlated command ID, node ID and hardware ID. Shared deployment-key ingestion is no longer accepted: HTTP requires a registered `X-Gateway-ID` and its individual `X-API-Key`.
- Bootstrap provides `site_capabilities`. Staff status alone grants no site authority. Global account changes require a superuser.
- Environmental stream keys are `<node_id>:<measurement_key>`. Historical event site is independent of the node's current site. Legacy zone strings are unverified reports, never confirmed presence.
- Account creation produces an unusable password. A superuser sets a validated password through the protected reset endpoint; no default password or fabricated email is issued.

## MQTT deployment

Use `docker-compose.mqtt.yml` only after provisioning `MQTT_SECRETS_DIR` outside version control. Supply `passwords` (Mosquitto password file), `acl` based on the checked-in example, `worker-password`, and `certs/{ca.crt,server.crt,server.key}`. The server certificate must cover `mqtt` and the hostname used by gateways. No anonymous/plaintext listener is configured.

Each gateway MQTT username is its registered node ID. The broker ACL binds its topic prefix to that username. The dedicated worker authenticates as `compallette-ingestion`. Never grant a gateway wildcard permissions. Rotate both broker and HTTP credentials; revoke/disconnect the old broker client before resuming it.

Gateway transport is explicitly selected by its configured backend URL: `mqtts://<local-host>:8883` selects MQTT; an HTTP(S) URL selects recovery HTTP. Provision `/mqtt-ca.pem` into the gateway LittleFS filesystem. A trusted local clock is required for TLS and command expiry on the gateway and command targets; command execution fails closed when the clock is unavailable. No internet time dependency should be introduced.

Topics under `compallette/v1/gateways/<gateway-id>/`: `events`, `results`, `receipts`, `commands`. All use QoS 1 without retained messages. Application receipts mean DB persistence, not merely broker delivery. Command frames include `command_id`, `kind`, `node_id`, `hardware_id`, `issued_at_ms`, `expires_at` and `payload`. Provisioning never changes safety thresholds. Targets journal command execution in NVS and return COMMAND_RESULT mesh envelopes. Automatic RSSI inference remains disabled.

## Fresh-install procedure

1. Complete PostgreSQL, frontend, broker-recovery, load and real-hardware gates first.
2. Pause ingestion and watchdog processes; take an application database backup and prove restoration into a separate database.
3. Create a new application database. Retain the previous database and the shared PostgreSQL volume; leave experimental backend data alone.
4. Run migrations and `python manage.py bootstrap_pilot` interactively against the new database. This refuses operational data and creates no demo entities or zones.
5. Register hardware, install broker/gateway credentials and CA certificates, establish trusted local time, and reconcile/clear pre-cutover gateway buffers through an explicitly recorded maintenance action.
6. Switch frontend, Django, MQTT worker and watchdog together, verify health and isolated synthetic traffic, then resume registered hardware.

## Verification status

Release is not approved until real gateway/mesh tests confirm TLS, expiry, durable receipts and commissioning. The installed Arduino IDE toolchain was found outside PATH and the ESP32-S3 build passes with esp32 core 3.3.12. Compilation does not verify device operation. Browser verification and the 30-minute 100-device load run must also be recorded before cutover. Keep deployment on the existing database until these gates pass.


## Continuation checkpoint — 20 November 2026

The existing Gemini/AntiGravity frontend changes have been retained. Integration edits build on that working tree; no deployment, database reset, hardware flashing, or operational data mutations were performed.

Completed in this continuation:

- Closed cross-organisation site-creation and membership privilege-escalation gaps; fixed PostgreSQL account row locking. Audit endpoints now require the audit capability.
- Scoped account reads/mutations, form state, and related-history queries to the selected/permitted sites. Linked account identity is explicit; password setup requires a supplied validated password.
- Added layout expected-version checks (409), stable feature IDs and site-validated `properties.zone_id`. Layout reads no longer create records. Twin zone associations resolve those stable IDs.
- Added entity custody, measurement and audit history, account linking, and retries using the original operation ID after an uncertain response.
- Preserved immutable incident audit sites and recurring watchdog communication-loss incidents. Uncommissioned/archived devices are excluded from watchdog processing.
- Operational measurement summaries use the normalized simulation flag on observations, independent of firmware field aliases.
- Restricted gateway identifiers to topic-safe characters. Command confirmations validate identifiers, correlate hardware, preserve terminal states and audit late results once. MQTT receipts acknowledge a persisted late result without reviving an expired command. HTTP recovery accepts command-result payloads.
- Preserved the new settings design source files, but gated browser-storage-only threshold/network/integration forms out of the active settings screen. Their controls did not change firmware or backend settings; the webhook test did not send a request. Active navigation now exposes unavailable states or links to backend-connected workflows.

Verification evidence:

- Frontend: 28 Vitest tests passed; production TypeScript/Vite build passed. Existing Three.js bundle-size warning remains.
- Firmware: ESP32-S3, `esp32:esp32:esp32s3:PartitionScheme=huge_app,CDCOnBoot=cdc`, core 3.3.12: latest compile passed, 1,346,265 bytes flash and 55,352 bytes global RAM. No flashing or physical verification.
- PostgreSQL: isolated container `compallete-platform-test-db`, no production volume or port, 40 tests passed, including regression and concurrent checkout coverage.
- Rendered checks: NOT VERIFIED. The isolated fixture server starts, but the available in-app browser timed out accessing localhost. No new screenshots, viewport, keyboard journey, or zoom/reflow pass is claimed.
- User confirmed no spare gateway/mesh hardware is available. Real TLS, clock, buffering, mesh command delivery and commissioning tests remain unavailable.

Remaining work before release:

- Broker integration/restart/revocation/replay verification and the 100-device, 30-minute load/replay gate.
- Complete and verify gateway diagnostic operator controls, command version/idempotency contracts, credential deployment, and trusted local clock provisioning. Review mesh command authenticity before enabling commands in deployment.
- Finish the general evidence API/current-location projection, ambiguous/stale evidence cases and complete device-capability/catalogue contract verification.
- Reconcile remaining prototype workstation/site settings with implemented behavior; finish full responsive/keyboard/zoom verification and all entity journeys.
- Broader custody/transfer concurrency and restart/fault-injection coverage, remaining supported-board firmware builds, and real hardware gates.
- Verified backup restoration, separate clean database bootstrap and cutover only after release gates pass. No reset or cutover has occurred.


## Continuation checkpoint — 21 November 2026

The API integration repair, coordinated installation contract and current verification evidence are recorded in [API integration and local provisioning](api-integration-repair.md). That report supersedes the earlier verification status above. Real broker load/recovery/command tests now pass; rendered browser and physical-hardware checks remain unavailable. No deployment, reset, flashing or cutover was performed.
