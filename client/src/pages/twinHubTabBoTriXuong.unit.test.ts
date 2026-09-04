/**
 * ★★★ Khối D Task 1 — tab "Bố trí xưởng" (`layout`) trong `TwinHub`.
 *
 * Hai bẫy đã đo trong brief, lưới này khoá cả hai:
 *
 * 1) `LayoutContent` (tách từ `Layout.tsx`, khuôn `FactoryFloorEditorContent`) đọc
 *    `useParams<{id?}>()`. Khi render NHƯ TAB của TwinHub (route `/digital-twin`, KHÔNG
 *    `:id`), `useParams()` không ném lỗi — nó đọc `ParamsCtx` của wouter, mà GIÁ TRỊ MẶC ĐỊNH
 *    đo được tại `node_modules/wouter/esm/index.js`:
 *      `const Params0 = {}, ParamsCtx = createContext(Params0);`
 *      `const useParams = () => useContext(ParamsCtx);`
 *    ⇒ ngoài mọi `<Route>` khớp param, `useParams()` trả `{}` (KHÔNG phải `undefined`, KHÔNG
 *    ném lỗi) ⇒ `params.id` là `undefined` — ĐÚNG hệt hành vi đã có hôm nay khi vào qua route
 *    "/layout" (không `:id`). Lưới giả lập ĐÚNG giá trị đo được (`{}`), không phải `undefined`
 *    tuỳ tiện, rồi khẳng định `LayoutContent` render ra HTML thật, không crash.
 *
 * 2) `TABS` của `TwinHub` phải có đúng một mục `value: "layout"`, `mode: "edit"`, và
 *    `Content` phải LÀ `LayoutContent` (không phải bản sao/clone).
 *
 * Mock `@/lib/trpc`, `sonner`, `@/hooks/useTwinStream`, `@/components/PermissionGate` — cùng
 * khuôn `client/src/components/ai/quanLyDuAnRepo.unit.test.ts` (mock THẲNG dependency của đơn
 * vị đang kiểm, không mock sâu xuống `usePermissions`/`useAuth`/socket — những thứ đó không
 * thuộc phạm vi Task 1).
 *
 * ĐỘT BIẾN PHẢI BẮT ĐƯỢC (đã tự tay đo — xem báo cáo Task 1): bỏ mục `layout` khỏi `TABS` ⇒
 * §2 ĐỎ đúng dòng `expect(muc).toBeDefined()`.
 */
import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// `importOriginal` — TwinHub kéo theo `@/i18n` (qua LanguageSwitcher) chạy `i18n.use(initReactI18next)`
// ở MỨC MODULE (không phải trong component) ⇒ mock trơ thiếu `initReactI18next` sẽ ném lỗi ngay
// lúc import, trước khi test kịp chạy. Giữ nguyên phần còn lại, chỉ đè `useTranslation`.
vi.mock("react-i18next", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-i18next")>();
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown) => (typeof fallback === "string" ? fallback : key),
    }),
  };
});

// Đo được ở node_modules/wouter/esm/index.js — xem chú thích đầu tệp.
vi.mock("wouter", () => ({
  useParams: () => ({}),
  useSearch: () => "",
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    workshop: { list: { useQuery: () => ({ data: undefined }) } },
    factory: { list: { useQuery: () => ({ data: undefined }) } },
    layout: {
      listByWorkshop: { useQuery: () => ({ data: undefined, refetch: () => {}, isLoading: false }) },
      getById: { useQuery: () => ({ data: undefined, refetch: () => {}, isLoading: false }) },
      create: { useMutation: () => ({ mutate: () => {}, isPending: false }) },
      update: { useMutation: () => ({ mutate: () => {}, isPending: false }) },
      delete: { useMutation: () => ({ mutateAsync: async () => {}, isPending: false }) },
    },
    machine: { list: { useQuery: () => ({ data: undefined }) } },
    dashboard: { getAllMachinesStats: { useQuery: () => ({ data: undefined }) } },
  },
}));

vi.mock("sonner", () => ({ toast: { success: () => {}, error: () => {} } }));

vi.mock("@/hooks/useTwinStream", () => ({
  useTwinStream: () => ({ stations: [] }),
}));

vi.mock("@/components/PermissionGate", () => ({
  PermissionGate: ({ children }: { children?: unknown }) => children ?? null,
  ViewOnlyBadge: () => null,
  useCanWrite: () => ({ canEdit: false }),
}));

const { LayoutContent } = await import("./Layout");
const { TABS } = await import("./TwinHub");

describe("§1 LayoutContent — render như tab TwinHub, KHÔNG có params.id", () => {
  it("★★★ useParams() trả {} (giá trị mặc định wouter đo được) ⇒ render ra HTML thật, không crash", () => {
    const html = renderToStaticMarkup(createElement(LayoutContent));
    expect(typeof html).toBe("string");
    expect(html.length).toBeGreaterThan(0);
    // Nhánh "chưa chọn xưởng" (đúng vì selectedLayout khởi tạo từ params.id === undefined ⇒ "")
    // phải render — bằng chứng params.id thiếu KHÔNG làm rơi vào nhánh treo/lỗi khác.
    expect(html).toContain("layout.selectWorkshopToViewLayouts");
  });
});

describe("§2 TwinHub TABS — mục 'layout'", () => {
  it("★★★ có đúng một mục value:'layout', mode:'edit', Content là LayoutContent", () => {
    const cacMucLayout = TABS.filter((tab) => tab.value === "layout");
    expect(cacMucLayout).toHaveLength(1);
    const [muc] = cacMucLayout;
    expect(muc.mode).toBe("edit");
    expect(muc.Content).toBe(LayoutContent);
  });
});
