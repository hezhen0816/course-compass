import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileText,
  KeyRound,
  Loader2,
  ArrowDown,
  ArrowUp,
  Trash2,
  Upload,
} from 'lucide-react';
import type {
  AcademicHistoryRecord,
  AppData,
  Course,
  CourseCategory,
  CourseProgram,
  HistoryCourseRecord,
  HistoryImportResponse,
  CourseSearchResult,
  CourseSemesterInfo,
  PendingRequirement,
  PlannerStats,
  RequirementOption,
  RequirementSet,
  ScheduleSyncResponse,
  ScheduledOffering,
  SyncedCourseRow,
} from './types';
import { fetchCourseSemesters, importAcademicHistory, importRequirementsPdf, searchCourses, syncSchoolSchedule } from './api';
import { useAuth } from './hooks/useAuth';
import { useCourseData } from './hooks/useCourseData';
import { AuthPage } from './components/AuthPage';
import { Navbar } from './components/Navbar';
import { SettingsModal } from './components/SettingsModal';
import { OnboardingModal } from './components/OnboardingModal';
import { CourseDetailModal } from './components/CourseDetailModal';

const DAY_COLUMNS = [
  { code: 'M', label: '一' },
  { code: 'T', label: '二' },
  { code: 'W', label: '三' },
  { code: 'R', label: '四' },
  { code: 'F', label: '五' },
  { code: 'S', label: '六' },
  { code: 'U', label: '日' },
];

const PERIODS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'A', 'B', 'C', 'D'];
const MANUAL_SET_ID = 'manual-requirements';
const RETAKE_SET_ID = 'retake-requirements';
const HISTORY_IMPORT_NOTE_MARKER = '已修紀錄匯入';
let generatedIdCounter = 0;

type SearchMode = 'name' | 'code';
type ApiImportPreview = {
  requirement_set: Record<string, unknown>;
  pending_requirements: Array<Record<string, unknown>>;
  warnings: string[];
  raw_text_preview: string;
};

type RequirementStatus = {
  completed: boolean;
  earnedCredits: number;
  targetCredits: number;
  scheduledCount: number;
};

type ManualSearchSummary = {
  query: string;
  mode: SearchMode;
  semester: string;
  resultCount: number;
};

type CapacityStatus = 'available' | 'full' | 'unknown';
type CapacityFilter = 'all' | CapacityStatus;
type PlanningMode = 'lottery' | 'addDrop' | 'addCode';

type HistoricalScheduleLookup = {
  status: 'matched' | 'ambiguous' | 'missing' | 'skipped';
  candidateCount: number;
  offering?: CourseSearchResult;
};

function parseNodeSlots(node: string): string[] {
  return (node || '')
    .split(/[,、\s]+/)
    .map((slot) => slot.trim().toUpperCase())
    .filter(Boolean);
}

function displaySlots(slots: string[]): string {
  return slots.length > 0 ? slots.join(', ') : '未提供節次';
}

function displayClassroom(classroom: string | null | undefined): string {
  return classroom?.trim() || '教室未公告';
}

function formatCredits(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '0';
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function capacityStatus(offering: CourseSearchResult): CapacityStatus {
  if (offering.capacity === null || offering.capacity === undefined || offering.selected_count === null || offering.selected_count === undefined) {
    return 'unknown';
  }
  return offering.selected_count >= offering.capacity ? 'full' : 'available';
}

function capacityLabel(offering: CourseSearchResult): string {
  if (offering.capacity === null || offering.capacity === undefined || offering.selected_count === null || offering.selected_count === undefined) {
    return '未公告';
  }
  return `${offering.selected_count} / ${offering.capacity}`;
}

function requirementLabel(value: string): string {
  if (value === 'R') return '必修';
  if (value === 'E') return '選修';
  return value || '未列';
}

function requirementCourseCode(requirement: PendingRequirement): string {
  const explicit = requirement.courseCodePrefix?.trim();
  if (explicit) return explicit.toUpperCase();
  const noteMatch = requirement.note?.match(/[A-Z]{2,}\d+[A-Z0-9]*/i);
  return noteMatch?.[0]?.toUpperCase() || '';
}

function nextPlannerId(): string {
  generatedIdCounter += 1;
  return `${generatedIdCounter}`;
}

function inferCourseCategory(offering: CourseSearchResult): CourseCategory {
  const name = offering.course_name.toLowerCase();
  const code = offering.course_no.toUpperCase();
  if (code.startsWith('PE') || name.includes('體育')) return 'pe';
  if (name.includes('國文') || name.includes('中文')) return 'chinese';
  if (name.includes('英文') || name.includes('english') || name.includes('英語')) return 'english';
  if (name.includes('社會實踐')) return 'social';
  if (code.startsWith('GE') || offering.dimension) return 'gen_ed';
  if (offering.require_option === 'R') return 'compulsory';
  if (offering.require_option === 'E') return 'elective';
  return 'unclassified';
}

function toScheduledOffering(offering: CourseSearchResult): ScheduledOffering {
  return {
    semester: offering.semester,
    courseNo: offering.course_no,
    courseName: offering.course_name,
    teacher: offering.teacher,
    credits: offering.credits,
    classroom: offering.classroom,
    node: offering.node,
    slots: parseNodeSlots(offering.node),
    requireOption: offering.require_option,
    contents: offering.contents,
  };
}

function courseFromOffering(
  offering: CourseSearchResult,
  requirement?: PendingRequirement,
  program: CourseProgram = requirement ? 'double_major' : 'other'
): Course {
  const scheduledOffering = toScheduledOffering(offering);
  const credits = offering.credits ?? requirement?.credits ?? requirement?.requiredCredits ?? 0;
  return {
    id: `${offering.course_no || offering.course_name}-${nextPlannerId()}`,
    name: offering.course_name,
    credits,
    category: inferCourseCategory(offering),
    program,
    dimension: offering.dimension ? 'None' : undefined,
    sourceRequirementId: requirement?.id,
    sourceSetId: requirement?.setId,
    scheduledOffering,
    details: {
      professor: offering.teacher,
      location: offering.classroom,
      time: displaySlots(scheduledOffering.slots),
      gradingPolicy: [],
      notes: offering.contents,
    },
  };
}

function categoryFromSyncedCourse(course: SyncedCourseRow): CourseCategory {
  const name = course.course_name.toLowerCase();
  const code = course.course_code.toUpperCase();
  if (code.startsWith('PE') || name.includes('體育')) return 'pe';
  if (name.includes('國文') || name.includes('中文') || name.includes('文學閱讀')) return 'chinese';
  if (name.includes('英文') || name.includes('english') || name.includes('英語')) return 'english';
  if (code.startsWith('GE')) return 'gen_ed';
  if (course.required_type === '必修') return 'compulsory';
  if (course.required_type === '選修') return 'elective';
  return 'unclassified';
}

function slotCodeFromSyncedSlot(slot: ScheduleSyncResponse['slots'][number]): string {
  const weekdayCodes: Record<string, string> = {
    monday: 'M',
    tuesday: 'T',
    wednesday: 'W',
    thursday: 'R',
    friday: 'F',
    saturday: 'S',
    sunday: 'U',
  };
  const dayCode = weekdayCodes[slot.weekday_key] || '';
  return dayCode && slot.period ? `${dayCode}${slot.period}` : '';
}

function uniqueTextValues(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  values.forEach((value) => {
    const text = value?.trim();
    if (!text || seen.has(text)) return;
    seen.add(text);
    normalized.push(text);
  });
  return normalized;
}

function coursesFromScheduleSync(payload: ScheduleSyncResponse): Course[] {
  return payload.courses.map((course) => {
    const matchingSlots = payload.slots.filter((slot) => slot.course_name === course.course_name);
    const slots = uniqueTextValues(matchingSlots.map(slotCodeFromSyncedSlot));
    const classrooms = uniqueTextValues(matchingSlots.map((slot) => slot.location));
    const classroomText = classrooms.join(', ');
    const credits = typeof course.credits === 'number' ? course.credits : Number(course.credits) || 0;
    const scheduledOffering: ScheduledOffering = {
      semester: '1151',
      courseNo: course.course_code,
      courseName: course.course_name,
      teacher: course.professor,
      credits,
      classroom: classroomText,
      node: slots.join(', '),
      slots,
      requireOption: course.required_type,
      contents: course.note,
    };
    return {
      id: `school-${course.course_code || normalizeName(course.course_name)}-${nextPlannerId()}`,
      name: course.course_name,
      credits,
      category: categoryFromSyncedCourse(course),
      program: 'home',
      scheduledOffering,
      details: {
        professor: course.professor,
        location: classroomText,
        time: displaySlots(slots),
        gradingPolicy: [],
        notes: course.note,
      },
    };
  });
}

function sanitizedHistoryCourseName(value: string): string {
  return value.replace(/★|◆/g, '').trim();
}

function isZeroCreditCourse(record: HistoryCourseRecord): boolean {
  const name = record.course_name;
  const code = record.course_code.toUpperCase();
  return code.startsWith('PE') || name.includes('體育');
}

function isFailedHistoryRecord(record: HistoryCourseRecord): boolean {
  const grade = record.grade.trim().toUpperCase();
  if (!grade || grade === '修習中') return false;
  if (['E', 'F', 'X'].includes(grade) || grade.includes('不及格')) return true;
  const credits = Number(record.earned_credits);
  return Number.isFinite(credits) && credits <= 0 && !isZeroCreditCourse(record);
}

function historyStatus(record: HistoryCourseRecord): AcademicHistoryRecord['status'] {
  if (['修習中', '成績未到'].includes(record.grade.trim())) return 'in_progress';
  if (isFailedHistoryRecord(record)) return 'failed';
  return 'passed';
}

function historyRecordKey(record: Pick<AcademicHistoryRecord, 'courseCode' | 'courseName'>): string {
  return record.courseCode.trim().toUpperCase() || normalizeName(record.courseName);
}

function historicalLookupKey(record: AcademicHistoryRecord): string {
  return `${record.academicTerm}-${historyRecordKey(record)}`;
}

function inferAdmissionYearFromStudentNo(studentNo: string): number | null {
  const match = studentNo.trim().toUpperCase().match(/^[A-Z]?(\d{3})/);
  if (!match) return null;
  const year = Number(match[1]);
  return Number.isFinite(year) ? year : null;
}

function fallbackAdmissionYear(records: AcademicHistoryRecord[]): number | null {
  let earliestYear: number | null = null;
  records.forEach((record) => {
    const match = record.academicTerm.trim().match(/^(\d{3})[12]$/);
    if (!match) return;
    const year = Number(match[1]);
    if (!Number.isFinite(year)) return;
    earliestYear = earliestYear === null ? year : Math.min(earliestYear, year);
  });
  return earliestYear;
}

function semesterIdForAcademicTerm(academicTerm: string, admissionYear: number | null): string | null {
  const match = academicTerm.trim().match(/^(\d{3})([12])$/);
  if (!match || admissionYear === null) return null;
  const academicYear = Number(match[1]);
  const semesterPart = match[2];
  if (!Number.isFinite(academicYear)) return null;
  const grade = academicYear - admissionYear + 1;
  if (grade < 1 || grade > 4) return null;
  return `${grade}-${semesterPart}`;
}

function semesterNameForId(semesterId: string): string | null {
  const [grade, semesterPart] = semesterId.split('-');
  const gradeName = {
    '1': '大一',
    '2': '大二',
    '3': '大三',
    '4': '大四',
  }[grade];
  const termName = {
    '1': '上',
    '2': '下',
  }[semesterPart];
  return gradeName && termName ? `${gradeName}${termName}` : null;
}

function semesterIdForStudentTerm(academicTerm: string, studentNo: string): string | null {
  return semesterIdForAcademicTerm(academicTerm, inferAdmissionYearFromStudentNo(studentNo));
}

function semesterForStudentTerm(
  semesters: AppData['semesters'],
  academicTerm: string,
  studentNo: string
): AppData['semesters'][number] | null {
  const inferredSemesterId = semesterIdForStudentTerm(academicTerm, studentNo);
  if (!inferredSemesterId) return null;
  const inferredSemesterName = semesterNameForId(inferredSemesterId);
  return semesters.find((semester) => semester.id === inferredSemesterId)
    || semesters.find((semester) => semester.name === inferredSemesterName)
    || null;
}

function semesterForAcademicTerm(
  semesters: AppData['semesters'],
  academicTerm: string,
  admissionYear: number | null
): AppData['semesters'][number] | null {
  const inferredSemesterId = semesterIdForAcademicTerm(academicTerm, admissionYear);
  if (!inferredSemesterId) return null;
  const inferredSemesterName = semesterNameForId(inferredSemesterId);
  return semesters.find((semester) => semester.id === inferredSemesterId)
    || semesters.find((semester) => semester.name === inferredSemesterName)
    || null;
}

function historyRecordsFromImport(payload: HistoryImportResponse): AcademicHistoryRecord[] {
  return payload.records.map((record) => ({
    category: record.category,
    courseCode: record.course_code,
    courseName: sanitizedHistoryCourseName(record.course_name),
    academicTerm: record.academic_term,
    grade: record.grade,
    credits: Number(record.earned_credits) || 0,
    status: historyStatus(record),
    dimension: normalizeGenEdDimension(record.ge_dimension),
  }));
}

function normalizeGenEdDimension(value: string | undefined): AcademicHistoryRecord['dimension'] {
  const normalized = value?.trim().toUpperCase();
  if (normalized && ['A', 'B', 'C', 'D', 'E', 'F'].includes(normalized)) {
    return normalized as AcademicHistoryRecord['dimension'];
  }
  return undefined;
}

function categoryFromHistoryRecord(record: AcademicHistoryRecord): CourseCategory {
  const name = record.courseName;
  const code = record.courseCode.toUpperCase();
  if (code.startsWith('PE') || name.includes('體育')) return 'pe';
  if (name.includes('國文') || name.includes('中文') || name.includes('文學') || name.includes('表達')) return 'chinese';
  if (name.includes('英文') || name.includes('英語') || code.startsWith('CC101') || code.startsWith('CC105')) return 'english';
  if (name.includes('通識') || code.startsWith('GE') || record.category.includes('通識')) return 'gen_ed';
  if (record.category.includes('社會')) return 'social';
  if (record.category.includes('必修')) return 'compulsory';
  if (record.category.includes('選修')) return 'elective';
  return 'other';
}

function historyStatusLabel(status: AcademicHistoryRecord['status']): string {
  if (status === 'in_progress') return '修習中';
  if (status === 'failed') return '不及格';
  return '已修過';
}

function courseMatchesHistoryRecord(course: Course, record: AcademicHistoryRecord): boolean {
  if (normalizeName(course.name) === normalizeName(record.courseName)) return true;
  const recordCode = record.courseCode.trim().toUpperCase();
  const courseNo = course.scheduledOffering?.courseNo.trim().toUpperCase() || '';
  return Boolean(recordCode && courseNo && (courseNo.startsWith(recordCode) || recordCode.startsWith(courseNo)));
}

function isHistoryImportedCourse(course: Course): boolean {
  return Boolean(course.details?.notes?.includes(HISTORY_IMPORT_NOTE_MARKER));
}

function isFailedImportedHistoryCourse(course: Course): boolean {
  return isHistoryImportedCourse(course) && Boolean(course.details?.notes?.includes('狀態: 不及格'));
}

function historicalLookupNote(lookup?: HistoricalScheduleLookup): string {
  if (!lookup) return '';
  if (lookup.status === 'matched') return '歷史節次: 已由課程查詢補查';
  if (lookup.status === 'ambiguous') return `歷史節次: 找到 ${lookup.candidateCount} 個候選班別，未自動排入`;
  if (lookup.status === 'missing') return '歷史節次: 查無開課資料';
  return '歷史節次: 課碼或學年期不足，未補查';
}

function courseFromHistoryRecord(record: AcademicHistoryRecord, lookup?: HistoricalScheduleLookup): Course {
  const key = historyRecordKey(record).replace(/[^A-Z0-9_-]/gi, '-');
  const offering = lookup?.status === 'matched' ? lookup.offering : undefined;
  const scheduledOffering = offering ? toScheduledOffering(offering) : undefined;
  const notes = [
    HISTORY_IMPORT_NOTE_MARKER,
    record.courseCode ? `課碼: ${record.courseCode}` : '',
    record.academicTerm ? `學年期: ${record.academicTerm}` : '',
    record.grade ? `成績: ${record.grade}` : '',
    `狀態: ${historyStatusLabel(record.status)}`,
    historicalLookupNote(lookup),
    offering?.contents || '',
  ].filter(Boolean).join('\n');

  return {
    id: `history-${offering?.course_no || key}-${record.academicTerm || nextPlannerId()}`,
    name: offering?.course_name || record.courseName,
    credits: offering?.credits ?? (Number.isFinite(record.credits) ? record.credits : 0),
    category: categoryFromHistoryRecord(record),
    program: 'home',
    dimension: record.dimension,
    grade: record.grade || historyStatusLabel(record.status),
    scheduledOffering,
    details: {
      professor: offering?.teacher || '',
      location: offering?.classroom || '',
      time: scheduledOffering ? displaySlots(scheduledOffering.slots) : '',
      gradingPolicy: [],
      notes,
    },
  };
}

function mergeCourseNotes(existingNotes: string | undefined, importedNotes: string | undefined): string {
  return uniqueTextValues([
    ...(existingNotes || '').split('\n'),
    ...(importedNotes || '').split('\n'),
  ]).join('\n');
}

function mergeCourseWithHistoryRecord(existingCourse: Course, historyCourse: Course): Course {
  const existingDetails = existingCourse.details;
  const historyDetails = historyCourse.details;
  const existingGradingPolicy = existingDetails?.gradingPolicy || [];
  return {
    ...existingCourse,
    name: historyCourse.name || existingCourse.name,
    credits: historyCourse.credits || existingCourse.credits,
    category: historyCourse.category === 'unclassified' ? existingCourse.category : historyCourse.category,
    program: existingCourse.program ?? historyCourse.program,
    dimension: historyCourse.dimension ?? existingCourse.dimension,
    grade: historyCourse.grade || existingCourse.grade,
    scheduledOffering: historyCourse.scheduledOffering ?? existingCourse.scheduledOffering,
    details: {
      professor: historyDetails?.professor || existingDetails?.professor || '',
      email: existingDetails?.email || historyDetails?.email || '',
      location: historyDetails?.location || existingDetails?.location || '',
      time: historyDetails?.time || existingDetails?.time || '',
      link: existingDetails?.link || historyDetails?.link || '',
      gradingPolicy: existingGradingPolicy.length > 0 ? existingGradingPolicy : historyDetails?.gradingPolicy || [],
      notes: mergeCourseNotes(existingDetails?.notes, historyDetails?.notes),
    },
  };
}

function mergeHistoryRecordsIntoSemesters(
  semesters: AppData['semesters'],
  records: AcademicHistoryRecord[],
  studentNo: string,
  lookups: Map<string, HistoricalScheduleLookup> = new Map()
): {
  semesters: AppData['semesters'];
  firstSemesterId: string | null;
  importedCourseCount: number;
  scheduledHistoryCourseCount: number;
} {
  const admissionYear = inferAdmissionYearFromStudentNo(studentNo) ?? fallbackAdmissionYear(records);
  let firstSemesterId: string | null = null;
  let importedCourseCount = 0;
  let scheduledHistoryCourseCount = 0;
  const seenHistoryKeys = new Set<string>();

  const nextSemesters = semesters.map((semester) => ({
    ...semester,
    courses: semester.courses.filter((course) => !isHistoryImportedCourse(course)),
  }));

  records.forEach((record) => {
    const targetSemester = semesterForAcademicTerm(nextSemesters, record.academicTerm, admissionYear);
    if (!targetSemester) return;

    const historyKey = `${targetSemester.id}-${record.academicTerm}-${historyRecordKey(record)}`;
    if (seenHistoryKeys.has(historyKey)) return;
    seenHistoryKeys.add(historyKey);

    const course = courseFromHistoryRecord(record, lookups.get(historicalLookupKey(record)));
    const existingCourseIndex = targetSemester.courses.findIndex((item) => courseMatchesHistoryRecord(item, record));
    if (existingCourseIndex >= 0) {
      targetSemester.courses = targetSemester.courses.map((item, index) => (
        index === existingCourseIndex ? mergeCourseWithHistoryRecord(item, course) : item
      ));
      importedCourseCount += 1;
      if (course.scheduledOffering?.slots.length) scheduledHistoryCourseCount += 1;
      if (!firstSemesterId) firstSemesterId = targetSemester.id;
      return;
    }

    targetSemester.courses = [...targetSemester.courses, course];
    importedCourseCount += 1;
    if (course.scheduledOffering?.slots.length) scheduledHistoryCourseCount += 1;
    if (!firstSemesterId) firstSemesterId = targetSemester.id;
  });

  return { semesters: nextSemesters, firstSemesterId, importedCourseCount, scheduledHistoryCourseCount };
}

function retakeRequirementsFromHistory(records: AcademicHistoryRecord[]): PendingRequirement[] {
  const nonFailedKeys = new Set(records.filter((record) => record.status !== 'failed').map(historyRecordKey));
  return records
    .filter((record) => record.status === 'failed' && !nonFailedKeys.has(historyRecordKey(record)))
    .map((record) => ({
      id: `retake-${historyRecordKey(record)}`,
      setId: RETAKE_SET_ID,
      kind: 'course',
      title: record.courseName,
      credits: null,
      requiredCredits: null,
      courseNames: [record.courseName],
      options: [{ name: record.courseName, credits: null, courseNames: [record.courseName] }],
      note: `不及格待重修・${record.academicTerm}・${record.grade}`,
      courseCodePrefix: record.courseCode || null,
    }));
}

function selectHistoricalOffering(record: AcademicHistoryRecord, results: CourseSearchResult[]): HistoricalScheduleLookup {
  const recordCode = record.courseCode.trim().toUpperCase();
  const normalizedCourseName = normalizeName(record.courseName);
  const codeMatched = results.filter((result) => {
    const courseNo = result.course_no.trim().toUpperCase();
    return Boolean(recordCode && (courseNo === recordCode || courseNo.startsWith(recordCode)));
  });
  const candidates = codeMatched.length > 0 ? codeMatched : results;
  const nameMatched = candidates.filter((result) => normalizeName(result.course_name) === normalizedCourseName);
  const plausible = nameMatched.length > 0 ? nameMatched : candidates;
  const withSlots = plausible.filter((result) => parseNodeSlots(result.node).length > 0);

  if (withSlots.length === 1) {
    return { status: 'matched', candidateCount: plausible.length, offering: withSlots[0] };
  }
  if (plausible.length === 0) {
    return { status: 'missing', candidateCount: 0 };
  }
  return { status: 'ambiguous', candidateCount: plausible.length };
}

async function lookupHistoricalSchedules(records: AcademicHistoryRecord[]): Promise<Map<string, HistoricalScheduleLookup>> {
  const lookupEntries = await Promise.all(records.map(async (record): Promise<[string, HistoricalScheduleLookup]> => {
    const key = historicalLookupKey(record);
    if (!record.courseCode.trim() || !record.academicTerm.trim()) {
      return [key, { status: 'skipped', candidateCount: 0 }];
    }
    try {
      const results = await searchCourses(record.academicTerm, record.courseCode, 'code');
      return [key, selectHistoricalOffering(record, results)];
    } catch {
      return [key, { status: 'missing', candidateCount: 0 }];
    }
  }));
  return new Map(lookupEntries);
}

function normalizeName(value: string): string {
  return value.replace(/\s+/g, '').replace(/（/g, '(').replace(/）/g, ')').toLowerCase();
}

function getRequirementStatus(requirement: PendingRequirement, data: AppData): RequirementStatus {
  const scheduledCourses = data.semesters.flatMap((semester) => semester.courses);
  const targetCredits = requirement.requiredCredits ?? requirement.credits ?? 0;
  const candidateNames = new Set(requirement.courseNames.map(normalizeName));
  const candidateCodePrefix = requirement.courseCodePrefix?.trim().toUpperCase() || '';
  let matched = scheduledCourses.filter((course) => course.sourceRequirementId === requirement.id);

  if (matched.length === 0 && candidateNames.size > 0) {
    matched = scheduledCourses.filter((course) => candidateNames.has(normalizeName(course.name)));
  }

  if (requirement.kind === 'credit_pool' && requirement.courseCodePrefix) {
    matched = scheduledCourses.filter((course) => {
      const code = course.scheduledOffering?.courseNo || '';
      return course.sourceRequirementId === requirement.id || code.startsWith(requirement.courseCodePrefix || '');
    });
  }

  const historyMatched = (data.historyRecords || []).filter((record) => {
    if (record.status === 'failed') return false;
    if (candidateNames.has(normalizeName(record.courseName))) return true;
    if (candidateCodePrefix && record.courseCode.toUpperCase().startsWith(candidateCodePrefix)) return true;
    return false;
  });
  const scheduledCredits = matched.reduce((sum, course) => sum + (Number.isFinite(course.credits) ? course.credits : 0), 0);
  const historyCredits = historyMatched.reduce((sum, record) => sum + record.credits, 0);
  const earnedCredits = Math.max(scheduledCredits, historyCredits);
  const matchedCount = Math.max(matched.length, historyMatched.length);
  const completed = requirement.kind === 'credit_pool'
    ? earnedCredits >= targetCredits
    : matchedCount > 0 && (targetCredits === 0 || earnedCredits >= Math.min(targetCredits, earnedCredits || targetCredits));

  return {
    completed,
    earnedCredits,
    targetCredits,
    scheduledCount: matchedCount,
  };
}

function findConflicts(offering: CourseSearchResult, data: AppData, semesterId: string): Course[] {
  const slots = parseNodeSlots(offering.node);
  if (slots.length === 0) return [];
  const semester = data.semesters.find((item) => item.id === semesterId);
  if (!semester) return [];
  const slotSet = new Set(slots);
  return semester.courses.filter((course) =>
    !isSameScheduledOffering(course, offering) &&
    (course.scheduledOffering?.slots || []).some((slot) => slotSet.has(slot))
  );
}

function isSameScheduledOffering(course: Course, offering: CourseSearchResult): boolean {
  const scheduled = course.scheduledOffering;
  if (!scheduled) return false;
  if (scheduled.courseNo && offering.course_no) {
    return scheduled.courseNo === offering.course_no;
  }
  return (
    normalizeName(scheduled.courseName || course.name) === normalizeName(offering.course_name) &&
    scheduled.teacher === offering.teacher &&
    normalizeOfferingNode(scheduled.node) === normalizeOfferingNode(offering.node)
  );
}

function normalizeOfferingNode(value: string): string {
  return parseNodeSlots(value).join(',');
}

function findScheduledCourseByOffering(offering: CourseSearchResult, data: AppData, semesterId: string): Course | undefined {
  const semester = data.semesters.find((item) => item.id === semesterId);
  return semester?.courses.find((course) => isSameScheduledOffering(course, offering));
}

function ensureManualSet(data: AppData): RequirementSet[] {
  if (data.requirementSets.some((set) => set.id === MANUAL_SET_ID)) return data.requirementSets;
  return [
    ...data.requirementSets,
    {
      id: MANUAL_SET_ID,
      name: '手動加入',
      department: '',
      source: 'manual',
      totalCredits: null,
      notes: [],
    },
  ];
}

function uniqueId(base: string, existing: Set<string>): string {
  if (!existing.has(base)) return base;
  let index = 2;
  while (existing.has(`${base}-${index}`)) index += 1;
  return `${base}-${index}`;
}

function normalizeImportPreview(preview: ApiImportPreview, data: AppData): { set: RequirementSet; requirements: PendingRequirement[] } {
  const rawSet = preview.requirement_set;
  const existingSetIds = new Set(data.requirementSets.map((set) => set.id));
  const setId = uniqueId(String(rawSet.id || `pdf-set-${nextPlannerId()}`), existingSetIds);
  const set: RequirementSet = {
    id: setId,
    name: String(rawSet.name || 'PDF 匯入需求'),
    department: String(rawSet.department || ''),
    source: 'pdf',
    sourceFileName: rawSet.source_file_name ? String(rawSet.source_file_name) : null,
    totalCredits: typeof rawSet.total_credits === 'number' ? rawSet.total_credits : null,
    notes: Array.isArray(rawSet.notes) ? rawSet.notes.map(String) : [],
  };

  const existingRequirementIds = new Set(data.pendingRequirements.map((requirement) => requirement.id));
  const requirements = preview.pending_requirements.map((rawRequirement, index) => {
    const id = uniqueId(String(rawRequirement.id || `pdf-req-${nextPlannerId()}-${index}`), existingRequirementIds);
    existingRequirementIds.add(id);
    const rawOptions = Array.isArray(rawRequirement.options) ? rawRequirement.options : [];
    const options: RequirementOption[] = rawOptions.map((option) => {
      const record = option as Record<string, unknown>;
      return {
        name: String(record.name || ''),
        credits: typeof record.credits === 'number' ? record.credits : null,
        courseNames: Array.isArray(record.course_names) ? record.course_names.map(String) : [],
      };
    });
    return {
      id,
      setId,
      kind: String(rawRequirement.kind || 'course') as PendingRequirement['kind'],
      title: String(rawRequirement.title || ''),
      credits: typeof rawRequirement.credits === 'number' ? rawRequirement.credits : null,
      requiredCredits: typeof rawRequirement.required_credits === 'number' ? rawRequirement.required_credits : null,
      courseNames: Array.isArray(rawRequirement.course_names) ? rawRequirement.course_names.map(String) : [],
      options,
      note: String(rawRequirement.note || ''),
      courseCodePrefix: rawRequirement.course_code_prefix ? String(rawRequirement.course_code_prefix) : null,
    };
  });

  return { set, requirements };
}

export default function CoursePlannerWebApp() {
  const { session, loading: authLoading } = useAuth();
  const [isDemoMode, setIsDemoMode] = useState(false);
  const { data, setData, syncStatus, isLoading: dataLoading } = useCourseData(session);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isOnboardingOpen, setIsOnboardingOpen] = useState<boolean>(() => {
    return !localStorage.getItem('hasSeenOnboarding');
  });

  const [activeSemesterId, setActiveSemesterId] = useState('1-1');
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
  const [planningMode, setPlanningMode] = useState<PlanningMode>('lottery');
  const [activeRequirement, setActiveRequirement] = useState<PendingRequirement | null>(null);
  const [offeringResults, setOfferingResults] = useState<CourseSearchResult[]>([]);
  const [offeringStatus, setOfferingStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [offeringError, setOfferingError] = useState('');
  const [importPreview, setImportPreview] = useState<ApiImportPreview | null>(null);
  const [importStatus, setImportStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [importError, setImportError] = useState('');
  const [isSchoolSyncOpen, setIsSchoolSyncOpen] = useState(false);
  const [schoolUsername, setSchoolUsername] = useState('');
  const [schoolPassword, setSchoolPassword] = useState('');
  const [schoolSyncStatus, setSchoolSyncStatus] = useState<'idle' | 'loading' | 'error' | 'success'>('idle');
  const [schoolSyncMessage, setSchoolSyncMessage] = useState('');
  const hasMigratedHistoryCoursesRef = useRef(false);
  const [detailCourse, setDetailCourse] = useState<{ semesterId: string; semesterName: string; course: Course } | null>(null);
  const [plannerMessage, setPlannerMessage] = useState('');

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

  const stats = useMemo<PlannerStats>(() => {
    const current: PlannerStats = {
      total: 0,
      chinese: 0,
      english: 0,
      gen_ed: 0,
      pe_semesters: 0,
      social: 0,
      homeCompulsory: 0,
      homeElective: 0,
      doubleMajor: 0,
      minor: 0,
      genEdDimensions: new Set<string>(),
    };

    const countedHistoryNames = new Set<string>();
    (data.historyRecords || []).forEach((record) => {
      if (record.status === 'failed') return;
      countedHistoryNames.add(normalizeName(record.courseName));
      const category = categoryFromHistoryRecord(record);
      const credits = Number.isFinite(record.credits) ? record.credits : 0;
      if (category === 'pe') {
        current.pe_semesters += 1;
        return;
      }
      if (category === 'social') {
        current.social += 1;
        return;
      }
      current.total += credits;
      if (category === 'chinese') current.chinese += credits;
      if (category === 'english') current.english += credits;
      if (category === 'gen_ed') {
        current.gen_ed += credits;
        if (record.dimension && record.dimension !== 'None') current.genEdDimensions.add(record.dimension);
      }
      if (category === 'compulsory') current.homeCompulsory += credits;
      if (category === 'elective') current.homeElective += credits;
    });

    data.semesters.forEach((semester) => {
      let hasPE = false;
      semester.courses.forEach((course) => {
        if (isFailedImportedHistoryCourse(course)) return;
        if (countedHistoryNames.has(normalizeName(course.name))) return;
        const credits = Number.isFinite(course.credits) ? course.credits : 0;
        const program = course.program ?? 'home';
        if (course.category === 'pe') {
          hasPE = true;
          return;
        }
        if (course.category === 'social') {
          current.social += 1;
          return;
        }
        current.total += credits;
        if (course.category === 'chinese') current.chinese += credits;
        if (course.category === 'english') current.english += credits;
        if (course.category === 'gen_ed') {
          current.gen_ed += credits;
          if (course.dimension && course.dimension !== 'None') current.genEdDimensions.add(course.dimension);
        }
        if (program === 'double_major') current.doubleMajor += credits;
        if (program === 'minor') current.minor += credits;
        if (program === 'home' && course.category === 'compulsory') current.homeCompulsory += credits;
        if (program === 'home' && course.category === 'elective') current.homeElective += credits;
      });
      if (hasPE) current.pe_semesters += 1;
    });

    return current;
  }, [data]);

  const activeSemester = data.semesters.find((semester) => semester.id === activeSemesterId) || data.semesters[0];
  const canRunManualSearch = manualQuery.trim().length > 0 && manualStatus !== 'loading';
  const requirementStatuses = useMemo(() => {
    const map = new Map<string, RequirementStatus>();
    data.pendingRequirements.forEach((requirement) => {
      map.set(requirement.id, getRequirementStatus(requirement, data));
    });
    return map;
  }, [data]);
  const completedRequirements = Array.from(requirementStatuses.values()).filter((status) => status.completed).length;
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
      hasMigratedHistoryCoursesRef.current = true;
      setSchoolPassword('');
      setSchoolSyncStatus('success');
      setSchoolSyncMessage(`已同步完成：最新課表 ${courses.length} 門匯入「${targetSemester.name}」，歷年紀錄 ${historyRecords.length} 筆，${scheduledHistoryCourseCount} 門補到歷史節次，${importedCourseCount} 門寫入學期，${retakeRequirements.length} 門列為待重修。`);
    } catch (error) {
      setSchoolSyncStatus('error');
      setSchoolSyncMessage(error instanceof Error ? error.message : '校務資料同步失敗。');
    }
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
        pendingCount={data.pendingRequirements.length}
        onOpenSchoolSync={() => setIsSchoolSyncOpen(true)}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onOpenHelp={() => setIsOnboardingOpen(true)}
        onExitDemo={() => setIsDemoMode(false)}
      />

      <main className="mx-auto max-w-[1600px] px-4 py-4 sm:px-6 lg:px-8">
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
          <span>選課輔助工具，不自動搶課、不輪詢名額；送出官方系統前仍需使用者確認。</span>
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[240px_minmax(0,1fr)_300px]">
          <aside className="rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-100 p-4">
              <h2 className="text-base font-semibold text-slate-900">篩選條件</h2>
              <button onClick={resetCourseSearchFilters} className="text-sm font-medium text-blue-600 hover:text-blue-700">
                清除全部
              </button>
            </div>
            <div className="space-y-4 p-4">
              <div>
                <label className="block text-xs font-medium text-slate-500">學期</label>
                <select
                  value={querySemester}
                  onChange={(event) => {
                    setQuerySemester(event.target.value);
                    setManualResults([]);
                    setManualSearchSummary(null);
                  }}
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                >
                  {courseSemesters.length === 0 && <option value={querySemester}>{querySemester}</option>}
                  {courseSemesters.map((semester) => (
                    <option key={semester.semester} value={semester.semester}>
                      {semester.semester}{semester.english_label ? `・${semester.english_label}` : ''}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-slate-500">目前查詢：{currentCourseSemesterLabel}</p>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-500">課名 / 課碼</label>
                <div className="mt-1 grid grid-cols-[82px_minmax(0,1fr)] gap-2">
                  <select
                    value={manualMode}
                    onChange={(event) => {
                      setManualMode(event.target.value as SearchMode);
                      setManualResults([]);
                      setManualSearchSummary(null);
                    }}
                    className="rounded-md border border-slate-300 bg-white px-2 py-2 text-sm"
                  >
                    <option value="name">課名</option>
                    <option value="code">課碼</option>
                  </select>
                  <input
                    value={manualQuery}
                    onChange={(event) => setManualQuery(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && canRunManualSearch) void runManualSearch();
                    }}
                    placeholder="資料結構"
                    className="min-w-0 rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-500">教師</label>
                <input
                  value={teacherFilter}
                  onChange={(event) => setTeacherFilter(event.target.value)}
                  placeholder="輸入教師姓名"
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-500">必選修</label>
                <select
                  value={requireOptionFilter}
                  onChange={(event) => setRequireOptionFilter(event.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                >
                  <option value="all">全部</option>
                  <option value="R">必修</option>
                  <option value="E">選修</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-500">學分</label>
                <select
                  value={creditFilter}
                  onChange={(event) => setCreditFilter(event.target.value)}
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                >
                  <option value="all">不限</option>
                  <option value="0">0 學分</option>
                  <option value="1">1 學分</option>
                  <option value="2">2 學分</option>
                  <option value="3">3 學分</option>
                  <option value="4">4 學分</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-500">節次</label>
                <input
                  value={timeFilter}
                  onChange={(event) => setTimeFilter(event.target.value)}
                  placeholder="例如 M3 或 W4"
                  className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-500">名額狀態</label>
                <select
                  value={capacityFilter}
                  onChange={(event) => setCapacityFilter(event.target.value as CapacityFilter)}
                  className="mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                >
                  <option value="all">全部</option>
                  <option value="available">尚有名額</option>
                  <option value="full">額滿</option>
                  <option value="unknown">未公告</option>
                </select>
              </div>

              <button
                onClick={() => void runManualSearch()}
                disabled={!canRunManualSearch}
                className="w-full rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                搜尋課程
              </button>
              <button
                onClick={resetCourseSearchFilters}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                重設條件
              </button>

              <div className="border-t border-slate-100 pt-4">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                    <Upload className="h-4 w-4 text-blue-600" />
                    需求匯入
                  </h3>
                  {importStatus === 'loading' && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
                </div>
                <label className="flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 hover:border-blue-400 hover:bg-blue-50 hover:text-blue-700">
                  <FileText className="h-4 w-4" />
                  上傳雙主修 PDF
                  <input
                    type="file"
                    accept="application/pdf,.pdf"
                    className="hidden"
                    onChange={(event) => {
                      void handlePdfUpload(event.target.files?.[0]);
                      event.currentTarget.value = '';
                    }}
                  />
                </label>
                {importError && <p className="mt-2 text-sm text-red-600">{importError}</p>}
              </div>
            </div>
          </aside>

          <section className="min-w-0 rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-col gap-3 border-b border-slate-100 p-5 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <h2 className="text-2xl font-semibold text-slate-950">課程查詢中心</h2>
                <p className="mt-1 text-sm text-slate-500">查詢開課資料，加入待選清單，並進行課表規劃。</p>
              </div>
              <div className="flex items-center gap-3 text-sm text-slate-500">
                <span>
                  {manualSearchSummary
                    ? `共找到 ${manualSearchSummary.resultCount} 筆，顯示 ${filteredManualResults.length} 筆`
                    : '輸入條件後開始查詢'}
                </span>
                <button
                  onClick={exportCourseResults}
                  disabled={filteredManualResults.length === 0}
                  className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400"
                >
                  匯出結果
                </button>
              </div>
            </div>

            {manualStatus === 'loading' && <p className="p-5 text-sm text-slate-500">查詢中...</p>}
            {manualError && <p className="m-5 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{manualError}</p>}
            {manualStatus === 'idle' && manualSearchSummary && manualResults.length === 0 && (
              <div className="m-5 rounded-md border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
                查無符合「{manualSearchSummary.query}」的開課資料，請改用課碼或切換查詢學期。
              </div>
            )}
            {manualStatus === 'idle' && manualResults.length > 0 && filteredManualResults.length === 0 && (
              <div className="m-5 rounded-md border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
                目前篩選條件沒有符合結果，請放寬教師、節次或名額條件。
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="min-w-[880px] w-full border-separate border-spacing-0 text-sm">
                <thead>
                  <tr className="bg-slate-50 text-left text-xs font-semibold text-slate-500">
                    <th className="border-b border-slate-200 px-3 py-3">課碼</th>
                    <th className="border-b border-slate-200 px-3 py-3">課名</th>
                    <th className="border-b border-slate-200 px-3 py-3">教師</th>
                    <th className="border-b border-slate-200 px-3 py-3">學分</th>
                    <th className="border-b border-slate-200 px-3 py-3">節次</th>
                    <th className="border-b border-slate-200 px-3 py-3">教室</th>
                    <th className="border-b border-slate-200 px-3 py-3">名額</th>
                    <th className="border-b border-slate-200 px-3 py-3">備註</th>
                    <th className="border-b border-slate-200 px-3 py-3 text-right">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredManualResults.length === 0 && !manualSearchSummary && (
                    <tr>
                      <td colSpan={9} className="px-4 py-12 text-center text-sm text-slate-500">
                        先在左側輸入課名或課碼搜尋官方開課資料。
                      </td>
                    </tr>
                  )}
                  {filteredManualResults.map((offering) => (
                    <CourseResultRow
                      key={`${offering.course_no}-${offering.node}-${offering.teacher}`}
                      offering={offering}
                      conflicts={findConflicts(offering, data, activeSemesterId)}
                      alreadyAdded={Boolean(findScheduledCourseByOffering(offering, data, activeSemesterId))}
                      alreadyPending={pendingSelectionNames.has(normalizeName(offering.course_name))}
                      onAddRequirement={() => addOfferingAsRequirement(offering)}
                      onSchedule={() => addCourseToSemester(offering)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <aside className="rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="flex items-start justify-between border-b border-slate-100 p-4">
              <div>
                <h2 className="text-base font-semibold text-slate-900">待選清單 ({data.pendingRequirements.length})</h2>
                <p className="mt-1 text-xs text-slate-500">可用學分：{formatCredits(pendingSelectionCredits)} 學分</p>
              </div>
              <span className="rounded-full bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700">
                {completedRequirements} 已完成
              </span>
            </div>
            <div className="max-h-[640px] overflow-y-auto p-4">
              {data.pendingRequirements.length === 0 ? (
                <div className="rounded-md border border-dashed border-slate-300 p-5 text-center text-sm text-slate-500">
                  從查詢結果加入課程，或上傳 PDF 產生待修需求。
                </div>
              ) : (
                <div className="space-y-3">
                  {data.pendingRequirements.map((requirement, index) => (
                    <RequirementRow
                      key={requirement.id}
                      requirement={requirement}
                      status={requirementStatuses.get(requirement.id)}
                      onOpen={() => void scheduleRequirementOrChooseOffering(requirement)}
                      onDelete={() => deleteRequirement(requirement.id)}
                      rank={index + 1}
                    />
                  ))}
                </div>
              )}
            </div>
            <div className="space-y-2 border-t border-slate-100 p-4">
              <p className="text-xs text-slate-500">已選學分：{formatCredits(activeSemesterCredits)} 學分</p>
              <a
                href="#schedule-preview"
                className="block rounded-md bg-blue-600 px-3 py-2 text-center text-sm font-semibold text-white hover:bg-blue-700"
              >
                進行課表規劃
              </a>
              <button
                disabled
                className="w-full cursor-not-allowed rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-400"
              >
                待選清單已自動儲存
              </button>
            </div>
          </aside>
        </div>

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
      </main>

      {activeRequirement && (
        <OfferingModal
          requirement={activeRequirement}
          semesterName={activeSemester?.name || activeSemesterId}
          status={offeringStatus}
          error={offeringError}
          offerings={offeringResults}
          data={data}
          activeSemesterId={activeSemesterId}
          planningMode={planningMode}
          onClose={() => setActiveRequirement(null)}
          onSchedule={(offering, force) => addCourseToSemester(offering, activeRequirement, force)}
        />
      )}

      {importPreview && (
        <ImportPreviewModal
          preview={importPreview}
          onConfirm={confirmImportPreview}
          onClose={() => setImportPreview(null)}
        />
      )}

      {isSchoolSyncOpen && (
        <SchoolScheduleSyncModal
          username={schoolUsername}
          password={schoolPassword}
          status={schoolSyncStatus}
          message={schoolSyncMessage}
          onUsernameChange={handleSchoolUsernameChange}
          onPasswordChange={setSchoolPassword}
          onClose={closeSchoolSyncModal}
          onImport={() => void syncSchoolData()}
        />
      )}

      {detailCourse && (
        <CourseDetailModal
          isOpen
          course={detailCourse.course}
          semesterId={detailCourse.semesterId}
          semesterName={detailCourse.semesterName}
          onClose={() => setDetailCourse(null)}
          onSave={saveCourseDetail}
        />
      )}

      {isSettingsOpen && (
        <SettingsModal
          isOpen={isSettingsOpen}
          onClose={() => setIsSettingsOpen(false)}
          onSave={(targets) => {
            setData((prev) => ({ ...prev, targets }));
            setIsSettingsOpen(false);
          }}
          initialSettings={data.targets}
        />
      )}

      {isOnboardingOpen && (
        <OnboardingModal
          isOpen={isOnboardingOpen}
          onClose={handleCloseOnboarding}
        />
      )}
    </div>
  );
}

function ScheduleLegend() {
  const items = [
    { label: '本系必修', className: 'border-rose-200 bg-rose-50' },
    { label: '本系選修', className: 'border-sky-200 bg-sky-50' },
    { label: '通識', className: 'border-purple-200 bg-purple-50' },
    { label: '雙主修', className: 'border-emerald-200 bg-emerald-50' },
    { label: '衝堂', className: 'border-red-300 bg-red-100' },
  ];

  return (
    <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-600">
      {items.map((item) => (
        <span key={item.label} className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-2.5 py-1">
          <span className={`h-2.5 w-2.5 rounded-sm border ${item.className}`} />
          {item.label}
        </span>
      ))}
    </div>
  );
}

function planningModeLabel(mode: PlanningMode): string {
  if (mode === 'lottery') return '初選志願';
  if (mode === 'addDrop') return '加退選';
  return '加簽追蹤';
}

function planningModeDescription(mode: PlanningMode): string {
  if (mode === 'lottery') return '同時段多門課會視為競爭志願，抽中一門後其他同時段或同課名志願會失效。';
  if (mode === 'addDrop') return '加退選接近先搶先贏，同時段課程應視為真衝堂並在送出前處理。';
  return '追蹤教授、Email、第一次上課與授權碼狀態，不納入自動送出。';
}

function scheduledCredits(courses: Course[]): number {
  return courses.reduce((sum, course) => sum + (course.category === 'pe' ? 0 : course.credits), 0);
}

function getSlotGroups(courses: Course[]) {
  return DAY_COLUMNS.flatMap((day) => PERIODS.map((period) => {
    const slot = `${day.code}${period}`;
    const slotCourses = courses.filter((course) => course.scheduledOffering?.slots.includes(slot));
    return {
      slot,
      label: `星期${day.label} ${period}`,
      courses: slotCourses,
    };
  })).filter((group) => group.courses.length > 1);
}

function getNameGroups(courses: Course[]) {
  const groups = new Map<string, Course[]>();
  courses.forEach((course) => {
    const key = normalizeName(course.name);
    if (!key) return;
    groups.set(key, [...(groups.get(key) || []), course]);
  });
  return Array.from(groups.values()).filter((coursesInGroup) => coursesInGroup.length > 1);
}

function PlanningWorkspace({
  data,
  stats,
  activeSemester,
  activeSemesterId,
  planningMode,
  plannerMessage,
  requirementStatuses,
  onModeChange,
  onSemesterChange,
  onOpenRequirement,
  onDeleteRequirement,
  onMoveRequirement,
  onDeleteCourse,
  onOpenCourseDetail,
}: {
  data: AppData;
  stats: PlannerStats;
  activeSemester?: AppData['semesters'][number];
  activeSemesterId: string;
  planningMode: PlanningMode;
  plannerMessage: string;
  requirementStatuses: Map<string, RequirementStatus>;
  onModeChange: (mode: PlanningMode) => void;
  onSemesterChange: (semesterId: string) => void;
  onOpenRequirement: (requirement: PendingRequirement) => void;
  onDeleteRequirement: (requirementId: string) => void;
  onMoveRequirement: (requirementId: string, direction: -1 | 1) => void;
  onDeleteCourse: (courseId: string) => void;
  onOpenCourseDetail: (course: Course) => void;
}) {
  const courses = activeSemester?.courses.filter((course) => !isHistoryImportedCourse(course)) || [];
  const pendingCredits = data.pendingRequirements.reduce((sum, requirement) => (
    sum + (requirement.requiredCredits ?? requirement.credits ?? 0)
  ), 0);
  const activeCredits = scheduledCredits(courses);
  const slotGroups = getSlotGroups(courses);
  const nameGroups = getNameGroups(courses);
  const trueConflictCount = planningMode === 'lottery' ? 0 : slotGroups.length;
  const competitionCount = planningMode === 'lottery' ? slotGroups.length + nameGroups.length : 0;
  const sortedRequirements = data.pendingRequirements;
  const scheduledById = new Map(courses.map((course, index) => [course.id, index + 1]));
  const modeOptions: Array<{ value: PlanningMode; label: string }> = [
    { value: 'lottery', label: '初選志願' },
    { value: 'addDrop', label: '加退選' },
    { value: 'addCode', label: '加簽追蹤' },
  ];

  return (
    <section id="schedule-preview" className="mt-6 rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 p-4">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-blue-600">課表規劃</p>
            <h2 className="mt-1 text-xl font-semibold text-slate-950">待選清單、志願排序與課表預覽</h2>
            <p className="mt-1 max-w-3xl text-sm text-slate-500">
              {planningModeDescription(planningMode)}
            </p>
          </div>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1">
              {modeOptions.map((option) => (
                <button
                  key={option.value}
                  onClick={() => onModeChange(option.value)}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                    planningMode === option.value
                      ? 'bg-white text-blue-700 shadow-sm'
                      : 'text-slate-500 hover:text-slate-900'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <select
              value={activeSemesterId}
              onChange={(event) => onSemesterChange(event.target.value)}
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700"
            >
              {data.semesters.map((semester) => (
                <option key={semester.id} value={semester.id}>{semester.name}</option>
              ))}
            </select>
          </div>
        </div>
        <ScheduleLegend />
        {plannerMessage && (
          <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700">
            {plannerMessage}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-0 xl:grid-cols-[320px_minmax(0,1fr)_320px]">
        <aside className="border-b border-slate-200 p-4 xl:border-b-0 xl:border-r">
          <div className="flex items-start justify-between">
            <div>
              <h3 className="text-base font-semibold text-slate-900">待選與志願序</h3>
              <p className="mt-1 text-xs text-slate-500">{planningModeLabel(planningMode)}模式 · 最多可管理 30 個志願</p>
            </div>
            <span className="rounded-full bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700">
              {courses.length + sortedRequirements.length} 項
            </span>
          </div>

          <div className="mt-4 space-y-4">
            <div>
              <div className="mb-2 flex items-center justify-between">
                <h4 className="text-sm font-semibold text-slate-700">已排入課表</h4>
                <span className="text-xs text-slate-500">{courses.length} 門・{formatCredits(activeCredits)} 學分</span>
              </div>
              {courses.length === 0 ? (
                <div className="rounded-md border border-dashed border-slate-300 p-4 text-center text-sm text-slate-500">
                  從查詢結果按「排入課表」後，課程會出現在這裡。
                </div>
              ) : (
                <div className="space-y-2">
                  {courses.map((course) => (
                    <PlanningListCourse
                      key={course.id}
                      course={course}
                      rank={scheduledById.get(course.id) || 0}
                      mode={planningMode}
                      onOpen={() => onOpenCourseDetail(course)}
                      onDelete={() => onDeleteCourse(course.id)}
                    />
                  ))}
                </div>
              )}
            </div>

            <div className="border-t border-slate-100 pt-4">
              <div className="mb-2 flex items-center justify-between">
                <h4 className="text-sm font-semibold text-slate-700">待排需求</h4>
                <span className="text-xs text-slate-500">{formatCredits(pendingCredits)} 學分</span>
              </div>
              {sortedRequirements.length === 0 ? (
                <div className="rounded-md border border-dashed border-slate-300 p-4 text-center text-sm text-slate-500">
                  查詢課程後加入待選，或匯入 PDF 產生待排需求。
                </div>
              ) : (
                <div className="space-y-2">
                  {sortedRequirements.map((requirement, index) => (
                    <RequirementRow
                      key={requirement.id}
                      requirement={requirement}
                      status={requirementStatuses.get(requirement.id)}
                      onOpen={() => onOpenRequirement(requirement)}
                      onDelete={() => onDeleteRequirement(requirement.id)}
                      onMoveUp={() => onMoveRequirement(requirement.id, -1)}
                      onMoveDown={() => onMoveRequirement(requirement.id, 1)}
                      canMoveUp={index > 0}
                      canMoveDown={index < sortedRequirements.length - 1}
                      rank={courses.length + index + 1}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </aside>

        <div className="min-w-0 border-b border-slate-200 xl:border-b-0 xl:border-r">
          <div className="border-b border-slate-100 p-4">
            <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h3 className="text-base font-semibold text-slate-900">週課表預覽</h3>
                <p className="mt-1 text-sm text-slate-500">
                  {activeSemester?.name || '未選學期'} · {courses.length} 門課 · {formatCredits(activeCredits)} 學分
                </p>
              </div>
              <p className="text-xs text-slate-400 sm:hidden">課表可左右滑動查看更多星期欄位。</p>
            </div>
          </div>
          <PlanningScheduleGrid
            semester={activeSemester}
            mode={planningMode}
            courseRanks={scheduledById}
            onDeleteCourse={onDeleteCourse}
            onOpenCourseDetail={onOpenCourseDetail}
          />
        </div>

        <aside className="p-4">
          <h3 className="text-base font-semibold text-slate-900">規劃檢查</h3>
          <p className="mt-1 text-xs text-slate-500">依目前選課階段解讀衝堂、互斥與學分限制。</p>

          <div className="mt-4 grid grid-cols-2 gap-3">
            <MetricBox label="已排學分" value={formatCredits(activeCredits)} tone="emerald" />
            <MetricBox label="待排學分" value={formatCredits(pendingCredits)} tone="blue" />
            <MetricBox label={planningMode === 'lottery' ? '競爭組' : '真衝堂'} value={String(planningMode === 'lottery' ? competitionCount : trueConflictCount)} tone={planningMode === 'lottery' ? 'amber' : trueConflictCount > 0 ? 'red' : 'emerald'} />
            <MetricBox label="志願數" value={`${courses.length + sortedRequirements.length}/30`} tone="slate" />
          </div>

          <div className="mt-4 rounded-lg border border-slate-200 p-3">
            <h4 className="text-sm font-semibold text-slate-800">
              {planningMode === 'lottery' ? '競爭組與互斥提醒' : '衝堂清單'}
            </h4>
            <div className="mt-3 space-y-2">
              {slotGroups.length === 0 && nameGroups.length === 0 ? (
                <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                  目前沒有偵測到同時段或同課名重疊。
                </p>
              ) : (
                <>
                  {slotGroups.slice(0, 4).map((group) => (
                    <ConflictGroupRow
                      key={group.slot}
                      label={group.label}
                      courses={group.courses}
                      mode={planningMode}
                    />
                  ))}
                  {nameGroups.slice(0, 3).map((group) => (
                    <ConflictGroupRow
                      key={`name-${normalizeName(group[0].name)}`}
                      label="同課名互斥"
                      courses={group}
                      mode={planningMode}
                    />
                  ))}
                </>
              )}
            </div>
          </div>

          <div className="mt-4 rounded-lg border border-slate-200 p-3">
            <h4 className="text-sm font-semibold text-slate-800">送出前重點</h4>
            <ul className="mt-2 space-y-2 text-sm text-slate-600">
              {planningMode === 'lottery' ? (
                <>
                  <li>同一時段可放多個志願，抽中一門後其餘同時段會失效。</li>
                  <li>志願序可超過 25 學分，但中籤後系統會受學分上限影響。</li>
                  <li>體育、國文、熱門通識建議放多個備案。</li>
                </>
              ) : planningMode === 'addDrop' ? (
                <>
                  <li>同時段課程應先處理衝堂，再到官方系統送出。</li>
                  <li>名額已滿的課程不建議放入主要送出清單。</li>
                  <li>送出仍需使用者在官方系統確認，不做自動搶課。</li>
                </>
              ) : (
                <>
                  <li>記錄教授 Email、第一次上課時間與加簽備註。</li>
                  <li>授權碼僅追蹤狀態，不應自動代填或轉讓。</li>
                  <li>加簽課仍需回官方系統完成流程。</li>
                </>
              )}
            </ul>
          </div>

          <div className="mt-4 rounded-lg border border-slate-200 p-3">
            <h4 className="text-sm font-semibold text-slate-800">畢業門檻影響</h4>
            <div className="mt-3 space-y-3 text-sm">
              <ProgressSummary label="總學分" value={stats.total} target={data.targets.total} />
              <ProgressSummary label="本系必修" value={stats.homeCompulsory} target={data.targets.home_compulsory} />
              <ProgressSummary label="通識" value={stats.gen_ed} target={data.targets.gen_ed} />
            </div>
          </div>
        </aside>
      </div>
    </section>
  );
}

function PlanningScheduleGrid({
  semester,
  mode,
  courseRanks,
  onDeleteCourse,
  onOpenCourseDetail,
}: {
  semester?: AppData['semesters'][number];
  mode: PlanningMode;
  courseRanks: Map<string, number>;
  onDeleteCourse: (courseId: string) => void;
  onOpenCourseDetail: (course: Course) => void;
}) {
  const courses = semester?.courses.filter((course) => !isHistoryImportedCourse(course)) || [];
  const unscheduled = courses.filter((course) => !course.scheduledOffering?.slots.length);
  return (
    <div className="p-4">
      <div className="overflow-x-auto">
        <div className="min-w-[900px]">
          <div className="grid grid-cols-[72px_repeat(7,minmax(112px,1fr))] border-l border-t border-slate-200 text-sm">
            <div className="border-b border-r border-slate-200 bg-slate-50 p-2 font-medium text-slate-500">時間</div>
            {DAY_COLUMNS.map((day) => (
              <div key={day.code} className="border-b border-r border-slate-200 bg-slate-50 p-2 text-center font-semibold text-slate-700">
                星期{day.label}
              </div>
            ))}
            {PERIODS.map((period) => (
              <PlanningScheduleRow
                key={period}
                period={period}
                courses={courses}
                mode={mode}
                courseRanks={courseRanks}
                onDeleteCourse={onDeleteCourse}
                onOpenCourseDetail={onOpenCourseDetail}
              />
            ))}
          </div>
        </div>
      </div>

      {unscheduled.length > 0 && (
        <div className="mt-4 border-t border-slate-100 pt-4">
          <h4 className="mb-2 text-sm font-semibold text-slate-700">未提供節次的課程</h4>
          <div className="flex flex-wrap gap-2">
            {unscheduled.map((course) => (
              <CoursePill
                key={course.id}
                course={course}
                compact
                onDelete={() => onDeleteCourse(course.id)}
                onOpenDetail={() => onOpenCourseDetail(course)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PlanningScheduleRow({
  period,
  courses,
  mode,
  courseRanks,
  onDeleteCourse,
  onOpenCourseDetail,
}: {
  period: string;
  courses: Course[];
  mode: PlanningMode;
  courseRanks: Map<string, number>;
  onDeleteCourse: (courseId: string) => void;
  onOpenCourseDetail: (course: Course) => void;
}) {
  return (
    <>
      <div className="border-b border-r border-slate-200 bg-slate-50 p-2 text-center font-semibold text-slate-600">{period}</div>
      {DAY_COLUMNS.map((day) => {
        const slot = `${day.code}${period}`;
        const slotCourses = courses.filter((course) => course.scheduledOffering?.slots.includes(slot));
        const hasOverlap = slotCourses.length > 1;
        const cellTone = hasOverlap
          ? mode === 'lottery' ? 'bg-amber-50/70' : 'bg-red-50'
          : 'bg-white';
        return (
          <div key={slot} className={`min-h-24 border-b border-r border-slate-200 p-1.5 ${cellTone}`}>
            <div className="space-y-1.5">
              {slotCourses.map((course) => (
                <PlanningScheduleCard
                  key={course.id}
                  course={course}
                  rank={courseRanks.get(course.id) || 0}
                  overlap={hasOverlap}
                  mode={mode}
                  onDelete={() => onDeleteCourse(course.id)}
                  onOpen={() => onOpenCourseDetail(course)}
                />
              ))}
            </div>
          </div>
        );
      })}
    </>
  );
}

function PlanningScheduleCard({
  course,
  rank,
  overlap,
  mode,
  onDelete,
  onOpen,
}: {
  course: Course;
  rank: number;
  overlap: boolean;
  mode: PlanningMode;
  onDelete: () => void;
  onOpen: () => void;
}) {
  const tone = overlap
    ? mode === 'lottery' ? 'border-amber-300 bg-white' : 'border-red-300 bg-white'
    : coursePillTone(course);
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`w-full rounded-md border px-2 py-1.5 text-left shadow-sm transition-colors hover:shadow ${tone}`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className={`flex h-5 min-w-5 items-center justify-center rounded-full text-[11px] font-bold ${
          overlap && mode === 'lottery' ? 'bg-amber-100 text-amber-700' : overlap ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'
        }`}>
          {rank}
        </span>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onDelete();
          }}
          className="rounded p-0.5 text-slate-400 hover:bg-white hover:text-red-600"
          title="移除課程"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      <p className="mt-1 truncate text-xs font-semibold text-slate-900">{course.name}</p>
      <p className="truncate text-[11px] text-slate-500">
        {course.scheduledOffering?.teacher || course.details?.professor || '未列教師'}
      </p>
      {overlap && (
        <p className={`mt-1 text-[11px] font-medium ${mode === 'lottery' ? 'text-amber-700' : 'text-red-700'}`}>
          {mode === 'lottery' ? '競爭志願' : '衝堂'}
        </p>
      )}
    </button>
  );
}

function PlanningListCourse({
  course,
  rank,
  mode,
  onOpen,
  onDelete,
}: {
  course: Course;
  rank: number;
  mode: PlanningMode;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const slots = course.scheduledOffering?.slots || [];
  return (
    <div className="rounded-md border border-slate-200 bg-white p-3">
      <div className="flex items-start gap-3">
        <div className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
          mode === 'lottery' ? 'bg-red-50 text-red-600' : 'bg-blue-50 text-blue-700'
        }`}>
          {rank}
        </div>
        <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
          <p className="truncate text-sm font-semibold text-slate-900">{course.name}</p>
          <p className="mt-1 text-xs text-slate-500">
            {formatCredits(course.credits)} 學分
            {course.scheduledOffering?.teacher ? `・${course.scheduledOffering.teacher}` : ''}
          </p>
          <p className="mt-1 truncate text-xs text-slate-500">
            {slots.length > 0 ? `${displaySlots(slots)}・${displayClassroom(course.scheduledOffering?.classroom)}` : '未提供節次'}
          </p>
        </button>
        <button
          type="button"
          onClick={onDelete}
          className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
          title="移除課程"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function MetricBox({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'emerald' | 'blue' | 'amber' | 'red' | 'slate';
}) {
  const toneClass = {
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    blue: 'border-blue-200 bg-blue-50 text-blue-700',
    amber: 'border-amber-200 bg-amber-50 text-amber-700',
    red: 'border-red-200 bg-red-50 text-red-700',
    slate: 'border-slate-200 bg-slate-50 text-slate-700',
  }[tone];
  return (
    <div className={`rounded-lg border p-3 ${toneClass}`}>
      <p className="text-xs font-medium opacity-80">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
    </div>
  );
}

function ConflictGroupRow({
  label,
  courses,
  mode,
}: {
  label: string;
  courses: Course[];
  mode: PlanningMode;
}) {
  return (
    <div className={`rounded-md border px-3 py-2 text-sm ${
      mode === 'lottery' ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-red-200 bg-red-50 text-red-900'
    }`}>
      <div className="flex items-center justify-between gap-3">
        <span className="font-semibold">{label}</span>
        <span className="rounded-full bg-white/80 px-2 py-0.5 text-xs font-medium">
          {mode === 'lottery' ? '競爭' : '衝堂'}
        </span>
      </div>
      <p className="mt-1 text-xs opacity-80">
        {courses.map((course) => course.name).join('、')}
      </p>
    </div>
  );
}

function ProgressSummary({
  label,
  value,
  target,
}: {
  label: string;
  value: number;
  target: number;
}) {
  const ratio = target > 0 ? Math.min(100, Math.round((value / target) * 100)) : 0;
  return (
    <div>
      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>{label}</span>
        <span>{formatCredits(value)} / {formatCredits(target)}</span>
      </div>
      <div className="mt-1 h-2 rounded-full bg-slate-100">
        <div className="h-2 rounded-full bg-blue-600" style={{ width: `${ratio}%` }} />
      </div>
    </div>
  );
}

function CourseResultRow({
  offering,
  conflicts,
  alreadyAdded,
  alreadyPending,
  onAddRequirement,
  onSchedule,
}: {
  offering: CourseSearchResult;
  conflicts: Course[];
  alreadyAdded: boolean;
  alreadyPending: boolean;
  onAddRequirement: () => void;
  onSchedule: () => void;
}) {
  const slots = parseNodeSlots(offering.node);
  const status = capacityStatus(offering);
  return (
    <tr className="border-b border-slate-100 hover:bg-slate-50">
      <td className="border-b border-slate-100 px-3 py-3 font-medium text-blue-600">{offering.course_no || '未列'}</td>
      <td className="border-b border-slate-100 px-3 py-3">
        <div className="font-semibold text-slate-900">{offering.course_name}</div>
        <div className="mt-1 flex flex-wrap gap-1">
          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">{requirementLabel(offering.require_option)}</span>
          {alreadyAdded && <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] text-emerald-700">已排入</span>}
          {alreadyPending && <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[11px] text-blue-700">已待選</span>}
          {conflicts.length > 0 && <span className="rounded bg-red-50 px-1.5 py-0.5 text-[11px] text-red-700">衝堂</span>}
        </div>
      </td>
      <td className="border-b border-slate-100 px-3 py-3 text-slate-700">{offering.teacher || '未列教師'}</td>
      <td className="border-b border-slate-100 px-3 py-3 text-slate-700">{formatCredits(offering.credits)}</td>
      <td className="border-b border-slate-100 px-3 py-3 text-slate-700">{displaySlots(slots)}</td>
      <td className="border-b border-slate-100 px-3 py-3 text-slate-700">{displayClassroom(offering.classroom)}</td>
      <td className="border-b border-slate-100 px-3 py-3">
        <span className={`rounded-full px-2 py-1 text-xs font-medium ${
          status === 'available' ? 'bg-emerald-50 text-emerald-700' : status === 'full' ? 'bg-red-50 text-red-700' : 'bg-slate-100 text-slate-600'
        }`}>
          {capacityLabel(offering)}
        </span>
      </td>
      <td className="max-w-[150px] truncate border-b border-slate-100 px-3 py-3 text-slate-500" title={offering.contents || undefined}>
        {offering.contents || (conflicts.length > 0 ? `與 ${conflicts.map((course) => course.name).join('、')} 衝堂` : '無備註')}
      </td>
      <td className="border-b border-slate-100 px-3 py-3">
        <div className="flex justify-end gap-2">
          <button
            onClick={onAddRequirement}
            disabled={alreadyPending}
            className="rounded-md border border-blue-300 px-2.5 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400"
          >
            {alreadyPending ? '已待選' : '加入待選'}
          </button>
          <button
            onClick={onSchedule}
            disabled={alreadyAdded}
            className="rounded-md border border-emerald-300 px-2.5 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400"
          >
            {alreadyAdded ? '已加入' : '排入課表'}
          </button>
        </div>
      </td>
    </tr>
  );
}

function RequirementRow({
  requirement,
  status,
  onOpen,
  onDelete,
  onMoveUp,
  onMoveDown,
  canMoveUp = false,
  canMoveDown = false,
  rank,
}: {
  requirement: PendingRequirement;
  status?: RequirementStatus;
  onOpen: () => void;
  onDelete: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  rank?: number;
}) {
  const completed = Boolean(status?.completed);
  const code = requirementCourseCode(requirement);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen();
        }
      }}
      className={`cursor-pointer rounded-md border p-3 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 ${completed ? 'border-emerald-200 bg-emerald-50 hover:bg-emerald-100' : 'border-slate-200 bg-white hover:bg-slate-50'}`}
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">
          {rank || (completed ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <Clock className="h-4 w-4 text-slate-400" />)}
        </div>
        <div className="min-w-0 flex-1 text-left">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-semibold text-slate-900">{requirement.title}</p>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">
              {requirement.kind === 'credit_pool' ? '學分池' : requirement.kind === 'choice' ? '擇一' : '課程'}
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            {formatCredits(status?.earnedCredits || 0)} / {formatCredits(status?.targetCredits || requirement.requiredCredits || requirement.credits || 0)} 學分
            {code ? `・課碼 ${code}` : requirement.note ? `・${requirement.note}` : ''}
          </p>
        </div>
        {(onMoveUp || onMoveDown) && (
          <div className="flex shrink-0 flex-col gap-1">
            <button
              onClick={(event) => {
                event.stopPropagation();
                onMoveUp?.();
              }}
              disabled={!canMoveUp}
              className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-30"
              title="志願序上移"
            >
              <ArrowUp className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={(event) => {
                event.stopPropagation();
                onMoveDown?.();
              }}
              disabled={!canMoveDown}
              className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-30"
              title="志願序下移"
            >
              <ArrowDown className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
        <button
          onClick={(event) => {
            event.stopPropagation();
            onDelete();
          }}
          className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
          title="移除需求"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function coursePillTone(course: Course): string {
  if (course.program === 'double_major') return 'border-emerald-200 bg-emerald-50 hover:bg-emerald-100';
  if (course.program === 'minor') return 'border-amber-200 bg-amber-50 hover:bg-amber-100';

  switch (course.category) {
    case 'chinese':
      return 'border-orange-200 bg-orange-50 hover:bg-orange-100';
    case 'english':
      return 'border-indigo-200 bg-indigo-50 hover:bg-indigo-100';
    case 'social':
      return 'border-yellow-200 bg-yellow-50 hover:bg-yellow-100';
    case 'pe':
      return 'border-green-200 bg-green-50 hover:bg-green-100';
    case 'gen_ed':
      return 'border-purple-200 bg-purple-50 hover:bg-purple-100';
    case 'compulsory':
      return 'border-rose-200 bg-rose-50 hover:bg-rose-100';
    case 'elective':
      return 'border-sky-200 bg-sky-50 hover:bg-sky-100';
    default:
      return 'border-blue-200 bg-blue-50 hover:bg-blue-100';
  }
}

function CoursePill({
  course,
  conflict = false,
  compact = false,
  onDelete,
  onOpenDetail,
}: {
  course: Course;
  conflict?: boolean;
  compact?: boolean;
  onDelete: () => void;
  onOpenDetail: () => void;
}) {
  const isImportedHistory = isHistoryImportedCourse(course);
  const hasScheduleData = Boolean(course.scheduledOffering);
  const teacher = course.scheduledOffering?.teacher || course.details?.professor;
  const courseMeta = isImportedHistory
    ? `${formatCredits(course.credits)} 學分・${course.grade || '修課紀錄'}`
    : `${formatCredits(course.credits)} 學分・${teacher || (hasScheduleData ? '未列教師' : '未提供節次/教師')}`;
  const toneClass = conflict ? 'border-red-300 bg-red-100' : coursePillTone(course);
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onOpenDetail();
    }
  };
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpenDetail}
      onKeyDown={handleKeyDown}
      className={`group cursor-pointer rounded-md border px-2 py-1.5 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 ${toneClass}`}
      title="編輯課程詳細資訊"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className={`truncate font-semibold ${compact ? 'text-xs' : 'text-[12px]'} text-slate-900`}>{course.name}</p>
          <p className="mt-0.5 truncate text-[11px] text-slate-500">
            {courseMeta}
          </p>
          {!compact && !isImportedHistory && (
            <p className="truncate text-[11px] text-slate-500">{displayClassroom(course.scheduledOffering?.classroom || course.details?.location)}</p>
          )}
        </div>
        <button
          onClick={(event) => {
            event.stopPropagation();
            onDelete();
          }}
          className="rounded p-0.5 text-slate-400 opacity-100 hover:bg-white hover:text-red-600"
          title="移除課程"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

function OfferingModal({
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
      <div className="max-h-[86vh] w-full max-w-3xl overflow-hidden rounded-lg bg-white shadow-xl">
        <div className="border-b border-slate-200 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">{requirement.title}</h2>
              <p className="mt-1 text-sm text-slate-500">
                {code ? `依課碼 ${code} 選擇要排入 ${semesterName} 的班別。` : `選擇要排入 ${semesterName} 的實際開課班別。`}
              </p>
            </div>
            <button onClick={onClose} className="rounded-md px-2 py-1 text-slate-500 hover:bg-slate-100">✕</button>
          </div>
        </div>
        <div className="max-h-[68vh] overflow-y-auto p-4">
          {status === 'loading' && <p className="text-sm text-slate-500">查詢開課資料中...</p>}
          {status === 'error' && <p className="text-sm text-red-600">{error}</p>}
          {status === 'idle' && offerings.length === 0 && <p className="text-sm text-slate-500">查無符合的開課班別。</p>}
          <div className="space-y-3">
            {offerings.map((offering) => {
              const conflicts = findConflicts(offering, data, activeSemesterId);
              const alreadyAdded = Boolean(findScheduledCourseByOffering(offering, data, activeSemesterId));
              const conflictBlocksSchedule = conflicts.length > 0 && planningMode !== 'lottery';
              const hasSlots = parseNodeSlots(offering.node).length > 0;
              return (
                <div key={`${offering.course_no}-${offering.node}-${offering.teacher}`} className="rounded-md border border-slate-200 p-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-950">{offering.course_name}</p>
                      <p className="mt-1 text-sm text-slate-500">
                        {offering.course_no}・{offering.teacher || '未列教師'}・{formatCredits(offering.credits)} 學分
                      </p>
                      <p className="mt-1 text-sm text-slate-500">
                        {displaySlots(parseNodeSlots(offering.node))}・{displayClassroom(offering.classroom)}
                      </p>
                      {offering.contents && <p className="mt-1 text-xs text-slate-400">{offering.contents}</p>}
                      {!hasSlots && (
                        <p className="mt-2 text-sm text-amber-600">此課程沒有節次資料，無法檢查衝堂。</p>
                      )}
                      {alreadyAdded && (
                        <p className="mt-2 flex items-center gap-1 text-sm text-emerald-600">
                          <CheckCircle2 className="h-4 w-4" />
                          已排入目前學期
                        </p>
                      )}
                      {!alreadyAdded && conflicts.length > 0 && (
                        <p className={`mt-2 flex items-center gap-1 text-sm ${planningMode === 'lottery' ? 'text-amber-600' : 'text-red-600'}`}>
                          <AlertTriangle className="h-4 w-4" />
                          {planningMode === 'lottery' ? '同時段競爭：' : '與 '}
                          {conflicts.map((course) => course.name).join('、')}
                          {planningMode === 'lottery' ? '，可作為同時段志願' : ' 衝堂'}
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <button
                        onClick={() => {
                          if (onSchedule(offering, false)) onClose();
                        }}
                        disabled={alreadyAdded || conflictBlocksSchedule}
                        className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                      >
                        {alreadyAdded ? '已加入' : '排入課表'}
                      </button>
                      {!alreadyAdded && conflictBlocksSchedule && (
                        <button
                          onClick={() => {
                            if (onSchedule(offering, true)) onClose();
                          }}
                          className="rounded-md border border-red-300 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
                        >
                          仍要加入
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function SchoolScheduleSyncModal({
  username,
  password,
  status,
  message,
  onUsernameChange,
  onPasswordChange,
  onClose,
  onImport,
}: {
  username: string;
  password: string;
  status: 'idle' | 'loading' | 'error' | 'success';
  message: string;
  onUsernameChange: (username: string) => void;
  onPasswordChange: (password: string) => void;
  onClose: () => void;
  onImport: () => void;
}) {
  const isLoading = status === 'loading';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
      <div className="w-full max-w-md overflow-hidden rounded-lg bg-white shadow-xl">
        <div className="border-b border-slate-200 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-950">
                <KeyRound className="h-5 w-5 text-blue-600" />
                同步校務資料
              </h2>
              <p className="mt-1 text-sm text-slate-500">取得最新選課清單、歷年成績，並自動補查可辨識的歷史節次。</p>
            </div>
            <button onClick={onClose} disabled={isLoading} className="rounded-md px-2 py-1 text-slate-500 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50">✕</button>
          </div>
        </div>
        <form
          className="space-y-4 p-4"
          onSubmit={(event) => {
            event.preventDefault();
            onImport();
          }}
        >
          <div>
            <label className="block text-sm font-medium text-slate-700">校務系統帳號</label>
            <input
              value={username}
              onChange={(event) => onUsernameChange(event.target.value)}
              disabled={isLoading}
              autoComplete="username"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-100"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700">校務系統密碼</label>
            <input
              type="password"
              value={password}
              onChange={(event) => onPasswordChange(event.target.value)}
              disabled={isLoading}
              autoComplete="current-password"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:bg-slate-100"
            />
            <p className="mt-1 text-xs text-slate-500">密碼僅用於本次同步，不會寫入雲端資料。</p>
          </div>
          <div className="rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-sm text-blue-800">
            <p className="font-medium">本次同步會更新：</p>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              <li>目前查詢學期的選課清單</li>
              <li>歷年成績與已修紀錄</li>
              <li>可辨識課程的歷史節次</li>
            </ul>
            <p className="mt-2 text-xs text-blue-700">不會自動送出選課、不會排程重試。</p>
          </div>
          {message && (
            <p className={`rounded-md px-3 py-2 text-sm ${status === 'error' ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>
              {message}
            </p>
          )}
          <div className="flex justify-end gap-2 border-t border-slate-200 pt-4">
            <button
              type="button"
              onClick={onClose}
              disabled={isLoading}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              關閉
            </button>
            <button
              type="submit"
              disabled={isLoading}
              className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
              {isLoading ? '同步中...' : '開始同步'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ImportPreviewModal({
  preview,
  onConfirm,
  onClose,
}: {
  preview: ApiImportPreview;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const name = String(preview.requirement_set.name || 'PDF 匯入需求');
  const totalCredits = preview.requirement_set.total_credits as number | undefined;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
      <div className="max-h-[86vh] w-full max-w-2xl overflow-hidden rounded-lg bg-white shadow-xl">
        <div className="border-b border-slate-200 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">匯入預覽</h2>
              <p className="mt-1 text-sm text-slate-500">{name}{totalCredits ? `・${formatCredits(totalCredits)} 學分` : ''}</p>
            </div>
            <button onClick={onClose} className="rounded-md px-2 py-1 text-slate-500 hover:bg-slate-100">✕</button>
          </div>
        </div>
        <div className="max-h-[62vh] overflow-y-auto p-4">
          {preview.warnings.length > 0 && (
            <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              {preview.warnings.join('；')}
            </div>
          )}
          <div className="space-y-2">
            {preview.pending_requirements.map((requirement) => (
              <div key={String(requirement.id)} className="rounded-md border border-slate-200 p-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-medium text-slate-900">{String(requirement.title)}</p>
                  <span className="text-sm text-slate-500">
                    {formatCredits(requirement.required_credits as number | null | undefined)} 學分
                  </span>
                </div>
                {requirement.note ? <p className="mt-1 text-sm text-slate-500">{String(requirement.note)}</p> : null}
              </div>
            ))}
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-200 p-4">
          <button onClick={onClose} className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
            取消
          </button>
          <button onClick={onConfirm} className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700">
            加入待修池
          </button>
        </div>
      </div>
    </div>
  );
}
