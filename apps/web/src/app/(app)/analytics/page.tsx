'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText } from 'lucide-react';
import { useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  Async,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Field,
  Input,
  PageTitle,
  Select,
  Stat,
  Table,
  Td,
  Th,
} from '@/components/ui';
import { api, postDownload } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { dt, monthNow, num, pct, pretty } from '@/lib/format';

const PALETTE = ['#1E3350', '#E8643A', '#1FA88A', '#F2B01E', '#9A6FD1'];

export default function AnalyticsPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [months, setMonths] = useState(6);
  const [month, setMonth] = useState(monthNow());
  const [divisionId, setDivisionId] = useState('');
  const divisions = useQuery({
    queryKey: ['divisions'],
    queryFn: () => api<{ id: string; name: string }[]>('/v1/divisions'),
  });
  const q = useQuery({
    queryKey: ['analytics', months],
    queryFn: () => api<any>('/v1/analytics', { query: { months } }),
  });
  const reports = useQuery({
    queryKey: ['reports'],
    queryFn: () => api<any[]>('/v1/reports'),
    enabled: can('reports:read'),
  });
  const div = divisionId || divisions.data?.[0]?.id;

  const gen = useMutation({
    mutationFn: () =>
      postDownload(
        '/v1/reports/monthly',
        { divisionId: div, month },
        `RAILGUARD-report-${month}.pdf`,
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['reports'] });
    },
  });
  const open = useMutation({
    mutationFn: (id: string) => api<{ url: string }>(`/v1/reports/${id}/url`),
    onSuccess: (r) => window.open(r.url, '_blank', 'noopener'),
  });

  return (
    <>
      <PageTitle
        title="Analytics & reports"
        sub="Quality of detections, inspection effort and monthly division reports"
        actions={
          <Select
            aria-label="Months"
            value={months}
            onChange={(e) => setMonths(Number(e.target.value))}
          >
            {[3, 6, 12].map((m) => (
              <option key={m} value={m}>
                Last {m} months
              </option>
            ))}
          </Select>
        }
      />
      <Async q={q}>
        {(a) => {
          const overallP = (() => {
            const c = a.precisionByMonth.reduce((s: number, r: any) => s + r.confirmed, 0);
            const r = a.precisionByMonth.reduce((s: number, x: any) => s + x.rejected, 0);
            return c + r ? c / (c + r) : null;
          })();
          const saved = a.timeSaved.byMonth.reduce(
            (s: number, r: any) => s + (r.hoursSaved ?? 0),
            0,
          );
          return (
            <>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Stat
                  label="Precision (reviewed)"
                  value={pct(overallP)}
                  sub="confirmed ÷ (confirmed + rejected)"
                />
                <Stat
                  label="Detection lead time"
                  value={
                    a.leadTimeHours.median != null ? `${num(a.leadTimeHours.median, 1)} h` : '—'
                  }
                  sub={`median to review · ${a.leadTimeHours.reviewed} reviewed`}
                />
                <Stat
                  label="False alarms / km"
                  value={num(a.falseAlarmsPerKm.at(-1)?.perKm, 3)}
                  sub="latest month"
                />
                <Stat
                  label="Inspection time saved"
                  value={
                    a.timeSaved.baselineMinPerKm == null ? 'Set baseline' : `${num(saved, 1)} h`
                  }
                  sub={
                    a.timeSaved.baselineMinPerKm == null
                      ? 'Admin → Settings'
                      : `vs ${a.timeSaved.baselineMinPerKm} min/km baseline`
                  }
                />
              </div>
              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                <Card>
                  <CardHeader
                    title="Defects per km, by section and month"
                    sub="Excludes rejected detections"
                  />
                  <div className="h-64 p-3">
                    {a.defectsPerKm.length ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={a.defectsPerKm}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} />
                          <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                          <YAxis tick={{ fontSize: 11 }} />
                          <Tooltip />
                          <Legend wrapperStyle={{ fontSize: 11 }} />
                          {a.sections.map((s: string, i: number) => (
                            <Bar key={s} dataKey={s} fill={PALETTE[i % PALETTE.length]} />
                          ))}
                        </BarChart>
                      </ResponsiveContainer>
                    ) : (
                      <EmptyState title="No detections in this period" />
                    )}
                  </div>
                </Card>
                <Card>
                  <CardHeader title="Precision and false alarms per km" />
                  <div className="h-64 p-3">
                    {a.precisionByMonth.length ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart
                          data={a.precisionByMonth.map((p: any, i: number) => ({
                            month: p.month,
                            precision: p.precision != null ? Math.round(p.precision * 100) : null,
                            falseAlarms: a.falseAlarmsPerKm[i]?.perKm,
                          }))}
                        >
                          <CartesianGrid strokeDasharray="3 3" vertical={false} />
                          <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                          <YAxis yAxisId="l" domain={[0, 100]} unit="%" tick={{ fontSize: 11 }} />
                          <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 11 }} />
                          <Tooltip />
                          <Legend wrapperStyle={{ fontSize: 11 }} />
                          <Line
                            yAxisId="l"
                            dataKey="precision"
                            name="Precision %"
                            stroke="#1FA88A"
                          />
                          <Line
                            yAxisId="r"
                            dataKey="falseAlarms"
                            name="False alarms / km"
                            stroke="#E8643A"
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    ) : (
                      <EmptyState title="No reviews yet" />
                    )}
                  </div>
                </Card>
              </div>
              <Card className="mt-4">
                <CardHeader title="Precision by defect class" />
                <Table>
                  <thead>
                    <tr>
                      <Th>Class</Th>
                      <Th>Confirmed</Th>
                      <Th>Rejected</Th>
                      <Th>Precision</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {a.precisionByClass.map((r: any) => (
                      <tr key={r.defectClass}>
                        <Td>{pretty(r.defectClass)}</Td>
                        <Td>{r.confirmed}</Td>
                        <Td>{r.rejected}</Td>
                        <Td>{pct(r.precision)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </Card>
              <p className="mt-2 text-xs text-ink-soft">{a.timeSaved.note}</p>
            </>
          );
        }}
      </Async>

      {can('reports:read') && (
        <Card className="mt-4">
          <CardHeader
            title="Monthly PDF report"
            sub="Generated on the server and stored privately"
          />
          <div className="flex flex-wrap items-end gap-3 p-4">
            <Field label="Division">
              <Select value={div ?? ''} onChange={(e) => setDivisionId(e.target.value)}>
                {divisions.data?.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Month">
              <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
            </Field>
            <Button disabled={!div || gen.isPending} onClick={() => gen.mutate()}>
              <FileText className="h-4 w-4" /> {gen.isPending ? 'Generating…' : 'Generate report'}
            </Button>
          </div>
          {gen.isSuccess && (
            <p role="status" className="px-4 pb-3 text-sm text-ink-soft">
              Report downloaded as PDF.
              {gen.data &&
                !gen.data.archived &&
                ' (It could not be archived to storage; check the R2 settings.)'}
            </p>
          )}
          {gen.error && (
            <p role="alert" className="px-4 pb-3 text-sm text-risk-5">
              {(gen.error as Error).message}
            </p>
          )}
          {reports.data && reports.data.length > 0 && (
            <Table>
              <thead>
                <tr>
                  <Th>Division</Th>
                  <Th>Month</Th>
                  <Th>Generated</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {reports.data.map((r) => (
                  <tr key={r.id}>
                    <Td>{r.division.name}</Td>
                    <Td>{r.month}</Td>
                    <Td>{dt(r.createdAt)}</Td>
                    <Td>
                      <Button size="sm" variant="ghost" onClick={() => open.mutate(r.id)}>
                        Open PDF
                      </Button>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      )}
    </>
  );
}
