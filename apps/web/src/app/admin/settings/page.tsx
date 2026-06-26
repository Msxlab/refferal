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
import Ranks from './sections/Ranks';
import Reports from './sections/Reports';
import Integrations from './sections/Integrations';
import Announcements from './sections/Announcements';
import Plan from './sections/Plan';

type TabKey = 'general' | 'brand' | 'plan' | 'people' | 'ranks' | 'security' | 'notifications' | 'reports' | 'integrations' | 'announcements' | 'data';

type TabGroup = 'Business' | 'System';
interface Tab { key: TabKey; label: string; icon: string; group: TabGroup; perm?: string; render: () => ReactNode }

// Single, consistent unicode glyph set (no emoji) so icons inherit theme color/weight.
const TABS: Tab[] = [
  { key: 'general', label: 'General', icon: '⚙', group: 'Business', render: () => <General /> },
  { key: 'plan', label: 'Commission plan', icon: '⚡', group: 'Business', render: () => <Plan /> },
  { key: 'ranks', label: 'Ranks', icon: '◇', group: 'Business', render: () => <Ranks /> },
  { key: 'people', label: 'People & Roles', icon: '⬡', group: 'Business', perm: 'settings.roles', render: () => <PeopleRoles /> },
  { key: 'brand', label: 'Brand', icon: '◆', group: 'Business', perm: 'settings.branding', render: () => <Brand /> },
  { key: 'announcements', label: 'Announcements', icon: '◈', group: 'Business', render: () => <Announcements /> },
  { key: 'security', label: 'Security', icon: '⛉', group: 'System', render: () => <Security /> },
  { key: 'integrations', label: 'Integrations', icon: '⚯', group: 'System', render: () => <Integrations /> },
  { key: 'notifications', label: 'Notifications', icon: '◔', group: 'System', render: () => <Notifications /> },
  { key: 'reports', label: 'Reports', icon: '✉', group: 'System', render: () => <Reports /> },
  { key: 'data', label: 'Data & Backup', icon: '☷', group: 'System', render: () => <Data /> },
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
      <div className="eyebrow fade-in">{t('nav.settings')}</div>
      <h1 className="h1 fade-in">Settings</h1>
      <p className="sub fade-in" style={{ marginBottom: 18 }}>Workspace configuration, people, security and data.</p>

      <div className="fade-in delay-1" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {TAB_GROUPS.filter((g) => tabs.some((t) => t.group === g)).map((g) => (
          <div key={g} className="row" style={{ gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <span className="faint" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.08em', minWidth: 64 }}>{g}</span>
            <div className="seg-tabs" role="tablist">
              {tabs.filter((t) => t.group === g).map((tab) => (
                <button
                  key={tab.key}
                  role="tab"
                  aria-selected={active === tab.key}
                  className={`seg-tab ${active === tab.key ? 'on' : ''}`}
                  onClick={() => select(tab.key)}
                >
                  <span aria-hidden className="faint" style={{ fontWeight: 600 }}>{tab.icon}</span> {tab.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="fade-in delay-2" style={{ marginTop: 20 }}>{current}</div>
    </div>
  );
}
