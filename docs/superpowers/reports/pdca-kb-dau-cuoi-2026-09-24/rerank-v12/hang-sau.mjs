// Vòng 12: đoạn chứa đáp án nằm ở đâu? node tmp/hang-sau.mjs <bộ.jsonl> <ids>
import fs from "node:fs";
import { ck } from "./audit-ai/cookie.mjs";
const C = ck("D:/SOURCES/avi-aoi-management/tmp/audit-ai/ck.txt");
const chunks = [...fs.readFileSync("knowledge/chunks.jsonl", "utf8").trim().split("\n").map((l) => JSON.parse(l))];
const ids = process.argv[3].split(",");
const bo = fs.readFileSync(process.argv[2], "utf8").trim().split(/\r?\n/).map((l) => JSON.parse(l)).filter((c) => ids.includes(c.id));
for (const c of bo) {
  const re = new RegExp((c.dapAnTraLoi ?? c.dapAn).regex, "i");
  const dich = chunks.filter((k) => c.nguon.some((n) => String(k.sourcePath).endsWith(n)) && re.test(k.text));
  const r = await fetch("http://127.0.0.1:3000/api/ai/local-kb/retrieve", { method: "POST", headers: { "Content-Type": "application/json", Cookie: C }, body: JSON.stringify({ question: c.cauHoi, topK: 50 }) });
  const j = await r.json(); const cit = j.citations ?? j.data?.citations ?? [];
  console.log(`\n${c.id} «${c.cauHoi}» — ${cit.length} citation; đoạn chứa đáp án: ${dich.length}`);
  for (const k of dich) { const h = cit.findIndex((x) => x.id === k.id); console.log(`   ${h < 0 ? "ngoài" : "hạng " + (h + 1)} | ${k.id} | len ${k.text.length} | ${k.title} | ${k.text.replace(/\s+/g, " ").slice(0, 90)}`); }
  console.log("   top3:", cit.slice(0, 3).map((x) => `${String(x.sourcePath).split("/").pop()}:${x.score?.toFixed(3)}`).join(" "));
}
