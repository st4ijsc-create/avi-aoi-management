#!/usr/bin/env node
/**
 * ★★ Đợt 7.3 — GHI KẾT QUẢ ĐO vào sổ model (`ai_model_eval_runs`, mig 0400) từ một báo cáo đường (a) của bộ NGẪU NHIÊN.
 * Lượt đo là ĐIỀU KIỆN để gán vai trò ở chế độ `active` trỏ hồ sơ cố định (`soModel/datGan.ts`).
 *
 *   node scripts/ai-eval/ghi-ket-qua-so-model.mjs --bao-cao <nhãn> --profile <id hồ sơ> --suite <tên bộ> [--artifact <id> --slot nang --ctx 65536 --thinking on --license apache-2.0]
 *
 * Có `--artifact` ⇒ tạo/cập nhật hồ sơ (upsert) + khai giấy phép artifact trước khi ghi. Ưu tiên báo cáo `<nhãn>-cl` (chấm lại)
 * nếu có. Ghi `gitSha` của HEAD và chi tiết theo mức + vân tay bài (so sánh hai lượt chỉ hợp lệ trên cùng vân tay).
 *
 * ★ Đợt 9 — `--trich-xuat <tệp json>` (thay `--bao-cao`): kết quả `scripts/ai-eval/trich-xuat/do.mts` (vai trò extract):
 *   nTasks = số bài, nPass = bài TRỌN (mọi trường đúng), p50/p90 từ thời gian từng bài; detail mang trường đúng/tổng + model
 *   thực chạy. Tệp thiếu `p50Ms` (bản cũ, không có thời gian từng bài) ⇒ TỪ CHỐI (sổ cần thời gian hợp lệ).
 */
import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";

const arg = (k, d) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : d;
};
const NHAN = arg("--bao-cao");
const TRICH_XUAT = arg("--trich-xuat");
const PROFILE = arg("--profile");
const SUITE = arg("--suite", TRICH_XUAT ? "trich-xuat-mu-2026-10-21" : "plc-st-v1");
if ((!NHAN && !TRICH_XUAT) || !PROFILE) {
  console.error("cần (--bao-cao | --trich-xuat) và --profile");
  process.exit(2);
}
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "../..");
const env = Object.fromEntries(
  fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]),
);
const thuMucBc = path.join(ROOT, "scripts/ai-eval/ngau-nhien/reports");
const tepCl = path.join(thuMucBc, `${NHAN}-cl.json`);
const tepGoc = TRICH_XUAT ? path.resolve(TRICH_XUAT) : path.join(thuMucBc, `${NHAN}.json`);
const goc = JSON.parse(fs.readFileSync(tepGoc, "utf8"));
// ★ Đợt 9 — báo cáo mot-luot KHÔNG TRỌN (server chết / model đổi giữa lượt) ⇒ từ chối, trừ khi người ghi khẳng định đã ghép.
if (!TRICH_XUAT && (goc.dungSom || goc.songSau === false || (goc.modelDau && goc.modelCuoi !== goc.modelDau)) && !process.argv.includes("--cho-phep-khong-tron")) {
  console.error(`báo cáo ${NHAN} KHÔNG TRỌN (dungSom=${JSON.stringify(goc.dungSom)}, songSau=${goc.songSau}, model ${goc.modelDau}→${goc.modelCuoi}) — ghép/chạy lại trước khi ghi sổ`);
  process.exit(2);
}
if (TRICH_XUAT && !Number.isFinite(goc.p50Ms)) {
  console.error("tệp trích xuất thiếu thời gian từng bài (bản do.mts cũ) — đo lại bằng do.mts hiện hành");
  process.exit(2);
}
// Trích xuất: mỗi bài một "lượt", ĐẠT = bài trọn; muc "trich-xuat".
const rows = TRICH_XUAT
  ? goc.chiTiet.map((c) => ({ id: c.id, muc: "trich-xuat", dat: c.dung === c.tong, totalMs: c.ms }))
  : fs.existsSync(tepCl) ? JSON.parse(fs.readFileSync(tepCl, "utf8")).rows : goc.rows;
const ms = (TRICH_XUAT ? rows : goc.rows).map((r) => r.totalMs).filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
const pct = (p) => (ms.length ? ms[Math.min(ms.length - 1, Math.floor(p * ms.length))] : null);
const theoMuc = {};
for (const r of rows) {
  theoMuc[r.muc] ??= { dat: 0, tong: 0 };
  theoMuc[r.muc].tong++;
  if (r.dat) theoMuc[r.muc].dat++;
}
/** SHA của HEAD đọc thẳng từ thư mục git (không spawn — lưới kiểm kê VRAM đếm mọi điểm spawn trong scripts/). */
function shaHead() {
  try {
    let gitDir = path.join(ROOT, ".git");
    if (fs.statSync(gitDir).isFile()) gitDir = path.resolve(ROOT, fs.readFileSync(gitDir, "utf8").replace(/^gitdir:\s*/, "").trim());
    const head = fs.readFileSync(path.join(gitDir, "HEAD"), "utf8").trim();
    if (!head.startsWith("ref:")) return head;
    const ref = head.slice(4).trim();
    const chung = fs.existsSync(path.join(gitDir, "commondir")) ? path.resolve(gitDir, fs.readFileSync(path.join(gitDir, "commondir"), "utf8").trim()) : gitDir;
    for (const g of [gitDir, chung]) if (fs.existsSync(path.join(g, ref))) return fs.readFileSync(path.join(g, ref), "utf8").trim();
    const packed = fs.readFileSync(path.join(chung, "packed-refs"), "utf8").split(/\r?\n/).find((l) => l.endsWith(" " + ref));
    return packed ? packed.split(" ")[0] : "khong-ro";
  } catch {
    return "khong-ro";
  }
}
const sha = shaHead();
const sql = postgres(env.DATABASE_URL, { max: 1 });
try {
  if (arg("--artifact")) {
    const a = arg("--artifact");
    if (arg("--license")) await sql`UPDATE ai_model_artifacts SET license = ${arg("--license")}, "updatedAt" = now() WHERE id = ${a}`;
    await sql`INSERT INTO ai_serving_profiles (id, "artifactId", "slotClass", ctx, thinking)
      VALUES (${PROFILE}, ${a}, ${arg("--slot", "nang")}, ${Number(arg("--ctx", "65536"))}, ${arg("--thinking", "auto")})
      ON CONFLICT (id) DO UPDATE SET "slotClass" = EXCLUDED."slotClass", ctx = EXCLUDED.ctx, thinking = EXCLUDED.thinking`;
  }
  const [hs] = await sql`SELECT id FROM ai_serving_profiles WHERE id = ${PROFILE}`;
  if (!hs) throw new Error(`không có hồ sơ ${PROFILE} — thêm --artifact để tạo`);
  const nPass = rows.filter((r) => r.dat).length;
  const [r] = await sql`INSERT INTO ai_model_eval_runs ("profileId", suite, "nTasks", "nPass", "nRuns", "p50Ms", "p90Ms", detail, "gitSha")
    VALUES (${PROFILE}, ${SUITE}, ${new Set(rows.map((x) => x.id)).size}, ${nPass}, ${TRICH_XUAT ? 1 : goc.soLuot ?? 1}, ${pct(0.5)}, ${pct(0.9)},
      ${sql.json(TRICH_XUAT
        ? { tepKetQua: path.basename(tepGoc), modelThuc: goc.model, nghi: goc.nghi, luc: goc.luc, truongDung: goc.dung, truongTong: goc.tong, khongJson: goc.khongJson, theoMuc }
        : { nhanBaoCao: NHAN, chamLai: fs.existsSync(tepCl), tongLuot: rows.length, theoMuc, seed: goc.seed, sampling: goc.sampling, khongNghi: goc.khongNghi, vanTay: goc.bai?.map((b) => [b.id, b.vanTay]) })},
      ${sha.slice(0, 40)}) RETURNING id`;
  console.log(`ghi lượt đo #${r.id}: ${PROFILE} · ${SUITE} · ${nPass}/${rows.length} · p50 ${pct(0.5)} ms`);
} finally {
  await sql.end();
}
