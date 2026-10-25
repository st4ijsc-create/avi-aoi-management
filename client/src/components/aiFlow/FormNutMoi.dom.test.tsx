// @vitest-environment jsdom
//
// ★★★ Lô Luồng-form — 4 form CÓ KIỂU của node mới (thuần theo props): mỗi thao tác sinh đúng tham số, giá trị ngoài khoảng bị KẸP ngay ở form,
// danh sách người nhận chỉ tìm khi ≥ 2 ký tự và tối đa 20, "theo biểu thức" mở ô chữ. Kiểm hợp đồng với máy chủ: formNutMoi.hopDongMayChu.unit.test.ts.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
const nguoiNhanQuery = vi.fn();
vi.mock("@/lib/trpc", () => ({ trpc: { flow: { nguoiNhanChoLuong: { useQuery: (...a: unknown[]) => nguoiNhanQuery(...a) } } } }));

import { FormSoLieu, FormSuKien, FormTaoPhieu, FormThongBao } from "./FormNutMoi";

afterEach(() => {
  cleanup();
  nguoiNhanQuery.mockReset();
});
const tid = (c: HTMLElement, id: string) => c.querySelector(`[data-testid="${id}"]`) as HTMLElement;

describe("FormSoLieu", () => {
  it("chọn truy vấn ⇒ doi('truyVan', tên trong danh mục); giờ / giới hạn ngoài khoảng bị KẸP; để trống ⇒ bỏ tham số", () => {
    const doi = vi.fn();
    const { container } = render(<FormSoLieu p={{ truyVan: "san-luong.tong-quan" }} doi={doi} />);
    fireEvent.change(tid(container, "so-lieu-truy-van"), { target: { value: "oee.trung-binh" } });
    expect(doi).toHaveBeenLastCalledWith("truyVan", "oee.trung-binh");
    fireEvent.change(tid(container, "so-lieu-gio"), { target: { value: "9999" } });
    expect(doi).toHaveBeenLastCalledWith("gio", 168);
    fireEvent.change(tid(container, "so-lieu-gio"), { target: { value: "0" } });
    expect(doi).toHaveBeenLastCalledWith("gio", 1);
    fireEvent.change(tid(container, "so-lieu-gioi-han"), { target: { value: "500" } });
    expect(doi).toHaveBeenLastCalledWith("gioiHan", 20);
    cleanup();
    const doi2 = vi.fn();
    const r2 = render(<FormSoLieu p={{ truyVan: "oee.trung-binh", gioiHan: 5 }} doi={doi2} />);
    fireEvent.change(tid(r2.container, "so-lieu-gioi-han"), { target: { value: "" } });
    expect(doi2).toHaveBeenLastCalledWith("gioiHan", undefined);
  });

  it("truy vấn không có trong danh mục (JSON thô) ⇒ ô chọn hiện 'chọn truy vấn', không tự đổi giá trị", () => {
    const { container } = render(<FormSoLieu p={{ truyVan: "tu-bia" }} doi={vi.fn()} />);
    expect((tid(container, "so-lieu-truy-van") as HTMLSelectElement).value).toBe("");
  });
});

describe("FormThongBao", () => {
  const ketQua = [{ id: 11, ten: "An Alpha", vaiTro: "engineer" }, { id: 12, ten: "Bình Alpha", vaiTro: "supervisor" }];

  it("★ chỉ gọi máy chủ khi gõ ≥ 2 ký tự (sau 300 ms); chọn từ kết quả ⇒ doi('nguoiNhan', [..ids]); bỏ chip ⇒ doi không còn id", async () => {
    nguoiNhanQuery.mockImplementation((_in: { tim: string }, o: { enabled: boolean }) => ({ data: o.enabled ? ketQua : undefined, isLoading: false }));
    const doi = vi.fn();
    const { container, rerender } = render(<FormThongBao p={{ nguoiNhan: [] }} doi={doi} flowId="luong-a" />);
    expect(nguoiNhanQuery.mock.calls.at(-1)![1]).toMatchObject({ enabled: false });
    fireEvent.change(tid(container, "nn-tim"), { target: { value: "a" } });
    await new Promise((r) => setTimeout(r, 400));
    expect(nguoiNhanQuery.mock.calls.at(-1)![1]).toMatchObject({ enabled: false });
    fireEvent.change(tid(container, "nn-tim"), { target: { value: "an" } });
    await waitFor(() => expect(nguoiNhanQuery.mock.calls.at(-1)![1]).toMatchObject({ enabled: true }));
    expect(nguoiNhanQuery.mock.calls.at(-1)![0]).toEqual({ flowId: "luong-a", tim: "an" });
    fireEvent.click(tid(container, "nn-them-11"));
    expect(doi).toHaveBeenLastCalledWith("nguoiNhan", [11]);
    rerender(<FormThongBao p={{ nguoiNhan: [11] }} doi={doi} flowId="luong-a" />);
    expect(tid(container, "nn-da-chon-11")).toBeTruthy();
    expect((tid(container, "nn-them-11") as HTMLButtonElement).disabled).toBe(true); // đã chọn
    fireEvent.click(tid(container, "nn-bo-11"));
    expect(doi).toHaveBeenLastCalledWith("nguoiNhan", []);
  });

  it("★ tối đa 20 người: đủ 20 ⇒ nút Thêm bị vô hiệu", async () => {
    nguoiNhanQuery.mockImplementation((_in: unknown, o: { enabled: boolean }) => ({ data: o.enabled ? ketQua : undefined, isLoading: false }));
    const hai = Array.from({ length: 20 }, (_, i) => 100 + i);
    const { container } = render(<FormThongBao p={{ nguoiNhan: hai }} doi={vi.fn()} flowId="luong-a" />);
    fireEvent.change(tid(container, "nn-tim"), { target: { value: "an" } });
    await waitFor(() => expect(tid(container, "nn-them-11")).toBeTruthy());
    expect((tid(container, "nn-them-11") as HTMLButtonElement).disabled).toBe(true);
  });

  it("người nhận là BIỂU THỨC (JSON thô) ⇒ hiện ô biểu thức, có nút về chọn danh sách; loại / ưu tiên có mặc định đúng với máy chủ", () => {
    nguoiNhanQuery.mockReturnValue({ data: undefined, isLoading: false });
    const doi = vi.fn();
    const { container } = render(<FormThongBao p={{ nguoiNhan: "{{ $json.ds }}" }} doi={doi} flowId="x" />);
    expect(tid(container, "nn-bieu-thuc")).toBeTruthy();
    fireEvent.click(tid(container, "nn-ve-danh-sach"));
    expect(doi).toHaveBeenLastCalledWith("nguoiNhan", []);
    expect((tid(container, "tb-loai") as HTMLSelectElement).value).toBe("REPORT");
    expect((tid(container, "tb-uu-tien") as HTMLSelectElement).value).toBe("NORMAL");
  });
});

describe("FormSuKien", () => {
  it("★ MẶC ĐỊNH TẮT: không khai bat ⇒ ô bật bỏ chọn; bật ⇒ doi('bat', true); cửa sổ / trần bị kẹp 1440 / 30", () => {
    const doi = vi.fn();
    const { container } = render(<FormSuKien p={{ suKien: "ng.alert" }} doi={doi} />);
    expect((tid(container, "sk-bat") as HTMLInputElement).checked).toBe(false);
    fireEvent.click(tid(container, "sk-bat"));
    expect(doi).toHaveBeenLastCalledWith("bat", true);
    fireEvent.change(tid(container, "sk-cua-so"), { target: { value: "5000" } });
    expect(doi).toHaveBeenLastCalledWith("cuaSoPhut", 1440);
    fireEvent.change(tid(container, "sk-tran"), { target: { value: "99" } });
    expect(doi).toHaveBeenLastCalledWith("tranMoiGio", 30);
    fireEvent.change(tid(container, "sk-su-kien"), { target: { value: "downtime.start" } });
    expect(doi).toHaveBeenLastCalledWith("suKien", "downtime.start");
  });
});

describe("FormTaoPhieu", () => {
  it("nhóm / loại / ưu tiên: chọn ⇒ giá trị đúng kiểu (ưu tiên là SỐ); 'theo biểu thức' mở ô chữ; mặc định hiển thị khớp máy chủ", () => {
    const doi = vi.fn();
    const { container, rerender } = render(<FormTaoPhieu p={{}} doi={doi} />);
    expect((tid(container, "tp-nhom") as HTMLSelectElement).value).toBe("vat-tu-khac");
    expect((tid(container, "tp-uu-tien") as HTMLSelectElement).value).toBe("3");
    expect((tid(container, "tp-loai") as HTMLSelectElement).value).toBe("CORRECTIVE");
    fireEvent.change(tid(container, "tp-nhom"), { target: { value: "plc-phan-mem" } });
    expect(doi).toHaveBeenLastCalledWith("nhom", "plc-phan-mem");
    fireEvent.change(tid(container, "tp-uu-tien"), { target: { value: "2" } });
    expect(doi).toHaveBeenLastCalledWith("uuTien", 2);
    fireEvent.change(tid(container, "tp-nhom"), { target: { value: "__bieu-thuc__" } });
    expect(doi).toHaveBeenLastCalledWith("nhom", "{{ $json.x }}");
    rerender(<FormTaoPhieu p={{ nhom: "{{ $json.nhan }}" }} doi={doi} />);
    expect(tid(container, "tp-nhom-bt")).toBeTruthy();
  });
});
