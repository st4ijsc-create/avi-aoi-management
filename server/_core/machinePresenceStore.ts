/**
 * Machine presence store — SHARED, multi-instance-safe (doc 51 §5.3 P2).
 *
 * PROBLEM (before): machine online-presence lived ONLY in per-process Maps in
 * socket.ts (`connectedMachines` / `onlineMachineCodesMap`). Behind a load
 * balancer with ≥2 app instances each instance only saw the machines whose
 * socket happened to land on it, so `admin:get_online_machines` under-reported
 * the fleet, and a restart wiped presence entirely.
 *
 * FIX: mirror presence into a store that every instance shares. When REDIS_URL
 * is configured we use Redis (one key per machine + TTL, refreshed by the
 * machine heartbeat — a silently-dead machine self-expires like the MQTT
 * stale-checker). When Redis is NOT configured we fall back to a process-local
 * in-memory map (identical behaviour to the legacy single-instance path — dev
 * and single-node deployments are unaffected).
 *
 * DESIGN NOTES / honest limitations:
 *  - The per-socket Maps in socket.ts STAY (they remain the local source of
 *    truth for socketId identity guards + the disconnect reverse-lookup, which
 *    are inherently per-instance). This store is an ADDITIVE global mirror that
 *    the fleet-wide readers consult. Both are updated at the same call sites.
 *  - Consistency is eventual, bounded by PRESENCE_TTL_SEC. A machine that dies
 *    without a clean disconnect drops out after at most one TTL window (not
 *    real-time). This matches the existing heartbeat/stale-check model.
 *  - `setOffline` is guarded by the owning socketId so a machine that migrates
 *    A→B (LB reroute) is not knocked offline when its OLD socket on instance A
 *    later disconnects (the delete only fires when the stored socketId still
 *    matches the disconnecting one).
 */

import Redis from "ioredis";
import { nanoid } from "nanoid";

export interface MachinePresenceEntry {
  machineId: number;
  machineCode: string;
  socketId?: string;
  ipAddress?: string;
  /** Which app instance currently holds this machine's socket. */
  instanceId?: string;
  /** Epoch milliseconds of the last heartbeat / registration. */
  lastHeartbeat: number;
  status?: string;
}

export interface MachinePresenceStore {
  /** "redis" (shared across instances) or "memory" (process-local fallback). */
  readonly backend: "redis" | "memory";
  /** Mark a machine online (register / sync-start). Writes a full entry + TTL. */
  setOnline(entry: MachinePresenceEntry): Promise<void>;
  /** Refresh TTL on heartbeat. Re-writes the entry so lastHeartbeat advances. */
  refresh(entry: MachinePresenceEntry): Promise<void>;
  /**
   * Mark a machine offline. When `socketId` is given the removal only happens
   * if the stored entry still belongs to that socket (migration-safe).
   */
  setOffline(machineId: number, socketId?: string): Promise<void>;
  /** Fleet-wide union of currently-online machines (across all instances). */
  listOnline(): Promise<MachinePresenceEntry[]>;
  /** Fleet-wide union of online machine CODES (what get_online_machines emits). */
  listOnlineCodes(): Promise<string[]>;
  /** True when the machine is online on ANY instance. */
  isOnline(machineId: number): Promise<boolean>;
  /** Test/shutdown helper — drop all presence rows this store can see. */
  clear(): Promise<void>;
}

/** Minimal subset of ioredis this store depends on (keeps it mockable). */
export interface RedisLike {
  set(key: string, value: string, mode: "EX", seconds: number): Promise<unknown>;
  get(key: string): Promise<string | null>;
  del(...keys: string[]): Promise<number>;
  scan(cursor: string, matchToken: "MATCH", pattern: string, countToken: "COUNT", count: number): Promise<[string, string[]]>;
  mget(...keys: string[]): Promise<Array<string | null>>;
}

const KEY_PREFIX = "avi:presence:machine:";

function presenceTtlSec(): number {
  const n = parseInt(String(process.env.PRESENCE_TTL_SEC ?? ""), 10);
  // Default 90s: comfortably longer than a typical ~30s heartbeat so a live
  // machine never flickers offline, short enough that a dead one drops within
  // ~1.5 heartbeat windows. Floor at 10s to keep TTL meaningful.
  return Number.isFinite(n) && n >= 10 ? n : 90;
}

// ─────────────────────────── Redis-backed implementation ───────────────────
class RedisPresenceStore implements MachinePresenceStore {
  readonly backend = "redis" as const;
  constructor(private readonly redis: RedisLike, private readonly instanceId: string) {}

  private key(machineId: number): string {
    return `${KEY_PREFIX}${machineId}`;
  }

  async setOnline(entry: MachinePresenceEntry): Promise<void> {
    const value = JSON.stringify({ ...entry, instanceId: entry.instanceId ?? this.instanceId });
    await this.redis.set(this.key(entry.machineId), value, "EX", presenceTtlSec());
  }

  async refresh(entry: MachinePresenceEntry): Promise<void> {
    // Re-write the full entry so both the TTL and lastHeartbeat advance.
    await this.setOnline(entry);
  }

  async setOffline(machineId: number, socketId?: string): Promise<void> {
    if (socketId) {
      // Migration-safe: only delete if this socket still owns the entry.
      const raw = await this.redis.get(this.key(machineId));
      if (raw) {
        try {
          const cur = JSON.parse(raw) as MachinePresenceEntry;
          if (cur.socketId && cur.socketId !== socketId) return; // owned by a newer socket
        } catch {
          /* corrupt value — fall through and delete */
        }
      } else {
        return; // already gone / expired
      }
    }
    await this.redis.del(this.key(machineId));
  }

  private async scanKeys(): Promise<string[]> {
    const keys: string[] = [];
    let cursor = "0";
    do {
      const [next, batch] = await this.redis.scan(cursor, "MATCH", `${KEY_PREFIX}*`, "COUNT", 200);
      cursor = next;
      if (batch.length) keys.push(...batch);
    } while (cursor !== "0");
    return keys;
  }

  async listOnline(): Promise<MachinePresenceEntry[]> {
    const keys = await this.scanKeys();
    if (keys.length === 0) return [];
    const values = await this.redis.mget(...keys);
    const out: MachinePresenceEntry[] = [];
    for (const raw of values) {
      if (!raw) continue; // expired between SCAN and MGET
      try {
        out.push(JSON.parse(raw) as MachinePresenceEntry);
      } catch {
        /* skip corrupt entry */
      }
    }
    return out;
  }

  async listOnlineCodes(): Promise<string[]> {
    const entries = await this.listOnline();
    const codes = new Set<string>();
    for (const e of entries) if (e.machineCode) codes.add(e.machineCode);
    return Array.from(codes);
  }

  async isOnline(machineId: number): Promise<boolean> {
    const raw = await this.redis.get(this.key(machineId));
    return raw != null;
  }

  async clear(): Promise<void> {
    const keys = await this.scanKeys();
    if (keys.length) await this.redis.del(...keys);
  }
}

// ─────────────────────────── In-memory fallback (single instance) ──────────
class MemoryPresenceStore implements MachinePresenceStore {
  readonly backend = "memory" as const;
  private readonly map = new Map<number, { entry: MachinePresenceEntry; expiresAt: number }>();
  constructor(private readonly instanceId: string) {}

  private prune(): void {
    const now = Date.now();
    for (const [id, v] of this.map) if (v.expiresAt <= now) this.map.delete(id);
  }

  async setOnline(entry: MachinePresenceEntry): Promise<void> {
    this.map.set(entry.machineId, {
      entry: { ...entry, instanceId: entry.instanceId ?? this.instanceId },
      expiresAt: Date.now() + presenceTtlSec() * 1000,
    });
  }

  async refresh(entry: MachinePresenceEntry): Promise<void> {
    await this.setOnline(entry);
  }

  async setOffline(machineId: number, socketId?: string): Promise<void> {
    const cur = this.map.get(machineId);
    if (!cur) return;
    if (socketId && cur.entry.socketId && cur.entry.socketId !== socketId) return; // owned by a newer socket
    this.map.delete(machineId);
  }

  async listOnline(): Promise<MachinePresenceEntry[]> {
    this.prune();
    return Array.from(this.map.values()).map((v) => v.entry);
  }

  async listOnlineCodes(): Promise<string[]> {
    this.prune();
    const codes = new Set<string>();
    for (const v of this.map.values()) if (v.entry.machineCode) codes.add(v.entry.machineCode);
    return Array.from(codes);
  }

  async isOnline(machineId: number): Promise<boolean> {
    this.prune();
    return this.map.has(machineId);
  }

  async clear(): Promise<void> {
    this.map.clear();
  }
}

/**
 * Choose a backend. `MACHINE_PRESENCE_STORE` overrides:
 *   - "memory" → always the in-memory fallback
 *   - "redis"  → force Redis (uses REDIS_URL; errors surface at call time)
 *   - "auto" (default / unset) → Redis when REDIS_URL is set, else memory.
 */
export function createMachinePresenceStore(opts?: {
  redis?: RedisLike | null;
  instanceId?: string;
}): MachinePresenceStore {
  const instanceId = opts?.instanceId ?? `inst_${nanoid(8)}`;
  const mode = (process.env.MACHINE_PRESENCE_STORE ?? "auto").toLowerCase();

  // Explicit injection (tests) always wins.
  if (opts?.redis) return new RedisPresenceStore(opts.redis, instanceId);

  if (mode === "memory") return new MemoryPresenceStore(instanceId);

  const wantRedis = mode === "redis" || (mode === "auto" && !!process.env.REDIS_URL);
  if (wantRedis && process.env.REDIS_URL) {
    try {
      // ioredis is a hard dependency (see redisService.ts). The client connects
      // in the background; commands queue until ready. Any command-time failure
      // is caught by the socket-layer callers (fire-and-forget + try/catch on
      // reads), so a Redis outage never breaks the realtime channel.
      const client = new Redis(process.env.REDIS_URL, {
        maxRetriesPerRequest: 3,
        lazyConnect: false,
      });
      client.on("error", (err: Error) =>
        console.error("[Presence][Redis] error:", err.message),
      );
      console.log("[Presence] Using Redis-backed machine presence store (multi-instance).");
      return new RedisPresenceStore(client as unknown as RedisLike, instanceId);
    } catch (err: any) {
      console.error(
        "[Presence] Failed to init Redis presence store, falling back to in-memory:",
        err?.message ?? err,
      );
      return new MemoryPresenceStore(instanceId);
    }
  }

  console.log("[Presence] REDIS_URL not set — machine presence store is in-memory (single instance).");
  return new MemoryPresenceStore(instanceId);
}

// Lazily-initialized process singleton used by socket.ts.
let singleton: MachinePresenceStore | null = null;

export function getMachinePresenceStore(): MachinePresenceStore {
  if (!singleton) singleton = createMachinePresenceStore();
  return singleton;
}

/** Test hook — override the singleton (and reset with `null`). */
export function __setMachinePresenceStoreForTest(store: MachinePresenceStore | null): void {
  singleton = store;
}
