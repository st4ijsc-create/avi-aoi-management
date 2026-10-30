// @vitest-environment jsdom
//
// Đợt 11.8 — DongThoiGianAgent: banner ngữ cảnh ≥ 80 % và khối AGENT CON. Chữ do model viết (nhiemVu / tomTat / chữ của con) hiện THUẦN;
// nhãn "từ repo"; thẻ duyệt của con duyệt bằng đúng actionId qua `agent.duyet`.
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
// dấu data-md: chữ nào đi qua bộ markdown (Streamdown) sẽ mang dấu này ⇒ khối agent con KHÔNG được chứa dấu nào
vi.mock("streamdown", () => ({ Streamdown: (p: { children: string }) => <div data-md="1">{p.children}</div> }));
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
const CON = { loai: "con-bat-dau", runIdCon: "c1", agent: "reviewer", nguon: "tuRepo", sau: 1, cheDo: "hoi", nhiemVu: "Soát <b>hàm</b> Divide ![x](http://evil.example/p.png)" } as SuKienAgent;
const DOC = (suKien: unknown): SuKienAgent => ({ loai: "su-kien-con", runIdCon: "c1", suKien }) as SuKienAgent;

describe("DongThoiGianAgent — banner ngữ cảnh", () => {
  it("có nguCanhDay ⇒ banner nêu %; chưa có ⇒ không vẽ", () => {
    const CHU = { loai: "chu", noiDung: "đang làm" } as SuKienAgent;
    const { rerender } = vẽ(hook([BAT_DAU, CHU]));
    expect(screen.queryByTestId("agent-ngu-canh-day")).toBeNull();
    rerender(<DongThoiGianAgent agent={hook([BAT_DAU, CHU, { loai: "ngu-canh-day", phanTram: 83.4 }])} onMoTep={() => undefined} />);
    expect(screen.getByTestId("agent-ngu-canh-day").textContent).toContain("83%");
    expect(screen.getByTestId("agent-ngu-canh-day").textContent).toContain("NOTES.md");
  });
});

describe("DongThoiGianAgent — agent con", () => {
  it("★ nhiemVu / tomTat / chữ của con là CHỮ THUẦN: không <b>/<img>/<a>/<script>; nhãn 'từ repo' khi tuRepo", () => {
    const es = [
      BAT_DAU,
      CON,
      DOC({ loai: "chu", noiDung: "Kết quả <script>alert(1)</script> [bấm](javascript:alert(1)) ![i](http://evil.example/q.png)" }),
      { loai: "con-xong", runIdCon: "c1", lyDo: "hoan-thanh", tomTat: "<img src=x onerror=alert(1)> tóm tắt" } as SuKienAgent,
    ];
    const { container } = vẽ(hook(es));
    const khoi = screen.getByTestId("agent-con");
    expect(within(khoi).getByTestId("agent-con-ten").textContent).toContain("reviewer");
    expect(within(khoi).getByTestId("agent-con-tu-repo")).toBeInTheDocument();
    expect(within(khoi).getByTestId("agent-con-nhiem-vu").textContent).toBe("Soát <b>hàm</b> Divide ![x](http://evil.example/p.png)");
    expect(within(khoi).getByTestId("agent-con-chu").textContent).toContain("<script>alert(1)</script>");
    expect(within(khoi).getByTestId("agent-con-tom-tat").textContent).toBe("<img src=x onerror=alert(1)> tóm tắt");
    expect(khoi.getAttribute("data-trang-thai")).toBe("xong");
    expect(khoi.querySelectorAll("[data-md]").length).toBe(0); // chữ model của con KHÔNG đi qua bộ markdown
    expect(container.querySelectorAll("[data-testid='agent-con'] b, [data-testid='agent-con'] img, [data-testid='agent-con'] a, [data-testid='agent-con'] script").length).toBe(0);
  });

  it("nguồn dựng sẵn ⇒ KHÔNG có nhãn 'từ repo'", () => {
    vẽ(hook([BAT_DAU, { ...CON, nguon: "dungSan" } as SuKienAgent]));
    expect(screen.queryByTestId("agent-con-tu-repo")).toBeNull();
  });

  it("★ thẻ duyệt của con: bấm Duyệt gọi agent.duyet với ĐÚNG thẻ của con (actionId của con); Bác mở ô lý do", () => {
    const a = hook([BAT_DAU, CON, DOC({ loai: "can-duyet", id: "act-9", deXuat: { ten: "run_command", thamSo: { command: "ls" } } })]);
    vẽ(a);
    const the = within(screen.getByTestId("agent-con")).getByTestId("agent-the-duyet");
    expect(the.textContent).toContain("ls");
    fireEvent.click(within(the).getByRole("button", { name: "Duyệt" }));
    expect(a.duyet).toHaveBeenCalledTimes(1);
    expect((a.duyet as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toMatchObject({ kieu: "duyet", id: "act-9" });
  });

  it("con đang chạy ⇒ có chỉ báo 'đang chạy'; lỗi của con hiện chữ thuần", () => {
    vẽ(hook([BAT_DAU, CON, DOC({ loai: "loi", ma: "X", thongDiep: "<i>hỏng</i>" })]));
    expect(screen.getByTestId("agent-con-loi").textContent).toBe("<i>hỏng</i>");
    expect(screen.getByTestId("agent-con").textContent).toContain("đang chạy");
  });
});
