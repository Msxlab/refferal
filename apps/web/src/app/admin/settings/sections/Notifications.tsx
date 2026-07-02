'use client';

/**
 * Bildirim olay × kanal matrisi (varsayilanlar, salt-okunur onizleme).
 * Tam duzenlenebilir tercih matrisi (task #7) gelen-kutusu ile birlikte baglanacak.
 */
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

const CHANNELS = ['In-app', 'Email', 'Push'] as const;

interface EventRow { event: string; who: string; def: [boolean, boolean, boolean] }

const EVENTS: EventRow[] = [
  { event: 'Sale approved', who: 'Seller + upline', def: [true, true, true] },
  { event: 'Commission matured', who: 'Beneficiary', def: [true, true, true] },
  { event: 'Payout sent', who: 'Member', def: [true, true, true] },
  { event: 'New team member joined', who: 'Sponsor', def: [true, false, true] },
  { event: 'Invitation accepted', who: 'Inviter', def: [true, false, false] },
  { event: 'Email verification', who: 'New user', def: [false, true, false] },
  { event: 'Password reset', who: 'Account owner', def: [false, true, false] },
  { event: 'Security alert', who: 'Account owner', def: [true, true, false] },
];

export default function Notifications() {
  return (
    <div className="grid" style={{ gap: 18 }}>
      <Card style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
        <Stat label="Delivery" value="Transactional outbox" hint="At-least-once with retry & backoff" />
        <Stat label="Email transport" value="SMTP / provider" hint="Pluggable adapter (env-selected)" />
        <Stat label="Mobile push" value="Expo" hint="Per-device tokens" />
      </Card>

      <section>
        <div style={{ marginBottom: 10 }}>
          <strong style={{ fontSize: 15 }}>Event routing <Badge variant="secondary" className="ml-1.5 align-middle text-[10px]">Read-only defaults</Badge></strong>
          <div className="faint" style={{ fontSize: 12 }}>Default channels per event (not editable yet). Per-member overrides arrive with the in-app inbox.</div>
        </div>
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <table>
            <thead>
              <tr>
                <th>Event</th><th>Recipient</th>
                {CHANNELS.map((c) => <th key={c} style={{ textAlign: 'center' }}>{c}</th>)}
              </tr>
            </thead>
            <tbody>
              {EVENTS.map((e) => (
                <tr key={e.event}>
                  <td style={{ fontWeight: 600 }}>{e.event}</td>
                  <td className="faint" style={{ fontSize: 12 }}>{e.who}</td>
                  {e.def.map((on, i) => (
                    <td key={i} style={{ textAlign: 'center' }}>
                      <span style={{
                        display: 'inline-block', width: 16, height: 16, borderRadius: 5,
                        background: on ? 'var(--emerald)' : 'transparent',
                        border: on ? 'none' : '1.5px solid var(--border-strong)',
                        color: '#fff', fontSize: 11, fontWeight: 900, lineHeight: '16px',
                      }}>{on ? '✓' : ''}</span>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
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
