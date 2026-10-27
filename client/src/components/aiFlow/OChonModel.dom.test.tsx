// @vitest-environment jsdom
//
// Đợt 10.2 bước 2 — ô chọn model ở node Luồng AI: tương thích ngược (vaiTro cũ), ghi đúng tham số, luồng cũ có chonModel là biểu thức.
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { NodeInstance } from "@shared/flow/model";

const DM = [
  { ma: "auto", loai: "auto", nhan: "Tự động", moTa: "", trangThai: "san-sang" },
  { ma: "vai-tro:chat", loai: "vai-tro", nhan: "Chat", moTa: "", trangThai: "san-sang" },
  { ma: "vai-tro:summarize", loai: "vai-tro", nhan: "Tóm tắt", moTa: "", trangThai: "san-sang" },
  { ma: "ho-so:p1", loai: "ho-so", nhan: "Hồ sơ 1", moTa: "", trangThai: "san-sang" },
  { ma: "ngoai:openai_compat:gpt-x", loai: "ngoai", nhan: "Ngoài", moTa: "", trangThai: "san-sang" },
];
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, def?: unknown) => (def && typeof def === "object" && "bt" in (def as object) ? `${k}:${(def as { bt: string }).bt}` : typeof def === "string" ? def : k),
  }),
}));
vi.mock("sonner", () => ({ toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/trpc", () => ({ trpc: { aiChonModel: { danhMuc: { useQuery: () => ({ data: DM }) } } } }));

import OChonModel, { apChonVaoNut, giaTriChonCuaNut } from "./OChonModel";
import NodeConfigPanel from "./NodeConfigPanel";

afterEach(cleanup);

describe("giaTriChonCuaNut / apChonVaoNut (thuần)", () => {
  it("luồng cũ chỉ vaiTro ⇒ vai-tro:<vaiTro>; không gì ⇒ auto; chonModel cố định thắng vaiTro", () => {
    expect(giaTriChonCuaNut({ vaiTro: "summarize" })).toEqual({ ma: "vai-tro:summarize", laBieuThuc: false });
    expect(giaTriChonCuaNut({})).toEqual({ ma: "auto", laBieuThuc: false });
    expect(giaTriChonCuaNut({ vaiTro: "chat", chonModel: "ho-so:p1" })).toEqual({ ma: "ho-so:p1", laBieuThuc: false });
  });
  it("chonModel là biểu thức ⇒ laBieuThuc", () => {
    expect(giaTriChonCuaNut({ chonModel: "{{ $json.m }}" })).toEqual({ ma: "{{ $json.m }}", laBieuThuc: true });
  });
  it("chọn vai trò ⇒ vaiTro + xoá chonModel; hồ sơ ⇒ chonModel (giữ vaiTro); auto ⇒ xoá cả hai; giữ tham số khác", () => {
    expect(apChonVaoNut({ chonModel: "ho-so:p1", loiNhac: "x" }, "vai-tro:chat")).toEqual({ vaiTro: "chat", loiNhac: "x" });
    expect(apChonVaoNut({ vaiTro: "chat", loiNhac: "x" }, "ho-so:p1")).toEqual({ vaiTro: "chat", chonModel: "ho-so:p1", loiNhac: "x" });
    expect(apChonVaoNut({ vaiTro: "chat", chonModel: "ho-so:p1", loiNhac: "x" }, "auto")).toEqual({ loiNhac: "x" });
  });
});

describe("OChonModel", () => {
  it("hiện đúng vai trò của luồng cũ; luồng không đổi ghi localStorage; bề mặt luồng giấu model ngoài", () => {
    render(<OChonModel p={{ vaiTro: "summarize" }} onDoiThamSo={vi.fn()} />);
    const sel = screen.getByTestId("chon-model-nut") as HTMLSelectElement;
    expect(sel.value).toBe("vai-tro:summarize");
    expect(Array.from(sel.options).some((o) => o.value.startsWith("ngoai:"))).toBe(false);
  });
  it("chọn hồ sơ ⇒ onDoiThamSo nhận chonModel cố định, không ghi localStorage", () => {
    localStorage.clear();
    const cb = vi.fn();
    render(<OChonModel p={{ vaiTro: "chat" }} onDoiThamSo={cb} />);
    fireEvent.change(screen.getByTestId("chon-model-nut"), { target: { value: "ho-so:p1" } });
    expect(cb).toHaveBeenLastCalledWith({ vaiTro: "chat", chonModel: "ho-so:p1" });
    expect(localStorage.length).toBe(0);
  });
  it("vaiTro tuỳ biến không có trong danh mục ⇒ GIỮ nguyên (không âm thầm về auto)", () => {
    const cb = vi.fn();
    render(<OChonModel p={{ vaiTro: "vai-rieng" }} onDoiThamSo={cb} />);
    expect((screen.getByTestId("chon-model-nut") as HTMLSelectElement).value).toBe("vai-tro:vai-rieng");
    expect(cb).not.toHaveBeenCalled();
  });
  it("chonModel biểu thức ⇒ cảnh báo rõ; chọn model khác thay thế nó", () => {
    function B() {
      const [p, setP] = useState<Record<string, unknown>>({ chonModel: "{{ $json.m }}" });
      return (
        <>
          <OChonModel p={p} onDoiThamSo={setP} />
          <span data-testid="p">{JSON.stringify(p)}</span>
        </>
      );
    }
    render(<B />);
    expect(screen.getByTestId("chon-model-bieu-thuc").textContent).toContain("{{ $json.m }}");
    fireEvent.change(screen.getByTestId("chon-model-nut"), { target: { value: "vai-tro:chat" } });
    expect(screen.getByTestId("p").textContent).toBe('{"vaiTro":"chat"}');
    expect(screen.queryByTestId("chon-model-bieu-thuc")).toBeNull();
  });
});

const nut = (type: string, p: Record<string, unknown>): NodeInstance => ({ id: "n1", type, typeVersion: 1, name: "n", position: [0, 0], parameters: p }) as NodeInstance;
const web = { flowId: "f", coToken: false, dangBat: false, onXoay: vi.fn(), dangXoay: false, tokenMoi: null };
const kb = undefined;

describe("NodeConfigPanel — ô model ở 4 node ai.* + ai.agent/ai.sinh-ma", () => {
  it.each(["ai.llm", "ai.trich-xuat", "ai.phan-loai", "ai.tom-tat", "ai.agent", "ai.sinh-ma"])("%s có ô chọn model và ghi vào tham số node", (type) => {
    const onDoi = vi.fn();
    render(<NodeConfigPanel node={nut(type, { vaiTro: "chat", loiNhac: "x" })} kb={kb} onDoi={onDoi} onXoa={vi.fn()} biMat={[]} webhook={web} flowId="f" />);
    fireEvent.change(screen.getByTestId("chon-model-nut"), { target: { value: "ho-so:p1" } });
    expect(onDoi).toHaveBeenLastCalledWith(expect.objectContaining({ parameters: { vaiTro: "chat", loiNhac: "x", chonModel: "ho-so:p1" } }));
  });
  it("node không phải ai.* không có ô model", () => {
    render(<NodeConfigPanel node={nut("logic.neu", {})} kb={kb} onDoi={vi.fn()} onXoa={vi.fn()} biMat={[]} webhook={web} flowId="f" />);
    expect(screen.queryByTestId("chon-model-nut")).toBeNull();
  });
});
