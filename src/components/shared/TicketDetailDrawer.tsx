'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Drawer } from './Drawer';
import { LoadingOverlay } from './Spinner';
import { Pill, TicketStatusBadge, type OutboundTicketStatus } from './Badge';
import { CallDetailDrawer } from './CallDetailDrawer';
import { IconPhone, IconCheck } from './Icons';
import { fmtAmount, fmtDate, fmtWhen } from '@/lib/format';

type LinkedInvoice = {
  id: string;
  invoiceNumber: string | null;
  dueDate: string | null;
  amountDue: number | null;
  currency: string | null;
  status: string;
};

type TicketDetail = {
  id: string;
  title: string | null;
  requester: string | null;
  channel: string;
  status: string;
  derivedStatus: OutboundTicketStatus;
  aiSummary: string | null;
  body: string | null;
  tags: string[];
  notes: { text: string; ts?: string }[];
  createdAt: string;
  call: { id: string; status: string; outcome: string | null; recordingUrl: string | null; durationSec: number | null; summary: string | null } | null;
  customer: { id: string; businessName: string; contactPhone: string | null } | null;
  invoices: LinkedInvoice[];
};

function cleanTitle(title: string | null): string {
  return (title ?? 'Ticket').replace(/^\[(?:CHAT|PHONE|EMAIL|SIMULATED|CALL)\]\s*/, '');
}

/**
 * Ticket detail slide-in — the outbound analogue of EnvoyIn's TicketDetail drawer.
 * Fetches its own row from GET /api/tickets/[id], shows the linked customer + invoice(s),
 * the AI summary, tags and notes, and defers the full transcript/recording to the existing
 * CallDetailDrawer (opened by callId) so nothing is duplicated.
 */
export function TicketDetailDrawer({ ticketId, onClose, onChanged }: { ticketId: string | null; onClose: () => void; onChanged?: () => void }) {
  const [ticket, setTicket] = useState<TicketDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noteText, setNoteText] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [showCall, setShowCall] = useState(false);

  const load = useCallback(async () => {
    if (!ticketId) return;
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`/api/tickets/${ticketId}`, { cache: 'no-store' });
      if (!r.ok) throw new Error('load failed');
      setTicket((await r.json()).ticket);
    } catch {
      setError('Could not load this ticket.');
    } finally {
      setLoading(false);
    }
  }, [ticketId]);

  useEffect(() => {
    if (!ticketId) {
      setTicket(null);
      setError(null);
      setNoteText('');
      return;
    }
    load();
  }, [ticketId, load]);

  async function patch(body: Record<string, unknown>, label: string) {
    if (!ticketId) return;
    setBusy(label);
    try {
      const r = await fetch(`/api/tickets/${ticketId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw new Error('patch failed');
      if (label === 'note') setNoteText('');
      await load();
      onChanged?.();
    } catch {
      // swallow — drawer stays open; user can retry
    } finally {
      setBusy(null);
    }
  }

  if (ticketId == null) return null;

  const tags = (ticket?.tags ?? []).filter((t) => !/^(sid|wa):/.test(t));

  return (
    <>
      <Drawer open={ticketId != null} onClose={onClose} title={ticket ? cleanTitle(ticket.title) : 'Ticket'}>
        {loading && <LoadingOverlay message="Loading ticket…" />}
        {!loading && error && <div className="p-6 text-sm text-red-600">{error}</div>}

        {!loading && !error && ticket && (
          <div className="p-5 space-y-6">
            {/* Meta row */}
            <div className="flex flex-wrap items-center gap-2">
              <TicketStatusBadge status={ticket.derivedStatus} />
              <Pill className="capitalize">{ticket.channel}</Pill>
              {ticket.tags.includes('outbound') && <Pill>outbound</Pill>}
              <span className="text-xs text-slate-400">{fmtWhen(ticket.createdAt)}</span>
            </div>

            {/* Linked customer */}
            {ticket.customer && (
              <section>
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1.5">Customer</p>
                <Link
                  href={`/app/customers/${ticket.customer.id}`}
                  className="inline-flex items-center gap-2 text-sm font-medium text-slate-900 hover:text-brand transition-colors"
                >
                  {ticket.customer.businessName}
                </Link>
                {ticket.customer.contactPhone && (
                  <p className="font-mono text-xs text-slate-400 mt-0.5">{ticket.customer.contactPhone}</p>
                )}
              </section>
            )}

            {/* Linked invoices */}
            {ticket.invoices.length > 0 && (
              <section>
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">
                  {ticket.invoices.length === 1 ? 'Invoice' : `${ticket.invoices.length} invoices`}
                </p>
                <div className="flex flex-col gap-1.5">
                  {ticket.invoices.map((inv) => (
                    <div key={inv.id} className="flex items-center justify-between text-sm rounded-xl border border-slate-100 px-3 py-2">
                      <span className="text-slate-700">
                        {inv.invoiceNumber ? `#${inv.invoiceNumber}` : 'Invoice'}
                        {inv.dueDate ? ` · due ${fmtDate(inv.dueDate)}` : ''}
                      </span>
                      <span className="font-mono text-slate-500">{fmtAmount(inv.currency, inv.amountDue)}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* AI summary */}
            {(ticket.aiSummary || ticket.call?.summary) && (
              <section>
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1.5">Summary</p>
                <p className="text-sm leading-relaxed text-slate-700">{ticket.aiSummary || ticket.call?.summary}</p>
              </section>
            )}

            {/* Full call */}
            {ticket.call && (
              <button className="btn-secondary text-xs py-1.5" onClick={() => setShowCall(true)}>
                <IconPhone className="w-3.5 h-3.5" /> View full call
              </button>
            )}

            {/* Tags */}
            {tags.length > 0 && (
              <section>
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Tags</p>
                <div className="flex flex-wrap gap-1.5">
                  {tags.map((tag) => (
                    <span key={tag} className="badge bg-brand-faint text-brand border border-brand/20">{tag}</span>
                  ))}
                </div>
              </section>
            )}

            {/* Actions */}
            <div className="flex flex-wrap gap-2">
              {ticket.status !== 'Resolved' && (
                <button
                  className="btn-secondary text-xs py-1.5"
                  onClick={() => patch({ status: 'Resolved' }, 'resolve')}
                  disabled={!!busy}
                >
                  <IconCheck className="w-3.5 h-3.5" /> {busy === 'resolve' ? 'Resolving…' : 'Mark resolved'}
                </button>
              )}
            </div>

            {/* Notes */}
            <section>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2">Notes</p>
              {ticket.notes.length > 0 && (
                <div className="space-y-1.5 mb-3">
                  {ticket.notes.map((n, i) => (
                    <div key={i} className="text-xs bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 text-slate-700">
                      {n.text}
                      {n.ts && <span className="ml-2 text-slate-400 text-[10px]">{fmtWhen(n.ts)}</span>}
                    </div>
                  ))}
                </div>
              )}
              <div className="flex gap-2">
                <input
                  className="input text-xs"
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  placeholder="Add a note…"
                  onKeyDown={(e) => e.key === 'Enter' && noteText.trim() && patch({ note: noteText.trim() }, 'note')}
                />
                <button
                  className="btn-secondary text-xs py-1.5 whitespace-nowrap"
                  onClick={() => noteText.trim() && patch({ note: noteText.trim() }, 'note')}
                  disabled={!noteText.trim() || !!busy}
                >
                  {busy === 'note' ? '…' : 'Add'}
                </button>
              </div>
            </section>
          </div>
        )}
      </Drawer>

      {showCall && ticket?.call && (
        <CallDetailDrawer callId={ticket.call.id} onClose={() => setShowCall(false)} />
      )}
    </>
  );
}
