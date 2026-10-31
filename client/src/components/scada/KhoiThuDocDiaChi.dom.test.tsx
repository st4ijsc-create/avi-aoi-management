// @vitest-environment jsdom
//
// R1b-2b-2b B-T9 (mục 5) — Lab "thử đọc một địa chỉ" ở ngăn tag M10 (scadaDiag.thuDocDiaChi, C4). CHỈ ĐỌC, lý do bắt buộc.
// Component THẬT + bundle i18n vi/en/zh THẬT + trpcErrors THẬT (câu lỗi OPERATION_FAILED dịch theo operation + reason); chỉ mock hợp đồng mạng.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import i18next from "i18next";
import vi_ from "@/i18n/locales/vi.json";
import en_ from "@/i18n/locales/en.json";
import zh_ from "@/i18n/locales/zh.json";
import { initLayoutKitTestI18n } from "@/components/patterns/layoutKitTestI18n";

const srv = vi.hoisted(() => ({
  calls: [] as Array<{ proc: string; vars: unknown }>,
  opts: undefined as { onSuccess?: (r: unknown) => void; onError?: (e: unknown) => void } | undefined,
  pending: false,
}));
vi.mock("@/lib/trpc", () => ({
  trpc: {
    scadaDiag: {
      thuDocDiaChi: {
        useMutation: (o: typeof srv.opts) => {
          srv.opts = o;
          return { mutate: (vars: unknown) => srv.calls.push({ proc: "thuDocDiaChi", vars }), isPending: srv.pending };
        },
      },
    },
  },
}));

import { KhoiThuDocDiaChi } from "./KhoiThuDocDiaChi";

const V = vi_ as unknown as {
  scada: { lab: { thuDoc: Record<string, string> } };
  errors: { reason: Record<string, string> };
};

beforeAll(async () => {
  await initLayoutKitTestI18n();
  i18next.addResourceBundle("vi", "translation", vi_, true, true);
  i18next.addResourceBundle("en", "translation", en_, true, true);
  i18next.addResourceBundle("zh", "translation", zh_, true, true);
  await i18next.changeLanguage("vi");
});
beforeEach(() => {
  srv.calls = [];
  srv.opts = undefined;
  srv.pending = false;
});
afterEach(async () => {
  cleanup();
  await i18next.changeLanguage("vi");
});

const khoi = () => screen.getByTestId("khoi-thu-doc");
const oDiaChi = () => within(khoi()).getByLabelText(V.scada.lab.thuDoc.diaChi);
const oKieu = () => within(khoi()).getByLabelText(V.scada.lab.thuDoc.kieu) as HTMLSelectElement;
const nutDoc = () => within(khoi()).getByRole("button", { name: V.scada.lab.thuDoc.nutDoc });
const nhapLyDo = (v: string) => fireEvent.change(khoi().querySelector("textarea")!, { target: { value: v } });
const loiMau = (reason: string, code: string) => ({
  message: "raw server text",
  data: { code, appCode: "OPERATION_FAILED", appParams: { operation: "scadaLabRead", reason } },
});

describe("KhoiThuDocDiaChi", () => {
  it("★ lý do 4 ký tự ⇒ nút Đọc khoá; thiếu địa chỉ ⇒ khoá; đủ ⇒ mở", () => {
    render(<KhoiThuDocDiaChi adapterId={7} />);
    expect(nutDoc()).toBeDisabled();
    fireEvent.change(oDiaChi(), { target: { value: "40001" } });
    nhapLyDo("abcd");
    expect(nutDoc()).toBeDisabled();
    nhapLyDo("abcde");
    expect(nutDoc()).toBeEnabled();
    fireEvent.change(oDiaChi(), { target: { value: "   " } });
    expect(nutDoc()).toBeDisabled();
  });

  it("★ gửi ⇒ đúng MỘT lượt thuDocDiaChi {adapterId, address, dataType, lyDo} (đã cắt khoảng trắng)", () => {
    render(<KhoiThuDocDiaChi adapterId={7} />);
    fireEvent.change(oDiaChi(), { target: { value: " 40001 " } });
    fireEvent.change(oKieu(), { target: { value: "int" } });
    nhapLyDo("  kiểm tra tạm  ");
    fireEvent.click(nutDoc());
    expect(srv.calls).toEqual([{ proc: "thuDocDiaChi", vars: { adapterId: 7, address: "40001", dataType: "int", lyDo: "kiểm tra tạm" } }]);
  });

  it("kiểu chọn được đúng 4 giá trị", () => {
    render(<KhoiThuDocDiaChi adapterId={7} />);
    expect(Array.from(oKieu().options).map((o) => o.value)).toEqual(["bool", "int", "float", "string"]);
  });

  it("★ kết quả good ⇒ hiện chất lượng, giá trị thô, giá trị giải mã, mã trạng thái, ms", () => {
    render(<KhoiThuDocDiaChi adapterId={7} />);
    act(() => srv.opts!.onSuccess!({ quality: "good", raw: 1234, giaTri: 12.34, statusCode: "0x00000000", reason: null, ms: 87 }));
    const kq = screen.getByTestId("thu-doc-ket-qua");
    expect(kq).toHaveTextContent(vi_.scada.diag.chatLuong.tot);
    expect(kq).toHaveTextContent("1234");
    expect(kq).toHaveTextContent("12.34");
    expect(kq).toHaveTextContent("0x00000000");
    expect(kq).toHaveTextContent("87 ms");
    expect(kq.textContent).not.toMatch(/null|undefined/);
  });

  it("kết quả bad + reason 'timeout' ⇒ câu dịch; reason văn bản driver ⇒ hiện nguyên; giá trị null ⇒ '—'", () => {
    render(<KhoiThuDocDiaChi adapterId={7} />);
    act(() => srv.opts!.onSuccess!({ quality: "bad", raw: null, giaTri: null, statusCode: null, reason: "timeout", ms: 3000 }));
    const kq = screen.getByTestId("thu-doc-ket-qua");
    expect(kq).toHaveTextContent(V.scada.lab.thuDoc.reasonTimeout);
    expect(kq.textContent).not.toMatch(/null|undefined/);
    act(() => srv.opts!.onSuccess!({ quality: "uncertain", raw: null, giaTri: null, statusCode: null, reason: "Illegal data address", ms: 12 }));
    expect(screen.getByTestId("thu-doc-ket-qua")).toHaveTextContent("Illegal data address");
  });

  it.each([
    ["adapterOwnedByEdge", "PRECONDITION_FAILED"],
    ["rateLimited", "TOO_MANY_REQUESTS"],
    ["protocolNotSupported", "BAD_REQUEST"],
    ["adapterNotRunning", "PRECONDITION_FAILED"],
    ["scadaLabDangBan", "CONFLICT"],
  ])("★ lỗi OPERATION_FAILED reason=%s ⇒ câu dịch (vi), không mã trần", (reason, code) => {
    render(<KhoiThuDocDiaChi adapterId={7} />);
    act(() => srv.opts!.onError!(loiMau(reason, code)));
    const loi = screen.getByRole("alert");
    expect(loi.textContent).toContain(V.errors.reason[reason]);
    expect(loi.textContent).not.toMatch(/raw server text|OPERATION_FAILED/);
  });

  it("kết quả cũ biến mất khi có lỗi mới; lỗi cũ biến mất khi có kết quả mới", () => {
    render(<KhoiThuDocDiaChi adapterId={7} />);
    act(() => srv.opts!.onSuccess!({ quality: "good", raw: 1, giaTri: 1, statusCode: null, reason: null, ms: 5 }));
    act(() => srv.opts!.onError!(loiMau("rateLimited", "TOO_MANY_REQUESTS")));
    expect(screen.queryByTestId("thu-doc-ket-qua")).toBeNull();
    act(() => srv.opts!.onSuccess!({ quality: "good", raw: 2, giaTri: 2, statusCode: null, reason: null, ms: 5 }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByTestId("thu-doc-ket-qua")).toBeInTheDocument();
  });

  it("★ CHỈ ĐỌC: câu cố định hiện; không có nút / ô nào là Ghi / Write / Sửa; đúng một nút", () => {
    render(<KhoiThuDocDiaChi adapterId={7} />);
    expect(khoi()).toHaveTextContent(V.scada.lab.thuDoc.chiDoc);
    const dieuKhien = [
      ...within(khoi()).queryAllByRole("button"),
      ...within(khoi()).queryAllByRole("textbox"),
      ...within(khoi()).queryAllByRole("combobox"),
    ];
    for (const el of dieuKhien) {
      const ten = `${el.getAttribute("aria-label") ?? ""} ${el.textContent ?? ""} ${(el as HTMLInputElement).name ?? ""}`;
      expect(ten).not.toMatch(/\b(ghi|write|sửa|set)\b/i);
    }
    expect(within(khoi()).getAllByRole("button")).toHaveLength(1);
  });

  it("đang gửi ⇒ nút khoá (không gửi đôi)", () => {
    srv.pending = true;
    render(<KhoiThuDocDiaChi adapterId={7} />);
    fireEvent.change(oDiaChi(), { target: { value: "40001" } });
    nhapLyDo("abcde");
    expect(nutDoc()).toBeDisabled();
  });

  it("en / zh: nhãn và câu lỗi đổi ngôn ngữ, không còn chữ Việt", async () => {
    for (const lng of ["en", "zh"]) {
      await i18next.changeLanguage(lng);
      const { unmount } = render(<KhoiThuDocDiaChi adapterId={7} />);
      act(() => srv.opts!.onError!(loiMau("rateLimited", "TOO_MANY_REQUESTS")));
      const chu = (khoi().textContent ?? "") + (screen.getByRole("alert").textContent ?? "");
      expect(chu).not.toMatch(/[ạảãàáâấầẩẫậăắằẳẵặẹẻẽèéêếềểễệịỉĩìíọỏõòóôốồổỗộơớờởỡợụủũùúưứừửữựỳỵỷỹýđ]/i);
      unmount();
    }
  });
});
