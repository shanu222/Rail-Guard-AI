'use client';
import { useQuery } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import { useParams } from 'next/navigation';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Async, Badge, Card, CardHeader, PageTitle, Stat, statusTone } from '@/components/ui';
import { api } from '@/lib/api';
import { dt, pretty } from '@/lib/format';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function CrossingDetail() {
  const { id } = useParams<{ id: string }>();
  const q = useQuery({
    queryKey: ['crossing', id],
    queryFn: () => api<any>(`/v1/crossings/${id}`),
    refetchInterval: 60_000,
  });

  return (
    <Async q={q}>
      {(c) => {
        // events are stored in UTC; show the heat-map in Pakistan time (UTC+5)
        const grid: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
        for (const h of c.heatmap) {
          const hr = h.hour + 5;
          grid[(h.dow + Math.floor(hr / 24)) % 7]![hr % 24]! += h.n;
        }
        const max = Math.max(1, ...grid.flat());
        return (
          <>
            <PageTitle
              title={c.name}
              sub={`Unit ${c.unit?.name ?? '—'} · last 30 days`}
              actions={
                <Badge tone={statusTone(c.unit?.status ?? 'OFFLINE')}>
                  {c.unit?.status ?? 'No unit'}
                </Badge>
              }
            />
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Stat label="Events" value={c.totals30d?.events ?? 0} />
              <Stat label="Warnings triggered" value={c.totals30d?.warnings ?? 0} tone="accent" />
              <Stat label="Train-approaching events" value={c.totals30d?.train_events ?? 0} />
              <Stat
                label="Battery"
                value={c.unit?.batteryPct != null ? `${Math.round(c.unit.batteryPct)}%` : '—'}
                sub={c.unit?.solarW != null ? `Solar ${Math.round(c.unit.solarW)} W` : undefined}
              />
            </div>

            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <Card>
                <CardHeader title="Object classes in the danger zone" />
                <div className="h-60 p-3">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={c.classBreakdown.map((x: any) => ({
                        name: pretty(x.object_class),
                        n: x.n,
                      }))}
                      layout="vertical"
                      margin={{ left: 30 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                      <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                      <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={80} />
                      <Tooltip />
                      <Bar dataKey="n" fill="#1E3350" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Card>
              <Card>
                <CardHeader title="Events and warnings per day" />
                <div className="h-60 p-3">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={c.daily}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis
                        dataKey="day"
                        tickFormatter={(v: string) => v.slice(5)}
                        tick={{ fontSize: 11 }}
                      />
                      <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Line dataKey="events" stroke="#1E3350" dot={false} name="Events" />
                      <Line dataKey="warnings" stroke="#E8643A" dot={false} name="Warnings" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </Card>
            </div>

            <Card className="mt-4">
              <CardHeader
                title="Busiest hours"
                sub="Events by weekday and hour (Pakistan time). Darker = more traffic."
              />
              <div className="overflow-x-auto p-3">
                <table
                  className="border-separate border-spacing-0.5 text-[10px]"
                  aria-label="Heat-map of events by weekday and hour"
                >
                  <thead>
                    <tr>
                      <th />
                      {Array.from({ length: 24 }, (_, h) => (
                        <th key={h} className="w-6 font-normal text-ink-soft">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {grid.map((row, d) => (
                      <tr key={d}>
                        <th className="pe-2 text-end font-normal text-ink-soft">{DAYS[d]}</th>
                        {row.map((n, h) => (
                          <td
                            key={h}
                            title={`${DAYS[d]} ${h}:00 – ${n} events`}
                            className="h-6 w-6 rounded-sm text-center"
                            style={{
                              background: n
                                ? `rgba(232,100,58,${0.15 + 0.85 * (n / max)})`
                                : '#EEF1F5',
                              color: n / max > 0.55 ? '#fff' : '#14202F',
                            }}
                          >
                            {n || ''}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            <div className="mt-4 grid gap-4 lg:grid-cols-3">
              <Card className="lg:col-span-1">
                <CardHeader title="Latest snapshot" />
                <div className="p-3">
                  {c.latestSnapshotUrl ? (
                    <img
                      src={c.latestSnapshotUrl}
                      alt="Latest crossing snapshot (privacy protected)"
                      className="w-full rounded"
                    />
                  ) : (
                    <p className="py-6 text-center text-sm text-ink-soft">
                      No snapshot available (none uploaded, or deleted after the retention period).
                    </p>
                  )}
                  <p className="mt-2 flex items-start gap-1.5 text-xs text-ink-soft">
                    <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-teal" aria-hidden />{' '}
                    {c.privacyNote}
                  </p>
                </div>
              </Card>
              <Card className="lg:col-span-2">
                <CardHeader title="Event timeline" />
                <ul className="max-h-96 divide-y divide-line overflow-auto">
                  {c.events.map((e: any) => (
                    <li
                      key={e.id}
                      className="flex items-center justify-between gap-2 px-4 py-2 text-sm"
                    >
                      <span>
                        <span className="font-medium">{pretty(e.objectClass)}</span>{' '}
                        <span className="text-xs text-ink-soft">
                          · {Math.round(e.dwellSeconds)} s in zone ·{' '}
                          {Math.round(e.confidence * 100)}%
                        </span>
                        <span className="block text-xs text-ink-soft">{dt(e.occurredAt)}</span>
                      </span>
                      <span className="flex gap-1">
                        {e.trainApproaching && <Badge tone="amber">Train approaching</Badge>}
                        {e.warningTriggered && <Badge tone="red">Warning triggered</Badge>}
                      </span>
                    </li>
                  ))}
                  {!c.events.length && (
                    <li className="p-6 text-center text-sm text-ink-soft">
                      No events recorded yet.
                    </li>
                  )}
                </ul>
              </Card>
            </div>
          </>
        );
      }}
    </Async>
  );
}
