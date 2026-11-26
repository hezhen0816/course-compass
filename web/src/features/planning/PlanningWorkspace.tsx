import { currentEnrollmentPhase, formatPhaseRange, nextEnrollmentPhase, type EnrollmentPhase } from '../../shared/domain/enrollmentCalendar';
import { useMemo, useState, type CSSProperties } from 'react';
import { buildSemesterView, type SemesterBlock } from '../semester/semesterModel';
import { WeekGrid } from '../semester/WeekGrid';
import { CourseSheet } from '../semester/SemesterPage';
import { ArrowDown, ArrowUp, Loader2 } from 'lucide-react';
import type { AppData, Course, GpaStatus, OfficialSelectionRegisteredCourse, OfficialSelectionRequiredPresetCourse, OfficialSelectionSyncResponse, PendingRequirement, PlannerStats } from '../../shared/types';
import { classifyCourseByCode, type CourseTone } from '../../shared/domain/courseClassification';
import { findCourseConflicts } from '../../shared/domain/scheduleConflicts';
import { gpaDetailLabel, gpaValueLabel, hasGpaValue, type GpaFields } from '../../shared/domain/gpa';
import {
  PERIODS,
  type PlanningMode,
  type RequirementStatus,
  displayClassroom,
  displaySlots,
  formatCredits,
  isHistoryImportedCourse,
  parseNodeSlots,
  requirementCourseCode,
} from '../../shared/domain/planner';

const PERIOD_TIME_LABELS: Record<string, { start: string; end: string }> = {
  '1': { start: '08:10', end: '09:00' },
  '2': { start: '09:10', end: '10:00' },
  '3': { start: '10:20', end: '11:10' },
  '4': { start: '11:20', end: '12:10' },
  '5': { start: '12:20', end: '13:10' },
  '6': { start: '13:20', end: '14:10' },
  '7': { start: '14:20', end: '15:10' },
  '8': { start: '15:30', end: '16:20' },
  '9': { start: '16:30', end: '17:20' },
  '10': { start: '17:30', end: '18:20' },
  A: { start: '18:25', end: '19:15' },
  B: { start: '19:20', end: '20:10' },
  C: { start: '20:15', end: '21:05' },
  D: { start: '21:10', end: '22:00' },
};
/**
 * 每個類別一個墨色（與本學期頁同一組 token）；待加簽用墨灰虛線，衝堂才用朱批紅。
 * 類別名要寫成完整 class 字串，Tailwind 只掃描原始碼裡出現過的名字，拼接出來的不會生成。
 */
const TONE_CLASSES: Record<CourseTone, { dot: string; tint: string; badge: string; grouped: string }> = {
  required: { dot: 'bg-cat-major', tint: 'bg-cat-major/12', badge: 'bg-cat-major text-sheet', grouped: 'border-cat-major/40 bg-cat-major/10' },
  elective: { dot: 'bg-cat-elective', tint: 'bg-cat-elective/12', badge: 'bg-cat-elective text-sheet', grouped: 'border-cat-elective/40 bg-cat-elective/10' },
  general: { dot: 'bg-cat-gened', tint: 'bg-cat-gened/12', badge: 'bg-cat-gened text-sheet', grouped: 'border-cat-gened/40 bg-cat-gened/10' },
  pe: { dot: 'bg-cat-pe', tint: 'bg-cat-pe/12', badge: 'bg-cat-pe text-sheet', grouped: 'border-cat-pe/40 bg-cat-pe/10' },
  doubleMajor: { dot: 'bg-cat-double', tint: 'bg-cat-double/12', badge: 'bg-cat-double text-sheet', grouped: 'border-cat-double/40 bg-cat-double/10' },
  minor: { dot: 'bg-cat-minor', tint: 'bg-cat-minor/12', badge: 'bg-cat-minor text-sheet', grouped: 'border-cat-minor/40 bg-cat-minor/10' },
  virtual: { dot: 'bg-ink-2', tint: 'bg-sheet', badge: 'bg-ink-2 text-sheet', grouped: 'border-ink-2/40 bg-ink-2/10' },
  group: { dot: 'bg-ink-2', tint: 'bg-sheet', badge: 'bg-ink-2 text-sheet', grouped: 'border-ink-2/40 bg-ink-2/10' },
  conflict: { dot: 'bg-mark', tint: 'bg-mark/12', badge: 'bg-mark text-sheet', grouped: 'border-mark/40 bg-mark/10' },
  other: { dot: 'bg-ink-3', tint: 'bg-ink-3/12', badge: 'bg-ink-3 text-sheet', grouped: 'border-ink-3/40 bg-ink-3/10' },
};

function ScheduleLegend() {
  const items: Array<{ label: string; tone: CourseTone }> = [
    { label: '本系必修', tone: 'required' },
    { label: '本系選修', tone: 'elective' },
    { label: '通識', tone: 'general' },
    { label: '體育', tone: 'pe' },
    { label: '雙主修', tone: 'doubleMajor' },
    { label: '輔系', tone: 'minor' },
  ];
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 font-mono text-[11px] text-ink-3">
      {items.map((item) => (
        <span key={item.label} className="inline-flex items-center whitespace-nowrap">
          <b className={`mr-1.5 inline-block h-[7px] w-[7px] rounded-sm ${TONE_CLASSES[item.tone].dot}`} />
          {item.label}
        </span>
      ))}
      <span className="inline-flex items-center whitespace-nowrap">
        <b className="mr-1.5 inline-block h-[7px] w-[7px] rounded-sm border border-dashed border-ink-2" />
        待加簽
      </span>
      <span className="inline-flex items-center whitespace-nowrap">
        <b className="mr-1.5 inline-block h-[7px] w-[7px] rounded-sm bg-mark" />
        衝堂
      </span>
    </div>
  );
}

/** 課表方塊：淡類別底＋墨色字；待加簽是虛線框；衝堂朱底。 */
function scheduleToneClass(tone: CourseTone, conflicting = false): string {
  if (conflicting) return 'border border-mark bg-mark/12 text-ink';
  if (tone === 'virtual' || tone === 'group') return 'border border-dashed border-ink-2 bg-sheet text-ink';
  return `border border-transparent ${TONE_CLASSES[tone].tint} text-ink`;
}

/** 待加簽：官方還沒放行，畫成虛線框，左緣仍用類別色，跟本學期頁一致。 */
const PENDING_TONE_CLASS = 'border border-dashed border-ink-2 bg-sheet text-ink';

/** 方塊左緣那條 3px 色條。 */
function scheduleAccentClass(tone: CourseTone, conflicting = false): string {
  return TONE_CLASSES[conflicting ? 'conflict' : tone].dot;
}

/** 志願序號小圓、類別標籤。 */
function badgeToneClass(tone: CourseTone, conflicting = false): string {
  return TONE_CLASSES[conflicting ? 'conflict' : tone].badge;
}

function groupedItemToneClass(tone: CourseTone): string {
  return TONE_CLASSES[tone].grouped;
}

function GpaBadge({ gpa, status, detail, courseNo }: { gpa?: number | null; status?: GpaStatus; detail?: GpaFields; courseNo?: string }) {
  const hasGpa = hasGpaValue(gpa);
  // 校務同步進來的課沒有查過 GPA（status 是空的），不能寫成「未啟用」——那是密鑰真的關掉時才用的字。
  if (!hasGpa && !status) return null;
  const extra = detail ? gpaDetailLabel({ ...detail, gpa, gpa_status: status }, courseNo) : '';
  const muted = !hasGpa || status === 'other_teacher';
  return (
    <span className={`shrink-0 whitespace-nowrap font-mono text-[10px] ${status === 'error' ? 'text-mark' : muted ? 'text-ink-3' : 'text-ink-2'}`}>
      GPA {gpaValueLabel(gpa, status)}
      {extra && <span className="text-ink-3">（{extra}）</span>}
    </span>
  );
}

type SelectionChanceEstimate = {
  selectedCount: number;
  capacity: number;
  pressureRatio: number;
  probabilityPercent: number;
};

function estimateSelectionChance(
  selectedCount?: number | null,
  capacity?: number | null,
): SelectionChanceEstimate | null {
  if (
    selectedCount === null
    || selectedCount === undefined
    || capacity === null
    || capacity === undefined
    || !Number.isFinite(selectedCount)
    || !Number.isFinite(capacity)
    || capacity <= 0
  ) {
    return null;
  }
  const pressureRatio = selectedCount / capacity;
  const probabilityPercent = pressureRatio > 0 ? Math.min(100, 100 / pressureRatio) : 100;
  return {
    selectedCount,
    capacity,
    pressureRatio,
    probabilityPercent,
  };
}

function formatProbabilityPercent(value: number): string {
  if (value >= 99.95) return '100%';
  return `${value.toFixed(1)}%`;
}

function SelectionChanceBadge({
  selectedCount,
  capacity,
}: {
  selectedCount?: number | null;
  capacity?: number | null;
}) {
  const estimate = estimateSelectionChance(selectedCount, capacity);
  if (!estimate) {
    return <span className="shrink-0 whitespace-nowrap font-mono text-[10px] text-ink-3">機率未公告</span>;
  }

  const isOverCapacity = estimate.selectedCount > estimate.capacity;
  const toneClass = isOverCapacity ? 'text-mark' : 'text-good';
  return (
    <>
      <span
        className={`shrink-0 whitespace-nowrap font-mono text-[10px] ${toneClass}`}
        title={`估算方式：人數 ${estimate.selectedCount} / 名額 ${estimate.capacity} = ${estimate.pressureRatio.toFixed(2)} 倍，選上估 ${formatProbabilityPercent(estimate.probabilityPercent)}`}
      >
        選上估 {formatProbabilityPercent(estimate.probabilityPercent)}
      </span>
      {isOverCapacity && (
        <span className="shrink-0 whitespace-nowrap font-mono text-[10px] text-mark">建議前排</span>
      )}
    </>
  );
}

function EnrollmentCountBadge({
  selectedCount,
  capacity,
}: {
  selectedCount?: number | null;
  capacity?: number | null;
}) {
  if (selectedCount == null || capacity == null) return null;
  return (
    <span className="shrink-0 whitespace-nowrap font-mono text-[10px] tabular-nums text-ink-2">{selectedCount}/{capacity} 人</span>
  );
}

function planningModeLabel(mode: PlanningMode): string {
  return mode === 'lottery' ? '初選志願' : '加退選';
}

function planningModeDescription(mode: PlanningMode): string {
  return mode === 'lottery'
    ? '同時段多門課會視為競爭志願，抽中一門後其他同時段或同課名志願會失效。'
    : '加退選接近先搶先贏，同時段課程應視為真衝堂並在送出前處理。';
}

function scheduledCredits(courses: Course[]): number {
  return courses.reduce((sum, course) => sum + (course.category === 'pe' ? 0 : course.credits), 0);
}

export function PlanningWorkspace({
  data,
  stats,
  activeSemester,
  enrolledCourses,
  querySemester,
  planningMode,
  plannerMessage,
  officialSelection,
  officialActionCourseNo,
  officialOrderStatus,
  onModeChange,
  onJoinOfficialCourse,
  onRemoveOfficialCourse,
  onSaveOfficialOrder,
  onDeleteCourse,
}: {
  data: AppData;
  stats: PlannerStats;
  activeSemester?: AppData['semesters'][number];
  /** 學校那邊實際選上的課（校務同步取自選課清單 ChooseList/D01/D01） */
  enrolledCourses: Course[];
  querySemester: string;
  planningMode: PlanningMode;
  plannerMessage: string;
  officialSelection: OfficialSelectionSyncResponse | null;
  officialActionCourseNo: string | null;
  officialOrderStatus: 'idle' | 'loading';
  onModeChange: (mode: PlanningMode) => void;
  onJoinOfficialCourse: (courseNo: string, courseName: string) => void;
  onRemoveOfficialCourse: (courseNo: string, courseName: string) => void;
  onSaveOfficialOrder: (orderedCourseNos: string[]) => void;
  onDeleteCourse: (courseId: string) => void;
}) {
  const virtualCourses = activeSemester?.courses.filter((course) => !isHistoryImportedCourse(course)) || [];
  const virtualCredits = scheduledCredits(virtualCourses);
  const officialRegisteredCount = officialSelection?.registered_count || 0;
  const officialAvailableCount = officialSelection?.available_count || 0;
  const officialRegisteredCredits = (officialSelection?.registered_courses || []).reduce(
    (sum, course) => sum + (course.credits || 0),
    0,
  );
  const currentPlanningCredits = officialRegisteredCredits + virtualCredits;
  const enrolledCredits = scheduledCredits(enrolledCourses);
  const enrolledCourseNos = new Set(
    enrolledCourses
      .map((course) => (course.scheduledOffering?.courseNo || '').trim().toUpperCase())
      .filter(Boolean),
  );
  const addDropCredits = enrolledCredits + virtualCredits;
  // 已經出現在選課清單的待加簽是舊的（側欄會提示可移除）；課表上不畫，否則會被畫成跟自己衝堂。
  const virtualCoursesForGrid = planningMode === 'addDrop'
    ? virtualCourses.filter((course) => {
        const courseNo = (course.scheduledOffering?.courseNo || '').trim().toUpperCase();
        return !(courseNo && enrolledCourseNos.has(courseNo));
      })
    : virtualCourses;
  const officialRequiredPresetCourses = officialSelection ? requiredPresetCoursesForDisplay(officialSelection) : [];
  const officialRequiredPresetCount = officialRequiredPresetCourses.length;
  const officialSelectionListCount = officialSelection?.selection_list_rows.length || 0;
  const officialScheduleHasData = officialSelection ? hasOfficialScheduleWeekdayData(officialSelection.schedule_rows) : false;
  const showSelectionListWithoutSchedule = Boolean(officialSelection && officialSelectionListCount > 0 && !officialScheduleHasData);
  const totalPlanningItems = officialRegisteredCount + officialAvailableCount + virtualCourses.length;
  const syncedAtLabel = data.schoolSync?.scheduleSyncedAt
    ? `課表 ${new Date(data.schoolSync.scheduleSyncedAt).toLocaleString('zh-TW', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })}`
    : officialSelection ? formatSyncTime(officialSelection.synced_at) : '尚未同步';
  const enrollmentPhase: EnrollmentPhase = currentEnrollmentPhase(querySemester);
  const upcomingPhase = nextEnrollmentPhase(querySemester);
  const isPreregistrationPhase = enrollmentPhase.kind === 'preregistration';
  const [showWeekend, setShowWeekend] = useState(false);
  // 加退選期的課表就是「本學期」那張（已選上＋待加簽），再把本地規劃也畫進去；
  // 初選期要畫志願序與學校預排，還是走下面的節次表，等初選期有真資料再合併。
  const now = useMemo(() => new Date(), []);
  const semesterView = useMemo(
    () => (planningMode === 'addDrop' ? buildSemesterView(data, now, { includePlanned: true }) : null),
    [data, now, planningMode],
  );
  const [selectedBlock, setSelectedBlock] = useState<SemesterBlock | null>(null);
  const modeOptions: Array<{ value: PlanningMode; label: string }> = [
    { value: 'lottery', label: '初選志願' },
    { value: 'addDrop', label: '加退選' },
  ];

  return (
    <section id="schedule-preview" className="space-y-5">
      <div className="grid gap-x-8 gap-y-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
        <div>
          <p className="font-mono text-[11px] tracking-[.14em] text-ink-2">選課工作台</p>
          <h2 className="mt-0.5 text-[19px] font-bold">官方選課狀態</h2>
          <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-ink-2">{planningModeDescription(planningMode)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex overflow-hidden rounded-sm border border-rule">
            {modeOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={planningMode === option.value}
                onClick={() => onModeChange(option.value)}
                className={`px-3 py-1 text-[13px] ${
                  planningMode === option.value ? 'bg-accent text-sheet' : 'text-ink-2 hover:text-ink'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <span className="font-mono text-[11px] text-ink-3">官方同步 <span className="text-ink-2">{syncedAtLabel}</span></span>
        </div>
      </div>
      {plannerMessage && (
        <div className="rounded-xl bg-good/10 px-3.5 py-2 text-[13px] leading-relaxed">{plannerMessage}</div>
      )}

      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[280px_minmax(0,1fr)] min-[1720px]:grid-cols-[300px_minmax(0,1fr)_260px]">
        <aside className="min-w-0 rounded-2xl bg-sheet shadow-card p-4">
          <div className="flex items-baseline justify-between gap-3">
            <div>
              <h3 className="text-[15px] font-bold">
                {planningMode === 'addDrop' ? '選課清單與待加簽' : '官方狀態與待加簽'}
              </h3>
              <p className="mt-0.5 font-mono text-[11px] tracking-wide text-ink-3">{planningModeLabel(planningMode)}模式・官方資料優先</p>
            </div>
            <span className="font-mono text-[11px] tabular-nums text-ink-3">
              {planningMode === 'addDrop' ? enrolledCourses.length + virtualCourses.length : totalPlanningItems} 項
            </span>
          </div>

          {/* 目前階段由教務處時程表推導（shared/domain/enrollmentCalendar），不讓使用者手動宣告 */}
          <div className={`mt-3 rounded-xl border px-3 py-2 text-xs leading-relaxed ${
            enrollmentPhase.kind === 'closed' ? 'border-rule text-ink-2' : 'border-transparent bg-accent-soft text-ink'
          }`}>
            {/* 側欄只有 300px：標題與日期分兩行，日期本身不斷行（原本會拆成「9/7 09:00 –」＋「9/21 17:00」） */}
            {enrollmentPhase.kind === 'closed' ? (
              <>
                <div>目前不在選課階段</div>
                {upcomingPhase && (
                  <div className="mt-0.5">
                    下一階段：<span className="font-medium">{upcomingPhase.label}</span>
                    <span className="ml-1 whitespace-nowrap font-mono">{formatPhaseRange(upcomingPhase)}</span>
                  </div>
                )}
              </>
            ) : (
              <>
                <div>目前階段：<span className="font-medium">{enrollmentPhase.label}</span></div>
                <div className="mt-0.5 whitespace-nowrap font-mono">{formatPhaseRange(enrollmentPhase)}</div>
              </>
            )}
          </div>

          <div className="mt-4 space-y-4">
            {planningMode === 'addDrop' ? (
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <h4 className="font-mono text-xs tracking-[.14em] text-ink-3">目前選課清單</h4>
                  <span className="font-mono text-[11px] tabular-nums text-ink-3">{enrolledCourses.length} 門・{formatCredits(enrolledCredits)} 學分</span>
                </div>
                {enrolledCourses.length === 0 ? (
                  <div className="rounded-sm border border-dashed border-rule px-3 py-4 text-center text-[13px] text-ink-2">
                    先用「資料同步」取得校務系統的選課清單，這裡就會列出已選上的課。
                  </div>
                ) : (
                  <div className="space-y-2">
                    {enrolledCourses.map((course) => (
                      <PlanningListCourse key={course.id} course={course} data={data} />
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <>
                {!isPreregistrationPhase && (
                  <div className="rounded-xl bg-paper px-3 py-2 text-xs leading-relaxed text-ink-2">
                    目前不是初選階段，官方初選清單本來就會是空的；要看實際選上的課請切到「加退選」。
                  </div>
                )}
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <h4 className="font-mono text-xs tracking-[.14em] text-ink-3">
                      已登記志願
                    </h4>
                    <span className="font-mono text-[11px] tabular-nums text-ink-3">{officialRegisteredCount} 門</span>
                  </div>
                  {officialSelection ? (
                    <OfficialRegisteredList
                      data={data}
                      selection={officialSelection}
                      actionCourseNo={officialActionCourseNo}
                      orderStatus={officialOrderStatus}
                      onRemoveOfficialCourse={onRemoveOfficialCourse}
                      onSaveOfficialOrder={onSaveOfficialOrder}
                    />
                  ) : (
                    <div className="rounded-sm border border-dashed border-rule px-3 py-4 text-center text-[13px] text-ink-2">
                      先同步官方選課狀態，才能顯示已登記志願。
                    </div>
                  )}
                </div>

                <div className="border-t border-rule pt-4">
                  <div className="mb-2 flex items-center justify-between">
                    <h4 className="font-mono text-xs tracking-[.14em] text-ink-3">待加入清單</h4>
                    <span className="font-mono text-[11px] tabular-nums text-ink-3">{officialAvailableCount} 門</span>
                  </div>
                  {officialSelection ? (
                    <OfficialAvailableList
                      selection={officialSelection}
                      actionCourseNo={officialActionCourseNo}
                      onJoinOfficialCourse={onJoinOfficialCourse}
                    />
                  ) : (
                    <div className="rounded-sm border border-dashed border-rule px-3 py-4 text-center text-[13px] text-ink-2">
                      先同步官方選課狀態，才能顯示待加入清單。
                    </div>
                  )}
                </div>
              </>
            )}

            <div className="border-t border-rule pt-4">
              <div className="mb-2 flex items-center justify-between">
                <h4 className="font-mono text-xs tracking-[.14em] text-ink-3">待加簽課程</h4>
                <span className="font-mono text-[11px] tabular-nums text-ink-3">{virtualCourses.length} 門・{formatCredits(virtualCredits)} 學分</span>
              </div>
              {virtualCourses.length === 0 ? (
                <div className="rounded-sm border border-dashed border-rule px-3 py-4 text-center text-[13px] text-ink-2">
                  官方拒絕或需要加簽追蹤的課程會在這裡保留，並標在功課表上。
                </div>
              ) : (
                <div className="space-y-2">
                  {virtualCourses.map((course) => {
                    const courseNo = (course.scheduledOffering?.courseNo || '').trim().toUpperCase();
                    // 已經出現在選課清單就是選上了，這筆待加簽是舊的
                    const alreadyEnrolled = Boolean(courseNo) && enrolledCourseNos.has(courseNo);
                    return (
                      <div key={course.id}>
                        <PlanningListCourse
                          course={course}
                          data={data}
                          onDelete={() => onDeleteCourse(course.id)}
                          showSelectionChance={planningMode === 'lottery'}
                          conflictNames={planningMode === 'lottery' ? [] : findCourseConflicts(course, data).map((item) => item.name)}
                        />
                        {alreadyEnrolled && (
                          <p className="mt-1 px-1 font-mono text-[11px] text-good">已在選課清單中（已選上），這筆待加簽可以移除。</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </aside>

        {semesterView ? (
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h3 className="text-[15px] font-bold">官方功課表</h3>
              <span className="font-mono text-[11px] tracking-wide text-ink-3">
                已選上 {semesterView.courses.length} 門・待加簽 {semesterView.pendingCourses.length} 門
                {semesterView.plannedCourses.length > 0 ? `・規劃中 ${semesterView.plannedCourses.length} 門` : ''}
                ・照真實上課分鐘畫
              </span>
              {showSelectionListWithoutSchedule ? (
                <span className="basis-full text-xs leading-relaxed text-mark">
                  已取得選課清單 {officialSelectionListCount} 門，但官方功課表資料仍為空；目前課表以課碼補查的節次顯示，查不到節次的課不會硬塞進課表。
                </span>
              ) : null}
            </div>
            <WeekGrid
              view={semesterView}
              now={now}
              onSelectCourse={setSelectedBlock}
              onRemoveCourse={(block) => onDeleteCourse(block.course.id)}
            />
            {selectedBlock && <CourseSheet block={selectedBlock} data={data} onClose={() => setSelectedBlock(null)} />}
          </div>
        ) : (
        <div className="min-w-0 overflow-hidden rounded-2xl bg-sheet shadow-card">
          <div className="border-b border-rule px-4 py-3">
            <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h3 className="text-[15px] font-bold">官方功課表</h3>
                <p className="mt-0.5 font-mono text-[11px] tracking-wide text-ink-3">
                  {planningMode === 'addDrop'
                    ? `已選上 ${enrolledCourses.length} 門 · 待加簽 ${virtualCourses.length} 門`
                    : `已登記 ${officialRegisteredCount} 門 · 學校預排 ${officialRequiredPresetCount} 門 · 待加簽 ${virtualCourses.length} 門`}
                </p>
                {showSelectionListWithoutSchedule ? (
                  <p className="mt-2 text-xs leading-relaxed text-mark">
                    已取得選課清單 {officialSelectionListCount} 門，但官方功課表資料仍為空；目前課表會以課碼補查節次顯示，查不到節次的課不會硬塞進課表。
                  </p>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <WeekendToggleButton
                  showWeekend={showWeekend}
                  onToggle={() => setShowWeekend((current) => !current)}
                />
                <p className="font-mono text-[11px] text-ink-3 sm:hidden">課表可左右滑動查看更多星期欄位。</p>
              </div>
            </div>
          </div>
          <PlanningScheduleGrid
            officialScheduleRows={officialSelection?.schedule_rows || []}
            officialRegisteredCourses={officialSelection?.registered_courses || []}
            officialRequiredPresetCourses={officialRequiredPresetCourses}
            enrolledCourses={planningMode === 'addDrop' ? enrolledCourses : []}
            virtualCourses={virtualCoursesForGrid}
            showWeekend={showWeekend}
            mode={planningMode}
            data={data}
            onDeleteCourse={onDeleteCourse}
          />
          <div className="border-t border-rule px-4 py-2.5">
            <ScheduleLegend />
          </div>
        </div>
        )}

        <aside className="min-w-0 rounded-2xl bg-sheet shadow-card p-4">
          <h3 className="text-[15px] font-bold">規劃檢查</h3>
          <p className="mt-0.5 font-mono text-[11px] tracking-wide text-ink-3">依目前選課階段解讀衝堂、互斥與學分限制</p>

          <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
            {planningMode === 'addDrop' ? (
              <>
                <MetricBox label="已選上" value={`${enrolledCourses.length} 門`} tone="emerald" />
                <MetricBox label="待加入清單" value={String(officialAvailableCount)} tone="blue" />
                <MetricBox label="目前學分" value={`${formatCredits(addDropCredits)} 學分`} tone="amber" />
                <MetricBox label="待加簽" value={`${virtualCourses.length} 門`} tone="slate" />
              </>
            ) : (
              <>
                <MetricBox label="已登記志願" value={String(officialRegisteredCount)} tone="emerald" />
                <MetricBox label="待加入清單" value={String(officialAvailableCount)} tone="blue" />
                <MetricBox label="目前學分" value={`${formatCredits(currentPlanningCredits)} 學分`} tone="amber" />
                <MetricBox label="待加簽" value={`${virtualCourses.length} 門`} tone="slate" />
              </>
            )}
          </dl>

          <div className="mt-4 border-t border-rule pt-3">
            <h4 className="font-mono text-xs tracking-[.14em] text-ink-3">畢業門檻影響</h4>
            <div className="mt-3 space-y-3 text-sm">
              <ProgressSummary label="總學分" value={stats.total} target={data.targets.total} />
              <ProgressSummary label="本系必修" value={stats.homeCompulsory} target={data.targets.home_compulsory} />
              <ProgressSummary label="通識" value={stats.gen_ed} target={data.targets.gen_ed} />
            </div>
          </div>
        </aside>
      </div>
    </section>
  );
}

function OfficialRegisteredList({
  data,
  selection,
  actionCourseNo,
  orderStatus,
  onRemoveOfficialCourse,
  onSaveOfficialOrder,
}: {
  data: AppData;
  selection: OfficialSelectionSyncResponse;
  actionCourseNo: string | null;
  orderStatus: 'idle' | 'loading';
  onRemoveOfficialCourse: (courseNo: string, courseName: string) => void;
  onSaveOfficialOrder: (orderedCourseNos: string[]) => void;
}) {
  const originalOrder = selection.registered_courses.map((course) => course.course_no.trim().toUpperCase()).join('|');
  const draftSyncKey = `${selection.synced_at}:${originalOrder}`;
  const [draftState, setDraftState] = useState({
    syncKey: draftSyncKey,
    courses: selection.registered_courses,
  });
  const draftCourses = draftState.syncKey === draftSyncKey ? draftState.courses : selection.registered_courses;

  if (selection.registered_courses.length === 0) {
    return (
      <div className="rounded-sm border border-dashed border-rule px-3 py-4 text-center text-[13px] text-ink-2">
        官方目前沒有已登記志願。
      </div>
    );
  }

  const draftOrder = draftCourses.map((course) => course.course_no.trim().toUpperCase()).join('|');
  const isDirty = originalOrder !== draftOrder;
  const isOrderSaving = orderStatus === 'loading';
  const moveDraftCourse = (index: number, direction: -1 | 1) => {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= draftCourses.length || isOrderSaving) return;
    const nextCourses = [...draftCourses];
    const [item] = nextCourses.splice(index, 1);
    nextCourses.splice(nextIndex, 0, item);
    setDraftState({ syncKey: draftSyncKey, courses: nextCourses });
  };

  return (
    <div className="space-y-2">
      <p className="font-mono text-[11px] leading-relaxed text-ink-3">選上機率依目前選課人數與名額估算，僅供志願序排序參考。</p>
      {isDirty && (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => onSaveOfficialOrder(draftCourses.map((course) => course.course_no))}
            disabled={!isDirty || isOrderSaving}
            className="inline-flex flex-1 items-center justify-center gap-1 rounded-sm bg-accent px-2 py-1.5 text-xs font-medium text-sheet disabled:cursor-not-allowed disabled:opacity-45"
          >
            {isOrderSaving && <Loader2 className="h-3 w-3 animate-spin" />}
            儲存志願序
          </button>
          <button
            type="button"
            onClick={() => setDraftState({ syncKey: draftSyncKey, courses: selection.registered_courses })}
            disabled={!isDirty || isOrderSaving}
            className="rounded-sm border border-rule bg-sheet px-2 py-1.5 text-xs text-ink-2 hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-45"
          >
            還原
          </button>
        </div>
      )}

      {draftCourses.map((course, index) => {
        const normalizedCourseNo = course.course_no.trim().toUpperCase();
        const isLoading = actionCourseNo === normalizedCourseNo || isOrderSaving;
        const classification = classifyCourseByCode(course.course_no, course.require_option, data);
        return (
        <div key={`${course.raw_priority}-${course.course_no}`} className={`rounded-sm p-2.5 ${
          isDirty ? 'border border-dashed border-ink-2 bg-sheet' : scheduleToneClass(classification.tone)
        }`}>
          <div className="flex items-start gap-2">
            <div className="mt-0.5 flex w-6 shrink-0 flex-col items-center gap-0.5">
              <div className={`flex h-5 w-5 items-center justify-center rounded-full font-mono text-[11px] font-semibold ${badgeToneClass(classification.tone)}`}>
                {index + 1}
              </div>
              <div className="flex flex-col">
                <button
                  type="button"
                  onClick={() => moveDraftCourse(index, -1)}
                  disabled={index === 0 || isOrderSaving}
                  className="rounded-sm p-0.5 text-ink-3 hover:text-ink disabled:cursor-not-allowed disabled:opacity-30"
                  aria-label="提高官方志願序"
                >
                  <ArrowUp className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  onClick={() => moveDraftCourse(index, 1)}
                  disabled={index === draftCourses.length - 1 || isOrderSaving}
                  className="rounded-sm p-0.5 text-ink-3 hover:text-ink disabled:cursor-not-allowed disabled:opacity-30"
                  aria-label="降低官方志願序"
                >
                  <ArrowDown className="h-3 w-3" />
                </button>
              </div>
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{course.course_name}</p>
              <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 font-mono text-[11px] text-ink-2">
                <span
                  className="min-w-0 truncate"
                  title={[
                    course.course_no,
                    classification.label,
                    course.credits != null ? `${formatCredits(course.credits)} 學分` : '',
                    course.require_option || '',
                    course.teacher || '',
                  ].filter(Boolean).join('・')}
                >
                  {[
                    course.course_no,
                    classification.label,
                    course.credits != null ? `${formatCredits(course.credits)} 學分` : '',
                  ].filter(Boolean).join('・')}
                </span>
                <GpaBadge gpa={course.gpa} status={course.gpa_status} detail={course} courseNo={course.course_no} />
                <SelectionChanceBadge selectedCount={course.selected_count} capacity={course.capacity} />
                <EnrollmentCountBadge selectedCount={course.selected_count} capacity={course.capacity} />
              </div>
            </div>
            <button
              type="button"
              onClick={() => onRemoveOfficialCourse(course.course_no, course.course_name)}
              disabled={isLoading}
              className="inline-flex shrink-0 items-center gap-1 rounded-sm border border-rule bg-sheet px-2 py-0.5 text-xs text-ink-2 hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-45"
            >
              {isLoading && <Loader2 className="h-3 w-3 animate-spin" />}
              取消
            </button>
          </div>
        </div>
        );
      })}
    </div>
  );
}

function requiredPresetCoursesForDisplay(
  selection: OfficialSelectionSyncResponse,
): OfficialSelectionRequiredPresetCourse[] {
  const byCourseNo = new Map<string, OfficialSelectionRequiredPresetCourse>();
  (selection.required_preset_rows || []).forEach((row) => {
    const courseNo = rowValue(row, ['課碼', '課程代碼', '課號']).trim().toUpperCase();
    if (!courseNo) return;
    byCourseNo.set(courseNo, {
      course_no: courseNo,
      course_name: rowValue(row, ['課程名稱', '課名']),
    });
  });
  (selection.required_preset_courses || []).forEach((course) => {
    const courseNo = course.course_no.trim().toUpperCase();
    if (!courseNo) return;
    byCourseNo.set(courseNo, { ...byCourseNo.get(courseNo), ...course, course_no: courseNo });
  });

  const registeredByCourseNo = new Map(
    selection.registered_courses.map((course) => [course.course_no.trim().toUpperCase(), course]),
  );
  return Array.from(byCourseNo.values()).map((course) => {
    const registered = registeredByCourseNo.get(course.course_no.trim().toUpperCase());
    return {
      ...course,
      course_name: course.course_name || registered?.course_name || '',
      credits: course.credits ?? registered?.credits,
      require_option: course.require_option || registered?.require_option || '',
      teacher: course.teacher || registered?.teacher || '',
      classroom: course.classroom || registered?.classroom || '',
      node: course.node || registered?.node || '',
      contents: course.contents || registered?.contents || '',
      selected_count: course.selected_count ?? registered?.selected_count,
      capacity: course.capacity ?? registered?.capacity,
      gpa: course.gpa ?? registered?.gpa,
      gpa_status: course.gpa_status || registered?.gpa_status,
      gpa_semester: course.gpa_semester ?? registered?.gpa_semester,
      gpa_students: course.gpa_students ?? registered?.gpa_students,
      gpa_teacher: course.gpa_teacher ?? registered?.gpa_teacher,
      gpa_course_no: course.gpa_course_no ?? registered?.gpa_course_no,
    };
  });
}

function OfficialAvailableList({
  selection,
  actionCourseNo,
  onJoinOfficialCourse,
}: {
  selection: OfficialSelectionSyncResponse;
  actionCourseNo: string | null;
  onJoinOfficialCourse: (courseNo: string, courseName: string) => void;
}) {
  if (selection.available_courses.length === 0) {
    return (
      <div className="rounded-sm border border-dashed border-rule px-3 py-4 text-center text-[13px] text-ink-2">
        官方目前沒有待加入課程。
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {selection.available_courses.map((course) => {
        const normalizedCourseNo = course.course_no.trim().toUpperCase();
        const isLoading = actionCourseNo === normalizedCourseNo;
        return (
        <div key={course.course_no} className="rounded-sm border border-rule bg-sheet p-2.5">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{course.course_name}</p>
              <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 font-mono text-[11px] text-ink-2">
                <span className="min-w-0 truncate" title={course.teacher || '未列教師'}>
                  {course.course_no}
                </span>
                <GpaBadge gpa={course.gpa} status={course.gpa_status} detail={course} courseNo={course.course_no} />
              </div>
            </div>
            <button
              type="button"
              onClick={() => onJoinOfficialCourse(course.course_no, course.course_name)}
              disabled={isLoading}
              className="inline-flex shrink-0 items-center gap-1 rounded-sm border border-accent bg-accent px-2 py-0.5 text-xs text-sheet disabled:cursor-not-allowed disabled:opacity-45"
            >
              {isLoading && <Loader2 className="h-3 w-3 animate-spin" />}
              加入登記
            </button>
          </div>
        </div>
        );
      })}
    </div>
  );
}

function formatSyncTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '剛剛';
  return date.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' });
}

function WeekendToggleButton({
  showWeekend,
  onToggle,
}: {
  showWeekend: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={showWeekend}
      className="inline-flex items-center gap-2 rounded-sm border border-rule bg-sheet px-3 py-1 text-[13px] text-ink-2 hover:border-accent hover:text-accent"
    >
      <span className={`relative inline-flex h-4 w-7 items-center rounded-full border border-rule transition-colors ${showWeekend ? 'bg-accent' : 'bg-band'}`}>
        <span className={`inline-block h-3 w-3 transform rounded-full bg-sheet shadow-sm transition-transform ${showWeekend ? 'translate-x-3' : 'translate-x-0'}`} />
      </span>
      顯示週末
    </button>
  );
}

function PlanningScheduleGrid({
  officialScheduleRows,
  officialRegisteredCourses,
  officialRequiredPresetCourses,
  enrolledCourses,
  virtualCourses,
  showWeekend,
  mode,
  data,
  onDeleteCourse,
}: {
  officialScheduleRows: Record<string, string>[];
  officialRegisteredCourses: OfficialSelectionRegisteredCourse[];
  officialRequiredPresetCourses: OfficialSelectionRequiredPresetCourse[];
  enrolledCourses: Course[];
  virtualCourses: Course[];
  showWeekend: boolean;
  mode: PlanningMode;
  data: AppData;
  onDeleteCourse: (courseId: string) => void;
}) {
  return (
    <OfficialScheduleTable
      rows={officialScheduleRows}
      officialRegisteredCourses={officialRegisteredCourses}
      officialRequiredPresetCourses={officialRequiredPresetCourses}
      enrolledCourses={enrolledCourses}
      virtualCourses={virtualCourses}
      showWeekend={showWeekend}
      mode={mode}
      data={data}
      onDeleteVirtualCourse={onDeleteCourse}
    />
  );
}

function OfficialScheduleTable({
  rows,
  officialRegisteredCourses,
  officialRequiredPresetCourses,
  enrolledCourses,
  virtualCourses,
  showWeekend,
  mode,
  data,
  onDeleteVirtualCourse,
}: {
  rows: Record<string, string>[];
  officialRegisteredCourses: OfficialSelectionRegisteredCourse[];
  officialRequiredPresetCourses: OfficialSelectionRequiredPresetCourse[];
  enrolledCourses: Course[];
  virtualCourses: Course[];
  showWeekend: boolean;
  mode: PlanningMode;
  data: AppData;
  onDeleteVirtualCourse: (courseId: string) => void;
}) {
  const [hoveredEventId, setHoveredEventId] = useState<string | null>(null);
  const visibleWeekdays = showWeekend ? OFFICIAL_WEEKDAYS : OFFICIAL_WEEKDAYS.slice(0, 5);
  const displayRows = officialRowsForDisplay(rows);
  const events = layoutScheduleEvents([
    ...buildOfficialScheduleEvents(visibleWeekdays, officialRegisteredCourses, officialRequiredPresetCourses, data),
    // 已選上的課用 official 樣式畫：本地刪除不會真的退選，所以不給刪除鈕
    ...buildVirtualScheduleEvents(enrolledCourses, visibleWeekdays, data, 'official'),
    ...buildVirtualScheduleEvents(virtualCourses, visibleWeekdays, data),
  ]);
  const gridTemplateColumns = `72px repeat(${visibleWeekdays.length}, minmax(132px, 1fr))`;
  const gridTemplateRows = `42px repeat(${displayRows.length}, 64px)`;
  return (
    <div>
      <div className="overflow-x-auto">
        <div
          className="relative min-w-[780px] text-sm"
          style={{ display: 'grid', gridTemplateColumns, gridTemplateRows }}
        >
          <div className="sticky left-0 z-20 flex items-center justify-center border-b border-r border-rule bg-sheet font-mono text-[10px] tracking-[.1em] text-ink-3">
            節次
          </div>
          {visibleWeekdays.map((weekday, index) => (
            <div
              key={weekday.label}
              className="flex items-center justify-center border-b border-r border-rule bg-sheet text-sm text-ink-2"
              style={{ gridColumn: index + 2, gridRow: 1 }}
            >
              {weekday.label.replace('星期', '週')}
            </div>
          ))}
          {displayRows.map((row, rowIndex) => {
            const period = getOfficialScheduleCell(row, '節次') || PERIODS[rowIndex] || String(rowIndex + 1);
            return (
              <div
                key={`time-${period}`}
                className="sticky left-0 z-10 flex flex-col items-center justify-center border-b border-r border-rule bg-sheet text-center"
                style={{ gridColumn: 1, gridRow: rowIndex + 2 }}
              >
                <span className="font-mono text-[17px] font-medium leading-none text-ink-2">{period}</span>
                <span className="mt-1 whitespace-pre-line font-mono text-[10px] leading-tight text-ink-3">
                  {formatOfficialTime(getOfficialScheduleCell(row, '時間'))}
                </span>
              </div>
            );
          })}
          {displayRows.flatMap((row, rowIndex) => (
            visibleWeekdays.map((weekday, dayIndex) => {
              const hasEvent = events.some((event) => (
                event.weekdayLabel === weekday.label
                && rowIndex >= event.startIndex
                && rowIndex < event.startIndex + event.span
              ));
              return (
                <div
                  key={`bg-${weekday.label}-${getOfficialScheduleCell(row, '節次') || rowIndex}`}
                  className={`border-b border-r border-rule ${hasEvent ? 'bg-band/40' : 'bg-sheet'}`}
                  style={{ gridColumn: dayIndex + 2, gridRow: rowIndex + 2 }}
                />
              );
            })
          ))}
          {events.map((event) => {
            const dayIndex = visibleWeekdays.findIndex((weekday) => weekday.label === event.weekdayLabel);
            if (dayIndex < 0) return null;
            const isHovered = hoveredEventId === event.id;
            const isVirtual = event.kind === 'virtual';
            const isGroup = event.kind === 'group';
            const isNarrow = event.laneCount > 1;
            // 加退選期同時段就是真衝堂：待加簽疊到已選上（或另一門待加簽）要標出來。
            // 完全同一格的課會被併成「N 門同時段」群組，原本因為群組不算 virtual 而漏標。
            // 初選期同時段是合法的競爭志願，不標。
            const groupHasPending = Boolean(event.groupedEvents?.some((item) => item.kind === 'virtual'));
            const conflicting = mode !== 'lottery' && (
              (isVirtual && event.laneCount > 1)
              || (isGroup && groupHasPending)
            );
            const showMeta = !isGroup && Boolean(event.meta) && (!isNarrow || event.span > 1);
            const stackOffset = isNarrow ? Math.min(event.lane, 4) : 0;
            const stackWidth = isNarrow ? 'calc(100% - 22px)' : 'calc(100% - 6px)';
            const overlapHoverClass = isNarrow
              ? 'hover:w-[calc(100%-6px)] hover:-translate-x-[var(--overlap-shift)] hover:scale-[1.02] hover:overflow-visible'
              : '';
            const titleText = isGroup && event.groupedEvents
              ? event.groupedEvents.map(formatGroupedEventLabel).join('\n')
              : event.rank ? `${event.rank}. ${event.title}` : event.title;
            const eventStyle: CSSProperties & { '--overlap-shift'?: string } = {
              gridColumn: dayIndex + 2,
              gridRow: `${event.startIndex + 2} / span ${event.span}`,
              width: stackWidth,
              marginLeft: `${3 + stackOffset * 7}px`,
              marginTop: `${4 + stackOffset * 7}px`,
              zIndex: isHovered ? 30 : 10 + Math.min(event.lane, 9),
              '--overlap-shift': `${stackOffset * 7}px`,
            };
            return (
              <div
                key={event.id}
                className={`group/event my-1 flex min-h-0 overflow-hidden rounded-sm transition-all duration-150 ease-out hover:shadow-md ${overlapHoverClass} ${
                  isVirtual && !conflicting ? PENDING_TONE_CLASS : scheduleToneClass(event.tone, conflicting)
                }`}
                style={eventStyle}
                title={titleText}
                onMouseEnter={() => setHoveredEventId(event.id)}
                onMouseLeave={() => setHoveredEventId((current) => (current === event.id ? null : current))}
                onFocus={() => setHoveredEventId(event.id)}
                onBlur={() => setHoveredEventId((current) => (current === event.id ? null : current))}
              >
                <span className={`w-[3px] shrink-0 ${scheduleAccentClass(event.tone, conflicting)}`} />
                <div className="flex min-w-0 flex-1 flex-col px-1.5 py-1">
                  {isGroup && event.groupedEvents ? (
                    <GroupedScheduleEventContent event={event} conflicting={conflicting} />
                  ) : (
                    <div className="flex items-start gap-1">
                      {!isVirtual && event.rank ? (
                        <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full font-mono text-[11px] font-semibold ${badgeToneClass(event.tone, conflicting)}`}>
                          {event.rank}
                        </span>
                      ) : null}
                      <p className="min-w-0 flex-1 truncate text-xs font-medium leading-5 group-hover/event:whitespace-normal group-hover/event:break-words">
                        {event.title}
                      </p>
                      {event.course && event.kind === 'virtual' ? (
                        <button
                          type="button"
                          onClick={() => onDeleteVirtualCourse(event.course!.id)}
                          className="shrink-0 rounded-sm px-1 font-mono text-[11px] leading-5 text-ink-3 hover:text-accent"
                          title="移除待加簽課程"
                          aria-label="移除待加簽課程"
                        >
                          ×
                        </button>
                      ) : null}
                    </div>
                  )}
                  {(!isGroup && (showMeta || (isNarrow && event.meta))) ? (
                    <p className={`mt-0.5 truncate font-mono text-[10px] group-hover/event:whitespace-normal group-hover/event:break-words ${
                      conflicting ? 'text-mark' : 'text-ink-2'
                    }`}>
                      {event.meta}
                    </p>
                  ) : null}
                  {conflicting ? (
                    <span className="mt-auto inline-flex w-fit items-center rounded-sm bg-mark px-1.5 font-mono text-[10px] text-sheet">衝堂</span>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function GroupedScheduleEventContent({ event, conflicting = false }: { event: ScheduleEvent; conflicting?: boolean }) {
  const groupedEvents = event.groupedEvents || [];
  const visibleEvents = groupedEvents.slice(0, 3);
  const hiddenCount = Math.max(0, groupedEvents.length - visibleEvents.length);
  return (
    <div className="min-w-0">
      <div className="mb-1 flex items-center justify-between gap-1">
        <p className={`truncate text-xs font-medium leading-5 group-hover/event:whitespace-normal group-hover/event:break-words ${conflicting ? 'text-mark' : ''}`}>
          {conflicting ? '衝堂・' : ''}{groupedEvents.length} 門同時段
        </p>
        {hiddenCount > 0 ? (
          <span className="shrink-0 font-mono text-[10px] text-ink-3">
            +{hiddenCount}
          </span>
        ) : null}
      </div>
      <div className="space-y-0.5">
        {visibleEvents.map((item) => (
          <div key={item.id} className={`flex min-w-0 items-start gap-1 rounded-sm border px-1 py-0.5 ${groupedItemToneClass(item.tone)}`}>
            {item.rank ? (
              <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full font-mono text-[10px] font-semibold ${badgeToneClass(item.tone)}`}>
                {item.rank}
              </span>
            ) : (
              <span className={`h-2 w-2 shrink-0 rounded-full ${scheduleAccentClass(item.tone)}`} />
            )}
            <span className="min-w-0 truncate text-[11px] font-medium leading-4 text-ink group-hover/event:whitespace-normal group-hover/event:break-words">
              {item.title}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

const OFFICIAL_WEEKDAYS = [
  { label: '星期一', aliases: ['星期一', '週一', '禮拜一', '一'] },
  { label: '星期二', aliases: ['星期二', '週二', '禮拜二', '二'] },
  { label: '星期三', aliases: ['星期三', '週三', '禮拜三', '三'] },
  { label: '星期四', aliases: ['星期四', '週四', '禮拜四', '四'] },
  { label: '星期五', aliases: ['星期五', '週五', '禮拜五', '五'] },
  { label: '星期六', aliases: ['星期六', '週六', '禮拜六', '六'] },
  { label: '星期日', aliases: ['星期日', '星期天', '週日', '週天', '禮拜日', '禮拜天', '日', '天'] },
];
const OFFICIAL_SCHEDULE_COLUMNS = ['節次', '時間', ...OFFICIAL_WEEKDAYS.map((weekday) => weekday.label)];
const OFFICIAL_DAY_CODE_BY_LABEL: Record<string, string> = {
  星期一: 'M',
  星期二: 'T',
  星期三: 'W',
  星期四: 'R',
  星期五: 'F',
  星期六: 'S',
  星期日: 'U',
};

function officialRowsForDisplay(rows: Record<string, string>[]): Record<string, string>[] {
  if (rows.length > 0) return rows;
  return PERIODS.map((period) => {
    const time = PERIOD_TIME_LABELS[period];
    return {
      節次: period,
      時間: time ? `${time.start}~${time.end}` : '',
    };
  });
}

function hasOfficialScheduleWeekdayData(rows: Record<string, string>[]): boolean {
  return rows.some((row) => (
    OFFICIAL_WEEKDAYS.some((weekday) => Boolean(getOfficialScheduleCell(row, weekday.label)))
  ));
}

type ScheduleEvent = {
  id: string;
  kind: 'official' | 'virtual' | 'group';
  weekdayLabel: string;
  startIndex: number;
  span: number;
  title: string;
  meta: string;
  tone: CourseTone;
  classificationLabel?: string;
  rank?: number;
  course?: Course;
  groupedEvents?: RawScheduleEvent[];
  lane: number;
  laneCount: number;
  overlapsOfficial: boolean;
};

type RawScheduleEvent = Omit<ScheduleEvent, 'lane' | 'laneCount' | 'overlapsOfficial'>;

function buildOfficialScheduleEvents(
  weekdays: typeof OFFICIAL_WEEKDAYS,
  registeredCourses: OfficialSelectionRegisteredCourse[],
  requiredPresetCourses: OfficialSelectionRequiredPresetCourse[],
  data: AppData,
): RawScheduleEvent[] {
  const presetCourseNos = new Set(requiredPresetCourses.map((course) => course.course_no.trim().toUpperCase()));
  const rankedRegisteredCourses = registeredCourses.filter((course) => (
    !presetCourseNos.has(course.course_no.trim().toUpperCase())
  ));
  return [
    ...buildOfficialRegisteredCourseEvents(requiredPresetCourses, weekdays, data, false),
    ...buildOfficialRegisteredCourseEvents(rankedRegisteredCourses, weekdays, data, true),
  ];
}

function buildOfficialRegisteredCourseEvents(
  courses: Array<OfficialSelectionRegisteredCourse | OfficialSelectionRequiredPresetCourse>,
  weekdays: typeof OFFICIAL_WEEKDAYS,
  data: AppData,
  showRank: boolean,
): RawScheduleEvent[] {
  const events: RawScheduleEvent[] = [];
  courses.forEach((course, courseIndex) => {
    weekdays.forEach((weekday) => {
      const dayCode = OFFICIAL_DAY_CODE_BY_LABEL[weekday.label];
      if (!dayCode) return;
      const slotPeriods = new Set(
        parseNodeSlots(course.node || '')
          .filter((slot) => slot.startsWith(dayCode))
          .map((slot) => slot.slice(dayCode.length)),
      );
      let periodIndex = 0;
      while (periodIndex < PERIODS.length) {
        if (!slotPeriods.has(PERIODS[periodIndex])) {
          periodIndex += 1;
          continue;
        }
        let endIndex = periodIndex + 1;
        while (endIndex < PERIODS.length && slotPeriods.has(PERIODS[endIndex])) {
          endIndex += 1;
        }
        const classification = classifyCourseByCode(course.course_no, course.require_option, data);
        events.push({
          id: `official-${showRank ? 'registered' : 'preset'}-${course.course_no}-${weekday.label}-${periodIndex}`,
          kind: 'official',
          weekdayLabel: weekday.label,
          startIndex: periodIndex,
          span: endIndex - periodIndex,
          title: course.course_name,
          meta: '',
          tone: classification.tone,
          classificationLabel: classification.label,
          rank: showRank ? ('priority' in course && course.priority ? course.priority : courseIndex + 1) : undefined,
        });
        periodIndex = endIndex;
      }
    });
  });
  return events;
}

function buildVirtualScheduleEvents(
  courses: Course[],
  weekdays: typeof OFFICIAL_WEEKDAYS,
  data: AppData,
  kind: 'virtual' | 'official' = 'virtual',
): RawScheduleEvent[] {
  const events: RawScheduleEvent[] = [];
  courses.forEach((course) => {
    weekdays.forEach((weekday) => {
      const dayCode = OFFICIAL_DAY_CODE_BY_LABEL[weekday.label];
      if (!dayCode) return;
      const slotPeriods = new Set(
        (course.scheduledOffering?.slots || [])
          .map((slot) => slot.trim().toUpperCase())
          .filter((slot) => slot.startsWith(dayCode))
          .map((slot) => slot.slice(dayCode.length)),
      );
      let periodIndex = 0;
      while (periodIndex < PERIODS.length) {
        if (!slotPeriods.has(PERIODS[periodIndex])) {
          periodIndex += 1;
          continue;
        }
        let endIndex = periodIndex + 1;
        while (endIndex < PERIODS.length && slotPeriods.has(PERIODS[endIndex])) {
          endIndex += 1;
        }
        const span = endIndex - periodIndex;
        const teacher = course.scheduledOffering?.teacher || course.details?.professor || '未列教師';
        const classification = classifyCourseByCode(
          course.scheduledOffering?.courseNo || '',
          course.scheduledOffering?.requireOption,
          data,
          kind === 'virtual' ? 'virtual' : 'other',
        );
        events.push({
          id: `${kind}-${course.id}-${weekday.label}-${periodIndex}`,
          kind,
          weekdayLabel: weekday.label,
          startIndex: periodIndex,
          span,
          title: course.name,
          meta: teacher,
          tone: classification.tone,
          classificationLabel: classification.label,
          course,
        });
        periodIndex = endIndex;
      }
    });
  });
  return events;
}

function layoutScheduleEvents(events: RawScheduleEvent[]): ScheduleEvent[] {
  const groupableEvents = groupSameSlotEvents(events);
  const grouped = new Map<string, RawScheduleEvent[]>();
  groupableEvents.forEach((event) => {
    grouped.set(event.weekdayLabel, [...(grouped.get(event.weekdayLabel) || []), event]);
  });

  const laidOut: ScheduleEvent[] = [];
  grouped.forEach((weekdayEvents) => {
    const sorted = [...weekdayEvents].sort((a, b) => (
      a.startIndex - b.startIndex
      || b.span - a.span
      || (a.kind === 'official' ? -1 : 1)
    ));
    const laneEnds: number[] = [];
    const assigned = sorted.map((event) => {
      const endIndex = event.startIndex + event.span;
      let lane = laneEnds.findIndex((laneEnd) => laneEnd <= event.startIndex);
      if (lane < 0) {
        lane = laneEnds.length;
        laneEnds.push(endIndex);
      } else {
        laneEnds[lane] = endIndex;
      }
      return { ...event, lane, laneCount: 1 };
    });

    assigned.forEach((event) => {
      const overlapping = assigned.filter((candidate) => (
        candidate.weekdayLabel === event.weekdayLabel
        && candidate.startIndex < event.startIndex + event.span
        && candidate.startIndex + candidate.span > event.startIndex
      ));
      laidOut.push({
        ...event,
        laneCount: Math.max(1, ...overlapping.map((candidate) => candidate.lane + 1)),
        overlapsOfficial: event.kind === 'virtual' && overlapping.some((candidate) => candidate.kind === 'official'),
      });
    });
  });

  return laidOut;
}

function groupSameSlotEvents(events: RawScheduleEvent[]): RawScheduleEvent[] {
  const groups = new Map<string, RawScheduleEvent[]>();
  events.forEach((event) => {
    const key = `${event.weekdayLabel}|${event.startIndex}|${event.span}`;
    groups.set(key, [...(groups.get(key) || []), event]);
  });

  return Array.from(groups.values()).flatMap((group) => {
    if (group.length <= 1) return group;
    const sorted = [...group].sort((a, b) => (
      (a.rank ?? 999) - (b.rank ?? 999)
      || a.title.localeCompare(b.title, 'zh-Hant')
    ));
    const first = sorted[0];
    return [{
      id: `group-${first.weekdayLabel}-${first.startIndex}-${first.span}-${sorted.map((event) => event.id).join('-')}`,
      kind: 'group',
      weekdayLabel: first.weekdayLabel,
      startIndex: first.startIndex,
      span: first.span,
      title: `${sorted.length} 門同時段`,
      meta: sorted.map(formatGroupedEventLabel).join(' / '),
      tone: 'group',
      classificationLabel: '同時段',
      groupedEvents: sorted,
    }];
  });
}

function formatGroupedEventLabel(event: RawScheduleEvent): string {
  return [event.rank ? `${event.rank}` : '', event.title].filter(Boolean).join(' ');
}

function compactOfficialKey(value: string): string {
  return value.replace(/\s+/g, '').replace(/[：:]/g, '');
}

function rowValue(row: Record<string, string>, aliases: string[]): string {
  const compactAliases = new Set(aliases.map(compactOfficialKey));
  const matched = Object.entries(row).find(([key]) => compactAliases.has(compactOfficialKey(key)));
  return matched?.[1] || '';
}

function getOfficialScheduleCell(row: Record<string, string>, label: string): string {
  const aliases = OFFICIAL_WEEKDAYS.find((weekday) => weekday.label === label)?.aliases || [label];
  const directLabels = label === '節次' || label === '時間' ? [label] : aliases;
  for (const key of directLabels) {
    const value = row[key];
    if (value) return value;
  }

  const compactAliases = directLabels.map(compactOfficialKey);
  const matched = Object.entries(row).find(([key, value]) => (
    Boolean(value) && compactAliases.some((alias) => compactOfficialKey(key) === alias)
  ));
  if (matched?.[1]) return matched[1];

  // Positional fallback is only safe for header-less rows. JSONB storage
  // reorders keys, so Object.values() no longer follows column order and an
  // empty 星期二 would otherwise render 星期三's course.
  const hasNamedColumns = Object.keys(row).some((key) => (
    OFFICIAL_SCHEDULE_COLUMNS.includes(compactOfficialKey(key))
  ));
  if (hasNamedColumns) return '';

  const columnIndex = OFFICIAL_SCHEDULE_COLUMNS.indexOf(label);
  if (columnIndex < 0) return '';
  return Object.values(row)[columnIndex] || '';
}

function formatOfficialTime(value: string | undefined): string {
  if (!value) return '';
  return value.replace(/~/g, '\n').replace(/～/g, '\n');
}

function PlanningListCourse({
  course,
  data,
  onDelete,
  showSelectionChance = false,
  conflictNames = [],
}: {
  course: Course;
  data: AppData;
  /** 省略即為唯讀（例如學校那邊已選上的課，本地刪除不會真的退選） */
  onDelete?: () => void;
  /** 「選上估」只在初選志願期有意義；加退選是先搶先贏，已選上的課更不需要。 */
  showSelectionChance?: boolean;
  /** 加退選期跟哪些課撞到；空陣列不顯示。判斷來自 `findCourseConflicts`，跟課表與課程查詢同一套。 */
  conflictNames?: string[];
}) {
  const slots = course.scheduledOffering?.slots || [];
  const classification = classifyCourseByCode(
    course.scheduledOffering?.courseNo || '',
    course.scheduledOffering?.requireOption,
    data,
    'virtual',
  );
  return (
    <div className={`rounded-sm p-2.5 ${
      conflictNames.length > 0 ? scheduleToneClass(classification.tone, true) : onDelete ? PENDING_TONE_CLASS : scheduleToneClass(classification.tone)
    }`}>
      <div className="flex items-start gap-2">
        <div className={`mt-0.5 shrink-0 rounded-sm px-1.5 py-px font-mono text-[10px] ${badgeToneClass(classification.tone)}`}>
          {classification.label}
        </div>
        <div className="min-w-0 flex-1 text-left">
          <p className="truncate text-sm font-medium">{course.name}</p>
          <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 font-mono text-[11px] text-ink-2">
            <span className="min-w-0 truncate">
              {[
                course.scheduledOffering?.courseNo,
                `${formatCredits(course.credits)} 學分`,
                course.scheduledOffering?.teacher,
              ].filter(Boolean).join('・')}
            </span>
            <GpaBadge
              gpa={course.scheduledOffering?.gpa}
              status={course.scheduledOffering?.gpaStatus}
              detail={{
                gpa_semester: course.scheduledOffering?.gpaSemester,
                gpa_students: course.scheduledOffering?.gpaStudents,
                gpa_teacher: course.scheduledOffering?.gpaTeacher,
                gpa_course_no: course.scheduledOffering?.gpaCourseNo,
              }}
              courseNo={course.scheduledOffering?.courseNo}
            />
            {showSelectionChance && (
              <SelectionChanceBadge
                selectedCount={course.scheduledOffering?.selectedCount}
                capacity={course.scheduledOffering?.capacity}
              />
            )}
            <EnrollmentCountBadge
              selectedCount={course.scheduledOffering?.selectedCount}
              capacity={course.scheduledOffering?.capacity}
            />
            <span className="min-w-0 truncate">
              {slots.length > 0 ? `${displaySlots(slots)}・${displayClassroom(course.scheduledOffering?.classroom)}` : '未提供節次'}
            </span>
          </div>
          {conflictNames.length > 0 && (
            <p className="mt-1 text-xs text-mark">衝堂・和 {conflictNames.join('、')}</p>
          )}
        </div>
        {onDelete && (
          <button
            type="button"
            onClick={onDelete}
            className="shrink-0 rounded-sm border border-rule px-1.5 py-0.5 text-xs text-ink-3 hover:border-accent hover:text-accent"
            title="移除待加簽課程"
          >
            移除
          </button>
        )}
      </div>
    </div>
  );
}

function MetricBox({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'emerald' | 'blue' | 'amber' | 'red' | 'slate';
}) {
  // 只有「已選上／已登記」用 good 色，其餘都是墨色；tone 參數留著給呼叫端。
  return (
    <div>
      <dt className="font-mono text-[10px] tracking-[.1em] text-ink-3">{label}</dt>
      <dd className={`font-mono text-[17px] font-semibold tabular-nums ${tone === 'emerald' ? 'text-good' : 'text-ink'}`}>{value}</dd>
    </div>
  );
}

function ProgressSummary({
  label,
  value,
  target,
}: {
  label: string;
  value: number;
  target: number;
}) {
  const ratio = target > 0 ? Math.min(100, Math.round((value / target) * 100)) : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-ink-2">{label}</span>
        <span className="font-mono tabular-nums text-ink-3"><b className="font-semibold text-ink">{formatCredits(value)}</b> / {formatCredits(target)}</span>
      </div>
      <div className="mt-1 h-[6px] bg-band">
        <div className={`h-[6px] ${ratio >= 100 ? 'bg-good' : 'bg-ink-2'}`} style={{ width: `${ratio}%` }} />
      </div>
    </div>
  );
}

export function RequirementRow({
  requirement,
  status,
  onOpen,
  onDelete,
  onMoveUp,
  onMoveDown,
  canMoveUp = false,
  canMoveDown = false,
  rank,
}: {
  requirement: PendingRequirement;
  status?: RequirementStatus;
  onOpen: () => void;
  onDelete: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  rank?: number;
}) {
  const completed = Boolean(status?.completed);
  const code = requirementCourseCode(requirement);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen();
        }
      }}
      className={`cursor-pointer rounded-sm border p-3 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${completed ? 'border-good bg-good/10' : 'border-rule bg-sheet hover:border-ink'}`}
    >
      <div className="flex items-start gap-3">
        <div className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full font-mono text-xs font-semibold ${completed ? 'bg-good text-sheet' : 'bg-band text-ink-2'}`}>
          {rank || (completed ? '✓' : '·')}
        </div>
        <div className="min-w-0 flex-1 text-left">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-medium">{requirement.title}</p>
            <span className="font-mono text-[10px] text-ink-3">
              {requirement.kind === 'credit_pool' ? '學分池' : requirement.courseNames.length > 1 ? '擇一' : '課程'}
            </span>
          </div>
          <p className="mt-1 font-mono text-[11px] text-ink-2">
            {formatCredits(status?.earnedCredits || 0)} / {formatCredits(status?.targetCredits || requirement.requiredCredits || requirement.credits || 0)} 學分
            {code ? `・課碼 ${code}` : requirement.note ? `・${requirement.note}` : ''}
          </p>
        </div>
        {(onMoveUp || onMoveDown) && (
          <div className="flex shrink-0 flex-col gap-1">
            <button
              onClick={(event) => {
                event.stopPropagation();
                onMoveUp?.();
              }}
              disabled={!canMoveUp}
              className="rounded-sm p-1 text-ink-3 hover:text-ink disabled:cursor-not-allowed disabled:opacity-30"
              title="志願序上移"
            >
              <ArrowUp className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={(event) => {
                event.stopPropagation();
                onMoveDown?.();
              }}
              disabled={!canMoveDown}
              className="rounded-sm p-1 text-ink-3 hover:text-ink disabled:cursor-not-allowed disabled:opacity-30"
              title="志願序下移"
            >
              <ArrowDown className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
        <button
          onClick={(event) => {
            event.stopPropagation();
            onDelete();
          }}
          className="rounded-sm border border-rule px-1.5 py-0.5 text-xs text-ink-3 hover:border-accent hover:text-accent"
          title="移除需求"
        >
          移除
        </button>
      </div>
    </div>
  );
}
