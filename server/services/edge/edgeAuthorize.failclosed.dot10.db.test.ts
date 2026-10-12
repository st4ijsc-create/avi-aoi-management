/**
 * doc 81 Đợt 10 task B (security-scan ruling on edgeAuthorizeCentral.ts robot-enabled check) — /authorize is FAIL-CLOSED at
 * every gate: anything but an explicit pass refuses, and nothing is written or signed. Each read is made to fail on purpose
 * (vi.mock wrappers that pass through to the real module unless a switch is set):
 *   • robot enabled: `false` ⇒ 409 device_refused {robot_disabled}; `{ error }` (unreadable / timed out) ⇒ the SAME 409; a
 *     throw ⇒ the SAME 409 (a `!== true` → `=== false` mutant must die here);
 *   • the central lock-request read throws ⇒ 503, nothing written;
 *   • the ownership read throws ⇒ 503, nothing written;
 *   • the approval identity read throws ⇒ 503, nothing written; the binding digest unreadable ⇒ 409 gate_required;
 *   • the safety-PLC config read throws ⇒ 503, nothing written (an empty list never stands for "could not read").
 * Real `_test` DB otherwise (the kit).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setupKit, kitSteps, nonce, type Kit } from "./__edgeCentralKit.dot10";

const sw = vi.hoisted(() => ({ enabled: "real" as "real" | "false" | "error" | "throw", lockReq: false, owners: false, identity: false, digest: false, safety: false }));

vi.mock("../robot/robotEnabledGate", async (orig) => {
  const real = (await orig()) as typeof import("../robot/robotEnabledGate");
  return {
    ...real,
    readRobotEnabledForMotion: async (id: number) => {
      if (sw.enabled === "false") return false;
      if (sw.enabled === "error") return { error: "timed out" };
      if (sw.enabled === "throw") throw new Error("enabled read crashed");
      return real.readRobotEnabledForMotion(id);
    },
  };
});
vi.mock("./edgeNodeCommands", async (orig) => {
  const real = (await orig()) as typeof import("./edgeNodeCommands");
  return {
    ...real,
    lockRequestOutstanding: async (...a: Parameters<typeof real.lockRequestOutstanding>) => {
      if (sw.lockReq) throw new Error("lock request read failed");
      return real.lockRequestOutstanding(...a);
    },
  };
});
vi.mock("./edgeCentralCommon", async (orig) => {
  const real = (await orig()) as typeof import("./edgeCentralCommon");
  return {
    ...real,
    robotOwners: async (...a: Parameters<typeof real.robotOwners>) => {
      if (sw.owners) throw new Error("ownership read failed");
      return real.robotOwners(...a);
    },
  };
});
vi.mock("../orchestration/foe/foeGateApproval", async (orig) => {
  const real = (await orig()) as typeof import("../orchestration/foe/foeGateApproval");
  return {
    ...real,
    deriveRunApprovalIdentity: async (...a: Parameters<typeof real.deriveRunApprovalIdentity>) => {
      if (sw.identity) throw new Error("identity read failed");
      return real.deriveRunApprovalIdentity(...a);
    },
    computeBindingDetail: async (...a: Parameters<typeof real.computeBindingDetail>) => (sw.digest ? { digest: null, programs: [] } : real.computeBindingDetail(...a)),
  };
});
vi.mock("../safety/plc/safetyPlcAdapter", async (orig) => {
  const real = (await orig()) as typeof import("../safety/plc/safetyPlcAdapter");
  return {
    ...real,
    listPlcConfigs: async (...a: Parameters<typeof real.listPlcConfigs>) => {
      if (sw.safety) throw new Error("safety config read failed");
      return real.listPlcConfigs(...a);
    },
  };
});

const DB_URL = process.env.DATABASE_URL ?? "";
const onTest = /_test\b/.test(DB_URL);
let k: Kit;
let p: { runId: number; claimSeq: number; claimToken: string };
const count = async (q: Promise<Array<{ n: number }>>) => Number((await q)[0].n);
let attempt = 0;

async function robotAttempt() {
  const { robotPayloadHash } = await import("../ot/otActionBinding");
  attempt += 1;
  const { authorizeForNode } = await import("./edgeAuthorizeCentral");
  return authorizeForNode(await k.principal("A"), p.runId, {
    claimSeq: p.claimSeq,
    claimToken: p.claimToken,
    stepId: "m1",
    attempt,
    idempotencyKey: `run${p.runId}-m1-a${attempt}`,
    reqNonce: nonce(),
    command: { kind: "robot", robotId: k.ids.robotA, jobType: "custom", params: {} },
    payloadHash: robotPayloadHash({ robotId: k.ids.robotA, jobType: "custom", params: {} }),
    programChecks: k.readings([k.ids.adapterA]),
  });
}
const rows = () => count(k.sql`SELECT count(*)::int AS n FROM edge_step_authorizations WHERE "runId" = ${p.runId}`);
const pending = () => count(k.sql`SELECT count(*)::int AS n FROM ai_pending_actions WHERE id LIKE ${`foe-run${p.runId}-%`}`);

describe.skipIf(!onTest)("doc 81 Đợt 10 B — /authorize is fail-closed at every gate (real _test DB, failing reads injected)", () => {
  beforeAll(async () => {
    k = await setupKit("B10FC");
    const s = kitSteps(k);
    const run = await k.newRun("fc", "A", [s.gate, { ...s.robotMove, maxAttempts: 20 }]);
    const { claimForNodeV2 } = await import("./edgeExecutionCentral");
    const c = await claimForNodeV2(await k.principal("A"), run.runId, { claimSeq: 0, defHash: run.defHash, programChecks: k.readings([k.ids.adapterA]) });
    expect(c.http, JSON.stringify(c)).toBe(200);
    await k.approveGate(run.runId, run.def, k.u.approver, k.readings([k.ids.adapterA]));
    p = { runId: run.runId, claimSeq: c.data!.claimSeq, claimToken: c.data!.claimToken };
  }, 120_000);
  afterAll(async () => {
    await k?.teardown();
  }, 120_000);
  beforeEach(() => {
    Object.assign(sw, { enabled: "real", lockReq: false, owners: false, identity: false, digest: false, safety: false });
  });

  it("★ robot enabled: false / unreadable / throwing ⇒ the SAME 409 device_refused {robot_disabled}; nothing written", async () => {
    for (const mode of ["false", "error", "throw"] as const) {
      sw.enabled = mode;
      const r = await robotAttempt();
      expect(r, `${mode}: ${JSON.stringify(r)}`).toMatchObject({ http: 409, code: "device_refused", data: { gate: "robot_disabled" } });
    }
    expect(await rows()).toBe(0);
    expect(await pending()).toBe(0);
  });

  it("★ unreadable lock-request / ownership / identity / safety-config reads ⇒ refused (503), nothing written or signed", async () => {
    for (const key of ["lockReq", "owners", "identity", "safety"] as const) {
      Object.assign(sw, { lockReq: false, owners: false, identity: false, safety: false, [key]: true });
      const r = await robotAttempt();
      expect(r, `${key}: ${JSON.stringify(r)}`).toMatchObject({ http: 503, code: "edge_unavailable" });
      expect(r).not.toHaveProperty("data.authorization");
    }
    expect(await rows()).toBe(0);
    expect(await pending()).toBe(0);
  });

  it("★ an uncomputable binding digest ⇒ 409 gate_required (never an approval against null)", async () => {
    sw.digest = true;
    const r = await robotAttempt();
    expect(r).toMatchObject({ http: 409, code: "gate_required" });
    expect(await rows()).toBe(0);
  });

  it("control: with every read answering, the same attempt is authorised (the switches are the only cause above)", async () => {
    const r = await robotAttempt();
    expect(r.http, JSON.stringify(r)).toBe(200);
    expect(await rows()).toBe(1);
  });
});
