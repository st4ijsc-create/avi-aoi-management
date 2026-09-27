/**
 * Doc 20 §3/§5/§7 (I3a-3) — SIM TARGETS router: URSim + ROS2 validation harness surface.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * READS  (machine_monitoring / canView): URSim connection status + last validation, ROS2
 *        bridge status. Cheap probes only — no control.
 * MUTATIONS (machine_control / canCreate, + flag guard): run a URScript-on-URSim
 *        validation, connect/disconnect the ROS2 bridge.
 *
 * SAFETY: this router opens NO new control path. URScript validation goes through the
 * URSim deploy service (same DPC_DEPLOY_ENABLED + HITL gate; URSim is a safe VIRTUAL
 * device). The bridge connect/disconnect only manage the transport — ROS2 COMMANDS still
 * route through robotCommandDispatcher. ctx.user is the source of truth for HITL.
 *
 * doc 81 Đợt 1B Task 3 (BE2 §L3b, §3 S2): `validateUrscript` / `ursimPing` NO LONGER take a
 * caller-supplied host/port — that let anyone with machine_control point `power on` +
 * `brake release` + an arbitrary script at a REAL UR arm. Input is only a `targetId` of a
 * server-registered sim target (`resolveSimTarget`: today only "default" = URSIM_HOST,
 * refused when that host is a robot / device adapter in the DB). Unknown / unverifiable
 * target ⇒ PRECONDITION_FAILED. Extra input keys (host, endpoint, ports) ⇒ Zod rejects.
 * `ursimPing` is gated exactly like `validateUrscript` (URSIM_ENABLED + machine_control/canCreate).
 * ════════════════════════════════════════════════════════════════════════════
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../_core/trpc";
import { requirePermission } from "../_core/accessControl";
import { appError } from "../_core/appError";
import {
  UrsimClient,
  validateUrscriptOnUrsim,
  ursimEnabled,
  ursimEndpointFromEnv,
} from "../services/robot/ursim";
import { resolveSimTarget } from "../services/robot/ursim/simTargetRegistry";
import {
  ros2BridgeEnabled,
  rosbridgeUrlFromEnv,
  startRos2Bridge,
  stopRos2Bridge,
  getRos2Bridge,
} from "../services/ros2";

// In-process cache of the last URSim validation result (read-back for the UI). Best-effort.
let lastUrsimValidation: { at: string; result: unknown } | null = null;

/**
 * A registered sim target id (today only "default"). `.strict()` on the enclosing objects ⇒
 * any caller-supplied host / endpoint / port key is a Zod error, never silently ignored.
 */
const targetIdInput = z.string().min(1).max(64);

function assertUrsimEnabled(): void {
  if (!ursimEnabled()) {
    throw appError("CONFLICT", "FEATURE_DISABLED", { feature: "ursimHarness" }, "URSim harness disabled (set URSIM_ENABLED=true)");
  }
}

export const simTargetsRouter = router({
  /** UI gating hint — which sim-target flags/endpoints are configured. */
  status: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .query(() => ({
      ursim: {
        enabled: ursimEnabled(),
        endpointConfigured: ursimEndpointFromEnv() != null,
        lastValidation: lastUrsimValidation,
      },
      ros2: {
        enabled: ros2BridgeEnabled(),
        urlConfigured: rosbridgeUrlFromEnv() != null,
        bridge: getRos2Bridge()?.status() ?? { connected: false, started: false, topics: [] },
      },
    })),

  /**
   * Cheap URSim reachability probe (dashboard port) of a REGISTERED sim target. Honest —
   * never fabricates reachable. Same gate as validateUrscript (URSIM_ENABLED +
   * machine_control/canCreate): it opens a TCP socket, so a view-only role may not aim it.
   */
  ursimPing: protectedProcedure
    .use(requirePermission("machine_control", "canCreate"))
    .input(z.object({ targetId: targetIdInput }).strict())
    .query(async ({ input }) => {
      assertUrsimEnabled();
      const target = await resolveSimTarget(input.targetId);
      return new UrsimClient(target.endpoint).ping();
    }),

  /** ROS2 bridge status read-back. */
  ros2Status: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .query(() => ({
      enabled: ros2BridgeEnabled(),
      urlConfigured: rosbridgeUrlFromEnv() != null,
      ...(getRos2Bridge()?.status() ?? { connected: false, started: false, topics: [] as string[] }),
    })),

  /**
   * Run the end-to-end URScript-on-URSim validation. Flag-gated (URSIM_ENABLED). The
   * caller (ctx.user) is the HITL sign-off. Sends the transpiled URScript to the (virtual)
   * controller and reports sent/accepted/running — the Khối-6 end-to-end proof.
   */
  validateUrscript: protectedProcedure
    .use(requirePermission("machine_control", "canCreate"))
    .input(z.object({
      urscript: z.string().min(1).max(200_000),
      targetId: targetIdInput,
      powerOn: z.boolean().optional(),
    }).strict())
    .mutation(async ({ input }) => {
      assertUrsimEnabled();
      // power on / brake release / script go ONLY to the registered, verified-virtual target.
      const target = await resolveSimTarget(input.targetId);
      const result = await validateUrscriptOnUrsim(input.urscript, target.endpoint, { powerOn: input.powerOn });
      lastUrsimValidation = { at: new Date().toISOString(), result };
      return result;
    }),

  /** Connect the ROS2 bridge (flag-gated). Honest — unreachable → clear error, connects nothing. */
  ros2Connect: protectedProcedure
    .use(requirePermission("machine_control", "canCreate"))
    .mutation(async () => {
      if (!ros2BridgeEnabled()) {
        throw appError("CONFLICT", "FEATURE_DISABLED", { feature: "ros2Bridge" }, "ROS2 bridge disabled (set ROS2_BRIDGE_ENABLED=true)");
      }
      if (!rosbridgeUrlFromEnv()) {
        // Review cuối, ca I-A #4: `ros2Connect` KHÔNG có `.input()` — không có trường
        // "rosbridgeUrl" nào trên màn hình để người dùng điền. FIELD_REQUIRED sẽ chỉ
        // người vận hành đi tìm một ô nhập không tồn tại. ROSBRIDGE_URL là biến môi
        // trường phía máy chủ — đây là lỗi CẤU HÌNH MÁY CHỦ, cùng họ với guard ngay
        // dưới (:128, OPERATION_FAILED — đã sửa đúng ở fix round 1, I-1).
        throw appError("BAD_REQUEST", "OPERATION_FAILED", { operation: "connectRos2Bridge" }, "ROSBRIDGE_URL is empty");
      }
      const bridge = await startRos2Bridge();
      if (!bridge) {
        // startRos2Bridge already logged the honest reason; surface it. NOT
        // FEATURE_DISABLED — the flag IS on (checked above) and the URL IS set; this
        // is a live connect failure, a different situation needing a different action
        // than "go enable the feature" (fix round 1, I-1).
        throw appError("SERVICE_UNAVAILABLE", "OPERATION_FAILED", { operation: "connectRos2Bridge" }, "ROS2 bridge did not connect (rosbridge unreachable?)");
      }
      return bridge.status();
    }),

  /** Disconnect the ROS2 bridge. */
  ros2Disconnect: protectedProcedure
    .use(requirePermission("machine_control", "canCreate"))
    .mutation(async () => {
      await stopRos2Bridge();
      return { ok: true };
    }),
});
