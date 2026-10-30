// @vitest-environment jsdom
//
// Đợt 11.3-B — "Tổng quan duyệt thay đổi" trong DongThoiGianAgent: danh sách tệp, J/K/A/R, "đã xem" làm cổng cho A, chỉ nhận phím khi CHÍNH vùng giữ tiêu điểm,
// kết quả kiểm chứng chỉ ĐỌC, không có nút commit/push, chữ thuần.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { SuKienAgent } from "@shared/agentCore/kieu";

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
import { TongQuanDuyet } from "./TongQuanDuyet";
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

const BD = { loai: "bat-dau", runId: "r1", cheDo: "sua" } as SuKienAgent;
const cd = (id: string, ten: string, thamSo: Record<string, unknown>): SuKienAgent => ({ loai: "can-duyet", id, deXuat: { ten, thamSo } }) as SuKienAgent;
const BA_THE = [BD, cd("a", "delete_file", { path: "a.txt" }), cd("b", "delete_file", { path: "b.txt" }), cd("c", "delete_file", { path: "c.txt" })];
const vung = () => screen.getByTestId("agent-tong-quan-duyet");
const dong = () => screen.getAllByTestId("tq-dong");
const phim = (key: string, o: Record<string, unknown> = {}) => fireEvent.keyDown(vung(), { key, ...o });

describe("TongQuanDuyet", () => {
  it("liệt kê mọi thẻ GHI (không thẻ lệnh), tiến độ, và KHÔNG có nút commit/push", () => {
    vẽ(hook([...BA_THE, cd("l", "run_command", { command: "npm run check" })]));
    expect(dong().map((d) => d.getAttribute("data-id"))).toEqual(["a", "b", "c"]);
    expect(screen.getByTestId("tq-tien-do").textContent).toBe("0/3 đã quyết");
    const chu = vung().textContent!.toLowerCase();
    expect(chu).not.toContain("commit");
    expect(chu).not.toContain("push");
  });

  it("★ J/K đổi dòng chọn + đánh dấu ĐÃ XEM; vòng tròn; A bị khoá cho tới khi dòng đã xem", () => {
    const a = hook(BA_THE);
    vẽ(a);
    expect(screen.getByTestId("tq-duyet")).toBeDisabled();
    phim("a"); // chưa chọn dòng nào
    expect(a.duyet).not.toHaveBeenCalled();
    phim("j");
    expect(dong()[0]!.getAttribute("data-chon")).toBe("1");
    expect(dong()[0]!.getAttribute("data-da-xem")).toBe("1");
    expect(dong()[1]!.getAttribute("data-da-xem")).toBe("0");
    phim("j");
    phim("j");
    phim("j"); // vòng về đầu
    expect(dong()[0]!.getAttribute("data-chon")).toBe("1");
    phim("k"); // lùi về cuối
    expect(dong()[2]!.getAttribute("data-chon")).toBe("1");
    expect(dong().every((d) => d.getAttribute("data-da-xem") === "1")).toBe(true);
  });

  it("★ A duyệt ĐÚNG thẻ đang chọn (một lần) chỉ sau khi đã xem; không duyệt thẻ khác", () => {
    const a = hook(BA_THE);
    vẽ(a);
    phim("j");
    phim("j"); // chọn b
    expect(screen.getByTestId("tq-duyet")).toBeEnabled();
    phim("a");
    expect(a.duyet).toHaveBeenCalledTimes(1);
    expect((a.duyet as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toMatchObject({ id: "b" });
  });

  it("★ Bấm dòng cũng đánh dấu đã xem (đường chuột); nút Duyệt (A) bật rồi gọi đúng thẻ", () => {
    const a = hook(BA_THE);
    vẽ(a);
    fireEvent.click(within(dong()[2]!).getByRole("button"));
    expect(dong()[2]!.getAttribute("data-da-xem")).toBe("1");
    fireEvent.click(screen.getByTestId("tq-duyet"));
    expect((a.duyet as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toMatchObject({ id: "c" });
  });

  it("★ R chỉ MỞ ô lý do của thẻ đang chọn (không bác ngay); thẻ khác không mở", () => {
    const a = hook(BA_THE);
    vẽ(a);
    phim("j");
    phim("j"); // b
    phim("r");
    expect(a.bac).not.toHaveBeenCalled();
    const o = screen.getAllByTestId("agent-o-ly-do");
    expect(o).toHaveLength(1);
    expect(o[0]!.closest("[data-testid='agent-the-duyet']")!.id).toBe("agent-the-b");
  });

  it("★ phím CHỈ nhận khi chính vùng giữ tiêu điểm: từ phần tử con, giữ phím (repeat), hay có Ctrl/Alt/Meta ⇒ bỏ", () => {
    const a = hook(BA_THE);
    vẽ(a);
    fireEvent.keyDown(within(vung()).getAllByRole("button")[0]!, { key: "j" }); // nổi bọt từ nút con
    expect(dong().every((d) => d.getAttribute("data-chon") === "0")).toBe(true);
    phim("j", { repeat: true });
    phim("j", { ctrlKey: true });
    phim("j", { altKey: true });
    phim("j", { metaKey: true });
    expect(dong().every((d) => d.getAttribute("data-chon") === "0")).toBe(true);
    phim("j");
    expect(dong()[0]!.getAttribute("data-chon")).toBe("1");
  });

  it("thẻ đã quyết: A/R không làm gì; tiến độ cập nhật", () => {
    const a = hook([...BA_THE, { loai: "da-duyet", id: "a" } as SuKienAgent, { loai: "bi-bac", id: "b" } as SuKienAgent]);
    vẽ(a);
    expect(screen.getByTestId("tq-tien-do").textContent).toBe("2/3 đã quyết");
    phim("j"); // a (đã duyệt)
    expect(screen.getByTestId("tq-duyet")).toBeDisabled();
    expect(screen.getByTestId("tq-bac")).toBeDisabled();
    phim("a");
    phim("r");
    expect(a.duyet).not.toHaveBeenCalled();
    expect(screen.queryAllByTestId("agent-o-ly-do")).toHaveLength(0);
  });

  it("đang gửi duyệt đúng thẻ ấy ⇒ A không gọi lần hai", () => {
    const a = hook(BA_THE, { dangGuiDuyet: "a" });
    vẽ(a);
    phim("j"); // a
    phim("a");
    expect(a.duyet).not.toHaveBeenCalled();
  });

  it("★ kiểm chứng: hiện kết quả có cấu trúc, đánh dấu 'chạy trước thay đổi đã duyệt'; thiếu cấu trúc ⇒ không hiện; chữ thuần", () => {
    const lenh = (hienThi: unknown): SuKienAgent[] => [
      { loai: "goi-tool", luot: 1, goi: { id: "t", ten: "run_command", thamSo: { command: "x" } } } as SuKienAgent,
      { loai: "ket-qua-tool", id: "t", ok: true, tomTat: "x", hienThi } as SuKienAgent,
    ];
    const { container } = vẽ(hook([BD, ...lenh({ lenh: "npm run <b>check</b>", xanh: false, soDo: 3, soXanh: 9 }), cd("a", "delete_file", { path: "p" }), { loai: "da-duyet", id: "a" } as SuKienAgent]));
    const kc = screen.getByTestId("tq-kiem-chung");
    expect(kc.getAttribute("data-xanh")).toBe("0");
    expect(kc.textContent).toContain("npm run <b>check</b>");
    expect(kc.textContent).toContain("3 đỏ");
    expect(screen.getByTestId("tq-kiem-chung-cu")).toBeInTheDocument();
    expect(container.querySelectorAll("[data-testid='tq-kiem-chung'] b").length).toBe(0);
    cleanup();
    vẽ(hook([BD, ...lenh("all green"), cd("a", "delete_file", { path: "p" })]));
    expect(screen.queryByTestId("tq-kiem-chung")).toBeNull();
  });

  it("không có thẻ ghi nào ⇒ không vẽ vùng tổng quan", () => {
    vẽ(hook([BD, { loai: "chu", noiDung: "xin chào" } as SuKienAgent]));
    expect(screen.queryByTestId("agent-tong-quan-duyet")).toBeNull();
  });
});

describe("TongQuanDuyet × agent con (11.8)", () => {
  const CON = { loai: "con-bat-dau", runIdCon: "c1", agent: "reviewer", nguon: "tuRepo", sau: 1, cheDo: "sua", nhiemVu: "x" } as SuKienAgent;
  const conCD = (id: string, path: string): SuKienAgent => ({ loai: "su-kien-con", runIdCon: "c1", suKien: { loai: "can-duyet", id, deXuat: { ten: "delete_file", thamSo: { path } } } }) as SuKienAgent;

  it("thẻ của con có trong danh sách với nhãn con; A chỉ sau khi xem, gọi agent.duyet ĐÚNG thẻ của con", () => {
    const a = hook([BD, cd("a", "delete_file", { path: "cha.txt" }), CON, conCD("a", "con.txt")]);
    vẽ(a);
    expect(dong()).toHaveLength(2);
    expect(screen.getByTestId("tq-dong-con").textContent).toContain("reviewer");
    vung().focus();
    phim("a");
    expect(a.duyet).not.toHaveBeenCalled(); // chưa xem
    phim("j");
    phim("j"); // dòng thứ hai = thẻ của con
    phim("a");
    expect(a.duyet).toHaveBeenCalledTimes(1);
    const the = (a.duyet as ReturnType<typeof vi.fn>).mock.calls[0]![0] as { id: string; deXuat: { thamSo: { path: string } } };
    expect(the.deXuat.thamSo.path).toBe("con.txt");
  });

  it("R trên thẻ của con mở ô lý do CỦA THẺ CON (không mở thẻ cha cùng id)", () => {
    vẽ(hook([BD, cd("a", "delete_file", { path: "cha.txt" }), CON, conCD("a", "con.txt")]));
    vung().focus();
    phim("j");
    phim("j");
    phim("r");
    expect(screen.getAllByTestId("agent-o-ly-do")).toHaveLength(1);
    expect(within(screen.getByTestId("agent-con")).getByTestId("agent-o-ly-do")).toBeInTheDocument();
  });

  it("★ (m6) chọn dòng 0 rồi thẻ MỚI chen vào đầu danh sách (cha tới sau con) ⇒ A KHÔNG duyệt dòng chưa xem", () => {
    const a1 = hook([BD, CON, conCD("x", "con.txt")]);
    const { rerender } = vẽ(a1);
    vung().focus();
    phim("j"); // chọn dòng 0 = thẻ của con, đã xem
    const a2 = hook([BD, cd("moi", "delete_file", { path: "cha-moi.txt" }), CON, conCD("x", "con.txt")], { duyet: a1.duyet });
    rerender(<DongThoiGianAgent agent={a2} onMoTep={() => undefined} />);
    expect(dong()[0]!.getAttribute("data-id")).toBe("moi");
    expect(dong()[0]!.getAttribute("data-da-xem")).toBe("0");
    phim("a");
    expect(a1.duyet).not.toHaveBeenCalled();
  });
});

describe("TongQuanDuyet — ghim phòng thủ (kiem-dinh m11/m19)", () => {
  it("★ thẻ DIFF có neo cuộn agent-the-<id> (bấm dòng cuộn tới đúng thẻ)", () => {
    const xt = { pendingAction: { tool: "apply_diff", args: { path: "lib/z.cs", original: "a", modified: "b" }, preview: { warnings: [] } } };
    vẽ(hook([BD, { loai: "can-duyet", id: "dd", deXuat: { ten: "edit_file", thamSo: {}, xemTruoc: xt } } as SuKienAgent]));
    const the = screen.getByTestId("agent-the-duyet");
    expect(the.getAttribute("data-loai")).toBe("diff");
    expect(the.id).toBe("agent-the-dd");
  });

  it("★ R trên thẻ ĐÃ QUYẾT không gọi onYeuCauBac (guard riêng của tổng quan, không dựa vào guard của thẻ)", () => {
    const onYeuCauBac = vi.fn();
    render(<TongQuanDuyet agent={hook([...BA_THE, { loai: "da-duyet", id: "a" } as SuKienAgent])} onYeuCauBac={onYeuCauBac} />);
    const v = screen.getByTestId("agent-tong-quan-duyet");
    fireEvent.keyDown(v, { key: "j" }); // a (đã duyệt)
    fireEvent.keyDown(v, { key: "r" });
    expect(onYeuCauBac).not.toHaveBeenCalled();
    fireEvent.keyDown(v, { key: "j" }); // b (đang chờ)
    fireEvent.keyDown(v, { key: "r" });
    expect(onYeuCauBac).toHaveBeenCalledWith("b");
  });
});
