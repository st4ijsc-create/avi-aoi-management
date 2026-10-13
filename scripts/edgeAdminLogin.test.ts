/** doc 81 Đợt 10 F2 round 2 (N7) — the operator CLIs' admin-secret channels: TTY prompt, else piped stdin; env refused. */
import { describe, it, expect } from "vitest";
import { PassThrough } from "node:stream";
import { proveAdminWith, readAdminSecrets, setSecretEnv, stdinReader, STDIN_LIMIT_BYTES } from "./edgeAdminLogin";

describe("N7 — edgeAdminLogin", () => {
  it("setSecretEnv lists only the SET (non-empty) secret variables", () => {
    expect(setSecretEnv({ A: "x", B: "", C: undefined }, ["A", "B", "C", "D"])).toEqual(["A"]);
  });
  it("TTY prompt first (interactive); piped stdin second: line 1 password, line 2 code (CRLF ok); nothing ⇒ nulls", async () => {
    expect(await readAdminSecrets({ promptSecret: async () => "pw", readStdin: async () => "other\n" }, "a")).toEqual({ password: "pw", otp: null, interactive: true });
    expect(await readAdminSecrets({ promptSecret: async () => null, readStdin: async () => "pw\r\n123456\r\n" }, "a")).toEqual({ password: "pw", otp: "123456", interactive: false });
    expect(await readAdminSecrets({ readStdin: async () => "pw" }, "a")).toEqual({ password: "pw", otp: null, interactive: false });
    expect(await readAdminSecrets({ readStdin: async () => null }, "a")).toEqual({ password: null, otp: null, interactive: false });
    expect(await readAdminSecrets({}, "a")).toEqual({ password: null, otp: null, interactive: false });
  });
  it("proveAdminWith asks a missing 2FA code ONCE on a TTY, never on a pipe", async () => {
    const calls: Array<string | null> = [];
    const verify = async (l: { otp: string | null }) => {
      calls.push(l.otp);
      if (!l.otp) throw Object.assign(new Error("2FA required"), { code: "otpRequired" });
      return { userId: 1, name: "a" };
    };
    expect(await proveAdminWith(verify, { promptSecret: async () => "111111" }, "a", { password: "pw", otp: null, interactive: true })).toEqual({ userId: 1, name: "a" });
    expect(calls).toEqual([null, "111111"]);
    await expect(proveAdminWith(verify, { promptSecret: async () => "111111" }, "a", { password: "pw", otp: null, interactive: false })).rejects.toMatchObject({ code: "otpRequired" });
  });
  it("stdinReader: null on a TTY; all piped text otherwise; > STDIN_LIMIT_BYTES ⇒ refused", async () => {
    const tty = Object.assign(new PassThrough(), { isTTY: true });
    expect(await stdinReader(tty)()).toBeNull();
    const p = new PassThrough();
    const r = stdinReader(p)();
    p.end("pw\n123456\n");
    expect(await r).toBe("pw\n123456\n");
    const big = new PassThrough();
    const rb = stdinReader(big)();
    big.write(Buffer.alloc(STDIN_LIMIT_BYTES + 1, 0x41));
    await expect(rb).rejects.toThrow(/larger than/);
  });
});
