// Gỡ khai báo router khỏi server/routers.ts: node scripts/pha0/_go-router.mjs ten1 ten2 ...
import fs from "node:fs";
const names = process.argv.slice(2);
const lines = fs.readFileSync("server/routers.ts", "utf8").split("\n");
const giu = lines.filter((l) => !names.some((n) => l.startsWith(`import { ${n}Router } from "./routers/${n}Router"`) || new RegExp(`^\\s*${n}: ${n}Router,`).test(l)));
fs.writeFileSync("server/routers.ts", giu.join("\n"));
console.log("gỡ", lines.length - giu.length, "dòng (kỳ vọng", names.length * 2, ")");
