import { useEffect, useState } from 'react';
import { RefreshCw, Settings } from 'lucide-react';
import type { AppData } from '../../types';

type SettingsPageProps = {
  initialSettings: AppData['targets'];
  syncStatus: 'idle' | 'loading' | 'error' | 'success';
  syncMessage: string;
  onSaveTargets: (targets: AppData['targets']) => void;
  onOpenSchoolSync: () => void;
};

export function SettingsPage({
  initialSettings,
  syncStatus,
  syncMessage,
  onSaveTargets,
  onOpenSchoolSync,
}: SettingsPageProps) {
  const [settingsForm, setSettingsForm] = useState(initialSettings);

  useEffect(() => {
    setSettingsForm(initialSettings);
  }, [initialSettings]);

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-blue-600">設定</p>
            <h1 className="mt-1 text-2xl font-semibold text-slate-950">資料同步與畢業門檻</h1>
            <p className="mt-1 text-sm text-slate-500">校務資料同步與學分門檻集中放在這裡，課程查詢頁只保留查詢與加入待選流程。</p>
          </div>
          <button
            onClick={onOpenSchoolSync}
            className="inline-flex items-center justify-center gap-2 rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            <RefreshCw className="h-4 w-4" />
            同步校務資料
          </button>
        </div>
        {syncMessage && (
          <p className={`mt-4 rounded-md px-3 py-2 text-sm ${
            syncStatus === 'error' ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'
          }`}>
            {syncMessage}
          </p>
        )}
      </section>

      <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-4">
          <Settings className="h-4 w-4 text-blue-600" />
          <h2 className="text-base font-semibold text-slate-900">設定畢業門檻</h2>
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSaveTargets(settingsForm);
          }}
          className="space-y-5 p-5"
        >
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <NumberField
              label="畢業總學分"
              value={settingsForm.total}
              onChange={(value) => setSettingsForm({ ...settingsForm, total: value })}
              wide
            />
            <NumberField
              label="必修國文"
              value={settingsForm.chinese}
              onChange={(value) => setSettingsForm({ ...settingsForm, chinese: value })}
            />
            <NumberField
              label="共同必修英文"
              value={settingsForm.english}
              onChange={(value) => setSettingsForm({ ...settingsForm, english: value })}
            />
            <NumberField
              label="通識學分"
              value={settingsForm.gen_ed}
              onChange={(value) => setSettingsForm({ ...settingsForm, gen_ed: value })}
            />
            <NumberField
              label="社會實踐"
              value={settingsForm.social}
              onChange={(value) => setSettingsForm({ ...settingsForm, social: value })}
            />
            <NumberField
              label="體育（學期數）"
              value={settingsForm.pe_semesters}
              onChange={(value) => setSettingsForm({ ...settingsForm, pe_semesters: value })}
              wide
            />
          </div>

          <div className="border-t border-slate-100 pt-5">
            <h3 className="mb-3 text-sm font-semibold text-slate-700">系所課程門檻</h3>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <NumberField
                label="本系必修"
                value={settingsForm.home_compulsory}
                onChange={(value) => setSettingsForm({ ...settingsForm, home_compulsory: value })}
              />
              <NumberField
                label="本系選修"
                value={settingsForm.home_elective}
                onChange={(value) => setSettingsForm({ ...settingsForm, home_elective: value })}
              />
              <NumberField
                label="雙主修"
                value={settingsForm.double_major}
                onChange={(value) => setSettingsForm({ ...settingsForm, double_major: value })}
              />
              <NumberField
                label="輔修"
                value={settingsForm.minor}
                onChange={(value) => setSettingsForm({ ...settingsForm, minor: value })}
              />
            </div>
          </div>

          <div className="flex justify-end border-t border-slate-100 pt-5">
            <button
              type="submit"
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              儲存設定
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
  wide = false,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  wide?: boolean;
}) {
  return (
    <label className={wide ? 'md:col-span-2' : undefined}>
      <span className="block text-sm font-medium text-slate-700">{label}</span>
      <input
        type="number"
        min="0"
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
      />
    </label>
  );
}
