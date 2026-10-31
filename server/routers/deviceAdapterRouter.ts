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
 * SCADA R1b-2b-2b A C2 (KD-2bA 2.1 / 2.2): hàng adapter trả ra (list/get/create/update — `hangAnToan` → `redactAdapterRow`) mang `endpoint`,
 *   `connectionOptions` và văn bản `lastError` CHỈ cho kỹ sư canEdit (`chiTietKyThuatCua`: vai admin|engineer + machine_control.canEdit); người khác
 *   nhận `null` + `lastError` = MÃ đã làm sạch (`maLoi`). `maLoi` + posture `tamKhoa` (MC tạm khoá) hiện với MỌI người xem.
 *   C2 fix 1: `update` mang `endpoint` / `connectionOptions` từ người bị che ⇒ FORBIDDEN OPERATION_FAILED {deviceAdapterUpdate, chiTietKyThuatBiChe}, không ghi.
 * SCADA R1b-1 Task 9 (+ fix round 1–3): tags.create/update/delete đụng một tag ĐƯỢC BẢO VỆ (định nghĩa T9 r3, services/scada/troLaiKenh.ts:
 *   đã khai / kênh chế độ / ĐÍCH hoặc NGUỒN telemetry của luật interlock không-alert ĐANG BẬT HOẶC ĐÃ DUYỆT) hoặc một khoá mồ côi ⇒ TOTP tươi
 *   mức 5 + kiểm lại nhất quán; update (đổi đích / tắt / đổi máy) và delete của adapter có tag được bảo vệ / kênh chế độ ⇒ TOTP (cổng chung
 *   `congAdapterTx`). Không đường nào được làm luật interlock ĐANG BẬT mất hợp lệ / mất đích / mất nguồn.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { appError } from "../_core/appError";
import { and, eq, desc } from "drizzle-orm";
import { router, protectedProcedure, ACTUATION_ROLES } from "../_core/trpc";
import { requirePermission } from "../_core/accessControl";
import { getDb as getDbRaw } from "../db";
import { deviceAdapters, deviceTags, scadaKenhCheDo } from "../../drizzle/schema";
import { createDriver } from "../services/ot/driverRegistry";
import "../services/ot"; // side-effect: register all drivers (stub + 5 protocol scaffolds)
import type { OtProtocol } from "../services/ot/otDriver";
import { probeOtConnection } from "../services/ot/probeConnection";
import {
  sealConnectionOptionSecrets,
  redactAdapterRow,
  type HangAdapterAnToan,
  restoreRedactedSecrets,
  secretReentryRequired,
  REDACTED_SECRET,
} from "../services/ot/connectionSecrets";
import { parseOpcuaSecurityOptions } from "../services/ot/drivers/opcuaSecurity";
import { kiemDiaChiS7, MA_S7_BIT_NGOAI_DAI, MA_S7_THU_VIEN_KHONG_KIEM_DUOC } from "../services/ot/drivers/s7Address";
import { idsTrongPhamVi } from "../db/hierarchy";
import { phamViCua } from "./_phamViNguoiXem";
import {
  adapterTrongPhamVi,
  adapterCuaTag,
  dieuKienAdapterTrongPhamVi,
  idsMayTrongPhamVi,
  khongThayAdapter,
  kiemPhamViDuoiKhoa,
  maySuDungTrongPhamVi,
} from "./_adapterPhamVi";
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
// SCADA R1b-1 Task 9 — tạo / trỏ lại / xoá tag được bảo vệ + đổi đích adapter: TOTP tươi + kiểm lại nhất quán + luật interlock
import {
  AUDIT_KENH_CHE_DO_DOI_TAG,
  AUDIT_TAO_KHOA_MO_COI,
  AUDIT_TRO_LAI,
  AUDIT_XOA_DA_KHAI,
  anhNhipAudit,
  anhTroLai,
  congAdapterTx,
  khoaAdapterTx,
  khoaLuatNguonTx,
  kenhCheDoCuaTagTx,
  khoaLuatNhamCapTx,
  kiemSuaTag,
  kiemTaoTag,
  kiemXoaTag,
  loiTrungKhoaTag,
  trungKhoaTagTx,
} from "../services/scada/troLaiKenh";
import { kiemTotpCauHinh, totpCauHinhInput } from "../services/scada/totpCauHinh";
import { thamSoNgoaiDaiStopPin } from "../services/scada/nhatQuanKenh"; // R1b-2a T2 (K17) — tham số STOP_PIN_NGOAI_DAI dùng chung
import { recordAuditEvent } from "../services/audit/controlAuditService";
// SCADA R1b-2b-2b A — C2 (KD-2bA 2.1 / 2.2): che endpoint / lastError dưới kỹ sư canEdit (một luật với C1) + posture tạm khoá không bao giờ che
import { chiTietKyThuatCua, maLoiAdapterCua } from "./_chiTietKyThuat";
import { canTraEdgeChoTamKhoa, idsAdapterDoEdge, tamKhoaAdapter } from "./_tamKhoaAdapter";

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
    case "dia_chi_bit":
      // SCADA R1b-2b-1 T2 (điều kiện 1b) — địa chỉ coil / bit (driver ghi MỘT BIT bất kể dataType): ghim phải là true/false, 1/0, "1"/"0", "true"/"false".
      throw appError(
        "BAD_REQUEST",
        "INVALID_VALUE",
        { field: "stopValue", reason: "stopPinBitAddress" },
        `Stop pin refused: the tag address ${String(e.chiTiet.address ?? "")} is written as a single bit, so the stop value must be true/false, 1/0, "1"/"0" or "true"/"false".`,
      );
    case "dia_chi_s7":
      // SCADA R1b-2b-2a T3C fix 1 (M4) — tag S7 mà nodes7 không ghi được đúng như yêu cầu (kiemDiaChiS7): ghim STOP bị từ chối; mã + địa chỉ trong message.
      throw appError("BAD_REQUEST", "INVALID_VALUE", { field: "stopValue", reason: "stopPinS7DiaChi" }, `Stop pin refused: ${String(e.chiTiet.lyDo ?? "")}`);
    case "ngoai_dai": {
      // SCADA R1a Task 12 — ghim không ghi được trên kênh theo khai báo kênh hiện tại (cùng mã với scadaKenh.capNhat).
      // R1b-2a T2 (m4, phán quyết K17) — step = lưới vừa trượt (`buoc`: writeStep hoặc |scale| của lưới thô trên tag CHƯA khai) ?? writeStep,
      // goiY = giá trị hợp lệ gần nhất ("—" khi không có) — cùng hàm tham số với mọi nơi phát mã này.
      const so = (n: unknown) => (typeof n === "number" ? n : undefined);
      const lyDo = String(e.chiTiet.lyDo ?? "");
      const buoc = so(e.chiTiet.buoc);
      const ts = thamSoNgoaiDaiStopPin(
        { writeMin: so(e.chiTiet.writeMin) ?? null, writeMax: so(e.chiTiet.writeMax) ?? null, writeStep: so(e.chiTiet.writeStep) ?? null },
        { ma: lyDo, luoi: buoc === undefined ? undefined : { buoc, goiY: so(e.chiTiet.goiY), gocLuoi: so(e.chiTiet.gocLuoi) } },
      );
      throw appError(
        "BAD_REQUEST",
        "STOP_PIN_NGOAI_DAI",
        {
          ma: "STOP_PIN_NGOAI_DAI",
          lyDo,
          tagKey: String(e.chiTiet.tagKey ?? ""),
          stopValue: String(e.chiTiet.stopValue),
          min: ts.min,
          max: ts.max,
          step: ts.step,
          goiY: ts.goiY,
        },
        `Stop pin refused: the value cannot be written on the declared channel (${String(e.chiTiet.detail ?? "")}).`,
      );
    }
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

/**
 * SCADA R1b-2b-2a T3C (backlog 87) + fix 1 (I2) — kiểm địa chỉ tag LÚC LƯU: adapter S7 + địa chỉ mà nodes7 0.3.18 không ghi được ĐÚNG như yêu cầu
 * (`kiemDiaChiS7` — CÙNG vị từ với khởi động / scadaDiag / driver): bit ∉ 0..7, vùng nodes7 không có ("MX0.1", "PQ0", "PI0"), mảng ("DB1,INT2.5"),
 * dạng sai ⇒ từ chối; bộ phân tích nodes7 không dùng được ⇒ từ chối (fail-closed). Tag STOP chỉ-ghi không còn im lặng tới lúc bấm STOP.
 * Đọc protocol trong CÙNG giao dịch, sau khi adapter đã khoá (khoaAdapterTx). Chi tiết (mã + địa chỉ) đi trong message, câu dịch qua reason.
 */
async function kiemDiaChiTagLuuTx(
  tx: Pick<Awaited<ReturnType<typeof getDb>>, "select">,
  adapterId: number,
  t: { address: string; tagKey: string; dataType: string; writable: boolean },
): Promise<void> {
  const [a] = await tx.select({ protocol: deviceAdapters.protocol }).from(deviceAdapters).where(eq(deviceAdapters.id, adapterId));
  if (a?.protocol !== "s7") return;
  // fix 2 (N1) — tag ghi được ⇒ chế độ "ghi" (chặt: driver sẽ từ chối mọi lời ghi tới địa chỉ mảng); chỉ-đọc ⇒ "doc" theo dataType.
  const loi = kiemDiaChiS7(t.address, { khoa: t.tagKey, cheDo: t.writable ? "ghi" : "doc", dataType: t.dataType });
  if (!loi) return;
  const reason = loi.ma === MA_S7_BIT_NGOAI_DAI ? "s7BitNgoaiDai" : loi.ma === MA_S7_THU_VIEN_KHONG_KIEM_DUOC ? "s7ThuVienKhongKiemDuoc" : "s7DiaChiThuVienBo";
  throw appError("BAD_REQUEST", "INVALID_VALUE", { field: "tagAddress", reason }, loi.lyDo);
}

async function getDb() {
  const db = await getDbRaw();
  if (!db) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not connected");
  return db;
}

/**
 * SCADA R1b-2b-2b A — C2 (KD-2bA 2.1 / 2.2) — MỌI hàng adapter rời router này đi qua đây: quyền xem chi tiết kỹ thuật hỏi MỘT lần cho cả lô
 * (`chiTietKyThuatCua` — vai ngoài admin/engineer không chạm DB), sở hữu edge chỉ tra khi có hàng MC đang khoá, rồi `redactAdapterRow` (bí mật luôn che;
 * `endpoint` / `connectionOptions` / văn bản `lastError` chỉ cho kỹ sư canEdit; `maLoi` + `tamKhoa` cho mọi người).
 */
async function hangAnToan<T extends typeof deviceAdapters.$inferSelect>(
  ctx: Parameters<typeof chiTietKyThuatCua>[0],
  rows: T[],
): Promise<Array<HangAdapterAnToan<T>>> {
  if (rows.length === 0) return [];
  const chiTietKyThuat = await chiTietKyThuatCua(ctx);
  const edge = canTraEdgeChoTamKhoa(rows) ? await idsAdapterDoEdge(await getDb(), rows.map((r) => r.id)) : new Set<number>();
  return rows.map((r) =>
    redactAdapterRow(r, {
      chiTietKyThuat,
      tamKhoa: tamKhoaAdapter(r.protocol, edge.has(r.id)),
      maLoi: maLoiAdapterCua(r.lastError, r.status === "error"),
    }),
  );
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
// SCADA R1b-1 Task 9 fix round 1 (I5) — đổi đích (endpoint / protocol / đích trong connectionOptions / machineId) của adapter có tag ĐƯỢC BẢO VỆ ⇒ TOTP.
const adapterUpdateInput = adapterFields.partial().extend({ id: z.number().int().positive(), totpCode: totpCauHinhInput });

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
// SCADA R1b-1 Task 9 — `totpCode`: mã TOTP 6 số, CHỈ cần khi lượt tạo / sửa / xoá đụng một tag ĐƯỢC BẢO VỆ hoặc khoá mồ côi
// (khuôn R1a: vắng ⇒ TOTP_CAN ở handler, không phải lỗi zod).
const tagCreateInput = tagFields.extend({
  writable: tagFields.shape.writable.default(false),
  isEnabled: tagFields.shape.isEnabled.default(true),
  totpCode: totpCauHinhInput,
});
const tagUpdateInput = tagFields.partial().extend({ id: z.number().int().positive(), totpCode: totpCauHinhInput });

/**
 * timeoutMs truyền cho driver.connect. doc 81 Đợt 1B Task 1 — hạn TỔNG của cả lượt dò
 * (connect + disconnect) là DEFAULT_TEST_TIMEOUT_MS + PROBE_MARGIN_MS (= 10 s), đặt ở
 * đường dùng chung `probeOtConnection` để MỌI driver đều có; trước đây 8 s + 8 s nối tiếp
 * và kết nối xong muộn không được dọn.
 */
const DEFAULT_TEST_TIMEOUT_MS = 8000;

/** Friendly message for a unique-constraint violation. */
/**
 * Kết quả `testConnection` (HỢP ĐỒNG — DeviceAdapterManagement / DeviceOnboardingWizard / UnifiedDeviceMonitor dùng chung). `error` = văn bản driver
 * NGUYÊN VĂN (kỹ sư); C2 fix 2: dò theo id bởi người không được xem chi tiết kỹ thuật ⇒ khoá `error` VẮNG, chỉ còn `errorCode` / `errorParams`.
 */
export type KetQuaDoKetNoi = {
  ok: boolean;
  latencyMs: number;
  errorCode?: "DEVICE_PROTOCOL_UNSUPPORTED" | "DEVICE_UNREACHABLE";
  errorParams?: { entity: OtProtocol };
  error?: string;
};

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
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      const conds = [];
      // phạm vi nhà máy (rà bảo mật 2026-10-24): chỉ adapter của máy trong phạm vi; adapter KHÔNG gắn máy chỉ phạm vi toàn quyền thấy
      const cong = dieuKienAdapterTrongPhamVi(await idsMayTrongPhamVi(ctx));
      if (cong) conds.push(cong);
      if (input?.machineId != null) conds.push(eq(deviceAdapters.machineId, input.machineId));
      if (input?.protocol != null) conds.push(eq(deviceAdapters.protocol, input.protocol));
      if (input?.isEnabled != null) conds.push(eq(deviceAdapters.isEnabled, input.isEnabled));
      const rows = await db
        .select()
        .from(deviceAdapters)
        .where(conds.length ? and(...conds) : undefined)
        .orderBy(desc(deviceAdapters.createdAt));
      // doc 81 Đợt 1B Task 12 fix round 1 — bí mật (ciphertext lẫn plaintext cũ) không rời server.
      return hangAnToan(ctx, rows);
    }),

  get: protectedProcedure
    .use(requirePermission("machine_control", "canView"))
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input, ctx }) => {
      const db = await getDb();
      await adapterTrongPhamVi(ctx, input.id); // ngoài phạm vi ≡ không tồn tại (cùng NOT_FOUND)
      const [adapter] = await db.select().from(deviceAdapters).where(eq(deviceAdapters.id, input.id)).limit(1);
      if (!adapter) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "adapter" }, "Adapter không tồn tại.");
      const tags = await db
        .select()
        .from(deviceTags)
        .where(eq(deviceTags.adapterId, input.id))
        .orderBy(deviceTags.tagKey);
      const [an] = await hangAnToan(ctx, [adapter]);
      return { ...an, tags };
    }),

  create: protectedProcedure
    .use(requirePermission("machine_control", "canCreate"))
    .input(adapterCreateInput)
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      await maySuDungTrongPhamVi(ctx, input.machineId ?? null); // máy gắn vào PHẢI trong phạm vi người tạo (rà bảo mật 2026-10-24)
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
        const [an] = await hangAnToan(ctx, [row]);
        return an;
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
      const { id, totpCode, ...rest } = input;
      // phạm vi nhà máy (rà bảo mật 2026-10-24): sửa adapter ngoài phạm vi ≡ NOT_FOUND; đổi máy gắn thì máy MỚI cũng phải trong phạm vi
      const idsMay = await idsMayTrongPhamVi(ctx); // R1b-2a T5 — tính TRƯỚC giao dịch, dùng lại dưới khoá (không gọi pool trong tx)
      await adapterTrongPhamVi(ctx, id, idsMay);
      if (rest.machineId !== undefined) await maySuDungTrongPhamVi(ctx, rest.machineId);
      // SCADA R1b-2b-2b A — C2 fix 1 (dieu-phoi 2026-10-31) — CHỐT MẤT DỮ LIỆU: người không được xem chi tiết kỹ thuật nhận endpoint / connectionOptions
      // ĐÃ CHE (null) ⇒ không được GHI hai trường đó (form gửi lại ô trống / null sẽ xoá endpoint hay cấu hình đã lưu). Từ chối TRƯỚC mọi lượt ghi
      // (trước giao dịch, trước kiểm TOTP — mã không bị tiêu). Trường khác (tên, bật/tắt, chu kỳ, máy…) vẫn sửa được như cũ.
      // C2 fix 2 (review m3) — `protocol` cũng vậy: đổi giao thức là đổi NGHĨA của kết nối (endpoint cũ đọc theo giao thức khác) mà người bị che không thấy.
      if ((rest.endpoint !== undefined || rest.connectionOptions !== undefined || rest.protocol !== undefined) && !(await chiTietKyThuatCua(ctx))) {
        throw appError(
          "FORBIDDEN",
          "OPERATION_FAILED",
          { operation: "deviceAdapterUpdate", reason: "chiTietKyThuatBiChe" },
          "Endpoint / protocol / connection options are technical details you cannot view — only an engineer/admin with machine_control.canEdit may change them.",
        );
      }
      try {
        // ★ doc 81 Đợt 1B final wave 5b (security) — ĐỌC-KIỂM-KHÔI PHỤC-GHI trong MỘT giao dịch, hàng
        // adapter khoá bằng SELECT … FOR UPDATE (ràng buộc chung 6: không migration, dùng khoá hàng).
        // Trước đây: SELECT thường rồi UPDATE vô điều kiện ⇒ hai yêu cầu đồng thời lách được luật
        // nhập lại bí mật: B (chỉ connectionOptions + "[redacted]") đọc TRƯỚC khi A (đổi endpoint sang
        // host lạ + bí mật mới) commit, ghi SAU ⇒ hàng = endpoint của A + bí mật CŨ do B khôi phục.
        // Với FOR UPDATE, B chờ A commit rồi đọc ĐÚNG hàng sắp bị ghi đè: placeholder khôi phục bí mật
        // của A (A tự cung cấp), còn form cũ mang endpoint E0 ≠ hàng của A ⇒ bị từ chối.
        const row = await db.transaction(async (tx) => {
          // R1b-2a T5 (kiem-dinh M5) — ADAPTER FOR UPDATE NGAY đầu giao dịch, MỌI patch (trước: chỉ khi đổi đích / tắt / đổi mã / bí mật — sửa tên
          // hay chu kỳ không khoá gì), rồi KIỂM LẠI phạm vi trên `machineId` ĐÃ KHOÁ: đổi máy sang nhà máy khác đã commit sau kiểm-trước ⇒ cùng
          // NOT_FOUND, không ghi. Các nhánh dưới đọc lại hàng này trong CÙNG giao dịch (khoá đã giữ ⇒ không chờ, không đổi thứ tự khoá).
          const [khoa] = await tx.select({ machineId: deviceAdapters.machineId }).from(deviceAdapters).where(eq(deviceAdapters.id, id)).for("update"); // ADAPTER
          kiemPhamViDuoiKhoa(khoa ? (khoa.machineId ?? null) : undefined, idsMay, khongThayAdapter);
          const patch: Record<string, unknown> = { ...rest, updatedAt: new Date() };
          // doc 81 Đợt 1D Task 1 fix round 1 (Ruling R-1D-a) — adapter đổi "thiết bị nào" (endpoint /
          // protocol / đích trong connectionOptions / machineId) ⇒ gỡ MỌI ghim DỪNG của nó trong CÙNG tx.
          let goGhim = false;
          // R1b-1 T9 fix round 1 (I5) — đổi đích một adapter có tag ĐƯỢC BẢO VỆ (đã khai / kênh chế độ / đích luật đang bật) ⇒ TOTP tươi, kiểm
          // CUỐI (sau kiểm bí mật / bảo mật OPC UA bên dưới). Đổi máy khi còn kênh chế độ trỏ vào adapter ⇒ từ chối.
          // Fix round 2 (I2 ở cấp adapter, rà bảo mật) — TẮT adapter (isEnabled true → false) đi qua CÙNG cổng với tắt tag: luật interlock đang bật
          // nhắm adapter ⇒ INTERLOCK_MAT_DICH; tag đã khai đang ghim ⇒ "gỡ ghim trước"; có kênh chế độ / tag đã khai ⇒ TOTP + audit.
          // Fix round 3 (N1/N3) — cổng dùng chung `congAdapterTx` (cũng cho deviceAdapter.delete và scadaDiag.tamTat). Tag ĐÃ KHAI đang ghim ⇒
          // "gỡ ghim trước" TRƯỚC kiểm mã; sau cổng mọi ghim còn lại thuộc tag chưa khai ⇒ goMoiStopPinCuaAdapterTx chỉ gỡ chúng (doc 81).
          let canTotpDoiDich: { action: string; truoc: Record<string, unknown> } | null = null;
          const coTruongDich = rest.endpoint !== undefined || rest.protocol !== undefined || rest.connectionOptions !== undefined || rest.machineId !== undefined;
          if (coTruongDich || rest.isEnabled === false || rest.code !== undefined) {
            const [cu] = await tx.select().from(deviceAdapters).where(eq(deviceAdapters.id, id)).for("update"); // ADAPTER (thứ tự khoá)
            if (!cu) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "adapter" }, "Adapter không tồn tại.");
            // N8 — mã adapter trùng ⇒ ENTITY_DUPLICATE TRƯỚC kiểm mã TOTP (mã không bị tiêu).
            if (rest.code !== undefined && rest.code !== cu.code) {
              const trung = await tx.select({ id: deviceAdapters.id }).from(deviceAdapters).where(eq(deviceAdapters.code, rest.code));
              if (trung.some((r) => r.id !== id)) throw appError("CONFLICT", "ENTITY_DUPLICATE", { entity: "adapter" }, `Mã adapter đã tồn tại.`);
            }
            goGhim = coTruongDich && adapterDoiDich(cu, rest);
            const tatAdapter = rest.isEnabled === false && cu.isEnabled === true;
            if (goGhim || tatAdapter) {
              const doiMay = goGhim && rest.machineId !== undefined && (rest.machineId ?? null) !== (cu.machineId ?? null);
              const cong = await congAdapterTx(tx, {
                adapterId: id,
                code: cu.code,
                machineId: cu.machineId ?? null,
                viec: tatAdapter ? "tat" : "doi_dich",
                doiMay,
                machineIdMoi: doiMay ? (rest.machineId ?? null) : undefined,
              });
              const truoc = { protocol: cu.protocol, endpoint: cu.endpoint, machineId: cu.machineId ?? null, isEnabled: cu.isEnabled };
              if (cong.canTotp) canTotpDoiDich = { action: cong.auditAction, truoc };
            }
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
          if (canTotpDoiDich) await kiemTotpCauHinh(ctx, totpCode); // CUỐI — ngay trước lượt ghi
          const [updated] = await tx.update(deviceAdapters).set(patch).where(eq(deviceAdapters.id, id)).returning();
          if (!updated) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "adapter" }, "Adapter không tồn tại.");
          if (canTotpDoiDich) {
            await recordAuditEvent(tx, {
              entityType: "device_adapter",
              entityId: id,
              action: canTotpDoiDich.action,
              actorId: ctx.user.id,
              before: canTotpDoiDich.truoc,
              after: { protocol: updated.protocol, endpoint: updated.endpoint, machineId: updated.machineId ?? null, isEnabled: updated.isEnabled },
              reason: "deviceAdapter.update",
            });
          }
          // doc 81 Đợt 4 Task C1 — số ghim DỪNG vừa gỡ (0 khi không đổi đích) trả về để UI BÁO (trước: gỡ im lặng).
          let stopPinsCleared = 0;
          if (goGhim) {
            stopPinsCleared = await goMoiStopPinCuaAdapterTx(tx, { adapterId: id, nguon: "adapter_redefined", nguoiSua: nguoiSuaTu(ctx), thaoTac: "deviceAdapter.update" });
          }
          return { updated, stopPinsCleared };
        });
        const [an] = await hangAnToan(ctx, [row.updated]);
        return { ...an, stopPinsCleared: row.stopPinsCleared };
      } catch (err) {
        if (err instanceof TRPCError) throw err;
        if (isUniqueViolation(err)) {
          throw appError("CONFLICT", "ENTITY_DUPLICATE", { entity: "adapter" }, `Mã adapter đã tồn tại.`);
        }
        throw err;
      }
    }),

  /**
   * SCADA R1b-1 Task 9 fix round 3 (N3) — xoá adapter đi qua cổng ADAPTER dùng chung (`congAdapterTx`, viec "xoa"): còn kênh chế độ ⇒ từ
   * chối (gỡ kênh chế độ trước); một tag là đích / nguồn của luật interlock đang bật ⇒ INTERLOCK_MAT_DICH; tag đã khai đang ghim ⇒ "gỡ ghim
   * trước"; còn tag được bảo vệ ⇒ TOTP tươi + audit `adapter_bao_ve_xoa`. Kiểm "đang bật" nay đọc hàng adapter FOR UPDATE trong giao dịch.
   */
  delete: protectedProcedure
    .use(requirePermission("machine_control", "canDelete"))
    .input(z.object({ id: z.number().int().positive(), totpCode: totpCauHinhInput }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      const idsMay = await idsMayTrongPhamVi(ctx); // R1b-2a T5 — tính TRƯỚC giao dịch, dùng lại dưới khoá
      await adapterTrongPhamVi(ctx, input.id, idsMay); // ngoài phạm vi ≡ NOT_FOUND (rà bảo mật 2026-10-24) — TRƯỚC cổng adapter T9
      await db.transaction(async (tx) => {
        const [existing] = await tx.select().from(deviceAdapters).where(eq(deviceAdapters.id, input.id)).for("update"); // ADAPTER (thứ tự khoá)
        if (!existing) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "adapter" }, "Adapter không tồn tại.");
        kiemPhamViDuoiKhoa(existing.machineId ?? null, idsMay, khongThayAdapter); // R1b-2a T5 (M5) — phạm vi trên hàng ĐÃ KHOÁ
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
        const cong = await congAdapterTx(tx, { adapterId: input.id, code: existing.code, machineId: existing.machineId ?? null, viec: "xoa" });
        if (cong.canTotp) await kiemTotpCauHinh(ctx, input.totpCode); // CUỐI — ngay trước lượt ghi
        if (cong.canTotp) {
          await recordAuditEvent(tx, {
            entityType: "device_adapter",
            entityId: input.id,
            action: cong.auditAction,
            actorId: ctx.user.id,
            before: { code: existing.code, protocol: existing.protocol, endpoint: existing.endpoint, machineId: existing.machineId ?? null },
            after: null,
            reason: "deviceAdapter.delete",
          });
        }
        // Cascade delete tags + adapter atomically.
        // doc 81 Đợt 1D Task 1 — tag đang GHIM DỪNG bị xoá theo adapter ⇒ audit gỡ ghim cùng transaction.
        // R1b-2a T5 (phán quyết K8) — khoá nhiều tag ORDER BY id (thứ tự khoá dự án, troLaiKenh.ts); congAdapterTx đã khoá cùng tập theo id.
        const tags = await tx.select().from(deviceTags).where(eq(deviceTags.adapterId, input.id)).orderBy(deviceTags.id).for("update");
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
    .mutation(async ({ input, ctx }): Promise<KetQuaDoKetNoi> => {
      let protocol: OtProtocol;
      let endpoint: string;
      let options: Record<string, unknown> | undefined;

      // SCADA R1b-2b-2b A — C2 fix 2 (review Important #1, dieu-phoi 2026-10-31): dò THEO ID dùng endpoint ĐÃ LƯU ⇒ văn bản lỗi driver (vd
      // "connect ECONNREFUSED 10.0.0.5:502") là chi tiết kỹ thuật của adapter: người không phải (admin|engineer + machine_control.canEdit) nhận
      // KHÔNG có `error` — chỉ `errorCode` / `errorParams` (mã appError có câu dịch vi/en/zh). Nhánh {protocol, endpoint}: người gọi TỰ gõ endpoint
      // ⇒ văn bản thô không lộ gì họ chưa biết ⇒ giữ nguyên.
      let xemChiTiet = true;
      if ("id" in input) {
        await adapterTrongPhamVi(ctx, input.id); // dò adapter ngoài phạm vi ≡ NOT_FOUND (rà bảo mật 2026-10-24)
        xemChiTiet = await chiTietKyThuatCua(ctx);
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

      /** C2 fix 2 — kết quả hỏng theo người xem: bị che ⇒ KHÔNG có khoá `error` (không host:port), `errorCode` / `errorParams` giữ nguyên. */
      const theoNguoiXem = (kq: KetQuaDoKetNoi): KetQuaDoKetNoi => {
        if (xemChiTiet) return kq;
        const ra = { ...kq };
        delete ra.error;
        return ra;
      };
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
        return theoNguoiXem({
          ok: false,
          latencyMs: 0,
          errorCode: "DEVICE_PROTOCOL_UNSUPPORTED" as const,
          errorParams: { entity: protocol },
          // data-raw-ok: chi tiết KỸ THUẬT cho kỹ sư, ĐI KÈM errorCode để client dịch
          // câu cho người vận hành. Dịch dòng này là đổi thông tin hữu ích lấy câu chung chung.
          error: err instanceof Error ? err.message : String(err),
        });
      }

      try {
        // doc 81 Đợt 1B Task 1 — hạn tổng + luôn dọn socket (kể cả kết nối xong muộn).
        await probeOtConnection(driver, { endpoint, options, timeoutMs: DEFAULT_TEST_TIMEOUT_MS });
        return { ok: true, latencyMs: Date.now() - startedAt };
      } catch (err) {
        return theoNguoiXem({
          ok: false,
          latencyMs: Date.now() - startedAt,
          errorCode: "DEVICE_UNREACHABLE" as const,
          errorParams: { entity: protocol },
          // data-raw-ok: chi tiết KỸ THUẬT cho kỹ sư, ĐI KÈM errorCode để client dịch
          // câu cho người vận hành. Dịch dòng này là đổi thông tin hữu ích lấy câu chung chung.
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }),

  // ─── Tags ────────────────────────────────────────────────────────────────────
  tags: router({
    listByAdapter: protectedProcedure
      .use(requirePermission("machine_control", "canView"))
      .input(z.object({ adapterId: z.number().int().positive() }))
      .query(async ({ input, ctx }) => {
        const db = await getDb();
        await adapterTrongPhamVi(ctx, input.adapterId); // ngoài phạm vi ≡ NOT_FOUND (rà bảo mật 2026-10-24)
        return db
          .select()
          .from(deviceTags)
          .where(eq(deviceTags.adapterId, input.adapterId))
          .orderBy(deviceTags.tagKey);
      }),

    /**
     * SCADA R1b-1 Task 9 fix round 1 (C1) — tạo tag lên KHOÁ MỒ CÔI (kênh chế độ hoặc luật interlock đang trỏ tới (adapterId, tagKey)) =
     * trỏ lại một tag được bảo vệ ⇒ TOTP tươi + luật đang bật ở khoá đó phải ghi được lên tag mới. Khoá không mồ côi ⇒ như cũ.
     * Thứ tự: luật FOR SHARE ⇒ kênh chế độ FOR UPDATE ⇒ kiểm trùng (M3) ⇒ kiểm ⇒ TOTP (cuối) ⇒ chèn + audit.
     */
    create: protectedProcedure
      .use(requirePermission("machine_control", "canCreate"))
      .input(tagCreateInput)
      .mutation(async ({ input, ctx }) => {
        const db = await getDb();
        const { totpCode, ...v } = input;
        const idsMay = await idsMayTrongPhamVi(ctx); // R1b-2a T5 — tính TRƯỚC giao dịch, dùng lại dưới khoá
        await adapterTrongPhamVi(ctx, v.adapterId, idsMay); // thêm tag vào adapter ngoài phạm vi ≡ NOT_FOUND (rà bảo mật 2026-10-24) — TRƯỚC kiểm T9
        try {
          return await db.transaction(async (tx) => {
            const cap = { adapterId: v.adapterId, tagKey: v.tagKey };
            // Thứ tự khoá ADAPTER → LUẬT → TAG → KÊNH CHẾ ĐỘ (troLaiKenh.ts). R1b-2a T5 (M5): phạm vi kiểm LẠI trên hàng adapter ĐÃ KHOÁ (adapter
            // biến mất giữa chừng ⇒ cùng NOT_FOUND của kiểm-trước, thay cho lỗi FK của INSERT).
            const khoa = (await khoaAdapterTx(tx, [v.adapterId])).get(v.adapterId);
            kiemPhamViDuoiKhoa(khoa?.machineId, idsMay, khongThayAdapter);
            await kiemDiaChiTagLuuTx(tx, v.adapterId, v); // T3C — trước TOTP (lỗi hợp lệ không tiêu mã) // T3C — trước TOTP (lỗi hợp lệ không tiêu mã)
            const may = khoa?.machineId ?? null;
            const luat = await khoaLuatNhamCapTx(tx, cap);
            const nguon = await khoaLuatNguonTx(tx, may, v.tagKey);
            const kenhCheDo = await kenhCheDoCuaTagTx(tx, cap);
            if (await trungKhoaTagTx(tx, cap)) throw loiTrungKhoaTag();
            const record = {
              adapterId: v.adapterId,
              tagKey: v.tagKey,
              address: v.address,
              dataType: v.dataType,
              unit: v.unit ?? null,
              scale: v.scale != null ? String(v.scale) : undefined,
              offset: v.offset != null ? String(v.offset) : undefined,
              writable: v.writable,
              isEnabled: v.isEnabled,
              // G1.4 — deadband/samplingMs (double precision / integer, nullable)
              deadband: v.deadband ?? null,
              samplingMs: v.samplingMs ?? null,
            };
            const moi = { ...record, scale: record.scale ?? null, offset: record.offset ?? null };
            const kt = kiemTaoTag({ moi, luat, nguon, coKenhCheDo: kenhCheDo.length > 0 });
            if (kt.canTotp) await kiemTotpCauHinh(ctx, totpCode); // CUỐI — ngay trước lượt ghi
            const [row] = await tx.insert(deviceTags).values(record).returning();
            if (kt.moCoi) {
              await recordAuditEvent(tx, {
                entityType: "device_tag",
                entityId: row.id,
                action: AUDIT_TAO_KHOA_MO_COI,
                actorId: ctx.user.id,
                before: { kenhCheDo: kenhCheDo.map((k) => k.machineId), luat: luat.map((r) => r.id), nguon: nguon.map((r) => r.id) },
                after: anhTroLai(moi),
                reason: "deviceAdapter.tags.create",
              });
            }
            return row;
          });
        } catch (err) {
          if (err instanceof TRPCError) throw err;
          if (isUniqueViolation(err)) {
            throw appError("CONFLICT", "ENTITY_DUPLICATE", { entity: "deviceTag" }, `Tag "${input.tagKey}" đã tồn tại trong adapter này.`);
          }
          throw err;
        }
      }),

    /**
     * SCADA R1b-1 Task 9 (+ fix round 1) — TRỎ LẠI một tag (`services/scada/troLaiKenh.ts#kiemSuaTag`). Thứ tự trong MỘT giao dịch:
     *   1. đọc tag (không khoá) ⇒ khoá FOR SHARE luật nhắm danh tính CŨ và (nếu đổi tên / chuyển adapter) danh tính MỚI ⇒ khoá tag FOR UPDATE
     *      (thứ tự LUẬT → TAG; tag đổi danh tính giữa chừng ⇒ CONFLICT thử lại) ⇒ kênh chế độ của hai danh tính (FOR UPDATE);
     *   2. đổi danh tính ⇒ kiểm trùng TRƯỚC kiểm mã (M3);
     *   3. kiemSuaTag: tag được bảo vệ (đã khai / kênh chế độ / đích luật đang bật) có cột trỏ lại THẬT SỰ đổi, hoặc danh tính mới là khoá
     *      mồ côi ⇒ kiểm lại nhất quán + "gỡ ghim trước" + luật interlock (cũ VÀ mới); tắt tag là đích luật đang bật / đang ghim ⇒ từ chối;
     *      R1b-2a T8 (kiem-dinh M4): cột NHỊP (samplingMs / deadband / unit) thật sự đổi trên tag được bảo vệ ⇒ cũng cần mã (không kiểm nhất quán);
     *   4. cần mã ⇒ TOTP TƯƠI (`kiemTotpCauHinh`, mức 5) — CUỐI, ngay trước lượt ghi (lỗi kiểm hợp lệ không tiêu mã);
     *   5. ghi (luật gỡ ghim DỪNG cũ cho tag chưa khai) + kênh chế độ đổi tag_key theo + audit `kenh_da_khai_tro_lai`.
     * Tag không được bảo vệ, khoá không mồ côi ⇒ đúng hành vi cũ (không đòi mã).
     */
    update: protectedProcedure
      .use(requirePermission("machine_control", "canEdit"))
      .input(tagUpdateInput)
      .mutation(async ({ input, ctx }) => {
        const db = await getDb();
        const { id, scale, offset, totpCode, ...rest } = input;
        const idsMay = await idsMayTrongPhamVi(ctx); // R1b-2a T5 — tính TRƯỚC giao dịch, dùng lại dưới khoá
        await adapterCuaTag(ctx, id, idsMay); // tag thuộc adapter ngoài phạm vi ≡ không tồn tại
        if (rest.adapterId !== undefined) await adapterTrongPhamVi(ctx, rest.adapterId, idsMay); // không chuyển tag sang adapter ngoài phạm vi
        const patch: Record<string, unknown> = { ...rest, updatedAt: new Date() };
        if (scale !== undefined) patch.scale = scale != null ? String(scale) : null;
        if (offset !== undefined) patch.offset = offset != null ? String(offset) : null;
        try {
          // doc 81 Đợt 1D Task 1 — tag khoá FOR UPDATE; tag đang GHIM DỪNG mà thành không-ghi-được /
          // bị tắt / đổi định nghĩa dây ⇒ ghim bị gỡ trong CÙNG transaction, cùng audit.
          return await db.transaction(async (tx) => {
            const khongThay = () => appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "deviceTag" }, "Tag không tồn tại.");
            const [tag0] = await tx.select({ adapterId: deviceTags.adapterId, tagKey: deviceTags.tagKey }).from(deviceTags).where(eq(deviceTags.id, id));
            if (!tag0) throw khongThay();
            const capMoi = { adapterId: rest.adapterId ?? tag0.adapterId, tagKey: rest.tagKey ?? tag0.tagKey };
            const doiDanhTinh = capMoi.adapterId !== tag0.adapterId || capMoi.tagKey !== tag0.tagKey;
            // LUẬT trước (FOR SHARE, mọi luật nhắm danh tính cũ — và mới — bật hay tắt), TAG sau (FOR UPDATE).
            // Thứ tự khoá ADAPTER (cũ + mới, theo id) → LUẬT (đích + nguồn, danh tính cũ + mới) → TAG → KÊNH CHẾ ĐỘ (troLaiKenh.ts, N6).
            const adapters = await khoaAdapterTx(tx, [tag0.adapterId, capMoi.adapterId]);
            // R1b-2a T5 (M5) — phạm vi kiểm LẠI trên CẢ adapter cũ (lỗi của adapterCuaTag: deviceTag) LẪN adapter mới (lỗi của adapterTrongPhamVi:
            // adapter), đọc dưới khoá. `tag0` đọc trong giao dịch ⇒ tag đã bị chuyển sang adapter khác sau kiểm-trước cũng bị kiểm đúng adapter ấy.
            kiemPhamViDuoiKhoa(adapters.get(tag0.adapterId)?.machineId, idsMay, khongThay);
            if (capMoi.adapterId !== tag0.adapterId) kiemPhamViDuoiKhoa(adapters.get(capMoi.adapterId)?.machineId, idsMay, khongThayAdapter);
            const luatCu = await khoaLuatNhamCapTx(tx, tag0);
            const nguonCu = await khoaLuatNguonTx(tx, adapters.get(tag0.adapterId)?.machineId, tag0.tagKey);
            const luatMoi = doiDanhTinh ? await khoaLuatNhamCapTx(tx, capMoi) : [];
            const nguonMoi = doiDanhTinh ? await khoaLuatNguonTx(tx, adapters.get(capMoi.adapterId)?.machineId, capMoi.tagKey) : [];
            const [existing] = await tx.select().from(deviceTags).where(eq(deviceTags.id, id)).for("update");
            if (!existing) throw khongThay();
            if (existing.adapterId !== tag0.adapterId || existing.tagKey !== tag0.tagKey) {
              throw appError(
                "CONFLICT",
                "OPERATION_FAILED",
                { operation: "scadaKenhCapNhat", reason: "scadaKenhThuLai" },
                "Tag vừa bị thay đổi đồng thời — tải lại rồi thử lại.",
              );
            }
            const kenhCheDo = await kenhCheDoCuaTagTx(tx, tag0);
            const kenhCheDoMoi = doiDanhTinh ? await kenhCheDoCuaTagTx(tx, capMoi) : [];
            if (doiDanhTinh && (await trungKhoaTagTx(tx, { ...capMoi, boQuaId: id }))) throw loiTrungKhoaTag(); // M3 — trước mã
            // T3C — đổi địa chỉ / khoá / kiểu / writable hoặc chuyển adapter ⇒ kiểm (protocol của adapter ĐÍCH, giá trị SAU sửa); sửa cột khác của tag cũ
            // hỏng (vd tắt) vẫn được.
            if (rest.address !== undefined || doiDanhTinh || rest.dataType !== undefined || rest.writable !== undefined) {
              await kiemDiaChiTagLuuTx(tx, capMoi.adapterId, {
                address: rest.address ?? existing.address,
                tagKey: capMoi.tagKey,
                dataType: rest.dataType ?? existing.dataType,
                writable: rest.writable ?? existing.writable,
              });
            }
            const kq = kiemSuaTag({
              cu: existing,
              patch,
              luatCu,
              nguonCu,
              kenhCheDoCu: kenhCheDo.length > 0,
              luatMoi,
              nguonMoi,
              kenhCheDoMoi: kenhCheDoMoi.length > 0,
            });
            if (kq.canTotp) await kiemTotpCauHinh(ctx, totpCode); // CUỐI — ngay trước lượt ghi

            const nguonGo = lyDoGoStopPinKhiSuaTag(existing, patch);
            if (nguonGo) Object.assign(patch, GO_STOP_PIN_PATCH);
            const [row] = await tx.update(deviceTags).set(patch).where(eq(deviceTags.id, id)).returning();
            if (!row) throw khongThay();
            if (kq.canTotp) {
              // Kênh chế độ đi THEO tag khi đổi tên (cùng một tag vật lý). Chuyển adapter của kênh chế độ đã bị từ chối ở kiemSuaTag.
              if (kq.doi.includes("tagKey")) {
                for (const k of kenhCheDo) {
                  await tx
                    .update(scadaKenhCheDo)
                    .set({ tagKey: row.tagKey, updatedBy: ctx.user.id, updatedAt: new Date() })
                    .where(eq(scadaKenhCheDo.machineId, k.machineId));
                  await recordAuditEvent(tx, {
                    entityType: "scada_kenh_che_do",
                    entityId: k.machineId,
                    action: AUDIT_KENH_CHE_DO_DOI_TAG,
                    actorId: ctx.user.id,
                    before: { adapterId: existing.adapterId, tagKey: existing.tagKey },
                    after: { adapterId: row.adapterId, tagKey: row.tagKey },
                    reason: "deviceAdapter.tags.update: đổi tagKey của kênh chế độ",
                  });
                }
              }
              await recordAuditEvent(tx, {
                entityType: "device_tag",
                entityId: id,
                action: AUDIT_TRO_LAI,
                actorId: ctx.user.id,
                before: anhTroLai(existing),
                after: { ...anhTroLai(kq.sau), doi: kq.doi, khoaMoCoi: kq.moCoi, ...anhNhipAudit(kq) }, // R1b-2a T8 — + nhip {truoc, sau}
                reason: "deviceAdapter.tags.update",
              });
            }
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

    /**
     * SCADA R1b-1 Task 9 fix round 1 (C1) — xoá tag được bảo vệ: kênh chế độ ⇒ từ chối (gỡ kênh chế độ trước); đích luật interlock đang bật ⇒
     * INTERLOCK_MAT_DICH; đã khai + đang ghim DỪNG ⇒ STOP_PIN_GO_TRUOC; đã khai ⇒ TOTP tươi + audit `kenh_da_khai_xoa`. Còn lại như cũ.
     */
    delete: protectedProcedure
      .use(requirePermission("machine_control", "canDelete"))
      .input(z.object({ id: z.number().int().positive(), totpCode: totpCauHinhInput }))
      .mutation(async ({ input, ctx }) => {
        const db = await getDb();
        const idsMay = await idsMayTrongPhamVi(ctx); // R1b-2a T5 — tính TRƯỚC giao dịch, dùng lại dưới khoá
        await adapterCuaTag(ctx, input.id, idsMay); // tag thuộc adapter ngoài phạm vi ≡ không tồn tại
        // doc 81 Đợt 1D Task 1 — xoá tag đang GHIM DỪNG ⇒ audit gỡ ghim trong CÙNG transaction.
        await db.transaction(async (tx) => {
          const khongThay = () => appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "deviceTag" }, "Tag không tồn tại.");
          const [tag0] = await tx.select({ adapterId: deviceTags.adapterId, tagKey: deviceTags.tagKey }).from(deviceTags).where(eq(deviceTags.id, input.id));
          if (!tag0) throw khongThay();
          // Thứ tự khoá ADAPTER → LUẬT (đích + nguồn) → TAG → KÊNH CHẾ ĐỘ (troLaiKenh.ts, N6).
          const khoa = (await khoaAdapterTx(tx, [tag0.adapterId])).get(tag0.adapterId);
          kiemPhamViDuoiKhoa(khoa?.machineId, idsMay, khongThay); // R1b-2a T5 (M5) — phạm vi trên hàng adapter ĐÃ KHOÁ
          const may = khoa?.machineId ?? null;
          const luat = await khoaLuatNhamCapTx(tx, tag0);
          const nguon = await khoaLuatNguonTx(tx, may, tag0.tagKey);
          const [existing] = await tx.select().from(deviceTags).where(eq(deviceTags.id, input.id)).for("update");
          if (!existing) throw khongThay();
          if (existing.adapterId !== tag0.adapterId || existing.tagKey !== tag0.tagKey) {
            throw appError("CONFLICT", "OPERATION_FAILED", { operation: "scadaKenhCapNhat", reason: "scadaKenhThuLai" }, "Tag vừa bị thay đổi đồng thời — tải lại rồi thử lại.");
          }
          const kenhCheDo = await kenhCheDoCuaTagTx(tx, tag0);
          const kx = kiemXoaTag({ cu: existing, luat, nguon, coKenhCheDo: kenhCheDo.length > 0 });
          if (kx.canTotp) await kiemTotpCauHinh(ctx, input.totpCode); // CUỐI — ngay trước lượt ghi
          await tx.delete(deviceTags).where(eq(deviceTags.id, input.id));
          if (kx.canTotp) {
            await recordAuditEvent(tx, {
              entityType: "device_tag",
              entityId: input.id,
              action: AUDIT_XOA_DA_KHAI,
              actorId: ctx.user.id,
              before: {
                ...anhTroLai(existing),
                channelKind: existing.channelKind ?? null,
                actuationLevel: existing.actuationLevel ?? null,
                writeMin: existing.writeMin ?? null,
                writeMax: existing.writeMax ?? null,
                writeStep: existing.writeStep ?? null,
              },
              after: null,
              reason: "deviceAdapter.tags.delete",
            });
          }
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
     *
     * kiem-dinh R1b-1 H1 (a) (điều phối 2026-10-25) — ghim DỪNG là một CỬA GHI: `scadaCommands.dungMay` gửi ghim một bước (mức 1, miễn chế độ /
     * dải / policy / interlock). Trước: chỉ cần canEdit ⇒ operator ghim một tag mức 4/5 với giá trị X rồi bấm DỪNG ⇒ thiết bị nhận X (vượt TOTP,
     * vượt sàn vai, vượt LOCAL). Nay, cho CẢ đặt lẫn gỡ:
     *   1. sàn vai ACTUATION (admin / supervisor / engineer) — kiểm TRƯỚC mọi đọc (`SCADA_ROLE_FLOOR`, không tiêu mã);
     *   2. kiểm hợp lệ của `datStopPin` (phạm vi, tag, writable, kiểu, dải);
     *   3. TOTP TƯƠI mức 5 (`kiemTotpCauHinh` — mã mỗi lượt, không cache, không đọc cờ env) CUỐI, ngay trước lượt ghi.
     * Census: thủ tục gọi `kiemTotpCauHinh` (trpcGioiHanThuTuc.census.test.ts) — miễn nhóm "2fa" có lý do bằng văn bản (2026-10-25).
     * Lớp thứ hai (H1 b): `dungMay` chỉ gửi ghim của tag `actuationLevel ≤ 1` — ghim mức cao bị BỎ QUA và báo trong kết quả.
     */
    setStopPin: protectedProcedure
      .use(requirePermission("machine_control", "canEdit"))
      .input(z.object({
        adapterId: z.number().int().positive(),
        tagKey: z.string().min(1).max(128),
        stopValue: z.unknown(),
        reason: z.string().trim().min(5).max(500),
        totpCode: totpCauHinhInput,
      }))
      .mutation(async ({ input, ctx }) => {
        // H1 (a) 1 — sàn vai TRƯỚC mọi đọc (mã không bị tiêu, không lộ tag tồn tại hay không cho vai dưới sàn).
        if (!(ACTUATION_ROLES as readonly string[]).includes(String(ctx.user?.role))) {
          throw appError("FORBIDDEN", "SCADA_ROLE_FLOOR", { ma: "ROLE_FLOOR", level: 5 }, "Vai trò không được ghim giá trị DỪNG (cần kỹ sư trở lên).");
        }
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
            // H1 (a) 3 — TOTP tươi mức 5, CUỐI (sau kiểm hợp lệ trong giao dịch của datStopPin).
            kiemCuoi: () => kiemTotpCauHinh(ctx, input.totpCode),
          });
        } catch (e) {
          if (e instanceof StopPinLoi) loiStopPin(e);
          throw e;
        }
      }),
  }),
});
