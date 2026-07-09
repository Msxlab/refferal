export interface TabDef { key: string; label: string }

export interface TabsProps {
  tabs: TabDef[];
  active: string;
  onChange: (key: string) => void;
}

/** Item 3: sekme seridi — mevcut `seg-tabs`/`seg-tab` siniflarini kullanir (globals.css). */
export function Tabs({ tabs, active, onChange }: TabsProps) {
  return (
    <div className="seg-tabs" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          role="tab"
          aria-selected={active === t.key}
          className={`seg-tab ${active === t.key ? 'on' : ''}`}
          onClick={() => onChange(t.key)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
