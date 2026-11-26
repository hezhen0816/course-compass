export type CourseCategory = 
  | 'compulsory'   // 系必修
  | 'elective'     // 系選修/一般選修
  | 'chinese'      // 國文
  | 'english'      // 英文
  | 'gen_ed'       // 通識
  | 'pe'           // 體育
  | 'social'       // 社會實踐
  | 'other'        // 其他
  | 'unclassified'; // 未歸類

export type GenEdDimension = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'None';
export type CourseProgram = 'home' | 'double_major' | 'minor' | 'other';
/**
 * course：對得上課名（或課碼前綴）就算完成；課名寫多門＝擇一。
 * credit_pool：湊滿學分才算完成。
 * 舊資料的 'choice'／'course_group' 在 normalizeRequirementKind() 讀進來時一律轉成 course——
 * 進度計算本來就只特判 credit_pool，choice 與 course 走的是同一條判定，欄位是冗餘的。
 */
export type RequirementKind = 'course' | 'credit_pool';
/** other_teacher：課號有 GPA，但那學期是別的老師教的，找不到這位老師的班。 */
export type GpaStatus = 'not_enabled' | 'found' | 'no_data' | 'error' | 'rate_limited' | 'other_teacher';

export interface GradingItem {
  id: string;
  name: string;
  weight: number;
  score?: number;
}

export interface CourseDetails {
  professor?: string;
  email?: string;
  location?: string;
  time?: string;
  link?: string;
  gradingPolicy: GradingItem[];
  notes?: string;
}

export interface ScheduledOffering {
  semester: string;
  courseNo: string;
  courseName: string;
  teacher: string;
  credits?: number | null;
  classroom: string;
  node: string;
  slots: string[];
  requireOption: string;
  contents: string;
  gpa?: number | null;
  gpaStatus?: GpaStatus;
  gpaSemester?: number | null;
  gpaStudents?: number | null;
  gpaTeacher?: string | null;
  gpaCourseNo?: string | null;
  selectedCount?: number | null;
  capacity?: number | null;
}

export interface Course {
  id: string;
  name: string;
  credits: number;
  category: CourseCategory;
  program?: CourseProgram;
  dimension?: GenEdDimension; // For General Education
  grade?: string;
  details?: CourseDetails;
  sourceRequirementId?: string;
  sourceSetId?: string;
  scheduledOffering?: ScheduledOffering;
  virtualSelection?: {
    status: 'rejected' | 'manual';
    reason: string;
    createdAt: string;
  };
}

export interface Semester {
  id: string;
  name: string;
  courses: Course[];
}

export interface SelectionPlan {
  targetAcademicTerm: string;
  targetLabel?: string;
  courses: Course[];
  officialSelectionCache?: OfficialSelectionSyncResponse | null;
  updatedAt?: string;
}

/** 多學期排課：送給後端的條件與拿回來的配置，一起存，之後重開頁面不用重跑。 */
export interface PlannerSolveRequestPayload {
  terms: string[];
  requirements: Array<{
    id: string;
    title: string;
    credits: number;
    course_names: string[];
    required: boolean;
    department_prefixes: string[];
    pool_credits?: number | null;
  }>;
  min_credits: Record<string, number>;
  max_credits: Record<string, number>;
  reserved_credits: Record<string, number>;
  prerequisites: string[][];
  deadlines: Record<string, string>;
  campus_gap: boolean;
  preference: 'gpa' | 'balanced';
  include_cross_school: boolean;
  preferred_prefixes?: string[];
}

export interface PlannerPlacement {
  term: string;
  candidate_id: string;
  requirement_id: string;
  course_no: string;
  name: string;
  teacher: string;
  credits: number;
  slots: string[];
  gpa?: number | null;
  students?: number | null;
  campus: string;
  risk: number;
  source_semester: string;
  contents?: string;
  eligibility?: 'open' | 'signature' | 'blocked' | 'unknown';
  offered_terms?: string[];
}

export interface PlannerSolveResponsePayload {
  status: 'found' | 'not_enabled' | 'rate_limited' | 'error';
  solver_status: string;
  placements: PlannerPlacement[];
  unplaced: Array<{ requirement_id: string; reason: string }>;
  notes: Record<string, string>;
  credits_by_term: Record<string, number>;
  stages: Array<Record<string, unknown>>;
  candidates: PlannerPlacement[];
}

export interface MultiSemesterPlan {
  request: PlannerSolveRequestPayload;
  response: PlannerSolveResponsePayload;
  solvedAt: string;
}

export interface SchoolSyncStatus {
  scheduleSyncedAt?: string;
  scheduleCourseCount?: number;
  historyImportedAt?: string;
  historyRecordCount?: number;
}

export interface AppTargets {
  total: number;
  chinese: number;
  english: number;
  gen_ed: number;
  pe_semesters: number;
  social: number;
  home_compulsory: number;
  home_elective: number;
  double_major: number;
  minor: number;
}

/** GPA 密鑰狀態；密鑰本身只存在後端 app_private，前端不持有。 */
export interface GpaApiKeyStatus {
  enabled: boolean;
  hasApiKey: boolean;
  updatedAt?: string | null;
}

export interface ProgramDepartmentSettings {
  homeDepartmentCode?: string;
  doubleMajorDepartmentCode?: string;
  minorDepartmentCode?: string;
}

export interface AppSettings {
  programDepartments?: ProgramDepartmentSettings;
  [key: string]: unknown;
}

export interface RequirementOption {
  name: string;
  credits?: number | null;
  courseNames: string[];
}

export interface RequirementSet {
  id: string;
  name: string;
  department?: string;
  source: 'pdf' | 'manual' | 'system';
  sourceFileName?: string | null;
  totalCredits?: number | null;
  notes?: string[];
}

export interface PendingRequirement {
  id: string;
  setId: string;
  kind: RequirementKind;
  title: string;
  credits?: number | null;
  requiredCredits?: number | null;
  courseNames: string[];
  options: RequirementOption[];
  note?: string;
  courseCodePrefix?: string | null;
  /** 應修科目表「開課系所」欄 → 課碼前兩碼；多學期規劃與資格判斷用。 */
  departmentPrefixes?: string[];
}

export type AcademicHistoryStatus = 'passed' | 'in_progress' | 'failed';

export interface AcademicHistoryRecord {
  category: string;
  courseCode: string;
  courseName: string;
  academicTerm: string;
  grade: string;
  credits: number;
  status: AcademicHistoryStatus;
  dimension?: GenEdDimension;
}

export interface AppData {
  [key: string]: unknown;
  schemaVersion: number;
  semesters: Semester[];
  targets: AppTargets;
  settings?: AppSettings;
  selectionPlan?: SelectionPlan;
  /** When school data was last pulled through the backend; shown as sync status. */
  schoolSync?: SchoolSyncStatus;
  requirementSets: RequirementSet[];
  pendingRequirements: PendingRequirement[];
  historyRecords: AcademicHistoryRecord[];
  multiSemesterPlan?: MultiSemesterPlan | null;
}

export interface PlannerStats {
  total: number;
  chinese: number;
  english: number;
  gen_ed: number;
  pe_semesters: number;
  social: number;
  homeCompulsory: number;
  homeElective: number;
  doubleMajor: number;
  minor: number;
  genEdDimensions: Set<string>;
}

export interface CourseSearchResult {
  semester: string;
  course_no: string;
  course_name: string;
  teacher: string;
  dimension: string;
  credits: number | null;
  require_option: string;
  classroom: string;
  node: string;
  contents: string;
  gpa?: number | null;
  gpa_status?: GpaStatus;
  gpa_semester?: number | null;
  gpa_students?: number | null;
  gpa_teacher?: string | null;
  gpa_course_no?: string | null;
  selected_count?: number | null;
  capacity?: number | null;
}

export interface GpaHistoryRow {
  semester: number;
  course_no: string;
  teacher: string;
  gpa?: number | null;
  students?: number | null;
  distribution?: Record<string, number> | null;
}

export interface GpaHistoryResponse {
  course_name: string;
  status: 'found' | 'not_enabled' | 'error' | 'rate_limited';
  rows: GpaHistoryRow[];
}

export interface CourseSemesterInfo {
  semester: string;
  english_label?: string | null;
  current: boolean;
}

export interface RequirementPdfImportResponse {
  requirement_set: RequirementSet;
  pending_requirements: PendingRequirement[];
  /** 一份 PDF 可能有好幾個系所的表；前兩個欄位只是第一個表（舊版相容）。 */
  requirement_sets?: Array<{ requirement_set: RequirementSet; pending_requirements: PendingRequirement[] }>;
  warnings: string[];
  raw_text_preview: string;
}

export interface ScheduleSyncRequest {
  username: string;
  password: string;
  profile_key?: string | null;
  persist_to_supabase: boolean;
  verify_ssl: boolean;
}

export interface SyncedCourseRow {
  course_code: string;
  course_name: string;
  credits: number | string;
  required_type: string;
  professor: string;
  note: string;
  /** 同步時後端有 GPA 密鑰就會帶；沒有就是空的（不是「未啟用」）。 */
  gpa?: number | null;
  gpa_status?: GpaStatus;
  gpa_semester?: number | null;
  gpa_students?: number | null;
  gpa_teacher?: string | null;
  gpa_course_no?: string | null;
}

export interface SyncedScheduleSlot {
  weekday_key: string;
  weekday_label: string;
  period: string;
  time: string;
  course_name: string;
  location: string;
  raw: string;
}

export interface ScheduleSyncResponse {
  profile_key: string;
  school_account: string;
  student_name?: string | null;
  source_url: string;
  page_title: string;
  total_credits_text: string;
  total_credits: number | null;
  synced_at: string;
  course_count: number;
  scheduled_slot_count: number;
  schedule_entry_count: number;
  persisted_to_supabase: boolean;
  courses: SyncedCourseRow[];
  slots: SyncedScheduleSlot[];
}

export interface HistoryCourseRecord {
  category: string;
  course_code: string;
  course_name: string;
  academic_term: string;
  grade: string;
  earned_credits: string;
  ge_dimension?: string;
}

export interface HistoryImportResponse {
  profile_key: string;
  school_account: string;
  student_name?: string | null;
  student_no?: string | null;
  department?: string | null;
  status?: string | null;
  source_url: string;
  page_title: string;
  imported_at: string;
  record_count: number;
  persisted_to_supabase: boolean;
  summary_texts: string[];
  records: HistoryCourseRecord[];
}

export interface OfficialSelectionAvailableCourse {
  course_no: string;
  course_name: string;
  teacher: string;
  gpa?: number | null;
  gpa_status?: GpaStatus;
  gpa_semester?: number | null;
  gpa_students?: number | null;
  gpa_teacher?: string | null;
  gpa_course_no?: string | null;
}

export interface OfficialSelectionRegisteredCourse {
  priority?: number | null;
  raw_priority: string;
  course_no: string;
  course_name: string;
  credits?: number | null;
  require_option?: string;
  teacher?: string;
  classroom?: string;
  node?: string;
  contents?: string;
  selected_count?: number | null;
  capacity?: number | null;
  gpa?: number | null;
  gpa_status?: GpaStatus;
  gpa_semester?: number | null;
  gpa_students?: number | null;
  gpa_teacher?: string | null;
  gpa_course_no?: string | null;
}

export interface OfficialSelectionRequiredPresetCourse {
  course_no: string;
  course_name: string;
  credits?: number | null;
  require_option?: string;
  teacher?: string;
  classroom?: string;
  node?: string;
  contents?: string;
  selected_count?: number | null;
  capacity?: number | null;
  gpa?: number | null;
  gpa_status?: GpaStatus;
  gpa_semester?: number | null;
  gpa_students?: number | null;
  gpa_teacher?: string | null;
  gpa_course_no?: string | null;
}

export interface OfficialSelectionSyncResponse {
  profile_key: string;
  school_account: string;
  source_url: string;
  page_title: string;
  synced_at: string;
  session_valid: boolean;
  available_count: number;
  registered_count: number;
  available_courses: OfficialSelectionAvailableCourse[];
  registered_courses: OfficialSelectionRegisteredCourse[];
  schedule_rows: Record<string, string>[];
  selection_list_rows: Record<string, string>[];
  required_preset_rows: Record<string, string>[];
  required_preset_courses: OfficialSelectionRequiredPresetCourse[];
  notices: string[];
  /** 官方對這次加退選動作的回覆；沒說明原因時是空的。 */
  action_notices?: string[];
}
