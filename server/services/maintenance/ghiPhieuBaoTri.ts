/**
 * ★ MỘT điểm ghi `maintenance_work_orders` cho đường NGƯỜI DÙNG (tRPC `maintenance.createWorkOrder`) và đường LUỒNG AI (node `bao-tri.tao-phieu`, lô Luồng-A).
 * KHÔNG kiểm phạm vi / quyền ở đây: người gọi PHẢI đã kiểm (`trongPhamVi("machine", id, phamVi)` + `requirePermission(machine_monitoring, canCreate)` với router;
 * `BoKiemPhamVi.may` + `checkPermission` của CHỦ LƯỢT lúc chạy với node). Tách ra để hai đường không lệch nhau về cột được ghi.
 */
import { eq } from "drizzle-orm";
import { machines, maintenanceWorkOrders } from "../../../drizzle/schema";
import type { getDb } from "../../db/connection";

export const LOAI_PHIEU = ["PREVENTIVE", "PREDICTIVE", "CORRECTIVE", "BREAKDOWN", "INSPECTION"] as const;
export const TRANG_THAI_PHIEU = ["OPEN", "SCHEDULED", "IN_PROGRESS", "ON_HOLD", "COMPLETED", "CANCELLED"] as const;

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

export interface DauVaoPhieu {
  machineId: number;
  title: string;
  description?: string | null;
  type: (typeof LOAI_PHIEU)[number];
  priority: number;
  assignedTo?: number | null;
  status: (typeof TRANG_THAI_PHIEU)[number];
  scheduledFor?: Date | null;
}

/** Số phiếu khó trùng (WO-<máy>-<ts>-<rand>). */
export function buildWorkOrderNumber(machineId: number): string {
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `WO-${machineId}-${Date.now()}-${rand}`;
}

export async function ghiPhieuBaoTri(db: Db, input: DauVaoPhieu) {
  const [machine] = await db.select({ code: machines.code }).from(machines).where(eq(machines.id, input.machineId)).limit(1);
  const [row] = await db
    .insert(maintenanceWorkOrders)
    .values({
      workOrderNumber: buildWorkOrderNumber(input.machineId),
      machineId: input.machineId,
      machineCode: machine?.code ?? null,
      type: input.type,
      status: input.status,
      trigger: "MANUAL",
      priority: input.priority,
      title: input.title,
      description: input.description ?? null,
      assignedTo: input.assignedTo ?? null,
      scheduledFor: input.scheduledFor ?? null,
    } as never)
    .returning();
  return row;
}
