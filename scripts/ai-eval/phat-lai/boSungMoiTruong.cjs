// LUU VET (rà kiem-dinh 03/11): script DA DUNG 03/11 de bo sung lenh.moiTruong / tonTaiTruoc / doDaiGoc cho 3 fixture dong goi TRUOC khi
// dongGoi.ts co cac truong nay (ts-gio-hang-8be2acc5, py-kho-cache-088c33e1, py-dang-ky-933bdbc1; ban tho da xoa). Cung quy tac dongGoi.ts.
// tonTaiTruoc = 'git status --ignored --porcelain sandbox-projects/agent-f' cua cay chinh luc dong goi (ghi o tmp/do-nen-11/ton-tai-truoc.txt).
// Chay: node scripts/ai-eval/phat-lai/boSungMoiTruong.cjs server/testing/fixtures/phat-lai <csv tonTaiTruoc> <ten.json.gz> ... (nem neu fixture da co truong moi).
// Bổ sung lenh.moiTruong / tonTaiTruoc / doDaiGoc cho fixture đã đóng gói TRƯỚC khi dongGoi có các trường này (03/11; bản thô đã xoá).
// Cùng quy tắc dongGoi.ts: cờ từ D:/SOURCES/avi-aoi-management/.env (máy chủ lúc ghi, .env-only + 2 biến tiến trình không phải cờ agent).
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const [thuMuc, tonTaiCsv, ...ten] = process.argv.slice(2);
const env = fs.readFileSync("D:/SOURCES/avi-aoi-management/.env", "utf8");
const moiTruong = {};
for (const m of env.matchAll(/^(AI_AGENT_[A-Z0-9_]+|AI_AGENTIC_[A-Z0-9_]+|AI_CODING_[A-Z0-9_]+)=(.*)$/gm)) {
  if (/HOUSEKEEPING/.test(m[1])) continue;
  moiTruong[m[1]] = m[2].replace(/\s+#.*$/, "").trim().replace(/^["']|["']$/g, "");
}
const goc = path.resolve("D:/SOURCES/avi-aoi-management/sandbox-projects/agent-f");
const tonTaiTruoc = tonTaiCsv.split(",").filter(Boolean);
for (const t of ten) {
  const p = path.join(thuMuc, t);
  const fx = JSON.parse(zlib.gunzipSync(fs.readFileSync(p)).toString("utf8"));
  if (fx.lenh.moiTruong || fx.lenh.doDaiGoc) throw new Error(`${t} đã có trường mới`);
  fx.lenh = { ...fx.lenh, moiTruong, tonTaiTruoc, doDaiGoc: goc.length };
  const gz = zlib.gzipSync(Buffer.from(JSON.stringify(fx), "utf8"), { level: 9 });
  fs.writeFileSync(p, gz);
  console.log(t, gz.length, JSON.stringify({ moiTruong, n: tonTaiTruoc.length, doDaiGoc: goc.length }));
}
