// @vitest-environment jsdom
//
// doc 80 Đợt 1 Task 9 — interlock VERSION TOKEN phía client: nút "Duyệt"/"Bật" gửi ĐÚNG
// `versionToken` của hàng đang hiển thị (server so dưới FOR UPDATE, lệch ⇒ CONFLICT), và khi
// server trả CONFLICT thì danh sách được tải lại (người duyệt thấy nội dung mới trước khi bấm lại).
// Dựng trang THẬT, chỉ mock hạ tầng nặng (khuôn OrchestrationStudio.dom.test.tsx).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("@/components/DashboardLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/_core/hooks/usePermissions", () => ({
  usePermissions: () => ({ hasPermission: () => true, isAdmin: true }),
}));
vi.mock("sonner", () => ({
  toast: { info: vi.fn(), error: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));
vi.mock("@/lib/trpcErrors", () => ({
  toastTrpcError: vi.fn(),
  mapTrpcError: () => ({ message: "x" }),
}));

interface MutationOpts {
  onSuccess?: (...a: unknown[]) => void;
  onError?: (e: unknown) => void;
}
const mutations: Record<string, { mutate: ReturnType<typeof vi.fn>; opts: MutationOpts }> = {};
const invalidated: string[] = [];
const queryData: Record<string, unknown> = {};

function makeQuery(data: unknown) {
  return {
    data,
    isLoading: false,
    isPending: false,
    isFetching: false,
    isError: false,
    error: null,
    dataUpdatedAt: 1,
    refetch: vi.fn(),
  };
}

vi.mock("@/lib/trpc", () => ({
  trpc: new Proxy(
    {},
    {
      get(_t, routerName: string) {
        if (routerName === "useUtils") {
          return () =>
            new Proxy(
              {},
              {
                get: (_a, r: string) =>
                  new Proxy({}, { get: (_b, p: string) => ({ invalidate: () => { invalidated.push(`${r}.${p}`); } }) }),
              },
            );
        }
        return new Proxy(
          {},
          {
            get(_t2, procName: string) {
              const key = `${routerName}.${procName}`;
              return {
                useQuery: () => makeQuery(queryData[key]),
                useMutation: (opts: MutationOpts = {}) => {
                  const m = (mutations[key] ??= { mutate: vi.fn(), opts });
                  m.opts = opts;
                  return { mutate: m.mutate, mutateAsync: vi.fn(), isPending: false };
                },
              };
            },
          },
        );
      },
    },
  ),
}));

import InterlockRuleManagement from "./InterlockRuleManagement";

function rule(id: number, over: Record<string, unknown>) {
  return {
    id, name: `rule-${id}`, description: null, scope: "machine", lineId: null, stationId: null, machineId: null,
    sourceType: "ng_rate", sourceKey: null, comparisonOperator: "gt", threshold: "5.000000",
    windowSize: null, consecutiveCount: null, windowSeconds: null, action: "stop_line",
    targetMachineId: 1, targetAdapterId: null, commandTag: "line_stop", commandValue: null,
    requiresHumanConfirm: true, enabled: false, approvedBy: null, approvedAt: null, cooldownSeconds: 300,
    lastFiredAt: null, createdBy: 1, createdAt: new Date("2026-09-27T00:00:00Z"),
    updatedAt: new Date("2026-09-27T00:00:00Z"), updatedBy: 1,
    ...over,
  };
}

// ORACLE: token khai tay theo fixture — không suy bằng hàm nào của trang.
const PENDING = rule(41, { versionToken: "v1:token-hang-41-dang-hien-thi" });
const APPROVED = rule(42, { approvedBy: 9, approvedAt: new Date(), versionToken: "v1:token-hang-42-da-duyet" });

beforeEach(() => {
  for (const k of Object.keys(mutations)) delete mutations[k];
  invalidated.length = 0;
  queryData["interlock.list"] = [PENDING, APPROVED];
  queryData["interlock.events"] = [];
});
afterEach(() => cleanup());

const rowOf = (name: string) => screen.getByText(name).closest("tr") as HTMLElement;

describe("InterlockRuleManagement — Task 9: approve/enable gửi token của hàng đang hiển thị", () => {
  it("Duyệt ⇒ approve.mutate({ id, expectedVersion: versionToken của CHÍNH hàng đó })", () => {
    render(<InterlockRuleManagement />);
    fireEvent.click(within(rowOf("rule-41")).getByRole("button", { name: /interlockRules\.approve|Duyệt|Approve/i }));
    expect(mutations["interlock.approve"].mutate).toHaveBeenCalledWith({ id: 41, expectedVersion: "v1:token-hang-41-dang-hien-thi" });
  });

  it("Bật ⇒ enable.mutate({ id, expectedVersion: versionToken của bản ĐÃ duyệt đang hiển thị })", () => {
    render(<InterlockRuleManagement />);
    fireEvent.click(within(rowOf("rule-42")).getByRole("button", { name: /interlockRules\.enable|Bật|Enable/i }));
    expect(mutations["interlock.enable"].mutate).toHaveBeenCalledWith({ id: 42, expectedVersion: "v1:token-hang-42-da-duyet" });
  });

  it("server trả CONFLICT (rule đã bị sửa) ⇒ tải lại danh sách; lỗi khác ⇒ không", () => {
    render(<InterlockRuleManagement />);
    mutations["interlock.approve"].opts.onError?.({ data: { code: "FORBIDDEN" } });
    expect(invalidated).not.toContain("interlock.list");
    mutations["interlock.approve"].opts.onError?.({ data: { code: "CONFLICT" } });
    expect(invalidated).toContain("interlock.list");
    invalidated.length = 0;
    mutations["interlock.enable"].opts.onError?.({ data: { code: "CONFLICT" } });
    expect(invalidated).toContain("interlock.list");
  });
});
