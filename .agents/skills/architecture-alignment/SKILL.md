---
name: architecture-alignment
description: Review and improve this repository's backend, frontend, and ESP32 firmware architecture. Use when checking design alignment, finding cross-layer contract drift, or correcting structural and maintainability problems in this project.
metadata:
  short-description: Align and review the full-stack architecture
---

# Architecture Alignment

Review and improve the ComPallete system as one product spanning ESP32 firmware, backend services, and the React operator cockpit. Apply established design principles where they address an observed problem; do not impose a fashionable architecture or rewrite working code for stylistic uniformity.

## Repository context

- `ComPallete/` is the Arduino ESP32 firmware and owns hardware access, sampling, local safety behavior, mesh communication, offline buffering, and gateway transport.
- `backend/django/` is the supported production-shaped API and system of record. It owns wire validation, persistence, operator authentication and authorization, provisioning workflows, audit history, and watchdog state.
- `frontend/react/` is the operator interface. It owns presentation and interaction, and consumes backend contracts; it must not become a second source of business truth.
- `backend/rocket/` is an experimental comparison implementation. Its presence does not make it the production backend. Treat parity as a requirement only when the task asks for it.
- `server/` is a legacy prototype, not a supported fallback. Avoid extending it unless explicitly requested.
- `tests/`, `tools/`, and the root `README.md` document important protocol, safety, and operational expectations. Check the relevant existing sources before changing architectural behavior.

## Working approach

1. Establish the requested scope and inspect the relevant modules, repository guidance, existing tests, and documented runtime topology. Trace the affected behavior across firmware, transport contract, backend, persistence, and UI as far as the change requires.
2. Identify concrete misalignments. For each, state the evidence, the affected boundary, and the practical consequence. Distinguish bugs and contract violations from optional design preferences. Prioritize correctness, safety, security, data integrity, deployability, and changeability.
3. Recommend a proportionate target that fits current technologies and deployment. Prefer clear module boundaries, cohesive responsibilities, explicit dependencies, typed data at boundaries, and small interfaces. Use layers, ports/adapters, state machines, or domain services when they simplify a demonstrated concern; do not add indirection without a benefit.
4. When asked to correct issues, make the smallest coherent change that resolves the cause across affected layers. Preserve compatibility where feasible; if a wire or API contract must change, update all participating producers and consumers and document migration or version implications. Keep experimental and legacy implementations clearly scoped.
5. Report findings and edits with file references, rationale, remaining risks, and verification performed. Be explicit about any issue that needs a broader product or operational decision.

## Design checks

### System boundaries and contracts

- Keep hardware-specific drivers behind firmware interfaces such as the sensor HAL. Keep hardware timing, memory, flash-wear, reconnect, and offline constraints visible in firmware design; do not transplant server-side abstractions that do not fit an MCU.
- Keep the wire protocol and API as explicit boundaries. Compare envelope fields, message types, units, enum values, identity, sequence/idempotency behavior, validation, errors, authentication, and versioning between firmware serializers, Django validation/views, frontend types/services, and contract tests.
- Keep the backend authoritative for persisted state and operator decisions. The UI may format and derive display values, but should not silently invent device state or duplicate authorization rules.
- Keep transport, validation, application decisions, and persistence separable enough to reason about. In Django, choose serializers, focused services, and transaction boundaries according to actual reuse and invariants; avoid moving everything into generic service/repository layers by default. In React, separate API access, domain-facing types, state, and rendering where it improves reuse or clarity.
- Treat Rocket as an independent implementation with documented parity gaps. Do not route production traffic to it or claim behavioral equivalence based only on shared endpoint names.

### Safety, security, and data integrity

- Preserve local firmware alert behavior through network loss. Cloud availability must not be a prerequisite for local detection or alarming.
- Treat telemetry retries and offline replay as normal. Check idempotency keys, sequence rollover, ordering, duplicate handling, durable buffering, and alert priority before changing ingestion or persistence.
- Preserve authenticated operator identity and authorization on privileged actions; do not trust a client-supplied officer name as proof of identity. Preserve CSRF protections for cookie-authenticated mutations and device authentication for ingestion routes.
- Keep validation at trust boundaries and enforce invariants transactionally where concurrent requests could violate them. Avoid exposing credentials, sensitive configuration, or unvalidated device input in logs and UI.
- Do not imply that a software design review certifies sensors, thresholds, radio-based location, or a safety system. Keep experimental inferences distinct from confirmed state and respect documented pilot limits.

### Maintainability and evolution

- Prefer explicit ownership and one canonical definition for shared concepts, while accounting for language boundaries where generated shared types are impractical.
- Keep persistence schema changes in migrations and maintain data compatibility deliberately. Consider existing records, deduplication constraints, and rollback/deployment order when changing models.
- Avoid hidden coupling through global mutable state, duplicated policy, oversized modules, UI components that perform transport and business workflows, or firmware loops that combine unrelated responsibilities.
- Use patterns only to reduce real coupling or clarify lifecycle and invariants. Keep abstractions small enough to follow from call site to implementation.
- Update API/protocol documentation and relevant tests when observable contracts change. Do not modify unrelated components merely to make the repository look more uniform.

## Verification

Use the project's existing checks that directly cover the changed behavior when verification is requested or needed to substantiate a claim. Select narrow checks first, then broader checks when the change crosses boundaries. Do not claim runtime, hardware, security, or production validation that was not actually performed. If firmware cannot be built or exercised in the available environment, say so and identify the specific unverified part.

## Review output

For a review, lead with actionable findings ordered by impact. Include the code location, the violated invariant or boundary, the consequence, and a concrete correction. If there are no material findings, say so and mention scope or blind spots.

For corrective work, summarize the architecture issue, changed boundaries and files, compatibility effects, and checks actually run. Separate completed fixes from follow-up recommendations.
