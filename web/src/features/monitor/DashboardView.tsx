import React, { useRef, useEffect, useState } from 'react';
import { supabase } from './supabaseClient';
import { HEARTBEAT_INTERVAL_MS, HEARTBEAT_TIMEOUT_MS } from './workerStatus';
import { formatDateTime } from './format';

/** public.worker_heartbeat_status() 的回傳列 */
interface WorkerHeartbeatStatus {
  online_since: string | null;
  last_heartbeat_at: string | null;
  last_message: string | null;
}

interface Log {
  id: number;
  time: string;
  type: string;
  message: string;
}



// Only surface the heartbeat when it is late; a healthy worker pings every 60s.
const HEARTBEAT_STALE_WARN_MS = HEARTBEAT_INTERVAL_MS;

// Mirrors MIN_CHECK_INTERVAL_SECONDS in backend/monitor/worker.py. The worker refuses
// to poll faster than this whatever user_settings says, so the stored number must be
// clamped here too or the label promises a pace the worker will not run.
const MIN_CHECK_INTERVAL_MS = 5000;

function formatIntervalSec(ms: number): string {
  const sec = ms / 1000;
  return Number.isInteger(sec) ? String(sec) : sec.toFixed(1);
}

/**
 * Mirrors _within_monitor_window() in backend/monitor/worker.py: a start later than
 * the end wraps past midnight (08:00-02:00 means until 2am the next day).
 * Uses the viewer's clock, so it is a label only - the worker decides for real.
 */
function withinMonitorWindow(window: { start: string; end: string }): boolean {
  const now = new Date();
  const current = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  if (window.start === window.end) return true;
  return window.start < window.end
    ? current >= window.start && current < window.end
    : current >= window.start || current < window.end;
}

function parseSchoolLatencyMs(message: string): number | null {
  const m = /延遲指標：學校系統\s*(\d+)ms/.exec(message);
  if (!m) return null;
  const value = Number(m[1]);
  return Number.isFinite(value) ? value : null;
}

interface DashboardCourse {
  id: string;
  course_code: string;
  course_name: string;
  status: string;
  current_enrolled: string;
  last_check_time: string;
}

interface ProxyInfo {
  enabled: boolean;
  type: string;
  host: string;
  port: string;
}

interface DashboardViewProps {
  workerOnline: boolean;
  onGoToCourseSearch?: () => void;
}

const STATUS_POLL_INTERVAL_MS = 60_000;
// 日誌主要靠 Realtime INSERT 推送；這個輪詢只在 Realtime 掉線時補漏，
// 每次都是一個 Supabase 請求（約 1 KB egress），不要比心跳（60 秒）更密。
const LOG_POLL_INTERVAL_MS = 60_000;
const LOG_COLUMNS = 'id, created_at, type, message';
const MAX_LOG_ROWS = 200;
/** 超過此毫秒未收到心跳即凍結運行時間顯示 */
const UPTIME_FREEZE_AFTER_MS = HEARTBEAT_TIMEOUT_MS;

const DashboardView: React.FC<DashboardViewProps> = ({ workerOnline, onGoToCourseSearch }) => {
  const logEndRef = useRef<HTMLDivElement>(null);
  const [logs, setLogs] = useState<Log[]>([]);
  const [courses, setCourses] = useState<DashboardCourse[]>([]);
  const [stats, setStats] = useState({ monitoringCount: 0, successCount: 0 });
  const workerStatus = workerOnline ? 'Online' : 'Offline';
  const [workerOnlineSince, setWorkerOnlineSince] = useState<Date | null>(null);
  const [uptimeText, setUptimeText] = useState<string>('');
  const [proxyInfo, setProxyInfo] = useState<ProxyInfo | null>(null);
  const [backendLatencyMs, setBackendLatencyMs] = useState<number | null>(null);
  const [schoolLatencyMs, setSchoolLatencyMs] = useState<number | null>(null);
  const [checkIntervalMs, setCheckIntervalMs] = useState<number | null>(null);
  /** 每日監控時段（HH:MM）；null = 全天監控。 */
  const [monitorWindow, setMonitorWindow] = useState<{ start: string; end: string } | null>(null);
  // 1s clock so "上次檢查 N 秒前" keeps moving between course refreshes.
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const currentUserIdRef = useRef<string | null>(null);
  /** 最後一次收到心跳的時間戳（毫秒） */
  const lastHeartbeatTimeRef = useRef<number>(0);
  const latestLogCreatedAtRef = useRef<string | null>(null);
  /** 防止 Realtime 心跳頻繁觸發 checkWorkerStatus 的節流標記 */
  const checkThrottleRef = useRef<boolean>(false);

  useEffect(() => {
    let logsChannel: ReturnType<typeof supabase.channel> | null = null;
    let coursesChannel: ReturnType<typeof supabase.channel> | null = null;
    let logPollInterval: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || cancelled) return;
      currentUserIdRef.current = user.id;

      fetchLogs();
      fetchStats();
      fetchCourses();

      logPollInterval = setInterval(() => {
        fetchNewLogs();
      }, LOG_POLL_INTERVAL_MS);

      logsChannel = supabase
        .channel(`dashboard_logs_${user.id}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'system_logs',
            filter: `user_id=eq.${user.id}`
          },
          (payload) => {
            const newLog = payload.new;
            const logTime = new Date(newLog.created_at);
            if (newLog.type === 'heartbeat') {
              lastHeartbeatTimeRef.current = Date.now();
              setBackendLatencyMs(0);
              const hbLatency = parseSchoolLatencyMs(newLog.message || '');
              if (hbLatency !== null) setSchoolLatencyMs(hbLatency);
              // 不直接設定 workerOnlineSince，改用 checkWorkerStatus 計算精確值
              if (!checkThrottleRef.current) {
                checkThrottleRef.current = true;
                checkWorkerStatus().finally(() => {
                  setTimeout(() => { checkThrottleRef.current = false; }, 10_000);
                });
              }
              return;
            }
            // 補漏輪詢可能已先把同一筆放進來，避免重複（也避免 React key 重複）
            setLogs(prev => prev.some(l => l.id === newLog.id) ? prev : [...prev, {
              id: newLog.id,
              time: formatDateTime(logTime),
              type: newLog.type,
              message: newLog.message
            }].slice(-MAX_LOG_ROWS));
            latestLogCreatedAtRef.current = newLog.created_at;
            const parsed = parseSchoolLatencyMs(newLog.message || '');
            if (parsed !== null) setSchoolLatencyMs(parsed);
            if (!checkThrottleRef.current) {
              checkThrottleRef.current = true;
              checkWorkerStatus().finally(() => {
                setTimeout(() => { checkThrottleRef.current = false; }, 10_000);
              });
            }
          }
        )
        .subscribe();

      coursesChannel = supabase
        .channel(`dashboard_courses_${user.id}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'monitored_courses',
            filter: `user_id=eq.${user.id}`
          },
          () => {
            fetchCourses();
            fetchStats();
          }
        )
        .subscribe();
    })();

    const statusInterval = setInterval(() => {
      checkWorkerStatus();
    }, STATUS_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      if (logsChannel) supabase.removeChannel(logsChannel);
      if (coursesChannel) supabase.removeChannel(coursesChannel);
      clearInterval(statusInterval);
      if (logPollInterval) clearInterval(logPollInterval);
    };
    // Mount-once subscription; fetch helpers below read refs, so re-running on their identity is unnecessary.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const checkWorkerStatus = async () => {
    if (!currentUserIdRef.current) return;

    // 上線起點（最後一次心跳斷層之後的第一筆）由資料庫算。
    // 前端自己掃心跳掃不到真正的起點：PostgREST 的 db-max-rows 是 1000 列，
    // 要 1500 筆也只拿得到 1000 筆，起點會卡在視窗邊界（約 17 小時）。
    const { data, error } = await supabase
      .rpc('worker_heartbeat_status', { p_timeout_seconds: HEARTBEAT_TIMEOUT_MS / 1000 })
      .maybeSingle<WorkerHeartbeatStatus>();

    if (error || !data || !data.last_heartbeat_at) {
      setWorkerOnlineSince(null);
      setBackendLatencyMs(null);
      return;
    }

    const latestTs = new Date(data.last_heartbeat_at).getTime();
    lastHeartbeatTimeRef.current = Math.max(lastHeartbeatTimeRef.current, latestTs);
    setBackendLatencyMs(Math.max(0, Date.now() - latestTs));
    // Worker embeds the latest school-API latency in the heartbeat message.
    const latestLatency = parseSchoolLatencyMs(data.last_message || '');
    if (latestLatency !== null) setSchoolLatencyMs(latestLatency);

    const isOnline = Date.now() - latestTs < HEARTBEAT_TIMEOUT_MS;
    if (!isOnline || !data.online_since) {
      setWorkerOnlineSince(null);
      return;
    }

    setWorkerOnlineSince(new Date(data.online_since));
  };

  // 當 App 層判定離線時，清除 onlineSince；上線時立即查詢正確的起始時間
  useEffect(() => {
    if (!workerOnline) {
      setWorkerOnlineSince(null);
      lastHeartbeatTimeRef.current = 0;
    } else {
      // 上線後立即取得精確的 workerOnlineSince
      checkWorkerStatus();
    }
  }, [workerOnline]);

  // Uptime counter — ticks every second while worker is online
  // 若長時間未收到心跳，凍結計時器避免顯示不實的持續增長
  useEffect(() => {
    if (workerStatus !== 'Online' || !workerOnlineSince) {
      setUptimeText('');
      return;
    }
    const formatDiff = (totalSec: number) => {
      const d = Math.floor(totalSec / 86400);
      const h = Math.floor((totalSec % 86400) / 3600);
      const m = Math.floor((totalSec % 3600) / 60);
      const s = totalSec % 60;
      if (d > 0) return `${d}天 ${h}時 ${m}分`;
      if (h > 0) return `${h}時 ${m}分 ${s}秒`;
      if (m > 0) return `${m}分 ${s}秒`;
      return `${s}秒`;
    };
    const tick = () => {
      const now = Date.now();
      const lastHB = lastHeartbeatTimeRef.current;
      // 若超過 UPTIME_FREEZE_AFTER_MS 未收到心跳，凍結在最後心跳時間
      const endTime = (lastHB > 0 && now - lastHB > UPTIME_FREEZE_AFTER_MS)
        ? lastHB
        : now;
      const diff = Math.max(0, Math.floor((endTime - workerOnlineSince.getTime()) / 1000));
      setUptimeText(formatDiff(diff));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [workerStatus, workerOnlineSince]);

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Keep the heartbeat age display moving between realtime heartbeat inserts.
  useEffect(() => {
    if (workerStatus !== 'Online') {
      setBackendLatencyMs(null);
      return;
    }
    const tick = () => {
      const lastHB = lastHeartbeatTimeRef.current;
      setBackendLatencyMs(lastHB > 0 ? Math.max(0, Date.now() - lastHB) : null);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [workerStatus]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const fetchLogs = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase
      .from('system_logs')
      .select(LOG_COLUMNS)
      .eq('user_id', user.id)
      .neq('type', 'heartbeat')
      .order('created_at', { ascending: false })
      .limit(MAX_LOG_ROWS);
    if (data) {
      const latestLatencyLog = data.find(log => parseSchoolLatencyMs(log.message || '') !== null);
      if (latestLatencyLog) {
        const parsed = parseSchoolLatencyMs(latestLatencyLog.message || '');
        if (parsed !== null) setSchoolLatencyMs(parsed);
      }
      const ordered = data.reverse();
      latestLogCreatedAtRef.current = ordered.length > 0
        ? ordered[ordered.length - 1].created_at
        : null;
      setLogs(ordered.map(log => ({
        id: log.id,
        time: formatDateTime(log.created_at),
        type: log.type,
        message: log.message
      })));
      checkWorkerStatus();
    }
  };

  const fetchNewLogs = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const latestCreatedAt = latestLogCreatedAtRef.current;
    if (!latestCreatedAt) {
      await fetchLogs();
      return;
    }

    const { data } = await supabase
      .from('system_logs')
      .select(LOG_COLUMNS)
      .eq('user_id', user.id)
      .neq('type', 'heartbeat')
      .gt('created_at', latestCreatedAt)
      .order('created_at', { ascending: true })
      .limit(MAX_LOG_ROWS);

    if (!data || data.length === 0) return;

    latestLogCreatedAtRef.current = data[data.length - 1].created_at;
    const latestLatencyLog = [...data].reverse().find(log => parseSchoolLatencyMs(log.message || '') !== null);
    if (latestLatencyLog) {
      const parsed = parseSchoolLatencyMs(latestLatencyLog.message || '');
      if (parsed !== null) setSchoolLatencyMs(parsed);
    }

    setLogs(prev => {
      const seen = new Set(prev.map(log => log.id));
      const incoming = data
        .filter(log => !seen.has(log.id))
        .map(log => ({
          id: log.id,
          time: formatDateTime(log.created_at),
          type: log.type,
          message: log.message
        }));
      if (incoming.length === 0) return prev;
      return [...prev, ...incoming].slice(-MAX_LOG_ROWS);
    });
    checkWorkerStatus();
  };

  const fetchCourses = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase
      .from('monitored_courses')
      .select('id, course_code, course_name, status, current_enrolled, last_check_time')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });
    if (data) setCourses(data);
  };

  const fetchStats = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { count: monitoringCount } = await supabase
      .from('monitored_courses')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('status', 'monitoring');

    const { count: successCount } = await supabase
      .from('monitored_courses')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('status', 'enrolled');

    setStats({
      monitoringCount: monitoringCount || 0,
      successCount: successCount || 0
    });

    const { data } = await supabase
      .from('user_settings')
      .select('check_interval, proxy_enabled, proxy_type, proxy_host, proxy_port, monitor_window_start, monitor_window_end')
      .eq('user_id', user.id)
      .single();
    if (data) {
      const intervalMs = Math.max(MIN_CHECK_INTERVAL_MS, data.check_interval ?? MIN_CHECK_INTERVAL_MS);
      setCheckIntervalMs(intervalMs);
      setMonitorWindow(
        data.monitor_window_start && data.monitor_window_end
          ? { start: String(data.monitor_window_start).slice(0, 5), end: String(data.monitor_window_end).slice(0, 5) }
          : null,
      );
      setProxyInfo({
        enabled: data.proxy_enabled ?? false,
        type: data.proxy_type ?? 'socks5',
        host: data.proxy_host ?? '',
        port: data.proxy_port ?? '',
      });
    }
  };

  const handleClearLogs = async () => {
    if (!confirm('確定要清除所有日誌嗎？此操作無法復原。')) return;
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      // 僅刪除非 heartbeat 的日誌，保留 heartbeat 以免前端誤判 Worker 離線
      const { error } = await supabase
        .from('system_logs')
        .delete()
        .eq('user_id', user.id)
        .neq('type', 'heartbeat');
      if (error) throw error;
      setLogs([]);
      await supabase.from('system_logs').insert({
        user_id: user.id,
        type: 'info',
        message: '日誌已由使用者手動清除',
        created_at: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error clearing logs:', error);
      alert('清除日誌失敗');
    }
  };



  const togglePause = async (course: DashboardCourse) => {
    try {
      const newStatus = course.status === 'paused' ? 'monitoring' : 'paused';
      const { error } = await supabase
        .from('monitored_courses')
        .update({ status: newStatus })
        .eq('id', course.id);
      if (error) throw error;
      fetchCourses();
      fetchStats();
    } catch (error) {
      console.error('Error toggling pause:', error);
    }
  };

  const deleteCourse = async (id: string) => {
    if (!confirm('確定要刪除此監控任務嗎？')) return;
    try {
      const { error } = await supabase
        .from('monitored_courses')
        .delete()
        .eq('id', id);
      if (error) throw error;
      fetchCourses();
      fetchStats();
    } catch (error) {
      console.error('Error deleting course:', error);
    }
  };

  // Newest last_check_time across monitored courses, as seconds ago.
  const latestCheckMs = courses.reduce((max, course) => {
    const ts = course.last_check_time ? new Date(course.last_check_time).getTime() : 0;
    return Number.isFinite(ts) && ts > max ? ts : max;
  }, 0);
  const lastCheckAgoSec = latestCheckMs > 0 ? Math.max(0, Math.floor((nowMs - latestCheckMs) / 1000)) : null;
  // 幾秒前用秒數跳，久沒檢查就換成分／時／天，不然會出現「394451 秒前」。
  const lastCheckAgo = lastCheckAgoSec === null
    ? null
    : lastCheckAgoSec < 60
      ? { value: String(lastCheckAgoSec), unit: '秒前' }
      : lastCheckAgoSec < 3600
        ? { value: String(Math.floor(lastCheckAgoSec / 60)), unit: '分前' }
        : lastCheckAgoSec < 86400
          ? { value: String(Math.floor(lastCheckAgoSec / 3600)), unit: '時前' }
          : { value: String(Math.floor(lastCheckAgoSec / 86400)), unit: '天前' };

  return (
    <>
      {/* 脈搏列：Worker 狀態、上次回報、檢查節奏、代理；數字用 mono */}
      <section className="mb-4 overflow-hidden rounded-2xl bg-sheet shadow-card">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-rule px-4 py-3">
          <span
            aria-hidden
            className={`h-2 w-2 rounded-full ${workerStatus === 'Online' ? 'bg-good' : 'bg-mark'}`}
          />
          <b className="text-sm">{workerStatus === 'Online' ? 'Worker 在線' : 'Worker 離線'}</b>
          <span className="font-mono text-xs text-ink-2">
            {workerStatus === 'Online' && uptimeText && workerOnlineSince
              // 「已持續 1 時」看不出主詞：寫清楚是 Worker 從幾點起連續回報心跳
              ? `從 ${formatDateTime(workerOnlineSince.toISOString())} 起・${uptimeText}`
              : workerStatus === 'Offline'
                ? `${stats.monitoringCount} 門課暫停監控`
                : `${stats.monitoringCount} 門課監控中`}
          </span>
          {/* 在線時間已經代表心跳正常；只有心跳遲到才值得多寫一句 */}
          {backendLatencyMs !== null && backendLatencyMs > HEARTBEAT_STALE_WARN_MS && (
            <>
              <span className="text-rule">/</span>
              <span className="font-mono text-xs text-mark" title="Worker 每 60 秒向資料庫回報一次；超過就是遲到">
                心跳延遲 {Math.floor(backendLatencyMs / 1000)} 秒
              </span>
            </>
          )}
          {checkIntervalMs !== null && (
            <>
              <span className="text-rule">/</span>
              {/* 間隔是設定值；沒有課在監聽、或不在監控時段時 Worker 整輪跳過，不會打學校 */}
              <span className="font-mono text-xs text-ink-2">
                {stats.monitoringCount === 0
                  ? `沒有課在查・間隔設定 ${formatIntervalSec(checkIntervalMs)} 秒`
                  : monitorWindow && !withinMonitorWindow(monitorWindow)
                    ? `非監控時段（${monitorWindow.start}–${monitorWindow.end}）・暫停查詢`
                    : `每 ${formatIntervalSec(checkIntervalMs)} 秒查一次學校`}
              </span>
            </>
          )}
          {proxyInfo !== null && (
            <>
              <span className="text-rule">/</span>
              <span className="font-mono text-xs text-ink-2" title={proxyInfo.enabled ? `${proxyInfo.type.toUpperCase()} ${proxyInfo.host}:${proxyInfo.port}` : undefined}>
                {proxyInfo.enabled ? `代理 ${proxyInfo.type.toUpperCase()} ${proxyInfo.host}:${proxyInfo.port}` : '直接連線'}
              </span>
            </>
          )}
          <button
            type="button"
            onClick={() => onGoToCourseSearch?.()}
            className="ml-auto rounded-sm border border-rule bg-sheet px-3 py-1 text-[13px] text-ink-2 hover:border-accent hover:text-accent"
          >
            到課程查詢加入監聽
          </button>
        </div>
        <dl className="flex flex-wrap items-baseline gap-x-6 gap-y-2 px-4 py-2.5">
          <Stat label="監聽中" value={String(stats.monitoringCount)} unit="門" />
          <Stat label="已加到" value={String(stats.successCount)} unit="門" tone={stats.successCount > 0 ? 'good' : undefined} />
          <Stat label="學校查詢" value={schoolLatencyMs !== null ? String(schoolLatencyMs) : '—'} unit="ms" />
          <Stat label="上次檢查" value={lastCheckAgo?.value ?? '—'} unit={lastCheckAgo?.unit ?? '秒前'} />
        </dl>
      </section>



      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        {/* 監聽列表 */}
        <section className="overflow-hidden rounded-2xl bg-sheet shadow-card">
          <div className="flex items-baseline justify-between gap-3 border-b border-rule px-4 py-3">
            <h3 className="text-[15px] font-bold">監聽列表</h3>
            <span className="font-mono text-[11px] tracking-wide text-ink-3">
              {workerStatus === 'Online' ? '即時更新中' : '等待連線'}
            </span>
          </div>
          {courses.length > 0 ? (
            <ul>
              {courses.map(course => {
                const isMonitoring = course.status === 'monitoring';
                const isAvailable = course.status === 'available';
                const isPaused = course.status === 'paused';
                const isEnrolled = course.status === 'enrolled';
                return (
                  <li
                    key={course.id}
                    className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 border-t border-rule px-4 py-3 first:border-t-0 sm:grid-cols-[minmax(0,1fr)_88px_auto] ${
                      isEnrolled ? 'border-l-[3px] border-l-good' : isAvailable ? 'border-l-[3px] border-l-mark' : 'border-l-[3px] border-l-transparent'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <b className={`text-[15px] font-medium ${isPaused ? 'text-ink-3' : ''}`}>{course.course_name}</b>
                        <span className="font-mono text-[11px] text-ink-2">{course.course_code}</span>
                        {isPaused && <span className="font-mono text-[10px] text-ink-3">已暫停</span>}
                        {isEnrolled && <span className="font-mono text-[10px] text-good">已加到</span>}
                      </div>
                      <span className="block font-mono text-[11px] tracking-wide text-ink-3">
                        {course.last_check_time ? `上次檢查 ${formatDateTime(course.last_check_time)}` : '尚未檢查'}
                      </span>
                    </div>

                    <span className={`font-mono text-[15px] font-medium tabular-nums sm:text-right ${
                      isAvailable ? 'text-good' : isEnrolled ? 'text-good' : ''
                    }`}>
                      {course.current_enrolled || '—'}
                      <em className="block text-[11px] font-normal not-italic text-ink-3">
                        {isAvailable ? '有空位' : isEnrolled ? '已加到' : '目前人數'}
                      </em>
                    </span>

                    <div className="col-start-2 row-start-2 flex gap-1 sm:col-start-auto sm:row-start-auto">
                      {isMonitoring || isPaused ? (
                        <button
                          type="button"
                          onClick={() => togglePause(course)}
                          className="rounded-sm border border-rule px-2.5 py-1 text-xs text-ink-2 hover:border-accent hover:text-accent"
                        >
                          {isMonitoring ? '暫停' : '繼續'}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => deleteCourse(course.id)}
                        className="rounded-sm border border-rule px-2.5 py-1 text-xs text-ink-3 hover:border-accent hover:text-accent"
                      >
                        刪除
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="px-4 py-10 text-center">
              <b className="block text-[15px] font-medium">還沒有監聽任何課程</b>
              <p className="mt-1.5 text-[13px] text-ink-2">到課程查詢搜尋想要的課，按該列的「監聽」加入。</p>
            </div>
          )}
        </section>

        {/* 日誌：mono 列表，時間在前 */}
        <section className="flex h-[440px] flex-col overflow-hidden rounded-2xl bg-sheet shadow-card">
          <div className="flex flex-wrap items-center gap-2 border-b border-rule px-4 py-2.5">
            <div className="inline-flex overflow-hidden rounded-sm border border-rule">
              <h3 className="px-3 py-1 text-[13px]">監聽日誌</h3>
            </div>
            {logs.length > 0 && (
              <button
                type="button"
                onClick={handleClearLogs}
                className="ml-auto text-xs text-ink-3 underline decoration-rule underline-offset-4 hover:text-accent hover:decoration-accent"
              >
                清除
              </button>
            )}
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-3">
            {(() => {
              const filtered = logs;
              return filtered.length > 0 ? (
                <ol className="font-mono text-xs leading-relaxed">
                  {filtered.map(log => (
                    <li key={log.id} className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 py-1 animate-fadeIn">
                      <span className="whitespace-nowrap text-ink-3">{log.time}</span>
                      <span className={`[overflow-wrap:anywhere] ${
                        log.type === 'success' ? 'text-good' : log.type === 'error' ? 'text-mark' : log.type === 'warning' || log.type === 'warn' ? 'text-ink' : 'text-ink-2'
                      }`}>
                        {log.message}
                      </span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="py-10 text-center font-mono text-xs text-ink-3">
                  目前沒有監聽日誌
                </p>
              );
            })()}
            <div ref={logEndRef} />
          </div>
        </section>
      </div>
    </>
  );
};

function Stat({ label, value, unit, tone }: { label: string; value: string; unit: string; tone?: 'good' }) {
  return (
    <div>
      <dt className="font-mono text-[10px] tracking-[.1em] text-ink-3">{label}</dt>
      <dd className={`font-mono text-[17px] font-semibold tabular-nums ${tone === 'good' ? 'text-good' : ''}`}>
        {value}<span className="ml-1 text-[11px] font-normal text-ink-3">{unit}</span>
      </dd>
    </div>
  );
}

export default DashboardView;
