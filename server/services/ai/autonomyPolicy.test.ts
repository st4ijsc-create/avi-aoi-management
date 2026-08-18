/**
 * doc 69 Giai đoạn 4/Wave 3 — D2 bounded-autonomy policy unit tests.
 *
 * Exercises evaluateAutonomy()'s AND-chain in isolation: `evaluateContractForAutonomy`
 * (from aiCopilotActions.ts) is MOCKED here so each condition can be flipped
 * independently — the wiring into the REAL confirm/execute path (and the REAL
 * guardrail enforcement) is covered by aiCopilotActions.autonomy.test.ts instead.
 *
 * The kill-switch is backed by a fake in-memory `ai_system_config` table (the SAME
 * table server/routers/aiSettingsRouter.ts already uses for other AI runtime
 * settings) via a fake drizzle-like db, so isKillSwitchTripped/tripKillSwitch/
 * untripKillSwitch are exercised for real (not mocked away).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

type Row = Record<string, any>;
const configStore = new Map<string, Row>();
let dbAvailable = true;

function makeFakeDb() {
  return {
    select: (_cols?: unknown) => ({
      from: (_table: unknown) => ({
        where: (pred: (r: Row) => boolean) => ({
          limit: async (_n: number) => {
            for (const r of configStore.values()) if (pred(r)) return [r];
            return [];
          },
        }),
      }),
    }),
    insert: (_table: unknown) => ({
      values: (vals: Row) => {
        configStore.set(vals.key, { ...vals });
        const result: any = Promise.resolve(undefined);
        result.onConflictDoUpdate = async ({ set }: { set: Row }) => {
          const existing = configStore.get(vals.key) ?? { ...vals };
          Object.assign(existing, set);
          configStore.set(vals.key, existing);
        };
        return result;
      },
    }),
  };
}

vi.mock("../../db/connection", () => ({
  getDb: vi.fn(async () => (dbAvailable ? makeFakeDb() : null)),
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: any, val: any) => (r: Row) => r[col.__name] === val,
}));

vi.mock("../../../drizzle/schema", () => ({
  aiSystemConfig: {
    key: { __name: "key" },
    value: { __name: "value" },
    description: { __name: "description" },
    updatedBy: { __name: "updatedBy" },
    updatedAt: { __name: "updatedAt" },
  },
}));

const evaluateContractForAutonomy = vi.fn();
vi.mock("../aiCopilotActions", () => ({
  evaluateContractForAutonomy: (...a: unknown[]) => evaluateContractForAutonomy(...a),
}));

import {
  evaluateAutonomy,
  getAutonomyAllowlist,
  autonomyMaxPerHour,
  AUTONOMY_INELIGIBLE,
  AUTONOMY_REASONS,
  isKillSwitchTripped,
  tripKillSwitch,
  untripKillSwitch,
  recordAutonomousExecution,
  __resetAutonomyRateCapForTests,
  type AutonomyAction,
  type AutonomyContext,
} from "./autonomyPolicy";

const USER = { id: 1, role: "admin", name: "Admin" };

function greenAction(overrides: Partial<AutonomyAction> = {}): AutonomyAction {
  return { type: "eligible_tool", idempotencyKey: "idem-1", contract: { requires: [] }, args: {}, ...overrides };
}
function ctx(overrides: Partial<AutonomyContext> = {}): AutonomyContext {
  return { user: USER, tool: "eligible_tool", actionId: "a1", lang: "vi", ...overrides };
}

beforeEach(() => {
  configStore.clear();
  dbAvailable = true;
  vi.clearAllMocks();
  evaluateContractForAutonomy.mockResolvedValue({ ok: true });
  process.env.AI_AUTONOMY_ENABLED = "true";
  process.env.AI_AUTONOMY_ALLOWLIST = "eligible_tool";
  __resetAutonomyRateCapForTests();
});

afterEach(() => {
  delete process.env.AI_AUTONOMY_ENABLED;
  delete process.env.AI_AUTONOMY_ALLOWLIST;
  delete process.env.AI_AUTONOMY_MAX_PER_HOUR;
});

describe("evaluateAutonomy — AND-chain (table-driven)", () => {
  it("all conditions green ⇒ allowed:true, reason OK", async () => {
    const res = await evaluateAutonomy(greenAction(), ctx());
    expect(res).toEqual({ allowed: true, reason: AUTONOMY_REASONS.OK });
  });

  it("master flag OFF ⇒ not allowed (MASTER_DISABLED); contract check never touched", async () => {
    delete process.env.AI_AUTONOMY_ENABLED;
    const res = await evaluateAutonomy(greenAction(), ctx());
    expect(res).toEqual({ allowed: false, reason: AUTONOMY_REASONS.MASTER_DISABLED });
    expect(evaluateContractForAutonomy).not.toHaveBeenCalled();
  });

  it("kill-switch tripped ⇒ not allowed, even with everything else green", async () => {
    await tripKillSwitch("manual trip for test", 99);
    const res = await evaluateAutonomy(greenAction(), ctx());
    expect(res).toEqual({ allowed: false, reason: AUTONOMY_REASONS.KILL_SWITCH_TRIPPED });
  });

  it("kill-switch untrip ⇒ allowed again", async () => {
    await tripKillSwitch("trip", 99);
    expect((await evaluateAutonomy(greenAction(), ctx())).allowed).toBe(false);
    await untripKillSwitch(99);
    expect((await evaluateAutonomy(greenAction(), ctx())).allowed).toBe(true);
  });

  it("kill-switch is read FRESH — a trip AFTER an initial green check blocks the very next check", async () => {
    expect((await evaluateAutonomy(greenAction(), ctx())).allowed).toBe(true);
    await tripKillSwitch("late trip (between propose and confirm)", 5);
    expect((await evaluateAutonomy(greenAction(), ctx())).allowed).toBe(false);
  });

  it("no kill-switch row ever written ⇒ treated as NOT tripped (steady-state default)", async () => {
    expect(await isKillSwitchTripped()).toBe(false);
  });

  it("kill-switch read failure (DB unreachable) fails CLOSED (tripped=true)", async () => {
    dbAvailable = false;
    expect(await isKillSwitchTripped()).toBe(true);
  });

  it("type in the hard-coded ineligible denylist ⇒ not allowed EVEN IF also allowlisted (denylist beats allowlist)", async () => {
    process.env.AI_AUTONOMY_ALLOWLIST = "machine_start"; // operator mistake: allowlisted a denylisted type
    const res = await evaluateAutonomy(greenAction({ type: "machine_start" }), ctx({ tool: "machine_start" }));
    expect(res).toEqual({ allowed: false, reason: AUTONOMY_REASONS.TYPE_INELIGIBLE });
  });

  it("type not in the allowlist ⇒ not allowed (allowlist defaults EMPTY)", async () => {
    process.env.AI_AUTONOMY_ALLOWLIST = "";
    const res = await evaluateAutonomy(greenAction(), ctx());
    expect(res).toEqual({ allowed: false, reason: AUTONOMY_REASONS.TYPE_NOT_ALLOWLISTED });
  });

  it("missing idempotencyKey ⇒ not allowed", async () => {
    const res = await evaluateAutonomy(greenAction({ idempotencyKey: undefined }), ctx());
    expect(res).toEqual({ allowed: false, reason: AUTONOMY_REASONS.NO_IDEMPOTENCY_KEY });
  });

  it("rate cap exceeded ⇒ not allowed (fail-safe HITL fallback, not an error)", async () => {
    process.env.AI_AUTONOMY_MAX_PER_HOUR = "2";
    recordAutonomousExecution(USER.id);
    recordAutonomousExecution(USER.id);
    const res = await evaluateAutonomy(greenAction(), ctx());
    expect(res).toEqual({ allowed: false, reason: AUTONOMY_REASONS.RATE_CAP_EXCEEDED });
  });

  it("rate cap is per-user — another user is unaffected", async () => {
    process.env.AI_AUTONOMY_MAX_PER_HOUR = "1";
    recordAutonomousExecution(USER.id);
    const capped = await evaluateAutonomy(greenAction(), ctx());
    expect(capped.allowed).toBe(false);
    const other = await evaluateAutonomy(greenAction(), ctx({ user: { id: 2, role: "admin" } }));
    expect(other.allowed).toBe(true);
  });

  it("no advice contract ⇒ not allowed (autonomy cannot verify an unattached safety envelope)", async () => {
    evaluateContractForAutonomy.mockResolvedValue({ ok: false, reason: "NO_ADVICE_CONTRACT" });
    const res = await evaluateAutonomy(greenAction({ contract: null }), ctx());
    expect(res).toEqual({ allowed: false, reason: "NO_ADVICE_CONTRACT" });
  });

  it("guardrail FAIL (value outside band) ⇒ not allowed", async () => {
    evaluateContractForAutonomy.mockResolvedValue({ ok: false, reason: "GUARDRAIL_VIOLATION" });
    const res = await evaluateAutonomy(greenAction(), ctx());
    expect(res).toEqual({ allowed: false, reason: "GUARDRAIL_VIOLATION" });
  });

  it("requires[] unmet (e.g. policy denied) ⇒ not allowed", async () => {
    evaluateContractForAutonomy.mockResolvedValue({ ok: false, reason: "POLICY_DENIED" });
    const res = await evaluateAutonomy(greenAction(), ctx());
    expect(res).toEqual({ allowed: false, reason: "POLICY_DENIED" });
  });

  it("delegates to evaluateContractForAutonomy with the action's own contract/args (reused, not reimplemented)", async () => {
    const contract = { guardrail: { min: 0, max: 10, key: "x" } };
    await evaluateAutonomy(greenAction({ contract, args: { x: 5 } }), ctx());
    expect(evaluateContractForAutonomy).toHaveBeenCalledTimes(1);
    expect(evaluateContractForAutonomy).toHaveBeenCalledWith(
      contract,
      expect.objectContaining({ tool: "eligible_tool", actionId: "a1", args: { x: 5 }, lang: "vi" }),
    );
  });

  // ── D2 review Fix 2 — fail CLOSED, not fail-throw ────────────────────────────
  it("a throw from the contract check (evaluateContractForAutonomy) degrades to allowed:false/AUTONOMY_CHECK_ERROR — does NOT reject", async () => {
    evaluateContractForAutonomy.mockRejectedValue(new Error("boom — unexpected contract-check crash"));
    await expect(evaluateAutonomy(greenAction(), ctx())).resolves.toEqual({
      allowed: false,
      reason: AUTONOMY_REASONS.AUTONOMY_CHECK_ERROR,
    });
  });
});

/**
 * ⚠⚠ G3-C — **KHỐI NÀY LÀ SÀN, KHÔNG PHẢI LƯỚI.**
 *
 * Nó đối chiếu `AUTONOMY_INELIGIBLE` (danh sách viết cứng) với **một mảng viết cứng khác**, và
 * **không** duyệt `listTools()`. Vì thế nó **không thể** thấy tool thứ N+1: một write tool thêm
 * hôm nay không làm ca nào ở đây đỏ. Giữ lại vì nó vẫn có giá trị riêng — nó ghim rằng những cái
 * tên NGUY HIỂM CỤ THỂ này không được ai lặng lẽ gỡ khỏi denylist (một mất mát mà census không
 * phát biểu được, vì tool bị gỡ vẫn "đã phân loại" nếu ai đó dời nó sang REVIEWED_SAFE).
 *
 * ⇒ Lưới N+1 thật nằm ở **`autonomyWriteToolCensus.test.ts`**: nó duyệt registry SỐNG và đi qua
 * `evaluateAutonomy()`. Đọc file đó trước khi thêm/bớt tên ở đây.
 */
describe("AUTONOMY_INELIGIBLE — hard-coded denylist coverage (SÀN — xem autonomyWriteToolCensus.test.ts)", () => {
  it("covers every machine-actuation / vision-disposition / program-file / interlock / setpoint write-tool type", () => {
    const mustBeIneligible = [
      "machine_start", "machine_stop", "machine_pause", "machine_reset",
      "select_recipe", "download_job", "set_machine_param", "acknowledge_machine_alarm",
      "reject_divert", "spi_printer_offset",
      // D2 review Fix 1 — found by a FULL server-tree scan (outside aiLocalTools/writeHandlers*).
      "propose_defect_from_vision",
      "write_project_file",
      // doc 78 PHA B — sinh tiến trình trên máy chủ (npm run check / npx vitest run …).
      "run_command",
      "propose_interlock_rule",
      "adjust_ng_threshold", "create_ng_threshold", "configure_inspection_param",
      "update_product_quality_target", "set_yield_threshold",
      "create_measurement_point", "update_measurement_point", "set_spec_limits",
    ];
    for (const t of mustBeIneligible) {
      expect(AUTONOMY_INELIGIBLE.has(t), `expected "${t}" to be ineligible`).toBe(true);
    }
  });

  it("does NOT blanket-ban every write tool (low-risk record/ack/analysis tools stay eligible-by-config)", () => {
    for (const t of ["acknowledge_alert", "acknowledge_predictive_alert", "resolve_predictive_alert", "create_maintenance_workorder", "run_rca_analysis", "request_threshold_review"]) {
      expect(AUTONOMY_INELIGIBLE.has(t), `expected "${t}" to remain eligible-by-config`).toBe(false);
    }
  });

  // ── D2 review Fix 1 — denylist beats allowlist, specifically for the vision
  // disposition tool the original directory-scoped enumeration missed ────────────
  it("propose_defect_from_vision (+ other hard-denylisted tools) return allowed:false EVEN IF an operator misconfigures them into the allowlist", async () => {
    for (const t of ["propose_defect_from_vision", "write_project_file", "propose_interlock_rule"]) {
      process.env.AI_AUTONOMY_ALLOWLIST = t;
      const res = await evaluateAutonomy(greenAction({ type: t }), ctx({ tool: t }));
      expect(res, `expected "${t}" to stay ineligible despite being allowlisted`).toEqual({
        allowed: false,
        reason: AUTONOMY_REASONS.TYPE_INELIGIBLE,
      });
    }
  });
});

describe("env config parsing (pure)", () => {
  it("getAutonomyAllowlist: unset/empty ⇒ empty set", () => {
    delete process.env.AI_AUTONOMY_ALLOWLIST;
    expect(getAutonomyAllowlist().size).toBe(0);
    process.env.AI_AUTONOMY_ALLOWLIST = "   ";
    expect(getAutonomyAllowlist().size).toBe(0);
  });

  it("getAutonomyAllowlist: comma-separated, trimmed", () => {
    process.env.AI_AUTONOMY_ALLOWLIST = " acknowledge_alert, create_maintenance_workorder ,,run_rca_analysis";
    const set = getAutonomyAllowlist();
    expect(set).toEqual(new Set(["acknowledge_alert", "create_maintenance_workorder", "run_rca_analysis"]));
  });

  it("autonomyMaxPerHour: default generous, invalid/zero falls back to default", () => {
    delete process.env.AI_AUTONOMY_MAX_PER_HOUR;
    const def = autonomyMaxPerHour();
    expect(def).toBeGreaterThan(0);
    process.env.AI_AUTONOMY_MAX_PER_HOUR = "0";
    expect(autonomyMaxPerHour()).toBe(def);
    process.env.AI_AUTONOMY_MAX_PER_HOUR = "not-a-number";
    expect(autonomyMaxPerHour()).toBe(def);
    process.env.AI_AUTONOMY_MAX_PER_HOUR = "7";
    expect(autonomyMaxPerHour()).toBe(7);
  });
});
