import Link from 'next/link';
import { Brand } from '@/components/ui';
import { APP_NAME } from '@/lib/brand';

export const metadata = { title: `Program Terms — ${APP_NAME}` };

// Faz D (denetim): davet disclaimer'inin 'program terms' linki buraya gelir. Public, auth gerektirmez.
// NOT: bu sade-dil bir taslaktir, hukuki tavsiye DEGILDIR — yayindan once avukat/muhasebeci teyidi onerilir.
export default function TermsPage() {
  return (
    <div className="center">
      <div className="fade-in" style={{ width: '100%', maxWidth: 720, padding: '32px 0 60px' }}>
        <div style={{ textAlign: 'center', marginBottom: 18 }}><Brand size="lg" /></div>
        <div className="card">
          <div className="eyebrow" style={{ marginBottom: 4 }}>Program</div>
          <h1 className="h1" style={{ marginBottom: 6 }}>Program Terms</h1>
          <p className="sub" style={{ marginBottom: 22 }}>The terms you agree to when you join a company&apos;s referral program on {APP_NAME}.</p>

          {SECTIONS.map((s) => (
            <section key={s.h} style={{ marginBottom: 18 }}>
              <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 'var(--text-lg)', fontWeight: 700, marginBottom: 6 }}>{s.h}</h2>
              <p className="faint" style={{ fontSize: 'var(--text-md)', lineHeight: 1.6, margin: 0 }}>{s.b}</p>
            </section>
          ))}

          <div className="faint" style={{ fontSize: 'var(--text-xs)', marginTop: 18, paddingTop: 14, borderTop: '1px solid hsl(var(--border))', lineHeight: 1.55 }}>
            Past earnings are not a guarantee of future income. Commission is earned only from real, approved
            product sales. These terms may be updated; continued participation means you accept the current terms.
          </div>

          <div style={{ marginTop: 20 }}>
            <Link href="/login" className="btn ghost sm"><span aria-hidden="true">←</span> Back</Link>
          </div>
        </div>
      </div>
    </div>
  );
}

const SECTIONS: { h: string; b: string }[] = [
  {
    h: '1. Who can join & accurate information',
    b: 'You join by invitation from a participating company. You confirm that the name and details you provide are accurate and that you are the person registering. You are responsible for keeping your information — including your mailing address — correct and up to date.',
  },
  {
    h: '2. How commissions work',
    b: 'You earn a commission on real product sales you make, and a share of sales made by people in your team, based on your company’s active commission plan. A sale must be recorded and approved by the company before any commission is credited. Voided or reversed sales remove the related commission.',
  },
  {
    h: '3. Getting paid — by check',
    b: 'Payouts are made by paper check mailed to the address on your account, once your balance reaches your company’s payout minimum. You’ll be notified when a check is being prepared. Make sure your mailing address is current — checks are sent there. There is no card or bank transfer; payment is by check.',
  },
  {
    h: '4. No income guarantee',
    b: 'Participation does not guarantee any income. Earnings depend entirely on real sales and vary from person to person. Nothing here is a promise of a specific result.',
  },
  {
    h: '5. Taxes',
    b: 'You are responsible for any taxes on the income you earn. Your company may report payments as required by law. Consult your own tax advisor about your situation.',
  },
  {
    h: '6. Fair use & suspension',
    b: 'Fabricated sales, self-dealing, fake accounts, or other abuse may result in held payouts, review, or removal from the program. Companies may suspend or close accounts that violate these terms or applicable rules.',
  },
  {
    h: '7. Privacy of your network',
    b: 'You can see the people you personally invited by name. Deeper levels of your network are shown only as aggregate counts — never individual details — to protect everyone’s privacy.',
  },
];
