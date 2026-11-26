import React, { useState } from 'react';

interface OnboardingModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const STEPS = [
  {
    eyebrow: '01・本學期',
    title: '先看這週',
    description: '課表照真實上課分鐘畫，休息時間也照比例留白。右邊列出還沒定的事：待加簽、重複的待加簽、完全沒動過的門檻。',
  },
  {
    eyebrow: '02・課程查詢',
    title: '找課時就知道卡不卡',
    description: '每一列前面有 5 天 × 10 節的時段指紋，灰是你已排的、藍是這門課、紅是撞在一起。可以直接規劃、送官方選課或交給名額監聽。',
  },
  {
    eyebrow: '03・選課工作台',
    title: '官方狀態與待加簽放一起',
    description: '已選上的課、待加簽、初選志願序都在同一張課表上；官方拒絕的課會用虛線留著，不會不見。',
  },
  {
    eyebrow: '04・修課紀錄與畢業門檻',
    title: '八個學期與各項門檻',
    description: '修課紀錄看修過什麼、修讀中什麼；畢業門檻看每項還差多少，雙主修／輔系的應修科目表也匯在那裡。門檻數字在「設定」改。',
  },
];

/** 功能導覽：四步，跟其他頁同一套 sheet 語言，不再用彩色圓圈與圖示。 */
export const OnboardingModal: React.FC<OnboardingModalProps> = ({ isOpen, onClose }) => {
  const [currentStep, setCurrentStep] = useState(0);

  if (!isOpen) return null;

  const step = STEPS[currentStep];
  const isLast = currentStep === STEPS.length - 1;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/35 p-4">
      <div className="w-full max-w-md overflow-hidden rounded-2xl bg-sheet shadow-card">
        <div className="flex items-start justify-between gap-3 border-b border-rule px-5 py-3">
          <span className="font-mono text-[11px] tracking-[.14em] text-ink-3">功能導覽</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="關閉"
            className="rounded-sm border border-rule px-2 text-sm leading-6 text-ink-2 hover:border-accent hover:text-accent"
          >
            ×
          </button>
        </div>

        <div className="px-5 pb-5 pt-6">
          <p className="font-mono text-[11px] tracking-[.14em] text-ink-3">{step.eyebrow}</p>
          <h2 className="mt-1 text-[22px] font-bold leading-snug">{step.title}</h2>
          <p className="mt-3 text-[13px] leading-relaxed text-ink-2">{step.description}</p>

          <div className="mt-6 flex gap-1.5" aria-hidden>
            {STEPS.map((_, index) => (
              <span
                key={index}
                className={`h-[3px] rounded-[1px] transition-all ${index === currentStep ? 'w-6 bg-accent' : 'w-3 bg-rule'}`}
              />
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-rule px-5 py-3">
          <button
            type="button"
            onClick={() => setCurrentStep((value) => Math.max(0, value - 1))}
            disabled={currentStep === 0}
            className="text-[13px] text-ink-2 hover:text-ink disabled:invisible"
          >
            上一步
          </button>
          <button
            type="button"
            onClick={() => (isLast ? onClose() : setCurrentStep((value) => value + 1))}
            className="rounded-sm bg-accent px-4 py-1.5 text-[13px] font-medium text-sheet"
          >
            {isLast ? '開始使用' : '下一步'}
          </button>
        </div>
      </div>
    </div>
  );
};
