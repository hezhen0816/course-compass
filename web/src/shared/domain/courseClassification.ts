import type { AppData } from '../types';
import { parseCourseDepartment } from './courseDepartments';

/**
 * 用課碼的系所代碼比對使用者設定的本系／雙主修／輔系，決定這門課算哪一類。
 *
 * 課程資料本身的 `category`／`program` 對校務同步進來的課常常是空的或籠統的
 * （例如雙主修的課只標「必修」），所以選課工作台一直是照課碼判斷。本學期課表
 * 也要用同一套，否則同一門課在兩頁會顯示成不同類別。
 */
export type CourseTone = 'required' | 'elective' | 'general' | 'pe' | 'doubleMajor' | 'minor' | 'virtual' | 'group' | 'conflict' | 'other';

export type CourseClassification = {
  label: string;
  tone: CourseTone;
};

const GENERAL_COURSE_DEPARTMENT_CODES = new Set(['GE', 'TC', 'SA']);

export function classifyCourseByCode(
  courseNo: string,
  requireOption: string | undefined,
  data: AppData,
  fallbackTone: CourseTone = 'other',
): CourseClassification {
  const departmentCode = parseCourseDepartment(courseNo)?.code;
  const programDepartments = data.settings?.programDepartments;
  const normalizedRequireOption = (requireOption || '').trim().toUpperCase();
  if (departmentCode && departmentCode === programDepartments?.doubleMajorDepartmentCode) {
    return { label: '雙主修', tone: 'doubleMajor' };
  }
  if (departmentCode && departmentCode === programDepartments?.minorDepartmentCode) {
    return { label: '輔系', tone: 'minor' };
  }
  if (departmentCode && departmentCode === programDepartments?.homeDepartmentCode) {
    if (normalizedRequireOption === 'R' || normalizedRequireOption.includes('必')) {
      return { label: '本系必修', tone: 'required' };
    }
    if (normalizedRequireOption === 'E' || normalizedRequireOption.includes('選')) {
      return { label: '本系選修', tone: 'elective' };
    }
    return { label: '本系', tone: fallbackTone };
  }
  if (departmentCode && GENERAL_COURSE_DEPARTMENT_CODES.has(departmentCode)) {
    return { label: '通識', tone: 'general' };
  }
  if (departmentCode === 'PE') {
    return { label: '體育', tone: 'pe' };
  }

  if (normalizedRequireOption === 'R' || normalizedRequireOption.includes('必')) {
    return { label: '必修', tone: 'required' };
  }
  if (normalizedRequireOption === 'E' || normalizedRequireOption.includes('選')) {
    return { label: '選修', tone: 'elective' };
  }
  return { label: '未分類', tone: fallbackTone };
}
