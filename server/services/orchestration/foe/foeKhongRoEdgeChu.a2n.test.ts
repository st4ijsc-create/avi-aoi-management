// kiem-dinh 14/11 — ca tạm đo: chữ EDGE_OUTCOME_UNKNOWN(a,b,…) bị ganBaoCaoKhongRoEdge cắt vào trong dấu ngoặc ⇒ edgeOutcomeUnknownOf đọc 0 id.
// Đặt cạnh server/services/orchestration/foe/ để chạy (import tương đối). Hàm thật, không DB. Chưa phải ca nghiệm thu: ghi kỳ vọng sau khi 3e sửa.
// Đo trên 2500736bc: (25 id × 110 ký tự, 5 báo cáo) ⇒ đọc 0/25; (30, 110, 5) ⇒ 0/30; (30, 110, 1) ⇒ 30/30; (30, 110, 0) ⇒ 30/30; (10, 100, 5) ⇒ 10/10.
import { it } from "vitest";
import { ganBaoCaoKhongRoEdge, tachBaoCaoKhongRoEdge } from "./foeKetCucKhongRo";
import { edgeOutcomeUnknownOf } from "./foeRunStore";
// T9 lượt sửa 3e — the cases below the kiem-dinh case are this round's (pure: no DB, no clock)
import { describe, expect } from "vitest";
import type { WorkflowDefinition } from "./workflowModel";
import type { BaoCaoKhongRoEdge } from "./foeKetCucKhongRo";
import { tapKhongRoEdge } from "./foeRunStore";

it("kd cut", () => {
  for (const [nIds, lenId, nBao] of [[10, 100, 5], [25, 110, 5], [30, 110, 5], [30, 110, 1], [30, 110, 0], [8, 128, 8]] as const) {
    const ids = Array.from({ length: nIds }, (_, i) => `cmd-${i}-`.padEnd(lenId, "x"));
    const err = `EDGE_OUTCOME_UNKNOWN(${ids.join(",")}): sent, but the result could not be recorded (journal: refused) — never sent again; the run is held.`;
    const bao = Array.from({ length: nBao }, (_, i) => ({ loai: "held", stepId: `s${i}`.padEnd(100, "y"), compId: `c${i}`.padEnd(100, "z"), ma: "EDGE_OUTCOME_UNKNOWN", claimSeq: 1 })) as never[];
    const wire = ganBaoCaoKhongRoEdge(err.slice(0, 4000), bao, 4000);
    const { error } = tachBaoCaoKhongRoEdge(wire);
    const def = { steps: ids.map((id) => ({ id, type: "command" })) } as never;
    const got = edgeOutcomeUnknownOf({ error, def } as never);
    // T9 lượt sửa 3e — the measure becomes the expectation (kiem-dinh's note): every id read, or fail-closed on EVERY command step of the definition (here the same set). Never 0 read and passed over
    expect([...got].sort(), JSON.stringify({ nIds, lenId, nBao, errGoc: Math.min(err.length, 4000), wireLen: wire?.length, errSauTach: error?.length })).toEqual([...ids].sort());
  }
});

// ── T9 lượt sửa 3e ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** the edge's own words (edgeRunStore.segmentEndGoc), clipped as it clips them */
const chuEdge = (ids: readonly string[]) =>
  `EDGE_OUTCOME_UNKNOWN(${ids.join(",")}): sent, but the result could not be recorded (journal: journal_full) — never sent again; the run is held.`.slice(0, 4000);
const baoCua = (n: number): BaoCaoKhongRoEdge[] =>
  Array.from({ length: n }, (_, i) => ({ loai: "held", stepId: `s${i}`.padEnd(100, "y"), compId: `c${i}`.padEnd(100, "z"), ma: "EDGE_OUTCOME_UNKNOWN", claimSeq: 2 }) as BaoCaoKhongRoEdge);
const idsCua = (n: number, len: number) => Array.from({ length: n }, (_, i) => `m${i}-`.padEnd(len, "q"));
const lenhDef = (ids: readonly string[]): WorkflowDefinition => ({ ref: "d", name: "d", steps: ids.map((id) => ({ id, type: "command", machineId: 2, command: "run_job" })) }) as never;

describe("T9 lượt sửa 3e — the edge never cuts inside the list of its outcome-unknown steps (ganBaoCaoKhongRoEdge)", () => {
  const LUOI: Array<[number, number, number]> = [[10, 100, 5], [25, 110, 5], [30, 110, 5], [30, 110, 1], [30, 110, 0], [8, 128, 8], [32, 128, 0], [30, 128, 0], [3, 20, 2]];
  it("T9F3E-EDGE-KHONG-CAT-GIUA every (ids, length, reports): the wire is under 4 000, every report rides, and the list is WHOLE or the empty list (never half of it)", () => {
    for (const [n, len, nBao] of LUOI) {
      const ids = idsCua(n, len);
      const wire = ganBaoCaoKhongRoEdge(chuEdge(ids), baoCua(nBao), 4000)!;
      const t = tachBaoCaoKhongRoEdge(wire);
      const nhan = JSON.stringify({ n, len, nBao, wire: wire.length });
      expect(wire.length, nhan).toBeLessThan(4000);
      expect(t.bao, nhan).toHaveLength(nBao);
      const nguyen = t.error!.startsWith(`EDGE_OUTCOME_UNKNOWN(${ids.join(",")}): sent, but the result could not be recorded`);
      // the empty list: with the node's words after it, or alone (the edge's own clip at 4 000 had already cut the list: T9F3E-EDGE-TRAN)
      const rong = t.error === "EDGE_OUTCOME_UNKNOWN()" || t.error!.startsWith("EDGE_OUTCOME_UNKNOWN(): sent, but the result could not be recorded");
      expect(nguyen || rong, nhan).toBe(true);
      // what fits whole with its rider is sent whole (e.g. 30 × 128 alone: 3 869; 8 × 128 + 8 reports), with a margin on the sizes
      if (n * (len + 1) + 21 + 46 + JSON.stringify(baoCua(nBao)).length + 9 < 3999) expect(nguyen, nhan).toBe(true);
    }
  });
  it("T9F3E-EDGE-TRAN the list alone is over the budget (35 × 128, the edge clipped it at 4 000): the EMPTY list goes, never a cut one; central reads it unreadable ⇒ every command step", () => {
    const ids = idsCua(35, 128);
    const goc = chuEdge(ids);
    expect(goc.length).toBe(4000);
    const wire = ganBaoCaoKhongRoEdge(goc, baoCua(1), 4000)!;
    const t = tachBaoCaoKhongRoEdge(wire);
    expect(t.error).toBe("EDGE_OUTCOME_UNKNOWN()");
    expect(t.bao).toHaveLength(1);
    expect([...edgeOutcomeUnknownOf({ error: t.error, def: lenhDef(ids) })].sort()).toEqual([...ids].sort());
  });
  it("T9F3E-EDGE-CHU-DUNG a text that fits (and any text that is not the list) is what it was: the text, then the rider", () => {
    const rider = (b: BaoCaoKhongRoEdge[]) => ` [[A2N:${JSON.stringify(b)}]]`;
    const ngan = chuEdge(["r1", "r2"]);
    expect(ganBaoCaoKhongRoEdge(ngan, baoCua(2), 4000)).toBe(`${ngan}${rider(baoCua(2))}`);
    expect(ganBaoCaoKhongRoEdge(undefined, [], 4000)).toBe(" [[A2N:[]]]");
    const dai = `EDGE_HELD(journalFull): ${"x".repeat(5000)}`;
    expect(ganBaoCaoKhongRoEdge(dai, baoCua(1), 4000)).toBe(`${dai.slice(0, 4000 - rider(baoCua(1)).length)}${rider(baoCua(1))}`);
    // a rider too long for the ceiling: the reports that fit, MARKED short (never a cut JSON, never one that looks whole), the text whole
    const w = ganBaoCaoKhongRoEdge(ngan, baoCua(20), 4000)!;
    const t20 = tachBaoCaoKhongRoEdge(w);
    expect(w.length).toBeLessThan(4000);
    expect(t20.error).toBe(ngan);
    expect(t20.thieu).toBe(true);
    expect(t20.bao.length).toBeGreaterThan(0);
    expect(t20.bao).toEqual(baoCua(20).slice(0, t20.bao.length));
    expect(tachBaoCaoKhongRoEdge(`${ngan}${rider(baoCua(2))}`).thieu, "a whole rider is never read short").toBeUndefined();
  });
  it("T9F3E-SAN a rider of 3 960 – 4 000 characters (every (id length, reports) that makes one): the text's head is never cut — the prefix and the code central reads stay whole; the rider gives way, marked", () => {
    const CHU = [
      `FOE_STOP_NOT_SENT: STOP "stop-1" did NOT go out (attempt 1): `.padEnd(95, "."),
      'EDGE_HELD(centralUnreachable): EDGE_UNUSED_NOT_REPORTED: command step "x" was not sent — no authorisation could be obtained from central.',
      "EDGE_HELD(journalFull): EDGE_CONSUME_OVERRUN: a step authorisation could not be recorded in time on the edge disk (x); that step was not sent.",
      `EDGE_OUTCOME_UNKNOWN(a,b)${": sent, but the result could not be recorded (journal: journal_full) — never sent again; the run is held."}`,
    ];
    const rider = (b: BaoCaoKhongRoEdge[]) => ` [[A2N:${JSON.stringify(b)}]]`;
    const bao = (len: number, n: number): BaoCaoKhongRoEdge[] => Array.from({ length: n }, (_, i) => ({ loai: "stopNotSent", stepId: `s${i}`.padEnd(len, "x"), compId: "-", ma: "FOE_OUTCOME_UNKNOWN", claimSeq: 1 }) as BaoCaoKhongRoEdge);
    let cauHinh = 0;
    for (let len = 2; len <= 128; len++) {
      for (let n = 1; n <= 120; n++) {
        const b = bao(len, n);
        const r = rider(b).length;
        if (r < 3960 || r > 4000) continue;
        cauHinh++;
        for (const chu of CHU) {
          const w = ganBaoCaoKhongRoEdge(chu, b, 4000)!;
          const t = tachBaoCaoKhongRoEdge(w);
          const nhan = JSON.stringify({ len, n, rider: r, dau: chu.slice(0, 24) });
          expect(w.length, nhan).toBeLessThanOrEqual(4000);
          expect(t.error!.slice(0, 56), nhan).toBe(chu.slice(0, 56));
          expect(t.thieu, nhan).toBe(true);
          expect(t.bao, nhan).toEqual(b.slice(0, t.bao.length));
        }
      }
    }
    expect(cauHinh, "configurations measured").toBeGreaterThanOrEqual(27);
  });
});

describe("T9 lượt sửa 3e — central's set of outcome-unknown steps of an edge segment end (tapKhongRoEdge): the rows and the ledger first, the text only adds; unreadable ⇒ every step that may have gone", () => {
  // a, b sent (authorised, no result: running); c held before it asked (no authorisation); st a STOP (L-7, never unknown); xong completed; hong failed (final)
  const def = lenhDef(["a", "b", "c", "st", "xong", "hong"]);
  const rows = [
    { stepId: "a", status: "running", resultJson: null },
    { stepId: "b", status: "running", resultJson: null },
    { stepId: "c", status: "held", resultJson: null, error: 'EDGE_HELD(journalFull): command step "c" was not sent' },
    { stepId: "st", status: "running", resultJson: null },
    { stepId: "xong", status: "completed", resultJson: { routedTo: "robot" } },
    { stepId: "hong", status: "failed", resultJson: { routedTo: "robot" }, error: "device said no" },
  ];
  const uyQuyen = new Set(["a", "b", "xong", "hong"]);
  const stops = new Set(["st"]);
  const DUOI = ": sent, but the result could not be recorded (journal: journal_full) — never sent again; the run is held.";
  const tap = (error: string | undefined, them: Partial<Parameters<typeof tapKhongRoEdge>[0]> = {}) => {
    const r = tapKhongRoEdge({ def, error, rows, uyQuyen, stops, ...them });
    return { ids: [...r.ids].sort(), hong: r.hong };
  };
  const MOI_BUOC_CO_THE_DA_DI = ["a", "b", "c"];

  it("T9F3E-TAP-CHU-DUNG the text read whole and covering the sent steps: exactly them — a completed / failed step, a step held before it asked, a STOP: none", () => {
    expect(tap(`EDGE_OUTCOME_UNKNOWN(a,b)${DUOI}`)).toEqual({ ids: ["a", "b"], hong: false });
  });
  it("T9F3E-TAP-CAU-TRUC the text lost (the held words, no list): the rows and the ledger say it", () => {
    expect(tap('command step "a" outcome unknown — machine state unknown — compensation "k" is held')).toEqual({ ids: ["a", "b"], hong: false });
    expect(tap(undefined)).toEqual({ ids: ["a", "b"], hong: false });
  });
  it("T9F3E-TAP-HOP a step the text names is never dropped by the rows (a failed row the text calls unknown): the UNION", () => {
    expect(tap(`EDGE_OUTCOME_UNKNOWN(a,b,hong)${DUOI}`)).toEqual({ ids: ["a", "b", "hong"], hong: false });
  });
  it("T9F3E-TAP-THIEU-NGOAC the list opened and never closed (cut): every step that may have gone", () => {
    expect(tap("EDGE_OUTCOME_UNKNOWN(a,b")).toEqual({ ids: MOI_BUOC_CO_THE_DA_DI, hong: true });
  });
  it("T9F3E-TAP-RONG the empty list: every step that may have gone", () => {
    expect(tap(`EDGE_OUTCOME_UNKNOWN()${DUOI}`)).toEqual({ ids: MOI_BUOC_CO_THE_DA_DI, hong: true });
    expect(tap("EDGE_OUTCOME_UNKNOWN()")).toEqual({ ids: MOI_BUOC_CO_THE_DA_DI, hong: true });
  });
  it("T9F3E-TAP-ID-CAT-NGOAC-GIA the last id cut, a ')' of the words after it: every step that may have gone", () => {
    const d2 = lenhDef(["a", "bbbb"]);
    const r2 = [{ stepId: "a", status: "running" }, { stepId: "bbbb", status: "running" }];
    for (const loi of [`EDGE_OUTCOME_UNKNOWN(a,bb${DUOI}`, "EDGE_OUTCOME_UNKNOWN(a,bb) the device said (x)"]) {
      const r = tapKhongRoEdge({ def: d2, error: loi, rows: r2, uyQuyen: new Set(["a"]), stops: new Set() });
      expect({ ids: [...r.ids].sort(), hong: r.hong }, loi).toEqual({ ids: ["a", "bbbb"], hong: true });
    }
  });
  it("T9F3E-TAP-4000 a wire text of 4 000 characters or more was cut: every step that may have gone, even if the list reads", () => {
    expect(tap(`EDGE_OUTCOME_UNKNOWN(a,b)${DUOI}`, { catDay: true })).toEqual({ ids: MOI_BUOC_CO_THE_DA_DI, hong: true });
  });
  it("T9F3E-TAP-NGOAI-DEF an id not of the definition: every step that may have gone", () => {
    expect(tap(`EDGE_OUTCOME_UNKNOWN(a,b,zz)${DUOI}`)).toEqual({ ids: MOI_BUOC_CO_THE_DA_DI, hong: true });
  });
  it("T9F3E-TAP-THIEU-BUOC-DA-GUI the list read but it does not cover a step the ledger says was sent: every step that may have gone", () => {
    expect(tap(`EDGE_OUTCOME_UNKNOWN(a)${DUOI}`)).toEqual({ ids: MOI_BUOC_CO_THE_DA_DI, hong: true });
  });
  it("T9F3E-TAP-ID-PHAY an id with a ',' (workflowModel does not forbid it): the split names no step ⇒ every step that may have gone, the whole id among them", () => {
    const d2 = lenhDef(["a,b", "c"]);
    const r2 = [{ stepId: "a,b", status: "running" }, { stepId: "c", status: "running" }];
    const r = tapKhongRoEdge({ def: d2, error: `EDGE_OUTCOME_UNKNOWN(a,b)${DUOI}`, rows: r2, uyQuyen: new Set(["a,b"]), stops: new Set() });
    expect({ ids: [...r.ids].sort(), hong: r.hong }).toEqual({ ids: ["a,b", "c"], hong: true });
  });
  it("T9F3E-TAP-ID-NGOAC an id with a ')' is read whole (the list ends where the edge's words go on, not at the first ')')", () => {
    const d2 = lenhDef(["x)y", "z"]);
    expect(edgeOutcomeUnknownOf({ error: `EDGE_OUTCOME_UNKNOWN(x)y)${DUOI}`, def: d2 })).toEqual(["x)y"]);
    const r = tapKhongRoEdge({ def: d2, error: `EDGE_OUTCOME_UNKNOWN(x)y)${DUOI}`, rows: [{ stepId: "x)y", status: "running" }, { stepId: "z", status: "completed" }], uyQuyen: new Set(["x)y"]), stops: new Set() });
    expect(r).toEqual({ ids: ["x)y"], hong: false });
  });
  it("T9F3E-TAP-THIEU a rider marked short (reports dropped for the text's floor): not read whole ⇒ every step that may have gone, even with the list read", () => {
    expect(tap(`EDGE_OUTCOME_UNKNOWN(a,b)${DUOI}`, { thieu: true })).toEqual({ ids: MOI_BUOC_CO_THE_DA_DI, hong: true });
    expect(tap(undefined, { thieu: true })).toEqual({ ids: MOI_BUOC_CO_THE_DA_DI, hong: true });
  });
  it("T9F3E-TAP-SO-LOI the ledger could not be read: every step that may have gone, whatever the text says", () => {
    expect(tap(`EDGE_OUTCOME_UNKNOWN(a,b)${DUOI}`, { uyQuyen: null })).toEqual({ ids: MOI_BUOC_CO_THE_DA_DI, hong: true });
    expect(tap(undefined, { uyQuyen: null })).toEqual({ ids: MOI_BUOC_CO_THE_DA_DI, hong: true });
  });
  it("T9F3E-TAP-STOP (L-7) a STOP is never unknown: not when the text names it, not when the text is unreadable", () => {
    expect(tap(`EDGE_OUTCOME_UNKNOWN(a,b,st)${DUOI}`).ids).not.toContain("st");
    expect(tap("EDGE_OUTCOME_UNKNOWN(a,st").ids).not.toContain("st");
    expect(tap(undefined, { uyQuyen: null }).ids).not.toContain("st");
  });
  it("T9F3E-TAP-FINAL a step whose row is final (completed / failed / compensated / skipped) is never pulled in by the rows, even unreadable: nobody confirms a finished step by hand", () => {
    for (const loi of ["EDGE_OUTCOME_UNKNOWN(a", `EDGE_OUTCOME_UNKNOWN()${DUOI}`, undefined]) {
      for (const so of [uyQuyen, null]) {
        const r = tap(loi, { uyQuyen: so });
        expect(r.ids, String(loi)).not.toContain("xong");
        expect(r.ids, String(loi)).not.toContain("hong");
      }
    }
    // a step with no row never began (its "running" record precedes any send): not in the set
    const d2 = lenhDef(["a", "chuaDi"]);
    expect(tapKhongRoEdge({ def: d2, error: "EDGE_OUTCOME_UNKNOWN(", rows: [{ stepId: "a", status: "running" }], uyQuyen: null, stops: new Set() }).ids).toEqual(["a"]);
  });
  it("T9F3E-TAP-CAU-TRUC-CO-SAN an in-process end carries the list itself (outcomeUnknown): it is the text's part, the rows still add", () => {
    expect(tap("anything", { outcomeUnknown: ["a"] })).toEqual({ ids: ["a", "b"], hong: false });
    expect(tap("anything", { outcomeUnknown: ["hong", "zz"] })).toEqual({ ids: ["a", "b", "hong"], hong: false });
  });
});

describe("T9 lượt sửa 3e (A1-13) — a row with no door's code proves nothing unsent (xacNhanHetChot)", () => {
  it("T9F3E-A113-XN a latched run whose latch is confirmed: a command row held / running with no door's code still needs its URGENT (it may have gone); a finished one does not", async () => {
    const { xacNhanHetChot, KET_CUC_KHONG_RO_XAC_NHAN_CTX_KEY } = await import("./foeKetCucKhongRo");
    const ctx = { [KET_CUC_KHONG_RO_XAC_NHAN_CTX_KEY]: { x: { at: "2026-11-14T00:00:00.000Z" } } };
    const lenh = new Set(["x", "y"]);
    const xn = (y: { status: string; error?: string | null }) =>
      xacNhanHetChot({ chot: { stepId: "x" }, rows: [{ stepId: "x", status: "failed", error: "FOE_OUTCOME_UNKNOWN: x (test)" }, { stepId: "y", ...y }], ctx, laLenh: (id) => lenh.has(id), lenhTien: ["x", "y"] });
    expect(xn({ status: "held", error: 'EDGE_HELD(journalFull): command step "y" was not sent (test)' }), "held, no door's code").toBe(false);
    expect(xn({ status: "running", error: null }), "running").toBe(false);
    expect(xn({ status: "completed", error: null }), "finished").toBe(true);
    expect(xn({ status: "failed", error: "device said no (test)" }), "a known failure").toBe(true);
    expect(xn({ status: "failed", error: 'FOE_NOT_SENT_RUN_LATCHED: not sent: run latched — command step "y" (test)' }), "the door's code: dropped work").toBe(false);
  });
});
