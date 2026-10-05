// @vitest-environment jsdom
//
// Doc 80 Đợt 1 Task 1 (PLT-02 / G-07 / X-07) — TDD cho EquipmentIntegration.tsx: trước sửa,
// `flagEnabled` mặc định LẠC QUAN `statusQ.data?.enabled ?? true` khi `equipmentIntegration.status`
// CHƯA trả lời — badge "Flag" hiện "On" giả trong lúc tải và nút "New version" không khoá.
// Dựng trang THẬT qua @testing-library/react, chỉ mock hạ tầng nặng.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { installResizeHandleHitAreaShim } from "@/components/patterns/layoutKitTestPanels";

// Doc 81 Đợt 2 Task 7 — HẠ TẦNG (không đổi khẳng định): trang nay dựng SplitListDetail (react-resizable-panels).
// Bộ nghe pointerdown toàn cục của thư viện coi mọi cú bấm jsdom (toạ độ 0,0) là trúng separator ⇒ tab không đổi.
// Dùng bản browser + shim hit-area như mọi test trang dựng layout dùng chung (layoutKitTestPanels.ts).
vi.mock("react-resizable-panels", async () => (await import("@/components/patterns/layoutKitTestPanels")).browserPanels());
beforeAll(() => {
  installResizeHandleHitAreaShim();
});

vi.mock("@/components/DashboardLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/_core/hooks/usePermissions", () => ({
  usePermissions: () => ({ hasPermission: () => true }),
}));
vi.mock("sonner", () => ({
  toast: { info: vi.fn(), error: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));
// Final wave (R-3-h) — HẠ TẦNG (không đổi khẳng định): trang đọc giấy phép route /recipes; giữ kịch bản cũ (đủ giấy phép).
vi.mock("@/hooks/useLicenseModules", () => ({
  useLicenseModules: () => ({ isLoading: false, isRouteAllowed: () => true }),
}));

interface QueryResult {
  data: unknown;
  isLoading: boolean;
  isPending: boolean;
  isFetching: boolean;
  isError: boolean;
  error: unknown;
  dataUpdatedAt: number | undefined;
  refetch: () => void;
}
function makeQuery(overrides: Partial<QueryResult> = {}): QueryResult {
  return {
    data: undefined,
    isLoading: false,
    isPending: false,
    isFetching: false,
    isError: false,
    error: null,
    dataUpdatedAt: undefined,
    refetch: vi.fn(),
    ...overrides,
  };
}
const queryOverrides: Record<string, () => QueryResult> = {};
function setQueryOverride(key: string, result: QueryResult) {
  queryOverrides[key] = () => result;
}
function chainable(): unknown {
  const fn = (..._args: unknown[]) => undefined;
  return new Proxy(fn, { get: () => chainable(), apply: () => undefined });
}
vi.mock("@/lib/trpc", () => ({
  trpc: new Proxy(
    {},
    {
      get(_t, routerName: string) {
        if (routerName === "useUtils") return () => chainable();
        return new Proxy(
          {},
          {
            get(_t2, procName: string) {
              const key = `${routerName}.${procName}`;
              return {
                useQuery: () => (queryOverrides[key] ? queryOverrides[key]() : makeQuery()),
                useMutation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
              };
            },
          },
        );
      },
    },
  ),
}));

import EquipmentIntegration from "./EquipmentIntegration";

beforeEach(() => {
  for (const k of Object.keys(queryOverrides)) delete queryOverrides[k];
});

afterEach(() => {
  cleanup();
});

// Doc 81 Đợt 3 Task 1 — tab "Recipe versions" (nút "New version") đã DỜI khỏi trang: tạo phiên bản dùng MỘT bộ với
// Recipes ("Lưu phiên bản mới", thủ tục machineRecipe.recipes.create không gắn cờ EQ_INTEG). Các khẳng định
// "nút New version khoá/bật theo cờ" được GỠ (nút không còn); phần chip/banner cờ 4 trạng thái — trọng tâm của test —
// giữ nguyên. Chip cờ tích hợp trên Recipes: RecipeManagement.integration.dom.test.tsx.

describe("EquipmentIntegration — flag status (equipmentIntegration.status) không còn `?? true`", () => {
  it("statusQ ĐANG TẢI ⇒ badge Flag KHÔNG hiện 'On'/'Off' literal, banner OFF không hiện", async () => {
    setQueryOverride("equipmentIntegration.status", makeQuery({ isLoading: true }));
    render(<EquipmentIntegration />);

    expect(screen.getByTestId("feature-status-loading")).toBeInTheDocument();
    expect(screen.queryByText(/equipment integration is disabled/i)).not.toBeInTheDocument();
    // KPI badge — trạng thái "đang kiểm tra", không phải "On"/"Off". Đợt 2 Task 7: thẻ KPI thành chip StatusChipStrip;
    // chip tự in chữ trạng thái chung ("Loading") ⇒ ĐỔI BỘ CHỌN từ chữ "Checking…" sang data-state của chip cờ.
    expect(document.querySelector('[data-chip-id="flag"]')).toHaveAttribute("data-state", "loading");
    // Fix round 1 — chữ NGƯỜI DÙNG THẤY trên chip cờ là chữ trạng thái chung "Loading" (fallback layoutKit.chip.loading).
    expect(within(document.querySelector('[data-chip-id="flag"]') as HTMLElement).getByText("Loading")).toBeInTheDocument();
    expect(screen.queryByText(/^On$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Off$/)).not.toBeInTheDocument();
  });

  it("statusQ LỖI ⇒ badge hiện 'Unknown', banner lỗi riêng biệt", async () => {
    setQueryOverride("equipmentIntegration.status", makeQuery({ isError: true }));
    render(<EquipmentIntegration />);

    // Đợt 2 Task 7 — ĐỔI BỘ CHỌN: chip cờ ở trạng thái lỗi ("chưa rõ") thay cho chữ "Unknown" của thẻ KPI cũ.
    expect(document.querySelector('[data-chip-id="flag"]')).toHaveAttribute("data-state", "error");
    // Fix round 1 — kiểm lại điều người dùng THẤY: chip in "Error" (chữ trạng thái chung), KHÔNG in "On"/"Off".
    expect(within(document.querySelector('[data-chip-id="flag"]') as HTMLElement).getByText("Error")).toBeInTheDocument();
    expect(screen.queryByText(/^On$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Off$/)).not.toBeInTheDocument();
    expect(screen.getByTestId("feature-status-error")).toBeInTheDocument();
  });

  it("statusQ xong, cờ TẮT ⇒ banner không chứa tên biến môi trường, badge 'Off'", async () => {
    setQueryOverride("equipmentIntegration.status", makeQuery({ data: { enabled: false } }));
    render(<EquipmentIntegration />);

    const banner = screen.getByTestId("feature-status-off");
    expect(banner.textContent).not.toMatch(/EQ_INTEG_ENABLED/);
    expect(screen.getByText("Off")).toBeInTheDocument();
  });

  it("statusQ xong, cờ BẬT ⇒ badge 'On', không banner", async () => {
    setQueryOverride("equipmentIntegration.status", makeQuery({ data: { enabled: true } }));
    render(<EquipmentIntegration />);

    expect(screen.getByText("On")).toBeInTheDocument();
    expect(screen.queryByTestId("feature-status-off")).not.toBeInTheDocument();
  });
});
