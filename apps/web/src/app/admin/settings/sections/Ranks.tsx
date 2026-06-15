'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { Loading, useToast } from '@/components/ui';

interface Tier { id: string | null; name: string; sortOrder: number; minTeam: number; minEarningsCents: string; overrideBps?: number }
interface RanksResp { isDefault: boolean; tiers: Tier[] }

export default function Ranks() {
  const [data, setData] = useState<RanksResp | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast, showToast] = useToast();

  const load = useCallback(async () => {
    try { setData(await api.get<RanksResp>('/admin/ranks')); } catch (e) { setError(String((e as ApiError).message)); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  // varsayilanlari ozel tier'lara kopyala (duzenlenebilir yap)
  async function customize() {
    if (!data || busy) return;
    setBusy(true);
    try {
      for (const t of data.tiers) {
        await api.post('/admin/ranks', { name: t.name, sortOrder: t.sortOrder, minTeam: t.minTeam, minEarningsCents: Number(t.minEarningsCents), overrideBps: t.overrideBps ?? 0 });
      }
      showToast('Tiers are now editable');
      await load();
    } catch (e) { setError(`Could not save all tiers: ${String((e as ApiError).message)}`); await load(); }
    finally { setBusy(false); }
  }
  async function addTier() {
    const order = (data?.tiers.length ?? 0);
    try { await api.post('/admin/ranks', { name: 'New tier', sortOrder: order, minTeam: 0, minEarningsCents: 0, overrideBps: 0 }); await load(); }
    catch (e) { setError(String((e as ApiError).message)); }
  }
  async function saveTier(t: Tier) {
    try { await api.patch(`/admin/ranks/${t.id}`, { name: t.name, sortOrder: t.sortOrder, minTeam: t.minTeam, minEarningsCents: Number(t.minEarningsCents), overrideBps: t.overrideBps ?? 0 }); showToast('Saved'); }
    catch (e) { setError(String((e as ApiError).message)); }
  }
  async function removeTier(id: string) {
    try { await api.del(`/admin/ranks/${id}`); await load(); } catch (e) { setError(String((e as ApiError).message)); }
  }
  function patch(i: number, field: keyof Tier, value: string | number) {
    setData((d) => d ? { ...d, tiers: d.tiers.map((t, idx) => idx === i ? { ...t, [field]: value } : t) } : d);
  }

  if (error && !data) return <div className="error">{error}</div>;
  if (!data) return <Loading rows={3} />;

  return (
    <div className="card" style={{ maxWidth: 640 }}>
      <div className="spread" style={{ marginBottom: 12 }}>
        <div>
          <strong style={{ fontSize: 14 }}>Career ranks</strong>
          <div className="faint" style={{ fontSize: 12 }}>Tiers by team size + cumulative earnings. Members see their rank and progress. <strong>Override %</strong> = extra bonus the member earns on their own sales at this rank.</div>
        </div>
        {data.isDefault ? <button className="btn ghost sm" onClick={customize} disabled={busy}>{busy ? 'Customizing…' : 'Customize tiers'}</button> : <button className="btn ghost sm" onClick={addTier}>＋ Add tier</button>}
      </div>
      {data.isDefault && <div className="faint" style={{ fontSize: 12, marginBottom: 10 }}>Using built-in defaults. Click “Customize tiers” to edit.</div>}
      <table>
        <thead><tr><th>Name</th><th>Min team</th><th>Min earnings ($)</th><th>Override %</th><th></th></tr></thead>
        <tbody>
          {data.tiers.map((t, i) => (
            <tr key={t.id ?? i}>
              <td><input value={t.name} disabled={data.isDefault} onChange={(e) => patch(i, 'name', e.target.value)} style={{ width: 120 }} /></td>
              <td><input type="number" min={0} value={t.minTeam} disabled={data.isDefault} onChange={(e) => patch(i, 'minTeam', Number(e.target.value))} style={{ width: 90 }} /></td>
              <td><input type="number" min={0} value={Math.round(Number(t.minEarningsCents) / 100)} disabled={data.isDefault} onChange={(e) => patch(i, 'minEarningsCents', String(Number(e.target.value) * 100))} style={{ width: 110 }} /></td>
              <td><input type="number" min={0} max={100} step={0.1} value={(t.overrideBps ?? 0) / 100} disabled={data.isDefault} onChange={(e) => patch(i, 'overrideBps', Math.round(Number(e.target.value) * 100))} style={{ width: 80 }} /></td>
              <td style={{ textAlign: 'right' }}>
                {!data.isDefault && t.id && (
                  <div className="row" style={{ justifyContent: 'flex-end' }}>
                    <button className="btn ghost sm" onClick={() => saveTier(t)}>Save</button>
                    <button className="btn ghost sm danger" onClick={() => removeTier(t.id!)}>✕</button>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
