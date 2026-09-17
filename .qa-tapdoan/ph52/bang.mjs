/**
 * ph52/bang.mjs — BẢNG SO HAI NHÃN CHỤP TRÊN MỌI CẢNH × KHUNG × VÙNG SÀN THUẦN.
 *
 * Dùng lại `zf/so.mjs` (đếm pixel + mảng loang + tự bác bỏ vùng trống) làm nhân;
 * tệp này chỉ thêm DANH MỤC VÙNG và các ĐIỀU KIỆN BÁC BỎ của phép so:
 *   · thiếu ảnh                       → "—"
 *   · camXa hai bên KHÁC nhau         → "CAM LỆCH" (phép chiếu x/y đã đổi ⇒ không
 *                                       còn là nhiễu độ sâu thuần, số vô nghĩa)
 *   · far hai bên KHÁC nhau           → "CỠ CẢNH LỆCH" (đang so hai cảnh khác nhau)
 *   · chế độ `--nhieu` mà near+far GIỐNG nhau → "0 NHIỄU" (số 0 sẽ là TỰ THOẢ)
 *
 *   node .qa-tapdoan/ph52/bang.mjs <nhanA> <nhanB> [--nhieu] [--to <thumuc>]
 */
import fs from "node:fs";
import { execFileSync } from "node:child_process";

const A = process.argv[2];
const B = process.argv[3];
const LA_NHIEU = process.argv.includes("--nhieu");
const iTo = process.argv.indexOf("--to");
const TO = iTo > 0 ? process.argv[iTo + 1] : null;
if (TO) fs.mkdirSync(TO, { recursive: true });

/** Vùng SÀN THUẦN 3D trên canvas 634×529 — chọn bằng mắt, đã soi ×3 để xác nhận. */
export const VUNG = {
  "fc-tatca/a-macdinh": [
    ["FCTD-A", 40, 380, 240, 500],
    ["FCTD-B", 400, 400, 600, 500],
  ],
  "fc-tatca/e-nghieng": [["FCTD-E", 60, 320, 260, 440]],
  "fc-mot/a-macdinh": [
    ["FCNM-A", 470, 300, 630, 430],
    ["FCNM-B", 180, 450, 480, 520],
  ],
  "fc-mot/e-nghieng": [["FCNM-E", 60, 320, 300, 450]],
  // ── Studio (`/twin-studio`, CanhThietKe) — canvas 540×251, tránh lô máy và
  //    bản đồ nhỏ ở góc dưới-phải (x ≥ 425, y ≥ 130). Đã soi ×4 để xác nhận.
  "studio/a-macdinh": [
    ["ST-A", 60, 170, 230, 245],
    ["ST-B", 300, 170, 420, 245],
  ],
  "studio/f-tran": [["ST-F", 200, 150, 400, 240]],
  "studio/e-nghieng": [["ST-E", 60, 170, 300, 245]],
};

const doc = (n) => {
  const p = `.qa-tapdoan/ph52/tho/chup-${n}.json`;
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : [];
};
const soA = doc(A);
const soB = doc(B);
const tim = (s, canh, khung) => s.find((r) => r.canh === canh && r.khung === khung);

const hang = [];
for (const [khoa, vungs] of Object.entries(VUNG)) {
  const [canh, khung] = khoa.split("/");
  const ra = tim(soA, canh, khung);
  const rb = tim(soB, canh, khung);
  if (!ra || !rb || !fs.existsSync(ra.anh) || !fs.existsSync(rb.anh)) continue;
  if (ra.camXa !== rb.camXa) {
    hang.push({ khoa, phan: "CAM LỆCH", ghiChu: `camXa ${ra.camXa} vs ${rb.camXa}` });
    continue;
  }
  if (ra.far !== rb.far) {
    hang.push({ khoa, phan: "CỠ CẢNH LỆCH", ghiChu: `far ${ra.far} vs ${rb.far}` });
    continue;
  }
  const bopSau = ra.near !== rb.near || ra.far !== rb.far;
  if (LA_NHIEU && !bopSau) {
    hang.push({ khoa, phan: "0 NHIỄU", ghiChu: `near ${ra.near} = ${rb.near} ⇒ số 0 TỰ THOẢ` });
    continue;
  }
  for (const [ten, x0, y0, x1, y1] of vungs) {
    const raDo = TO ? `${TO}/${canh}-${khung}-${ten}.png` : null;
    const out = execFileSync(
      process.execPath,
      [".qa-tapdoan/zf/so.mjs", ra.anh, rb.anh, String(x0), String(y0), String(x1), String(y1), ...(raDo ? [raDo] : [])],
      { encoding: "utf8" },
    );
    const j = JSON.parse(out.split("\n")[0]);
    hang.push({
      khoa,
      vung: ten,
      near: `${ra.near}→${rb.near}`,
      far: ra.far,
      camXa: ra.camXa,
      px: j.soPixel,
      pct0: j.pctNguong0,
      pct6: j.pctNguong6,
      pct24: j.pctNguong24,
      mang: j.soMangLoang,
      mangLon: j.mangLonNhat,
    });
  }
}
console.log(`\n══ ${A}  →  ${B} ══${LA_NHIEU ? "  (chế độ NHIỄU ĐỘ SÂU)" : ""}`);
console.log(["cảnh/khung", "vùng", "near", "far", "camXa", "px", ">0 %", ">6 %", ">24 %", "mảng", "lớn nhất"].join(" | "));
for (const h of hang) {
  if (h.phan) {
    console.log([h.khoa, "", "", "", "", "", h.phan, "", "", "", h.ghiChu].join(" | "));
    continue;
  }
  console.log([h.khoa, h.vung, h.near, h.far, h.camXa, h.px, h.pct0, h.pct6, h.pct24, h.mang, h.mangLon].join(" | "));
}
fs.writeFileSync(`.qa-tapdoan/ph52/tho/bang-${A}-vs-${B}.json`, JSON.stringify(hang, null, 1));
