/**
 * Task 17 bước 2 (phần 2) — ĐẾM CHÍNH XÁC SỐ CÂU SQL + ABLATION THIẾT KẾ. CHỈ ĐỌC.
 * Đếm bằng `queryMonitor.getQueryStats().totalQueries` (bộ đếm CỦA SẢN PHẨM,
 * gắn vào `client.unsafe` — đúng đường drizzle gửi câu đi).
 */
import { readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
for (const l of readFileSync(".env", "utf8").split(/\r?\n/)) {
  const i = l.indexOf("=");
  if (i > 0 && !l.startsWith("#")) { const k = l.slice(0, i).trim(); if (!(k in process.env)) process.env[k] = l.slice(i + 1).trim(); }
}
process.env.NODE_ENV = process.env.NODE_ENV ?? "development";
process.env.QUERY_MONITOR_ENABLED = "true";
const { traCayPhanCapNhaMay, traDatChoTheoTang, traVungAnToan } = await import("../server/db/twinCanh.js");
const { getDb } = await import("../server/db/connection.js");
const { resolveTenantFactoryScope } = await import("../server/db/reportAggregators.js");
const { getQueryStats } = await import("../server/queryMonitor.js");

const db: any = await getDb();
const NM = [41, 42, 43];
const tangTheoNM: Record<number, number[]> = {};
for (const id of NM) {
  const r: any = await db.execute(`SELECT s."id" FROM twin_tang s JOIN twin_toa_nha b ON b."id"=s."toaNhaId"
     WHERE b."factoryId"=${id} AND s."isActive" AND b."isActive" ORDER BY s."id"`);
  tangTheoNM[id] = (Array.isArray(r) ? r : (r.rows ?? [])).map((x: any) => Number(x.id));
}
const t28 = tangTheoNM[41];
const t50 = [...tangTheoNM[41], ...tangTheoNM[42]].slice(0, 50);
const t84 = [...tangTheoNM[41], ...tangTheoNM[42], ...tangTheoNM[43]];
const admin = undefined;
const giamdoc = { userId: 26916, userRole: "supervisor" };
const quanly = { userId: 26917, userRole: "supervisor" };

const ra: any = { moc: new Date().toISOString(), soTang: { 41: t28.length, 42: tangTheoNM[42].length, 43: tangTheoNM[43].length }, muc: [] };
async function d<T>(nhan: string, f: () => Promise<T>) {
  const a = getQueryStats().totalQueries;
  const t0 = Number(process.hrtime.bigint());
  const kq: any = await f();
  const ms = (Number(process.hrtime.bigint()) - t0) / 1e6;
  const soCau = getQueryStats().totalQueries - a;
  const co = Array.isArray(kq) ? kq.length : (kq && typeof kq === "object"
    ? Object.fromEntries(Object.entries(kq).map(([k, v]: any) => [k, Array.isArray(v) ? v.length : v])) : kq);
  ra.muc.push({ nhan, soCau, ms: +ms.toFixed(1), byte: Buffer.byteLength(JSON.stringify(kq ?? null), "utf8"), co });
  console.log(`${String(soCau).padStart(4)} câu · ${String(+ms.toFixed(1)).padStart(8)} ms · ${String(Buffer.byteLength(JSON.stringify(kq ?? null), "utf8")).padStart(8)} B · ${nhan}`);
  return kq;
}
await traCayPhanCapNhaMay(41, giamdoc as any); // làm nóng

await d("cong RIENG: resolveTenantFactoryScope(giamdoc)", () => resolveTenantFactoryScope(giamdoc as any));
await d("cong RIENG: resolveTenantFactoryScope(admin/vang)", () => resolveTenantFactoryScope(admin as any));
for (const [ten, sc] of [["admin", admin], ["giamdoc", giamdoc], ["quanly(1 nha may A)", quanly]] as const) {
  await d(`cay 1 nha may (41) · ${ten}`, () => traCayPhanCapNhaMay(41, sc as any));
  await d(`cay 3 nha may TUAN TU · ${ten}`, async () => { const a = []; for (const i of NM) a.push(await traCayPhanCapNhaMay(i, sc as any)); return a; });
  await d(`cay 3 nha may SONG SONG · ${ten}`, () => Promise.all(NM.map((i) => traCayPhanCapNhaMay(i, sc as any))));
  await d(`datCho 28 tang · ${ten}`, () => traDatChoTheoTang(t28, sc as any));
  await d(`datCho 50 tang (TRAN) · ${ten}`, () => traDatChoTheoTang(t50, sc as any));
  await d(`datCho 84 tang · ${ten}`, () => traDatChoTheoTang(t84, sc as any));
  await d(`vungAnToan 84 tang · ${ten}`, () => traVungAnToan(t84, (sc ?? {}) as any));
}

// ── ABLATION THIẾT KẾ: cổng GỘP (phân giải phạm vi MỘT lần + lọc tầng bằng MỘT câu)
async function datChoGopCong(tangIds: number[], scope: any) {
  const pv = await resolveTenantFactoryScope(scope);
  const dsF = pv.factoryIds;
  const loc: any = await db.execute(
    `SELECT s."id" FROM twin_tang s JOIN twin_toa_nha b ON b."id"=s."toaNhaId"
     WHERE s."id" IN (${tangIds.join(",")})` + (dsF === null ? "" : ` AND b."factoryId" IN (${dsF.length ? dsF.join(",") : "-1"})`));
  const hopLe = (Array.isArray(loc) ? loc : (loc.rows ?? [])).map((x: any) => Number(x.id));
  if (!hopLe.length) return [];
  const hang: any = await db.execute(`SELECT * FROM twin_dat_cho WHERE "tangId" IN (${hopLe.join(",")})`);
  return Array.isArray(hang) ? hang : (hang.rows ?? []);
}
async function cayGop(ids: number[], scope: any) {
  const pv = await resolveTenantFactoryScope(scope);
  const dsF = pv.factoryIds === null ? ids : ids.filter((i) => pv.factoryIds!.includes(i));
  if (!dsF.length) return { xuong: [], chuyen: [], tram: [], may: [] };
  const q = async (s: string) => { const r: any = await db.execute(s); return Array.isArray(r) ? r : (r.rows ?? []); };
  const xuong = await q(`SELECT id, code, name, "factoryId" FROM workshops WHERE "factoryId" IN (${dsF.join(",")})`);
  if (!xuong.length) return { xuong, chuyen: [], tram: [], may: [] };
  const chuyen = await q(`SELECT id, code, name, "workshopId" FROM production_lines WHERE "workshopId" IN (${xuong.map((x: any) => x.id).join(",")})`);
  if (!chuyen.length) return { xuong, chuyen, tram: [], may: [] };
  const tram = await q(`SELECT id, code, name, "lineId", "orderIndex" FROM stations WHERE "lineId" IN (${chuyen.map((c: any) => c.id).join(",")})`);
  if (!tram.length) return { xuong, chuyen, tram, may: [] };
  const may = await q(`SELECT id, code, name, "machineType", "isActive", "stationId" FROM machines WHERE "stationId" IN (${tram.map((t: any) => t.id).join(",")})`);
  return { xuong, chuyen, tram, may };
}
for (const [ten, sc] of [["admin", admin], ["giamdoc", giamdoc], ["quanly(1 nha may A)", quanly]] as const) {
  await d(`[AB] datCho 84 tang · CONG GOP · ${ten}`, () => datChoGopCong(t84, sc));
  await d(`[AB] cay 3 nha may · MOT BO 4 CAU · ${ten}`, () => cayGop(NM, sc));
}
// Đối chứng ĐÚNG-SAI của ablation: cổng gộp phải trả CÙNG tập id như đường sản phẩm.
const sp = await traDatChoTheoTang(t84, quanly as any);
const ab = await datChoGopCong(t84, quanly);
ra.doiChung = {
  sanPham_soHang: sp.length, ablation_soHang: ab.length,
  khopSoHang: sp.length === ab.length,
  sanPham_tangKhacNhau: new Set(sp.map((x: any) => x.tangId)).size,
  ablation_tangKhacNhau: new Set(ab.map((x: any) => Number(x.tangId))).size,
};
console.log("ĐỐI CHỨNG ablation:", JSON.stringify(ra.doiChung));

mkdirSync(".qa-tapdoan/tho/T17", { recursive: true });
writeFileSync(".qa-tapdoan/tho/T17/.tmp-dem.json", JSON.stringify(ra, null, 1));
renameSync(".qa-tapdoan/tho/T17/.tmp-dem.json", ".qa-tapdoan/tho/T17/dem-cau.json");
process.exit(0);
