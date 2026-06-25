'use client';

import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';

/**
 * Bildirim olay × kanal matrisi (varsayilanlar, salt-okunur onizleme).
 * Tam duzenlenebilir tercih matrisi (task #7) gelen-kutusu ile birlikte baglanacak.
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
    <div className="grid" style={{ gap: 18 }}>
      <div className="card" style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
        <Stat label="Delivery" value="Transactional outbox" hint="At-least-once with retry & backoff" />
        <Stat label="Email transport" value="SMTP / provider" hint="Pluggable adapter (env-selected)" />
        <Stat label="Mobile push" value="Expo" hint="Per-device tokens" />
      </div>

      <section>
        <div style={{ marginBottom: 10 }}>
          <strong style={{ fontSize: 15 }}>Event routing</strong>
          <div className="faint" style={{ fontSize: 12 }}>Per-account delivery preferences for supported notification events.</div>
        </div>
        {error && <div className="error" style={{ marginBottom: 10 }}>{error}</div>}
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <table>
            <thead>
              <tr>
                <th>Event</th><th>Purpose</th>
                {CHANNELS.map((c) => <th key={c.key} style={{ textAlign: 'center' }}>{c.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.template}>
                  <td style={{ fontWeight: 600 }}>{e.label}</td>
                  <td className="faint" style={{ fontSize: 12 }}>{e.description}</td>
                  {CHANNELS.map((channel) => {
                    const locked = e.lockedChannels.includes(channel.key);
                    const key = `${e.template}:${channel.key}`;
                    const disabled = locked || saving === key;
                    const on = e.values[channel.key];
                    return (
                      <td
                        key={channel.key}
                        style={{ textAlign: 'center', cursor: disabled ? 'not-allowed' : 'pointer' }}
                        onClick={disabled ? undefined : () => void toggle(e.template, channel.key)}
                      >
                      <span style={{
                        display: 'inline-block', width: 16, height: 16, borderRadius: 5,
                        background: on ? 'var(--emerald)' : 'transparent',
                        border: on ? 'none' : '1.5px solid var(--border-strong)',
                        color: '#fff', fontSize: 11, fontWeight: 900, lineHeight: '16px',
                      }}>{on ? '✓' : ''}</span>
                    </td>
                    );
                  })}
                </tr>
              ))}
              {events.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted">Loading preferences...</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div style={{ flex: 1, minWidth: 160 }}>
      <div className="faint" style={{ fontSize: 11 }}>{label}</div>
      <div style={{ fontWeight: 700, fontSize: 14, marginTop: 3 }}>{value}</div>
      <div className="faint" style={{ fontSize: 11, marginTop: 2 }}>{hint}</div>
    </div>
  );
}
