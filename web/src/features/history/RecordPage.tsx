import { Info } from 'lucide-react';
import type { AppData, Course, CourseCategory, CourseProgram } from '../../shared/types';
import { CATEGORY_LABELS, PROGRAM_LABELS } from '../../shared/constants';
import {
  displayClassroom,
  displaySlots,
  formatCredits,
  isFailedImportedHistoryCourse,
  isHistoryImportedCourse,
} from '../../shared/domain/planner';

type RecordPageProps = {
  data: AppData;
  onOpenCourseDetail: (semesterId: string, semesterName: string, course: Course) => void;
};

/**
 * 修課紀錄：八個學期的課，含歷史匯入、修課中與未來規劃。
 *
 * 從「修課軌跡 / 畢業進度」拆出來的那一半；門檻與認列規則在 `ThresholdsPage`。
 */
export function RecordPage({ data, onOpenCourseDetail }: RecordPageProps) {
  // 原本只留歷史匯入的課，於是「正在修」的整批看不到——那正是使用者現在最想看的一群。
  const timelineSemesters = data.semesters.map((semester) => ({
    ...semester,
    courses: semester.courses,
    plannedSourceLabel: '',
  }));
  const plannedCourses = data.selectionPlan?.courses || [];
  const plannedSemesterName = plannedSemesterNameFromLabel(data.selectionPlan?.targetLabel);
  const plannedTargetIndex = plannedCourses.length > 0 && plannedSemesterName
    ? timelineSemesters.findIndex((semester) => semester.name === plannedSemesterName)
    : -1;
  const displaySemesters = plannedCourses.length === 0
    ? timelineSemesters
    : plannedTargetIndex >= 0
      ? timelineSemesters.map((semester, index) => (
          index === plannedTargetIndex
            ? {
                ...semester,
                courses: [...semester.courses, ...plannedCourses],
                plannedSourceLabel: data.selectionPlan?.targetLabel || '未來規劃',
              }
            : semester
        ))
      : [
          ...timelineSemesters,
          {
            id: '__selection_plan__',
            name: data.selectionPlan?.targetLabel || '未來規劃',
            courses: plannedCourses,
            plannedSourceLabel: data.selectionPlan?.targetLabel || '未來規劃',
          },
        ];
  const historyCount = timelineSemesters.reduce((sum, semester) => (
    sum + semester.courses.filter(isHistoryImportedCourse).length
  ), 0);
  const inProgressCount = timelineSemesters.reduce((sum, semester) => (
    sum + semester.courses.filter((course) => !isHistoryImportedCourse(course)).length
  ), 0);
  const plannedCount = plannedCourses.length;
  const totalCourses = historyCount + inProgressCount + plannedCount;
  const requirementById = new Map(data.pendingRequirements.map((requirement) => [requirement.id, requirement]));
  const failedCount = timelineSemesters.reduce((sum, semester) => (
    sum + semester.courses.filter(isFailedImportedHistoryCourse).length
  ), 0);

  return (
    <div className="space-y-5">
      <section className="grid gap-x-8 gap-y-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
        <div>
          <p className="font-mono text-[11px] tracking-[.14em] text-ink-2">修課紀錄</p>
          <h1 className="mt-0.5 text-[19px] font-bold">歷年、修課中與未來規劃</h1>
          <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-ink-2">
            已修、修課中、未通過與從課程查詢加入的未來規劃都在這裡；未來規劃只代表草稿或待加簽，不代表已選上。
            畢業門檻與雙主修／輔系認列規則在「畢業門檻」頁。
          </p>
        </div>
        <dl className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
          <Stat label="總課程" value={totalCourses} />
          <Stat label="歷史匯入" value={historyCount} />
          <Stat label="修課中" value={inProgressCount} />
          <Stat label="未來規劃" value={plannedCount} />
          <Stat label="未通過" value={failedCount} tone={failedCount > 0 ? 'mark' : 'good'} />
        </dl>
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {displaySemesters.map((semester) => {
          const semesterCredits = semester.courses.reduce((sum, course) => (
            sum + (course.category === 'pe' ? 0 : course.credits)
          ), 0);
          const semesterFailed = semester.courses.filter(isFailedImportedHistoryCourse).length;
          return (
            <section key={semester.id} className="overflow-hidden rounded-lg border border-rule bg-sheet">
              <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-rule px-4 py-3">
                <h2 className="text-[15px] font-bold">{semester.name}</h2>
                <p className="font-mono text-[11px] tracking-wide tabular-nums text-ink-2">
                  {semester.courses.length} 門課・{formatCredits(semesterCredits)} 學分
                </p>
                {(semester.plannedSourceLabel || semesterFailed > 0) && (
                  <p className="basis-full font-mono text-[11px] tracking-wide">
                    {semesterFailed > 0 && <span className="tabular-nums text-mark">{semesterFailed} 門未通過</span>}
                    {semesterFailed > 0 && semester.plannedSourceLabel && <span className="text-ink-2">{'　'}</span>}
                    {semester.plannedSourceLabel && (
                      <span className="text-ink-2">含 {semester.plannedSourceLabel} 的未來規劃</span>
                    )}
                  </p>
                )}
              </header>
              {semester.courses.length === 0 ? (
                <p className="m-4 rounded-sm border border-dashed border-rule px-4 py-6 text-center text-[13px] text-ink-2">
                  尚未有修課或未來規劃資料。
                </p>
              ) : (
                <ul className="flex flex-col">
                  {semester.courses.map((course) => (
                    <li key={course.id} className="border-t border-rule first:border-t-0">
                      <TimelineCourseCard
                        course={course}
                        recognitionLabel={course.sourceRequirementId ? requirementById.get(course.sourceRequirementId)?.title : undefined}
                        onOpen={() => onOpenCourseDetail(semester.id, semester.name, course)}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </section>
    </div>
  );
}

function plannedSemesterNameFromLabel(label: string | undefined): string | null {
  const matched = label?.match(/推定([^·\s]+)/);
  return matched?.[1] || null;
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'mark' | 'good' }) {
  return (
    <div>
      <dt className="font-mono text-[11px] tracking-wide text-ink-2">{label}</dt>
      <dd className={`font-mono text-[21px] font-semibold tabular-nums ${
        tone === 'mark' ? 'text-mark' : tone === 'good' ? 'text-good' : 'text-ink'
      }`}>
        {value}
        <span className="ml-0.5 text-[11px] font-normal text-ink-2">門</span>
      </dd>
    </div>
  );
}

/** 課卡左緣的墨色跟著畫面上顯示的類別走，同一列的字與顏色才不會各說各話。 */
const CATEGORY_INK: Record<CourseCategory, string> = {
  compulsory: 'var(--color-cat-major)',
  elective: 'var(--color-cat-elective)',
  chinese: 'var(--color-cat-gened)',
  english: 'var(--color-cat-gened)',
  gen_ed: 'var(--color-cat-gened)',
  pe: 'var(--color-cat-pe)',
  social: 'var(--color-cat-pe)',
  other: 'var(--color-cat-elective)',
  unclassified: 'var(--color-cat-elective)',
};

const PROGRAM_INK: Partial<Record<CourseProgram, string>> = {
  double_major: 'var(--color-cat-double)',
  minor: 'var(--color-cat-minor)',
};

function TimelineCourseCard({
  course,
  recognitionLabel,
  onOpen,
}: {
  course: Course;
  recognitionLabel?: string;
  onOpen: () => void;
}) {
  const isHistory = isHistoryImportedCourse(course);
  const isFailed = isFailedImportedHistoryCourse(course);
  const isRejected = course.virtualSelection?.status === 'rejected';
  // 校務同步寫入、還沒有成績的課＝正在修；未來規劃是本地加的，帶 virtualSelection
  const isInProgress = !isHistory && !course.virtualSelection;
  const slots = course.scheduledOffering?.slots || [];
  const teacher = course.scheduledOffering?.teacher || course.details?.professor || '未列教師';
  const location = displayClassroom(course.scheduledOffering?.classroom || course.details?.location);
  const ink = isFailed
    ? 'var(--color-mark)'
    : (course.program && PROGRAM_INK[course.program]) || CATEGORY_INK[course.category];
  const status = isFailed
    ? { label: '未通過', className: 'text-mark' }
    : isHistory
      ? { label: '歷史修課', className: 'text-ink-3' }
      : isInProgress
        ? { label: '修課中', className: 'text-good' }
        : isRejected
          ? { label: '待加簽', className: 'text-mark' }
          : { label: '未來規劃', className: 'text-ink-2' };

  return (
    <button
      type="button"
      onClick={onOpen}
      style={{ borderLeftColor: ink }}
      className={`flex w-full items-start gap-3 border-l-[3px] px-4 py-2.5 text-left transition-colors hover:bg-paper focus-visible:[outline-offset:-3px] ${
        isFailed ? 'bg-mark/[.06]' : ''
      }`}
    >
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline gap-x-2">
          <b className="truncate text-sm font-medium">{course.name}</b>
          {/* 認列歸屬得自己換行，塞進下面那條 truncate 的話長名稱會被切掉 */}
          {course.program && course.program !== 'home' && (
            <span className="rounded-sm bg-band px-1.5 py-0.5 font-mono text-[10px] text-ink-2">
              {recognitionLabel
                ? `${PROGRAM_LABELS[course.program]}・${recognitionLabel}`
                : PROGRAM_LABELS[course.program]}
            </span>
          )}
        </span>
        <span className="mt-0.5 block font-mono text-[11px] tracking-wide tabular-nums text-ink-2">
          {CATEGORY_LABELS[course.category]}
          {'・'}
          {formatCredits(course.credits)} 學分
          {course.grade ? `・成績 ${course.grade}` : ''}
          {teacher ? `・${teacher}` : ''}
        </span>
        <span className="block truncate font-mono text-[11px] text-ink-2">
          {slots.length > 0 ? `${displaySlots(slots)}・${location}` : location}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-1.5">
        <span className={`font-mono text-[11px] tracking-wide ${status.className}`}>{status.label}</span>
        <Info className="h-3.5 w-3.5 text-ink-3" aria-hidden />
      </span>
    </button>
  );
}
