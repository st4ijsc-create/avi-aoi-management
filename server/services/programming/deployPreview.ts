/**
 * doc 80 Đợt 1 Task 5 (WS-02 / F2) — `programming.deployPreview`: CHẠY KHÔ mọi cổng deploy.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * VÌ SAO: header báo "Deploy: ON" nhưng không deploy thật nào thành công, và người dùng chỉ
 * biết điều đó SAU khi nhập OTP. Bản xem trước trả `{verdict, gates[], target}` TRƯỚC khi UI hỏi
 * OTP: `real` (sẽ ghi thiết bị) · `simulated` (chỉ ghi nhận mô phỏng) · `blocked` (bị từ chối /
 * thất bại).
 *
 * KHÔNG TRÔI KHỎI ĐƯỜNG THẬT — đó là toàn bộ giá trị của nó:
 *   • Cổng DỊCH VỤ (four-eyes-at-version / build ok / cờ / ký duyệt / SoD / Simulation Gate) là
 *     CHÍNH `evaluateDeployGates` mà `computeDeploy` dùng — không có bản sao thứ hai.
 *   • Checksum là CHÍNH `rebuildForDeploy` (biên dịch lại + so outputRef/contentHash).
 *   • Cổng NGƯỜI GỌI đọc CHÍNH `ACTUATION_ROLES` / `PRIVILEGED_ROLES` / `batBuoc2FA()` /
 *     `actuationStepUp2faEnabled()` / `checkPermission` mà `deployProcedure` dùng. Chế độ nội bộ
 *     (`AUTH_2FA_BAT_BUOC=0`, quyết định chủ dự án 2026-09-26: 2FA KHÔNG là điều kiện tiên quyết)
 *     ⇒ người chưa bật 2FA được BỎ QUA step-up (có ghi sổ) — bản xem trước nói "bỏ qua (chế độ
 *     nội bộ)", KHÔNG nói "bị chặn".
 *   • Cổng ADAPTER soi đúng các lối thoát TRƯỚC-GHI của `adapter.deploy()` từng loại (không gọi
 *     mạng/thiết bị): robot-tm luôn `failed` techman_program_download_unsupported (0 byte);
 *     IEC 61131 luôn `failed` (chưa có host OpenPLC); MELSEC đi dispatcher OT (đường trực tiếp
 *     không mang actionId đã gắn ⇒ NOT_CONFIRMED; ghi thật đòi hash payload OT gắn một-lần mà
 *     hàng program_deploy không có ⇒ bị từ chối); Zmotion cần endpoint + file .bas + DLL.
 *   Lưới khớp: `deployPreview.db.test.ts` chạy CẢ bản xem trước LẪN deploy thật (qua
 *   `programmingRouter.createCaller` sản xuất) trên cùng đầu vào và so kết quả.
 *
 * AN TOÀN: chỉ ĐỌC DB (không INSERT/UPDATE), không mở socket, không gọi adapter.deploy().
 * Biên dịch lại là thao tác "luôn an toàn" của adapter (Zmotion ghi file .bas theo checksum vào
 * thư mục build — cùng tác dụng phụ với buildArtifact/simulateBuild).
 * Cổng `atDeploy: true` = chỉ biết được lúc deploy (reachability, nạp DLL, HIL, read-back).
 * ════════════════════════════════════════════════════════════════════════════
 */
import { createRequire } from "node:module";
import { and, eq } from "drizzle-orm";
import { getDb } from "../../db/connection";
import { deviceAdapters, deviceTags } from "../../../drizzle/schema";
import { ACTUATION_ROLES, PRIVILEGED_ROLES, batBuoc2FA, actuationStepUp2faEnabled } from "../../_core/trpc";
import { checkPermission } from "../../_core/accessControl";
import { readAppErrorMeta } from "../../_core/appError";
import { programmingRegistry, type ProgrammingAdapter, type ProgrammingKind, type BuildResult } from "./programmingAdapter";
import {
  loadDeployCtx,
  evaluateDeployGates,
  rebuildForDeploy,
  dpcDeployApprovalEnabled,
  type DeployGate,
} from "./programmingService";
import { TECHMAN_PROGRAM_DOWNLOAD_UNSUPPORTED } from "./robot/robotTmAdapter";
import { dpcHilEnabled } from "./ir/hilGate";
import { runGateForFlowAsync } from "./sim/kinematicSimGate";
import { EMPTY_SCENE } from "./sim/sceneAdapter";
import type { Flow } from "./ir/irModel";
import { getActiveDriver } from "../ot/otManager";
import { isOtControlEnabled } from "../ot/commandDispatcher";
import { isCommissioned, isCommissioningRequired } from "../ot/commissioningService";

export type { DeployGate };
export type DeployVerdict = "real" | "simulated" | "blocked";
/** direct = deployBuild của chính người gọi · approvalInbox = production qua Hộp duyệt (ENG-F2). */
export type DeployPath = "direct" | "approvalInbox";

export interface DeployPreviewInput {
  buildId: number;
  stage: "staging" | "production";
  deviceId?: number;
  /** Người ký duyệt mà UI SẼ gửi kèm deployBuild (staging: chính mình khi tick; production: approver). */
  confirmedBy?: number;
}

export interface DeployPreviewCaller {
  id: number;
  role: string;
  twoFactorEnabled?: boolean | null;
}

export interface DeployPreview {
  verdict: DeployVerdict;
  gates: DeployGate[];
  target: {
    buildId: number;
    artifactId: number;
    artifactVersion: number;
    adapterKind: string;
    stage: "staging" | "production";
    deviceId: number | null;
    path: DeployPath;
  };
}

/** Người ký "tương lai" ở Hộp duyệt: luôn KHÁC người yêu cầu (approveDeployment ép SoD). */
const FUTURE_APPROVER = -1;

/** Verdict từ danh sách cổng: một cổng chặn ⇒ blocked; không thì một cổng mô phỏng ⇒ simulated. */
export function verdictOf(gates: DeployGate[]): DeployVerdict {
  if (gates.some((g) => !g.ok && g.effect === "block")) return "blocked";
  if (gates.some((g) => !g.ok && g.effect === "simulate")) return "simulated";
  return "real";
}

const block = (name: string, reason: string, params?: DeployGate["params"]): DeployGate => ({
  name,
  ok: false,
  effect: "block",
  reason,
  ...(params ? { params } : {}),
});
const simulate = (name: string, reason: string): DeployGate => ({ name, ok: false, effect: "simulate", reason });
const pass = (name: string, reason: string, atDeploy = false): DeployGate => ({
  name,
  ok: true,
  reason,
  ...(atDeploy ? { atDeploy: true } : {}),
});

// ── Cổng NGƯỜI GỌI — mirror `deployProcedure` (role-floor → require2FA → step-up) + requirePermission ──
async function callerGates(caller: DeployPreviewCaller, path: DeployPath): Promise<DeployGate[]> {
  const gates: DeployGate[] = [];
  const role = String(caller.role) as (typeof ACTUATION_ROLES)[number];
  const tfa = caller.twoFactorEnabled === true;

  // requirePermission("machine_control","canCreate") — chung cho deployBuild và requestDeployApproval.
  gates.push(
    (await checkPermission(caller.id, String(caller.role), "machine_control", "canCreate"))
      ? pass("permission", "permissionGranted")
      : block("permission", "permissionMissing"),
  );

  if (path === "approvalInbox") {
    // requestDeployApproval là protectedProcedure (không actuation): vai/2FA/OTP được kiểm ở
    // NGƯỜI DUYỆT, bằng phiên của họ, lúc approveDeployment (deployProcedure).
    gates.push(pass("approver", "approverSignsInInbox"));
    return gates;
  }

  gates.push(ACTUATION_ROLES.includes(role) ? pass("role", "roleAllowed") : block("role", "roleNotAllowed"));

  // require2FA: batBuoc2FA() && vai đặc quyền && chưa bật ⇒ FORBIDDEN TWO_FACTOR_NOT_SET_UP.
  if (batBuoc2FA() && PRIVILEGED_ROLES.includes(role) && !tfa) {
    gates.push(block("twoFactor", "twoFactorNotSetUp"));
  } else if (!actuationStepUp2faEnabled()) {
    gates.push(pass("twoFactor", "stepUpOff"));
  } else if (!batBuoc2FA() && !tfa) {
    // Chế độ NỘI BỘ: step-up được BỎ QUA cho người chưa bật 2FA, lượt bỏ-qua GHI SỔ AUDIT.
    gates.push(pass("twoFactor", "stepUpBypassedInternalMode"));
  } else {
    gates.push(pass("twoFactor", "otpRequired"));
  }
  return gates;
}

// ── Cổng ADAPTER — các lối thoát TRƯỚC-GHI của adapter.deploy(), chạy khô ──
interface AdapterCtx {
  stage: "staging" | "production";
  deviceId: number | undefined;
  path: DeployPath;
}

/** Một adapter (vd adapter thử trong test) có thể tự khai bản xem trước của mình. */
interface PreviewCapable {
  previewDeploy(build: BuildResult, ctx: AdapterCtx): Promise<DeployGate[]>;
}
function isPreviewCapable(a: ProgrammingAdapter): a is ProgrammingAdapter & PreviewCapable {
  return typeof (a as Partial<PreviewCapable>).previewDeploy === "function";
}

/** koffi có cài không (zauxFfi nạp nó lười lúc deploy). Chỉ phân giải đường dẫn, không nạp. */
function koffiInstalled(): boolean {
  try {
    createRequire(import.meta.url).resolve("koffi");
    return true;
  } catch {
    return false;
  }
}

async function zmotionGates(build: BuildResult): Promise<DeployGate[]> {
  const gates: DeployGate[] = [];
  // Service không truyền opts.endpoint ⇒ adapter đọc ZMC_ENDPOINT (y như deploy()).
  const endpoint = process.env.ZMC_ENDPOINT;
  if (!endpoint) {
    gates.push(block("adapterEndpoint", "zmcEndpointMissing"));
  } else {
    gates.push(pass("adapterEndpoint", "zmcEndpointConfigured"));
    // Cổng dò TCP chỉ chạy khi endpoint có :port — kết quả chỉ biết lúc deploy.
    if (Number(endpoint.split(":")[1]) > 0) gates.push(pass("adapterReachable", "reachabilityAtDeploy", true));
  }
  gates.push(
    typeof build.meta?.filePath === "string"
      ? pass("adapterArtifact", "zmcFileReady")
      : block("adapterArtifact", "zmcNoFilePath"),
  );
  if (!process.env.ZAUXDLL_PATH) gates.push(block("adapterDriver", "zauxDllPathMissing"));
  else if (!koffiInstalled()) gates.push(block("adapterDriver", "koffiMissing"));
  else gates.push(pass("adapterDriver", "zauxLoadAtDeploy", true));
  return gates;
}

async function melsecGates(build: BuildResult, ctx: AdapterCtx): Promise<DeployGate[]> {
  const gates: DeployGate[] = [];
  const adapterId = ctx.deviceId;
  if (!adapterId) return [block("adapterEndpoint", "melsecNoAdapter")];
  const paramMap = (build.meta?.paramMap as Record<string, string> | undefined) ?? {};
  const writes = Object.entries(paramMap).map(([tagKey, value]) => ({ tagKey, value }));
  if (writes.length === 0) return [block("adapterArtifact", "melsecEmptyRecipe")];
  gates.push(pass("adapterArtifact", "melsecRecipeReady"));

  // Dispatcher (1) — xác thực HITL. Đường TRỰC TIẾP: actionId do client tự sinh, KHÔNG có hàng
  // ai_pending_actions confirmed nào ⇒ NOT_CONFIRMED (rejected). Hộp duyệt: hàng thật, đã lật
  // 'confirmed' + userId = người duyệt ⇒ qua.
  if (ctx.path === "direct") {
    gates.push(block("otAuthorization", "otActionNotBound"));
    return gates;
  }
  gates.push(pass("otAuthorization", "otActionBound"));

  // Dispatcher (3)(4) — adapter bật, tag có & ghi được, driver đang kết nối (đọc, không ghi).
  const db = await getDb();
  if (!db) return [...gates, block("otAdapter", "otDbUnavailable")];
  const [adapter] = await db.select().from(deviceAdapters).where(eq(deviceAdapters.id, adapterId)).limit(1);
  if (!adapter || !adapter.isEnabled) return [...gates, block("otAdapter", "otAdapterDisabled")];
  for (const w of writes) {
    const [tag] = await db
      .select()
      .from(deviceTags)
      .where(and(eq(deviceTags.adapterId, adapterId), eq(deviceTags.tagKey, w.tagKey)))
      .limit(1);
    if (!tag || !tag.isEnabled) return [...gates, block("otTags", "otTagNotFound", { tagKey: w.tagKey })];
    if (tag.writable !== true) return [...gates, block("otTags", "otTagNotWritable", { tagKey: w.tagKey })];
  }
  gates.push(pass("otTags", "otTagsWritable"));
  if (!getActiveDriver(adapterId)) return [...gates, block("otAdapter", "otAdapterOffline")];
  gates.push(pass("otAdapter", "otAdapterOnline"));

  // Dispatcher (5)(5a) — cổng chế độ + nghiệm thu ⇒ mô phỏng.
  if (!isOtControlEnabled()) return [...gates, simulate("otMode", "otControlOff")];
  if (isCommissioningRequired() && !(await isCommissioned(adapterId))) {
    return [...gates, simulate("otMode", "otNotCommissioned")];
  }
  // Ghi THẬT đòi hàng HITL gắn hash payload OT một-lần (otActionBinding) — hàng program_deploy
  // không mang tool/hash nào ⇒ dispatcher từ chối (ACTION_BINDING_MISMATCH). Luôn chặn.
  return [...gates, block("otBinding", "otBindingMissing")];
}

async function irGates(build: BuildResult): Promise<DeployGate[]> {
  if (!dpcHilEnabled()) return [simulate("adapterPath", "irNoDevicePath")];
  const flow = build.meta?.flow as Flow | undefined;
  if (!flow) return [simulate("adapterPath", "irNoDevicePath")];
  const gate = await runGateForFlowAsync(flow, EMPTY_SCENE);
  if (!gate.pass) return [block("irSimGate", "irSimGateFailed")];
  const gates: DeployGate[] = [pass("irSimGate", "irSimGatePassed")];
  const targetIsUr =
    String(build.meta?.target) === "urscript" || String(build.meta?.targetDeviceType) === "universal-robots";
  if (targetIsUr) gates.push(pass("irHil", "hilRunsAtDeploy", true));
  gates.push(simulate("adapterPath", "irNoDevicePath"));
  return gates;
}

async function adapterGates(adapter: ProgrammingAdapter, build: BuildResult, ctx: AdapterCtx): Promise<DeployGate[]> {
  if (isPreviewCapable(adapter)) return adapter.previewDeploy(build, ctx);
  switch (adapter.kind) {
    case "stub":
      return [simulate("adapterPath", "stubNoDevicePath")];
    case "robot-tm":
      // doc 81 Đợt 1B Task 4 — không có động từ tải chương trình TMflow ⇒ failed, 0 byte gửi đi.
      return [block("adapterPath", TECHMAN_PROGRAM_DOWNLOAD_UNSUPPORTED)];
    case "iec61131-st":
    case "iec61131-ld":
    case "iec61131-pou":
      return [block("adapterPath", "openplcNotConfigured")];
    case "zmotion-basic":
      return zmotionGates(build);
    case "mitsubishi-engineering":
      return melsecGates(build, ctx);
    case "ir-flow":
      return irGates(build);
    default:
      return adapter.capabilities.canDownload
        ? [pass("adapterPath", "adapterOutcomeAtDeploy", true)]
        : [block("adapterPath", "adapterNoDownloadPath")];
  }
}

/**
 * CHẠY KHÔ một deploy: cùng đầu vào với `deployBuild` (hoặc `requestDeployApproval` khi
 * production + Hộp duyệt bật), trả verdict + mọi cổng. Không ghi DB, không chạm thiết bị.
 */
export async function previewDeploy(input: DeployPreviewInput, caller: DeployPreviewCaller): Promise<DeployPreview> {
  const { b, art, projectDeviceId } = await loadDeployCtx(input.buildId);
  const path: DeployPath = input.stage === "production" && dpcDeployApprovalEnabled() ? "approvalInbox" : "direct";
  const deviceId = input.deviceId ?? projectDeviceId ?? null;

  const gates: DeployGate[] = await callerGates(caller, path);

  // Đường trực tiếp production: zod `.refine` của deployBuild đòi confirmedBy (four-eyes ở schema).
  let confirmedBy: number | undefined = input.confirmedBy;
  if (path === "approvalInbox") confirmedBy = FUTURE_APPROVER;
  else if (input.stage === "production" && confirmedBy == null) gates.push(block("signer", "approverRequired"));

  const ev = await evaluateDeployGates(
    { buildId: input.buildId, stage: input.stage, hitl: { actionId: "preview", requestedBy: caller.id, confirmedBy } },
    b,
    art,
  );
  gates.push(...ev.gates);

  // Adapter chỉ được gọi khi mọi cổng dịch vụ qua VÀ realDeploy (y như computeDeploy).
  if (ev.realDeploy && !ev.rejection) {
    let adapter: ProgrammingAdapter | null = null;
    try {
      adapter = programmingRegistry.getAdapter(b.adapterKind as ProgrammingKind);
    } catch {
      gates.push(block("adapterPath", "adapterNotImplemented"));
    }
    if (adapter) {
      let rebuilt: BuildResult | null = null;
      try {
        rebuilt = await rebuildForDeploy(adapter, b, art);
        gates.push(pass("buildChecksum", "checksumMatches"));
      } catch (e) {
        if (readAppErrorMeta(e)?.appParams?.reason !== "buildChecksumMismatch") throw e;
        gates.push(block("buildChecksum", "buildChecksumMismatch"));
      }
      if (rebuilt) {
        const ag = await adapterGates(adapter, rebuilt, { stage: input.stage, deviceId: deviceId ?? undefined, path });
        gates.push(...ag);
        if (verdictOf(ag) === "real") {
          const canReadBack = adapter.capabilities.canUpload && typeof adapter.upload === "function";
          gates.push(pass("verifyAfterDownload", canReadBack ? "readBackAtDeploy" : "noReadBack", canReadBack));
        }
      }
    }
  }

  return {
    verdict: verdictOf(gates),
    gates,
    target: {
      buildId: b.id,
      artifactId: art.id,
      artifactVersion: art.version,
      adapterKind: String(b.adapterKind),
      stage: input.stage,
      deviceId,
      path,
    },
  };
}
