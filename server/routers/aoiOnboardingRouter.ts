/**
 * AOI/AVI Onboarding Wizard router (key "aoiOnboarding") — doc 27 §3 gap C4
 * (P1) + §2 gap M8 · Wave-2 W2-D.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Backend for the guided "Kết nối máy AOI/AVI" wizard (/aoi-onboarding):
 *
 *   1. listAoiMachines  — inspection-type machines + commissioning status badge
 *   2. draft CRUD       — resumable wizard state (aoi_commissioning_records @ 'draft')
 *   3. dryRun           — validate a sample vendor export via the vision-adapter
 *                         registry normalize() (NEVER persists an inspection)
 *   4. signOff          — promote draft → 'commissioned' + immutable audit row
 *                         (+ best-effort hot-folder config provisioning)
 *   5. status / records — per-machine gate status + ledger
 *
 * GATE SEMANTICS — SOFT (tag, don't reject): signing off flips the machine's
 * ingest mode to "production" via server/services/aoiCommissioningService.ts.
 * Un-commissioned machines still submit inspections normally; the ingest path
 * (W2-C) only consults getAoiIngestMode() to TAG those rows as
 * commissioning-mode. Nothing in this router can block or drop an inspection.
 *
 * INTEGRATION CONTRACTS (Wave-2 parallel agents — tolerate absence):
 *   • W2-B adapters: discovered DYNAMICALLY via the vision registry
 *     (listVisionAdapters) — no vendor list is hardcoded here. Optional
 *     description/confidence fields are passed through when present.
 *   • W2-A hot-folder: at sign-off we first try hotFolderRouter (owns watcher
 *     reload semantics) via a runtime bridge; when absent we fall back to a
 *     direct upsert into hot_folder_configs (schema already in the barrel) —
 *     the watcher then picks the config up on its next reload/restart.
 *   • W2-C credentials: the wizard client issues per-machine keys through the
 *     EXISTING machine.regenerateApiKey (admin) endpoint; swap to W2-C's scoped
 *     issuance endpoint in Step4Credential.tsx when it lands (one line).
 *
 * RBAC ("admin/engineer" via the repo's module-permission model — admin always
 * passes checkPermission): reads → machine_monitoring canView; draft writes →
 * canCreate; signOff/decommission → canEdit. The dry-run OVERRIDE path (sign
 * off without a passing dry-run) additionally requires role === 'admin' + reason.
 *
 * SECURITY: configSnapshot is deep-sanitized before persisting — any key that
 * looks like a secret (apiKey / plaintext* / secret / password / token) is
 * stripped. Only a short keyPrefix may be stored for display.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { router, protectedProcedure } from "../_core/trpc";
import { requirePermission } from "../_core/accessControl";
import { getDb } from "../db";
import { machines, hotFolderConfigs } from "../../drizzle/schema";
import { getVisionAdapter, listVisionAdapters } from "../services/vision";
import "../services/vision"; // side-effect: register built-in vendor adapters
import type { CanonicalInspection } from "../services/vision";
import { recordAuditEvent } from "../services/audit/controlAuditService";
import {
  getAoiIngestMode,
  getDraftRecord,
  saveDraftRecord,
  deleteDraftRecord,
  commissionFromDraft,
  decommissionMachine,
  getLatestSignedRecord,
  listRecordsForMachine,
  listAllRecords,
  invalidateAoiCommissioningCache,
} from "../services/aoiCommissioningService";

/** Inspection-machine family shown in the wizard's machine picker. */
const INSPECTION_MACHINE_TYPES = new Set(["AOI", "AVI", "SPI", "AXI"]);

async function db() {
  const d = await getDb();
  if (!d) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not connected" });
  return d;
}

/** Assert the machine exists (drizzle-direct so tests can use the FakeDb). */
async function requireMachine(machineId: number) {
  const d = await db();
  const [m] = await d.select().from(machines).where(eq(machines.id, machineId)).limit(1);
  if (!m) throw new TRPCError({ code: "NOT_FOUND", message: `Machine #${machineId} không tồn tại.` });
  return m;
}

// ─── configSnapshot shape (wizard state) ─────────────────────────────────────

const hotFolderSchema = z.object({
  watchPath: z.string().min(1).max(1024),
  filePattern: z.string().max(255).optional(),
  archivePath: z.string().max(1024).optional(),
  errorPath: z.string().max(1024).optional(),
});

const snapshotSchema = z
  .object({
    step: z.number().int().min(0).max(4).optional(),
    vendor: z
      .object({
        adapterKey: z.string().min(1).max(64),
        label: z.string().max(255).optional(),
      })
      .optional(),
    ingestion: z
      .object({
        mode: z.enum(["hot-folder", "http-push"]),
        hotFolder: hotFolderSchema.optional(),
      })
      .optional(),
    dryRun: z
      .object({
        passed: z.boolean(),
        at: z.string().optional(),
        adapterKey: z.string().max(64).optional(),
        summary: z.record(z.string(), z.unknown()).optional(),
      })
      .optional(),
    // NOTE: only the non-secret display prefix is allowed here (see sanitize).
    credential: z
      .object({
        issued: z.boolean().optional(),
        keyPrefix: z.string().max(16).optional(),
        issuedAt: z.string().optional(),
      })
      .optional(),
    notes: z.string().max(4000).optional(),
  })
  .passthrough();

/** Keys that must NEVER be persisted into a jsonb snapshot. */
const SECRET_KEY_RE = /(apikey|plaintext|secret|password|token)/i;

/** Deep-strip anything secret-shaped from the snapshot (defence in depth). */
function sanitizeSnapshot(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeSnapshot);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEY_RE.test(k) && k.toLowerCase() !== "keyprefix") continue;
      out[k] = sanitizeSnapshot(v);
    }
    return out;
  }
  return value;
}

// ─── Dry-run helpers ─────────────────────────────────────────────────────────

/** Try JSON first; non-JSON text (CSV/XML) is handed to the adapter verbatim. */
function parseRawPayload(raw: string): { payload: unknown; wasJson: boolean } {
  const trimmed = raw.trim();
  try {
    return { payload: JSON.parse(trimmed), wasJson: true };
  } catch {
    return { payload: trimmed, wasJson: false };
  }
}

function summarizeCanonical(c: CanonicalInspection) {
  const results = { OK: 0, NG: 0, NTF: 0 };
  for (const m of c.measurements) results[m.result] += 1;
  const warnings: string[] = [];
  if (c.measurements.length === 0) warnings.push("NO_MEASUREMENTS");
  if (!c.productModel) warnings.push("NO_PRODUCT_MODEL");
  if (!c.machineCode && !c.apiKey) warnings.push("NO_MACHINE_IDENTITY");
  const missingPointCodes = c.measurements.filter((m) => !m.pointCode && !m.pointId).length;
  if (missingPointCodes > 0) warnings.push(`MISSING_POINT_CODES:${missingPointCodes}`);
  return {
    serialNumber: c.serialNumber,
    productModel: c.productModel ?? null,
    batchNumber: c.batchNumber ?? null,
    overallResult: c.overallResult,
    inspectionTime: c.inspectionTime ?? null,
    machineCode: c.machineCode ?? null,
    measurementCount: c.measurements.length,
    results,
    warnings,
    sample: c.measurements.slice(0, 5).map((m) => ({
      pointCode: m.pointCode ?? m.pointId ?? null,
      measuredValue: m.measuredValue ?? null,
      result: m.result,
      defectCatalogCode: m.defectCatalogCode ?? null,
    })),
  };
}

/** Actionable hints for a failed dry-run (rendered as a checklist in the UI). */
function buildHints(err: string, adapterKey: string, wasJson: boolean): string[] {
  const hints: string[] = [];
  if (!wasJson) hints.push("PAYLOAD_NOT_JSON");
  if (/serial/i.test(err)) hints.push("MISSING_SERIAL");
  if (/results?.*array|array/i.test(err)) hints.push("RESULTS_MUST_BE_ARRAY");
  if (/object/i.test(err)) hints.push("PAYLOAD_MUST_BE_OBJECT");
  hints.push(`SEE_FEED_SPEC:docs/ECOSYSTEM/28_ST4I_STANDARD_INSPECTION_FEED_SPEC.md`);
  if (adapterKey !== "generic-json") hints.push("TRY_GENERIC_JSON");
  return hints;
}

// ─── Hot-folder provisioning (best-effort, contract-tolerant) ────────────────

interface ProvisionResult {
  attempted: boolean;
  ok: boolean;
  via: "hotFolderRouter" | "direct" | "none";
  message: string;
}

/**
 * Provision the watch config at sign-off — via W2-A's hotFolderRouter
 * (createConfig/updateConfig own the live watcher restart semantics; verified
 * contract in server/routers/hotFolderRouter.ts). Runs under the CALLER's ctx,
 * so hot-folder RBAC (machine_control canCreate/canEdit) still applies — a
 * FORBIDDEN there degrades to an explanatory message, never fails the sign-off.
 * Falls back to a direct upsert into hot_folder_configs when the router path
 * errors for non-RBAC reasons (watcher then picks it up on next reload).
 */
async function provisionHotFolder(
  ctx: unknown,
  cfg: { machineId: number; adapterKey: string } & z.infer<typeof hotFolderSchema>,
): Promise<ProvisionResult> {
  const values = {
    machineId: cfg.machineId,
    adapterKey: cfg.adapterKey,
    watchPath: cfg.watchPath,
    ...(cfg.filePattern ? { filePattern: cfg.filePattern } : {}),
    archivePath: cfg.archivePath ?? null,
    errorPath: cfg.errorPath ?? null,
    enabled: true,
  };

  // 1) Router path (live watcher restart) — verified W2-A contract.
  try {
    const { hotFolderRouter } = await import("./hotFolderRouter");
    const caller = hotFolderRouter.createCaller(ctx as never);
    const existing = (await caller.listConfigs()).find((c) => c.machineId === cfg.machineId);
    if (existing) {
      await caller.updateConfig({ id: existing.id, patch: values });
    } else {
      await caller.createConfig(values);
    }
    return {
      attempted: true,
      ok: true,
      via: "hotFolderRouter",
      message: "Hot-folder config provisioned (watcher restarted live).",
    };
  } catch (err) {
    // RBAC denial → honest message, no silent privilege bypass via the fallback.
    if (err instanceof TRPCError && err.code === "FORBIDDEN") {
      return {
        attempted: true,
        ok: false,
        via: "none",
        message: "Thiếu quyền machine_control để tạo hot-folder config — cấu hình trên trang Hot Folder hoặc nhờ người có quyền.",
      };
    }
    /* fall through to direct upsert */
  }

  // 2) Direct upsert into the config table (watcher reloads it on its own cycle).
  try {
    const d = await db();
    const [existing] = await d
      .select()
      .from(hotFolderConfigs)
      .where(eq(hotFolderConfigs.machineId, cfg.machineId))
      .limit(1);
    const { machineId: _mid, ...patch } = values;
    if (existing) {
      await d
        .update(hotFolderConfigs)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(hotFolderConfigs.id, existing.id));
    } else {
      await d.insert(hotFolderConfigs).values(values);
    }
    return {
      attempted: true,
      ok: true,
      via: "direct",
      message: "Hot-folder config saved; the watcher service picks it up on its next reload.",
    };
  } catch (err) {
    return {
      attempted: true,
      ok: false,
      via: "none",
      message: `Hot-folder config could not be provisioned automatically: ${err instanceof Error ? err.message : String(err)}. Configure it on the Hot Folder management page.`,
    };
  }
}

// ─── Router ──────────────────────────────────────────────────────────────────

export const aoiOnboardingRouter = router({
  /**
   * Inspection-type machines (AOI/AVI/SPI/AXI) with their commissioning badge.
   * SAFE projection — never returns the machine's apiKey.
   */
  listAoiMachines: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .query(async () => {
      const d = await db();
      const rows = await d.select().from(machines).where(eq(machines.isActive, true));
      const records = await listAllRecords().catch(() => []);
      const latestByMachine = new Map<number, { status: string }>();
      const draftByMachine = new Set<number>();
      for (const r of records) {
        if (r.status === "draft") {
          draftByMachine.add(r.machineId);
        } else if (!latestByMachine.has(r.machineId)) {
          latestByMachine.set(r.machineId, { status: r.status }); // records come newest-first
        }
      }
      return rows
        .filter((m) => INSPECTION_MACHINE_TYPES.has(String(m.machineType)))
        .map((m) => ({
          id: m.id,
          code: m.code,
          name: m.name,
          machineType: m.machineType,
          stationId: m.stationId,
          model: m.model,
          manufacturer: m.manufacturer,
          hasApiKey: Boolean(m.apiKey),
          lastHeartbeat: m.lastHeartbeat,
          commissioningStatus: latestByMachine.get(m.id)?.status ?? "uncommissioned",
          hasDraft: draftByMachine.has(m.id),
        }));
    }),

  /** Resumable wizard draft for a machine (null when none). */
  getDraft: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .input(z.object({ machineId: z.number().int().positive() }))
    .query(async ({ input }) => {
      return getDraftRecord(input.machineId);
    }),

  /** Create/update the machine's wizard draft (called on each step transition). */
  saveDraft: protectedProcedure
    .use(requirePermission("machine_monitoring", "canCreate"))
    .input(z.object({
      machineId: z.number().int().positive(),
      configSnapshot: snapshotSchema,
    }))
    .mutation(async ({ input, ctx }) => {
      await requireMachine(input.machineId);
      const snapshot = sanitizeSnapshot(input.configSnapshot) as Record<string, unknown>;
      return saveDraftRecord({
        machineId: input.machineId,
        configSnapshot: snapshot,
        userId: ctx.user.id,
      });
    }),

  /** Abandon the machine's wizard draft. */
  deleteDraft: protectedProcedure
    .use(requirePermission("machine_monitoring", "canCreate"))
    .input(z.object({ machineId: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const deleted = await deleteDraftRecord(input.machineId);
      return { deleted };
    }),

  /**
   * Dry-run: normalize a sample vendor export through the SAME adapter code the
   * real ingest uses (vision registry / hot-folder parser share normalize()).
   * PERSISTS NOTHING. A failed parse is a VALID outcome (ok:false + hints), not
   * an exception — the UI renders it as an actionable checklist.
   */
  dryRun: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .input(z.object({
      adapterKey: z.string().min(1).max(64),
      /** Raw sample file content — JSON, CSV or XML, exactly as the machine exports it. */
      payload: z.string().min(1).max(2_000_000),
      machineCode: z.string().trim().min(1).max(100).optional(),
    }))
    .mutation(async ({ input }) => {
      let adapter;
      try {
        adapter = getVisionAdapter(input.adapterKey);
      } catch {
        return {
          ok: false as const,
          adapterKey: input.adapterKey,
          error: `Unknown vendor adapter "${input.adapterKey}"`,
          hints: [
            `AVAILABLE_ADAPTERS:${listVisionAdapters().map((a) => a.vendorKey).join(",")}`,
          ],
        };
      }

      const { payload, wasJson } = parseRawPayload(input.payload);
      try {
        const canonical = adapter.normalize(payload, { machineCode: input.machineCode });
        return {
          ok: true as const,
          adapterKey: input.adapterKey,
          summary: summarizeCanonical(canonical),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          ok: false as const,
          adapterKey: input.adapterKey,
          error: message,
          hints: buildHints(message, input.adapterKey, wasJson),
        };
      }
    }),

  /**
   * Commissioning SIGN-OFF: promote the machine's draft → 'commissioned'
   * (who/when/what recorded) + immutable audit row. Requires a passing dry-run
   * in the draft snapshot; an ADMIN may override with an explicit reason.
   * Side effect (best-effort): provisions the hot-folder config when the draft
   * chose hot-folder ingestion.
   */
  signOff: protectedProcedure
    .use(requirePermission("machine_monitoring", "canEdit"))
    .input(z.object({
      machineId: z.number().int().positive(),
      note: z.string().max(2000).optional(),
      /** Required (admin-only) when the draft has no passing dry-run. */
      overrideReason: z.string().max(2000).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const machine = await requireMachine(input.machineId);
      const draft = await getDraftRecord(input.machineId);
      if (!draft) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Chưa có bản nháp onboarding cho máy này — hoàn thành các bước wizard trước khi ký.",
        });
      }

      const snapshot = (draft.configSnapshot ?? {}) as {
        dryRun?: { passed?: boolean };
        ingestion?: { mode?: string; hotFolder?: z.infer<typeof hotFolderSchema> };
        vendor?: { adapterKey?: string };
      };

      // Dry-run gate (admin override with reason allowed — audited below).
      const dryRunPassed = snapshot.dryRun?.passed === true;
      let overridden = false;
      if (!dryRunPassed) {
        const reason = input.overrideReason?.trim() ?? "";
        if (ctx.user.role !== "admin") {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Máy chưa có dry-run đạt — chạy bước 3 (Dry-run) trước, hoặc nhờ admin ký với lý do override.",
          });
        }
        if (reason.length < 5) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Override cần lý do (≥ 5 ký tự) — sẽ được ghi vào audit log.",
          });
        }
        overridden = true;
      }

      const record = await commissionFromDraft({
        machineId: input.machineId,
        signedBy: ctx.user.id,
        note: input.note?.trim() || null,
      });
      if (!record) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Không promote được bản nháp." });
      }

      // Immutable audit row (repo pattern: recordAuditEvent, append-only).
      try {
        const d = await db();
        await recordAuditEvent(d, {
          entityType: "aoi_commissioning",
          entityId: input.machineId,
          action: overridden ? "sign_off_override" : "sign_off",
          actorId: ctx.user.id,
          before: { status: "draft", recordId: draft.id, machineCode: machine.code },
          after: {
            status: "commissioned",
            recordId: record.id,
            machineCode: machine.code,
            adapterKey: snapshot.vendor?.adapterKey ?? null,
            ingestionMode: snapshot.ingestion?.mode ?? null,
            dryRunPassed,
          },
          reason: overridden ? input.overrideReason!.trim() : (input.note?.trim() || null),
        });
      } catch {
        /* auditing must never fail the sign-off itself (mirrors global middleware) */
      }

      // Best-effort hot-folder provisioning (never fails the sign-off).
      let provisioning: ProvisionResult = { attempted: false, ok: false, via: "none", message: "" };
      const hf = snapshot.ingestion?.hotFolder;
      const adapterKey = snapshot.vendor?.adapterKey;
      if (snapshot.ingestion?.mode === "hot-folder" && hf?.watchPath && adapterKey) {
        provisioning = await provisionHotFolder(ctx, { machineId: input.machineId, adapterKey, ...hf });
      }

      invalidateAoiCommissioningCache(input.machineId);
      return {
        record,
        overridden,
        ingestMode: "production" as const,
        provisioning,
      };
    }),

  /** Revoke a machine's commissioning (ingest returns to commissioning-mode tag). */
  decommission: protectedProcedure
    .use(requirePermission("machine_monitoring", "canEdit"))
    .input(z.object({
      machineId: z.number().int().positive(),
      reason: z.string().min(5).max(2000),
    }))
    .mutation(async ({ input, ctx }) => {
      const machine = await requireMachine(input.machineId);
      const row = await decommissionMachine({
        machineId: input.machineId,
        actorId: ctx.user.id,
        reason: input.reason.trim(),
      });
      if (!row) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Máy này không có bản ghi commissioning đang hiệu lực.",
        });
      }
      try {
        const d = await db();
        await recordAuditEvent(d, {
          entityType: "aoi_commissioning",
          entityId: input.machineId,
          action: "decommission",
          actorId: ctx.user.id,
          before: { status: "commissioned", recordId: row.id, machineCode: machine.code },
          after: { status: "decommissioned", recordId: row.id, machineCode: machine.code },
          reason: input.reason.trim(),
        });
      } catch {
        /* never fail the mutation on audit */
      }
      return { record: row, ingestMode: "commissioning" as const };
    }),

  /** Gate status for one machine (used by the wizard + optional status card). */
  status: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .input(z.object({ machineId: z.number().int().positive() }))
    .query(async ({ input }) => {
      const [latest, draft, mode] = await Promise.all([
        getLatestSignedRecord(input.machineId).catch(() => null),
        getDraftRecord(input.machineId).catch(() => null),
        getAoiIngestMode(input.machineId),
      ]);
      return {
        machineId: input.machineId,
        commissioned: latest?.status === "commissioned",
        ingestMode: mode, // "production" | "commissioning" — SOFT tag, never blocks
        hasDraft: Boolean(draft),
        latestRecord: latest
          ? {
              id: latest.id,
              status: latest.status,
              signedBy: latest.signedBy,
              signedAt: latest.signedAt,
              note: latest.note,
            }
          : null,
      };
    }),

  /** Full commissioning ledger for a machine (newest first, drafts included). */
  listRecords: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .input(z.object({ machineId: z.number().int().positive() }))
    .query(async ({ input }) => {
      return listRecordsForMachine(input.machineId);
    }),
});
