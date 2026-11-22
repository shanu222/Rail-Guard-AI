export const pretty = (s: string | null | undefined) =>
  s
    ? s
        .replaceAll('_', ' ')
        .toLowerCase()
        .replace(/^\w/, (c) => c.toUpperCase())
    : '—';
export const pct = (v: number | null | undefined, digits = 1) =>
  v === null || v === undefined ? '—' : `${(v * 100).toFixed(digits)}%`;
export const num = (v: number | null | undefined, digits = 1) =>
  v === null || v === undefined ? '—' : v.toFixed(digits);

export const dt = (iso: string | Date | null | undefined) =>
  iso
    ? new Date(iso).toLocaleString('en-GB', {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: 'Asia/Karachi',
      })
    : '—';

export function ago(iso: string | Date | null | undefined): string {
  if (!iso) return 'never';
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  if (m < 60 * 48) return `${Math.round(m / 60)} h ago`;
  return `${Math.round(m / 1440)} d ago`;
}

export const km = (m: number | null | undefined) =>
  m === null || m === undefined ? '—' : `${(m / 1000).toFixed(2)} km`;
export const CHAINAGE = (m: number | null | undefined) =>
  m === null || m === undefined
    ? '—'
    : `${Math.floor(m / 1000)}+${String(Math.round(m % 1000)).padStart(3, '0')}`;
export const monthNow = () => new Date().toISOString().slice(0, 7);

export const CLASS_COLORS: Record<string, string> = {
  MISSING_FASTENER: '#E8643A',
  BROKEN_FASTENER: '#D62839',
  DAMAGED_SLEEPER: '#8A5A2B',
  RAIL_SURFACE_DEFECT: '#1E3350',
  RAIL_JOINT_PROBLEM: '#1FA88A',
  BALLAST_DEFICIENCY: '#6B7A90',
  VEGETATION: '#6BAA3A',
  GEOMETRY_IRREGULARITY: '#9A6FD1',
};
