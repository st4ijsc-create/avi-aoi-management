/**
 * SCADA R1b-2b-2a T3E (backlog 90, AN TOÀN) — lô ghi áp MỘT PHẦN ⇒ kết cục riêng `MOT_PHAN` (status vẫn `failed`) + `motPhan {daAp, khongAp}`.
 *
 * Thiết bị:
 *   • S7: nodes7 0.3.18 THẬT trên `__s7commSim` (peer giả trong tiến trình, ĐẾM PDU ghi). `writeMixed` = PLC trả 0xFF cho item đầu của job (địa chỉ
 *     thấp nhất — nodes7 sắp item theo vùng/offset) và 0x0A cho item còn lại. Lời ghi được gửi theo thứ tự [b, a] (b ở địa chỉ CAO) ⇒ ánh xạ theo
 *     `useraddr`, không theo vị trí.
 *   • edge: `dispatchOtOnEdge` với driver giả (kết quả theo item cho sẵn), runtime + journal giả, chữ ký Ed25519 THẬT (khuôn otEdgeDispatch.dot10).
 * Không DB (mô-đun DB là bẫy).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const H = vi.hoisted(() => ({
  driver: null as null | { writes: Array<Array<Record<string, unknown>>>; writeTags: (w: Array<Record<string, unknown>>) => Promise<unknown>; readTags: () => Promise<unknown[]> },
  fingerprint: "f".repeat(64) as string | undefined,
  dbCalls: 0,
}));
vi.mock("../../db/connection", () => ({
  getDb: async () => {
    H.dbCalls++;
    throw new Error("DB_TRAP: getDb() in a no-DB suite");
  },
  isEdgeProcessRole: () => true,
}));
vi.mock("./otManager", async (importOriginal) => {
  const orig = await importOriginal<typeof import("./otManager")>();
  return {
    ...orig,
    getActiveDriver: () => H.driver ?? undefined,
    getActiveConnectionFingerprint: () => H.fingerprint,
  };
});
vi.mock("./adapterFacade", () => ({
  createAdapterFacade: () => ({ getSafetyStatus: async () => ({ state: "OK", source: "test", ts: new Date().toISOString() }) }),
}));

import { startS7commSim, type S7commSim } from "./drivers/__s7commSim";
import { S7Driver } from "./drivers/s7Driver";
import { executeOtDeviceWrite, _resetAdapterCommandQueuesForTests } from "./otDeviceWrite";
import { ketCucLo, motPhanCua, motPhanTuKetQua, MA_MOT_PHAN } from "./motPhan";
import { dispatchOtOnEdge } from "./otEdgeDispatch";
import { EDGE_TYP_NAME, EdgeTrustStore, edgePinnedKeyset, generateEdgeSigningKey, signEdgeObject } from "../edge/edgeSigning";
import { edgeCommandPayloadHash, type EdgeStepAuthorization } from "../edge/edgeAuthorizationVerifier";
import type { EdgeDeviceRuntime, EdgeDispatchJournal } from "../edge/edgeDeviceRuntime";
import type { EdgeConfigSnapshot } from "../edge/edgeProtocol";
import { duoiMotPhan } from "../scada/lenhHmi";

const dong: Array<() => unknown> = [];
const cuSerialize = process.env.OT_CMD_SERIALIZE_ENABLED;
beforeEach(() => {
  delete process.env.OT_CMD_SERIALIZE_ENABLED;
  delete process.env.OT_READBACK_ENABLED;
  _resetAdapterCommandQueuesForTests();
});
afterEach(async () => {
  while (dong.length) await dong.pop()!();
  if (cuSerialize === undefined) delete process.env.OT_CMD_SERIALIZE_ENABLED;
  else process.env.OT_CMD_SERIALIZE_ENABLED = cuSerialize;
});

// ─── S7 (nodes7 THẬT + sim) ───────────────────────────────────────────────────────────────────────────────────────────────────────
/** b ở địa chỉ CAO, gửi TRƯỚC: nếu driver ánh xạ theo vị trí thì b sẽ bị coi là "đã áp". */
const LO_HAI = [
  { tagKey: "b", address: "DB1,INT2", value: 7, dataType: "int" as const },
  { tagKey: "a", address: "DB1,INT0", value: 5, dataType: "int" as const },
];

async function s7(fault: "writeMixed" | "writeError" | "writeShort" | null): Promise<{ sim: S7commSim; d: S7Driver; soPduGhi: () => number }> {
  const sim = await startS7commSim();
  sim.setFault(fault);
  const d = new S7Driver();
  dong.push(() => sim.close(), () => d.disconnect());
  await d.connect({ endpoint: `127.0.0.1:${sim.port}`, timeoutMs: 1500 });
  const soPduGhi = () => sim.pdus.filter((p) => p.bytes[1] === 0x01 && p.bytes[10] === 0x05).length;
  return { sim, d, soPduGhi };
}

function quaDeviceStage(d: S7Driver, writes = LO_HAI) {
  return executeOtDeviceWrite({
    input: { adapterId: 993_000 + Math.floor(Math.random() * 900), machineId: null, commandType: "set_param", idempotencyKey: `t3e-${Math.random()}`, writes: writes.map((w) => ({ tagKey: w.tagKey, value: w.value })) } as never,
    driver: d,
    resolved: writes.map((w) => ({ write: { tagKey: w.tagKey, value: w.value }, address: w.address, dataType: w.dataType })),
    driverWrites: writes.map((w) => ({ tagKey: w.tagKey, address: w.address, value: w.value, dataType: w.dataType })),
    timeoutMs: 3000,
    stopTyped: false,
    ledger: { intentIds: [1, 2], confirmedBy: 1 },
  });
}
const theoTag = (ex: Awaited<ReturnType<typeof quaDeviceStage>>, writes = LO_HAI) =>
  ex.outcomes.map((o) => ({ tagKey: writes[o.idx]!.tagKey, ok: o.ok, status: o.status }));

describe("T3E — S7 (nodes7 0.3.18 THẬT + __s7commSim): kết quả theo item từ writeResponse", () => {
  it("★ lô trộn 0xFF + 0x0A ⇒ item áp ok, item kia failed (KHÔNG ketCucKhongRo); MỘT PDU ghi; ánh xạ theo tagKey không theo vị trí", async () => {
    const { d, soPduGhi } = await s7("writeMixed");
    const out = await d.writeTags(LO_HAI);
    expect(soPduGhi()).toBe(1);
    expect(out).toHaveLength(2);
    const a = out.find((r) => r.tagKey === "a")!;
    const b = out.find((r) => r.tagKey === "b")!;
    expect(a).toEqual({ tagKey: "a", ok: true });
    expect(b.ok).toBe(false);
    expect(b.ketCucKhongRo).toBeUndefined();
    expect(String(b.error)).toMatch(/^bad write quality/);
    expect(String(b.error)).toMatch(/0x0a/i);
  }, 15_000);

  it("★ qua device stage + kết cục lô ⇒ failed + motPhan {daAp:[a], khongAp:[b]} (MỘT luật dispatcher/edge)", async () => {
    const { d, soPduGhi } = await s7("writeMixed");
    const ex = await quaDeviceStage(d);
    expect(soPduGhi()).toBe(1);
    expect(ex.timedOut).toBe(false);
    const ds = theoTag(ex);
    expect(ds).toEqual([
      { tagKey: "b", ok: false, status: "failed" },
      { tagKey: "a", ok: true, status: "acked" },
    ]);
    expect(ketCucLo(ds, ex.timedOut)).toEqual({ ok: false, status: "failed", motPhan: { daAp: ["a"], khongAp: ["b"] } });
  }, 15_000);

  it("đối chứng: lô toàn 0x0A ⇒ failed thường (cả hai 'bad write quality'), KHÔNG motPhan", async () => {
    const { d } = await s7("writeError");
    const ex = await quaDeviceStage(d);
    const ds = theoTag(ex);
    expect(ds.every((x) => x.ok === false && x.status === "failed")).toBe(true);
    expect(ex.outcomes.map((o) => o.errorText)).toEqual(["bad write quality", "bad write quality"]);
    expect(ketCucLo(ds, ex.timedOut)).toEqual({ ok: false, status: "failed", motPhan: null });
  }, 15_000);

  it("đối chứng: lô toàn 0xFF ⇒ acked, KHÔNG motPhan", async () => {
    const { d } = await s7(null);
    const ex = await quaDeviceStage(d);
    expect(ketCucLo(theoTag(ex), ex.timedOut)).toEqual({ ok: true, status: "acked", motPhan: null });
  }, 15_000);

  it("luật T2 THẮNG: trả lời CỤT (một item không có mã) ⇒ timeout 'outcome unknown', KHÔNG một phần", async () => {
    const { d } = await s7("writeShort");
    const ex = await quaDeviceStage(d);
    expect(ex.outcomes.every((o) => o.status === "timeout")).toBe(true);
    expect(ketCucLo(theoTag(ex), ex.timedOut)).toEqual({ ok: false, status: "timeout", motPhan: null });
  }, 15_000);
});

describe("T3E — motPhanTuKetQua / motPhanCua (một nơi suy)", () => {
  it("≥1 áp + ≥1 failed ⇒ một phần; có timeout ⇒ null (T2); toàn áp / toàn failed / simulated / rejected ⇒ null", () => {
    expect(motPhanTuKetQua([{ tagKey: "x", ok: true, status: "acked_verified" }, { tagKey: "y", ok: false, status: "failed" }])).toEqual({ daAp: ["x"], khongAp: ["y"] });
    expect(motPhanTuKetQua([{ tagKey: "x", ok: true, status: "acked" }, { tagKey: "y", ok: false, status: "failed" }, { tagKey: "z", ok: false, status: "timeout" }])).toBeNull();
    expect(motPhanTuKetQua([{ tagKey: "x", ok: true, status: "acked" }, { tagKey: "y", ok: true, status: "acked" }])).toBeNull();
    expect(motPhanTuKetQua([{ tagKey: "x", ok: false, status: "failed" }, { tagKey: "y", ok: false, status: "failed" }])).toBeNull();
    expect(motPhanTuKetQua([{ tagKey: "x", ok: true, status: "simulated" }, { tagKey: "y", ok: false, status: "failed" }])).toBeNull();
    expect(motPhanTuKetQua([{ tagKey: "x", ok: true, status: "acked" }, { tagKey: "y", ok: false, status: "rejected" }])).toBeNull();
    expect(motPhanTuKetQua(null)).toBeNull();
  });
  it("bộ ghi lần thử HMI: đuôi câu mang danh sách đã áp / không áp; kết cục khác ⇒ rỗng", () => {
    expect(duoiMotPhan({ motPhan: { daAp: ["run"], khongAp: ["run2", "run3"] } })).toBe(" — đã áp: run; không áp: run2, run3");
    expect(duoiMotPhan({})).toBe("");
    expect(duoiMotPhan({ motPhan: { daAp: [], khongAp: ["x"] } })).toBe("");
  });
  it("motPhanCua chỉ nhận đúng hình (hai mảng chuỗi không rỗng)", () => {
    expect(motPhanCua({ daAp: ["a"], khongAp: ["b"] })).toEqual({ daAp: ["a"], khongAp: ["b"] });
    expect(motPhanCua({ daAp: [], khongAp: ["b"] })).toBeNull();
    expect(motPhanCua({ daAp: ["a"], khongAp: [1] })).toBeNull();
    expect(motPhanCua("MOT_PHAN")).toBeNull();
    expect(motPhanCua(null)).toBeNull();
  });
});

// ─── edge (otEdgeDispatch): kết quả báo về mang motPhan ────────────────────────────────────────────────────────────────────────────
const T0 = 1_790_000_000_000;
const NODE = 7;
const CRED = 31;
const NONCE = "n0nce_AAAAAAAAAAAAAAAAAA";
const JTI = "0b8f3c1e-5d7a-4c1b-9a2e-3f4d5c6b7a81";
const key = generateEdgeSigningKey().key;
const pin = edgePinnedKeyset([{ kid: key.kid, publicKeyPem: key.publicKeyPem, notBefore: T0 - 60_000 }], T0);
const trust = () => EdgeTrustStore.fromPinned(pin, { nodeId: NODE, now: () => T0, skewMs: 5_000 });

function config(): EdgeConfigSnapshot {
  const tag = (id: number, tagKey: string, address: string, dataType: "int" | "bool", stopValue: unknown = null) => ({
    id, tagKey, address, dataType, scale: null, offset: null, writable: true, isEnabled: true, stopValue, updatedAt: T0,
  });
  return {
    kind: "config_snapshot", protocolVersion: 2, configVersion: 3, issuedAt: T0,
    node: { id: NODE, code: "EDGE-A", credentialId: CRED, factoryCode: "F1", lineCodes: ["L1"] },
    adapters: [
      {
        id: 5, code: "PLC-5", machineId: 50, protocol: "stub", endpoint: "stub://5", connectionOptions: null, pollIntervalMs: 1000, isEnabled: true,
        connectionFingerprint: "f".repeat(64), ownerEpoch: 2, updatedAt: T0,
        tags: [tag(1, "speed", "40001", "int"), tag(2, "speed2", "40002", "int"), tag(3, "run", "00001", "bool", false), tag(4, "run2", "00002", "bool", false)],
      },
    ],
    robots: [], machines: [], safetyPlcConfigs: [],
    keyset: signEdgeObject("keyset", { v: 1, version: 1, issuedAt: T0, keys: [] }, key) as never,
    limits: { authTtlMs: 10_000, maxClockSkewMs: 5_000, journalMaxBytes: 1_000_000, programReportMs: 30_000, programReportMaxAgeMs: 60_000, heartbeatMs: 5_000, pullMs: 2_000 },
  } as EdgeConfigSnapshot;
}
const CMD = { adapterId: 5, machineId: 50, commandType: "set_speed", writes: [{ tagKey: "speed", value: 10 }, { tagKey: "speed2", value: 11 }] };
const RESOLVED = [
  { tagKey: "speed", address: "40001", dataType: "int" as const, scale: null, offset: null },
  { tagKey: "speed2", address: "40002", dataType: "int" as const, scale: null, offset: null },
];
function auth(): EdgeStepAuthorization {
  const claims = {
    typ: EDGE_TYP_NAME.auth, kid: key.kid, jti: JTI, nodeId: NODE, credentialId: CRED, runId: 9, claimSeq: 2, stepId: "w1", attempt: 1,
    idempotencyKey: "foe:9:w1:1", kind: "ot", target: { adapterId: 5, writes: RESOLVED },
    payloadHash: edgeCommandPayloadHash({ kind: "ot", ...CMD }), approval: { approvedBy: 4, gateStepId: "g" }, mode: "real",
    verdicts: { commissioned: true, policy: "allow", interlock: "pass" }, safetyConfigIds: [], reqNonce: NONCE, iat: T0, ttlMs: 10_000,
  };
  return { envelope: signEdgeObject("auth", claims, key), runId: 9, claimSeq: 2, stepId: "w1", attempt: 1, idempotencyKey: "foe:9:w1:1", reqNonce: NONCE };
}
type Journal = EdgeDispatchJournal & { consumed: string[]; runs: Array<Record<string, unknown>>; events: unknown[] };
function journal(): Journal {
  const j: Journal = {
    consumed: [], runs: [], events: [],
    async consumeAuthorization(c) {
      if (j.consumed.includes(c.jti)) return { ok: false, reason: "jti_consumed" };
      j.consumed.push(c.jti);
      return { ok: true };
    },
    isJtiConsumed: (jti) => j.consumed.includes(jti),
    admitNonStop: () => true,
    async appendRun(runId, claimSeq, rec) {
      j.runs.push({ runId, claimSeq, ...rec });
      return { seq: j.runs.length, durable: true };
    },
    async appendEvent(rec) {
      j.events.push(rec);
      return { seq: j.events.length, durable: true };
    },
  };
  return j;
}
function runtime(j: Journal): EdgeDeviceRuntime {
  return {
    nodeId: NODE,
    config: () => config(),
    journal: j,
    auth: () => ({ trust: trust(), credentialId: CRED, maxTtlMs: 10_000, pendingNonce: (n: string) => (n === NONCE ? { sentMonoMs: 1_000 } : null), nowMonoMs: () => 1_500 }),
    otControlEnabled: () => true,
    robotControlEnabled: () => true,
  };
}
const run = { runId: 9, claimSeq: 2, stepId: "w1", attempt: 1 };
/** driver giả: tag trong `khongAp` ⇒ thiết bị nói "không áp" (ok:false, không ketCucKhongRo). */
function driverTron(khongAp: string[]) {
  const writes: Array<Array<Record<string, unknown>>> = [];
  H.driver = {
    writes,
    writeTags: async (w) => {
      writes.push(w.map((x) => ({ ...x })));
      return w.map((x) => (khongAp.includes(String(x.tagKey)) ? { tagKey: x.tagKey, ok: false, error: "bad status: BadNotWritable" } : { tagKey: x.tagKey, ok: true }));
    },
    readTags: async () => [],
  };
}

describe("T3E — edge: kết quả báo về mang motPhan (trung tâm ghi vào ackValue)", () => {
  beforeEach(() => {
    H.fingerprint = "f".repeat(64);
    H.dbCalls = 0;
  });

  it("★ lệnh có uỷ quyền, lô trộn ⇒ failed + reason MOT_PHAN + motPhan; bản ghi sổ (ledger) mang result.motPhan; MỘT lần ghi", async () => {
    driverTron(["speed2"]);
    const j = journal();
    const r = await dispatchOtOnEdge({ ...CMD, idempotencyKey: "foe:9:w1:1", authorization: auth(), run }, runtime(j));
    expect(r).toMatchObject({ ok: false, status: "failed", stop: false, reason: MA_MOT_PHAN, motPhan: { daAp: ["speed"], khongAp: ["speed2"] } });
    expect(H.driver!.writes).toHaveLength(1);
    expect(j.runs).toHaveLength(1);
    expect(j.runs[0]).toMatchObject({ kind: "ledger", status: "failed", result: { reason: MA_MOT_PHAN, motPhan: { daAp: ["speed"], khongAp: ["speed2"] } } });
    expect(H.dbCalls).toBe(0);
  });

  it("STOP ghim, lô trộn ⇒ vẫn nói MOT_PHAN (thông tin; FOE vẫn gửi lại STOP — xem foeKhongGuiLaiMotPhan)", async () => {
    driverTron(["run2"]);
    const j = journal();
    const r = await dispatchOtOnEdge({ adapterId: 5, machineId: 50, commandType: "stop", writes: [{ tagKey: "run", value: false }, { tagKey: "run2", value: false }], idempotencyKey: "abort:9:w1", run }, runtime(j));
    expect(r).toMatchObject({ ok: false, status: "failed", stop: true, pinnedStop: true, reason: MA_MOT_PHAN, motPhan: { daAp: ["run"], khongAp: ["run2"] } });
    expect(j.runs[0]).toMatchObject({ kind: "ledger", stop: true, result: { motPhan: { daAp: ["run"], khongAp: ["run2"] } } });
  });

  it("đối chứng: lô toàn không áp ⇒ failed thường, không reason MOT_PHAN, không motPhan", async () => {
    driverTron(["speed", "speed2"]);
    const j = journal();
    const r = await dispatchOtOnEdge({ ...CMD, idempotencyKey: "foe:9:w1:1", authorization: auth(), run }, runtime(j));
    expect(r.status).toBe("failed");
    expect(r.reason).toBeUndefined();
    expect((r as { motPhan?: unknown }).motPhan).toBeUndefined();
    expect((j.runs[0]!.result as Record<string, unknown>).motPhan).toBeUndefined();
  });
});
