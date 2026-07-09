'use client';

import { FormEvent, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { Confirm, Loading, Modal, useToast } from '@/components/ui';
import { dateShort } from '@/lib/format';

interface Admin { id: string; email: string; fullName: string; createdAt: string }

/** Item 9: platform admin yonetimi — listele / e-posta ile ver / al. */
export default function AdminsPage() {
  const [admins, setAdmins] = useState<Admin[] | null>(null);
  const [error, setError] = useState('');
  const [toast, showToast] = useToast();

  const [showGrant, setShowGrant] = useState(false);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [grantError, setGrantError] = useState('');

  const [revoking, setRevoking] = useState<Admin | null>(null);

  function load() {
    api.get<Admin[]>('/platform/admins').then(setAdmins).catch((e) => setError(String((e as ApiError).message)));
  }

  useEffect(() => { load(); }, []);

  async function grant(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setGrantError('');
    try {
      await api.post('/platform/admins', { email: email.trim() });
      setShowGrant(false);
      setEmail('');
      load();
      showToast('Platform admin granted ✓');
    } catch (e) {
      setGrantError(e instanceof ApiError ? e.message : 'Could not grant admin access.');
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    if (!revoking) return;
    setBusy(true);
    try {
      await api.del(`/platform/admins/${revoking.id}`);
      setRevoking(null);
      load();
      showToast('Platform admin revoked');
    } catch (e) {
      showToast(e instanceof ApiError ? e.message : 'Could not revoke admin access.');
      setRevoking(null);
    } finally {
      setBusy(false);
    }
  }

  if (error && !admins) return <div className="error">{error}</div>;

  return (
    <div>
      <div className="spread fade-in">
        <div>
          <div className="eyebrow">Platform</div>
          <h1 className="h1">Admins</h1>
          <p className="sub" style={{ marginBottom: 16 }}>Who has platform-wide (cross-company) access.</p>
        </div>
        <button className="btn" onClick={() => setShowGrant(true)}>＋ Grant by email</button>
      </div>

      {error && <div className="error" style={{ marginBottom: 12 }}>{error}</div>}

      <p className="faint fade-in delay-1" style={{ fontSize: 12, marginBottom: 14 }}>
        Note: newly-granted admins must re-login for access to take effect.
      </p>

      {!admins ? (
        <Loading rows={4} />
      ) : (
        <div className="card fade-in delay-2" style={{ padding: 0, overflowX: 'auto' }}>
          <table aria-label="Platform admins">
            <thead><tr><th>Name</th><th>Email</th><th>Granted</th><th></th></tr></thead>
            <tbody>
              {admins.map((a) => (
                <tr key={a.id}>
                  <td>{a.fullName}</td>
                  <td className="faint">{a.email}</td>
                  <td className="muted">{dateShort(a.createdAt)}</td>
                  <td style={{ textAlign: 'right' }}>
                    <button className="btn ghost danger sm" onClick={() => setRevoking(a)}>Revoke</button>
                  </td>
                </tr>
              ))}
              {admins.length === 0 && <tr><td colSpan={4} className="muted">No platform admins.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {showGrant && (
        <Modal title="Grant platform admin" onClose={() => setShowGrant(false)}>
          <form onSubmit={grant} style={{ width: 'min(420px, 100%)' }}>
            <p className="muted" style={{ marginTop: 0 }}>The user must already have an account on {process.env.NEXT_PUBLIC_APP_NAME ?? 'the platform'}.</p>
            <div className="field">
              <label htmlFor="grant-email">Email</label>
              <input id="grant-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus placeholder="name@company.com" />
            </div>
            {grantError && <div className="error">{grantError}</div>}
            <div className="row" style={{ justifyContent: 'flex-end', marginTop: 14 }}>
              <button type="button" className="btn ghost" onClick={() => setShowGrant(false)} disabled={busy}>Cancel</button>
              <button type="submit" className="btn" disabled={busy || !email.trim()}>{busy ? '…' : 'Grant'}</button>
            </div>
          </form>
        </Modal>
      )}

      {revoking && (
        <Confirm
          title="Revoke platform admin?"
          message={`${revoking.fullName} (${revoking.email}) will lose platform-wide access.`}
          confirmLabel="Revoke"
          danger
          busy={busy}
          onConfirm={revoke}
          onClose={() => setRevoking(null)}
        />
      )}

      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
