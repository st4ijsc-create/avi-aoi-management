/**
 * MQTT Client Management Router
 * Quản lý tập trung các MQTT Client profiles và assignments
 */

import { z } from "zod";
import { router, protectedProcedure, adminProcedure } from "../_core/trpc";
import { getDb } from "../db";
import { 
  mqttClientProfiles, 
  mqttProfileAssignments, 
  mqttConnectionLogs,
  mqttTopicTemplates,
  mqttReconnectLogs,
  mqttConnectionStatus,
  mqttConnectionAlerts,
  mqttAlertConfig,
  machines,
  stations,
  factories
} from "../../drizzle/schema";
import { eq, and, desc, asc, sql, like, inArray, gte, lte, count, sum, avg, isNull, between } from "drizzle-orm";

// Helper to get db with null check
async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db;
}

// Input schemas
const createProfileSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  brokerUrl: z.string().min(1).max(500),
  port: z.number().int().min(1).max(65535).default(1883),
  protocol: z.enum(["mqtt", "mqtts", "ws", "wss"]).default("mqtt"),
  username: z.string().max(255).optional(),
  password: z.string().max(255).optional(),
  clientIdPrefix: z.string().max(100).optional(),
  useTls: z.boolean().default(false),
  tlsCertPath: z.string().optional(),
  tlsKeyPath: z.string().optional(),
  tlsCaPath: z.string().optional(),
  rejectUnauthorized: z.boolean().default(true),
  keepAlive: z.number().int().min(0).default(60),
  connectTimeout: z.number().int().min(1000).default(30000),
  reconnectPeriod: z.number().int().min(1000).default(5000),
  cleanSession: z.boolean().default(true),
  defaultQos: z.enum(["0", "1", "2"]).default("1"),
  subscribeTopics: z.array(z.string()).default([]),
  publishTopics: z.array(z.string()).default([]),
  messageRetain: z.boolean().default(false),
  isDefault: z.boolean().default(false),
  // Auto-Reconnect Configuration
  autoReconnect: z.boolean().default(true),
  maxReconnectAttempts: z.number().int().min(0).default(10),
  reconnectBackoffMultiplier: z.string().default("1.5"),
  maxReconnectDelay: z.number().int().min(1000).default(60000),
});

const updateProfileSchema = createProfileSchema.partial().extend({
  id: z.number().int(),
});

const assignProfileSchema = z.object({
  profileId: z.number().int(),
  targetType: z.enum(["machine", "station", "factory"]),
  targetId: z.number().int(),
  overrideSettings: z.object({
    subscribeTopics: z.array(z.string()).optional(),
    publishTopics: z.array(z.string()).optional(),
    qos: z.string().optional(),
    clientIdSuffix: z.string().optional(),
  }).optional(),
});

const createTemplateSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  deviceType: z.enum(["avi", "aoi", "spi", "other"]),
  inspectionResultTopic: z.string().max(500).optional(),
  ngAlertTopic: z.string().max(500).optional(),
  statusTopic: z.string().max(500).optional(),
  commandTopic: z.string().max(500).optional(),
  heartbeatTopic: z.string().max(500).optional(),
  messageFormat: z.enum(["json", "xml", "csv", "binary"]).default("json"),
  sampleMessages: z.object({
    inspectionResult: z.any().optional(),
    ngAlert: z.any().optional(),
    status: z.any().optional(),
  }).optional(),
});

export const mqttClientManagementRouter = router({
  // ============= PROFILES =============
  
  // List all profiles
  listProfiles: protectedProcedure
    .input(z.object({
      search: z.string().optional(),
      isActive: z.boolean().optional(),
      limit: z.number().int().min(1).max(100).default(50),
      offset: z.number().int().min(0).default(0),
    }).optional())
    .query(async ({ input }) => {
      const db = await requireDb();
      const { search, isActive, limit = 50, offset = 0 } = input || {};
      
      let query = db.select().from(mqttClientProfiles);
      
      const conditions = [];
      if (search) {
        conditions.push(like(mqttClientProfiles.name, `%${search}%`));
      }
      if (isActive !== undefined) {
        conditions.push(eq(mqttClientProfiles.isActive, isActive));
      }
      
      if (conditions.length > 0) {
        query = query.where(and(...conditions)) as typeof query;
      }
      
      const profiles = await query
        .orderBy(desc(mqttClientProfiles.isDefault), desc(mqttClientProfiles.createdAt))
        .limit(limit)
        .offset(offset);
      
      // Get assignment counts for each profile
      const profileIds = profiles.map((p: { id: number }) => p.id);
      const assignmentCounts = profileIds.length > 0 
        ? await db.select({
            profileId: mqttProfileAssignments.profileId,
            count: sql<number>`COUNT(*)`.as('count'),
          })
          .from(mqttProfileAssignments)
          .where(and(
            inArray(mqttProfileAssignments.profileId, profileIds),
            eq(mqttProfileAssignments.isActive, true)
          ))
          .groupBy(mqttProfileAssignments.profileId)
        : [];
      
      const countMap = new Map(assignmentCounts.map((a: { profileId: number; count: number }) => [a.profileId, Number(a.count)]));
      
      return profiles.map((p: { id: number }) => ({
        ...p,
        assignmentCount: countMap.get(p.id) || 0,
      }));
    }),

  // Get single profile
  getProfile: protectedProcedure
    .input(z.object({ id: z.number().int() }))
    .query(async ({ input }) => {
      const db = await requireDb();
      const [profile] = await db.select()
        .from(mqttClientProfiles)
        .where(eq(mqttClientProfiles.id, input.id))
        .limit(1);
      
      if (!profile) {
        throw new Error("Profile not found");
      }
      
      // Get assignments
      const assignments = await db.select()
        .from(mqttProfileAssignments)
        .where(and(
          eq(mqttProfileAssignments.profileId, input.id),
          eq(mqttProfileAssignments.isActive, true)
        ));
      
      return { ...profile, assignments };
    }),

  // Create profile
  createProfile: adminProcedure
    .input(createProfileSchema)
    .mutation(async ({ input, ctx }) => {
      const db = await requireDb();

      // W2-D: unset-other-defaults + insert are dependent writes → one transaction.
      return db.transaction(async (tx) => {
        // If setting as default, unset other defaults
        if (input.isDefault) {
          await tx.update(mqttClientProfiles)
            .set({ isDefault: false })
            .where(eq(mqttClientProfiles.isDefault, true));
        }

        const [result] = await tx.insert(mqttClientProfiles).values({
          ...input,
          subscribeTopics: input.subscribeTopics,
          publishTopics: input.publishTopics,
          createdBy: ctx.user.id,
        }).returning({ id: mqttClientProfiles.id });

        return { id: result.id, success: true };
      });
    }),

  // Update profile
  updateProfile: adminProcedure
    .input(updateProfileSchema)
    .mutation(async ({ input }) => {
      const db = await requireDb();
      const { id, ...data } = input;

      // W2-D: unset-other-defaults + update are dependent writes → one transaction.
      return db.transaction(async (tx) => {
        // If setting as default, unset other defaults
        if (data.isDefault) {
          await tx.update(mqttClientProfiles)
            .set({ isDefault: false })
            .where(and(
              eq(mqttClientProfiles.isDefault, true),
              sql`${mqttClientProfiles.id} != ${id}`
            ));
        }

        await tx.update(mqttClientProfiles)
          .set(data)
          .where(eq(mqttClientProfiles.id, id));

        return { success: true };
      });
    }),

  // Delete profile
  deleteProfile: adminProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ input }) => {
      const db = await requireDb();
      
      // Check if profile has active assignments
      const [assignment] = await db.select()
        .from(mqttProfileAssignments)
        .where(and(
          eq(mqttProfileAssignments.profileId, input.id),
          eq(mqttProfileAssignments.isActive, true)
        ))
        .limit(1);
      
      if (assignment) {
        throw new Error("Cannot delete profile with active assignments. Please remove all assignments first.");
      }
      
      await db.delete(mqttClientProfiles)
        .where(eq(mqttClientProfiles.id, input.id));
      
      return { success: true };
    }),

  // Duplicate profile
  duplicateProfile: adminProcedure
    .input(z.object({ id: z.number().int(), newName: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const db = await requireDb();
      
      const [original] = await db.select()
        .from(mqttClientProfiles)
        .where(eq(mqttClientProfiles.id, input.id))
        .limit(1);
      
      if (!original) {
        throw new Error("Profile not found");
      }
      
      const { id, createdAt, updatedAt, ...profileData } = original;
      
      const [result] = await db.insert(mqttClientProfiles).values({
        ...profileData,
        name: input.newName,
        isDefault: false,
        createdBy: ctx.user.id,
      }).returning({ id: mqttClientProfiles.id });
      
      return { id: result.id, success: true };
    }),

  // ============= ASSIGNMENTS =============
  
  // Assign profile to target
  assignProfile: adminProcedure
    .input(assignProfileSchema)
    .mutation(async ({ input, ctx }) => {
      const db = await requireDb();
      
      // Check if assignment already exists
      const [existing] = await db.select()
        .from(mqttProfileAssignments)
        .where(and(
          eq(mqttProfileAssignments.targetType, input.targetType),
          eq(mqttProfileAssignments.targetId, input.targetId),
          eq(mqttProfileAssignments.isActive, true)
        ))
        .limit(1);
      
      if (existing) {
        // Update existing assignment
        await db.update(mqttProfileAssignments)
          .set({
            profileId: input.profileId,
            overrideSettings: input.overrideSettings,
          })
          .where(eq(mqttProfileAssignments.id, existing.id));
        
        return { id: existing.id, success: true, updated: true };
      }
      
      // Create new assignment
      const [result] = await db.insert(mqttProfileAssignments).values({
        profileId: input.profileId,
        targetType: input.targetType,
        targetId: input.targetId,
        overrideSettings: input.overrideSettings,
        assignedBy: ctx.user.id,
      }).returning({ id: mqttProfileAssignments.id });
      
      return { id: result.id, success: true, updated: false };
    }),

  // Bulk assign profile to multiple targets
  bulkAssignProfile: adminProcedure
    .input(z.object({
      profileId: z.number().int(),
      targets: z.array(z.object({
        targetType: z.enum(["machine", "station", "factory"]),
        targetId: z.number().int(),
      })),
      overrideSettings: z.object({
        subscribeTopics: z.array(z.string()).optional(),
        publishTopics: z.array(z.string()).optional(),
        qos: z.string().optional(),
        clientIdSuffix: z.string().optional(),
      }).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await requireDb();

      // W2-D: each target does a dependent deactivate+insert; the whole bulk apply
      // is atomic (a mid-batch failure must not leave a half-applied assignment set).
      const results = await db.transaction(async (tx) => {
        const out: Array<{ targetType: string; targetId: number; assignmentId: number }> = [];
        for (const target of input.targets) {
          // Deactivate existing assignment
          await tx.update(mqttProfileAssignments)
            .set({ isActive: false })
            .where(and(
              eq(mqttProfileAssignments.targetType, target.targetType),
              eq(mqttProfileAssignments.targetId, target.targetId),
              eq(mqttProfileAssignments.isActive, true)
            ));

          // Create new assignment
          const [result] = await tx.insert(mqttProfileAssignments).values({
            profileId: input.profileId,
            targetType: target.targetType,
            targetId: target.targetId,
            overrideSettings: input.overrideSettings,
            assignedBy: ctx.user.id,
          }).returning({ id: mqttProfileAssignments.id });

          out.push({ targetType: target.targetType, targetId: target.targetId, assignmentId: result.id });
        }
        return out;
      });

      return { success: true, assignments: results };
    }),

  // Remove assignment
  removeAssignment: adminProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ input }) => {
      const db = await requireDb();
      
      await db.update(mqttProfileAssignments)
        .set({ isActive: false })
        .where(eq(mqttProfileAssignments.id, input.id));
      
      return { success: true };
    }),

  // Get assignments for a target
  getTargetAssignment: protectedProcedure
    .input(z.object({
      targetType: z.enum(["machine", "station", "factory"]),
      targetId: z.number().int(),
    }))
    .query(async ({ input }) => {
      const db = await requireDb();
      
      const [assignment] = await db.select({
        assignment: mqttProfileAssignments,
        profile: mqttClientProfiles,
      })
        .from(mqttProfileAssignments)
        .innerJoin(mqttClientProfiles, eq(mqttProfileAssignments.profileId, mqttClientProfiles.id))
        .where(and(
          eq(mqttProfileAssignments.targetType, input.targetType),
          eq(mqttProfileAssignments.targetId, input.targetId),
          eq(mqttProfileAssignments.isActive, true)
        ))
        .limit(1);
      
      return assignment || null;
    }),

  // List all assignments with details
  listAssignments: protectedProcedure
    .input(z.object({
      profileId: z.number().int().optional(),
      targetType: z.enum(["machine", "station", "factory"]).optional(),
      limit: z.number().int().min(1).max(100).default(50),
      offset: z.number().int().min(0).default(0),
    }).optional())
    .query(async ({ input }) => {
      const db = await requireDb();
      const { profileId, targetType, limit = 50, offset = 0 } = input || {};
      
      let query = db.select({
        assignment: mqttProfileAssignments,
        profile: mqttClientProfiles,
      })
        .from(mqttProfileAssignments)
        .innerJoin(mqttClientProfiles, eq(mqttProfileAssignments.profileId, mqttClientProfiles.id));
      
      const conditions = [eq(mqttProfileAssignments.isActive, true)];
      if (profileId !== undefined) {
        conditions.push(eq(mqttProfileAssignments.profileId, profileId));
      }
      if (targetType !== undefined) {
        conditions.push(eq(mqttProfileAssignments.targetType, targetType));
      }
      
      query = query.where(and(...conditions)) as typeof query;
      
      const assignments = await query
        .orderBy(desc(mqttProfileAssignments.assignedAt))
        .limit(limit)
        .offset(offset);
      
      // Get target names
      const result = await Promise.all(assignments.map(async (a: { assignment: typeof mqttProfileAssignments.$inferSelect; profile: typeof mqttClientProfiles.$inferSelect }) => {
        let targetName = "";
        if (a.assignment.targetType === "machine") {
          const [machine] = await db.select({ name: machines.name })
            .from(machines)
            .where(eq(machines.id, a.assignment.targetId))
            .limit(1);
          targetName = machine?.name || 'Machine #' + a.assignment.targetId;
        } else if (a.assignment.targetType === "station") {
          const [station] = await db.select({ name: stations.name })
            .from(stations)
            .where(eq(stations.id, a.assignment.targetId))
            .limit(1);
          targetName = station?.name || 'Station #' + a.assignment.targetId;
        } else if (a.assignment.targetType === "factory") {
          const [factory] = await db.select({ name: factories.name })
            .from(factories)
            .where(eq(factories.id, a.assignment.targetId))
            .limit(1);
          targetName = factory?.name || 'Factory #' + a.assignment.targetId;
        }
        
        return {
          ...a.assignment,
          profileName: a.profile.name,
          targetName,
        };
      }));
      
      return result;
    }),

  // ============= CONNECTION LOGS =============
  
  // Log connection event
  logConnectionEvent: protectedProcedure
    .input(z.object({
      profileId: z.number().int().optional(),
      assignmentId: z.number().int().optional(),
      clientId: z.string(),
      brokerUrl: z.string(),
      eventType: z.enum(["connect", "disconnect", "error", "reconnect"]),
      eventMessage: z.string().optional(),
      errorCode: z.string().optional(),
      ipAddress: z.string().optional(),
      userAgent: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await requireDb();
      
      await db.insert(mqttConnectionLogs).values(input);
      
      return { success: true };
    }),

  // Get connection logs
  getConnectionLogs: protectedProcedure
    .input(z.object({
      profileId: z.number().int().optional(),
      clientId: z.string().optional(),
      eventType: z.enum(["connect", "disconnect", "error", "reconnect"]).optional(),
      limit: z.number().int().min(1).max(500).default(100),
      offset: z.number().int().min(0).default(0),
    }).optional())
    .query(async ({ input }) => {
      const db = await requireDb();
      const { profileId, clientId, eventType, limit = 100, offset = 0 } = input || {};
      
      let query = db.select().from(mqttConnectionLogs);
      
      const conditions = [];
      if (profileId !== undefined) {
        conditions.push(eq(mqttConnectionLogs.profileId, profileId));
      }
      if (clientId !== undefined) {
        conditions.push(eq(mqttConnectionLogs.clientId, clientId));
      }
      if (eventType !== undefined) {
        conditions.push(eq(mqttConnectionLogs.eventType, eventType));
      }
      
      if (conditions.length > 0) {
        query = query.where(and(...conditions)) as typeof query;
      }
      
      return await query
        .orderBy(desc(mqttConnectionLogs.timestamp))
        .limit(limit)
        .offset(offset);
    }),

  // ============= TOPIC TEMPLATES =============
  
  // List templates
  listTemplates: protectedProcedure
    .input(z.object({
      deviceType: z.enum(["avi", "aoi", "spi", "other"]).optional(),
    }).optional())
    .query(async ({ input }) => {
      const db = await requireDb();
      
      let query = db.select().from(mqttTopicTemplates);
      
      if (input?.deviceType) {
        query = query.where(eq(mqttTopicTemplates.deviceType, input.deviceType)) as typeof query;
      }
      
      return await query.orderBy(mqttTopicTemplates.name);
    }),

  // Create template
  createTemplate: adminProcedure
    .input(createTemplateSchema)
    .mutation(async ({ input }) => {
      const db = await requireDb();
      
      const [result] = await db.insert(mqttTopicTemplates).values(input).returning({ id: mqttTopicTemplates.id });
      
      return { id: result.id, success: true };
    }),

  // Update template
  updateTemplate: adminProcedure
    .input(createTemplateSchema.partial().extend({ id: z.number().int() }))
    .mutation(async ({ input }) => {
      const db = await requireDb();
      const { id, ...data } = input;
      
      await db.update(mqttTopicTemplates)
        .set(data)
        .where(eq(mqttTopicTemplates.id, id));
      
      return { success: true };
    }),

  // Delete template
  deleteTemplate: adminProcedure
    .input(z.object({ id: z.number().int() }))
    .mutation(async ({ input }) => {
      const db = await requireDb();
      
      await db.delete(mqttTopicTemplates)
        .where(eq(mqttTopicTemplates.id, input.id));
      
      return { success: true };
    }),

  // ============= IMPORT/EXPORT =============
  
  // Export profiles to JSON
  exportProfiles: protectedProcedure
    .input(z.object({
      profileIds: z.array(z.number().int()).optional(), // If not provided, export all
      includeAssignments: z.boolean().default(false),
      includeTemplates: z.boolean().default(false),
    }).optional())
    .query(async ({ input }) => {
      const db = await requireDb();
      const { profileIds, includeAssignments = false, includeTemplates = false } = input || {};
      
      // Get profiles
      let profilesQuery = db.select().from(mqttClientProfiles).where(eq(mqttClientProfiles.isActive, true));
      if (profileIds && profileIds.length > 0) {
        profilesQuery = db.select().from(mqttClientProfiles).where(inArray(mqttClientProfiles.id, profileIds));
      }
      const profiles = await profilesQuery;
      
      // Prepare export data
      const exportData: {
        version: string;
        exportedAt: string;
        profiles: any[];
        assignments?: any[];
        templates?: any[];
      } = {
        version: "1.0",
        exportedAt: new Date().toISOString(),
        profiles: profiles.map(p => {
          const { id, createdAt, updatedAt, ...rest } = p;
          return rest;
        }),
      };
      
      // Include assignments if requested
      if (includeAssignments) {
        const assignments = await db.select()
          .from(mqttProfileAssignments)
          .where(eq(mqttProfileAssignments.isActive, true));
        exportData.assignments = assignments.map(a => ({
          ...a,
          id: undefined,
          assignedAt: undefined,
        }));
      }
      
      // Include templates if requested
      if (includeTemplates) {
        const templates = await db.select().from(mqttTopicTemplates);
        exportData.templates = templates.map(t => ({
          ...t,
          id: undefined,
          createdAt: undefined,
        }));
      }
      
      return exportData;
    }),

  // Import profiles from JSON
  importProfiles: adminProcedure
    .input(z.object({
      data: z.object({
        version: z.string(),
        profiles: z.array(z.object({
          name: z.string(),
          description: z.string().optional().nullable(),
          brokerUrl: z.string(),
          port: z.number().int(),
          protocol: z.enum(["mqtt", "mqtts", "ws", "wss"]),
          username: z.string().optional().nullable(),
          password: z.string().optional().nullable(),
          clientIdPrefix: z.string().optional().nullable(),
          useTls: z.boolean(),
          keepAlive: z.number().int(),
          connectTimeout: z.number().int(),
          reconnectPeriod: z.number().int(),
          cleanSession: z.boolean(),
          defaultQos: z.enum(["0", "1", "2"]),
          subscribeTopics: z.any(),
          publishTopics: z.any(),
          messageRetain: z.boolean(),
          isDefault: z.boolean(),
        })),
        assignments: z.array(z.any()).optional(),
        templates: z.array(z.any()).optional(),
      }),
      overwriteExisting: z.boolean().default(false),
      skipDuplicates: z.boolean().default(true),
    }))
    .mutation(async ({ input }) => {
      const db = await requireDb();
      const { data, overwriteExisting, skipDuplicates } = input;
      
      const results = {
        profilesImported: 0,
        profilesSkipped: 0,
        profilesUpdated: 0,
        templatesImported: 0,
        errors: [] as string[],
      };
      
      // Import profiles
      for (const profile of data.profiles) {
        try {
          // Check if profile with same name exists
          const [existing] = await db.select()
            .from(mqttClientProfiles)
            .where(eq(mqttClientProfiles.name, profile.name))
            .limit(1);
          
          if (existing) {
            if (overwriteExisting) {
              await db.update(mqttClientProfiles)
                .set({
                  ...profile,
                  updatedAt: new Date(),
                })
                .where(eq(mqttClientProfiles.id, existing.id));
              results.profilesUpdated++;
            } else if (skipDuplicates) {
              results.profilesSkipped++;
            } else {
              results.errors.push(`Profile "${profile.name}" already exists`);
            }
          } else {
            await db.insert(mqttClientProfiles).values({
              ...profile,
              isActive: true,
            });
            results.profilesImported++;
          }
        } catch (error: any) {
          results.errors.push(`Failed to import profile "${profile.name}": ${error.message}`);
        }
      }
      
      // Import templates if provided
      if (data.templates) {
        for (const template of data.templates) {
          try {
            const [existing] = await db.select()
              .from(mqttTopicTemplates)
              .where(eq(mqttTopicTemplates.name, template.name))
              .limit(1);
            
            if (!existing) {
              await db.insert(mqttTopicTemplates).values(template);
              results.templatesImported++;
            }
          } catch (error: any) {
            results.errors.push(`Failed to import template "${template.name}": ${error.message}`);
          }
        }
      }
      
      return results;
    }),

  // ============= CONNECTION HEALTH MONITOR =============
  
  // Get connection health status for all active profiles
  getConnectionHealth: protectedProcedure
    .input(z.object({
      profileId: z.number().int().optional(),
    }).optional())
    .query(async ({ input }) => {
      const db = await requireDb();
      const { profileId } = input || {};
      
      // Get all active profiles with their assignments
      let profilesQuery = db.select({
        profile: mqttClientProfiles,
        assignmentCount: sql<number>`(
          SELECT COUNT(*) FROM mqtt_profile_assignments 
          WHERE ${mqttProfileAssignments.profileId} = ${mqttClientProfiles.id} AND ${mqttProfileAssignments.isActive} = true
        )`.as('assignmentCount'),
      }).from(mqttClientProfiles).where(eq(mqttClientProfiles.isActive, true));
      
      if (profileId) {
        profilesQuery = db.select({
          profile: mqttClientProfiles,
          assignmentCount: sql<number>`(
            SELECT COUNT(*) FROM mqtt_profile_assignments 
            WHERE ${mqttProfileAssignments.profileId} = ${mqttClientProfiles.id} AND ${mqttProfileAssignments.isActive} = true
          )`.as('assignmentCount'),
        }).from(mqttClientProfiles).where(eq(mqttClientProfiles.id, profileId));
      }
      
      const profiles = await profilesQuery;
      
      // Get recent connection events for each profile
      const healthData = await Promise.all(profiles.map(async ({ profile, assignmentCount }) => {
        // Get last connection event (select explicit columns for strong typing)
        const [lastEvent] = await db.select({
          eventType: mqttConnectionLogs.eventType,
          eventMessage: mqttConnectionLogs.eventMessage,
          timestamp: mqttConnectionLogs.timestamp,
          clientId: mqttConnectionLogs.clientId,
        })
          .from(mqttConnectionLogs)
          .where(eq(mqttConnectionLogs.profileId, profile.id))
          .orderBy(desc(mqttConnectionLogs.timestamp))
          .limit(1);
        
        // Get error count in last hour
        const [errorCount] = await db.select({
          count: sql<number>`COUNT(*)`.as('count'),
        })
          .from(mqttConnectionLogs)
          .where(and(
            eq(mqttConnectionLogs.profileId, profile.id),
            eq(mqttConnectionLogs.eventType, "error"),
            sql`${mqttConnectionLogs.timestamp} >= NOW() - INTERVAL '1 hour'`
          ));
        
        // Get reconnect count in last hour
        const [reconnectCount] = await db.select({
          count: sql<number>`COUNT(*)`.as('count'),
        })
          .from(mqttConnectionLogs)
          .where(and(
            eq(mqttConnectionLogs.profileId, profile.id),
            eq(mqttConnectionLogs.eventType, "reconnect"),
            sql`${mqttConnectionLogs.timestamp} >= NOW() - INTERVAL '1 hour'`
          ));
        
        // Determine health status
        let status: "healthy" | "warning" | "error" | "unknown" = "unknown";
        let statusMessage = "No connection data";
        
        if (lastEvent) {
          const errorsLastHour = Number(errorCount?.count) || 0;
          const reconnectsLastHour = Number(reconnectCount?.count) || 0;
          
          if (lastEvent.eventType === "connect") {
            if (errorsLastHour === 0 && reconnectsLastHour < 3) {
              status = "healthy";
              statusMessage = "Connected and stable";
            } else if (reconnectsLastHour >= 3) {
              status = "warning";
              statusMessage = reconnectsLastHour + ' reconnections in last hour';
            } else {
              status = "warning";
              statusMessage = errorsLastHour + ' errors in last hour';
            }
          } else if (lastEvent.eventType === "disconnect") {
            status = "error";
            statusMessage = "Disconnected";
          } else if (lastEvent.eventType === "error") {
            status = "error";
            statusMessage = lastEvent.eventMessage || "Connection error";
          } else if (lastEvent.eventType === "reconnect") {
            status = "warning";
            statusMessage = "Recently reconnected";
          }
        }
        
        return {
          profileId: profile.id,
          profileName: profile.name,
          brokerUrl: profile.brokerUrl,
          port: profile.port,
          assignmentCount: Number(assignmentCount) || 0,
          status,
          statusMessage,
          lastEvent: lastEvent ? {
            type: lastEvent.eventType,
            message: lastEvent.eventMessage,
            timestamp: lastEvent.timestamp,
            clientId: lastEvent.clientId,
          } : null,
          errorsLastHour: Number(errorCount?.count) || 0,
          reconnectsLastHour: Number(reconnectCount?.count) || 0,
        };
      }));
      
      // Calculate overall health
      const totalProfiles = healthData.length;
      const healthyCount = healthData.filter(h => h.status === "healthy").length;
      const warningCount = healthData.filter(h => h.status === "warning").length;
      const errorCount = healthData.filter(h => h.status === "error").length;
      
      return {
        overall: {
          status: errorCount > 0 ? "error" : warningCount > 0 ? "warning" : healthyCount > 0 ? "healthy" : "unknown",
          totalProfiles,
          healthy: healthyCount,
          warning: warningCount,
          error: errorCount,
          unknown: totalProfiles - healthyCount - warningCount - errorCount,
        },
        profiles: healthData,
        lastUpdated: new Date().toISOString(),
      };
    }),

  // ============= BULK ASSIGNMENT =============
  
  // Bulk assign profile to multiple targets
  bulkAssign: adminProcedure
    .input(z.object({
      profileId: z.number().int(),
      targets: z.array(z.object({
        targetType: z.enum(["machine", "station", "factory"]),
        targetId: z.number().int(),
      })),
      overrideSettings: z.object({
        subscribeTopics: z.array(z.string()).optional(),
        publishTopics: z.array(z.string()).optional(),
        qos: z.enum(["0", "1", "2"]).optional(),
        clientIdSuffix: z.string().optional(),
      }).optional(),
      replaceExisting: z.boolean().default(false), // If true, deactivate existing assignments
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireDb();
      const { profileId, targets, overrideSettings, replaceExisting } = input;
      
      // Verify profile exists
      const [profile] = await db.select()
        .from(mqttClientProfiles)
        .where(eq(mqttClientProfiles.id, profileId))
        .limit(1);
      
      if (!profile) {
        throw new Error("Profile not found");
      }
      
      const results = {
        success: 0,
        skipped: 0,
        errors: [] as string[],
      };
      
      for (const target of targets) {
        try {
          // Check if assignment already exists
          const [existing] = await db.select()
            .from(mqttProfileAssignments)
            .where(and(
              eq(mqttProfileAssignments.targetType, target.targetType),
              eq(mqttProfileAssignments.targetId, target.targetId),
              eq(mqttProfileAssignments.isActive, true)
            ))
            .limit(1);

          if (existing && !replaceExisting) {
            results.skipped++;
            continue;
          }

          // W2-D: the deactivate(existing)+insert(new) pair for ONE target is atomic;
          // the per-target try/catch is preserved so the batch keeps its
          // partial-success semantics (a failed target doesn't abort the rest).
          await db.transaction(async (tx) => {
            if (existing) {
              // Deactivate existing assignment
              await tx.update(mqttProfileAssignments)
                .set({ isActive: false })
                .where(eq(mqttProfileAssignments.id, existing.id));
            }

            // Create new assignment
            await tx.insert(mqttProfileAssignments).values({
              profileId,
              targetType: target.targetType,
              targetId: target.targetId,
              overrideSettings: overrideSettings || null,
              assignedBy: ctx.user?.id,
              isActive: true,
            });
          });

          results.success++;
        } catch (error: any) {
          results.errors.push(`Failed to assign ${target.targetType} ${target.targetId}: ${error.message}`);
        }
      }
      
      return results;
    }),

  // Get available targets for bulk assignment
  getAvailableTargets: protectedProcedure
    .input(z.object({
      targetType: z.enum(["machine", "station", "factory"]),
      search: z.string().optional(),
      excludeAssigned: z.boolean().default(false),
      profileId: z.number().int().optional(),
    }))
    .query(async ({ input }) => {
      const db = await requireDb();
      const { targetType, search, excludeAssigned, profileId } = input;
      
      let targets: { id: number; name: string; code?: string; hasAssignment: boolean }[] = [];
      
      if (targetType === "machine") {
        const machineList = await db.select({
          id: machines.id,
          name: machines.name,
          code: machines.code,
        }).from(machines).where(eq(machines.isActive, true));
        
        // Check assignments
        const assignedIds = await db.select({ targetId: mqttProfileAssignments.targetId })
          .from(mqttProfileAssignments)
          .where(and(
            eq(mqttProfileAssignments.targetType, "machine"),
            eq(mqttProfileAssignments.isActive, true)
          ));
        const assignedSet = new Set(assignedIds.map(a => a.targetId));
        
        targets = machineList.map(m => ({
          id: m.id,
          name: m.name,
          code: m.code || undefined,
          hasAssignment: assignedSet.has(m.id),
        }));
      } else if (targetType === "station") {
        const stationList = await db.select({
          id: stations.id,
          name: stations.name,
          code: stations.code,
        }).from(stations).where(eq(stations.isActive, true));
        
        const assignedIds = await db.select({ targetId: mqttProfileAssignments.targetId })
          .from(mqttProfileAssignments)
          .where(and(
            eq(mqttProfileAssignments.targetType, "station"),
            eq(mqttProfileAssignments.isActive, true)
          ));
        const assignedSet = new Set(assignedIds.map(a => a.targetId));
        
        targets = stationList.map(s => ({
          id: s.id,
          name: s.name,
          code: s.code || undefined,
          hasAssignment: assignedSet.has(s.id),
        }));
      } else {
        const factoryList = await db.select({
          id: factories.id,
          name: factories.name,
          code: factories.code,
        }).from(factories).where(eq(factories.isActive, true));
        
        const assignedIds = await db.select({ targetId: mqttProfileAssignments.targetId })
          .from(mqttProfileAssignments)
          .where(and(
            eq(mqttProfileAssignments.targetType, "factory"),
            eq(mqttProfileAssignments.isActive, true)
          ));
        const assignedSet = new Set(assignedIds.map(a => a.targetId));
        
        targets = factoryList.map(f => ({
          id: f.id,
          name: f.name,
          code: f.code || undefined,
          hasAssignment: assignedSet.has(f.id),
        }));
      }
      
      // Filter by search
      if (search) {
        const searchLower = search.toLowerCase();
        targets = targets.filter(t => 
          t.name.toLowerCase().includes(searchLower) || 
          (t.code && t.code.toLowerCase().includes(searchLower))
        );
      }
      
      // Exclude already assigned
      if (excludeAssigned) {
        targets = targets.filter(t => !t.hasAssignment);
      }
      
      return targets;
    }),

  // Bulk remove assignments
  bulkRemoveAssignments: adminProcedure
    .input(z.object({
      assignmentIds: z.array(z.number().int()),
    }))
    .mutation(async ({ input }) => {
      const db = await requireDb();
      
      await db.update(mqttProfileAssignments)
        .set({ isActive: false })
        .where(inArray(mqttProfileAssignments.id, input.assignmentIds));
      
      return { success: true, removed: input.assignmentIds.length };
    }),

  // ============= DASHBOARD STATS =============
  
  getDashboardStats: protectedProcedure.query(async () => {
    const db = await requireDb();
    
    // Count profiles
    const [profileCount] = await db.select({
      total: sql<number>`COUNT(*)`.as('total'),
      active: sql<number>`SUM(CASE WHEN ${mqttClientProfiles.isActive} = true THEN 1 ELSE 0 END)`.as('active'),
    }).from(mqttClientProfiles);
    
    // Count assignments
    const [assignmentCount] = await db.select({
      total: sql<number>`COUNT(*)`.as('total'),
      machines: sql<number>`SUM(CASE WHEN ${mqttProfileAssignments.targetType} = 'machine' AND ${mqttProfileAssignments.isActive} = true THEN 1 ELSE 0 END)`.as('machines'),
      stations: sql<number>`SUM(CASE WHEN ${mqttProfileAssignments.targetType} = 'station' AND ${mqttProfileAssignments.isActive} = true THEN 1 ELSE 0 END)`.as('stations'),
      factories: sql<number>`SUM(CASE WHEN ${mqttProfileAssignments.targetType} = 'factory' AND ${mqttProfileAssignments.isActive} = true THEN 1 ELSE 0 END)`.as('factories'),
    }).from(mqttProfileAssignments);
    
    // Recent connection events
    const recentLogs = await db.select()
      .from(mqttConnectionLogs)
      .orderBy(desc(mqttConnectionLogs.timestamp))
      .limit(10);
    
    // Error count in last 24h
    const [errorCount] = await db.select({
      count: sql<number>`COUNT(*)`.as('count'),
    })
      .from(mqttConnectionLogs)
      .where(and(
        eq(mqttConnectionLogs.eventType, "error"),
        sql`${mqttConnectionLogs.timestamp} >= NOW() - INTERVAL '24 hours'`
      ));
    
    return {
      profiles: {
        total: Number(profileCount?.total) || 0,
        active: Number(profileCount?.active) || 0,
      },
      assignments: {
        total: Number(assignmentCount?.total) || 0,
        machines: Number(assignmentCount?.machines) || 0,
        stations: Number(assignmentCount?.stations) || 0,
        factories: Number(assignmentCount?.factories) || 0,
      },
      recentLogs,
      errorsLast24h: Number(errorCount?.count) || 0,
    };
  }),

  // ============= CONNECTION STATUS =============
  
  // Get connection status for all assignments
  getConnectionStatus: protectedProcedure
    .input(z.object({
      profileId: z.number().int().optional(),
      targetType: z.enum(["machine", "station", "factory"]).optional(),
      status: z.enum(["connected", "disconnected", "connecting", "error", "unknown"]).optional(),
      limit: z.number().int().min(1).max(100).default(50),
      offset: z.number().int().min(0).default(0),
    }).optional())
    .query(async ({ input }) => {
      const db = await requireDb();
      const { profileId, targetType, status, limit = 50, offset = 0 } = input || {};
      
      const conditions = [];
      if (profileId) conditions.push(eq(mqttConnectionStatus.profileId, profileId));
      if (targetType) conditions.push(eq(mqttConnectionStatus.targetType, targetType));
      if (status) conditions.push(eq(mqttConnectionStatus.status, status));
      
      const statusList = await db.select()
        .from(mqttConnectionStatus)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(mqttConnectionStatus.updatedAt))
        .limit(limit)
        .offset(offset);
      
      // Get profile and target names
      const enrichedStatus = await Promise.all(statusList.map(async (s) => {
        let targetName = "Unknown";
        let profileName = "Unknown";
        
        // Get profile name
        const [profile] = await db.select({ name: mqttClientProfiles.name })
          .from(mqttClientProfiles)
          .where(eq(mqttClientProfiles.id, s.profileId));
        if (profile) profileName = profile.name;
        
        // Get target name
        if (s.targetType === "machine" && s.targetId) {
          const [machine] = await db.select({ name: machines.name })
            .from(machines)
            .where(eq(machines.id, s.targetId));
          if (machine) targetName = machine.name;
        } else if (s.targetType === "station" && s.targetId) {
          const [station] = await db.select({ name: stations.name })
            .from(stations)
            .where(eq(stations.id, s.targetId));
          if (station) targetName = station.name;
        } else if (s.targetType === "factory" && s.targetId) {
          const [factory] = await db.select({ name: factories.name })
            .from(factories)
            .where(eq(factories.id, s.targetId));
          if (factory) targetName = factory.name;
        }
        
        return {
          ...s,
          profileName,
          targetName,
        };
      }));
      
      // Get total count
      const [countResult] = await db.select({
        count: sql<number>`COUNT(*)`.as('count'),
      })
        .from(mqttConnectionStatus)
        .where(conditions.length > 0 ? and(...conditions) : undefined);
      
      return {
        items: enrichedStatus,
        total: Number(countResult?.count) || 0,
        limit,
        offset,
      };
    }),

  // Update connection status (for internal use)
  updateConnectionStatus: protectedProcedure
    .input(z.object({
      profileId: z.number().int(),
      assignmentId: z.number().int().optional(),
      targetType: z.enum(["machine", "station", "factory"]).optional(),
      targetId: z.number().int().optional(),
      status: z.enum(["connected", "disconnected", "connecting", "error", "unknown"]),
      clientId: z.string().optional(),
      brokerUrl: z.string().optional(),
      errorMessage: z.string().optional(),
      errorCode: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await requireDb();
      const { profileId, assignmentId, targetType, targetId, status, clientId, brokerUrl, errorMessage, errorCode } = input;
      
      // Check if status record exists
      const conditions = [eq(mqttConnectionStatus.profileId, profileId)];
      if (assignmentId) conditions.push(eq(mqttConnectionStatus.assignmentId, assignmentId));
      
      const [existing] = await db.select()
        .from(mqttConnectionStatus)
        .where(and(...conditions));
      
      const now = new Date();
      
      if (existing) {
        // Update existing status
        const updateData: any = { status };
        
        if (status === "connected") {
          updateData.connectedAt = now;
          updateData.disconnectedAt = null;
          updateData.lastHeartbeat = now;
        } else if (status === "disconnected" || status === "error") {
          updateData.disconnectedAt = now;
          if (existing.connectedAt) {
            const connectionDuration = Math.floor((now.getTime() - new Date(existing.connectedAt).getTime()) / 1000);
            updateData.totalConnectionTime = (existing.totalConnectionTime || 0) + connectionDuration;
          }
        }
        
        if (errorMessage) updateData.lastErrorMessage = errorMessage;
        if (errorCode) updateData.lastErrorCode = errorCode;
        if (clientId) updateData.clientId = clientId;
        if (brokerUrl) updateData.brokerUrl = brokerUrl;
        
        await db.update(mqttConnectionStatus)
          .set(updateData)
          .where(eq(mqttConnectionStatus.id, existing.id));
        
        return { success: true, id: existing.id };
      } else {
        // Create new status record
        const [result] = await db.insert(mqttConnectionStatus).values({
          profileId,
          assignmentId,
          targetType,
          targetId,
          status,
          clientId,
          brokerUrl,
          connectedAt: status === "connected" ? now : null,
          lastHeartbeat: status === "connected" ? now : null,
          lastErrorMessage: errorMessage,
          lastErrorCode: errorCode,
        }).returning({ id: mqttConnectionStatus.id });
        
        return { success: true, id: result.id };
      }
    }),

  // Get connection status summary
  getConnectionStatusSummary: protectedProcedure
    .query(async () => {
      const db = await requireDb();
      
      const [summary] = await db.select({
        total: sql<number>`COUNT(*)`.as('total'),
        connected: sql<number>`SUM(CASE WHEN status = 'connected' THEN 1 ELSE 0 END)`.as('connected'),
        disconnected: sql<number>`SUM(CASE WHEN status = 'disconnected' THEN 1 ELSE 0 END)`.as('disconnected'),
        connecting: sql<number>`SUM(CASE WHEN status = 'connecting' THEN 1 ELSE 0 END)`.as('connecting'),
        error: sql<number>`SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END)`.as('error'),
        unknown: sql<number>`SUM(CASE WHEN status = 'unknown' THEN 1 ELSE 0 END)`.as('unknown'),
      }).from(mqttConnectionStatus);
      
      return {
        total: Number(summary?.total) || 0,
        connected: Number(summary?.connected) || 0,
        disconnected: Number(summary?.disconnected) || 0,
        connecting: Number(summary?.connecting) || 0,
        error: Number(summary?.error) || 0,
        unknown: Number(summary?.unknown) || 0,
      };
    }),

  // ============= RECONNECT HISTORY =============
  
  // Log reconnect event
  logReconnectEvent: protectedProcedure
    .input(z.object({
      profileId: z.number().int(),
      assignmentId: z.number().int().optional(),
      targetType: z.enum(["machine", "station", "factory"]).optional(),
      targetId: z.number().int().optional(),
      eventType: z.enum(["attempt", "success", "failure", "max_attempts_reached"]),
      attemptNumber: z.number().int().default(1),
      reconnectDelay: z.number().int().optional(),
      connectionDuration: z.number().int().optional(),
      errorCode: z.string().optional(),
      errorMessage: z.string().optional(),
      clientId: z.string().optional(),
      brokerUrl: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await requireDb();

      // W2-D: log insert + reconnect-counter bump are dependent → one transaction.
      const result = await db.transaction(async (tx) => {
        const [row] = await tx.insert(mqttReconnectLogs).values(input).returning({ id: mqttReconnectLogs.id });

        // Update reconnect count in connection status
        if (input.eventType === "attempt") {
          const conditions = [eq(mqttConnectionStatus.profileId, input.profileId)];
          if (input.assignmentId) conditions.push(eq(mqttConnectionStatus.assignmentId, input.assignmentId));

          await tx.update(mqttConnectionStatus)
            .set({ reconnectCount: sql`reconnectCount + 1` })
            .where(and(...conditions));
        }

        return row;
      });

      return { success: true, id: result.id };
    }),

  // Get reconnect history
  getReconnectHistory: protectedProcedure
    .input(z.object({
      profileId: z.number().int().optional(),
      assignmentId: z.number().int().optional(),
      targetType: z.enum(["machine", "station", "factory"]).optional(),
      targetId: z.number().int().optional(),
      eventType: z.enum(["attempt", "success", "failure", "max_attempts_reached"]).optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      limit: z.number().int().min(1).max(500).default(100),
      offset: z.number().int().min(0).default(0),
    }).optional())
    .query(async ({ input }) => {
      const db = await requireDb();
      const { profileId, assignmentId, targetType, targetId, eventType, startDate, endDate, limit = 100, offset = 0 } = input || {};
      
      const conditions = [];
      if (profileId) conditions.push(eq(mqttReconnectLogs.profileId, profileId));
      if (assignmentId) conditions.push(eq(mqttReconnectLogs.assignmentId, assignmentId));
      if (targetType) conditions.push(eq(mqttReconnectLogs.targetType, targetType));
      if (targetId) conditions.push(eq(mqttReconnectLogs.targetId, targetId));
      if (eventType) conditions.push(eq(mqttReconnectLogs.eventType, eventType));
      if (startDate) conditions.push(sql`${mqttReconnectLogs.timestamp} >= ${startDate}`);
      if (endDate) conditions.push(sql`${mqttReconnectLogs.timestamp} <= ${endDate}`);
      
      const logs = await db.select()
        .from(mqttReconnectLogs)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(mqttReconnectLogs.timestamp))
        .limit(limit)
        .offset(offset);
      
      // Get total count
      const [countResult] = await db.select({
        count: sql<number>`COUNT(*)`.as('count'),
      })
        .from(mqttReconnectLogs)
        .where(conditions.length > 0 ? and(...conditions) : undefined);
      
      return {
        items: logs,
        total: Number(countResult?.count) || 0,
        limit,
        offset,
      };
    }),

  // Get reconnect statistics
  getReconnectStats: protectedProcedure
    .input(z.object({
      profileId: z.number().int().optional(),
      targetType: z.enum(["machine", "station", "factory"]).optional(),
      days: z.number().int().min(1).max(90).default(7),
    }).optional())
    .query(async ({ input }) => {
      const db = await requireDb();
      const { profileId, targetType, days = 7 } = input || {};
      
      const conditions = [
        sql`${mqttReconnectLogs.timestamp} >= NOW() - INTERVAL '${sql.raw(days.toString())} days'`
      ];
      if (profileId) conditions.push(eq(mqttReconnectLogs.profileId, profileId));
      if (targetType) conditions.push(eq(mqttReconnectLogs.targetType, targetType));
      
      // Overall stats
      const [stats] = await db.select({
        totalAttempts: sql<number>`SUM(CASE WHEN ${mqttReconnectLogs.eventType} = 'attempt' THEN 1 ELSE 0 END)`.as('totalAttempts'),
        successCount: sql<number>`SUM(CASE WHEN ${mqttReconnectLogs.eventType} = 'success' THEN 1 ELSE 0 END)`.as('successCount'),
        failureCount: sql<number>`SUM(CASE WHEN ${mqttReconnectLogs.eventType} = 'failure' THEN 1 ELSE 0 END)`.as('failureCount'),
        maxAttemptsReached: sql<number>`SUM(CASE WHEN ${mqttReconnectLogs.eventType} = 'max_attempts_reached' THEN 1 ELSE 0 END)`.as('maxAttemptsReached'),
        avgDelay: sql<number>`AVG(${mqttReconnectLogs.reconnectDelay})`.as('avgDelay'),
        maxDelay: sql<number>`MAX(${mqttReconnectLogs.reconnectDelay})`.as('maxDelay'),
      })
        .from(mqttReconnectLogs)
        .where(and(...conditions));
      
      // Daily breakdown
      const dailyStats = await db.select({
        date: sql<string>`timestamp::date`.as('date'),
        attempts: sql<number>`SUM(CASE WHEN ${mqttReconnectLogs.eventType} = 'attempt' THEN 1 ELSE 0 END)`.as('attempts'),
        successes: sql<number>`SUM(CASE WHEN ${mqttReconnectLogs.eventType} = 'success' THEN 1 ELSE 0 END)`.as('successes'),
        failures: sql<number>`SUM(CASE WHEN ${mqttReconnectLogs.eventType} = 'failure' THEN 1 ELSE 0 END)`.as('failures'),
      })
        .from(mqttReconnectLogs)
        .where(and(...conditions))
        .groupBy(sql`timestamp::date`)
        .orderBy(sql`timestamp::date`);
      
      const totalAttempts = Number(stats?.totalAttempts) || 0;
      const successCount = Number(stats?.successCount) || 0;
      
      return {
        summary: {
          totalAttempts,
          successCount,
          failureCount: Number(stats?.failureCount) || 0,
          maxAttemptsReached: Number(stats?.maxAttemptsReached) || 0,
          successRate: totalAttempts > 0 ? ((successCount / totalAttempts) * 100).toFixed(2) : "0.00",
          avgDelay: Number(stats?.avgDelay) || 0,
          maxDelay: Number(stats?.maxDelay) || 0,
        },
        daily: dailyStats.map(d => ({
          date: d.date,
          attempts: Number(d.attempts) || 0,
          successes: Number(d.successes) || 0,
          failures: Number(d.failures) || 0,
        })),
        period: days,
      };
    }),

  // ============= EXPORT ASSIGNMENT REPORT =============
  
  // Export assignments report
  exportAssignmentReport: protectedProcedure
    .input(z.object({
      profileId: z.number().int().optional(),
      targetType: z.enum(["machine", "station", "factory"]).optional(),
      isActive: z.boolean().optional(),
      format: z.enum(["csv", "json"]).default("csv"),
    }).optional())
    .query(async ({ input }) => {
      const db = await requireDb();
      const { profileId, targetType, isActive, format = "csv" } = input || {};
      
      const conditions = [];
      if (profileId) conditions.push(eq(mqttProfileAssignments.profileId, profileId));
      if (targetType) conditions.push(eq(mqttProfileAssignments.targetType, targetType));
      if (isActive !== undefined) conditions.push(eq(mqttProfileAssignments.isActive, isActive));
      
      const assignments = await db.select()
        .from(mqttProfileAssignments)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(mqttProfileAssignments.assignedAt));
      
      // Enrich with profile and target names
      const enrichedAssignments = await Promise.all(assignments.map(async (a) => {
        let targetName = "Unknown";
        let profileName = "Unknown";
        let targetCode = "";
        
        // Get profile name
        const [profile] = await db.select({ name: mqttClientProfiles.name })
          .from(mqttClientProfiles)
          .where(eq(mqttClientProfiles.id, a.profileId));
        if (profile) profileName = profile.name;
        
        // Get target name and code
        if (a.targetType === "machine") {
          const [machine] = await db.select({ name: machines.name, code: machines.code })
            .from(machines)
            .where(eq(machines.id, a.targetId));
          if (machine) {
            targetName = machine.name;
            targetCode = machine.code || "";
          }
        } else if (a.targetType === "station") {
          const [station] = await db.select({ name: stations.name, code: stations.code })
            .from(stations)
            .where(eq(stations.id, a.targetId));
          if (station) {
            targetName = station.name;
            targetCode = station.code || "";
          }
        } else if (a.targetType === "factory") {
          const [factory] = await db.select({ name: factories.name, code: factories.code })
            .from(factories)
            .where(eq(factories.id, a.targetId));
          if (factory) {
            targetName = factory.name;
            targetCode = factory.code || "";
          }
        }
        
        return {
          id: a.id,
          profileId: a.profileId,
          profileName,
          targetType: a.targetType,
          targetId: a.targetId,
          targetName,
          targetCode,
          isActive: a.isActive,
          assignedAt: a.assignedAt,
          updatedAt: a.updatedAt,
        };
      }));
      
      if (format === "json") {
        return {
          format: "json",
          data: enrichedAssignments,
          total: enrichedAssignments.length,
          exportedAt: new Date().toISOString(),
        };
      }
      
      // Generate CSV
      const headers = ["ID", "Profile ID", "Profile Name", "Target Type", "Target ID", "Target Name", "Target Code", "Is Active", "Assigned At", "Updated At"];
      const rows = enrichedAssignments.map(a => [
        a.id,
        a.profileId,
        `"${a.profileName}"`,
        a.targetType,
        a.targetId,
        `"${a.targetName}"`,
        `"${a.targetCode}"`,
        a.isActive ? "Yes" : "No",
        a.assignedAt ? new Date(a.assignedAt).toISOString() : "",
        a.updatedAt ? new Date(a.updatedAt).toISOString() : "",
      ].join(","));
      
      const csv = [headers.join(","), ...rows].join("\n");
      
      return {
        format: "csv",
        data: csv,
        total: enrichedAssignments.length,
        exportedAt: new Date().toISOString(),
      };
    }),

  // ============= ALERT CONFIGURATION =============
  
  // Get alert configuration
  getAlertConfig: protectedProcedure
    .input(z.object({
      profileId: z.number().int().optional(),
    }).optional())
    .query(async ({ input }) => {
      const db = await requireDb();
      const profileId = input?.profileId;
      
      const configs = await db.select().from(mqttAlertConfig)
        .where(profileId ? eq(mqttAlertConfig.profileId, profileId) : isNull(mqttAlertConfig.profileId))
        .limit(1);
      
      if (configs.length === 0) {
        // Return default config
        return {
          id: null,
          profileId: profileId || null,
          connectionLostThreshold: 5,
          reconnectFailedThreshold: 10,
          highReconnectRateThreshold: 20,
          longDisconnectionThreshold: 30,
          enableEmailNotification: false,
          enablePushNotification: true,
          notificationEmails: null,
          isActive: true,
        };
      }
      
      return configs[0];
    }),
  
  // Update alert configuration
  updateAlertConfig: protectedProcedure
    .input(z.object({
      profileId: z.number().int().optional(),
      connectionLostThreshold: z.number().int().min(1).max(1440).optional(),
      reconnectFailedThreshold: z.number().int().min(1).max(100).optional(),
      highReconnectRateThreshold: z.number().int().min(1).max(1000).optional(),
      longDisconnectionThreshold: z.number().int().min(1).max(1440).optional(),
      enableEmailNotification: z.boolean().optional(),
      enablePushNotification: z.boolean().optional(),
      notificationEmails: z.string().optional(),
      isActive: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await requireDb();
      const { profileId, ...updateData } = input;
      
      // Check if config exists
      const existing = await db.select().from(mqttAlertConfig)
        .where(profileId ? eq(mqttAlertConfig.profileId, profileId) : isNull(mqttAlertConfig.profileId))
        .limit(1);
      
      if (existing.length === 0) {
        // Create new config
        const [result] = await db.insert(mqttAlertConfig).values({
          profileId: profileId || null,
          ...updateData,
        }).returning({ id: mqttAlertConfig.id });
        return { success: true, id: result.id };
      } else {
        // Update existing config
        await db.update(mqttAlertConfig)
          .set(updateData)
          .where(eq(mqttAlertConfig.id, existing[0].id));
        return { success: true, id: existing[0].id };
      }
    }),

  // ============= CONNECTION ALERTS =============
  
  // Get connection alerts
  getConnectionAlerts: protectedProcedure
    .input(z.object({
      profileId: z.number().int().optional(),
      alertType: z.enum(["connection_lost", "reconnect_failed", "high_reconnect_rate", "long_disconnection"]).optional(),
      severity: z.enum(["info", "warning", "critical"]).optional(),
      isAcknowledged: z.boolean().optional(),
      isResolved: z.boolean().optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      limit: z.number().int().min(1).max(500).default(100),
      offset: z.number().int().min(0).default(0),
    }).optional())
    .query(async ({ input }) => {
      const db = await requireDb();
      const conditions: any[] = [];
      
      if (input?.profileId) conditions.push(eq(mqttConnectionAlerts.profileId, input.profileId));
      if (input?.alertType) conditions.push(eq(mqttConnectionAlerts.alertType, input.alertType));
      if (input?.severity) conditions.push(eq(mqttConnectionAlerts.severity, input.severity));
      if (input?.isAcknowledged !== undefined) conditions.push(eq(mqttConnectionAlerts.isAcknowledged, input.isAcknowledged));
      if (input?.isResolved !== undefined) conditions.push(eq(mqttConnectionAlerts.isResolved, input.isResolved));
      if (input?.startDate) conditions.push(gte(mqttConnectionAlerts.triggeredAt, new Date(input.startDate)));
      if (input?.endDate) conditions.push(lte(mqttConnectionAlerts.triggeredAt, new Date(input.endDate)));
      
      const alerts = await db.select().from(mqttConnectionAlerts)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(mqttConnectionAlerts.triggeredAt))
        .limit(input?.limit || 100)
        .offset(input?.offset || 0);
      
      // Get total count
      const countResult = await db.select({ count: sql<number>`count(*)` })
        .from(mqttConnectionAlerts)
        .where(conditions.length > 0 ? and(...conditions) : undefined);
      
      return {
        alerts,
        total: countResult[0]?.count || 0,
        limit: input?.limit || 100,
        offset: input?.offset || 0,
      };
    }),
  
  // Get alert summary
  getAlertSummary: protectedProcedure
    .query(async () => {
      const db = await requireDb();
      
      // Get counts by type and severity
      const summary = await db.select({
        alertType: mqttConnectionAlerts.alertType,
        severity: mqttConnectionAlerts.severity,
        isAcknowledged: mqttConnectionAlerts.isAcknowledged,
        count: sql<number>`count(*)`,
      })
        .from(mqttConnectionAlerts)
        .where(eq(mqttConnectionAlerts.isResolved, false))
        .groupBy(mqttConnectionAlerts.alertType, mqttConnectionAlerts.severity, mqttConnectionAlerts.isAcknowledged);
      
      // Calculate totals
      const totals = {
        total: 0,
        unacknowledged: 0,
        critical: 0,
        warning: 0,
        info: 0,
        byType: {
          connection_lost: 0,
          reconnect_failed: 0,
          high_reconnect_rate: 0,
          long_disconnection: 0,
        },
      };
      
      summary.forEach(row => {
        const cnt = Number(row.count);
        totals.total += cnt;
        if (!row.isAcknowledged) totals.unacknowledged += cnt;
        if (row.severity === "critical") totals.critical += cnt;
        if (row.severity === "warning") totals.warning += cnt;
        if (row.severity === "info") totals.info += cnt;
        if (row.alertType) totals.byType[row.alertType as keyof typeof totals.byType] += cnt;
      });
      
      return totals;
    }),
  
  // Acknowledge alert
  acknowledgeAlert: protectedProcedure
    .input(z.object({
      alertId: z.number().int(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await requireDb();
      
      await db.update(mqttConnectionAlerts)
        .set({
          isAcknowledged: true,
          acknowledgedAt: new Date(),
          acknowledgedBy: ctx.user.id,
        })
        .where(eq(mqttConnectionAlerts.id, input.alertId));
      
      return { success: true };
    }),
  
  // Resolve alert
  resolveAlert: protectedProcedure
    .input(z.object({
      alertId: z.number().int(),
    }))
    .mutation(async ({ input }) => {
      const db = await requireDb();
      
      await db.update(mqttConnectionAlerts)
        .set({
          isResolved: true,
          resolvedAt: new Date(),
        })
        .where(eq(mqttConnectionAlerts.id, input.alertId));
      
      return { success: true };
    }),
  
  // Create alert (internal use)
  createAlert: protectedProcedure
    .input(z.object({
      profileId: z.number().int(),
      assignmentId: z.number().int().optional(),
      targetType: z.enum(["machine", "station", "factory"]).optional(),
      targetId: z.number().int().optional(),
      alertType: z.enum(["connection_lost", "reconnect_failed", "high_reconnect_rate", "long_disconnection"]),
      severity: z.enum(["info", "warning", "critical"]).default("warning"),
      title: z.string(),
      message: z.string().optional(),
      thresholdMinutes: z.number().int().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await requireDb();
      
      const [result] = await db.insert(mqttConnectionAlerts).values(input).returning({ id: mqttConnectionAlerts.id });
      
      return { success: true, id: result.id };
    }),

  // ============= RECONNECT ANALYTICS =============
  
  // Get reconnect heatmap (by hour/day)
  getReconnectHeatmap: protectedProcedure
    .input(z.object({
      profileId: z.number().int().optional(),
      targetType: z.enum(["machine", "station", "factory"]).optional(),
      days: z.number().int().min(1).max(30).default(7),
    }).optional())
    .query(async ({ input }) => {
      const db = await requireDb();
      const days = input?.days || 7;
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);
      
      const conditions: any[] = [gte(mqttReconnectLogs.timestamp, startDate)];
      if (input?.profileId) conditions.push(eq(mqttReconnectLogs.profileId, input.profileId));
      if (input?.targetType) conditions.push(eq(mqttReconnectLogs.targetType, input.targetType));
      
      // Get reconnect counts by day of week and hour
      const heatmapData = await db.select({
        dayOfWeek: sql<number>`EXTRACT(DOW FROM timestamp)`,
        hourOfDay: sql<number>`EXTRACT(HOUR FROM timestamp)`,
        count: sql<number>`count(*)`,
      })
        .from(mqttReconnectLogs)
        .where(and(...conditions))
        .groupBy(sql.raw("EXTRACT(DOW FROM timestamp)"), sql.raw("EXTRACT(HOUR FROM timestamp)"));

      // Build heatmap matrix (7 days x 24 hours)
      const matrix: number[][] = Array(7).fill(null).map(() => Array(24).fill(0));
      let maxCount = 0;
      
      heatmapData.forEach(row => {
        const dayIndex = Number(row.dayOfWeek) - 1; // 0-6 (Sunday-Saturday)
        const hourIndex = Number(row.hourOfDay); // 0-23
        const cnt = Number(row.count);
        if (dayIndex >= 0 && dayIndex < 7 && hourIndex >= 0 && hourIndex < 24) {
          matrix[dayIndex][hourIndex] = cnt;
          if (cnt > maxCount) maxCount = cnt;
        }
      });
      
      return {
        matrix,
        maxCount,
        days: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
        hours: Array.from({ length: 24 }, (_, i) => i + ":00"),
        period: { days, startDate: startDate.toISOString() },
      };
    }),
  
  // Get top reconnect profiles
  getTopReconnectProfiles: protectedProcedure
    .input(z.object({
      days: z.number().int().min(1).max(90).default(7),
      limit: z.number().int().min(1).max(50).default(10),
    }).optional())
    .query(async ({ input }) => {
      const db = await requireDb();
      const days = input?.days || 7;
      const limit = input?.limit || 10;
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);
      
      // Get top profiles by reconnect count
      const topProfiles = await db.select({
        profileId: mqttReconnectLogs.profileId,
        totalAttempts: count().as('totalAttempts'),
        successCount: sql<number>`SUM(CASE WHEN ${mqttReconnectLogs.eventType} = 'success' THEN 1 ELSE 0 END)`.as('successCount'),
        failureCount: sql<number>`SUM(CASE WHEN ${mqttReconnectLogs.eventType} = 'failure' THEN 1 ELSE 0 END)`.as('failureCount'),
        avgDelay: avg(mqttReconnectLogs.reconnectDelay).as('avgDelay'),
        maxAttempts: sql<number>`MAX(${mqttReconnectLogs.attemptNumber})`.as('maxAttempts'),
      })
        .from(mqttReconnectLogs)
        .where(gte(mqttReconnectLogs.timestamp, startDate))
        .groupBy(mqttReconnectLogs.profileId)
        .orderBy(desc(sql`"totalAttempts"`))
        .limit(limit);
      
      // Enrich with profile names
      const profileIds = topProfiles.map(p => p.profileId);
      const profiles = profileIds.length > 0 
        ? await db.select().from(mqttClientProfiles).where(inArray(mqttClientProfiles.id, profileIds))
        : [];
      const profileMap = new Map(profiles.map(p => [p.id, p]));
      
      return topProfiles.map(p => ({
        profileId: p.profileId,
        profileName: profileMap.get(p.profileId)?.name || 'Profile #' + p.profileId,
        totalAttempts: Number(p.totalAttempts),
        successCount: Number(p.successCount),
        failureCount: Number(p.failureCount),
        successRate: p.totalAttempts > 0 ? ((Number(p.successCount) / Number(p.totalAttempts)) * 100).toFixed(1) : "0.0",
        avgDelay: Math.round(Number(p.avgDelay) || 0),
        maxAttempts: Number(p.maxAttempts),
      }));
    }),
  
  // Get reconnect trend by day
  getReconnectTrend: protectedProcedure
    .input(z.object({
      profileId: z.number().int().optional(),
      days: z.number().int().min(1).max(90).default(30),
    }).optional())
    .query(async ({ input }) => {
      const db = await requireDb();
      const days = input?.days || 30;
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);
      
      const conditions: any[] = [gte(mqttReconnectLogs.timestamp, startDate)];
      if (input?.profileId) conditions.push(eq(mqttReconnectLogs.profileId, input.profileId));
      
      const trendData = await db.select({
        date: sql.raw("timestamp::date"),
        totalAttempts: count(),
        successCount: count(mqttReconnectLogs.eventType),
        failureCount: count(mqttReconnectLogs.eventType),
        avgDelay: avg(mqttReconnectLogs.reconnectDelay),
      })
        .from(mqttReconnectLogs)
        .where(and(...conditions))
        .groupBy(sql.raw("timestamp::date"))
        .orderBy(asc(sql.raw("timestamp::date")));
      
      return trendData.map(row => ({
        date: row.date,
        totalAttempts: Number(row.totalAttempts),
        successCount: Number(row.successCount),
        failureCount: Number(row.failureCount),
        avgDelay: Math.round(Number(row.avgDelay) || 0),
      }));
    }),
  
  // Get reconnect stats by target
  getReconnectStatsByTarget: protectedProcedure
    .input(z.object({
      targetType: z.enum(["machine", "station", "factory"]),
      days: z.number().int().min(1).max(90).default(7),
      limit: z.number().int().min(1).max(50).default(10),
    }))
    .query(async ({ input }) => {
      const db = await requireDb();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - input.days);
      
      const stats = await db.select({
        targetId: mqttReconnectLogs.targetId,
        totalAttempts: count(),
        successCount: count(mqttReconnectLogs.eventType),
        failureCount: count(mqttReconnectLogs.eventType),
      })
        .from(mqttReconnectLogs)
        .where(and(
          gte(mqttReconnectLogs.timestamp, startDate),
          eq(mqttReconnectLogs.targetType, input.targetType)
        ))
        .groupBy(mqttReconnectLogs.targetId)
        .orderBy(desc(count()))
        .limit(input.limit);
      
      // Enrich with target names
      const targetIds = stats.map(s => s.targetId).filter((id): id is number => id !== null);
      let targetMap = new Map<number, { name: string; code: string }>();
      
      if (targetIds.length > 0) {
        if (input.targetType === "machine") {
          const targets = await db.select().from(machines).where(inArray(machines.id, targetIds));
          targetMap = new Map(targets.map(t => [t.id, { name: t.name, code: t.code }]));
        } else if (input.targetType === "station") {
          const targets = await db.select().from(stations).where(inArray(stations.id, targetIds));
          targetMap = new Map(targets.map(t => [t.id, { name: t.name, code: t.code }]));
        } else if (input.targetType === "factory") {
          const targets = await db.select().from(factories).where(inArray(factories.id, targetIds));
          targetMap = new Map(targets.map(t => [t.id, { name: t.name, code: t.code }]));
        }
      }
      
      return stats.map(s => ({
        targetId: s.targetId,
        targetName: s.targetId ? targetMap.get(s.targetId)?.name || (input.targetType + ' #' + s.targetId) : "Unknown",
        targetCode: s.targetId ? targetMap.get(s.targetId)?.code || "" : "",
        totalAttempts: Number(s.totalAttempts),
        successCount: Number(s.successCount),
        failureCount: Number(s.failureCount),
        successRate: s.totalAttempts > 0 ? ((Number(s.successCount) / Number(s.totalAttempts)) * 100).toFixed(1) : "0.0",
      }));
    }),

  // ============= ALERT SCHEDULER APIs =============
  
  /**
   * Get scheduler status
   */
  getSchedulerStatus: protectedProcedure.query(async () => {
    const { getSchedulerStatus } = await import("../mqttAlertScheduler");
    return getSchedulerStatus();
  }),

  /**
   * Start alert scheduler
   */
  startScheduler: adminProcedure
    .input(z.object({
      intervalMinutes: z.number().int().min(1).max(60).default(5),
    }))
    .mutation(async ({ input }) => {
      const { startAlertScheduler } = await import("../mqttAlertScheduler");
      startAlertScheduler(input.intervalMinutes);
      return { success: true, message: `Scheduler started with ${input.intervalMinutes} minute interval` };
    }),

  /**
   * Stop alert scheduler
   */
  stopScheduler: adminProcedure.mutation(async () => {
    const { stopAlertScheduler } = await import("../mqttAlertScheduler");
    stopAlertScheduler();
    return { success: true, message: "Scheduler stopped" };
  }),

  /**
   * Update scheduler config
   */
  updateSchedulerConfig: adminProcedure
    .input(z.object({
      enabled: z.boolean().optional(),
      intervalMinutes: z.number().int().min(1).max(60).optional(),
      notifyOnCritical: z.boolean().optional(),
      notifyOnWarning: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      const { updateSchedulerConfig } = await import("../mqttAlertScheduler");
      updateSchedulerConfig(input);
      return { success: true };
    }),

  /**
   * Manually trigger alert checks
   */
  triggerAlertChecks: adminProcedure.mutation(async () => {
    const { triggerAlertChecks } = await import("../mqttAlertScheduler");
    return await triggerAlertChecks();
  }),

  // ============= ALERT WIDGET APIs =============
  
  /**
   * Get alert widget data for dashboard
   */
  getAlertWidgetData: protectedProcedure.query(async () => {
    const db = await requireDb();
    
    // Get unresolved alerts summary
    const summary = await db.select({
      severity: mqttConnectionAlerts.severity,
      count: sql<number>`COUNT(*)`.as('count'),
    })
    .from(mqttConnectionAlerts)
    .where(eq(mqttConnectionAlerts.isResolved, false))
    .groupBy(mqttConnectionAlerts.severity);

    // Get recent alerts (last 24h)
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentAlerts = await db.select({
      id: mqttConnectionAlerts.id,
      profileId: mqttConnectionAlerts.profileId,
      alertType: mqttConnectionAlerts.alertType,
      severity: mqttConnectionAlerts.severity,
      title: mqttConnectionAlerts.title,
      triggeredAt: mqttConnectionAlerts.triggeredAt,
      isAcknowledged: mqttConnectionAlerts.isAcknowledged,
    })
    .from(mqttConnectionAlerts)
    .where(
      and(
        eq(mqttConnectionAlerts.isResolved, false),
        gte(mqttConnectionAlerts.triggeredAt, oneDayAgo)
      )
    )
    .orderBy(desc(mqttConnectionAlerts.triggeredAt))
    .limit(5);

    // Calculate totals
    const totals = {
      total: 0,
      critical: 0,
      warning: 0,
      info: 0,
    };

    summary.forEach(row => {
      const cnt = Number(row.count);
      totals.total += cnt;
      if (row.severity === 'critical') totals.critical = cnt;
      if (row.severity === 'warning') totals.warning = cnt;
      if (row.severity === 'info') totals.info = cnt;
    });

    return {
      ...totals,
      recentAlerts,
    };
  }),

  /**
   * Send test notification
   */
  sendTestNotification: adminProcedure
    .input(z.object({
      title: z.string().min(1).max(255),
      content: z.string().min(1).max(1000),
    }))
    .mutation(async ({ input }) => {
      const { notifyOwner } = await import("../_core/notification");
      const success = await notifyOwner(input);
      return { success, message: success ? "Notification sent" : "Failed to send notification" };
    }),
});

