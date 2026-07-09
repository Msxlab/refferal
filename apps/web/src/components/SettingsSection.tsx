'use client';

import { ReactNode } from 'react';

/** Ayar sekmelerinde tutarsiz 560/620/640/680 genisliklerini normalize eden ince sarmalayici. */
export function SettingsSection({ maxWidth = 620, children }: { maxWidth?: number; children: ReactNode }) {
  return <div style={{ maxWidth }}>{children}</div>;
}
