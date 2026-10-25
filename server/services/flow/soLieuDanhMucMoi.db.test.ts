/**
 * ★★★ Lô Luồng-danh-mục (2026-10-25) — 4 truy vấn mới của `du-lieu.so-lieu` trên `_test` với ĐỘNG CƠ THẬT, hai nhà máy A/B, số biết trước:
 *   dung-may.tong-hop · phieu-bao-tri.dang-mo · phieu-bao-tri.dong-gan-day (thời gian MỞ→ĐÓNG, không phải MTTR chuẩn; loại phiếu thiếu/ngược thời điểm) · ton-kho.sap-het (mức W16).
 *   (a) số khớp số gieo; (b) 0 dòng nhà máy B lọt vào luồng A (chủ thấy cả hai, luồng toàn-hệ-thống); hàng kho chưa gán nhà máy KHÔNG lộ cho chủ chỉ thuộc A; chủ mất gán ⇒ lỗi.
 */
import { vi } from "vitest";
vi.hoisted(() => {
  process.env.LICENSE_MODULE_GATE_ENABLED = "false";
});
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray, like, sql } from "drizzle-orm";
import { getDb } from "../../db/connection";
import { aiFlowRuns, aiFlowSteps, aiFlows } from "../../../drizzle/schema";
import { qChuTest } from "../../testing/__haiNhaMayDoLuong";
import { taoNguoiDungTest } from "../../testing/nguoiDungTest";
import { batDauRun, chayMotMuc, luuPhienBan } from "./dongCo";

const RUN = `dm_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
const TT = `t5dm${Math.floor(Math.random() * 1e5)}`;
const FAC_A = `DMA_${RUN}`.slice(0, 50);
const FAC_B = `DMB_${RUN}`.slice(0, 50);
const nut = (id: string, type: string, parameters: Record<string, unknown> = {}) => ({ id, type, typeVersion: 1, name: id, position: [0, 0] as [number, number], parameters });
const noi = (a: string, b: string) => ({ from: { node: a, port: "main" }, to: { node: b, port: "main" } });

const ids = { facA: 0, facB: 0, machA: 0, machB: 0 };
const cay: { ws: number[]; ln: number[]; st: number[] } = { ws: [], ln: [], st: [] };
const u = { A: 0, nhieu: 0, admin: 0, mat: 0 };
let db: NonNullable<Awaited<ReturnType<typeof getDb>>>;
const PT = (s: string) => `${RUN}-${s}`;
/** Mốc thời gian TRONG SQL (`now() − phút`) — cùng đồng hồ/múi giờ với `now()` mà truy vấn dùng. */
const truoc = (phut: number) => sql`(now() - (${Math.round(phut)}::int * interval '1 minute'))`;
const gioTruoc = (h: number) => truoc(h * 60);

async function mkUser(tag: string, role: "engineer" | "admin", factories: string[]) {
  const r = await taoNguoiDungTest(tag, role, { tienTo: "dm", ten: `DM ${tag}`, ts: RUN });
  for (const f of factories) await db.execute(sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${r.id}, ${f})`);
  return r.id;
}
const luongSo = (id: string, truyVan: string, extra: Record<string, unknown> = {}) => ({
  id, name: "so lieu", version: 1, settings: { maxConcurrentRuns: 100 },
  nodes: [nut("t", "kich-hoat.thu-cong"), nut("s", "du-lieu.so-lieu", { truyVan, gio: 24, gioiHan: 10, ...extra })],
  connections: [noi("t", "s")],
});
const chayHet = async () => {
  for (let i = 0; i < 300 && (await chayMotMuc("w-dm", undefined, TT)); i++);
};
async function chay(flowId: string, chu: number | null) {
  const v = (await db.execute(sql`SELECT max(version)::int AS v FROM ai_flow_versions WHERE "flowId" = ${flowId}`)) as unknown as { v: number }[];
  const r = await batDauRun({ flowId, version: v[0].v, chuLuong: chu, items: [{ json: {} }] });
  await chayHet();
  const [run] = await db.select().from(aiFlowRuns).where(eq(aiFlowRuns.id, r));
  const [s] = await db.select().from(aiFlowSteps).where(and(eq(aiFlowSteps.runId, r), eq(aiFlowSteps.nodeId, "s")));
  const out = (s?.output as { main?: Array<{ json: { so?: { tong: Record<string, number>; dong: Array<Record<string, unknown>> } } }> } | null)?.main?.[0]?.json?.so;
  return { status: run.status, so: out, loi: s?.error as { ma?: string } | null | undefined };
}
const luong = async (ten: string, truyVan: string, nhaMay: number | null, extra: Record<string, unknown> = {}) => {
  const id = `${TT}-${ten}`;
  await luuPhienBan(luongSo(id, truyVan, { truongRa: "so", ...extra }), u.admin, nhaMay);
  return id;
};

beforeAll(async () => {
  db = (await getDb())!;
  const one = async (q: Promise<unknown>) => Number(((await q) as { id: number }[])[0].id);
  ids.facA = await one(db.execute(sql`INSERT INTO factories (code, name, "isActive") VALUES (${FAC_A}, ${"DM " + FAC_A}, true) RETURNING id`));
  ids.facB = await one(db.execute(sql`INSERT INTO factories (code, name, "isActive") VALUES (${FAC_B}, ${"DM " + FAC_B}, true) RETURNING id`));
  for (const [k, fac, code] of [["A", ids.facA, FAC_A], ["B", ids.facB, FAC_B]] as const) {
    const ws = await one(db.execute(sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${fac}, ${code + "_WS"}, ${"ws" + k}) RETURNING id`));
    const ln = await one(db.execute(sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${ws}, ${code + "_L1"}, ${"line" + k}) RETURNING id`));
    const st = await one(db.execute(sql`INSERT INTO stations ("lineId", code, name) VALUES (${ln}, ${code + "_S1"}, ${"st" + k}) RETURNING id`));
    cay.ws.push(ws);
    cay.ln.push(ln);
    cay.st.push(st);
    const m = await one(db.execute(sql`INSERT INTO machines ("stationId", code, name, "machineType", "isActive") VALUES (${st}, ${code + "_M1"}, ${"mach" + k}, ${"AOI"}, true) RETURNING id`));
    if (k === "A") ids.machA = m;
    else ids.machB = m;
  }
  const dt = (m: number, code: string, cat: string, hTruoc: number, phut: number | null) =>
    db.execute(sql`INSERT INTO downtime_events ("machineId", "machineCode", category, reason, "startTime", "endTime", duration)
      VALUES (${m}, ${code}, ${cat}::categoryenum, ${PT("ly-do")}, ${gioTruoc(hTruoc)}, ${phut === null ? null : sql`(${gioTruoc(hTruoc)} + (${phut}::int * interval '1 minute'))`}, ${phut})`);
  // A: 3 lần trong 24h (breakdown 30 + breakdown 20 + planned đang dừng), 1 lần NGOÀI cửa sổ (30h) ; B: 2 lần khác hẳn
  await dt(ids.machA, `${FAC_A}_M1`, "breakdown", 2, 30);
  await dt(ids.machA, `${FAC_A}_M1`, "breakdown", 5, 20);
  await dt(ids.machA, `${FAC_A}_M1`, "planned", 1, null);
  await dt(ids.machA, `${FAC_A}_M1`, "breakdown", 30, 999);
  await dt(ids.machB, `${FAC_B}_M1`, "unplanned", 3, 400);
  await dt(ids.machB, `${FAC_B}_M1`, "unplanned", 4, 100);
  /** `moPhutTruoc` / `dongPhutTruoc`: số phút TRƯỚC `now()` (đóng có thể ngược: đóng trước mở). */
  const wo = (m: number, code: string, ten: string, tt: string, uuTien: number, moPhutTruoc: number, dongPhutTruoc: number | null) =>
    db.execute(sql`INSERT INTO maintenance_work_orders ("workOrderNumber", "machineId", "machineCode", type, status, trigger, priority, title, "openedAt", "closedAt")
      VALUES (${PT(ten)}, ${m}, ${code}, 'CORRECTIVE', ${tt}::workorderstatusenum, 'MANUAL', ${uuTien}, ${PT(ten)}, ${truoc(moPhutTruoc)}, ${dongPhutTruoc === null ? null : truoc(dongPhutTruoc)})`);
  // A: 3 mở (p1 OPEN 50h trước · p2 IN_PROGRESS 10h · p2 ON_HOLD 1h) · 1 huỷ · đóng: 60 phút và 180 phút trong 24h · đóng NGƯỢC (đóng trước mở) · đóng NGOÀI cửa sổ
  await wo(ids.machA, `${FAC_A}_M1`, "a-mo1", "OPEN", 1, 50 * 60, null);
  await wo(ids.machA, `${FAC_A}_M1`, "a-mo2", "IN_PROGRESS", 2, 10 * 60, null);
  await wo(ids.machA, `${FAC_A}_M1`, "a-mo3", "ON_HOLD", 2, 60, null);
  await wo(ids.machA, `${FAC_A}_M1`, "a-huy", "CANCELLED", 3, 5 * 60, 4 * 60);
  await wo(ids.machA, `${FAC_A}_M1`, "a-dong60", "COMPLETED", 3, 8 * 60, 8 * 60 - 60);
  await wo(ids.machA, `${FAC_A}_M1`, "a-dong180", "COMPLETED", 3, 12 * 60, 12 * 60 - 180);
  await wo(ids.machA, `${FAC_A}_M1`, "a-nguoc", "COMPLETED", 3, 3 * 60, 6 * 60);
  await wo(ids.machA, `${FAC_A}_M1`, "a-cu", "COMPLETED", 3, 100 * 60, 90 * 60);
  await wo(ids.machB, `${FAC_B}_M1`, "b-mo1", "OPEN", 1, 70 * 60, null);
  await wo(ids.machB, `${FAC_B}_M1`, "b-mo2", "OPEN", 1, 60 * 60, null);
  await wo(ids.machB, `${FAC_B}_M1`, "b-dong", "COMPLETED", 3, 15 * 60, 15 * 60 - 600);
  const pt = (ma: string, fac: number | null, ton: number, muc: number) =>
    db.execute(sql`INSERT INTO spare_parts_inventory ("partCode", "factoryId", "partName", "quantityOnHand", "reorderLevel", "reorderQuantity") VALUES (${PT(ma)}, ${fac}, ${PT(ma) + " ten"}, ${ton}, ${muc}, 10)`);
  // A: X (tồn 1, mức 5 ⇒ cần) · W (tồn 3, mức 0 ⇒ SÀN W16 = 3 ⇒ cần) · V (tồn 4, mức 0 ⇒ không) · Y (tồn 100 ⇒ không). B: Z (tồn 0 ⇒ cần). NULL: N (tồn 0 ⇒ cần, chỉ toàn quyền)
  await pt("x", ids.facA, 1, 5);
  await pt("w", ids.facA, 3, 0);
  await pt("v", ids.facA, 4, 0);
  await pt("y", ids.facA, 100, 5);
  await pt("z", ids.facB, 0, 10);
  await pt("n", null, 0, 10);
  u.A = await mkUser("a", "engineer", [FAC_A]);
  u.nhieu = await mkUser("nhieu", "engineer", [FAC_A, FAC_B]);
  u.admin = await mkUser("admin", "admin", []);
  u.mat = await mkUser("mat", "engineer", [FAC_A]);
}, 180_000);

afterAll(async () => {
  const runs = await db.select({ id: aiFlowRuns.id }).from(aiFlowRuns).where(like(aiFlowRuns.flowId, `${TT}%`));
  if (runs.length) await db.delete(aiFlowRuns).where(inArray(aiFlowRuns.id, runs.map((r) => r.id)));
  await db.delete(aiFlows).where(like(aiFlows.id, `${TT}%`));
  await db.execute(sql`DELETE FROM user_factory_assignments WHERE "userId" IN ${sql.raw(`(${Object.values(u).join(",")})`)}`);
  await db.execute(sql`DELETE FROM spare_parts_inventory WHERE "partCode" LIKE ${`${RUN}-%`}`);
  await qChuTest(`DELETE FROM maintenance_work_orders WHERE "machineId" IN (${ids.machA}, ${ids.machB})`).catch(() => undefined);
  await db.execute(sql`DELETE FROM maintenance_work_orders WHERE "machineId" IN (${ids.machA}, ${ids.machB})`).catch(() => undefined);
  await db.execute(sql`DELETE FROM downtime_events WHERE "machineId" IN (${ids.machA}, ${ids.machB})`).catch(() => undefined);
  await db.execute(sql`DELETE FROM machines WHERE id IN (${ids.machA}, ${ids.machB})`);
  await db.execute(sql`DELETE FROM stations WHERE id IN ${sql.raw(`(${cay.st.join(",")})`)}`);
  await db.execute(sql`DELETE FROM production_lines WHERE id IN ${sql.raw(`(${cay.ln.join(",")})`)}`);
  await db.execute(sql`DELETE FROM workshops WHERE id IN ${sql.raw(`(${cay.ws.join(",")})`)}`);
  await db.execute(sql`DELETE FROM factories WHERE id IN (${ids.facA}, ${ids.facB})`);
});

describe("dung-may.tong-hop", () => {
  it("(a) luồng A: 3 lần (ngoài cửa sổ không tính), 50 phút, 1 đang dừng; theo loại; máy dừng nhiều nhất = máy A", async () => {
    const r = await chay(await luong("dm-a", "dung-may.tong-hop", ids.facA), u.A);
    expect(r.status).toBe("xong");
    expect(r.so?.tong).toMatchObject({ soLan: 3, tongPhut: 50, dangDung: 1, lan_breakdown: 2, phut_breakdown: 50, lan_planned: 1, phut_planned: 0 });
    expect(r.so?.dong).toEqual([{ ma: `${FAC_A}_M1`, soLan: 3, phut: 50 }]);
  });
  it("(b) ★ chủ thấy A+B chạy luồng A ⇒ KHÔNG có số của B; luồng B ⇒ chỉ B", async () => {
    const a = await chay(await luong("dm-a2", "dung-may.tong-hop", ids.facA), u.nhieu);
    expect(a.so?.tong.soLan).toBe(3);
    expect(JSON.stringify(a.so)).not.toContain(`${FAC_B}_M1`);
    const b = await chay(await luong("dm-b", "dung-may.tong-hop", ids.facB), u.nhieu);
    expect(b.so?.tong).toMatchObject({ soLan: 2, tongPhut: 500, dangDung: 0, lan_unplanned: 2 });
  });
});

describe("phieu-bao-tri.dang-mo", () => {
  it("(a) luồng A: 3 phiếu mở (huỷ không tính) theo ưu tiên; phiếu mở lâu nhất đứng đầu", async () => {
    const r = await chay(await luong("pm-a", "phieu-bao-tri.dang-mo", ids.facA), u.A);
    expect(r.so?.tong).toMatchObject({ tongMo: 3, uuTien_1: 1, uuTien_2: 2 });
    expect(r.so?.dong.map((x) => x.soPhieu)).toEqual([PT("a-mo1"), PT("a-mo2"), PT("a-mo3")]);
    expect(Number(r.so?.dong[0].moGio)).toBeGreaterThanOrEqual(49);
  });
  it("(b) ★ không có phiếu nhà máy B (chủ A+B, luồng A)", async () => {
    const r = await chay(await luong("pm-a2", "phieu-bao-tri.dang-mo", ids.facA), u.nhieu);
    expect(r.so?.tong.tongMo).toBe(3);
    expect(JSON.stringify(r.so)).not.toContain(PT("b-mo1"));
  });
});

describe("phieu-bao-tri.dong-gan-day (thời gian MỞ→ĐÓNG, không phải MTTR chuẩn)", () => {
  it("(a) luồng A: đúng 2 phiếu hợp lệ (60 & 180 phút) — loại: huỷ, đóng ngược, đóng ngoài cửa sổ; trung vị 120, trung bình 120; phiếu lâu nhất đứng đầu", async () => {
    const r = await chay(await luong("pd-a", "phieu-bao-tri.dong-gan-day", ids.facA), u.A);
    expect(r.so?.tong).toEqual({ soPhieu: 2, moDenDongTrungViPhut: 120, moDenDongTrungBinhPhut: 120 });
    expect(r.so?.dong).toEqual([{ soPhieu: PT("a-dong180"), may: `${FAC_A}_M1`, moDenDongPhut: 180 }, { soPhieu: PT("a-dong60"), may: `${FAC_A}_M1`, moDenDongPhut: 60 }]);
  });
  it("(b) ★ phiếu đóng của B (600 phút) không lọt vào luồng A của chủ A+B", async () => {
    const r = await chay(await luong("pd-a2", "phieu-bao-tri.dong-gan-day", ids.facA), u.nhieu);
    expect(r.so?.tong.soPhieu).toBe(2);
    expect(r.so?.tong.moDenDongTrungBinhPhut).toBe(120);
  });
  it("không có phiếu nào ⇒ số 0 (không NaN)", async () => {
    const r = await chay(await luong("pd-0", "phieu-bao-tri.dong-gan-day", ids.facA, { gio: 1 }), u.A);
    expect(r.so?.tong).toEqual({ soPhieu: 0, moDenDongTrungViPhut: 0, moDenDongTrungBinhPhut: 0 });
  });
});

describe("ton-kho.sap-het (mức tồn tối thiểu W16, theo NHÀ MÁY)", () => {
  it("(a) luồng A / chủ A: X (tồn 1 ≤ mức 5) và W (tồn 3 ≤ SÀN 3 dù mức khai 0); V (tồn 4) và Y không; tổng thiếu = 4", async () => {
    const r = await chay(await luong("tk-a", "ton-kho.sap-het", ids.facA), u.A);
    expect(r.status).toBe("xong");
    expect(r.so?.tong).toEqual({ soLoai: 2, tongThieu: 4 });
    expect(r.so?.dong.map((x) => x.ma)).toEqual([PT("x"), PT("w")]);
    expect(r.so?.dong[1]).toMatchObject({ ton: 3, nguong: 3 });
  });
  it("(b) ★ chủ A+B chạy luồng A ⇒ KHÔNG có Z của B, KHÔNG có hàng chưa gán nhà máy (N)", async () => {
    const r = await chay(await luong("tk-a2", "ton-kho.sap-het", ids.facA), u.nhieu);
    expect(r.so?.tong.soLoai).toBe(2);
    expect(JSON.stringify(r.so)).not.toContain(PT("z"));
    expect(JSON.stringify(r.so)).not.toContain(PT("n"));
    const b = await chay(await luong("tk-b", "ton-kho.sap-het", ids.facB), u.nhieu);
    expect(b.so?.dong.map((x) => x.ma)).toEqual([PT("z")]);
  });
  it("★ luồng TOÀN HỆ THỐNG: chủ chỉ thuộc A không thấy B và N; admin (toàn quyền) thấy cả A, B và hàng chưa gán", async () => {
    const id = await luong("tk-g", "ton-kho.sap-het", null, { gioiHan: 20 });
    const a = await chay(id, u.A);
    expect(a.so?.dong.map((x) => x.ma).filter((m) => String(m).startsWith(RUN)).sort()).toEqual([PT("w"), PT("x")].sort());
    const ad = await chay(id, u.admin);
    const cua = ad.so?.dong.map((x) => x.ma).filter((m) => String(m).startsWith(RUN)).sort();
    expect(cua).toEqual([PT("n"), PT("w"), PT("x"), PT("z")].sort());
  });
});

describe("chủ mất quyền lúc chạy ⇒ lượt lỗi (cả bốn truy vấn mới)", () => {
  it("chủ mất gán nhà máy ⇒ PHAM_VI_RONG", async () => {
    const ds = ["dung-may.tong-hop", "phieu-bao-tri.dang-mo", "phieu-bao-tri.dong-gan-day", "ton-kho.sap-het"];
    const fl = await Promise.all(ds.map((q, i) => luong(`mat${i}`, q, ids.facA)));
    await db.execute(sql`DELETE FROM user_factory_assignments WHERE "userId" = ${u.mat}`);
    for (const id of fl) {
      const r = await chay(id, u.mat);
      expect(r.status, id).toBe("loi");
      expect(r.loi?.ma, id).toBe("PHAM_VI_RONG");
    }
  });
});
