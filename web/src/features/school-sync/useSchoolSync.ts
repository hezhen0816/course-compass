import { useState, type Dispatch, type SetStateAction } from 'react';
import { importAcademicHistory, syncSchoolSchedule } from '../../api';
import type { AppData, RequirementSet } from '../../types';
import {
  RETAKE_SET_ID,
  coursesFromScheduleSync,
  historyRecordsFromImport,
  lookupHistoricalSchedules,
  mergeHistoryRecordsIntoSemesters,
  retakeRequirementsFromHistory,
  semesterForStudentTerm,
} from '../../domain/planner';

type UseSchoolSyncOptions = {
  data: AppData;
  setData: Dispatch<SetStateAction<AppData>>;
  querySemester: string;
  setActiveSemesterId: (semesterId: string) => void;
  markHistoryMigrated: () => void;
};

export function useSchoolSync({
  data,
  setData,
  querySemester,
  setActiveSemesterId,
  markHistoryMigrated,
}: UseSchoolSyncOptions) {
  const [isSchoolSyncOpen, setIsSchoolSyncOpen] = useState(false);
  const [schoolUsername, setSchoolUsername] = useState('');
  const [schoolPassword, setSchoolPassword] = useState('');
  const [schoolSyncStatus, setSchoolSyncStatus] = useState<'idle' | 'loading' | 'error' | 'success'>('idle');
  const [schoolSyncMessage, setSchoolSyncMessage] = useState('');

  const closeSchoolSyncModal = () => {
    setIsSchoolSyncOpen(false);
    setSchoolPassword('');
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

  const syncSchoolData = async () => {
    const username = schoolUsername.trim();
    const password = schoolPassword.trim();
    if (!username || !password) {
      setSchoolSyncStatus('error');
      setSchoolSyncMessage('請輸入校務系統帳號與密碼。');
      return;
    }

    const targetSemester = semesterForStudentTerm(data.semesters, querySemester, username);
    if (!targetSemester) {
      setSchoolSyncStatus('error');
      setSchoolSyncMessage(`無法依帳號與查詢學期 ${querySemester} 推算匯入學期，請確認校務帳號是學號格式。`);
      return;
    }
    const importSemesterId = targetSemester.id;

    if (targetSemester.courses.length > 0 && !window.confirm(`匯入會覆蓋「${targetSemester.name}」目前的 ${targetSemester.courses.length} 門課，確定繼續嗎？`)) {
      return;
    }

    setSchoolSyncStatus('loading');
    setSchoolSyncMessage('');
    try {
      setSchoolSyncMessage('正在同步最新選課清單...');
      const schedulePayload = await syncSchoolSchedule(username, password);
      const courses = coursesFromScheduleSync(schedulePayload);

      setSchoolSyncMessage('已取得最新課表，正在同步歷年成績與補查歷史節次...');
      const historyPayload = await importAcademicHistory(username, password);
      const historyRecords = historyRecordsFromImport(historyPayload);
      const historicalLookups = await lookupHistoricalSchedules(historyRecords);
      const retakeRequirements = retakeRequirementsFromHistory(historyRecords);
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
          const semestersWithSchedule = prev.semesters.map((semester) => (
            semester.id === importSemesterId
              ? { ...semester, courses }
              : semester
          ));
          const merged = mergeHistoryRecordsIntoSemesters(semestersWithSchedule, historyRecords, historyPayload.student_no || username, historicalLookups);
          importedCourseCount = merged.importedCourseCount;
          scheduledHistoryCourseCount = merged.scheduledHistoryCourseCount;
          const otherSets = prev.requirementSets.filter((set) => set.id !== RETAKE_SET_ID);
          const otherRequirements = prev.pendingRequirements.filter((requirement) => requirement.setId !== RETAKE_SET_ID);
          return {
            semesters: merged.semesters,
            historyRecords,
            requirementSets: retakeRequirements.length > 0 ? [...otherSets, retakeSet] : otherSets,
            pendingRequirements: [...otherRequirements, ...retakeRequirements],
          };
        })(),
      }));
      setActiveSemesterId(importSemesterId);
      markHistoryMigrated();
      setSchoolPassword('');
      setSchoolSyncStatus('success');
      setSchoolSyncMessage(`已同步完成：最新課表 ${courses.length} 門匯入「${targetSemester.name}」，歷年紀錄 ${historyRecords.length} 筆，${scheduledHistoryCourseCount} 門補到歷史節次，${importedCourseCount} 門寫入學期，${retakeRequirements.length} 門列為待重修。`);
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
    setSchoolPassword,
    handleSchoolUsernameChange,
    syncSchoolData,
  };
}
