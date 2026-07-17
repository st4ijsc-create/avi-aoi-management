import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  createMachinePresenceStore,
  type RedisLike,
  type MachinePresenceEntry,
} from "./machinePresenceStore";

/**
 * A deterministic in-memory Redis double implementing exactly the subset the
 * presence store uses (set…EX / get / del / scan / mget), with a CONTROLLABLE
 * clock so TTL expiry is testable without real time. Two store instances that
 * share ONE FakeRedis model two app instances behind a load balancer sharing
 * one Redis — the whole point of the P2 fix.
 */
class FakeRedis implements RedisLike {
  store = new Map<string, { value: string; expireAt: number }>();
  clock = { ms: 1_000_000 };

  private prune(): void {
    for (const [k, v] of this.store) if (v.expireAt <= this.clock.ms) this.store.delete(k);
  }
  async set(key: string, value: string, _mode: "EX", seconds: number): Promise<unknown> {
    this.store.set(key, { value, expireAt: this.clock.ms + seconds * 1000 });
    return "OK";
  }
  async get(key: string): Promise<string | null> {
    this.prune();
    return this.store.get(key)?.value ?? null;
  }
  async del(...keys: string[]): Promise<number> {
    let n = 0;
    for (const k of keys) if (this.store.delete(k)) n++;
    return n;
  }
  async scan(
    _cursor: string,
    _m: "MATCH",
    pattern: string,
    _c: "COUNT",
    _count: number,
  ): Promise<[string, string[]]> {
    this.prune();
    const re = new RegExp("^" + pattern.replace(/[.]/g, "\\.").replace(/\*/g, ".*") + "$");
    const keys = [...this.store.keys()].filter((k) => re.test(k));
    return ["0", keys];
  }
  async mget(...keys: string[]): Promise<Array<string | null>> {
    this.prune();
    return keys.map((k) => this.store.get(k)?.value ?? null);
  }
}

const entry = (machineId: number, code: string, socketId?: string): MachinePresenceEntry => ({
  machineId,
  machineCode: code,
  socketId,
  ipAddress: "10.0.0." + machineId,
  lastHeartbeat: 1_000_000,
});

describe("machinePresenceStore — Redis-backed (shared, multi-instance)", () => {
  let fake: FakeRedis;
  let instanceA: ReturnType<typeof createMachinePresenceStore>;
  let instanceB: ReturnType<typeof createMachinePresenceStore>;

  beforeEach(() => {
    delete process.env.PRESENCE_TTL_SEC; // default 90s
    fake = new FakeRedis();
    instanceA = createMachinePresenceStore({ redis: fake, instanceId: "A" });
    instanceB = createMachinePresenceStore({ redis: fake, instanceId: "B" });
  });

  it("uses the redis backend when a client is injected", () => {
    expect(instanceA.backend).toBe("redis");
  });

  it("UNION: a reader on either instance sees machines registered on BOTH", async () => {
    // Machine 1's socket landed on instance A, machine 2's on instance B.
    await instanceA.setOnline(entry(1, "M1", "sockA"));
    await instanceB.setOnline(entry(2, "M2", "sockB"));

    // Before the fix each instance's local Map would show only its own machine.
    expect((await instanceA.listOnlineCodes()).sort()).toEqual(["M1", "M2"]);
    expect((await instanceB.listOnlineCodes()).sort()).toEqual(["M1", "M2"]);

    const all = await instanceB.listOnline();
    expect(all.map((e) => e.machineId).sort()).toEqual([1, 2]);
    // instanceId is stamped so the admin view can tell which node owns the socket.
    expect(all.find((e) => e.machineId === 1)?.instanceId).toBe("A");
    expect(all.find((e) => e.machineId === 2)?.instanceId).toBe("B");
  });

  it("setOffline removes the machine fleet-wide", async () => {
    await instanceA.setOnline(entry(1, "M1", "sockA"));
    expect(await instanceB.isOnline(1)).toBe(true);

    await instanceA.setOffline(1, "sockA");
    expect(await instanceB.isOnline(1)).toBe(false);
    expect(await instanceB.listOnlineCodes()).toEqual([]);
  });

  it("TTL: a silently-dead machine self-expires after PRESENCE_TTL_SEC", async () => {
    await instanceA.setOnline(entry(1, "M1", "sockA"));
    expect(await instanceB.isOnline(1)).toBe(true);

    // Advance the shared clock past the 90s default TTL — no heartbeat arrived.
    fake.clock.ms += 91_000;
    expect(await instanceB.isOnline(1)).toBe(false);
    expect(await instanceA.listOnline()).toEqual([]);
  });

  it("heartbeat refresh extends the TTL so a live machine never flickers offline", async () => {
    await instanceA.setOnline(entry(1, "M1", "sockA"));

    // 60s later (still alive) a heartbeat refreshes the entry…
    fake.clock.ms += 60_000;
    await instanceA.refresh(entry(1, "M1", "sockA"));

    // …so 60s after THAT (120s since first register) it is still online.
    fake.clock.ms += 60_000;
    expect(await instanceB.isOnline(1)).toBe(true);
  });

  it("migration-safe: a stale socket's disconnect does NOT knock out a re-homed machine", async () => {
    // Machine 1 first on instance A (sockA)…
    await instanceA.setOnline(entry(1, "M1", "sockA"));
    // …then the LB re-homes it to instance B (sockB) — B overwrites the entry.
    await instanceB.setOnline(entry(1, "M1", "sockB"));

    // A's OLD socket now disconnects and calls setOffline with the STALE socketId.
    await instanceA.setOffline(1, "sockA");

    // The machine must STILL be online (owned by sockB now).
    expect(await instanceB.isOnline(1)).toBe(true);
    expect((await instanceB.listOnline())[0]?.socketId).toBe("sockB");

    // The real owner disconnecting DOES remove it.
    await instanceB.setOffline(1, "sockB");
    expect(await instanceB.isOnline(1)).toBe(false);
  });
});

describe("machinePresenceStore — in-memory fallback (single instance)", () => {
  const OLD = process.env.MACHINE_PRESENCE_STORE;
  const OLD_URL = process.env.REDIS_URL;

  beforeEach(() => {
    delete process.env.PRESENCE_TTL_SEC;
    delete process.env.REDIS_URL;
    process.env.MACHINE_PRESENCE_STORE = "memory";
  });
  afterEach(() => {
    if (OLD === undefined) delete process.env.MACHINE_PRESENCE_STORE;
    else process.env.MACHINE_PRESENCE_STORE = OLD;
    if (OLD_URL === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = OLD_URL;
  });

  it("selects the memory backend when MACHINE_PRESENCE_STORE=memory", () => {
    const store = createMachinePresenceStore();
    expect(store.backend).toBe("memory");
  });

  it("auto mode with no REDIS_URL falls back to memory", () => {
    process.env.MACHINE_PRESENCE_STORE = "auto";
    const store = createMachinePresenceStore();
    expect(store.backend).toBe("memory");
  });

  it("supports the same online/offline/list contract locally", async () => {
    const store = createMachinePresenceStore();
    await store.setOnline(entry(1, "M1", "s1"));
    await store.setOnline(entry(2, "M2", "s2"));
    expect((await store.listOnlineCodes()).sort()).toEqual(["M1", "M2"]);

    await store.setOffline(1, "s1");
    expect(await store.isOnline(1)).toBe(false);
    expect(await store.listOnlineCodes()).toEqual(["M2"]);
  });

  it("memory backend also honours the migration-safe setOffline guard", async () => {
    const store = createMachinePresenceStore();
    await store.setOnline(entry(1, "M1", "sockA"));
    await store.setOnline(entry(1, "M1", "sockB")); // re-homed
    await store.setOffline(1, "sockA"); // stale disconnect — must be a no-op
    expect(await store.isOnline(1)).toBe(true);
  });

  it("two separate memory stores do NOT share state (documents the single-instance limit)", async () => {
    const a = createMachinePresenceStore();
    const b = createMachinePresenceStore();
    await a.setOnline(entry(1, "M1", "s1"));
    expect(await b.isOnline(1)).toBe(false); // no shared backend — expected
  });
});
