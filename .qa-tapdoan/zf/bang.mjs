/**
 * zf/bang.mjs — BẢNG "ĐỔI BÊN THẮNG" cho MỌI cảnh × khung giữa hai nhãn chụp.
 *
 * Tự BÁC BỎ khi phép so vô nghĩa:
 *   · thiếu ảnh                      → ô "—"
 *   · camXa hai bên KHÁC nhau        → "CAM LỆCH" (phép chiếu x/y đã đổi ⇒ không còn
 *                                      là nhiễu độ sâu thuần, con số vô nghĩa)
 *   · near VÀ far hai bên GIỐNG nhau → "0 NHIỄU" (không hề bóp độ sâu ⇒ số 0 là
 *                                      TỰ THOẢ, không phải bằng chứng)
 *
 *   node .qa-tapdoan/zf/bang.mjs <nhanA> <nhanB> [--to <thumuc>]
 */
import fs from "node:fs";
import { execFileSync } from "node:child_process";

const A = process.argv[2];
const B = process.argv[3];
const iTo = process.argv.indexOf("--to");
const TO = iTo > 0 ? process.argv[iTo + 1] : null;
if (TO) fs.mkdirSync(TO, { recursive: true });

/** Vùng SÀN THUẦN 3D — chọn bằng mắt trên ảnh nền, đã phóng ×3..×6 để xác nhận. */
export const VUNG = {
  "tapdoan/a-macdinh": [
    ["TD-A", 450, 375, 550, 446],
    ["TD-A' (vùng agent PH-50b)", 300, 395, 520, 450],
  ],
  "tapdoan/b-zoom": [["TD-B (lưới ĐỌC ĐƯỢC)", 320, 300, 640, 420]],
  "tapdoan/e-nghieng": [["TD-E (xiên 83,7°)", 300, 396, 570, 438]],
  "nhamay/a-macdinh": [["NM-A", 240, 330, 360, 430]],
  "nhamay/e-nghieng": [["NM-E (xiên)", 250, 330, 360, 430]],
  "line/a-macdinh": [["LN-A", 500, 400, 800, 470]],
  "may/a-macdinh": [["MY-A", 20, 130, 200, 275]],
};

const doc = (n) => {
  const p = `.qa-tapdoan/zf/tho/chup-${n}.json`;
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
  if (!ra || !rb || !fs.existsSync(ra.anh) || !fs.existsSync(rb.anh)) {
    hang.push({ khoa, phan: "—", ghiChu: "thiếu ảnh" });
    continue;
  }
  if (ra.camXa !== rb.camXa) {
    hang.push({ khoa, phan: "CAM LỆCH", ghiChu: `camXa ${ra.camXa} vs ${rb.camXa}` });
    continue;
  }
  const bopSau = ra.near !== rb.near || ra.far !== rb.far;
  for (const [ten, x0, y0, x1, y1] of vungs) {
    const raDo = TO ? `${TO}/${canh}-${khung}-${ten.split(" ")[0]}.png` : null;
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
      far: `${ra.far}→${rb.far}`,
      camXa: ra.camXa,
      px: j.soPixel,
      pct0: j.pctNguong0,
      pct6: j.pctNguong6,
      pct24: j.pctNguong24,
      mang: j.soMangLoang,
      mangLon: j.mangLonNhat,
      ghiChu: bopSau ? "" : "⚠ 0 NHIỄU ĐỘ SÂU — số 0 ở đây KHÔNG chứng minh gì",
    });
  }
}
console.log(`\n══ ${A}  →  ${B} ══`);
console.log(
  ["cảnh/khung", "vùng", "near", "camXa", "px", ">0 %", ">6 %", ">24 %", "mảng", "lớn nhất", "ghi chú"].join(" | "),
);
for (const h of hang) {
  if (h.phan) {
    console.log([h.khoa, "", "", "", "", h.phan, "", "", "", "", h.ghiChu].join(" | "));
    continue;
  }
  console.log(
    [h.khoa, h.vung, h.near, h.camXa, h.px, h.pct0, h.pct6, h.pct24, h.mang, h.mangLon, h.ghiChu].join(" | "),
  );
}
fs.writeFileSync(`.qa-tapdoan/zf/tho/bang-${A}-vs-${B}.json`, JSON.stringify(hang, null, 1));
