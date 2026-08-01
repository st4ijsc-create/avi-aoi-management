/**
 * Doc 56 Đ2a Việc 2/3 — mk_-only fleet policy + machine-key expiry sweep (UNIT).
 *
 * All DB access is mocked at ../db (no live DB — mirrors machineClaimKey.test.ts),
 * so this runs standalone. Covers:
 *   Việc 2 — authenticateMachine refuses the shared-key / machineCode weak paths for
 *            an automation/iot machine when MACHINE_CRED_MK_ONLY_ENABLED=true, and
 *            leaves aoi_avi + the flag-OFF default untouched (byte-identical).
 *   Việc 3 — machineKeyFleetTtlDays fallback (180), buildMachineKeyExpiryInsight
 *            shape, and runMachineKeyExpiryAlertSweep gate + dedup insert.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const logs = vi.hoisted(() => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() }));
vi.mock("../logger", () => ({ logger: logs, default: logs }));

const dbm = vi.hoisted(() => ({
  // null → authenticateMachine skips the api_keys path and lands on the weak paths.
  getDb: vi.fn(async (): Promise<any> => null),
  getMachineByApiKey: vi.fn(async (): Promise<any> => undefined),
  getMachineByCode: vi.fn(async (): Promise<any> => undefined),
  getMachineById: vi.fn(async (): Promise<any> => undefined),
}));
vi.mock("../db", () => dbm);

import {
  authenticateMachine,
  machineKeyFleetTtlDays,
  buildMachineKeyExpiryInsight,
  runMachineKeyExpiryAlertSweep,
  getWeakAuthUsage,
  _resetMachineAuthState,
  MACHINE_KEY_EXPIRY_INSIGHT_SOURCE,
} from "./machineAuthService";

const AUTOMATION = { id: 10, code: "PLC-01", machineType: "AUTOMATION", isActive: true };
const IOT = { id: 11, code: "SENS-01", machineType: "IOT_SENSOR", isActive: true };
const AVI = { id: 12, code: "AOI-01", machineType: "AVI", isActive: true };

beforeEach(() => {
  vi.clearAllMocks();
  _resetMachineAuthState();
  dbm.getDb.mockResolvedValue(null);
  dbm.getMachineByApiKey.mockResolvedValue(undefined);
  dbm.getMachineByCode.mockResolvedValue(undefined);
  delete process.env.MACHINE_CRED_MK_ONLY_ENABLED;
  delete process.env.MACHINE_KEY_EXPIRY_ALERT_ENABLED;
  delete process.env.MACHINE_KEY_DEFAULT_TTL_DAYS;
});

// ── Việc 2: shared-key path ──────────────────────────────────────────────────
describe("Việc 2 — mk_-only refuses the shared-key path for automation/iot", () => {
  it("flag OFF: an automation machine's shared key still authenticates (byte-identical)", async () => {
    dbm.getMachineByApiKey.mockResolvedValue({ ...AUTOMATION });
    const auth = await authenticateMachine({ apiKey: "SHARED", scope: "ingest:write" });
    expect(auth.method).toBe("shared-key");
    expect(auth.machine.id).toBe(AUTOMATION.id);
  });

  it("flag ON: an automation machine's shared key is REFUSED (mk_ required)", async () => {
    process.env.MACHINE_CRED_MK_ONLY_ENABLED = "true";
    dbm.getMachineByApiKey.mockResolvedValue({ ...AUTOMATION });
    await expect(
      authenticateMachine({ apiKey: "SHARED", scope: "ingest:write" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED", message: expect.stringContaining("per-device key") });
    // Recorded as a DENIED weak-auth attempt so rotation telemetry still names it.
    const usage = getWeakAuthUsage();
    expect(usage.find((u) => u.machineId === AUTOMATION.id && u.outcome === "denied")).toBeTruthy();
  });

  it("flag ON: an aoi_avi machine's shared key is UNCHANGED (still allowed)", async () => {
    process.env.MACHINE_CRED_MK_ONLY_ENABLED = "true";
    dbm.getMachineByApiKey.mockResolvedValue({ ...AVI });
    const auth = await authenticateMachine({ apiKey: "SHARED", scope: "ingest:write" });
    expect(auth.method).toBe("shared-key");
    expect(auth.machine.id).toBe(AVI.id);
  });
});

// ── Việc 2: machineCode path ─────────────────────────────────────────────────
describe("Việc 2 — mk_-only refuses the machineCode path for automation/iot", () => {
  it("flag OFF: an IoT machine authenticates by machineCode (byte-identical)", async () => {
    dbm.getMachineByCode.mockResolvedValue({ ...IOT });
    const auth = await authenticateMachine({ machineCode: "SENS-01", scope: "ingest:write" });
    expect(auth.method).toBe("machine-code");
    expect(auth.machine.id).toBe(IOT.id);
  });

  it("flag ON: an IoT machine's bare machineCode is REFUSED (mk_ required)", async () => {
    process.env.MACHINE_CRED_MK_ONLY_ENABLED = "true";
    dbm.getMachineByCode.mockResolvedValue({ ...IOT });
    await expect(
      authenticateMachine({ machineCode: "SENS-01", scope: "ingest:write" }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED", message: expect.stringContaining("per-device key") });
  });
});

// ── Việc 3: fleet TTL + insight builder (pure) ───────────────────────────────
describe("Việc 3 — fleet TTL + expiry insight", () => {
  it("machineKeyFleetTtlDays defaults to 180 and honours MACHINE_KEY_DEFAULT_TTL_DAYS", () => {
    expect(machineKeyFleetTtlDays()).toBe(180);
    process.env.MACHINE_KEY_DEFAULT_TTL_DAYS = "90";
    expect(machineKeyFleetTtlDays()).toBe(90);
  });

  it("buildMachineKeyExpiryInsight summarises the expiring keys", () => {
    const keys = [
      { id: 1, machineId: 10, keyPrefix: "mk_aaa", expiresAt: new Date("2026-08-01T00:00:00Z") },
      { id: 2, machineId: 11, keyPrefix: "mk_bbb", expiresAt: new Date("2026-08-02T00:00:00Z") },
    ] as any;
    const insight = buildMachineKeyExpiryInsight(keys, 14);
    expect(insight.source).toBe(MACHINE_KEY_EXPIRY_INSIGHT_SOURCE);
    expect(insight.severity).toBe("warning");
    expect(insight.title).toContain("2 khoá");
    expect(insight.contextJson.count).toBe(2);
    expect(insight.contextJson.keys).toHaveLength(2);
    expect(insight.body).toContain("mk_aaa");
  });
});

// ── Việc 3: sweep gate + insert ──────────────────────────────────────────────
describe("Việc 3 — runMachineKeyExpiryAlertSweep", () => {
  it("flag OFF: immediate no-op (no DB access)", async () => {
    const r = await runMachineKeyExpiryAlertSweep(14);
    expect(r).toEqual({ enabled: false, expiring: 0, created: 0, refreshed: 0 });
    expect(dbm.getDb).not.toHaveBeenCalled();
  });

  it("flag ON: expiring keys → ONE ai_insights item inserted (deduped)", async () => {
    process.env.MACHINE_KEY_EXPIRY_ALERT_ENABLED = "true";
    const inserts: any[] = [];
    const selectResults: any[][] = [
      // (1) listExpiringMachineKeys → apiKeys rows (…orderBy terminal)
      [{ id: 1, machineId: 10, name: "k", description: null, keyPrefix: "mk_aaa", scopes: ["ingest:write"], isActive: true, revokedAt: null, expiresAt: new Date("2026-08-01T00:00:00Z"), lastUsedAt: null, createdBy: null, createdAt: new Date() }],
      // (2) dedup select → no existing 'new' insight (…limit terminal)
      [],
    ];
    const fakeDb = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => selectResults.shift() ?? [],
            orderBy: async () => selectResults.shift() ?? [],
          }),
        }),
      }),
      insert: () => ({ values: async (v: any) => { inserts.push(v); } }),
      update: () => ({ set: () => ({ where: async () => {} }) }),
    };
    dbm.getDb.mockResolvedValue(fakeDb);

    const r = await runMachineKeyExpiryAlertSweep(14);
    expect(r.enabled).toBe(true);
    expect(r.expiring).toBe(1);
    expect(r.created).toBe(1);
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({ source: MACHINE_KEY_EXPIRY_INSIGHT_SOURCE, machineCode: null, status: "new" });
  });
});
