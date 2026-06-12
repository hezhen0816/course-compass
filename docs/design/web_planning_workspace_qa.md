# Web Planning Workspace Design QA

**Findings**
- No actionable P0/P1/P2 findings remain.

**Source Visual Truth**
- `/Users/hezhen/GitHub/course_planner/docs/design/reference-images/待選清單與志願排序.png`
- `/Users/hezhen/GitHub/course_planner/docs/design/reference-images/課表規劃.png`

**Implementation Evidence**
- Local URL: `http://localhost:5173/`
- Screenshot: `/tmp/course_planner_planning_workspace_top_crop.png`
- Full-view comparison: `/tmp/course_planner_planning_workspace_comparison.png`
- Viewport: cropped in-app browser content, `1495 x 834`
- State: logged-in web app, merged planning workspace, `初選志願` mode, active semester empty state.

**Capture Notes**
- Codex in-app browser automation was unavailable in this run because the Node REPL did not expose the `browser` object after reset.
- Evidence was captured through the visible Codex desktop browser using `screencapture`, then cropped to the browser content area.

**Fidelity Surfaces**
- Fonts and typography: implementation keeps the existing 修課羅盤 type scale and uses dense dashboard labels, metric cards, and compact planner text consistent with the two references.
- Spacing and layout rhythm: the merged workspace uses the target three-zone layout: left待選/志願序, center週課表, right規劃檢查. The section sits below the course query center because this is an integrated app screen rather than a standalone route.
- Colors and visual tokens: blue primary actions, amber競爭組 warnings, red衝堂 states, emerald completion states, slate borders, and white cards follow the reference direction and existing app tokens.
- Image quality and asset fidelity: source references are UI screens with no required raster assets beyond product chrome. Implementation uses the existing Lucide icon set already used by the app and does not add placeholder imagery.
- Copy and content: the workspace explicitly separates `初選志願`, `加退選`, and `加簽追蹤`; it explains that同時段多課 in initial selection is a競爭組, while add/drop treats overlaps as real conflicts.

**Patches Made Since Previous QA Pass**
- Merged the main nav by removing `待選清單` as a primary tab and changing it to `課表規劃 {count}`.
- Added planning mode state: `初選志願`, `加退選`, and `加簽追蹤`.
- Changed scheduling behavior so `初選志願` mode allows same-slot courses without a conflict confirmation.
- Replaced the old schedule preview with a three-column planning workspace.
- Added right-side planning checks for credits, wishlist count, competition groups, true conflicts, and graduation-gate impact.

**Open Questions**
- The current logged-in account has no scheduled courses in the active semester, so the screenshot validates the empty-state layout. Filled-card states are implemented but should be rechecked after adding several same-slot courses.
- Drag-and-drop ranking is not implemented yet; this version uses existing data order as the displayed priority.

**Implementation Checklist**
- Unify待選清單 and課表規劃 into one planning workspace.
- Support選課階段 interpretation without changing the database schema.
- Surface same-slot groups as競爭組 in initial selection and true conflicts in add/drop mode.
- Preserve course detail editing, delete actions, search-to-schedule flow, and existing graduation stats.
- Keep official submission conservative: no auto sniping, polling, scheduled submit, or automatic retry.

**Follow-up Polish**
- Add drag-and-drop or up/down controls for priority order.
- Persist planning mode and rank order once the schema decision is made.
- Re-test filled visual states using a sample account or demo fixture with multiple same-slot wishlist courses.

final result: passed
