'use client';

import { useEffect, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { dateShort, money } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Copy, Check, X, Pencil } from 'lucide-react';

/**
 * Liste satirinin veri sekli. Sayfadaki MemberItem ile yapisal olarak ozdes —
 * App Router sayfalari yalniz default export edebildigi icin tipi burada
 * yeniden tanimliyoruz; TS yapisal tipleme sayesinde satir objesi sorunsuz gecer.
 */
export interface MemberRow {
  id: string;
  fullName: string;
  email: string;
  emailVerified: boolean;
  referralCode: string;
  role: string;
  status: 'active' | 'inactive';
  depth: number;
  sponsorReferralCode: string | null;
  soldCents: string;
  earnedCents: string;
  joinedAt: string;
}

const ROLE_LABELS: Record<string, string> = {
  member: 'Rep',
  tenant_staff: 'Staff',
  tenant_admin: 'Admin',
  tenant_owner: 'Owner',
};
const roleLabel = (r: string): string => ROLE_LABELS[r] ?? r;

const initialsOf = (name: string): string =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? '').join('') || '?';

/** money-semantic emerald badge — token classes, light + dark uyumlu (page.tsx ile ozdes) */
const EMERALD_BADGE = 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400';

/**
 * Sagdan kayan, salt-sunum (presentational) uye detay cekmecesi.
 * Yalnizca liste satirindaki veriyi kullanir — ekstra veri cekmez.
 * Esc ile kapanir, acilista kapat dugmesine odak verir, backdrop tiklamasi kapatir.
 */
export function MemberDrawer({
  member,
  onClose,
  onEdit,
  onDeactivate,
}: {
  member: MemberRow;
  onClose: () => void;
  /** Sayfanin mevcut profil-duzenle handler'i (Modal'i acar). */
  onEdit: (m: MemberRow) => void;
  /** Sayfanin mevcut aktiflik handler'i (Confirm'i acar). */
  onDeactivate: (m: MemberRow) => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [copied, setCopied] = useState(false);
  // mount sonrasi tek frame: translate-x gecisini tetiklemek icin
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setShown(true));
    closeRef.current?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden'; // arka plan scroll'unu kilitle
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  function copyCode() {
    navigator.clipboard.writeText(member.referralCode)
      .then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1400); })
      .catch(() => {});
  }

  const isOwner = member.role === 'tenant_owner';
  const earnedPositive = Number(member.earnedCents) > 0;
  const sold = Number(member.soldCents) > 0 ? money(member.soldCents) : '—';
  const earned = earnedPositive ? money(member.earnedCents) : '—';
  const titleId = `member-drawer-${member.id}`;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      {/* backdrop */}
      <div
        className={cn(
          'absolute inset-0 bg-foreground/40 backdrop-blur-[1px] transition-opacity duration-300',
          shown ? 'opacity-100' : 'opacity-0',
        )}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* panel */}
      <div
        className={cn(
          'relative flex h-full w-[min(440px,94vw)] flex-col border-l border-border bg-card text-foreground shadow-xl transition-transform duration-300 ease-out',
          shown ? 'translate-x-0' : 'translate-x-full',
        )}
      >
        {/* header */}
        <div className="flex items-start gap-3 border-b border-border px-5 py-4">
          <Avatar className="h-11 w-11 rounded-xl">
            <AvatarFallback className="rounded-xl bg-primary/15 font-display text-sm font-bold text-primary">
              {initialsOf(member.fullName)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <div id={titleId} className="truncate font-display text-[17px] font-extrabold tracking-tight">
              {member.fullName}
            </div>
            <div className="truncate text-[12.5px] text-muted-foreground">{member.email}</div>
            <div className="mt-1.5 flex items-center gap-1.5">
              <span className="inline-flex items-center rounded-md border border-border bg-secondary px-2 py-0.5 font-mono text-[11px] text-foreground">
                {member.referralCode}
              </span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    title="Copy referral code"
                    onClick={copyCode}
                    className="rounded-md border border-border bg-secondary px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {copied
                      ? <span className="inline-flex items-center gap-1"><Check className="size-3.5 text-emerald-400" aria-hidden /> Copied</span>
                      : <Copy className="size-3.5" aria-hidden />}
                  </button>
                </TooltipTrigger>
                <TooltipContent>Copy referral code</TooltipContent>
              </Tooltip>
            </div>
          </div>
          <button
            ref={closeRef}
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-border bg-secondary text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>

        {/* body */}
        <div className="flex-1 overflow-y-auto px-5 py-5">
          {/* role + status chips */}
          <div className="mb-4 flex flex-wrap items-center gap-1.5">
            {member.status === 'active'
              ? <Badge variant="outline" className={EMERALD_BADGE}>active</Badge>
              : <Badge variant="outline" className="border-border bg-muted text-muted-foreground">inactive</Badge>}
            <Badge variant="outline" className="border-primary/30 bg-primary/10 text-primary">{roleLabel(member.role)}</Badge>
            {member.emailVerified && (
              <Badge variant="outline" className={EMERALD_BADGE}>email verified</Badge>
            )}
          </div>

          {/* stats grid */}
          <dl className="grid grid-cols-2 gap-2.5">
            <Stat label="Level" value={String(member.depth)} />
            <Stat
              label="Sponsor"
              value={member.sponsorReferralCode ?? '—'}
              mono={!!member.sponsorReferralCode}
            />
            <Stat label="Sales $" value={sold} />
            <Stat
              label="Earned $"
              value={earned}
              valueClass={earnedPositive ? 'text-emerald-400' : undefined}
            />
            <Stat label="Status" value={member.status === 'active' ? 'Active' : 'Inactive'} />
            <Stat label="Joined" value={dateShort(member.joinedAt)} />
          </dl>
        </div>

        {/* footer actions — reuse the page's existing handlers */}
        <div className="flex items-center gap-2 border-t border-border px-5 py-4">
          <Button variant="outline" size="sm" onClick={() => onEdit(member)}><Pencil className="size-4" aria-hidden /> Edit</Button>
          <div className="flex-1" />
          {!isOwner && (
            <Button
              variant={member.status === 'active' ? 'destructive' : 'default'}
              size="sm"
              onClick={() => onDeactivate(member)}
            >
              {member.status === 'active' ? 'Deactivate' : 'Activate'}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/* tek stat hucresi — sayfanin "Mini" kartlariyla ayni gorsel dil */
function Stat({
  label,
  value,
  mono,
  valueClass,
}: {
  label: string;
  value: string;
  mono?: boolean;
  valueClass?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-muted/40 p-3">
      <dt className="text-[11px] text-muted-foreground/70">{label}</dt>
      <dd
        className={cn(
          'mt-1 truncate font-display text-[15px] font-bold tabular-nums',
          valueClass ?? 'text-foreground',
          mono && 'font-mono',
        )}
      >
        {value}
      </dd>
    </div>
  );
}
