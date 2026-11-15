/**
 * T4 (lượt sửa gốc A2(n), sau bản rà T4\ra\ra.md, HST 14/11) — central's end of an edge segment whose rider is short or unreadable (dạng 4), the cases the review asked for, in a SMALL pure file:
 * applyEdgeSegmentEnd is the real one, on a FakeDb (no database, no network); the URGENT is recorded, never sent. The 0372 ledger is the FakeDb's `edge_step_authorizations` rows, as central's
 * /authorize writes them (resultReportedAt / resultStatus as edgeReportsCentral.ts:634 records a ledger record's status).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const H = vi.hoisted(() => ({ alerts: [] as Array<Record<string, any>> }));

vi.mock("drizzle-orm", async (orig) => {
  const actual = await orig<typeof import("drizzle-orm")>();
  type R = Record<string, unknown>;
  return {
    ...actual,
    eq: (c: { name: string }, v: unknown) => (r: R) => r[c.name] === v,
    inArray: (c: { name: string }, vs: unknown[]) => (r: R) => vs.includes(r[c.name]),
    notInArray: (c: { name: string }, vs: unknown[]) => (r: R) => !vs.includes(r[c.name]),
    and: (...cs: unknown[]) => (r: R) => cs.every((x) => typeof x !== "function" || (x as (q: R) => boolean)(r)),
  };
});
vi.mock("../../../db/connection", () => ({ getDb: async () => null, isEdgeProcessRole: () => false }));
vi.mock("../../robot/criticalStopAlert", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../../robot/criticalStopAlert")>();
  return {
    ...orig,
    raiseCriticalStopAlert: async (a: Record<string, any>) => {
      H.alerts.push(a);
      a.baoBen?.(true);
    },
  };
});

import { FakeDb } from "../../../routers/__otFakeDb";
import { applyEdgeSegmentEnd } from "./foeRunStore";
import { BUOC_KHONG_XAC_DINH, CANH_BAO_KHONG_RO_KIND, KET_CUC_KHONG_RO_CHOT_CTX_KEY, KET_CUC_KHONG_RO_CTX_KEY, KHONG_CO_BU_TRU, noiDungCanhBaoKhongRo, ganBaoCaoKhongRoEdge, runDaChotKhongRo, tachBaoCaoKhongRoEdge } from "./foeKetCucKhongRo";
import { edgeResumeStateOf, stopChuaRaTuHang } from "./foeRunStore";
import type { WorkflowDefinition, WorkflowStep } from "./workflowModel";

const RUN = 9;
const OWNER = 5;
const move = (id: string): WorkflowStep => ({ id, type: "command", machineId: 2, command: "run_job", args: { robotId: 2, jobType: "move", params: { x: 1 } } }) as never;
const otStop = (id: string): WorkflowStep => ({ id, type: "command", machineId: 1, command: "stop", args: { tagKey: "halt", value: true } }) as never;
/** a rider whose JSON does not parse: read short (thieu) */
const LOI_HONG = 'EDGE_HELD(journalFull): the journal refused a record (journal_full) — the run is held. [[A2N:[{"loai":"held"]]';
const wait = (ms = 30) => new Promise((r) => setTimeout(r, ms));

let d: FakeDb;
beforeEach(() => {
  H.alerts.length = 0;
  d = new FakeDb();
  d.store.set("orchestration_runs", [{ id: RUN, status: "running", contextJson: null, startedBy: OWNER }]);
});
const so = (stepId: string, x: Record<string, unknown> = {}) => ({ jti: `j-${stepId}`, runId: RUN, claimSeq: 1, stepId, attempt: 1, resultReportedAt: null, resultStatus: null, supersededAt: null, ...x });
const ket = async (def: WorkflowDefinition, error = LOI_HONG) => {
  const r = await applyEdgeSegmentEnd(d as never, RUN, { outcome: "held", heldReason: "journalFull", error, nodeCode: "EDGE-A", claimSeq: 1, def });
  await wait();
  const run = (d.store.get("orchestration_runs") as Array<Record<string, any>>)[0];
  return { r, run, ctx: (run.contextJson ?? {}) as Record<string, unknown> };
};
const khoaCua = (kind: keyof typeof CANH_BAO_KHONG_RO_KIND, id: string) => H.alerts.filter((a) => String(a.dedupKey).startsWith(`${CANH_BAO_KHONG_RO_KIND[kind]}:${RUN}:${id}:`)).map((a) => String(a.dedupKey));

describe("T4 — dạng 4, the cases of the review (rider short or unreadable)", () => {
  it("T4-RA-A a command AUTHORISED on the 0372 ledger (not superseded, no result) whose step row never reached central, the rider unreadable: the run latched (the latch's own key), the URGENT of that command, never sent again", async () => {
    d.store.set("edge_step_authorizations", [so("x")]);
    const { r, run, ctx } = await ket({ ref: "t4ra", name: "t4ra", steps: [move("x")] } as never);
    expect(r).toMatchObject({ ok: true, status: "held" });
    expect(run.status).toBe("held");
    expect(ctx.foeOutcomeUnknown, "never sent again: it may have gone").toEqual(["x"]);
    expect(runDaChotKhongRo(ctx)).toBe(true);
    expect(ctx[KET_CUC_KHONG_RO_CHOT_CTX_KEY], "the latch's own record (I-2: pinned)").toMatchObject({ stepId: "x", ma: "FOE_OUTCOME_UNKNOWN" });
    expect(khoaCua("noCompensation", "x"), "the URGENT of the command whose outcome is unknown").toEqual([`${CANH_BAO_KHONG_RO_KIND.noCompensation}:${RUN}:x:-:claim1`]);
  });

  it("T4-RA-B (bảng #6, HST 14/11: chỉ U, H, không gửi lại) the same command authorised with no row, the rider READABLE (a whole empty rider): x named unknown (U), the run held (H), x never sent again", async () => {
    d.store.set("edge_step_authorizations", [so("x")]);
    const def = { ref: "t4rb", name: "t4rb", steps: [move("x")] } as never as WorkflowDefinition;
    const { run, ctx } = await ket(def, "EDGE_HELD(journalFull): the journal refused a record (journal_full) — the run is held. [[A2N:[]]]");
    expect(run.status, "H").toBe("held");
    expect(ctx.foeOutcomeUnknown, "U").toEqual(["x"]);
    expect(edgeResumeStateOf(def, [], new Set(["x"]), ctx.foeOutcomeUnknown as string[]).state.x, "a Continue never sends x again").toMatchObject({ state: "outcomeUnknown" });
  });
  // HST 14/11 (R1): #6 đóng ở bước 3 (quyetDinhKetDoanEdge). [H3]: central không tin nút một mình: rider đọc được nhưng không báo x, nguồn cấu trúc nói x có thể đã đi ⇒ N + C.
  it("T4-RA-B6 (bảng #6) the command authorised with no row, the rider readable and silent about it: the URGENT noCompensation of x (N) and the latch's record (C)", async () => {
    d.store.set("edge_step_authorizations", [so("x")]);
    const { ctx } = await ket({ ref: "t4rb6", name: "t4rb6", steps: [move("x")] } as never, "EDGE_HELD(journalFull): the journal refused a record (journal_full) — the run is held. [[A2N:[]]]");
    expect(khoaCua("noCompensation", "x"), "N").toEqual([`${CANH_BAO_KHONG_RO_KIND.noCompensation}:${RUN}:x:-:claim1`]);
    expect(ctx[KET_CUC_KHONG_RO_CHOT_CTX_KEY], "C").toMatchObject({ stepId: "x" });
  });
  it("T4-RA-I1 (I-1) the command's last row lost (running, no code; its ledger result \"failed\", a robot timeout), a STOP whose row is a refused attempt (owed ONLY on a latched run), the rider unreadable: the latch set first, then the debt read with it ⇒ exactly ONE stop_not_sent URGENT", async () => {
    d.store.set("edge_step_authorizations", [so("x", { resultReportedAt: new Date(), resultStatus: "failed" })]);
    const nt = { runId: RUN, stepId: "nt", stepType: "command", status: "running", attempt: 1, error: null, resultJson: { routedTo: "ot-dispatcher", accepted: false, status: "rejected", detail: { edge: true, reason: "ADAPTER_OFFLINE" } } };
    d.store.set("orchestration_run_steps", [{ runId: RUN, stepId: "x", stepType: "command", status: "running", attempt: 1, error: null, resultJson: { routedTo: "robot-dispatcher" } }, nt]);
    expect([...stopChuaRaTuHang([nt] as never, {})], "unlatched: a refused attempt is no debt").toEqual([]);
    const { run, ctx } = await ket({ ref: "t4ri1", name: "t4ri1", steps: [move("x"), otStop("nt")] } as never);
    expect(run.status).toBe("held");
    expect(ctx[KET_CUC_KHONG_RO_CHOT_CTX_KEY]).toMatchObject({ stepId: "x", ma: "FOE_OUTCOME_UNKNOWN" });
    expect([...stopChuaRaTuHang(d.store.get("orchestration_run_steps") as never, ctx)], "latched: owed").toEqual(["nt"]);
    expect(khoaCua("stopNotSent", "nt"), "exactly one URGENT of the owed STOP").toEqual([`${CANH_BAO_KHONG_RO_KIND.stopNotSent}:${RUN}:nt:${KHONG_CO_BU_TRU}:claim1`]);
    expect(khoaCua("noCompensation", "x")).toHaveLength(1);
  });
  it("T4-RA-SO-LOI (M-2) the 0372 ledger read FAILS at the end, the rider unreadable: fail-closed — the latch set, every command whose row is not final named unknown and told; a STOP never in that list (M-1) and its debt untouched", async () => {
    const nt = { runId: RUN, stepId: "nt", stepType: "command", status: "failed", attempt: 1, error: "DRIVER_WRITE_FAILED: link reset", resultJson: null };
    d.store.set("orchestration_run_steps", [{ runId: RUN, stepId: "x", stepType: "command", status: "running", attempt: 1, error: null, resultJson: null }, { runId: RUN, stepId: "y", stepType: "command", status: "completed", attempt: 1, error: null, resultJson: null }, nt]);
    const goc = d.select.bind(d);
    (d as any).select = (p?: unknown) => {
      const q = goc(p as never);
      const from = q.from.bind(q);
      q.from = (t: any) => {
        if (t?.[Symbol.for("drizzle:Name")] === "edge_step_authorizations") throw Object.assign(new Error("ledger (test)"), { code: "42501" });
        return from(t);
      };
      return q;
    };
    const { run, ctx } = await ket({ ref: "t4rso", name: "t4rso", steps: [move("x"), move("y"), otStop("nt")] } as never);
    expect(run.status).toBe("held");
    expect(ctx.foeOutcomeUnknown, "every command not final may have gone; the completed one is not; the STOP is not (L-7)").toEqual(["x"]);
    expect(ctx[KET_CUC_KHONG_RO_CHOT_CTX_KEY]).toMatchObject({ stepId: "x" });
    expect(khoaCua("noCompensation", "x")).toHaveLength(1);
    expect(khoaCua("noCompensation", "nt"), "no 'outcome unknown' words for the STOP").toEqual([]);
    expect([...stopChuaRaTuHang(d.store.get("orchestration_run_steps") as never, ctx)], "the STOP's debt is the rows' own, unchanged").toEqual([...stopChuaRaTuHang([nt] as never, {})]);
  });
  // T4 (M-7), HST 14/11 chọn (i): KHÔNG sửa bộ tách (tachBaoCaoKhongRoEdge vẫn đọc [{"x":1}] là nguyên vẹn, không báo cáo); hàm thuần bước 3 đóng ô này: rider
  // đọc được cũng áp đủ luật (R1) ⇒ phần tử hỏng làm rơi báo cáo nào thì central tự phát phần đó. Bản it.fails cũ khẳng định bộ tách đặt `thieu`: hướng đó HST đã bỏ.
  it("T4-RA-M7 (M-7) a rider whose list holds an element that is no report (read whole, nothing in it): central still raises what is missing — the URGENT of x (N) and the latch (C)", async () => {
    d.store.set("edge_step_authorizations", [so("x")]);
    const { run, ctx } = await ket({ ref: "t4rm7", name: "t4rm7", steps: [move("x")] } as never, 'EDGE_HELD(journalFull): the journal refused a record (journal_full) — the run is held. [[A2N:[{"x":1}]]]');
    expect(run.status, "H").toBe("held");
    expect(ctx.foeOutcomeUnknown, "U").toEqual(["x"]);
    expect(ctx[KET_CUC_KHONG_RO_CHOT_CTX_KEY], "C").toMatchObject({ stepId: "x", ma: "FOE_OUTCOME_UNKNOWN" });
    expect(khoaCua("noCompensation", "x"), "N").toEqual([`${CANH_BAO_KHONG_RO_KIND.noCompensation}:${RUN}:x:-:claim1`]);
  });
  it("T4-B3-O4-TICH-HOP (bảng #4 đúng nghĩa, qua applyEdgeSegmentEnd) the command's row failed and final WITHOUT the code, a STOP whose row is a refused attempt (owed only on a latched run), the rider unreadable: latched by central, exactly ONE stop_not_sent URGENT", async () => {
    d.store.set("edge_step_authorizations", [so("x")]);
    const nt = { runId: RUN, stepId: "nt", stepType: "command", status: "running", attempt: 1, error: null, resultJson: { routedTo: "ot-dispatcher", accepted: false, status: "rejected", detail: { edge: true, reason: "ADAPTER_OFFLINE" } } };
    const x = { runId: RUN, stepId: "x", stepType: "command", status: "failed", attempt: 1, error: "ROBOT_FAULT: gripper", resultJson: null };
    d.store.set("orchestration_run_steps", [x, nt]);
    expect([...stopChuaRaTuHang([x, nt] as never, {})], "unlatched, and the row without the code does not latch: no debt").toEqual([]);
    const { run, ctx } = await ket({ ref: "t4b3o4", name: "t4b3o4", steps: [move("x"), otStop("nt")] } as never);
    expect(run.status).toBe("held");
    expect(ctx[KET_CUC_KHONG_RO_CHOT_CTX_KEY]).toMatchObject({ stepId: "x", ma: "FOE_OUTCOME_UNKNOWN" });
    expect(ctx.foeOutcomeUnknown, "STOP never in U (L-7)").toEqual(["x"]);
    expect(khoaCua("stopNotSent", "nt"), "exactly one URGENT of the owed STOP").toEqual([`${CANH_BAO_KHONG_RO_KIND.stopNotSent}:${RUN}:nt:${KHONG_CO_BU_TRU}:claim1`]);
    expect(khoaCua("noCompensation", "x")).toEqual([`${CANH_BAO_KHONG_RO_KIND.noCompensation}:${RUN}:x:-:claim1`]);
  });
  // HST 14/11 (R2, mục (v)): lệnh CÓ bù trừ nằm trong U ⇒ held() đặt dấu cần người bằng cơ chế có sẵn, dấu nêu ĐÚNG tên bước và bù trừ (không phải "?")
  it("T4-B3-O16-DAU (bảng #16, R2) a command WITH a compensation may have gone (row running, authorised), the rider unreadable: the outcome-unknown mark names that step and its compensation", async () => {
    d.store.set("edge_step_authorizations", [so("x")]);
    d.store.set("orchestration_run_steps", [{ runId: RUN, stepId: "x", stepType: "command", status: "running", attempt: 1, error: null, resultJson: { routedTo: "robot-dispatcher" } }]);
    const { run, ctx } = await ket({ ref: "t4b3o16", name: "t4b3o16", steps: [{ ...move("x"), compensation: move("cx") }] } as never);
    expect(run.status).toBe("held");
    expect(ctx.foeOutcomeUnknown).toEqual(["x"]);
    expect(ctx[KET_CUC_KHONG_RO_CTX_KEY], "the mark a Continue reads (a person + a reason)").toMatchObject({ stepId: "x", compId: "cx", ds: [{ stepId: "x", compId: "cx" }] });
    expect(khoaCua("noCompensation", "x"), "no N for a command with a compensation").toEqual([]);
  });
  it("T4-B3-O16-DS (R2 (a) điều kiện 5) the rider READABLE and carrying the held report of x/cx, the hold for another reason (journalFull): the mark is set and its ds is never empty — exactly x/cx", async () => {
    d.store.set("edge_step_authorizations", [so("x")]);
    d.store.set("orchestration_run_steps", [{ runId: RUN, stepId: "x", stepType: "command", status: "running", attempt: 1, error: null, resultJson: { routedTo: "robot-dispatcher" } }]);
    const loi = ganBaoCaoKhongRoEdge("EDGE_HELD(journalFull): the journal refused a record (journal_full) — the run is held.", [{ loai: "held", stepId: "x", compId: "cx", ma: "FOE_OUTCOME_UNKNOWN", claimSeq: 1 }] as never, 4_000)!;
    const { ctx } = await ket({ ref: "t4b3o16ds", name: "t4b3o16ds", steps: [{ ...move("x"), compensation: move("cx") }] } as never, loi);
    expect(ctx[KET_CUC_KHONG_RO_CTX_KEY]).toMatchObject({ stepId: "x", compId: "cx", ds: [{ stepId: "x", compId: "cx" }] });
  });
  it("T4-B3-O16-DOI-CHUNG (R2 (a) đối chứng) the same hold, the command has NO compensation: no outcome-unknown mark (a Continue asks nothing more), N raised", async () => {
    d.store.set("edge_step_authorizations", [so("x")]);
    d.store.set("orchestration_run_steps", [{ runId: RUN, stepId: "x", stepType: "command", status: "running", attempt: 1, error: null, resultJson: { routedTo: "robot-dispatcher" } }]);
    const { ctx } = await ket({ ref: "t4b3o16dc", name: "t4b3o16dc", steps: [move("x")] } as never);
    expect(ctx[KET_CUC_KHONG_RO_CTX_KEY]).toBeUndefined();
    expect(khoaCua("noCompensation", "x")).toHaveLength(1);
  });
  // HST 15/11, hướng (iv) — bảng #17 / #19, ĐỎ trước. Chuẩn trung tâm T4-B3-URGENT-TT: lúc giữ ĐÚNG HAI URGENT, `held` cho cặp chờ duyệt và `forwardNotSent` cho bước forward bị bỏ.
  // Lý do held của đoạn giữ nguyên (journalFull). So ĐÚNG tập khoá của MỌI URGENT.
  const defXY = () => ({ ref: "t4b3xy", name: "t4b3xy", steps: [{ ...move("x"), compensation: move("cx") }, move("y")] }) as never as WorkflowDefinition;
  const hangX = () => d.store.set("orchestration_run_steps", [{ runId: RUN, stepId: "x", stepType: "command", status: "running", attempt: 1, error: null, resultJson: { routedTo: "robot-dispatcher" } }]);
  const tatCaKhoa = () => H.alerts.map((a) => String(a.dedupKey)).sort();
  const K = (kind: keyof typeof CANH_BAO_KHONG_RO_KIND, step: string, comp: string) => `${CANH_BAO_KHONG_RO_KIND[kind]}:${RUN}:${step}:${comp}:claim1`;
  const riderCo = (bao: Array<Record<string, unknown>>) => ganBaoCaoKhongRoEdge("EDGE_HELD(journalFull): the journal refused a record (journal_full) — the run is held.", bao as never, 4_000)!;
  it("T4-B3-O17-DA-BAO (bảng #17, rider ĐỦ và đã báo held + forwardNotSent) ⇒ ĐÚNG HAI URGENT, central không phát thêm cái thứ ba; lý do held vẫn journalFull", async () => {
    d.store.set("edge_step_authorizations", [so("x")]);
    hangX();
    const { ctx } = await ket(defXY(), riderCo([{ loai: "held", stepId: "x", compId: "cx", ma: "FOE_OUTCOME_UNKNOWN", claimSeq: 1 }, { loai: "forwardNotSent", stepId: "y", compId: KHONG_CO_BU_TRU, ma: "FOE_OUTCOME_UNKNOWN", claimSeq: 1 }]));
    expect(ctx.edgeHeld).toBe("journalFull");
    expect(tatCaKhoa()).toEqual([K("held", "x", "cx"), K("forwardNotSent", "y", KHONG_CO_BU_TRU)].sort());
  });
  it("T4-B3-O17-KHONG-BAO (bảng #17, rider ĐỦ, chở forwardNotSent của y nhưng KHÔNG báo held) ⇒ ĐÚNG HAI URGENT: held x/cx do central phát, forwardNotSent y của rider; lưới #19 không phát (phủ định)", async () => {
    d.store.set("edge_step_authorizations", [so("x")]);
    hangX();
    const { ctx } = await ket(defXY(), riderCo([{ loai: "forwardNotSent", stepId: "y", compId: KHONG_CO_BU_TRU, ma: "FOE_OUTCOME_UNKNOWN", claimSeq: 1 }]));
    expect(ctx.edgeHeld).toBe("journalFull");
    expect(tatCaKhoa()).toEqual([K("held", "x", "cx"), K("forwardNotSent", "y", KHONG_CO_BU_TRU)].sort());
  });
  it("T4-B3-O19 (bảng #19, rider HỎNG, sổ sự kiện đầy: không anomaly nào tới) ⇒ held cho từng cặp chờ duyệt, cộng MỘT forwardNotSent KHÔNG nêu bước (\"?\"), câu nói không xác định được bước nào bị bỏ, kiểm tại chỗ", async () => {
    d.store.set("edge_step_authorizations", [so("x")]);
    hangX();
    const { ctx } = await ket(defXY());
    expect(ctx.edgeHeld).toBe("journalFull");
    expect(tatCaKhoa()).toEqual([K("held", "x", "cx"), K("forwardNotSent", "?", KHONG_CO_BU_TRU)].sort());
    const f = H.alerts.find((a) => String(a.dedupKey) === K("forwardNotSent", "?", KHONG_CO_BU_TRU))!;
    expect(String(f.title)).toMatch(/which command could not be determined/);
    expect(String(f.message)).toMatch(/Check the machine on site/);
    expect(String(f.message), "QĐ3 — the cause said: the node's report unreadable with its event journal full").toMatch(/edge node's report of them was unreadable while its event journal was full/);
  });
  it("T4-B3-O19-TRAN (QĐ3) the words of a forwardNotSent naming no step stay under the 800-character ceiling, at the longest run id and event", () => {
    const n = noiDungCanhBaoKhongRo({ loai: "forwardNotSent", runId: Number.MAX_SAFE_INTEGER, stepId: BUOC_KHONG_XAC_DINH, compId: KHONG_CO_BU_TRU, error: "EDGE_OUTCOME_UNKNOWN", lan: `claim${Number.MAX_SAFE_INTEGER}` });
    expect(n.message).toMatch(/could not be determined/);
    expect(n.message.length).toBeLessThanOrEqual(800);
    expect(n.title.length).toBeLessThanOrEqual(800);
  });
  it("T4-B3-O19-HAI-CAP (bảng #19) rider hỏng, HAI lệnh có bù trừ có thể đã đi ⇒ held cho TỪNG cặp, vẫn chỉ MỘT forwardNotSent không nêu bước", async () => {
    d.store.set("edge_step_authorizations", [so("x"), so("z")]);
    d.store.set("orchestration_run_steps", [
      { runId: RUN, stepId: "x", stepType: "command", status: "running", attempt: 1, error: null, resultJson: { routedTo: "robot-dispatcher" } },
      { runId: RUN, stepId: "z", stepType: "command", status: "running", attempt: 1, error: null, resultJson: { routedTo: "robot-dispatcher" } },
    ]);
    await ket({ ref: "t4b3o19h", name: "t4b3o19h", steps: [{ ...move("x"), compensation: move("cx") }, { ...move("z"), compensation: move("cz") }, move("y")] } as never);
    expect(tatCaKhoa()).toEqual([K("held", "x", "cx"), K("held", "z", "cz"), K("forwardNotSent", "?", KHONG_CO_BU_TRU)].sort());
  });
  // HST 14/11: Q2 đi cùng lô client. Ô #8 (sổ đọc lỗi VÀ lệnh không có hàng): kỳ vọng ĐÚNG là MỘT URGENT chung cho run (kind foe_outcome_unknown_ledger_unreadable,
  // dedupKey dựng theo run) cùng H; hàm thuần đã trả soLoiChung nhưng held() CHƯA dùng nó ở lượt này ⇒ it.fails.
  it.fails("T4-B3-O8 (bảng #8, Q2) the 0372 ledger read fails and the command has no row: ONE run-wide URGENT that the ledger could not be read, the run held", async () => {
    const goc = d.select.bind(d);
    (d as any).select = (p?: unknown) => {
      const q = goc(p as never);
      const from = q.from.bind(q);
      q.from = (t: any) => {
        if (t?.[Symbol.for("drizzle:Name")] === "edge_step_authorizations") throw Object.assign(new Error("ledger (test)"), { code: "42501" });
        return from(t);
      };
      return q;
    };
    const { run } = await ket({ ref: "t4b3o8", name: "t4b3o8", steps: [move("x")] } as never);
    expect(run.status, "H").toBe("held");
    expect(H.alerts.filter((a) => /^foe_outcome_unknown_ledger_unreadable:9(:|$)/.test(String(a.dedupKey))), "exactly one run-wide URGENT").toHaveLength(1);
  });
  it("T4-RA-M7-HOPLE (M-2 design) an element only the claim check drops keeps the rider whole: not short", () => {
    const w = ganBaoCaoKhongRoEdge("text", [{ loai: "stopNotSent", stepId: "nt", compId: KHONG_CO_BU_TRU, ma: "FOE_OUTCOME_UNKNOWN", claimSeq: 1 }] as never, 4_000)!;
    expect(tachBaoCaoKhongRoEdge(w, (x) => x.claimSeq === 2), "filtered by the claim check: not short").toEqual({ error: "text", bao: [] });
  });
});
