import { z } from 'zod';
import type { Role } from './enums';

export const LoginSchema = z.object({
  email: z
    .string()
    .email()
    .max(254)
    .transform((s) => s.toLowerCase()),
  password: z.string().min(1).max(256),
  totpCode: z
    .string()
    .regex(/^\d{6}$/)
    .optional(),
});

export const PasswordSchema = z
  .string()
  .min(12, 'Use at least 12 characters')
  .max(256)
  .regex(/[a-z]/, 'Add a lowercase letter')
  .regex(/[A-Z]/, 'Add an uppercase letter')
  .regex(/\d/, 'Add a digit');

export const CreateUserSchema = z.object({
  email: z
    .string()
    .email()
    .max(254)
    .transform((s) => s.toLowerCase()),
  name: z.string().min(1).max(120),
  role: z.enum(['ADMIN', 'DIVISIONAL_ENGINEER', 'INSPECTOR', 'VIEWER']),
  divisionId: z.string().uuid().nullable(),
  password: PasswordSchema,
});

export type Permission =
  | 'users:manage'
  | 'devices:manage'
  | 'models:manage'
  | 'settings:manage'
  | 'sections:manage'
  | 'risk-weights:approve'
  | 'work-orders:assign'
  | 'work-orders:update'
  | 'detections:review'
  | 'reports:read'
  | 'data:read';

const ALL: Permission[] = [
  'users:manage',
  'devices:manage',
  'models:manage',
  'settings:manage',
  'sections:manage',
  'risk-weights:approve',
  'work-orders:assign',
  'work-orders:update',
  'detections:review',
  'reports:read',
  'data:read',
];

/** Role → permissions. Every query is additionally scoped to the user's division (null = all). */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  ADMIN: ALL,
  DIVISIONAL_ENGINEER: [
    'risk-weights:approve',
    'work-orders:assign',
    'work-orders:update',
    'detections:review',
    'reports:read',
    'data:read',
  ],
  INSPECTOR: ['detections:review', 'work-orders:update', 'data:read'],
  VIEWER: ['reports:read', 'data:read'],
};

export const can = (role: Role, p: Permission) => ROLE_PERMISSIONS[role].includes(p);
