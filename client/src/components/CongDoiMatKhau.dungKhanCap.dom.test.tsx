// @vitest-environment jsdom
//
// SCADA R1b-2b-1 Task 1 (mục 59; điều phối 2026-10-26 Q1 + điều kiện 6; ruling C6 / C11 / C16) — người vận hành BỊ BUỘC ĐỔI MẬT KHẨU vẫn tới
// được STOP từ chính trang đổi mật khẩu: khối "DỪNG MÁY khẩn cấp" (`KhoiDungKhanCap`) trong nhánh KHOÁ của `CongDoiMatKhau`, dùng lại
// `NutDungMay` / `HopDungMay`. Render THẬT với bundle vi THẬT; chỉ mock hợp đồng mạng (`@/lib/trpc`), danh tính (`useAuth`), wouter, và màn
// `ChangePassword` lười (ruling C11 — màn thật cần `user.changePassword` / `useUtils` không có trong mock).
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import * as React from "react";
import vi_ from "@/i18n/locales/vi.json";
import en_ from "@/i18n/locales/en.json";
import zh_ from "@/i18n/locales/zh.json";
import { initLayoutKitTestI18n } from "@/components/patterns/layoutKitTestI18n";

const doc = (bundle: unknown, k: string): unknown => k.split(".").reduce<unknown>((x, p) => (x as Record<string, unknown> | undefined)?.[p], bundle);
const S = (k: string, o?: Record<string, string | number>): string => {
  const v = doc(vi_, k);
  if (typeof v !== "string") throw new Error(`thiếu khoá vi: ${k}`);
  return o ? v.replace(/\{\{(\w+)\}\}/g, (_, n) => String(o[n])) : v;
};

const srv = vi.hoisted(() => ({
  user: null as Record<string, unknown> | null,
  /** trả lời của mayDungKhanCap.useQuery */
  q: { data: undefined as unknown, isLoading: false, isError: false, error: null as unknown },
  /** số lần gọi mayDungKhanCap.useQuery (mỗi lượt render) + tuỳ chọn */
  goiQuery: [] as unknown[],
  calls: [] as Array<{ proc: string; vars: unknown }>,
  opts: {} as Record<string, { onSuccess?: (r: unknown) => void; onError?: (e: unknown) => void }>,
}));

vi.mock("@/_core/hooks/useAuth", () => ({
  useAuth: () => ({ user: srv.user, loading: false, isAuthenticated: !!srv.user }),
}));
vi.mock("wouter", async (importOriginal) => {
  const real = await importOriginal<typeof import("wouter")>();
  return { ...real, useLocation: () => ["/change-password", () => undefined] };
});
vi.mock("@/pages/ChangePassword", () => ({ default: () => <div data-testid="man-doi-mat-khau" /> }));
vi.mock("@/lib/trpc", () => {
  const mut = (proc: string) => ({
    useMutation: (opts: { onSuccess?: (r: unknown) => void; onError?: (e: unknown) => void }) => {
      srv.opts[proc] = opts;
      return { mutate: (vars: unknown) => srv.calls.push({ proc, vars }), isPending: false };
    },
  });
  return {
    trpc: {
      scadaCommands: {
        dungMay: mut("dungMay"),
        mayDungKhanCap: {
          useQuery: (input: unknown, o: unknown) => {
            srv.goiQuery.push({ input, o });
            return srv.q;
          },
        },
      },
    },
  };
});

import { CongDoiMatKhau } from "./CongDoiMatKhau";
import { TRAN_MAY_DUNG_KHAN_CAP } from "@shared/dungKhanCap";
import { laLoiGiayPhep } from "./scada/KhoiDungKhanCap";

type May = { machineId: number; ten: string; chuyen: string | null; coDung: boolean | null; soAdapter: number | null; tongHop: string };
const may = (id: number, o: Partial<May> = {}): May => ({
  machineId: id,
  ten: `RF-${id} · Reflow ${id}`,
  chuyen: "Chuyền SMT 1",
  coDung: true,
  soAdapter: 1,
  tongHop: "du",
  ...o,
});
const nhieuMay = (n: number) => Array.from({ length: n }, (_, i) => may(1000 + i));

const DAU_ROUTER = "dau-bang-route";
const ve = () =>
  render(
    <CongDoiMatKhau>
      <div data-testid={DAU_ROUTER} />
    </CongDoiMatKhau>,
  );
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const goi = (proc: string) => srv.calls.filter((c) => c.proc === proc);

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
});
beforeEach(() => {
  srv.user = { id: 9, role: "operator", name: "T", mustChangePassword: true };
  srv.q = { data: { may: [may(11), may(12, { ten: "RF-12 · Reflow 12", soAdapter: 2 })], biCat: false }, isLoading: false, isError: false, error: null };
  srv.goiQuery = [];
  srv.calls = [];
  srv.opts = {};
});
afterEach(() => {
  cleanup();
});

describe("★★★ mục 59 — operator BỊ BUỘC ĐỔI MẬT KHẨU tới STOP từ trang đổi mật khẩu", () => {
  it("★★★ 2 máy ⇒ tiêu đề + mô tả + 2 nút DỪNG MÁY; bấm máy 1 ⇒ hộp; Enter ⇒ ĐÚNG MỘT dungMay {machineId máy 1, clientRequestId uuid}", async () => {
    ve();
    expect(screen.queryByTestId(DAU_ROUTER), "nhánh khoá không được render bảng route").toBeNull();
    const khoi = screen.getByTestId("khoi-dung-khan-cap");
    expect(within(khoi).getByText(S("scada.dungMay.khanCap.tieuDe"))).toBeInTheDocument();
    expect(within(khoi).getByText(S("scada.dungMay.khanCap.moTa"))).toBeInTheDocument();
    const nut = within(khoi).getAllByTestId("nut-dung-may");
    expect(nut).toHaveLength(2);
    expect(within(khoi).getByText("RF-11 · Reflow 11")).toBeInTheDocument();
    expect(within(khoi).queryByTestId("khoi-dung-khan-cap-bi-cat")).toBeNull();
    // gọi query đúng hợp đồng: không input, không thử lại
    expect(srv.goiQuery[0]).toEqual({ input: undefined, o: { retry: false } });

    fireEvent.click(nut[0]);
    const hop = screen.getByTestId("hop-dung-may");
    expect(within(hop).getByText(S("scada.dungMay.tieuDe", { may: "RF-11 · Reflow 11" }))).toBeInTheDocument();
    expect(within(hop).getByText(S("scada.dungMay.moTa", { n: 1 }))).toBeInTheDocument();
    expect(within(hop).getByTestId("nut-xac-nhan-dung")).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    expect(goi("dungMay")).toHaveLength(1);
    const v = goi("dungMay")[0].vars as Record<string, unknown>;
    expect(v.machineId).toBe(11);
    expect(String(v.clientRequestId)).toMatch(UUID);
    // màn đổi mật khẩu vẫn ở đó (khối không thay thế nó)
    expect(await screen.findByTestId("man-doi-mat-khau")).toBeInTheDocument();
  });

  it("★★ khối nằm DƯỚI băng cảnh báo và TRÊN màn đổi mật khẩu; nút dùng token DỪNG", async () => {
    ve();
    const bang = screen.getAllByRole("alert").find((el) => el.textContent?.includes(S("auth.mustChangePasswordTitle")));
    expect(bang).toBeTruthy();
    const khoi = screen.getByTestId("khoi-dung-khan-cap");
    const man = await screen.findByTestId("man-doi-mat-khau");
    expect(bang!.compareDocumentPosition(khoi) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(khoi.compareDocumentPosition(man) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(khoi).getAllByTestId("nut-dung-may")[0].getAttribute("style") ?? "").toContain("--packml-abort");
  });

  it("★★★ máy chủ trả rỗng (viewer / thiếu quyền dừng / tính năng tắt — mayDungKhanCap rỗng) ⇒ KHÔNG có khối", () => {
    srv.user = { id: 10, role: "viewer", name: "V", mustChangePassword: true };
    srv.q = { data: { may: [], biCat: false }, isLoading: false, isError: false, error: null };
    ve();
    expect(screen.queryByTestId("khoi-dung-khan-cap")).toBeNull();
    expect(screen.queryByTestId("nut-dung-may")).toBeNull();
    expect(screen.queryByTestId("khoi-dung-khan-cap-loi")).toBeNull();
  });

  it("★★ đang tải ⇒ không hiện gì", () => {
    srv.q = { data: undefined, isLoading: true, isError: false, error: null };
    ve();
    expect(screen.queryByTestId("khoi-dung-khan-cap")).toBeNull();
    expect(screen.queryByTestId("khoi-dung-khan-cap-loi")).toBeNull();
  });

  it("★★★ query LỖI (không phải giấy phép — vd quá hạn 503) ⇒ một dòng đỏ 'Không tải được danh sách máy — dùng E-STOP cứng tại máy' (token DỪNG)", () => {
    srv.q = {
      data: undefined,
      isLoading: false,
      isError: true,
      error: { message: "x", data: { code: "SERVICE_UNAVAILABLE", httpStatus: 503, appCode: "OPERATION_FAILED", appParams: { operation: "mayDungKhanCap" } } },
    };
    ve();
    const loi = screen.getByTestId("khoi-dung-khan-cap-loi");
    expect(loi).toHaveTextContent(S("scada.dungMay.khanCap.loiTai"));
    expect(loi.getAttribute("style") ?? "").toContain("--packml-abort");
    expect(screen.queryByTestId("nut-dung-may")).toBeNull();
  });

  it("★★★ review M5 — lỗi TƯỜNG GIẤY PHÉP (OT control chưa cấp phép: FORBIDDEN / FEATURE_DISABLED) ⇒ KHÔNG hiện gì (không báo động 'dùng E-STOP')", () => {
    srv.q = {
      data: undefined,
      isLoading: false,
      isError: true,
      error: { message: "x", data: { code: "FORBIDDEN", httpStatus: 403, appCode: "FEATURE_DISABLED", appParams: { feature: "moduleOtControl" } } },
    };
    ve();
    expect(screen.queryByTestId("khoi-dung-khan-cap-loi")).toBeNull();
    expect(screen.queryByTestId("khoi-dung-khan-cap")).toBeNull();
    expect(screen.queryByText(S("scada.dungMay.khanCap.loiTai"))).toBeNull();
    // vị từ thuần: chỉ FEATURE_DISABLED là giấy phép; lỗi khác / lỗi không mã ⇒ KHÔNG phải (chiều an toàn: hiện dòng E-STOP)
    expect(laLoiGiayPhep({ data: { appCode: "FEATURE_DISABLED" } })).toBe(true);
    expect(laLoiGiayPhep({ data: { appCode: "OPERATION_FAILED" } })).toBe(false);
    expect(laLoiGiayPhep({ data: { appCode: "MUST_CHANGE_PASSWORD" } })).toBe(false);
    expect(laLoiGiayPhep(new Error("mạng"))).toBe(false);
    expect(laLoiGiayPhep(null)).toBe(false);
  });

  it("★★★ fix round 1 (I1) — coDung / soAdapter null (khảo sát quá hạn) ⇒ máy VẪN hiện, cảnh báo 'không kiểm được', nút BẤM ĐƯỢC, hộp nói 'không rõ số adapter'", async () => {
    srv.q = { data: { may: [may(21, { coDung: null, soAdapter: null, tongHop: "khong_ro" })], biCat: false }, isLoading: false, isError: false, error: null };
    ve();
    const dong = screen.getByTestId("may-khan-cap-21");
    expect(within(dong).getByText(S("scada.dungMay.canhBao.khongKiemDuoc"))).toBeInTheDocument();
    const nut = within(dong).getByTestId("nut-dung-may");
    expect(nut).toBeEnabled();
    fireEvent.click(nut);
    expect(within(screen.getByTestId("hop-dung-may")).getByText(S("scada.dungMay.moTaKhongRo"))).toBeInTheDocument();
    await userEvent.keyboard("{Enter}");
    expect(goi("dungMay")).toHaveLength(1);
    expect((goi("dungMay")[0].vars as Record<string, unknown>).machineId).toBe(21);
  });

  it("★★ dungMay trả SCADA_STOP_PRECHECK_TIMEOUT ⇒ băng đỏ 'DÙNG E-STOP CỨNG' hiện (hồi quy dùng lại HopDungMay)", async () => {
    ve();
    fireEvent.click(within(screen.getByTestId("khoi-dung-khan-cap")).getAllByTestId("nut-dung-may")[0]);
    fireEvent.click(within(screen.getByTestId("hop-dung-may")).getByTestId("nut-xac-nhan-dung"));
    await act(async () => {
      srv.opts.dungMay.onError?.({ message: "x", data: { appCode: "SCADA_STOP_PRECHECK_TIMEOUT", appParams: { ma: "STOP_QUA_HAN", pha: "truoc_gui" }, httpStatus: 503 } });
    });
    expect(screen.getByTestId("bang-estop-cung")).toHaveAttribute("data-loai", "qua_han");
    expect(screen.getByTestId("bang-estop-cung")).toHaveTextContent(S("scada.dungMay.bangEstop.tieuDe"));
  });

  it("★★★ người KHÔNG cờ ⇒ bảng route render, KHÔNG gọi mayDungKhanCap, không có khối", () => {
    srv.user = { id: 9, role: "operator", name: "T", mustChangePassword: false };
    ve();
    expect(screen.getByTestId(DAU_ROUTER)).toBeInTheDocument();
    expect(srv.goiQuery).toHaveLength(0);
    expect(screen.queryByTestId("khoi-dung-khan-cap")).toBeNull();
  });

  it("★★ admin CÓ cờ (miễn trừ cố ý) ⇒ không khoá, KHÔNG gọi mayDungKhanCap", () => {
    srv.user = { id: 1, role: "admin", name: "A", mustChangePassword: true };
    ve();
    expect(screen.getByTestId(DAU_ROUTER)).toBeInTheDocument();
    expect(srv.goiQuery).toHaveLength(0);
  });
});

describe("★★★ điều phối M4 (b) — gợi ý tongHop: MỘT dòng cho mot_phan / khong_toi / khong_ro; nút DỪNG KHÔNG BAO GIỜ ẩn / khoá", () => {
  for (const [tongHop, coDong] of [
    ["du", false],
    ["mot_phan", true],
    ["khong_toi", true],
    ["khong_ro", true],
  ] as const) {
    it(`★★★ tongHop "${tongHop}" ⇒ ${coDong ? "dòng 'Có thể không tới mọi thiết bị — dùng thêm E-STOP cứng'" : "không dòng gợi ý"}; nút bật + bấm mở hộp + Enter gửi`, async () => {
      srv.q = {
        data: { may: [may(31, { tongHop, ...(tongHop === "khong_ro" ? { coDung: null, soAdapter: null } : {}) })], biCat: false },
        isLoading: false,
        isError: false,
        error: null,
      };
      ve();
      const dong = screen.getByTestId("may-khan-cap-31");
      expect(dong).toHaveAttribute("data-tong-hop", tongHop);
      const goiY = within(dong).queryByTestId("khan-cap-goi-y-31");
      if (coDong) {
        expect(goiY).toHaveTextContent(S("scada.dungMay.khanCap.khongToiMoi"));
        expect(goiY!.getAttribute("style") ?? "").toContain("--packml-abort");
      } else {
        expect(goiY).toBeNull();
      }
      const nut = within(dong).getByTestId("nut-dung-may");
      expect(nut).toBeVisible();
      expect(nut).toBeEnabled();
      expect(nut.closest("fieldset[disabled]")).toBeNull();
      fireEvent.click(nut);
      expect(screen.getByTestId("hop-dung-may")).toBeInTheDocument();
      await userEvent.keyboard("{Enter}");
      expect(goi("dungMay")).toHaveLength(1);
      expect((goi("dungMay")[0].vars as Record<string, unknown>).machineId).toBe(31);
    });
  }
});

describe("★★★ điều kiện 6 / ruling C6 — danh sách bị CẮT", () => {
  it(`★★★ máy chủ trả ${TRAN_MAY_DUNG_KHAN_CAP + 1} hàng + biCat ⇒ ${TRAN_MAY_DUNG_KHAN_CAP} nút + dòng 'danh sách có thể chưa đủ — dùng E-STOP cứng'`, () => {
    expect(TRAN_MAY_DUNG_KHAN_CAP).toBe(200);
    srv.q = { data: { may: nhieuMay(TRAN_MAY_DUNG_KHAN_CAP + 1), biCat: true }, isLoading: false, isError: false, error: null };
    ve();
    const khoi = screen.getByTestId("khoi-dung-khan-cap");
    expect(within(khoi).getAllByTestId("nut-dung-may")).toHaveLength(TRAN_MAY_DUNG_KHAN_CAP);
    const cat = within(khoi).getByTestId("khoi-dung-khan-cap-bi-cat");
    expect(cat).toHaveTextContent(S("scada.dungMay.khanCap.biCat"));
    expect(cat.getAttribute("style") ?? "").toContain("--packml-abort");
  });

  it(`★★ đúng ${TRAN_MAY_DUNG_KHAN_CAP} hàng, biCat false ⇒ ${TRAN_MAY_DUNG_KHAN_CAP} nút, KHÔNG có dòng cắt`, () => {
    srv.q = { data: { may: nhieuMay(TRAN_MAY_DUNG_KHAN_CAP), biCat: false }, isLoading: false, isError: false, error: null };
    ve();
    const khoi = screen.getByTestId("khoi-dung-khan-cap");
    expect(within(khoi).getAllByTestId("nut-dung-may")).toHaveLength(TRAN_MAY_DUNG_KHAN_CAP);
    expect(within(khoi).queryByTestId("khoi-dung-khan-cap-bi-cat")).toBeNull();
  });

  it("★★ i18n — năm khoá khanCap có ở vi / en / zh, en và zh không còn chữ Việt", () => {
    const CHU_VIET = /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i;
    for (const k of ["tieuDe", "moTa", "loiTai", "biCat", "khongToiMoi"]) {
      for (const [ten, b] of [["vi", vi_], ["en", en_], ["zh", zh_]] as const) {
        const v = doc(b, `scada.dungMay.khanCap.${k}`);
        expect(typeof v === "string" && v.length > 0, `${ten}: thiếu scada.dungMay.khanCap.${k}`).toBe(true);
        if (ten !== "vi") expect(CHU_VIET.test(v as string), `${ten}.${k} còn chữ Việt`).toBe(false);
      }
    }
  });
});
