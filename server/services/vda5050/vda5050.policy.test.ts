/**
 * W3-B2 (doc 44 G3.14 — "một cửa duy nhất") — fleet-level policy seam trong
 * Vda5050Adapter.sendOrder. Scaffolding = vda5050.test.ts (mock db/robotManager/mqtt);
 * policyGate được mock để chứng minh WIRING (engine đã có policyEvaluate.test.ts).
 *
 * Chứng minh:
 *   - SEC_PLATFORM OFF → dry-run 'simulated' như cũ, evaluateActionPolicy KHÔNG được gọi.
 *   - ON + DENY → KHÔNG dispatch, KHÔNG publish MQTT, ledger robot_jobs 'rejected'
 *     với errorText POLICY_DENIED (append-only), Order JSON vẫn trả về để inspect.
 *   - ON + require_approval → rejected POLICY_APPROVAL_REQUIRED honest, không publish.
 *   - ON + PERMIT (+ control enabled) → đi tiếp nguyên vẹn: dispatch → publish → done.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── DB mock: bắt mọi insert (ledger) ─────────────────────────────────────────
const inserts: Array<{ table: any; values: any }> = [];

function makeDbMock() {
  return {
    insert: (table: any) => ({
      values: (v: any) => {
        inserts.push({ table, values: v });
        const p: any = Promise.resolve();
        p.returning = () => Promise.resolve([{ id: 777 }]);
        return p;
      },
    }),
    update: (_table: any) => ({ set: (_v: any) => ({ where: () => Promise.resolve() }) }),
    select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }) }),
  };
}
vi.mock("../../db/connection", () => ({ getDb: vi.fn(async () => makeDbMock()) }));

// ── robotManager mock: robot 42 active + connected ───────────────────────────
const runJobSpy = vi.fn(async () => ({ ok: true, status: "done" as const, detail: { published: true } }));
vi.mock("../robot/robotManager", () => ({
  getActiveRobot: vi.fn((id: number) =>
    id === 42 ? { id: 42, code: "ACME:AGV-001", driver: { isConnected: () => true, runJob: runJobSpy } } : undefined,
  ),
}));

// ── fake mqtt client (bắt publish) ───────────────────────────────────────────
const publishes: Array<{ topic: string; payload: string }> = [];
function makeFakeClient() {
  return {
    handlers: {} as Record<string, (...a: any[]) => void>,
    on(ev: string, cb: (...a: any[]) => void) {
      this.handlers[ev] = cb;
    },
    subscribe() {},
    publish(topic: string, payload: string, _opts: any, cb?: (e?: Error | null) => void) {
      publishes.push({ topic, payload });
      cb?.(null);
    },
    end(_f?: boolean, _o?: unknown, cb?: () => void) {
      cb?.();
    },
    connected: true,
  };
}
let fakeClient: ReturnType<typeof makeFakeClient>;
vi.mock("mqtt", () => ({
  connect: vi.fn(() => {
    fakeClient = makeFakeClient();
    return fakeClient;
  }),
}));

// ── policy seam mock ─────────────────────────────────────────────────────────
const policyMock = vi.hoisted(() => ({
  secPlatformEnabled: vi.fn((): boolean => false),
  evaluateActionPolicy: vi.fn(() => ({
    allow: true,
    effect: "allow" as const,
    reason: "no matching policy",
    policyId: null as string | null,
    reasonCode: "DEFAULT_ALLOW",
    obligations: [] as string[],
  })),
}));
vi.mock("../security/policyGate", () => policyMock);

async function makeStartedAdapter() {
  const { Vda5050Adapter } = await import("./vda5050Adapter");
  const adapter = new Vda5050Adapter({
    robotId: 42,
    code: "ACME:AGV-001",
    manufacturer: "ACME",
    serialNumber: "AGV-001",
    interfaceName: "uagv",
    brokerUrl: "mqtt://127.0.0.1:1883",
  });
  await adapter.start();
  fakeClient.handlers["connect"]?.();
  return adapter;
}

beforeEach(() => {
  inserts.length = 0;
  publishes.length = 0;
  vi.clearAllMocks();
  policyMock.secPlatformEnabled.mockReturnValue(false);
  policyMock.evaluateActionPolicy.mockReturnValue({
    allow: true,
    effect: "allow",
    reason: "no matching policy",
    policyId: null,
    reasonCode: "DEFAULT_ALLOW",
    obligations: [],
  });
  delete process.env.ROBOT_CONTROL_ENABLED;
  process.env.ROBOT_COMMISSIONING_REQUIRED = "false"; // cô lập gate FAT (như vda5050.test.ts)
});
afterEach(() => {
  delete process.env.ROBOT_CONTROL_ENABLED;
  delete process.env.ROBOT_COMMISSIONING_REQUIRED;
});

const ORDER_OPTS = {
  nodes: [{ nodeId: "t", x: 1, y: 2, mapId: "m" }],
  orderId: "ord-pol-1",
  requestedBy: 1,
  confirmedBy: 1,
};

describe("VDA5050 sendOrder — fleet policy seam (W3-B2 G3.14)", () => {
  it("SEC_PLATFORM OFF → dry-run 'simulated' như cũ, evaluateActionPolicy KHÔNG được gọi (bit-compat)", async () => {
    const adapter = await makeStartedAdapter();
    const res = await adapter.sendOrder(ORDER_OPTS);
    expect(res.status).toBe("simulated");
    expect(res.published).toBe(false);
    expect(publishes.length).toBe(0);
    expect(policyMock.evaluateActionPolicy).not.toHaveBeenCalled();
  });

  it("ON + DENY → không dispatch, không publish, ledger robot_jobs 'rejected' POLICY_DENIED", async () => {
    policyMock.secPlatformEnabled.mockReturnValue(true);
    policyMock.evaluateActionPolicy.mockReturnValue({
      allow: false,
      effect: "deny",
      reason: "fleet order bị cấm theo policy F",
      policyId: "deny-fleet-f",
      reasonCode: "POLICY_DENIED",
      obligations: [],
    });
    process.env.ROBOT_CONTROL_ENABLED = "true"; // dù control BẬT, DENY vẫn chặn trước publish
    const adapter = await makeStartedAdapter();
    const res = await adapter.sendOrder(ORDER_OPTS);

    expect(res.status).toBe("rejected");
    expect(res.ok).toBe(false);
    expect(res.error).toBe("POLICY_DENIED");
    expect(res.published).toBe(false);
    expect(res.order).toBeDefined(); // Order JSON vẫn trả về để inspect (honest)
    expect(res.jobId).toBe(777);
    expect(publishes.length).toBe(0); // KHÔNG publish MQTT
    expect(runJobSpy).not.toHaveBeenCalled(); // KHÔNG tới dispatcher/driver
    // Đúng 1 insert duy nhất = ledger row rejected (dispatcher không chạy nên không có row khác).
    expect(inserts).toHaveLength(1);
    expect(inserts[0].values).toMatchObject({
      robotId: 42,
      jobType: "move",
      status: "rejected",
      requestedBy: 1,
      confirmedBy: 1,
    });
    expect(inserts[0].values.errorText).toMatch(/^POLICY_DENIED: /);
    expect(inserts[0].values.errorText).toContain("deny-fleet-f");
    expect(inserts[0].values.params).toMatchObject({ vda5050: "order", orderId: "ord-pol-1", nodesCount: 1 });

    // Chuẩn seam: action/resource/context.
    const [subject, action, resource, context] = policyMock.evaluateActionPolicy.mock.calls[0] as any[];
    expect(subject).toBe("user:1");
    expect(action).toBe("fleet.vda5050.send_order");
    expect(resource).toBe("robot:42");
    expect(context).toMatchObject({ robotId: 42, orderId: "ord-pol-1", nodesCount: 1, triggerKind: "hitl" });
  });

  it("ON + require_approval → rejected POLICY_APPROVAL_REQUIRED honest, không publish", async () => {
    policyMock.secPlatformEnabled.mockReturnValue(true);
    policyMock.evaluateActionPolicy.mockReturnValue({
      allow: false,
      effect: "require_approval",
      reason: "cần phê duyệt fleet",
      policyId: "approve-fleet",
      reasonCode: "APPROVAL_REQUIRED",
      obligations: ["require_approval"],
    });
    const adapter = await makeStartedAdapter();
    const res = await adapter.sendOrder(ORDER_OPTS);
    expect(res.status).toBe("rejected");
    expect(res.error).toBe("POLICY_APPROVAL_REQUIRED");
    expect(res.published).toBe(false);
    expect(publishes.length).toBe(0);
    expect(inserts[0]?.values?.errorText).toMatch(/^POLICY_APPROVAL_REQUIRED: /);
  });

  it("ON + PERMIT + control enabled → đi tiếp nguyên vẹn: dispatch → publish → done", async () => {
    policyMock.secPlatformEnabled.mockReturnValue(true);
    process.env.ROBOT_CONTROL_ENABLED = "true";
    const adapter = await makeStartedAdapter();
    const res = await adapter.sendOrder(ORDER_OPTS);
    expect(res.status).toBe("done");
    expect(res.published).toBe(true);
    expect(publishes.length).toBe(1);
    expect(publishes[0].topic).toBe("uagv/v2/ACME/AGV-001/order");
    expect(runJobSpy).toHaveBeenCalledTimes(1);
  });
});
