'use client';

import { FormEvent, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { Loading, useToast } from '@/components/ui';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';

interface Settings {
  name: string;
  slug: string;
  currency: string;
  timezone: string;
  maturationRule: 'on_approval' | 'on_delivery' | 'days_after_approval';
  maturationDays: number | null;
  payoutMinCents: string;
  notifyNewMemberName: boolean;
  compressionEnabled: boolean;
  inactiveMembersEarn: boolean;
  requireSeparateApprover: boolean;
}

const MATURATION = [
  { value: 'on_approval', label: 'On approval - payable immediately' },
  { value: 'on_delivery', label: 'On delivery - matures after delivery' },
  { value: 'days_after_approval', label: 'Days after approval' },
] satisfies Array<{
  value: Settings['maturationRule'];
  label: string;
}>;

const POLICY_FIELDS = [
  {
    id: 'require-separate-approver',
    title: 'Separation of duties',
    description: 'The seller cannot approve their own sale.',
    key: 'requireSeparateApprover',
  },
  {
    id: 'notify-new-member-name',
    title: 'Show member name in join notifications',
    description: 'Include the member name in admin-facing join alerts.',
    key: 'notifyNewMemberName',
  },
  {
    id: 'inactive-members-earn',
    title: 'Inactive members keep earning commissions',
    description: 'When enabled, inactive uplines remain eligible for commissions.',
    key: 'inactiveMembersEarn',
  },
] satisfies Array<{
  id: string;
  title: string;
  description: string;
  key: 'requireSeparateApprover' | 'notifyNewMemberName' | 'inactiveMembersEarn';
}>;

const TIMEZONES = [
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'America/Phoenix', 'America/Anchorage', 'Pacific/Honolulu',
];

export default function General() {
  const [s, setS] = useState<Settings | null>(null);
  const [error, setError] = useState('');
  const [toast, showToast] = useToast();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get<Settings>('/admin/settings').then(setS).catch((e) => setError(String((e as ApiError).message)));
  }, []);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!s) return;
    setBusy(true); setError('');
    try {
      const res = await api.patch<Settings>('/admin/settings', {
        maturationRule: s.maturationRule,
        maturationDays: s.maturationRule === 'days_after_approval' ? Number(s.maturationDays ?? 0) : null,
        timezone: s.timezone,
        notifyNewMemberName: s.notifyNewMemberName,
        compressionEnabled: s.inactiveMembersEarn ? false : s.compressionEnabled,
        inactiveMembersEarn: s.inactiveMembersEarn,
        requireSeparateApprover: s.requireSeparateApprover,
      });
      setS(res);
      showToast('Settings saved');
    } catch (e) { setError(String((e as ApiError).message)); } finally { setBusy(false); }
  }

  if (error && !s) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Settings unavailable</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }
  if (!s) return <Loading rows={4} />;

  const maturationDays = Number(s.maturationDays ?? 0);
  const invalidMaturationDays = s.maturationRule === 'days_after_approval' && (maturationDays < 0 || maturationDays > 365);
  const timezones = TIMEZONES.includes(s.timezone) ? TIMEZONES : [s.timezone, ...TIMEZONES];

  return (
    <form className="flex max-w-3xl flex-col gap-5" onSubmit={save}>
      <Card>
        <CardHeader>
          <CardTitle>Workspace</CardTitle>
          <CardDescription>Core workspace identity and regional settings.</CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup className="grid gap-4 md:grid-cols-2">
            <Read id="general-name" label="Business name" value={s.name} />
            <Read id="general-slug" label="Workspace slug" value={s.slug} />
            <Read id="general-currency" label="Currency" value={s.currency} />

            <Field>
              <FieldLabel htmlFor="general-timezone">Time zone</FieldLabel>
              <Select value={s.timezone} onValueChange={(timezone: string) => setS({ ...s, timezone })}>
                <SelectTrigger id="general-timezone" className="w-full">
                  <SelectValue placeholder="Select a time zone" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {timezones.map((tz) => (
                      <SelectItem key={tz} value={tz}>{tz}</SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
          </FieldGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Commissions</CardTitle>
          <CardDescription>Control when approved commission becomes payable.</CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="general-maturation-rule">Commission maturation rule</FieldLabel>
              <Select
                value={s.maturationRule}
                onValueChange={(maturationRule: Settings['maturationRule']) => setS({ ...s, maturationRule })}
              >
                <SelectTrigger id="general-maturation-rule" className="w-full">
                  <SelectValue placeholder="Select a rule" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {MATURATION.map((m) => (
                      <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>

            {s.maturationRule === 'days_after_approval' && (
              <Field data-invalid={invalidMaturationDays}>
                <FieldLabel htmlFor="general-maturation-days">Days after approval</FieldLabel>
                <Input
                  id="general-maturation-days"
                  type="number"
                  min={0}
                  max={365}
                  value={s.maturationDays ?? 0}
                  onChange={(e) => setS({ ...s, maturationDays: Number(e.target.value) })}
                  aria-invalid={invalidMaturationDays}
                />
                <FieldDescription>Enter a value from 0 to 365 days.</FieldDescription>
                {invalidMaturationDays && <FieldError>Days must be between 0 and 365.</FieldError>}
              </Field>
            )}

            <Read
              id="general-payout-threshold"
              label="Payout threshold"
              value={money(s.payoutMinCents, s.currency)}
              description="Configured by platform-level payout policy."
            />
          </FieldGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Policy & privacy</CardTitle>
          <CardDescription>Operational safeguards for sale approval, notifications and inactive uplines.</CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            {POLICY_FIELDS.map((field) => (
              <SettingSwitch
                key={field.id}
                id={field.id}
                title={field.title}
                description={field.description}
                checked={s[field.key]}
                onCheckedChange={(checked) => {
                  if (field.key === 'inactiveMembersEarn') {
                    setS({ ...s, inactiveMembersEarn: checked, compressionEnabled: checked ? false : s.compressionEnabled });
                    return;
                  }
                  setS({ ...s, [field.key]: checked });
                }}
              />
            ))}

            {!s.inactiveMembersEarn && (
              <SettingSwitch
                id="compression-enabled"
                title="Compression"
                description="Skip inactive uplines when calculating eligible commission recipients."
                checked={s.compressionEnabled}
                onCheckedChange={(compressionEnabled) => setS({ ...s, compressionEnabled })}
              />
            )}
          </FieldGroup>
        </CardContent>
      </Card>

      {error && (
        <Alert variant="destructive">
          <AlertTitle>Settings could not be saved</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="flex justify-end">
        <Button type="submit" disabled={busy || invalidMaturationDays}>
          {busy ? 'Saving...' : 'Save changes'}
        </Button>
      </div>
      {toast && <div className="toast" role="status">{toast}</div>}
    </form>
  );
}

function Read({ id, label, value, description }: { id: string; label: string; value: string; description?: string }) {
  return (
    <Field data-disabled>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input id={id} value={value} readOnly disabled />
      {description && <FieldDescription>{description}</FieldDescription>}
    </Field>
  );
}

function SettingSwitch({
  id,
  title,
  description,
  checked,
  onCheckedChange,
}: {
  id: string;
  title: string;
  description: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <Field orientation="horizontal">
      <FieldContent>
        <FieldLabel htmlFor={id}>{title}</FieldLabel>
        <FieldDescription>{description}</FieldDescription>
      </FieldContent>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} />
    </Field>
  );
}

function money(cents: string, currency: string): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(Number(cents) / 100);
}
