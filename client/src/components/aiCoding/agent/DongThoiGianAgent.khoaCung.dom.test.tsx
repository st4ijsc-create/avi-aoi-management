// @vitest-environment jsdom
//
// Đợt 11.3-A — thẻ duyệt LỆNH: cảnh báo của máy chủ (chữ thuần), bảng lệnh KHOÁ CỨNG (từ hằng chung), lệnh khớp khoá ⇒ không duyệt được,
// phím Enter = cho phép MỘT lần / Esc = bác — CHỈ khi chính thẻ giữ tiêu điểm (không bao giờ khi đang gõ lý do).
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { SuKienAgent } from "@shared/agentCore/kieu";
import { LENH_KHOA_CUNG } from "@shared/agentCore/lenhKhoaCung";

function noiSuy(s: string, o?: Record<string, unknown>): string {
  return o ? s.replace(/\{\{(\w+)\}\}/g, (_, k) => String(o[k] ?? "")) : s;
}
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string, a?: unknown, b?: unknown) => (typeof a === "string" ? noiSuy(a, b as Record<string, unknown>) : k) }),
}));
vi.mock("streamdown", () => ({ Streamdown: (p: { children: string }) => <div>{p.children}</div> }));
vi.mock("@/components/diff/HunkDiffView", () => ({ HunkDiffView: () => null }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), warning: vi.fn(), success: vi.fn() } }));
vi.mock("@/lib/trpc", () => ({ trpc: { aiChonModel: { danhMuc: { useQuery: () => ({ data: undefined }) } } } }));

import { DongThoiGianAgent } from "./DongThoiGianAgent";
import { giamSuKien, TRANG_THAI_RONG } from "./trangThaiAgent";
import type { HookAgent } from "./useLuotChayAgent";

const chay = (es: SuKienAgent[]) => es.reduce((s, e) => giamSuKien(s, e), TRANG_THAI_RONG);
const hook = (es: SuKienAgent[], o: Partial<HookAgent> = {}): HookAgent =>
  ({
    trangThai: chay(es),
    matKetNoi: null,
    loiThaoTac: null,
    dangGuiDuyet: null,
    dangHoanTac: false,
    ketQuaHoanTac: null,
    luotDangChayCu: null,
    gui: vi.fn(),
    dung: vi.fn(),
    noiLai: vi.fn(),
    duyet: vi.fn(async () => undefined),
    bac: vi.fn(async () => undefined),
    hoanTac: vi.fn(),
    quyetDeXuatNho: vi.fn(),
    datLai: vi.fn(),
    ...o,
  }) as unknown as HookAgent;
const vẽ = (a: HookAgent) => render(<DongThoiGianAgent agent={a} onMoTep={() => undefined} />);
afterEach(cleanup);

const BAT_DAU = { loai: "bat-dau", runId: "r1", cheDo: "sua" } as SuKienAgent;
const CU_LENH = (command: string, canhBao: string[] = ["Thư mục chạy: D:\\proj\\<b>x</b>"]): SuKienAgent =>
  ({
    loai: "can-duyet",
    id: "act-1",
    deXuat: { ten: "run_command", thamSo: { command }, moTa: "Chạy lệnh", xemTruoc: { pendingAction: { tool: "run_command", args: {}, preview: { warnings: canhBao } } } },
  }) as SuKienAgent;
const the = () => screen.getByTestId("agent-the-duyet");

describe("thẻ duyệt lệnh — cảnh báo máy chủ + khoá cứng", () => {
  it("★ cảnh báo của máy chủ hiện CHỮ THUẦN (thư mục chạy…); có bảng khoá cứng liệt kê ĐỦ mọi mục của hằng chung", () => {
    const { container } = vẽ(hook([BAT_DAU, CU_LENH("npm run check")]));
    expect(screen.getByTestId("agent-canh-bao-lenh").textContent).toContain("Thư mục chạy: D:\\proj\\<b>x</b>");
    expect(container.querySelectorAll("[data-testid='agent-canh-bao-lenh'] b").length).toBe(0);
    const ids = Array.from(screen.getByTestId("agent-lenh-khoa-cung").querySelectorAll("[data-khoa-id]")).map((e) => e.getAttribute("data-khoa-id"));
    expect(ids).toEqual(LENH_KHOA_CUNG.map((k) => k.id));
    expect(screen.getByTestId("agent-goi-y-phim")).toBeInTheDocument();
    expect(screen.queryByTestId("agent-lenh-bi-khoa")).toBeNull();
  });

  it("★ lệnh khớp khoá cứng ⇒ biểu tượng/cảnh báo đỏ, nút Duyệt KHOÁ, Enter KHÔNG duyệt", () => {
    const a = hook([BAT_DAU, CU_LENH("git push origin main")]);
    vẽ(a);
    expect(screen.getByTestId("agent-lenh-bi-khoa").textContent).toContain("git push");
    expect(within(the()).getByRole("button", { name: "Duyệt" })).toBeDisabled();
    the().focus();
    fireEvent.keyDown(the(), { key: "Enter" });
    expect(a.duyet).not.toHaveBeenCalled();
    expect(screen.queryByTestId("agent-goi-y-phim")).toBeNull();
  });

  it("★ Enter khi CHÍNH thẻ giữ tiêu điểm ⇒ duyệt MỘT lần đúng thẻ; Esc ⇒ mở ô lý do bác", () => {
    const a = hook([BAT_DAU, CU_LENH("npm run check")]);
    vẽ(a);
    fireEvent.keyDown(the(), { key: "Enter" });
    expect(a.duyet).toHaveBeenCalledTimes(1);
    expect((a.duyet as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toMatchObject({ kieu: "duyet", id: "act-1" });
    fireEvent.keyDown(the(), { key: "Escape" });
    expect(screen.getByTestId("agent-o-ly-do")).toBeInTheDocument();
  });

  it("★ KHÔNG bao giờ duyệt bằng Enter khi đang gõ lý do (sự kiện nổi bọt từ ô lý do) hoặc từ phần tử con khác", () => {
    const a = hook([BAT_DAU, CU_LENH("npm run check")]);
    vẽ(a);
    fireEvent.keyDown(the(), { key: "Escape" });
    const o = screen.getByRole("textbox");
    fireEvent.keyDown(o, { key: "Enter" });
    fireEvent.keyDown(the(), { key: "Enter" }); // đang mở ô lý do
    expect(a.duyet).not.toHaveBeenCalled();
    cleanup();
    const b = hook([BAT_DAU, CU_LENH("npm run check")]);
    vẽ(b);
    fireEvent.keyDown(within(the()).getByRole("button", { name: "Bác" }), { key: "Enter" }); // nổi bọt từ nút con
    expect(b.duyet).not.toHaveBeenCalled();
  });

  it("đang gửi duyệt (busy) hoặc đã quyết ⇒ Enter không làm gì; thẻ đã quyết không còn tiêu điểm", () => {
    const a = hook([BAT_DAU, CU_LENH("npm run check")], { dangGuiDuyet: "act-1" });
    vẽ(a);
    fireEvent.keyDown(the(), { key: "Enter" });
    expect(a.duyet).not.toHaveBeenCalled();
    cleanup();
    const b = hook([BAT_DAU, CU_LENH("npm run check"), { loai: "da-duyet", id: "act-1" } as SuKienAgent]);
    vẽ(b);
    expect(the().getAttribute("tabindex")).toBeNull();
    fireEvent.keyDown(the(), { key: "Enter" });
    expect(b.duyet).not.toHaveBeenCalled();
  });

  it("thẻ KHÔNG phải lệnh (xoá tệp): không phím tắt, không bảng khoá, không tiêu điểm", () => {
    const a = hook([BAT_DAU, { loai: "can-duyet", id: "act-2", deXuat: { ten: "delete_file", thamSo: { path: "a.txt" } } } as SuKienAgent]);
    vẽ(a);
    expect(the().getAttribute("tabindex")).toBeNull();
    expect(screen.queryByTestId("agent-lenh-khoa-cung")).toBeNull();
    fireEvent.keyDown(the(), { key: "Enter" });
    expect(a.duyet).not.toHaveBeenCalled();
  });

  it("cảnh báo: cắt 12 dòng × 400 ký tự (chống phình); phần tử không phải chuỗi bị bỏ", () => {
    const nhieu = [...Array.from({ length: 20 }, (_, i) => `dòng ${i}`), "x".repeat(900)];
    vẽ(hook([BAT_DAU, CU_LENH("npm run check", [5 as never, ...nhieu])]));
    const li = screen.getByTestId("agent-canh-bao-lenh").querySelectorAll("li");
    expect(li.length).toBe(12);
    cleanup();
    vẽ(hook([BAT_DAU, CU_LENH("npm run check", ["y".repeat(900)])]));
    expect(screen.getByTestId("agent-canh-bao-lenh").textContent!.length).toBe(400);
  });
});
