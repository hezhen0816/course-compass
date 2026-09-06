# Web frontend refresh — 2026-09-06

## Scope

Refresh the existing desktop-first product without changing official selection requests, persistence, or authentication.

- Course search uses two columns with a collapsible virtual-course list below results. The action column stays visible during horizontal scrolling.
- Settings separates thresholds, synchronization, and the school account. Switching sections preserves the local form draft.
- Planning removes duplicate metrics and the unused category legend. Official cache timestamps include the date and expired sessions are explicitly labeled. Conflict copy names its existing virtual-course-only scope.
- History uses neutral rows with aligned grades. Empty semesters are collapsed by default.
- Graduation now displays passed imported records against configured thresholds. In-progress, failed, and virtual courses are excluded from this page; the planning workspace keeps its broader existing statistics. Uncategorized credits require classification before they can satisfy departmental thresholds.
- An empty grade calculator displays an unconfigured state, alongside the recorded grade when present.
- Navigation returns to the top on page changes; focus outlines and accessible control names are improved.

## Validation

- Web TypeScript/Vite build and ESLint passed.
- Chrome, authenticated localhost: settings categories; course search via Enter; six-result table; virtual-list expansion and navigation to planning; history details; graduation totals and mobile reflow.
- Graduation's displayed earned total matched the visible semester credit sum minus the failed course. No official sync or selection writes were triggered.
- Narrow viewport checked at 390 × 844 for settings and graduation; restored the original viewport afterward.
- Screenshots are local temporary artifacts under `/tmp/course-compass-design-audit-20260906/after-*.png`, excluded from Git because they contain account data.

## Limits

- No production data edits, official registration, ordering, or removal were exercised.
- Full keyboard/screen-reader coverage and the complete phone selection workflow remain untested.
- Timetable cells retain per-period rendering; continuous merged course blocks are not part of this change.
- Existing build warnings about dependency metadata and bundle size remain.
