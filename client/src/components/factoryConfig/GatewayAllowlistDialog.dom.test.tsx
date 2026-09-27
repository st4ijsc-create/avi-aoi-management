// @vitest-environment jsdom
//
// doc 81 Đợt 1C Task 4 fix round 1 (#2, #7) — hộp thoại allowlist gateway, render THẬT qua
// @testing-library/react; chỉ mock hợp đồng mạng (`@/lib/trpc`) và `sonner`. Không có i18next instance
// ⇒ nút hiện NGUYÊN KHOÁ ("common.save", "common.cancel") — cùng quy ước `componentLimitsDialog.dom.test.tsx`.
//
// Hai lỗi đã đo ở bản đầu:
//   1. Huỷ rồi mở lại ⇒ lựa chọn CŨ còn đó (chỉ gieo lại khi tham chiếu `q.data` đổi) — mở lại phải
//      luôn hiện TRẠNG THÁI MÁY CHỦ.
//   2. Đọc lỗi (`q.isError`) ⇒ hộp thoại hiện cảnh báo "danh sách rỗng" và nút Lưu BẬT — bấm Lưu sẽ ghi
//      `[]` và XOÁ SẠCH allowlist thật. Phải: hiện trạng thái lỗi, Lưu bị khoá.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { useState } from "react";

type QState = {
  data?: { gatewayId: number; gatewayCode: string; devices: Array<{ id: number; code: string; name: string; machineType: string; isActive: boolean }>; outOfScopeCount?: number };
  isLoading: boolean;
  isError: boolean;
  isFetchedAfterMount: boolean;
  error?: unknown;
};
const qState: { value: QState } = { value: { isLoading: true, isError: false, isFetchedAfterMount: false } };
const mutate = vi.fn();

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ machine: { gatewayAllowlist: { get: { invalidate: vi.fn() } } } }),
    machine: {
      gatewayAllowlist: {
        get: { useQuery: () => qState.value },
        set: { useMutation: () => ({ mutate, isPending: false }) },
      },
    },
  },
}));

import { GatewayAllowlistDialog } from "./GatewayAllowlistDialog";

const GW = { id: 10, stationId: 1, code: "GW-1", name: "Gateway 1", machineType: "IOT_GATEWAY" };
const A = { id: 11, stationId: 1, code: "DEV-A", name: "Device A", machineType: "IOT_SENSOR" };
const B = { id: 12, stationId: 1, code: "DEV-B", name: "Device B", machineType: "IOT_SENSOR" };
// Tham chiếu dữ liệu ỔN ĐỊNH qua các lần render — đúng như cache react-query giữ.
const SERVER_DATA = {
  gatewayId: 10,
  gatewayCode: "GW-1",
  devices: [{ id: 11, code: "DEV-A", name: "Device A", machineType: "IOT_SENSOR", isActive: true }],
  outOfScopeCount: 0,
};

function Khung({ candidates = [GW, A, B] }: { candidates?: Array<typeof A> }) {
  const [gw, setGw] = useState<typeof GW | null>(null);
  return (
    <div>
      <button onClick={() => setGw(GW)}>open-gw</button>
      <GatewayAllowlistDialog gateway={gw} candidates={candidates} onOpenChange={(o) => { if (!o) setGw(null); }} />
    </div>
  );
}

const hop = (code: string) => screen.getByRole("checkbox", { name: new RegExp(code) });

beforeEach(() => {
  mutate.mockReset();
  qState.value = { data: SERVER_DATA, isLoading: false, isError: false, isFetchedAfterMount: true };
});
afterEach(() => cleanup());

describe("GatewayAllowlistDialog — fix round 1", () => {
  it("★ #2a Huỷ rồi mở lại ⇒ hiện TRẠNG THÁI MÁY CHỦ, không phải lựa chọn đã bỏ dở", () => {
    render(<Khung />);
    fireEvent.click(screen.getByText("open-gw"));
    expect(hop("DEV-A")).toHaveAttribute("aria-checked", "true");
    expect(hop("DEV-B")).toHaveAttribute("aria-checked", "false");
    fireEvent.click(hop("DEV-B")); // chọn B …
    fireEvent.click(hop("DEV-A")); // … bỏ A
    expect(hop("DEV-B")).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("button", { name: "common.cancel" }));
    fireEvent.click(screen.getByText("open-gw"));
    expect(hop("DEV-A")).toHaveAttribute("aria-checked", "true");
    expect(hop("DEV-B")).toHaveAttribute("aria-checked", "false");
    expect(mutate).not.toHaveBeenCalled();
  });

  it("★ #2b đọc allowlist LỖI ⇒ hiện trạng thái lỗi, KHÔNG cảnh báo 'rỗng', nút Lưu KHOÁ, bấm cũng không ghi", () => {
    qState.value = { data: undefined, isLoading: false, isError: true, isFetchedAfterMount: true, error: new Error("boom") };
    render(<Khung />);
    fireEvent.click(screen.getByText("open-gw"));
    expect(screen.getByText("machinesTab.gatewayAllowlistLoadError")).toBeInTheDocument();
    expect(screen.queryByText("machinesTab.gatewayAllowlistEmptyWarn")).not.toBeInTheDocument();
    const luu = screen.getByRole("button", { name: "common.save" });
    expect(luu).toBeDisabled();
    fireEvent.click(luu);
    expect(mutate).not.toHaveBeenCalled();
  });

  it("dữ liệu cache CŨ chưa đọc lại sau khi mở (isFetchedAfterMount=false) ⇒ Lưu khoá, chưa gieo lựa chọn", () => {
    qState.value = { data: SERVER_DATA, isLoading: false, isError: false, isFetchedAfterMount: false };
    render(<Khung />);
    fireEvent.click(screen.getByText("open-gw"));
    expect(screen.getByRole("button", { name: "common.save" })).toBeDisabled();
  });

  it("đường hợp lệ: đọc xong ⇒ Lưu bật, gửi đúng lựa chọn", () => {
    render(<Khung />);
    fireEvent.click(screen.getByText("open-gw"));
    fireEvent.click(hop("DEV-B"));
    const luu = screen.getByRole("button", { name: "common.save" });
    expect(luu).toBeEnabled();
    fireEvent.click(luu);
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate.mock.calls[0][0]).toMatchObject({ gatewayId: 10 });
    expect([...mutate.mock.calls[0][0].deviceIds].sort()).toEqual([11, 12]);
  });

  it("#7 >200 mục khớp ⇒ gợi ý 'chỉ hiện 200 đầu — lọc thêm'; không khớp ⇒ thông báo không khớp", () => {
    const nhieu = Array.from({ length: 250 }, (_, i) => ({ id: 1000 + i, stationId: 1, code: `S-${i}`, name: `S ${i}`, machineType: "IOT_SENSOR" }));
    render(<Khung candidates={nhieu} />);
    fireEvent.click(screen.getByText("open-gw"));
    expect(screen.getByText("machinesTab.gatewayAllowlistTruncated")).toBeInTheDocument();
    expect(screen.getAllByRole("checkbox").length).toBe(200);
    fireEvent.change(screen.getByPlaceholderText("machinesTab.gatewayAllowlistSearch"), { target: { value: "khong-co-ma-nay" } });
    expect(screen.getByText("machinesTab.gatewayAllowlistNoMatch")).toBeInTheDocument();
    expect(screen.queryByText("machinesTab.gatewayAllowlistTruncated")).not.toBeInTheDocument();
  });

  it("#4 mục ngoài phạm vi ⇒ hiện số đếm, KHÔNG cảnh báo 'rỗng' dù người xem chưa chọn gì", () => {
    qState.value = { data: { ...SERVER_DATA, devices: [], outOfScopeCount: 2 }, isLoading: false, isError: false, isFetchedAfterMount: true };
    render(<Khung />);
    fireEvent.click(screen.getByText("open-gw"));
    expect(screen.getByText("machinesTab.gatewayAllowlistOutOfScope")).toBeInTheDocument();
    expect(screen.queryByText("machinesTab.gatewayAllowlistEmptyWarn")).not.toBeInTheDocument();
  });
});
