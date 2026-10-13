/**
 * doc 81 Đợt 10 task B (security-scan ruling on edgeAuthorizeCentral.ts robot-enabled check) — /authorize is FAIL-CLOSED at
 * every gate: anything but an explicit pass refuses, and nothing is written or signed. Each read is made to fail on purpose
 * (vi.mock wrappers that pass through to the real module unless a switch is set):
 *   • robot enabled: `false` ⇒ 409 device_refused {robot_disabled}; `{ error }` (unreadable / timed out) ⇒ the SAME 409; a
 *     throw ⇒ the SAME 409 (a `!== true` → `=== false` mutant must die here);
 *   • the central lock-request read throws ⇒ 503, nothing written;
 *   • the ownership read throws ⇒ 503, nothing written;
 *   • the approval identity read throws ⇒ 503, nothing written; the binding digest unreadable ⇒ 409 gate_required;
 *   • the safety-PLC config read throws ⇒ 503, nothing written (an empty list never stands for "could not read");
 *   • R-10-as — the approver-role read throws ⇒ 503; the node's command read throws ⇒ pull 503 AND progress 503 (never "none");
 *   • R-10-as N-1 — the policy contexts /authorize evaluates are central's, value for value, from central's own readers.
 * Real `_test` DB otherwise (the kit).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { setupKit, kitSteps, nonce, type Kit } from "./__edgeCentralKit.dot10";

const sw = vi.hoisted(() => ({
  enabled: "real" as "real" | "false" | "error" | "throw",
  lockReq: false,
  owners: false,
  identity: false,
  digest: false,
  safety: false,
  /** I-1 — what central's safety-PLC facade reads (real mode only); "real" = the module itself */
  plc: "real" as "real" | "OK" | "BLOCKED" | "UNKNOWN" | "SIM_ONLY" | "throw",
  plcReads: [] as Array<Record<string, unknown>>,
  /** R-10-as — the approver-role read (edgeCentralCommon.userRoleOf) throws */
  role: false,
  /** R-10-as — the node's command read (edgeNodeCommands.commandsForNode) throws */
  cmds: false,
  /** fixture isolation: the safety-PLC list is this kit's rows only (the shared _test DB carries a seeded global sim row) */
  plcOnly: "" as string,
  /** R-10-as N-1 — every evaluateActionPolicy call (passed through) */
  policyCalls: [] as Array<{ subject: string; action: string; resource: string; ctx: Record<string, unknown> }>,
}));

vi.mock("../security/policyGate", async (orig) => {
  const real = (await orig()) as typeof import("../security/policyGate");
  return {
    ...real,
    evaluateActionPolicy: (...a: Parameters<typeof real.evaluateActionPolicy>) => {
      sw.policyCalls.push({ subject: String(a[0]), action: String(a[1]), resource: String(a[2]), ctx: { ...((a[3] ?? {}) as Record<string, unknown>) } });
      return real.evaluateActionPolicy(...a);
    },
  };
});

vi.mock("../ot/adapterFacade", async (orig) => {
  const real = (await orig()) as typeof import("../ot/adapterFacade");
  return {
    ...real,
    createAdapterFacade: (ctx: Parameters<typeof real.createAdapterFacade>[0]) => {
      const f = real.createAdapterFacade(ctx);
      return {
        ...f,
        getSafetyStatus: async (o?: unknown) => {
          sw.plcReads.push({ ...(ctx as Record<string, unknown>), opts: o });
          if (sw.plc === "real") return f.getSafetyStatus(o as never);
          if (sw.plc === "throw") throw new Error("safety read crashed");
          if (sw.plc === "SIM_ONLY") return { state: "UNKNOWN", basis: "sim_only", source: "sim" } as never;
          return { state: sw.plc, source: "test" } as never;
        },
      };
    },
  };
});

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
    commandsForNode: async (...a: Parameters<typeof real.commandsForNode>) => {
      if (sw.cmds) throw new Error("command read failed");
      return real.commandsForNode(...a);
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
    ownedRobotIds: async (...a: Parameters<typeof real.ownedRobotIds>) => {
      if (sw.owners) throw new Error("ownership read failed");
      return real.ownedRobotIds(...a);
    },
    userRoleOf: async (...a: Parameters<typeof real.userRoleOf>) => {
      if (sw.role) throw new Error("role read failed");
      return real.userRoleOf(...a);
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
      const all = await real.listPlcConfigs(...a);
      return sw.plcOnly ? all.filter((c) => String(c.code).includes(sw.plcOnly)) : all;
    },
  };
});

const DB_URL = process.env.DATABASE_URL ?? "";
const onTest = /_test\b/.test(DB_URL);
let k: Kit;
let p: { runId: number; claimSeq: number; claimToken: string };
/** robot A's explicit safety-PLC configuration (real-mode attempts need one the edge can be given) */
let plcRobotA = 0;
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
    const run = await k.newRun("fc", "A", [s.gate, { ...s.robotMove, maxAttempts: 40 }]);
    const { claimForNodeV2 } = await import("./edgeExecutionCentral");
    const c = await claimForNodeV2(await k.principal("A"), run.runId, { claimSeq: 0, defHash: run.defHash, programChecks: k.readings([k.ids.adapterA]) });
    expect(c.http, JSON.stringify(c)).toBe(200);
    await k.approveGate(run.runId, run.def, k.u.approver, k.readings([k.ids.adapterA]));
    p = { runId: run.runId, claimSeq: c.data!.claimSeq, claimToken: c.data!.claimToken };
    sw.plcOnly = k.DAU;
    plcRobotA = Number(
      (await k.sql`INSERT INTO safety_plc_configs (code, name, vendor, backend, endpoint, "robotId", enabled) VALUES (${`FC-RA-${k.DAU}`}, 'fc robot A', 'generic', 'sim', 'tcp://fc', ${k.ids.robotA}, true) RETURNING id`)[0].id,
    );
  }, 120_000);
  afterAll(async () => {
    if (k && plcRobotA) await k.sql`DELETE FROM safety_plc_configs WHERE id = ${plcRobotA}`.catch(() => undefined);
    await k?.teardown();
  }, 120_000);
  beforeEach(() => {
    Object.assign(sw, { enabled: "real", lockReq: false, owners: false, identity: false, digest: false, safety: false, plc: "real", role: false, cmds: false });
    sw.policyCalls.length = 0;
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

  it("★ unreadable lock-request / ownership / identity / safety-config / approver-role reads ⇒ refused (503), nothing written or signed", async () => {
    for (const key of ["lockReq", "owners", "identity", "safety", "role"] as const) {
      Object.assign(sw, { lockReq: false, owners: false, identity: false, safety: false, role: false, [key]: true });
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

  it("★ I-1: real mode — central's safety-PLC preflight (facade, forRealActuation, robotId) must read OK: BLOCKED / UNKNOWN / SIM_ONLY / a throw ⇒ device_refused {safety}; OK ⇒ authorised", async () => {
    process.env.ROBOT_CONTROL_ENABLED = "true";
    process.env.ROBOT_COMMISSIONING_REQUIRED = "false";
    try {
      for (const mode of ["BLOCKED", "UNKNOWN", "SIM_ONLY", "throw"] as const) {
        sw.plc = mode;
        sw.plcReads.length = 0;
        const r = await robotAttempt();
        expect(r, `${mode}: ${JSON.stringify(r)}`).toMatchObject({ http: 409, code: "device_refused", data: { gate: "safety" } });
        expect(sw.plcReads[0]).toMatchObject({ adapterId: -1, robotId: k.ids.robotA, opts: { forRealActuation: true } });
      }
      expect(await rows()).toBe(0);
      sw.plc = "OK";
      const ok = await robotAttempt();
      expect(ok.http, JSON.stringify(ok)).toBe(200);
      expect(JSON.parse(ok.data!.authorization.payload).mode).toBe("real");
    } finally {
      delete process.env.ROBOT_CONTROL_ENABLED;
      delete process.env.ROBOT_COMMISSIONING_REQUIRED;
    }
  });

  it("★ F1-2 / R-10-bn: the claim-time ownership read fails ⇒ the claim is refused (503), nothing claimed; the read answering ⇒ claimed", async () => {
    const s = kitSteps(k);
    const { claimForNodeV2 } = await import("./edgeExecutionCentral");
    const run = await k.newRun("fcclaim", "A", [s.gate, s.robotStop]);
    sw.owners = true;
    const r = await claimForNodeV2(await k.principal("A"), run.runId, { claimSeq: 0, defHash: run.defHash, programChecks: k.readings([k.ids.adapterA]) });
    expect(r, JSON.stringify(r)).toMatchObject({ http: 503 });
    expect(Number((await k.sql`SELECT "claimSeq" FROM orchestration_run_edge_assignments WHERE "runId" = ${run.runId}`)[0].claimSeq)).toBe(0);
    sw.owners = false;
    expect((await claimForNodeV2(await k.principal("A"), run.runId, { claimSeq: 0, defHash: run.defHash, programChecks: k.readings([k.ids.adapterA]) })).http).toBe(200);
  });

  it("★ R-10-as (M-3): the node's command read fails ⇒ pull 503 AND progress 503 — never an empty \"no commands\" 200", async () => {
    const { pullForNodeV2, progressForNodeV2 } = await import("./edgeExecutionCentral");
    sw.cmds = true;
    const pull = await pullForNodeV2(await k.principal("A"), {});
    expect(pull, JSON.stringify(pull)).toMatchObject({ http: 503, code: "edge_unavailable" });
    const prog = await progressForNodeV2(await k.principal("A"), p.runId, { claimSeq: p.claimSeq, claimToken: p.claimToken, seq: 1 });
    expect(prog, JSON.stringify(prog)).toMatchObject({ http: 503, code: "edge_unavailable" });
    // control: the same calls answer once the read answers
    sw.cmds = false;
    expect((await pullForNodeV2(await k.principal("A"), {})).http).toBe(200);
    expect((await progressForNodeV2(await k.principal("A"), p.runId, { claimSeq: p.claimSeq, claimToken: p.claimToken, seq: 2 })).http).toBe(200);
  });

  it("★ R-10-as N-1: the policy contexts are CENTRAL's, value for value — approver's role (not the owner's), fat_passed = isRobotCommissioned even with commissioning not required, requestedBy = run owner", async () => {
    const { getUserById } = await import("../../db/auth");
    const { isRobotCommissioned } = await import("../robot/robotCommandDispatcher");
    const was = await k.sql`SELECT id, role FROM users WHERE id IN ${k.sql([k.u.owner, k.u.approver])}`;
    await k.sql`UPDATE users SET role = 'operator' WHERE id = ${k.u.owner}`;
    await k.sql`UPDATE users SET role = 'engineer' WHERE id = ${k.u.approver}`;
    process.env.SEC_PLATFORM = "true";
    process.env.ROBOT_COMMISSIONING_REQUIRED = "false"; // the old context said fat_passed: true here
    try {
      const r = await robotAttempt();
      expect(r.http, JSON.stringify(r)).toBe(200);
      // central's inputs, read by central's own readers (resolveRobotAuthzContext → getUserById(confirmer); 4a-policy → isRobotCommissioned)
      const approverRole = (await getUserById(k.u.approver))!.role;
      const fat = await isRobotCommissioned(k.ids.robotA);
      expect(approverRole).toBe("engineer");
      expect(fat).toBe(false);
      const robot = sw.policyCalls.find((c) => c.action === "robot.command.custom");
      expect(robot, JSON.stringify(sw.policyCalls)).toBeDefined();
      expect(robot!.subject).toBe(`user:${k.u.approver}`);
      expect(robot!.resource).toBe(`robot:${k.ids.robotA}`);
      expect(robot!.ctx).toEqual({ verb: "custom", argsKeys: [], robotId: k.ids.robotA, triggerKind: "hitl", role: approverRole, fat_passed: fat, mode: "simulated", requestedBy: k.u.owner, confirmedBy: k.u.approver });
      const eng = sw.policyCalls.find((c) => c.action.startsWith("foe.command."));
      expect(eng, JSON.stringify(sw.policyCalls)).toBeDefined();
      expect(eng!.subject).toBe(`foe-run:${p.runId}`);
      expect(eng!.ctx).toMatchObject({ runId: p.runId, stepId: "m1", role: approverRole, startedBy: k.u.owner, attempt });
      expect(eng!.ctx.role).not.toBe("operator"); // never the owner's role
    } finally {
      delete process.env.SEC_PLATFORM;
      delete process.env.ROBOT_COMMISSIONING_REQUIRED;
      for (const w of was) await k.sql`UPDATE users SET role = ${w.role} WHERE id = ${w.id}`;
    }
  });

  it("★ F-B2-1: the engine policy's role is central's rc.user on EACH path — the approver on the gate path, the RESUMER on a held resume after it, refused when a held resume's user is not recorded", async () => {
    const { getUserById } = await import("../../db/auth");
    const [ctxWas] = await k.sql`SELECT "contextJson" FROM orchestration_runs WHERE id = ${p.runId}`;
    const was = await k.sql`SELECT id, role FROM users WHERE id IN ${k.sql([k.u.approver, k.u.admin2])}`;
    await k.sql`UPDATE users SET role = 'engineer' WHERE id = ${k.u.approver}`;
    await k.sql`UPDATE users SET role = 'supervisor' WHERE id = ${k.u.admin2}`;
    // the approval's time as central reads it (drizzle; postgres.js reads a naive timestamp in local time — memory note)
    const { getDb } = await import("../../db/connection");
    const { orchestrationRunSteps } = await import("../../../drizzle/schema");
    const { and, eq } = await import("drizzle-orm");
    const [g] = await (await getDb())!.select({ f: orchestrationRunSteps.finishedAt }).from(orchestrationRunSteps).where(and(eq(orchestrationRunSteps.runId, p.runId), eq(orchestrationRunSteps.stepId, "g0")));
    const gateAt = new Date(g.f as Date).getTime();
    const setCtx = (extra: Record<string, unknown>) => k.sql`UPDATE orchestration_runs SET "contextJson" = ${k.sql.json({ ...((ctxWas.contextJson as Record<string, unknown>) ?? {}), ...extra } as never)} WHERE id = ${p.runId}`;
    const engineRole = () => sw.policyCalls.filter((c) => c.action.startsWith("foe.command.")).at(-1)?.ctx.role;
    process.env.SEC_PLATFORM = "true";
    try {
      // gate path: a resume record OLDER than the approval ⇒ the approver
      await setCtx({ edgeResumedBy: { userId: k.u.admin2, at: gateAt - 60_000 } });
      expect((await robotAttempt()).http).toBe(200);
      expect(engineRole()).toBe((await getUserById(k.u.approver))!.role);
      // held resume AFTER the approval ⇒ the resumer
      await setCtx({ edgeResumedBy: { userId: k.u.admin2, at: gateAt + 60_000 }, interruptedEarlier: true });
      expect((await robotAttempt()).http).toBe(200);
      expect(engineRole()).toBe((await getUserById(k.u.admin2))!.role);
      expect(engineRole()).toBe("supervisor");
      // held and continued, the resumer not recorded ⇒ refused (fail closed), nothing signed
      await setCtx({ interruptedEarlier: true });
      const before = await rows();
      const r = await robotAttempt();
      expect(r, JSON.stringify(r)).toMatchObject({ http: 409, code: "device_refused", data: { gate: "policy" } });
      expect(await rows()).toBe(before);
    } finally {
      delete process.env.SEC_PLATFORM;
      await k.sql`UPDATE orchestration_runs SET "contextJson" = ${k.sql.json((ctxWas.contextJson ?? {}) as never)} WHERE id = ${p.runId}`;
      for (const w of was) await k.sql`UPDATE users SET role = ${w.role} WHERE id = ${w.id}`;
    }
  });

  it("★ scan (fix round 2): an EMPTY safety list is never signed by default — a placement outside the node's factory / no node factory ⇒ not_owned; real mode with central guarding the robot by a config the edge cannot get ⇒ device_refused {safety}; an explicit config ⇒ listed", async () => {
    const { edgeAuthorizeSafetyConfigIds } = await import("./edgeAuthorizeCentral");
    const { centralDb } = await import("./edgeCentralCommon");
    const d = await centralDb();
    // (a) the node has no factory ⇒ not_owned (never [])
    const [nodeWas] = await k.sql`SELECT "factoryCode" FROM edge_nodes WHERE id = ${k.ids.nodeA}`;
    try {
      await k.sql`UPDATE edge_nodes SET "factoryCode" = NULL WHERE id = ${k.ids.nodeA}`;
      await expect(edgeAuthorizeSafetyConfigIds(d, k.ids.nodeA, { robotId: k.ids.robotA }, { centralPreflight: false })).rejects.toMatchObject({ answer: { code: "not_owned" } });
    } finally {
      await k.sql`UPDATE edge_nodes SET "factoryCode" = ${nodeWas.factoryCode} WHERE id = ${k.ids.nodeA}`;
    }
    // (b) the robot placed in another factory ⇒ not_owned
    const one = async (q: Promise<Array<{ id: number | string }>>) => Number((await q)[0].id);
    const f2 = await one(k.sql`INSERT INTO factories (code, name, "isActive") VALUES (${`FCF2-${k.DAU}`}, 'fc other', true) RETURNING id`);
    const w2 = await one(k.sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${f2}, ${`FCW2-${k.DAU}`}, 'fc ws2') RETURNING id`);
    const l2 = await one(k.sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${w2}, ${`FCL2-${k.DAU}`}, 'fc line2') RETURNING id`);
    const [rWas] = await k.sql`SELECT "stationId", "lineId" FROM robots WHERE id = ${k.ids.robotA}`;
    try {
      await k.sql`UPDATE robots SET "stationId" = NULL, "lineId" = ${l2} WHERE id = ${k.ids.robotA}`;
      await expect(edgeAuthorizeSafetyConfigIds(d, k.ids.nodeA, { robotId: k.ids.robotA }, { centralPreflight: false })).rejects.toMatchObject({ answer: { code: "not_owned" } });
    } finally {
      await k.sql`UPDATE robots SET "stationId" = ${rWas.stationId}, "lineId" = ${rWas.lineId} WHERE id = ${k.ids.robotA}`;
      await k.sql`DELETE FROM production_lines WHERE id = ${l2}`.catch(() => undefined);
      await k.sql`DELETE FROM workshops WHERE id = ${w2}`.catch(() => undefined);
      await k.sql`DELETE FROM factories WHERE id = ${f2}`.catch(() => undefined);
    }
    // (c) real mode: robot A's explicit row disabled, only an untargeted (no-factory) row central applies to everything ⇒ refused
    const glob = await one(k.sql`INSERT INTO safety_plc_configs (code, name, vendor, backend, endpoint, enabled) VALUES (${`FC-GL-${k.DAU}`}, 'fc global', 'generic', 'sim', 'tcp://gl', true) RETURNING id`);
    process.env.ROBOT_CONTROL_ENABLED = "true";
    process.env.ROBOT_COMMISSIONING_REQUIRED = "false";
    sw.plc = "OK";
    try {
      await k.sql`UPDATE safety_plc_configs SET enabled = false WHERE id = ${plcRobotA}`;
      const before = await rows();
      const r = await robotAttempt();
      expect(r, JSON.stringify(r)).toMatchObject({ http: 409, code: "device_refused", data: { gate: "safety" } });
      expect(await rows()).toBe(before);
      // in simulation central consults no PLC: the empty list is the truth there
      expect(await edgeAuthorizeSafetyConfigIds(d, k.ids.nodeA, { robotId: k.ids.robotA }, { centralPreflight: false })).toEqual([]);
      // robot A's explicit row back, but the global row still applies centrally ⇒ still refused (R-10-aw: never a partial list)
      await k.sql`UPDATE safety_plc_configs SET enabled = true WHERE id = ${plcRobotA}`;
      const partial = await robotAttempt();
      expect(partial, JSON.stringify(partial)).toMatchObject({ http: 409, code: "device_refused", data: { gate: "safety" } });
      expect(partial.message).toContain(`#${glob}`);
      // the global row gone ⇒ authorised, robot A's row listed
      await k.sql`UPDATE safety_plc_configs SET enabled = false WHERE id = ${glob}`;
      const ok = await robotAttempt();
      expect(ok.http, JSON.stringify(ok)).toBe(200);
      const listed = (JSON.parse(ok.data!.authorization.payload) as { safetyConfigIds: number[] }).safetyConfigIds;
      expect(listed).toContain(plcRobotA);
      expect(listed).not.toContain(glob);
    } finally {
      delete process.env.ROBOT_CONTROL_ENABLED;
      delete process.env.ROBOT_COMMISSIONING_REQUIRED;
      await k.sql`UPDATE safety_plc_configs SET enabled = true WHERE id = ${plcRobotA}`;
      await k.sql`DELETE FROM safety_plc_configs WHERE id = ${glob}`;
    }
  });

  it("★ R-10-aw (scan #80): central applies TWO configs (robot A's + robot B's on the same station), the edge would get ONE ⇒ device_refused {safety} naming the missing id — never a partial list; the second removed ⇒ authorised with the one", async () => {
    const plcB = Number(
      (await k.sql`INSERT INTO safety_plc_configs (code, name, vendor, backend, endpoint, "robotId", enabled) VALUES (${`FC-RB-${k.DAU}`}, 'fc robot B', 'generic', 'sim', 'tcp://fcb', ${k.ids.robotB}, true) RETURNING id`)[0].id,
    );
    process.env.ROBOT_CONTROL_ENABLED = "true";
    process.env.ROBOT_COMMISSIONING_REQUIRED = "false";
    sw.plc = "OK";
    try {
      const { edgeAuthorizeSafetyConfigIds } = await import("./edgeAuthorizeCentral");
      const { centralDb } = await import("./edgeCentralCommon");
      // the edge's explicit set holds robot A's row only; central's matcher applies robot B's too (same station, M7)
      expect(await edgeAuthorizeSafetyConfigIds(await centralDb(), k.ids.nodeA, { robotId: k.ids.robotA }, { centralPreflight: false })).toEqual([plcRobotA]);
      const before = await rows();
      const r = await robotAttempt();
      expect(r, JSON.stringify(r)).toMatchObject({ http: 409, code: "device_refused", data: { gate: "safety" } });
      expect(r.message).toContain(`#${plcB}`);
      expect(await rows()).toBe(before);
      await k.sql`DELETE FROM safety_plc_configs WHERE id = ${plcB}`;
      const ok = await robotAttempt();
      expect(ok.http, JSON.stringify(ok)).toBe(200);
      expect((JSON.parse(ok.data!.authorization.payload) as { safetyConfigIds: number[] }).safetyConfigIds).toEqual([plcRobotA]);
    } finally {
      delete process.env.ROBOT_CONTROL_ENABLED;
      delete process.env.ROBOT_COMMISSIONING_REQUIRED;
      await k.sql`DELETE FROM safety_plc_configs WHERE id = ${plcB}`.catch(() => undefined);
    }
  });

  it("control: with every read answering, the same attempt is authorised (the switches are the only cause above)", async () => {
    const r = await robotAttempt();
    expect(r.http, JSON.stringify(r)).toBe(200);
    expect(await rows()).toBe(7); // + the OK attempts of the I-1, N-1, F-B2-1 (×2), empty-safety-list and R-10-aw tests
  });
});
