import type { EnrollmentPhaseKind } from './enrollmentCalendar';

/**
 * 課程查詢的 `contents` 備註是學校用「／」串起來的自由字串。這裡把它拆成標籤，
 * 再依使用者身分（主修、雙主修、輔系、學號）判斷「可直選／需加簽／資格不符」。
 *
 * 支援的備註寫法見 docs/data-contracts/ntust-systems.md。
 * 只認得出現過的寫法；沒對上的片段原樣當「其他」標籤留著，不吞掉。
 */

export type RestrictionKind =
  | 'eligibility' // 誰能選：限系所、遴選、開放全校…
  | 'parity' // 單雙號分班
  | 'method' // 授權碼、不開放電腦選課、不開放加簽
  | 'language' // EMI
  | 'campus' // 華夏
  | 'format' // 合班、PBL、遠距、業界師資、演算課
  | 'capacity' // 限 N 人
  | 'prerequisite'
  | 'other';

export interface RestrictionTag {
  kind: RestrictionKind;
  label: string;
  /** 原始片段，hover 時看。 */
  raw: string;
}

export type EligibilityLevel = 'open' | 'signature' | 'blocked' | 'unknown';

export interface Eligibility {
  level: EligibilityLevel;
  label: string;
  reasons: string[];
}

export interface StudentIdentity {
  homeDepartmentCode?: string;
  doubleMajorDepartmentCode?: string;
  minorDepartmentCode?: string;
  /** 校務帳號（學號），例如 B00000001；用來看單雙號。 */
  studentId?: string;
}

// 備註裡的系所寫法 → 課號前兩碼。管理學院常見的都列了，其他系所碰到再補。
const DEPARTMENT_ALIASES: Array<[RegExp, string[]]> = [
  [/企管|企業管理/, ['BA']],
  [/資管|資訊管理/, ['MI']],
  [/工管|工業管理/, ['IM']],
  [/管理學士班|四管理|管理一|管理學士/, ['MB']],
  [/財金|財務金融/, ['FB']],
  [/資工|資訊工程/, ['CS']],
  [/電機/, ['EE']],
  [/電資學院|電資/, ['EE', 'CS', 'EC', 'EO', 'ET']],
  [/管理學院|管院/, ['BA', 'MI', 'IM', 'MB', 'FB', 'TM', 'MG', 'MA']],
];

const OPEN_ALL_PATTERNS = [/開放全校/, /開放外系/, /開放.*大學部學生選修/, /開放.*學院.*選修/];

function normalize(text: string): string {
  return text.replace(/\s+/g, '').replace(/[（]/g, '(').replace(/[）]/g, ')');
}

export function splitContents(contents: string): string[] {
  return normalize(contents || '')
    .split(/[／/]/)
    // 「初選限本校資管系學生選課，加退選開放外系選課」是兩條規則寫在一格，拆開各自判斷。
    .flatMap((part) => (/限.*，.*開放|開放.*，.*限/.test(part) ? part.split('，') : [part]))
    .map((part) => part.trim())
    .filter(Boolean);
}

function departmentCodesIn(text: string): string[] {
  const codes = new Set<string>();
  for (const [pattern, list] of DEPARTMENT_ALIASES) {
    if (pattern.test(text)) list.forEach((code) => codes.add(code));
  }
  return [...codes];
}

function classify(part: string): RestrictionTag {
  const raw = part;
  if (/^限\d+人$/.test(part)) return { kind: 'capacity', label: part, raw };
  if (/EMI|英語授課|全英語/.test(part)) return { kind: 'language', label: 'EMI 英語授課', raw };
  if (/華夏/.test(part)) return { kind: 'campus', label: '華夏校區', raw };
  if (/遠距/.test(part)) return { kind: 'format', label: '遠距', raw };
  if (/合班/.test(part)) return { kind: 'format', label: '合班上課', raw };
  if (/PBL/.test(part)) return { kind: 'format', label: 'PBL', raw };
  if (/業界師資|協同教學/.test(part)) return { kind: 'format', label: '業界協同', raw };
  if (/演算課/.test(part)) return { kind: 'format', label: '含演算課', raw };
  if (/授權碼/.test(part)) return { kind: 'method', label: '授權碼', raw };
  if (/不開放電腦選課|請洽開課單位/.test(part)) return { kind: 'method', label: '不開放電腦選課', raw };
  if (/不開放加簽/.test(part)) return { kind: 'method', label: '不開放加簽', raw };
  if (/遴選/.test(part)) return { kind: 'eligibility', label: '遴選不開放', raw };
  if (/(單|雙)號|(單|雙)數/.test(part)) {
    const parity = /單/.test(part) ? '單號' : '雙號';
    const cohort = part.match(/[四二]?[企資工管]{1,2}[一二三四]/)?.[0];
    return { kind: 'parity', label: cohort ? `${cohort}${parity}` : parity, raw };
  }
  if (/^限.*除\d+餘\d+/.test(part)) return { kind: 'eligibility', label: part.replace(/學號除\d+餘\d+者?(修讀|修習|選課)?$/, '').replace(/^限/, '限'), raw };
  if (/除\d+餘\d+/.test(part)) return { kind: 'parity', label: '學號分班', raw };
  if (/修過|先修/.test(part)) return { kind: 'prerequisite', label: part.replace(/^限/, ''), raw };
  if (OPEN_ALL_PATTERNS.some((pattern) => pattern.test(part))) {
    const phase = /加退選/.test(part) ? '加退選' : /初選/.test(part) ? '初選' : '';
    const scope = /全校/.test(part) ? '全校' : /外系/.test(part) ? '外系' : /學院/.test(part) ? part.match(/開放(.*?學院)/)?.[1] ?? '外系' : '外系';
    return { kind: 'eligibility', label: `${phase ? `${phase}` : ''}開放${scope}`, raw };
  }
  if (/^限|限.*(學生|生)(選課|選修|修習|修讀)/.test(part)) return { kind: 'eligibility', label: part.replace(/(學生)?(選課|選修|修習|修讀)$/, ''), raw };
  if (/上課地點|上課節次|上課時間/.test(part)) return { kind: 'other', label: part, raw };
  return { kind: 'other', label: part, raw };
}

export function parseCourseRestrictions(contents: string): RestrictionTag[] {
  const tags: RestrictionTag[] = [];
  const seen = new Set<string>();
  for (const part of splitContents(contents)) {
    const tag = classify(part);
    const key = `${tag.kind}:${tag.label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
  }
  return tags;
}

function identityCodes(identity: StudentIdentity): Set<string> {
  return new Set(
    [identity.homeDepartmentCode, identity.doubleMajorDepartmentCode, identity.minorDepartmentCode]
      .map((code) => (code || '').trim().toUpperCase())
      .filter(Boolean),
  );
}

function studentParity(studentId: string | undefined): '單號' | '雙號' | null {
  const digits = (studentId || '').replace(/\D/g, '');
  if (!digits) return null;
  return Number(digits[digits.length - 1]) % 2 === 1 ? '單號' : '雙號';
}

/**
 * 三種結果的意思：
 * - open：電腦選課選得到（含「本系／雙主修／輔系的遴選班」——實測雙主修生選得進企管本班課）。
 * - signature：要授權碼或人工加簽。
 * - blocked：備註明講限某些系所，而你三個身分都不是；或初選限本系而現在不是加退選。
 * 沒設定身分時回 unknown，只給標籤不下判斷。
 */
export function evaluateEligibility(
  courseNo: string,
  contents: string,
  identity: StudentIdentity,
  phase: EnrollmentPhaseKind,
): Eligibility {
  const tags = parseCourseRestrictions(contents);
  const myCodes = identityCodes(identity);
  const courseCode = courseNo.trim().slice(0, 2).toUpperCase();
  const reasons: string[] = [];

  if (myCodes.size === 0) {
    return { level: 'unknown', label: '身分未設定', reasons: ['到「設定」填主修／雙主修／輔系後才能判斷資格。'] };
  }

  const isMyDepartment = myCodes.has(courseCode);
  const inAddDrop = phase === 'addDrop' || phase === 'correction';

  // 1. 明講限系所：對得上任一身分就過，否則擋。「初選限本系」只在初選期算數。
  let departmentGate: 'pass' | 'fail' | null = null;
  for (const tag of tags) {
    if (!/^(初選)?限/.test(tag.raw)) continue;
    if (/^初選限/.test(tag.raw) && inAddDrop) continue;
    // 在職專班、碩博班限定：大學部三個身分都對不上，直接擋。
    if (/在職|碩專|碩士班|研究生|博士/.test(tag.raw)) {
      departmentGate = 'fail';
      reasons.push(`備註「${tag.raw}」，不是大學部能選的班。`);
      continue;
    }
    const codes = departmentCodesIn(tag.raw);
    if (/本系|本校.*系/.test(tag.raw) && codes.length === 0) codes.push(courseCode);
    if (codes.length === 0) continue; // 「限本校學生」之類，不看系所
    const pass = codes.some((code) => myCodes.has(code));
    if (pass) departmentGate = departmentGate ?? 'pass';
    else {
      departmentGate = 'fail';
      reasons.push(`備註「${tag.raw}」，你的主修／雙主修／輔系都不在內。`);
    }
  }

  // 2. 開放全校／外系：初選寫「加退選開放」的，要到加退選才算。
  let openToAll = false;
  for (const tag of tags) {
    if (tag.kind !== 'eligibility' || !OPEN_ALL_PATTERNS.some((pattern) => pattern.test(tag.raw))) continue;
    if (/加退選/.test(tag.raw) && !inAddDrop) {
      reasons.push(`「${tag.raw}」：要等加退選才開放。`);
      continue;
    }
    if (/學院/.test(tag.raw) && !/全校/.test(tag.raw)) {
      const codes = departmentCodesIn(tag.raw);
      if (codes.length > 0 && !codes.some((code) => myCodes.has(code))) {
        reasons.push(`「${tag.raw}」：你不在該學院。`);
        continue;
      }
    }
    openToAll = true;
  }

  const needsCode = tags.some((tag) => tag.kind === 'method' && /授權碼|不開放電腦選課/.test(tag.raw));
  const noSignature = tags.some((tag) => tag.label === '不開放加簽');
  const selective = tags.some((tag) => tag.label === '遴選不開放');

  if (departmentGate === 'fail' && !openToAll) {
    if (noSignature) reasons.push('且標明不開放加簽。');
    return { level: 'blocked', label: '資格不符', reasons };
  }

  if (needsCode) {
    reasons.push('要向授課老師取得授權碼。');
    return { level: 'signature', label: '需加簽', reasons };
  }

  if (selective && !isMyDepartment && !openToAll) {
    reasons.push('遴選班：不是本系／雙主修／輔系的課，電腦選不到，要人工加簽。');
    return { level: 'signature', label: '需加簽', reasons };
  }

  // 3. 單雙號：企管的分班規則對雙主修生實測不擋，只提醒。
  const parity = studentParity(identity.studentId);
  for (const tag of tags) {
    if (tag.kind !== 'parity' || !parity) continue;
    if ((/單/.test(tag.label) && parity === '雙號') || (/雙/.test(tag.label) && parity === '單號')) {
      reasons.push(`你是${parity}，這班標「${tag.label}」；企管的單雙號分班對雙主修生實測不擋，但以當期公告為準。`);
    }
  }

  if (selective && isMyDepartment) reasons.push('遴選班，但這是你的系所／雙主修／輔系，實測選得進。');
  if (openToAll && !isMyDepartment) reasons.push('外系但已開放。');
  return { level: 'open', label: '可直選', reasons };
}
