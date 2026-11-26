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
  /** 現在時間；落在時間軸範圍內才畫「現在」線 */
  now: Date;
  onSelectCourse?: (block: SemesterBlock) => void;
  /** 給待加簽／規劃中的方塊一個「×」；已選上的課本地刪不掉，不會有 */
  onRemoveCourse?: (block: SemesterBlock) => void;
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

export function WeekGrid({ view, now, onSelectCourse, onRemoveCourse }: WeekGridProps) {
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
    <section className="overflow-hidden rounded-2xl bg-sheet shadow-card">
      {narrow && (
        <div className="flex gap-1 p-2.5 pb-0">
          {view.days.map((day) => (
            <button
              key={day.code}
              type="button"
              aria-pressed={day.code === pickedDay}
              onClick={() => setPickedDay(day.code)}
              className={`flex-1 rounded-sm border py-2 text-center font-mono text-sm ${
                day.code === pickedDay ? 'border-accent bg-accent text-sheet' : 'border-rule text-ink-2'
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
              day.code === todayCode ? 'bg-accent-soft font-bold text-accent' : 'text-ink-2'
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
                  onRemove={onRemoveCourse}
                />
              ))}
          </div>
        ))}

        {nowVisible && (
          <div
            className="pointer-events-none absolute right-0 z-10 border-t-[1.5px] border-accent"
            style={{ left: narrow ? 46 : 56, top: (nowMin - originMin) * PX_PER_MINUTE }}
          >
            <span className="absolute -translate-x-[calc(100%+5px)] -translate-y-1/2 rounded-sm bg-accent px-1.5 py-px font-mono text-[11px] text-sheet">
              {`${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`}
            </span>
            <span className="absolute -left-1 -top-1 h-[7px] w-[7px] rounded-full bg-accent" />
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
        <span className="inline-flex items-center whitespace-nowrap">
          <b className="mr-1.5 inline-block h-[7px] w-[7px] rounded-sm bg-mark" />
          衝堂
        </span>
        <i className="h-px flex-1 bg-rule" />
        <span className="whitespace-nowrap">虛線＝待加簽或規劃中，官方還沒放行</span>
      </div>
    </section>
  );
}

function CourseBlock({
  block,
  originMin,
  live,
  onSelect,
  onRemove,
}: {
  block: SemesterBlock;
  originMin: number;
  live: boolean;
  onSelect?: (block: SemesterBlock) => void;
  onRemove?: (block: SemesterBlock) => void;
}) {
  const categoryColor = CATEGORY_COLOR[block.category];
  // 衝堂用 mark 紅蓋過類別色：這是「擋路的東西」
  const color = block.clash ? 'var(--color-mark)' : categoryColor;
  const dashed = block.pending || block.planned;
  const offering = block.course.scheduledOffering;
  const teacher = offering?.teacher || block.course.details?.professor || '';
  const room = offering?.classroom || block.course.details?.location || '';
  const height = (block.endMin - block.startMin) * PX_PER_MINUTE;
  const compact = height < 70;
  // 重疊時左右對切：每道各佔 1/laneCount，中間留 2px
  const laneWidth = `calc((100% - 6px) / ${block.laneCount})`;
  const left = `calc(3px + ${laneWidth} * ${block.lane})`;
  const width = block.laneCount > 1 ? `calc(${laneWidth} - 2px)` : 'calc(100% - 6px)';
  const chip = block.clash ? '衝堂' : block.pending ? '待加簽' : block.planned ? '規劃中' : '';

  return (
    <div
      className="absolute flex flex-col gap-0.5 overflow-hidden rounded-sm p-1.5 text-left"
      style={{
        top: (block.startMin - originMin) * PX_PER_MINUTE,
        height,
        left,
        width,
        border: dashed ? `1px dashed ${color}` : undefined,
        background: block.clash
          ? 'color-mix(in srgb, var(--color-mark) 10%, transparent)'
          : dashed
            ? `repeating-linear-gradient(135deg, color-mix(in srgb, ${color} 9%, transparent) 0 5px, transparent 5px 10px)`
            : `color-mix(in srgb, ${color} 12%, var(--color-sheet))`,
        boxShadow: live ? '0 0 0 2px var(--color-accent)' : undefined,
        zIndex: dashed ? 2 : 1,
      }}
    >
      <button
        type="button"
        onClick={() => onSelect?.(block)}
        className="absolute inset-0"
        aria-label={`${block.course.name} 詳情`}
      />
      <span className="pointer-events-none relative flex items-start gap-1">
        {chip && (
          <span
            className="rounded-sm border px-1.5 py-px text-xs font-medium leading-snug"
            style={{ borderColor: color, color }}
          >
            {chip}
          </span>
        )}
        {dashed && onRemove && (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onRemove(block);
            }}
            className="pointer-events-auto ml-auto rounded-sm px-1 font-mono text-[11px] leading-5 text-ink-3 hover:text-accent"
            title="移除這筆規劃"
            aria-label={`移除 ${block.course.name}`}
          >
            ×
          </button>
        )}
      </span>
      <b className="pointer-events-none relative text-sm font-medium leading-snug" style={{ color: block.clash ? 'var(--color-ink)' : color }}>
        {block.course.name}
      </b>
      {!compact && (
        <span className="pointer-events-none relative font-mono text-[11px] leading-snug text-ink-2">
          {[room, teacher].filter(Boolean).join('・')}
        </span>
      )}
      {compact && room && <span className="pointer-events-none relative font-mono text-[10px] text-ink-3">{room}</span>}
      {!compact && (
        <span className="pointer-events-none relative font-mono text-[10px] tracking-wide text-ink-3">
          {CATEGORY_LABELS[block.category]}・{block.course.credits} 學分
        </span>
      )}
    </div>
  );
}
