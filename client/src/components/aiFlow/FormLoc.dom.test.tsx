// @vitest-environment jsdom
//
// Lô logic-cho/loc — form CÓ KIỂU (thuần theo props): giây chặn 0…86400 + mặc định 60; thông điệp lỗi; lọc thêm/bỏ điều kiện (≤ 5), đổi toán tử đặt lại giá trị đúng kiểu;
// sắp xếp chọn hướng/kiểu.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

import { FormCho, FormDungLoi, FormLoc, FormSapXep, CHO_MAC_DINH_GIAY_FORM, CHO_TOI_DA_GIAY_FORM, TRAN_DIEU_KIEN_LOC_FORM } from "./FormLoc";

afterEach(cleanup);
const tid = (c: HTMLElement, id: string) => c.querySelector(`[data-testid="${id}"]`) as HTMLElement;

describe("FormCho", () => {
  it("hiện giây hiện tại (mặc định 60); gõ số ⇒ doi('giay', số) kẹp trong 0…86400; ô rỗng ⇒ về mặc định", () => {
    const doi = vi.fn();
    const { container } = render(<FormCho p={{}} doi={doi} />);
    expect((tid(container, "cho-giay") as HTMLInputElement).value).toBe(String(CHO_MAC_DINH_GIAY_FORM));
    fireEvent.change(tid(container, "cho-giay"), { target: { value: "300" } });
    expect(doi).toHaveBeenLastCalledWith("giay", 300);
    fireEvent.change(tid(container, "cho-giay"), { target: { value: "999999" } });
    expect(doi).toHaveBeenLastCalledWith("giay", CHO_TOI_DA_GIAY_FORM);
    fireEvent.change(tid(container, "cho-giay"), { target: { value: "-5" } });
    expect(doi).toHaveBeenLastCalledWith("giay", 0);
    fireEvent.change(tid(container, "cho-giay"), { target: { value: "" } });
    expect(doi).toHaveBeenLastCalledWith("giay", CHO_MAC_DINH_GIAY_FORM);
  });
});

describe("FormDungLoi", () => {
  it("ghi thongDiep qua doi", () => {
    const doi = vi.fn();
    const { container } = render(<FormDungLoi p={{ thongDiep: "a" }} doi={doi} />);
    fireEvent.change(tid(container, "dung-loi-thong-diep"), { target: { value: "Dừng vì sao" } });
    expect(doi).toHaveBeenLastCalledWith("thongDiep", "Dừng vì sao");
  });
});

describe("FormLoc", () => {
  it("thêm điều kiện ⇒ {giaTri, so:'eq', dich:''}; đủ 5 ⇒ nút thêm vô hiệu; bỏ ⇒ ngắn lại", () => {
    const doi = vi.fn();
    const { container, rerender } = render(<FormLoc p={{ dieuKien: [] }} doi={doi} />);
    fireEvent.click(tid(container, "loc-them"));
    expect(doi).toHaveBeenLastCalledWith("dieuKien", [{ giaTri: "{{ $json.x }}", so: "eq", dich: "" }]);
    const nam = Array.from({ length: TRAN_DIEU_KIEN_LOC_FORM }, (_, i) => ({ giaTri: `{{ $json.k${i} }}`, so: "eq", dich: i }));
    rerender(<FormLoc p={{ dieuKien: nam }} doi={doi} />);
    expect((tid(container, "loc-them") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(tid(container, "loc-bo-1"));
    expect(doi).toHaveBeenLastCalledWith("dieuKien", nam.filter((_, i) => i !== 1));
  });

  it("★ GIỮ KIỂU: eq — 42 ⇒ số, \"1\" ⇒ chuỗi, true ⇒ boolean; đổi sang gt ⇒ ô SỐ giá trị 0; sang in ⇒ danh sách rỗng; sửa khoá không đổi toán tử", () => {
    const doi = vi.fn();
    const { container } = render(<FormLoc p={{ dieuKien: [{ giaTri: "{{ $json.a }}", so: "eq", dich: "" }] }} doi={doi} />);
    fireEvent.change(tid(container, "loc-dich-0"), { target: { value: "42" } });
    expect(doi).toHaveBeenLastCalledWith("dieuKien", [{ giaTri: "{{ $json.a }}", so: "eq", dich: 42 }]);
    fireEvent.change(tid(container, "loc-dich-0"), { target: { value: '"1"' } });
    expect(doi).toHaveBeenLastCalledWith("dieuKien", [{ giaTri: "{{ $json.a }}", so: "eq", dich: "1" }]);
    fireEvent.change(tid(container, "loc-dich-0"), { target: { value: "true" } });
    expect(doi).toHaveBeenLastCalledWith("dieuKien", [{ giaTri: "{{ $json.a }}", so: "eq", dich: true }]);
    fireEvent.change(tid(container, "loc-so-0"), { target: { value: "gt" } });
    expect(doi).toHaveBeenLastCalledWith("dieuKien", [{ giaTri: "{{ $json.a }}", so: "gt", dich: 0 }]);
    fireEvent.change(tid(container, "loc-so-0"), { target: { value: "in" } });
    expect(doi).toHaveBeenLastCalledWith("dieuKien", [{ giaTri: "{{ $json.a }}", so: "in", dich: [] }]);
    fireEvent.change(tid(container, "loc-gia-tri-0"), { target: { value: "{{ $json.b }}" } });
    expect(doi).toHaveBeenLastCalledWith("dieuKien", [{ giaTri: "{{ $json.b }}", so: "eq", dich: "" }]);
  });

  it("ô đích của toán tử so sánh số chỉ nhận số", () => {
    const doi = vi.fn();
    const { container } = render(<FormLoc p={{ dieuKien: [{ giaTri: "{{ $json.a }}", so: "gte", dich: 3 }] }} doi={doi} />);
    expect((tid(container, "loc-dich-0") as HTMLInputElement).type).toBe("number");
    fireEvent.change(tid(container, "loc-dich-0"), { target: { value: "7.5" } });
    expect(doi).toHaveBeenLastCalledWith("dieuKien", [{ giaTri: "{{ $json.a }}", so: "gte", dich: 7.5 }]);
  });
});

describe("FormSapXep", () => {
  it("khoá / hướng / kiểu ghi qua doi; mặc định hiện tang + so", () => {
    const doi = vi.fn();
    const { container } = render(<FormSapXep p={{ giaTri: "{{ $json.oee }}" }} doi={doi} />);
    expect((tid(container, "sap-xep-huong") as HTMLSelectElement).value).toBe("tang");
    expect((tid(container, "sap-xep-kieu") as HTMLSelectElement).value).toBe("so");
    fireEvent.change(tid(container, "sap-xep-huong"), { target: { value: "giam" } });
    expect(doi).toHaveBeenLastCalledWith("huong", "giam");
    fireEvent.change(tid(container, "sap-xep-kieu"), { target: { value: "chu" } });
    expect(doi).toHaveBeenLastCalledWith("kieu", "chu");
    fireEvent.change(tid(container, "sap-xep-gia-tri"), { target: { value: "{{ $json.ten }}" } });
    expect(doi).toHaveBeenLastCalledWith("giaTri", "{{ $json.ten }}");
  });
});
