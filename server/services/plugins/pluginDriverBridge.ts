/**
 * Plugin ⇄ OT driver bridge — doc 37 P0-4 (SYNAPSE ADR-008: "thêm hãng = 1 plugin").
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Closes the last gap that kept plugins from being real drivers: the sidecar transport
 * (nodeSpawner + stdioTransport) worked but NOTHING read it, and ot/driverRegistry never
 * imported plugins — so adding a vendor still meant editing the OT core, and the
 * test-only lifecycle/quota/signature guards were never on the spawn path.
 *
 * This module provides `createPluginDriver(manifest)`: a normal {@link OtDriver} whose
 * connect/readTags/writeTags/health are PROXIED over stdio JSON-lines RPC to an
 * out-of-process sidecar. The sidecar process is run under {@link PluginSupervisor}
 * (crash → backoff restart + circuit-break). The spawn path enforces, IN ORDER:
 *   (a) pluginLifecycle: validate → validated → canRun BEFORE any spawn (hard gate),
 *   (b) verifyPluginSignature: fail-CLOSED when a signature is required (production),
 *   (c) pluginQuota: a token-bucket message-rate limit + a per-call timeout on EVERY RPC.
 * A sidecar fault NEVER fakes success — readTags/writeTags THROW (driver offline) and the
 * supervisor / OT connection supervisor drive recovery.
 *
 * WRITE-GATE: this proxy adds NO direct write path. driver.writeTags is reachable ONLY
 * through commandDispatcher.dispatch() exactly like the 6 built-in drivers (getActiveDriver
 * → dispatch is the single caller), so every plugin write still passes the full HITL /
 * commissioning / interlock / mode gates. See ot/commandDispatcher.ts.
 *
 * `registerPluginDrivers()` wires manifests into ot/driverRegistry (flag-gated). Adding a
 * hãng = one PLUGIN_DRIVERS JSON entry; the OT core is untouched.
 * ════════════════════════════════════════════════════════════════════════════
 */
import type {
  OtDriver,
  OtProtocol,
  OtConnectionConfig,
  OtTagAddress,
  OtSample,
  OtWrite,
  OtCommandResult,
  OtHealth,
  OnOtSample,
  OtSubscriptionHandle,
} from "../ot/otDriver";
import { registerDriver, listProtocols } from "../ot/driverRegistry";
import { tryRegisterPlugin, listPluginsByKind } from "./pluginRegistry";
import {
  parsePluginDriverManifests,
  hasSidecar,
  type PluginDriverManifest,
} from "./pluginDriverManifests";
import { PluginSupervisor, DEFAULT_RESTART_POLICY, type ChildHandle } from "./sidecar/pluginSupervisor";
import { createSupervisedTransportSpawner } from "./sidecar/nodeSpawner";
import type { StdioTransport } from "./sidecar/stdioTransport";
import { transition, canRun, type PluginPhase, type TransitionResult } from "./sidecar/pluginLifecycle";
import { verifyPluginSignature, type SignedPlugin } from "./sidecar/pluginSignature";
import { createBucket, tryConsume, withTimeout, type RateLimiterConfig, type RateLimiterState } from "./sidecar/pluginQuota";

/** Master flag — default OFF. When off, registerPluginDrivers is a no-op (built-ins untouched). */
export function pluginDriversEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.PLUGIN_DRIVERS_ENABLED === "true";
}

/**
 * Whether a plugin artifact MUST be signed to spawn. PLUGIN_SIGNATURE_REQUIRED overrides
 * ("true"/"false"); otherwise fail-closed in production (NODE_ENV === "production").
 */
export function signatureRequiredInProduction(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.PLUGIN_SIGNATURE_REQUIRED === "true") return true;
  if (env.PLUGIN_SIGNATURE_REQUIRED === "false") return false;
  return env.NODE_ENV === "production";
}

function intEnv(v: string | undefined, def: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : def;
}

function errMsg(err: unknown): string {
  return (err as Error)?.message || String(err);
}

/** Assert a lifecycle transition is legal and return the next phase (guards the spawn gate). */
function requirePhase(res: TransitionResult): PluginPhase {
  if (!res.ok || !res.to) throw new Error(res.error ?? "illegal plugin lifecycle transition");
  return res.to;
}

/** Options resolved once at registration and shared by a driver's whole lifecycle. */
export interface PluginDriverOptions {
  /** PEM public key of the trusted publisher (env PLUGIN_PUBLISHER_PUBLIC_KEY_PEM). */
  publisherPublicKeyPem: string | null;
  /** Whether an unsigned/invalid artifact is refused at spawn (fail-closed). */
  requireSignature: boolean;
  /** Per-RPC timeout (ms). */
  callTimeoutMs: number;
  /** Token-bucket rate limit for Hub→plugin messages. */
  rate: RateLimiterConfig;
}

function resolveOptions(env: NodeJS.ProcessEnv): PluginDriverOptions {
  return {
    publisherPublicKeyPem: env.PLUGIN_PUBLISHER_PUBLIC_KEY_PEM ?? null,
    requireSignature: signatureRequiredInProduction(env),
    callTimeoutMs: intEnv(env.PLUGIN_CALL_TIMEOUT_MS, 5000),
    rate: {
      capacity: intEnv(env.PLUGIN_RATE_BURST, 100),
      refillPerSec: intEnv(env.PLUGIN_RATE_PER_SEC, 50),
    },
  };
}

/**
 * The RPC contract (JSON-lines over stdio; correlated by id) a device-connector sidecar MUST speak.
 * Request { id, method, params } → response { id, result | error }. Methods:
 *   connect(cfg: OtConnectionConfig) → any            establish the device connection
 *   readTags(tags: OtTagAddress[])   → OtSample[]      (timestamp as ISO string; revived to Date)
 *   writeTags(writes: OtWrite[])     → OtCommandResult[]  (reached ONLY via commandDispatcher)
 *   health()                         → { connected?: boolean; latencyMs?: number }
 *   disconnect()                     → any
 * `subscribe` is NOT an RPC method: the bridge polls readTags on an interval (fewer sidecar
 * assumptions; one code path for reads).
 */
const RPC = {
  connect: "connect",
  readTags: "readTags",
  writeTags: "writeTags",
  health: "health",
  disconnect: "disconnect",
} as const;

/** Raw sample shape a sidecar returns (timestamp is an ISO string on the wire). */
interface WireSample {
  tagKey: string;
  raw?: unknown;
  value: number | string | boolean | null;
  quality?: OtSample["quality"];
  timestamp?: string | number;
}

/**
 * An OtDriver that proxies to an out-of-process sidecar. One instance ↔ one supervised process.
 * The OT ConnectionSupervisor reuses one driver instance across reconnects (calling connect() to
 * respawn), and the internal PluginSupervisor keeps the child alive between those calls.
 */
class PluginSidecarDriver implements OtDriver {
  readonly protocol: OtProtocol;

  private supervisor: PluginSupervisor | null = null;
  private transport: StdioTransport | null = null;
  private connected = false;
  private stopped = false;
  private handshakeDone = false;
  private lastConfig: OtConnectionConfig | null = null;
  private lastError: string | null = null;
  private bucket: RateLimiterState;

  private readonly signed: SignedPlugin;

  constructor(
    private readonly manifest: PluginDriverManifest,
    private readonly opts: PluginDriverOptions,
  ) {
    // A plugin protocol is an arbitrary vendor string; the registry Map is keyed by string at
    // runtime so the cast is safe (the OtProtocol union is only a compile-time convenience).
    this.protocol = (manifest.protocols?.[0] ?? "stub") as OtProtocol;
    this.signed = manifest.signed;
    this.bucket = createBucket(opts.rate, Date.now());
  }

  async connect(cfg: OtConnectionConfig): Promise<void> {
    this.lastConfig = cfg;

    // Idempotent: OT ConnectionSupervisor may call connect() again on the SAME instance. If the
    // process is already supervised, just (re)handshake rather than spawning a second child.
    if (this.supervisor && !this.stopped) {
      await this.handshake(cfg);
      return;
    }

    // ── GATE (a) + (b): lifecycle validate → signature (fail-closed) → validated → canRun. ──
    let phase: PluginPhase = "configured";
    phase = requirePhase(transition(phase, "validate")); // validating

    const verdict = verifyPluginSignature(this.signed, this.opts.publisherPublicKeyPem, {
      requireSignature: this.opts.requireSignature,
    });
    if (!verdict.ok) {
      requirePhase(transition(phase, "validate_fail")); // failed
      throw new Error(`plugin "${this.manifest.id}" signature gate: ${verdict.reason}`);
    }
    phase = requirePhase(transition(phase, "validate_ok")); // validated

    // The hard gate: never spawn from a phase that cannot legally reach `running`.
    if (!canRun(phase)) {
      throw new Error(`plugin "${this.manifest.id}" not runnable from phase "${phase}"`);
    }

    // ── Spawn under the supervisor; wire a fresh transport on every (re)spawn. ──
    this.stopped = false;
    this.handshakeDone = false;
    this.bucket = createBucket(this.opts.rate, Date.now());
    const spawner = createSupervisedTransportSpawner(
      (transport, handle) => this.onFreshTransport(transport, handle),
      { timeoutMs: this.opts.callTimeoutMs },
    );
    const supervisor = new PluginSupervisor(
      { pluginId: this.manifest.id, command: this.manifest.sidecar.command, args: this.manifest.sidecar.args },
      {
        spawn: spawner,
        schedule: (fn, ms) => {
          const t = setTimeout(fn, ms);
          if (typeof t.unref === "function") t.unref();
          return { cancel: () => clearTimeout(t) };
        },
        now: () => Date.now(),
        onIncident: (id, reason) =>
          console.error(`[PluginDriver] sidecar "${id}" circuit-open — offline: ${reason}`),
      },
      DEFAULT_RESTART_POLICY,
    );
    requirePhase(transition(phase, "run")); // running (asserts the transition is legal)
    this.supervisor = supervisor;
    supervisor.start(); // synchronous spawn → onFreshTransport sets this.transport

    try {
      await this.handshake(cfg);
    } catch (err) {
      // Fail-safe: if the initial handshake fails, tear the supervisor down so no orphaned
      // child churns in the background; the OT layer treats a connect() throw as offline.
      this.lastError = errMsg(err);
      await this.disconnect();
      throw err;
    }
  }

  /** Called on the initial spawn AND every watchdog restart (fresh child ⇒ fresh transport). */
  private onFreshTransport(transport: StdioTransport, handle: ChildHandle): void {
    this.transport = transport;
    this.connected = false; // not usable until the connect handshake completes
    handle.onExit(() => {
      if (this.transport === transport) {
        this.transport = null;
        this.connected = false;
      }
    });
    // On a RESTART (initial handshake already succeeded once) re-establish the device connection
    // automatically. The initial connect() awaits its handshake explicitly, so skip it here.
    if (this.handshakeDone && !this.stopped && this.lastConfig) {
      this.handshake(this.lastConfig).catch((err) => {
        this.lastError = errMsg(err);
      });
    }
  }

  private async handshake(cfg: OtConnectionConfig): Promise<void> {
    await this.call(RPC.connect, cfg);
    this.connected = true;
    this.handshakeDone = true;
    this.lastError = null;
  }

  /** One Hub→plugin RPC, bounded by BOTH the rate limiter (b) and the call timeout (c). */
  private async call<T = unknown>(method: string, params?: unknown): Promise<T> {
    const transport = this.transport;
    if (!transport) throw new Error(`plugin "${this.manifest.id}" offline (no sidecar transport)`);

    // (c) pluginQuota — token-bucket message-rate limit (never fabricated: reject, don't queue).
    const now = Date.now();
    const consumed = tryConsume(this.bucket, this.opts.rate, now);
    this.bucket = consumed.state;
    if (!consumed.allowed) {
      throw new Error(`plugin "${this.manifest.id}" rate limit exceeded (${this.opts.rate.refillPerSec}/s)`);
    }

    // (c) per-call timeout — a hung plugin can never block the Hub.
    return withTimeout(transport.request<T>(method, params), this.opts.callTimeoutMs);
  }

  isConnected(): boolean {
    return this.connected && this.transport !== null;
  }

  async readTags(tags: OtTagAddress[]): Promise<OtSample[]> {
    if (!this.isConnected()) throw new Error(`plugin "${this.manifest.id}" offline — readTags refused`);
    const raw = await this.call<WireSample[]>(RPC.readTags, tags);
    const arr = Array.isArray(raw) ? raw : [];
    return arr.map((s) => ({
      tagKey: s.tagKey,
      raw: s.raw ?? s.value,
      value: s.value ?? null,
      quality: s.quality ?? "good",
      timestamp: s.timestamp != null ? new Date(s.timestamp) : new Date(),
    }));
  }

  /**
   * WRITE-GATE: reached ONLY via commandDispatcher.dispatch() (the single caller of any
   * driver.writeTags). No plugin-specific write path exists. Proxies to the sidecar; a fault
   * throws (dispatch records 'failed'/'timeout') — success is never fabricated.
   */
  async writeTags(writes: OtWrite[]): Promise<OtCommandResult[]> {
    if (!this.isConnected()) throw new Error(`plugin "${this.manifest.id}" offline — writeTags refused`);
    const raw = await this.call<OtCommandResult[]>(RPC.writeTags, writes);
    return Array.isArray(raw) ? raw : [];
  }

  /** Poll-based subscription over the same readTags RPC (fail-safe: a bad poll never crashes). */
  async subscribe(tags: OtTagAddress[], onSample: OnOtSample, intervalMs?: number): Promise<OtSubscriptionHandle> {
    const iv = intervalMs && intervalMs > 0 ? intervalMs : 1000;
    const timer = setInterval(() => {
      this.readTags(tags)
        .then((samples) => {
          for (const s of samples) void onSample(s);
        })
        .catch(() => {
          /* offline / transient — the connection supervisor drives recovery, not this poll */
        });
    }, iv);
    if (typeof (timer as { unref?: () => void }).unref === "function") (timer as { unref: () => void }).unref();
    return { close: async () => clearInterval(timer) };
  }

  async health(): Promise<OtHealth> {
    if (!this.isConnected()) {
      return { protocol: this.protocol, connected: false, lastError: this.lastError ?? "offline" };
    }
    const t0 = Date.now();
    try {
      const raw = await this.call<{ connected?: boolean; latencyMs?: number }>(RPC.health);
      const ok = raw?.connected !== false;
      if (!ok) this.connected = false;
      return {
        protocol: this.protocol,
        connected: ok,
        lastOkAt: ok ? new Date() : undefined,
        latencyMs: raw?.latencyMs ?? Date.now() - t0,
      };
    } catch (err) {
      // A failed health probe marks the driver offline so the OT supervisor reconnects.
      this.connected = false;
      this.lastError = errMsg(err);
      return { protocol: this.protocol, connected: false, lastError: this.lastError };
    }
  }

  async disconnect(): Promise<void> {
    this.stopped = true;
    this.connected = false;
    this.handshakeDone = false;
    // Best-effort graceful RPC before killing the process (ignore failures).
    if (this.transport) {
      try {
        await this.call(RPC.disconnect);
      } catch {
        /* ignore — we are tearing down anyway */
      }
    }
    if (this.supervisor) {
      this.supervisor.stop();
      this.supervisor = null;
    }
    if (this.transport) {
      this.transport.close();
      this.transport = null;
    }
  }
}

/** Factory (matches OtDriverFactory) — a fresh supervised sidecar driver per call. */
export function createPluginDriver(manifest: PluginDriverManifest, opts: PluginDriverOptions): OtDriver {
  return new PluginSidecarDriver(manifest, opts);
}

export interface RegisterResult {
  registered: string[];
  skipped: Array<{ id: string; reason: string }>;
}

/**
 * Wire every declared plugin device-connector into ot/driverRegistry — doc 37 P0-4.
 *
 * Steps: (1) parse PLUGIN_DRIVERS → manifests; (2) seed each into the plugin catalogue via
 * tryRegisterPlugin (runs the apiVersion + catalogue signature gate; the sidecar/signed fields
 * ride along on the stored object); (3) read back kind='device-connector' manifests that carry a
 * sidecar and registerDriver(protocol, () => createPluginDriver(...)).
 *
 * A protocol already served by a BUILT-IN driver is left untouched (skipped) so the 6 built-ins
 * stay intact even when the flag is on. Called ONLY when pluginDriversEnabled() — otherwise a no-op.
 */
export function registerPluginDrivers(env: NodeJS.ProcessEnv = process.env): RegisterResult {
  const result: RegisterResult = { registered: [], skipped: [] };
  const opts = resolveOptions(env);
  const builtins = new Set<string>(listProtocols());

  // (1)+(2) — seed manifests into the catalogue (validates apiVersion + signature presence).
  for (const manifest of parsePluginDriverManifests(env)) {
    const res = tryRegisterPlugin(manifest, { requireSignature: opts.requireSignature });
    if (!res.ok) {
      result.skipped.push({ id: manifest.id, reason: `manifest rejected: ${res.errors.join("; ")}` });
    }
  }

  // (3) — bind catalogued device-connectors that carry a sidecar to the OT driver registry.
  for (const manifest of listPluginsByKind("device-connector")) {
    if (!hasSidecar(manifest)) continue; // built-in OT connector manifests have no sidecar → skip
    const dm = manifest as PluginDriverManifest;
    if (result.skipped.some((s) => s.id === dm.id)) continue; // already rejected above

    const protocol = dm.protocols?.[0];
    if (!protocol) {
      result.skipped.push({ id: dm.id, reason: "no protocol declared" });
      continue;
    }
    if (builtins.has(protocol)) {
      result.skipped.push({ id: dm.id, reason: `protocol "${protocol}" is a built-in driver — preserved (not overridden)` });
      continue;
    }
    registerDriver(protocol as OtProtocol, () => createPluginDriver(dm, opts));
    builtins.add(protocol); // guard against two plugins claiming the same new protocol
    result.registered.push(dm.id);
  }

  return result;
}
