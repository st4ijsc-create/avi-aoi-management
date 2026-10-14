/**
 * doc 81 Đợt 12 task N — the production SIM robot driver carries a REAL motion lock (the MotionLock every session driver uses,
 * robotDriver.ts R13), exposed through the SAME optional driver interface as MELFA / Delta / FANUC:
 * getMotionLock · clearMotionLock (compare-and-clear) · lockMotion · motionLockController. Before Đợt 12 the dot10 harnesses
 * patched one onto the prototype; an edge-owned sim robot could never be cleared (edge: `refused:no_driver`) and stayed STOP-only.
 *   • unlocked: motion runs exactly as before (simulated, detail unchanged);
 *   • locked: a MOTION job is refused before anything is "sent" (sent:false, robot_motion_locked); a STOP is never refused (L-7)
 *     and, once done, clears the lock (a confirmed STOP) — except an operator hold;
 *   • abort() is a confirmed STOP too; a STOP on a disconnected sim clears nothing;
 *   • the operator clear quotes the generation (stale ⇒ MotionLockConflictError, nothing cleared);
 *   • one lock per driver instance (the one motionLockController() returns), never shared between instances.
 */
import { describe, it, expect } from "vitest";
import { SimRobotDriver, createSimRobotDriver } from "./simRobotDriver";
import { MotionLock, MotionLockConflictError, MOTION_LOCKED_REASON_CODE, OPERATOR_MOTION_LOCK_REASON_CODE, type RobotDriver } from "../robotDriver";

const MOVE = { jobType: "move" as const, params: { x: 1 } };
const ABORT = { jobType: "abort" as const, params: {} };

async function connected(): Promise<SimRobotDriver> {
  const d = createSimRobotDriver();
  await d.connect({ endpoint: "sim://t" } as never);
  return d;
}

describe("doc 81 Đợt 12 N — SimRobotDriver motion lock (product code, the real drivers' interface)", () => {
  it("exposes the optional motion-lock interface of a session driver; starts unlocked at generation 0; one lock per instance", async () => {
    const d: RobotDriver = await connected();
    expect(typeof d.getMotionLock).toBe("function");
    expect(typeof d.clearMotionLock).toBe("function");
    expect(typeof d.lockMotion).toBe("function");
    expect(typeof d.motionLockController).toBe("function");
    expect(d.motionLockController!()).toBeInstanceOf(MotionLock);
    expect(d.motionLockController!()).toBe(d.motionLockController!());
    expect(d.getMotionLock!()).toEqual({ locked: false, generation: 0 });
    const other = await connected();
    d.lockMotion!("line_connection_closed", "x");
    expect(other.getMotionLock!().locked).toBe(false);
    expect(other.motionLockController()).not.toBe(d.motionLockController!());
  });

  it("unlocked ⇒ motion runs as before (simulated done, same detail)", async () => {
    const d = await connected();
    expect(await d.runJob(MOVE)).toEqual({ ok: true, status: "done", detail: { jobType: "move", simulated: true } });
  });

  it("locked ⇒ MOTION refused before anything is sent (robot_motion_locked, sent:false); the lock stays", async () => {
    const d = await connected();
    d.lockMotion("rmi_reply_timeout", "outcome unknown");
    const r = await d.runJob(MOVE);
    expect(r).toMatchObject({ ok: false, status: "failed", detail: { jobType: "move", reasonCode: MOTION_LOCKED_REASON_CODE, sent: false } });
    expect(d.getMotionLock()).toMatchObject({ locked: true, reasonCode: "rmi_reply_timeout", generation: 1 });
  });

  it("locked ⇒ a STOP (any spelling) is never refused, and a DONE STOP clears the lock (confirmed STOP)", async () => {
    for (const jobType of ["abort", "stop", "e_stop", "ABORT"]) {
      const d = await connected();
      d.lockMotion("line_connection_closed");
      const r = await d.runJob({ jobType: jobType as never, params: {} });
      expect(r.ok, jobType).toBe(true);
      expect(d.getMotionLock(), jobType).toMatchObject({ locked: false, clearedBy: "stop_confirmed", generation: 1 });
      expect((await d.runJob(MOVE)).ok, jobType).toBe(true);
    }
  });

  it("abort() is a confirmed STOP too; an operator HOLD survives any STOP (only the audited clear removes it)", async () => {
    const d = await connected();
    d.lockMotion("line_connection_closed");
    await d.abort();
    expect(d.getMotionLock()).toMatchObject({ locked: false, clearedBy: "stop_confirmed" });
    d.lockMotion(OPERATOR_MOTION_LOCK_REASON_CODE, "held by the console");
    await d.abort();
    expect((await d.runJob(ABORT)).ok).toBe(true);
    expect(d.getMotionLock()).toMatchObject({ locked: true, operatorHold: true });
    expect((await d.runJob(MOVE)).ok).toBe(false);
  });

  it("a STOP on a DISCONNECTED sim is not confirmed ⇒ the lock stays", async () => {
    const d = await connected();
    d.lockMotion("line_connection_closed");
    await d.disconnect();
    const r = await d.runJob(ABORT);
    expect(r.ok).toBe(false);
    await d.abort();
    expect(d.getMotionLock().locked).toBe(true);
  });

  it("operator compare-and-clear: a stale generation throws MotionLockConflictError (nothing cleared); the current one clears", async () => {
    const d = await connected();
    d.lockMotion("line_connection_closed");
    d.clearMotionLock({ reason: "checked", userId: 1, expectedGeneration: 1 });
    d.lockMotion("line_connection_closed");
    expect(() => d.clearMotionLock({ reason: "checked", userId: 1, expectedGeneration: 1 })).toThrow(MotionLockConflictError);
    expect(d.getMotionLock()).toMatchObject({ locked: true, generation: 2 });
    expect(d.clearMotionLock({ reason: "checked again", userId: 7, expectedGeneration: 2 })).toMatchObject({ locked: false, clearedBy: "operator", clearedByUserId: 7, generation: 2 });
    expect((await d.runJob(MOVE)).ok).toBe(true);
  });

  it("a lock RESTORED into the controller (robotManager / the edge seed) refuses motion through the driver as well", async () => {
    const d = await connected();
    d.motionLockController().restore({ reasonCode: "ownerChanged", since: new Date().toISOString(), generation: 5 });
    expect(d.getMotionLock()).toMatchObject({ locked: true, reasonCode: "ownerChanged", generation: 5 });
    expect((await d.runJob(MOVE)).ok).toBe(false);
    d.clearMotionLock({ reason: "cell checked", userId: 3, expectedGeneration: 5 });
    expect((await d.runJob(MOVE)).ok).toBe(true);
  });
});
