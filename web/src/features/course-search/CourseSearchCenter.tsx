import { Loader2, Search, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { AppData, Course, CourseSearchResult, CourseSemesterInfo, PendingRequirement } from '../../shared/types';
import { listCourseDepartments, parseCourseDepartment } from '../../shared/domain/courseDepartments';
import { gpaDetailParts, gpaValueLabel } from '../../shared/domain/gpa';
import { GpaHistoryModal } from './GpaHistoryModal';
import { currentEnrollmentPhase } from '../../shared/domain/enrollmentCalendar';
import { evaluateEligibility, parseCourseRestrictions, type EligibilityLevel, type StudentIdentity } from '../../shared/domain/courseRestrictions';
import {
  type CapacityFilter,
  type ManualSearchSummary,
  type SearchMode,
  capacityLabel,
  capacityStatus,
  displayClassroom,
  displaySlots,
  findScheduledCourseByOffering,
  formatCredits,
  parseNodeSlots,
  requirementLabel,
} from '../../shared/domain/planner';
import { findOfferingConflicts, isEnrolledOffering, occupiedSlotSet } from '../../shared/domain/scheduleConflicts';

type CourseSearchCenterProps = {
  data: AppData;
  courseSemesters: CourseSemesterInfo[];
  courseSemestersError: string;
  querySemester: string;
  currentCourseSemesterLabel: string;
  manualMode: SearchMode;
  manualQuery: string;
  exactCourseNameSearch: boolean;
  includeCrossSchool: boolean;
  manualStatus: 'idle' | 'loading' | 'error';
  manualError: string;
  manualSearchSummary: ManualSearchSummary | null;
  manualResults: CourseSearchResult[];
  filteredManualResults: CourseSearchResult[];
  teacherFilter: string;
  creditFilter: string;
  requireOptionFilter: string;
  timeFilter: string;
  capacityFilter: CapacityFilter;
  canRunManualSearch: boolean;
  virtualCourseCredits: number;
  activeSemesterId: string;
  onQuerySemesterChange: (semester: string) => void;
  onManualModeChange: (mode: SearchMode) => void;
  onManualQueryChange: (query: string) => void;
  onExactCourseNameSearchChange: (enabled: boolean) => void;
  onIncludeCrossSchoolChange: (enabled: boolean) => void;
  onTeacherFilterChange: (teacher: string) => void;
  onCreditFilterChange: (credits: string) => void;
  onRequireOptionFilterChange: (option: string) => void;
  onTimeFilterChange: (time: string) => void;
  onCapacityFilterChange: (capacity: CapacityFilter) => void;
  onRunManualSearch: () => void | Promise<void>;
  onResetFilters: () => void;
  onExportResults: () => void;
  onAddPendingCourse: (group: PendingCourseGroup, courseName: string) => void;
  onDeletePendingCourse: (requirementId: string) => void;
  onSearchPendingCourse: (courseName: string) => void;
  officialActionCourseNo: string | null;
  onAddSelectionCourse: (offering: CourseSearchResult) => void;
  onAddPlannedCourse: (offering: CourseSearchResult, requirementId?: string) => void;
  onAddMonitorCourse: (offering: CourseSearchResult) => void;
  monitorActionCourseNo: string | null;
  onDeleteVirtualCourse: (courseId: string) => void;
  onOpenPlanning: () => void;
  /** 校務帳號（學號），用來看單雙號分班；沒有也能判斷系所資格。 */
  schoolUsername?: string;
};

type PendingCourseGroup = 'double_major' | 'minor';

const PENDING_COURSE_GROUPS: Array<{ value: PendingCourseGroup; label: string; setId: string }> = [
  { value: 'double_major', label: '雙主修', setId: 'manual-double-major-todo' },
  { value: 'minor', label: '輔系', setId: 'manual-minor-todo' },
];

const COURSE_DEPARTMENT_LIST = listCourseDepartments();

/** 時段指紋只畫週一到週五第 1–10 節；夜間與週末的課在文字列仍看得到。 */
const FINGERPRINT_DAYS = ['M', 'T', 'W', 'R', 'F'];
const FINGERPRINT_PERIODS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'];

const FIELD_CLASS =
  'mt-0.5 w-full min-w-0 border-0 border-b border-rule bg-transparent px-0 py-1 text-sm text-ink outline-none placeholder:text-ink-3 focus:border-ink disabled:text-ink-3';
const LABEL_CLASS = 'block font-mono text-[10px] tracking-[.1em] text-ink-3';

/**
 * 課程查詢：官方開課查詢、篩選、結果列與未來規劃托盤。
 *
 * 新設計語言版本。功能一項沒少：查詢條件、進階篩選、匯出、待修清單、系所代碼對照、
 * 規劃／選課／監聽三個動作與認列下拉都還在；只是把表格換成一列一門課，
 * 前面多了一格「時段指紋」，看得出跟本學期課表卡不卡。
 */
export function CourseSearchCenter({
  data,
  courseSemesters,
  courseSemestersError,
  querySemester,
  currentCourseSemesterLabel,
  manualMode,
  manualQuery,
  exactCourseNameSearch,
  includeCrossSchool,
  manualStatus,
  manualError,
  manualSearchSummary,
  manualResults,
  filteredManualResults,
  teacherFilter,
  creditFilter,
  requireOptionFilter,
  timeFilter,
  capacityFilter,
  canRunManualSearch,
  virtualCourseCredits,
  activeSemesterId,
  onQuerySemesterChange,
  onManualModeChange,
  onManualQueryChange,
  onExactCourseNameSearchChange,
  onIncludeCrossSchoolChange,
  onTeacherFilterChange,
  onCreditFilterChange,
  onRequireOptionFilterChange,
  onTimeFilterChange,
  onCapacityFilterChange,
  onRunManualSearch,
  onResetFilters,
  onExportResults,
  onAddPendingCourse,
  onDeletePendingCourse,
  onSearchPendingCourse,
  officialActionCourseNo,
  onAddSelectionCourse,
  onAddPlannedCourse,
  onAddMonitorCourse,
  monitorActionCourseNo,
  onDeleteVirtualCourse,
  onOpenPlanning,
  schoolUsername,
}: CourseSearchCenterProps) {
  const virtualCourses = useMemo(() => data.selectionPlan?.courses || [], [data.selectionPlan?.courses]);
  // 認列＝把這門課算進某條需求。以前只有兩個寫死的「認列規則」集可選，
  // 現在 PDF 匯入的每一條需求都能選。
  const recognitionRequirements = data.pendingRequirements;
  // 用系所（資訊工程系）而不是整份 PDF 名稱（114學年度…應修科目表），後者塞不進下拉。
  const requirementSetNames = useMemo(
    () => new Map(data.requirementSets.map((set) => [set.id, set.department || set.name])),
    [data.requirementSets],
  );
  const [activePendingGroup, setActivePendingGroup] = useState<PendingCourseGroup>('double_major');
  const [pendingCourseName, setPendingCourseName] = useState('');
  const activePendingSetId = PENDING_COURSE_GROUPS.find((group) => group.value === activePendingGroup)?.setId || '';
  const pendingCourses = data.pendingRequirements.filter((requirement) => requirement.setId === activePendingSetId);
  const addPendingCourse = () => {
    const courseName = pendingCourseName.trim();
    if (!courseName) return;
    onAddPendingCourse(activePendingGroup, courseName);
    setPendingCourseName('');
  };

  // 指紋底圖與「衝堂」標籤用同一份佔用時段：本學期已選上＋未來規劃／待加簽。
  const occupiedSlots = useMemo(() => occupiedSlotSet(data), [data]);
  const identity = useMemo<StudentIdentity>(() => ({
    ...(data.settings?.programDepartments ?? {}),
    studentId: schoolUsername,
  }), [data.settings?.programDepartments, schoolUsername]);
  const phaseKind = useMemo(() => currentEnrollmentPhase(querySemester).kind, [querySemester]);

  const resultSummary = manualSearchSummary
    ? `${manualSearchSummary.resultCount} 門符合・顯示 ${filteredManualResults.length} 門`
    : '輸入條件後開始查詢';

  return (
    <div className="space-y-5">
      <section className="grid gap-x-8 gap-y-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
        <div>
          <p className="font-mono text-[11px] tracking-[.14em] text-ink-2">課程查詢</p>
          <h1 className="mt-0.5 text-[19px] font-bold">官方開課查詢</h1>
          <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-ink-2">
            查詢官方開課資料，加入未來規劃、官方選課清單或名額監聽；若官方拒絕，會以待加簽標示在課表上。
          </p>
        </div>
        <div className="flex items-center gap-4">
          <span className="font-mono text-xs tabular-nums text-ink-3">{resultSummary}</span>
          <button
            type="button"
            onClick={onExportResults}
            disabled={filteredManualResults.length === 0}
            className="rounded-sm border border-rule bg-sheet px-3 py-1.5 text-[13px] text-ink-2 hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:border-rule disabled:hover:text-ink-2"
          >
            匯出結果
          </button>
        </div>
      </section>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_292px]">
        <section className="min-w-0 overflow-hidden rounded-2xl bg-sheet shadow-card">
          {/* 主查詢一行：學期、查詢方式、關鍵字、查詢 */}
          <div className="flex flex-wrap items-stretch border-b border-rule">
            <div className="basis-full border-b border-rule px-4 py-2.5 sm:basis-auto sm:border-b-0">
              <label className={LABEL_CLASS} htmlFor="course-search-semester">學期</label>
              <select
                id="course-search-semester"
                value={querySemester}
                onChange={(event) => onQuerySemesterChange(event.target.value)}
                className={`${FIELD_CLASS} font-mono`}
              >
                {courseSemesters.length === 0 && <option value={querySemester}>{querySemester}</option>}
                {courseSemesters.map((semester) => (
                  <option key={semester.semester} value={semester.semester}>
                    {semester.semester}{semester.english_label ? `・${semester.english_label}` : ''}
                  </option>
                ))}
              </select>
            </div>
            <div className="border-b border-rule px-4 py-2.5 sm:border-b-0 sm:border-l">
              <span className={LABEL_CLASS}>查詢方式</span>
              <div className="mt-1 inline-flex overflow-hidden rounded-sm border border-rule">
                {(['name', 'code'] as SearchMode[]).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => onManualModeChange(mode)}
                    aria-pressed={manualMode === mode}
                    className={`px-3 py-1 text-[13px] ${
                      manualMode === mode ? 'bg-accent text-sheet' : 'text-ink-2 hover:text-ink'
                    }`}
                  >
                    {mode === 'name' ? '課名' : '課碼'}
                  </button>
                ))}
              </div>
            </div>
            <div className="min-w-0 flex-1 basis-[220px] border-b border-rule px-4 py-2.5 sm:border-b-0 sm:border-l">
              <label className={LABEL_CLASS} htmlFor="course-search-query">關鍵字</label>
              <input
                id="course-search-query"
                value={manualQuery}
                onChange={(event) => onManualQueryChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && canRunManualSearch) void onRunManualSearch();
                }}
                placeholder={manualMode === 'name' ? '資料結構' : 'CS2006301'}
                className={`${FIELD_CLASS} ${manualMode === 'code' ? 'font-mono' : ''}`}
              />
            </div>
            <div className="flex basis-full items-end px-4 py-2.5 sm:basis-auto sm:border-l sm:border-rule">
              <button
                type="button"
                onClick={() => void onRunManualSearch()}
                disabled={!canRunManualSearch}
                className="w-full rounded-sm bg-accent px-6 py-2 text-sm font-medium text-sheet disabled:cursor-not-allowed disabled:opacity-45 sm:w-auto"
              >
                {manualStatus === 'loading' ? '查詢中…' : '查詢'}
              </button>
            </div>
          </div>
          <p className={`border-b border-rule px-4 py-1.5 font-mono text-[11px] ${courseSemestersError ? 'text-mark' : 'text-ink-3'}`}>
            {courseSemestersError
              ? `學期清單載入失敗，目前只能查 ${querySemester}。${courseSemestersError}`
              : `目前查詢 ${currentCourseSemesterLabel}${courseSemesters.length > 1 ? `・可查 ${courseSemesters.length} 個學期，含歷年` : ''}`}
          </p>

          <div className="flex flex-wrap gap-x-5 gap-y-2 border-b border-rule px-4 py-2.5">
            <Check
              checked={exactCourseNameSearch}
              disabled={manualMode !== 'name'}
              onChange={onExactCourseNameSearchChange}
              label="完整課名（不做部分比對）"
            />
            <Check
              checked={includeCrossSchool}
              onChange={onIncludeCrossSchoolChange}
              label="含台大／師大跨校課程"
              title="包含台大、師大的跨校課程（課碼 3N、3T 開頭）"
            />
          </div>

          {/* 進階篩選一格一欄 */}
          <div className="grid grid-cols-2 gap-px border-b border-rule bg-rule md:grid-cols-5">
            <div className="bg-sheet px-4 py-2.5">
              <label className={LABEL_CLASS} htmlFor="course-search-teacher">教師</label>
              <input
                id="course-search-teacher"
                value={teacherFilter}
                onChange={(event) => onTeacherFilterChange(event.target.value)}
                placeholder="不限"
                className={FIELD_CLASS}
              />
            </div>
            <div className="bg-sheet px-4 py-2.5">
              <label className={LABEL_CLASS} htmlFor="course-search-credits">學分</label>
              <select
                id="course-search-credits"
                value={creditFilter}
                onChange={(event) => onCreditFilterChange(event.target.value)}
                className={FIELD_CLASS}
              >
                <option value="all">不限</option>
                <option value="0">0 學分</option>
                <option value="1">1 學分</option>
                <option value="2">2 學分</option>
                <option value="3">3 學分</option>
                <option value="4">4 學分</option>
              </select>
            </div>
            <div className="bg-sheet px-4 py-2.5">
              <label className={LABEL_CLASS} htmlFor="course-search-require">必修 / 選修</label>
              <select
                id="course-search-require"
                value={requireOptionFilter}
                onChange={(event) => onRequireOptionFilterChange(event.target.value)}
                className={FIELD_CLASS}
              >
                <option value="all">不限</option>
                <option value="R">必修</option>
                <option value="E">選修</option>
              </select>
            </div>
            <div className="bg-sheet px-4 py-2.5">
              <label className={LABEL_CLASS} htmlFor="course-search-time">節次</label>
              <input
                id="course-search-time"
                value={timeFilter}
                onChange={(event) => onTimeFilterChange(event.target.value)}
                placeholder="例 F1,F2,F3"
                className={`${FIELD_CLASS} font-mono`}
              />
            </div>
            {/* 五格在兩欄版面會剩一個空格，最後一格補滿 */}
            <div className="col-span-2 bg-sheet px-4 py-2.5 md:col-span-1">
              <label className={LABEL_CLASS} htmlFor="course-search-capacity">名額狀態</label>
              <select
                id="course-search-capacity"
                value={capacityFilter}
                onChange={(event) => onCapacityFilterChange(event.target.value as CapacityFilter)}
                className={FIELD_CLASS}
              >
                <option value="all">全部顯示</option>
                <option value="available">尚有名額</option>
                <option value="full">額滿</option>
                <option value="unknown">未公告</option>
              </select>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-rule px-4 py-2 text-[13px] text-ink-2">
            <span className="font-mono text-xs tabular-nums text-ink-3">
              {manualSearchSummary ? `查「${manualSearchSummary.query}」・${resultSummary}` : '尚未查詢'}
            </span>
            <button
              type="button"
              onClick={onResetFilters}
              className="ml-auto text-[13px] text-ink-2 underline decoration-rule underline-offset-4 hover:text-ink hover:decoration-ink"
            >
              清除全部條件
            </button>
          </div>

          {manualError && (
            <div className="m-4 rounded-xl bg-mark-soft px-3.5 py-3">
              <b className="block text-sm font-semibold">查詢失敗</b>
              <p className="mt-1 font-mono text-xs leading-relaxed text-mark [overflow-wrap:anywhere]">{manualError}</p>
            </div>
          )}
          {manualStatus === 'loading' && (
            <div className="px-4 py-6">
              <div className="flex flex-col gap-2">
                <i className="block h-2 w-3/5 rounded-[1px] bg-band" />
                <i className="block h-2 w-5/6 rounded-[1px] bg-band" />
                <i className="block h-2 w-2/5 rounded-[1px] bg-band" />
              </div>
              <p className="mt-3 font-mono text-xs text-ink-3">向學校課程查詢系統取資料中…</p>
            </div>
          )}
          {manualStatus === 'idle' && !manualSearchSummary && (
            <Blank title="先查一次" body="在上方輸入課名或課碼，查官方開課資料。查到的課可以加入未來規劃、送官方選課，或額滿時交給名額監聽。" />
          )}
          {manualStatus === 'idle' && manualSearchSummary && manualResults.length === 0 && (
            <Blank title={`查無「${manualSearchSummary.query}」`} body="請改用課碼、放寬完整課名比對，或切換查詢學期。" />
          )}
          {manualStatus === 'idle' && manualResults.length > 0 && filteredManualResults.length === 0 && (
            <Blank title="篩選後沒有結果" body="請放寬教師、學分、節次或名額條件。" />
          )}

          {filteredManualResults.length > 0 && (
            <>
              <ul>
                {filteredManualResults.map((offering) => (
                  <CourseResultRow
                    key={`${offering.course_no}-${offering.node}-${offering.teacher}`}
                    offering={offering}
                    conflicts={findOfferingConflicts(offering, data)}
                    alreadyVirtual={Boolean(findScheduledCourseByOffering(offering, data, activeSemesterId))}
                    alreadyEnrolled={isEnrolledOffering(offering, data)}
                    occupiedSlots={occupiedSlots}
                    recognitionRequirements={recognitionRequirements}
                    requirementSetNames={requirementSetNames}
                    officialActionCourseNo={officialActionCourseNo}
                    onAddSelectionCourse={() => onAddSelectionCourse(offering)}
                    onAddPlannedCourse={(requirementId) => onAddPlannedCourse(offering, requirementId)}
                    onAddMonitorCourse={() => onAddMonitorCourse(offering)}
                    monitorActionCourseNo={monitorActionCourseNo}
                    identity={identity}
                    phaseKind={phaseKind}
                  />
                ))}
              </ul>
              <div className="flex flex-wrap gap-x-4 gap-y-2 border-t border-rule px-4 py-2.5 font-mono text-[11px] text-ink-3">
                <Key className="bg-ink-3 opacity-40" label="你已排的時段" />
                <Key className="bg-cat-major" label="這門課" />
                <Key className="bg-mark" label="撞在一起" />
                <span>GPA＝這位老師這門課最近一次的成績平均（學期・人數），由 myNTUST 提供；「無本師資料」＝課號有成績但是別的老師的，點 GPA 看歷年每一班。資格標籤依「設定」的主修／雙主修／輔系判斷，滑鼠停在上面看原始備註與理由</span>
                <span className="ml-auto">格子＝週一至週五 × 第 1–10 節</span>
              </div>
            </>
          )}
        </section>

        <aside className="flex flex-col gap-4">
          <PendingCoursePanel
            activeGroup={activePendingGroup}
            courseName={pendingCourseName}
            courses={pendingCourses}
            onAdd={addPendingCourse}
            onCourseNameChange={setPendingCourseName}
            onDelete={onDeletePendingCourse}
            onGroupChange={setActivePendingGroup}
            onSearch={onSearchPendingCourse}
          />

          <section>
            <h2 className="mb-2 font-mono text-xs tracking-[.14em] text-ink-3">名額怎麼算</h2>
            <ul className="flex flex-col gap-px">
              <Note title="分母看選課階段" sub="加退選＝Restrict2" body="初選看 Restrict1；某一欄是 9999 代表該階段不設限，會退回看另一欄。" />
              <Note title="分子只算本校生" sub="ChooseStudent" body="台大／師大系統學生有自己的名額，不併進來算。" />
              <Note title="可能超過上限" sub="授權加簽" body="人數已超過上限的課，剩餘名額會是負的。" />
            </ul>
          </section>

          <CourseDepartmentReference />
        </aside>
      </div>

      {/* 未來規劃托盤：本地規劃與待加簽追蹤，會自動儲存 */}
      <details className="overflow-hidden rounded-2xl bg-sheet shadow-card" open={virtualCourses.length > 0}>
        <summary className="flex cursor-pointer flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-3 text-sm">
          <b className="text-[15px] font-bold">未來規劃</b>
          <span className="font-mono text-[11px] tabular-nums tracking-wide text-ink-3">
            {virtualCourses.length} 門・{formatCredits(virtualCourseCredits)} 學分
          </span>
          <span className="text-[13px] text-ink-2">本地規劃與待加簽追蹤課程，會自動儲存。</span>
          <button
            type="button"
            onClick={(event) => {
              event.preventDefault();
              onOpenPlanning();
            }}
            className="ml-auto rounded-sm border border-rule px-3 py-1 text-[13px] text-ink-2 hover:border-accent hover:text-accent"
          >
            前往選課工作台
          </button>
        </summary>
        <div className="border-t border-rule">
          {virtualCourses.length === 0 ? (
            <p className="m-4 rounded-sm border border-dashed border-rule px-4 py-6 text-center text-[13px] text-ink-2">
              從課程查詢加入的本地規劃或待加簽課程會出現在這裡。
            </p>
          ) : (
            <ul className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
              {virtualCourses.map((course, index) => (
                <VirtualCourseCard
                  key={course.id}
                  course={course}
                  rank={index + 1}
                  onDelete={() => onDeleteVirtualCourse(course.id)}
                />
              ))}
            </ul>
          )}
        </div>
      </details>
    </div>
  );
}

function Check({
  checked,
  disabled,
  label,
  onChange,
  title,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: (checked: boolean) => void;
  title?: string;
}) {
  return (
    <label
      title={title}
      className={`flex items-center gap-1.5 text-[13px] ${
        disabled ? 'cursor-not-allowed text-ink-3' : checked ? 'text-ink' : 'text-ink-2'
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="h-3 w-3 rounded-[2px] border-rule accent-ink"
      />
      {label}
    </label>
  );
}

function Key({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <b className={`inline-block h-[7px] w-[7px] rounded-[1px] ${className}`} />
      {label}
    </span>
  );
}

function Note({ title, sub, body }: { title: string; sub: string; body: string }) {
  return (
    <li className="rounded-2xl bg-sheet shadow-card px-3.5 py-2.5">
      <b className="block text-sm font-medium">{title}</b>
      <span className="font-mono text-[11px] tracking-wide text-ink-2">{sub}</span>
      <em className="mt-1 block text-xs not-italic text-ink-3">{body}</em>
    </li>
  );
}

function Blank({ title, body }: { title: string; body: string }) {
  return (
    <div className="px-4 py-10 text-center">
      <b className="block text-[15px] font-medium">{title}</b>
      <p className="mx-auto mt-1.5 max-w-md text-[13px] leading-relaxed text-ink-2">{body}</p>
    </div>
  );
}

function CourseDepartmentReference() {
  return (
    <details className="rounded-2xl bg-sheet shadow-card">
      <summary className="cursor-pointer px-3.5 py-2.5 text-sm font-medium">
        開課系所代碼對照
        <span className="ml-2 font-mono text-[11px] text-ink-3">課碼前兩碼</span>
      </summary>
      <ul className="max-h-72 overflow-y-auto border-t border-rule">
        {COURSE_DEPARTMENT_LIST.map((department) => (
          <li key={department.code} className="grid grid-cols-[42px_minmax(0,1fr)] gap-2 border-t border-rule px-3.5 py-1.5 first:border-t-0">
            <span className="font-mono text-xs font-medium text-ink">{department.code}</span>
            <span className="text-xs text-ink-2">{department.name}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

function PendingCoursePanel({
  activeGroup,
  courseName,
  courses,
  onAdd,
  onCourseNameChange,
  onDelete,
  onGroupChange,
  onSearch,
}: {
  activeGroup: PendingCourseGroup;
  courseName: string;
  courses: PendingRequirement[];
  onAdd: () => void;
  onCourseNameChange: (courseName: string) => void;
  onDelete: (requirementId: string) => void;
  onGroupChange: (group: PendingCourseGroup) => void;
  onSearch: (courseName: string) => void;
}) {
  return (
    <section>
      <h2 className="mb-2 font-mono text-xs tracking-[.14em] text-ink-3">待修清單</h2>
      <div className="rounded-2xl bg-sheet shadow-card">
        <div className="flex items-center gap-3 border-b border-rule px-3.5 py-2.5">
          <div className="inline-flex overflow-hidden rounded-sm border border-rule">
            {PENDING_COURSE_GROUPS.map((group) => (
              <button
                key={group.value}
                type="button"
                onClick={() => onGroupChange(group.value)}
                aria-pressed={activeGroup === group.value}
                className={`px-3 py-1 text-[13px] ${
                  activeGroup === group.value ? 'bg-accent text-sheet' : 'text-ink-2 hover:text-ink'
                }`}
              >
                {group.label}
              </button>
            ))}
          </div>
          <span className="ml-auto font-mono text-[11px] tabular-nums text-ink-3">{courses.length} 筆</span>
        </div>
        <div className="flex gap-2 border-b border-rule px-3.5 py-2.5">
          <input
            value={courseName}
            onChange={(event) => onCourseNameChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') onAdd();
            }}
            placeholder="輸入待修課名，例如 資料結構"
            aria-label="待修課名"
            className={`${FIELD_CLASS} mt-0`}
          />
          <button
            type="button"
            onClick={onAdd}
            disabled={!courseName.trim()}
            className="shrink-0 rounded-sm bg-accent px-3 py-1 text-[13px] font-medium text-sheet disabled:cursor-not-allowed disabled:opacity-45"
          >
            新增
          </button>
        </div>
        {courses.length === 0 ? (
          <p className="px-3.5 py-4 text-center text-[13px] text-ink-2">目前沒有待修課程。</p>
        ) : (
          <ul>
            {courses.map((course) => (
              <li key={course.id} className="flex min-w-0 items-center gap-2 border-t border-rule px-3.5 py-2 first:border-t-0">
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{course.title}</span>
                <button
                  type="button"
                  onClick={() => onSearch(course.title)}
                  className="inline-flex shrink-0 items-center gap-1 rounded-sm border border-rule px-2 py-0.5 text-xs text-ink-2 hover:border-accent hover:text-accent"
                >
                  <Search className="h-3 w-3" />
                  查課
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(course.id)}
                  className="inline-flex shrink-0 items-center rounded-sm border border-rule px-1.5 py-0.5 text-xs text-ink-3 hover:border-accent hover:text-accent"
                  title="刪除待修課程"
                  aria-label={`刪除待修課程 ${course.title}`}
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

/** 5 天 × 10 節的小格子：灰＝你已排、墨＝這門課、朱＝撞在一起。 */
function Fingerprint({ slots, occupiedSlots }: { slots: string[]; occupiedSlots: Set<string> }) {
  const own = new Set(slots);
  return (
    <span className="grid grid-cols-[repeat(5,3px)] content-start gap-px" aria-hidden="true">
      {FINGERPRINT_PERIODS.map((period) =>
        FINGERPRINT_DAYS.map((day) => {
          const id = `${day}${period}`;
          const mine = own.has(id);
          const taken = occupiedSlots.has(id);
          const className = mine && taken
            ? 'bg-mark'
            : mine
              ? 'bg-cat-major'
              : taken
                ? 'bg-ink-3 opacity-40'
                : 'bg-rule';
          return <i key={id} className={`block h-[3px] rounded-[.5px] ${className}`} />;
        }),
      )}
    </span>
  );
}

// 可直選＝綠、需加簽＝通識那種土黃、資格不符＝朱批紅；都用細框不用整片底色。
const ELIGIBILITY_CLASS: Record<Exclude<EligibilityLevel, 'unknown'>, string> = {
  open: 'border-good text-good',
  signature: 'border-cat-gened text-cat-gened',
  blocked: 'border-mark text-mark',
};

function CourseResultRow({
  offering,
  conflicts,
  alreadyVirtual,
  alreadyEnrolled,
  occupiedSlots,
  recognitionRequirements,
  requirementSetNames,
  officialActionCourseNo,
  onAddSelectionCourse,
  onAddPlannedCourse,
  onAddMonitorCourse,
  monitorActionCourseNo,
  identity,
  phaseKind,
}: {
  offering: CourseSearchResult;
  conflicts: Course[];
  alreadyVirtual: boolean;
  /** 本學期已選上的課：不算衝堂，但也不該再規劃或送選課。 */
  alreadyEnrolled: boolean;
  occupiedSlots: Set<string>;
  recognitionRequirements: PendingRequirement[];
  /** 需求集 id → 名稱，下拉顯示用。 */
  requirementSetNames: Map<string, string>;
  officialActionCourseNo: string | null;
  onAddSelectionCourse: () => void;
  onAddPlannedCourse: (requirementId?: string) => void;
  onAddMonitorCourse: () => void;
  monitorActionCourseNo: string | null;
  identity: StudentIdentity;
  phaseKind: ReturnType<typeof currentEnrollmentPhase>['kind'];
}) {
  const [selectedRequirementId, setSelectedRequirementId] = useState('');
  const [showGpaHistory, setShowGpaHistory] = useState(false);
  const restrictionTags = useMemo(() => parseCourseRestrictions(offering.contents), [offering.contents]);
  const eligibility = useMemo(
    () => evaluateEligibility(offering.course_no, offering.contents, identity, phaseKind),
    [offering.course_no, offering.contents, identity, phaseKind],
  );
  const slots = parseNodeSlots(offering.node);
  const status = capacityStatus(offering);
  const isOfficialActionLoading = officialActionCourseNo === offering.course_no.trim().toUpperCase();
  const isMonitorActionLoading = monitorActionCourseNo === offering.course_no.trim().toUpperCase();
  const department = parseCourseDepartment(offering.course_no);
  const gpaLabel = gpaValueLabel(offering.gpa, offering.gpa_status);
  const gpaParts = gpaDetailParts(offering, offering.course_no);
  const gpaMuted = offering.gpa_status === 'other_teacher' || offering.gpa_status === 'no_data';
  // 只有已啟用密鑰的人開得了歷史；未啟用時列上寫「未啟用」，點了也只會看到同一句話。
  const canOpenGpaHistory = Boolean(offering.gpa_status) && offering.gpa_status !== 'not_enabled';
  const remaining = offering.capacity != null && offering.selected_count != null
    ? offering.capacity - offering.selected_count
    : null;
  const seatNote = status === 'unknown'
    ? '名額未公告'
    : status === 'full'
      ? remaining !== null && remaining < 0 ? `超收 ${-remaining} 位` : '額滿'
      : `還有 ${remaining} 位`;
  const conflictText = conflicts.length > 0 ? `和 ${conflicts.map((course) => course.name).join('、')} 衝堂` : '';

  const meta = [
    offering.course_no || '未列課碼',
    department?.name,
    offering.teacher || '未列教師',
    displayClassroom(offering.classroom),
    displaySlots(slots),
    `${formatCredits(offering.credits)} 學分`,
  ].filter(Boolean).join('・');

  return (
    <li
      className={`grid grid-cols-[22px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 border-t border-rule px-4 py-3 first:border-t-0 md:grid-cols-[22px_minmax(0,1fr)_84px_96px_auto] md:gap-x-3.5 ${
        conflicts.length > 0 ? 'bg-mark/5' : ''
      }`}
      data-state={alreadyEnrolled ? 'in' : conflicts.length > 0 ? 'clash' : status}
    >
      <Fingerprint slots={slots} occupiedSlots={occupiedSlots} />

      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <b className={`text-[15px] font-medium leading-snug ${alreadyVirtual || alreadyEnrolled ? 'text-ink-3' : ''}`}>{offering.course_name}</b>
          <span className="rounded-[2px] border border-rule px-1.5 font-mono text-[10px] text-ink-2">
            {requirementLabel(offering.require_option)}
          </span>
          {alreadyEnrolled && <span className="font-mono text-[10px] text-good">已在課表・已選上</span>}
          {alreadyVirtual && !alreadyEnrolled && <span className="font-mono text-[10px] text-ink-3">已列入規劃</span>}
          {conflicts.length > 0 && <span className="font-mono text-[10px] text-mark">衝堂</span>}
        </div>
        <span className="block font-mono text-[11px] tracking-wide text-ink-2">{meta}</span>
        {conflictText && <span className="mt-0.5 block text-xs leading-relaxed text-mark">{conflictText}</span>}
        {(offering.contents || eligibility.level !== 'unknown') && (
          <span className="mt-1 flex flex-wrap items-center gap-1" title={[offering.contents, ...eligibility.reasons].filter(Boolean).join('\n')}>
            {eligibility.level !== 'unknown' && (
              <span className={`rounded-[2px] border px-1.5 font-mono text-[10px] ${ELIGIBILITY_CLASS[eligibility.level]}`}>
                {eligibility.label}
              </span>
            )}
            {restrictionTags.map((tag) => (
              <span
                key={`${tag.kind}:${tag.label}`}
                className={`rounded-[2px] px-1.5 font-mono text-[10px] ${tag.kind === 'eligibility' || tag.kind === 'method' ? 'bg-paper text-ink-2' : 'text-ink-3'}`}
              >
                {tag.label}
              </span>
            ))}
          </span>
        )}
      </div>

      <button
        type="button"
        disabled={!canOpenGpaHistory}
        onClick={() => setShowGpaHistory(true)}
        title={canOpenGpaHistory ? '看這門課歷年每一班的 GPA' : undefined}
        className={`col-start-2 whitespace-nowrap rounded-sm font-mono text-[11px] tabular-nums md:col-start-auto md:text-right md:text-sm ${gpaMuted ? 'text-ink-3' : 'text-ink-2'} ${canOpenGpaHistory ? 'cursor-pointer hover:text-ink hover:underline decoration-rule underline-offset-4' : 'cursor-default'}`}
      >
        {gpaLabel}
        <em className="ml-1 text-[10px] not-italic text-ink-3 md:ml-0 md:block">{gpaParts[0] ? `GPA・${gpaParts[0]}` : 'GPA'}</em>
        {gpaParts.slice(1).map((part) => (
          <em key={part} className="ml-1 text-[10px] not-italic text-ink-3 md:ml-0 md:block">{part}</em>
        ))}
      </button>
      {showGpaHistory && (
        <GpaHistoryModal
          courseName={offering.course_name}
          highlightCourseNo={offering.course_no}
          highlightTeacher={offering.teacher}
          onClose={() => setShowGpaHistory(false)}
        />
      )}

      <span className={`col-start-2 font-mono text-[13px] font-medium tabular-nums md:col-start-auto md:text-right md:text-[15px] ${
        status === 'full' ? 'text-mark' : status === 'unknown' ? 'text-ink-3' : ''
      }`}>
        {capacityLabel(offering).replace(/\s/g, '')}
        <em className="ml-1 text-[11px] font-normal not-italic text-ink-3 md:ml-0 md:block md:whitespace-nowrap">{seatNote}</em>
      </span>

      {/* 三個動作一列；認列下拉只在真的有雙主修／輔系規則時才出現 */}
      <div className="col-span-3 flex flex-col items-stretch gap-1.5 md:col-span-1 md:items-end">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onAddPlannedCourse(selectedRequirementId || undefined)}
            disabled={!offering.course_no || alreadyEnrolled}
            title={alreadyEnrolled ? '這門課已經選上，不需要再規劃' : alreadyVirtual ? '更新未來規劃' : '加入未來規劃'}
            className="rounded-sm border border-accent bg-accent px-3 py-1 text-[13px] text-sheet disabled:cursor-not-allowed disabled:opacity-45"
          >
            {alreadyVirtual ? '更新規劃' : '規劃'}
          </button>
          <button
            type="button"
            onClick={onAddSelectionCourse}
            disabled={!offering.course_no || isOfficialActionLoading || alreadyEnrolled}
            title={alreadyEnrolled ? '這門課已經選上' : alreadyVirtual ? '重新送出到官方選課清單' : '加入官方選課清單'}
            className="inline-flex items-center gap-1 rounded-sm border border-rule bg-sheet px-3 py-1 text-[13px] text-ink-2 hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-45"
          >
            {isOfficialActionLoading && <Loader2 className="h-3 w-3 animate-spin" />}
            {isOfficialActionLoading ? '處理中' : alreadyEnrolled ? '已選上' : alreadyVirtual ? '重送' : '選課'}
          </button>
          <button
            type="button"
            onClick={onAddMonitorCourse}
            disabled={!offering.course_no || isMonitorActionLoading}
            title="加入選課監控：名額出現時通知"
            className={`inline-flex items-center gap-1 rounded-sm border px-3 py-1 text-[13px] disabled:cursor-not-allowed disabled:opacity-45 ${
              status === 'full' ? 'border-mark text-mark' : 'border-rule text-ink-2 hover:border-accent hover:text-accent'
            }`}
          >
            {isMonitorActionLoading && <Loader2 className="h-3 w-3 animate-spin" />}
            {isMonitorActionLoading ? '處理中' : '監聽'}
          </button>
        </div>
        {recognitionRequirements.length > 0 && (
          <select
            value={selectedRequirementId}
            onChange={(event) => setSelectedRequirementId(event.target.value)}
            className="max-w-[200px] border-0 border-b border-rule bg-transparent px-0 py-0.5 text-xs text-ink-2 outline-none focus:border-ink"
            title="「規劃」要認列到哪一條需求"
            aria-label="規劃要認列到哪一條需求"
          >
            <option value="">不指定認列</option>
            {recognitionRequirements.map((requirement) => (
              <option key={requirement.id} value={requirement.id}>
                {requirementSetNames.get(requirement.setId) || '其他'}・{requirement.title}
              </option>
            ))}
          </select>
        )}
      </div>
    </li>
  );
}

function VirtualCourseCard({
  course,
  rank,
  onDelete,
}: {
  course: Course;
  rank: number;
  onDelete: () => void;
}) {
  const slots = course.scheduledOffering?.slots || [];
  const isRejected = course.virtualSelection?.status === 'rejected';
  return (
    <li className={`flex items-start gap-3 border-b border-r border-rule bg-sheet px-4 py-3 ${isRejected ? 'border-l-[3px] border-l-mark' : 'border-l-[3px] border-l-ink-3'}`}>
      <span className="mt-0.5 font-mono text-[11px] tabular-nums text-ink-3">{String(rank).padStart(2, '0')}</span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <b className="truncate text-sm font-medium">{course.name}</b>
          <span className={`font-mono text-[10px] ${isRejected ? 'text-mark' : 'text-ink-3'}`}>
            {isRejected ? '待加簽' : '未來規劃'}
          </span>
        </div>
        <span className="block font-mono text-[11px] tracking-wide text-ink-2">
          {[
            `${formatCredits(course.credits)} 學分`,
            course.scheduledOffering?.teacher,
            slots.length > 0 ? `${displaySlots(slots)}・${displayClassroom(course.scheduledOffering?.classroom)}` : '未提供節次',
          ].filter(Boolean).join('・')}
        </span>
        <em className="mt-1 line-clamp-2 text-xs not-italic text-ink-3">
          {course.virtualSelection?.reason || '本地未來規劃。'}
        </em>
      </div>
      <button
        type="button"
        onClick={onDelete}
        className="shrink-0 rounded-sm border border-rule px-2 py-0.5 text-xs text-ink-3 hover:border-accent hover:text-accent"
      >
        移除
      </button>
    </li>
  );
}
