/**
 * doc 81 Đợt 10 task B fix review 1 (rulings R-10-ai, R-10-am) — the GATE-PARITY TABLE of /authorize: every gate central's FOE
 * engine + dispatchers apply to a non-STOP command, against the gate /authorize applies to the same command. Measured on the
 * sources (each marker must exist where the row says): a central gate that loses its authorize twin, or a row whose central
 * marker no longer exists (the gate moved / was renamed), turns this RED — then the row is re-checked and re-pinned. Behaviour
 * is measured on `_test` by edgeAuthorize(.failclosed).dot10.db.test.ts (named per row).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../../..");
const src = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
const ENGINE = ["server/services/orchestration/foe/foeEngine.ts", "server/services/orchestration/foe/foeRunStore.ts"];
const OT = "server/services/ot/commandDispatcher.ts";
const ROBOT = "server/services/robot/robotCommandDispatcher.ts";
const AUTH = "server/services/edge/edgeAuthorizeCentral.ts";

interface Row {
  gate: string;
  central: Array<{ files: string[]; marker: RegExp }>;
  /** the /authorize marker, or why it is not a central decision at /authorize */
  authorize: RegExp | { na: string };
  test: string;
}

export const GATE_PARITY: Row[] = [
  { gate: "run scope (factory)", central: [{ files: ENGINE, marker: /runVisibleTo\(/ }], authorize: /runInNodeScope\(run, node\)/, test: "A3 404" },
  { gate: "run aborted / rejected", central: [{ files: ENGINE, marker: /rc\.aborting/ }], authorize: /centralStopped\(run\)/, test: "claim test (stopped)" },
  { gate: "attempt bound = engine retry budget", central: [{ files: ENGINE, marker: /\(step\.maxAttempts \?\? 0\) \+ 1/ }], authorize: /req\.attempt > maxAttempts\)/, test: "definition / step (I-5)" },
  { gate: "engine policy foe.command.<cmd> (every mode)", central: [{ files: ENGINE, marker: /`foe\.command\.\$\{step\.command\}`/ }], authorize: /`foe\.command\.\$\{step\.command\}`/, test: "I-2 policies" },
  { gate: "separate gate approval (owner / key parties excluded)", central: [{ files: ["server/services/orchestration/foe/foeGateApproval.ts"], marker: /export function evaluateWithPrograms/ }], authorize: /evaluateWithPrograms\(/, test: "gate_required" },
  { gate: "binding digest + program checksums", central: [{ files: ["server/services/orchestration/foe/foeGateApproval.ts"], marker: /export async function computeBindingDetail/ }], authorize: /computeBindingDetail\(d, def, pre\)/, test: "programUnreadable" },
  { gate: "payload binding (hash of the exact command)", central: [{ files: [OT], marker: /otPayloadHash/ }, { files: [ROBOT], marker: /robotPayloadHash/ }], authorize: /req\.payloadHash !== rb\.payloadHash/, test: "A6 swap" },
  { gate: "robot enabled (R-4-x)", central: [{ files: [ROBOT], marker: /readRobotEnabledForMotion\(/ }], authorize: /if \(enabled !== true\) return \{ gate: "robot_disabled"/, test: "failclosed robot enabled" },
  { gate: "persisted motion lock (any authority)", central: [{ files: [ROBOT], marker: /readPersistedMotionLock|persistedMotionLock/ }], authorize: /if \(lock\) return \{ gate: "motion_locked"/, test: "ownership / owner-change lock" },
  { gate: "central lock / STOP request outstanding", central: [{ files: ["server/services/robot/robotEdgeCommandPort.ts"], marker: /enqueue/ }], authorize: /lockRequestOutstanding\(d, robotId, ownerEpoch\)/, test: "device gates (lock_requested)" },
  { gate: "adapter STOP request outstanding (M-9)", central: [{ files: ["server/services/robot/robotEdgeCommandPort.ts"], marker: /adapterId/ }], authorize: /adapterStopOutstanding\(d, adapterId, ownerEpoch\)/, test: "M-9" },
  { gate: "FIELD_V2 command permission (robot)", central: [{ files: [ROBOT], marker: /authorizeCommand\(/ }], authorize: /authorizeCommand\(\{ equipmentClass: "ROBOT"/, test: "(module suite)" },
  { gate: "adapter enabled", central: [{ files: [OT], marker: /"ADAPTER_DISABLED"/ }], authorize: /gate: "adapter_disabled"/, test: "device gates" },
  { gate: "tag enabled / writable", central: [{ files: [OT], marker: /"TAG_NOT_WRITABLE"/ }], authorize: /gate: "tag_not_writable"/, test: "device gates" },
  { gate: "commissioning ⇒ simulated (OT)", central: [{ files: [OT], marker: /isCommissioned\(input\.adapterId\)/ }], authorize: /isCommissioned\(adapterId\)/, test: "mode" },
  { gate: "commissioning ⇒ simulated (robot)", central: [{ files: [ROBOT], marker: /isRobotCommissioned\(input\.robotId\)/ }], authorize: /isRobotCommissioned\(robotId\)/, test: "mode" },
  { gate: "control enabled ⇒ real (kill switch)", central: [{ files: [OT], marker: /isOtControlEnabled\(\)/ }, { files: [ROBOT], marker: /isRobotControlEnabled\(\)/ }], authorize: /isRobotControlEnabled\(\) && commissioned/, test: "mode" },
  { gate: "dispatcher policy ot.command.* (every mode, R-10-am)", central: [{ files: [OT], marker: /action: `ot\.command\.\$\{input\.commandType\}`/ }], authorize: /\{ action: `ot\.command\.\$\{rb\.commandType\}` \}/, test: "I-2 policies" },
  { gate: "dispatcher policy robot.command.* (every mode, R-10-am)", central: [{ files: [ROBOT], marker: /`robot\.command\.\$\{verb\}`/ }], authorize: /`robot\.command\.\$\{rb\.jobType\}`/, test: "I-2 policies" },
  { gate: "safety-PLC preflight OT (real)", central: [{ files: [OT], marker: /readSafetyStateForPreflight\(input\.adapterId/ }], authorize: /safetyPreflight\(\{ adapterId, machineId: rb\.machineId \}\)/, test: "I-1 (OT)" },
  { gate: "safety-PLC preflight robot (real)", central: [{ files: [ROBOT], marker: /createAdapterFacade\(\{ adapterId: ROBOT_NO_OT_ADAPTER_ID, machineId: null, robotId: input\.robotId \}\)/ }], authorize: /safetyPreflight\(\{ adapterId: ROBOT_NO_OT_ADAPTER_ID, machineId: null, robotId \}\)/, test: "failclosed I-1" },
  { gate: "interlock OT (real, fail-closed)", central: [{ files: [OT], marker: /evaluateInterlockGate\(\{/ }], authorize: /evaluateInterlockGate\(\{ adapterId, machineId: rb\.machineId/, test: "(module suite)" },
  { gate: "interlock robot (real, fail-closed)", central: [{ files: [ROBOT], marker: /evaluateInterlockGate\(robotInterlockTarget\(input\.robotId\)\)/ }], authorize: /evaluateInterlockGate\(robotInterlockTarget\(robotId\)\)/, test: "mode (interlock clear)" },
  { gate: "R-4-d adapter resolution", central: [{ files: ENGINE, marker: /withResolvedAdapter/ }], authorize: { na: "edgeRunAnalysis.resolveOtAdapterId — the same rule, used by rebuildCommand" }, test: "payload" },
  { gate: "per-robot automation-off (Đợt 7 I5)", central: [{ files: [ROBOT], marker: /readRobotAutomationState/ }], authorize: { na: "only for vda5050 / ros2 automation tools — never the FOE tool" }, test: "-" },
  { gate: "driver connected / in-memory motion lock / R14 slot / G1.9 serialize", central: [{ files: [ROBOT], marker: /getActiveRobot\(/ }], authorize: { na: "process-local device stage — the edge's (otEdgeDispatch / robotEdgeDispatch)" }, test: "D's suites" },
];

describe("doc 81 Đợt 10 B fix review 1 — /authorize gate parity with central (R-10-ai / R-10-am)", () => {
  const auth = src(AUTH);
  for (const row of GATE_PARITY) {
    it(`${row.gate}: central marker present${"na" in (row.authorize as object) ? " (N/A at authorize)" : " ⇒ authorize marker present"}`, () => {
      for (const c of row.central) {
        const found = c.files.some((f) => c.marker.test(src(f)));
        expect(found, `central marker ${c.marker} not found in ${c.files.join(" | ")} — the central gate moved; re-check this row`).toBe(true);
      }
      if (row.authorize instanceof RegExp) expect(row.authorize.test(auth), `authorize lacks ${row.authorize}`).toBe(true);
      else expect(row.authorize.na.length).toBeGreaterThan(10);
    });
  }
});

/**
 * R-10-as N-1 — the POLICY CONTEXTS: the keys central's object literals pass (robotCommandDispatcher 4a-policy, foeEngine
 * execCommand) equal the keys /authorize's builders return. The values are measured on `_test` (failclosed "N-1": approver role,
 * fat_passed = isRobotCommissioned, requestedBy = run owner, from central's own readers).
 */
function literalKeys(text: string, from: RegExp, to: RegExp): string[] {
  const i = text.search(from);
  expect(i, `${from} not found`).toBeGreaterThan(-1);
  const rest = text.slice(i);
  const j = rest.search(to);
  expect(j, `${to} not found after ${from}`).toBeGreaterThan(-1);
  const body = rest.slice(0, j);
  const keys = new Set<string>();
  for (const m of body.matchAll(/^\s*(?:\.\.\.\([^?]*\?\s*\{\s*)?([A-Za-z_][A-Za-z0-9_]*)\s*(?::|,|\s*\})/gm)) keys.add(m[1]);
  return [...keys].sort();
}

describe("doc 81 Đợt 10 B fix review 2 — policy-context parity (R-10-as N-1) and the robot dispatcher's gate list", () => {
  it("robot.command.* context: central's keys = edgeRobotPolicyContext's keys", async () => {
    const { edgeRobotPolicyContext } = await import("./edgeAuthorizeCentral");
    const central = literalKeys(src(ROBOT), /`robot\.command\.\$\{verb\}`,\n\s*`robot:\$\{input\.robotId\}`,\n\s*\{/, /\n\s*\}\s*,?\n\s*\);/);
    const edge = Object.keys(edgeRobotPolicyContext({ jobType: "x", params: {}, robotId: 1, role: "r", fatPassed: false, real: true, requestedBy: 2, confirmedBy: 3 })).sort();
    expect(edge).toEqual(central);
  });

  it("foe.command.* context: central's keys = edgeEnginePolicyContext's keys", async () => {
    const { edgeEnginePolicyContext } = await import("./edgeAuthorizeCentral");
    const central = literalKeys(src(ENGINE[0]), /`foe\.command\.\$\{step\.command\}`,\n\s*`machine:\$\{step\.machineId\}`,\n\s*\{/, /\n\s*\},\n\s*\{ requestId: idempotencyKey \}/);
    const edge = Object.keys(edgeEnginePolicyContext({ runId: 1, workflowRef: "w", step: { id: "s", type: "command", command: "c", machineId: 1 }, approverRole: "r", approvedBy: 2, runOwner: 3, attempt: 1 })).sort();
    expect(edge).toEqual(central);
  });

  it("F-B2-1: central's engine role is rc.user's (the resumer of THIS resume) — /authorize takes it from the approver (gate path) or the recorded resumer (held path)", async () => {
    const eng = src(ENGINE[0]);
    expect(eng).toMatch(/`foe\.command\.\$\{step\.command\}`[\s\S]{0,600}role: rc\.user\.role,/);
    expect(eng).toMatch(/const rc = await buildRunContext\(run, def, user\);/);
    expect(src(AUTH)).toMatch(/approverRole: await roleOf\(d, actor\.userId\)/);
    const { edgeEngineActorOf } = await import("./edgeAuthorizeCentral");
    const appr = { approvedBy: 7, at: 1_000 };
    expect(edgeEngineActorOf({}, appr)).toEqual({ userId: 7, path: "gate" });
    expect(edgeEngineActorOf({ edgeResumedBy: { userId: 9, at: 500 } }, appr)).toEqual({ userId: 7, path: "gate" });
    expect(edgeEngineActorOf({ edgeResumedBy: { userId: 9, at: 2_000 }, interruptedEarlier: true }, appr)).toEqual({ userId: 9, path: "held" });
    expect(edgeEngineActorOf({ interruptedEarlier: true }, appr)).toEqual({ unknown: true });
    expect(edgeEngineActorOf({ interruptedEarlier: true, edgeResumedBy: { userId: 0, at: 2_000 } }, appr)).toEqual({ unknown: true });
  });

  it("the robot dispatcher's numbered gates are exactly the pinned list (a NEW central gate turns this red until its /authorize twin is decided)", () => {
    const steps = [...src(ROBOT).matchAll(/^ {2}\/\/ ([0-9]+[a-zA-Z0-9-]*)\) /gm)].map((m) => m[1]);
    expect(steps).toEqual(["1", "2", "2b", "3", "4", "4a", "4a-policy", "4a-safety", "4b", "5", "5-R14"]);
  });
});
