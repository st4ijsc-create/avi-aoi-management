/**
 * SCADA R1b-2b-2a A2(i)(1) (g) — `tapMayChoInterlock` (pure: union, de-dup, nulls dropped) and a source scan that BOTH OT interlock call sites
 * (central dispatcher 5a-interlock, edge authorization otGates) pass THIS helper's set — fed the adapter's machine from the row each already read —
 * and that neither still passes the caller's single `machineId` to `evaluateInterlockGate`. Behaviour is measured on `_test` by
 * server/services/ot/interlockMayAdapter.a2i1.db.test.ts (a)–(f).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { tapMayChoInterlock } from "./tapMayChoInterlock";

const ROOT = path.resolve(__dirname, "../../..");
const src = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
const OT = "server/services/ot/commandDispatcher.ts";
const AUTH = "server/services/edge/edgeAuthorizeCentral.ts";

describe("A2(i)(1) (g) — tapMayChoInterlock (pure)", () => {
  it("union: the adapter's machine first, then the caller's", () => {
    expect(tapMayChoInterlock(3, 12)).toEqual([3, 12]);
    expect(tapMayChoInterlock(12, 3)).toEqual([12, 3]);
  });
  it("de-duplicated: the same machine once", () => {
    expect(tapMayChoInterlock(5, 5)).toEqual([5]);
  });
  it("nulls dropped: adapter on no machine ⇒ the caller's only; caller without a machine ⇒ the adapter's only; neither ⇒ []", () => {
    expect(tapMayChoInterlock(null, 5)).toEqual([5]);
    expect(tapMayChoInterlock(undefined, 5)).toEqual([5]);
    expect(tapMayChoInterlock(9, null)).toEqual([9]);
    expect(tapMayChoInterlock(9, undefined)).toEqual([9]);
    expect(tapMayChoInterlock(null, null)).toEqual([]);
    expect(tapMayChoInterlock(undefined, undefined)).toEqual([]);
  });
  it("0 is a value, not a null (no truthiness test); NaN is dropped", () => {
    expect(tapMayChoInterlock(0, 4)).toEqual([0, 4]);
    expect(tapMayChoInterlock(Number.NaN, 4)).toEqual([4]);
  });
});

/** The argument object of every `evaluateInterlockGate({ ... })` call in `text` (balanced braces). */
function gateCalls(text: string): string[] {
  const out: string[] = [];
  const re = /evaluateInterlockGate\(\{/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    let depth = 0;
    let i = m.index + "evaluateInterlockGate(".length;
    const start = i;
    for (; i < text.length; i++) {
      if (text[i] === "{") depth++;
      else if (text[i] === "}" && --depth === 0) break;
    }
    out.push(text.slice(start, i + 1));
  }
  return out;
}

describe("A2(i)(1) (g) — both OT interlock call sites use the ONE helper", () => {
  it("central dispatcher: the single OT gate call passes machineIds: tapMayChoInterlock(adapter.machineId, input.machineId) — the step-3 row, no second read", () => {
    const text = src(OT);
    const calls = gateCalls(text);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatch(/machineIds: tapMayChoInterlock\(adapter\.machineId, input\.machineId\)/);
    expect(calls[0]).not.toMatch(/\bmachineId:/);
    expect(text).toMatch(/import \{ tapMayChoInterlock \} from "\.\.\/interlock\/tapMayChoInterlock";/);
    // `adapter` at the gate is the step-3 device_adapters row (whole row ⇒ carries "machineId")
    expect(text).toMatch(/const \[adapter\] = await db\.select\(\)\.from\(deviceAdapters\)\.where\(eq\(deviceAdapters\.id, input\.adapterId\)\)\.limit\(1\);/);
  });

  it("edge authorization: the OT gate call passes machineIds: tapMayChoInterlock(adapter.machineId, rb.machineId), from the ONE adapter read that selects machineId", () => {
    const text = src(AUTH);
    const calls = gateCalls(text);
    expect(calls).toHaveLength(1); // the robot interlock goes through danhGiaInterlockRobot(tapMayChoRobot(…)) — A2(l), no gate call here
    expect(calls[0]).toMatch(/machineIds: tapMayChoInterlock\(adapter\.machineId, rb\.machineId\)/);
    expect(calls[0]).not.toMatch(/\bmachineId:/);
    expect(text).toMatch(/import \{ tapMayChoInterlock \} from "\.\.\/interlock\/tapMayChoInterlock";/);
    expect(text).toMatch(/const \[adapter\] = await d\.select\(\{ isEnabled: deviceAdapters\.isEnabled, machineId: deviceAdapters\.machineId \}\)\.from\(deviceAdapters\)/);
    expect(text).toMatch(/danhGiaInterlockRobot\(await tapMayChoRobot\(d, robotId\)\)/); // A2(l) — the robot's place, never machineId = robotId
  });

  it("no other production file builds an OT interlock target from a single machineId (the robot gate uses tapMayChoRobot — A2(l))", () => {
    for (const rel of [OT, AUTH]) expect(src(rel)).not.toMatch(/evaluateInterlockGate\(\{[^}]*\bmachineId:/);
  });
});

/** The text of a top-level function `name` of `text`: from its declaration to the next top-level declaration. */
function fnBody(text: string, decl: RegExp): string {
  const i = text.search(decl);
  expect(i, `${decl} not found`).toBeGreaterThan(-1);
  const rest = text.slice(i + 1);
  const j = rest.search(/\n(?:export )?(?:async )?function |\nclass |\nexport const |\nconst /);
  return text.slice(i, j === -1 ? undefined : i + 1 + j);
}

describe("A2(i)(1) (dieu-phoi add-on 3) — the FULL edge authorize path reaches the interlock through otGates with the tapMayChoInterlock set", () => {
  const text = src(AUTH);
  const authorize = fnBody(text, /\nexport async function authorizeForNode\(/);
  const gates = fnBody(text, /\nexport async function otGates\(/);

  it("authorizeForNode: the rebuilt command `rb` (central's own rebuild, never the body) is passed UNCHANGED to otGates — the only OT device-gate path", () => {
    expect(authorize).toMatch(/\n\s*const rb = await rebuildCommand\(d, step, machineMap, idemKey\);/);
    const calls = [...authorize.matchAll(/\botGates\(([^)]*)\)/g)].map((m) => m[1]);
    expect(calls).toEqual(["d, node.nodeId, rb, owner.ownerEpoch"]);
    expect(authorize).toMatch(/: await otGates\(d, node\.nodeId, rb, owner\.ownerEpoch\);/);
    // nothing in the authorize path evaluates an OT interlock itself, re-points rb, or rewrites its machine
    expect(authorize).not.toMatch(/evaluateInterlockGate/);
    expect(authorize.match(/[^.\w]rb\s*=(?!=)/g), "rb is assigned once (const rb = await rebuildCommand…)").toHaveLength(1);
    expect(authorize).not.toMatch(/\.\.\.rb\b|rb\.machineId\s*=/);
    // the device gates' verdict is what decides: a refusal returns before anything is signed
    expect(authorize).toMatch(/if \("gate" in g\) return edgeError\("device_refused", [^\n]*\{ gate: g\.gate \}\);/);
    expect(authorize.indexOf('if ("gate" in g)')).toBeLessThan(authorize.indexOf("insertOrReplay("));
  });

  it("otGates: the interlock gets tapMayChoInterlock(adapter.machineId, rb.machineId) — `adapter` is otGates' own device_adapters read (never reassigned), `rb` its parameter", () => {
    expect(gates).toMatch(/^\nexport async function otGates\(d: Db, nodeId: number, rb: Extract<RebuiltCommand, \{ kind: "ot" \}>, ownerEpoch: number\)/);
    expect(gates).toMatch(/const \[adapter\] = await d\.select\(\{ isEnabled: deviceAdapters\.isEnabled, machineId: deviceAdapters\.machineId \}\)\.from\(deviceAdapters\)\.where\(eq\(deviceAdapters\.id, adapterId\)\)\.limit\(1\);/);
    expect(gates).toMatch(/const adapterId = rb\.adapterId as number;/);
    expect(gates).not.toMatch(/[^.\w]adapter\s*=(?!=)/);
    const g = gateCalls(gates);
    expect(g).toHaveLength(1);
    expect(g[0]).toBe("{ adapterId, machineIds: tapMayChoInterlock(adapter.machineId, rb.machineId), tagKeys: rb.writes.map((w) => w.tagKey) }");
    expect(gates).toMatch(/if \(g\.blocked\) return \{ gate: "interlock"/);
  });

  it("add-on 2 — a PINNED STOP never depends on otGates' adapter read: step 5 answers stop_needs_no_authorization BEFORE the device gates run", () => {
    const pinned = authorize.indexOf('is a pinned STOP — send it; a STOP needs no authorisation.');
    const devGates = authorize.indexOf("await otGates(");
    expect(pinned).toBeGreaterThan(-1);
    expect(devGates).toBeGreaterThan(pinned);
    // the pin read itself is caught (a failure ⇒ pins null ⇒ not proven pinned ⇒ an ordinary write, the pre-A2(i)(1) rule) — not touched here
    expect(authorize).toMatch(/pins = \(await stopPinsOf\(d, \[rb\.adapterId as number\]\)\)\.get\(rb\.adapterId as number\) \?\? \[\];\n\s*\} catch \{\n\s*pins = null;/);
  });
});
