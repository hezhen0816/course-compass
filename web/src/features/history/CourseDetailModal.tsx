import React, { useState } from 'react';
import { SETTINGS_FIELD_CLASS, SETTINGS_LABEL_CLASS, SETTINGS_PRIMARY_BUTTON, SETTINGS_SECONDARY_BUTTON } from '../settings/SettingsPage';
import type { Course, CourseDetails, GradingItem, CourseCategory, PendingRequirement } from '../../shared/types';

/** 標題左緣的類別色，跟課表同一組 token。 */
const CATEGORY_EDGE: Partial<Record<CourseCategory, string>> = {
  compulsory: 'border-l-cat-major',
  elective: 'border-l-cat-elective',
  gen_ed: 'border-l-cat-gened',
  pe: 'border-l-cat-pe',
  chinese: 'border-l-cat-gened',
  english: 'border-l-cat-gened',
  social: 'border-l-cat-gened',
};

interface CourseDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  course: Course;
  semesterId: string;
  semesterName?: string;
  recognitionRequirements: PendingRequirement[];
  /** 需求集 id → 名稱；沒傳就只顯示需求標題。 */
  requirementSetNames?: Map<string, string>;
  onSave: (updatedCourse: Course) => void;
}

export const CourseDetailModal: React.FC<CourseDetailModalProps> = ({
  isOpen, onClose, course, semesterId, semesterName, recognitionRequirements, requirementSetNames, onSave
}) => {
  const [detailData, setDetailData] = useState<CourseDetails>(() => course.details || {
    professor: '',
    email: '',
    location: '',
    time: '',
    link: '',
    notes: '',
    gradingPolicy: [],
  });
  const [recognitionRequirementId, setRecognitionRequirementId] = useState(course.sourceRequirementId || '');
  const [openGradingMenuId, setOpenGradingMenuId] = useState<string | null>(null);

  if (!isOpen) return null;

  const semesterLabel = semesterName || (
    semesterId.startsWith('1-1') ? '大一上' :
    semesterId.startsWith('1-2') ? '大一下' :
    semesterId.startsWith('2-1') ? '大二上' :
    semesterId.startsWith('2-2') ? '大二下' :
    semesterId.startsWith('3-1') ? '大三上' :
    semesterId.startsWith('3-2') ? '大三下' :
    semesterId.startsWith('4-1') ? '大四上' :
    semesterId.startsWith('4-2') ? '大四下' : semesterId
  );

  // 及格線以上用墨色，A 段用 good，不及格用朱批紅；等級／GPA 換算表沒動。
  const getGradeFromScore = (score: number) => {
    if (score >= 90) return { grade: 'A+', gpa: 4.3, tone: 'text-good' };
    if (score >= 85) return { grade: 'A', gpa: 4.0, tone: 'text-good' };
    if (score >= 80) return { grade: 'A-', gpa: 3.7, tone: 'text-good' };
    if (score >= 77) return { grade: 'B+', gpa: 3.3, tone: 'text-ink' };
    if (score >= 73) return { grade: 'B', gpa: 3.0, tone: 'text-ink' };
    if (score >= 70) return { grade: 'B-', gpa: 2.7, tone: 'text-ink' };
    if (score >= 67) return { grade: 'C+', gpa: 2.3, tone: 'text-ink-2' };
    if (score >= 63) return { grade: 'C', gpa: 2.0, tone: 'text-ink-2' };
    if (score >= 60) return { grade: 'C-', gpa: 1.7, tone: 'text-ink-2' };
    if (score >= 50) return { grade: 'D', gpa: 1.0, tone: 'text-mark' };
    return { grade: 'E', gpa: 0.0, tone: 'text-mark' };
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

  const duplicateGradingItem = (id: string) => {
    setDetailData(prev => {
      const index = prev.gradingPolicy.findIndex(item => item.id === id);
      if (index === -1) return prev;

      const itemToDuplicate = prev.gradingPolicy[index];
      const duplicatedItem: GradingItem = {
        ...itemToDuplicate,
        id: `${Date.now()}-${Math.random()}`,
      };

      const nextGradingPolicy = [...prev.gradingPolicy];
      nextGradingPolicy.splice(index + 1, 0, duplicatedItem);

      return {
        ...prev,
        gradingPolicy: nextGradingPolicy
      };
    });
  };

  const moveGradingItem = (id: string, direction: 'up' | 'down') => {
    setDetailData(prev => {
      const index = prev.gradingPolicy.findIndex(item => item.id === id);
      if (index === -1) return prev;

      const targetIndex = direction === 'up' ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= prev.gradingPolicy.length) return prev;

      const nextGradingPolicy = [...prev.gradingPolicy];
      [nextGradingPolicy[index], nextGradingPolicy[targetIndex]] = [nextGradingPolicy[targetIndex], nextGradingPolicy[index]];

      return {
        ...prev,
        gradingPolicy: nextGradingPolicy
      };
    });
  };

  const handleSave = () => {
    const recognitionRequirement = recognitionRequirements.find((requirement) => requirement.id === recognitionRequirementId);
    onSave({
      ...course,
      details: detailData,
      sourceRequirementId: recognitionRequirement?.id,
      sourceSetId: recognitionRequirement?.setId,
      // 認列集拿掉後，程式別不再由需求集 id 推導；課本身的 program 才是來源。
      program: course.program,
      virtualSelection: course.virtualSelection
        ? {
            ...course.virtualSelection,
            reason: recognitionRequirement
              ? `本地未來規劃，認列到：${recognitionRequirement.title}`
              : course.virtualSelection.status === 'manual'
                ? '本地未來規劃，尚未認列到任何需求。'
                : course.virtualSelection.reason,
          }
        : course.virtualSelection,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-ink/35 p-4">
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-sheet shadow-card">
        {/* 標題區塊：學期＋學分在上、課名大字；類別用左緣色條而不是整片底色 */}
        <div className={`flex items-start justify-between gap-3 border-b border-rule border-l-[3px] px-5 py-4 ${CATEGORY_EDGE[course.category] ?? 'border-l-ink-3'}`}>
          <div className="min-w-0">
            <p className="font-mono text-[11px] tracking-[.14em] text-ink-3">
              {semesterLabel}・{course.credits} 學分
              {course.scheduledOffering?.courseNo ? `・${course.scheduledOffering.courseNo}` : ''}
            </p>
            <h2 className="mt-1 text-[22px] font-bold leading-snug">{course.name}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="關閉" className="shrink-0 rounded-sm border border-rule px-2 text-sm leading-6 text-ink-2 hover:border-accent hover:text-accent">×</button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* 1. 基本資訊：一格一欄 */}
          <div className="grid grid-cols-1 gap-px border-b border-rule bg-rule sm:grid-cols-2 lg:grid-cols-3">
            {([
              ['授課教授', 'professor', '教授姓名'],
              ['Email', 'email', '教授 Email'],
              ['課程連結', 'link', 'Moodle 或課程網網址'],
              ['上課地點', 'location', '教室代碼，如 TR-201'],
              ['上課時間', 'time', '如 三 2,3,4'],
            ] as Array<[string, 'professor' | 'email' | 'link' | 'location' | 'time', string]>).map(([label, key, placeholder]) => (
              <label key={key} className="block bg-sheet px-4 py-2.5">
                <span className={SETTINGS_LABEL_CLASS}>{label}</span>
                <input
                  type="text"
                  value={detailData[key] || ''}
                  onChange={e => setDetailData(prev => ({ ...prev, [key]: e.target.value }))}
                  className={SETTINGS_FIELD_CLASS}
                  placeholder={placeholder}
                />
              </label>
            ))}
            <label className="block bg-sheet px-4 py-2.5">
              <span className={SETTINGS_LABEL_CLASS}>認列歸屬</span>
              <select
                value={recognitionRequirementId}
                onChange={(event) => setRecognitionRequirementId(event.target.value)}
                className={SETTINGS_FIELD_CLASS}
              >
                <option value="">不指定認列</option>
                {recognitionRequirements.map((requirement) => (
                  <option key={requirement.id} value={requirement.id}>
                    {requirementSetNames?.get(requirement.setId) || '需求'}・{requirement.title}
                  </option>
                ))}
              </select>
              <span className="mt-1 block text-xs text-ink-3">選「不指定」只取消認列，不會移除課程。</span>
            </label>
          </div>

          {/* 2. 成績試算 */}
          <section className="border-b border-rule">
            {(() => {
              const { currentScore, totalWeight } = calculateTotalScore(detailData.gradingPolicy);
              const gradeInfo = getGradeFromScore(currentScore);
              return (
                <>
                  <div className="flex flex-wrap items-end justify-between gap-3 px-4 py-3">
                    <div>
                      <h3 className="text-[15px] font-bold">成績試算</h3>
                      {detailData.gradingPolicy.length > 0 && (
                        <p className={`mt-0.5 font-mono text-[11px] tracking-wide ${totalWeight !== 100 ? 'text-mark' : 'text-ink-3'}`}>
                          總權重 {totalWeight}%{totalWeight !== 100 ? '・未達 100%' : ''}
                        </p>
                      )}
                    </div>
                    {detailData.gradingPolicy.length === 0 ? (
                      <p className="font-mono text-[11px] text-ink-3">尚未設定評分項目</p>
                    ) : (
                      <div className="text-right">
                        <div className="font-mono text-[29px] font-semibold leading-none tabular-nums">
                          {currentScore}<span className="ml-1 text-[13px] font-normal text-ink-3">/ 100</span>
                        </div>
                        <div className={`mt-1 font-mono text-[11px] ${gradeInfo.tone}`}>
                          目前等級 {gradeInfo.grade}・GPA {gradeInfo.gpa}
                        </div>
                      </div>
                    )}
                  </div>

                  {detailData.gradingPolicy.length > 0 && (
                    <div className="grid grid-cols-[minmax(0,1fr)_72px_72px_64px_auto] gap-x-3 border-t border-rule px-4 py-1.5 font-mono text-[10px] tracking-[.1em] text-ink-3">
                      <span>項目</span><span className="text-right">權重 %</span><span className="text-right">得分</span><span className="text-right">折合</span><span />
                    </div>
                  )}
                  <ul>
                    {detailData.gradingPolicy.map((item, index) => {
                      const itemWeightedScore = (item.weight * (item.score || 0)) / 100;
                      return (
                        <li key={item.id} className="relative grid grid-cols-[minmax(0,1fr)_72px_72px_64px_auto] items-center gap-x-3 border-t border-rule px-4 py-2">
                          <input
                            type="text"
                            placeholder="項目"
                            value={item.name}
                            onChange={(e) => updateGradingItem(item.id, 'name', e.target.value)}
                            className="min-w-0 border-0 border-b border-transparent bg-transparent px-0 py-0.5 text-sm font-medium outline-none placeholder:text-ink-3 focus:border-ink"
                          />
                          <input
                            type="number"
                            placeholder="0"
                            value={item.weight || ''}
                            onChange={(e) => updateGradingItem(item.id, 'weight', Number(e.target.value))}
                            className="w-full border-0 border-b border-rule bg-transparent px-0 py-0.5 text-right font-mono text-sm tabular-nums outline-none focus:border-ink"
                          />
                          <input
                            type="number"
                            placeholder="—"
                            value={item.score !== undefined ? item.score : ''}
                            onChange={(e) => updateGradingItem(item.id, 'score', e.target.value === '' ? undefined : Number(e.target.value))}
                            className={`w-full border-0 border-b border-rule bg-transparent px-0 py-0.5 text-right font-mono text-sm tabular-nums outline-none focus:border-ink ${item.score !== undefined ? 'text-ink' : 'text-ink-3'}`}
                          />
                          <span className="text-right font-mono text-sm tabular-nums text-ink-2">
                            {item.score !== undefined ? itemWeightedScore.toFixed(1) : '—'}
                          </span>
                          <button
                            type="button"
                            onClick={() => setOpenGradingMenuId(prev => (prev === item.id ? null : item.id))}
                            className="rounded-sm border border-rule px-1.5 font-mono text-xs leading-5 text-ink-2 hover:border-accent hover:text-accent"
                            title="更多操作"
                            aria-label="更多操作"
                          >
                            …
                          </button>
                          {openGradingMenuId === item.id && (
                            <div className="absolute right-4 top-10 z-30 w-28 overflow-hidden rounded-sm border border-rule bg-sheet shadow-md">
                              {([
                                ['上移', () => moveGradingItem(item.id, 'up'), index === 0, ''],
                                ['下移', () => moveGradingItem(item.id, 'down'), index === detailData.gradingPolicy.length - 1, ''],
                                ['複製', () => duplicateGradingItem(item.id), false, ''],
                                ['刪除', () => removeGradingItem(item.id), false, 'text-mark'],
                              ] as Array<[string, () => void, boolean, string]>).map(([label, run, disabled, tone]) => (
                                <button
                                  key={label}
                                  type="button"
                                  onClick={() => { run(); setOpenGradingMenuId(null); }}
                                  disabled={disabled}
                                  className={`block w-full px-3 py-1.5 text-left text-[13px] hover:bg-paper disabled:opacity-40 disabled:hover:bg-transparent ${tone || 'text-ink-2'}`}
                                >
                                  {label}
                                </button>
                              ))}
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                  <div className="border-t border-rule px-4 py-2">
                    <button type="button" onClick={addGradingItem} className={SETTINGS_SECONDARY_BUTTON}>
                      新增評分項目
                    </button>
                  </div>
                </>
              );
            })()}
          </section>

          {/* 3. 生存筆記 */}
          <section className="px-4 py-3">
            <h3 className="text-[15px] font-bold">生存筆記</h3>
            <textarea
              value={detailData.notes || ''}
              onChange={e => setDetailData(prev => ({ ...prev, notes: e.target.value }))}
              className="mt-2 h-28 w-full resize-none rounded-sm border border-rule bg-paper px-3 py-2 text-[13px] leading-relaxed text-ink outline-none placeholder:text-ink-3 focus:border-ink"
              placeholder="在這裡記錄上課風格、點名頻率、考古題重點…"
            />
          </section>
        </div>

        <div className="flex justify-end gap-2 border-t border-rule px-4 py-3">
          <button type="button" onClick={onClose} className={SETTINGS_SECONDARY_BUTTON}>取消</button>
          <button type="button" onClick={handleSave} className={SETTINGS_PRIMARY_BUTTON}>儲存變更</button>
        </div>
      </div>
    </div>
  );
};
