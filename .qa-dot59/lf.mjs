// DOT 59 — chuan hoa CRLF -> LF cho cay nguon `git archive` (G101/loi #2 cua Dot 58).
import { readdirSync, statSync, readFileSync, writeFileSync } from "node:fs";
import { join, extname } from "node:path";
const GOC = process.argv[2];
const DUOI = new Set([".ts",".tsx",".js",".jsx",".mjs",".cjs",".json",".css",".scss",".html",".htm",".md",".svg",".txt",".yml",".yaml",".sh",".sql",".env",".example",".map",".webmanifest",".xml",".csv"]);
let doi = 0, xet = 0;
function di(d) {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name);
    if (e.isDirectory()) { if (e.name === "node_modules" || e.name === ".git") continue; di(p); continue; }
    if (!e.isFile()) continue;
    const ext = extname(e.name).toLowerCase();
    if (!DUOI.has(ext) && e.name !== ".gitattributes") continue;
    xet++;
    const b = readFileSync(p);
    if (!b.includes(13)) continue;
    const s = b.toString("latin1");
    if (!s.includes("\r\n")) continue;
    writeFileSync(p, Buffer.from(s.split("\r\n").join("\n"), "latin1"));
    doi++;
  }
}
di(GOC);
console.log(JSON.stringify({ goc: GOC, xet, doi }));
