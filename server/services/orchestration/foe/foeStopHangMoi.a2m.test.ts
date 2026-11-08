/**
 * SCADA R1b-2b-2a A2(m) — unit half (no DB): an FOE pinned STOP never meets a spent authorisation row, and FOE action ids never truncate.
 *
 *   • M7 — `orchestrationActionId`: a key whose id is ≤ 64 characters is byte-identical to before; a longer one is hash-shortened (never cut):
 *     two steps sharing the first ~50 characters get two ids, attempt 2 of a long step id is not attempt 1's id. `stopActionIdMoi`: one id per
 *     dispatch (nonce).
 *   • M6 (pure half) — `soLanThuToiDa` / `stopGhimLuiMs`: a pinned STOP with maxAttempts UNSET gets 3 attempts, an explicit maxAttempts is
 *     kept (0 ⇒ 1 attempt); the pause is bounded by D.
 *   • M5 / M8 / M11 (store half) — the REAL central store (`centralRunStore.authorizeCommand` → `ensureOrchestrationAction`) over an in-memory
 *     drizzle stand-in, with the dispatcher's predicate (`phanLoaiStopGhimChoFoe`) and the critical-stop alert replaced by spies:
 *       pinned ⇒ a FRESH confirmed row per dispatch (a spent deterministic row is ignored); not pinned ⇒ the deterministic row, reused;
 *       a long key whose row exists only under the LEGACY truncated id ⇒ that row is used, nothing minted; the pin read fails ⇒ old path +
 *       exactly one URGENT alert naming run / step / adapter.
 *   • M9 — source scan: the edge authorisation, the central row and the command all take the id from the ONE function.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";

const H = vi.hoisted(() => ({
  store: new Map<string, Array<Record<string, any>>>(),
  db: null as unknown,
  phanLoai: vi.fn(async (_db: unknown, _input: unknown): Promise<{ pinnedStop: boolean; loiDocGhim: string | null }> => ({ pinnedStop: false, loiDocGhim: null })),
  alert: vi.fn(async (_a: Record<string, unknown>) => undefined),
}));

vi.mock("drizzle-orm", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return {
    ...actual,
    eq: (col: any, val: unknown) => ({ __op: "eq", col, val }),
    and: (...conds: any[]) => ({ __op: "and", conds }),
    inArray: (col: any, vals: unknown[]) => ({ __op: "in", col, vals }),
  };
});
vi.mock("../../../db/connection", async (orig) => ({ ...((await orig()) as Record<string, unknown>), getDb: async () => H.db }));
vi.mock("../../ot/commandDispatcher", async (orig) => ({ ...((await orig()) as Record<string, unknown>), phanLoaiStopGhimChoFoe: H.phanLoai }));
vi.mock("../../robot/criticalStopAlert", async (orig) => ({ ...((await orig()) as Record<string, unknown>), raiseCriticalStopAlert: H.alert }));

import { getTableName } from "drizzle-orm";
import { orchestrationActionId, orchestrationActionIdCu, stopActionIdMoi } from "./foeStepClass";
import { centralRunStore, ensureOrchestrationAction, type RunStoreContext } from "./foeRunStore";
import { soLanThuToiDa, stopGhimLuiMs, STOP_GHIM_SO_LAN_MAC_DINH } from "./foeEngine";
import { STOP_DB_STEP_DEADLINE_MS } from "../../robot/stopJob";
import { FOE_ENGINE_TOOL, laHangMoiStopGhim, otPayloadHash, readOtPayloadHash } from "../../ot/otActionBinding";

// ── in-memory drizzle stand-in: only the chains ensureOrchestrationAction / findSeparateGateApproval use ──
function colName(c: any): string {
  return String(c?.name ?? "");
}
function matches(row: Record<string, any>, p: any): boolean {
  if (!p) return true;
  if (p.__op === "and") return p.conds.every((x: any) => matches(row, x));
  if (p.__op === "eq") return row[colName(p.col)] === p.val;
  if (p.__op === "in") return p.vals.includes(row[colName(p.col)]);
  return true;
}
const rows = (name: string) => {
  let r = H.store.get(name);
  if (!r) H.store.set(name, (r = []));
  return r;
};
let inserts: Array<{ table: string; values: Record<string, any> }> = [];
function fakeDb() {
  return {
    select: () => ({
      from: (t: any) => {
        const name = getTableName(t);
        return {
          where: (p: any) => {
            const hit = () => rows(name).filter((r) => matches(r, p));
            return {
              limit: async (n: number) => hit().slice(0, n),
              then: (ok: (v: unknown) => unknown, err?: (e: unknown) => unknown) => Promise.resolve(hit()).then(ok, err),
            };
          },
        };
      },
    }),
    insert: (t: any) => ({
      values: async (v: Record<string, any>) => {
        const name = getTableName(t);
        if (rows(name).some((r) => r.id === v.id)) throw new Error(`duplicate key ${String(v.id)}`);
        rows(name).push(v);
        inserts.push({ table: name, values: v });
      },
    }),
  };
}

const RUN = 4242;
const ADAPTER = 31;
const USER = { id: 77, role: "operator" };
function rc(user = USER): RunStoreContext {
  return { runId: RUN, user, runOwner: 77, startedViaApi: false, def: { ref: "a2m", steps: [] } } as unknown as RunStoreContext;
}
const stepStop = { id: "dung", type: "command" as const, machineId: 5, command: "stop", args: { adapterId: ADAPTER, tagKey: "a", value: 0 } };
const descriptor = { name: "stop" } as never;
const cap = { adapterKind: "plc" } as never;
function authorize(key: string, attempt = 1, user = USER) {
  return centralRunStore.authorizeCommand(rc(user), stepStop, attempt, { isStop: true, robotKind: false, rawArgs: stepStop.args, descriptor, cap, idempotencyKey: key });
}

beforeEach(() => {
  H.store.clear();
  inserts = [];
  H.db = fakeDb();
  H.phanLoai.mockReset();
  H.phanLoai.mockImplementation(async () => ({ pinnedStop: false, loiDocGhim: null }));
  H.alert.mockReset();
  H.alert.mockImplementation(async () => undefined);
});

describe("A2(m) M7 — orchestrationActionId never truncates", () => {
  it("short keys: byte-identical to before (≤ 64 characters) — and equal to the legacy id", () => {
    expect(orchestrationActionId("run12-main-a1")).toBe("foe-run12-main-a1");
    const k60 = "r".repeat(60); // foe- + 60 = 64: still the plain id
    expect(orchestrationActionId(k60)).toBe(`foe-${k60}`);
    expect(orchestrationActionId(k60)).toBe(orchestrationActionIdCu(k60));
    expect(orchestrationActionId("run1-abort-kx9q2a-stop1")).toBe("foe-run1-abort-kx9q2a-stop1"); // abort keys unchanged
  });

  it("a long step id: attempt 2 is NOT attempt 1's id (the legacy truncation made them equal)", () => {
    const long = "x".repeat(50);
    const a1 = `run1234-${long}-a1`;
    const a2 = `run1234-${long}-a2`;
    expect(orchestrationActionIdCu(a1)).toBe(orchestrationActionIdCu(a2)); // the old collision, documented
    expect(orchestrationActionId(a1)).not.toBe(orchestrationActionId(a2));
    for (const id of [orchestrationActionId(a1), orchestrationActionId(a2)]) {
      expect(id.length).toBeLessThanOrEqual(64);
      expect(id.startsWith("foe-run1234-xxxx")).toBe(true); // readable prefix
      expect(id).toMatch(/~[0-9a-f]{16}$/); // + a sha256 slice of the WHOLE key
    }
    expect(orchestrationActionId(a1)).toBe(orchestrationActionId(a1)); // deterministic
  });

  it("two steps sharing the first ~50 characters ⇒ two different ids (first attempt already)", () => {
    const base = "y".repeat(50);
    const s1 = `run77-${base}-tram-1-a1`;
    const s2 = `run77-${base}-tram-2-a1`;
    expect(orchestrationActionIdCu(s1)).toBe(orchestrationActionIdCu(s2));
    expect(orchestrationActionId(s1)).not.toBe(orchestrationActionId(s2));
  });

  it("stopActionIdMoi: one id per dispatch (nonce), ≤ 64, readable, never the deterministic id", () => {
    const key = "run9-dung-a1";
    const a = stopActionIdMoi(key, 1, "11111111-2222-3333-4444-555555555555");
    const b = stopActionIdMoi(key, 1, "66666666-7777-8888-9999-000000000000");
    expect(a).not.toBe(b);
    expect(a).not.toBe(orchestrationActionId(key));
    expect(a.length).toBeLessThanOrEqual(64);
    expect(a.startsWith("foe-run9-dung-a1#stop-a1-")).toBe(true);
    expect(stopActionIdMoi(key, 2, "n")).not.toBe(stopActionIdMoi(key, 1, "n")); // the attempt is part of it
    const longKey = `run9-${"z".repeat(70)}-a1`;
    expect(stopActionIdMoi(longKey, 1, "n1")).not.toBe(stopActionIdMoi(longKey, 1, "n2"));
  });
});

describe("A2(m) M6 (pure) — the STOP default of attempts and its bounded pause", () => {
  it("pinned STOP with maxAttempts UNSET ⇒ 3 attempts; explicit maxAttempts kept (0 ⇒ 1, 2 ⇒ 3); not pinned ⇒ 1 as before", () => {
    expect(STOP_GHIM_SO_LAN_MAC_DINH).toBe(3);
    expect(soLanThuToiDa({}, true)).toBe(3);
    expect(soLanThuToiDa({}, false)).toBe(1);
    expect(soLanThuToiDa({ maxAttempts: 0 }, true)).toBe(1);
    expect(soLanThuToiDa({ maxAttempts: 0 }, false)).toBe(1);
    expect(soLanThuToiDa({ maxAttempts: 2 }, true)).toBe(3);
    expect(soLanThuToiDa({ maxAttempts: 5 }, false)).toBe(6);
  });
  it("pause before attempt 2 / 3 / later: 250 ms, 500 ms, then never above D", () => {
    expect(stopGhimLuiMs(2)).toBe(250);
    expect(stopGhimLuiMs(3)).toBe(500);
    expect(stopGhimLuiMs(4)).toBe(STOP_DB_STEP_DEADLINE_MS);
    expect(stopGhimLuiMs(20)).toBe(STOP_DB_STEP_DEADLINE_MS);
  });
});

describe("A2(m) — the central store: fresh row per dispatch for a PINNED STOP only", () => {
  it("★ M1/M2/M3 (store half): pinned ⇒ a NEW confirmed row per dispatch even when the deterministic row exists and is SPENT, owner = the walker of THIS dispatch; stopGhim on the verdict", async () => {
    H.phanLoai.mockImplementation(async () => ({ pinnedStop: true, loiDocGhim: null }));
    const key = `run${RUN}-dung-a1`;
    rows("ai_pending_actions").push({ id: orchestrationActionId(key), status: "executed", userId: 1, tool: FOE_ENGINE_TOOL, expiresAt: new Date(Date.now() - 7_200_000) });

    const v1 = await authorize(key);
    const v2 = await authorize(key); // a resume: same attempt key
    const v3 = await authorize(key, 1, { id: 88, role: "supervisor" }); // a resume by ANOTHER user
    for (const v of [v1, v2, v3]) {
      expect(v.ok).toBe(true);
      if (!v.ok) return;
      expect(v.stopGhim).toBe(true);
      expect(v.cmd.hitl?.actionId).not.toBe(orchestrationActionId(key));
      expect(v.cmd.hitl?.actionId.startsWith(`foe-run${RUN}-dung-a1#stop-a1-`)).toBe(true);
    }
    const ids = [v1, v2, v3].map((v) => (v.ok ? v.cmd.hitl?.actionId : null));
    expect(new Set(ids).size).toBe(3);
    expect(inserts.map((i) => i.values.id)).toEqual(ids); // one INSERT per dispatch, under exactly the id the command carries
    for (const [i, ins] of inserts.entries()) {
      expect(ins.values.status).toBe("confirmed"); // today's STOP-row content: confirmed, bound to the STOP payload, 1 h
      expect(ins.values.tool).toBe(FOE_ENGINE_TOOL);
      expect(ins.values.idempotencyKey).toBe(ins.values.id);
      expect(readOtPayloadHash(ins.values.previewJson)).toBe(otPayloadHash({ tool: FOE_ENGINE_TOOL, adapterId: ADAPTER, machineId: 5, commandType: "stop", writes: [{ tagKey: "a", value: 0 }] })); // bound to the STOP payload
      expect(ins.values.userId).toBe(i === 2 ? 88 : 77); // owner = the walker of that dispatch (no gate approval here)
      expect(ins.values.expiresAt.getTime()).toBeGreaterThan(Date.now() + 3_500_000);
      expect(laHangMoiStopGhim(ins.values.previewJson)).toBe(true); // AMENDMENT 2 — MARKED: only a pinned STOP the dispatcher confirms may consume it
    }
    expect(rows("ai_pending_actions").find((r) => r.id === orchestrationActionId(key))?.status).toBe("executed"); // the spent row is untouched
    expect(H.alert).not.toHaveBeenCalled();
    // the predicate was asked with exactly what will be sent
    expect(H.phanLoai.mock.calls[0]?.[1]).toEqual({ adapterId: ADAPTER, commandType: "stop", writes: [{ tagKey: "a", value: 0 }] });
  });

  it("★ M5 (store half): NOT pinned (an unpinned stop-typed step, or the predicate says no) ⇒ the deterministic row, an existing row REUSED whatever its status, no stopGhim", async () => {
    const key = `run${RUN}-dung-a1`;
    rows("ai_pending_actions").push({ id: orchestrationActionId(key), status: "executed", userId: 77, tool: FOE_ENGINE_TOOL });
    const v = await authorize(key);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.stopGhim).toBeUndefined();
    expect(v.cmd.hitl?.actionId).toBe(orchestrationActionId(key));
    expect(inserts).toHaveLength(0); // nothing minted: the spent row stays THE authorisation (dispatcher ⇒ NOT_CONFIRMED)

    const v2 = await authorize(`run${RUN}-dung-a2`);
    expect(v2.ok && v2.cmd.hitl?.actionId).toBe(`foe-run${RUN}-dung-a2`);
    expect(inserts.map((i) => i.values.id)).toEqual([`foe-run${RUN}-dung-a2`]); // first dispatch of a new key: today's row
    expect(laHangMoiStopGhim(inserts[0]!.values.previewJson)).toBe(false); // a deterministic row is never marked
  });

  it("★ M8 (store half): a long key whose row exists ONLY under the legacy truncated id ⇒ that row is used (pending or spent), nothing minted; no legacy row ⇒ the new hashed id", async () => {
    const long = "s".repeat(58);
    const key = `run${RUN}-${long}-a1`;
    expect(orchestrationActionIdCu(key)).not.toBe(orchestrationActionId(key));
    for (const status of ["confirmed", "executed"]) {
      H.store.clear();
      inserts = [];
      rows("ai_pending_actions").push({ id: orchestrationActionIdCu(key), status, userId: 77, tool: FOE_ENGINE_TOOL });
      const got = await ensureOrchestrationAction(USER, key, { ...stepStop, id: long, command: "start" }, {}, { name: "start", machineId: 5, adapterId: ADAPTER, writes: [{ tagKey: "t", value: 1 }], idempotencyKey: key, hitl: { actionId: orchestrationActionId(key), tool: FOE_ENGINE_TOOL, requestedBy: 77, confirmedBy: 77 } });
      expect(got).toBe(orchestrationActionIdCu(key));
      expect(inserts).toHaveLength(0);
    }
    H.store.clear();
    inserts = [];
    const fresh = await ensureOrchestrationAction(USER, key, { ...stepStop, id: long, command: "start" }, {}, { name: "start", machineId: 5, adapterId: ADAPTER, writes: [{ tagKey: "t", value: 1 }], idempotencyKey: key, hitl: { actionId: orchestrationActionId(key), tool: FOE_ENGINE_TOOL, requestedBy: 77, confirmedBy: 77 } });
    expect(fresh).toBe(orchestrationActionId(key));
    expect(inserts.map((i) => i.values.id)).toEqual([orchestrationActionId(key)]);
  });

  it("M8: the command of a legacy-row step carries the LEGACY id (the row it is authorised by)", async () => {
    const long = "q".repeat(58);
    const key = `run${RUN}-${long}-a1`;
    rows("ai_pending_actions").push({ id: orchestrationActionIdCu(key), status: "confirmed", userId: 77, tool: FOE_ENGINE_TOOL });
    const v = await centralRunStore.authorizeCommand(rc(), { ...stepStop, id: long }, 1, { isStop: true, robotKind: false, rawArgs: stepStop.args, descriptor, cap, idempotencyKey: key });
    expect(v.ok && v.cmd.hitl?.actionId).toBe(orchestrationActionIdCu(key));
  });

  it("★ M11 (store half): the pin read FAILS ⇒ old path (deterministic row) + exactly ONE URGENT alert naming run / step / adapter, deduplicated durably", async () => {
    H.phanLoai.mockImplementation(async () => ({ pinnedStop: false, loiDocGhim: "connection reset" }));
    const key = `run${RUN}-dung-a1`;
    const v = await authorize(key);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.stopGhim).toBeUndefined();
    expect(v.cmd.hitl?.actionId).toBe(orchestrationActionId(key));
    expect(inserts.map((i) => i.values.id)).toEqual([orchestrationActionId(key)]);
    expect(laHangMoiStopGhim(inserts[0]!.values.previewJson)).toBe(false); // old path ⇒ no mark
    await vi.waitFor(() => expect(H.alert).toHaveBeenCalledTimes(1));
    const a = H.alert.mock.calls[0]![0] as Record<string, any>;
    expect(a.kind).toBe("foe_stop_pin_unverified");
    expect(a.message).toMatch(/^STOP pin could not be verified — the STOP may not be re-sendable \(run 4242, step "dung", adapter 31\): connection reset/);
    expect(a.dedupKey).toBe(`foe_stop_pin_unverified:${RUN}:dung:${ADAPTER}`);
    expect(a.khuTrungBenVung).toEqual({});
    expect(a.recipients).toEqual([77]);
  });

  it("M11: a predicate that THROWS counts as a failed read (old path + one alert)", async () => {
    H.phanLoai.mockImplementation(async () => {
      throw new Error("boom");
    });
    const v = await authorize(`run${RUN}-dung-a1`);
    expect(v.ok && v.cmd.hitl?.actionId).toBe(`foe-run${RUN}-dung-a1`);
    expect(v.ok && v.stopGhim).toBeUndefined();
    await vi.waitFor(() => expect(H.alert).toHaveBeenCalledTimes(1));
    expect(String((H.alert.mock.calls[0]![0] as Record<string, unknown>).message)).toMatch(/: boom./);
  });
});

describe("A2(m)-test r12 — a STOP never waits on a HUNG pin read (L-7)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("★ the pin read never resolves ⇒ the STOP's verdict is ok within D (old path: deterministic row, not pinned) + one URGENT alert naming the deadline", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    H.phanLoai.mockImplementation(() => new Promise(() => undefined)); // hangs for ever
    const key = `run${RUN}-dung-a1`;
    const got: { v?: Awaited<ReturnType<typeof authorize>> } = {};
    void authorize(key).then((v) => {
      got.v = v;
    });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(STOP_DB_STEP_DEADLINE_MS - 1);
    expect(H.phanLoai).toHaveBeenCalledTimes(1); // the pin read really started (and is the thing that hangs)
    expect(got.v).toBeUndefined(); // still inside D: waiting for the read, nothing sent early
    await vi.advanceTimersByTimeAsync(1 + 50); // D, plus a small margin for the rest of the (in-memory) authorisation
    const verdict = got.v;
    expect(verdict, "the STOP must be authorised within D + margin although the pin read never answers").toBeDefined();
    expect(verdict!.ok).toBe(true);
    if (!verdict || !verdict.ok) return;
    expect(verdict.stopGhim).toBeUndefined(); // not pinned: the OLD path
    expect(verdict.cmd.hitl?.actionId).toBe(orchestrationActionId(key));
    expect(inserts.map((i) => i.values.id)).toEqual([orchestrationActionId(key)]);
    expect(laHangMoiStopGhim(inserts[0]!.values.previewJson)).toBe(false);
    await vi.advanceTimersByTimeAsync(0);
    await vi.waitFor(() => expect(H.alert).toHaveBeenCalledTimes(1));
    expect(String((H.alert.mock.calls[0]![0] as Record<string, unknown>).message)).toMatch(/pin check timeout after 1000ms/);
  });

  it("a pin read that answers ONLY after >> D is cut at D too (a late 'pinned' answer changes nothing)", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    H.phanLoai.mockImplementation(() => new Promise((res) => setTimeout(() => res({ pinnedStop: true, loiDocGhim: null }), 30_000)));
    type V = Awaited<ReturnType<typeof authorize>>;
    let verdict = undefined as V | undefined;
    void authorize(`run${RUN}-dung-a1`).then((v) => {
      verdict = v;
    });
    await vi.advanceTimersByTimeAsync(STOP_DB_STEP_DEADLINE_MS + 50);
    expect((verdict as V | undefined)?.ok).toBe(true);
    expect((verdict as V | undefined)?.ok && (verdict as V & { ok: true }).stopGhim).toBeUndefined();
    await vi.advanceTimersByTimeAsync(30_000); // the late answer arrives: still not pinned
    expect((verdict as V | undefined)?.ok && (verdict as V & { ok: true }).stopGhim).toBeUndefined();
  });
});

// ── M9 + the A2(h) predicate reuse: source scans ──
const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const src = (rel: string) => readFileSync(join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
function tsFiles(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (n === "node_modules") continue;
    if (statSync(p).isDirectory()) tsFiles(p, out);
    else if (n.endsWith(".ts") && !n.endsWith(".test.ts")) out.push(p);
  }
  return out;
}

describe("A2(m) M9 — one id function for every FOE authorisation row", () => {
  it("edge authorise, the central row and the command all call orchestrationActionId (foeStepClass)", () => {
    const edge = code(src("server/services/edge/edgeAuthorizeCentral.ts"));
    expect(edge).toMatch(/const \{ orchestrationActionId \} = await import\("\.\.\/orchestration\/foe\/foeStepClass"\);/);
    expect(edge).toMatch(/const actionId = orchestrationActionId\(req\.idempotencyKey\);/);
    const store = code(src("server/services/orchestration/foe/foeRunStore.ts"));
    expect(store).toMatch(/const actionId = hangMoi \?\? orchestrationActionId\(idempotencyKey\);/);
    const cls = code(src("server/services/orchestration/foe/foeStepClass.ts"));
    expect(cls).toMatch(/actionId: orchestrationActionId\(idempotencyKey\),/);
  });

  it("no other server file builds an FOE action id by hand (`foe-${…}`) or cuts one to 64", () => {
    const hits: string[] = [];
    for (const f of tsFiles(join(ROOT, "server"))) {
      const rel = relative(ROOT, f).replace(/\\/g, "/");
      if (rel === "server/services/orchestration/foe/foeStepClass.ts") continue;
      const c = code(readFileSync(f, "utf8"));
      if (/`foe-\$\{/.test(c) || /["']foe-["']\s*\+/.test(c)) hits.push(rel);
    }
    expect(hits).toEqual([]);
    const cls = code(src("server/services/orchestration/foe/foeStepClass.ts"));
    expect(cls.match(/`foe-\$\{idempotencyKey\}`/g)).toHaveLength(2); // orchestrationActionId + the legacy orchestrationActionIdCu
    expect(code(src("server/services/orchestration/foe/foeRunStore.ts"))).not.toMatch(/\.slice\(0, 64\)/);
  });
});

describe("A2(m) — the engine asks the A2(h) predicate; the reservation is unchanged", () => {
  it("the store's pinned check goes through phanLoaiStopGhimChoFoe → laStopGhimTaiCong1 (gate (1)'s function), never laStopChoKhoa / classifyOtStop", () => {
    const store = code(src("server/services/orchestration/foe/foeRunStore.ts"));
    const fn = store.slice(store.indexOf("async function laStopGhimChoHangFoe("), store.indexOf("function canhBaoGhimStopKhongXacMinh("));
    expect(fn).toMatch(/phanLoaiStopGhimChoFoe\(d, \{ adapterId, commandType: cmd\.name, writes: cmd\.writes \?\? \[\] \}\)/);
    expect(fn).not.toMatch(/\b(laStopChoKhoa|phanLoaiStopKhoa|classifyOtStop|matchPinnedStop|isStopCommandType)\b/);
    const disp = code(src("server/services/ot/commandDispatcher.ts"));
    const exp = disp.slice(disp.indexOf("export async function phanLoaiStopGhimChoFoe("));
    expect(exp.slice(0, exp.indexOf("\n}\n"))).toMatch(/await laStopGhimTaiCong1\(db, input, \(loi\) => \(loiDocGhim = loi\), "FOE engine"\)/);
  });

  it("the reservation keeps 'one approval = one write': verifyActionBinding WITHOUT daTieuChoBuoc2, CAS confirmed→executed", () => {
    const disp = code(src("server/services/ot/commandDispatcher.ts"));
    const res = disp.slice(disp.indexOf("async function reserveRealWrite("));
    expect(res).toMatch(/verdict = verifyActionBinding\(pending, opts\.bindingInput \?\? input, t, \{ pinnedStop: opts\.pinnedStop === true, altWrites: opts\.rawBindingWrites \}\);/);
    expect(res).toMatch(/\.where\(and\(eq\(aiPendingActions\.id, t\.actionId\), eq\(aiPendingActions\.status, "confirmed"\)\)\)/);
    // AMENDMENT 2 — a MARKED fresh row is refused unless the dispatcher's OWN verdict (opts.pinnedStop) says pinned STOP: after the binding,
    // before the FOE DB re-check and the CAS — so a real gate approval does not let a non-pinned command consume it
    const mark = res.indexOf("if (verdict.ok && laHangMoiStopGhim(pending?.previewJson) && opts.pinnedStop !== true) {");
    expect(mark).toBeGreaterThan(res.indexOf("verdict = verifyActionBinding(pending"));
    expect(mark).toBeLessThan(res.indexOf("foeApprovalDbRefusal(tx, pending"));
    expect(mark).toBeLessThan(res.indexOf('.set({ status: "executed", executedAt: new Date() })'));
    expect(res.slice(mark, mark + 300)).toContain('verdict = { ok: false, reason: "NOT_CONFIRMED", detail: HANG_MOI_STOP_GHIM_TU_CHOI };');
  });

  it("the walker's retry loop: STOP default only for a pinned STOP (outcome.stopGhim) with maxAttempts UNSET, decided PER ATTEMPT; the pause awaited", () => {
    const eng = code(src("server/services/orchestration/foe/foeEngine.ts"));
    const loop = eng.slice(eng.indexOf("else while (true) {"), eng.indexOf("if (outcome.kind === \"failed\" && outcome.stopGhim) {"));
    expect(loop).toMatch(/const ghimMacDinh = outcome\.kind === "failed" && outcome\.stopGhim === true && step\.maxAttempts === undefined;/);
    expect(loop).toMatch(/if \(outcome\.kind !== "failed" \|\| attempt >= soLanThuToiDa\(step, ghimMacDinh\)\) break;/);
    expect(loop).toMatch(/if \(ghimMacDinh\) await sleep\(stopGhimLuiMs\(attempt \+ 1\), rc\.controller\.signal\);/);
    expect(loop).not.toMatch(/maxAttempts = Math\.max/); // fix round 1 — no sticky budget
  });
});
