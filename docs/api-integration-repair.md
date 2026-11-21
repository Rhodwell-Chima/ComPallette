# API integration and local provisioning

Updated 21 November 2026. These changes are not deployed. The operational database,
Firefox session, gateway and mesh devices were not mutated or flashed during verification.

## Release contract

- Operator bootstrap and health advertise `contract_version: 2`. The frontend refuses an incompatible bootstrap.
- Session absence is HTTP 401; permission denial is 403 without session logout. Conflict is 409 and retired operations are 410. API exceptions retain structured error details and an `error_code`.
- Gateway registration, rotation and revocation require an `operation_id`. Rotation/revocation also require `expected_version`, using the displayed credential version. Identical retries return the original result; a changed payload with the same operation ID conflicts.
- Commands require an operation UUID and `expected_version`: discovery version for provisioning, device version for diagnostics. Fixed anchors require an active installation zone in the gateway site.
- `QUEUED`, `SENT` and `GATEWAY_RECEIVED` are not device execution confirmations. Provisioning expires after five minutes and diagnostics after 30 seconds. Late results are audited without reviving expired commands.
- Events retain wire `ver: 1` but must include the current installation UUID. HTTP recovery uses both registered gateway headers. MQTT and HTTP share persistence, deduplication and result validation. Unknown hardware is durably quarantined, not assigned to a default site.
- Device time and command frames carry the exact `signed_body` string and its HMAC-SHA256 `mac`. Time responses echo a fresh synchronization challenge; commands target the device hardware and boot nonce. Gateway receipts cannot assert device execution. Another enrolled device cannot reject a peer's command.
- Firmware has setup, mesh enrollment and operational states. Local sensing and alarms remain independent of enrollment/network availability. Configuration and identity writes use checked atomic NVS records; duplicate command confirmations also check that the assigned identity is still applied. Radio location inference remains disabled.

This release intentionally requires coordinated firmware installation. Older traffic is rejected; it is not silently attributed to the new installation. No migration of old event-site attribution is implied.

## Protected local enrollment

Use a maintenance environment with the intended database configuration and write access to a protected key directory. Runtime API and worker containers mount that directory read-only. Directory permissions/Windows ACLs must restrict access to the local provisioning operator and required services. Never put device bundles in browser forms, source control or diagnostic logs.

1. Generate one installation UUID for the new installation and configure `COMPALLETTE_INSTALLATION_ID` consistently for Django, worker and watchdog. Preserve it through ordinary restarts. Set `COMPALLETTE_DEVICE_KEY_DIR` to protected server enrollment storage.
2. Register a gateway in the operator interface. Registration creates no usable credential and leaves it uncommissioned.
3. For each gateway and target device, run:

   ```text
   python manage.py provision_device_trust --hardware-id <chip-id> --site <site-id> --output-directory <protected-device-directory> --ntp-host <local-time-host>
   ```

   The local time host is needed by gateways for initial TLS certificate validation. The command creates `<hardware-id>.json` in server key storage and `device-trust.json` in the specified existing output directory. It refuses replacement of existing material and never prints the key. Mount the server key directory into both API and worker containers.

4. Prepare the gateway bundle, using an explicitly authorized operator account for audit attribution:

   ```text
   python manage.py provision_gateway_credentials prepare --gateway <registration-id> --actor <operator-username> --directory <protected-gateway-directory>
   ```

5. Install its broker password locally, using Mosquitto's `mosquitto_passwd` utility:

   ```text
   python tools/install_gateway_broker_password.py --bundle <protected-gateway-directory>/gateway-credentials.json --password-file <broker-secret-directory>/passwords
   ```

   This hashes only a newly created temporary plaintext entry, then atomically replaces the gateway's entry while preserving other hashed accounts. It does not pass passwords as command-line arguments. Install the restricted ACL from `deploy/mosquitto/acl.example`, the separately provisioned worker account, and the CA/server certificates. Preserve the broker's required ownership/read permissions on its protected password file. Restart the broker in the maintenance window to reload file mounts and disconnect old sessions.

6. Locally install `device-trust.json`, `gateway-credentials.json` and `mqtt-ca.pem` in gateway LittleFS. Install only its own `device-trust.json` on each target. The firmware validates hardware, installation and gateway identity before using the local credential. Never format or overwrite LittleFS before exporting existing buffered data. The actual partition layout and flash procedure must be verified on the maintenance hardware; compilation does not establish those offsets.
7. Set gateway transport explicitly to `mqtts://<certificate-hostname>:8883`. Configure mesh/uplink settings locally, then activate application access:

   ```text
   python manage.py provision_gateway_credentials activate --gateway <registration-id> --actor <operator-username> --directory <protected-gateway-directory> --broker-host <certificate-hostname> --ca-file <ca-file>
   ```

   Activation requires the matching prepared bundle and successful broker authentication with certificate validation. This proves broker login, not physical delivery or ACL correctness; those remain separate checks. Use discovery and command progress to complete target-device commissioning.

For rotation, invalidate the registration in the UI first and prepare a new bundle in a new protected directory. Install the broker/device updates, restart the broker and activate. For revocation, revoke application access in the UI, remove the broker identity with `install_gateway_broker_password.py --revoke <gateway-node-id> --password-file <path>`, and restart the broker to disconnect existing sessions. Keep the old material protected for the recorded rollback procedure. Key replacement and device site-transfer enrollment require an explicit maintenance procedure; the tools do not silently rewrite existing device trust files.

## Buffer and cutover boundary

The gateway removes an event only after a matching database persistence receipt. MQTT broker acknowledgement alone is insufficient. Flash-write failure cannot report durable retention. A full queue preserves existing unacknowledged events and reports failure to retain new packets; physical capacity/outage behavior still needs hardware testing.

Old-installation or invalid stored records block queue transmission and rewriting. At an explicitly approved cutover, the local serial command `buffer-archive <current-installation-UUID>` atomically preserves the existing snapshot as `/queue-precutover.jsonl` before starting a new queue. It requires configured local trust and refuses to overwrite a previous archive. Export and retain the archive with the database backup; do not import it as new-installation telemetry. Archive export, filesystem installation and power-loss behavior have not been verified on real hardware.

Create the separate clean database only after release gates pass. Keep the existing database, PostgreSQL volume and experimental backend data for rollback. `bootstrap_pilot` is for a clean database and creates the empty Pilot Site plus an interactively created administrator. `check_deployment_readiness` now requires migrations, an installation UUID, mounted enrollment storage, an immutable production build revision and an explicit administrator; Django staff status alone is insufficient. This readiness check does not replace integration or hardware acceptance.

## Verification evidence

Software checks performed against isolated test resources:

| Check | Observed result |
|---|---|
| PostgreSQL regression suite | 55 tests passed; includes forged/peer results, duplicate operations, stale versions, batch rollback, enrollment tooling and administrator readiness |
| Frontend | 35 Vitest tests passed; production TypeScript/Vite build passed; existing Three.js bundle-size warning remains |
| Credential file utility | Five Linux-container tests passed: preserves other identities, hashes only fresh plaintext, cleans up failed preparation revokes only the named gateway and preserves POSIX ownership/permissions |
| ESP32 | Compile passed, huge_app, core 3.3.12; 1,400,075 bytes flash, 57,152 bytes global RAM |
| ESP32-S3 | Compile passed, huge_app and USB CDC, core 3.3.12; 1,373,421 bytes flash, 55,560 bytes global RAM |
| MQTT sustained load | 100 simulated devices, one heartbeat event per second each, 30 minutes: 180,000 persisted events, zero missing receipts, 100 deduplicated replay receipts; completed in 1,806.82 seconds |
| Broker ACLs | Foreign-gateway event publication did not persist; foreign receipts were not delivered |
| Recovery | Ten events queued with the worker stopped survived PostgreSQL/broker restarts; worker recovery persisted all ten; replay recovered ten receipts with ten duplicate flags and no additional records |
| Credential revocation | Test gateway login succeeded before local revocation and was rejected after broker restart |
| Commands over TLS broker | Signed time/provisioning, gateway receipt without commissioning, target confirmation, duplicate audit suppression and late diagnostic expiry passed using a simulated target |

Machine-readable reports are in `docs/verification/`. The load result measures heartbeat-event traffic; full sensor-telemetry workload throughput remains unmeasured. The first sustained attempt accumulated a backlog and was stopped. Persistent worker connections, bounded batch commits and less frequent outbox scans were then introduced. The final 30-minute result above uses those fixes. Batch persistence emits receipts only after the outer transaction commits.

The opt-in `verify_mqtt_integration` management command and `tools/mqtt_recovery_probe.py` / `tools/mqtt_command_probe.py` refuse databases other than `compallette_mqtt_verification`. Their fixed credentials are isolated fixture values, never deployment credentials. The HTTP contract test now requires explicit isolated-installation environment variables; it was not exercised against a live HTTP server in this continuation.

**Not verified:** responsive/browser journeys and screenshots. Computer Use stopped because browser URL-policy enforcement is unsupported for the available Windows browser; no further UI input was attempted. Physical gateway/mesh TLS, clock synchronization, flash durability, buffer capacity, provisioning, alarm continuity and filesystem cutover remain unverified. There is no spare hardware; these require the agreed maintenance window. Backup restoration and fresh-install cutover have not been performed. Deployment remains gated on those checks.

### Browser retry, 21 November 2026

After publishing the integration changes, the isolated Vite fixture at `http://127.0.0.1:3100/tests/browser-fixture.html` returned HTTP 200 from a local HTTP check. The in-app browser still held the earlier connection-timeout error page. Reconnecting to that tab was rejected by the Browser Use URL policy because the browser-generated error page uses a `data:` URL. No policy bypass or operational Firefox interaction was attempted.

This establishes fixture-server availability only. No rendered application flow, screenshot, viewport, theme, keyboard or zoom/reflow check passed in this retry. Resume those checks when the supported browser can access the isolated fixture; retain the hardware and cutover gates above.
