/**
 * zf/bien.mjs — DỰNG BIẾN THỂ BẰNG CÁCH VÁ ĐÚNG MỘT CHUỖI TRONG BUNDLE ĐÃ DỰNG.
 *
 * Vì sao không dựng lại từ nguồn: một lần `vite build` đổi hàng trăm tệp và mọi
 * băm chunk; khi đó "hai bản chỉ khác `near`" là LỜI KHAI. Vá thẳng bundle với
 * ràng buộc "chuỗi phải xuất hiện ĐÚNG N lần" cho một biến thể mà mọi byte khác
 * chứng minh được là GIỐNG HỆT — điều kiện tiên quyết của một nhiễu ĐỘ SÂU THUẦN.
 *
 *   node .qa-tapdoan/zf/bien.mjs <tên1> [tên2 ...]      (không tên = trả về gốc)
 */
import fs from "node:fs";
import crypto from "node:crypto";

const DIST = ".qa-tapdoan/dist-zf/public/assets";
const GOC = ".qa-tapdoan/zf/goc";
const KHUNG = "KhungCanh-BiGwCO3Z.js";
const SUCKHOE = "sucKhoeMay-CmrEIcnn.js";

/** Mỗi bản vá: [tệp, chuỗi tìm, chuỗi thay, số lần PHẢI khớp]. */
const BIEN = {
  // ── THIẾT BỊ ĐO: nhiễu độ sâu thuần ─────────────────────────────────────────
  // NEAR_TOI_DA_M 0,5 → 0,1: chỉ đổi `near` ở cảnh LỚN (far ≥ 10.000).
  near01: [[KHUNG, "Mt=.1,vt=.5", "Mt=.1,vt=.1", 1]],
  // NEAR_TOI_THIEU_M 0,1 → 0,4: chỉ đổi `near` ở cảnh NHỎ (far = sàn 2000).
  near04: [[KHUNG, "Mt=.1,vt=.5", "Mt=.4,vt=.5", 1]],
  // ĐỐI CHỨNG: nâng lưới lên 5 m ⇒ z-fighting BẤT KHẢ, mật độ lưới GIỮ NGUYÊN.
  luoicao5: [[SUCKHOE, 'CanhVanHanh.tsx:296",args:[a,Math.max(4,Math.round(a/5)),o?"#475569":"#94a3b8",o?"#334155":"#cbd5e1"],position:[n/2,0,t/2]', 'CanhVanHanh.tsx:296",args:[a,Math.max(4,Math.round(a/5)),o?"#475569":"#94a3b8",o?"#334155":"#cbd5e1"],position:[n/2,5,t/2]', 1]],

  // ── BA ỨNG VIÊN VÁ ──────────────────────────────────────────────────────────
  // (A) khe hở theo CỠ CẢNH: sàn xuống -max(0,01 ; cạnh/400) thay vì hằng -0,01.
  khehong: [[SUCKHOE, "CanhVanHanh.tsx:292\",rotation:Go,position:[n/2,-.01,t/2]", "CanhVanHanh.tsx:292\",rotation:Go,position:[n/2,-Math.max(.01,Math.max(n,t)/400),t/2]", 1]],
  // (B) polygonOffset trên VẬT LIỆU SÀN — đẩy độ sâu của sàn ra xa 1 đơn vị bước z.
  polyoff: [[SUCKHOE, 'CanhVanHanh.tsx:294",color:o?"#1e293b":"#e2e8f0"', 'CanhVanHanh.tsx:294",color:o?"#1e293b":"#e2e8f0",polygonOffset:!0,polygonOffsetFactor:1,polygonOffsetUnits:1', 1]],
  // (B4) như (B) nhưng units 4.
  polyoff4: [[SUCKHOE, 'CanhVanHanh.tsx:294",color:o?"#1e293b":"#e2e8f0"', 'CanhVanHanh.tsx:294",color:o?"#1e293b":"#e2e8f0",polygonOffset:!0,polygonOffsetFactor:1,polygonOffsetUnits:4', 1]],
  // (C) lưới KHÔNG ghi/không so độ sâu + renderOrder — vẽ sau, luôn nằm trên sàn.
  luoikhongsau: [[SUCKHOE, 'CanhVanHanh.tsx:296",args:[a,Math.max(4,Math.round(a/5)),o?"#475569":"#94a3b8",o?"#334155":"#cbd5e1"],position:[n/2,0,t/2]', 'CanhVanHanh.tsx:296",args:[a,Math.max(4,Math.round(a/5)),o?"#475569":"#94a3b8",o?"#334155":"#cbd5e1"],position:[n/2,0,t/2],renderOrder:1,"material-depthWrite":!1,"material-depthTest":!1', 1]],
};

const ten = process.argv.slice(2);
const noiDung = new Map([
  [KHUNG, fs.readFileSync(`${GOC}/${KHUNG}`, "utf8")],
  [SUCKHOE, fs.readFileSync(`${GOC}/${SUCKHOE}`, "utf8")],
]);

for (const t of ten) {
  const bv = BIEN[t];
  if (!bv) throw new Error(`biến thể lạ: ${t} (có: ${Object.keys(BIEN).join(", ")})`);
  for (const [tep, tim, thay, soLan] of bv) {
    const s = noiDung.get(tep);
    const n = s.split(tim).length - 1;
    if (n !== soLan) throw new Error(`${t}/${tep}: chuỗi khớp ${n} lần, PHẢI ${soLan} — DỪNG`);
    noiDung.set(tep, s.split(tim).join(thay));
  }
}
for (const [tep, s] of noiDung) fs.writeFileSync(`${DIST}/${tep}`, s);

const md5 = (p) => crypto.createHash("md5").update(fs.readFileSync(p)).digest("hex");
const bao = [KHUNG, SUCKHOE].map((f) => {
  const g = md5(`${GOC}/${f}`);
  const d = md5(`${DIST}/${f}`);
  return `${f}: ${d}${d === g ? " (=gốc)" : " (ĐÃ VÁ)"}`;
});
console.log(`biến thể [${ten.join("+") || "GỐC"}] · ${bao.join(" · ")}`);
