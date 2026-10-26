// @vitest-environment jsdom
//
// Đợt 10.2 — ô chọn model dùng chung: nhóm + trạng thái + vô hiệu mục tắt + mã hết hiệu lực ⇒ auto + toast MỘT lần + lưu dính.
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const h = vi.hoisted(() => ({
  data: undefined as unknown,
  toasts: [] as string[],
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, def?: unknown, o?: Record<string, unknown>) => {
      const p = (typeof def === "object" && def ? def : o) as Record<string, unknown> | undefined;
      const mau = typeof def === "string" ? def : typeof p?.defaultValue === "string" ? p.defaultValue : k;
      return p ? mau.replace(/\{\{(\w+)\}\}/g, (_m, n) => String(p[n] ?? "")) : mau;
    },
  }),
}));
vi.mock("sonner", () => ({ toast: { info: (m: string) => h.toasts.push(m), success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/trpc", () => ({ trpc: { aiChonModel: { danhMuc: { useQuery: () => ({ data: h.data }) } } } }));

import ChonModel from "./ChonModel";

const DM = [
  { ma: "auto", loai: "auto", nhan: "Tự động", moTa: "", trangThai: "san-sang" },
  { ma: "vai-tro:code.software", loai: "vai-tro", nhan: "Lập trình", moTa: "", trangThai: "san-sang" },
  { ma: "vai-tro:embed", loai: "vai-tro", nhan: "Nhúng", moTa: "", trangThai: "san-sang" },
  { ma: "vai-tro:vision", loai: "vai-tro", nhan: "Thị giác", moTa: "", trangThai: "can-doi-khe", uocTinhDoiKheGiay: 9 },
  { ma: "ho-so:p1", loai: "ho-so", nhan: "Hồ sơ 1", moTa: "", trangThai: "tat" },
];

function Boc({ dau = "auto", beMat = "chat" as const }: { dau?: string; beMat?: "chat" | "luong" }) {
  const [v, setV] = useState(dau);
  return (
    <>
      <ChonModel beMat={beMat} giaTri={v} onDoi={setV} />
      <span data-testid="gia-tri">{v}</span>
    </>
  );
}

beforeEach(() => {
  h.data = DM;
  h.toasts.length = 0;
  localStorage.clear();
});
afterEach(cleanup);

describe("ChonModel", () => {
  it("hiện Tự động + Vai trò (ẩn embed/vision) + Hồ sơ; mục tắt bị vô hiệu", () => {
    render(<Boc />);
    const opts = Array.from(screen.getByTestId("chon-model-chat").querySelectorAll("option"));
    const ma = opts.map((o) => o.getAttribute("value"));
    expect(ma).toEqual(["auto", "vai-tro:code.software", "ho-so:p1"]);
    expect(opts.find((o) => o.value === "ho-so:p1")).toBeDisabled();
    expect(opts.find((o) => o.value === "ho-so:p1")!.textContent).toContain("tắt");
  });

  it("chọn ⇒ gọi onDoi và lưu dính theo bề mặt", () => {
    render(<Boc />);
    fireEvent.change(screen.getByTestId("chon-model-chat"), { target: { value: "vai-tro:code.software" } });
    expect(screen.getByTestId("gia-tri").textContent).toBe("vai-tro:code.software");
    expect(localStorage.getItem("aiChon.chat")).toBe("vai-tro:code.software");
  });

  it("mã đã lưu không còn trong danh mục ⇒ về auto + toast đúng MỘT lần", () => {
    localStorage.setItem("aiChon.chat", "vai-tro:cu");
    render(<Boc dau="vai-tro:cu" />);
    expect(screen.getByTestId("gia-tri").textContent).toBe("auto");
    expect(localStorage.getItem("aiChon.chat")).toBeNull();
    expect(h.toasts).toHaveLength(1);
  });

  it("danh mục chưa tải ⇒ KHÔNG đổi lựa chọn, KHÔNG toast; chỉ có Tự động", () => {
    h.data = undefined;
    render(<Boc dau="vai-tro:code.software" />);
    expect(screen.getByTestId("gia-tri").textContent).toBe("vai-tro:code.software");
    expect(h.toasts).toHaveLength(0);
  });

  it("bề mặt luồng không ghi localStorage khi nho=false", () => {
    function B() {
      const [v, setV] = useState("auto");
      return <ChonModel beMat="luong" giaTri={v} onDoi={setV} nho={false} testId="x" />;
    }
    render(<B />);
    fireEvent.change(screen.getByTestId("x"), { target: { value: "vai-tro:code.software" } });
    expect(localStorage.getItem("aiChon.luong")).toBeNull();
  });
});
