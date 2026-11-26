import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { fetchGpaHistory } from '../../shared/api';
import { getAccessToken } from '../../shared/supabase';
import type { GpaHistoryResponse, GpaHistoryRow } from '../../shared/types';

const GRADE_ORDER = ['A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D', 'E', 'X'];

/**
 * 同名課歷年每一班的 GPA。列上只印「這位老師自己的」數字，
 * 要比老師、看某位老師以前教得如何，來這裡看。
 */
export function GpaHistoryModal({
  courseName,
  highlightCourseNo,
  highlightTeacher,
  onClose,
}: {
  courseName: string;
  highlightCourseNo: string;
  highlightTeacher: string;
  onClose: () => void;
}) {
  const [result, setResult] = useState<GpaHistoryResponse | null>(null);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await getAccessToken();
        if (!token) throw new Error('請先登入，GPA 歷史需要你自己的 myNTUST 密鑰。');
        const payload = await fetchGpaHistory(courseName, token);
        if (!cancelled) setResult(payload);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [courseName]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const rows = result?.rows ?? [];
  const graded = rows.filter((row) => typeof row.gpa === 'number');
  const teacherRows = graded.filter((row) => sameTeacher(row.teacher, highlightTeacher));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-ink/35 p-4" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-sheet shadow-card"
        role="dialog"
        aria-label={`${courseName} 歷年 GPA`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-rule px-5 py-4">
          <div className="min-w-0">
            <p className="font-mono text-[11px] tracking-[.14em] text-ink-3">歷年 GPA・myNTUST</p>
            <h2 className="mt-1 text-[20px] font-bold leading-snug">{courseName}</h2>
            <p className="mt-1 text-xs text-ink-2">
              {teacherRows.length > 0
                ? `${highlightTeacher} 有 ${teacherRows.length} 班成績紀錄。`
                : `${highlightTeacher} 這門課沒有成績紀錄；下面是其他老師的。`}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="關閉" className="shrink-0 rounded-sm border border-rule px-2 text-sm leading-6 text-ink-2 hover:border-accent hover:text-accent">×</button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {error && <p className="px-5 py-6 text-sm text-mark">{error}</p>}
          {!error && !result && (
            <p className="flex items-center gap-2 px-5 py-6 text-sm text-ink-3"><Loader2 className="h-4 w-4 animate-spin" />向 myNTUST 查歷年成績中…</p>
          )}
          {result?.status === 'not_enabled' && (
            <p className="px-5 py-6 text-sm text-ink-2">尚未啟用 myNTUST GPA 密鑰，到「設定」貼上密鑰後再開。</p>
          )}
          {result && result.status !== 'not_enabled' && rows.length === 0 && (
            <p className="px-5 py-6 text-sm text-ink-2">myNTUST 沒有這個課名的紀錄。</p>
          )}
          {rows.length > 0 && (
            <table className="w-full border-collapse font-mono text-[12px]">
              <thead>
                <tr className="border-b border-rule text-left text-[10px] tracking-[.12em] text-ink-3">
                  <th className="px-4 py-2 font-normal">學期</th>
                  <th className="px-2 py-2 font-normal">班號</th>
                  <th className="px-2 py-2 font-normal">老師</th>
                  <th className="px-2 py-2 text-right font-normal">GPA</th>
                  <th className="px-2 py-2 text-right font-normal">人數</th>
                  <th className="w-8 px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const key = `${row.semester}-${row.course_no}`;
                  const isThisSection = row.course_no === highlightCourseNo.trim().toUpperCase();
                  const isThisTeacher = sameTeacher(row.teacher, highlightTeacher);
                  const hasGrade = typeof row.gpa === 'number';
                  const open = expanded === key;
                  return (
                    <RowGroup key={key}>
                      <tr
                        className={`border-t border-rule ${isThisTeacher ? 'bg-paper' : ''} ${hasGrade ? 'cursor-pointer hover:bg-paper' : 'text-ink-3'}`}
                        onClick={() => hasGrade && setExpanded(open ? null : key)}
                      >
                        <td className="px-4 py-2 tabular-nums">{row.semester}</td>
                        <td className="px-2 py-2">
                          {row.course_no}
                          {isThisSection && <span className="ml-1 text-[10px] text-ink-3">這班</span>}
                        </td>
                        <td className={`px-2 py-2 ${isThisTeacher ? 'font-medium' : ''}`}>{row.teacher || '—'}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{hasGrade ? row.gpa!.toFixed(2) : '—'}</td>
                        <td className="px-2 py-2 text-right tabular-nums">{row.students ?? '—'}</td>
                        <td className="px-2 py-2 text-right text-ink-3">{hasGrade ? (open ? '▾' : '▸') : ''}</td>
                      </tr>
                      {open && row.distribution && (
                        <tr className="bg-paper">
                          <td colSpan={6} className="px-4 pb-3 pt-1">
                            <Distribution row={row} />
                          </td>
                        </tr>
                      )}
                    </RowGroup>
                  );
                })}
              </tbody>
            </table>
          )}
          {result?.status === 'rate_limited' && (
            <p className="border-t border-rule px-5 py-3 text-xs text-ink-3">myNTUST 暫時限流，部分班的成績沒抓到，稍後再開一次。</p>
          )}
        </div>
        <p className="border-t border-rule px-5 py-2.5 text-[11px] leading-relaxed text-ink-3">
          每個班號只有最近一次有成績的學期會有數字；同一班號更早的學期 myNTUST 沒存。點有數字的列看成績分布。
        </p>
      </div>
    </div>
  );
}

function RowGroup({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

function Distribution({ row }: { row: GpaHistoryRow }) {
  const dist = row.distribution ?? {};
  const total = GRADE_ORDER.reduce((sum, grade) => sum + (dist[grade] ?? 0), 0) || row.students || 0;
  const max = Math.max(1, ...GRADE_ORDER.map((grade) => dist[grade] ?? 0));
  return (
    <div className="grid grid-cols-12 gap-1">
      {GRADE_ORDER.map((grade) => {
        const count = dist[grade] ?? 0;
        return (
          <div key={grade} className="flex flex-col items-center gap-1">
            <div className="flex h-12 w-full items-end">
              <div className="w-full bg-ink-3/60" style={{ height: `${(count / max) * 100}%` }} title={`${grade}：${count} 人`} />
            </div>
            <span className="text-[10px] text-ink-3">{grade}</span>
            <span className="text-[10px] tabular-nums">{count}</span>
          </div>
        );
      })}
      <p className="col-span-12 mt-1 text-[10px] text-ink-3">共 {total} 人</p>
    </div>
  );
}

function sameTeacher(a: string, b: string): boolean {
  const split = (name: string) => new Set(name.replace(/\s/g, '').split(/[、,]/).filter(Boolean));
  const left = split(a);
  const right = split(b);
  for (const name of left) if (right.has(name)) return true;
  return false;
}
