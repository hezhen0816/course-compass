import React, { useState, useEffect } from 'react';
import { 
  X, User, Calculator, Award, Trash2, Plus, FileText, Save, 
  Mail, MapPin, Clock, Link as LinkIcon 
} from 'lucide-react';
import type { Course, CourseDetails, GradingItem, CourseCategory } from '../types';

interface CourseDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  course: Course;
  semesterId: string;
  onSave: (updatedCourse: Course) => void;
}

export const CourseDetailModal: React.FC<CourseDetailModalProps> = ({ 
  isOpen, onClose, course, semesterId, onSave 
}) => {
  const [detailData, setDetailData] = useState<CourseDetails>({ gradingPolicy: [] });

  useEffect(() => {
    if (isOpen && course) {
      setDetailData(course.details || { 
        professor: '', email: '', location: '', time: '', link: '', notes: '', gradingPolicy: [] 
      });
    }
  }, [isOpen, course]);

  if (!isOpen) return null;

  const getCategoryColor = (cat: CourseCategory) => {
    switch (cat) {
      case 'compulsory': return 'bg-red-50 border-red-100';
      case 'elective': return 'bg-blue-50 border-blue-100';
      case 'gen_ed': return 'bg-purple-50 border-purple-100';
      case 'pe': return 'bg-green-50 border-green-100';
      case 'chinese': return 'bg-orange-50 border-orange-100';
      case 'english': return 'bg-indigo-50 border-indigo-100';
      case 'social': return 'bg-yellow-50 border-yellow-100';
      case 'unclassified': return 'bg-gray-50 border-gray-200';
      default: return 'bg-gray-50 border-gray-100';
    }
  };

  const getGradeFromScore = (score: number) => {
    if (score >= 90) return { grade: 'A+', gpa: 4.3, color: 'text-green-600' };
    if (score >= 85) return { grade: 'A', gpa: 4.0, color: 'text-green-500' };
    if (score >= 80) return { grade: 'A-', gpa: 3.7, color: 'text-green-400' };
    if (score >= 77) return { grade: 'B+', gpa: 3.3, color: 'text-blue-600' };
    if (score >= 73) return { grade: 'B', gpa: 3.0, color: 'text-blue-500' };
    if (score >= 70) return { grade: 'B-', gpa: 2.7, color: 'text-blue-400' };
    if (score >= 67) return { grade: 'C+', gpa: 2.3, color: 'text-yellow-600' };
    if (score >= 63) return { grade: 'C', gpa: 2.0, color: 'text-yellow-500' };
    if (score >= 60) return { grade: 'C-', gpa: 1.7, color: 'text-yellow-400' };
    if (score >= 50) return { grade: 'D', gpa: 1.0, color: 'text-red-500' };
    return { grade: 'E', gpa: 0.0, color: 'text-red-600' };
  };

  const calculateTotalScore = (items: GradingItem[]) => {
    let currentScore = 0;
    let totalWeight = 0;
    
    items.forEach(item => {
      if (item.score !== undefined && item.weight > 0) {
        currentScore += (item.score * item.weight) / 100;
      }
      totalWeight += item.weight;
    });
  
    return { 
      currentScore: Math.round(currentScore * 10) / 10,
      totalWeight 
    };
  };

  const addGradingItem = () => {
    setDetailData(prev => ({
      ...prev,
      gradingPolicy: [...prev.gradingPolicy, { id: Date.now().toString(), name: '', weight: 0, score: undefined }]
    }));
  };

  const removeGradingItem = (id: string) => {
    setDetailData(prev => ({
      ...prev,
      gradingPolicy: prev.gradingPolicy.filter(item => item.id !== id)
    }));
  };

  const updateGradingItem = (id: string, field: keyof GradingItem, value: string | number | undefined) => {
    setDetailData(prev => ({
      ...prev,
      gradingPolicy: prev.gradingPolicy.map(item => 
        item.id === id ? { ...item, [field]: value } : item
      )
    }));
  };

  const handleSave = () => {
    onSave({
      ...course,
      details: detailData
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl overflow-hidden flex flex-col max-h-[90vh]">
        
        {/* 標題區塊 */}
        <div className={`px-6 py-5 border-b flex justify-between items-start ${getCategoryColor(course.category)}`}>
          <div>
            <div className="flex items-center space-x-2 text-sm opacity-80 mb-2">
              <span className="px-2 py-0.5 bg-black/10 rounded font-medium">
                {semesterId.startsWith('1-1') ? '大一上' : 
                 semesterId.startsWith('1-2') ? '大一下' :
                 semesterId.startsWith('2-1') ? '大二上' :
                 semesterId.startsWith('2-2') ? '大二下' :
                 semesterId.startsWith('3-1') ? '大三上' :
                 semesterId.startsWith('3-2') ? '大三下' :
                 semesterId.startsWith('4-1') ? '大四上' :
                 semesterId.startsWith('4-2') ? '大四下' : semesterId}
              </span>
              <span>{course.credits} 學分</span>
            </div>
            <h2 className="text-3xl font-bold text-slate-900">{course.name}</h2>
          </div>
          <div className="flex space-x-2">
             <button onClick={onClose} className="p-2 rounded-full bg-white/50 hover:bg-white text-slate-700 transition-colors">
                <X className="h-6 w-6" />
             </button>
          </div>
        </div>
  
        {/* 內容區塊 */}
        <div className="flex-1 overflow-y-auto p-6 space-y-8">
          
          {/* 1. 基本資訊 (Logistics) */}
          <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <div>
                <label className="flex items-center text-sm font-bold text-slate-500 mb-1">
                  <User className="h-4 w-4 mr-1" /> 授課教授
                </label>
                <input 
                  type="text" 
                  value={detailData.professor || ''}
                  onChange={e => setDetailData(prev => ({...prev, professor: e.target.value}))}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                  placeholder="教授姓名"
                />
              </div>
              <div>
                <label className="flex items-center text-sm font-bold text-slate-500 mb-1">
                  <Mail className="h-4 w-4 mr-1" /> Email
                </label>
                <input 
                  type="text" 
                  value={detailData.email || ''}
                  onChange={e => setDetailData(prev => ({...prev, email: e.target.value}))}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                  placeholder="教授 Email"
                />
              </div>
              <div>
                <label className="flex items-center text-sm font-bold text-slate-500 mb-1">
                  <LinkIcon className="h-4 w-4 mr-1" /> 課程連結
                </label>
                <input 
                  type="text" 
                  value={detailData.link || ''}
                  onChange={e => setDetailData(prev => ({...prev, link: e.target.value}))}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                  placeholder="Moodle 或課程網網址"
                />
              </div>
            </div>
            <div className="space-y-4">
              <div>
                <label className="flex items-center text-sm font-bold text-slate-500 mb-1">
                  <MapPin className="h-4 w-4 mr-1" /> 上課地點
                </label>
                <input 
                  type="text" 
                  value={detailData.location || ''}
                  onChange={e => setDetailData(prev => ({...prev, location: e.target.value}))}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                  placeholder="教室代碼 (如: TR-201)"
                />
              </div>
              <div>
                <label className="flex items-center text-sm font-bold text-slate-500 mb-1">
                  <Clock className="h-4 w-4 mr-1" /> 上課時間
                </label>
                <input 
                  type="text" 
                  value={detailData.time || ''}
                  onChange={e => setDetailData(prev => ({...prev, time: e.target.value}))}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                  placeholder="如: 三 2,3,4"
                />
              </div>
            </div>
          </section>
  
          {/* 2. 成績試算 & 預測區塊 (Calculator Section) */}
          <section className="bg-gradient-to-r from-slate-50 to-slate-100 rounded-2xl p-6 border border-slate-200 shadow-sm">
            {(() => {
                const { currentScore, totalWeight } = calculateTotalScore(detailData.gradingPolicy);
                const gradeInfo = getGradeFromScore(currentScore);
                
                return (
                  <>
                    <div className="flex justify-between items-start mb-6">
                        <div>
                            <h3 className="text-lg font-bold text-slate-800 flex items-center">
                                <Calculator className="h-5 w-5 mr-2 text-blue-600" />
                                成績試算 & 預測
                            </h3>
                            <p className="text-sm text-slate-500 mt-1">
                                總權重: {totalWeight}% {totalWeight !== 100 && <span className="text-red-500">(未達100%)</span>}
                            </p>
                        </div>
                        <div className="text-right">
                            <div className="text-3xl font-bold text-slate-800">
                                {currentScore} <span className="text-lg text-slate-400">/ 100</span>
                            </div>
                            <div className={`text-sm font-bold flex items-center justify-end mt-1 ${gradeInfo.color}`}>
                                <Award className="h-4 w-4 mr-1"/>
                                目前等級: {gradeInfo.grade} ({gradeInfo.gpa})
                            </div>
                        </div>
                    </div>
  
                    {/* 評分項目列表 */}
                    <div className="space-y-3">
                       {detailData.gradingPolicy.map((item) => {
                           const itemWeightedScore = (item.weight * (item.score || 0)) / 100;
                           return (
                            <div key={item.id} className="flex flex-col sm:flex-row gap-3 items-center bg-white p-3 rounded-xl border border-slate-200 shadow-sm">
                                {/* 左側: 項目名稱與權重 */}
                                <div className="flex-1 w-full flex gap-2">
                                    <input 
                                        type="text" 
                                        placeholder="項目" 
                                        value={item.name}
                                        onChange={(e) => updateGradingItem(item.id, 'name', e.target.value)}
                                        className="flex-1 min-w-0 font-medium text-slate-700 bg-transparent outline-none"
                                    />
                                    <div className="relative w-20 flex-shrink-0">
                                        <input 
                                            type="number" 
                                            placeholder="權重"
                                            value={item.weight || ''}
                                            onChange={(e) => updateGradingItem(item.id, 'weight', Number(e.target.value))}
                                            className="w-full text-right font-bold text-slate-600 bg-slate-50 rounded px-1 outline-none"
                                        />
                                        <span className="absolute right-[-10px] top-0 text-slate-400 text-sm">%</span>
                                    </div>
                                </div>
                                
                                <div className="hidden sm:block w-px h-8 bg-slate-100 mx-2"></div>
  
                                {/* 右側: 實際得分輸入與折合分數 */}
                                <div className="flex items-center gap-4 w-full sm:w-auto justify-between">
                                    <div className="flex items-center gap-2">
                                        <span className="text-xs text-slate-400 font-bold">得分</span>
                                        <input 
                                            type="number" 
                                            placeholder="?"
                                            value={item.score !== undefined ? item.score : ''}
                                            onChange={(e) => updateGradingItem(item.id, 'score', e.target.value === '' ? undefined : Number(e.target.value))}
                                            className={`w-20 px-3 py-1.5 rounded-lg border text-center font-bold outline-none transition-all ${item.score !== undefined ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-slate-200 bg-slate-50 text-slate-400'}`}
                                        />
                                    </div>
                                    <div className="text-right w-16">
                                        <div className="text-xs text-slate-400">折合</div>
                                        <div className="font-bold text-slate-800">
                                            {item.score !== undefined ? itemWeightedScore.toFixed(1) : '-'}
                                        </div>
                                    </div>
                                    <button onClick={() => removeGradingItem(item.id)} className="text-slate-300 hover:text-red-400 p-1">
                                        <Trash2 className="h-4 w-4" />
                                    </button>
                                </div>
                            </div>
                           )
                       })}
                       
                       <button 
                         onClick={addGradingItem}
                         className="w-full py-3 border-2 border-dashed border-slate-200 rounded-xl text-slate-400 font-medium hover:border-blue-300 hover:text-blue-500 hover:bg-blue-50 transition-all flex items-center justify-center gap-2"
                       >
                         <Plus className="h-4 w-4" /> 新增評分項目
                       </button>
                    </div>
                  </>
                );
            })()}
          </section>
  
          {/* 3. 生存筆記區塊 (Survival Notes) */}
          <section>
             <h3 className="font-bold text-slate-800 flex items-center mb-3">
               <FileText className="h-5 w-5 mr-2 text-yellow-500" /> 
               生存筆記
             </h3>
             <textarea 
               value={detailData.notes || ''}
               onChange={e => setDetailData(prev => ({...prev, notes: e.target.value}))}
               className="w-full h-32 px-4 py-3 bg-yellow-50/50 border border-yellow-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-yellow-400 outline-none resize-none text-slate-700 leading-relaxed"
               placeholder="在這裡記錄上課風格、點名頻率、考古題重點..."
             />
          </section>
  
        </div>
  
        {/* 底部按鈕 */}
        <div className="p-4 border-t bg-slate-50 flex justify-end">
          <button 
            onClick={handleSave}
            className="px-6 py-2.5 bg-slate-900 text-white font-bold rounded-lg hover:bg-slate-800 shadow-lg shadow-blue-900/10 flex items-center"
          >
            <Save className="h-4 w-4 mr-2" /> 儲存變更
          </button>
        </div>
  
      </div>
    </div>
  );
};
