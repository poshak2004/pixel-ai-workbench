import { useState } from 'react';
import { call } from '../../lib/ipc';
import { useAction } from '../../lib/store';
import type { Approval } from '../../lib/types';
import { Button, Input } from '../ui/primitives';

export function ApprovalBanner({ approval }: { approval: Approval }) {
  const [note, setNote] = useState('');
  const resolve = useAction((decision: 'approved' | 'denied') => call('approvals.resolve', { id: approval.id, decision, note: note || undefined }));
  return (
    <div className="flex items-start gap-4 border-b border-amber/50 bg-amber-soft px-6 py-3" role="alert" data-testid="approval-banner">
      <div className="mt-1 h-[10px] w-[10px] shrink-0 bg-amber pixel-blink" />
      <div className="min-w-0 flex-1">
        <div className="font-mono text-[10.5px] tracking-[0.14em] text-amber-ink uppercase">Human approval required · {approval.kind.replace('_', ' ')}</div>
        <div className="text-[13px] font-medium text-ink">{approval.title}</div>
        <div className="text-[12px] text-ink-2">{approval.reason}</div>
        <details className="mt-1">
          <summary className="cursor-pointer font-mono text-[10.5px] text-ink-3">details</summary>
          <pre className="mt-1 max-h-40 overflow-auto font-mono text-[11px] whitespace-pre-wrap text-ink-2" data-selectable>{JSON.stringify(approval.detail, null, 2)}</pre>
        </details>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Input className="w-48" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
        <Button variant="danger" onClick={() => resolve.run('denied')} busy={resolve.busy} data-testid="deny">
          Deny
        </Button>
        <Button variant="sage" onClick={() => resolve.run('approved')} busy={resolve.busy} data-testid="approve">
          Approve
        </Button>
      </div>
    </div>
  );
}
