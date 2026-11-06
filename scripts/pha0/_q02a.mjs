import fs from "node:fs";
const p = "server/services/dataComparisonService.ts";
let s = fs.readFileSync(p, "utf8");
const sua = (a, b) => { if (!s.includes(a)) throw new Error("khong thay: " + a.slice(0, 70)); s = s.replace(a, b); };
sua('import { finalYield } from "../utils/kpi";', 'import { finalYield, finalYieldPctSql } from "../utils/kpi";');
sua(`      CASE WHEN COUNT(*) > 0 THEN
        ROUND(SUM(CASE WHEN product_inspections."overallResult" = 'OK' THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 1)
      ELSE 0 END as "yieldRate"`,
`      COALESCE(${finalYieldPctSql(sql.raw('product_inspections."overallResult"'), { digits: 1 })}, 0) as "yieldRate"`);
fs.writeFileSync(p, s);
