import React from 'react';
import { GraduationCap, Settings, Upload, LogOut, CircleHelp, BookOpen } from 'lucide-react';
import { supabase } from '../supabase';

interface NavbarProps {
  userEmail: string;
  syncStatus: 'idle' | 'saving' | 'saved' | 'error';
  isDemoMode: boolean;
  onOpenSettings: () => void;
  onImport: (html: string) => void;
  onOpenHelp: () => void;
  onExitDemo: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  userEmail,
  syncStatus,
  isDemoMode,
  onOpenSettings,
  onImport,
  onOpenHelp,
  onExitDemo,
}) => {
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
  
    const reader = new FileReader();
    reader.onload = (event) => {
      const htmlContent = event.target?.result as string;
      onImport(htmlContent);
    };
    reader.readAsText(file);
    e.target.value = '';
  };

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
                {isDemoMode && <span className="text-amber-600">功能演示模式</span>}
                {syncStatus === 'saving' && <span className="text-gray-400">同步中...</span>}
                {syncStatus === 'saved' && <span className="text-green-500">已同步</span>}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap md:flex-nowrap">
            <div className="grid grid-cols-5 sm:flex items-center gap-2 w-full sm:w-auto">
              <button
                onClick={onOpenSettings}
                className="flex items-center justify-center gap-2 px-3 py-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                title="設定門檻"
              >
                <Settings className="w-4 h-4" />
                <span className="hidden md:inline">設定門檻</span>
              </button>

              <label
                className="flex items-center justify-center gap-2 px-3 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors cursor-pointer"
                title="匯入成績"
              >
                <Upload className="w-4 h-4" />
                <span className="hidden md:inline">匯入成績</span>
                <input
                  type="file"
                  accept=".html"
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </label>

              <button
                onClick={() => alert('匯入說明：\n\n【成績查詢系統】(建議 - 包含成績資訊):\n1. 前往臺科大成績查詢系統 (https://stuinfosys.ntust.edu.tw/StuScoreQueryServ/StuScoreQuery)\n2. 在頁面上點擊右鍵，選擇「另存新檔」或「網頁儲存為...」\n3. 下載 .html 檔案並上傳\n\n【選課清單】(快速選課規劃):\n1. 前往臺科大選課系統 (/ChooseList/D03/D03)\n2. 在頁面上點擊右鍵，選擇「另存新檔」或「網頁儲存為...」\n3. 下載 .html 檔案並上傳\n\n兩種格式都支援！選擇適合您的匯入方式。')}
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
                title={isDemoMode ? '離開功能演示' : '登出'}
              >
                <LogOut className="w-4 h-4" />
                <span className="hidden md:inline">{isDemoMode ? '離開演示' : '登出'}</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </nav>
  );
};
