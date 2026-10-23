#!/usr/bin/env node
/**
 * ★ Đợt 9 (2026-10-23, dieu-phoi) — ĐẾM số lần ĐỔI KHE nặng (llama-server :8091, 35B ↔ 27B…) theo GIỜ, từ `vram_events` (event `doi_khe`,
 * ghi bởi `soModel/kheNangMacDinh.ts` — chỉ có từ bản chứa dòng ghi đó trở đi). Theo dõi sau khi bật trợ lý + tác nhân theo vai trò:
 * > NGUONG lần/giờ ⇒ báo dieu-phoi (đổi khe làm câu trả lời KB/vận hành xếp hàng sau).
 *   node scripts/ai-eval/dem-doi-khe.mjs [--gio 24] [--nguong 6]
 * ⚠ `createdAt` là timestamp KHÔNG múi giờ (lỗi naive đã biết) — nhóm theo giờ của CHÍNH cột, so tương đối giữa các giờ là đúng.
 */
import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";

const arg = (k, d) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : d;
};
const GIO = Number(arg("--gio", 24));
const NGUONG = Number(arg("--nguong", 6));
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "../..");
const env = Object.fromEntries(
  fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).replace(/^"|"$/g, "")]),
);
const sql = postgres(env.DATABASE_URL, { max: 1 });
try {
  const r = await sql`
    SELECT date_trunc('hour', "createdAt") AS gio, count(*)::int AS so, count(*) FILTER (WHERE detail->>'ketQua' <> 'thanh-cong')::int AS hong,
           string_agg(DISTINCT detail->>'den', ', ') AS den
    FROM vram_events WHERE event = 'doi_khe' AND "createdAt" > (SELECT max("createdAt") FROM vram_events) - make_interval(hours => ${GIO})
    GROUP BY 1 ORDER BY 1`;
  if (!r.length) console.log(`(không có sự kiện doi_khe trong ${GIO} giờ gần nhất — :3000 chưa chạy bản có dòng ghi, hoặc không đổi khe)`);
  for (const x of r) console.log(`${x.gio.toISOString().slice(0, 13)}h · ${x.so} lần${x.hong ? ` (${x.hong} hỏng)` : ""} · đích: ${x.den}${x.so > NGUONG ? `   ⚠ > ${NGUONG}/giờ — BÁO dieu-phoi` : ""}`);
  process.exitCode = r.some((x) => x.so > NGUONG) ? 1 : 0;
} finally {
  await sql.end();
}
