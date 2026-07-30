import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { appError } from "../_core/appError";
import { router } from "../_core/trpc";
import { adminProcedure, protectedProcedure } from "./_shared";
import * as db from "../db";
import { storagePut } from "../storage";

export const mqttSoftwareVersionRouter = router({
  // List all software versions
  list: protectedProcedure.query(async () => {
    const { mqttSoftwareVersions } = await import("../../drizzle/schema/mqtt");
    const { desc } = await import("drizzle-orm");
    const database = await db.getDb();
    if (!database) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not connected");
    return database
      .select()
      .from(mqttSoftwareVersions)
      .orderBy(desc(mqttSoftwareVersions.versionCode));
  }),

  // Get the latest version info (for version.json)
  getLatest: protectedProcedure.query(async () => {
    const { mqttSoftwareVersions } = await import("../../drizzle/schema/mqtt");
    const { eq } = await import("drizzle-orm");
    const database = await db.getDb();
    if (!database) return null;
    const [latest] = await database
      .select()
      .from(mqttSoftwareVersions)
      .where(eq(mqttSoftwareVersions.isLatest, true))
      .limit(1);
    return latest ?? null;
  }),

  // Create a new version (metadata only, APK upload separately)
  create: adminProcedure
    .input(
      z.object({
        version: z.string().min(1).max(50),
        versionCode: z.number().int().positive(),
        changelog: z.string().optional(),
        mandatory: z.boolean().default(false),
        minVersionCode: z.number().int().optional(),
        releaseDate: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { mqttSoftwareVersions } = await import("../../drizzle/schema/mqtt");
      const database = await db.getDb();
      if (!database) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not connected");

      const [version] = await database
        .insert(mqttSoftwareVersions)
        .values({
          version: input.version,
          versionCode: input.versionCode,
          changelog: input.changelog ?? null,
          mandatory: input.mandatory,
          minVersionCode: input.minVersionCode ?? null,
          releaseDate: input.releaseDate ? new Date(input.releaseDate) : new Date(),
          uploadedBy: ctx.user?.id ?? null,
        })
        .returning();
      return version;
    }),

  // Upload APK file for a version
  uploadApk: adminProcedure
    .input(
      z.object({
        versionId: z.number(),
        fileName: z.string().min(1).max(255),
        fileBase64: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      const { mqttSoftwareVersions } = await import("../../drizzle/schema/mqtt");
      const { eq } = await import("drizzle-orm");
      const database = await db.getDb();
      if (!database) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not connected");

      // Verify version exists
      const [existing] = await database
        .select()
        .from(mqttSoftwareVersions)
        .where(eq(mqttSoftwareVersions.id, input.versionId))
        .limit(1);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "Version not found" });

      const buffer = Buffer.from(input.fileBase64, "base64");
      const safeName = input.fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
      const fileKey = `mqtt-releases/${existing.versionCode}-${safeName}`;
      const stored = await storagePut(fileKey, buffer, "application/vnd.android.package-archive");

      const [updated] = await database
        .update(mqttSoftwareVersions)
        .set({
          apkFileKey: stored.key,
          apkFileUrl: stored.url,
          apkFileName: input.fileName,
          fileSize: buffer.length,
          updatedAt: new Date(),
        })
        .where(eq(mqttSoftwareVersions.id, input.versionId))
        .returning();
      return updated;
    }),

  // Set a version as the latest (only one can be latest)
  setLatest: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const { mqttSoftwareVersions } = await import("../../drizzle/schema/mqtt");
      const { eq } = await import("drizzle-orm");
      const database = await db.getDb();
      if (!database) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not connected");

      // Verify version exists and has APK
      const [target] = await database
        .select()
        .from(mqttSoftwareVersions)
        .where(eq(mqttSoftwareVersions.id, input.id))
        .limit(1);
      if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "Version not found" });
      if (!target.apkFileUrl) throw new TRPCError({ code: "BAD_REQUEST", message: "Version must have an APK uploaded before setting as latest" });

      // Clear current latest
      await database
        .update(mqttSoftwareVersions)
        .set({ isLatest: false, updatedAt: new Date() })
        .where(eq(mqttSoftwareVersions.isLatest, true));

      // Set new latest
      const [updated] = await database
        .update(mqttSoftwareVersions)
        .set({ isLatest: true, updatedAt: new Date() })
        .where(eq(mqttSoftwareVersions.id, input.id))
        .returning();
      return updated;
    }),

  // Update version metadata
  update: adminProcedure
    .input(
      z.object({
        id: z.number(),
        changelog: z.string().optional(),
        mandatory: z.boolean().optional(),
        minVersionCode: z.number().int().optional().nullable(),
        releaseDate: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const { mqttSoftwareVersions } = await import("../../drizzle/schema/mqtt");
      const { eq } = await import("drizzle-orm");
      const database = await db.getDb();
      if (!database) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not connected");

      const updates: Record<string, unknown> = { updatedAt: new Date() };
      if (input.changelog !== undefined) updates.changelog = input.changelog;
      if (input.mandatory !== undefined) updates.mandatory = input.mandatory;
      if (input.minVersionCode !== undefined) updates.minVersionCode = input.minVersionCode;
      if (input.releaseDate !== undefined) updates.releaseDate = new Date(input.releaseDate);

      const [updated] = await database
        .update(mqttSoftwareVersions)
        .set(updates)
        .where(eq(mqttSoftwareVersions.id, input.id))
        .returning();
      return updated;
    }),

  // Delete a version
  delete: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const { mqttSoftwareVersions } = await import("../../drizzle/schema/mqtt");
      const { eq } = await import("drizzle-orm");
      const database = await db.getDb();
      if (!database) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not connected");
      await database.delete(mqttSoftwareVersions).where(eq(mqttSoftwareVersions.id, input.id));
      return { success: true };
    }),

  // Push update command to specific devices (dedicated SOFTWARE_UPDATE message type)
  pushUpdate: adminProcedure
    .input(
      z.object({
        deviceIds: z.array(z.string().min(1)).min(1),
        command: z.enum(["CHECK_UPDATE", "FORCE_UPDATE"]),
      })
    )
    .mutation(async ({ input }) => {
      const { sendSoftwareUpdateCommand } = await import("../services/mqttService");
      const results = await Promise.allSettled(
        input.deviceIds.map(async (deviceId) => {
          const result = await sendSoftwareUpdateCommand(deviceId, input.command);
          return { deviceId, ...result };
        })
      );

      const succeeded = results.filter((r) => r.status === "fulfilled").length;
      const failed = results.filter((r) => r.status === "rejected").length;
      return { total: input.deviceIds.length, succeeded, failed };
    }),

  // Get device version summary (how many devices on each version)
  deviceVersionSummary: protectedProcedure.query(async () => {
    const { mqttClients } = await import("../../drizzle/schema/mqtt");
    const { sql, eq } = await import("drizzle-orm");
    const database = await db.getDb();
    if (!database) return [];
    const result = await database
      .select({
        appVersion: mqttClients.appVersion,
        count: sql<number>`count(*)::int`,
      })
      .from(mqttClients)
      .where(eq(mqttClients.isActive, true))
      .groupBy(mqttClients.appVersion);
    return result;
  }),
});
