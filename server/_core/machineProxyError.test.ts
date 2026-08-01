/**
 * Doc 51 P2 (§5.6 / CASE #2) — machine REST proxy error contract.
 *
 * Proves the fix for the "lossy 400" bug: the `/api/machine/*` proxies used to
 * collapse EVERY tRPC failure into HTTP 400 + a full base64 payload log. This
 * suite pins:
 *  - TRPCError.code → real HTTP status (401/403/404/409/413/429/400/503/500)
 *  - `retryable` truthfulness — transient faults (throttle, DB down, INTERNAL)
 *    say retryable:true so the machine re-sends instead of DROPPING the record;
 *    client-fault codes (bad request, not found, forbidden) say retryable:false
 *  - Retry-After surfaced on 429
 *  - the response keeps the legacy `{success:false, message}` shape (backward compat)
 *  - safeMachineLogMeta never emits base64 image data or the apiKey credential
 *
 * These are mutation tests: revert INTERNAL→503 back to 400, or drop `retryable`,
 * or log the raw body, and a case here goes red.
 */
import { describe, it, expect } from "vitest";
import { TRPCError } from "@trpc/server";
import {
  classifyMachineProxyError,
  sendMachineProxyError,
  safeMachineLogMeta,
} from "./machineProxyError";

function fakeRes() {
  const state: { status?: number; body?: any; headers: Record<string, string> } = {
    headers: {},
  };
  const res = {
    set(name: string, value: string) {
      state.headers[name] = value;
      return res;
    },
    status(code: number) {
      state.status = code;
      return res;
    },
    json(payload: any) {
      state.body = payload;
      return res;
    },
  };
  return { res: res as any, state };
}

describe("classifyMachineProxyError — code → status + retryable", () => {
  const cases: Array<[string, number, boolean]> = [
    ["UNAUTHORIZED", 401, false],
    ["FORBIDDEN", 403, false],
    ["NOT_FOUND", 404, false],
    ["BAD_REQUEST", 400, false],
    ["PARSE_ERROR", 400, false],
    ["CONFLICT", 409, false],
    ["PAYLOAD_TOO_LARGE", 413, false],
    ["TIMEOUT", 503, true],
    ["INTERNAL_SERVER_ERROR", 503, true],
  ];

  for (const [code, status, retryable] of cases) {
    it(`${code} → ${status} (retryable=${retryable})`, () => {
      const info = classifyMachineProxyError(new TRPCError({ code: code as any }));
      expect(info.status).toBe(status);
      expect(info.retryable).toBe(retryable);
    });
  }

  it("TOO_MANY_REQUESTS → 429 retryable with a 60s default Retry-After", () => {
    const info = classifyMachineProxyError(new TRPCError({ code: "TOO_MANY_REQUESTS" }));
    expect(info.status).toBe(429);
    expect(info.retryable).toBe(true);
    expect(info.retryAfter).toBe(60);
  });

  it("TOO_MANY_REQUESTS honours an explicit retryAfter when the error carries one", () => {
    const err: any = new TRPCError({ code: "TOO_MANY_REQUESTS" });
    err.retryAfter = 12.4;
    const info = classifyMachineProxyError(err);
    expect(info.status).toBe(429);
    expect(info.retryAfter).toBe(13); // ceil
  });

  it("a plain Error('Database not available') is a transient 503, not a 400", () => {
    const info = classifyMachineProxyError(new Error("Database not available"));
    expect(info.status).toBe(503);
    expect(info.retryable).toBe(true);
  });

  it("an ECONNREFUSED plain Error is a transient 503", () => {
    const info = classifyMachineProxyError(new Error("connect ECONNREFUSED 127.0.0.1:5434"));
    expect(info.status).toBe(503);
    expect(info.retryable).toBe(true);
  });

  it("an unknown/uncoded error is an honest 500, not a client-blaming 400", () => {
    const info = classifyMachineProxyError(new Error("something weird happened"));
    expect(info.status).toBe(500);
    expect(info.retryable).toBe(false);
  });
});

describe("sendMachineProxyError — HTTP response contract", () => {
  it("maps 401 and keeps the backward-compatible {success:false,message} shape + retryable", () => {
    const { res, state } = fakeRes();
    sendMachineProxyError(res, new TRPCError({ code: "UNAUTHORIZED", message: "bad key" }), "fallback");
    expect(state.status).toBe(401);
    expect(state.body).toEqual({ success: false, retryable: false, message: "bad key" });
    expect(state.headers["Retry-After"]).toBeUndefined();
  });

  it("emits Retry-After on 429", () => {
    const { res, state } = fakeRes();
    sendMachineProxyError(res, new TRPCError({ code: "TOO_MANY_REQUESTS" }), "fallback");
    expect(state.status).toBe(429);
    expect(state.body.retryable).toBe(true);
    expect(state.headers["Retry-After"]).toBe("60");
  });

  it("a DB-down failure surfaces as 503 retryable so the machine re-sends (no data loss)", () => {
    const { res, state } = fakeRes();
    sendMachineProxyError(res, new Error("Database not available"), "Submit inspection failed");
    expect(state.status).toBe(503);
    expect(state.body.retryable).toBe(true);
    expect(state.headers["Retry-After"]).toBeUndefined();
  });

  it("falls back to the provided message when the error has none", () => {
    const { res, state } = fakeRes();
    sendMachineProxyError(res, { code: "BAD_REQUEST" }, "Submit inspection failed");
    expect(state.status).toBe(400);
    expect(state.body.message).toBe("Submit inspection failed");
  });
});

describe("safeMachineLogMeta — no base64 / no credential leak (CASE #2 log fix)", () => {
  const body = {
    machineCode: "AOI-01",
    serialNumber: "SN-123",
    apiKey: "super-secret-key",
    measurements: [
      { pointCode: "P1", result: "OK", imageBase64: "AAAA".repeat(5000) },
      { pointCode: "P2", result: "NG", imageBase64: "BBBB".repeat(5000) },
    ],
  };

  it("returns only the three safe scalar fields", () => {
    expect(safeMachineLogMeta(body)).toEqual({
      machineCode: "AOI-01",
      serialNumber: "SN-123",
      measurements: 2,
    });
  });

  it("the serialized meta contains NO base64 image data and NO apiKey", () => {
    const serialized = JSON.stringify(safeMachineLogMeta(body));
    expect(serialized).not.toContain("AAAA");
    expect(serialized).not.toContain("BBBB");
    expect(serialized).not.toContain("super-secret-key");
    expect(serialized).not.toContain("imageBase64");
  });

  it("degrades safely when fields are missing or malformed", () => {
    expect(safeMachineLogMeta({})).toEqual({ machineCode: "?", serialNumber: "?", measurements: 0 });
    expect(safeMachineLogMeta(undefined)).toEqual({ machineCode: "?", serialNumber: "?", measurements: 0 });
    expect(safeMachineLogMeta({ measurements: "not-an-array" })).toEqual({
      machineCode: "?",
      serialNumber: "?",
      measurements: 0,
    });
  });
});
