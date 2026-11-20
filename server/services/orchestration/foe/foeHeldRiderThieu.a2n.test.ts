/**
 * T4 (lượt sửa gốc A2(n), sau bản rà T4\ra\ra.md, HST 14/11) — central's end of an edge segment whose rider is short or unreadable (dạng 4), the cases the review asked for, in a SMALL pure file:
 * applyEdgeSegmentEnd is the real one, on a FakeDb (no database, no network); the URGENT is recorded, never sent. The 0372 ledger is the FakeDb's `edge_step_authorizations` rows, as central's
 * /authorize writes them (resultReportedAt / resultStatus as edgeReportsCentral.ts:634 records a ledger record's status).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const H = vi.hoisted(() => ({ alerts: [] as Array<Record<string, any>>, ben: true }));

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
      a.baoBen?.(H.ben);
    },
  };
});

import { FakeDb } from "../../../routers/__otFakeDb";
import { applyEdgeSegmentEnd } from "./foeRunStore";
import { BUOC_KHONG_XAC_DINH, CANH_BAO_KHONG_RO_KIND, KET_CUC_KHONG_RO_CHOT_CTX_KEY, KET_CUC_KHONG_RO_CTX_KEY, KET_CUC_KHONG_RO_DA_BAO_CTX_KEY, KHONG_CO_BU_TRU, noiDungCanhBaoKhongRo, ganBaoCaoKhongRoEdge, runDaChotKhongRo, tachBaoCaoKhongRoEdge } from "./foeKetCucKhongRo";
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
  H.ben = true;
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

  // N và C do T4-RA-B6 giữ; Q1 (#6) đóng ở 35a3210af (chu-du-an-HST 15/11)
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
  // HST 15/11, QĐ4 — DA_BAO ("the latch was told to a person": an Abort reads it, foeEngine.ts:6989) ONLY when an URGENT that says THE latch's event (names the latch's step, its outcome
  // unknown) was confirmed durable; its stepId = the latch's. chotTuBao: the first report that is no forwardNotSent. ĐỎ trước
  it("T4-B3-QD4-BEN (QĐ4) the URGENT of the pair waiting (held x/cx: names x, outcome unknown) confirmed durable at the hold ⇒ DA_BAO with the latch's step x", async () => {
    d.store.set("edge_step_authorizations", [so("x")]);
    hangX();
    const { ctx } = await ket(defXY());
    expect(ctx[KET_CUC_KHONG_RO_CHOT_CTX_KEY]).toMatchObject({ stepId: "x" });
    expect(ctx[KET_CUC_KHONG_RO_DA_BAO_CTX_KEY]).toMatchObject({ stepId: "x" });
  });
  it("T4-B3-QD4-KHONG-BEN (QĐ4 (ii)) the URGENT not confirmed durable at the hold ⇒ NO DA_BAO (the end gate raises run_end later: the closed side); the latch names x", async () => {
    H.ben = false;
    d.store.set("edge_step_authorizations", [so("x")]);
    hangX();
    const { ctx } = await ket(defXY());
    expect(ctx[KET_CUC_KHONG_RO_CHOT_CTX_KEY]).toMatchObject({ stepId: "x" });
    expect(ctx[KET_CUC_KHONG_RO_DA_BAO_CTX_KEY]).toBeUndefined();
  });
  it("T4-B3-QD4-CHI-FWD (QĐ4 (iv)) the rider carries ONLY forwardNotSent(y): the latch never names the forward step — it is central's (x, from the rows), and DA_BAO (if any) names x, never y", async () => {
    d.store.set("edge_step_authorizations", [so("x")]);
    hangX();
    const { ctx } = await ket(defXY(), riderCo([{ loai: "forwardNotSent", stepId: "y", compId: KHONG_CO_BU_TRU, ma: "FOE_OUTCOME_UNKNOWN", claimSeq: 1 }]));
    expect(ctx[KET_CUC_KHONG_RO_CHOT_CTX_KEY]).toMatchObject({ stepId: "x" });
    expect((ctx[KET_CUC_KHONG_RO_DA_BAO_CTX_KEY] as { stepId?: string } | undefined)?.stepId ?? "x").toBe("x");
  });
  it("T4-B3-QD4-FWD-KHONG-DAU (QĐ4) only a forwardNotSent is durable (no pair waiting, nothing names the latch's step) ⇒ NO DA_BAO", async () => {
    d.store.set("edge_step_authorizations", [so("x", { resultReportedAt: new Date(), resultStatus: "acked" })]);
    d.store.set("orchestration_run_steps", [{ runId: RUN, stepId: "x", stepType: "command", status: "completed", attempt: 1, error: null, resultJson: null }]);
    const { ctx } = await ket(defXY(), riderCo([{ loai: "forwardNotSent", stepId: "y", compId: KHONG_CO_BU_TRU, ma: "FOE_OUTCOME_UNKNOWN", claimSeq: 1 }]));
    expect(ctx[KET_CUC_KHONG_RO_DA_BAO_CTX_KEY]).toBeUndefined();
  });
  // ── kiem-dinh S1-S7 (chu-du-an-HST 15/11): ca THƯỜNG giết đột biến sống của bản rà 486ee5f71 ──
  const baoBiet = (loai: string, stepId: string, compId: string) => ({ loai, stepId, compId, ma: "FOE_OUTCOME_UNKNOWN", claimSeq: 1, biet: true });
  // S3: một URGENT `biet: true` (nút BIẾT nó là gì) nêu bước chốt KHÔNG phải sự kiện của chốt ⇒ không DA_BAO. Đột biến: bỏ `&& !b.biet` ở benChot (foeRunStore.ts ~2204)
  it("T4-B3-S3-BIET-KHONG-DAU (kiem-dinh S3) the only durable URGENT naming the latch's step is `biet: true` (the node knew it) ⇒ NO DA_BAO", async () => {
    d.store.set("edge_step_authorizations", [so("x")]);
    hangX();
    const { ctx } = await ket({ ref: "t4s3", name: "t4s3", steps: [move("x")] } as never, riderCo([baoBiet("noCompensation", "x", KHONG_CO_BU_TRU)]));
    expect(ctx[KET_CUC_KHONG_RO_CHOT_CTX_KEY]).toMatchObject({ stepId: "x" });
    expect(H.alerts.map((a) => String(a.dedupKey)), "the URGENT of x was raised (durable), yet it is no DA_BAO").toContain(`${CANH_BAO_KHONG_RO_KIND.noCompensation}:${RUN}:x:-:claim1`);
    expect(ctx[KET_CUC_KHONG_RO_DA_BAO_CTX_KEY]).toBeUndefined();
  });
  // S4: un forwardNotSent durable NÊU ĐÚNG bước chốt (chốt đã đặt từ trước, x không còn "có thể đã đi") không là sự kiện của chốt ⇒ không DA_BAO. Đột biến: bỏ lọc loai (held / noCompensation) ở benChot
  it("T4-B3-S4-FWD-CUNG-BUOC (kiem-dinh S4) only a forwardNotSent is durable and it carries the latch's OWN step id ⇒ NO DA_BAO (not only a different step, as QD4-FWD-KHONG-DAU)", async () => {
    const run = (d.store.get("orchestration_runs") as Array<Record<string, any>>)[0]!;
    run.contextJson = { [KET_CUC_KHONG_RO_CHOT_CTX_KEY]: { stepId: "x", ma: "FOE_OUTCOME_UNKNOWN" } };
    d.store.set("edge_step_authorizations", [so("x", { resultReportedAt: new Date(), resultStatus: "acked" })]);
    d.store.set("orchestration_run_steps", [{ runId: RUN, stepId: "x", stepType: "command", status: "completed", attempt: 1, error: null, resultJson: null }]);
    const { ctx } = await ket(defXY(), riderCo([{ loai: "forwardNotSent", stepId: "x", compId: KHONG_CO_BU_TRU, ma: "FOE_OUTCOME_UNKNOWN", claimSeq: 1 }]));
    expect(H.alerts.map((a) => String(a.dedupKey)), "the forwardNotSent was raised and durable").toContain(K("forwardNotSent", "x", KHONG_CO_BU_TRU));
    expect(ctx[KET_CUC_KHONG_RO_DA_BAO_CTX_KEY]).toBeUndefined();
  });
  // S2: lưới forwardNotSent("?") (foeRunStore.ts ~2199). Ba điều kiện, mỗi ca giết một đột biến: bỏ `riderThieu === true`; bỏ `q.buTruCanNguoi.length > 0`; bỏ `!baoKhongRo.some(forwardNotSent)`
  it("T4-B3-S2-RIDER-DOC-DUOC (kiem-dinh S2a) rider READABLE (whole, nothing in it), a pair waiting ⇒ the net raises NO forwardNotSent(?)", async () => {
    d.store.set("edge_step_authorizations", [so("x")]);
    hangX();
    await ket(defXY(), riderCo([]));
    expect(tatCaKhoa()).toEqual([K("held", "x", "cx")]);
  });
  it("T4-B3-S2-KHONG-CAP-CHO (kiem-dinh S2b) rider BROKEN but NO pair waiting (x has no compensation) ⇒ the net raises NO forwardNotSent(?)", async () => {
    d.store.set("edge_step_authorizations", [so("x")]);
    hangX();
    await ket({ ref: "t4s2b", name: "t4s2b", steps: [move("x"), move("y")] } as never);
    expect(H.alerts.map((a) => String(a.dedupKey)).filter((k) => k.startsWith(`${CANH_BAO_KHONG_RO_KIND.forwardNotSent}:`))).toEqual([]);
  });
  it("T4-B3-S2-RIDER-DA-CO-FWD (kiem-dinh S2c) rider SHORT (marked, carrying forwardNotSent(y)) with a pair waiting ⇒ the net adds NO second forwardNotSent(?)", async () => {
    d.store.set("edge_step_authorizations", [so("x")]);
    hangX();
    const cat = riderCo([{ loai: "forwardNotSent", stepId: "y", compId: KHONG_CO_BU_TRU, ma: "FOE_OUTCOME_UNKNOWN", claimSeq: 1 }]).replace(" [[A2N:", " [[A2N-THIEU:"); // the marked-short rider (its reports were dropped for the text floor), one forwardNotSent(y) kept
    await ket(defXY(), cat);
    expect(H.alerts.map((a) => String(a.dedupKey)).filter((k) => k.startsWith(`${CANH_BAO_KHONG_RO_KIND.forwardNotSent}:`))).toEqual([K("forwardNotSent", "y", KHONG_CO_BU_TRU)]);
  });
  // Đ-1, hướng ĐÓNG, SG-T1; chu-du-an-HST 15/11: định nghĩa KHÔNG có bước forward mà lưới vẫn phát forwardNotSent(?) (nó chỉ hỏi "có cặp chờ", không hỏi "có bước forward")
  it.fails("T4-B3-D1-KHONG-FWD (Đ-1, giới hạn đã biết hướng đóng; SG-T1) rider hỏng, một cặp chờ, định nghĩa KHÔNG có bước forward nào bị bỏ: kỳ vọng ĐÚNG là không forwardNotSent(?)", async () => {
    d.store.set("edge_step_authorizations", [so("x")]);
    hangX();
    await ket({ ref: "t4d1", name: "t4d1", steps: [{ ...move("x"), compensation: move("cx") }] } as never);
    expect(H.alerts.map((a) => String(a.dedupKey)).filter((k) => k.startsWith(`${CANH_BAO_KHONG_RO_KIND.forwardNotSent}:`))).toEqual([]);
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

// X-33 (AGENTS-ngoai-le.md dòng 47) — b1a / b1d: at the end gate (congCuoi) khongRoCuaDoan is the only source of foeOutcomeUnknown (held() reads the ledger again, :2205, and hides them)
describe("X-33 — the end gate of an edge segment, held for a STOP owed: the commands that may have gone, from central's rows and ledger", () => {
  const DEF = { ref: "x33", name: "x33", steps: [move("x"), move("y"), otStop("st")] } as never as WorkflowDefinition;
  const ketFailed = async () => {
    const { loiGiuChuaRa } = await import("./foeKetCucKhongRo");
    d.store.set("orchestration_run_steps", [
      { runId: RUN, stepId: "x", stepType: "command", status: "running", attempt: 1, error: null, resultJson: null },
      { runId: RUN, stepId: "st", stepType: "command", status: "failed", attempt: 1, error: loiGiuChuaRa("st", { nguon: "tuChoi", ma: "CHUA_GHIM_STOP" }), resultJson: null },
    ]);
    const r = await applyEdgeSegmentEnd(d as never, RUN, { outcome: "failed", error: 'COMMAND_FAILED: step "y" failed [[A2N:[]]]', nodeCode: "EDGE-A", claimSeq: 1, def: DEF });
    await wait();
    return { r, ctx: ((d.store.get("orchestration_runs") as Array<Record<string, any>>)[0].contextJson ?? {}) as Record<string, unknown> };
  };
  it("X33-CONG-SO-LOI (b1a + b1d) the ledger read fails at the end gate: fail-closed — x, whose row is not final, may have gone: named unknown, the run latched", async () => {
    const goc = d.select.bind(d);
    (d as any).select = (p?: unknown) => {
      const q = goc(p as never);
      const from = q.from.bind(q);
      q.from = (t: any) => {
        if (t?.[Symbol.for("drizzle:Name")] === "edge_step_authorizations") throw Object.assign(new Error("ledger (X-33 test)"), { code: "42501" });
        return from(t);
      };
      return q;
    };
    const { r, ctx } = await ketFailed();
    expect(r).toMatchObject({ ok: true, status: "held", changed: true });
    expect(ctx.interruptedBy, "held by the end gate (congCuoi), not by held()").toBe("end gate");
    expect(ctx.foeOutcomeUnknown, "fail-closed: the command whose row is not final").toEqual(["x"]);
    expect(runDaChotKhongRo(ctx)).toBe(true);
  });
  it("X33-CONG-SO-DOC (b1d) the ledger read: x authorised, no result, its row running: named unknown at the end gate, the run latched", async () => {
    d.store.set("edge_step_authorizations", [so("x")]);
    const { r, ctx } = await ketFailed();
    expect(r).toMatchObject({ ok: true, status: "held", changed: true });
    expect(ctx.interruptedBy, "held by the end gate (congCuoi), not by held()").toBe("end gate");
    expect(ctx.foeOutcomeUnknown).toEqual(["x"]);
    expect(runDaChotKhongRo(ctx)).toBe(true);
  });
});

// X-34 (AGENTS-ngoai-le.md dòng 48; tam/x34-ket-terminal-pham-vi-3.md + mục 12-14) — a terminal end of an edge segment latches on central's own set (khongRoCuaDoan before the gate)
describe("X-34 — a terminal end of an edge segment reads central's own set of the commands that may have gone", () => {
  const CHOT = KET_CUC_KHONG_RO_CHOT_CTX_KEY;
  const runEnd = (id: string) => `${CANH_BAO_KHONG_RO_KIND.runEnd}:${RUN}:${id}:-:chot`;
  const khoaRunEnd = () => H.alerts.map((a) => String(a.dedupKey)).filter((k) => k.startsWith(CANH_BAO_KHONG_RO_KIND.runEnd));
  const hang = (stepId: string, status = "running", x: Record<string, unknown> = {}) => ({ runId: RUN, stepId, stepType: "command", status, attempt: 1, error: null, resultJson: null, ...x });
  const RONG = " [[A2N:[]]]";
  type Hinh = { outcome?: "failed" | "aborted" | "completed"; error?: string; so?: Record<string, unknown>[]; rows?: Record<string, unknown>[]; nem?: true; ou?: string[]; status0?: string; ctx0?: Record<string, unknown>; steps?: WorkflowStep[] };
  const ket = async (h: Hinh) => {
    d.store.set("orchestration_runs", [{ id: RUN, status: h.status0 ?? "running", contextJson: h.ctx0 ?? null, startedBy: OWNER }]);
    if (h.so) d.store.set("edge_step_authorizations", h.so);
    if (h.rows) d.store.set("orchestration_run_steps", h.rows);
    if (h.nem) {
      const goc = d.select.bind(d);
      (d as any).select = (p?: unknown) => {
        const q = goc(p as never);
        const from = q.from.bind(q);
        q.from = (t: any) => (t?.[Symbol.for("drizzle:Name")] === "edge_step_authorizations" ? (() => { throw Object.assign(new Error("ledger (X-34 test)"), { code: "42501" }); })() : from(t));
        return q;
      };
    }
    const def = { ref: "x34", name: "x34", steps: h.steps ?? [move("x"), move("y")] } as never as WorkflowDefinition;
    const r = await applyEdgeSegmentEnd(d as never, RUN, { outcome: h.outcome ?? "failed", error: h.error ?? `COMMAND_FAILED: step "y" failed${RONG}`, nodeCode: "EDGE-A", claimSeq: 1, def, ...(h.ou ? { outcomeUnknown: h.ou } : {}) } as never);
    await wait();
    const run = (d.store.get("orchestration_runs") as Array<Record<string, any>>)[0];
    return { r, run, ctx: (run.contextJson ?? {}) as Record<string, any> };
  };
  const P1: Hinh = { so: [so("x")], rows: [hang("x")] };
  const CHOT_TAP: Array<[string, Hinh, string, string[]]> = [
    ["P1 failed, x authorised, its row running", P1, "x", ["x"]],
    ["P2 aborted (a precondition)", { ...P1, outcome: "aborted", error: `PRECONDITION_FAILED: step "y"${RONG}` }, "x", ["x"]],
    ["P2F aborted, the rider carrying forwardNotSent(y) only", { ...P1, outcome: "aborted", error: ganBaoCaoKhongRoEdge('Precondition failed for step "y" (abort).', [{ loai: "forwardNotSent", stepId: "y", compId: KHONG_CO_BU_TRU, ma: "FOE_OUTCOME_UNKNOWN", claimSeq: 1 }], 4_000) }, "x", ["x"]],
    ["P3 no row of x", { so: [so("x")] }, "x", ["x"]],
    ["P4 no rider (an old node)", { ...P1, error: 'COMMAND_FAILED: step "y" failed' }, "x", ["x"]],
    ["P5 the ledger HAS x's result, its row running (fail-closed, intended)", { so: [so("x", { resultReportedAt: new Date(), resultStatus: "acked" })], rows: [hang("x")] }, "x", ["x"]],
    ["two commands from the ledger: the first in the set's order (here the definition's)", { so: [so("a"), so("b")], rows: [hang("a"), hang("b")], steps: [move("a"), move("b"), move("y")] }, "a", ["a", "b"]],
    ["the words name EDGE_OUTCOME_UNKNOWN(b,a), a and b both in the ledger: the set's order, the words first", { so: [so("a"), so("b")], rows: [hang("a"), hang("b")], steps: [move("a"), move("b"), move("y")], error: `EDGE_OUTCOME_UNKNOWN(b,a): sent, but the result could not be recorded${RONG}` }, "b", ["b", "a"]],
    ["the ledger unreadable: fail-closed", { rows: [hang("x")], nem: true }, "x", ["x"]],
    ["a rider short (thieu): every row not final", { rows: [hang("y")], error: 'COMMAND_FAILED: step "y" failed [[A2N:[{"loai":"held"]]' }, "y", ["y"]],
    ["the structured list names x (its row completed)", { rows: [hang("x", "completed")], ou: ["x"] }, "x", ["x"]],
    ["a run compensating", { ...P1, status0: "compensating" }, "x", ["x"]],
  ];
  for (const [ten, h, id, ds] of CHOT_TAP) {
    it(`X34-BANG ${ten}: terminal, latched by central's set (nguon), the list, DA_BAO, one run_end`, async () => {
      const { r, ctx } = await ket(h);
      expect(r).toMatchObject({ ok: true, status: h.outcome ?? "failed", changed: true });
      expect(ctx[CHOT], "the latch, with its source").toMatchObject({ stepId: id, ma: "FOE_OUTCOME_UNKNOWN", nguon: "tapKetDoan" });
      expect(ctx.foeOutcomeUnknown).toEqual(ds);
      expect(ctx[KET_CUC_KHONG_RO_DA_BAO_CTX_KEY]).toMatchObject({ stepId: id });
      expect(khoaRunEnd()).toEqual([runEnd(id)]);
    });
  }
  const NHU_CU: Array<[string, Hinh]> = [
    ["the authorisation superseded, the row running with no routedTo", { so: [so("x", { supersededAt: new Date() })], rows: [hang("x")] }],
    ["a STOP authorised, no result, its row running (L-7: never in the set)", { so: [so("st")], rows: [hang("st")], steps: [move("y"), otStop("st")] }],
    ["the ledger has x's result, its row completed", { so: [so("x", { resultReportedAt: new Date(), resultStatus: "acked" })], rows: [hang("x", "completed")] }],
    ["completed, every row final, the ledger read", { outcome: "completed", so: [so("x", { resultReportedAt: new Date(), resultStatus: "acked" })], rows: [hang("x", "completed"), hang("y", "completed")] }],
    ["completed, every row final, the ledger unreadable", { outcome: "completed", rows: [hang("x", "completed"), hang("y", "completed")], nem: true }],
  ];
  for (const [ten, h] of NHU_CU) {
    it(`X34-NHU-CU ${ten}: terminal as before — no latch, no list, no URGENT`, async () => {
      const { r, ctx } = await ket(h);
      expect(r).toMatchObject({ ok: true, status: h.outcome ?? "failed", changed: true });
      expect(ctx[CHOT]).toBeUndefined();
      expect(ctx.foeOutcomeUnknown).toBeUndefined();
      expect(H.alerts).toEqual([]);
    });
  }
  it("X34-KHONG-BEN the URGENT not durable: failed AND aborted are held by the end gate, latched (no nguon), the list, no DA_BAO", async () => {
    for (const outcome of ["failed", "aborted"] as const) {
      H.ben = false;
      const { r, run, ctx } = await ket({ ...P1, outcome });
      expect(r, outcome).toMatchObject({ ok: true, status: "held", changed: true });
      expect(run.finishedAt, outcome).toBeUndefined();
      expect(ctx[CHOT], outcome).toMatchObject({ stepId: "x" });
      expect(ctx[CHOT].nguon, `${outcome}: nguon only on a terminal patch`).toBeUndefined();
      expect([ctx.foeOutcomeUnknown, ctx[KET_CUC_KHONG_RO_DA_BAO_CTX_KEY], ctx.interruptedBy], outcome).toEqual([["x"], undefined, "end gate"]);
    }
  });
  const THU_TU_HANG: Hinh = { so: [so("a")], rows: [hang("a"), hang("b", "failed", { error: "FOE_OUTCOME_UNKNOWN: command b may have reached the device" })], steps: [move("a"), move("b")] };
  it("X34-THU-TU-HANG the rows' code on b, central's set {a}: the latch is b's (the set comes LAST), no latch key of the set", async () => {
    const { ctx } = await ket(THU_TU_HANG);
    expect(ctx[KET_CUC_KHONG_RO_DA_BAO_CTX_KEY]).toMatchObject({ stepId: "b" });
    expect(khoaRunEnd()).toEqual([runEnd("b")]);
    expect(ctx[CHOT], "a latch of the rows is not written as the set's").toBeUndefined();
  });
  it("X34-THU-TU-HANG-GIU the same, the URGENT not durable: held, the context carries no latch key (as before)", async () => {
    H.ben = false;
    const { r, ctx } = await ket(THU_TU_HANG);
    expect(r).toMatchObject({ status: "held" });
    expect(ctx[CHOT]).toBeUndefined();
  });
  it("X34-THU-TU-BAO a report on the rider latches b, central's set {a}: the latch is the report's, no nguon", async () => {
    const { ctx } = await ket({ so: [so("a")], rows: [hang("a")], steps: [move("a"), move("b")], error: ganBaoCaoKhongRoEdge('COMMAND_FAILED: step "b" failed', [{ loai: "noCompensation", stepId: "b", compId: KHONG_CO_BU_TRU, ma: "FOE_OUTCOME_UNKNOWN", claimSeq: 1 }], 4_000) });
    expect(ctx[CHOT]).toMatchObject({ stepId: "b" });
    expect(ctx[CHOT].nguon).toBeUndefined();
  });
  const Z = { stepId: "z", ma: "FOE_OUTCOME_UNKNOWN", at: "2026-11-20T00:00:00.000Z" };
  it("X34-CTX-DA-CHOT the context already latched on z: never written over; the run_end is z's", async () => {
    const { ctx } = await ket({ ...P1, ctx0: { [CHOT]: Z } });
    expect(ctx[CHOT]).toEqual(Z);
    expect(khoaRunEnd()).toEqual([runEnd("z")]);
  });
  it("X34-DA-BAO the context latched on z and told (DA_BAO): no URGENT raised again", async () => {
    const { ctx } = await ket({ ...P1, ctx0: { [CHOT]: Z, [KET_CUC_KHONG_RO_DA_BAO_CTX_KEY]: { stepId: "z", at: Z.at } } });
    expect(H.alerts).toEqual([]);
    expect(ctx[CHOT]).toEqual(Z);
  });
  it("X34-GUI-LAI the same end again (a complete replayed): changed false, no URGENT more", async () => {
    await ket(P1);
    const n = H.alerts.length;
    const lai = await applyEdgeSegmentEnd(d as never, RUN, { outcome: "failed", error: `COMMAND_FAILED: step "y" failed${RONG}`, nodeCode: "EDGE-A", claimSeq: 1, def: { ref: "x34", name: "x34", steps: [move("x"), move("y")] } as never });
    expect(lai).toMatchObject({ changed: false });
    expect(H.alerts.length).toBe(n);
  });
  it("X34-TUTAP-KHONG-MOI (shape 2) a latch of central's set every unknown of which a confirmed STOP covers (xacNhanHetChot): no URGENT, yet the terminal patch still writes the latch key (nguon) and the list", async () => {
    const { KET_CUC_KHONG_RO_XAC_NHAN_CTX_KEY: XN } = await import("./foeKetCucKhongRo");
    const { r, ctx } = await ket({ so: [so("x")], rows: [hang("x"), hang("y", "completed")], ctx0: { [XN]: { x: { stopId: "st", at: "2026-11-20T00:00:00.000Z" } } } });
    expect(r).toMatchObject({ ok: true, status: "failed", changed: true });
    expect(H.alerts, "covered by a confirmed STOP: no URGENT is needed").toEqual([]);
    expect([ctx[CHOT]?.stepId, ctx[CHOT]?.nguon, ctx.foeOutcomeUnknown, ctx[KET_CUC_KHONG_RO_DA_BAO_CTX_KEY]]).toEqual(["x", "tapKetDoan", ["x"], undefined]);
  });
  it("X34-COMPLETED-CHUA-XONG completed while x's row runs: not_finished, nothing written (as before)", async () => {
    const { r } = await ket({ ...P1, outcome: "completed" });
    expect(r).toMatchObject({ ok: false, code: "not_finished" });
  });
  it("X34-HAI-TAP-SO (X34-HAI-TAP) the two readings of 'may have gone' on one picture, each by its own definition", async () => {
    const { tapKhongRoEdge, quyetDinhKetDoanEdge } = await import("./foeRunStore");
    const def = { ref: "x34t", name: "x34t", steps: [move("a"), move("b"), move("c")] } as never as WorkflowDefinition;
    const rows = [hang("a", "failed"), hang("b"), hang("c")];
    const muc = [so("a"), so("b", { resultReportedAt: new Date(), resultStatus: "acked" }), so("c")] as Array<{ stepId: string; supersededAt: unknown; resultStatus?: string | null }>;
    expect(tapKhongRoEdge({ def, rows: rows as never, uyQuyen: new Set(["a", "b", "c"]), stops: new Set() }).ids, "a final (failed) out; b running in, whatever its ledger result").toEqual(["b", "c"]);
    expect(quyetDinhKetDoanEdge({ runId: RUN, claimSeq: 1, def, hang: rows as never, so: { doc: "duoc", muc }, stops: new Set(), rider: "du", bao: [], ctx: {} }).khongRo, "a failed is not done; b's known result out").toEqual(["a", "c"]);
  });
});
