/**
 * Census: cờ biến đổi kiểu của node (v26 đã GỠ — "bad option" ⇒ ts 0/3 giả mọi lượt, 2026-10-30) chỉ được xuất hiện
 * trong `scripts/ai-eval/lib/tsChay.mjs` (nơi DUY NHẤT dò cờ + rơi về esbuild). Nơi khác gọi thẳng cờ ⇒ đỏ.
 * Quét văn bản scripts/ + server/ + shared/ (mã nguồn; bỏ node_modules, dist, reports — báo cáo đo chứa thông điệp lỗi cũ).
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const GOC = path.resolve(__dirname, "../../..");
const CO = "--experimental-" + "transform-types"; // ghép chuỗi: tệp này không tự khớp
const DUOC_PHEP = ["scripts/ai-eval/lib/tsChay.mjs"];
const DUOI = /\.(mjs|cjs|js|ts|tsx|ps1|sh)$/;
const BO = new Set(["node_modules", "dist", "reports", ".git"]);

function quet(thuMuc: string, ra: string[]) {
  for (const e of fs.readdirSync(thuMuc, { withFileTypes: true })) {
    if (BO.has(e.name)) continue;
    const p = path.join(thuMuc, e.name);
    if (e.isDirectory()) quet(p, ra);
    else if (DUOI.test(e.name) && fs.readFileSync(p, "utf8").includes(CO)) ra.push(path.relative(GOC, p).replace(/\\/g, "/"));
  }
  return ra;
}

describe("census cờ biến đổi kiểu của node", () => {
  it("chỉ lib/tsChay.mjs chứa cờ (danh sách ghim)", () => {
    const thay = ["scripts", "server", "shared"].flatMap((d) => quet(path.join(GOC, d), [])).sort();
    expect(thay).toEqual(DUOC_PHEP);
  });
});
