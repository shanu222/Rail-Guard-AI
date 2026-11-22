import { describe, expect, it } from 'vitest';
import { buildSegments, distanceToLineM, lineLengthM, pointAlong, type LonLat } from './geo';

// ~5 km almost-straight line heading east near Rawalpindi.
const line: LonLat[] = [
  [73.0, 33.6],
  [73.025, 33.6],
  [73.05, 33.6005],
];

describe('buildSegments', () => {
  const total = lineLengthM(line);
  const segs = buildSegments(line, 100);

  it('covers the whole line with contiguous 100 m segments', () => {
    expect(segs.length).toBe(Math.ceil(total / 100));
    segs.forEach((s, i) => {
      if (i > 0) expect(s.chainageStartM).toBe(segs[i - 1]!.chainageEndM);
      expect(s.chainageEndM - s.chainageStartM).toBeLessThanOrEqual(100);
      expect(s.coords.length).toBeGreaterThanOrEqual(2);
    });
    expect(segs.at(-1)!.chainageEndM).toBe(Math.round(total));
  });

  it('rejects degenerate lines', () => {
    expect(() => buildSegments([[73, 33.6]])).toThrow();
  });
});

describe('geometry helpers', () => {
  it('pointAlong clamps to the line ends', () => {
    expect(pointAlong(line, -50)).toEqual(line[0]);
    expect(pointAlong(line, 1e9)).toEqual(line.at(-1));
  });

  it('distanceToLineM is ~0 on the line and ~111 m per 0.001 deg of latitude off it', () => {
    expect(distanceToLineM([73.01, 33.6], line)).toBeLessThan(1);
    expect(distanceToLineM([73.01, 33.601], line)).toBeGreaterThan(100);
    expect(distanceToLineM([73.01, 33.601], line)).toBeLessThan(120);
  });
});
