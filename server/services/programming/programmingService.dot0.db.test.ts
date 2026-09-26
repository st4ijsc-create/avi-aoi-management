/**
 * doc 80 Đợt 0 — Task 4 (WS-03 / WS-06 / FLOW-04): deploy/rollback TRUNG THỰC + KHOÁ TRANH CHẤP.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * Cổng DB THẬT (`_test`, ép bởi vitest.setup) — tranh chấp chỉ tái hiện được trên
 * Postgres thật (unique index `uq_prog_deploy_idem`, khoá hàng khi UPDATE). Bảng
 * program_* KHÔNG có FK (đọc pg_constraint: chỉ PK + unique) ⇒ fixture tự dựng + tự dọn.
 *
 * Adapter "stub" được THAY bằng adapter giả đếm số lần `deploy()` (thiết bị ảo, trễ 40 ms
 * để các lượt song song chắc chắn chồng lên nhau). `DPC_DEPLOY_ENABLED=true` + sign-off +
 * sim PASS ⇒ đường deploy THẬT (gọi adapter) — đúng đường có rủi ro ghi thiết bị 2 lần.
 *
 * Kịch bản audit:
 *   WS-06 — deployBuild SELECT → adapter → INSERT: 20 lượt cùng khoá đều lọt SELECT ⇒ adapter
 *           gọi 20 lần + 19 lượt vỡ unique (500). Sau vá: giữ chỗ INSERT … ON CONFLICT DO
 *           NOTHING ⇒ adapter gọi ĐÚNG 1 lần, 20 lượt đều trả cùng một dòng.
 *   WS-06 — approveDeployment UPDATE không điều kiện: hai approve song song đều deploy.
 *           Sau vá: UPDATE … WHERE status='awaiting_approval' RETURNING ⇒ 1 thắng + 1 CONFLICT.
 *   WS-03 — rollback đánh đích `rolled_back` VÔ ĐIỀU KIỆN dù lượt lùi failed/simulated.
 * ══════════════════════════════════════════════════════════════════════════════
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";
import { and, eq, inArray, like } from "drizzle-orm";
import { getDb } from "../../db/connection";
import {
  programProjects,
  programArtifacts,
  programBuilds,
  programSimRuns,
  programDeployments,
  aiPendingActions,
} from "../../../drizzle/schema";
import {
  StubProgrammingAdapter,
  registerProgrammingAdapter,
  type BuildResult,
  type ProgDeployOpts,
  type ProgDeployResult,
} from "./programmingAdapter";
import {
  deployBuild,
  requestDeployApproval,
  approveDeployment,
  rejectDeployment,
  rollbackDeployment,
  failInterruptedDeployments,
} from "./programmingService";

const DB_URL = process.env.DATABASE_URL;
const DAU = `T4DOT0-${Date.now()}`;

// ── Adapter giả: đếm lời gọi deploy(), kết quả điều khiển được theo từng test ──
let deployCalls = 0;
let nextDeploy: ProgDeployResult | Error = { ok: true, status: "deployed", simulated: false };
class CountingAdapter extends StubProgrammingAdapter {
  override async deploy(_b: BuildResult, _o: ProgDeployOpts): Promise<ProgDeployResult> {
    deployCalls++;
    await new Promise((r) => setTimeout(r, 40));
    if (nextDeploy instanceof Error) throw nextDeploy;
    return nextDeploy;
  }
}

const REQUESTER = { id: 990_400_001, role: "engineer", name: "T4-req" };
const APPROVER_A = { id: 990_400_002, role: "engineer", name: "T4-apA" };
const APPROVER_B = { id: 990_400_003, role: "engineer", name: "T4-apB" };

let projectId = 0;
let artifactId = 0;
let build1 = 0; // "bản tốt trước"
let build2 = 0; // "bản đích"
let devSeq = 990_400_100;
const nextDevice = () => ++devSeq;

async function d() {
  const x = await getDb();
  if (!x) throw new Error("no db");
  return x;
}

async function insertDep(v: {
  buildId: number;
  deviceId: number;
  status: "simulated" | "deployed" | "verified" | "failed" | "rejected" | "awaiting_approval";
  simulated: boolean;
}) {
  const [row] = await (await d())
    .insert(programDeployments)
    .values({
      buildId: v.buildId,
      projectId,
      deviceId: v.deviceId,
      stage: "staging",
      status: v.status,
      simulated: v.simulated,
      requestedBy: REQUESTER.id,
      idempotencyKey: `${DAU}-seed-${v.deviceId}-${v.buildId}-${v.status}`,
    })
    .returning();
  return row!;
}

async function depById(id: number) {
  const [row] = await (await d()).select().from(programDeployments).where(eq(programDeployments.id, id)).limit(1);
  return row!;
}

describe.skipIf(!DB_URL)("Task 4 — deploy/rollback trung thực + khoá tranh chấp (DB thật)", () => {
  beforeAll(async () => {
    registerProgrammingAdapter("stub", () => new CountingAdapter());
    const x = await d();
    const [p] = await x
      .insert(programProjects)
      .values({ code: `${DAU}-P`, name: `${DAU} project`, kind: "stub" })
      .returning();
    projectId = p!.id;
    const [a] = await x
      .insert(programArtifacts)
      .values({ projectId, kind: "stub", language: "text", content: "A\nB", version: 1 })
      .returning();
    artifactId = a!.id;
    const [b1] = await x
      .insert(programBuilds)
      .values({ artifactId, adapterKind: "stub", status: "ok", ok: true, outputRef: "stub://b1" })
      .returning();
    const [b2] = await x
      .insert(programBuilds)
      .values({ artifactId, adapterKind: "stub", status: "ok", ok: true, outputRef: "stub://b2" })
      .returning();
    build1 = b1!.id;
    build2 = b2!.id;
    // Simulation Gate PASS cho cả hai build (điều kiện cần của deploy thật).
    await x.insert(programSimRuns).values([
      { buildId: build1, ok: true },
      { buildId: build2, ok: true },
    ]);
  }, 60_000);

  afterAll(async () => {
    const x = await d();
    const deps = await x.select().from(programDeployments).where(eq(programDeployments.projectId, projectId));
    const pendingIds = deps
      .map((r) => (r.detailJson as Record<string, unknown> | null)?.pendingActionId)
      .filter((v): v is string => typeof v === "string");
    if (pendingIds.length) await x.delete(aiPendingActions).where(inArray(aiPendingActions.id, pendingIds));
    // program_deployments là sổ APPEND-ONLY: vai app (`avi_app`) KHÔNG có quyền DELETE (đo
    // information_schema.role_table_grants: INSERT,SELECT,UPDATE). Không xoá được ⇒ đóng mọi
    // dòng còn mở để chúng không lọt vào Hộp duyệt (listDeployApprovals) của test khác.
    await x
      .update(programDeployments)
      .set({ status: "rejected", error: `${DAU} test fixture closed` })
      .where(and(eq(programDeployments.projectId, projectId), inArray(programDeployments.status, ["awaiting_approval", "pending"])));
    await x.delete(programSimRuns).where(inArray(programSimRuns.buildId, [build1, build2]));
    await x.delete(programBuilds).where(eq(programBuilds.artifactId, artifactId));
    await x.delete(programArtifacts).where(eq(programArtifacts.id, artifactId));
    await x.delete(programProjects).where(like(programProjects.code, `${DAU}%`));
    registerProgrammingAdapter("stub", () => new StubProgrammingAdapter());
    delete process.env.DPC_DEPLOY_ENABLED;
  }, 60_000);

  beforeEach(() => {
    process.env.DPC_DEPLOY_ENABLED = "true";
    deployCalls = 0;
    nextDeploy = { ok: true, status: "deployed", simulated: false };
  });

  // ══════════════════════════ WS-06 / FLOW-04 ══════════════════════════
  it("★★★ WS-06: 20 lượt deployBuild SONG SONG cùng khoá ⇒ adapter gọi ĐÚNG 1 lần, không lượt nào ném", async () => {
    const key = `${DAU}-par20`;
    const dev = nextDevice();
    const req = {
      buildId: build2,
      stage: "staging" as const,
      idempotencyKey: key,
      deviceId: dev,
      hitl: { actionId: `${DAU}-act`, requestedBy: REQUESTER.id, confirmedBy: REQUESTER.id },
    };
    const settled = await Promise.allSettled(Array.from({ length: 20 }, () => deployBuild(req, REQUESTER)));

    const rejected = settled.filter((s) => s.status === "rejected");
    expect(rejected.map((r) => String((r as PromiseRejectedResult).reason))).toEqual([]);
    expect(deployCalls).toBe(1);

    const ids = new Set(settled.map((s) => (s as PromiseFulfilledResult<{ id: number }>).value.id));
    expect(ids.size).toBe(1);

    const rows = await (await d()).select().from(programDeployments).where(eq(programDeployments.idempotencyKey, key));
    expect(rows).toHaveLength(1);
    // Lượt thắng đã ghi KẾT QUẢ thật (không kẹt ở trạng thái giữ chỗ).
    expect(rows[0]!.status).toBe("deployed");
    expect(rows[0]!.simulated).toBe(false);
  }, 60_000);

  it("WS-06: adapter NÉM ⇒ dòng giữ chỗ chuyển 'failed' (không kẹt 'pending'), lỗi vẫn nổi lên", async () => {
    const key = `${DAU}-throw`;
    nextDeploy = new Error("device exploded");
    await expect(
      deployBuild(
        {
          buildId: build2,
          stage: "staging",
          idempotencyKey: key,
          deviceId: nextDevice(),
          hitl: { actionId: `${DAU}-act`, requestedBy: REQUESTER.id, confirmedBy: REQUESTER.id },
        },
        REQUESTER,
      ),
    ).rejects.toThrow(/device exploded/);
    const rows = await (await d()).select().from(programDeployments).where(eq(programDeployments.idempotencyKey, key));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("failed");
    expect(rows[0]!.error).toMatch(/device exploded/);
  }, 60_000);

  it("★★★ WS-06: hai approveDeployment SONG SONG ⇒ 1 thành công + 1 CONFLICT, adapter gọi 1 lần", async () => {
    process.env.DPC_DEPLOY_APPROVAL_ENABLED = "true";
    try {
      const reqRow = await requestDeployApproval(
        { buildId: build2, deviceId: nextDevice(), reason: "t4", idempotencyKey: `${DAU}-appr` },
        REQUESTER,
      );
      expect(reqRow.status).toBe("awaiting_approval");

      const settled = await Promise.allSettled([
        approveDeployment(reqRow.id, APPROVER_A, {}),
        approveDeployment(reqRow.id, APPROVER_B, {}),
      ]);
      const ok = settled.filter((s) => s.status === "fulfilled");
      const bad = settled.filter((s) => s.status === "rejected") as PromiseRejectedResult[];
      expect(ok).toHaveLength(1);
      expect(bad).toHaveLength(1);
      expect(bad[0]!.reason).toBeInstanceOf(TRPCError);
      expect((bad[0]!.reason as TRPCError).code).toBe("CONFLICT");
      expect(deployCalls).toBe(1);

      const final = await depById(reqRow.id);
      expect(final.status).toBe("deployed");
    } finally {
      delete process.env.DPC_DEPLOY_APPROVAL_ENABLED;
    }
  }, 60_000);

  it("FLOW-04: 5 lượt requestDeployApproval SONG SONG cùng khoá ⇒ 1 dòng chờ duyệt + 1 pending action, không lượt nào ném", async () => {
    const key = `${DAU}-req5`;
    const req = { buildId: build2, deviceId: nextDevice(), reason: "t4", idempotencyKey: key };
    const settled = await Promise.allSettled(Array.from({ length: 5 }, () => requestDeployApproval(req, REQUESTER)));
    const rejected = settled.filter((s) => s.status === "rejected");
    expect(rejected.map((r) => String((r as PromiseRejectedResult).reason))).toEqual([]);
    const ids = new Set(settled.map((s) => (s as PromiseFulfilledResult<{ id: number }>).value.id));
    expect(ids.size).toBe(1);

    const rows = await (await d()).select().from(programDeployments).where(eq(programDeployments.idempotencyKey, key));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("awaiting_approval");
    const pendingId = (rows[0]!.detailJson as Record<string, unknown>).pendingActionId as string;
    const actions = await (await d())
      .select()
      .from(aiPendingActions)
      .where(like(aiPendingActions.idempotencyKey, `progdeploy-${key}-%`));
    expect(actions.map((a) => a.id)).toEqual([pendingId]);
  }, 60_000);

  it("WS-06: approve và reject SONG SONG ⇒ đúng một lượt thắng, trạng thái cuối khớp lượt thắng", async () => {
    process.env.DPC_DEPLOY_APPROVAL_ENABLED = "true";
    try {
      const reqRow = await requestDeployApproval(
        { buildId: build2, deviceId: nextDevice(), reason: "t4", idempotencyKey: `${DAU}-apprrej` },
        REQUESTER,
      );
      const [ap, rj] = await Promise.allSettled([
        approveDeployment(reqRow.id, APPROVER_A, {}),
        rejectDeployment(reqRow.id, APPROVER_B, "không đồng ý"),
      ]);
      const wins = [ap, rj].filter((s) => s.status === "fulfilled");
      const losses = [ap, rj].filter((s) => s.status === "rejected") as PromiseRejectedResult[];
      expect(wins).toHaveLength(1);
      expect(losses).toHaveLength(1);
      expect((losses[0]!.reason as TRPCError).code).toBe("CONFLICT");
      const final = await depById(reqRow.id);
      if (ap.status === "fulfilled") {
        expect(final.status).toBe("deployed");
        expect(deployCalls).toBe(1);
      } else {
        expect(final.status).toBe("rejected");
        expect(deployCalls).toBe(0);
      }
    } finally {
      delete process.env.DPC_DEPLOY_APPROVAL_ENABLED;
    }
  }, 60_000);

  it("WS-06: hai rejectDeployment SONG SONG ⇒ 1 thành công + 1 CONFLICT (UPDATE có điều kiện)", async () => {
    process.env.DPC_DEPLOY_APPROVAL_ENABLED = "true";
    try {
      const reqRow = await requestDeployApproval(
        { buildId: build2, deviceId: nextDevice(), reason: "t4", idempotencyKey: `${DAU}-rejrej` },
        REQUESTER,
      );
      const settled = await Promise.allSettled([
        rejectDeployment(reqRow.id, APPROVER_A, "lý do A"),
        rejectDeployment(reqRow.id, APPROVER_B, "lý do B"),
      ]);
      const bad = settled.filter((s) => s.status === "rejected") as PromiseRejectedResult[];
      expect(settled.filter((s) => s.status === "fulfilled")).toHaveLength(1);
      expect(bad).toHaveLength(1);
      expect((bad[0]!.reason as TRPCError).code).toBe("CONFLICT");
      expect((await depById(reqRow.id)).status).toBe("rejected");
    } finally {
      delete process.env.DPC_DEPLOY_APPROVAL_ENABLED;
    }
  }, 60_000);

  it("WS-06: approve một dòng KHÔNG còn chờ duyệt ⇒ CONFLICT (không 500)", async () => {
    const row = await insertDep({ buildId: build2, deviceId: nextDevice(), status: "deployed", simulated: false });
    const err = await approveDeployment(row.id, APPROVER_A, {}).catch((e) => e);
    expect(err).toBeInstanceOf(TRPCError);
    expect((err as TRPCError).code).toBe("CONFLICT");
    expect(deployCalls).toBe(0);
  }, 60_000);

  // ══════════════════════════ WS-03 ══════════════════════════
  it("★★★ WS-03: rollback mà lượt lùi FAILED ⇒ đích KHÔNG thành rolled_back; trả kết quả thật", async () => {
    const dev = nextDevice();
    await insertDep({ buildId: build1, deviceId: dev, status: "deployed", simulated: false });
    const target = await insertDep({ buildId: build2, deviceId: dev, status: "deployed", simulated: false });
    nextDeploy = { ok: false, status: "failed", simulated: false, error: "download NAK" };

    const res = await rollbackDeployment(
      target.id,
      REQUESTER,
      { actionId: `${DAU}-rb`, requestedBy: REQUESTER.id, confirmedBy: REQUESTER.id },
      `${DAU}-rb-failed`,
    );
    expect(deployCalls).toBe(1);
    expect(res.status).toBe("failed");
    expect(res.rolledBackFromId).toBe(target.id);
    expect((await depById(target.id)).status).toBe("deployed");
    expect((await depById(res.id)).rolledBackFromId).toBe(target.id);
  }, 60_000);

  it("WS-03: rollback chỉ SIMULATED (UI không gửi confirmedBy) trên đích đã deployed ⇒ đích giữ nguyên", async () => {
    const dev = nextDevice();
    await insertDep({ buildId: build1, deviceId: dev, status: "deployed", simulated: false });
    const target = await insertDep({ buildId: build2, deviceId: dev, status: "deployed", simulated: false });

    const res = await rollbackDeployment(
      target.id,
      REQUESTER,
      { actionId: `${DAU}-rb`, requestedBy: REQUESTER.id },
      `${DAU}-rb-sim-on-real`,
    );
    expect(deployCalls).toBe(0);
    expect(res.status).toBe("simulated");
    expect((await depById(target.id)).status).toBe("deployed");
  }, 60_000);

  it("WS-03: lượt lùi DEPLOYED ⇒ đích rolled_back + dòng mới mang rolledBackFromId", async () => {
    const dev = nextDevice();
    await insertDep({ buildId: build1, deviceId: dev, status: "deployed", simulated: false });
    const target = await insertDep({ buildId: build2, deviceId: dev, status: "verified", simulated: false });

    const res = await rollbackDeployment(
      target.id,
      REQUESTER,
      { actionId: `${DAU}-rb`, requestedBy: REQUESTER.id, confirmedBy: REQUESTER.id },
      `${DAU}-rb-ok`,
    );
    expect(res.status).toBe("deployed");
    expect((await depById(target.id)).status).toBe("rolled_back");
    expect((await depById(res.id)).rolledBackFromId).toBe(target.id);
  }, 60_000);

  it("WS-03: CẢ đích lẫn lượt lùi đều simulated ⇒ ghi nhận nhất quán rolled_back", async () => {
    delete process.env.DPC_DEPLOY_ENABLED;
    const dev = nextDevice();
    await insertDep({ buildId: build1, deviceId: dev, status: "simulated", simulated: true });
    const target = await insertDep({ buildId: build2, deviceId: dev, status: "simulated", simulated: true });

    const res = await rollbackDeployment(
      target.id,
      REQUESTER,
      { actionId: `${DAU}-rb`, requestedBy: REQUESTER.id },
      `${DAU}-rb-simsim`,
    );
    expect(res.status).toBe("simulated");
    expect((await depById(target.id)).status).toBe("rolled_back");
  }, 60_000);

  it("WS-03: từ chối rollback đích đang rejected / awaiting_approval (lỗi có mã, không 500, không deploy)", async () => {
    for (const status of ["rejected", "awaiting_approval"] as const) {
      const dev = nextDevice();
      await insertDep({ buildId: build1, deviceId: dev, status: "deployed", simulated: false });
      const target = await insertDep({ buildId: build2, deviceId: dev, status, simulated: true });
      const err = await rollbackDeployment(
        target.id,
        REQUESTER,
        { actionId: `${DAU}-rb`, requestedBy: REQUESTER.id, confirmedBy: REQUESTER.id },
        `${DAU}-rb-refuse-${status}`,
      ).catch((e) => e);
      expect(err).toBeInstanceOf(TRPCError);
      expect(["PRECONDITION_FAILED", "CONFLICT"]).toContain((err as TRPCError).code);
      expect((await depById(target.id)).status).toBe(status);
      const made = await (await d())
        .select()
        .from(programDeployments)
        .where(eq(programDeployments.idempotencyKey, `${DAU}-rb-refuse-${status}`));
      expect(made).toHaveLength(0);
    }
    expect(deployCalls).toBe(0);
  }, 60_000);

  // ══════════════════ Final review fix #3 — bản ghi deploy TRUNG THỰC / không kẹt ══════════════════
  it("★★★ fix #3a: deployBuild THẬT mà adapter NÉM ⇒ failed + simulated=false + outcome 'unknown' (thiết bị có thể đã bị ghi)", async () => {
    const key = `${DAU}-fx3-throw-real`;
    nextDeploy = new Error("socket reset giữa lúc download");
    await expect(
      deployBuild(
        {
          buildId: build2,
          stage: "staging",
          idempotencyKey: key,
          deviceId: nextDevice(),
          hitl: { actionId: `${DAU}-act`, requestedBy: REQUESTER.id, confirmedBy: REQUESTER.id },
        },
        REQUESTER,
      ),
    ).rejects.toThrow(/socket reset/);
    expect(deployCalls).toBe(1);
    const [row] = await (await d()).select().from(programDeployments).where(eq(programDeployments.idempotencyKey, key));
    expect(row!.status).toBe("failed");
    expect(row!.simulated).toBe(false);
    expect((row!.detailJson as Record<string, unknown>).outcome).toBe("unknown");
  }, 60_000);

  it("★★★ fix #3a: approveDeployment THẬT mà adapter NÉM ⇒ failed + simulated=false + outcome 'unknown'", async () => {
    process.env.DPC_DEPLOY_APPROVAL_ENABLED = "true";
    try {
      const reqRow = await requestDeployApproval(
        { buildId: build2, deviceId: nextDevice(), reason: "t4", idempotencyKey: `${DAU}-fx3-appr-throw` },
        REQUESTER,
      );
      nextDeploy = new Error("PLC timeout sau khi nhận khối");
      await expect(approveDeployment(reqRow.id, APPROVER_A, {})).rejects.toThrow(/PLC timeout/);
      expect(deployCalls).toBe(1);
      const row = await depById(reqRow.id);
      expect(row.status).toBe("failed");
      expect(row.simulated).toBe(false);
      expect((row.detailJson as Record<string, unknown>).outcome).toBe("unknown");
    } finally {
      delete process.env.DPC_DEPLOY_APPROVAL_ENABLED;
    }
  }, 60_000);

  it("★★★ fix #3b: quét lúc khởi động đóng dòng 'pending' QUÁ HẠN thành failed (gián đoạn, kết cục không rõ); dòng mới/đang duyệt giữ nguyên", async () => {
    const x = await d();
    const old = new Date(Date.now() - 60 * 60_000).toISOString();
    const fresh = new Date().toISOString();
    const mk = async (tag: string, detailJson: Record<string, unknown>, status: "pending" | "deployed" = "pending") => {
      const [row] = await x
        .insert(programDeployments)
        .values({
          buildId: build2,
          projectId,
          deviceId: nextDevice(),
          stage: "staging",
          status,
          simulated: true,
          requestedBy: REQUESTER.id,
          idempotencyKey: `${DAU}-fx3b-${tag}`,
          detailJson,
        })
        .returning();
      return row!;
    };
    const staleReserved = await mk("stale-reserved", { reservedAt: old });
    const freshReserved = await mk("fresh-reserved", { reservedAt: fresh });
    const staleApproving = await mk("stale-approving", { reservedAt: old, approvingAt: old, approvingBy: APPROVER_A.id });
    const freshApproving = await mk("fresh-approving", { approvingAt: fresh, approvingBy: APPROVER_A.id });
    // yêu cầu CŨ vừa được một approver nhận (approvingAt mới) ⇒ lượt deploy đang sống, không quét
    const oldReqFreshApproving = await mk("oldreq-fresh-approving", { reservedAt: old, approvingAt: fresh, approvingBy: APPROVER_A.id });
    const oldDeployed = await mk("old-deployed", { reservedAt: old }, "deployed");

    const res = await failInterruptedDeployments();
    expect(res.failedIds).toEqual(expect.arrayContaining([staleReserved.id, staleApproving.id]));
    expect(res.failedIds).not.toContain(freshReserved.id);
    expect(res.failedIds).not.toContain(freshApproving.id);
    expect(res.failedIds).not.toContain(oldReqFreshApproving.id);

    for (const id of [staleReserved.id, staleApproving.id]) {
      const row = await depById(id);
      expect(row.status).toBe("failed");
      expect(row.error).toMatch(/interrupted, outcome unknown/);
      expect((row.detailJson as Record<string, unknown>).outcome).toBe("unknown");
    }
    expect((await depById(freshReserved.id)).status).toBe("pending");
    expect((await depById(freshApproving.id)).status).toBe("pending");
    expect((await depById(oldReqFreshApproving.id)).status).toBe("pending");
    expect((await depById(oldDeployed.id)).status).toBe("deployed");
  }, 60_000);

  it("fix #3b: quét được GỌI lúc khởi động server (cạnh rehydrate FOE)", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("server/_core/index.ts", "utf8");
    expect(src).toMatch(/failInterruptedDeployments\(\)/);
  });
});
