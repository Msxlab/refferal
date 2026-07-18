'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { Popover } from '@/components/Popover';

interface Company { id: string; name: string; slug: string }

export function HqCompanySwitcher({ currentId }: { currentId?: string }) {
  const router = useRouter();
  const [companies, setCompanies] = useState<Company[]>([]);
  useEffect(() => { api.get<Company[]>('/platform/companies').then(setCompanies).catch(() => {}); }, []);
  const current = companies.find((c) => c.id === currentId);

  const itemStyle: React.CSSProperties = {
    display: 'block', width: '100%', textAlign: 'left', padding: '8px 10px',
    background: 'transparent', cursor: 'pointer', border: 'none', borderRadius: 8, color: 'inherit',
  };

  return (
    <Popover label={<>{current ? current.name : 'All companies'} ▾</>} width={240}>
      {(close) => (
        <div style={{ minWidth: 220 }}>
          <button
            type="button"
            style={itemStyle}
            onClick={() => { router.push('/hq'); close(); }}
          >
            Overview
          </button>
          {companies.map((c) => (
            <button
              key={c.id}
              type="button"
              style={itemStyle}
              onClick={() => { router.push(`/hq/c/${c.id}`); close(); }}
            >
              {c.name}
            </button>
          ))}
        </div>
      )}
    </Popover>
  );
}
