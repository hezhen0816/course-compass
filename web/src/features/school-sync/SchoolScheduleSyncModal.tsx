import { KeyRound, Loader2 } from 'lucide-react';

export function SchoolScheduleSyncModal({
  mode = 'school-data',
  username,
  password,
  status,
  message,
  onUsernameChange,
  onPasswordChange,
  onClose,
  onImport,
}: {
  mode?: 'school-data' | 'official-selection';
  username: string;
  password: string;
  status: 'idle' | 'loading' | 'error' | 'success';
  message: string;
  onUsernameChange: (username: string) => void;
  onPasswordChange: (password: string) => void;
  onClose: () => void;
  onImport: () => void;
}) {
  const isLoading = status === 'loading';
  const isOfficialSelection = mode === 'official-selection';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
      <div className="w-full max-w-md overflow-hidden rounded-lg bg-white shadow-xl">
        <div className="border-b border-slate-200 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-950">
                <KeyRound className="h-5 w-5 text-blue-600" />
                {isOfficialSelection ? '同步官方初選資料' : '同步校務資料'}
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                {isOfficialSelection
                  ? '讀取官方初選登記頁的待選、志願與功課表狀態，不會送出選課。'
                  : '取得最新選課清單、歷年成績，並自動補查可辨識的歷史節次。'}
              </p>
            </div>
            <button onClick={onClose} disabled={isLoading} className="rounded-md px-2 py-1 text-slate-500 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50">✕</button>
          </div>
        </div>
        <form
          className="space-y-4 p-4"
          onSubmit={(event) => {
            event.preventDefault();
            onImport();
          }}
        >
          <div>
            <label className="block text-sm font-medium text-slate-700">校務系統帳號</label>
            <input
              value={username}
              onChange={(event) => onUsernameChange(event.target.value)}
              disabled={isLoading}
              autoComplete="username"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-100"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700">校務系統密碼</label>
            <input
              type="password"
              value={password}
              onChange={(event) => onPasswordChange(event.target.value)}
              disabled={isLoading}
              autoComplete="current-password"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-100"
            />
            <p className="mt-1 text-xs text-slate-500">密碼僅用於本次同步，不會寫入雲端資料。</p>
          </div>
          <div className="rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-sm text-blue-800">
            <p className="font-medium">{isOfficialSelection ? '本次同步會讀取：' : '本次同步會更新：'}</p>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              {isOfficialSelection ? (
                <>
                  <li>官方初選待選清單</li>
                  <li>已登記志願序</li>
                  <li>官方功課表與選課清單快照</li>
                </>
              ) : (
                <>
                  <li>目前查詢學期的選課清單</li>
                  <li>歷年成績與已修紀錄</li>
                  <li>可辨識課程的歷史節次</li>
                </>
              )}
            </ul>
            <p className="mt-2 text-xs text-blue-700">不會自動送出選課、不會排程重試。</p>
          </div>
          {message && (
            <p className={`rounded-md px-3 py-2 text-sm ${status === 'error' ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>
              {message}
            </p>
          )}
          <div className="flex justify-end gap-2 border-t border-slate-200 pt-4">
            <button
              type="button"
              onClick={onClose}
              disabled={isLoading}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              關閉
            </button>
            <button
              type="submit"
              disabled={isLoading}
              className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
              {isLoading ? '同步中...' : isOfficialSelection ? '同步官方初選' : '開始同步'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
