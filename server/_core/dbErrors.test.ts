/** Doc 42 Đợt 0.4 — unit tests for the shared unique-violation handler.
 * doc69/E3-2 fix — unit tests for isMissingTable (42P01 undefined-table detection). */
import { describe, it, expect } from "vitest";
import { TRPCError } from "@trpc/server";

import {
  isUniqueViolation,
  isMissingTable,
  isMissingColumn,
  getViolatedConstraint,
  rethrowDbError,
  withDbErrors,
} from "./dbErrors";

function pgUniqueError() {
  const err = new Error('duplicate key value violates unique constraint "skills_code_unique"') as Error & {
    code: string;
    constraint_name: string;
  };
  err.code = "23505";
  err.constraint_name = "skills_code_unique";
  return err;
}

function drizzleWrapped() {
  // drizzle-orm 0.44 DrizzleQueryError shape: "Failed query: ..." with driver err in cause
  const wrapped = new Error('Failed query: insert into "skills" ("code") values ($1)');
  (wrapped as Error & { cause: unknown }).cause = pgUniqueError();
  return wrapped;
}

function pgMissingTableError() {
  const err = new Error('relation "kb_corpora" does not exist') as Error & { code: string };
  err.code = "42P01";
  return err;
}

function drizzleWrappedMissingTable() {
  // The REAL shape a drizzle-orm ≥0.44 query against an unmigrated table produces: a
  // "Failed query: ..." wrapper Error whose top-level `.code` is undefined, with the real
  // postgres.js driver error (code 42P01 and all) on `.cause`. THIS is the case that was
  // broken by the naive `(e as {code}).code === "42P01"` check in kbStudioService.ts /
  // kbVectorStore.ts — the top-level object has no `code` property at all.
  const wrapped = new Error('Failed query: select "id" from "kb_corpora" order by "createdAt" desc');
  (wrapped as Error & { cause: unknown }).cause = pgMissingTableError();
  return wrapped;
}

describe("isUniqueViolation", () => {
  it("detects a raw postgres.js 23505 error", () => {
    expect(isUniqueViolation(pgUniqueError())).toBe(true);
  });

  it("detects a drizzle 'Failed query' wrapper via cause chain", () => {
    expect(isUniqueViolation(drizzleWrapped())).toBe(true);
  });

  it("detects by message when code is missing", () => {
    expect(isUniqueViolation(new Error("duplicate key value violates unique constraint \"x\""))).toBe(true);
  });

  it("ignores unrelated errors and non-errors", () => {
    expect(isUniqueViolation(new Error("connection refused"))).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation("boom")).toBe(false);
  });
});

describe("isMissingTable", () => {
  it("detects a raw postgres.js 42P01 error", () => {
    expect(isMissingTable(pgMissingTableError())).toBe(true);
  });

  it("detects a drizzle 'Failed query' wrapper via cause chain (the shape that broke the naive check)", () => {
    expect(isMissingTable(drizzleWrappedMissingTable())).toBe(true);
  });

  it("detects by message when code is missing", () => {
    expect(isMissingTable(new Error('relation "kb_corpora" does not exist'))).toBe(true);
  });

  it("ignores unrelated errors, including a DIFFERENT postgres error code (23505)", () => {
    expect(isMissingTable(pgUniqueError())).toBe(false);
    expect(isMissingTable(drizzleWrapped())).toBe(false);
    expect(isMissingTable(new Error("connection refused"))).toBe(false);
    expect(isMissingTable(new Error("generic failure"))).toBe(false);
    expect(isMissingTable(null)).toBe(false);
    expect(isMissingTable("boom")).toBe(false);
  });
});

function pgMissingColumnError() {
  const err = new Error('column "aiAnalysisResult" of relation "measurement_results" does not exist') as Error & {
    code: string;
  };
  err.code = "42703";
  return err;
}

function drizzleWrappedMissingColumn() {
  // Same wrap shape as drizzleWrappedMissingTable, but 42703 (undefined column) — the
  // shape a pre-migration UPDATE against a not-yet-added column produces.
  const wrapped = new Error('Failed query: update "measurement_results" set "aiAnalysisResult" = $1 where "id" = $2');
  (wrapped as Error & { cause: unknown }).cause = pgMissingColumnError();
  return wrapped;
}

describe("isMissingColumn", () => {
  it("detects a raw postgres.js 42703 error", () => {
    expect(isMissingColumn(pgMissingColumnError())).toBe(true);
  });

  it("detects a drizzle 'Failed query' wrapper via cause chain (the shape a naive .code check misses)", () => {
    expect(isMissingColumn(drizzleWrappedMissingColumn())).toBe(true);
  });

  it("detects by message when code is missing", () => {
    expect(isMissingColumn(new Error('column "x" of relation "y" does not exist'))).toBe(true);
  });

  it("ignores unrelated errors, including a DIFFERENT postgres error code (42P01 missing table)", () => {
    expect(isMissingColumn(pgMissingTableError())).toBe(false);
    expect(isMissingColumn(drizzleWrappedMissingTable())).toBe(false);
    expect(isMissingColumn(pgUniqueError())).toBe(false);
    expect(isMissingColumn(new Error("connection refused"))).toBe(false);
    expect(isMissingColumn(null)).toBe(false);
    expect(isMissingColumn("boom")).toBe(false);
  });
});

describe("getViolatedConstraint", () => {
  it("reads constraint_name through the cause chain", () => {
    expect(getViolatedConstraint(drizzleWrapped())).toBe("skills_code_unique");
  });
});

describe("rethrowDbError", () => {
  it("maps unique violations to CONFLICT with the default message", () => {
    try {
      rethrowDbError(drizzleWrapped());
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(TRPCError);
      expect((err as TRPCError).code).toBe("CONFLICT");
      expect((err as TRPCError).message).toBe("Mã đã tồn tại");
    }
  });

  it("uses the custom conflictMessage", () => {
    expect(() => rethrowDbError(pgUniqueError(), { conflictMessage: "Mã kỹ năng đã tồn tại" })).toThrowError(
      "Mã kỹ năng đã tồn tại",
    );
  });

  it("passes existing TRPCErrors through untouched", () => {
    const original = new TRPCError({ code: "FORBIDDEN", message: "nope" });
    try {
      rethrowDbError(original);
      expect.unreachable();
    } catch (err) {
      expect(err).toBe(original);
    }
  });

  it("re-throws unrelated errors as-is", () => {
    const boom = new Error("connection refused");
    expect(() => rethrowDbError(boom)).toThrow(boom);
  });
});

describe("withDbErrors", () => {
  it("returns the value on success", async () => {
    await expect(withDbErrors(async () => 42)).resolves.toBe(42);
  });

  it("translates unique violations thrown by fn", async () => {
    await expect(
      withDbErrors(async () => {
        throw drizzleWrapped();
      }),
    ).rejects.toMatchObject({ code: "CONFLICT", message: "Mã đã tồn tại" });
  });
});
