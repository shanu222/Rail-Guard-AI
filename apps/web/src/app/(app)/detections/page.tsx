'use client';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Download, LayoutGrid, List } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { DEFECT_CLASSES, REVIEW_STATUSES, SEVERITIES } from '@railguard/shared';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  PageTitle,
  Select,
  SkeletonRows,
  Table,
  Td,
  Th,
  severityTone,
  statusTone,
} from '@/components/ui';
import { api, downloadFile } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { CHAINAGE, dt, pct, pretty } from '@/lib/format';

interface Row {
  id: string;
  detectedAt: string;
  defectClass: string;
  severity: string;
  confidence: number;
  sources: string[];
  fusionLevel: string;
  reviewStatus: string;
  hasImage: boolean;
  chainageM: number | null;
  sectionName: string | null;
  deviceName: string;
  isDemo: boolean;
}

export default function DetectionsPage() {
  const { can } = useAuth();
  const [view, setView] = useState<'table' | 'cards'>('table');
  const [f, setF] = useState({ defectClass: '', severity: '', reviewStatus: '', from: '', to: '' });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLSelectElement | HTMLInputElement>) =>
    setF((p) => ({ ...p, [k]: e.target.value }));

  const q = useInfiniteQuery({
    queryKey: ['detections', f],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      api<{ items: Row[]; nextCursor: string | null }>('/v1/detections', {
        query: {
          ...f,
          from: f.from ? new Date(f.from).toISOString() : '',
          to: f.to ? new Date(f.to + 'T23:59:59').toISOString() : '',
          cursor: pageParam,
          limit: 25,
        },
      }),
    getNextPageParam: (l) => l.nextCursor ?? undefined,
  });
  const rows = q.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <>
      <PageTitle
        title="Detections"
        sub="Review, filter and export what the Track Units found"
        actions={
          <>
            <Button
              variant="ghost"
              size="sm"
              aria-pressed={view === 'table'}
              onClick={() => setView('table')}
            >
              <List className="h-4 w-4" /> Table
            </Button>
            <Button
              variant="ghost"
              size="sm"
              aria-pressed={view === 'cards'}
              onClick={() => setView('cards')}
            >
              <LayoutGrid className="h-4 w-4" /> Cards
            </Button>
            {can('reports:read') && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  void downloadFile('/v1/detections/export.csv', 'detections.csv', {
                    ...f,
                    from: f.from ? new Date(f.from).toISOString() : '',
                    to: f.to ? new Date(f.to + 'T23:59:59').toISOString() : '',
                  })
                }
              >
                <Download className="h-4 w-4" /> CSV
              </Button>
            )}
          </>
        }
      />
      <Card className="mb-4 grid grid-cols-2 gap-3 p-3 md:grid-cols-5">
        <Select aria-label="Defect class" value={f.defectClass} onChange={set('defectClass')}>
          <option value="">All classes</option>
          {DEFECT_CLASSES.map((c) => (
            <option key={c} value={c}>
              {pretty(c)}
            </option>
          ))}
        </Select>
        <Select aria-label="Severity" value={f.severity} onChange={set('severity')}>
          <option value="">All severities</option>
          {SEVERITIES.map((c) => (
            <option key={c} value={c}>
              {pretty(c)}
            </option>
          ))}
        </Select>
        <Select aria-label="Review status" value={f.reviewStatus} onChange={set('reviewStatus')}>
          <option value="">All statuses</option>
          {REVIEW_STATUSES.map((c) => (
            <option key={c} value={c}>
              {pretty(c)}
            </option>
          ))}
        </Select>
        <input
          aria-label="From date"
          type="date"
          className="rounded-lg border border-line px-3 py-2 text-sm"
          value={f.from}
          onChange={set('from')}
        />
        <input
          aria-label="To date"
          type="date"
          className="rounded-lg border border-line px-3 py-2 text-sm"
          value={f.to}
          onChange={set('to')}
        />
      </Card>

      <Card>
        {q.isLoading ? (
          <SkeletonRows n={8} />
        ) : q.error ? (
          <ErrorState error={q.error} retry={() => void q.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState
            title="No detections match"
            hint="Clear a filter, or run the simulator to generate demo detections."
          />
        ) : view === 'table' ? (
          <Table>
            <thead>
              <tr>
                <Th>When</Th>
                <Th>Defect</Th>
                <Th>Severity</Th>
                <Th>Confidence</Th>
                <Th>Sources</Th>
                <Th>Location</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50">
                  <Td>
                    <Link
                      href={`/detections/${r.id}`}
                      className="font-medium text-navy underline-offset-2 hover:underline"
                    >
                      {dt(r.detectedAt)}
                    </Link>
                  </Td>
                  <Td>{pretty(r.defectClass)}</Td>
                  <Td>
                    <Badge tone={severityTone(r.severity)}>{r.severity}</Badge>
                  </Td>
                  <Td className="tabular-nums">
                    {pct(r.confidence, 0)}{' '}
                    <span className="text-xs text-ink-soft">
                      {r.fusionLevel === 'HIGH' ? 'high fusion' : 'needs review'}
                    </span>
                  </Td>
                  <Td className="text-xs">{r.sources.map(pretty).join(', ')}</Td>
                  <Td className="text-xs">
                    {r.sectionName ?? '—'} · {CHAINAGE(r.chainageM)}
                  </Td>
                  <Td>
                    <Badge tone={statusTone(r.reviewStatus)}>{r.reviewStatus}</Badge>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <div className="grid gap-3 p-3 sm:grid-cols-2 xl:grid-cols-3">
            {rows.map((r) => (
              <Link
                key={r.id}
                href={`/detections/${r.id}`}
                className="rounded-lg border border-line p-3 hover:border-accent"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">{pretty(r.defectClass)}</span>
                  <Badge tone={severityTone(r.severity)}>{r.severity}</Badge>
                </div>
                <p className="mt-1 text-xs text-ink-soft">
                  {dt(r.detectedAt)} · {r.deviceName}
                </p>
                <p className="mt-1 text-xs">
                  {r.sectionName ?? '—'} · {CHAINAGE(r.chainageM)} · {pct(r.confidence, 0)}
                </p>
                <div className="mt-2">
                  <Badge tone={statusTone(r.reviewStatus)}>{r.reviewStatus}</Badge>
                </div>
              </Link>
            ))}
          </div>
        )}
        {q.hasNextPage && (
          <div className="border-t border-line p-3 text-center">
            <Button
              variant="ghost"
              onClick={() => void q.fetchNextPage()}
              disabled={q.isFetchingNextPage}
            >
              {q.isFetchingNextPage ? 'Loading…' : 'Load more'}
            </Button>
          </div>
        )}
      </Card>
      <p className="mt-2 text-xs text-ink-soft">{rows.length} shown</p>
    </>
  );
}
