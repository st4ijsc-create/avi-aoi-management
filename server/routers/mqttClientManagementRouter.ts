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
  machines,
  stations,
  factories
} from "../../drizzle/schema";
import { eq, and, desc, sql, like, inArray } from "drizzle-orm";

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
      
      // If setting as default, unset other defaults
      if (input.isDefault) {
        await db.update(mqttClientProfiles)
          .set({ isDefault: false })
          .where(eq(mqttClientProfiles.isDefault, true));
      }
      
      const [result] = await db.insert(mqttClientProfiles).values({
        ...input,
        subscribeTopics: input.subscribeTopics,
        publishTopics: input.publishTopics,
        createdBy: ctx.user.id,
      });
      
      return { id: result.insertId, success: true };
    }),

  // Update profile
  updateProfile: adminProcedure
    .input(updateProfileSchema)
    .mutation(async ({ input }) => {
      const db = await requireDb();
      const { id, ...data } = input;
      
      // If setting as default, unset other defaults
      if (data.isDefault) {
        await db.update(mqttClientProfiles)
          .set({ isDefault: false })
          .where(and(
            eq(mqttClientProfiles.isDefault, true),
            sql`${mqttClientProfiles.id} != ${id}`
          ));
      }
      
      await db.update(mqttClientProfiles)
        .set(data)
        .where(eq(mqttClientProfiles.id, id));
      
      return { success: true };
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
      });
      
      return { id: result.insertId, success: true };
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
      });
      
      return { id: result.insertId, success: true, updated: false };
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
      
      const results = [];
      for (const target of input.targets) {
        // Deactivate existing assignment
        await db.update(mqttProfileAssignments)
          .set({ isActive: false })
          .where(and(
            eq(mqttProfileAssignments.targetType, target.targetType),
            eq(mqttProfileAssignments.targetId, target.targetId),
            eq(mqttProfileAssignments.isActive, true)
          ));
        
        // Create new assignment
        const [result] = await db.insert(mqttProfileAssignments).values({
          profileId: input.profileId,
          targetType: target.targetType,
          targetId: target.targetId,
          overrideSettings: input.overrideSettings,
          assignedBy: ctx.user.id,
        });
        
        results.push({ targetType: target.targetType, targetId: target.targetId, assignmentId: result.insertId });
      }
      
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
          targetName = machine?.name || `Machine #${a.assignment.targetId}`;
        } else if (a.assignment.targetType === "station") {
          const [station] = await db.select({ name: stations.name })
            .from(stations)
            .where(eq(stations.id, a.assignment.targetId))
            .limit(1);
          targetName = station?.name || `Station #${a.assignment.targetId}`;
        } else if (a.assignment.targetType === "factory") {
          const [factory] = await db.select({ name: factories.name })
            .from(factories)
            .where(eq(factories.id, a.assignment.targetId))
            .limit(1);
          targetName = factory?.name || `Factory #${a.assignment.targetId}`;
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
      
      const [result] = await db.insert(mqttTopicTemplates).values(input);
      
      return { id: result.insertId, success: true };
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
          WHERE profileId = ${mqttClientProfiles.id} AND isActive = 1
        )`.as('assignmentCount'),
      }).from(mqttClientProfiles).where(eq(mqttClientProfiles.isActive, true));
      
      if (profileId) {
        profilesQuery = db.select({
          profile: mqttClientProfiles,
          assignmentCount: sql<number>`(
            SELECT COUNT(*) FROM mqtt_profile_assignments 
            WHERE profileId = ${mqttClientProfiles.id} AND isActive = 1
          )`.as('assignmentCount'),
        }).from(mqttClientProfiles).where(eq(mqttClientProfiles.id, profileId));
      }
      
      const profiles = await profilesQuery;
      
      // Get recent connection events for each profile
      const healthData = await Promise.all(profiles.map(async ({ profile, assignmentCount }) => {
        // Get last connection event
        const [lastEvent] = await db.select()
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
            sql`${mqttConnectionLogs.timestamp} > DATE_SUB(NOW(), INTERVAL 1 HOUR)`
          ));
        
        // Get reconnect count in last hour
        const [reconnectCount] = await db.select({
          count: sql<number>`COUNT(*)`.as('count'),
        })
          .from(mqttConnectionLogs)
          .where(and(
            eq(mqttConnectionLogs.profileId, profile.id),
            eq(mqttConnectionLogs.eventType, "reconnect"),
            sql`${mqttConnectionLogs.timestamp} > DATE_SUB(NOW(), INTERVAL 1 HOUR)`
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
              statusMessage = `${reconnectsLastHour} reconnections in last hour`;
            } else {
              status = "warning";
              statusMessage = `${errorsLastHour} errors in last hour`;
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
          
          if (existing) {
            if (replaceExisting) {
              // Deactivate existing assignment
              await db.update(mqttProfileAssignments)
                .set({ isActive: false })
                .where(eq(mqttProfileAssignments.id, existing.id));
            } else {
              results.skipped++;
              continue;
            }
          }
          
          // Create new assignment
          await db.insert(mqttProfileAssignments).values({
            profileId,
            targetType: target.targetType,
            targetId: target.targetId,
            overrideSettings: overrideSettings || null,
            assignedBy: ctx.user?.id,
            isActive: true,
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
      active: sql<number>`SUM(CASE WHEN isActive = 1 THEN 1 ELSE 0 END)`.as('active'),
    }).from(mqttClientProfiles);
    
    // Count assignments
    const [assignmentCount] = await db.select({
      total: sql<number>`COUNT(*)`.as('total'),
      machines: sql<number>`SUM(CASE WHEN targetType = 'machine' AND isActive = 1 THEN 1 ELSE 0 END)`.as('machines'),
      stations: sql<number>`SUM(CASE WHEN targetType = 'station' AND isActive = 1 THEN 1 ELSE 0 END)`.as('stations'),
      factories: sql<number>`SUM(CASE WHEN targetType = 'factory' AND isActive = 1 THEN 1 ELSE 0 END)`.as('factories'),
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
        sql`${mqttConnectionLogs.timestamp} > DATE_SUB(NOW(), INTERVAL 24 HOUR)`
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
});
