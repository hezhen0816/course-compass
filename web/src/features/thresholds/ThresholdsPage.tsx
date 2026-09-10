import { useState } from 'react';
import type { AppData, CourseProgram, PendingRequirement, PlannerStats, RequirementKind } from '../../shared/types';
import {
  DOUBLE_MAJOR_RECOGNITION_SET_ID,
  MINOR_RECOGNITION_SET_ID,
  formatCredits,
  getRequirementStatus,
  normalizeName,
} from '../../shared/domain/planner';

type RecognitionRequirementDraft = {
  program: Extract<CourseProgram, 'double_major' | 'minor'>;
  kind: RequirementKind;
  title: string;
  requiredCredits?: number | null;
  courseNames: string[];
  courseCodePrefix?: string | null;
  note?: string;
};

export type { RecognitionRequirementDraft };

type ThresholdsPageProps = {
  data: AppData;
  stats: PlannerStats;
  onAddRecognitionRequirement: (draft: RecognitionRequirementDraft) => void;
  onDeleteRecognitionRequirement: (requirementId: string) => void;
};

/**
 * 畢業門檻：門檻完成度 ＋ 雙主修／輔系認列規則。
 *
 * 從「修課軌跡 / 畢業進度」拆出來的那一半。數字一律沿用 `usePlannerStats`，
 * 不在這裡重算，否則拆頁就會改到使用者原本看到的進度。
 */
export function ThresholdsPage({
  data,
  stats,
  onAddRecognitionRequirement,
  onDeleteRecognitionRequirement,
}: ThresholdsPageProps) {
  return (
    <div className="space-y-5">
      <GraduationProgressPanel data={data} stats={stats} />
      <RecognitionRequirementsPanel
        data={data}
        onAddRecognitionRequirement={onAddRecognitionRequirement}
        onDeleteRecognitionRequirement={onDeleteRecognitionRequirement}
      />
    </div>
  );
}

function GraduationProgressPanel({ data, stats }: { data: AppData; stats: PlannerStats }) {
  const total = { label: '總學分', value: stats.total, target: data.targets.total, unit: '學分' };
  // 分成共同／系所兩組只是為了好掃；每列的分母仍是自己的門檻，跟拆頁前一樣。
  const common = [
    { label: '國文', value: stats.chinese, target: data.targets.chinese, unit: '學分' },
    { label: '英文', value: stats.english, target: data.targets.english, unit: '學分' },
    { label: '通識', value: stats.gen_ed, target: data.targets.gen_ed, unit: '學分' },
    { label: '社會實踐', value: stats.social, target: data.targets.social, unit: '學分' },
    { label: '體育學期', value: stats.pe_semesters, target: data.targets.pe_semesters, unit: '學期' },
  ].filter((row) => row.target > 0);
  const program = [
    { label: '本系必修', value: stats.homeCompulsory, target: data.targets.home_compulsory, unit: '學分' },
    { label: '本系選修', value: stats.homeElective, target: data.targets.home_elective, unit: '學分' },
    { label: '雙主修', value: stats.doubleMajor, target: data.targets.double_major, unit: '學分' },
    { label: '輔系', value: stats.minor, target: data.targets.minor, unit: '學分' },
  ].filter((row) => row.target > 0);

  return (
    <section className="space-y-4">
      <div className="grid gap-x-8 gap-y-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
        <div>
          <p className="font-mono text-[11px] tracking-[.14em] text-ink-2">畢業進度</p>
          <h1 className="mt-0.5 text-[19px] font-bold">門檻完成度</h1>
          <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-ink-2">
            包含已修課程與未來規劃課程；門檻數字可在設定頁調整。
          </p>
        </div>
        {total.target > 0 && (
          <div className="font-mono">
            <span className="text-[11px] tracking-wide text-ink-3">總學分</span>
            <div className="flex items-baseline gap-1.5">
              <strong className="text-[29px] font-semibold tabular-nums">{formatCredits(total.value)}</strong>
              <span className="text-xs text-ink-2">/ {formatCredits(total.target)} 學分</span>
            </div>
            <p className="mt-1 text-[11px] tracking-wide text-ink-3">
              {total.value >= total.target
                ? '總學分已達標'
                : `還差 ${formatCredits(total.target - total.value)} 學分`}
            </p>
          </div>
        )}
      </div>

      {total.target > 0 && (
        <div className="h-1.5 overflow-hidden rounded-full bg-band">
          <div
            className={`h-1.5 rounded-full ${total.value >= total.target ? 'bg-good' : 'bg-ink-2'}`}
            style={{ width: `${ratioOf(total.value, total.target)}%` }}
          />
        </div>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-2">
        {common.length > 0 && (
          <Ledger title="共同門檻">
            {common.map((row) => (
              <LedgerRow key={row.label} {...row} squares={row.label === '體育學期'} />
            ))}
          </Ledger>
        )}
        {program.length > 0 && (
          <Ledger title="系所門檻">
            {program.map((row) => (
              <LedgerRow key={row.label} {...row} />
            ))}
          </Ledger>
        )}
      </div>

      {/* 向度一直有算（usePlannerStats 的 genEdDimensions），只是以前沒畫出來。
          放在門檻卡外面，門檻被 filter 成空的時候才不會跟著消失。 */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 font-mono text-[11px] tracking-wide text-ink-2">已修通識向度</span>
        {GEN_ED_DIMENSIONS.map((dimension) => {
          const done = stats.genEdDimensions.has(dimension);
          return (
            <span
              key={dimension}
              title={`${dimension}：${GEN_ED_DIMENSION_LABELS[dimension]}${done ? '（已修）' : '（未修）'}`}
              className={`rounded-sm px-1.5 py-0.5 font-mono text-xs font-medium ${
                done ? 'bg-good/15 text-good' : 'bg-band text-ink-2'
              }`}
            >
              {dimension}
            </span>
          );
        })}
      </div>
    </section>
  );
}

function ratioOf(value: number, target: number): number {
  return target > 0 ? Math.min(100, Math.round((value / target) * 100)) : 0;
}

function Ledger({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-rule bg-sheet px-4 py-1">
      <h2 className="pt-2.5 font-mono text-xs tracking-[.14em] text-ink-3">{title}</h2>
      {children}
    </div>
  );
}

function LedgerRow({
  label,
  value,
  target,
  unit,
  squares,
}: {
  label: string;
  value: number;
  target: number;
  unit: string;
  squares?: boolean;
}) {
  const ratio = ratioOf(value, target);
  const done = value >= target;
  return (
    <div className="grid grid-cols-[5.5rem_minmax(0,1fr)_auto] items-center gap-x-3 border-t border-rule py-2.5 sm:gap-x-4">
      <div>
        <b className="block text-[13px] font-medium">{label}</b>
        <em className="block font-mono text-[11px] not-italic tabular-nums text-ink-2">{formatCredits(target)} {unit}</em>
      </div>
      {squares && target <= 12 && Number.isInteger(target) ? (
        <div className="flex gap-1">
          {Array.from({ length: target }, (_, index) => (
            <span
              key={index}
              className={`h-2.5 flex-1 rounded-[2px] ${index < Math.round(value) ? 'bg-good' : 'bg-band'}`}
            />
          ))}
        </div>
      ) : (
        <div className="h-1.5 overflow-hidden rounded-full bg-band">
          <div
            className={`h-1.5 rounded-full ${done ? 'bg-good' : 'bg-ink-2'}`}
            style={{ width: `${ratio}%` }}
          />
        </div>
      )}
      <div className="w-[4.5rem] whitespace-nowrap text-right font-mono text-[11px] tabular-nums text-ink-2">
        <strong className={`text-[15px] font-semibold ${done ? 'text-good' : 'text-ink'}`}>
          {formatCredits(value)}
        </strong>
        {' / '}
        {formatCredits(target)}
        <span className="ml-1.5 text-ink-3">{ratio}%</span>
      </div>
    </div>
  );
}

const GEN_ED_DIMENSIONS = ['A', 'B', 'C', 'D', 'E', 'F'] as const;
const GEN_ED_DIMENSION_LABELS: Record<string, string> = {
  A: '人文素養',
  B: '當代文明',
  C: '美感與人生探索',
  D: '社會與歷史文化',
  E: '群己與制度發展',
  F: '自然與生命科學',
};

function RecognitionRequirementsPanel({
  data,
  onAddRecognitionRequirement,
  onDeleteRecognitionRequirement,
}: {
  data: AppData;
  onAddRecognitionRequirement: (draft: RecognitionRequirementDraft) => void;
  onDeleteRecognitionRequirement: (requirementId: string) => void;
}) {
  const [program, setProgram] = useState<RecognitionRequirementDraft['program']>('double_major');
  const [kind, setKind] = useState<RequirementKind>('course');
  const [title, setTitle] = useState('');
  const [courseNamesText, setCourseNamesText] = useState('');
  const [courseCodePrefix, setCourseCodePrefix] = useState('');
  const [requiredCreditsText, setRequiredCreditsText] = useState('');
  const recognitionRequirements = data.pendingRequirements.filter((requirement) => (
    requirement.setId === DOUBLE_MAJOR_RECOGNITION_SET_ID || requirement.setId === MINOR_RECOGNITION_SET_ID
  ));
  const doubleMajorRequirements = recognitionRequirements.filter((requirement) => requirement.setId === DOUBLE_MAJOR_RECOGNITION_SET_ID);
  const minorRequirements = recognitionRequirements.filter((requirement) => requirement.setId === MINOR_RECOGNITION_SET_ID);

  const addRequirement = () => {
    const normalizedTitle = title.trim();
    if (!normalizedTitle) return;
    const courseNames = courseNamesText
      .split(/[／/、,，\n]/)
      .map((item) => item.trim())
      .filter(Boolean);
    const requiredCredits = Number(requiredCreditsText);
    onAddRecognitionRequirement({
      program,
      kind,
      title: normalizedTitle,
      requiredCredits: Number.isFinite(requiredCredits) && requiredCredits > 0 ? requiredCredits : null,
      courseNames: courseNames.length > 0 ? courseNames : kind === 'credit_pool' ? [] : [normalizedTitle],
      courseCodePrefix: courseCodePrefix.trim().toUpperCase() || null,
      note: kind === 'credit_pool' ? '自訂學分池認列' : '自訂課程認列',
    });
    setTitle('');
    setCourseNamesText('');
    setCourseCodePrefix('');
    setRequiredCreditsText('');
  };

  const field = 'mt-1 w-full rounded-sm border border-rule bg-sheet px-3 py-2 text-sm focus:border-ink-2';
  const fieldLabel = 'block font-mono text-[11px] tracking-wide text-ink-3';

  return (
    <section className="space-y-3">
      <div>
        <p className="font-mono text-[11px] tracking-[.14em] text-ink-2">雙主修 / 輔系認列</p>
        <h2 className="mt-0.5 text-[15px] font-bold">自訂必修、選修與學分池</h2>
        <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-ink-2">
          用課名或課碼前綴比對歷史修課與未來規劃；這裡只做認列檢查，不會送出官方選課。
        </p>
      </div>

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
        <div className="rounded-lg border border-rule bg-paper p-4">
          <h3 className="font-mono text-xs tracking-[.14em] text-ink-2">新增認列規則</h3>
          <div className="mt-3 space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <label>
                <span className={fieldLabel}>歸屬</span>
                <select
                  value={program}
                  onChange={(event) => setProgram(event.target.value as RecognitionRequirementDraft['program'])}
                  className={field}
                >
                  <option value="double_major">雙主修</option>
                  <option value="minor">輔系</option>
                </select>
              </label>
              <label>
                <span className={fieldLabel}>類型</span>
                <select
                  value={kind}
                  onChange={(event) => setKind(event.target.value as RequirementKind)}
                  className={field}
                >
                  <option value="course">必修課程</option>
                  <option value="choice">多選一</option>
                  <option value="credit_pool">選修學分池</option>
                </select>
              </label>
            </div>
            <label>
              <span className={fieldLabel}>規則名稱</span>
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="例如 資料結構 或 資工系選修"
                className={field}
              />
            </label>
            <label>
              <span className={fieldLabel}>可認列課名</span>
              <input
                value={courseNamesText}
                onChange={(event) => setCourseNamesText(event.target.value)}
                placeholder="多門可用 、 或換行分隔；空白時用規則名稱"
                className={field}
              />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label>
                <span className={fieldLabel}>課碼前綴</span>
                <input
                  value={courseCodePrefix}
                  onChange={(event) => setCourseCodePrefix(event.target.value)}
                  placeholder="例如 CS"
                  className={`${field} uppercase`}
                />
              </label>
              <label>
                <span className={fieldLabel}>需求學分</span>
                <input
                  value={requiredCreditsText}
                  onChange={(event) => setRequiredCreditsText(event.target.value)}
                  inputMode="decimal"
                  placeholder="例如 3 或 20"
                  className={field}
                />
              </label>
            </div>
            <button
              type="button"
              onClick={addRequirement}
              disabled={!title.trim()}
              className="w-full rounded-sm bg-ink px-3 py-2 text-sm font-medium text-sheet hover:bg-ink-2 disabled:cursor-not-allowed disabled:bg-ink-3 disabled:hover:bg-ink-3"
            >
              新增規則
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
          <RecognitionRequirementList
            title="雙主修"
            requirements={doubleMajorRequirements}
            data={data}
            onDeleteRecognitionRequirement={onDeleteRecognitionRequirement}
          />
          <RecognitionRequirementList
            title="輔系"
            requirements={minorRequirements}
            data={data}
            onDeleteRecognitionRequirement={onDeleteRecognitionRequirement}
          />
        </div>
      </div>
    </section>
  );
}

function RecognitionRequirementList({
  title,
  requirements,
  data,
  onDeleteRecognitionRequirement,
}: {
  title: string;
  requirements: PendingRequirement[];
  data: AppData;
  onDeleteRecognitionRequirement: (requirementId: string) => void;
}) {
  return (
    <div className="rounded-lg border border-rule bg-sheet">
      <div className="flex items-baseline justify-between border-b border-rule px-4 py-3">
        <h3 className="text-[13px] font-bold">{title}</h3>
        <span className="font-mono text-[11px] tracking-wide tabular-nums text-ink-2">{requirements.length} 項</span>
      </div>
      {requirements.length === 0 ? (
        <p className="m-4 rounded-sm border border-dashed border-rule px-4 py-6 text-center text-[13px] text-ink-2">尚未設定認列規則。</p>
      ) : (
        <ul className="flex flex-col">
          {requirements.map((requirement) => (
            <li key={requirement.id} className="border-t border-rule first:border-t-0">
              <RecognitionRequirementCard
                requirement={requirement}
                data={data}
                onDelete={() => onDeleteRecognitionRequirement(requirement.id)}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RecognitionRequirementCard({
  requirement,
  data,
  onDelete,
}: {
  requirement: PendingRequirement;
  data: AppData;
  onDelete: () => void;
}) {
  const status = getRequirementStatus(requirement, data);
  const matchedCourses = matchedRecognitionCourses(requirement, data);
  const targetCredits = status.targetCredits || requirement.requiredCredits || requirement.credits || 0;
  const ratio = targetCredits > 0 ? Math.min(100, Math.round((status.earnedCredits / targetCredits) * 100)) : status.completed ? 100 : 0;
  const kindLabel = requirement.kind === 'credit_pool' ? '學分池' : requirement.kind === 'choice' ? '多選一' : '課程';
  return (
    <div className="flex items-start gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <b className="text-sm font-medium">{requirement.title}</b>
          <span className="font-mono text-[11px] tracking-wide text-ink-2">{kindLabel}</span>
          <span className={`font-mono text-[11px] tracking-wide ${status.completed ? 'text-good' : 'font-semibold text-ink'}`}>
            {status.completed ? '已滿足或已規劃' : '尚缺'}
          </span>
        </div>
        <p className="mt-0.5 font-mono text-[11px] tracking-wide text-ink-2">
          {formatCredits(status.earnedCredits)} / {formatCredits(targetCredits)} 學分
          {requirement.courseCodePrefix ? `・課碼 ${requirement.courseCodePrefix}` : ''}
          {requirement.courseNames.length > 0 ? `・${requirement.courseNames.join('、')}` : ''}
        </p>
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-band">
          <div
            className={`h-1 rounded-full ${status.completed ? 'bg-good' : 'bg-ink-2'}`}
            style={{ width: `${ratio}%` }}
          />
        </div>
        {matchedCourses.length > 0 ? (
          <ul className="mt-2 flex flex-wrap gap-1">
            {matchedCourses.map((label) => (
              <li key={label} className="rounded-sm bg-band px-1.5 py-0.5 font-mono text-[10px] text-ink-2">{label}</li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 font-mono text-[11px] text-ink-2">尚未匹配到歷史修課或未來規劃。</p>
        )}
      </div>
      <button
        type="button"
        onClick={onDelete}
        className="shrink-0 rounded-sm border border-rule px-2 py-1 font-mono text-[11px] text-ink-2 hover:border-mark hover:text-mark"
        title="刪除認列規則"
        aria-label={`刪除認列規則：${requirement.title}`}
      >
        刪除
      </button>
    </div>
  );
}

function matchedRecognitionCourses(requirement: PendingRequirement, data: AppData): string[] {
  const candidateNames = new Set(requirement.courseNames.map(normalizeName));
  const candidateCodePrefix = requirement.courseCodePrefix?.trim().toUpperCase() || '';
  const labels = new Set<string>();
  const plannedCourses = [
    ...data.semesters.flatMap((semester) => semester.courses),
    ...(data.selectionPlan?.courses || []),
  ];

  plannedCourses.forEach((course) => {
    const code = course.scheduledOffering?.courseNo?.trim().toUpperCase() || '';
    const matchedBySource = course.sourceRequirementId === requirement.id;
    const matchedByName = candidateNames.has(normalizeName(course.name));
    const matchedByPrefix = Boolean(candidateCodePrefix && code.startsWith(candidateCodePrefix));
    if (matchedBySource || matchedByName || matchedByPrefix) {
      labels.add(`規劃：${course.name}`);
    }
  });

  (data.historyRecords || []).forEach((record) => {
    if (record.status === 'failed') return;
    const matchedByName = candidateNames.has(normalizeName(record.courseName));
    const matchedByPrefix = Boolean(candidateCodePrefix && record.courseCode.toUpperCase().startsWith(candidateCodePrefix));
    if (matchedByName || matchedByPrefix) {
      labels.add(`歷史：${record.courseName}`);
    }
  });

  return Array.from(labels);
}
