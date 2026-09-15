#!/usr/bin/env node
/**
 * ============================================================================
 * SINH TẬP ĐOÀN QA TWIN — 1 tập đoàn → 3 công ty → 4 toà × 7 tầng → xưởng ở
 * tầng 1–2 → 3–5 line/xưởng → 8–15 máy KHÁC LOẠI/line. Mọi mã mang tiền tố `QATD-`.
 * ============================================================================
 *
 *   node .qa-tapdoan/sinh-tap-doan.mjs --kho                 # chỉ in KẾ HOẠCH + kiểm, KHÔNG ghi
 *   node .qa-tapdoan/sinh-tap-doan.mjs --ghi                 # sinh toàn bộ trong MỘT giao dịch + cầu chì
 *   node .qa-tapdoan/sinh-tap-doan.mjs --chi-nhip            # làm tươi nhịp tim/WIP/cân bằng/sức khoẻ
 *   node .qa-tapdoan/sinh-tap-doan.mjs --go [--kho]          # gỡ SẠCH theo thứ tự ngược (kèm bảng vệ tinh)
 *   node .qa-tapdoan/sinh-tap-doan.mjs --gan=u1,u2           # gán user_factory_assignments cho 3 công ty
 *   node .qa-tapdoan/sinh-tap-doan.mjs --gan-tap-doan=u1     # gán user_corporate_assignments(QATD)
 *   tuỳ chọn: --z0  (ghi viTriZMm=0 cho MỌI máy thay vì = caoDoMm của tầng — xem ghi chú Z)
 *
 * Bắt chước `scripts/sinh-tai-twin.ts` + `scripts/go-tai-twin.ts` (đã đọc toàn văn):
 *   • LCG 32-bit + FNV-1a tất định (không Math.random) — cùng mã ⇒ cùng dãy.
 *   • Nhận dạng bằng MÃ `QATD-…`, không bằng enum `nguon` (nguon='sinh' còn là
 *     của 82 hàng thật SIM-FAC).
 *   • Owner `aoi` (avi_app là vai WORM, 42501 trên bảng twin). Không ghi
 *     `factories.floorWidthM/floorDepthM` (§10A.0).
 *   • `workshops.tangId` CÓ trong DB (mig 0350) nhưng KHÔNG có trong schema
 *     Drizzle ⇒ ghi bằng SQL thô (sinh-tai-twin :406-408).
 *   • MỘT đồng hồ cho cả lần chạy: mọi mốc là `now()` của giao dịch (cố định tại
 *     BEGIN) ± interval — không gọi Date.now() từng hàng.
 *
 * ★ GHI CHÚ Z (khác brief "Z=0"): đo được `client/src/components/twin3d/van-hanh/
 *   hopNhatCanh.ts:191` đưa THẲNG `viTriZMm` vào `mmSangScene` (scene.y = Z/1000,
 *   TUYỆT ĐỐI), tường bao `boCucTang.sinhTuongBao` dùng `zTam = caoDoMm + cao/2`,
 *   và `sinh-tai-twin` có cầu chì `kiemTrucZ` bắt máy ngoài dải [caoDo, caoDo+
 *   caoThongThuy]. Nên mặc định máy tầng N có Z = caoDoMm(N) (tầng 1 = 0). Cờ
 *   `--z0` ghi Z=0 cho mọi máy nếu chủ dự án vẫn muốn thế.
 *
 * ★ LỚP VẬN HÀNH — chỉ tái tạo phần 3 màn twin THẬT SỰ đọc (đo bằng grep
 *   `trpc.*` trong client/src/components/twin3d + pages/Twin*.tsx):
 *     màu máy        ← machines.operationStatus + lastHeartbeat (traTrangThaiHangLoat, ngưỡng 5')
 *     sức khoẻ       ← machine_health_history (traSucKhoeMay: mới nhất theo createdAt; client hạn 24h)
 *     badge andon    ← andon_events.resolvedAt IS NULL (andon.active, factoryCommand.overview)
 *     WIP (/twin/line) ← wip_tracking.exitedAt IS NULL theo lineId (digitalTwin.wipFlowState — KHÔNG cửa sổ giờ)
 *     nút thắt       ← line_balance_metrics theo lineId (wip.lineBalance; client hạn 8h trên periodEnd)
 *     /twin/may stats ← product_inspections theo machineId (dashboard.getMachineStats)
 *   BỎ (không màn nào trong 3 màn đọc): station_dwell_time, machine_heartbeats,
 *   machine_status_logs, ot_telemetry, rul_estimates. Nhưng `--go` VẪN xoá các
 *   bảng đó theo machineId vì SERVER ĐANG CHẠY tự bơm vào máy mới (go-tai-twin :382-424).
 */
import postgres from "postgres";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GOC_REPO = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
const co = (t) => args.includes(t);
const chuoiCo = (ten) => {
  const a = args.find((x) => x.startsWith(`--${ten}=`));
  return a ? a.slice(ten.length + 3) : null;
};
const CHI_DO = co("--kho") || co("--dry-run");
const Z_KHONG = co("--z0");

// ════════════════════════════════════════════════════════════════════════════
// HẰNG SỐ KỊCH BẢN
// ════════════════════════════════════════════════════════════════════════════
export const TIEN_TO = "QATD";
export const MA_TAP_DOAN = "QATD";
export const TEN_TAP_DOAN = "Tập đoàn QA Twin";
export const CONG_TY = Object.freeze([
  { ma: "QATD-A", ten: "Công ty A" },
  { ma: "QATD-B", ten: "Công ty B" },
  { ma: "QATD-C", ten: "Công ty C" },
]);
export const SO_TOA = 4;
export const SO_TANG = 7;
export const TANG_CO_XUONG = Object.freeze([1, 2]);
export const LINE_MIN = 3, LINE_MAX = 5;
export const MAY_MIN = 8, MAY_MAX = 15;
/** Mã nhà máy CẤM CHẠM (go-tai-twin.ts:67). */
export const MA_CAM_CHAM = Object.freeze(["SIM-FAC"]);

/** Hình học (mm). Footprint đủ chứa 15 máy REFLOW 4500 + khe 1500 + lối đi 2×10 m. */
export const HH = Object.freeze({
  daiToaMm: 110_000,      // trục X (twin_toa_nha.rongMm / twin_tang.daiMm)
  rongToaMm: 80_000,      // trục Y (twin_toa_nha.sauMm / twin_tang.rongMm)
  caoThongThuyMm: 6_000,  // mặc định twin_tang
  loiDiMm: 10_000,
  kheMayMm: 1_500,        // khoảng hở giữa hai máy kề nhau (theo brief)
  buocLineMm: 12_000,     // khoảng cách giữa hai line theo Y
  dayTuongMm: 200,        // DAY_TUONG_MM của boCucTang (đo: 4 tường SIM-FAC sau=200)
  buocToaXMm: 130_000,    // lưới 2×2 trong một cụm công ty
  buocToaYMm: 100_000,
  buocCumMm: 1_000_000,   // cụm công ty cách nhau 1 km (như sinh-tai-twin 4 km cho khối 3 km)
});
export const caoDoTangMm = (capSo) => (capSo - 1) * HH.caoThongThuyMm; // theo brief
export const KT_MAC_DINH = Object.freeze({ rongMm: 1200, caoMm: 1800, sauMm: 800 });

/** 24 giá trị machinetypeenum — đo bằng enum_range (drizzle/schema/enums.ts:15-43). */
export const LOAI_MAY = Object.freeze([
  "AVI", "AOI", "SPI", "AXI", "ICT", "FCT", "CMM", "AUTOMATION",
  "FEEDER", "ASSEMBLY", "SCREWDRIVE", "DISPENSING", "ICT_FUNC", "ROBOT_TEST",
  "PACKAGING", "PALLETIZER", "ROBOT", "MOUNTER", "REFLOW", "STENCIL_PRINTER",
  "WAVE_SOLDER", "WELDER", "IOT_SENSOR", "IOT_GATEWAY",
]);
/**
 * Phân bố trạng thái theo brief ~70/15/8/5/2, ánh xạ sang `operationstatusenum`
 * THẬT (running, stopped, error, maintenance, warming_up, changeover, starved,
 * blocked — không có 'idle'/'offline'):
 *   idle    → 'stopped'  (mapMachineStatus: stopped → idle)
 *   offline → 'stopped' + lastHeartbeat NULL (dangKetNoi false ⇒ 'offline'/khong_ro)
 */
export const PHAN_BO_TRANG_THAI = Object.freeze([
  { nhan: "running",     nguong: 0.70, enumGT: "running",     coNhip: true },
  { nhan: "idle",        nguong: 0.85, enumGT: "stopped",     coNhip: true },
  { nhan: "error",       nguong: 0.93, enumGT: "error",       coNhip: true },
  { nhan: "maintenance", nguong: 0.98, enumGT: "maintenance", coNhip: true },
  { nhan: "offline",     nguong: 1.01, enumGT: "stopped",     coNhip: false },
]);

// ════════════════════════════════════════════════════════════════════════════
// TẤT ĐỊNH — LCG + FNV-1a y hệt sinh-tai-twin.ts:201-217
// ════════════════════════════════════════════════════════════════════════════
export function taoNgauNhien(hat) {
  let s = hat >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
export function bamChuoi(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}
export const soLineCuaXuong = (maXuong) =>
  LINE_MIN + Math.floor(taoNgauNhien(bamChuoi(`${maXuong}:line`))() * (LINE_MAX - LINE_MIN + 1));
export const soMayCuaLine = (maLine) =>
  MAY_MIN + Math.floor(taoNgauNhien(bamChuoi(`${maLine}:may`))() * (MAY_MAX - MAY_MIN + 1));
/** Hoán vị 24 loại (Fisher–Yates tất định) rồi lấy n đầu ⇒ KHÔNG lặp loại trong line. */
export function loaiMayCuaLine(maLine, n) {
  const rnd = taoNgauNhien(bamChuoi(`${maLine}:loai`));
  const a = [...LOAI_MAY];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, n);
}
export function trangThaiCuaMay(maMay) {
  const x = taoNgauNhien(bamChuoi(`tt:${maMay}`))();
  return PHAN_BO_TRANG_THAI.find((p) => x < p.nguong);
}

// ════════════════════════════════════════════════════════════════════════════
// KẾ HOẠCH THUẦN — không chạm DB (mô hình 1, đối chiếu với count(*) = mô hình 2)
// ════════════════════════════════════════════════════════════════════════════
const pad2 = (n) => String(n).padStart(2, "0");
export function lapKeHoach(kichThuocTheoLoai) {
  const kt = (loai) => kichThuocTheoLoai.get(loai) ?? KT_MAC_DINH;
  const congTys = CONG_TY.map((ct, ci) => {
    const toas = [];
    for (let b = 1; b <= SO_TOA; b++) {
      const maToa = `${ct.ma}-T${b}`;
      const viTriXMm = ci * HH.buocCumMm + ((b - 1) % 2) * HH.buocToaXMm;
      const viTriYMm = Math.floor((b - 1) / 2) * HH.buocToaYMm;
      const tangs = [];
      for (let t = 1; t <= SO_TANG; t++) {
        const caoDo = caoDoTangMm(t);
        const tang = { capSo: t, ten: `Tầng ${t}`, caoDoMm: caoDo, xuong: null };
        if (TANG_CO_XUONG.includes(t)) {
          const maXuong = `${maToa}-X${t}`;
          const lines = [];
          const soLine = soLineCuaXuong(maXuong);
          for (let l = 1; l <= soLine; l++) {
            const maLine = `${maXuong}-L${l}`;
            const soMay = soMayCuaLine(maLine);
            const loais = loaiMayCuaLine(maLine, soMay);
            const yMm = HH.loiDiMm + (l - 1) * HH.buocLineMm;
            let conTro = HH.loiDiMm;
            const mays = loais.map((loai, i) => {
              const k = kt(loai);
              const xMm = conTro + k.rongMm / 2;
              conTro += k.rongMm + HH.kheMayMm;
              const maMay = `${maLine}-M${pad2(i + 1)}`;
              const tt = trangThaiCuaMay(maMay);
              return {
                thuTu: i,
                maTram: `${maLine}-S${pad2(i + 1)}`,
                tenTram: `Trạm ${pad2(i + 1)}`,
                ma: maMay,
                ten: `${loai}-${pad2(i + 1)}`,
                loai,
                kichThuoc: k,
                xMm, yMm, zMm: Z_KHONG ? 0 : caoDo,
                trangThai: tt.nhan, enumGT: tt.enumGT, coNhip: tt.coNhip,
              };
            });
            lines.push({ ma: maLine, ten: `Line ${l}`, thuTu: l, mays });
          }
          tang.xuong = { ma: maXuong, ten: `Xưởng T${b} tầng ${t}`, lines };
        }
        tangs.push(tang);
      }
      toas.push({ ma: maToa, ten: `Toà ${b}`, thuTu: b, viTriXMm, viTriYMm, tangs });
    }
    return { ...ct, toas };
  });
  return { maTapDoan: MA_TAP_DOAN, tenTapDoan: TEN_TAP_DOAN, congTys };
}
export function demKeHoach(kh) {
  const d = { congTy: 0, toa: 0, tang: 0, xuong: 0, line: 0, tram: 0, may: 0, tuong: 0, theoLoai: {}, theoTrangThai: {}, theoCongTy: {} };
  for (const ct of kh.congTys) {
    d.congTy++;
    const dc = { line: 0, may: 0, theoLoai: {}, theoTrangThai: {} };
    for (const toa of ct.toas) {
      d.toa++;
      for (const tang of toa.tangs) {
        d.tang++; d.tuong += 4;
        if (!tang.xuong) continue;
        d.xuong++;
        for (const ln of tang.xuong.lines) {
          d.line++; dc.line++;
          for (const m of ln.mays) {
            d.tram++; d.may++; dc.may++;
            d.theoLoai[m.loai] = (d.theoLoai[m.loai] ?? 0) + 1;
            d.theoTrangThai[m.trangThai] = (d.theoTrangThai[m.trangThai] ?? 0) + 1;
            dc.theoLoai[m.loai] = (dc.theoLoai[m.loai] ?? 0) + 1;
            dc.theoTrangThai[m.trangThai] = (dc.theoTrangThai[m.trangThai] ?? 0) + 1;
          }
        }
      }
    }
    d.theoCongTy[ct.ma] = dc;
  }
  return d;
}
/** Tường bao một tầng — cùng công thức `boCucTang.sinhTuongBao` (tâm, Z tuyệt đối). */
export function tuongBaoTang(caoDoMm) {
  const dai = HH.daiToaMm, rong = HH.rongToaMm, cao = HH.caoThongThuyMm, d = HH.dayTuongMm;
  const zTam = caoDoMm + cao / 2;
  const daiTrucY = Math.max(rong - 2 * d, 0);
  return [
    { ten: "Tường Bắc", x: dai / 2, y: d / 2, z: zTam, rong: dai, cao, sau: d },
    { ten: "Tường Nam", x: dai / 2, y: rong - d / 2, z: zTam, rong: dai, cao, sau: d },
    { ten: "Tường Tây", x: d / 2, y: rong / 2, z: zTam, rong: d, cao, sau: daiTrucY },
    { ten: "Tường Đông", x: dai - d / 2, y: rong / 2, z: zTam, rong: d, cao, sau: daiTrucY },
  ];
}

// ════════════════════════════════════════════════════════════════════════════
// DB
// ════════════════════════════════════════════════════════════════════════════
function napEnv(p) {
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf-8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
}
napEnv(path.join(GOC_REPO, ".env"));
function urlOwner() {
  if (process.env.MIGRATION_DB_URL) return process.env.MIGRATION_DB_URL;
  const raw = process.env.DATABASE_URL;
  if (!raw) { console.error("LOI: DATABASE_URL chua dat."); process.exit(1); }
  const u = new URL(raw);
  u.username = process.env.MIGRATION_DB_USER ?? "aoi";
  u.password = process.env.MIGRATION_DB_PASSWORD ?? "aoi";
  return u.toString();
}
const sql = postgres(urlOwner(), { max: 1, connect_timeout: 30 });

function tieuDe(s) {
  console.log(""); console.log("=".repeat(74)); console.log("  " + s); console.log("=".repeat(74));
}
async function kiemOwner() {
  const [{ nguoiDung, csdl, tz }] = await sql`SELECT current_user AS "nguoiDung", current_database() AS "csdl", current_setting('TimeZone') AS tz`;
  console.log(`  Vai: ${nguoiDung}   CSDL: ${csdl}   TimeZone phien: ${tz}`);
  if (nguoiDung !== "aoi") {
    console.error(`LOI: can owner 'aoi' (avi_app khong ghi duoc bang twin — 42501). Dang la '${nguoiDung}'. DUNG.`);
    await sql.end(); process.exit(1);
  }
  return { nguoiDung, csdl };
}
/** Số hàng mang tiền tố QATD ở mọi bảng có mã — cầu chì "chưa có QATD nào". */
async function demQATD() {
  const [r] = await sql`
    SELECT
      (SELECT count(*)::int FROM corporates      WHERE code = ${MA_TAP_DOAN})           AS corporates,
      (SELECT count(*)::int FROM factories       WHERE code LIKE ${TIEN_TO + "-%"})     AS factories,
      (SELECT count(*)::int FROM workshops       WHERE code LIKE ${TIEN_TO + "-%"})     AS workshops,
      (SELECT count(*)::int FROM production_lines WHERE code LIKE ${TIEN_TO + "-%"})    AS production_lines,
      (SELECT count(*)::int FROM stations        WHERE code LIKE ${TIEN_TO + "-%"})     AS stations,
      (SELECT count(*)::int FROM machines        WHERE code LIKE ${TIEN_TO + "-%"})     AS machines,
      (SELECT count(*)::int FROM twin_toa_nha    WHERE ma   LIKE ${TIEN_TO + "-%"})     AS twin_toa_nha,
      (SELECT count(*)::int FROM user_factory_assignments   WHERE "factoryCode"   LIKE ${TIEN_TO + "-%"}) AS user_factory_assignments,
      (SELECT count(*)::int FROM user_corporate_assignments WHERE "corporateCode" = ${MA_TAP_DOAN})       AS user_corporate_assignments
  `;
  return r;
}
/** Bất biến nền: máy SIM-FAC, tổng người dùng, tổng factories/corporates KHÔNG-QATD. */
async function doNen() {
  const [r] = await sql`
    SELECT
      (SELECT count(*)::int FROM machines m
         JOIN stations s ON s.id = m."stationId" JOIN production_lines p ON p.id = s."lineId"
         JOIN workshops w ON w.id = p."workshopId" JOIN factories f ON f.id = w."factoryId"
        WHERE f.code = 'SIM-FAC')                                                    AS "maySimFac",
      (SELECT count(*)::int FROM users)                                              AS "nguoiDung",
      (SELECT count(*)::int FROM factories  WHERE code NOT LIKE ${TIEN_TO + "-%"})    AS "nhaMayKhac",
      (SELECT count(*)::int FROM corporates WHERE code <> ${MA_TAP_DOAN})             AS "tapDoanKhac",
      (SELECT count(*)::int FROM machines   WHERE code NOT LIKE ${TIEN_TO + "-%"})    AS "mayKhac",
      (SELECT count(*)::int FROM twin_dat_cho d JOIN twin_tang t ON t.id = d."tangId"
         JOIN twin_toa_nha n ON n.id = t."toaNhaId" WHERE n.ma NOT LIKE ${TIEN_TO + "-%"}) AS "datChoKhac"
  `;
  return r;
}
async function docKichThuocLoai() {
  const rows = await sql`SELECT "loaiMay", "rongMm"::float8 r, "caoMm"::float8 c, "sauMm"::float8 s FROM twin_kich_thuoc_loai`;
  const m = new Map();
  for (const x of rows) m.set(x.loaiMay, { rongMm: x.r, caoMm: x.c, sauMm: x.s });
  return m;
}
function inKeHoach(kh, dem) {
  console.log(`\n  Tap doan ${kh.maTapDoan} (${kh.tenTapDoan})`);
  console.log(`  Ky vong: cong ty 3 · toa 12 · tang 84 · xuong 24 · line [72,120] · may [576,1800]`);
  console.log(`  Ke hoach: cong ty ${dem.congTy} · toa ${dem.toa} · tang ${dem.tang} · xuong ${dem.xuong} · line ${dem.line} · tram ${dem.tram} · may ${dem.may} · tuong ${dem.tuong}`);
  for (const ct of kh.congTys) {
    const dc = dem.theoCongTy[ct.ma];
    console.log(`\n  ${ct.ma} "${ct.ten}": line=${dc.line} may=${dc.may}`);
    for (const toa of ct.toas) {
      const xs = toa.tangs.filter((t) => t.xuong).map((t) =>
        `${t.xuong.ma}[${t.xuong.lines.map((l) => l.mays.length).join(",")}]`);
      console.log(`    ${toa.ma} @(${toa.viTriXMm},${toa.viTriYMm}) 7 tang · ${xs.join("  ")}`);
    }
  }
  console.log(`\n  Phan bo trang thai: ${JSON.stringify(dem.theoTrangThai)}`);
  const tongTT = Object.values(dem.theoTrangThai).reduce((a, b) => a + b, 0);
  console.log(`    ti le: ${Object.entries(dem.theoTrangThai).map(([k, v]) => `${k}=${(100 * v / tongTT).toFixed(1)}%`).join("  ")}`);
  console.log(`  Phan bo loai (${Object.keys(dem.theoLoai).length}/24 loai co mat): ${JSON.stringify(dem.theoLoai)}`);
  console.log(`  Z may: ${Z_KHONG ? "0 cho MOI may (--z0)" : "= caoDoMm cua tang (tang1=0, tang2=" + caoDoTangMm(2) + ")"}`);
}

// ════════════════════════════════════════════════════════════════════════════
// --kho
// ════════════════════════════════════════════════════════════════════════════
async function cheDoKho() {
  tieuDe("SINH TAP DOAN QA TWIN   [--kho: CHI IN KE HOACH, KHONG GHI]");
  await kiemOwner();
  const q = await demQATD();
  const tongQ = Object.values(q).reduce((a, b) => a + b, 0);
  console.log(`  Ma QATD dang co: ${JSON.stringify(q)}  => ${tongQ === 0 ? "CHUA CO (sach)" : "DA CO " + tongQ + " hang — --ghi se TU CHOI"}`);
  const nen = await doNen();
  console.log(`  Nen: ${JSON.stringify(nen)}`);
  const kt = await docKichThuocLoai();
  console.log(`  twin_kich_thuoc_loai: ${kt.size}/24 loai co kich thuoc (thieu -> ${JSON.stringify(KT_MAC_DINH)})`);
  const kh = lapKeHoach(kt);
  const dem = demKeHoach(kh);
  inKeHoach(kh, dem);
  const loi = [];
  if (dem.line < 72 || dem.line > 120) loi.push(`line=${dem.line} ngoai [72,120]`);
  if (dem.may < 576 || dem.may > 1800) loi.push(`may=${dem.may} ngoai [576,1800]`);
  if (dem.toa !== 12 || dem.tang !== 84 || dem.xuong !== 24) loi.push("toa/tang/xuong sai");
  // Máy KHÔNG lặp loại trong line — kiểm trên kế hoạch (mô hình 1)
  for (const ct of kh.congTys) for (const toa of ct.toas) for (const t of toa.tangs) if (t.xuong)
    for (const l of t.xuong.lines) if (new Set(l.mays.map((m) => m.loai)).size !== l.mays.length) loi.push(`lap loai ${l.ma}`);
  // Máy nằm trong footprint
  for (const ct of kh.congTys) for (const toa of ct.toas) for (const t of toa.tangs) if (t.xuong)
    for (const l of t.xuong.lines) for (const m of l.mays)
      if (m.xMm + m.kichThuoc.rongMm / 2 > HH.daiToaMm || m.yMm + m.kichThuoc.sauMm / 2 > HH.rongToaMm) loi.push(`ngoai footprint ${m.ma}`);
  console.log(`\n  Kiem ke hoach: ${loi.length === 0 ? "DAT" : "LOI: " + loi.join("; ")}`);
  console.log("\n  [--kho] KHONG ghi gi. Dung.");
  await sql.end();
  if (loi.length) process.exit(1);
}

// ════════════════════════════════════════════════════════════════════════════
// --ghi
// ════════════════════════════════════════════════════════════════════════════
const chunk = (a, n) => { const r = []; for (let i = 0; i < a.length; i += n) r.push(a.slice(i, i + n)); return r; };
const cot = (rows, k) => rows.map((r) => r[k]);

async function cheDoGhi() {
  tieuDe("SINH TAP DOAN QA TWIN   [--ghi]");
  await kiemOwner();
  const q = await demQATD();
  if (Object.values(q).some((n) => n > 0)) {
    console.error(`LOI: da co ma QATD: ${JSON.stringify(q)}. Chay '--go' truoc. DUNG.`);
    await sql.end(); process.exit(1);
  }
  const nenTruoc = await doNen();
  console.log(`  Nen TRUOC: ${JSON.stringify(nenTruoc)}`);
  const kt = await docKichThuocLoai();
  const kh = lapKeHoach(kt);
  const dem = demKeHoach(kh);
  inKeHoach(kh, dem);

  const [{ adminId }] = await sql`SELECT id AS "adminId" FROM users WHERE username = 'admin' AND role = 'admin' ORDER BY id LIMIT 1`.then((r) => r.length ? r : [{ adminId: null }]);
  console.log(`\n  admin id (assignedBy cho --gan): ${adminId}`);

  const ghi = { corporates: 0, factories: 0, twin_toa_nha: 0, twin_tang: 0, twin_vat_the: 0, workshops: 0, production_lines: 0, stations: 0, machines: 0, twin_dat_cho: 0, machine_health_history: 0, wip_tracking: 0, line_balance_metrics: 0, andon_events: 0, product_inspections: 0 };
  const tomTat = { chayLuc: new Date().toISOString(), tienTo: TIEN_TO, zMay: Z_KHONG ? "0" : "caoDoMm(tang)", tapDoan: null, congTys: [], toas: [], tangs: [], xuongs: [] };
  const t0 = Date.now();

  await sql.begin(async (tx) => {
    const [cp] = await tx`INSERT INTO corporates (code, name, description, "isActive") VALUES (${MA_TAP_DOAN}, ${TEN_TAP_DOAN}, ${"Du lieu QA sinh boi .qa-tapdoan/sinh-tap-doan.mjs — go bang --go"}, true) RETURNING id`;
    ghi.corporates++;
    tomTat.tapDoan = { id: cp.id, code: MA_TAP_DOAN };

    for (const ct of kh.congTys) {
      const [nm] = await tx`INSERT INTO factories (code, name, description, "corporateCode", "isActive")
        VALUES (${ct.ma}, ${ct.ten}, ${"Cong ty QA sinh boi .qa-tapdoan/sinh-tap-doan.mjs — KHONG phai du lieu that"}, ${MA_TAP_DOAN}, true) RETURNING id`;
      ghi.factories++;
      const ttCT = { id: nm.id, code: ct.ma, ten: ct.ten, lineDauId: null, mayDauId: null, lineDauMa: null, mayDauMa: null, tongMay: 0, tongLine: 0, phanBoLoai: {}, phanBoTrangThai: {} };

      for (const toa of ct.toas) {
        const [tn] = await tx`INSERT INTO twin_toa_nha ("factoryId", ma, ten, "viTriXMm", "viTriYMm", "viTriZMm", "rongMm", "sauMm", "caoMm", nguon, "isActive")
          VALUES (${nm.id}, ${toa.ma}, ${toa.ten}, ${toa.viTriXMm}, ${toa.viTriYMm}, 0, ${HH.daiToaMm}, ${HH.rongToaMm}, ${SO_TANG * HH.caoThongThuyMm}, 'sinh', true) RETURNING id`;
        ghi.twin_toa_nha++;
        tomTat.toas.push({ id: tn.id, ma: toa.ma, factoryId: nm.id });

        for (const tang of toa.tangs) {
          const [tg] = await tx`INSERT INTO twin_tang ("toaNhaId", "capSo", ten, "caoDoMm", "caoThongThuyMm", "daiMm", "rongMm", "nguonHinhHoc", nguon, "isActive")
            VALUES (${tn.id}, ${tang.capSo}, ${tang.ten}, ${tang.caoDoMm}, ${HH.caoThongThuyMm}, ${HH.daiToaMm}, ${HH.rongToaMm}, 'sinh', 'sinh', true) RETURNING id`;
          ghi.twin_tang++;
          tomTat.tangs.push({ id: tg.id, toaNhaId: tn.id, capSo: tang.capSo, caoDoMm: tang.caoDoMm });

          // Tường bao — 4 bức, nguon='sinh' tường minh (twin_vat_the mặc định 'tay').
          const tb = tuongBaoTang(tang.caoDoMm);
          const rT = await tx`INSERT INTO twin_vat_the ("tangId", loai, ten, "viTriXMm","viTriYMm","viTriZMm","rongMm","caoMm","sauMm", "thuTu", nguon)
            SELECT ${tg.id}, 'tuong'::twinvattheenum, u.ten, u.x, u.y, u.z, u.r, u.c, u.s, u.i, 'sinh'::twinnguonenum
              FROM unnest(${cot(tb, "ten")}::text[], ${cot(tb, "x")}::numeric[], ${cot(tb, "y")}::numeric[], ${cot(tb, "z")}::numeric[],
                          ${cot(tb, "rong")}::numeric[], ${cot(tb, "cao")}::numeric[], ${cot(tb, "sau")}::numeric[], ${tb.map((_, i) => i)}::int[]) AS u(ten,x,y,z,r,c,s,i)`;
          ghi.twin_vat_the += rT.count;

          if (!tang.xuong) continue;
          const xg = tang.xuong;
          const [ws] = await tx`INSERT INTO workshops ("factoryId", code, name, "isActive", "tangId")
            VALUES (${nm.id}, ${xg.ma}, ${xg.ten}, true, ${tg.id}) RETURNING id`;
          ghi.workshops++;
          tomTat.xuongs.push({ id: ws.id, ma: xg.ma, tangId: tg.id, factoryId: nm.id });
          // Đặt chỗ xưởng — tâm mặt sàn (sinh-tai-twin :413-416)
          await tx`INSERT INTO twin_dat_cho ("tangId","loaiThucThe","thucTheId","viTriXMm","viTriYMm","viTriZMm","kichThuocDaDo",nguon,"hienThi")
            VALUES (${tg.id}, 'workshop', ${ws.id}, ${HH.daiToaMm / 2}, ${HH.rongToaMm / 2}, ${Z_KHONG ? 0 : tang.caoDoMm}, false, 'sinh', true)`;
          ghi.twin_dat_cho++;

          for (const ln of xg.lines) {
            const [pl] = await tx`INSERT INTO production_lines ("workshopId", code, name, "isActive")
              VALUES (${ws.id}, ${ln.ma}, ${ln.ten}, true) RETURNING id`;
            ghi.production_lines++;
            ttCT.tongLine++;
            if (ttCT.lineDauId === null) { ttCT.lineDauId = pl.id; ttCT.lineDauMa = ln.ma; }
            // §10C.1: line là PHẠM VI — hàng 'line' chỉ giữ nhãn (sinh-tai-twin :430-433)
            await tx`INSERT INTO twin_dat_cho ("tangId","loaiThucThe","thucTheId","viTriXMm","viTriYMm","viTriZMm","kichThuocDaDo",nguon,"hienThi")
              VALUES (${tg.id}, 'line', ${pl.id}, 0, 0, ${Z_KHONG ? 0 : tang.caoDoMm}, false, 'sinh', true)`;
            ghi.twin_dat_cho++;

            // Trạm 1:1 với máy — bulk, ánh xạ id theo CODE (không tin thứ tự RETURNING)
            const mays = ln.mays;
            const tramRows = await tx`INSERT INTO stations ("lineId", code, name, "orderIndex", "isActive")
              SELECT ${pl.id}, u.code, u.ten, u.i, true
                FROM unnest(${cot(mays, "maTram")}::text[], ${cot(mays, "tenTram")}::text[], ${cot(mays, "thuTu")}::int[]) AS u(code, ten, i)
              RETURNING id, code`;
            ghi.stations += tramRows.length;
            const tramId = new Map(tramRows.map((r) => [r.code, r.id]));
            const stIds = mays.map((m) => tramId.get(m.maTram));
            if (stIds.some((x) => x == null)) throw new Error(`thieu id tram o ${ln.ma}`);

            // Máy — operationStatus + lastHeartbeat ghi NGAY ở đây (nguồn màu; sinh-tai-twin :449-453)
            const mayRows = await tx`INSERT INTO machines ("stationId", code, name, "machineType", "isActive", "operationStatus", "lastHeartbeat", "registrationStatus", "lifecycleStatus", description)
              SELECT u.st, u.code, u.ten, u.loai::machinetypeenum, true, u.tt::operationstatusenum,
                     CASE WHEN u.nhip = 1 THEN now() ELSE NULL END, 'approved', 'active', 'May QA sinh boi .qa-tapdoan/sinh-tap-doan.mjs'
                FROM unnest(${stIds}::int[], ${cot(mays, "ma")}::text[], ${cot(mays, "ten")}::text[], ${cot(mays, "loai")}::text[],
                            ${cot(mays, "enumGT")}::text[], ${mays.map((m) => (m.coNhip ? 1 : 0))}::int[]) AS u(st, code, ten, loai, tt, nhip)
              RETURNING id, code`;
            ghi.machines += mayRows.length;
            const mayId = new Map(mayRows.map((r) => [r.code, r.id]));
            const mIds = mays.map((m) => mayId.get(m.ma));
            if (mIds.some((x) => x == null)) throw new Error(`thieu id may o ${ln.ma}`);
            if (ttCT.mayDauId === null) { ttCT.mayDauId = mIds[0]; ttCT.mayDauMa = mays[0].ma; }
            ttCT.tongMay += mays.length;
            for (const m of mays) {
              ttCT.phanBoLoai[m.loai] = (ttCT.phanBoLoai[m.loai] ?? 0) + 1;
              ttCT.phanBoTrangThai[m.trangThai] = (ttCT.phanBoTrangThai[m.trangThai] ?? 0) + 1;
            }

            // Đặt chỗ trạm (kích thước NULL) + máy (kích thước theo loại, chưa đo)
            const xs = cot(mays, "xMm"), ys = cot(mays, "yMm"), zs = cot(mays, "zMm");
            const rS = await tx`INSERT INTO twin_dat_cho ("tangId","loaiThucThe","thucTheId","viTriXMm","viTriYMm","viTriZMm","rongMm","caoMm","sauMm","kichThuocDaDo",nguon,"hienThi")
              SELECT ${tg.id}, 'station'::twinthuctheenum, u.i, u.x, u.y, u.z, NULL, NULL, NULL, false, 'sinh', true
                FROM unnest(${stIds}::int[], ${xs}::numeric[], ${ys}::numeric[], ${zs}::numeric[]) AS u(i,x,y,z)`;
            const rM = await tx`INSERT INTO twin_dat_cho ("tangId","loaiThucThe","thucTheId","viTriXMm","viTriYMm","viTriZMm","rongMm","caoMm","sauMm","kichThuocDaDo",nguon,"hienThi")
              SELECT ${tg.id}, 'machine'::twinthuctheenum, u.i, u.x, u.y, u.z, u.r, u.c, u.s, false, 'sinh', true
                FROM unnest(${mIds}::int[], ${xs}::numeric[], ${ys}::numeric[], ${zs}::numeric[],
                            ${mays.map((m) => m.kichThuoc.rongMm)}::numeric[], ${mays.map((m) => m.kichThuoc.caoMm)}::numeric[], ${mays.map((m) => m.kichThuoc.sauMm)}::numeric[]) AS u(i,x,y,z,r,c,s)`;
            ghi.twin_dat_cho += rS.count + rM.count;

            // ── LỚP VẬN HÀNH TỐI THIỂU ──────────────────────────────────────
            /*
             * ⚠ 2026-09-16 — T3 của đợt nghiệm thu đo được hai chỉ số rủi ro MÂU THUẪN trên
             *   màn máy. Đã truy nguyên, và nguồn KHÔNG phải khối này:
             *
             *   · `machine_health_history` (ngay dưới) đặt `risk = 100 - health` ⇒ hai đại
             *     lượng ở đây **đã phụ thuộc nhau đúng chiều**.
             *   · `predictive_alerts` thì bộ sinh này **KHÔNG ghi dòng nào** — chúng do chính
             *     máy chủ đang chạy bơm vào theo logic riêng, không nhìn `healthScore` mà bộ
             *     sinh đặt. Đo được: tỉ lệ máy có cảnh báo mở theo hạng sức khoẻ là
             *     53,5 / 49,6 / 49,7 / 55,8 % — phẳng, và hạng KHOẺ NHẤT lại cao nhất.
             *
             *   ⇒ Muốn dữ liệu thử nhất quán, phải sinh `predictive_alerts` phụ thuộc
             *     `healthScore` **và** tắt đường bơm của máy chủ trong lúc sinh, hoặc chấp
             *     nhận rằng hai nguồn độc lập là đặc tính của môi trường thử và nói ra điều
             *     đó khi đọc số. Chưa làm — thuộc đợt vá PH-39.
             */
            // Sức khoẻ: 1 hàng/máy; traSucKhoeMay đọc healthScore, predictedFailureRisk,
            // maintenanceUrgency, recommendedMaintenanceDate, createdAt (mới nhất).
            const sk = mays.map((m) => {
              const rnd = taoNgauNhien(bamChuoi(`sk:${m.ma}`));
              const health = 40 + Math.floor(rnd() * 60);
              const gan = () => Math.max(0, Math.min(100, health + Math.floor(rnd() * 11) - 5));
              const risk = 100 - health;
              return { health, oee: gan(), up: gan(), err: gan(), cyc: gan(), risk,
                khan: risk >= 60 ? "CRITICAL" : risk >= 40 ? "HIGH" : risk >= 20 ? "MEDIUM" : "LOW", ngay: Math.max(1, health - 30) };
            });
            const rH = await tx`INSERT INTO machine_health_history ("machineId","machineCode","timestamp","healthScore","oeeScore","uptimeScore","errorRateScore","cycleTimeScore","predictedFailureRisk","maintenanceUrgency","recommendedMaintenanceDate",notes)
              SELECT u.id, u.code, now(), u.h, u.o, u.up, u.e, u.c, u.r, u.k::maintenanceurgencyenum, now() + (u.ng * interval '1 day'), 'QATD sinh'
                FROM unnest(${mIds}::int[], ${cot(mays, "ma")}::text[], ${cot(sk, "health")}::int[], ${cot(sk, "oee")}::int[], ${cot(sk, "up")}::int[],
                            ${cot(sk, "err")}::int[], ${cot(sk, "cyc")}::int[], ${cot(sk, "risk")}::int[], ${cot(sk, "khan")}::text[], ${cot(sk, "ngay")}::int[]) AS u(id,code,h,o,up,e,c,r,k,ng)`;
            ghi.machine_health_history += rH.count;

            // WIP: nút thắt giữa line 20–29 sản phẩm, trạm khác 2–5; exitedAt NULL; in_process.
            const nghen = Math.floor(mays.length / 2);
            const wip = [];
            let stt = 0;
            mays.forEach((m, i) => {
              const rnd = taoNgauNhien(bamChuoi(`wip:${m.ma}`));
              const n = i === nghen ? 20 + Math.floor(rnd() * 10) : 2 + Math.floor(rnd() * 4);
              for (let k = 0; k < n; k++) {
                wip.push({ sn: `QATD-WIP-${pl.id}-${stIds[i]}-${k}`, st: stIds[i], m: mIds[i], phut: ((stt + k) % 24) * 55 }); // trải 22h, 24 mốc
              }
              stt += n;
            });
            for (const c of chunk(wip, 1000)) {
              const rW = await tx`INSERT INTO wip_tracking ("serialNumber","lineId","currentStationId","currentMachineId",status,quantity,"enteredAt")
                SELECT u.sn, ${pl.id}, u.st, u.m, 'in_process'::wipstatusenum, 1, now() - interval '22 hours' + (u.p * interval '1 minute')
                  FROM unnest(${cot(c, "sn")}::text[], ${cot(c, "st")}::int[], ${cot(c, "m")}::int[], ${cot(c, "phut")}::int[]) AS u(sn,st,m,p)`;
              ghi.wip_tracking += rW.count;
            }

            // Cân bằng line: 1 hàng, periodEnd = now()-2h (client hạn 8h).
            await tx`INSERT INTO line_balance_metrics ("lineId","periodStart","periodEnd","bottleneckStationId","bottleneckMachineId","utilizationPct","balanceRatePct","throughputUnits","wipCount","avgCycleTimeMs")
              VALUES (${pl.id}, now() - interval '3 hours', now() - interval '2 hours', ${stIds[nghen]}, ${mIds[nghen]}, 72.5, 64.0, 480, ${wip.length}, 12000)`;
            ghi.line_balance_metrics++;

            // Andon: ~50% line có 1 cảnh báo mở tại nút thắt (badge). Tất định theo mã line.
            const rndA = taoNgauNhien(bamChuoi(`andon:${ln.ma}`));
            if (rndA() < 0.5) {
              const lyDo = ["quality", "material", "maintenance", "safety", "setup", "other"][Math.floor(rndA() * 6)];
              await tx`INSERT INTO andon_events (state, reason, status, "lineId", "stationId", "machineId", title, "raisedBySystem", "raisedAt")
                VALUES (${rndA() < 0.5 ? "red" : "yellow"}::andonstateenum, ${lyDo}::andonreasonenum, 'raised'::andonstatusenum,
                        ${pl.id}, ${stIds[nghen]}, ${mIds[nghen]}, ${`Ùn tắc tại trạm ${pad2(nghen + 1)} (QATD)`}, true, now() - interval '15 minutes')`;
              ghi.andon_events++;
            }

            // Kiểm tra sản phẩm: 6 hàng/máy, factoryCode + corporateCode ĐIỀN (trục mã tenant; sinh-tai-twin :586-610).
            const ins = [];
            mays.forEach((m, i) => {
              const rnd = taoNgauNhien(bamChuoi(`kt:${m.ma}`));
              const tiLeNg = rnd() * 0.25;
              for (let k = 0; k < 6; k++) ins.push({ m: mIds[i], sn: `QATD-INS-${mIds[i]}-${k}`, kq: rnd() < tiLeNg ? "NG" : "OK", phut: k * 200 });
            });
            const rI = await tx`INSERT INTO product_inspections ("machineId","serialNumber","overallResult","originalResult","inspectionTime","factoryCode","corporateCode")
              SELECT u.m, u.sn, u.kq::overallresultenum, u.kq::originalresultenum, now() - interval '20 hours' + (u.p * interval '1 minute'), ${ct.ma}, ${MA_TAP_DOAN}
                FROM unnest(${cot(ins, "m")}::int[], ${cot(ins, "sn")}::text[], ${cot(ins, "kq")}::text[], ${cot(ins, "phut")}::int[]) AS u(m,sn,kq,p)`;
            ghi.product_inspections += rI.count;
          }
        }
      }
      tomTat.congTys.push(ttCT);
    }
  });
  console.log(`\n  DA GHI trong ${((Date.now() - t0) / 1000).toFixed(1)}s (mot giao dich):`);
  for (const [k, v] of Object.entries(ghi)) console.log(`    ${k.padEnd(24)} ${v}`);

  const ok = await cauChi(kh, dem, nenTruoc);
  tomTat.ghi = ghi;
  tomTat.cauChi = ok.ketQua;
  tomTat.urlMau = tomTat.congTys.map((c) => ({ congTy: c.code, twin: `/twin?nm=${c.id}`, line: `/twin/line/${c.lineDauId}`, may: `/twin/may/${c.mayDauId}` }));
  fs.writeFileSync(path.join(__dirname, "sinh-summary.json"), JSON.stringify(tomTat, null, 2));
  console.log(`\n  Tom tat: .qa-tapdoan/sinh-summary.json`);
  await sql.end();
  if (!ok.dat) { console.error("\nLOI: CAU CHI DO. Chay '--go' roi sua."); process.exit(1); }
}

// ════════════════════════════════════════════════════════════════════════════
// CẦU CHÌ — SQL ĐỘC LẬP, không dùng biến đếm trong bộ nhớ (BG-127 hai mô hình rời)
// ════════════════════════════════════════════════════════════════════════════
async function cauChi(kh, dem, nenTruoc) {
  console.log("\n  CAU CHI (do lai tu DB bang SQL doc lap):");
  const kq = {};
  const kiem = (ten, thucTe, kyVong, dieuKien) => {
    const dat = dieuKien ? dieuKien(thucTe) : thucTe === kyVong;
    kq[ten] = { thucTe, kyVong, dat };
    console.log(`    ${dat ? "DAT " : "VO  "} ${ten.padEnd(52)} ${String(thucTe).padStart(6)}   (ky vong ${kyVong})`);
    return dat;
  };
  const one = async (q) => Number((await q)[0].n);
  const like = TIEN_TO + "-%";
  const dsDat = [];
  dsDat.push(kiem("corporates QATD", await one(sql`SELECT count(*)::int n FROM corporates WHERE code=${MA_TAP_DOAN}`), 1));
  dsDat.push(kiem("factories corporateCode='QATD'", await one(sql`SELECT count(*)::int n FROM factories WHERE "corporateCode"=${MA_TAP_DOAN} AND code LIKE ${like}`), 3));
  dsDat.push(kiem("twin_toa_nha cua 3 cong ty", await one(sql`SELECT count(*)::int n FROM twin_toa_nha n JOIN factories f ON f.id=n."factoryId" WHERE f."corporateCode"=${MA_TAP_DOAN}`), 12));
  dsDat.push(kiem("twin_tang cua 12 toa", await one(sql`SELECT count(*)::int n FROM twin_tang t JOIN twin_toa_nha n ON n.id=t."toaNhaId" JOIN factories f ON f.id=n."factoryId" WHERE f."corporateCode"=${MA_TAP_DOAN}`), 84));
  dsDat.push(kiem("twin_tang capSo 1..7 moi toa (toa co du 7)", await one(sql`SELECT count(*)::int n FROM (SELECT n.id FROM twin_toa_nha n JOIN twin_tang t ON t."toaNhaId"=n.id WHERE n.ma LIKE ${like} GROUP BY n.id HAVING array_agg(t."capSo" ORDER BY t."capSo") = ARRAY[1,2,3,4,5,6,7]) x`), 12));
  dsDat.push(kiem("twin_vat_the tuong (4/tang)", await one(sql`SELECT count(*)::int n FROM twin_vat_the v JOIN twin_tang t ON t.id=v."tangId" JOIN twin_toa_nha n ON n.id=t."toaNhaId" WHERE n.ma LIKE ${like} AND v.loai='tuong' AND v.nguon='sinh'`), 84 * 4));
  dsDat.push(kiem("workshops QATD", await one(sql`SELECT count(*)::int n FROM workshops WHERE code LIKE ${like}`), 24));
  dsDat.push(kiem("workshops co tangId o tang capSo in (1,2)", await one(sql`SELECT count(*)::int n FROM workshops w JOIN twin_tang t ON t.id=w."tangId" WHERE w.code LIKE ${like} AND t."capSo" IN (1,2)`), 24));
  dsDat.push(kiem("xuong co so line ngoai [3,5]", await one(sql`SELECT count(*)::int n FROM (SELECT w.id, count(p.id) c FROM workshops w LEFT JOIN production_lines p ON p."workshopId"=w.id WHERE w.code LIKE ${like} GROUP BY w.id HAVING count(p.id) < 3 OR count(p.id) > 5) x`), 0));
  const soLine = await one(sql`SELECT count(*)::int n FROM production_lines WHERE code LIKE ${like}`);
  dsDat.push(kiem("production_lines QATD = ke hoach", soLine, dem.line));
  dsDat.push(kiem("line co so may ngoai [8,15]", await one(sql`SELECT count(*)::int n FROM (SELECT p.id, count(m.id) c FROM production_lines p JOIN stations s ON s."lineId"=p.id JOIN machines m ON m."stationId"=s.id WHERE p.code LIKE ${like} GROUP BY p.id HAVING count(m.id) < 8 OR count(m.id) > 15) x`), 0));
  dsDat.push(kiem("line co loai may LAP (distinct<>count)", await one(sql`SELECT count(*)::int n FROM (SELECT p.id FROM production_lines p JOIN stations s ON s."lineId"=p.id JOIN machines m ON m."stationId"=s.id WHERE p.code LIKE ${like} GROUP BY p.id HAVING count(DISTINCT m."machineType") <> count(*)) x`), 0));
  const soMay = await one(sql`SELECT count(*)::int n FROM machines m JOIN stations s ON s.id=m."stationId" JOIN production_lines p ON p.id=s."lineId" JOIN workshops w ON w.id=p."workshopId" JOIN factories f ON f.id=w."factoryId" WHERE f."corporateCode"=${MA_TAP_DOAN}`);
  dsDat.push(kiem("machines qua 4 chang = ke hoach (mo hinh 1 vs 2)", soMay, dem.may));
  dsDat.push(kiem("machines code QATD- (dem theo ma) = ke hoach", await one(sql`SELECT count(*)::int n FROM machines WHERE code LIKE ${like}`), dem.may));
  dsDat.push(kiem("stations QATD = machines (1:1)", await one(sql`SELECT count(*)::int n FROM stations WHERE code LIKE ${like}`), dem.may));
  // Mỗi máy đúng 1 hàng twin_dat_cho với tangId = tangId của xưởng (station→line→workshop)
  dsDat.push(kiem("may KHONG co dat_cho hoac co >1", await one(sql`
    SELECT count(*)::int n FROM (
      SELECT m.id FROM machines m LEFT JOIN twin_dat_cho d ON d."loaiThucThe"='machine' AND d."thucTheId"=m.id
       WHERE m.code LIKE ${like} GROUP BY m.id HAVING count(d.id) <> 1) x`), 0));
  dsDat.push(kiem("dat_cho may co tangId <> tangId cua xuong", await one(sql`
    SELECT count(*)::int n FROM twin_dat_cho d JOIN machines m ON m.id=d."thucTheId" AND d."loaiThucThe"='machine'
      JOIN stations s ON s.id=m."stationId" JOIN production_lines p ON p.id=s."lineId" JOIN workshops w ON w.id=p."workshopId"
     WHERE m.code LIKE ${like} AND d."tangId" IS DISTINCT FROM w."tangId"`), 0));
  const zKyVong = Z_KHONG ? "0" : "caoDoMm cua tang";
  dsDat.push(kiem(`dat_cho may co viTriZMm <> ${zKyVong}`, await one(Z_KHONG
    ? sql`SELECT count(*)::int n FROM twin_dat_cho d JOIN machines m ON m.id=d."thucTheId" AND d."loaiThucThe"='machine' WHERE m.code LIKE ${like} AND d."viTriZMm" <> 0`
    : sql`SELECT count(*)::int n FROM twin_dat_cho d JOIN twin_tang t ON t.id=d."tangId" JOIN machines m ON m.id=d."thucTheId" AND d."loaiThucThe"='machine' WHERE m.code LIKE ${like} AND d."viTriZMm" <> t."caoDoMm"`), 0));
  console.log(`         (thong tin) dat_cho may co viTriZMm=0: ${await one(sql`SELECT count(*)::int n FROM twin_dat_cho d JOIN machines m ON m.id=d."thucTheId" AND d."loaiThucThe"='machine' WHERE m.code LIKE ${like} AND d."viTriZMm"=0`)} / ${dem.may}`);
  dsDat.push(kiem("dat_cho may ngoai footprint tang", await one(sql`
    SELECT count(*)::int n FROM twin_dat_cho d JOIN twin_tang t ON t.id=d."tangId" JOIN machines m ON m.id=d."thucTheId" AND d."loaiThucThe"='machine'
     WHERE m.code LIKE ${like} AND (d."viTriXMm" + coalesce(d."rongMm",0)/2 > t."daiMm" OR d."viTriYMm" + coalesce(d."sauMm",0)/2 > t."rongMm" OR d."viTriXMm" < 0 OR d."viTriYMm" < 0)`), 0));
  // Lớp vận hành — đúng câu router hỏi
  const mayCoNhip = dem.may - (dem.theoTrangThai.offline ?? 0);
  dsDat.push(kiem("may heartbeat < 5 phut = may khong-offline", await one(sql`SELECT count(*)::int n FROM machines WHERE code LIKE ${like} AND "lastHeartbeat" > now() - interval '5 minutes'`), mayCoNhip));
  dsDat.push(kiem("may offline (lastHeartbeat NULL) = ke hoach", await one(sql`SELECT count(*)::int n FROM machines WHERE code LIKE ${like} AND "lastHeartbeat" IS NULL`), dem.theoTrangThai.offline ?? 0));
  dsDat.push(kiem("machine_health_history: may co hang < 24h", await one(sql`SELECT count(DISTINCT h."machineId")::int n FROM machine_health_history h JOIN machines m ON m.id=h."machineId" WHERE m.code LIKE ${like} AND h."createdAt" > now() - interval '24 hours'`), dem.may));
  dsDat.push(kiem("line KHONG co WIP mo (exitedAt IS NULL)", await one(sql`SELECT count(*)::int n FROM production_lines p WHERE p.code LIKE ${like} AND NOT EXISTS (SELECT 1 FROM wip_tracking w WHERE w."lineId"=p.id AND w."exitedAt" IS NULL)`), 0));
  dsDat.push(kiem("line KHONG co line_balance periodEnd < 8h", await one(sql`SELECT count(*)::int n FROM production_lines p WHERE p.code LIKE ${like} AND NOT EXISTS (SELECT 1 FROM line_balance_metrics b WHERE b."lineId"=p.id AND b."periodEnd" > now() - interval '8 hours')`), 0));
  const andonMo = await one(sql`SELECT count(*)::int n FROM andon_events a JOIN production_lines p ON p.id=a."lineId" WHERE p.code LIKE ${like} AND a."resolvedAt" IS NULL`);
  dsDat.push(kiem("andon mo cua line QATD (>0)", andonMo, ">0", (x) => x > 0));
  dsDat.push(kiem("product_inspections thieu factoryCode", await one(sql`SELECT count(*)::int n FROM product_inspections pi JOIN machines m ON m.id=pi."machineId" WHERE m.code LIKE ${like} AND pi."factoryCode" IS NULL`), 0));
  // Bất biến nền
  const nenSau = await doNen();
  console.log(`    Nen SAU: ${JSON.stringify(nenSau)}`);
  for (const k of Object.keys(nenTruoc)) dsDat.push(kiem(`nen khong doi: ${k}`, nenSau[k], nenTruoc[k]));
  const dat = dsDat.every(Boolean);
  console.log(`\n  => CAU CHI ${dat ? "DAT " + dsDat.length + "/" + dsDat.length : "VO " + dsDat.filter((x) => !x).length + "/" + dsDat.length}`);
  return { dat, ketQua: kq };
}

// ════════════════════════════════════════════════════════════════════════════
// --chi-nhip — làm tươi, không tạo/xoá hàng (sinh-tai-twin :898-986, cộng thêm 2 đồng hồ)
// ════════════════════════════════════════════════════════════════════════════
async function cheDoChiNhip() {
  tieuDe("LAM TUOI NHIP TIM QATD (--chi-nhip)");
  await kiemOwner();
  const like = TIEN_TO + "-%";
  // 1. Nhịp tim 5' — chỉ máy KHÔNG-offline (offline = lastHeartbeat NULL, giữ nguyên)
  const r1 = await sql`UPDATE machines SET "lastHeartbeat" = now() WHERE code LIKE ${like} AND "isActive" AND "lastHeartbeat" IS NOT NULL`;
  console.log(`  machines.lastHeartbeat=now()         ${r1.count} may (offline giu NULL)`);
  // 2. WIP — trượt cả chuỗi giữ khoảng cách (như sinh-tai-twin), dù wipFlowState không có cửa sổ giờ
  const [w] = await sql`SELECT count(*)::int n, max("enteredAt")::text mx FROM wip_tracking WHERE "lineId" IN (SELECT id FROM production_lines WHERE code LIKE ${like})`;
  if (w.n > 0) {
    const r2 = await sql`UPDATE wip_tracking SET "enteredAt" = "enteredAt" + (now()::timestamp - ${w.mx}::timestamp) WHERE "lineId" IN (SELECT id FROM production_lines WHERE code LIKE ${like})`;
    console.log(`  wip_tracking.enteredAt truot         ${r2.count} hang (moc moi nhat cu ${w.mx})`);
  } else console.log("  wip_tracking                         0 hang — khong doi");
  // 3. Cân bằng line — periodEnd về now()-2h (client hạn 8h)
  const r3 = await sql`UPDATE line_balance_metrics SET "periodStart" = now() - interval '3 hours', "periodEnd" = now() - interval '2 hours' WHERE "lineId" IN (SELECT id FROM production_lines WHERE code LIKE ${like})`;
  console.log(`  line_balance_metrics.periodEnd       ${r3.count} hang`);
  // 4. Sức khoẻ — hàng MỚI NHẤT mỗi máy về now() (client hạn 24h trên createdAt)
  const r4 = await sql`UPDATE machine_health_history h SET "createdAt" = now(), "timestamp" = now()
    FROM (SELECT DISTINCT ON ("machineId") id FROM machine_health_history WHERE "machineId" IN (SELECT id FROM machines WHERE code LIKE ${like}) ORDER BY "machineId", "createdAt" DESC) x
    WHERE h.id = x.id`;
  console.log(`  machine_health_history (moi nhat)    ${r4.count} hang`);
  // Đo lại đúng câu router hỏi
  const [k] = await sql`SELECT
      (SELECT count(*)::int FROM machines WHERE code LIKE ${like} AND "lastHeartbeat" > now() - interval '5 minutes') AS "mayTuoi",
      (SELECT count(*)::int FROM machines WHERE code LIKE ${like} AND "lastHeartbeat" IS NULL) AS "mayOffline",
      (SELECT count(*)::int FROM production_lines p WHERE p.code LIKE ${like} AND NOT EXISTS (SELECT 1 FROM line_balance_metrics b WHERE b."lineId"=p.id AND b."periodEnd" > now() - interval '8 hours')) AS "lineHetHanCanBang",
      (SELECT count(DISTINCT h."machineId")::int FROM machine_health_history h JOIN machines m ON m.id=h."machineId" WHERE m.code LIKE ${like} AND h."createdAt" > now() - interval '24 hours') AS "mayCoSucKhoe24h"`;
  console.log(`\n  Do lai: ${JSON.stringify(k)}`);
  await sql.end();
}

// ════════════════════════════════════════════════════════════════════════════
// --go — ngược thứ tự tạo, kể cả bảng vệ tinh do SERVER bơm (go-tai-twin :36-40, :375-492)
// ════════════════════════════════════════════════════════════════════════════
async function cheDoGo() {
  tieuDe("GO TAP DOAN QATD" + (CHI_DO ? "   [--kho: CHI DO, KHONG XOA]" : ""));
  await kiemOwner();
  const like = TIEN_TO + "-%";
  const nhaMays = await sql`SELECT id, code FROM factories WHERE code LIKE ${like} AND code <> ALL(${[...MA_CAM_CHAM]}) ORDER BY code`;
  const fIds = nhaMays.map((f) => f.id);
  const ids = async (q) => (await q).map((r) => r.id);
  const wsIds = fIds.length ? await ids(sql`SELECT id FROM workshops WHERE "factoryId" = ANY(${fIds})`) : [];
  const plIds = wsIds.length ? await ids(sql`SELECT id FROM production_lines WHERE "workshopId" = ANY(${wsIds})`) : [];
  const stIds = plIds.length ? await ids(sql`SELECT id FROM stations WHERE "lineId" = ANY(${plIds})`) : [];
  const mIds = stIds.length ? await ids(sql`SELECT id FROM machines WHERE "stationId" = ANY(${stIds})`) : [];
  const tnIds = fIds.length ? await ids(sql`SELECT id FROM twin_toa_nha WHERE "factoryId" = ANY(${fIds})`) : [];
  const tgIds = tnIds.length ? await ids(sql`SELECT id FROM twin_tang WHERE "toaNhaId" = ANY(${tnIds})`) : [];
  console.log(`  Nha may khop (${nhaMays.length}): ${nhaMays.map((f) => `${f.code}#${f.id}`).join(", ") || "(khong)"}`);
  console.log(`  Cay: workshops=${wsIds.length} lines=${plIds.length} stations=${stIds.length} machines=${mIds.length} toa_nha=${tnIds.length} tang=${tgIds.length}`);

  // twin_dat_cho — HAI ĐƯỜNG (theo tầng vs theo thực thể) phải cho cùng tập (go-tai-twin :241-287)
  const dcTang = tgIds.length ? await ids(sql`SELECT id FROM twin_dat_cho WHERE "tangId" = ANY(${tgIds})`) : [];
  const dcTT = [];
  const goms = [["machine", mIds], ["station", stIds], ["line", plIds], ["workshop", wsIds]];
  for (const [loai, arr] of goms) if (arr.length) dcTT.push(...(await ids(sql`SELECT id FROM twin_dat_cho WHERE "loaiThucThe" = ${loai} AND "thucTheId" = ANY(${arr})`)));
  const setTang = new Set(dcTang), setTT = new Set(dcTT);
  const chiTT = dcTT.filter((i) => !setTang.has(i));
  console.log(`  twin_dat_cho: theo tang=${dcTang.length} theo thuc the=${dcTT.length} chi-tang=${dcTang.filter((i) => !setTT.has(i)).length} chi-thuc-the=${chiTT.length}`);
  if (chiTT.length) { console.error(`LOI: ${chiTT.length} hang dat_cho tro vao thuc the QATD nhung nam tren TANG KHAC. Dung.`); await sql.end(); process.exit(1); }

  const dem = async (bang, cotK, arr, them = "") => arr.length ? Number((await sql.unsafe(`SELECT count(*)::text n FROM ${bang} WHERE "${cotK}" = ANY($1) ${them}`, [arr]))[0].n) : 0;
  const seDem = {
    wip_tracking: await dem("wip_tracking", "currentStationId", stIds),
    product_inspections: await dem("product_inspections", "machineId", mIds),
    machine_health_history: await dem("machine_health_history", "machineId", mIds),
    machine_heartbeats: await dem("machine_heartbeats", "machineId", mIds),
    ot_telemetry_30d: await dem("ot_telemetry", "machineId", mIds, "AND ts >= now() - interval '30 days'"),
    rul_estimates: await dem("rul_estimates", "machine_id", mIds),
    machine_status_logs: await dem("machine_status_logs", "machineId", mIds),
    predictive_alerts: await dem("predictive_alerts", "machineId", mIds),
    station_dwell_time: await dem("station_dwell_time", "machineId", mIds),
    measurement_point_defs: await dem("measurement_point_defs", "machineId", mIds),
    andon_events: await dem("andon_events", "lineId", plIds),
    line_balance_metrics: await dem("line_balance_metrics", "lineId", plIds),
    twin_dat_cho: dcTang.length,
    twin_vat_the: await dem("twin_vat_the", "tangId", tgIds),
    twin_ban_ghi: await dem("twin_ban_ghi", "tangId", tgIds),
    twin_tang: tgIds.length, twin_toa_nha: tnIds.length, machines: mIds.length, stations: stIds.length,
    production_lines: plIds.length, workshops: wsIds.length,
    user_factory_assignments: Number((await sql`SELECT count(*)::text n FROM user_factory_assignments WHERE "factoryCode" LIKE ${like}`)[0].n),
    factories: fIds.length,
    user_corporate_assignments: Number((await sql`SELECT count(*)::text n FROM user_corporate_assignments WHERE "corporateCode" = ${MA_TAP_DOAN}`)[0].n),
    corporates: Number((await sql`SELECT count(*)::text n FROM corporates WHERE code = ${MA_TAP_DOAN}`)[0].n),
  };
  console.log("  Se xoa (dem truoc):");
  for (const [k, v] of Object.entries(seDem)) console.log(`    ${k.padEnd(28)} ${v}`);
  if (CHI_DO) { console.log("\n  [--kho] KHONG xoa gi. Dung."); await sql.end(); return; }

  const xoa = {};
  await sql.begin(async (tx) => {
    // Trần giải nén Timescale (go-tai-twin :336-360) — chỉ trong giao dịch này.
    await tx`SET LOCAL timescaledb.max_tuples_decompressed_per_dml_transaction = 0`;
    if (stIds.length) xoa.wip_tracking = (await tx`DELETE FROM wip_tracking WHERE "currentStationId" = ANY(${stIds})`).count;
    if (mIds.length) {
      // Vế thời gian chỉ để CẮT CHUNK hypertable; cầu chì cuối đếm KHÔNG kèm vế này.
      xoa.product_inspections = (await tx`DELETE FROM product_inspections WHERE "machineId" = ANY(${mIds}) AND "inspectionTime" >= now() - interval '30 days'`).count;
      xoa.machine_health_history = (await tx`DELETE FROM machine_health_history WHERE "machineId" = ANY(${mIds})`).count;
      xoa.machine_heartbeats = (await tx`DELETE FROM machine_heartbeats WHERE "machineId" = ANY(${mIds})`).count;
      xoa.ot_telemetry = (await tx`DELETE FROM ot_telemetry WHERE "machineId" = ANY(${mIds}) AND ts >= now() - interval '30 days'`).count;
      xoa.rul_estimates = (await tx`DELETE FROM rul_estimates WHERE machine_id = ANY(${mIds})`).count;
      xoa.machine_status_logs = (await tx`DELETE FROM machine_status_logs WHERE "machineId" = ANY(${mIds})`).count;
      xoa.predictive_alerts = (await tx`DELETE FROM predictive_alerts WHERE "machineId" = ANY(${mIds})`).count;
      xoa.station_dwell_time = (await tx`DELETE FROM station_dwell_time WHERE "machineId" = ANY(${mIds})`).count;
      xoa.measurement_point_defs = (await tx`DELETE FROM measurement_point_defs WHERE "machineId" = ANY(${mIds})`).count;
    }
    if (plIds.length) {
      xoa.andon_events = (await tx`DELETE FROM andon_events WHERE "lineId" = ANY(${plIds})`).count;
      xoa.line_balance_metrics = (await tx`DELETE FROM line_balance_metrics WHERE "lineId" = ANY(${plIds})`).count;
    }
    if (dcTang.length) xoa.twin_dat_cho = (await tx`DELETE FROM twin_dat_cho WHERE id = ANY(${dcTang})`).count;
    if (tgIds.length) {
      xoa.twin_vat_the = (await tx`DELETE FROM twin_vat_the WHERE "tangId" = ANY(${tgIds})`).count;
      xoa.twin_ban_ghi = (await tx`DELETE FROM twin_ban_ghi WHERE "tangId" = ANY(${tgIds})`).count;
      xoa.twin_tang = (await tx`DELETE FROM twin_tang WHERE id = ANY(${tgIds})`).count;
    }
    if (tnIds.length) xoa.twin_toa_nha = (await tx`DELETE FROM twin_toa_nha WHERE id = ANY(${tnIds})`).count;
    if (mIds.length) xoa.machines = (await tx`DELETE FROM machines WHERE id = ANY(${mIds})`).count;
    if (stIds.length) xoa.stations = (await tx`DELETE FROM stations WHERE id = ANY(${stIds})`).count;
    if (plIds.length) xoa.production_lines = (await tx`DELETE FROM production_lines WHERE id = ANY(${plIds})`).count;
    if (wsIds.length) xoa.workshops = (await tx`DELETE FROM workshops WHERE id = ANY(${wsIds})`).count;
    xoa.user_factory_assignments = (await tx`DELETE FROM user_factory_assignments WHERE "factoryCode" LIKE ${like}`).count;
    if (fIds.length) xoa.factories = (await tx`DELETE FROM factories WHERE id = ANY(${fIds})`).count;
    xoa.user_corporate_assignments = (await tx`DELETE FROM user_corporate_assignments WHERE "corporateCode" = ${MA_TAP_DOAN}`).count;
    xoa.corporates = (await tx`DELETE FROM corporates WHERE code = ${MA_TAP_DOAN}`).count;
  });
  console.log("\n  DA XOA:");
  for (const [k, v] of Object.entries(xoa)) console.log(`    ${k.padEnd(28)} ${v}`);

  // Cầu chì mồ côi LƯỢT NÀY (đếm trên id vừa xoá, KHÔNG kèm vế thời gian) + đợt 2 nếu server đua ghi
  const mA = mIds.length ? mIds : [0], sA = stIds.length ? stIds : [0], pA = plIds.length ? plIds : [0];
  const demSot = async () => Number((await sql`SELECT (
      (SELECT count(*) FROM machine_health_history WHERE "machineId" = ANY(${mA}))
    + (SELECT count(*) FROM product_inspections    WHERE "machineId" = ANY(${mA}))
    + (SELECT count(*) FROM machine_heartbeats     WHERE "machineId" = ANY(${mA}))
    + (SELECT count(*) FROM ot_telemetry           WHERE "machineId" = ANY(${mA}))
    + (SELECT count(*) FROM rul_estimates          WHERE machine_id   = ANY(${mA}))
    + (SELECT count(*) FROM machine_status_logs    WHERE "machineId" = ANY(${mA}))
    + (SELECT count(*) FROM predictive_alerts      WHERE "machineId" = ANY(${mA}))
    + (SELECT count(*) FROM station_dwell_time     WHERE "machineId" = ANY(${mA}))
    + (SELECT count(*) FROM measurement_point_defs WHERE "machineId" = ANY(${mA}))
    + (SELECT count(*) FROM wip_tracking           WHERE "currentStationId" = ANY(${sA}))
    + (SELECT count(*) FROM andon_events           WHERE "lineId" = ANY(${pA}))
    + (SELECT count(*) FROM line_balance_metrics   WHERE "lineId" = ANY(${pA}))
    )::text n`)[0].n);
  let sot = await demSot();
  console.log(`\n  Cau chi mo coi LUOT NAY: ${sot}`);
  if (sot > 0) {
    console.log("  → Doi thu 2 (server ghi xen giua giao dich). Quet lai tren DUNG tap id...");
    await sql.begin(async (tx) => {
      await tx`SET LOCAL timescaledb.max_tuples_decompressed_per_dml_transaction = 0`;
      await tx`DELETE FROM ot_telemetry WHERE "machineId" = ANY(${mA})`;
      await tx`DELETE FROM product_inspections WHERE "machineId" = ANY(${mA})`;
      for (const b of ["machine_health_history", "machine_heartbeats", "machine_status_logs", "predictive_alerts", "station_dwell_time", "measurement_point_defs"]) await tx.unsafe(`DELETE FROM ${b} WHERE "machineId" = ANY($1)`, [mA]);
      await tx`DELETE FROM rul_estimates WHERE machine_id = ANY(${mA})`;
      await tx`DELETE FROM wip_tracking WHERE "currentStationId" = ANY(${sA})`;
      await tx`DELETE FROM andon_events WHERE "lineId" = ANY(${pA})`;
      await tx`DELETE FROM line_balance_metrics WHERE "lineId" = ANY(${pA})`;
    });
    sot = await demSot();
    console.log(`  Sau doi thu 2, con sot: ${sot}`);
    if (sot > 0) { console.error("LOI: van con sot — server dang chay ghi tiep. Chay lai --go."); process.exitCode = 1; }
  }
  const q = await demQATD();
  const conQ = Object.values(q).reduce((a, b) => a + b, 0);
  const [{ n: moCoiMay }] = await sql`SELECT count(*)::text n FROM twin_dat_cho d WHERE d."loaiThucThe"='machine' AND NOT EXISTS (SELECT 1 FROM machines m WHERE m.id = d."thucTheId")`;
  const [{ n: moCoiTang }] = await sql`SELECT count(*)::text n FROM twin_dat_cho d WHERE NOT EXISTS (SELECT 1 FROM twin_tang t WHERE t.id = d."tangId")`;
  console.log(`  Con ma QATD sau go: ${JSON.stringify(q)} => ${conQ === 0 ? "SACH" : "CON " + conQ}`);
  console.log(`  Mo coi TOAN CSDL (bao cao, khong phai cua luot nay): dat_cho→may da xoa=${moCoiMay}, dat_cho→tang da xoa=${moCoiTang}`);
  console.log(`  Nen sau go: ${JSON.stringify(await doNen())}`);
  if (conQ > 0) process.exitCode = 1;
  await sql.end();
}

// ════════════════════════════════════════════════════════════════════════════
// --gan / --gan-tap-doan — idempotent bằng NOT EXISTS (user_factory_assignments KHÔNG có unique)
// ════════════════════════════════════════════════════════════════════════════
async function cheDoGan(dsUser, tapDoan) {
  tieuDe(tapDoan ? "GAN user_corporate_assignments(QATD)" : "GAN user_factory_assignments(QATD-A/B/C)");
  await kiemOwner();
  const [adm] = await sql`SELECT id FROM users WHERE username = 'admin' AND role = 'admin' ORDER BY id LIMIT 1`;
  const assignedBy = adm?.id ?? null;
  const users = await sql`SELECT id, username, role FROM users WHERE username = ANY(${dsUser})`;
  const thieu = dsUser.filter((u) => !users.some((x) => x.username === u));
  if (thieu.length) console.error(`  CANH BAO: khong tim thay user: ${thieu.join(", ")}`);
  if (tapDoan) {
    const [cp] = await sql`SELECT code FROM corporates WHERE code = ${MA_TAP_DOAN}`;
    if (!cp) { console.error("LOI: corporates QATD chua ton tai — chay --ghi truoc."); await sql.end(); process.exit(1); }
    for (const u of users) {
      const r = await sql`INSERT INTO user_corporate_assignments ("userId", "corporateCode", "assignedBy")
        SELECT ${u.id}, ${MA_TAP_DOAN}, ${assignedBy}
         WHERE NOT EXISTS (SELECT 1 FROM user_corporate_assignments WHERE "userId" = ${u.id} AND "corporateCode" = ${MA_TAP_DOAN})`;
      console.log(`  ${u.username}#${u.id} (${u.role}) → QATD: ${r.count ? "THEM" : "da co"}`);
    }
  } else {
    const fs_ = await sql`SELECT code FROM factories WHERE code = ANY(${CONG_TY.map((c) => c.ma)}) ORDER BY code`;
    if (fs_.length !== 3) { console.error(`LOI: chi thay ${fs_.length}/3 cong ty QATD — chay --ghi truoc.`); await sql.end(); process.exit(1); }
    for (const u of users) for (const f of fs_) {
      const r = await sql`INSERT INTO user_factory_assignments ("userId", "factoryCode", "assignedBy")
        SELECT ${u.id}, ${f.code}, ${assignedBy}
         WHERE NOT EXISTS (SELECT 1 FROM user_factory_assignments WHERE "userId" = ${u.id} AND "factoryCode" = ${f.code})`;
      console.log(`  ${u.username}#${u.id} (${u.role}) → ${f.code}: ${r.count ? "THEM" : "da co"}`);
    }
  }
  const q = await demQATD();
  console.log(`  Gan hien co: ufa=${q.user_factory_assignments} uca=${q.user_corporate_assignments}`);
  await sql.end();
}

// ════════════════════════════════════════════════════════════════════════════
const tach = (s) => s.split(",").map((x) => x.trim()).filter(Boolean);
const lenh = co("--go") ? cheDoGo()
  : co("--chi-nhip") ? cheDoChiNhip()
  : chuoiCo("gan") !== null ? cheDoGan(tach(chuoiCo("gan")), false)
  : chuoiCo("gan-tap-doan") !== null ? cheDoGan(tach(chuoiCo("gan-tap-doan")), true)
  : co("--ghi") ? cheDoGhi()
  : CHI_DO ? cheDoKho()
  : (console.error("Dung: --kho | --ghi | --chi-nhip | --go [--kho] | --gan=u1,u2 | --gan-tap-doan=u1  [--z0]"), sql.end(), Promise.resolve());
lenh.catch(async (e) => {
  console.error(e);
  try { await sql.end(); } catch { /* đã đóng */ }
  process.exit(1);
});
