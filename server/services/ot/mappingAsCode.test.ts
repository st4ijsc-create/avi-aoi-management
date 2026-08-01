/**
 * doc 44 W2-B3 (G1.13) — mapping-as-code tests.
 *
 * Covers: round-trip export→parse→diff = 0 thay đổi (YAML byte-stable, tags
 * sorted), diff phát hiện create/update/delete, version regression bị CHẶN
 * (kể cả dry-run), prune CHỈ xoá khi cờ tường minh, zod từ chối file bẩn
 * (datatype lạ / field lạ / trùng tag / deadband âm), dry-run KHÔNG ghi DB
 * (0 transaction, hooks không gọi), apply ghi upsert theo khóa tự nhiên +
 * metadata version + gọi best-effort hooks (audit / clearMappingCache /
 * approveCurrentConfig). DB faked tại ../../db/connection (FIFO selects +
 * recorded tx ops) — pattern configDriftService.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const fake = vi.hoisted(() => {
  const state = {
    selectResults: [] as unknown[][],
    txOps: [] as Array<{ kind: "upsert" | "delete"; table: unknown; values?: Record<string, unknown>; set?: Record<string, unknown>; where?: unknown }>,
    txCount: 0,
  };
  function chain(rows: unknown[]) {
    const p: any = Promise.resolve(rows);
    p.from = () => p;
    p.where = () => p;
    p.orderBy = () => p;
    p.limit = () => p;
    return p;
  }
  const tx = {
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => ({
        onConflictDoUpdate: async (cfg: { set: Record<string, unknown> }) => {
          state.txOps.push({ kind: "upsert", table, values, set: cfg.set });
        },
      }),
    }),
    delete: (table: unknown) => ({
      where: async (cond: unknown) => {
        state.txOps.push({ kind: "delete", table, where: cond });
      },
    }),
  };
  const db = {
    select: (_cols?: unknown) => chain(state.selectResults.shift() ?? []),
    transaction: async (fn: (t: typeof tx) => Promise<void>) => {
      state.txCount++;
      await fn(tx);
    },
  };
  return {
    state,
    db,
    clearMappingCache: vi.fn(),
    approveCurrentConfig: vi.fn(async () => ({})),
    logCrudOperation: vi.fn(async () => ({ id: 1 })),
  };
});

vi.mock("../../db/connection", () => ({ getDb: vi.fn(async () => fake.db) }));
vi.mock("../../../drizzle/schema", () => ({
  deviceAdapters: { id: "deviceAdapters.id", code: "deviceAdapters.code" },
  deviceTags: { adapterId: "deviceTags.adapterId", tagKey: "deviceTags.tagKey" },
  unsTagMappings: { adapterId: "unsTagMappings.adapterId", tag: "unsTagMappings.tag" },
  configSnapshots: { entityType: "configSnapshots.entityType", entityId: "configSnapshots.entityId" },
  machines: { id: "machines.id", code: "machines.code" },
}));
vi.mock("drizzle-orm", () => ({
  and: (...a: unknown[]) => a,
  eq: (...a: unknown[]) => a,
  asc: (x: unknown) => x,
}));
vi.mock("../unsMappingService", () => ({ clearMappingCache: fake.clearMappingCache }));
vi.mock("../assetRegistry/configDriftService", () => ({ approveCurrentConfig: fake.approveCurrentConfig }));
vi.mock("../auditTrailService", () => ({ logCrudOperation: fake.logCrudOperation }));

import { deviceTags as deviceTagsMock, unsTagMappings as unsTagMappingsMock, configSnapshots as configSnapshotsMock } from "../../../drizzle/schema";
import {
  buildMappingFile,
  mappingFileToYaml,
  parseMappingYaml,
  diffMapping,
  importMapping,
  mappingFileName,
  MappingValidationError,
  MappingImportError,
  type AdapterRowInput,
  type TagRowInput,
  type UnsRowInput,
} from "./mappingAsCode";

beforeEach(() => {
  fake.state.selectResults = [];
  fake.state.txOps = [];
  fake.state.txCount = 0;
  fake.clearMappingCache.mockClear();
  fake.approveCurrentConfig.mockClear();
  fake.logCrudOperation.mockClear();
});

// ─── fixtures ────────────────────────────────────────────────────────────────

const ADAPTER: AdapterRowInput = { id: 7, code: "plc-1", protocol: "modbus", machineId: null };

// Cố ý KHÔNG sort sẵn (run < temp) để test sort ổn định của builder.
const DB_TAGS: TagRowInput[] = [
  {
    tagKey: "temp",
    address: "40001",
    dataType: "float",
    unit: "°C",
    scale: "1.000000", // drizzle decimal → string
    offset: "0.000000",
    writable: false,
    isEnabled: true,
    deadband: 0.5,
    samplingMs: 1000,
  },
  {
    tagKey: "run",
    address: "00001",
    dataType: "bool",
    unit: null,
    scale: null,
    offset: null,
    writable: true,
    isEnabled: true,
    deadband: null,
    samplingMs: null,
  },
];

const DB_MAPS: UnsRowInput[] = [
  {
    tag: "temp",
    unsTopic: "syn/{enterprise}/{adapterCode}/{rename}",
    sparkplugMetric: "temperature",
    transform: { rename: "temperature", scale: 0.1, unit: "°C", cast: "number" },
    enabled: true,
    notes: null,
  },
];

/** FIFO selects của importMapping (machineId null ⇒ KHÔNG select machines). */
function queueImportSelects(opts: { adapter?: Record<string, unknown>; tags?: unknown[]; maps?: unknown[]; snapshot?: unknown[] } = {}) {
  fake.state.selectResults = [
    [opts.adapter ?? { id: ADAPTER.id, code: ADAPTER.code, protocol: ADAPTER.protocol, machineId: null }],
    (opts.tags ?? DB_TAGS) as unknown[],
    (opts.maps ?? DB_MAPS) as unknown[],
    (opts.snapshot ?? []) as unknown[],
  ];
}

// ─── round-trip export → parse → diff ────────────────────────────────────────

describe("G1.13 — round-trip export → import (no diff)", () => {
  it("builds a stable, sorted file; YAML round-trips with zero diff", () => {
    const file = buildMappingFile(ADAPTER, null, DB_TAGS, DB_MAPS, 1);

    // tags sort theo name (run < temp) dù input ngược thứ tự
    expect(file.tags.map((t) => t.name)).toEqual(["run", "temp"]);
    // decimal string "1.000000" → number 1
    expect(file.tags[1].scale).toBe(1);
    // field null bị omit (unit của "run")
    expect("unit" in file.tags[0]).toBe(false);

    const yaml1 = mappingFileToYaml(file);
    const yaml2 = mappingFileToYaml(buildMappingFile(ADAPTER, null, [...DB_TAGS].reverse(), DB_MAPS, 1));
    expect(yaml1).toBe(yaml2); // byte-stable bất kể thứ tự row input

    const parsed = parseMappingYaml(yaml1);
    expect(parsed.adapter).toBe("plc-1");
    expect(parsed.version).toBe(1);

    const diff = diffMapping(parsed, { tags: DB_TAGS, mappings: DB_MAPS, machineCode: null, protocol: "modbus" });
    expect(diff.changeCount).toBe(0);
    expect(diff.warnings).toEqual([]);
  });

  it("mappingFileName sanitizes adapter code", () => {
    expect(mappingFileName("plc-1")).toBe("plc-1.mapping.yaml");
    expect(mappingFileName("../evil/x")).toBe(".._evil_x.mapping.yaml");
  });
});

// ─── diff detection ──────────────────────────────────────────────────────────

describe("G1.13 — diffMapping detects create/update/delete + warnings", () => {
  it("detects tag create, tag field update, and DB-only delete candidates", () => {
    const file = buildMappingFile(ADAPTER, null, DB_TAGS, DB_MAPS, 2);
    // đổi address của temp + thêm tag mới, bỏ "run" (DB-only)
    const tags = file.tags
      .filter((t) => t.name !== "run")
      .map((t) => (t.name === "temp" ? { ...t, address: "40002" } : t));
    tags.push({ name: "pressure", address: "40010", datatype: "float", scale: 1, offset: 0, writable: false, enabled: true });
    const mutated = { ...file, tags };

    const diff = diffMapping(mutated, { tags: DB_TAGS, mappings: DB_MAPS, machineCode: null, protocol: "modbus" });
    expect(diff.tags.creates).toEqual(["pressure"]);
    expect(diff.tags.updates).toHaveLength(1);
    expect(diff.tags.updates[0].name).toBe("temp");
    expect(diff.tags.updates[0].changes).toEqual([{ field: "address", from: "40001", to: "40002" }]);
    expect(diff.tags.deletes).toEqual(["run"]);
    expect(diff.unsMappings.creates).toEqual([]);
    expect(diff.changeCount).toBe(3);
  });

  it("detects uns_mapping transform change and DB-only mapping delete", () => {
    const file = buildMappingFile(ADAPTER, null, DB_TAGS, DB_MAPS, 2);
    const mutated = {
      ...file,
      uns_mappings: [{ ...file.uns_mappings[0], transform: { ...file.uns_mappings[0].transform, scale: 0.2 } }],
    };
    const dbMaps = [...DB_MAPS, { tag: "run", unsTopic: "syn/x/run", sparkplugMetric: null, transform: null, enabled: true, notes: null }];
    const diff = diffMapping(mutated as never, { tags: DB_TAGS, mappings: dbMaps, machineCode: null, protocol: "modbus" });
    expect(diff.unsMappings.updates).toHaveLength(1);
    expect(diff.unsMappings.updates[0].tag).toBe("temp");
    expect(diff.unsMappings.updates[0].changes.map((c) => c.field)).toEqual(["transform"]);
    expect(diff.unsMappings.deletes).toEqual(["run"]);
  });

  it("warns (does not block) on vendor/machine mismatch and mapping without tag", () => {
    const file = buildMappingFile(ADAPTER, "M-01", DB_TAGS, DB_MAPS, 1);
    const mutated = { ...file, vendor: "s7", uns_mappings: [...file.uns_mappings, { tag: "ghost", uns_topic: "syn/x", enabled: true }] };
    const diff = diffMapping(mutated as never, { tags: DB_TAGS, mappings: DB_MAPS, machineCode: null, protocol: "modbus" });
    expect(diff.warnings.some((w) => w.includes("vendor"))).toBe(true);
    expect(diff.warnings.some((w) => w.includes("machine"))).toBe(true);
    expect(diff.warnings.some((w) => w.includes('"ghost"'))).toBe(true);
  });
});

// ─── zod validation ──────────────────────────────────────────────────────────

describe("G1.13 — parseMappingYaml rejects dirty files", () => {
  const base = () => mappingFileToYaml(buildMappingFile(ADAPTER, null, DB_TAGS, DB_MAPS, 1));

  it("rejects unknown datatype", () => {
    expect(() => parseMappingYaml(base().replace("datatype: float", "datatype: double"))).toThrow(MappingValidationError);
  });

  it("rejects duplicate tag names", () => {
    const file = buildMappingFile(ADAPTER, null, [DB_TAGS[0], { ...DB_TAGS[0] }], DB_MAPS, 1);
    expect(() => parseMappingYaml(mappingFileToYaml(file))).toThrow(/trùng lặp/);
  });

  it("rejects negative deadband and unknown fields (strict)", () => {
    expect(() => parseMappingYaml(base().replace("deadband: 0.5", "deadband: -1"))).toThrow(MappingValidationError);
    expect(() => parseMappingYaml(`${base()}\nrogue_field: 1\n`)).toThrow(MappingValidationError);
  });

  it("rejects version < 1 and non-object roots", () => {
    expect(() => parseMappingYaml(base().replace("version: 1", "version: 0"))).toThrow(MappingValidationError);
    expect(() => parseMappingYaml("- just\n- a list\n")).toThrow(MappingValidationError);
    expect(() => parseMappingYaml("::: not yaml :::")).toThrow(MappingValidationError);
  });
});

// ─── importMapping: version gate / dry-run / apply / prune ───────────────────

describe("G1.13 — importMapping", () => {
  const yamlV = (version: number) => mappingFileToYaml(buildMappingFile(ADAPTER, null, DB_TAGS, DB_MAPS, version));

  it("blocks version regression (file.version < stored) — even in dry-run", async () => {
    queueImportSelects({ snapshot: [{ payloadSummary: { version: 5 } }] });
    await expect(importMapping(yamlV(4), { dryRun: true })).rejects.toMatchObject({
      name: "MappingImportError",
      code: "VERSION_REGRESSION",
    });
    expect(fake.state.txCount).toBe(0);
  });

  it("allows equal version (idempotent re-apply) and reports zero diff", async () => {
    queueImportSelects({ snapshot: [{ payloadSummary: { version: 3 } }] });
    const res = await importMapping(yamlV(3), { dryRun: true });
    expect(res.storedVersion).toBe(3);
    expect(res.diff.changeCount).toBe(0);
    expect(res.requiresAdapterRestart).toBe(false);
  });

  it("fails ADAPTER_NOT_FOUND when the adapter code is unknown", async () => {
    fake.state.selectResults = [[]]; // no adapter row
    await expect(importMapping(yamlV(1), { dryRun: true })).rejects.toMatchObject({ code: "ADAPTER_NOT_FOUND" });
  });

  it("dry-run (default) never writes: 0 transactions, no hooks, applied=null", async () => {
    queueImportSelects();
    const res = await importMapping(yamlV(2)); // dryRun mặc định
    expect(res.dryRun).toBe(true);
    expect(res.applied).toBeNull();
    expect(fake.state.txCount).toBe(0);
    expect(fake.state.txOps).toEqual([]);
    expect(fake.clearMappingCache).not.toHaveBeenCalled();
    expect(fake.approveCurrentConfig).not.toHaveBeenCalled();
    expect(fake.logCrudOperation).not.toHaveBeenCalled();
  });

  function mutatedYaml(version: number): string {
    const file = buildMappingFile(ADAPTER, null, DB_TAGS, DB_MAPS, version);
    const tags = file.tags
      .filter((t) => t.name !== "run") // "run" thành DB-only (delete candidate)
      .map((t) => (t.name === "temp" ? { ...t, address: "40002" } : t));
    tags.push({ name: "pressure", address: "40010", datatype: "float", scale: 1, offset: 0, writable: false, enabled: true });
    const uns = [...file.uns_mappings, { tag: "pressure", uns_topic: "syn/x/pressure", enabled: true }];
    return mappingFileToYaml({ ...file, tags, uns_mappings: uns } as never);
  }

  it("apply WITHOUT prune: upserts only changed rows, never deletes, writes version metadata", async () => {
    queueImportSelects({ snapshot: [{ payloadSummary: { version: 1 } }] });
    const res = await importMapping(mutatedYaml(2), { dryRun: false, actorId: 42, actorName: "kysu" });

    expect(res.dryRun).toBe(false);
    expect(res.applied).toEqual({ tagCreates: 1, tagUpdates: 1, tagDeletes: 0, unsCreates: 1, unsUpdates: 0, unsDeletes: 0 });
    expect(res.requiresAdapterRestart).toBe(true); // device_tags đổi
    expect(fake.state.txCount).toBe(1);

    const deletes = fake.state.txOps.filter((o) => o.kind === "delete");
    expect(deletes).toEqual([]); // "run" DB-only nhưng KHÔNG prune ⇒ giữ lại
    expect(res.diff.tags.deletes).toEqual(["run"]); // ...nhưng diff vẫn liệt kê

    const tagUpserts = fake.state.txOps.filter((o) => o.kind === "upsert" && o.table === deviceTagsMock);
    expect(tagUpserts.map((o) => o.values?.tagKey).sort()).toEqual(["pressure", "temp"]);
    // upsert theo khóa tự nhiên: adapterId + tagKey
    expect(tagUpserts.every((o) => o.values?.adapterId === 7)).toBe(true);

    const unsUpserts = fake.state.txOps.filter((o) => o.kind === "upsert" && o.table === unsTagMappingsMock);
    expect(unsUpserts.map((o) => o.values?.tag)).toEqual(["pressure"]);
    expect(unsUpserts[0].values?.createdBy).toBe(42);

    // metadata version row (config_snapshots 'mapping_file') trong CÙNG transaction
    const metaUpserts = fake.state.txOps.filter((o) => o.kind === "upsert" && o.table === configSnapshotsMock);
    expect(metaUpserts).toHaveLength(1);
    expect(metaUpserts[0].values?.entityType).toBe("mapping_file");
    expect(metaUpserts[0].values?.entityId).toBe(7);
    expect((metaUpserts[0].values?.payloadSummary as Record<string, unknown>).version).toBe(2);

    // best-effort hooks sau apply
    expect(fake.clearMappingCache).toHaveBeenCalledTimes(1);
    expect(fake.approveCurrentConfig).toHaveBeenCalledWith(7, 42, "kysu");
    expect(fake.logCrudOperation).toHaveBeenCalledTimes(1);
  });

  it("apply WITH prune deletes DB-only rows (explicit flag only)", async () => {
    queueImportSelects();
    const res = await importMapping(mutatedYaml(2), { dryRun: false, prune: true });

    expect(res.applied?.tagDeletes).toBe(1); // "run"
    const tagDeletes = fake.state.txOps.filter((o) => o.kind === "delete" && o.table === deviceTagsMock);
    expect(tagDeletes).toHaveLength(1);
    const unsDeletes = fake.state.txOps.filter((o) => o.kind === "delete" && o.table === unsTagMappingsMock);
    expect(unsDeletes).toHaveLength(0); // DB không có uns_mapping thừa
  });

  it("uns-only change does NOT require adapter restart", async () => {
    const file = buildMappingFile(ADAPTER, null, DB_TAGS, DB_MAPS, 2);
    const mutated = {
      ...file,
      uns_mappings: [{ ...file.uns_mappings[0], transform: { ...file.uns_mappings[0].transform, scale: 0.2 } }],
    };
    queueImportSelects();
    const res = await importMapping(mappingFileToYaml(mutated as never), { dryRun: false });
    expect(res.requiresAdapterRestart).toBe(false);
    expect(res.applied?.unsUpdates).toBe(1);
  });
});
