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
  permissions,
  factories,
  userFactoryAssignments,
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
// fix round 1 (#1/#3) — engineer KHÔNG có quyền machine_control; engineer CÓ quyền nhưng THU HẸP về
// nhà máy F1; dự án C thuộc F1 (trong phạm vi của người thu hẹp); build B của dự án B.
let idEngKhongQuyen = 0;
let idEngThuHep = 0;
let projC = 0;
let buildB = 0;
let buildC = 0;
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

const caller = (id: number = uid, role = "admin") =>
  programmingRouter.createCaller({
    user: { id, role, twoFactorEnabled: true, username: `${DAU}_u${id}`, name: "T12B" },
    req: { ip: "127.0.0.1", headers: {} },
    res: {},
    sessionToken: `${DAU}-sess-${++demPhien}`,
  } as never);

async function soOtpDaTieu(id: number = uid): Promise<number> {
  return (await (await d()).select().from(totpConsumed).where(eq(totpConsumed.userId, id))).length;
}
/** Hình dạng lỗi NGƯỜI GỌI nhìn thấy (so khớp tuyệt đối giữa các ca). */
function hinhDangLoi(e: unknown) {
  const m = readAppErrorMeta(e);
  return { code: (e as { code?: string })?.code, appCode: m?.appCode, appParams: m?.appParams, message: (e as Error)?.message };
}
async function mkUser2FA(tag: string, role: "engineer"): Promise<number> {
  const x = await d();
  const [u] = await x
    .insert(users)
    .values({ openId: `${DAU}_${tag}`, username: `${DAU}_${tag}`, name: `T12B ${tag}`, role, loginMethod: "local", twoFactorEnabled: true })
    .returning({ id: users.id });
  await x.insert(userSecrets).values({ userId: u!.id, twoFactorSecret: SECRET });
  return u!.id;
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

const deployInput = (o: { expectedProjectId?: number; totpCode?: string; buildId?: number; who?: number }) => ({
  buildId: o.buildId ?? buildA,
  stage: "staging" as const,
  idempotencyKey: `${DAU}-k${++demKhoa}`,
  actionId: `${DAU}-a${demKhoa}`,
  confirmedBy: o.who ?? uid,
  totpCode: o.totpCode ?? otp(),
  ...(o.expectedProjectId !== undefined ? { expectedProjectId: o.expectedProjectId } : {}),
});
const fleetInput = (o: { expectedProjectId?: number; totpCode?: string; buildId?: number; who?: number }) => ({
  buildId: o.buildId ?? buildA,
  deviceIds: [990_777_001],
  stage: "staging" as const,
  strategy: { canaryCount: 1, promoteOnVerified: false, autoRollbackOnMismatch: false },
  idempotencyKeyPrefix: `${DAU}-f${++demKhoa}`,
  actionId: `${DAU}-fa${demKhoa}`,
  confirmedBy: o.who ?? uid,
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

    // fix round 1 — người dùng KHÔNG phải admin (admin bỏ qua requirePermission).
    idEngKhongQuyen = await mkUser2FA("engnoperm", "engineer");
    idEngThuHep = await mkUser2FA("engf1", "engineer");
    const [f1] = await x.insert(factories).values({ code: `${DAU}-F1`, name: `${DAU} F1` }).returning();
    await x.insert(userFactoryAssignments).values([{ userId: idEngThuHep, factoryCode: `${DAU}-F1` }]);
    await x.insert(permissions).values([
      { userId: idEngThuHep, category: "machine_monitoring", moduleName: "machine_status", canView: true },
      { userId: idEngThuHep, category: "machine_control", moduleName: "machine_control", canView: true, canCreate: true },
    ]);
    const [pc] = await x
      .insert(programProjects)
      .values({ code: `${DAU}-PC`, name: `${DAU} C`, kind: "gcode" as never, factoryId: f1!.id })
      .returning();
    projC = pc!.id;
    projectIds.push(projC);
    for (const pid of [projB, projC]) {
      const [ax] = await x
        .insert(programArtifacts)
        .values({ projectId: pid, kind: "gcode" as never, language: "text", content: "A\nB", version: 1, createdBy: uid })
        .returning();
      artifactIds.push(ax!.id);
      const bx = await buildArtifact(ax!.id, { id: uid, role: "admin" });
      buildIds.push(bx.id);
      if (pid === projB) buildB = bx.id;
      else buildC = bx.id;
    }
  }, 60_000);

  beforeEach(async () => {
    // Deploy BẬT + step-up OTP BẬT (2FA bắt buộc): thiếu cổng ⇒ lượt lệch SẼ chạm adapter.
    process.env.DPC_DEPLOY_ENABLED = "true";
    process.env.ACTUATION_STEPUP_2FA = "true";
    process.env.AUTH_2FA_BAT_BUOC = "1";
    delete process.env.DPC_VERSION_REVIEW_ENABLED;
    await __resetSoTotpChoTest([uid, idEngKhongQuyen, idEngThuHep].filter((v) => v > 0));
    deployCalls = 0;
  });

  afterAll(async () => {
    for (const k of COS) {
      if (coTruoc[k] === undefined) delete process.env[k];
      else process.env[k] = coTruoc[k];
    }
    const x = await d();
    await __resetSoTotpChoTest([uid, idEngKhongQuyen, idEngThuHep].filter((v) => v > 0));
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
    const uids = [uid, idEngKhongQuyen, idEngThuHep].filter((v) => v > 0);
    if (uids.length) await x.delete(permissions).where(inArray(permissions.userId, uids));
    if (uids.length) await x.delete(userFactoryAssignments).where(inArray(userFactoryAssignments.userId, uids));
    if (uids.length) await x.delete(userSecrets).where(inArray(userSecrets.userId, uids));
    await x.delete(factories).where(like(factories.code, `${DAU}%`));
    await x.delete(users).where(like(users.username, `${DAU}%`));
  }, 60_000);

  // ── deployBuild ──────────────────────────────────────────────────────────────────────────────
  it("deployBuild LỆCH ⇒ từ chối có mã; 0 OTP tiêu, 0 hàng deploy, 0 lượt chạm thiết bị; CÙNG mã OTP sau đó vẫn dùng được", async () => {
    const ma = otp();
    const truoc = await soHangDeploy();
    const e = await loiCua(caller().deployBuild(deployInput({ expectedProjectId: projB, totpCode: ma })));
    expect(laLoiLechDuAn(e), String(e)).toBe(true);
    // Không lộ dự án thật của build: thông điệp ĐÚNG khuôn chỉ chứa hai id người gọi tự đưa, và
    // appParams chỉ có field/reason (so khớp tuyệt đối — không dò chuỗi con của id; review Minor 4).
    expect((e as Error).message).toBe(
      `Build ${buildA} không thuộc dự án ${projB} đang mở — từ chối deploy (chọn lại build của dự án này).`,
    );
    expect(readAppErrorMeta(e)?.appParams).toEqual({ field: "expectedProjectId", reason: "buildNotInProject" });
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

  // ── fix round 1 (#1) — cổng trước OTP chạy SAU authZ (giấy phép, quyền, phạm vi) ─────────────────
  it.each(["deployBuild", "deployToFleet"] as const)(
    "%s — engineer KHÔNG có quyền machine_control: lỗi GIỐNG HỆT cho build khớp / lệch / không tồn tại (PERMISSION_DENIED), 0 OTP tiêu, 0 lần chạm thiết bị",
    async (thuTuc) => {
      const goi = (buildId: number, expectedProjectId: number) =>
        thuTuc === "deployBuild"
          ? caller(idEngKhongQuyen, "engineer").deployBuild(deployInput({ buildId, expectedProjectId, who: idEngKhongQuyen }))
          : caller(idEngKhongQuyen, "engineer").deployToFleet(fleetInput({ buildId, expectedProjectId, who: idEngKhongQuyen }));
      const khop = hinhDangLoi(await loiCua(goi(buildA, projA)));
      const lech = hinhDangLoi(await loiCua(goi(buildA, projB)));
      const khongCo = hinhDangLoi(await loiCua(goi(2_000_000_000, projA)));
      expect(khop).toMatchObject({ code: "FORBIDDEN", appCode: "PERMISSION_DENIED", appParams: { action: "canCreate" } });
      expect(lech).toEqual(khop);
      expect(khongCo).toEqual(khop);
      expect(await soOtpDaTieu(idEngKhongQuyen)).toBe(0);
      expect(deployCalls).toBe(0);
    },
  );

  it.each(["deployBuild", "deployToFleet"] as const)(
    "%s — engineer CÓ quyền nhưng build NGOÀI phạm vi nhà máy: NOT_FOUND giống hệt build không tồn tại (khớp / lệch / không có), 0 OTP tiêu",
    async (thuTuc) => {
      const goi = (buildId: number, expectedProjectId: number) =>
        thuTuc === "deployBuild"
          ? caller(idEngThuHep, "engineer").deployBuild(deployInput({ buildId, expectedProjectId, who: idEngThuHep }))
          : caller(idEngThuHep, "engineer").deployToFleet(fleetInput({ buildId, expectedProjectId, who: idEngThuHep }));
      const khop = hinhDangLoi(await loiCua(goi(buildA, projA)));
      const lech = hinhDangLoi(await loiCua(goi(buildA, projB)));
      const khongCo = hinhDangLoi(await loiCua(goi(2_000_000_000, projA)));
      expect(khongCo).toEqual({
        code: "NOT_FOUND", appCode: "ENTITY_NOT_FOUND", appParams: { entity: "programBuild" }, message: "Build 2000000000 not found",
      });
      expect(khop).toEqual({ ...khongCo, message: `Build ${buildA} not found` });
      expect(lech).toEqual(khop);
      expect(await soOtpDaTieu(idEngThuHep)).toBe(0);
      // đối chứng: build TRONG phạm vi (dự án C ở F1) mà lệch ⇒ lỗi lệch dự án (cổng không chặn mù).
      const trong = await loiCua(goi(buildC, projB));
      expect(laLoiLechDuAn(trong), String(trong)).toBe(true);
      expect(await soOtpDaTieu(idEngThuHep)).toBe(0);
    },
  );

  // ── fix round 1 (#3) — cổng đọc ĐÚNG đầu vào thủ tục dùng (top-level), không `rawInput.json` ──
  it("yêu cầu lắt léo: top-level LỆCH (build A, dự án B) + `json` KHỚP (build B, dự án B) ⇒ cổng xét top-level: lỗi lệch TRƯỚC OTP", async () => {
    const ma = otp();
    const input = {
      ...deployInput({ expectedProjectId: projB, totpCode: ma }),
      json: { buildId: buildB, expectedProjectId: projB },
    };
    const e = await loiCua(caller().deployBuild(input as never));
    expect(laLoiLechDuAn(e), String(e)).toBe(true);
    expect(await soOtpDaTieu()).toBe(0);
    expect(deployCalls).toBe(0);
  });
  it("requestDeployApproval — không quyền ⇒ PERMISSION_DENIED giống hệt; ngoài phạm vi ⇒ NOT_FOUND giống hệt (khớp / lệch / không có); 0 hàng chờ duyệt", async () => {
    const truoc = await soHangDeploy();
    const goi = (id: number, buildId: number, expectedProjectId: number) =>
      caller(id, "engineer").requestDeployApproval({ buildId, idempotencyKey: `${DAU}-rq${++demKhoa}`, reason: "ECN", expectedProjectId });
    for (const id of [idEngKhongQuyen, idEngThuHep]) {
      const khop = hinhDangLoi(await loiCua(goi(id, buildA, projA)));
      const lech = hinhDangLoi(await loiCua(goi(id, buildA, projB)));
      const khongCo = hinhDangLoi(await loiCua(goi(id, 2_000_000_000, projA)));
      if (id === idEngKhongQuyen) {
        expect(khop).toMatchObject({ code: "FORBIDDEN", appCode: "PERMISSION_DENIED" });
        expect(lech).toEqual(khop);
        expect(khongCo).toEqual(khop);
      } else {
        expect(khongCo).toMatchObject({ code: "NOT_FOUND", appCode: "ENTITY_NOT_FOUND", appParams: { entity: "programBuild" } });
        expect(khop).toEqual({ ...khongCo, message: `Build ${buildA} not found` });
        expect(lech).toEqual(khop);
      }
    }
    expect(await soHangDeploy()).toBe(truoc);
  });
});
