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

    const details: Record<string, unknown> = {
      operation: AUDIT_LOG_ACTION_MQTT_BIND,
      before,
      after,
      metadata: { reason: input.reason },
      source: "web",
      timestamp: new Date().toISOString(),
    };
    // Cùng khuôn logCrudOperation (hash nội dung khi SEC_PLATFORM), nhưng ghi bằng `tx` và KHÔNG nuốt lỗi.
    if (secPlatformEnabled()) {
      const hashTs = Date.now();
      details.hashTs = hashTs;
      details.contentHash = computeCrudContentHash(
        {
          userId: input.nguoiSua.id,
          action: AUDIT_LOG_ACTION_MQTT_BIND,
          entityType: "mqtt_client",
          entityId: tb.id,
          entityName: tb.deviceId,
          details,
        },
        hashTs,
      );
    }
    await tx.insert(auditLogs).values(
      catTheoTranCot(auditLogs, {
        userId: input.nguoiSua.id ?? null,
        userName: input.nguoiSua.name ?? null,
        action: AUDIT_LOG_ACTION_MQTT_BIND,
        entityType: "mqtt_client",
        entityId: tb.id,
        entityName: tb.deviceId,
        details: JSON.stringify(details),
        ipAddress: input.nguoiSua.ipAddress ?? null,
        userAgent: input.nguoiSua.userAgent ?? null,
        status: "success" as const,
      }),
    );

    return { clientId: tb.id, deviceId: tb.deviceId, truoc, sau, changed: true };
  });
}
