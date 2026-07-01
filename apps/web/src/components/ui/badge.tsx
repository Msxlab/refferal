import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold transition-colors focus:outline-none',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-[color-mix(in_srgb,var(--brand)_15%,transparent)] text-primary',
        secondary: 'border-transparent bg-[color-mix(in_srgb,var(--muted)_18%,transparent)] text-muted-foreground',
        success: 'border-transparent bg-[color-mix(in_srgb,var(--emerald)_15%,transparent)] text-success',
        destructive: 'border-transparent bg-[color-mix(in_srgb,var(--rose)_15%,transparent)] text-destructive',
        // semantik para/durum renkleri (globals.css .badge paleti ile ayni)
        pending: 'border-transparent bg-[color-mix(in_srgb,var(--amber)_16%,transparent)] text-[color:var(--amber)]',
        payable: 'border-transparent bg-[color-mix(in_srgb,var(--sky)_16%,transparent)] text-[color:var(--sky)]',
        outline: 'text-foreground',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

// <span> (inline) — <p>/satir-ici metin icine guvenle girer, inline-flex ile her yerde calisir
function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
