'use client';

export function Badge({ className = '', children }: { className?: string; children: React.ReactNode }) {
  return <span className={`badge ${className}`}>{children}</span>;
}

export function Pill({ className = '', children }: { className?: string; children: React.ReactNode }) {
  return <span className={`pill ${className}`}>{children}</span>;
}

/** Call.status: dispatching | queued | ringing | in-progress | completed | failed */
export type CallStatus = 'dispatching' | 'queued' | 'ringing' | 'in-progress' | 'completed' | 'failed';
/** Call.outcome: success | partial | failed | no-answer */
export type CallOutcome = 'success' | 'partial' | 'failed' | 'no-answer' | null | undefined;
/** Invoice.status: stored | pending | queued | calling | resolved | failed | cancelled */
export type InvoiceStatus = 'stored' | 'pending' | 'queued' | 'calling' | 'resolved' | 'failed' | 'cancelled';
/** Derived outbound ticket status (from lib/tickets deriveOutboundTicketStatus). */
export type OutboundTicketStatus = 'Queued' | 'Calling' | 'Voicemail' | 'Failed' | 'Resolved';

const CALL_STATUS_LABEL: Record<CallStatus, string> = {
  dispatching: 'Dispatching',
  queued: 'Connecting',
  ringing: 'Ringing',
  'in-progress': 'In conversation',
  completed: 'Completed',
  failed: 'Failed',
};

const OUTCOME_CFG: Record<string, { label: string; cls: string }> = {
  success: { label: 'Resolved', cls: 'bg-emerald-100 text-emerald-700' },
  partial: { label: 'Partial', cls: 'bg-amber-100 text-amber-700' },
  'no-answer': { label: 'No answer', cls: 'bg-slate-100 text-slate-500' },
  failed: { label: 'Failed', cls: 'bg-red-100 text-red-700' },
};

/** Shows a pulsing blue "in progress" badge while a call is active, or the settled outcome once it's done. */
export function CallStatusBadge({ status, outcome }: { status: CallStatus; outcome?: CallOutcome }) {
  const active = status !== 'completed' && status !== 'failed';
  if (active) {
    return (
      <Badge className="bg-blue-100 text-blue-700">
        <span className="dot-pulse inline-block w-1.5 h-1.5 rounded-full bg-blue-500 mr-1.5" />
        {CALL_STATUS_LABEL[status] ?? status}
      </Badge>
    );
  }
  return <CallOutcomeBadge outcome={outcome} />;
}

export function CallOutcomeBadge({ outcome }: { outcome: CallOutcome }) {
  const cfg = (outcome && OUTCOME_CFG[outcome]) || { label: '—', cls: 'bg-slate-100 text-slate-400' };
  return <Badge className={cfg.cls}>{cfg.label}</Badge>;
}

const INVOICE_STATUS_CFG: Record<InvoiceStatus, { label: string; cls: string; pulsing?: boolean }> = {
  stored: { label: 'Stored', cls: 'bg-slate-100 text-slate-600' },
  pending: { label: 'Pending', cls: 'bg-slate-100 text-slate-500' },
  queued: { label: 'Queued', cls: 'bg-amber-100 text-amber-700', pulsing: true },
  calling: { label: 'Calling', cls: 'bg-blue-100 text-blue-700', pulsing: true },
  resolved: { label: 'Resolved', cls: 'bg-emerald-100 text-emerald-700' },
  failed: { label: 'Failed', cls: 'bg-red-100 text-red-700' },
  cancelled: { label: 'Cancelled', cls: 'bg-slate-100 text-slate-400' },
};

export function InvoiceStatusBadge({ status }: { status: InvoiceStatus }) {
  const cfg = INVOICE_STATUS_CFG[status] || { label: status, cls: 'bg-slate-100 text-slate-500' };
  return (
    <Badge className={cfg.cls}>
      {cfg.pulsing && <span className="dot-pulse inline-block w-1.5 h-1.5 rounded-full bg-current mr-1.5" />}
      {cfg.label}
    </Badge>
  );
}

// Outbound ticket board palette — reuses the validated outbound-stats hues
// (resolved emerald / voicemail slate / failed red / active amber) + blue for a live call.
const TICKET_STATUS_CFG: Record<OutboundTicketStatus, { label: string; cls: string; dot: string; pulsing?: boolean }> = {
  Queued: { label: 'Queued', cls: 'bg-amber-100 text-amber-700', dot: 'bg-amber-400' },
  Calling: { label: 'Calling', cls: 'bg-blue-100 text-blue-700', dot: 'bg-blue-500', pulsing: true },
  Voicemail: { label: 'Voicemail', cls: 'bg-slate-100 text-slate-500', dot: 'bg-slate-400' },
  Failed: { label: 'Failed', cls: 'bg-red-100 text-red-700', dot: 'bg-red-500' },
  Resolved: { label: 'Resolved', cls: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-500' },
};

/** The colored dot class for a derived outbound ticket status (card left-accent / lane header). */
export function ticketStatusDot(status: OutboundTicketStatus): string {
  return TICKET_STATUS_CFG[status]?.dot ?? 'bg-slate-300';
}

export function TicketStatusBadge({ status }: { status: OutboundTicketStatus }) {
  const cfg = TICKET_STATUS_CFG[status] || { label: status, cls: 'bg-slate-100 text-slate-500', pulsing: false };
  return (
    <Badge className={cfg.cls}>
      {cfg.pulsing && <span className="dot-pulse inline-block w-1.5 h-1.5 rounded-full bg-current mr-1.5" />}
      {cfg.label}
    </Badge>
  );
}

/** Parse-document / scheduler errors — amber, matches EnvoyIn's warning tone. */
export function WarningBadge({ children }: { children: React.ReactNode }) {
  return <Badge className="bg-amber-100 text-amber-700">{children}</Badge>;
}
