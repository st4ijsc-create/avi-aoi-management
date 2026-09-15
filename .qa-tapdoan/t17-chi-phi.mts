/**
 * Task 17 bước 2 — ĐO CHI PHÍ THẬT của đường dựng cảnh, CHỈ ĐỌC.
 * Gọi THẲNG hàm sản phẩm (`traCayPhanCapNhaMay`, `traDatChoTheoTang`,
 * `traVungAnToan`, `traKichThuocTheoLoai`) — không qua HTTP, không bật server.
 * Chạy: npx tsx .qa-tapdoan/t17-chi-phi.mts
 */
import { readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
const env = readFileSync(".env", "utf8").split(/\r?\n/);
for (const l of env) {
  const i = l.indexOf("=");
  if (i > 0 && !l.startsWith("#")) {
    const k = l.slice(0, i).trim();
    if (!(k in process.env)) process.env[k] = l.slice(i + 1).trim();
  }
}
process.env.NODE_ENV = process.env.NODE_ENV ?? "development";

const {
  traCayPhanCapNhaMay, traDatChoTheoTang, traVungAnToan, traKichThuocTheoLoai,
} = await import("../server/db/twinCanh.js");
const { getDb } = await import("../server/db/connection.js");

const NM = [41, 42, 43];
const db: any = await getDb();

// Tầng sống của từng nhà máy (đọc trực tiếp, không phải phần đo).
const tangTheoNM: Record<number, number[]> = {};
for (const id of NM) {
  const r: any = await db.execute(
    `SELECT s."id" FROM twin_tang s JOIN twin_toa_nha b ON b."id"=s."toaNhaId"
     WHERE b."factoryId"=${id} AND s."isActive" AND b."isActive" ORDER BY s."id"`,
  );
  const rows = Array.isArray(r) ? r : (r.rows ?? []);
  tangTheoNM[id] = rows.map((x: any) => Number(x.id));
}

// Đếm câu SQL thật: bọc `db.execute` + đếm qua log của postgres? -> đơn giản hơn:
// đo bằng pg_stat_statements không bật ⇒ đếm PHÂN TÍCH từ mã, ghi riêng.

const bytes = (o: unknown) => Buffer.byteLength(JSON.stringify(o), "utf8");
const nano = () => Number(process.hrtime.bigint());
async function do1<T>(nhan: string, lan: number, f: () => Promise<T>) {
  const ms: number[] = [];
  let cuoi: any;
  for (let i = 0; i < lan; i++) {
    const t0 = nano();
    cuoi = await f();
    ms.push((nano() - t0) / 1e6);
  }
  ms.sort((a, b) => a - b);
  return {
    nhan, lan,
    msMin: +ms[0].toFixed(1),
    msTrungVi: +ms[Math.floor(ms.length / 2)].toFixed(1),
    msMax: +ms[ms.length - 1].toFixed(1),
    byteKetQua: bytes(cuoi),
    moTaKetQua: cuoi && typeof cuoi === "object" ? Object.fromEntries(
      Object.entries(cuoi as any).map(([k, v]) => [k, Array.isArray(v) ? v.length : typeof v]),
    ) : typeof cuoi,
  };
}

const VAI = {
  admin: undefined, // scope vắng ⇒ toàn quyền, KHÔNG thêm mệnh đề nào
  giamdoc: { userId: 26916, userRole: "supervisor" },   // gán CẤP TẬP ĐOÀN QATD ⇒ 3 nhà máy
  quanly: { userId: 26917, userRole: "supervisor" },    // gán ĐÚNG QATD-A
} as const;

const kq: any = { moc: new Date().toISOString(), tangTheoNM: Object.fromEntries(NM.map((i) => [i, tangTheoNM[i].length])), phepDo: [] };

// ── Làm nóng (kết nối + cache kế hoạch) — không tính vào số báo cáo.
await traCayPhanCapNhaMay(41, undefined);
await traKichThuocTheoLoai();

for (const [tenVai, scope] of Object.entries(VAI)) {
  const sc = scope as any;
  // 1 nhà máy — cây
  kq.phepDo.push(await do1(`cay 1 nha may (41) · vai=${tenVai}`, 7, () => traCayPhanCapNhaMay(41, sc)));
  // 3 nhà máy — TUẦN TỰ
  kq.phepDo.push(await do1(`cay 3 nha may TUAN TU · vai=${tenVai}`, 7, async () => {
    const a = []; for (const id of NM) a.push(await traCayPhanCapNhaMay(id, sc)); return a;
  }));
  // 3 nhà máy — SONG SONG (Promise.all — đúng hình dạng "3 lượt gọi song song")
  kq.phepDo.push(await do1(`cay 3 nha may SONG SONG · vai=${tenVai}`, 7, () =>
    Promise.all(NM.map((id) => traCayPhanCapNhaMay(id, sc)))));
  // đặt chỗ — 28 tầng của 1 nhà máy
  kq.phepDo.push(await do1(`datCho 28 tang (nm41) · vai=${tenVai}`, 5, () => traDatChoTheoTang(tangTheoNM[41], sc)));
  // đặt chỗ — 50 tầng (đúng TRẦN hiện tại), trộn 2 nhà máy
  const t50 = [...tangTheoNM[41], ...tangTheoNM[42]].slice(0, 50);
  kq.phepDo.push(await do1(`datCho 50 tang (TRAN hien tai, nm41+42) · vai=${tenVai}`, 5, () => traDatChoTheoTang(t50, sc)));
  // đặt chỗ — 84 tầng (cái mà cảnh 3 nhà máy thật sự cần)
  const t84 = [...tangTheoNM[41], ...tangTheoNM[42], ...tangTheoNM[43]];
  kq.phepDo.push(await do1(`datCho 84 tang (3 nha may DAY DU) · vai=${tenVai}`, 5, () => traDatChoTheoTang(t84, sc)));
  // vùng an toàn — 84 tầng
  kq.phepDo.push(await do1(`vungAnToan 84 tang · vai=${tenVai}`, 3, () => traVungAnToan([...tangTheoNM[41], ...tangTheoNM[42], ...tangTheoNM[43]], (sc ?? {}) as any)));
}

// ── Toàn bộ thân `canhThietKe` cho 1 nhà máy và cho 3 (mô phỏng đúng thứ tự mã).
async function thanCanh(ids: number[], scope: any) {
  const tangIds = ids.flatMap((i) => tangTheoNM[i]);
  const [cay, kichThuoc] = await Promise.all([
    ids.length === 1 ? traCayPhanCapNhaMay(ids[0], scope)
      : Promise.all(ids.map((i) => traCayPhanCapNhaMay(i, scope))),
    traKichThuocTheoLoai(),
  ]);
  const datCho = await traDatChoTheoTang(tangIds, scope);
  const vung = await traVungAnToan(tangIds, (scope ?? {}) as any);
  return { cay, kichThuoc, datCho, vung };
}
for (const [tenVai, scope] of Object.entries(VAI)) {
  const sc = scope as any;
  kq.phepDo.push(await do1(`THAN canhThietKe 1 nha may (41, 28 tang) · vai=${tenVai}`, 5, () => thanCanh([41], sc)));
  kq.phepDo.push(await do1(`THAN canhThietKe 3 nha may (41+42+43, 84 tang) · vai=${tenVai}`, 5, () => thanCanh(NM, sc)));
}

mkdirSync(".qa-tapdoan/tho/T17", { recursive: true });
const s = JSON.stringify(kq, null, 1);
writeFileSync(".qa-tapdoan/tho/T17/.tmp-chi-phi.json", s);
renameSync(".qa-tapdoan/tho/T17/.tmp-chi-phi.json", ".qa-tapdoan/tho/T17/chi-phi.json");
for (const p of kq.phepDo) {
  console.log(`${String(p.msTrungVi).padStart(8)} ms  (${String(p.msMin)}–${String(p.msMax)})  ${String(p.byteKetQua).padStart(9)} B  ${p.nhan}`);
}
process.exit(0);
