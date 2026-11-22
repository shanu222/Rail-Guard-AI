import { z } from 'zod';

/** Values mirror the Prisma enums in apps/api/prisma/schema.prisma. */
export const ROLES = ['ADMIN', 'DIVISIONAL_ENGINEER', 'INSPECTOR', 'VIEWER'] as const;
export const DEVICE_TYPES = ['TRACK', 'CROSSING'] as const;
export const DEVICE_STATUSES = ['ONLINE', 'DEGRADED', 'OFFLINE'] as const;
export const NETWORK_TYPES = ['LTE_4G', 'LTE_3G', 'WIFI', 'SATELLITE', 'NONE'] as const;
export const CROSSING_STATUSES = ['ACTIVE', 'MAINTENANCE', 'OFFLINE'] as const;

export const DEFECT_CLASSES = [
  'MISSING_FASTENER',
  'BROKEN_FASTENER',
  'DAMAGED_SLEEPER',
  'RAIL_SURFACE_DEFECT',
  'RAIL_JOINT_PROBLEM',
  'BALLAST_DEFICIENCY',
  'VEGETATION',
  'GEOMETRY_IRREGULARITY',
] as const;
export const SEVERITIES = ['MINOR', 'MODERATE', 'SEVERE'] as const;
export const DETECTION_SOURCES = ['IMAGE', 'VIBRATION', 'ACOUSTIC'] as const;
export const FUSION_LEVELS = ['HIGH', 'REVIEW'] as const;
export const REVIEW_STATUSES = ['PENDING', 'CONFIRMED', 'REJECTED', 'NEEDS_INFO'] as const;

export const CROSSING_OBJECT_CLASSES = [
  'CAR',
  'MOTORCYCLE',
  'RICKSHAW',
  'CART',
  'TRACTOR',
  'PERSON',
  'LIVESTOCK',
  'OTHER',
] as const;

export const WORK_ORDER_STATUSES = ['OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED'] as const;
export const WORK_ORDER_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export const MODEL_TYPES = ['TRACK_DEFECT', 'CROSSING_VISION', 'RISK_ENGINE'] as const;

export const RoleSchema = z.enum(ROLES);
export const DeviceTypeSchema = z.enum(DEVICE_TYPES);
export const DeviceStatusSchema = z.enum(DEVICE_STATUSES);
export const NetworkTypeSchema = z.enum(NETWORK_TYPES);
export const CrossingStatusSchema = z.enum(CROSSING_STATUSES);
export const DefectClassSchema = z.enum(DEFECT_CLASSES);
export const SeveritySchema = z.enum(SEVERITIES);
export const DetectionSourceSchema = z.enum(DETECTION_SOURCES);
export const FusionLevelSchema = z.enum(FUSION_LEVELS);
export const ReviewStatusSchema = z.enum(REVIEW_STATUSES);
export const CrossingObjectClassSchema = z.enum(CROSSING_OBJECT_CLASSES);
export const WorkOrderStatusSchema = z.enum(WORK_ORDER_STATUSES);
export const WorkOrderPrioritySchema = z.enum(WORK_ORDER_PRIORITIES);
export const ModelTypeSchema = z.enum(MODEL_TYPES);

export type Role = z.infer<typeof RoleSchema>;
export type DeviceType = z.infer<typeof DeviceTypeSchema>;
export type DefectClass = z.infer<typeof DefectClassSchema>;
export type Severity = z.infer<typeof SeveritySchema>;
export type ReviewStatus = z.infer<typeof ReviewStatusSchema>;
export type CrossingObjectClass = z.infer<typeof CrossingObjectClassSchema>;
