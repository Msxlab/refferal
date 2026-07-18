'use client';

import { ReactNode, useEffect, useState } from 'react';
import {
  Bell,
  CreditCard,
  DatabaseBackup,
  Layers3,
  Palette,
  Settings as SettingsIcon,
  ShieldCheck,
  UsersRound,
  type LucideIcon,
} from 'lucide-react';
import { getSession, can } from '@/lib/auth';
import { t } from '@/lib/i18n';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import General from './sections/General';
import Brand from './sections/Brand';
import PeopleRoles from './sections/PeopleRoles';
import Security from './sections/Security';
import Notifications from './sections/Notifications';
import Data from './sections/Data';
import Plans from './sections/Plans';
import Payments from './sections/Payments';

type TabKey = 'general' | 'brand' | 'people' | 'plans' | 'payments' | 'security' | 'notifications' | 'data';

interface Tab { key: TabKey; label: string; Icon: LucideIcon; perm?: string; render: () => ReactNode }

const TAB_DESCRIPTIONS: Record<TabKey, string> = {
  general: 'Tenant defaults, commission rules and operational thresholds.',
  brand: 'Member-facing identity, color and copy controls.',
  people: 'Team access, roles and permission boundaries.',
  plans: 'Commission plan setup for sales distribution.',
  payments: 'Payout method and payment workflow configuration.',
  security: 'Authentication, MFA and account protection controls.',
  notifications: 'Email and operational message delivery settings.',
  data: 'Backup, restore-test and export controls.',
};

const TABS: Tab[] = [
  { key: 'general', label: 'General', Icon: SettingsIcon, render: () => <General /> },
  { key: 'brand', label: 'Brand', Icon: Palette, perm: 'settings.branding', render: () => <Brand /> },
  { key: 'people', label: 'People & Roles', Icon: UsersRound, perm: 'settings.roles', render: () => <PeopleRoles /> },
  { key: 'security', label: 'Security', Icon: ShieldCheck, render: () => <Security /> },
  { key: 'notifications', label: 'Notifications', Icon: Bell, render: () => <Notifications /> },
  { key: 'data', label: 'Data & Backup', Icon: DatabaseBackup, render: () => <Data /> },
  { key: 'plans', label: 'Plans', Icon: Layers3, perm: 'settings.plan', render: () => <Plans /> },
  { key: 'payments', label: 'Payments', Icon: CreditCard, perm: 'settings.payments', render: () => <Payments /> },
];

export default function SettingsPage() {
  const [active, setActive] = useState<TabKey>('general');
  const [tabs, setTabs] = useState<Tab[]>([]);

  useEffect(() => {
    const s = getSession();
    const visible = TABS.filter((tab) => !tab.perm || can(s, tab.perm));
    setTabs(visible);
    // Deep-link tabs with the hash, for example /admin/settings#people.
    const hash = window.location.hash.slice(1) as TabKey;
    if (hash && visible.some((v) => v.key === hash)) setActive(hash);
  }, []);

  function select(k: TabKey) {
    setActive(k);
    history.replaceState(null, '', `#${k}`);
  }

  const activeTab = tabs.find((tb) => tb.key === active) ?? tabs[0];
  const current = activeTab?.render() ?? null;

  return (
    <div>
      <div className="eyebrow fade-in">{t('nav.settings')}</div>
      <h1 className="h1 fade-in">Settings</h1>
      <p className="sub fade-in" style={{ marginBottom: 18 }}>Workspace configuration grouped by ownership and risk.</p>

      <Tabs
        value={active}
        orientation="vertical"
        onValueChange={(value: string) => select(value as TabKey)}
        className="fade-in delay-1 grid gap-5 lg:grid-cols-[230px_minmax(0,1fr)] lg:items-start"
      >
        <TabsList
          variant="line"
          className="max-w-full justify-start overflow-x-auto rounded-xl border bg-card p-2 lg:sticky lg:top-6 lg:h-auto lg:w-full lg:flex-col lg:items-stretch lg:overflow-visible"
        >
          {tabs.map((tab) => {
            const Icon = tab.Icon;

            return (
              <TabsTrigger key={tab.key} value={tab.key} className="flex-none justify-start lg:w-full">
                <Icon data-icon="inline-start" aria-hidden="true" />
                {tab.label}
              </TabsTrigger>
            );
          })}
        </TabsList>

        <TabsContent value={active} className="fade-in delay-2 mt-0 min-w-0 text-base">
          {activeTab && (
            <div className="mb-4 border-b pb-3">
              <div className="text-base font-semibold">{activeTab.label}</div>
              <div className="mt-1 max-w-2xl text-sm text-muted-foreground">{TAB_DESCRIPTIONS[activeTab.key]}</div>
            </div>
          )}
          {current}
        </TabsContent>
      </Tabs>
    </div>
  );
}
