/**
 * R1b-2a final-fix M-5 — `planTargets` / `cungCsdl` of scripts/apply-migration-dot10-common.mjs (pure: no connection is opened).
 * Before the fix, DATABASE_URL = …/x_test with `--both` produced TWO targets on the SAME database, the first labelled "dev".
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cungCsdl, planTargets, testDbUrl } from "./apply-migration-dot10-common.mjs";

const DEV = "postgres://avi_app:pw@127.0.0.1:5434/aoi_management";
const TEST = "postgres://avi_app:pw@127.0.0.1:5434/aoi_management_test";

function datEnv(dbUrl: string, testUrl?: string) {
  vi.stubEnv("DATABASE_URL", dbUrl);
  vi.stubEnv("TEST_DATABASE_URL", testUrl ?? "");
  if (testUrl === undefined) delete process.env.TEST_DATABASE_URL;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("final-fix M-5 — planTargets: the dev target is never the test DB, one DB is never two targets", () => {
  it("normal dev URL: --both ⇒ dev + test (test derived as _test); --dev-only ⇒ dev; --test-only ⇒ test", () => {
    datEnv(DEV);
    expect(planTargets(["--both"], DEV)).toEqual([
      [DEV, "dev"],
      [TEST, "test"],
    ]);
    expect(planTargets(["--dev-only"], DEV)).toEqual([[DEV, "dev"]]);
    expect(planTargets(["--test-only"], DEV)).toEqual([[TEST, "test"]]);
  });

  it("DATABASE_URL already the _test DB (vitest.setup env): --both ⇒ REFUSED (was: same DB twice, first pass labelled 'dev')", () => {
    datEnv(TEST);
    expect(testDbUrl()).toBe(TEST); // the root cause: no doubled suffix
    expect(() => planTargets(["--both"], TEST)).toThrow(/test DB.*refused$/);
  });

  it("DATABASE_URL already the _test DB: --dev-only ⇒ REFUSED (the 'dev' label would sit on a test DB)", () => {
    datEnv(TEST);
    expect(() => planTargets(["--dev-only"], TEST)).toThrow(/use --test-only — refused$/);
  });

  it("DATABASE_URL already the _test DB: --test-only ⇒ exactly ONE target, labelled 'test'", () => {
    datEnv(TEST);
    expect(planTargets(["--test-only"], TEST)).toEqual([[TEST, "test"]]);
  });

  it("TEST_DATABASE_URL names the dev DB itself (other credentials): --both ⇒ refused before any connection (not a test DB name)", () => {
    datEnv(DEV, "postgres://aoi:other@127.0.0.1:5434/aoi_management");
    expect(() => planTargets(["--both"], DEV)).toThrow(/does not look like a test DB/);
  });

  it("dev DB name with 'test' inside (not a _test suffix) and TEST_DATABASE_URL = that same DB: --both ⇒ REFUSED as the SAME database", () => {
    const devTest = "postgres://avi_app:pw@127.0.0.1:5434/testbed_dev";
    datEnv(devTest, "postgres://aoi:x@127.0.0.1:5434/testbed_dev");
    expect(() => planTargets(["--both"], devTest)).toThrow(/SAME database.*refused$/);
  });

  it("cungCsdl: credentials ignored; host case-insensitive; default port 5432; different DB / port ⇒ false", () => {
    expect(cungCsdl("postgres://a:b@Host/db1", "postgres://c:d@host:5432/db1")).toBe(true);
    expect(cungCsdl("postgres://a:b@host:5434/db1", "postgres://a:b@host:5433/db1")).toBe(false);
    expect(cungCsdl("postgres://a:b@host/db1", "postgres://a:b@host/db1_test")).toBe(false);
  });

  it("DATABASE_URL missing ⇒ refused", () => {
    expect(() => planTargets(["--both"], "")).toThrow(/DATABASE_URL not set — refused/);
  });
});
