/**
 * doc 81 Đợt 10 task B (design §2.7, D6, D7, D12) — central INGEST of what an edge node observes on the devices it OWNS:
 *   • POST telemetry       — OT samples ⇒ telemetryBus.ingestTelemetryDetailed, ONLY for adapters the node owns; machine /
 *                            device / protocol come from central's adapter row (never from the edge). Others refused (0 rows).
 *   • POST robots/state    — the `robot_state` stream (cursor, edgeReportsCentral.applyStream): robot_telemetry rows +
 *                            registry status for OWNED robots only; the e-stop TRANSITION is derived CENTRALLY from
 *                            consecutive accepted states (the last stored row, then the batch). TRUST (D6): plain by default;
 *                            `recordFromDeviceIngest("edge_robot_telemetry")` only while edge_robot_trust_is_approved(node,
 *                            robot, edgeRobotTrustDigest(robot)) — the 0375 maker-checker — AND the vendor is in
 *                            TRUSTED_ROBOT_TELEMETRY_VENDORS. No edge field can make an event trusted (strict schema: a
 *                            `trusted` / `origin` / `safetyCritical` key is a 400).
 *   • POST program-checks  — the node's program-checksum readings of ITS adapters (D7), upserted per (node, adapter); the DB
 *                            stamps the adapter's owner epoch and refuses a foreign adapter.
 */
import { createHash } from "node:crypto";
import { desc, eq, inArray } from "drizzle-orm";
import { deviceAdapters, robotTelemetry, robots } from "../../../drizzle/schema";
import {
  EDGE_PROTOCOL_VERSION,
  edgeProgramChecksRequestSchema,
  edgeRobotStateRequestSchema,
  edgeTelemetryRequestSchema,
  parseEdgeBody,
  type EdgeAnswer,
  type EdgeProgramCheck,
  type EdgeProgramChecksAnswer,
  type EdgeRobotStateRecord,
  type EdgeStreamAnswer,
  type EdgeTelemetryAnswer,
} from "./edgeProtocol";
import { edgeNodeProgramReports, isEdgeControlRefusal, isEdgeRobotTrustApproved } from "./edgeControlSchema";
import { auditNode, centralDb, edgeUnavailable, isEdgeUnavailableError, nodeProtocolVersion, ownedAdapterIds, ownedRobotIds, protocolVersionAnswer, type Db } from "./edgeCentralCommon";
import { applyStream, StreamAnswer } from "./edgeReportsCentral";
import type { EdgeNodePrincipal } from "./edgeNodeCredentials";

async function v2(d: Db, node: EdgeNodePrincipal): Promise<EdgeAnswer<never> | null> {
  const v = await nodeProtocolVersion(d, node.nodeId);
  return v === EDGE_PROTOCOL_VERSION ? null : protocolVersionAnswer(v);
}

// ── telemetry ───────────────────────────────────────────────────────────────────────────────────────────────────────

export async function telemetryForNode(node: EdgeNodePrincipal, body: unknown): Promise<EdgeAnswer<EdgeTelemetryAnswer>> {
  const parsed = parseEdgeBody(edgeTelemetryRequestSchema, body);
  if (!parsed.ok) return parsed.answer;
  try {
    const d = await centralDb();
    const refused = await v2(d, node);
    if (refused) return refused;
    const samples = parsed.data.samples;
    const owned = await ownedAdapterIds(d, node.nodeId, samples.map((s) => s.adapterId));
    const rows = owned.size ? await d.select({ id: deviceAdapters.id, code: deviceAdapters.code, machineId: deviceAdapters.machineId, protocol: deviceAdapters.protocol }).from(deviceAdapters).where(inArray(deviceAdapters.id, [...owned])) : [];
    const byId = new Map(rows.map((r) => [r.id, r] as const));
    const { otProtocolToCanonical } = await import("../ot/ingest");
    const canonical = [];
    let notOwned = 0;
    for (const s of samples) {
      const a = byId.get(s.adapterId);
      if (!a) {
        notOwned++;
        continue;
      }
      canonical.push({
        ts: s.ts == null || s.tsReject ? undefined : new Date(s.ts),
        ...(s.tsReject ? { tsReject: s.tsReject } : {}),
        tsSource: s.ts == null ? ("server" as const) : (s.tsSource ?? "device"),
        machineId: a.machineId ?? null,
        deviceId: a.code,
        protocol: otProtocolToCanonical(a.protocol as never),
        metric: s.tagKey,
        value: s.value,
        unit: s.unit ?? null,
        quality: s.quality,
        meta: { adapterId: a.id, tagKey: s.tagKey, edgeNodeId: node.nodeId },
      });
    }
    if (notOwned > 0) await auditNode(node, "EDGE_ANOMALY", { type: "edge_node", id: node.nodeId }, { anomaly: "telemetry_not_owned", samples: notOwned }, "failure");
    if (canonical.length === 0) return { http: 200, data: { accepted: 0, refused: samples.length } };
    const { ingestTelemetryDetailed } = await import("../telemetryBus");
    const r = await ingestTelemetryDetailed(canonical as never);
    return { http: 200, data: { accepted: r.accepted, refused: notOwned + r.rejected.length } };
  } catch (err) {
    if (!isEdgeUnavailableError(err)) console.error(`[EdgeIngest] telemetry of node ${node.nodeCode} failed: ${(err as Error)?.message ?? err}`);
    return edgeUnavailable;
  }
}

// ── program checks (D7) ─────────────────────────────────────────────────────────────────────────────────────────────

/** Upsert readings for adapters the caller already filtered to the node's own (the DB refuses any other: 23514). */
export async function upsertProgramReports(d: Db, node: EdgeNodePrincipal, readings: readonly EdgeProgramCheck[]): Promise<number> {
  let n = 0;
  for (const r of readings) {
    const values = { status: r.status, checksum: r.status === "verified" ? (r.checksum as string) : null, reason: r.status === "unreadable" ? (r.reason ?? "error") : null, readAt: new Date(r.readAt), receivedAt: new Date() };
    try {
      await d
        .insert(edgeNodeProgramReports)
        .values({ edgeNodeId: node.nodeId, adapterId: r.adapterId, ...values })
        .onConflictDoUpdate({ target: [edgeNodeProgramReports.edgeNodeId, edgeNodeProgramReports.adapterId], set: values });
      n++;
    } catch (err) {
      if (!isEdgeControlRefusal(err)) throw err;
    }
  }
  return n;
}

export async function programChecksForNode(node: EdgeNodePrincipal, body: unknown): Promise<EdgeAnswer<EdgeProgramChecksAnswer>> {
  const parsed = parseEdgeBody(edgeProgramChecksRequestSchema, body);
  if (!parsed.ok) return parsed.answer;
  try {
    const d = await centralDb();
    const refused = await v2(d, node);
    if (refused) return refused;
    const readings = parsed.data.readings;
    const owned = await ownedAdapterIds(d, node.nodeId, readings.map((r) => r.adapterId));
    const mine = readings.filter((r) => owned.has(r.adapterId));
    const accepted = await upsertProgramReports(d, node, mine);
    const refusedIds = [...new Set(readings.filter((r) => !owned.has(r.adapterId)).map((r) => r.adapterId))];
    if (refusedIds.length) await auditNode(node, "EDGE_ANOMALY", { type: "edge_node", id: node.nodeId }, { anomaly: "program_check_not_owned", adapterIds: refusedIds.slice(0, 50) }, "failure");
    return { http: 200, data: { accepted, refused: refusedIds } };
  } catch (err) {
    if (!isEdgeUnavailableError(err)) console.error(`[EdgeIngest] program checks of node ${node.nodeCode} failed: ${(err as Error)?.message ?? err}`);
    return edgeUnavailable;
  }
}

// ── robot state + derived e-stop + trust (D6) ───────────────────────────────────────────────────────────────────────

/**
 * THE digest a (node, robot) trust approval is bound to (0375 `digest`): what makes the robot's telemetry trustworthy as a
 * safety origin — the node, the robot's identity, vendor / model / kind, its endpoint and connection options (hashed), and
 * its placement. Any change ⇒ a new digest ⇒ the approval no longer counts (re-approve). Admin UI / CLI request and approve
 * THIS value (computed here, one place).
 */
export function edgeRobotTrustDigest(nodeId: number, r: { id: number; code: string; vendor: string; model: string | null; kind: string; endpoint: string; connectionOptions: unknown; stationId: number | null; lineId: number | null }): string {
  const conn = createHash("sha256").update(JSON.stringify(r.connectionOptions ?? null)).digest("hex");
  const material = ["edge-robot-trust-v1", nodeId, r.id, r.code, r.vendor, r.model ?? null, r.kind, r.endpoint, conn, r.stationId ?? null, r.lineId ?? null];
  return createHash("sha256").update(JSON.stringify(material)).digest("hex");
}

export async function robotStateForNode(node: EdgeNodePrincipal, body: unknown): Promise<EdgeAnswer<EdgeStreamAnswer>> {
  const parsed = parseEdgeBody(edgeRobotStateRequestSchema, body);
  if (!parsed.ok) return parsed.answer;
  const req = parsed.data;
  try {
    const d = await centralDb();
    const refused = await v2(d, node);
    if (refused) return refused;
    const owned = await ownedRobotIds(d, node.nodeId, req.records.map((r) => r.robotId));
    const rRows = owned.size ? await d.select().from(robots).where(inArray(robots.id, [...owned])) : [];
    const robotById = new Map(rRows.map((r) => [r.id, r] as const));
    // the last stored e-stop flag of each owned robot (the transition is derived from consecutive ACCEPTED states)
    const lastEstop = new Map<number, boolean>();
    for (const id of owned) {
      const [t] = await d.select({ estop: robotTelemetry.estop }).from(robotTelemetry).where(eq(robotTelemetry.robotId, id)).orderBy(desc(robotTelemetry.timestamp), desc(robotTelemetry.id)).limit(1);
      lastEstop.set(id, t?.estop === true);
    }
    const transitions: Array<{ robotId: number; rec: EdgeRobotStateRecord }> = [];
    const emits: Array<{ robotId: number; rec: EdgeRobotStateRecord; status: string }> = [];
    let notOwned = 0;
    const out = await applyStream<EdgeRobotStateRecord>(d, node, req.stream, req.epoch, req.records, async (tx, rec) => {
      const robot = robotById.get(rec.robotId);
      if (!robot) {
        notOwned++;
        return; // never written: not this node's robot (A3 / A5c)
      }
      const at = new Date(rec.ts);
      const status = rec.estop ? "estop" : rec.busy ? "busy" : "idle";
      await tx.insert(robotTelemetry).values({
        robotId: robot.id,
        mode: rec.mode ?? null,
        busy: rec.busy ?? null,
        estop: rec.estop ?? null,
        poseJson: (rec.pose ?? null) as Record<string, unknown> | null,
        payloadKg: rec.payloadKg != null ? String(rec.payloadKg) : null,
        speedPct: rec.speedPct != null ? Math.round(rec.speedPct) : null,
        errorText: rec.error ?? null,
        batteryLevel: rec.batteryPct != null ? String(rec.batteryPct) : null,
        jointStates: rec.jointStates ?? null,
        safetyZoneId: rec.safetyZoneId ?? null,
        firmwareVersion: rec.firmwareVersion ?? null,
        lastHeartbeat: at,
        timestamp: at,
      });
      await tx.update(robots).set({ status, lastSeenAt: at }).where(eq(robots.id, robot.id));
      const was = lastEstop.get(robot.id) ?? false;
      if (rec.estop === true && !was) transitions.push({ robotId: robot.id, rec });
      if (rec.estop !== undefined) lastEstop.set(robot.id, rec.estop === true);
      emits.push({ robotId: robot.id, rec, status });
    });
    if (notOwned > 0) await auditNode(node, "EDGE_ANOMALY", { type: "edge_node", id: node.nodeId }, { anomaly: "robot_state_not_owned", records: notOwned }, "failure");
    if (out.http !== 200) return out;
    for (const t of transitions) await recordEstop(d, node, robotById.get(t.robotId)!, t.rec);
    for (const e of emits) emitLive(robotById.get(e.robotId)!, e.rec, e.status);
    return out;
  } catch (err) {
    if (err instanceof StreamAnswer) return err.answer;
    if (!isEdgeUnavailableError(err)) console.error(`[EdgeIngest] robot states of node ${node.nodeCode} failed: ${(err as Error)?.message ?? err}`);
    return edgeUnavailable;
  }
}

type RobotRow = typeof robots.$inferSelect;

/** D6 — the trust decision is CENTRAL's: approved (node, robot, digest) AND a trusted vendor ⇒ trusted origin; else plain. */
export async function edgeRobotEstopTrusted(d: Db, nodeId: number, robot: RobotRow): Promise<boolean> {
  try {
    const { TRUSTED_ROBOT_TELEMETRY_VENDORS } = await import("../safety/trustedSafetyOrigin");
    if (!TRUSTED_ROBOT_TELEMETRY_VENDORS.has(robot.vendor)) return false;
    return await isEdgeRobotTrustApproved(d as never, { nodeId, robotId: robot.id, digest: edgeRobotTrustDigest(nodeId, robot as never) });
  } catch {
    return false; // undecidable ⇒ plain (never trusted on an error)
  }
}

async function recordEstop(d: Db, node: EdgeNodePrincipal, robot: RobotRow, rec: EdgeRobotStateRecord): Promise<void> {
  try {
    const trusted = await edgeRobotEstopTrusted(d, node.nodeId, robot);
    const m = await import("../safety/safetyAuditService");
    const input = {
      eventType: "estop" as const,
      robotId: robot.id,
      stationId: robot.stationId ?? null,
      lineId: robot.lineId ?? null,
      detectedBy: "telemetry" as const,
      handledBy: "advisory" as const,
      outcome: "logged_only" as const,
      robotState: { mode: rec.mode ?? null, busy: rec.busy ?? null, error: rec.error ?? null, edgeNodeId: node.nodeId },
      notes: `ADVISORY: e-stop observed via edge node ${node.nodeCode} telemetry on "${robot.code}" (software logged only — not a safety-rated stop)`,
    };
    if (trusted) await m.recordFromDeviceIngest("edge_robot_telemetry", input);
    else await m.record(input);
  } catch (err) {
    console.error(`[EdgeIngest] e-stop of robot ${robot.id} (node ${node.nodeCode}) not recorded: ${(err as Error)?.message ?? err}`);
  }
}

function emitLive(robot: RobotRow, rec: EdgeRobotStateRecord, status: string): void {
  void import("../../_core/socket")
    .then(({ emitRobotTelemetry }) =>
      emitRobotTelemetry({
        robotId: robot.id,
        robotCode: robot.code,
        mode: rec.mode ?? null,
        busy: rec.busy ?? null,
        estop: rec.estop ?? null,
        speedPct: rec.speedPct ?? null,
        pose: (rec.pose ?? null) as Record<string, unknown> | null,
        jointStates: rec.jointStates ?? null,
        batteryPct: rec.batteryPct ?? null,
        safetyZoneId: rec.safetyZoneId ?? null,
        firmwareVersion: rec.firmwareVersion ?? null,
        error: rec.error ?? null,
        status,
        ts: rec.ts,
      }),
    )
    .catch(() => undefined);
}
