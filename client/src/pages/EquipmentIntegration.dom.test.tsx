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

// "recipes" is not the default tab; the recipes tab (holding "New version") must be
// selected first. Radix Tabs mounts inactive TabsContent only on activation.
async function openRecipesTab() {
  const { default: userEvent } = await import("@testing-library/user-event");
  const user = userEvent.setup();
  await user.click(screen.getByRole("tab", { name: /Recipe versions/i }));
}

describe("EquipmentIntegration — flag status (equipmentIntegration.status) không còn `?? true`", () => {
  it("statusQ ĐANG TẢI ⇒ badge Flag KHÔNG hiện 'On'/'Off' literal, banner OFF không hiện, nút 'New version' bị khoá", async () => {
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

    await openRecipesTab();
    expect(screen.getByRole("button", { name: /New version/i })).toBeDisabled();
  });

  it("statusQ LỖI ⇒ badge hiện 'Unknown', banner lỗi riêng biệt, nút vẫn khoá", async () => {
    setQueryOverride("equipmentIntegration.status", makeQuery({ isError: true }));
    render(<EquipmentIntegration />);

    // Đợt 2 Task 7 — ĐỔI BỘ CHỌN: chip cờ ở trạng thái lỗi ("chưa rõ") thay cho chữ "Unknown" của thẻ KPI cũ.
    expect(document.querySelector('[data-chip-id="flag"]')).toHaveAttribute("data-state", "error");
    // Fix round 1 — kiểm lại điều người dùng THẤY: chip in "Error" (chữ trạng thái chung), KHÔNG in "On"/"Off".
    expect(within(document.querySelector('[data-chip-id="flag"]') as HTMLElement).getByText("Error")).toBeInTheDocument();
    expect(screen.queryByText(/^On$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Off$/)).not.toBeInTheDocument();
    expect(screen.getByTestId("feature-status-error")).toBeInTheDocument();
    await openRecipesTab();
    expect(screen.getByRole("button", { name: /New version/i })).toBeDisabled();
  });

  it("statusQ xong, cờ TẮT ⇒ banner không chứa tên biến môi trường, badge 'Off', nút VẪN bật", async () => {
    setQueryOverride("equipmentIntegration.status", makeQuery({ data: { enabled: false } }));
    render(<EquipmentIntegration />);

    const banner = screen.getByTestId("feature-status-off");
    expect(banner.textContent).not.toMatch(/EQ_INTEG_ENABLED/);
    expect(screen.getByText("Off")).toBeInTheDocument();
    await openRecipesTab();
    expect(screen.getByRole("button", { name: /New version/i })).not.toBeDisabled();
  });

  it("statusQ xong, cờ BẬT ⇒ badge 'On', không banner, nút bật", async () => {
    setQueryOverride("equipmentIntegration.status", makeQuery({ data: { enabled: true } }));
    render(<EquipmentIntegration />);

    expect(screen.getByText("On")).toBeInTheDocument();
    expect(screen.queryByTestId("feature-status-off")).not.toBeInTheDocument();
    await openRecipesTab();
    expect(screen.getByRole("button", { name: /New version/i })).not.toBeDisabled();
  });
});
