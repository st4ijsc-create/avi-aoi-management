/**
 * Phase 3 — Robot router: registry CRUD + read-only telemetry/jobs + connection
 * test. Motion control is NOT exposed here — it goes through the internal
 * robotCommandDispatcher (HITL/dry-run gated), mirroring the OT design.
 */
import { z } from "zod";
import { router, protectedProcedure, adminProcedure } from "../_core/trpc";
import { requirePermission } from "../_core/accessControl";
import { getDb } from "../db/connection";
import { robots, robotTelemetry, robotJobs } from "../../drizzle/schema";
import { eq, desc } from "drizzle-orm";

const vendorEnum = z.enum(["fanuc", "mitsubishi", "delta", "techman", "sim", "vda5050"]);
const kindEnum = z.enum(["arm", "scara", "cobot", "agv"]);

export const robotRouter = router({
  // Doc 38 Đợt Q — these rows carry `endpoint` + `connectionOptions` (device address
  // and, potentially, connection credentials). Gate behind machine_control/canView so
  // the connection surface is not exposed to every authenticated user.
  list: protectedProcedure
    .use(requirePermission("machine_control", "canView"))
    .query(async () => {
      const db = await getDb();
      if (!db) return [];
      return db.select().from(robots).orderBy(desc(robots.updatedAt));
    }),

  get: protectedProcedure
    .use(requirePermission("machine_control", "canView"))
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return null;
      const [row] = await db.select().from(robots).where(eq(robots.id, input.id)).limit(1);
      return row ?? null;
    }),

  telemetry: protectedProcedure
    .input(z.object({ robotId: z.number(), limit: z.number().min(1).max(500).default(100) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      return db.select().from(robotTelemetry)
        .where(eq(robotTelemetry.robotId, input.robotId))
        .orderBy(desc(robotTelemetry.timestamp))
        .limit(input.limit);
    }),

  jobs: protectedProcedure
    .input(z.object({ robotId: z.number(), limit: z.number().min(1).max(200).default(50) }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (!db) return [];
      return db.select().from(robotJobs)
        .where(eq(robotJobs.robotId, input.robotId))
        .orderBy(desc(robotJobs.createdAt))
        .limit(input.limit);
    }),

  create: adminProcedure
    .input(z.object({
      code: z.string().min(1).max(64),
      name: z.string().min(1).max(255),
      vendor: vendorEnum,
      model: z.string().max(128).optional(),
      kind: kindEnum.default("arm"),
      endpoint: z.string().min(1).max(255),
      connectionOptions: z.record(z.string(), z.unknown()).optional(),
      pollIntervalMs: z.number().min(250).max(600000).default(5000),
      lineId: z.number().optional(),
      stationId: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");
      const [row] = await db.insert(robots).values({ ...input, isEnabled: false }).returning();
      return row;
    }),

  update: adminProcedure
    .input(z.object({
      id: z.number(),
      name: z.string().max(255).optional(),
      model: z.string().max(128).optional(),
      endpoint: z.string().max(255).optional(),
      connectionOptions: z.record(z.string(), z.unknown()).optional(),
      pollIntervalMs: z.number().min(250).max(600000).optional(),
      lineId: z.number().optional(),
      stationId: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");
      const { id, ...rest } = input;
      const [row] = await db.update(robots).set({ ...rest, updatedAt: new Date() }).where(eq(robots.id, id)).returning();
      return row;
    }),

  setEnabled: adminProcedure
    .input(z.object({ id: z.number(), enabled: z.boolean() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");
      const [row] = await db.update(robots)
        .set({ isEnabled: input.enabled, updatedAt: new Date() })
        .where(eq(robots.id, input.id)).returning();
      return row;
    }),

  // Read-only connection test: open, read state once, disconnect. No motion.
  testConnection: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("DB unavailable");
      const [r] = await db.select().from(robots).where(eq(robots.id, input.id)).limit(1);
      if (!r) throw new Error("robot not found");
      const { createRobotDriver } = await import("../services/robot");
      const driver = createRobotDriver(r.vendor);
      try {
        await driver.connect({ endpoint: r.endpoint, options: r.connectionOptions ?? undefined });
        const state = await driver.getState();
        return { ok: true, state };
      } catch (err) {
        return { ok: false, error: (err as Error)?.message ?? String(err) };
      } finally {
        try { await driver.disconnect(); } catch { /* ignore */ }
      }
    }),
});
