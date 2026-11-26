import { useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { SETTINGS_DANGER_BUTTON, SETTINGS_FIELD_CLASS, SETTINGS_LABEL_CLASS, SETTINGS_PRIMARY_BUTTON, SETTINGS_SECONDARY_BUTTON } from '../settings/SettingsPage';
import type { AppData, PendingRequirement, PlannerStats } from '../../shared/types';
import { formatCredits, getRequirementStatus } from '../../shared/domain/planner';

/** 需求列上可就地改的欄位：認列靠這兩個，不再是獨立的「認列規則」。 */
export type RequirementEdit = {
  courseNames: string[];
  courseCodePrefix: string | null;
};

type ThresholdsPageProps = {
  data: AppData;
  stats: PlannerStats;
  onUpdateRequirement: (requirementId: string, edit: RequirementEdit) => void;
  /** 回傳錯誤訊息；空字串＝已開啟匯入預覽。 */
  onImportRequirementsPdf: (file: File) => Promise<string>;
  onDeleteRequirementSet: (setId: string) => void;
};

/**
 * 畢業門檻：門檻完成度 ＋ 應修科目表需求。
 *
 * 從「修課軌跡 / 畢業進度」拆出來的那一半。數字一律沿用 `usePlannerStats`，
 * 不在這裡重算，否則拆頁就會改到使用者原本看到的進度。
 */
export function ThresholdsPage({
  data,
  stats,
  onUpdateRequirement,
  onImportRequirementsPdf,
  onDeleteRequirementSet,
}: ThresholdsPageProps) {
  return (
    <div className="space-y-5">
      <GraduationProgressPanel data={data} stats={stats} />
      <RequirementSetsPanel
        data={data}
        onImport={onImportRequirementsPdf}
        onDelete={onDeleteRequirementSet}
        onUpdateRequirement={onUpdateRequirement}
      />
    </div>
  );
}

/**
 * 應修科目表：從學校 PDF 匯入雙主修／輔系的必修、擇一與選修學分池。
 * 匯進來的需求會出現在選課工作台的待修清單與多學期規劃；這裡只管匯入與刪除。
 */
function RequirementSetsPanel({
  data,
  onImport,
  onDelete,
  onUpdateRequirement,
}: {
  data: AppData;
  onImport: (file: File) => Promise<string>;
  onDelete: (setId: string) => void;
  onUpdateRequirement: (requirementId: string, edit: RequirementEdit) => void;
}) {
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  // 以前「認列規則」是兩個寫死 id 的 manual 需求集，只在專屬面板顯示。面板拆掉後
  // 它們就是一般需求集，跟 PDF 匯入的並列，舊資料不會憑空消失。
  // 但空的 manual 集不列：待修清單那兩個（雙主修待修／輔系待修）由課程查詢維護，
  // 沒有內容時出現在「應修科目表」只會讓人以為匯入壞了。
  const sets = data.requirementSets.filter((set) => {
    if (set.source === 'system') return false;
    if (set.source === 'pdf') return true;
    return data.pendingRequirements.some((requirement) => requirement.setId === set.id);
  });

  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError('');
    const message = await onImport(file);
    setBusy(false);
    setError(message);
    if (fileInput.current) fileInput.current.value = '';
  };

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[11px] tracking-[.14em] text-ink-2">應修科目表</p>
          <h2 className="mt-0.5 text-[15px] font-bold">雙主修、輔系要修哪些課</h2>
          <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-ink-2">
            把學校公告的應修科目表 PDF 匯進來，必修、擇一、選修學分池會變成待修需求，多學期規劃就能拿去排。
            一份 PDF 有幾個系所的表就匯幾組。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={fileInput}
            type="file"
            accept="application/pdf"
            className="hidden"
            onChange={(event) => void pick(event.target.files?.[0])}
          />
          <button type="button" onClick={() => fileInput.current?.click()} disabled={busy} className={SETTINGS_PRIMARY_BUTTON}>
            {busy ? <span className="inline-flex items-center gap-2"><Loader2 className="h-3.5 w-3.5 animate-spin" />解析中…</span> : '匯入 PDF'}
          </button>
        </div>
      </div>
      {error && <p className="text-[13px] text-mark">{error}</p>}
      {sets.length === 0 ? (
        <p className="rounded-lg border border-dashed border-rule px-4 py-5 text-center text-[13px] text-ink-3">
          還沒匯入任何應修科目表。
        </p>
      ) : (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {sets.map((set) => {
            const requirements = data.pendingRequirements.filter((requirement) => requirement.setId === set.id);
            const done = requirements.filter((requirement) => getRequirementStatus(requirement, data).completed).length;
            return (
              <li key={set.id} className="rounded-2xl bg-sheet shadow-card px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-[14px] font-medium">{set.name}</p>
                    <p className="mt-0.5 font-mono text-[11px] text-ink-2">
                      {[set.department, set.totalCredits ? `${formatCredits(set.totalCredits)} 學分` : '', `${requirements.length} 項需求・已完成 ${done}`]
                        .filter(Boolean)
                        .join('・')}
                    </p>
                  </div>
                  <button type="button" onClick={() => onDelete(set.id)} className={SETTINGS_DANGER_BUTTON}>移除</button>
                </div>
                <ul className="mt-2 flex flex-wrap gap-1">
                  {requirements.map((requirement) => {
                    const status = getRequirementStatus(requirement, data);
                    const editing = editingId === requirement.id;
                    return (
                      <li key={requirement.id}>
                        <button
                          type="button"
                          onClick={() => setEditingId(editing ? null : requirement.id)}
                          title={`${requirement.courseNames.join('、') || '尚未設定可認列課名'}（點一下改認列條件）`}
                          className={`rounded-[2px] border px-1.5 font-mono text-[10px] ${status.completed ? 'border-good text-good' : 'border-rule text-ink-2'} ${editing ? 'bg-band' : ''} hover:border-accent hover:text-accent`}
                        >
                          {requirement.title}
                          {requirement.kind !== 'credit_pool' && requirement.courseNames.length > 1 && (
                            <span className="ml-1 text-ink-3">擇一</span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
                {requirements.some((requirement) => requirement.id === editingId) && (
                  <RequirementEditor
                    requirement={requirements.find((requirement) => requirement.id === editingId) as PendingRequirement}
                    onSave={(edit) => {
                      onUpdateRequirement(editingId as string, edit);
                      setEditingId(null);
                    }}
                    onCancel={() => setEditingId(null)}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/**
 * 需求列的就地編輯：可認列課名與課碼前綴。
 *
 * 這是原本「新增認列規則」面板的替代品。差別在於它掛在一條真實需求上——
 * 認列的意思本來就是「這門課算進這條需求」，不該是另外憑空填一張表。
 */
function RequirementEditor({
  requirement,
  onSave,
  onCancel,
}: {
  requirement: PendingRequirement;
  onSave: (edit: RequirementEdit) => void;
  onCancel: () => void;
}) {
  const [courseNamesText, setCourseNamesText] = useState(requirement.courseNames.join('、'));
  const [prefix, setPrefix] = useState(requirement.courseCodePrefix || '');

  const save = () => {
    onSave({
      courseNames: courseNamesText
        .split(/[／/、,，\n]/)
        .map((item) => item.trim())
        .filter(Boolean),
      courseCodePrefix: prefix.trim().toUpperCase() || null,
    });
  };

  return (
    <div className="mt-2 space-y-2 border-t border-rule pt-2">
      <p className="font-mono text-[11px] text-ink-2">{requirement.title}</p>
      <div>
        <label className={SETTINGS_LABEL_CLASS}>可認列課名</label>
        <input
          value={courseNamesText}
          onChange={(event) => setCourseNamesText(event.target.value)}
          placeholder="多門可用 、 或換行分隔；寫多門即為擇一"
          className={SETTINGS_FIELD_CLASS}
        />
      </div>
      <div>
        <label className={SETTINGS_LABEL_CLASS}>課碼前綴</label>
        <input
          value={prefix}
          onChange={(event) => setPrefix(event.target.value)}
          placeholder="例如 MB；填了就連課碼開頭相符的也算"
          className={`${SETTINGS_FIELD_CLASS} font-mono`}
        />
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={save} className={SETTINGS_PRIMARY_BUTTON}>儲存</button>
        <button type="button" onClick={onCancel} className={SETTINGS_SECONDARY_BUTTON}>取消</button>
      </div>
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

      <div className={`grid items-start gap-4 ${common.length > 0 && program.length > 0 ? 'lg:grid-cols-2' : ''}`}>
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
    <div className="rounded-2xl bg-sheet shadow-card px-4 py-1">
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
