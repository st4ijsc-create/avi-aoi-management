/** Task 17 bước 3 — NGÂN SÁCH VẼ: ước tam giác từ CHÍNH hàm sản phẩm `hinhHocChoLoaiMay`. CHỈ ĐỌC. */
import { readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import postgres from "postgres";
const url = readFileSync(".env", "utf8").split(/\r?\n/).find((l) => l.startsWith("DATABASE_URL="))!.slice(13).trim();
const { hinhKhoiCho, hinhHocChoLoaiMay } = await import("../client/src/components/twin3d/hinhKhoiMay.js");
const sql = postgres(url, { max: 2 });
const may: any[] = await sql`select f.code as nm, m."machineType" as loai, m."isActive", s.id as "tangId"
  from machines m join stations st on st.id=m."stationId" join production_lines l on l.id=st."lineId"
  join workshops w on w.id=l."workshopId" join factories f on f.id=w."factoryId"
  left join twin_dat_cho dc on dc."loaiThucThe"='machine' and dc."thucTheId"=m.id
  left join twin_tang s on s.id=dc."tangId"
  where f.code like 'QATD-%'`;
const datCho: any[] = await sql`select dc."rongMm", dc."caoMm", dc."sauMm", m."machineType" as loai, f.code as nm, dc."tangId", dc."hienThi"
  from twin_dat_cho dc join machines m on m.id=dc."thucTheId" and dc."loaiThucThe"='machine'
  join twin_tang s on s.id=dc."tangId" join twin_toa_nha b on b.id=s."toaNhaId" join factories f on f.id=b."factoryId"
  where f.code like 'QATD-%'`;
const vatThe: any[] = await sql`select vt.loai, f.code as nm, count(*)::int as n from twin_vat_the vt
  join twin_tang s on s.id=vt."tangId" join twin_toa_nha b on b.id=s."toaNhaId" join factories f on f.id=b."factoryId"
  where f.code like 'QATD-%' group by vt.loai, f.code order by f.code, vt.loai`;
await sql.end();

const tamGiac = (loai: string, kt: any) => hinhHocChoLoaiMay(loai, {
  rongMm: Number(kt.rongMm ?? 1200), caoMm: Number(kt.caoMm ?? 1800), sauMm: Number(kt.sauMm ?? 800),
}).soTamGiacUocTinh;

const theoNM: Record<string, { soMay: number; tam: number; khoi: Record<string, number> }> = {};
for (const d of datCho) {
  const k = d.nm; theoNM[k] ??= { soMay: 0, tam: 0, khoi: {} };
  theoNM[k].soMay++; theoNM[k].tam += tamGiac(d.loai, d);
  const kh = hinhKhoiCho(d.loai); theoNM[k].khoi[kh] = (theoNM[k].khoi[kh] ?? 0) + 1;
}
const tongMay = Object.values(theoNM).reduce((s, x) => s + x.soMay, 0);
const tongTam = Object.values(theoNM).reduce((s, x) => s + x.tam, 0);
const khoiChung = new Set<string>(); for (const v of Object.values(theoNM)) for (const k of Object.keys(v.khoi)) khoiChung.add(k);

// Tầng đông nhất (đường nạp HIỆN TẠI vẽ một tầng)
const theoTang: Record<string, { n: number; tam: number }> = {};
for (const d of datCho) { const k = String(d.tangId); theoTang[k] ??= { n: 0, tam: 0 }; theoTang[k].n++; theoTang[k].tam += tamGiac(d.loai, d); }
const dsTang = Object.entries(theoTang).sort((a, b) => b[1].n - a[1].n);

const ra = {
  moc: new Date().toISOString(),
  ghiChu: "soTamGiacUocTinh = số hộp con × 12, đúng hàm `hinhHocKhoi` của sản phẩm. KHÔNG gồm sàn/tường/vùng/nhãn.",
  theoNhaMay: theoNM,
  tongBaNhaMay: { soMayCoDatCho: tongMay, tamGiacMay: tongTam, soKhoiKhacNhau: khoiChung.size, dsKhoi: [...khoiChung] },
  tangDongNhat: dsTang.slice(0, 3).map(([id, v]) => ({ tangId: Number(id), soMay: v.n, tamGiacMay: v.tam })),
  tangItNhat: dsTang.slice(-3).map(([id, v]) => ({ tangId: Number(id), soMay: v.n, tamGiacMay: v.tam })),
  soTangCoMay: dsTang.length,
  vatTheTheoNhaMay: vatThe,
  soHangDatChoMay: datCho.length,
  soMayTrongCay: may.length,
};
mkdirSync(".qa-tapdoan/tho/T17", { recursive: true });
writeFileSync(".qa-tapdoan/tho/T17/.tmp-ve.json", JSON.stringify(ra, null, 1));
renameSync(".qa-tapdoan/tho/T17/.tmp-ve.json", ".qa-tapdoan/tho/T17/ngan-sach-ve.json");
console.log(JSON.stringify(ra, null, 1));
