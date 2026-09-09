import { useEffect, useMemo, useState } from 'react';
import { BookOpen, CalendarDays, GraduationCap, History, Radar, Search, Settings, LogOut } from 'lucide-react';
import { useAuth } from '../../shared/hooks/useAuth';
import { useCourseData } from '../../shared/hooks/useCourseData';
import { supabase } from '../../shared/supabase';
import { useCourseSearch } from '../course-search/useCourseSearch';
import { usePlannerStats } from '../planning/usePlannerStats';
import { PlanningWorkspace } from '../planning/PlanningWorkspace';
import { currentEnrollmentPhase } from '../../shared/domain/enrollmentCalendar';
import { capacityLabel, isHistoryImportedCourse, type PlanningMode } from '../../shared/domain/planner';
import type { AppData, Course } from '../../shared/types';

const pages = [
  { id: 'semester', label: '本學期', icon: CalendarDays, description: '把已選課程與選課規劃放在同一張課表。' },
  { id: 'search', label: '找課程', icon: Search, description: '查詢正式開課資料，找到適合你的下一堂課。' },
  { id: 'graduation', label: '畢業規劃', icon: GraduationCap, description: '分開查看已完成學分與未來規劃。' },
  { id: 'history', label: '修課紀錄', icon: History, description: '回顧已匯入的校務修課紀錄與成績。' },
  { id: 'monitor', label: '課程監控', icon: Radar, description: '查看現有監控課程與最近檢查結果。' },
  { id: 'settings', label: '帳號設定', icon: Settings, description: '查看帳號、資料來源與同步時間。' },
] as const;
type Page = typeof pages[number]['id'];
type SearchState = ReturnType<typeof useCourseSearch>;
type Monitor = { id: number; course_code: string; course_name: string; status: string; current_enrolled: string; auto_enroll: boolean; last_check_time: string | null; semester: string };
const date = (value?: string | null) => value ? new Date(value).toLocaleString('zh-TW') : '尚無紀錄';
const empty = (text: string) => <p className="next-empty">{text}</p>;

function Login({ onSkip }: { onSkip: () => void }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return <div className="next-login"><BookOpen size={36} /><h1>修課羅盤</h1><p>登入現有帳號，用你的資料檢視新版介面。</p><form onSubmit={async event => {
    event.preventDefault();
    if (!supabase) { setError('尚未設定雲端連線。'); return; }
    const fields = new FormData(event.currentTarget);
    setBusy(true); setError('');
    try {
      const { error: authError } = await supabase.auth.signInWithPassword({ email: String(fields.get('email')), password: String(fields.get('password')) });
      if (authError) setError('登入失敗，請確認帳號與密碼。');
    } catch { setError('無法連線，請稍後再試。'); } finally { setBusy(false); }
  }}><label>Email<input name="email" type="email" autoComplete="username" required /></label><label>密碼<input name="password" type="password" autoComplete="current-password" required /></label><button className="next-primary" disabled={busy}>{busy ? '登入中…' : '登入'}</button></form>{error && <p role="alert">{error}</p>}<button onClick={onSkip}>先看空白介面</button><small>本機唯讀預覽 · 不會儲存修課變更</small></div>;
}

function SearchPanel({ search, compact = false }: { search: SearchState; compact?: boolean }) {
  return <section className="next-card next-search"><h2>{compact ? '找一堂課' : '探索課程'}</h2><form onSubmit={event => { event.preventDefault(); void search.runManualSearch(); }}>
    <div className="next-fields"><label>學期<input value={search.querySemester} list="next-terms" onChange={e => search.handleQuerySemesterChange(e.target.value)} /></label><datalist id="next-terms">{search.courseSemesters.map(term => <option key={term.semester} value={term.semester} />)}</datalist><label>查詢方式<select value={search.manualMode} onChange={e => search.handleManualModeChange(e.target.value as 'name' | 'code')}><option value="name">課名</option><option value="code">課碼</option></select></label></div>
    <label>課程關鍵字<input placeholder="輸入課名或課碼" value={search.manualQuery} onChange={e => search.setManualQuery(e.target.value)} /></label>
    <div className="next-checks"><label><input type="checkbox" checked={search.exactCourseNameSearch} disabled={search.manualMode === 'code'} onChange={e => search.setExactCourseNameSearch(e.target.checked)} />完整課名</label><label><input type="checkbox" checked={search.includeCrossSchool} onChange={e => search.setIncludeCrossSchool(e.target.checked)} />包含跨校</label></div>
    <button className="next-primary" disabled={!search.canRunManualSearch}>{search.manualStatus === 'loading' ? '查詢中…' : '查詢課程'}</button>
  </form><details><summary>篩選結果</summary><div className="next-fields"><label>教師<input value={search.teacherFilter} onChange={e => search.setTeacherFilter(e.target.value)} /></label><label>學分<select value={search.creditFilter} onChange={e => search.setCreditFilter(e.target.value)}>{['all', '0', '1', '2', '3', '4'].map(n => <option key={n} value={n}>{n === 'all' ? '不限' : n}</option>)}</select></label><label>必選修<select value={search.requireOptionFilter} onChange={e => search.setRequireOptionFilter(e.target.value)}><option value="all">不限</option><option value="R">必修</option><option value="E">選修</option></select></label><label>節次<input placeholder="例如 M3" value={search.timeFilter} onChange={e => search.setTimeFilter(e.target.value)} /></label><label>名額<select value={search.capacityFilter} onChange={e => search.setCapacityFilter(e.target.value as SearchState['capacityFilter'])}><option value="all">不限</option><option value="available">有名額</option><option value="full">額滿</option><option value="unknown">未知</option></select></label></div></details>
    {search.manualError && <p className="next-error" role="alert">{search.manualError}</p>}
    <div className="next-row"><small>{search.manualSearchSummary ? `${search.filteredManualResults.length} 筆結果` : '輸入關鍵字開始查詢'}</small><button onClick={search.resetCourseSearchFilters}>清除</button>{!compact && <button disabled={!search.filteredManualResults.length} onClick={search.exportCourseResults}>匯出 CSV</button>}</div>
    <div className="next-results">{search.filteredManualResults.map((course, index) => <details key={`${course.course_no}-${index}`} className="next-result"><summary><small>{course.course_no} · {course.credits ?? '—'} 學分</small><h3>{course.course_name}</h3><p>{course.teacher || '教師未定'} · {course.node || '時間未定'}</p><span className="next-badge">{capacityLabel(course)}</span></summary><p>{course.classroom || '教室未定'} · {course.require_option}</p><p>GPA：{course.gpa ?? '尚無資料'}</p><p>{course.contents || '沒有課程備註'}</p><small>唯讀預覽，暫不加入規劃或官方選課。</small></details>)}</div>
    {search.manualSearchSummary && !search.filteredManualResults.length && search.manualStatus !== 'error' && empty('沒有符合條件的課程，請調整關鍵字或篩選。')}
  </section>;
}

function CourseList({ courses }: { courses: Course[] }) {
  return courses.length ? <div>{courses.map(course => <details className="next-result" key={course.id}><summary><span className="next-badge">{course.credits} 學分</span><h3>{course.name}</h3><p>{course.scheduledOffering?.teacher || course.details?.professor || '尚無教師資料'} · {course.scheduledOffering?.node || course.details?.time || '尚無時間資料'}</p></summary><p>{course.details?.notes || '尚無筆記'}</p><p>成績：{course.grade || '尚無紀錄'}</p>{course.details?.gradingPolicy.map(item => <p key={item.id}>{item.name} · {item.weight}% · {item.score ?? '未登錄'}</p>)}</details>)}</div> : empty('這個學期尚未加入課程。');
}

function Graduation({ data }: { data: AppData }) {
  const completed = useMemo(() => ({ ...data, historyRecords: data.historyRecords.filter(r => r.status === 'passed'), semesters: data.semesters.map(s => ({ ...s, courses: s.courses.filter(c => isHistoryImportedCourse(c) && c.details?.notes?.includes('狀態: 已修過')) })), selectionPlan: undefined }), [data]);
  const stats = usePlannerStats(completed);
  const projected = usePlannerStats(data);
  const requirements = [ ['畢業總學分', stats.total, data.targets.total], ['國文', stats.chinese, data.targets.chinese], ['英文', stats.english, data.targets.english], ['通識', stats.gen_ed, data.targets.gen_ed], ['本系必修', stats.homeCompulsory, data.targets.home_compulsory], ['本系選修', stats.homeElective, data.targets.home_elective], ['雙主修', stats.doubleMajor, data.targets.double_major], ['輔系', stats.minor, data.targets.minor], ['體育學期', stats.pe_semesters, data.targets.pe_semesters], ['社會實踐', stats.social, data.targets.social] ] as const;
  return <><div className="next-metrics"><div><small>已完成學分</small><strong>{stats.total}<em> / {data.targets.total}</em></strong></div><div><small>尚差學分</small><strong>{Math.max(0, data.targets.total - stats.total)}</strong></div><div><small>含修習中與規劃</small><strong>{projected.total}</strong></div></div><section className="next-card"><h2>完成進度</h2><p>已完成僅計入通過的匯入紀錄；認列結果仍須依系所審核。</p><div className="next-progress-grid">{requirements.map(([label, value, target]) => <div key={label}><div className="next-row"><span>{label}</span><b>{value} / {target}</b></div><progress max={target || 1} value={Math.min(value, target || 1)} /></div>)}</div></section><section className="next-card"><h2>跨學期規劃</h2><div className="next-term-grid">{data.semesters.map(s => <article key={s.id}><h3>{s.name}</h3><CourseList courses={s.courses} /></article>)}</div></section><section className="next-card"><h2>待認列與修課需求</h2>{data.pendingRequirements.length ? data.pendingRequirements.map(r => <div className="next-result" key={r.id}><h3>{r.title}</h3><p>{r.note || r.courseNames.join('、')}</p></div>) : empty('尚未建立修課需求。')}</section></>;
}

function Workspace({ session, onLogin }: { session: ReturnType<typeof useAuth>['session']; onLogin: () => void }) {
  const { data, isLoading, loadError } = useCourseData(session, true);
  const search = useCourseSearch();
  const stats = usePlannerStats(data);
  const [page, setPage] = useState<Page>('semester');
  const [mode, setMode] = useState<PlanningMode>(() => currentEnrollmentPhase(search.querySemester).kind === 'preregistration' ? 'lottery' : 'addDrop');
  const [notice, setNotice] = useState('');
  const [historyQuery, setHistoryQuery] = useState('');
  const [monitors, setMonitors] = useState<Monitor[]>([]);
  const [monitorStatus, setMonitorStatus] = useState('尚未載入');
  useEffect(() => {
    if (!session || !supabase || page !== 'monitor') return;
    let active = true;
    void supabase.from('monitored_courses').select('id,course_code,course_name,status,current_enrolled,auto_enroll,last_check_time,semester').eq('user_id', session.user.id).then(result => {
      if (!active) return;
      setMonitorStatus(result.error ? '監控資料讀取失敗，請稍後再試。' : '已讀取雲端監控資料');
      setMonitors(result.error ? [] : result.data as Monitor[]);
    });
    return () => { active = false; };
  }, [page, session]);
  const current = pages.find(p => p.id === page)!;
  const plan = data.selectionPlan;
  const term = plan?.targetAcademicTerm || search.querySemester;
  const enrolled = data.semesters.flatMap(s => s.courses).filter(c => !isHistoryImportedCourse(c) && c.scheduledOffering?.semester === term);
  const readonly = () => setNotice('目前是唯讀預覽，這項操作尚未開放。');
  const records = data.historyRecords.filter(r => `${r.courseName} ${r.courseCode} ${r.academicTerm}`.includes(historyQuery));
  return <><nav className="next-nav" aria-label="主要導覽"><BookOpen className="next-logo" size={28} />{pages.map(p => <button key={p.id} aria-current={page === p.id ? 'page' : undefined} onClick={() => { setPage(p.id); setNotice(''); window.scrollTo(0, 0); }}><p.icon size={21} /><span>{p.label}</span></button>)}</nav><div className="next-shell"><header className="next-top"><b>修課羅盤 <small>Course Compass</small></b><span className="next-badge">本機 · 唯讀預覽</span></header><main><div className="next-heading"><small>YOUR ACADEMIC JOURNEY</small><h1>{current.label}</h1><p>{current.description}</p></div><div className="next-notice">{session ? '已連接你的雲端資料。課表與官方選課顯示上次保存的快照。' : '尚未登入，以下為空白介面。登入後才會顯示你的資料。'}{!session && <button onClick={onLogin}>登入帳號</button>}</div>{notice && <p role="status" className="next-notice">{notice}</p>}{loadError ? <p role="alert" className="next-error">{loadError}</p> : isLoading ? empty('正在讀取雲端資料…') : <>
    {page === 'semester' && <><div className="next-metrics"><div><small>規劃學期</small><strong>{term}</strong></div><div><small>已同步課程</small><strong>{enrolled.length}</strong></div><div><small>選課規劃</small><strong>{plan?.courses.length || 0}<em> 堂</em></strong></div></div><div className="next-workspace"><div className="next-schedule"><PlanningWorkspace data={data} stats={stats} activeSemester={{ id: 'preview', name: plan?.targetLabel || term, courses: plan?.courses || [] }} enrolledCourses={enrolled} querySemester={term} planningMode={mode} plannerMessage="唯讀快照；切換階段僅改變顯示方式。" officialSelection={plan?.officialSelectionCache || null} officialActionCourseNo={null} officialOrderStatus="idle" onModeChange={setMode} onJoinOfficialCourse={readonly} onRemoveOfficialCourse={readonly} onSaveOfficialOrder={readonly} onDeleteCourse={readonly} /></div><SearchPanel search={search} compact /></div></>}
    {page === 'search' && <SearchPanel search={search} />}
    {page === 'graduation' && <Graduation data={data} />}
    {page === 'history' && <section className="next-card"><div className="next-row"><h2>已匯入紀錄 · {data.historyRecords.length} 筆</h2><small>{date(data.schoolSync?.historyImportedAt)}</small></div><label>搜尋紀錄<input value={historyQuery} placeholder="課名、課碼或學期" onChange={e => setHistoryQuery(e.target.value)} /></label>{records.map((r, i) => <article key={i} className="next-result"><span className="next-badge">{r.status === 'passed' ? '已修過' : r.status === 'failed' ? '不及格' : '修習中'}</span><small>{r.academicTerm} · {r.courseCode}</small><h3>{r.courseName}</h3><p>{r.credits} 學分 · 成績 {r.grade || '未公布'} · {r.category}</p></article>)}{!records.length && empty('沒有符合條件的修課紀錄。')}</section>}
    {page === 'monitor' && <section className="next-card"><h2>監控清單</h2><p role="status">{session ? monitorStatus : '登入後可讀取監控資料。'}</p>{monitors.map(m => <article key={m.id} className="next-result"><span className="next-badge">{m.status}</span><small>{m.semester} · {m.course_code}</small><h3>{m.course_name}</h3><p>目前人數：{m.current_enrolled || '尚無資料'} · 自動加選：{m.auto_enroll ? '已啟用' : '未啟用'}</p><small>最近檢查：{date(m.last_check_time)}</small></article>)}{!monitors.length && monitorStatus === '已讀取雲端監控資料' && empty('目前沒有監控課程。')}<p>此頁顯示現有設定；實際監控由既有 worker 執行。</p></section>}
    {page === 'settings' && <section className="next-card"><h2>帳號與資料</h2><div className="next-result"><h3>{session?.user.email || '未登入'}</h3><p>修課資料：{session ? '現有雲端帳號' : '尚未連接'}</p></div><div className="next-result"><h3>校務快照</h3><p>課表同步：{date(data.schoolSync?.scheduleSyncedAt)}</p><p>歷年匯入：{date(data.schoolSync?.historyImportedAt)}</p><p>選課規劃更新：{date(plan?.updatedAt)}</p></div><div className="next-result"><h3>修讀系所</h3><p>本系：{data.settings?.programDepartments?.homeDepartmentCode || '尚未設定'}</p><p>雙主修：{data.settings?.programDepartments?.doubleMajorDepartmentCode || '尚未設定'} · 輔系：{data.settings?.programDepartments?.minorDepartmentCode || '尚未設定'}</p></div>{session ? <button onClick={() => { void supabase?.auth.signOut({ scope: 'local' }); }}><LogOut size={16} /> 登出此瀏覽器</button> : <button onClick={onLogin}>登入帳號</button>}</section>}
  </>}</main></div></>;
}

export function NextApp() {
  const { session, loading } = useAuth();
  const [skip, setSkip] = useState(false);
  return <div className="next-app">{loading ? empty('正在確認登入狀態…') : !session && !skip ? <Login onSkip={() => setSkip(true)} /> : <Workspace key={session?.user.id || 'empty'} session={session} onLogin={() => setSkip(false)} />}</div>;
}
