// @vitest-environment jsdom
//
// Đợt 11.8 — màn "Agent từ repo": đọc → xác nhận (gửi đúng BĂM của bản đang xem); chữ thuần; nút tin cậy chỉ bật sau khi ĐỌC; đổi băm ⇒ phải đọc lại.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

function noiSuy(s: string, o?: Record<string, unknown>): string {
  return o ? s.replace(/\{\{(\w+)\}\}/g, (_, k) => String(o[k] ?? "")) : s;
}
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string, a?: unknown, b?: unknown) => (typeof a === "string" ? noiSuy(a, b as Record<string, unknown>) : k) }),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/lib/trpc", () => ({ trpc: {} }));

import { NoiDungBangAgentTuRepo, cauNoteAgentTuRepo, type MucAgentUI } from "./BangAgentTuRepo";

afterEach(cleanup);

const B1 = "a".repeat(64);
const B2 = "b".repeat(64);
const MUC = (o: Partial<MucAgentUI> = {}): MucAgentUI => ({
  ten: "reviewer",
  moTa: "Soát <b>mã</b> ![x](http://evil.example/p.png)",
  nguon: "tuRepo",
  congCu: ["read_file", "grep"],
  model: "auto",
  cheDo: "hoi",
  maxLuot: 8,
  bam: B1,
  daTinCay: false,
  noiDungHienThi: "---\nname: reviewer\n---\n<script>alert(1)</script> \\u{202E}",
  ...o,
});
const vẽ = (muc: MucAgentUI[], o: Partial<Parameters<typeof NoiDungBangAgentTuRepo>[0]> = {}) => {
  const onTinCay = vi.fn();
  const onGoTinCay = vi.fn();
  const r = render(<NoiDungBangAgentTuRepo muc={muc} canhBao={[]} dangTai={false} biTuChoi={false} dangGui={null} onTinCay={onTinCay} onGoTinCay={onGoTinCay} {...o} />);
  return { ...r, onTinCay, onGoTinCay };
};

describe("NoiDungBangAgentTuRepo", () => {
  it("★ mô tả + nội dung tệp là CHỮ THUẦN: không <b>/<img>/<a>/<script>", () => {
    const { container } = vẽ([MUC()]);
    fireEvent.click(screen.getByTestId("atr-doc"));
    expect(screen.getByTestId("atr-mo-ta").textContent).toBe("Soát <b>mã</b> ![x](http://evil.example/p.png)");
    expect(screen.getByTestId("atr-noi-dung-tep").textContent).toContain("<script>alert(1)</script>");
    expect(container.querySelectorAll("b, img, a, script").length).toBe(0);
  });

  it("★ nút Tin cậy KHOÁ cho tới khi mở đọc nội dung; sau khi đọc ⇒ gửi (tên, ĐÚNG băm của bản đang xem)", () => {
    const { onTinCay } = vẽ([MUC()]);
    expect(screen.getByTestId("atr-tin-cay")).toBeDisabled();
    expect(screen.getByTestId("atr-can-doc")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("atr-tin-cay"));
    expect(onTinCay).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("atr-doc"));
    expect(screen.getByTestId("atr-tin-cay")).toBeEnabled();
    fireEvent.click(screen.getByTestId("atr-tin-cay"));
    expect(onTinCay).toHaveBeenCalledWith("reviewer", B1);
  });

  it("★ tệp đổi băm giữa lúc đọc và xác nhận (danh sách tải lại bản mới) ⇒ nút khoá lại, phải đọc bản mới", () => {
    const { rerender, onTinCay } = vẽ([MUC()]);
    fireEvent.click(screen.getByTestId("atr-doc"));
    expect(screen.getByTestId("atr-tin-cay")).toBeEnabled();
    rerender(<NoiDungBangAgentTuRepo muc={[MUC({ bam: B2, noiDungHienThi: "bản mới" })]} canhBao={[]} dangTai={false} biTuChoi={false} dangGui={null} onTinCay={onTinCay} onGoTinCay={vi.fn()} />);
    expect(screen.getByTestId("atr-tin-cay")).toBeDisabled();
    fireEvent.click(screen.getByTestId("atr-doc")); // mở bản mới
    fireEvent.click(screen.getByTestId("atr-tin-cay"));
    expect(onTinCay).toHaveBeenCalledWith("reviewer", B2);
  });

  it("đã tin cậy ⇒ nhãn 'đã tin cậy', KHÔNG có nút tin cậy; Gỡ tin cậy gọi onGoTinCay(tên)", () => {
    const { onGoTinCay } = vẽ([MUC({ daTinCay: true })]);
    expect(screen.getByTestId("atr-da-tin")).toBeInTheDocument();
    expect(screen.queryByTestId("atr-tin-cay")).toBeNull();
    fireEvent.click(screen.getByTestId("atr-go-tin"));
    expect(onGoTinCay).toHaveBeenCalledWith("reviewer");
  });

  it("★ nội dung KHÔNG có (null) ⇒ không có nút Đọc, và 'Tin cậy' vẫn KHOÁ (không tin cậy khi chưa đọc được gì)", () => {
    vẽ([MUC({ noiDungHienThi: null })]);
    expect(screen.queryByTestId("atr-doc")).toBeNull();
    expect(screen.getByTestId("atr-tin-cay")).toBeDisabled();
    fireEvent.click(screen.getByTestId("atr-tin-cay"));
  });

  it("đang gửi ⇒ nút khoá (không bấm đúp)", () => {
    vẽ([MUC({ daTinCay: true })], { dangGui: "reviewer" });
    expect(screen.getByTestId("atr-go-tin")).toBeDisabled();
  });

  it("dựng sẵn liệt kê riêng, không có nút xác nhận; tệp bị bỏ hiện tên tệp + mã; không có quyền ⇒ thông báo", () => {
    vẽ([MUC(), MUC({ ten: "doc-code", nguon: "dungSan", noiDungHienThi: null, daTinCay: true, bam: B2 })], { canhBao: [{ tep: "bad.md", ma: "TOO_BIG" }] });
    expect(screen.getAllByTestId("atr-dung-san")).toHaveLength(1);
    expect(within(screen.getByTestId("atr-canh-bao")).getByText("bad.md")).toBeInTheDocument();
    cleanup();
    vẽ([], { biTuChoi: true });
    expect(screen.getByTestId("atr-bi-tu-choi")).toBeInTheDocument();
    cleanup();
    vẽ([]);
    expect(screen.getByTestId("atr-rong")).toBeInTheDocument();
  });

  it("cauNoteAgentTuRepo: mã biết ⇒ khoá riêng; mã lạ ⇒ khoá 'khac' kèm mã", () => {
    const t = (k: string, o?: Record<string, unknown>) => `${k}|${o ? JSON.stringify(o) : ""}`;
    expect(cauNoteAgentTuRepo("BAM_LECH", t)).toBe("repoWs.agentTuRepo.note.BAM_LECH|");
    expect(cauNoteAgentTuRepo("XYZ", t)).toBe('repoWs.agentTuRepo.note.khac|{"ma":"XYZ"}');
  });
});
