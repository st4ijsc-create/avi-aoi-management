/**
 * doc 81 Đợt 9 task S1/S5 — the operator CLI `scripts/edge-node-credential.ts` on the REAL `_test` DB: issue with `--out` writes
 * the secret ONLY to a new 0600 file (never to stdout, never over an existing file, no file left behind on a refusal); without
 * `--out` it is printed once; rotate / revoke / list follow the rows; a non-admin actor and bad arguments are refused.
 *
 * doc 81 Đợt 9 final wave F7 (final review M7) — the admin is PROVEN, never self-asserted: `--actor <username>` + the account's
 * password (TTY prompt / piped stdin — Đợt 10 F2 round 2 N7: never argv, never an env var) through the web login's own check,
 * + its TOTP code when 2FA is on (a wrong code is audited and counted into the lockout — N8).
 * `--actor-user-id` (anyone holding DATABASE_URL could name any admin) is refused; a wrong password / no password / a missing or
 * wrong 2FA code / a non-admin ⇒ refused before anything is written.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import postgres from "postgres";
import bcrypt from "bcryptjs";
import speakeasy from "speakeasy";
import { runEdgeCredentialCli, type CliIo } from "./edge-node-credential";

const DB_URL = process.env.DATABASE_URL;
const DAU = `S9CLI-${Date.now()}`;
const PW = { admin: `adm-${DAU}-Pw!`, eng: `eng-${DAU}-Pw!`, admin2fa: `tfa-${DAU}-Pw!` };
const ids = { admin: 0, eng: 0, admin2fa: 0, node: 0 };
const secret2fa = speakeasy.generateSecret({ length: 20 }).base32;
let sql: ReturnType<typeof postgres>;
let dir = "";

async function cli(argv: string[], io: Partial<CliIo> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runEdgeCredentialCli(argv, { out: (l) => out.push(l), err: (l) => err.push(l), env: {}, ...io });
  return { code, out: out.join("\n"), err: err.join("\n") };
}
/** N7 (Đợt 10 F2 round 2): the password is PIPED on stdin (line 1), the 2FA code on line 2 — never an env var */
const pipe = (...lines: string[]) => ({ readStdin: async () => lines.join("\n") + "\n" });
const asAdmin = pipe(PW.admin);
const credCount = async () => Number((await sql`SELECT count(*)::int AS n FROM edge_node_credentials WHERE "edgeNodeId" = ${ids.node}`)[0].n);

describe.skipIf(!DB_URL)("doc 81 Đợt 9 S1/S5 — edge node credential CLI (_test)", () => {
  beforeAll(async () => {
    expect(DB_URL).toMatch(/_test/);
    sql = postgres(DB_URL!, { max: 1, connect_timeout: 30, onnotice: () => {} });
    const user = async (tag: string, role: string, pw: string, twoFa = false) => {
      const id = Number((await sql`INSERT INTO users ("openId", username, name, role, "isActive", two_factor_enabled) VALUES (${`${DAU}-${tag}`}, ${`${DAU}-${tag}`}, ${`cli ${tag}`}, ${role}, true, ${twoFa}) RETURNING id`)[0].id);
      await sql`INSERT INTO user_secrets ("userId", "passwordHash", "twoFactorSecret") VALUES (${id}, ${await bcrypt.hash(pw, 4)}, ${twoFa ? secret2fa : null})`;
      return id;
    };
    ids.admin = await user("a", "admin", PW.admin);
    ids.eng = await user("e", "engineer", PW.eng);
    ids.admin2fa = await user("t", "admin", PW.admin2fa, true);
    ids.node = Number((await sql`INSERT INTO edge_nodes (code, name, status) VALUES (${"N-" + DAU}, 'cli node', 'offline') RETURNING id`)[0].id);
    dir = mkdtempSync(path.join(os.tmpdir(), "s9-cli-"));
  }, 60_000);

  afterAll(async () => {
    if (ids.node) await sql`DELETE FROM edge_nodes WHERE id = ${ids.node}`;
    await sql`DELETE FROM users WHERE id IN ${sql([ids.admin, ids.eng, ids.admin2fa].filter(Boolean))}`.catch(() => undefined); // audit rows may reference (WORM)
    await sql.end();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }, 60_000);

  it("★ bad arguments ⇒ 2: no actor, the old self-asserted --actor-user-id, a password / code on the command line", async () => {
    expect((await cli(["issue"])).code).toBe(2);
    expect((await cli(["explode", "--node", `N-${DAU}`])).code).toBe(2);
    expect((await cli(["issue", "--node", `N-${DAU}`, "--reason", "no actor"])).code).toBe(2);
    const old = await cli(["issue", "--node", `N-${DAU}`, "--actor-user-id", String(ids.admin), "--reason", "self-asserted"], asAdmin);
    expect(old.code).toBe(2);
    expect(old.err).toMatch(/self-asserted actor/);
    expect((await cli(["issue", "--node", `N-${DAU}`, "--actor", `${DAU}-a`, "--password", PW.admin, "--reason", "argv pw"])).code).toBe(2);
    expect(await credCount()).toBe(0);
  });

  it("★ F7: an unproven actor is refused before anything is written — no password, a wrong one, a non-admin (no file left behind)", async () => {
    const f = path.join(dir, "refused.cred");
    const none = await cli(["issue", "--node", `N-${DAU}`, "--actor", `${DAU}-a`, "--reason", "no password", "--out", f]);
    expect(none.code).toBe(1);
    expect(none.err).toMatch(/notVerified/);
    const wrong = await cli(["issue", "--node", `N-${DAU}`, "--actor", `${DAU}-a`, "--reason", "wrong password", "--out", f], pipe("not-it"));
    expect(wrong.code).toBe(1);
    expect(wrong.err).toMatch(/notVerified.*INVALID_CREDENTIALS/);
    const eng = await cli(["issue", "--node", `N-${DAU}`, "--actor", `${DAU}-e`, "--reason", "engineer tries", "--out", f], pipe(PW.eng));
    expect(eng.code).toBe(1);
    expect(eng.err).toMatch(/notAdmin/);
    // the admin's id with the ENGINEER's password (the old way to "be" an admin) proves nothing
    const borrowed = await cli(["issue", "--node", `N-${DAU}`, "--actor", `${DAU}-a`, "--reason", "borrowed id", "--out", f], pipe(PW.eng));
    expect(borrowed.code).toBe(1);
    expect(existsSync(f)).toBe(false);
    expect(await credCount()).toBe(0);
    // the failed attempts are on the login trail, never with the password
    const trail = await sql`SELECT details FROM audit_logs WHERE "userId" = ${ids.admin} AND status = 'failure'`;
    expect(trail.length).toBeGreaterThan(0);
    expect(JSON.stringify(trail)).not.toContain("not-it");
    await sql`UPDATE users SET "loginAttempts" = 0, "lockedUntil" = NULL WHERE id = ${ids.admin}`.catch(() => undefined);
  });

  it("★ F7: an admin with 2FA on — no code ⇒ otpRequired, a wrong code ⇒ refused, the current code (prompt) ⇒ accepted", async () => {
    const base = ["issue", "--node", `N-${DAU}`, "--actor", `${DAU}-t`, "--reason", "2fa admin"];
    const noCode = await cli(base, pipe(PW.admin2fa)); // piped, no code line ⇒ refused (never prompts on a pipe)
    expect(noCode.code).toBe(1);
    expect(noCode.err).toMatch(/otpRequired/);
    const bad = await cli(base, pipe(PW.admin2fa, "000000" === speakeasy.totp({ secret: secret2fa, encoding: "base32" }) ? "111111" : "000000"));
    expect(bad.code).toBe(1);
    expect(bad.err).toMatch(/notVerified/);
    expect(await credCount()).toBe(0);
    const asked: string[] = [];
    const ok = await cli(base, {
      promptSecret: async (label) => {
        asked.push(label);
        return label.startsWith("password") ? PW.admin2fa : speakeasy.totp({ secret: secret2fa, encoding: "base32" });
      },
    });
    expect(ok.code).toBe(0);
    expect(asked).toEqual([`password of ${DAU}-t: `, "2FA code: "]); // TTY: password, then the code asked once
    expect(ok.out).toMatch(new RegExp(`admin verified: cli t \\(user ${ids.admin2fa}\\)`));
    const [row] = await sql`SELECT "createdBy" FROM edge_node_credentials WHERE "edgeNodeId" = ${ids.node} AND status = 'active'`;
    expect(row.createdBy).toBe(ids.admin2fa); // the PROVEN admin is the one recorded
    const rv = await cli(["revoke", "--node", `N-${DAU}`, "--actor", `${DAU}-a`, "--reason", "reset for the next case"], asAdmin);
    expect(rv.code).toBe(0);
  });

  it("★ issue --out: the secret goes ONLY to the new file; stdout carries the prefix, never the secret; the DB holds its SHA-256", async () => {
    const f = path.join(dir, "node.cred");
    const asked: string[] = [];
    const r = await cli(["issue", "--node", `N-${DAU}`, "--actor", `${DAU}-a`, "--reason", "commission", "--out", f], {
      promptSecret: async (label) => {
        asked.push(label);
        return PW.admin; // the hidden prompt (no env var)
      },
    });
    expect(r.code).toBe(0);
    expect(asked).toEqual([`password of ${DAU}-a: `]);
    const token = readFileSync(f, "utf8").trim();
    expect(token).toMatch(/^edn_[0-9a-f]{12}\.[A-Za-z0-9_-]{43}$/);
    expect(r.out).toContain(token.split(".")[0]);
    expect(r.out).not.toContain(token.split(".")[1]);
    expect(r.out).not.toContain(PW.admin);
    const [row] = await sql`SELECT "secretHash", "createdBy" FROM edge_node_credentials WHERE "edgeNodeId" = ${ids.node} AND status = 'active'`;
    expect(row.secretHash).toBe(createHash("sha256").update(token).digest("hex"));
    expect(row.createdBy).toBe(ids.admin);
    // an EXISTING --out is refused before anything changes
    writeFileSync(path.join(dir, "exists.cred"), "keep me");
    const again = await cli(["rotate", "--node", `N-${DAU}`, "--actor", `${DAU}-a`, "--reason", "rotate", "--out", path.join(dir, "exists.cred")], asAdmin);
    expect(again.code).toBe(1);
    expect(readFileSync(path.join(dir, "exists.cred"), "utf8")).toBe("keep me");
    expect((await sql`SELECT "secretHash" FROM edge_node_credentials WHERE "edgeNodeId" = ${ids.node} AND status = 'active'`)[0].secretHash).toBe(row.secretHash);
  });

  it("★ rotate without --out prints the new secret once; revoke; list shows no hash", async () => {
    const r = await cli(["rotate", "--node", `N-${DAU}`, "--actor", `${DAU}-a`, "--reason", "rotation"], asAdmin);
    expect(r.code).toBe(0);
    const lines = r.out.split("\n");
    expect(lines[0]).toMatch(/^admin verified: /);
    const token = lines[2];
    expect(token).toMatch(/^edn_[0-9a-f]{12}\./);
    expect((await cli(["revoke", "--node", `N-${DAU}`, "--actor", `${DAU}-a`, "--reason", "retire"], asAdmin)).code).toBe(0);
    const l = await cli(["list", "--node", `N-${DAU}`]);
    expect(l.code).toBe(0);
    expect(l.out.split("\n").map((x) => x.split("\t")[2])).toEqual(["revoked", "revoked", "revoked"]);
    expect(l.out).not.toMatch(/[0-9a-f]{64}/);
    expect((await cli(["revoke", "--node", `N-${DAU}`, "--actor", `${DAU}-a`, "--reason", "again"], asAdmin)).code).toBe(1);
  });
});
