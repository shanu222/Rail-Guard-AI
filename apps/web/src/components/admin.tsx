'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
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
import { DEFAULT_RISK_CONFIG, MODEL_TYPES, ROLES, type RiskConfig } from '@railguard/shared';
import {
  Async,
  Badge,
  Button,
  Card,
  CardHeader,
  Field,
  Input,
  Modal,
  Select,
  Table,
  Td,
  Th,
} from '@/components/ui';
import { api } from '@/lib/api';
import { dt, pretty } from '@/lib/format';

const useDivisions = () =>
  useQuery({
    queryKey: ['divisions'],
    queryFn: () => api<{ id: string; name: string }[]>('/v1/divisions'),
  });
const Err = ({ e }: { e: unknown }) =>
  e ? (
    <p role="alert" className="text-sm text-risk-5">
      {(e as Error).message}
    </p>
  ) : null;
const Ok = ({ show, children }: { show: boolean; children: ReactNode }) =>
  show ? (
    <p role="status" className="text-sm text-teal-dark">
      {children}
    </p>
  ) : null;

/** Settings > Storage: proves Cloudflare R2 works (reports, photos, snapshots) and shows the exact error. */
function StorageCheckCard() {
  const check = useMutation({
    mutationFn: () =>
      api<{
        ok: boolean;
        bucket: string;
        endpointHost: string;
        accessKeyIdLength: number;
        secretLength: number;
        hasWhitespace: boolean;
        error?: string;
        status?: number | null;
      }>('/v1/admin/storage-check'),
  });
  const r = check.data;
  return (
    <Card className="lg:col-span-2">
      <CardHeader
        title="Storage (Cloudflare R2)"
        sub="Stored reports, inspector photos and crossing snapshots need R2. Test it here after changing R2 variables."
      />
      <div className="space-y-2 p-4 text-sm">
        <Button disabled={check.isPending} onClick={() => check.mutate()}>
          {check.isPending ? 'Testing…' : 'Test storage'}
        </Button>
        {r && (
          <div className={r.ok ? 'text-teal-dark' : 'text-risk-5'} role="status">
            {r.ok
              ? 'Storage works: write, read and delete succeeded.'
              : `Storage failed: ${r.error}`}
            <div className="mt-1 text-xs text-ink-soft">
              Bucket <code>{r.bucket}</code> · endpoint <code>{r.endpointHost}</code> · access key
              length {r.accessKeyIdLength} (expected 32) · secret length {r.secretLength} (expected
              64){r.hasWhitespace && ' · a value contains spaces or quotes - remove them'}
            </div>
          </div>
        )}
        <Err e={check.error} />
      </div>
    </Card>
  );
}

// ---------------- Users ----------------
export function UsersTab() {
  const qc = useQueryClient();
  const users = useQuery({
    queryKey: ['admin-users'],
    queryFn: () => api<any[]>('/v1/admin/users'),
  });
  const divs = useDivisions();
  const [f, setF] = useState({
    email: '',
    name: '',
    role: 'INSPECTOR',
    divisionId: '',
    password: '',
  });
  const create = useMutation({
    mutationFn: () =>
      api('/v1/admin/users', {
        method: 'POST',
        body: { ...f, divisionId: f.role === 'ADMIN' ? null : f.divisionId || null },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin-users'] });
      setF({ ...f, email: '', name: '', password: '' });
    },
  });
  const patch = useMutation({
    mutationFn: (v: { id: string; body: Record<string, unknown> }) =>
      api(`/v1/admin/users/${v.id}`, { method: 'PATCH', body: v.body }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin-users'] }),
  });
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Add user"
          sub="Password: 12+ characters with upper, lower case and a digit"
        />
        <form
          className="grid gap-3 p-4 md:grid-cols-3"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <Field label="Name">
            <Input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          </Field>
          <Field label="Email">
            <Input
              type="email"
              required
              value={f.email}
              onChange={(e) => setF({ ...f, email: e.target.value })}
            />
          </Field>
          <Field label="Password">
            <Input
              type="password"
              required
              autoComplete="new-password"
              value={f.password}
              onChange={(e) => setF({ ...f, password: e.target.value })}
            />
          </Field>
          <Field label="Role">
            <Select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {pretty(r)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Division">
            <Select
              value={f.divisionId}
              disabled={f.role === 'ADMIN'}
              onChange={(e) => setF({ ...f, divisionId: e.target.value })}
            >
              <option value="">—</option>
              {divs.data?.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex items-end">
            <Button type="submit" disabled={create.isPending}>
              Create user
            </Button>
          </div>
          <div className="md:col-span-3">
            <Err e={create.error} />
          </div>
        </form>
      </Card>
      <Card>
        <Async q={users}>
          {(rows) => (
            <Table>
              <thead>
                <tr>
                  <Th>User</Th>
                  <Th>Role</Th>
                  <Th>Last login</Th>
                  <Th>State</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {rows.map((u) => (
                  <tr key={u.id}>
                    <Td>
                      <span className="font-medium">{u.name}</span>
                      <span className="block text-xs text-ink-soft">{u.email}</span>
                    </Td>
                    <Td>
                      <Select
                        aria-label={`Role of ${u.name}`}
                        value={u.role}
                        onChange={(e) => patch.mutate({ id: u.id, body: { role: e.target.value } })}
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r}>
                            {pretty(r)}
                          </option>
                        ))}
                      </Select>
                    </Td>
                    <Td className="text-xs">{dt(u.lastLoginAt)}</Td>
                    <Td>
                      {u.isActive ? (
                        <Badge tone="teal">Active</Badge>
                      ) : (
                        <Badge tone="red">Disabled</Badge>
                      )}{' '}
                      {u.lockedUntil && new Date(u.lockedUntil) > new Date() && (
                        <Badge tone="amber">Locked</Badge>
                      )}{' '}
                      {u.totpEnabled && <Badge>2FA</Badge>}
                    </Td>
                    <Td className="space-x-1 whitespace-nowrap">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => patch.mutate({ id: u.id, body: { isActive: !u.isActive } })}
                      >
                        {u.isActive ? 'Disable' : 'Enable'}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => patch.mutate({ id: u.id, body: { unlock: true } })}
                      >
                        Unlock
                      </Button>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Async>
        <div className="px-4 pb-3">
          <Err e={patch.error} />
        </div>
      </Card>
    </div>
  );
}

// ---------------- Sections & crossings ----------------
export function GeographyTab() {
  const qc = useQueryClient();
  const divs = useDivisions();
  const sections = useQuery({ queryKey: ['sections'], queryFn: () => api<any[]>('/v1/sections') });
  const crossings = useQuery({
    queryKey: ['crossings'],
    queryFn: () => api<any[]>('/v1/crossings'),
  });
  const devices = useQuery({
    queryKey: ['devices'],
    queryFn: () => api<{ devices: any[] }>('/v1/devices'),
  });
  const [s, setS] = useState({
    divisionId: '',
    name: '',
    fromStation: '',
    toStation: '',
    segmentLengthM: 100,
  });
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [c, setC] = useState({ divisionId: '', name: '', lat: '', lon: '', unitId: '' });
  const div = s.divisionId || divs.data?.[0]?.id || '';

  const addSection = useMutation({
    mutationFn: () =>
      api<{ segments: number; lengthKm: number }>('/v1/admin/sections', {
        method: 'POST',
        body: {
          ...s,
          divisionId: div,
          format: file!.name.toLowerCase().endsWith('.kml') ? 'kml' : 'geojson',
          data: file!.text,
        },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['sections'] });
      void qc.invalidateQueries({ queryKey: ['segments'] });
    },
  });
  const addCrossing = useMutation({
    mutationFn: () =>
      api('/v1/admin/crossings', {
        method: 'POST',
        body: {
          divisionId: c.divisionId || div,
          name: c.name,
          lat: Number(c.lat),
          lon: Number(c.lon),
          unitId: c.unitId || null,
        },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['crossings'] });
      void qc.invalidateQueries({ queryKey: ['map-crossings'] });
      setC({ ...c, name: '', lat: '', lon: '' });
    },
  });

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader
          title="Add section from track line"
          sub="Upload a GeoJSON or KML line; 100 m segments are generated automatically"
        />
        <form
          className="space-y-3 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            addSection.mutate();
          }}
        >
          <Field label="Division">
            <Select value={div} onChange={(e) => setS({ ...s, divisionId: e.target.value })}>
              {divs.data?.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Section name">
            <Input required value={s.name} onChange={(e) => setS({ ...s, name: e.target.value })} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="From station">
              <Input
                required
                value={s.fromStation}
                onChange={(e) => setS({ ...s, fromStation: e.target.value })}
              />
            </Field>
            <Field label="To station">
              <Input
                required
                value={s.toStation}
                onChange={(e) => setS({ ...s, toStation: e.target.value })}
              />
            </Field>
          </div>
          <Field label="Track line file (.geojson, .json or .kml)">
            <input
              type="file"
              accept=".geojson,.json,.kml"
              required
              className="block w-full text-sm"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                setFile(f ? { name: f.name, text: await f.text() } : null);
              }}
            />
          </Field>
          <Button type="submit" disabled={!file || addSection.isPending}>
            {addSection.isPending ? 'Generating segments…' : 'Create section'}
          </Button>
          <Err e={addSection.error} />
          <Ok show={addSection.isSuccess}>
            Created: {addSection.data?.lengthKm.toFixed(2)} km, {addSection.data?.segments}{' '}
            segments. Risk scores are being calculated.
          </Ok>
        </form>
        <Async q={sections}>
          {(rows) => (
            <ul className="divide-y divide-line border-t border-line text-sm">
              {rows.map((r) => (
                <li key={r.id} className="px-4 py-2">
                  {r.name}{' '}
                  <span className="text-xs text-ink-soft">
                    · {r.length_km.toFixed(1)} km · {r.from_station} → {r.to_station}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Async>
      </Card>
      <Card>
        <CardHeader title="Add crossing" />
        <form
          className="space-y-3 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            addCrossing.mutate();
          }}
        >
          <Field label="Name">
            <Input required value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Latitude">
              <Input
                required
                inputMode="decimal"
                value={c.lat}
                onChange={(e) => setC({ ...c, lat: e.target.value })}
              />
            </Field>
            <Field label="Longitude">
              <Input
                required
                inputMode="decimal"
                value={c.lon}
                onChange={(e) => setC({ ...c, lon: e.target.value })}
              />
            </Field>
          </div>
          <Field label="Crossing Unit">
            <Select value={c.unitId} onChange={(e) => setC({ ...c, unitId: e.target.value })}>
              <option value="">None yet</option>
              {devices.data?.devices
                .filter((d) => d.type === 'CROSSING')
                .map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
            </Select>
          </Field>
          <Button type="submit" disabled={addCrossing.isPending}>
            Add crossing
          </Button>
          <Err e={addCrossing.error} />
        </form>
        <Async q={crossings}>
          {(rows) => (
            <ul className="divide-y divide-line border-t border-line text-sm">
              {rows.map((r) => (
                <li key={r.id} className="px-4 py-2">
                  {r.name}{' '}
                  <span className="text-xs text-ink-soft">· {r.unit_name ?? 'no unit'}</span>
                </li>
              ))}
            </ul>
          )}
        </Async>
      </Card>
    </div>
  );
}

// ---------------- Devices ----------------
export function DevicesTab() {
  const qc = useQueryClient();
  const divs = useDivisions();
  const devices = useQuery({
    queryKey: ['devices'],
    queryFn: () => api<{ devices: any[] }>('/v1/devices'),
  });
  const [f, setF] = useState({ type: 'TRACK', serial: '', name: '', divisionId: '' });
  const [key, setKey] = useState<{ name: string; apiKey: string } | null>(null);
  const div = f.divisionId || divs.data?.[0]?.id || '';
  const create = useMutation({
    mutationFn: () =>
      api<{ apiKey: string }>('/v1/admin/devices', {
        method: 'POST',
        body: { ...f, divisionId: div },
      }),
    onSuccess: (r) => {
      setKey({ name: f.name, apiKey: r.apiKey });
      setF({ ...f, serial: '', name: '' });
      void qc.invalidateQueries({ queryKey: ['devices'] });
    },
  });
  const rotate = useMutation({
    mutationFn: (d: any) =>
      api<{ apiKey: string }>(`/v1/admin/devices/${d.id}/rotate-key`, { method: 'POST' }).then(
        (r) => ({ ...r, name: d.name }),
      ),
    onSuccess: (r) => {
      setKey({ name: r.name, apiKey: r.apiKey });
      void qc.invalidateQueries({ queryKey: ['devices'] });
    },
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api(`/v1/admin/devices/${id}/revoke`, { method: 'POST' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['devices'] }),
  });
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Register device" sub="An API key is generated and shown once" />
        <form
          className="grid gap-3 p-4 md:grid-cols-5"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <Field label="Type">
            <Select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
              <option value="TRACK">Track Unit</option>
              <option value="CROSSING">Crossing Unit</option>
            </Select>
          </Field>
          <Field label="Serial">
            <Input
              required
              minLength={3}
              value={f.serial}
              onChange={(e) => setF({ ...f, serial: e.target.value })}
            />
          </Field>
          <Field label="Name">
            <Input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          </Field>
          <Field label="Division">
            <Select value={div} onChange={(e) => setF({ ...f, divisionId: e.target.value })}>
              {divs.data?.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex items-end">
            <Button type="submit" disabled={create.isPending}>
              Register
            </Button>
          </div>
          <div className="md:col-span-5">
            <Err e={create.error} />
          </div>
        </form>
      </Card>
      <Card>
        <Async q={devices}>
          {({ devices: rows }) => (
            <Table>
              <thead>
                <tr>
                  <Th>Device</Th>
                  <Th>Key</Th>
                  <Th>State</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => (
                  <tr key={d.id}>
                    <Td>
                      <span className="font-medium">{d.name}</span>
                      <span className="block text-xs text-ink-soft">{d.serial}</span>
                    </Td>
                    <Td className="font-mono text-xs">
                      {d.apiKeyPrefix ? `rgk_${d.apiKeyPrefix}_…` : '—'}
                    </Td>
                    <Td>
                      {d.revokedAt ? (
                        <Badge tone="red">Revoked</Badge>
                      ) : (
                        <Badge tone="teal">Active</Badge>
                      )}
                    </Td>
                    <Td className="space-x-1 whitespace-nowrap">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          confirm(
                            `Rotate the key for ${d.name}? The old key stops working immediately.`,
                          ) && rotate.mutate(d)
                        }
                      >
                        Rotate key
                      </Button>
                      {!d.revokedAt && (
                        <Button
                          size="sm"
                          variant="danger"
                          onClick={() =>
                            confirm(`Revoke ${d.name}? It will no longer be able to upload.`) &&
                            revoke.mutate(d.id)
                          }
                        >
                          Revoke
                        </Button>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Async>
      </Card>
      <Modal open={!!key} onClose={() => setKey(null)} title={`API key for ${key?.name}`}>
        <p className="mb-2 text-sm">
          Copy this key into the device configuration now.{' '}
          <strong>It cannot be shown again.</strong>
        </p>
        <pre className="select-all break-all rounded bg-slate-100 p-3 font-mono text-xs">
          {key?.apiKey}
        </pre>
        <Button
          className="mt-3 w-full"
          onClick={() => key && void navigator.clipboard?.writeText(key.apiKey)}
        >
          Copy key
        </Button>
      </Modal>
    </div>
  );
}

// ---------------- Models ----------------
export function ModelsTab() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['models'],
    queryFn: () => api<any[]>('/v1/admin/model-versions'),
  });
  const [f, setF] = useState({ type: 'TRACK_DEFECT', version: '', metrics: '' });
  const add = useMutation({
    mutationFn: () => {
      let metrics: unknown;
      if (f.metrics.trim()) {
        try {
          metrics = JSON.parse(f.metrics);
        } catch {
          throw new Error('Metrics must be valid JSON');
        }
      }
      return api('/v1/admin/model-versions', {
        method: 'POST',
        body: { type: f.type, version: f.version, metrics },
      });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['models'] });
      setF({ ...f, version: '', metrics: '' });
    },
  });
  const activate = useMutation({
    mutationFn: (id: string) => api(`/v1/admin/model-versions/${id}/activate`, { method: 'POST' }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['models'] }),
  });
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Register model version"
          sub="Record the evaluated metrics from your test report. Do not enter numbers that were not measured."
        />
        <form
          className="grid gap-3 p-4 md:grid-cols-4"
          onSubmit={(e) => {
            e.preventDefault();
            add.mutate();
          }}
        >
          <Field label="Type">
            <Select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
              {MODEL_TYPES.map((t) => (
                <option key={t} value={t}>
                  {pretty(t)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Version">
            <Input
              required
              value={f.version}
              onChange={(e) => setF({ ...f, version: e.target.value })}
            />
          </Field>
          <div className="md:col-span-2">
            <Field label="Metrics (JSON, optional)">
              <Input
                placeholder='{"precision": 0.0, "recall": 0.0}'
                value={f.metrics}
                onChange={(e) => setF({ ...f, metrics: e.target.value })}
              />
            </Field>
          </div>
          <div className="md:col-span-4">
            <Button type="submit" disabled={add.isPending}>
              Add version
            </Button>{' '}
            <Err e={add.error} />
          </div>
        </form>
      </Card>
      <Card>
        <Async q={q} empty={(d) => d.length === 0}>
          {(rows) => (
            <Table>
              <thead>
                <tr>
                  <Th>Type</Th>
                  <Th>Version</Th>
                  <Th>Released</Th>
                  <Th>Metrics</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {rows.map((m) => (
                  <tr key={m.id}>
                    <Td>{pretty(m.type)}</Td>
                    <Td>
                      {m.version} {m.isActive && <Badge tone="teal">active</Badge>}{' '}
                      {m.isDemo && <Badge>demo</Badge>}
                    </Td>
                    <Td className="text-xs">{dt(m.releasedAt)}</Td>
                    <Td className="max-w-xs truncate font-mono text-xs">
                      {m.metrics ? JSON.stringify(m.metrics) : '—'}
                    </Td>
                    <Td>
                      {!m.isActive && (
                        <Button size="sm" variant="ghost" onClick={() => activate.mutate(m.id)}>
                          Activate
                        </Button>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Async>
      </Card>
    </div>
  );
}

// ---------------- Risk weights editor ----------------
export function RiskTab() {
  const qc = useQueryClient();
  const divs = useDivisions();
  const cfg = useQuery({
    queryKey: ['risk-config'],
    queryFn: () => api<RiskConfig>('/v1/admin/risk-config'),
  });
  const [draft, setDraft] = useState<RiskConfig | null>(null);
  const c = draft ?? cfg.data ?? DEFAULT_RISK_CONFIG;
  const div = divs.data?.[0]?.id;
  const edit = (fn: (x: RiskConfig) => RiskConfig) => setDraft(fn(structuredClone(c)));
  const sum = Object.values(c.weights).reduce((a, b) => a + b, 0);
  const preview = useMutation({
    mutationFn: () =>
      api<any>('/v1/admin/risk-config/preview', {
        method: 'POST',
        body: { divisionId: div, config: c },
      }),
  });
  const save = useMutation({
    mutationFn: () => api('/v1/admin/risk-config', { method: 'PUT', body: c }),
    onSuccess: () => {
      setDraft(null);
      void qc.invalidateQueries({ queryKey: ['risk-config'] });
      void qc.invalidateQueries({ queryKey: ['segments'] });
    },
  });
  const p = preview.data;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader
          title="Risk weights"
          sub="raw = w1·defect + w2·trend + w3·heat + w4·flood + w5·local"
        />
        <div className="space-y-3 p-4">
          {(['defect', 'trend', 'heat', 'flood', 'local'] as const).map((k) => (
            <label key={k} className="flex items-center gap-3 text-sm">
              <span className="w-16 capitalize">{k}</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={c.weights[k]}
                onChange={(e) =>
                  edit((x) => ({ ...x, weights: { ...x.weights, [k]: Number(e.target.value) } }))
                }
                className="flex-1"
                aria-label={`${k} weight`}
              />
              <span className="w-12 text-end tabular-nums">{c.weights[k].toFixed(2)}</span>
            </label>
          ))}
          <p
            className={`text-xs ${Math.abs(sum - 1) > 0.001 ? 'text-amber-700' : 'text-ink-soft'}`}
          >
            Weights sum to {sum.toFixed(2)}
            {Math.abs(sum - 1) > 0.001
              ? ' (not required to equal 1, but scores shift if it does not)'
              : ''}
            .
          </p>
          <hr className="border-line" />
          <Field label="Score thresholds">
            <Select
              value={c.thresholds.mode}
              onChange={(e) =>
                edit((x) => ({
                  ...x,
                  thresholds: {
                    mode: e.target.value as 'quantile' | 'absolute',
                    bounds:
                      e.target.value === 'quantile' ? [0.4, 0.7, 0.88, 0.96] : [0.3, 0.6, 1, 1.6],
                  },
                }))
              }
            >
              <option value="quantile">Quantiles within the division</option>
              <option value="absolute">Absolute raw values</option>
            </Select>
          </Field>
          <div className="grid grid-cols-4 gap-2">
            {c.thresholds.bounds.map((b, i) => (
              <Field key={i} label={`1→2…`.replace('1→2…', `Upper bound of ${i + 1}`)}>
                <Input
                  type="number"
                  step="0.01"
                  value={b}
                  onChange={(e) =>
                    edit((x) => {
                      const nb = [...x.thresholds.bounds] as RiskConfig['thresholds']['bounds'];
                      nb[i] = Number(e.target.value);
                      return { ...x, thresholds: { ...x.thresholds, bounds: nb } };
                    })
                  }
                />
              </Field>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Heat threshold (°C)">
              <Input
                type="number"
                value={c.heatTempThresholdC}
                onChange={(e) =>
                  edit((x) => ({ ...x, heatTempThresholdC: Number(e.target.value) }))
                }
              />
            </Field>
            <Field label="Flood rainfall 72 h (mm)">
              <Input
                type="number"
                value={c.floodRainfall72hMm}
                onChange={(e) =>
                  edit((x) => ({ ...x, floodRainfall72hMm: Number(e.target.value) }))
                }
              />
            </Field>
            <Field label="Look-back (days)">
              <Input
                type="number"
                value={c.lookbackDays}
                onChange={(e) => edit((x) => ({ ...x, lookbackDays: Number(e.target.value) }))}
              />
            </Field>
            <Field label="Half-life (days)">
              <Input
                type="number"
                value={c.halfLifeDays}
                onChange={(e) => edit((x) => ({ ...x, halfLifeDays: Number(e.target.value) }))}
              />
            </Field>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="navy"
              onClick={() => preview.mutate()}
              disabled={!div || preview.isPending}
            >
              {preview.isPending ? 'Calculating…' : 'Preview effect'}
            </Button>
            <Button
              onClick={() =>
                confirm('Save these weights and recalculate every score?') && save.mutate()
              }
              disabled={!draft || save.isPending}
            >
              Save &amp; recalculate
            </Button>
            <Button variant="ghost" onClick={() => setDraft(null)} disabled={!draft}>
              Reset
            </Button>
          </div>
          <Err e={preview.error ?? save.error} />
          <Ok show={save.isSuccess}>Saved. Scores are recalculating.</Ok>
        </div>
      </Card>
      <Card>
        <CardHeader title="Preview" sub="Nothing is stored until you save" />
        {!p ? (
          <p className="p-4 text-sm text-ink-soft">
            Adjust the weights and press “Preview effect” to see how segment scores would change.
          </p>
        ) : (
          <div className="p-4">
            <p className="mb-2 text-sm">
              <strong>{p.changedSegments}</strong> of {p.totalSegments} segments would change score.
            </p>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={[1, 2, 3, 4, 5].map((s, i) => ({
                    score: `Score ${s}`,
                    Before: p.distributionBefore[i],
                    After: p.distributionAfter[i],
                  }))}
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="score" tick={{ fontSize: 11 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="Before" fill="#9AA5B4" />
                  <Bar dataKey="After" fill="#E8643A" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

// ---------------- Settings ----------------
export function SettingsTab() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['settings'],
    queryFn: () => api<Record<string, any>>('/v1/admin/settings'),
  });
  const [msg, setMsg] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (v: { key: string; value: unknown }) =>
      api(`/v1/admin/settings/${v.key}`, { method: 'PUT', body: { value: v.value } }),
    onSuccess: () => {
      setMsg('Saved.');
      void qc.invalidateQueries({ queryKey: ['settings'] });
      void qc.invalidateQueries({ queryKey: ['analytics'] });
      void qc.invalidateQueries({ queryKey: ['pilot'] });
    },
  });
  const [base, setBase] = useState<string | null>(null);
  const [days, setDays] = useState<string | null>(null);
  const ev = {
    trackRecall: null,
    trackSamples: null,
    crossingDayRecall: null,
    crossingDaySamples: null,
    crossingNightRecall: null,
    crossingNightSamples: null,
    ...(q.data?.pilot_eval ?? {}),
  } as Record<string, number | null>;
  const [pe, setPe] = useState<Record<string, string>>({});
  const peVal = (k: string) => pe[k] ?? (ev[k] != null ? String(ev[k]) : '');
  const nv = (s: string) => (s.trim() === '' ? null : Number(s));
  return (
    <Async q={q}>
      {(s) => (
        <div className="grid gap-4 lg:grid-cols-2">
          <StorageCheckCard />
          <Card>
            <CardHeader
              title="Inspection time baseline"
              sub="Manual inspection effort used to compute time saved (minutes per km)"
            />
            <div className="flex items-end gap-2 p-4">
              <Field label="Minutes per km">
                <Input
                  type="number"
                  min={0}
                  step="0.1"
                  value={base ?? s.inspection_baseline_min_per_km ?? ''}
                  onChange={(e) => setBase(e.target.value)}
                />
              </Field>
              <Button
                onClick={() =>
                  save.mutate({
                    key: 'inspection_baseline_min_per_km',
                    value: nv(base ?? String(s.inspection_baseline_min_per_km ?? '')),
                  })
                }
              >
                Save
              </Button>
            </div>
          </Card>
          <Card>
            <CardHeader
              title="Privacy: crossing snapshot retention"
              sub="Snapshots are deleted after this many days; only metadata is kept"
            />
            <div className="flex items-end gap-2 p-4">
              <Field label="Days">
                <Input
                  type="number"
                  min={1}
                  max={365}
                  value={days ?? s.snapshot_retention_days ?? 30}
                  onChange={(e) => setDays(e.target.value)}
                />
              </Field>
              <Button
                onClick={() =>
                  save.mutate({
                    key: 'snapshot_retention_days',
                    value: Number(days ?? s.snapshot_retention_days ?? 30),
                  })
                }
              >
                Save
              </Button>
            </div>
          </Card>
          <Card className="lg:col-span-2">
            <CardHeader
              title="Pilot evaluation: recall from the labelled test set"
              sub="Enter measured values only (0–1) with the number of labelled samples. Leave blank if not yet evaluated."
            />
            <div className="grid gap-3 p-4 md:grid-cols-3">
              {(
                [
                  ['track', 'Track-defect recall'],
                  ['crossingDay', 'Crossing recall — day'],
                  ['crossingNight', 'Crossing recall — night'],
                ] as const
              ).map(([k, l]) => (
                <div key={k} className="space-y-2">
                  <Field label={l}>
                    <Input
                      type="number"
                      step="0.001"
                      min={0}
                      max={1}
                      value={peVal(`${k}Recall`)}
                      onChange={(e) => setPe({ ...pe, [`${k}Recall`]: e.target.value })}
                    />
                  </Field>
                  <Field label="Samples">
                    <Input
                      type="number"
                      min={0}
                      value={peVal(`${k}Samples`)}
                      onChange={(e) => setPe({ ...pe, [`${k}Samples`]: e.target.value })}
                    />
                  </Field>
                </div>
              ))}
              <div className="md:col-span-3">
                <Button
                  onClick={() =>
                    save.mutate({
                      key: 'pilot_eval',
                      value: Object.fromEntries(
                        [
                          'trackRecall',
                          'trackSamples',
                          'crossingDayRecall',
                          'crossingDaySamples',
                          'crossingNightRecall',
                          'crossingNightSamples',
                        ].map((k) => [k, nv(peVal(k))]),
                      ),
                    })
                  }
                >
                  Save evaluation
                </Button>
              </div>
            </div>
          </Card>
          <div className="lg:col-span-2">
            <Err e={save.error} />
            <Ok show={!!msg && save.isSuccess}>{msg}</Ok>
          </div>
        </div>
      )}
    </Async>
  );
}
