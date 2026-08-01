/**
 * Wave W2-D (doc 35 W0.3a → W2) — /api/v1 LICENSE + AUDIT guard.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * The versioned REST surface (server/api/v1/router.ts) already does per-route
 * scoped API-key auth (requireScope). Unlike the tRPC surface it had NO license
 * enforcement and NO audit trail. This middleware adds BOTH — mounted on /api/v1
 * BEFORE createV1Router() in server/_core/index.ts.
 *
 * (a) LICENSE — mirrors the F4 "never-stop-production" principle for REST. The
 *     tRPC licenseEnforcementMiddleware keys on tRPC PROCEDURE NAMES, so it must
 *     NOT be reused here (it would wrongly block production-critical ingest). This
 *     guard instead:
 *       • normal/warning or LICENSE_BYPASS → pass through;
 *       • GET/read → always pass;
 *       • locked/readonly/no-license + a production-critical path (see
 *         CRITICAL_V1_PATHS) → pass (production never stops);
 *       • locked/readonly/no-license + any other mutating request → 403 with the
 *         same message shape as server/license/license-middleware.ts.
 *
 * (b) AUDIT — every mutating request that runs is recorded (best-effort, on the
 *     response `finish` event so the requireScope-set principal + final status are
 *     available). An audit failure NEVER affects the request.
 *
 * Defensive: this middleware never throws synchronously into the request path. If
 * the license check itself faults it fails OPEN (the per-route scoped API-key auth
 * remains the hard gate) so a guard bug can never halt production traffic.
 * ════════════════════════════════════════════════════════════════════════════
 */
import type { Request, Response, NextFunction } from "express";
import { ENV } from "../../_core/env";
import { licenseGuard } from "../../license/license-guard";

/** Mutating HTTP verbs — reads always pass the license gate. */
const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Production-critical /api/v1 paths that MUST keep working even when the license
 * is locked/readonly/no-license. Matched against the router-relative path (the
 * /api/v1 mount strips the prefix; we also tolerate a full path defensively).
 * Evidence (server/api/v1/router.ts + erpIntake.ts + erpOauth.ts):
 *   • POST /ingest/inspection        (INGEST_WRITE)      — inspection data ingest
 *   • POST /orders, POST /bom        (ERP_WRITE)         — inbound ERP master/tx data
 *   • POST /equipment/:id/commands   (EQUIPMENT_COMMAND) — HITL/dry-run-gated control
 *   • POST /orchestration/runs       (ORCHESTRATION_WRITE) — start a production run
 *   • POST /edge/sync                (EDGE_SYNC)         — edge runtime result sync-back
 *   • POST /oauth/token              (public, ERP_OAUTH) — M2M auth token issuance
 *                                     (analogous to the tRPC auth.* always-allowed set)
 * Deliberately NOT critical (config authoring — locked under license lockdown):
 *   POST /orchestration/workflows (deploy).
 */
const CRITICAL_V1_PATHS: RegExp[] = [
  /^\/ingest\//,
  /^\/orders$/,
  /^\/bom$/,
  /^\/equipment\/[^/]+\/commands$/,
  /^\/orchestration\/runs$/,
  /^\/edge\/sync$/,
  /^\/oauth\/token$/,
];

/** Is `path` (router-relative or full) a production-critical v1 path? */
function isCriticalV1Path(path: string): boolean {
  const p = path.replace(/^\/api\/v1/, "").replace(/\/+$/, "") || "/";
  return CRITICAL_V1_PATHS.some((re) => re.test(p));
}

/** never-stop-production 403 body — mirrors server/license/license-middleware.ts. */
function sendLicenseBlocked(res: Response, state: string): void {
  const status = licenseGuard.getStatus();
  const messages: Record<string, string> = {
    LICENSE_READONLY:
      "License hết hạn: thao tác sản xuất/kiểm tra/an toàn vẫn chạy — chỉ khoá cấu hình & tính năng cao cấp. Vui lòng gia hạn.",
    LICENSE_LOCKED: `Cấu hình bị khoá do license hết hạn quá ${status.daysPastExpiry ?? "?"} ngày (sản xuất-cốt-lõi vẫn hoạt động). Vui lòng gia hạn.`,
    NO_LICENSE:
      "Hệ thống chưa có license — vui lòng kích hoạt để dùng đầy đủ (thao tác sản xuất-cốt-lõi vẫn hoạt động).",
  };
  const code =
    state === "readonly" ? "LICENSE_READONLY" : state === "no_license" ? "NO_LICENSE" : "LICENSE_LOCKED";
  res.status(403).json({
    error: {
      message: messages[code],
      code,
      data: {
        state: status.state,
        message: status.message,
        daysUntilExpiry: status.daysUntilExpiry,
        daysPastExpiry: status.daysPastExpiry,
      },
    },
  });
}

/**
 * Best-effort audit of a mutating /api/v1 request. Runs on response `finish`, so
 * `req.apiPrincipal` (set by requireScope inside the router) and the final status
 * are available. Never throws.
 *
 * LIMITATION: for requests the guard itself 403s (license lockdown) the router
 * never ran, so `req.apiPrincipal` is undefined — we then audit method/path/ip/
 * status only.
 */
async function recordV1Audit(req: Request, res: Response): Promise<void> {
  try {
    const principal = req.apiPrincipal;
    const fwd = req.headers["x-forwarded-for"];
    const ipRaw =
      (Array.isArray(fwd) ? fwd[0] : fwd) ||
      req.headers["x-real-ip"] ||
      req.socket?.remoteAddress ||
      req.ip ||
      null;
    const fullPath = (req.baseUrl || "") + req.path;
    const ok = res.statusCode < 400;
    const { createAuditLog } = await import("../../db");
    await createAuditLog({
      userId: null,
      userName: principal?.name ?? "api-key",
      action: `apiv1.${req.method.toLowerCase()}`,
      entityType: "api_v1",
      entityId: null,
      entityName: fullPath,
      details: {
        method: req.method,
        path: fullPath,
        principalKind: principal?.kind ?? null,
        scopes: principal?.scopes ?? null,
        machineId: principal?.machineId ?? null,
        apiKeyId: principal?.apiKeyId ?? null,
        statusCode: res.statusCode,
        outcome: ok ? "success" : "error",
      },
      ipAddress: typeof ipRaw === "string" ? ipRaw : null,
      userAgent: (req.headers["user-agent"] as string) ?? null,
      status: ok ? "success" : "failure",
    });
  } catch (err) {
    // best-effort — an audit failure must NEVER affect the request outcome.
    console.error("[api/v1 guard] audit failed:", (err as Error)?.message ?? err);
  }
}

/**
 * Build the /api/v1 license + audit guard. Mount BEFORE createV1Router():
 *   app.use("/api/v1", v1Guard());
 *   app.use("/api/v1", createV1Router());
 */
export function v1Guard() {
  return (req: Request, res: Response, next: NextFunction): void => {
    const method = req.method.toUpperCase();
    const isMutating = MUTATING.has(method);

    // (b) AUDIT — hook the response so the principal (set by requireScope inside
    // the router) and the final status are captured. Mutating requests only.
    if (isMutating) {
      res.on("finish", () => {
        void recordV1Audit(req, res);
      });
    }

    // (a) LICENSE — never-stop-production enforcement.
    try {
      if (ENV.licenseBypass) return next();
      const state = licenseGuard.getState();
      // normal / warning → full pass.
      if (state === "normal" || state === "warning") return next();
      // GET/read → always pass, even under lockdown.
      if (!isMutating) return next();
      // Production-critical mutations → always pass (production never stops).
      if (isCriticalV1Path(req.path)) return next();
      // Non-critical mutation under locked/readonly/no_license → 403.
      sendLicenseBlocked(res, state);
      return;
    } catch (err) {
      // Defensive: a license-check fault must not stop production traffic — fail
      // OPEN (scoped API-key auth in the router remains the hard gate).
      console.error("[api/v1 guard] license check error (failing open):", (err as Error)?.message ?? err);
      return next();
    }
  };
}
