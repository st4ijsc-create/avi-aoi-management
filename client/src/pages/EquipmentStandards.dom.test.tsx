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
// Doc 80 Đợt 1 Task 3 — ghi lại MỌI lượt useQuery (khoá thủ tục + input) để kiểm trang
// đọc KPI báo động từ đâu và có tự cứng `operatorCount` hay không.
const queryCalls: { key: string; input: unknown }[] = [];
const mutateSpies: Record<string, ReturnType<typeof vi.fn>> = {};
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
                useQuery: (input: unknown) => {
                  queryCalls.push({ key, input });
                  return queryOverrides[key] ? queryOverrides[key]() : makeQuery();
                },
                useMutation: () => {
                  mutateSpies[key] ??= vi.fn();
                  return { mutate: mutateSpies[key], mutateAsync: vi.fn(), isPending: false };
                },
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
  queryCalls.length = 0;
  for (const k of Object.keys(mutateSpies)) delete mutateSpies[k];
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

  // ĐỘT BIẾN riêng cho TỆP NÀY (Fix round 1 finding #1) — xem task-1-report.md: quay
  // `flagCanControl = canControl && !flagUnsettled` (dòng ~209) về đúng `canControl` khiến
  // CA 1 ("statusQ ĐANG TẢI") ở trên VÀ mọi ca "ĐANG TẢI"/"LỖI" trong bảng dưới ĐỎ (nút không
  // còn bị khoá) — xác nhận đã đo, ghi trong report, hoàn nguyên sau khi đỏ.
});

// Fix round 1 (finding #2) — hai nút ghi khác cũng dùng CHUNG `flagCanControl`/
// `flagControlReason` (EquipmentStandards.tsx dòng ~416/504/610) nhưng KHÔNG có test nào
// canh: "Map alarm" (tab "Alarm taxonomy") và "Add master alarm" (tab "Alarm performance").
async function clickTab(name: string) {
  const { default: userEvent } = await import("@testing-library/user-event");
  const user = userEvent.setup();
  await user.click(screen.getByRole("tab", { name }));
}

const OTHER_BUTTONS: { tabName: string; buttonName: string }[] = [
  { tabName: "Alarm taxonomy", buttonName: "Map alarm" },
  { tabName: "Alarm performance", buttonName: "Add master alarm" },
];

describe("EquipmentStandards — nút ghi khác cùng flagCanControl (Map alarm / Add master alarm)", () => {
  it.each(OTHER_BUTTONS)(
    "statusQ ĐANG TẢI ⇒ '$buttonName' (tab $tabName) bị khoá",
    async ({ tabName, buttonName }) => {
      setQueryOverride("equipmentStandards.status", makeQuery({ isLoading: true }));
      render(<EquipmentStandards />);
      await clickTab(tabName);
      expect(screen.getByRole("button", { name: buttonName })).toBeDisabled();
    },
  );

  it.each(OTHER_BUTTONS)(
    "statusQ LỖI ⇒ '$buttonName' (tab $tabName) vẫn khoá",
    async ({ tabName, buttonName }) => {
      setQueryOverride("equipmentStandards.status", makeQuery({ isError: true }));
      render(<EquipmentStandards />);
      await clickTab(tabName);
      expect(screen.getByRole("button", { name: buttonName })).toBeDisabled();
    },
  );

  it.each(OTHER_BUTTONS)(
    "statusQ xong, cờ TẮT ⇒ '$buttonName' (tab $tabName) VẪN bật",
    async ({ tabName, buttonName }) => {
      setQueryOverride("equipmentStandards.status", makeQuery({ data: { enabled: false } }));
      render(<EquipmentStandards />);
      await clickTab(tabName);
      expect(screen.getByRole("button", { name: buttonName })).not.toBeDisabled();
    },
  );

  it.each(OTHER_BUTTONS)(
    "statusQ xong, cờ BẬT ⇒ '$buttonName' (tab $tabName) bật",
    async ({ tabName, buttonName }) => {
      setQueryOverride("equipmentStandards.status", makeQuery({ data: { enabled: true } }));
      render(<EquipmentStandards />);
      await clickTab(tabName);
      expect(screen.getByRole("button", { name: buttonName })).not.toBeDisabled();
    },
  );
});

// ════════════════════════════════════════════════════════════════════════════════════════════
// Doc 80 Đợt 1 Task 3 (STD-02 / STD-04) — Phụ lục E §4 + §6.4.
//   STD-04: trang từng tự tính KPI ISA-18.2 bằng bộ tính THỨ HAI (`equipmentStandards.alarmKpis`,
//           chỉ andon) với `operatorCount: 1` CỨNG ở client ⇒ số khác /alarm-kpi + Control Tower.
//           Nay trang đọc CÙNG `alarmKpi.summary`, KHÔNG gửi operatorCount (server tự suy).
//   STD-02: nút "Shelve 8h" ghi `shelvedUntil` nhưng đường báo động chính (Andon/cảnh báo AI) không
//           đọc cột đó ⇒ người vận hành tưởng đã shelve. Nút phải KHOÁ + tooltip giải thích.
// ════════════════════════════════════════════════════════════════════════════════════════════
const SUMMARY = {
  windowMs: 168 * 3600_000,
  now: Date.now(),
  operatorCount: 3,
  totalAlarms: 5,
  rate: { count: 5, windowHours: 168, operatorCount: 3, alarmsPerHour: 0.03, alarmsPerHourPerOperator: 0.01, status: "ok" },
  flood: { maxInWindow: 2, floodBucketCount: 0, totalBuckets: 4, floodPercent: 0, isFlooding: false, windowMinutes: 10, threshold: 10 },
  standing: { count: 1, thresholdHours: 24, status: "ok", worst: [] },
  badActors: [{ actorKey: "machine:1", actorLabel: "M-01", count: 3, percent: 60 }],
  distribution: { counts: { low: 1, medium: 2, high: 2 }, percent: { low: 20, medium: 40, high: 40 }, total: 5, target: { low: 80, medium: 15, high: 5 }, highOverTarget: true },
  breaches: ["distribution"],
  sourceCounts: { andon: 4, predictive: 1 },
  occurrenceLog: { available: true, firstOccurredAt: null },
  generatedAt: new Date().toISOString(),
};

describe("EquipmentStandards — KPI báo động MỘT nguồn (STD-04)", () => {
  it("không gọi bộ tính thứ hai equipmentStandards.alarmKpis; gọi alarmKpi.summary KHÔNG kèm operatorCount", () => {
    render(<EquipmentStandards />);
    expect(queryCalls.some((c) => c.key === "equipmentStandards.alarmKpis")).toBe(false);
    const calls = queryCalls.filter((c) => c.key === "alarmKpi.summary");
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) {
      expect(c.input).toMatchObject({ windowHours: 7 * 24 });
      expect(Object.prototype.hasOwnProperty.call(c.input ?? {}, "operatorCount")).toBe(false);
    }
  });

  it("hiển thị operatorCount DO SERVER trả về (3), và bad actor theo nhãn của summary", async () => {
    setQueryOverride("alarmKpi.summary", makeQuery({ data: SUMMARY }));
    render(<EquipmentStandards />);
    await clickTab("Alarm performance");
    expect(screen.getByTestId("alarm-kpi-source").textContent).toMatch(/3/);
    expect(screen.getByText("M-01")).toBeInTheDocument();
    expect(screen.getByTestId("alarm-kpi-total").textContent).toMatch(/5/);
  });
});

describe("EquipmentStandards — Shelve chưa có hiệu lực trên đường báo động (STD-02)", () => {
  const MASTER = {
    id: 7, alarmKey: "OVERTEMP", assetType: null, priority: "high", consequence: "major",
    timeToRespond: 10, setpoint: null, deadband: null, isSuppressed: false, isShelvedNow: false,
  };

  it("nút 'Shelve 8h' bị KHOÁ kèm tooltip i18n, bấm không gọi shelveMasterAlarm", async () => {
    setQueryOverride("equipmentStandards.status", makeQuery({ data: { enabled: true } }));
    setQueryOverride("equipmentStandards.listMasterAlarms", makeQuery({ data: [MASTER] }));
    render(<EquipmentStandards />);
    await clickTab("Alarm performance");
    const btn = screen.getByRole("button", { name: /Shelve 8h/i });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("title", "Not yet effective on the alarm path");
    const { default: userEvent } = await import("@testing-library/user-event");
    await userEvent.setup().click(btn);
    expect(mutateSpies["equipmentStandards.shelveMasterAlarm"] ?? vi.fn()).not.toHaveBeenCalled();
  });
});
