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
  // Doc 81 Đợt 2 Task 8 (hạ tầng, không phải khẳng định): tab MAIN nay đồng bộ `?tab=` (Review Focus 4) — URL
  // jsdom sống qua các test, nên đưa về trang gốc để test sau không bắt đầu ở tab test trước đã mở.
  window.history.replaceState(null, "", "/safety-workforce");
});

afterEach(() => {
  cleanup();
});

// Doc 81 Đợt 3 Task 3 — nút "Assign" (tab "Workforce board") DỜI sang Sản xuất › Ca: các khẳng định "Assign" theo 4 trạng
// thái cờ nay ở ProductionShifts.layout.dom.test.tsx ("cờ nhân lực ĐANG TẢI / LỖI / TẮT / BẬT"); chip cờ nhân lực và nút
// "Start collaboration" (cùng cờ) vẫn đo ở đây.

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

  it("safety.status LỖI ⇒ cả hai nút vẫn khoá + banner lỗi riêng biệt (không phải banner OFF)", async () => {
    setQueryOverride("safety.status", makeQuery({ isError: true }));
    render(<SafetyWorkforce />);

    expect(screen.getByRole("button", { name: /Report proximity/i })).toBeDisabled();
    expect(screen.getAllByTestId("feature-status-error").length).toBe(2);
    expect(screen.queryByTestId("feature-status-off")).not.toBeInTheDocument();
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
  });

  it("safety.status xong, CẢ HAI cờ BẬT ⇒ không banner nào, nút bật", async () => {
    setQueryOverride("safety.status", makeQuery({ data: { safetyAudit: true, workforce: true } }));
    render(<SafetyWorkforce />);

    expect(screen.queryByTestId("feature-status-off")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Report proximity/i })).not.toBeDisabled();
  });

  it("một cờ TẮT, cờ kia CHƯA TẢI ⇒ nút 'Report proximity' (safetyAudit=off) bật ngay", async () => {
    // safetyAudit đã biết = off (không khoá vì lý do 'chưa biết'); workforce vẫn loading.
    setQueryOverride("safety.status", makeQuery({ isLoading: true }));
    const { rerender } = render(<SafetyWorkforce />);
    expect(screen.getByRole("button", { name: /Report proximity/i })).toBeDisabled();

    setQueryOverride("safety.status", makeQuery({ data: { safetyAudit: false, workforce: true } }));
    rerender(<SafetyWorkforce />);
    // Report proximity bật ngay: off đã biết, không còn "chưa biết" nữa.
    expect(screen.getByRole("button", { name: /Report proximity/i })).not.toBeDisabled();
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
      adapterEnabled: true, enabledConfigs: 1, simConfigs: 1, simScriptedConfigs: 0, realConfigs: 0, realUnmappedConfigs: 0, basis: "sim",
      configs: [{ code: "SIM-SAFETY-PLC-1", backend: "sim", effective: "sim_empty", provenance: "SIM" }], hiddenConfigs: 0,
    },
    preflight: {
      expectedReading: "SIM",
      // Đợt 1C Task 1 (2026-09-27) — chỉ SIM ⇒ lệnh thật bị chặn SAFETY_SIM_ONLY (trước đây "sim_basis").
      ot: { flag: "OT_SAFETY_PREFLIGHT_ENABLED", preflightEnabled: true, controlEnabled: true, realWrites: "blocked", refusalReason: "SAFETY_SIM_ONLY" },
      robot: { flag: "ROBOT_SAFETY_PREFLIGHT_ENABLED", preflightEnabled: true, controlEnabled: false, realWrites: "dry_run", refusalReason: null },
    },
    vision: { enabled: false, calibrations: 0, onnxPersonModelWired: false },
    zoneSw: { enabled: false, zones: 0 },
    estop: { enabled: false, adapter: "null", label: "null (scaffold)", rated: false },
    socket: { serverUp: true },
    ...over,
  };
}

describe("SafetyWorkforce — SAF-02 panel nguồn an toàn", () => {
  // Đợt 1C Task 1 — đổi kỳ vọng: trước đây OT "allowed on a SIMULATED reading" (sim_basis); nay bị chặn
  // SAFETY_SIM_ONLY và bảng nói rõ luật "đích đã commission cần safety-PLC THẬT có gán tag".
  it("PLC SIM ⇒ '⚠ SIM only — does NOT satisfy…' + OT bị chặn SAFETY_SIM_ONLY + dòng luật + robot dry-run", () => {
    setQueryOverride("safety.sourceHealth", makeQuery({ data: health() }));
    render(<SafetyWorkforce />);
    const plc = screen.getByTestId("safety-source-plc");
    expect(plc).toHaveAttribute("data-basis", "sim");
    expect(plc.textContent).toMatch(/SIM only — does NOT satisfy the preflight for real commands/);
    expect(screen.getByTestId("safety-source-ot")).toHaveAttribute("data-verdict", "blocked");
    expect(screen.getByTestId("safety-source-ot").textContent).toMatch(/SAFETY_SIM_ONLY/);
    expect(screen.getByTestId("safety-source-ot").textContent).toMatch(/commissioned target needs a REAL safety PLC with mapped tags/);
    expect(screen.getByTestId("safety-source-rule").textContent).toMatch(/commissioned target needs a REAL safety PLC with mapped safety tags/);
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
          safetyPlc: { adapterEnabled: false, enabledConfigs: 1, simConfigs: 1, simScriptedConfigs: 0, realConfigs: 0, realUnmappedConfigs: 0, basis: "adapter_off", configs: [], hiddenConfigs: 0 },
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


// Doc 81 Đợt 3 Task 3 — "Task 4 X-01: badge DEMO trên assignment" DỜI cùng bảng phân công sang Sản xuất › Ca
// (ProductionShifts.layout.dom.test.tsx, "nhãn nguồn dữ liệu … đi theo bảng" — cùng fixture scope demo/F1:L1/null).

// ── Fix round 1 (#1 real_unmapped · #4 sim script · #7 query tắt không phải lỗi) ────────────
describe("SafetyWorkforce — Fix round 1 panel nguồn", () => {
  it("#1 endpoint thật KHÔNG ánh xạ tag ⇒ nói rõ KHÔNG thoả preflight, lệnh thật bị chặn SAFETY_SIM_ONLY (Đợt 1C Task 1)", () => {
    setQueryOverride(
      "safety.sourceHealth",
      makeQuery({
        data: health({
          safetyPlc: {
            adapterEnabled: true, enabledConfigs: 1, simConfigs: 0, simScriptedConfigs: 0, realConfigs: 0, realUnmappedConfigs: 1,
            basis: "real_unmapped", configs: [{ code: "PLC-L3", backend: "modbus", effective: "real_unmapped", provenance: null }], hiddenConfigs: 0,
          },
          preflight: {
            expectedReading: "UNMAPPED",
            // Đợt 1C Task 1 — trước đây "unmapped_basis" (cho qua); nay chặn SAFETY_SIM_ONLY.
            ot: { flag: "OT_SAFETY_PREFLIGHT_ENABLED", preflightEnabled: true, controlEnabled: true, realWrites: "blocked", refusalReason: "SAFETY_SIM_ONLY" },
            robot: { flag: "ROBOT_SAFETY_PREFLIGHT_ENABLED", preflightEnabled: true, controlEnabled: true, realWrites: "blocked", refusalReason: "SAFETY_SIM_ONLY" },
          },
        }),
      }),
    );
    render(<SafetyWorkforce />);
    const plc = screen.getByTestId("safety-source-plc");
    expect(plc).toHaveAttribute("data-basis", "real_unmapped");
    expect(plc.textContent).toMatch(/NO safety tag mapped/);
    expect(plc.textContent).toMatch(/does NOT satisfy the preflight for real commands/);
    expect(screen.getByTestId("safety-source-ot")).toHaveAttribute("data-verdict", "blocked");
    expect(screen.getByTestId("safety-source-ot").textContent).toMatch(/SAFETY_SIM_ONLY/);
  });

  it("#4 SIM kịch bản rỗng ⇒ 'empty script — always OK'; SIM có kịch bản ⇒ 'scripted'", () => {
    setQueryOverride("safety.sourceHealth", makeQuery({ data: health() }));
    const { rerender } = render(<SafetyWorkforce />);
    expect(screen.getByTestId("safety-source-plc").textContent).toMatch(/empty script — always OK/);
    const h = health();
    setQueryOverride(
      "safety.sourceHealth",
      makeQuery({ data: { ...h, safetyPlc: { ...h.safetyPlc, simScriptedConfigs: 1, configs: [{ code: "SIM-S", backend: "sim", effective: "sim_scripted", provenance: "SIM" }] } } }),
    );
    rerender(<SafetyWorkforce />);
    const text = screen.getByTestId("safety-source-plc").textContent ?? "";
    expect(text).toMatch(/scripted/);
    expect(text).not.toMatch(/always OK/);
  });

  it("#7 query bị tắt / chưa chạy (không data, không lỗi, không isLoading) ⇒ KHÔNG hiện 'Could not read'", () => {
    setQueryOverride("safety.sourceHealth", makeQuery({ isPending: true, isLoading: false }));
    render(<SafetyWorkforce />);
    const panel = screen.getByTestId("safety-source-panel");
    expect(panel.textContent).not.toMatch(/Could not read safety sources/);
    expect(screen.queryByTestId("safety-source-plc")).not.toBeInTheDocument();
  });
});
