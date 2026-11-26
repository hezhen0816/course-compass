import type { AppData, Course, Semester } from '../../shared/types';
import {
  DAY_COLUMNS,
  guessCurrentSemester,
  isHistoryImportedCourse,
  parseNodeSlots,
} from '../../shared/domain/planner';
import { classPeriod, mergeAdjacentPeriods, visiblePeriodRange } from '../../shared/domain/classPeriods';
import { classifyCourseByCode } from '../../shared/domain/courseClassification';

/** 課表上的類別；顏色與圖例都照這個分。 */
export type SemesterCategory = 'major' | 'double' | 'minor' | 'gened' | 'pe' | 'elective';

export const CATEGORY_LABELS: Record<SemesterCategory, string> = {
  major: '本系必修',
  double: '雙主修',
  minor: '輔系',
  gened: '通識',
  pe: '體育',
  elective: '選修',
};

/**
 * 跟選課工作台用同一套判斷（照課碼的系所代碼比對本系／雙主修／輔系），
 * 否則同一門課在兩頁會顯示成不同類別 —— 校務同步進來的雙主修課常常只標「必修」。
 */
export function semesterCategory(course: Course, data: AppData): SemesterCategory {
  const courseNo = course.scheduledOffering?.courseNo || '';
  const requireOption = course.scheduledOffering?.requireOption;
  const { tone } = classifyCourseByCode(courseNo, requireOption, data);
  if (tone === 'doubleMajor') return 'double';
  if (tone === 'minor') return 'minor';
  if (tone === 'general') return 'gened';
  if (tone === 'pe') return 'pe';
  if (tone === 'required') return 'major';
  if (tone === 'elective') return 'elective';

  // 課碼判斷不出來時（例如沒有課碼的舊資料）退回課程本身的欄位
  if (course.program === 'double_major') return 'double';
  if (course.program === 'minor') return 'minor';
  if (course.category === 'gen_ed') return 'gened';
  if (course.category === 'pe') return 'pe';
  if (course.category === 'compulsory') return 'major';
  return 'elective';
}

export interface SemesterBlock {
  key: string;
  course: Course;
  category: SemesterCategory;
  /** 星期代碼 M/T/W/R/F/S/U */
  day: string;
  periods: string[];
  startMin: number;
  endMin: number;
  /** 官方還沒放行（待加簽），課表上畫成虛線 */
  pending: boolean;
  /** 本地未來規劃，還沒送過官方；也是虛線，但標「規劃中」 */
  planned: boolean;
  /** 同一時段有幾道並排、自己在第幾道；沒重疊時 0 / 1 */
  lane: number;
  laneCount: number;
  /** 待加簽或規劃中的課疊到別的課：加退選期這就是衝堂 */
  clash: boolean;
}

export interface SemesterView {
  semester: Semester | undefined;
  /** 這學期修課中的課（不含歷史匯入） */
  courses: Course[];
  blocks: SemesterBlock[];
  days: { code: string; label: string }[];
  credits: number;
  pendingCredits: number;
  pendingCourses: Course[];
  /** 本地未來規劃（只有 `includePlanned` 時才會有） */
  plannedCourses: Course[];
  plannedCredits: number;
  /** 待加簽清單裡其實已經選上的那幾筆，可以移除 */
  duplicatePendingCourses: Course[];
}

export interface SemesterViewOptions {
  /** 把本地未來規劃（`virtualSelection.status === 'manual'`）也畫進課表；選課工作台要，本學期頁不要 */
  includePlanned?: boolean;
}

function isInProgress(course: Course): boolean {
  return !isHistoryImportedCourse(course) && !course.virtualSelection;
}

function isPending(course: Course): boolean {
  return course.virtualSelection?.status === 'rejected';
}

function isPlanned(course: Course): boolean {
  return course.virtualSelection?.status === 'manual';
}

function courseSlots(course: Course): string[] {
  const offering = course.scheduledOffering;
  if (offering?.slots?.length) return offering.slots.map((slot) => slot.toUpperCase());
  return parseNodeSlots(offering?.node || course.details?.time || '');
}

/**
 * 找出「本學期」：優先取課程掛著當前學年期的那一個學期，其次取有修課中課程的最後一個。
 * 使用者的資料把 1151 的課放在「大二上」，所以不能直接照學期名稱找。
 */
export function resolveCurrentSemester(data: AppData, now: Date = new Date()): Semester | undefined {
  const term = guessCurrentSemester(now);
  const byTerm = data.semesters.find((semester) =>
    semester.courses.some((course) => course.scheduledOffering?.semester === term),
  );
  if (byTerm) return byTerm;
  return [...data.semesters].reverse().find((semester) => semester.courses.some(isInProgress));
}

export function buildSemesterView(data: AppData, now: Date = new Date(), options: SemesterViewOptions = {}): SemesterView {
  const semester = resolveCurrentSemester(data, now);
  const all = semester?.courses ?? [];
  const courses = all.filter(isInProgress);

  // 已選上的課由校務同步寫進學期；待加簽是本地規劃，放在 selectionPlan。
  // 兩邊都要畫進課表，否則課表上會看不到還沒放行的那幾門。
  const enrolledNames = new Set(courses.map((course) => course.name.trim()));
  const enrolledCourseNos = new Set(
    courses.map((course) => (course.scheduledOffering?.courseNo || '').trim().toUpperCase()).filter(Boolean),
  );
  // 有課碼就比課碼：同名不同班（三個「資料結構」）是不同的課，只有沒課碼的舊資料才退回比課名。
  const isEnrolledAlready = (course: Course) => {
    const courseNo = (course.scheduledOffering?.courseNo || '').trim().toUpperCase();
    if (courseNo) return enrolledCourseNos.has(courseNo);
    return enrolledNames.has(course.name.trim());
  };
  const localCourses = data.selectionPlan?.courses ?? [];
  const rejected = localCourses.filter(isPending);
  const pendingCourses = rejected.filter((course) => !isEnrolledAlready(course));
  const duplicatePendingCourses = rejected.filter(isEnrolledAlready);
  // 規劃中的課跟已選上同課碼的（例如把自己已選的課又規劃一次）不畫，否則會被畫成跟自己衝堂
  const plannedCourses = options.includePlanned
    ? localCourses.filter((course) => isPlanned(course) && !isEnrolledAlready(course))
    : [];

  const blocks = buildBlocks(
    [
      ...courses.map((course) => ({ course, pending: false, planned: false })),
      ...pendingCourses.map((course) => ({ course, pending: true, planned: false })),
      ...plannedCourses.map((course) => ({ course, pending: false, planned: true })),
    ],
    data,
  );

  const usedDays = new Set(blocks.map((block) => block.day));
  const days = DAY_COLUMNS.filter((day) => ['M', 'T', 'W', 'R', 'F'].includes(day.code) || usedDays.has(day.code));

  const sum = (list: Course[]) => list.reduce((total, course) => total + (Number(course.credits) || 0), 0);
  return {
    semester,
    courses,
    blocks,
    days,
    credits: sum(courses),
    pendingCredits: sum(pendingCourses),
    pendingCourses,
    plannedCourses,
    plannedCredits: sum(plannedCourses),
    duplicatePendingCourses,
  };
}

interface BlockEntry {
  course: Course;
  pending: boolean;
  planned: boolean;
}

function buildBlocks(entries: BlockEntry[], data: AppData): SemesterBlock[] {
  const blocks: SemesterBlock[] = [];
  entries.forEach(({ course, pending, planned }) => {
    const byDay = new Map<string, string[]>();
    courseSlots(course).forEach((slot) => {
      const match = slot.match(/^([A-Z])(\d{1,2}|[A-D])$/);
      if (!match || !classPeriod(match[2])) return;
      const [, day, period] = match;
      byDay.set(day, [...(byDay.get(day) ?? []), period]);
    });
    byDay.forEach((periods, day) => {
      mergeAdjacentPeriods(periods).forEach((run, index) => {
        blocks.push({
          key: `${course.id}-${day}-${index}`,
          course,
          category: semesterCategory(course, data),
          day,
          periods: run.periods,
          startMin: run.startMin,
          endMin: run.endMin,
          pending,
          planned,
          lane: 0,
          laneCount: 1,
          clash: false,
        });
      });
    });
  });
  layoutLanes(blocks);
  return blocks;
}

/**
 * 任意一組課畫成一週課表（多學期規劃的未來學期用）：沒有「本學期」、沒有待加簽，
 * 全部當規劃中（虛線）畫，重疊照樣分道並標衝堂。
 */
export function buildViewFromCourses(courses: Course[], data: AppData): SemesterView {
  const blocks = buildBlocks(courses.map((course) => ({ course, pending: false, planned: true })), data);
  const usedDays = new Set(blocks.map((block) => block.day));
  const days = DAY_COLUMNS.filter((day) => ['M', 'T', 'W', 'R', 'F'].includes(day.code) || usedDays.has(day.code));
  const credits = courses.reduce((total, course) => total + (Number(course.credits) || 0), 0);
  return {
    semester: undefined,
    courses: [],
    blocks,
    days,
    credits: 0,
    pendingCredits: 0,
    pendingCourses: [],
    plannedCourses: courses,
    plannedCredits: credits,
    duplicatePendingCourses: [],
  };
}

/**
 * 同一天時間重疊的方塊分道並排（左右對切），並標出「待加簽／規劃中疊到別的課」。
 * 已選上的課彼此不會重疊（學校不讓選），真的重疊也只分道不標衝堂。
 */
function layoutLanes(blocks: SemesterBlock[]): void {
  const byDay = new Map<string, SemesterBlock[]>();
  blocks.forEach((block) => byDay.set(block.day, [...(byDay.get(block.day) ?? []), block]));
  byDay.forEach((dayBlocks) => {
    const sorted = [...dayBlocks].sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);
    // 連續重疊的一群共用同一個 laneCount，才會對齊切
    let cluster: SemesterBlock[] = [];
    let clusterEnd = -1;
    const flush = () => {
      const laneEnds: number[] = [];
      cluster.forEach((block) => {
        let lane = laneEnds.findIndex((end) => end <= block.startMin);
        if (lane < 0) {
          lane = laneEnds.length;
          laneEnds.push(block.endMin);
        } else {
          laneEnds[lane] = block.endMin;
        }
        block.lane = lane;
      });
      cluster.forEach((block) => {
        block.laneCount = laneEnds.length;
        block.clash = (block.pending || block.planned)
          && cluster.some((other) => other !== block && other.startMin < block.endMin && other.endMin > block.startMin);
      });
      cluster = [];
      clusterEnd = -1;
    };
    sorted.forEach((block) => {
      if (cluster.length > 0 && block.startMin >= clusterEnd) flush();
      cluster.push(block);
      clusterEnd = Math.max(clusterEnd, block.endMin);
    });
    if (cluster.length > 0) flush();
  });
}

/** 時間軸範圍：夜間沒課就不畫 A–D。 */
export function semesterTimeline(blocks: SemesterBlock[]) {
  const used = blocks.flatMap((block) => block.periods);
  return visiblePeriodRange(used);
}

export interface ScheduleInsight {
  title: string;
  detail: string;
  note: string;
}

/**
 * 從課表本身算出「等高列看不出來」的事：最大空檔、最滿的一天、每天都空的節次。
 * 這些是按真實分鐘畫才有意義的資訊，所以直接算，不寫死。
 */
export function scheduleInsights(view: SemesterView): ScheduleInsight[] {
  const insights: ScheduleInsight[] = [];
  const dayLabel = (code: string) => `星期${view.days.find((day) => day.code === code)?.label ?? code}`;

  let widest: { day: string; from: number; to: number } | null = null;
  view.days.forEach((day) => {
    const runs = view.blocks
      .filter((block) => block.day === day.code)
      .sort((a, b) => a.startMin - b.startMin);
    for (let index = 1; index < runs.length; index += 1) {
      const gap = runs[index].startMin - runs[index - 1].endMin;
      if (gap >= 60 && (!widest || gap > widest.to - widest.from)) {
        widest = { day: day.code, from: runs[index - 1].endMin, to: runs[index].startMin };
      }
    }
  });
  if (widest) {
    const { day, from, to } = widest as { day: string; from: number; to: number };
    const minutes = to - from;
    const clock = (value: number) => `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
    insights.push({
      title: `${dayLabel(day)}空 ${Math.floor(minutes / 60)} 小時 ${minutes % 60} 分`,
      detail: `${clock(from)} 下課 → ${clock(to)} 上課`,
      note: '這學期最長的一段空檔。',
    });
  }

  const busiest = view.days
    .map((day) => ({
      code: day.code,
      periods: new Set(view.blocks.filter((block) => block.day === day.code).flatMap((block) => block.periods)),
    }))
    .sort((a, b) => b.periods.size - a.periods.size)[0];
  if (busiest && busiest.periods.size >= 5) {
    const spans = view.blocks.filter((block) => block.day === busiest.code);
    const first = Math.min(...spans.map((block) => block.startMin));
    const last = Math.max(...spans.map((block) => block.endMin));
    const clock = (value: number) => `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
    insights.push({
      title: `${dayLabel(busiest.code)}從 ${clock(first)} 連到 ${clock(last)}`,
      detail: `${busiest.periods.size} 節課`,
      note: '這學期最滿的一天。',
    });
  }

  const { periods } = semesterTimeline(view.blocks);
  const alwaysFree = periods.filter((period) =>
    view.days.every((day) => !view.blocks.some((block) => block.day === day.code && block.periods.includes(period.id))),
  );
  if (alwaysFree.length > 0 && alwaysFree.length <= 4) {
    insights.push({
      title: `每天第 ${alwaysFree.map((period) => period.id).join('、')} 節都空著`,
      detail: alwaysFree.map((period) => `${period.startLabel}–${period.endLabel}`).join('、'),
      note: '五天都沒排課的節次。',
    });
  }
  return insights;
}
