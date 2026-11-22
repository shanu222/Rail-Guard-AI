'use client';
import { type ReactNode } from 'react';
import { Card, CardHeader } from '@/components/ui';

/* Palette (matches tailwind.config): navy / accent / teal / slate */
const NAVY = '#0F1B2D';
const NAVY2 = '#1E3350';
const ACC = '#E8643A';
const TEAL = '#1FA88A';
const SLATE = '#5B6675';
const LIGHT = '#EEF2F6';
const LINE = '#C9D2DC';

// ------------------------------------------------------------------ instrument pictures
/** Simple, clearly schematic illustrations (not photographs of a specific product). */
export type InstrumentArt =
  | 'camera'
  | 'imu'
  | 'mic'
  | 'gnss'
  | 'compute'
  | 'modem'
  | 'power'
  | 'enclosure'
  | 'nightcam'
  | 'trainsensor'
  | 'beacon'
  | 'solar'
  | 'thermal'
  | 'mast';

const art: Record<InstrumentArt, ReactNode> = {
  camera: (
    <>
      <rect x="10" y="22" width="44" height="28" rx="4" fill={NAVY2} />
      <rect x="18" y="16" width="14" height="8" rx="2" fill={NAVY2} />
      <circle cx="40" cy="36" r="10" fill={LIGHT} />
      <circle cx="40" cy="36" r="6" fill={NAVY} />
      <circle cx="38" cy="34" r="2" fill="#fff" />
      <path d="M54 30 L68 24 L68 48 L54 42 Z" fill={ACC} opacity=".35" />
    </>
  ),
  imu: (
    <>
      <rect x="16" y="18" width="40" height="40" rx="4" fill={TEAL} />
      <rect x="26" y="28" width="20" height="20" rx="2" fill={NAVY} />
      <path d="M36 12 V24 M36 12 l-3 4 M36 12 l3 4" stroke={NAVY} strokeWidth="2" fill="none" />
      <path d="M62 38 H52 M62 38 l-4 -3 M62 38 l-4 3" stroke={NAVY} strokeWidth="2" fill="none" />
      <path d="M10 62 L20 52 M10 62 l1 -5 M10 62 l5 -1" stroke={NAVY} strokeWidth="2" fill="none" />
      <text x="36" y="42" fontSize="8" fill="#fff" textAnchor="middle" fontWeight="700">
        XYZ
      </text>
    </>
  ),
  mic: (
    <>
      <rect x="28" y="10" width="16" height="30" rx="8" fill={NAVY2} />
      <path d="M22 30 a14 14 0 0 0 28 0" stroke={SLATE} strokeWidth="3" fill="none" />
      <path d="M36 44 V56 M28 56 H44" stroke={SLATE} strokeWidth="3" />
      <path d="M52 18 q6 8 0 16 M58 14 q10 12 0 24" stroke={ACC} strokeWidth="2" fill="none" />
    </>
  ),
  gnss: (
    <>
      <ellipse cx="36" cy="48" rx="20" ry="7" fill={NAVY2} />
      <rect x="22" y="36" width="28" height="12" rx="3" fill={SLATE} />
      <circle cx="56" cy="14" r="5" fill={ACC} />
      <path d="M52 18 L40 34 M46 12 q-6 2 -8 8" stroke={ACC} strokeWidth="2" fill="none" />
      <path d="M14 20 l6 -6 l4 4 l-6 6 z" fill={TEAL} />
    </>
  ),
  compute: (
    <>
      <rect x="10" y="16" width="52" height="40" rx="4" fill={NAVY} />
      <rect x="24" y="26" width="24" height="20" rx="2" fill={ACC} />
      <text x="36" y="39" fontSize="8" fill="#fff" textAnchor="middle" fontWeight="700">
        AI
      </text>
      {[20, 28, 36, 44, 52].map((x) => (
        <rect key={x} x={x - 1} y="10" width="2" height="6" fill={SLATE} />
      ))}
      {[20, 28, 36, 44, 52].map((x) => (
        <rect key={`b${x}`} x={x - 1} y="56" width="2" height="6" fill={SLATE} />
      ))}
    </>
  ),
  modem: (
    <>
      <rect x="14" y="30" width="44" height="26" rx="4" fill={NAVY2} />
      <rect x="46" y="10" width="4" height="22" fill={SLATE} />
      <path d="M38 14 q10 -8 20 0 M34 8 q14 -10 28 0" stroke={ACC} strokeWidth="2" fill="none" />
      <text x="34" y="47" fontSize="9" fill="#fff" textAnchor="middle" fontWeight="700">
        LTE
      </text>
    </>
  ),
  power: (
    <>
      <rect x="12" y="20" width="44" height="34" rx="4" fill={TEAL} />
      <rect x="56" y="30" width="6" height="14" rx="1" fill={TEAL} />
      <path d="M36 24 L28 39 H36 L32 50 L44 34 H36 L40 24 Z" fill="#fff" />
    </>
  ),
  enclosure: (
    <>
      <rect x="12" y="12" width="48" height="48" rx="5" fill={SLATE} />
      <rect x="17" y="17" width="38" height="38" rx="3" fill={LIGHT} />
      <circle cx="20" cy="20" r="2" fill={SLATE} />
      <circle cx="52" cy="20" r="2" fill={SLATE} />
      <circle cx="20" cy="52" r="2" fill={SLATE} />
      <circle cx="52" cy="52" r="2" fill={SLATE} />
      <text x="36" y="40" fontSize="9" fill={NAVY} textAnchor="middle" fontWeight="700">
        IP65
      </text>
    </>
  ),
  nightcam: (
    <>
      <rect x="8" y="24" width="44" height="24" rx="10" fill={NAVY2} />
      <circle cx="44" cy="36" r="8" fill={NAVY} />
      <circle cx="44" cy="36" r="4" fill={ACC} />
      {[0, 1, 2].map((i) => (
        <circle key={i} cx={16 + i * 7} cy="36" r="2" fill="#B33" />
      ))}
      <rect x="26" y="48" width="6" height="12" fill={SLATE} />
      <path d="M54 28 L70 20 M54 36 H70 M54 44 L70 52" stroke={ACC} strokeWidth="2" />
    </>
  ),
  trainsensor: (
    <>
      <rect x="4" y="44" width="64" height="5" fill={SLATE} />
      <rect x="4" y="54" width="64" height="5" fill={SLATE} />
      {[10, 24, 38, 52, 66].map((x) => (
        <rect key={x} x={x - 3} y="40" width="6" height="24" fill="#8B6B4A" />
      ))}
      <rect x="26" y="30" width="20" height="12" rx="2" fill={ACC} />
      <path d="M36 18 v8 M30 20 l6 -6 l6 6" stroke={NAVY} strokeWidth="2" fill="none" />
    </>
  ),
  beacon: (
    <>
      <rect x="30" y="34" width="12" height="28" fill={SLATE} />
      <path d="M24 34 a12 12 0 0 1 24 0 Z" fill="#D62839" />
      <rect x="22" y="34" width="28" height="4" fill={NAVY} />
      <path d="M14 20 l6 6 M58 20 l-6 6 M36 10 v8" stroke={ACC} strokeWidth="3" />
      <path d="M52 46 h8 l6 -6 v20 l-6 -6 h-8 z" fill={NAVY2} />
    </>
  ),
  solar: (
    <>
      <path d="M10 46 L22 18 H62 L50 46 Z" fill={NAVY2} />
      <path
        d="M20 23 H58 M16 32 H54 M13 40 H51 M32 18 L22 46 M44 18 L34 46"
        stroke="#5D8BC9"
        strokeWidth="1.2"
      />
      <rect x="34" y="46" width="4" height="14" fill={SLATE} />
      <circle cx="62" cy="10" r="6" fill="#F2B01E" />
    </>
  ),
  thermal: (
    <>
      <rect
        x="30"
        y="10"
        width="12"
        height="38"
        rx="6"
        fill={LIGHT}
        stroke={SLATE}
        strokeWidth="2"
      />
      <circle cx="36" cy="54" r="9" fill="#D62839" />
      <rect x="33" y="24" width="6" height="28" fill="#D62839" />
      <circle cx="56" cy="30" r="10" fill="none" stroke={TEAL} strokeWidth="3" />
      <path d="M56 20 v20 M46 30 h20" stroke={TEAL} strokeWidth="2" />
    </>
  ),
  mast: (
    <>
      <rect x="33" y="8" width="6" height="56" fill={SLATE} />
      <rect x="24" y="64" width="24" height="4" fill={NAVY} />
      <rect x="39" y="14" width="16" height="10" rx="2" fill={NAVY2} />
      <path d="M14 28 L30 22 L30 34 Z" fill={NAVY2} />
      <path d="M44 34 l-6 10 h6 l-4 10" stroke="#F2B01E" strokeWidth="2.5" fill="none" />
    </>
  ),
};

export function InstrumentPicture({ kind, label }: { kind: InstrumentArt; label: string }) {
  return (
    <svg
      viewBox="0 0 72 72"
      role="img"
      aria-label={label}
      className="h-16 w-16 shrink-0 rounded-lg bg-slate-50 p-1 ring-1 ring-line"
    >
      {art[kind]}
    </svg>
  );
}

// ------------------------------------------------------------------ wiring diagrams
type Node = { id: string; x: number; y: number; label: string; sub?: string; kind: InstrumentArt };
type Link = { to: string; label: string; power?: boolean };

function WiringDiagram({
  title,
  hub,
  nodes,
  links,
}: {
  title: string;
  hub: { label: string; sub: string };
  nodes: Node[];
  links: Link[];
}) {
  const W = 900;
  const H = 440;
  const hx = W / 2;
  const hy = H / 2;
  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title} className="min-w-[720px] w-full">
        <rect x="0" y="0" width={W} height={H} fill="#FAFBFC" rx="12" />
        {nodes.map((n) => {
          const l = links.find((k) => k.to === n.id)!;
          const mx = (n.x + hx) / 2;
          const my = (n.y + hy) / 2;
          return (
            <g key={`l${n.id}`}>
              <line
                x1={n.x}
                y1={n.y}
                x2={hx}
                y2={hy}
                stroke={l.power ? TEAL : NAVY2}
                strokeWidth="2.5"
                strokeDasharray={l.power ? '7 5' : undefined}
              />
              <rect
                x={mx - l.label.length * 3.3 - 6}
                y={my - 10}
                width={l.label.length * 6.6 + 12}
                height="20"
                rx="10"
                fill="#fff"
                stroke={LINE}
              />
              <text x={mx} y={my + 4} fontSize="11" textAnchor="middle" fill={SLATE}>
                {l.label}
              </text>
            </g>
          );
        })}
        <rect x={hx - 95} y={hy - 44} width="190" height="88" rx="12" fill={NAVY} />
        <text x={hx} y={hy - 8} fontSize="15" fontWeight="700" textAnchor="middle" fill="#fff">
          {hub.label}
        </text>
        <text x={hx} y={hy + 14} fontSize="11" textAnchor="middle" fill="#C7D0DC">
          {hub.sub}
        </text>
        {nodes.map((n) => (
          <g key={n.id} transform={`translate(${n.x - 85}, ${n.y - 30})`}>
            <rect width="170" height="60" rx="10" fill="#fff" stroke={LINE} strokeWidth="1.5" />
            <g transform="translate(6,6) scale(0.67)">{art[n.kind]}</g>
            <text x="62" y="27" fontSize="12" fontWeight="700" fill={NAVY}>
              {n.label}
            </text>
            {n.sub && (
              <text x="62" y="44" fontSize="10" fill={SLATE}>
                {n.sub}
              </text>
            )}
          </g>
        ))}
        <g transform={`translate(16, ${H - 24})`}>
          <line x1="0" y1="0" x2="28" y2="0" stroke={NAVY2} strokeWidth="2.5" />
          <text x="34" y="4" fontSize="11" fill={SLATE}>
            data
          </text>
          <line
            x1="80"
            y1="0"
            x2="108"
            y2="0"
            stroke={TEAL}
            strokeWidth="2.5"
            strokeDasharray="7 5"
          />
          <text x="114" y="4" fontSize="11" fill={SLATE}>
            power
          </text>
        </g>
      </svg>
    </div>
  );
}

export function TrackUnitWiring() {
  return (
    <WiringDiagram
      title="Track Unit wiring"
      hub={{ label: 'Edge AI compute', sub: 'runs detection models · SSD queue' }}
      nodes={[
        { id: 'cam', x: 130, y: 60, label: 'Track cameras', sub: 'down + oblique', kind: 'camera' },
        {
          id: 'imu',
          x: 450,
          y: 50,
          label: 'Accelerometer / IMU',
          sub: 'axle-box mount',
          kind: 'imu',
        },
        { id: 'mic', x: 770, y: 60, label: 'Microphone', sub: 'wind-shielded', kind: 'mic' },
        { id: 'gnss', x: 130, y: 380, label: 'GNSS receiver', sub: 'roof antenna', kind: 'gnss' },
        { id: 'lte', x: 450, y: 390, label: 'LTE modem', sub: 'to RAILGUARD API', kind: 'modem' },
        {
          id: 'pwr',
          x: 770,
          y: 380,
          label: 'Power supply',
          sub: 'vehicle / battery',
          kind: 'power',
        },
      ]}
      links={[
        { to: 'cam', label: 'USB 3 / GigE' },
        { to: 'imu', label: 'SPI / I²C' },
        { to: 'mic', label: 'USB audio / I²S' },
        { to: 'gnss', label: 'UART / USB' },
        { to: 'lte', label: 'M.2 / USB' },
        { to: 'pwr', label: '12–24 V DC, fused', power: true },
      ]}
    />
  );
}

export function CrossingUnitWiring() {
  return (
    <WiringDiagram
      title="Crossing Unit wiring"
      hub={{ label: 'Edge AI compute', sub: 'danger-zone detection · local alarm' }}
      nodes={[
        {
          id: 'cam',
          x: 130,
          y: 60,
          label: 'Day/night camera',
          sub: 'IR, covers danger zone',
          kind: 'nightcam',
        },
        {
          id: 'train',
          x: 450,
          y: 50,
          label: 'Train-approach input',
          sub: 'track sensor / signal',
          kind: 'trainsensor',
        },
        { id: 'warn', x: 770, y: 60, label: 'Lights + siren', sub: 'via relay', kind: 'beacon' },
        {
          id: 'solar',
          x: 130,
          y: 380,
          label: 'Solar + battery',
          sub: 'MPPT controller',
          kind: 'solar',
        },
        { id: 'lte', x: 450, y: 390, label: 'LTE modem', sub: 'to RAILGUARD API', kind: 'modem' },
        {
          id: 'temp',
          x: 770,
          y: 380,
          label: 'Temperature / fan',
          sub: 'enclosure cooling',
          kind: 'thermal',
        },
      ]}
      links={[
        { to: 'cam', label: 'Ethernet (PoE) / USB' },
        { to: 'train', label: 'Digital input (isolated)' },
        { to: 'warn', label: 'Relay output' },
        { to: 'solar', label: '12 V DC + charge data', power: true },
        { to: 'lte', label: 'M.2 / USB' },
        { to: 'temp', label: 'GPIO / 1-Wire' },
      ]}
    />
  );
}

// ------------------------------------------------------------------ full system flow
function Box({
  x,
  y,
  w,
  h,
  title,
  lines,
  fill = '#fff',
  dark = false,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
  lines: string[];
  fill?: string;
  dark?: boolean;
}) {
  return (
    <g transform={`translate(${x},${y})`}>
      <rect
        width={w}
        height={h}
        rx="10"
        fill={fill}
        stroke={dark ? fill : LINE}
        strokeWidth="1.5"
      />
      <text x="12" y="22" fontSize="13" fontWeight="700" fill={dark ? '#fff' : NAVY}>
        {title}
      </text>
      {lines.map((l, i) => (
        <text key={l} x="12" y={42 + i * 16} fontSize="11" fill={dark ? '#C7D0DC' : SLATE}>
          {l}
        </text>
      ))}
    </g>
  );
}

function Arrow({
  d,
  label,
  lx,
  ly,
  color = NAVY2,
}: {
  d: string;
  label?: string;
  lx?: number;
  ly?: number;
  color?: string;
}) {
  return (
    <g>
      <path d={d} stroke={color} strokeWidth="2.2" fill="none" markerEnd="url(#arrow)" />
      {label && (
        <text x={lx} y={ly} fontSize="10.5" fill={SLATE} textAnchor="middle">
          {label}
        </text>
      )}
    </g>
  );
}

export function SystemFlowDiagram() {
  return (
    <div className="overflow-x-auto">
      <svg
        viewBox="0 0 1100 640"
        role="img"
        aria-label="RAILGUARD AI system flow"
        className="min-w-[900px] w-full"
      >
        <defs>
          <marker
            id="arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M0 0 L10 5 L0 10 z" fill={NAVY2} />
          </marker>
        </defs>
        <rect width="1100" height="640" rx="14" fill="#FAFBFC" />

        {/* lane labels */}
        {[
          ['1  FIELD (edge devices)', 20],
          ['2  NETWORK & EDGE SECURITY', 300],
          ['3  CLOUD PLATFORM', 520],
          ['4  PEOPLE & ACTION', 860],
        ].map(([t, x]) => (
          <text key={t as string} x={x as number} y="30" fontSize="12" fontWeight="700" fill={ACC}>
            {t}
          </text>
        ))}

        {/* field */}
        <Box
          x={20}
          y={50}
          w={250}
          h={150}
          title="Track Unit (trolley / locomotive)"
          lines={[
            'Cameras · IMU · microphone · GNSS',
            'Edge AI finds defects on board',
            'Store-and-forward queue (offline OK)',
            'Sends detections, images, runs',
          ]}
        />
        <Box
          x={20}
          y={225}
          w={250}
          h={150}
          title="Crossing Unit (solar, unmanned LC)"
          lines={[
            'Day/night camera · train input',
            'Detects vehicles/people/livestock',
            'Triggers lights + siren LOCALLY',
            'Sends events, snapshots (blurred)',
          ]}
        />
        <Box
          x={20}
          y={400}
          w={250}
          h={110}
          title="Admin inputs (no hardware)"
          lines={[
            'Track lines (GeoJSON/KML), crossings',
            'Weather: max temp, rainfall, flood',
            'Risk weights, users, devices',
          ]}
        />

        {/* network */}
        <Box
          x={300}
          y={120}
          w={190}
          h={130}
          title="4G / LTE"
          lines={[
            'HTTPS + device API key',
            'gzip batches, client UUIDs',
            'resend is safe (idempotent)',
          ]}
        />
        <Box
          x={300}
          y={290}
          w={190}
          h={130}
          title="Cloudflare"
          lines={['DNS + WAF rate limits', 'TLS (Full strict)', 'R2 media storage (private)']}
        />

        {/* cloud */}
        <Box
          x={520}
          y={50}
          w={310}
          h={120}
          dark
          fill={NAVY}
          title="RAILGUARD API  (Railway.app)"
          lines={[
            '/v1/ingest: validate, snap to 100 m segment',
            'Auth (JWT, roles), reports, admin',
            'Live updates via Socket.IO',
          ]}
        />
        <Box
          x={520}
          y={195}
          w={145}
          h={110}
          title="PostgreSQL + PostGIS"
          lines={['segments, detections', 'events, scores, audit']}
        />
        <Box
          x={685}
          y={195}
          w={145}
          h={110}
          title="Redis + Worker"
          lines={['risk engine jobs', 'offline watch, purge']}
        />
        <Box
          x={520}
          y={330}
          w={310}
          h={110}
          title="Risk engine (every 100 m segment)"
          lines={[
            'defect · trend · heat · flood · local factors',
            'score 1–5, components stored and explained',
            'Decision aid — confirm on site',
          ]}
        />
        <Box
          x={520}
          y={465}
          w={310}
          h={95}
          title="Cloudflare R2"
          lines={['images, audio, snapshots, PDF reports', '5-minute signed links only']}
        />

        {/* people */}
        <Box
          x={860}
          y={50}
          w={220}
          h={130}
          dark
          fill={ACC}
          title="Dashboard (Vercel)"
          lines={[
            'Overview · Risk Map · Detections',
            'Crossings · Devices · Analytics',
            'Reports (PDF) · Admin',
          ]}
        />
        <Box
          x={860}
          y={205}
          w={220}
          h={120}
          title="Inspector (mobile, offline)"
          lines={['Confirm / reject alerts', 'Field photos, notes', 'Syncs when network returns']}
        />
        <Box
          x={860}
          y={350}
          w={220}
          h={110}
          title="Divisional Engineer"
          lines={['Work orders on risky segments', 'Monthly PDF report', 'Risk weights (approval)']}
        />
        <Box
          x={860}
          y={485}
          w={220}
          h={95}
          title="Maintenance gang"
          lines={['Repairs on site', 'Closes work order → risk falls']}
        />

        {/* arrows */}
        <Arrow d="M270 125 L300 170" label="" />
        <Arrow d="M270 300 L300 200" />
        <Arrow d="M395 250 L395 290" />
        <Arrow d="M490 150 L520 115" label="HTTPS" lx={505} ly={120} />
        <Arrow d="M270 455 C 400 470, 450 470, 520 140" label="admin UI" lx={430} ly={480} />
        <Arrow d="M600 170 L600 195" />
        <Arrow d="M760 170 L760 195" />
        <Arrow d="M675 305 L675 330" />
        <Arrow d="M675 440 L675 465" />
        <Arrow d="M490 360 L520 510" label="media" lx={492} ly={450} />
        <Arrow d="M830 110 L860 110" label="live" lx={845} ly={100} />
        <Arrow d="M970 180 L970 205" />
        <Arrow d="M970 325 L970 350" />
        <Arrow d="M970 460 L970 485" />
        <Arrow d="M860 265 C 840 290, 845 360, 830 385" label="reviews" lx={836} ly={300} />
        <Arrow d="M860 530 C 845 520, 845 430, 830 410" label="repair done" lx={826} ly={470} />

        <text x="20" y="610" fontSize="11" fill={SLATE}>
          Warnings at crossings never depend on the network: the Crossing Unit decides and sounds
          the alarm locally; the cloud only records events.
        </text>
      </svg>
    </div>
  );
}

const Steps = ({ items }: { items: [string, string][] }) => (
  <ol className="divide-y divide-line">
    {items.map(([t, d], i) => (
      <li key={t} className="flex gap-3 px-4 py-3">
        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-navy text-xs font-bold text-white">
          {i + 1}
        </span>
        <div className="text-sm">
          <div className="font-medium text-ink">{t}</div>
          <div className="text-ink-soft">{d}</div>
        </div>
      </li>
    ))}
  </ol>
);

/** Admin > System diagram: how every part of RAILGUARD AI connects. */
export function SystemTab() {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="RAILGUARD AI - full system flow"
          sub="From sensors on the track to a repaired defect. Scroll sideways on a phone."
        />
        <div className="p-3">
          <SystemFlowDiagram />
        </div>
      </Card>
      <Card>
        <CardHeader title="How data moves, step by step" />
        <Steps
          items={[
            [
              'Sense',
              'Track Units record images, vibration, sound and position during an inspection run; Crossing Units watch the danger zone 24/7.',
            ],
            [
              'Decide on the device',
              'Edge AI detects defects or danger-zone objects. Crossing Units sound lights and siren locally when a train approaches.',
            ],
            [
              'Send safely',
              'Results go over 4G with the device key. If there is no signal they queue on the device and are resent later without duplicates.',
            ],
            [
              'Store and locate',
              'The API validates every record, snaps detections to the nearest 100 m segment, and stores media privately in R2.',
            ],
            [
              'Score the risk',
              'The risk engine combines defects, trend, heat, flood and local factors into a 1–5 score for every segment.',
            ],
            [
              'Show live',
              'The dashboard updates instantly: risk map, detections, crossings, device health and analytics.',
            ],
            [
              'Confirm on site',
              'Inspectors confirm or reject alerts on their phone (works offline). Confirmed defects raise the score; rejected ones remove it.',
            ],
            [
              'Act and report',
              'Engineers raise work orders; closing a work order lowers the risk. Monthly PDF reports summarise everything.',
            ],
          ]}
        />
      </Card>
      <Card>
        <CardHeader title="Track Unit - how the instruments connect" />
        <div className="p-3">
          <TrackUnitWiring />
        </div>
      </Card>
      <Card>
        <CardHeader title="Crossing Unit - how the instruments connect" />
        <div className="p-3">
          <CrossingUnitWiring />
        </div>
      </Card>
      <p className="text-xs text-ink-soft">
        Diagrams are schematic reference designs. Interfaces shown are typical options; final
        hardware and wiring are set by RTL engineering.
      </p>
    </div>
  );
}
