---
name: hacho-frontend
description: Audit, design, refine, and compare ComPallete frontend interfaces using rendered evidence and operator workflows. Use for frontend design, visual hierarchy, usability, accessibility, responsive layout, or UI polish; not for backend or firmware architecture alone.
metadata:
  short-description: Evidence-led design for the ComPallete operator interface
---

# Hacho Frontend

HACHO means Human-first Assessment of Clarity, Hierarchy & Outcomes. Adapted from the user's Hacho 2.0.0 proposal for ComPallete. Improve clarity, consistency, accessibility, and task completion without turning the mining operator cockpit into a marketing site.

## Scope and modes

Infer the mode from the user's request and existing authorization:

- **Audit:** Reviews, assessments, and suggestions are read-only. Identify actionable findings and acceptance criteria.
- **Design spec:** Describe the proposed experience, tokens, components, states, and responsive behavior. Do not implement unless requested.
- **Polish:** Requests to improve, fix, redesign, or implement authorize scoped frontend edits. Inspect the affected experience first, then implement and verify; do not ask again for authorization already given.
- **Compare:** Evaluate revisions against the same workflows, viewports, themes, and states. Distinguish demonstrated improvement from assumptions.

Scale effort to scope. A button fix needs a focused check, not a whole-product audit. Use the full scorecard only for a broad audit or an explicit scoring request. Do not deploy, change data collection, connect external services, or expand into backend/firmware changes merely because frontend work is authorized.

## Project foundations

Resolve these paths from the repository root and inspect current implementations before relying on them:

- `frontend/react/src/index.css`: existing styling, semantic colors, themes, and layout rules.
- `frontend/react/src/platform/`: shared shell, navigation, forms, tables, modal, loading, permissions, and motion conventions.
- `frontend/react/src/pages/` and `components/`: operator journeys and feature interfaces.
- `frontend/react/src/services/api.ts` and `types.ts`: API access and frontend contracts.
- `README.md`: runtime topology, operational constraints, and documented limitations.

Reuse and improve existing components and tokens before creating another design system. Preserve the React/TypeScript/Vite structure and existing dependencies unless the task warrants a change. This skill owns presentation and interaction. For changes that genuinely cross system boundaries, consult [architecture-alignment](../architecture-alignment/SKILL.md); do not load it for ordinary styling work.

## Operator-interface invariants

- Keep backend state authoritative. Do not fabricate readings, worker locations, acknowledgements, successful mutations, or device health to make a screen look complete.
- Make fresh, stale, unavailable, disconnected, loading, and failed states distinguishable. An absent reading is not zero, and loss of contact is not evidence of safety. Show relevant timestamps, age, units, and site/device identity without inventing freshness thresholds.
- Preserve alarm severity and lifecycle semantics. Acknowledging and resolving are different actions. Do not change audio behavior, escalation, alert ordering, thresholds, or dismissal rules as incidental polish. Trace current behavior and seek a product decision only when the requested scope leaves it materially ambiguous.
- Preserve operator permissions, authentication, site context, audit identity, API contracts, and confirmation/error behavior. Never hide a failed command behind a success animation.
- Distinguish experimental or inferred locations from confirmed information. Consult the documented radio-location limitations; do not imply precise or validated tracking from a persuasive visualization.
- Critical status must remain understandable without color or motion alone. Keep urgent actions and information visible during loading, narrow layouts, and overlays where the workflow requires them.
- Prefer stable layouts and readable operational density. Motion and 3D should help orientation or interpretation and must not delay urgent interaction. Respect reduced-motion preferences and retain a usable text/table route to important information presented in a spatial view.
- Use synthetic fixtures only in isolated development or test contexts and identify them clearly. Do not exercise alert mutations, provisioning, or other operational side effects against a live system merely to verify a design.

## Evidence-led workflow

1. Establish affected screens, user tasks, scope, and available evidence. Infer from the repository when possible; ask only when missing information materially blocks progress.
2. Inspect relevant source and, when available, rendered screens. Follow the main task plus relevant loading, empty, error, permission-denied, offline, and success states. Check both supported themes when changing shared styles.
3. Label major claims as **live observed**, **screenshot**, **source code**, **user report**, **analytics**, or **inference**. Mark unavailable checks **NV (not verified)**. Source code alone does not prove rendering; a screenshot does not prove task completion.
4. Identify the smallest coherent design change. Explain hierarchy, density, grouping, typography, color roles, and interaction decisions in terms of the operator's task. Preserve useful existing conventions rather than imposing a trend.
5. In polish mode, implement in focused batches, then verify the affected rendered experience and relevant project checks. Reassess adjacent shared-component consumers where changes can propagate.

For each substantial finding, give the screen/component and source location, viewport/state where known, evidence, user impact, confidence, severity, proposed fix, and a testable acceptance criterion. Use compact prose or a table rather than mandatory long reports.

Severity:

- **P0:** Essential operational journey blocked, materially misleading safety state, or serious exposed privacy/security issue.
- **P1:** Major task friction, inaccessible essential controls, unreadable responsive layout, or unclear alarm/action hierarchy.
- **P2:** Meaningful inconsistency in typography, spacing, state feedback, content, or component behavior.
- **P3:** Optional visual refinement or useful delight.

A critical blocker remains a blocker regardless of an aggregate design score. A design review is not safety certification.

## Design and verification lenses

- **Hierarchy and content:** Prioritize the current task and urgent information. Use explicit labels and recovery instructions. Check long identifiers, large numbers, truncation, and dense tables. Never invent product capabilities, metrics, or operational claims.
- **Visual system:** Audit actual fonts, type scale, spacing, surfaces, semantic colors, borders, focus styles, and icons. Prefer targeted consolidation. Support both themes without changing the meaning of status colors.
- **Interaction:** Check keyboard operation, focus visibility and restoration, modal behavior, validation, disabled/loading states, and honest success/error feedback. Preserve filtering and selection context when appropriate.
- **Responsive behavior:** Choose representative narrow mobile, tablet, and desktop widths plus affected breakpoint boundaries. For broad audits, expand to relevant widths such as 320, 390, 768, 1024, 1440, and 1920 CSS pixels. Inspect overflow, sticky regions, tables, drawers, and spatial controls. Do not conceal operational information simply to fit a screenshot.
- **Accessibility:** Aim for applicable WCAG 2.2 AA criteria. Verify actual contrast combinations, names/labels, landmarks, keyboard order, zoom/reflow, touch targets, reduced motion, and announcements as relevant. Automated checks do not establish conformance. Record actual tools and tested scope.
- **Performance:** Use comparable measurements before claiming improvement. Distinguish lab measurements from field data. For this cockpit, also examine update responsiveness, polling/loading feedback, large tables, and spatial rendering where relevant.

Run available checks appropriate to the change. The frontend currently exposes `npm run build` in `frontend/react`; inspect `package.json` before selecting additional checks. Do not invent lint or test results. A passing build does not replace rendered verification. If browser or runtime access is unavailable, finish authorized source work where feasible and state exactly which behavior remains unverified.

Consult authoritative references when a task needs precise or current criteria: [WCAG 2.2](https://www.w3.org/TR/WCAG22/), [contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html), [reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html), and [Core Web Vitals](https://web.dev/articles/vitals). Do not infer legal or safety compliance from this checklist.

## Optional broad-audit scorecard

Use this only when useful for the requested scope. Rate sufficiently evidenced dimensions from 0 (broken) to 5 (excellent); use NV for insufficient evidence. A dimension is evaluated only when the evidence represents its stated scope, not because one easy check passed.

| Dimension | Weight |
|---|---:|
| Purpose and task clarity | 12 |
| Visual hierarchy and typography | 15 |
| Design system and coherence | 13 |
| Navigation and information architecture | 12 |
| Interaction and task completion | 15 |
| Accessibility and responsive usability | 15 |
| Content, credibility, and media | 8 |
| Performance and technical polish | 7 |
| In-app discoverability and operational requirements | 3 |

For each evaluated dimension, earned points = weight × rating / 5. Report **earned points / evaluated weight**, coverage = evaluated weight / 100, confidence, and excluded dimensions. Never count NV as zero or silently normalize partial coverage into a whole-product score. Below 75 evaluated weight, provide dimension findings only. At 75 or more, a partial aggregate may be shown explicitly as partial; reserve a whole-product score out of 100 for complete coverage. Keep weights unchanged across comparisons unless an explicit rationale is documented. Alarm correctness and other critical blockers are not tradeable against visual points.

## Deliverable

Lead with the practical outcome. For audits, report prioritized findings, evidence limits, and scoped recommendations. For design specs, specify the necessary tokens/components, screen changes, states, responsive rules, and acceptance criteria. For polish, report changed files/screens, what improved, verification actually performed, and remaining limitations. For comparisons, report improvements, regressions, and untested differences.

Do not require a new roadmap, full design system, scorecard, or approval register for every task. Produce those only when they help the requested decision.
