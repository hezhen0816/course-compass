import { OFFICIAL_SCHEDULE_PERIOD_TIMES, PERIODS } from './planner';

/**
 * 節次的真實起訖分鐘。
 *
 * 台科大的節次不是等長排開的：節 2→3（10:00–10:20）與節 7→8（15:10–15:30）
 * 是 20 分鐘，其他日間空檔 10 分鐘，夜間 A–D 之間只有 5 分鐘。課表如果用等高列
 * 畫，這些差異全部被抹平，「兩堂課到底連不連得上」就看不出來。
 *
 * 時間字串沿用 `OFFICIAL_SCHEDULE_PERIOD_TIMES`，避免同一份時刻表維護兩處。
 */
export interface ClassPeriod {
  id: string;
  /** 距離 00:00 的分鐘數 */
  startMin: number;
  endMin: number;
  startLabel: string;
  endLabel: string;
}

function toMinutes(text: string): number {
  const [hour, minute] = text.trim().split(':').map(Number);
  return hour * 60 + minute;
}

function pad(minutes: number): string {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export const CLASS_PERIODS: ClassPeriod[] = PERIODS.map((id) => {
  const [start, end] = (OFFICIAL_SCHEDULE_PERIOD_TIMES[id] || '').split('～');
  const startMin = toMinutes(start);
  const endMin = toMinutes(end);
  return { id, startMin, endMin, startLabel: pad(startMin), endLabel: pad(endMin) };
});

const PERIOD_BY_ID = new Map(CLASS_PERIODS.map((period) => [period.id, period]));

export function classPeriod(id: string): ClassPeriod | undefined {
  return PERIOD_BY_ID.get(id.toUpperCase());
}

/** 節次在時間軸上的位置；找不到該節次時回 undefined。 */
export function periodOffsets(id: string, originMin: number): { top: number; height: number } | undefined {
  const period = classPeriod(id);
  if (!period) return undefined;
  return { top: period.startMin - originMin, height: period.endMin - period.startMin };
}

/**
 * 把同一天的節次併成連續區塊：`['6','7','8']` → 一塊 13:20–16:20。
 * 中間隔開的節次會分成不同塊（例如 `['2','6']`）。
 */
export function mergeAdjacentPeriods(ids: string[]): { periods: string[]; startMin: number; endMin: number }[] {
  const ordered = ids
    .map((id) => classPeriod(id))
    .filter((period): period is ClassPeriod => Boolean(period))
    .sort((a, b) => a.startMin - b.startMin);

  const blocks: { periods: string[]; startMin: number; endMin: number }[] = [];
  ordered.forEach((period) => {
    const last = blocks[blocks.length - 1];
    const index = CLASS_PERIODS.findIndex((item) => item.id === period.id);
    const previousId = index > 0 ? CLASS_PERIODS[index - 1].id : '';
    if (last && previousId && last.periods[last.periods.length - 1] === previousId) {
      last.periods.push(period.id);
      last.endMin = period.endMin;
      return;
    }
    blocks.push({ periods: [period.id], startMin: period.startMin, endMin: period.endMin });
  });
  return blocks;
}

/** 只在使用者真的有課的範圍內畫時間軸，夜間沒課就不要留四節空白。 */
export function visiblePeriodRange(usedPeriodIDs: string[]): { periods: ClassPeriod[]; originMin: number; totalMin: number } {
  const used = new Set(usedPeriodIDs.map((id) => id.toUpperCase()));
  const daytime = CLASS_PERIODS.filter((period) => /^([1-9]|10)$/.test(period.id));
  const extra = CLASS_PERIODS.filter((period) => !/^([1-9]|10)$/.test(period.id) && used.has(period.id));
  const lastExtraIndex = extra.length
    ? Math.max(...extra.map((period) => CLASS_PERIODS.findIndex((item) => item.id === period.id)))
    : -1;
  const periods = lastExtraIndex >= 0 ? CLASS_PERIODS.slice(0, lastExtraIndex + 1) : daytime;
  const originMin = periods[0].startMin;
  return { periods, originMin, totalMin: periods[periods.length - 1].endMin - originMin };
}
