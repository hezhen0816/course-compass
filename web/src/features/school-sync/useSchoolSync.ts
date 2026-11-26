import { useCallback, useState, type Dispatch, type SetStateAction } from 'react';
import {
  importAcademicHistory,
  syncSchoolSchedule,
} from '../../shared/api';
import { supabase } from '../../shared/supabase';
import type {
  AcademicHistoryRecord,
  AppData,
  Course,
  PendingRequirement,
  RequirementSet,
} from '../../shared/types';
import {
  RETAKE_SET_ID,
  coursesFromScheduleSync,
  lookupGenEdDimensions,
  historyRecordsFromImport,
  lookupHistoricalSchedules,
  mergeHistoryRecordsIntoSemesters,
  officialScheduleRowsFromSlots,
  retakeRequirementsFromHistory,
  semesterForStudentTerm,
} from '../../shared/domain/planner';

type UseSchoolSyncOptions = {
  data: AppData;
  setData: Dispatch<SetStateAction<AppData>>;
  querySemester: string;
  accessToken?: string;
  setActiveSemesterId: (semesterId: string) => void;
  markHistoryMigrated: () => void;
  /** Called with fresh official-timetable rows after a schedule sync so the workbench grid stays current. */
  onOfficialScheduleRowsSynced?: (rows: Record<string, string>[]) => void;
};

export function useSchoolSync({
  data,
  setData,
  querySemester,
  accessToken,
  setActiveSemesterId,
  markHistoryMigrated,
  onOfficialScheduleRowsSynced,
}: UseSchoolSyncOptions) {
  const [isSchoolSyncOpen, setIsSchoolSyncOpen] = useState(false);
  const [schoolUsername, setSchoolUsername] = useState('');
  const [schoolPassword, setSchoolPasswordState] = useState('');
  const [schoolSyncStatus, setSchoolSyncStatus] = useState<'idle' | 'loading' | 'error' | 'success'>('idle');
  const [schoolSyncMessage, setSchoolSyncMessage] = useState('');

  const getLatestAccessToken = useCallback(async () => {
    if (supabase) {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.access_token) return session.access_token;
    }
    return accessToken || '';
  }, [accessToken]);

  const closeSchoolSyncModal = () => {
    setIsSchoolSyncOpen(false);
    setSchoolPasswordState('');
    setSchoolSyncStatus('idle');
    setSchoolSyncMessage('');
  };

  const handleSchoolUsernameChange = (username: string) => {
    setSchoolUsername(username);
    const inferredSemester = semesterForStudentTerm(data.semesters, querySemester, username);
    if (inferredSemester) {
      setSchoolSyncMessage(`已依學號與查詢學期 ${querySemester} 推算最新課表會匯入「${inferredSemester.name}」。`);
      setSchoolSyncStatus('idle');
    }
  };

  const handleSchoolPasswordChange = (password: string) => {
    setSchoolPasswordState(password);
  };

  /**
   * 校務同步。歷年成績一學期才變一次（期末登分），但加退選期課表天天在動，
   * 所以兩者可以分開跑：只要課表時把 includeHistory 關掉，省下重抓 20 幾筆成績
   * 與逐筆補查歷史節次的時間。
   */
  const syncSchoolData = async ({ includeSchedule = true, includeHistory = true }: {
    includeSchedule?: boolean;
    includeHistory?: boolean;
  } = {}) => {
    const username = schoolUsername.trim();
    const password = schoolPassword.trim();
    if (!username) {
      setSchoolSyncStatus('error');
      setSchoolSyncMessage('請輸入校務系統帳號。');
      return;
    }
    if (!password) {
      setSchoolSyncStatus('error');
      setSchoolSyncMessage('請輸入校務系統密碼。');
      return;
    }

    const targetSemester = semesterForStudentTerm(data.semesters, querySemester, username);
    if (!targetSemester) {
      setSchoolSyncStatus('error');
      setSchoolSyncMessage(`無法依帳號與查詢學期 ${querySemester} 推算匯入學期，請確認校務帳號是學號格式。`);
      return;
    }
    const importSemesterId = targetSemester.id;

    if (includeSchedule && targetSemester.courses.length > 0
      && !window.confirm(`匯入會覆蓋「${targetSemester.name}」目前的 ${targetSemester.courses.length} 門課，確定繼續嗎？`)) {
      return;
    }

    setSchoolSyncStatus('loading');
    setSchoolSyncMessage('');
    try {
      const token = await getLatestAccessToken();
      let schedulePayload: Awaited<ReturnType<typeof syncSchoolSchedule>> | null = null;
      let courses: Course[] = [];
      let officialScheduleRows: Record<string, string>[] = [];
      if (includeSchedule) {
        setSchoolSyncMessage('正在同步最新選課清單...');
        schedulePayload = await syncSchoolSchedule(username, password, token || undefined);
        courses = coursesFromScheduleSync(schedulePayload, querySemester);
        // 選課清單沒有 Dimension，用課碼回查課程查詢系統補上通識向度
        const dimensions = await lookupGenEdDimensions(courses, querySemester);
        if (dimensions.size > 0) {
          courses = courses.map((course) => {
            const code = (course.scheduledOffering?.courseNo || '').trim().toUpperCase();
            const dimension = dimensions.get(code);
            return dimension ? { ...course, dimension } : course;
          });
        }
        officialScheduleRows = officialScheduleRowsFromSlots(schedulePayload.slots);
      }

      let historyPayload: Awaited<ReturnType<typeof importAcademicHistory>> | null = null;
      let historyRecords: AcademicHistoryRecord[] = [];
      let historicalLookups: Awaited<ReturnType<typeof lookupHistoricalSchedules>> = new Map();
      let retakeRequirements: PendingRequirement[] = [];
      if (includeHistory) {
        setSchoolSyncMessage(includeSchedule
          ? '已取得最新課表，正在同步歷年成績與補查歷史節次...'
          : '正在同步歷年成績與補查歷史節次...');
        historyPayload = await importAcademicHistory(username, password, token || undefined);
        historyRecords = historyRecordsFromImport(historyPayload);
        historicalLookups = await lookupHistoricalSchedules(historyRecords);
        retakeRequirements = retakeRequirementsFromHistory(historyRecords);
      }
      const retakeSet: RequirementSet = {
        id: RETAKE_SET_ID,
        name: '待重修',
        source: 'system',
        notes: ['由已修紀錄自動產生'],
      };
      let importedCourseCount = 0;
      let scheduledHistoryCourseCount = 0;
      setData((prev) => ({
        ...prev,
        ...(() => {
          const semestersWithSchedule = includeSchedule
            ? prev.semesters.map((semester) => (
              semester.id === importSemesterId
                ? { ...semester, courses }
                : semester
            ))
            : prev.semesters;
          // 只同步課表時不重算歷史合併：沿用既有的已修紀錄與待重修，不要用空陣列蓋掉
          const merged = includeHistory
            ? mergeHistoryRecordsIntoSemesters(semestersWithSchedule, historyRecords, historyPayload?.student_no || username, historicalLookups)
            : { semesters: semestersWithSchedule, importedCourseCount: 0, scheduledHistoryCourseCount: 0 };
          importedCourseCount = merged.importedCourseCount;
          scheduledHistoryCourseCount = merged.scheduledHistoryCourseCount;
          const otherSets = prev.requirementSets.filter((set) => set.id !== RETAKE_SET_ID);
          const otherRequirements = prev.pendingRequirements.filter((requirement) => requirement.setId !== RETAKE_SET_ID);
          return {
            semesters: merged.semesters,
            ...(includeHistory ? {
              historyRecords,
              requirementSets: retakeRequirements.length > 0 ? [...otherSets, retakeSet] : otherSets,
              pendingRequirements: [...otherRequirements, ...retakeRequirements],
            } : {}),
            schoolSync: {
              ...prev.schoolSync,
              ...(includeSchedule && schedulePayload ? {
                scheduleSyncedAt: schedulePayload.synced_at,
                scheduleCourseCount: courses.length,
              } : {}),
              ...(includeHistory && historyPayload ? {
                historyImportedAt: historyPayload.imported_at,
                historyRecordCount: historyRecords.length,
              } : {}),
            },
            // The workbench grid renders officialSelectionCache.schedule_rows, which
            // otherwise only changes on an official-selection sync and goes stale.
            ...(includeSchedule && prev.selectionPlan?.officialSelectionCache
              ? {
                selectionPlan: {
                  ...prev.selectionPlan,
                  officialSelectionCache: {
                    ...prev.selectionPlan.officialSelectionCache,
                    schedule_rows: officialScheduleRows,
                  },
                  updatedAt: new Date().toISOString(),
                },
              }
              : {}),
          };
        })(),
      }));
      if (includeSchedule) {
        onOfficialScheduleRowsSynced?.(officialScheduleRows);
        setActiveSemesterId(importSemesterId);
      }
      if (includeHistory) markHistoryMigrated();
      setSchoolPasswordState('');
      const parts: string[] = [];
      if (includeSchedule) parts.push(`最新課表 ${courses.length} 門匯入「${targetSemester.name}」`);
      if (includeHistory) {
        parts.push(`歷年紀錄 ${historyRecords.length} 筆`);
        parts.push(`${scheduledHistoryCourseCount} 門補到歷史節次`);
        parts.push(`${importedCourseCount} 門寫入學期`);
        parts.push(`${retakeRequirements.length} 門列為待重修`);
      }
      setSchoolSyncMessage(`已同步完成：${parts.join('，')}。`);
    } catch (error) {
      setSchoolSyncStatus('error');
      setSchoolSyncMessage(error instanceof Error ? error.message : '校務資料同步失敗。');
    }
  };

  return {
    isSchoolSyncOpen,
    schoolUsername,
    schoolPassword,
    schoolSyncStatus,
    schoolSyncMessage,
    openSchoolSyncModal: () => setIsSchoolSyncOpen(true),
    closeSchoolSyncModal,
    setSchoolPassword: handleSchoolPasswordChange,
    getLatestAccessToken,
    handleSchoolUsernameChange,
    syncSchoolData,
  };
}
