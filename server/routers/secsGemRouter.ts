/**
 * SECS/GEM Connectivity router (key "secsGem").
 *
 * ── HONESTY / SCOPE ──────────────────────────────────────────────────────────
 * Exposes the SECS/GEM FRAMEWORK (SEMI E37 HSMS + a SECS-II/GEM skeleton). This
 * is NOT a certified production driver: `testConnection` proves only that a TCP
 * peer answered HSMS Select + Linktest — it does NOT certify GEM compliance, and
 * the full SECS-II binary codec + GEM state machine still require validation
 * against real equipment (or a vetted SECS library). Every response carries that
 * caveat explicitly.
 *
 * ── SAFETY / GATING ──────────────────────────────────────────────────────────
 *   - Flag SECS_GEM_ENABLED (default OFF): when not "true", `testConnection` is a
 *     no-op that opens NO socket and returns { enabled:false }.
 *   - RBAC: machine_monitoring / canView (read-only monitoring capability).
 *   - Fail-safe: HSMS errors are caught and returned as { ok:false, error }; the
 *     process never crashes.
 *
 * Register in server/routers.ts (do NOT edited there by this framework) as:
 *     import { secsGemRouter } from "./routers/secsGemRouter";
 *     // inside the appRouter object:
 *     secsGem: secsGemRouter,
 */
import { z } from "zod";
import { router, moduleProcedure } from "../_core/trpc";
// Doc 38 Đợt Q — license-gate this router behind MOD_OT_CONTROL (moduleGate = pass-through
// until the deployment's SKU is configured — no-brick). Shadows `protectedProcedure`.
const protectedProcedure = moduleProcedure("MOD_OT_CONTROL");
import { requirePermission } from "../_core/accessControl";
import { isSecsGemEnabled, listSecsGemKeys, HsmsClient, HONESTY_CAVEAT, getSecsGemHealth } from "../services/secsgem";
import "../services/secsgem"; // side-effect: register the built-in "secsgem" connector

export const secsGemRouter = router({
  /**
   * Read-only discovery: the master flag + registered connectivity keys.
   * Always available (no I/O).
   */
  listConfigured: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .query(() => {
      return {
        enabled: isSecsGemEnabled(),
        connectors: listSecsGemKeys(),
        caveat: HONESTY_CAVEAT,
      };
    }),

  /** Framework status — the flag state + an honest description of what is real. */
  status: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .query(() => {
      return {
        enabled: isSecsGemEnabled(),
        framework: "SECS/GEM (SEMI E5 SECS-II, E37 HSMS, E30 GEM) — skeleton",
        real: [
          "HSMS connection state machine (NOT_CONNECTED → CONNECTED → SELECTED)",
          "HSMS Select / Linktest / Separate control exchange over node:net",
          "Minimal SECS-II item codec (L, A, BOOLEAN, BINARY, U1, U2, U4) round-trip",
          "GEM event/alarm/SV → platform-row mappers (pure)",
        ],
        skeletonOnly: [
          "Full SECS-II binary codec (I*/U8/F*, JIS, all length widths)",
          "Complete GEM state machine (control state, S2F33/F35/F37 report linking, spooling, timers T3–T8)",
          "Data-message correlation by System Bytes / retries / multi-block",
        ],
        health: getSecsGemHealth(), // doc 35 W2-C — { mode: "framework-only", liveIngest: false, note }
        caveat: HONESTY_CAVEAT,
      };
    }),

  /**
   * HSMS connect + Select + Linktest against {host,port}. FAIL-SAFE: never throws.
   * Honest about codec limits: a successful result means the peer spoke HSMS, NOT
   * that it is a GEM-compliant tool.
   */
  testConnection: protectedProcedure
    .use(requirePermission("machine_monitoring", "canView"))
    .input(
      z.object({
        host: z.string().min(1).max(255),
        port: z.number().int().min(1).max(65535),
        connectTimeoutMs: z.number().int().min(100).max(30000).optional(),
        deviceId: z.number().int().min(0).max(0x7fff).optional(),
      }),
    )
    .mutation(async ({ input }) => {
      // Flag gate: no socket opened when disabled.
      if (!isSecsGemEnabled()) {
        return {
          enabled: false,
          ok: false,
          message: "SECS/GEM framework is disabled (set SECS_GEM_ENABLED=true to enable).",
          caveat: HONESTY_CAVEAT,
        };
      }

      const client = new HsmsClient({
        host: input.host,
        port: input.port,
        connectTimeoutMs: input.connectTimeoutMs,
        deviceId: input.deviceId,
      });
      const result = await client.testConnection(); // never throws
      return { enabled: true, ...result };
    }),
});
