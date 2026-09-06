import { useEffect, useState, type ReactNode } from 'react';
import { KeyRound, RefreshCw, Settings } from 'lucide-react';
import type { AppData } from '../../types';

type SettingsPageProps = {
  initialSettings: AppData['targets'];
  schoolUsername: string;
  selectionTargetLabel: string;
  hasSavedSchoolCredentials: boolean;
  syncStatus: 'idle' | 'loading' | 'error' | 'success';
  syncMessage: string;
  officialSelectionStatus: 'idle' | 'loading' | 'error' | 'success';
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
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              onClick={onOpenSchoolSync}
              className="inline-flex items-center justify-center gap-2 rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              <RefreshCw className="h-4 w-4" />
              同步校務資料
            </button>
            <button
              onClick={onOpenOfficialSelectionSync}
              disabled={officialSelectionStatus === 'loading'}
              className="inline-flex items-center justify-center gap-2 rounded-md border border-blue-300 bg-white px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <RefreshCw className={`h-4 w-4 ${officialSelectionStatus === 'loading' ? 'animate-spin' : ''}`} />
              同步官方初選
            </button>
          </div>
        </div>
        {syncMessage && (
          <p className={`mt-4 rounded-md px-3 py-2 text-sm ${
            syncStatus === 'error' ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'
          }`}>
            {syncMessage}
          </p>
        )}
        {officialSelectionMessage && (
          <p className={`mt-3 rounded-md px-3 py-2 text-sm ${
            officialSelectionStatus === 'error' ? 'bg-red-50 text-red-700' : 'bg-blue-50 text-blue-700'
          }`}>
            官方初選：{officialSelectionMessage}
          </p>
        )}
      </section>

      <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-4 border-b border-slate-100 px-5 py-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-blue-600" />
              <h2 className="text-base font-semibold text-slate-900">校務帳號與選課目標</h2>
            </div>
            <p className="mt-2 text-sm text-slate-500">
              校務帳號用來同步官方選課清單與歷年成績，並可由學號推定目前選課對應的大幾學期。
            </p>
          </div>
          <button
            onClick={onOpenSchoolSync}
            className="inline-flex items-center justify-center gap-2 rounded-md border border-blue-300 px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-50"
          >
            <RefreshCw className="h-4 w-4" />
            設定 / 同步校務帳號
          </button>
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
              <h2 className="text-base font-semibold text-slate-900">設定畢業門檻</h2>
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

function ThresholdGroup({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <fieldset className="min-w-0 px-5 py-4">
      <legend className="float-left mb-3 w-full">
        <span className="block text-sm font-semibold text-slate-800">{title}</span>
        <span className="mt-0.5 block text-xs text-slate-500">{hint}</span>
      </legend>
      <div className="clear-both divide-y divide-slate-100">{children}</div>
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
