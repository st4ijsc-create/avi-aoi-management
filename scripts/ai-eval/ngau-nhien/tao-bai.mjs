/**
 * Dựng khung một bài MỚI trong kho từ khuôn ngôn ngữ (`mau-khung/<lang>/`).
 *   node scripts/ai-eval/ngau-nhien/tao-bai.mjs <id>        (id = <lang>-<tt|tv|ud><số>-<tên-ngắn>, vd go-tv2-httptest)
 * Bài mới thêm vào CUỐI kho; KHÔNG sửa bài đã đo (README §Luật kho bài).
 */
import fs from "node:fs";
import { BO, KHO } from "./lib/moiTruong.mjs";
import { KIEU_THEO_NGON_NGU } from "./lib/kho.mjs";
import { chepCay } from "./lib/cham.mjs";

const id = process.argv[2];
const m = id?.match(/^(py|js|ts|cs|java|cpp|sql|go|rs|st)-(tt|tv|ud)\d+-[a-z0-9-]+$/);
if (!m) { console.error("id phải dạng <lang>-<tt|tv|ud><số>-<tên>, lang ∈ py js ts cs java cpp sql go rs st"); process.exit(2); }
const [, lang, ma] = m;
const dir = `${KHO}/${id}`;
if (fs.existsSync(dir)) { console.error(`đã có ${dir}`); process.exit(2); }
chepCay(`${BO}/mau-khung/${lang}`, `${dir}/khung`);
fs.mkdirSync(`${dir}/an`, { recursive: true });
fs.mkdirSync(`${dir}/mau`, { recursive: true });
const baoVe = { py: ["pytest.ini"], sql: ["pytest.ini", "kiem_sql.py"], js: ["package.json"], ts: ["package.json"], cs: ["Bai.csproj"],
  java: ["test/Kt.java"], cpp: ["CMakeLists.txt", "tests/kt.hpp"], go: ["go.mod"], rs: ["Cargo.toml"], st: ["tests/kt.st"] }[lang];
fs.writeFileSync(`${dir}/bai.json`, JSON.stringify({
  id, lang, muc: { tt: "thuat-toan", tv: "thu-vien", ud: "ung-dung" }[ma], kieu: KIEU_THEO_NGON_NGU[lang],
  tieuDe: "", deBai: "", tepGiai: [], dinhDanh: "", testHienThi: [], testAn: [], tepBaoVe: baoVe,
  soTest: { hienThi: 0, an: 0 }, sai: [{ tep: "", tu: "", den: "" }],
}, null, 2) + "\n");
console.log(`đã dựng ${dir} — điền bai.json, khung/, an/, mau/ rồi chạy: node scripts/ai-eval/ngau-nhien/kiem-thuoc.mjs --only ${id}`);
