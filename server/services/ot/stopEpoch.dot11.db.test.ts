/**
 * doc 81 Đợt 11 K-fix (ruling R-11-d) — the PRE-QUEUE race of Group K (D-2), made DETERMINISTIC on `_test`:
 * a non-STOP write is held INSIDE its gates (the interlock gate of THAT command is a test-held promise) while a STOP for the same
 * adapter is dispatched and completes; then the write is released. Before the fix it reached the device AFTER the STOP (the
 * device ended re-energised); now it is cancelled right before its device write: reason STOPPED_BEFORE_WRITE, nothing written,
 * the intent's RESULT row says so. Flag OT_CMD_SERIALIZE_ENABLED OFF and ON, pinned and unpinned STOP.
 * Negative control: a write whose gates begin AFTER the STOP is the operator's newer intent and is written.
 *
 * REAL dispatch() + DB (adapter / tags / pin / HITL action / command_log rows). Fake OT driver = an in-memory device that logs
 * every writeTags batch (the oracle). Only seams: otManager (driver + connection fingerprint) and the interlock gate (hold).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import postgres from "postgres";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

const H = vi.hoisted(() => ({
  drivers: new Map<number, unknown>(),
  fps: new Map<number, string>(),
  /** the NEXT interlock-gate call for this adapter + tag waits on `release`; `entered` resolves when it is held */
  hold: null as null | { adapterId: number; tagKey: string; entered: () => void; release: Promise<void> },
}));

vi.mock("./otManager", async (importOriginal) => {
  const orig = await importOriginal<typeof import("./otManager")>();
  return {
    ...orig,
    getActiveDriver: (id: number) => (H.drivers.has(id) ? H.drivers.get(id) : orig.getActiveDriver(id)) as ReturnType<typeof orig.getActiveDriver>,
    getActiveConnectionFingerprint: (id: number) => (H.fps.has(id) ? H.fps.get(id) : orig.getActiveConnectionFingerprint(id)),
  };
});
vi.mock("../interlock/interlockGate", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../interlock/interlockGate")>();
  return {
    ...orig,
    evaluateInterlockGate: async (a: Parameters<typeof orig.evaluateInterlockGate>[0]) => {
      const h = H.hold;
      if (h && h.adapterId === a.adapterId && a.tagKeys.includes(h.tagKey)) {
        H.hold = null;
        h.entered();
        await h.release;
      }
      return orig.evaluateInterlockGate(a);
    },
  };
});

import { getDb } from "../../db/connection";
import { aiPendingActions, deviceAdapters, deviceTags } from "../../../drizzle/schema";
import { eq } from "drizzle-orm";
import { dispatch, type DispatchInput, _resetAdapterCommandQueuesForTests, _adapterCommandQueueDepthForTests } from "./commandDispatcher";
import { otPayloadHash, withOtPayloadHash } from "./otActionBinding";
import { adapterTargetFingerprint } from "./adapterTarget";

const DB_URL = process.env.DATABASE_URL;
const DAU = `D11KF-${Date.now()}`;
const OWNER = 990_911_201;
const MACHINE = 990_911_210;
const TAG_W = "w1"; // unpinned
const TAG_STOP = "speed_sp"; // pinned stop value 0
const TOOL = "set_machine_param";
const ENV = ["OT_CONTROL_ENABLED", "OT_COMMISSIONING_REQUIRED", "OT_SAFETY_PREFLIGHT_ENABLED", "OT_READBACK_ENABLED", "OT_CMD_SERIALIZE_ENABLED", "SEC_PLATFORM", "UNS_CMD_ACK_ENABLED"] as const;
const saved: Record<string, string | undefined> = {};

let sql: ReturnType<typeof postgres>;
let adapterId = 0;
const device = { regs: new Map<string, unknown>(), log: [] as string[], hold: null as null | Promise<void> };
let seq = 0;

async function d() {
  const x = await getDb();
  if (!x) throw new Error("no db");
  return x;
}
async function prep(commandType: string, writes: Array<{ tagKey: string; value: unknown }>): Promise<DispatchInput> {
  const id = `${DAU}-a-${++seq}`;
  await (await d()).insert(aiPendingActions).values({
    id,
    tool: TOOL,
    argsJson: {},
    userId: OWNER,
    userRole: "engineer",
    summary: `${DAU} stop epoch`,
    previewJson: withOtPayloadHash({ entityType: "machine" }, otPayloadHash({ tool: TOOL, adapterId, machineId: MACHINE, commandType, writes })),
    status: "confirmed",
    idempotencyKey: `${id}-idem`,
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  return { adapterId, machineId: MACHINE, commandType, writes, triggeredBy: { kind: "hitl", actionId: id, tool: TOOL, confirmedBy: OWNER, requestedBy: OWNER }, idempotencyKey: `${DAU}-k-${++seq}` };
}
function holdGatesOf(tagKey: string): { entered: Promise<void>; release: () => void } {
  let entered!: () => void;
  let release!: () => void;
  const e = new Promise<void>((r) => (entered = r));
  const rel = new Promise<void>((r) => (release = r));
  H.hold = { adapterId, tagKey, entered, release: rel };
  return { entered: e, release };
}
function setEnv(flag: boolean) {
  process.env.OT_CONTROL_ENABLED = "true";
  process.env.OT_COMMISSIONING_REQUIRED = "false";
  process.env.OT_SAFETY_PREFLIGHT_ENABLED = "false";
  process.env.OT_READBACK_ENABLED = "false";
  process.env.OT_CMD_SERIALIZE_ENABLED = flag ? "true" : "false";
  delete process.env.SEC_PLATFORM;
  delete process.env.UNS_CMD_ACK_ENABLED;
}

describe.skipIf(!DB_URL)("Đợt 11 K-fix R-11-d — a STOP cancels a write still in its gates (_test)", () => {
  beforeAll(async () => {
    expect(DB_URL).toMatch(/_test/);
    for (const k of ENV) saved[k] = process.env[k];
    sql = postgres(DB_URL!, { max: 2, connect_timeout: 30, onnotice: () => {} });
    const x = await d();
    const [row] = await x.insert(deviceAdapters).values({ code: `${DAU}-A`, name: `${DAU} A`, protocol: "modbus", endpoint: "tcp://127.0.0.1:1", isEnabled: true, machineId: MACHINE }).returning();
    adapterId = row!.id;
    await x.insert(deviceTags).values([
      { adapterId, tagKey: TAG_W, address: "holding:40001", dataType: "int", writable: true },
      { adapterId, tagKey: TAG_STOP, address: "holding:40020", dataType: "int", writable: true },
    ]);
    await sql`UPDATE device_tags SET stop_value = ${sql.json(0)}, stop_pinned_by = ${String(OWNER)}, stop_pinned_at = now() WHERE "adapterId" = ${adapterId} AND "tagKey" = ${TAG_STOP}`;
    H.drivers.set(adapterId, {
      isConnected: () => true,
      writeTags: async (w: Array<{ tagKey: string; value: unknown }>) => {
        for (const x of w) device.log.push(`${x.tagKey}=${String(x.value)}`);
        const hold = device.hold;
        device.hold = null;
        if (hold) await hold; // the write is ON THE WIRE (in flight) until the test releases it
        for (const x of w) device.regs.set(x.tagKey, x.value);
        return w.map((x) => ({ tagKey: x.tagKey, ok: true }));
      },
      readTags: async () => [],
    });
    const [fresh] = await x.select().from(deviceAdapters).where(eq(deviceAdapters.id, adapterId));
    H.fps.set(adapterId, adapterTargetFingerprint(fresh!));
  });

  afterAll(async () => {
    H.drivers.clear();
    H.fps.clear();
    if (sql) {
      await sql`DELETE FROM ai_pending_actions WHERE id LIKE ${DAU + "%"}`;
      await sql`DELETE FROM device_tags WHERE "adapterId" = ${adapterId}`;
      await sql`DELETE FROM device_adapters WHERE id = ${adapterId}`.catch(() => undefined); // command_log rows (WORM) may pin it
      await sql.end();
    }
    for (const k of ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  beforeEach(() => {
    _resetAdapterCommandQueuesForTests();
    device.regs.clear();
    device.log.length = 0;
    device.hold = null;
    H.hold = null;
  });

  it("[flag ON] K-fix 2 (R-11-i b): a write whose gates began before the STOP was SENT is cancelled even if it was issued after the STOP (the STOP waited behind the in-flight write)", async () => {
    setEnv(true);
    const w1 = await prep("set", [{ tagKey: TAG_W, value: 1 }]);
    const stop = await prep("stop", [{ tagKey: TAG_STOP, value: 0 }]);
    const w3 = await prep("set", [{ tagKey: TAG_STOP, value: 5 }]);
    let release!: () => void;
    device.hold = new Promise<void>((r) => (release = r));
    const p1 = dispatch(w1);
    const t0 = Date.now();
    while (!device.log.includes(`${TAG_W}=1`) && Date.now() - t0 < 10_000) await new Promise((r) => setTimeout(r, 5));
    const pS = dispatch(stop);
    while (_adapterCommandQueueDepthForTests(adapterId) < 2 && Date.now() - t0 < 10_000) await new Promise((r) => setTimeout(r, 5));
    const p3 = dispatch(w3); // issued after the STOP, but BEFORE the STOP is sent (it waits behind w1)
    while (_adapterCommandQueueDepthForTests(adapterId) < 3 && Date.now() - t0 < 10_000) await new Promise((r) => setTimeout(r, 5));
    expect(_adapterCommandQueueDepthForTests(adapterId)).toBe(3);
    release();
    const [r1, rS, r3] = await Promise.all([p1, pS, p3]);
    expect(r1.ok).toBe(true);
    expect(rS).toMatchObject({ ok: true, pinnedStop: true });
    expect(r3).toMatchObject({ ok: false, reason: "STOPPED_BEFORE_WRITE" });
    expect(device.log).toEqual([`${TAG_W}=1`, `${TAG_STOP}=0`]);
  });

  for (const flag of [false, true]) {
    for (const kind of ["pinned", "content"] as const) {
      const F = `flag ${flag ? "ON" : "OFF"}, ${kind === "pinned" ? "pinned STOP" : "CONTENT stop (a 'set' writing the pinned value)"}`;
      it(`[${F}] a write held in its gates while the STOP is sent is cancelled before its device write (STOPPED_BEFORE_WRITE, ledgered)`, async () => {
        setEnv(flag);
        const write = await prep("set", [{ tagKey: TAG_STOP, value: 77 }]);
        const stop = kind === "pinned" ? await prep("stop", [{ tagKey: TAG_STOP, value: 0 }]) : await prep("set", [{ tagKey: TAG_STOP, value: 0 }]);
        const h = holdGatesOf(TAG_STOP);
        const pWrite = dispatch(write); // gates begin now; held inside the interlock gate
        await h.entered;
        const rStop = await dispatch(stop); // sent while the write is held
        expect(rStop.ok).toBe(true);
        expect(rStop.pinnedStop === true).toBe(kind === "pinned");
        h.release();
        const rWrite = await pWrite;

        expect(rWrite).toMatchObject({ ok: false, status: "rejected", reason: "STOPPED_BEFORE_WRITE" });
        expect(rWrite.appError?.appCode).toBe("OT_COMMAND_SUPERSEDED_BY_STOP");
        expect(device.log).not.toContain(`${TAG_STOP}=77`); // L-7: nothing of the cancelled write reached the device
        expect(device.regs.get(TAG_STOP)).toBe(0);
        // ledger: the intent row + its RESULT row (rejected, names the STOP)
        expect(rWrite.commandLogIds.length).toBeGreaterThan(0);
        const rows = await sql<{ status: string; errorText: string | null; ackValue: Record<string, unknown> | null }[]>`
          SELECT status, "errorText", "ackValue" FROM command_log WHERE id IN ${sql(rWrite.commandLogIds)} ORDER BY id`;
        const result = rows.find((r) => r.status === "rejected");
        expect(result?.errorText).toMatch(/^STOPPED_BEFORE_WRITE: /);
        expect(result?.errorText).toContain(stop.idempotencyKey);
        expect((result?.ackValue as { ledger?: string })?.ledger).toBe("result");
        expect((result?.ackValue as { stoppedBeforeWrite?: { stop?: { idempotencyKey?: string } } })?.stoppedBeforeWrite?.stop?.idempotencyKey).toBe(stop.idempotencyKey);
      });
    }

    it(`[flag ${flag ? "ON" : "OFF"}] ★ K-fix 2 (R-11-i a): a stop-LABELLED command with ARBITRARY writes is not a STOP — it does not cancel a write in its gates`, async () => {
      setEnv(flag);
      const write = await prep("set", [{ tagKey: TAG_STOP, value: 77 }]);
      const fake = await prep("stop", [{ tagKey: TAG_W, value: 0 }]); // labelled "stop", writes an unpinned tag
      const h = holdGatesOf(TAG_STOP);
      const pWrite = dispatch(write);
      await h.entered;
      const rFake = await dispatch(fake);
      expect(rFake.ok).toBe(true);
      expect(rFake.pinnedStop).not.toBe(true);
      h.release();
      expect((await pWrite).ok).toBe(true);
      expect(device.log).toEqual([`${TAG_W}=0`, `${TAG_STOP}=77`]);
    });

    it(`[flag ${flag ? "ON" : "OFF"}] ★ K-fix 2 (R-11-i b): a STOP refused before authorisation (HITL action not confirmed) moves nothing — the write in its gates is written`, async () => {
      setEnv(flag);
      const write = await prep("set", [{ tagKey: TAG_STOP, value: 77 }]);
      const stop = await prep("stop", [{ tagKey: TAG_STOP, value: 0 }]);
      const actionId = (stop.triggeredBy as { actionId: string }).actionId;
      await sql`UPDATE ai_pending_actions SET status = 'denied' WHERE id = ${actionId}`;
      const h = holdGatesOf(TAG_STOP);
      const pWrite = dispatch(write);
      await h.entered;
      const rStop = await dispatch(stop);
      expect(rStop).toMatchObject({ ok: false, status: "rejected" });
      h.release();
      expect((await pWrite).ok).toBe(true);
      expect(device.log).toEqual([`${TAG_STOP}=77`]);
    });

    it(`[flag ${flag ? "ON" : "OFF"}] control: a write whose gates begin AFTER the STOP is the newer intent and IS written`, async () => {
      setEnv(flag);
      const stop = await prep("stop", [{ tagKey: TAG_STOP, value: 0 }]);
      const write = await prep("set", [{ tagKey: TAG_STOP, value: 42 }]);
      expect((await dispatch(stop)).ok).toBe(true);
      const r = await dispatch(write);
      expect(r.ok).toBe(true);
      expect(device.log).toEqual([`${TAG_STOP}=0`, `${TAG_STOP}=42`]);
    });

    it(`[flag ${flag ? "ON" : "OFF"}] control: a STOP on ANOTHER adapter does not cancel this adapter's write`, async () => {
      setEnv(flag);
      const write = await prep("set", [{ tagKey: TAG_W, value: 9 }]);
      const h = holdGatesOf(TAG_W);
      const p = dispatch(write);
      await h.entered;
      const { bumpAdapterStopEpoch } = await import("./otDeviceWrite");
      bumpAdapterStopEpoch(adapterId + 1_000_000, { idempotencyKey: "other-adapter" });
      h.release();
      expect((await p).ok).toBe(true);
      expect(device.log).toEqual([`${TAG_W}=9`]);
    });

    // doc 81 Đợt 11 final fix wave (R-11-j, final review C-2) — an UNVERIFIED stop was never cancelled by another STOP in its gates.
    // Ruling R-11-o (M-3): a verified STOP supersedes an unverified stop CONSISTENTLY — in its gates as when it waits in the queue (R-1E-b):
    // SUPERSEDED_BY_STOP (never STOPPED_BEFORE_WRITE), nothing written, ledgered rejected; flag ON and OFF.
    it(`[flag ${flag ? "ON" : "OFF"}] ★ R-11-o M-3: an UNVERIFIED stop held in its gates while a pinned STOP is sent is SUPERSEDED_BY_STOP — never STOPPED_BEFORE_WRITE, nothing written (ledger: rejected)`, async () => {
      setEnv(flag);
      const unverified = await prep("stop", [{ tagKey: TAG_W, value: 0 }]); // stop-typed, w1 has no pin
      const stop = await prep("stop", [{ tagKey: TAG_STOP, value: 0 }]);
      const h = holdGatesOf(TAG_W);
      const pU = dispatch(unverified);
      await h.entered;
      expect(await dispatch(stop)).toMatchObject({ ok: true, pinnedStop: true });
      h.release();
      const rU = await pU;
      expect(rU.reason).not.toBe("STOPPED_BEFORE_WRITE");
      expect(rU).toMatchObject({ ok: false, reason: "SUPERSEDED_BY_STOP" });
      expect(rU.pinnedStop).not.toBe(true);
      expect(device.log).toEqual([`${TAG_STOP}=0`]);
      const rows = await sql<{ status: string }[]>`SELECT status FROM command_log WHERE id IN ${sql(rU.commandLogIds)} AND "ackValue"->>'ledger' = 'result'`;
      expect(rows.map((r) => r.status)).toEqual(["rejected"]);
    });
  }
});
