import { prisma } from './db';
import { env } from './env';
import { publish } from './lib/events';
import { deleteObject } from './lib/storage';
import { recalculateDivision } from './risk/run';

export const OFFLINE_AFTER_MIN = 30;
export const DEGRADED_AFTER_MIN = 10;

/** Marks devices ONLINE / DEGRADED / OFFLINE from last_seen_at and notifies on a drop to OFFLINE. */
export async function deviceWatch(now = new Date()) {
  const devices = await prisma.device.findMany({
    where: { revokedAt: null, lastSeenAt: { not: null } },
  });
  for (const d of devices) {
    const ageMin = (now.getTime() - d.lastSeenAt!.getTime()) / 60_000;
    const lowBattery = d.batteryPct !== null && d.batteryPct < 15;
    const status =
      ageMin > OFFLINE_AFTER_MIN
        ? 'OFFLINE'
        : ageMin > DEGRADED_AFTER_MIN || lowBattery
          ? 'DEGRADED'
          : 'ONLINE';
    if (status === d.status) continue;
    await prisma.device.update({ where: { id: d.id }, data: { status } });
    if (status === 'OFFLINE') {
      await prisma.notification.create({
        data: {
          divisionId: d.divisionId,
          type: 'DEVICE_OFFLINE',
          title: `${d.name} is offline`,
          body: `No heartbeat for ${Math.round(ageMin)} minutes.`,
          data: { deviceId: d.id },
        },
      });
      await publish({
        type: 'device.offline',
        divisionId: d.divisionId,
        data: { deviceId: d.id, name: d.name },
      });
    }
  }
}

/** Privacy: delete crossing snapshots older than N days; only metadata is kept long term. */
export async function snapshotPurge(now = new Date()) {
  const row = await prisma.setting.findUnique({ where: { key: 'snapshot_retention_days' } });
  const days = typeof row?.value === 'number' ? row.value : env.SNAPSHOT_RETENTION_DAYS;
  const cutoff = new Date(now.getTime() - days * 86_400_000);
  const old = await prisma.crossingEvent.findMany({
    where: { occurredAt: { lt: cutoff }, snapshotKey: { not: null }, snapshotPurgedAt: null },
    select: { id: true, snapshotKey: true },
    take: 1000,
  });
  for (const e of old) {
    try {
      await deleteObject(e.snapshotKey!);
    } catch {
      /* object may already be gone (lifecycle rule) - still clear the pointer */
    }
    await prisma.crossingEvent.update({
      where: { id: e.id },
      data: { snapshotKey: null, snapshotPurgedAt: now },
    });
  }
  return old.length;
}

export async function riskAll() {
  const divisions = await prisma.division.findMany({ select: { id: true } });
  for (const d of divisions) await recalculateDivision(d.id, { force: true });
}
