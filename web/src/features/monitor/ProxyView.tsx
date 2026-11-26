import React, { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { SETTINGS_FIELD_CLASS, SETTINGS_LABEL_CLASS, SETTINGS_PRIMARY_BUTTON, SETTINGS_SECONDARY_BUTTON, SheetHead } from '../settings/SettingsPage';
import { supabase } from './supabaseClient';

interface ProxySettings {
  proxy_enabled: boolean;
  proxy_type: 'http' | 'socks5';
  proxy_host: string;
  proxy_port: string;
  proxy_username: string;
  proxy_password: string;
}

const DEFAULT: ProxySettings = {
  proxy_enabled: false,
  proxy_type: 'socks5',
  proxy_host: '',
  proxy_port: '',
  proxy_username: '',
  proxy_password: '',
};

const ProxyView: React.FC = () => {
  const [settings, setSettings] = useState<ProxySettings>(DEFAULT);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from('user_settings')
        .select('proxy_enabled, proxy_type, proxy_host, proxy_port, proxy_username, proxy_password')
        .eq('user_id', user.id)
        .single();
      if (data) {
        setSettings({
          proxy_enabled: data.proxy_enabled ?? false,
          proxy_type: data.proxy_type ?? 'socks5',
          proxy_host: data.proxy_host ?? '',
          proxy_port: data.proxy_port ?? '',
          proxy_username: data.proxy_username ?? '',
          proxy_password: data.proxy_password ?? '',
        });
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setTestResult(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { error } = await supabase
        .from('user_settings')
        .upsert({ user_id: user.id, ...settings, updated_at: new Date().toISOString() });
      if (error) throw error;
      alert('代理設定已儲存，Worker 下次循環將套用。');
    } catch (e) {
      alert('儲存失敗：' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    if (!settings.proxy_host || !settings.proxy_port) {
      alert('請先填寫主機與埠號');
      return;
    }
    setTesting(true);
    setTestResult(null);
    await new Promise(r => setTimeout(r, 800));
    const portNum = parseInt(settings.proxy_port);
    if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
      setTestResult({ ok: false, msg: '埠號無效，請輸入 1–65535 之間的數字。' });
    } else {
      setTestResult({
        ok: true,
        msg: `格式正確（${settings.proxy_type.toUpperCase()} ${settings.proxy_host}:${settings.proxy_port}）。實際連線測試將由後端 Worker 執行。`,
      });
    }
    setTesting(false);
  };

  const set = (patch: Partial<ProxySettings>) => setSettings(prev => ({ ...prev, ...patch }));

  if (loading) {
    return (
      <section className="rounded-2xl bg-sheet shadow-card px-4 py-3">
        <div className="flex items-center gap-2 font-mono text-xs text-ink-3">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          載入代理設定…
        </div>
      </section>
    );
  }

  const inputClass = SETTINGS_FIELD_CLASS;

  return (
    <section className="overflow-hidden rounded-2xl bg-sheet shadow-card">
      <SheetHead title="代理伺服器" note="只套用在課程查詢（公開 API）；加選一律直連，校務帳密不經過代理。下次循環套用">
        <span className="whitespace-nowrap font-mono text-[11px] text-ink-3">啟用代理</span>
        <button
          type="button"
          aria-pressed={settings.proxy_enabled}
          onClick={() => set({ proxy_enabled: !settings.proxy_enabled })}
          className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border border-rule transition-colors duration-200 ${settings.proxy_enabled ? 'bg-accent' : 'bg-band'}`}
        >
          <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-sheet shadow-sm transition-transform duration-200 ${settings.proxy_enabled ? 'translate-x-4' : 'translate-x-0'}`} />
        </button>
      </SheetHead>

      <div className={`space-y-4 px-4 py-3 transition-opacity ${settings.proxy_enabled ? 'opacity-100' : 'pointer-events-none opacity-40'}`}>
        <div>
          <label className={SETTINGS_LABEL_CLASS}>代理類型</label>
          <div className="mt-1 inline-flex overflow-hidden rounded-sm border border-rule">
            {(['socks5', 'http'] as const).map(t => (
              <button
                key={t}
                type="button"
                aria-pressed={settings.proxy_type === t}
                onClick={() => set({ proxy_type: t })}
                className={`whitespace-nowrap px-3 py-1 font-mono text-[13px] ${
                  settings.proxy_type === t ? 'bg-accent text-sheet' : 'text-ink-2 hover:text-ink'
                }`}
              >
                {t.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <label className={SETTINGS_LABEL_CLASS}>主機位址 Host</label>
            <input
              type="text"
              value={settings.proxy_host}
              onChange={e => set({ proxy_host: e.target.value })}
              placeholder="127.0.0.1 或 proxy.example.com"
              className={inputClass}
            />
          </div>
          <div>
            <label className={SETTINGS_LABEL_CLASS}>埠號 Port</label>
            <input
              type="text"
              value={settings.proxy_port}
              onChange={e => set({ proxy_port: e.target.value })}
              placeholder="9050"
              className={inputClass}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label className={SETTINGS_LABEL_CLASS}>帳號・選填</label>
            <input
              type="text"
              value={settings.proxy_username}
              onChange={e => set({ proxy_username: e.target.value })}
              placeholder="留空表示不需驗證"
              className={inputClass}
            />
          </div>
          <div>
            <label className={SETTINGS_LABEL_CLASS}>密碼・選填</label>
            <input
              type="password"
              value={settings.proxy_password}
              onChange={e => set({ proxy_password: e.target.value })}
              placeholder="••••••••"
              className={inputClass}
            />
          </div>
        </div>

        {testResult && (
          <div className={`rounded-xl px-3 py-2 text-[13px] leading-relaxed ${testResult.ok ? "bg-good/10 text-ink" : "bg-mark-soft text-ink"}`}>
            {testResult.msg}
          </div>
        )}

        <div className="space-y-0.5 border-t border-rule pt-3 font-mono text-[11px] leading-relaxed text-ink-3">
          <p>建議用 SOCKS5，隱私性比 HTTP 代理好。</p>
          <p>Tor 本機代理：SOCKS5 127.0.0.1:9050</p>
          <p>SSH Tunnel：SOCKS5 127.0.0.1:1080（ssh -D 1080 user@server）</p>
        </div>
      </div>

      <div className="flex flex-wrap justify-end gap-2 border-t border-rule px-4 py-3">
        <button type="button" onClick={handleTest} disabled={testing || !settings.proxy_enabled} className={SETTINGS_SECONDARY_BUTTON}>
          {testing ? '檢查中…' : '格式驗證'}
        </button>
        <button type="button" onClick={handleSave} disabled={saving} className={SETTINGS_PRIMARY_BUTTON}>
          {saving ? '儲存中…' : '儲存代理設定'}
        </button>
      </div>
    </section>
  );
};

export default ProxyView;
