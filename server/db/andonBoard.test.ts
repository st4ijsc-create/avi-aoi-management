/**
 * W5-C (doc 27 F7) — Andon/TV board data assembly (pure, no DB):
 *   • canonical final yield per machine/line/factory (NTF = pass, decision #4),
 *   • grouping by line with the no-line group last,
 *   • active-andon severity propagation (call > red > yellow) machine → line,
 *   • ticker enrichment (machineCode/lineName) capped at 30 while the KPI
 *     count stays the FULL active count,
 *   • FPY/UPH/open-alert passthrough into the KPI strip.
 */
import { describe, it, expect } from "vitest";
import {
  assembleAndonBoard,
  maxAndonState,
  type MachineHierarchyRow,
  type ActiveAndonRow,
} from "./andonBoard";

function machineRow(opts: {
  id: number; code: string; lineId?: number; lineName?: string; station?: string;
}): MachineHierarchyRow {
  return {
    machine: { id: opts.id, code: opts.code, name: `Machine ${opts.code}`, machineType: "AOI" },
    station: opts.station ? { name: opts.station } : null,
    line: opts.lineId != null ? { id: opts.lineId, name: opts.lineName ?? `Line ${opts.lineId}` } : null,
    workshop: { name: "WS1" },
    factory: { id: 1, name: "F1" },
  };
}

const BASE = {
  fpy: { firstPass: 90, firstTotal: 100 },
  uphLastHour: 42,
  openAlerts: 3,
  dayStart: new Date("2026-07-04T17:00:00Z"),
  timezone: "Asia/Ho_Chi_Minh",
  now: new Date("2026-07-05T02:00:00Z"),
};

describe("maxAndonState", () => {
  it("orders call > red > yellow > null and ignores green", () => {
    expect(maxAndonState(null, "yellow")).toBe("yellow");
    expect(maxAndonState("yellow", "red")).toBe("red");
    expect(maxAndonState("red", "call")).toBe("call");
    expect(maxAndonState("call", "red")).toBe("call");
    expect(maxAndonState("red", "yellow")).toBe("red");
    expect(maxAndonState(null, "green")).toBe(null);
    expect(maxAndonState(null, null)).toBe(null);
  });
});

describe("assembleAndonBoard", () => {
  it("groups machines by line, computes canonical yields and rolls totals up", () => {
    const board = assembleAndonBoard({
      ...BASE,
      machineRows: [
        machineRow({ id: 1, code: "M1", lineId: 10, lineName: "SMT-A", station: "S1" }),
        machineRow({ id: 2, code: "M2", lineId: 10, lineName: "SMT-A" }),
        machineRow({ id: 3, code: "M3" }), // no line
      ],
      counts: [
        // M1: 100 total, 90 OK, 5 NG, 5 NTF → final yield (90+5)/100 = 95%
        { machineId: 1, total: 100, ok: 90, ng: 5, ntf: 5 },
        // M2: no data today (absent) → nulls
        // M3: 10 total, 8 OK, 2 NG → 80%
        { machineId: 3, total: 10, ok: 8, ng: 2, ntf: 0 },
      ],
      activeAndons: [],
    });

    expect(board.lines).toHaveLength(2);
    const [smtA, noLine] = board.lines;
    expect(smtA.lineName).toBe("SMT-A");
    expect(smtA.machines).toHaveLength(2);
    const m1 = smtA.machines.find((m) => m.code === "M1")!;
    expect(m1.finalYield).toBe(95); // NTF counts as pass (decision #4)
    expect(m1.stationName).toBe("S1");
    const m2 = smtA.machines.find((m) => m.code === "M2")!;
    expect(m2.finalYield).toBeNull(); // honest null, not 0%
    expect(m2.total).toBe(0);

    // Line rollup = sum of its machines
    expect(smtA.total).toBe(100);
    expect(smtA.finalYield).toBe(95);

    // No-line group is LAST
    expect(noLine.lineId).toBeNull();
    expect(noLine.machines[0].finalYield).toBe(80);

    // Factory strip equals the sum of the tiles (one source of truth)
    expect(board.kpis.total).toBe(110);
    expect(board.kpis.ok).toBe(98);
    expect(board.kpis.ng).toBe(7);
    expect(board.kpis.ntf).toBe(5);
    expect(board.kpis.finalYield).toBe(93.64); // (98+5)/110
    expect(board.kpis.fpy).toBe(90); // true FPY passthrough
    expect(board.kpis.uphLastHour).toBe(42);
    expect(board.kpis.openAlerts).toBe(3);
    expect(board.timezone).toBe("Asia/Ho_Chi_Minh");
  });

  it("propagates the highest active-andon severity to tiles and lines", () => {
    const andons: ActiveAndonRow[] = [
      { id: 1, state: "yellow", reason: "material", status: "raised", title: "Thiếu liệu", machineId: 1, lineId: null, raisedAt: new Date() },
      { id: 2, state: "red", reason: "quality", status: "raised", title: "NG cao", machineId: 1, lineId: null, raisedAt: new Date() },
      { id: 3, state: "call", reason: "maintenance", status: "acknowledged", title: "Gọi bảo trì", machineId: null, lineId: 10, raisedAt: new Date() },
    ];
    const board = assembleAndonBoard({
      ...BASE,
      machineRows: [
        machineRow({ id: 1, code: "M1", lineId: 10, lineName: "SMT-A" }),
        machineRow({ id: 2, code: "M2", lineId: 20, lineName: "SMT-B" }),
      ],
      counts: [],
      activeAndons: andons,
    });

    const smtA = board.lines.find((l) => l.lineId === 10)!;
    const smtB = board.lines.find((l) => l.lineId === 20)!;
    expect(smtA.machines[0].andonState).toBe("red"); // red beats yellow on M1
    expect(smtA.andonState).toBe("call"); // line-level call beats machine red
    expect(smtB.andonState).toBeNull();
    expect(board.kpis.activeAndons).toBe(3);

    // Ticker is enriched with codes/names from the registry
    const t1 = board.andons.find((a) => a.id === 1)!;
    expect(t1.machineCode).toBe("M1");
    const t3 = board.andons.find((a) => a.id === 3)!;
    expect(t3.lineName).toBe("SMT-A");
  });

  it("caps the ticker at 30 while keeping the FULL active count in the KPI", () => {
    const andons: ActiveAndonRow[] = Array.from({ length: 45 }, (_, i) => ({
      id: i + 1, state: "red", reason: "quality", status: "raised",
      title: `A${i + 1}`, machineId: null, lineId: null, raisedAt: new Date(),
    }));
    const board = assembleAndonBoard({
      ...BASE,
      machineRows: [machineRow({ id: 1, code: "M1", lineId: 10 })],
      counts: [],
      activeAndons: andons,
    });
    expect(board.andons).toHaveLength(30);
    expect(board.kpis.activeAndons).toBe(45);
  });

  it("returns honest empty shape with no machines", () => {
    const board = assembleAndonBoard({ ...BASE, machineRows: [], counts: [], activeAndons: [] });
    expect(board.lines).toEqual([]);
    expect(board.kpis.total).toBe(0);
    expect(board.kpis.finalYield).toBeNull(); // no data → null, never fake 0/100
  });
});
