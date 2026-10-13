/**
 * doc 81 Đợt 10 task E (design §2.4, D4, D9, D13, D14) — the edge's CONFIG SOURCE: everything the edge used to read from the
 * central DB (its node identity, its adapters + tags + STOP pins, its robots + motion-lock rows, the machines they reference,
 * the safety-PLC configs guarding them, the limits) now comes from ONE signed config snapshot fetched with the node
 * credential (POST /edge/node/config).
 *
 *   • TRUST: the keyset is pinned at provisioning (EDGE_KEYSET_PIN_FILE, written by `edge-signing-key.ts pin`); after that only
 *     keyset updates chained from a trusted key are accepted (EdgeTrustStore). Accepted updates are persisted
 *     (`keyset-updates.json`, atomic) and replayed at boot; a persisted chain the pin no longer accepts is dropped (pin only).
 *   • VERIFY: signature + node + the PROVISIONED credential id + no version rollback below the last ACCEPTED version (persisted
 *     in `config-state.json`, R-10-f) — an unverified config is never used. The answer's configHash must hash the envelope.
 *   • CACHE: the last verified envelope is cached AES-256-GCM under HKDF(node credential) (`config.cache`), so an edge that
 *     restarts while central is down still knows its own devices (STOP pins, robots) — and it is VERIFIED AGAIN when loaded.
 *     Rotating the node credential makes the cache unreadable (by design: it is bound to the credential) — the next boot then
 *     needs central (or a fresh cache) before it starts any device.
 *   • SOURCES: runtime adapters for the OT manager (ot/deviceAdapter.setAdapterSource), robots / safety-PLC configs for group
 *     D's seams, `owns*()` lookups. Device secrets exist only for the node's own devices (central decrypts, D4); the edge never
 *     holds SECRET_ENCRYPTION_KEY.
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { writeFileAtomic } from "../ot/storeForward";
import { parseBackupConnection, type RuntimeAdapter } from "../ot/deviceAdapter";
import type { OtProtocol, OtTagAddress } from "../ot/otDriver";
import { edgeTrustAdapter, type EdgeCentralClient } from "./edgeCentralClient";
import { edgeConfigHash, type EdgeConfigSnapshot } from "./edgeProtocol";
import { EdgeContractError, EdgeTrustStore, parseEdgeCanonicalJson, type EdgeSignedEnvelope } from "./edgeSigning";

export type EdgeConfigAdapter = EdgeConfigSnapshot["adapters"][number];
export type EdgeConfigRobot = EdgeConfigSnapshot["robots"][number];
export type EdgeConfigLimits = EdgeConfigSnapshot["limits"];

export const EDGE_CONFIG_CACHE_FILE = "config.cache";
export const EDGE_KEYSET_UPDATES_FILE = "keyset-updates.json";
/** the configVersion of the last ACCEPTED config (R-10-f: the rollback check needs it across restarts) */
export const EDGE_CONFIG_STATE_FILE = "config-state.json";

export interface EdgeConfigSourceOptions {
  client: EdgeCentralClient;
  /** the provisioning pin FILE (edge-keyset.json, `edge-signing-key.ts pin`) — loaded with EdgeTrustStore.fromPinFile */
  pinFile?: string;
  /** or the pin itself (tests) — `{ kind: "avi-edge-pin+v1", keyset }` */
  pin?: unknown;
  /** this node's id (provisioned with the credential bundle) */
  nodeId: number;
  /** this node's credential id (provisioned with the bundle) — every signed object must name it (R-10-f) */
  credentialId: number;
  /** the node credential — only to derive the cache key */
  credential: string;
  /** where the cache + persisted keyset chain live (the journal volume) */
  dir: string;
  /** fix review 1 (M-6) — a rollback floor kept elsewhere (the journal's last accepted config version); never lowers it */
  floorVersion?: number | null;
  now?: () => number;
  skewMs?: number;
  log?: (msg: string) => void;
}

export type EdgeConfigRefresh = { ok: true; changed: boolean; version: number } | { ok: false; reason: string; unavailable: boolean };

function cacheKey(credential: string): Buffer {
  return Buffer.from(hkdfSync("sha256", Buffer.from(credential, "utf8"), Buffer.from("avi-edge-config-cache", "utf8"), Buffer.from("v1", "utf8"), 32));
}
export function sealEdgeConfigCache(credential: string, envelope: EdgeSignedEnvelope): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", cacheKey(credential), iv);
  const ct = Buffer.concat([c.update(JSON.stringify(envelope), "utf8"), c.final()]);
  return JSON.stringify({ v: 1, iv: iv.toString("base64"), tag: c.getAuthTag().toString("base64"), ct: ct.toString("base64") }) + "\n";
}
export function openEdgeConfigCache(credential: string, text: string): unknown {
  const o = JSON.parse(text) as { v?: unknown; iv?: unknown; tag?: unknown; ct?: unknown };
  if (o?.v !== 1 || typeof o.iv !== "string" || typeof o.tag !== "string" || typeof o.ct !== "string") throw new EdgeContractError("cache_format", "cache format");
  const d = createDecipheriv("aes-256-gcm", cacheKey(credential), Buffer.from(o.iv, "base64"));
  d.setAuthTag(Buffer.from(o.tag, "base64"));
  return JSON.parse(Buffer.concat([d.update(Buffer.from(o.ct, "base64")), d.final()]).toString("utf8"));
}

/** Runtime adapters (enabled, enabled tags) from a verified config — the OT manager's source on the edge. */
export function configAdaptersToRuntime(config: EdgeConfigSnapshot, createDriver: (p: OtProtocol) => RuntimeAdapter["driver"]): RuntimeAdapter[] {
  const out: RuntimeAdapter[] = [];
  for (const a of config.adapters) {
    if (!a.isEnabled) continue;
    const tags: OtTagAddress[] = a.tags
      .filter((t) => t.isEnabled)
      .map((t) => ({
        tagKey: t.tagKey,
        address: t.address,
        dataType: t.dataType,
        scale: t.scale ?? undefined,
        offset: t.offset ?? undefined,
        writable: t.writable,
      }));
    const protocol = a.protocol as OtProtocol;
    const options = (a.connectionOptions as Record<string, unknown> | null) ?? undefined;
    out.push({
      adapterId: a.id,
      code: a.code,
      machineId: a.machineId,
      protocol,
      connection: { endpoint: a.endpoint, options, timeoutMs: undefined },
      pollIntervalMs: a.pollIntervalMs,
      tags,
      driver: createDriver(protocol),
      backupConnection: parseBackupConnection(options),
    });
  }
  return out;
}

export class EdgeConfigSource {
  private store: EdgeTrustStore;
  private config: EdgeConfigSnapshot | null = null;
  private envelope: EdgeSignedEnvelope | null = null;
  private hashValue: string | null = null;
  private lastAccepted: number | null = null;
  private readonly listeners = new Set<(c: EdgeConfigSnapshot) => void>();
  private readonly log: (m: string) => void;

  private constructor(private readonly opts: EdgeConfigSourceOptions, store: EdgeTrustStore) {
    this.store = store;
    this.log = opts.log ?? ((m) => console.warn(m));
  }

  /** Build the trust store from the pin (+ the persisted chain). Throws when the PIN itself is refused (fail-closed). */
  static async create(opts: EdgeConfigSourceOptions): Promise<EdgeConfigSource> {
    const trustOpts = { nodeId: opts.nodeId, now: opts.now, skewMs: opts.skewMs };
    let updates: unknown[] = [];
    try {
      const raw = JSON.parse(await fs.readFile(path.join(opts.dir, EDGE_KEYSET_UPDATES_FILE), "utf8")) as unknown;
      if (Array.isArray(raw)) updates = raw;
    } catch {
      updates = [];
    }
    const fromPin = (u: unknown[]) => (opts.pinFile ? EdgeTrustStore.fromPinFile(opts.pinFile, trustOpts, u) : EdgeTrustStore.fromPinned(opts.pin, trustOpts, u));
    let store: EdgeTrustStore;
    try {
      store = fromPin(updates);
    } catch (err) {
      if (updates.length === 0) throw err;
      (opts.log ?? console.warn)(`[EdgeConfig] persisted keyset chain refused by the pin (${(err as Error)?.message}) — starting from the pin only`);
      store = fromPin([]);
    }
    const src = new EdgeConfigSource(opts, store);
    // the rollback floor (fix review 1, M-6) = the highest of: config-state.json, the journal's floor, the version of the
    // VERIFIED cache — a lost / corrupt config-state.json never lowers it; null only when none of them knows a config
    const floors: number[] = [];
    try {
      const st = JSON.parse(await fs.readFile(path.join(opts.dir, EDGE_CONFIG_STATE_FILE), "utf8")) as { lastConfigVersion?: unknown };
      if (typeof st?.lastConfigVersion === "number" && Number.isSafeInteger(st.lastConfigVersion) && st.lastConfigVersion > 0) floors.push(st.lastConfigVersion);
    } catch {
      /* missing / corrupt — the other floors decide */
    }
    if (typeof opts.floorVersion === "number" && Number.isSafeInteger(opts.floorVersion) && opts.floorVersion > 0) floors.push(opts.floorVersion);
    try {
      const env = openEdgeConfigCache(opts.credential, await fs.readFile(path.join(opts.dir, EDGE_CONFIG_CACHE_FILE), "utf8"));
      const v = edgeTrustAdapter.config(store, env, { credentialId: opts.credentialId, lastConfigVersion: null });
      if (v.ok) floors.push(v.config.configVersion);
    } catch {
      /* no cache (or a credential rotation made it unreadable — expected: the cache is bound to the credential) */
    }
    src.lastAccepted = floors.length > 0 ? Math.max(...floors) : null;
    return src;
  }

  trust(): EdgeTrustStore {
    return this.store;
  }
  current(): EdgeConfigSnapshot | null {
    return this.config;
  }
  hash(): string | null {
    return this.hashValue;
  }
  version(): number {
    return this.config?.configVersion ?? 0;
  }
  /** the provisioned credential id (a verified config always names the same one) */
  credentialId(): number {
    return this.opts.credentialId;
  }
  limits(): EdgeConfigLimits | null {
    return this.config?.limits ?? null;
  }
  onChange(cb: (c: EdgeConfigSnapshot) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }
  adapter(id: number): EdgeConfigAdapter | undefined {
    return this.config?.adapters.find((a) => a.id === id);
  }
  robot(id: number): EdgeConfigRobot | undefined {
    return this.config?.robots.find((r) => r.id === id);
  }
  ownsAdapter(id: number): boolean {
    return this.adapter(id) !== undefined;
  }
  ownsRobot(id: number): boolean {
    return this.robot(id) !== undefined;
  }
  robots(): EdgeConfigRobot[] {
    return [...(this.config?.robots ?? [])];
  }
  safetyPlcConfigs(): EdgeConfigSnapshot["safetyPlcConfigs"] {
    return [...(this.config?.safetyPlcConfigs ?? [])];
  }

  /**
   * Verify an envelope and adopt it. The embedded keyset is offered to the trust store FIRST (it is itself signed by a key
   * already trusted — a chain update), so a config signed by a freshly rotated key verifies.
   */
  private adopt(env: unknown, source: "central" | "cache"): { ok: true; changed: boolean } | { ok: false; reason: string } {
    try {
      const payload = parseEdgeCanonicalJson(String((env as { payload?: unknown })?.payload ?? "")) as { keyset?: unknown } | null;
      if (payload && typeof payload === "object" && payload.keyset !== undefined) {
        const k = edgeTrustAdapter.keysetUpdate(this.store, payload.keyset);
        if (!k.ok && k.reason !== "rollback") this.log(`[EdgeConfig] keyset update in the ${source} config refused (${k.reason})`);
      }
    } catch {
      /* the verification below refuses a malformed envelope */
    }
    const v = edgeTrustAdapter.config(this.store, env, { credentialId: this.opts.credentialId, lastConfigVersion: Math.max(this.lastAccepted ?? 0, this.config?.configVersion ?? 0) || null });
    if (!v.ok) return { ok: false, reason: v.reason };
    this.lastAccepted = Math.max(this.lastAccepted ?? 0, v.config.configVersion);
    const hash = edgeConfigHash(env as EdgeSignedEnvelope);
    const changed = hash !== this.hashValue;
    this.config = v.config;
    this.envelope = env as EdgeSignedEnvelope;
    this.hashValue = hash;
    if (changed) {
      for (const l of this.listeners) {
        try {
          l(v.config);
        } catch (err) {
          this.log(`[EdgeConfig] config listener failed: ${(err as Error)?.message ?? err}`);
        }
      }
    }
    return { ok: true, changed };
  }

  /** Load + RE-VERIFY the encrypted cache (boot while central is down). false ⇔ no usable cache. */
  async loadCached(): Promise<boolean> {
    let env: unknown;
    try {
      env = openEdgeConfigCache(this.opts.credential, await fs.readFile(path.join(this.opts.dir, EDGE_CONFIG_CACHE_FILE), "utf8"));
    } catch {
      return false;
    }
    const r = this.adopt(env, "cache");
    if (!r.ok) {
      this.log(`[EdgeConfig] cached config not used — verification failed (${r.reason})`);
      return false;
    }
    this.log(`[EdgeConfig] using the cached config v${this.version()} (verified again) until central answers`);
    return true;
  }

  /** Fetch from central (If-None-Match by hash), verify, adopt, persist cache + keyset chain. Never throws. */
  async refresh(): Promise<EdgeConfigRefresh> {
    const r = await this.opts.client.post("config", { configHash: this.hashValue });
    if (!r.ok) return { ok: false, reason: r.code ?? `HTTP ${r.status || "network"}`, unavailable: r.unavailable };
    if ("notModified" in r.data) {
      if (this.hashValue !== null && r.data.configHash === this.hashValue) return { ok: true, changed: false, version: this.version() };
      return { ok: false, reason: "not_modified_for_unknown_hash", unavailable: false };
    }
    const env = r.data.config;
    let hash: string;
    try {
      hash = edgeConfigHash(env);
    } catch {
      return { ok: false, reason: "malformed", unavailable: false };
    }
    if (hash !== r.data.configHash) return { ok: false, reason: "config_hash_mismatch", unavailable: false };
    const before = this.store.version;
    const a = this.adopt(env, "central");
    if (!a.ok) {
      this.log(`[EdgeConfig] config from central REFUSED (${a.reason}) — the previous verified config stays in use`);
      return { ok: false, reason: a.reason, unavailable: false };
    }
    try {
      if (this.store.version !== before) await writeFileAtomic(path.join(this.opts.dir, EDGE_KEYSET_UPDATES_FILE), JSON.stringify(this.store.acceptedUpdates()) + "\n");
      if (a.changed && this.envelope) {
        // cache FIRST: a failed state write can then never make the cache refuse itself as a rollback (M-6)
        await writeFileAtomic(path.join(this.opts.dir, EDGE_CONFIG_CACHE_FILE), sealEdgeConfigCache(this.opts.credential, this.envelope));
        await writeFileAtomic(path.join(this.opts.dir, EDGE_CONFIG_STATE_FILE), JSON.stringify({ lastConfigVersion: this.lastAccepted }) + "\n");
      }
    } catch (err) {
      this.log(`[EdgeConfig] config cache / keyset chain not persisted: ${(err as Error)?.message ?? err}`);
    }
    return { ok: true, changed: a.changed, version: this.version() };
  }
}
