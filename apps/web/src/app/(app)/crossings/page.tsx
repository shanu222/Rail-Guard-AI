'use client';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { RiskMap } from '@/components/map-lazy';
import {
  Async,
  Badge,
  Card,
  CardHeader,
  PageTitle,
  Table,
  Td,
  Th,
  statusTone,
} from '@/components/ui';
import { api } from '@/lib/api';
import { ago, pretty } from '@/lib/format';

export default function CrossingsPage() {
  const router = useRouter();
  const q = useQuery({
    queryKey: ['crossings'],
    queryFn: () => api<any[]>('/v1/crossings'),
    refetchInterval: 60_000,
  });
  return (
    <>
      <PageTitle title="Level crossings" sub="Solar edge-vision units at unmanned crossings" />
      <div className="grid gap-4 xl:grid-cols-5">
        <Card className="overflow-hidden xl:col-span-2">
          <CardHeader title="Map" sub="✕ green = unit online, orange = needs attention" />
          <RiskMap
            crossings={q.data ?? []}
            fit={false}
            onSelectCrossing={(id) => router.push(`/crossings/${id}`)}
            className="h-[360px] w-full"
          />
        </Card>
        <Card className="xl:col-span-3">
          <CardHeader title="Crossings" />
          <Async q={q} empty={(d) => d.length === 0}>
            {(rows) => (
              <Table>
                <thead>
                  <tr>
                    <Th>Crossing</Th>
                    <Th>Status</Th>
                    <Th>Unit</Th>
                    <Th>Events 24 h</Th>
                    <Th>Warnings 24 h</Th>
                    <Th>Last event</Th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c) => (
                    <tr key={c.id} className="hover:bg-slate-50">
                      <Td>
                        <Link
                          href={`/crossings/${c.id}`}
                          className="font-medium text-navy hover:underline"
                        >
                          {c.name}
                        </Link>
                      </Td>
                      <Td>
                        <Badge tone={statusTone(c.status)}>{pretty(c.status)}</Badge>
                      </Td>
                      <Td>
                        <Badge tone={statusTone(c.unit_status ?? 'OFFLINE')}>
                          {c.unit_status ?? 'No unit'}
                        </Badge>{' '}
                        <span className="text-xs text-ink-soft">
                          {c.battery_pct != null ? `${Math.round(c.battery_pct)}%` : ''}
                        </span>
                      </Td>
                      <Td className="tabular-nums">{c.events_24h}</Td>
                      <Td className="tabular-nums font-medium">{c.warnings_24h}</Td>
                      <Td className="text-xs">{ago(c.last_event_at)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Async>
        </Card>
      </div>
    </>
  );
}
