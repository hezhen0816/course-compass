import React from 'react';

interface PrivacyPolicyModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const SECTIONS = [
  {
    title: '密碼安全',
    body: '雲端帳號由 Supabase Auth 管理。校務同步時，後端會拿您輸入的校務帳密登入台科大系統。校務密碼用於當次登入，官方選課的登入狀態暫存在後端記憶體。',
  },
  {
    title: '資料儲存與隔離',
    body: '本系統使用雲端資料庫與帳號隔離機制，採用列級安全性（Row Level Security）確保只有您登入後才能存取屬於您的修課規劃資料，其他使用者無法窺探。',
  },
  {
    title: '隱私權聲明',
    body: '雲端規劃會保存輸入或匯入的資料。依您使用的功能，系統也會與台科大、myNTUST 及設定的寄信服務交換資料。雲端資料由各部署的管理者管理。',
  },
];

export const PrivacyPolicyModal: React.FC<PrivacyPolicyModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/35 p-4">
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-sheet shadow-card">
        <div className="flex items-start justify-between gap-3 border-b border-rule px-5 py-3">
          <div>
            <p className="font-mono text-[11px] tracking-[.14em] text-ink-3">帳號</p>
            <h3 className="mt-0.5 text-[15px] font-bold">隱私權與安全說明</h3>
          </div>
          <button type="button" onClick={onClose} aria-label="關閉" className="rounded-sm border border-rule px-2 text-sm leading-6 text-ink-2 hover:border-accent hover:text-accent">×</button>
        </div>

        <div className="overflow-y-auto">
          {SECTIONS.map((section) => (
            <section key={section.title} className="border-t border-rule px-5 py-3 first:border-t-0">
              <h4 className="text-sm font-medium">{section.title}</h4>
              <p className="mt-1 text-[13px] leading-relaxed text-ink-2">{section.body}</p>
            </section>
          ))}
        </div>

        <div className="flex justify-end border-t border-rule px-5 py-3">
          <button type="button" onClick={onClose} className="rounded-sm bg-accent px-4 py-1.5 text-[13px] font-medium text-sheet">
            我了解了
          </button>
        </div>
      </div>
    </div>
  );
};
