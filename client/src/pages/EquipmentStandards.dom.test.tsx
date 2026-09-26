// @vitest-environment jsdom
//
// Doc 80 Đợt 1 Task 1 (PLT-02 / G-07 / X-07) — TDD cho EquipmentStandards.tsx: trước sửa,
// `flagEnabled` mặc định LẠC QUAN `statusQ.data?.enabled ?? true` khi `equipmentStandards.status`
// CHƯA trả lời — nút "Register type" không hề khoá trong lúc tải. Dựng trang THẬT qua
// @testing-library/react, chỉ mock hạ tầng nặng (DashboardLayout/usePermissions/trpc/sonner).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

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

import EquipmentStandards from "./EquipmentStandards";

beforeEach(() => {
  for (const k of Object.keys(queryOverrides)) delete queryOverrides[k];
});

afterEach(() => {
  cleanup();
});

describe("EquipmentStandards — flag status (equipmentStandards.status) không còn `?? true`", () => {
  it("statusQ ĐANG TẢI ⇒ nút 'Register type' bị khoá, KHÔNG hiện banner OFF", () => {
    setQueryOverride("equipmentStandards.status", makeQuery({ isLoading: true }));
    render(<EquipmentStandards />);

    expect(screen.getByRole("button", { name: /Register type/i })).toBeDisabled();
    expect(screen.queryByText(/equipment governance is disabled/i)).not.toBeInTheDocument();
    expect(screen.getByTestId("feature-status-loading")).toBeInTheDocument();
  });

  it("statusQ LỖI ⇒ nút vẫn khoá + banner lỗi riêng biệt", () => {
    setQueryOverride("equipmentStandards.status", makeQuery({ isError: true }));
    render(<EquipmentStandards />);

    expect(screen.getByRole("button", { name: /Register type/i })).toBeDisabled();
    expect(screen.getByTestId("feature-status-error")).toBeInTheDocument();
    expect(screen.queryByTestId("feature-status-off")).not.toBeInTheDocument();
  });

  it("statusQ xong, cờ TẮT ⇒ banner thân thiện không chứa tên biến môi trường; nút vẫn bật", () => {
    setQueryOverride("equipmentStandards.status", makeQuery({ data: { enabled: false } }));
    render(<EquipmentStandards />);

    const banner = screen.getByTestId("feature-status-off");
    expect(banner.textContent).not.toMatch(/EQ_GOVERN_ENABLED/);
    expect(screen.getByRole("button", { name: /Register type/i })).not.toBeDisabled();
  });

  it("statusQ xong, cờ BẬT ⇒ không banner nào, nút bật", () => {
    setQueryOverride("equipmentStandards.status", makeQuery({ data: { enabled: true } }));
    render(<EquipmentStandards />);

    expect(screen.queryByTestId("feature-status-off")).not.toBeInTheDocument();
    expect(screen.queryByTestId("feature-status-loading")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Register type/i })).not.toBeDisabled();
  });
});
