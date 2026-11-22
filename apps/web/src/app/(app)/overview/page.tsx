'use client';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { DEFECT_CLASSES } from '@railguard/shared';
import { Legend5 } from '@/components/extras';
import { RiskMap } from '@/components/map-lazy';
import {
  Async,
  Badge,
  Card,
  CardHeader,
  Disclaimer,
  EmptyState,
  PageTitle,
  Skeleton,
  Stat,
} from '@/components/ui';
import { api } from '@/lib/api';
import { CLASS_COLORS, ago, num, pretty } from '@/lib/format';
import { useLive } from '@/lib/live';
import { useRouter } from 'next/navigation';

interface Overview {
  kpis: {
    kmMonitored: number;
    openSevereDefects: number;
    awaitingReview: number;
    crossingsOnline: number;
    crossingsTotal: number;
    warnings24h: number;
    avgSegmentRisk: number | null;
  };
  trend: Record<string, any>[];
  alerts: { id: string; type: string; title: string; body: string | null; createdAt: string }[];
}

export default function OverviewPage() {
  const router = useRouter();
  const ov = useQuery({
    queryKey: ['overview'],
    queryFn: () => api<Overview>('/v1/overview'),
    refetchInterval: 60_000,
  });
  const segs = useQuery({
    queryKey: ['segments', 'all'],
    queryFn: () => api<GeoJSON.FeatureCollection>('/v1/map/segments'),
  });
  const crossings = useQuery({
    queryKey: ['map-crossings'],
    queryFn: () => api<any[]>('/v1/map/crossings'),
  });
  const { events } = useLive();
  const k = ov.data?.kpis;

  return (
    <>
      <PageTitle title="Overview" sub="Division health at a glance" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {ov.isLoading || !k ? (
          Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-24" />)
        ) : (
          <>
            <Stat label="Km monitored" value={num(k.kmMonitored, 1)} />
            <Stat
              label="Open severe defects"
              value={k.openSevereDefects}
              tone={k.openSevereDefects ? 'accent' : undefined}
            />
            <Stat
              label="Awaiting review"
              value={k.awaitingReview}
              sub={
                <Link href="/review" className="text-accent underline">
                  Review now
                </Link>
              }
            />
            <Stat
              label="Crossings online"
              value={`${k.crossingsOnline}/${k.crossingsTotal}`}
              tone={k.crossingsOnline === k.crossingsTotal ? 'teal' : 'accent'}
            />
            <Stat label="Warnings (24 h)" value={k.warnings24h} />
            <Stat
              label="Avg segment risk"
              value={num(k.avgSegmentRisk, 2)}
              sub="1 low – 5 critical"
            />
          </>
        )}
      </div>
      {ov.error && (
        <Card className="mt-3">
          <div role="alert" className="p-4 text-sm text-risk-5">
            {(ov.error as Error).message}
          </div>
        </Card>
      )}

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Card className="overflow-hidden xl:col-span-2">
          <CardHeader
            title="Division risk map"
            sub={<Disclaimer />}
            action={
              <Link href="/risk-map" className="text-xs font-medium text-accent">
                Open full map →
              </Link>
            }
          />
          <div className="h-[380px]">
            <RiskMap
              segments={segs.data}
              crossings={crossings.data ?? []}
              onSelectSegment={() => router.push('/risk-map')}
              onSelectCrossing={(id) => router.push(`/crossings/${id}`)}
              className="h-full w-full"
            />
          </div>
          <Legend5 />
        </Card>

        <Card>
          <CardHeader title="Live alerts" action={<Badge tone="teal">live</Badge>} />
          <div className="max-h-[420px] divide-y divide-line overflow-auto">
            {events.map((e) => (
              <div key={e.id} className="px-4 py-2.5 text-sm">
                <p className="font-medium">
                  {e.type === 'detection.severe'
                    ? `Severe ${pretty(e.data.defectClass).toLowerCase()}`
                    : e.type === 'crossing.warning'
                      ? `Warning at ${e.data.name}`
                      : `${e.data.name} offline`}
                </p>
                <p className="text-xs text-ink-soft">{ago(e.at)} · just received</p>
              </div>
            ))}
            {ov.data?.alerts.map((a) => (
              <div key={a.id} className="px-4 py-2.5 text-sm">
                <p className="font-medium">{a.title}</p>
                <p className="text-xs text-ink-soft">
                  {ago(a.createdAt)}
                  {a.body ? ` · ${a.body}` : ''}
                </p>
              </div>
            ))}
            {!events.length && !ov.data?.alerts.length && (
              <EmptyState
                title="No alerts yet"
                hint="Severe detections, crossing warnings and offline devices appear here in real time."
              />
            )}
          </div>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader title="Detections by class (last 30 days)" sub="Excludes rejected detections" />
        <div className="h-72 p-3">
          <Async q={ov} empty={(d) => d.trend.length === 0}>
            {(d) => (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={d.trend}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 11 }}
                    tickFormatter={(v: string) => v.slice(5)}
                  />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend formatter={(v: string) => pretty(v)} wrapperStyle={{ fontSize: 11 }} />
                  {DEFECT_CLASSES.map((c) => (
                    <Bar key={c} dataKey={c} stackId="a" fill={CLASS_COLORS[c]} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            )}
          </Async>
        </div>
      </Card>
    </>
  );
}
