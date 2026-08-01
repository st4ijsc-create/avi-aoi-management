/**
 * Contract-registry persistence + validation-seam tests — doc 44 Batch W0-E (gap G2.5).
 *
 *  • seed → persist → load round-trip against a mocked db (pattern: vi.mock ../../db/connection,
 *    mirrors aiActionInbox.test.ts) using the REAL contracts/canonical/*.schema.json files
 *  • validateMessage seam: valid / missing-required / bad-enum / wrong-type / unknown subject
 *  • BACKWARD gate still guards the seed path: a breaking canonical edit → action "error"
 *  • flag: initContractRegistry is a no-op while CONTRACT_REGISTRY_PERSIST_ENABLED is OFF
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// ── mocked persistence (in-memory row store standing in for contract_schemas) ──────────────
interface FakeRow {
  subject: string;
  version: number;
  compatibility: string;
  schemaJson: Record<string, unknown>;
  schemaRef?: string | null;
  status: string;
  owner?: string | null;
}
const rows: FakeRow[] = [];

function makeFakeDb() {
  return {
    insert: () => ({
      values: (v: FakeRow) => ({
        onConflictDoNothing: async () => {
          if (!rows.some((r) => r.subject === v.subject && r.version === v.version)) rows.push({ ...v });
        },
      }),
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: async () =>
            [...rows]
              .filter((r) => r.status === "active")
              .sort((a, b) => (a.subject === b.subject ? a.version - b.version : a.subject < b.subject ? -1 : 1)),
        }),
      }),
    }),
  };
}

vi.mock("../../db/connection", () => ({
  getDb: vi.fn(async () => makeFakeDb()),
}));

import {
  _clearSchemaRegistry,
  registerSchema,
  getLatestSchema,
  listSchemas,
  loadRegistryFromDb,
  persistSchema,
  seedCanonicalSchemas,
  validateMessage,
  initContractRegistry,
  contractRegistryPersistEnabled,
  CANONICAL_CONTRACTS_DIR,
  type JsonSchema,
} from "./schemaRegistry";
import { validateAgainstSchema } from "./jsonSchemaValidator";

const CANONICAL_FILES = [
  "command.schema.json",
  "command_ack.schema.json",
  "event.schema.json",
  "health.schema.json",
  "state.schema.json",
  "telemetry.schema.json",
];

beforeEach(() => {
  _clearSchemaRegistry();
  rows.length = 0;
});
afterEach(() => {
  delete process.env.CONTRACT_REGISTRY_PERSIST_ENABLED;
});

describe("seedCanonicalSchemas + loadRegistryFromDb — round-trip", () => {
  it("seeds all 6 canonical LDS-L1 contracts from Git files and persists them", async () => {
    const results = await seedCanonicalSchemas({ persist: true });
    expect(results.map((r) => r.file).sort()).toEqual(CANONICAL_FILES);
    expect(results.every((r) => r.action === "registered" && r.version === 1)).toBe(true);
    // persisted with schemaRef pointing back to the as-code file
    expect(rows).toHaveLength(6);
    expect(rows.map((r) => r.subject).sort()).toEqual([
      "syn/+/+/+/+/+/cmd",
      "syn/+/+/+/+/+/cmd/ack",
      "syn/+/+/+/+/+/events",
      "syn/+/+/+/+/+/health",
      "syn/+/+/+/+/+/state",
      "syn/+/+/+/+/+/telemetry",
    ]);
    expect(rows.every((r) => r.schemaRef?.startsWith("contracts/canonical/"))).toBe(true);

    // round-trip: cold registry hydrated from the persisted rows
    _clearSchemaRegistry();
    expect(listSchemas()).toHaveLength(0);
    const hydrated = await loadRegistryFromDb();
    expect(hydrated).toBe(6);
    expect(getLatestSchema("syn/+/+/+/+/+/telemetry")?.version).toBe(1);
    expect(getLatestSchema("syn/+/+/+/+/+/cmd/ack")?.version).toBe(1);
  });

  it("re-seeding unchanged files is a no-op (unchanged, no duplicate rows)", async () => {
    await seedCanonicalSchemas({ persist: true });
    const again = await seedCanonicalSchemas({ persist: true });
    expect(again.every((r) => r.action === "unchanged")).toBe(true);
    expect(rows).toHaveLength(6);
  });

  it("loadRegistryFromDb is idempotent (no duplicate versions on double load)", async () => {
    await persistSchema({ name: "s", version: 1, schema: { type: "object" } });
    await loadRegistryFromDb();
    await loadRegistryFromDb();
    expect(listSchemas().find((s) => s.name === "s")?.versions).toBe(1);
  });

  it("BACKWARD gate guards the seed path: a breaking canonical edit → error, not registered", async () => {
    // Simulate: telemetry already registered (from DB lineage), then the Git file loses a
    // required field's property → removed property = breaking → seed must reject that file.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "canon-"));
    try {
      const telemetry = JSON.parse(
        fs.readFileSync(path.join(CANONICAL_CONTRACTS_DIR, "telemetry.schema.json"), "utf8"),
      ) as JsonSchema;
      registerSchema("syn/+/+/+/+/+/telemetry", telemetry);

      const broken = structuredClone(telemetry) as JsonSchema;
      delete (broken.properties as Record<string, unknown>).seq; // remove a property → breaking
      fs.writeFileSync(path.join(tmp, "telemetry.schema.json"), JSON.stringify(broken));

      const results = await seedCanonicalSchemas({ dir: tmp, persist: true });
      expect(results).toHaveLength(1);
      expect(results[0].action).toBe("error");
      expect(results[0].error).toMatch(/"seq" removed/);
      expect(getLatestSchema("syn/+/+/+/+/+/telemetry")?.version).toBe(1); // unchanged
      expect(rows).toHaveLength(0); // nothing persisted
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("compatible canonical edit becomes the next version", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "canon-"));
    try {
      const telemetry = JSON.parse(
        fs.readFileSync(path.join(CANONICAL_CONTRACTS_DIR, "telemetry.schema.json"), "utf8"),
      ) as JsonSchema;
      registerSchema("syn/+/+/+/+/+/telemetry", telemetry);

      const extended = structuredClone(telemetry) as JsonSchema;
      (extended.properties as Record<string, unknown>).site = { type: "string" }; // additive
      fs.writeFileSync(path.join(tmp, "telemetry.schema.json"), JSON.stringify(extended));

      const results = await seedCanonicalSchemas({ dir: tmp, persist: true });
      expect(results[0]).toMatchObject({ action: "registered", version: 2 });
      expect(rows).toEqual([expect.objectContaining({ subject: "syn/+/+/+/+/+/telemetry", version: 2 })]);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("validateMessage — ingest seam (not yet enforced)", () => {
  beforeEach(async () => {
    await seedCanonicalSchemas({ persist: false });
  });

  it("valid telemetry passes", () => {
    const r = validateMessage("syn/+/+/+/+/+/telemetry", {
      asset_id: "aoi-01",
      ts: "2026-07-12T00:00:00Z",
      seq: 42,
      metrics: [{ name: "spindle.temp", value: 61.2, unit: "degC", quality: "good" }],
      extra_vendor_field: true, // additive fields allowed (BACKWARD-open)
    });
    expect(r).toEqual({ valid: true });
  });

  it("missing required field fails with a pointed error", () => {
    const r = validateMessage("syn/+/+/+/+/+/telemetry", { ts: "2026-07-12T00:00:00Z", metrics: [] });
    expect(r.valid).toBe(false);
    expect(r.errors?.join(" ")).toMatch(/required property "asset_id"/);
  });

  it("bad enum value + wrong nested type fail", () => {
    const r = validateMessage("syn/+/+/+/+/+/events", {
      event_id: "e1",
      asset_id: "aoi-01",
      type: "explosion", // not in enum
      severity: "critical",
      ts: 123, // wrong type (string expected)
    });
    expect(r.valid).toBe(false);
    expect(r.errors?.join(" ")).toMatch(/not in enum/);
    expect(r.errors?.join(" ")).toMatch(/\$\.ts: expected type "string"/);
  });

  it("array items are validated per element", () => {
    const r = validateMessage("syn/+/+/+/+/+/telemetry", {
      asset_id: "a",
      ts: "t",
      metrics: [{ value: 1 }], // missing name
    });
    expect(r.valid).toBe(false);
    expect(r.errors?.join(" ")).toMatch(/metrics\[0\].*required property "name"/);
  });

  it("unknown subject → valid (open until a contract is registered)", () => {
    expect(validateMessage("syn/+/+/+/+/+/nonexistent", { anything: true })).toEqual({ valid: true });
  });

  it("validateAgainstSchema handles integer + additionalProperties:false", () => {
    const schema: JsonSchema = {
      type: "object",
      properties: { n: { type: "integer" } },
      required: ["n"],
      additionalProperties: false,
    };
    expect(validateAgainstSchema(schema, { n: 3 })).toEqual([]);
    expect(validateAgainstSchema(schema, { n: 3.5 }).join(" ")).toMatch(/integer/);
    expect(validateAgainstSchema(schema, { n: 3, x: 1 }).join(" ")).toMatch(/additional property "x"/);
  });
});

describe("initContractRegistry — flag-gated boot (default OFF)", () => {
  it("flag OFF → no-op (no rows read/written, nothing registered)", async () => {
    expect(contractRegistryPersistEnabled()).toBe(false);
    const r = await initContractRegistry();
    expect(r).toEqual({ enabled: false, loaded: 0, seeded: [] });
    expect(listSchemas()).toHaveLength(0);
    expect(rows).toHaveLength(0);
  });

  it("flag ON → loads persisted lineage then seeds canonical files", async () => {
    process.env.CONTRACT_REGISTRY_PERSIST_ENABLED = "true";
    const r = await initContractRegistry();
    expect(r.enabled).toBe(true);
    expect(r.seeded.filter((s) => s.action === "registered")).toHaveLength(6);
    expect(rows).toHaveLength(6);
    // second boot: everything already persisted → hydrate + unchanged
    _clearSchemaRegistry();
    const r2 = await initContractRegistry();
    expect(r2.loaded).toBe(6);
    expect(r2.seeded.every((s) => s.action === "unchanged")).toBe(true);
    expect(rows).toHaveLength(6);
  });
});
