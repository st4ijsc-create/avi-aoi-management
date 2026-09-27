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

  // ĐỘT BIẾN riêng cho TỆP NÀY (Fix round 1 finding #1) — xem task-1-report.md: quay
  // `safetyCanControl`/`workforceCanControl` (dòng ~246-249) về đúng `canControl` khiến các
  // ca "ĐANG TẢI"/"LỖI" ở trên (và "Start collaboration" dưới) ĐỎ — xác nhận, hoàn nguyên.
});

// Fix round 1 (finding #2) — nút ghi "Start collaboration" (tab "Collaboration") dùng CHUNG
// `workforceCanControl`/`workforceControlReason` với "Assign" nhưng KHÔNG có test riêng.
async function openCollaborationTab() {
  const { default: userEvent } = await import("@testing-library/user-event");
  const user = userEvent.setup();
  await user.click(screen.getByRole("tab", { name: /^Collaboration$/i }));
}

describe("SafetyWorkforce — 'Start collaboration' (tab Collaboration) cùng workforceCanControl", () => {
  it("safety.status ĐANG TẢI ⇒ 'Start collaboration' bị khoá", async () => {
    setQueryOverride("safety.status", makeQuery({ isLoading: true }));
    render(<SafetyWorkforce />);
    await openCollaborationTab();
    expect(screen.getByRole("button", { name: "Start collaboration" })).toBeDisabled();
  });

  it("safety.status LỖI ⇒ 'Start collaboration' vẫn khoá", async () => {
    setQueryOverride("safety.status", makeQuery({ isError: true }));
    render(<SafetyWorkforce />);
    await openCollaborationTab();
    expect(screen.getByRole("button", { name: "Start collaboration" })).toBeDisabled();
  });

  it("safety.status xong, workforce TẮT ⇒ 'Start collaboration' VẪN bật", async () => {
    setQueryOverride("safety.status", makeQuery({ data: { safetyAudit: true, workforce: false } }));
    render(<SafetyWorkforce />);
    await openCollaborationTab();
    expect(screen.getByRole("button", { name: "Start collaboration" })).not.toBeDisabled();
  });

  it("safety.status xong, workforce BẬT ⇒ 'Start collaboration' bật", async () => {
    setQueryOverride("safety.status", makeQuery({ data: { safetyAudit: true, workforce: true } }));
    render(<SafetyWorkforce />);
    await openCollaborationTab();
    expect(screen.getByRole("button", { name: "Start collaboration" })).not.toBeDisabled();
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════
// doc 80 Đợt 1 Task 4 — SAF-02 panel NGUỒN (safety.sourceHealth) + X-01 badge assignment
// ══════════════════════════════════════════════════════════════════════════════════════
function health(over: Record<string, unknown> = {}) {
  return {
    checkedAt: "2026-09-27T00:00:00.000Z",
    safetyPlc: {
      adapterEnabled: true, enabledConfigs: 1, simConfigs: 1, realConfigs: 0, basis: "sim",
      configs: [{ code: "SIM-SAFETY-PLC-1", backend: "sim", effective: "sim", provenance: "SIM" }], hiddenConfigs: 0,
    },
    preflight: {
      expectedReading: "SIM",
      ot: { flag: "OT_SAFETY_PREFLIGHT_ENABLED", preflightEnabled: true, controlEnabled: true, realWrites: "sim_basis", refusalReason: null },
      robot: { flag: "ROBOT_SAFETY_PREFLIGHT_ENABLED", preflightEnabled: true, controlEnabled: false, realWrites: "dry_run", refusalReason: null },
    },
    vision: { enabled: false, calibrations: 0, onnxPersonModelWired: false },
    zoneSw: { enabled: false, zones: 0 },
    estop: { enabled: false, adapter: "null", label: "null (scaffold)", rated: false, reachable: false },
    socket: { serverUp: true },
    ...over,
  };
}

describe("SafetyWorkforce — SAF-02 panel nguồn an toàn", () => {
  it("PLC SIM ⇒ '⚠ SIM (preflight relies on a SIMULATION)' + OT 'allowed on a SIMULATED reading' + robot dry-run", () => {
    setQueryOverride("safety.sourceHealth", makeQuery({ data: health() }));
    render(<SafetyWorkforce />);
    const plc = screen.getByTestId("safety-source-plc");
    expect(plc).toHaveAttribute("data-basis", "sim");
    expect(plc.textContent).toMatch(/SIM/);
    expect(plc.textContent).toMatch(/preflight relies on a SIMULATION/);
    expect(screen.getByTestId("safety-source-ot")).toHaveAttribute("data-verdict", "sim_basis");
    expect(screen.getByTestId("safety-source-robot")).toHaveAttribute("data-verdict", "dry_run");
    expect(screen.getByTestId("safety-source-vision").textContent).toMatch(/off/i);
    expect(screen.getByTestId("safety-source-zone").textContent).toMatch(/off/i);
    expect(screen.getByTestId("safety-source-estop").textContent).toMatch(/off/i);
    expect(screen.getByTestId("safety-source-socket")).toBeInTheDocument();
  });

  it("adapter TẮT ⇒ nói rõ ghi thật BỊ CHẶN (SAFETY_UNKNOWN)", () => {
    setQueryOverride(
      "safety.sourceHealth",
      makeQuery({
        data: health({
          safetyPlc: { adapterEnabled: false, enabledConfigs: 1, simConfigs: 1, realConfigs: 0, basis: "adapter_off", configs: [], hiddenConfigs: 0 },
          preflight: {
            expectedReading: "UNKNOWN",
            ot: { flag: "OT_SAFETY_PREFLIGHT_ENABLED", preflightEnabled: true, controlEnabled: true, realWrites: "blocked", refusalReason: "SAFETY_UNKNOWN" },
            robot: { flag: "ROBOT_SAFETY_PREFLIGHT_ENABLED", preflightEnabled: true, controlEnabled: true, realWrites: "blocked", refusalReason: "SAFETY_UNKNOWN" },
          },
        }),
      }),
    );
    render(<SafetyWorkforce />);
    expect(screen.getByTestId("safety-source-plc")).toHaveAttribute("data-basis", "adapter_off");
    expect(screen.getByTestId("safety-source-ot")).toHaveAttribute("data-verdict", "blocked");
    expect(screen.getByTestId("safety-source-ot").textContent).toMatch(/SAFETY_UNKNOWN/);
  });

  it("đang tải / lỗi ⇒ KHÔNG bịa trạng thái nguồn", () => {
    setQueryOverride("safety.sourceHealth", makeQuery({ isLoading: true }));
    const { rerender } = render(<SafetyWorkforce />);
    expect(screen.getByTestId("safety-source-panel").textContent).toMatch(/Checking safety sources/);
    expect(screen.queryByTestId("safety-source-plc")).not.toBeInTheDocument();
    setQueryOverride("safety.sourceHealth", makeQuery({ isError: true }));
    rerender(<SafetyWorkforce />);
    expect(screen.getByTestId("safety-source-panel").textContent).toMatch(/Could not read safety sources/);
    expect(screen.queryByTestId("safety-source-plc")).not.toBeInTheDocument();
  });
});

// ORACLE ĐỘC LẬP: SEEDED_ASSIGNMENT_IDS khai tay cùng fixture (scope='demo', như 2 hàng DB dev).
function assignment(id: number, scope: string | null) {
  return {
    id, operatorId: 40 + id, lineId: 1, stationId: 2, shiftConfigId: null, skillLevel: "qualified", role: "human",
    status: "planned", assignedStart: "2026-09-26T05:00:00.000Z", assignedEnd: "2026-09-26T13:00:00.000Z",
    confirmedBy: null, confirmedAt: null, closedBy: null, notes: null, scope, corporateCode: null, factoryId: 1,
    createdAt: "2026-09-26T05:00:00.000Z", updatedAt: "2026-09-26T05:00:00.000Z",
  };
}
const ASSIGNMENTS = [assignment(3, "demo"), assignment(4, "demo"), assignment(5, "F1:L1"), assignment(6, null)];
const SEEDED_ASSIGNMENT_IDS = new Set([3, 4]);

describe("SafetyWorkforce — Task 4 X-01: badge DEMO trên assignment", () => {
  it("dải tóm tắt 2/4 + BẤT BIẾN: mọi hàng seed có badge, hàng thật không", async () => {
    setQueryOverride("safety.status", makeQuery({ data: { safetyAudit: true, workforce: true } }));
    setQueryOverride("safety.listAssignments", makeQuery({ data: ASSIGNMENTS }));
    render(<SafetyWorkforce />);
    await openWorkforceTab();
    const s = screen.getByTestId("provenance-summary");
    expect(s).toHaveAttribute("data-count", "2");
    expect(s).toHaveAttribute("data-total", "4");
    for (const a of ASSIGNMENTS) {
      const row = screen.getByText(`#${a.operatorId}`).closest("tr") as HTMLElement;
      expect(row, `assignment ${a.id}`).not.toBeNull();
      const badge = row.querySelector('[data-testid="provenance-badge"]');
      if (SEEDED_ASSIGNMENT_IDS.has(a.id)) {
        expect(badge, `assignment seed #${a.id} THIẾU badge`).not.toBeNull();
        expect(badge!.getAttribute("data-provenance")).toBe("DEMO");
      } else {
        expect(badge, `assignment thật #${a.id} bị gắn nhầm`).toBeNull();
      }
    }
  });
});
