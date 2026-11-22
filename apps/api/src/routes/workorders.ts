import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { WORK_ORDER_PRIORITIES, WORK_ORDER_STATUSES, can } from '@railguard/shared';
import { prisma } from '../db';
import { audit } from '../lib/audit';
import { HttpError, requirePerm } from '../lib/auth-plugin';
import { assertSegment, idParams, plain, scopeOf, Uuid } from '../lib/scope';
import { makeKey, presignGet, presignPut } from '../lib/storage';
import { enqueueRisk } from '../queue';

const include = {
  segment: {
    select: {
      id: true,
      chainageStartM: true,
      chainageEndM: true,
      section: { select: { name: true, divisionId: true } },
    },
  },
  assignedTo: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
} as const;

export async function workOrderRoutes(app: FastifyInstance) {
  app.addHook('preHandler', app.authenticate);

  const Create = z.object({
    segmentId: Uuid,
    detectionIds: z.array(Uuid).max(50).default([]),
    priority: z.enum(WORK_ORDER_PRIORITIES).default('MEDIUM'),
    assignedTo: Uuid.nullable().optional(),
    dueDate: z.coerce.date().nullable().optional(),
    notes: z.string().max(2000).optional(),
  });

  app.get('/v1/work-orders', { schema: { tags: ['work-orders'] } }, async (req) => {
    const q = z
      .object({
        status: z.enum(WORK_ORDER_STATUSES).optional(),
        mine: z.coerce.boolean().optional(),
        segmentId: Uuid.optional(),
      })
      .parse(req.query);
    const div = scopeOf(req.user);
    const rows = await prisma.workOrder.findMany({
      where: {
        ...(div ? { segment: { section: { divisionId: div } } } : {}),
        ...(q.status ? { status: q.status } : {}),
        ...(q.segmentId ? { segmentId: q.segmentId } : {}),
        // inspectors only see orders assigned to them
        ...(q.mine || req.user.role === 'INSPECTOR' ? { assignedToId: req.user.sub } : {}),
      },
      include,
      orderBy: [{ status: 'asc' }, { dueDate: 'asc' }, { createdAt: 'desc' }],
      take: 300,
    });
    return plain(rows);
  });

  app.get('/v1/work-orders/:id', { schema: { tags: ['work-orders'] } }, async (req) => {
    const { id } = idParams.parse(req.params);
    const wo = await prisma.workOrder.findUnique({ where: { id }, include });
    if (!wo || (req.user.div && wo.segment.section.divisionId !== req.user.div))
      throw new HttpError(404, 'Not found');
    if (req.user.role === 'INSPECTOR' && wo.assignedToId !== req.user.sub)
      throw new HttpError(404, 'Not found');
    const [trail, detections] = await Promise.all([
      prisma.auditLog.findMany({
        where: { entity: 'work_order', entityId: id },
        orderBy: { createdAt: 'asc' },
        include: { user: { select: { name: true } } },
      }),
      prisma.detection.findMany({
        where: { id: { in: wo.detectionIds } },
        select: {
          id: true,
          defectClass: true,
          severity: true,
          confidence: true,
          reviewStatus: true,
        },
      }),
    ]);
    return plain({
      ...wo,
      photoUrls: await Promise.all(wo.photos.map((k) => presignGet(k, 300))),
      detections,
      evidenceTrail: trail.map((a) => ({
        at: a.createdAt,
        by: a.user?.name ?? 'system',
        action: a.action,
        after: a.after,
      })),
    });
  });

  app.post(
    '/v1/work-orders',
    { preHandler: requirePerm(app, 'work-orders:assign'), schema: { tags: ['work-orders'] } },
    async (req, reply) => {
      const b = Create.parse(req.body);
      await assertSegment(req.user, b.segmentId);
      const wo = await prisma.workOrder.create({
        data: {
          segmentId: b.segmentId,
          detectionIds: b.detectionIds,
          priority: b.priority,
          assignedToId: b.assignedTo ?? null,
          dueDate: b.dueDate ?? null,
          notes: b.notes,
          createdById: req.user.sub,
        },
      });
      await audit(req, 'work_order.create', 'work_order', wo.id, null, b);
      return reply.code(201).send(wo);
    },
  );

  const Patch = z.object({
    status: z.enum(WORK_ORDER_STATUSES).optional(),
    priority: z.enum(WORK_ORDER_PRIORITIES).optional(),
    assignedTo: Uuid.nullable().optional(),
    dueDate: z.coerce.date().nullable().optional(),
    notes: z.string().max(2000).optional(),
    photoKeys: z.array(z.string().max(300)).max(10).optional(),
  });
  app.patch('/v1/work-orders/:id', { schema: { tags: ['work-orders'] } }, async (req) => {
    const { id } = idParams.parse(req.params);
    const b = Patch.parse(req.body);
    const wo = await prisma.workOrder.findUnique({ where: { id }, include });
    if (!wo || (req.user.div && wo.segment.section.divisionId !== req.user.div))
      throw new HttpError(404, 'Not found');
    if (!can(req.user.role, 'work-orders:update')) throw new HttpError(403, 'Forbidden');
    const assigning =
      b.assignedTo !== undefined || b.dueDate !== undefined || b.priority !== undefined;
    if (assigning && !can(req.user.role, 'work-orders:assign'))
      throw new HttpError(403, 'Only engineers can assign or reprioritise');
    if (req.user.role === 'INSPECTOR' && wo.assignedToId !== req.user.sub)
      throw new HttpError(403, 'Not assigned to you');
    if (b.photoKeys?.some((k) => !k.startsWith(`evidence/${id}/`)))
      throw new HttpError(400, 'Invalid photo key');

    const updated = await prisma.workOrder.update({
      where: { id },
      data: {
        status: b.status,
        priority: b.priority,
        assignedToId: b.assignedTo,
        dueDate: b.dueDate,
        notes: b.notes,
        ...(b.photoKeys?.length ? { photos: { push: b.photoKeys } } : {}),
        ...(b.status === 'DONE' ? { closedAt: new Date() } : {}),
      },
    });
    await audit(
      req,
      'work_order.update',
      'work_order',
      id,
      { status: wo.status, assignedTo: wo.assignedToId },
      b,
    );
    if (b.status === 'DONE' || b.status === 'CANCELLED')
      await enqueueRisk(wo.segment.section.divisionId, { delayMs: 5_000 });
    return updated;
  });

  app.post('/v1/work-orders/:id/photo-url', { schema: { tags: ['work-orders'] } }, async (req) => {
    const { id } = idParams.parse(req.params);
    const b = z.object({ contentType: z.enum(['image/jpeg', 'image/png']) }).parse(req.body);
    const wo = await prisma.workOrder.findUnique({ where: { id }, include });
    if (!wo || (req.user.div && wo.segment.section.divisionId !== req.user.div))
      throw new HttpError(404, 'Not found');
    const key = makeKey('evidence', id, b.contentType);
    return { key, ...(await presignPut(key, b.contentType, 300)) };
  });

  /** Users that work orders can be assigned to. */
  app.get(
    '/v1/assignees',
    { preHandler: requirePerm(app, 'work-orders:assign'), schema: { tags: ['work-orders'] } },
    async (req) => {
      const div = scopeOf(req.user);
      return prisma.user.findMany({
        where: {
          isActive: true,
          role: { in: ['INSPECTOR', 'DIVISIONAL_ENGINEER'] },
          ...(div ? { divisionId: div } : {}),
        },
        select: { id: true, name: true, role: true },
        orderBy: { name: 'asc' },
      });
    },
  );
}
