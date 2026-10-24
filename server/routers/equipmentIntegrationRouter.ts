/**
 * I1 (doc 16 §6 / §15) — EQUIPMENT INTEGRATION router.  Flag: EQ_INTEG_ENABLED (default OFF).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * tRPC surface over the Khối 1B multi-vendor integration extensions:
 *   • I1-a FOCAS / Euromap adapter FRAMEWORKS — integration status (which protocols
 *     are configured) + an honest read-only snapshot (cached / none; no fabricated data).
 *   • I1-b Recipe versioning genealogy — list versions, recipe load history, and the
 *     mutations create | release | archive | rollback version + record-load.
 *
 * RBAC (mirrors equipmentStandardsRouter / fleetRouter):
 *   • reads                           → machine_monitoring / canView
 *   • createRecipeVersion/archive/load → machine_control   / canCreate (+ requireFlag);
 *     load with deploy=true ALSO → actuation role floor + 2FA + canEdit (doc 81 Đợt 1C Task 2)
 *   • release/rollback                → doc 80 Task 3 (FLOW-01/INT-02): SAME guarantee as
 *     /recipes — `actuationProcedure` (role-floor admin/supervisor/engineer + 2FA) +
 *     machine_control/canEdit (was a bare canCreate with no role floor). The service layer
 *     (recipeVersioningService.releaseVersion/rollbackToVersion) additionally refuses a
 *     version whose `approvedBy` is null (PRECONDITION_FAILED) — a second-approver gate
 *     equivalent to /recipes' deployRecipe (server/db/machineRecipe.ts).
 *   • testEuromapOpcuaConnection       → doc 80 Task 3 (INT-01): `adminProcedure` only.
 * ctx.user is the source of truth — never the request body.
 *
 * SAFETY / NO-OP: FOCAS/Euromap are READ-ONLY frameworks (no real device attached, no
 *   fabricated telemetry). Recipe mutations are METADATA only — releasing/loading a recipe
 *   opens NO device-control path; a select_recipe command still routes through the EXISTING
 *   gated dispatcher. When the flag is OFF every mutation CONFLICTs; reads still work.
 *
 * INT-01 SSRF (doc 80 Task 3): `euromapOpcuaSnapshot` no longer accepts an `endpoint` /
 *   `nodeMapJson` / `vendor` from the client — it ALWAYS reads the server-saved connector
 *   config (EUROMAP_OPCUA_ENDPOINT/_NODEMAP/_VENDOR). Trying a NEW endpoint is now a
 *   SEPARATE `adminProcedure` mutation (`testEuromapOpcuaConnection`) gated by an allowlist
 *   (registered `device_adapters` OPC-UA hosts ∪ EUROMAP_OPCUA_ALLOWLIST) and never raises
 *   Andon (it calls `readEuromapOverOpcua` directly, never `EuromapAdapter.pollOverOpcua`).
 * ════════════════════════════════════════════════════════════════════════════
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, sql } from "drizzle-orm";
import { router, protectedProcedure, actuationProcedure, adminProcedure, ACTUATION_ROLES, PRIVILEGED_ROLES, batBuoc2FA } from "../_core/trpc";
import { requirePermission } from "../_core/accessControl";
import { appError } from "../_core/appError";
import { getDb } from "../db";
import { deviceAdapters, machineRecipes, machines } from "../../drizzle/schema";
import { idsMayTrongPhamVi, mayTrongPhamVi } from "./_adapterPhamVi";
import { phamViCua } from "./_phamViNguoiXem";
import { resolveTenantFactoryScope } from "../db/reportAggregators";
import { equipmentRegistry } from "../services/equipment/equipmentAdapter";
import {
  isEqIntegEnabled,
  createVersion,
  releaseVersion,
  archiveVersion,
  rollbackToVersion,
  recordLoad,
  listVersions,
  listLoadHistory,
  listCodeHistory,
} from "../services/equipment/recipeVersioningService";
import { FocasAdapter, FOCAS_CAVEAT, FOCAS_READ_FUNCTIONS, FOCAS_VENDOR } from "../services/focas/focasAdapter";
import { EuromapAdapter, mapEuromapToUem, EUROMAP_CAVEAT, EUROMAP_TRANSPORTS, EUROMAP_VENDOR_DEFAULT } from "../services/euromap/euromapAdapter";

/**
 * Phạm vi nhà máy cho GHI công thức theo id client gửi (rà bảo mật 2026-10-24, kiểm định phamViGhi): công thức gắn máy ngoài
 * phạm vi ≡ "Recipe không tồn tại" (cùng NOT_FOUND với id không có thật); công thức không gắn máy giữ hành vi cũ. Kiểm TRƯỚC khi ghi.
 */
async function congThucTrongPhamVi(ctx: Parameters<typeof mayTrongPhamVi>[0], recipeId: number): Promise<number | null> {
  const khongThay = () => appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "recipe" }, "Recipe không tồn tại.");
  const db = await getDb();
  if (!db) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not connected");
  const [r] = await db.select({ machineId: machineRecipes.machineId }).from(machineRecipes).where(eq(machineRecipes.id, recipeId)).limit(1);
  if (!r) throw khongThay();
  if (r.machineId == null) return null;
  try {
    await mayTrongPhamVi(ctx, r.machineId);
  } catch {
    throw khongThay();
  }
  return r.machineId;
}

/** phạm vi người dùng (L4 2026-10-25): mã máy (machines.code) thuộc phạm vi người gọi? Toàn quyền ⇒ true (kể cả mã chưa khai báo); phạm vi hẹp ⇒ chỉ khi mã khớp một máy TRONG phạm vi (fail-closed). */
async function maMayTrongPhamVi(ctx: Parameters<typeof mayTrongPhamVi>[0], machineCode: string): Promise<boolean> {
  const idsMay = await idsMayTrongPhamVi(ctx);
  if (idsMay === null) return true;
  const db = await getDb();
  if (!db) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not connected");
  const [m] = await db.select({ id: machines.id }).from(machines).where(eq(machines.code, machineCode)).limit(1);
  return !!m && idsMay.includes(m.id);
}

/**
 * Dấu tenant (scope · corporateCode · factoryId) của hàng genealogy sắp ghi (rà bảo mật 2026-10-24, lô W3): các trường này TỪ TRƯỚC do
 * CLIENT khai trong input ⇒ người nhà máy A gắn nhãn hàng của mình là nhà máy B (hoặc bỏ trống để lẩn). Nay, với người gọi PHẠM VI HẸP,
 * giá trị client khai bị BỎ và suy từ MÁY (máy → trạm → chuyền → xưởng → nhà máy); công thức không gắn máy ⇒ từ phạm vi của chính người gọi
 * khi đúng MỘT nhà máy; không suy được ⇒ để trống (không tin client). Người gọi toàn quyền (admin) giữ nguyên giá trị khai (tin cậy).
 */
async function dauNhaMay(
  ctx: Parameters<typeof mayTrongPhamVi>[0],
  khai: { scope?: string; corporateCode?: string; factoryId?: number },
  machineId: number | null,
): Promise<{ scope?: string; corporateCode?: string; factoryId?: number }> {
  const idsMay = await idsMayTrongPhamVi(ctx);
  if (idsMay === null) return { scope: khai.scope, corporateCode: khai.corporateCode, factoryId: khai.factoryId };
  const db = await getDb();
  if (!db) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not connected");
  let fid: number | null = null;
  if (machineId != null) {
    const rows = (await db.execute(sql`SELECT w."factoryId" AS f FROM machines m JOIN stations s ON s."id" = m."stationId"
      JOIN production_lines l ON l."id" = s."lineId" JOIN workshops w ON w."id" = l."workshopId" WHERE m."id" = ${machineId}`)) as unknown as Array<{ f: number | null }>;
    fid = rows[0]?.f ?? null;
  } else {
    const sc = (await resolveTenantFactoryScope(phamViCua(ctx))).factoryIds;
    if (sc !== null && sc.length === 1) fid = sc[0] ?? null;
  }
  if (fid == null) return {};
  const fr = (await db.execute(sql`SELECT "corporateCode" AS c FROM factories WHERE "id" = ${fid}`)) as unknown as Array<{ c: string | null }>;
  return { corporateCode: fr[0]?.c ?? undefined, factoryId: fid };
}

/** Guard mutations behind the flag (matches equipmentStandardsRouter discipline). */
function requireFlag(): void {
  if (!isEqIntegEnabled()) {
    throw appError("CONFLICT", "FEATURE_DISABLED", { feature: "equipmentIntegration" }, "Equipment integration disabled (set EQ_INTEG_ENABLED=true)");
  }
}

/** Translate a service Error into a tRPC error (NOT_FOUND for missing recipes, else BAD_REQUEST). */
function toTrpc(err: unknown): TRPCError {
  // doc 80 Task 3 — the service layer now throws pre-classified appError()s directly (e.g.
  // PRECONDITION_FAILED for an unapproved release/rollback). Pass those through UNCHANGED
  // instead of re-classifying by message text below (which only recognizes "not found" /
  // "disabled" and would otherwise downgrade a PRECONDITION_FAILED to a generic BAD_REQUEST).
  if (err instanceof TRPCError) return err;
  const msg = err instanceof Error ? err.message : String(err);
  if (/not found/i.test(msg)) return appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "recipe" }, msg);
  if (/disabled/i.test(msg)) return appError("CONFLICT", "FEATURE_DISABLED", { feature: "equipmentIntegration" }, msg);
  // Review cuối, ca I-A #13: `toTrpc` chỉ được gọi bởi 5 thủ tục recipe-versioning
  // (createRecipeVersion/releaseRecipeVersion/archiveRecipeVersion/rollbackRecipeVersion/
  // recordRecipeLoad) — KHÔNG thủ tục Euromap/FOCAS nào dùng mapper này (các adapter đó
  // chỉ đọc, không throw qua đây). operation:"euromapIntegration" nói sai hẳn thao tác.
  return appError("BAD_REQUEST", "OPERATION_FAILED", { operation: "manageRecipeVersion" }, msg);
}

/**
 * doc 81 Đợt 1C Task 2 — `recordRecipeLoad` with `deploy:true` writes a recipe_deployments row and
 * flips the active version, i.e. it IS a deploy. It must clear the same floor as the strict deploy
 * paths (releaseRecipeVersion/rollbackRecipeVersion here, /recipes recipes.deploy):
 * `actuationProcedure` (role floor ACTUATION_ROLES, then 2FA for privileged roles) +
 * machine_control/canEdit — checked in that order, with the same error shapes as `roleProcedure`,
 * `require2FA` and `requirePermission`. The role list / 2FA predicate are the ones exported by
 * `_core/trpc` (no second copy of the rule). `deploy:false` (genealogy only) is untouched.
 */
async function assertStrictDeployFloor(ctx: { user: { id: number; role: string; twoFactorEnabled?: boolean | null } }): Promise<void> {
  if (!(ACTUATION_ROLES as readonly string[]).includes(ctx.user.role)) {
    throw appError("FORBIDDEN", "PERMISSION_DENIED", { action: "insufficientRole" }, `Required role: ${ACTUATION_ROLES.join(" or ")}`);
  }
  if (batBuoc2FA() && (PRIVILEGED_ROLES as readonly string[]).includes(ctx.user.role) && !ctx.user.twoFactorEnabled) {
    throw appError(
      "FORBIDDEN",
      "TWO_FACTOR_NOT_SET_UP",
      { reason: "setUpInSecuritySettings" },
      "Tài khoản đặc quyền phải bật xác thực 2 bước (2FA). Vào Cài đặt > Bảo mật để thiết lập.",
    );
  }
  await requirePermission("machine_control", "canEdit")({ ctx: ctx as never, next: async () => undefined });
}

/**
 * INT-01 (doc 80 Task 3) — allowlist of hosts a NEW Euromap OPC-UA endpoint may target,
 * for `testEuromapOpcuaConnection` (adminProcedure) only:
 *   • every REGISTERED `device_adapters` row with protocol='opcua' — an admin already
 *     typed that endpoint into the adapter registry (registered but currently DISABLED
 *     adapters still count: "registered" ≠ "polling"), UNIONED with
 *   • EUROMAP_OPCUA_ALLOWLIST (comma-separated hostnames), read fresh per call so ops can
 *     extend it without a restart.
 * DB unavailable → fails CLOSED to whatever the env allowlist already contributed (never
 * widen the allowlist because the registry lookup failed).
 */
async function euromapOpcuaAllowlistedHosts(): Promise<Set<string>> {
  const { extractEndpointHost } = await import("../services/euromap/euromapOpcuaReader");
  const hosts = new Set<string>();
  const envList = (process.env.EUROMAP_OPCUA_ALLOWLIST ?? "").trim();
  if (envList) {
    for (const raw of envList.split(",")) {
      const h = raw.trim().toLowerCase();
      if (h) hosts.add(h);
    }
  }
  try {
    const db = await getDb();
    if (db) {
      const rows = await db
        .select({ endpoint: deviceAdapters.endpoint })
        .from(deviceAdapters)
        .where(eq(deviceAdapters.protocol, "opcua"));
      for (const row of rows) {
        const h = extractEndpointHost(row.endpoint);
        if (h) hosts.add(h);
      }
    }
  } catch {
    // DB unavailable — fail CLOSED (env-only allowlist), never widen.
  }
  return hosts;
}

export const equipmentIntegrationRouter = router({
  /** UI gating hint — is the integration flag on? */
  status: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .query(() => ({ enabled: isEqIntegEnabled() })),

  // ── I1-a — adapter integration status ────────────────────────────────────────
  /**
   * Which adapter protocols are wired + an HONEST framework status for the new
   * FOCAS/Euromap frameworks (read-only, no real device, no fabricated telemetry).
   */
  integrationStatus: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .query(() => ({
      enabled: isEqIntegEnabled(),
      adapters: equipmentRegistry.listAdapters(),
      frameworks: [
        {
          kind: "focas",
          vendor: FOCAS_VENDOR,
          readOnly: true,
          configured: false, // no native FOCAS (Fwlib32) library linked
          readFunctions: [...FOCAS_READ_FUNCTIONS],
          caveat: FOCAS_CAVEAT,
        },
        {
          kind: "euromap",
          vendor: EUROMAP_VENDOR_DEFAULT,
          readOnly: true,
          configured: false, // no Euromap 63/77/83 transport connected
          transports: [...EUROMAP_TRANSPORTS],
          caveat: EUROMAP_CAVEAT,
        },
      ],
    })),

  /**
   * Honest read-only snapshot for a machine from a FOCAS or Euromap framework adapter.
   * With no connector linked this returns source:'none' and null UEM fields — it NEVER
   * fabricates telemetry. (A future connector feeds the adapter's local cache.)
   */
  frameworkSnapshot: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .input(z.object({ kind: z.enum(["focas", "euromap"]), machineCode: z.string().min(1).max(64) }))
    .query(({ input }) => {
      // phạm vi người dùng (L4 2026-10-25) — KHÔNG cần lọc: bộ nhớ đệm của FocasAdapter/EuromapAdapter nằm TRÊN THỂ HIỆN (`private last`), mỗi lượt gọi dựng thể hiện MỚI ⇒ ảnh chụp luôn rỗng, không chứa số đo của máy nào.
      const adapter =
        input.kind === "focas"
          ? new FocasAdapter(input.machineCode)
          : new EuromapAdapter(input.machineCode);
      return adapter.readSnapshot();
    }),

  /**
   * I3b-2 — LIVE Euromap 77 snapshot over OPC-UA (read-only). Reuses the platform's real
   * opcuaDriver via the SERVER-SAVED node-map config (EUROMAP_OPCUA_ENDPOINT / _NODEMAP /
   * _VENDOR). Honest: no endpoint/node-map → a BAD_REQUEST with a clear reason; an
   * unreachable server surfaces the driver error. NEVER fabricates telemetry; NEVER writes.
   * Alarm→Andon inside pollOverOpcua is self-gated by EQ_INTEG_ENABLED.
   *
   * INT-01 (doc 80 Task 3) — SSRF fix: this query NEVER accepts an `endpoint` /
   * `nodeMapJson` / `vendor` from the client any more (previously any authenticated VIEWER
   * could point it at an arbitrary endpoint, which then opened an OPC-UA connection and
   * could push an Andon alarm). Trying a NEW, not-yet-configured endpoint is now the
   * SEPARATE `testEuromapOpcuaConnection` mutation below (adminProcedure, allowlisted,
   * never raises Andon).
   */
  euromapOpcuaSnapshot: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .input(
      z.object({
        machineCode: z.string().min(1).max(64),
        machineId: z.number().int().positive().optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      // phạm vi người dùng (L4 2026-10-25): thăm dò OPC-UA TRỰC TIẾP gắn với một máy — máy / mã máy phải trong phạm vi (người hẹp: phải nêu máy của mình), TRƯỚC khi mở kết nối
      if (input.machineId != null) await mayTrongPhamVi(ctx, input.machineId);
      if (!(await maMayTrongPhamVi(ctx, input.machineCode))) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "machine" }, "Máy không tồn tại.");
      const { parseNodeMap, euromapOpcuaOptionsFromEnv } = await import("../services/euromap/euromapOpcuaReader");
      const endpoint = process.env.EUROMAP_OPCUA_ENDPOINT ?? "";
      const nodeMap = parseNodeMap(process.env.EUROMAP_OPCUA_NODEMAP);
      const vendor = process.env.EUROMAP_OPCUA_VENDOR;
      if (!endpoint.trim()) {
        throw appError("BAD_REQUEST", "FIELD_REQUIRED", { field: "euromapOpcuaEndpoint" }, "No Euromap OPC-UA endpoint (set EUROMAP_OPCUA_ENDPOINT)");
      }
      if (!nodeMap) {
        throw appError("BAD_REQUEST", "FIELD_REQUIRED", { field: "euromapOpcuaNodeMap" }, "No Euromap OPC-UA node-map (set EUROMAP_OPCUA_NODEMAP)");
      }
      const { createDriver } = await import("../services/ot/driverRegistry");
      const driver = createDriver("opcua");
      const adapter = new EuromapAdapter(input.machineCode, undefined, input.machineId ?? null);
      try {
        const uem = await adapter.pollOverOpcua(driver, {
          endpoint: endpoint.trim(),
          nodeMap,
          transport: "euromap77",
          vendor,
          // doc 81 Đợt 1B Task 12 — bảo mật OPC UA qua env (vắng ⇒ undefined, hành vi cũ).
          options: euromapOpcuaOptionsFromEnv(),
        });
        return { ...adapter.readSnapshot(), ...uem, connected: true, source: "live" as const };
      } catch (err) {
        // Honest: report the failure; serve the last cache (source:'cache'|'none'), no fabrication.
        const snap = adapter.readSnapshot();
        return {
          ...snap,
          // data-raw-ok: chi tiết KỸ THUẬT của phiên OPC UA, ĐI KÈM errorCode ngay dưới
          // để client dịch câu cho người vận hành.
          error: err instanceof Error ? err.message : String(err),
          errorCode: "DEVICE_UNREACHABLE" as const,
          errorParams: { entity: "opcua" },
        };
      }
    }),

  /**
   * INT-01 (doc 80 Task 3) — the ONLY way to probe a NOT-yet-configured Euromap OPC-UA
   * endpoint. `adminProcedure` (role floor "admin" + 2FA per deployment mode) + an
   * ALLOWLIST gate: the endpoint's host must match either a registered OPC-UA
   * `device_adapters` row or EUROMAP_OPCUA_ALLOWLIST (see euromapOpcuaAllowlistedHosts
   * above). A pure READ probe: calls `readEuromapOverOpcua` DIRECTLY (never
   * `EuromapAdapter.pollOverOpcua`), so a trial attempt NEVER raises an Andon alarm and
   * NEVER mutates any adapter's live last-value cache.
   */
  testEuromapOpcuaConnection: adminProcedure
    .input(
      z.object({
        machineCode: z.string().min(1).max(64),
        endpoint: z.string().min(1).max(500),
        nodeMapJson: z.string().min(1).optional(),
        vendor: z.string().min(1).max(64).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      const { parseNodeMap, readEuromapOverOpcua, isEndpointHostAllowlisted, euromapOpcuaOptionsFromEnv } = await import(
        "../services/euromap/euromapOpcuaReader"
      );
      const nodeMap = parseNodeMap(input.nodeMapJson ?? process.env.EUROMAP_OPCUA_NODEMAP);
      if (!nodeMap) {
        throw appError("BAD_REQUEST", "FIELD_REQUIRED", { field: "euromapOpcuaNodeMap" }, "No Euromap OPC-UA node-map (set EUROMAP_OPCUA_NODEMAP or send nodeMapJson)");
      }
      const allowedHosts = await euromapOpcuaAllowlistedHosts();
      if (!isEndpointHostAllowlisted(input.endpoint, allowedHosts)) {
        throw appError(
          "BAD_REQUEST",
          "INVALID_VALUE",
          { field: "endpoint" },
          `Endpoint host is not in the allowlist (a registered OPC-UA adapter, or EUROMAP_OPCUA_ALLOWLIST) — SSRF guard (INT-01).`,
        );
      }
      const { createDriver } = await import("../services/ot/driverRegistry");
      const driver = createDriver("opcua");
      try {
        const readout = await readEuromapOverOpcua(driver, {
          endpoint: input.endpoint.trim(),
          nodeMap,
          transport: "euromap77",
          vendor: input.vendor ?? process.env.EUROMAP_OPCUA_VENDOR,
          // doc 81 Đợt 1B Task 12 — cùng tuỳ chọn bảo mật như euromapOpcuaSnapshot.
          options: euromapOpcuaOptionsFromEnv(),
        });
        return { ok: true as const, uem: mapEuromapToUem(readout), transport: readout.transport ?? null, at: readout.at ?? new Date() };
      } catch (err) {
        return {
          ok: false as const,
          // data-raw-ok: chi tiết KỸ THUẬT cho kỹ sư (ECONNREFUSED host:port, BadSecurityChecksFailed…),
          // ĐI KÈM errorCode + errorParams ngay dưới để client dịch câu cho người vận hành
          // (translateAppError) — cùng khuôn F14 như deviceAdapterRouter.testConnection.
          error: err instanceof Error ? err.message : String(err),
          errorCode: "DEVICE_UNREACHABLE" as const,
          errorParams: { entity: "opcua" },
        };
      }
    }),

  // ── I1-b — recipe versioning genealogy (reads) ───────────────────────────────
  /** List recipe versions for a recipe code (newest first, projected to design status). */
  listRecipeVersions: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .input(z.object({ code: z.string().min(1).max(64) }))
    .query(async ({ input }) => ({ code: input.code, versions: await listVersions(input.code) })),

  /** Recipe LOAD history (genealogy) for a machine. */
  listLoadHistory: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .input(z.object({ machineId: z.number().int().positive(), limit: z.number().int().min(1).max(500).default(100) }))
    .query(async ({ input, ctx }) => {
      const idsMay = await idsMayTrongPhamVi(ctx); // phạm vi người dùng (L4 2026-10-25): máy ngoài phạm vi ⇒ như chưa có lịch sử nạp
      if (idsMay !== null && !idsMay.includes(input.machineId)) return [];
      return listLoadHistory(input.machineId, input.limit);
    }),

  /** Recipe genealogy for a code (across machines). */
  listCodeHistory: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .input(z.object({ code: z.string().min(1).max(64), limit: z.number().int().min(1).max(500).default(200) }))
    .query(async ({ input, ctx }) => listCodeHistory(input.code, input.limit, await idsMayTrongPhamVi(ctx))), // phạm vi người dùng (L4 2026-10-25): chỉ lượt nạp trên máy trong phạm vi

  // ── I1-b — recipe versioning genealogy (mutations, flag-gated) ───────────────
  /** Create a new IMMUTABLE recipe version (draft). */
  createRecipeVersion: protectedProcedure
    .use(requirePermission("machine_control", "canCreate"))
    .input(z.object({
      code: z.string().min(1).max(64),
      name: z.string().min(1).max(255),
      payload: z.record(z.string(), z.any()),
      machineId: z.number().int().positive().optional(),
      notes: z.string().optional(),
      scope: z.string().max(64).optional(),
      corporateCode: z.string().max(50).optional(),
      factoryId: z.number().int().positive().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      requireFlag();
      if (input.machineId != null) await mayTrongPhamVi(ctx, input.machineId); // phạm vi nhà máy: không gắn công thức vào máy nhà máy khác
      const dau = await dauNhaMay(ctx, input, input.machineId ?? null);
      try {
        return await createVersion({
          code: input.code,
          name: input.name,
          payload: input.payload as Record<string, unknown>,
          machineId: input.machineId ?? null,
          notes: input.notes ?? null,
          createdBy: ctx.user.id,
          scope: dau.scope,
          corporateCode: dau.corporateCode,
          factoryId: dau.factoryId,
        });
      } catch (err) {
        throw toTrpc(err);
      }
    }),

  /**
   * Release a version (draft → released). Archives the prior released version of the code.
   *
   * doc 80 Task 3 (FLOW-01/INT-02) — SAME guarantee as /recipes' deploy: `actuationProcedure`
   * (role-floor admin/supervisor/engineer + 2FA) + machine_control/canEdit (was a bare
   * canCreate with no role floor). `releaseVersion` additionally refuses an unapproved
   * version (approvedBy null → PRECONDITION_FAILED, surfaced unchanged via toTrpc above).
   */
  releaseRecipeVersion: actuationProcedure
    .use(requirePermission("machine_control", "canEdit"))
    .input(z.object({
      recipeId: z.number().int().positive(),
      scope: z.string().max(64).optional(),
      corporateCode: z.string().max(50).optional(),
      factoryId: z.number().int().positive().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      requireFlag();
      const dau = await dauNhaMay(ctx, input, await congThucTrongPhamVi(ctx, input.recipeId));
      try {
        return await releaseVersion(input.recipeId, ctx.user.id, dau);
      } catch (err) {
        throw toTrpc(err);
      }
    }),

  /** Archive a version (→ archived). */
  archiveRecipeVersion: protectedProcedure
    .use(requirePermission("machine_control", "canCreate"))
    .input(z.object({
      recipeId: z.number().int().positive(),
      scope: z.string().max(64).optional(),
      corporateCode: z.string().max(50).optional(),
      factoryId: z.number().int().positive().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      requireFlag();
      const dau = await dauNhaMay(ctx, input, await congThucTrongPhamVi(ctx, input.recipeId));
      try {
        return await archiveVersion(input.recipeId, ctx.user.id, dau);
      } catch (err) {
        throw toTrpc(err);
      }
    }),

  /**
   * Roll back the released contract for a code to a PRIOR version.
   *
   * doc 80 Task 3 (FLOW-01/INT-02) — same gate as releaseRecipeVersion above (rollback also
   * PROMOTES a version to active, so it needs the identical guarantee).
   */
  rollbackRecipeVersion: actuationProcedure
    .use(requirePermission("machine_control", "canEdit"))
    .input(z.object({
      toRecipeId: z.number().int().positive(),
      scope: z.string().max(64).optional(),
      corporateCode: z.string().max(50).optional(),
      factoryId: z.number().int().positive().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      requireFlag();
      const dau = await dauNhaMay(ctx, input, await congThucTrongPhamVi(ctx, input.toRecipeId));
      try {
        return await rollbackToVersion(input.toRecipeId, ctx.user.id, dau);
      } catch (err) {
        throw toTrpc(err);
      }
    }),

  /**
   * Record that a recipe version was LOADED onto a machine (genealogy). Optionally also
   * writes a recipe_deployments ledger row (deploy=true). Opens NO device path.
   * RBAC: machine_control/canCreate; deploy=true ALSO needs the strict deploy floor
   * (actuation role + 2FA + machine_control/canEdit — doc 81 Đợt 1C Task 2, assertStrictDeployFloor)
   * and the service runs the strict release gate (approved · not archived · machine type).
   */
  recordRecipeLoad: protectedProcedure
    .use(requirePermission("machine_control", "canCreate"))
    .input(z.object({
      recipeId: z.number().int().positive(),
      machineId: z.number().int().positive(),
      deploy: z.boolean().default(false),
      notes: z.string().optional(),
      scope: z.string().max(64).optional(),
      corporateCode: z.string().max(50).optional(),
      factoryId: z.number().int().positive().optional(),
    }))
    .use(async ({ ctx, input, next }) => {
      if (input.deploy) await assertStrictDeployFloor(ctx);
      return next();
    })
    .mutation(async ({ input, ctx }) => {
      requireFlag();
      await mayTrongPhamVi(ctx, input.machineId); // phạm vi nhà máy: máy đích
      await congThucTrongPhamVi(ctx, input.recipeId); // phạm vi nhà máy: công thức được nạp
      const dau = await dauNhaMay(ctx, input, input.machineId);
      try {
        return await recordLoad({
          recipeId: input.recipeId,
          machineId: input.machineId,
          performedBy: ctx.user.id,
          deploy: input.deploy,
          notes: input.notes ?? null,
          scope: dau.scope, corporateCode: dau.corporateCode, factoryId: dau.factoryId,
        });
      } catch (err) {
        throw toTrpc(err);
      }
    }),
});
