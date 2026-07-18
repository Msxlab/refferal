'use client';

import { FormEvent, useEffect, useState } from 'react';
import { Loading, useToast } from '@/components/ui';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
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
import { api, ApiError } from '@/lib/api';

interface Settings {
  currency: string;
  payoutMinCents: string;
}

const METHODS = [
  { title: 'Manual payout', desc: 'Mark payouts paid after external bank transfer.', state: 'active' },
  { title: 'CSV batch export', desc: 'Download paid payout rows for bank operations.', state: 'active' },
  { title: 'Stripe payout', desc: 'Reserved for a future connected-account integration.', state: 'planned' },
] as const;

export default function Payments() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast, showToast] = useToast();

  useEffect(() => {
    api.get<Settings>('/admin/settings').then(setSettings).catch((e) => setError(String((e as ApiError).message)));
  }, []);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!settings) return;
    setBusy(true);
    setError('');
    try {
      const next = await api.patch<Settings>('/admin/settings', {
        payoutMinCents: Number(settings.payoutMinCents),
      });
      setSettings(next);
      showToast('Payment settings saved');
    } catch (e) {
      setError(String((e as ApiError).message));
    } finally {
      setBusy(false);
    }
  }

  if (error && !settings) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Payment settings unavailable</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }
  if (!settings) return <Loading rows={4} />;

  const payoutMinCents = Number(settings.payoutMinCents);
  const invalidPayoutMin = !Number.isFinite(payoutMinCents) || payoutMinCents < 0;

  return (
    <form className="flex max-w-3xl flex-col gap-5" onSubmit={save}>
      <Card>
        <CardHeader>
          <CardTitle>Payout threshold</CardTitle>
          <CardDescription>Set the minimum payable balance before a payout can be processed.</CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field data-invalid={invalidPayoutMin}>
              <FieldLabel htmlFor="payments-payout-min">Minimum payable balance</FieldLabel>
              <Input
                id="payments-payout-min"
                type="number"
                min={0}
                value={settings.payoutMinCents}
                onChange={(e) => setSettings({ ...settings, payoutMinCents: e.target.value })}
                aria-invalid={invalidPayoutMin}
              />
              <FieldDescription>
                Current threshold: {money(settings.payoutMinCents, settings.currency)}.
              </FieldDescription>
              {invalidPayoutMin && <FieldError>Enter a non-negative amount in cents.</FieldError>}
            </Field>
          </FieldGroup>
        </CardContent>
      </Card>

      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-base font-medium">Payout methods</h2>
          <p className="text-sm text-muted-foreground">Available and planned payout operations for this workspace.</p>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          {METHODS.map((method) => (
            <Card key={method.title} size="sm">
              <CardHeader>
                <CardTitle>{method.title}</CardTitle>
                <CardDescription>{method.desc}</CardDescription>
                <CardAction>
                  <Badge variant={method.state === 'active' ? 'default' : 'secondary'}>
                    {method.state === 'active' ? 'Active' : 'Planned'}
                  </Badge>
                </CardAction>
              </CardHeader>
            </Card>
          ))}
        </div>
      </section>

      {error && (
        <Alert variant="destructive">
          <AlertTitle>Payment settings could not be saved</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div className="flex justify-end">
        <Button type="submit" disabled={busy || invalidPayoutMin}>
          {busy ? 'Saving...' : 'Save payment settings'}
        </Button>
      </div>
      {toast && <div className="toast" role="status">{toast}</div>}
    </form>
  );
}

function money(cents: string, currency: string): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(Number(cents) / 100);
}
