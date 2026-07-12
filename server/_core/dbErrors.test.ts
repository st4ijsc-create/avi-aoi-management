/** Doc 42 Đợt 0.4 — unit tests for the shared unique-violation handler. */
import { describe, it, expect } from "vitest";
import { TRPCError } from "@trpc/server";

import { isUniqueViolation, getViolatedConstraint, rethrowDbError, withDbErrors } from "./dbErrors";

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
