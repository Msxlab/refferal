'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Network, Coins, Banknote, ShieldCheck, ArrowRight, Check, GitBranch, FileLock2, Sparkles,
} from 'lucide-react';
import { getSession, landingForSession } from '@/lib/auth';
import { APP_NAME, APP_MONOGRAM } from '@/lib/brand';
import { Button } from '@/components/ui/button';

const FEATURES = [
  { icon: Network, title: 'Referral network', body: 'A permanent, tamper-proof sponsorship tree. Drill into anyone, see their downline, placement that never moves.' },
  { icon: Coins, title: 'Commission engine', body: 'Integer-cent precision, configurable multi-level plans, an append-only ledger. Every cent is accounted for.' },
  { icon: Banknote, title: 'Payouts & checks', body: 'Auto-request at threshold, maker-checker approval, printable checks, ACH files and bank reconciliation.' },
  { icon: ShieldCheck, title: 'Compliance & audit', body: 'KYC/OFAC screening before money moves, period locks, 1099 reporting, a hash-chained audit log.' },
];

const STEPS = [
  { n: '1', title: 'Invite your network', body: 'Members join by invite and are placed permanently under their sponsor.' },
  { n: '2', title: 'Record sales', body: 'Approve a sale and the engine distributes commission up the chain, instantly and exactly.' },
  { n: '3', title: 'Pay with confidence', body: 'Balances vest, mature, and pay out — by check or ACH — fully audited end to end.' },
];

const FAQS = [
  { q: 'How are commissions calculated?', a: 'Every amount is an integer number of cents and every rate is in basis points. The pure engine distributes a configurable pool across upline levels with floor rounding — the remainder stays with the company. Nothing uses floating point.' },
  { q: 'Is the money trail auditable?', a: 'Yes. The ledger is append-only (corrections are equal-and-opposite reversals) and the audit log is cryptographically hash-chained, so any altered record breaks the chain.' },
  { q: 'How do members get paid?', a: 'Balances accrue, mature past a return window, then become payable. Once a member crosses the minimum threshold the system auto-requests a payout, which an admin approves and sends as a check (or ACH).' },
  { q: 'Is it multi-company?', a: 'Yes — the platform hosts many companies, each with its own network, plan, branding and members, fully isolated.' },
];

export default function Home() {
  const router = useRouter();
  const [show, setShow] = useState(false);

  useEffect(() => {
    const s = getSession();
    if (s) router.replace(landingForSession(s));
    else setShow(true);
  }, [router]);

  if (!show) return <div className="min-h-screen bg-background" />;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b border-border bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
          <div className="flex items-center gap-2.5">
            <span className="grid size-8 place-items-center rounded-lg bg-primary font-display text-sm font-bold text-primary-foreground">{APP_MONOGRAM}</span>
            <span className="font-display text-lg font-bold">{APP_NAME}</span>
          </div>
          <nav className="hidden items-center gap-7 text-sm text-muted-foreground md:flex">
            <a href="#features" className="transition-colors hover:text-foreground">Features</a>
            <a href="#how" className="transition-colors hover:text-foreground">How it works</a>
            <a href="#faq" className="transition-colors hover:text-foreground">FAQ</a>
          </nav>
          <div className="flex items-center gap-2.5">
            <Button asChild variant="ghost" size="sm"><Link href="/login">Sign in</Link></Button>
            <Button asChild size="sm"><Link href="/login">Get started <ArrowRight className="ml-1 size-4" /></Link></Button>
          </div>
        </div>
      </header>

      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-x-0 -top-40 mx-auto h-80 max-w-3xl rounded-full bg-primary/20 blur-[120px]" />
        <div className="relative mx-auto max-w-6xl px-5 pb-20 pt-20 text-center md:pt-28">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground">
            <Sparkles className="size-3.5 text-primary" /> Referral commission OS
          </span>
          <h1 className="mx-auto mt-6 max-w-3xl font-display text-4xl font-extrabold leading-[1.08] tracking-tight md:text-6xl">
            Run a referral program your accountant can trust.
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-balance text-base text-muted-foreground md:text-lg">
            {APP_NAME} distributes commissions to the cent, vests and matures balances, and pays members by check or ACH — with KYC, period locks and a tamper-proof audit trail built in.
          </p>
          <div className="mt-8 flex items-center justify-center gap-3">
            <Button asChild size="lg"><Link href="/login">Get started <ArrowRight className="ml-1.5 size-4" /></Link></Button>
            <Button asChild variant="outline" size="lg"><a href="#features">See how it works</a></Button>
          </div>
          <div className="mx-auto mt-10 flex max-w-2xl flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
            {['Integer-cent ledger', 'Hash-chained audit', 'KYC + OFAC', 'Check & ACH payouts'].map((t) => (
              <span key={t} className="inline-flex items-center gap-1.5"><Check className="size-4 text-primary" /> {t}</span>
            ))}
          </div>
        </div>
      </section>

      <section id="features" className="mx-auto max-w-6xl px-5 py-16">
        <div className="mb-10 text-center">
          <p className="text-xs font-bold uppercase tracking-[0.15em] text-primary">Everything in one place</p>
          <h2 className="mt-2 font-display text-3xl font-bold">From first invite to final payout</h2>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-2xl border border-border bg-card p-5 shadow-lg transition-colors hover:border-primary/40">
              <span className="grid size-10 place-items-center rounded-xl bg-primary/15 text-primary"><f.icon className="size-5" /></span>
              <h3 className="mt-4 font-display text-base font-bold">{f.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="how" className="border-y border-border bg-card/40">
        <div className="mx-auto max-w-6xl px-5 py-16">
          <div className="mb-10 text-center">
            <p className="text-xs font-bold uppercase tracking-[0.15em] text-primary">How it works</p>
            <h2 className="mt-2 font-display text-3xl font-bold">Three steps to paid</h2>
          </div>
          <div className="grid gap-6 md:grid-cols-3">
            {STEPS.map((s) => (
              <div key={s.n} className="relative rounded-2xl border border-border bg-background p-6">
                <span className="grid size-9 place-items-center rounded-full bg-primary font-display text-sm font-bold text-primary-foreground">{s.n}</span>
                <h3 className="mt-4 font-display text-lg font-bold">{s.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-16">
        <div className="grid gap-4 sm:grid-cols-3">
          {[
            { icon: GitBranch, k: 'Append-only', v: 'ledger' },
            { icon: FileLock2, k: 'Hash-chained', v: 'audit log' },
            { icon: ShieldCheck, k: '155 passing', v: 'integration tests' },
          ].map((s) => (
            <div key={s.v} className="flex items-center gap-4 rounded-2xl border border-border bg-card p-6">
              <span className="grid size-11 place-items-center rounded-xl bg-primary/15 text-primary"><s.icon className="size-5" /></span>
              <div>
                <div className="font-display text-xl font-bold tabular-nums">{s.k}</div>
                <div className="text-sm text-muted-foreground">{s.v}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section id="faq" className="mx-auto max-w-3xl px-5 py-16">
        <div className="mb-8 text-center">
          <p className="text-xs font-bold uppercase tracking-[0.15em] text-primary">FAQ</p>
          <h2 className="mt-2 font-display text-3xl font-bold">Questions, answered</h2>
        </div>
        <div className="divide-y divide-border rounded-2xl border border-border bg-card">
          {FAQS.map((f) => (
            <details key={f.q} className="group px-5 py-4">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium">
                {f.q}
                <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
              </summary>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 pb-20">
        <div className="relative overflow-hidden rounded-3xl border border-primary/30 bg-card p-10 text-center shadow-lg">
          <div className="pointer-events-none absolute inset-x-0 -bottom-24 mx-auto h-48 max-w-xl rounded-full bg-primary/25 blur-[100px]" />
          <h2 className="relative font-display text-3xl font-bold">Ready to run it properly?</h2>
          <p className="relative mx-auto mt-3 max-w-xl text-muted-foreground">Spin up a company, invite your network, and let the engine handle the money.</p>
          <div className="relative mt-7 flex justify-center">
            <Button asChild size="lg"><Link href="/login">Get started <ArrowRight className="ml-1.5 size-4" /></Link></Button>
          </div>
        </div>
      </section>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-5 py-8 text-sm text-muted-foreground sm:flex-row">
          <div className="flex items-center gap-2">
            <span className="grid size-6 place-items-center rounded-md bg-primary text-xs font-bold text-primary-foreground">{APP_MONOGRAM}</span>
            <span>© 2026 {APP_NAME}</span>
          </div>
          <div className="flex items-center gap-6">
            <Link href="/terms" className="transition-colors hover:text-foreground">Program terms</Link>
            <Link href="/login" className="transition-colors hover:text-foreground">Sign in</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
