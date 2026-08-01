/**
 * doc 44 W2-B1 / G2.16 — GET /v1/events (SYNAPSE Tầng 2 §11.1).
 *
 * ONE unified event feed over the THREE clearest persisted event sources:
 *   • andon_events      — visual alerts (quality/material/maintenance/safety/setup)
 *   • safety_events     — ADVISORY safety observations (estop/intrusion/near-miss)
 *   • interlock_events  — interlock rule firings
 *
 * Union Event shape (spec §10 events): { event_id, source, asset_id?, path?,
 * type, severity, ts, payload }. `type` is source-qualified and self-describing
 * ("andon:{reason}" / "safety:{eventType}" / "interlock:{action}").
 *
 * SEVERITY mapping (documented, derived from real columns — never invented):
 *   andon: state red→critical · yellow/call→warning · green→info
 *   safety: near-miss→warning · everything else→critical
 *   interlock: action stop/block→error · alert/other→warning
 *
 * FILTERS: path (ISA-95 prefix) / type (prefix match, e.g. "andon" or
 * "andon:quality") / severity (MINIMUM) / from / to / limit (default 200, cap
 * 1000, per source before the merge).
 *
 * HONEST LIMITATION: only andon_events carries a machineId, so a `path` filter
 * applies fully to andon rows; safety/interlock rows carry line/station ids
 * only and are EXCLUDED whenever `path` is given (stated in the response's
 * `notes`). asset_id/path are attached to any row whose machineId is known.
 * Scope: data:read. READ-ONLY.
 */
import { type Router, type Request, type Response } from "express";
import { and, desc, gte, lte, inArray, sql } from "drizzle-orm";
import { requireScope } from "./auth";
import { API_SCOPES } from "./scopes";
import { sendOk, wrap, ApiHttpError } from "./envelope";

type Severity = "info" | "warning" | "error" | "critical";
const SEVERITY_RANK: Record<Severity, number> = { info: 0, warning: 1, error: 2, critical: 3 };

export interface UnifiedEvent {
  event_id: string;
  source: "andon_events" | "safety_events" | "interlock_events";
  asset_id: string | null;
  path: string | null;
  type: string;
  severity: Severity;
  ts: string;
  payload: Record<string, unknown>;
}

function severityParam(raw: unknown): Severity | null {
  const s = String(raw ?? "").toLowerCase();
  return s === "info" || s === "warning" || s === "error" || s === "critical" ? (s as Severity) : null;
}

function dateParam(raw: unknown, label: string): Date | undefined {
  if (raw == null || raw === "") return undefined;
  const d = new Date(String(raw));
  if (Number.isNaN(d.getTime())) throw new ApiHttpError(400, "bad_request", `Invalid ${label} — expected an ISO date-time.`);
  return d;
}

function andonSeverity(state: string): Severity {
  if (state === "red") return "critical";
  if (state === "green") return "info";
  return "warning"; // yellow | call
}

function interlockSeverity(action: string | null): Severity {
  return action === "stop" || action === "block" ? "error" : "warning";
}

/** Register GET /events on the /api/v1 router. */
export function registerEventRoutes(r: Router): void {
  r.get(
    "/events",
    requireScope(API_SCOPES.DATA_READ),
    wrap(async (req: Request, res: Response) => {
      const { getDb } = await import("../../db/connection");
      const { andonEvents, safetyEvents, interlockEvents, machines } = await import("../../../drizzle/schema");
      const db = await getDb();
      if (!db) return sendOk(res, { events: [], count: 0, sources: [], notes: ["database unavailable — honest-empty"] });

      const limitRaw = Number(req.query.limit);
      const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(1, Math.trunc(limitRaw)), 1000) : 200;
      const from = dateParam(req.query.from, "from");
      const to = dateParam(req.query.to, "to");
      const minSeverity = req.query.severity != null ? severityParam(req.query.severity) : null;
      if (req.query.severity != null && !minSeverity) {
        throw new ApiHttpError(400, "bad_request", "Invalid severity — expected info|warning|error|critical.");
      }
      const typeFilter = typeof req.query.type === "string" && req.query.type ? req.query.type.toLowerCase() : null;
      const pathPrefix = typeof req.query.path === "string" && req.query.path ? req.query.path.replace(/^\/+|\/+$/g, "") : null;

      const notes: string[] = [];

      // Path prefix → the machine id set + id → identity map (bounded).
      let pathMachineIds: number[] | null = null;
      const identityById = new Map<number, { path: string | null; urn: string | null }>();
      if (pathPrefix) {
        const escaped = pathPrefix.replace(/[\\%_]/g, (ch) => `\\${ch}`);
        const rows = await db
          .select({ id: machines.id, isa95Path: machines.isa95Path, urn: machines.urn })
          .from(machines)
          .where(sql`${machines.isa95Path} LIKE ${`${escaped}%`}`)
          .limit(2000);
        pathMachineIds = rows.map((m) => Number(m.id));
        for (const m of rows) identityById.set(Number(m.id), { path: m.isa95Path ?? null, urn: m.urn ?? null });
        notes.push(
          "path filter applies to machine-addressed events only — safety/interlock rows carry no machineId and are excluded under a path filter (honest).",
        );
        if (pathMachineIds.length === 0) {
          return sendOk(res, { events: [], count: 0, sources: [], notes: [...notes, `no machine under path "${pathPrefix}"`] });
        }
      }

      const wantSource = (source: string): boolean => {
        if (!typeFilter) return true;
        // "andon" / "safety" / "interlock" or a qualified "andon:quality".
        const head = typeFilter.split(":")[0];
        return source.startsWith(head);
      };
      const typeMatches = (type: string): boolean => !typeFilter || type.toLowerCase().startsWith(typeFilter);

      const out: UnifiedEvent[] = [];
      const sources: string[] = [];

      // ── andon_events ─────────────────────────────────────────────────────────
      if (wantSource("andon")) {
        sources.push("andon_events");
        const conds = [];
        if (from) conds.push(gte(andonEvents.raisedAt, from));
        if (to) conds.push(lte(andonEvents.raisedAt, to));
        if (pathMachineIds) conds.push(inArray(andonEvents.machineId, pathMachineIds));
        const rows = await db
          .select()
          .from(andonEvents)
          .where(conds.length ? and(...conds) : undefined)
          .orderBy(desc(andonEvents.raisedAt))
          .limit(limit);
        for (const a of rows) {
          out.push({
            event_id: `andon-${a.id}`,
            source: "andon_events",
            asset_id: a.machineId != null ? identityById.get(a.machineId)?.urn ?? null : null,
            path: a.machineId != null ? identityById.get(a.machineId)?.path ?? null : null,
            type: `andon:${a.reason}`,
            severity: andonSeverity(String(a.state)),
            ts: new Date(a.raisedAt).toISOString(),
            payload: {
              state: a.state,
              status: a.status,
              title: a.title,
              machineId: a.machineId ?? null,
              lineId: a.lineId ?? null,
              stationId: a.stationId ?? null,
              raisedBySystem: a.raisedBySystem,
            },
          });
        }
      }

      // ── safety_events (skipped under a path filter — no machineId) ──────────
      if (wantSource("safety") && !pathMachineIds) {
        sources.push("safety_events");
        const conds = [];
        if (from) conds.push(gte(safetyEvents.createdAt, from));
        if (to) conds.push(lte(safetyEvents.createdAt, to));
        const rows = await db
          .select()
          .from(safetyEvents)
          .where(conds.length ? and(...conds) : undefined)
          .orderBy(desc(safetyEvents.createdAt))
          .limit(limit);
        for (const s of rows) {
          out.push({
            event_id: `safety-${s.id}`,
            source: "safety_events",
            asset_id: null,
            path: null,
            type: `safety:${s.eventType}`,
            severity: s.isNearMiss ? "warning" : "critical",
            ts: new Date(s.createdAt).toISOString(),
            payload: {
              outcome: s.outcome,
              detectedBy: s.detectedBy ?? null,
              robotId: s.robotId ?? null,
              lineId: s.lineId ?? null,
              stationId: s.stationId ?? null,
              isNearMiss: s.isNearMiss,
            },
          });
        }
      }

      // ── interlock_events (skipped under a path filter — no machineId) ───────
      if (wantSource("interlock") && !pathMachineIds) {
        sources.push("interlock_events");
        const conds = [];
        if (from) conds.push(gte(interlockEvents.firedAt, from));
        if (to) conds.push(lte(interlockEvents.firedAt, to));
        const rows = await db
          .select()
          .from(interlockEvents)
          .where(conds.length ? and(...conds) : undefined)
          .orderBy(desc(interlockEvents.firedAt))
          .limit(limit);
        for (const i of rows) {
          out.push({
            event_id: `interlock-${i.id}`,
            source: "interlock_events",
            asset_id: null,
            path: null,
            type: `interlock:${i.action ?? "fired"}`,
            severity: interlockSeverity(i.action == null ? null : String(i.action)),
            ts: new Date(i.firedAt).toISOString(),
            payload: {
              ruleId: i.ruleId,
              status: i.status,
              sourceType: i.sourceType ?? null,
              observedValue: i.observedValue ?? null,
              threshold: i.threshold ?? null,
            },
          });
        }
      }

      // Merge → filter type/severity → newest first → cap.
      const filtered = out
        .filter((e) => typeMatches(e.type))
        .filter((e) => !minSeverity || SEVERITY_RANK[e.severity] >= SEVERITY_RANK[minSeverity])
        .sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0));
      const events = filtered.slice(0, limit);

      sendOk(res, {
        events,
        count: events.length,
        truncated: filtered.length > limit,
        sources,
        ...(notes.length ? { notes } : {}),
      });
    }),
  );
}
