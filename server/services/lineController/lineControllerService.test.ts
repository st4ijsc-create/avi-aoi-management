/**
 * doc 44 W3-A2 / G3.1 — Line Controller service tests.
 *
 * Covers: FSM mọi transition hợp lệ/không hợp lệ (kèm allowed list), policy
 * deny chặn + audit, readiness gate khi vào 'ready', persist + append audit +
 * correlation (opts + ALS backbone), FSM bền qua "restart" (đọc lại từ store),
 * UNS `_line/state` publish gated cờ + state-store delta, command mapping
 * (start-chain / complete theo ngữ cảnh), sweep: máy fault → line fault,
 * blocking/starving → Andon (cooldown), bottleneck change.
 *
 * Repo DB layer được mock bằng store in-memory (race-guard state===from giữ
 * nguyên semantics của lineStateRepo.applyTransition).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ── hoisted mutable fixture state ─────────────────────────────────────────────
const h = vi.hoisted(() => ({
  db: {
    available: true,
    lines: new Set<number>(),
    states: new Map<number, any>(),
    transitions: [] as any[],
    machinesByLine: new Map<number, any[]>(),
  },
  readiness: null as any, // null → mặc định ready:true
  policy: null as any, // null → mặc định allow
  storeOn: false,
  balance: null as any,
  dwell: [] as any[],
  segs: { site: "f1", area: "w1", line: "l1" } as any,
}));

// ── mocks ─────────────────────────────────────────────────────────────────────
vi.mock("./lineStateRepo", () => {
  const mkRow = (lineId: number) => ({
    id: lineId,
    lineId,
    state: "idle",
    heldReason: null,
    recipeSetRef: null,
    activeOrderId: null,
    taktTargetS: null,
    enteredAt: new Date(),
    updatedAt: new Date(),
  });
  return {
    isDbAvailable: vi.fn(async () => h.db.available),
    getLineRow: vi.fn(async (id: number) =>
      h.db.lines.has(id) ? { id, code: `L-${id}`, name: `Line ${id}`, workshopId: 1, isActive: true } : null,
    ),
    getLineState: vi.fn(async (id: number) => h.db.states.get(id) ?? null),
    ensureLineState: vi.fn(async (id: number) => {
      if (!h.db.states.has(id)) h.db.states.set(id, mkRow(id));
      return h.db.states.get(id);
    }),
    applyTransition: vi.fn(async (p: any) => {
      const row = h.db.states.get(p.lineId);
      if (!row || row.state !== p.from) return null; // race-guard semantics
      row.state = p.to;
      row.enteredAt = new Date();
      row.updatedAt = row.enteredAt;
      row.heldReason = p.to === "held" ? (p.heldReason ?? p.reason ?? null) : null;
      if (p.recipeSetRef !== undefined) row.recipeSetRef = p.recipeSetRef;
      if (p.activeOrderId !== undefined) row.activeOrderId = p.activeOrderId;
      if (p.taktTargetS !== undefined) row.taktTargetS = p.taktTargetS;
      h.db.transitions.push({
        lineId: p.lineId,
        fromState: p.from,
        toState: p.to,
        reason: p.reason,
        triggeredBy: p.triggeredBy,
        correlationId: p.correlationId,
        policyRef: p.policyRef,
        ts: new Date(),
      });
      return { ...row };
    }),
    appendDeniedAudit: vi.fn(async (p: any) => {
      h.db.transitions.push({
        lineId: p.lineId,
        fromState: p.from,
        toState: p.to,
        reason: `POLICY_DENIED: ${p.reason}`,
        triggeredBy: p.triggeredBy,
        correlationId: p.correlationId,
        policyRef: p.policyRef,
        ts: new Date(),
        denied: true,
      });
    }),
    listLinesWithState: vi.fn(async () =>
      [...h.db.lines].map((id) => {
        const r = h.db.states.get(id);
        return {
          lineId: id,
          code: `L-${id}`,
          name: `Line ${id}`,
          workshopId: 1,
          state: r?.state ?? "idle",
          heldReason: r?.heldReason ?? null,
          recipeSetRef: r?.recipeSetRef ?? null,
          activeOrderId: null,
          taktTargetS: null,
          enteredAt: null,
          updatedAt: null,
        };
      }),
    ),
    listTransitions: vi.fn(async (lineId: number, limit = 20) =>
      h.db.transitions.filter((t) => t.lineId === lineId).slice(-limit).reverse(),
    ),
    getLineMachines: vi.fn(async (lineId: number) => h.db.machinesByLine.get(lineId) ?? []),
    getLatestPresence: vi.fn(async () => new Map()),
    getLineStations: vi.fn(async () => []),
    getStageCycleTargets: vi.fn(async () => new Map()),
    getLineSegs: vi.fn(async () => h.segs),
    invalidateLineSegsCache: vi.fn(),
  };
});

vi.mock("./lineReadiness", () => ({
  checkLineReadiness: vi.fn(async (lineId: number) =>
    h.readiness ?? { lineId, ready: true, checks: [], checkedAt: new Date().toISOString() },
  ),
  getCachedReadiness: vi.fn(() => null),
}));

vi.mock("../security/policyGate", () => ({
  evaluateCommandPolicy: vi.fn(
    () => h.policy ?? { allow: true, effect: "allow", reason: "SEC_PLATFORM off", policyId: null },
  ),
}));

vi.mock("../unsPublisher", () => ({ publishUnsV2: vi.fn(() => true) }));

vi.mock("../stateStore/stateStore", () => ({
  stateStoreEnabled: vi.fn(() => h.storeOn),
  setState: vi.fn(),
}));

vi.mock("../../db/lineBalance", () => ({
  getLatestLineBalance: vi.fn(async () => h.balance),
  getStationDwellAgg: vi.fn(async () => h.dwell),
}));

vi.mock("../aiSmartAlertRouter", () => ({
  routeAlert: vi.fn(async () => ({
    alertType: "PATTERN_ANOMALY",
    targets: [],
    consolidated: false,
    escalationLevel: "L1",
  })),
}));

// ── SUT + mocked handles ──────────────────────────────────────────────────────
import {
  transitionLine,
  executeLineCommand,
  resolveCommandTarget,
  runLineControllerSweepOnce,
  startLineController,
  stopLineController,
  getLineControllerStatus,
  _resetLineControllerForTests,
} from "./lineControllerService";
import { LINE_STATES, LINE_STATE_TRANSITIONS, type LineControllerState } from "../../../drizzle/schema";
import { evaluateCommandPolicy } from "../security/policyGate";
import { checkLineReadiness } from "./lineReadiness";
import { publishUnsV2 } from "../unsPublisher";
import { setState } from "../stateStore/stateStore";
import { routeAlert } from "../aiSmartAlertRouter";
import * as repoMock from "./lineStateRepo";
import { withCorrelation } from "../observability/correlation";

function seedLine(id: number, state?: LineControllerState) {
  h.db.lines.add(id);
  if (state) {
    h.db.states.set(id, {
      id,
      lineId: id,
      state,
      heldReason: null,
      recipeSetRef: null,
      activeOrderId: null,
      taktTargetS: null,
      enteredAt: new Date(),
      updatedAt: new Date(),
    });
  }
}

beforeEach(() => {
  h.db.available = true;
  h.db.lines.clear();
  h.db.states.clear();
  h.db.transitions.length = 0;
  h.db.machinesByLine.clear();
  h.readiness = null;
  h.policy = null;
  h.storeOn = false;
  h.balance = null;
  h.dwell = [];
  h.segs = { site: "f1", area: "w1", line: "l1" };
  _resetLineControllerForTests();
  vi.clearAllMocks();
});

afterEach(() => {
  stopLineController();
  vi.unstubAllEnvs();
});

// ═══ FSM — transitions hợp lệ ════════════════════════════════════════════════

describe("FSM — mọi transition hợp lệ theo spec §4.1", () => {
  it("đi trọn vòng đời: idle→ready→producing→held→producing→completing→idle", async () => {
    seedLine(1);
    const path: LineControllerState[] = ["ready", "producing", "held", "producing", "completing", "idle"];
    for (const to of path) {
      const res = await transitionLine(1, to, { actor: "system" });
      expect(res.ok, `to=${to}`).toBe(true);
      expect(h.db.states.get(1).state).toBe(to);
    }
  });

  it("changeover từ idle VÀ ready, quay về ready", async () => {
    seedLine(1, "idle");
    expect((await transitionLine(1, "changeover")).ok).toBe(true);
    expect((await transitionLine(1, "ready")).ok).toBe(true);
    expect((await transitionLine(1, "changeover")).ok).toBe(true); // ready→changeover
    expect(h.db.states.get(1).state).toBe("changeover");
  });

  it("*→fault từ mọi trạng thái (trừ fault) và fault→ready (khắc phục + checklist)", async () => {
    for (const from of LINE_STATES.filter((s) => s !== "fault")) {
      seedLine(10, from);
      const res = await transitionLine(10, "fault", { reason: "sự cố" });
      expect(res.ok, `from=${from}`).toBe(true);
      h.db.states.delete(10);
    }
    seedLine(11, "fault");
    const res = await transitionLine(11, "ready", { reason: "đã khắc phục, xác nhận" });
    expect(res.ok).toBe(true);
    // fault→ready phải qua checklist (bằng chứng khắc phục)
    expect(vi.mocked(checkLineReadiness)).toHaveBeenCalledWith(11, expect.anything());
  });
});

// ═══ FSM — transitions KHÔNG hợp lệ ═════════════════════════════════════════

describe("FSM — transition không hợp lệ → INVALID_TRANSITION + danh sách hợp lệ", () => {
  it("liệt kê đủ mọi cặp không hợp lệ theo map (kể cả same-state)", async () => {
    for (const from of LINE_STATES) {
      const allowed = LINE_STATE_TRANSITIONS[from];
      for (const to of LINE_STATES) {
        if (allowed.includes(to)) continue; // hợp lệ — test ở trên
        seedLine(20, from);
        const res = await transitionLine(20, to);
        expect(res.ok, `${from}→${to}`).toBe(false);
        if (!res.ok) {
          expect(res.code, `${from}→${to}`).toBe("INVALID_TRANSITION");
          if (res.code === "INVALID_TRANSITION") {
            expect(res.allowed).toEqual(allowed);
            expect(res.from).toBe(from);
          }
        }
        expect(h.db.states.get(20).state).toBe(from); // trạng thái giữ nguyên
        h.db.states.delete(20);
      }
    }
  });

  it("trạng thái đích không tồn tại → INVALID_TRANSITION", async () => {
    seedLine(1, "idle");
    const res = await transitionLine(1, "warp" as LineControllerState);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("INVALID_TRANSITION");
  });

  it("tuyến không tồn tại → LINE_NOT_FOUND; mất DB → DB_UNAVAILABLE", async () => {
    const notFound = await transitionLine(999, "ready");
    expect(!notFound.ok && notFound.code).toBe("LINE_NOT_FOUND");

    h.db.available = false;
    seedLine(1, "idle");
    const noDb = await transitionLine(1, "ready");
    expect(!noDb.ok && noDb.code).toBe("DB_UNAVAILABLE");
  });
});

// ═══ Policy seam ══════════════════════════════════════════════════════════════

describe("policy seam — evaluateCommandPolicy line.command.{to}", () => {
  it("được gọi với action + context {lineId, from, to}; PERMIT → transition chạy", async () => {
    seedLine(1, "ready");
    const res = await transitionLine(1, "producing", { actor: "7" });
    expect(res.ok).toBe(true);
    expect(vi.mocked(evaluateCommandPolicy)).toHaveBeenCalledWith(
      expect.objectContaining({ action: "line.command.producing", lineId: 1, from: "ready", to: "producing" }),
    );
  });

  it("DENY → chặn (state giữ nguyên) + audit row POLICY_DENIED với policyRef", async () => {
    h.policy = { allow: false, effect: "deny", reason: "cấm theo chính sách", policyId: "pol-line-1" };
    seedLine(1, "ready");
    const res = await transitionLine(1, "producing", { actor: "7" });
    expect(res.ok).toBe(false);
    if (!res.ok && res.code === "POLICY_DENIED") {
      expect(res.policyRef).toBe("pol-line-1");
      expect(res.effect).toBe("deny");
    } else {
      expect.fail(`expected POLICY_DENIED, got ${JSON.stringify(res)}`);
    }
    expect(h.db.states.get(1).state).toBe("ready"); // KHÔNG đổi
    const audit = h.db.transitions.find((t) => t.denied);
    expect(audit).toBeTruthy();
    expect(audit.reason).toMatch(/^POLICY_DENIED: /);
    expect(audit.policyRef).toBe("pol-line-1");
    expect(audit.triggeredBy).toBe("7");
    // Không publish khi transition bị chặn
    expect(vi.mocked(publishUnsV2)).not.toHaveBeenCalled();
  });

  it("require_approval chưa approve → chặn với effect tương ứng", async () => {
    h.policy = { allow: false, effect: "require_approval", reason: "cần 4-eyes", policyId: "pol-4e" };
    seedLine(1, "producing");
    const res = await transitionLine(1, "held");
    expect(!res.ok && res.code === "POLICY_DENIED" && res.effect).toBe("require_approval");
  });
});

// ═══ Readiness gate khi vào 'ready' ══════════════════════════════════════════

describe("readiness gate — idle→ready BẮT BUỘC qua checklist", () => {
  it("checklist fail → NOT_READY + checks, GIỮ idle (không HELD), policy KHÔNG được gọi", async () => {
    h.readiness = {
      lineId: 1,
      ready: false,
      checks: [{ name: "machines_online", passed: false, detail: "2 máy offline" }],
      checkedAt: new Date().toISOString(),
    };
    seedLine(1, "idle");
    const res = await transitionLine(1, "ready");
    expect(res.ok).toBe(false);
    if (!res.ok && res.code === "NOT_READY") {
      expect(res.readiness.checks[0].name).toBe("machines_online");
    } else {
      expect.fail(`expected NOT_READY, got ${JSON.stringify(res)}`);
    }
    expect(h.db.states.get(1).state).toBe("idle"); // giữ idle, KHÔNG tự HELD
    expect(vi.mocked(evaluateCommandPolicy)).not.toHaveBeenCalled();
  });

  it("checklist pass → transition ok, kết quả readiness đính kèm", async () => {
    seedLine(1, "idle");
    const res = await transitionLine(1, "ready");
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.readiness?.ready).toBe(true);
  });

  it("transition KHÔNG vào 'ready' thì không chạy checklist", async () => {
    seedLine(1, "ready");
    await transitionLine(1, "producing");
    expect(vi.mocked(checkLineReadiness)).not.toHaveBeenCalled();
  });
});

// ═══ Persist + audit + correlation ═══════════════════════════════════════════

describe("persist + append audit + correlation id", () => {
  it("ghi transition row với actor/reason; held_reason set khi hold, xóa khi resume", async () => {
    seedLine(1, "producing");
    await transitionLine(1, "held", { actor: "42", reason: "thiếu vật tư", heldReason: "quality gate" });
    expect(h.db.states.get(1).heldReason).toBe("quality gate");
    const row = h.db.transitions.at(-1);
    expect(row.triggeredBy).toBe("42");
    expect(row.reason).toBe("thiếu vật tư");

    await transitionLine(1, "producing", { actor: "42", reason: "đã cấp liệu" });
    expect(h.db.states.get(1).heldReason).toBeNull();
  });

  it("correlationId: opts truyền thắng; không truyền → lấy từ ALS backbone", async () => {
    seedLine(1, "producing");
    await transitionLine(1, "held", { correlationId: "corr-explicit" });
    expect(h.db.transitions.at(-1).correlationId).toBe("corr-explicit");

    seedLine(2, "producing");
    await withCorrelation({ correlationId: "corr-als" }, async () => {
      await transitionLine(2, "held");
    });
    expect(h.db.transitions.at(-1).correlationId).toBe("corr-als");

    seedLine(3, "producing");
    await transitionLine(3, "held");
    expect(h.db.transitions.at(-1).correlationId).toBeNull(); // ngoài context — honest null
  });

  it("race thua (state đổi giữa chừng) → CONFLICT", async () => {
    seedLine(1, "ready");
    // Giả lập race: applyTransition trả null một lần (state đã bị đổi bởi phiên khác)
    vi.mocked(repoMock.applyTransition).mockResolvedValueOnce(null as any);
    const res = await transitionLine(1, "producing");
    expect(!res.ok && res.code).toBe("CONFLICT");
  });
});

// ═══ FSM bền qua restart ═════════════════════════════════════════════════════

describe("recovery — FSM bền qua restart (spec §7/§19.1)", () => {
  it("sau reset module (restart), transition đọc trạng thái từ store bền", async () => {
    seedLine(1);
    await transitionLine(1, "ready");
    await transitionLine(1, "producing");
    // "Restart" process: xóa sạch state in-memory của service — store (DB fake) giữ nguyên
    _resetLineControllerForTests();
    const res = await transitionLine(1, "held", { reason: "sau restart" });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.from).toBe("producing"); // đọc từ trạng thái bền, không phải memory
  });

  it("startLineController: OFF (default) → không chạy; ON → recovery + sweep timer", async () => {
    await startLineController();
    expect(getLineControllerStatus().running).toBe(false);

    vi.stubEnv("LINE_CONTROLLER_ENABLED", "true");
    seedLine(1, "producing");
    await startLineController();
    expect(getLineControllerStatus().running).toBe(true);
    expect(vi.mocked(repoMock.listLinesWithState)).toHaveBeenCalled(); // recovery read
    stopLineController();
    expect(getLineControllerStatus().running).toBe(false);
  });
});

// ═══ UNS publish + state store — gated cờ ═══════════════════════════════════

describe("UNS `_line/state` publish + state-store delta (gated cờ)", () => {
  it("UNS_TOPIC_V2_ENABLED off (default) → KHÔNG publish", async () => {
    seedLine(1, "ready");
    await transitionLine(1, "producing");
    expect(vi.mocked(publishUnsV2)).not.toHaveBeenCalled();
  });

  it("cờ on → publish retained `syn/{site}/{area}/{line}/_line/state`, state UPPERCASE", async () => {
    vi.stubEnv("UNS_TOPIC_V2_ENABLED", "true");
    seedLine(1, "ready");
    await transitionLine(1, "producing");
    expect(vi.mocked(publishUnsV2)).toHaveBeenCalledTimes(1);
    const [topic, payload, aspect] = vi.mocked(publishUnsV2).mock.calls[0];
    expect(topic).toBe("syn/f1/w1/l1/_line/state");
    expect(aspect).toBe("state"); // aspect 'state' → retained QoS1 (topicV2.aspectPublishOptions)
    expect((payload as any).state).toBe("PRODUCING"); // spec §12.2
    expect((payload as any).path).toBe("f1/w1/l1/_line");
  });

  it("segs không resolve được → skip honest (không publish, không throw)", async () => {
    vi.stubEnv("UNS_TOPIC_V2_ENABLED", "true");
    h.segs = null;
    seedLine(1, "ready");
    const res = await transitionLine(1, "producing");
    expect(res.ok).toBe(true);
    expect(vi.mocked(publishUnsV2)).not.toHaveBeenCalled();
  });

  it("STATE_STORE bật → setState delta với path `{segs}/_line`", async () => {
    h.storeOn = true;
    seedLine(1, "producing");
    await transitionLine(1, "held", { heldReason: "quality gate" });
    expect(vi.mocked(setState)).toHaveBeenCalledTimes(1);
    const [path, snap] = vi.mocked(setState).mock.calls[0];
    expect(path).toBe("f1/w1/l1/_line");
    expect((snap as any).state).toBe("HELD");
    expect((snap as any).source).toBe("live");
  });
});

// ═══ Command mapping ═════════════════════════════════════════════════════════

describe("executeLineCommand — mapping lệnh → transition (spec §13.2)", () => {
  it("resolveCommandTarget: bảng map theo ngữ cảnh", () => {
    expect(resolveCommandTarget("start", "idle")).toEqual({ to: "producing", chainReadyFirst: true });
    expect(resolveCommandTarget("start", "ready")).toEqual({ to: "producing" });
    expect(resolveCommandTarget("hold", "producing")).toEqual({ to: "held" });
    expect(resolveCommandTarget("resume", "held")).toEqual({ to: "producing" });
    expect(resolveCommandTarget("changeover", "idle")).toEqual({ to: "changeover" });
    expect(resolveCommandTarget("complete", "producing")).toEqual({ to: "completing" });
    expect(resolveCommandTarget("complete", "completing")).toEqual({ to: "idle" });
    expect(resolveCommandTarget("complete", "changeover")).toEqual({ to: "ready" });
    expect(resolveCommandTarget("reset_fault", "fault")).toEqual({ to: "ready" });
  });

  it("start từ idle: chuỗi idle→ready (checklist) → producing; cả 2 bước trong audit", async () => {
    seedLine(1, "idle");
    const res = await executeLineCommand(1, "start", { actor: "9" });
    expect(res.ok).toBe(true);
    expect(h.db.states.get(1).state).toBe("producing");
    const steps = h.db.transitions.filter((t) => t.lineId === 1).map((t) => `${t.fromState}→${t.toState}`);
    expect(steps).toEqual(["idle→ready", "ready→producing"]);
  });

  it("start từ idle khi checklist fail → NOT_READY, giữ idle", async () => {
    h.readiness = { lineId: 1, ready: false, checks: [{ name: "machines_online", passed: false, detail: "offline" }], checkedAt: new Date().toISOString() };
    seedLine(1, "idle");
    const res = await executeLineCommand(1, "start");
    expect(!res.ok && res.code).toBe("NOT_READY");
    expect(h.db.states.get(1).state).toBe("idle");
  });

  it("hold khi đang idle → INVALID_TRANSITION (không hợp lệ)", async () => {
    seedLine(1, "idle");
    const res = await executeLineCommand(1, "hold");
    expect(!res.ok && res.code).toBe("INVALID_TRANSITION");
  });

  it("tuyến không tồn tại → LINE_NOT_FOUND", async () => {
    const res = await executeLineCommand(404, "start");
    expect(!res.ok && res.code).toBe("LINE_NOT_FOUND");
  });
});

// ═══ Sweep — quan sát (Chương 5, v1) ═════════════════════════════════════════

describe("sweep — quan sát nhịp + auto-fault", () => {
  it("máy operationStatus=error khi line producing → auto transition fault (actor system)", async () => {
    seedLine(1, "producing");
    h.db.machinesByLine.set(1, [
      { id: 5, code: "M-5", operationStatus: "error", lifecycleStatus: "active", stationId: 1 },
      { id: 6, code: "M-6", operationStatus: "running", lifecycleStatus: "active", stationId: 2 },
    ]);
    const stats = await runLineControllerSweepOnce();
    expect(stats.faultTransitions).toBe(1);
    expect(h.db.states.get(1).state).toBe("fault");
    const row = h.db.transitions.at(-1);
    expect(row.triggeredBy).toBe("system");
    expect(row.toState).toBe("fault");
    expect(row.reason).toContain("M-5");
  });

  it("line KHÔNG producing thì bỏ qua (kể cả máy lỗi)", async () => {
    seedLine(1, "idle");
    h.db.machinesByLine.set(1, [{ id: 5, code: "M-5", operationStatus: "error", lifecycleStatus: "active" }]);
    const stats = await runLineControllerSweepOnce();
    expect(stats.faultTransitions).toBe(0);
    expect(h.db.states.get(1).state).toBe("idle");
  });

  it("blocking kéo dài vượt ngưỡng → event + Andon routeAlert; sweep kế trong cooldown KHÔNG lặp", async () => {
    seedLine(1, "producing");
    h.db.machinesByLine.set(1, [{ id: 6, code: "M-6", operationStatus: "running", lifecycleStatus: "active" }]);
    h.dwell = [{ stationId: 9, avgDwellMs: 200_000, avgStarvedMs: 0, avgBlockedMs: 200_000, samples: 12 }];
    const s1 = await runLineControllerSweepOnce();
    expect(s1.stallAlerts).toBe(1);
    expect(vi.mocked(routeAlert)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(routeAlert).mock.calls[0][0]).toMatchObject({ type: "PATTERN_ANOMALY", severity: "HIGH" });
    const ev = getLineControllerStatus().recentEvents.find((e) => e.kind === "blocking");
    expect(ev?.lineId).toBe(1);

    const s2 = await runLineControllerSweepOnce();
    expect(s2.stallAlerts).toBe(0); // cooldown
    expect(vi.mocked(routeAlert)).toHaveBeenCalledTimes(1);
  });

  it("starving dưới ngưỡng → không cảnh báo", async () => {
    seedLine(1, "producing");
    h.db.machinesByLine.set(1, [{ id: 6, code: "M-6", operationStatus: "running", lifecycleStatus: "active" }]);
    h.dwell = [{ stationId: 9, avgDwellMs: 1_000, avgStarvedMs: 5_000, avgBlockedMs: 0, samples: 3 }];
    const stats = await runLineControllerSweepOnce();
    expect(stats.stallAlerts).toBe(0);
    expect(vi.mocked(routeAlert)).not.toHaveBeenCalled();
  });

  it("bottleneck đổi giữa hai lượt → event bottleneck_change (lượt đầu chỉ seed)", async () => {
    seedLine(1, "producing");
    h.db.machinesByLine.set(1, [{ id: 6, code: "M-6", operationStatus: "running", lifecycleStatus: "active" }]);
    h.balance = { bottleneckMachineId: 5 };
    const s1 = await runLineControllerSweepOnce();
    expect(s1.bottleneckChanges).toBe(0); // baseline

    h.balance = { bottleneckMachineId: 7 };
    const s2 = await runLineControllerSweepOnce();
    expect(s2.bottleneckChanges).toBe(1);
    const ev = getLineControllerStatus().recentEvents.find((e) => e.kind === "bottleneck_change");
    expect(ev?.detail).toContain("5");
    expect(ev?.detail).toContain("7");
  });
});
