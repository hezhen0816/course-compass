import { useState } from 'react';
import { ArrowDown, ArrowUp, CheckCircle2, Clock, Loader2, RefreshCw, Trash2 } from 'lucide-react';
import type { AppData, Course, OfficialSelectionSyncResponse, PendingRequirement, PlannerStats } from '../../types';
import {
  DAY_COLUMNS,
  PERIODS,
  type PlanningMode,
  type RequirementStatus,
  displayClassroom,
  displaySlots,
  formatCredits,
  isHistoryImportedCourse,
  normalizeName,
  requirementCourseCode,
} from '../../domain/planner';

const WEEKDAY_COLUMNS = DAY_COLUMNS.filter((day) => day.code !== 'S' && day.code !== 'U');
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
const PERIOD_ROW_HEIGHT = 96;

type DayColumn = typeof DAY_COLUMNS[number];
type ScheduleSegment = {
  id: string;
  course: Course;
  dayCode: string;
  startIndex: number;
  span: number;
  lane: number;
  laneCount: number;
};
type WorkspaceSource = 'draft' | 'official';

const PERIOD_INDEX = new Map(PERIODS.map((period, index) => [period, index]));

function ScheduleLegend() {
  const items = [
    { label: '本系必修', className: 'border-rose-200 bg-rose-50' },
    { label: '本系選修', className: 'border-sky-200 bg-sky-50' },
    { label: '通識', className: 'border-purple-200 bg-purple-50' },
    { label: '雙主修', className: 'border-emerald-200 bg-emerald-50' },
    { label: '衝堂', className: 'border-red-300 bg-red-100' },
  ];

  return (
    <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-600">
      {items.map((item) => (
        <span key={item.label} className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1">
          <span className={`h-2.5 w-2.5 rounded-sm border ${item.className}`} />
          {item.label}
        </span>
      ))}
    </div>
  );
}

function planningModeLabel(mode: PlanningMode): string {
  if (mode === 'lottery') return '初選志願';
  if (mode === 'addDrop') return '加退選';
  return '加簽追蹤';
}

function planningModeDescription(mode: PlanningMode): string {
  if (mode === 'lottery') return '同時段多門課會視為競爭志願，抽中一門後其他同時段或同課名志願會失效。';
  if (mode === 'addDrop') return '加退選接近先搶先贏，同時段課程應視為真衝堂並在送出前處理。';
  return '追蹤教授、Email、第一次上課與授權碼狀態，不納入自動送出。';
}

function scheduledCredits(courses: Course[]): number {
  return courses.reduce((sum, course) => sum + (course.category === 'pe' ? 0 : course.credits), 0);
}

function getSlotGroups(courses: Course[]) {
  return DAY_COLUMNS.flatMap((day) => PERIODS.map((period) => {
    const slot = `${day.code}${period}`;
    const slotCourses = courses.filter((course) => course.scheduledOffering?.slots.includes(slot));
    return {
      slot,
      label: `星期${day.label} ${period}`,
      courses: slotCourses,
    };
  })).filter((group) => group.courses.length > 1);
}

function getNameGroups(courses: Course[]) {
  const groups = new Map<string, Course[]>();
  courses.forEach((course) => {
    const key = normalizeName(course.name);
    if (!key) return;
    groups.set(key, [...(groups.get(key) || []), course]);
  });
  return Array.from(groups.values()).filter((coursesInGroup) => coursesInGroup.length > 1);
}

function slotParts(slot: string): { dayCode: string; period: string; periodIndex: number } | null {
  const normalized = slot.trim().toUpperCase();
  const dayCode = normalized.charAt(0);
  const period = normalized.slice(1);
  const periodIndex = PERIOD_INDEX.get(period);
  if (!dayCode || periodIndex === undefined) return null;
  return { dayCode, period, periodIndex };
}

function buildScheduleSegments(courses: Course[], visibleDays: DayColumn[]): ScheduleSegment[] {
  const visibleDayCodes = new Set(visibleDays.map((day) => day.code));
  const draftSegments = courses.flatMap((course) => {
    const byDay = new Map<string, number[]>();
    (course.scheduledOffering?.slots || []).forEach((slot) => {
      const parts = slotParts(slot);
      if (!parts || !visibleDayCodes.has(parts.dayCode)) return;
      byDay.set(parts.dayCode, [...(byDay.get(parts.dayCode) || []), parts.periodIndex]);
    });

    return Array.from(byDay.entries()).flatMap(([dayCode, indexes]) => {
      const sortedIndexes = Array.from(new Set(indexes)).sort((left, right) => left - right);
      const segments: Array<Omit<ScheduleSegment, 'lane' | 'laneCount'>> = [];
      let startIndex: number | null = null;
      let previousIndex: number | null = null;

      sortedIndexes.forEach((index) => {
        if (startIndex === null || previousIndex === null || index !== previousIndex + 1) {
          if (startIndex !== null && previousIndex !== null) {
            segments.push({
              id: `${course.id}-${dayCode}-${startIndex}`,
              course,
              dayCode,
              startIndex,
              span: previousIndex - startIndex + 1,
            });
          }
          startIndex = index;
        }
        previousIndex = index;
      });

      if (startIndex !== null && previousIndex !== null) {
        segments.push({
          id: `${course.id}-${dayCode}-${startIndex}`,
          course,
          dayCode,
          startIndex,
          span: previousIndex - startIndex + 1,
        });
      }

      return segments;
    });
  });

  return visibleDays.flatMap((day) => assignScheduleLanes(
    draftSegments.filter((segment) => segment.dayCode === day.code)
  ));
}

function assignScheduleLanes(segments: Array<Omit<ScheduleSegment, 'lane' | 'laneCount'>>): ScheduleSegment[] {
  const sorted = [...segments].sort((left, right) => (
    left.startIndex - right.startIndex || left.span - right.span || left.course.name.localeCompare(right.course.name)
  ));
  const result: ScheduleSegment[] = [];
  let cluster: Array<Omit<ScheduleSegment, 'lane' | 'laneCount'>> = [];
  let clusterEnd = -1;

  const flushCluster = () => {
    if (cluster.length === 0) return;
    const laneEnds: number[] = [];
    const assigned = cluster.map((segment) => {
      const start = segment.startIndex;
      const end = segment.startIndex + segment.span;
      let lane = laneEnds.findIndex((laneEnd) => laneEnd <= start);
      if (lane < 0) {
        lane = laneEnds.length;
        laneEnds.push(end);
      } else {
        laneEnds[lane] = end;
      }
      return { ...segment, lane, laneCount: 1 };
    });
    const laneCount = Math.max(1, laneEnds.length);
    result.push(...assigned.map((segment) => ({ ...segment, laneCount })));
    cluster = [];
    clusterEnd = -1;
  };

  sorted.forEach((segment) => {
    const segmentEnd = segment.startIndex + segment.span;
    if (cluster.length > 0 && segment.startIndex >= clusterEnd) flushCluster();
    cluster.push(segment);
    clusterEnd = Math.max(clusterEnd, segmentEnd);
  });
  flushCluster();

  return result;
}

export function PlanningWorkspace({
  data,
  stats,
  activeSemester,
  planningMode,
  plannerMessage,
  requirementStatuses,
  officialSelection,
  officialSelectionStatus,
  officialActionCourseNo,
  officialOrderStatus,
  onModeChange,
  onOpenOfficialSelectionSync,
  onJoinOfficialCourse,
  onRemoveOfficialCourse,
  onSaveOfficialOrder,
  onOpenRequirement,
  onDeleteRequirement,
  onMoveRequirement,
  onMoveCourse,
  onDeleteCourse,
}: {
  data: AppData;
  stats: PlannerStats;
  activeSemester?: AppData['semesters'][number];
  planningMode: PlanningMode;
  plannerMessage: string;
  requirementStatuses: Map<string, RequirementStatus>;
  officialSelection: OfficialSelectionSyncResponse | null;
  officialSelectionStatus: 'idle' | 'loading' | 'error' | 'success';
  officialActionCourseNo: string | null;
  officialOrderStatus: 'idle' | 'loading';
  onModeChange: (mode: PlanningMode) => void;
  onOpenOfficialSelectionSync: () => void;
  onJoinOfficialCourse: (courseNo: string, courseName: string) => void;
  onRemoveOfficialCourse: (courseNo: string, courseName: string) => void;
  onSaveOfficialOrder: (orderedCourseNos: string[]) => void;
  onOpenRequirement: (requirement: PendingRequirement) => void;
  onDeleteRequirement: (requirementId: string) => void;
  onMoveRequirement: (requirementId: string, direction: -1 | 1) => void;
  onMoveCourse: (courseId: string, direction: -1 | 1) => void;
  onDeleteCourse: (courseId: string) => void;
}) {
  const [workspaceSource, setWorkspaceSource] = useState<WorkspaceSource>('official');
  const courses = activeSemester?.courses.filter((course) => !isHistoryImportedCourse(course)) || [];
  const pendingCredits = data.pendingRequirements.reduce((sum, requirement) => (
    sum + (requirement.requiredCredits ?? requirement.credits ?? 0)
  ), 0);
  const activeCredits = scheduledCredits(courses);
  const slotGroups = getSlotGroups(courses);
  const nameGroups = getNameGroups(courses);
  const trueConflictCount = planningMode === 'lottery' ? 0 : slotGroups.length;
  const competitionCount = planningMode === 'lottery' ? slotGroups.length + nameGroups.length : 0;
  const sortedRequirements = data.pendingRequirements;
  const scheduledById = new Map(courses.map((course, index) => [course.id, index + 1]));
  const activeWorkspaceSource = officialSelection ? workspaceSource : 'draft';
  const isOfficialMode = activeWorkspaceSource === 'official';
  const totalPlanningItems = isOfficialMode && officialSelection
    ? officialSelection.registered_count + officialSelection.available_count
    : courses.length + sortedRequirements.length;
  const modeOptions: Array<{ value: PlanningMode; label: string }> = [
    { value: 'lottery', label: '初選志願' },
    { value: 'addDrop', label: '加退選' },
    { value: 'addCode', label: '加簽追蹤' },
  ];

  return (
    <section id="schedule-preview" className="mt-6 rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 p-4">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-blue-600">選課工作台</p>
            <h2 className="mt-1 text-xl font-semibold text-slate-950">待選清單、志願排序與課表預覽</h2>
            <p className="mt-1 max-w-3xl text-sm text-slate-500">
              {planningModeDescription(planningMode)}
            </p>
          </div>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <button
              type="button"
              onClick={onOpenOfficialSelectionSync}
              disabled={officialSelectionStatus === 'loading'}
              className="inline-flex items-center justify-center gap-2 rounded-md border border-blue-200 bg-white px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <RefreshCw className={`h-4 w-4 ${officialSelectionStatus === 'loading' ? 'animate-spin' : ''}`} />
              同步官方初選
            </button>
            {officialSelection && (
              <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1">
                {[
                  { value: 'draft' as const, label: '本地草稿' },
                  { value: 'official' as const, label: '官方資料' },
                ].map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setWorkspaceSource(option.value)}
                    className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                      activeWorkspaceSource === option.value
                        ? 'bg-white text-blue-700 shadow-sm'
                        : 'text-slate-500 hover:text-slate-900'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            )}
            <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1">
              {modeOptions.map((option) => (
                <button
                  key={option.value}
                  onClick={() => onModeChange(option.value)}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                    planningMode === option.value
                      ? 'bg-white text-blue-700 shadow-sm'
                      : 'text-slate-500 hover:text-slate-900'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
              <span className="text-slate-500">本地草稿目標：</span>
              <span className="font-medium text-slate-900">{activeSemester?.name || '尚未建立學期'}</span>
            </div>
          </div>
        </div>
        <ScheduleLegend />
        {plannerMessage && (
          <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700">
            {plannerMessage}
          </div>
        )}
        <div className="mt-3 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-700">
          {isOfficialMode
            ? '目前顯示的是官方同步資料；加入、取消或儲存志願序時才會送出一次官方請求。'
            : '目前顯示的是本地保存的選課草稿；送出前會重新請求官方選課系統資料，並以官方回應為準。'}
        </div>
        {officialSelection && (
          <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-3">
            <OfficialSelectionMetric label="官方已登記" value={`${officialSelection.registered_count} 門`} />
            <OfficialSelectionMetric label="官方待加入" value={`${officialSelection.available_count} 門`} />
            <OfficialSelectionMetric label="同步時間" value={formatSyncTime(officialSelection.synced_at)} />
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-0 xl:grid-cols-[300px_minmax(0,1fr)_280px]">
        <aside className="border-b border-slate-200 p-4 xl:border-b-0 xl:border-r">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="text-base font-semibold text-slate-900">待選與志願序</h3>
              <p className="mt-1 text-xs text-slate-500">{planningModeLabel(planningMode)}模式 · 最多可管理 30 個志願</p>
            </div>
            <span className="rounded-full bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700">
              {totalPlanningItems} 項
            </span>
          </div>

          <div className="mt-4 space-y-4">
            <div>
              <div className="mb-2 flex items-center justify-between">
                <h4 className="text-sm font-semibold text-slate-700">
                  {isOfficialMode ? '官方登記志願清單' : '本地草稿課表'}
                </h4>
                <span className="text-xs text-slate-500">
                  {isOfficialMode
                    ? `${officialSelection?.registered_count || 0} 門`
                    : `${courses.length} 門・${formatCredits(activeCredits)} 學分`}
                </span>
              </div>
              {isOfficialMode && officialSelection ? (
                <OfficialRegisteredList
                  selection={officialSelection}
                  actionCourseNo={officialActionCourseNo}
                  orderStatus={officialOrderStatus}
                  onRemoveOfficialCourse={onRemoveOfficialCourse}
                  onSaveOfficialOrder={onSaveOfficialOrder}
                />
              ) : courses.length === 0 ? (
                <div className="rounded-md border border-dashed border-slate-300 p-4 text-center text-sm text-slate-500">
                  從查詢結果按「排入課表」後，課程會先存在本地草稿。
                </div>
              ) : (
                <div className="space-y-2">
                  {courses.map((course, index) => (
                    <PlanningListCourse
                      key={course.id}
                      course={course}
                      rank={scheduledById.get(course.id) || 0}
                      mode={planningMode}
                      onMoveUp={() => onMoveCourse(course.id, -1)}
                      onMoveDown={() => onMoveCourse(course.id, 1)}
                      canMoveUp={index > 0}
                      canMoveDown={index < courses.length - 1}
                      onDelete={() => onDeleteCourse(course.id)}
                    />
                  ))}
                </div>
              )}
            </div>

            <div className="border-t border-slate-100 pt-4">
              <div className="mb-2 flex items-center justify-between">
                <h4 className="text-sm font-semibold text-slate-700">{isOfficialMode ? '官方待選清單' : '待排需求'}</h4>
                <span className="text-xs text-slate-500">
                  {isOfficialMode ? `${officialSelection?.available_count || 0} 門` : `${formatCredits(pendingCredits)} 學分`}
                </span>
              </div>
              {isOfficialMode && officialSelection ? (
                <OfficialAvailableList
                  selection={officialSelection}
                  actionCourseNo={officialActionCourseNo}
                  onJoinOfficialCourse={onJoinOfficialCourse}
                />
              ) : sortedRequirements.length === 0 ? (
                <div className="rounded-md border border-dashed border-slate-300 p-4 text-center text-sm text-slate-500">
                  查詢課程後加入待選，或匯入 PDF 產生待排需求。
                </div>
              ) : (
                <div className="space-y-2">
                  {sortedRequirements.map((requirement, index) => (
                    <RequirementRow
                      key={requirement.id}
                      requirement={requirement}
                      status={requirementStatuses.get(requirement.id)}
                      onOpen={() => onOpenRequirement(requirement)}
                      onDelete={() => onDeleteRequirement(requirement.id)}
                      onMoveUp={() => onMoveRequirement(requirement.id, -1)}
                      onMoveDown={() => onMoveRequirement(requirement.id, 1)}
                      canMoveUp={index > 0}
                      canMoveDown={index < sortedRequirements.length - 1}
                      rank={courses.length + index + 1}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </aside>

        <div className="min-w-0 border-b border-slate-200 xl:border-b-0 xl:border-r">
          <div className="border-b border-slate-100 p-4">
            <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h3 className="text-base font-semibold text-slate-900">{isOfficialMode ? '官方功課表' : '週課表預覽'}</h3>
                <p className="mt-1 text-sm text-slate-500">
                  {isOfficialMode
                    ? `官方同步 · ${officialSelection?.schedule_rows.length || 0} 節次列 · ${formatSyncTime(officialSelection?.synced_at || '')}`
                    : `本地草稿 · ${courses.length} 門課 · ${formatCredits(activeCredits)} 學分`}
                </p>
              </div>
              <p className="text-xs text-slate-400 sm:hidden">課表可左右滑動查看更多星期欄位。</p>
            </div>
          </div>
          <PlanningScheduleGrid
            semester={activeSemester}
            officialScheduleRows={isOfficialMode ? officialSelection?.schedule_rows : undefined}
            mode={planningMode}
            courseRanks={scheduledById}
            onDeleteCourse={onDeleteCourse}
          />
        </div>

        <aside className="p-4">
          <h3 className="text-base font-semibold text-slate-900">規劃檢查</h3>
          <p className="mt-1 text-xs text-slate-500">依目前選課階段解讀衝堂、互斥與學分限制。</p>

          <div className="mt-4 grid grid-cols-2 gap-3">
            <MetricBox label="已排學分" value={formatCredits(activeCredits)} tone="emerald" />
            <MetricBox label="待排學分" value={formatCredits(pendingCredits)} tone="blue" />
            <MetricBox label={planningMode === 'lottery' ? '競爭組' : '真衝堂'} value={String(planningMode === 'lottery' ? competitionCount : trueConflictCount)} tone={planningMode === 'lottery' ? 'amber' : trueConflictCount > 0 ? 'red' : 'emerald'} />
            <MetricBox label="志願數" value={`${courses.length + sortedRequirements.length}/30`} tone="slate" />
          </div>

          <div className="mt-4 rounded-lg border border-slate-200 p-3">
            <h4 className="text-sm font-semibold text-slate-800">
              {planningMode === 'lottery' ? '競爭組與互斥提醒' : '衝堂清單'}
            </h4>
            <div className="mt-3 space-y-2">
              {slotGroups.length === 0 && nameGroups.length === 0 ? (
                <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                  目前沒有偵測到同時段或同課名重疊。
                </p>
              ) : (
                <>
                  {slotGroups.slice(0, 4).map((group) => (
                    <ConflictGroupRow
                      key={group.slot}
                      label={group.label}
                      courses={group.courses}
                      mode={planningMode}
                    />
                  ))}
                  {nameGroups.slice(0, 3).map((group) => (
                    <ConflictGroupRow
                      key={`name-${normalizeName(group[0].name)}`}
                      label="同課名互斥"
                      courses={group}
                      mode={planningMode}
                    />
                  ))}
                </>
              )}
            </div>
          </div>

          <div className="mt-4 rounded-lg border border-slate-200 p-3">
            <h4 className="text-sm font-semibold text-slate-800">送出前重點</h4>
            <ul className="mt-2 space-y-2 text-sm text-slate-600">
              {planningMode === 'lottery' ? (
                <>
                  <li>同一時段可放多個志願，抽中一門後其餘同時段會失效。</li>
                  <li>志願序可超過 25 學分，但中籤後系統會受學分上限影響。</li>
                  <li>正式送出前會重新比對官方選課清單與名額狀態。</li>
                  <li>體育、國文、熱門通識建議放多個備案。</li>
                </>
              ) : planningMode === 'addDrop' ? (
                <>
                  <li>同時段課程應先處理衝堂，再到官方系統送出。</li>
                  <li>名額已滿的課程不建議放入主要送出清單。</li>
                  <li>送出仍需使用者在官方系統確認，不做自動搶課。</li>
                </>
              ) : (
                <>
                  <li>記錄教授 Email、第一次上課時間與加簽備註。</li>
                  <li>授權碼僅追蹤狀態，不應自動代填或轉讓。</li>
                  <li>加簽課仍需回官方系統完成流程。</li>
                </>
              )}
            </ul>
          </div>

          <div className="mt-4 rounded-lg border border-slate-200 p-3">
            <h4 className="text-sm font-semibold text-slate-800">畢業門檻影響</h4>
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

function OfficialSelectionMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-white px-3 py-2">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-semibold text-slate-900">{value}</p>
    </div>
  );
}

function OfficialRegisteredList({
  selection,
  actionCourseNo,
  orderStatus,
  onRemoveOfficialCourse,
  onSaveOfficialOrder,
}: {
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
      <div className="rounded-md border border-dashed border-blue-200 bg-blue-50 px-3 py-4 text-center text-sm text-blue-700">
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
      <div className="rounded-md border border-blue-100 bg-blue-50 p-2">
        <p className="text-xs text-blue-700">
          先在這裡調整本地排序，按「儲存志願序」才會送到官方系統。
        </p>
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            onClick={() => onSaveOfficialOrder(draftCourses.map((course) => course.course_no))}
            disabled={!isDirty || isOrderSaving}
            className="inline-flex flex-1 items-center justify-center gap-1 rounded-md bg-blue-600 px-2 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
          >
            {isOrderSaving && <Loader2 className="h-3 w-3 animate-spin" />}
            儲存志願序
          </button>
          <button
            type="button"
            onClick={() => setDraftState({ syncKey: draftSyncKey, courses: selection.registered_courses })}
            disabled={!isDirty || isOrderSaving}
            className="rounded-md border border-blue-200 bg-white px-2 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            還原
          </button>
        </div>
      </div>

      {draftCourses.map((course, index) => {
        const normalizedCourseNo = course.course_no.trim().toUpperCase();
        const isLoading = actionCourseNo === normalizedCourseNo || isOrderSaving;
        return (
        <div key={`${course.raw_priority}-${course.course_no}`} className={`rounded-md border p-3 ${
          isDirty ? 'border-blue-200 bg-blue-50' : 'border-slate-200 bg-white'
        }`}>
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-100 text-xs font-bold text-blue-700">
              {index + 1}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-slate-900">{course.course_name}</p>
              <p className="mt-1 truncate text-xs text-slate-500">{course.course_no}</p>
            </div>
            <div className="flex shrink-0 flex-col gap-1">
              <button
                type="button"
                onClick={() => moveDraftCourse(index, -1)}
                disabled={index === 0 || isOrderSaving}
                className="rounded p-1 text-slate-400 hover:bg-blue-100 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-30"
                aria-label="提高官方志願序"
              >
                <ArrowUp className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => moveDraftCourse(index, 1)}
                disabled={index === draftCourses.length - 1 || isOrderSaving}
                className="rounded p-1 text-slate-400 hover:bg-blue-100 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-30"
                aria-label="降低官方志願序"
              >
                <ArrowDown className="h-3.5 w-3.5" />
              </button>
            </div>
            <button
              type="button"
              onClick={() => onRemoveOfficialCourse(course.course_no, course.course_name)}
              disabled={isLoading}
              className="inline-flex shrink-0 items-center gap-1 rounded-md border border-blue-200 bg-white px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-60"
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
      <div className="rounded-md border border-dashed border-slate-300 p-4 text-center text-sm text-slate-500">
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
        <div key={course.course_no} className="rounded-md border border-slate-200 bg-white p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-900">{course.course_name}</p>
              <p className="mt-1 truncate text-xs text-slate-500">{course.course_no}・{course.teacher || '未列教師'}</p>
            </div>
            <button
              type="button"
              onClick={() => onJoinOfficialCourse(course.course_no, course.course_name)}
              disabled={isLoading}
              className="inline-flex shrink-0 items-center gap-1 rounded-md border border-amber-300 px-2 py-1 text-xs font-medium text-amber-700 hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-60"
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

function PlanningScheduleGrid({
  semester,
  officialScheduleRows,
  mode,
  courseRanks,
  onDeleteCourse,
}: {
  semester?: AppData['semesters'][number];
  officialScheduleRows?: Record<string, string>[];
  mode: PlanningMode;
  courseRanks: Map<string, number>;
  onDeleteCourse: (courseId: string) => void;
}) {
  const [showWeekend, setShowWeekend] = useState(false);
  const courses = semester?.courses.filter((course) => !isHistoryImportedCourse(course)) || [];
  const unscheduled = courses.filter((course) => !course.scheduledOffering?.slots.length);
  const visibleDays = showWeekend ? DAY_COLUMNS : WEEKDAY_COLUMNS;
  const scheduleSegments = buildScheduleSegments(courses, visibleDays);
  if (officialScheduleRows?.length) {
    return (
      <OfficialScheduleTable
        rows={officialScheduleRows}
        showWeekend={showWeekend}
        onToggleWeekend={() => setShowWeekend((current) => !current)}
      />
    );
  }
  return (
    <div className="p-4">
      <div className="mb-3 flex items-center justify-end">
        <button
          type="button"
          onClick={() => setShowWeekend((current) => !current)}
          aria-pressed={showWeekend}
          className={`inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors ${
            showWeekend
              ? 'border-blue-200 bg-blue-50 text-blue-700'
              : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
          }`}
        >
          <span className={`flex h-4 w-7 items-center rounded-full p-0.5 transition-colors ${
            showWeekend ? 'bg-blue-600' : 'bg-slate-300'
          }`}>
            <span className={`h-3 w-3 rounded-full bg-white shadow-sm transition-transform ${
              showWeekend ? 'translate-x-3' : ''
            }`} />
          </span>
          顯示週末
        </button>
      </div>
      <div className="overflow-x-auto">
        <div style={{ minWidth: showWeekend ? 900 : 700 }}>
          <div
            className="grid border-l border-t border-slate-200 text-sm"
            style={{
              gridTemplateColumns: `72px repeat(${visibleDays.length}, minmax(118px, 1fr))`,
              gridTemplateRows: `40px repeat(${PERIODS.length}, ${PERIOD_ROW_HEIGHT}px)`,
            }}
          >
            <div className="z-10 border-b border-r border-slate-200 bg-slate-50 p-2 font-medium text-slate-500">時間</div>
            {visibleDays.map((day, dayIndex) => (
              <div
                key={day.code}
                className="z-10 border-b border-r border-slate-200 bg-slate-50 p-2 text-center font-semibold text-slate-700"
                style={{ gridColumn: dayIndex + 2, gridRow: 1 }}
              >
                星期{day.label}
              </div>
            ))}
            {PERIODS.map((period, periodIndex) => (
              <PeriodTimeCell
                key={period}
                period={period}
                row={periodIndex + 2}
              />
            ))}
            {PERIODS.flatMap((period, periodIndex) => visibleDays.map((day, dayIndex) => (
              <ScheduleBackgroundCell
                key={`${day.code}${period}`}
                dayIndex={dayIndex}
                row={periodIndex + 2}
                isConflict={courses.filter((course) => course.scheduledOffering?.slots.includes(`${day.code}${period}`)).length > 1}
                mode={mode}
              />
            )))}
            {scheduleSegments.map((segment) => (
              <PlanningScheduleEvent
                key={segment.id}
                segment={segment}
                dayIndex={visibleDays.findIndex((day) => day.code === segment.dayCode)}
                mode={mode}
                rank={courseRanks.get(segment.course.id) || 0}
              />
            ))}
          </div>
        </div>
      </div>

      {unscheduled.length > 0 && (
        <div className="mt-4 border-t border-slate-100 pt-4">
          <h4 className="mb-2 text-sm font-semibold text-slate-700">未提供節次的課程</h4>
          <div className="flex flex-wrap gap-2">
            {unscheduled.map((course) => (
              <CoursePill
                key={course.id}
                course={course}
                compact
                onDelete={() => onDeleteCourse(course.id)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function OfficialScheduleTable({
  rows,
  showWeekend,
  onToggleWeekend,
}: {
  rows: Record<string, string>[];
  showWeekend: boolean;
  onToggleWeekend: () => void;
}) {
  const visibleWeekdays = showWeekend ? OFFICIAL_WEEKDAYS : OFFICIAL_WEEKDAYS.slice(0, 5);
  return (
    <div className="p-4">
      <div className="mb-3 flex items-center justify-end">
        <button
          type="button"
          onClick={onToggleWeekend}
          aria-pressed={showWeekend}
          className={`inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors ${
            showWeekend
              ? 'border-blue-200 bg-blue-50 text-blue-700'
              : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
          }`}
        >
          <span className={`flex h-4 w-7 items-center rounded-full p-0.5 transition-colors ${
            showWeekend ? 'bg-blue-600' : 'bg-slate-300'
          }`}>
            <span className={`h-3 w-3 rounded-full bg-white shadow-sm transition-transform ${
              showWeekend ? 'translate-x-3' : ''
            }`} />
          </span>
          顯示週末
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-[760px] w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className="w-14 border border-slate-200 bg-slate-50 px-2 py-2 text-center font-semibold text-slate-700">節次</th>
              <th className="w-20 border border-slate-200 bg-slate-50 px-2 py-2 text-center font-semibold text-slate-700">時間</th>
              {visibleWeekdays.map((weekday) => (
                <th key={weekday.label} className="border border-slate-200 bg-slate-50 px-2 py-2 text-center font-semibold text-slate-700">
                  {weekday.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={`${getOfficialScheduleCell(row, '節次') || index}-${getOfficialScheduleCell(row, '時間') || index}`}>
                <td className="border border-slate-200 bg-slate-50 px-2 py-2 text-center font-semibold text-slate-700">
                  {getOfficialScheduleCell(row, '節次') || index + 1}
                </td>
                <td className="whitespace-pre-line border border-slate-200 bg-slate-50 px-2 py-2 text-center text-xs leading-tight text-slate-500">
                  {formatOfficialTime(getOfficialScheduleCell(row, '時間'))}
                </td>
                {visibleWeekdays.map((weekday) => {
                  const value = getOfficialScheduleCell(row, weekday.label);
                  return (
                    <td
                      key={weekday.label}
                      className={`h-16 border border-slate-200 px-2 py-2 align-top ${
                        value ? 'bg-blue-50 text-slate-900' : 'bg-white text-slate-400'
                      }`}
                    >
                      {value ? (
                        <div className="rounded-md border border-blue-100 bg-white px-2 py-1.5 text-xs font-medium leading-relaxed text-slate-900 shadow-sm">
                          {value}
                        </div>
                      ) : null}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
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

function compactOfficialKey(value: string): string {
  return value.replace(/\s+/g, '').replace(/[：:]/g, '');
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

  const columnIndex = OFFICIAL_SCHEDULE_COLUMNS.indexOf(label);
  if (columnIndex < 0) return '';
  return Object.values(row)[columnIndex] || '';
}

function formatOfficialTime(value: string | undefined): string {
  if (!value) return '';
  return value.replace(/~/g, '\n').replace(/～/g, '\n');
}

function ScheduleBackgroundCell({
  dayIndex,
  row,
  isConflict,
  mode,
}: {
  dayIndex: number;
  row: number;
  isConflict: boolean;
  mode: PlanningMode;
}) {
  const cellTone = isConflict
    ? mode === 'lottery' ? 'bg-amber-50/60' : 'bg-red-50'
    : 'bg-white';
  return (
    <div
      className={`border-b border-r border-slate-200 ${cellTone}`}
      style={{ gridColumn: dayIndex + 2, gridRow: row }}
    />
  );
}

function PeriodTimeCell({
  period,
  row,
}: {
  period: string;
  row: number;
}) {
  const time = PERIOD_TIME_LABELS[period];
  return (
    <div
      className="z-10 border-b border-r border-slate-200 bg-slate-50 px-2 py-2 text-center"
      style={{ gridColumn: 1, gridRow: row }}
    >
      <p className="text-sm font-semibold text-slate-700">{period}</p>
      {time && (
        <p className="mt-1 leading-tight text-[10px] font-medium text-slate-400">
          {time.start}
          <br />
          {time.end}
        </p>
      )}
    </div>
  );
}

function PlanningScheduleEvent({
  segment,
  dayIndex,
  mode,
  rank,
}: {
  segment: ScheduleSegment;
  dayIndex: number;
  mode: PlanningMode;
  rank: number;
}) {
  const { course } = segment;
  const tone = coursePillTone(course);
  const hasOverlap = segment.laneCount > 1;
  const eventTone = hasOverlap
    ? mode === 'lottery' ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-red-300 bg-red-50 text-red-900'
    : tone;
  const width = hasOverlap ? `calc(100% - ${18 + segment.lane * 14}px)` : 'calc(100% - 8px)';
  const marginLeft = hasOverlap ? `${4 + segment.lane * 14}px` : '4px';
  const teacher = course.scheduledOffering?.teacher || course.details?.professor || '未列教師';

  return (
    <div
      className={`z-20 my-1 overflow-hidden rounded-md border px-2 py-1.5 text-left shadow-sm ${eventTone}`}
      style={{
        gridColumn: dayIndex + 2,
        gridRow: `${segment.startIndex + 2} / span ${segment.span}`,
        width,
        marginLeft,
        zIndex: 20 + segment.lane,
      }}
      title={`${rank}. ${course.name}・${teacher}・${displaySlots(course.scheduledOffering?.slots || [])}`}
    >
      <div className="flex items-center gap-1.5">
        <span className={`flex h-5 min-w-5 items-center justify-center rounded-full text-[11px] font-bold ${
          hasOverlap && mode === 'lottery' ? 'bg-amber-100 text-amber-800' : 'bg-blue-100 text-blue-700'
        }`}>
          {rank}
        </span>
        {hasOverlap && (
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
            mode === 'lottery' ? 'bg-amber-100 text-amber-800' : 'bg-red-100 text-red-800'
          }`}>
            {mode === 'lottery' ? '競' : '衝'}
          </span>
        )}
      </div>
      <p className="mt-1 truncate text-xs font-semibold text-slate-900">{course.name}</p>
      {!hasOverlap && <p className="truncate text-[11px] opacity-75">{teacher}</p>}
    </div>
  );
}

function PlanningListCourse({
  course,
  rank,
  mode,
  onDelete,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
}: {
  course: Course;
  rank: number;
  mode: PlanningMode;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
}) {
  const slots = course.scheduledOffering?.slots || [];
  return (
    <div className="rounded-md border border-slate-200 bg-white p-3">
      <div className="flex items-start gap-3">
        <div className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
          mode === 'lottery' ? 'bg-red-50 text-red-600' : 'bg-blue-50 text-blue-700'
        }`}>
          {rank}
        </div>
        <div className="min-w-0 flex-1 text-left">
          <p className="truncate text-sm font-semibold text-slate-900">{course.name}</p>
          <p className="mt-1 text-xs text-slate-500">
            {formatCredits(course.credits)} 學分
            {course.scheduledOffering?.teacher ? `・${course.scheduledOffering.teacher}` : ''}
          </p>
          <p className="mt-1 truncate text-xs text-slate-500">
            {slots.length > 0 ? `${displaySlots(slots)}・${displayClassroom(course.scheduledOffering?.classroom)}` : '未提供節次'}
          </p>
        </div>
        <div className="flex shrink-0 flex-col gap-1">
          <button
            type="button"
            onClick={onMoveUp}
            disabled={!canMoveUp}
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-30"
            title="志願序上移"
          >
            <ArrowUp className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={onMoveDown}
            disabled={!canMoveDown}
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-30"
            title="志願序下移"
          >
            <ArrowDown className="h-3.5 w-3.5" />
          </button>
        </div>
        <button
          type="button"
          onClick={onDelete}
          className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
          title="退回待排需求"
        >
          <Trash2 className="h-4 w-4" />
        </button>
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
  const toneClass = {
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    blue: 'border-blue-200 bg-blue-50 text-blue-700',
    amber: 'border-amber-200 bg-amber-50 text-amber-700',
    red: 'border-red-200 bg-red-50 text-red-700',
    slate: 'border-slate-200 bg-slate-50 text-slate-700',
  }[tone];
  return (
    <div className={`rounded-lg border p-3 ${toneClass}`}>
      <p className="text-xs font-medium opacity-80">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
    </div>
  );
}

function ConflictGroupRow({
  label,
  courses,
  mode,
}: {
  label: string;
  courses: Course[];
  mode: PlanningMode;
}) {
  return (
    <div className={`rounded-md border px-3 py-2 text-sm ${
      mode === 'lottery' ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-red-200 bg-red-50 text-red-900'
    }`}>
      <div className="flex items-center justify-between gap-3">
        <span className="font-semibold">{label}</span>
        <span className="rounded-full bg-white/80 px-2 py-0.5 text-xs font-medium">
          {mode === 'lottery' ? '競爭' : '衝堂'}
        </span>
      </div>
      <p className="mt-1 text-xs opacity-80">
        {courses.map((course) => course.name).join('、')}
      </p>
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
      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>{label}</span>
        <span>{formatCredits(value)} / {formatCredits(target)}</span>
      </div>
      <div className="mt-1 h-2 rounded-full bg-slate-100">
        <div className="h-2 rounded-full bg-blue-600" style={{ width: `${ratio}%` }} />
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
      className={`cursor-pointer rounded-md border p-3 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 ${completed ? 'border-emerald-200 bg-emerald-50 hover:bg-emerald-100' : 'border-slate-200 bg-white hover:bg-slate-50'}`}
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">
          {rank || (completed ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <Clock className="h-4 w-4 text-slate-400" />)}
        </div>
        <div className="min-w-0 flex-1 text-left">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-semibold text-slate-900">{requirement.title}</p>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">
              {requirement.kind === 'credit_pool' ? '學分池' : requirement.kind === 'choice' ? '擇一' : '課程'}
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-500">
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
              className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-30"
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
              className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-30"
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
          className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
          title="移除需求"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function coursePillTone(course: Course): string {
  if (course.program === 'double_major') return 'border-emerald-200 bg-emerald-50 hover:bg-emerald-100';
  if (course.program === 'minor') return 'border-amber-200 bg-amber-50 hover:bg-amber-100';

  switch (course.category) {
    case 'chinese':
      return 'border-orange-200 bg-orange-50 hover:bg-orange-100';
    case 'english':
      return 'border-indigo-200 bg-indigo-50 hover:bg-indigo-100';
    case 'social':
      return 'border-yellow-200 bg-yellow-50 hover:bg-yellow-100';
    case 'pe':
      return 'border-green-200 bg-green-50 hover:bg-green-100';
    case 'gen_ed':
      return 'border-purple-200 bg-purple-50 hover:bg-purple-100';
    case 'compulsory':
      return 'border-rose-200 bg-rose-50 hover:bg-rose-100';
    case 'elective':
      return 'border-sky-200 bg-sky-50 hover:bg-sky-100';
    default:
      return 'border-blue-200 bg-blue-50 hover:bg-blue-100';
  }
}

function CoursePill({
  course,
  conflict = false,
  compact = false,
  onDelete,
}: {
  course: Course;
  conflict?: boolean;
  compact?: boolean;
  onDelete: () => void;
}) {
  const isImportedHistory = isHistoryImportedCourse(course);
  const hasScheduleData = Boolean(course.scheduledOffering);
  const teacher = course.scheduledOffering?.teacher || course.details?.professor;
  const courseMeta = isImportedHistory
    ? `${formatCredits(course.credits)} 學分・${course.grade || '修課紀錄'}`
    : `${formatCredits(course.credits)} 學分・${teacher || (hasScheduleData ? '未列教師' : '未提供節次/教師')}`;
  const toneClass = conflict ? 'border-red-300 bg-red-100' : coursePillTone(course);
  return (
    <div
      className={`group rounded-md border px-2 py-1.5 ${toneClass}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className={`truncate font-semibold ${compact ? 'text-xs' : 'text-[12px]'} text-slate-900`}>{course.name}</p>
          <p className="mt-0.5 truncate text-[11px] text-slate-500">
            {courseMeta}
          </p>
          {!compact && !isImportedHistory && (
            <p className="truncate text-[11px] text-slate-500">{displayClassroom(course.scheduledOffering?.classroom || course.details?.location)}</p>
          )}
        </div>
        <button
          onClick={(event) => {
            event.stopPropagation();
            onDelete();
          }}
          className="rounded p-0.5 text-slate-400 opacity-100 hover:bg-white hover:text-red-600"
          title="退回待排需求"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
