// CHẤM LẠI báo cáo đầu–cuối đã lưu (toàn văn câu trả lời có sẵn) bằng bộ chấm HIỆN TẠI — để so các vòng cũ cùng thước,
// không gọi server, không gọi model.
//   node scripts/ai-eval/kb-dau-cuoi-cham-lai.mjs <báo-cáo.json> [...]
// In một dòng mỗi tệp: tóm tắt mới + số câu ĐỔI loại so với nhãn đã lưu.
import fs from "node:fs";
import { chamMot, tomTat } from "./_phan-loai-tra-loi.mjs";

const boCua = (corpus) => {
  const p = String(corpus).endsWith(".jsonl") ? corpus : `knowledge/studio-golden/${corpus}.jsonl`;
  return Object.fromEntries(fs.readFileSync(p, "utf8").trim().split(/\r?\n/).map((l) => JSON.parse(l)).map((c) => [c.id, c]));
};

for (const tep of process.argv.slice(2)) {
  const r = JSON.parse(fs.readFileSync(tep, "utf8"));
  const bo = boCua(r.corpus);
  const ra = r.ra.map((x) => ({ ...x, kqCu: x.kq, kq: x.kq === "loi" ? "loi" : bo[x.id] ? chamMot(bo[x.id], x.traLoi) : x.kq }));
  const doi = ra.filter((x) => x.kq !== x.kqCu).map((x) => `${x.id}:${x.kqCu}→${x.kq}`);
  console.log(`${tep.split(/[\\/]/).pop()} ${JSON.stringify(tomTat(ra))} | đổi ${doi.length}: ${doi.join(" ")}`);
}
