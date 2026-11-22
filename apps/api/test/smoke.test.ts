import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// No database needed: these exercise validation, auth guards, docs and parsing only.
process.env.DATABASE_URL ??= 'postgresql://x:x@localhost:5432/x';
process.env.JWT_ACCESS_SECRET ??= 'test-secret-test-secret';
process.env.NODE_ENV = 'test';
process.env.DEMO_MODE = 'true';

const { buildApp } = await import('../src/app');
const { parseTrackLine } = await import('../src/routes/admin');
type App = Awaited<ReturnType<typeof buildApp>>;

let app: App;
beforeAll(async () => {
  app = await buildApp();
  await app.ready();
});
afterAll(async () => app.close());

describe('http layer', () => {
  it('exposes public runtime flags', async () => {
    const r = await app.inject('/v1/config');
    expect(r.statusCode).toBe(200);
    // badge follows the data; with no database reachable there are no demo records
    expect(r.json()).toEqual({ demoMode: false, envDemoMode: true });
  });

  it('rejects unauthenticated app requests', async () => {
    for (const url of ['/v1/overview', '/v1/detections', '/v1/work-orders', '/v1/admin/users']) {
      expect((await app.inject(url)).statusCode, url).toBe(401);
    }
  });

  it('validates login input with Zod', async () => {
    const r = await app.inject({ method: 'POST', url: '/auth/login', payload: { email: 'nope' } });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toBe('VALIDATION');
  });

  it('requires a device key for ingestion', async () => {
    for (const url of [
      '/v1/ingest/heartbeat',
      '/v1/ingest/detections',
      '/v1/ingest/crossing-events',
      '/v1/ingest/upload-url',
    ]) {
      const r = await app.inject({ method: 'POST', url, payload: {} });
      expect(r.statusCode, url).toBe(401);
    }
    const bad = await app.inject({
      method: 'POST',
      url: '/v1/ingest/heartbeat',
      headers: { 'x-api-key': 'rgk_short' },
      payload: {},
    });
    expect(bad.statusCode).toBe(401);
  });

  it('serves OpenAPI docs at /docs', async () => {
    const r = await app.inject('/docs/json');
    expect(r.statusCode).toBe(200);
    const paths = Object.keys(r.json().paths);
    expect(paths).toEqual(
      expect.arrayContaining([
        '/v1/ingest/detections',
        '/auth/login',
        '/v1/detections/{id}/review',
      ]),
    );
  });
});

describe('track line parsing (admin upload)', () => {
  const coords = [
    [73.0, 33.6],
    [73.01, 33.61],
    [73.02, 33.61],
  ];
  it('reads GeoJSON LineString and FeatureCollection', () => {
    expect(
      parseTrackLine('geojson', JSON.stringify({ type: 'LineString', coordinates: coords })),
    ).toHaveLength(3);
    const fc = {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } },
      ],
    };
    expect(parseTrackLine('geojson', JSON.stringify(fc))).toHaveLength(3);
  });
  it('reads KML', () => {
    const kml = `<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><LineString><coordinates>${coords.map((c) => c.join(',') + ',0').join(' ')}</coordinates></LineString></Placemark></Document></kml>`;
    expect(parseTrackLine('kml', kml)).toHaveLength(3);
  });
  it('rejects junk and out-of-range coordinates', () => {
    expect(() => parseTrackLine('geojson', 'not json')).toThrow();
    expect(() =>
      parseTrackLine('geojson', JSON.stringify({ type: 'Point', coordinates: [1, 2] })),
    ).toThrow();
    expect(() =>
      parseTrackLine(
        'geojson',
        JSON.stringify({
          type: 'LineString',
          coordinates: [
            [500, 1],
            [501, 2],
          ],
        }),
      ),
    ).toThrow();
  });
});
