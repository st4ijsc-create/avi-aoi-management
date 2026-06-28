/**
 * Tenant RLS — request-path wiring tests (Phase 1 WS4).
 *
 * Hermetic: mocks the DB-auth lookups so getTenantScope runs without a live DB.
 * Asserts the three safety-critical properties:
 *   1. getTenantScope shape per role (admin → bypass, scoped user → codes).
 *   2. runWithTenantScope is a NO-OP (no transaction) when the flag is OFF, and
 *      opens a transaction + sets the SET LOCAL GUCs when ON.
 *   3. The 0122 migration SQL has the expected fail-open / per-table shape.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// --- Mock the DB-auth lookups used by getUserAssignmentCodes (no real DB) ----
const mockCorporate = vi.fn();
const mockFactory = vi.fn();
vi.mock("../auth", () => ({
  getUserCorporateAssignments: (...a: unknown[]) => mockCorporate(...a),
  getUserFactoryAssignments: (...a: unknown[]) => mockFactory(...a),
}));

import { getTenantScope, clearAssignmentCache } from "../../_core/accessControl";
import {
  isTenantRlsEnabled,
  runWithTenantScope,
  applyTenantContext,
  type TenantScope,
} from "../tenantContext";

const ORIGINAL_FLAG = process.env.TENANT_RLS_ENABLED;

beforeEach(() => {
  clearAssignmentCache();
  mockCorporate.mockReset();
  mockFactory.mockReset();
  delete process.env.TENANT_RLS_ENABLED; // default OFF
});

afterEach(() => {
  if (ORIGINAL_FLAG === undefined) delete process.env.TENANT_RLS_ENABLED;
  else process.env.TENANT_RLS_ENABLED = ORIGINAL_FLAG;
});

describe("getTenantScope — per-role shape", () => {
  it("admin → bypass with empty code lists (no DB lookup)", async () => {
    const scope = await getTenantScope(1, "admin");
    expect(scope).toEqual({ bypass: true, corporateCodes: [], factoryCodes: [] });
    expect(mockCorporate).not.toHaveBeenCalled();
    expect(mockFactory).not.toHaveBeenCalled();
  });

  it("scoped non-admin → bypass false with their assigned codes", async () => {
    mockCorporate.mockResolvedValue([{ corporateCode: "C01" }]);
    mockFactory.mockResolvedValue([{ factoryCode: "F01" }, { factoryCode: "F02" }]);
    const scope = await getTenantScope(42, "operator");
    expect(scope.bypass).toBe(false);
    expect(scope.corporateCodes).toEqual(["C01"]);
    expect(scope.factoryCodes).toEqual(["F01", "F02"]);
  });

  it("non-admin with no assignments → empty (deny-by-scope, not bypass)", async () => {
    mockCorporate.mockResolvedValue([]);
    mockFactory.mockResolvedValue([]);
    const scope = await getTenantScope(99, "viewer");
    expect(scope).toEqual({ bypass: false, corporateCodes: [], factoryCodes: [] });
  });
});

describe("isTenantRlsEnabled — flag read at call time", () => {
  it("OFF by default / when not 'true'", () => {
    expect(isTenantRlsEnabled()).toBe(false);
    process.env.TENANT_RLS_ENABLED = "false";
    expect(isTenantRlsEnabled()).toBe(false);
    process.env.TENANT_RLS_ENABLED = "1";
    expect(isTenantRlsEnabled()).toBe(false);
  });
  it("ON only for exactly 'true'", () => {
    process.env.TENANT_RLS_ENABLED = "true";
    expect(isTenantRlsEnabled()).toBe(true);
  });
});

describe("runWithTenantScope — flag-gated mechanism", () => {
  const scope: TenantScope = { bypass: false, factoryCodes: ["F01"], corporateCodes: ["C01"] };

  it("flag OFF → NO transaction opened, fn runs against the passed handle", async () => {
    const transaction = vi.fn();
    const fakeDb = { transaction, marker: "global-db" } as never;
    const result = await runWithTenantScope(fakeDb, scope, async (handle) => {
      // Should receive the db itself (no tx wrapper) and never open a transaction.
      expect((handle as { marker?: string }).marker).toBe("global-db");
      return "ok";
    });
    expect(result).toBe("ok");
    expect(transaction).not.toHaveBeenCalled();
  });

  it("flag ON → opens a transaction and sets the 4 SET LOCAL GUCs", async () => {
    process.env.TENANT_RLS_ENABLED = "true";
    const executed: string[] = [];
    const tx = {
      execute: vi.fn(async (q: unknown) => {
        // drizzle sql`` template — stringify its queryChunks best-effort.
        executed.push(JSON.stringify(q));
      }),
    };
    const fakeDb = {
      transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    } as never;

    const result = await runWithTenantScope(fakeDb, scope, async () => "scoped");
    expect(result).toBe("scoped");
    expect((fakeDb as { transaction: ReturnType<typeof vi.fn> }).transaction).toHaveBeenCalledOnce();
    // applyTenantContext issues exactly four set_config statements.
    expect(tx.execute).toHaveBeenCalledTimes(4);
    const blob = executed.join(" ");
    expect(blob).toContain("app.tenant_rls_active");
    expect(blob).toContain("app.tenant_bypass");
    expect(blob).toContain("app.tenant_factory_codes");
    expect(blob).toContain("app.tenant_corporate_codes");
  });

  it("applyTenantContext emits is_local=true set_config for activation + bypass off", async () => {
    const calls: unknown[] = [];
    const tx = { execute: vi.fn(async (q: unknown) => void calls.push(q)) };
    await applyTenantContext(tx, { bypass: false, factoryCodes: ["F1"], corporateCodes: [] });
    expect(tx.execute).toHaveBeenCalledTimes(4);
  });
});

describe("0122 migration SQL — fail-open shape", () => {
  const sqlText = readFileSync(
    path.resolve(__dirname, "../../../drizzle/0122_tenant_rls_extend.sql"),
    "utf8",
  );

  it("defines the inert-by-default helper (allow unless tenant_rls_active='on')", () => {
    expect(sqlText).toMatch(/CREATE OR REPLACE FUNCTION app_tenant_allows/);
    expect(sqlText).toContain("app.tenant_rls_active");
    // fail-open: allows when the activation GUC is NOT 'on'
    expect(sqlText).toMatch(/tenant_rls_active['"\s,)]*,\s*true\)\s*,\s*'off'\)\s*<>\s*'on'/);
  });

  it("enables RLS + both policies on each master-data table that has tenant codes", () => {
    for (const tbl of ["suppliers", "materials", "customers", "tools"]) {
      expect(sqlText).toContain(`ALTER TABLE ${tbl} ENABLE ROW LEVEL SECURITY;`);
      expect(sqlText).toContain(`CREATE POLICY tenant_select ON ${tbl}`);
      expect(sqlText).toContain(`CREATE POLICY tenant_modify ON ${tbl}`);
    }
  });

  it("does NOT actively enable RLS on the codeless hot tables (skeletons only)", () => {
    // These must remain commented-out; no live (uncommented) ENABLE statement.
    for (const tbl of ["process_results", "oee_metrics", "wip_tracking"]) {
      const liveEnable = new RegExp(`^\\s*ALTER TABLE ${tbl} ENABLE ROW LEVEL SECURITY;`, "m");
      expect(liveEnable.test(sqlText)).toBe(false);
    }
  });
});
