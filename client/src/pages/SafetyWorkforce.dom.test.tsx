// @vitest-environment jsdom
//
// Doc 80 Đợt 1 Task 1 (PLT-02 / G-07 / X-07) — TDD cho SafetyWorkforce.tsx: trước sửa,
// `safetyAuditEnabled`/`workforceEnabled` mặc định LẠC QUAN `?? true` khi `safety.status`
// CHƯA trả lời — hai nút ghi ("Report proximity", "Assign") không hề khoá trong lúc tải.
// Dựng trang THẬT qua @testing-library/react, chỉ mock hạ tầng nặng (kể cả socket, vì
// getSharedSocket() mở kết nối socket.io thật nếu không mock).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("@/components/DashboardLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/_core/hooks/usePermissions", () => ({
  usePermissions: () => ({ hasPermission: () => true }),
}));
vi.mock("@/lib/socketManager", () => ({
  getSharedSocket: () => ({ on: vi.fn(), off: vi.fn(), emit: vi.fn(), connected: false }),
  releaseSharedSocket: vi.fn(),
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

import SafetyWorkforce from "./SafetyWorkforce";

beforeEach(() => {
  for (const k of Object.keys(queryOverrides)) delete queryOverrides[k];
});

afterEach(() => {
  cleanup();
});

// "Assign" lives on the "Workforce board" tab (not the default "Safety cockpit" tab).
// Radix Tabs only mounts the active TabsContent, so it must be selected first.
async function openWorkforceTab() {
  const { default: userEvent } = await import("@testing-library/user-event");
  const user = userEvent.setup();
  await user.click(screen.getByRole("tab", { name: /Workforce board/i }));
}

describe("SafetyWorkforce — hai cờ độc lập trên CÙNG safety.status, không còn `?? true`", () => {
  it("safety.status ĐANG TẢI ⇒ nút 'Report proximity' (cockpit) bị khoá, không banner OFF, có skeleton", () => {
    setQueryOverride("safety.status", makeQuery({ isLoading: true }));
    render(<SafetyWorkforce />);

    expect(screen.getByRole("button", { name: /Report proximity/i })).toBeDisabled();
    expect(screen.queryByText(/safety audit is disabled/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/workforce is disabled/i)).not.toBeInTheDocument();
    // Hai banner riêng biệt (safetyAudit + workforce) đều ở trạng thái loading.
    expect(screen.getAllByTestId("feature-status-loading").length).toBe(2);
  });

  it("safety.status ĐANG TẢI ⇒ nút 'Assign' (tab Workforce board) cũng bị khoá", async () => {
    setQueryOverride("safety.status", makeQuery({ isLoading: true }));
    render(<SafetyWorkforce />);
    await openWorkforceTab();
    expect(screen.getByRole("button", { name: /^Assign$/i })).toBeDisabled();
  });

  it("safety.status LỖI ⇒ cả hai nút vẫn khoá + banner lỗi riêng biệt (không phải banner OFF)", async () => {
    setQueryOverride("safety.status", makeQuery({ isError: true }));
    render(<SafetyWorkforce />);

    expect(screen.getByRole("button", { name: /Report proximity/i })).toBeDisabled();
    expect(screen.getAllByTestId("feature-status-error").length).toBe(2);
    expect(screen.queryByTestId("feature-status-off")).not.toBeInTheDocument();

    await openWorkforceTab();
    expect(screen.getByRole("button", { name: /^Assign$/i })).toBeDisabled();
  });

  it("safety.status xong, CẢ HAI cờ TẮT ⇒ banner không chứa tên biến môi trường; nút VẪN bật", async () => {
    setQueryOverride("safety.status", makeQuery({ data: { safetyAudit: false, workforce: false } }));
    render(<SafetyWorkforce />);

    const banners = screen.getAllByTestId("feature-status-off");
    expect(banners.length).toBe(2);
    for (const b of banners) {
      expect(b.textContent).not.toMatch(/SAFETY_AUDIT_ENABLED|WORKFORCE_ENABLED/);
    }
    expect(screen.getByRole("button", { name: /Report proximity/i })).not.toBeDisabled();
    await openWorkforceTab();
    expect(screen.getByRole("button", { name: /^Assign$/i })).not.toBeDisabled();
  });

  it("safety.status xong, CẢ HAI cờ BẬT ⇒ không banner nào, nút bật", async () => {
    setQueryOverride("safety.status", makeQuery({ data: { safetyAudit: true, workforce: true } }));
    render(<SafetyWorkforce />);

    expect(screen.queryByTestId("feature-status-off")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Report proximity/i })).not.toBeDisabled();
    await openWorkforceTab();
    expect(screen.getByRole("button", { name: /^Assign$/i })).not.toBeDisabled();
  });

  it("một cờ TẮT, cờ kia CHƯA TẢI ⇒ nút 'Report proximity' (safetyAudit=off) bật ngay dù workforce (Assign) còn khoá", async () => {
    // safetyAudit đã biết = off (không khoá vì lý do 'chưa biết'); workforce vẫn loading.
    setQueryOverride("safety.status", makeQuery({ isLoading: true }));
    const { rerender } = render(<SafetyWorkforce />);
    expect(screen.getByRole("button", { name: /Report proximity/i })).toBeDisabled();

    setQueryOverride("safety.status", makeQuery({ data: { safetyAudit: false, workforce: true } }));
    rerender(<SafetyWorkforce />);
    // Report proximity bật ngay: off đã biết, không còn "chưa biết" nữa.
    expect(screen.getByRole("button", { name: /Report proximity/i })).not.toBeDisabled();
    await openWorkforceTab();
    expect(screen.getByRole("button", { name: /^Assign$/i })).not.toBeDisabled();
  });
});
