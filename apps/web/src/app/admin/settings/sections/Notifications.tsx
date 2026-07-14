'use client';

import { useEffect, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

/**
 * Notification event-by-channel matrix with default read-only preview.
 * The fully editable preference matrix will be connected with the inbox work.
 */
type ChannelKey = 'in_app' | 'email' | 'push';

const CHANNELS: Array<{ key: ChannelKey; label: string }> = [
  { key: 'in_app', label: 'In-app' },
  { key: 'email', label: 'Email' },
  { key: 'push', label: 'Push' },
];

interface EventPreference {
  template: string;
  label: string;
  description: string;
  values: Record<ChannelKey, boolean>;
  lockedChannels: ChannelKey[];
}

interface PreferencesResponse {
  events: EventPreference[];
}

export default function Notifications() {
  const [events, setEvents] = useState<EventPreference[]>([]);
  const [saving, setSaving] = useState('');
  const [error, setError] = useState('');

  async function load() {
    try {
      const res = await api.get<PreferencesResponse>('/me/notification-preferences');
      setEvents(res.events);
    } catch (e) {
      setError(String((e as ApiError).message));
    }
  }

  useEffect(() => { void load(); }, []);

  function toPreferences(rows: EventPreference[]) {
    return Object.fromEntries(rows.map((row) => [row.template, row.values]));
  }

  async function toggle(template: string, channel: ChannelKey) {
    const next = events.map((row) =>
      row.template === template
        ? { ...row, values: { ...row.values, [channel]: !row.values[channel] } }
        : row,
    );
    setEvents(next);
    setSaving(`${template}:${channel}`);
    setError('');
    try {
      const res = await api.post<PreferencesResponse>('/me/notification-preferences', {
        preferences: toPreferences(next),
      });
      setEvents(res.events);
    } catch (e) {
      setError(String((e as ApiError).message));
      await load();
    } finally {
      setSaving('');
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-3 md:grid-cols-3">
        <Stat label="Delivery" value="Transactional outbox" hint="At-least-once with retry & backoff" />
        <Stat label="Email transport" value="SMTP / provider" hint="Pluggable adapter (env-selected)" />
        <Stat label="Mobile push" value="Expo" hint="Per-device tokens" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Event routing</CardTitle>
          <CardDescription>
            Per-account delivery preferences for supported notification events.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {error && (
            <Alert variant="destructive">
              <AlertCircle />
              <AlertTitle>Notification preferences could not be saved</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Event</TableHead>
                <TableHead>Purpose</TableHead>
                {CHANNELS.map((c) => (
                  <TableHead key={c.key} className="text-center">{c.label}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {events.map((e) => (
                <TableRow key={e.template}>
                  <TableCell className="font-medium">{e.label}</TableCell>
                  <TableCell className="max-w-[360px] whitespace-normal text-muted-foreground">
                    {e.description}
                  </TableCell>
                  {CHANNELS.map((channel) => {
                    const locked = e.lockedChannels.includes(channel.key);
                    const key = `${e.template}:${channel.key}`;
                    const disabled = locked || saving === key;
                    const on = e.values[channel.key];
                    return (
                      <TableCell
                        key={channel.key}
                        className="text-center"
                      >
                        <Switch
                          size="sm"
                          checked={on}
                          disabled={disabled}
                          aria-label={`${e.label} ${channel.label}`}
                          title={locked ? 'Required for this event' : undefined}
                          onCheckedChange={() => void toggle(e.template, channel.key)}
                        />
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
              {events.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-muted-foreground">
                    Loading preferences...
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle>{value}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="truncate text-sm text-muted-foreground" title={hint}>{hint}</p>
      </CardContent>
    </Card>
  );
}
