'use client';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  Async,
  Badge,
  Card,
  CardHeader,
  PageTitle,
  Stat,
  Table,
  Td,
  Th,
  statusTone,
} from '@/components/ui';
import { api } from '@/lib/api';
import { ago, num, pretty } from '@/lib/format';

interface Dev {
  id: string;
  type: 'TRACK' | 'CROSSING';
  serial: string;
  name: string;
  firmwareVersion: string | null;
  modelVersion: string | null;
  lastSeenAt: string | null;
  minutesSinceSeen: number | null;
  batteryPct: number | null;
  solarW: number | null;
  temperatureC: number | null;
  storagePct: number | null;
  network: string | null;
  status: string;
  revokedAt: string | null;
  isDemo: boolean;
}

export default function DevicesPage() {
  const [sel, setSel] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ['devices'],
    queryFn: () =>
      api<{ devices: Dev[]; activeModels: { type: string; version: string }[] }>('/v1/devices'),
    refetchInterval: 30_000,
  });
  const count = (s: string) =>
    q.data?.devices.filter((d) => d.status === s && !d.revokedAt).length ?? 0;

  return (
    <>
      <PageTitle
        title="Devices"
        sub="Fleet health. Units silent for more than 30 minutes are flagged offline."
      />
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        <Stat label="Online" value={count('ONLINE')} tone="teal" />
        <Stat label="Degraded" value={count('DEGRADED')} />
        <Stat
          label="Offline"
          value={count('OFFLINE')}
          tone={count('OFFLINE') ? 'accent' : undefined}
        />
      </div>
      <Card className="mt-4">
        <CardHeader
          title="Fleet"
          sub={
            q.data
              ? `Active models: ${q.data.activeModels.map((m) => `${pretty(m.type)} ${m.version}`).join(' · ') || '—'}`
              : undefined
          }
        />
        <Async q={q} empty={(d) => d.devices.length === 0}>
          {({ devices }) => (
            <Table>
              <thead>
                <tr>
                  <Th>Device</Th>
                  <Th>Status</Th>
                  <Th>Last seen</Th>
                  <Th>Battery</Th>
                  <Th>Solar</Th>
                  <Th>Temp</Th>
                  <Th>Storage</Th>
                  <Th>Firmware / model</Th>
                </tr>
              </thead>
              <tbody>
                {devices.map((d) => (
                  <tr
                    key={d.id}
                    className={`cursor-pointer hover:bg-slate-50 ${sel === d.id ? 'bg-slate-50' : ''}`}
                    onClick={() => setSel(d.id)}
                    tabIndex={0}
                    onKeyDown={(e) => e.key === 'Enter' && setSel(d.id)}
                    aria-selected={sel === d.id}
                  >
                    <Td>
                      <span className="font-medium">{d.name}</span>
                      <span className="block text-xs text-ink-soft">
                        {d.serial} · {pretty(d.type)}
                        {d.isDemo ? ' · demo' : ''}
                      </span>
                    </Td>
                    <Td>
                      {d.revokedAt ? (
                        <Badge tone="red">Revoked</Badge>
                      ) : (
                        <Badge tone={statusTone(d.status)}>{d.status}</Badge>
                      )}
                      {(d.minutesSinceSeen ?? 0) > 30 && !d.revokedAt && (
                        <span className="ms-1 text-xs text-risk-5">&gt;30 min</span>
                      )}
                    </Td>
                    <Td className="text-xs">{ago(d.lastSeenAt)}</Td>
                    <Td
                      className={`tabular-nums ${d.batteryPct != null && d.batteryPct < 20 ? 'font-semibold text-risk-5' : ''}`}
                    >
                      {d.batteryPct != null ? `${Math.round(d.batteryPct)}%` : '—'}
                    </Td>
                    <Td className="tabular-nums">
                      {d.solarW != null ? `${num(d.solarW, 0)} W` : '—'}
                    </Td>
                    <Td className="tabular-nums">
                      {d.temperatureC != null ? `${num(d.temperatureC, 0)} °C` : '—'}
                    </Td>
                    <Td className="tabular-nums">
                      {d.storagePct != null ? `${Math.round(d.storagePct)}%` : '—'}
                    </Td>
                    <Td className="text-xs">
                      {d.firmwareVersion ?? '—'} / {d.modelVersion ?? '—'}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Async>
      </Card>
      {sel && <DeviceCharts id={sel} />}
    </>
  );
}

function DeviceCharts({ id }: { id: string }) {
  const q = useQuery({
    queryKey: ['device', id],
    queryFn: () =>
      api<{ device: Dev; series: any[] }>(`/v1/devices/${id}`, { query: { hours: 72 } }),
  });
  const chart = (key: string, title: string, color: string, domain?: [number, number]) => (
    <Card>
      <CardHeader title={title} sub="Last 72 hours" />
      <div className="h-48 p-3">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={q.data?.series.map((s) => ({
              ...s,
              t: new Date(s.at).toLocaleString('en-GB', {
                day: '2-digit',
                hour: '2-digit',
                hour12: false,
                timeZone: 'Asia/Karachi',
              }),
            }))}
          >
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="t" tick={{ fontSize: 10 }} minTickGap={40} />
            <YAxis domain={domain} tick={{ fontSize: 10 }} width={32} />
            <Tooltip />
            <Line type="monotone" dataKey={key} stroke={color} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
  return (
    <div className="mt-4">
      <h2 className="mb-2 text-sm font-semibold">{q.data?.device.name ?? 'Device'} telemetry</h2>
      <Async q={q} empty={(d) => d.series.length === 0}>
        {(d) => (
          <div className="grid gap-4 md:grid-cols-2">
            {chart('battery_pct', 'Battery %', '#1FA88A', [0, 100])}
            {d.device.type === 'CROSSING' && chart('solar_w', 'Solar input (W)', '#F2B01E')}
            {chart('temperature_c', 'Enclosure temperature (°C)', '#E8643A')}
            {chart('storage_pct', 'Storage used %', '#1E3350', [0, 100])}
          </div>
        )}
      </Async>
    </div>
  );
}
