// @vitest-environment jsdom
// Di trú chế độ nghĩ: "nhanh" cũ chưa có khoá .v2 ⇒ về cân bằng; đã đánh dấu + chọn nhanh ⇒ giữ nhanh.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (_k: string, d: string) => d }) }));
import { docCheDoNghi, luuCheDoNghi } from "./cheDoNghi";
import { GhiChuCheDoNghi } from "@/components/aiCoding/GhiChuCheDoNghi";

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe("docCheDoNghi", () => {
  it('có "nhanh" cũ + chưa đánh dấu ⇒ can-bang, ghi đè khoá và đặt đánh dấu', () => {
    localStorage.setItem("repoWs.cheDoNghi", "nhanh");
    expect(docCheDoNghi()).toBe("can-bang");
    expect(localStorage.getItem("repoWs.cheDoNghi")).toBe("can-bang");
    expect(localStorage.getItem("repoWs.cheDoNghi.v2")).toBe("1");
  });
  it('đã đánh dấu + chọn nhanh ⇒ giữ nhanh (không di trú lần hai)', () => {
    expect(docCheDoNghi()).toBe("can-bang");
    luuCheDoNghi("nhanh");
    expect(docCheDoNghi()).toBe("nhanh");
  });
  it("localStorage ném lỗi ⇒ can-bang", () => {
    const boom = () => {
      throw new Error("x");
    };
    vi.stubGlobal("localStorage", { getItem: boom, setItem: boom, removeItem: boom });
    expect(docCheDoNghi()).toBe("can-bang");
    expect(() => luuCheDoNghi("nhanh")).not.toThrow();
    vi.unstubAllGlobals();
  });
});

describe("GhiChuCheDoNghi", () => {
  it("chỉ hiện khi nhanh", () => {
    const { rerender } = render(<GhiChuCheDoNghi cheDo="can-bang" />);
    expect(screen.queryByTestId("ghi-chu-che-do-nghi")).toBeNull();
    rerender(<GhiChuCheDoNghi cheDo="nhanh" />);
    expect(screen.getByTestId("ghi-chu-che-do-nghi")).toHaveTextContent("kém chính xác hơn");
  });
});
