/**
 * doc 81 Đợt 9 final wave F7 — verifyCredentialAdmin fails CLOSED where the real-DB CLI test cannot reach: the account's 2FA
 * state unreadable (no DB / error) ⇒ refused, never "2FA off"; a non-LoginError from the password check ⇒ refused (dbUnavailable),
 * never a verified id. Collaborators replaced (the password check itself is measured on _test by edge-node-credential.dot9).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  twoFa: null as null | { twoFactorEnabled: boolean; twoFactorSecret: string | null } | "throw",
  login: "ok" as "ok" | "boom",
}));
vi.mock("../../_core/authService", () => {
  class LoginError extends Error {
    constructor(public code: string) {
      super(code);
    }
  }
  return {
    LoginError,
    verifyCredentials: async () => {
      if (h.login === "boom") throw new Error("connection terminated");
      return { id: 7, role: "admin", isActive: true, name: "adm" };
    },
  };
});
vi.mock("../../db/auth", () => ({
  get2FAStatus: async () => {
    if (h.twoFa === "throw") throw new Error("db down");
    return h.twoFa;
  },
}));

import { verifyCredentialAdmin, EdgeCredentialError } from "./edgeNodeCredentials";

beforeEach(() => {
  h.twoFa = { twoFactorEnabled: false, twoFactorSecret: null };
  h.login = "ok";
});

describe("final wave F7 — the admin proof fails closed", () => {
  it("control: password ok, 2FA off ⇒ the verified admin", async () => {
    await expect(verifyCredentialAdmin({ username: "adm", password: "pw" })).resolves.toEqual({ userId: 7, name: "adm" });
  });
  it.each([["null (no DB)", null], ["a read error", "throw"]] as const)("★ 2FA state unreadable (%s) ⇒ refused, never treated as 'off'", async (_l, v) => {
    h.twoFa = v as never;
    await expect(verifyCredentialAdmin({ username: "adm", password: "pw" })).rejects.toMatchObject({ code: "dbUnavailable" });
  });
  it("★ the password check failing for another reason than a refused login ⇒ refused (no id)", async () => {
    h.login = "boom";
    const err = await verifyCredentialAdmin({ username: "adm", password: "pw" }).catch((e) => e);
    expect(err).toBeInstanceOf(EdgeCredentialError);
    expect(err.code).toBe("dbUnavailable");
  });
  it("2FA on but no secret stored ⇒ refused", async () => {
    h.twoFa = { twoFactorEnabled: true, twoFactorSecret: null };
    await expect(verifyCredentialAdmin({ username: "adm", password: "pw", otp: "123456" })).rejects.toMatchObject({ code: "notVerified" });
  });
});
