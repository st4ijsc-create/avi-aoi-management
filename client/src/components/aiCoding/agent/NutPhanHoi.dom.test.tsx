// @vitest-environment jsdom
//
// Đợt 5.1 — `NutPhanHoi` THẬT; chỉ mock i18n. Hàm gửi TIÊM (thay `agentTrpc.phanHoi`) ghi lại từng lượt gửi.
// Canh: hiển thị = kết quả THẬT của máy chủ (không lạc quan) · bấm lại = gỡ phiếu · 👎 ghi ngay rồi mới hỏi lý do ·
// lỗi ⇒ giữ phiếu cũ + báo · client chỉ gửi định danh (không gửi chữ câu trả lời / diff).
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string, d?: unknown) => (typeof d === "string" ? d : k) }),
}));

import { NutPhanHoi } from "./NutPhanHoi";
import type { DauVaoPhanHoi, KetQuaPhanHoi } from "@/lib/agentApi";

afterEach(cleanup);

const RUN = "11111111-2222-4333-8444-555555555555";

function guiGia(tra: (v: DauVaoPhanHoi) => KetQuaPhanHoi = (v) => ({ ok: true, ma: null, danhGia: v.danhGia })) {
  const goi: DauVaoPhanHoi[] = [];
  const fn = vi.fn(async (v: DauVaoPhanHoi) => {
    goi.push(v);
    return tra(v);
  });
  return { fn, goi };
}

async function bam(nhan: string) {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: nhan }));
  });
}

describe("NutPhanHoi — câu trả lời", () => {
  it("👍 ⇒ gửi {tra-loi, runId, chiSoTin, danhGia:1} (KHÔNG kèm chữ); bấm lại ⇒ gỡ (null)", async () => {
    const { fn, goi } = guiGia();
    render(<NutPhanHoi dich={{ loai: "tra-loi", runId: RUN, chiSoTin: 2 }} gui={fn} />);
    await bam("Hữu ích");
    expect(goi[0]).toEqual({ loai: "tra-loi", runId: RUN, chiSoTin: 2, danhGia: 1 });
    expect(screen.getByRole("button", { name: "Hữu ích" })).toHaveAttribute("aria-pressed", "true");
    await bam("Hữu ích");
    expect(goi[1]).toMatchObject({ danhGia: null });
    expect(screen.getByRole("button", { name: "Hữu ích" })).toHaveAttribute("aria-pressed", "false");
  });

  it("👎 ⇒ ghi -1 NGAY, rồi mở ô lý do; gửi lý do ⇒ -1 + lyDo đã trim", async () => {
    const { fn, goi } = guiGia();
    render(<NutPhanHoi dich={{ loai: "tra-loi", runId: RUN, chiSoTin: 0 }} gui={fn} />);
    await bam("Chưa tốt");
    expect(goi[0]).toMatchObject({ danhGia: -1 });
    expect(goi[0]).not.toHaveProperty("lyDo");
    const o = screen.getByRole("textbox", { name: "Vì sao chưa tốt? (tuỳ chọn)" });
    fireEvent.change(o, { target: { value: "  sai API  " } });
    await bam("Gửi lý do");
    expect(goi[1]).toEqual({ loai: "tra-loi", runId: RUN, chiSoTin: 0, danhGia: -1, lyDo: "sai API" });
    expect(screen.getByText("Đã ghi lý do.")).toBeInTheDocument();
  });

  it("máy chủ từ chối ⇒ phiếu GIỮ NGUYÊN (không lạc quan) + câu lỗi theo mã", async () => {
    const { fn } = guiGia(() => ({ ok: false, ma: "NOT_FOUND", danhGia: null }));
    render(<NutPhanHoi dich={{ loai: "tra-loi", runId: RUN, chiSoTin: 9 }} danhGiaBanDau={null} gui={fn} />);
    await bam("Hữu ích");
    expect(screen.getByRole("button", { name: "Hữu ích" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("alert")).toHaveTextContent("Không tìm thấy");
  });

  it("mạng ném ⇒ câu lỗi chung, không vỡ", async () => {
    const fn = vi.fn(async () => {
      throw new Error("mất mạng");
    });
    render(<NutPhanHoi dich={{ loai: "tra-loi", runId: RUN, chiSoTin: 0 }} gui={fn} />);
    await bam("Chưa tốt");
    expect(screen.getByRole("alert")).toHaveTextContent("Không ghi được phản hồi");
    expect(screen.queryByRole("textbox")).toBeNull();
  });
});

describe("NutPhanHoi — diff", () => {
  it("gửi {diff, actionId}; hiển thị theo `danhGia` máy chủ trả (không theo nút bấm)", async () => {
    const { fn, goi } = guiGia(() => ({ ok: true, ma: null, danhGia: null }));
    render(<NutPhanHoi dich={{ loai: "diff", actionId: "act-1" }} danhGiaBanDau={-1} gui={fn} />);
    expect(screen.getByRole("button", { name: "Chưa tốt" })).toHaveAttribute("aria-pressed", "true");
    await bam("Hữu ích");
    expect(goi[0]).toEqual({ loai: "diff", actionId: "act-1", danhGia: 1 });
    // máy chủ trả null ⇒ không nút nào được chọn
    expect(screen.getByRole("button", { name: "Hữu ích" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Chưa tốt" })).toHaveAttribute("aria-pressed", "false");
  });
});
