/**
 * doc 80 Đợt 1 Task 5 (WS-02 / F2) — `programming.deployPreview` KHỚP deploy THẬT.
 *
 * ══════════════════════════════════════════════════════════════════════════════
 * Mệnh đề ăn tiền: ∀ tổ hợp (cờ × người gọi × loại adapter × trạng thái build/sim/duyệt), verdict
 * của bản xem trước == kết cục của lượt deploy THẬT chạy trên CÙNG đầu vào. Không ca nào ghi tay
 * verdict mong đợi rồi so với bản xem trước: MỖI ca gọi CẢ HAI thủ tục SẢN XUẤT qua
 * `programmingRouter.createCaller` (deployPreview rồi deployBuild — hoặc requestDeployApproval +
 * approveDeployment của người KHÁC ở Hộp duyệt) và so. Kết cục thật được đọc từ đúng thứ người
 * dùng nhận: hàng deploy (deployed/verified ⇒ real · simulated ⇒ simulated · rejected/failed ⇒
 * blocked) hoặc lỗi ném ra (vai / 2FA / zod / checksum ⇒ blocked).
 *
 * CSDL THẬT (`_test`, ép bởi vitest.setup): cổng Simulation Gate / duyệt phiên bản / dispatcher OT
 * (MELSEC ⇒ ai_pending_actions) đều là truy vấn thật. Không mock middleware nào (vai, require2FA,
 * step-up chế độ nội bộ ghi audit thật).
 *
 * Adapter "gcode" (loại DỰ KIẾN, chưa có factory) được đăng ký một adapter THỬ có đường ghi thành
 * công ⇒ cách DUY NHẤT để có verdict `real` khi không có phần cứng. Nó tự khai `previewDeploy` —
 * phần adapter của ca ấy là giả ở CẢ HAI phía; phần được đo là MỌI cổng dịch vụ + người gọi.
 * Các loại thật (stub / robot-tm / iec61131-st / zmotion-basic / mitsubishi-engineering) chạy
 * adapter THẬT ở cả hai phía.
 * ══════════════════════════════════════════════════════════════════════════════
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";

vi.hoisted(() => {
  process.env.AUDIT_ALL_MUTATIONS = "false";
  process.env.LICENSE_MODULE_GATE_ENABLED = "false";
});

import { and, eq, inArray, like } from "drizzle-orm";
import { getDb } from "../../db/connection";
import {
  users,
  permissions,
  programProjects,
  programArtifacts,
  programBuilds,
  programSimRuns,
  programDeployments,
  aiPendingActions,
  commandLog,
} from "../../../drizzle/schema";
import { programmingRouter } from "../../routers/programmingRouter";
import {
  StubProgrammingAdapter,
  registerProgrammingAdapter,
  type BuildResult,
  type ProgDeployOpts,
  type ProgDeployResult,
} from "./programmingAdapter";
import { buildArtifact, simulateBuild, reviewArtifact, type DeployGate } from "./programmingService";
import type { DeployVerdict } from "./deployPreview";

const DB_URL = process.env.DATABASE_URL;
const DAU = `T5PREV-${Date.now().toString(36)}`;

/** Adapter THỬ có đường ghi thành công (verdict `real`) + tự khai bản xem trước. */
class GhiThatAdapter extends StubProgrammingAdapter {
  override readonly kind = "gcode" as const;
  deployCalls = 0;
  override async deploy(_b: BuildResult, _o: ProgDeployOpts): Promise<ProgDeployResult> {
    this.deployCalls++;
    return { ok: true, status: "deployed", simulated: false, detail: { note: "test device write" } };
  }
  async previewDeploy(): Promise<DeployGate[]> {
    return [{ name: "adapterPath", ok: true, reason: "testDeviceWrite" }];
  }
}

const COS = [
  "DPC_DEPLOY_ENABLED",
  "DPC_VERSION_REVIEW_ENABLED",
  "DPC_DEPLOY_APPROVAL_ENABLED",
  "AUTH_2FA_BAT_BUOC",
  "ACTUATION_STEPUP_2FA",
  "ZMC_ENDPOINT",
  "OT_CONTROL_ENABLED",
] as const;
type Co = Partial<Record<(typeof COS)[number], string>>;
const coTruoc: Record<string, string | undefined> = {};

/** Ghim BỘ cờ cho một ca: cờ không nêu ⇒ XOÁ (không để cờ ca trước rơi sang). */
function datCo(co: Co) {
  for (const k of COS) {
    const v = co[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

let idAdmin = 0; // admin, CHƯA bật 2FA
let idAdmin2 = 0; // admin thứ hai — người duyệt ở Hộp duyệt / người ký production
let idOper = 0; // operator — ngoài sàn vai deploy
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

async function mkUser(tag: string, role: "admin" | "operator"): Promise<number> {
  const [u] = await (await d())
    .insert(users)
    .values({ openId: `${DAU}_${tag}`, username: `${DAU}_${tag}`, name: `T5 ${tag}`, role, loginMethod: "local", twoFactorEnabled: false })
    .returning({ id: users.id });
  return u!.id;
}

const caller = (id: number, role: string, twoFactorEnabled = false) =>
  programmingRouter.createCaller({
    user: { id, role, twoFactorEnabled, username: `u${id}`, name: `u${id}` },
    req: { ip: "127.0.0.1", headers: {} },
    res: {},
    sessionToken: `${DAU}-sess-${++demPhien}`,
  } as never);

/** Một dự án + phiên bản + build THẬT (compile của adapter thật) [+ sim THẬT]. */
async function seedBuild(o: {
  kind: string;
  language: string;
  content: string;
  deviceId?: number | null;
  approve?: boolean;
  sim?: boolean;
}): Promise<{ buildId: number; artifactId: number }> {
  const x = await d();
  const [p] = await x
    .insert(programProjects)
    .values({ code: `${DAU}-P${++demKhoa}`, name: `${DAU}`, kind: o.kind as never, deviceId: o.deviceId ?? null })
    .returning();
  projectIds.push(p!.id);
  const [a] = await x
    .insert(programArtifacts)
    .values({ projectId: p!.id, kind: o.kind as never, language: o.language, content: o.content, version: 1, createdBy: idAdmin })
    .returning();
  artifactIds.push(a!.id);
  if (o.approve) await reviewArtifact(a!.id, "approved", { id: idAdmin2, role: "admin" });
  const b = await buildArtifact(a!.id, { id: idAdmin, role: "admin" });
  buildIds.push(b.id);
  if (o.sim) await simulateBuild(b.id, {}, { id: idAdmin, role: "admin" });
  return { buildId: b.id, artifactId: a!.id };
}

function verdictCuaTrangThai(status: string): DeployVerdict {
  if (status === "deployed" || status === "verified") return "real";
  if (status === "simulated") return "simulated";
  if (status === "rejected" || status === "failed") return "blocked";
  throw new Error(`trạng thái deploy chưa kết thúc: ${status}`);
}

/** Kết cục THẬT của một lượt gọi deploy: trạng thái hàng, hoặc `blocked` khi thủ tục ném. */
async function ketCucThat(p: Promise<{ status: string }>): Promise<{ verdict: DeployVerdict; loi: unknown }> {
  try {
    const row = await p;
    return { verdict: verdictCuaTrangThai(row.status), loi: null };
  } catch (e) {
    return { verdict: "blocked", loi: e };
  }
}

interface Ca {
  ten: string;
  co: Co;
  callerId: () => number;
  role?: string;
  twoFa?: boolean;
  seed: () => Promise<{ buildId: number }>;
  stage: "staging" | "production";
  /** Người ký UI sẽ gửi: "self" = chính người gọi (tick sign-off), "other" = admin2, undefined = không. */
  ky?: "self" | "other";
  /** verdict kỳ vọng — CHỈ để ghim rằng bộ ca PHỦ đủ ba verdict, KHÔNG phải phép so chính. */
  phu: DeployVerdict;
  /** mã lý do bản xem trước phải nêu (cổng chặn/mô phỏng đặc trưng của ca). */
  lyDo?: string;
}

const STUB_SRC = "A\nB";
const ST_SRC = "VAR x : BOOL; END_VAR\nx := TRUE;";
const ZMC_SRC = "MOVE(10)\nMOVE(20)";
const TM_SRC = "POINT P1 = (0,0,0,0,0,0)\nHOME\nMOVE P1";
const MELSEC_SRC = "D100 = 1234\nM0 = 1";

const NOI_BO: Co = { AUTH_2FA_BAT_BUOC: "0" }; // chế độ nội bộ — quyết định chủ dự án (2FA không bắt buộc)
const BAT: Co = { ...NOI_BO, DPC_DEPLOY_ENABLED: "true" };

const CAC_CA: Ca[] = [
  {
    ten: "C1 mọi cờ TẮT, staging, không ký ⇒ mô phỏng",
    co: NOI_BO, callerId: () => idAdmin, stage: "staging", phu: "simulated", lyDo: "deployDisabled",
    seed: () => seedBuild({ kind: "stub", language: "text", content: STUB_SRC }),
  },
  {
    ten: "C2 deploy BẬT, ký, adapter ghi được, sim ĐẠT ⇒ thật",
    co: BAT, callerId: () => idAdmin, stage: "staging", ky: "self", phu: "real",
    seed: () => seedBuild({ kind: "gcode", language: "text", content: STUB_SRC, sim: true }),
  },
  {
    ten: "C3 deploy BẬT, ký, CHƯA mô phỏng ⇒ chặn (Simulation Gate)",
    co: BAT, callerId: () => idAdmin, stage: "staging", ky: "self", phu: "blocked", lyDo: "simRequired",
    seed: () => seedBuild({ kind: "gcode", language: "text", content: STUB_SRC }),
  },
  {
    ten: "C4 deploy BẬT, KHÔNG ký ⇒ mô phỏng (adapter không được gọi)",
    co: BAT, callerId: () => idAdmin, stage: "staging", phu: "simulated", lyDo: "noSignOff",
    seed: () => seedBuild({ kind: "gcode", language: "text", content: STUB_SRC, sim: true }),
  },
  {
    ten: "C5 production tự ký (confirmedBy = người yêu cầu) ⇒ chặn SoD",
    co: BAT, callerId: () => idAdmin, stage: "production", ky: "self", phu: "blocked", lyDo: "selfSignOff",
    seed: () => seedBuild({ kind: "gcode", language: "text", content: STUB_SRC, sim: true }),
  },
  {
    ten: "C6 production người ký KHÁC ⇒ thật",
    co: BAT, callerId: () => idAdmin, stage: "production", ky: "other", phu: "real",
    seed: () => seedBuild({ kind: "gcode", language: "text", content: STUB_SRC, sim: true }),
  },
  {
    ten: "C7 production KHÔNG người ký (zod four-eyes) ⇒ chặn",
    co: BAT, callerId: () => idAdmin, stage: "production", phu: "blocked", lyDo: "approverRequired",
    seed: () => seedBuild({ kind: "gcode", language: "text", content: STUB_SRC, sim: true }),
  },
  {
    ten: "C8 duyệt phiên bản BẬT, phiên bản chưa duyệt ⇒ chặn (dù deploy TẮT)",
    co: { ...NOI_BO, DPC_VERSION_REVIEW_ENABLED: "true" }, callerId: () => idAdmin, stage: "staging", phu: "blocked", lyDo: "versionNotApproved",
    // build trước khi bật cờ (cờ chỉ ghim trong ca) ⇒ có build của phiên bản chưa duyệt.
    seed: () => seedBuild({ kind: "stub", language: "text", content: STUB_SRC }),
  },
  {
    ten: "C9 duyệt phiên bản BẬT, đã duyệt bởi người khác, deploy BẬT + ký + sim ⇒ thật",
    co: { ...BAT, DPC_VERSION_REVIEW_ENABLED: "true" }, callerId: () => idAdmin, stage: "staging", ky: "self", phu: "real",
    seed: () => seedBuild({ kind: "gcode", language: "text", content: STUB_SRC, sim: true, approve: true }),
  },
  {
    ten: "C10 2FA BẮT BUỘC (AUTH_2FA_BAT_BUOC=1), admin chưa bật 2FA ⇒ chặn",
    co: { AUTH_2FA_BAT_BUOC: "1", DPC_DEPLOY_ENABLED: "true" }, callerId: () => idAdmin, stage: "staging", ky: "self", phu: "blocked", lyDo: "twoFactorNotSetUp",
    seed: () => seedBuild({ kind: "gcode", language: "text", content: STUB_SRC, sim: true }),
  },
  {
    ten: "C11 chế độ NỘI BỘ + step-up BẬT, admin chưa bật 2FA ⇒ BỎ QUA (có ghi sổ) ⇒ thật",
    co: { ...BAT, ACTUATION_STEPUP_2FA: "true" }, callerId: () => idAdmin, stage: "staging", ky: "self", phu: "real", lyDo: "stepUpBypassedInternalMode",
    seed: () => seedBuild({ kind: "gcode", language: "text", content: STUB_SRC, sim: true }),
  },
  {
    ten: "C12 vai operator ⇒ chặn (sàn vai deploy)",
    co: BAT, callerId: () => idOper, role: "operator", stage: "staging", ky: "self", phu: "blocked", lyDo: "roleNotAllowed",
    seed: () => seedBuild({ kind: "gcode", language: "text", content: STUB_SRC, sim: true }),
  },
  {
    ten: "C13 stub thật, đường ghi thật ⇒ mô phỏng (stub không có đường thiết bị)",
    co: BAT, callerId: () => idAdmin, stage: "staging", ky: "self", phu: "simulated", lyDo: "stubNoDevicePath",
    seed: () => seedBuild({ kind: "stub", language: "text", content: STUB_SRC, sim: true }),
  },
  {
    ten: "C14 robot-tm thật ⇒ chặn (techman_program_download_unsupported, 0 byte)",
    co: BAT, callerId: () => idAdmin, stage: "staging", ky: "self", phu: "blocked", lyDo: "techman_program_download_unsupported",
    seed: () => seedBuild({ kind: "robot-tm", language: "tmscript", content: TM_SRC, sim: true }),
  },
  {
    ten: "C15 iec61131-st thật ⇒ chặn (chưa có host OpenPLC)",
    co: BAT, callerId: () => idAdmin, stage: "staging", ky: "self", phu: "blocked", lyDo: "openplcNotConfigured",
    seed: () => seedBuild({ kind: "iec61131-st", language: "st", content: ST_SRC, sim: true }),
  },
  {
    ten: "C16 zmotion-basic thật, KHÔNG ZMC_ENDPOINT ⇒ chặn",
    co: BAT, callerId: () => idAdmin, stage: "staging", ky: "self", phu: "blocked", lyDo: "zmcEndpointMissing",
    seed: () => seedBuild({ kind: "zmotion-basic", language: "basic", content: ZMC_SRC, sim: true }),
  },
  {
    ten: "C17 zmotion-basic thật, CÓ endpoint (không cổng dò) nhưng chưa có DLL ⇒ chặn",
    co: { ...BAT, ZMC_ENDPOINT: "127.0.0.1" }, callerId: () => idAdmin, stage: "staging", ky: "self", phu: "blocked", lyDo: "zauxDllPathMissing",
    seed: () => seedBuild({ kind: "zmotion-basic", language: "basic", content: ZMC_SRC, sim: true }),
  },
  {
    ten: "C18 mitsubishi thật, đường TRỰC TIẾP ⇒ chặn (dispatcher: actionId không gắn hàng HITL confirmed)",
    co: BAT, callerId: () => idAdmin, stage: "staging", ky: "self", phu: "blocked", lyDo: "otActionNotBound",
    seed: () => seedBuild({ kind: "mitsubishi-engineering", language: "device", content: MELSEC_SRC, sim: true, deviceId: 990_555_001 }),
  },
];

describe.skipIf(!DB_URL)("Task 5 — deployPreview khớp deploy THẬT (router sản xuất, CSDL thật)", () => {
  beforeAll(async () => {
    for (const k of COS) coTruoc[k] = process.env[k];
    registerProgrammingAdapter("gcode", () => new GhiThatAdapter());
    idAdmin = await mkUser("admin", "admin");
    idAdmin2 = await mkUser("admin2", "admin");
    idOper = await mkUser("oper", "operator");
    // operator ĐƯỢC cấp đủ bit (xem + machine_control/canCreate) ⇒ thứ duy nhất chặn nó là SÀN VAI
    // của deployProcedure — ca C12 đo đúng cổng ấy, không đo "thiếu quyền".
    await (await d()).insert(permissions).values([
      { userId: idOper, category: "machine_monitoring", moduleName: "machine_status", canView: true },
      { userId: idOper, category: "machine_control", moduleName: "machine_control", canView: true, canCreate: true },
    ]);
  }, 60_000);

  afterEach(() => datCo(NOI_BO));

  afterAll(async () => {
    for (const k of COS) {
      if (coTruoc[k] === undefined) delete process.env[k];
      else process.env[k] = coTruoc[k];
    }
    const x = await d();
    if (projectIds.length) {
      const deps = await x.select().from(programDeployments).where(inArray(programDeployments.projectId, projectIds));
      const pendingIds = deps
        .map((r) => (r.detailJson as Record<string, unknown> | null)?.pendingActionId)
        .filter((v): v is string => typeof v === "string");
      if (pendingIds.length) await x.delete(aiPendingActions).where(inArray(aiPendingActions.id, pendingIds));
      // program_deployments là sổ APPEND-ONLY (vai app không có DELETE) ⇒ đóng mọi dòng còn mở.
      await x
        .update(programDeployments)
        .set({ status: "rejected", error: `${DAU} test fixture closed` })
        .where(and(inArray(programDeployments.projectId, projectIds), inArray(programDeployments.status, ["awaiting_approval", "pending"])));
    }
    if (buildIds.length) await x.delete(programSimRuns).where(inArray(programSimRuns.buildId, buildIds));
    if (artifactIds.length) await x.delete(programBuilds).where(inArray(programBuilds.artifactId, artifactIds));
    if (artifactIds.length) await x.delete(programArtifacts).where(inArray(programArtifacts.id, artifactIds));
    await x.delete(programProjects).where(like(programProjects.code, `${DAU}%`));
    try {
      await x.delete(commandLog).where(like(commandLog.idempotencyKey, `${DAU}%`));
    } catch {
      /* command_log có thể là WORM với vai app — hàng 'rejected' của ca MELSEC mang khoá riêng DAU */
    }
    if (idOper) await x.delete(permissions).where(eq(permissions.userId, idOper));
    await x.delete(users).where(like(users.username, `${DAU}%`));
  }, 60_000);

  it("bộ ca phủ ĐỦ ba verdict và ≥4 tổ hợp cờ khác nhau", () => {
    const phu = new Set(CAC_CA.map((c) => c.phu));
    expect([...phu].sort()).toEqual(["blocked", "real", "simulated"]);
    const toHop = new Set(CAC_CA.map((c) => JSON.stringify(c.co)));
    expect(toHop.size).toBeGreaterThanOrEqual(4);
  });

  for (const ca of CAC_CA) {
    it(ca.ten, async () => {
      // Build/sim được dựng với cờ duyệt phiên bản TẮT (cờ của ca chỉ ghim cho preview + deploy).
      datCo(NOI_BO);
      const { buildId } = await ca.seed();
      datCo(ca.co);
      const id = ca.callerId();
      const role = ca.role ?? "admin";
      const confirmedBy = ca.ky === "self" ? id : ca.ky === "other" ? idAdmin2 : undefined;

      const preview = await caller(id, role, ca.twoFa).deployPreview({ buildId, stage: ca.stage, confirmedBy });
      const that = await ketCucThat(
        caller(id, role, ca.twoFa).deployBuild({
          buildId,
          stage: ca.stage,
          idempotencyKey: `${DAU}-k${++demKhoa}`,
          actionId: `${DAU}-act${demKhoa}`,
          confirmedBy,
          reason: ca.stage === "production" ? "T5 preview parity" : undefined,
          totpCode: "",
        }),
      );

      // ★ Phép so CHÍNH: bản xem trước == kết cục thật.
      expect({ ca: ca.ten, verdict: preview.verdict }).toEqual({ ca: ca.ten, verdict: that.verdict });
      // Ghim phủ (không phải phép so chính): ca này đúng là ca của verdict nó đại diện.
      expect(that.verdict).toBe(ca.phu);
      if (ca.lyDo) expect(preview.gates.map((g) => g.reason)).toContain(ca.lyDo);
      expect(preview.target.buildId).toBe(buildId);
    });
  }

  it("C19 Hộp duyệt (production + DPC_DEPLOY_APPROVAL_ENABLED): preview == requestDeployApproval → approveDeployment của NGƯỜI KHÁC", async () => {
    datCo(NOI_BO);
    const { buildId } = await seedBuild({ kind: "gcode", language: "text", content: STUB_SRC, sim: true });
    datCo({ ...BAT, DPC_DEPLOY_APPROVAL_ENABLED: "true" });
    const preview = await caller(idAdmin, "admin").deployPreview({ buildId, stage: "production" });
    expect(preview.target.path).toBe("approvalInbox");
    const req = await caller(idAdmin, "admin").requestDeployApproval({
      buildId,
      idempotencyKey: `${DAU}-inbox-${++demKhoa}`,
      reason: "T5 inbox parity",
    });
    expect(req.status).toBe("awaiting_approval");
    const that = await ketCucThat(caller(idAdmin2, "admin").approveDeployment({ deploymentId: req.id, totpCode: "" }));
    expect(preview.verdict).toBe(that.verdict);
    expect(that.verdict).toBe("real");
  });

  it("C20 Hộp duyệt + MELSEC: preview == kết cục thật (hàng HITL thật qua được xác thực, dispatcher đi tiếp)", async () => {
    datCo(NOI_BO);
    const { buildId } = await seedBuild({
      kind: "mitsubishi-engineering", language: "device", content: MELSEC_SRC, sim: true, deviceId: 990_555_002,
    });
    datCo({ ...BAT, DPC_DEPLOY_APPROVAL_ENABLED: "true" });
    const preview = await caller(idAdmin, "admin").deployPreview({ buildId, stage: "production" });
    const req = await caller(idAdmin, "admin").requestDeployApproval({
      buildId,
      idempotencyKey: `${DAU}-inbox-${++demKhoa}`,
      reason: "T5 inbox melsec parity",
    });
    const that = await ketCucThat(caller(idAdmin2, "admin").approveDeployment({ deploymentId: req.id, totpCode: "" }));
    expect(preview.verdict).toBe(that.verdict);
    // adapter OT 990555002 không tồn tại ⇒ dispatcher ADAPTER_DISABLED ⇒ chặn; bản xem trước nêu đúng cổng.
    expect(preview.gates.map((g) => g.reason)).toContain("otAdapterDisabled");
  });

  it("C21 checksum LỆCH (build đã lưu ≠ biên dịch lại): preview chặn buildChecksumMismatch == deploy thật PRECONDITION_FAILED", async () => {
    datCo(NOI_BO);
    const { buildId } = await seedBuild({ kind: "gcode", language: "text", content: STUB_SRC, sim: true });
    await (await d()).update(programBuilds).set({ outputRef: "stub://build/99-lines" }).where(eq(programBuilds.id, buildId));
    datCo(BAT);
    const preview = await caller(idAdmin, "admin").deployPreview({ buildId, stage: "staging", confirmedBy: idAdmin });
    const that = await ketCucThat(
      caller(idAdmin, "admin").deployBuild({
        buildId, stage: "staging", idempotencyKey: `${DAU}-k${++demKhoa}`, actionId: "a", confirmedBy: idAdmin, totpCode: "",
      }),
    );
    expect(preview.verdict).toBe(that.verdict);
    expect(that.verdict).toBe("blocked");
    expect((that.loi as { code?: string })?.code).toBe("PRECONDITION_FAILED");
    expect(preview.gates.map((g) => g.reason)).toContain("buildChecksumMismatch");
  });

  it("deployPreview là query THUẦN: không tạo hàng deploy, không gọi adapter.deploy", async () => {
    datCo(NOI_BO);
    const { buildId } = await seedBuild({ kind: "gcode", language: "text", content: STUB_SRC, sim: true });
    datCo(BAT);
    const truoc = await (await d()).select().from(programDeployments).where(eq(programDeployments.buildId, buildId));
    const p = await caller(idAdmin, "admin").deployPreview({ buildId, stage: "staging", confirmedBy: idAdmin });
    expect(p.verdict).toBe("real");
    const sau = await (await d()).select().from(programDeployments).where(eq(programDeployments.buildId, buildId));
    expect(sau.length).toBe(truoc.length);
  });
});
