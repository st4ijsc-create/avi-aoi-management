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
import { eq, inArray, sql } from "drizzle-orm";
import { deviceAdapters, deviceTags, edgeNodes, machines, robots, type SafetyPlcConfig } from "../../../drizzle/schema";
import {
  EDGE_PROTOCOL_VERSION,
  clampEdgeAuthTtlMs,
  edgeConfigAdapterSchema,
  edgeConfigHash,
  edgeConfigRobotSchema,
  edgeConfigSafetyPlcSchema,
  edgeConfigSnapshotSchema,
  edgeConfigRequestSchema,
  EDGE_JOURNAL_STALL_RECOVERED_CODE,
  parseEdgeBody,
  type EdgeAnswer,
  type EdgeConfigAnswer,
} from "./edgeProtocol";
import { adapterOwnership, robotMotionLockAuthority, robotOwnership } from "./edgeControlSchema";
import { EdgeContractError, edgeCanonicalJson, type EdgeSignedEnvelope } from "./edgeSigning";
import { edgeMaxClockSkewMs, edgeProgramReportMaxAgeMs } from "./edgeProgramReportRule";
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
    maxClockSkewMs: edgeMaxClockSkewMs(),
    journalMaxBytes: intEnv("EDGE_JOURNAL_MAX_BYTES", 256 * 1024 * 1024, 1024 * 1024, 2_000_000_000),
    programReportMs: intEnv("EDGE_PROGRAM_REPORT_MS", 30_000, 1_000, 3_600_000),
    programReportMaxAgeMs: edgeProgramReportMaxAgeMs(),
    heartbeatMs: intEnv("EDGE_HEARTBEAT_MS", 10_000, 1_000, 600_000),
    pullMs: intEnv("EDGE_PULL_MS", 2_000, 500, 60_000),
  };
}
/**
 * The max age the node is told (limits.programReportMaxAgeMs). doc 81 Đợt 10 integration (R-10-m): the bound AND the skew come
 * from the ONE shared rule (edgeProgramReportRule) that judges a reading — the node is told exactly what approval / authorize use.
 */
export { edgeProgramReportMaxAgeMs };

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

// ── R1b-2b-2a A2(o) — URGENT alerts of a config central cannot serve (the factory-drift pattern of deviceOwnershipService) ──
/**
 * key → until when THIS process suppresses it (one scan / one rebuild every few seconds never repeats). A2(o) r3 (review I-1):
 * a delivered alert is suppressed for EDGE_CONFIG_ALERT_WINDOW_MS (24 h, the durable dedup's window — docHetTheoTrang.baoDocCatBot's
 * pattern). A2(o) r4 (review m-2): a delivery that FAILED (recipients unreadable / none, or the raise threw) keeps a SHORT stamp
 * (EDGE_CONFIG_ALERT_RETRY_MS, 5 min) — a rebuild every few seconds never floods the log or raises to [] again and again, and
 * after 5 min the next occurrence alerts again. A node that builds again re-arms its build keys (rearmConfigAlerts).
 */
const configAlerted = new Map<string, { until: number }>();
/** = robot/criticalStopAlert CRITICAL_STOP_ALERT_DEDUP_WINDOW_MS (24 h; pinned equal by edgeConfigCentral.a2o.test) */
export const EDGE_CONFIG_ALERT_WINDOW_MS = 24 * 60 * 60 * 1000;
/** A2(o) r4 — how long a FAILED delivery is suppressed before the next occurrence alerts again */
export const EDGE_CONFIG_ALERT_RETRY_MS = 5 * 60 * 1000;
const CONFIG_ALERTED_MAX = 10_000;
/** serialized: two builds never race to write the same inbox rows */
let configAlertQueue: Promise<unknown> = Promise.resolve();
const rowsOf = (r: unknown): Array<Record<string, unknown>> => (Array.isArray(r) ? r : ((r as { rows?: unknown[] })?.rows ?? [])) as Array<Record<string, unknown>>;

/** The people who can act: active admins + supervisors (bounded read; an unreadable list ⇒ none — the log line + alert stream still carry it). */
export async function alertRecipients(d: Db): Promise<number[]> {
  const { withDeadline } = await import("../ot/drivers/boundedClose");
  const r = await withDeadline(Promise.resolve(d.execute(sql`SELECT id FROM public.users WHERE "isActive" = true AND role IN ('admin', 'supervisor')`)), 5_000, "edge config alert recipients");
  return rowsOf(r).map((u) => Number(u.id));
}

/**
 * A2(o) — one URGENT alert per `dedupKey`: per process (configAlerted, 24 h) AND durably for 24 h (khuTrungBenVung — a restart
 * never re-sends it to every admin), retried until the inbox row lands. A delivery that failed (recipients unreadable / none, the
 * raise threw) is suppressed for 5 min only (A2(o) r4) ⇒ an occurrence after that alerts again. Fire-and-forget; never throws.
 * false ⇔ suppressed here (within the window, or in flight).
 */
export function raiseEdgeConfigAlert(a: { kind: string; dedupKey: string; title: string; message: string; nodeId: number }, recipients: () => Promise<number[]>): boolean {
  const now = Date.now();
  const held = configAlerted.get(a.dedupKey);
  if (held !== undefined && now < held.until) return false;
  if (configAlerted.size >= CONFIG_ALERTED_MAX) {
    for (const [k, e] of configAlerted) if (now >= e.until) configAlerted.delete(k);
    if (configAlerted.size >= CONFIG_ALERTED_MAX) configAlerted.clear();
  }
  // marked for the full window while in flight (a rebuild every few seconds never queues a second one); a failed delivery
  // SHORTENS it to the retry stamp (only this call's entry: a newer one is never touched)
  const mine = { until: now + EDGE_CONFIG_ALERT_WINDOW_MS };
  configAlerted.set(a.dedupKey, mine);
  const failed = () => {
    if (configAlerted.get(a.dedupKey) === mine) mine.until = Date.now() + EDGE_CONFIG_ALERT_RETRY_MS;
  };
  configAlertQueue = configAlertQueue
    .then(async () => {
      // an unreadable / empty recipient list still raises (the log line + alert stream carry it) but only the SHORT stamp is
      // kept: the inbox row was written for nobody, so an occurrence after 5 min alerts again
      let to: number[] = [];
      let delivered = true;
      try {
        to = await recipients();
      } catch (err) {
        delivered = false;
        console.error(`[EdgeConfig] ${a.kind}: the alert recipients could not be read (${String((err as Error)?.message ?? err).slice(0, 160)}) — an occurrence after 5 min alerts again`);
      }
      if (!Array.isArray(to) || to.length === 0) {
        if (delivered) console.error(`[EdgeConfig] ${a.kind}: no active admin / supervisor to alert — an occurrence after 5 min alerts again`);
        delivered = false;
        to = [];
      }
      try {
        const { raiseCriticalStopAlert } = await import("../robot/criticalStopAlert");
        await raiseCriticalStopAlert({
          kind: a.kind,
          title: a.title,
          message: a.message,
          recipients: to,
          dedupKey: a.dedupKey,
          // a STATE alert: the per-process memory is empty after every boot ⇒ the durable 24 h dedup keeps one row per (person, key)
          khuTrungBenVung: {},
          retryUntilPersisted: { everyMs: 30_000, attempts: 20 },
          source: "ot",
          entityType: "edge_node",
          entityId: a.nodeId,
        });
      } catch (err) {
        delivered = false;
        console.error(`[EdgeConfig] ${a.kind}: the alert could not be raised (${String((err as Error)?.message ?? err).slice(0, 160)}) — an occurrence after 5 min alerts again`);
      }
      if (!delivered) failed();
    })
    .catch(() => undefined); // one failed alert never breaks the queue (its stamp was shortened: a later occurrence alerts)
  return true;
}
/** A node built a config again ⇒ its BUILD alerts re-arm (a NEW failure later alerts again); edge-reported ones are not build state. */
const BUILD_ALERT_KINDS = new Set(["edge_safety_plc_unshippable", "edge_config_unbuildable"]);
function rearmConfigAlerts(nodeId: number): void {
  for (const k of [...configAlerted.keys()]) {
    const [kind, node] = k.split(":");
    if (BUILD_ALERT_KINDS.has(kind) && node === String(nodeId)) configAlerted.delete(k);
  }
}

/**
 * R1b-2b-2a A2(o) AMENDMENT 2 — what central raises for an anomaly an EDGE reported (events stream, edgeReportsCentral):
 *   • EDGE_SAFETY_CONFIG_MISSING (a write refused: a safety PLC the authorisation was signed for is not in the edge's config) ⇒
 *     ONE URGENT alert per (node, sorted ids) — per process and durably for 24 h (raiseEdgeConfigAlert);
 *   • EDGE_JOURNAL_STALL_RECOVERED (a2n: a disk stall `progress` reported has ended) ⇒ one URGENT per (node, stall), saying whether the node still
 *     refuses non-STOP work until a restart;
 *   • EDGE_CONFIG_STALE and every other code ⇒ nothing beyond the EDGE_ANOMALY audit the caller writes.
 * true ⇔ an alert was raised now. Never throws.
 */
export function alertForEdgeAnomaly(node: Pick<EdgeNodePrincipal, "nodeId" | "nodeCode">, rec: { code: string; detail?: string | null }, recipients: () => Promise<number[]>): boolean {
  if (rec.code === EDGE_JOURNAL_STALL_RECOVERED_CODE) return alertJournalStallRecovered(node, String(rec.detail ?? ""), recipients);
  if (rec.code !== "EDGE_SAFETY_CONFIG_MISSING") return false;
  const detail = String(rec.detail ?? "");
  const listed = /signed safety-PLC config\(s\) ([#0-9, ]+)/.exec(detail)?.[1] ?? "";
  const ids = [...new Set([...listed.matchAll(/#(\d+)/g)].map((m) => Number(m[1])))].sort((a, b) => a - b);
  const idText = ids.length ? ids.map((x) => `#${x}`).join(", ") : "(not named)";
  return raiseEdgeConfigAlert(
    {
      kind: "edge_safety_plc_missing",
      dedupKey: `edge_safety_plc_missing:${node.nodeId}:${ids.length ? ids.join(",") : "unnamed"}`,
      title: `Edge node ${node.nodeCode}: a write was refused — safety-PLC config missing on the edge`,
      message: `Edge node ${node.nodeCode} refused a non-STOP write: the safety-PLC config(s) ${idText} guarding the device are not in the config it holds, so its preflight could not consult them (nothing was sent; the edge asked for a refresh). If this repeats, check that central can build and serve the node's config.`,
      nodeId: node.nodeId,
    },
    recipients,
  );
}
const TRAN_STOP_TRONG_TIN = 12;
/** a2n — the STOPs of a run in an alert's text; null ⇔ central could not read them. Bounded: an alert names, it does not list. */
const stopText = (stops: readonly string[] | null): string =>
  stops === null ? "unknown" : stops.length === 0 ? "none" : stops.length > TRAN_STOP_TRONG_TIN ? `${stops.slice(0, TRAN_STOP_TRONG_TIN).join(", ")} +${stops.length - TRAN_STOP_TRONG_TIN} more` : stops.join(", ");

/**
 * a2n — LAYER 1 of a stalled edge disk: one URGENT per (node, stall). Nothing the edge writes reaches central during it; only `progress` does. The start of
 * the stall is IN the text: the durable dedup also matches an equal (kind, message), which must never swallow a later stall.
 */
export function alertJournalStalled(node: Pick<EdgeNodePrincipal, "nodeId" | "nodeCode">, x: { sinceMs: number; runs: ReadonlyArray<{ runId: number; stops: readonly string[] | null }> }, recipients: () => Promise<number[]>): boolean {
  const list = x.runs.map((r) => `run ${r.runId} (STOP not confirmed: ${stopText(r.stops)})`).join("; ");
  return raiseEdgeConfigAlert(
    {
      kind: "edge_journal_stalled",
      dedupKey: `edge_journal_stalled:${node.nodeId}:${x.sinceMs}`,
      title: `Edge node ${node.nodeCode}: disk not answering, runs are standing`,
      message: `Edge node ${node.nodeCode}: its journal disk has not answered since ${new Date(x.sinceMs).toISOString()} (edge clock). ${list || "No run listed"}. These runs still show running; a STOP behind a standing step waits for the disk. Abort reaches the node only while the node can still call central. If an alert then says a run stopped reporting, use the machine's direct STOP / E-STOP.`,
      nodeId: node.nodeId,
    },
    recipients,
  );
}
function alertJournalStallRecovered(node: Pick<EdgeNodePrincipal, "nodeId" | "nodeCode">, detail: string, recipients: () => Promise<number[]>): boolean {
  const since = /since (\d+)/.exec(detail)?.[1] ?? "unknown";
  const closed = /healthy=false/.test(detail);
  return raiseEdgeConfigAlert(
    {
      kind: "edge_journal_stall_recovered",
      dedupKey: `edge_journal_stall_recovered:${node.nodeId}:${since}`,
      title: `Edge node ${node.nodeCode}: disk answering again`,
      message: `Edge node ${node.nodeCode}: its journal disk answers again (${detail.slice(0, 200)}). ${closed ? "The node still refuses non-STOP commands until it is restarted: it starts no new run and a held run cannot continue on it before that. STOPs and Abort still go." : "Runs go on."}`,
      nodeId: node.nodeId,
    },
    recipients,
  );
}
/**
 * a2n — LAYER 2: a run central holds as running whose node stopped reporting (baoRunMatProgress). Central cannot tell why, and says so: a node that lost its
 * network (D5) lands here too, and that is not a false alarm. It only tells: the run keeps its status. One URGENT per (node, run, claim, last progress): an
 * outage has one last progress, a later one another; it is in the text for the same reason as above.
 */
export function alertRunProgressLost(node: Pick<EdgeNodePrincipal, "nodeId" | "nodeCode">, x: { runId: number; claimSeq: number; status: string; lastProgressMs: number; stops: readonly string[] | null }, recipients: () => Promise<number[]>): boolean {
  return raiseEdgeConfigAlert(
    {
      kind: "edge_run_progress_lost",
      dedupKey: `edge_run_progress_lost:${node.nodeId}:${x.runId}:${x.claimSeq}:${x.lastProgressMs}`,
      title: `Edge node ${node.nodeCode}: run ${x.runId} stopped reporting`,
      message: `Run ${x.runId} on edge node ${node.nodeCode} shows ${x.status} at central but has reported no progress since ${new Date(x.lastProgressMs).toISOString()}. Central cannot tell a lost network from a hung disk or a stopped process, and cannot confirm its STOPs (${stopText(x.stops)}). Abort; if the node does not answer, use the machine's direct STOP / E-STOP.`,
      nodeId: node.nodeId,
    },
    recipients,
  );
}
/** Tests only — the alert queue settled; the per-process memory forgotten (a restart). */
export function __edgeConfigAlertsSettledForTests(): Promise<unknown> {
  return configAlertQueue;
}
export function __resetEdgeConfigAlertsForTests(): void {
  configAlerted.clear();
  configAlertQueue = Promise.resolve();
  unbuildableLogged.clear();
}

type ShippedPlc = Content["safetyPlcConfigs"][number];
/**
 * R1b-2b-2a A2(o) — the safety-PLC section of a node's config: EVERY config the I-3 rule ships for the node, or NOTHING. A config
 * whose shipped form fails the item schema (or whose trust digest cannot be computed) was skipped silently before (a fail-open
 * trap: the edge's preflight then never read it). Now the whole build is REFUSED (EdgeContractError safety_plc_unshippable ⇒
 * configForNode 503, authorize 503 — the served-snapshot check) and an URGENT alert names each config, once per
 * (node, config, trust digest) (raiseEdgeConfigAlert). The node's alerts re-arm when its config is served again (currentNodeConfig).
 */
export async function shipSafetyPlcConfigs(
  node: Pick<EdgeNodePrincipal, "nodeId" | "nodeCode">,
  guarding: ReadonlyArray<SafetyPlcConfig>,
  deps: { digest: (cfg: SafetyPlcConfig) => string; approved: (cfg: SafetyPlcConfig) => Promise<boolean>; recipients: () => Promise<number[]> },
): Promise<ShippedPlc[]> {
  const out: ShippedPlc[] = [];
  const unshippable: Array<{ id: number; code: string; digest: string; issue: string }> = [];
  for (const cfg of guarding) {
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
    let digest: string;
    try {
      digest = deps.digest(cfg);
    } catch (err) {
      unshippable.push({ id: cfg.id, code: String(cfg.code), digest: "none", issue: `trust digest not computable (${String((err as Error)?.message ?? err).slice(0, 120)})` });
      continue;
    }
    const p = edgeConfigSafetyPlcSchema.safeParse({ id: cfg.id, trustDigest: digest, approved: await deps.approved(cfg), config: projection });
    if (p.success) out.push(p.data);
    else unshippable.push({ id: cfg.id, code: String(cfg.code), digest: String(digest).slice(0, 64), issue: `not expressible: ${p.error.issues[0]?.path.join(".") || "?"} ${p.error.issues[0]?.message ?? ""}`.trim() });
  }
  if (unshippable.length === 0) return out;
  const names = unshippable.map((u) => `#${u.id} ${u.code}`).join(", ");
  console.error(`[EdgeConfig] node ${node.nodeCode}: safety-PLC config(s) ${names} cannot be expressed in its config — NO config is served (never a set without them): ${unshippable.map((u) => `#${u.id}: ${u.issue}`).join("; ")}`);
  for (const u of unshippable) {
    raiseEdgeConfigAlert(
      {
        kind: "edge_safety_plc_unshippable",
        dedupKey: `edge_safety_plc_unshippable:${node.nodeId}:${u.id}:${u.digest}`,
        title: `Edge node ${node.nodeCode}: safety-PLC config #${u.id} cannot be shipped`,
        message: `Safety-PLC config #${u.id} (${u.code}) guards devices of edge node ${node.nodeCode} but cannot be expressed in the node's signed config (${u.issue}). Central serves NO config to the node and refuses every non-STOP authorisation for it until the config is fixed (STOPs still go). Fix or disable the safety-PLC config.`,
        nodeId: node.nodeId,
      },
      deps.recipients,
    );
  }
  throw new EdgeContractError("safety_plc_unshippable", `safety-PLC config(s) ${names} of node ${node.nodeCode} cannot be shipped`);
}

/** Build the node's config CONTENT (deterministic for a given DB state + keyring). Throws on a DB error. */
export async function buildNodeConfigContent(d: Db, node: EdgeNodePrincipal): Promise<Content> {
  const signer = centralSigner();
  if (!signer) throw new EdgeContractError("no_signer", "no signer");
  const [nodeRow] = await d.select({ id: edgeNodes.id, code: edgeNodes.code, factoryCode: edgeNodes.factoryCode, lines: edgeNodes.assignedLineCodes }).from(edgeNodes).where(eq(edgeNodes.id, node.nodeId)).limit(1);
  if (!nodeRow) throw new EdgeContractError("node_missing", "node row missing");
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
  let safetyOut: Content["safetyPlcConfigs"] = [];
  if (scope.factoryId !== null && (ownRobots.size > 0 || scope.adapters.length > 0)) {
    const factoryId = scope.factoryId;
    const guarding = (await listPlcConfigs({ onlyEnabled: true })).filter((cfg) => edgePlcConfigGuardsNode(cfg, factoryId, ownRobots, ownStations, ownLines));
    safetyOut = await shipSafetyPlcConfigs(node, guarding, { digest: plcTrustDigest, approved: isPlcConfigTrustApproved, recipients: () => alertRecipients(d) });
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
  /** R-10-au — the node's ownership (device, owner epoch) the config was built for: read LIVE on every call */
  ownershipKey: string;
  contentHash: string;
  version: number;
  envelope: EdgeSignedEnvelope;
  configHash: string;
  builtAt: number;
  credentialId: number;
  /** R1b-2b-2a A2(o) — the safety-PLC config ids THIS envelope ships (authorize signs only ids inside it) */
  safetyPlcConfigIds: number[];
}
const cache = new Map<number, CachedConfig>();
/** Tests only. */
export function __resetEdgeConfigCacheForTests(): void {
  cache.clear();
}

/**
 * R-10-au — the node's ownership RIGHT NOW: every robot / adapter it owns with its owner epoch (one indexed read). A change
 * (a device given / taken / its epoch bumped — a STOP carried to a new owner) makes any cached config stale at once, so the
 * pull's `configVersion` moves in the same answer that carries the STOP. Throws on a DB error.
 */
export async function nodeOwnershipKey(d: Db, nodeId: number): Promise<string> {
  const r = await d.execute(sql`SELECT 'r' AS k, id, "ownerEpoch" AS e FROM robots WHERE "edgeNodeId" = ${nodeId}
                                UNION ALL SELECT 'a' AS k, id, "ownerEpoch" AS e FROM device_adapters WHERE "edgeNodeId" = ${nodeId}
                                ORDER BY 1, 2`);
  const rows = (Array.isArray(r) ? r : ((r as { rows?: unknown[] }).rows ?? [])) as Array<{ k: string; id: number | string; e: number | string | null }>;
  return rows.map((x) => `${x.k}${Number(x.id)}@${x.e == null ? "-" : Number(x.e)}`).join(",");
}

/**
 * The node's current signed config (rebuilt when stale; same content ⇒ same envelope). Throws on a DB / signing error.
 * R-10-au — the cache (EDGE_CONFIG_CACHE_MS) never outlives an ownership change: the ownership key is read live every call.
 */
export async function currentNodeConfig(node: EdgeNodePrincipal, opts: { fresh?: boolean } = {}): Promise<CachedConfig> {
  const prev = cache.get(node.nodeId);
  const d = await centralDb();
  const ownershipKey = await nodeOwnershipKey(d, node.nodeId);
  if (!opts.fresh && prev && prev.credentialId === node.credentialId && prev.ownershipKey === ownershipKey && Date.now() - prev.builtAt < edgeConfigCacheMs()) return served(node, prev);
  const signer = centralSigner();
  if (!signer) throw new EdgeContractError("no_signer", "no signer");
  const content = await buildNodeConfigContent(d, node);
  const contentHash = sha256Hex(edgeCanonicalJson(content));
  if (prev && prev.contentHash === contentHash && prev.credentialId === node.credentialId) {
    const kept = { ...prev, ownershipKey, builtAt: Date.now() };
    cache.set(node.nodeId, kept);
    return served(node, kept);
  }
  const version = Math.max(Math.floor(Date.now() / 1000), (prev?.version ?? 0) + 1);
  const envelope = signForNode(signer, "config", edgeConfigSnapshotSchema, { ...content, configVersion: version, issuedAt: Date.now() }, node);
  const out: CachedConfig = {
    ownershipKey,
    contentHash,
    version,
    envelope,
    configHash: edgeConfigHash(envelope),
    builtAt: Date.now(),
    credentialId: node.credentialId,
    safetyPlcConfigIds: content.safetyPlcConfigs.map((c) => c.id),
  };
  cache.set(node.nodeId, out);
  return served(node, out);
}

/** A2(o) — a config is served again: the node's alerts re-arm and its next build failure is logged again. */
function served(node: EdgeNodePrincipal, c: CachedConfig): CachedConfig {
  if (unbuildableLogged.delete(node.nodeId)) console.log(`[EdgeConfig] config of node ${node.nodeCode} can be built again (v${c.version})`);
  rearmConfigAlerts(node.nodeId);
  return c;
}

/**
 * R1b-2b-2a A2(o) — the safety-PLC config ids of the snapshot central SERVES this node right now: the SAME cached object
 * configForNode serves (currentNodeConfig). Throws when no config can be built (⇒ 503 at the caller, nothing signed).
 */
export async function servedSafetyPlcConfigIds(node: EdgeNodePrincipal): Promise<ReadonlySet<number>> {
  return new Set((await currentNodeConfig(node)).safetyPlcConfigIds);
}

/** node id → the last build failure logged (one line per change, not one per pull) */
const unbuildableLogged = new Map<number, string>();

/**
 * A2(o) / O8 — a config that cannot be built is never reported SILENTLY as configVersion 0: logged once per node and reason
 * (central unreachable ⇒ a warning; anything else ⇒ an error), and a CONTRACT failure (e.g. more than 200 safety-PLC configs —
 * the signed schema refuses the envelope) raises one URGENT alert per (node, code). safety_plc_unshippable alerts per config
 * already (shipSafetyPlcConfigs). Authorize refuses meanwhile (the served-snapshot check throws ⇒ 503).
 */
function noteConfigUnbuildable(node: EdgeNodePrincipal, err: unknown): void {
  const why = String((err as Error)?.message ?? err).slice(0, 300);
  if (unbuildableLogged.get(node.nodeId) === why) return;
  unbuildableLogged.set(node.nodeId, why);
  const unavailable = isEdgeUnavailableError(err);
  const line = `[EdgeConfig] config of node ${node.nodeCode} cannot be built (${why}) — its pull / heartbeat answers carry configVersion 0, the node keeps its previous config, and every non-STOP authorisation for it is refused until it builds`;
  if (unavailable) console.warn(line);
  else console.error(line);
  if (err instanceof EdgeContractError && err.code !== "safety_plc_unshippable" && err.code !== "no_signer") {
    raiseEdgeConfigAlert(
      {
        kind: "edge_config_unbuildable",
        dedupKey: `edge_config_unbuildable:${node.nodeId}:${err.code}`,
        title: `Edge node ${node.nodeCode}: its signed config cannot be built`,
        message: `Central cannot build the signed config of edge node ${node.nodeCode} (${err.code}). The node keeps its previous config and every non-STOP authorisation for it is refused until the config builds again (STOPs still go). Check the node's devices and safety-PLC configs (at most 200 per node).`,
        nodeId: node.nodeId,
      },
      async () => alertRecipients(await centralDb()),
    );
  }
}

/** configVersion for heartbeat / pull answers (0 when it cannot be built now — the edge keeps what it has; never silent, O8). */
export async function currentConfigVersion(node: EdgeNodePrincipal): Promise<number> {
  try {
    return (await currentNodeConfig(node)).version;
  } catch (err) {
    noteConfigUnbuildable(node, err);
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
