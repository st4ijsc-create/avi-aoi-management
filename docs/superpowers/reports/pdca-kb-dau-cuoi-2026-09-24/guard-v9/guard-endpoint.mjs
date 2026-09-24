// Bộ GIỮ LẠI truy hồi trên ENDPOINT SẢN PHẨM (/api/ai/local-kb/retrieve, topK 5): hit@5 + hạng. node tmp/guard-endpoint.mjs <nhãn>
import fs from "node:fs";
import { ck } from "./audit-ai/cookie.mjs";
const C = ck("D:/SOURCES/avi-aoi-management/tmp/audit-ai/ck.txt");
const nhan = process.argv[2] ?? "x";
fs.mkdirSync("tmp/guard", { recursive: true });
for (const f of ["rag-operational-cases", "rag-operational-approved-cases", "rag-playbook-cases", "rag-architecture-cases"]) {
  const j = JSON.parse(fs.readFileSync(`scripts/ai-eval/${f}.json`, "utf8"));
  const a = Array.isArray(j) ? j : j.cases ?? Object.values(j);
  const ra = {};
  let trung = 0;
  for (const c of a) {
    const r = await fetch("http://127.0.0.1:3000/api/ai/local-kb/retrieve", { method: "POST", headers: { "Content-Type": "application/json", Cookie: C }, body: JSON.stringify({ question: c.question, topK: 5 }) });
    const jj = await r.json(); const cit = jj.citations ?? jj.data?.citations ?? [];
    const top = cit.map((x) => String(x.sourcePath ?? ""));
    const hang = top.findIndex((p) => c.expectPaths.some((e) => p.endsWith(e.replace(/^knowledge\//, "")) || e.endsWith(p)));
    if (hang >= 0) trung++;
    ra[c.id] = { hang: hang < 0 ? null : hang + 1, top };
  }
  fs.writeFileSync(`tmp/guard/${nhan}-${f}.json`, JSON.stringify(ra, null, 1));
  console.log(`${f}: ${trung}/${a.length}`);
}
