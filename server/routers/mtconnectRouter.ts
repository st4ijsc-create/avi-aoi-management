/**
 * MTConnect router — test an Agent connection + read poller status (READ-ONLY).
 *
 * SAFETY: this router has NO mutations and NO control path. `testConnection`
 * performs a single read-only GET /probe against the supplied agent URL (the
 * client is fully fail-safe); `status` returns the in-process poller snapshot.
 * RBAC via module 'machine_control' (canView) — same surface as the OT readers.
 */
import { z } from "zod";
import { router, moduleProcedure } from "../_core/trpc";
// Doc 38 Đợt Q — license-gate this router behind MOD_OT_CONTROL (moduleGate = pass-through
// until the deployment's SKU is configured — no-brick). Shadows `protectedProcedure`.
const protectedProcedure = moduleProcedure("MOD_OT_CONTROL");
import { requirePermission } from "../_core/accessControl";

export const mtconnectRouter = router({
  /** Probe an MTConnect Agent and report how many DataItems it exposes. */
  testConnection: protectedProcedure
    .use(requirePermission("machine_control", "canView"))
    .input(z.object({ agentUrl: z.string().url(), timeoutMs: z.number().int().min(500).max(30000).optional() }))
    .mutation(async ({ input }) => {
      const { fetchProbe } = await import("../services/mtconnect/mtconnectClient");
      const probe = await fetchProbe(input.agentUrl, input.timeoutMs ?? 8000);
      return {
        ok: probe.dataItemCount > 0,
        deviceCount: probe.devices.length,
        dataItemCount: probe.dataItemCount,
        devices: probe.devices.map((d) => ({ name: d.name, uuid: d.uuid, dataItemCount: d.dataItems.length })),
      };
    }),

  /** In-process poller status (enabled flag, running, per-source stats). */
  status: protectedProcedure
    .use(requirePermission("machine_control", "canView"))
    .query(async () => {
      const { getMtconnectStats } = await import("../services/mtconnect/mtconnectPoller");
      return getMtconnectStats();
    }),
});
