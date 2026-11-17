# Hacho remediation verification — 17 November 2026

## Automated checks

- `npm test`: **23 tests passed** using Vitest 4.1.12, React Testing Library, user-event, and jsdom on Node 24.21.0.
- `npm run build`: **passed** (TypeScript and Vite production build).
- `python manage.py test mining_api.tests --noinput`: **18 tests passed**, using the existing backend image in a disposable container, with networking disabled, source mounted read-only, synthetic environment keys, and Django's temporary SQLite test database. The host Python installation lacks Daphne; no live backend database was used.
- `git diff --check -- frontend/react backend/django README.md`: **passed**.

Coverage includes blank-note API validation and audit preservation; alert action success, rejection and uncertain transport outcomes; draft isolation across selection/filter/site/navigation; newer edits arriving during a pending mutation; session draft disposal; modal focus containment/restoration and backdrop dismissal; environmental failures versus successful empty results; backend-health recovery; chart empty/single/constant/irregular-time data; and duplicate login prevention.

## Rendered checks

Used `tests/browser-fixture.html` in the in-app Chromium browser. The fixture intercepts all fetch calls and never delegates to a backend; its mutations affect only synthetic in-memory records. No production records or Firefox session were modified.

Representative light/dark checks covered 390, 768 and 1440 CSS-pixel viewports, with additional 320-pixel overflow/reflow checks. Screens inspected: alerts and resolution confirmation, dashboard charts, environmental readings, personnel/asset/operator/zone dialogs, and login. This was a targeted verification of affected flows, not an exhaustive visual regression run of every screen/state at every size.

Observed:
- Resolution initially focuses Cancel, rejects blank notes, and reports success only after the synthetic API response.
- Keyboard focus enters the first form field in registration dialogs, wraps inside the dialog, and returns to the opener after Escape/Cancel. Closing removes the overlay immediately, preventing exit-animation focus interception.
- The asset dialog fits at 320 pixels and the personnel dialog remains usable at 390 pixels.
- Failed environmental refresh retains prior readings with an explicit warning and last successful fetch time.
- Failed health refresh changes cached healthy status to Status unverified; subsequent success restores Connected.
- Native-unit chart labels remain readable on mobile after adapting SVG coordinates to actual container width.
- Login uses the shared primary button styling.

Screenshots were saved to the chat's visualization directory:
- `hacho-resolution-mobile.jpg`
- `hacho-environment-tablet-dark.jpg`
- `hacho-login-mobile.jpg`
- `hacho-dashboard-desktop.jpg` (intermediate desktop capture before the final responsive-label/header adjustments)

## Limits and follow-up

- True browser zoom at 200%/400% is **not verified**: the in-app browser ignored zoom shortcuts (reported viewport/device ratio did not change). Narrow-width reflow was checked separately.
- Screen-reader application testing, hardware input, real authentication integration and real operational mutations are **not verified** by this isolated UI fixture.
- The production build still warns about the existing Three.js chunk exceeding 500 kB. The test run emits React Router future-flag and test-plugin deprecation warnings; neither prevented the checks passing.
- Dependency inspection reports six outstanding advisories in the retained dependency tree. The newly added Vitest dependency was updated to 4.1.12 to remove the advisories reported for the initial test-runner version. No broad production dependency migration was attempted.
- Additional pre-existing observations outside this remediation: the dashboard uses a hard-coded 98.4% telemetry-uptime fallback and an unconditional Stable label; the empty user table displays a 1–25 of 0 pagination range; desktop hover/click navigation can require a second activation. These were not treated as proven fixes by this work and warrant a follow-up audit.

## Reproduce UI checks

From `frontend/react`, run `npm run verify:ui`, then open `http://127.0.0.1:3100/tests/browser-fixture.html`. Use the Test scenario control to simulate rejection, lost responses, reading errors, empty readings or disconnection. The fixture is not included in the normal production build. Restart/reload to reset synthetic records.

Deploy the updated frontend before or alongside the resolution API validation. No database migration is needed; API clients must send non-empty resolution notes. These checks were completed before deployment.
