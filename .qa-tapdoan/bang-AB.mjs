/**
 * Dựng `.qa-tapdoan/BANG-AB.md` từ thô `.qa-tapdoan/tho/AB/*.json`.
 * Chạy: node .qa-tapdoan/bang-AB.mjs
 * G130 — ghi tệp tạm rồi `rename`, không `>` đè trực tiếp.
 */
import { readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";

const OUT = ".qa-tapdoan/tho/AB";
const DICH = ".qa-tapdoan/BANG-AB.md";
const THU_TU = ["A1", "A2", "A3", "B1", "B2", "B3", "B4", "B5", "B6", "B7", "B8", "LOI"];
const VAI_TT = ["qatd_giamdoc", "qatd_quanly", "qatd_kythuat", "qatd_congnhan", "qatd_admin", "qatd_khonggan", "qatd_khongquyen"];

const ca = readdirSync(OUT)
  .filter((f) => f.endsWith(".json") && f !== "TONG.json" && !f.startsWith("."))
  .map((f) => JSON.parse(readFileSync(`${OUT}/${f}`, "utf8")));
ca.sort((a, b) => (THU_TU.indexOf(a.id) - THU_TU.indexOf(b.id)) || (VAI_TT.indexOf(a.vai) - VAI_TT.indexOf(b.vai)));

const oneLine = (s) => String(s ?? "").replace(/\s*\n\s*/g, " ").replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
const cat = (s, n) => { const t = oneLine(s); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

/** Dữ kiện gọn cho cột bảng — chọn các khoá NÓI ĐƯỢC KẾT LUẬN, thô đầy đủ nằm ở tệp JSON. */
function duKienGon(c) {
  const d = c.duKienDoc ?? {};
  const uu = [
    "URL cuối", "URL", "man-twin-van-hanh", "h1",
    "số mục (data-so-muc)", "CHỮ người dùng thấy", "id các mục", "kỳ vọng id",
    "bo-chon-nap có/không", "factory.list (API)",
    "dem-may", "dem-may khớp", "máy DB của tầng", "máy DB của tầng này", "máy DB của cả nhà máy", "máy DB của nhà máy",
    "máy VẼ trên cảnh (dsMay)", "tầng đang chọn", "tầng đã chọn (UI)", "tang_id kỳ vọng",
    "số toà trong ô chọn", "số tầng trong ô chọn",
    "spinner/pulse trong màn", "chữ giải thích rỗng (banner)", "danh-sach-rong",
    "số nhà máy trong ô chọn (chọn được)", "số công ty có dữ liệu trên màn", "banner-ha-cap",
    "nhà máy UI đang chọn", "nhà máy ĐẦU trong danh sách", "cảnh khớp tầng của QATD-B",
    "các bước", "ô chọn toà nhận lệnh", "cảnh 3D đổi đúng theo tầng của từng toà", "dem-may đổi đúng theo tầng",
    "chữ trên màn",
  ];
  const ra = [];
  for (const k of uu) {
    if (!(k in d)) continue;
    let v = d[k];
    if (k === "các bước" && Array.isArray(v)) {
      v = v.map((b) => `toà${b.toaSo}(${b.toaMa}) DB=${b["máy DB của tầng ấy"]} dem-may=${b["dem-may"]} cảnh=${b["máy VẼ trên cảnh (dsMay)"]?.so}`).join(" ; ");
    } else if (v !== null && typeof v === "object") {
      v = JSON.stringify(v);
    }
    ra.push(`**${k}**=${cat(v, 150)}`);
    if (ra.length >= 7) break;
  }
  if (c.thieuDuKien) ra.unshift(`**THIẾU**=${cat(c.thieuDuKien.join(", "), 120)}`);
  return ra.join(" · ");
}

const dem = { "ĐẠT": 0, "SAI": 0, "HỎNG": 0, "CHẶN-ĐÚNG": 0, "N/A": 0 };
let khong = 0;
for (const c of ca) { if (c.phanQuyet in dem) dem[c.phanQuyet] += 1; else khong += 1; }

const d = [];
d.push("# QA LẦN 11 · LÔ A + B — BẢNG KẾT QUẢ ĐO");
d.push("");
d.push(`Server đo: \`${ca[0]?.base ?? "?"}\` (PID 19136, bundle \`index-DxxtO34H.js\`, HEAD \`a147fc35\`) · viewport 1600×900 · **1 worker, tuần tự** (G147) · chạy \`node .qa-tapdoan/do-AB.mjs\`.`);
d.push(`Kỳ vọng ĐỘC LẬP từ DB: \`.qa-tapdoan/ky-vong-db.json\` + \`.qa-tapdoan/sinh-summary.json\`. Thô từng ca: \`.qa-tapdoan/tho/AB/<ca>-<vai>.json\`. Ảnh: \`.qa-tapdoan/anh/AB-*.png\`.`);
d.push("");
d.push("| ca | vai | đề bài | dữ kiện đọc được | kết cục | phán quyết | vì sao |");
d.push("|---|---|---|---|---|---|---|");
for (const c of ca) {
  d.push(`| ${c.id} | ${c.vai} | ${cat(c.deBai, 190)} | ${duKienGon(c)} | ${cat(c.ketCuc, 260)} | **${c.phanQuyet}** | ${cat(c.viSao, 330)} |`);
}
d.push("");
d.push(`**TỔNG ${ca.length} ca — ĐẠT ${dem["ĐẠT"]} · SAI ${dem["SAI"]} · HỎNG ${dem["HỎNG"]} · CHẶN-ĐÚNG ${dem["CHẶN-ĐÚNG"]} · N/A ${dem["N/A"]}**`);
d.push("");
d.push(`**ô không có phán quyết: ${khong}**`);
d.push("");

const tam = `${DICH}.tmp`;
writeFileSync(tam, d.join("\n"), "utf8");
renameSync(tam, DICH);

/* TONG.json dựng LẠI từ toàn bộ tệp ca (lượt chạy lẻ `--ca=` chỉ ghi phần của nó). */
const tamT = `${OUT}/.tmp-TONG.json`;
writeFileSync(tamT, JSON.stringify({
  luc: new Date().toISOString(), nguon: "bang-AB.mjs (đếm lại từ mọi tệp ca)",
  soCa: ca.length, dem, khongPhanQuyet: khong,
  ca: ca.map((c) => ({ id: c.id, vai: c.vai, pq: c.phanQuyet, luc: c.luc })),
}, null, 2));
renameSync(tamT, `${OUT}/TONG.json`);
console.log(`${DICH}: ${ca.length} ca · ĐẠT ${dem["ĐẠT"]} · SAI ${dem["SAI"]} · HỎNG ${dem["HỎNG"]} · CHẶN-ĐÚNG ${dem["CHẶN-ĐÚNG"]} · N/A ${dem["N/A"]} · không phán quyết ${khong}`);
