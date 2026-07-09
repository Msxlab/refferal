'use client';

import { FormEvent, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { Modal } from '@/components/ui';

export interface OnboardingWizardProps {
  onClose: () => void;
  onCreated: (company: { id: string; name: string; slug: string }) => void;
}

type Step = 1 | 2 | 3 | 4;

interface BillingPackage {
  id: string;
  key: string;
  name: string;
  monthlyFeeCents: string;
  features: unknown;
  limits: unknown;
  active: boolean;
}

const HEX = /^#[0-9a-fA-F]{6}$/;

function slugify(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}

const STEP_LABELS: Record<Step, string> = {
  1: 'Company',
  2: 'Plan',
  3: 'Branding',
  4: 'Owner',
};

/**
 * 4-step onboarding wizard (item 2 UI): company → plan/package → branding → invite owner.
 * All fields are collected locally and submitted in one `POST /platform/companies` call at the
 * end; billing package assignment and branding are applied afterward, best-effort/non-fatal.
 * Replaces the single-screen NewCompanyModal from Task 13.
 */
export function OnboardingWizard({ onClose, onCreated }: OnboardingWizardProps) {
  const [step, setStep] = useState<Step>(1);
  const [busy, setBusy] = useState(false);

  // Step 1: company
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [currency, setCurrency] = useState('USD');
  const [timezone, setTimezone] = useState('America/New_York');
  const [slugError, setSlugError] = useState('');

  // Step 2: plan/package
  const [packages, setPackages] = useState<BillingPackage[] | null>(null);
  const [packagesError, setPackagesError] = useState('');
  const [packageId, setPackageId] = useState('');

  // Step 3: branding
  const [logoUrl, setLogoUrl] = useState('');
  const [primaryHex, setPrimaryHex] = useState('');
  const [accentHex, setAccentHex] = useState('');
  const [brandingError, setBrandingError] = useState('');

  // Step 4: invite owner
  const [ownerName, setOwnerName] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [submitError, setSubmitError] = useState('');

  const effSlug = slugTouched ? slug : slugify(name);

  useEffect(() => {
    if (step !== 2 || packages !== null) return;
    api
      .get<BillingPackage[]>('/platform/packages')
      .then((rows) => {
        const active = rows.filter((p) => p.active);
        setPackages(active);
        if (active.length > 0) setPackageId((cur) => cur || active[0].id);
      })
      .catch((e) => setPackagesError(String((e as ApiError).message)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  function goToStep2(e: FormEvent) {
    e.preventDefault();
    setSlugError('');
    setStep(2);
  }

  function goToStep3(e: FormEvent) {
    e.preventDefault();
    setStep(3);
  }

  function goToStep4(e: FormEvent) {
    e.preventDefault();
    setBrandingError('');
    if (logoUrl.trim() && !/^https:\/\//.test(logoUrl.trim())) {
      setBrandingError('Logo URL must start with https://');
      return;
    }
    if (primaryHex.trim() && !HEX.test(primaryHex.trim())) {
      setBrandingError('Primary color must be a valid #hex (e.g. #1a2b3c)');
      return;
    }
    if (accentHex.trim() && !HEX.test(accentHex.trim())) {
      setBrandingError('Accent color must be a valid #hex (e.g. #1a2b3c)');
      return;
    }
    setStep(4);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setSubmitError('');
    try {
      const created = await api.post<{ id: string; slug: string; name: string; ownerEmail: string; ownerExisting: boolean; tempPassword: string | null }>(
        '/platform/companies',
        {
          name: name.trim(),
          slug: effSlug,
          currency,
          timezone,
          ownerEmail: ownerEmail.trim(),
          ownerName: ownerName.trim(),
        },
      );

      // Best-effort, non-fatal follow-ups: billing package assignment (config draft) + branding.
      if (packageId) {
        try {
          await api.put(`/platform/companies/${created.id}/billing`, { packageId, active: false });
        } catch {
          /* best-effort: onboarding still succeeds without billing config */
        }
      }
      if (logoUrl.trim() || primaryHex.trim() || accentHex.trim()) {
        try {
          await api.put(`/platform/companies/${created.id}/branding`, {
            logoUrl: logoUrl.trim() || undefined,
            primaryHex: primaryHex.trim() || undefined,
            accentHex: accentHex.trim() || undefined,
          });
        } catch {
          /* best-effort: onboarding still succeeds without branding */
        }
      }

      onCreated({ id: created.id, name: created.name, slug: created.slug });
      onClose();
    } catch (err) {
      const apiErr = err as ApiError;
      if (apiErr.status === 409) {
        setSlugError(String(apiErr.message));
        setStep(1);
      } else {
        setSubmitError(String(apiErr.message));
      }
      setBusy(false);
    }
  }

  return (
    <Modal title="New company" onClose={onClose}>
      <div className="row faint" style={{ gap: 10, marginBottom: 16, fontSize: 12 }}>
        {([1, 2, 3, 4] as Step[]).map((s, i) => (
          <span key={s} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontWeight: step === s ? 800 : 500, color: step === s ? 'var(--text)' : undefined }}>
              {s}. {STEP_LABELS[s]}
            </span>
            {i < 3 && <span aria-hidden="true">→</span>}
          </span>
        ))}
      </div>

      {step === 1 && (
        <form onSubmit={goToStep2}>
          <div className="field">
            <label>Company name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} required autoFocus placeholder="Acme Rewards" />
          </div>
          <div className="field">
            <label>Slug (URL id)</label>
            <input value={effSlug} onChange={(e) => { setSlugTouched(true); setSlug(e.target.value); }} required placeholder="acme-rewards" />
          </div>
          <div className="row" style={{ gap: 10 }}>
            <div className="field" style={{ flex: 1 }}>
              <label>Currency</label>
              <input value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} maxLength={3} />
            </div>
            <div className="field" style={{ flex: 2 }}>
              <label>Timezone</label>
              <input value={timezone} onChange={(e) => setTimezone(e.target.value)} />
            </div>
          </div>
          {slugError && <div className="error">{slugError}</div>}
          <div className="row" style={{ justifyContent: 'flex-end', marginTop: 16, gap: 8 }}>
            <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
            <button className="btn">Next</button>
          </div>
        </form>
      )}

      {step === 2 && (
        <form onSubmit={goToStep3}>
          <div className="field">
            <label>Package</label>
            {packagesError ? (
              <div className="error">{packagesError}</div>
            ) : packages === null ? (
              <div className="faint" style={{ fontSize: 13 }}>Loading packages…</div>
            ) : packages.length === 0 ? (
              <div className="faint" style={{ fontSize: 13 }}>No active packages configured — you can assign one later from company settings.</div>
            ) : (
              <select value={packageId} onChange={(e) => setPackageId(e.target.value)}>
                {packages.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} — {(Number(p.monthlyFeeCents) / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })}/mo
                  </option>
                ))}
              </select>
            )}
          </div>
          <div className="row" style={{ justifyContent: 'flex-end', marginTop: 16, gap: 8 }}>
            <button type="button" className="btn ghost" onClick={() => setStep(1)}>Back</button>
            <button className="btn">Next</button>
          </div>
        </form>
      )}

      {step === 3 && (
        <form onSubmit={goToStep4}>
          <div className="field">
            <label>Logo URL (https)</label>
            <input value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} placeholder="https://cdn.example.com/logo.png" />
          </div>
          <div className="row" style={{ gap: 10 }}>
            <div className="field" style={{ flex: 1 }}>
              <label>Primary color</label>
              <input value={primaryHex} onChange={(e) => setPrimaryHex(e.target.value)} placeholder="#1a2b3c" />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label>Accent color</label>
              <input value={accentHex} onChange={(e) => setAccentHex(e.target.value)} placeholder="#d4af37" />
            </div>
          </div>
          {brandingError && <div className="error">{brandingError}</div>}
          <div className="row" style={{ justifyContent: 'flex-end', marginTop: 16, gap: 8 }}>
            <button type="button" className="btn ghost" onClick={() => setStep(2)}>Back</button>
            <button className="btn">Next</button>
          </div>
        </form>
      )}

      {step === 4 && (
        <form onSubmit={submit}>
          <div className="field">
            <label>Owner full name</label>
            <input value={ownerName} onChange={(e) => setOwnerName(e.target.value)} required placeholder="Jane Doe" />
          </div>
          <div className="field">
            <label>Owner email</label>
            <input type="email" value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} required placeholder="owner@acme.com" />
          </div>
          <p className="muted" style={{ fontSize: 13 }}>An invite email will be sent to the owner to set their password.</p>
          {submitError && <div className="error">{submitError}</div>}
          <div className="row" style={{ justifyContent: 'flex-end', marginTop: 16, gap: 8 }}>
            <button type="button" className="btn ghost" onClick={() => setStep(3)} disabled={busy}>Back</button>
            <button className="btn" disabled={busy}>{busy ? 'Creating…' : 'Create company'}</button>
          </div>
        </form>
      )}
    </Modal>
  );
}
