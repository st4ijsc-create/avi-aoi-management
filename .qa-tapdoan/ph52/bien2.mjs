/**
 * ph52/bien2.mjs — BIẾN THỂ TRÊN `dist-ph52s` (bản dựng THẬT từ cây nguồn đã vá).
 *
 * Vì sao cần: `dist-ph52t` dựng ở `de1dc50a`, còn HEAD lúc tôi làm đã sang
 * `a098369d` (hai commit của phiên khác nằm trên). Nếu lấy `dist-ph52t` làm
 * "TRƯỚC" và `dist-ph52s` làm "SAU" thì hiệu số gộp cả thay đổi của họ. Nên
 * "TRƯỚC" ở đây được tạo bằng cách **GỠ ĐÚNG BẢN VÁ CỦA TÔI** khỏi bundle đã
 * dựng — mọi byte khác giống hệt, và đó là ablation theo đúng nghĩa.
 *
 *   node .qa-tapdoan/ph52/bien2.mjs <tên1> [tên2 ...]   (không tên = GỐC = ĐÃ VÁ)
 */
import fs from "node:fs";
import crypto from "node:crypto";

const DIST = ".qa-tapdoan/dist-ph52s/public/assets";
const GOC = ".qa-tapdoan/ph52/goc2";

const FC = "FactoryCommandView-BkSHjMDJ.js";
const ST = "TwinStudio-CoV7zBis.js";
const KHUNG = "KhungCanh-BiGwCO3Z.js";
const VENDOR = "vendor-three-eG2QjD9l.js";
const TEP = [FC, ST, KHUNG, VENDOR];

const VA_FC = ",depthWrite:_t";
const VA_ST = ",polygonOffset:!0,polygonOffsetFactor:gs,polygonOffsetUnits:ps";
const VL_GRID = '{transparent:!0,"extensions-derivatives":!0,side:y}';
const LUOI_ST = 'CanhThietKe.tsx:264",args:[i,Math.max(4,Math.round(i)),c,r],position:[t/2,0,e/2]';
const SAN_ST = 'CanhThietKe.tsx:256",color:s';

const BIEN = {
  /** GỠ bản vá `/factory-command` ⇒ dựng lại trạng thái CHƯA VÁ. */
  boVaFC: [[FC, VA_FC, "", 1]],
  /** GỠ bản vá Studio ⇒ dựng lại trạng thái CHƯA VÁ. */
  boVaST: [[ST, VA_ST, "", 1]],

  /** ORACLE "lưới vẽ đủ" — lưới drei thôi so/ghi độ sâu (chunk vendor). */
  fcOracle: [[VENDOR, VL_GRID, '{transparent:!0,"extensions-derivatives":!0,side:y,depthTest:!1,depthWrite:!1}', 1]],
  /** ORACLE "lưới vẽ đủ" cho Studio — `gridHelper` thôi so/ghi độ sâu. */
  stOracle: [[ST, LUOI_ST, `${LUOI_ST},renderOrder:1,"material-depthWrite":!1,"material-depthTest":!1`, 1]],
  /** ORACLE ĐỘC LẬP THỨ HAI cho Studio — SÀN thôi ghi độ sâu. */
  stOracleSan: [[ST, SAN_ST, `${SAN_ST},depthWrite:!1`, 1]],

  /** NHIỄU ĐỘ SÂU THUẦN — `NEAR_TOI_DA_M` 0,5 → 0,1 (cảnh lớn). */
  near01: [[KHUNG, "Mt=.1,vt=.5", "Mt=.1,vt=.1", 1]],
  /** NHIỄU ĐỘ SÂU THUẦN — `NEAR_TOI_THIEU_M` 0,1 → 0,4 (cảnh nhỏ: Studio). */
  near04: [[KHUNG, "Mt=.1,vt=.5", "Mt=.4,vt=.5", 1]],
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
console.log(`bien2 [${ten.join("+") || "GỐC = ĐÃ VÁ"}] · đã đổi: ${bao.length ? bao.join(" · ") : "KHÔNG TỆP NÀO"}`);
