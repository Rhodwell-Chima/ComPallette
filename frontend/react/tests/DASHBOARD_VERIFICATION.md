# ComPallette dashboard implementation and verification

## Outcome and baseline audit

The Operations cockpit now opens with the selected site, the status of its dashboard snapshot, and unresolved incidents. A compact metrics strip, recorded zone associations, environmental readings, monitoring history and authorized operator activity follow in that order. Core information appears without a page transition or an animated count.

The baseline build succeeded and all 42 frontend tests passed. The rendered baseline fixture showed a hard-coded 99.8% uptime value, a green live label with no freshness check, and an “All Clear” severity widget beside a nonzero critical count. Four range buttons changed request keys while Django always returned the same 12-hour window. The first incident row appeared below the fold in each sampled viewport. Navigation and dashboard both offered administrative shortcuts. The dashboard API included audit details for view-only members and ignored the frontend's `site_id` parameter, allowing a fallback to another permitted site.

The design keeps the existing cockpit typography, theme and navigation. It uses operational priority, familiar table and list layouts, visible text for abnormal conditions and progressive disclosure for history and longer queues. References informed the design and accessibility checks. [DesignMonks dashboard guidance](https://www.designmonks.co/blog/dashboard-design-dos-and-donts) · [Figr dashboard guidance](https://figr.design/blog/dashboard-design-dos-donts-rules) · [ISA-101 overview](https://www.isa.org/standards-and-publications/isa-standards/isa-101-standards) · [WCAG 2.2](https://www.w3.org/TR/WCAG22/) · [WAI-ARIA Authoring Practices](https://www.w3.org/WAI/ARIA/apg/)

## Widget inventory and data definitions

| Region | Definition and operator action |
| --- | --- |
| Snapshot integrity | Shows browser receipt time and server generation time in the selected site's timezone. Initial pending, unavailable, offline and unverified states are distinct. A failed refresh retains data from the same verified site with an explicit previous-snapshot label. A 30-second dashboard freshness budget is derived from two 15-second polling periods. Server timestamps outside that tolerance also mark the snapshot unverified. This policy applies to the dashboard snapshot. Individual readings retain their own receipt timestamps. |
| Unresolved incidents | Site-wide total and critical count exclude resolved incidents. The API returns up to eight, ordered by severity and newest first within each severity. Three appear initially. Severity, lifecycle, reporting device, time and zone are shown as text. The incident queue stays one click away. Review links open the requested incident even when it falls outside the queue's normal response, and resolution still requires its existing explicit workflow and permissions. |
| Operational metrics | **Online devices** counts persisted online node records. The accompanying degraded count includes stale and offline nodes. **Personnel with online nodes** counts personnel whose assigned node is online. **Registered assets** counts site asset records. Links open the appropriate operational detail. Missing counters display “Unavailable” and valid zeroes remain visible. |
| Recorded zone associations | Lists counts of assigned personnel and assets linked to recorded node zones, for up to six zones. These are associations and may include older observations. The Digital Twin route supplies individual location evidence and retains its existing scene and fallback. The dashboard remains usable without a 3D canvas. |
| Latest environmental readings | Shows up to five last-reported streams with measurement, device, zone, source unit and receipt timestamp. Django selects the newest physical reading per device and measurement. The dashboard rejects missing values as measurements, preserves zero, and links to the full site reading catalog. |
| Monitoring history | A fixed 12-hour window in site time, with one-hour means for CO in ppm and dust in µg/m³. The unresolved-incident series counts alarms active at each bucket end. Simulation records and mismatched measurement units are excluded from the averages. Empty samples create gaps. Keyboard-operable series controls and a table provide an equivalent way to inspect the plotted values. |
| Recent operator activity | Up to twelve persisted site audit entries. Filtering by alerts, users/access and devices operates locally. The section links to the authorized audit route. Site viewers receive an empty audit list from the server. Activity is hidden during a transient failure to verify site access. |

The uptime card, severity donut, unsupported range selector, snooze controls and duplicate administration shortcuts were removed. The header's global health indicator still represents backend connectivity. The dashboard integrity strip reports freshness and availability of the site's dashboard response.

## Architecture, dependencies and operations

- `DashboardPage.tsx` owns the snapshot query and view state. `pages/dashboard/` contains presentation components, data helpers and container-query styles. The existing chart component retains time-proportional SVG and uses independent scales and a disclosure for the table. Existing Tailwind utilities, semantic colors, CVA variants and Lucide icons support the layout. Simple color transitions respect reduced motion.
- Container widths of 32, 44 and 58 rem govern the metric strip, paired operational panels and history/activity layout respectively. The site selector and sidebar remain in the existing shell. The incident preview and disclosures support keyboard and touch, and the chart table can scroll inside the card. No new overlay, widget rearrangement, monitoring connection or dependency was introduced.
- The existing operator QueryClient owns a single dashboard poll keyed by site and audit scope. Requests consume its abort signal, and inactive dashboard entries are cleared so audit-bearing snapshots do not linger when scope changes. Manual refresh, reconnect and normal polling share the same query. Cached bootstrap data keeps the authenticated shell open during transient transport failure. Authorization and incompatible-contract failures retain their existing error paths. [TanStack Query cancellation](https://tanstack.com/query/latest/docs/framework/react/guides/query-cancellation)
- Django accepts `site` and the frontend's `site_id` in the shared resolver. Dashboard responses add generation time and history-window fields. Frontend compatibility for older responses uses receipt time and the established fixed window. Alert ordering and audit filtering are enforced server-side. Site details, alert mutations, thresholds, ingestion, ESP32 sampling and positioning logic retain their existing owners.
- No packages or lockfile changes were needed. Verified React 18.3.1, React Router 6.30.6, TypeScript 5.9.3, Vite 5.4.21, Tailwind and its Vite integration 4.3.5, TanStack Query 5.106.1, Framer Motion 11.0.0, Lucide 0.468.0, CVA 0.7.1, Vitest 4.1.12 and Playwright 1.65.1. Three.js 0.186.1, React Three Fiber 8.17.14 and Drei 9.100.0 still compile into the existing lazy Twin route. The tested 2D workflow does not establish 3D GPU compatibility.

## Measurements and evidence

| Edge fixture viewport | First incident row before | First incident row after |
| --- | ---: | ---: |
| 390×844 | 2,244 px | 417 px |
| 768×1024 | 1,815 px | 288 px |
| 1440×900 | 1,241 px | 303 px |

- The original dashboard issued 24 hourly measurement aggregates and 12 hourly alert counts. The revised queries produce all buckets using two aggregate statements. A window query retrieves the newest reading for each stream in one statement. The isolated Django test captures the two SQL statements touching the readings table. These are query-count measurements and do not represent production latency. [Django window and aggregate expressions](https://docs.djangoproject.com/en/6.0/ref/models/expressions/)
- The browser fixture verifies that switching historical series and opening the data table leave the site dashboard request count at one before the first scheduled poll. The history chart's resize observer responds to its panel width, including sidebar expansion.
- The Vite baseline was 204.31 kB of compressed entry JavaScript and 13.36 kB of compressed CSS. The revised entry JavaScript is 203.57 kB gzip and CSS is 14.93 kB gzip. The existing large-chunk warning remains and the 3D chunk stays deferred.
- Edge sampling of the incident heading, integrity text, degradation note and queue link measured contrast ratios from 5.75:1 to 9.49:1 across light and dark. Separate disposable browser profiles verified 200% and 400% page zoom, with effective widths of 628 and 314 CSS px. The open chart-data disclosure caused no workspace or document overflow.
- Before and after screenshots are in the ignored `test-results/` folder for 390, 768 and 1440 px. The Playwright viewport matrix also captured full-page light and dark states and checked 16 widths from 320 to 2560 px, short landscape, sidebar expansion/collapse and chart state retention. Its browsers use synthetic data and ordinary browser input.

## Executed verification

| Check | Result |
| --- | --- |
| Production build | Passed TypeScript and Vite |
| Vitest | 46 passed, including all 42 existing tests |
| Combined Playwright suites | 127 passed across Edge Chromium, Firefox and WebKit, including 24 dashboard checks and 103 navigation checks. Two existing navigation contrast checks are scoped to Chromium. |
| Django app suite on temporary SQLite | 81 passed and one PostgreSQL-only test was skipped. The focused dashboard SQL-count test passed separately. |
| Django platform suite on disposable PostgreSQL 16 | All 24 passed, including the dashboard queries, permissions and the PostgreSQL-only concurrency test. |

## Files and reproducibility

- Frontend dashboard and chart code is under `src/pages/DashboardPage.tsx`, `src/pages/dashboard/` and `src/components/PrimaryTimelineChart.tsx`. Scoped alert review, transport, types and bootstrap failure behavior are integrated in `AlertsPage.tsx`, `services/api.ts`, `types.ts` and `platform/`.
- Django dashboard aggregation, review scope and endpoint checks are in `backend/django/mining_api/views.py` and `test_platform.py`. The changes are compatible with the existing database schema.
- From `frontend/react`, run `npm run build`, `npm test`, `npm run test:dashboard` and `npm run test:navigation`. Playwright projects use Chromium, Firefox and WebKit. On Windows the Chromium project can use Edge through `COMPALLETTE_PLAYWRIGHT_CHANNEL=msedge`. The fixture serves synthetic data on loopback and never contacts operational services.

## Remaining rollout checks

Physical devices, assistive-technology sessions, production credentials, real telemetry, large production database latency and 3D rendering on industrial hardware require field verification. The existing incident queue still has a 100-record response cap. The dashboard endpoint supports one historical window and does not supply gateway uptime or positioning-confidence summaries. Supporting those features or an exhaustive incident history would require backend work.
