// Vòng 9: hạng đoạn chứa đáp án trong top-20 của endpoint sản phẩm. node tmp/hang-v9.mjs <bộ.jsonl> [ids]
import fs from "node:fs";
import { ck } from "./audit-ai/cookie.mjs";
const C = ck("D:/SOURCES/avi-aoi-management/tmp/audit-ai/ck.txt");
const chunks = new Map(fs.readFileSync("knowledge/chunks.jsonl", "utf8").trim().split("\n").map((l) => { const c = JSON.parse(l); return [c.id, c]; }));
const only = process.argv[3]?.split(",");
const bo = fs.readFileSync(process.argv[2], "utf8").trim().split(/\r?\n/).map((l) => JSON.parse(l)).filter((c) => c.nguon?.length && (!only || only.includes(c.id)));
for (const c of bo) {
  const re = new RegExp((c.dapAnTraLoi ?? c.dapAn).regex, "i");
  const r = await fetch("http://127.0.0.1:3000/api/ai/local-kb/retrieve", { method: "POST", headers: { "Content-Type": "application/json", Cookie: C }, body: JSON.stringify({ question: c.cauHoi, topK: 20 }) });
  const j = await r.json(); const cit = j.citations ?? j.data?.citations ?? [];
  const hang = cit.findIndex((x) => { const k = chunks.get(x.id); return k && c.nguon.some((n) => (x.sourcePath ?? "").endsWith(n)) && re.test(k.text); });
  console.log(c.id, "hạng đoạn đáp án:", hang < 0 ? "ngoài top-20" : hang + 1, "| top1:", cit[0]?.sourcePath?.split("/").pop(), cit[0]?.score?.toFixed?.(3));
}
