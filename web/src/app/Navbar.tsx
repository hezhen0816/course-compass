import React from 'react';
import { supabase } from '../shared/supabase';

export type AppPage = 'semester' | 'course-search' | 'planning' | 'multi-semester' | 'monitor' | 'record' | 'thresholds' | 'settings';

interface NavbarProps {
  userEmail: string;
  syncStatus: 'idle' | 'saving' | 'saved' | 'error';
  isDemoMode: boolean;
  activePage: AppPage;
  pendingCount: number;
  onPageChange: (page: AppPage) => void;
  onOpenHelp: () => void;
  onExitDemo: () => void;
}

const HELP_TEXT =
  '本學期看這週的課表與還沒定的事；課程查詢找課；選課工作台輔助目前選課學期，不會自動搶課；選課監控盯名額；修課紀錄看八個學期的課；畢業門檻看各項進度與應修科目表需求；設定放同步、帳號與門檻數字。';

/**
 * 導覽：寬螢幕是左側欄，八個分頁依用途分三組（這學期／選課／畢業），設定與帳號放最下面；
 * 窄於 lg 時收成頂端一列可橫向捲動的膠囊分頁。目前分頁用主色淡底標示。
 */
const NAV_GROUPS: Array<{ title: string; pages: AppPage[] }> = [
  { title: '這學期', pages: ['semester', 'record'] },
  { title: '選課', pages: ['course-search', 'planning', 'multi-semester', 'monitor'] },
  { title: '畢業', pages: ['thresholds'] },
];

const PAGE_LABELS: Record<AppPage, string> = {
  semester: '本學期',
  record: '修課紀錄',
  'course-search': '課程查詢',
  planning: '選課工作台',
  'multi-semester': '多學期規劃',
  monitor: '選課監控',
  thresholds: '畢業門檻',
  settings: '設定',
};

const ORDERED_PAGES: AppPage[] = [...NAV_GROUPS.flatMap((group) => group.pages), 'settings'];

function CompassMark() {
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] bg-accent" aria-hidden="true">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinejoin="round">
        <circle cx="12" cy="12" r="9" />
        <path d="M15.5 8.5l-2 5-5 2 2-5z" />
      </svg>
    </span>
  );
}

export const Navbar: React.FC<NavbarProps> = ({
  userEmail,
  syncStatus,
  isDemoMode,
  activePage,
  pendingCount,
  onPageChange,
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

  const counts: Partial<Record<AppPage, number>> = { planning: pendingCount };

  const syncText = syncStatus === 'saving'
    ? '同步中…'
    : syncStatus === 'saved'
      ? '資料已同步'
      : syncStatus === 'error'
        ? '同步失敗'
        : '資料同步';
  const syncTone = syncStatus === 'error' ? 'bg-mark-soft text-mark' : syncStatus === 'saved' ? 'bg-good/10 text-good' : 'bg-band text-ink-3';

  const navButton = (page: AppPage, compact = false) => {
    const current = activePage === page;
    const count = counts[page];
    return (
      <button
        key={page}
        type="button"
        onClick={() => onPageChange(page)}
        aria-current={current ? 'page' : undefined}
        className={`flex items-center justify-between gap-2 rounded-sm text-sm ${
          compact ? 'whitespace-nowrap px-3 py-1.5' : 'w-full px-3 py-2 text-left'
        } ${current ? 'bg-accent-soft font-bold text-accent' : 'font-medium text-ink-2 hover:bg-paper hover:text-ink'}`}
      >
        {PAGE_LABELS[page]}
        {count ? (
          <span className="rounded-full bg-accent px-1.5 text-[11px] font-bold leading-[18px] text-sheet tabular-nums">{count}</span>
        ) : null}
      </button>
    );
  };

  const utilityLinks = (
    <>
      <button
        type="button"
        onClick={() => alert(HELP_TEXT)}
        className="text-[13px] text-ink-2 hover:text-accent"
        title="各分頁在做什麼"
      >
        說明
      </button>
      <button type="button" onClick={onOpenHelp} className="text-[13px] text-ink-2 hover:text-accent" title="功能導覽">
        導覽
      </button>
      <button
        type="button"
        onClick={handleLogout}
        className="text-[13px] text-ink-2 hover:text-accent"
        title={isDemoMode ? '離開略過登入模式' : '登出'}
      >
        {isDemoMode ? '離開略過登入' : '登出'}
      </button>
    </>
  );

  return (
    <nav
      data-app-nav
      aria-label="主選單"
      className="sticky top-0 z-40 bg-sheet shadow-card lg:h-screen lg:w-[232px] lg:shrink-0 lg:shadow-none"
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
    >
      {/* 寬螢幕：左側欄 */}
      <div className="hidden h-full flex-col gap-1 overflow-y-auto px-3.5 py-5 lg:flex">
        <button
          type="button"
          onClick={() => onPageChange('semester')}
          className="mb-3 flex items-center gap-2.5 px-2 text-left"
          title="回本學期"
        >
          <CompassMark />
          <span className="text-[17px] font-black">修課羅盤</span>
        </button>
        {isDemoMode && <span className="mx-2 mb-1 rounded-sm bg-mark-soft px-2 py-1 text-xs text-mark">略過登入模式</span>}

        {NAV_GROUPS.map((group) => (
          <div key={group.title} className="flex flex-col gap-0.5">
            <span className="px-3 pb-1 pt-3.5 text-xs text-ink-3">{group.title}</span>
            {group.pages.map((page) => navButton(page))}
          </div>
        ))}

        <div className="mt-auto flex flex-col gap-2 pt-4">
          {navButton('settings')}
          <span className={`mx-1 w-fit rounded-full px-2.5 py-0.5 text-xs ${syncTone}`}>{syncText}</span>
          <div className="flex gap-3 px-2">{utilityLinks}</div>
          <span className="truncate px-2 text-[11px] text-ink-3">{userEmail}</span>
        </div>
      </div>

      {/* 窄螢幕：頂端一列 */}
      <div className="flex flex-col gap-2 px-4 py-2.5 lg:hidden">
        <div className="flex items-center gap-2.5">
          <button type="button" onClick={() => onPageChange('semester')} className="flex min-w-0 items-center gap-2 text-left" title="回本學期">
            <CompassMark />
            <span className="truncate text-base font-black">修課羅盤</span>
          </button>
          {isDemoMode && <span className="text-[11px] text-mark">略過登入模式</span>}
          <span className={`ml-auto shrink-0 rounded-full px-2 py-0.5 text-[11px] ${syncTone}`}>{syncText}</span>
        </div>
        <div className="-mx-1 overflow-x-auto">
          <div className="flex min-w-max items-center gap-1 px-1">{ORDERED_PAGES.map((page) => navButton(page, true))}</div>
        </div>
        <div className="flex items-center gap-3">
          {utilityLinks}
          <span className="ml-auto max-w-[180px] truncate text-[11px] text-ink-3">{userEmail}</span>
        </div>
      </div>
    </nav>
  );
};
