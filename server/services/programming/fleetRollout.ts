/**
 * doc 40 W5 §11 — FLEET PROGRAM ROLLOUT (canary) + MACHINE × VERSION MATRIX.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Đẩy MỘT build đã kiểm chứng ra NHIỀU máy một cách có kiểm soát, TÁI SỬ DỤNG
 * NGUYÊN VẸN đường deploy hiện có (programmingService.deployBuild) — nghĩa là MỖI
 * máy vẫn đi qua ĐẦY ĐỦ mọi cổng an toàn: DPC_DEPLOY_ENABLED + HITL sign-off,
 * four-eyes-at-version, SoD, Simulation-Gate, verify-after-download. KHÔNG cổng nào
 * bị bỏ qua ở tầng này — fleetRollout chỉ ĐIỀU PHỐI trình tự (canary → promote) và
 * TỔNG HỢP kết quả THẬT của từng máy (deployed / verified / simulated / rejected /
 * failed). Mỗi máy = MỘT hàng program_deployments append-only riêng (idempotencyKey
 * riêng theo máy) — không thêm bảng/cột nào.
 *
 * CANARY: deploy N máy đầu; nếu một canary KHÔNG đạt → DỪNG (không đẩy phần còn lại)
 * và (khi autoRollbackOnMismatch) rollback các máy đã ghi thật. Nếu tất cả canary đạt
 * → promote (đẩy nốt phần còn lại). "Đạt/không đạt" đọc TỪ TRẠNG THÁI THẬT của deploy,
 * không bịa: một verify-after-download mismatch → status 'failed' → canary fail.
 *
 * TRUNG THỰC (không phần cứng ở đây): với cờ deploy OFF (mặc định) mọi deploy được ghi
 * 'simulated' (KHÔNG ghi xuống HW). Rollout KHÔNG bao giờ tuyên bố "đã verified" khi
 * chưa đọc-lại được thiết bị — nó chỉ phản ánh đúng status mà deployBuild trả về.
 *
 * doc 81 Đợt 1B Task 3 (BE2 §L3 "Fleet canary"): trước đây 'simulated' được tính là ĐẠT ⇒ một
 * canary chưa commission (adapter chỉ giả lập) "đạt" rồi promote GHI THẬT xuống các máy đã
 * commission. Nay: khi promote CÓ THỂ ghi thật (cùng điều kiện `realDeploy` của deployBuild:
 * DPC_DEPLOY_ENABLED + có người ký), canary 'simulated' KHÔNG đạt ⇒ rollout DỪNG với
 * `haltCode = "canary_not_real"` ("cần canary thật"). Không thêm trạng thái deploy nào (R2):
 * từng máy giữ status thật; mã lý do nằm ở kết quả rollout. Khi promote cũng chỉ giả lập
 * (cờ OFF / không người ký) thì một canary giả lập vẫn đủ — không có ghi HW nào để chặn.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import { DbUnavailableError } from "../../_core/dbErrors";
import { getDb } from "../../db/connection";
import {
  programDeployments,
  programBuilds,
  programArtifacts,
} from "../../../drizzle/schema";
import {
  deployBuild as realDeployBuild,
  rollbackDeployment as realRollback,
  dpcDeployApprovalEnabled,
  dpcDeployEnabled,
  type DpcUser,
  type DeployRequest,
} from "./programmingService";

async function db() {
  const d = await getDb();
  if (!d) throw new DbUnavailableError();
  return d;
}

/** Một hàng program_deployments (kết quả deploy của một máy). */
type DeploymentRow = typeof programDeployments.$inferSelect;

/** Chiến lược rollout theo đội máy. */
export interface FleetRolloutStrategy {
  /** Số máy canary đẩy ĐẦU TIÊN (kẹp về [1, số máy]). */
  canaryCount: number;
  /**
   * Chỉ promote khi canary đạt 'verified' (read-back khớp). Một deploy thật NHƯNG chưa
   * verify ('deployed') sẽ CHẶN promote (thận trọng). 'simulated' (cờ OFF, không ghi HW)
   * và 'verified' luôn qua được — vì không có rủi ro HW để chặn.
   */
  promoteOnVerified: boolean;
  /**
   * Khi canary KHÔNG đạt, tự rollback các máy đã GHI THẬT (status 'deployed'/'verified')
   * về bản tốt trước đó (đi qua đúng cổng deploy). 'simulated' không ghi HW → bỏ qua.
   */
  autoRollbackOnMismatch: boolean;
}

/** HITL + khóa cho rollout (áp cho MỌI máy, mỗi máy sinh khóa/actionId riêng). */
export interface FleetRolloutInput {
  buildId: number;
  deviceIds: number[];
  stage: "staging" | "production";
  strategy: FleetRolloutStrategy;
  /** Tiền tố khóa idempotency; mỗi máy → `${prefix}-dev{deviceId}`. */
  idempotencyKeyPrefix: string;
  /** actionId gốc; mỗi máy → `${actionId}-dev{deviceId}` (audit tách bạch). */
  actionId: string;
  /** Người ký duyệt (four-eyes) — bắt buộc cho production, phải KHÁC người yêu cầu. */
  confirmedBy?: number;
  reason?: string;
}

/**
 * Mã lý do DỪNG rollout (máy-đọc-được; UI dịch qua i18n). Không phải trạng thái deploy mới.
 *   • canary_failed   — ít nhất một canary bị từ chối / lỗi / chưa verify (logic cũ).
 *   • canary_not_real — canary chỉ GIẢ LẬP trong khi promote sẽ ghi THẬT ⇒ cần canary thật.
 */
export type FleetHaltCode = "canary_failed" | "canary_not_real";

/** Kết quả deploy THẬT của một máy trong rollout. */
export interface FleetMachineResult {
  deviceId: number;
  phase: "canary" | "promote";
  deploymentId: number | null;
  status: string; // deployed | verified | simulated | rejected | failed
  simulated: boolean;
  error: string | null;
  /** Có ghi thật xuống máy này không (deployed/verified) — để quyết định rollback. */
  forwardWrite: boolean;
  rolledBack?: boolean;
  rollbackError?: string | null;
}

export interface FleetRolloutResult {
  buildId: number;
  stage: string;
  strategy: FleetRolloutStrategy;
  canaryCount: number;
  halted: boolean;
  /** doc 81 Đợt 1B Task 3 — mã lý do dừng (null khi không dừng). */
  haltCode: FleetHaltCode | null;
  haltReason: string | null;
  promoted: boolean;
  results: FleetMachineResult[];
  summary: {
    total: number;
    deployed: number;
    verified: number;
    simulated: number;
    rejected: number;
    failed: number;
    rolledBack: number;
  };
}

/** Cho phép TIÊM deployBuild/rollback (test mock) — mặc định dùng service thật. */
export interface FleetRolloutDeps {
  deployFn?: (req: DeployRequest, user: DpcUser) => Promise<DeploymentRow>;
  rollbackFn?: (
    deploymentId: number,
    user: DpcUser,
    hitl: { actionId: string; requestedBy: number; confirmedBy?: number },
    idempotencyKey: string,
  ) => Promise<DeploymentRow & { rolledBackFromId?: number; targetRolledBack?: boolean }>;
  /**
   * doc 81 Đợt 1B Task 3 — promote có thể GHI THẬT xuống máy không? Mặc định: đúng điều kiện
   * `realDeploy` của computeDeploy (DPC_DEPLOY_ENABLED + confirmedBy có mặt).
   */
  realWritePossible?: (input: FleetRolloutInput) => boolean;
}

/** Có phải một forward-write xuống HW (đã/ sẽ chạy trên máy) — để rollback. */
export function isForwardWrite(status: string): boolean {
  return status === "deployed" || status === "verified";
}

/**
 * Một kết quả canary có ĐẠT để promote không (đọc từ status THẬT).
 *   • rejected / failed        → KHÔNG đạt (cổng từ chối / verify mismatch).
 *   • promoteOnVerified + 'deployed' (ghi thật nhưng CHƯA verify) → KHÔNG đạt (thận trọng).
 *   • 'verified' / 'deployed'  → đạt.
 *   • 'simulated'              → doc 81 Đợt 1B Task 3: CHỈ đạt khi promote cũng không thể ghi
 *                                thật (`promoteCanWriteHw=false`). Một canary không ghi HW không
 *                                chứng minh gì cho máy sắp bị ghi thật.
 *   • mọi status khác (pending / awaiting_approval / rolled_back …) → KHÔNG đạt (fail-closed:
 *     không phải kết quả deploy đã xong).
 */
export function canaryPasses(status: string, promoteOnVerified: boolean, promoteCanWriteHw: boolean): boolean {
  if (status === "verified") return true;
  if (status === "deployed") return !promoteOnVerified;
  if (status === "simulated") return !promoteCanWriteHw;
  return false;
}

/** Mặc định: promote ghi thật ⇔ cùng điều kiện `realDeploy` của programmingService.computeDeploy. */
function defaultRealWritePossible(input: FleetRolloutInput): boolean {
  return dpcDeployEnabled() && input.confirmedBy != null;
}

/** Deploy một máy qua ĐÚNG deployBuild (mọi cổng an toàn giữ nguyên). */
async function deployOne(
  input: FleetRolloutInput,
  deviceId: number,
  phase: "canary" | "promote",
  user: DpcUser,
  deployFn: NonNullable<FleetRolloutDeps["deployFn"]>,
): Promise<FleetMachineResult> {
  try {
    const row = await deployFn(
      {
        buildId: input.buildId,
        stage: input.stage,
        idempotencyKey: `${input.idempotencyKeyPrefix}-dev${deviceId}`,
        deviceId,
        hitl: {
          actionId: `${input.actionId}-dev${deviceId}`,
          requestedBy: user.id,
          confirmedBy: input.confirmedBy,
          reason: input.reason,
        },
      },
      user,
    );
    return {
      deviceId,
      phase,
      deploymentId: row.id,
      status: row.status,
      simulated: row.simulated,
      error: row.error ?? null,
      forwardWrite: isForwardWrite(row.status),
    };
  } catch (e) {
    // deployBuild ném (vd. build/artifact thiếu) → ghi honest 'failed' cho máy này, KHÔNG
    // giả vờ thành công. Không có forward-write nên không rollback máy này.
    return {
      deviceId,
      phase,
      deploymentId: null,
      status: "failed",
      simulated: true,
      error: (e as Error).message,
      forwardWrite: false,
    };
  }
}

/**
 * TRIỂN KHAI ĐỘI MÁY (canary → promote). Tuần tự qua từng máy để mỗi bước đọc được kết
 * quả thật trước khi quyết định bước tiếp. Không mở cổng nào — mỗi máy đi qua deployBuild.
 */
export async function deployToFleet(
  input: FleetRolloutInput,
  user: DpcUser,
  deps: FleetRolloutDeps = {},
): Promise<FleetRolloutResult> {
  const deployFn = deps.deployFn ?? realDeployBuild;
  const rollbackFn = deps.rollbackFn ?? realRollback;

  // QA W5 (high): ở chế độ Approval Inbox (DPC_DEPLOY_APPROVAL_ENABLED), deploy
  // production KHÔNG được nhận confirmedBy thô từ requester (four-eyes hình thức) —
  // phải duyệt TỪNG máy qua Approval Inbox (approver ký bằng session của họ). Chặn
  // đường fleet-production thô ở chế độ này để không né lỗ ENG-F2 đã đóng. Khi cờ OFF
  // (mặc định) fleet dùng cùng mức four-eyes legacy như single deployBuild (SoD).
  if (input.stage === "production" && dpcDeployApprovalEnabled()) {
    throw new Error(
      "Ở chế độ Approval Inbox, deploy production đội máy phải được duyệt TỪNG máy tại /approvals (approver ký bằng phiên của họ). Dùng staging cho rollout hàng loạt, hoặc duyệt từng máy.",
    );
  }

  // Loại trùng, giữ thứ tự người dùng chọn.
  const devices = [...new Set(input.deviceIds)];
  const canaryCount = Math.min(Math.max(input.strategy.canaryCount, 1), devices.length || 1);
  const canaryDevices = devices.slice(0, canaryCount);
  const restDevices = devices.slice(canaryCount);

  const results: FleetMachineResult[] = [];
  let halted = false;
  let haltCode: FleetHaltCode | null = null;
  let haltReason: string | null = null;
  let promoted = false;
  const promoteCanWriteHw = (deps.realWritePossible ?? defaultRealWritePossible)(input);

  if (devices.length === 0) {
    return finalize(input, canaryCount, halted, haltCode, haltReason, promoted, results);
  }

  // ── PHA 1: CANARY (tuần tự) ──
  for (const deviceId of canaryDevices) {
    results.push(await deployOne(input, deviceId, "canary", user, deployFn));
  }

  const failing = results.filter((r) => !canaryPasses(r.status, input.strategy.promoteOnVerified, promoteCanWriteHw));
  if (failing.length > 0) {
    halted = true;
    // Chỉ-giả-lập ⇔ MỌI canary không đạt đều là 'simulated' (không có lỗi/từ chối thật nào).
    const onlyNotReal = failing.every((f) => f.status === "simulated");
    haltCode = onlyNotReal ? "canary_not_real" : "canary_failed";
    const list = failing.map((f) => `#${f.deviceId}:${f.status}`).join(", ");
    haltReason = onlyNotReal
      ? `Canary chỉ GIẢ LẬP trên ${failing.length}/${canaryDevices.length} máy (${list}) — không ghi xuống thiết bị nên ` +
        `KHÔNG được tính là đạt khi promote sẽ ghi thật. Cần một canary THẬT (deployed/verified) — DỪNG rollout, ` +
        `không đẩy ${restDevices.length} máy còn lại.`
      : `Canary KHÔNG đạt trên ${failing.length}/${canaryDevices.length} máy ` +
        `(${list}) — DỪNG rollout, không đẩy ${restDevices.length} máy còn lại.`;

    // Rollback các máy đã GHI THẬT (best-effort, honest — có thể không có bản trước để lùi).
    // canary_not_real: không có bằng chứng chương trình SAI (không mismatch/lỗi) ⇒ không lùi
    // canary thật đã ghi — chỉ dừng chờ canary thật.
    if (input.strategy.autoRollbackOnMismatch && haltCode === "canary_failed") {
      for (const r of results) {
        if (!r.forwardWrite || r.deploymentId == null) continue;
        try {
          const rb = await rollbackFn(
            r.deploymentId,
            user,
            {
              actionId: `${input.actionId}-rollback-dev${r.deviceId}`,
              requestedBy: user.id,
              confirmedBy: input.confirmedBy,
            },
            `${input.idempotencyKeyPrefix}-rollback-dev${r.deviceId}`,
          );
          // doc 80 WS-03 — rollbackDeployment KHÔNG còn ném khi lượt lùi failed/simulated; nó
          // trả status thật + `targetRolledBack`. Chỉ báo "đã khôi phục" khi server thật sự
          // đánh đích rolled_back — nếu không, lỗi/trạng thái thật lên kết quả máy này.
          r.rolledBack = rb.targetRolledBack === true;
          if (!r.rolledBack) r.rollbackError = rb.error ?? rb.status;
        } catch (e) {
          r.rolledBack = false;
          r.rollbackError = (e as Error).message;
        }
      }
    }
    return finalize(input, canaryCount, halted, haltCode, haltReason, promoted, results);
  }

  // ── PHA 2: PROMOTE phần còn lại (tuần tự) ──
  for (const deviceId of restDevices) {
    results.push(await deployOne(input, deviceId, "promote", user, deployFn));
  }
  promoted = restDevices.length > 0;

  return finalize(input, canaryCount, halted, haltCode, haltReason, promoted, results);
}

function finalize(
  input: FleetRolloutInput,
  canaryCount: number,
  halted: boolean,
  haltCode: FleetHaltCode | null,
  haltReason: string | null,
  promoted: boolean,
  results: FleetMachineResult[],
): FleetRolloutResult {
  const count = (s: string) => results.filter((r) => r.status === s).length;
  return {
    buildId: input.buildId,
    stage: input.stage,
    strategy: input.strategy,
    canaryCount,
    halted,
    haltCode,
    haltReason,
    promoted,
    results,
    summary: {
      total: results.length,
      deployed: count("deployed"),
      verified: count("verified"),
      simulated: count("simulated"),
      rejected: count("rejected"),
      failed: count("failed"),
      rolledBack: results.filter((r) => r.rolledBack === true).length,
    },
  };
}

// ════════════════════════════════════════════════════════════════════════════
// MA TRẬN MÁY × VERSION (read-only)
// ════════════════════════════════════════════════════════════════════════════

/** Trạng thái "đang chạy hiệu lực" (đã/ chưa ghi HW nhưng KHÔNG bị từ chối/lùi). */
const EFFECTIVE_STATUSES = new Set(["deployed", "verified", "simulated"]);

/**
 * PURE — từ danh sách deployment (bất kỳ thứ tự), chọn cho MỖI deviceId hàng "hiệu lực"
 * MỚI NHẤT (id lớn nhất) có status ∈ {deployed, verified, simulated}. Bỏ qua rejected /
 * failed / rolled_back / awaiting_approval (không phản ánh cái máy đang chạy). Máy chưa
 * gắn (deviceId null) bị bỏ. Đây là hạt nhân testable của ma trận.
 */
export function pickLatestPerDevice(rows: DeploymentRow[]): Map<number, DeploymentRow> {
  const sorted = [...rows].sort((a, b) => b.id - a.id);
  const out = new Map<number, DeploymentRow>();
  for (const r of sorted) {
    if (r.deviceId == null) continue;
    if (!EFFECTIVE_STATUSES.has(r.status)) continue;
    if (!out.has(r.deviceId)) out.set(r.deviceId, r);
  }
  return out;
}

export interface FleetMatrixEntry {
  deviceId: number;
  deploymentId: number;
  projectId: number;
  buildId: number;
  artifactId: number | null;
  version: number | null;
  branch: string | null;
  contentHash: string | null;
  stage: string;
  status: string;
  simulated: boolean;
  deployedAt: Date;
}

/**
 * MA TRẬN MÁY × VERSION: máy nào đang chạy artifact/hash nào. Đọc program_deployments
 * (lọc theo projectId/deviceIds nếu có), lấy hàng hiệu lực mới nhất mỗi máy, rồi nối
 * build → artifact để lộ version + contentHash. READ-ONLY, không chạm thiết bị.
 */
export async function fleetVersionMatrix(filter?: {
  projectId?: number;
  deviceIds?: number[];
}): Promise<FleetMatrixEntry[]> {
  const d = await db();

  const conds = [];
  if (filter?.projectId != null) conds.push(eq(programDeployments.projectId, filter.projectId));
  if (filter?.deviceIds && filter.deviceIds.length > 0)
    conds.push(inArray(programDeployments.deviceId, filter.deviceIds));

  const rows = await d
    .select()
    .from(programDeployments)
    .where(conds.length === 1 ? conds[0] : conds.length > 1 ? and(...conds) : undefined)
    .orderBy(desc(programDeployments.id));

  const latest = pickLatestPerDevice(rows);
  if (latest.size === 0) return [];

  // Nạp build → artifact cho các build có mặt (một lượt, tránh N+1).
  const buildIds = [...new Set([...latest.values()].map((r) => r.buildId))];
  const builds = buildIds.length
    ? await d.select().from(programBuilds).where(inArray(programBuilds.id, buildIds))
    : [];
  const buildById = new Map(builds.map((b) => [b.id, b]));
  const artifactIds = [...new Set(builds.map((b) => b.artifactId))];
  const artifacts = artifactIds.length
    ? await d.select().from(programArtifacts).where(inArray(programArtifacts.id, artifactIds))
    : [];
  const artById = new Map(artifacts.map((a) => [a.id, a]));

  const out: FleetMatrixEntry[] = [];
  for (const [deviceId, dep] of latest) {
    const b = buildById.get(dep.buildId);
    const art = b ? artById.get(b.artifactId) : undefined;
    out.push({
      deviceId,
      deploymentId: dep.id,
      projectId: dep.projectId,
      buildId: dep.buildId,
      artifactId: art?.id ?? null,
      version: art?.version ?? null,
      branch: art?.branch ?? null,
      contentHash: art?.contentHash ?? null,
      stage: dep.stage,
      status: dep.status,
      simulated: dep.simulated,
      deployedAt: dep.createdAt,
    });
  }
  // Sắp theo deviceId cho ổn định UI.
  out.sort((a, b) => a.deviceId - b.deviceId);
  return out;
}

export type { DeploymentRow };
