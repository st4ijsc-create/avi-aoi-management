/**
 * doc 81 Đợt 10 task B — helpers shared by the CENTRAL v2 node endpoints (edgeExecutionCentral, edgeAuthorizeCentral,
 * edgeReportsCentral, edgeIngestCentral, edgeConfigCentral, edgeNodeCommands). Nothing here is reachable from the edge.
 *
 *   • the node's protocol version (edge_nodes."protocolVersion", mig 0373 — narrow projection; missing column ⇒ 1);
 *   • the ONE 404 for a run that is not the caller's (missing, another node's, outside the node's factory: byte-identical);
 *   • central's signing key + the keyset it publishes (from the keyring FILES only — R-10-c), or null ⇒ 503;
 *   • device ownership reads (robots / device_adapters."edgeNodeId" + "ownerEpoch", mig 0374);
 *   • the audit writer for node actions (never throws, never logs a token).
 */
import { createHash } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "../../db/connection";
import { EDGE_PROTOCOL_VERSION, edgeError, type EdgeAnswer } from "./edgeProtocol";
import { adapterOwnership, edgeNodeProtocol, isEdgeControlSchemaMissing, robotOwnership } from "./edgeControlSchema";
import { buildEdgeKeysetFromKeyring, edgeKeyDirOf, getCentralEdgeSigningKey, readEdgeKeyring, signEdgeObject, type EdgeKeyset, type EdgeSignedEnvelope, type EdgeSigningKey } from "./edgeSigning";
import type { EdgeNodePrincipal } from "./edgeNodeCredentials";
import { isEdgeSchemaMissing } from "./edgeExecutionSchema";

export type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

/** Internal control-flow signal: the DB is not reachable (mapped to 503 edge_unavailable). */
export class EdgeCentralUnavailable extends Error {}

export async function centralDb(): Promise<Db> {
  const d = await getDb();
  if (!d) throw new EdgeCentralUnavailable("db unavailable");
  return d;
}

/** THE 404 of every run route: the same bytes for a missing run and for another node's / out-of-scope run (no oracle). */
export function runNotFound(runId: number): EdgeAnswer<never> {
  return edgeError("not_found", `Run ${runId} not found.`);
}
export const edgeUnavailable: EdgeAnswer<never> = edgeError("edge_unavailable", "Edge execution is not available (database, migrations 0370–0375, or central's edge signing key).");

/** A 0370 / 0372–0375 table or column missing, or the DB down ⇒ 503 (never a 500 with a DB text). */
export function isEdgeUnavailableError(err: unknown): boolean {
  const e = err as { code?: unknown; cause?: { code?: unknown } } | null;
  // 42883 undefined_function — a 0374 / 0375 guarded function missing (contract delta R-10-f) ⇒ 503 as well
  const fnMissing = (e?.code ?? e?.cause?.code) === "42883";
  return err instanceof EdgeCentralUnavailable || fnMissing || isEdgeSchemaMissing(err) || isEdgeControlSchemaMissing(err);
}

/** Defence in depth: the run's non-STOP targets sit in the NODE's factory (foeEngine.runVisibleTo) — false on any error. */
export async function runInNodeScope(run: { workflowId: number; paramsJson: unknown }, node: Pick<EdgeNodePrincipal, "factoryCode">): Promise<boolean> {
  try {
    const { runVisibleTo } = await import("../orchestration/foe/foeEngine");
    const { nodeScopeOf } = await import("./edgeExecutionCentral");
    return (await runVisibleTo(run, nodeScopeOf(node))) === true;
  } catch {
    return false;
  }
}

/** The node's protocol version (1 = Đợt 9 DB-backed edge, 2 = this protocol). Column missing (0373) ⇒ 1. Throws on other errors. */
export async function nodeProtocolVersion(d: Db, nodeId: number): Promise<number> {
  try {
    const [row] = await d.select({ v: edgeNodeProtocol.protocolVersion }).from(edgeNodeProtocol).where(eq(edgeNodeProtocol.id, nodeId)).limit(1);
    return row ? Number(row.v) : 1;
  } catch (err) {
    if (isEdgeControlSchemaMissing(err)) return 1;
    throw err;
  }
}

export function protocolVersionAnswer(v: number): EdgeAnswer<never> {
  return edgeError("protocol_version", `This node is on edge protocol v${v}; this route needs v${EDGE_PROTOCOL_VERSION} (an administrator switches the node with scripts/edge-node-credential.ts).`);
}

// ── signing ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** How long a retired key stays in the published keyset after it was retired (max auth TTL + skew, generous). */
export function edgeRetiredGraceMs(): number {
  const n = parseInt(process.env.EDGE_KEY_RETIRED_GRACE_MS || "600000", 10);
  return Number.isFinite(n) ? Math.min(7 * 86_400_000, Math.max(60_000, n)) : 600_000;
}

export interface CentralSigner {
  key: EdgeSigningKey;
  keyset: EdgeKeyset;
  /** the signed keyset (typ keyset) shipped in every config */
  keysetEnvelope: EdgeSignedEnvelope;
}
let signerCache: { at: number; signer: CentralSigner } | null = null;
/**
 * Central's signer: the key (EDGE_SIGNING_KEY_FILE | _PEM) and the keyset derived ONLY from the keyring FILES (R-10-c). The
 * loaded key must be an ACTIVE key of the keyring. Anything missing / inconsistent ⇒ null (every v2 route answers 503 — a node
 * is never handed something it cannot verify). Cached for 5 s (keyring rotation is picked up without a restart).
 */
export function centralSigner(): CentralSigner | null {
  const now = Date.now();
  if (signerCache && now - signerCache.at < 5_000 && getCentralEdgeSigningKey() === signerCache.signer.key) return signerCache.signer;
  try {
    const key = getCentralEdgeSigningKey();
    const dir = edgeKeyDirOf();
    if (!key || !dir) return null;
    const keyset = buildEdgeKeysetFromKeyring(readEdgeKeyring(dir), key, { retiredGraceMs: edgeRetiredGraceMs() });
    const signer = { key, keyset, keysetEnvelope: signEdgeObject("keyset", keyset, key) };
    signerCache = { at: now, signer };
    return signer;
  } catch (err) {
    console.error(`[EdgeCentral] edge signing key / keyring unusable: ${(err as Error)?.message ?? err}`);
    return null;
  }
}
/**
 * THE one place central signs a node-bound object (contract delta R-10-f isolation): the node's credentialId is added to the
 * payload whenever the payload's strict protocol schema carries that field (cmd / runpkg / sweep after fix round 1; the
 * auth claims and the config always). Then the payload is checked against that schema BEFORE signing — central never signs
 * something the edge's typed verifier would refuse. Throws on a schema failure (a central bug; the route answers 503).
 */
export function signForNode(
  signer: CentralSigner,
  typ: "auth" | "config" | "runpkg" | "cmd",
  schema: { safeParse: (v: unknown) => { success: boolean } },
  payload: Record<string, unknown>,
  node: Pick<EdgeNodePrincipal, "credentialId">,
): EdgeSignedEnvelope {
  let body = payload;
  if (!("credentialId" in payload) && schema.safeParse({ ...payload, credentialId: node.credentialId }).success) body = { ...payload, credentialId: node.credentialId };
  if (!schema.safeParse(body).success) throw new Error(`signForNode: central built an invalid ${typ} payload`);
  return signEdgeObject(typ, body, signer.key);
}

/** Tests only. */
export function __resetCentralSignerCacheForTests(): void {
  signerCache = null;
}

export const sha256Hex = (s: string): string => createHash("sha256").update(s, "utf8").digest("hex");

// ── ownership (mig 0374) ────────────────────────────────────────────────────────────────────────────────────────────

export interface Ownership {
  edgeNodeId: number | null;
  ownerEpoch: number;
}
export async function robotOwners(d: Db, ids: readonly number[]): Promise<Map<number, Ownership>> {
  const out = new Map<number, Ownership>();
  const want = [...new Set(ids.filter((x) => Number.isSafeInteger(x) && x > 0))];
  if (want.length === 0) return out;
  const rows = await d.select({ id: robotOwnership.id, edgeNodeId: robotOwnership.edgeNodeId, ownerEpoch: robotOwnership.ownerEpoch }).from(robotOwnership).where(inArray(robotOwnership.id, want));
  for (const r of rows) out.set(r.id, { edgeNodeId: r.edgeNodeId ?? null, ownerEpoch: Number(r.ownerEpoch) });
  return out;
}
export async function adapterOwners(d: Db, ids: readonly number[]): Promise<Map<number, Ownership>> {
  const out = new Map<number, Ownership>();
  const want = [...new Set(ids.filter((x) => Number.isSafeInteger(x) && x > 0))];
  if (want.length === 0) return out;
  const rows = await d.select({ id: adapterOwnership.id, edgeNodeId: adapterOwnership.edgeNodeId, ownerEpoch: adapterOwnership.ownerEpoch }).from(adapterOwnership).where(inArray(adapterOwnership.id, want));
  for (const r of rows) out.set(r.id, { edgeNodeId: r.edgeNodeId ?? null, ownerEpoch: Number(r.ownerEpoch) });
  return out;
}
/** The ids (among `ids`) the node owns. */
/** The ids (among `ids`) the node owns AND that are placed in the node's factory (I-4 — ownership never crosses a factory). */
export async function ownedRobotIds(d: Db, nodeId: number, ids: readonly number[]): Promise<Set<number>> {
  const m = await robotOwners(d, ids);
  const mine = [...m].filter(([, o]) => o.edgeNodeId === nodeId).map(([id]) => id);
  if (mine.length === 0) return new Set();
  const f = await nodeFactoryId(d, nodeId);
  const p = await robotPlacements(d, mine);
  return new Set(mine.filter((id) => f !== null && p.get(id)?.factoryId === f));
}
export async function ownedAdapterIds(d: Db, nodeId: number, ids: readonly number[]): Promise<Set<number>> {
  const m = await adapterOwners(d, ids);
  const mine = [...m].filter(([, o]) => o.edgeNodeId === nodeId).map(([id]) => id);
  if (mine.length === 0) return new Set();
  const f = await nodeFactoryId(d, nodeId);
  const p = await adapterPlacements(d, mine);
  return new Set(mine.filter((id) => f !== null && p.get(id)?.factoryId === f));
}
/**
 * I-4 (R-10-am) — the node's factory and the PLACEMENT of devices: a device counts for a node only when it is owned by the
 * node AND placed in the node's factory (robot: station → line or line → workshop → factory; adapter: machine → station → line
 * → workshop → factory). A node without a resolvable factory, or a device without a full placement chain, counts for NOTHING
 * (fail-closed). The placement (station / line) is returned for the explicit safety-PLC match of the config.
 */
export interface DevicePlacement {
  id: number;
  stationId: number | null;
  lineId: number | null;
  factoryId: number | null;
}
const rowsOf = (r: unknown): Array<Record<string, unknown>> => (Array.isArray(r) ? r : ((r as { rows?: unknown[] })?.rows ?? [])) as Array<Record<string, unknown>>;
const numOrNull = (v: unknown): number | null => (v == null ? null : Number.isFinite(Number(v)) ? Number(v) : null);

/**
 * The role of a user for FIELD_V2 / policy (central's resolveRobotAuthzContext reads users.role the same way; a user with no
 * role is the least-privileged "user"). M-2 — a read error THROWS (the caller answers 503): an unreadable role is never "user".
 */
export async function userRoleOf(d: Db, userId: number): Promise<string> {
  const { users } = await import("../../../drizzle/schema");
  const [u] = await d.select({ role: users.role }).from(users).where(eq(users.id, userId)).limit(1);
  return typeof u?.role === "string" && u.role ? u.role : "user";
}

export async function nodeFactoryId(d: Db, nodeId: number): Promise<number | null> {
  const r = rowsOf(await d.execute(sql`SELECT f.id FROM edge_nodes n JOIN factories f ON f.code = n."factoryCode" WHERE n.id = ${nodeId} LIMIT 1`));
  return numOrNull(r[0]?.id);
}
export async function robotPlacements(d: Db, ids: readonly number[]): Promise<Map<number, DevicePlacement>> {
  const out = new Map<number, DevicePlacement>();
  const want = [...new Set(ids.filter((x) => Number.isSafeInteger(x) && x > 0))];
  if (want.length === 0) return out;
  const r = rowsOf(
    await d.execute(sql`SELECT r.id, r."stationId", COALESCE(s."lineId", r."lineId") AS "lineId", w."factoryId"
      FROM robots r LEFT JOIN stations s ON s.id = r."stationId"
      LEFT JOIN production_lines l ON l.id = COALESCE(s."lineId", r."lineId")
      LEFT JOIN workshops w ON w.id = l."workshopId"
      WHERE r.id IN ${sql.raw(`(${want.join(",")})`)}`),
  );
  for (const x of r) out.set(Number(x.id), { id: Number(x.id), stationId: numOrNull(x.stationId), lineId: numOrNull(x.lineId), factoryId: numOrNull(x.factoryId) });
  return out;
}
export async function adapterPlacements(d: Db, ids: readonly number[]): Promise<Map<number, DevicePlacement>> {
  const out = new Map<number, DevicePlacement>();
  const want = [...new Set(ids.filter((x) => Number.isSafeInteger(x) && x > 0))];
  if (want.length === 0) return out;
  const r = rowsOf(
    await d.execute(sql`SELECT a.id, s.id AS "stationId", s."lineId", w."factoryId"
      FROM device_adapters a LEFT JOIN machines m ON m.id = a."machineId"
      LEFT JOIN stations s ON s.id = m."stationId"
      LEFT JOIN production_lines l ON l.id = s."lineId"
      LEFT JOIN workshops w ON w.id = l."workshopId"
      WHERE a.id IN ${sql.raw(`(${want.join(",")})`)}`),
  );
  for (const x of r) out.set(Number(x.id), { id: Number(x.id), stationId: numOrNull(x.stationId), lineId: numOrNull(x.lineId), factoryId: numOrNull(x.factoryId) });
  return out;
}
/** Is this device placed in the node's factory? (owner checked separately). Any unknown ⇒ false. */
export async function deviceInNodeFactory(d: Db, nodeId: number, kind: "robot" | "adapter", id: number): Promise<boolean> {
  const f = await nodeFactoryId(d, nodeId);
  if (f === null) return false;
  const p = (kind === "robot" ? await robotPlacements(d, [id]) : await adapterPlacements(d, [id])).get(id);
  return !!p && p.factoryId === f;
}
/** The node's devices that count: owned AND placed in its factory, with their placements (I-4). */
export async function devicesOfNodeInScope(d: Db, nodeId: number): Promise<{ factoryId: number | null; robots: DevicePlacement[]; adapters: DevicePlacement[]; excluded: { robots: number[]; adapters: number[] } }> {
  const owned = await devicesOfNode(d, nodeId);
  const factoryId = await nodeFactoryId(d, nodeId);
  const [rp, ap] = await Promise.all([robotPlacements(d, owned.robots), adapterPlacements(d, owned.adapters)]);
  const inF = (p: DevicePlacement | undefined) => !!p && factoryId !== null && p.factoryId === factoryId;
  return {
    factoryId,
    robots: owned.robots.map((id) => rp.get(id)).filter((p): p is DevicePlacement => inF(p)),
    adapters: owned.adapters.map((id) => ap.get(id)).filter((p): p is DevicePlacement => inF(p)),
    excluded: { robots: owned.robots.filter((id) => !inF(rp.get(id))), adapters: owned.adapters.filter((id) => !inF(ap.get(id))) },
  };
}

/** Every device the node owns (ids only). */
export async function devicesOfNode(d: Db, nodeId: number): Promise<{ robots: number[]; adapters: number[] }> {
  const [rs, as] = await Promise.all([
    d.select({ id: robotOwnership.id }).from(robotOwnership).where(eq(robotOwnership.edgeNodeId, nodeId)),
    d.select({ id: adapterOwnership.id }).from(adapterOwnership).where(eq(adapterOwnership.edgeNodeId, nodeId)),
  ]);
  return { robots: rs.map((r) => r.id).sort((a, b) => a - b), adapters: as.map((r) => r.id).sort((a, b) => a - b) };
}

// ── audit ───────────────────────────────────────────────────────────────────────────────────────────────────────────

/** An audit row of a node action (userName `edge:<code>`). Never throws; `tx` writes it inside a transaction. */
export async function auditNode(
  node: Pick<EdgeNodePrincipal, "nodeCode" | "credentialId" | "nodeId">,
  action: string,
  entity: { type: string; id: number | null },
  details: Record<string, unknown>,
  status: "success" | "failure" = "success",
): Promise<void> {
  try {
    const { createAuditLog } = await import("../../db/system");
    await createAuditLog({
      userId: null,
      userName: `edge:${node.nodeCode}`,
      action,
      entityType: entity.type,
      entityId: entity.id,
      entityName: node.nodeCode,
      details: { nodeId: node.nodeId, credentialId: node.credentialId, ...details },
      status,
    });
  } catch (err) {
    console.error(`[EdgeCentral] audit ${action} not written: ${(err as Error)?.message ?? err}`);
  }
}
