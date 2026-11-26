import type { AppData, CourseSearchResult, PendingRequirement } from '../../shared/types';
import {
  type PlanningMode,
  displayClassroom,
  displaySlots,
  findScheduledCourseByOffering,
  formatCredits,
  parseNodeSlots,
  requirementCourseCode,
} from '../../shared/domain/planner';
import { findOfferingConflicts } from '../../shared/domain/scheduleConflicts';
import { SETTINGS_PRIMARY_BUTTON } from '../settings/SettingsPage';

export function OfferingModal({
  requirement,
  semesterName,
  status,
  error,
  offerings,
  data,
  activeSemesterId,
  planningMode,
  onClose,
  onSchedule,
}: {
  requirement: PendingRequirement;
  semesterName: string;
  status: 'idle' | 'loading' | 'error';
  error: string;
  offerings: CourseSearchResult[];
  data: AppData;
  activeSemesterId: string;
  planningMode: PlanningMode;
  onClose: () => void;
  onSchedule: (offering: CourseSearchResult, force: boolean) => boolean;
}) {
  const code = requirementCourseCode(requirement);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/35 p-4">
      <div className="max-h-[86vh] w-full max-w-3xl overflow-hidden rounded-2xl bg-sheet shadow-card">
        <div className="border-b border-rule px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-mono text-[11px] tracking-[.14em] text-ink-3">開課班別</p>
              <h2 className="mt-0.5 text-[15px] font-bold">{requirement.title}</h2>
              <p className="mt-0.5 text-[13px] text-ink-2">
                {code ? `依課碼 ${code} 選擇要排入 ${semesterName} 的班別。` : `選擇要排入 ${semesterName} 的實際開課班別。`}
              </p>
            </div>
            <button type="button" onClick={onClose} aria-label="關閉" className="rounded-sm border border-rule px-2 text-sm leading-6 text-ink-2 hover:border-accent hover:text-accent">×</button>
          </div>
        </div>
        <div className="max-h-[68vh] overflow-y-auto">
          {status === 'loading' && <p className="px-4 py-6 font-mono text-xs text-ink-3">查詢開課資料中…</p>}
          {status === 'error' && <p className="m-4 rounded-xl bg-mark-soft px-3 py-2 text-[13px] text-mark">{error}</p>}
          {status === 'idle' && offerings.length === 0 && <p className="px-4 py-8 text-center text-[13px] text-ink-2">查無符合的開課班別。</p>}
          <ul>
            {offerings.map((offering) => {
              const conflicts = findOfferingConflicts(offering, data);
              const alreadyAdded = Boolean(findScheduledCourseByOffering(offering, data, activeSemesterId));
              const conflictBlocksSchedule = conflicts.length > 0 && planningMode !== 'lottery';
              const hasSlots = parseNodeSlots(offering.node).length > 0;
              return (
                <li key={`${offering.course_no}-${offering.node}-${offering.teacher}`} className={`border-t border-rule px-4 py-3 first:border-t-0 ${conflictBlocksSchedule && !alreadyAdded ? 'bg-mark/5' : ''}`}>
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <p className="text-[15px] font-medium">{offering.course_name}</p>
                      <p className="mt-0.5 font-mono text-[11px] tracking-wide text-ink-2">
                        {offering.course_no}・{offering.teacher || '未列教師'}・{displaySlots(parseNodeSlots(offering.node))}・{displayClassroom(offering.classroom)}・{formatCredits(offering.credits)} 學分
                      </p>
                      {offering.contents && <p className="mt-0.5 text-xs text-ink-3">{offering.contents}</p>}
                      {!hasSlots && (
                        <p className="mt-1 text-xs text-ink-2">此課程沒有節次資料，無法檢查衝堂。</p>
                      )}
                      {alreadyAdded && (
                        <p className="mt-1 font-mono text-[11px] text-good">已排入目前學期</p>
                      )}
                      {!alreadyAdded && conflicts.length > 0 && (
                        <p className={`mt-1 text-xs ${planningMode === 'lottery' ? 'text-ink-2' : 'text-mark'}`}>
                          {planningMode === 'lottery' ? '同時段競爭：' : '和 '}
                          {conflicts.map((course) => course.name).join('、')}
                          {planningMode === 'lottery' ? '，可作為同時段志願' : ' 衝堂'}
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          if (onSchedule(offering, false)) onClose();
                        }}
                        disabled={alreadyAdded || conflictBlocksSchedule}
                        className={SETTINGS_PRIMARY_BUTTON}
                      >
                        {alreadyAdded ? '已加入' : '排入課表'}
                      </button>
                      {!alreadyAdded && conflictBlocksSchedule && (
                        <button
                          type="button"
                          onClick={() => {
                            if (onSchedule(offering, true)) onClose();
                          }}
                          className="rounded-sm border border-mark px-3 py-1.5 text-[13px] text-mark"
                        >
                          仍要加入
                        </button>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}
