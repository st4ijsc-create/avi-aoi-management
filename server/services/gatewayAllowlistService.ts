/**
 * doc 81 Đợt 1C Task 4 — ALLOWLIST THIẾT BỊ của khoá gateway (`IOT_GATEWAY`), bảng
 * `gateway_device_allowlist` (mig 0361).
 *
 * Quyết định chủ dự án 2026-09-27: khoá của máy loại IOT_GATEWAY chỉ được GHI cho các thiết bị nằm
 * trong allowlist của CHÍNH gateway đó, ở cả `/api/ot/ingest` lẫn `/api/v1/ingest/*`. Allowlist RỖNG
 * ⇒ gateway không ghi được gì (fail-closed). Luật kiểm từng mẫu nằm ở `api/v1/ingestRangBuoc.ts`
 * (`kiemMauTelemetryGateway`); tệp này chỉ ĐỌC và THAY allowlist.
 *
 *   • `docThietBiDuocPhep` — đường ingest (nóng): chỉ thiết bị ĐANG HOẠT ĐỘNG; lỗi DB ⇒ ném (nơi gọi
 *     đổi thành 503 — không bao giờ "đoán cho qua").
 *   • `docAllowlist`       — màn quản trị: mọi hàng, kể cả thiết bị đã ngừng (để người sửa thấy).
 *   • `datAllowlist`       — thay TOÀN BỘ list trong MỘT transaction: khoá hàng gateway (`FOR UPDATE`,
 *     tuần tự hoá hai người sửa cùng lúc để ảnh "trước" của audit đúng), xoá + chèn, rồi ghi
 *     `control_audit_log` bằng CHÍNH `tx` ⇒ audit hỏng thì thay đổi rollback (cùng khuôn ILK-10).
 */
import { and, asc, eq, inArray } from "drizzle-orm";
import { getDb } from "../db/connection";
import { DbUnavailableError } from "../_core/dbErrors";
import { machines, gatewayDeviceAllowlist } from "../../drizzle/schema";
import { recordAuditEvent } from "./audit/controlAuditService";

/** Loại máy được coi là GATEWAY (một credential chuyển tiếp nhiều thiết bị). */
export const LOAI_MAY_GATEWAY = "IOT_GATEWAY";

/** Trần số thiết bị trong một allowlist (một lượt `set`). */
export const ALLOWLIST_TOI_DA = 500;

/** entityType / action của dòng control_audit_log (varchar 64 / 48). */
export const AUDIT_ENTITY_ALLOWLIST = "gateway_device_allowlist";
export const AUDIT_ACTION_ALLOWLIST_SET = "allowlist_set";

export interface ThietBiDuocPhep {
  id: number;
  code: string;
}

/** Đường ingest: thiết bị ĐANG HOẠT ĐỘNG trong allowlist của gateway. DB vắng/lỗi ⇒ ném. */
export async function docThietBiDuocPhep(gatewayId: number): Promise<ThietBiDuocPhep[]> {
  const db = await getDb();
  if (!db) throw new DbUnavailableError();
  return db
    .select({ id: machines.id, code: machines.code })
    .from(gatewayDeviceAllowlist)
    .innerJoin(machines, eq(machines.id, gatewayDeviceAllowlist.deviceMachineId))
    .where(and(eq(gatewayDeviceAllowlist.gatewayMachineId, gatewayId), eq(machines.isActive, true)));
}

export interface MucAllowlist {
  id: number;
  code: string;
  name: string;
  machineType: string;
  isActive: boolean;
}

/** Màn quản trị: toàn bộ hàng của gateway (kể cả thiết bị đã ngừng — `isActive=false`). */
export async function docAllowlist(gatewayId: number): Promise<MucAllowlist[]> {
  const db = await getDb();
  if (!db) throw new DbUnavailableError();
  return db
    .select({
      id: machines.id,
      code: machines.code,
      name: machines.name,
      machineType: machines.machineType,
      isActive: machines.isActive,
    })
    .from(gatewayDeviceAllowlist)
    .innerJoin(machines, eq(machines.id, gatewayDeviceAllowlist.deviceMachineId))
    .where(eq(gatewayDeviceAllowlist.gatewayMachineId, gatewayId))
    .orderBy(asc(machines.code));
}

/** Lỗi nghiệp vụ của `datAllowlist` — router đổi sang appError có mã. */
export class AllowlistLoi extends Error {
  constructor(
    readonly loai: "gateway_not_found" | "not_a_gateway" | "device_invalid",
    readonly chiTiet: Record<string, unknown> = {},
  ) {
    super(loai);
    this.name = "AllowlistLoi";
  }
}

export interface KetQuaDatAllowlist {
  gatewayId: number;
  gatewayCode: string;
  truoc: number[];
  sau: number[];
  them: number[];
  bot: number[];
}

/**
 * Thay TOÀN BỘ allowlist của `gatewayId` bằng `deviceIds` (đã khử trùng, sắp tăng). Mọi thiết bị phải
 * tồn tại và đang hoạt động. Gateway phải là máy loại IOT_GATEWAY đang hoạt động. `[]` = làm rỗng
 * (gateway thôi ghi). Audit (control_audit_log) ghi trong CÙNG transaction.
 */
export async function datAllowlist(input: {
  gatewayId: number;
  deviceIds: number[];
  actorId: number | null;
  reason?: string | null;
}): Promise<KetQuaDatAllowlist> {
  const db = await getDb();
  if (!db) throw new DbUnavailableError();
  const sau = Array.from(new Set(input.deviceIds)).sort((a, b) => a - b);

  return db.transaction(async (tx) => {
    const [gw] = await tx
      .select({ id: machines.id, code: machines.code, machineType: machines.machineType, isActive: machines.isActive })
      .from(machines)
      .where(eq(machines.id, input.gatewayId))
      .for("update");
    if (!gw || gw.isActive === false) throw new AllowlistLoi("gateway_not_found", { gatewayId: input.gatewayId });
    if (gw.machineType !== LOAI_MAY_GATEWAY) {
      throw new AllowlistLoi("not_a_gateway", { gatewayId: gw.id, machineType: gw.machineType });
    }

    if (sau.length > 0) {
      const co = await tx
        .select({ id: machines.id })
        .from(machines)
        .where(and(inArray(machines.id, sau), eq(machines.isActive, true)));
      const coSet = new Set(co.map((r) => r.id));
      const thieu = sau.filter((id) => !coSet.has(id));
      if (thieu.length > 0) throw new AllowlistLoi("device_invalid", { deviceIds: thieu });
    }

    const truoc = (
      await tx
        .select({ id: gatewayDeviceAllowlist.deviceMachineId })
        .from(gatewayDeviceAllowlist)
        .where(eq(gatewayDeviceAllowlist.gatewayMachineId, gw.id))
    )
      .map((r) => r.id)
      .sort((a, b) => a - b);

    const sauSet = new Set(sau);
    const truocSet = new Set(truoc);
    const bot = truoc.filter((id) => !sauSet.has(id));
    const them = sau.filter((id) => !truocSet.has(id));

    if (bot.length > 0) {
      await tx
        .delete(gatewayDeviceAllowlist)
        .where(and(eq(gatewayDeviceAllowlist.gatewayMachineId, gw.id), inArray(gatewayDeviceAllowlist.deviceMachineId, bot)));
    }
    if (them.length > 0) {
      await tx
        .insert(gatewayDeviceAllowlist)
        .values(them.map((d) => ({ gatewayMachineId: gw.id, deviceMachineId: d, addedBy: input.actorId })));
    }

    // Audit bất biến trong CÙNG transaction — ném ⇒ rollback cả thay đổi (không có thay đổi "lặng").
    await recordAuditEvent(tx, {
      entityType: AUDIT_ENTITY_ALLOWLIST,
      entityId: gw.id,
      action: AUDIT_ACTION_ALLOWLIST_SET,
      actorId: input.actorId,
      before: { gatewayCode: gw.code, deviceIds: truoc },
      after: { gatewayCode: gw.code, deviceIds: sau, added: them, removed: bot },
      reason: input.reason ?? null,
    });

    return { gatewayId: gw.id, gatewayCode: gw.code, truoc, sau, them, bot };
  });
}
