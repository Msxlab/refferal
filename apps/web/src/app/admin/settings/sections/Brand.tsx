'use client';

import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { Loading, useToast } from '@/components/ui';
import { APP_NAME } from '@/lib/brand';

interface Branding {
  logoText?: string;
  tagline?: string;
  primaryColor?: string;
  accentColor?: string;
}
interface Settings { name: string; branding: Branding }

const DEFAULTS: Required<Branding> = {
  logoText: 'R',
  tagline: 'Build your network. Earn together.',
  primaryColor: '#D4AF37',
  accentColor: '#5B7CFA',
};

export default function Brand() {
  const [name, setName] = useState('');
  const [b, setB] = useState<Required<Branding> | null>(null);
  const [error, setError] = useState('');
  const [toast, showToast] = useToast();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get<Settings>('/admin/settings').then((s) => {
      setName(s.name);
      setB({ ...DEFAULTS, ...(s.branding ?? {}) });
    }).catch((e) => setError(String((e as ApiError).message)));
  }, []);

  async function save() {
    if (!b) return;
    setBusy(true); setError('');
    try {
      await api.patch('/admin/settings', { branding: b });
      showToast('Branding saved ✓');
    } catch (e) { setError(String((e as ApiError).message)); } finally { setBusy(false); }
  }

  if (error && !b) return <div className="error">{error}</div>;
  if (!b) return <Loading rows={3} />;

  return (
    <div className="grid stack-sm" style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,360px)', gap: 20, alignItems: 'start' }}>
      <div className="card">
        <strong style={{ fontSize: 14 }}>Brand identity</strong>
        <div className="faint" style={{ fontSize: 12, marginBottom: 12 }}>Shown on the member portal, emails and invitations.</div>

        <div className="field">
          <label>Monogram letter</label>
          <input maxLength={2} value={b.logoText} onChange={(e) => setB({ ...b, logoText: e.target.value })} />
        </div>
        <div className="field">
          <label>Tagline</label>
          <input maxLength={120} value={b.tagline} onChange={(e) => setB({ ...b, tagline: e.target.value })} />
        </div>
        <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <ColorField label="Primary (gold)" value={b.primaryColor} onChange={(v) => setB({ ...b, primaryColor: v })} />
          <ColorField label="Accent (sapphire)" value={b.accentColor} onChange={(v) => setB({ ...b, accentColor: v })} />
        </div>

        {error && <div className="error">{error}</div>}
        <div className="row" style={{ marginTop: 14 }}>
          <button className="btn" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save branding'}</button>
        </div>
      </div>

      {/* canli onizleme */}
      <div className="card" style={{ position: 'sticky', top: 16 }}>
        <div className="faint" style={{ fontSize: 11, marginBottom: 10 }}>PREVIEW</div>
        <div style={{ borderRadius: 14, overflow: 'hidden', border: '1px solid hsl(var(--border))' }}>
          <div style={{ background: '#0f1115', padding: '18px 18px 22px' }}>
            <div className="row" style={{ gap: 10 }}>
              <span style={{
                width: 34, height: 34, borderRadius: 10, display: 'grid', placeItems: 'center',
                background: `linear-gradient(135deg, ${b.primaryColor}, ${shade(b.primaryColor)})`,
                color: '#1a1404', fontWeight: 800, fontFamily: 'var(--font-display)', fontSize: 17,
              }}>{(b.logoText || 'R').slice(0, 2)}</span>
              <span style={{ color: '#f4f6fb', fontWeight: 800, fontFamily: 'var(--font-display)', fontSize: 17 }}>{name || APP_NAME}</span>
            </div>
            <div style={{ color: '#9aa3b2', fontSize: 12.5, marginTop: 12, lineHeight: 1.5 }}>{b.tagline}</div>
            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <span style={{ flex: 1, height: 34, borderRadius: 9, background: `linear-gradient(135deg, ${b.primaryColor}, ${shade(b.primaryColor)})`, display: 'grid', placeItems: 'center', color: '#1a1404', fontWeight: 700, fontSize: 12 }}>Get started</span>
              <span style={{ width: 90, height: 34, borderRadius: 9, border: `1px solid ${b.accentColor}`, color: b.accentColor, display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 12 }}>Invite</span>
            </div>
          </div>
        </div>
        <div className="faint" style={{ fontSize: 11, marginTop: 10, lineHeight: 1.5 }}>
          Colors apply to member-facing surfaces. The admin theme stays Obsidian & Champagne.
        </div>
      </div>
    </div>
  );
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="field" style={{ margin: 0 }}>
      <label>{label}</label>
      <div className="row" style={{ gap: 8 }}>
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)} style={{ width: 42, height: 38, padding: 2, cursor: 'pointer' }} />
        <input value={value} onChange={(e) => onChange(e.target.value)} style={{ flex: 1, fontFamily: 'ui-monospace, monospace' }} />
      </div>
    </div>
  );
}

/** Rengi koyulastir (degrade ucu icin) — basit hex karartma. */
function shade(hex: string): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = Math.max(0, ((n >> 16) & 255) - 50);
  const g = Math.max(0, ((n >> 8) & 255) - 60);
  const b = Math.max(0, (n & 255) - 70);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}
