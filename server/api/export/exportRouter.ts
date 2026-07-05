/**
 * W5-D (doc 27 §6 gap A10) — RAW DATA EXPORT: streaming CSV/JSON.
 * ════════════════════════════════════════════════════════════════════════════
 *   GET /api/export/inspections.csv | .json
 *   GET /api/export/measurements.csv | .json   (separate endpoint — volume)
 *
 * Contract (documented in docs/ECOSYSTEM/30_BI_EXPORT_API.md):
 *   • AUTH — either a browser session cookie (any logged-in user; rows are
 *     tenant-scoped through the same access filter the History list uses) or
 *     an API key with the `export:read` scope (Authorization: Bearer <key> or
 *     X-API-Key). No credential → 401; key without scope → 403.
 *   • WINDOW — `from` and `to` are REQUIRED (ISO date/datetime) and the span
 *     is capped at EXPORT_MAX_WINDOW_DAYS (default 92) → 400 otherwise.
 *   • FILTERS — optional machineId, result (OK|NG|NTF), product (substring of
 *     productModel), factoryCode, corporateCode.
 *   • STREAMING — cursor/keyset-paged DB reads (page ≤ 500/1000 rows) written
 *     to the response per page; the full result set is NEVER buffered. Client
 *     disconnect stops the DB loop.
 *   • RATE LIMIT — a dedicated stricter limiter (EXPORT_RATE_LIMIT_PER_5MIN,
 *     default 10 per principal per 5 min) on top of the global /api limiter.
 *   • AUDIT — every export writes an audit_logs row (who, window, filters,
 *     row count, completion status).
 *
 * Column set = the audited list projection (server/db/inspection.ts,
 * inspectionListProjection — doc 27 gap B9); measurement rollups are the
 * separate /measurements endpoint rather than an ?include= explosion.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { Router, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import { and, asc, eq, gt, gte, like, lte } from "drizzle-orm";
import { apiKeyGenerator } from "../../_core/rateLimitConfig";
import { resolvePrincipal, type ApiPrincipal } from "../v1/auth";
import { API_SCOPES } from "../v1/scopes";
import { scopeSatisfied } from "../v1/scopes";
import { toCsvLine, rowToCsvLine, jsonStreamChunk } from "../../services/universalExportService";

// ── Tunables ──────────────────────────────────────────────────────────────────

function intEnv(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

/** Maximum allowed [from, to] span in days (window guard). */
export const EXPORT_MAX_WINDOW_DAYS = intEnv("EXPORT_MAX_WINDOW_DAYS", 92);
/** Rows per DB page for the inspections stream. */
const INSPECTION_PAGE_SIZE = intEnv("EXPORT_INSPECTION_PAGE_SIZE", 500);
/** Rows per DB page for the measurements stream. */
const MEASUREMENT_PAGE_SIZE = intEnv("EXPORT_MEASUREMENT_PAGE_SIZE", 1000);

// ── Authentication (session OR scoped API key) ───────────────────────────────

export interface ExportPrincipal {
  kind: "session" | "api-key";
  name: string;
  /** Session principals carry the user for tenant-scoped row access. */
  userId?: number;
  userRole?: string;
}

function extractApiKey(req: Request): string | null {
  const auth = req.header("authorization");
  if (auth && /^bearer\s+/i.test(auth)) {
    const tok = auth.replace(/^bearer\s+/i, "").trim();
    if (tok) return tok;
  }
  const xkey = req.header("x-api-key");
  if (xkey && xkey.trim()) return xkey.trim();
  return null;
}

/**
 * Resolve the caller: an API key (must satisfy the required scope) wins when
 * present; otherwise a signed-in browser session. Fail-safe: any resolution
 * error denies.
 */
export async function authenticateExportRequest(
  req: Request,
  requiredScope: string,
): Promise<{ principal: ExportPrincipal | null; status: 401 | 403 | 200; message?: string }> {
  const key = extractApiKey(req);
  if (key) {
    let apiPrincipal: ApiPrincipal | null = null;
    try {
      apiPrincipal = await resolvePrincipal(key);
    } catch {
      apiPrincipal = null;
    }
    if (!apiPrincipal) return { principal: null, status: 401, message: "Invalid or expired API key." };
    if (!scopeSatisfied(apiPrincipal.scopes, requiredScope as never)) {
      return {
        principal: null,
        status: 403,
        message: `This API key lacks the required scope "${requiredScope}".`,
      };
    }
    return { principal: { kind: "api-key", name: apiPrincipal.name }, status: 200 };
  }

  // Browser session (cookie) — same authenticator tRPC context uses.
  try {
    const { sdk } = await import("../../_core/sdk");
    const user = await sdk.authenticateRequest(req as never);
    if (user) {
      return {
        principal: { kind: "session", name: user.name ?? user.email ?? `user:${user.id}`, userId: user.id, userRole: (user as { role?: string }).role },
        status: 200,
      };
    }
  } catch {
    /* fall through → 401 */
  }
  return {
    principal: null,
    status: 401,
    message: "Authentication required: session cookie or API key (Bearer / X-API-Key) with export scope.",
  };
}

// ── Window guard ──────────────────────────────────────────────────────────────

export interface ParsedWindow {
  from: Date;
  to: Date;
}

/** Parse+validate the required from/to window. Returns an error string or the window. */
export function parseExportWindow(
  fromRaw: unknown,
  toRaw: unknown,
  maxDays = EXPORT_MAX_WINDOW_DAYS,
): { window?: ParsedWindow; error?: string } {
  if (typeof fromRaw !== "string" || !fromRaw || typeof toRaw !== "string" || !toRaw) {
    return { error: "Query params `from` and `to` (ISO date/datetime) are REQUIRED." };
  }
  const from = new Date(fromRaw);
  const to = new Date(toRaw);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return { error: "Invalid `from`/`to` — use ISO-8601 (e.g. 2026-06-01 or 2026-06-01T00:00:00Z)." };
  }
  if (from.getTime() >= to.getTime()) {
    return { error: "`from` must be before `to`." };
  }
  const spanDays = (to.getTime() - from.getTime()) / 86_400_000;
  if (spanDays > maxDays) {
    return { error: `Window too large: ${Math.ceil(spanDays)}d requested, max ${maxDays}d. Export in slices.` };
  }
  return { window: { from, to } };
}

// ── Shared helpers ────────────────────────────────────────────────────────────

/** The audited list projection column order (doc 27 gap B9). */
export const INSPECTION_EXPORT_COLUMNS = [
  "id",
  "serialNumber",
  "overallResult",
  "originalResult",
  "aiDecision",
  "inspectionTime",
  "cycleTime",
  "machineId",
  "productModelId",
  "productModel",
  "batchNumber",
  "corporateCode",
  "factoryCode",
  "workshopCode",
  "lineCode",
  "stageCode",
  "acknowledgedBy",
  "acknowledgedAt",
  "createdAt",
] as const;

export const MEASUREMENT_EXPORT_COLUMNS = [
  "id",
  "inspectionId",
  "serialNumber",
  "inspectionTime",
  "machineId",
  "pointDefId",
  "pointCode",
  "pointName",
  "measuredValue",
  "measuredValueText",
  "result",
  "defectCatalogId",
  "defectCode",
  "defectName",
  "defectSeverity",
  "aiConfidence",
] as const;

interface CommonFilters {
  machineId?: number;
  result?: "OK" | "NG" | "NTF";
  product?: string;
  factoryCode?: string;
  corporateCode?: string;
}

function parseCommonFilters(req: Request): CommonFilters {
  const q = req.query;
  const filters: CommonFilters = {};
  const machineId = Number(q.machineId);
  if (Number.isInteger(machineId) && machineId > 0) filters.machineId = machineId;
  if (q.result === "OK" || q.result === "NG" || q.result === "NTF") filters.result = q.result;
  if (typeof q.product === "string" && q.product) filters.product = q.product;
  if (typeof q.factoryCode === "string" && q.factoryCode) filters.factoryCode = q.factoryCode;
  if (typeof q.corporateCode === "string" && q.corporateCode) filters.corporateCode = q.corporateCode;
  return filters;
}

function contentHeaders(res: Response, format: "csv" | "json", basename: string): void {
  if (format === "csv") {
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
  } else {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
  }
  res.setHeader("Content-Disposition", `attachment; filename="${basename}.${format}"`);
  res.setHeader("Cache-Control", "no-store");
}

/** Fire-and-forget audit row — never blocks/breaks the export. */
function auditExport(
  req: Request,
  principal: ExportPrincipal,
  detail: { endpoint: string; from: string; to: string; filters: CommonFilters; rows: number; completed: boolean },
): void {
  void import("../../db")
    .then((db) =>
      db.createAuditLog({
        userId: principal.userId ?? null,
        userName: principal.name,
        action: "export",
        entityType: "inspection",
        entityName: detail.endpoint,
        details: detail as never,
        ipAddress: req.ip ?? null,
        userAgent: req.header("user-agent") ?? null,
        status: detail.completed ? "success" : "failure",
      }),
    )
    .catch((err) => console.error("[Export] audit log failed:", (err as Error)?.message ?? err));
}

// ── Router ────────────────────────────────────────────────────────────────────

export function createExportRouter(): Router {
  const r = Router();

  // Dedicated stricter limiter (per API-key/session/IP — B6 key strategy),
  // stacked on top of the global /api limiter.
  r.use(
    rateLimit({
      windowMs: 5 * 60 * 1000,
      max: intEnv("EXPORT_RATE_LIMIT_PER_5MIN", 10),
      standardHeaders: true,
      legacyHeaders: false,
      keyGenerator: apiKeyGenerator,
      passOnStoreError: true,
      message: { error: "Export rate limit exceeded — try again in a few minutes." },
    }),
  );

  // GET /inspections.csv | /inspections.json — streamed list projection.
  r.get(/^\/inspections\.(csv|json)$/, async (req: Request, res: Response) => {
    const format = req.path.endsWith(".json") ? "json" : "csv";
    const auth = await authenticateExportRequest(req, API_SCOPES.EXPORT_READ);
    if (!auth.principal) return res.status(auth.status).json({ error: auth.message });

    const parsed = parseExportWindow(req.query.from, req.query.to);
    if (!parsed.window) return res.status(400).json({ error: parsed.error });
    const { from, to } = parsed.window;
    const filters = parseCommonFilters(req);

    let aborted = false;
    res.on("close", () => {
      if (!res.writableEnded) aborted = true;
    });

    let rows = 0;
    let completed = false;
    try {
      const { getProductInspectionsCursor } = await import("../../db/inspection");
      contentHeaders(res, format, `inspections_${from.toISOString().slice(0, 10)}_${to.toISOString().slice(0, 10)}`);

      if (format === "csv") res.write(toCsvLine([...INSPECTION_EXPORT_COLUMNS]));
      else res.write(`{"dataset":"inspections","from":${JSON.stringify(from.toISOString())},"to":${JSON.stringify(to.toISOString())},"rows":[`);

      let cursor: string | undefined;
      do {
        const page = await getProductInspectionsCursor({
          startDate: from,
          endDate: to,
          machineId: filters.machineId,
          result: filters.result,
          productModel: filters.product,
          factoryCode: filters.factoryCode,
          corporateCode: filters.corporateCode,
          limit: INSPECTION_PAGE_SIZE,
          cursor,
          // Session principals stay tenant-scoped exactly like the History list.
          userId: auth.principal.userId,
          userRole: auth.principal.userRole,
        });
        for (const row of page.data) {
          if (aborted) break;
          if (format === "csv") res.write(rowToCsvLine(row as never, INSPECTION_EXPORT_COLUMNS));
          else res.write(jsonStreamChunk(row, rows === 0));
          rows += 1;
        }
        cursor = page.hasMore && page.nextCursor ? page.nextCursor : undefined;
      } while (cursor && !aborted);

      if (!aborted) {
        if (format === "json") res.write(`],"count":${rows}}`);
        res.end();
        completed = true;
      }
    } catch (err) {
      console.error("[Export] inspections stream failed:", (err as Error)?.message ?? err);
      if (!res.headersSent) {
        res.status(500).json({ error: "Export failed." });
      } else {
        res.destroy(); // mid-stream failure: truncate visibly rather than fake-complete
      }
    } finally {
      auditExport(req, auth.principal, {
        endpoint: `/api/export/inspections.${format}`,
        from: from.toISOString(),
        to: to.toISOString(),
        filters,
        rows,
        completed,
      });
    }
  });

  // GET /measurements.csv | /measurements.json — raw measurement rows in the
  // window (keyset on measurement id ASC; window applied via the inspection join).
  r.get(/^\/measurements\.(csv|json)$/, async (req: Request, res: Response) => {
    const format = req.path.endsWith(".json") ? "json" : "csv";
    const auth = await authenticateExportRequest(req, API_SCOPES.EXPORT_READ);
    if (!auth.principal) return res.status(auth.status).json({ error: auth.message });

    const parsed = parseExportWindow(req.query.from, req.query.to);
    if (!parsed.window) return res.status(400).json({ error: parsed.error });
    const { from, to } = parsed.window;
    const filters = parseCommonFilters(req);

    let aborted = false;
    res.on("close", () => {
      if (!res.writableEnded) aborted = true;
    });

    let rows = 0;
    let completed = false;
    try {
      const { getDb } = await import("../../db/connection");
      const schema = await import("../../../drizzle/schema");
      const db = await getDb();
      if (!db) return res.status(503).json({ error: "Database unavailable." });

      contentHeaders(res, format, `measurements_${from.toISOString().slice(0, 10)}_${to.toISOString().slice(0, 10)}`);
      if (format === "csv") res.write(toCsvLine([...MEASUREMENT_EXPORT_COLUMNS]));
      else res.write(`{"dataset":"measurements","from":${JSON.stringify(from.toISOString())},"to":${JSON.stringify(to.toISOString())},"rows":[`);

      const mr = schema.measurementResults;
      const pi = schema.productInspections;
      const mp = schema.measurementPointDefs;
      const dc = schema.defectCatalog;

      let lastId = 0;
      // Keyset pagination on mr.id — no OFFSET, no full-set buffering.
      for (;;) {
        if (aborted) break;
        const conditions = [
          gt(mr.id, lastId),
          gte(pi.inspectionTime, from),
          lte(pi.inspectionTime, to),
        ];
        if (filters.machineId) conditions.push(eq(pi.machineId, filters.machineId));
        if (filters.result) conditions.push(eq(mr.result, filters.result));
        if (filters.product) conditions.push(like(pi.productModel, `%${filters.product}%`));
        if (filters.factoryCode) conditions.push(eq(pi.factoryCode, filters.factoryCode));
        if (filters.corporateCode) conditions.push(eq(pi.corporateCode, filters.corporateCode));

        const page = await db
          .select({
            id: mr.id,
            inspectionId: mr.inspectionId,
            serialNumber: pi.serialNumber,
            inspectionTime: pi.inspectionTime,
            machineId: pi.machineId,
            pointDefId: mr.pointDefId,
            pointCode: mp.code,
            pointName: mp.name,
            measuredValue: mr.measuredValue,
            measuredValueText: mr.measuredValueText,
            result: mr.result,
            defectCatalogId: mr.defectCatalogId,
            defectCode: dc.code,
            defectName: dc.name,
            defectSeverity: mr.defectSeverity,
            aiConfidence: mr.aiConfidence,
          })
          .from(mr)
          .innerJoin(pi, eq(mr.inspectionId, pi.id))
          .leftJoin(mp, eq(mr.pointDefId, mp.id))
          .leftJoin(dc, eq(mr.defectCatalogId, dc.id))
          .where(and(...conditions))
          .orderBy(asc(mr.id))
          .limit(MEASUREMENT_PAGE_SIZE);

        for (const row of page) {
          if (aborted) break;
          if (format === "csv") res.write(rowToCsvLine(row as never, MEASUREMENT_EXPORT_COLUMNS));
          else res.write(jsonStreamChunk(row, rows === 0));
          rows += 1;
          lastId = row.id;
        }
        if (page.length < MEASUREMENT_PAGE_SIZE) break;
      }

      if (!aborted) {
        if (format === "json") res.write(`],"count":${rows}}`);
        res.end();
        completed = true;
      }
    } catch (err) {
      console.error("[Export] measurements stream failed:", (err as Error)?.message ?? err);
      if (!res.headersSent) {
        res.status(500).json({ error: "Export failed." });
      } else {
        res.destroy();
      }
    } finally {
      auditExport(req, auth.principal, {
        endpoint: `/api/export/measurements.${format}`,
        from: from.toISOString(),
        to: to.toISOString(),
        filters,
        rows,
        completed,
      });
    }
  });

  // Unknown /api/export path → structured 404.
  r.use((_req, res) =>
    res.status(404).json({
      error: "Unknown /api/export endpoint.",
      available: ["/api/export/inspections.csv", "/api/export/inspections.json", "/api/export/measurements.csv", "/api/export/measurements.json"],
    }),
  );

  return r;
}
