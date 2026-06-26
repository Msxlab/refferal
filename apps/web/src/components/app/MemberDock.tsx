'use client';

import { useRef } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion, useMotionValue, useSpring, useTransform, type MotionValue } from 'framer-motion';
import { Home, Wallet, Banknote, Users, Sparkles, type LucideIcon } from 'lucide-react';

const ITEMS: { href: string; label: string; icon: LucideIcon }[] = [
  { href: '/app', label: 'Home', icon: Home },
  { href: '/app/wallet', label: 'Wallet', icon: Wallet },
  { href: '/app/sales', label: 'My sales', icon: Banknote },
  { href: '/app/team', label: 'Team', icon: Users },
  { href: '/app/invite', label: 'Invite', icon: Sparkles },
];

function DockIcon({ mouseX, href, label, Icon, active }: { mouseX: MotionValue<number>; href: string; label: string; Icon: LucideIcon; active: boolean }) {
  const ref = useRef<HTMLAnchorElement>(null);
  const distance = useTransform(mouseX, (val) => {
    const b = ref.current?.getBoundingClientRect();
    const center = b ? b.x + b.width / 2 : 0;
    return val - center;
  });
  const sizeSync = useTransform(distance, [-110, 0, 110], [42, 58, 42]);
  const size = useSpring(sizeSync, { stiffness: 320, damping: 22, mass: 0.4 });

  return (
    <Link ref={ref} href={href} aria-label={label} aria-current={active ? 'page' : undefined} className="group relative grid place-items-center">
      <motion.div
        style={{ width: size, height: size }}
        className={`grid place-items-center rounded-xl border transition-colors ${active ? 'border-transparent bg-primary text-primary-foreground shadow-[0_8px_22px_-8px_hsl(var(--primary)/0.6)]' : 'border-border bg-muted text-muted-foreground group-hover:text-foreground'}`}
      >
        <Icon className="size-5" aria-hidden />
      </motion.div>
      <span className="pointer-events-none absolute -top-8 whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 text-[11px] text-foreground opacity-0 shadow-md transition-opacity group-hover:opacity-100">
        {label}
      </span>
      {active && <span aria-hidden className="absolute -bottom-1 size-1 rounded-full bg-primary" />}
    </Link>
  );
}

/** Premium yuzen dock (macOS-tarzi hover-buyume) — uye panelinde hizli erisim. */
export function MemberDock() {
  const mouseX = useMotionValue(Infinity);
  const pathname = usePathname();

  return (
    <div className="no-print fixed inset-x-0 bottom-4 z-40 flex justify-center px-4">
      <motion.div
        onMouseMove={(e) => mouseX.set(e.pageX)}
        onMouseLeave={() => mouseX.set(Infinity)}
        className="flex items-end gap-2 rounded-2xl border border-border bg-popover/85 px-3 py-2 shadow-[0_20px_55px_-18px_rgba(0,0,0,0.55)] backdrop-blur-md"
      >
        {ITEMS.map((it) => (
          <DockIcon key={it.href} mouseX={mouseX} href={it.href} label={it.label} Icon={it.icon} active={pathname === it.href} />
        ))}
      </motion.div>
    </div>
  );
}
