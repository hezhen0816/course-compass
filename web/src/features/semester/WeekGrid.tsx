import { useEffect, useState } from 'react';
import type { SemesterBlock, SemesterCategory, SemesterView } from './semesterModel';
import { CATEGORY_LABELS } from './semesterModel';
import { semesterTimeline } from './semesterModel';

/**
 * 一週課表，列高按真實分鐘數。
 *
 * 台科大的節次不等長：節 2→3 與節 7→8 之間是 20 分鐘，其他日間 10 分鐘，
 * 夜間 A–D 只有 5 分鐘。等高列會把這些差異抹平，於是「兩堂課連不連得上」、
 * 「哪天中間空一大塊」都看不出來。這裡照真實時間畫，休息時間也照比例留白。
 */

/** 1 分鐘對應幾 px。字級放大後單節（50 分）需要約 54px 才放得下課名＋教室。 */
const PX_PER_MINUTE = 1.08;

const CATEGORY_COLOR: Record<SemesterCategory, string> = {
  major: 'var(--color-cat-major)',
  double: 'var(--color-cat-double)',
  minor: 'var(--color-cat-minor)',
  gened: 'var(--color-cat-gened)',
  pe: 'var(--color-cat-pe)',
  elective: 'var(--color-cat-elective)',
};

interface WeekGridProps {
  view: SemesterView;
  /** 現在時間；落在時間軸範圍內才畫朱批線 */
  now: Date;
  onSelectCourse?: (block: SemesterBlock) => void;
}

/** 手機一次只放得下一天：五欄擠在 390px 會讓課名剩兩個字。 */
function useNarrowScreen(): boolean {
  const [narrow, setNarrow] = useState(() => window.matchMedia('(max-width: 767px)').matches);
  useEffect(() => {
    const query = window.matchMedia('(max-width: 767px)');
    const onChange = (event: MediaQueryListEvent) => setNarrow(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return narrow;
}

export function WeekGrid({ view, now, onSelectCourse }: WeekGridProps) {
  const { periods, originMin, totalMin } = semesterTimeline(view.blocks);
  const height = totalMin * PX_PER_MINUTE;
  const todayCode = ['U', 'M', 'T', 'W', 'R', 'F', 'S'][now.getDay()];
  const narrow = useNarrowScreen();
  const fallbackDay = view.days[0]?.code ?? 'M';
  const [pickedDay, setPickedDay] = useState(view.days.some((day) => day.code === todayCode) ? todayCode : fallbackDay);
  const visibleDays = narrow ? view.days.filter((day) => day.code === pickedDay) : view.days;
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const nowVisible = nowMin >= originMin && nowMin <= originMin + totalMin && visibleDays.some((day) => day.code === todayCode);

  // 節次與休息時間交錯的底紋，讓 20 分鐘的休息看起來就是比 10 分鐘的寬
  const bands: string[] = [];
  let cursor = 0;
  periods.forEach((period) => {
    const start = period.startMin - originMin;
    if (start > cursor) bands.push(`var(--color-band) ${(cursor / totalMin) * 100}% ${(start / totalMin) * 100}%`);
    bands.push(`var(--color-sheet) ${(start / totalMin) * 100}% ${((period.endMin - originMin) / totalMin) * 100}%`);
    cursor = period.endMin - originMin;
  });
  const bandStyle = `linear-gradient(to bottom, ${bands.join(', ')})`;

  const columns = `${narrow ? 46 : 56}px repeat(${visibleDays.length}, minmax(0, 1fr))`;

  return (
    <section className="overflow-hidden rounded-lg border border-rule bg-sheet">
      {narrow && (
        <div className="flex gap-1 p-2.5 pb-0">
          {view.days.map((day) => (
            <button
              key={day.code}
              type="button"
              aria-pressed={day.code === pickedDay}
              onClick={() => setPickedDay(day.code)}
              className={`flex-1 rounded-sm border py-2 text-center font-mono text-sm ${
                day.code === pickedDay ? 'border-ink bg-ink text-sheet' : 'border-rule text-ink-2'
              }`}
            >
              {day.label}
            </button>
          ))}
        </div>
      )}
      <div className={`grid border-b border-rule ${narrow ? 'hidden' : ''}`} style={{ gridTemplateColumns: columns }}>
        <span />
        {view.days.map((day) => (
          <span
            key={day.code}
            className={`border-l border-rule py-2.5 text-center text-sm ${
              day.code === todayCode ? 'bg-mark-soft font-bold text-ink' : 'text-ink-2'
            }`}
          >
            {day.label}
          </span>
        ))}
      </div>

      <div className="relative grid" style={{ gridTemplateColumns: columns, height }}>
        <div className="relative border-r border-rule">
          {periods.map((period) => (
            <div
              key={period.id}
              className="absolute inset-x-0 flex flex-col items-center justify-center gap-px"
              style={{
                top: (period.startMin - originMin) * PX_PER_MINUTE,
                height: (period.endMin - period.startMin) * PX_PER_MINUTE,
              }}
            >
              <b className="font-mono text-[17px] font-medium leading-none text-ink-2">{period.id}</b>
              <span className="font-mono text-[10px] text-ink-3">{period.startLabel}</span>
            </div>
          ))}
        </div>

        {visibleDays.map((day) => (
          <div key={day.code} className="relative border-l border-rule" style={{ background: bandStyle }}>
            {view.blocks
              .filter((block) => block.day === day.code)
              .map((block) => (
                <CourseBlock
                  key={block.key}
                  block={block}
                  originMin={originMin}
                  live={day.code === todayCode && nowMin >= block.startMin && nowMin < block.endMin}
                  onSelect={onSelectCourse}
                />
              ))}
          </div>
        ))}

        {nowVisible && (
          <div
            className="pointer-events-none absolute right-0 z-10 border-t-[1.5px] border-mark"
            style={{ left: narrow ? 46 : 56, top: (nowMin - originMin) * PX_PER_MINUTE }}
          >
            <span className="absolute -translate-x-[calc(100%+5px)] -translate-y-1/2 rounded-sm bg-mark px-1.5 py-px font-mono text-[11px] text-sheet">
              {`${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`}
            </span>
            <span className="absolute -left-1 -top-1 h-[7px] w-[7px] rounded-full bg-mark" />
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-rule px-3 py-2.5 font-mono text-[11px] text-ink-3">
        {(Object.keys(CATEGORY_LABELS) as SemesterCategory[]).map((category) => (
          <span key={category} className="inline-flex items-center whitespace-nowrap">
            <b className="mr-1.5 inline-block h-[7px] w-[7px] rounded-sm" style={{ background: CATEGORY_COLOR[category] }} />
            {CATEGORY_LABELS[category]}
          </span>
        ))}
        <i className="h-px flex-1 bg-rule" />
        <span className="whitespace-nowrap">虛線＝待加簽，官方還沒放行</span>
      </div>
    </section>
  );
}

function CourseBlock({
  block,
  originMin,
  live,
  onSelect,
}: {
  block: SemesterBlock;
  originMin: number;
  live: boolean;
  onSelect?: (block: SemesterBlock) => void;
}) {
  const color = CATEGORY_COLOR[block.category];
  const offering = block.course.scheduledOffering;
  const teacher = offering?.teacher || block.course.details?.professor || '';
  const room = offering?.classroom || block.course.details?.location || '';
  const height = (block.endMin - block.startMin) * PX_PER_MINUTE;
  const compact = height < 70;

  return (
    <button
      type="button"
      onClick={() => onSelect?.(block)}
      className="absolute inset-x-[3px] flex flex-col gap-0.5 overflow-hidden rounded-sm p-1.5 text-left"
      style={{
        top: (block.startMin - originMin) * PX_PER_MINUTE,
        height,
        borderLeft: `3px ${block.pending ? 'dashed' : 'solid'} ${color}`,
        border: block.pending ? `1px dashed ${color}` : undefined,
        borderLeftWidth: 3,
        background: block.pending
          ? `repeating-linear-gradient(135deg, color-mix(in srgb, ${color} 9%, transparent) 0 5px, transparent 5px 10px)`
          : `color-mix(in srgb, ${color} ${live ? 24 : 13}%, transparent)`,
        boxShadow: live ? `inset 0 0 0 1px color-mix(in srgb, ${color} 45%, transparent)` : undefined,
      }}
    >
      {block.pending && (
        <span
          className="self-start rounded-sm border px-1.5 py-px text-xs font-medium leading-snug"
          style={{ borderColor: color, color }}
        >
          待加簽
        </span>
      )}
      <b className="text-sm font-medium leading-snug" style={{ color }}>
        {block.course.name}
      </b>
      {!compact && (
        <span className="font-mono text-[11px] leading-snug text-ink-2">
          {[room, teacher].filter(Boolean).join('・')}
        </span>
      )}
      {compact && room && <span className="font-mono text-[10px] text-ink-3">{room}</span>}
      {!compact && (
        <span className="font-mono text-[10px] tracking-wide text-ink-3">
          {CATEGORY_LABELS[block.category]}・{block.course.credits} 學分
        </span>
      )}
    </button>
  );
}
