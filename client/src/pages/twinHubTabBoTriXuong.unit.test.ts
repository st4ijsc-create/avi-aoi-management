/**
 * ★★★ Khối D Task 1 — `LayoutContent` render KHÔNG có `params.id`.
 * (Tên tệp giữ nguyên vì lịch sử; §2 về `TwinHub.TABS` đã bỏ ở Đợt 61 — xem cuối tệp.)
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
 * 2) [ĐÃ BỎ Ở ĐỢT 61] `TABS` của `TwinHub` — `TwinHub.tsx` đã bị xoá (0 route, 0 import sống).
 *
 * Mock `@/lib/trpc`, `sonner`, `@/hooks/useTwinStream`, `@/components/PermissionGate` — cùng
 * khuôn `client/src/components/ai/quanLyDuAnRepo.unit.test.ts` (mock THẲNG dependency của đơn
 * vị đang kiểm, không mock sâu xuống `usePermissions`/`useAuth`/socket — những thứ đó không
 * thuộc phạm vi Task 1).
 *
 * ĐỘT BIẾN PHẢI BẮT ĐƯỢC (§1): đổi `useParams()` giả về `undefined` thay vì `{}` ⇒ `LayoutContent`
 * ném lỗi và §1 ĐỎ.
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

/* ★★★ ĐỢT 61 (QĐ-31) — §2 ĐÃ BỎ CÙNG `TwinHub.tsx`.
 * §2 cũ đọc `TABS` của `TwinHub` để khoá mục `layout`. `TwinHub` là vỏ Tabs 140
 * dòng đã mất route từ Đợt 21 (`/digital-twin` nay là `<Redirect>`), đo được
 * **0 tệp sản phẩm import** ⇒ Đợt 61 xoá nó. Không còn `TABS` để kiểm, và cái
 * mà §2 bảo vệ (`/layout` không `:id` phải tới được màn soạn bố trí) nay do
 * `<Route path="/layout"><Redirect to="/twin-studio" /></Route>` (App.tsx) và
 * lưới redirect `dinhTuyenTwinCu` giữ.
 * §1 GIỮ NGUYÊN: `LayoutContent` vẫn sống (route `/layout/:id`) và cái bẫy nó
 * khoá — `useParams()` trả `{}` ngoài route có `:id` — vẫn còn nguyên.
 */
