import { formatDateTime } from './format';
import { guessCurrentSemester } from '../../shared/domain/planner';
import React, { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import {
  SETTINGS_FIELD_CLASS,
  SETTINGS_LABEL_CLASS,
  SETTINGS_PRIMARY_BUTTON,
  SETTINGS_SECONDARY_BUTTON,
} from '../settings/SettingsPage';
import { supabase } from './supabaseClient';

interface Course {
  id: string;
  course_code: string;
  course_name: string;
  status: string;
  current_enrolled: string;
  last_check_time: string;
  semester: string;
}

interface SemesterOption {
  semester: string;
  english_label: string;
  current: boolean;
}

interface CourseSettingsModalProps {
  course: Course;
  semesterOptions: SemesterOption[];
  onClose: () => void;
  onSaved: () => void;
}

const CourseSettingsModal: React.FC<CourseSettingsModalProps> = ({ course, semesterOptions, onClose, onSaved }) => {
  const [paused, setPaused] = useState(course.status === 'paused');
  const [semester, setSemester] = useState(course.semester);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      const { error } = await supabase
        .from('monitored_courses')
        .update({
          // 改了學期就讓它重回輪詢：worker 會跳過 status='expired'，不重設的話改了也不會再被檢查
          status: paused
            ? 'paused'
            : (course.status === 'paused' || (course.status === 'expired' && semester !== course.semester)
                ? 'monitoring'
                : course.status),
          semester,
        })
        .eq('id', course.id);
      if (error) throw error;
      onSaved();
      onClose();
    } catch (e) {
      alert('儲存失敗：' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/35 p-4 animate-fadeIn">
      <div className="w-full max-w-sm overflow-hidden rounded-2xl bg-sheet shadow-card animate-zoomIn">
        <div className="flex items-start justify-between gap-3 border-b border-rule px-4 py-3">
          <div>
            <h3 className="text-[15px] font-bold">課程設定</h3>
            <p className="mt-0.5 font-mono text-[11px] text-ink-2">{course.course_code}・{course.course_name}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="關閉" className="rounded-sm border border-rule px-2 text-sm leading-6 text-ink-2 hover:border-accent hover:text-accent">×</button>
        </div>

        <div className="divide-y divide-rule">
          <div className="flex items-center justify-between gap-4 px-4 py-3">
            <div>
              <div className="text-sm font-medium">監控狀態</div>
              <div className="mt-0.5 text-xs text-ink-3">{paused ? '已暫停，Worker 不會檢查此課程' : '監控中'}</div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={!paused}
              onClick={() => setPaused(p => !p)}
              className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border border-rule transition-colors ${paused ? 'bg-band' : 'bg-accent'}`}
            >
              <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-sheet shadow-sm transition-transform ${paused ? 'translate-x-0' : 'translate-x-4'}`} />
            </button>
          </div>

          <div className="px-4 py-3">
            <label className={SETTINGS_LABEL_CLASS}>學期</label>
            <select value={semester} onChange={e => setSemester(e.target.value)} className={`${SETTINGS_FIELD_CLASS} font-mono`}>
              {mergeSemesterOptions(semesterOptions.length > 0 ? semesterOptions : FALLBACK_SEMESTER_OPTIONS, [course.semester]).map(option => (
                <option key={option.semester} value={option.semester}>
                  {formatSemesterLabel(option)}{option.current ? '（最新）' : ''}
                </option>
              ))}
            </select>
            <p className="mt-1.5 text-xs text-ink-3">Worker 會以此學期查詢人數；換學期後下次檢查即生效。</p>
          </div>

        </div>

        <div className="flex justify-end gap-2 border-t border-rule px-4 py-3">
          <button type="button" onClick={onClose} className={SETTINGS_SECONDARY_BUTTON}>取消</button>
          <button type="button" onClick={handleSave} disabled={saving} className={SETTINGS_PRIMARY_BUTTON}>
            {saving ? '儲存中…' : '儲存'}
          </button>
        </div>
      </div>
    </div>
  );
};

const NTUST_SEMESTERS_API = 'https://querycourse.ntust.edu.tw/QueryCourse/api/semestersinfo';
const isValidSemester = (semester: string) => /^[0-9]{4}$/.test(semester);
// 只在學校 API 打不通時使用；current 由日期推算，不寫死某一年
const FALLBACK_SEMESTER_OPTIONS: SemesterOption[] = (() => {
  const guessed = guessCurrentSemester();
  return [
    { semester: guessed, english_label: '', current: true },
    { semester: '1151', english_label: '2026 Fall', current: false },
    { semester: '1142', english_label: '2026 Spring', current: false },
    { semester: '1141', english_label: '2025 Fall', current: false },
  ].filter((option, index, list) => list.findIndex((item) => item.semester === option.semester) === index);
})();

const fetchSemesterOptions = async (): Promise<SemesterOption[]> => {
  try {
    const res = await fetch(NTUST_SEMESTERS_API, {
      headers: { Accept: 'application/json' },
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data)) {
        return data
          .map((item) => ({
            semester: String(item?.Semester || '').trim(),
            english_label: String(item?.EngSemester || '').trim(),
            current: Boolean(item?.CurrentSemester && item?.Static === false),
          }))
          .filter((item): item is SemesterOption => isValidSemester(item.semester));
      }
    }
  } catch {
    // Fall back below.
  }
  return FALLBACK_SEMESTER_OPTIONS;
};

const pickDefaultSemester = (options: SemesterOption[]): string => (
  options.find((item) => item.current)?.semester
  || options[0]?.semester
  || ''
);

const formatSemesterLabel = (option: SemesterOption): string => (
  option.english_label ? `${option.semester}・${option.english_label}` : option.semester
);

const mergeSemesterOptions = (base: SemesterOption[], extraSemesters: string[]): SemesterOption[] => {
  const merged = [...base];
  for (const semester of extraSemesters) {
    const value = String(semester || '').trim();
    if (!isValidSemester(value) || merged.some((item) => item.semester === value)) continue;
    merged.push({ semester: value, english_label: '', current: false });
  }
  return merged;
};

const CoursesView: React.FC<{ onGoToCourseSearch?: () => void }> = ({ onGoToCourseSearch }) => {
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [settingsCourse, setSettingsCourse] = useState<Course | null>(null);
  const [semesterOptions, setSemesterOptions] = useState<SemesterOption[]>([]);
  // 學校標為 current 的學期；判斷課程是否屬於已結束的學期
  const currentSemester = pickDefaultSemester(semesterOptions.length > 0 ? semesterOptions : FALLBACK_SEMESTER_OPTIONS);

  useEffect(() => {
    let channel: ReturnType<typeof supabase.channel> | null = null;

    const init = async () => {
      const options = await fetchSemesterOptions();
      setSemesterOptions(options);
      await fetchCourses();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      channel = supabase
        .channel('courses_changes')
        .on('postgres_changes', {
          event: '*',
          schema: 'public',
          table: 'monitored_courses',
          filter: `user_id=eq.${user.id}`
        }, () => {
          fetchCourses();
        })
        .subscribe();
    };

    init();

    return () => {
      if (channel) supabase.removeChannel(channel);
    };
  }, []);

  const fetchCourses = async (silent = false) => {
    try {
      const { data, error } = await supabase
        .from('monitored_courses')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      const nextCourses = data || [];
      setCourses(nextCourses);
      setSemesterOptions((prev) => mergeSemesterOptions(prev.length > 0 ? prev : FALLBACK_SEMESTER_OPTIONS, nextCourses.map((course) => course.semester)));
    } catch (error) {
      console.error('Error fetching courses:', error);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  const deleteCourse = async (id: string) => {
    if (!confirm('確定要刪除此監控任務嗎？')) return;
    try {
      const { error } = await supabase
        .from('monitored_courses')
        .delete()
        .eq('id', id);
      if (error) throw error;
      fetchCourses();
    } catch (error) {
      console.error('Error deleting course:', error);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-2xl bg-sheet shadow-card px-4 py-3 font-mono text-xs text-ink-3">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        載入監聽課程…
      </div>
    );
  }

  const STATUS_LABEL: Record<string, string> = { monitoring: '監控中', enrolled: '已加到', paused: '已暫停', pending: '待處理', error: '錯誤', available: '有空位' };

  return (
    <div className="space-y-4">
      {settingsCourse && (
        <CourseSettingsModal
          course={settingsCourse}
          semesterOptions={semesterOptions}
          onClose={() => setSettingsCourse(null)}
          onSaved={() => fetchCourses()}
        />
      )}

      <section className="overflow-hidden rounded-2xl bg-sheet shadow-card">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-rule px-4 py-3">
          <h3 className="text-[15px] font-bold">監聽中的課程</h3>
          <span className="font-mono text-[11px] tabular-nums tracking-wide text-ink-3">{courses.length} 門</span>
          <span className="text-[13px] text-ink-2">在「課程查詢」搜尋課程後按該列的「監聽」加入；那裡看得到名額與 GPA。</span>
          {onGoToCourseSearch && (
            <button
              type="button"
              onClick={onGoToCourseSearch}
              className="ml-auto rounded-sm border border-rule bg-sheet px-3 py-1 text-[13px] text-ink-2 hover:border-accent hover:text-accent"
            >
              前往課程查詢
            </button>
          )}
        </div>
        {courses.length > 0 ? (
          <ul>
            {courses.map(course => {
              const isMonitoring = course.status === 'monitoring';
              const isAvailable = course.status === 'available';
              const isPaused = course.status === 'paused';
              const isEnrolled = course.status === 'enrolled';
              // 已被 worker 標記，或學期早於目前學期（worker 下一輪才會標記）
              const isExpired = course.status === 'expired'
                || Boolean(currentSemester && course.semester && course.semester < currentSemester);
              const statusLabel = isExpired ? '學期已結束' : (STATUS_LABEL[course.status] ?? course.status);
              const statusTone = isExpired || course.status === 'error' ? 'text-mark' : isEnrolled || isAvailable ? 'text-good' : isMonitoring ? 'text-ink-2' : 'text-ink-3';

              return (
                <li
                  key={course.id}
                  className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 border-t border-rule px-4 py-3 first:border-t-0 sm:grid-cols-[minmax(0,1fr)_88px_auto] ${
                    isEnrolled ? 'border-l-[3px] border-l-good' : isExpired ? 'border-l-[3px] border-l-mark' : 'border-l-[3px] border-l-transparent'
                  }`}
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <b className={`text-[15px] font-medium ${isPaused || isExpired ? 'text-ink-3' : ''}`}>{course.course_name}</b>
                      <span className="font-mono text-[11px] text-ink-2">{course.course_code}</span>
                      <span
                        title={isExpired ? `學期 ${course.semester} 已結束（目前 ${currentSemester}）` : undefined}
                        className={`font-mono text-[10px] ${isExpired ? 'text-mark' : 'text-ink-3'}`}
                      >
                        {course.semester}
                      </span>
                      <span className={`font-mono text-[10px] ${statusTone}`}>{statusLabel}</span>
                    </div>
                    <span className="block font-mono text-[11px] tracking-wide text-ink-3">
                      {course.last_check_time ? `上次檢查 ${formatDateTime(course.last_check_time)}` : '尚未檢查'}
                    </span>
                    {isExpired && (
                      <span className="mt-0.5 block text-xs leading-relaxed text-mark">
                        這門課屬於學期 {course.semester}，名額不會再變動，已停止檢查。可在「課程設定」改成目前學期，或直接刪除。
                      </span>
                    )}
                  </div>

                  <span className={`font-mono text-[15px] font-medium tabular-nums sm:text-right ${isAvailable || isEnrolled ? 'text-good' : ''}`}>
                    {course.current_enrolled || '—'}
                    <em className="block text-[11px] font-normal not-italic text-ink-3">{isAvailable ? '有空位' : '目前人數'}</em>
                  </span>

                  <div className="col-start-2 row-start-2 flex gap-1 sm:col-start-auto sm:row-start-auto">
                    <button
                      type="button"
                      onClick={() => setSettingsCourse(course)}
                      className="rounded-sm border border-rule px-2.5 py-1 text-xs text-ink-2 hover:border-accent hover:text-accent"
                    >
                      課程設定
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteCourse(course.id)}
                      className="rounded-sm border border-rule px-2.5 py-1 text-xs text-ink-3 hover:border-accent hover:text-accent"
                    >
                      刪除
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="px-4 py-10 text-center">
            <b className="block text-[15px] font-medium">還沒有監聽任何課程</b>
            <p className="mt-1.5 text-[13px] text-ink-2">到課程查詢搜尋想要的課，按該列的「監聽」就會加進來。</p>
          </div>
        )}
      </section>
    </div>
  );
};

export default CoursesView;
