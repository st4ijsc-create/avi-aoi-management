/**
 * Mầm CSDL THẬT dùng chung cho các test phạm vi nhà máy của dữ liệu ĐO / chất lượng (lô L6a, 2026-10-25): hai nhà máy A, B có đủ chuỗi
 * nhà máy → xưởng → chuyền → trạm → máy, mỗi nhà máy một lần kiểm NG (+ một kết quả đo NG) trên CÙNG một mẫu sản phẩm; người dùng A (gán nhà máy A), admin,
 * và người KHÔNG gán nhà máy nào. Chỉ dùng trong test (CSDL `_test`, dọn bằng chủ `aoi`).
 */
import { sql } from "drizzle-orm";
import { getDb } from "../db/connection";
import { taoNguoiDungTest } from "./nguoiDungTest";

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;
export interface NhaMayDo {
  fid: number;
  wid: number;
  lid: number;
  sid: number;
  mid: number;
  code: string;
  insp: number;
  serial: string;
  mr: number;
  userId: number;
}
export interface HaiNhaMayDo {
  RUN: string;
  A: NhaMayDo;
  B: NhaMayDo;
  modelId: number;
  pointId: number;
  uA: { id: number; role: string; name: string };
  uAdmin: { id: number; role: string; name: string };
  uRong: { id: number; role: string; name: string };
  dung: (q: ReturnType<typeof sql>) => Promise<any[]>;
  don: () => Promise<void>;
}

export async function qChuTest(q: string): Promise<void> {
  const { default: postgres } = await import("postgres");
  const u = new URL(process.env.DATABASE_URL!);
  if (!/_test$/.test(u.pathname.replace(/^\//, ""))) throw new Error("từ chối: không phải CSDL _test");
  u.username = "aoi";
  u.password = "aoi";
  const chu = postgres(u.toString(), { max: 1, onnotice: () => {} });
  try { await chu.unsafe(q); } finally { await chu.end({ timeout: 5 }); }
}

export async function seedHaiNhaMayDo(RUN: string, tienTo: string, quyen: Array<[string, string]> = []): Promise<HaiNhaMayDo> {
  const db = (await getDb()) as Db | null;
  if (!db) throw new Error("không có CSDL test");
  const dung = async (q: ReturnType<typeof sql>): Promise<any[]> => (await db.execute(q)) as unknown as any[];
  const [pm] = await dung(sql`INSERT INTO product_models (code, name) VALUES (${RUN + "-PM"}, ${RUN}) RETURNING id`);
  const [pd] = await dung(sql`INSERT INTO measurement_point_defs ("productModelId", code, name, "measurementType", "positionX", "positionY") VALUES (${pm.id}, ${RUN + "-P"}, ${RUN + "-P"}, 'VISUAL', 1, 1) RETURNING id`);
  const uids: number[] = [];
  const seed = async (ten: string): Promise<NhaMayDo> => {
    const code = `${RUN}${ten}`;
    const [f] = await dung(sql`INSERT INTO factories (code, name) VALUES (${code}, ${code}) RETURNING id`);
    const [w] = await dung(sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${f.id}, ${code}, ${code}) RETURNING id`);
    const [l] = await dung(sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${w.id}, ${code}, ${code}) RETURNING id`);
    const [s] = await dung(sql`INSERT INTO stations ("lineId", code, name) VALUES (${l.id}, ${code}, ${code}) RETURNING id`);
    const [m] = await dung(sql`INSERT INTO machines ("stationId", code, name, "machineType") VALUES (${s.id}, ${code}, ${code}, 'AOI') RETURNING id`);
    const u = await taoNguoiDungTest(ten.toLowerCase(), "supervisor", { tienTo, ts: RUN, ten: `${tienTo} ${ten}` });
    uids.push(u.id);
    await dung(sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${u.id}, ${code})`);
    const serial = `${code}-SN`;
    const [i] = await dung(sql`INSERT INTO product_inspections ("machineId", "productModelId", "serialNumber", "overallResult", "originalResult", "inspectionTime", "factoryCode")
      VALUES (${m.id}, ${pm.id}, ${serial}, 'NG', 'NG', now(), ${code}) RETURNING id`);
    const [r] = await dung(sql`INSERT INTO measurement_results ("inspectionId", "pointDefId", result) VALUES (${i.id}, ${pd.id}, 'NG') RETURNING id`);
    return { fid: f.id, wid: w.id, lid: l.id, sid: s.id, mid: m.id, code, insp: i.id, serial, mr: r.id, userId: u.id };
  };
  const A = await seed("A");
  const B = await seed("B");
  const ad = await taoNguoiDungTest("ad", "admin", { tienTo, ts: RUN, ten: `${tienTo} ad` });
  const ur = await taoNguoiDungTest("ur", "supervisor", { tienTo, ts: RUN, ten: `${tienTo} ur` });
  uids.push(ad.id, ur.id);
  for (const uid of [A.userId, B.userId, ur.id]) {
    for (const [cat, mod] of quyen) {
      await dung(sql`INSERT INTO permissions ("userId", category, "moduleName", "canView", "canCreate", "canEdit", "canDelete") VALUES (${uid}, ${cat}::permissioncategoryenum, ${mod}, true, true, true, true)`);
    }
  }
  const don = async () => {
    const like = `'${RUN.replace(/'/g, "''")}%'`;
    const stmts = [
      `DELETE FROM measurement_results WHERE "inspectionId" IN (SELECT id FROM product_inspections WHERE "serialNumber" LIKE ${like})`,
      `DELETE FROM product_inspections WHERE "serialNumber" LIKE ${like}`,
      `DELETE FROM measurement_point_defs WHERE code LIKE ${like}`,
      `DELETE FROM product_models WHERE code LIKE ${like}`,
      `DELETE FROM user_factory_assignments WHERE "factoryCode" LIKE ${like}`,
      ...["machines", "stations", "production_lines", "workshops", "factories"].map((t) => `DELETE FROM ${t} WHERE code LIKE ${like}`),
    ];
    for (const s of stmts) { try { await qChuTest(s); } catch { /* dọn best-effort */ } }
  };
  return {
    RUN, A, B, modelId: pm.id, pointId: pd.id,
    uA: { id: A.userId, role: "supervisor", name: `${tienTo} A` },
    uAdmin: { id: ad.id, role: "admin", name: `${tienTo} ad` },
    uRong: { id: ur.id, role: "supervisor", name: `${tienTo} ur` },
    dung, don,
  };
}
