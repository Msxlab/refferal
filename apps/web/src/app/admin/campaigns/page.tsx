'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { Confirm, Loading, Modal, useToast } from '@/components/ui';
import { Drawer } from '@/components/Drawer';
import { activeMembership, getSession, isAdminRole } from '@/lib/auth';
import { dateShort, money } from '@/lib/format';
import { t } from '@/lib/i18n';

type Metric = 'revenue' | 'sales_count' | 'new_recruits' | 'invites';
type Status = 'draft' | 'active' | 'ended';
interface Prize { rank: number; bonusCents: number }
interface Campaign {
  id: string; name: string; description: string | null; metric: Metric;
  startsAt: string; endsAt: string; status: Status; prizes: Prize[];
  finalizedAt: string | null; createdAt: string;
}
interface Standing { rank: number; membershipId: string; name: string; code: string; score: number; bonusCents: number; inactive?: boolean }
interface CampaignDetail extends Campaign { standings: Standing[] }

const METRICS: Record<Metric, string> = {
  revenue: 'Revenue', sales_count: 'Sales count', new_recruits: 'New recruits', invites: 'Invites',
};
function scoreLabel(metric: Metric, score: number): string {
  return metric === 'revenue' ? money(score) : score.toLocaleString('en-US');
}
function dtLocal(iso?: string): string {
  // ISO → datetime-local input degeri (YYYY-MM-DDTHH:mm), yerel saat
  const d = iso ? new Date(iso) : new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function CampaignsPage() {
  const [list, setList] = useState<Campaign[] | null>(null);
  const [error, setError] = useState('');
  const [toast, showToast] = useToast();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Campaign | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);

  const role = (() => { const s = getSession(); return s ? activeMembership(s)?.role : undefined; })();
  const isAdmin = isAdminRole(role);

  const load = useCallback(async () => {
    try { setList(await api.get<Campaign[]>('/admin/campaigns')); }
    catch (e) { setError(String((e as ApiError).message)); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  return (
    <div>
      <div className="spread">
        <div>
          <div className="eyebrow fade-in">{t('nav.campaigns')}</div>
          <h1 className="h1 fade-in">Campaigns &amp; Contests</h1>
          <p className="sub fade-in">Time-boxed contests with live leaderboards and end-of-campaign bonuses.</p>
        </div>
        {isAdmin && <button className="btn fade-in" onClick={() => { setEditing(null); setShowForm(true); }}>＋ New campaign</button>}
      </div>

      {error && <div className="error">{error}</div>}

      {!list ? <Loading rows={3} /> : list.length === 0 ? (
        <div className="card fade-in delay-1 muted">No campaigns yet. {isAdmin ? 'Create one to start a contest.' : ''}</div>
      ) : (
        <div className="grid fade-in delay-1" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
          {list.map((c) => {
            const topPrize = c.prizes.reduce((a, p) => Math.max(a, p.bonusCents), 0);
            return (
              <button key={c.id} className="card hover" onClick={() => setDetailId(c.id)} style={{ textAlign: 'left', cursor: 'pointer' }}>
                <div className="spread" style={{ marginBottom: 8 }}>
                  <span className="row" style={{ gap: 6 }}>
                    <span className={`badge ${c.status === 'active' ? 'active' : c.status === 'ended' ? 'paid' : 'draft'}`}>{c.status}</span>
                    {c.status === 'active' && new Date(c.endsAt) < new Date() && <span className="badge requested" title="The window has ended — finalize to pay bonuses">⏳ needs finalization</span>}
                  </span>
                  <span className="faint" style={{ fontSize: 11 }}>{METRICS[c.metric]}</span>
                </div>
                <div style={{ fontWeight: 700, fontSize: 15 }}>{c.name}</div>
                <div className="faint" style={{ fontSize: 12, marginTop: 4 }}>{dateShort(c.startsAt)} → {dateShort(c.endsAt)}</div>
                {(() => {
                  const start = new Date(c.startsAt).getTime(), end = new Date(c.endsAt).getTime(), now = Date.now();
                  const pct = end > start ? Math.max(0, Math.min(100, ((now - start) / (end - start)) * 100)) : 100;
                  const daysLeft = Math.ceil((end - now) / 86400000);
                  if (c.status === 'ended') return null;
                  return (
                    <div style={{ marginTop: 8 }}>
                      <div style={{ height: 5, borderRadius: 4, background: 'rgba(255,255,255,.07)', overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${pct}%`, borderRadius: 4, background: daysLeft <= 0 ? 'var(--amber)' : 'var(--grad-primary)' }} />
                      </div>
                      <div className="faint" style={{ fontSize: 10.5, marginTop: 3 }}>{now < start ? 'Not started yet' : daysLeft > 0 ? `${daysLeft} day${daysLeft === 1 ? '' : 's'} left` : 'Window ended'}</div>
                    </div>
                  );
                })()}
                <div className="row" style={{ gap: 12, marginTop: 12 }}>
                  <span className="tnum" style={{ fontSize: 13 }}><b>{c.prizes.length}</b> <span className="faint">prizes</span></span>
                  {topPrize > 0 && <span className="tnum" style={{ fontSize: 13, color: 'var(--gold-500)' }}>up to {money(topPrize)}</span>}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {showForm && (
        <CampaignForm
          existing={editing}
          onClose={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); showToast(editing ? 'Campaign updated' : 'Campaign created'); void load(); }}
          onError={setError}
        />
      )}

      {detailId && (
        <CampaignDrawer
          id={detailId}
          isAdmin={isAdmin}
          onClose={() => setDetailId(null)}
          onChanged={load}
          onEdit={(c) => { setDetailId(null); setEditing(c); setShowForm(true); }}
          onToast={showToast}
        />
      )}

      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}

/* --------------------------------------------------- olustur / duzenle */
function CampaignForm({ existing, onClose, onSaved, onError }: {
  existing: Campaign | null; onClose: () => void; onSaved: () => void; onError: (m: string) => void;
}) {
  const [name, setName] = useState(existing?.name ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [metric, setMetric] = useState<Metric>(existing?.metric ?? 'revenue');
  const [startsAt, setStartsAt] = useState(dtLocal(existing?.startsAt));
  const [endsAt, setEndsAt] = useState(dtLocal(existing?.endsAt ?? new Date(Date.now() + 7 * 86400000).toISOString()));
  const [prizes, setPrizes] = useState<Array<{ rank: number; dollars: string }>>(
    existing?.prizes.length ? existing.prizes.map((p) => ({ rank: p.rank, dollars: (p.bonusCents / 100).toString() })) : [{ rank: 1, dollars: '' }],
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const isDraft = !existing || existing.status === 'draft';

  function addPrize() { setPrizes((p) => [...p, { rank: p.length + 1, dollars: '' }]); }
  function setPrize(i: number, field: 'rank' | 'dollars', v: string) {
    setPrizes((p) => p.map((row, idx) => idx === i ? { ...row, [field]: field === 'rank' ? Number(v) : v } : row));
  }
  function removePrize(i: number) { setPrizes((p) => p.filter((_, idx) => idx !== i)); }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr('');
    const cleanPrizes = prizes
      .map((p) => ({ rank: Number(p.rank), bonusCents: Math.round(parseFloat(p.dollars) * 100) }))
      .filter((p) => p.rank >= 1 && Number.isFinite(p.bonusCents) && p.bonusCents > 0);
    if (new Set(cleanPrizes.map((p) => p.rank)).size !== cleanPrizes.length) { setErr('Each rank can have only one prize.'); return; }
    setBusy(true);
    try {
      const body = { name: name.trim(), description: description.trim() || undefined, metric, startsAt, endsAt, prizes: cleanPrizes };
      if (existing) {
        // aktif kampanyada yalniz ad/aciklama
        const patch = isDraft ? body : { name: body.name, description: body.description };
        await api.patch(`/admin/campaigns/${existing.id}`, patch);
      } else {
        await api.post('/admin/campaigns', body);
      }
      onSaved();
    } catch (e) { setErr(String((e as ApiError).message)); } finally { setBusy(false); }
  }

  return (
    <Modal title={existing ? 'Edit campaign' : 'New campaign'} onClose={onClose}>
      <form onSubmit={submit} style={{ width: 'min(520px, 100%)' }}>
        <div className="field"><label>Name</label><input value={name} onChange={(e) => setName(e.target.value)} required autoFocus placeholder="e.g. Q3 Sales Sprint" /></div>
        <div className="field"><label>Description (optional)</label><input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What is this contest about?" /></div>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
          <div className="field" style={{ margin: 0 }}>
            <label>Metric</label>
            <select aria-label="Campaign metric" value={metric} onChange={(e) => setMetric(e.target.value as Metric)} disabled={!isDraft}>
              {(Object.keys(METRICS) as Metric[]).map((m) => <option key={m} value={m}>{METRICS[m]}</option>)}
            </select>
          </div>
          <div className="field" style={{ margin: 0 }}><label>Starts</label><input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} required disabled={!isDraft} /></div>
          <div className="field" style={{ margin: 0 }}><label>Ends</label><input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} required disabled={!isDraft} /></div>
        </div>

        <div className="field" style={{ marginTop: 6 }}>
          <label>Prizes (bonus paid on finalize)</label>
          {!isDraft && <div className="faint" style={{ fontSize: 11, marginBottom: 6 }}>Metric, dates and prizes are locked once a campaign is active.</div>}
          <div className="grid" style={{ gap: 6 }}>
            {prizes.map((p, i) => (
              <div key={i} className="row" style={{ gap: 8 }}>
                <span className="faint" style={{ fontSize: 12, width: 36 }}>Rank</span>
                <input type="number" min={1} value={p.rank} onChange={(e) => setPrize(i, 'rank', e.target.value)} style={{ width: 70 }} disabled={!isDraft} />
                <span className="faint" style={{ fontSize: 12 }}>$</span>
                <input type="number" step="0.01" min="0" value={p.dollars} onChange={(e) => setPrize(i, 'dollars', e.target.value)} placeholder="bonus" disabled={!isDraft} />
                {isDraft && prizes.length > 1 && <button type="button" className="btn ghost sm" onClick={() => removePrize(i)}>✕</button>}
              </div>
            ))}
          </div>
          {isDraft && <button type="button" className="btn ghost sm" style={{ marginTop: 8 }} onClick={addPrize}>＋ Add prize</button>}
        </div>

        {err && <div className="error">{err}</div>}
        <div className="row" style={{ justifyContent: 'flex-end', gap: 10, marginTop: 14 }}>
          <button type="button" className="btn ghost" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn" disabled={busy}>{busy ? 'Saving…' : existing ? 'Save' : 'Create'}</button>
        </div>
      </form>
    </Modal>
  );
}

/* --------------------------------------------------- detay + liderlik */
function CampaignDrawer({ id, isAdmin, onClose, onChanged, onEdit, onToast }: {
  id: string; isAdmin: boolean; onClose: () => void; onChanged: () => void; onEdit: (c: Campaign) => void; onToast: (m: string) => void;
}) {
  const [d, setD] = useState<CampaignDetail | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmFinalize, setConfirmFinalize] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const load = useCallback(() => {
    setD(null);
    api.get<CampaignDetail>(`/admin/campaigns/${id}`).then(setD).catch((e) => setErr(String((e as ApiError).message)));
  }, [id]);
  useEffect(() => { load(); }, [load]);

  async function finalize() {
    setBusy(true);
    try {
      const res = await api.post<{ awardedCount: number }>(`/admin/campaigns/${id}/finalize`);
      onToast(`Finalized — ${res.awardedCount} bonus${res.awardedCount === 1 ? '' : 'es'} awarded ✓`);
      setConfirmFinalize(false); load(); onChanged();
    } catch (e) { setErr(String((e as ApiError).message)); } finally { setBusy(false); }
  }
  async function activate() {
    setBusy(true);
    try { await api.patch(`/admin/campaigns/${id}`, { status: 'active' }); onToast('Campaign is now live'); load(); onChanged(); }
    catch (e) { setErr(String((e as ApiError).message)); } finally { setBusy(false); }
  }
  async function remove() {
    setBusy(true);
    try { await api.del(`/admin/campaigns/${id}`); onToast('Campaign deleted'); onChanged(); onClose(); }
    catch (e) { setErr(String((e as ApiError).message)); setBusy(false); }
  }

  const totalBonus = d?.prizes.reduce((a, p) => a + p.bonusCents, 0) ?? 0;

  return (
    <Drawer
      title={d ? d.name : 'Campaign'}
      subtitle={d ? `${METRICS[d.metric]} · ${d.status}` : undefined}
      onClose={onClose}
      width={520}
      footer={d && isAdmin && (
        <>
          {d.status === 'draft' && <button className="btn ghost" disabled={busy} onClick={() => onEdit(d)}>Edit</button>}
          {d.status === 'draft' && <button className="btn ghost danger" disabled={busy} onClick={() => setConfirmDelete(true)}>Delete</button>}
          {d.status === 'draft' && <button className="btn" disabled={busy} onClick={activate}>Activate</button>}
          {d.status === 'active' && <button className="btn success" disabled={busy} onClick={() => setConfirmFinalize(true)}>Finalize &amp; pay bonuses</button>}
        </>
      )}
    >
      {err && <div className="error">{err}</div>}
      {!d ? <Loading rows={4} /> : (
        <div className="grid" style={{ gap: 18 }}>
          {d.description && <div className="muted" style={{ fontSize: 13 }}>{d.description}</div>}
          <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <Field label="Window" value={`${dateShort(d.startsAt)} → ${dateShort(d.endsAt)}`} />
            <Field label="Metric" value={METRICS[d.metric]} />
            <Field label="Total prize pool" value={money(totalBonus)} />
            <Field label="Status" value={d.status + (d.finalizedAt ? ` · ${dateShort(d.finalizedAt)}` : '')} />
          </div>

          {d.prizes.length > 0 && (
            <div>
              <strong style={{ fontSize: 13, display: 'block', marginBottom: 8 }}>Prizes</strong>
              <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                {d.prizes.sort((a, b) => a.rank - b.rank).map((p) => (
                  <span key={p.rank} className="badge payable" style={{ fontSize: 12 }}>#{p.rank}: {money(p.bonusCents)}</span>
                ))}
              </div>
            </div>
          )}

          <div>
            <div className="spread" style={{ marginBottom: 8 }}>
              <strong style={{ fontSize: 13 }}>{d.status === 'ended' ? 'Final standings' : 'Live leaderboard'}</strong>
              <span className="faint" style={{ fontSize: 11 }}>{d.standings.length} ranked</span>
            </div>
            {d.standings.length === 0 ? (
              <div className="muted" style={{ fontSize: 13 }}>No qualifying activity in this window yet.</div>
            ) : (
              <table>
                <thead><tr><th style={{ width: 36 }}>#</th><th>Member</th><th style={{ textAlign: 'right' }}>Score</th><th style={{ textAlign: 'right' }}>Bonus</th></tr></thead>
                <tbody>
                  {d.standings.map((s) => (
                    <tr key={s.membershipId}>
                      <td>
                        <span style={{ width: 22, height: 22, borderRadius: 6, display: 'grid', placeItems: 'center', fontSize: 11, fontWeight: 800, background: s.rank === 1 ? 'var(--foil)' : 'var(--panel-2)', color: s.rank === 1 ? 'var(--on-gold)' : 'hsl(var(--muted-foreground))' }}>{s.rank}</span>
                      </td>
                      <td>
                        {s.name}{s.inactive && <span className="badge inactive" style={{ marginLeft: 6, fontSize: 9 }}>inactive</span>}
                        <div className="faint" style={{ fontSize: 11, fontFamily: 'ui-monospace, monospace' }}>{s.code}</div>
                      </td>
                      <td className="tnum" style={{ textAlign: 'right', fontWeight: 650 }}>{scoreLabel(d.metric, s.score)}</td>
                      <td className="tnum" style={{ textAlign: 'right', color: s.bonusCents > 0 ? 'var(--gold-500)' : 'var(--faint)' }}>{s.bonusCents > 0 ? money(s.bonusCents) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {confirmFinalize && d && (
        <Confirm
          title="Finalize campaign"
          message={`This ends "${d.name}" and pays ${money(totalBonus)} in bonuses to the current top ranks. Bonuses become payable immediately and cannot be undone.`}
          confirmLabel="Finalize & pay"
          busy={busy}
          onConfirm={finalize}
          onClose={() => setConfirmFinalize(false)}
        />
      )}
      {confirmDelete && d && (
        <Confirm title="Delete campaign" message={`"${d.name}" will be permanently deleted.`} confirmLabel="Delete" danger busy={busy} onConfirm={remove} onClose={() => setConfirmDelete(false)} />
      )}
    </Drawer>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="faint" style={{ fontSize: 11 }}>{label}</div>
      <div style={{ fontSize: 13.5, marginTop: 2 }}>{value}</div>
    </div>
  );
}
