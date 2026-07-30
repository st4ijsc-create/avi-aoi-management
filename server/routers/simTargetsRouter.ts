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
  type UrsimEndpoint,
} from "../services/robot/ursim";
import {
  ros2BridgeEnabled,
  rosbridgeUrlFromEnv,
  startRos2Bridge,
  stopRos2Bridge,
  getRos2Bridge,
} from "../services/ros2";

// In-process cache of the last URSim validation result (read-back for the UI). Best-effort.
let lastUrsimValidation: { at: string; result: unknown } | null = null;

const endpointInput = z.object({
  host: z.string().min(1),
  scriptPort: z.number().int().min(1).max(65535).optional(),
  dashboardPort: z.number().int().min(1).max(65535).optional(),
  timeoutMs: z.number().int().min(500).max(60000).optional(),
});

function resolveEndpoint(input?: z.infer<typeof endpointInput>): UrsimEndpoint | null {
  if (input) return input;
  return ursimEndpointFromEnv();
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

  /** Cheap URSim reachability probe (dashboard port). Honest — never fabricates reachable. */
  ursimPing: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .input(z.object({ endpoint: endpointInput.optional() }).optional())
    .query(async ({ input }) => {
      const ep = resolveEndpoint(input?.endpoint);
      if (!ep) return { reachable: false, error: "No URSim endpoint (set URSIM_HOST or pass endpoint)" };
      return new UrsimClient(ep).ping();
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
      endpoint: endpointInput.optional(),
      powerOn: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      if (!ursimEnabled()) {
        throw appError("CONFLICT", "FEATURE_DISABLED", { feature: "ursimHarness" }, "URSim harness disabled (set URSIM_ENABLED=true)");
      }
      const ep = resolveEndpoint(input.endpoint);
      if (!ep) {
        throw appError("BAD_REQUEST", "FIELD_REQUIRED", { field: "ursimEndpoint" }, "No URSim endpoint (set URSIM_HOST or pass endpoint)");
      }
      const result = await validateUrscriptOnUrsim(input.urscript, ep, { powerOn: input.powerOn });
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
        throw appError("BAD_REQUEST", "FIELD_REQUIRED", { field: "rosbridgeUrl" }, "ROSBRIDGE_URL is empty");
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
