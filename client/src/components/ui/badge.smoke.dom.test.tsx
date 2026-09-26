// @vitest-environment jsdom
//
// BG-129 (Lô 9 Mục 1) — smoke test hạ tầng render-test: render một component shadcn NHỎ THẬT
// (`Badge`, không mock gì — 0 hook, 0 context, 0 trpc) qua `@testing-library/react`, assert DOM
// thật (text content, thuộc tính, class biến thể). Đây KHÔNG phải test hành vi nghiệp vụ — mục
// đích DUY NHẤT là chứng minh hạ tầng (jsdom + @testing-library/react + include glob mới
// `client/src/**/*.dom.test.tsx`) THẬT SỰ chạy được, trước khi Mục 2 dựa vào nó cho món park
// onError (`componentLimitsDialog.dom.test.tsx`).
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
// jest-dom matchers (toBeInTheDocument, ...) — import per-file (không đụng `vitest.setup.ts`
// TOÀN CỤC, vốn chạy cho MỌI test kể cả server node-env không cần matcher DOM nào).
import "@testing-library/jest-dom/vitest";
import { Badge } from "./badge";

afterEach(() => {
  cleanup();
});

describe("hạ tầng render-test (BG-129) — smoke test qua Badge", () => {
  it("render ra DOM thật: text, thẻ span, data-slot", () => {
    render(<Badge>Đã lưu</Badge>);
    const el = screen.getByText("Đã lưu");
    expect(el).toBeInTheDocument();
    expect(el.tagName).toBe("SPAN");
    expect(el.getAttribute("data-slot")).toBe("badge");
  });

  it("variant đổi class thật (không phải giả lập) — destructive mang bg-destructive", () => {
    render(<Badge variant="destructive">Lỗi</Badge>);
    const el = screen.getByText("Lỗi");
    expect(el.className).toContain("bg-destructive");
    expect(el.className).not.toContain("bg-primary");
  });

  it("props DOM tuỳ ý (vd aria-invalid) truyền thẳng xuống phần tử thật", () => {
    render(<Badge aria-invalid="true">Cảnh báo</Badge>);
    expect(screen.getByText("Cảnh báo").getAttribute("aria-invalid")).toBe("true");
  });
});
