import type { PendingRequirement } from '../types';

export function nextTerms(startTerm: string, count: number): string[] {
  const match = startTerm.trim().match(/^(\d{3})([12])$/);
  if (!match) return [];
  let year = Number(match[1]);
  let half = Number(match[2]);
  const terms: string[] = [];
  for (let i = 0; i < count; i += 1) {
    if (half === 1) half = 2;
    else {
      half = 1;
      year += 1;
    }
    terms.push(`${year}${half}`);
  }
  return terms;
}

/** 「統計學(上)」→「統計學(下)」這種上下學期配對，自動當先修。 */
export function inferPrerequisites(requirements: PendingRequirement[]): string[][] {
  const byTitle = new Map(requirements.map((r) => [r.title.replace(/\s+/g, ''), r.id]));
  const pairs: string[][] = [];
  for (const [title, id] of byTitle) {
    const upper = title.match(/^(.*)[(（]上[)）]$/);
    if (!upper) continue;
    const lowerId = byTitle.get(`${upper[1]}(下)`) ?? byTitle.get(`${upper[1]}（下）`);
    if (lowerId) pairs.push([id, lowerId]);
  }
  return pairs;
}

/**
 * 不同科目表會列同一門課（財金輔系的經濟學擇一 vs 企管雙主修的經濟學(上)；兩邊都有財務管理）。
 * 排課時一門課只修一次，所以把課名有交集的需求合併成一列；標題保留較短的那個，
 * 可用課名取交集（都能滿足兩邊），系所限定取聯集。
 */
export function mergeOverlappingRequirements(requirements: PendingRequirement[]): Array<{
  requirement: PendingRequirement;
  memberIds: string[];
}> {
  const norm = (name: string) => name.replace(/\s+/g, '').replace(/（/g, '(').replace(/）/g, ')');
  const groups: Array<{ requirement: PendingRequirement; memberIds: string[]; names: Set<string> }> = [];
  for (const requirement of requirements) {
    const names = new Set(requirement.courseNames.map(norm));
    if (requirement.kind === 'credit_pool' || names.size === 0) {
      groups.push({ requirement, memberIds: [requirement.id], names });
      continue;
    }
    const hit = groups.find((group) => group.requirement.kind !== 'credit_pool' && [...group.names].some((name) => names.has(name)));
    if (!hit) {
      groups.push({ requirement, memberIds: [requirement.id], names });
      continue;
    }
    const shared = [...hit.names].filter((name) => names.has(name));
    const mergedNames = shared.length > 0 ? shared : [...new Set([...hit.names, ...names])];
    const prefixes = [...new Set([...(hit.requirement.departmentPrefixes ?? []), ...(requirement.departmentPrefixes ?? [])])];
    hit.requirement = {
      ...hit.requirement,
      title: hit.requirement.title.length <= requirement.title.length ? hit.requirement.title : requirement.title,
      courseNames: mergedNames,
      credits: Math.max(hit.requirement.credits ?? 0, requirement.credits ?? 0) || hit.requirement.credits,
      departmentPrefixes: prefixes,
    };
    hit.names = new Set(mergedNames);
    hit.memberIds.push(requirement.id);
  }
  return groups.map(({ requirement, memberIds }) => ({ requirement, memberIds }));
}
