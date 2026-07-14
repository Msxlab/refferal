'use client';

import { type CSSProperties, useEffect, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { Loading, useToast } from '@/components/ui';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { APP_NAME, normalizeRuntimeBrand, type RuntimeBrand } from '@/lib/brand';

interface Branding {
  logoText?: string;
  tagline?: string;
  primaryColor?: string;
  accentColor?: string;
}
interface Settings { name: string; branding: Branding }

const DEFAULTS: Required<Branding> = {
  logoText: 'A',
  tagline: 'Grow your referral network. Earn from real product sales.',
  primaryColor: '#384BB8',
  accentColor: '#6F7ACA',
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
      setB(normalizeBrandingState(s.branding));
    }).catch((e) => setError(String((e as ApiError).message)));
  }, []);

  async function save() {
    if (!b) return;
    setBusy(true); setError('');
    try {
      const branding = normalizeBrandingState(b);
      const next = await api.patch<Settings>('/admin/settings', { name: name.trim(), branding });
      setName(next.name);
      setB(normalizeBrandingState(next.branding));
      showToast('Branding saved');
    } catch (e) { setError(String((e as ApiError).message)); } finally { setBusy(false); }
  }

  if (error && !b) {
    return (
      <Alert variant="destructive">
        <AlertCircle />
        <AlertTitle>Brand settings could not be loaded</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }
  if (!b) return <Loading rows={3} />;

  const previewBrand = normalizeRuntimeBrand({
    name: name || APP_NAME,
    monogram: b.logoText,
    tagline: b.tagline,
    primaryColor: b.primaryColor,
    accentColor: b.accentColor,
  });
  const invalidPrimary = !isHexColor(b.primaryColor);
  const invalidAccent = !isHexColor(b.accentColor);
  const hasInvalidColor = invalidPrimary || invalidAccent;
  const invalidName = name.trim().length < 2;

  return (
    <div className="settings-brand-grid">
      <Card>
        <CardHeader>
          <CardTitle>Brand identity</CardTitle>
          <CardDescription>
            Shown on the member portal, invitation pages and member-facing notifications.
          </CardDescription>
        </CardHeader>

        <CardContent>
          <FieldGroup>
            <Field data-invalid={invalidName}>
              <FieldLabel htmlFor="brand-name">Business name</FieldLabel>
              <Input
                id="brand-name"
                maxLength={80}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={APP_NAME}
                aria-invalid={invalidName}
              />
              <FieldDescription>This is the public company name members and invitees see.</FieldDescription>
              {invalidName && <FieldError>Business name must be at least 2 characters.</FieldError>}
            </Field>

            <Field>
              <FieldLabel htmlFor="brand-monogram">Monogram</FieldLabel>
              <Input
                id="brand-monogram"
                maxLength={2}
                value={b.logoText}
                onChange={(e) => setB({ ...b, logoText: e.target.value.toUpperCase().slice(0, 2) })}
                placeholder="A"
              />
              <FieldDescription>One or two letters. Used when no logo image is configured.</FieldDescription>
            </Field>

            <Field>
              <FieldLabel htmlFor="brand-tagline">Tagline</FieldLabel>
              <Textarea
                id="brand-tagline"
                maxLength={120}
                rows={3}
                value={b.tagline}
                onChange={(e) => setB({ ...b, tagline: e.target.value })}
              />
            </Field>

            <FieldGroup className="grid gap-4 md:grid-cols-2">
              <ColorField
                id="brand-primary"
                label="Primary color"
                value={b.primaryColor}
                invalid={invalidPrimary}
                onChange={(v) => setB({ ...b, primaryColor: v })}
              />
              <ColorField
                id="brand-accent"
                label="Accent color"
                value={b.accentColor}
                invalid={invalidAccent}
                onChange={(v) => setB({ ...b, accentColor: v })}
              />
            </FieldGroup>

            {hasInvalidColor && <FieldError>Use a valid 6-digit hex color, for example #384BB8.</FieldError>}
            {error && <FieldError>{error}</FieldError>}
          </FieldGroup>
        </CardContent>

        <CardFooter className="justify-end">
          <Button type="button" onClick={save} disabled={busy || invalidName || hasInvalidColor}>
            {busy ? 'Saving...' : 'Save branding'}
          </Button>
        </CardFooter>
      </Card>

      <Card className="settings-brand-preview">
        <CardHeader>
          <CardTitle>Live preview</CardTitle>
          <CardDescription>
            Member-facing surfaces use these colors while the admin workspace stays neutral.
          </CardDescription>
          <CardAction>
            <Badge variant="secondary">Preview</Badge>
          </CardAction>
        </CardHeader>

        <CardContent>
          <BrandPreview brand={previewBrand} />
        </CardContent>
      </Card>
    </div>
  );
}

function ColorField({
  id,
  label,
  value,
  invalid,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  invalid: boolean;
  onChange: (v: string) => void;
}) {
  const colorValue = isHexColor(value) ? value : '#000000';
  return (
    <Field data-invalid={invalid}>
      <FieldLabel htmlFor={`${id}-hex`}>{label}</FieldLabel>
      <div className="flex gap-2">
        <Input
          type="color"
          value={colorValue}
          onChange={(e) => onChange(e.target.value)}
          aria-label={`${label} picker`}
          className="size-8 shrink-0 p-1"
        />
        <Input
          id={`${id}-hex`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={invalid}
        />
      </div>
      {invalid && <FieldError>Use #RRGGBB format.</FieldError>}
    </Field>
  );
}

function BrandPreview({ brand }: { brand: RuntimeBrand }) {
  const vars = {
    '--preview-primary': brand.primaryColor,
    '--preview-accent': brand.accentColor,
  } as CSSProperties;

  return (
    <div style={vars}>
      <div style={{ borderRadius: 14, overflow: 'hidden', border: '1px solid var(--border)', background: 'var(--bg-1)' }}>
        <div style={{ padding: '16px 16px 14px', borderBottom: '1px solid var(--border)' }}>
          <div className="row" style={{ gap: 10 }}>
            <BrandMark brand={brand} />
            <div style={{ minWidth: 0 }}>
              <div style={{ color: 'var(--text)', fontWeight: 800, fontFamily: 'var(--font-display)', fontSize: 16 }}>{brand.name}</div>
              <div className="faint" style={{ fontSize: 11 }}>Member portal</div>
            </div>
          </div>
          <div style={{ color: 'var(--muted)', fontSize: 12.5, marginTop: 12, lineHeight: 1.5 }}>{brand.tagline}</div>
        </div>

        <div style={{ padding: 16 }}>
          <div className="spread" style={{ marginBottom: 12 }}>
            <div>
              <div className="faint" style={{ fontSize: 11 }}>Invite card</div>
              <div style={{ fontWeight: 750 }}>Active invitation</div>
            </div>
            <Badge variant="secondary">Live</Badge>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <span style={{ flex: 1, minHeight: 36, borderRadius: 9, border: '1px solid var(--preview-primary)', background: 'var(--panel-2)', display: 'grid', placeItems: 'center', color: 'var(--text)', fontWeight: 750, fontSize: 12 }}>Create account</span>
            <span style={{ minWidth: 92, minHeight: 36, borderRadius: 9, border: '1px solid var(--preview-accent)', color: 'var(--preview-accent)', display: 'grid', placeItems: 'center', fontWeight: 750, fontSize: 12 }}>Invite</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function BrandMark({ brand }: { brand: RuntimeBrand }) {
  return (
    <span
      style={{
        width: 36,
        height: 36,
        borderRadius: 11,
        display: 'grid',
        placeItems: 'center',
        border: '2px solid var(--preview-primary)',
        background: 'var(--panel-2)',
        color: 'var(--text)',
        fontWeight: 800,
        fontFamily: 'var(--font-display)',
        fontSize: 17,
        flex: '0 0 auto',
      }}
    >
      {brand.monogram}
    </span>
  );
}

function isHexColor(value: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(value);
}

function normalizeBrandingState(branding: Branding | null | undefined): Required<Branding> {
  const logoText = typeof branding?.logoText === 'string' ? branding.logoText.trim().toUpperCase().slice(0, 2) : '';
  const tagline = typeof branding?.tagline === 'string' ? branding.tagline.trim() : '';
  const primaryColor = typeof branding?.primaryColor === 'string' && isHexColor(branding.primaryColor)
    ? branding.primaryColor.toUpperCase()
    : DEFAULTS.primaryColor;
  const accentColor = typeof branding?.accentColor === 'string' && isHexColor(branding.accentColor)
    ? branding.accentColor.toUpperCase()
    : DEFAULTS.accentColor;
  return {
    logoText: logoText || DEFAULTS.logoText,
    tagline: tagline || DEFAULTS.tagline,
    primaryColor,
    accentColor,
  };
}
