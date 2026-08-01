/**
 * Doc 56 Đ2a Việc 2/4 (db layer) — mk_-only claim redemption + IoT virtual station.
 *
 * The DB is faked at ./connection (same harness family as machineClaimToken.test.ts,
 * extended with insert().returning() which the station-create path needs). Covers:
 *   Việc 2 — redeemMachineClaimToken: automation machine + MACHINE_CRED_MK_ONLY_ENABLED
 *            mints a FRESH mk_ (via the mocked fleet issuer) instead of returning the
 *            legacy machines.apiKey; flag OFF returns machines.apiKey byte-identically.
 *   Việc 4 — ensureIotVirtualStation creates IOT-<workshop> line+station once and is
 *            idempotent (a 2nd call reuses them).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "node:crypto";

type Row = Record<string, unknown>;

const fake = vi.hoisted(() => {
  const state = {
    selectResults: [] as unknown[][],
    inserts: [] as Array<{ table: string; values: Record<string, unknown> }>,
    insertReturning: [] as unknown[][],
    updates: [] as Array<{ table: string; data: Record<string, unknown> }>,
    updateReturning: [] as unknown[][],
    txCount: 0,
  };
  const tableName = (t: unknown): string => {
    const anyT = t as Record<string | symbol, unknown>;
    for (const s of Object.getOwnPropertySymbols(anyT ?? {})) {
      if (String(s).includes("Name")) {
        const v = anyT[s];
        if (typeof v === "string") return v;
      }
    }
    return "unknown";
  };
  const makeHandle = () => {
    const handle: Record<string, unknown> = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => fake.state.selectResults.shift() ?? [],
            orderBy: async () => fake.state.selectResults.shift() ?? [],
          }),
        }),
      }),
      insert: (table: unknown) => ({
        values: (values: Record<string, unknown>) => {
          const rec = { table: tableName(table), values };
          const p: any = Promise.resolve().then(() => { fake.state.inserts.push(rec); });
          p.returning = async () => {
            fake.state.inserts.push(rec);
            return fake.state.insertReturning.shift() ?? [];
          };
          return p;
        },
      }),
      update: (table: unknown) => ({
        set: (data: Record<string, unknown>) => {
          const applied = { table: tableName(table), data };
          const where = () => {
            const p: any = Promise.resolve().then(() => { fake.state.updates.push(applied); });
            p.returning = async () => {
              fake.state.updates.push(applied);
              return fake.state.updateReturning.shift() ?? [];
            };
            return p;
          };
          return { where };
        },
      }),
      transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
        fake.state.txCount += 1;
        return fn(makeHandle());
      },
    };
    return handle;
  };
  return { state, db: makeHandle() };
});

vi.mock("./connection", () => ({ getDb: vi.fn(async () => fake.db) }));

// The fleet issuer is dynamic-imported by redeemMachineClaimToken — mock it so the
// mk_-only branch has no real DB dependency.
const issueFleetMachineKey = vi.hoisted(() =>
  vi.fn(async () => ({ id: 999, keyPrefix: "mk_new", plaintextKey: "mk_NEWSECRET", machineId: 5 })),
);
vi.mock("../services/machineAuthService", () => ({ issueFleetMachineKey }));

import { redeemMachineClaimToken, ensureIotVirtualStation } from "./hierarchy";

const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const AUTO = {
  id: 5, code: "PLC-01", name: "PLC", machineType: "AUTOMATION", isActive: true,
  registrationStatus: "approved", apiKey: "mach_LEGACY", serialNumber: "SN-9",
};

function futureToken(over: Row = {}): Row {
  return {
    id: 90, machineId: 5, tokenHash: "x", tokenPrefix: "mct_aaaaaa",
    expiresAt: new Date(Date.now() + 10 * 60_000), usedAt: null, invalidatedAt: null, ...over,
  };
}

/** Queue: [machine-by-serial], [token], [fresh machine]; burn returns 1 row. */
function primeRedeem(fresh: Row) {
  fake.state.selectResults = [[{ ...AUTO }], [futureToken({ tokenHash: sha256("mct_tok") })], [fresh]];
  fake.state.updateReturning = [[{ id: 90 }]];
}

beforeEach(() => {
  fake.state.selectResults = [];
  fake.state.inserts = [];
  fake.state.insertReturning = [];
  fake.state.updates = [];
  fake.state.updateReturning = [];
  fake.state.txCount = 0;
  issueFleetMachineKey.mockClear();
  delete process.env.MACHINE_CRED_MK_ONLY_ENABLED;
});

// ── Việc 2 — mk_-only claim redemption ───────────────────────────────────────
describe("Việc 2 — redeemMachineClaimToken (automation fleet)", () => {
  it("flag OFF: returns the legacy machines.apiKey (byte-identical)", async () => {
    primeRedeem({ ...AUTO });
    const r = await redeemMachineClaimToken({ serialNumber: "SN-9", claimToken: "mct_tok" });
    expect(r.apiKey).toBe("mach_LEGACY");
    expect(issueFleetMachineKey).not.toHaveBeenCalled();
  });

  it("flag ON: mints a FRESH mk_ instead of machines.apiKey", async () => {
    process.env.MACHINE_CRED_MK_ONLY_ENABLED = "true";
    // fresh machine has NO apiKey — mk_-only must NOT require one.
    primeRedeem({ ...AUTO, apiKey: null });
    const r = await redeemMachineClaimToken({ serialNumber: "SN-9", claimToken: "mct_tok" });
    expect(r.apiKey).toBe("mk_NEWSECRET");
    expect(issueFleetMachineKey).toHaveBeenCalledWith(
      expect.objectContaining({ machineId: 5, name: "claim:PLC-01" }),
    );
  });
});

// ── Việc 4 — IoT virtual station ─────────────────────────────────────────────
describe("Việc 4 — ensureIotVirtualStation", () => {
  const WS = { id: 50, code: "WS1", name: "Workshop 1", isActive: true };
  const LINE = { id: 100, code: "IOT-WS1", name: "IoT devices — Workshop 1", workshopId: 50, isActive: true };
  const STATION = { id: 200, code: "IOT-WS1", name: "IoT devices — Workshop 1", lineId: 100, isActive: true };

  it("creates the IOT- line + station on first call, returns the station id", async () => {
    fake.state.selectResults = [
      [{ ...WS }],   // getWorkshopByCode
      [],            // getProductionLineByCode → miss → create
      [{ ...LINE }], // getLineById (after create)
      [],            // getStationByCode → miss → create
    ];
    fake.state.insertReturning = [[{ id: 100 }], [{ id: 200 }]];
    const stationId = await ensureIotVirtualStation("WS1");
    expect(stationId).toBe(200);
    // both created under the IOT- code convention
    const lineInsert = fake.state.inserts.find((i) => (i.values as Row).code === "IOT-WS1" && "workshopId" in (i.values as Row));
    const stationInsert = fake.state.inserts.find((i) => (i.values as Row).code === "IOT-WS1" && "lineId" in (i.values as Row));
    expect(lineInsert).toBeTruthy();
    expect(stationInsert).toBeTruthy();
  });

  it("is idempotent — a 2nd call reuses the existing active line+station (no creates)", async () => {
    fake.state.selectResults = [
      [{ ...WS }],       // getWorkshopByCode
      [{ ...LINE }],     // getProductionLineByCode → found (active, right workshop)
      [{ ...STATION }],  // getStationByCode → found (active, right line)
    ];
    const stationId = await ensureIotVirtualStation("WS1");
    expect(stationId).toBe(200);
    expect(fake.state.inserts).toHaveLength(0);
  });
});
