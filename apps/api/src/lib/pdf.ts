import PDFDocument from 'pdfkit';
import { RISK_COLORS, RISK_DISCLAIMER, RISK_LABELS, type RiskConfig } from '@railguard/shared';
import type { monthSummary } from './metrics';
import { precision } from './metrics';

type Summary = Awaited<ReturnType<typeof monthSummary>>;

const NAVY = '#0F1B2D';
const ORANGE = '#E8643A';
const GREY = '#5B6675';
const LINE = '#D9DEE5';
const ZEBRA = '#F4F6F9';
const GREEN = '#2E9E5B';
const RED = '#D62839';

const M = 48; // page margin
const W = 595.28 - M * 2; // usable width on A4
const FOOT = 40;

const pct = (v: number | null) => (v === null ? 'n/a' : `${(v * 100).toFixed(1)}%`);
const nice = (s: string) =>
  s
    .replaceAll('_', ' ')
    .toLowerCase()
    .replace(/^\w/, (c) => c.toUpperCase());
const dateStr = (d: Date) => d.toISOString().slice(0, 10);
const monthLabel = (m: string) =>
  new Date(`${m}-01T00:00:00Z`).toLocaleString('en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

/** Professional monthly division report (A4). Server-side PDF; the caller stores it in R2. */
export function buildMonthlyPdf(opts: {
  divisionName: string;
  month: string;
  summary: Summary;
  demo: boolean;
  config: RiskConfig;
  generatedBy?: string;
  reference?: string;
}): Promise<Buffer> {
  const { divisionName, month, summary: s, demo, config } = opts;
  const ref =
    opts.reference ?? `RG-${month.replace('-', '')}-${divisionName.slice(0, 3).toUpperCase()}`;
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 80, bottom: 56, left: M, right: M },
    bufferPages: true,
    info: {
      Title: `RAILGUARD AI - Monthly Division Report - ${divisionName} - ${month}`,
      Author: 'Resilience Technologies Labs (SMC-Private) Limited',
      Subject: 'Track health and level-crossing safety report',
      Keywords: 'railway, track health, crossing safety, RAILGUARD AI',
    },
  });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const bottom = () => doc.page.height - doc.page.margins.bottom - 4;
  const ensure = (h: number) => {
    if (doc.y + h > bottom()) doc.addPage();
  };
  const body = () => doc.font('Helvetica').fontSize(9.5).fillColor('#1B2431');

  const h1 = (t: string) => {
    ensure(46);
    doc.moveDown(0.9);
    const y = doc.y;
    doc.rect(M, y, 4, 16).fill(ORANGE);
    doc
      .fillColor(NAVY)
      .font('Helvetica-Bold')
      .fontSize(13)
      .text(t, M + 12, y + 1, { width: W - 12 });
    doc.y = y + 24;
    body();
  };
  const sub = (t: string) => {
    ensure(40);
    doc.font('Helvetica-Bold').fontSize(10).fillColor(NAVY).text(t, M, doc.y, { width: W });
    doc.moveDown(0.3);
    body();
  };
  const note = (t: string) => {
    doc.font('Helvetica-Oblique').fontSize(8.5).fillColor(GREY).text(t, M, doc.y, { width: W });
    doc.moveDown(0.4);
    body();
  };

  /** Table with shaded header and zebra rows. cols: [header, width fraction, align]. */
  const table = (
    cols: [string, number, ('left' | 'right' | 'center')?][],
    rows: string[][],
    empty = 'No data for this period.',
  ) => {
    const widths = cols.map((c) => c[1] * W);
    const drawHead = () => {
      const y = doc.y;
      doc.rect(M, y, W, 20).fill(NAVY);
      let x = M;
      cols.forEach((c, i) => {
        doc
          .fillColor('#fff')
          .font('Helvetica-Bold')
          .fontSize(8.5)
          .text(c[0], x + 6, y + 6, { width: widths[i]! - 12, align: c[2] ?? 'left' });
        x += widths[i]!;
      });
      doc.y = y + 20;
    };
    ensure(60);
    drawHead();
    if (!rows.length) {
      body();
      doc.fillColor(GREY).text(empty, M + 6, doc.y + 6, { width: W - 12 });
      doc.moveDown(0.8);
      return;
    }
    rows.forEach((r, ri) => {
      const rh = Math.max(
        ...r.map((cell, i) =>
          doc
            .font('Helvetica')
            .fontSize(9)
            .heightOfString(cell, { width: widths[i]! - 12 }),
        ),
      );
      const h = rh + 10;
      if (doc.y + h > bottom()) {
        doc.addPage();
        drawHead();
      }
      const y = doc.y;
      if (ri % 2 === 0) doc.rect(M, y, W, h).fill(ZEBRA);
      let x = M;
      r.forEach((cell, i) => {
        doc
          .fillColor('#1B2431')
          .font('Helvetica')
          .fontSize(9)
          .text(cell, x + 6, y + 5, { width: widths[i]! - 12, align: cols[i]![2] ?? 'left' });
        x += widths[i]!;
      });
      doc.y = y + h;
    });
    doc
      .moveTo(M, doc.y)
      .lineTo(M + W, doc.y)
      .strokeColor(LINE)
      .lineWidth(0.7)
      .stroke();
    doc.moveDown(0.6);
    body();
  };

  const barChart = (
    items: { label: string; value: number; color?: string }[],
    unit = '',
    labelW = 150,
  ) => {
    if (!items.length) {
      body();
      doc.fillColor(GREY).text('No data for this period.');
      doc.moveDown(0.5);
      return;
    }
    const max = Math.max(1, ...items.map((i) => i.value));
    const barMax = W - labelW - 70;
    items.forEach((it) => {
      ensure(20);
      const y = doc.y;
      doc
        .font('Helvetica')
        .fontSize(9)
        .fillColor('#1B2431')
        .text(it.label, M, y + 3, { width: labelW - 8, lineBreak: false, ellipsis: true });
      doc.rect(M + labelW, y + 1, barMax, 13).fill(ZEBRA);
      const w = Math.max(it.value > 0 ? 2 : 0, (it.value / max) * barMax);
      if (w > 0) doc.rect(M + labelW, y + 1, w, 13).fill(it.color ?? NAVY);
      doc
        .fillColor('#1B2431')
        .font('Helvetica-Bold')
        .text(`${it.value}${unit}`, M + labelW + barMax + 8, y + 3, {
          width: 60,
          lineBreak: false,
        });
      doc.y = y + 19;
    });
    doc.moveDown(0.3);
    body();
  };

  const kpi = (
    x: number,
    y: number,
    w: number,
    label: string,
    value: string,
    subtext: string,
    color = NAVY,
  ) => {
    doc.roundedRect(x, y, w, 62, 4).lineWidth(0.8).strokeColor(LINE).stroke();
    doc.rect(x, y, 3, 62).fill(color);
    doc
      .fillColor(GREY)
      .font('Helvetica')
      .fontSize(8)
      .text(label.toUpperCase(), x + 12, y + 9, { width: w - 18, lineBreak: false });
    doc
      .fillColor(NAVY)
      .font('Helvetica-Bold')
      .fontSize(20)
      .text(value, x + 12, y + 22, { width: w - 18, lineBreak: false });
    doc
      .fillColor(GREY)
      .font('Helvetica')
      .fontSize(7.5)
      .text(subtext, x + 12, y + 48, { width: w - 18, lineBreak: false, ellipsis: true });
  };

  // ------------------------------------------------------------------ title block (page 1)
  doc.y = 84;
  doc
    .fillColor(GREY)
    .font('Helvetica-Bold')
    .fontSize(9)
    .text('MONTHLY DIVISION REPORT', M, doc.y, { characterSpacing: 1.2 });
  doc.moveDown(0.2);
  doc
    .fillColor(NAVY)
    .font('Helvetica-Bold')
    .fontSize(24)
    .text(divisionName, M, doc.y, { width: W });
  doc
    .fillColor(NAVY)
    .font('Helvetica')
    .fontSize(15)
    .text(monthLabel(month), M, doc.y, { width: W });
  doc.moveDown(0.5);
  const metaY = doc.y;
  const meta: [string, string][] = [
    ['Reporting period', `${dateStr(s.start)} to ${dateStr(new Date(s.end.getTime() - 1))}`],
    ['Report reference', ref],
    ['Generated', `${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`],
    ['Prepared by', opts.generatedBy ?? 'RAILGUARD AI platform'],
  ];
  meta.forEach(([k, v], i) => {
    const cx = M + (i % 2) * (W / 2);
    const cy = metaY + Math.floor(i / 2) * 28;
    doc
      .fillColor(GREY)
      .font('Helvetica')
      .fontSize(8)
      .text(k, cx, cy, { width: W / 2 - 10 });
    doc
      .fillColor('#1B2431')
      .font('Helvetica-Bold')
      .fontSize(10)
      .text(v, cx, cy + 10, { width: W / 2 - 10 });
  });
  doc.y = metaY + 62;
  if (demo) {
    const y = doc.y;
    doc.roundedRect(M, y, W, 30, 3).fill('#FDECE6');
    doc
      .fillColor(ORANGE)
      .font('Helvetica-Bold')
      .fontSize(9.5)
      .text('DEMO DATA', M + 12, y + 10, { continued: true })
      .fillColor('#7A2E15')
      .font('Helvetica')
      .text('  Generated from simulated data. This is not a Pakistan Railways result.', {
        width: W - 24,
      });
    doc.y = y + 40;
  }

  // ------------------------------------------------------------------ executive summary
  h1('1. Executive summary');
  const prec = precision(s.rev.confirmed, s.rev.rejected);
  const prevPrec = precision(s.prevRev.confirmed, s.prevRev.rejected);
  const cw = (W - 3 * 10) / 4;
  const ky = doc.y;
  const delta = s.prevRev.total
    ? `${s.rev.total >= s.prevRev.total ? '+' : ''}${s.rev.total - s.prevRev.total} vs previous month`
    : 'no previous month data';
  kpi(M, ky, cw, 'Detections', String(s.rev.total), delta);
  kpi(
    M + (cw + 10),
    ky,
    cw,
    'Precision',
    pct(prec),
    prec === null
      ? 'no reviews yet'
      : prevPrec === null
        ? `${s.rev.confirmed + s.rev.rejected} reviewed`
        : `previous month ${pct(prevPrec)}`,
    prec !== null && prec >= 0.85 ? GREEN : ORANGE,
  );
  kpi(
    M + 2 * (cw + 10),
    ky,
    cw,
    'Awaiting review',
    String(s.rev.pending),
    'inspector queue',
    s.rev.pending > 0 ? ORANGE : GREEN,
  );
  kpi(M + 3 * (cw + 10), ky, cw, 'Track monitored', `${s.km.toFixed(1)} km`, 'sections in scope');
  doc.y = ky + 76;
  body();

  const openWo = s.workOrders
    .filter((w) => w.status === 'OPEN' || w.status === 'IN_PROGRESS')
    .reduce((a, w) => a + w.n, 0);
  const critical = s.riskDist.filter((r) => r.score >= 4).reduce((a, r) => a + r.n, 0);
  const offline = s.devices.filter((d) => d.status === 'OFFLINE').length;
  const lines = [
    `${s.rev.total} detection(s) were recorded in ${monthLabel(month)}: ${s.rev.confirmed} confirmed, ${s.rev.rejected} rejected and ${s.rev.pending} awaiting inspector review.`,
    prec === null
      ? 'Precision cannot be stated yet because no detections have been reviewed.'
      : `Inspector-measured precision is ${pct(prec)} against the pilot target of 85%.`,
    s.riskDist.length
      ? `${critical} segment(s) currently carry a High or Critical risk score. ${RISK_DISCLAIMER}.`
      : 'Risk scores have not been computed yet for this division.',
    `${openWo} work order(s) are open or in progress. ${offline} of ${s.devices.length} device(s) are offline.`,
  ];
  lines.forEach((l) => {
    ensure(26);
    const y = doc.y;
    doc.circle(M + 4, y + 5, 2).fill(NAVY);
    doc
      .fillColor('#1B2431')
      .font('Helvetica')
      .fontSize(9.5)
      .text(l, M + 14, y, { width: W - 14 });
    doc.moveDown(0.3);
  });

  // ------------------------------------------------------------------ risk
  h1('2. Track risk profile');
  note(`Current segment risk distribution (100 m segments). ${RISK_DISCLAIMER}.`);
  barChart(
    ([1, 2, 3, 4, 5] as const).map((sc) => ({
      label: `${sc} - ${RISK_LABELS[sc]}`,
      value: s.riskDist.find((r) => r.score === sc)?.n ?? 0,
      color: RISK_COLORS[sc],
    })),
    ' seg.',
    110,
  );
  sub('Highest-risk segments');
  table(
    [
      ['Section', 0.38],
      ['Chainage (m)', 0.22],
      ['Score', 0.2],
      ['Raw', 0.2, 'right'],
    ],
    s.top.map((t) => [
      t.section,
      `${t.start_m} - ${t.end_m}`,
      `${t.score} (${RISK_LABELS[t.score as 1 | 2 | 3 | 4 | 5] ?? '-'})`,
      t.raw.toFixed(2),
    ]),
    'No risk scores computed yet.',
  );

  // ------------------------------------------------------------------ detections
  h1('3. Detections');
  sub('By defect class (excluding rejected)');
  barChart(s.byClass.map((c) => ({ label: nice(c.defect_class), value: c.n })));
  sub('By severity');
  const sevColor: Record<string, string> = { MINOR: '#8CC63F', MODERATE: '#F2B01E', SEVERE: RED };
  barChart(
    ['MINOR', 'MODERATE', 'SEVERE'].map((sev) => ({
      label: nice(sev),
      value: s.bySeverity.find((x) => x.severity === sev)?.n ?? 0,
      color: sevColor[sev],
    })),
  );
  sub('By section');
  table(
    [
      ['Section', 0.7],
      ['Detections', 0.3, 'right'],
    ],
    s.bySection.map((x) => [x.section, String(x.n)]),
  );

  h1('4. Review quality');
  table(
    [
      ['Measure', 0.5],
      ['This month', 0.25, 'right'],
      ['Previous month', 0.25, 'right'],
    ],
    [
      ['Confirmed', String(s.rev.confirmed), String(s.prevRev.confirmed)],
      ['Rejected (false alarms)', String(s.rev.rejected), String(s.prevRev.rejected)],
      ['Pending', String(s.rev.pending), String(s.prevRev.pending)],
      ['Precision', pct(prec), pct(prevPrec)],
      [
        'False alarms per km',
        s.km ? (s.rev.rejected / s.km).toFixed(3) : 'n/a',
        s.km ? (s.prevRev.rejected / s.km).toFixed(3) : 'n/a',
      ],
    ],
  );
  note(
    'Precision = confirmed / (confirmed + rejected), from inspector reviews. Recall needs a labelled field test set and is reported on the Pilot page.',
  );

  // ------------------------------------------------------------------ crossings / work / devices
  h1('5. Level crossings');
  table(
    [
      ['Crossing', 0.5],
      ['Events', 0.25, 'right'],
      ['Warnings triggered', 0.25, 'right'],
    ],
    s.crossings.map((c) => [c.name, String(c.events), String(c.warnings)]),
    'No crossings configured.',
  );
  note(
    'Crossing snapshots are privacy-protected on the device (faces and plates blurred) and deleted after the retention period; only metadata is kept.',
  );

  h1('6. Maintenance work orders');
  table(
    [
      ['Status', 0.6],
      ['Count', 0.4, 'right'],
    ],
    ['OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED'].map((st) => [
      nice(st),
      String(s.workOrders.find((w) => w.status === st)?.n ?? 0),
    ]),
  );

  h1('7. Device fleet');
  table(
    [
      ['Device', 0.34],
      ['Type', 0.14],
      ['Status', 0.14],
      ['Firmware', 0.14],
      ['Last seen (UTC)', 0.24],
    ],
    s.devices.map((d) => [
      d.name + (d.isDemo ? ' (demo)' : ''),
      nice(d.type),
      nice(d.status),
      d.firmwareVersion ?? '-',
      d.lastSeenAt ? d.lastSeenAt.toISOString().slice(0, 16).replace('T', ' ') : 'never',
    ]),
    'No devices registered.',
  );

  // ------------------------------------------------------------------ method + sign-off
  h1('8. Method and data notes');
  const w = config.weights;
  body();
  doc
    .fillColor('#1B2431')
    .text(
      `Risk score = ${w.defect} x defect + ${w.trend} x trend + ${w.heat} x heat + ${w.flood} x flood + ${w.local} x local, mapped to 1-5 using ${config.thresholds.mode} thresholds. ` +
        'Defect uses a 90-day window with a 30-day half-life, severity weights 1 / 3 / 6, and review multipliers (confirmed 1.5, pending 1, rejected 0). ' +
        'Every stored score keeps its components so it can be explained on the Risk Map. Scores are a decision aid and must be confirmed on site by a qualified inspector.',
      M,
      doc.y,
      { width: W },
    );
  doc.moveDown(1);
  ensure(90);
  const sy = doc.y + 30;
  ['Prepared by', 'Reviewed by', 'Approved by'].forEach((label, i) => {
    const x = M + i * (W / 3);
    doc
      .moveTo(x, sy)
      .lineTo(x + W / 3 - 20, sy)
      .strokeColor(GREY)
      .lineWidth(0.6)
      .stroke();
    doc
      .fillColor(GREY)
      .font('Helvetica')
      .fontSize(8)
      .text(`${label} (name, signature, date)`, x, sy + 4, { width: W / 3 - 20 });
  });

  // ------------------------------------------------------------------ header + footer on every page
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const pw = doc.page.width;
    const ph = doc.page.height;
    // zero the bottom margin while drawing so footer text cannot trigger auto-pagination
    const savedBottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.rect(0, 0, pw, 56).fill(NAVY);
    doc.rect(0, 56, pw, 3).fill(ORANGE);
    doc
      .fillColor('#fff')
      .font('Helvetica-Bold')
      .fontSize(15)
      .text('RAILGUARD AI', M, 17, { lineBreak: false });
    doc
      .font('Helvetica')
      .fontSize(8.5)
      .fillColor('#C7D0DC')
      .text('Track health and crossing safety', M, 36, { lineBreak: false });
    doc
      .fillColor('#fff')
      .font('Helvetica-Bold')
      .fontSize(9)
      .text(`${divisionName}  |  ${monthLabel(month)}`, M, 22, {
        width: W,
        align: 'right',
        lineBreak: false,
      });
    if (demo)
      doc
        .fillColor('#FFB59C')
        .fontSize(8)
        .text('DEMO DATA', M, 37, { width: W, align: 'right', lineBreak: false });
    doc
      .moveTo(M, ph - FOOT - 6)
      .lineTo(pw - M, ph - FOOT - 6)
      .strokeColor(LINE)
      .lineWidth(0.6)
      .stroke();
    doc
      .fillColor(GREY)
      .font('Helvetica')
      .fontSize(7.5)
      .text(
        `Resilience Technologies Labs (SMC-Private) Limited, Islamabad  |  ${RISK_DISCLAIMER}  |  Ref ${ref}`,
        M,
        ph - FOOT,
        { width: W - 60, lineBreak: false },
      );
    doc.text(`Page ${i - range.start + 1} of ${range.count}`, M, ph - FOOT, {
      width: W,
      align: 'right',
      lineBreak: false,
    });
    doc.page.margins.bottom = savedBottom;
  }

  doc.end();
  return done;
}
