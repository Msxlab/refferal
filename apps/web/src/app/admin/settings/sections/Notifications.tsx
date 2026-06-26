'use client';

import { Check } from 'lucide-react';

/**
 * Bildirim olay × kanal matrisi (varsayilanlar, salt-okunur onizleme).
 * Tam duzenlenebilir tercih matrisi (task #7) gelen-kutusu ile birlikte baglanacak.
 */
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
    <div className="grid" style={{ gap: 20 }}>
      <div className="card" style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <Stat label="Delivery" value="Transactional outbox" hint="At-least-once with retry & backoff" />
        <Stat label="Email transport" value="SMTP / provider" hint="Pluggable adapter (env-selected)" />
        <Stat label="Mobile push" value="Expo" hint="Per-device tokens" />
      </div>

      <section>
        <div style={{ marginBottom: 12 }}>
          <strong style={{ fontFamily: 'var(--font-display)', fontSize: 15 }}>Event routing <span className="badge draft" style={{ fontSize: 10, marginLeft: 6, verticalAlign: 'middle' }}>Read-only defaults</span></strong>
          <div className="faint" style={{ fontSize: 12 }}>Default channels per event (not editable yet). Per-member overrides arrive with the in-app inbox.</div>
        </div>
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
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
                        <span
                          role="img"
                          aria-label={`${CHANNELS[i]} ${on ? 'enabled' : 'disabled'}`}
                          className="rounded-sm"
                          style={{
                            display: 'inline-grid', placeItems: 'center', width: 16, height: 16,
                            background: on ? 'var(--emerald)' : 'transparent',
                            border: on ? 'none' : '1.5px solid var(--border-strong)',
                            color: 'hsl(var(--primary-foreground))',
                          }}
                        >{on ? <Check className="size-3" aria-hidden /> : null}</span>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div style={{ flex: 1, minWidth: 160 }}>
      <div className="faint" style={{ fontSize: 11 }}>{label}</div>
      <div style={{ fontWeight: 700, fontSize: 15, marginTop: 3 }}>{value}</div>
      <div className="faint" style={{ fontSize: 11, marginTop: 2 }}>{hint}</div>
    </div>
  );
}
