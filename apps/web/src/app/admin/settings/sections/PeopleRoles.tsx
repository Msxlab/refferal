'use client';

import { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { Confirm, Loading, Modal, useToast } from '@/components/ui';

interface PermDef { key: string; label: string }
interface PermGroup { key: string; label: string; permissions: PermDef[] }
interface RoleRow {
  id: string;
  key: string;
  name: string;
  description: string | null;
  color: string | null;
  isSystem: boolean;
  permissions: string[];
  memberCount: number;
}
interface Person {
  membershipId: string;
  userId: string;
  fullName: string;
  email: string;
  tier: 'tenant_owner' | 'tenant_admin' | 'tenant_staff' | 'member' | 'platform_admin';
  role: { id: string; name: string; color: string | null; key: string } | null;
  status: 'active' | 'inactive';
  referralCode: string;
  emailVerified: boolean;
  twoFactor: boolean;
}

const TIER_LABEL: Record<string, string> = {
  tenant_owner: 'Owner',
  tenant_admin: 'Admin',
  tenant_staff: 'Staff',
  member: 'Member',
  platform_admin: 'Platform',
};

const ASSIGNABLE_TIERS = [
  { v: 'tenant_admin', l: 'Admin' },
  { v: 'tenant_staff', l: 'Staff' },
  { v: 'member', l: 'Member' },
];

export default function PeopleRoles() {
  const [groups, setGroups] = useState<PermGroup[] | null>(null);
  const [roles, setRoles] = useState<RoleRow[] | null>(null);
  const [people, setPeople] = useState<Person[] | null>(null);
  const [error, setError] = useState('');
  const [toast, showToast] = useToast();
  const [editing, setEditing] = useState<RoleRow | 'new' | null>(null);
  const [deleting, setDeleting] = useState<RoleRow | null>(null);
  const [busy, setBusy] = useState(false);

  async function reload() {
    try {
      const [g, r, p] = await Promise.all([
        api.get<PermGroup[]>('/admin/permissions'),
        api.get<RoleRow[]>('/admin/roles'),
        api.get<Person[]>('/admin/people'),
      ]);
      setGroups(g); setRoles(r); setPeople(p);
    } catch (e) { setError(String((e as ApiError).message)); }
  }
  useEffect(() => { reload(); }, []);

  async function assign(membershipId: string, patch: { tier?: string; roleId?: string | null }) {
    try {
      const next = await api.patch<Person[]>(`/admin/people/${membershipId}/role`, patch);
      setPeople(next);
      showToast('Role updated ✓');
    } catch (e) { showToast(String((e as ApiError).message)); }
  }

  async function removeRole() {
    if (!deleting) return;
    setBusy(true);
    try {
      const next = await api.del<RoleRow[]>(`/admin/roles/${deleting.id}`);
      setRoles(next); setDeleting(null);
      showToast('Role deleted ✓');
    } catch (e) { showToast(String((e as ApiError).message)); } finally { setBusy(false); }
  }

  if (error && !roles) return <div className="error">{error}</div>;
  if (!groups || !roles || !people) return <Loading rows={5} />;

  return (
    <div className="grid" style={{ gap: 20 }}>
      {/* ---- Roles ---- */}
      <section>
        <div className="spread" style={{ marginBottom: 12 }}>
          <div>
            <strong style={{ fontSize: 15 }}>Roles & permissions</strong>
            <div className="faint" style={{ fontSize: 12 }}>Define what each role can do. Owner always has full access.</div>
          </div>
          <button className="btn sm" onClick={() => setEditing('new')}>+ New role</button>
        </div>

        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill,minmax(260px,1fr))', gap: 12 }}>
          {roles.map((r) => (
            <div key={r.id} className="card" style={{ padding: 16 }}>
              <div className="spread">
                <div className="row" style={{ gap: 9 }}>
                  <span style={{ width: 11, height: 11, borderRadius: 4, background: r.color ?? 'hsl(var(--muted-foreground))' }} />
                  <strong style={{ fontSize: 14 }}>{r.name}</strong>
                  {r.isSystem && <span className="badge" style={{ fontSize: 9 }}>system</span>}
                </div>
                <span className="faint" style={{ fontSize: 11 }}>{r.memberCount} {r.memberCount === 1 ? 'person' : 'people'}</span>
              </div>
              {r.description && <div className="faint" style={{ fontSize: 12, marginTop: 7, lineHeight: 1.5 }}>{r.description}</div>}
              <div className="row" style={{ gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
                <span className="badge active" style={{ fontSize: 10 }}>{r.permissions.length} permissions</span>
              </div>
              <div className="row" style={{ gap: 8, marginTop: 12 }}>
                <button className="btn ghost sm" onClick={() => setEditing(r)}>
                  {r.isSystem && r.key === 'owner' ? 'View' : 'Edit'}
                </button>
                {!r.isSystem && (
                  <button className="btn ghost sm" onClick={() => setDeleting(r)}>Delete</button>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ---- People ---- */}
      <section>
        <div className="spread" style={{ marginBottom: 12 }}>
          <div>
            <strong style={{ fontSize: 15 }}>People</strong>
            <div className="faint" style={{ fontSize: 12 }}>Assign a role to each teammate. Owner is managed separately.</div>
          </div>
          <span className="faint" style={{ fontSize: 12 }}>{people.length} total</span>
        </div>

        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table>
            <thead>
              <tr>
                <th>Name</th><th>Tier</th><th>Role</th><th>Security</th><th>Status</th>
              </tr>
            </thead>
            <tbody>
              {people.map((p) => {
                const isOwner = p.tier === 'tenant_owner';
                const isMember = p.tier === 'member';
                return (
                  <tr key={p.membershipId}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{p.fullName}</div>
                      <div className="faint" style={{ fontSize: 11 }}>{p.email}</div>
                    </td>
                    <td>
                      {isOwner ? (
                        <span className="badge active" style={{ fontSize: 10 }}>Owner</span>
                      ) : (
                        <select
                          aria-label="Member tier"
                          value={p.tier}
                          onChange={(e) => assign(p.membershipId, { tier: e.target.value })}
                          style={{ padding: '5px 8px', fontSize: 12 }}
                        >
                          {ASSIGNABLE_TIERS.map((tr) => <option key={tr.v} value={tr.v}>{tr.l}</option>)}
                        </select>
                      )}
                    </td>
                    <td>
                      {isOwner ? (
                        <span className="faint" style={{ fontSize: 12 }}>Full access</span>
                      ) : isMember ? (
                        <span className="faint" style={{ fontSize: 12 }}>—</span>
                      ) : (
                        <select
                          aria-label="Member custom role"
                          value={p.role?.id ?? ''}
                          onChange={(e) => assign(p.membershipId, { roleId: e.target.value || null })}
                          style={{ padding: '5px 8px', fontSize: 12 }}
                        >
                          <option value="">No role</option>
                          {roles.filter((r) => r.key !== 'owner').map((r) => (
                            <option key={r.id} value={r.id}>{r.name}</option>
                          ))}
                        </select>
                      )}
                    </td>
                    <td>
                      <div className="row" style={{ gap: 5 }}>
                        <span className="badge" style={{ fontSize: 9 }} title="Email verification">
                          {p.emailVerified ? '✓ email' : 'unverified'}
                        </span>
                        {p.twoFactor && <span className="badge active" style={{ fontSize: 9 }} title="Two-factor enabled">2FA</span>}
                      </div>
                    </td>
                    <td>
                      <span className={`badge ${p.status === 'active' ? 'active' : 'inactive'}`} style={{ fontSize: 10 }}>
                        {p.status}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {editing && (
        <RoleEditor
          groups={groups}
          role={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(next) => { setRoles(next); setEditing(null); showToast('Role saved ✓'); }}
        />
      )}
      {deleting && (
        <Confirm
          title="Delete role"
          message={`Delete "${deleting.name}"? This cannot be undone.`}
          confirmLabel="Delete role"
          danger
          busy={busy}
          onConfirm={removeRole}
          onClose={() => setDeleting(null)}
        />
      )}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}

/* ----------------------------------------- rol duzenleyici + izin matrisi */
const SWATCHES = ['#D4AF37', '#5B7CFA', '#23A981', '#C98A2B', '#E0683C', '#8A93A6'];

function RoleEditor({ groups, role, onClose, onSaved }: {
  groups: PermGroup[];
  role: RoleRow | null;
  onClose: () => void;
  onSaved: (roles: RoleRow[]) => void;
}) {
  const locked = role?.isSystem && role.key === 'owner';
  const nameLocked = role?.isSystem ?? false;
  const [name, setName] = useState(role?.name ?? '');
  const [description, setDescription] = useState(role?.description ?? '');
  const [color, setColor] = useState(role?.color ?? SWATCHES[0]);
  const [perms, setPerms] = useState<Set<string>>(new Set(role?.permissions ?? []));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const allKeys = useMemo(() => groups.flatMap((g) => g.permissions.map((p) => p.key)), [groups]);

  function toggle(key: string) {
    if (locked) return;
    setPerms((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }
  function toggleGroup(g: PermGroup, on: boolean) {
    if (locked) return;
    setPerms((prev) => {
      const next = new Set(prev);
      g.permissions.forEach((p) => (on ? next.add(p.key) : next.delete(p.key)));
      return next;
    });
  }
  function setAll(on: boolean) {
    if (locked) return;
    setPerms(on ? new Set(allKeys) : new Set());
  }

  async function save() {
    if (locked) { onClose(); return; }
    setBusy(true); setErr('');
    const body = { name: name.trim(), description: description.trim() || undefined, color, permissions: [...perms] };
    try {
      const next = role
        ? await api.patch<RoleRow[]>(`/admin/roles/${role.id}`, body)
        : await api.post<RoleRow[]>('/admin/roles', body);
      onSaved(next);
    } catch (e) { setErr(String((e as ApiError).message)); } finally { setBusy(false); }
  }

  return (
    <Modal title={role ? (locked ? 'Owner role' : `Edit ${role.name}`) : 'New role'} onClose={onClose}>
      <div style={{ width: 'min(620px, 86vw)' }}>
        {locked && (
          <div className="muted" style={{ fontSize: 12, marginBottom: 12, padding: 10, borderRadius: 10, background: 'var(--panel-2)' }}>
            The Owner role always holds every permission and can't be edited.
          </div>
        )}
        <div className="row" style={{ gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div className="field" style={{ flex: 1, minWidth: 200, margin: 0 }}>
            <label>Role name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} disabled={nameLocked || locked} placeholder="e.g. Regional manager" />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>Color</label>
            <div className="row" style={{ gap: 6 }}>
              {SWATCHES.map((s) => (
                <button key={s} type="button" onClick={() => !locked && setColor(s)} aria-label={`color ${s}`}
                  style={{ width: 22, height: 22, borderRadius: 6, background: s, cursor: locked ? 'default' : 'pointer',
                    border: color === s ? '2px solid var(--text)' : '2px solid transparent' }} />
              ))}
            </div>
          </div>
        </div>
        <div className="field">
          <label>Description</label>
          <input value={description} onChange={(e) => setDescription(e.target.value)} disabled={locked} placeholder="What is this role for?" />
        </div>

        <div className="spread" style={{ margin: '6px 0 8px' }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: 'hsl(var(--muted-foreground))' }}>PERMISSIONS · {perms.size}/{allKeys.length}</label>
          {!locked && (
            <div className="row" style={{ gap: 8 }}>
              <button type="button" className="btn ghost sm" onClick={() => setAll(true)}>All</button>
              <button type="button" className="btn ghost sm" onClick={() => setAll(false)}>None</button>
            </div>
          )}
        </div>

        <div style={{ maxHeight: '42vh', overflow: 'auto', display: 'grid', gap: 14, paddingRight: 4 }}>
          {groups.map((g) => {
            const on = g.permissions.filter((p) => perms.has(p.key)).length;
            const allOn = on === g.permissions.length;
            return (
              <div key={g.key}>
                <div className="spread" style={{ marginBottom: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.02em' }}>{g.label}</span>
                  {!locked && (
                    <button type="button" className="link-btn" onClick={() => toggleGroup(g, !allOn)}
                      style={{ fontSize: 11, color: 'var(--gold-500)', background: 'none', border: 'none', cursor: 'pointer' }}>
                      {allOn ? 'clear' : 'select all'}
                    </button>
                  )}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(200px,1fr))', gap: 6 }}>
                  {g.permissions.map((p) => {
                    const checked = perms.has(p.key);
                    return (
                      <label key={p.key} className="perm-chip" onClick={(e) => { e.preventDefault(); toggle(p.key); }}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', borderRadius: 9,
                          cursor: locked ? 'default' : 'pointer', fontSize: 12.5,
                          background: checked ? 'var(--gold-soft, rgba(212,175,55,.1))' : 'var(--panel-2)',
                          border: `1px solid ${checked ? 'var(--gold-500)' : 'hsl(var(--border))'}`,
                        }}>
                        <span style={{
                          width: 15, height: 15, borderRadius: 4, flexShrink: 0, display: 'grid', placeItems: 'center',
                          background: checked ? 'var(--gold-500)' : 'transparent', color: 'var(--on-gold)',
                          border: checked ? 'none' : '1.5px solid var(--border-strong)', fontSize: 10, fontWeight: 900,
                        }}>{checked ? '✓' : ''}</span>
                        {p.label}
                      </label>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {err && <div className="error" style={{ marginTop: 12 }}>{err}</div>}
        <div className="row" style={{ justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
          <button className="btn ghost" onClick={onClose}>{locked ? 'Close' : 'Cancel'}</button>
          {!locked && <button className="btn" onClick={save} disabled={busy || !name.trim()}>{busy ? 'Saving…' : 'Save role'}</button>}
        </div>
      </div>
    </Modal>
  );
}
