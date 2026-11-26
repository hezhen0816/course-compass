import { SETTINGS_FIELD_CLASS, SETTINGS_LABEL_CLASS, SETTINGS_PRIMARY_BUTTON, SETTINGS_SECONDARY_BUTTON } from '../settings/SettingsPage';

/**
 * 三個同步項目，按「多久會變」與「哪個階段才有意義」拆開：
 * - courses：選課清單與功課表（ChooseList/D01/D01），加退選期天天在動
 * - history：歷年成績（StuScoreQuery/DisplayAll），一學期才變一次，不必跟課表一起重抓
 * - preregistration：初選 A02 的已登記志願與志願序，只有初選期有值
 * 原本叫「官方選課狀態」不精確——加退選也是官方狀態；差別在階段與用途。
 */
export type SchoolSyncMode = 'courses' | 'history' | 'preregistration';

const SYNC_TABS: { mode: SchoolSyncMode; label: string; description: string }[] = [
  {
    mode: 'courses',
    label: '目前選課',
    description: '取得學校選課清單與功課表；加退選期這份就是最新課表。',
  },
  {
    mode: 'history',
    label: '歷年成績',
    description: '取得歷年成績與已修紀錄，並補查可辨識的歷史節次。一學期更新一次就夠。',
  },
  {
    mode: 'preregistration',
    label: '初選志願登記',
    description: '讀取初選已登記志願、待加入清單與志願序，不會送出選課。',
  },
];

export function SchoolScheduleSyncModal({
  mode = 'courses',
  username,
  password,
  phaseLabel,
  isPreregistrationPhase,
  status,
  message,
  onModeChange,
  onUsernameChange,
  onPasswordChange,
  onClose,
  onImport,
}: {
  mode?: SchoolSyncMode;
  username: string;
  password: string;
  /** 目前選課階段名稱，用來說明為什麼某個項目會是空的 */
  phaseLabel: string;
  isPreregistrationPhase: boolean;
  status: 'idle' | 'loading' | 'error' | 'success';
  message: string;
  onModeChange: (mode: SchoolSyncMode) => void;
  onUsernameChange: (username: string) => void;
  onPasswordChange: (password: string) => void;
  onClose: () => void;
  onImport: () => void;
}) {
  const isLoading = status === 'loading';
  const isPreregistration = mode === 'preregistration';
  const activeTab = SYNC_TABS.find((tab) => tab.mode === mode) ?? SYNC_TABS[0];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/35 p-4">
      <div className="w-full max-w-md overflow-hidden rounded-2xl bg-sheet shadow-card">
        <div className="border-b border-rule px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-mono text-[11px] tracking-[.14em] text-ink-3">校務系統</p>
              <h2 className="mt-0.5 text-[15px] font-bold">同步校務資料</h2>
            </div>
            <button type="button" onClick={onClose} disabled={isLoading} aria-label="關閉" className="rounded-sm border border-rule px-2 text-sm leading-6 text-ink-2 hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-45">×</button>
          </div>
          {/* One entry point, two jobs: the tab decides what the sync pulls. */}
          <div role="tablist" aria-label="同步項目" className="mt-3 inline-flex overflow-hidden rounded-sm border border-rule">
            {SYNC_TABS.map((tab) => {
              const isActive = tab.mode === mode;
              return (
                <button
                  key={tab.mode}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  disabled={isLoading}
                  onClick={() => onModeChange(tab.mode)}
                  className={`px-3 py-1 text-[13px] ${
                    isActive ? 'bg-accent text-sheet' : 'text-ink-2 hover:text-ink'
                  } disabled:cursor-not-allowed`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-[13px] leading-relaxed text-ink-2">{activeTab.description}</p>
        </div>
        <form
          className="space-y-4 px-4 py-4"
          onSubmit={(event) => {
            event.preventDefault();
            onImport();
          }}
        >
          <div>
            <label className={SETTINGS_LABEL_CLASS}>校務系統帳號</label>
            <input
              value={username}
              onChange={(event) => onUsernameChange(event.target.value)}
              disabled={isLoading}
              autoComplete="username"
              className={`${SETTINGS_FIELD_CLASS} font-mono`}
            />
          </div>
          <div>
            <label htmlFor="school-password" className={SETTINGS_LABEL_CLASS}>校務系統密碼</label>
            <input
              id="school-password"
              type="password"
              value={password}
              onChange={(event) => onPasswordChange(event.target.value)}
              disabled={isLoading}
              autoComplete="current-password"
              className={SETTINGS_FIELD_CLASS}
            />
          </div>
          {isPreregistration && !isPreregistrationPhase && (
            <div className="rounded-xl bg-mark-soft px-3 py-2 text-[13px] leading-relaxed">
              目前是「{phaseLabel}」，初選頁本來就會回 0 門，這不是同步失敗。要更新已選上的課請改用「目前選課」。
            </div>
          )}
          <div className="rounded-xl bg-paper px-3 py-2 text-[13px]">
            <p className="font-mono text-[11px] tracking-wide text-ink-3">{isPreregistration ? '本次同步會讀取' : '本次同步會更新'}</p>
            <ul className="mt-1 space-y-0.5 text-ink-2">
              {mode === 'courses' && (
                <>
                  <li>學校選課清單（目前選上的課）</li>
                  <li>官方功課表節次</li>
                </>
              )}
              {mode === 'history' && (
                <>
                  <li>歷年成績與已修紀錄</li>
                  <li>可辨識課程的歷史節次</li>
                  <li>待重修清單</li>
                </>
              )}
              {isPreregistration && (
                <>
                  <li>初選已登記志願與待加入清單</li>
                  <li>已登記志願序</li>
                  <li>初選功課表快照</li>
                </>
              )}
            </ul>
            <p className="mt-2 font-mono text-[11px] text-ink-3">不會自動送出選課、不會排程重試。</p>
          </div>
          {message && (
            <p className={`rounded-xl px-3 py-2 text-[13px] leading-relaxed ${status === 'error' ? 'bg-mark-soft text-mark' : 'bg-good/10 text-ink'}`}>
              {message}
            </p>
          )}
          <div className="flex justify-end gap-2 border-t border-rule pt-3">
            <button type="button" onClick={onClose} disabled={isLoading} className={SETTINGS_SECONDARY_BUTTON}>
              關閉
            </button>
            <button type="submit" disabled={isLoading} className={SETTINGS_PRIMARY_BUTTON}>
              {isLoading ? '同步中…' : `同步${activeTab.label}`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
