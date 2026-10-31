/**
 * CỔNG CSDL THẬT — SCADA R1b-2b-2b A, C2 fix round 4 mục 1 (điều phối 2026-11-01, KD-2bA 1.1 / 2.1).
 *
 * Lỗ: `orchestration.getRun` (tRPC) và REST `GET /api/v1/orchestration/runs/:id` trả `steps[*].error` (bước lệnh OT mang thông điệp dispatcher /
 * driver — có thể có host:port), `result.detail` (reason / results / motPhan), `run.error`, `contextJson.foeResumeState[*].error` NGUYÊN VĂN — cùng họ
 * `command_log.errorText` mà C1 đã che. Census bề mặt còn tìm ra `orchestration.listRuns` và `edgeRuntime.nodeStatus` (hàng run nguyên).
 * Luật: người không được xem chi tiết kỹ thuật (`chiTietKyThuatCua` false; khoá API LUÔN false) nhận MÃ (`maLoiCua` / `maLoiBuocFoe`); kỹ sư canEdit giữ văn bản.
 *
 * Dữ liệu thật trong `_test` (workflow + run + 3 bước + edge node + 2 người + khoá API), đi qua router tRPC THẬT (createCaller) và router `/api/v1`
 * THẬT qua HTTP với khoá API THẬT (`requireScope` không mock). Các bảng orchestration / users / api_keys không phải WORM; hàng đã COMMIT (đường HTTP đọc
 * qua pool khác) và được dọn có KHẲNG ĐỊNH ở afterAll.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomBytes } from "node:crypto";
import postgres from "postgres";
import { taoNguoiDungTest } from "../testing/nguoiDungTest"; // tự dọn users + permissions + user_factory_assignments ở afterAll của tệp

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

const DB_URL = process.env.DATABASE_URL;
const DAU = `C2F4-${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
const KHOA_THO = `c2f4_${randomBytes(18).toString("hex")}`;
const SENT = "SENTINEL-10.9.8.7:5020-xyz";
let sql: ReturnType<typeof postgres>;
let server: Server | null = null;
let base = "";
const ids: Record<string, number> = {};
const one = async (q: Promise<any[]>) => Number((await q)[0].id);
const ctxOf = (id: number, role: string) => ({ user: { id, role, name: `${DAU}-${role}`, twoFactorEnabled: true } }) as never;
const coLo = (s: string) => /SENTINEL|10\.9\.8\.7|:5020/.test(s);

describe.skipIf(!DB_URL)("C2 fix 4 — orchestration steps[*].error / run.error che với người không được xem chi tiết kỹ thuật (tRPC + REST, sentinel)", () => {
  beforeAll(async () => {
    expect(DB_URL).toMatch(/_test/);
    sql = postgres(DB_URL!, { max: 2, connect_timeout: 30, onnotice: () => {} });
    const code = DAU;
    ids.f = await one(sql`INSERT INTO factories (code, name) VALUES (${code}, ${code}) RETURNING id`);
    for (const [key, role] of [["sup", "supervisor"], ["eng", "engineer"]] as const) {
      ids[key] = (await taoNguoiDungTest(key, role, { tienTo: DAU.replace(/[^A-Za-z0-9_-]/g, ""), extra: { isActive: true } })).id;
      await sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${ids[key]}, ${code})`;
      for (const [category, module] of [["machine_control", "machine_control"], ["machine_monitoring", "machine_status"]]) {
        await sql`INSERT INTO permissions ("userId", category, "moduleName", "canView", "canCreate", "canEdit", "canDelete")
          VALUES (${ids[key]}, ${category}, ${module}, true, true, true, true)`;
      }
    }
    ids.node = await one(sql`INSERT INTO edge_nodes (code, name, "factoryCode") VALUES (${`${DAU}-edge`}, ${DAU}, ${code}) RETURNING id`);
    const def = { ref: `${DAU}-wf`, name: `${DAU}-wf`, steps: [{ id: "d", type: "delay", ms: 1 }] };
    ids.wf = await one(sql`INSERT INTO orchestration_workflows (ref, "scopeKey", name, "definitionJson", version, status)
      VALUES (${`${DAU}-wf`}, 'global', ${`${DAU}-wf`}, ${sql.json(def)}, 1, 'active') RETURNING id`);
    ids.run = await one(sql`INSERT INTO orchestration_runs ("workflowId", "workflowRef", status, "contextJson", "edgeNodeId", error, "finishedAt")
      VALUES (${ids.wf}, ${`${DAU}-wf`}, 'failed',
        ${sql.json({ foeResumeState: { c1: { state: "doneFailed", error: `connect ECONNREFUSED 10.9.8.7:5020 ${SENT}` } }, "branch:x": "then" })},
        ${ids.node}, ${`failed on edge node ${DAU}-edge: ${SENT} connect ECONNREFUSED 10.9.8.7:5020`}, now()) RETURNING id`);
    // C2 polish m1 — run 2: edge giữ run, lỗi mức run nhúng mã SAU tiền tố (foeRunStore `held`) ⇒ người gọi REST vẫn phải thấy EDGE_OUTCOME_UNKNOWN;
    // run 3: "Parallel branch failed: FOE_OUTCOME_UNKNOWN: …" (foeEngine) ⇒ FOE_OUTCOME_UNKNOWN
    ids.run2 = await one(sql`INSERT INTO orchestration_runs ("workflowId", "workflowRef", status, error)
      VALUES (${ids.wf}, ${`${DAU}-wf`}, 'held', ${`Edge node ${DAU}-edge held run 1 (journalFull): EDGE_OUTCOME_UNKNOWN(c1): ${SENT} — nothing further was sent; Continue to resume it.`}) RETURNING id`);
    ids.run3 = await one(sql`INSERT INTO orchestration_runs ("workflowId", "workflowRef", status, error, "finishedAt")
      VALUES (${ids.wf}, ${`${DAU}-wf`}, 'failed', ${`Parallel branch failed: FOE_OUTCOME_UNKNOWN: ${SENT} connect ECONNREFUSED 10.9.8.7:5020 — not sent again; check the device.`}, now()) RETURNING id`);
    // c1: lệnh OT hỏng với văn bản driver thô; c2: tiền tố mã đã biết + văn bản; c3: cổng duyệt (văn bản máy chủ soạn)
    await sql`INSERT INTO orchestration_run_steps ("runId", "stepId", "stepType", status, attempt, "resultJson", error) VALUES
      (${ids.run}, 'c1', 'command', 'failed', 1,
        ${sql.json({ routedTo: "ot-dispatcher", status: "failed", accepted: false, detail: { simulated: false, commandLogIds: [7], reason: `connect ECONNREFUSED 10.9.8.7:5020 ${SENT}`, results: [{ error: SENT }], refusal: SENT, motPhan: { daAp: ["tagA"], khongAp: ["tagB", "tagC"] }, appError: { appCode: "OT_X", appParams: {} } } })},
        ${`${SENT} connect ECONNREFUSED 10.9.8.7:5020`}),
      (${ids.run}, 'c2', 'command', 'failed', 1, NULL, ${`FOE_OUTCOME_UNKNOWN: ${SENT} timed out — not sent again; check the device.`}),
      (${ids.run}, 'c3', 'command', 'failed', 1, NULL, ${'FOE_GATE_REQUIRED(approvedByOwner): command step "c3" was not sent: the approval gate before it was approved by the user who started the run — that does not count.'})`;
    ids.k = await one(sql`INSERT INTO api_keys (name, "keyHash", scopes, "dataScopeMode")
      VALUES (${`${DAU}-khoa`}, ${(await import("../api/v1/auth")).hashApiKey(KHOA_THO)}, ${sql.json(["orchestration:read"])}, 'global') RETURNING id`);
    const { createV1Router } = await import("../api/v1/router");
    const app = express();
    app.use("/api/v1", createV1Router());
    await new Promise<void>((resolve) => {
      server = createServer(app).listen(0, "127.0.0.1", () => resolve());
    });
    base = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    if (!sql) return;
    try {
      if (ids.run) await sql`DELETE FROM orchestration_run_steps WHERE "runId" = ${ids.run}`;
      if (ids.run) await sql`DELETE FROM orchestration_runs WHERE id IN ${sql([ids.run, ids.run2 ?? -1, ids.run3 ?? -1])}`;
      if (ids.wf) await sql`DELETE FROM orchestration_workflow_versions WHERE "workflowId" = ${ids.wf}`;
      if (ids.wf) await sql`DELETE FROM orchestration_workflows WHERE id = ${ids.wf}`;
      await sql`DELETE FROM api_keys WHERE name LIKE ${DAU + "%"}`;
      // người dùng (+ permissions / user_factory_assignments): helper taoNguoiDungTest dọn ở afterAll của nó (census nguoiDungTest)
      if (ids.sup && ids.eng) await sql`DELETE FROM user_factory_assignments WHERE "userId" IN ${sql([ids.sup, ids.eng])}`;
      await sql`DELETE FROM edge_nodes WHERE code LIKE ${DAU + "%"}`;
      await sql`DELETE FROM factories WHERE code LIKE ${DAU + "%"}`;
      // review fix 3 M2 — dọn có KHẲNG ĐỊNH (không nuốt lỗi)
      const [con] = await sql`SELECT
          (SELECT count(*)::int FROM orchestration_runs WHERE "workflowRef" LIKE ${DAU + "%"}) AS runs,
          (SELECT count(*)::int FROM orchestration_run_steps WHERE "runId" = ${ids.run ?? -1}) AS steps,
          (SELECT count(*)::int FROM orchestration_workflows WHERE ref LIKE ${DAU + "%"}) AS wfs,
          (SELECT count(*)::int FROM api_keys WHERE name LIKE ${DAU + "%"}) AS api_keys,
          (SELECT count(*)::int FROM edge_nodes WHERE code LIKE ${DAU + "%"}) AS edge_nodes,
          (SELECT count(*)::int FROM factories WHERE code LIKE ${DAU + "%"}) AS factories`;
      expect(con, "hàng fixture còn sót sau khi dọn").toEqual({ runs: 0, steps: 0, wfs: 0, api_keys: 0, edge_nodes: 0, factories: 0 });
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  const orch = async (id: number, role: string) => (await import("./orchestrationRouter")).orchestrationRouter.createCaller(ctxOf(id, role));

  it("đối chứng: sentinel NẰM trong CSDL (phép đo thấy được nếu rò)", async () => {
    const [r] = await sql`SELECT r.error, r."contextJson"::text AS c, (SELECT string_agg(s.error || coalesce(s."resultJson"::text, ''), '|') FROM orchestration_run_steps s WHERE s."runId" = r.id) AS s
      FROM orchestration_runs r WHERE r.id = ${ids.run}`;
    expect(coLo(JSON.stringify(r))).toBe(true);
  });

  it("★★★ tRPC getRun — supervisor (không phải người xem): không SENTINEL / 10.9.8.7 / :5020; MÃ có mặt; result.detail theo danh sách trắng", async () => {
    const v = await (await orch(ids.sup, "supervisor")).getRun({ runId: ids.run });
    const t = JSON.stringify(v);
    expect(coLo(t), t).toBe(false);
    const st = Object.fromEntries(v.steps.map((s) => [s.stepId, s]));
    expect(st.c1.error).toBe("DRIVER_WRITE_FAILED");
    expect(st.c2.error).toBe("FOE_OUTCOME_UNKNOWN");
    expect(st.c3.error).toBe("FOE_GATE_REQUIRED(approvedByOwner)"); // Studio vẫn dịch đúng lý do (gateRequiredReasonOf)
    expect(st.c1.result).toEqual({
      routedTo: "ot-dispatcher",
      status: "failed",
      accepted: false,
      detail: { simulated: false, commandLogIds: [7], appError: { appCode: "OT_X", appParams: {} }, reason: "TECHNICAL_ERROR", motPhan: { soDaAp: 1, soKhongAp: 2 } },
    });
    expect(v.run.error).toBe("DRIVER_WRITE_FAILED");
    expect((v.run.contextJson as any).foeResumeState.c1).toEqual({ state: "doneFailed", error: "DRIVER_WRITE_FAILED" });
    expect((v.run.contextJson as any)["branch:x"]).toBe("then"); // phần còn lại của ngữ cảnh giữ nguyên
  });

  it("đối chứng: tRPC getRun — kỹ sư CÓ machine_control.canEdit giữ NGUYÊN văn bản", async () => {
    const v = await (await orch(ids.eng, "engineer")).getRun({ runId: ids.run });
    const st = Object.fromEntries(v.steps.map((s) => [s.stepId, s]));
    expect(st.c1.error).toContain(SENT);
    expect((st.c1.result as any).detail.reason).toContain("10.9.8.7:5020");
    expect(v.run.error).toContain(SENT);
  });

  it("★★★ tRPC listRuns (census tìm ra) — supervisor: hàng run không rò; kỹ sư: nguyên văn", async () => {
    const ds = await (await orch(ids.sup, "supervisor")).listRuns({ workflowId: ids.wf });
    expect(ds.map((r) => r.id).sort()).toEqual([ids.run, ids.run2, ids.run3].sort());
    expect(coLo(JSON.stringify(ds))).toBe(false);
    expect(Object.fromEntries(ds.map((r) => [r.id, r.error]))).toEqual({ [ids.run]: "DRIVER_WRITE_FAILED", [ids.run2]: "EDGE_OUTCOME_UNKNOWN", [ids.run3]: "FOE_OUTCOME_UNKNOWN" });
    const dsK = await (await orch(ids.eng, "engineer")).listRuns({ workflowId: ids.wf });
    expect(dsK.find((r) => r.id === ids.run)!.error).toContain(SENT);
  });

  it("★★★ tRPC edgeRuntime.nodeStatus (census tìm ra) — supervisor: hàng run của nút không rò", async () => {
    const er = (await import("./edgeRuntimeRouter")).edgeRuntimeRouter;
    const kq = await er.createCaller(ctxOf(ids.sup, "supervisor")).nodeStatus({ code: `${DAU}-edge` });
    expect(kq.runs.map((r: any) => r.id)).toEqual([ids.run]);
    expect(coLo(JSON.stringify(kq.runs))).toBe(false);
    const kqK = await er.createCaller(ctxOf(ids.eng, "engineer")).nodeStatus({ code: `${DAU}-edge` });
    expect(JSON.stringify(kqK.runs)).toContain(SENT);
  });

  it("★★★ REST GET /api/v1/orchestration/runs/:id — khoá API THẬT (orchestration:read, global): không rò; MÃ có mặt", async () => {
    const r = await fetch(`${base}/api/v1/orchestration/runs/${ids.run}`, { headers: { authorization: `Bearer ${KHOA_THO}` } });
    const text = await r.text();
    expect(r.status, text).toBe(200);
    expect(coLo(text), text).toBe(false);
    const body = JSON.parse(text);
    expect(body.data.run.error).toBe("DRIVER_WRITE_FAILED");
    const st = Object.fromEntries((body.data.steps as any[]).map((s) => [s.stepId, s]));
    expect([st.c1.error, st.c2.error, st.c3.error]).toEqual(["DRIVER_WRITE_FAILED", "FOE_OUTCOME_UNKNOWN", "FOE_GATE_REQUIRED(approvedByOwner)"]);
    expect(st.c1.result.detail.reason).toBe("TECHNICAL_ERROR");
  });

  it("★★★ C2 polish m1 — REST khoá API: mã outcome NHÚNG SAU tiền tố ở mức run vẫn hiện (EDGE_OUTCOME_UNKNOWN / FOE_OUTCOME_UNKNOWN), không rò", async () => {
    for (const [run, ma] of [
      [ids.run2, "EDGE_OUTCOME_UNKNOWN"],
      [ids.run3, "FOE_OUTCOME_UNKNOWN"],
    ] as const) {
      const r = await fetch(`${base}/api/v1/orchestration/runs/${run}`, { headers: { authorization: `Bearer ${KHOA_THO}` } });
      const text = await r.text();
      expect(r.status, text).toBe(200);
      expect(coLo(text), text).toBe(false);
      expect(JSON.parse(text).data.run.error).toBe(ma);
    }
  });

  it("đối chứng cổng REST: không khoá ⇒ 401", async () => {
    expect((await fetch(`${base}/api/v1/orchestration/runs/${ids.run}`)).status).toBe(401);
  });
});
