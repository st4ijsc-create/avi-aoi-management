/**
 * Doc 40 Wave 3A (§11) — CTL "Control / Trust Readiness" READ-ONLY router (key "readiness").
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Gom TRẠNG THÁI gate/flag runtime của tầng điều khiển & tin cậy từ CÁC NGUỒN ĐÃ
 * CÓ (process.env + pure getter sẵn có) thành MỘT ma trận đèn xanh/vàng/đỏ cho
 * trang QA + audit trực quan (/control-readiness). "Trust & Enforcement Center".
 *
 * SAFETY (TUYỆT ĐỐI): 100% READ-ONLY. Router này KHÔNG import command/dispatch
 * path, KHÔNG gọi driver, KHÔNG ghi gì, KHÔNG đổi hành vi runtime. Nó chỉ ĐỌC cờ
 * môi trường (đúng logic mà từng service dùng) + một getter thuần (MTConnect stats,
 * consistency check) và đếm user đặc quyền chưa bật 2FA. Không bật/tắt cờ nào.
 *
 * HONEST: mỗi mục trả {key,label,group,state,enabled,reason}. Cờ mặc-định-ON (an
 * toàn theo mặc định — commissioning/module-gate) được coi là "armed" khi bật và
 * "bypass" khi bị opt-out. Cờ điều khiển (OT_CONTROL/ROBOT_CONTROL…) là "armed" khi
 * đường ghi thật đã trang bị, "dormant" khi tắt. LICENSE_BYPASS / legacy shared-key
 * là "bypass". Cấu hình lệch control↔gateway là "warn". Không bịa dữ liệu.
 *
 * RBAC: admin (bypass) HOẶC `admin_system`.canView HOẶC `machine_control`.canView.
 * ctx.user là nguồn sự thật — không bao giờ đọc từ body.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { TRPCError } from "@trpc/server";
import { and, eq, inArray } from "drizzle-orm";
import { router, protectedProcedure } from "../_core/trpc";
import { appError } from "../_core/appError";
import { checkPermission } from "../_core/accessControl";
import { getMtconnectStats } from "../services/mtconnect/mtconnectPoller";
import { checkControlGatewayConsistency } from "../services/controlGatewayConsistency";
import { getDb } from "../db/connection";
import { users } from "../../drizzle/schema";

// ── kiểu ma trận ──────────────────────────────────────────────────────────────

/** Nhóm hiển thị (đèn theo nhóm). */
export type ReadinessGroup =
  | "connectivity" // Kết nối
  | "control" // Điều khiển
  | "verification" // Xác minh
  | "safety" // An toàn
  | "security" // Bảo mật
  | "observability"; // Observability

/**
 * Trạng thái ngữ nghĩa (đèn):
 *   • armed   — đường/gate thật ĐANG hoạt động (xanh cho control, xanh cho gate an toàn đã bật).
 *   • dormant — cờ TẮT → năng lực không hoạt động (vàng nhạt, không phải lỗi).
 *   • bypass  — một lớp bảo vệ/enforcement bị TẮT làm yếu thế trận (đỏ/cam cảnh báo).
 *   • warn    — cấu hình LỆCH (vd control armed nhưng gateway tắt) (đỏ).
 */
export type ReadinessState = "armed" | "dormant" | "bypass" | "warn";

export interface ReadinessItem {
  key: string;
  label: string;
  group: ReadinessGroup;
  state: ReadinessState;
  /** Cờ thô có bật hay không (đúng nghĩa "được cấu hình bật"). */
  enabled: boolean;
  /** Giải thích ngắn "đang thật / dormant vì X / bypass vì Y". */
  reason: string;
}

// ── helper đọc cờ (đúng logic từng service, KHÔNG side-effect) ─────────────────

const on = (v?: string) => v === "true" || v === "1";
/** Cờ mặc-định-ON: chỉ "false"/"0" tường minh mới tắt (commissioning/module-gate…). */
const defaultOn = (v?: string) => !(v === "false" || v === "0");

// ════════════════════════════════════════════════════════════════════════════
// Bộ thu ma trận (THUẦN, đồng bộ — dùng chung cho router VÀ boot summary).
// Không truy cập DB (phần đếm 2FA async được router bổ sung riêng).
// ════════════════════════════════════════════════════════════════════════════

export function collectFlagMatrix(env: NodeJS.ProcessEnv = process.env): ReadinessItem[] {
  const items: ReadinessItem[] = [];
  const add = (i: ReadinessItem) => items.push(i);

  // helper cho cờ "điều khiển"/"kết nối" (armed khi bật, dormant khi tắt)
  const arm = (
    key: string,
    label: string,
    group: ReadinessGroup,
    enabled: boolean,
    armedReason: string,
    dormantReason: string,
  ) =>
    add({
      key,
      label,
      group,
      enabled,
      state: enabled ? "armed" : "dormant",
      reason: enabled ? armedReason : dormantReason,
    });

  // ── Kết nối ─────────────────────────────────────────────────────────────────
  arm(
    "OT_GATEWAY_ENABLED",
    "OT Gateway (adapter loader)",
    "connectivity",
    on(env.OT_GATEWAY_ENABLED),
    "Gateway bật — adapter OT được nạp; đường đọc/ghi có driver.",
    "dormant vì OT_GATEWAY_ENABLED tắt → không adapter nào start.",
  );
  arm(
    "OPCUA_GATEWAY_ENABLED",
    "OPC-UA Gateway",
    "connectivity",
    on(env.OPCUA_GATEWAY_ENABLED),
    "Bật — poll OPC-UA endpoint (cần OPCUA_ENDPOINT_URL).",
    "dormant vì OPCUA_GATEWAY_ENABLED tắt.",
  );

  // MTConnect: cờ + số nguồn THẬT (getter thuần, không I/O).
  {
    const enabled = on(env.MTCONNECT_ENABLED);
    let sources = 0;
    let running = false;
    try {
      const s = getMtconnectStats();
      sources = s.sources.length;
      running = s.running;
    } catch {
      /* getter thuần — bỏ qua nếu chưa init */
    }
    add({
      key: "MTCONNECT_ENABLED",
      label: "MTConnect (CNC) poller",
      group: "connectivity",
      enabled,
      state: enabled ? (sources > 0 ? "armed" : "dormant") : "dormant",
      reason: !enabled
        ? "dormant vì MTCONNECT_ENABLED tắt."
        : sources > 0
          ? `đang thật — ${sources} nguồn cấu hình${running ? ", poller đang chạy" : ""}.`
          : "bật nhưng chưa có nguồn nào cấu hình → không thu thập gì (honest).",
    });
  }

  {
    const secsFramework = on(env.SECS_GEM_ENABLED);
    const secsLive = secsFramework && on(env.SECS_GEM_LIVE_ENABLED);
    add({
      key: "SECS_GEM_LIVE_ENABLED",
      label: "SECS/GEM live (HSMS)",
      group: "connectivity",
      enabled: secsLive,
      state: secsLive ? "armed" : "dormant",
      reason: secsLive
        ? "đang thật — HSMS live dispatch bật (SECS_GEM_ENABLED + SECS_GEM_LIVE_ENABLED)."
        : secsFramework
          ? "dormant vì SECS_GEM_LIVE_ENABLED tắt (chỉ framework, không live)."
          : "dormant vì SECS_GEM_ENABLED tắt.",
    });
  }

  arm(
    "ROBOT_GATEWAY_ENABLED",
    "Robot Gateway (driver loader)",
    "connectivity",
    on(env.ROBOT_GATEWAY_ENABLED),
    "Bật — vendor robot driver được nạp.",
    "dormant vì ROBOT_GATEWAY_ENABLED tắt → không robot nào start.",
  );
  arm(
    "VDA5050_ENABLED",
    "VDA 5050 (AGV/AMR)",
    "connectivity",
    on(env.VDA5050_ENABLED),
    "Bật — driver AGV/AMR VDA5050 nạp.",
    "dormant vì VDA5050_ENABLED tắt.",
  );

  // ── Điều khiển ───────────────────────────────────────────────────────────────
  arm(
    "OT_CONTROL_ENABLED",
    "OT Control (real-write path)",
    "control",
    on(env.OT_CONTROL_ENABLED),
    "đang thật — đường ghi thật OT đã trang bị (vẫn qua HITL + gate).",
    "dormant vì OT_CONTROL_ENABLED tắt → lệnh ghi → 'simulated'.",
  );
  arm(
    "ROBOT_CONTROL_ENABLED",
    "Robot Control (real motion)",
    "control",
    on(env.ROBOT_CONTROL_ENABLED),
    "đang thật — motion control thật đã trang bị (vẫn qua HITL + gate).",
    "dormant vì ROBOT_CONTROL_ENABLED tắt → lệnh robot dry-run.",
  );
  {
    // Mock vendors = một dạng bypass (giả lập nhà cung cấp thay vì HW thật).
    const enabled = on(env.ROBOT_MOCK_VENDORS_ENABLED);
    add({
      key: "ROBOT_MOCK_VENDORS_ENABLED",
      label: "Robot mock vendors",
      group: "control",
      enabled,
      state: enabled ? "bypass" : "dormant",
      reason: enabled
        ? "bypass — vendor robot bị GIẢ LẬP (lab/simulator), KHÔNG phải HW production."
        : "tắt — dùng driver vendor thật (không giả lập).",
    });
  }
  arm(
    "FOE_ENABLED",
    "Factory Orchestration Engine",
    "control",
    on(env.FOE_ENABLED),
    "đang thật — FOE deploy/run bật (qua deploy gate).",
    "dormant vì FOE_ENABLED tắt → orchestration trả 'disabled'.",
  );
  arm(
    "FOE_DURABLE",
    "FOE durable run-log + auto-resume",
    "control",
    on(env.FOE_DURABLE),
    "đang thật — RunEvent log bền vững + auto-resume (FOE_DURABLE).",
    "dormant vì FOE_DURABLE tắt → run không bền vững, không auto-resume.",
  );
  arm(
    "INTERLOCK_ENGINE_ENABLED",
    "Interlock engine (ALERT-ONLY)",
    "control",
    on(env.INTERLOCK_ENGINE_ENABLED),
    "đang thật — engine chạy, nâng Andon + ghi interlock_events (KHÔNG có đường ghi máy).",
    "dormant vì INTERLOCK_ENGINE_ENABLED tắt → không đánh giá interlock nền.",
  );
  {
    // Auto-block = cho phép interlock TỰ ghi lệnh chặn/dừng → là một bypass rủi ro cao.
    const enabled = on(env.INTERLOCK_AUTO_BLOCK_ENABLED);
    add({
      key: "INTERLOCK_AUTO_BLOCK_ENABLED",
      label: "Interlock auto-block (tự ghi lệnh)",
      group: "control",
      enabled,
      state: enabled ? "bypass" : "armed",
      reason: enabled
        ? "bypass — interlock được phép TỰ ghi lệnh chặn/dừng xuống máy (cần OT_CONTROL + rule approved)."
        : "armed (an toàn) — interlock-triggered dispatch bị TỪ CHỐI, không tự ghi máy.",
    });
  }

  // ── Xác minh ─────────────────────────────────────────────────────────────────
  arm(
    "OT_READBACK_ENABLED",
    "OT read-back ack verify",
    "verification",
    on(env.OT_READBACK_ENABLED),
    "đang thật — write được xác minh bằng read-back sau ack.",
    "dormant vì OT_READBACK_ENABLED tắt → ack không được đối chiếu read-back.",
  );
  {
    // Commissioning gate: MẶC ĐỊNH ON (an toàn). Bật = armed; opt-out = bypass.
    const req = defaultOn(env.OT_COMMISSIONING_REQUIRED);
    add({
      key: "OT_COMMISSIONING_REQUIRED",
      label: "OT commissioning/FAT gate",
      group: "verification",
      enabled: req,
      state: req ? "armed" : "bypass",
      reason: req
        ? "armed (mặc định ON) — adapter phải commissioned trước real-write; nếu chưa → ép 'simulated'."
        : "bypass — OT_COMMISSIONING_REQUIRED=false/0 → cho ghi thật adapter chưa ký (legacy/dev).",
    });
  }
  {
    const req = defaultOn(env.ROBOT_COMMISSIONING_REQUIRED);
    add({
      key: "ROBOT_COMMISSIONING_REQUIRED",
      label: "Robot commissioning/FAT gate",
      group: "verification",
      enabled: req,
      state: req ? "armed" : "bypass",
      reason: req
        ? "armed (mặc định ON) — robot phải commissioned trước real-write; nếu chưa → ép 'simulated'."
        : "bypass — ROBOT_COMMISSIONING_REQUIRED=false/0 → cho ghi thật robot chưa ký (legacy/dev).",
    });
  }
  arm(
    "ACTUATION_STEPUP_2FA",
    "Step-up 2FA cho actuation/deploy",
    "verification",
    on(env.ACTUATION_STEPUP_2FA),
    "đang thật — mọi lệnh actuation/deploy đòi OTP 6 số tươi (cache 10').",
    "dormant vì ACTUATION_STEPUP_2FA tắt → chỉ cần 2FA-enabled, không re-verify OTP tươi.",
  );

  // ── An toàn ──────────────────────────────────────────────────────────────────
  arm(
    "SAFETY_VISION_ENABLED",
    "Safety vision (human detect, ADVISORY)",
    "safety",
    on(env.SAFETY_VISION_ENABLED),
    "bật — producer sẵn sàng (cần camera+calibration+ONNX; ADVISORY, không actuate).",
    "dormant vì SAFETY_VISION_ENABLED tắt.",
  );
  arm(
    "SAFETY_PLC_ADAPTER_ENABLED",
    "Safety-PLC adapter (READ-ONLY)",
    "safety",
    on(env.SAFETY_PLC_ADAPTER_ENABLED),
    "bật — chỉ ĐỌC trạng thái Safety-PLC (PLC tự thực hiện rated stop bằng phần cứng).",
    "dormant vì SAFETY_PLC_ADAPTER_ENABLED tắt.",
  );
  // Cấu hình lệch control↔gateway (control armed nhưng gateway tắt → lệnh rơi âm thầm).
  for (const w of checkControlGatewayConsistency(env)) {
    const domain = w.startsWith("[Robot]") ? "Robot" : "OT";
    add({
      key: `CONTROL_GATEWAY_MISMATCH_${domain}`,
      label: `Cấu hình lệch control↔gateway (${domain})`,
      group: "safety",
      enabled: true,
      state: "warn",
      reason: w,
    });
  }

  // ── Bảo mật ──────────────────────────────────────────────────────────────────
  arm(
    "DEVICE_PKI_ENABLED",
    "Device PKI (X.509 enforcement)",
    "security",
    on(env.DEVICE_PKI_ENABLED),
    "đang thật — enforcement danh tính thiết bị X.509 bật.",
    "dormant vì DEVICE_PKI_ENABLED tắt → verify trả flag-off (không enforce).",
  );
  arm(
    "SERVICE_MTLS_ENABLED",
    "Service mTLS (SPIFFE-lite)",
    "security",
    on(env.SERVICE_MTLS_ENABLED),
    "đang thật — enforcement danh tính service (mTLS) bật.",
    "dormant vì SERVICE_MTLS_ENABLED tắt.",
  );
  {
    // Legacy shared plaintext key: MẶC ĐỊNH cho phép (true) → là một bypass/thế trận yếu.
    const allowed = env.MACHINE_SHARED_KEY_ALLOWED !== "false";
    add({
      key: "MACHINE_SHARED_KEY_ALLOWED",
      label: "Legacy shared machine key",
      group: "security",
      enabled: allowed,
      state: allowed ? "bypass" : "armed",
      reason: allowed
        ? "bypass (mặc định) — chấp nhận shared plaintext key cũ. Đặt =false khi mọi máy đã rotate."
        : "armed — chỉ chấp nhận per-machine hashed key (đã rotate xong).",
    });
  }
  {
    const bypass = on(env.LICENSE_BYPASS);
    add({
      key: "LICENSE_BYPASS",
      label: "License bypass",
      group: "security",
      enabled: bypass,
      state: bypass ? "bypass" : "armed",
      reason: bypass
        ? "bypass — LICENSE_BYPASS=true → bỏ qua mọi kiểm tra bản quyền (offline deployment)."
        : "armed — kiểm tra bản quyền đang hiệu lực.",
    });
  }
  {
    // Module gate: MẶC ĐỊNH ON (no-brick: chỉ enforce khi SKU đã khai báo module).
    const gate = env.LICENSE_MODULE_GATE_ENABLED !== "false";
    add({
      key: "LICENSE_MODULE_GATE_ENABLED",
      label: "Per-module license gate",
      group: "security",
      enabled: gate,
      state: gate ? "armed" : "bypass",
      reason: gate
        ? "armed (mặc định ON) — tRPC vào module MOD_* chưa cấp phép bị FORBIDDEN (no-brick khi chưa khai SKU)."
        : "bypass — LICENSE_MODULE_GATE_ENABLED=false → không chặn module theo bản quyền.",
    });
  }
  arm(
    "TENANT_RLS_ENABLED",
    "Tenant RLS (row-level scope)",
    "security",
    on(env.TENANT_RLS_ENABLED),
    "đang thật — RLS theo phạm vi factory/corporate bật.",
    "dormant vì TENANT_RLS_ENABLED tắt.",
  );

  // ── Observability ────────────────────────────────────────────────────────────
  arm(
    "OBSERVABILITY",
    "SLO burn-rate + alerting",
    "observability",
    on(env.OBSERVABILITY),
    "đang thật — SLO tracker + burn-rate alerting chạy.",
    "dormant vì OBSERVABILITY tắt → không đánh giá SLO/không cảnh báo burn-rate.",
  );
  arm(
    "METRICS_ENABLED",
    "Prometheus metrics",
    "observability",
    on(env.METRICS_ENABLED),
    "đang thật — /metrics phục vụ số liệu prom-client.",
    "dormant vì METRICS_ENABLED tắt → /metrics rỗng/no-op.",
  );
  arm(
    "DOWNTIME_DETECTION_ENABLED",
    "Downtime detection sweep",
    "observability",
    on(env.DOWNTIME_DETECTION_ENABLED),
    "đang thật — sweep phát hiện downtime ghi downtime_events.",
    "dormant vì DOWNTIME_DETECTION_ENABLED tắt → không tự phát hiện downtime.",
  );
  arm(
    "OEE_SNAPSHOT_ENABLED",
    "OEE snapshot scheduler",
    "observability",
    on(env.OEE_SNAPSHOT_ENABLED),
    "đang thật — cron chụp OEE (WRITES oee snapshots).",
    "dormant vì OEE_SNAPSHOT_ENABLED tắt → không chụp OEE định kỳ.",
  );
  arm(
    "SSE_ENABLED",
    "SSE realtime stream",
    "observability",
    on(env.SSE_ENABLED),
    "đang thật — /api/stream phát sự kiện realtime.",
    "dormant vì SSE_ENABLED tắt → /api/stream 404/no-op.",
  );

  return items;
}

// ════════════════════════════════════════════════════════════════════════════
// RBAC: admin (bypass) HOẶC admin_system.canView HOẶC machine_control.canView.
// ════════════════════════════════════════════════════════════════════════════

const readinessProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  const user = ctx.user;
  if (!user) {
    throw appError("UNAUTHORIZED", "AUTH_REQUIRED", undefined, "Login required");
  }
  if (user.role === "admin") return next();
  const [sys, ctl] = await Promise.all([
    checkPermission(user.id, user.role, "admin_system", "canView"),
    checkPermission(user.id, user.role, "machine_control", "canView"),
  ]);
  if (!sys && !ctl) {
    throw appError(
      "FORBIDDEN",
      "PERMISSION_DENIED",
      // Task 5 (doc 71) — reason khôi phục TÊN QUYỀN cần có: câu chuẩn PERMISSION_DENIED
      // chỉ nội suy {{action}} ("xem Trust & Enforcement Center"), không nói CẦN quyền
      // gì để được cấp — người dùng đọc xong vẫn không biết đi xin quyền nào.
      { action: "viewTrustEnforcementCenter", reason: "needsAdminSystemOrMachineControl" },
      "Cần quyền xem admin_system hoặc machine_control để truy cập Trust & Enforcement Center.",
    );
  }
  return next();
});

/** Các role đặc quyền BẮT BUỘC bật 2FA (đồng bộ PRIVILEGED_ROLES ở _core/trpc.ts). */
const PRIVILEGED_ROLES = ["admin", "supervisor", "quality_inspector", "engineer"] as const;

export const readinessRouter = router({
  /**
   * Một snapshot READ-ONLY toàn ma trận readiness: các nhóm cờ/gate + đếm user
   * đặc quyền chưa bật 2FA. Không đổi hành vi, không ghi gì.
   */
  matrix: readinessProcedure.query(async () => {
    const items = collectFlagMatrix();

    // Đếm user đặc quyền (role ∈ PRIVILEGED_ROLES, đang active) chưa bật 2FA.
    // Fail-safe: DB không sẵn → available:false (không bịa số).
    let privileged2fa: {
      available: boolean;
      totalPrivileged: number;
      without2fa: number;
      users: { id: number; username: string | null; role: string }[];
    } = { available: false, totalPrivileged: 0, without2fa: 0, users: [] };

    try {
      const db = await getDb();
      if (db) {
        const rows = await db
          .select({
            id: users.id,
            username: users.username,
            role: users.role,
            twoFactorEnabled: users.twoFactorEnabled,
          })
          .from(users)
          .where(and(inArray(users.role, [...PRIVILEGED_ROLES]), eq(users.isActive, true)));
        const missing = rows.filter((r) => !r.twoFactorEnabled);
        privileged2fa = {
          available: true,
          totalPrivileged: rows.length,
          without2fa: missing.length,
          users: missing.map((r) => ({ id: r.id, username: r.username, role: r.role })),
        };
      }
    } catch {
      /* fail-safe: giữ available:false */
    }

    // Thêm mục 2FA vào nhóm Bảo mật (đèn theo số user thiếu 2FA).
    const twofaItem: ReadinessItem = privileged2fa.available
      ? {
          key: "PRIVILEGED_2FA",
          label: "User đặc quyền đã bật 2FA",
          group: "security",
          enabled: privileged2fa.without2fa === 0,
          state: privileged2fa.without2fa === 0 ? "armed" : "warn",
          reason:
            privileged2fa.without2fa === 0
              ? `armed — cả ${privileged2fa.totalPrivileged} user đặc quyền đều đã bật 2FA.`
              : `warn — ${privileged2fa.without2fa}/${privileged2fa.totalPrivileged} user đặc quyền CHƯA bật 2FA (khóa mọi lệnh actuation/deploy của họ).`,
        }
      : {
          key: "PRIVILEGED_2FA",
          label: "User đặc quyền đã bật 2FA",
          group: "security",
          enabled: false,
          state: "dormant",
          reason: "dormant — không đọc được DB để kiểm tra trạng thái 2FA (honest, không bịa số).",
        };

    // Tổng hợp đèn theo nhóm (đếm state để UI vẽ nhanh).
    const all = [...items, twofaItem];
    const summary = {
      total: all.length,
      armed: all.filter((i) => i.state === "armed").length,
      dormant: all.filter((i) => i.state === "dormant").length,
      bypass: all.filter((i) => i.state === "bypass").length,
      warn: all.filter((i) => i.state === "warn").length,
    };

    return {
      generatedAt: new Date().toISOString(),
      items: all,
      privileged2fa,
      summary,
    };
  }),
});
