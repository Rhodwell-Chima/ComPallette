# Digital Twin verification

The redesign was implemented on `main` at `6dee64f`. The attachment contained the written brief. Paired captures use the existing route at that commit as the baseline with the same isolated fixture data in each version.

## Contract and workflows

| Workflow | Source and behavior |
| --- | --- |
| Open the selected site's plan | The route uses `PlatformContext` and `platformApi.twin(siteId)`. The Django producer scopes nodes, zones, and layout to the permitted site. The query key and workspace state are site-specific, and the page verifies the response's site ID before displaying it. |
| Read the layout | The layout version identifies the saved plan. A polygon links to a managed zone through `properties.zone_id`. Both views use the same parsed geometry. The 3D thickness is schematic. |
| Search and inspect trackers | The response uses `node_id` as the stable entity ID. A label may come from assigned personnel or an assigned asset. The tracker list filters label, node ID, zone code, and managed zone name. The map layer toggles are independent. |
| Inspect location evidence | For example, fixture tracker `TRK-104` has confirmed evidence for zone ID `100`. The matching plan feature supplies the zone outline. Its badge counts mapped trackers belonging to that zone. Selecting the tracker highlights the zone in either view and opens the inspector with its location timestamp and device status. A last-known observation uses an amber dashed treatment and unknown evidence stays in the list. |
| Inspect a zone or open device diagnostics | A zone can be opened from the plan or the mapped-zone selector. The inspector lists trackers reported in the zone. A selected tracker still links to its existing device detail route. |
| Read freshness and topology | Retrieval time comes from the query's last successful update. Observation time comes from the entity. The producer currently returns an empty topology and reports that validated direct link evidence is pending. The page displays one topology status and renders the physical plan independently. |
| Switch levels | A level option appears when mapped zones have an explicit level ID. The response provides level names but no authoritative sort order. The options are ordered by name, and the all-features view keeps geometry that has no level association. |

The contract provides no tracker coordinates, surveyed depth or elevation, map scale or north orientation, or validated topology edges. The route also has no data for playback, environmental overlays, or alert annotations.

## Changed files

- `src/pages/TwinPage.tsx` owns the query states, controls, tracker list, and inspector.
- `src/pages/twin/model.ts`, `PlanMap.tsx`, `SchematicMap.tsx`, and `twin.css` provide the shared zone model, two renderers, and route-scoped styles.
- `src/index.css` drops the retired Twin styles.
- `tests/browser-fixture.tsx`, `tests/twin/fixture.ts`, and `tests/twin/twin.spec.ts` provide isolated browser scenarios and regression assertions.

`package.json` and the lockfile have no diff.

## Running the isolated checks

```powershell
npm test
npm run build
$env:COMPALLETTE_PLAYWRIGHT_CHANNEL = 'msedge'
npm exec -- playwright test tests/twin tests/navigation tests/dashboard --project=chromium
```

Run from `frontend/react`. The browser fixture serves synthetic plans, timestamps, and trackers. Its delay and failure cases never contact an operational backend.

## Results

- Vitest passed 46 tests. The production build passed. Vite reported its size advisory for the app and lazy 3D chunks.
- Edge passed all 50 Twin, Dashboard, and navigation tests. The Twin checks covered search and layer independence, pointer and keyboard zone inspection, focus restoration, site switching with a late response, refresh failure and retry, empty and invalid data, location evidence, WebGL initialization and context-loss fallback, camera stability during refresh, and mobile touch scrolling and reflow at 390px and 320px.
- Firefox and WebKit passed the ten applicable core Twin checks. Four Chromium-specific checks were skipped across the two engines. These cover software WebGL and Chromium's touch-gesture driver.
- Desktop dark 3D, desktop light 2D, and mobile dark 2D were visually inspected in Edge. Physical mobile hardware, assistive technology, and live operational data were outside the isolated verification.
