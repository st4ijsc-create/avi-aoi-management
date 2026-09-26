// @vitest-environment jsdom
//
// Doc 80 Đợt 1 Task 1 (PLT-02 / G-07 / X-07) — TDD cho FleetOrchestration.tsx: trước sửa,
// `flagEnabled`/`resourceFlagEnabled` mặc định LẠC QUAN `statusQ.data?.enabled ?? true` khi
// `fleet.status`/`fleet.resourceStatus` CHƯA trả lời — trong lúc tải, trang hiện NHƯ THỂ cờ
// đang BẬT (banner ẩn, nút ghi không khoá) dù cờ thật có thể đang TẮT. Bài test dựng
// FleetOrchestration THẬT (không mock chính nó) qua @testing-library/react, chỉ mock hạ tầng
// nặng (DashboardLayout/usePermissions/trpc/sonner) để cô lập đúng logic honesty đang sửa.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

// ── Mock hạ tầng shell — không phải thứ bài test này canh ────────────────────────────
vi.mock("@/components/DashboardLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/_core/hooks/usePermissions", () => ({
  usePermissions: () => ({ hasPermission: () => true }),
}));
vi.mock("sonner", () => ({
  toast: { info: vi.fn(), error: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));

// ── Proxy tRPC auto-mock — mọi `trpc.<router>.<proc>.useQuery/useMutation` đều trả một
// kết quả mặc định VÔ HẠI trừ khi bài test đăng ký override qua khoá "router.proc". ─────
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
  return new Proxy(fn, {
    get: () => chainable(),
    apply: () => undefined,
  });
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

import FleetOrchestration from "./FleetOrchestration";

const ONE_ZONE = [
  { id: 1, name: "Zone A", code: "Z-A", zoneType: "buffer", occupancy: 0, maxConcurrentRobots: 5, factoryId: 1 },
];

beforeEach(() => {
  for (const k of Object.keys(queryOverrides)) delete queryOverrides[k];
  // Zone đủ để render nút "Reserve" (nút ghi G1 đang canh) mà không cần đổi tab.
  setQueryOverride("fleet.listZones", makeQuery({ data: ONE_ZONE }));
});

afterEach(() => {
  cleanup();
});

describe("FleetOrchestration — G1 flag status (fleet.status) không còn `?? true`", () => {
  it("statusQ ĐANG TẢI ⇒ nút Reserve (G1) bị khoá, KHÔNG hiện banner OFF", () => {
    setQueryOverride("fleet.status", makeQuery({ isLoading: true }));
    render(<FleetOrchestration />);

    const reserveBtn = screen.getByRole("button", { name: /Reserve$/ });
    expect(reserveBtn).toBeDisabled();
    // Banner OFF (fallback text đặt ở FleetOrchestration.tsx) không được hiện trong lúc tải.
    expect(screen.queryByText(/fleet orchestration is disabled/i)).not.toBeInTheDocument();
    // Skeleton hạ tầng chung (FeatureStatusGate) PHẢI hiện thay cho một quyết định.
    expect(screen.getByTestId("feature-status-loading")).toBeInTheDocument();
  });

  it("statusQ LỖI ⇒ nút Reserve vẫn khoá + banner lỗi riêng (không phải banner OFF, không phải im lặng như 'on')", () => {
    setQueryOverride("fleet.status", makeQuery({ isError: true }));
    render(<FleetOrchestration />);

    const reserveBtn = screen.getByRole("button", { name: /Reserve$/ });
    expect(reserveBtn).toBeDisabled();
    expect(screen.getByTestId("feature-status-error")).toBeInTheDocument();
    expect(screen.queryByTestId("feature-status-off")).not.toBeInTheDocument();
  });

  it("statusQ xong, cờ TẮT ⇒ banner thân thiện hiện, KHÔNG chứa tên biến môi trường; nút Reserve VẪN bật (server tự chặn/ghi honest)", () => {
    setQueryOverride("fleet.status", makeQuery({ data: { enabled: false } }));
    render(<FleetOrchestration />);

    const banner = screen.getByTestId("feature-status-off");
    expect(banner.textContent).not.toMatch(/FLEET_ORCH_ENABLED/);
    expect(banner).toHaveTextContent(/fleet orchestration is disabled/i);
    const reserveBtn = screen.getByRole("button", { name: /Reserve$/ });
    expect(reserveBtn).not.toBeDisabled();
  });

  it("statusQ xong, cờ BẬT ⇒ không banner nào, nút Reserve bật", () => {
    setQueryOverride("fleet.status", makeQuery({ data: { enabled: true } }));
    render(<FleetOrchestration />);

    expect(screen.queryByTestId("feature-status-off")).not.toBeInTheDocument();
    expect(screen.queryByTestId("feature-status-loading")).not.toBeInTheDocument();
    expect(screen.queryByTestId("feature-status-error")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Reserve$/ })).not.toBeDisabled();
  });

  // ĐỘT BIẾN (ghi lại bằng tay, xem task-1-report.md): quay `flagStatus` trong
  // FleetOrchestration.tsx về `statusQ.data?.enabled ?? true` khiến CA 1 ("statusQ ĐANG TẢI")
  // ĐỎ (Reserve không còn bị khoá, banner OFF cũng không hiện đúng lúc) — xác nhận test khoá
  // đúng dòng đã vá. Đã revert sau khi xác nhận đỏ.
});

// Fix round 1 (finding #2) — 5 nút ghi G2 (Operations/Resources/Charging) bị brief nêu
// "đã khoá" nhưng KHÔNG có test nào canh. Cả năm đều nhận `canControl={g2CanControl}` /
// `controlReason={g2ControlReason}` từ component cha (xem FleetOrchestration.tsx dòng
// ~910-946) — bảng dưới lặp qua cả năm, đổi tab tương ứng rồi assert disabled/enabled.
const ONE_RESOURCE = [
  {
    id: 1,
    code: "R-A",
    name: "Resource A",
    type: "jig",
    status: "available",
    currentOwnerDeviceId: null,
    availability: { activeCount: 0, queuedCount: 0 },
  },
];

async function clickTab(name: string) {
  const { default: userEvent } = await import("@testing-library/user-event");
  const user = userEvent.setup();
  await user.click(screen.getByRole("tab", { name }));
}

const G2_BUTTONS: { tabName: string; buttonName: string }[] = [
  { tabName: "Operations", buttonName: "New operation" },
  { tabName: "Resources", buttonName: "New resource" },
  { tabName: "Resources", buttonName: "Reserve" },
  { tabName: "Charging", buttonName: "New charger" },
  { tabName: "Charging", buttonName: "Sweep now" },
];

describe("FleetOrchestration — G2 (fleet.resourceStatus) khoá 5 nút ghi Operations/Resources/Charging", () => {
  beforeEach(() => {
    // Một resource để nút "Reserve" (theo từng resource, không phải nút đầu trang) render ra.
    setQueryOverride("fleet.listResources", makeQuery({ data: ONE_RESOURCE }));
  });

  it.each(G2_BUTTONS)(
    "resourceStatus ĐANG TẢI ⇒ '$buttonName' (tab $tabName) bị khoá",
    async ({ tabName, buttonName }) => {
      setQueryOverride("fleet.resourceStatus", makeQuery({ isLoading: true }));
      render(<FleetOrchestration />);
      await clickTab(tabName);
      expect(screen.getByRole("button", { name: buttonName })).toBeDisabled();
    },
  );

  it.each(G2_BUTTONS)(
    "resourceStatus LỖI ⇒ '$buttonName' (tab $tabName) vẫn khoá",
    async ({ tabName, buttonName }) => {
      setQueryOverride("fleet.resourceStatus", makeQuery({ isError: true }));
      render(<FleetOrchestration />);
      await clickTab(tabName);
      expect(screen.getByRole("button", { name: buttonName })).toBeDisabled();
    },
  );

  it.each(G2_BUTTONS)(
    "resourceStatus xong, cờ TẮT ⇒ '$buttonName' (tab $tabName) VẪN bật (đã biết, server tự chặn/ghi honest)",
    async ({ tabName, buttonName }) => {
      setQueryOverride("fleet.resourceStatus", makeQuery({ data: { enabled: false } }));
      render(<FleetOrchestration />);
      await clickTab(tabName);
      expect(screen.getByRole("button", { name: buttonName })).not.toBeDisabled();
    },
  );

  it.each(G2_BUTTONS)(
    "resourceStatus xong, cờ BẬT ⇒ '$buttonName' (tab $tabName) bật",
    async ({ tabName, buttonName }) => {
      setQueryOverride("fleet.resourceStatus", makeQuery({ data: { enabled: true } }));
      render(<FleetOrchestration />);
      await clickTab(tabName);
      expect(screen.getByRole("button", { name: buttonName })).not.toBeDisabled();
    },
  );

  // ĐỘT BIẾN riêng cho g2CanControl (khác biến với flagStatus/G1 đã đột biến ở trên) — xem
  // task-1-report.md "Fix round 1": quay `g2CanControl = canControl && !resourceFlagUnsettled`
  // về `canControl` khiến TOÀN BỘ 5 ca "ĐANG TẢI" ở trên ĐỎ (không còn khoá) — xác nhận rồi
  // hoàn nguyên.
});
