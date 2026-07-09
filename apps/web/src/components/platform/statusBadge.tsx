export type PlatformStatus = 'active' | 'suspended' | 'setup_needed';

export interface StatusBadgeProps {
  status: PlatformStatus | string;
}

const MAP: Record<PlatformStatus, { cls: string; label: string }> = {
  active: { cls: 'active', label: 'Active' },
  suspended: { cls: 'inactive', label: 'Suspended' },
  setup_needed: { cls: 'pending', label: 'Setup needed' },
};

/** Item 4 (global constraint): tek yerden durum → badge. Ham domain string'i CSS class'ina asla interpolate edilmez. */
export function statusBadge(status: string): { cls: string; label: string } {
  return MAP[status as PlatformStatus] ?? { cls: 'inactive', label: status };
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const b = statusBadge(status);
  return <span className={`badge ${b.cls}`}>{b.label}</span>;
}
