import { useEffect, useMemo, useState } from 'react';
import { fetchCourseSemesters, searchCourses } from '../../api';
import type { CourseSearchResult, CourseSemesterInfo } from '../../types';
import {
  type CapacityFilter,
  type ManualSearchSummary,
  type SearchMode,
  capacityLabel,
  capacityStatus,
  displayClassroom,
  displaySlots,
  formatCredits,
  parseNodeSlots,
} from '../../domain/planner';

export function useCourseSearch() {
  const [querySemester, setQuerySemester] = useState('1142');
  const [courseSemesters, setCourseSemesters] = useState<CourseSemesterInfo[]>([]);
  const [manualQuery, setManualQuery] = useState('');
  const [manualMode, setManualMode] = useState<SearchMode>('name');
  const [manualResults, setManualResults] = useState<CourseSearchResult[]>([]);
  const [manualStatus, setManualStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [manualError, setManualError] = useState('');
  const [manualSearchSummary, setManualSearchSummary] = useState<ManualSearchSummary | null>(null);
  const [teacherFilter, setTeacherFilter] = useState('');
  const [creditFilter, setCreditFilter] = useState('all');
  const [requireOptionFilter, setRequireOptionFilter] = useState('all');
  const [timeFilter, setTimeFilter] = useState('');
  const [capacityFilter, setCapacityFilter] = useState<CapacityFilter>('all');

  useEffect(() => {
    let isActive = true;
    fetchCourseSemesters()
      .then((semesters) => {
        if (!isActive) return;
        setCourseSemesters(semesters);
        const current = semesters.find((semester) => semester.current) || semesters[0];
        if (current?.semester) setQuerySemester(current.semester);
      })
      .catch(() => {
        if (isActive) setCourseSemesters([]);
      });
    return () => {
      isActive = false;
    };
  }, []);

  const canRunManualSearch = manualQuery.trim().length > 0 && manualStatus !== 'loading';
  const currentCourseSemester = courseSemesters.find((semester) => semester.semester === querySemester);
  const currentCourseSemesterLabel = currentCourseSemester?.english_label
    ? `${querySemester}・${currentCourseSemester.english_label}`
    : querySemester;

  const filteredManualResults = useMemo(() => {
    const teacher = teacherFilter.trim().toLowerCase();
    const time = timeFilter.trim().toUpperCase();
    return manualResults.filter((offering) => {
      if (teacher && !offering.teacher.toLowerCase().includes(teacher)) return false;
      if (creditFilter !== 'all' && String(offering.credits ?? '') !== creditFilter) return false;
      if (requireOptionFilter !== 'all' && offering.require_option !== requireOptionFilter) return false;
      if (time && !offering.node.toUpperCase().includes(time)) return false;
      if (capacityFilter !== 'all' && capacityStatus(offering) !== capacityFilter) return false;
      return true;
    });
  }, [capacityFilter, creditFilter, manualResults, requireOptionFilter, teacherFilter, timeFilter]);

  const resetCourseSearchResults = () => {
    setManualResults([]);
    setManualSearchSummary(null);
  };

  const handleQuerySemesterChange = (semester: string) => {
    setQuerySemester(semester);
    resetCourseSearchResults();
  };

  const handleManualModeChange = (mode: SearchMode) => {
    setManualMode(mode);
    resetCourseSearchResults();
  };

  const runManualSearch = async () => {
    const query = manualQuery.trim();
    if (!query) return;
    setManualStatus('loading');
    setManualError('');
    try {
      const results = await searchCourses(querySemester, query, manualMode);
      setManualResults(results);
      setManualSearchSummary({
        query,
        mode: manualMode,
        semester: querySemester,
        resultCount: results.length,
      });
      setManualStatus('idle');
    } catch (error) {
      setManualStatus('error');
      setManualError(error instanceof Error ? error.message : '課程查詢失敗');
    }
  };

  const resetCourseSearchFilters = () => {
    setManualQuery('');
    setTeacherFilter('');
    setCreditFilter('all');
    setRequireOptionFilter('all');
    setTimeFilter('');
    setCapacityFilter('all');
    setManualResults([]);
    setManualSearchSummary(null);
    setManualError('');
    setManualStatus('idle');
  };

  const exportCourseResults = () => {
    if (filteredManualResults.length === 0) return;
    const headers = ['課碼', '課名', '教師', '學分', '節次', '教室', '名額', '備註'];
    const escapeCell = (value: string | number | null | undefined) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const rows = filteredManualResults.map((offering) => [
      offering.course_no,
      offering.course_name,
      offering.teacher,
      formatCredits(offering.credits),
      displaySlots(parseNodeSlots(offering.node)),
      displayClassroom(offering.classroom),
      capacityLabel(offering),
      offering.contents,
    ]);
    const csv = [headers, ...rows].map((row) => row.map(escapeCell).join(',')).join('\n');
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `course-results-${querySemester}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return {
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
  };
}
