# ComPallette navigation implementation and verification

## Outcome

The authenticated cockpit now has a 60 px utility header, a grouped sidebar on desktop, an icon rail on tablets, and a modal drawer on phones and short landscape viewports. All three layouts use one typed destination list. Incidents have a dedicated header link with the selected site's new-alert count. Site selection, search, diagnostics, theme switching and sign-out are reachable on small screens.

## Audit and destination inventory

The previous desktop menu duplicated Dashboard through the brand link, Digital Twin through three launch paths, Users & Access through two menus, Alerts through the Operations menu and header, and Settings through up to three controls. Mobile omitted Integrations and duplicated theme and sign-out controls. Exact-path dropdown checks missed nested records and the Gateways route. The hover menus and mobile panel lacked consistent focus and dismissal behavior. Browser measurements confirmed header wrapping at 320–768 px and horizontal overflow at 1280 and 1440 px.

| Location | Destinations | Access and behavior |
| --- | --- | --- |
| Operations | Dashboard `/`, Digital Twin `/twin`, Personnel `/personnel`, Assets `/assets`, Environmental `/environment` | Available in authenticated operations. Personnel and Assets remain current for their nested detail routes. |
| Incident utility | Alerts & Incidents `/alerts` | One header destination, with a badge from the existing site-scoped NEW-alert polling query. |
| Infrastructure | Devices & Mesh `/devices`, Gateways & Commissioning `/gateways`, Sites & Zones `/sites-zones`, Integrations `/integrations` | Gateways follows the existing `manage_devices` page requirement. Device detail routes retain their active parent. Sites & Zones supports authorized read access and keeps `manage_sites` for mutations. Integrations is an existing read-only destination and now also appears in the drawer. |
| Records | Reports `/reports`, Audit Trail `/audit` | Audit requires `view_audit`. Reports retains its site scope. |
| Administration | Users & Access `/access`, Settings `/settings` | Requires `manage_users` or `manage_settings` respectively, matching the route guards. Empty groups are omitted. |
| Header utilities | Site selector, site-record search, connection diagnostics, account menu | Existing actions and API contracts. The account menu contains the theme control and the single shell sign-out action. Page-level workflow links remain available. |

## Implementation

- The drawer is used below 640 px and in short tablet landscape below 384 px in height. The tablet rail is 72 px wide. From 1024 px, the sidebar expands to 236 px and can collapse to the same 72 px rail. The thresholds use the browser viewport so scroll locking leaves the selected navigation mode stable. Desktop preference uses a single local-storage flag. The sidebar and drawer have independent scrolling and safe-area spacing. Large displays use the same header and sidebar dimensions.
- Tailwind CSS v4 builds navigation utilities from the shell files. Semantic colors reference the existing light and dark theme variables. Shell dimensions, focus styles, overlay order and animation timings are defined together. The build omits Tailwind Preflight to preserve existing page styling. [Tailwind Preflight documentation](https://tailwindcss.com/docs/preflight)
- The source-owned Sheet/Dialog follows the shadcn composition pattern with Radix focus management, Escape and outside dismissal, modal scroll locking and portal placement. Radix Dropdown Menu, Tooltip and Popover handle their respective keyboard, pointer and touch interactions. CSS owns portal entrance and exit so Radix can coordinate unmounting. Exiting drawer content is inert. [Radix animation lifecycle](https://www.radix-ui.com/primitives/docs/guides/animation)
- Framer Motion owns the desktop sidebar width transition and the shared active-link indicator. The Digital Twin commits sidebar width instantly to limit map resize work. Reduced motion disables navigation movement. Routes render directly in the shell without the previous full-page slide. Lucide icons use accessible names on their controls and are hidden from assistive technologies where decorative.
- React Router owns active state and retains the existing route tree, nested URLs and query parameters. The shell moves focus to main content on path changes and offers a skip link. The drawer restores focus after dismissal and clears when the viewport changes layout. Search uses the selected site, includes explicit pending, empty and error states, and supports Ctrl+K or Command+K. The old single-character shortcut was removed.
- The authenticated session, query cache and alert draft provider stay mounted across navigation. The existing 5-second NEW-alert and 15-second backend-health polling intervals remain in use. Badge updates are immediate when data arrives, failed polling is identified, and missing diagnostic values are shown as unavailable. The API caps the NEW-alert response at 100, so the badge shows `99+` and announces at least 100. The existing frontend transport uses polling.

## Dependency audit

| Area | Installed version and use |
| --- | --- |
| Existing runtime | React and React DOM 18.3.1, React Router DOM 6.30.6, TanStack Query 5.106.1, Lucide 0.468.0 and Framer Motion 11.0.0. The existing `framer-motion` entry point serves the whole app. |
| Existing in the working tree | Radix Dialog 1.3.1, Dropdown Menu 2.2.1, Tooltip 1.4.1 and Tabs 1.2.1. CVA 0.7.1, clsx 2.1.1 and tailwind-merge 3.7.1 supply typed and merged navigation classes. No shadcn registry configuration was present. |
| Added | Tailwind CSS 4.3.5 and its Vite integration 4.3.5, Radix Popover 1.3.1, and Playwright Test 1.65.1. The build integration and browser runner are development dependencies. |
| Build and tests | npm 11.19.0, Node 24.21.0, Vite 5.4.21, TypeScript 5.9.3 and Vitest 4.1.12. The npm lockfile remains in use. Existing locked package versions were retained. |

There were no dependency migrations or removals. Radix retains its transitive positioning dependencies. Floating UI and the separate Motion package are absent from the direct dependency list. npm reported six advisories in the installed dependency tree, matching the count recorded in the previous verification. Tailwind v4 targets modern browsers. Older industrial browser shells require a compatibility check before rollout.

## Measurements and verification

| Measurement | Original | Revised |
| --- | ---: | ---: |
| Header at 390 px, isolated Alerts fixture | 206 px | 60 px |
| Document width at a 1440 px viewport | 1802 px | 1440 px |
| Eager JavaScript, Vite gzip output | 407.12 kB | 204.31 kB |
| Workspace width at 1440 px | Full-width header layout | 1204 px expanded, 1368 px collapsed |

The original HTML preloaded the 3D chunk. The revision loads Digital Twin on demand, keeps the shell usable during that load, and shows an explicit reload action if the route chunk fails. The lazy chunk is about 250 kB gzip. The initial JavaScript asset is about 667 kB before compression and still exceeds Vite's reporting threshold, as does the lazy Twin asset.

The compiled app was also checked at 390 px using Vite preview and intercepted API responses. Alerts rendered through the production entry point. With the deferred Twin JavaScript request deliberately failed, the error stayed inside the workspace and Alerts remained reachable from the shell.

In headless Edge at 1440×900, four sidebar toggles each on the dashboard and the synthetic 2D Twin showed maximum sampled animation-frame gaps of 16.9 ms and 17.2 ms respectively. No gaps exceeded 25 ms and no long tasks were reported in those eight 400 ms samples. The map stayed mounted while its viewport resized. These are local fixture measurements.

Focused browser tests exercise unique destinations, keyboard navigation and focus, history and deep links, permission changes, touch input, theme persistence, slow search, auth expiry, unavailable and stale monitoring data, drawer resizing, desktop preferences, and the operational map. The 20 responsive cases cover 314–2560 CSS px, both major breakpoint boundaries, and short landscape. The Chromium contrast test checks selected navigation labels against 4.5:1, the keyboard focus outline against 3:1, and rendering in forced colors. Scope is the navigation shell and sampled states. [WCAG 2.2](https://www.w3.org/TR/WCAG22/)

The production build and all 42 existing Vitest tests passed. Playwright recorded 103 passes across Edge Chromium (35), Firefox (34) and WebKit (34). The rendered contrast test ran in Chromium and was skipped in the two other engines. Screenshot review included the 390 px drawer, 768 px dark rail, 1440 px desktop sidebar, and the 1024 px synthetic Twin workspace.

Separate Edge runs applied actual page zoom through disposable browser profiles. At 200% and 400% the effective viewports were 628×404 and 314×202 CSS px. The header and document fit their viewports, and Settings was reachable by scrolling and using the drawer. [Chromium page zoom preferences](https://chromium.googlesource.com/chromium/src/+/lkgr/chrome/browser/ui/zoom/chrome_zoom_level_prefs.cc)

## Files and reproduction

- `src/platform/navigation/` owns the typed destinations, shared navigation list, responsive controls, dialog and search, Tailwind styling and class variants.
- `src/platform/AppShell.tsx`, `Navbar.tsx`, `BackendConnection.tsx` and `src/App.tsx` integrate the shell, utility state, route guards and lazy Twin. The legacy navigation CSS was removed from `src/index.css`.
- `playwright.config.ts`, `tests/navigation/navigation.spec.ts` and the Vite browser fixture run the actual application route tree on an isolated fixture server. The fixture never delegates API calls to an operational backend. Failure traces and sample screenshots go in the ignored `test-results/` directory.

From `frontend/react`, run `npm run build`, `npm test` and `npx playwright install chromium firefox webkit` followed by `npm run test:navigation`. To use installed Edge on Windows, set `COMPALLETTE_PLAYWRIGHT_CHANNEL=msedge` and run `npm run test:navigation -- --project=chromium`. No repository CI workflow or frontend lint script was present.

Manual verification remains for physical devices, assistive technology, production credentials and telemetry, and constrained industrial hardware. For rollout, exercise those environments with real site permissions, representative dashboards and a 3D Twin scene.
