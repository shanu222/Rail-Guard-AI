import { prisma, Prisma } from '../db';

const divClause = (div: string | null, col = 'dev.division_id') =>
  div ? Prisma.sql`${Prisma.raw(col)} = ${div}::uuid` : Prisma.sql`TRUE`;

export const monthRange = (month: string) => {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return { start: new Date(Date.UTC(y, m - 1, 1)), end: new Date(Date.UTC(y, m, 1)) };
};

/** Precision from inspector reviews: confirmed / (confirmed + rejected). null until reviews exist. */
export const precision = (confirmed: number, rejected: number) =>
  confirmed + rejected > 0 ? confirmed / (confirmed + rejected) : null;

export async function reviewCounts(div: string | null, from: Date, to: Date) {
  const [r] = await prisma.$queryRaw<
    { confirmed: number; rejected: number; pending: number; total: number }[]
  >`
    SELECT COUNT(*) FILTER (WHERE d.review_status = 'CONFIRMED')::int AS confirmed,
           COUNT(*) FILTER (WHERE d.review_status = 'REJECTED')::int AS rejected,
           COUNT(*) FILTER (WHERE d.review_status = 'PENDING')::int AS pending, COUNT(*)::int AS total
    FROM detections d JOIN devices dev ON dev.id = d.device_id
    WHERE ${divClause(div)} AND d.detected_at >= ${from} AND d.detected_at < ${to}`;
  return r ?? { confirmed: 0, rejected: 0, pending: 0, total: 0 };
}

export async function analytics(div: string | null, months: number) {
  const to = new Date();
  const from = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth() - (months - 1), 1));
  const secWhere = div ? Prisma.sql`sec.division_id = ${div}::uuid` : Prisma.sql`TRUE`;

  const [sections, perKm, perMonth, byClass, lead, runs, baseline] = await Promise.all([
    prisma.$queryRaw<
      { id: string; name: string; km: number }[]
    >`SELECT sec.id, sec.name, sec.length_km AS km FROM sections sec WHERE ${secWhere}`,
    prisma.$queryRaw<{ section: string; month: string; n: number }[]>`
      SELECT sec.name AS section, to_char(date_trunc('month', d.detected_at), 'YYYY-MM') AS month, COUNT(*)::int AS n
      FROM detections d JOIN segments s ON s.id = d.segment_id JOIN sections sec ON sec.id = s.section_id
      WHERE ${secWhere} AND d.detected_at >= ${from} AND d.review_status <> 'REJECTED' GROUP BY 1, 2`,
    prisma.$queryRaw<{ month: string; confirmed: number; rejected: number }[]>`
      SELECT to_char(date_trunc('month', d.detected_at), 'YYYY-MM') AS month,
             COUNT(*) FILTER (WHERE d.review_status = 'CONFIRMED')::int AS confirmed,
             COUNT(*) FILTER (WHERE d.review_status = 'REJECTED')::int AS rejected
      FROM detections d JOIN devices dev ON dev.id = d.device_id WHERE ${divClause(div)} AND d.detected_at >= ${from} GROUP BY 1 ORDER BY 1`,
    prisma.$queryRaw<{ defect_class: string; confirmed: number; rejected: number }[]>`
      SELECT d.defect_class::text AS defect_class,
             COUNT(*) FILTER (WHERE d.review_status = 'CONFIRMED')::int AS confirmed,
             COUNT(*) FILTER (WHERE d.review_status = 'REJECTED')::int AS rejected
      FROM detections d JOIN devices dev ON dev.id = d.device_id WHERE ${divClause(div)} AND d.detected_at >= ${from} GROUP BY 1`,
    prisma.$queryRaw<{ median_h: number | null; p90_h: number | null; n: number }[]>`
      SELECT (percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (d.reviewed_at - d.received_at)) / 3600))::float AS median_h,
             (percentile_cont(0.9) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (d.reviewed_at - d.received_at)) / 3600))::float AS p90_h, COUNT(*)::int AS n
      FROM detections d JOIN devices dev ON dev.id = d.device_id
      WHERE ${divClause(div)} AND d.reviewed_at IS NOT NULL AND d.detected_at >= ${from}`,
    prisma.$queryRaw<{ month: string; km: number; run_minutes: number }[]>`
      SELECT to_char(date_trunc('month', r.started_at), 'YYYY-MM') AS month, COALESCE(SUM(r.distance_km), 0)::float AS km,
             COALESCE(SUM(EXTRACT(EPOCH FROM (r.ended_at - r.started_at)) / 60), 0)::float AS run_minutes
      FROM runs r JOIN devices dev ON dev.id = r.device_id WHERE ${divClause(div)} AND r.started_at >= ${from} GROUP BY 1 ORDER BY 1`,
    prisma.setting.findUnique({ where: { key: 'inspection_baseline_min_per_km' } }),
  ]);

  const totalKm = sections.reduce((a, s) => a + s.km, 0);
  const monthsList = [
    ...new Set([...perKm.map((r) => r.month), ...perMonth.map((r) => r.month)]),
  ].sort();
  const baselineMinPerKm = typeof baseline?.value === 'number' ? baseline.value : null;
  const km = new Map(runs.map((r) => [r.month, r]));

  return {
    sections: sections.map((s) => s.name),
    defectsPerKm: monthsList.map((m) => {
      const row: Record<string, number | string> = { month: m };
      for (const s of sections)
        row[s.name] = Number(
          (
            (perKm.find((p) => p.month === m && p.section === s.name)?.n ?? 0) / (s.km || 1)
          ).toFixed(3),
        );
      return row;
    }),
    precisionByMonth: perMonth.map((r) => ({
      month: r.month,
      precision: precision(r.confirmed, r.rejected),
      confirmed: r.confirmed,
      rejected: r.rejected,
    })),
    precisionByClass: byClass.map((r) => ({
      defectClass: r.defect_class,
      precision: precision(r.confirmed, r.rejected),
      confirmed: r.confirmed,
      rejected: r.rejected,
    })),
    falseAlarmsPerKm: perMonth.map((r) => ({
      month: r.month,
      perKm: totalKm ? Number((r.rejected / totalKm).toFixed(3)) : null,
      rejected: r.rejected,
    })),
    leadTimeHours: {
      median: lead[0]?.median_h ?? null,
      p90: lead[0]?.p90_h ?? null,
      reviewed: lead[0]?.n ?? 0,
    },
    timeSaved: {
      baselineMinPerKm,
      note: 'Baseline manual-inspection minutes for the km covered by runs, minus actual run minutes.',
      byMonth: monthsList.map((m) => {
        const r = km.get(m);
        return {
          month: m,
          km: r?.km ?? 0,
          hoursSaved:
            baselineMinPerKm !== null && r
              ? Number(((baselineMinPerKm * r.km - r.run_minutes) / 60).toFixed(1))
              : null,
        };
      }),
    },
  };
}

/** Pilot success metrics vs targets. Recall needs a labelled test set, so it is admin-entered. */
export async function pilotMetrics(div: string | null) {
  const since = new Date(Date.now() - 30 * 86_400_000);
  const [rev, evalRow, uptime, demo] = await Promise.all([
    reviewCounts(div, new Date(0), new Date(Date.now() + 86_400_000)),
    prisma.setting.findUnique({ where: { key: 'pilot_eval' } }),
    prisma.$queryRaw<{ device_id: string; hours_seen: number; hours_expected: number }[]>`
      SELECT h.device_id, COUNT(DISTINCT date_trunc('hour', h.received_at))::int AS hours_seen,
             GREATEST(1, CEIL(EXTRACT(EPOCH FROM (NOW() - MIN(h.received_at))) / 3600))::int AS hours_expected
      FROM device_heartbeats h JOIN devices dev ON dev.id = h.device_id
      WHERE ${divClause(div)} AND h.received_at >= ${since} GROUP BY 1`,
    prisma.device.count({ where: { isDemo: true, ...(div ? { divisionId: div } : {}) } }),
  ]);
  const ev = (evalRow?.value ?? {}) as Record<string, number | null>;
  const up = uptime.length
    ? uptime.reduce((a, u) => a + Math.min(1, u.hours_seen / Math.min(u.hours_expected, 720)), 0) /
      uptime.length
    : null;
  const num = (v: unknown) => (typeof v === 'number' ? v : null);
  return {
    isDemoData: demo > 0,
    metrics: [
      {
        key: 'track_precision',
        label: 'Track-defect precision',
        target: 0.85,
        value: precision(rev.confirmed, rev.rejected),
        source: 'Inspector reviews (confirmed / (confirmed + rejected))',
        n: rev.confirmed + rev.rejected,
      },
      {
        key: 'track_recall',
        label: 'Track-defect recall',
        target: 0.8,
        value: num(ev.trackRecall),
        source: 'Labelled field test set (entered by Admin)',
        n: num(ev.trackSamples),
      },
      {
        key: 'crossing_day_recall',
        label: 'Crossing recall - daytime',
        target: 0.9,
        value: num(ev.crossingDayRecall),
        source: 'Labelled field test set (entered by Admin)',
        n: num(ev.crossingDaySamples),
      },
      {
        key: 'crossing_night_recall',
        label: 'Crossing recall - night',
        target: 0.8,
        value: num(ev.crossingNightRecall),
        source: 'Labelled field test set (entered by Admin)',
        n: num(ev.crossingNightSamples),
      },
      {
        key: 'device_uptime',
        label: 'Device uptime (30 d)',
        target: 0.9,
        value: up,
        source: 'Hours with a heartbeat / hours since first heartbeat',
        n: uptime.length,
      },
    ],
  };
}

export async function monthSummary(div: string | null, month: string) {
  const { start, end } = monthRange(month);
  const secWhere = div ? Prisma.sql`sec.division_id = ${div}::uuid` : Prisma.sql`TRUE`;
  const prevStart = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() - 1, 1));
  const [
    rev,
    byClass,
    bySeverity,
    top,
    crossings,
    devices,
    km,
    prevRev,
    riskDist,
    workOrders,
    bySection,
  ] = await Promise.all([
    reviewCounts(div, start, end),
    prisma.$queryRaw<
      { defect_class: string; n: number }[]
    >`SELECT d.defect_class::text AS defect_class, COUNT(*)::int AS n FROM detections d JOIN devices dev ON dev.id = d.device_id WHERE ${divClause(div)} AND d.detected_at >= ${start} AND d.detected_at < ${end} AND d.review_status <> 'REJECTED' GROUP BY 1 ORDER BY 2 DESC`,
    prisma.$queryRaw<
      { severity: string; n: number }[]
    >`SELECT d.severity::text AS severity, COUNT(*)::int AS n FROM detections d JOIN devices dev ON dev.id = d.device_id WHERE ${divClause(div)} AND d.detected_at >= ${start} AND d.detected_at < ${end} AND d.review_status <> 'REJECTED' GROUP BY 1`,
    prisma.$queryRaw<
      { section: string; start_m: number; end_m: number; score: number; raw: number }[]
    >`
      SELECT sec.name AS section, s.chainage_start_m AS start_m, s.chainage_end_m AS end_m, l.score, l.raw_value AS raw
      FROM segment_latest_risk l JOIN segments s ON s.id = l.segment_id JOIN sections sec ON sec.id = s.section_id
      WHERE ${secWhere} ORDER BY l.score DESC, l.raw_value DESC LIMIT 10`,
    prisma.$queryRaw<{ name: string; events: number; warnings: number }[]>`
      SELECT c.name, COUNT(e.id)::int AS events, COUNT(e.id) FILTER (WHERE e.warning_triggered)::int AS warnings
      FROM crossings c LEFT JOIN crossing_events e ON e.crossing_id = c.id AND e.occurred_at >= ${start} AND e.occurred_at < ${end}
      WHERE ${div ? Prisma.sql`c.division_id = ${div}::uuid` : Prisma.sql`TRUE`} GROUP BY c.name ORDER BY c.name`,
    prisma.device.findMany({
      where: div ? { divisionId: div } : {},
      select: {
        name: true,
        type: true,
        status: true,
        firmwareVersion: true,
        modelVersion: true,
        isDemo: true,
        lastSeenAt: true,
        batteryPct: true,
      },
    }),
    prisma.$queryRaw<
      { km: number }[]
    >`SELECT COALESCE(SUM(length_km),0)::float AS km FROM sections sec WHERE ${secWhere}`,
    reviewCounts(div, prevStart, start),
    prisma.$queryRaw<{ score: number; n: number }[]>`
      SELECT l.score::int AS score, COUNT(*)::int AS n
      FROM segment_latest_risk l JOIN segments s ON s.id = l.segment_id JOIN sections sec ON sec.id = s.section_id
      WHERE ${secWhere} GROUP BY 1 ORDER BY 1`,
    prisma.$queryRaw<{ status: string; n: number }[]>`
      SELECT w.status::text AS status, COUNT(*)::int AS n
      FROM work_orders w JOIN segments s ON s.id = w.segment_id JOIN sections sec ON sec.id = s.section_id
      WHERE ${secWhere} AND w.created_at < ${end} AND (w.status IN ('OPEN','IN_PROGRESS') OR w.closed_at >= ${start})
      GROUP BY 1`,
    prisma.$queryRaw<{ section: string; n: number }[]>`
      SELECT sec.name AS section, COUNT(*)::int AS n
      FROM detections d JOIN segments s ON s.id = d.segment_id JOIN sections sec ON sec.id = s.section_id
      WHERE ${secWhere} AND d.detected_at >= ${start} AND d.detected_at < ${end} AND d.review_status <> 'REJECTED'
      GROUP BY 1 ORDER BY 2 DESC`,
  ]);
  return {
    start,
    end,
    rev,
    byClass,
    bySeverity,
    top,
    crossings,
    devices,
    km: km[0]?.km ?? 0,
    prevRev,
    riskDist,
    workOrders,
    bySection,
  };
}
