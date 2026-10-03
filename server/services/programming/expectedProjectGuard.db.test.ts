/**
 * doc 81 Đợt 2 Task 12b (Ruling R-2-r, mục c) — PHÒNG THỦ NHIỀU LỚP ở biên actuation:
 * `deployPreview` · `deployBuild` · `requestDeployApproval` · `deployToFleet` nhận `expectedProjectId`
 * TUỲ CHỌN. Có mặt mà KHÁC dự án của build ⇒ TỪ CHỐI bằng appError có mã
 * (CONFLICT · INVALID_VALUE{field:"expectedProjectId", reason:"buildNotInProject"}) TRƯỚC mọi lượt
 * tiêu OTP, mọi lượt ghi sổ, mọi lượt chạm thiết bị. Vắng ⇒ hành vi hôm nay (người gọi API cũ).
 *
 * Mối nguy đo được ở review task 12: IDE đang hiện P2 mà build #5 (của P1) còn được chọn ⇒ người dùng
 * OTP-deploy build của P1 xuống máy của P1 (deploy đơn không gửi deviceId; server chỉ lấy buildId).
 *
 * CSDL THẬT (`_test`, ép bởi vitest.setup). Không mock middleware nào: vai, require2FA, step-up OTP
 * (cờ ACTUATION_STEPUP_2FA BẬT, secret TOTP THẬT, sổ `totp_consumed` THẬT). Adapter "gcode" là một
 * adapter THỬ có đường ghi thật (đếm `deployCalls`) — cách duy nhất để "chạm thiết bị" đo được khi
 * không có phần cứng; deploy BẬT + ký + sim ĐẠT ⇒ không có cổng này thì lượt lệch SẼ chạm thiết bị.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

vi.hoisted(() => {
  process.env.AUDIT_ALL_MUTATIONS = "false";
  process.env.LICENSE_MODULE_GATE_ENABLED = "false";
});

import speakeasy from "speakeasy";
import { and, eq, inArray, like } from "drizzle-orm";
import { getDb } from "../../db/connection";
import {
  users,
  userSecrets,
  totpConsumed,
  programProjects,
  programArtifacts,
  programBuilds,
  programSimRuns,
  programDeployments,
  aiPendingActions,
} from "../../../drizzle/schema";
import { programmingRouter } from "../../routers/programmingRouter";
import {
  StubProgrammingAdapter,
  registerProgrammingAdapter,
  type BuildResult,
  type ProgDeployOpts,
  type ProgDeployResult,
} from "./programmingAdapter";
import { buildArtifact, simulateBuild, type DeployGate } from "./programmingService";
import { readAppErrorMeta } from "../../_core/appError";
import { __resetSoTotpChoTest } from "../../_core/totpOnce";

const DB_URL = process.env.DATABASE_URL;
const DAU = `T12B-${Date.now().toString(36)}`;
const SECRET = "K52U24CYJRNTQSKMG47FKUSHKFKUQW2D";
const otp = () => speakeasy.totp({ secret: SECRET, encoding: "base32" });

class GhiThatAdapter extends StubProgrammingAdapter {
  override readonly kind = "gcode" as const;
  override async deploy(_b: BuildResult, _o: ProgDeployOpts): Promise<ProgDeployResult> {
    deployCalls++;
    return { ok: true, status: "deployed", simulated: false, detail: { note: "test device write" } };
  }
  async previewDeploy(): Promise<DeployGate[]> {
    return [{ name: "adapterPath", ok: true, reason: "testDeviceWrite" }];
  }
}
let deployCalls = 0;

const COS = ["DPC_DEPLOY_ENABLED", "ACTUATION_STEPUP_2FA", "AUTH_2FA_BAT_BUOC", "DPC_VERSION_REVIEW_ENABLED"] as const;
const coTruoc: Record<string, string | undefined> = {};

let uid = 0;
let projA = 0;
let projB = 0;
let buildA = 0;
const projectIds: number[] = [];
const artifactIds: number[] = [];
const buildIds: number[] = [];
let demPhien = 0;
let demKhoa = 0;

async function d() {
  const x = await getDb();
  if (!x) throw new Error("no db");
  return x;
}

const caller = () =>
  programmingRouter.createCaller({
    user: { id: uid, role: "admin", twoFactorEnabled: true, username: `${DAU}_u`, name: "T12B" },
    req: { ip: "127.0.0.1", headers: {} },
    res: {},
    sessionToken: `${DAU}-sess-${++demPhien}`,
  } as never);

async function soOtpDaTieu(): Promise<number> {
  return (await (await d()).select().from(totpConsumed).where(eq(totpConsumed.userId, uid))).length;
}
async function soHangDeploy(): Promise<number> {
  return (await (await d()).select().from(programDeployments).where(inArray(programDeployments.projectId, [projA, projB]))).length;
}

/** Lỗi lệch dự án: đúng mã, đúng tham số; không lộ dự án thật của build. */
function laLoiLechDuAn(e: unknown): boolean {
  const m = readAppErrorMeta(e);
  return (
    (e as { code?: string })?.code === "CONFLICT" &&
    m?.appCode === "INVALID_VALUE" &&
    m.appParams?.field === "expectedProjectId" &&
    m.appParams?.reason === "buildNotInProject"
  );
}
async function loiCua(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
    return null;
  } catch (e) {
    return e;
  }
}

const deployInput = (o: { expectedProjectId?: number; totpCode?: string }) => ({
  buildId: buildA,
  stage: "staging" as const,
  idempotencyKey: `${DAU}-k${++demKhoa}`,
  actionId: `${DAU}-a${demKhoa}`,
  confirmedBy: uid,
  totpCode: o.totpCode ?? otp(),
  ...(o.expectedProjectId !== undefined ? { expectedProjectId: o.expectedProjectId } : {}),
});
const fleetInput = (o: { expectedProjectId?: number; totpCode?: string }) => ({
  buildId: buildA,
  deviceIds: [990_777_001],
  stage: "staging" as const,
  strategy: { canaryCount: 1, promoteOnVerified: false, autoRollbackOnMismatch: false },
  idempotencyKeyPrefix: `${DAU}-f${++demKhoa}`,
  actionId: `${DAU}-fa${demKhoa}`,
  confirmedBy: uid,
  totpCode: o.totpCode ?? otp(),
  ...(o.expectedProjectId !== undefined ? { expectedProjectId: o.expectedProjectId } : {}),
});

describe.skipIf(!DB_URL)("Task 12b (c) — expectedProjectId ở biên deploy (router sản xuất, CSDL _test)", () => {
  beforeAll(async () => {
    for (const k of COS) coTruoc[k] = process.env[k];
    registerProgrammingAdapter("gcode", () => new GhiThatAdapter());
    const x = await d();
    const [u] = await x
      .insert(users)
      .values({ openId: `${DAU}_u`, username: `${DAU}_u`, name: "T12B", role: "admin", loginMethod: "local", twoFactorEnabled: true })
      .returning({ id: users.id });
    uid = u!.id;
    await x.insert(userSecrets).values({ userId: uid, twoFactorSecret: SECRET });
    const [pa] = await x.insert(programProjects).values({ code: `${DAU}-PA`, name: `${DAU} A`, kind: "gcode" as never }).returning();
    const [pb] = await x.insert(programProjects).values({ code: `${DAU}-PB`, name: `${DAU} B`, kind: "gcode" as never }).returning();
    projA = pa!.id;
    projB = pb!.id;
    projectIds.push(projA, projB);
    const [a] = await x
      .insert(programArtifacts)
      .values({ projectId: projA, kind: "gcode" as never, language: "text", content: "A\nB", version: 1, createdBy: uid })
      .returning();
    artifactIds.push(a!.id);
    const b = await buildArtifact(a!.id, { id: uid, role: "admin" });
    buildA = b.id;
    buildIds.push(b.id);
    await simulateBuild(b.id, {}, { id: uid, role: "admin" });
  }, 60_000);

  beforeEach(async () => {
    // Deploy BẬT + step-up OTP BẬT (2FA bắt buộc): thiếu cổng ⇒ lượt lệch SẼ chạm adapter.
    process.env.DPC_DEPLOY_ENABLED = "true";
    process.env.ACTUATION_STEPUP_2FA = "true";
    process.env.AUTH_2FA_BAT_BUOC = "1";
    delete process.env.DPC_VERSION_REVIEW_ENABLED;
    await __resetSoTotpChoTest([uid]);
    deployCalls = 0;
  });

  afterAll(async () => {
    for (const k of COS) {
      if (coTruoc[k] === undefined) delete process.env[k];
      else process.env[k] = coTruoc[k];
    }
    const x = await d();
    await __resetSoTotpChoTest([uid]);
    if (projectIds.length) {
      const deps = await x.select().from(programDeployments).where(inArray(programDeployments.projectId, projectIds));
      const pendingIds = deps
        .map((r) => (r.detailJson as Record<string, unknown> | null)?.pendingActionId)
        .filter((v): v is string => typeof v === "string");
      if (pendingIds.length) await x.delete(aiPendingActions).where(inArray(aiPendingActions.id, pendingIds));
      // program_deployments là sổ APPEND-ONLY ⇒ đóng mọi dòng còn mở (không xoá).
      await x
        .update(programDeployments)
        .set({ status: "rejected", error: `${DAU} test fixture closed` })
        .where(and(inArray(programDeployments.projectId, projectIds), inArray(programDeployments.status, ["awaiting_approval", "pending"])));
    }
    if (buildIds.length) await x.delete(programSimRuns).where(inArray(programSimRuns.buildId, buildIds));
    if (artifactIds.length) await x.delete(programBuilds).where(inArray(programBuilds.artifactId, artifactIds));
    if (artifactIds.length) await x.delete(programArtifacts).where(inArray(programArtifacts.id, artifactIds));
    await x.delete(programProjects).where(like(programProjects.code, `${DAU}%`));
    if (uid) await x.delete(userSecrets).where(eq(userSecrets.userId, uid));
    await x.delete(users).where(like(users.username, `${DAU}%`));
  }, 60_000);

  // ── deployBuild ──────────────────────────────────────────────────────────────────────────────
  it("deployBuild LỆCH ⇒ từ chối có mã; 0 OTP tiêu, 0 hàng deploy, 0 lượt chạm thiết bị; CÙNG mã OTP sau đó vẫn dùng được", async () => {
    const ma = otp();
    const truoc = await soHangDeploy();
    const e = await loiCua(caller().deployBuild(deployInput({ expectedProjectId: projB, totpCode: ma })));
    expect(laLoiLechDuAn(e), String(e)).toBe(true);
    expect(String((e as Error).message)).not.toContain(String(projA)); // không lộ dự án thật của build
    expect(await soOtpDaTieu()).toBe(0);
    expect(await soHangDeploy()).toBe(truoc);
    expect(deployCalls).toBe(0);
    // Mã chưa bị tiêu ⇒ lượt KHỚP ngay sau đó với CÙNG mã đi qua step-up và deploy thật.
    const row = await caller().deployBuild(deployInput({ expectedProjectId: projA, totpCode: ma }));
    expect(row.status).toBe("deployed");
    expect(row.projectId).toBe(projA);
    expect(await soOtpDaTieu()).toBe(1);
    expect(deployCalls).toBe(1);
  });

  it("deployBuild LỆCH + OTP SAI ⇒ vẫn là lỗi lệch dự án (cổng chạy TRƯỚC step-up), 0 OTP tiêu", async () => {
    const e = await loiCua(caller().deployBuild(deployInput({ expectedProjectId: projB, totpCode: "000000" })));
    expect(laLoiLechDuAn(e), String(e)).toBe(true);
    expect(await soOtpDaTieu()).toBe(0);
  });

  it("deployBuild VẮNG expectedProjectId ⇒ hành vi hôm nay (deploy thật)", async () => {
    const row = await caller().deployBuild(deployInput({}));
    expect(row.status).toBe("deployed");
    expect(deployCalls).toBe(1);
  });

  // ── deployToFleet ────────────────────────────────────────────────────────────────────────────
  it("deployToFleet LỆCH ⇒ từ chối có mã; 0 OTP tiêu, 0 hàng deploy, 0 lượt chạm thiết bị", async () => {
    const truoc = await soHangDeploy();
    const e = await loiCua(caller().deployToFleet(fleetInput({ expectedProjectId: projB })));
    expect(laLoiLechDuAn(e), String(e)).toBe(true);
    expect(await soOtpDaTieu()).toBe(0);
    expect(await soHangDeploy()).toBe(truoc);
    expect(deployCalls).toBe(0);
  });

  it.each([
    ["KHỚP", () => projA],
    ["VẮNG", () => undefined],
  ])("deployToFleet %s ⇒ qua cổng dự án (OTP được xác minh = đã tới step-up), không lỗi lệch", async (_n, exp) => {
    const e = await loiCua(caller().deployToFleet(fleetInput({ expectedProjectId: exp() })));
    expect(laLoiLechDuAn(e)).toBe(false);
    expect(await soOtpDaTieu()).toBe(1);
  });

  // ── requestDeployApproval (không OTP) ────────────────────────────────────────────────────────
  it("requestDeployApproval LỆCH ⇒ từ chối có mã, 0 hàng chờ duyệt; KHỚP / VẮNG ⇒ tạo yêu cầu như hôm nay", async () => {
    const truoc = await soHangDeploy();
    const base = () => ({ buildId: buildA, idempotencyKey: `${DAU}-r${++demKhoa}`, reason: "ECN-1" });
    const e = await loiCua(caller().requestDeployApproval({ ...base(), expectedProjectId: projB }));
    expect(laLoiLechDuAn(e), String(e)).toBe(true);
    expect(await soHangDeploy()).toBe(truoc);
    const r1 = await caller().requestDeployApproval({ ...base(), expectedProjectId: projA });
    const r2 = await caller().requestDeployApproval(base());
    expect(r1.projectId).toBe(projA);
    expect(r2.projectId).toBe(projA);
    expect(await soHangDeploy()).toBe(truoc + 2);
  });

  // ── deployPreview (query) ────────────────────────────────────────────────────────────────────
  it("deployPreview LỆCH ⇒ từ chối có mã; KHỚP / VẮNG ⇒ verdict như hôm nay", async () => {
    const e = await loiCua(caller().deployPreview({ buildId: buildA, stage: "staging", confirmedBy: uid, expectedProjectId: projB }));
    expect(laLoiLechDuAn(e), String(e)).toBe(true);
    const khop = await caller().deployPreview({ buildId: buildA, stage: "staging", confirmedBy: uid, expectedProjectId: projA });
    const vang = await caller().deployPreview({ buildId: buildA, stage: "staging", confirmedBy: uid });
    expect(khop.verdict).toBe("real");
    expect(vang).toEqual(khop);
  });

  it("build KHÔNG tồn tại + expectedProjectId ⇒ NOT_FOUND trước step-up (fail-closed), 0 OTP tiêu", async () => {
    const e = await loiCua(caller().deployBuild({ ...deployInput({ expectedProjectId: projA }), buildId: 2_000_000_000 }));
    expect(readAppErrorMeta(e)?.appCode).toBe("ENTITY_NOT_FOUND");
    expect(await soOtpDaTieu()).toBe(0);
  });
});
