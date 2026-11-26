import type { GpaStatus } from '../types';

/** GPA plus which class it belongs to; snake_case as the backend sends it. */
export interface GpaFields {
  gpa?: number | null;
  gpa_status?: GpaStatus;
  gpa_semester?: number | null;
  gpa_students?: number | null;
  gpa_teacher?: string | null;
  gpa_course_no?: string | null;
}

export function hasGpaValue(gpa: number | null | undefined): gpa is number {
  return typeof gpa === 'number' && Number.isFinite(gpa);
}

/** 主文字：數字、或沒有數字時的原因。別的老師的成績不當數字印，那是列上最容易被誤讀的東西。 */
export function gpaValueLabel(gpa: number | null | undefined, status: GpaStatus | undefined): string {
  if (status === 'other_teacher') return '無本師資料';
  if (hasGpaValue(gpa)) return gpa.toFixed(2);
  if (status === 'no_data') return '無資料';
  if (status === 'rate_limited') return '稍後再試';
  if (status === 'error') return '錯誤';
  return '未啟用';
}

/**
 * 副文字：這個 GPA 是哪一學期、幾個人、誰教的。
 * 課號每年重用，myNTUST 回的是該課號最近一次有成績的學期；如果那學期是別的老師教的，
 * 要明講「某某授課」，不能讓人以為是這位老師的數字。
 */
export function gpaDetailParts(fields: GpaFields, courseNo?: string): string[] {
  if (!hasGpaValue(fields.gpa) || fields.gpa_status === 'other_teacher') return [];
  const parts: string[] = [];
  if (fields.gpa_semester) parts.push(String(fields.gpa_semester));
  if (fields.gpa_students) parts.push(`${fields.gpa_students} 人`);
  // 數字來自這位老師的另一個班號時標出來，不然兩列同數字像資料壞了。
  if (courseNo && fields.gpa_course_no && fields.gpa_course_no.toUpperCase() !== courseNo.trim().toUpperCase()) {
    parts.push(`他班 ${fields.gpa_course_no}`);
  }
  return parts;
}

export function gpaDetailLabel(fields: GpaFields, courseNo?: string): string {
  return gpaDetailParts(fields, courseNo).join('・');
}

/** 匯出／單行用：3.54（1142・48 人） */
export function gpaInlineLabel(fields: GpaFields, courseNo?: string): string {
  const value = gpaValueLabel(fields.gpa, fields.gpa_status);
  const detail = gpaDetailLabel(fields, courseNo);
  return detail ? `${value}（${detail}）` : value;
}
