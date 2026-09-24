// Đo ĐẦU–CUỐI trợ lý vận hành trên bộ vàng Studio: thứ người dùng NHẬN (câu trả lời cuối), không phải điểm truy hồi.
//   node scripts/ai-eval/kb-dau-cuoi.mjs [corpus=st4i-may-aoi] [--only T05,N06] [--label ten]
// Chấm tất định (câu trong corpus: `dapAn` HOẶC `dapAnTraLoi`):
//   câu TRONG corpus : "dung"  = câu trả lời khớp regex đáp án · rồi HÌNH DẠNG (`_phan-loai-tra-loi.mjs`):
//                      "tu-choi" (câu chuẩn) · "tu-choi-mem" (câu đầu nói tài liệu không có) · "hoi-lai" · "sai" = còn lại
//   câu NGOÀI corpus : "tu-choi" · "tu-choi-mem" · "hoi-lai" (đều KHÔNG trả lời — không bịa) · "tra-loi" = trả lời THẬT
//   ⚠ Từ 2026-09-24 (PDCA §13): `tom.ngoai.traLoi` CHỈ đếm câu trả lời thật; trước đó nó gộp cả tu-choi-mem/hoi-lai.
//     Chấm lại báo cáo cũ bằng `kb-dau-cuoi-cham-lai.mjs` để so cùng thước.
// Không in cookie. Ghi JSON vào scripts/ai-eval/reports/kb-dau-cuoi-<label>.json.
import fs from "node:fs";
import { ck } from "../../tmp/audit-ai/cookie.mjs";
import { chamMot, tomTat } from "./_phan-loai-tra-loi.mjs";

const args = process.argv.slice(2);
const corpus = args.find((a) => !a.startsWith("--")) ?? "st4i-may-aoi";
const val = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const only = val("--only")?.split(",") ?? null;
const label = val("--label") ?? new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
const C = ck("D:/SOURCES/avi-aoi-management/tmp/audit-ai/ck.txt");

const bo = fs.readFileSync(corpus.endsWith(".jsonl") ? corpus : `knowledge/studio-golden/${corpus}.jsonl`, "utf8").trim().split(/\r?\n/).map((l) => JSON.parse(l))
  .filter((c) => !only || only.includes(c.id));

async function hoi(q) {
  const t0 = Date.now();
  const res = await fetch("http://127.0.0.1:3000/api/ai/local-kb/stream", {
    method: "POST", headers: { "Content-Type": "application/json", Cookie: C },
    body: JSON.stringify({ question: q, topK: 5, history: [], userRole: "admin", context: { route: "/ai-chat", uiLanguage: "vi" } }),
  });
  if (!res.ok) return { loi: `HTTP ${res.status}`, text: "", nguon: [], ms: Date.now() - t0 };
  let buf = "", text = "", nguon = [], done = null;
  const dec = new TextDecoder();
  for await (const c of res.body) {
    buf += dec.decode(c, { stream: true });
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const blk = buf.slice(0, i); buf = buf.slice(i + 2);
      const m = blk.match(/^data:\s*([\s\S]*)$/m); if (!m) continue;
      let o; try { o = JSON.parse(m[1]); } catch { continue; }
      if (o.type === "token") text += o.token ?? "";
      if (o.type === "meta" && Array.isArray(o.citations)) nguon = o.citations.map((x) => x.sourcePath ?? x.id);
      if (o.type === "done") { done = o; if (typeof o.answer === "string" && o.answerRevised) text = o.answer; if (Array.isArray(o.citations)) nguon = o.citations.map((x) => x.sourcePath ?? x.id); }
    }
  }
  return { text, nguon, ms: Date.now() - t0, provider: done?.provider ?? null };
}

const ra = [];
for (const c of bo) {
  const r = await hoi(c.cauHoi);
  const ngoai = (c.nguon ?? []).length === 0;
  const kq = r.loi ? "loi" : chamMot(c, r.text);
  ra.push({ id: c.id, ngoai, kq, ms: r.ms, nguon: r.nguon.slice(0, 5), traLoi: r.text /* TOÀN VĂN — bản 400 ký tự từng làm T44 không chấm được */, loi: r.loi ?? null });
  console.log(`${c.id.padEnd(4)} ${ngoai ? "NGOAI" : "TRONG"} ${kq.padEnd(8)} ${r.ms} ms`);
}
const tom = tomTat(ra);
console.log("TÓM", JSON.stringify(tom));
fs.mkdirSync("scripts/ai-eval/reports", { recursive: true });
fs.writeFileSync(`scripts/ai-eval/reports/kb-dau-cuoi-${label}.json`, JSON.stringify({ corpus, label, tom, ra }, null, 2));
