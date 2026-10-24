/**
 * doc 81 Đợt 10 task F2 — totpReplayScan §2b condition, measured on the REAL `_test` ledger: the operator-CLI admin proof
 * (`verifyCredentialAdmin`, run in a CLI process outside any web request) and the web path (`verifyTotpOnce` as tRPC /
 * /api/auth/verify-2fa call it) consume TOTP codes in ONE ledger (`totp_consumed`, mig 0313). So a code used at the CLI is a
 * replay on the web and vice versa — the "two ledgers in two processes" hole the census guards against does not exist.
 * Only the password check (`verifyCredentials`) and the 2FA-state read (`get2FAStatus`) are stubbed; the TOTP verifier and
 * its ledger are the real ones.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import speakeasy from "speakeasy";
import { sql } from "drizzle-orm";

const USER_ID = 2_000_000_000 + Math.floor(Math.random() * 100_000_000);
const SECRET = speakeasy.generateSecret({ length: 20 }).base32;

vi.mock("../../_core/authService", async (orig) => {
  const actual = await orig<typeof import("../../_core/authService")>();
  return { ...actual, verifyCredentials: vi.fn(async () => ({ id: USER_ID, role: "admin", isActive: true, name: "F2 probe admin" })) };
});
vi.mock("../../db/auth", async (orig) => {
  const actual = await orig<typeof import("../../db/auth")>();
  return { ...actual, get2FAStatus: vi.fn(async () => ({ twoFactorEnabled: true, twoFactorSecret: SECRET })) };
});

import { verifyCredentialAdmin, EdgeCredentialError } from "./edgeNodeCredentials";
import { verifyTotpOnce } from "../../_core/totpOnce";
import { getDb } from "../../db/connection";

/** A valid code of a given 30 s step offset (window 1 accepts −1 / 0 / +1). */
const codeAt = (stepOffset: number) => speakeasy.totp({ secret: SECRET, encoding: "base32", time: Math.floor(Date.now() / 1000) + stepOffset * 30 });

async function ledgerRows(): Promise<number> {
  const db = await getDb();
  const r = (await db!.execute(sql`SELECT count(*)::int AS n FROM public.totp_consumed WHERE "userId" = ${USER_ID}`)) as unknown as Array<{ n: number }> | { rows: Array<{ n: number }> };
  return (Array.isArray(r) ? r : r.rows)[0].n;
}

beforeAll(async () => {
  expect(process.env.ROLE ?? "", "the ledger refuses ROLE=worker by design").not.toBe("worker");
  const db = await getDb();
  expect(db, "the _test DB is required").toBeTruthy();
});
afterAll(async () => {
  const db = await getDb();
  await db?.execute(sql`DELETE FROM public.totp_consumed WHERE "userId" = ${USER_ID}`);
  // SCADA R1a T16 — the wrong / replayed codes above are counted by the per-user failed-TOTP counter (mig 0432): clean its row too.
  await db?.execute(sql`DELETE FROM public.totp_khoa_sai WHERE user_id = ${USER_ID}`);
});

describe("totpReplayScan §2b — the CLI admin proof and the web path share ONE TOTP ledger", () => {
  it("a code consumed by the CLI proof is a REPLAY for the web path (and for a second CLI run)", async () => {
    const code = codeAt(0);
    const ok = await verifyCredentialAdmin({ username: "f2-probe", password: "x", otp: code });
    expect(ok.userId).toBe(USER_ID);
    expect(await ledgerRows()).toBeGreaterThanOrEqual(1);
    await expect(verifyCredentialAdmin({ username: "f2-probe", password: "x", otp: code })).rejects.toMatchObject({ code: "notVerified", message: expect.stringMatching(/already used/) });
    const web = await verifyTotpOnce({ userId: USER_ID, secret: SECRET, token: code });
    expect(web).toEqual({ hopLe: false, phatLai: true });
  });

  it("a code consumed by the web path is refused by the CLI proof", async () => {
    const code = codeAt(-1) === codeAt(0) ? codeAt(1) : codeAt(-1);
    const web = await verifyTotpOnce({ userId: USER_ID, secret: SECRET, token: code });
    expect(web).toEqual({ hopLe: true, phatLai: false });
    const err = await verifyCredentialAdmin({ username: "f2-probe", password: "x", otp: code }).catch((e) => e);
    expect(err).toBeInstanceOf(EdgeCredentialError);
    expect((err as EdgeCredentialError).message).toMatch(/already used/);
  });

  it("2FA on and no code ⇒ otpRequired; a wrong code ⇒ notVerified (nothing consumed)", async () => {
    const before = await ledgerRows();
    await expect(verifyCredentialAdmin({ username: "f2-probe", password: "x" })).rejects.toMatchObject({ code: "otpRequired" });
    await expect(verifyCredentialAdmin({ username: "f2-probe", password: "x", otp: "000000" === codeAt(0) ? "111111" : "000000" })).rejects.toMatchObject({ code: "notVerified" });
    expect(await ledgerRows()).toBe(before);
  });
});
