import { useEffect, useMemo, useRef, useState } from 'react';
import type { Course, CourseSearchResult, PendingRequirement } from './types';
import { importRequirementsPdf, searchCourses } from './api';
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
  type RequirementStatus,
  courseFromOffering,
  displaySlots,
  fallbackAdmissionYear,
  findConflicts,
  findScheduledCourseByOffering,
  getRequirementStatus,
  inferAdmissionYearFromStudentNo,
  isHistoryImportedCourse,
  mergeHistoryRecordsIntoSemesters,
  normalizeImportPreview,
  normalizeName,
  nextPlannerId,
  parseNodeSlots,
  requirementCourseCode,
  resolveSemesterById,
  semesterIdForAcademicTerm,
  semesterNameForId,
  ensureManualSet,
} from './domain/planner';

const SELECTION_PLAN_SEMESTER_ID = '__selection_plan__';

function requirementFromSelectionCourse(course: Course): PendingRequirement {
  const courseNo = course.scheduledOffering?.courseNo || null;
  return {
    id: `manual-${courseNo || normalizeName(course.name) || 'course'}-${nextPlannerId()}`,
    setId: MANUAL_SET_ID,
    kind: 'course',
    title: course.name,
    credits: course.credits,
    requiredCredits: course.credits,
    courseNames: [course.name],
    options: [{ name: course.name, credits: course.credits, courseNames: [course.name] }],
    note: courseNo ? `從本地草稿課表退回：${courseNo}` : '從本地草稿課表退回',
    courseCodePrefix: courseNo,
  };
}

function hasRequirementForCourse(requirements: PendingRequirement[], course: Course): boolean {
  const courseNo = course.scheduledOffering?.courseNo.trim().toUpperCase() || '';
  const courseName = normalizeName(course.name);
  return requirements.some((requirement) => (
    Boolean(courseNo && requirementCourseCode(requirement) === courseNo)
    || normalizeName(requirement.title) === courseName
    || requirement.courseNames.some((name) => normalizeName(name) === courseName)
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
  const [offeringResults, setOfferingResults] = useState<CourseSearchResult[]>([]);
  const [offeringStatus, setOfferingStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [offeringError, setOfferingError] = useState('');
  const [importPreview, setImportPreview] = useState<ApiImportPreview | null>(null);
  const [importStatus, setImportStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [importError, setImportError] = useState('');
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
    handleSchoolUsernameChange,
    syncSchoolData,
  } = useSchoolSync({
    data,
    setData,
    querySemester,
    setActiveSemesterId,
    markHistoryMigrated: () => {
      hasMigratedHistoryCoursesRef.current = true;
    },
  });
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
  const requirementStatuses = useMemo(() => {
    const map = new Map<string, RequirementStatus>();
    data.pendingRequirements.forEach((requirement) => {
      map.set(requirement.id, getRequirementStatus(requirement, selectionData));
    });
    return map;
  }, [data.pendingRequirements, selectionData]);
  const completedRequirements = Array.from(requirementStatuses.values()).filter((status) => status.completed).length;
  const pendingSelectionCredits = data.pendingRequirements.reduce((sum, requirement) => (
    sum + (requirement.requiredCredits ?? requirement.credits ?? 0)
  ), 0);
  const pendingSelectionNames = useMemo(() => (
    new Set(data.pendingRequirements.flatMap((requirement) => requirement.courseNames.map(normalizeName)))
  ), [data.pendingRequirements]);
  const activeSemesterCredits = selectionCourses.reduce((sum, course) => (
    sum + (course.category === 'pe' ? 0 : course.credits)
  ), 0);

  const handleCloseOnboarding = () => {
    setIsOnboardingOpen(false);
    localStorage.setItem('hasSeenOnboarding', 'true');
  };

  const searchForRequirement = async (requirement: PendingRequirement) => {
    setActiveRequirement(requirement);
    setOfferingStatus('loading');
    setOfferingError('');
    setOfferingResults([]);
    const code = requirementCourseCode(requirement);
    const isCodeLookup = Boolean(code) || (requirement.kind === 'credit_pool' && requirement.courseCodePrefix);
    const query = isCodeLookup ? code || requirement.courseCodePrefix || '' : requirement.courseNames[0] || requirement.title;
    try {
      const results = await searchCourses(querySemester, query, isCodeLookup ? 'code' : 'name');
      const exactCodeResults = code
        ? results.filter((offering) => offering.course_no.trim().toUpperCase() === code)
        : [];
      setOfferingResults(exactCodeResults.length > 0 ? exactCodeResults : results);
      setOfferingStatus('idle');
    } catch (error) {
      setOfferingStatus('error');
      setOfferingError(error instanceof Error ? error.message : '開課查詢失敗');
    }
  };

  const scheduleRequirementOrChooseOffering = async (requirement: PendingRequirement) => {
    const code = requirementCourseCode(requirement);
    if (!code) {
      await searchForRequirement(requirement);
      return;
    }

    setOfferingError('');
    try {
      const results = await searchCourses(querySemester, code, 'code');
      const exactCodeResults = results.filter((offering) => offering.course_no.trim().toUpperCase() === code);
      if (exactCodeResults.length === 1) {
        addCourseToSemester(exactCodeResults[0], requirement);
        return;
      }

      setActiveRequirement(requirement);
      setOfferingStatus('idle');
      setOfferingResults(exactCodeResults.length > 0 ? exactCodeResults : results);
    } catch (error) {
      setActiveRequirement(requirement);
      setOfferingStatus('error');
      setOfferingResults([]);
      setOfferingError(error instanceof Error ? error.message : '開課查詢失敗');
    }
  };

  const addCourseToSemester = (offering: CourseSearchResult, requirement?: PendingRequirement, force = false) => {
    if (findScheduledCourseByOffering(offering, selectionData, SELECTION_PLAN_SEMESTER_ID)) {
      return false;
    }
    const conflicts = findConflicts(offering, selectionData, SELECTION_PLAN_SEMESTER_ID);
    if (conflicts.length > 0 && !force && planningMode !== 'lottery') {
      const names = conflicts.map((course) => course.name).join('、');
      if (!window.confirm(`這門課與 ${names} 衝堂，仍要排入嗎？`)) return false;
    }
    const course = courseFromOffering(offering, requirement);
    setData((prev) => ({
      ...prev,
      selectionPlan: {
        targetAcademicTerm: querySemester,
        targetLabel: selectionTargetLabel,
        courses: [...(prev.selectionPlan?.courses ?? selectionCourses), course],
        updatedAt: new Date().toISOString(),
      },
      pendingRequirements: requirement?.setId === MANUAL_SET_ID
        ? prev.pendingRequirements.filter((item) => item.id !== requirement.id)
        : prev.pendingRequirements,
    }));
    setPlannerMessage(`已加入本地草稿：${offering.course_name}（${displaySlots(parseNodeSlots(offering.node))}）`);
    return true;
  };

  const addOfferingAsRequirement = (offering: CourseSearchResult) => {
    const id = `manual-${offering.course_no || normalizeName(offering.course_name)}-${nextPlannerId()}`;
    const requirement: PendingRequirement = {
      id,
      setId: MANUAL_SET_ID,
      kind: 'course',
      title: offering.course_name,
      credits: offering.credits,
      requiredCredits: offering.credits,
      courseNames: [offering.course_name],
      options: [{ name: offering.course_name, credits: offering.credits, courseNames: [offering.course_name] }],
      note: offering.course_no ? `由課程查詢加入：${offering.course_no}` : '由課程查詢加入',
      courseCodePrefix: offering.course_no || null,
    };
    setData((prev) => ({
      ...prev,
      requirementSets: ensureManualSet(prev),
      pendingRequirements: prev.pendingRequirements.some((item) => (
        Boolean(offering.course_no && requirementCourseCode(item) === offering.course_no)
        || item.courseNames.some((name) => normalizeName(name) === normalizeName(offering.course_name))
      ))
        ? prev.pendingRequirements
        : [...prev.pendingRequirements, requirement],
    }));
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
      const shouldRestoreRequirement = deletedCourse && !hasRequirementForCourse(prev.pendingRequirements, deletedCourse);
      return {
        ...prev,
        requirementSets: shouldRestoreRequirement ? ensureManualSet(prev) : prev.requirementSets,
        pendingRequirements: shouldRestoreRequirement
          ? [...prev.pendingRequirements, requirementFromSelectionCourse(deletedCourse)]
          : prev.pendingRequirements,
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
    if (deletedCourse) setPlannerMessage(`已退回待排需求：${deletedCourse.name}`);
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

  const deleteRequirement = (requirementId: string) => {
    setData((prev) => ({
      ...prev,
      pendingRequirements: prev.pendingRequirements.filter((requirement) => requirement.id !== requirementId),
    }));
  };

  const moveRequirement = (requirementId: string, direction: -1 | 1) => {
    setData((prev) => {
      const currentIndex = prev.pendingRequirements.findIndex((requirement) => requirement.id === requirementId);
      const nextIndex = currentIndex + direction;
      if (currentIndex < 0 || nextIndex < 0 || nextIndex >= prev.pendingRequirements.length) return prev;
      const nextRequirements = [...prev.pendingRequirements];
      const [item] = nextRequirements.splice(currentIndex, 1);
      nextRequirements.splice(nextIndex, 0, item);
      return {
        ...prev,
        pendingRequirements: nextRequirements,
      };
    });
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
        pendingCount={data.pendingRequirements.length + selectionCourses.length}
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
            pendingSelectionCredits={pendingSelectionCredits}
            completedRequirements={completedRequirements}
            requirementStatuses={requirementStatuses}
            pendingSelectionNames={pendingSelectionNames}
            activeSemesterCredits={activeSemesterCredits}
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
            onAddRequirement={addOfferingAsRequirement}
            onScheduleOffering={addCourseToSemester}
            onOpenRequirement={(requirement) => void scheduleRequirementOrChooseOffering(requirement)}
            onDeleteRequirement={deleteRequirement}
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
            requirementStatuses={requirementStatuses}
            onModeChange={setPlanningMode}
            onOpenRequirement={(requirement) => void scheduleRequirementOrChooseOffering(requirement)}
            onDeleteRequirement={deleteRequirement}
            onMoveRequirement={moveRequirement}
            onMoveCourse={moveSelectionCourse}
            onDeleteCourse={deleteSelectionCourse}
          />
        )}

        {activePage === 'settings' && (
          <SettingsPage
            initialSettings={data.targets}
            schoolUsername={schoolUsername}
            selectionTargetLabel={selectionTargetLabel}
            syncStatus={schoolSyncStatus}
            syncMessage={schoolSyncMessage}
            onOpenSchoolSync={openSchoolSyncModal}
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
        schoolUsername={schoolUsername}
        schoolPassword={schoolPassword}
        schoolSyncStatus={schoolSyncStatus}
        schoolSyncMessage={schoolSyncMessage}
        detailCourse={detailCourse}
        isOnboardingOpen={isOnboardingOpen}
        onCloseOffering={() => setActiveRequirement(null)}
        onScheduleOffering={(offering, force) => addCourseToSemester(offering, activeRequirement || undefined, force)}
        onConfirmImport={confirmImportPreview}
        onCloseImport={() => setImportPreview(null)}
        onSchoolUsernameChange={handleSchoolUsernameChange}
        onSchoolPasswordChange={setSchoolPassword}
        onCloseSchoolSync={closeSchoolSyncModal}
        onSyncSchoolData={() => void syncSchoolData()}
        onCloseCourseDetail={() => setDetailCourse(null)}
        onSaveCourseDetail={saveCourseDetail}
        onCloseOnboarding={handleCloseOnboarding}
      />
    </div>
  );
}
