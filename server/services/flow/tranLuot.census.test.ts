/**
 * M5 (audit 2026-10-21) — CENSUS: mọi cửa vào TẠO LƯỢT GỐC đều đi qua trần đồng thời và xử lý việc bị từ chối.
 * (1) `taoRunTx` (đường DUY NHẤT tạo hàng ai_flow_runs) gọi `kiemTranDongThoi` trước khi chèn;
 * (2) mọi nơi gọi `batDauRun(` ngoài dongCo mà KHÔNG truyền `parentRunId` (lượt gốc) phải tự xử lý `QUA_TRAN_DONG_THOI`
 *     (chạy tay ⇒ CONFLICT · webhook ⇒ 429 · MCP ⇒ lỗi tool · lịch ⇒ bỏ mốc); nơi truyền `parentRunId` (luồng con / agent) được miễn
 *     vì đã có trần cây lượt;
 * (3) không `INSERT INTO ai_flow_runs` / `.insert(aiFlowRuns)` ngoài taoRunTx (một cửa thứ hai sẽ lách trần).
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SERVER = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const bo = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
function moiTepTs(d: string, ra: string[] = []): string[] {
  for (const t of readdirSync(d)) {
    const p = join(d, t);
    if (statSync(p).isDirectory()) {
      if (t !== "node_modules") moiTepTs(p, ra);
    } else if (/\.ts$/.test(t) && !/\.test\.ts$/.test(t) && !/^__/.test(t)) ra.push(p);
  }
  return ra;
}
const rel = (p: string) => p.slice(SERVER.length + 1).split("\\").join("/");
const tep = moiTepTs(SERVER).map((p) => ({ p: rel(p), nd: bo(readFileSync(p, "utf8")) }));

describe("M5 census — trần đồng thời ở mọi cửa tạo lượt gốc", () => {
  it("cầu chì: thấy dongCo.ts và các cửa vào (không đo trên tập rỗng)", () => {
    for (const t of ["services/flow/dongCo.ts", "routers/flowRouter.ts", "services/flow/kichHoat/webhook.ts", "services/flow/kichHoat/lich.ts", "services/flow/kichHoat/mcp.ts"]) {
      expect(tep.some((x) => x.p === t), t).toBe(true);
    }
  });

  it("(1) taoRunTx gọi kiemTranDongThoi TRƯỚC khi chèn ai_flow_runs", () => {
    const d = tep.find((x) => x.p === "services/flow/dongCo.ts")!.nd;
    const i = d.indexOf("async function taoRunTx(");
    const than = d.slice(i, d.indexOf("\n}\n", i));
    const a = than.indexOf("kiemTranDongThoi(");
    const b = than.indexOf("insert(aiFlowRuns)");
    expect(a).toBeGreaterThan(-1);
    expect(b).toBeGreaterThan(a);
  });

  it("(2) mọi cửa vào lượt GỐC xử lý QUA_TRAN_DONG_THOI; chỉ lượt con/agent (có parentRunId) được miễn", () => {
    const cuaGoc: string[] = [];
    const thieu: string[] = [];
    for (const { p, nd } of tep) {
      if (p === "services/flow/dongCo.ts") continue;
      for (const m of nd.matchAll(/\bbatDauRun\s*\(([^;]*);/g)) {
        if (/parentRunId/.test(m[1])) continue; // lượt con / agent (câu lệnh tới dấu `;` — tham số có thể chứa `{}` lồng)
        cuaGoc.push(p);
        if (!/QUA_TRAN_DONG_THOI/.test(nd)) thieu.push(p);
      }
    }
    expect([...new Set(cuaGoc)].sort(), "đổi cửa vào lượt gốc ⇒ cập nhật census này").toEqual([
      "routers/flowRouter.ts",
      "services/flow/kichHoat/lich.ts",
      "services/flow/kichHoat/mcp.ts",
      "services/flow/kichHoat/webhook.ts",
    ]);
    expect(thieu).toEqual([]);
  });

  it("(3) không có cửa thứ hai chèn ai_flow_runs ngoài taoRunTx", () => {
    const vi = tep.filter(({ p, nd }) => p !== "services/flow/dongCo.ts" && (/insert\(aiFlowRuns\)/.test(nd) || /INSERT INTO ai_flow_runs/i.test(nd))).map((x) => x.p);
    expect(vi).toEqual([]);
    const d = tep.find((x) => x.p === "services/flow/dongCo.ts")!.nd;
    expect((d.match(/insert\(aiFlowRuns\)/g) ?? []).length).toBe(1);
  });
});
