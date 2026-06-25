'use client';

import { ReactNode, useEffect, useState } from 'react';
import { getSession, can } from '@/lib/auth';
import { t } from '@/lib/i18n';
import General from './sections/General';
import Brand from './sections/Brand';
import PeopleRoles from './sections/PeopleRoles';
import Security from './sections/Security';
import Notifications from './sections/Notifications';
import Data from './sections/Data';
import Plans from './sections/Plans';
import Payments from './sections/Payments';

type TabKey = 'general' | 'brand' | 'people' | 'plans' | 'payments' | 'security' | 'notifications' | 'data';

interface Tab { key: TabKey; label: string; icon: string; perm?: string; render: () => ReactNode }

const TABS: Tab[] = [
  { key: 'general', label: 'General', icon: '⚙', render: () => <General /> },
  { key: 'brand', label: 'Brand', icon: '◆', perm: 'settings.branding', render: () => <Brand /> },
  { key: 'people', label: 'People & Roles', icon: '⬡', perm: 'settings.roles', render: () => <PeopleRoles /> },
  { key: 'security', label: 'Security', icon: '⛉', render: () => <Security /> },
  { key: 'notifications', label: 'Notifications', icon: '◔', render: () => <Notifications /> },
  { key: 'data', label: 'Data & Backup', icon: '☷', render: () => <Data /> },
  { key: 'plans', label: 'Plans', icon: '%', perm: 'settings.plan', render: () => <Plans /> },
  { key: 'payments', label: 'Payments', icon: '$', perm: 'settings.payments', render: () => <Payments /> },
];

export default function SettingsPage() {
  const [active, setActive] = useState<TabKey>('general');
  const [tabs, setTabs] = useState<Tab[]>([]);

  useEffect(() => {
    const s = getSession();
    const visible = TABS.filter((tab) => !tab.perm || can(s, tab.perm));
    setTabs(visible);
    // hash ile derin baglanti (ornek: /admin/settings#people)
    const hash = window.location.hash.slice(1) as TabKey;
    if (hash && visible.some((v) => v.key === hash)) setActive(hash);
  }, []);

  function select(k: TabKey) {
    setActive(k);
    history.replaceState(null, '', `#${k}`);
  }

  const current = (tabs.find((tb) => tb.key === active) ?? tabs[0])?.render() ?? null;

  return (
    <div>
      <div className="eyebrow fade-in">{t('nav.settings')}</div>
      <h1 className="h1 fade-in">Settings</h1>
      <p className="sub fade-in" style={{ marginBottom: 18 }}>Workspace configuration, people, security and data.</p>

      <div className="seg-tabs fade-in delay-1" role="tablist">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            role="tab"
            aria-selected={active === tab.key}
            className={`seg-tab ${active === tab.key ? 'on' : ''}`}
            onClick={() => select(tab.key)}
          >
            <span style={{ opacity: 0.8 }}>{tab.icon}</span> {tab.label}
          </button>
        ))}
      </div>

      <div className="fade-in delay-2" style={{ marginTop: 20 }}>{current}</div>
    </div>
  );
}
