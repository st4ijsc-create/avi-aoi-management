/**
 * ★★ AI Local Đợt 8.4 — ĐO "mô tả → luồng" với MODEL THẬT trên 20 mô tả viết trước (`mo-ta.json`). Cổng: ≥ 70 % bản nháp hợp
 * lệ + 0 tự kích hoạt, chạy ≥ 3 lượt (spec §6). CHƯA chạy lúc viết (2026-10-20: :8091 đang bận đo model) — thước đã kiểm bằng
 * model giả (`cham.test.ts`).
 *
 *   npx tsx scripts/ai-eval/mo-ta-luong/chay.mts [--lan 3] [--openai http://127.0.0.1:8091] [--model <id>] [--khong-db]
 *
 * Mặc định: ĐƯỜNG SẢN PHẨM — `taoTuMoTa` với hàm gọi mặc định (Cổng AI `routeInference` + engine, vai trò `code.software`;
 * cần `.env` như máy chủ, llama-server bật). `--openai URL`: gọi thẳng `/v1/chat/completions` của llama-server với CÙNG lời
 * nhắc (đo model khi không dựng được đường sản phẩm — ghi rõ trong báo cáo, không trộn số hai đường).
 * Đếm `ai_flows` (tổng, bật) trước/sau mỗi lượt nếu với được CSDL (`--khong-db` bỏ). Báo cáo: tmp/mo-ta-luong/<thời điểm>.json.
 * Mã thoát: 0 = mọi lượt đạt cổng · 1 = có lượt trượt · 2 = lỗi hạ tầng.
 */
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chamBo, NGUONG_HOP_LE, type BaoCaoCham, type MoTa } from "./cham";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const GOC = path.resolve(DIR, "../../..");
const arg = (k: string, d: string | null = null) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? (process.argv[i + 1] ?? "") : d;
};
const SO_LAN = Math.max(1, Number(arg("--lan", "3")));
const OPENAI = arg("--openai");
const MODEL = arg("--model", "code.software");
const CO_DB = !process.argv.includes("--khong-db");

const bo = JSON.parse(fs.readFileSync(path.join(DIR, "mo-ta.json"), "utf8")) as { moTa: MoTa[] };
const { taoTuMoTa } = await import("../../../server/services/flow/taoTuMoTa");
const { datHamGoiAi } = await import("../../../server/services/flow/nut/ai");

if (OPENAI) {
  datHamGoiAi(async ({ heThong, nguoiDung, maxTokens }) => {
    const r = await fetch(`${OPENAI.replace(/\/$/, "")}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: MODEL, temperature: 0.2, max_tokens: maxTokens, messages: [{ role: "system", content: heThong }, { role: "user", content: nguoiDung }], chat_template_kwargs: { enable_thinking: false } }),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`);
    const j = (await r.json()) as { choices?: { message?: { content?: string } }[] };
    return j.choices?.[0]?.message?.content ?? "";
  });
}

let demLuong: (() => Promise<{ tong: number; bat: number }>) | undefined;
if (CO_DB) {
  try {
    const { getDb } = await import("../../../server/db/connection");
    const { sql } = await import("drizzle-orm");
    const db = await getDb();
    if (db) {
      demLuong = async () => {
        const [r] = (await db.execute(sql`SELECT count(*)::int AS tong, count(*) FILTER (WHERE enabled)::int AS bat FROM ai_flows`)) as unknown as { tong: number; bat: number }[];
        return r;
      };
    }
  } catch (e) {
    console.warn(`(không đếm được CSDL: ${(e as Error).message})`);
  }
}

const luot: BaoCaoCham[] = [];
try {
  for (let i = 1; i <= SO_LAN; i++) {
    const bc = await chamBo(bo.moTa, (m) => taoTuMoTa(m), demLuong);
    luot.push(bc);
    console.log(
      `lượt ${i}/${SO_LAN}: hợp lệ ${bc.hopLe}/${bc.tong} (${(bc.tiLeHopLe * 100).toFixed(0)} %) · có schema ${bc.coSchema} · tự kích hoạt ${bc.tuKichHoat} · ${bc.datCong ? "ĐẠT" : "TRƯỢT"}`,
    );
    for (const c of bc.chiTiet.filter((x) => !x.hopLe)) console.log(`   ✗ ${c.id}: ${c.loi.slice(0, 3).join(" | ")}`);
  }
} catch (e) {
  console.error(`lỗi hạ tầng: ${(e as Error).message}`);
  process.exit(2);
}
const thuMuc = path.join(GOC, "tmp", "mo-ta-luong");
fs.mkdirSync(thuMuc, { recursive: true });
const tep = path.join(thuMuc, `${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
fs.writeFileSync(tep, JSON.stringify({ duong: OPENAI ? `openai ${OPENAI} model=${MODEL}` : "san-pham (Cổng AI, code.software)", nguong: NGUONG_HOP_LE, luot }, null, 2));
console.log(`báo cáo: ${tep}`);
process.exit(luot.every((l) => l.datCong) ? 0 : 1);
