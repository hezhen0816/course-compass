import { useMemo } from 'react';
import { ArrowUpRight, Check, GraduationCap } from 'lucide-react';
import type { AppData } from '../../types';
import { isHistoryImportedCourse } from '../../domain/planner';
import { usePlannerStats } from '../planning/usePlannerStats';

export function GraduationPage({ data, onOpenSettings }: { data: AppData; onOpenSettings: () => void }) {
  const historyData = useMemo(() => ({
    ...data,
    historyRecords: data.historyRecords.filter(record => record.status === 'passed'),
    semesters: data.semesters.map(semester => ({ ...semester, courses: semester.courses.filter(course => isHistoryImportedCourse(course) && Boolean(course.details?.notes?.includes('狀態: 已修過'))) })),
  }), [data]);
  const stats = usePlannerStats(historyData);
  const targets = data.targets;
  const groups = [
    { title: '共同課程', items: [
      { label: '國文', value: stats.chinese, target: targets.chinese },
      { label: '英文', value: stats.english, target: targets.english },
      { label: '通識', value: stats.gen_ed, target: targets.gen_ed },
      { label: '社會實踐', value: stats.social, target: targets.social },
      { label: '體育', value: stats.pe_semesters, target: targets.pe_semesters, unit: '學期' },
    ] },
    { title: '系所與學程', items: [
      { label: '本系必修', value: stats.homeCompulsory, target: targets.home_compulsory },
      { label: '本系選修', value: stats.homeElective, target: targets.home_elective },
      { label: '雙主修', value: stats.doubleMajor, target: targets.double_major },
      { label: '輔修', value: stats.minor, target: targets.minor },
    ] },
  ];
  const remaining = Math.max(0, targets.total - stats.total);
  const percent = targets.total > 0 ? Math.min(100, Math.round(stats.total / targets.total * 100)) : 0;
  return <div className="mx-auto max-w-6xl space-y-6">
    <header className="page-heading flex flex-wrap items-end justify-between gap-4">
      <div><p className="eyebrow">畢業進度</p><h1>離目標，再近一步</h1><p>依已匯入且通過的修課紀錄，整理你的學分累積。</p></div>
      <button onClick={onOpenSettings} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium">調整畢業門檻 <ArrowUpRight className="h-4 w-4" /></button>
    </header>
    <section className="graduation-summary">
      <div><GraduationCap className="mb-4 h-8 w-8 text-blue-200" /><p className="text-sm text-slate-300">已累積學分</p><p className="mt-2 text-5xl font-semibold tracking-tight">{stats.total}<span className="ml-3 text-xl font-normal text-slate-300">/ {targets.total}</span></p></div>
      <div className="w-full md:w-1/2"><div className="mb-3 flex justify-between text-sm"><span>{targets.total > 0 ? `距設定目標還差 ${remaining} 學分` : '尚未設定總學分門檻'}</span><span>{percent}%</span></div><progress aria-label="總學分完成比例" value={percent} max={100} className="graduation-progress w-full" /><p className="mt-3 text-xs leading-relaxed text-slate-300">不含虛擬加入與待選課程。各類學分仍須符合系所認列規定。</p></div>
    </section>
    <div className="grid items-start gap-5 md:grid-cols-2">{groups.map(group => <section key={group.title} className="rounded-xl border border-slate-200 bg-white p-6"><h2 className="mb-2 text-lg font-semibold">{group.title}</h2><div className="divide-y divide-slate-100">{group.items.map(item => {
      const unit = 'unit' in item ? item.unit : '學分';
      const enabled = item.target > 0;
      const complete = enabled && item.value >= item.target;
      return <div key={item.label} className="py-5"><div className="mb-3 flex items-center justify-between gap-2"><h3 className="text-sm font-medium">{item.label}</h3><span className="text-sm tabular-nums text-slate-600">{item.value} / {item.target} {unit}</span></div><progress aria-label={`${item.label}完成比例`} value={enabled ? Math.min(item.value, item.target) : 0} max={enabled ? item.target : 1} className={`category-progress w-full ${complete ? 'complete' : ''}`} /><p className={`mt-2 flex items-center gap-1 text-xs ${complete ? 'text-emerald-700' : 'text-slate-500'}`}>{complete && <Check className="h-3.5 w-3.5" />}{!enabled ? '未設定門檻' : complete ? '已達設定門檻' : `尚差 ${Math.max(0, item.target - item.value)} ${unit}`}</p></div>;
    })}</div></section>)}</div>
    <p className="text-xs leading-relaxed text-slate-500">本頁依目前紀錄的課程分類估算；未分類課程可能尚未計入系所門檻。總學分達標不代表所有畢業條件均已滿足。</p>
  </div>;
}
