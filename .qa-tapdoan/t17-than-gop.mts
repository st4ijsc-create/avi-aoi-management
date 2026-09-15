/** Task 17 — THÂN canhThietKe: đường SẢN PHẨM vs đường CỔNG GỘP (ablation thiết kế). CHỈ ĐỌC. */
import { readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { gzipSync } from "node:zlib";
for (const l of readFileSync(".env", "utf8").split(/\r?\n/)) {
  const i = l.indexOf("="); if (i > 0 && !l.startsWith("#")) { const k = l.slice(0, i).trim(); if (!(k in process.env)) process.env[k] = l.slice(i + 1).trim(); }
}
process.env.NODE_ENV = process.env.NODE_ENV ?? "development";
process.env.QUERY_MONITOR_ENABLED = "true";
const { traCayPhanCapNhaMay, traDatChoTheoTang, traVungAnToan, traKichThuocTheoLoai } = await import("../server/db/twinCanh.js");
const { getDb } = await import("../server/db/connection.js");
const { resolveTenantFactoryScope } = await import("../server/db/reportAggregators.js");
const { getQueryStats } = await import("../server/queryMonitor.js");
const db: any = await getDb();
const NM = [41, 42, 43];
const q = async (s: string) => { const r: any = await db.execute(s); return Array.isArray(r) ? r : (r.rows ?? []); };
const tangCua = async (ids: number[]) => (await q(`SELECT s."id" FROM twin_tang s JOIN twin_toa_nha b ON b."id"=s."toaNhaId"
  WHERE b."factoryId" IN (${ids.join(",")}) AND s."isActive" AND b."isActive" ORDER BY s."id"`)).map((x: any) => Number(x.id));

async function thanSanPham(ids: number[], scope: any) {
  const tangIds = await tangCua(ids);
  const cay = ids.length === 1 ? [await traCayPhanCapNhaMay(ids[0], scope)]
    : await Promise.all(ids.map((i) => traCayPhanCapNhaMay(i, scope)));
  const kichThuoc = await traKichThuocTheoLoai();
  const datCho = await traDatChoTheoTang(tangIds, scope);
  const vung = await traVungAnToan(tangIds, (scope ?? {}) as any);
  return { cay, kichThuoc, datCho, vung };
}
/** Đường CỔNG GỘP: phân giải phạm vi MỘT lần; lọc mã nhà máy + lọc tầng bằng MỘT câu JOIN. */
async function thanGop(ids: number[], scope: any) {
  const pv = await resolveTenantFactoryScope(scope);
  const dsF = pv.factoryIds === null ? ids : ids.filter((i) => pv.factoryIds!.includes(i)); // ★ lọc TỪNG mã
  const kichThuoc = await traKichThuocTheoLoai();
  if (dsF.length === 0) return { cay: { xuong: [], chuyen: [], tram: [], may: [] }, kichThuoc, datCho: [], vung: [], toaNha: [] };
  const toaNha = await q(`SELECT id, "factoryId", ma, ten, "viTriXMm", "viTriYMm", "viTriZMm", "rongMm", "sauMm", "caoMm" FROM twin_toa_nha WHERE "factoryId" IN (${dsF.join(",")}) AND "isActive"`);
  const xuong = await q(`SELECT id, code, name, "factoryId" FROM workshops WHERE "factoryId" IN (${dsF.join(",")})`);
  const chuyen = xuong.length ? await q(`SELECT id, code, name, "workshopId" FROM production_lines WHERE "workshopId" IN (${xuong.map((x: any) => x.id).join(",")})`) : [];
  const tram = chuyen.length ? await q(`SELECT id, code, name, "lineId", "orderIndex" FROM stations WHERE "lineId" IN (${chuyen.map((c: any) => c.id).join(",")})`) : [];
  const may = tram.length ? await q(`SELECT id, code, name, "machineType", "isActive", "stationId" FROM machines WHERE "stationId" IN (${tram.map((t: any) => t.id).join(",")})`) : [];
  const tangHopLe = await q(`SELECT s."id" FROM twin_tang s JOIN twin_toa_nha b ON b."id"=s."toaNhaId"
     WHERE b."factoryId" IN (${dsF.join(",")}) AND s."isActive" AND b."isActive"`);
  const ids2 = tangHopLe.map((x: any) => Number(x.id));
  const datCho = ids2.length ? await q(`SELECT * FROM twin_dat_cho WHERE "tangId" IN (${ids2.join(",")})`) : [];
  const vung = ids2.length ? await q(`SELECT * FROM twin_vat_the WHERE "tangId" IN (${ids2.join(",")}) AND loai='vung'`) : [];
  return { cay: { xuong, chuyen, tram, may }, kichThuoc, datCho, vung, toaNha };
}
const ra: any = { moc: new Date().toISOString(), muc: [] };
async function d(nhan: string, f: () => Promise<any>, lan = 5) {
  let kq: any, soCau = 0; const ms: number[] = [];
  for (let i = 0; i < lan; i++) {
    const a = getQueryStats().totalQueries; const t0 = Number(process.hrtime.bigint());
    kq = await f(); ms.push((Number(process.hrtime.bigint()) - t0) / 1e6); soCau = getQueryStats().totalQueries - a;
  }
  ms.sort((x, y) => x - y);
  const raw = Buffer.from(JSON.stringify(kq), "utf8");
  const o = { nhan, soCau, msTrungVi: +ms[Math.floor(lan / 2)].toFixed(1), msMin: +ms[0].toFixed(1), msMax: +ms[lan - 1].toFixed(1), kbJson: +(raw.length / 1024).toFixed(1), kbGzip: +(gzipSync(raw).length / 1024).toFixed(1), soMay: kq.cay?.may?.length ?? (Array.isArray(kq.cay) ? kq.cay.reduce((s: number, c: any) => s + c.may.length, 0) : 0), soDatCho: kq.datCho.length };
  ra.muc.push(o);
  console.log(`${String(o.soCau).padStart(4)} câu · ${String(o.msTrungVi).padStart(7)} ms (${o.msMin}–${o.msMax}) · ${String(o.kbJson).padStart(7)} KB / ${String(o.kbGzip).padStart(5)} KB gzip · may=${String(o.soMay).padStart(4)} datCho=${String(o.soDatCho).padStart(4)} · ${nhan}`);
  return kq;
}
const admin = undefined, giamdoc = { userId: 26916, userRole: "supervisor" }, quanly = { userId: 26917, userRole: "supervisor" };
await traCayPhanCapNhaMay(41, giamdoc as any);
for (const [ten, sc] of [["admin", admin], ["giamdoc(3 nha may)", giamdoc], ["quanly(1 nha may A)", quanly]] as const) {
  await d(`SAN PHAM · 1 nha may · ${ten}`, () => thanSanPham([41], sc as any));
  await d(`SAN PHAM · 3 nha may · ${ten}`, () => thanSanPham(NM, sc as any));
  await d(`[AB] CONG GOP · 3 nha may · ${ten}`, () => thanGop(NM, sc as any));
}
// Đối chứng: cổng gộp phải cho CÙNG số máy như đường sản phẩm, với CÙNG vai.
const spQ = await thanSanPham(NM, quanly as any); const abQ = await thanGop(NM, quanly as any);
ra.doiChung = {
  sanPham_may: (spQ.cay as any[]).reduce((s, c) => s + c.may.length, 0), ablation_may: abQ.cay.may.length,
  sanPham_datCho: spQ.datCho.length, ablation_datCho: abQ.datCho.length,
  khop: (spQ.cay as any[]).reduce((s, c) => s + c.may.length, 0) === abQ.cay.may.length && spQ.datCho.length === abQ.datCho.length,
  ablation_ro_ten_B_hay_C: JSON.stringify(abQ).includes("QATD-B") || JSON.stringify(abQ).includes("QATD-C"),
};
console.log("ĐỐI CHỨNG:", JSON.stringify(ra.doiChung));
mkdirSync(".qa-tapdoan/tho/T17", { recursive: true });
writeFileSync(".qa-tapdoan/tho/T17/.tmp-than.json", JSON.stringify(ra, null, 1));
renameSync(".qa-tapdoan/tho/T17/.tmp-than.json", ".qa-tapdoan/tho/T17/than-gop.json");
process.exit(0);
