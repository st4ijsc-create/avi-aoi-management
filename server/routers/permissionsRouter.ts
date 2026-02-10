import { z } from "zod";
import { router, protectedProcedure } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { eq, and } from "drizzle-orm";
import { getDb } from "../db";
import { permissions, users, userRoles, type Permission, type InsertPermission } from "../../drizzle/schema";

// Admin procedure - only admin users can access
const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (ctx.user.role !== 'admin') {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Admin access required' });
  }
  return next({ ctx });
});

// Permission category enum for validation
const permissionCategoryEnum = z.enum([
  'dashboard',
  'history',
  'analytics',
  'reports',
  'mqtt',
  'settings',
  'admin'
]);

export const permissionsRouter = router({
  // Get all users with their permissions
  listUsersWithPermissions: adminProcedure
    .query(async () => {
      const db = await getDb();
      const allUsers = await db
        .select({
          id: users.id,
          username: users.username,
          email: users.email,
          role: users.role,
          isActive: users.isActive,
        })
        .from(users)
        .orderBy(users.username);
      
      const allPermissions = await db
        .select()
        .from(permissions)
        .orderBy(permissions.userId, permissions.category, permissions.moduleName);
      
      // Group permissions by userId
      const permissionsByUser = allPermissions.reduce((acc: Record<number, Permission[]>, perm: Permission) => {
        if (!acc[perm.userId]) {
          acc[perm.userId] = [];
        }
        acc[perm.userId].push(perm);
        return acc;
      }, {} as Record<number, Permission[]>);
      
      return allUsers.map((user: any) => ({
        ...user,
        permissions: permissionsByUser[user.id] || []
      }));
    }),

  // Get permissions for a specific user
  getUserPermissions: protectedProcedure
    .input(z.object({ userId: z.number() }))
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      // Users can view their own permissions, admins can view any user's permissions
      if (ctx.user.id !== input.userId && ctx.user.role !== 'admin') {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'You can only view your own permissions' });
      }
      
      const userPermissions = await db
        .select()
        .from(permissions)
        .where(eq(permissions.userId, input.userId))
        .orderBy(permissions.category, permissions.moduleName);
      
      return userPermissions;
    }),

  // Get current user's permissions (for UI access control)
  getMyPermissions: protectedProcedure
    .query(async ({ ctx }) => {
      const db = await getDb();
      const userPermissions = await db
        .select()
        .from(permissions)
        .where(eq(permissions.userId, ctx.user.id))
        .orderBy(permissions.category, permissions.moduleName);
      
      return userPermissions;
    }),

  // Create or update a permission for a user
  upsertPermission: adminProcedure
    .input(z.object({
      userId: z.number(),
      category: permissionCategoryEnum,
      moduleName: z.string().min(1).max(100),
      canView: z.boolean().default(false),
      canCreate: z.boolean().default(false),
      canEdit: z.boolean().default(false),
      canDelete: z.boolean().default(false),
      canExport: z.boolean().default(false),
      customPermissions: z.record(z.string(), z.any()).optional(),
      expiresAt: z.date().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      // Check if user exists
      const targetUser = await db.query.users.findFirst({
        where: eq(users.id, input.userId)
      });
      
      if (!targetUser) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' });
      }
      
      // Check if permission already exists
      const existing = await db.query.permissions.findFirst({
        where: and(
          eq(permissions.userId, input.userId),
          eq(permissions.moduleName, input.moduleName)
        )
      });
      
      if (existing) {
        // Update existing permission
        await db
          .update(permissions)
          .set({
            category: input.category,
            canView: input.canView,
            canCreate: input.canCreate,
            canEdit: input.canEdit,
            canDelete: input.canDelete,
            canExport: input.canExport,
            customPermissions: input.customPermissions,
            grantedBy: ctx.user.id,
            grantedAt: new Date(),
            expiresAt: input.expiresAt,
            updatedAt: new Date(),
          })
          .where(eq(permissions.id, existing.id));
        
        return { success: true, action: 'updated', permissionId: existing.id };
      } else {
        // Create new permission
        const [newPermission] = await db
          .insert(permissions)
          .values({
            userId: input.userId,
            category: input.category,
            moduleName: input.moduleName,
            canView: input.canView,
            canCreate: input.canCreate,
            canEdit: input.canEdit,
            canDelete: input.canDelete,
            canExport: input.canExport,
            customPermissions: input.customPermissions,
            grantedBy: ctx.user.id,
            grantedAt: new Date(),
            expiresAt: input.expiresAt,
          })
          .returning();
        
        return { success: true, action: 'created', permissionId: newPermission.id };
      }
    }),

  // Batch update permissions for a user
  batchUpdateUserPermissions: adminProcedure
    .input(z.object({
      userId: z.number(),
      permissions: z.array(z.object({
        category: permissionCategoryEnum,
        moduleName: z.string().min(1).max(100),
        canView: z.boolean().default(false),
        canCreate: z.boolean().default(false),
        canEdit: z.boolean().default(false),
        canDelete: z.boolean().default(false),
        canExport: z.boolean().default(false),
        customPermissions: z.record(z.string(), z.any()).optional(),
      }))
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      // Check if user exists
      const targetUser = await db.query.users.findFirst({
        where: eq(users.id, input.userId)
      });
      
      if (!targetUser) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'User not found' });
      }
      
      // Delete all existing permissions for this user
      await db
        .delete(permissions)
        .where(eq(permissions.userId, input.userId));
      
      // Insert new permissions
      if (input.permissions.length > 0) {
        await db
          .insert(permissions)
          .values(
            input.permissions.map(perm => ({
              userId: input.userId,
              category: perm.category,
              moduleName: perm.moduleName,
              canView: perm.canView,
              canCreate: perm.canCreate,
              canEdit: perm.canEdit,
              canDelete: perm.canDelete,
              canExport: perm.canExport,
              customPermissions: perm.customPermissions,
              grantedBy: ctx.user.id,
              grantedAt: new Date(),
            }))
          );
      }
      
      return { success: true, count: input.permissions.length };
    }),

  // Delete a permission
  deletePermission: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      const permission = await db.query.permissions.findFirst({
        where: eq(permissions.id, input.id)
      });
      
      if (!permission) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Permission not found' });
      }
      
      await db
        .delete(permissions)
        .where(eq(permissions.id, input.id));
      
      return { success: true };
    }),

  // Delete all permissions for a user
  deleteUserPermissions: adminProcedure
    .input(z.object({ userId: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      await db
        .delete(permissions)
        .where(eq(permissions.userId, input.userId));
      
      return { success: true };
    }),

  // Get available modules for permission assignment
  getAvailableModules: adminProcedure
    .query(() => {
      return [
        // Dashboard modules
        { category: 'dashboard', moduleName: 'dashboard_view', displayName: 'View Dashboard', description: 'Access to main dashboard page' },
        { category: 'dashboard', moduleName: 'dashboard_widgets', displayName: 'Manage Widgets', description: 'Add/edit/delete dashboard widgets' },
        
        // History modules
        { category: 'history', moduleName: 'history_view', displayName: 'View History', description: 'Access to inspection history page' },
        { category: 'history', moduleName: 'history_export', displayName: 'Export History', description: 'Export history data to files' },
        { category: 'history', moduleName: 'history_delete', displayName: 'Delete History', description: 'Delete inspection records' },
        
        // Analytics modules
        { category: 'analytics', moduleName: 'analytics_view', displayName: 'View Analytics', description: 'Access to analytics dashboards' },
        { category: 'analytics', moduleName: 'analytics_advanced', displayName: 'Advanced Analytics', description: 'Access to SPC, trend analysis, etc.' },
        
        // Reports modules
        { category: 'reports', moduleName: 'reports_view', displayName: 'View Reports', description: 'Access to reports page' },
        { category: 'reports', moduleName: 'reports_create', displayName: 'Create Reports', description: 'Generate new reports' },
        { category: 'reports', moduleName: 'reports_schedule', displayName: 'Schedule Reports', description: 'Set up automated report schedules' },
        { category: 'reports', moduleName: 'reports_export', displayName: 'Export Reports', description: 'Export reports to files' },
        
        // MQTT modules
        { category: 'mqtt', moduleName: 'mqtt_view', displayName: 'View MQTT Status', description: 'Monitor MQTT connections' },
        { category: 'mqtt', moduleName: 'mqtt_configure', displayName: 'Configure MQTT', description: 'Edit MQTT settings and clients' },
        { category: 'mqtt', moduleName: 'mqtt_logs', displayName: 'View MQTT Logs', description: 'Access MQTT message logs' },
        
        // Settings modules
        { category: 'settings', moduleName: 'settings_view', displayName: 'View Settings', description: 'Access to settings page' },
        { category: 'settings', moduleName: 'settings_factory', displayName: 'Factory Settings', description: 'Manage factories, workshops, lines' },
        { category: 'settings', moduleName: 'settings_products', displayName: 'Product Settings', description: 'Manage products and models' },
        { category: 'settings', moduleName: 'settings_machines', displayName: 'Machine Settings', description: 'Manage machines and equipment' },
        { category: 'settings', moduleName: 'settings_alerts', displayName: 'Alert Settings', description: 'Configure alert rules and notifications' },
        
        // Admin modules
        { category: 'admin', moduleName: 'admin_users', displayName: 'User Management', description: 'Create/edit/delete users' },
        { category: 'admin', moduleName: 'admin_permissions', displayName: 'Permissions Management', description: 'Manage user permissions' },
        { category: 'admin', moduleName: 'admin_system', displayName: 'System Settings', description: 'Advanced system configuration' },
        { category: 'admin', moduleName: 'admin_audit', displayName: 'Audit Logs', description: 'View system audit logs' },
      ];
    }),

  // User Roles Management
  listRoles: adminProcedure
    .query(async () => {
      const db = await getDb();
      return await db
        .select()
        .from(userRoles)
        .orderBy(userRoles.name);
    }),

  createRole: adminProcedure
    .input(z.object({
      name: z.string().min(1).max(100),
      description: z.string().optional(),
      permissions: z.array(z.record(z.string(), z.any())),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      // Check if name already exists
      const existing = await db.query.userRoles.findFirst({
        where: eq(userRoles.name, input.name)
      });
      
      if (existing) {
        throw new TRPCError({ code: 'CONFLICT', message: 'Role name already exists' });
      }
      
      const [newRole] = await db
        .insert(userRoles)
        .values({
          name: input.name,
          description: input.description,
          permissions: input.permissions,
          createdBy: ctx.user.id,
        })
        .returning();
      
      return newRole;
    }),

  updateRole: adminProcedure
    .input(z.object({
      id: z.number(),
      name: z.string().min(1).max(100).optional(),
      description: z.string().optional(),
      permissions: z.array(z.record(z.string(), z.any())).optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      const existing = await db.query.userRoles.findFirst({
        where: eq(userRoles.id, input.id)
      });
      
      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Role not found' });
      }
      
      if (existing.isSystem) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Cannot modify system roles' });
      }
      
      await db
        .update(userRoles)
        .set({
          name: input.name,
          description: input.description,
          permissions: input.permissions,
          updatedAt: new Date(),
        })
        .where(eq(userRoles.id, input.id));
      
      return { success: true };
    }),

  deleteRole: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      const existing = await db.query.userRoles.findFirst({
        where: eq(userRoles.id, input.id)
      });
      
      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Role not found' });
      }
      
      if (existing.isSystem) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Cannot delete system roles' });
      }
      
      await db
        .delete(userRoles)
        .where(eq(userRoles.id, input.id));
      
      return { success: true };
    }),
});

