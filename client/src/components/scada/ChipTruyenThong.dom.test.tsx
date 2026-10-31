// @vitest-environment jsdom
//
// R1b-2b-2b B-T7 — chip "Truyền thông n/m" (scadaDiag.tomTatTruyenThong, hợp đồng C2) + hiển thị endpoint / lỗi bị che.
// Render THẬT với bundle i18n vi/en/zh THẬT; chỉ mock hợp đồng mạng.
//   - chip: "Truyền thông {ketNoi}/{tong}" (+ " · edge {edge}" khi > 0); edge KHÔNG vào mẫu số; mất > 0 ⇒ tone "mat"; lỗi / đang tải /
//     tong = 0 & edge = 0 ⇒ không render; là liên kết tới /scada/diag.
//   - bảng M10 + ngăn tag: endpoint / loi null ⇒ "—", title rỗng, KHÔNG chuỗi "null" / "undefined"; maLoi hiện câu dịch; tamKhoa
//     hiện huy hiệu và KHÔNG bao giờ bị che.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import * as React from "react";
import i18next from "i18next";
import vi_ from "@/i18n/locales/vi.json";
import en_ from "@/i18n/locales/en.json";
import zh_ from "@/i18n/locales/zh.json";
import { initLayoutKitTestI18n } from "@/components/patterns/layoutKitTestI18n";

const srv = vi.hoisted(() => ({
  data: undefined as unknown,
  isError: false,
  isLoading: false,
  opts: undefined as Record<string, unknown> | undefined,
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    scadaDiag: {
      tomTatTruyenThong: {
        useQuery: (_i: unknown, o?: Record<string, unknown>) => {
          srv.opts = o;
          return { data: srv.data, isError: srv.isError, isLoading: srv.isLoading };
        },
      },
    },
  },
}));

import { ChipTruyenThong } from "./ChipTruyenThong";
import { BangTruyenThong, type HangDiag } from "./BangTruyenThong";

beforeAll(async () => {
  await initLayoutKitTestI18n();
  i18next.addResourceBundle("vi", "translation", vi_, true, true);
  i18next.addResourceBundle("en", "translation", en_, true, true);
  i18next.addResourceBundle("zh", "translation", zh_, true, true);
  await i18next.changeLanguage("vi");
});
afterEach(() => {
  cleanup();
  srv.data = undefined;
  srv.isError = false;
  srv.isLoading = false;
});

const TOM = { ketNoi: 3, dangNoi: 0, mat: 1, khac: 0, tong: 4, edge: 1, tinhLuc: "2026-10-31T00:00:00.000Z" };

describe("ChipTruyenThong", () => {
  it("★ 3/4 · edge 1, tone mất, liên kết /scada/diag, làm mới 15 s không thử lại", () => {
    srv.data = TOM;
    render(<ChipTruyenThong />);
    const chip = screen.getByRole("link", { name: /Truyền thông 3\/4 · edge 1/ });
    expect(chip).toHaveAttribute("href", "/scada/diag");
    expect(chip).toHaveAttribute("data-tone", "mat");
    expect(srv.opts).toMatchObject({ refetchInterval: 15_000, retry: false });
  });

  it("edge = 0 ⇒ không có đoạn '· edge'; đang nối lại ⇒ tone dang_noi; sạch ⇒ trung tính", () => {
    srv.data = { ...TOM, mat: 0, dangNoi: 1, ketNoi: 3, tong: 4, edge: 0 };
    const { rerender } = render(<ChipTruyenThong />);
    expect(screen.getByRole("link")).toHaveTextContent(/^Truyền thông 3\/4$/);
    expect(screen.getByRole("link")).toHaveAttribute("data-tone", "dang_noi");
    srv.data = { ...TOM, mat: 0, dangNoi: 0, ketNoi: 4, tong: 4, edge: 0 };
    rerender(<ChipTruyenThong />);
    expect(screen.getByRole("link")).toHaveAttribute("data-tone", "trung_tinh");
  });

  it("lỗi query / đang tải / không có adapter nào ⇒ không render", () => {
    srv.isError = true;
    const { container, rerender } = render(<ChipTruyenThong />);
    expect(container).toBeEmptyDOMElement();
    srv.isError = false;
    srv.isLoading = true;
    rerender(<ChipTruyenThong />);
    expect(container).toBeEmptyDOMElement();
    srv.isLoading = false;
    srv.data = { ...TOM, ketNoi: 0, mat: 0, tong: 0, edge: 0 };
    rerender(<ChipTruyenThong />);
    expect(container).toBeEmptyDOMElement();
  });

  it("chỉ có adapter edge (tong 0, edge 2) ⇒ vẫn hiện, 0/0 · edge 2", () => {
    srv.data = { ...TOM, ketNoi: 0, mat: 0, tong: 0, edge: 2 };
    render(<ChipTruyenThong />);
    expect(screen.getByRole("link")).toHaveTextContent("Truyền thông 0/0 · edge 2");
  });

  it("en / zh: nhãn đổi theo ngôn ngữ", async () => {
    srv.data = TOM;
    await i18next.changeLanguage("en");
    const { unmount } = render(<ChipTruyenThong />);
    expect(screen.getByRole("link").textContent).toMatch(/^Communication 3\/4 · edge 1$/);
    unmount();
    await i18next.changeLanguage("zh");
    render(<ChipTruyenThong />);
    expect(screen.getByRole("link").textContent).toMatch(/3\/4/);
    expect(screen.getByRole("link").textContent).not.toMatch(/Truyền|Communication/);
    await i18next.changeLanguage("vi");
  });
});

const HANG: HangDiag = {
  adapterId: 1,
  code: "PLC1",
  ten: "PLC một",
  protocol: "s7",
  endpoint: null,
  loi: null,
  maLoi: null,
  tamKhoa: null,
  trangThai: "connected",
  tu: null,
  lyDo: null,
  machineId: null,
  soHuu: { loai: "trung_tam" },
  pollMs: 1000,
  p95Ms: 12,
  boDem1h: { request: 5, loi: 0, timeout: 0 },
  tag: { tot: 1, nghiNgo: 0, xau: 0 },
} as unknown as HangDiag;

function bang(h: Partial<HangDiag>) {
  return render(
    <BangTruyenThong rows={[{ ...HANG, ...h } as HangDiag]} now={Date.now()} canAct={false} onChon={() => {}} onKetNoiLai={() => {}} onTamTat={() => {}} />,
  );
}

describe("BangTruyenThong — endpoint / lỗi bị che", () => {
  it("★ endpoint null + loi null + maLoi null ⇒ '—', title rỗng, DOM không có 'null' / 'undefined'", () => {
    const { container } = bang({});
    expect(container.textContent).not.toMatch(/null|undefined/);
    const o = screen.getByTestId("endpoint-adapter-1");
    expect(o).toHaveTextContent("—");
    expect(o).not.toHaveAttribute("title");
    expect(screen.getByTestId("loi-adapter-1")).toHaveTextContent("—");
  });

  it("kỹ sư: endpoint + loi là văn bản thật, title = endpoint", () => {
    bang({ endpoint: "opc.tcp://10.0.0.5:4840", loi: "ECONNREFUSED 10.0.0.5" });
    expect(screen.getByTestId("endpoint-adapter-1")).toHaveTextContent("opc.tcp://10.0.0.5:4840");
    expect(screen.getByTestId("endpoint-adapter-1")).toHaveAttribute("title", "opc.tcp://10.0.0.5:4840");
    expect(screen.getByTestId("loi-adapter-1")).toHaveTextContent("ECONNREFUSED 10.0.0.5");
  });

  it("★ loi null nhưng có maLoi ⇒ hiện câu DỊCH của mã (không mã trần); mã lạ ⇒ mã thô", async () => {
    bang({ maLoi: "OT_S7_BIT_NGOAI_DAI" });
    expect(screen.getByTestId("loi-adapter-1").textContent).toBe(
      (vi_ as unknown as { commandAudit: { maLoi: Record<string, string> } }).commandAudit.maLoi.OT_S7_BIT_NGOAI_DAI,
    );
    cleanup();
    bang({ maLoi: "MA_LA_CHUA_BIET_X" });
    expect(screen.getByTestId("loi-adapter-1")).toHaveTextContent("MA_LA_CHUA_BIET_X");
  });

  it("★ tamKhoa MC hiện huy hiệu 'tạm khoá' với lý do dịch — kể cả khi mọi chi tiết khác bị che", () => {
    bang({ tamKhoa: { ma: "OT_MC_TAM_KHOA", lyDo: "errors.reason.otMcTamKhoa" } });
    const hh = screen.getByTestId("tam-khoa-adapter-1");
    expect(hh).toHaveTextContent("Tạm khoá");
    expect(hh).toHaveAttribute("title", (vi_ as unknown as { errors: { reason: Record<string, string> } }).errors.reason.otMcTamKhoa);
  });

  it("tamKhoa null ⇒ không có huy hiệu", () => {
    bang({});
    expect(screen.queryByTestId("tam-khoa-adapter-1")).toBeNull();
  });
});
