import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileText,
  KeyRound,
  Loader2,
  RefreshCw,
  Search,
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
import { Sidebar } from './components/Sidebar';
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

function semesterIdForStudentTerm(academicTerm: string, studentNo: string): string | null {
  return semesterIdForAcademicTerm(academicTerm, inferAdmissionYearFromStudentNo(studentNo));
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
  const semesterIds = new Set(semesters.map((semester) => semester.id));
  let firstSemesterId: string | null = null;
  let importedCourseCount = 0;
  let scheduledHistoryCourseCount = 0;
  const seenHistoryKeys = new Set<string>();

  const nextSemesters = semesters.map((semester) => ({
    ...semester,
    courses: semester.courses.filter((course) => !isHistoryImportedCourse(course)),
  }));

  records.forEach((record) => {
    const semesterId = semesterIdForAcademicTerm(record.academicTerm, admissionYear);
    if (!semesterId || !semesterIds.has(semesterId)) return;
    const targetSemester = nextSemesters.find((semester) => semester.id === semesterId);
    if (!targetSemester) return;

    const historyKey = `${semesterId}-${record.academicTerm}-${historyRecordKey(record)}`;
    if (seenHistoryKeys.has(historyKey)) return;
    seenHistoryKeys.add(historyKey);

    if (targetSemester.courses.some((course) => courseMatchesHistoryRecord(course, record))) return;
    const course = courseFromHistoryRecord(record, lookups.get(historicalLookupKey(record)));
    targetSemester.courses = [...targetSemester.courses, course];
    importedCourseCount += 1;
    if (course.scheduledOffering?.slots.length) scheduledHistoryCourseCount += 1;
    if (!firstSemesterId) firstSemesterId = semesterId;
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
  const [hasMigratedHistoryCourses, setHasMigratedHistoryCourses] = useState(false);
  const [detailCourse, setDetailCourse] = useState<{ semesterId: string; course: Course } | null>(null);

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
    if (hasMigratedHistoryCourses || data.historyRecords.length === 0) return;
    if (data.semesters.some((semester) => semester.courses.some(isHistoryImportedCourse))) {
      setHasMigratedHistoryCourses(true);
      return;
    }
    const merged = mergeHistoryRecordsIntoSemesters(data.semesters, data.historyRecords, schoolUsername);
    if (merged.importedCourseCount === 0) return;
    setData((prev) => {
      if (prev.semesters.some((semester) => semester.courses.some(isHistoryImportedCourse))) return prev;
      const next = mergeHistoryRecordsIntoSemesters(prev.semesters, prev.historyRecords, schoolUsername);
      return next.importedCourseCount > 0 ? { ...prev, semesters: next.semesters } : prev;
    });
    if (merged.firstSemesterId) setActiveSemesterId(merged.firstSemesterId);
    setHasMigratedHistoryCourses(true);
  }, [data.historyRecords, data.semesters, hasMigratedHistoryCourses, schoolUsername, setData]);

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
  const requirementStatuses = useMemo(() => {
    const map = new Map<string, RequirementStatus>();
    data.pendingRequirements.forEach((requirement) => {
      map.set(requirement.id, getRequirementStatus(requirement, data));
    });
    return map;
  }, [data]);
  const completedRequirements = Array.from(requirementStatuses.values()).filter((status) => status.completed).length;

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
      setManualStatus('idle');
    } catch (error) {
      setManualStatus('error');
      setManualError(error instanceof Error ? error.message : '課程查詢失敗');
    }
  };

  const searchForRequirement = async (requirement: PendingRequirement) => {
    setActiveRequirement(requirement);
    setOfferingStatus('loading');
    setOfferingError('');
    setOfferingResults([]);
    const isCreditPool = requirement.kind === 'credit_pool' && requirement.courseCodePrefix;
    const query = isCreditPool ? requirement.courseCodePrefix || '' : requirement.courseNames[0] || requirement.title;
    try {
      const results = await searchCourses(querySemester, query, isCreditPool ? 'code' : 'name');
      setOfferingResults(results);
      setOfferingStatus('idle');
    } catch (error) {
      setOfferingStatus('error');
      setOfferingError(error instanceof Error ? error.message : '開課查詢失敗');
    }
  };

  const addCourseToSemester = (offering: CourseSearchResult, requirement?: PendingRequirement, force = false) => {
    if (findScheduledCourseByOffering(offering, data, activeSemesterId)) {
      return;
    }
    const conflicts = findConflicts(offering, data, activeSemesterId);
    if (conflicts.length > 0 && !force) {
      const names = conflicts.map((course) => course.name).join('、');
      if (!window.confirm(`這門課與 ${names} 衝堂，仍要排入嗎？`)) return;
    }
    const course = courseFromOffering(offering, requirement);
    setData((prev) => ({
      ...prev,
      semesters: prev.semesters.map((semester) => (
        semester.id === activeSemesterId
          ? { ...semester, courses: [...semester.courses, course] }
          : semester
      )),
    }));
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
      courseCodePrefix: null,
    };
    setData((prev) => ({
      ...prev,
      requirementSets: ensureManualSet(prev),
      pendingRequirements: [...prev.pendingRequirements, requirement],
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
    const inferredSemesterId = semesterIdForStudentTerm(querySemester, username);
    if (inferredSemesterId && data.semesters.some((semester) => semester.id === inferredSemesterId)) {
      setSchoolSyncMessage(`已依學號與查詢學期 ${querySemester} 推算最新課表會匯入「${data.semesters.find((semester) => semester.id === inferredSemesterId)?.name}」。`);
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

    const inferredSemesterId = semesterIdForStudentTerm(querySemester, username);
    const importSemesterId = inferredSemesterId && data.semesters.some((semester) => semester.id === inferredSemesterId) ? inferredSemesterId : null;
    if (!importSemesterId) {
      setSchoolSyncStatus('error');
      setSchoolSyncMessage(`無法依帳號與查詢學期 ${querySemester} 推算匯入學期，請確認校務帳號是學號格式。`);
      return;
    }
    const targetSemester = data.semesters.find((semester) => semester.id === importSemesterId);
    if (!targetSemester) {
      setSchoolSyncStatus('error');
      setSchoolSyncMessage('找不到要匯入的學期。');
      return;
    }

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
      setHasMigratedHistoryCourses(true);
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
        onOpenSettings={() => setIsSettingsOpen(true)}
        onOpenHelp={() => setIsOnboardingOpen(true)}
        onExitDemo={() => setIsDemoMode(false)}
      />

      <main className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8">
        <div className="mb-4 flex flex-col gap-3 border-b border-slate-200 pb-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-slate-950">修課規劃工作區</h1>
            <p className="mt-1 text-sm text-slate-500">
              已完成 {completedRequirements} / {data.pendingRequirements.length} 個待修需求，已安排 {formatCredits(stats.total)} 學分。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setIsSchoolSyncOpen(true)}
              className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              <RefreshCw className="h-4 w-4" />
              同步校務資料
            </button>
            <label className="text-sm font-medium text-slate-600">查詢學期</label>
            <select
              value={querySemester}
              onChange={(event) => setQuerySemester(event.target.value)}
              className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            >
              {courseSemesters.length === 0 && <option value={querySemester}>{querySemester}</option>}
              {courseSemesters.map((semester) => (
                <option key={semester.semester} value={semester.semester}>
                  {semester.semester}{semester.english_label ? `・${semester.english_label}` : ''}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[380px_minmax(0,1fr)]">
          <aside className="space-y-4">
            <Sidebar data={data} stats={stats} />

            <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900">
                  <Upload className="h-4 w-4 text-blue-600" />
                  PDF 匯入
                </h2>
                {importStatus === 'loading' && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
              </div>
              <label className="flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-slate-300 px-3 py-3 text-sm font-medium text-slate-600 hover:border-blue-400 hover:bg-blue-50 hover:text-blue-700">
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
            </section>

            <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="mb-3 flex items-center gap-2 text-base font-semibold text-slate-900">
                <Search className="h-4 w-4 text-emerald-600" />
                手動查課
              </h2>
              <div className="flex gap-2">
                <select
                  value={manualMode}
                  onChange={(event) => setManualMode(event.target.value as SearchMode)}
                  className="w-24 rounded-md border border-slate-300 bg-white px-2 py-2 text-sm"
                >
                  <option value="name">課名</option>
                  <option value="code">課碼</option>
                </select>
                <input
                  value={manualQuery}
                  onChange={(event) => setManualQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void runManualSearch();
                  }}
                  placeholder="例如：資料結構 或 CS3005301"
                  className="min-w-0 flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                />
                <button
                  onClick={() => void runManualSearch()}
                  className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700"
                >
                  查詢
                </button>
              </div>
              {manualStatus === 'loading' && <p className="mt-3 text-sm text-slate-500">查詢中...</p>}
              {manualError && <p className="mt-3 text-sm text-red-600">{manualError}</p>}
              <div className="mt-3 max-h-72 space-y-2 overflow-y-auto">
                {manualResults.map((offering) => (
                  <CourseResultRow
                    key={`${offering.course_no}-${offering.node}-${offering.teacher}`}
                    offering={offering}
                    conflicts={findConflicts(offering, data, activeSemesterId)}
                    alreadyAdded={Boolean(findScheduledCourseByOffering(offering, data, activeSemesterId))}
                    onAddRequirement={() => addOfferingAsRequirement(offering)}
                    onSchedule={() => addCourseToSemester(offering)}
                  />
                ))}
              </div>
            </section>

            <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-100 p-4">
                <h2 className="text-base font-semibold text-slate-900">待修需求池</h2>
                <p className="mt-1 text-sm text-slate-500">
                  {data.requirementSets.length} 份規則，{data.pendingRequirements.length} 個需求
                  {data.historyRecords.length > 0 ? `，已匯入 ${data.historyRecords.length} 筆修課紀錄。` : '。'}
                </p>
              </div>
              <div className="max-h-[720px] overflow-y-auto p-3">
                {data.requirementSets.length > 0 && (
                  <div className="mb-3 flex flex-wrap gap-2">
                    {data.requirementSets.map((set) => (
                      <span key={set.id} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
                        {set.name}{set.totalCredits ? `・${formatCredits(set.totalCredits)} 學分` : ''}
                      </span>
                    ))}
                  </div>
                )}
                {data.pendingRequirements.length === 0 ? (
                  <div className="rounded-md border border-dashed border-slate-300 p-5 text-center text-sm text-slate-500">
                    尚未匯入待修需求
                  </div>
                ) : (
                  <div className="space-y-2">
                    {data.pendingRequirements.map((requirement) => (
                      <RequirementRow
                        key={requirement.id}
                        requirement={requirement}
                        status={requirementStatuses.get(requirement.id)}
                        onOpen={() => void searchForRequirement(requirement)}
                        onDelete={() => deleteRequirement(requirement.id)}
                      />
                    ))}
                  </div>
                )}
              </div>
            </section>
          </aside>

          <section className="min-w-0 rounded-lg border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-slate-950">學期週課表</h2>
                  <p className="mt-1 text-sm text-slate-500">
                    目前安排 {activeSemester?.courses.length || 0} 門課，{formatCredits(activeSemester?.courses.reduce((sum, course) => sum + (course.category === 'pe' ? 0 : course.credits), 0) || 0)} 學分。
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {data.semesters.map((semester) => (
                    <button
                      key={semester.id}
                      onClick={() => setActiveSemesterId(semester.id)}
                      className={`rounded-md px-3 py-2 text-sm font-medium ${
                        semester.id === activeSemesterId
                          ? 'bg-slate-900 text-white'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      {semester.name}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            {activeSemester && (
              <WeeklySchedule
                semester={activeSemester}
                onDeleteCourse={(courseId) => deleteCourse(activeSemester.id, courseId)}
                onOpenCourseDetail={(course) => setDetailCourse({ semesterId: activeSemester.id, course })}
              />
            )}
          </section>
        </div>
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

function CourseResultRow({
  offering,
  conflicts,
  alreadyAdded,
  onAddRequirement,
  onSchedule,
}: {
  offering: CourseSearchResult;
  conflicts: Course[];
  alreadyAdded: boolean;
  onAddRequirement: () => void;
  onSchedule: () => void;
}) {
  return (
    <div className="rounded-md border border-slate-200 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-900">{offering.course_name}</p>
          <p className="mt-1 text-xs text-slate-500">
            {offering.course_no}・{offering.teacher || '未列教師'}・{formatCredits(offering.credits)} 學分
          </p>
          <p className="mt-1 text-xs text-slate-500">{displaySlots(parseNodeSlots(offering.node))}・{displayClassroom(offering.classroom)}</p>
          {alreadyAdded && (
            <p className="mt-1 flex items-center gap-1 text-xs text-emerald-600">
              <CheckCircle2 className="h-3 w-3" />
              已排入目前學期
            </p>
          )}
          {!alreadyAdded && conflicts.length > 0 && (
            <p className="mt-1 flex items-center gap-1 text-xs text-red-600">
              <AlertTriangle className="h-3 w-3" />
              與 {conflicts.map((course) => course.name).join('、')} 衝堂
            </p>
          )}
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          onClick={onAddRequirement}
          className="rounded-md border border-slate-300 px-2 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          加入待修
        </button>
        <button
          onClick={onSchedule}
          disabled={alreadyAdded}
          className="rounded-md bg-blue-600 px-2 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {alreadyAdded ? '已加入' : '排入課表'}
        </button>
      </div>
    </div>
  );
}

function RequirementRow({
  requirement,
  status,
  onOpen,
  onDelete,
}: {
  requirement: PendingRequirement;
  status?: RequirementStatus;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const completed = Boolean(status?.completed);
  return (
    <div className={`rounded-md border p-3 ${completed ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-white'}`}>
      <div className="flex items-start gap-3">
        <div className="mt-0.5">
          {completed ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <Clock className="h-4 w-4 text-slate-400" />}
        </div>
        <button onClick={onOpen} className="min-w-0 flex-1 text-left">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-semibold text-slate-900">{requirement.title}</p>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500">
              {requirement.kind === 'credit_pool' ? '學分池' : requirement.kind === 'choice' ? '擇一' : '課程'}
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            {formatCredits(status?.earnedCredits || 0)} / {formatCredits(status?.targetCredits || requirement.requiredCredits || requirement.credits || 0)} 學分
            {requirement.note ? `・${requirement.note}` : ''}
          </p>
        </button>
        <button
          onClick={onDelete}
          className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
          title="移除需求"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function WeeklySchedule({
  semester,
  onDeleteCourse,
  onOpenCourseDetail,
}: {
  semester: AppData['semesters'][number];
  onDeleteCourse: (courseId: string) => void;
  onOpenCourseDetail: (course: Course) => void;
}) {
  const unscheduledPlanned = semester.courses.filter((course) => !course.scheduledOffering?.slots.length && !isHistoryImportedCourse(course));
  const historyRecords = semester.courses.filter((course) => !course.scheduledOffering?.slots.length && isHistoryImportedCourse(course));
  return (
    <div className="p-4">
      <div className="overflow-x-auto">
        <div className="min-w-[980px]">
          <div className="grid grid-cols-[72px_repeat(7,minmax(120px,1fr))] border-l border-t border-slate-200 text-sm">
            <div className="border-b border-r border-slate-200 bg-slate-50 p-2 font-medium text-slate-500">節次</div>
            {DAY_COLUMNS.map((day) => (
              <div key={day.code} className="border-b border-r border-slate-200 bg-slate-50 p-2 text-center font-semibold text-slate-700">
                星期{day.label}
              </div>
            ))}
            {PERIODS.map((period) => (
              <ScheduleRow
                key={period}
                period={period}
                semester={semester}
                onDeleteCourse={onDeleteCourse}
                onOpenCourseDetail={onOpenCourseDetail}
              />
            ))}
          </div>
        </div>
      </div>

      {unscheduledPlanned.length > 0 && (
        <div className="mt-4 border-t border-slate-100 pt-4">
          <h3 className="mb-2 text-sm font-semibold text-slate-700">未排入時間的規劃課程</h3>
          <div className="flex flex-wrap gap-2">
            {unscheduledPlanned.map((course) => (
              <CoursePill
                key={course.id}
                course={course}
                onDelete={() => onDeleteCourse(course.id)}
                onOpenDetail={() => onOpenCourseDetail(course)}
                compact
              />
            ))}
          </div>
        </div>
      )}

      {historyRecords.length > 0 && (
        <div className="mt-4 border-t border-slate-100 pt-4">
          <h3 className="mb-2 text-sm font-semibold text-slate-700">修課紀錄（未補到節次）</h3>
          <div className="flex flex-wrap gap-2">
            {historyRecords.map((course) => (
              <CoursePill
                key={course.id}
                course={course}
                onDelete={() => onDeleteCourse(course.id)}
                onOpenDetail={() => onOpenCourseDetail(course)}
                compact
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ScheduleRow({
  period,
  semester,
  onDeleteCourse,
  onOpenCourseDetail,
}: {
  period: string;
  semester: AppData['semesters'][number];
  onDeleteCourse: (courseId: string) => void;
  onOpenCourseDetail: (course: Course) => void;
}) {
  return (
    <>
      <div className="border-b border-r border-slate-200 bg-slate-50 p-2 text-center font-semibold text-slate-600">{period}</div>
      {DAY_COLUMNS.map((day) => {
        const slot = `${day.code}${period}`;
        const courses = semester.courses.filter((course) => course.scheduledOffering?.slots.includes(slot));
        return (
          <div key={slot} className={`min-h-24 border-b border-r border-slate-200 p-1.5 ${courses.length > 1 ? 'bg-red-50' : 'bg-white'}`}>
            <div className="space-y-1.5">
              {courses.map((course) => (
                <CoursePill
                  key={course.id}
                  course={course}
                  conflict={courses.length > 1}
                  onDelete={() => onDeleteCourse(course.id)}
                  onOpenDetail={() => onOpenCourseDetail(course)}
                />
              ))}
            </div>
          </div>
        );
      })}
    </>
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
  const courseMeta = isImportedHistory
    ? `${formatCredits(course.credits)} 學分・${course.grade || '修課紀錄'}`
    : `${formatCredits(course.credits)} 學分・${course.scheduledOffering?.teacher || course.details?.professor || '未列教師'}`;
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
  onClose: () => void;
  onSchedule: (offering: CourseSearchResult, force: boolean) => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
      <div className="max-h-[86vh] w-full max-w-3xl overflow-hidden rounded-lg bg-white shadow-xl">
        <div className="border-b border-slate-200 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">{requirement.title}</h2>
              <p className="mt-1 text-sm text-slate-500">選擇要排入 {semesterName} 的實際開課班別。</p>
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
                        <p className="mt-2 flex items-center gap-1 text-sm text-red-600">
                          <AlertTriangle className="h-4 w-4" />
                          與 {conflicts.map((course) => course.name).join('、')} 衝堂
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <button
                        onClick={() => onSchedule(offering, false)}
                        disabled={alreadyAdded || conflicts.length > 0}
                        className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                      >
                        {alreadyAdded ? '已加入' : '排入課表'}
                      </button>
                      {!alreadyAdded && conflicts.length > 0 && (
                        <button
                          onClick={() => onSchedule(offering, true)}
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
