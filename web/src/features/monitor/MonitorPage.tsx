import React, { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from './supabaseClient';
import { HEARTBEAT_TIMEOUT_MS } from './workerStatus';
import DashboardView from './DashboardView';
import CoursesView from './CoursesView';

// 監控設定與代理設定住在「設定」頁（SettingsPage 的 monitorSettings 插槽），
// 這裡只留「現在在監聽什麼」。
type MonitorTab = 'dashboard' | 'courses';

const tabs: Array<{ id: MonitorTab; label: string }> = [
  { id: 'dashboard', label: '儀表板' },
  { id: 'courses', label: '課程管理' },
];

/**
 * 全域 Worker 存活偵測的校正輪詢間隔（毫秒）。
 * 心跳本身靠 Realtime 推送，離線靠本地計時器（最後一次心跳後 HEARTBEAT_TIMEOUT_MS 翻成離線），
 * 輪詢只在 Realtime 掉線時補救，所以不必比心跳（60 秒）更密。
 * 每次輪詢對 Supabase 都是一個請求（約 1 KB egress），2026-09-18 免費額度就是被這類輪詢吃光的。
 */
const WORKER_POLL_MS = 60_000;

interface HeartbeatRow {
  type?: string;
  created_at?: string;
}

/** Worker 存活偵測：輪詢最新心跳 + Realtime 心跳訂閱（原 NTUST_Course_Monitor App.tsx） */
function useWorkerOnline(): boolean | null {
  // null = 尚未查過（避免進頁後先閃「伺服器已中斷」）
  const [workerOnline, setWorkerOnline] = useState<boolean | null>(null);
  const offlineTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** 記下一次心跳：標記在線，並排程在 timeout 後翻成離線（下一次心跳會重排）。 */
  const noteHeartbeat = useCallback((heartbeatAtMs: number) => {
    const age = Date.now() - heartbeatAtMs;
    if (offlineTimerRef.current) clearTimeout(offlineTimerRef.current);
    if (age >= HEARTBEAT_TIMEOUT_MS) {
      setWorkerOnline(false);
      return;
    }
    setWorkerOnline(true);
    offlineTimerRef.current = setTimeout(() => {
      setWorkerOnline(false);
    }, HEARTBEAT_TIMEOUT_MS - age);
  }, []);

  const checkWorkerAlive = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data } = await supabase
      .from('system_logs')
      .select('created_at')
      .eq('user_id', user.id)
      .eq('type', 'heartbeat')
      .order('created_at', { ascending: false })
      .limit(1);

    if (!data || data.length === 0) {
      setWorkerOnline(false);
      return;
    }
    noteHeartbeat(new Date(data[0].created_at).getTime());
  }, [noteHeartbeat]);

  useEffect(() => {
    // 首次立即檢查（以微任務排程，避免在 effect 內同步 setState）
    void Promise.resolve().then(checkWorkerAlive);
    const intervalId = setInterval(() => { void checkWorkerAlive(); }, WORKER_POLL_MS);

    // Realtime: 只訂閱本用戶 system_logs，避免跨使用者干擾
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (cancelled || !user) return;
      channel = supabase
        .channel(`app_heartbeat_${user.id}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'system_logs',
            filter: `user_id=eq.${user.id}`,
          },
          (payload) => {
            const row = payload.new as HeartbeatRow;
            if (row?.type === 'heartbeat') {
              noteHeartbeat(row.created_at ? new Date(row.created_at).getTime() : Date.now());
            }
          },
        )
        .subscribe();
    })();

    return () => {
      cancelled = true;
      clearInterval(intervalId);
      if (offlineTimerRef.current) clearTimeout(offlineTimerRef.current);
      if (channel) supabase.removeChannel(channel);
    };
  }, [checkWorkerAlive, noteHeartbeat]);

  return workerOnline;
}

/** 監聽引擎開關（user_settings.is_active，原 Sidebar.tsx） */
const EngineToggle: React.FC<{ workerOnline: boolean | null }> = ({ workerOnline }) => {
  const [isActive, setIsActive] = useState(false);
  const [toggling, setToggling] = useState(false);

  useEffect(() => {
    const fetchStatus = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from('user_settings')
        .select('is_active')
        .eq('user_id', user.id)
        .single();
      if (data) setIsActive(data.is_active ?? false);
    };
    void fetchStatus();

    const channel = supabase
      .channel('sidebar_settings')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'user_settings' }, () => {
        void fetchStatus();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  const handleToggle = async () => {
    setToggling(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const newValue = !isActive;
      const { error } = await supabase
        .from('user_settings')
        .upsert({ user_id: user.id, is_active: newValue, updated_at: new Date().toISOString() });
      if (error) throw error;
      setIsActive(newValue);
    } catch {
      // Dashboard will show the error
    } finally {
      setToggling(false);
    }
  };

  const label = isActive && workerOnline
    ? '監聽引擎運行中'
    : isActive && workerOnline === null
      ? '確認伺服器狀態…'
      : isActive
        ? '等待伺服器連線'
        : '監聽引擎已關閉';
  return (
    <div className="flex flex-wrap items-center gap-3">
      {isActive && workerOnline === false && (
        <span className="font-mono text-xs text-mark">伺服器已中斷</span>
      )}
      <button
        type="button"
        role="switch"
        aria-checked={isActive}
        onClick={() => { void handleToggle(); }}
        disabled={toggling}
        className="flex items-center gap-2.5 rounded-sm border border-rule bg-sheet px-3 py-1.5 text-[13px] disabled:opacity-60"
      >
        <span
          aria-hidden
          className={`h-2 w-2 rounded-full ${
            isActive && workerOnline ? 'bg-good' : isActive ? 'bg-mark' : 'bg-ink-3 opacity-40'
          }`}
        />
        <span className={isActive ? 'text-ink' : 'text-ink-2'}>{toggling ? '切換中…' : label}</span>
        <span className={`relative inline-flex h-4 w-7 items-center rounded-full border border-rule transition-colors ${isActive ? 'bg-accent' : 'bg-band'}`}>
          <span className={`inline-block h-3 w-3 transform rounded-full bg-sheet shadow-sm transition-transform ${isActive ? 'translate-x-3' : 'translate-x-0'}`} />
        </span>
      </button>
    </div>
  );
};

const WorkerBadge: React.FC<{ workerOnline: boolean | null }> = ({ workerOnline }) => (
  <span className={`inline-flex items-center gap-1.5 font-mono text-[11px] tracking-wide ${
    workerOnline === true ? 'text-good' : workerOnline === false ? 'text-mark' : 'text-ink-3'
  }`}>
    <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${
      workerOnline === true ? 'bg-good' : workerOnline === false ? 'bg-mark' : 'bg-ink-3 opacity-40'
    }`} />
    {workerOnline === true ? 'Worker 上線' : workerOnline === false ? 'Worker 離線' : 'Worker 狀態確認中'}
  </span>
);

export const MonitorPage: React.FC<{
  onGoToCourseSearch?: () => void;
  onGoToSettings?: () => void;
}> = ({ onGoToCourseSearch, onGoToSettings }) => {
  const [activeTab, setActiveTab] = useState<MonitorTab>('dashboard');
  const workerOnline = useWorkerOnline();

  return (
    <div className="space-y-5">
      <section className="grid gap-x-8 gap-y-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
        <div>
          <p className="font-mono text-[11px] tracking-[.14em] text-ink-2">選課監控</p>
          <div className="mt-0.5 flex flex-wrap items-baseline gap-x-3">
            <h1 className="text-[19px] font-bold">名額監聽</h1>
            <WorkerBadge workerOnline={workerOnline} />
          </div>
          <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-ink-2">
            監控課程名額需要啟動背景 Worker。
          </p>
        </div>
        <EngineToggle workerOnline={workerOnline} />
      </section>

      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex overflow-hidden rounded-sm border border-rule">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              aria-pressed={activeTab === tab.id}
              className={`whitespace-nowrap px-3 py-1 text-[13px] ${
                activeTab === tab.id ? 'bg-accent text-sheet' : 'text-ink-2 hover:text-ink'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        {onGoToSettings && (
          <button
            type="button"
            onClick={onGoToSettings}
            className="ml-auto text-[13px] text-ink-2 underline decoration-rule underline-offset-4 hover:text-ink hover:decoration-ink"
          >
            監聽參數在設定頁
          </button>
        )}
      </div>

      {activeTab === 'dashboard' && <DashboardView workerOnline={workerOnline === true} onGoToCourseSearch={onGoToCourseSearch} />}
      {activeTab === 'courses' && <CoursesView onGoToCourseSearch={onGoToCourseSearch} />}
    </div>
  );
};

export default MonitorPage;
