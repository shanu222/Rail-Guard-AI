'use client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { RiskMap, type Basemap, type MapMode, type RailOverlay } from '@/components/map-lazy';
import {
  Badge,
  Button,
  Disclaimer,
  RiskChip,
  Skeleton,
  severityTone,
  statusTone,
} from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { CHAINAGE, dt, num, pct, pretty } from '@/lib/format';
import { CreateWorkOrder, Legend5 } from '@/components/extras';

const COMPONENTS = [
  ['defect', 'Defects'],
  ['trend', 'Trend'],
  ['heat', 'Heat'],
  ['flood', 'Flood'],
  ['local', 'Local factors'],
] as const;

export default function RiskMapPage() {
  const router = useRouter();
  const { can } = useAuth();
  const qc = useQueryClient();
  const [mode, setMode] = useState<MapMode>('risk');
  const [showDet, setShowDet] = useState(true);
  const [basemap, setBasemap] = useState<Basemap>('streets');
  const [rail, setRail] = useState<RailOverlay>('standard');
  const [terrain3d, setTerrain3d] = useState(false);
  const [panelOpen, setPanelOpen] = useState(true);
  const [sel, setSel] = useState<string | null>(null);
  const [woOpen, setWoOpen] = useState(false);

  const segs = useQuery({
    queryKey: ['segments', 'all'],
    queryFn: () => api<GeoJSON.FeatureCollection>('/v1/map/segments'),
  });
  const crossings = useQuery({
    queryKey: ['map-crossings'],
    queryFn: () => api<any[]>('/v1/map/crossings'),
  });
  const dets = useQuery({
    queryKey: ['map-detections'],
    queryFn: () => api<GeoJSON.FeatureCollection>('/v1/map/detections'),
    enabled: showDet,
  });
  const detail = useQuery({
    queryKey: ['segment', sel],
    queryFn: () => api<any>(`/v1/segments/${sel}`),
    enabled: !!sel,
  });

  const d = detail.data;
  const c = d?.latest?.components;

  return (
    <div className="-m-4 flex flex-col lg:-m-6 lg:h-[calc(100dvh-57px)] lg:flex-row">
      {/* phone/tablet: map takes most of the screen, details scroll below it */}
      <div className="relative h-[68dvh] min-h-[360px] lg:h-auto lg:flex-1">
        <RiskMap
          segments={segs.data}
          detections={showDet ? dets.data : undefined}
          crossings={crossings.data ?? []}
          mode={mode}
          selectedSegmentId={sel}
          onSelectSegment={(id) => {
            setSel(id);
            // on phones the details sit under the map: bring them into view
            if (window.matchMedia('(max-width: 1023px)').matches)
              setTimeout(
                () =>
                  document
                    .getElementById('segment-details')
                    ?.scrollIntoView({ behavior: 'smooth' }),
                50,
              );
          }}
          onSelectDetection={(id) => router.push(`/detections/${id}`)}
          onSelectCrossing={(id) => router.push(`/crossings/${id}`)}
          basemap={basemap}
          rail={rail}
          terrain3d={terrain3d}
          className="absolute inset-0"
        />
        <div className="absolute start-2 top-2 z-10 max-h-[calc(100%-5rem)] w-[min(15rem,calc(100%-4.5rem))] overflow-y-auto rounded-xl border border-line bg-white/95 p-3 shadow sm:start-3 sm:top-3">
          <button
            type="button"
            className="flex w-full items-center justify-between text-xs font-semibold"
            aria-expanded={panelOpen}
            onClick={() => setPanelOpen((o) => !o)}
          >
            Layers <span aria-hidden>{panelOpen ? '▾' : '▸'}</span>
          </button>
          <div className={panelOpen ? 'mt-2 space-y-2' : 'hidden'}>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
              Colour track by
            </p>
            <div role="radiogroup" aria-label="Colour segments by" className="space-y-1 text-sm">
              {(
                [
                  ['risk', 'Risk score (1–5)'],
                  ['heat', 'Heat exposure'],
                  ['flood', 'Flood exposure'],
                ] as const
              ).map(([v, l]) => (
                <label key={v} className="flex cursor-pointer items-center gap-2">
                  <input
                    type="radio"
                    name="mode"
                    checked={mode === v}
                    onChange={() => setMode(v)}
                  />{' '}
                  {l}
                </label>
              ))}
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={showDet}
                onChange={(e) => setShowDet(e.target.checked)}
              />{' '}
              Detections
            </label>
            <p className="pt-1 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
              Real railway network (OSM)
            </p>
            <select
              aria-label="Railway overlay"
              className="w-full rounded-md border border-line bg-white px-2 py-1 text-sm"
              value={rail}
              onChange={(e) => setRail(e.target.value as RailOverlay)}
            >
              <option value="standard">Tracks &amp; stations</option>
              <option value="maxspeed">Maximum speed</option>
              <option value="signals">Signalling</option>
              <option value="none">Hide</option>
            </select>
            <p className="pt-1 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
              Base map
            </p>
            <div className="flex gap-1 text-sm">
              {(
                [
                  ['streets', 'Streets'],
                  ['topo', 'Terrain'],
                ] as const
              ).map(([v, l]) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={basemap === v}
                  onClick={() => setBasemap(v)}
                  className={`flex-1 rounded-md border px-2 py-1 ${basemap === v ? 'border-navy bg-navy text-white' : 'border-line bg-white'}`}
                >
                  {l}
                </button>
              ))}
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={terrain3d}
                onChange={(e) => setTerrain3d(e.target.checked)}
              />{' '}
              3D terrain
            </label>
            <p className="text-[11px] text-ink-soft">
              Press <b>PK</b> (top right) for the whole national network. Right-drag or two-finger
              drag to tilt in 3D.
            </p>
            <Disclaimer />
          </div>
        </div>
        <div className="absolute inset-x-0 bottom-0 z-10 bg-white/95">
          {mode === 'risk' ? (
            <Legend5 />
          ) : (
            <p className="px-4 py-2 text-xs">
              Green = low exposure → red = high exposure (0–1). Exposure is an input to the score,
              not a measurement.
            </p>
          )}
        </div>
        {segs.error && (
          <p
            role="alert"
            className="absolute start-1/2 top-3 z-10 -translate-x-1/2 rounded bg-white px-3 py-1 text-sm text-risk-5 shadow"
          >
            {(segs.error as Error).message}
          </p>
        )}
      </div>

      <aside
        className="w-full border-t border-line bg-white pb-20 lg:w-96 lg:overflow-auto lg:border-s lg:border-t-0 lg:pb-0"
        id="segment-details"
        aria-label="Segment details"
      >
        {!sel && (
          <p className="p-6 text-sm text-ink-soft">
            Click a track segment on the map to see its risk score, how it was calculated, history
            and detections.
          </p>
        )}
        {sel && detail.isLoading && (
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-8" />
            ))}
          </div>
        )}
        {sel && detail.error && (
          <p role="alert" className="p-4 text-sm text-risk-5">
            {(detail.error as Error).message}
          </p>
        )}
        {d && (
          <div className="space-y-4 p-4">
            <div>
              <p className="text-xs text-ink-soft">{d.segment.section_name}</p>
              <h2 className="text-lg font-semibold">
                Chainage {CHAINAGE(d.segment.chainage_start_m)} –{' '}
                {CHAINAGE(d.segment.chainage_end_m)}
              </h2>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <RiskChip score={d.latest?.score} />
                {d.segment.is_curve && <Badge>Curve</Badge>}
                {d.segment.has_bridge && <Badge>Bridge</Badge>}
                {d.segment.near_crossing_id && <Badge>Near crossing</Badge>}
              </div>
              <div className="mt-1">
                <Disclaimer />
              </div>
            </div>

            <section aria-label="Score breakdown">
              <h3 className="mb-2 text-sm font-semibold">
                Why this score?{' '}
                <span className="font-normal text-ink-soft">
                  (raw {num(d.latest?.rawValue, 3)})
                </span>
              </h3>
              {!c ? (
                <p className="text-sm text-ink-soft">No score calculated yet.</p>
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-ink-soft">
                      <th className="text-start font-medium">Component</th>
                      <th className="text-end font-medium">Value</th>
                      <th className="text-end font-medium">Weight</th>
                      <th className="text-end font-medium">Contribution</th>
                    </tr>
                  </thead>
                  <tbody>
                    {COMPONENTS.map(([k, l]) => (
                      <tr key={k} className="border-t border-line">
                        <td className="py-1.5">{l}</td>
                        <td className="text-end tabular-nums">{num(c[k], 2)}</td>
                        <td className="text-end tabular-nums">{c.weights[k]}</td>
                        <td className="text-end font-medium tabular-nums">
                          {num(c.contributions[k], 3)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {c && (
                <p className="mt-1 text-xs text-ink-soft">
                  {c.detectionCount} counted detection(s) in the last 90 days. Heat exposure{' '}
                  {pct(d.segment.heat_exposure, 0)}, flood exposure{' '}
                  {pct(d.segment.flood_exposure, 0)}.
                </p>
              )}
            </section>

            <section aria-label="Score history">
              <h3 className="mb-1 text-sm font-semibold">History</h3>
              {d.history.length < 2 ? (
                <p className="text-xs text-ink-soft">Not enough history yet.</p>
              ) : (
                <div className="h-28">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                      data={[...d.history]
                        .reverse()
                        .map((h: any) => ({ at: h.computedAt.slice(5, 10), score: h.score }))}
                    >
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="at" tick={{ fontSize: 10 }} />
                      <YAxis
                        domain={[1, 5]}
                        ticks={[1, 2, 3, 4, 5]}
                        tick={{ fontSize: 10 }}
                        width={20}
                      />
                      <Tooltip />
                      <Area type="stepAfter" dataKey="score" stroke="#E8643A" fill="#E8643A33" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}
            </section>

            <section aria-label="Detections">
              <h3 className="mb-1 text-sm font-semibold">Detections ({d.detections.length})</h3>
              <ul className="divide-y divide-line rounded-lg border border-line">
                {d.detections.map((x: any) => (
                  <li key={x.id}>
                    <Link
                      href={`/detections/${x.id}`}
                      className="flex items-center justify-between gap-2 px-3 py-2 text-sm hover:bg-slate-50"
                    >
                      <span>
                        {pretty(x.defectClass)}
                        <span className="block text-xs text-ink-soft">{dt(x.detectedAt)}</span>
                      </span>
                      <span className="flex gap-1">
                        <Badge tone={severityTone(x.severity)}>{x.severity}</Badge>
                        <Badge tone={statusTone(x.reviewStatus)}>{x.reviewStatus}</Badge>
                      </span>
                    </Link>
                  </li>
                ))}
                {!d.detections.length && (
                  <li className="px-3 py-3 text-xs text-ink-soft">
                    No detections on this segment.
                  </li>
                )}
              </ul>
            </section>

            {d.workOrders.length > 0 && (
              <p className="text-xs text-ink-soft">
                {d.workOrders.length} open work order(s) ·{' '}
                <Link href="/work-orders" className="text-accent underline">
                  view
                </Link>
              </p>
            )}
            {can('work-orders:assign') && (
              <Button className="w-full" onClick={() => setWoOpen(true)}>
                Create work order
              </Button>
            )}
          </div>
        )}
      </aside>

      {d && (
        <CreateWorkOrder
          open={woOpen}
          onClose={() => setWoOpen(false)}
          segmentId={sel!}
          detections={d.detections}
          onDone={() => {
            setWoOpen(false);
            void qc.invalidateQueries({ queryKey: ['segment', sel] });
          }}
        />
      )}
    </div>
  );
}
