/**
 * Sprint G2.2a — Device Adapter + Tag CONFIG router (RBAC module 'machine_control').
 *
 * ════════════════════════════════════════════════════════════════════════════
 * SAFETY:
 *   - This router ONLY manages CONFIGURATION (adapter connection definition + tag
 *     definitions) and runs a READ-ONLY connectivity probe (testConnection). It
 *     does NOT import commandDispatcher and NEVER calls driver.writeTags — there is
 *     no code path from here that writes a value to a machine.
 *   - testConnection: createDriver(protocol).connect(cfg) → disconnect() via
 *     probeOtConnection under ONE overall deadline (timeoutMs + 2 s), always cleaning
 *     up the transport (doc 81 Đợt 1B Task 1). It reads NOTHING and writes NOTHING; it only
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
import { probeOtConnection } from "../services/ot/probeConnection";
import {
  sealConnectionOptionSecrets,
  redactAdapterRow,
  restoreRedactedSecrets,
  secretReentryRequired,
  REDACTED_SECRET,
} from "../services/ot/connectionSecrets";
import { parseOpcuaSecurityOptions } from "../services/ot/drivers/opcuaSecurity";
import { idsTrongPhamVi } from "../db/hierarchy";
import { phamViCua } from "./_phamViNguoiXem";
import { createAuditContext } from "../services/auditTrailService";
import {
  datStopPin,
  StopPinLoi,
  lyDoGoStopPinKhiSuaTag,
  ghiAuditGoStopPinTx,
  adapterDoiDich,
  goMoiStopPinCuaAdapterTx,
  GO_STOP_PIN_PATCH,
  type NguoiSuaStopPin,
} from "../services/ot/stopPin";

/** doc 81 Đợt 1D Task 1 — người sửa (id/tên/IP/UA) lấy từ ctx, KHÔNG từ input (khuôn mqttOeeRouters). */
function nguoiSuaTu(ctx: Parameters<typeof createAuditContext>[0]): NguoiSuaStopPin {
  const ac = createAuditContext(ctx);
  return { id: ac.userId ?? null, name: ac.userName ?? null, ipAddress: ac.ipAddress ?? null, userAgent: ac.userAgent ?? null };
}

/** Lỗi nghiệp vụ của stopPin → appError có mã (khoá errors.field/reason.* ở vi/en/zh). */
function loiStopPin(e: StopPinLoi): never {
  switch (e.loai) {
    case "adapter_not_found":
      throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "adapter" }, "Adapter không tồn tại.");
    case "tag_not_found":
      throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "deviceTag" }, "Tag không tồn tại.");
    case "tag_not_writable":
      throw appError(
        "BAD_REQUEST",
        "INVALID_VALUE",
        { field: "stopValue", reason: "stopPinTagNotWritable" },
        "Stop pin refused: the tag must be writable and enabled.",
      );
    case "type_mismatch":
      throw appError(
        "BAD_REQUEST",
        "INVALID_VALUE",
        { field: "stopValue", reason: "stopPinTypeMismatch" },
        `Stop pin refused: value does not match the tag dataType (${String(e.chiTiet.detail ?? "")}).`,
      );
  }
}

/**
 * doc 81 Đợt 1B Task 12 fix round 1 (#6) — kiểm securityMode/securityPolicy của OPC UA LÚC
 * LƯU (cả endpoint dự phòng ha.secondaryOptions), để tổ hợp mâu thuẫn không nằm im trong DB
 * tới lần nối đầu. Chi tiết kỹ thuật đi trong message (fallback), câu dịch qua reason.
 */
function assertOpcuaSecurityOnSave(options: Record<string, unknown> | null | undefined): void {
  const check = (o: unknown) => {
    if (o && typeof o === "object" && !Array.isArray(o)) parseOpcuaSecurityOptions(o as Record<string, unknown>);
  };
  try {
    check(options);
    const ha = options?.ha as Record<string, unknown> | undefined;
    if (ha && typeof ha === "object") check(ha.secondaryOptions);
  } catch (e) {
    throw appError(
      "BAD_REQUEST",
      "INVALID_VALUE",
      { field: "opcuaSecurity", reason: "opcuaSecurityInvalid" },
      (e as Error)?.message || "invalid OPC UA security configuration",
    );
  }
}

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

// doc 81 Đợt 1D Task 1 fix round 1 (Ruling R-1D-b) — trường KHÔNG mang `.default()`: zod 4 giữ default
// qua `.partial()`, nên update THIẾU một cờ từng bị ĐIỀN mặc định (tags.update chỉ gửi isEnabled ⇒
// writable=false; adapter.update chỉ gửi isEnabled ⇒ pollIntervalMs=5000). Default chỉ gắn ở schema TẠO;
// schema SỬA dựng từ bản không default ⇒ trường vắng = GIỮ NGUYÊN.
const adapterFields = z.object({
  code: z.string().min(1).max(64),
  name: z.string().min(1).max(255),
  protocol: protocolEnum,
  endpoint: z.string().min(1).max(500),
  connectionOptions: z.record(z.string(), z.unknown()).nullable().optional(),
  pollIntervalMs: z.number().int().min(100).max(3_600_000),
  machineId: z.number().int().positive().nullable().optional(),
  isEnabled: z.boolean(),
});
const adapterCreateInput = adapterFields.extend({
  pollIntervalMs: adapterFields.shape.pollIntervalMs.default(5000),
  isEnabled: adapterFields.shape.isEnabled.default(false),
});
const adapterUpdateInput = adapterFields.partial().extend({ id: z.number().int().positive() });

const tagFields = z.object({
  adapterId: z.number().int().positive(),
  tagKey: z.string().min(1).max(128),
  address: z.string().min(1).max(255),
  dataType: dataTypeEnum,
  unit: z.string().max(50).nullable().optional(),
  scale: z.number().nullable().optional(),
  offset: z.number().nullable().optional(),
  writable: z.boolean(),
  isEnabled: z.boolean(),
  // G1.4 (doc 44 W2-A3, mig 0253) — report-by-exception per tag, OPTIONAL (client
  // cũ không gửi → NULL, hành vi cũ). Chỉ có tác dụng khi OT_TAG_DEADBAND_ENABLED.
  deadband: z.number().positive().nullable().optional(),
  samplingMs: z.number().int().min(1).max(86_400_000).nullable().optional(),
});
const tagCreateInput = tagFields.extend({
  writable: tagFields.shape.writable.default(false),
  isEnabled: tagFields.shape.isEnabled.default(true),
});
const tagUpdateInput = tagFields.partial().extend({ id: z.number().int().positive() });

/**
 * timeoutMs truyền cho driver.connect. doc 81 Đợt 1B Task 1 — hạn TỔNG của cả lượt dò
 * (connect + disconnect) là DEFAULT_TEST_TIMEOUT_MS + PROBE_MARGIN_MS (= 10 s), đặt ở
 * đường dùng chung `probeOtConnection` để MỌI driver đều có; trước đây 8 s + 8 s nối tiếp
 * và kết nối xong muộn không được dọn.
 */
const DEFAULT_TEST_TIMEOUT_MS = 8000;

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
      const rows = await db
        .select()
        .from(deviceAdapters)
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(deviceAdapters.createdAt));
      // doc 81 Đợt 1B Task 12 fix round 1 — bí mật (ciphertext lẫn plaintext cũ) không rời server.
      return rows.map(redactAdapterRow);
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
      return { ...redactAdapterRow(adapter), tags };
    }),

  create: protectedProcedure
    .use(requirePermission("machine_control", "canCreate"))
    .input(adapterCreateInput)
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      // Fix round 1 — placeholder "[redacted]" khi TẠO không có gì để giữ ⇒ bỏ khoá; bảo mật
      // OPC UA kiểm ngay lúc lưu (tổ hợp mâu thuẫn ⇒ BAD_REQUEST có lý do).
      const createOptions =
        input.connectionOptions == null
          ? input.connectionOptions
          : (restoreRedactedSecrets(input.connectionOptions, undefined) as Record<string, unknown>);
      if (input.protocol === "opcua") assertOpcuaSecurityOnSave(createOptions);
      try {
        const [row] = await db
          .insert(deviceAdapters)
          .values({
            code: input.code,
            name: input.name,
            protocol: input.protocol,
            endpoint: input.endpoint,
            // doc 81 Đợt 1B Task 12 — mật khẩu (OPC UA UserName) lưu dạng secretBox enc:v1:.
            connectionOptions: sealConnectionOptionSecrets(createOptions) ?? null,
            pollIntervalMs: input.pollIntervalMs,
            machineId: input.machineId ?? null,
            isEnabled: input.isEnabled,
            createdBy: ctx.user.id,
          })
          .returning();
        return redactAdapterRow(row);
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw appError("CONFLICT", "ENTITY_DUPLICATE", { entity: "adapter" }, `Mã adapter "${input.code}" đã tồn tại.`);
        }
        throw err;
      }
    }),

  update: protectedProcedure
    .use(requirePermission("machine_control", "canEdit"))
    .input(adapterUpdateInput)
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      const { id, ...rest } = input;
      try {
        // ★ doc 81 Đợt 1B final wave 5b (security) — ĐỌC-KIỂM-KHÔI PHỤC-GHI trong MỘT giao dịch, hàng
        // adapter khoá bằng SELECT … FOR UPDATE (ràng buộc chung 6: không migration, dùng khoá hàng).
        // Trước đây: SELECT thường rồi UPDATE vô điều kiện ⇒ hai yêu cầu đồng thời lách được luật
        // nhập lại bí mật: B (chỉ connectionOptions + "[redacted]") đọc TRƯỚC khi A (đổi endpoint sang
        // host lạ + bí mật mới) commit, ghi SAU ⇒ hàng = endpoint của A + bí mật CŨ do B khôi phục.
        // Với FOR UPDATE, B chờ A commit rồi đọc ĐÚNG hàng sắp bị ghi đè: placeholder khôi phục bí mật
        // của A (A tự cung cấp), còn form cũ mang endpoint E0 ≠ hàng của A ⇒ bị từ chối.
        const row = await db.transaction(async (tx) => {
          const patch: Record<string, unknown> = { ...rest, updatedAt: new Date() };
          // doc 81 Đợt 1D Task 1 fix round 1 (Ruling R-1D-a) — adapter đổi "thiết bị nào" (endpoint /
          // protocol / đích trong connectionOptions / machineId) ⇒ gỡ MỌI ghim DỪNG của nó trong CÙNG tx.
          let goGhim = false;
          if (rest.endpoint !== undefined || rest.protocol !== undefined || rest.connectionOptions !== undefined || rest.machineId !== undefined) {
            const [cu] = await tx.select().from(deviceAdapters).where(eq(deviceAdapters.id, id)).for("update");
            if (!cu) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "adapter" }, "Adapter không tồn tại.");
            goGhim = adapterDoiDich(cu, rest);
          }
          if (rest.connectionOptions !== undefined || rest.protocol === "opcua" || rest.endpoint !== undefined) {
            // Fix round 1 — cần dòng đã lưu để (a) giữ bí mật khi form gửi lại "[redacted]",
            // (b) biết protocol thực khi kiểm bảo mật OPC UA lúc lưu; final wave (item 5): (c) biết
            // endpoint/bảo mật CÓ ĐỔI không — đổi thì placeholder KHÔNG được khôi phục.
            const [existing] = await tx.select().from(deviceAdapters).where(eq(deviceAdapters.id, id)).for("update");
            if (!existing) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "adapter" }, "Adapter không tồn tại.");
            const storedOptions = (existing.connectionOptions as Record<string, unknown> | null) ?? null;
            // doc 81 Đợt 1B final wave (item 5, security) — một người có canEdit đổi endpoint (hoặc hạ
            // securityMode xuống None / đổi policy / bật TOFU) mà gửi kèm "[redacted]" thì bí mật đã
            // lưu KHÔNG được dùng lại (nó sẽ đi tới host họ chọn / đi trần trên dây): BAD_REQUEST, dòng
            // giữ nguyên, phải nhập lại bí mật. Áp cho cả ha.secondaryEndpoint / ha.secondaryOptions.
            const reentry = secretReentryRequired(
              { endpoint: rest.endpoint, options: rest.connectionOptions },
              { endpoint: existing.endpoint, options: storedOptions },
            );
            if (reentry) {
              throw appError(
                "BAD_REQUEST",
                "INVALID_VALUE",
                { field: reentry.field, reason: "secretReentryRequired" },
                `Secret re-entry required: "${reentry.field}" changed (where or how the stored secret is sent) while the request still carries the "${REDACTED_SECRET}" placeholder — re-enter the password/secret to save.`,
              );
            }
            const nextOptions =
              rest.connectionOptions === undefined
                ? storedOptions
                : rest.connectionOptions === null
                  ? null
                  : (restoreRedactedSecrets(rest.connectionOptions, storedOptions) as Record<string, unknown>);
            if ((rest.protocol ?? existing.protocol) === "opcua") assertOpcuaSecurityOnSave(nextOptions);
            // doc 81 Đợt 1B Task 12 — cùng niêm phong mật khẩu như create (idempotent với enc:v1:).
            if (rest.connectionOptions !== undefined) {
              patch.connectionOptions = sealConnectionOptionSecrets(nextOptions);
            }
          }
          const [updated] = await tx.update(deviceAdapters).set(patch).where(eq(deviceAdapters.id, id)).returning();
          if (!updated) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "adapter" }, "Adapter không tồn tại.");
          if (goGhim) {
            await goMoiStopPinCuaAdapterTx(tx, { adapterId: id, nguon: "adapter_redefined", nguoiSua: nguoiSuaTu(ctx), thaoTac: "deviceAdapter.update" });
          }
          return updated;
        });
        return redactAdapterRow(row);
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
    .mutation(async ({ input, ctx }) => {
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
        // doc 81 Đợt 1D Task 1 — tag đang GHIM DỪNG bị xoá theo adapter ⇒ audit gỡ ghim cùng transaction.
        const tags = await tx.select().from(deviceTags).where(eq(deviceTags.adapterId, input.id)).for("update");
        for (const t of tags) {
          if (t.stopValue != null) {
            await ghiAuditGoStopPinTx(tx, { tag: t, nguon: "adapter_deleted", nguoiSua: nguoiSuaTu(ctx), thaoTac: "deviceAdapter.delete" });
          }
        }
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
      // ── F14 (2026-08-22) — LỖI ĐI RA BẰNG CỬA "THÀNH CÔNG" ──────────────────────
      // Thủ tục này KHÔNG ném khi dò thất bại: nó trả 200 OK kèm `{ ok: false, error }`.
      // Hệ quả trước bản này: `onError` phía client không chạy, `appCode` không tồn tại,
      // nên `mapTrpcError` không bao giờ thấy chuỗi ấy. Người vận hành đọc nguyên văn
      // *"ModbusDriver: not connected"* trong khi CÙNG Ô ĐÓ, đường `onError` lại hiện câu
      // đã dịch — hai câu khác ngôn ngữ cho cùng một sự việc, tuỳ nó hỏng kiểu nào.
      //
      // Trả CẢ HAI, không đánh đổi: `errorCode` cho người vận hành (client dịch qua
      // `translateAppError`), `error` giữ NGUYÊN VĂN cho kỹ sư — chuỗi
      // "ECONNREFUSED 10.0.0.5:502" là thứ duy nhất nói được hỏng ở đâu.
      try {
        driver = createDriver(protocol);
      } catch (err) {
        // Không dựng được driver ⇒ bản dựng này không có giao thức đó. Cách gỡ NGƯỢC với
        // "không tới được": phải đổi cấu hình/nâng cấp, không phải đi kiểm dây.
        return {
          ok: false,
          latencyMs: 0,
          errorCode: "DEVICE_PROTOCOL_UNSUPPORTED" as const,
          errorParams: { entity: protocol },
          // data-raw-ok: chi tiết KỸ THUẬT cho kỹ sư, ĐI KÈM errorCode để client dịch
          // câu cho người vận hành. Dịch dòng này là đổi thông tin hữu ích lấy câu chung chung.
          error: err instanceof Error ? err.message : String(err),
        };
      }

      try {
        // doc 81 Đợt 1B Task 1 — hạn tổng + luôn dọn socket (kể cả kết nối xong muộn).
        await probeOtConnection(driver, { endpoint, options, timeoutMs: DEFAULT_TEST_TIMEOUT_MS });
        return { ok: true, latencyMs: Date.now() - startedAt };
      } catch (err) {
        return {
          ok: false,
          latencyMs: Date.now() - startedAt,
          errorCode: "DEVICE_UNREACHABLE" as const,
          errorParams: { entity: protocol },
          // data-raw-ok: chi tiết KỸ THUẬT cho kỹ sư, ĐI KÈM errorCode để client dịch
          // câu cho người vận hành. Dịch dòng này là đổi thông tin hữu ích lấy câu chung chung.
          error: err instanceof Error ? err.message : String(err),
        };
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
      .input(tagUpdateInput)
      .mutation(async ({ input, ctx }) => {
        const db = await getDb();
        const { id, scale, offset, ...rest } = input;
        const patch: Record<string, unknown> = { ...rest, updatedAt: new Date() };
        if (scale !== undefined) patch.scale = scale != null ? String(scale) : null;
        if (offset !== undefined) patch.offset = offset != null ? String(offset) : null;
        try {
          // doc 81 Đợt 1D Task 1 — tag khoá FOR UPDATE; tag đang GHIM DỪNG mà thành không-ghi-được /
          // bị tắt / đổi định nghĩa dây ⇒ ghim bị gỡ trong CÙNG transaction, cùng audit.
          return await db.transaction(async (tx) => {
            const [existing] = await tx.select().from(deviceTags).where(eq(deviceTags.id, id)).for("update");
            if (!existing) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "deviceTag" }, "Tag không tồn tại.");
            const nguonGo = lyDoGoStopPinKhiSuaTag(existing, patch);
            if (nguonGo) Object.assign(patch, GO_STOP_PIN_PATCH);
            const [row] = await tx.update(deviceTags).set(patch).where(eq(deviceTags.id, id)).returning();
            if (!row) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "deviceTag" }, "Tag không tồn tại.");
            if (nguonGo) {
              const { commissioningRecheckRequired } = await ghiAuditGoStopPinTx(tx, { tag: existing, nguon: nguonGo, nguoiSua: nguoiSuaTu(ctx), thaoTac: "deviceAdapter.tags.update" });
              // final wave 3 (M4) — UI được BÁO là ghim vừa bị gỡ (và có phải soát lại commissioning không). Chỉ gắn
              // khi thật sự gỡ ⇒ mọi lượt sửa khác trả đúng hàng như cũ.
              return { ...row, stopPinAutoCleared: true as const, commissioningRecheckRequired };
            }
            return row;
          });
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
      .mutation(async ({ input, ctx }) => {
        const db = await getDb();
        // doc 81 Đợt 1D Task 1 — xoá tag đang GHIM DỪNG ⇒ audit gỡ ghim trong CÙNG transaction.
        await db.transaction(async (tx) => {
          const [existing] = await tx.select().from(deviceTags).where(eq(deviceTags.id, input.id)).for("update");
          if (!existing) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "deviceTag" }, "Tag không tồn tại.");
          await tx.delete(deviceTags).where(eq(deviceTags.id, input.id));
          if (existing.stopValue != null) {
            await ghiAuditGoStopPinTx(tx, { tag: existing, nguon: "tag_deleted", nguoiSua: nguoiSuaTu(ctx), thaoTac: "deviceAdapter.tags.delete" });
          }
        });
        return { success: true };
      }),

    /**
     * doc 81 Đợt 1D Task 1 — GHIM / GỠ giá trị DỪNG của một tag (doc 81 §8 QĐ1). Cấu hình AN TOÀN:
     * cùng quyền sửa tag (machine_control canEdit) + adapter trong phạm vi người sửa + lý do bắt buộc.
     * Chỉ tag writable + enabled; giá trị đúng dataType. `stopValue: null` = gỡ. Một transaction, tag
     * khoá FOR UPDATE, audit control_audit_log + audit_logs (trước/sau/lý do). Adapter đã commissioning
     * ⇒ vẫn cho đổi, audit gắn `commissioningRecheckRequired: true`.
     */
    setStopPin: protectedProcedure
      .use(requirePermission("machine_control", "canEdit"))
      .input(z.object({
        adapterId: z.number().int().positive(),
        tagKey: z.string().min(1).max(128),
        stopValue: z.unknown(),
        reason: z.string().trim().min(5).max(500),
      }))
      .mutation(async ({ input, ctx }) => {
        const phamViMay = await idsTrongPhamVi("machine", phamViCua(ctx));
        try {
          return await datStopPin({
            adapterId: input.adapterId,
            tagKey: input.tagKey,
            // Vắng (undefined) KHÔNG phải "gỡ" — chỉ null TƯỜNG MINH mới gỡ; vắng ⇒ sai kiểu (validateStopValue).
            stopValue: input.stopValue === undefined ? Symbol.for("stopValue.missing") : input.stopValue,
            reason: input.reason,
            nguoiSua: nguoiSuaTu(ctx),
            phamViMay,
          });
        } catch (e) {
          if (e instanceof StopPinLoi) loiStopPin(e);
          throw e;
        }
      }),
  }),
});
