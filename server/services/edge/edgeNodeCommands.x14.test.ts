/**
 * Lô X-14 (main:AGENTS-ngoai-le.md:24; thiết kế buoc3/tam/x14-thiet-ke.md, chữ HST duyệt 17/11) — CA ĐỎ-TRƯỚC-SỬA của lượt quét cảnh báo có hạn
 * `canhBaoStopRunQuaHan` (edgeNodeCommands.ts, chưa có): STOP của một run `aborted` chưa được xác nhận — `:som` (run giao cho nút, còn trong 15 phút, quá hạn
 * xác nhận), `:het` (hết 15 phút, không còn đường nào gửi: run nút, và run TRUNG TÂM chưa chốt), chữ nhẹ khi nút đã ack một yêu cầu STOP cùng adapter
 * (G19). Mỗi mốc MỘT cảnh báo, dấu bền là hàng thông báo (`metadata.dedupKey`), trần 10 run có việc mỗi lượt, ngân sách ~300 truy vấn phân tích.
 * FakeDb (routers/__otFakeDb), không DB, không mạng; đồng hồ là tham số `now`. Mọi ca hành vi là `it.fails` cho tới khi có mã (khuôn X-13).
 * Ca "khuôn" (không fails) kiểm fixture đọc đúng như mã hiện có (phanLoaiStopAbort, laHangAbortChoAnh, chotTuHang): ca hành vi đỏ vì thiếu mã, không vì fixture sai.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { FakeDb } from "../../routers/__otFakeDb";
import { orchestrationRuns, orchestrationRunSteps, notifications, users, edgeNodes } from "../../../drizzle/schema";
import { runEdgeAssignments } from "./edgeExecutionSchema";
import { robotMotionLockRequests } from "./edgeControlSchema";
import { laHangAbortChoAnh } from "./edgeExecutionCentral";
import { phanLoaiStopAbort } from "../orchestration/foe/foeRunStore";
import { KET_CUC_KHONG_RO_CHOT_CTX_KEY, TRAN_TEN_NUT, chotTuHang, idGonCua, loiChuaRaStop, loiLaKetCucKhongRo, runDaChotKhongRo, rutGonGiua } from "../orchestration/foe/foeKetCucKhongRo";
import { ABORT_RESEND_WINDOW_MS } from "@shared/foeAbortResend";

const H = vi.hoisted(() => ({
  alerts: [] as Array<Record<string, any>>,
  /** an alert's inbox row lands at once (the durable marker exists from then on) */
  rowsLand: true,
  /** the inbox read throws (the durable-marker read fails) */
  markerFails: false,
  inbox: [] as Array<Record<string, any>>,
  /** stepId → adapterId the (mocked) analysis resolves */
  adapterOf: new Map<string, number>(),
  analyses: 0,
  /** every write the sweep makes through the fake DB (must stay empty: the sweep only reads) */
  writes: [] as string[],
}));

vi.mock("drizzle-orm", async (orig) => {
  const actual = await orig<typeof import("drizzle-orm")>();
  const ms = (v: unknown) => (v instanceof Date ? v.getTime() : typeof v === "number" ? v : v == null ? NaN : new Date(String(v)).getTime());
  const so = (op: (a: number, b: number) => boolean) => (col: { name: string }, v: unknown) => (row: Record<string, unknown>) => row[col.name] != null && op(ms(row[col.name]), ms(v));
  const fn = (x: unknown) => typeof x === "function";
  return {
    ...actual,
    eq: (col: { name: string }, v: unknown) => (row: Record<string, unknown>) => row[col.name] === v,
    ne: (col: { name: string }, v: unknown) => (row: Record<string, unknown>) => row[col.name] !== v,
    and: (...c: unknown[]) => (row: Record<string, unknown>) => c.filter(fn).every((f) => (f as (r: unknown) => boolean)(row)),
    or: (...c: unknown[]) => (row: Record<string, unknown>) => c.filter(fn).some((f) => (f as (r: unknown) => boolean)(row)),
    inArray: (col: { name: string }, vs: unknown[]) => (row: Record<string, unknown>) => vs.includes(row[col.name]),
    notInArray: (col: { name: string }, vs: unknown[]) => (row: Record<string, unknown>) => !vs.includes(row[col.name]),
    isNull: (col: { name: string }) => (row: Record<string, unknown>) => row[col.name] == null,
    isNotNull: (col: { name: string }) => (row: Record<string, unknown>) => row[col.name] != null,
    like: (col: { name: string }, pat: string) => (row: Record<string, unknown>) => String(row[col.name] ?? "").startsWith(pat.replace(/%$/, "")),
    gt: so((a, b) => a > b),
    gte: so((a, b) => a >= b),
    lt: so((a, b) => a < b),
    lte: so((a, b) => a <= b),
    asc: (col: { name: string }) => ({ name: col.name, dir: "asc" }),
    desc: (col: { name: string }) => ({ name: col.name, dir: "desc" }),
  };
});

const fake = new FakeDb();
vi.mock("../../db/connection", () => ({ getDb: vi.fn(async () => fake) }));
vi.mock("../robot/criticalStopAlert", () => ({
  raiseCriticalStopAlert: vi.fn(async (a: Record<string, any>) => {
    H.alerts.push(a);
    if (!H.rowsLand) return;
    for (const userId of a.recipients ?? []) H.inbox.push({ id: H.inbox.length + 1, userId, type: "ALERT", title: a.title, message: a.message, entityType: a.entityType, entityId: a.entityId, metadata: { kind: a.kind, dedupKey: a.dedupKey }, createdAt: new Date(NOW) });
    fake.seed(notifications, H.inbox);
  }),
}));
vi.mock("./edgeReportsCentral", () => ({ assignedDefinition: vi.fn(async () => DEF_HIEN) }));
vi.mock("./edgeRunAnalysis", () => ({
  loadMachineMap: vi.fn(async () => new Map()),
  analyseDefinition: vi.fn(async () => {
    H.analyses++;
    return { verifiedStops: [], stopsUnsure: [], resolvedAdapters: [...H.adapterOf].map(([stepId, adapterId]) => ({ stepId, adapterId })), robotIds: [], adapterIds: [...H.adapterOf.values()], unresolved: [] };
  }),
}));

// ── the sweep under test (it does not exist yet: read loosely so this file type-checks before the code) ─────────────────────────────────────────
type Quet = (now?: number) => Promise<number>;
async function quet(now: number): Promise<number> {
  const m = (await import("./edgeNodeCommands")) as unknown as Record<string, unknown>;
  const f = m.canhBaoStopRunQuaHan as Quet | undefined;
  if (typeof f !== "function") throw new Error("canhBaoStopRunQuaHan is not exported from edgeNodeCommands.ts (X-14 not written yet)");
  return f(now);
}

// ── fixture ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const NOW = Date.UTC(2026, 10, 17, 12, 0, 0);
const PHUT = 60_000;
/** the defaults (EDGE_PULL_MS 2 s, EDGE_STOP_ACK_SLACK_MS 2 s): ack bound 3 × 2 + 2 = 8 s; early bound max(2 × 8, 8 + 2 × 2) = 16 s (design V3-1) */
const HAN_SOM = 16_000;
const NUT = { id: 3, code: "node-A" };
const ADMIN = 1;
const ADMIN_TAT = 2;
const NUT2 = { id: 4, code: "node-B" };
const OWNER = 7;
let DEF_HIEN: { steps: Array<Record<string, unknown>> } = { steps: [{ id: "s9", type: "command", machineId: 1, command: "stop" }] };

let runs: Array<Record<string, any>> = [];
let asg: Array<Record<string, any>> = [];
let steps: Array<Record<string, any>> = [];
let reqs: Array<Record<string, any>> = [];
function nap(): void {
  fake.seed(orchestrationRuns, runs);
  fake.seed(runEdgeAssignments, asg);
  fake.seed(orchestrationRunSteps, steps);
  fake.seed(robotMotionLockRequests, reqs);
  fake.seed(notifications, H.inbox);
  fake.seed(users, [
    { id: ADMIN, role: "admin", isActive: true },
    { id: OWNER, role: "operator", isActive: true },
    { id: ADMIN_TAT, role: "admin", isActive: false }, // kiem-dinh d15: an inactive admin is never a recipient
  ]);
  fake.seed(edgeNodes, [{ id: NUT.id, code: NUT.code, name: "A", status: "offline" }, { id: NUT2.id, code: NUT2.code, name: "B", status: "offline" }]);
}
/** an aborted run, `truocMs` ago. `nut`: given to the edge node (its assignment row; `claim` = a token and its progress), else central's own. */
function run(id: number, truocMs: number, o: { nut?: boolean; nutId?: number; claim?: { tienDoTruocMs?: number | null; nhanTruocMs?: number }; tienDoTruocMs?: number; ctx?: Record<string, unknown> } = {}): void {
  runs.push({ id, workflowId: 1, status: "aborted", startedBy: OWNER, finishedAt: new Date(NOW - truocMs), contextJson: o.ctx ?? {} });
  if (o.nut)
    asg.push({
      runId: id,
      edgeNodeId: o.nutId ?? NUT.id,
      workflowId: 1,
      workflowVersion: 1,
      defHash: "h",
      claimTokenHash: o.claim ? "a".repeat(64) : null,
      claimedAt: o.claim ? new Date(NOW - (o.claim.nhanTruocMs ?? 60_000)) : null,
      lastProgressAt: o.claim?.tienDoTruocMs != null ? new Date(NOW - o.claim.tienDoTruocMs) : o.tienDoTruocMs != null ? new Date(NOW - o.tienDoTruocMs) : null,
    });
}
/** the `abort:<id>` trace of a STOP the Abort did not get out */
function vet(runId: number, stepId: string, kq: Record<string, unknown>, error: string | null = null): void {
  steps.push({ id: steps.length + 1, runId, stepId: `abort:${stepId}`, stepType: "command", status: "failed", resultJson: { stepId, ...kq }, error });
}
const VET_NUT = { abortStop: "failed" } as const; // a STOP central handed over and could not confirm: the node's to send (laHangAbortChoAnh)
const VET_G1 = { abortStop: "chuaXacMinh" } as const;
const VET_G1P = { abortStop: "chuaXacMinh", adapterNut: true } as const;
const LOI_TU_CHOI = loiChuaRaStop("s9", "abort", { nguon: "tuChoi", ma: "INTERLOCK_NOT_MET" });
const VET_TIMEOUT = { abortStop: "failed", routedTo: "ot-dispatcher", status: "timeout" } as const;
const VET_CHUA_TRA_LOI = { abortStop: "chuaTraLoi" } as const;

const khoa = (runId: number, stepId: string, moc: "som" | "het") => `stop_undelivered:run:${runId}:${stepId}:${moc}`;
const khoaCua = () => H.alerts.map((a) => String(a.dedupKey));

beforeEach(() => {
  vi.resetModules(); // a fresh in-process memory of what was alerted, every case
  H.alerts = [];
  H.inbox = [];
  H.rowsLand = true;
  H.markerFails = false;
  H.adapterOf = new Map();
  H.analyses = 0;
  H.writes = [];
  runs = [];
  asg = [];
  steps = [];
  reqs = [];
  DEF_HIEN = { steps: [{ id: "s9", type: "command", machineId: 1, command: "stop" }] };
  for (const k of ["EDGE_PULL_MS", "EDGE_STOP_ACK_SLACK_MS", "EDGE_CLAIM_STALE_MS"]) delete process.env[k];
});

// the durable-marker read fails, and every write through the fake is recorded (the sweep must make none)
const goc = { select: fake.select.bind(fake), insert: fake.insert.bind(fake), update: fake.update.bind(fake), delete: fake.delete.bind(fake) };
(fake as unknown as { select: unknown }).select = (p?: Record<string, unknown>) => {
  const b = goc.select(p);
  const from = b.from;
  b.from = (t: unknown) => {
    // by the table's NAME: the sweep imports the schema again after vi.resetModules (another object), so `t === notifications` never held (kiem-dinh d7)
    if (H.markerFails && (t as { [k: symbol]: unknown } | null)?.[Symbol.for("drizzle:Name")] === "notifications") throw new Error("inbox unreadable (test)");
    return from(t);
  };
  return b;
};
(fake as unknown as { insert: unknown }).insert = (t: { [k: symbol]: unknown }) => (H.writes.push(`insert ${String(t?.[Symbol.for("drizzle:Name")])}`), goc.insert(t));
(fake as unknown as { update: unknown }).update = (t: { [k: symbol]: unknown }) => (H.writes.push(`update ${String(t?.[Symbol.for("drizzle:Name")])}`), goc.update(t));
(fake as unknown as { delete: unknown }).delete = (t: { [k: symbol]: unknown }) => (H.writes.push(`delete ${String(t?.[Symbol.for("drizzle:Name")])}`), goc.delete(t));

// ── the approved words (tam/x14-thiet-ke.md mục 3, HST 17/11), verbatim ───────────────────────────────────────────────────────────────────────────
const ID = (s: string) => idGonCua(s);
const MA_NUT = (c: string) => rutGonGiua(c, TRAN_TEN_NUT);
const CHU = {
  A: {
    tieuDe: (r: number, s: string, c: string) => `STOP not confirmed yet — run ${r} step ${ID(s)} (edge node ${MA_NUT(c)})`,
    than: (r: number, s: string, c: string, ageS: number, boundS: number, phutConLai: number) =>
      `STOP "${ID(s)}" of aborted run ${r} is NOT confirmed ${ageS} s after it became edge node ${MA_NUT(c)}'s to send (bound ${boundS} s). Central did not send it: its adapter belongs to that node, and central has no connection to it. The node can still send it for about ${phutConLai} more minute(s) (until 15 minutes from when the run was aborted), once it reaches central; it may be offline, or its STOP may have failed (a failed STOP has its own alert). Check the machine on site now and use its direct STOP / E-STOP if it is still running. A further press of Abort at central hands it to that node only if the run records a command whose outcome is unknown.`,
  },
  B: {
    tieuDe: (r: number, s: string, c: string) => `STOP not confirmed on the run — run ${r} step ${ID(s)} (edge node ${MA_NUT(c)})`,
    dau: (r: number, s: string, c: string, ageS: number, yeuCau: number, adapter: number, ackedAt: string) =>
      `The run's STOP "${ID(s)}" (aborted run ${r}) is NOT confirmed on the run ${ageS} s after it became edge node ${MA_NUT(c)}'s to send. Edge node ${MA_NUT(c)} did acknowledge an adapter STOP request #${yeuCau} for the same adapter ${adapter} at ${ackedAt}, after the abort: that STOP request may come from this Abort or from a console / interlock STOP, and its acknowledgement does not say whether it reached the device or was only simulated.`,
    duoiSom: (phutConLai: number) => ` The node can still send the run's STOP for about ${phutConLai} more minute(s). Check the machine on site and use its direct STOP / E-STOP if it is still running.`,
    duoiHet: " Nothing sends the run's STOP on its own any more (the node's re-send window is over). Check the machine on site and use its direct STOP / E-STOP if it is still running.",
  },
  C: {
    tieuDe: (r: number, s: string, c: string) => `STOP not confirmed — run ${r} step ${ID(s)} (edge node ${MA_NUT(c)})`,
    than: (r: number, s: string, c: string) =>
      `STOP "${ID(s)}" of aborted run ${r} was NOT confirmed within 15 minutes from when the run was aborted. Central did not send it: its adapter belongs to edge node ${MA_NUT(c)}, and central has no connection to it. The node did not confirm sending it either: it may be offline, or its STOP may have failed. Nothing sends it on its own any more: the node's re-send window is over. A further press of Abort at central hands it to that node only if the run records a command whose outcome is unknown. Check the machine on site and use its direct STOP / E-STOP.`,
  },
  E: {
    tieuDe: (r: number, s: string) => `STOP not sent — run ${r} step ${ID(s)}`,
    than: (r: number, s: string) =>
      `STOP "${ID(s)}" of aborted run ${r} was NOT sent: central could not confirm the connection to its adapter at the Abort, and no press since sent it. Nothing sends it any more: 15 minutes from when the run was aborted have passed, and nothing sends it on its own when the connection comes back. Check the machine on site and use its direct STOP / E-STOP.`,
  },
  F: {
    tieuDe: (r: number, s: string) => `Step not sent — run ${r} step ${ID(s)}`,
    than: (r: number, s: string) =>
      `Step "${ID(s)}" of aborted run ${r} was NOT sent: its pins could not be read at the Abort, so it could not be verified as a pinned STOP, and no press since sent it. Nothing sends it any more: 15 minutes from when the run was aborted have passed. Check the machine on site and use its direct STOP / E-STOP.`,
  },
  G1: {
    than: (r: number, s: string) =>
      `STOP "${ID(s)}" of aborted run ${r} was refused when the Abort handed it over, so it was NOT sent, and no press since sent it. Nothing sends it any more: 15 minutes from when the run was aborted have passed. Check the machine on site and use its direct STOP / E-STOP.`,
  },
  G2: {
    than: (r: number, s: string) =>
      `STOP "${ID(s)}" of aborted run ${r} got an error or no answer when the Abort handed it over: it may or may not have reached the device, and no press since sent it again. Nothing sends it any more: 15 minutes from when the run was aborted have passed. Check the machine on site and use its direct STOP / E-STOP.`,
  },
};
const motCanhBao = (dedupKey: string) => {
  const ds = H.alerts.filter((a) => a.dedupKey === dedupKey);
  expect(ds.length, `exactly one alert under ${dedupKey}`).toBe(1);
  return ds[0]!;
};

// ── khuôn: the fixtures read as the code already reads them (green now; they keep the behaviour cases honest) ────────────────────────────────────
describe("X-14 khuôn — the fixtures, read by the code that exists", () => {
  it("X14-KHUON the node's trace (laHangAbortChoAnh), the three central shapes (phanLoaiStopAbort), the latch from the context and from the rows (chotTuHang)", () => {
    const hang = (kq: Record<string, unknown>, error: string | null = null) => [{ stepId: "abort:s9", status: "failed", resultJson: { stepId: "s9", ...kq }, error }];
    expect(laHangAbortChoAnh(hang(VET_NUT)[0]!, true), "a failed hand-over: the node's").toBe(true);
    expect(laHangAbortChoAnh(hang(VET_G1P)[0]!, true), "a flagged trace, no claim: the node's").toBe(true);
    expect(laHangAbortChoAnh(hang(VET_G1)[0]!, true), "an unflagged trace: central's own").toBe(false);
    const p = (h: ReturnType<typeof hang>) => phanLoaiStopAbort("s9", { hang: h, ctx: {} });
    const coThe = (x: { lop: string; truoc?: string }) => x.lop === "coTheDaRa" || x.truoc === "coTheDaRa";
    expect(coThe(p(hang({ abortStop: "failed" }, LOI_TU_CHOI))), "shape 1, refused before a driver: [G1]").toBe(false);
    expect(coThe(p(hang(VET_TIMEOUT))), "shape 2, a timeout: [G2]").toBe(true);
    expect(coThe(p(hang(VET_CHUA_TRA_LOI))), "shape 3, no answer: [G2]").toBe(true);
    expect(runDaChotKhongRo({ [KET_CUC_KHONG_RO_CHOT_CTX_KEY]: { at: "x" } }), "latched by the context").toBe(true);
    const loi = "FOE_OUTCOME_UNKNOWN: command x: no answer (test)";
    expect(loiLaKetCucKhongRo(loi), "the row-latch fixture carries the code").toBe(true);
    expect(chotTuHang([{ stepId: "x", error: loi }]), "latched by the rows").not.toBeNull();
  });
});

// ── the behaviour (red before the code) ─────────────────────────────────────────────────────────────────────────────────────────────────────────
describe("X-14 — the timed STOP alert sweep (canhBaoStopRunQuaHan)", () => {
  // 1 — which traces
  it("X14-1-CHON-VET node run: a failed hand-over and a flagged trace are the node's (:som); an unflagged trace is not the node's; a trace whose STOP's own row completed is not (a1)", async () => {
    run(41, 20_000, { nut: true });
    vet(41, "s9", VET_NUT);
    vet(41, "s8", VET_G1P);
    vet(41, "s7", VET_G1);
    vet(41, "s6", VET_NUT);
    steps.push({ id: 99, runId: 41, stepId: "s6", stepType: "command", status: "completed", resultJson: { routedTo: "edge", accepted: true }, error: null });
    vet(41, "s5", VET_NUT); // kiem-dinh s2: its own row COMPENSATED counts as gone too (the picture's prior.completed, EC:376-379)
    steps.push({ id: 98, runId: 41, stepId: "s5", stepType: "command", status: "compensated", resultJson: { routedTo: "edge", accepted: true }, error: null });
    nap();
    await quet(NOW);
    expect(khoaCua().sort()).toEqual([khoa(41, "s8", "som"), khoa(41, "s9", "som")].sort());
  });
  // 2 — the early mark m4
  it("X14-2-MOC-M4 :som at max(finishedAt, lastProgressAt) + 16 s with no claim: 15 s ⇒ none, 16 s + 1 ms ⇒ one; a fresh claim ⇒ none; a stale claim ⇒ from finishedAt", async () => {
    run(41, 60_000, { nut: true, tienDoTruocMs: 15_000 }); // m4 = 15 s ago
    vet(41, "s9", VET_NUT);
    run(42, 60_000, { nut: true, tienDoTruocMs: HAN_SOM + 1 }); // m4 = 16 s + 1 ms ago
    vet(42, "s9", VET_NUT);
    run(43, 60_000, { nut: true, claim: { tienDoTruocMs: 5_000 } }); // walking, fresh: its walker sweeps
    vet(43, "s9", VET_NUT);
    run(44, 60_000, { nut: true, claim: { tienDoTruocMs: 31_000 } }); // stale (30 s): the node does not progress
    vet(44, "s9", VET_NUT);
    run(45, 60_000, { nut: true, claim: { tienDoTruocMs: null, nhanTruocMs: 5_000 } }); // kiem-dinh s13: just claimed, no progress yet: fresh by claimedAt
    vet(45, "s9", VET_NUT);
    nap();
    await quet(NOW);
    expect(khoaCua().sort()).toEqual([khoa(42, "s9", "som"), khoa(44, "s9", "som")].sort());
    // kiem-dinh s6: a stale claim's mark is finishedAt (60 s), never its last progress (31 s): the words say 60 s
    expect(String(motCanhBao(khoa(44, "s9", "som")).message)).toBe(CHU.A.than(44, "s9", NUT.code, 60, 16, Math.ceil((ABORT_RESEND_WINDOW_MS - 60_000) / PHUT)));
  });
  it("X14-2B-PHUT-CON-LAI <minutesLeft> = ceil(left / 60 000), never 0 or less: 1 ms ⇒ 1, 60 000 ⇒ 1, 60 001 ⇒ 2; 0 left ⇒ no :som; the words [A] to the character", async () => {
    run(51, ABORT_RESEND_WINDOW_MS - 1, { nut: true });
    vet(51, "s9", VET_NUT);
    run(52, ABORT_RESEND_WINDOW_MS - PHUT, { nut: true });
    vet(52, "s9", VET_NUT);
    run(53, ABORT_RESEND_WINDOW_MS - PHUT - 1, { nut: true });
    vet(53, "s9", VET_NUT);
    run(54, ABORT_RESEND_WINDOW_MS, { nut: true });
    vet(54, "s9", VET_NUT);
    nap();
    await quet(NOW);
    const age = (truoc: number) => Math.round(truoc / 1000);
    expect(String(motCanhBao(khoa(51, "s9", "som")).message)).toBe(CHU.A.than(51, "s9", NUT.code, age(ABORT_RESEND_WINDOW_MS - 1), 16, 1));
    expect(String(motCanhBao(khoa(52, "s9", "som")).message)).toBe(CHU.A.than(52, "s9", NUT.code, age(ABORT_RESEND_WINDOW_MS - PHUT), 16, 1));
    expect(String(motCanhBao(khoa(53, "s9", "som")).message)).toBe(CHU.A.than(53, "s9", NUT.code, age(ABORT_RESEND_WINDOW_MS - PHUT - 1), 16, 2));
    expect(String(motCanhBao(khoa(53, "s9", "som")).title)).toBe(CHU.A.tieuDe(53, "s9", NUT.code));
    expect(khoaCua().filter((k) => k.startsWith("stop_undelivered:run:54:")), "0 left: neither :som nor (not past 15 min) :het").toEqual([]);
  });
  // 3 — the 15-minute mark
  it("X14-3-MOC-HET :het past 15 minutes: exactly 15 min ⇒ none, 15 min + 1 ms ⇒ one ([C] to the character), 15 min + 24 h + 1 ms ⇒ none", async () => {
    run(61, ABORT_RESEND_WINDOW_MS, { nut: true });
    vet(61, "s9", VET_NUT);
    run(62, ABORT_RESEND_WINDOW_MS + 1, { nut: true });
    vet(62, "s9", VET_NUT);
    run(63, ABORT_RESEND_WINDOW_MS + 24 * 3_600_000 + 1, { nut: true });
    vet(63, "s9", VET_NUT);
    nap();
    await quet(NOW);
    expect(khoaCua()).toEqual([khoa(62, "s9", "het")]);
    const a = motCanhBao(khoa(62, "s9", "het"));
    expect(String(a.title)).toBe(CHU.C.tieuDe(62, "s9", NUT.code));
    expect(String(a.message)).toBe(CHU.C.than(62, "s9", NUT.code));
    expect({ kind: a.kind, entityType: a.entityType, entityId: a.entityId, khuTrungBenVung: a.khuTrungBenVung, retryUntilPersisted: a.retryUntilPersisted }, "kiem-dinh d11: retried until its inbox row lands").toEqual({ kind: "stop_undelivered", entityType: "orchestration_run", entityId: 62, khuTrungBenVung: {}, retryUntilPersisted: { everyMs: 30_000, attempts: 20 } });
    expect([...(a.recipients ?? [])].sort(), "the run's owner and the active admins").toEqual([ADMIN, OWNER].sort());
  });
  // 4 — the durable marker
  it("X14-4-DAU-BEN two passes ⇒ one alert per key; the inbox row never lands ⇒ still one (the process memory); the marker read fails ⇒ still alerted", async () => {
    run(71, 20_000, { nut: true });
    vet(71, "s9", VET_NUT);
    nap();
    await quet(NOW);
    await quet(NOW + 2_000);
    expect(khoaCua()).toEqual([khoa(71, "s9", "som")]);
    H.alerts = [];
    H.inbox = [];
    H.rowsLand = false;
    vi.resetModules();
    nap();
    await quet(NOW);
    await quet(NOW + 2_000);
    expect(khoaCua(), "no inbox row: the process memory bridges").toEqual([khoa(71, "s9", "som")]);
    H.alerts = [];
    H.markerFails = true;
    vi.resetModules();
    nap();
    const loi = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await quet(NOW);
      expect(loi.mock.calls.flat().join(" "), "the marker read REALLY failed (its branch was reached, kiem-dinh d7)").toMatch(/durable-marker read failed/);
    } finally {
      loi.mockRestore();
    }
    expect(khoaCua(), "the marker read failed: never silent").toEqual([khoa(71, "s9", "som")]);
  });
  // 4B (scada-master 17/11, đột biến X14-M3-DAU sống) — the marker is the inbox row, not this process's memory: a restart never alerts a key again
  it("X14-4B-DAU-BEN-KHOI-DONG-LAI a restart (a fresh process memory) reads the inbox rows: a key alerted before is not alerted again", async () => {
    run(72, 20_000, { nut: true });
    vet(72, "s9", VET_NUT);
    nap();
    await quet(NOW);
    expect(khoaCua()).toEqual([khoa(72, "s9", "som")]);
    H.alerts = [];
    vi.resetModules(); // the process restarts: its memory is gone, the inbox row stays
    nap();
    await quet(NOW + 2_000);
    expect(khoaCua(), "the durable marker, not the memory").toEqual([]);
  });
  // 5 — two marks
  it("X14-5-HAI-MOC :som then :het of the same (run, step): two alerts, two keys; :het alone when :som never fired (the first pass past 15 min)", async () => {
    run(81, 20_000, { nut: true });
    vet(81, "s9", VET_NUT);
    run(82, ABORT_RESEND_WINDOW_MS + 5_000, { nut: true });
    vet(82, "s9", VET_NUT);
    nap();
    await quet(NOW);
    await quet(NOW + ABORT_RESEND_WINDOW_MS);
    expect(khoaCua().sort()).toEqual([khoa(81, "s9", "som"), khoa(81, "s9", "het"), khoa(82, "s9", "het")].sort());
  });
  // 6 — the lighter words (G19)
  it("X14-6-CHU-NHE the node acknowledged a STOP request for the same adapter after the abort ⇒ still alerted, words [B] with the request; before the abort, failed, central's, unresolved ⇒ [A]", async () => {
    const ack = new Date(NOW - 10_000);
    run(91, 20_000, { nut: true });
    vet(91, "s9", VET_NUT);
    const GOC = { id: 7001, kind: "stop", adapterId: 501, edgeNodeId: NUT.id, outcome: "done", ackedAt: ack, centralExecutionId: null, carriedToId: null, createdAt: ack, requestedBy: OWNER } as const;
    reqs.push({ ...GOC });
    H.adapterOf.set("s9", 501);
    nap();
    await quet(NOW);
    const a = motCanhBao(khoa(91, "s9", "som"));
    expect(String(a.title)).toBe(CHU.B.tieuDe(91, "s9", NUT.code));
    expect(String(a.message)).toBe(CHU.B.dau(91, "s9", NUT.code, 20, 7001, 501, ack.toISOString()) + CHU.B.duoiSom(Math.ceil((ABORT_RESEND_WINDOW_MS - 20_000) / PHUT)));
    // kiem-dinh n2–n5, n7, n9 (17/11): each variant from the SAME base (before: each one inherited the previous one's change — "failed" and "central's ack" were read
    // with an ack before the abort, so they proved nothing)
    for (const [ten, sua] of [
      ["ack before the abort", { ackedAt: new Date(NOW - 30_000), createdAt: new Date(NOW - 30_000) }],
      ["failed (n3)", { outcome: "failed" }],
      ["central's ack (n4)", { centralExecutionId: 5 }],
      ["not a STOP request: a lock (n2)", { kind: "lock" }],
      ["carried to another request, not the chain head (n5)", { carriedToId: 7999 }],
      ["queued before the abort, acknowledged after (n7)", { createdAt: new Date(NOW - 30_000) }],
      ["another adapter (n9)", { adapterId: 777 }],
    ] as const) {
      H.alerts = [];
      H.inbox = [];
      vi.resetModules();
      reqs = [{ ...GOC, ...sua }];
      nap();
      await quet(NOW);
      expect(String(motCanhBao(khoa(91, "s9", "som")).title), ten).toBe(CHU.A.tieuDe(91, "s9", NUT.code));
    }
    H.alerts = [];
    H.inbox = [];
    vi.resetModules();
    reqs = [{ ...GOC }];
    H.adapterOf = new Map();
    nap();
    await quet(NOW);
    expect(String(motCanhBao(khoa(91, "s9", "som")).title), "the adapter not resolved: the usual words").toBe(CHU.A.tieuDe(91, "s9", NUT.code));
  });
  it("X14-6B-CHU-NHE-HET the lighter words past 15 minutes: [B]'s opening, then the :het ending [D]", async () => {
    const ack = new Date(NOW - ABORT_RESEND_WINDOW_MS);
    run(92, ABORT_RESEND_WINDOW_MS + 5_000, { nut: true });
    vet(92, "s9", VET_NUT);
    reqs.push({ id: 7002, kind: "stop", adapterId: 501, edgeNodeId: NUT.id, outcome: "done", ackedAt: ack, centralExecutionId: null, carriedToId: null, createdAt: ack, requestedBy: OWNER });
    H.adapterOf.set("s9", 501);
    nap();
    await quet(NOW);
    const a = motCanhBao(khoa(92, "s9", "het"));
    expect(String(a.title)).toBe(CHU.B.tieuDe(92, "s9", NUT.code));
    expect(String(a.message)).toBe(CHU.B.dau(92, "s9", NUT.code, Math.round((ABORT_RESEND_WINDOW_MS + 5_000) / 1000), 7002, 501, ack.toISOString()) + CHU.B.duoiHet);
  });
  // 6C (kiem-dinh n8, n10, w2; 17/11) — whose request, which one, and for which words
  it("X14-6C-CHU-NHE-AI another node's acknowledged request never lightens this node's run (n8); of two, the NEWEST acknowledgement is named (n10); the light words are never [F]'s (w2)", async () => {
    const cu = new Date(NOW - 15_000);
    const moi = new Date(NOW - 5_000);
    run(301, 20_000, { nut: true });
    vet(301, "s9", VET_NUT);
    run(302, 20_000, { nut: true, nutId: NUT2.id });
    vet(302, "s8", VET_NUT);
    H.adapterOf.set("s9", 501).set("s8", 601);
    reqs.push({ id: 8001, kind: "stop", adapterId: 501, edgeNodeId: NUT2.id, outcome: "done", ackedAt: moi, centralExecutionId: null, carriedToId: null, createdAt: moi, requestedBy: OWNER }); // node B, run 301's adapter
    reqs.push({ id: 8002, kind: "stop", adapterId: 601, edgeNodeId: NUT2.id, outcome: "done", ackedAt: cu, centralExecutionId: null, carriedToId: null, createdAt: cu, requestedBy: OWNER });
    reqs.push({ id: 8003, kind: "stop", adapterId: 601, edgeNodeId: NUT2.id, outcome: "done", ackedAt: moi, centralExecutionId: null, carriedToId: null, createdAt: moi, requestedBy: OWNER });
    nap();
    await quet(NOW);
    expect(String(motCanhBao(khoa(301, "s9", "som")).title), "node A's run: node B's request says nothing of it").toBe(CHU.A.tieuDe(301, "s9", NUT.code));
    expect(String(motCanhBao(khoa(302, "s8", "som")).message), "the newest acknowledgement").toBe(CHU.B.dau(302, "s8", NUT2.code, 20, 8003, 601, moi.toISOString()) + CHU.B.duoiSom(Math.ceil((ABORT_RESEND_WINDOW_MS - 20_000) / PHUT)));
    // w2 — a node run, not latched, past 15 min, an UNFLAGGED trace (central's own) whose adapter the node acknowledged: still [F], never the light words
    H.alerts = [];
    H.inbox = [];
    vi.resetModules();
    runs = [];
    asg = [];
    steps = [];
    run(303, ABORT_RESEND_WINDOW_MS + 5_000, { nut: true });
    vet(303, "s9", VET_G1);
    const ack = new Date(NOW - ABORT_RESEND_WINDOW_MS);
    reqs = [{ id: 8004, kind: "stop", adapterId: 501, edgeNodeId: NUT.id, outcome: "done", ackedAt: ack, centralExecutionId: null, carriedToId: null, createdAt: ack, requestedBy: OWNER }];
    nap();
    await quet(NOW);
    const f = motCanhBao(khoa(303, "s9", "het"));
    expect([String(f.title), String(f.message)]).toEqual([CHU.F.tieuDe(303, "s9"), CHU.F.than(303, "s9")]);
  });
  // 7 — central runs, latched
  it("X14-7-TRUNG-TAM-CHOT a central run latched (by its context, or by its rows) gets no :het ([E]/[F]/[G] say 'Nothing sends it any more': a press still sends it there)", async () => {
    run(101, ABORT_RESEND_WINDOW_MS + 5_000, { ctx: { [KET_CUC_KHONG_RO_CHOT_CTX_KEY]: { at: "x" } } });
    vet(101, "s9", VET_G1P);
    run(102, ABORT_RESEND_WINDOW_MS + 5_000);
    vet(102, "s9", VET_G1);
    steps.push({ id: 98, runId: 102, stepId: "x", stepType: "command", status: "failed", resultJson: null, error: "FOE_OUTCOME_UNKNOWN: command x: no answer (test)" });
    run(103, ABORT_RESEND_WINDOW_MS + 5_000); // the control: not latched
    vet(103, "s9", VET_G1);
    nap();
    await quet(NOW);
    expect(khoaCua()).toEqual([khoa(103, "s9", "het")]);
  });
  it("X14-7B-TRUNG-TAM-CHU central run not latched, past 15 min: a flagged trace ⇒ [E], an unflagged one ⇒ [F] (title 'Step not sent'), to the character; never a :som", async () => {
    run(111, ABORT_RESEND_WINDOW_MS + 5_000);
    vet(111, "s9", VET_G1P);
    run(112, ABORT_RESEND_WINDOW_MS + 5_000);
    vet(112, "s9", VET_G1);
    run(113, 20_000); // in the window: central's own trace has no early mark
    vet(113, "s9", VET_G1);
    nap();
    await quet(NOW);
    expect(khoaCua().sort()).toEqual([khoa(111, "s9", "het"), khoa(112, "s9", "het")].sort());
    expect([String(motCanhBao(khoa(111, "s9", "het")).title), String(motCanhBao(khoa(111, "s9", "het")).message)]).toEqual([CHU.E.tieuDe(111, "s9"), CHU.E.than(111, "s9")]);
    expect([String(motCanhBao(khoa(112, "s9", "het")).title), String(motCanhBao(khoa(112, "s9", "het")).message)]).toEqual([CHU.F.tieuDe(112, "s9"), CHU.F.than(112, "s9")]);
  });
  // 8 — no starvation
  it("X14-8A-KHONG-BO-DOI 11 runs due: pass 1 alerts the 10 aborted first, pass 2 the 11th, and nothing twice", async () => {
    for (let i = 0; i < 11; i++) {
      run(200 + i, ABORT_RESEND_WINDOW_MS + 60_000 - i * 1_000, { nut: true }); // run 200 aborted first
      vet(200 + i, "s9", VET_NUT);
    }
    nap();
    await quet(NOW);
    expect(khoaCua().sort()).toEqual(Array.from({ length: 10 }, (_, i) => khoa(200 + i, "s9", "het")).sort());
    await quet(NOW + 2_000);
    expect(khoaCua().length).toBe(11);
    expect(khoaCua()[10]).toBe(khoa(210, "s9", "het"));
  });
  it("X14-8B-KHONG-BO-DOI-KHONG-DAU the same with no inbox row ever landing: pass 2 still alerts the 11th, nothing twice", async () => {
    H.rowsLand = false;
    for (let i = 0; i < 11; i++) {
      run(220 + i, ABORT_RESEND_WINDOW_MS + 60_000 - i * 1_000, { nut: true });
      vet(220 + i, "s9", VET_NUT);
    }
    nap();
    await quet(NOW);
    await quet(NOW + 2_000);
    expect(khoaCua().length).toBe(11);
    expect(new Set(khoaCua()).size).toBe(11);
  });
  it("X14-8C-NGAN-SACH the analysis budget (~300 queries, 3 + k a run) spent: every run is still alerted, the later ones with the usual words", async () => {
    DEF_HIEN = { steps: Array.from({ length: 150 }, (_, i) => ({ id: i === 0 ? "s9" : `m${i}`, type: "command", machineId: 1, command: "stop" })) }; // k = 150 ⇒ 153 a run
    H.adapterOf.set("s9", 501);
    for (const id of [231, 232]) {
      run(id, 20_000 + (id - 231), { nut: true });
      vet(id, "s9", VET_NUT);
    }
    const ack = new Date(NOW - 10_000);
    reqs.push({ id: 7003, kind: "stop", adapterId: 501, edgeNodeId: NUT.id, outcome: "done", ackedAt: ack, centralExecutionId: null, carriedToId: null, createdAt: ack, requestedBy: OWNER });
    nap();
    await quet(NOW);
    expect(khoaCua().sort()).toEqual([khoa(231, "s9", "som"), khoa(232, "s9", "som")].sort());
    expect(H.analyses, "one analysis fits the budget, the second does not").toBe(1);
    const tieuDe = [231, 232].map((r) => String(motCanhBao(khoa(r, "s9", "som")).title));
    expect(tieuDe.filter((t) => t.startsWith("STOP not confirmed on the run")).length, "one with the lighter words").toBe(1);
    expect(tieuDe.filter((t) => t.startsWith("STOP not confirmed yet")).length, "one with the usual words").toBe(1);
  });
  // 9 — G17
  it("X14-9-G17 a node run latched after the press (its context), its flagged trace still failed: :som and :het are both raised, words [A] / [C]", async () => {
    run(241, 20_000, { nut: true, ctx: { [KET_CUC_KHONG_RO_CHOT_CTX_KEY]: { at: "x" } } });
    vet(241, "s9", VET_G1P);
    nap();
    await quet(NOW);
    await quet(NOW + ABORT_RESEND_WINDOW_MS);
    expect(String(motCanhBao(khoa(241, "s9", "som")).title)).toBe(CHU.A.tieuDe(241, "s9", NUT.code));
    expect(String(motCanhBao(khoa(241, "s9", "het")).message)).toBe(CHU.C.than(241, "s9", NUT.code));
  });
  // 10 — the lengths (G22)
  it("X14-10-DO-DAI every title ≤ 200 and every body ≤ 800 with a 200-character step id, runId 2 147 483 647, a 128-character node code, the largest request / adapter ids", async () => {
    const DAI = "s".repeat(200);
    const R = 2_147_483_647;
    const ack = new Date(NOW - 10_000);
    runs.push({ id: R, workflowId: 1, status: "aborted", startedBy: OWNER, finishedAt: new Date(NOW - 20_000), contextJson: {} });
    asg.push({ runId: R, edgeNodeId: 9, workflowId: 1, workflowVersion: 1, defHash: "h", claimTokenHash: null, claimedAt: null, lastProgressAt: null });
    vet(R, DAI, VET_NUT);
    vet(R, `${DAI}x`, VET_NUT);
    reqs.push({ id: 2_147_483_646, kind: "stop", adapterId: 2_147_483_645, edgeNodeId: 9, outcome: "done", ackedAt: ack, centralExecutionId: null, carriedToId: null, createdAt: ack, requestedBy: OWNER });
    H.adapterOf.set(DAI, 2_147_483_645);
    for (const [id, kq] of [[R - 1, VET_G1P], [R - 2, VET_G1], [R - 3, VET_TIMEOUT]] as const) {
      runs.push({ id, workflowId: 1, status: "aborted", startedBy: OWNER, finishedAt: new Date(NOW - ABORT_RESEND_WINDOW_MS - 5_000), contextJson: {} });
      vet(id, DAI, kq);
    }
    nap();
    fake.seed(edgeNodes, [{ id: 9, code: "n".repeat(128), name: "long", status: "offline" }]);
    await quet(NOW);
    await quet(NOW + ABORT_RESEND_WINDOW_MS);
    expect(H.alerts.length, "[A] [B] then [C] [D] of the node run, [E] [F] [G2] of the central ones").toBeGreaterThanOrEqual(7);
    for (const a of H.alerts) {
      expect(String(a.title).length, `${a.dedupKey}: title ≤ 200 (notifications.title is varchar(255), G22)`).toBeLessThanOrEqual(200);
      expect(String(a.message).length, `${a.dedupKey}: body ≤ 800`).toBeLessThanOrEqual(800);
      expect(String(a.dedupKey), "the key keeps the whole id").toMatch(new RegExp(`^stop_undelivered:run:\\d+:${DAI}x?:(som|het)$`));
    }
  });
  // 11 — reads only
  it("X14-11-CHI-DOC the sweep writes nothing through the database (no insert / update / delete): its only effects are the alerts", async () => {
    run(251, 20_000, { nut: true });
    vet(251, "s9", VET_NUT);
    run(252, ABORT_RESEND_WINDOW_MS + 5_000);
    vet(252, "s9", VET_G1);
    nap();
    H.writes = [];
    const n = await quet(NOW);
    expect(n, "two alerts raised").toBe(2);
    expect(H.writes).toEqual([]);
  });
  // 16 — G1 on a run given to the node (HST 17/11: gồm vào X-14): an unflagged `chuaXacMinh` trace is central's own, the node never sends it (laHangAbortChoAnh), central's window
  // is over ⇒ [F] at :het, under the same "not latched when swept" rule as a central run; never also [C]/[D] for the same step
  it("X14-16-G1-NUT a node run NOT latched, an unflagged chuaXacMinh trace, past 15 min: exactly one [F] at :het (no [C]/[D] for that step); the same run latched: none", async () => {
    run(281, ABORT_RESEND_WINDOW_MS + 5_000, { nut: true });
    vet(281, "s9", VET_G1);
    run(282, ABORT_RESEND_WINDOW_MS + 5_000, { nut: true, ctx: { [KET_CUC_KHONG_RO_CHOT_CTX_KEY]: { at: "x" } } });
    vet(282, "s9", VET_G1);
    nap();
    await quet(NOW);
    await quet(NOW + 2_000);
    expect(khoaCua(), "one key, of the not-latched run only").toEqual([khoa(281, "s9", "het")]);
    const a = motCanhBao(khoa(281, "s9", "het"));
    expect([String(a.title), String(a.message)]).toEqual([CHU.F.tieuDe(281, "s9"), CHU.F.than(281, "s9")]);
    expect(H.alerts.filter((x) => /^STOP not confirmed/.test(String(x.title))), "never [C]/[D] for it").toEqual([]);
  });
  // 17 (kiem-dinh s39, 17/11) — only ABORTED runs: a run that ended failed or completed with an `abort:` trace (an Abort that met a run already ended, daKetThuc)
  // is told by that Abort's own words and URGENT, never by this sweep
  it("X14-17-CHI-ABORTED a run whose status is not 'aborted' is never swept, whatever its traces", async () => {
    run(311, 20_000, { nut: true });
    vet(311, "s9", VET_NUT);
    runs[runs.length - 1]!.status = "failed";
    run(312, ABORT_RESEND_WINDOW_MS + 5_000);
    vet(312, "s9", VET_G1);
    runs[runs.length - 1]!.status = "completed";
    nap();
    await quet(NOW);
    expect(khoaCua()).toEqual([]);
  });
  // 13 — refused STOPs of a central run (HST 17/11 câu 2)
  it("X14-13A-TU-CHOI-CHOT-KHONG-HET a central run LATCHED whose STOP was refused (its URGENT 'chot' was the press's): no :het", async () => {
    run(261, ABORT_RESEND_WINDOW_MS + 5_000, { ctx: { [KET_CUC_KHONG_RO_CHOT_CTX_KEY]: { at: "x" } } });
    vet(261, "s9", { abortStop: "failed" }, LOI_TU_CHOI);
    nap();
    await quet(NOW);
    expect(khoaCua()).toEqual([]);
  });
  it("X14-13B-TU-CHOI-CHUA-CHOT a central run NOT latched whose STOP was refused: exactly one :het, no other key of that STOP", async () => {
    run(262, ABORT_RESEND_WINDOW_MS + 5_000);
    vet(262, "s9", { abortStop: "failed" }, LOI_TU_CHOI);
    nap();
    await quet(NOW);
    await quet(NOW + 2_000);
    expect(khoaCua()).toEqual([khoa(262, "s9", "het")]);
  });
  // 15 — [G1] / [G2] by the shape (phanLoaiStopAbort), never by reading the error text
  it("X14-15A-G1 shape 1 (refused before a driver) ⇒ [G1] to the character", async () => {
    run(271, ABORT_RESEND_WINDOW_MS + 5_000);
    vet(271, "s9", { abortStop: "failed" }, LOI_TU_CHOI);
    nap();
    await quet(NOW);
    const a = motCanhBao(khoa(271, "s9", "het"));
    expect([String(a.title), String(a.message)]).toEqual([CHU.E.tieuDe(271, "s9"), CHU.G1.than(271, "s9")]);
  });
  it("X14-15B-G2-LOI shape 2 (a timeout) ⇒ [G2] to the character", async () => {
    run(272, ABORT_RESEND_WINDOW_MS + 5_000);
    vet(272, "s9", VET_TIMEOUT);
    nap();
    await quet(NOW);
    const a = motCanhBao(khoa(272, "s9", "het"));
    expect([String(a.title), String(a.message)]).toEqual([CHU.E.tieuDe(272, "s9"), CHU.G2.than(272, "s9")]);
  });
  it("X14-15C-G2-CHUA-TRA-LOI shape 3 (no answer: a chuaTraLoi trace) ⇒ [G2] to the character", async () => {
    run(273, ABORT_RESEND_WINDOW_MS + 5_000);
    vet(273, "s9", VET_CHUA_TRA_LOI);
    nap();
    await quet(NOW);
    const a = motCanhBao(khoa(273, "s9", "het"));
    expect([String(a.title), String(a.message)]).toEqual([CHU.E.tieuDe(273, "s9"), CHU.G2.than(273, "s9")]);
  });
});

// 14 — the reads-only shape of the code (AST; kiem-dinh's census style)
describe("X-14 — the sweep's source: no dispatcher, no driver, no write of another table", () => {
  it("X14-14-AST the body of canhBaoStopRunQuaHan calls none of insert / update / delete / execute / dispatch / dispatchRobotJob / enqueueEdgeDeviceRequest / stopTarget / sendCommand / abortRun / resendAbortStops / abortStopSweep / sendNotification / createNotification", () => {
    const src = readFileSync(resolve(__dirname, "edgeNodeCommands.ts"), "utf8");
    const sf = ts.createSourceFile("edgeNodeCommands.ts", src, ts.ScriptTarget.Latest, true);
    let than: ts.Node | null = null;
    sf.forEachChild((n) => {
      if (ts.isFunctionDeclaration(n) && n.name?.text === "canhBaoStopRunQuaHan") than = n;
    });
    expect(than, "canhBaoStopRunQuaHan is declared in edgeNodeCommands.ts").not.toBeNull();
    const CAM = new Set(["insert", "update", "delete", "execute", "dispatch", "dispatchRobotJob", "enqueueEdgeDeviceRequest", "stopTarget", "sendCommand", "abortRun", "resendAbortStops", "abortStopSweep", "sendNotification", "createNotification"]);
    const goi: string[] = [];
    const di = (n: ts.Node): void => {
      if (ts.isCallExpression(n)) {
        const e = n.expression;
        const ten = ts.isIdentifier(e) ? e.text : ts.isPropertyAccessExpression(e) ? e.name.text : "";
        if (CAM.has(ten)) goi.push(ten);
      }
      // kiem-dinh 17/11: `d["insert"](…)` and `const { insert } = d` are the same call by another spelling
      if (ts.isElementAccessExpression(n) && ts.isStringLiteralLike(n.argumentExpression) && CAM.has(n.argumentExpression.text)) goi.push(`[${n.argumentExpression.text}]`);
      if (ts.isBindingElement(n)) for (const x of [n.propertyName, n.name]) if (x && ts.isIdentifier(x) && CAM.has(x.text)) goi.push(`{${x.text}}`);
      n.forEachChild(di);
    };
    di(than!);
    expect(goi).toEqual([]);
  });
});
