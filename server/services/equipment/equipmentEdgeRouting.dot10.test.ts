/**
 * doc 81 Đợt 10 task D (design §2.14) — equipmentAdapter routing in EDGE mode (AVI_PROCESS_ROLE=edge): OT and robot commands
 * go to the edge front ends (otEdgeDispatch / robotEdgeDispatch) with the command's `edge` context — NEVER to central's DB
 * dispatchers; on central a command carrying an `edge` context is refused (an edge authorisation is never honoured there).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const H = vi.hoisted(() => ({ ot: [] as any[], robot: [] as any[], centralOt: 0, centralRobot: 0 }));
vi.mock("../ot/otEdgeDispatch", () => ({
  dispatchOtOnEdge: vi.fn(async (i: any) => {
    H.ot.push(i);
    return { ok: true, status: "acked", stop: false, jti: "j", results: [] };
  }),
}));
vi.mock("../robot/robotEdgeDispatch", () => ({
  dispatchRobotOnEdge: vi.fn(async (i: any) => {
    H.robot.push(i);
    return { ok: true, status: "done", stop: true };
  }),
}));
vi.mock("../ot/commandDispatcher", () => ({
  dispatch: vi.fn(async () => {
    H.centralOt++;
    return { ok: true, simulated: true, status: "simulated", results: [], commandLogIds: [] };
  }),
}));
vi.mock("../robot/robotCommandDispatcher", () => ({
  dispatchRobotJob: vi.fn(async () => {
    H.centralRobot++;
    return { ok: true, status: "simulated" };
  }),
}));

import { equipmentRegistry } from "./equipmentAdapter";

const AUTH = { envelope: {}, runId: 9, claimSeq: 2, stepId: "s", attempt: 1, idempotencyKey: "k", reqNonce: "n0nce_AAAAAAAAAAAAAAAAAA" };
const RUN = { runId: 9, claimSeq: 2, stepId: "s", attempt: 1 };
const saved = process.env.AVI_PROCESS_ROLE;
beforeEach(() => {
  H.ot.length = 0;
  H.robot.length = 0;
  H.centralOt = 0;
  H.centralRobot = 0;
});
afterEach(() => {
  if (saved === undefined) delete process.env.AVI_PROCESS_ROLE;
  else process.env.AVI_PROCESS_ROLE = saved;
});

describe("equipmentAdapter — edge-mode routing", () => {
  it("★ edge mode: OT → otEdgeDispatch with the authorisation + run; robot → robotEdgeDispatch (same job mapping); central dispatchers never called", async () => {
    process.env.AVI_PROCESS_ROLE = "edge";
    const ot = await equipmentRegistry.getAdapter("ot-stub").sendCommand({
      name: "set_speed", adapterId: 5, machineId: 50, writes: [{ tagKey: "speed", value: 10 }], idempotencyKey: "k", hitl: { actionId: "", requestedBy: 0 }, edge: { authorization: AUTH, run: RUN },
    });
    expect(ot).toMatchObject({ ok: true, status: "acked", routedTo: "ot-dispatcher", detail: { edge: true, jti: "j" } });
    expect(H.ot[0]).toMatchObject({ adapterId: 5, machineId: 50, commandType: "set_speed", writes: [{ tagKey: "speed", value: 10 }], authorization: AUTH, run: RUN });
    const rb = await equipmentRegistry.getAdapter("robot").sendCommand({ name: "stop", robotId: 12, idempotencyKey: "a", hitl: { actionId: "", requestedBy: 0 }, edge: { run: RUN } });
    expect(rb).toMatchObject({ ok: true, routedTo: "robot-dispatcher", detail: { edge: true, stop: true } });
    expect(H.robot[0]).toMatchObject({ robotId: 12, run: RUN, authorization: null });
    expect(H.centralOt + H.centralRobot).toBe(0);
  });

  it("★ central: a command with an `edge` context is refused, nothing dispatched; without it the central dispatchers run as before", async () => {
    delete process.env.AVI_PROCESS_ROLE;
    const ot = await equipmentRegistry.getAdapter("ot-stub").sendCommand({ name: "x", adapterId: 5, writes: [], idempotencyKey: "k", hitl: { actionId: "a", requestedBy: 1 }, edge: { authorization: AUTH } });
    expect(ot).toMatchObject({ ok: false, status: "rejected", error: "EDGE_COMMAND_ON_CENTRAL" });
    const rb = await equipmentRegistry.getAdapter("robot").sendCommand({ name: "home", robotId: 12, idempotencyKey: "k", hitl: { actionId: "a", requestedBy: 1 }, edge: {} });
    expect(rb).toMatchObject({ ok: false, error: "EDGE_COMMAND_ON_CENTRAL" });
    expect(H.centralOt + H.centralRobot + H.ot.length + H.robot.length).toBe(0);
    await equipmentRegistry.getAdapter("ot-stub").sendCommand({ name: "x", adapterId: 5, writes: [], idempotencyKey: "k", hitl: { actionId: "a", requestedBy: 1 } });
    expect(H.centralOt).toBe(1);
  });
});
