import { guessCurrentSemester } from '../../shared/domain/planner';
import { getAccessToken } from '../../shared/supabase';
import { useEffect, useMemo, useState } from 'react';
import { fetchCourseSemesters, searchCourses } from '../../shared/api';
import type { CourseSearchResult, CourseSemesterInfo, } from '../../shared/types';
import { gpaInlineLabel } from '../../shared/domain/gpa';
import { parseCourseDepartment } from '../../shared/domain/courseDepartments';
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
} from '../../shared/domain/planner';


function normalizeCourseName(name: string): string {
  return name
    .replace(/[（）]/g, (match) => (match === '（' ? '(' : ')'))
    .replace(/\s+/g, '')
    .trim();
}

function splitCourseNameQueries(query: string): string[] {
  return query
    .split(/[／/、,，]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

/** 'F1,F2 F3、F4' → Set；與後端 _parse_node_filter 同一套分隔符。 */
function parseNodes(value: string): Set<string> {
  return new Set(value.toUpperCase().split(/[,、\s]+/).map((part) => part.trim()).filter(Boolean));
}

/** 課程的所有節次都落在 wanted 之內才算符合——與後端 _matches_nodes 同一條規則。
 *  用「全部落在」而不是「有碰到」：填 F1,F2,F3,F4 是要找填得進那段空檔的課，
 *  一門跨到週三、只碰到 F1 的課不該入列。 */
function nodesWithin(courseNode: string, wanted: Set<string>): boolean {
  const nodes = parseNodes(courseNode);
  if (nodes.size === 0) return false;
  return [...nodes].every((node) => wanted.has(node));
}

export function useCourseSearch() {
  // 由日期推算，等 /api/courses/semesters 回來再校正；寫死會過期
  const [querySemester, setQuerySemester] = useState(guessCurrentSemester);
  const [courseSemesters, setCourseSemesters] = useState<CourseSemesterInfo[]>([]);
  // 清單載不到時只剩推算出來的當學期一個選項，看起來像「只能查這學期」，
  // 所以要把失敗原因留下來顯示，不要吞掉。
  const [courseSemestersError, setCourseSemestersError] = useState('');
  const [manualQuery, setManualQuery] = useState('');
  const [manualMode, setManualMode] = useState<SearchMode>('name');
  const [exactCourseNameSearch, setExactCourseNameSearch] = useState(false);
  // Off by default: 台大/師大 cross-school sections are rarely selectable, so
  // they only appear when explicitly requested (matches the school site's list).
  const [includeCrossSchool, setIncludeCrossSchool] = useState(false);
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
        setCourseSemestersError('');
        const current = semesters.find((semester) => semester.current) || semesters[0];
        if (current?.semester) setQuerySemester(current.semester);
      })
      .catch((error: unknown) => {
        if (!isActive) return;
        setCourseSemesters([]);
        setCourseSemestersError(error instanceof Error ? error.message : '學期清單載入失敗。');
      });
    return () => {
      isActive = false;
    };
  }, []);

  // 課名、教師、節次任一個有填就能查——後端也是這條規則（至少一個條件）。
  const canRunManualSearch = (
    manualQuery.trim().length > 0 || teacherFilter.trim().length > 0 || timeFilter.trim().length > 0
  ) && manualStatus !== 'loading';
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
      if (time && !nodesWithin(offering.node, parseNodes(time))) return false;
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
    if (mode === 'code') setExactCourseNameSearch(false);
    resetCourseSearchResults();
  };

  const runManualSearch = async (override?: { query?: string; queries?: string[]; mode?: SearchMode }) => {
    const overrideQueries = override?.queries
      ?.map((item) => item.trim())
      .filter(Boolean);
    const rawQuery = (override?.query ?? manualQuery).trim();
    const mode = override?.mode ?? manualMode;
    const queries = overrideQueries && overrideQueries.length > 0
      ? overrideQueries
      : mode === 'name' && exactCourseNameSearch
        ? splitCourseNameQueries(rawQuery)
        : undefined;
    const query = (queries && queries.length > 0 ? queries.join(' / ') : rawQuery).trim();
    // 課名可以留空：只填教師或節次也是一次合法查詢（「週五 1-4 節有哪些課」本來就沒有課名）。
    const filters = { teacher: teacherFilter.trim(), node: timeFilter.trim() };
    if (!query && !filters.teacher && !filters.node) return;
    setManualStatus('loading');
    setManualError('');
    try {
      // 登入時帶 token，後端才會用已保存的 GPA 密鑰補上 GPA
      const accessToken = await getAccessToken();
      const searchQueries = queries && queries.length > 0 ? queries : [query];
      const resultGroups = await Promise.all(
        searchQueries.map((searchQuery) => searchCourses(
          querySemester, searchQuery, mode, accessToken || undefined, includeCrossSchool, filters,
        )),
      );
      const seen = new Set<string>();
      const exactNames = mode === 'name' && exactCourseNameSearch
        ? new Set(searchQueries.map(normalizeCourseName))
        : null;
      const results = resultGroups.flat().filter((offering) => {
        if (exactNames && !exactNames.has(normalizeCourseName(offering.course_name))) return false;
        const key = [
          offering.course_no.trim().toUpperCase(),
          offering.course_name.trim(),
          offering.teacher.trim(),
          offering.node.trim(),
        ].join('|');
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      setManualResults(results);
      setManualSearchSummary({
        query,
        mode,
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
    setExactCourseNameSearch(false);
    setIncludeCrossSchool(false);
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
    const headers = ['課碼', '開課系所', '課名', '教師', '學分', 'GPA', '節次', '教室', '名額', '備註'];
    const escapeCell = (value: string | number | null | undefined) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const rows = filteredManualResults.map((offering) => [
      offering.course_no,
      parseCourseDepartment(offering.course_no)?.name || '',
      offering.course_name,
      offering.teacher,
      formatCredits(offering.credits),
      gpaInlineLabel(offering, offering.course_no),
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
  };
}
