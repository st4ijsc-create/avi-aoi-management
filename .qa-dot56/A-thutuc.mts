// DOT 56 muc A — do THU TUC that. G139: thiet bi do phai KEU KHAC 0 truoc da.
import { config as dotenvConfig } from "dotenv"; dotenvConfig();
import { writeFileSync, renameSync } from "node:fs";
const { getDb } = await import("../server/db/connection.ts");
const db = await getDb();
if (!db) { console.error("!!! getDb() = null — THIET BI DO HONG, dung lai"); process.exit(2); }
const { getFactoryCommandOverview } = await import("../server/services/factoryCommandService.ts");
const lan: number[] = []; let kq: any = null;
for (let i = 0; i < 6; i++) { const t0 = performance.now(); kq = await getFactoryCommandOverview({ factoryId: 1 }); lan.push(performance.now() - t0); }
if (!kq?.machines?.length) { console.error(`!!! tra ve ${kq?.machines?.length ?? "null"} may — THIET BI DO HONG (factory 1 co 41 may)`); process.exit(3); }
const am = lan.slice(1).sort((a, b) => a - b);
const TONG4 = 3.601 + 0.385 + 0.064 + 0.252;
const ra = `=== DOT 56 muc A — THU TUC getFactoryCommandOverview({factoryId:1}) ===
luc           : ${new Date().toISOString()}
lan 1 (NGUOI) : ${lan[0].toFixed(1)} ms
5 lan AM      : ${lan.slice(1).map((x) => x.toFixed(1)).join(" · ")} ms
AM trung vi   : ${am[2].toFixed(1)} ms
may=${kq.machines.length} issue=${kq.issues.length} factory=${kq.factories.length}   (KEU KHAC 0 ⇒ thiet bi do SONG)

>>> tong 4 cau DISTINCT ON (am trung vi) = ${TONG4.toFixed(3)} ms
>>> ⇒ 4 cau DISTINCT ON = ${((TONG4 / am[2]) * 100).toFixed(1)} % thoi gian thu tuc ⇒ phan con lai ${(am[2] - TONG4).toFixed(1)} ms o CHO KHAC.
`;
writeFileSync(".qa-dot56/A-thutuc.txt.tmp", ra); renameSync(".qa-dot56/A-thutuc.txt.tmp", ".qa-dot56/A-thutuc.txt");
console.log(ra); process.exit(0);
