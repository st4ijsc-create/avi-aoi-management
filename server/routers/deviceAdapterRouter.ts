/**
 * Sprint G2.2a — Device Adapter + Tag CONFIG router (RBAC module 'machine_control').
 *
 * ════════════════════════════════════════════════════════════════════════════
 * SAFETY:
 *   - This router ONLY manages CONFIGURATION (adapter connection definition + tag
 *     definitions) and runs a READ-ONLY connectivity probe (testConnection). It
 *     does NOT import commandDispatcher and NEVER calls driver.writeTags — there is
 *     no code path from here that writes a value to a machine.
 *   - testConnection: createDriver(protocol).connect(cfg) → disconnect() inside a
 *     try/finally under a hard timeout. It reads NOTHING and writes NOTHING; it only
 *     reports whether the endpoint is reachable.
 *   - Marking a tag `writable` here only DECLARES that the tag may be a write target;
 *     the actual write still goes exclusively through the HITL / interlock dispatcher
 *     (F4/F5b), which re-checks the allowlist + mode flags.
 * RBAC via module 'machine_control':
 *   list/get/testConnection/tags.listByAdapter → canView
 *   create/tags.create → canCreate ; update/tags.update → canEdit
 *   delete/tags.delete → canDelete
 * ════════════════════════════════════════════════════════════════════════════
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { appError } from "../_core/appError";
import { and, eq, desc } from "drizzle-orm";
import { router, protectedProcedure } from "../_core/trpc";
import { requirePermission } from "../_core/accessControl";
import { getDb as getDbRaw } from "../db";
import { deviceAdapters, deviceTags } from "../../drizzle/schema";
import { createDriver } from "../services/ot/driverRegistry";
import "../services/ot"; // side-effect: register all drivers (stub + 5 protocol scaffolds)
import type { OtProtocol } from "../services/ot/otDriver";

async function getDb() {
  const db = await getDbRaw();
  if (!db) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not connected");
  return db;
}

// doc 54 P1.5 — add "slmp" (Mitsubishi SLMP 3E/4E): the runtime driver (slmpDriver.ts)
// + the DB protocol enum already support it; the CRUD zod enum was the only thing blocking
// FX5U/iQ-R SLMP adapters from being created via the UI/API.
const protocolEnum = z.enum(["opcua", "modbus", "s7", "mitsubishi-mc", "ethernet-ip", "slmp", "stub"]);
const dataTypeEnum = z.enum(["bool", "int", "float", "string", "json"]);

const adapterCreateInput = z.object({
  code: z.string().min(1).max(64),
  name: z.string().min(1).max(255),
  protocol: protocolEnum,
  endpoint: z.string().min(1).max(500),
  connectionOptions: z.record(z.string(), z.unknown()).nullable().optional(),
  pollIntervalMs: z.number().int().min(100).max(3_600_000).default(5000),
  machineId: z.number().int().positive().nullable().optional(),
  isEnabled: z.boolean().default(false),
});

const tagCreateInput = z.object({
  adapterId: z.number().int().positive(),
  tagKey: z.string().min(1).max(128),
  address: z.string().min(1).max(255),
  dataType: dataTypeEnum,
  unit: z.string().max(50).nullable().optional(),
  scale: z.number().nullable().optional(),
  offset: z.number().nullable().optional(),
  writable: z.boolean().default(false),
  isEnabled: z.boolean().default(true),
  // G1.4 (doc 44 W2-A3, mig 0253) — report-by-exception per tag, OPTIONAL (client
  // cũ không gửi → NULL, hành vi cũ). Chỉ có tác dụng khi OT_TAG_DEADBAND_ENABLED.
  deadband: z.number().positive().nullable().optional(),
  samplingMs: z.number().int().min(1).max(86_400_000).nullable().optional(),
});

const DEFAULT_TEST_TIMEOUT_MS = 8000;

/** Reject the promise after `ms` to avoid hanging on an unreachable endpoint. */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    if (typeof (t as NodeJS.Timeout).unref === "function") (t as NodeJS.Timeout).unref();
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

/** Friendly message for a unique-constraint violation. */
function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string }; message?: string };
  return e?.code === "23505" || e?.cause?.code === "23505" || /duplicate key|unique constraint/i.test(e?.message ?? "");
}

export const deviceAdapterRouter = router({
  // ─── Adapters ──────────────────────────────────────────────────────────────
  list: protectedProcedure
    .use(requirePermission("machine_control", "canView"))
    .input(z.object({
      machineId: z.number().int().positive().optional(),
      protocol: protocolEnum.optional(),
      isEnabled: z.boolean().optional(),
    }).optional())
    .query(async ({ input }) => {
      const db = await getDb();
      const conds = [];
      if (input?.machineId != null) conds.push(eq(deviceAdapters.machineId, input.machineId));
      if (input?.protocol != null) conds.push(eq(deviceAdapters.protocol, input.protocol));
      if (input?.isEnabled != null) conds.push(eq(deviceAdapters.isEnabled, input.isEnabled));
      return db
        .select()
        .from(deviceAdapters)
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(deviceAdapters.createdAt));
    }),

  get: protectedProcedure
    .use(requirePermission("machine_control", "canView"))
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input }) => {
      const db = await getDb();
      const [adapter] = await db.select().from(deviceAdapters).where(eq(deviceAdapters.id, input.id)).limit(1);
      if (!adapter) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "adapter" }, "Adapter không tồn tại.");
      const tags = await db
        .select()
        .from(deviceTags)
        .where(eq(deviceTags.adapterId, input.id))
        .orderBy(deviceTags.tagKey);
      return { ...adapter, tags };
    }),

  create: protectedProcedure
    .use(requirePermission("machine_control", "canCreate"))
    .input(adapterCreateInput)
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      try {
        const [row] = await db
          .insert(deviceAdapters)
          .values({
            code: input.code,
            name: input.name,
            protocol: input.protocol,
            endpoint: input.endpoint,
            connectionOptions: input.connectionOptions ?? null,
            pollIntervalMs: input.pollIntervalMs,
            machineId: input.machineId ?? null,
            isEnabled: input.isEnabled,
            createdBy: ctx.user.id,
          })
          .returning();
        return row;
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw appError("CONFLICT", "ENTITY_DUPLICATE", { entity: "adapter" }, `Mã adapter "${input.code}" đã tồn tại.`);
        }
        throw err;
      }
    }),

  update: protectedProcedure
    .use(requirePermission("machine_control", "canEdit"))
    .input(adapterCreateInput.partial().extend({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      const { id, ...rest } = input;
      const patch: Record<string, unknown> = { ...rest, updatedAt: new Date() };
      try {
        const [row] = await db.update(deviceAdapters).set(patch).where(eq(deviceAdapters.id, id)).returning();
        if (!row) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "adapter" }, "Adapter không tồn tại.");
        return row;
      } catch (err) {
        if (err instanceof TRPCError) throw err;
        if (isUniqueViolation(err)) {
          throw appError("CONFLICT", "ENTITY_DUPLICATE", { entity: "adapter" }, `Mã adapter đã tồn tại.`);
        }
        throw err;
      }
    }),

  delete: protectedProcedure
    .use(requirePermission("machine_control", "canDelete"))
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      const [existing] = await db.select().from(deviceAdapters).where(eq(deviceAdapters.id, input.id)).limit(1);
      if (!existing) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "adapter" }, "Adapter không tồn tại.");
      // SAFETY: refuse to delete an adapter that is still enabled (it may be polling).
      if (existing.isEnabled) {
        // Task 5 (doc 71) — reason khôi phục chỉ dẫn "tắt trước khi xoá" đã mất khi câu
        // chuẩn OPERATION_FAILED chỉ nội suy {{operation}} ("deleteAdapter", không nói
        // vì sao bị chặn).
        throw appError(
          "PRECONDITION_FAILED",
          "OPERATION_FAILED",
          { operation: "deleteAdapter", reason: "adapterStillEnabled" },
          "Adapter đang bật — hãy tắt (isEnabled=false) trước khi xoá.",
        );
      }
      // Cascade delete tags + adapter atomically.
      await db.transaction(async (tx) => {
        await tx.delete(deviceTags).where(eq(deviceTags.adapterId, input.id));
        await tx.delete(deviceAdapters).where(eq(deviceAdapters.id, input.id));
      });
      return { success: true };
    }),

  /**
   * READ-ONLY connectivity probe: connect → disconnect under a timeout. NEVER reads
   * or writes a tag. Accepts an existing adapter id OR an ad-hoc {protocol,endpoint}.
   */
  testConnection: protectedProcedure
    .use(requirePermission("machine_control", "canView"))
    .input(z.union([
      z.object({ id: z.number().int().positive() }),
      z.object({
        protocol: protocolEnum,
        endpoint: z.string().min(1).max(500),
        connectionOptions: z.record(z.string(), z.unknown()).nullable().optional(),
      }),
    ]))
    .mutation(async ({ input }) => {
      let protocol: OtProtocol;
      let endpoint: string;
      let options: Record<string, unknown> | undefined;

      if ("id" in input) {
        const db = await getDb();
        const [adapter] = await db.select().from(deviceAdapters).where(eq(deviceAdapters.id, input.id)).limit(1);
        if (!adapter) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "adapter" }, "Adapter không tồn tại.");
        protocol = adapter.protocol as OtProtocol;
        endpoint = adapter.endpoint;
        options = (adapter.connectionOptions as Record<string, unknown> | null) ?? undefined;
      } else {
        protocol = input.protocol;
        endpoint = input.endpoint;
        options = input.connectionOptions ?? undefined;
      }

      const startedAt = Date.now();
      let driver;
      try {
        driver = createDriver(protocol);
      } catch (err) {
        return { ok: false, latencyMs: 0, error: err instanceof Error ? err.message : String(err) };
      }

      try {
        await withTimeout(
          driver.connect({ endpoint, options, timeoutMs: DEFAULT_TEST_TIMEOUT_MS }),
          DEFAULT_TEST_TIMEOUT_MS,
          `${protocol} connect`,
        );
        return { ok: true, latencyMs: Date.now() - startedAt };
      } catch (err) {
        return { ok: false, latencyMs: Date.now() - startedAt, error: err instanceof Error ? err.message : String(err) };
      } finally {
        try {
          await withTimeout(driver.disconnect(), DEFAULT_TEST_TIMEOUT_MS, `${protocol} disconnect`);
        } catch {
          // best-effort cleanup; ignore disconnect errors
        }
      }
    }),

  // ─── Tags ────────────────────────────────────────────────────────────────────
  tags: router({
    listByAdapter: protectedProcedure
      .use(requirePermission("machine_control", "canView"))
      .input(z.object({ adapterId: z.number().int().positive() }))
      .query(async ({ input }) => {
        const db = await getDb();
        return db
          .select()
          .from(deviceTags)
          .where(eq(deviceTags.adapterId, input.adapterId))
          .orderBy(deviceTags.tagKey);
      }),

    create: protectedProcedure
      .use(requirePermission("machine_control", "canCreate"))
      .input(tagCreateInput)
      .mutation(async ({ input }) => {
        const db = await getDb();
        try {
          const [row] = await db
            .insert(deviceTags)
            .values({
              adapterId: input.adapterId,
              tagKey: input.tagKey,
              address: input.address,
              dataType: input.dataType,
              unit: input.unit ?? null,
              scale: input.scale != null ? String(input.scale) : undefined,
              offset: input.offset != null ? String(input.offset) : undefined,
              writable: input.writable,
              isEnabled: input.isEnabled,
              // G1.4 — deadband/samplingMs (double precision / integer, nullable)
              deadband: input.deadband ?? null,
              samplingMs: input.samplingMs ?? null,
            })
            .returning();
          return row;
        } catch (err) {
          if (isUniqueViolation(err)) {
            throw appError("CONFLICT", "ENTITY_DUPLICATE", { entity: "deviceTag" }, `Tag "${input.tagKey}" đã tồn tại trong adapter này.`);
          }
          throw err;
        }
      }),

    update: protectedProcedure
      .use(requirePermission("machine_control", "canEdit"))
      .input(tagCreateInput.partial().extend({ id: z.number().int().positive() }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        const { id, scale, offset, ...rest } = input;
        const patch: Record<string, unknown> = { ...rest, updatedAt: new Date() };
        if (scale !== undefined) patch.scale = scale != null ? String(scale) : null;
        if (offset !== undefined) patch.offset = offset != null ? String(offset) : null;
        try {
          const [row] = await db.update(deviceTags).set(patch).where(eq(deviceTags.id, id)).returning();
          if (!row) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "deviceTag" }, "Tag không tồn tại.");
          return row;
        } catch (err) {
          if (err instanceof TRPCError) throw err;
          if (isUniqueViolation(err)) {
            throw appError("CONFLICT", "ENTITY_DUPLICATE", { entity: "deviceTag" }, `Tag key đã tồn tại trong adapter này.`);
          }
          throw err;
        }
      }),

    delete: protectedProcedure
      .use(requirePermission("machine_control", "canDelete"))
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        const [row] = await db.delete(deviceTags).where(eq(deviceTags.id, input.id)).returning();
        if (!row) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "deviceTag" }, "Tag không tồn tại.");
        return { success: true };
      }),
  }),
});
