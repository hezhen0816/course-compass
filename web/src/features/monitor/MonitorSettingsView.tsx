import ClampedNumberInput from './ClampedNumberInput';
import React, { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { SETTINGS_FIELD_CLASS, SETTINGS_LABEL_CLASS, SETTINGS_PRIMARY_BUTTON, SETTINGS_SECONDARY_BUTTON, SheetHead } from '../settings/SettingsPage';
import { supabase } from './supabaseClient';

type EnrollmentPeriod = 'A06' | 'B01';

/** Mirrors MIN_CHECK_INTERVAL_SECONDS in backend/monitor/worker.py; the worker clamps to it. */
const MIN_CHECK_INTERVAL_MS = 5000;

interface MonitorSettings {
  line_notify_token: string;
  check_interval: number;
  random_interval: number;
  is_active: boolean;
  verify_ssl: boolean;
  email_notify: boolean;
  resend_api_key: string;
  smtp_host: string;
  smtp_port: number;
  smtp_username: string;
  smtp_password: string;
  enrollment_period: EnrollmentPeriod;
  /** 每日監控時段（台灣時間 HH:MM）；兩欄留空＝全天監控。 */
  monitor_window_start: string;
  monitor_window_end: string;
  /** 自訂收件人；留空＝寄到登入信箱。只有自備寄件憑證時後端才採用。 */
  notify_email: string;
}

/** Row written to user_settings; secret fields are optional so untouched encrypted values are not overwritten. */
type MonitorSettingsPayload = Partial<Omit<MonitorSettings, 'monitor_window_start' | 'monitor_window_end'>> & {
  is_encrypted?: boolean;
  /** Postgres `time` rejects ''; an unset end of the window has to go in as null. */
  monitor_window_start?: string | null;
  monitor_window_end?: string | null;
};

const MonitorSettingsView: React.FC = () => {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testEmailSending, setTestEmailSending] = useState(false);
  const [isEncrypted, setIsEncrypted] = useState(false);
  const [settings, setSettings] = useState<MonitorSettings>({
    line_notify_token: '',
    check_interval: MIN_CHECK_INTERVAL_MS,
    random_interval: 5,
    is_active: false,
    verify_ssl: true,
    email_notify: false,
    resend_api_key: '',
    smtp_host: 'smtp.example.org',
    smtp_port: 587,
    smtp_username: '',
    smtp_password: '',
    enrollment_period: 'A06',  // A06=電腦抽選後選課, B01=加退選課
    monitor_window_start: '',
    monitor_window_end: '',
    notify_email: ''
  });

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data, error } = await supabase
        .from('user_settings')
        .select('*')
        .eq('user_id', user.id)
        .single();
      if (error && error.code !== 'PGRST116') {
        console.error('Error fetching settings:', error);
      }
      if (data) {
        setIsEncrypted(data.is_encrypted || false);
        setSettings({
          line_notify_token: data.line_notify_token || '',
          check_interval: Math.max(MIN_CHECK_INTERVAL_MS, data.check_interval || MIN_CHECK_INTERVAL_MS),
          random_interval: data.random_interval ?? 5,
          is_active: data.is_active || false,
          verify_ssl: data.verify_ssl !== false,
          email_notify: data.email_notify ?? false,
          resend_api_key: data.is_encrypted && data.resend_api_key ? '' : (data.resend_api_key || ''),
          smtp_host: data.smtp_host || 'smtp.example.org',
          smtp_port: data.smtp_port ?? 587,
          smtp_username: data.smtp_username || '',
          smtp_password: data.is_encrypted && data.smtp_password ? '' : (data.smtp_password || ''),
          // Postgres time 回 'HH:MM:SS'；<input type="time"> 只吃 HH:MM。
          notify_email: data.notify_email || '',
          monitor_window_start: (data.monitor_window_start || '').slice(0, 5),
          monitor_window_end: (data.monitor_window_end || '').slice(0, 5),
          enrollment_period: (data.enrollment_period === 'B01' ? 'B01' : 'A06')
        });
      }
    } catch (error) {
      console.error('Error:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSendTestEmail = async () => {
    setTestEmailSending(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.email) {
        alert('無法取得您的登入信箱，請重新登入後再試。');
        return;
      }
      const { error } = await supabase
        .from('email_test_requests')
        .insert({ user_id: user.id, email: user.email });
      if (error) throw error;
      alert('已送出測試信請求，請稍候至信箱查收（約 1 分鐘內）。後端 Worker 需在運行中且已設定 Resend API Key 或 SMTP 才會發送。');
    } catch (e) {
      console.error('Send test email error:', e);
      alert('送出失敗，請稍後再試。');
    } finally {
      setTestEmailSending(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const payload: MonitorSettingsPayload = {
        ...settings,
        // 只設一邊等於沒設（worker 兩欄都要有才限制），一律連同空值存成 null。
        monitor_window_start: settings.monitor_window_start && settings.monitor_window_end
          ? settings.monitor_window_start
          : null,
        monitor_window_end: settings.monitor_window_start && settings.monitor_window_end
          ? settings.monitor_window_end
          : null,
      };

      // 如果是已加密狀態，且密碼欄位為空，則不更新這些欄位（避免覆蓋掉原本的加密資料）
      if (isEncrypted) {
        if (payload.resend_api_key === '') delete payload.resend_api_key;
        if (payload.smtp_password === '') delete payload.smtp_password;
        if (payload.line_notify_token === '') delete payload.line_notify_token;
      }

      // 如果使用者有輸入新的 Resend Key 或 SMTP 密碼，則將 is_encrypted 設為 false，讓後端重新加密。
      // line_notify_token 後端不加密，不應觸發此旗標。
      if (
        (payload.resend_api_key && payload.resend_api_key !== '') ||
        (payload.smtp_password && payload.smtp_password !== '')
      ) {
        payload.is_encrypted = false;
      }

      const { error } = await supabase
        .from('user_settings')
        .upsert({
          user_id: user.id,
          ...payload,
          updated_at: new Date().toISOString()
        });
      if (error) throw error;
      
      // 儲存成功後，重新抓取設定以更新 UI 狀態
      await fetchSettings();
      alert('設定已儲存');
    } catch (error) {
      console.error('Error saving settings:', error);
      alert('儲存失敗');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <section id="monitor-settings" className="rounded-2xl bg-sheet shadow-card px-4 py-3">
        <div className="flex items-center gap-2 font-mono text-xs text-ink-3">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          載入監控設定…
        </div>
      </section>
    );
  }

  const toggleClass = (on: boolean) =>
    `relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border border-rule transition-colors duration-200 ease-in-out ${on ? 'bg-accent' : 'bg-band'}`;
  const knobClass = (on: boolean) =>
    `pointer-events-none inline-block h-4 w-4 transform rounded-full bg-sheet shadow-sm transition-transform duration-200 ease-in-out ${on ? 'translate-x-4' : 'translate-x-0'}`;
  const inputClass = SETTINGS_FIELD_CLASS;

  return (
    <section id="monitor-settings" className="overflow-hidden rounded-2xl bg-sheet shadow-card">
      <SheetHead title="監聽參數" note="影響家裡那台電腦上的 Worker・監聽哪幾門課在「選課監控」頁">
        <button type="button" onClick={handleSave} disabled={saving} className={SETTINGS_PRIMARY_BUTTON}>
          {saving ? '儲存中…' : '儲存監聽設定'}
        </button>
      </SheetHead>

      <div className="divide-y divide-rule">
        {/* 監聽節奏 */}
        <div className="space-y-4 px-4 py-3">
          <div>
            <div className="mb-1 flex items-center justify-between">
              <label className="text-sm font-medium">基本監控間隔</label>
              <span className="font-mono text-xs text-ink-2">
                {settings.check_interval >= 1000
                  ? `${(settings.check_interval / 1000).toFixed(1)}s`
                  : `${settings.check_interval}ms`}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={String(MIN_CHECK_INTERVAL_MS)}
                max="60000"
                step="500"
                value={Math.min(settings.check_interval, 60000)}
                onChange={(e) => setSettings({ ...settings, check_interval: parseInt(e.target.value) })}
                className="h-1 flex-1 cursor-pointer appearance-none rounded-sm bg-band accent-ink"
              />
              <div className="flex items-center gap-1.5">
                <ClampedNumberInput
                  min={MIN_CHECK_INTERVAL_MS}
                  max={60000}
                  step={500}
                  value={settings.check_interval}
                  onCommit={(v) => setSettings({ ...settings, check_interval: v })}
                  className="w-20 border-0 border-b border-rule bg-transparent px-0 py-0.5 text-center font-mono text-sm text-ink outline-none focus:border-ink"
                />
                <span className="whitespace-nowrap text-xs text-ink-3">ms</span>
              </div>
            </div>
            <p className="mt-1.5 text-xs text-ink-3">每次向選課系統發送請求的基礎等待時間。學校嚴禁機器人搶課，Worker 會把低於 5000ms 的設定一律拉回 5000ms。</p>
          </div>

          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium">隨機間隔範圍（秒）</label>
              <div className="flex items-center gap-2">
                <ClampedNumberInput
                  min={0}
                  max={60}
                  value={settings.random_interval}
                  onCommit={(v) => setSettings({ ...settings, random_interval: v })}
                  className="w-20 border-0 border-b border-rule bg-transparent px-0 py-0.5 text-center font-mono text-sm text-ink outline-none focus:border-ink"
                />
                <span className="whitespace-nowrap text-xs text-ink-3">秒</span>
              </div>
              <p className="mt-1.5 text-xs text-ink-3">
                防止被系統識別為機器人，實際間隔會加上此隨機值（例如 {(settings.check_interval / 1000).toFixed(0)} ± {settings.random_interval} 秒）。設為 0 表示不加隨機。
              </p>
            </div>

            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-sm font-medium">SSL 憑證驗證</h3>
                <p className="mt-1 text-xs text-ink-3">關閉可忽略憑證錯誤。學校伺服器憑證過期導致抓取失敗時再關。</p>
              </div>
              <button
                type="button"
                aria-pressed={settings.verify_ssl}
                onClick={() => setSettings({ ...settings, verify_ssl: !settings.verify_ssl })}
                className={toggleClass(settings.verify_ssl)}
              >
                <span className={knobClass(settings.verify_ssl)} />
              </button>
            </div>
          </div>
        </div>

        {/* 選課時段會影響名額欄位的解讀 */}
        <div className="space-y-4 px-4 py-3">
          <div>
            <h3 className="text-sm font-medium">當前選課時段</h3>
            <p className="mt-1 text-xs text-ink-3">依學校公告選擇階段，監控會讀取該階段對應的名額。</p>
            <div className="mt-2 inline-flex overflow-hidden rounded-sm border border-rule">
              <button
                type="button"
                aria-pressed={settings.enrollment_period === 'A06'}
                onClick={() => setSettings({ ...settings, enrollment_period: 'A06' })}
                className={`whitespace-nowrap px-3 py-1 text-[13px] ${
                  settings.enrollment_period === 'A06' ? 'bg-accent text-sheet' : 'text-ink-2 hover:text-ink'
                }`}
              >
                電腦抽選後選課 A06
              </button>
              <button
                type="button"
                aria-pressed={settings.enrollment_period === 'B01'}
                onClick={() => setSettings({ ...settings, enrollment_period: 'B01' })}
                className={`whitespace-nowrap px-3 py-1 text-[13px] ${
                  settings.enrollment_period === 'B01' ? 'bg-accent text-sheet' : 'text-ink-2 hover:text-ink'
                }`}
              >
                加退選課 B01
              </button>
            </div>
          </div>

          <div>
            <h3 className="text-sm font-medium">每日監控時段（台灣時間）</h3>
            <p className="mt-1 text-xs text-ink-3">
              只有在這個時段內才會向學校查詢人數，時段外整輪跳過、完全不送請求（Worker 仍在線）。
              兩欄留空＝全天監控；起點晚於終點視為跨午夜，例如 08:00–02:00。
            </p>
            <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className={SETTINGS_LABEL_CLASS}>開始時間</label>
                <input
                  type="time"
                  value={settings.monitor_window_start}
                  onChange={(e) => setSettings({ ...settings, monitor_window_start: e.target.value })}
                  className={inputClass}
                />
              </div>
              <div>
                <label className={SETTINGS_LABEL_CLASS}>結束時間</label>
                <input
                  type="time"
                  value={settings.monitor_window_end}
                  onChange={(e) => setSettings({ ...settings, monitor_window_end: e.target.value })}
                  className={inputClass}
                />
              </div>
            </div>
          </div>

        </div>

        {/* 通知 */}
        <div className="space-y-4 px-4 py-3">
          <h3 className="font-mono text-[11px] tracking-[.14em] text-ink-3">通知</h3>

          <div>
            <label className="block text-sm font-medium">LINE Notify 推播</label>
            <p className="mb-1.5 text-xs text-ink-3">綁定 LINE 帳號，第一時間接收名額釋出推播。</p>
            <div className="flex flex-wrap gap-2">
              <input
                type="password"
                value={settings.line_notify_token}
                onChange={(e) => setSettings({ ...settings, line_notify_token: e.target.value })}
                placeholder={isEncrypted ? '（已加密，若不修改請留空）' : '輸入 LINE Token…'}
                className={`${inputClass} min-w-[16rem] flex-1 font-mono`}
              />
              <button
                type="button"
                className={SETTINGS_SECONDARY_BUTTON}
                disabled
              >
                測試（尚未完善）
              </button>
            </div>
          </div>

          <div className="flex items-start justify-between gap-4 border-t border-rule pt-4">
            <div>
              <h4 className="text-sm font-medium">Email 通知</h4>
              <p className="mt-1 text-xs text-ink-3">有名額釋出時寄信。</p>
            </div>
            <button
              type="button"
              aria-pressed={settings.email_notify}
              onClick={() => setSettings({ ...settings, email_notify: !settings.email_notify })}
              className={toggleClass(settings.email_notify)}
            >
              <span className={knobClass(settings.email_notify)} />
            </button>
          </div>

          {settings.email_notify && (
            <div className="space-y-4 border-l-2 border-rule pl-4">
              <div>
                <label className={SETTINGS_LABEL_CLASS}>收件人（選填）</label>
                <input
                  type="email"
                  value={settings.notify_email}
                  onChange={(e) => setSettings({ ...settings, notify_email: e.target.value })}
                  placeholder="留空＝寄到登入信箱"
                  className={inputClass}
                />
                <p className="mt-1 text-xs text-ink-3">
                  只有在下面填了自己的 Resend Key 或 SMTP 帳密時才會採用；沒填寄件憑證時一律寄到登入信箱，
                  以免有人拿 Worker 的共用寄件設定往任意地址寄信。
                </p>
              </div>

              <div>
                <label className={SETTINGS_LABEL_CLASS}>Resend API Key</label>
                <input
                  type="password"
                  value={settings.resend_api_key}
                  onChange={(e) => setSettings({ ...settings, resend_api_key: e.target.value })}
                  placeholder={isEncrypted ? '（已加密，若不修改請留空）' : 're_xxxxxxxxxxxx'}
                  className={`${inputClass}`}
                />
                <p className="mt-1 text-xs text-ink-3">
                  需先到 Resend 註冊取得 API Key，後端會用各使用者自己的 Key 發信。
                  <a href="https://resend.com" target="_blank" rel="noopener noreferrer" className="ml-1 text-ink underline decoration-rule underline-offset-2 hover:decoration-ink">
                    前往 Resend →
                  </a>
                </p>
              </div>

              <div className="border-t border-rule pt-4">
                <p className="mb-2 font-mono text-[11px] text-ink-3">進階・改用 SMTP（選填，本機或允許出站 SMTP 的環境）</p>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div>
                    <label className={SETTINGS_LABEL_CLASS}>SMTP 主機</label>
                    <input
                      type="text"
                      value={settings.smtp_host}
                      onChange={(e) => setSettings({ ...settings, smtp_host: e.target.value })}
                      placeholder="smtp.example.org"
                      className={`${inputClass}`}
                    />
                  </div>
                  <div>
                    <label className={SETTINGS_LABEL_CLASS}>SMTP 埠號</label>
                    <ClampedNumberInput
                      min={1}
                      max={65535}
                      value={settings.smtp_port}
                      onCommit={(v) => setSettings({ ...settings, smtp_port: v })}
                      className={`${inputClass}`}
                    />
                  </div>
                  <div>
                    <label className={SETTINGS_LABEL_CLASS}>寄件者 Email / 帳號</label>
                    <input
                      type="email"
                      value={settings.smtp_username}
                      onChange={(e) => setSettings({ ...settings, smtp_username: e.target.value })}
                      placeholder="your@email.com"
                      className={`${inputClass}`}
                    />
                  </div>
                  <div>
                    <label className={SETTINGS_LABEL_CLASS}>SMTP 密碼 / 應用程式密碼</label>
                    <input
                      type="password"
                      value={settings.smtp_password}
                      onChange={(e) => setSettings({ ...settings, smtp_password: e.target.value })}
                      placeholder={isEncrypted ? '（已加密，若不修改請留空）' : '••••••••'}
                      className={`${inputClass}`}
                    />
                    <p className="mt-1 text-xs text-ink-3">Gmail 請到 Google 帳號設定產生「應用程式密碼」。</p>
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={handleSendTestEmail}
                disabled={testEmailSending}
                className={SETTINGS_SECONDARY_BUTTON}
              >
                {testEmailSending ? '送出中…' : '發送測試信'}
              </button>
            </div>
          )}
        </div>
      </div>
    </section>
  );
};

export default MonitorSettingsView;
