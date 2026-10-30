// @vitest-environment jsdom
//
// R1b-2b-2b B-T8 — Nhật ký lệnh `/scada/journal` (`commandLog.nhatKy`, Phần A C1).
// Component THẬT + bundle vi/en/zh THẬT; chỉ mock hợp đồng mạng, khung trang, sonner.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import * as React from "react";
import i18n from "i18next";
import vi_ from "@/i18n/locales/vi.json";
import en_ from "@/i18n/locales/en.json";
import zh_ from "@/i18n/locales/zh.json";
import { initLayoutKitTestI18n } from "@/components/patterns/layoutKitTestI18n";

const S = (k: string, o?: Record<string, string | number>): string => {
  const v = k.split(".").reduce<unknown>((x, p) => (x as Record<string, unknown> | undefined)?.[p], vi_);
  if (typeof v !== "string") throw new Error(`thiếu khoá vi: ${k}`);
  return o ? v.replace(/\{\{(\w+)\}\}/g, (_, n) => String(o[n])) : v;
};

const H = vi.hoisted(() => ({
  calls: [] as Array<Record<string, unknown>>,
  tra: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), info: vi.fn(), error: H.toastError, warning: vi.fn() } }));
vi.mock("@/components/DashboardLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      commandLog: {
        nhatKy: {
          fetch: (vars: Record<string, unknown>) => {
            H.calls.push(vars);
            return H.tra(vars);
          },
        },
      },
    }),
    scadaKenh: {
      cheDo: {
        danhSach: {
          useQuery: () => ({
            data: [
              { machineId: 7, code: "M-07", ten: "Máy bảy" },
              { machineId: 8, code: "M-08", ten: "Máy tám" },
            ],
            isLoading: false,
            isError: false,
          }),
        },
      },
    },
  },
}));

import ScadaNhatKy from "./ScadaNhatKy";
import { navItems } from "@/lib/navigation";

type Hang = Record<string, unknown>;
const hang = (o: Hang): Hang => ({
  nguon: "lenh",
  id: "lenh:1",
  at: "2026-10-30T01:00:00.000000Z",
  machineId: 7,
  adapterId: 70,
  adapterCode: "PLC-7",
  laStub: false,
  tagKey: "speed",
  commandType: "write",
  trangThai: "acked_verified",
  reasonCode: null,
  lyDo: null,
  nguoi: { id: 3, ten: "An", ngoaiPhamVi: false },
  triggerKind: "hitl",
  giaTri: 5,
  commandLogIds: [],
  requestId: null,
  loi: null,
  loiBiChe: false,
  ...o,
});

const TRANG1 = {
  hang: [
    hang({ id: "lenh:12", adapterCode: "SIM-1", laStub: true, trangThai: "simulated", tagKey: "stub_tag" }),
    hang({ id: "lenh:11", adapterCode: "PLC-7", laStub: false }),
    hang({
      nguon: "thu",
      id: "thu:5",
      trangThai: "dispatch:rejected",
      reasonCode: "CHUA_GHIM_STOP",
      lyDo: "dừng gấp",
      commandLogIds: [11, 99],
      commandType: null,
    }),
  ],
  conTro: "CON-TRO-1",
};

const hangCua = (id: string) => screen.getByTestId(`hang-${id}`);

beforeEach(async () => {
  initLayoutKitTestI18n();
  await i18n.changeLanguage("vi");
  H.calls.length = 0;
  H.tra.mockReset();
  H.toastError.mockReset();
});
afterEach(() => cleanup());

describe("ScadaNhatKy — /scada/journal (B-T8)", () => {
  it("★ nhãn 'sim' CHỈ ở hàng laStub (không theo trạng thái 'simulated'); lần thử hiện câu đã dịch của mã + lý do", async () => {
    H.tra.mockResolvedValue({
      hang: [
        ...TRANG1.hang,
        hang({ id: "lenh:10", laStub: false, trangThai: "simulated" }), // simulated nhưng KHÔNG stub ⇒ không nhãn
      ],
      conTro: null,
    });
    render(<ScadaNhatKy />);
    await screen.findByTestId("hang-lenh:12");
    expect(screen.getAllByTestId("nhan-sim")).toHaveLength(1);
    const nhan = within(hangCua("lenh:12")).getByTestId("nhan-sim");
    expect(nhan).toHaveTextContent(S("scada.nhatKy.sim"));
    expect(nhan).toHaveAttribute("title", S("scada.nhatKy.simGiaiThich"));
    expect(within(hangCua("lenh:10")).queryByTestId("nhan-sim")).toBeNull();
    const thu = hangCua("thu:5");
    expect(thu).toHaveTextContent(S("scada.lenh.loi.CHUA_GHIM_STOP"));
    expect(thu).toHaveTextContent("dừng gấp");
    expect(thu).toHaveTextContent(S("scada.nhatKy.thu.dispatch.rejected"));
  });

  it("★ 'Tải thêm' gửi conTro của trang trước; hàng nối không trùng id; conTro null ⇒ ẩn nút", async () => {
    H.tra.mockResolvedValueOnce(TRANG1).mockResolvedValueOnce({
      hang: [hang({ id: "lenh:11" }), hang({ id: "lenh:9", tagKey: "t9" })], // lenh:11 trùng ⇒ bị loại
      conTro: null,
    });
    render(<ScadaNhatKy />);
    await screen.findByTestId("hang-lenh:12");
    expect(H.calls[0]).not.toHaveProperty("conTro");
    fireEvent.click(screen.getByRole("button", { name: S("scada.nhatKy.taiThem") }));
    await screen.findByTestId("hang-lenh:9");
    expect(H.calls).toHaveLength(2);
    expect(H.calls[1]).toMatchObject({ conTro: "CON-TRO-1" });
    expect(screen.getAllByTestId(/^hang-lenh:11$/)).toHaveLength(1);
    expect(screen.queryByRole("button", { name: S("scada.nhatKy.taiThem") })).toBeNull();
  });

  it("lọc máy ⇒ vars.machineId và về trang đầu (không conTro); lọc nguồn / trạng thái đi vào vars", async () => {
    H.tra.mockResolvedValue(TRANG1);
    render(<ScadaNhatKy />);
    await screen.findByTestId("hang-lenh:12");
    fireEvent.change(screen.getByLabelText(S("scada.nhatKy.loc.may")), { target: { value: "8" } });
    await waitFor(() => expect(H.calls.at(-1)).toMatchObject({ machineId: 8 }));
    expect(H.calls.at(-1)).not.toHaveProperty("conTro");
    fireEvent.change(screen.getByLabelText(S("scada.nhatKy.loc.nguon")), { target: { value: "thu" } });
    await waitFor(() => expect(H.calls.at(-1)).toMatchObject({ machineId: 8, nguon: "thu" }));
    fireEvent.click(screen.getByLabelText(S("scada.nhatKy.trangThai.failed")));
    await waitFor(() => expect(H.calls.at(-1)).toMatchObject({ trangThai: ["failed"] }));
  });

  it("đổi bộ lọc SAU khi đã tải thêm ⇒ về trang đầu: hàng cũ biến mất, không conTro", async () => {
    H.tra.mockResolvedValueOnce(TRANG1).mockResolvedValueOnce({ hang: [hang({ id: "lenh:9" })], conTro: null });
    render(<ScadaNhatKy />);
    await screen.findByTestId("hang-lenh:12");
    fireEvent.click(screen.getByRole("button", { name: S("scada.nhatKy.taiThem") }));
    await screen.findByTestId("hang-lenh:9");
    H.tra.mockResolvedValueOnce({ hang: [hang({ id: "lenh:77" })], conTro: null });
    fireEvent.change(screen.getByLabelText(S("scada.nhatKy.loc.nguon")), { target: { value: "lenh" } });
    await screen.findByTestId("hang-lenh:77");
    expect(screen.queryByTestId("hang-lenh:9")).toBeNull();
    expect(H.calls.at(-1)).not.toHaveProperty("conTro");
  });

  it("★ NOT_FOUND khi lọc máy ⇒ báo lỗi và XOÁ bộ lọc máy (tải lại không còn machineId)", async () => {
    const loi = Object.assign(new Error("x"), { data: { code: "NOT_FOUND", appCode: "ENTITY_NOT_FOUND", appParams: { entity: "machine" } } });
    H.tra.mockImplementation((v: Record<string, unknown>) => (v.machineId === 8 ? Promise.reject(loi) : Promise.resolve(TRANG1)));
    render(<ScadaNhatKy />);
    await screen.findByTestId("hang-lenh:12");
    fireEvent.change(screen.getByLabelText(S("scada.nhatKy.loc.may")), { target: { value: "8" } });
    await waitFor(() => expect(H.toastError).toHaveBeenCalledTimes(1));
    expect(H.toastError.mock.calls[0][0]).not.toMatch(/undefined|null|\{\{/);
    await waitFor(() => expect((screen.getByLabelText(S("scada.nhatKy.loc.may")) as HTMLSelectElement).value).toBe(""));
    await waitFor(() => expect(H.calls.at(-1)).not.toHaveProperty("machineId"));
  });

  it("★ người xem không phải kỹ sư: lệnh bị che ⇒ mã đã dịch + 'chi tiết bị ẩn'; lần thử dispatch bị che lyDo ⇒ 'chi tiết bị ẩn', KHÔNG '—' (N6)", async () => {
    H.tra.mockResolvedValue({
      hang: [
        hang({ id: "lenh:20", trangThai: "failed", reasonCode: "DRIVER_WRITE_FAILED", loi: null, loiBiChe: true }),
        hang({ nguon: "thu", id: "thu:21", trangThai: "dispatch:rejected", reasonCode: "STOP_QUA_HAN", lyDo: null, loiBiChe: true }),
        hang({ nguon: "thu", id: "thu:22", trangThai: "request:rejected", reasonCode: "MA_LA_XYZ", lyDo: "gõ tay", loiBiChe: false }),
      ],
      conTro: null,
    });
    render(<ScadaNhatKy />);
    await screen.findByTestId("hang-lenh:20");
    const an = S("commandAudit.loiBiChe");
    expect(hangCua("lenh:20")).toHaveTextContent(S("commandAudit.maLoi.DRIVER_WRITE_FAILED"));
    expect(hangCua("lenh:20")).toHaveTextContent(an);
    expect(hangCua("thu:21")).toHaveTextContent(S("scada.lenh.loi.STOP_QUA_HAN"));
    expect(hangCua("thu:21")).toHaveTextContent(an);
    // mã lạ ⇒ mã thô (không trống); lý do người gõ hiện nguyên
    expect(hangCua("thu:22")).toHaveTextContent("MA_LA_XYZ");
    expect(hangCua("thu:22")).toHaveTextContent("gõ tay");
    expect(hangCua("thu:22")).not.toHaveTextContent(an);
  });

  it("kỹ sư: loi hiện nguyên; loi null và không bị che ⇒ '—'; người ngoài phạm vi ⇒ 'quản trị' đã dịch, không id", async () => {
    H.tra.mockResolvedValue({
      hang: [
        hang({ id: "lenh:30", trangThai: "failed", reasonCode: "DRIVER_WRITE_FAILED", loi: "connect ECONNREFUSED 127.0.0.1:502", nguoi: { id: null, ten: "quản trị", ngoaiPhamVi: true } }),
        hang({ id: "lenh:31", nguoi: null, adapterCode: null, machineId: null, tagKey: null }),
      ],
      conTro: null,
    });
    render(<ScadaNhatKy />);
    await screen.findByTestId("hang-lenh:30");
    expect(hangCua("lenh:30")).toHaveTextContent("connect ECONNREFUSED 127.0.0.1:502");
    expect(hangCua("lenh:30")).toHaveTextContent(S("scada.nhatKy.nguoiNgoaiPhamVi"));
    expect(hangCua("lenh:31").textContent).not.toMatch(/null|undefined/);
  });

  it("liên kết lần thử → lệnh: #id có trên trang là liên kết neo, không có thì là chữ", async () => {
    H.tra.mockResolvedValue(TRANG1);
    render(<ScadaNhatKy />);
    await screen.findByTestId("hang-thu:5");
    const o = within(hangCua("thu:5"));
    expect(o.getByText("#11").closest("a")).toHaveAttribute("href", "#nhatky-lenh-11");
    expect(o.getByText("#99").closest("a")).toBeNull();
  });

  it("trang trống ⇒ câu trống; lỗi tải trang đầu ⇒ câu lỗi", async () => {
    H.tra.mockResolvedValueOnce({ hang: [], conTro: null });
    const { unmount } = render(<ScadaNhatKy />);
    await screen.findByText(S("scada.nhatKy.trong"));
    unmount();
    H.tra.mockRejectedValueOnce(Object.assign(new Error("x"), { data: { code: "INTERNAL_SERVER_ERROR" } }));
    render(<ScadaNhatKy />);
    await screen.findByText(S("scada.nhatKy.loiTai"));
  });

  it("en / zh: nhãn và mã dịch sang ngôn ngữ thật, không còn tiếng Việt", async () => {
    H.tra.mockResolvedValue(TRANG1);
    i18n.addResourceBundle("en", "translation", en_ as Record<string, unknown>, true, true);
    i18n.addResourceBundle("zh", "translation", zh_ as Record<string, unknown>, true, true);
    for (const lng of ["en", "zh"]) {
      await i18n.changeLanguage(lng);
      const { unmount } = render(<ScadaNhatKy />);
      await screen.findByTestId("hang-lenh:12");
      const txt = hangCua("thu:5").textContent ?? "";
      expect(txt).not.toMatch(/Máy chưa ghim|bị từ chối/);
      expect(within(hangCua("lenh:12")).getByTestId("nhan-sim").textContent).toBe(i18n.t("scada.nhatKy.sim"));
      expect(document.body.textContent).not.toMatch(/scada\.nhatKy|\{\{/);
      unmount();
    }
  });

  it("mục điều hướng /scada/journal có mặt, cần machine_control, không riêng cho kỹ sư", () => {
    const muc = navItems.find((i) => i.href === "/scada/journal");
    expect(muc).toBeTruthy();
    expect(muc).toMatchObject({ requiredPermission: "machine_control", permissionCategory: "machine_control", section: "connect", engineerOriented: false });
  });
});
