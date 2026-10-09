/**
 * doc 80 Đợt 1 Task 4 (SAF-02, phụ lục E §6.3) — SỨC KHOẺ NGUỒN AN TOÀN, CHỈ ĐỌC.
 *
 * Trả lời cho trang Safety câu hỏi mà trước đây không màn nào trả lời: preflight an toàn đang
 * DỰA VÀO ĐÂU? Nguồn là PLC thật, là GIẢ LẬP, hay không có gì (⇒ ghi thật bị chặn)?
 *
 * ⚠ KHÔNG đổi hành vi an toàn. Module này KHÔNG gọi `backend.read()` (một backend thật sẽ mở kết
 *   nối OT mỗi lượt poll) và KHÔNG ghi gì. Nó SUY TĨNH từ đúng những thứ mà đường thật đọc:
 *     • adapterFacade.getSafetyStatus (nhánh safety-PLC — 0 driver OT nào tự cài getSafetyStatus
 *       hôm nay): adapter TẮT / 0 cấu hình bật / lỗi đọc ⇒ UNKNOWN; có cấu hình ⇒ đọc TỪNG cấu
 *       hình, MỘT cấu hình đọc sạch là đủ cho OK (`anyOk`).
 *     • backendForConfig: modbus/opcua KHÔNG endpoint rơi về SIM rỗng (luôn "sạch").
 *     • safetyPreflightPolicy: cờ OT_/ROBOT_SAFETY_PREFLIGHT_ENABLED BẬT trừ khi đúng "false";
 *       mọi thứ không phải OK ⇒ từ chối (SAFETY_BLOCKED / SAFETY_UNKNOWN).
 *     • Preflight chỉ được chạm khi OT_CONTROL_ENABLED / ROBOT_CONTROL_ENABLED = "true" (nhánh
 *       dry-run trả 'simulated' trước đó).
 *   Hệ quả trung thực cần hiện lên: với cấu hình SIM duy nhất (DB dev hôm nay), preflight trả OK
 *   từ một GIẢ LẬP ⇒ ghi thật KHÔNG bị preflight chặn dù chẳng có PLC an toàn nào được đọc.
 *   ⇒ doc 81 Đợt 1C Task 1 (quyết định chủ dự án 2026-09-27) ĐÃ ĐÓNG lỗ đó: lệnh THẬT (đích đã
 *   commission) chỉ qua khi có ≥1 cấu hình `real` (endpoint thật + có gán tag an toàn) đọc sạch; chỉ
 *   có SIM / real_unmapped ⇒ SAFETY_SIM_ONLY. Bảng này dự đoán bằng CHÍNH hàm preflight dùng
 *   (`actuationPreflightVerdict` + `effectiveBackend` của safetyPreflightPolicy) ⇒ hai bên không thể lệch.
 *
 * Phạm vi: số tổng của nền preflight là TOÀN HỆ (preflight đọc mọi cấu hình bật, không theo
 * tenant) nhưng chỉ là SỐ ĐẾM; mã cấu hình chỉ lộ cho người xem trong phạm vi nhà máy của nó.
 */
import { safetyPlcConfigs, type SafetyPlcStatusMap } from "../../../drizzle/schema";
import { getDb } from "../../db/connection";
import { idsTrongPhamVi, type PhamViNguoiXem } from "../../db/hierarchy";
import { eq } from "drizzle-orm";
import { safetyPlcAdapterEnabled } from "./plc/safetyPlcAdapter";
import { safetyZoneSwEnabled, listZones } from "./safetyZoneService";
import { safetyVisionEnabled, listCalibrations } from "./vision/humanDetectionProducer";
import { safetyEstopAdapterEnabled, getSafetyPlcAdapter } from "./estop/safetyEstopAdapter";
import {
  SAFETY_PREFLIGHT_FLAGS,
  actuationPreflightVerdict,
  effectiveBackend,
  isOtSafetyPreflightEnabled,
  isRobotSafetyPreflightEnabled,
  plcConfigAppliesToTarget,
  type EffectivePlcBackend,
  type SafetyPreflightReason,
  type SafetyTarget,
} from "../ot/safetyPreflightPolicy";
import { resolveSafetyTarget, type SafetyTargetRef } from "../ot/safetyTarget";
import { isOtControlEnabled } from "../ot/commandDispatcher";
import { isRobotControlEnabled } from "../robot/robotCommandDispatcher"; // final wave item 5 — cùng vị từ với cổng bước 4
import { getIO } from "../../_core/socket";
import { deriveProvenance, type ProvenanceLabel } from "../../../shared/provenance";

// ── Ảnh chụp đầu vào (đọc xong mới tính — hàm tính là THUẦN) ─────────────────────────

export interface PlcConfigLite {
  id: number;
  code: string;
  backend: string;
  endpoint: string | null;
  /** Fix round 1 #1/#4 — which status flags carry a tag address (real) / the sim script (sim). */
  statusMap: SafetyPlcStatusMap | null;
  factoryId: number | null;
  scope: string | null;
  /** doc 81 Đợt 4 Task A1 — target columns, read by the SAME matcher as the gate (optional: absent = null). */
  robotId?: number | null;
  stationId?: number | null;
  lineId?: number | null;
}

export interface SourceHealthSnapshot {
  checkedAt: string;
  flags: {
    safetyPlcAdapter: boolean;
    otPreflight: boolean;
    robotPreflight: boolean;
    otControl: boolean;
    robotControl: boolean;
    safetyVision: boolean;
    safetyZoneSw: boolean;
    safetyEstopAdapter: boolean;
  };
  /** MỌI cấu hình safety-PLC đang bật (toàn hệ — đúng tập mà getSafetyStatus đọc). */
  plcConfigsEnabled: PlcConfigLite[];
  /** 'error' khi không đọc được bảng cấu hình (getSafetyStatus khi đó cũng trả UNKNOWN). */
  plcRead: "ok" | "error";
  /**
   * doc 81 Đợt 4 Task A1 — the command target the prediction is for (resolveSafetyTarget, the gate's own
   * resolver). Absent / null = no target or not resolvable ⇒ every enabled config, exactly as the gate does.
   */
  target?: SafetyTarget | null;
  /** null = người xem toàn quyền. */
  visibleFactoryIds: number[] | null;
  zones: Array<{ factoryId: number | null }>;
  calibrations: Array<{ factoryId: number | null }>;
  /**
   * Fix round 1 #3 — ONLY kind + isRated() + the adapter's own label(). health() is never called
   * here: once a vendor adapter is registered it does a real readBoolTag/driver connect, and this
   * report is polled every 5 s. `reachable` is therefore not reported.
   */
  estop: { kind: string; label: string; rated: boolean };
  socketServerUp: boolean;
}

// ── Đầu ra ────────────────────────────────────────────────────────────────────────

/** Nền của preflight = thứ getSafetyStatus thực sự đọc. */
export type SafetyPlcBasis = "adapter_off" | "no_config" | "read_error" | "sim" | "real_unmapped" | "real" | "mixed";

/**
 * Phân loại MỘT cấu hình (sim_empty / sim_scripted / real_unmapped / real) — định nghĩa DUY NHẤT nằm ở
 * safetyPreflightPolicy (doc 81 Đợt 1C Task 1: preflight lệnh thật và bảng này dùng chung một hàm).
 * Re-export để mọi chỗ đang import từ đây vẫn trỏ về CÙNG hàm đó.
 */
export { effectiveBackend, type EffectivePlcBackend };

/**
 * Hệ quả cho lệnh THẬT trên một mặt (OT ghi / robot chuyển động):
 *   dry_run     — *_CONTROL_ENABLED tắt: mọi lệnh là mô phỏng, preflight không được chạm.
 *   unguarded   — cờ preflight = "false": lệnh thật KHÔNG qua safety-PLC.
 *   blocked     — preflight không thể ra OK ⇒ lệnh thật bị từ chối (refusalReason: SAFETY_UNKNOWN khi
 *                 không có nguồn; SAFETY_SIM_ONLY khi chỉ có SIM / real_unmapped — Đợt 1C Task 1).
 *   real_basis  — có ≥1 PLC thật có gán tag: OK/BLOCKED theo phần cứng; BẤT KỲ PLC thật nào không đọc
 *                 được hoặc có tag chất lượng xấu ⇒ chặn SAFETY_UNKNOWN lúc chạy (fix round 1, R-1C-b).
 *                 doc 81 Đợt 4 Task A1: cổng chỉ đọc cấu hình của ĐÍCH (+ cấu hình không gắn đích); bảng
 *                 không có đích (gọi không targetRef) dự đoán cho đích không phân giải được = mọi cấu hình.
 *                 SIM bên cạnh KHÔNG được tính.
 * (Đợt 1C Task 1 bỏ sim_basis / unmapped_basis / sim_can_satisfy: SIM không còn thoả được preflight.)
 */
export type RealCommandVerdict = "dry_run" | "unguarded" | "blocked" | "real_basis";

export interface PlaneHealth {
  flag: string;
  preflightEnabled: boolean;
  controlEnabled: boolean;
  realWrites: RealCommandVerdict;
  /** Lý do từ chối preflight sẽ ghi khi realWrites='blocked' (null nếu không chặn). */
  refusalReason: SafetyPreflightReason | null;
}

export interface SafetySourceHealth {
  checkedAt: string;
  safetyPlc: {
    adapterEnabled: boolean;
    enabledConfigs: number;
    /** sim_empty + sim_scripted. */
    simConfigs: number;
    /** SIM configs that cycle a script (Fix round 1 #4). */
    simScriptedConfigs: number;
    /** Real endpoint AND ≥1 safety tag mapped. */
    realConfigs: number;
    /** Real endpoint but NO safety tag mapped (Fix round 1 #1). */
    realUnmappedConfigs: number;
    basis: SafetyPlcBasis;
    /** Cấu hình TRONG phạm vi người xem (không có endpoint — chỉ loại backend). */
    configs: Array<{ code: string; backend: string; effective: EffectivePlcBackend; provenance: ProvenanceLabel | null }>;
    /** Cấu hình bật NGOÀI phạm vi người xem — chỉ đếm. */
    hiddenConfigs: number;
  };
  preflight: {
    /** getSafetyStatus sẽ đọc gì: UNKNOWN (không nguồn) / SIM / UNMAPPED (không đọc gì) / REAL / MIXED. */
    expectedReading: "UNKNOWN" | "SIM" | "UNMAPPED" | "REAL" | "MIXED";
    ot: PlaneHealth;
    robot: PlaneHealth;
  };
  vision: { enabled: boolean; calibrations: number; onnxPersonModelWired: false };
  zoneSw: { enabled: boolean; zones: number };
  /** `label` has any endpoint stripped (Fix round 1 #3). */
  estop: { enabled: boolean; adapter: string; label: string; rated: boolean };
  socket: { serverUp: boolean };
}

/**
 * Fix round 1 #3 — an e-stop adapter label may carry the safety PLC endpoint (vendor skeletons:
 * "${vendor} skeleton (${protocol} @ ${endpoint})"). Strip URLs, IPv4[:port] and anything after '@'.
 */
export function stripEndpoint(label: string): string {
  return label
    .replace(/@\s*[^\s)]+/g, "@ [endpoint]")
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s)]+/gi, "[endpoint]")
    .replace(/\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b/g, "[endpoint]");
}

function visible(ids: number[] | null, factoryId: number | null): boolean {
  if (ids === null) return true;
  return factoryId != null && ids.includes(factoryId);
}

/**
 * doc 81 Đợt 1C Task 1 — dự đoán kết cục preflight của lệnh THẬT bằng CHÍNH `actuationPreflightVerdict`
 * mà adapterFacade.getSafetyStatus({ forRealActuation: true }) dùng, trên giả định lạc quan "mọi cấu hình
 * đọc sạch" (bảng không đọc PLC). Giả định đó chỉ có thể làm bảng báo "real_basis" khi thực tế chặn
 * (PLC thật không đọc được) — không bao giờ báo "chặn" khi thực tế cho qua.
 */
function planeVerdict(
  controlEnabled: boolean,
  preflightEnabled: boolean,
  basis: SafetyPlcBasis,
  kinds: readonly EffectivePlcBackend[],
): { realWrites: RealCommandVerdict; refusalReason: SafetyPreflightReason | null } {
  if (!controlEnabled) return { realWrites: "dry_run", refusalReason: null };
  if (!preflightEnabled) return { realWrites: "unguarded", refusalReason: null };
  // Adapter tắt / không đọc được bảng cấu hình ⇒ facade trả UNKNOWN trước khi phân loại.
  if (basis === "adapter_off" || basis === "read_error") return { realWrites: "blocked", refusalReason: "SAFETY_UNKNOWN" };
  const v = actuationPreflightVerdict(kinds.map((kind) => ({ kind, outcome: "clean" as const })));
  return v.state === "OK" ? { realWrites: "real_basis", refusalReason: null } : { realWrites: "blocked", refusalReason: v.reason };
}

export function computeSafetySourceHealth(s: SourceHealthSnapshot): SafetySourceHealth {
  // doc 81 Đợt 4 Task A1 — the SAME matcher the gate applies (plcConfigAppliesToTarget), never a copy.
  const configs = s.plcRead === "ok" ? s.plcConfigsEnabled.filter((c) => plcConfigAppliesToTarget(c, s.target ?? null)) : [];
  const kinds = configs.map((c) => effectiveBackend(c));
  const count = (k: EffectivePlcBackend) => kinds.filter((x) => x === k).length;
  const simScriptedConfigs = count("sim_scripted");
  const simConfigs = count("sim_empty") + simScriptedConfigs;
  const realConfigs = count("real");
  const realUnmappedConfigs = count("real_unmapped");
  // Configs that can yield OK WITHOUT reading a real safety tag.
  const nothingRead = simConfigs + realUnmappedConfigs;

  let basis: SafetyPlcBasis;
  if (!s.flags.safetyPlcAdapter) basis = "adapter_off";
  else if (s.plcRead === "error") basis = "read_error";
  else if (configs.length === 0) basis = "no_config";
  else if (realConfigs > 0 && nothingRead > 0) basis = "mixed";
  else if (realConfigs > 0) basis = "real";
  else if (simConfigs > 0) basis = "sim";
  else basis = "real_unmapped";

  const expectedReading =
    basis === "sim"
      ? "SIM"
      : basis === "real_unmapped"
        ? "UNMAPPED"
        : basis === "real"
          ? "REAL"
          : basis === "mixed"
            ? "MIXED"
            : "UNKNOWN";

  const plane = (flag: string, controlEnabled: boolean, preflightEnabled: boolean): PlaneHealth => {
    const { realWrites, refusalReason } = planeVerdict(controlEnabled, preflightEnabled, basis, kinds);
    return { flag, preflightEnabled, controlEnabled, realWrites, refusalReason };
  };

  const shown = configs.filter((c) => visible(s.visibleFactoryIds, c.factoryId));

  return {
    checkedAt: s.checkedAt,
    safetyPlc: {
      adapterEnabled: s.flags.safetyPlcAdapter,
      enabledConfigs: configs.length,
      simConfigs,
      simScriptedConfigs,
      realConfigs,
      realUnmappedConfigs,
      basis,
      configs: shown.map((c) => ({
        code: c.code,
        backend: c.backend,
        effective: effectiveBackend(c),
        provenance: deriveProvenance({ code: c.code, scope: c.scope })?.label ?? null,
      })),
      hiddenConfigs: configs.length - shown.length,
    },
    preflight: {
      expectedReading,
      ot: plane(SAFETY_PREFLIGHT_FLAGS.ot, s.flags.otControl, s.flags.otPreflight),
      robot: plane(SAFETY_PREFLIGHT_FLAGS.robot, s.flags.robotControl, s.flags.robotPreflight),
    },
    vision: {
      enabled: s.flags.safetyVision,
      calibrations: s.calibrations.filter((c) => visible(s.visibleFactoryIds, c.factoryId)).length,
      onnxPersonModelWired: false,
    },
    zoneSw: {
      enabled: s.flags.safetyZoneSw,
      zones: s.zones.filter((z) => visible(s.visibleFactoryIds, z.factoryId)).length,
    },
    estop: {
      enabled: s.flags.safetyEstopAdapter,
      adapter: s.estop.kind,
      label: stripEndpoint(s.estop.label),
      rated: s.estop.rated,
    },
    socket: { serverUp: s.socketServerUp },
  };
}

// ── Nạp ảnh chụp (chỉ đọc) ───────────────────────────────────────────────────────────

/**
 * Doc 80 Đợt 1 final wave (item 5) — các cờ mà bảng nguồn an toàn HIỂN THỊ, đọc bằng ĐÚNG vị từ mà các
 * cổng thật dùng (`isOtControlEnabled` của commandDispatcher, `isRobotControlEnabled` của
 * robotCommandDispatcher, hai vị từ preflight của safetyPreflightPolicy…). Không bao giờ tự parse
 * `process.env` ở đây: bản sao cũ `ROBOT_CONTROL_ENABLED === "true"` hôm nay khớp, nhưng một chỗ đổi
 * sang nhận "1" là bảng nói "tắt" trong khi cổng ghi thật. Xuất riêng để lưới lật từng biến và so với cổng.
 */
export function docCoDangBat(): SourceHealthSnapshot["flags"] {
  return {
    safetyPlcAdapter: safetyPlcAdapterEnabled(),
    otPreflight: isOtSafetyPreflightEnabled(),
    robotPreflight: isRobotSafetyPreflightEnabled(),
    otControl: isOtControlEnabled(),
    robotControl: isRobotControlEnabled(),
    safetyVision: safetyVisionEnabled(),
    safetyZoneSw: safetyZoneSwEnabled(),
    safetyEstopAdapter: safetyEstopAdapterEnabled(),
  };
}

/**
 * Nạp ảnh chụp cho người xem `viewer` rồi tính. Mọi lỗi đọc đều thành trạng thái trung thực
 * (plcRead='error', 0 zone/camera) — không ném, không bịa.
 */
export async function loadSafetySourceHealth(viewer: PhamViNguoiXem, targetRef?: SafetyTargetRef): Promise<SafetySourceHealth> {
  // Cùng đọc như safetyPlcAdapter.listPlcConfigs({ onlyEnabled: true }) — tập getSafetyStatus đọc.
  let plcConfigsEnabled: PlcConfigLite[] = [];
  let plcRead: "ok" | "error" = "ok";
  try {
    const d = await getDb();
    if (!d) {
      plcRead = "error"; // no DB ⇒ getSafetyStatus's listPlcConfigs throws ⇒ UNKNOWN
    } else {
      plcConfigsEnabled = await d
        .select({
          id: safetyPlcConfigs.id,
          code: safetyPlcConfigs.code,
          backend: safetyPlcConfigs.backend,
          endpoint: safetyPlcConfigs.endpoint,
          statusMap: safetyPlcConfigs.statusMap,
          factoryId: safetyPlcConfigs.factoryId,
          scope: safetyPlcConfigs.scope,
          robotId: safetyPlcConfigs.robotId,
          stationId: safetyPlcConfigs.stationId,
          lineId: safetyPlcConfigs.lineId,
        })
        .from(safetyPlcConfigs)
        .where(eq(safetyPlcConfigs.enabled, true))
        .orderBy(safetyPlcConfigs.id);
    }
  } catch {
    plcRead = "error";
  }

  let visibleFactoryIds: number[] | null = [];
  try {
    visibleFactoryIds = await idsTrongPhamVi("factory", viewer);
  } catch {
    visibleFactoryIds = []; // không phân giải được phạm vi ⇒ không lộ mã nào (fail-closed)
  }

  const zones = await listZones({ onlyEnabled: true }).catch(() => []);
  const calibrations = await listCalibrations({ onlyEnabled: true }).catch(() => []);

  // Fix round 1 #3 — NEVER health() per request (a registered vendor adapter would read the PLC).
  const estopAdapter = getSafetyPlcAdapter();

  // doc 81 Đợt 4 Task A1 — the gate's own resolver; no ref (today's panel) ⇒ null ⇒ every config.
  const target = targetRef ? await resolveSafetyTarget(targetRef) : null;

  return computeSafetySourceHealth({
    checkedAt: new Date().toISOString(),
    flags: docCoDangBat(),
    plcConfigsEnabled,
    plcRead,
    target,
    visibleFactoryIds,
    zones: zones.map((z) => ({ factoryId: z.factoryId ?? null })),
    calibrations: calibrations.map((c) => ({ factoryId: c.factoryId ?? null })),
    estop: {
      kind: estopAdapter.kind,
      label: estopAdapter.label(),
      rated: estopAdapter.isRated(),
    },
    socketServerUp: getIO() != null,
  });
}
