import React from 'react';
import { GraduationCap, Settings, LogOut, CircleHelp, BookOpen } from 'lucide-react';
import { supabase } from '../supabase';

interface NavbarProps {
  userEmail: string;
  syncStatus: 'idle' | 'saving' | 'saved' | 'error';
  isDemoMode: boolean;
  onOpenSettings: () => void;
  onOpenHelp: () => void;
  onExitDemo: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  userEmail,
  syncStatus,
  isDemoMode,
  onOpenSettings,
  onOpenHelp,
  onExitDemo,
}) => {
  const handleLogout = async () => {
    if (isDemoMode || !supabase) {
      onExitDemo();
      return;
    }

    await supabase.auth.signOut();
    window.location.reload();
  };

  return (
    <nav
      className="bg-white shadow-sm sticky top-0 z-10"
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-4 py-3 md:h-16 md:flex-row md:items-center md:justify-between md:py-0">
          <div className="flex items-center gap-3 min-w-0">
            <GraduationCap className="w-8 h-8 text-blue-600 flex-shrink-0" />
            <div className="min-w-0">
              <span className="text-xl font-bold text-gray-900 truncate block">修課羅盤</span>
              <div className="flex items-center gap-2 text-xs">
                <span className="text-gray-500 truncate">{userEmail}</span>
                {isDemoMode && <span className="text-amber-600">略過登入模式</span>}
                {syncStatus === 'saving' && <span className="text-gray-400">同步中...</span>}
                {syncStatus === 'saved' && <span className="text-green-500">已同步</span>}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap md:flex-nowrap">
            <div className="grid grid-cols-4 sm:flex items-center gap-2 w-full sm:w-auto">
              <button
                onClick={onOpenSettings}
                className="flex items-center justify-center gap-2 px-3 py-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                title="設定門檻"
              >
                <Settings className="w-4 h-4" />
                <span className="hidden md:inline">設定門檻</span>
              </button>

              <button
                onClick={() => alert('新版規劃以左側待修池為主：可上傳雙主修 PDF、用課名或課碼搜尋開課，再加入待修或排入目前學期。')}
                className="flex items-center justify-center p-2 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                title="匯入說明"
              >
                <CircleHelp className="w-5 h-5" />
              </button>

              <button
                onClick={onOpenHelp}
                className="flex items-center justify-center p-2 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                title="功能導覽"
              >
                <BookOpen className="w-5 h-5" />
              </button>

              <button
                onClick={handleLogout}
                className="flex items-center justify-center gap-2 px-3 py-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                title={isDemoMode ? '離開略過登入模式' : '登出'}
              >
                <LogOut className="w-4 h-4" />
                <span className="hidden md:inline">{isDemoMode ? '離開略過登入' : '登出'}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </nav>
  );
};
