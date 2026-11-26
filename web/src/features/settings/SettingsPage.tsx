import { useEffect, useState, type ReactNode } from 'react';
import type {
  AppData,
  GpaApiKeyStatus,
  OfficialSelectionSyncResponse,
  ProgramDepartmentSettings,
  SchoolSyncStatus,
} from '../../shared/types';
import { listCourseDepartments } from '../../shared/domain/courseDepartments';

const EMPTY_PROGRAM_DEPARTMENT_SETTINGS: ProgramDepartmentSettings = {};
const COURSE_DEPARTMENTS = listCourseDepartments();

/** 新設計語言的表單元件樣式：底線式輸入、mono 小標。與課程查詢頁一致。 */
export const SETTINGS_FIELD_CLASS =
  'mt-0.5 w-full min-w-0 border-0 border-b border-rule bg-transparent px-0 py-1 text-sm text-ink outline-none placeholder:text-ink-3 focus:border-ink disabled:text-ink-3';
export const SETTINGS_LABEL_CLASS = 'block font-mono text-[10px] tracking-[.1em] text-ink-3';
export const SETTINGS_PRIMARY_BUTTON =
  'rounded-sm bg-accent px-4 py-1.5 text-[13px] font-medium text-sheet disabled:cursor-not-allowed disabled:opacity-45';
export const SETTINGS_SECONDARY_BUTTON =
  'rounded-sm border border-rule bg-sheet px-3 py-1.5 text-[13px] text-ink-2 hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:border-rule disabled:hover:text-ink-2';
export const SETTINGS_DANGER_BUTTON =
  'rounded-sm border border-rule bg-sheet px-3 py-1.5 text-[13px] text-ink-2 hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:border-rule disabled:hover:text-ink-2';

type SyncActivity = 'idle' | 'loading' | 'error' | 'success';

type SettingsPageProps = {
  initialSettings: AppData['targets'];
  schoolUsername: string;
  selectionTargetLabel: string;
  syncStatus: SyncActivity;
  syncMessage: string;
  schoolSync?: SchoolSyncStatus;
  officialSelection: OfficialSelectionSyncResponse | null;
  officialSelectionStatus: SyncActivity;
  officialSelectionMessage: string;
  gpaApiKeyStatus: GpaApiKeyStatus | null;
  initialProgramDepartmentSettings?: ProgramDepartmentSettings;
  onSaveTargets: (targets: AppData['targets']) => void;
  onSaveGpaApiKey: (apiKey: string, enabled: boolean) => Promise<void>;
  onDeleteGpaApiKey: () => Promise<void>;
  onSaveProgramDepartmentSettings: (settings: ProgramDepartmentSettings) => void;
  onOpenSchoolSync: (mode?: 'courses' | 'history') => void;
  onOpenOfficialSelectionSync: () => void;
  /** 選課監控與代理設定；由 app 層帶入，避免 settings 反向依賴 monitor。 */
  monitorSettings?: ReactNode;
};

/**
 * 設定：資料來源、畢業門檻、系所、GPA 密鑰、監控與通知、代理。
 *
 * 新設計語言版本。功能一項沒少，只是排成左主欄（要動手改的）＋右側欄（看狀態的）。
 */
export function SettingsPage({
  initialSettings,
  schoolUsername,
  selectionTargetLabel,
  syncStatus,
  syncMessage,
  schoolSync,
  officialSelection,
  officialSelectionStatus,
  officialSelectionMessage,
  gpaApiKeyStatus,
  initialProgramDepartmentSettings,
  onSaveTargets,
  onSaveGpaApiKey,
  onDeleteGpaApiKey,
  onSaveProgramDepartmentSettings,
  onOpenSchoolSync,
  onOpenOfficialSelectionSync,
  monitorSettings,
}: SettingsPageProps) {
  const [settingsForm, setSettingsForm] = useState(initialSettings);
  const [gpaApiKeyInput, setGpaApiKeyInput] = useState('');
  const [gpaEnabled, setGpaEnabled] = useState(gpaApiKeyStatus?.enabled ?? false);
  const [gpaSaving, setGpaSaving] = useState(false);
  const [gpaMessage, setGpaMessage] = useState('');
  const [programDepartmentForm, setProgramDepartmentForm] = useState<ProgramDepartmentSettings>({
    ...EMPTY_PROGRAM_DEPARTMENT_SETTINGS,
    ...initialProgramDepartmentSettings,
  });
  const [programDepartmentSaved, setProgramDepartmentSaved] = useState(false);
  const isTargetsDirty = JSON.stringify(settingsForm) !== JSON.stringify(initialSettings);
  const updateTarget = (key: keyof AppData['targets']) => (value: number) => {
    setSettingsForm((current) => ({ ...current, [key]: value }));
  };

  useEffect(() => {
    setSettingsForm(initialSettings);
  }, [initialSettings]);

  useEffect(() => {
    setGpaEnabled(gpaApiKeyStatus?.enabled ?? false);
  }, [gpaApiKeyStatus]);

  useEffect(() => {
    setProgramDepartmentForm({
      ...EMPTY_PROGRAM_DEPARTMENT_SETTINGS,
      ...initialProgramDepartmentSettings,
    });
  }, [initialProgramDepartmentSettings]);

  useEffect(() => {
    if (!programDepartmentSaved) return;
    const timer = window.setTimeout(() => setProgramDepartmentSaved(false), 2000);
    return () => window.clearTimeout(timer);
  }, [programDepartmentSaved]);

  const anySyncLoading = syncStatus === 'loading' || officialSelectionStatus === 'loading';
  const gpaState = gpaApiKeyStatus?.hasApiKey ? (gpaApiKeyStatus.enabled ? '已啟用' : '已保存・停用中') : '未設定';

  return (
    <div className="space-y-5">
      <section className="grid gap-x-8 gap-y-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
        <div>
          <p className="font-mono text-[11px] tracking-[.14em] text-ink-2">設定</p>
          <h1 className="mt-0.5 text-[19px] font-bold">資料來源、校務帳號與畢業門檻</h1>
          <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-ink-2">
            校務資料同步、畢業門檻數字、監控與通知等帳號層級設定集中放在這裡，不混進選課流程。
          </p>
        </div>
        <button
          type="button"
          onClick={() => onOpenSchoolSync('courses')}
          disabled={anySyncLoading}
          className={SETTINGS_PRIMARY_BUTTON}
        >
          {anySyncLoading ? '同步中…' : '同步校務資料'}
        </button>
      </section>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_292px]">
        <div className="min-w-0 space-y-4">
          {/* 資料來源：三份資料分開同步 */}
          <section className="overflow-hidden rounded-2xl bg-sheet shadow-card">
            <SheetHead title="資料來源" note="三份資料分開同步" />
            <ul>
              <SyncStatusRow
                title="目前選課"
                hint="ChooseList/D01・加退選期間這份就是最新課表"
                activity={syncStatus}
                message={syncMessage}
                summary={scheduleSummary(schoolSync)}
                onSync={() => onOpenSchoolSync('courses')}
              />
              <SyncStatusRow
                title="歷年成績"
                hint="StuScoreQuery・一學期更新一次就夠"
                activity={syncStatus}
                message={syncMessage}
                summary={historySummary(schoolSync)}
                onSync={() => onOpenSchoolSync('history')}
              />
              <SyncStatusRow
                title="初選志願登記"
                hint="First/A02・只有初選期間有資料，加退選期回 0 門是正常的"
                activity={officialSelectionStatus}
                message={officialSelectionMessage}
                summary={officialSelectionSummary(officialSelection)}
                onSync={onOpenOfficialSelectionSync}
              />
            </ul>
          </section>

          {/* 畢業門檻：一格一個數字 */}
          <section className="overflow-hidden rounded-2xl bg-sheet shadow-card">
            <form
              onSubmit={(event) => {
                event.preventDefault();
                onSaveTargets(settingsForm);
              }}
            >
              <SheetHead title="畢業門檻" note="依系所規定填，0 表示不適用">
                <span
                  aria-live="polite"
                  className={`font-mono text-[11px] ${isTargetsDirty ? 'text-mark' : 'text-ink-3'}`}
                >
                  {isTargetsDirty ? '有未儲存的變更' : '已儲存'}
                </span>
                <button type="submit" disabled={!isTargetsDirty} className={SETTINGS_PRIMARY_BUTTON}>
                  儲存門檻
                </button>
              </SheetHead>
              <p className="border-b border-rule px-4 py-1.5 font-mono text-[11px] text-ink-3">共同門檻・全校規定</p>
              <div className="grid grid-cols-2 gap-px border-b border-rule bg-rule sm:grid-cols-3 lg:grid-cols-6">
                <NumberField label="畢業總學分" unit="學分" value={settingsForm.total} onChange={updateTarget('total')} emphasis />
                <NumberField label="必修國文" unit="學分" value={settingsForm.chinese} onChange={updateTarget('chinese')} />
                <NumberField label="共同必修英文" unit="學分" value={settingsForm.english} onChange={updateTarget('english')} />
                <NumberField label="通識" unit="學分" value={settingsForm.gen_ed} onChange={updateTarget('gen_ed')} />
                <NumberField label="社會實踐" unit="學分" value={settingsForm.social} onChange={updateTarget('social')} />
                <NumberField label="體育" unit="學期" value={settingsForm.pe_semesters} onChange={updateTarget('pe_semesters')} />
              </div>
              <p className="border-b border-rule px-4 py-1.5 font-mono text-[11px] text-ink-3">系所門檻・依各系規定</p>
              <div className="grid grid-cols-2 gap-px bg-rule sm:grid-cols-4">
                <NumberField label="本系必修" unit="學分" value={settingsForm.home_compulsory} onChange={updateTarget('home_compulsory')} emphasis />
                <NumberField label="本系選修" unit="學分" value={settingsForm.home_elective} onChange={updateTarget('home_elective')} />
                <NumberField label="雙主修" unit="學分" value={settingsForm.double_major} onChange={updateTarget('double_major')} />
                <NumberField label="輔系" unit="學分" value={settingsForm.minor} onChange={updateTarget('minor')} />
              </div>
            </form>
          </section>

          {/* 雙主修與輔系系所 */}
          <section className="overflow-hidden rounded-2xl bg-sheet shadow-card">
            <form
              onSubmit={(event) => {
                event.preventDefault();
                onSaveProgramDepartmentSettings({
                  homeDepartmentCode: programDepartmentForm.homeDepartmentCode || undefined,
                  doubleMajorDepartmentCode: programDepartmentForm.doubleMajorDepartmentCode || undefined,
                  minorDepartmentCode: programDepartmentForm.minorDepartmentCode || undefined,
                });
                setProgramDepartmentSaved(true);
              }}
            >
              <SheetHead title="本系、雙主修與輔系" note="依課碼前兩碼判斷課程類別與顏色">
                <span className={`font-mono text-[11px] ${programDepartmentSaved ? 'text-good' : 'text-ink-3'}`}>
                  {programDepartmentSaved ? '已更新，會同步到資料庫' : '儲存後套用到課表與課程查詢'}
                </span>
                <button type="submit" className={SETTINGS_PRIMARY_BUTTON}>儲存系所</button>
              </SheetHead>
              <div className="grid grid-cols-1 gap-px bg-rule md:grid-cols-3">
                <DepartmentField
                  label="本系"
                  value={programDepartmentForm.homeDepartmentCode || ''}
                  onChange={(value) => setProgramDepartmentForm({ ...programDepartmentForm, homeDepartmentCode: value || undefined })}
                />
                <DepartmentField
                  label="雙主修"
                  value={programDepartmentForm.doubleMajorDepartmentCode || ''}
                  onChange={(value) => setProgramDepartmentForm({ ...programDepartmentForm, doubleMajorDepartmentCode: value || undefined })}
                />
                <DepartmentField
                  label="輔系"
                  value={programDepartmentForm.minorDepartmentCode || ''}
                  onChange={(value) => setProgramDepartmentForm({ ...programDepartmentForm, minorDepartmentCode: value || undefined })}
                />
              </div>
            </form>
          </section>

          {/* GPA 密鑰 */}
          <section className="overflow-hidden rounded-2xl bg-sheet shadow-card">
            <form
              onSubmit={async (event) => {
                event.preventDefault();
                const apiKey = gpaApiKeyInput.trim();
                if (!apiKey) {
                  setGpaMessage('請先貼上 API 密鑰。');
                  return;
                }
                setGpaSaving(true);
                setGpaMessage('');
                try {
                  await onSaveGpaApiKey(apiKey, gpaEnabled);
                  setGpaApiKeyInput('');
                  setGpaMessage('已保存到後端。');
                } catch (error) {
                  setGpaMessage(error instanceof Error ? error.message : '保存失敗');
                } finally {
                  setGpaSaving(false);
                }
              }}
            >
              <SheetHead title="GPA 查詢密鑰" note={`myNTUST・${gpaState}`}>
                <button
                  type="button"
                  disabled={!gpaApiKeyStatus?.hasApiKey || gpaSaving}
                  onClick={async () => {
                    setGpaSaving(true);
                    setGpaMessage('');
                    try {
                      await onDeleteGpaApiKey();
                      setGpaApiKeyInput('');
                      setGpaMessage('已刪除保存的密鑰。');
                    } catch (error) {
                      setGpaMessage(error instanceof Error ? error.message : '刪除失敗');
                    } finally {
                      setGpaSaving(false);
                    }
                  }}
                  className={SETTINGS_DANGER_BUTTON}
                >
                  刪除密鑰
                </button>
                <button type="submit" disabled={gpaSaving} className={SETTINGS_PRIMARY_BUTTON}>
                  {gpaSaving ? '處理中…' : '儲存密鑰'}
                </button>
              </SheetHead>
              <div className="grid grid-cols-1 gap-px bg-rule md:grid-cols-[minmax(0,1fr)_auto]">
                <div className="bg-sheet px-4 py-2.5">
                  <label className={SETTINGS_LABEL_CLASS} htmlFor="settings-gpa-key">
                    {gpaApiKeyStatus?.hasApiKey ? 'API 密鑰・留空則沿用已保存的' : 'API 密鑰'}
                  </label>
                  <input
                    id="settings-gpa-key"
                    type="password"
                    value={gpaApiKeyInput}
                    onChange={(event) => setGpaApiKeyInput(event.target.value)}
                    placeholder={gpaApiKeyStatus?.hasApiKey ? '••••••••（已保存）' : '貼上 myNTUST API token'}
                    className={`${SETTINGS_FIELD_CLASS} font-mono`}
                  />
                </div>
                <label className="flex items-center gap-2 bg-sheet px-4 py-2.5 text-[13px] text-ink-2">
                  <input
                    type="checkbox"
                    checked={gpaEnabled}
                    onChange={(event) => setGpaEnabled(event.target.checked)}
                    className="h-3 w-3 rounded-[2px] border-rule accent-ink"
                  />
                  啟用 GPA 查詢
                </label>
              </div>
              <p className="border-t border-rule px-4 py-2 text-xs leading-relaxed text-ink-3">
                啟用後課程查詢結果會附上該課的歷年 GPA。密鑰由後端加密保存，不回傳到瀏覽器；停用後保留密鑰但不再帶 GPA。
                {gpaMessage && <span className="ml-2 text-ink">{gpaMessage}</span>}
              </p>
            </form>
          </section>

          {monitorSettings}
        </div>

        <aside className="flex flex-col gap-4">
          <section>
            <h2 className="mb-2 font-mono text-xs tracking-[.14em] text-ink-3">校務帳號</h2>
            <div className="rounded-2xl bg-sheet p-4 shadow-card">
              <p className="font-mono text-xs text-ink-3">學號</p>
              <b className="mt-1 block text-[19px] font-bold">{schoolUsername.trim() || '尚未設定'}</b>
              <div className="mt-2 border-t border-rule pt-2.5 font-mono text-[11px] text-ink-3">
                推定選課目標 <span className="ml-2"><span className="text-ink">{selectionTargetLabel}</span></span>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" onClick={() => onOpenSchoolSync('courses')} className={SETTINGS_SECONDARY_BUTTON}>
                  設定／同步帳號
                </button>
              </div>
            </div>
          </section>

          <section>
            <h2 className="mb-2 font-mono text-xs tracking-[.14em] text-ink-3">說明</h2>
            <ul className="flex flex-col gap-2">
              <Note
                title="校務同步後端"
                sub="後端設定"
                body="課程查詢與校務同步需要連線至設定的後端。"
              />
              <Note
                title="門檻數字怎麼用"
                sub="畢業門檻頁"
                body="畢業門檻頁的進度分母就是這裡的數字；改完儲存就會重算，不會動到修課紀錄。"
              />
              <Note
                title="監聽參數在下面"
                sub="影響家裡那台電腦上的 Worker"
                body="監聽哪幾門課在「選課監控」頁管理；這裡只設節奏、時段、通知與代理。"
              />
            </ul>
          </section>
        </aside>
      </div>
    </div>
  );
}

export function SheetHead({ title, note, children }: { title: string; note?: string; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-rule px-4 py-3">
      <h2 className="text-[15px] font-bold">{title}</h2>
      {note && <span className="font-mono text-[11px] tracking-wide text-ink-3">{note}</span>}
      {children && <div className="ml-auto flex items-center gap-3">{children}</div>}
    </div>
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

type SyncSummary = { state: 'never' | 'fresh' | 'stale'; label: string; detail?: string };

function formatSyncStamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-TW', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
}

function scheduleSummary(schoolSync?: SchoolSyncStatus): SyncSummary {
  if (!schoolSync?.scheduleSyncedAt) return { state: 'never', label: '尚未同步' };
  return {
    state: 'fresh',
    label: formatSyncStamp(schoolSync.scheduleSyncedAt),
    detail: `${schoolSync.scheduleCourseCount ?? 0} 門課`,
  };
}

function historySummary(schoolSync?: SchoolSyncStatus): SyncSummary {
  if (!schoolSync?.historyImportedAt) return { state: 'never', label: '尚未同步' };
  return {
    state: 'fresh',
    label: formatSyncStamp(schoolSync.historyImportedAt),
    detail: `${schoolSync.historyRecordCount ?? 0} 筆`,
  };
}

function officialSelectionSummary(selection: OfficialSelectionSyncResponse | null): SyncSummary {
  if (!selection) return { state: 'never', label: '尚未同步' };
  const detail = `已登記 ${selection.registered_count} 門・待加入 ${selection.available_count} 門`;
  return selection.session_valid
    ? { state: 'fresh', label: `${formatSyncStamp(selection.synced_at)}・session 有效`, detail }
    : { state: 'stale', label: `快取 ${formatSyncStamp(selection.synced_at)}・session 已過期`, detail };
}

function SyncStatusRow({
  title,
  hint,
  activity,
  message,
  summary,
  onSync,
}: {
  title: string;
  hint: string;
  activity: SyncActivity;
  message: string;
  summary: SyncSummary;
  onSync: () => void;
}) {
  const tone = activity === 'error' || summary.state === 'stale'
    ? 'text-mark'
    : summary.state === 'fresh'
      ? 'text-ink-2'
      : 'text-ink-3';
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 border-t border-rule px-4 py-3 first:border-t-0 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
      <div className="min-w-0">
        <b className="block text-sm font-medium">{title}</b>
        <em className="block font-mono text-[10px] not-italic tracking-wide text-ink-3">{hint}</em>
        {message && (
          <span className={`mt-1 block text-xs leading-relaxed ${activity === 'error' ? 'text-mark' : 'text-ink-2'}`}>{message}</span>
        )}
      </div>
      <span className={`col-start-1 font-mono text-[11px] tabular-nums sm:col-start-auto sm:text-right ${tone}`}>
        {activity === 'loading' ? '同步中…' : summary.label}
        {summary.detail && <em className="block not-italic text-ink-3">{summary.detail}</em>}
      </span>
      <button
        type="button"
        onClick={onSync}
        disabled={activity === 'loading'}
        className={`col-start-2 row-start-1 sm:col-start-auto sm:row-start-auto ${SETTINGS_SECONDARY_BUTTON}`}
      >
        同步
      </button>
    </li>
  );
}

function DepartmentField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="bg-sheet px-4 py-2.5">
      <label className={SETTINGS_LABEL_CLASS}>{label}</label>
      <select value={value} onChange={(event) => onChange(event.target.value)} className={SETTINGS_FIELD_CLASS}>
        <option value="">未設定</option>
        {COURSE_DEPARTMENTS.map((department) => (
          <option key={department.code} value={department.code}>
            {department.code}・{department.name}
          </option>
        ))}
      </select>
    </div>
  );
}

/** 一格一個數字：小標在上、數字在下，單位貼在數字旁。 */
function NumberField({
  label,
  unit,
  value,
  onChange,
  emphasis = false,
}: {
  label: string;
  unit: string;
  value: number;
  onChange: (value: number) => void;
  emphasis?: boolean;
}) {
  return (
    <label className="block bg-sheet px-4 py-2.5">
      <span className={SETTINGS_LABEL_CLASS}>{label}</span>
      <span className="mt-0.5 flex items-baseline gap-1.5">
        <input
          type="number"
          inputMode="numeric"
          min="0"
          step="1"
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
          className={`w-16 border-0 border-b border-rule bg-transparent px-0 py-0.5 font-mono text-[17px] tabular-nums outline-none focus:border-ink ${
            emphasis ? 'font-semibold text-ink' : 'font-medium text-ink'
          }`}
        />
        <span className="text-xs text-ink-3">{unit}</span>
      </span>
    </label>
  );
}
