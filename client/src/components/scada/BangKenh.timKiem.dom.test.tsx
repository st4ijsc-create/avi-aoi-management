// @vitest-environment jsdom
//
// R1b-2b-2b B-T5 (mục 3, phần không chờ) — M12: ô tìm kiếm của bảng kênh. Lọc tại client, không phân biệt hoa thường VÀ dấu tiếng Việt,
// khớp chuỗi con trên tagKey hoặc displayName; hiện "Hiện n / m"; không kết quả ⇒ EmptyState; đổi adapter (key của trang) ⇒ xoá chuỗi tìm.
// Component THẬT + bundle vi.json THẬT; chỉ mock hợp đồng mạng.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import vi_ from "@/i18n/locales/vi.json";
import { initLayoutKitTestI18n } from "@/components/patterns/layoutKitTestI18n";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock("@/lib/trpcErrors", () => ({ toastTrpcError: vi.fn(), mapTrpcError: (e: unknown) => String(e) }));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ scadaKenh: { danhSach: { invalidate: vi.fn() }, cheDo: { danhSach: { invalidate: vi.fn() } } } }),
    scadaKenh: { capNhat: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) }, khaiHangLoat: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) } },
  },
}));

import { BangKenh, type HangKenh } from "./BangKenh";
import { khopTimKiem } from "./kenhHienThi";

const S = (k: string, o?: Record<string, string | number>): string => {
  const v = k.split(".").reduce<unknown>((x, p) => (x as Record<string, unknown> | undefined)?.[p], vi_);
  if (typeof v !== "string") throw new Error(`thiếu khoá vi: ${k}`);
  return o ? v.replace(/\{\{(\w+)\}\}/g, (_, n) => String(o[n])) : v;
};

function hang(i: number, tagKey: string, displayName: string | null): HangKenh {
  return {
    tagId: i,
    tagKey,
    displayName,
    displayFormat: null,
    unit: null,
    dataType: "int",
    loaiKenh: "input",
    channelKindKhai: null,
    writable: false,
    isEnabled: true,
    writeMin: null,
    writeMax: null,
    writeStep: null,
    actuationLevel: null,
    mucHieuLuc: 5,
    laKenhCheDo: false,
    canhBaoKenhDung: false,
  } as unknown as HangKenh;
}

/** 30 tag: 2 hàng "Tốc độ …", 28 hàng khác. */
const ROWS: HangKenh[] = [
  hang(1, "spd_set", "Tốc độ đặt"),
  hang(2, "SPD_ACT", "Tốc độ thực"),
  ...Array.from({ length: 28 }, (_, i) => hang(10 + i, `tag_${i}`, `Kênh số ${i}`)),
];

const nhapTim = (q: string) => fireEvent.change(screen.getByLabelText(S("scada.kenh.timKiem.nhan")), { target: { value: q } });
const soHang = () => within(screen.getByTestId("bang-kenh")).getAllByRole("row").length - 1;

beforeEach(() => initLayoutKitTestI18n());
afterEach(() => cleanup());

describe("khopTimKiem", () => {
  it("không dấu, không hoa thường, tagKey hoặc displayName", () => {
    expect(khopTimKiem({ tagKey: "spd_set", displayName: "Tốc độ đặt" }, "toc do")).toBe(true);
    expect(khopTimKiem({ tagKey: "SPD_SET", displayName: null }, "spd")).toBe(true);
    expect(khopTimKiem({ tagKey: "x", displayName: "Đầu đọc" }, "dau")).toBe(true);
    expect(khopTimKiem({ tagKey: "x", displayName: null }, "  ")).toBe(true);
    expect(khopTimKiem({ tagKey: "x", displayName: null }, "y")).toBe(false);
  });
});

describe("BangKenh — ô tìm kiếm", () => {
  it("30 tag, gõ 'toc' ⇒ 2 hàng + 'Hiện 2 / 30'", () => {
    render(<BangKenh rows={ROWS} canAct={false} />);
    expect(soHang()).toBe(30);
    nhapTim("toc");
    expect(soHang()).toBe(2);
    expect(screen.getByText(S("scada.kenh.timKiem.hien", { n: 2, m: 30 }))).toBeInTheDocument();
  });

  it("không kết quả ⇒ EmptyState, xoá chuỗi ⇒ trả đủ 30 hàng", () => {
    render(<BangKenh rows={ROWS} canAct={false} />);
    nhapTim("khongcotagnaotenvay");
    expect(screen.getByText(S("scada.kenh.timKiem.khongCo"))).toBeInTheDocument();
    nhapTim("");
    expect(soHang()).toBe(30);
  });

  it("đổi adapter (key khác) ⇒ chuỗi tìm bị xoá", () => {
    const { rerender } = render(<BangKenh key={1} rows={ROWS} canAct={false} />);
    nhapTim("toc");
    expect(soHang()).toBe(2);
    rerender(<BangKenh key={2} rows={ROWS} canAct={false} />);
    expect(soHang()).toBe(30);
  });
});
