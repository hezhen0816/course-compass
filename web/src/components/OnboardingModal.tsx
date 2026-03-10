import React, { useState } from 'react';
import { X, Upload, Calculator, LayoutDashboard, ChevronRight, ChevronLeft, Check, Smartphone } from 'lucide-react';

interface OnboardingModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const OnboardingModal: React.FC<OnboardingModalProps> = ({ isOpen, onClose }) => {
  const [currentStep, setCurrentStep] = useState(0);

  if (!isOpen) return null;

  const steps = [
    {
      title: "歡迎使用 Web 課程規劃版",
      description: "這個版本專注在桌面上的課程編排、學分統計與畢業門檻管理，保留最適合大螢幕操作的規劃流程。",
      icon: <LayoutDashboard className="w-16 h-16 text-blue-500" />,
      color: "bg-blue-50"
    },
    {
      title: "快速匯入課程",
      description: "支援成績查詢系統與選課清單兩種 HTML 匯入來源。下載校務頁面後，直接上傳到 Web 版即可補齊規劃資料。",
      icon: <Upload className="w-16 h-16 text-green-500" />,
      color: "bg-green-50"
    },
    {
      title: "課程細節仍留在 Web",
      description: "課程卡片內仍可編輯詳細資訊、評分項目與筆記。這些互動維持在 Web，避免手機上塞進太多密集編修流程。",
      icon: <Calculator className="w-16 h-16 text-purple-500" />,
      color: "bg-purple-50"
    },
    {
      title: "與 iOS 版分工",
      description: "首頁摘要、課表、待辦與提醒將交給原生 iOS App。這樣 Web 與 iOS 可以並行保留，但各自維持清楚的產品定位。",
      icon: <Smartphone className="w-16 h-16 text-orange-500" />,
      color: "bg-orange-50"
    }
  ];

  const handleNext = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(prev => prev + 1);
    } else {
      onClose();
    }
  };

  const handlePrev = () => {
    if (currentStep > 0) {
      setCurrentStep(prev => prev - 1);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col relative animate-in fade-in zoom-in duration-200">
        
        <button 
          onClick={onClose}
          className="absolute top-4 right-4 p-2 rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors z-10"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Content */}
        <div className="p-8 flex flex-col items-center text-center pt-12">
          <div className={`w-32 h-32 rounded-full flex items-center justify-center mb-6 ${steps[currentStep].color}`}>
            {steps[currentStep].icon}
          </div>
          
          <h2 className="text-2xl font-bold text-slate-800 mb-3">
            {steps[currentStep].title}
          </h2>
          
          <p className="text-slate-500 leading-relaxed mb-8">
            {steps[currentStep].description}
          </p>

          {/* Dots Indicator */}
          <div className="flex space-x-2 mb-8">
            {steps.map((_, index) => (
              <div 
                key={index}
                className={`w-2 h-2 rounded-full transition-all duration-300 ${
                  index === currentStep ? 'w-6 bg-blue-600' : 'bg-slate-200'
                }`}
              />
            ))}
          </div>
        </div>

        {/* Footer Buttons */}
        <div className="p-4 border-t bg-slate-50 flex justify-between items-center">
          <button
            onClick={handlePrev}
            disabled={currentStep === 0}
            className={`flex items-center px-4 py-2 text-slate-600 font-medium rounded-lg hover:bg-slate-200 transition-colors ${
              currentStep === 0 ? 'opacity-0 pointer-events-none' : ''
            }`}
          >
            <ChevronLeft className="w-4 h-4 mr-1" /> 上一步
          </button>

          <button
            onClick={handleNext}
            className={`flex items-center px-6 py-2.5 rounded-lg font-bold text-white shadow-lg shadow-blue-500/20 transition-all transform active:scale-95 ${
              currentStep === steps.length - 1 
                ? 'bg-slate-900 hover:bg-slate-800' 
                : 'bg-blue-600 hover:bg-blue-700'
            }`}
          >
            {currentStep === steps.length - 1 ? (
              <>開始使用 <Check className="w-4 h-4 ml-2" /></>
            ) : (
              <>下一步 <ChevronRight className="w-4 h-4 ml-2" /></>
            )}
          </button>
        </div>

      </div>
    </div>
  );
};
