/**
 * TẢI dữ liệu BÀI MultiPL-E (chỉ đề + test — KHÔNG tải lời giải/completion của model nào) từ nguồn chính thức:
 *   • HuggingFace `nuprl/MultiPL-E` (Cassano et al., HumanEval + MBPP dịch sang nhiều ngôn ngữ), qua API hàng của
 *     datasets-server (JSON, không cần thư viện parquet);
 *   • Python: `openai/openai_humaneval` (HumanEval gốc — có `canonical_solution`, dùng cho kiểm thước Python).
 *
 * Dữ liệu tải về là KHÔNG TIN CẬY: ghi vào thư mục riêng (mặc định `tmp/ngau-nhien/multipl-e/` — đã .gitignore), chỉ
 * đọc như JSON; mã trong đó CHỈ được chạy bởi trình chấm (`run.mjs`) trong thư mục làm việc tạm, như mã model sinh.
 * Ghi kèm `nguon.json`: URL, thời điểm, số hàng, sha256 từng tệp ⇒ lượt đo nào cũng truy được đúng bản dữ liệu.
 *
 *   node scripts/ai-eval/ngau-nhien/multipl-e/tai.mjs [--ngon-ngu cpp,cs,go,java,js,rs,ts] [--bo humaneval,mbpp] [--ra <thư mục>]
 *   (+ javatuples 1.2 từ Maven Central — mọi đề Java của MultiPL-E `import org.javatuples.*`)
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { ROOT } from "../lib/moiTruong.mjs";

const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const RA = path.resolve(arg("--ra", `${ROOT}/tmp/ngau-nhien/multipl-e`));
const NGON_NGU = arg("--ngon-ngu", "cpp,cs,go,java,js,rs,ts").split(",");
const BO = arg("--bo", "humaneval,mbpp").split(",");
const API = "https://datasets-server.huggingface.co/rows";

fs.mkdirSync(RA, { recursive: true });
const sha = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

async function layHet(dataset, config, split = "test") {
  const hang = [];
  for (let offset = 0; ; offset += 100) {
    const url = `${API}?dataset=${encodeURIComponent(dataset)}&config=${encodeURIComponent(config)}&split=${split}&offset=${offset}&length=100`;
    let j;
    for (let thu = 1; ; thu++) {
      const r = await fetch(url, { signal: AbortSignal.timeout(60000) });
      if (r.ok) { j = await r.json(); break; }
      if (thu >= 4) throw new Error(`${config} offset ${offset}: HTTP ${r.status}`);
      await new Promise((ok) => setTimeout(ok, 2000 * thu));
    }
    hang.push(...j.rows.map((x) => x.row));
    if (hang.length >= j.num_rows_total || j.rows.length === 0) return hang;
  }
}

const nguon = { luc: new Date().toISOString(), tep: {} };
async function ghi(ten, dataset, config, hang) {
  const buf = Buffer.from(hang.map((h) => JSON.stringify(h)).join("\n") + "\n", "utf8");
  fs.writeFileSync(`${RA}/${ten}.jsonl`, buf);
  nguon.tep[`${ten}.jsonl`] = { dataset, config, soHang: hang.length, sha256: sha(buf), url: `https://huggingface.co/datasets/${dataset}` };
  console.error(`  ${ten}: ${hang.length} bài`);
}

for (const bo of BO) {
  for (const l of NGON_NGU) {
    const config = `${bo}-${l}`;
    await ghi(config, "nuprl/MultiPL-E", config, await layHet("nuprl/MultiPL-E", config));
  }
}
if (BO.includes("humaneval")) {
  await ghi("humaneval-py", "openai/openai_humaneval", "openai_humaneval", await layHet("openai/openai_humaneval", "openai_humaneval"));
}

// javatuples 1.2 (Maven Central) — kiểm sha1 do Maven Central công bố.
if (NGON_NGU.includes("java")) {
  const goc = "https://repo1.maven.org/maven2/org/javatuples/javatuples/1.2/javatuples-1.2.jar";
  const jar = Buffer.from(await (await fetch(goc)).arrayBuffer());
  const sha1 = (await (await fetch(goc + ".sha1")).text()).trim().split(/\s+/)[0];
  const thuc = crypto.createHash("sha1").update(jar).digest("hex");
  if (thuc !== sha1) throw new Error(`javatuples sha1 lệch: ${thuc} ≠ ${sha1}`);
  fs.writeFileSync(`${RA}/javatuples-1.2.jar`, jar);
  nguon.tep["javatuples-1.2.jar"] = { url: goc, sha1, sha256: sha(jar) };
  console.error(`  javatuples-1.2.jar: sha1 khớp ${sha1}`);
}
fs.writeFileSync(`${RA}/nguon.json`, JSON.stringify(nguon, null, 1));
console.log(`đã tải vào ${RA}`);
