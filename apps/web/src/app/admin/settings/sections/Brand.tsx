'use client';

import { CSSProperties, useEffect, useState } from 'react';
import { Save } from 'lucide-react';
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
  // User-facing brand palette data (a starting picker value), not admin presentation styling.
  primaryColor: '#D4AF37',
  accentColor: '#5B7CFA',
};

// Shared section heading: display font, consistent size/weight across settings cards.
const SECTION_TITLE: CSSProperties = {
  fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 700, letterSpacing: '-.01em', margin: 0,
};

/**
 * Live preview of the *member portal*, which is intentionally a fixed-dark device
 * mock regardless of the admin theme. Its chrome colours are pinned to the design
 * system's canonical dark HSL triplets (routed through hsl(var(--…)) — no raw hex),
 * exposed as local custom properties the inner mock elements consume.
 */
const PREVIEW_FRAME: CSSProperties = {
  // dark-theme triplets from the design system (single source of truth)
  ['--preview-bg' as string]: 'hsl(230 28% 4%)',
  ['--preview-title' as string]: 'hsl(226 22% 93%)',
  ['--preview-muted' as string]: 'hsl(227 13% 64%)',
  ['--preview-on-brand' as string]: 'hsl(40 80% 6%)',
  background: 'var(--preview-bg)',
  padding: '18px 18px 22px',
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
      <div className="card lift">
        <h2 style={SECTION_TITLE}>Brand identity</h2>
        <div className="faint" style={{ fontSize: 12, marginTop: 4, marginBottom: 12 }}>Shown on the member portal, emails and invitations.</div>

        <div className="field">
          <label>Monogram letter</label>
          <input maxLength={2} value={b.logoText} onChange={(e) => setB({ ...b, logoText: e.target.value })} />
        </div>
        <div className="field">
          <label>Tagline</label>
          <input maxLength={120} value={b.tagline} onChange={(e) => setB({ ...b, tagline: e.target.value })} />
        </div>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 160px), 1fr))', gap: 14 }}>
          <ColorField label="Primary (gold)" value={b.primaryColor} onChange={(v) => setB({ ...b, primaryColor: v })} />
          <ColorField label="Accent (sapphire)" value={b.accentColor} onChange={(v) => setB({ ...b, accentColor: v })} />
        </div>

        {error && <div className="error">{error}</div>}
        <div className="row" style={{ marginTop: 14 }}>
          <button className="btn" onClick={save} disabled={busy} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><Save className="size-4" aria-hidden /> {busy ? 'Saving…' : 'Save branding'}</button>
        </div>
      </div>

      {/* canli onizleme — uye portalinin sabit-koyu cihaz cercevesi (mock) */}
      <div className="card lift" style={{ position: 'sticky', top: 16 }}>
        <div className="faint" style={{ fontSize: 11, marginBottom: 10, letterSpacing: '.08em' }}>PREVIEW</div>
        <div style={{ borderRadius: 14, overflow: 'hidden', border: '1px solid hsl(var(--border))' }}>
          <div style={PREVIEW_FRAME}>
            <div className="row" style={{ gap: 10 }}>
              <span style={{
                width: 34, height: 34, borderRadius: 10, display: 'grid', placeItems: 'center',
                background: `linear-gradient(135deg, ${b.primaryColor}, ${shade(b.primaryColor)})`,
                color: 'var(--preview-on-brand)', fontWeight: 800, fontFamily: 'var(--font-display)', fontSize: 17,
              }}>{(b.logoText || 'R').slice(0, 2)}</span>
              <span style={{ color: 'var(--preview-title)', fontWeight: 800, fontFamily: 'var(--font-display)', fontSize: 17 }}>{name || APP_NAME}</span>
            </div>
            <div style={{ color: 'var(--preview-muted)', fontSize: 12.5, marginTop: 12, lineHeight: 1.5 }}>{b.tagline}</div>
            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <span style={{ flex: 1, height: 34, borderRadius: 9, background: `linear-gradient(135deg, ${b.primaryColor}, ${shade(b.primaryColor)})`, display: 'grid', placeItems: 'center', color: 'var(--preview-on-brand)', fontWeight: 700, fontSize: 12 }}>Get started</span>
              <span style={{ width: 90, height: 34, borderRadius: 9, border: `1px solid ${b.accentColor}`, color: b.accentColor, display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: 12 }}>Invite</span>
            </div>
          </div>
        </div>
        <div className="faint" style={{ fontSize: 11, marginTop: 10, lineHeight: 1.5 }}>
          Colors apply to member-facing surfaces. The admin theme stays Obsidian &amp; Indigo.
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
