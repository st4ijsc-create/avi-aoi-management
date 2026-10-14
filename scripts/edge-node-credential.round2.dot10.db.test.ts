/**
 * doc 81 Đợt 10 task F2 round 2 (R-10-bj — design §4 F) on the REAL `_test` DB with real users (bcrypt password, TOTP secret):
 *   • N7 — the admin secret comes only from the TTY prompt or PIPED STDIN; EDGE_CRED_ADMIN_PASSWORD / _OTP set ⇒ exit 2 (refused,
 *     not read); a piped login without a code line, with 2FA on ⇒ refused (never prompts on a pipe);
 *   • N8 — a WRONG 2FA code after a correct password is audited (`login_2fa` failure, channel cli) and COUNTED into the lockout,
 *     although the correct password resets the counter: MAX_LOGIN_ATTEMPTS wrong codes over separate invocations ⇒ locked, and
 *     then even the right password + right code is refused (ACCOUNT_LOCKED);
 *   • D14 — `register-node`: admin only (an engineer is refused before any write), factory must exist, lines must belong to it,
 *     audited EDGE_NODE_REGISTER; re-registering the same ⇒ unchanged; a different factory ⇒ refused, row unchanged.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import bcrypt from "bcryptjs";
import speakeasy from "speakeasy";
import { runEdgeCredentialCli, type CliIo } from "./edge-node-credential";

const DB_URL = process.env.DATABASE_URL;
const DAU = `F2R2-${Date.now()}`;
const PW = { admin: `adm-${DAU}-Pw!`, eng: `eng-${DAU}-Pw!`, tfa: `tfa-${DAU}-Pw!` };
const ids = { admin: 0, eng: 0, tfa: 0, factory: 0, factory2: 0, workshop: 0, workshop2: 0, line: 0, line2: 0 };
const secret = speakeasy.generateSecret({ length: 20 }).base32;
let sql: ReturnType<typeof postgres>;

async function cli(argv: string[], io: Partial<CliIo> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runEdgeCredentialCli(argv, { out: (l) => out.push(l), err: (l) => err.push(l), env: {}, ...io });
  return { code, out: out.join("\n"), err: err.join("\n") };
}
const pipe = (...lines: string[]) => ({ readStdin: async () => lines.join("\n") + "\n" });
const wrongCode = () => {
  const now = Math.floor(Date.now() / 1000);
  const valid = new Set([-1, 0, 1].map((k) => speakeasy.totp({ secret, encoding: "base32", time: now + k * 30 })));
  for (let i = 0; ; i++) {
    const c = String(100000 + i);
    if (!valid.has(c)) return c;
  }
};

describe.skipIf(!DB_URL)("Đợt 10 F2 round 2 — N7 / N8 / D14 on the edge-node-credential CLI (_test)", () => {
  beforeAll(async () => {
    expect(DB_URL).toMatch(/_test/);
    sql = postgres(DB_URL!, { max: 1, connect_timeout: 30, onnotice: () => {} });
    const user = async (tag: string, role: string, pw: string, twoFa = false) => {
      const id = Number((await sql`INSERT INTO users ("openId", username, name, role, "isActive", two_factor_enabled) VALUES (${`${DAU}-${tag}`}, ${`${DAU}-${tag}`}, ${`r2 ${tag}`}, ${role}, true, ${twoFa}) RETURNING id`)[0].id);
      await sql`INSERT INTO user_secrets ("userId", "passwordHash", "twoFactorSecret") VALUES (${id}, ${await bcrypt.hash(pw, 4)}, ${twoFa ? secret : null})`;
      return id;
    };
    ids.admin = await user("a", "admin", PW.admin);
    ids.eng = await user("e", "engineer", PW.eng);
    ids.tfa = await user("t", "admin", PW.tfa, true);
    ids.factory = Number((await sql`INSERT INTO factories (code, name) VALUES (${`${DAU}-F`}, 'f') RETURNING id`)[0].id);
    ids.factory2 = Number((await sql`INSERT INTO factories (code, name) VALUES (${`${DAU}-G`}, 'g') RETURNING id`)[0].id);
    ids.workshop = Number((await sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${ids.factory}, ${`${DAU}-W`}, 'w') RETURNING id`)[0].id);
    ids.workshop2 = Number((await sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${ids.factory2}, ${`${DAU}-W2`}, 'w') RETURNING id`)[0].id);
    ids.line = Number((await sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${ids.workshop}, ${`${DAU}-L1`}, 'l') RETURNING id`)[0].id);
    ids.line2 = Number((await sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${ids.workshop2}, ${`${DAU}-L2`}, 'l') RETURNING id`)[0].id);
  }, 60_000);

  afterAll(async () => {
    await sql`DELETE FROM edge_nodes WHERE code LIKE ${DAU + "%"}`.catch(() => undefined);
    await sql`DELETE FROM production_lines WHERE id IN (${ids.line}, ${ids.line2})`.catch(() => undefined);
    await sql`DELETE FROM workshops WHERE id IN (${ids.workshop}, ${ids.workshop2})`.catch(() => undefined);
    await sql`DELETE FROM factories WHERE id IN (${ids.factory}, ${ids.factory2})`.catch(() => undefined);
    await sql`DELETE FROM users WHERE id IN ${sql([ids.admin, ids.eng, ids.tfa].filter(Boolean))}`.catch(() => undefined); // audit rows may reference (WORM)
    await sql.end();
  }, 60_000);

  it("★ N7: EDGE_CRED_ADMIN_PASSWORD / _OTP set ⇒ exit 2, not read, nothing proven; a piped login with 2FA on and no code line ⇒ refused", async () => {
    for (const env of [{ EDGE_CRED_ADMIN_PASSWORD: PW.admin }, { EDGE_CRED_ADMIN_OTP: "123456" }]) {
      const r = await cli(["register-node", "--node", `${DAU}-x`, "--factory", `${DAU}-F`, "--actor", `${DAU}-a`, "--reason", "env"], { env, ...pipe(PW.admin) });
      expect(r.code).toBe(2);
      expect(r.err).toMatch(/is set — a secret in an environment variable is refused/);
    }
    for (const bad of ["--password=x", "--pass", "--otp=1", "--totp", "--secret=s"]) {
      expect((await cli(["register-node", "--node", `${DAU}-x`, "--factory", `${DAU}-F`, "--actor", `${DAU}-a`, "--reason", "argv", bad], pipe(PW.admin))).code).toBe(2);
    }
    const noCode = await cli(["register-node", "--node", `${DAU}-x`, "--factory", `${DAU}-F`, "--actor", `${DAU}-t`, "--reason", "piped"], pipe(PW.tfa));
    expect(noCode.code).toBe(1);
    expect(noCode.err).toMatch(/otpRequired/);
    expect((await sql`SELECT count(*)::int AS n FROM edge_nodes WHERE code = ${`${DAU}-x`}`)[0].n).toBe(0);
  });

  it("★ N8: wrong 2FA codes over separate invocations are audited and counted ⇒ locked; then the right code is refused too", async () => {
    await sql`UPDATE users SET "loginAttempts" = 0, "lockedUntil" = NULL WHERE id = ${ids.tfa}`;
    const base = ["register-node", "--node", `${DAU}-n8`, "--factory", `${DAU}-F`, "--actor", `${DAU}-t`, "--reason", "n8"];
    const { MAX_LOGIN_ATTEMPTS } = await import("../server/_core/authService");
    for (let i = 1; i <= MAX_LOGIN_ATTEMPTS; i++) {
      const r = await cli(base, pipe(PW.tfa, wrongCode()));
      expect(r.code, r.err).toBe(1);
      const [u] = await sql`SELECT "loginAttempts" AS a, "lockedUntil" AS l FROM users WHERE id = ${ids.tfa}`;
      expect(u.a).toBe(i); // the correct password's reset does NOT erase the count
      expect(u.l === null).toBe(i < MAX_LOGIN_ATTEMPTS);
    }
    const audits = await sql`SELECT details FROM audit_logs WHERE "userId" = ${ids.tfa} AND action = 'login_2fa' AND status = 'failure' ORDER BY id`;
    const det = audits.map((a) => (typeof a.details === "string" ? JSON.parse(a.details) : a.details));
    expect(det.filter((d) => d?.channel === "cli").map((d) => d.attempt)).toEqual(Array.from({ length: MAX_LOGIN_ATTEMPTS }, (_, i) => i + 1));
    const right = await cli(base, pipe(PW.tfa, speakeasy.totp({ secret, encoding: "base32" })));
    expect(right.code).toBe(1);
    expect(right.err).toMatch(/ACCOUNT_LOCKED/);
    expect((await sql`SELECT count(*)::int AS n FROM edge_nodes WHERE code = ${`${DAU}-n8`}`)[0].n).toBe(0);
    await sql`UPDATE users SET "loginAttempts" = 0, "lockedUntil" = NULL WHERE id = ${ids.tfa}`;
  });

  it("★ R-11-p: register-node creates protocolVersion 2 by default; --protocol 1 refused (exit 2, nothing written); the tRPC registerNode creates v2 too", async () => {
    const node = `${DAU}-v2`;
    const base = ["register-node", "--node", node, "--factory", `${DAU}-F`, "--actor", `${DAU}-a`, "--reason", "v2 default"];
    const refused = await cli([...base, "--protocol", "1"], pipe(PW.admin));
    expect(refused.code).toBe(2);
    expect(refused.err).toMatch(/v1 nodes cannot execute/);
    expect((await sql`SELECT count(*)::int AS n FROM edge_nodes WHERE code = ${node}`)[0].n).toBe(0);
    const ok = await cli(base, pipe(PW.admin));
    expect(ok.code, ok.err).toBe(0);
    expect((await sql`SELECT "protocolVersion" AS v FROM edge_nodes WHERE code = ${node}`)[0].v).toBe(2);
    const prev = process.env.EDGE_RUNTIME_ENABLED;
    process.env.EDGE_RUNTIME_ENABLED = "true";
    try {
      const { registerNode } = await import("../server/services/edge/edgeCoordinator");
      const r = await registerNode({ code: `${DAU}-trpc`, factoryCode: `${DAU}-F` });
      expect(r.ok).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.EDGE_RUNTIME_ENABLED;
      else process.env.EDGE_RUNTIME_ENABLED = prev;
    }
    expect((await sql`SELECT "protocolVersion" AS v FROM edge_nodes WHERE code = ${`${DAU}-trpc`}`)[0].v).toBe(2);
  });

  it("★ R-11-p: re-registering an existing v1 node upgrades it to v2 ONLY with an explicit --protocol 2, audited; without it stays v1", async () => {
    const node = `${DAU}-up`;
    await sql`INSERT INTO edge_nodes (code, name, "factoryCode", "assignedLineCodes", status) VALUES (${node}, 'old', ${`${DAU}-F`}, ${sql.array([])}, 'offline')`;
    expect((await sql`SELECT "protocolVersion" AS v FROM edge_nodes WHERE code = ${node}`)[0].v).toBe(1);
    const base = ["register-node", "--node", node, "--factory", `${DAU}-F`, "--actor", `${DAU}-a`];
    const plain = await cli([...base, "--reason", "no flag"], pipe(PW.admin));
    expect(plain.code, plain.err).toBe(0);
    expect(plain.out).toMatch(/unchanged/);
    expect((await sql`SELECT "protocolVersion" AS v FROM edge_nodes WHERE code = ${node}`)[0].v).toBe(1);
    const up = await cli([...base, "--protocol", "2", "--reason", "cutover"], pipe(PW.admin));
    expect(up.code, up.err).toBe(0);
    expect(up.out).toMatch(/upgraded.*v2/i);
    expect((await sql`SELECT "protocolVersion" AS v FROM edge_nodes WHERE code = ${node}`)[0].v).toBe(2);
    const aud = await sql`SELECT status, details FROM audit_logs WHERE action = 'EDGE_NODE_REGISTER' AND "entityName" = ${node} ORDER BY id`;
    expect(aud.map((a) => (typeof a.details === "string" ? JSON.parse(a.details) : a.details).outcome)).toEqual(["upgradedToV2"]);
    const again = await cli([...base, "--protocol", "2", "--reason", "again"], pipe(PW.admin));
    expect(again.out).toMatch(/unchanged/);
  });

  it("★ D14: register-node — admin only, factory must exist, lines must be the factory's, audited; idempotent; a different factory refused", async () => {
    const node = `${DAU}-node`;
    const eng = await cli(["register-node", "--node", node, "--factory", `${DAU}-F`, "--actor", `${DAU}-e`, "--reason", "engineer"], pipe(PW.eng));
    // the service re-checks the actor itself (defence in depth: a caller passing an engineer's id directly is refused too)
    const { registerEdgeNode } = await import("../server/services/edge/edgeNodeCredentials");
    await expect(registerEdgeNode({ nodeCode: node, factoryCode: `${DAU}-F`, lineCodes: [], actorUserId: ids.eng, reason: "direct" })).rejects.toMatchObject({ code: "notAdmin" });
    expect(eng.code).toBe(1);
    expect(eng.err).toMatch(/notAdmin/);
    expect((await cli(["register-node", "--node", node, "--actor", `${DAU}-a`, "--reason", "no factory"], pipe(PW.admin))).code).toBe(2);
    const unknown = await cli(["register-node", "--node", node, "--factory", `${DAU}-NOPE`, "--actor", `${DAU}-a`, "--reason", "bad factory"], pipe(PW.admin));
    expect(unknown.code).toBe(1);
    expect(unknown.err).toMatch(/does not exist/);
    const foreignLine = await cli(["register-node", "--node", node, "--factory", `${DAU}-F`, "--lines", `${DAU}-L1,${DAU}-L2`, "--actor", `${DAU}-a`, "--reason", "foreign line"], pipe(PW.admin));
    expect(foreignLine.code).toBe(1);
    expect(foreignLine.err).toMatch(new RegExp(`${DAU}-L2 are not production lines of factory`));
    expect((await sql`SELECT count(*)::int AS n FROM edge_nodes WHERE code = ${node}`)[0].n).toBe(0);
    const ok = await cli(["register-node", "--node", node, "--factory", `${DAU}-F`, "--lines", `${DAU}-L1`, "--name", "Line 1 gateway", "--actor", `${DAU}-a`, "--reason", "commission"], pipe(PW.admin));
    expect(ok.code, ok.err).toBe(0);
    const [row] = await sql`SELECT id, "factoryCode", "assignedLineCodes", name, status FROM edge_nodes WHERE code = ${node}`;
    expect([row.factoryCode, row.assignedLineCodes, row.name, row.status]).toEqual([`${DAU}-F`, [`${DAU}-L1`], "Line 1 gateway", "offline"]);
    const again = await cli(["register-node", "--node", node, "--factory", `${DAU}-F`, "--lines", `${DAU}-L1`, "--actor", `${DAU}-a`, "--reason", "again"], pipe(PW.admin));
    expect(again.code).toBe(0);
    expect(again.out).toMatch(/unchanged/);
    const moved = await cli(["register-node", "--node", node, "--factory", `${DAU}-G`, "--actor", `${DAU}-a`, "--reason", "move"], pipe(PW.admin));
    expect(moved.code).toBe(1);
    expect(moved.err).toMatch(/already registered/);
    expect((await sql`SELECT "factoryCode" FROM edge_nodes WHERE code = ${node}`)[0].factoryCode).toBe(`${DAU}-F`);
    const aud = await sql`SELECT status, details FROM audit_logs WHERE action = 'EDGE_NODE_REGISTER' AND "entityName" = ${node} ORDER BY id`;
    const outcomes = aud.map((a) => [a.status, (typeof a.details === "string" ? JSON.parse(a.details) : a.details).outcome]);
    expect(outcomes).toEqual([["failure", "unknownFactory"], ["failure", "linesNotInFactory"], ["success", "created"], ["failure", "registeredDifferently"]]);
  });
});
