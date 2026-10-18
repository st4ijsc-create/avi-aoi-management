/**
 * Đợt 5.1 — cửa duyệt/bác THẬT (`thuTucDuyet` / `thuTucBac`) ghi QUYẾT ĐỊNH vào sổ phản hồi (`ghiQuyetDinhTuCuaDuyet`)
 * ĐÚNG khi hành động thật thành công, và không bao giờ khi nó thất bại. Lời gọi ghi bị chặn/ném KHÔNG được làm hỏng kết
 * quả duyệt/bác trả cho người dùng.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const goi = vi.hoisted(() => ({
  confirm: vi.fn(),
  cancel: vi.fn(),
  ghiQuyetDinh: vi.fn(async () => undefined),
}));

vi.mock("../../../_core/accessControl", () => ({ checkPermission: vi.fn(async () => true) }));
vi.mock("../../aiCopilotActions", () => ({ confirmAction: goi.confirm, cancelAction: goi.cancel }));
vi.mock("../phanHoi/thuTucPhanHoi", () => ({ ghiQuyetDinhTuCuaDuyet: goi.ghiQuyetDinh }));

import { thuTucBac, thuTucDuyet } from "./thuTucLuotChay";

const U = { id: 5, role: "engineer" };
const ACT = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

beforeEach(() => {
  goi.confirm.mockReset();
  goi.cancel.mockReset();
  goi.ghiQuyetDinh.mockReset().mockResolvedValue(undefined);
});

describe("cửa duyệt ⇒ quyết định 'duyet' vào sổ phản hồi", () => {
  it("duyệt áp được (executed) ⇒ ghi 'duyet' cho đúng người + actionId", async () => {
    goi.confirm.mockResolvedValue({ ok: true, status: "executed", result: { ok: true } });
    const kq = await thuTucDuyet(U, { actionId: ACT, lang: "vi" });
    expect(kq).toMatchObject({ ok: true, daGhi: true });
    expect(goi.ghiQuyetDinh).toHaveBeenCalledWith(expect.objectContaining({ id: 5 }), ACT, "duyet", null);
  });

  it("duyệt bị từ chối (denied) / bị hàng rào chặn ghi ⇒ KHÔNG ghi", async () => {
    goi.confirm.mockResolvedValue({ ok: false, status: "denied" });
    await thuTucDuyet(U, { actionId: ACT, lang: "vi" });
    goi.confirm.mockResolvedValue({ ok: true, status: "bi_tu_choi_ghi", result: { note: "DENIED_SECRET" } });
    await thuTucDuyet(U, { actionId: ACT, lang: "vi" });
    expect(goi.ghiQuyetDinh).not.toHaveBeenCalled();
  });

  it("ghi sổ phản hồi NÉM ⇒ kết quả duyệt vẫn trả nguyên vẹn", async () => {
    goi.confirm.mockResolvedValue({ ok: true, status: "executed", result: { ok: true } });
    goi.ghiQuyetDinh.mockRejectedValue(new Error("db"));
    await expect(thuTucDuyet(U, { actionId: ACT, lang: "vi" })).resolves.toMatchObject({ ok: true, daGhi: true });
  });
});

describe("cửa bác ⇒ quyết định 'bac' + lý do", () => {
  it("bác thành công ⇒ ghi 'bac' kèm lý do người gõ", async () => {
    goi.cancel.mockResolvedValue({ ok: true, status: "cancelled" });
    await thuTucBac(U, { actionId: ACT, lyDo: "  sai tên biến  " });
    expect(goi.ghiQuyetDinh).toHaveBeenCalledWith(expect.objectContaining({ id: 5 }), ACT, "bac", "sai tên biến");
  });

  it("bác thất bại (không phải của mình / đã xử lý) ⇒ KHÔNG ghi", async () => {
    goi.cancel.mockResolvedValue({ ok: false, status: "not_found" });
    await thuTucBac(U, { actionId: ACT, lyDo: "x" });
    expect(goi.ghiQuyetDinh).not.toHaveBeenCalled();
  });
});
