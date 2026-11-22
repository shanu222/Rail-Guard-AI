'use client';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Badge, Button, Card, CardHeader, Field, Input, Select } from '@/components/ui';
import { API_URL, api } from '@/lib/api';
import { pretty } from '@/lib/format';

type Instrument = {
  name: string;
  role: string;
  feeds: string;
  note?: string;
};

const TRACK_KIT: Instrument[] = [
  {
    name: 'Track-facing cameras (down-looking and oblique, global-shutter or high-speed)',
    role: 'Capture rail, fasteners, sleepers, joints and ballast at trolley / locomotive speed.',
    feeds: 'Detections: source IMAGE, image upload, bounding box',
    note: 'Daylight use; add LED strobe or lighting if you inspect at dawn, dusk or in tunnels.',
  },
  {
    name: 'Tri-axial accelerometer / IMU (axle-box or bogie mounted)',
    role: 'Measures vibration to find rail-joint problems, surface defects and geometry irregularities.',
    feeds: 'Detections: source VIBRATION',
  },
  {
    name: 'Microphone (wind-shielded, rugged)',
    role: 'Records acoustic signatures of wheel-rail contact for fused detection.',
    feeds: 'Detections: source ACOUSTIC, audio clip upload',
  },
  {
    name: 'GNSS receiver (multi-constellation, external antenna)',
    role: 'Gives every detection latitude and longitude so it snaps to the nearest 100 m segment.',
    feeds: 'Detection lat / lon, heartbeat position, run distance',
  },
  {
    name: 'Edge AI compute module with industrial storage (SSD / eMMC)',
    role: 'Runs the detection models on the device and keeps a store-and-forward queue while offline.',
    feeds: 'Heartbeat: modelVersion, storagePct, queuedRecords',
  },
  {
    name: 'Cellular modem (4G / LTE) with external antenna, optional Wi-Fi',
    role: 'Uploads results when coverage exists; the queue is resent safely later.',
    feeds: 'Heartbeat: network',
  },
  {
    name: 'Power: vehicle supply or battery pack with DC-DC converter and fuse',
    role: 'Powers the unit from the trolley or locomotive.',
    feeds: 'Heartbeat: batteryPct, temperatureC',
  },
  {
    name: 'Rugged enclosure (IP65 or better), shock mounts, cabling',
    role: 'Protects the electronics from dust, rain, heat and vibration.',
    feeds: '-',
  },
];

const CROSSING_KIT: Instrument[] = [
  {
    name: 'Edge-vision camera covering the danger zone (day / night capable, IR illumination)',
    role: 'Detects vehicles, people and livestock in the danger zone; classifies objects.',
    feeds: 'Crossing events: objectClass, confidence, dwellSeconds, snapshot upload',
  },
  {
    name: 'Edge AI compute module',
    role: 'Runs detection locally so the warning does not depend on the network.',
    feeds: 'Heartbeat: modelVersion, storagePct',
  },
  {
    name: 'Train-approach input (e.g. track sensor, axle counter or signal feed - site specific)',
    role: 'Tells the unit that a train is approaching, so a danger-zone object becomes a warning.',
    feeds: 'Crossing events: trainApproaching',
    note: 'Choice depends on the line and Pakistan Railways approval.',
  },
  {
    name: 'Warning lights (strobe / LED beacon) and siren',
    role: 'Local warning when an object is in the danger zone while a train approaches.',
    feeds: 'Crossing events: warningTriggered',
  },
  {
    name: 'Solar panel, MPPT charge controller and battery (LiFePO4 or sealed lead-acid)',
    role: 'Powers the unit off-grid at unmanned crossings.',
    feeds: 'Heartbeat: solarW, batteryPct',
  },
  {
    name: 'Cellular modem (4G / LTE) with external antenna',
    role: 'Sends heartbeats and events to the platform.',
    feeds: 'Heartbeat: network, queuedRecords',
  },
  {
    name: 'Enclosure thermal management (vented or fan) and temperature probe',
    role: 'Keeps the unit within operating temperature in Pakistani summers.',
    feeds: 'Heartbeat: temperatureC',
  },
  {
    name: 'Pole / mast, mounting hardware, lightning and surge protection, GNSS',
    role: 'Mounts the camera and panel; GNSS confirms the crossing location.',
    feeds: 'Heartbeat position',
  },
];

function Kit({ items }: { items: Instrument[] }) {
  return (
    <ul className="divide-y divide-line">
      {items.map((i) => (
        <li key={i.name} className="grid gap-1 px-4 py-3 md:grid-cols-[1.2fr_1.4fr_1fr]">
          <div>
            <div className="text-sm font-medium text-ink">{i.name}</div>
            {i.note && <div className="mt-0.5 text-xs text-ink-soft">{i.note}</div>}
          </div>
          <div className="text-sm text-ink-soft">{i.role}</div>
          <div className="text-xs text-ink-soft">
            <span className="font-medium text-ink">Appears in the portal as: </span>
            {i.feeds}
          </div>
        </li>
      ))}
    </ul>
  );
}

const Step = ({ n, title, children }: { n: number; title: string; children: ReactNode }) => (
  <li className="flex gap-3 px-4 py-3">
    <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-bold text-white">
      {n}
    </span>
    <div className="text-sm">
      <div className="font-medium text-ink">{title}</div>
      <div className="mt-0.5 text-ink-soft">{children}</div>
    </div>
  </li>
);

const Code = ({ children }: { children: ReactNode }) => (
  <pre className="overflow-x-auto rounded-md bg-navy p-3 text-xs leading-relaxed text-white">
    {children}
  </pre>
);

/** Admin > Instruments & sensors: what hardware the platform expects, and where/how to add it. */
export function HardwareTab({ goToDevices }: { goToDevices?: () => void }) {
  const devices = useQuery({
    queryKey: ['devices'],
    queryFn: () => api<{ devices: any[] }>('/v1/devices'),
  });
  const list = devices.data?.devices ?? [];
  const count = (t: string) => list.filter((d) => d.type === t).length;
  const online = (t: string) => list.filter((d) => d.type === t && d.status === 'ONLINE').length;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Physical instruments"
          sub="The dashboard is hardware-agnostic: any unit that can call the ingestion API with its device key will appear here."
        />
        <div className="grid gap-3 p-4 md:grid-cols-2">
          {(['TRACK', 'CROSSING'] as const).map((t) => (
            <div key={t} className="rounded-lg border border-line p-3">
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold text-ink">{pretty(t)} Units registered</div>
                <Badge tone={online(t) ? 'teal' : 'slate'}>{online(t)} online</Badge>
              </div>
              <div className="mt-1 text-2xl font-semibold text-ink">{count(t)}</div>
              <div className="text-xs text-ink-soft">
                {count(t) === 0
                  ? 'None yet. Register the first one in Admin > Devices.'
                  : 'Manage keys and status in Admin > Devices.'}
              </div>
            </div>
          ))}
        </div>
        {goToDevices && (
          <div className="px-4 pb-4">
            <button
              onClick={goToDevices}
              className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-white hover:opacity-90"
            >
              Go to Devices and register a unit
            </button>
          </div>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Where to add a sensor or unit"
          sub="Sensors are attached to a Track Unit or Crossing Unit. Register the unit once; its sensors report through it."
        />
        <ol className="divide-y divide-line">
          <Step n={1} title="Create the geography first (once)">
            Admin &gt; Sections &amp; crossings: add your division, upload the track line (GeoJSON
            or KML) and add each level crossing. Segments of 100 m are created automatically.
          </Step>
          <Step n={2} title="Register the unit">
            Admin &gt; Devices &gt; Register device. Choose the type (Track or Crossing), enter the
            serial number printed on the unit, a name (for example &ldquo;Track Unit 01&rdquo;) and
            the division.
          </Step>
          <Step n={3} title="Copy the device key (shown once)">
            A key like <code>rgk_xxxxxxxx_...</code> is displayed once. Store it in the unit&apos;s
            secure configuration. Lost it? Use <em>Rotate key</em>. Stolen unit? Use <em>Revoke</em>
            .
          </Step>
          <Step n={4} title="Link a Crossing Unit to its crossing">
            Admin &gt; Sections &amp; crossings: open the crossing and set its device, so crossing
            events appear on the right crossing page.
          </Step>
          <Step n={5} title="Point the firmware at the API">
            Set the API base URL and key on the unit, then send a heartbeat (below). The device
            moves from <em>Offline</em> to <em>Online</em> within a minute.
          </Step>
          <Step n={6} title="Upload your AI model version">
            Admin &gt; Model versions: record the model each unit runs, so every detection can be
            traced to a model.
          </Step>
          <Step n={7} title="Verify in the portal">
            Devices page: battery, solar, temperature, storage and last-seen. Detections and
            Crossings pages fill as results arrive; inspectors confirm or reject them in Review.
          </Step>
        </ol>
      </Card>

      <Card>
        <CardHeader
          title="Connection details for the unit firmware"
          sub="Every request uses the header x-api-key. Batches use client-generated UUIDs, so resends after an outage are safe."
        />
        <div className="space-y-3 p-4">
          <div className="text-sm text-ink-soft">
            API base URL: <code className="text-ink">{API_URL}</code>
          </div>
          <Code>{`# 1. Heartbeat (every 1-5 minutes)
POST ${API_URL}/v1/ingest/heartbeat
x-api-key: rgk_...
{"deviceTime":"2026-06-01T08:00:00+05:00","firmwareVersion":"1.0.0","modelVersion":"1.0.0",
 "batteryPct":82,"solarW":35,"temperatureC":41,"storagePct":23,"network":"LTE_4G",
 "lat":33.6,"lon":73.0,"queuedRecords":0}

# 2. Photo or audio: ask for a presigned upload URL, PUT the file, use the returned key
POST ${API_URL}/v1/ingest/upload-url

# 3. Track detections
POST ${API_URL}/v1/ingest/detections      {"items":[{ "id":"<uuid>", "detectedAt":"...", "lat":..., "lon":...,
  "defectClass":"MISSING_FASTENER","severity":"MODERATE","confidence":0.91,
  "sources":["IMAGE","VIBRATION"],"fusionLevel":"HIGH","imageKey":"...","bbox":[0.3,0.4,0.2,0.15] }]}

# 4. Crossing events
POST ${API_URL}/v1/ingest/crossing-events {"items":[{ "id":"<uuid>","occurredAt":"...","objectClass":"VEHICLE",
  "trainApproaching":true,"dwellSeconds":12,"warningTriggered":true,"confidence":0.94 }]}

# 5. Inspection runs (trolley or locomotive pass)
POST ${API_URL}/v1/ingest/runs`}</Code>
          <p className="text-xs text-ink-soft">
            Full route list: <code>{API_URL}/docs</code>. Gzip bodies are accepted (
            <code>content-encoding: gzip</code>).
          </p>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Track Unit - instruments"
          sub="Mounted on an inspection trolley or locomotive. Reference specification: final part selection is made by RTL engineering and procurement."
        />
        <Kit items={TRACK_KIT} />
      </Card>

      <Card>
        <CardHeader
          title="Crossing Unit - instruments"
          sub="Solar-powered, installed at an unmanned level crossing. Reference specification: final part selection is made by RTL engineering and procurement."
        />
        <Kit items={CROSSING_KIT} />
      </Card>

      <WeatherCard />
    </div>
  );
}

/** Heat/flood risk inputs. No hardware needed: enter the forecast maximum, rainfall and flood flag. */
function WeatherCard() {
  const sections = useQuery({ queryKey: ['sections'], queryFn: () => api<any[]>('/v1/sections') });
  const [f, setF] = useState({
    sectionId: '',
    date: new Date().toISOString().slice(0, 10),
    maxTempC: '',
    rainfallMm: '',
    floodFlag: false,
  });
  const sectionId = f.sectionId || sections.data?.[0]?.id || '';
  const num = (s: string) => (s.trim() === '' ? null : Number(s));
  const add = useMutation({
    mutationFn: () =>
      api<{ added: number }>('/v1/admin/weather', {
        method: 'POST',
        body: {
          sectionId,
          entries: [
            {
              date: f.date,
              maxTempC: num(f.maxTempC),
              rainfallMm: num(f.rainfallMm),
              floodFlag: f.floodFlag,
            },
          ],
        },
      }),
  });
  return (
    <Card>
      <CardHeader
        title="Weather input (no hardware needed)"
        sub="Heat and flood risk use these values: forecast maximum temperature, rainfall and a flood flag. Saving recalculates risk for the division."
      />
      <form
        className="grid gap-3 p-4 md:grid-cols-6"
        onSubmit={(e) => {
          e.preventDefault();
          add.mutate();
        }}
      >
        <Field label="Section">
          <Select value={sectionId} onChange={(e) => setF({ ...f, sectionId: e.target.value })}>
            {(sections.data ?? []).map((s: any) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Date">
          <Input
            type="date"
            value={f.date}
            onChange={(e) => setF({ ...f, date: e.target.value })}
            required
          />
        </Field>
        <Field label="Max temp (°C)">
          <Input
            type="number"
            step="0.1"
            min={-20}
            max={60}
            value={f.maxTempC}
            onChange={(e) => setF({ ...f, maxTempC: e.target.value })}
          />
        </Field>
        <Field label="Rainfall (mm)">
          <Input
            type="number"
            step="0.1"
            min={0}
            max={1000}
            value={f.rainfallMm}
            onChange={(e) => setF({ ...f, rainfallMm: e.target.value })}
          />
        </Field>
        <label className="flex items-end gap-2 pb-2 text-sm">
          <input
            type="checkbox"
            checked={f.floodFlag}
            onChange={(e) => setF({ ...f, floodFlag: e.target.checked })}
          />
          Flood flag
        </label>
        <div className="flex items-end">
          <Button type="submit" disabled={!sectionId || add.isPending}>
            {add.isPending ? 'Saving…' : 'Add weather'}
          </Button>
        </div>
      </form>
      <div className="px-4 pb-4">
        {add.isSuccess && (
          <p role="status" className="text-sm text-teal-dark">
            Weather saved; risk is being recalculated.
          </p>
        )}
        {add.error && (
          <p role="alert" className="text-sm text-risk-5">
            {(add.error as Error).message}
          </p>
        )}
        <p className="mt-2 text-xs text-ink-soft">
          Per-segment curve, bridge and near-crossing flags are set in Admin &gt; Sections &amp;
          crossings.
        </p>
      </div>
    </Card>
  );
}
