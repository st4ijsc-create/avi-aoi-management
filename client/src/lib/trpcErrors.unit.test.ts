/** Doc 42 Đợt 0.5 — unit tests for the shared tRPC error mapper. */
import { describe, it, expect } from "vitest";

import { mapTrpcError } from "./trpcErrors";

function fakeTrpcError(message: string, code?: string) {
  const err = new Error(message) as Error & { data?: { code?: string } };
  if (code) err.data = { code };
  return err;
}

describe("mapTrpcError", () => {
  it("returns the server message for CONFLICT", () => {
    expect(mapTrpcError(fakeTrpcError("Mã đã tồn tại", "CONFLICT"))).toBe("Mã đã tồn tại");
  });

  it("falls back for CONFLICT messages that leak SQL", () => {
    expect(mapTrpcError(fakeTrpcError('Failed query: insert into "skills" ...', "CONFLICT"))).toBe(
      "Mã đã tồn tại",
    );
  });

  it("parses zod issue arrays into field + first message (no JSON dump)", () => {
    const zodMessage = JSON.stringify([
      { code: "invalid_type", path: ["code"], message: "Required" },
      { code: "too_small", path: ["name"], message: "String must contain at least 1 character(s)" },
    ]);
    const result = mapTrpcError(fakeTrpcError(zodMessage, "BAD_REQUEST"));
    expect(result).toContain('"code"');
    expect(result).toContain("bắt buộc nhập");
    expect(result).not.toContain("invalid_type");
    expect(result).not.toContain("[");
  });

  it("maps FORBIDDEN and UNAUTHORIZED to fixed Vietnamese messages", () => {
    expect(mapTrpcError(fakeTrpcError("nope", "FORBIDDEN"))).toBe(
      "Bạn không có quyền thực hiện thao tác này",
    );
    expect(mapTrpcError(fakeTrpcError("expired", "UNAUTHORIZED"))).toBe(
      "Phiên đăng nhập hết hạn, vui lòng đăng nhập lại",
    );
  });

  it("never surfaces 'Failed query'/SQL for unknown codes", () => {
    expect(mapTrpcError(fakeTrpcError('Failed query: insert into "x" values ($1)'))).toBe(
      "Lỗi hệ thống, vui lòng thử lại",
    );
    expect(mapTrpcError(fakeTrpcError('duplicate key value violates unique constraint "u"'))).toBe(
      "Lỗi hệ thống, vui lòng thử lại",
    );
  });

  it("truncates long plain messages to 200 chars", () => {
    const long = "a".repeat(500);
    const result = mapTrpcError(fakeTrpcError(long));
    expect(result.length).toBeLessThanOrEqual(201);
    expect(result.endsWith("…")).toBe(true);
  });

  it("keeps short plain messages as-is and handles non-errors", () => {
    expect(mapTrpcError(fakeTrpcError("Không tìm thấy sản phẩm"))).toBe("Không tìm thấy sản phẩm");
    expect(mapTrpcError(null)).toBe("Lỗi hệ thống, vui lòng thử lại");
    expect(mapTrpcError("boom")).toBe("boom");
  });
});
