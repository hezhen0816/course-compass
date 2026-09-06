import { AlertTriangle } from 'lucide-react';

export function SafetyNotice() {
  return (
    <div className="mb-4 flex items-center gap-2 px-1 text-xs text-slate-500">
      <AlertTriangle className="h-4 w-4 shrink-0 text-slate-400" />
      <span>官方選課須經你確認後送出；虛擬加入不代表已完成選課。</span>
    </div>
  );
}
