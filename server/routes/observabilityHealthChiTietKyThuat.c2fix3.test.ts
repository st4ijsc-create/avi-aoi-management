/**
 * SCADA R1b-2b-2b A — C2 fix round 3 (điều phối 2026-10-31, KD-2bA 2.1 "né đường vòng") — `GET /api/observability/health`.
 *
 * Census bề mặt (`server/routers/chiTietKyThuatBeMatCensus.test.ts`) tìm ra: cổng này (phiên admin / super_admin / SUPERVISOR) trả
 * `otConnections.supervisors[*].activeEndpoint` + `lastError` THÔ của supervisor HA — người giám sát không phải người xem chi tiết kỹ thuật
 * (admin|engineer + machine_control.canEdit). Luật giống hệt tRPC `systemHealth.connectionSupervisors`: bị che ⇒ `activeEndpoint` null, `lastError` = MÃ.
 *
 * Express + HTTP + route THẬT; chỉ thay ranh giới: phiên (`doiVaiDacQuyen`), danh sách supervisor RAM (otManager), quyền (`checkPermission`).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

const tt = vi.hoisted(() => ({
  phien: { ok: true, status: 200, role: "supervisor", userId: 7 } as { ok: boolean; status: number; role?: string; userId?: number },
  coSua: true,
  supervisors: [] as unknown[],
}));

vi.mock("./_congLoopback", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./_congLoopback")>()),
  doiVaiDacQuyen: async () => tt.phien,
}));
vi.mock("../services/ot/otManager", () => ({ listSupervisorStatuses: () => tt.supervisors }));
vi.mock("../_core/accessControl", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../_core/accessControl")>()),
  checkPermission: async (_id: number, _role: string, module: string, action: string) => module === "machine_control" && action === "canEdit" && tt.coSua,
}));

import { registerObservabilityRoutes } from "./observabilityRoutes";

const SUP = (adapterId: number, connected: boolean, lastError: string | null) => ({
  adapterId,
  code: `AD-${adapterId}`,
  protocol: "modbus",
  state: connected ? "connected" : "reconnecting",
  connected,
  activeEndpoint: connected ? "tcp://10.9.8.7:5020" : null,
  activeLabel: connected ? "primary" : null,
  endpointCount: 2,
  reconnects: 1,
  failovers: 0,
  attempts: 3,
  consecutiveFailures: connected ? 0 : 2,
  lastError,
  lastConnectedAt: null,
});

let server: Server | null = null;
let base = "";

async function layHealth(): Promise<{ status: number; text: string; body: any }> {
  const r = await fetch(`${base}/api/observability/health`);
  const text = await r.text();
  return { status: r.status, text, body: JSON.parse(text) };
}

describe("C2 fix 3 — /api/observability/health che activeEndpoint / lastError của supervisor với người không xem chi tiết kỹ thuật", () => {
  beforeAll(async () => {
    const app = express();
    registerObservabilityRoutes(app);
    await new Promise<void>((resolve) => {
      server = createServer(app).listen(0, "127.0.0.1", () => resolve());
    });
    base = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  });
  beforeEach(() => {
    tt.coSua = true;
    tt.supervisors = [SUP(1, true, "SENTINEL-10.9.8.7:5020 timeout earlier"), SUP(2, false, "connect ECONNREFUSED 10.9.8.7:5020 SENTINEL")];
  });

  it("★★★ supervisor (vai không thuộc admin|engineer): không SENTINEL / 10.9.8.7 / :5020; activeEndpoint null; lastError = MÃ", async () => {
    tt.phien = { ok: true, status: 200, role: "supervisor", userId: 7 };
    const r = await layHealth();
    expect(r.status).toBe(200);
    expect(r.text).not.toContain("SENTINEL");
    expect(r.text).not.toContain("10.9.8.7");
    expect(r.text).not.toContain(":5020");
    const s = r.body.otConnections.supervisors;
    expect(s).toHaveLength(2);
    expect(s[0]).toMatchObject({ adapterId: 1, activeEndpoint: null, activeLabel: "primary", lastError: "TECHNICAL_ERROR", connected: true });
    expect(s[1]).toMatchObject({ adapterId: 2, activeEndpoint: null, lastError: "ADAPTER_OFFLINE", connected: false });
    expect(r.body.otConnections).toMatchObject({ total: 2, connected: 1 }); // đếm không đổi
  });

  it("admin KHÔNG có machine_control.canEdit ⇒ cũng bị che (luật hai điều kiện)", async () => {
    tt.phien = { ok: true, status: 200, role: "admin", userId: 1 };
    tt.coSua = false;
    const r = await layHealth();
    expect(r.text).not.toContain("10.9.8.7");
    expect(r.body.otConnections.supervisors[1].lastError).toBe("ADAPTER_OFFLINE");
  });

  it("phiên đặc quyền thiếu userId ⇒ bị che (fail-closed)", async () => {
    tt.phien = { ok: true, status: 200, role: "admin" };
    const r = await layHealth();
    expect(r.text).not.toContain("10.9.8.7");
  });

  it("đối chứng: admin + canEdit ⇒ nguyên văn (kỹ sư cần host:port để chẩn đoán)", async () => {
    tt.phien = { ok: true, status: 200, role: "admin", userId: 1 };
    const r = await layHealth();
    expect(r.body.otConnections.supervisors[0]).toMatchObject({ activeEndpoint: "tcp://10.9.8.7:5020", lastError: "SENTINEL-10.9.8.7:5020 timeout earlier" });
    expect(r.body.otConnections.supervisors[1].lastError).toBe("connect ECONNREFUSED 10.9.8.7:5020 SENTINEL");
  });
});
