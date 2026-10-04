// @vitest-environment jsdom
//
// Doc 81 Đợt 2 Task 3 — PageHeaderCompact: tiêu đề + slot chips + slot hành động trên MỘT hàng,
// KHÔNG có breadcrumb (breadcrumb duy nhất ở top bar của shell — Task 2), cao ≤48 px.
// jsdom không dựng layout nên chiều cao được khoá qua style tính toán (max-height 48px, không xuống
// dòng, phần chip cắt tràn); số px thật do thiết bị đo Task 1 chấm trên trình duyệt.
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { initLayoutKitTestI18n } from "./layoutKitTestI18n";
import { PageHeaderCompact } from "./PageHeaderCompact";

beforeAll(async () => {
  await initLayoutKitTestI18n();
});
afterEach(() => cleanup());

describe("PageHeaderCompact", () => {
  it("h1 + chips + actions cùng một hàng, mang data-layout-header", () => {
    render(
      <PageHeaderCompact
        title="Thay đổi kỹ thuật"
        icon={<svg data-testid="ic" />}
        chips={<span data-testid="chip">Beta</span>}
        actions={<button type="button">Tạo ECN</button>}
      />,
    );
    const h1 = screen.getByRole("heading", { level: 1, name: "Thay đổi kỹ thuật" });
    const header = h1.closest("[data-layout-header]") as HTMLElement;
    expect(header).not.toBeNull();
    expect(header).toContainElement(screen.getByTestId("chip"));
    expect(header).toContainElement(screen.getByRole("button", { name: "Tạo ECN" }));
    // Một hàng: chính header là hàng flex KHÔNG xuống dòng, chip và action là con trực hệ của hàng.
    const row = header;
    // (jsdom không có CSS Tailwind: getComputedStyle trả giá trị khởi tạo "nowrap" bất kể lớp — nên
    //  khoá trên lớp: đúng `flex-nowrap`, không có `flex-wrap`.)
    expect(row.className.split(/\s+/)).toContain("flex-nowrap");
    expect(row.className.split(/\s+/)).not.toContain("flex-wrap");
    expect(screen.getByTestId("chip").closest("[data-header-chips]")?.parentElement).toBe(row);
    expect(screen.getByRole("button", { name: "Tạo ECN" }).closest("[data-header-actions]")?.parentElement).toBe(row);
  });

  it("cao tối đa 48 px (style max-height) và tối thiểu 40 px", () => {
    render(<PageHeaderCompact title="T" />);
    const header = screen.getByRole("heading", { level: 1 }).closest("[data-layout-header]") as HTMLElement;
    expect(header.style.maxHeight).toBe("48px");
    expect(header.style.minHeight).toBe("40px");
  });

  it("KHÔNG BAO GIỜ render breadcrumb (không có prop, không có nav breadcrumb)", () => {
    const { container } = render(<PageHeaderCompact title="T" chips={<span>x</span>} />);
    expect(container.querySelector("nav[aria-label='breadcrumb'], [data-slot='breadcrumb'], [data-slot='breadcrumb-list']")).toBeNull();
    expect(screen.queryByRole("navigation")).toBeNull();
  });

  it("vùng chip cắt tràn (overflow hidden) thay vì đẩy header xuống dòng thứ hai", () => {
    render(<PageHeaderCompact title="T" chips={<span data-testid="c">x</span>} />);
    const chips = screen.getByTestId("c").closest("[data-header-chips]") as HTMLElement;
    expect(chips.className).toMatch(/overflow-hidden/);
    expect(chips.className).toMatch(/flex-nowrap/);
    expect(chips.className).toMatch(/min-w-0/);
  });

  it("không có chips/actions thì không để lại vùng rỗng", () => {
    const { container } = render(<PageHeaderCompact title="T" />);
    expect(container.querySelector("[data-header-chips]")).toBeNull();
    expect(container.querySelector("[data-header-actions]")).toBeNull();
  });
});
