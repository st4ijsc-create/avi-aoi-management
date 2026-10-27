// @vitest-environment jsdom
//
// Đợt 10.4 (T3) — form CÓ KIỂU của node `ai.kiem-dinh-ngoai`: ô model CHỈ liệt kê model ngoài máy chủ khai dùng được ở Luồng; không "Tự động"; cảnh báo khi chưa chọn / model hết hiệu lực.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { NodeInstance } from "@shared/flow/model";

const h = vi.hoisted(() => ({ data: undefined as unknown }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => (o && "max" in o ? `${k}:${String(o.max)}` : k),
  }),
}));
vi.mock("sonner", () => ({ toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/trpc", () => ({ trpc: { aiChonModel: { danhMuc: { useQuery: () => ({ data: h.data }) } } } }));

import { FormKiemDinhNgoai } from "./FormKiemDinhNgoai";
import NodeConfigPanel from "./NodeConfigPanel";

const M = (ma: string, loai: string, extra: Record<string, unknown> = {}) => ({ ma, loai, nhan: ma, moTa: "", trangThai: "san-sang", ...extra });
const DM = [
  M("auto", "auto"),
  M("vai-tro:chat", "vai-tro"),
  M("ho-so:p1", "ho-so"),
  M("ngoai:openai_compat:gpt-x", "ngoai", { duocDungO: ["luong", "kiem-dinh"] }),
  M("ngoai:anthropic:claude-x", "ngoai", { duocDungO: ["luong", "kiem-dinh"] }),
  M("ngoai:openai_compat:chi-nut", "ngoai", { duocDungO: ["kiem-dinh"] }),
  M("ngoai:gemini:khong-truong", "ngoai"),
  M("vai-tro:la", "vai-tro", { duocDungO: ["luong"] }), // loại KHÁC ngoai mang duocDungO vẫn không được vào ô này
  M("ngoai:openai_compat:tat", "ngoai", { duocDungO: ["luong"], trangThai: "tat" }),
];
beforeEach(() => {
  h.data = DM;
});
afterEach(cleanup);

const render1 = (p: Record<string, unknown> = {}, doi = vi.fn()) => {
  render(<FormKiemDinhNgoai p={p} doi={doi} />);
  return doi;
};
const optsModel = () => Array.from(screen.getByTestId("kdn-model").querySelectorAll("option")).map((o) => o.getAttribute("value"));

describe("FormKiemDinhNgoai", () => {
  it("ô model CHỈ liệt kê ngoai có duocDungO ∋ 'luong' (không auto, không vai trò, không hồ sơ, không mục thiếu trường); mục tắt bị vô hiệu", () => {
    render1({ chonModel: "" });
    expect(optsModel()).toEqual(["", "ngoai:openai_compat:gpt-x", "ngoai:anthropic:claude-x", "ngoai:openai_compat:tat"]);
    const tat = Array.from(screen.getByTestId("kdn-model").querySelectorAll("option")).find((o) => o.getAttribute("value") === "ngoai:openai_compat:tat");
    expect(tat).toBeDisabled();
  });
  it("chọn model ⇒ doi('chonModel', mã); chọn lại rỗng ⇒ doi('chonModel','')", () => {
    const doi = render1({ chonModel: "" });
    fireEvent.change(screen.getByTestId("kdn-model"), { target: { value: "ngoai:anthropic:claude-x" } });
    expect(doi).toHaveBeenLastCalledWith("chonModel", "ngoai:anthropic:claude-x");
    cleanup();
    const doi2 = render1({ chonModel: "ngoai:anthropic:claude-x" });
    fireEvent.change(screen.getByTestId("kdn-model"), { target: { value: "" } });
    expect(doi2).toHaveBeenLastCalledWith("chonModel", "");
  });
  it("chưa chọn ⇒ cảnh báo 'node sẽ không chạy'; đã chọn mã hợp lệ ⇒ không cảnh báo", () => {
    render1({ chonModel: "" });
    expect(screen.getByTestId("kdn-chua-chon")).toBeInTheDocument();
    cleanup();
    render1({ chonModel: "ngoai:openai_compat:gpt-x" });
    expect(screen.queryByTestId("kdn-chua-chon")).toBeNull();
    expect(screen.queryByTestId("kdn-model-het")).toBeNull();
  });
  it("model đã lưu mà danh mục không còn (nhà máy khác / tắt) ⇒ GIỮ giá trị trong ô + cảnh báo 'hết dùng được' (không âm thầm xoá)", () => {
    render1({ chonModel: "ngoai:openai_compat:cu" });
    expect((screen.getByTestId("kdn-model") as HTMLSelectElement).value).toBe("ngoai:openai_compat:cu");
    expect(screen.getByTestId("kdn-model-het")).toBeInTheDocument();
  });
  it("máy chủ chưa khai model ngoài nào cho Luồng (hoặc danh mục trống) ⇒ thông báo nhờ quản trị; ô vẫn chỉ có lựa chọn rỗng", () => {
    h.data = DM.filter((m) => m.loai !== "ngoai");
    render1({ chonModel: "" });
    expect(screen.getByTestId("kdn-khong-co-model")).toBeInTheDocument();
    expect(optsModel()).toEqual([""]);
    cleanup();
    h.data = undefined;
    render1({ chonModel: "" });
    expect(screen.getByTestId("kdn-khong-co-model")).toBeInTheDocument();
  });
  it("máy chủ chưa khai duocDungO (cũ) ⇒ KHÔNG hiện mục ngoai nào (đóng mặc định)", () => {
    h.data = [M("auto", "auto"), M("ngoai:openai_compat:gpt-x", "ngoai")];
    render1({ chonModel: "" });
    expect(optsModel()).toEqual([""]);
  });
  it("ghi cauHoi / traLoi / tieuChi qua doi; ghi chú bắt buộc luôn hiện (kèm trần item)", () => {
    const doi = render1({ chonModel: "ngoai:openai_compat:gpt-x", cauHoi: "q", traLoi: "a", tieuChi: "t" });
    expect(screen.getByTestId("kdn-ghi-chu").textContent).toContain("flowStudio.form.kiemDinhNgoai.ghiChu:20");
    fireEvent.change(screen.getByTestId("kdn-tra-loi"), { target: { value: "{{ $json.x }}" } });
    expect(doi).toHaveBeenLastCalledWith("traLoi", "{{ $json.x }}");
    fireEvent.change(screen.getByTestId("kdn-cau-hoi"), { target: { value: "hỏi" } });
    expect(doi).toHaveBeenLastCalledWith("cauHoi", "hỏi");
    fireEvent.change(screen.getByTestId("kdn-tieu-chi"), { target: { value: "an toàn" } });
    expect(doi).toHaveBeenLastCalledWith("tieuChi", "an toàn");
  });
  it("truongRa: sai định dạng ⇒ lỗi hiện; đúng ⇒ không; xoá hết ⇒ doi(undefined) (máy chủ dùng mặc định, không lưu chuỗi rỗng — server từ chối '')", () => {
    const doi = render1({ chonModel: "", truongRa: "1abc" });
    expect(screen.getByTestId("kdn-truong-ra-sai")).toBeInTheDocument();
    fireEvent.change(screen.getByTestId("kdn-truong-ra"), { target: { value: "" } });
    expect(doi).toHaveBeenLastCalledWith("truongRa", undefined);
    cleanup();
    render1({ chonModel: "", truongRa: "kq_1" });
    expect(screen.queryByTestId("kdn-truong-ra-sai")).toBeNull();
  });
});

describe("NodeConfigPanel — node ai.kiem-dinh-ngoai dùng form có kiểu", () => {
  const nut = (p: Record<string, unknown>): NodeInstance => ({ id: "k", type: "ai.kiem-dinh-ngoai", typeVersion: 1, name: "k", position: [0, 0], parameters: p }) as NodeInstance;
  const web = { flowId: "f", coToken: false, dangBat: false, onXoay: vi.fn(), dangXoay: false, tokenMoi: null };
  it("hiện form riêng (không phải JSON thô) và chọn model ghi đúng vào tham số", () => {
    const onDoi = vi.fn();
    render(<NodeConfigPanel node={nut({ chonModel: "", truongRa: "kiemDinh" })} kb={undefined} onDoi={onDoi} onXoa={vi.fn()} biMat={[]} webhook={web} flowId="f" />);
    expect(screen.getByTestId("form-kiem-dinh-ngoai")).toBeInTheDocument();
    fireEvent.change(screen.getByTestId("kdn-model"), { target: { value: "ngoai:openai_compat:gpt-x" } });
    expect(onDoi).toHaveBeenLastCalledWith(expect.objectContaining({ parameters: { chonModel: "ngoai:openai_compat:gpt-x", truongRa: "kiemDinh" } }));
  });
  it("KHÔNG có ô OChonModel generic (node này không có 'Tự động'/model cục bộ)", () => {
    render(<NodeConfigPanel node={nut({ chonModel: "" })} kb={undefined} onDoi={vi.fn()} onXoa={vi.fn()} biMat={[]} webhook={web} flowId="f" />);
    expect(screen.queryByTestId("chon-model-nut")).toBeNull();
  });
});
