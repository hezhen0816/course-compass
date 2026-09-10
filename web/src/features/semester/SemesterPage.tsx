import { useMemo, useState } from 'react';
import type { AppData } from '../../shared/types';
import { currentEnrollmentPhase, formatPhaseRange, nextEnrollmentPhase } from '../../shared/domain/enrollmentCalendar';
import { displaySlots, guessCurrentSemester, parseNodeSlots } from '../../shared/domain/planner';
import { CATEGORY_LABELS, buildSemesterView, scheduleInsights, type SemesterBlock } from './semesterModel';
import { WeekGrid } from './WeekGrid';

interface SemesterPageProps {
  data: AppData;
  onGoToCourseSearch: () => void;
  onGoToPlanning: () => void;
}

export function SemesterPage({ data, onGoToCourseSearch, onGoToPlanning }: SemesterPageProps) {
  const now = useMemo(() => new Date(), []);
  const view = useMemo(() => buildSemesterView(data, now), [data, now]);
  const insights = useMemo(() => scheduleInsights(view), [view]);
  const [selected, setSelected] = useState<SemesterBlock | null>(null);

  const term = guessCurrentSemester(now);
  const phase = currentEnrollmentPhase(term, now);
  const upcoming = nextEnrollmentPhase(term, now);

  if (view.courses.length === 0 && view.pendingCourses.length === 0) {
    return (
      <div className="space-y-5">
        <PhaseRail term={term} phase={phase} upcoming={upcoming} now={now} />
        <section className="rounded-lg border border-rule bg-sheet p-10 text-center">
          <b className="block text-[15px] font-medium text-ink">還沒有這學期的課表</b>
          <p className="mx-auto mt-2 max-w-sm text-[13px] leading-relaxed text-ink-2">
            用校務帳號同步一次，這裡就會出現本學期的課，以及每天實際的上課時間分布。
          </p>
          <button
            type="button"
            onClick={onGoToPlanning}
            className="mt-4 rounded-sm bg-ink px-5 py-2 text-sm font-medium text-sheet"
          >
            到選課工作台同步
          </button>
        </section>
      </div>
    );
  }

  const nowBlock = view.blocks.find((block) => {
    const todayCode = ['U', 'M', 'T', 'W', 'R', 'F', 'S'][now.getDay()];
    const minutes = now.getHours() * 60 + now.getMinutes();
    return block.day === todayCode && minutes >= block.startMin && minutes < block.endMin && !block.pending;
  });

  return (
    <div className="space-y-5">
      <PhaseRail term={term} phase={phase} upcoming={upcoming} now={now} />

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
        <WeekGrid view={view} now={now} onSelectCourse={setSelected} />

        <aside className="flex flex-col gap-4">
          <section>
            <h2 className="mb-2 font-mono text-xs tracking-[.14em] text-ink-3">現在</h2>
            <div className="rounded-lg border border-rule border-l-[3px] border-l-mark bg-sheet p-4">
              <p className="font-mono text-xs text-ink-3">{formatNow(now)}</p>
              {nowBlock ? (
                <>
                  <b className="mt-1 block text-[19px] font-bold">{nowBlock.course.name}</b>
                  <span className="font-mono text-xs text-ink-2">
                    {nowBlock.course.scheduledOffering?.classroom || '教室未公告'}・到 {clock(nowBlock.endMin)}
                  </span>
                </>
              ) : (
                <b className="mt-1 block text-[19px] font-bold text-ink-2">現在沒有課</b>
              )}
              <NextClass view={view} now={now} />
            </div>
          </section>

          {(view.pendingCourses.length > 0 || view.duplicatePendingCourses.length > 0) && (
            <section>
              <h2 className="mb-2 font-mono text-xs tracking-[.14em] text-ink-3">還沒定的事</h2>
              <ul className="flex flex-col gap-px">
                {view.duplicatePendingCourses.map((course) => (
                  <li key={course.id} className="rounded-lg border border-rule bg-sheet px-3.5 py-2.5">
                    <b className="block text-sm font-medium">{course.name}</b>
                    <span className="font-mono text-[11px] tracking-wide text-ink-2">待加簽清單裡重複了</span>
                    <em className="mt-1 block text-xs not-italic text-ink-3">
                      這門已經在選課清單上，待加簽那筆可以到選課工作台移除。
                    </em>
                  </li>
                ))}
                {view.pendingCourses.map((course) => (
                  <li key={course.id} className="rounded-lg border border-rule bg-sheet px-3.5 py-2.5">
                    <b className="block text-sm font-medium">{course.name}</b>
                    <span className="font-mono text-[11px] tracking-wide text-mark">待加簽・官方還沒放行</span>
                    <em className="mt-1 block text-xs not-italic text-ink-3">
                      {[
                        course.scheduledOffering?.teacher,
                        displaySlots(parseNodeSlots(course.scheduledOffering?.node || '')),
                        course.scheduledOffering?.classroom,
                      ]
                        .filter(Boolean)
                        .join('・')}
                    </em>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {insights.length > 0 && (
            <section>
              <h2 className="mb-2 font-mono text-xs tracking-[.14em] text-ink-3">課表看出來的</h2>
              <ul className="flex flex-col gap-px">
                {insights.map((insight) => (
                  <li key={insight.title} className="rounded-lg border border-rule bg-sheet px-3.5 py-2.5">
                    <b className="block text-sm font-medium">{insight.title}</b>
                    <span className="font-mono text-[11px] tracking-wide text-ink-2">{insight.detail}</span>
                    <em className="mt-1 block text-xs not-italic text-ink-3">{insight.note}</em>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section>
            <h2 className="mb-2 font-mono text-xs tracking-[.14em] text-ink-3">這學期的量</h2>
            <div className="rounded-lg border border-rule bg-sheet px-4 py-3.5">
              <div className="flex items-baseline gap-1.5 font-mono">
                <strong className="text-[29px] font-semibold tabular-nums">{view.credits}</strong>
                <span className="text-xs text-ink-2">學分・{view.courses.length} 門</span>
              </div>
              {view.pendingCredits > 0 && (
                <p className="mt-2 font-mono text-[11px] tracking-wide text-ink-3">
                  待加簽 {view.pendingCourses.length} 門 {view.pendingCredits} 學分若通過 → {view.credits + view.pendingCredits} 學分
                </p>
              )}
              <button
                type="button"
                onClick={onGoToCourseSearch}
                className="mt-3 w-full rounded-sm border border-rule bg-sheet px-3 py-2 text-[13px] text-ink-2 hover:bg-paper"
              >
                到課程查詢找課
              </button>
            </div>
          </section>
        </aside>
      </div>

      {selected && <CourseSheet block={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function clock(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

function formatNow(now: Date): string {
  const day = ['日', '一', '二', '三', '四', '五', '六'][now.getDay()];
  return `星期${day} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

function NextClass({ view, now }: { view: ReturnType<typeof buildSemesterView>; now: Date }) {
  const order = ['U', 'M', 'T', 'W', 'R', 'F', 'S'];
  const todayIndex = now.getDay();
  const minutes = now.getHours() * 60 + now.getMinutes();

  for (let offset = 0; offset < 7; offset += 1) {
    const code = order[(todayIndex + offset) % 7];
    const candidates = view.blocks
      .filter((block) => block.day === code && !block.pending && (offset > 0 || block.startMin > minutes))
      .sort((a, b) => a.startMin - b.startMin);
    if (candidates.length > 0) {
      const next = candidates[0];
      const when = offset === 0 ? '今天' : offset === 1 ? '明天' : `星期${view.days.find((day) => day.code === code)?.label ?? code}`;
      return (
        <div className="mt-3 border-t border-rule pt-2.5 text-[13px] text-ink-2">
          下一堂{'\u3000'}<b className="font-medium text-ink">{next.course.name}</b>{'\u3000'}{when} {clock(next.startMin)}
          {next.course.scheduledOffering?.classroom ? `・${next.course.scheduledOffering.classroom}` : ''}
        </div>
      );
    }
  }
  return null;
}

function PhaseRail({
  term,
  phase,
  upcoming,
  now,
}: {
  term: string;
  phase: ReturnType<typeof currentEnrollmentPhase>;
  upcoming: ReturnType<typeof nextEnrollmentPhase>;
  now: Date;
}) {
  const active = phase.kind !== 'closed';
  const target = active ? phase : upcoming;
  const progress = active
    ? Math.min(100, Math.max(0, ((now.getTime() - phase.start.getTime()) / (phase.end.getTime() - phase.start.getTime())) * 100))
    : 0;
  const daysLeft = target ? Math.max(0, Math.ceil((target.end.getTime() - now.getTime()) / 86400000)) : 0;

  return (
    <section className="grid items-center gap-2 md:grid-cols-[auto_minmax(0,1fr)_auto] md:gap-x-6">
      <div className="flex flex-wrap items-baseline gap-2">
        <b className="text-[17px] font-bold">{target ? target.label : `${term} 學期`}</b>
        {target?.note && <em className="font-mono text-xs not-italic tracking-wide text-ink-3">{active ? '進行中' : '尚未開始'}</em>}
      </div>
      {target ? (
        <div className="relative h-[26px]">
          <span className="absolute inset-x-0 top-1 h-0.5 bg-rule" />
          {active && <span className="absolute left-0 top-1 h-0.5 bg-ink-2" style={{ width: `${progress}%` }} />}
          {active && <span className="absolute top-0 h-2.5 w-0.5 bg-mark" style={{ left: `${progress}%` }} />}
          <span className="absolute left-0 top-[11px] font-mono text-[11px] text-ink-3">{formatPhaseRange(target).split('–')[0]}</span>
          <span className="absolute right-0 top-[11px] font-mono text-[11px] text-ink-3">{formatPhaseRange(target).split('–')[1]}</span>
        </div>
      ) : (
        <span />
      )}
      <div className="whitespace-nowrap font-mono text-[13px] tracking-wide text-ink-2">
        {target ? (
          <>
            {active ? '還剩 ' : '距開始 '}
            <strong className="text-[17px] font-semibold text-mark">{daysLeft}</strong> 天
          </>
        ) : (
          '非選課階段'
        )}
      </div>
    </section>
  );
}

function CourseSheet({ block, onClose }: { block: SemesterBlock; onClose: () => void }) {
  const offering = block.course.scheduledOffering;
  const rows: [string, string][] = [
    ['時間', `${displaySlots(parseNodeSlots(offering?.node || ''))}\u3000${clock(block.startMin)}–${clock(block.endMin)}`],
    ['教室', offering?.classroom || block.course.details?.location || '教室未公告'],
    ['教師', offering?.teacher || block.course.details?.professor || '教師未公告'],
    ['類別', `${CATEGORY_LABELS[block.category]}・${block.course.credits} 學分`],
    ['課碼', offering?.courseNo || '—'],
  ];
  if (offering?.contents) rows.push(['備註', offering.contents]);

  return (
    <>
      <button type="button" aria-label="關閉課程詳情" onClick={onClose} className="fixed inset-0 z-40 w-full bg-ink/35" />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={block.course.name}
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[420px] flex-col overflow-y-auto border-l border-rule bg-sheet"
      >
        <div className="flex items-start gap-3 px-5 pt-5">
          <div>
            <div className="font-mono text-[11px] tracking-wider text-ink-3">
              {CATEGORY_LABELS[block.category]}
              {block.pending ? '・待加簽' : '・修課中'}
            </div>
            <h3 className="mt-1 text-[22px] font-bold leading-snug">{block.course.name}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="關閉"
            className="ml-auto h-7 w-7 shrink-0 rounded-sm border border-rule text-[15px] leading-none text-ink-2"
          >
            ×
          </button>
        </div>
        <dl className="mt-4 grid grid-cols-[76px_minmax(0,1fr)] border-t border-rule">
          {rows.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="border-t border-rule py-2.5 pl-5 font-mono text-[11px] tracking-wide text-ink-3">{label}</dt>
              <dd className="border-t border-rule py-2.5 pr-5 text-sm">{value}</dd>
            </div>
          ))}
        </dl>
        {block.pending && (
          <p className="m-5 rounded-sm bg-mark/10 p-3 text-[13px] leading-relaxed">
            <b className="font-semibold">還不是你的</b>{'\u3000'}課表上畫成虛線是提醒你：官方選課清單還沒有這門，別當成已經選上。
          </p>
        )}
      </aside>
    </>
  );
}
