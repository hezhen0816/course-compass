import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AppSettings, Course, CourseSearchResult, GpaApiKeyStatus, OfficialSelectionSyncResponse, PendingRequirement } from '../shared/types';
import {
  addOfficialInitialSelectionWaitlistCourse,
  deleteGpaApiKey,
  getGpaApiKeyStatus,
  joinOfficialInitialSelectionCourse,
  keepOfficialInitialSelectionAlive,
  removeOfficialInitialSelectionCourse,
  reorderOfficialInitialSelectionCourses,
  saveGpaApiKey,
  syncOfficialInitialSelection,
  importRequirementsPdf,
} from '../shared/api';
import { currentEnrollmentPhase } from '../shared/domain/enrollmentCalendar';
import { findOfferingConflicts } from '../shared/domain/scheduleConflicts';
import type { SchoolSyncMode } from '../features/school-sync/SchoolScheduleSyncModal';
import { getAccessToken } from '../shared/supabase';
import { useAuth } from '../shared/hooks/useAuth';
import { useCourseData } from '../shared/hooks/useCourseData';
import { AuthPage } from './AuthPage';
import { AppModals } from './AppModals';
import { Navbar, type AppPage } from './Navbar';
import { UpdateNotice } from './UpdateNotice';
import { CourseSearchCenter } from '../features/course-search/CourseSearchCenter';
import { useCourseSearch } from '../features/course-search/useCourseSearch';
import { RecordPage } from '../features/history/RecordPage';
import { ThresholdsPage, type RequirementEdit } from '../features/thresholds/ThresholdsPage';
import { PlanningWorkspace } from '../features/planning/PlanningWorkspace';
import { usePlannerStats } from '../features/planning/usePlannerStats';
import { MultiSemesterPage } from '../features/multi-semester/MultiSemesterPage';
import { useSchoolSync } from '../features/school-sync/useSchoolSync';
import { SemesterPage } from '../features/semester/SemesterPage';
import { SettingsPage } from '../features/settings/SettingsPage';
import { MonitorPage } from '../features/monitor/MonitorPage';
import MonitorSettingsView from '../features/monitor/MonitorSettingsView';
import ProxyView from '../features/monitor/ProxyView';
import { addMonitoredCourse } from '../features/monitor/addMonitoredCourse';
import {
  MANUAL_SET_ID,
  type ApiImportPreview,
  type PlanningMode,
  courseFromOffering,
  displaySlots,
  fallbackAdmissionYear,
  findScheduledCourseByOffering,
  inferAdmissionYearFromStudentNo,
  isHistoryImportedCourse,
  mergeHistoryRecordsIntoSemesters,
  normalizeImportPreview,
  importPreviewSets,
  parseNodeSlots,
  programFromOfferingSettings,
  resolveSemesterById,
  semesterIdForAcademicTerm,
  semesterNameForId,
} from '../shared/domain/planner';

const SELECTION_PLAN_SEMESTER_ID = '__selection_plan__';
const DOUBLE_MAJOR_TODO_SET_ID = 'manual-double-major-todo';
const MINOR_TODO_SET_ID = 'manual-minor-todo';

type PendingCourseGroup = 'double_major' | 'minor';

function splitPendingCourseNames(courseName: string): string[] {
  const names = courseName
    .split(/[／/、,，]/)
    .map((item) => item.trim())
    .filter(Boolean);
  return names.length > 0 ? names : [courseName.trim()].filter(Boolean);
}

function officialSelectionContainsCourse(payload: OfficialSelectionSyncResponse, courseNo: string): boolean {
  const normalizedCourseNo = courseNo.trim().toUpperCase();
  if (!normalizedCourseNo) return false;
  if ([...payload.available_courses, ...payload.registered_courses].some((course) => (
    course.course_no.trim().toUpperCase() === normalizedCourseNo
  ))) return true;
  // 加退選期加成功的課只會出現在正式選課清單（D01），初選的待加入／登記清單看不到。
  return payload.selection_list_rows.some((row) => (
    Object.values(row).some((value) => String(value).trim().toUpperCase() === normalizedCourseNo)
  ));
}

function programForCourseOffering(
  offering: CourseSearchResult,
  requirement: PendingRequirement | undefined,
  settings?: AppSettings,
) {
  return requirement?.setId === DOUBLE_MAJOR_TODO_SET_ID
    ? 'double_major'
    : requirement?.setId === MINOR_TODO_SET_ID
      ? 'minor'
      : programFromOfferingSettings(offering, settings);
}

/** 換頁後元素要等 React 畫出來才存在，短間隔重試幾次再捲過去。
 *  用 setTimeout 而非 requestAnimationFrame：分頁在背景時 rAF 不會觸發。 */
function scrollToWhenReady(id: string, retries = 40, intervalMs = 50) {
  let left = retries;
  const tick = () => {
    const target = document.getElementById(id);
    if (target) {
      // 窄螢幕的導覽是頂端 sticky 列，直接對齊 top 會被它蓋住，扣掉它的高度；寬螢幕是側欄，不用扣
      const navRect = document.querySelector('[data-app-nav]')?.getBoundingClientRect();
      const navHeight = navRect && navRect.width > window.innerWidth / 2 ? navRect.height : 0;
      window.scrollTo({ top: target.getBoundingClientRect().top + window.scrollY - navHeight - 8 });
      return;
    }
    if (left-- > 0) window.setTimeout(tick, intervalMs);
  };
  window.setTimeout(tick, 0);
}


const PAGE_HASHES: AppPage[] = ['semester', 'course-search', 'planning', 'multi-semester', 'monitor', 'record', 'thresholds', 'settings'];

/** 分頁與網址同步：拆成多頁後來回切換變頻繁，重新整理或上一頁不該掉回預設頁。 */
function pageFromHash(hash: string): AppPage {
  const value = hash.replace(/^#/, '');
  if (value === 'schedule-preview') return 'planning';
  return (PAGE_HASHES as string[]).includes(value) ? (value as AppPage) : 'course-search';
}

export default function CoursePlannerWebApp() {
  const { session, loading: authLoading } = useAuth();
  const [isDemoMode, setIsDemoMode] = useState(false);
  const [monitorActionCourseNo, setMonitorActionCourseNo] = useState<string | null>(null);
  const [gpaApiKeyStatus, setGpaApiKeyStatus] = useState<GpaApiKeyStatus | null>(null);

  useEffect(() => {
    if (!session) {
      setGpaApiKeyStatus(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const token = await getAccessToken();
        if (!token) return;
        const status = await getGpaApiKeyStatus(token);
        if (!cancelled) setGpaApiKeyStatus(status);
      } catch {
        // 後端不可達時就當作未設定，不打斷其他功能
      }
    })();
    return () => { cancelled = true; };
  }, [session]);

  const saveGpaApiKeySettings = async (apiKey: string, enabled: boolean) => {
    const token = await getAccessToken();
    if (!token) throw new Error('請先登入後再保存 GPA 密鑰。');
    setGpaApiKeyStatus(await saveGpaApiKey(token, apiKey, enabled));
  };

  const deleteGpaApiKeySettings = async () => {
    const token = await getAccessToken();
    if (!token) throw new Error('請先登入後再刪除 GPA 密鑰。');
    setGpaApiKeyStatus(await deleteGpaApiKey(token));
  };

  const addMonitorCourse = async (offering: CourseSearchResult) => {
    if (isDemoMode || !session) {
      alert('略過登入模式無法加入監聽，請先登入。');
      return;
    }
    const code = offering.course_no.trim().toUpperCase();
    setMonitorActionCourseNo(code);
    try {
      const result = await addMonitoredCourse(offering);
      alert(result.message);
    } finally {
      setMonitorActionCourseNo(null);
    }
  };
  const { data, setData, syncStatus, isLoading: dataLoading } = useCourseData(session);
  const [activePage, setActivePage] = useState<AppPage>(() => pageFromHash(window.location.hash));
  const scrollByPage = useRef<Partial<Record<AppPage, number>>>({});
  const changePage = useCallback((next: AppPage) => {
    setActivePage((current) => {
      if (current === next) return current;
      scrollByPage.current[current] = window.scrollY;
      return next;
    });
    if (window.location.hash.replace(/^#/, '') !== next) {
      window.history.pushState(null, '', `#${next}`);
    }
  }, []);

  useEffect(() => {
    const onPopState = () => setActivePage(pageFromHash(window.location.hash));
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    window.scrollTo(0, scrollByPage.current[activePage] ?? 0);
  }, [activePage]);

  const [isOnboardingOpen, setIsOnboardingOpen] = useState<boolean>(() => {
    return !localStorage.getItem('hasSeenOnboarding');
  });

  const [activeSemesterId, setActiveSemesterId] = useState('1-1');
  const {
    courseSemesters,
    courseSemestersError,
    querySemester,
    currentCourseSemesterLabel,
    manualMode,
    manualQuery,
    exactCourseNameSearch,
    includeCrossSchool,
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
    setExactCourseNameSearch,
    setIncludeCrossSchool,
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
  // 預設模式跟著教務處時程表：加退選期進來就該看到選課清單，而不是空的初選面板。
  // querySemester 初始是寫死的值、要等 /api/courses/semesters 回來才正確，所以用 effect 補；
  // 使用者手動切過之後就不再覆蓋他的選擇。
  const [planningMode, setPlanningMode] = useState<PlanningMode>('lottery');
  const planningModeChosenRef = useRef(false);
  const choosePlanningMode = (mode: PlanningMode) => {
    planningModeChosenRef.current = true;
    setPlanningMode(mode);
  };

  useEffect(() => {
    if (planningModeChosenRef.current) return;
    const phase = currentEnrollmentPhase(querySemester);
    if (phase.kind === 'addDrop') setPlanningMode('addDrop');
    else if (phase.kind === 'preregistration') setPlanningMode('lottery');
  }, [querySemester]);
  const [activeRequirement, setActiveRequirement] = useState<PendingRequirement | null>(null);
  const [offeringResults] = useState<CourseSearchResult[]>([]);
  const [offeringStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [offeringError] = useState('');
  const [importPreview, setImportPreview] = useState<ApiImportPreview | null>(null);
  const hasMigratedHistoryCoursesRef = useRef(false);
  const {
    isSchoolSyncOpen,
    schoolUsername,
    schoolPassword,
    schoolSyncStatus,
    schoolSyncMessage,
    openSchoolSyncModal,
    closeSchoolSyncModal,
    setSchoolPassword,
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
    onOfficialScheduleRowsSynced: (rows) => {
      setOfficialSelection((current) => (current ? { ...current, schedule_rows: rows } : current));
    },
  });
  // 預設分頁跟著選課階段：加退選期開「目前選課」，初選期開「初選志願登記」
  const [schoolSyncModalMode, setSchoolSyncModalMode] = useState<SchoolSyncMode>('courses');
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
  // 學校那邊實際選上的課：校務同步把選課清單寫進推定學期的 courses
  const enrolledSemester = inferredSelectionSemesterId
    ? resolveSemesterById(data.semesters, inferredSelectionSemesterId)
    : undefined;
  const enrolledCourses = useMemo(() => (
    enrolledSemester?.courses.filter((course) => !isHistoryImportedCourse(course)) || []
  ), [enrolledSemester]);
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
    setOfficialSelectionMessage('已載入上次同步資料；校務連線到期後請重新同步。');
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
          setOfficialSelectionMessage('官方選課 session 已失效，請重新同步官方選課狀態。');
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
    const existingCourse = findScheduledCourseByOffering(offering, selectionData, SELECTION_PLAN_SEMESTER_ID);
    const courseProgram = programForCourseOffering(offering, requirement, data.settings);
    if (existingCourse && virtualReason && existingCourse.virtualSelection) {
      setData((prev) => ({
        ...prev,
        selectionPlan: {
          ...prev.selectionPlan,
          targetAcademicTerm: prev.selectionPlan?.targetAcademicTerm || querySemester,
          targetLabel: prev.selectionPlan?.targetLabel || selectionTargetLabel,
          courses: (prev.selectionPlan?.courses ?? selectionCourses).map((course) => (
            course.id === existingCourse.id
              ? {
                  ...course,
                  virtualSelection: {
                    status: 'rejected',
                    reason: virtualReason,
                    createdAt: new Date().toISOString(),
                  },
                }
              : course
          )),
          updatedAt: new Date().toISOString(),
        },
      }));
      setPlannerMessage(`已更新待加簽規劃原因：${offering.course_name}`);
      return true;
    }
    if (existingCourse) {
      if (requirement) {
        setData((prev) => ({
          ...prev,
          selectionPlan: prev.selectionPlan
            ? {
                ...prev.selectionPlan,
                courses: prev.selectionPlan.courses.map((course) => (
                  course.id === existingCourse.id
                    ? {
                        ...course,
                        program: courseProgram,
                        sourceRequirementId: requirement.id,
                        sourceSetId: requirement.setId,
                        virtualSelection: {
                          status: 'manual',
                          reason: `本地未來規劃，認列到：${requirement.title}`,
                          createdAt: course.virtualSelection?.createdAt || new Date().toISOString(),
                        },
                      }
                    : course
                )),
                updatedAt: new Date().toISOString(),
              }
            : prev.selectionPlan,
        }));
        setPlannerMessage(`已更新未來規劃認列：${offering.course_name} → ${requirement.title}`);
        return true;
      }
      setPlannerMessage(`已在未來規劃中：${offering.course_name}`);
      return false;
    }
    const conflicts = findOfferingConflicts(offering, selectionData);
    if (conflicts.length > 0 && !force && planningMode !== 'lottery') {
      const names = conflicts.map((course) => course.name).join('、');
      if (!window.confirm(`這門課與 ${names} 衝堂，仍要排入嗎？`)) return false;
    }
    const course: Course = {
      ...courseFromOffering(offering, requirement, courseProgram),
      virtualSelection: {
        status: virtualReason ? 'rejected' : 'manual',
        reason: virtualReason || (requirement ? `本地未來規劃，認列到：${requirement.title}` : '本地未來規劃，尚未送入官方選課系統。'),
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
    setPlannerMessage(`${virtualReason ? '已加入待加簽規劃' : '已加入未來規劃'}：${offering.course_name}（${displaySlots(parseNodeSlots(offering.node))}）`);
    return true;
  };

  const confirmImportPreview = () => {
    if (!importPreview) return;
    setData((prev) => {
      let next = prev;
      for (const rawSet of importPreviewSets(importPreview)) {
        const normalized = normalizeImportPreview(rawSet, next);
        next = {
          ...next,
          requirementSets: [...next.requirementSets, normalized.set],
          pendingRequirements: [...next.pendingRequirements, ...normalized.requirements],
        };
      }
      return next;
    });
    setImportPreview(null);
  };

  const importRequirementsFromPdf = async (file: File): Promise<string> => {
    try {
      const token = await getAccessToken();
      if (!token) return '請先登入再匯入。';
      const preview = await importRequirementsPdf(file, token);
      setImportPreview(preview as unknown as ApiImportPreview);
      return '';
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  };

  const deleteRequirementSet = (setId: string) => {
    setData((prev) => ({
      ...prev,
      requirementSets: prev.requirementSets.filter((set) => set.id !== setId),
      pendingRequirements: prev.pendingRequirements.filter((requirement) => requirement.setId !== setId),
    }));
  };

  const addPendingCourseName = (group: PendingCourseGroup, courseName: string) => {
    const normalizedCourseName = courseName.trim();
    if (!normalizedCourseName) return;
    const setId = group === 'double_major' ? DOUBLE_MAJOR_TODO_SET_ID : MINOR_TODO_SET_ID;
    const setName = group === 'double_major' ? '雙主修待修' : '輔系待修';
    setData((prev) => {
      const alreadyExists = prev.pendingRequirements.some((requirement) => (
        requirement.setId === setId
        && requirement.title.trim().toLowerCase() === normalizedCourseName.toLowerCase()
      ));
      if (alreadyExists) return prev;
      const nextSet = prev.requirementSets.some((set) => set.id === setId)
        ? prev.requirementSets
        : [
            ...prev.requirementSets,
            {
              id: setId,
              name: setName,
              source: 'manual' as const,
              totalCredits: null,
              notes: ['手動登記待修課程'],
            },
          ];
      return {
        ...prev,
        requirementSets: nextSet,
        pendingRequirements: [
          ...prev.pendingRequirements,
          {
            id: `${setId}-${Date.now()}`,
            setId,
            kind: 'course',
            title: normalizedCourseName,
            credits: null,
            courseNames: [normalizedCourseName],
            options: [],
            note: '手動登記待修課程',
          },
        ],
      };
    });
  };

  const deletePendingCourseName = (requirementId: string) => {
    setData((prev) => ({
      ...prev,
      pendingRequirements: prev.pendingRequirements.filter((requirement) => requirement.id !== requirementId),
    }));
  };

  /** 需求列就地編輯：改可認列課名與課碼前綴。取代原本的「新增認列規則」。 */
  const updateRequirement = (requirementId: string, edit: RequirementEdit) => {
    setData((prev) => ({
      ...prev,
      pendingRequirements: prev.pendingRequirements.map((requirement) => (
        requirement.id === requirementId
          ? { ...requirement, courseNames: edit.courseNames, courseCodePrefix: edit.courseCodePrefix }
          : requirement
      )),
    }));
  };

  const searchPendingCourseName = (courseName: string) => {
    const courseNames = splitPendingCourseNames(courseName);
    const displayQuery = courseNames.join(' / ');
    handleManualModeChange('name');
    setManualQuery(displayQuery);
    void runManualSearch({ query: displayQuery, queries: courseNames, mode: 'name' });
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
    if (deletedCourse) setPlannerMessage(`已移除待加簽課程：${deletedCourse.name}`);
  };

  const saveCourseDetail = (updatedCourse: Course) => {
    if (!detailCourse) return;
    setData((prev) => ({
      ...prev,
      selectionPlan: detailCourse.semesterId === SELECTION_PLAN_SEMESTER_ID && prev.selectionPlan
        ? {
            ...prev.selectionPlan,
            courses: prev.selectionPlan.courses.map((course) => (
              course.id === updatedCourse.id ? updatedCourse : course
            )),
            updatedAt: new Date().toISOString(),
          }
        : prev.selectionPlan,
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

  const openSchoolDataSync = (mode: SchoolSyncMode = 'courses') => {
    setSchoolSyncModalMode(mode);
    openSchoolSyncModal();
  };

  const openOfficialSelectionSync = (message?: string) => {
    const nextMessage = typeof message === 'string' ? message : '';
    setSchoolSyncModalMode('preregistration');
    setOfficialSelectionStatus(nextMessage ? 'error' : 'idle');
    setOfficialSelectionMessage(nextMessage);
    openSchoolSyncModal();
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
    if (!username || !officialSelection?.session_valid) {
      openOfficialSelectionSync('請先同步官方選課狀態，取得有效官方 session 後再送出登記。');
      return;
    }

    const actionLabel = action === 'waitlist'
      ? '加入待加入清單'
      : action === 'join'
        ? '加入登記志願'
        : '取消登記志願';
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
    if (!username || !officialSelection?.session_valid) {
      openOfficialSelectionSync('請先同步官方選課狀態，再加入選課清單。');
      return;
    }

    const confirmed = window.confirm(
      `即將送到官方待加入清單：${normalizedCourseNo} ${offering.course_name}\n\n若官方拒絕或未接受，會改以「待加簽」標示在課表上。此操作只會送出一次，不會自動重試。確定繼續？`,
    );
    if (!confirmed) return;

    setOfficialActionCourseNo(normalizedCourseNo);
    setOfficialSelectionStatus('loading');
    setOfficialSelectionMessage('正在送到官方待加入清單...');
    try {
      const accessToken = await getLatestAccessToken();
      // 加退選期要打 B01，打初選的 A02 官方會默默不做事、也不回訊息。
      const period = currentEnrollmentPhase(querySemester).kind === 'addDrop' ? 'B01' : 'A02';
      const payload = await addOfficialInitialSelectionWaitlistCourse(username, normalizedCourseNo, accessToken || undefined, period);
      updateOfficialSelection(payload);
      if (officialSelectionContainsCourse(payload, normalizedCourseNo)) {
        setOfficialSelectionStatus('success');
        setOfficialSelectionMessage(`官方已回傳最新狀態：已登記 ${payload.registered_count} 門，待加入 ${payload.available_count} 門。`);
        setPlannerMessage(`官方已加入選課清單：${normalizedCourseNo}`);
        return;
      }

      // 只拿官方對「這次動作」的回覆；`notices` 還混著選課系統首頁的公告，不能拿來當拒絕原因。
      const reason = payload.action_notices?.[0] || '官方未回覆明確原因，只是沒把這門課加進待選或登記清單。';
      addCourseToSemester(offering, undefined, true, reason);
      // 同步本身是成功的（官方有回最新清單），被拒的是這門課；拒絕原因只在課程／規劃訊息裡講，
      // 不要讓設定頁的「初選志願登記」同步列變紅、掛著一門課的拒絕理由。
      setOfficialSelectionStatus('success');
      setOfficialSelectionMessage(`官方已回傳最新狀態：已登記 ${payload.registered_count} 門，待加入 ${payload.available_count} 門。`);
      setPlannerMessage(`已列入待加簽：${offering.course_name}。原因：${reason}`);
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
      setPlannerMessage(`已列入待加簽：${offering.course_name}。原因：${message}`);
      window.alert(`官方未接受，已加入待加簽規劃。\n原因：${message}`);
    } finally {
      setOfficialActionCourseNo(null);
    }
  };

  const addPlannedCourse = (offering: CourseSearchResult, requirementId?: string) => {
    const requirement = requirementId
      ? data.pendingRequirements.find((item) => item.id === requirementId)
      : undefined;
    addCourseToSemester(offering, requirement, true);
  };

  const saveOfficialSelectionOrder = async (orderedCourseNos: string[]) => {
    const username = officialSelection?.school_account || schoolUsername.trim();
    if (!username || !officialSelection || !officialSelection.session_valid) {
      openOfficialSelectionSync('請先同步官方選課狀態，取得有效官方 session 後再儲存志願序。');
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
    if (!password) {
      setOfficialSelectionStatus('error');
      setOfficialSelectionMessage('請輸入校務系統密碼。');
      return;
    }

    setOfficialSelectionStatus('loading');
    setOfficialSelectionMessage('正在讀取官方選課狀態...');
    try {
      const accessToken = await getLatestAccessToken();
      const payload = await syncOfficialInitialSelection(username, password, accessToken || undefined);
      updateOfficialSelection(payload);
      setOfficialSelectionStatus('success');
      setOfficialSelectionMessage(`已同步官方選課狀態：已登記 ${payload.registered_count} 門，待加入 ${payload.available_count} 門。`);
      setSchoolPassword('');
    } catch (error) {
      setOfficialSelectionStatus('error');
      setOfficialSelectionMessage(error instanceof Error ? error.message : '官方選課狀態同步失敗。');
    }
  };

  if (authLoading || (session && dataLoading)) {
    return <div className="min-h-screen flex items-center justify-center bg-paper text-ink-2">載入中...</div>;
  }

  if (!session && !isDemoMode) {
    return <AuthPage onDemoLogin={() => setIsDemoMode(true)} />;
  }

  return (
    <div className="min-h-screen bg-paper text-ink lg:flex">
      <Navbar
        userEmail={session?.user?.email || '略過登入'}
        syncStatus={session ? syncStatus : 'idle'}
        isDemoMode={isDemoMode}
        activePage={activePage}
        pendingCount={(officialSelection?.registered_count || 0) + (officialSelection?.available_count || 0) + selectionCourses.length}
        onPageChange={changePage}
        onOpenHelp={() => setIsOnboardingOpen(true)}
        onExitDemo={() => setIsDemoMode(false)}
      />

      <main className="mx-auto w-full min-w-0 max-w-[1600px] px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
        <UpdateNotice />

        {activePage === 'course-search' && (
          <CourseSearchCenter
            data={selectionData}
            courseSemesters={courseSemesters}
            courseSemestersError={courseSemestersError}
            querySemester={querySemester}
            currentCourseSemesterLabel={currentCourseSemesterLabel}
            manualMode={manualMode}
            manualQuery={manualQuery}
            exactCourseNameSearch={exactCourseNameSearch}
            includeCrossSchool={includeCrossSchool}
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
            canRunManualSearch={canRunManualSearch}
            virtualCourseCredits={activeSemesterCredits}
            activeSemesterId={SELECTION_PLAN_SEMESTER_ID}
            onQuerySemesterChange={handleQuerySemesterChange}
            onManualModeChange={handleManualModeChange}
            onManualQueryChange={setManualQuery}
            onExactCourseNameSearchChange={setExactCourseNameSearch}
            onIncludeCrossSchoolChange={setIncludeCrossSchool}
            onTeacherFilterChange={setTeacherFilter}
            onCreditFilterChange={setCreditFilter}
            onRequireOptionFilterChange={setRequireOptionFilter}
            onTimeFilterChange={setTimeFilter}
            onCapacityFilterChange={setCapacityFilter}
            onRunManualSearch={() => void runManualSearch()}
            onResetFilters={resetCourseSearchFilters}
            onExportResults={exportCourseResults}
            onAddPendingCourse={addPendingCourseName}
            onDeletePendingCourse={deletePendingCourseName}
            onSearchPendingCourse={searchPendingCourseName}
            officialActionCourseNo={officialActionCourseNo}
            onAddSelectionCourse={(offering) => void submitSelectionCourse(offering)}
            onAddPlannedCourse={addPlannedCourse}
            onAddMonitorCourse={(offering) => void addMonitorCourse(offering)}
            monitorActionCourseNo={monitorActionCourseNo}
            onDeleteVirtualCourse={deleteSelectionCourse}
            onOpenPlanning={() => changePage('planning')}
            schoolUsername={schoolUsername}
          />
        )}

        {activePage === 'planning' && (
          <PlanningWorkspace
            data={data}
            stats={stats}
            activeSemester={selectionSemester}
            enrolledCourses={enrolledCourses}
            querySemester={querySemester}
            planningMode={planningMode}
            plannerMessage={plannerMessage}
            officialSelection={officialSelection}
            officialActionCourseNo={officialActionCourseNo}
            officialOrderStatus={officialOrderStatus}
            onModeChange={choosePlanningMode}
            onJoinOfficialCourse={(courseNo, courseName) => void submitOfficialSelectionCourse('join', courseNo, courseName)}
            onRemoveOfficialCourse={(courseNo, courseName) => void submitOfficialSelectionCourse('remove', courseNo, courseName)}
            onSaveOfficialOrder={(orderedCourseNos) => void saveOfficialSelectionOrder(orderedCourseNos)}
            onDeleteCourse={deleteSelectionCourse}
          />
        )}

        {activePage === 'semester' && (
          <SemesterPage
            data={data}
            onGoToCourseSearch={() => changePage('course-search')}
            onGoToPlanning={() => changePage('planning')}
          />
        )}

        {activePage === 'monitor' && (
          <MonitorPage
            onGoToCourseSearch={() => changePage('course-search')}
            onGoToSettings={() => {
              // 從監控頁過來的人要找的是監控設定，不是設定頁最上面的同步狀態
              changePage('settings');
              scrollToWhenReady('monitor-settings');
            }}
          />
        )}

        {activePage === 'settings' && (
          <SettingsPage
            initialSettings={data.targets}
            schoolUsername={schoolUsername}
            selectionTargetLabel={selectionTargetLabel}
            syncStatus={schoolSyncStatus}
            syncMessage={schoolSyncMessage}
            schoolSync={data.schoolSync}
            officialSelection={officialSelection}
            officialSelectionStatus={officialSelectionStatus}
            officialSelectionMessage={officialSelectionMessage}
            gpaApiKeyStatus={gpaApiKeyStatus}
            initialProgramDepartmentSettings={data.settings?.programDepartments}
            onOpenSchoolSync={openSchoolDataSync}
            onOpenOfficialSelectionSync={() => openOfficialSelectionSync()}
            monitorSettings={(
              <>
                <MonitorSettingsView />
                <ProxyView />
              </>
            )}
            onSaveTargets={(targets) => {
              setData((prev) => ({ ...prev, targets }));
            }}
            onSaveGpaApiKey={saveGpaApiKeySettings}
            onDeleteGpaApiKey={deleteGpaApiKeySettings}
            onSaveProgramDepartmentSettings={(programDepartments) => {
              setData((prev) => ({
                ...prev,
                settings: {
                  ...(prev.settings || {}),
                  programDepartments,
                },
              }));
            }}
          />
        )}

        {activePage === 'record' && (
          <RecordPage
            data={data}
            onOpenCourseDetail={(semesterId: string, semesterName: string, course: Course) => {
              setDetailCourse({ semesterId, semesterName, course });
            }}
          />
        )}

        {activePage === 'multi-semester' && (
          <MultiSemesterPage
            data={data}
            querySemester={querySemester}
            schoolUsername={schoolUsername}
            gpaEnabled={Boolean(gpaApiKeyStatus?.enabled)}
            onSavePlan={(plan) => setData((prev) => ({ ...prev, multiSemesterPlan: plan }))}
          />
        )}

        {activePage === 'thresholds' && (
          <ThresholdsPage
            data={data}
            stats={stats}
            onUpdateRequirement={updateRequirement}
            onImportRequirementsPdf={importRequirementsFromPdf}
            onDeleteRequirementSet={deleteRequirementSet}
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
        enrollmentPhaseLabel={currentEnrollmentPhase(querySemester).label}
        isPreregistrationPhase={currentEnrollmentPhase(querySemester).kind === 'preregistration'}
        onSchoolSyncModeChange={setSchoolSyncModalMode}
        schoolUsername={schoolUsername}
        schoolPassword={schoolPassword}
        schoolSyncStatus={schoolSyncModalMode === 'preregistration' ? officialSelectionStatus : schoolSyncStatus}
        schoolSyncMessage={schoolSyncModalMode === 'preregistration' ? officialSelectionMessage : schoolSyncMessage}
        detailCourse={detailCourse}
        isOnboardingOpen={isOnboardingOpen}
        onCloseOffering={() => setActiveRequirement(null)}
        onScheduleOffering={(offering, force) => addCourseToSemester(offering, activeRequirement || undefined, force)}
        onConfirmImport={confirmImportPreview}
        onCloseImport={() => setImportPreview(null)}
        onSchoolUsernameChange={handleSchoolUsernameChange}
        onSchoolPasswordChange={setSchoolPassword}
        onCloseSchoolSync={closeSchoolSyncModal}
        onSyncSchoolData={() => {
          if (schoolSyncModalMode === 'preregistration') {
            void syncOfficialSelectionData();
            return;
          }
          // 課表與成績分開：只按到的那一項才會去打對應的學校頁面
          void syncSchoolData(schoolSyncModalMode === 'history'
            ? { includeSchedule: false, includeHistory: true }
            : { includeSchedule: true, includeHistory: false });
        }}
        onCloseCourseDetail={() => setDetailCourse(null)}
        onSaveCourseDetail={saveCourseDetail}
        onCloseOnboarding={handleCloseOnboarding}
      />
    </div>
  );
}
