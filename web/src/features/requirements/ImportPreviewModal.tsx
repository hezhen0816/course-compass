import { type ApiImportPreview, formatCredits, importPreviewSets } from '../../shared/domain/planner';
import { SETTINGS_PRIMARY_BUTTON, SETTINGS_SECONDARY_BUTTON } from '../settings/SettingsPage';

export function ImportPreviewModal({
  preview,
  onConfirm,
  onClose,
}: {
  preview: ApiImportPreview;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const sets = importPreviewSets(preview);
  const name = sets.length === 1 ? String(sets[0].requirement_set.name || 'PDF 匯入需求') : `${sets.length} 份應修科目表`;
  const totalCredits = sets.length === 1 ? (sets[0].requirement_set.total_credits as number | undefined) : undefined;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/35 p-4">
      <div className="max-h-[86vh] w-full max-w-2xl overflow-hidden rounded-2xl bg-sheet shadow-card">
        <div className="border-b border-rule px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-mono text-[11px] tracking-[.14em] text-ink-3">匯入預覽</p>
              <h2 className="mt-0.5 text-[15px] font-bold">{name}</h2>
              {totalCredits ? <p className="font-mono text-[11px] text-ink-2">{formatCredits(totalCredits)} 學分</p> : null}
            </div>
            <button type="button" onClick={onClose} aria-label="關閉" className="rounded-sm border border-rule px-2 text-sm leading-6 text-ink-2 hover:border-accent hover:text-accent">×</button>
          </div>
        </div>
        <div className="max-h-[62vh] overflow-y-auto">
          {preview.warnings.length > 0 && (
            <div className="m-4 rounded-xl bg-mark-soft px-3 py-2 text-[13px] leading-relaxed">
              {preview.warnings.join('；')}
            </div>
          )}
          {sets.map((set, index) => (
            <div key={index}>
              {sets.length > 1 && (
                <p className="border-t border-rule bg-paper px-4 py-2 font-mono text-[11px] tracking-wide text-ink-2">
                  {String(set.requirement_set.name || 'PDF 匯入需求')}
                  {typeof set.requirement_set.total_credits === 'number' ? `・${formatCredits(set.requirement_set.total_credits)} 學分` : ''}
                </p>
              )}
              <ul>
                {set.pending_requirements.map((requirement) => (
                  <li key={String(requirement.id)} className="border-t border-rule px-4 py-2.5 first:border-t-0">
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="text-sm font-medium">
                        {String(requirement.title)}
                        {Array.isArray(requirement.department_prefixes) && requirement.department_prefixes.length > 0 && (
                          <span className="ml-2 font-mono text-[10px] text-ink-3">{(requirement.department_prefixes as string[]).join('/')}</span>
                        )}
                      </p>
                      <span className="font-mono text-[11px] tabular-nums text-ink-2">
                        {formatCredits(requirement.required_credits as number | null | undefined)} 學分
                      </span>
                    </div>
                    {Array.isArray(requirement.course_names) && requirement.course_names.length > 1 && (
                      <p className="mt-0.5 text-xs text-ink-2">{(requirement.course_names as string[]).join('、')}</p>
                    )}
                    {requirement.note ? <p className="mt-0.5 text-xs text-ink-3">{String(requirement.note)}</p> : null}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="flex justify-end gap-2 border-t border-rule px-4 py-3">
          <button type="button" onClick={onClose} className={SETTINGS_SECONDARY_BUTTON}>取消</button>
          <button type="button" onClick={onConfirm} className={SETTINGS_PRIMARY_BUTTON}>加入待修池</button>
        </div>
      </div>
    </div>
  );
}
