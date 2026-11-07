// @vitest-environment jsdom
//
// PHA 0 · C0-3 (50-C0) — "NÚT DỪNG MÁY KHÔNG BAO GIỜ BỊ CHE": nút trong faceplate (hộp thoại) bị hộp xác nhận lồng che ⇒ lớp nổi dựng nút DỪNG
// ở tầng trên cùng cho ĐÚNG máy đó; bấm ⇒ mở HỘP XÁC NHẬN của chính instance (không có đường gửi lệnh thứ hai). Render THẬT với Radix Dialog
// (hideOthers đặt aria-hidden thật) + Sonner THẬT; chỉ mock hợp đồng mạng.
//   - bình thường (không hộp lồng): KHÔNG có nút nổi (không trùng nút);
//   - hộp lồng mở: nút nổi xuất hiện, z-index > mọi lớp, không aria-hidden, bấm ⇒ HopDungMay mở; hộp lồng đóng ⇒ nút nổi biến mất;
//   - nút của TRANG (không trong hộp thoại) không bao giờ nổi; nhiều máy ⇒ chỉ máy của faceplate;
//   - 3 toast đang hiện: nút nổi VẪN hiện và bấm được.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import * as React from "react";
import i18next from "i18next";
import { toast } from "sonner";
import vi_ from "@/i18n/locales/vi.json";
import en_ from "@/i18n/locales/en.json";
import { initLayoutKitTestI18n } from "@/components/patterns/layoutKitTestI18n";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Toaster } from "@/components/ui/sonner";

vi.mock("@/lib/socketManager", () => {
  const s = { connected: false, on: () => s, off: () => s, emit: () => s };
  return { getSharedSocket: () => s, releaseSharedSocket: () => undefined };
});
vi.mock("next-themes", () => ({ useTheme: () => ({ theme: "light" }) }));
const srv = vi.hoisted(() => ({ calls: [] as unknown[] }));
vi.mock("@/lib/trpc", () => {
  const mut = () => ({ useMutation: () => ({ mutate: (v: unknown) => srv.calls.push(v), isPending: false }) });
  return { trpc: { useUtils: () => ({ scadaKenh: { cheDo: { danhSach: { invalidate: () => undefined } } } }), scadaCommands: { dungMay: mut() } } };
});

import { NutDungMay } from "./DungMay";
import { LopDungMayNoi, TOI_DA_NUT_NOI, Z_LOP_DUNG_MAY } from "./LopDungMayNoi";
import { xoaNutDungMayChoTest } from "./dungMayNoi";

beforeAll(async () => {
  await initLayoutKitTestI18n();
  i18next.addResourceBundle("vi", "translation", vi_, true, true);
  i18next.addResourceBundle("en", "translation", en_, true, true);
  await i18next.changeLanguage("vi");
});
beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => {
  cleanup();
  xoaNutDungMayChoTest();
  vi.useRealTimers();
});

/** Faceplate giả: Dialog Radix chứa NutDungMay; nút "Đổi…" mở hộp xác nhận LỒNG (Dialog thứ hai). */
function Harness({ hopLong, soToast = 0, thuBa = false }: { hopLong: boolean; soToast?: number; thuBa?: boolean }) {
  React.useEffect(() => {
    for (let i = 0; i < soToast; i++) toast(`toast ${i}`, { duration: Infinity });
  }, [soToast]);
  return (
    <>
      <Toaster />
      <LopDungMayNoi />
      <div data-testid="nut-trang">
        <NutDungMay machineId={99} tenMay="TRANG-99" />
      </div>
      <Dialog open>
        <DialogContent data-testid="faceplate">
          <DialogTitle>Faceplate</DialogTitle>
          <DialogDescription>mock</DialogDescription>
          <NutDungMay machineId={7} tenMay="SCR-06" />
          <Dialog open={hopLong}>
            <DialogContent data-testid="hop-long">
              <DialogTitle>Xác nhận lệnh</DialogTitle>
              <DialogDescription>hộp lồng</DialogDescription>
              <Dialog open={thuBa}>
                <DialogContent data-testid="hop-thu-ba">
                  <DialogTitle>Hộp thứ ba</DialogTitle>
                  <DialogDescription>lồng tiếp</DialogDescription>
                </DialogContent>
              </Dialog>
            </DialogContent>
          </Dialog>
        </DialogContent>
      </Dialog>
    </>
  );
}
const tick = async (ms = 300) => {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
};

describe("LopDungMayNoi — C0-3", () => {
  it("bình thường (không có hộp lồng) ⇒ KHÔNG có nút nổi (không trùng nút trong luồng)", async () => {
    render(<Harness hopLong={false} />);
    await tick();
    expect(screen.queryByTestId("lop-dung-may-noi")).toBeNull();
    expect(screen.queryByTestId("nut-dung-may-noi")).toBeNull();
  });

  it("★ hộp xác nhận lồng che nút ⇒ nút nổi cho ĐÚNG máy faceplate (SCR-06), không cho nút của trang; z-index trên mọi lớp; không aria-hidden", async () => {
    const { rerender } = render(<Harness hopLong={false} />);
    await tick();
    rerender(<Harness hopLong />);
    await tick();
    const noi = await screen.findAllByTestId("nut-dung-may-noi");
    expect(noi).toHaveLength(1);
    expect(noi[0]).toHaveTextContent("DỪNG MÁY — SCR-06");
    expect(noi[0].getAttribute("data-machine-id")).toBe("7");
    const lop = screen.getByTestId("lop-dung-may-noi");
    expect(Number(lop.style.zIndex)).toBe(Z_LOP_DUNG_MAY);
    expect(Number(lop.style.zIndex)).toBeGreaterThan(999_999_999); // > z-index mặc định của Sonner
    expect(lop.style.pointerEvents).toBe("auto");
    expect(lop.closest('[aria-hidden="true"]')).toBeNull();
    expect(lop).toHaveAttribute("role", "region");
  });

  it("★ bấm nút nổi ⇒ mở HỘP XÁC NHẬN DỪNG của CHÍNH máy đó; chưa gửi lệnh nào (còn một bước xác nhận)", async () => {
    const { rerender } = render(<Harness hopLong={false} />);
    rerender(<Harness hopLong />);
    await tick();
    fireEvent.click(await screen.findByTestId("nut-dung-may-noi"));
    await tick();
    expect(await screen.findByText(/Dừng máy SCR-06|SCR-06/, { selector: "[id^=radix-] , h2, [role=dialog] *" })).toBeTruthy();
    expect(srv.calls).toHaveLength(0);
  });

  it("★ 3 toast đang hiện + hộp lồng ⇒ nút nổi VẪN có mặt trong DOM ở tầng trên cùng và bấm được", async () => {
    const { rerender } = render(<Harness hopLong={false} soToast={3} />);
    await tick();
    rerender(<Harness hopLong soToast={3} />);
    await tick();
    expect(screen.getAllByText(/toast \d/).length).toBeGreaterThanOrEqual(3);
    const nut = await screen.findByTestId("nut-dung-may-noi");
    expect(nut).toBeVisible();
    fireEvent.click(nut);
    await tick();
    expect(document.body.textContent).toMatch(/SCR-06/);
  });

  it("★ hộp thứ ba mở SAU khi nút nổi đã có ⇒ Radix hideOthers đặt aria-hidden lên lớp nổi; lớp TỰ GỠ (nút DỪNG còn trong cây truy cập)", async () => {
    const { rerender } = render(<Harness hopLong />);
    await tick();
    await screen.findByTestId("nut-dung-may-noi");
    rerender(<Harness hopLong thuBa />);
    await tick(600);
    const lop = screen.getByTestId("lop-dung-may-noi");
    expect(lop.closest('[aria-hidden="true"]')).toBeNull();
  });

  it("hộp lồng đóng lại ⇒ nút nổi biến mất (không để rác)", async () => {
    const { rerender } = render(<Harness hopLong />);
    await tick();
    expect(await screen.findByTestId("nut-dung-may-noi")).toBeInTheDocument();
    rerender(<Harness hopLong={false} />);
    await tick(600);
    expect(screen.queryByTestId("nut-dung-may-noi")).toBeNull();
  });

  it("nút của TRANG (ngoài hộp thoại) không bao giờ nổi dù có hộp thoại phủ; tối đa TOI_DA_NUT_NOI máy nổi", async () => {
    render(
      <>
        <LopDungMayNoi />
        <NutDungMay machineId={1} tenMay="TRANG-1" />
        <Dialog open>
          <DialogContent>
            <DialogTitle>Hộp</DialogTitle>
            <DialogDescription>x</DialogDescription>
            {[11, 12, 13, 14, 15].map((id) => (
              <NutDungMay key={id} machineId={id} tenMay={`M-${id}`} />
            ))}
            <Dialog open>
              <DialogContent>
                <DialogTitle>Lồng</DialogTitle>
                <DialogDescription>y</DialogDescription>
              </DialogContent>
            </Dialog>
          </DialogContent>
        </Dialog>
      </>,
    );
    await tick();
    const noi = await screen.findAllByTestId("nut-dung-may-noi");
    expect(noi.length).toBe(TOI_DA_NUT_NOI);
    expect(noi.some((n) => n.textContent?.includes("TRANG-1"))).toBe(false);
  });
});
