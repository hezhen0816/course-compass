import { Info } from 'lucide-react';
import type { AppData, Course } from '../../types';
import { CATEGORY_LABELS, PROGRAM_LABELS } from '../../shared/constants';
import {
  displayClassroom,
  displaySlots,
  formatCredits,
  isFailedImportedHistoryCourse,
  isHistoryImportedCourse,
} from '../../domain/planner';

type CourseTimelinePageProps = {
  data: AppData;
  onOpenCourseDetail: (semesterId: string, semesterName: string, course: Course) => void;
};

export function CourseTimelinePage({ data, onOpenCourseDetail }: CourseTimelinePageProps) {
  const timelineSemesters = data.semesters.map((semester) => ({
    ...semester,
    courses: semester.courses.filter(isHistoryImportedCourse),
  }));
  const totalCourses = timelineSemesters.reduce((sum, semester) => sum + semester.courses.length, 0);
  const historyCount = totalCourses;
  const failedCount = timelineSemesters.reduce((sum, semester) => (
    sum + semester.courses.filter(isFailedImportedHistoryCourse).length
  ), 0);

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-blue-600">修課軌跡</p>
        <h1 className="mt-1 text-2xl font-semibold text-slate-950">歷史修課與未來規劃</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-500">
          這裡集中查看已修、未通過與同步匯入的課程；選課工作台的本地草稿不會出現在這裡。
        </p>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <SummaryBox label="總課程" value={`${totalCourses} 門`} tone="slate" />
          <SummaryBox label="歷史匯入" value={`${historyCount} 門`} tone="blue" />
          <SummaryBox label="未通過" value={`${failedCount} 門`} tone={failedCount > 0 ? 'red' : 'emerald'} />
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {timelineSemesters.map((semester) => {
          const semesterCredits = semester.courses.reduce((sum, course) => (
            sum + (course.category === 'pe' ? 0 : course.credits)
          ), 0);
          return (
            <div key={semester.id} className="rounded-lg border border-slate-200 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
                <div>
                  <h2 className="text-base font-semibold text-slate-900">{semester.name}</h2>
                  <p className="mt-1 text-xs text-slate-500">
                    {semester.courses.length} 門課 · {formatCredits(semesterCredits)} 學分
                  </p>
                </div>
              </div>
              <div className="space-y-2 p-4">
                {semester.courses.length === 0 ? (
                  <div className="rounded-md border border-dashed border-slate-300 p-5 text-center text-sm text-slate-500">
                    尚未有修課或未來規劃資料。
                  </div>
                ) : (
                  semester.courses.map((course) => (
                    <TimelineCourseCard
                      key={course.id}
                      course={course}
                      onOpen={() => onOpenCourseDetail(semester.id, semester.name, course)}
                    />
                  ))
                )}
              </div>
            </div>
          );
        })}
      </section>
    </div>
  );
}

function SummaryBox({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'slate' | 'blue' | 'emerald' | 'red';
}) {
  const toneClass = {
    slate: 'border-slate-200 bg-slate-50 text-slate-700',
    blue: 'border-blue-200 bg-blue-50 text-blue-700',
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    red: 'border-red-200 bg-red-50 text-red-700',
  }[tone];

  return (
    <div className={`rounded-lg border px-4 py-3 ${toneClass}`}>
      <p className="text-xs font-medium opacity-80">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
    </div>
  );
}

function TimelineCourseCard({ course, onOpen }: { course: Course; onOpen: () => void }) {
  const isHistory = isHistoryImportedCourse(course);
  const isFailed = isFailedImportedHistoryCourse(course);
  const slots = course.scheduledOffering?.slots || [];
  const teacher = course.scheduledOffering?.teacher || course.details?.professor || '未列教師';
  const location = displayClassroom(course.scheduledOffering?.classroom || course.details?.location);
  const toneClass = isFailed
    ? 'border-red-200 bg-red-50 hover:bg-red-100'
    : isHistory
      ? 'border-emerald-200 bg-emerald-50 hover:bg-emerald-100'
      : 'border-blue-200 bg-blue-50 hover:bg-blue-100';

  return (
    <button
      type="button"
      onClick={onOpen}
      className={`w-full rounded-md border p-3 text-left transition-colors ${toneClass}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-sm font-semibold text-slate-900">{course.name}</h3>
            <span className="rounded-full bg-white/70 px-2 py-0.5 text-[11px] font-medium text-slate-600">
              {CATEGORY_LABELS[course.category]}
            </span>
            {course.program && course.program !== 'home' && (
              <span className="rounded-full bg-white/70 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                {PROGRAM_LABELS[course.program]}
              </span>
            )}
            {isHistory && (
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${isFailed ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}>
                {isFailed ? '未通過' : '歷史修課'}
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-slate-600">
            {formatCredits(course.credits)} 學分
            {course.grade ? `・成績 ${course.grade}` : ''}
            {teacher ? `・${teacher}` : ''}
          </p>
          <p className="mt-1 truncate text-xs text-slate-500">
            {slots.length > 0 ? `${displaySlots(slots)}・${location}` : location}
          </p>
        </div>
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
      </div>
    </button>
  );
}
