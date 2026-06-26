'use client';

import { ReactNode, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Settings as SettingsIcon, Coins, Award, Users, Diamond, Megaphone, Shield, Share2, Bell, Mail, FileText } from 'lucide-react';
import { getSession, can } from '@/lib/auth';
import { t } from '@/lib/i18n';
import { PageHeader } from '@/components/Page';
import General from './sections/General';
import Brand from './sections/Brand';
import PeopleRoles from './sections/PeopleRoles';
import Security from './sections/Security';
import Notifications from './sections/Notifications';
import Data from './sections/Data';
import Ranks from './sections/Ranks';
import Reports from './sections/Reports';
import Integrations from './sections/Integrations';
import Announcements from './sections/Announcements';
import Plan from './sections/Plan';

type TabKey = 'general' | 'brand' | 'plan' | 'people' | 'ranks' | 'security' | 'notifications' | 'reports' | 'integrations' | 'announcements' | 'data';

type TabGroup = 'Business' | 'System';
interface Tab { key: TabKey; label: string; icon: ReactNode; group: TabGroup; perm?: string; render: () => ReactNode }

// Crisp lucide icon per tab so glyphs inherit theme color/weight.
const TABS: Tab[] = [
  { key: 'general', label: 'General', icon: <SettingsIcon className="size-4" aria-hidden />, group: 'Business', render: () => <General /> },
  { key: 'plan', label: 'Commission plan', icon: <Coins className="size-4" aria-hidden />, group: 'Business', render: () => <Plan /> },
  { key: 'ranks', label: 'Ranks', icon: <Award className="size-4" aria-hidden />, group: 'Business', render: () => <Ranks /> },
  { key: 'people', label: 'People & Roles', icon: <Users className="size-4" aria-hidden />, group: 'Business', perm: 'settings.roles', render: () => <PeopleRoles /> },
  { key: 'brand', label: 'Brand', icon: <Diamond className="size-4" aria-hidden />, group: 'Business', perm: 'settings.branding', render: () => <Brand /> },
  { key: 'announcements', label: 'Announcements', icon: <Megaphone className="size-4" aria-hidden />, group: 'Business', render: () => <Announcements /> },
  { key: 'security', label: 'Security', icon: <Shield className="size-4" aria-hidden />, group: 'System', render: () => <Security /> },
  { key: 'integrations', label: 'Integrations', icon: <Share2 className="size-4" aria-hidden />, group: 'System', render: () => <Integrations /> },
  { key: 'notifications', label: 'Notifications', icon: <Bell className="size-4" aria-hidden />, group: 'System', render: () => <Notifications /> },
  { key: 'reports', label: 'Reports', icon: <Mail className="size-4" aria-hidden />, group: 'System', render: () => <Reports /> },
  { key: 'data', label: 'Data & Backup', icon: <FileText className="size-4" aria-hidden />, group: 'System', render: () => <Data /> },
];
const TAB_GROUPS: TabGroup[] = ['Business', 'System'];

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
      <PageHeader
        eyebrow={t('nav.settings')}
        title="Settings"
        description="Workspace configuration, people, security and data."
      />

      <div className="fade-in delay-1" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {TAB_GROUPS.filter((g) => tabs.some((t) => t.group === g)).map((g) => (
          <div key={g} className="row" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <span className="faint" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.08em', minWidth: 64 }}>{g}</span>
            <div className="seg-tabs" role="tablist">
              {tabs.filter((t) => t.group === g).map((tab) => {
                const on = active === tab.key;
                return (
                  <button
                    key={tab.key}
                    role="tab"
                    aria-selected={on}
                    className="seg-tab relative"
                    onClick={() => select(tab.key)}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 7, color: on ? 'var(--on-gold)' : undefined }}
                  >
                    {on && (
                      <motion.span
                        layoutId={`settingsTab-${g}`}
                        className="absolute inset-0 rounded-[10px]"
                        style={{ background: 'var(--foil)', boxShadow: '0 6px 16px -8px hsl(var(--primary) / .6)' }}
                        transition={{ type: 'spring', stiffness: 500, damping: 38 }}
                      />
                    )}
                    <span aria-hidden className="relative z-10" style={{ display: 'inline-flex', color: on ? 'var(--on-gold)' : undefined, opacity: on ? 1 : 0.7 }}>{tab.icon}</span>
                    <span className="relative z-10">{tab.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="fade-in delay-2" style={{ marginTop: 20 }}>{current}</div>
    </div>
  );
}
