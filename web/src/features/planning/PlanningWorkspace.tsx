import { ArrowDown, ArrowUp, CheckCircle2, Clock, Trash2 } from 'lucide-react';
import type { AppData, Course, PendingRequirement, PlannerStats } from '../../types';
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

export function PlanningWorkspace({
  data,
  stats,
  activeSemester,
  planningMode,
  plannerMessage,
  requirementStatuses,
  onModeChange,
  onOpenRequirement,
  onDeleteRequirement,
  onMoveRequirement,
  onDeleteCourse,
}: {
  data: AppData;
  stats: PlannerStats;
  activeSemester?: AppData['semesters'][number];
  planningMode: PlanningMode;
  plannerMessage: string;
  requirementStatuses: Map<string, RequirementStatus>;
  onModeChange: (mode: PlanningMode) => void;
  onOpenRequirement: (requirement: PendingRequirement) => void;
  onDeleteRequirement: (requirementId: string) => void;
  onMoveRequirement: (requirementId: string, direction: -1 | 1) => void;
  onDeleteCourse: (courseId: string) => void;
}) {
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
          目前顯示的是本地保存的選課草稿；送出前會重新請求官方選課系統資料，並以官方回應為準。
        </div>
      </div>

      <div className="grid grid-cols-1 gap-0 xl:grid-cols-[320px_minmax(0,1fr)_320px]">
        <aside className="border-b border-slate-200 p-4 xl:border-b-0 xl:border-r">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="text-base font-semibold text-slate-900">待選與志願序</h3>
              <p className="mt-1 text-xs text-slate-500">{planningModeLabel(planningMode)}模式 · 最多可管理 30 個志願</p>
            </div>
            <span className="rounded-full bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700">
              {courses.length + sortedRequirements.length} 項
            </span>
          </div>

          <div className="mt-4 space-y-4">
            <div>
              <div className="mb-2 flex items-center justify-between">
                <h4 className="text-sm font-semibold text-slate-700">本地草稿課表</h4>
                <span className="text-xs text-slate-500">{courses.length} 門・{formatCredits(activeCredits)} 學分</span>
              </div>
              {courses.length === 0 ? (
                <div className="rounded-md border border-dashed border-slate-300 p-4 text-center text-sm text-slate-500">
                  從查詢結果按「排入課表」後，課程會先存在本地草稿。
                </div>
              ) : (
                <div className="space-y-2">
                  {courses.map((course) => (
                    <PlanningListCourse
                      key={course.id}
                      course={course}
                      rank={scheduledById.get(course.id) || 0}
                      mode={planningMode}
                      onDelete={() => onDeleteCourse(course.id)}
                    />
                  ))}
                </div>
              )}
            </div>

            <div className="border-t border-slate-100 pt-4">
              <div className="mb-2 flex items-center justify-between">
                <h4 className="text-sm font-semibold text-slate-700">待排需求</h4>
                <span className="text-xs text-slate-500">{formatCredits(pendingCredits)} 學分</span>
              </div>
              {sortedRequirements.length === 0 ? (
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
                <h3 className="text-base font-semibold text-slate-900">週課表預覽</h3>
                <p className="mt-1 text-sm text-slate-500">
                  本地草稿 · {courses.length} 門課 · {formatCredits(activeCredits)} 學分
                </p>
              </div>
              <p className="text-xs text-slate-400 sm:hidden">課表可左右滑動查看更多星期欄位。</p>
            </div>
          </div>
          <PlanningScheduleGrid
            semester={activeSemester}
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

function PlanningScheduleGrid({
  semester,
  mode,
  courseRanks,
  onDeleteCourse,
}: {
  semester?: AppData['semesters'][number];
  mode: PlanningMode;
  courseRanks: Map<string, number>;
  onDeleteCourse: (courseId: string) => void;
}) {
  const courses = semester?.courses.filter((course) => !isHistoryImportedCourse(course)) || [];
  const unscheduled = courses.filter((course) => !course.scheduledOffering?.slots.length);
  return (
    <div className="p-4">
      <div className="overflow-x-auto">
        <div className="min-w-[900px]">
          <div className="grid grid-cols-[72px_repeat(7,minmax(112px,1fr))] border-l border-t border-slate-200 text-sm">
            <div className="border-b border-r border-slate-200 bg-slate-50 p-2 font-medium text-slate-500">時間</div>
            {DAY_COLUMNS.map((day) => (
              <div key={day.code} className="border-b border-r border-slate-200 bg-slate-50 p-2 text-center font-semibold text-slate-700">
                星期{day.label}
              </div>
            ))}
            {PERIODS.map((period) => (
              <PlanningScheduleRow
                key={period}
                period={period}
                courses={courses}
                mode={mode}
                courseRanks={courseRanks}
                onDeleteCourse={onDeleteCourse}
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

function PlanningScheduleRow({
  period,
  courses,
  mode,
  courseRanks,
  onDeleteCourse,
}: {
  period: string;
  courses: Course[];
  mode: PlanningMode;
  courseRanks: Map<string, number>;
  onDeleteCourse: (courseId: string) => void;
}) {
  return (
    <>
      <div className="border-b border-r border-slate-200 bg-slate-50 p-2 text-center font-semibold text-slate-600">{period}</div>
      {DAY_COLUMNS.map((day) => {
        const slot = `${day.code}${period}`;
        const slotCourses = courses.filter((course) => course.scheduledOffering?.slots.includes(slot));
        const hasOverlap = slotCourses.length > 1;
        const cellTone = hasOverlap
          ? mode === 'lottery' ? 'bg-amber-50/70' : 'bg-red-50'
          : 'bg-white';
        return (
          <div key={slot} className={`min-h-24 border-b border-r border-slate-200 p-1.5 ${cellTone}`}>
            {hasOverlap ? (
              <PlanningOverlapGroup
                courses={slotCourses}
                mode={mode}
                courseRanks={courseRanks}
                onDeleteCourse={onDeleteCourse}
              />
            ) : (
              <div className="space-y-1.5">
                {slotCourses.map((course) => (
                  <PlanningScheduleCard
                    key={course.id}
                    course={course}
                    rank={courseRanks.get(course.id) || 0}
                    onDelete={() => onDeleteCourse(course.id)}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

function PlanningScheduleCard({
  course,
  rank,
  onDelete,
}: {
  course: Course;
  rank: number;
  onDelete: () => void;
}) {
  const tone = coursePillTone(course);
  return (
    <div
      className={`w-full rounded-md border px-2 py-1.5 text-left shadow-sm ${tone}`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-blue-100 text-[11px] font-bold text-blue-700">
          {rank}
        </span>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onDelete();
          }}
          className="rounded p-0.5 text-slate-400 hover:bg-white hover:text-red-600"
          title="移除課程"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      <p className="mt-1 truncate text-xs font-semibold text-slate-900">{course.name}</p>
      <p className="truncate text-[11px] text-slate-500">
        {course.scheduledOffering?.teacher || course.details?.professor || '未列教師'}
      </p>
    </div>
  );
}

function PlanningOverlapGroup({
  courses,
  mode,
  courseRanks,
  onDeleteCourse,
}: {
  courses: Course[];
  mode: PlanningMode;
  courseRanks: Map<string, number>;
  onDeleteCourse: (courseId: string) => void;
}) {
  const isLottery = mode === 'lottery';
  const tone = isLottery
    ? 'border-amber-300 bg-amber-50 text-amber-900'
    : 'border-red-300 bg-red-50 text-red-900';
  const badgeTone = isLottery
    ? 'bg-amber-100 text-amber-800'
    : 'bg-red-100 text-red-800';

  return (
    <div className={`rounded-md border p-2 shadow-sm ${tone}`}>
      <div className="flex items-center justify-between gap-2">
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${badgeTone}`}>
          {isLottery ? '競爭組' : '衝堂'}
        </span>
        <span className="text-[11px] font-medium opacity-75">{courses.length} 門同時段</span>
      </div>
      <p className="mt-1 text-[11px] opacity-75">
        {isLottery ? '抽中一門後，其餘同時段志願會失效。' : '送出前需移除重疊課程。'}
      </p>
      <div className="mt-2 space-y-1">
        {courses.map((course) => (
          <div key={course.id} className="rounded border border-white/80 bg-white px-2 py-1">
            <div className="flex items-start gap-2">
              <span className={`mt-0.5 flex h-5 min-w-5 items-center justify-center rounded-full text-[11px] font-bold ${badgeTone}`}>
                {courseRanks.get(course.id) || 0}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold text-slate-900">{course.name}</p>
                <p className="truncate text-[11px] text-slate-500">
                  {course.scheduledOffering?.teacher || course.details?.professor || '未列教師'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => onDeleteCourse(course.id)}
                className="rounded p-0.5 text-slate-400 hover:bg-slate-50 hover:text-red-600"
                title="移除課程"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PlanningListCourse({
  course,
  rank,
  mode,
  onDelete,
}: {
  course: Course;
  rank: number;
  mode: PlanningMode;
  onDelete: () => void;
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
        <button
          type="button"
          onClick={onDelete}
          className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
          title="移除課程"
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
          title="移除課程"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
