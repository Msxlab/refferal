'use client';

import { FormEvent, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { Confirm, Loading, Modal, StatCard, useToast } from '@/components/ui';
import { money } from '@/lib/format';

interface Pkg { id: string; key: string; name: string; monthlyFeeCents: string; features: unknown; limits: unknown; active: boolean }
interface Mrr { mrrCents: string; activeCount: number }

interface PkgForm { key: string; name: string; monthlyFee: string }
const EMPTY_FORM: PkgForm = { key: '', name: '', monthlyFee: '' };

/** Item 10: billing paket katalogu (Starter/Growth/Enterprise) — CRUD + platform MRR. */
export default function PackagesPage() {
  const [packages, setPackages] = useState<Pkg[] | null>(null);
  const [mrr, setMrr] = useState<Mrr | null>(null);
  const [error, setError] = useState('');
  const [toast, showToast] = useToast();

  const [editing, setEditing] = useState<Pkg | null>(null); // null=closed, {id:''}=create
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<PkgForm>(EMPTY_FORM);
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);

  const [deactivating, setDeactivating] = useState<Pkg | null>(null);

  function load() {
    api.get<Pkg[]>('/platform/packages').then(setPackages).catch((e) => setError(String((e as ApiError).message)));
    api.get<Mrr>('/platform/mrr').then(setMrr).catch(() => {});
  }

  useEffect(() => { load(); }, []);

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormError('');
    setShowForm(true);
  }

  function openEdit(p: Pkg) {
    setEditing(p);
    setForm({ key: p.key, name: p.name, monthlyFee: (Number(p.monthlyFeeCents) / 100).toString() });
    setFormError('');
    setShowForm(true);
  }

  async function submitForm(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFormError('');
    const monthlyFeeCents = Math.round(parseFloat(form.monthlyFee || '0') * 100);
    try {
      if (editing) {
        await api.put(`/platform/packages/${editing.id}`, { name: form.name.trim(), monthlyFeeCents });
        showToast('Package updated ✓');
      } else {
        await api.post('/platform/packages', { key: form.key.trim(), name: form.name.trim(), monthlyFeeCents, features: {}, limits: {} });
        showToast('Package created ✓');
      }
      setShowForm(false);
      load();
    } catch (e) {
      setFormError(e instanceof ApiError ? e.message : 'Could not save package.');
    } finally {
      setBusy(false);
    }
  }

  async function deactivate() {
    if (!deactivating) return;
    setBusy(true);
    try {
      await api.del(`/platform/packages/${deactivating.id}`);
      setDeactivating(null);
      load();
      showToast('Package deactivated');
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : 'Could not deactivate package.');
      setDeactivating(null);
    } finally {
      setBusy(false);
    }
  }

  if (error && !packages) return <div className="error">{error}</div>;

  return (
    <div>
      <div className="spread fade-in">
        <div>
          <div className="eyebrow">Platform</div>
          <h1 className="h1">Packages</h1>
          <p className="sub" style={{ marginBottom: 16 }}>The subscription package catalog (Starter / Growth / Enterprise).</p>
        </div>
        <button className="btn" onClick={openCreate}>＋ New package</button>
      </div>

      {error && <div className="error" style={{ marginBottom: 12 }}>{error}</div>}

      <div className="stat-grid fade-in delay-1" style={{ marginBottom: 18, gridTemplateColumns: 'repeat(auto-fill,minmax(200px,1fr))' }}>
        <StatCard label="MRR" value={mrr ? money(mrr.mrrCents) : '—'} icon="↻" hint={mrr ? `${mrr.activeCount} active billing config${mrr.activeCount === 1 ? '' : 's'}` : undefined} />
      </div>

      {!packages ? (
        <Loading rows={4} />
      ) : (
        <div className="card fade-in delay-2" style={{ padding: 0, overflowX: 'auto' }}>
          <table aria-label="Billing packages">
            <thead><tr><th>Key</th><th>Name</th><th>Monthly fee</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {packages.map((p) => (
                <tr key={p.id}>
                  <td className="tnum faint">{p.key}</td>
                  <td>{p.name}</td>
                  <td className="tnum">{money(p.monthlyFeeCents)}</td>
                  <td><span className={`badge ${p.active ? 'active' : 'inactive'}`}>{p.active ? 'Active' : 'Inactive'}</span></td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button className="btn ghost sm" onClick={() => openEdit(p)}>Edit</button>{' '}
                    {p.active && <button className="btn ghost danger sm" onClick={() => setDeactivating(p)}>Deactivate</button>}
                  </td>
                </tr>
              ))}
              {packages.length === 0 && <tr><td colSpan={5} className="muted">No packages yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      <p className="faint fade-in delay-2" style={{ fontSize: 11, marginTop: 12 }}>
        Note: a tenant&apos;s billing config can override its package&apos;s fee — per-company &quot;custom fee&quot; comparison isn&apos;t shown here because the tenant billing endpoints don&apos;t expose which package (if any) backs a tenant&apos;s fee. See a company&apos;s Settings tab for its actual billing configuration.
      </p>

      {showForm && (
        <Modal title={editing ? `Edit ${editing.name}` : 'New package'} onClose={() => setShowForm(false)}>
          <form onSubmit={submitForm} style={{ width: 'min(420px, 100%)' }}>
            {!editing && (
              <div className="field">
                <label htmlFor="pkg-key">Key</label>
                <input id="pkg-key" value={form.key} onChange={(e) => setForm((f) => ({ ...f, key: e.target.value }))} required autoFocus placeholder="starter" />
              </div>
            )}
            <div className="field">
              <label htmlFor="pkg-name">Name</label>
              <input id="pkg-name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required placeholder="Starter" />
            </div>
            <div className="field">
              <label htmlFor="pkg-fee">Monthly fee (USD)</label>
              <input id="pkg-fee" value={form.monthlyFee} onChange={(e) => setForm((f) => ({ ...f, monthlyFee: e.target.value }))} inputMode="decimal" required placeholder="99.00" />
            </div>
            {formError && <div className="error">{formError}</div>}
            <div className="row" style={{ justifyContent: 'flex-end', marginTop: 14 }}>
              <button type="button" className="btn ghost" onClick={() => setShowForm(false)} disabled={busy}>Cancel</button>
              <button type="submit" className="btn" disabled={busy || !form.name.trim() || (!editing && !form.key.trim())}>
                {busy ? '…' : editing ? 'Save' : 'Create'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {deactivating && (
        <Confirm
          title="Deactivate package?"
          message={`${deactivating.name} will no longer be selectable for new billing configs. Existing tenants keep their current config.`}
          confirmLabel="Deactivate"
          danger
          busy={busy}
          onConfirm={deactivate}
          onClose={() => setDeactivating(null)}
        />
      )}

      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
