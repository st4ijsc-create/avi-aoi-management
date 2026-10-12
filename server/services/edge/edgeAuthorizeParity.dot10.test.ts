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
