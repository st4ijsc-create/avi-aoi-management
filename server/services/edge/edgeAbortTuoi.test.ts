/**
 * X-EDGE-ABORT-TUOI (EDGE-ABORT-TRE-KHONG-HAN) — the age of central's abort, read in ONE way. Pure: no DB, no network, no real clock (every clock is
 * passed in). Covers: the one moment (mocTuChoiMs / mocAbortMs), its age on one clock (tuoiAbortMs, trongCuaAbort: never Math.abs), the node's ONE
 * decision re-reckoned at each call (quyetAbortCu, Q2), the exact-token header (Q7 d), the heldReason on the wire (edgeHeldWireReason, EDGE-ABORT-HELD-NHAN-LUI),
 * the head of a withheld sweep (tomTatStop: the hash of the FULL list), and the census of the R-6-d window and of the words' start (Q1, N1, mocChu).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  ABORT_RESEND_WINDOW_MS,
  FOE_REJECT_CLAIM_AT_CTX_KEY,
  FOE_REJECT_CLAIM_KEY,
  mocAbortMs,
  mocTuChoiMs,
  quyetAbortCu,
  trongCuaAbort,
  tuoiAbortMs,
} from "@shared/foeAbortResend";
import { FOE_REJECT_CLAIM_CTX_KEY } from "../orchestration/foe/foeGateApproval";
import { packageContext } from "./edgeExecutionCentral";
import { MOC_CUA_SO, MOC_CUA_SO_TU_CHOI, mocChu } from "../orchestration/foe/foeKetCucKhongRo";
import {
  EDGE_ACCEPTS_HELD_ABORT_STOPS_WITHHELD,
  EDGE_CENTRAL_ACCEPTS,
  EDGE_HELD_REASONS,
  EDGE_NODE_ACCEPTS_ANSWER_ABORT_AGE,
  EDGE_NODE_ACCEPTS_HEADER,
  bam8DanhSachStop,
  edgeCompleteRequestSchema,
  edgeHeldWireReason,
  edgeNodeAcceptsHeaderValue,
  nodeAccepts,
  tomTatStop,
} from "./edgeProtocol";

const T0 = 1_800_000_000_000; // a fixed epoch-ms (no real clock)
const CUA = 15 * 60_000; // the R-6-d window, by its definition (shared/foeAbortResend.ts: 15 minutes)
const coKhoa = (at: unknown) => ({ [FOE_REJECT_CLAIM_KEY]: "tok", [FOE_REJECT_CLAIM_AT_CTX_KEY]: at });

describe("X-EDGE-ABORT-TUOI — the one moment of an abort (mocTuChoiMs / mocAbortMs)", () => {
  it("★ TUOI-KHOA — the shared key is the server's FOE_REJECT_CLAIM_CTX_KEY, letter for letter; the window is 15 minutes", () => {
    expect(FOE_REJECT_CLAIM_KEY, "TUOI-KHOA: the rejection claim key").toBe(FOE_REJECT_CLAIM_CTX_KEY);
    expect(FOE_REJECT_CLAIM_AT_CTX_KEY, "TUOI-KHOA: the stamp key").toBe("foeRejectClaimAt");
    expect(ABORT_RESEND_WINDOW_MS, "TUOI-KHOA: the window").toBe(CUA);
  });

  it("★ TUOI-MOC — the rejection's stamp wins in EVERY status, over a later finishedAt; finishedAt only for 'aborted'; else null", () => {
    expect(mocAbortMs({ status: "aborted", finishedAt: new Date(T0 + 20 * 60_000), contextJson: coKhoa(T0) }), "TUOI-MOC: aborted after a hung hook").toBe(T0);
    expect(mocAbortMs({ status: "compensating", finishedAt: null, contextJson: coKhoa(T0) }), "TUOI-MOC: compensating").toBe(T0);
    expect(mocAbortMs({ status: "failed", finishedAt: null, contextJson: coKhoa(T0) }), "TUOI-MOC: failed after boot").toBe(T0);
    expect(mocAbortMs({ status: "aborted", finishedAt: new Date(T0), contextJson: {} }), "TUOI-MOC: plain abort").toBe(T0);
    expect(mocAbortMs({ status: "aborted", finishedAt: new Date(T0).toISOString(), contextJson: null }), "TUOI-MOC: string finishedAt").toBe(T0);
    expect(mocAbortMs({ status: "running", finishedAt: new Date(T0), contextJson: {} }), "TUOI-MOC: not aborted").toBeNull();
    expect(mocAbortMs({ status: "aborted", finishedAt: null, contextJson: {} }), "TUOI-MOC: aborted, no time (v1 sync)").toBeNull();
    expect(mocAbortMs({ status: "aborted", finishedAt: "not a date", contextJson: {} }), "TUOI-MOC: unparsable").toBeNull();
  });

  it("★ TUOI-MOC-TIEM — a stamp WITHOUT the claim key (a v1 payload) is never a moment; a stamp that is no finite number neither", () => {
    expect(mocTuChoiMs({ contextJson: { [FOE_REJECT_CLAIM_AT_CTX_KEY]: T0 } }), "TUOI-MOC-TIEM: stamp alone").toBeNull();
    expect(mocAbortMs({ status: "aborted", finishedAt: new Date(T0 + 1), contextJson: { [FOE_REJECT_CLAIM_AT_CTX_KEY]: T0 } }), "TUOI-MOC-TIEM: falls back to finishedAt").toBe(T0 + 1);
    expect(mocTuChoiMs({ contextJson: coKhoa(String(T0)) }), "TUOI-MOC-TIEM: a string stamp").toBeNull();
    expect(mocTuChoiMs({ contextJson: coKhoa(Number.NaN) }), "TUOI-MOC-TIEM: NaN").toBeNull();
    expect(mocTuChoiMs({ contextJson: coKhoa(T0) }), "TUOI-MOC-TIEM: key + stamp").toBe(T0);
  });
});

describe("X-EDGE-ABORT-TUOI — the age on ONE clock (tuoiAbortMs / trongCuaAbort)", () => {
  const run = { status: "aborted", finishedAt: new Date(T0), contextJson: {} };
  it("★ TUOI-CUA — inside ⇔ 0 ≤ age ≤ 15 min; 15 min + 1 ms is outside; a NEGATIVE age (the wall clock went back) is unknown, never inside (no Math.abs)", () => {
    expect(tuoiAbortMs(run, T0 + 1_234), "TUOI-CUA: the age").toBe(1_234);
    expect(trongCuaAbort(run, T0 + CUA), "TUOI-CUA: at the bound").toBe(true);
    expect(trongCuaAbort(run, T0 + CUA + 1), "TUOI-CUA: one ms past").toBe(false);
    expect(tuoiAbortMs(run, T0 - 1), "TUOI-CUA: negative").toBeNull();
    expect(trongCuaAbort(run, T0 - 1), "TUOI-CUA: negative is not inside").toBe(false);
    expect(trongCuaAbort({ status: "aborted", finishedAt: null, contextJson: {} }, T0), "TUOI-CUA: unknown moment").toBe(false);
    expect(tuoiAbortMs(run, Number.NaN), "TUOI-CUA: NaN clock").toBeNull();
  });
});

describe("X-EDGE-ABORT-TUOI — the node's ONE decision (quyetAbortCu, Q2: re-reckoned at each call, monotonic clock passed in)", () => {
  it("★ TUOI-QUYET — absent ⇒ trungTamCu; null / −1 / NaN ⇒ refusedNoTime; within ⇒ quet; 15 min + 1 ms ⇒ refusedTooOld", () => {
    const m = () => 500;
    expect(quyetAbortCu(undefined), "TUOI-QUYET: absent").toEqual({ quyet: "trungTamCu", tuoi: null });
    expect(quyetAbortCu({ abortAgeMs: null, guiLuc: 500, monoNow: m }).quyet, "TUOI-QUYET: null").toBe("refusedNoTime");
    expect(quyetAbortCu({ abortAgeMs: -1, guiLuc: 500, monoNow: m }).quyet, "TUOI-QUYET: negative").toBe("refusedNoTime");
    expect(quyetAbortCu({ abortAgeMs: Number.NaN, guiLuc: 500, monoNow: m }).quyet, "TUOI-QUYET: NaN").toBe("refusedNoTime");
    expect(quyetAbortCu({ abortAgeMs: 60_000, guiLuc: 500, monoNow: m }), "TUOI-QUYET: one minute").toEqual({ quyet: "quet", tuoi: 60_000 });
    expect(quyetAbortCu({ abortAgeMs: CUA + 1, guiLuc: 500, monoNow: m }), "TUOI-QUYET: past").toEqual({ quyet: "refusedTooOld", tuoi: CUA + 1 });
  });

  it("★ TUOI-Q2 — received at 14 min, decided 2 min later on the node's monotonic clock ⇒ refusedTooOld (the age is never a stored number)", () => {
    let mono = 10_000;
    const nhan = { abortAgeMs: 14 * 60_000, guiLuc: 10_000, monoNow: () => mono };
    expect(quyetAbortCu(nhan).quyet, "TUOI-Q2: at once").toBe("quet");
    mono += 2 * 60_000;
    expect(quyetAbortCu(nhan), "TUOI-Q2: two minutes later").toEqual({ quyet: "refusedTooOld", tuoi: 16 * 60_000 });
  });
});

describe("X-EDGE-ABORT-TUOI — the protocol pieces (Q7, the held reason on the wire, the head of a withheld sweep)", () => {
  it("★ TUOI-TOKEN — exact tokens only: a longer token, a prefix or the raw string never count; spaces around a token do", () => {
    expect(EDGE_NODE_ACCEPTS_HEADER, "TUOI-TOKEN: header").toBe("x-edge-node-accepts");
    expect(edgeNodeAcceptsHeaderValue(), "TUOI-TOKEN: the node's value").toBe("answer.abort_age");
    expect(nodeAccepts(" answer.abort_age , x.y ", EDGE_NODE_ACCEPTS_ANSWER_ABORT_AGE), "TUOI-TOKEN: spaced").toBe(true);
    expect(nodeAccepts("answer.abort_agex", EDGE_NODE_ACCEPTS_ANSWER_ABORT_AGE), "TUOI-TOKEN: longer").toBe(false);
    expect(nodeAccepts("answer.abort", EDGE_NODE_ACCEPTS_ANSWER_ABORT_AGE), "TUOI-TOKEN: prefix").toBe(false);
    expect(nodeAccepts("xanswer.abort_age", EDGE_NODE_ACCEPTS_ANSWER_ABORT_AGE), "TUOI-TOKEN: suffix inside").toBe(false);
    expect(nodeAccepts(undefined, EDGE_NODE_ACCEPTS_ANSWER_ABORT_AGE), "TUOI-TOKEN: absent").toBe(false);
  });

  it("★ TUOI-HELD-DAY — abortStopsWithheld goes on the wire only to a central advertising its token and only before a 400 for it; else the baseline centralUnreachable", () => {
    expect(EDGE_HELD_REASONS, "TUOI-HELD-DAY: the reason").toContain("abortStopsWithheld");
    expect(EDGE_CENTRAL_ACCEPTS, "TUOI-HELD-DAY: central advertises").toContain(EDGE_ACCEPTS_HELD_ABORT_STOPS_WITHHELD);
    const co = (t: string) => t === EDGE_ACCEPTS_HELD_ABORT_STOPS_WITHHELD;
    expect(edgeHeldWireReason("abortStopsWithheld", co), "TUOI-HELD-DAY: with the token").toBe("abortStopsWithheld");
    expect(edgeHeldWireReason("abortStopsWithheld", () => false), "TUOI-HELD-DAY: an old central").toBe("centralUnreachable");
    expect(edgeHeldWireReason("abortStopsWithheld", co, true), "TUOI-HELD-DAY: after a 400").toBe("centralUnreachable");
    expect(edgeHeldWireReason("journalFull", () => false, true), "TUOI-HELD-DAY: any other reason untouched").toBe("journalFull");
  });

  it("★ TUOI-HELD-SCHEMA — central's complete schema takes BOTH abortStopsWithheld and the baseline centralUnreachable (an old central takes the baseline: TUOI-HELD-DAY)", () => {
    const ket = (heldReason: string) =>
      edgeCompleteRequestSchema.safeParse({ claimSeq: 1, claimToken: "ect_" + "a".repeat(43), seq: 1, outcome: "held", heldReason, epoch: "0".repeat(32), reportedThrough: 0 }).success;
    expect([ket("abortStopsWithheld"), ket("centralUnreachable"), ket("abortStopsWithheldX")], "TUOI-HELD-SCHEMA").toEqual([true, true, false]);
  });

  it("★ TUOI-GOI — (bản 3 C-e) the run context shipped in a package never carries the rejection's claim NOR its stamp; every other key goes as it is", () => {
    expect(packageContext({ k: 1, n: { a: [1, 2] }, [FOE_REJECT_CLAIM_CTX_KEY]: "rc_goi", [FOE_REJECT_CLAIM_AT_CTX_KEY]: T0 }), "TUOI-GOI").toEqual({ k: 1, n: { a: [1, 2] } });
    expect(packageContext(null), "TUOI-GOI: no context").toEqual({});
  });

  it("★ TUOI-BAM — the head names k and the hash of the FULL sorted list (order-free); '?' when the plan could not be built", () => {
    const ds = Array.from({ length: 60 }, (_, i) => `stop-${String(i).padStart(3, "0")}@adapter ${i}`);
    expect(tomTatStop(ds), "TUOI-BAM: the head").toBe(`stops=60 hash=${bam8DanhSachStop(ds)}`);
    expect(bam8DanhSachStop([...ds].reverse()), "TUOI-BAM: order-free").toBe(bam8DanhSachStop(ds));
    expect(bam8DanhSachStop(ds), "TUOI-BAM: 8 hex").toMatch(/^[0-9a-f]{8}$/);
    expect(bam8DanhSachStop(ds.slice(0, 59)), "TUOI-BAM: one STOP fewer, another hash").not.toBe(bam8DanhSachStop(ds));
    expect(tomTatStop("?"), "TUOI-BAM: no plan").toBe(`stops=? hash=${bam8DanhSachStop("?")}`);
  });
});

describe("X-EDGE-ABORT-TUOI — the words' start of the window (mocChu) and the census", () => {
  it("★ TUOI-MOC-CHU — a plain run keeps the old words byte for byte; a run with a rejection claim gets the long words", () => {
    expect(mocChu(), "TUOI-MOC-CHU: default").toBe("when the run was aborted");
    expect(mocChu(false), "TUOI-MOC-CHU: plain").toBe(MOC_CUA_SO);
    expect(mocChu(true), "TUOI-MOC-CHU: rejected").toBe("when the run was aborted, or when it was first rejected if it was");
    expect(MOC_CUA_SO_TU_CHOI, "TUOI-MOC-CHU: the long words").toBe(mocChu(true));
  });

  const goc = path.join(__dirname, "../../..");
  const doc = (rel: string) => readFileSync(path.join(goc, rel), "utf8").replace(/\r\n/g, "\n");
  const SAN_PHAM = [
    "server/services/edge/edgeExecutionAgent.ts",
    "server/services/orchestration/foe/foeEngine.ts",
    "server/services/edge/edgeExecutionCentral.ts",
    "server/services/edge/edgeAuthorizeCentral.ts",
    "server/services/edge/edgeNodeCommands.ts",
    "server/services/edge/edgeReportsCentral.ts",
    "client/src/pages/OrchestrationStudio.tsx",
    "server/services/orchestration/foe/foeKetCucKhongRo.ts",
  ];

  it("★ TUOI-CENSUS-CUA — every R-6-d window decision goes through the ONE moment: abortResendAllowed( only at the picture re-send (two clocks, E: abortedAt ?? picture.issuedAt); no window number of its own", () => {
    const goi: string[] = [];
    for (const f of SAN_PHAM) {
      const s = doc(f);
      for (const m of s.matchAll(/abortResendAllowed\(([^)]*)\)/g)) goi.push(`${f}: ${m[1]}`);
      expect(/15\s*\*\s*60_000|900_000|900000/.test(s), `TUOI-CENSUS-CUA: a window number in ${f}`).toBe(false);
    }
    expect(goi, "TUOI-CENSUS-CUA: the only direct call").toEqual(["server/services/orchestration/foe/foeEngine.ts: abortedAt ?? picture.issuedAt"]);
    expect(doc("server/services/edge/edgeExecutionCentral.ts"), "TUOI-CENSUS-CUA: stopsUnconfirmed").toContain("trongCuaAbort({ status: \"aborted\", finishedAt: x.finishedAt, contextJson: x.contextJson }, now)");
    expect(doc("server/services/orchestration/foe/foeEngine.ts"), "TUOI-CENSUS-CUA: the press at central").toContain("const trongCua = trongCuaAbort(run);");
    expect(doc("client/src/pages/OrchestrationStudio.tsx"), "TUOI-CENSUS-CUA: the Studio").toContain("!trongCuaAbort({ status, finishedAt: run.finishedAt as string | Date | null | undefined, contextJson: run.contextJson })");
  });

  it("★ TUOI-CENSUS-CHU — no product site inserts MOC_CUA_SO itself: only mocChu does; and X-14 no longer writes 'when the run was aborted'", () => {
    for (const f of SAN_PHAM) {
      const s = doc(f);
      expect((s.match(/\$\{MOC_CUA_SO\}/g) ?? []).length, `TUOI-CENSUS-CHU: \${MOC_CUA_SO} in ${f}`).toBe(0);
    }
    expect((doc("server/services/edge/edgeNodeCommands.ts").match(/when the run was aborted/g) ?? []).length, "TUOI-CENSUS-CHU: X-14").toBe(0);
    // code lines only (a JSDoc / line comment may name the constant): the definition and mocChu's own return
    const maKR = doc("server/services/orchestration/foe/foeKetCucKhongRo.ts").split("\n").filter((l) => !/^\s*(\*|\/\*|\/\/)/.test(l)).join("\n");
    expect((maKR.match(/\bMOC_CUA_SO\b(?!_)/g) ?? []).length, "TUOI-CENSUS-CHU: KR — the definition + mocChu").toBe(2);
  });
});
