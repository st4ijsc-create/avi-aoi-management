/**
 * ph52/bien.mjs — DỰNG BIẾN THỂ BẰNG CÁCH VÁ ĐÚNG MỘT CHUỖI TRONG BUNDLE ĐÃ DỰNG.
 *
 * Cùng nguyên tắc `zf/bien.mjs` của PH-51: không dựng lại từ nguồn (một lần
 * `vite build` đổi hàng trăm tệp và mọi băm chunk, khi đó "hai bản chỉ khác X"
 * là LỜI KHAI). Vá thẳng chunk với ràng buộc "chuỗi phải khớp ĐÚNG N lần" cho
 * một biến thể mà mọi byte khác CHỨNG MINH ĐƯỢC là giống hệt.
 *
 *   node .qa-tapdoan/ph52/bien.mjs <tên1> [tên2 ...]      (không tên = trả về GỐC)
 */
import fs from "node:fs";
import crypto from "node:crypto";

const DIST = ".qa-tapdoan/dist-ph52t/public/assets";
const GOC = ".qa-tapdoan/ph52/goc";

const KHUNG = "KhungCanh-BiGwCO3Z.js";
const FC = "FactoryCommandView-CyRDlRju.js";
const VENDOR = "vendor-three-eG2QjD9l.js";
const STUDIO = "TwinStudio-DHipwymY.js";
const VANHANH = "sucKhoeMay-f8FqCFao.js";
const TEP = [KHUNG, FC, VENDOR, STUDIO, VANHANH];

/** Neo tới vật liệu SÀN của `/factory-command` (CanhNhaMay.tsx:490). */
const SAN_FC = 'CanhNhaMay.tsx:490",color:u.floor,roughness:1,metalness:0';
/** Neo tới vật liệu của drei `<Grid>` (chunk vendor, xuất hiện ĐÚNG 1 lần). */
const VL_GRID = '{transparent:!0,"extensions-derivatives":!0,side:y}';
/** Neo tới `<Grid>` của CanhNhaMay — cellSize 2 m cứng. */
const GRID_FC = 'CanhNhaMay.tsx:492",position:[0,0,0],args:[S*4,S*4],cellSize:2';
/** Neo tới sàn + gridHelper của Studio (CanhThietKe.tsx:212/215). */
const SAN_ST = 'CanhThietKe.tsx:212",color:s';
const LUOI_ST = 'CanhThietKe.tsx:215",args:[i,Math.max(4,Math.round(i)),c,r],position:[t/2,0,e/2]';
/** Neo tới gridHelper của CanhVanHanh (đã vá PH-51 nên sàn có polygonOffset). */
const LUOI_VH =
  'CanhVanHanh.tsx:358",args:[a,Math.max(4,Math.round(a/5)),o?"#475569":"#94a3b8",o?"#334155":"#cbd5e1"],position:[n/2,0,t/2]';

/** Mỗi bản vá: [tệp, chuỗi tìm, chuỗi thay, số lần PHẢI khớp]. */
const BIEN = {
  // ── THIẾT BỊ ĐO: NHIỄU ĐỘ SÂU THUẦN ────────────────────────────────────────
  // NEAR_TOI_DA_M 0,5 → 0,1. Trần này ĐANG RÀNG BUỘC cả hai cỡ cảnh của
  // `/factory-command` (near đo sống 0,41 và 0,149) nên nó đổi `near` ở cả hai.
  near01: [[KHUNG, "Mt=.1,vt=.5", "Mt=.1,vt=.1", 1]],
  // NEAR_TOI_THIEU_M 0,1 → 0,4 — nhiễu cho cảnh NHỎ (Studio, /twin một nhà máy).
  near04: [[KHUNG, "Mt=.1,vt=.5", "Mt=.4,vt=.5", 1]],

  // ── ORACLE "LƯỚI VẼ ĐỦ" ────────────────────────────────────────────────────
  // (O1) SÀN thôi ghi độ sâu ⇒ trong VÙNG SÀN THUẦN không còn gì ăn được lưới.
  fcOracleSan: [[FC, SAN_FC, `${SAN_FC},depthWrite:!1`, 1]],
  // (O2) VẬT LIỆU LƯỚI thôi so/ghi độ sâu — oracle ĐỘC LẬP với (O1), để hai
  //      oracle kiểm chéo nhau (nếu lệch thì chính oracle đang là biến).
  fcOracleLuoi: [[VENDOR, VL_GRID, '{transparent:!0,"extensions-derivatives":!0,side:y,depthTest:!1,depthWrite:!1}', 1]],
  // (O3) oracle cho Studio — gridHelper, cùng kiểu (C) của PH-51.
  stOracle: [[STUDIO, LUOI_ST, `${LUOI_ST},renderOrder:1,"material-depthWrite":!1,"material-depthTest":!1`, 1]],
  // (O4) oracle cho Studio phía SÀN — độc lập với (O3).
  stOracleSan: [[STUDIO, SAN_ST, `${SAN_ST},depthWrite:!1`, 1]],

  // ── ỨNG VIÊN VÁ ────────────────────────────────────────────────────────────
  fcPoly: [[FC, SAN_FC, `${SAN_FC},polygonOffset:!0,polygonOffsetFactor:1,polygonOffsetUnits:1`, 1]],
  stPoly: [[STUDIO, SAN_ST, `${SAN_ST},polygonOffset:!0,polygonOffsetFactor:1,polygonOffsetUnits:1`, 1]],

  // ── ĐỐI CHỨNG TÁCH Z-FIGHTING KHỎI RĂNG CƯA (nâng lưới 5 m) ────────────────
  stLuoiCao5: [[STUDIO, LUOI_ST, LUOI_ST.replace("position:[t/2,0,e/2]", "position:[t/2,5,e/2]"), 1]],
  fcLuoiCao5: [[FC, GRID_FC, GRID_FC.replace("position:[0,0,0]", "position:[0,5,0]"), 1]],

  // ── CHẨN ĐOÁN: TẤM LƯỚI KHỔNG LỒ CỦA `infiniteGrid` ────────────────────────
  // drei nhân `localPosition` với `1 + fadeDistance` khi `infiniteGrid` bật ⇒ tấm
  // lưới rộng `args × (1+fadeDistance)` = 1.640 × 2.051 ≈ **3,36 TRIỆU mét**, trong
  // khi `far` chỉ 8.200 m. Hai biến thể này hỏi: cái ăn lưới có phải CỠ TẤM không?
  // Tắt `infiniteGrid` và nới `args` lên `S*40` = 16.400 m: tấm vẫn PHỦ HẾT khung
  // (far 8.200 m) nhưng NHỎ HƠN ~205 lần. Nếu lưới hiện lại thì thủ phạm là CỠ TẤM.
  fcTamNho: [
    [FC, "args:[S*4,S*4],cellSize:2", "args:[S*40,S*40],cellSize:2", 1],
    [FC, "fadeDistance:S*5,fadeStrength:1.2,infiniteGrid:!0", "fadeDistance:S*5,fadeStrength:1.2,infiniteGrid:!1", 1],
  ],

  // Kéo LƯỚI về phía camera bằng `polygonOffset` ÂM (đối xứng với cách PH-51 đẩy
  // SÀN ra xa). Vá ở chunk vendor vì vật liệu của drei `<Grid>` là PHẦN TỬ CON.
  fcGridPolyN1: [[VENDOR, VL_GRID, VL_GRID.replace("side:y}", "side:y,polygonOffset:!0,polygonOffsetFactor:-1,polygonOffsetUnits:-1}"), 1]],
  fcGridPolyN8: [[VENDOR, VL_GRID, VL_GRID.replace("side:y}", "side:y,polygonOffset:!0,polygonOffsetFactor:-8,polygonOffsetUnits:-8}"), 1]],

  // ── ③ LƯỚI QUÁ DÀY — các ứng viên cỡ ô ─────────────────────────────────────
  // (D1) drei Grid: cellSize 2 → theo cỡ cảnh (banKinh/50), sectionSize ×5.
  fcO50: [[FC, GRID_FC, GRID_FC.replace("cellSize:2", "cellSize:Math.max(2,S/50)"), 1]],
};

const ten = process.argv.slice(2);
const noiDung = new Map(TEP.map((f) => [f, fs.readFileSync(`${GOC}/${f}`, "utf8")]));

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
const bao = TEP.filter((f) => md5(`${GOC}/${f}`) !== md5(`${DIST}/${f}`)).map((f) => `${f}=${md5(`${DIST}/${f}`)}`);
console.log(`biến thể [${ten.join("+") || "GỐC"}] · đã vá: ${bao.length ? bao.join(" · ") : "KHÔNG TỆP NÀO (=gốc)"}`);
