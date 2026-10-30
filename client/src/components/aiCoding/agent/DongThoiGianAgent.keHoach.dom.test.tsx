// @vitest-environment jsdom
//
// Đợt 11.3-C (UX-D02) — thẻ "Kế hoạch chờ duyệt": bước là CHỮ THUẦN; Duyệt/Bác gửi ĐÚNG băm đang hiển thị; Enter/Esc chỉ khi chính thẻ có tiêu điểm;
// nhãn KHÔNG TIN CẬY khi đã hạ tự trị / có agent con từ repo; thẻ đã quyết / hết hiệu lực không còn nút; lỗi hiện theo mã.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { SuKienAgent } from "@shared/agentCore/kieu";

function noiSuy(s: string, o?: Record<string, unknown>): string {
  return o ? s.replace(/\{\{(\w+)\}\}/g, (_, k) => String(o[k] ?? "")) : s;
}
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string, a?: unknown, b?: unknown) => (typeof a === "string" ? noiSuy(a, b as Record<string, unknown>) : k) }),
}));
vi.mock("streamdown", () => ({ Streamdown: (p: { children: string }) => <div data-md="1">{p.children}</div> }));
vi.mock("@/components/diff/HunkDiffView", () => ({ HunkDiffView: () => null }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), warning: vi.fn(), success: vi.fn() } }));
vi.mock("@/lib/trpc", () => ({ trpc: { aiChonModel: { danhMuc: { useQuery: () => ({ data: undefined }) } } } }));

import { DongThoiGianAgent } from "./DongThoiGianAgent";
import { capNhatKeHoachDuyet, giamSuKien, TRANG_THAI_RONG, type TrangThaiAgent } from "./trangThaiAgent";
import type { HookAgent } from "./useLuotChayAgent";

const B1 = "c".repeat(64);
const chay = (es: SuKienAgent[]) => es.reduce(giamSuKien, TRANG_THAI_RONG);
const hook = (tt: TrangThaiAgent, o: Partial<HookAgent> = {}): HookAgent =>
  ({
    trangThai: tt,
    matKetNoi: null,
    loiThaoTac: null,
    dangGuiDuyet: null,
    dangHoanTac: false,
    ketQuaHoanTac: null,
    luotDangChayCu: null,
    gui: vi.fn(),
    dung: vi.fn(),
    noiLai: vi.fn(),
    duyet: vi.fn(),
    bac: vi.fn(),
    hoanTac: vi.fn(),
    quyetDeXuatNho: vi.fn(),
    quyetKeHoach: vi.fn(async () => undefined),
    lamMoiKeHoach: vi.fn(async () => undefined),
    datLai: vi.fn(),
    ...o,
  }) as unknown as HookAgent;
const vẽ = (a: HookAgent) => render(<DongThoiGianAgent agent={a} onMoTep={() => undefined} />);

afterEach(cleanup);

const BD = { loai: "bat-dau", runId: "r1", cheDo: "sua" } as SuKienAgent;
const VIEC = [{ noiDung: "Sửa <b>a.ts</b> ![x](http://evil.example/p.png)", trangThai: "cho" as const }, { noiDung: "Chạy kiểm tra", trangThai: "cho" as const }];
const CHO = { loai: "ke-hoach-cho-duyet", viec: VIEC, bam: B1 } as SuKienAgent;

describe("thẻ Kế hoạch chờ duyệt", () => {
  it("các bước là CHỮ THUẦN (không markdown/img/b) và có nút Duyệt/Bác", () => {
    vẽ(hook(chay([BD, CHO])));
    const the = screen.getByTestId("agent-ke-hoach-duyet");
    expect(the).toHaveAttribute("data-trang-thai", "cho");
    expect(the.querySelector("img,b,a,[data-md]")).toBeNull();
    expect(the.textContent).toContain("Sửa <b>a.ts</b>");
    expect(screen.getByTestId("agent-ke-hoach-duyet-nut-duyet")).toBeEnabled();
    expect(screen.getByTestId("agent-ke-hoach-duyet-nut-bac")).toBeEnabled();
  });

  it("bấm Duyệt / Bác ⇒ quyetKeHoach(thẻ có ĐÚNG băm hiển thị, quyết định)", () => {
    const a = hook(chay([BD, CHO]));
    vẽ(a);
    fireEvent.click(screen.getByTestId("agent-ke-hoach-duyet-nut-duyet"));
    expect(a.quyetKeHoach).toHaveBeenCalledWith(expect.objectContaining({ bam: B1 }), "duyet");
    fireEvent.click(screen.getByTestId("agent-ke-hoach-duyet-nut-bac"));
    expect(a.quyetKeHoach).toHaveBeenLastCalledWith(expect.objectContaining({ bam: B1 }), "bac");
  });

  it("★ Enter/Esc CHỈ khi chính thẻ có tiêu điểm: phím từ nút bên trong không kích hoạt thêm", () => {
    const a = hook(chay([BD, CHO]));
    vẽ(a);
    const the = screen.getByTestId("agent-ke-hoach-duyet");
    fireEvent.keyDown(screen.getByTestId("agent-ke-hoach-duyet-nut-bac"), { key: "Enter" });
    fireEvent.keyDown(screen.getByTestId("agent-ke-hoach-duyet-nut-bac"), { key: "Escape" });
    expect(a.quyetKeHoach).not.toHaveBeenCalled();
    fireEvent.keyDown(the, { key: "Enter" });
    expect(a.quyetKeHoach).toHaveBeenLastCalledWith(expect.objectContaining({ bam: B1 }), "duyet");
    fireEvent.keyDown(the, { key: "Escape" });
    expect(a.quyetKeHoach).toHaveBeenLastCalledWith(expect.objectContaining({ bam: B1 }), "bac");
    expect(a.quyetKeHoach).toHaveBeenCalledTimes(2);
  });

  it("đang gửi ⇒ nút tắt và phím không gửi lần hai", () => {
    const a = hook(capNhatKeHoachDuyet(chay([BD, CHO]), B1, { trangThai: "dang-gui" }));
    vẽ(a);
    expect(screen.getByTestId("agent-ke-hoach-duyet-nut-duyet")).toBeDisabled();
    fireEvent.keyDown(screen.getByTestId("agent-ke-hoach-duyet"), { key: "Enter" });
    expect(a.quyetKeHoach).not.toHaveBeenCalled();
  });

  it("thẻ đã quyết / hết hiệu lực / đã đổi ⇒ KHÔNG còn nút và phím vô tác dụng", () => {
    for (const ev of [
      { loai: "ke-hoach-da-duyet", bam: B1, luc: "L" },
      { loai: "ke-hoach-khong-duyet", bam: B1, lyDo: "bac" },
      { loai: "ke-hoach-khong-duyet", bam: B1, lyDo: "het-gio" },
      { loai: "xong", lyDo: "huy" },
    ] as SuKienAgent[]) {
      const a = hook(chay([BD, CHO, ev]));
      const { unmount } = vẽ(a);
      expect(screen.queryByTestId("agent-ke-hoach-duyet-nut-duyet")).toBeNull();
      fireEvent.keyDown(screen.getByTestId("agent-ke-hoach-duyet"), { key: "Enter" });
      expect(a.quyetKeHoach).not.toHaveBeenCalled();
      expect(screen.getByTestId("agent-ke-hoach-ket-qua").textContent).not.toBe("");
      unmount();
    }
    const daDoi = hook(capNhatKeHoachDuyet(chay([BD, CHO]), B1, { trangThai: "da-doi" }));
    vẽ(daDoi);
    expect(screen.queryByTestId("agent-ke-hoach-duyet-nut-duyet")).toBeNull();
    expect(screen.getByTestId("agent-ke-hoach-ket-qua").textContent).toContain("Kế hoạch đã đổi");
  });

  it("nhãn KHÔNG TIN CẬY: chỉ khi đã hạ tự trị hoặc có agent con từ repo", () => {
    vẽ(hook(chay([BD, CHO])));
    expect(screen.queryByTestId("agent-ke-hoach-khong-tin-cay")).toBeNull();
    cleanup();
    vẽ(hook(chay([BD, { loai: "ha-tu-tri", nguon: "README.md", mau: [] } as unknown as SuKienAgent, CHO])));
    expect(screen.getByTestId("agent-ke-hoach-khong-tin-cay")).toBeInTheDocument();
    cleanup();
    vẽ(hook(chay([BD, { loai: "con-bat-dau", runIdCon: "c1", agent: "rv", nguon: "tuRepo", sau: 1, cheDo: "hoi", nhiemVu: "x" } as SuKienAgent, CHO])));
    expect(screen.getByTestId("agent-ke-hoach-khong-tin-cay")).toBeInTheDocument();
  });

  it("lỗi theo mã máy chủ: DA_QUYET / LOI_CSDL có câu riêng; mã lạ in hoa ⇒ câu chung; chuỗi đã dịch hiện nguyên", () => {
    const loi = (ma: string) => {
      const { unmount } = vẽ(hook(capNhatKeHoachDuyet(chay([BD, CHO]), B1, { trangThai: "cho", maLoi: ma })));
      const t = screen.getByTestId("agent-ke-hoach-loi").textContent ?? "";
      unmount();
      return t;
    };
    expect(loi("LOI_CSDL")).toContain("chưa ghi được");
    expect(loi("DA_QUYET")).toContain("đã có quyết định");
    expect(loi("MA_LA_GI")).toContain("Chưa gửi được");
    expect(loi("Mất kết nối mạng")).toBe("Mất kết nối mạng");
  });

  it("mở thẻ đang chờ ⇒ hỏi lại sổ MỘT lần (lamMoiKeHoach); thẻ đã quyết thì không hỏi", () => {
    const a = hook(chay([BD, CHO]));
    vẽ(a);
    expect(a.lamMoiKeHoach).toHaveBeenCalledTimes(1);
    cleanup();
    const b = hook(chay([BD, CHO, { loai: "ke-hoach-da-duyet", bam: B1, luc: "L" } as SuKienAgent]));
    vẽ(b);
    expect(b.lamMoiKeHoach).not.toHaveBeenCalled();
  });
});
