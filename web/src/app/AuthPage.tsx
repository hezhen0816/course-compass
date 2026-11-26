import React, { useState } from 'react';
import { supabase } from '../shared/supabase';
import { PrivacyPolicyModal } from './PrivacyPolicyModal';

interface AuthPageProps {
  onDemoLogin: () => void;
}

const FIELD =
  'mt-0.5 w-full border-0 border-b border-rule bg-transparent px-0 py-1.5 text-sm text-ink outline-none placeholder:text-ink-3 focus:border-ink';
const LABEL = 'block font-mono text-[10px] tracking-[.1em] text-ink-3';

/**
 * 登入頁：淺灰藍底上一張白色圓角卡片。品牌、兩個欄位、一顆主色按鈕；略過登入放在分隔線下面。
 */
export const AuthPage: React.FC<AuthPageProps> = ({ onDemoLogin }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login');
  const [loading, setLoading] = useState(false);
  const [isPrivacyOpen, setIsPrivacyOpen] = useState(false);

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase) return;
    setLoading(true);
    if (authMode === 'login') {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) alert(error.message);
    } else {
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) alert(error.message);
      else alert('註冊成功！請檢查信箱驗證連結 (或直接登入)');
    }
    setLoading(false);
  };

  const frame = (children: React.ReactNode) => (
    <div
      className="flex min-h-screen items-center justify-center bg-paper px-4 text-ink"
      style={{ paddingTop: 'max(1rem, env(safe-area-inset-top))', paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
    >
      <div className="w-full max-w-sm overflow-hidden rounded-2xl bg-sheet shadow-card">
        <div className="flex items-baseline gap-2.5 border-b border-rule px-5 py-3">
          <span className="text-[17px] font-bold tracking-[.01em]">修課羅盤</span>
          <span className="font-mono text-[11px] tracking-[.14em] text-ink-3">COURSE COMPASS</span>
        </div>
        {children}
      </div>
    </div>
  );

  if (!supabase) {
    return frame(
      <div className="px-5 py-5">
        <b className="block text-[15px] font-medium">尚未完成雲端設定</b>
        <p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">
          若要使用 Web 版登入與同步，請確認專案根目錄的 <code className="font-mono text-ink">.env</code> 已設定雲端服務網址與前端登入金鑰。
        </p>
        <button
          type="button"
          onClick={onDemoLogin}
          className="mt-4 w-full rounded-sm border border-rule px-4 py-2 text-[13px] text-ink-2 hover:border-accent hover:text-accent"
        >
          略過登入
        </button>
      </div>,
    );
  }

  return (
    <>
      {frame(
        <>
          <form onSubmit={handleAuth} className="px-5 pb-4 pt-5">
            <p className="text-[13px] leading-relaxed text-ink-2">請先登入以儲存資料，或略過登入快速體驗。</p>
            <label className="mt-4 block">
              <span className={LABEL}>Email</span>
              <input
                type="email"
                required
                autoComplete="email"
                className={`${FIELD} font-mono`}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label className="mt-3 block">
              <span className={LABEL}>密碼</span>
              <input
                type="password"
                required
                autoComplete={authMode === 'login' ? 'current-password' : 'new-password'}
                className={`${FIELD} font-mono`}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <button
              type="submit"
              disabled={loading}
              className="mt-5 w-full rounded-sm bg-accent px-4 py-2 text-sm font-medium text-sheet disabled:cursor-not-allowed disabled:opacity-45"
            >
              {loading ? '處理中…' : authMode === 'login' ? '登入' : '註冊'}
            </button>
            <button
              type="button"
              onClick={() => setAuthMode(authMode === 'login' ? 'signup' : 'login')}
              className="mt-3 block w-full text-center text-[13px] text-ink-2 underline decoration-rule underline-offset-4 hover:text-ink hover:decoration-ink"
            >
              {authMode === 'login' ? '沒有帳號？點此註冊' : '已有帳號？點此登入'}
            </button>
          </form>

          <div className="border-t border-rule px-5 py-4">
            <button
              type="button"
              onClick={onDemoLogin}
              className="w-full rounded-sm border border-rule px-4 py-2 text-[13px] text-ink-2 hover:border-accent hover:text-accent"
            >
              略過登入
            </button>
            <p className="mt-2 text-center font-mono text-[11px] text-ink-3">示範模式不會寫入正式資料。</p>
          </div>

          <div className="border-t border-rule px-5 py-2.5 text-center">
            <button
              type="button"
              onClick={() => setIsPrivacyOpen(true)}
              className="font-mono text-[11px] text-ink-3 hover:text-ink"
            >
              隱私權與安全說明
            </button>
          </div>
        </>,
      )}

      <PrivacyPolicyModal isOpen={isPrivacyOpen} onClose={() => setIsPrivacyOpen(false)} />
    </>
  );
};
