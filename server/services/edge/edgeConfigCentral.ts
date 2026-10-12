/**
 * doc 81 Đợt 10 task B (design §2.4, D4, D7, D14) — the SIGNED CONFIG SNAPSHOT of an edge node (POST /edge/node/config).
 *
 * What the node gets — ONLY what it owns (robots / device_adapters."edgeNodeId" = node, mig 0374):
 *   • node: id, code, the credential the config was fetched with, factory, lines — CENTRAL-owned (the node can no longer
 *     rename itself or change its factory / lines: there is no self-registration for v2, D14);
 *   • its adapters with their tags (address, dataType, scale, offset, writable, enabled, STOP pin, updatedAt), the connection
 *     options DECRYPTED centrally (D4 — the edge never holds SECRET_ENCRYPTION_KEY / JWT_SECRET) and the connection
 *     fingerprint (adapterTarget.adapterTargetFingerprint over exactly the shipped protocol / endpoint / machine / options —
 *     the edge compares it before a pinned STOP, replacing runningConnectionMatchesAdapterRow);
 *   • its robots: enabled, commissioned (null = unknown ⇒ a STOP is SENT), the mirrored motion-lock row (any authority) with
 *     its generation, the generation floor and the owner epoch;
 *   • the machines its adapters are bound to; the safety-PLC configs guarding its targets (safetyTarget matcher, with the
 *     0368 trust digest + approval);
 *   • the keyset (signed, typ keyset — the edge accepts it only through its pinned / chained EdgeTrustStore) and the limits.
 * Nothing of another node: no device, no secret, no code (attack A3 — a string scan of the config finds none).
 *
 * VERSIONING: the content (everything but configVersion / issuedAt) is hashed; a node's cached snapshot is reused while the
 * content is unchanged (rebuilt at most every EDGE_CONFIG_CACHE_MS); a change gets configVersion = max(now in seconds,
 * previous + 1) — strictly increasing per node within a process and across restarts (wall clock), so the edge's rollback check
 * holds. configHash = edgeProtocol.edgeConfigHash(envelope); a request quoting it gets `notModified`.
 */
import { eq, inArray } from "drizzle-orm";
import { deviceAdapters, deviceTags, edgeNodes, machines, robots } from "../../../drizzle/schema";
import {
  EDGE_PROTOCOL_VERSION,
  clampEdgeAuthTtlMs,
  edgeConfigAdapterSchema,
  edgeConfigHash,
  edgeConfigRobotSchema,
  edgeConfigSafetyPlcSchema,
  edgeConfigSnapshotSchema,
  edgeConfigRequestSchema,
  parseEdgeBody,
  type EdgeAnswer,
  type EdgeConfigAnswer,
} from "./edgeProtocol";
import { adapterOwnership, robotMotionLockAuthority, robotOwnership } from "./edgeControlSchema";
import { edgeCanonicalJson, type EdgeSignedEnvelope } from "./edgeSigning";
import {
  centralDb,
  centralSigner,
  devicesOfNodeInScope,
  edgeUnavailable,
  isEdgeUnavailableError,
  nodeProtocolVersion,
  protocolVersionAnswer,
  sha256Hex,
  signForNode,
  type Db,
} from "./edgeCentralCommon";
import type { EdgeNodePrincipal } from "./edgeNodeCredentials";

const intEnv = (name: string, def: number, min: number, max: number): number => {
  const n = parseInt(process.env[name] || String(def), 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};
export function edgeConfigCacheMs(): number {
  return intEnv("EDGE_CONFIG_CACHE_MS", 5_000, 0, 300_000);
}
/** The limits every node runs with (central decides). */
export function edgeNodeLimits() {
  return {
    authTtlMs: clampEdgeAuthTtlMs(process.env.EDGE_AUTH_TTL_MS),
    maxClockSkewMs: intEnv("EDGE_MAX_CLOCK_SKEW_MS", 5_000, 0, 300_000),
    journalMaxBytes: intEnv("EDGE_JOURNAL_MAX_BYTES", 256 * 1024 * 1024, 1024 * 1024, 2_000_000_000),
    programReportMs: intEnv("EDGE_PROGRAM_REPORT_MS", 30_000, 1_000, 3_600_000),
    programReportMaxAgeMs: edgeProgramReportMaxAgeMs(),
    heartbeatMs: intEnv("EDGE_HEARTBEAT_MS", 10_000, 1_000, 600_000),
    pullMs: intEnv("EDGE_PULL_MS", 2_000, 500, 60_000),
  };
}
/** The max age the node is told (limits.programReportMaxAgeMs); the RULE that judges a reading is Group C's (R-10-m). */
export function edgeProgramReportMaxAgeMs(): number {
  return intEnv("EDGE_PROGRAM_REPORT_MAX_AGE_MS", 120_000, 1_000, 3_600_000);
}

const ms = (v: unknown): number => {
  const t = v instanceof Date ? v.getTime() : v == null ? 0 : new Date(String(v)).getTime();
  return Number.isFinite(t) && t >= 0 ? t : 0;
};
const num = (v: unknown): number | null => (v == null ? null : Number.isFinite(Number(v)) ? Number(v) : null);
/** A JSON-safe copy (Dates → ISO text, undefined dropped) — canonical JSON refuses Date objects. */
const plain = <T>(v: T): T => JSON.parse(JSON.stringify(v ?? null)) as T;

/** D4 — every `enc:v1:` value decrypted centrally (only ever for the node's OWN devices). A value that cannot be decrypted ⇒ null. */
async function openSecrets(v: unknown): Promise<unknown> {
  const { decryptSecret, isEncrypted } = await import("../security/secretBox");
  const walk = (x: unknown): unknown => {
    if (typeof x === "string") return isEncrypted(x) ? decryptSecret(x) : x;
    if (Array.isArray(x)) return x.map(walk);
    if (x && typeof x === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(x as Record<string, unknown>)) out[k] = walk(val);
      return out;
    }
    return x;
  };
  return walk(plain(v));
}

type Content = Omit<import("./edgeProtocol").EdgeConfigSnapshot, "configVersion" | "issuedAt">;

/**
 * I-3 — does a safety-PLC config guard the node's devices, EXPLICITLY? Its factory (when set) must be the node's; then it names
 * an owned robot, a station or a line of an owned device, or — naming no robot / station / line — it is a factory-wide row of
 * the node's own factory. Nothing else (a null field is never a wildcard; an untargeted row with no factory is not shipped).
 */
export function edgePlcConfigGuardsNode(
  cfg: { robotId?: number | null; stationId?: number | null; lineId?: number | null; factoryId?: number | null },
  nodeFactoryId: number,
  ownRobots: ReadonlySet<number>,
  ownStations: ReadonlySet<number>,
  ownLines: ReadonlySet<number>,
): boolean {
  if (cfg.factoryId != null && cfg.factoryId !== nodeFactoryId) return false;
  if (cfg.robotId != null) return ownRobots.has(cfg.robotId);
  if (cfg.stationId != null) return ownStations.has(cfg.stationId);
  if (cfg.lineId != null) return ownLines.has(cfg.lineId);
  return cfg.factoryId === nodeFactoryId;
}

/** Build the node's config CONTENT (deterministic for a given DB state + keyring). Throws on a DB error. */
export async function buildNodeConfigContent(d: Db, node: EdgeNodePrincipal): Promise<Content> {
  const signer = centralSigner();
  if (!signer) throw new Error("no signer");
  const [nodeRow] = await d.select({ id: edgeNodes.id, code: edgeNodes.code, factoryCode: edgeNodes.factoryCode, lines: edgeNodes.assignedLineCodes }).from(edgeNodes).where(eq(edgeNodes.id, node.nodeId)).limit(1);
  if (!nodeRow) throw new Error("node row missing");
  // I-4 — owned AND placed in the node's factory (an unplaced / foreign-factory device is never shipped; logged)
  const scope = await devicesOfNodeInScope(d, node.nodeId);
  if (scope.excluded.robots.length || scope.excluded.adapters.length) {
    console.warn(`[EdgeConfig] node ${node.nodeCode}: devices it owns outside its factory (or unplaced) are NOT in its config — robots ${scope.excluded.robots.join(",") || "-"}, adapters ${scope.excluded.adapters.join(",") || "-"}`);
  }
  const owned = { robots: scope.robots.map((p) => p.id), adapters: scope.adapters.map((p) => p.id) };
  const { adapterTargetFingerprint } = await import("../ot/adapterTarget");

  // ── adapters + tags ──
  const aRows = owned.adapters.length ? await d.select().from(deviceAdapters).where(inArray(deviceAdapters.id, owned.adapters)) : [];
  const ownerOfAdapter = owned.adapters.length
    ? new Map((await d.select({ id: adapterOwnership.id, e: adapterOwnership.ownerEpoch }).from(adapterOwnership).where(inArray(adapterOwnership.id, owned.adapters))).map((r) => [r.id, Number(r.e)] as const))
    : new Map<number, number>();
  const tRows = owned.adapters.length ? await d.select().from(deviceTags).where(inArray(deviceTags.adapterId, owned.adapters)) : [];
  const adapters: Content["adapters"] = [];
  for (const a of [...aRows].sort((x, y) => x.id - y.id)) {
    const connectionOptions = (a.connectionOptions == null ? null : await openSecrets(a.connectionOptions)) as Record<string, unknown> | null;
    const candidate = {
      id: a.id,
      code: a.code,
      machineId: a.machineId ?? null,
      protocol: a.protocol,
      endpoint: a.endpoint,
      connectionOptions,
      pollIntervalMs: a.pollIntervalMs,
      isEnabled: a.isEnabled === true,
      connectionFingerprint: adapterTargetFingerprint({ protocol: a.protocol, endpoint: a.endpoint, machineId: a.machineId ?? null, connectionOptions }),
      ownerEpoch: ownerOfAdapter.get(a.id) ?? 1,
      updatedAt: ms(a.updatedAt),
      tags: tRows
        .filter((t) => t.adapterId === a.id)
        .sort((x, y) => x.id - y.id)
        .map((t) => ({
          id: t.id,
          tagKey: t.tagKey,
          address: t.address,
          dataType: t.dataType,
          scale: num(t.scale),
          offset: num(t.offset),
          writable: t.writable === true,
          isEnabled: t.isEnabled === true,
          stopValue: plain(t.stopValue ?? null),
          updatedAt: ms(t.updatedAt),
        })),
    };
    const p = edgeConfigAdapterSchema.safeParse(candidate);
    if (p.success) adapters.push(p.data);
    else console.warn(`[EdgeConfig] adapter ${a.id} of node ${node.nodeCode} left out of the config (not expressible: ${p.error.issues[0]?.path.join(".")})`);
  }

  // ── robots ──
  const rRows = owned.robots.length ? await d.select().from(robots).where(inArray(robots.id, owned.robots)) : [];
  const rOwn = owned.robots.length
    ? new Map((await d.select().from(robotOwnership).where(inArray(robotOwnership.id, owned.robots))).map((r) => [r.id, r] as const))
    : new Map();
  const locks = owned.robots.length
    ? new Map((await d.select().from(robotMotionLockAuthority).where(inArray(robotMotionLockAuthority.robotId, owned.robots))).map((l) => [l.robotId, l] as const))
    : new Map();
  const { isRobotCommissioned } = await import("../robot/robotCommandDispatcher");
  const robotsOut: Content["robots"] = [];
  for (const r of [...rRows].sort((x, y) => x.id - y.id)) {
    let commissioned: boolean | null;
    try {
      commissioned = await isRobotCommissioned(r.id);
    } catch {
      commissioned = null;
    }
    const lock = locks.get(r.id);
    const own = rOwn.get(r.id);
    const candidate = {
      id: r.id,
      code: r.code,
      name: r.name,
      vendor: r.vendor,
      model: r.model ?? null,
      kind: r.kind,
      endpoint: r.endpoint,
      connectionOptions: (r.connectionOptions == null ? null : await openSecrets(r.connectionOptions)) as Record<string, unknown> | null,
      pollIntervalMs: r.pollIntervalMs,
      isEnabled: r.isEnabled === true,
      commissioned,
      lineId: r.lineId ?? null,
      stationId: r.stationId ?? null,
      motionLock: lock
        ? { reasonCode: lock.reasonCode, generation: lock.generation, authority: lock.authority, ownerEpoch: lock.ownerEpoch == null ? null : Number(lock.ownerEpoch), lockedAt: ms(lock.lockedAt) }
        : null,
      motionLockGenerationFloor: Number(own?.motionLockGenerationFloor ?? 0),
      ownerEpoch: Number(own?.ownerEpoch ?? 1),
      updatedAt: ms(r.updatedAt),
    };
    const p = edgeConfigRobotSchema.safeParse(candidate);
    if (p.success) robotsOut.push(p.data);
    else console.warn(`[EdgeConfig] robot ${r.id} of node ${node.nodeCode} left out of the config (not expressible: ${p.error.issues[0]?.path.join(".")})`);
  }

  // ── machines the adapters are bound to ──
  const machineIds = [...new Set(adapters.map((a) => a.machineId).filter((x): x is number => x != null))];
  const mRows = machineIds.length ? await d.select({ id: machines.id, machineType: machines.machineType, capabilities: machines.capabilities }).from(machines).where(inArray(machines.id, machineIds)) : [];
  const machinesOut = mRows.sort((x, y) => x.id - y.id).map((m) => ({ id: m.id, machineType: m.machineType, capabilities: plain(m.capabilities ?? null) }));

  // ── safety-PLC configs: I-3 — only rows EXPLICITLY guarding an owned device (its robot, its station, its line) or an
  //    untargeted row of the node's OWN factory; a config of another factory is never shipped; a null machine / station /
  //    target is never a wildcard. Shipped as a projection (no name / notes / scope / corporateCode).
  const { listPlcConfigs } = await import("../safety/plc/safetyPlcAdapter");
  const { plcTrustDigest, isPlcConfigTrustApproved } = await import("../safety/plc/safetyPlcTrust");
  const ownRobots = new Set(scope.robots.map((p) => p.id));
  const ownStations = new Set([...scope.robots, ...scope.adapters].map((p) => p.stationId).filter((x): x is number => x != null));
  const ownLines = new Set([...scope.robots, ...scope.adapters].map((p) => p.lineId).filter((x): x is number => x != null));
  const safetyOut: Content["safetyPlcConfigs"] = [];
  if (scope.factoryId !== null && (ownRobots.size > 0 || scope.adapters.length > 0)) {
    for (const cfg of await listPlcConfigs({ onlyEnabled: true })) {
      if (!edgePlcConfigGuardsNode(cfg, scope.factoryId, ownRobots, ownStations, ownLines)) continue;
      const projection = {
        id: cfg.id,
        code: cfg.code,
        vendor: cfg.vendor,
        backend: cfg.backend,
        endpoint: cfg.endpoint ?? null,
        statusMap: plain(cfg.statusMap ?? null),
        robotId: cfg.robotId ?? null,
        stationId: cfg.stationId ?? null,
        lineId: cfg.lineId ?? null,
        factoryId: cfg.factoryId ?? null,
        enabled: cfg.enabled === true,
      };
      const p = edgeConfigSafetyPlcSchema.safeParse({ id: cfg.id, trustDigest: plcTrustDigest(cfg), approved: await isPlcConfigTrustApproved(cfg), config: projection });
      if (p.success) safetyOut.push(p.data);
    }
  }

  return {
    kind: "config_snapshot",
    protocolVersion: EDGE_PROTOCOL_VERSION,
    node: {
      id: nodeRow.id,
      code: nodeRow.code,
      credentialId: node.credentialId,
      factoryCode: nodeRow.factoryCode ?? null,
      lineCodes: Array.isArray(nodeRow.lines) ? [...nodeRow.lines].filter((x): x is string => typeof x === "string" && x.length > 0).slice(0, 200) : [],
    },
    adapters,
    robots: robotsOut,
    machines: machinesOut as Content["machines"],
    safetyPlcConfigs: safetyOut,
    keyset: signer.keysetEnvelope,
    limits: edgeNodeLimits(),
  };
}

interface CachedConfig {
  contentHash: string;
  version: number;
  envelope: EdgeSignedEnvelope;
  configHash: string;
  builtAt: number;
  credentialId: number;
}
const cache = new Map<number, CachedConfig>();
/** Tests only. */
export function __resetEdgeConfigCacheForTests(): void {
  cache.clear();
}

/** The node's current signed config (rebuilt when stale; same content ⇒ same envelope). Throws on a DB / signing error. */
export async function currentNodeConfig(node: EdgeNodePrincipal, opts: { fresh?: boolean } = {}): Promise<CachedConfig> {
  const prev = cache.get(node.nodeId);
  if (!opts.fresh && prev && prev.credentialId === node.credentialId && Date.now() - prev.builtAt < edgeConfigCacheMs()) return prev;
  const signer = centralSigner();
  if (!signer) throw new Error("no signer");
  const d = await centralDb();
  const content = await buildNodeConfigContent(d, node);
  const contentHash = sha256Hex(edgeCanonicalJson(content));
  if (prev && prev.contentHash === contentHash && prev.credentialId === node.credentialId) {
    const kept = { ...prev, builtAt: Date.now() };
    cache.set(node.nodeId, kept);
    return kept;
  }
  const version = Math.max(Math.floor(Date.now() / 1000), (prev?.version ?? 0) + 1);
  const envelope = signForNode(signer, "config", edgeConfigSnapshotSchema, { ...content, configVersion: version, issuedAt: Date.now() }, node);
  const out: CachedConfig = { contentHash, version, envelope, configHash: edgeConfigHash(envelope), builtAt: Date.now(), credentialId: node.credentialId };
  cache.set(node.nodeId, out);
  return out;
}

/** configVersion for heartbeat / pull answers (0 when it cannot be built now — the edge keeps what it has). */
export async function currentConfigVersion(node: EdgeNodePrincipal): Promise<number> {
  try {
    return (await currentNodeConfig(node)).version;
  } catch {
    return 0;
  }
}

/** POST /edge/node/config. */
export async function configForNode(node: EdgeNodePrincipal, body: unknown, ifNoneMatch?: string | null): Promise<EdgeAnswer<EdgeConfigAnswer>> {
  const parsed = parseEdgeBody(edgeConfigRequestSchema, body);
  if (!parsed.ok) return parsed.answer;
  try {
    const d = await centralDb();
    const v = await nodeProtocolVersion(d, node.nodeId);
    if (v !== EDGE_PROTOCOL_VERSION) return protocolVersionAnswer(v);
    if (!centralSigner()) return edgeUnavailable;
    const cfg = await currentNodeConfig(node);
    const held = parsed.data.configHash ?? (typeof ifNoneMatch === "string" ? ifNoneMatch.replace(/^W\//, "").replace(/"/g, "").trim() : null);
    if (held && held === cfg.configHash) return { http: 200, data: { notModified: true, configHash: cfg.configHash } };
    return { http: 200, data: { config: cfg.envelope, configHash: cfg.configHash } };
  } catch (err) {
    if (!isEdgeUnavailableError(err)) console.error(`[EdgeConfig] config of node ${node.nodeCode} failed: ${(err as Error)?.message ?? err}`);
    else console.warn(`[EdgeConfig] config of node ${node.nodeCode} unavailable: ${(err as Error)?.message ?? err}`);
    return edgeUnavailable;
  }
}
