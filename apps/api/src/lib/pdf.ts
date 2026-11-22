import PDFDocument from 'pdfkit';
import { RISK_DISCLAIMER, RISK_LABELS, type RiskConfig } from '@railguard/shared';
import type { monthSummary } from './metrics';
import { precision } from './metrics';

type Summary = Awaited<ReturnType<typeof monthSummary>>;

const NAVY = '#0F1B2D';
const ORANGE = '#E8643A';
const GREY = '#5B6675';
const pct = (v: number | null) =>
  v === null ? 'n/a (no reviews yet)' : `${(v * 100).toFixed(1)}%`;

/** Monthly division report. Server-side PDF; the caller stores it in R2. */
export function buildMonthlyPdf(opts: {
  divisionName: string;
  month: string;
  summary: Summary;
  demo: boolean;
  config: RiskConfig;
}): Promise<Buffer> {
  const { divisionName, month, summary: s, demo, config } = opts;
  const doc = new PDFDocument({
    size: 'A4',
    margin: 48,
    info: {
      Title: `RAILGUARD AI monthly report ${month}`,
      Author: 'Resilience Technologies Labs (SMC-Private) Limited',
    },
  });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) =>
    doc.on('end', () => resolve(Buffer.concat(chunks))),
  );

  const h2 = (t: string) => {
    doc.moveDown(0.8).fillColor(NAVY).font('Helvetica-Bold').fontSize(13).text(t).moveDown(0.3);
    doc.font('Helvetica').fontSize(10).fillColor('#000');
  };
  const row = (a: string, b: string) => {
    const y = doc.y;
    doc.text(a, 48, y, { width: 330 }).text(b, 380, y, { width: 160, align: 'right' });
    doc.moveDown(0.2);
  };

  doc.rect(0, 0, doc.page.width, 70).fill(NAVY);
  doc.fillColor('#fff').font('Helvetica-Bold').fontSize(20).text('RAILGUARD AI', 48, 22);
  doc.font('Helvetica').fontSize(10).text('Monthly division report', 48, 46);
  doc.fillColor('#000').y = 90;
  doc.font('Helvetica-Bold').fontSize(16).text(`${divisionName} - ${month}`, 48);
  if (demo)
    doc
      .moveDown(0.3)
      .fillColor(ORANGE)
      .font('Helvetica-Bold')
      .fontSize(10)
      .text('DEMO DATA - simulated; not real Pakistan Railways results.', 48);
  doc
    .fillColor(GREY)
    .font('Helvetica')
    .fontSize(9)
    .text(`Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`);
  doc.fillColor('#000').fontSize(10);

  h2('Summary');
  row('Track length monitored', `${s.km.toFixed(1)} km`);
  row('Detections in month', String(s.rev.total));
  row('Awaiting review', String(s.rev.pending));
  row('Confirmed / rejected', `${s.rev.confirmed} / ${s.rev.rejected}`);
  row(
    'Precision (confirmed / (confirmed + rejected))',
    pct(precision(s.rev.confirmed, s.rev.rejected)),
  );
  row('False alarms per km', s.km ? (s.rev.rejected / s.km).toFixed(3) : 'n/a');

  h2('Detections by defect class (excl. rejected)');
  if (!s.byClass.length) doc.text('No detections this month.');
  s.byClass.forEach((c) => row(c.defect_class.replaceAll('_', ' ').toLowerCase(), String(c.n)));
  h2('Detections by severity');
  s.bySeverity.forEach((c) => row(c.severity, String(c.n)));

  h2(`Highest-risk segments (latest score)  -  ${RISK_DISCLAIMER}`);
  if (!s.top.length) doc.text('No risk scores computed yet.');
  s.top.forEach((t) =>
    row(
      `${t.section}  ${t.start_m}-${t.end_m} m`,
      `${t.score} (${RISK_LABELS[t.score as 1 | 2 | 3 | 4 | 5]})  raw ${t.raw.toFixed(2)}`,
    ),
  );

  h2('Level crossings');
  s.crossings.forEach((c) => row(c.name, `${c.events} events, ${c.warnings} warnings`));

  h2('Devices');
  s.devices.forEach((d) =>
    row(`${d.name} (${d.type})`, `${d.status}  fw ${d.firmwareVersion ?? '-'}`),
  );

  h2('Method');
  doc
    .fillColor(GREY)
    .fontSize(9)
    .text(
      `Risk score = ${config.weights.defect}*defect + ${config.weights.trend}*trend + ${config.weights.heat}*heat + ${config.weights.flood}*flood + ${config.weights.local}*local, ` +
        `mapped to 1-5 by ${config.thresholds.mode} thresholds. Scores are a decision aid and must be confirmed on site. ` +
        'Crossing snapshots are privacy-protected (faces and plates blurred on device) and deleted after the retention period.',
    );
  doc.end();
  return done;
}
