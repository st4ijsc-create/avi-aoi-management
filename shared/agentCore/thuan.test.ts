/**
 * Bất biến THUẦN của shared/agentCore: mã lõi (không tính *.test.ts) chạy được ở server, extension host VSCode và
 * trình duyệt ⇒ không import server/, client/, vscode, node:*, không đọc env/đĩa/mạng/đồng hồ thật ngoài mặc định tiêm.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const THU_MUC = import.meta.dirname;
const tepLoi = readdirSync(THU_MUC).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));

describe("agentCore thuần", () => {
  it("có đủ 6 tệp lõi", () => {
    expect(tepLoi.sort()).toEqual(["congCu.ts", "index.ts", "kieu.ts", "loiNhac.ts", "nguCanh.ts", "vongAgent.ts"]);
  });

  for (const tep of tepLoi) {
    it(`${tep}: chỉ import tương đối trong thư mục, không env/đĩa/mạng`, () => {
      const ma = readFileSync(join(THU_MUC, tep), "utf8");
      const nguon = [...ma.matchAll(/(?:import|export)[^;]*?from\s+["']([^"']+)["']/g)].map((m) => m[1]);
      for (const n of nguon) expect(n, `${tep} import ${n}`).toMatch(/^\.\/[A-Za-z]+$/);
      expect(ma).not.toMatch(/\brequire\(/);
      expect(ma).not.toMatch(/\bimport\(/);
      expect(ma).not.toMatch(/process\.env/);
      expect(ma).not.toMatch(/\bfetch\(/);
    });
  }
});
