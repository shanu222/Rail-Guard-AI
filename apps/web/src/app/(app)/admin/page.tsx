'use client';
import { useState } from 'react';
import {
  DevicesTab,
  GeographyTab,
  ModelsTab,
  RiskTab,
  SettingsTab,
  UsersTab,
} from '@/components/admin';
import { PageTitle, cn } from '@/components/ui';
import { useAuth } from '@/lib/auth';

const TABS = [
  { id: 'risk', label: 'Risk weights', perm: 'risk-weights:approve' as const, C: RiskTab },
  { id: 'users', label: 'Users & roles', perm: 'users:manage' as const, C: UsersTab },
  { id: 'geo', label: 'Sections & crossings', perm: 'sections:manage' as const, C: GeographyTab },
  { id: 'devices', label: 'Devices', perm: 'devices:manage' as const, C: DevicesTab },
  { id: 'models', label: 'Model versions', perm: 'models:manage' as const, C: ModelsTab },
  { id: 'settings', label: 'Settings', perm: 'settings:manage' as const, C: SettingsTab },
];

export default function AdminPage() {
  const { can } = useAuth();
  const tabs = TABS.filter((t) => can(t.perm));
  const [id, setId] = useState(tabs[0]?.id ?? 'risk');
  const Active = tabs.find((t) => t.id === id)?.C;
  return (
    <>
      <PageTitle title="Admin" sub="Users, geography, devices, models and the risk engine" />
      <div
        role="tablist"
        aria-label="Admin sections"
        className="mb-4 flex gap-1 overflow-x-auto border-b border-line"
      >
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={id === t.id}
            onClick={() => setId(t.id)}
            className={cn(
              'whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium',
              id === t.id
                ? 'border-accent text-ink'
                : 'border-transparent text-ink-soft hover:text-ink',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel">
        {Active ? (
          <Active />
        ) : (
          <p className="text-sm text-ink-soft">You do not have access to any admin tools.</p>
        )}
      </div>
    </>
  );
}
