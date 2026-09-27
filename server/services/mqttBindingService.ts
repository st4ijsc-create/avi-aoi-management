/**
 * doc 81 Đợt 1C Task 5b — GẮN thiết bị MQTT với MÁY (`mqtt_clients."machineId"`, mig 0292).
 *
 * Task 5 khoá dữ liệu MQTT vào máy mà thiết bị được gắn (publish/subscribe dưới `factory/…`, `syn/…`,
 * cầu telemetry). Trước bản này KHÔNG có đường nào trong ứng dụng đặt cột ấy — chỉ SQL tay — nên không
 * thiết bị nào ghi được sensor qua MQTT. Tệp này là đường DUY NHẤT đặt/gỡ ràng buộc.
 *
 * `ganMayChoThietBi` chạy trong MỘT transaction:
 *   1. khoá hàng `mqtt_clients` (`SELECT … FOR UPDATE`) — hai người gắn cùng lúc được TUẦN TỰ HOÁ, ảnh
 *      "trước" của audit luôn là giá trị thật ngay trước lượt ghi;
 *   2. thiết bị phải đang hoạt động và trong phạm vi người sửa (trạm của nó ∈ phạm vi — cùng cổng
 *      `getMqttClients`); máy đang gắn (nếu có) cũng phải trong phạm vi (không lặng lẽ gỡ một ràng buộc
 *      người sửa không được thấy);
 *   3. GẮN (machineId ≠ null): thiết bị KHÔNG được REJECTED và PHẢI có `passwordHash` (thiết bị không
 *      mật khẩu vào broker chỉ bằng username — đoán được ⇒ gắn nó vào máy là trao quyền ghi dữ liệu của
 *      máy cho bất kỳ ai biết username); máy đích trong phạm vi, đang hoạt động (`isActive`, vòng đời
 *      không phải decommissioned/retired), có chuỗi trạm → chuyền → xưởng → nhà máy. GỠ (null) luôn
 *      được phép (thu hẹp quyền);
 *   4. ghi `machineId`;
 *   5. `control_audit_log` (trước/sau/lý do/người sửa) VÀ `audit_logs` bằng CHÍNH `tx` — audit hỏng ⇒
 *      ràng buộc không đổi.
 * Không đổi gì (cùng máy) ⇒ không ghi, không audit (`changed: false`).
 * Ngắt phiên MQTT sống (để ràng buộc có hiệu lực ngay) là việc của router SAU khi commit.
 */
import { and, eq, notInArray } from "drizzle-orm";
import { getDb } from "../db/connection";
import { DbUnavailableError } from "../_core/dbErrors";
import { auditLogs, machines, mqttClients, productionLines, stations, workshops } from "../../drizzle/schema";
import { catTheoTranCot } from "../db/catTheoTranCot";
import { recordAuditEvent } from "./audit/controlAuditService";
import { computeCrudContentHash } from "./auditTrailService";
import { secPlatformEnabled } from "./security/policyGate";

/** entityType / action của dòng control_audit_log (varchar 64 / 48). */
export const AUDIT_ENTITY_MQTT_BINDING = "mqtt_client_machine_binding";
export const AUDIT_ACTION_MQTT_BIND = "mqtt_machine_bind";
export const AUDIT_ACTION_MQTT_UNBIND = "mqtt_machine_unbind";
/** action của dòng audit_logs (màn Nhật ký). */
export const AUDIT_LOG_ACTION_MQTT_BIND = "mqttClient.bindMachine";

/** Vòng đời máy KHÔNG được gắn thiết bị mới. */
const VONG_DOI_KHONG_GAN = ["decommissioned", "retired"] as const;

export class GanMayLoi extends Error {
  constructor(
    readonly loai:
      | "device_not_found"
      | "device_rejected"
      | "device_no_credential"
      | "bound_machine_out_of_scope"
      | "machine_not_found"
      | "machine_not_bindable",
    readonly chiTiet: Record<string, unknown> = {},
  ) {
    super(loai);
    this.name = "GanMayLoi";
  }
}

export interface NguoiSua {
  id: number | null;
  name?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface KetQuaGanMay {
  clientId: number;
  deviceId: string;
  truoc: number | null;
  sau: number | null;
  changed: boolean;
}

export async function ganMayChoThietBi(input: {
  clientId: number;
  machineId: number | null;
  reason: string;
  nguoiSua: NguoiSua;
  /** Trạm trong phạm vi người sửa (`idsTrongPhamVi("station")`); null = không lọc. */
  phamViTram: ReadonlyArray<number> | null;
  /** Máy trong phạm vi người sửa (`idsTrongPhamVi("machine")`); null = không lọc. */
  phamViMay: ReadonlyArray<number> | null;
}): Promise<KetQuaGanMay> {
  const db = await getDb();
  if (!db) throw new DbUnavailableError();
  const tramOk = (id: number | null) => input.phamViTram === null || (id != null && input.phamViTram.includes(id));
  const mayOk = (id: number) => input.phamViMay === null || input.phamViMay.includes(id);

  return db.transaction(async (tx) => {
    const [tb] = await tx
      .select({
        id: mqttClients.id,
        deviceId: mqttClients.deviceId,
        stationId: mqttClients.stationId,
        machineId: mqttClients.machineId,
        approvalStatus: mqttClients.approvalStatus,
        passwordHash: mqttClients.passwordHash,
        isActive: mqttClients.isActive,
      })
      .from(mqttClients)
      .where(eq(mqttClients.id, input.clientId))
      .for("update");
    // Không có / đã xoá mềm / ngoài phạm vi ⇒ cùng một câu (không phân biệt "không có" với "không được thấy").
    if (!tb || !tb.isActive || !tramOk(tb.stationId)) throw new GanMayLoi("device_not_found", { clientId: input.clientId });
    if (tb.machineId != null && !mayOk(tb.machineId)) {
      throw new GanMayLoi("bound_machine_out_of_scope", { clientId: tb.id });
    }

    const truoc = tb.machineId ?? null;
    if (truoc === input.machineId) {
      return { clientId: tb.id, deviceId: tb.deviceId, truoc, sau: truoc, changed: false };
    }

    let mayMoi: { id: number; code: string; factoryId: number } | null = null;
    if (input.machineId != null) {
      if (tb.approvalStatus === "REJECTED") throw new GanMayLoi("device_rejected", { clientId: tb.id });
      if (!tb.passwordHash) throw new GanMayLoi("device_no_credential", { clientId: tb.id });
      if (!mayOk(input.machineId)) throw new GanMayLoi("machine_not_found", { machineId: input.machineId });
      const [m] = await tx
        .select({ id: machines.id, code: machines.code, factoryId: workshops.factoryId })
        .from(machines)
        .innerJoin(stations, eq(stations.id, machines.stationId))
        .innerJoin(productionLines, eq(productionLines.id, stations.lineId))
        .innerJoin(workshops, eq(workshops.id, productionLines.workshopId))
        .where(
          and(
            eq(machines.id, input.machineId),
            eq(machines.isActive, true),
            notInArray(machines.lifecycleStatus, [...VONG_DOI_KHONG_GAN]),
          ),
        )
        // Giữ máy khỏi bị ngừng/xoá giữa lúc kiểm và lúc commit ràng buộc.
        .for("share", { of: machines });
      if (!m) throw new GanMayLoi("machine_not_bindable", { machineId: input.machineId });
      mayMoi = { id: m.id, code: m.code, factoryId: Number(m.factoryId) };
    }

    const sau = mayMoi?.id ?? null;
    await tx.update(mqttClients).set({ machineId: sau, updatedAt: new Date() }).where(eq(mqttClients.id, tb.id));

    const before = { deviceId: tb.deviceId, machineId: truoc };
    const after = { deviceId: tb.deviceId, machineId: sau, machineCode: mayMoi?.code ?? null, factoryId: mayMoi?.factoryId ?? null };
    // Audit bất biến trong CÙNG transaction — ném ⇒ rollback cả ràng buộc.
    await recordAuditEvent(tx, {
      entityType: AUDIT_ENTITY_MQTT_BINDING,
      entityId: tb.id,
      action: sau == null ? AUDIT_ACTION_MQTT_UNBIND : AUDIT_ACTION_MQTT_BIND,
      actorId: input.nguoiSua.id,
      before,
      after,
      reason: input.reason,
    });

    await ghiAuditLogTx(tx, {
      action: AUDIT_LOG_ACTION_MQTT_BIND,
      nguoiSua: input.nguoiSua,
      clientId: tb.id,
      deviceId: tb.deviceId,
      before,
      after,
      reason: input.reason,
    });

    return { clientId: tb.id, deviceId: tb.deviceId, truoc, sau, changed: true };
  });
}

type Tx = Parameters<Parameters<NonNullable<Awaited<ReturnType<typeof getDb>>>["transaction"]>[0]>[0];

/**
 * Một dòng `audit_logs` (màn Nhật ký) ghi bằng CHÍNH `tx` và KHÔNG nuốt lỗi — cùng khuôn
 * `logCrudOperation` (hash nội dung khi SEC_PLATFORM). Người gọi chịu trách nhiệm KHÔNG đưa bí mật
 * nào vào `before`/`after`.
 */
async function ghiAuditLogTx(
  tx: Tx,
  e: { action: string; nguoiSua: NguoiSua; clientId: number; deviceId: string; before: unknown; after: unknown; reason: string },
): Promise<void> {
  const details: Record<string, unknown> = {
    operation: e.action,
    before: e.before,
    after: e.after,
    metadata: { reason: e.reason },
    source: "web",
    timestamp: new Date().toISOString(),
  };
  if (secPlatformEnabled()) {
    const hashTs = Date.now();
    details.hashTs = hashTs;
    details.contentHash = computeCrudContentHash(
      { userId: e.nguoiSua.id, action: e.action, entityType: "mqtt_client", entityId: e.clientId, entityName: e.deviceId, details },
      hashTs,
    );
  }
  await tx.insert(auditLogs).values(
    catTheoTranCot(auditLogs, {
      userId: e.nguoiSua.id ?? null,
      userName: e.nguoiSua.name ?? null,
      action: e.action,
      entityType: "mqtt_client",
      entityId: e.clientId,
      entityName: e.deviceId,
      details: JSON.stringify(details),
      ipAddress: e.nguoiSua.ipAddress ?? null,
      userAgent: e.nguoiSua.userAgent ?? null,
      status: "success" as const,
    }),
  );
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// doc 81 Đợt 1C Task 5b fix round 1 — CẤP / XOAY mật khẩu MQTT của thiết bị.
//
// Trước bản này không có đường nào đặt `passwordHash` ⇒ luật "gắn máy cần passwordHash" làm KHÔNG thiết
// bị nào gắn được. `xoayMatKhauThietBi` sinh một mật khẩu ngẫu nhiên (`randomBytes(24)` base64url, 192
// bit), lưu bcrypt vào `passwordHash`, XOÁ cột `password` (dạng thô cũ), ghi audit {hadCredential} →
// {hasCredential} — KHÔNG BAO GIỜ ghi bí mật — và trả bản thô DUY NHẤT một lần cho router (router trả
// cho người gọi, không log, không cache). Thiết bị bị khoá ngoài cho tới khi được cấu hình mật khẩu mới.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
export const AUDIT_ACTION_MQTT_PASSWORD_ROTATE = "mqtt_password_rotate";
export const AUDIT_LOG_ACTION_MQTT_ROTATE = "mqttClient.rotatePassword";
/** Chi phí bcrypt — cùng mức `verifyMqttDevicePassword` dùng khi nâng cấp mật khẩu thô. */
const BCRYPT_COST = 10;

export async function xoayMatKhauThietBi(input: {
  clientId: number;
  reason: string;
  nguoiSua: NguoiSua;
  phamViTram: ReadonlyArray<number> | null;
  phamViMay: ReadonlyArray<number> | null;
}): Promise<{ clientId: number; deviceId: string; password: string }> {
  const db = await getDb();
  if (!db) throw new DbUnavailableError();
  const tramOk = (id: number | null) => input.phamViTram === null || (id != null && input.phamViTram.includes(id));
  const mayOk = (id: number) => input.phamViMay === null || input.phamViMay.includes(id);
  const { randomBytes } = await import("node:crypto");
  const bcrypt = (await import("bcryptjs")).default;
  const matKhau = randomBytes(24).toString("base64url");
  const bam = await bcrypt.hash(matKhau, BCRYPT_COST);

  const kq = await db.transaction(async (tx) => {
    const [tb] = await tx
      .select({
        id: mqttClients.id,
        deviceId: mqttClients.deviceId,
        stationId: mqttClients.stationId,
        machineId: mqttClients.machineId,
        approvalStatus: mqttClients.approvalStatus,
        passwordHash: mqttClients.passwordHash,
        password: mqttClients.password,
        isActive: mqttClients.isActive,
      })
      .from(mqttClients)
      .where(eq(mqttClients.id, input.clientId))
      .for("update");
    if (!tb || !tb.isActive || !tramOk(tb.stationId)) throw new GanMayLoi("device_not_found", { clientId: input.clientId });
    // Thiết bị đang gắn máy NGOÀI phạm vi: đổi credential của nó là đổi đường dữ liệu của máy ấy.
    if (tb.machineId != null && !mayOk(tb.machineId)) throw new GanMayLoi("bound_machine_out_of_scope", { clientId: tb.id });
    if (tb.approvalStatus === "REJECTED") throw new GanMayLoi("device_rejected", { clientId: tb.id });

    const hadCredential = Boolean(tb.passwordHash || tb.password);
    await tx.update(mqttClients).set({ passwordHash: bam, password: null, updatedAt: new Date() }).where(eq(mqttClients.id, tb.id));
    const before = { deviceId: tb.deviceId, hadCredential };
    const after = { deviceId: tb.deviceId, hasCredential: true };
    await recordAuditEvent(tx, {
      entityType: AUDIT_ENTITY_MQTT_BINDING,
      entityId: tb.id,
      action: AUDIT_ACTION_MQTT_PASSWORD_ROTATE,
      actorId: input.nguoiSua.id,
      before,
      after,
      reason: input.reason,
    });
    await ghiAuditLogTx(tx, {
      action: AUDIT_LOG_ACTION_MQTT_ROTATE,
      nguoiSua: input.nguoiSua,
      clientId: tb.id,
      deviceId: tb.deviceId,
      before,
      after,
      reason: input.reason,
    });
    return { clientId: tb.id, deviceId: tb.deviceId };
  });
  return { ...kq, password: matKhau };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// doc 81 Đợt 1C Task 5b fix round 1 (#4) — NGỪNG thiết bị (xoá mềm / isActive=false) GỠ luôn ràng buộc máy.
//
// Chọn "gỡ khi ngừng" thay vì "cho phép gỡ thiết bị đã ngừng": một thiết bị đã xoá mềm nối lại sẽ được tự
// đăng ký lại thành PENDING (khi MQTT_AUTO_REGISTER_UNKNOWN bật) — nếu hàng còn giữ `machineId` thì phiên
// hồi sinh THỪA KẾ quyền ghi dữ liệu của máy mà không ai gắn lại. Gỡ ngay lúc ngừng (cùng transaction,
// có audit) đóng đường đó; hàng CŨ đã ngừng từ trước bản này được chặn thêm ở `authenticate` (phiên của
// hàng vừa được kích hoạt lại không nhận ràng buộc).
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
export async function ngungThietBi(input: {
  clientId: number;
  nguoiSua: NguoiSua;
  /** Lý do ghi audit (vd "device soft-deleted"). */
  reason: string;
}): Promise<{ deviceId: string | null; goMay: number | null }> {
  const db = await getDb();
  if (!db) throw new DbUnavailableError();
  return db.transaction(async (tx) => {
    const [tb] = await tx
      .select({ id: mqttClients.id, deviceId: mqttClients.deviceId, machineId: mqttClients.machineId })
      .from(mqttClients)
      .where(eq(mqttClients.id, input.clientId))
      .for("update");
    if (!tb) return { deviceId: null, goMay: null };
    await tx.update(mqttClients).set({ isActive: false, machineId: null, updatedAt: new Date() }).where(eq(mqttClients.id, tb.id));
    if (tb.machineId == null) return { deviceId: tb.deviceId, goMay: null };
    const before = { deviceId: tb.deviceId, machineId: tb.machineId };
    const after = { deviceId: tb.deviceId, machineId: null, machineCode: null, factoryId: null };
    await recordAuditEvent(tx, {
      entityType: AUDIT_ENTITY_MQTT_BINDING,
      entityId: tb.id,
      action: AUDIT_ACTION_MQTT_UNBIND,
      actorId: input.nguoiSua.id,
      before,
      after,
      reason: input.reason,
    });
    await ghiAuditLogTx(tx, {
      action: AUDIT_LOG_ACTION_MQTT_BIND,
      nguoiSua: input.nguoiSua,
      clientId: tb.id,
      deviceId: tb.deviceId,
      before,
      after,
      reason: input.reason,
    });
    return { deviceId: tb.deviceId, goMay: tb.machineId };
  });
}
