'use client';

import { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Copy, Check, Share2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui';

/** Premium referans paylaşım kartı: QR + kod + kopyala + native paylaş. */
export function ReferralShare({ code, url, className }: { code: string; url: string; className?: string }) {
  const [, showToast] = useToast();
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      showToast('Referral link copied');
      setTimeout(() => setCopied(false), 1800);
    } catch {
      showToast('Could not copy link');
    }
  };

  const share = async () => {
    const nav = navigator as Navigator & { share?: (d: { title: string; text?: string; url: string }) => Promise<void> };
    if (nav.share) {
      try { await nav.share({ title: 'Join my team', text: 'Use my referral link to get started.', url }); }
      catch { /* user dismissed */ }
    } else {
      copy();
    }
  };

  return (
    <div className={`card lift ${className ?? ''}`} style={{ display: 'grid', gap: 'var(--space-4)' }}>
      <div className="spread" style={{ alignItems: 'flex-start' }}>
        <div>
          <div className="k" style={{ color: 'hsl(var(--muted-foreground))', fontSize: 12.5 }}>Your referral link</div>
          <div className="v" style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 650, marginTop: 6, letterSpacing: '.04em' }}>{code}</div>
        </div>
        <div style={{ background: '#fff', padding: 8, borderRadius: 12, lineHeight: 0 }}>
          <QRCodeSVG value={url} size={84} bgColor="#ffffff" fgColor="#0c0e13" level="M" />
        </div>
      </div>
      <div
        className="tnum"
        style={{ fontSize: 12.5, color: 'hsl(var(--muted-foreground))', background: 'var(--panel-2)', border: '1px solid hsl(var(--border))', borderRadius: 10, padding: '9px 12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        title={url}
      >
        {url}
      </div>
      <div className="row" style={{ gap: 'var(--space-2)' }}>
        <Button onClick={copy} className="flex-1">
          {copied ? <><Check className="size-4" aria-hidden /> Copied</> : <><Copy className="size-4" aria-hidden /> Copy link</>}
        </Button>
        <Button variant="outline" onClick={share} aria-label="Share referral link">
          <Share2 className="size-4" aria-hidden /> Share
        </Button>
      </div>
    </div>
  );
}
