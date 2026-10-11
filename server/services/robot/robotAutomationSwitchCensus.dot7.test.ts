/**
 * doc 81 Đợt 7 task I5 — CENSUS of the robot AUTOMATION self-grant (VDA5050 / ROS2) and its per-robot switch.
 *
 * "Every new check must cover every entry point": the switch is checked where a grant is MINTED
 * (robotAutomationAction.ensureBoundRobotAction) and where it is CONSUMED (robotCommandDispatcher.reserveRobotJob). This
 * census proves there is no third way in:
 *   §1 the automation tool names ("vda5050.automation" / "ros2.automation") appear in non-test server code ONLY in
 *      robotAutomationAction.ts (the definition) and as the `tool:` of an `ensureBoundRobotAction({ … })` call — so no
 *      code writes such a grant row itself, around the switch;
 *   §2 ensureBoundRobotAction reads the switch BEFORE it inserts the row; reserveRobotJob checks it for every automation
 *      tool BEFORE it consumes the row;
 *   §3 the instrument sees (a direct insert of an automation grant, a mint without the switch read, are flagged).
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
const TOOL = /["'`](vda5050|ros2)\.automation["'`]/g;
const DEFINITION = "server/services/robot/robotAutomationAction.ts";

/** Every occurrence of an automation tool literal in `src` that is NOT the `tool:` of an ensureBoundRobotAction call. */
export function strayToolUses(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(TOOL)) {
    const before = src.slice(Math.max(0, m.index! - 400), m.index!);
    const call = before.lastIndexOf("ensureBoundRobotAction(");
    // inside an ensureBoundRobotAction({ … }) call that has not closed yet, and written as its `tool:` property
    const ok = call >= 0 && /tool:\s*$/.test(before) && !before.slice(call).includes(");");
    if (!ok) out.push(src.slice(m.index!, m.index! + m[0].length));
  }
  return out;
}

function serverFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) {
        if (f !== "node_modules") walk(p);
      } else if (f.endsWith(".ts") && !f.endsWith(".test.ts") && !f.endsWith(".d.ts") && !f.includes(".__mut__")) {
        out.push(relative(ROOT, p).split("\\").join("/"));
      }
    }
  };
  walk(join(ROOT, "server"));
  return out;
}

describe("doc 81 Đợt 7 I5 — census: the automation self-grant has exactly two doors, both check the per-robot switch", () => {
  it("§1 automation tool names appear only in the definition and as the tool of an ensureBoundRobotAction call", () => {
    const users: string[] = [];
    const stray: string[] = [];
    for (const f of serverFiles()) {
      if (f === DEFINITION) continue;
      const src = read(f);
      if (!TOOL.test(src)) continue;
      TOOL.lastIndex = 0;
      users.push(f);
      for (const s of strayToolUses(src)) stray.push(`${f}: ${s}`);
    }
    expect(stray).toEqual([]);
    // pinned: the two automated producers (a new one ⇒ classify it here)
    expect(users.sort()).toEqual(["server/services/ros2/ros2Bridge.ts", "server/services/vda5050/vda5050Adapter.ts"]);
  });

  it("§2 the mint reads the switch before inserting; the dispatcher checks it for automation tools before consuming", () => {
    const def = read(DEFINITION);
    const body = def.slice(def.indexOf("export async function ensureBoundRobotAction"));
    const readAt = body.indexOf("readRobotAutomationState(db, opts.robotId)");
    const insertAt = body.indexOf(".insert(aiPendingActions)");
    expect(readAt).toBeGreaterThan(0);
    expect(insertAt).toBeGreaterThan(readAt);
    expect(body.slice(readAt, insertAt)).toMatch(/if \(state !== "on"\) \{[\s\S]*?return null;/);
    const disp = read("server/services/robot/robotCommandDispatcher.ts");
    const res = disp.slice(disp.indexOf("async function reserveRobotJob"));
    const check = res.indexOf("isRobotAutomationTool(pending?.tool)");
    const consume = res.indexOf('.set({ status: "executed"');
    expect(check).toBeGreaterThan(0);
    expect(consume).toBeGreaterThan(check);
    expect(res.slice(check, consume)).toMatch(/readRobotAutomationState\(tx, input\.robotId\)[\s\S]*?if \(state !== "on"\)/);
  });

  it("§3 the instrument sees: a direct insert of an automation grant / a tool literal outside the mint call is flagged", () => {
    const direct = `await db.insert(aiPendingActions).values({ id: "x", tool: "vda5050.automation", status: "confirmed" });`;
    expect(strayToolUses(direct)).toEqual(['"vda5050.automation"']);
    const viaMint = `const id = await ensureBoundRobotAction({\n  tool: "ros2.automation",\n  robotId: 1,\n});`;
    expect(strayToolUses(viaMint)).toEqual([]);
    const afterCall = `await ensureBoundRobotAction({ tool: "ros2.automation" });\nconst t = "ros2.automation";`;
    expect(strayToolUses(afterCall)).toEqual(['"ros2.automation"']);
  });
});
