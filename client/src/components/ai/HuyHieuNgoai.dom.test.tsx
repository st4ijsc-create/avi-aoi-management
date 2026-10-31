// @vitest-environment jsdom
//
// Đợt 10.4b (L0b) — nhãn "ngoài · gửi dữ liệu ra <ncc>" + huy hiệu model/token/chi phí MỖI lượt; hộp đồng ý (thuần trình bày).
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (_k: string, d?: unknown) => (typeof d === "string" ? d : _k) }) }));

import { HuyHieuNgoai } from "./HuyHieuNgoai";
import { HopDongYNgoai, type ThongTinNgoai } from "./HopDongYNgoai";

afterEach(cleanup);

describe("HuyHieuNgoai", () => {
  it("nhãn 'ngoài · gửi dữ liệu ra <ncc>' + model · ~tổng token · ~$chi phí", () => {
    render(<HuyHieuNgoai vet={{ nhaCungCap: "anthropic", model: "claude-x", tokenVao: 1000, tokenRa: 234, chiPhiUocUsd: 0.01234 }} />);
    expect(screen.getByTestId("nhan-ngoai").textContent).toBe("ngoài · gửi dữ liệu ra anthropic");
    expect(screen.getByTestId("vet-ngoai").textContent).toBe("claude-x · ~1.234 token · ~$0.0123");
  });
  it("thiếu token/chi phí ⇒ chỉ model (không bịa số); chuỗi từ máy chủ là chữ (không HTML)", () => {
    const { container } = render(<HuyHieuNgoai vet={{ nhaCungCap: "<b>x</b>", model: "<img src=x onerror=alert(1)>" }} />);
    expect(screen.getByTestId("vet-ngoai").textContent).toBe("<img src=x onerror=alert(1)>");
    expect(container.querySelector("img, b")).toBeNull();
  });
  it("lượt lỗi vẫn hiện (đỏ) — N5", () => {
    render(<HuyHieuNgoai vet={{ nhaCungCap: "openai", model: "m", tokenVao: 5, tokenRa: null }} loi />);
    expect(screen.getByTestId("huy-hieu-ngoai").className).toContain("text-red-700");
  });
});

const TT = (o: Partial<ThongTinNgoai> = {}): ThongTinNgoai => ({
  nhaCungCap: "openai_compat",
  model: "gpt-x",
  duocPhep: true,
  mucDuLieu: "van-hanh",
  choDuLieuVanHanh: true,
  conLaiTranNgay: { nguoi: { token: null }, nhaMay: { duTranChoLuotNay: true } },
  dinhKemBiCam: true,
  ...o,
});

describe("HopDongYNgoai", () => {
  const dung = (thongTin: ThongTinNgoai | undefined, p: Partial<{ dangTai: boolean; loi: string; beMat: "chat" | "coding" | "agent" }> = {}) => {
    const onDongY = vi.fn();
    const onTuChoi = vi.fn();
    render(<HopDongYNgoai ma="ngoai:openai_compat:gpt-x" beMat={p.beMat ?? "chat"} thongTin={thongTin} dangTai={p.dangTai} loi={p.loi} onDongY={onDongY} onTuChoi={onTuChoi} />);
    return { onDongY, onTuChoi };
  };
  it("nêu nhà cung cấp/model; chat ⇒ 'câu bạn gõ = dữ liệu vận hành'; nhà máy ĐÃ cho; trần mình; nhà máy đủ trần; chỉ đọc", () => {
    dung(TT());
    expect(screen.getByTestId("hdy-nha-cung-cap").textContent).toBe("openai_compat · gpt-x");
    expect(screen.getByTestId("hdy-nguoi-go").textContent).toContain("DỮ LIỆU VẬN HÀNH");
    expect(screen.getByTestId("hdy-nha-may-cho").textContent).toContain("có");
    expect(screen.getByTestId("hdy-tran-nguoi").textContent).toContain("chưa đặt trần");
    expect(screen.getByTestId("hdy-tran-nha-may").textContent).toContain("có");
    expect(screen.getByTestId("hdy-chi-tiet").textContent).toContain("chỉ đọc");
  });
  it("màn lập trình ⇒ KHÔNG có dòng 'người gõ = vận hành'", () => {
    dung(TT({ mucDuLieu: "ky-thuat" }), { beMat: "coding" });
    expect(screen.queryByTestId("hdy-nguoi-go")).toBeNull();
    expect(screen.getByTestId("hdy-coding").textContent).toContain("lượt hai"); // lượt đầu ky-thuat / từ lượt hai van-hanh được nói rõ
  });
  it("chat/KB ⇒ KHÔNG có dòng riêng của màn lập trình", () => {
    dung(TT());
    expect(screen.queryByTestId("hdy-coding")).toBeNull();
  });
  it("người thường: KHÔNG thấy số token/USD của nhà máy; admin (khoá có) ⇒ thấy", () => {
    dung(TT());
    expect(screen.queryByTestId("hdy-tran-nha-may-so")).toBeNull();
    cleanup();
    dung(TT({ conLaiTranNgay: { nguoi: { token: 500 }, nhaMay: { duTranChoLuotNay: true, token: 900000, usd: 12.5 } } }));
    expect(screen.getByTestId("hdy-tran-nha-may-so").textContent).toContain("$12.5");
    expect(screen.getByTestId("hdy-tran-nguoi").textContent).toContain("500");
  });
  it("nhà máy CHƯA cho dữ liệu vận hành ⇒ nói 'chưa' + duocPhep=false ⇒ nút đồng ý KHOÁ + lý do", () => {
    const { onDongY } = dung(TT({ choDuLieuVanHanh: false, duocPhep: false, lyDo: "NGOAI_DU_LIEU_VAN_HANH" }));
    expect(screen.getByTestId("hdy-nha-may-cho").textContent).toContain("chưa");
    expect(screen.getByTestId("hdy-dong-y")).toBeDisabled();
    expect(screen.getByTestId("hdy-khoa").textContent).toContain("NGOAI_DU_LIEU_VAN_HANH");
    fireEvent.click(screen.getByTestId("hdy-dong-y"));
    expect(onDongY).not.toHaveBeenCalled();
  });
  it("tranVuot ⇒ nói đúng trần nào (lượt / nhà máy / người / phút)", () => {
    for (const [tv, chu] of [["luot", "model"], ["nha-may", "nhà máy"], ["nguoi", "của bạn"], ["luong", "luồng"], ["lan-phut", "mỗi phút"]] as const) {
      dung(TT({ duocPhep: false, lyDo: "NGOAI_VUOT_TRAN", tranVuot: tv, conLaiTranNgay: { nguoi: { token: 0 }, nhaMay: { duTranChoLuotNay: tv !== "nha-may" } } }));
      expect(screen.getByTestId("hdy-tran-vuot").textContent).toContain(chu);
      cleanup();
    }
  });
  it("đồng ý ⇒ onDongY; Không ⇒ onTuChoi; đang tải / chưa có thongTin ⇒ khoá", () => {
    const a = dung(TT());
    fireEvent.click(screen.getByTestId("hdy-dong-y"));
    expect(a.onDongY).toHaveBeenCalledTimes(1);
    cleanup();
    const b = dung(TT());
    fireEvent.click(screen.getByTestId("hdy-tu-choi"));
    expect(b.onTuChoi).toHaveBeenCalledTimes(1);
    cleanup();
    dung(undefined, { dangTai: true });
    expect(screen.getByTestId("hdy-dong-y")).toBeDisabled();
    cleanup();
    dung(TT(), { dangTai: true });
    expect(screen.getByTestId("hdy-dong-y")).toBeDisabled();
  });
  it("lỗi tải thông tin ⇒ hiện thông điệp, đồng ý khoá", () => {
    dung(undefined, { loi: "không tải được" });
    expect(screen.getByTestId("hdy-loi").textContent).toBe("không tải được");
    expect(screen.getByTestId("hdy-dong-y")).toBeDisabled();
  });
});
