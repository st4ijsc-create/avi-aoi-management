/**
 * doc 44 W3-A2 / G3.1 — /api/v1/lines route tests.
 *
 * Covers: scope-gated auth (no key → 401, machine key thiếu scope → 403,
 * master key wildcard → 200), envelope `{ ok, data?, error? }`, 400 id xấu /
 * command lạ, 404 tuyến không tồn tại, và mapping TransitionResult thất bại →
 * HTTP (INVALID_TRANSITION 400 + allowed, NOT_READY 409 + checks,
 * POLICY_DENIED 403, CONFLICT 409, DB_UNAVAILABLE 503). Chạy trên Express app
 * thật + cổng ephemeral với global fetch (mirrors moduleReads.test.ts — no supertest).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import { type AddressInfo } from "node:net";

const h = vi.hoisted(() => ({
  commandResult: null as any,
}));

// ── auth chain mocks (mirrors moduleReads.test.ts) ───────────────────────────
vi.mock("../../_core/masterKey", () => ({
  isValidMasterKey: (k: string | undefined | null) => k === "MASTER",
  isMasterKeyConfigured: () => true,
}));

vi.mock("../../db", () => ({
  getDb: vi.fn(async () => null),
  getMachineByApiKey: vi.fn(async (k: string) => (k === "MACHINE_KEY" ? { id: 1, code: "AOI-01" } : undefined)),
}));

// ── line controller service mock ─────────────────────────────────────────────
vi.mock("../../services/lineController/lineControllerService", () => ({
  LINE_COMMANDS: ["start", "hold", "resume", "changeover", "complete", "reset_fault"],
  listLinesWithState: vi.fn(async () => [
    {
      lineId: 1,
      code: "L-A",
      name: "Line A",
      workshopId: 1,
      state: "producing",
      heldReason: null,
      recipeSetRef: "MODEL-X@v3",
      activeOrderId: null,
      taktTargetS: 42,
      enteredAt: "2026-07-12T00:00:00.000Z",
      updatedAt: "2026-07-12T00:00:00.000Z",
    },
  ]),
  getLineStateDetail: vi.fn(async (id: number) =>
    id === 1
      ? {
          lineId: 1,
          code: "L-A",
          name: "Line A",
          state: "producing",
          heldReason: null,
          recipeSetRef: "MODEL-X@v3",
          activeOrderId: null,
          taktTargetS: 42,
          enteredAt: "2026-07-12T00:00:00.000Z",
          takt: { taktTimeMs: 42000, avgCycleTimeMs: 40000, maxCycleTimeMs: 45000, throughputUnits: 78, utilizationPct: 91.5, periodStart: "", periodEnd: "" },
          bottleneck: { stationId: 9, machineId: 5 },
          readiness: { lineId: 1, ready: true, checks: [], checkedAt: "2026-07-12T00:00:00.000Z" },
          recentTransitions: [],
        }
      : null,
  ),
  getLineStages: vi.fn(async (id: number) =>
    id === 1
      ? {
          lineId: 1,
          windowFrom: "",
          windowTo: "",
          stallThresholdMs: 120000,
          stages: [
            {
              stationId: 9,
              code: "ST-1",
              name: "Screw",
              orderIndex: 1,
              cycleTimeTargetS: 40,
              dwell: { avgDwellMs: 40000, avgStarvedMs: 0, avgBlockedMs: 0, samples: 12 },
              blocked: false,
              starved: false,
              machines: [
                { id: 5, code: "M-5", name: "Screw01", machineType: "AUTOMATION", operationStatus: "running", opState: "EXECUTE", presence: "online" },
              ],
            },
          ],
        }
      : null,
  ),
  executeLineCommand: vi.fn(async () => h.commandResult),
}));

import { registerLineRoutes } from "./lines";
import { executeLineCommand } from "../../services/lineController/lineControllerService";

let server: Server;
let base = "";

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  const r = express.Router();
  registerLineRoutes(r as any);
  app.use("/api/v1", r);
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  h.commandResult = {
    ok: true,
    lineId: 1,
    from: "ready",
    to: "producing",
    state: {},
    ts: "2026-07-12T00:00:00.000Z",
    correlationId: "corr-1",
  };
  vi.mocked(executeLineCommand).mockClear();
});

const MASTER = { Authorization: "Bearer MASTER" };
const MACHINE = { Authorization: "Bearer MACHINE_KEY" };

describe("auth — scope lines:read / lines:write", () => {
  it("không key → 401 unauthorized (envelope)", async () => {
    const res = await fetch(`${base}/api/v1/lines`);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("unauthorized");
  });

  it("machine key (chỉ ingest:write) → 403 forbidden, nêu scope yêu cầu", async () => {
    const res = await fetch(`${base}/api/v1/lines`, { headers: MACHINE });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("forbidden");
    expect(body.error.details.required).toBe("lines:read");
  });

  it("machine key trên POST command → 403 (lines:write)", async () => {
    const res = await fetch(`${base}/api/v1/lines/1/command`, {
      method: "POST",
      headers: { ...MACHINE, "content-type": "application/json" },
      body: JSON.stringify({ command: "start" }),
    });
    expect(res.status).toBe(403);
    expect(vi.mocked(executeLineCommand)).not.toHaveBeenCalled();
  });

  it("master key (wildcard *) → 200", async () => {
    const res = await fetch(`${base}/api/v1/lines`, { headers: MASTER });
    expect(res.status).toBe(200);
  });
});

describe("GET /v1/lines + /:id/state + /:id/stages", () => {
  it("GET /lines → envelope {ok,data:{lines,count}} với state FSM", async () => {
    const res = await fetch(`${base}/api/v1/lines`, { headers: MASTER });
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.count).toBe(1);
    expect(body.data.lines[0]).toMatchObject({ lineId: 1, code: "L-A", state: "producing" });
  });

  it("GET /lines/1/state → state + takt + bottleneck + readiness cache", async () => {
    const res = await fetch(`${base}/api/v1/lines/1/state`, { headers: MASTER });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toMatchObject({
      state: "producing",
      takt: expect.objectContaining({ taktTimeMs: 42000 }),
      bottleneck: { stationId: 9, machineId: 5 },
      readiness: expect.objectContaining({ ready: true }),
    });
  });

  it("GET /lines/9/state (không tồn tại) → 404 not_found", async () => {
    const res = await fetch(`${base}/api/v1/lines/9/state`, { headers: MASTER });
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("not_found");
  });

  it("GET /lines/abc/state (id xấu) → 400 bad_request", async () => {
    const res = await fetch(`${base}/api/v1/lines/abc/state`, { headers: MASTER });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("bad_request");
  });

  it("GET /lines/1/stages → per-trạm máy/op-state/dwell/blocked/starved", async () => {
    const res = await fetch(`${base}/api/v1/lines/1/stages`, { headers: MASTER });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.stages[0]).toMatchObject({
      code: "ST-1",
      blocked: false,
      starved: false,
      machines: [expect.objectContaining({ opState: "EXECUTE", presence: "online" })],
    });
  });
});

describe("POST /v1/lines/:id/command", () => {
  it("command hợp lệ → 200, chuyển qua executeLineCommand với actor api:master", async () => {
    const res = await fetch(`${base}/api/v1/lines/1/command`, {
      method: "POST",
      headers: { ...MASTER, "content-type": "application/json" },
      body: JSON.stringify({ command: "start", reason: "ca sáng" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toMatchObject({ lineId: 1, command: "start", from: "ready", to: "producing" });
    expect(vi.mocked(executeLineCommand)).toHaveBeenCalledWith(
      1,
      "start",
      expect.objectContaining({ reason: "ca sáng", actor: "api:master" }),
    );
  });

  it("command lạ → 400 bad_request, service KHÔNG được gọi", async () => {
    const res = await fetch(`${base}/api/v1/lines/1/command`, {
      method: "POST",
      headers: { ...MASTER, "content-type": "application/json" },
      body: JSON.stringify({ command: "warp" }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("bad_request");
    expect(vi.mocked(executeLineCommand)).not.toHaveBeenCalled();
  });

  it("INVALID_TRANSITION → 400 invalid_transition + details.allowed", async () => {
    h.commandResult = {
      ok: false,
      code: "INVALID_TRANSITION",
      message: "Transition 'idle' → 'held' không hợp lệ.",
      from: "idle",
      to: "held",
      allowed: ["ready", "changeover", "fault"],
    };
    const res = await fetch(`${base}/api/v1/lines/1/command`, {
      method: "POST",
      headers: { ...MASTER, "content-type": "application/json" },
      body: JSON.stringify({ command: "hold" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe("invalid_transition");
    expect(body.error.details.allowed).toEqual(["ready", "changeover", "fault"]);
  });

  it("NOT_READY → 409 not_ready + details.checks (checklist)", async () => {
    h.commandResult = {
      ok: false,
      code: "NOT_READY",
      message: "Tuyến chưa sẵn sàng.",
      from: "idle",
      to: "ready",
      readiness: {
        lineId: 1,
        ready: false,
        checks: [{ name: "machines_online", passed: false, detail: "M-2 offline" }],
        checkedAt: "2026-07-12T00:00:00.000Z",
      },
    };
    const res = await fetch(`${base}/api/v1/lines/1/command`, {
      method: "POST",
      headers: { ...MASTER, "content-type": "application/json" },
      body: JSON.stringify({ command: "start" }),
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe("not_ready");
    expect(body.error.details.checks[0].name).toBe("machines_online");
  });

  it("POLICY_DENIED → 403 policy_denied + policyRef", async () => {
    h.commandResult = {
      ok: false,
      code: "POLICY_DENIED",
      message: "Policy chặn.",
      effect: "deny",
      policyRef: "pol-line-1",
    };
    const res = await fetch(`${base}/api/v1/lines/1/command`, {
      method: "POST",
      headers: { ...MASTER, "content-type": "application/json" },
      body: JSON.stringify({ command: "resume" }),
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe("policy_denied");
    expect(body.error.details.policyRef).toBe("pol-line-1");
  });

  it("LINE_NOT_FOUND → 404; CONFLICT → 409; DB_UNAVAILABLE → 503", async () => {
    h.commandResult = { ok: false, code: "LINE_NOT_FOUND", message: "không thấy" };
    let res = await fetch(`${base}/api/v1/lines/2/command`, {
      method: "POST",
      headers: { ...MASTER, "content-type": "application/json" },
      body: JSON.stringify({ command: "start" }),
    });
    expect(res.status).toBe(404);

    h.commandResult = { ok: false, code: "CONFLICT", message: "thua race" };
    res = await fetch(`${base}/api/v1/lines/1/command`, {
      method: "POST",
      headers: { ...MASTER, "content-type": "application/json" },
      body: JSON.stringify({ command: "hold" }),
    });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("conflict");

    h.commandResult = { ok: false, code: "DB_UNAVAILABLE", message: "mất DB" };
    res = await fetch(`${base}/api/v1/lines/1/command`, {
      method: "POST",
      headers: { ...MASTER, "content-type": "application/json" },
      body: JSON.stringify({ command: "hold" }),
    });
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe("db_unavailable");
  });
});
