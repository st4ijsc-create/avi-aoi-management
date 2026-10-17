// @vitest-environment jsdom
//
// ★★★ Rà bảo mật de591c868 #3 — LỪA ĐẢO MÃ THIẾT BỊ ở trang `/ai-thiet-bi` (render THẬT qua @testing-library/react; chỉ
// mock hợp đồng mạng `@/lib/trpc`, `wouter`, `sonner`, và `react-i18next` để chữ hiện NGUYÊN KHOÁ).
//
// Kẻ tấn công khởi tạo luồng rồi gửi cho nạn nhân `…/ai-thiet-bi?ma=XXXX-XXXX`. Bản đầu điền sẵn mã từ URL ⇒ nạn nhân
// chỉ còn MỘT cú bấm "Cho phép" là trao token. Canh:
//   §1 `?ma=` KHÔNG được điền sẵn vào ô mã, và không có truy vấn nào chạy với mã từ URL;
//   §2 khi đã gõ mã: trang hiện NGUỒN GỐC (IP + User-Agent khởi tạo), cảnh báo IP khác, và nút Cho phép KHOÁ tới khi
//      người dùng tích xác nhận "chính tôi vừa bấm đăng nhập trong VSCode"; lượt duyệt gửi `xacNhanTuKhoiTao: true`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const xemArgs: Array<{ input: unknown; opts: { enabled?: boolean } }> = [];
const xemData: { value: unknown } = { value: undefined };
const mutate = vi.fn();

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("wouter", () => ({ useSearch: () => "ma=BCDF-GHJK" }));
// Chữ = KHOÁ (không phụ thuộc bản dịch đang nạp) ⇒ bộ chọn ổn định qua vi/en/zh.
vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "vi" } }),
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ aiGatewayToken: { danhSach: { invalidate: vi.fn() } } }),
    aiGatewayToken: {
      xemThietBi: {
        useQuery: (input: unknown, opts: { enabled?: boolean }) => {
          xemArgs.push({ input, opts });
          return { data: opts?.enabled ? xemData.value : undefined };
        },
      },
      quyetThietBi: { useMutation: () => ({ mutate, isPending: false }) },
    },
  },
}));

import { XacNhanThietBi } from "./AiGatewayThietBi";

beforeEach(() => {
  xemArgs.length = 0;
  mutate.mockReset();
  xemData.value = {
    ok: true,
    note: null,
    ten: "VSCode",
    phamVi: ["chat", "fim"],
    conLaiGiay: 500,
    ipKhoiTao: "203.0.113.9",
    tacNhanKhoiTao: "ke-la/1.0",
    taoLuc: "2026-10-17T00:00:00.000Z",
    ipCuaBan: "10.0.0.5",
    khacIp: true,
  };
});
afterEach(() => cleanup());

const oMa = () => screen.getByLabelText("aiGatewayToken.device.codeLabel") as HTMLInputElement;

describe("trang xác nhận thiết bị — chống lừa đảo mã", () => {
  it("§1 `?ma=` trong URL KHÔNG được điền sẵn; không truy vấn nào chạy với mã ấy", () => {
    render(<XacNhanThietBi />);
    expect(oMa().value).toBe("");
    expect(xemArgs.some((a) => a.opts?.enabled)).toBe(false);
    expect(screen.queryByText("aiGatewayToken.device.approve")).toBeNull();
  });

  it("§2 gõ mã ⇒ hiện IP/User-Agent khởi tạo + cảnh báo IP khác; Cho phép KHOÁ tới khi tích xác nhận", () => {
    render(<XacNhanThietBi />);
    fireEvent.change(oMa(), { target: { value: "bcdf ghjk" } });
    expect(screen.getByText("203.0.113.9")).toBeInTheDocument();
    expect(screen.getByText("ke-la/1.0")).toBeInTheDocument();
    expect(screen.getByText("aiGatewayToken.device.ipMismatch")).toBeInTheDocument();
    const nut = screen.getByRole("button", { name: /aiGatewayToken\.device\.approve/ });
    expect(nut).toBeDisabled();
    fireEvent.click(nut);
    expect(mutate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("checkbox", { name: /aiGatewayToken\.device\.confirmMine/ }));
    expect(nut).toBeEnabled();
    fireEvent.click(nut);
    expect(mutate).toHaveBeenCalledWith({ maNguoiDung: "BCDF-GHJK", dongY: true, xacNhanTuKhoiTao: true });
  });

  it("Từ chối KHÔNG cần tích xác nhận (thu hẹp quyền luôn được)", () => {
    render(<XacNhanThietBi />);
    fireEvent.change(oMa(), { target: { value: "BCDF-GHJK" } });
    fireEvent.click(screen.getByRole("button", { name: /aiGatewayToken\.device\.deny/ }));
    expect(mutate).toHaveBeenCalledWith({ maNguoiDung: "BCDF-GHJK", dongY: false });
  });
});
