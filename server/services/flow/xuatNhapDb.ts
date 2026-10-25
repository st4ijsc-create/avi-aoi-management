/**
 * Dấu vết nhà máy NGUỒN để quét văn bản tự do lúc XUẤT luồng (`xuatNhap.quetVanBan`): mã máy, tên + mã nhà máy, tên + tên đăng nhập người được gán nhà máy.
 * Chỉ dùng để CẢNH BÁO người xuất (người này đã thuộc phạm vi nhà máy của luồng); kết quả không bao giờ nằm trong tệp gói.
 * Luồng toàn hệ thống (factoryId NULL): chỉ tên + mã mọi nhà máy (không liệt kê máy/người của cả hệ thống).
 */
import { eq, sql } from "drizzle-orm";
import { factories, machines, productionLines, stations, workshops } from "../../../drizzle/schema";
import { getDb } from "../../db/connection";
import type { DauVetNhaMay } from "./xuatNhap";

const TRAN_DAU_VET = 5000;

export async function dauVetNhaMay(factoryId: number | null): Promise<DauVetNhaMay> {
  const db = await getDb();
  if (!db) return { maMay: [], nhaMay: [], nguoi: [], idMay: [] };
  if (factoryId === null) {
    const fs = await db.select({ ten: factories.name, ma: factories.code }).from(factories).limit(TRAN_DAU_VET);
    return { maMay: [], nhaMay: fs.flatMap((f) => [f.ten, f.ma]).filter((x): x is string => !!x), nguoi: [], idMay: [] };
  }
  const [f] = await db.select({ ten: factories.name, ma: factories.code }).from(factories).where(eq(factories.id, factoryId)).limit(1);
  const may = await db
    .select({ id: machines.id, ma: machines.code, ten: machines.name })
    .from(machines)
    .innerJoin(stations, eq(stations.id, machines.stationId))
    .innerJoin(productionLines, eq(productionLines.id, stations.lineId))
    .innerJoin(workshops, eq(workshops.id, productionLines.workshopId))
    .where(eq(workshops.factoryId, factoryId))
    .limit(TRAN_DAU_VET);
  const nguoi = f
    ? ((await db.execute(sql`SELECT u.id AS id, u.name AS ten, u.username AS dn FROM users u JOIN user_factory_assignments a ON a."userId" = u.id WHERE a."factoryCode" = ${f.ma} LIMIT ${TRAN_DAU_VET}`)) as unknown as { id: number; ten: string | null; dn: string | null }[])
    : [];
  return {
    maMay: may.flatMap((m) => [m.ma, m.ten]).filter((x): x is string => !!x),
    nhaMay: [f?.ten, f?.ma].filter((x): x is string => !!x),
    nguoi: nguoi.flatMap((u) => [u.ten, u.dn]).filter((x): x is string => !!x),
    idMay: [factoryId, ...may.map((m) => m.id), ...nguoi.map((u) => Number(u.id))],
  };
}
