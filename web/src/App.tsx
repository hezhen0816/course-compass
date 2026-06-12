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
  findConflicts,
  findScheduledCourseByOffering,
  getRequirementStatus,
  isHistoryImportedCourse,
  mergeHistoryRecordsIntoSemesters,
  normalizeImportPreview,
  normalizeName,
  nextPlannerId,
  parseNodeSlots,
  requirementCourseCode,
  ensureManualSet,
} from './domain/planner';

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

  const activeSemester = data.semesters.find((semester) => semester.id === activeSemesterId) || data.semesters[0];
  const requirementStatuses = useMemo(() => {
    const map = new Map<string, RequirementStatus>();
    data.pendingRequirements.forEach((requirement) => {
      map.set(requirement.id, getRequirementStatus(requirement, data));
    });
    return map;
  }, [data]);
  const completedRequirements = Array.from(requirementStatuses.values()).filter((status) => status.completed).length;
  const pendingSelectionCredits = data.pendingRequirements.reduce((sum, requirement) => (
    sum + (requirement.requiredCredits ?? requirement.credits ?? 0)
  ), 0);
  const pendingSelectionNames = useMemo(() => (
    new Set(data.pendingRequirements.flatMap((requirement) => requirement.courseNames.map(normalizeName)))
  ), [data.pendingRequirements]);
  const activeSemesterCredits = activeSemester?.courses.reduce((sum, course) => (
    sum + (course.category === 'pe' ? 0 : course.credits)
  ), 0) || 0;

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
    if (findScheduledCourseByOffering(offering, data, activeSemesterId)) {
      return false;
    }
    const conflicts = findConflicts(offering, data, activeSemesterId);
    if (conflicts.length > 0 && !force && planningMode !== 'lottery') {
      const names = conflicts.map((course) => course.name).join('、');
      if (!window.confirm(`這門課與 ${names} 衝堂，仍要排入嗎？`)) return false;
    }
    const course = courseFromOffering(offering, requirement);
    const targetSemesterName = data.semesters.find((semester) => semester.id === activeSemesterId)?.name || activeSemesterId;
    setData((prev) => ({
      ...prev,
      semesters: prev.semesters.map((semester) => (
        semester.id === activeSemesterId
          ? { ...semester, courses: [...semester.courses, course] }
          : semester
      )),
      pendingRequirements: requirement?.setId === MANUAL_SET_ID
        ? prev.pendingRequirements.filter((item) => item.id !== requirement.id)
        : prev.pendingRequirements,
    }));
    setPlannerMessage(`已排入 ${targetSemesterName}：${offering.course_name}（${displaySlots(parseNodeSlots(offering.node))}）`);
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

  const deleteCourse = (semesterId: string, courseId: string) => {
    setData((prev) => ({
      ...prev,
      semesters: prev.semesters.map((semester) => (
        semester.id === semesterId
          ? { ...semester, courses: semester.courses.filter((course) => course.id !== courseId) }
          : semester
      )),
    }));
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
        pendingCount={data.pendingRequirements.length}
        onPageChange={setActivePage}
        onOpenHelp={() => setIsOnboardingOpen(true)}
        onExitDemo={() => setIsDemoMode(false)}
      />

      <main className="mx-auto max-w-[1600px] px-4 py-4 sm:px-6 lg:px-8">
        <SafetyNotice />

        {activePage === 'course-search' && (
          <CourseSearchCenter
            data={data}
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
            activeSemesterId={activeSemesterId}
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
            activeSemester={activeSemester}
            activeSemesterId={activeSemesterId}
            planningMode={planningMode}
            plannerMessage={plannerMessage}
            requirementStatuses={requirementStatuses}
            onModeChange={setPlanningMode}
            onSemesterChange={setActiveSemesterId}
            onOpenRequirement={(requirement) => void scheduleRequirementOrChooseOffering(requirement)}
            onDeleteRequirement={deleteRequirement}
            onMoveRequirement={moveRequirement}
            onDeleteCourse={(courseId) => {
              if (activeSemester) deleteCourse(activeSemester.id, courseId);
            }}
            onOpenCourseDetail={(course) => {
              if (activeSemester) {
                setDetailCourse({ semesterId: activeSemester.id, semesterName: activeSemester.name, course });
              }
            }}
          />
        )}

        {activePage === 'settings' && (
          <SettingsPage
            initialSettings={data.targets}
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
            title="畢業門檻"
            description="目前門檻設定已移到設定頁；後續這裡會整理成畢業進度與缺口檢查。"
          />
        )}

        {activePage === 'history' && (
          <PagePlaceholder
            title="歷史修課"
            description="後續會把已修課程與未來預計安排集中到這裡，避免混在課表規劃流程。"
          />
        )}
      </main>

      <AppModals
        activeRequirement={activeRequirement}
        activeSemesterId={activeSemesterId}
        activeSemesterName={activeSemester?.name || activeSemesterId}
        offeringStatus={offeringStatus}
        offeringError={offeringError}
        offeringResults={offeringResults}
        data={data}
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
