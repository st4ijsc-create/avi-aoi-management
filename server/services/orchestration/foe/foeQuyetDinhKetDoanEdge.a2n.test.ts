/**
 * T4 bước 3 (HST 14/11) — ca của hàm thuần `quyetDinhKetDoanEdge`, viết TRƯỚC mã, theo bảng 16 ô (`thuc-thi\T4\bang-truong-hop-held.md`) và đặc tả
 * (`thuc-thi\T4\dac-ta-ham-thuan.md`, kể cả các mục "HST duyệt" / "HST xác nhận"). Ca gọi THẲNG hàm: không DB, không mạng, không đồng hồ.
 *
 * Độ rộng của đầu ra (HST xác nhận 14/11): U (`khongRo`) RỘNG (thừa không sao, thiếu là ★); C, N, S, `soLoiChung`, `buTruCanNguoi` ĐÚNG ⇒ với C, N, S
 * mọi ca so ĐÚNG cả tập (`toEqual` trên tập đã sắp), không dùng `toContain`. Ô #8 (Q2) không có ca ở đây: HST 14/11, Q2 đi cùng lô client; ca `it.fails`
 * của ô đó nằm ở `foeHeldRiderThieu.a2n.test.ts` (đường tích hợp, URGENT chung).
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../db/connection", () => ({ getDb: async () => null, isEdgeProcessRole: () => false }));

import { FOE_STOP_NOT_SENT, quyetDinhKetDoanEdge, stopChuaRaTuHang } from "./foeRunStore";
import { KET_CUC_KHONG_RO_CHOT_CTX_KEY, KHONG_CO_BU_TRU, type BaoCaoKhongRoEdge } from "./foeKetCucKhongRo";
import type { WorkflowDefinition, WorkflowStep } from "./workflowModel";

type VaoHam = Parameters<typeof quyetDinhKetDoanEdge>[0];
type RaHam = ReturnType<typeof quyetDinhKetDoanEdge>;

const RUN = 9;
const MA = "FOE_OUTCOME_UNKNOWN";
const move = (id: string, compensation?: WorkflowStep): WorkflowStep =>
  ({ id, type: "command", machineId: 2, command: "run_job", args: { robotId: 2, jobType: "move", params: { x: 1 } }, ...(compensation ? { compensation } : {}) }) as never;
const otStop = (id: string): WorkflowStep => ({ id, type: "command", machineId: 1, command: "stop", args: { tagKey: "halt", value: true } }) as never;
const dinhNghia = (...steps: WorkflowStep[]): WorkflowDefinition => ({ ref: "t4b3", name: "t4b3", steps }) as never;

/** một mục sổ 0372: uỷ quyền, chưa supersede, chưa có kết quả (ghi đè bằng `x`) */
const uq = (stepId: string, x: Record<string, unknown> = {}) => ({ stepId, supersededAt: null, resultStatus: null, ...x });
const hangChay = (stepId: string) => ({ stepId, stepType: "command", status: "running", error: null, resultJson: { routedTo: "robot-dispatcher" } });
const hangXong = (stepId: string) => ({ stepId, stepType: "command", status: "completed", error: null, resultJson: null });
/** hàng `failed` đã final, mất mã (lỗi thiết bị thường, không có FOE_OUTCOME_UNKNOWN) */
const hangHongMatMa = (stepId: string) => ({ stepId, stepType: "command", status: "failed", error: "ROBOT_FAULT: gripper", resultJson: null });
/** hàng của STOP: lần thử bị dispatcher từ chối, là chữ cuối của hàng (vế 2 của laHangChuaRa) ⇒ nợ CHỈ khi run đã chốt */
const hangStopTuChoi = (stepId: string) => ({
  stepId,
  stepType: "command",
  status: "running",
  error: null,
  resultJson: { routedTo: "ot-dispatcher", accepted: false, status: "rejected", detail: { edge: true, reason: "ADAPTER_OFFLINE" } },
});
/** hàng của STOP ở trạng thái C (mã FOE_STOP_NOT_SENT): nợ dù run chưa chốt */
const hangStopTrangThaiC = (stepId: string) => ({ stepId, stepType: "command", status: "failed", error: `${FOE_STOP_NOT_SENT}: adapter offline`, resultJson: null });
const bao = (loai: BaoCaoKhongRoEdge["loai"], stepId: string, compId = KHONG_CO_BU_TRU): BaoCaoKhongRoEdge => ({ loai, stepId, compId, ma: MA, claimSeq: 1 });

const goi = (x: Partial<VaoHam> & { def: WorkflowDefinition }): RaHam =>
  quyetDinhKetDoanEdge({ runId: RUN, claimSeq: 1, hang: [], so: { doc: "duoc", muc: [] }, stops: new Set(), rider: "thieu", bao: [], ctx: {}, ...x });
/** N và S cùng nhau, đúng tập (đã sắp): `loai:stepId:compId` */
const cb = (r: RaHam) => r.canhBao.map((b) => `${b.loai}:${b.stepId}:${b.compId}`).sort();
const N = (id: string) => `noCompensation:${id}:${KHONG_CO_BU_TRU}`;
const S = (id: string) => `stopNotSent:${id}:${KHONG_CO_BU_TRU}`;

describe("T4 bước 3 — quyetDinhKetDoanEdge theo bảng 16 ô", () => {
  it("T4-B3-O1 (#1) hàng running, sổ uỷ quyền chưa có kết quả, rider thiếu: U, C, N — mỗi URGENT đúng khoá và mã", () => {
    const r = goi({ def: dinhNghia(move("x")), hang: [hangChay("x")], so: { doc: "duoc", muc: [uq("x")] } });
    expect(r.khongRo).toEqual(["x"]);
    expect(r.chot).toEqual({ stepId: "x", ma: MA });
    expect(r.canhBao).toEqual([{ loai: "noCompensation", stepId: "x", compId: KHONG_CO_BU_TRU, ma: MA, claimSeq: 1 }]);
    expect(r.soLoiChung).toBe(false);
    expect(r.buTruCanNguoi).toEqual([]);
  });

  it("T4-B3-O2 (#2) hàng failed final CÓ mã FOE_OUTCOME_UNKNOWN, sổ ghi timeout (không phải kết quả đã biết): U, C, N", () => {
    const r = goi({ def: dinhNghia(move("x")), hang: [{ ...hangHongMatMa("x"), error: "FOE_OUTCOME_UNKNOWN: robot timeout" }], so: { doc: "duoc", muc: [uq("x", { resultStatus: "timeout" })] } });
    expect(r.khongRo).toEqual(["x"]);
    expect(r.chot).toEqual({ stepId: "x", ma: MA });
    expect(cb(r)).toEqual([N("x")]);
  });

  it("T4-B3-O3 (#3) hàng failed final MẤT mã, sổ uỷ quyền chưa có kết quả: U, C, N", () => {
    const r = goi({ def: dinhNghia(move("x")), hang: [hangHongMatMa("x")], so: { doc: "duoc", muc: [uq("x")] } });
    expect(r.khongRo).toEqual(["x"]);
    expect(r.chot).toEqual({ stepId: "x", ma: MA });
    expect(cb(r)).toEqual([N("x")]);
    expect(r.buTruCanNguoi).toEqual([]);
  });

  it("T4-B3-O4 (#4 đúng nghĩa, I-1) hàng failed mất mã, STOP chỉ nợ khi run ĐÃ chốt: chốt đặt trước, nợ đọc với chốt đó ⇒ đúng một S", () => {
    const hang = [hangHongMatMa("x"), hangStopTuChoi("nt")];
    expect([...stopChuaRaTuHang(hang, {})], "tiền đề: run chưa chốt ⇒ lần thử bị từ chối không phải nợ; hàng mất mã không tự chốt").toEqual([]);
    const r = goi({ def: dinhNghia(move("x"), otStop("nt")), hang, so: { doc: "duoc", muc: [uq("x")] }, stops: new Set(["nt"]) });
    expect(r.khongRo, "STOP không bao giờ vào U (L-7)").toEqual(["x"]);
    expect(r.chot).toEqual({ stepId: "x", ma: MA });
    expect(cb(r)).toEqual([N("x"), S("nt")]);
    expect(r.canhBao.find((b) => b.loai === "stopNotSent")).toEqual({ loai: "stopNotSent", stepId: "nt", compId: KHONG_CO_BU_TRU, ma: MA, claimSeq: 1, biet: true });
  });

  it("T4-B3-O4-KHONG-CHOT (#4, phía phủ định) lệnh đã xong và sổ acked ⇒ không chốt ⇒ cùng hàng STOP ấy KHÔNG nợ, không S", () => {
    const r = goi({ def: dinhNghia(move("x"), otStop("nt")), hang: [hangXong("x"), hangStopTuChoi("nt")], so: { doc: "duoc", muc: [uq("x", { resultStatus: "acked" })] }, stops: new Set(["nt"]) });
    expect(r.khongRo).toEqual([]);
    expect(r.chot).toBeNull();
    expect(cb(r)).toEqual([]);
  });

  it("T4-B3-O5 (#5, ★2) lệnh KHÔNG có hàng, sổ uỷ quyền chưa có kết quả, rider thiếu: U, C, N", () => {
    const r = goi({ def: dinhNghia(move("x")), so: { doc: "duoc", muc: [uq("x")] } });
    expect(r.khongRo).toEqual(["x"]);
    expect(r.chot).toEqual({ stepId: "x", ma: MA });
    expect(cb(r)).toEqual([N("x")]);
  });

  it("T4-B3-O6 (#6, R1) như #5 nhưng rider ĐỌC ĐƯỢC và im về x: central vẫn tự phát N và đặt C (H3: không tin nút một mình)", () => {
    const r = goi({ def: dinhNghia(move("x")), so: { doc: "duoc", muc: [uq("x")] }, rider: "du", bao: [] });
    expect(r.khongRo).toEqual(["x"]);
    expect(r.chot).toEqual({ stepId: "x", ma: MA });
    expect(cb(r)).toEqual([N("x")]);
  });

  it("T4-B3-O7 (#7) sổ ĐỌC LỖI: lệnh có hàng chưa xong vẫn tính (U, C, N, soLoiChung); lệnh KHÔNG có hàng thì không tính (luật 2, Q2)", () => {
    const r = goi({ def: dinhNghia(move("x"), move("z")), hang: [hangChay("x")], so: { doc: "loi" } });
    expect(r.khongRo).toEqual(["x"]);
    expect(r.chot).toEqual({ stepId: "x", ma: MA });
    expect(cb(r)).toEqual([N("x")]);
    expect(r.soLoiChung).toBe(true);
  });

  it("T4-B3-O9 (#9) sổ đọc lỗi, có STOP nợ: U chỉ có lệnh (STOP KHÔNG vào U), C, N, S", () => {
    const r = goi({ def: dinhNghia(move("x"), otStop("nt")), hang: [hangChay("x"), hangStopTuChoi("nt")], so: { doc: "loi" }, stops: new Set(["nt"]) });
    expect(r.khongRo).toEqual(["x"]);
    expect(r.chot).toEqual({ stepId: "x", ma: MA });
    expect(cb(r)).toEqual([N("x"), S("nt")]);
    expect(r.soLoiChung).toBe(true);
  });

  it("T4-B3-O10 (#10, phủ định) hàng completed, sổ acked: không U, không C, không N", () => {
    const r = goi({ def: dinhNghia(move("x")), hang: [hangXong("x")], so: { doc: "duoc", muc: [uq("x", { resultStatus: "acked" })] } });
    expect(r).toEqual({ khongRo: [], chot: null, canhBao: [], soLoiChung: false, buTruCanNguoi: [] });
  });

  it("T4-B3-O11 (#11, I-A) không có hàng, sổ ghi rejected: không U, không C, không N (so cả tập)", () => {
    const r = goi({ def: dinhNghia(move("x")), so: { doc: "duoc", muc: [uq("x", { resultStatus: "rejected" })] } });
    expect(r).toEqual({ khongRo: [], chot: null, canhBao: [], soLoiChung: false, buTruCanNguoi: [] });
  });

  it("T4-B3-O11-ACKED (I-A, hệ quả rộng) hàng running nhưng sổ đã có kết quả acked: không C, không N cho x", () => {
    const r = goi({ def: dinhNghia(move("x")), hang: [hangChay("x")], so: { doc: "duoc", muc: [uq("x", { resultStatus: "acked" })] } });
    expect(r.chot).toBeNull();
    expect(cb(r)).toEqual([]);
    expect(r.khongRo).toEqual([]);
  });

  it("T4-B3-O12 (#12, phủ định) không có hàng, sổ không có mục: không U, không C, không N", () => {
    const r = goi({ def: dinhNghia(move("x")), so: { doc: "duoc", muc: [] } });
    expect(r).toEqual({ khongRo: [], chot: null, canhBao: [], soLoiChung: false, buTruCanNguoi: [] });
  });

  it("T4-B3-O13 (#13, phía S) rider đọc được đã báo stopNotSent của STOP nợ: central KHÔNG phát S thứ hai (cùng loai/stepId/compId)", () => {
    const r = goi({ def: dinhNghia(otStop("nt")), hang: [hangStopTrangThaiC("nt")], stops: new Set(["nt"]), rider: "du", bao: [bao("stopNotSent", "nt")] });
    expect(r.khongRo).toEqual([]);
    expect(r.chot, "bao đặt chốt, hàm không đặt").toBeNull();
    expect(cb(r)).toEqual([]);
  });

  it("T4-B3-O13B (m-7, R1) rider đọc được mà IM về STOP đang nợ: central tự phát đúng một S", () => {
    const r = goi({ def: dinhNghia(otStop("nt")), hang: [hangStopTrangThaiC("nt")], stops: new Set(["nt"]), rider: "du", bao: [] });
    expect(r.khongRo).toEqual([]);
    expect(r.chot).toBeNull();
    expect(cb(r)).toEqual([S("nt")]);
  });

  it("T4-B3-O14 (#14, M-7) rider có phần tử hỏng bị bộ tách đọc là NGUYÊN VẸN, không báo cáo (rider du, bao rỗng): central vẫn phát phần còn thiếu — U, C, N", () => {
    const r = goi({ def: dinhNghia(move("x")), hang: [hangChay("x")], so: { doc: "duoc", muc: [uq("x")] }, rider: "du", bao: [] });
    expect(r.khongRo).toEqual(["x"]);
    expect(r.chot).toEqual({ stepId: "x", ma: MA });
    expect(cb(r)).toEqual([N("x")]);
  });

  it("T4-B3-O15 (#15) rider bị cắt, còn sót báo cáo đầu (stopNotSent của n1): chốt là của bao; STOP nt chỉ nợ nhờ chốt đó ⇒ S cho nt, không S thứ hai cho n1", () => {
    const hang = [hangStopTrangThaiC("n1"), hangStopTuChoi("nt")];
    expect([...stopChuaRaTuHang(hang, {})], "tiền đề: chưa chốt ⇒ chỉ n1 nợ").toEqual(["n1"]);
    const r = goi({ def: dinhNghia(otStop("n1"), otStop("nt")), hang, stops: new Set(["n1", "nt"]), rider: "thieu", bao: [bao("stopNotSent", "n1")] });
    expect(r.khongRo).toEqual([]);
    expect(r.chot).toBeNull();
    expect(cb(r)).toEqual([S("nt")]);
  });

  it("T4-B3-O16 (#16, R2) lệnh CÓ bù trừ: U, C; KHÔNG N; buTruCanNguoi nêu đúng lệnh đó", () => {
    const r = goi({ def: dinhNghia(move("x", move("cx"))), hang: [hangChay("x")], so: { doc: "duoc", muc: [uq("x")] } });
    expect(r.khongRo).toEqual(["x"]);
    expect(r.chot).toEqual({ stepId: "x", ma: MA });
    expect(cb(r)).toEqual([]);
    expect(r.buTruCanNguoi).toEqual(["x"]);
  });
});

describe("T4 bước 3 — R2 (a) (chủ dự án 14/11): cổng người + lý do", () => {
  it("T4-B3-O16-STOP (R2 (a) điều kiện 4, L-7) lệnh có bù trừ là STOP: KHÔNG vào buTruCanNguoi (STOP không đi qua cổng người + lý do); vẫn ở U, không N", () => {
    const r = goi({ def: dinhNghia(move("x", otStop("cs"))), hang: [hangChay("x")], so: { doc: "duoc", muc: [uq("x")] }, stops: new Set(["cs"]) });
    expect(r.khongRo).toEqual(["x"]);
    expect(r.chot).toEqual({ stepId: "x", ma: MA });
    expect(cb(r)).toEqual([]);
    expect(r.buTruCanNguoi).toEqual([]);
  });
  it("T4-B3-O16-HAI (R2 (a)) hai lệnh có bù trừ, chỉ một lệnh có thể đã đi: buTruCanNguoi nêu ĐÚNG lệnh đó (cặp duyệt không mở cho bù trừ khác)", () => {
    const r = goi({ def: dinhNghia(move("x", move("cx")), move("y", move("cy"))), hang: [hangChay("x"), hangXong("y")], so: { doc: "duoc", muc: [uq("x"), uq("y", { resultStatus: "acked" })] } });
    expect(r.buTruCanNguoi).toEqual(["x"]);
  });
});

describe("T4 bước 3 — các ca bắt buộc thêm (R1, phần hợp U, chốt có sẵn)", () => {
  it("T4-B3-DU-DA-BAO (R1, phủ định) rider đủ VÀ đã báo noCompensation của x: central không phát thêm, không đặt chốt", () => {
    const r = goi({ def: dinhNghia(move("x")), hang: [hangChay("x")], so: { doc: "duoc", muc: [uq("x")] }, rider: "du", bao: [bao("noCompensation", "x")] });
    expect(r.khongRo).toEqual(["x"]);
    expect(r.chot).toBeNull();
    expect(cb(r)).toEqual([]);
  });

  it("T4-B3-DU-MOT-PHAN (R1) rider đủ nhưng chỉ báo x, y cũng có thể đã đi: central chỉ phát phần còn thiếu (y)", () => {
    const r = goi({ def: dinhNghia(move("x"), move("y")), hang: [hangChay("x"), hangChay("y")], so: { doc: "duoc", muc: [uq("x"), uq("y")] }, rider: "du", bao: [bao("noCompensation", "x")] });
    expect(r.khongRo).toEqual(["x", "y"]);
    expect(r.chot).toBeNull();
    expect(cb(r)).toEqual([N("y")]);
  });

  it("T4-B3-U-HOP (luật 3) U = tập bước 2 ∪ ctx.foeOutcomeUnknown trừ STOP, theo thứ tự định nghĩa; C và N CHỈ từ tập bước 2", () => {
    const r = goi({ def: dinhNghia(move("w"), move("x"), otStop("nt")), hang: [hangChay("x")], so: { doc: "duoc", muc: [uq("x")] }, stops: new Set(["nt"]), ctx: { foeOutcomeUnknown: ["nt", "w"] } });
    expect(r.khongRo).toEqual(["w", "x"]);
    expect(r.chot).toEqual({ stepId: "x", ma: MA });
    expect(cb(r)).toEqual([N("x")]);
  });

  it("T4-B3-CHOT-CO-SAN (luật 4) run đã có chốt: hàm không đặt chốt mới, N vẫn phát", () => {
    const r = goi({ def: dinhNghia(move("x")), hang: [hangChay("x")], so: { doc: "duoc", muc: [uq("x")] }, ctx: { [KET_CUC_KHONG_RO_CHOT_CTX_KEY]: { stepId: "z", ma: MA, at: "t" } } });
    expect(r.chot).toBeNull();
    expect(r.khongRo).toEqual(["x"]);
    expect(cb(r)).toEqual([N("x")]);
  });

  it("T4-B3-SO-SUPERSEDE (luật 2) mục sổ đã supersede không làm lệnh 'có thể đã đi'", () => {
    const r = goi({ def: dinhNghia(move("x")), so: { doc: "duoc", muc: [uq("x", { supersededAt: "2026-11-14T00:00:00Z" })] } });
    expect(r).toEqual({ khongRo: [], chot: null, canhBao: [], soLoiChung: false, buTruCanNguoi: [] });
  });
});

// Đ-3 (chu-du-an-HST 15/11, P2): cặp (x, cx) ĐÃ DUYỆT (ctx) VÀ cx có mục sổ uỷ quyền chưa supersede (cx đã đi) không còn "chờ người": không vào buTruCanNguoi, và được nói thật bằng
// approvedNotConfirmed (luật của foeEngine.ts:1333: bù trừ đã duyệt, đã giao, kết cục chưa xác nhận). Ca đường thật: T4-B3-HELD-DA-GUI ở foeRunStoreParity.dot10.test.ts.
describe("T4 bước 3 — Đ-3 (P2): cặp đã duyệt và đã gửi", () => {
  const duyet = { foeKetCucKhongRoDuyet: { stepId: "x", buTru: [{ stepId: "x", compId: "cx" }], by: 12, at: "2026-11-15T00:00:00Z" } };
  const ctxDuyet = { foeOutcomeUnknown: ["x"], ...duyet };
  const dd = dinhNghia(move("x", move("cx")));
  const ACN = (s: string, c: string) => `approvedNotConfirmed:${s}:${c}`;
  it("T4-B3-HELD-DA-GUI-TT (a)(b) đã duyệt + cx có mục sổ chưa supersede: KHÔNG buTruCanNguoi; ĐÚNG MỘT approvedNotConfirmed(x/cx), claim của đoạn", () => {
    const r = goi({ def: dd, hang: [hangChay("x")], so: { doc: "duoc", muc: [uq("x"), uq("cx", { resultStatus: "acked" })] }, ctx: ctxDuyet, claimSeq: 3 });
    expect(r.buTruCanNguoi).toEqual([]);
    expect(cb(r)).toEqual([ACN("x", "cx")]);
    expect(r.canhBao.find((b) => b.loai === "approvedNotConfirmed")).toEqual({ loai: "approvedNotConfirmed", stepId: "x", compId: "cx", ma: MA, claimSeq: 3 });
  });
  it("T4-B3-HELD-DA-GUI-CHUA-DUYET có mục sổ chưa supersede nhưng CHƯA ai duyệt cặp: vẫn chờ người (buTruCanNguoi nêu x), không approvedNotConfirmed", () => {
    const r = goi({ def: dd, hang: [hangChay("x")], so: { doc: "duoc", muc: [uq("x"), uq("cx", { resultStatus: "acked" })] }, ctx: { foeOutcomeUnknown: ["x"] } });
    expect(r.buTruCanNguoi).toEqual(["x"]);
    expect(cb(r)).not.toContain(ACN("x", "cx"));
  });
  it("T4-B3-HELD-DA-GUI-SO-LOI đã duyệt nhưng sổ đọc lỗi (muc null): giữ như trước (buTruCanNguoi nêu x), không approvedNotConfirmed", () => {
    const r = goi({ def: dd, hang: [hangChay("x")], so: { doc: "loi" }, ctx: ctxDuyet });
    expect(r.buTruCanNguoi).toEqual(["x"]);
    expect(cb(r)).not.toContain(ACN("x", "cx"));
  });
  it("T4-B3-HELD-DA-GUI-CHUA-GUI đã duyệt nhưng cx CHƯA có mục sổ (chưa gửi): vẫn chờ giao (buTruCanNguoi nêu x), không approvedNotConfirmed", () => {
    const r = goi({ def: dd, hang: [hangChay("x")], so: { doc: "duoc", muc: [uq("x")] }, ctx: ctxDuyet });
    expect(r.buTruCanNguoi).toEqual(["x"]);
    expect(cb(r)).not.toContain(ACN("x", "cx"));
  });
  it("T4-B3-HELD-DA-GUI-SUPERSEDE đã duyệt, mục sổ của cx ĐÃ supersede (không còn là lần gửi hiện hành): như chưa gửi, vẫn buTruCanNguoi", () => {
    const r = goi({ def: dd, hang: [hangChay("x")], so: { doc: "duoc", muc: [uq("x"), uq("cx", { supersededAt: "2026-11-14T00:00:00Z", resultStatus: "acked" })] }, ctx: ctxDuyet });
    expect(r.buTruCanNguoi).toEqual(["x"]);
    expect(cb(r)).not.toContain(ACN("x", "cx"));
  });
  it("T4-B3-HELD-DA-GUI-RIDER rider đã báo approvedNotConfirmed(x/cx): bộ lọc (7) bỏ báo cáo của central, không phát hai lần", () => {
    const r = goi({ def: dd, hang: [hangChay("x")], so: { doc: "duoc", muc: [uq("x"), uq("cx", { resultStatus: "acked" })] }, ctx: ctxDuyet, bao: [bao("approvedNotConfirmed", "x", "cx")] });
    expect(cb(r)).not.toContain(ACN("x", "cx"));
    expect(r.buTruCanNguoi).toEqual([]);
  });
});

// HST 15/11, P2 lần vá cuối: "cx đã xong" khớp TRUNG TÂM (#18) và CHỈ theo vế HÀNG: hàng cx ở `compensated` (foeEngine.ts:3523). Trung tâm chỉ phát approvedNotConfirmed khi runCompensation trả kết quả khác ok/held/paused
// (foeEngine.ts:1331-1333); đối chứng đo: T4-B3-P2-DOI-CHUNG-TT (parity). Vế SỔ bị bỏ: sổ ok mà hàng chưa chốt đúng là ca HELD-DA-GUI (đường thật), nên không dùng làm tiêu chí. `daGui` còn lọc `v.stops` (cx là STOP không vào).
describe("T4 bước 3 — P2: cx đã xong / thất bại / là STOP (chu-du-an-HST 15/11)", () => {
  const duyet = { foeKetCucKhongRoDuyet: { stepId: "x", buTru: [{ stepId: "x", compId: "cx" }], by: 12, at: "2026-11-15T00:00:00Z" } };
  const ctxDuyet = { foeOutcomeUnknown: ["x"], ...duyet };
  const dd = dinhNghia(move("x", move("cx")));
  const ACN = `approvedNotConfirmed:x:cx`;
  const hangCxXong = { stepId: "cx", stepType: "command", status: "compensated", error: null, resultJson: { routedTo: "ot-dispatcher", status: "simulated" } };
  const hangX = { ...hangHongMatMa("x"), error: "FOE_OUTCOME_UNKNOWN: timeout" };
  it("T4-B3-P2-CX-XONG-HANG hàng cx `compensated` (trung tâm: ok): không approvedNotConfirmed, không chờ người", () => {
    const r = goi({ def: dd, hang: [hangX, hangCxXong], so: { doc: "duoc", muc: [uq("x"), uq("cx")] }, ctx: ctxDuyet, claimSeq: 3 });
    expect(cb(r)).not.toContain(ACN);
    expect(r.buTruCanNguoi).toEqual([]);
  });
  // giới hạn đã biết hướng ĐÓNG: sổ ok mà hàng chưa chốt ⇒ vẫn approvedNotConfirmed; tiêu chí nghiệm thu SG-T1; chu-du-an-HST 15/11
  it.fails("T4-B3-P2-CX-XONG-SO (giới hạn đã biết hướng đóng; SG-T1) sổ ghi cx với kết quả ok nhưng hàng chưa chốt: kỳ vọng ĐÚNG là không approvedNotConfirmed", () => {
    const r = goi({ def: dd, hang: [hangChay("x")], so: { doc: "duoc", muc: [uq("x"), uq("cx", { resultStatus: "acked_verified" })] }, ctx: ctxDuyet, claimSeq: 3 });
    expect(cb(r)).not.toContain(ACN);
  });
  it("T4-B3-P2-CX-THAT-BAI-HANG hàng cx `failed` (trung tâm: không ok): VẪN có approvedNotConfirmed, không im, không chờ người", () => {
    const r = goi({ def: dd, hang: [hangX, hangHongMatMa("cx")], so: { doc: "duoc", muc: [uq("x"), uq("cx")] }, ctx: ctxDuyet, claimSeq: 3 });
    expect(cb(r).filter((k) => k === ACN)).toEqual([ACN]);
    expect(r.buTruCanNguoi).toEqual([]);
  });
  // thừa noCompensation:cx (cx vào coTheDi vì hàng chưa xong, sổ chưa có kết quả), hướng ĐÓNG, không ★ (HST 15/11); SG-T1
  it.fails("T4-B3-P2-CX-THAT-BAI-HANG-MOT (giới hạn đã biết hướng đóng; SG-T1) hàng cx `failed`: kỳ vọng ĐÚNG là ĐÚNG MỘT URGENT về cx (hiện thêm noCompensation:cx)", () => {
    const r = goi({ def: dd, hang: [hangX, hangHongMatMa("cx")], so: { doc: "duoc", muc: [uq("x"), uq("cx")] }, ctx: ctxDuyet, claimSeq: 3 });
    expect(cb(r)).toEqual([ACN]);
  });
  it("T4-B3-P2-CX-THAT-BAI-SO sổ ghi cx với kết quả thất bại (rejected/timeout/failed): VẪN đúng một approvedNotConfirmed, không im, không chờ người", () => {
    for (const st of ["rejected", "timeout", "failed"]) {
      const r = goi({ def: dd, hang: [hangChay("x")], so: { doc: "duoc", muc: [uq("x"), uq("cx", { resultStatus: st })] }, ctx: ctxDuyet, claimSeq: 3 });
      expect(cb(r).filter((k) => k === ACN), st).toEqual([ACN]);
      expect(r.buTruCanNguoi, st).toEqual([]);
    }
  });
  it("T4-B3-P2-CX-STOP cx là STOP ghim có nợ chưa ra: không vào daGui (không câu 'approved by a Continue'), đúng MỘT URGENT cho cx (stopNotSent)", () => {
    const r = goi({ def: dinhNghia(move("x", otStop("cx"))), hang: [hangChay("x"), hangStopTuChoi("cx")], so: { doc: "duoc", muc: [uq("x"), uq("cx")] }, ctx: ctxDuyet, stops: new Set(["cx"]), claimSeq: 3 });
    expect(cb(r)).toEqual(["stopNotSent:x:cx"]);
  });
});

// kiem-dinh S1 (chu-du-an-HST 15/11): approvedNotConfirmed CHỈ cho x còn trong tapU. Đột biến: bỏ `tapU.has(id)` ở dòng đẩy approvedNotConfirmed (foeRunStore.ts ~2096)
describe("T4 bước 3 — kiem-dinh S1: approvedNotConfirmed chỉ cho x còn ở tapU", () => {
  it("T4-B3-S1-NGOAI-TAPU cặp x/cx đã duyệt và cx có mục sổ chưa supersede, nhưng x KHÔNG còn 'có thể đã đi' (hàng completed, sổ có kết quả, không trong foeOutcomeUnknown): KHÔNG approvedNotConfirmed", () => {
    const duyet = { foeKetCucKhongRoDuyet: { stepId: "x", buTru: [{ stepId: "x", compId: "cx" }], by: 12, at: "2026-11-15T00:00:00Z" } };
    const r = goi({ def: dinhNghia(move("x", move("cx"))), hang: [hangXong("x")], so: { doc: "duoc", muc: [uq("x", { resultStatus: "acked" }), uq("cx")] }, ctx: duyet, claimSeq: 3 });
    expect(r.khongRo, "x is no longer a command that may have gone").not.toContain("x");
    expect(cb(r)).not.toContain("approvedNotConfirmed:x:cx");
  });
});
