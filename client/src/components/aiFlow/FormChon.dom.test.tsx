// @vitest-environment jsdom
//
// ★★★ Lô logic-chon — form CÓ KIỂU của `logic.chon` / `logic.gom` (thuần theo props): thêm / bỏ điều kiện (≤ 5), đổi toán tử đặt lại giá trị đích đúng kiểu, giá trị đích GIỮ KIỂU
// (số vs chuỗi "1" vs true/null), `in` nhận danh sách, ô số chỉ nhận số; cảnh báo cổng chưa nối cho canvas.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

import { FormChon, FormGom, TRAN_NHANH_CHON_FORM } from "./FormChon";
import { canhBaoCongChuaNoi } from "@/lib/flowStudio";

afterEach(cleanup);
const tid = (c: HTMLElement, id: string) => c.querySelector(`[data-testid="${id}"]`) as HTMLElement;

describe("FormChon", () => {
  it("thêm điều kiện ⇒ doi('nhanh', [..., {so:'eq', dich:''}]); đủ 5 ⇒ nút thêm vô hiệu; bỏ ⇒ danh sách ngắn lại", () => {
    const doi = vi.fn();
    const { container, rerender } = render(<FormChon p={{ giaTri: "{{ $json.x }}", nhanh: [] }} doi={doi} />);
    fireEvent.click(tid(container, "chon-them"));
    expect(doi).toHaveBeenLastCalledWith("nhanh", [{ so: "eq", dich: "" }]);
    const nam = Array.from({ length: TRAN_NHANH_CHON_FORM }, (_, i) => ({ so: "eq", dich: i }));
    rerender(<FormChon p={{ nhanh: nam }} doi={doi} />);
    expect((tid(container, "chon-them") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(tid(container, "chon-bo-1"));
    expect(doi).toHaveBeenLastCalledWith("nhanh", nam.filter((_, i) => i !== 1));
  });

  it("★ GIỮ KIỂU: eq — 42 ⇒ số; \"1\" ⇒ chuỗi '1'; true ⇒ boolean; dien ⇒ chuỗi; in — danh sách có kiểu", () => {
    const doi = vi.fn();
    const { container } = render(<FormChon p={{ nhanh: [{ so: "eq", dich: "" }, { so: "in", dich: [] }] }} doi={doi} />);
    const gan = (id: string, v: string) => fireEvent.change(tid(container, id), { target: { value: v } });
    gan("chon-dich-0", "42");
    expect(doi).toHaveBeenLastCalledWith("nhanh", [{ so: "eq", dich: 42 }, { so: "in", dich: [] }]);
    gan("chon-dich-0", '"1"');
    expect(doi).toHaveBeenLastCalledWith("nhanh", [{ so: "eq", dich: "1" }, { so: "in", dich: [] }]);
    gan("chon-dich-0", "true");
    expect(doi).toHaveBeenLastCalledWith("nhanh", [{ so: "eq", dich: true }, { so: "in", dich: [] }]);
    gan("chon-dich-0", "dien");
    expect(doi).toHaveBeenLastCalledWith("nhanh", [{ so: "eq", dich: "dien" }, { so: "in", dich: [] }]);
    gan("chon-dich-1", 'dien, co-khi, 3, "4"');
    expect(doi).toHaveBeenLastCalledWith("nhanh", [{ so: "eq", dich: "" }, { so: "in", dich: ["dien", "co-khi", 3, "4"] }]);
  });

  it("đổi toán tử: sang 'in' ⇒ danh sách rỗng; sang gt/lt… ⇒ số 0 và ô SỐ; ô số chỉ ghi số", () => {
    const doi = vi.fn();
    const { container } = render(<FormChon p={{ nhanh: [{ so: "eq", dich: "dien" }] }} doi={doi} />);
    fireEvent.change(tid(container, "chon-so-0"), { target: { value: "in" } });
    expect(doi).toHaveBeenLastCalledWith("nhanh", [{ so: "in", dich: [] }]);
    fireEvent.change(tid(container, "chon-so-0"), { target: { value: "gt" } });
    expect(doi).toHaveBeenLastCalledWith("nhanh", [{ so: "gt", dich: 0 }]);
    cleanup();
    const doi2 = vi.fn();
    const r2 = render(<FormChon p={{ nhanh: [{ so: "gt", dich: 3 }] }} doi={doi2} />);
    expect((tid(r2.container, "chon-dich-0") as HTMLInputElement).type).toBe("number");
    fireEvent.change(tid(r2.container, "chon-dich-0"), { target: { value: "7.5" } });
    expect(doi2).toHaveBeenLastCalledWith("nhanh", [{ so: "gt", dich: 7.5 }]);
  });
});

describe("FormGom", () => {
  it("tên trường ghi qua doi('truongRa')", () => {
    const doi = vi.fn();
    const { container } = render(<FormGom p={{ truongRa: "ds" }} doi={doi} />);
    fireEvent.change(tid(container, "gom-truong-ra"), { target: { value: "tatCa" } });
    expect(doi).toHaveBeenLastCalledWith("truongRa", "tatCa");
  });
});

describe("canhBaoCongChuaNoi (canvas)", () => {
  const dm = new Map([["logic.chon", { congNenNoi: ["khac"] }], ["du-lieu.dat", {}]]);
  const def = (noiKhac: boolean, tat = false) => ({
    nodes: [{ id: "c", type: "logic.chon", disabled: tat }, { id: "d", type: "du-lieu.dat" }],
    connections: [{ from: { node: "c", port: "nhanh-1" } }, ...(noiKhac ? [{ from: { node: "c", port: "khac" } }] : [])],
  });
  it("★ khac CHƯA nối ⇒ cảnh báo {nodeId:'c', cong:'khac'}; đã nối ⇒ không; node tắt ⇒ không; node không khai ⇒ không", () => {
    expect(canhBaoCongChuaNoi(def(false), dm)).toEqual([{ nodeId: "c", cong: "khac" }]);
    expect(canhBaoCongChuaNoi(def(true), dm)).toEqual([]);
    expect(canhBaoCongChuaNoi(def(false, true), dm)).toEqual([]);
    expect(canhBaoCongChuaNoi({ nodes: [{ id: "d", type: "du-lieu.dat" }], connections: [] }, dm)).toEqual([]);
  });
});
