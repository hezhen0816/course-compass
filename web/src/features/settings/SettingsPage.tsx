import { useEffect, useState, type ReactNode } from 'react';
import { KeyRound, RefreshCw, Settings } from 'lucide-react';
import type { AppData, OfficialSelectionSyncResponse, SchoolSyncStatus } from '../../types';

type SyncActivity = 'idle' | 'loading' | 'error' | 'success';

type SettingsPageProps = {
  initialSettings: AppData['targets'];
  schoolUsername: string;
  selectionTargetLabel: string;
  hasSavedSchoolCredentials: boolean;
  syncStatus: SyncActivity;
  syncMessage: string;
  schoolSync?: SchoolSyncStatus;
  officialSelection: OfficialSelectionSyncResponse | null;
  officialSelectionStatus: SyncActivity;
  officialSelectionMessage: string;
  onSaveTargets: (targets: AppData['targets']) => void;
  onOpenSchoolSync: () => void;
  onOpenOfficialSelectionSync: () => void;
  onClearSavedSchoolCredentials: () => void;
};

export function SettingsPage({
  initialSettings,
  schoolUsername,
  selectionTargetLabel,
  hasSavedSchoolCredentials,
  syncStatus,
  syncMessage,
  schoolSync,
  officialSelection,
  officialSelectionStatus,
  officialSelectionMessage,
  onSaveTargets,
  onOpenSchoolSync,
  onOpenOfficialSelectionSync,
  onClearSavedSchoolCredentials,
}: SettingsPageProps) {
  const [settingsForm, setSettingsForm] = useState(initialSettings);
  const isDirty = JSON.stringify(settingsForm) !== JSON.stringify(initialSettings);

  useEffect(() => {
    setSettingsForm(initialSettings);
  }, [initialSettings]);

  const updateField = (key: keyof AppData['targets']) => (value: number) => {
    setSettingsForm((current) => ({ ...current, [key]: value }));
  };

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-blue-600">設定</p>
            <h1 className="mt-1 text-2xl font-semibold text-slate-950">資料同步與畢業門檻</h1>
            <p className="mt-1 text-sm text-slate-500">校務資料同步、畢業門檻數字與帳號層級設定集中放在這裡，不混進選課流程。</p>
          </div>
          <button
            onClick={onOpenSchoolSync}
            disabled={syncStatus === 'loading' || officialSelectionStatus === 'loading'}
            className="inline-flex items-center justify-center gap-2 self-start rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            <RefreshCw className={`h-4 w-4 ${syncStatus === 'loading' || officialSelectionStatus === 'loading' ? 'animate-spin' : ''}`} />
            同步校務資料
          </button>
        </div>

        {/* Per-source status rows with timestamps replace the free-text banners,
            so "did this actually sync, and when?" is answered at a glance. */}
        <div className="mt-4 divide-y divide-slate-100 rounded-md border border-slate-200">
          <SyncStatusRow
            title="課表與成績"
            activity={syncStatus}
            message={syncMessage}
            summary={scheduleSummary(schoolSync)}
            onSync={onOpenSchoolSync}
          />
          <SyncStatusRow
            title="官方初選"
            activity={officialSelectionStatus}
            message={officialSelectionMessage}
            summary={officialSelectionSummary(officialSelection)}
            onSync={onOpenOfficialSelectionSync}
          />
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-4 border-b border-slate-100 px-5 py-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-blue-600" />
              <h2 className="text-lg font-semibold text-slate-900">校務帳號與選課目標</h2>
            </div>
            <p className="mt-2 text-sm text-slate-500">
              校務帳號用來同步官方選課清單與歷年成績，並可由學號推定目前選課對應的大幾學期。
            </p>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 p-5 md:grid-cols-2">
          <InfoRow label="目前學號" value={schoolUsername.trim() || '尚未設定'} />
          <InfoRow label="推定選課目標" value={selectionTargetLabel} />
          <div className="flex flex-col gap-3 rounded-md border border-blue-200 bg-blue-50 px-3 py-3 text-sm text-blue-800 md:col-span-2 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="font-medium">
                {hasSavedSchoolCredentials ? '校務帳密已加密保存於資料庫。' : '尚未保存校務密碼。'}
              </p>
              <p className="mt-1 text-xs text-blue-700">
                {hasSavedSchoolCredentials
                  ? '官方 session 過期時，可直接重新同步官方初選，不必再輸入密碼。'
                  : '請在同步視窗勾選保存並成功同步一次，之後官方 session 過期才可直接重新同步。'}
              </p>
            </div>
            <button
              type="button"
              onClick={onClearSavedSchoolCredentials}
              disabled={!hasSavedSchoolCredentials}
              className="inline-flex justify-center rounded-md border border-blue-300 bg-white px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400"
            >
              清除保存密碼
            </button>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSaveTargets(settingsForm);
          }}
        >
          <div className="flex items-center justify-between gap-4 border-b border-slate-100 px-5 py-4">
            <div className="flex items-center gap-2">
              <Settings className="h-4 w-4 text-blue-600" />
              <h2 className="text-lg font-semibold text-slate-900">設定畢業門檻</h2>
            </div>
            <div className="flex items-center gap-3">
              <span
                aria-live="polite"
                className={`text-xs ${isDirty ? 'font-medium text-amber-700' : 'text-slate-400'}`}
              >
                {isDirty ? '有未儲存的變更' : '已儲存'}
              </span>
              <button
                type="submit"
                disabled={!isDirty}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
              >
                儲存設定
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 divide-y divide-slate-100 lg:grid-cols-2 lg:divide-x lg:divide-y-0">
            <ThresholdGroup title="共同畢業門檻" hint="全校共同規定的學分與學期數">
              <NumberField label="畢業總學分" unit="學分" value={settingsForm.total} onChange={updateField('total')} emphasis />
              <NumberField label="必修國文" unit="學分" value={settingsForm.chinese} onChange={updateField('chinese')} />
              <NumberField label="共同必修英文" unit="學分" value={settingsForm.english} onChange={updateField('english')} />
              <NumberField label="通識學分" unit="學分" value={settingsForm.gen_ed} onChange={updateField('gen_ed')} />
              <NumberField label="社會實踐" unit="學分" value={settingsForm.social} onChange={updateField('social')} />
              <NumberField label="體育" unit="學期" value={settingsForm.pe_semesters} onChange={updateField('pe_semesters')} />
            </ThresholdGroup>
            <ThresholdGroup title="系所課程門檻" hint="依系所規定填寫，0 表示不適用">
              <NumberField label="本系必修" unit="學分" value={settingsForm.home_compulsory} onChange={updateField('home_compulsory')} emphasis />
              <NumberField label="本系選修" unit="學分" value={settingsForm.home_elective} onChange={updateField('home_elective')} />
              <NumberField label="雙主修" unit="學分" value={settingsForm.double_major} onChange={updateField('double_major')} />
              <NumberField label="輔修" unit="學分" value={settingsForm.minor} onChange={updateField('minor')} />
            </ThresholdGroup>
          </div>
        </form>
      </section>
    </div>
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
  const parts = [`${schoolSync.scheduleCourseCount ?? 0} 門課`];
  if (schoolSync.historyImportedAt) parts.push(`歷年紀錄 ${schoolSync.historyRecordCount ?? 0} 筆`);
  return { state: 'fresh', label: `上次同步 ${formatSyncStamp(schoolSync.scheduleSyncedAt)}`, detail: parts.join(' · ') };
}

function officialSelectionSummary(selection: OfficialSelectionSyncResponse | null): SyncSummary {
  if (!selection) return { state: 'never', label: '尚未同步' };
  const detail = `已登記 ${selection.registered_count} 門 · 待加入 ${selection.available_count} 門`;
  return selection.session_valid
    ? { state: 'fresh', label: `上次同步 ${formatSyncStamp(selection.synced_at)} · session 有效`, detail }
    : { state: 'stale', label: `快取 ${formatSyncStamp(selection.synced_at)} · session 已過期`, detail };
}

function SyncStatusRow({
  title,
  activity,
  message,
  summary,
  onSync,
}: {
  title: string;
  activity: SyncActivity;
  message: string;
  summary: SyncSummary;
  onSync: () => void;
}) {
  const dotClass = activity === 'loading'
    ? 'bg-blue-500 animate-pulse'
    : activity === 'error'
      ? 'bg-red-500'
      : summary.state === 'fresh'
        ? 'bg-emerald-500'
        : summary.state === 'stale'
          ? 'bg-amber-500'
          : 'bg-slate-300';
  return (
    <div className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${dotClass}`} />
          <span className="text-sm font-semibold text-slate-900">{title}</span>
          <span className={`text-xs ${summary.state === 'stale' ? 'text-amber-700' : 'text-slate-500'}`}>{summary.label}</span>
        </div>
        {summary.detail && <p className="mt-0.5 pl-4 text-xs text-slate-500">{summary.detail}</p>}
        {message && (
          <p className={`mt-1 pl-4 text-xs ${activity === 'error' ? 'text-red-700' : 'text-slate-600'}`}>{message}</p>
        )}
      </div>
      <button
        type="button"
        onClick={onSync}
        disabled={activity === 'loading'}
        className="shrink-0 self-start text-sm font-medium text-blue-700 hover:underline disabled:cursor-not-allowed disabled:text-slate-400"
      >
        {activity === 'loading' ? '同步中…' : '同步'}
      </button>
    </div>
  );
}

function ThresholdGroup({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <fieldset className="min-w-0 px-5 py-4">
      <legend className="float-left mb-3 w-full">
        <span className="block text-sm font-semibold text-slate-800">{title}</span>
        <span className="mt-0.5 block text-xs text-slate-500">{hint}</span>
      </legend>
      {/* Cap row width so the value sits near its label instead of drifting to the far edge on wide screens. */}
      <div className="clear-both max-w-md divide-y divide-slate-100">{children}</div>
    </fieldset>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-semibold text-slate-900">{value}</p>
    </div>
  );
}

// A compact "label · value unit" row: the number is the subject, so the input
// is only as wide as a 3-digit figure instead of stretching across the card.
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
    <label className="flex items-center justify-between gap-4 py-2">
      <span className={`text-sm ${emphasis ? 'font-semibold text-slate-900' : 'text-slate-700'}`}>{label}</span>
      <span className="flex items-baseline gap-2">
        <input
          type="number"
          inputMode="numeric"
          min="0"
          step="1"
          value={value}
          onChange={(event) => onChange(Number(event.target.value))}
          className={`w-20 rounded-md border border-slate-300 px-2 py-1.5 text-right text-sm tabular-nums outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 ${
            emphasis ? 'font-semibold text-slate-900' : 'text-slate-800'
          }`}
        />
        <span className="w-8 text-xs text-slate-500">{unit}</span>
      </span>
    </label>
  );
}
