import { useEffect, useMemo, useRef, useState } from 'react';
import type { Course, CourseSearchResult, OfficialSelectionSyncResponse, PendingRequirement } from './types';
import {
  addOfficialInitialSelectionWaitlistCourse,
  importRequirementsPdf,
  joinOfficialInitialSelectionCourse,
  keepOfficialInitialSelectionAlive,
  removeOfficialInitialSelectionCourse,
  reorderOfficialInitialSelectionCourses,
  syncOfficialInitialSelection,
} from './api';
import { useAuth } from './hooks/useAuth';
import { useCourseData } from './hooks/useCourseData';
import { AuthPage } from './components/AuthPage';
import { AppModals } from './components/AppModals';
import { Navbar, type AppPage } from './components/Navbar';
import { PagePlaceholder } from './components/PagePlaceholder';
import { SafetyNotice } from './components/SafetyNotice';
import { CourseSearchCenter } from './features/course-search/CourseSearchCenter';
import { useCourseSearch } from './features/course-search/useCourseSearch';
import { CourseTimelinePage } from './features/history/CourseTimelinePage';
import { PlanningWorkspace } from './features/planning/PlanningWorkspace';
import { usePlannerStats } from './features/planning/usePlannerStats';
import { useSchoolSync } from './features/school-sync/useSchoolSync';
import { SettingsPage } from './features/settings/SettingsPage';
import {
  MANUAL_SET_ID,
  type ApiImportPreview,
  type PlanningMode,
  courseFromOffering,
  displaySlots,
  fallbackAdmissionYear,
  findConflicts,
  findScheduledCourseByOffering,
  inferAdmissionYearFromStudentNo,
  isHistoryImportedCourse,
  mergeHistoryRecordsIntoSemesters,
  normalizeImportPreview,
  parseNodeSlots,
  resolveSemesterById,
  semesterIdForAcademicTerm,
  semesterNameForId,
} from './domain/planner';

const SELECTION_PLAN_SEMESTER_ID = '__selection_plan__';

function officialSelectionContainsCourse(payload: OfficialSelectionSyncResponse, courseNo: string): boolean {
  const normalizedCourseNo = courseNo.trim().toUpperCase();
  if (!normalizedCourseNo) return false;
  return [...payload.available_courses, ...payload.registered_courses].some((course) => (
    course.course_no.trim().toUpperCase() === normalizedCourseNo
  ));
}

export default function CoursePlannerWebApp() {
  const { session, loading: authLoading } = useAuth();
  const [isDemoMode, setIsDemoMode] = useState(false);
  const { data, setData, syncStatus, isLoading: dataLoading } = useCourseData(session);
  const [activePage, setActivePage] = useState<AppPage>(() => (
    window.location.hash === '#schedule-preview' ? 'planning' : 'course-search'
  ));
  const [isOnboardingOpen, setIsOnboardingOpen] = useState<boolean>(() => {
    return !localStorage.getItem('hasSeenOnboarding');
  });

  const [activeSemesterId, setActiveSemesterId] = useState('1-1');
  const {
    courseSemesters,
    querySemester,
    currentCourseSemesterLabel,
    manualMode,
    manualQuery,
    manualStatus,
    manualError,
    manualSearchSummary,
    manualResults,
    filteredManualResults,
    teacherFilter,
    creditFilter,
    requireOptionFilter,
    timeFilter,
    capacityFilter,
    canRunManualSearch,
    setManualQuery,
    setTeacherFilter,
    setCreditFilter,
    setRequireOptionFilter,
    setTimeFilter,
    setCapacityFilter,
    handleQuerySemesterChange,
    handleManualModeChange,
    runManualSearch,
    resetCourseSearchFilters,
    exportCourseResults,
  } = useCourseSearch();
  const [planningMode, setPlanningMode] = useState<PlanningMode>('lottery');
  const [activeRequirement, setActiveRequirement] = useState<PendingRequirement | null>(null);
  const [offeringResults] = useState<CourseSearchResult[]>([]);
  const [offeringStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [offeringError] = useState('');
  const [importPreview, setImportPreview] = useState<ApiImportPreview | null>(null);
  const [importStatus, setImportStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [importError, setImportError] = useState('');
  const hasMigratedHistoryCoursesRef = useRef(false);
  const {
    isSchoolSyncOpen,
    schoolUsername,
    schoolPassword,
    rememberSchoolCredentials,
    hasSavedSchoolCredentials,
    schoolSyncStatus,
    schoolSyncMessage,
    openSchoolSyncModal,
    closeSchoolSyncModal,
    setSchoolPassword,
    setRememberSchoolCredentials,
    clearSavedSchoolCredentials,
    saveCredentialsIfNeeded,
    getLatestAccessToken,
    handleSchoolUsernameChange,
    syncSchoolData,
  } = useSchoolSync({
    data,
    setData,
    querySemester,
    accessToken: session?.access_token,
    setActiveSemesterId,
    markHistoryMigrated: () => {
      hasMigratedHistoryCoursesRef.current = true;
    },
  });
  const [schoolSyncModalMode, setSchoolSyncModalMode] = useState<'school-data' | 'official-selection'>('school-data');
  const [officialSelection, setOfficialSelection] = useState<OfficialSelectionSyncResponse | null>(null);
  const [officialSelectionStatus, setOfficialSelectionStatus] = useState<'idle' | 'loading' | 'error' | 'success'>('idle');
  const [officialSelectionMessage, setOfficialSelectionMessage] = useState('');
  const [officialActionCourseNo, setOfficialActionCourseNo] = useState<string | null>(null);
  const [officialOrderStatus, setOfficialOrderStatus] = useState<'idle' | 'loading'>('idle');
  const [detailCourse, setDetailCourse] = useState<{ semesterId: string; semesterName: string; course: Course } | null>(null);
  const [plannerMessage, setPlannerMessage] = useState('');

  useEffect(() => {
    if (hasMigratedHistoryCoursesRef.current || data.historyRecords.length === 0) return;
    if (data.semesters.some((semester) => semester.courses.some(isHistoryImportedCourse))) {
      hasMigratedHistoryCoursesRef.current = true;
      return;
    }
    const merged = mergeHistoryRecordsIntoSemesters(data.semesters, data.historyRecords, schoolUsername);
    if (merged.importedCourseCount === 0) return;
    setData((prev) => {
      if (prev.semesters.some((semester) => semester.courses.some(isHistoryImportedCourse))) return prev;
      const next = mergeHistoryRecordsIntoSemesters(prev.semesters, prev.historyRecords, schoolUsername);
      return next.importedCourseCount > 0 ? { ...prev, semesters: next.semesters } : prev;
    });
    hasMigratedHistoryCoursesRef.current = true;
  }, [data.historyRecords, data.semesters, schoolUsername, setData]);

  const stats = usePlannerStats(data);

  const activeSemester = resolveSemesterById(data.semesters, activeSemesterId) || data.semesters[0];
  const admissionYear = inferAdmissionYearFromStudentNo(schoolUsername) ?? fallbackAdmissionYear(data.historyRecords);
  const inferredSelectionSemesterId = semesterIdForAcademicTerm(querySemester, admissionYear);
  const inferredSelectionSemesterName = inferredSelectionSemesterId ? semesterNameForId(inferredSelectionSemesterId) : null;
  const selectionTargetLabel = `${currentCourseSemesterLabel || querySemester}${inferredSelectionSemesterName ? ` · 推定${inferredSelectionSemesterName}` : ' · 設定校務帳號後可推定年級'}`;
  const legacySelectionCourses = useMemo(() => (
    activeSemester?.courses.filter((course) => !isHistoryImportedCourse(course)) || []
  ), [activeSemester]);
  const selectionCourses = data.selectionPlan?.courses ?? legacySelectionCourses;
  const selectionSemester = useMemo(() => ({
    id: SELECTION_PLAN_SEMESTER_ID,
    name: selectionTargetLabel,
    courses: selectionCourses,
  }), [selectionCourses, selectionTargetLabel]);
  const selectionData = useMemo(() => ({
    ...data,
    semesters: [...data.semesters, selectionSemester],
  }), [data, selectionSemester]);
  const activeSemesterCredits = selectionCourses.reduce((sum, course) => (
    sum + (course.category === 'pe' ? 0 : course.credits)
  ), 0);

  useEffect(() => {
    setOfficialSelection(null);
    setOfficialSelectionStatus('idle');
    setOfficialSelectionMessage('');
  }, [session?.user.id]);

  useEffect(() => {
    if (officialSelection || !data.selectionPlan?.officialSelectionCache) return;
    setOfficialSelection(data.selectionPlan.officialSelectionCache);
    setOfficialSelectionStatus('success');
    setOfficialSelectionMessage('已載入上次同步的官方初選快取；送出前仍以官方最新回應為準。');
  }, [data.selectionPlan?.officialSelectionCache, officialSelection]);

  const updateOfficialSelection = (payload: OfficialSelectionSyncResponse) => {
    setOfficialSelection(payload);
    setData((prev) => ({
      ...prev,
      selectionPlan: {
        ...prev.selectionPlan,
        targetAcademicTerm: prev.selectionPlan?.targetAcademicTerm || querySemester,
        targetLabel: prev.selectionPlan?.targetLabel || selectionTargetLabel,
        courses: prev.selectionPlan?.courses ?? selectionCourses,
        officialSelectionCache: payload,
        updatedAt: new Date().toISOString(),
      },
    }));
  };

  useEffect(() => {
    const username = officialSelection?.school_account || schoolUsername.trim();
    if (!officialSelection?.session_valid || !username) return undefined;

    const keepAlive = async () => {
      try {
        const accessToken = await getLatestAccessToken();
        const payload = await keepOfficialInitialSelectionAlive(username, accessToken || undefined);
        if (!payload.session_valid) {
          setOfficialSelection((current) => (
            current ? { ...current, session_valid: false } : current
          ));
          setOfficialSelectionStatus('error');
          setOfficialSelectionMessage('官方選課 session 已失效，請重新同步官方初選資料。');
        }
      } catch (error) {
        console.warn('Official selection keep-alive failed', error);
      }
    };

    const timer = window.setInterval(() => {
      void keepAlive();
    }, 4 * 60 * 1000);

    return () => window.clearInterval(timer);
  }, [getLatestAccessToken, officialSelection?.school_account, officialSelection?.session_valid, schoolUsername]);

  const handleCloseOnboarding = () => {
    setIsOnboardingOpen(false);
    localStorage.setItem('hasSeenOnboarding', 'true');
  };

  const addCourseToSemester = (
    offering: CourseSearchResult,
    requirement?: PendingRequirement,
    force = false,
    virtualReason?: string,
  ) => {
    if (findScheduledCourseByOffering(offering, selectionData, SELECTION_PLAN_SEMESTER_ID)) {
      setPlannerMessage(`已在虛擬課程中：${offering.course_name}`);
      return false;
    }
    const conflicts = findConflicts(offering, selectionData, SELECTION_PLAN_SEMESTER_ID);
    if (conflicts.length > 0 && !force && planningMode !== 'lottery') {
      const names = conflicts.map((course) => course.name).join('、');
      if (!window.confirm(`這門課與 ${names} 衝堂，仍要排入嗎？`)) return false;
    }
    const course: Course = {
      ...courseFromOffering(offering, requirement),
      virtualSelection: {
        status: virtualReason ? 'rejected' : 'manual',
        reason: virtualReason || '手動加入虛擬課表，尚未送入官方選課系統。',
        createdAt: new Date().toISOString(),
      },
    };
    setData((prev) => ({
      ...prev,
      selectionPlan: {
        ...prev.selectionPlan,
        targetAcademicTerm: prev.selectionPlan?.targetAcademicTerm || querySemester,
        targetLabel: prev.selectionPlan?.targetLabel || selectionTargetLabel,
        courses: [...(prev.selectionPlan?.courses ?? selectionCourses), course],
        updatedAt: new Date().toISOString(),
      },
      pendingRequirements: requirement?.setId === MANUAL_SET_ID
        ? prev.pendingRequirements.filter((item) => item.id !== requirement.id)
        : prev.pendingRequirements,
    }));
    setPlannerMessage(`已加入虛擬課表：${offering.course_name}（${displaySlots(parseNodeSlots(offering.node))}）`);
    return true;
  };

  const handlePdfUpload = async (file: File | undefined) => {
    if (!file) return;
    setImportStatus('loading');
    setImportError('');
    try {
      const preview = await importRequirementsPdf(file);
      setImportPreview(preview as unknown as ApiImportPreview);
      setImportStatus('idle');
    } catch (error) {
      setImportStatus('error');
      setImportError(error instanceof Error ? error.message : 'PDF 匯入失敗');
    }
  };

  const confirmImportPreview = () => {
    if (!importPreview) return;
    setData((prev) => {
      const normalized = normalizeImportPreview(importPreview, prev);
      return {
        ...prev,
        requirementSets: [...prev.requirementSets, normalized.set],
        pendingRequirements: [...prev.pendingRequirements, ...normalized.requirements],
      };
    });
    setImportPreview(null);
  };

  const deleteSelectionCourse = (courseId: string) => {
    const deletedCourse = selectionCourses.find((course) => course.id === courseId);
    setData((prev) => {
      return {
        ...prev,
        selectionPlan: prev.selectionPlan
          ? {
              ...prev.selectionPlan,
              courses: prev.selectionPlan.courses.filter((course) => course.id !== courseId),
              updatedAt: new Date().toISOString(),
            }
          : undefined,
        semesters: prev.selectionPlan
          ? prev.semesters
          : prev.semesters.map((semester) => (
              semester.id === activeSemester?.id
                ? { ...semester, courses: semester.courses.filter((course) => course.id !== courseId) }
                : semester
            )),
      };
    });
    if (deletedCourse) setPlannerMessage(`已移除虛擬課程：${deletedCourse.name}`);
  };

  const moveSelectionCourse = (courseId: string, direction: -1 | 1) => {
    const moveCourse = (courses: Course[]) => {
      const currentIndex = courses.findIndex((course) => course.id === courseId);
      const nextIndex = currentIndex + direction;
      if (currentIndex < 0 || nextIndex < 0 || nextIndex >= courses.length) return courses;
      const nextCourses = [...courses];
      const [course] = nextCourses.splice(currentIndex, 1);
      nextCourses.splice(nextIndex, 0, course);
      return nextCourses;
    };

    setData((prev) => {
      if (prev.selectionPlan) {
        const nextCourses = moveCourse(prev.selectionPlan.courses);
        if (nextCourses === prev.selectionPlan.courses) return prev;
        return {
          ...prev,
          selectionPlan: {
            ...prev.selectionPlan,
            courses: nextCourses,
            updatedAt: new Date().toISOString(),
          },
        };
      }

      return {
        ...prev,
        semesters: prev.semesters.map((semester) => (
          semester.id === activeSemester?.id
            ? { ...semester, courses: moveCourse(semester.courses) }
            : semester
        )),
      };
    });
  };

  const saveCourseDetail = (updatedCourse: Course) => {
    if (!detailCourse) return;
    setData((prev) => ({
      ...prev,
      semesters: prev.semesters.map((semester) => (
        semester.id === detailCourse.semesterId
          ? {
              ...semester,
              courses: semester.courses.map((course) => (
                course.id === updatedCourse.id ? updatedCourse : course
              )),
            }
          : semester
      )),
    }));
    setDetailCourse(null);
  };

  const openSchoolDataSync = () => {
    setSchoolSyncModalMode('school-data');
    openSchoolSyncModal();
  };

  const openOfficialSelectionSync = (message?: string) => {
    const nextMessage = typeof message === 'string' ? message : '';
    setSchoolSyncModalMode('official-selection');
    setOfficialSelectionStatus(nextMessage ? 'error' : 'idle');
    setOfficialSelectionMessage(nextMessage);
    openSchoolSyncModal();
  };

  const requestOfficialSelectionSync = () => {
    if (schoolUsername.trim() && (schoolPassword.trim() || hasSavedSchoolCredentials)) {
      void syncOfficialSelectionData();
      return;
    }
    openOfficialSelectionSync(
      hasSavedSchoolCredentials
        ? '已保存校務帳密，但目前尚未載入密碼，請稍候再試或重新登入 App。'
        : '尚未保存校務密碼，請輸入校務帳密後同步一次。',
    );
  };

  const submitOfficialSelectionCourse = async (
    action: 'waitlist' | 'join' | 'remove',
    courseNo: string,
    courseName: string,
  ) => {
    const normalizedCourseNo = courseNo.trim().toUpperCase();
    if (!normalizedCourseNo) {
      window.alert('缺少課碼，無法送出官方選課請求。');
      return;
    }

    const username = officialSelection?.school_account || schoolUsername.trim();
    if (!username || (!officialSelection?.session_valid && !hasSavedSchoolCredentials)) {
      openOfficialSelectionSync('請先同步官方初選資料，取得有效官方 session 後再送出登記。');
      return;
    }

    const actionLabel = action === 'waitlist'
      ? '加入官方待選清單'
      : action === 'join'
        ? '加入官方初選登記'
        : '取消官方初選登記';
    const confirmed = window.confirm(
      `即將${actionLabel}：${normalizedCourseNo} ${courseName || ''}\n\n只會送出一次，不會自動重試、輪詢名額或排程送出。確定繼續？`,
    );
    if (!confirmed) return;

    setOfficialActionCourseNo(normalizedCourseNo);
    setOfficialSelectionStatus('loading');
    setOfficialSelectionMessage(`正在${actionLabel}...`);
    try {
      const accessToken = await getLatestAccessToken();
      const payload = action === 'join'
        ? await joinOfficialInitialSelectionCourse(username, normalizedCourseNo, accessToken || undefined)
        : action === 'waitlist'
          ? await addOfficialInitialSelectionWaitlistCourse(username, normalizedCourseNo, accessToken || undefined)
          : await removeOfficialInitialSelectionCourse(username, normalizedCourseNo, accessToken || undefined);
      updateOfficialSelection(payload);
      setOfficialSelectionStatus('success');
      setOfficialSelectionMessage(`官方已回傳最新狀態：已登記 ${payload.registered_count} 門，待加入 ${payload.available_count} 門。`);
      setPlannerMessage(`官方已${action === 'waitlist' ? '加入待選' : action === 'join' ? '加入登記' : '取消登記'}：${normalizedCourseNo}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : '官方選課請求失敗。';
      setOfficialSelectionStatus('error');
      setOfficialSelectionMessage(message);
      window.alert(message);
    } finally {
      setOfficialActionCourseNo(null);
    }
  };

  const submitSelectionCourse = async (offering: CourseSearchResult) => {
    const normalizedCourseNo = offering.course_no.trim().toUpperCase();
    if (!normalizedCourseNo) {
      window.alert('缺少課碼，無法加入選課清單。');
      return;
    }

    const username = officialSelection?.school_account || schoolUsername.trim();
    if (!username || (!officialSelection?.session_valid && !hasSavedSchoolCredentials)) {
      openOfficialSelectionSync('請先同步官方初選資料，再加入選課清單。');
      return;
    }

    const confirmed = window.confirm(
      `即將送到官方待選清單：${normalizedCourseNo} ${offering.course_name}\n\n若官方拒絕或未接受，會改以「虛擬加入」標示在課表上。此操作只會送出一次，不會自動重試。確定繼續？`,
    );
    if (!confirmed) return;

    setOfficialActionCourseNo(normalizedCourseNo);
    setOfficialSelectionStatus('loading');
    setOfficialSelectionMessage('正在送到官方待選清單...');
    try {
      const accessToken = await getLatestAccessToken();
      const payload = await addOfficialInitialSelectionWaitlistCourse(username, normalizedCourseNo, accessToken || undefined);
      updateOfficialSelection(payload);
      if (officialSelectionContainsCourse(payload, normalizedCourseNo)) {
        setOfficialSelectionStatus('success');
        setOfficialSelectionMessage(`官方已回傳最新狀態：已登記 ${payload.registered_count} 門，待加入 ${payload.available_count} 門。`);
        setPlannerMessage(`官方已加入選課清單：${normalizedCourseNo}`);
        return;
      }

      const reason = payload.notices[0] || '官方回應未將此課加入待選或登記清單。';
      addCourseToSemester(offering, undefined, true, reason);
      setOfficialSelectionStatus('error');
      setOfficialSelectionMessage(`官方未接受 ${normalizedCourseNo}，已加入虛擬課表：${reason}`);
      setPlannerMessage(`已虛擬加入：${offering.course_name}。原因：${reason}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : '官方選課請求失敗。';
      const shouldRequireResync = /Session|重新同步|登入|帳號|密碼/.test(message);
      setOfficialSelectionStatus('error');
      setOfficialSelectionMessage(message);
      if (shouldRequireResync) {
        window.alert(message);
        return;
      }
      addCourseToSemester(offering, undefined, true, message);
      setPlannerMessage(`已虛擬加入：${offering.course_name}。原因：${message}`);
      window.alert(`官方未接受，已加入虛擬課表。\n原因：${message}`);
    } finally {
      setOfficialActionCourseNo(null);
    }
  };

  const saveOfficialSelectionOrder = async (orderedCourseNos: string[]) => {
    const username = officialSelection?.school_account || schoolUsername.trim();
    if (!username || !officialSelection || (!officialSelection.session_valid && !hasSavedSchoolCredentials)) {
      openOfficialSelectionSync('請先同步官方初選資料，取得有效官方 session 後再儲存志願序。');
      return;
    }

    const normalizedCourseNos = orderedCourseNos
      .map((courseNo) => courseNo.trim().toUpperCase())
      .filter(Boolean);
    if (normalizedCourseNos.length !== officialSelection.registered_courses.length) {
      window.alert('官方志願序資料不完整，請重新同步後再調整。');
      return;
    }

    const confirmed = window.confirm(
      `即將儲存官方志願序：\n${normalizedCourseNos.map((courseNo, index) => `${index + 1}. ${courseNo}`).join('\n')}\n\n只會送出一次，不會自動重試、輪詢名額或排程送出。確定繼續？`,
    );
    if (!confirmed) return;

    setOfficialOrderStatus('loading');
    setOfficialSelectionStatus('loading');
    setOfficialSelectionMessage('正在儲存官方志願序...');
    try {
      const accessToken = await getLatestAccessToken();
      const payload = await reorderOfficialInitialSelectionCourses(username, normalizedCourseNos, accessToken || undefined);
      updateOfficialSelection(payload);
      setOfficialSelectionStatus('success');
      setOfficialSelectionMessage(`官方已回傳最新志願序：已登記 ${payload.registered_count} 門。`);
      setPlannerMessage('官方志願序已儲存。');
    } catch (error) {
      const message = error instanceof Error ? error.message : '官方志願序儲存失敗。';
      setOfficialSelectionStatus('error');
      setOfficialSelectionMessage(message);
      window.alert(message);
    } finally {
      setOfficialOrderStatus('idle');
    }
  };

  const syncOfficialSelectionData = async () => {
    const username = schoolUsername.trim();
    const password = schoolPassword.trim();
    if (!username) {
      setOfficialSelectionStatus('error');
      setOfficialSelectionMessage('請輸入校務系統帳號。');
      return;
    }
    if (!password && !hasSavedSchoolCredentials) {
      setOfficialSelectionStatus('error');
      setOfficialSelectionMessage('請輸入校務系統密碼，或先勾選保存並成功同步一次。');
      return;
    }

    setOfficialSelectionStatus('loading');
    setOfficialSelectionMessage('正在讀取官方初選登記頁...');
    try {
      const accessToken = await getLatestAccessToken();
      const payload = await syncOfficialInitialSelection(username, password, accessToken || undefined);
      updateOfficialSelection(payload);
      let credentialMessage = '';
      if (rememberSchoolCredentials && password) {
        try {
          await saveCredentialsIfNeeded(username, password);
          credentialMessage = '校務帳密已加密保存。';
          setSchoolPassword('');
        } catch (error) {
          credentialMessage = `但帳密保存失敗：${error instanceof Error ? error.message : '未知錯誤'}`;
        }
      } else if (hasSavedSchoolCredentials && !password) {
        credentialMessage = '已使用保存帳密重新登入官方系統。';
      }
      setOfficialSelectionStatus('success');
      setOfficialSelectionMessage(`已同步官方初選：已登記 ${payload.registered_count} 門，待加入 ${payload.available_count} 門。${credentialMessage ? ` ${credentialMessage}` : ''}`);
      if (!rememberSchoolCredentials) setSchoolPassword('');
    } catch (error) {
      setOfficialSelectionStatus('error');
      setOfficialSelectionMessage(error instanceof Error ? error.message : '官方初選同步失敗。');
    }
  };

  if (authLoading || (session && dataLoading)) {
    return <div className="min-h-screen flex items-center justify-center bg-gray-50">載入中...</div>;
  }

  if (!session && !isDemoMode) {
    return <AuthPage onDemoLogin={() => setIsDemoMode(true)} />;
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <Navbar
        userEmail={session?.user?.email || '略過登入'}
        syncStatus={session ? syncStatus : 'idle'}
        isDemoMode={isDemoMode}
        activePage={activePage}
        pendingCount={(officialSelection?.registered_count || 0) + (officialSelection?.available_count || 0) + selectionCourses.length}
        onPageChange={setActivePage}
        onOpenHelp={() => setIsOnboardingOpen(true)}
        onExitDemo={() => setIsDemoMode(false)}
      />

      <main className="mx-auto max-w-[1600px] px-4 py-4 sm:px-6 lg:px-8">
        <SafetyNotice />

        {activePage === 'course-search' && (
          <CourseSearchCenter
            data={selectionData}
            courseSemesters={courseSemesters}
            querySemester={querySemester}
            currentCourseSemesterLabel={currentCourseSemesterLabel}
            manualMode={manualMode}
            manualQuery={manualQuery}
            manualStatus={manualStatus}
            manualError={manualError}
            manualSearchSummary={manualSearchSummary}
            manualResults={manualResults}
            filteredManualResults={filteredManualResults}
            teacherFilter={teacherFilter}
            creditFilter={creditFilter}
            requireOptionFilter={requireOptionFilter}
            timeFilter={timeFilter}
            capacityFilter={capacityFilter}
            importStatus={importStatus}
            importError={importError}
            canRunManualSearch={canRunManualSearch}
            virtualCourseCredits={activeSemesterCredits}
            activeSemesterId={SELECTION_PLAN_SEMESTER_ID}
            onQuerySemesterChange={handleQuerySemesterChange}
            onManualModeChange={handleManualModeChange}
            onManualQueryChange={setManualQuery}
            onTeacherFilterChange={setTeacherFilter}
            onCreditFilterChange={setCreditFilter}
            onRequireOptionFilterChange={setRequireOptionFilter}
            onTimeFilterChange={setTimeFilter}
            onCapacityFilterChange={setCapacityFilter}
            onRunManualSearch={() => void runManualSearch()}
            onResetFilters={resetCourseSearchFilters}
            onPdfUpload={(file) => void handlePdfUpload(file)}
            onExportResults={exportCourseResults}
            officialActionCourseNo={officialActionCourseNo}
            onAddSelectionCourse={(offering) => void submitSelectionCourse(offering)}
            onDeleteVirtualCourse={deleteSelectionCourse}
            onOpenPlanning={() => setActivePage('planning')}
          />
        )}

        {activePage === 'planning' && (
          <PlanningWorkspace
            data={data}
            stats={stats}
            activeSemester={selectionSemester}
            planningMode={planningMode}
            plannerMessage={plannerMessage}
            officialSelection={officialSelection}
            officialActionCourseNo={officialActionCourseNo}
            officialOrderStatus={officialOrderStatus}
            onModeChange={setPlanningMode}
            onJoinOfficialCourse={(courseNo, courseName) => void submitOfficialSelectionCourse('join', courseNo, courseName)}
            onRemoveOfficialCourse={(courseNo, courseName) => void submitOfficialSelectionCourse('remove', courseNo, courseName)}
            onSaveOfficialOrder={(orderedCourseNos) => void saveOfficialSelectionOrder(orderedCourseNos)}
            onMoveCourse={moveSelectionCourse}
            onDeleteCourse={deleteSelectionCourse}
          />
        )}

        {activePage === 'settings' && (
          <SettingsPage
            initialSettings={data.targets}
            schoolUsername={schoolUsername}
            selectionTargetLabel={selectionTargetLabel}
            hasSavedSchoolCredentials={hasSavedSchoolCredentials}
            syncStatus={schoolSyncStatus}
            syncMessage={schoolSyncMessage}
            officialSelectionStatus={officialSelectionStatus}
            officialSelectionMessage={officialSelectionMessage}
            onOpenSchoolSync={openSchoolDataSync}
            onOpenOfficialSelectionSync={requestOfficialSelectionSync}
            onClearSavedSchoolCredentials={() => void clearSavedSchoolCredentials()}
            onSaveTargets={(targets) => {
              setData((prev) => ({ ...prev, targets }));
            }}
          />
        )}

        {activePage === 'graduation' && (
          <PagePlaceholder
            title="畢業進度"
            description="這裡會專注顯示畢業條件完成度、缺口學分與尚未滿足的課程類別；門檻數字改到設定頁維護。"
          />
        )}

        {activePage === 'history' && (
          <CourseTimelinePage
            data={data}
            onOpenCourseDetail={(semesterId, semesterName, course) => {
              setDetailCourse({ semesterId, semesterName, course });
            }}
          />
        )}
      </main>

      <AppModals
        activeRequirement={activeRequirement}
        activeSemesterId={SELECTION_PLAN_SEMESTER_ID}
        activeSemesterName={selectionTargetLabel}
        offeringStatus={offeringStatus}
        offeringError={offeringError}
        offeringResults={offeringResults}
        data={selectionData}
        planningMode={planningMode}
        importPreview={importPreview}
        isSchoolSyncOpen={isSchoolSyncOpen}
        schoolSyncMode={schoolSyncModalMode}
        schoolUsername={schoolUsername}
        schoolPassword={schoolPassword}
        rememberSchoolCredentials={rememberSchoolCredentials}
        schoolSyncStatus={schoolSyncModalMode === 'official-selection' ? officialSelectionStatus : schoolSyncStatus}
        schoolSyncMessage={schoolSyncModalMode === 'official-selection' ? officialSelectionMessage : schoolSyncMessage}
        detailCourse={detailCourse}
        isOnboardingOpen={isOnboardingOpen}
        onCloseOffering={() => setActiveRequirement(null)}
        onScheduleOffering={(offering, force) => addCourseToSemester(offering, activeRequirement || undefined, force)}
        onConfirmImport={confirmImportPreview}
        onCloseImport={() => setImportPreview(null)}
        onSchoolUsernameChange={handleSchoolUsernameChange}
        onSchoolPasswordChange={setSchoolPassword}
        onRememberSchoolCredentialsChange={setRememberSchoolCredentials}
        onCloseSchoolSync={closeSchoolSyncModal}
        onSyncSchoolData={() => {
          if (schoolSyncModalMode === 'official-selection') {
            void syncOfficialSelectionData();
            return;
          }
          void syncSchoolData();
        }}
        onCloseCourseDetail={() => setDetailCourse(null)}
        onSaveCourseDetail={saveCourseDetail}
        onCloseOnboarding={handleCloseOnboarding}
      />
    </div>
  );
}
