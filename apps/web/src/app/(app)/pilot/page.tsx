'use client';
import { useQuery } from '@tanstack/react-query';
import { Async, Badge, Card, PageTitle } from '@/components/ui';
import { api } from '@/lib/api';
import { pct } from '@/lib/format';

interface M {
  key: string;
  label: string;
  target: number;
  value: number | null;
  source: string;
  n: number | null;
}

export default function PilotPage() {
  const q = useQuery({
    queryKey: ['pilot'],
    queryFn: () => api<{ isDemoData: boolean; metrics: M[] }>('/v1/pilot'),
    refetchInterval: 120_000,
  });
  return (
    <>
      <PageTitle
        title="Pilot evaluation"
        sub="Project success metrics against agreed targets, for Pakistan Railways and Ignite reviews"
      />
      <Async q={q}>
        {(d) => (
          <>
            {d.isDemoData && (
              <p
                role="note"
                className="mb-4 rounded-lg border border-accent bg-accent/10 px-3 py-2 text-sm font-medium text-accent-dark"
              >
                DEMO DATA — these values come from simulated devices and demo reviews. They are not
                real Pakistan Railways results.
              </p>
            )}
            <div className="grid gap-4 md:grid-cols-2">
              {d.metrics.map((m) => {
                const met = m.value !== null && m.value >= m.target;
                const w = m.value === null ? 0 : Math.min(100, m.value * 100);
                return (
                  <Card key={m.key} className="p-4">
                    <div className="flex items-start justify-between gap-2">
                      <h2 className="text-sm font-semibold">{m.label}</h2>
                      <Badge tone={m.value === null ? 'slate' : met ? 'teal' : 'amber'}>
                        {m.value === null ? 'No data yet' : met ? 'Target met' : 'Below target'}
                      </Badge>
                    </div>
                    <p className="mt-2 text-3xl font-semibold tabular-nums">
                      {pct(m.value)}
                      <span className="ms-2 text-sm font-normal text-ink-soft">
                        target ≥ {pct(m.target, 0)}
                      </span>
                    </p>
                    <div
                      className="relative mt-3 h-3 rounded-full bg-slate-200"
                      role="progressbar"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.round(w)}
                      aria-label={`${m.label}: ${pct(m.value)} of target ${pct(m.target, 0)}`}
                    >
                      <div
                        className={`h-3 rounded-full ${met ? 'bg-teal' : 'bg-accent'}`}
                        style={{ width: `${w}%` }}
                      />
                      <div
                        className="absolute -top-1 h-5 w-0.5 bg-navy"
                        style={{ left: `${m.target * 100}%` }}
                        title="Target"
                      />
                    </div>
                    <p className="mt-2 text-xs text-ink-soft">
                      {m.source}
                      {m.n != null ? ` · n = ${m.n}` : ''}
                    </p>
                  </Card>
                );
              })}
            </div>
            <p className="mt-4 text-xs text-ink-soft">
              Recall needs a labelled test set, so recall figures are entered by an Admin (Admin →
              Settings) after the field evaluation. Precision and uptime are computed live.
            </p>
          </>
        )}
      </Async>
    </>
  );
}
