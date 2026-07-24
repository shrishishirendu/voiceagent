'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, CardHeader, CardBody } from '@/components/shared/Card';
import { Button } from '@/components/shared/Button';
import { useAddToast } from '@/components/shared/Toast';
import { IconUsers, IconPlus, IconTrash } from '@/components/shared/Icons';

type MemberRole = 'admin' | 'agent' | 'viewer';
type Member = { id: string; email: string; role: MemberRole; accepted_at?: string | null };
type Me = { role: string; ownerId: string; isOwnerOrAdmin: boolean };

const ROLE_LABELS: Record<MemberRole, string> = { admin: 'Admin', agent: 'Agent', viewer: 'Viewer' };
const ROLE_HELP: Record<MemberRole, string> = {
  admin: 'Everything except owner-only account settings.',
  agent: 'Dispatch calls, work tickets, edit customers/invoices. No banking or contact PII.',
  viewer: 'Read-only dashboards. No banking or contact PII.',
};

// Team & Access (Phase 3-C). Members live in the tenant's `members` jsonb; roles gate
// what each teammate can see (banking/PII are trimmed server-side for agent/viewer).
// Self-hides for non-admins — the /api/members routes also reject them server-side.
export function TeamSection() {
  const [me, setMe] = useState<Me | null>(null);
  const [members, setMembers] = useState<Member[] | null>(null);
  const [owner, setOwner] = useState<string>('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<MemberRole>('agent');
  const [busy, setBusy] = useState(false);
  const addToast = useAddToast();

  const load = useCallback(async () => {
    try {
      const meRes = await fetch('/api/me', { cache: 'no-store' });
      if (!meRes.ok) return;
      const meData: Me = await meRes.json();
      setMe(meData);
      if (!meData.isOwnerOrAdmin) return; // non-admins never fetch the member list
      const r = await fetch('/api/members', { cache: 'no-store' });
      if (!r.ok) return;
      const data = await r.json();
      setMembers(data.members ?? []);
      setOwner(data.owner?.email ?? meData.ownerId);
    } catch {
      /* leave section hidden on failure */
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Only owners/admins manage the team.
  if (!me || !me.isOwnerOrAdmin) return null;

  const invite = async () => {
    if (!inviteEmail.trim()) return;
    setBusy(true);
    try {
      const r = await fetch('/api/members', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error ?? `HTTP ${r.status}`);
      setInviteEmail('');
      addToast('Member invited.', 'success');
      await load();
    } catch (e) {
      addToast(e instanceof Error ? e.message : 'Invite failed.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const changeRole = async (id: string, role: MemberRole) => {
    setMembers((prev) => prev?.map((m) => (m.id === id ? { ...m, role } : m)) ?? prev);
    try {
      const r = await fetch(`/api/members/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      addToast('Role updated.', 'success');
    } catch {
      addToast('Failed to update role.', 'error');
      await load();
    }
  };

  const remove = async (id: string) => {
    setBusy(true);
    try {
      const r = await fetch(`/api/members/${id}`, { method: 'DELETE' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setMembers((prev) => prev?.filter((m) => m.id !== id) ?? prev);
      addToast('Member removed.', 'success');
    } catch {
      addToast('Failed to remove member.', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader className="flex items-center gap-2">
        <IconUsers className="w-4 h-4 text-slate-400" />
        <h2 className="text-sm font-semibold text-slate-900">Team &amp; access</h2>
      </CardHeader>
      <CardBody className="space-y-4">
        <p className="text-xs text-slate-500 -mt-1">
          Invite teammates and set what they can see. Agents and viewers never see banking details or
          contact phone/email — those are hidden from API responses, not just the screen.
        </p>

        {/* Owner (implicit, non-editable) */}
        <div className="flex items-center justify-between gap-4 rounded-xl border border-slate-100 bg-slate-50 px-3.5 py-2.5">
          <div className="min-w-0">
            <p className="text-sm font-medium text-slate-800 truncate">{owner}</p>
            <p className="text-xs text-slate-500">Workspace owner</p>
          </div>
          <span className="pill bg-slate-900 text-white border-slate-900 flex-none">Owner</span>
        </div>

        {/* Members */}
        {members && members.length > 0 ? (
          <div className="space-y-2">
            {members.map((m) => (
              <div key={m.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 px-3.5 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-800 truncate">{m.email}</p>
                  <p className="text-xs text-slate-500">
                    {m.accepted_at ? 'Active' : 'Invited — pending first sign-in'} · {ROLE_HELP[m.role]}
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-none">
                  <select
                    className="input py-1.5 text-sm w-28"
                    value={m.role}
                    onChange={(e) => changeRole(m.id, e.target.value as MemberRole)}
                    disabled={busy}
                  >
                    {(['admin', 'agent', 'viewer'] as MemberRole[]).map((r) => (
                      <option key={r} value={r}>
                        {ROLE_LABELS[r]}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() => remove(m.id)}
                    disabled={busy}
                    className="text-slate-300 hover:text-rose-500 transition-colors p-1.5"
                    title="Remove member"
                  >
                    <IconTrash className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate-400">No teammates yet.</p>
        )}

        {/* Invite */}
        <div className="flex items-end gap-2 pt-1">
          <div className="flex-1">
            <label className="label" htmlFor="invite-email">
              Invite by email
            </label>
            <input
              id="invite-email"
              className="input"
              type="email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="teammate@company.com"
              onKeyDown={(e) => e.key === 'Enter' && invite()}
            />
          </div>
          <select
            className="input w-28 flex-none"
            value={inviteRole}
            onChange={(e) => setInviteRole(e.target.value as MemberRole)}
          >
            {(['admin', 'agent', 'viewer'] as MemberRole[]).map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
          <Button variant="secondary" icon={<IconPlus className="w-4 h-4" />} onClick={invite} loading={busy} disabled={!inviteEmail.trim()}>
            Invite
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
