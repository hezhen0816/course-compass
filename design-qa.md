**Findings**
- No actionable P0/P1/P2 findings remain.

**Source Visual Truth**
- `/Users/hezhen/GitHub/course_planner/前端參考圖/課程查詢中心.png`

**Implementation Evidence**
- Local URL: `http://localhost:5173/`
- Screenshot: `/tmp/course_planner_query_center_search_final.png`
- Full-view comparison: `/tmp/course_planner_query_center_comparison.png`
- Viewport: `1567 x 834`
- State: logged-in web app, course query center, query `資料結構`, 7 results visible.

**Fidelity Surfaces**
- Fonts and typography: implementation keeps the existing 修課羅盤 font stack and hierarchy, with dense table text and compact controls matching the reference intent.
- Spacing and layout rhythm: three-column structure, top tab row, warning banner, result table, and right-side pending list align with the reference. Existing product header and workspace title remain intentionally above the reference-like tool surface.
- Colors and visual tokens: blue primary actions, green schedule actions, amber safety banner, slate borders, and neutral cards follow the reference and existing app tokens.
- Image quality and asset fidelity: source design has no raster content beyond UI chrome; implementation uses existing icon library and no placeholder image assets.
- Copy and content: course query, pending list, no-auto-sniping warning, export action, filters, and schedule planning copy are present. The implementation uses actual local course data rather than the static mock data from the reference.

**Patches Made Since Previous QA Pass**
- Reduced the course-center grid side columns from `260/320` to `240/300`.
- Reduced the result table minimum width from `920px` to `880px`.
- Tightened table cell padding and note width so the action column is visible in the first viewport.

**Open Questions**
- The reference shows a fully populated pending list; the current screenshot has no pending items because the live account did not have courses added from this query state. The component renders pending requirements when present.
- Mobile was not separately captured because the current Codex in-app browser session exposes a fixed viewport. The layout uses responsive one-column stacking and table horizontal overflow for narrow screens.

**Implementation Checklist**
- Implement course-query tabs and safety banner.
- Add left-side filters for semester, query mode, teacher, requirement type, credits, time, and capacity.
- Render result table with course code, name, teacher, credits, time, classroom, capacity, note, add-to-pending, and schedule actions.
- Render right-side pending list summary and schedule-planning CTA.
- Preserve existing planner, sync, graduation, history, and iOS-compatible data behavior.

**Follow-up Polish**
- Add department filter once official query source exposes a reliable department field.
- Add pagination when official results exceed a comfortable table length.
- Add drag-and-drop ordering for pending selections in the next workflow.

final result: passed
