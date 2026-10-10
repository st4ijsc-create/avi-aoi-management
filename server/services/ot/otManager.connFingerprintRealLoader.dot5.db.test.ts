/**
 * doc 81 Đợt 5 task G3 (item 11) — the connection fingerprint goes through the REAL `loadEnabledAdapters`.
 *
 * `otManager.connFingerprint.dot1d.test.ts` builds its RuntimeAdapter with a hand-copied `runtimeFrom` and mocks the
 * loader, so a change in how `loadEnabledAdapters` (deviceAdapter.ts) builds `connection` (options normalisation,
 * timeoutMs, HA split…) would not be seen. Here the rows live in `device_adapters` of the `_test` DB (vitest.setup
 * forces it), the REAL loader maps them, and otManager records the fingerprint at connect time.
 *
 * Oracle: `adapterTargetFingerprint(<row as read back from the DB>)` — exactly what commandDispatcher
 * (`runningConnectionMatchesAdapterRow`) compares the running fingerprint with. Two failure directions are pinned:
 *   · spurious STALE  — same device, secrets/account changed, or the row merely re-read ⇒ fingerprints must MATCH;
 *   · false MATCH     — row re-pointed (endpoint / unitId / ha / machine) after connect ⇒ must DIFFER.
 * Only the driver factory is faked (no network I/O) and the loader's output is FILTERED to this file's rows so
 * adapters of other suites sharing `_test` are never connected; the mapping itself is the real one.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { eq, inArray, like } from "drizzle-orm";
import type { OtConnectionConfig, OtTagAddress } from "./otDriver";
import { adapterTargetFingerprint } from "./adapterTarget";

const RUN = `G3-${process.pid}-${Date.now().toString(36)}`;

class FakeDriver {
  readonly protocol = "stub";
  connected = false;
  async connect(_cfg: OtConnectionConfig) {
    this.connected = true;
  }
  async disconnect() {
    this.connected = false;
  }
  isConnected() {
    return this.connected;
  }
  async subscribe(_tags: OtTagAddress[], _on: unknown, _ms: number) {
    return { close: async () => undefined };
  }
  async readTags() {
    return [];
  }
  async writeTags() {
    return [];
  }
  async health() {
    return { ok: true } as never;
  }
}

const myIds = new Set<number>();

vi.mock("./driverRegistry", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./driverRegistry")>()),
  createDriver: () => new FakeDriver(),
}));
vi.mock("./ingest", () => ({ ingestSample: async () => undefined }));
// REAL loader, output restricted to this file's rows (other suites' enabled adapters are not touched).
vi.mock("./deviceAdapter", async (importOriginal) => {
  const real = await importOriginal<typeof import("./deviceAdapter")>();
  return {
    ...real,
    loadEnabledAdapters: async () => (await real.loadEnabledAdapters()).filter((a) => myIds.has(a.adapterId)),
  };
});

let db: any;
let schema: typeof import("../../../drizzle/schema");

type Seed = { key: string; protocol: "modbus" | "opcua" | "s7"; endpoint: string; connectionOptions: Record<string, unknown> | null };
const SEEDS: Seed[] = [
  { key: "secret", protocol: "modbus", endpoint: "tcp://10.250.0.5:502", connectionOptions: { unitId: 3, password: "enc:v1:aa", timeoutMs: 1500 } },
  { key: "null", protocol: "s7", endpoint: "10.250.0.6", connectionOptions: null },
  {
    key: "ha",
    protocol: "opcua",
    endpoint: "opc.tcp://10.250.0.7:4840",
    connectionOptions: { securityMode: "None", userName: "op", ha: { secondaryEndpoint: "opc.tcp://10.250.0.8:4840" } },
  },
];
const ids: Record<string, number> = {};

async function rowOf(key: string) {
  const [r] = await db.select().from(schema.deviceAdapters).where(eq(schema.deviceAdapters.id, ids[key])).limit(1);
  return r;
}

beforeAll(async () => {
  schema = await import("../../../drizzle/schema");
  const { getDb } = await import("../../db");
  db = await getDb();
  expect(db).toBeTruthy();
  for (const s of SEEDS) {
    const [r] = await db
      .insert(schema.deviceAdapters)
      .values({
        code: `${RUN}-${s.key}`,
        name: `G3 ${s.key}`,
        protocol: s.protocol,
        endpoint: s.endpoint,
        connectionOptions: s.connectionOptions,
        machineId: null,
        isEnabled: true,
        status: "disabled",
      })
      .returning({ id: schema.deviceAdapters.id });
    ids[s.key] = r.id;
    myIds.add(r.id);
  }
}, 30_000);

afterAll(async () => {
  if (db) await db.delete(schema.deviceAdapters).where(like(schema.deviceAdapters.code, `${RUN}-%`));
}, 30_000);

describe("G3 — fingerprint through the REAL loadEnabledAdapters (_test DB)", () => {
  it("the real loader's RuntimeAdapter fingerprints exactly like the DB row (every seeded shape)", async () => {
    const { loadEnabledAdapters } = await import("./deviceAdapter");
    const { runtimeAdapterTarget } = await import("./adapterTarget");
    const runtime = await loadEnabledAdapters();
    expect(runtime.map((a) => a.adapterId).sort()).toEqual([...myIds].sort());
    for (const s of SEEDS) {
      const ra = runtime.find((a) => a.adapterId === ids[s.key])!;
      expect(adapterTargetFingerprint(runtimeAdapterTarget(ra)), s.key).toBe(adapterTargetFingerprint(await rowOf(s.key)));
    }
  });

  for (const ha of [false, true]) {
    it(`otManager (${ha ? "HA supervisor" : "legacy"} path): running fingerprint == dispatcher's row fingerprint; re-point ⇒ differs; secret-only edit ⇒ still equal`, async () => {
      vi.resetModules();
      vi.stubEnv("OT_GATEWAY_ENABLED", "true");
      vi.stubEnv("OT_CONN_HA_ENABLED", ha ? "true" : "false");
      const ot = await import("./otManager");
      try {
        expect(await ot.startOt()).toBe(true);
        for (const s of SEEDS) {
          const running = ot.getActiveConnectionFingerprint(ids[s.key]);
          expect(running, `${s.key}: no fingerprint recorded`).toMatch(/^[0-9a-f]{64}$/);
          expect(running, s.key).toBe(adapterTargetFingerprint(await rowOf(s.key)));
        }

        // Same device, only the secret / account change in the DB ⇒ NOT stale (no spurious adapter_connection_stale).
        const before = await rowOf("secret");
        await db
          .update(schema.deviceAdapters)
          .set({ connectionOptions: { ...(before.connectionOptions as object), password: "enc:v1:ROTATED", userName: "new" } })
          .where(eq(schema.deviceAdapters.id, ids.secret));
        expect(ot.getActiveConnectionFingerprint(ids.secret)).toBe(adapterTargetFingerprint(await rowOf("secret")));

        // Re-pointed rows (not reconnected) ⇒ the running fingerprint must NOT match any more (no false exemption).
        await db.update(schema.deviceAdapters).set({ endpoint: "tcp://10.250.0.99:502" }).where(eq(schema.deviceAdapters.id, ids.secret));
        await db.update(schema.deviceAdapters).set({ endpoint: "10.250.0.66" }).where(eq(schema.deviceAdapters.id, ids.null));
        await db
          .update(schema.deviceAdapters)
          .set({ connectionOptions: { securityMode: "None", userName: "op", ha: { secondaryEndpoint: "opc.tcp://10.250.0.9:4840" } } })
          .where(eq(schema.deviceAdapters.id, ids.ha));
        for (const k of ["secret", "null", "ha"]) {
          expect(ot.getActiveConnectionFingerprint(ids[k]), `${k} re-pointed`).not.toBe(adapterTargetFingerprint(await rowOf(k)));
        }

        // Full restart = reconnect ⇒ matches the new rows again.
        await ot.stopOt();
        expect(await ot.startOt()).toBe(true);
        for (const k of ["secret", "null", "ha"]) {
          expect(ot.getActiveConnectionFingerprint(ids[k]), `${k} after restart`).toBe(adapterTargetFingerprint(await rowOf(k)));
        }
      } finally {
        await ot.stopOt();
        vi.unstubAllEnvs();
        // restore the seeds for the next variant
        for (const s of SEEDS) {
          await db
            .update(schema.deviceAdapters)
            .set({ endpoint: s.endpoint, connectionOptions: s.connectionOptions })
            .where(inArray(schema.deviceAdapters.id, [ids[s.key]]));
        }
      }
    }, 30_000);
  }
});
