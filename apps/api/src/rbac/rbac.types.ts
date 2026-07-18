import { z } from 'zod';
import { ALL_PERMISSIONS } from '../common/permissions';

const permissionKey = z.string().refine((k) => ALL_PERMISSIONS.includes(k), {
  message: 'unknown permission key',
});

export const createRoleSchema = z.object({
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().max(240).optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  permissions: z.array(permissionKey).max(ALL_PERMISSIONS.length).default([]),
});
export type CreateRoleInput = z.infer<typeof createRoleSchema>;

export const updateRoleSchema = z.object({
  name: z.string().trim().min(2).max(60).optional(),
  description: z.string().trim().max(240).nullable().optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullable()
    .optional(),
  permissions: z.array(permissionKey).max(ALL_PERMISSIONS.length).optional(),
});
export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;

// Assignable coarse tier: member is hidden from the admin surface; owner assignment is guarded separately.
export const assignRoleSchema = z.object({
  tier: z.enum(['tenant_admin', 'tenant_staff', 'member']).optional(),
  roleId: z.string().uuid().nullable().optional(),
});
export type AssignRoleInput = z.infer<typeof assignRoleSchema>;
