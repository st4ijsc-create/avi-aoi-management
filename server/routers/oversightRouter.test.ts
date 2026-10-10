/**
 * Doc 80 Đợt 1 Task 2 (HUB-01 / HUB-02 / ILK-06) — Hub trung thực.
 *
 * ĐO TRỰC TIẾP từng nhánh (`_internal.fetch*`) thay vì lắp toàn bộ drizzle thật: mỗi
 * nhánh là MỘT try/catch độc lập trên một bảng khác nhau — lưới đúng bài là "mỗi
 * nhánh trả count đúng khi khỏe, degraded khi ném, và tôn trọng cờ showNames" — không
 * cần dựng CSDL thật để chứng minh điều đó. Đối chứng tích hợp (createCaller, admin —
 * bỏ qua bảng `permissions`) canh: DB rớt → shape 0 ổn định; tổng = tổng chín nhánh.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const detectDeadlocksMock = vi.fn(async () => ({ enabled: true, cycles: [] as number[][] }));
vi.mock("../services/fleet/trafficManager", () => ({
  detectDeadlocks: (...a: unknown[]) => detectDeadlocksMock(...a),
}));

const mockGetDb = vi.fn(async () => undefined as unknown);
vi.mock("../db/connection", () => ({ getDb: (...a: unknown[]) => mockGetDb(...a) }));

// Fix round 1 (doc 80 Đợt 1 Task 2) — mock CHỈ `checkPermission` (giữ nguyên
// `requirePermission` thật qua `importOriginal`). `requirePermission`'s middleware gọi
// `checkPermission` qua CLOSURE nội bộ của chính `accessControl.ts` — KHÔNG đi qua mock
// này (mock chỉ thay named export mà `oversightRouter.ts` tự `import`) — nên gate
// `machine_monitoring` vẫn chạy checkPermission THẬT (admin bypass, không chạm DB) trong
// khi `canSeeNamesSafe` (dùng `checkPermission` NHẬP TỪ NGOÀI) nhận đúng bản mock.
const checkPermissionMock = vi.fn(async () => true);
vi.mock("../_core/accessControl", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../_core/accessControl")>();
  return { ...actual, checkPermission: (...a: Parameters<typeof actual.checkPermission>) => checkPermissionMock(...a) };
});

import { oversightRouter, _internal } from "./oversightRouter";

/**
 * Chuỗi drizzle giả: `.select().from().where()...` đều trả về CHÍNH nó; `.then()` trả
 * PHẦN TỬ KẾ TIẾP của `queue` theo đúng THỨ TỰ mỗi nhánh await (đếm trước, mẫu sau).
 * Một `Error` trong hàng đợi ⇒ `.then()` reject đúng lỗi đó (mô phỏng query ném).
 */
function fakeDb(queue: unknown[]): { db: any; calls: () => number } {
  let i = 0;
  const chain: any = {
    select: () => chain,
    from: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: () => chain,
    leftJoin: () => chain,
    then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) => {
      const v = queue[i++];
      if (v instanceof Error) reject?.(v);
      else resolve(v);
    },
  };
  // `root` KHÔNG mang `.then` — dùng làm giá trị `await getDb()` (qua `mockResolvedValue`)
  // AN TOÀN: một đối tượng CÓ `.then` đặt làm giá trị resolve của một Promise (kể cả qua
  // `mockResolvedValue`/return của async fn) bị coi là THENABLE và bị "đuổi theo"
  // (chained) ngay lập tức — nuốt mất phần tử ĐẦU của hàng đợi trước khi `.select()` được
  // gọi. `chain` (có `.then`) chỉ lộ diện SAU `root.select()`, đúng hình dạng drizzle thật
  // (root `db` không thenable; CHỈ query builder trả về từ `.select()` mới thenable).
  const root: any = { select: () => chain };
  return { db: root, calls: () => i };
}

beforeEach(() => {
  mockGetDb.mockReset();
  mockGetDb.mockResolvedValue(undefined);
  detectDeadlocksMock.mockReset();
  detectDeadlocksMock.mockResolvedValue({ enabled: true, cycles: [] });
  checkPermissionMock.mockReset();
  checkPermissionMock.mockResolvedValue(true);
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("oversightRouter._internal — mỗi nhánh KHOẺ + showNames", () => {
  it("fetchRecipesDraftPending: đếm đúng + mẫu khi showNames=true", async () => {
    const { db } = fakeDb([
      [{ c: 2 }],
      [{ id: 1, code: "SEED-RCP", name: "Cai dat A", version: 3 }],
    ]);
    const r = await _internal.fetchRecipesDraftPending(db, true);
    expect(r).toEqual({
      count: 2,
      degraded: false,
      samples: [{ id: 1, label: "SEED-RCP · Cai dat A", hint: "v3" }],
    });
  });

  it("fetchRecipesDraftPending: showNames=false ⇒ đếm đúng, KHÔNG gọi truy vấn mẫu", async () => {
    const { db, calls } = fakeDb([[{ c: 5 }]]);
    const r = await _internal.fetchRecipesDraftPending(db, false);
    expect(r).toEqual({ count: 5, degraded: false, samples: [] });
    expect(calls()).toBe(1); // đúng MỘT lượt đọc — không rò tên qua lượt thứ hai
  });

  it("fetchRecipesActiveUnapproved (RCP-06/HUB-02) — recipe ĐANG CHẠY mà CHƯA duyệt", async () => {
    const { db } = fakeDb([
      [{ c: 1 }],
      [{ id: 9, code: "SCRW-RECIPE-01", name: "Vit May 243", version: 2, machineId: 243 }],
    ]);
    const r = await _internal.fetchRecipesActiveUnapproved(db, true);
    expect(r.count).toBe(1);
    expect(r.samples).toEqual([{ id: 9, label: "SCRW-RECIPE-01 · Vit May 243", hint: "v2 · #243" }]);
  });

  it("fetchInterlockRulesPending: đếm + mẫu khi showNames=true", async () => {
    const { db } = fakeDb([[{ c: 1 }], [{ id: 4, name: "NG cao L1", action: "alert" }]]);
    const r = await _internal.fetchInterlockRulesPending(db, true);
    expect(r).toEqual({ count: 1, degraded: false, samples: [{ id: 4, label: "NG cao L1", hint: "alert" }] });
  });

  it("fetchInterlockEventsOpen (mới, chưa resolve) — resolvedAt IS NULL", async () => {
    const { db } = fakeDb([[{ c: 1 }], [{ id: 7, ruleId: 4, status: "fired", action: "alert" }]]);
    const r = await _internal.fetchInterlockEventsOpen(db, true);
    expect(r.count).toBe(1);
    expect(r.samples).toEqual([{ id: 7, label: "Rule #4", hint: "fired" }]);
  });

  it("fetchInterlockEventsOpen: showNames=false ⇒ chỉ đếm", async () => {
    const { db, calls } = fakeDb([[{ c: 3 }]]);
    const r = await _internal.fetchInterlockEventsOpen(db, false);
    expect(r).toEqual({ count: 3, degraded: false, samples: [] });
    expect(calls()).toBe(1);
  });

  it("fetchEcnPending (mới) — submitted | in_review", async () => {
    const { db } = fakeDb([
      [{ c: 1 }],
      [{ id: 3, ecnKey: "SEED-ECN-0003", title: "Tang nguong NG AOI L1", status: "in_review" }],
    ]);
    const r = await _internal.fetchEcnPending(db, true);
    expect(r.count).toBe(1);
    expect(r.samples).toEqual([{ id: 3, label: "SEED-ECN-0003 · Tang nguong NG AOI L1", hint: "in_review" }]);
  });

  it("fetchEcnPending: showNames=false ⇒ chỉ đếm, không lộ tiêu đề ECN", async () => {
    const { db, calls } = fakeDb([[{ c: 1 }]]);
    const r = await _internal.fetchEcnPending(db, false);
    expect(r).toEqual({ count: 1, degraded: false, samples: [] });
    expect(calls()).toBe(1);
  });

  it("fetchChangeoverPending (mới, 'deployment chờ duyệt') — status='pending'", async () => {
    const { db } = fakeDb([
      [{ c: 1 }],
      [{ id: 5, machineName: "AOI-L1-02", machineCode: "AOI-L1-02", recipeCode: "SEED-RCP-AOI-L1", recipeVersion: 2 }],
    ]);
    const r = await _internal.fetchChangeoverPending(db, true);
    expect(r.count).toBe(1);
    expect(r.samples).toEqual([{ id: 5, label: "AOI-L1-02", hint: "SEED-RCP-AOI-L1 v2" }]);
  });

  it("fetchOrchestrationHeld / fetchSafetyUnaudited — hành vi KHÔNG đổi (không có showNames)", async () => {
    const orch = fakeDb([[{ c: 1 }], [{ id: 1, workflowRef: "wf-1", status: "held", currentStepId: "s1" }]]);
    const rOrch = await _internal.fetchOrchestrationHeld(orch.db, null /* Đợt 5 E fix 1: null = unrestricted scope */);
    expect(rOrch.samples).toEqual([{ id: 1, label: "wf-1", hint: "held · s1" }]);

    const safety = fakeDb([[{ c: 1 }], [{ id: 2, eventType: "near_miss", isNearMiss: true, createdAt: new Date() }]]);
    const rSafety = await _internal.fetchSafetyUnaudited(safety.db);
    expect(rSafety.samples).toEqual([{ id: 2, label: "near_miss", hint: "near-miss" }]);
  });

  it("fetchDeadlocks — cycles từ trafficManager", async () => {
    detectDeadlocksMock.mockResolvedValueOnce({ enabled: true, cycles: [[1, 2, 1]] });
    const r = await _internal.fetchDeadlocks();
    expect(r).toEqual({ count: 1, degraded: false, samples: [{ id: 0, label: "cycle #1", hint: "1 → 2 → 1" }] });
  });

  it("fetchInterlockCoverage (posture/ILK-06) — enabled + có đích (targetMachineId/targetAdapterId)", async () => {
    const { db } = fakeDb([[{ c: 2 }]]);
    const r = await _internal.fetchInterlockCoverage(db);
    expect(r).toEqual({ count: 2, degraded: false });
  });

  it("fetchInterlockCoverage — DB null ⇒ degraded, KHÔNG throw", async () => {
    const r = await _internal.fetchInterlockCoverage(null);
    expect(r).toEqual({ count: 0, degraded: true });
  });
});

describe("oversightRouter._internal — MỖI NHÁNH degraded khi query ném (HUB-01/HUB-02)", () => {
  const cases: Array<[string, (db: any) => Promise<{ count: number; degraded: boolean }>]> = [
    ["fetchRecipesDraftPending", (db) => _internal.fetchRecipesDraftPending(db, true)],
    ["fetchRecipesActiveUnapproved", (db) => _internal.fetchRecipesActiveUnapproved(db, true)],
    ["fetchInterlockRulesPending", (db) => _internal.fetchInterlockRulesPending(db, true)],
    ["fetchInterlockEventsOpen", (db) => _internal.fetchInterlockEventsOpen(db, true)],
    ["fetchOrchestrationHeld", (db) => _internal.fetchOrchestrationHeld(db, null)],
    ["fetchSafetyUnaudited", (db) => _internal.fetchSafetyUnaudited(db)],
    ["fetchEcnPending", (db) => _internal.fetchEcnPending(db, true)],
    ["fetchChangeoverPending", (db) => _internal.fetchChangeoverPending(db, true)],
  ];

  for (const [name, run] of cases) {
    it(`${name}: nguồn ném lỗi ⇒ { count:0, degraded:true }, KHÔNG throw ra ngoài`, async () => {
      const { db } = fakeDb([new Error(`${name} boom`)]);
      const r = await run(db);
      expect(r.count).toBe(0);
      expect(r.degraded).toBe(true);
    });
  }

  it("fetchDeadlocks: trafficManager ném ⇒ degraded, KHÔNG throw", async () => {
    detectDeadlocksMock.mockRejectedValueOnce(new Error("deadlock boom"));
    const r = await _internal.fetchDeadlocks();
    expect(r).toEqual({ count: 0, degraded: true, samples: [] });
  });

  it("fetchInterlockCoverage: query ném ⇒ degraded, KHÔNG throw", async () => {
    const { db } = fakeDb([new Error("coverage boom")]);
    const r = await _internal.fetchInterlockCoverage(db);
    expect(r).toEqual({ count: 0, degraded: true });
  });

  // Fix round 1 (doc 80 Đợt 1 Task 2, finding #2) — `checkPermission` (dùng để quyết định
  // showNames) từng nằm NGOÀI try/catch trong `pendingSummary`: nó ném là CẢ chín nhánh mất
  // theo, mâu thuẫn với chính lời khai "không nhánh nào được làm vỡ cả query" của file này.
  it("canSeeNamesSafe: checkPermission ném ⇒ trả false (ẩn tên), KHÔNG throw ra ngoài", async () => {
    checkPermissionMock.mockRejectedValueOnce(new Error("permissions table down"));
    const r = await _internal.canSeeNamesSafe(1, "operator", "machine_control");
    expect(r).toBe(false);
  });

  it("canSeeNamesSafe: checkPermission khoẻ ⇒ trả đúng giá trị của nó", async () => {
    checkPermissionMock.mockResolvedValueOnce(true);
    expect(await _internal.canSeeNamesSafe(1, "operator", "machine_control")).toBe(true);
    checkPermissionMock.mockResolvedValueOnce(false);
    expect(await _internal.canSeeNamesSafe(1, "operator", "machine_control")).toBe(false);
  });
});

describe("oversightRouter.pendingSummary (createCaller, admin — bỏ qua bảng permissions)", () => {
  const admin = () => ({ user: { id: 1, role: "admin" } }) as never;

  it("DB chưa kết nối ⇒ shape 0 ổn định cho ĐỦ chín nhánh, không throw", async () => {
    mockGetDb.mockResolvedValue(undefined);
    const caller = oversightRouter.createCaller(admin());
    const r = await caller.pendingSummary();
    expect(r.total).toBe(0);
    for (const key of [
      "recipes", "recipeActiveUnapproved", "interlock", "interlockEventsOpen",
      "orchestration", "safety", "deadlocks", "ecn", "changeover",
    ] as const) {
      expect(r[key]).toEqual({ count: 0, samples: [], degraded: false });
    }
  });

  // Fix round 1 (doc 80 Đợt 1 Task 2, finding #2) — đo ở TẦNG TÍCH HỢP (qua `createCaller`,
  // không chỉ `canSeeNamesSafe` đơn vị): `checkPermission` ném KHÔNG được làm vỡ cả chín
  // nhánh. `d` KHÔNG null lần này (mọi `.then()` trả cùng MỘT đáp án an toàn `[{c:0}]` —
  // đủ cho cả truy vấn đếm lẫn truy vấn mẫu vì mọi nhánh cần tên đều bị ẩn nên KHÔNG chạy
  // lượt đọc mẫu thứ hai; hai nhánh orchestration/safety luôn đọc mẫu nhưng không phụ thuộc
  // `checkPermission`, và một hàng `{c:0}` không làm `.map(...)` của chúng throw).
  it("checkPermission ném (Fix round 1) ⇒ VẪN trả đủ chín nhánh (không throw), samples rỗng ở nhánh cần tên", async () => {
    checkPermissionMock.mockRejectedValue(new Error("permissions table down"));
    const safeAnswer = [{ c: 0 }];
    mockGetDb.mockResolvedValue(fakeDb(new Array(12).fill(safeAnswer)).db);
    const caller = oversightRouter.createCaller(admin());
    const r = await caller.pendingSummary();
    expect(r.total).toBe(0);
    // Nhánh cần tên (machine_control/interlock) — checkPermission ném ⇒ showNames=false ⇒
    // samples RỖNG, KHÔNG phải degraded (đếm vẫn thành công, chỉ tên bị ẩn).
    for (const key of ["recipes", "recipeActiveUnapproved", "interlock", "interlockEventsOpen", "ecn", "changeover"] as const) {
      expect(r[key].samples, `${key}.samples phải rỗng khi checkPermission ném`).toEqual([]);
      expect(r[key].degraded, `${key}.degraded phải false — đây là ẩn tên, không phải lỗi nguồn`).toBe(false);
    }
  });
});

describe("doc 81 Đợt 3 Task 4 — pendingSummary.mine (fail-safe + luật tên)", () => {
  const admin = () => ({ user: { id: 1, role: "admin" } }) as never;
  const MINE_KEYS = ["ecn", "recipes", "interlock", "changeover", "orchestration"];

  it("DB chưa kết nối ⇒ `mine` có ĐÚNG năm nhóm giao được, mỗi nhóm 0 — không throw", async () => {
    mockGetDb.mockResolvedValue(undefined);
    const r = await oversightRouter.createCaller(admin()).pendingSummary();
    expect(Object.keys(r.mine).sort()).toEqual([...MINE_KEYS].sort());
    for (const k of MINE_KEYS) expect(r.mine[k as keyof typeof r.mine]).toEqual({ count: 0, samples: [], degraded: false });
  });

  it("nguồn phân công ném (vd bảng 0363 chưa áp) ⇒ `mine` degraded từng nhóm, chín nhánh cũ KHÔNG đổi, total KHÔNG cộng mine", async () => {
    // fakeDb không có innerJoin ⇒ mọi truy vấn "Của tôi" ném TypeError — đúng hình dạng "nguồn hỏng".
    mockGetDb.mockResolvedValue(fakeDb(new Array(20).fill([{ c: 0 }])).db);
    const r = await oversightRouter.createCaller(admin()).pendingSummary();
    for (const k of MINE_KEYS) expect(r.mine[k as keyof typeof r.mine]).toMatchObject({ count: 0, degraded: true });
    for (const key of ["recipes", "interlock", "orchestration", "ecn", "changeover"] as const) expect(r[key].degraded).toBe(false);
    expect(r.total).toBe(0);
  });
});

describe("oversightRouter.posture (ILK-06)", () => {
  const admin = () => ({ user: { id: 1, role: "admin" } }) as never;
  const ENV_KEYS = [
    "OT_CONTROL_ENABLED", "ROBOT_CONTROL_ENABLED", "DPC_DEPLOY_ENABLED",
    "INTERLOCK_ENGINE_ENABLED", "INTERLOCK_AUTO_BLOCK_ENABLED",
  ] as const;
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ENV_KEYS) { savedEnv[k] = process.env[k]; delete process.env[k]; }
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  it("ILK-06 — OT_CONTROL_ENABLED=true và engine interlock TẮT ⇒ writesOnEngineOff=true", async () => {
    process.env.OT_CONTROL_ENABLED = "true";
    mockGetDb.mockResolvedValue(fakeDb([[{ c: 0 }]]).db);
    const r = await oversightRouter.createCaller(admin()).posture();
    expect(r.otControlEnabled).toBe(true);
    expect(r.interlockEngineEnabled).toBe(false);
    expect(r.writesOnEngineOff).toBe(true);
  });

  it("engine interlock BẬT ⇒ writesOnEngineOff=false dù OT_CONTROL_ENABLED=true", async () => {
    process.env.OT_CONTROL_ENABLED = "true";
    process.env.INTERLOCK_ENGINE_ENABLED = "true";
    mockGetDb.mockResolvedValue(fakeDb([[{ c: 1 }]]).db);
    const r = await oversightRouter.createCaller(admin()).posture();
    expect(r.writesOnEngineOff).toBe(false);
    expect(r.interlockRulesEnabledWithTarget).toBe(1);
  });

  it("không ghi lệnh thật nào BẬT ⇒ writesOnEngineOff=false kể cả engine TẮT", async () => {
    mockGetDb.mockResolvedValue(fakeDb([[{ c: 0 }]]).db);
    const r = await oversightRouter.createCaller(admin()).posture();
    expect(r.writesOnEngineOff).toBe(false);
  });
});

// Doc 80 Đợt 1 final wave (item 5) — bảng tư thế KHÔNG tự parse env: mỗi ô == đúng vị từ của cổng thật.
// Lật từng biến qua các giá trị hay gặp ("1", "TRUE", "yes"…): nếu một bên nhận "1" mà bên kia không, ô đó
// khác cổng ⇒ ĐỎ. Hôm nay `dpcDeployEnabled` nhận cả "1"; bốn cờ kia chỉ nhận "true" — bảng phải nói y vậy.
import { isOtControlEnabled, isInterlockAutoBlockEnabled } from "../services/ot/commandDispatcher";
import { isRobotControlEnabled } from "../services/robot/robotCommandDispatcher";
import { dpcDeployEnabled } from "../services/programming/programmingService";
import { isInterlockEngineEnabled } from "../services/interlock/interlockEngine";

describe("final wave item 5 — posture == cổng thật cho MỌI giá trị env", () => {
  const admin = () => ({ user: { id: 1, role: "admin" } }) as never;
  const CO = [
    { env: "OT_CONTROL_ENABLED", o: "otControlEnabled", cong: isOtControlEnabled },
    { env: "ROBOT_CONTROL_ENABLED", o: "robotControlEnabled", cong: isRobotControlEnabled },
    { env: "DPC_DEPLOY_ENABLED", o: "dpcDeployEnabled", cong: dpcDeployEnabled },
    { env: "INTERLOCK_ENGINE_ENABLED", o: "interlockEngineEnabled", cong: isInterlockEngineEnabled },
    { env: "INTERLOCK_AUTO_BLOCK_ENABLED", o: "interlockAutoBlockEnabled", cong: isInterlockAutoBlockEnabled },
  ] as const;
  const GIA_TRI = ["true", "1", "TRUE", "yes", "false", "0", "", undefined] as const;
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const c of CO) { savedEnv[c.env] = process.env[c.env]; delete process.env[c.env]; }
    mockGetDb.mockResolvedValue(fakeDb([[{ c: 0 }]]).db);
  });
  afterEach(() => {
    for (const c of CO) {
      if (savedEnv[c.env] === undefined) delete process.env[c.env];
      else process.env[c.env] = savedEnv[c.env];
    }
  });

  for (const c of CO) {
    it(`${c.env}: bảng == cổng qua ${GIA_TRI.length} giá trị (kể cả "1")`, async () => {
      const lech: string[] = [];
      let soBat = 0;
      for (const v of GIA_TRI) {
        if (v === undefined) delete process.env[c.env];
        else process.env[c.env] = v;
        const cong = c.cong();
        const bang = (await oversightRouter.createCaller(admin()).posture())[c.o];
        if (cong) soBat++;
        if (bang !== cong) lech.push(`${c.env}=${JSON.stringify(v)}: bảng=${bang} cổng=${cong}`);
      }
      expect(lech).toEqual([]);
      // Cầu chì: vị từ phải bật ít nhất một lần trong dãy, không thì phép so trên đúng một cách vô nghĩa.
      expect(soBat).toBeGreaterThan(0);
    });
  }

  it("★ đối chứng ĐỌC: `dpcDeployEnabled` nhận \"1\" còn `isOtControlEnabled` thì không — bảng phản ánh đúng sự khác ấy", async () => {
    process.env.DPC_DEPLOY_ENABLED = "1";
    process.env.OT_CONTROL_ENABLED = "1";
    const r = await oversightRouter.createCaller(admin()).posture();
    expect(r.dpcDeployEnabled).toBe(true);
    expect(r.otControlEnabled).toBe(false);
  });
});
