import { useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { AppData, Course, MultiSemesterPlan, PendingRequirement, PlannerPlacement, PlannerSolveRequestPayload } from '../../shared/types';
import { buildViewFromCourses, type SemesterBlock } from '../semester/semesterModel';
import { WeekGrid } from '../semester/WeekGrid';
import { CourseSheet } from '../semester/SemesterPage';
import { solvePlanner } from '../../shared/api';
import { getAccessToken } from '../../shared/supabase';
import { SETTINGS_PRIMARY_BUTTON, SETTINGS_SECONDARY_BUTTON } from '../settings/SettingsPage';
import {
  displaySlots,
  getRequirementStatus,
  inferAdmissionYearFromStudentNo,
  semesterIdForAcademicTerm,
  semesterNameForId,
} from '../../shared/domain/planner';
import { inferPrerequisites, mergeOverlappingRequirements, nextTerms } from '../../shared/domain/planTerms';

/**
 * 多學期規劃：把還沒修完的需求攤到未來幾個學期。
 * 候選班別與 GPA 由後端向 myNTUST 抓歷史開課；這頁只負責挑需求、設條件、看結果。
 */

const FIELD = 'mt-1 w-full rounded-sm border border-rule bg-sheet px-3 py-2 text-sm focus:border-ink-2';
const LABEL = 'block font-mono text-[11px] tracking-wide text-ink-3';
const DEFAULT_MIN = 0;
const DEFAULT_MAX = 21;

interface RequirementRow {
  requirement: PendingRequirement;
  enabled: boolean;
  credits: number;
  prefixes: string;
}

function termLabel(term: string, admissionYear: number | null): string {
  const id = semesterIdForAcademicTerm(term, admissionYear);
  const name = id ? semesterNameForId(id) : null;
  return name ? `${term}・${name}` : term;
}

export function MultiSemesterPage({
  data,
  querySemester,
  schoolUsername,
  gpaEnabled,
  onSavePlan,
}: {
  data: AppData;
  querySemester: string;
  schoolUsername: string;
  gpaEnabled: boolean;
  onSavePlan: (plan: MultiSemesterPlan | null) => void;
}) {
  const admissionYear = inferAdmissionYearFromStudentNo(schoolUsername);
  const saved = data.multiSemesterPlan ?? null;

  const openGroups = useMemo(
    () =>
      mergeOverlappingRequirements(
        data.pendingRequirements.filter((requirement) => {
          // 只有課碼前綴、沒有課名清單的學分池（BA 開頭 18 學分）沒辦法自動挑課，不列。
          if (requirement.kind === 'credit_pool' && requirement.courseNames.length === 0) return false;
          return !getRequirementStatus(requirement, data).completed;
        }),
      ),
    [data],
  );
  const openRequirements = useMemo(() => openGroups.map((group) => group.requirement), [openGroups]);
  const mergedCount = (id: string) => openGroups.find((group) => group.requirement.id === id)?.memberIds.length ?? 1;

  const [termCount, setTermCount] = useState(saved?.request.terms.length ?? 4);
  const terms = useMemo(() => nextTerms(querySemester, termCount), [querySemester, termCount]);
  const [minCredits, setMinCredits] = useState<Record<string, number>>(saved?.request.min_credits ?? {});
  const [maxCredits, setMaxCredits] = useState<Record<string, number>>(saved?.request.max_credits ?? {});
  const [reserved, setReserved] = useState<Record<string, number>>(saved?.request.reserved_credits ?? {});
  const [preference, setPreference] = useState<'gpa' | 'balanced'>(saved?.request.preference ?? 'gpa');
  const [campusGap, setCampusGap] = useState(saved?.request.campus_gap ?? true);
  const [crossSchool, setCrossSchool] = useState(saved?.request.include_cross_school ?? false);
  const [extraPrereqText, setExtraPrereqText] = useState('');
  const [rows, setRows] = useState<Record<string, RequirementRow>>({});
  const [status, setStatus] = useState<'idle' | 'running' | 'error'>('idle');
  const [error, setError] = useState('');

  // 待修清單的雙主修／輔系分組沒有課碼前綴，預設用「設定」裡對應的系所，免得排到管理學士班那種選不到的班。
  const programs = data.settings?.programDepartments;
  const defaultPrefix = (requirement: PendingRequirement): string => {
    if (requirement.departmentPrefixes && requirement.departmentPrefixes.length > 0) return requirement.departmentPrefixes.join(',');
    if (requirement.courseCodePrefix) return requirement.courseCodePrefix;
    if (requirement.setId === 'manual-double-major-todo') return programs?.doubleMajorDepartmentCode ?? '';
    if (requirement.setId === 'manual-minor-todo') return programs?.minorDepartmentCode ?? '';
    return '';
  };
  const rowFor = (requirement: PendingRequirement): RequirementRow =>
    rows[requirement.id] ?? {
      requirement,
      enabled: true,
      credits: requirement.credits ?? requirement.requiredCredits ?? 3,
      prefixes: defaultPrefix(requirement),
    };
  const updateRow = (requirement: PendingRequirement, patch: Partial<RequirementRow>) =>
    setRows((prev) => ({ ...prev, [requirement.id]: { ...rowFor(requirement), ...patch } }));

  const buildRequest = (): PlannerSolveRequestPayload => {
    const chosen = openRequirements.map(rowFor).filter((row) => row.enabled);
    const titleToId = new Map(chosen.map((row) => [row.requirement.title.replace(/\s+/g, ''), row.requirement.id]));
    const manualPairs = extraPrereqText
      .split(/\n/)
      .map((line) => line.split(/[>→]/).map((part) => part.trim().replace(/\s+/g, '')))
      .filter((parts) => parts.length === 2 && titleToId.has(parts[0]) && titleToId.has(parts[1]))
      .map((parts) => [titleToId.get(parts[0])!, titleToId.get(parts[1])!]);
    return {
      terms,
      requirements: chosen.map((row) => ({
        id: row.requirement.id,
        title: row.requirement.title,
        credits: row.credits,
        course_names: row.requirement.courseNames.length > 0 ? row.requirement.courseNames : [row.requirement.title],
        required: true,
        department_prefixes: row.prefixes.split(/[,，\s]+/).map((p) => p.trim().toUpperCase()).filter(Boolean),
        pool_credits: row.requirement.kind === 'credit_pool' ? (row.requirement.requiredCredits ?? row.requirement.credits ?? null) : null,
      })),
      min_credits: Object.fromEntries(terms.map((t) => [t, minCredits[t] ?? DEFAULT_MIN])),
      max_credits: Object.fromEntries(terms.map((t) => [t, maxCredits[t] ?? DEFAULT_MAX])),
      reserved_credits: Object.fromEntries(terms.filter((t) => reserved[t]).map((t) => [t, reserved[t]])),
      prerequisites: [...inferPrerequisites(chosen.map((row) => row.requirement)), ...manualPairs],
      deadlines: {},
      campus_gap: campusGap,
      preference,
      include_cross_school: crossSchool,
      preferred_prefixes: [programs?.homeDepartmentCode, programs?.doubleMajorDepartmentCode, programs?.minorDepartmentCode]
        .map((code) => (code || '').trim().toUpperCase())
        .filter(Boolean),
    };
  };

  const run = async () => {
    setStatus('running');
    setError('');
    try {
      const token = await getAccessToken();
      if (!token) throw new Error('請先登入。');
      const request = buildRequest();
      if (request.requirements.length === 0) throw new Error('沒有勾選任何待修需求。');
      const response = await solvePlanner(request, token);
      if (response.status === 'not_enabled') throw new Error('尚未啟用 myNTUST GPA 密鑰，到「設定」貼上後再跑。');
      onSavePlan({ request, response, solvedAt: new Date().toISOString() });
      setStatus('idle');
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const requirementTitle = (id: string) =>
    data.pendingRequirements.find((requirement) => requirement.id === id)?.title ?? saved?.request.requirements.find((r) => r.id === id)?.title ?? id;

  return (
    <div className="space-y-5">
      <div>
        <p className="font-mono text-[11px] tracking-[.14em] text-ink-2">多學期規劃</p>
        <h1 className="mt-0.5 text-[19px] font-bold">把還沒修的課排進未來學期</h1>
        <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-ink-2">
          用「畢業門檻」裡還沒完成的需求，配 myNTUST 歷年開課與老師 GPA，排出不衝堂、先修在前、GPA 最高的配置。
          班別與時段是依歷史開課推估，每學期課表公告後要重跑。
        </p>
      </div>

      {!gpaEnabled && (
        <p className="rounded-sm border border-rule bg-paper px-3 py-2 text-[13px] text-ink-2">
          這頁要用 myNTUST 密鑰抓歷年開課與 GPA；到「設定」啟用後才能排。
        </p>
      )}

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
        <div className="space-y-4">
          <section className="rounded-lg border border-rule bg-paper p-4">
            <h3 className="font-mono text-xs tracking-[.14em] text-ink-2">學期與負擔</h3>
            <label className="mt-3 block">
              <span className={LABEL}>從 {querySemester} 之後排幾個學期</span>
              <select value={termCount} onChange={(event) => setTermCount(Number(event.target.value))} className={FIELD}>
                {[2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n} 個學期</option>)}
              </select>
            </label>
            <table className="mt-3 w-full font-mono text-[12px]">
              <thead>
                <tr className="text-left text-[10px] tracking-[.12em] text-ink-3">
                  <th className="py-1 font-normal">學期</th>
                  <th className="py-1 font-normal">下限</th>
                  <th className="py-1 font-normal">上限</th>
                  <th className="py-1 font-normal" title="已確定要修但不在需求清單裡的學分，例如實務專題">預留</th>
                </tr>
              </thead>
              <tbody>
                {terms.map((term) => (
                  <tr key={term} className="border-t border-rule">
                    <td className="py-1 pr-2 whitespace-nowrap">{termLabel(term, admissionYear)}</td>
                    {([
                      [minCredits, setMinCredits, DEFAULT_MIN],
                      [maxCredits, setMaxCredits, DEFAULT_MAX],
                      [reserved, setReserved, 0],
                    ] as Array<[Record<string, number>, (next: Record<string, number>) => void, number]>).map(([map, setMap, fallback], index) => (
                      <td key={index} className="py-1 pr-1">
                        <input
                          type="number"
                          min={0}
                          max={30}
                          value={map[term] ?? fallback}
                          onChange={(event) => setMap({ ...map, [term]: Number(event.target.value) })}
                          className="w-14 rounded-sm border border-rule bg-sheet px-1.5 py-0.5 text-right"
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-3 space-y-2 text-[13px]">
              <label className="flex items-center gap-2">
                <input type="radio" checked={preference === 'gpa'} onChange={() => setPreference('gpa')} />
                GPA 優先，能早修就早修
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" checked={preference === 'balanced'} onChange={() => setPreference('balanced')} />
                GPA 優先，但各學期負擔盡量平均
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={campusGap} onChange={(event) => setCampusGap(event.target.checked)} />
                華夏與校本部之間留一節空堂
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={crossSchool} onChange={(event) => setCrossSchool(event.target.checked)} />
                納入台大／師大跨校班
              </label>
            </div>
            <label className="mt-3 block">
              <span className={LABEL}>額外先修順序（每行一組：甲 &gt; 乙）</span>
              <textarea
                value={extraPrereqText}
                onChange={(event) => setExtraPrereqText(event.target.value)}
                placeholder={'計算機組織 > 作業系統\n會計學 > 管理會計'}
                rows={3}
                className={FIELD}
              />
              <span className="mt-1 block text-[11px] text-ink-3">「(上)→(下)」會自動配對，不用寫。</span>
            </label>
            <button type="button" onClick={run} disabled={status === 'running' || !gpaEnabled} className={`${SETTINGS_PRIMARY_BUTTON} mt-4 w-full`}>
              {status === 'running' ? <span className="inline-flex items-center gap-2"><Loader2 className="h-3.5 w-3.5 animate-spin" />向 myNTUST 抓歷年開課並求解中（需求多時一分鐘左右）…</span> : saved ? '重新排課' : '開始排課'}
            </button>
            {error && <p className="mt-2 text-[13px] text-mark">{error}</p>}
          </section>

          <section className="rounded-lg border border-rule bg-paper p-4">
            <h3 className="font-mono text-xs tracking-[.14em] text-ink-2">待排需求・{openRequirements.length} 項</h3>
            <p className="mt-1 text-[11px] text-ink-3">來自畢業門檻裡尚未完成的課程需求（沒列出可認列課名的學分池挑不出課，不列）。系所限定填課碼前兩碼，空白＝不限。</p>
            {openRequirements.length === 0 && <p className="mt-3 text-[13px] text-ink-2">沒有未完成的課程需求。先在「畢業門檻」匯入應修科目表。</p>}
            <ul className="mt-2 divide-y divide-rule">
              {openRequirements.map((requirement) => {
                const row = rowFor(requirement);
                return (
                  <li key={requirement.id} className="flex items-center gap-2 py-1.5 text-[13px]">
                    <input type="checkbox" checked={row.enabled} onChange={(event) => updateRow(requirement, { enabled: event.target.checked })} />
                    <span className={`min-w-0 flex-1 truncate ${row.enabled ? '' : 'text-ink-3'}`} title={requirement.courseNames.join('、')}>
                      {requirement.title}
                      {requirement.kind === 'credit_pool' && <span className="ml-1 font-mono text-[10px] text-ink-3">池・{requirement.courseNames.length} 門任選</span>}
                      {requirement.kind !== 'credit_pool' && requirement.courseNames.length > 1 && <span className="ml-1 font-mono text-[10px] text-ink-3">擇一</span>}
                      {mergedCount(requirement.id) > 1 && <span className="ml-1 font-mono text-[10px] text-good" title="兩份科目表都列了這門，修一次同時滿足">兼充 ×{mergedCount(requirement.id)}</span>}
                    </span>
                    <input
                      type="number"
                      min={1}
                      max={6}
                      value={row.credits}
                      onChange={(event) => updateRow(requirement, { credits: Number(event.target.value) })}
                      className="w-11 rounded-sm border border-rule bg-sheet px-1 py-0.5 text-right font-mono text-[12px]"
                      title="學分"
                    />
                    <input
                      value={row.prefixes}
                      onChange={(event) => updateRow(requirement, { prefixes: event.target.value })}
                      placeholder="系所"
                      className="w-16 rounded-sm border border-rule bg-sheet px-1 py-0.5 font-mono text-[12px] uppercase"
                      title="限定開課系所（課碼前兩碼，可用逗號分隔）"
                    />
                  </li>
                );
              })}
            </ul>
          </section>
        </div>

        <div className="space-y-4">
          {!saved && (
            <div className="rounded-lg border border-dashed border-rule px-4 py-10 text-center text-[13px] text-ink-3">
              還沒排過。左邊設定好後按「開始排課」。
            </div>
          )}
          {saved && <PlanResult plan={saved} data={data} admissionYear={admissionYear} requirementTitle={requirementTitle} onClear={() => onSavePlan(null)} />}
        </div>
      </div>
    </div>
  );
}

/** 未來學期的課表沒有「現在」可畫：給一個凌晨三點，朱批線一定落在時間軸外。 */
const NO_NOW = new Date(2000, 0, 1, 3, 0);

function placementToCourse(placement: PlannerPlacement, isPool: boolean): Course {
  return {
    id: `plan-${placement.term}-${placement.candidate_id}`,
    name: placement.name,
    credits: placement.credits,
    // 必修需求標 R，課碼分類才會把本系課畫成「本系必修」而不是灰色選修。
    category: isPool ? 'elective' : 'compulsory',
    scheduledOffering: {
      semester: placement.term,
      courseNo: placement.course_no,
      courseName: placement.name,
      teacher: placement.teacher,
      credits: placement.credits,
      classroom: placement.campus,
      node: placement.slots.join(','),
      slots: placement.slots,
      requireOption: isPool ? 'E' : 'R',
      contents: placement.contents || `依 ${placement.source_semester} 班表推估`,
      gpa: placement.gpa,
      gpaStatus: typeof placement.gpa === 'number' ? 'found' : 'no_data',
      gpaStudents: placement.students,
    },
  };
}

function PlanResult({
  plan,
  data,
  admissionYear,
  requirementTitle,
  onClear,
}: {
  plan: MultiSemesterPlan;
  data: AppData;
  admissionYear: number | null;
  requirementTitle: (id: string) => string;
  onClear: () => void;
}) {
  const { request, response } = plan;
  const poolIds = new Set(request.requirements.filter((r) => r.pool_credits).map((r) => r.id));
  const [layout, setLayout] = useState<'grid' | 'list'>('grid');
  const [selectedBlock, setSelectedBlock] = useState<SemesterBlock | null>(null);
  const byTerm = new Map<string, PlannerPlacement[]>();
  request.terms.forEach((term) => byTerm.set(term, []));
  response.placements.forEach((placement) => byTerm.get(placement.term)?.push(placement));
  const graded = response.placements.filter((p) => typeof p.gpa === 'number');
  const avgGpa = graded.length > 0 ? graded.reduce((sum, p) => sum + (p.gpa as number), 0) / graded.length : null;
  const solvedAt = new Date(plan.solvedAt);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="font-mono text-[11px] tracking-[.14em] text-ink-2">
            {solvedAt.toLocaleString('zh-TW', { hour12: false })}・{response.candidates.length} 個候選班別・
            {response.solver_status === 'optimal' ? '最佳解' : response.solver_status === 'feasible' ? '可行解（時間內未證明最佳）' : '無解'}
          </p>
          <h3 className="mt-0.5 text-[15px] font-bold">
            排入 {response.placements.length} 門
            {avgGpa !== null && <span className="ml-2 font-mono text-[13px] font-normal text-ink-2">有 GPA 的 {graded.length} 門平均 {avgGpa.toFixed(3)}</span>}
          </h3>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex overflow-hidden rounded-sm border border-rule font-mono text-[12px]">
            {(['grid', 'list'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setLayout(mode)}
                className={`px-3 py-1 ${layout === mode ? 'bg-accent text-sheet' : 'bg-sheet text-ink-2 hover:text-ink'}`}
              >
                {mode === 'grid' ? '課表' : '清單'}
              </button>
            ))}
          </div>
          <button type="button" onClick={onClear} className={SETTINGS_SECONDARY_BUTTON}>清除結果</button>
        </div>
      </div>

      {response.status === 'rate_limited' && (
        <p className="rounded-sm border border-rule bg-paper px-3 py-2 text-[13px] text-ink-2">myNTUST 限流，部分班別沒抓到 GPA 或歷史；稍後重跑會更完整。</p>
      )}

      {request.terms.map((term) => {
        const items = byTerm.get(term) ?? [];
        const credits = response.credits_by_term[term] ?? 0;
        const reservedCredits = request.reserved_credits[term] ?? 0;
        return (
          <section key={term} className="rounded-2xl bg-sheet shadow-card">
            <div className="flex items-baseline justify-between border-b border-rule px-4 py-2.5">
              <h4 className="font-mono text-[13px]">{termLabel(term, admissionYear)}</h4>
              <span className="font-mono text-[12px] text-ink-2">
                {items.length} 門・{credits} 學分{reservedCredits ? `（含預留 ${reservedCredits}）` : ''}
              </span>
            </div>
            {items.length === 0 ? (
              <p className="px-4 py-3 text-[13px] text-ink-3">這學期沒排課。</p>
            ) : layout === 'grid' ? (
              <div className="p-2">
                <WeekGrid
                  view={buildViewFromCourses(items.map((placement) => placementToCourse(placement, poolIds.has(placement.requirement_id))), data)}
                  now={NO_NOW}
                  onSelectCourse={setSelectedBlock}
                />
                {items.some((placement) => placement.slots.length === 0) && (
                  <p className="px-2 pt-2 font-mono text-[11px] text-ink-2">
                    時間未定（課表上畫不出來）：
                    {items
                      .filter((placement) => placement.slots.length === 0)
                      .map((placement) => `${placement.name}${placement.teacher ? `・${placement.teacher}` : ''}・${placement.credits} 學分`)
                      .join('；')}
                  </p>
                )}
                {items.some((placement) => placement.eligibility === 'signature') && (
                  <p className="px-2 pt-2 font-mono text-[11px] text-ink-2">
                    需加簽：
                    {items
                      .filter((placement) => placement.eligibility === 'signature')
                      .map((placement) => `${placement.name}${placement.teacher ? `・${placement.teacher}` : ''}`)
                      .join('；')}
                  </p>
                )}
              </div>
            ) : (
              <ul className="divide-y divide-rule">
                {items.map((placement) => (
                  <li key={placement.candidate_id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-2">
                    <div className="min-w-0">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <p className="min-w-0 truncate text-[14px] font-medium">{placement.name}</p>
                        {placement.eligibility === 'signature' && (
                          <span className="shrink-0 rounded-[2px] border px-1.5 font-mono text-[10px] border-cat-gened text-cat-gened">需加簽</span>
                        )}
                      </div>
                      <p className="truncate font-mono text-[11px] text-ink-2">
                        {[placement.course_no, placement.teacher || '老師未定', displaySlots(placement.slots), `${placement.credits} 學分`, placement.campus, `依 ${placement.source_semester} 班表`]
                          .filter(Boolean)
                          .join('・')}
                      </p>
                    </div>
                    <span className={`font-mono text-[13px] tabular-nums ${typeof placement.gpa === 'number' ? 'text-ink-2' : 'text-ink-3'}`}>
                      {typeof placement.gpa === 'number' ? `GPA ${placement.gpa.toFixed(2)}` : placement.teacher ? '無 GPA' : '老師未定'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}

      {selectedBlock && <CourseSheet block={selectedBlock} data={data} onClose={() => setSelectedBlock(null)} />}

      {(response.unplaced.length > 0 || Object.keys(response.notes).length > 0) && (
        <section className="rounded-lg border border-rule bg-paper px-4 py-3 text-[13px]">
          <h4 className="font-mono text-[11px] tracking-[.14em] text-ink-2">沒排進去的</h4>
          <ul className="mt-2 space-y-1">
            {response.unplaced.map((item) => (
              <li key={item.requirement_id}>
                <b>{requirementTitle(item.requirement_id)}</b>
                <span className="text-ink-2">・{response.notes[item.requirement_id] ?? unplacedReason(item.reason)}</span>
              </li>
            ))}
            {Object.entries(response.notes)
              .filter(([id]) => !response.unplaced.some((item) => item.requirement_id === id))
              .map(([id, note]) => (
                <li key={id}><b>{requirementTitle(id)}</b><span className="text-ink-2">・{note}</span></li>
              ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function unplacedReason(reason: string): string {
  return reason;
}
