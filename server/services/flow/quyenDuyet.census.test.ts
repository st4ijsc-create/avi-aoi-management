/**
 * H2 (audit 2026-10-21) — CENSUS: không đường duyệt nào lách quyền duyệt, và mọi chỗ BẬT / CHẠY TAY đều ghi người làm.
 * (1) trong `flow.duyet`, `kiemQuyenDuyet(` đứng TRƯỚC `traLoiCho(`;
 * (2) `traLoiCho(` chỉ được gọi từ flowRouter.ts (ngoài định nghĩa ở dongCo.ts và các tệp test) — đường duyệt thứ hai sẽ không qua cổng;
 * (3) mỗi chỗ BẬT một phiên bản (`activeVersion: input.version` + `enabled: true|input.bat`) đều có một lệnh ghi `enabledBy: ctx.user.id`;
 * (4) `chayTay` ghi `startedBy: ctx.user.id`.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SERVER = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const router = readFileSync(join(SERVER, "routers", "flowRouter.ts"), "utf8");
const bo = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

function moiTepTs(d: string, ra: string[] = []): string[] {
  for (const t of readdirSync(d)) {
    const p = join(d, t);
    if (statSync(p).isDirectory()) {
      if (t !== "node_modules") moiTepTs(p, ra);
    } else if (/\.ts$/.test(t) && !/\.test\.ts$/.test(t)) ra.push(p);
  }
  return ra;
}

describe("H2 census — quyền duyệt", () => {
  it("(1) trong flow.duyet, kiemQuyenDuyet( đứng trước traLoiCho(", () => {
    const code = bo(router);
    const i = code.indexOf("duyet: ghiProcedure");
    expect(i, "không thấy thủ tục duyet").toBeGreaterThan(0);
    const than = code.slice(i, code.indexOf("biMatTao:", i));
    const a = than.indexOf("kiemQuyenDuyet(");
    const b = than.indexOf("traLoiCho(");
    expect(a).toBeGreaterThan(-1);
    expect(b).toBeGreaterThan(a);
    expect(than).toContain("FLOW_DUYET_TU_CHOI"); // sai ⇒ có dòng kiểm toán
  });

  it("(2) traLoiCho( chỉ được gọi từ flowRouter.ts", () => {
    const tep = moiTepTs(SERVER).filter((p) => /\btraLoiCho\s*\(/.test(bo(readFileSync(p, "utf8"))));
    const ten = tep.map((p) => p.slice(SERVER.length + 1).split("\\").join("/")).sort();
    // dongCo.ts định nghĩa (và traLoiChoTx dùng nội bộ); router là NƠI DUY NHẤT gọi từ ngoài.
    expect(ten.filter((t) => t !== "services/flow/dongCo.ts")).toEqual(["routers/flowRouter.ts"]);
  });

  it("(3) mỗi chỗ BẬT một phiên bản đều ghi enabledBy; (4) chayTay ghi startedBy", () => {
    const code = bo(router);
    const bat = [...code.matchAll(/activeVersion:\s*input\.version,\s*enabled:\s*(?:true|input\.bat)/g)].length;
    const ghi = [...code.matchAll(/enabledBy:\s*ctx\.user\.id/g)].length;
    expect(bat, "không thấy chỗ bật nào — mẫu dò hỏng?").toBeGreaterThanOrEqual(2);
    expect(ghi).toBe(bat);
    expect(code).toMatch(/startedBy:\s*ctx\.user\.id/);
  });
});
