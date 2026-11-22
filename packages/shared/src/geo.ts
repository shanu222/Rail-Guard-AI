/** Lightweight geodesy helpers. Coordinates are [longitude, latitude] (GeoJSON order). */
export type LonLat = [number, number];

const R = 6371008.8; // mean Earth radius, metres
const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

export function haversineM(a: LonLat, b: LonLat): number {
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(b[0] - a[0]);
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function bearingDeg(a: LonLat, b: LonLat): number {
  const y = Math.sin(toRad(b[0] - a[0])) * Math.cos(toRad(b[1]));
  const x =
    Math.cos(toRad(a[1])) * Math.sin(toRad(b[1])) -
    Math.sin(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.cos(toRad(b[0] - a[0]));
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Smallest absolute difference between two bearings, 0..180. */
export function bearingDelta(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

export function lineLengthM(coords: LonLat[]): number {
  let total = 0;
  for (let i = 1; i < coords.length; i++) total += haversineM(coords[i - 1]!, coords[i]!);
  return total;
}

function lerp(a: LonLat, b: LonLat, t: number): LonLat {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/** Point at `distM` metres along the line (clamped to the ends). */
export function pointAlong(coords: LonLat[], distM: number): LonLat {
  if (coords.length === 0) throw new Error('empty line');
  if (distM <= 0) return coords[0]!;
  let acc = 0;
  for (let i = 1; i < coords.length; i++) {
    const seg = haversineM(coords[i - 1]!, coords[i]!);
    if (acc + seg >= distM) return lerp(coords[i - 1]!, coords[i]!, seg === 0 ? 0 : (distM - acc) / seg);
    acc += seg;
  }
  return coords[coords.length - 1]!;
}

/** Sub-line between two chainages (metres from the start of `coords`). */
export function sliceLine(coords: LonLat[], startM: number, endM: number): LonLat[] {
  const out: LonLat[] = [pointAlong(coords, startM)];
  let acc = 0;
  for (let i = 1; i < coords.length; i++) {
    acc += haversineM(coords[i - 1]!, coords[i]!);
    if (acc > startM && acc < endM) out.push(coords[i]!);
  }
  out.push(pointAlong(coords, endM));
  return out;
}

export interface SegmentDraft {
  index: number;
  chainageStartM: number;
  chainageEndM: number;
  coords: LonLat[];
  isCurve: boolean;
}

/**
 * Split a track centre line into fixed-length segments (default 100 m). The last segment may be
 * shorter. A segment is flagged as a curve when its heading changes by more than `curveDeg`
 * (degrees) between its first and second half; 0.25 deg over 100 m is a ~1.4 km radius, i.e. a
 * gentle curve. Admin-uploaded survey lines can pass a stricter value.
 */
export function buildSegments(coords: LonLat[], segLenM = 100, curveDeg = 0.25): SegmentDraft[] {
  if (coords.length < 2) throw new Error('A track line needs at least two points');
  const total = lineLengthM(coords);
  const segments: SegmentDraft[] = [];
  for (let start = 0, i = 0; start < total - 1e-6; start += segLenM, i++) {
    const end = Math.min(start + segLenM, total);
    if (end - start < 1) break;
    const mid = (start + end) / 2;
    const a = pointAlong(coords, start);
    const m = pointAlong(coords, mid);
    const b = pointAlong(coords, end);
    segments.push({
      index: i,
      chainageStartM: Math.round(start),
      chainageEndM: Math.round(end),
      coords: sliceLine(coords, start, end),
      isCurve: bearingDelta(bearingDeg(a, m), bearingDeg(m, b)) > curveDeg,
    });
  }
  return segments;
}

/** Shortest distance (metres) from a point to a polyline, via local equirectangular projection. */
export function distanceToLineM(p: LonLat, line: LonLat[]): number {
  const k = Math.cos(toRad(p[1]));
  const proj = (c: LonLat): [number, number] => [
    toRad(c[0] - p[0]) * k * R,
    toRad(c[1] - p[1]) * R,
  ];
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const [ax, ay] = proj(line[i - 1]!);
    const [bx, by] = proj(line[i]!);
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (-ax * dx - ay * dy) / len2));
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return best;
}

export const toWktLineString = (c: LonLat[]) =>
  `LINESTRING(${c.map(([x, y]) => `${x.toFixed(7)} ${y.toFixed(7)}`).join(', ')})`;
export const toWktPoint = (c: LonLat) => `POINT(${c[0].toFixed(7)} ${c[1].toFixed(7)})`;
