// @vitest-environment jsdom
//
// SCADA R1a Task 14 — M5 hộp thoại lệnh (`HopThoaiLenh`). Render THẬT với bundle vi/en/zh THẬT; chỉ mock hợp đồng mạng (`@/lib/trpc`),
// socket dùng chung (`@/lib/socketManager`) và danh tính (`useAuth`).
// Hợp đồng (brief Task 14 + báo cáo §4.6 + điều phối 2026-10-24):
//   - hiện đủ trường preview; đếm ngược tới expiresAt, về 0 ⇒ khoá nút gửi; mode simulated ⇒ nút "Gửi (mô phỏng)";
//   - mức 4–5 / needsTotp ⇒ ô TOTP 6 số; mức 5 ⇒ bắt buộc;
//   - kết quả theo nhanKetQua: acked_verified tự đóng sau 3 s, MỌI trạng thái khác không tự đóng;
//   - từ chối nói lý do + cách xử lý, không chỉ mã; đóng khi còn proposed ⇒ huy.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import * as React from "react";
import i18next from "i18next";
import vi_ from "@/i18n/locales/vi.json";
import en_ from "@/i18n/locales/en.json";
import zh_ from "@/i18n/locales/zh.json";
import { initLayoutKitTestI18n } from "@/components/patterns/layoutKitTestI18n";

const S = (k: string, o?: Record<string, string | number>): string => {
  const v = k.split(".").reduce<unknown>((x, p) => (x as Record<string, unknown> | undefined)?.[p], vi_);
  if (typeof v !== "string") throw new Error(`thiếu khoá vi: ${k}`);
  return o ? v.replace(/\{\{(\w+)\}\}/g, (_, n) => String(o[n])) : v;
};

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: 9, role: "operator", name: "T" }, loading: false, isAuthenticated: true }),
}));

type Handler = (p: unknown) => void;
const sock = vi.hoisted(() => ({
  handlers: {} as Record<string, Set<(p: unknown) => void>>,
  emitted: [] as Array<{ ev: string; arg: unknown }>,
  connected: true,
}));
vi.mock("@/lib/socketManager", () => {
  const s = {
    get connected() {
      return sock.connected;
    },
    on: (ev: string, h: Handler) => {
      (sock.handlers[ev] ??= new Set()).add(h);
      return s;
    },
    off: (ev: string, h: Handler) => {
      sock.handlers[ev]?.delete(h);
      return s;
    },
    emit: (ev: string, arg: unknown) => {
      sock.emitted.push({ ev, arg });
      return s;
    },
  };
  return { getSharedSocket: () => s, releaseSharedSocket: () => undefined };
});
const phat = (ev: string, p: unknown) => sock.handlers[ev]?.forEach((h) => h(p));

const srv = vi.hoisted(() => ({
  calls: [] as Array<{ proc: string; vars: unknown }>,
  opts: {} as Record<string, { onSuccess?: (r: unknown) => void; onError?: (e: unknown) => void }>,
  pending: {} as Record<string, boolean>,
}));
vi.mock("@/lib/trpc", () => {
  const mut = (proc: string) => ({
    useMutation: (opts: { onSuccess?: (r: unknown) => void; onError?: (e: unknown) => void }) => {
      srv.opts[proc] = opts;
      return { mutate: (vars: unknown) => srv.calls.push({ proc, vars }), isPending: !!srv.pending[proc] };
    },
  });
  return { trpc: { scadaCommands: { request: mut("request"), confirm: mut("confirm"), huy: mut("huy") } } };
});

import { HopThoaiLenh, type YeuCauLenh } from "./HopThoaiLenh";

const RID = "11111111-2222-4333-8444-555555555555";
const preview = (o: Partial<YeuCauLenh["preview"]> = {}): YeuCauLenh["preview"] => ({
  machine: "RF-2",
  channel: "zone7_top.sp",
  unit: "°C",
  current: { v: 245, q: "good", ageMs: 600 },
  requested: 240.5,
  afterFormula: 240.5,
  range: { min: 240, max: 250, step: 0.5 },
  level: 3,
  needsTotp: false,
  mode: "real",
  simulatedReasons: [],
  route: "central",
  warnings: ["SAFETY_KIEM_LUC_GUI"],
  ...o,
});
const yeuCau = (o: Partial<YeuCauLenh["preview"]> = {}, msConLai = 54_000): YeuCauLenh => ({
  requestId: RID,
  expiresAt: new Date(Date.now() + msConLai).toISOString(),
  preview: preview(o),
});
const LY_DO = "Zone 7 HiHi, giam SP theo PCN-0412";

beforeAll(async () => {
  await initLayoutKitTestI18n();
  (globalThis as any).ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.scrollIntoView ??= function () {};
  (Element.prototype as any).hasPointerCapture ??= () => false;
  (Element.prototype as any).releasePointerCapture ??= () => {};
  i18next.addResourceBundle("en", "translation", en_ as Record<string, unknown>, true, true);
  i18next.addResourceBundle("zh", "translation", zh_ as Record<string, unknown>, true, true);
});
beforeEach(() => {
  srv.calls = [];
  srv.opts = {};
  srv.pending = {};
  sock.handlers = {};
  sock.emitted = [];
  sock.connected = true;
});
afterEach(async () => {
  cleanup();
  vi.useRealTimers();
  await act(async () => {
    await i18next.changeLanguage("vi");
  });
});

// chỉ giả đồng hồ hẹn giờ + Date (không giả rAF / microtask mà Radix dùng)
const FAKE: Parameters<typeof vi.useFakeTimers>[0] = { toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] };
const hop = () => screen.getByRole("dialog");
const thoat = (s: string) => s.replace(/[()]/g, "\\$&");
// tên nút theo NGÔN NGỮ ĐANG DÙNG (ca en/zh tìm đúng nút đã dịch)
const nutGui = () =>
  within(hop()).getByRole("button", {
    name: new RegExp(`^(${thoat(i18next.t("scada.lenh.nut.gui"))}|${thoat(i18next.t("scada.lenh.nut.guiMoPhong"))})$`),
  });
const goi = (proc: string) => srv.calls.filter((c) => c.proc === proc);
const loi = (appCode: string, appParams: Record<string, unknown>) => ({ message: "x", data: { appCode, appParams } });
const traLoi = async (proc: string, kind: "onSuccess" | "onError", v: unknown) => {
  await act(async () => {
    srv.opts[proc]?.[kind]?.(v);
  });
};
const ve = (props: Partial<React.ComponentProps<typeof HopThoaiLenh>> = {}) => {
  const onDong = vi.fn();
  render(<HopThoaiLenh yeuCau={yeuCau()} lyDo={LY_DO} dinhDang="0.0" edgeCode={null} onDong={onDong} {...props} />);
  return { onDong };
};
const bamGui = () => fireEvent.click(nutGui());

describe("M5 — bản xem trước", () => {
  it("hiện đủ trường: máy, kênh + đơn vị, hiện tại (giá trị · chất lượng · tuổi), yêu cầu, sau công thức, dải, mức, chế độ, đường, lý do", () => {
    ve();
    const h = hop();
    expect(within(h).getByText(S("scada.lenh.tieuDe"))).toBeInTheDocument();
    const truong = (k: string) => within(h).getByTestId(`truong-${k}`);
    expect(truong("may")).toHaveTextContent("RF-2");
    expect(truong("kenh")).toHaveTextContent("zone7_top.sp");
    expect(truong("kenh")).toHaveTextContent("°C");
    expect(truong("hienTai")).toHaveTextContent("245,0");
    expect(truong("hienTai")).toHaveTextContent(S("scada.diag.chatLuong.tot"));
    expect(truong("hienTai")).toHaveTextContent(`0,6 ${S("scada.diag.donVi.giay")}`);
    expect(truong("yeuCau")).toHaveTextContent("240,5");
    expect(truong("sauCongThuc")).toHaveTextContent("240,5");
    expect(truong("dai")).toHaveTextContent(S("scada.lenh.daiBuoc", { min: "240", max: "250", buoc: "0,5" }));
    expect(truong("muc")).toHaveTextContent(S("scada.lenh.mucKhongTotp", { muc: 3 }));
    expect(truong("cheDo")).toHaveTextContent(S("scada.lenh.cheDoThat"));
    expect(truong("duong")).toHaveTextContent(S("scada.lenh.duongCentral"));
    expect(truong("lyDo")).toHaveTextContent(LY_DO);
    expect(within(h).getByText(S("scada.lenh.canhBaoMa.SAFETY_KIEM_LUC_GUI"))).toBeInTheDocument();
    expect(nutGui()).toHaveTextContent(S("scada.lenh.nut.gui"));
    expect(nutGui()).toBeEnabled();
  });

  it("mode simulated ⇒ dòng chế độ 'MÔ PHỎNG' kèm lý do, nút 'Gửi (mô phỏng)'", () => {
    ve({ yeuCau: yeuCau({ mode: "simulated", simulatedReasons: ["OT_CONTROL_TAT", "CHUA_NGHIEM_THU"] }) });
    const cd = within(hop()).getByTestId("truong-cheDo");
    expect(cd).toHaveTextContent(S("scada.lenh.cheDoMoPhong"));
    expect(cd).toHaveTextContent(S("scada.lenh.moPhong.OT_CONTROL_TAT"));
    expect(cd).toHaveTextContent(S("scada.lenh.moPhong.CHUA_NGHIEM_THU"));
    expect(nutGui()).toHaveTextContent("Gửi (mô phỏng)");
  });

  it("đếm ngược tới expiresAt; về 0 ⇒ nút gửi bị khoá + chữ hết giờ", async () => {
    vi.useFakeTimers(FAKE);
    ve({ yeuCau: yeuCau({}, 3_000) });
    expect(within(hop()).getByTestId("dem-nguoc")).toHaveTextContent(S("scada.lenh.conLai", { giay: 3 }));
    expect(nutGui()).toBeEnabled();
    await act(async () => {
      vi.advanceTimersByTime(1_000);
    });
    expect(within(hop()).getByTestId("dem-nguoc")).toHaveTextContent(S("scada.lenh.conLai", { giay: 2 }));
    await act(async () => {
      vi.advanceTimersByTime(2_500);
    });
    expect(nutGui()).toBeDisabled();
    expect(within(hop()).getByText(S("scada.lenh.hetGio"))).toBeInTheDocument();
    bamGui();
    expect(goi("confirm")).toHaveLength(0);
  });

  it("gửi ⇒ confirm({requestId}) không mã TOTP khi mức 3", () => {
    ve();
    bamGui();
    expect(goi("confirm")).toEqual([{ proc: "confirm", vars: { requestId: RID } }]);
  });
});

describe("M5 — TOTP", () => {
  it("mức 5 ⇒ ô TOTP 6 số BẮT BUỘC: nút khoá tới khi đủ 6 số; confirm mang totpCode", () => {
    ve({ yeuCau: yeuCau({ level: 5, needsTotp: true }) });
    const o = within(hop()).getByLabelText(S("scada.lenh.totp.nhan"));
    expect(within(hop()).getByTestId("truong-muc")).toHaveTextContent(S("scada.lenh.mucCanTotp", { muc: 5 }));
    expect(nutGui()).toBeDisabled();
    fireEvent.change(o, { target: { value: "12345" } });
    expect(nutGui()).toBeDisabled();
    fireEvent.change(o, { target: { value: "12a34x56" } }); // chỉ giữ chữ số
    expect(o).toHaveValue("123456");
    expect(nutGui()).toBeEnabled();
    bamGui();
    expect(goi("confirm")).toEqual([{ proc: "confirm", vars: { requestId: RID, totpCode: "123456" } }]);
  });

  it("mức 5 KỂ CẢ khi needsTotp=false (máy chủ khai sai) ⇒ vẫn bắt buộc", () => {
    ve({ yeuCau: yeuCau({ level: 5, needsTotp: false }) });
    expect(within(hop()).getByLabelText(S("scada.lenh.totp.nhan"))).toBeInTheDocument();
    expect(nutGui()).toBeDisabled();
  });

  it("mức 4 với phiên vừa xác thực (needsTotp=false) ⇒ có ô nhưng tuỳ chọn", () => {
    ve({ yeuCau: yeuCau({ level: 4, needsTotp: false }) });
    expect(within(hop()).getByLabelText(S("scada.lenh.totp.nhan"))).toBeInTheDocument();
    expect(within(hop()).getByText(S("scada.lenh.totp.tuyChon"))).toBeInTheDocument();
    expect(nutGui()).toBeEnabled();
  });

  it("mức 3 không cần TOTP ⇒ không có ô", () => {
    ve();
    expect(within(hop()).queryByLabelText(S("scada.lenh.totp.nhan"))).toBeNull();
  });

  it("TOTP_SAI ⇒ chữ hướng dẫn, GIỮ yêu cầu: gửi lại được, đóng ⇒ huy", async () => {
    const { onDong } = ve({ yeuCau: yeuCau({ level: 5, needsTotp: true }) });
    fireEvent.change(within(hop()).getByLabelText(S("scada.lenh.totp.nhan")), { target: { value: "111111" } });
    bamGui();
    await traLoi("confirm", "onError", loi("SCADA_TOTP_INVALID", { ma: "TOTP_SAI", level: 5 }));
    expect(within(hop()).getByText(S("scada.lenh.loi.TOTP_SAI"))).toBeInTheDocument();
    const o = within(hop()).getByLabelText(S("scada.lenh.totp.nhan"));
    expect(o).toHaveValue("");
    fireEvent.change(o, { target: { value: "222222" } });
    expect(nutGui()).toBeEnabled();
    fireEvent.click(within(hop()).getByRole("button", { name: S("scada.lenh.nut.huy") }));
    expect(goi("huy")).toEqual([{ proc: "huy", vars: { requestId: RID } }]);
    expect(onDong).toHaveBeenCalledTimes(1);
  });

  it("TOTP_CHUA_DANG_KY ⇒ chữ hướng dẫn + liên kết tới trang đăng ký 2FA", async () => {
    ve({ yeuCau: yeuCau({ level: 5, needsTotp: true }) });
    fireEvent.change(within(hop()).getByLabelText(S("scada.lenh.totp.nhan")), { target: { value: "123456" } });
    bamGui();
    await traLoi("confirm", "onError", loi("SCADA_TOTP_NOT_ENROLLED", { ma: "TOTP_CHUA_DANG_KY", level: 5 }));
    const tb = within(hop()).getByTestId("loi-lenh");
    expect(tb).toHaveTextContent("Lệnh mức 4–5 cần xác thực hai lớp; tài khoản của bạn chưa đăng ký");
    const a = within(tb).getByRole("link", { name: S("scada.lenh.loi.lienKet2FA") });
    expect(a).toHaveAttribute("href", "/profile");
  });

  it("TOTP_TAM_KHOA ⇒ 'thử lại sau N phút', KHÔNG có số lần thử", async () => {
    ve({ yeuCau: yeuCau({ level: 5, needsTotp: true }) });
    fireEvent.change(within(hop()).getByLabelText(S("scada.lenh.totp.nhan")), { target: { value: "123456" } });
    bamGui();
    await traLoi("confirm", "onError", loi("TOTP_TAM_KHOA", { ma: "TOTP_TAM_KHOA", level: 5, remainingMinutes: 4 }));
    const tb = within(hop()).getByTestId("loi-lenh");
    expect(tb).toHaveTextContent("Xác thực hai lớp đang tạm khoá do nhập sai nhiều lần — thử lại sau 4 phút");
    expect(tb.textContent ?? "").not.toMatch(/\d+\s*(lần|\/\s*\d+)/);
    expect(tb.textContent ?? "").not.toMatch(/\b5\b/);
    // TOTP_TAM_KHOA KẾT THÚC yêu cầu (máy chủ đã nhả khoá) ⇒ không gửi lại được
    expect(nutGui()).toBeDisabled();
  });
});

describe("M5 — từ chối nói lý do + cách xử lý", () => {
  it("MODE_LOCAL bo_dem_tat ⇒ 'Bộ đệm giá trị sống đang tắt — mọi máy coi như LOCAL' + gợi ý STOP ghim / E-STOP", async () => {
    ve();
    bamGui();
    await traLoi("confirm", "onError", loi("SCADA_MACHINE_NOT_REMOTE", { ma: "MODE_LOCAL", lyDo: "bo_dem_tat" }));
    const tb = within(hop()).getByTestId("loi-lenh");
    expect(tb).toHaveTextContent("Bộ đệm giá trị sống đang tắt — mọi máy coi như LOCAL");
    expect(tb).toHaveTextContent("Cần dừng máy? Dùng STOP đã ghim hoặc E-STOP cứng tại máy");
    expect(nutGui()).toBeDisabled();
  });

  it("MODE_LOCAL chua_co_mau trên máy edge ⇒ chữ R1c", async () => {
    ve({ edgeCode: "EN-02" });
    bamGui();
    await traLoi("confirm", "onError", loi("SCADA_MACHINE_NOT_REMOTE", { ma: "MODE_LOCAL", lyDo: "chua_co_mau" }));
    const tb = within(hop()).getByTestId("loi-lenh");
    expect(tb).toHaveTextContent("Máy do edge sở hữu — chưa có giá trị chế độ tới R1c");
    expect(tb).toHaveTextContent(S("scada.lenh.loi.goiYStop"));
  });

  it("EDGE_CHUA_HO_TRO ⇒ chữ tiếng Việt có mã edge", async () => {
    ve();
    bamGui();
    await traLoi("confirm", "onError", loi("SCADA_EDGE_NOT_SUPPORTED", { ma: "EDGE_CHUA_HO_TRO", edgeCode: "EN-02" }));
    expect(within(hop()).getByTestId("loi-lenh")).toHaveTextContent(
      "Máy này do edge EN-02 sở hữu — lệnh từ SCADA tới máy edge chưa được hỗ trợ (đợt R1c)",
    );
  });

  it("MAY_DA_DOI ⇒ chữ điều phối; kết thúc (đóng không gọi huy)", async () => {
    const { onDong } = ve();
    bamGui();
    await traLoi("confirm", "onError", loi("SCADA_MACHINE_REBOUND", { ma: "MAY_DA_DOI" }));
    expect(within(hop()).getByTestId("loi-lenh")).toHaveTextContent(
      "Thiết bị đã được gán sang máy khác sau khi tạo yêu cầu — hãy tạo yêu cầu mới",
    );
    fireEvent.click(within(hop()).getByRole("button", { name: S("scada.lenh.nut.dong") }));
    expect(goi("huy")).toHaveLength(0);
    expect(onDong).toHaveBeenCalledTimes(1);
  });

  it("DANG_DUOC_CHON ⇒ tên người giữ + tới khi nào", async () => {
    ve();
    bamGui();
    await traLoi(
      "confirm",
      "onError",
      loi("SCADA_TAG_SELECTED_BY_OTHER", { ma: "DANG_DUOC_CHON", boiUserId: 3, boiTen: "Tran Thi B", hetHanLuc: new Date(Date.now() + 40_000).toISOString() }),
    );
    expect(within(hop()).getByTestId("loi-lenh")).toHaveTextContent("Tran Thi B");
  });

  it("confirm ném lỗi không mã (dispatch ném) ⇒ 'không rõ máy đã nhận' — đọc lại trước khi gửi lần nữa", async () => {
    ve();
    bamGui();
    await traLoi("confirm", "onError", new Error("boom"));
    expect(within(hop()).getByTestId("loi-lenh")).toHaveTextContent("không rõ máy đã nhận hay chưa");
  });
});

describe("M5 — kết quả", () => {
  it("acked_verified ⇒ 'Đã ghi, đã đọc lại {v}', tự đóng sau đúng 3 s", async () => {
    vi.useFakeTimers(FAKE);
    const { onDong } = ve();
    bamGui();
    await traLoi("confirm", "onSuccess", { status: "acked_verified", ok: true, simulated: false, commandLogIds: [7], readBackValue: 240.5 });
    expect(within(hop()).getByTestId("ket-qua")).toHaveTextContent("Đã ghi, đã đọc lại 240,5");
    await act(async () => {
      vi.advanceTimersByTime(2_999);
    });
    expect(onDong).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(onDong).toHaveBeenCalledTimes(1);
    expect(goi("huy")).toHaveLength(0);
  });

  it("acked_unverified ⇒ hiện giá trị đọc lại + 'kiểm tra tại máy', KHÔNG tự đóng", async () => {
    vi.useFakeTimers(FAKE);
    const { onDong } = ve();
    bamGui();
    await traLoi("confirm", "onSuccess", { status: "acked_unverified", ok: true, simulated: false, commandLogIds: [7], readBackValue: 245 });
    expect(within(hop()).getByTestId("ket-qua")).toHaveTextContent("Đã ghi nhưng đọc lại ra 245,0 — kiểm tra tại máy");
    await act(async () => {
      vi.advanceTimersByTime(120_000);
    });
    expect(onDong).not.toHaveBeenCalled();
    expect(hop()).toBeInTheDocument();
  });

  it("acked_unverified không đọc được ⇒ 'không đọc lại được — kiểm tra tại máy'", async () => {
    ve();
    bamGui();
    await traLoi("confirm", "onSuccess", { status: "acked_unverified", ok: true, simulated: false, commandLogIds: [7], readBackValue: null });
    expect(within(hop()).getByTestId("ket-qua")).toHaveTextContent("Đã ghi nhưng không đọc lại được — kiểm tra tại máy");
  });

  it("simulated ⇒ 'Chế độ mô phỏng — không gửi tới máy' + lý do; không tự đóng", async () => {
    vi.useFakeTimers(FAKE);
    const { onDong } = ve({ yeuCau: yeuCau({ mode: "simulated", simulatedReasons: ["OT_CONTROL_TAT"] }) });
    bamGui();
    await traLoi("confirm", "onSuccess", { status: "simulated", ok: true, simulated: true, commandLogIds: [8] });
    const kq = within(hop()).getByTestId("ket-qua");
    expect(kq).toHaveTextContent("Chế độ mô phỏng — không gửi tới máy");
    expect(kq).toHaveTextContent(S("scada.lenh.moPhong.OT_CONTROL_TAT"));
    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    expect(onDong).not.toHaveBeenCalled();
  });

  it("rejected QUEUE_EXPIRED ⇒ 'Không gửi — lệnh chờ quá hạn; tạo yêu cầu mới' (+ mã nhỏ), không tự đóng", async () => {
    ve();
    bamGui();
    await traLoi("confirm", "onSuccess", { status: "rejected", ok: false, simulated: false, reason: "QUEUE_EXPIRED", commandLogIds: [9] });
    const kq = within(hop()).getByTestId("ket-qua");
    expect(kq).toHaveTextContent("Không gửi — lệnh chờ quá hạn; tạo yêu cầu mới");
    expect(kq).toHaveTextContent(S("scada.lenh.ketQua.ma", { ma: "QUEUE_EXPIRED" }));
  });

  it("timeout ⇒ 'Không rõ máy đã nhận hay chưa…', không tự đóng", async () => {
    vi.useFakeTimers(FAKE);
    const { onDong } = ve();
    bamGui();
    await traLoi("confirm", "onSuccess", { status: "timeout", ok: false, simulated: false, commandLogIds: [9] });
    expect(within(hop()).getByTestId("ket-qua")).toHaveTextContent(
      "Không rõ máy đã nhận hay chưa — đọc lại giá trị trước khi gửi lần nữa",
    );
    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    expect(onDong).not.toHaveBeenCalled();
  });

  it("kết quả không dùng màu cảnh báo (§4.10): không có --alarm-* trong khối kết quả / từ chối", async () => {
    ve();
    bamGui();
    await traLoi("confirm", "onSuccess", { status: "rejected", ok: false, simulated: false, reason: "SAFETY_UNKNOWN", commandLogIds: [] });
    expect(within(hop()).getByTestId("ket-qua").outerHTML).not.toMatch(/--alarm-|destructive|red-|amber-/);
  });
});

describe("M5 — đóng / huy / socket", () => {
  it("đóng (nút Huỷ) khi còn proposed ⇒ huy({requestId}) rồi onDong", () => {
    const { onDong } = ve();
    fireEvent.click(within(hop()).getByRole("button", { name: S("scada.lenh.nut.huy") }));
    expect(goi("huy")).toEqual([{ proc: "huy", vars: { requestId: RID } }]);
    expect(onDong).toHaveBeenCalledTimes(1);
  });

  it("đóng bằng Esc khi còn proposed ⇒ huy", async () => {
    ve();
    await act(async () => {
      fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    });
    expect(goi("huy")).toHaveLength(1);
  });

  it("đóng sau khi đã có kết quả ⇒ KHÔNG huy", async () => {
    const { onDong } = ve();
    bamGui();
    await traLoi("confirm", "onSuccess", { status: "timeout", ok: false, simulated: false, commandLogIds: [] });
    fireEvent.click(within(hop()).getByRole("button", { name: S("scada.lenh.nut.dong") }));
    expect(goi("huy")).toHaveLength(0);
    expect(onDong).toHaveBeenCalledTimes(1);
  });

  it("socket: vào phòng user (auth:user) và nhận scada:cmd CỦA yêu cầu này khi đang gửi; yêu cầu khác bị bỏ qua", async () => {
    ve();
    expect(sock.emitted).toContainEqual({ ev: "auth:user", arg: 9 });
    bamGui();
    await act(async () => {
      phat("scada:cmd", { requestId: "99999999-2222-4333-8444-555555555555", status: "timeout", at: new Date().toISOString() });
    });
    expect(within(hop()).queryByTestId("ket-qua")).toBeNull();
    await act(async () => {
      phat("scada:cmd", { requestId: RID, status: "acked_unverified", at: new Date().toISOString(), readBackValue: 241 });
    });
    expect(within(hop()).getByTestId("ket-qua")).toHaveTextContent("Đã ghi nhưng đọc lại ra 241,0 — kiểm tra tại máy");
  });

  it("gỡ hộp ⇒ gỡ listener scada:cmd", () => {
    ve();
    expect(sock.handlers["scada:cmd"]?.size).toBe(1);
    cleanup();
    expect(sock.handlers["scada:cmd"]?.size ?? 0).toBe(0);
  });
});

describe("M5 — ngôn ngữ", () => {
  const CHU_VIET = /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i;
  it("locale en ⇒ không còn chữ Việt (bản xem trước + từ chối MODE_LOCAL + TOTP)", async () => {
    await act(async () => {
      await i18next.changeLanguage("en");
    });
    ve({ yeuCau: yeuCau({ level: 5, needsTotp: true, mode: "simulated", simulatedReasons: ["OT_CONTROL_TAT"], warnings: ["SAFETY_KIEM_LUC_GUI", "ADAPTER_TAT"] }), lyDo: "Reduce SP per PCN-0412" });
    expect(CHU_VIET.test(hop().textContent ?? "")).toBe(false);
    fireEvent.change(within(hop()).getByLabelText((en_ as any).scada.lenh.totp.nhan), { target: { value: "123456" } });
    bamGui();
    await traLoi("confirm", "onError", loi("SCADA_MACHINE_NOT_REMOTE", { ma: "MODE_LOCAL", lyDo: "bo_dem_tat" }));
    const txt = hop().textContent ?? "";
    expect(txt).toContain((en_ as any).scada.lenh.loi.goiYStop);
    expect(CHU_VIET.test(txt)).toBe(false);
  });

  it("locale zh ⇒ kết quả acked_verified dịch sang zh", async () => {
    await act(async () => {
      await i18next.changeLanguage("zh");
    });
    ve({ lyDo: "PCN-0412" });
    bamGui();
    await traLoi("confirm", "onSuccess", { status: "acked_verified", ok: true, simulated: false, commandLogIds: [1], readBackValue: 240 });
    const kq = within(hop()).getByTestId("ket-qua").textContent ?? "";
    expect(kq).toContain(String((zh_ as any).scada.lenh.ketQua.ackedVerified).split("{{")[0]);
  });
});
