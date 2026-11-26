import type { AppData, Course, CourseSearchResult } from '../types';
import { isHistoryImportedCourse, isSameScheduledOffering, parseNodeSlots } from './planner';
import { resolveCurrentSemester } from '../../features/semester/semesterModel';

/**
 * 衝堂判斷的唯一出處。
 *
 * 之前有三套範圍：課表看所有課、側欄卡片不標、課程查詢只比對未來規劃學期，
 * 結果同一門課在三個地方說法不一樣。現在一律拿「本學期已選上的課」＋「未來規劃／待加簽」
 * 當作已佔用的時段，跟本學期頁畫在課表上的是同一批。
 */

export type ScheduleOccupantSource = 'enrolled' | 'planned';

export interface ScheduleOccupant {
  course: Course;
  source: ScheduleOccupantSource;
  /** 大寫節次代碼，例如 M3、W4、TA */
  slots: string[];
}

function courseSlots(course: Course): string[] {
  const offering = course.scheduledOffering;
  if (offering?.slots?.length) return offering.slots.map((slot) => slot.trim().toUpperCase());
  return parseNodeSlots(offering?.node || course.details?.time || '');
}

function isEnrolledThisSemester(course: Course): boolean {
  return !isHistoryImportedCourse(course) && !course.virtualSelection;
}

/** 目前佔著時段的課：本學期已選上（校務同步）＋本地未來規劃與待加簽。 */
export function scheduleOccupants(data: AppData, now: Date = new Date()): ScheduleOccupant[] {
  const enrolled = (resolveCurrentSemester(data, now)?.courses ?? [])
    .filter(isEnrolledThisSemester)
    .map((course): ScheduleOccupant => ({ course, source: 'enrolled', slots: courseSlots(course) }));
  const planned = (data.selectionPlan?.courses ?? [])
    .map((course): ScheduleOccupant => ({ course, source: 'planned', slots: courseSlots(course) }));
  return [...enrolled, ...planned].filter((occupant) => occupant.slots.length > 0);
}

/** 佔用的節次集合，給時段指紋之類的底圖用。 */
export function occupiedSlotSet(data: AppData, now: Date = new Date()): Set<string> {
  const set = new Set<string>();
  scheduleOccupants(data, now).forEach((occupant) => occupant.slots.forEach((slot) => set.add(slot)));
  return set;
}

function overlapping(slots: string[], data: AppData, exclude: (occupant: ScheduleOccupant) => boolean): Course[] {
  if (slots.length === 0) return [];
  const wanted = new Set(slots.map((slot) => slot.trim().toUpperCase()));
  const seen = new Set<string>();
  const hits: Course[] = [];
  scheduleOccupants(data).forEach((occupant) => {
    if (exclude(occupant)) return;
    if (!occupant.slots.some((slot) => wanted.has(slot))) return;
    // 同一門課同時在已選上與待加簽出現（成本會計那種）只算一次
    const key = occupant.course.scheduledOffering?.courseNo?.trim().toUpperCase() || occupant.course.id;
    if (seen.has(key)) return;
    seen.add(key);
    hits.push(occupant.course);
  });
  return hits;
}

/** 查詢結果裡的一個班別，跟目前已佔用的時段撞到哪些課。同一個班別自己不算。 */
export function findOfferingConflicts(offering: CourseSearchResult, data: AppData): Course[] {
  return overlapping(
    parseNodeSlots(offering.node),
    data,
    (occupant) => isSameScheduledOffering(occupant.course, offering),
  );
}

/** 一門已在清單裡的課（通常是待加簽）撞到哪些其他課。自己與同課碼的另一筆不算。 */
export function findCourseConflicts(course: Course, data: AppData): Course[] {
  const courseNo = course.scheduledOffering?.courseNo?.trim().toUpperCase() || '';
  return overlapping(
    courseSlots(course),
    data,
    (occupant) => occupant.course.id === course.id
      || (Boolean(courseNo) && occupant.course.scheduledOffering?.courseNo?.trim().toUpperCase() === courseNo),
  );
}

/** 這個班別是不是本學期已經選上的課（校務同步進來的那份）。已選上就不該再規劃或送選課。 */
export function isEnrolledOffering(offering: CourseSearchResult, data: AppData, now: Date = new Date()): boolean {
  return scheduleOccupants(data, now).some((occupant) => (
    occupant.source === 'enrolled' && isSameScheduledOffering(occupant.course, offering)
  ));
}
