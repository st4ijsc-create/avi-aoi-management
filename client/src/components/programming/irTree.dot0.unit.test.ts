/**
 * Doc 80 Đợt 0 — Task 5 (Phụ lục C §3 IR-05 + IR-03 default). THUẦN, không React.
 *
 *   • IR-05 — a `next` edge drawn A→C on siblings [A,B,C] means "C runs right after A" ⇒
 *     [A,C,B]. The audit measured [B,C,A] (the edge source was moved after the target).
 *   • IR-03 — a new move_linear block defaults to 500 mm/s² (⇒ URScript a=0.5 m/s²).
 */
import { describe, it, expect } from "vitest";
import { applyNextEdge, newBlock, type IrBlock } from "./irTree";

const w = (id: string): IrBlock => ({ id, type: "wait", ms: 10 });
const ids = (bs: IrBlock[]) => bs.map((b) => b.id);

describe("IR-05 — applyNextEdge (graph `next` edge → AST order)", () => {
  it("A→C on [A,B,C] gives [A,C,B]", () => {
    expect(ids(applyNextEdge([w("A"), w("B"), w("C")], "A", "C"))).toEqual(["A", "C", "B"]);
  });

  it("C→A on [A,B,C] gives [B,C,A] (target placed right after source)", () => {
    expect(ids(applyNextEdge([w("A"), w("B"), w("C")], "C", "A"))).toEqual(["B", "C", "A"]);
  });

  it("A→B on [A,B,C] is already in order (no change)", () => {
    expect(ids(applyNextEdge([w("A"), w("B"), w("C")], "A", "B"))).toEqual(["A", "B", "C"]);
  });

  it("works inside a nested slot (loop body) and leaves other lists alone", () => {
    const flow: IrBlock[] = [
      w("X"),
      { id: "L", type: "loop", count: 2, body: [w("A"), w("B"), w("C")] },
    ];
    const out = applyNextEdge(flow, "A", "C");
    expect(ids(out)).toEqual(["X", "L"]);
    const loop = out[1] as Extract<IrBlock, { type: "loop" }>;
    expect(ids(loop.body)).toEqual(["A", "C", "B"]);
  });

  it("no-op across different lists (not siblings)", () => {
    const flow: IrBlock[] = [w("A"), { id: "L", type: "loop", count: 2, body: [w("C")] }];
    expect(applyNextEdge(flow, "A", "C")).toEqual(flow);
  });
});

describe("IR-03 — new move_linear default acceleration", () => {
  it("defaults to 500 mm/s² (URScript a=0.5 m/s²)", () => {
    const b = newBlock("move_linear");
    expect(b.type).toBe("move_linear");
    if (b.type === "move_linear") expect(b.acceleration).toBe(500);
  });
});
