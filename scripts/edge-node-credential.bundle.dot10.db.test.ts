/**
 * doc 81 Đợt 10 task F2 — the NODE BUNDLE of `scripts/edge-node-credential.ts` (R-10-ad env + design §2.13 "the bundle writes
 * the keyset pin"), on the REAL `_test` DB with a PROVEN admin (password through the web login's own check):
 *   • issue --bundle DIR: a NEW dir with edge-node.cred (the secret, nowhere else — not on stdout), edge-keyset.json (the pin
 *     from the keyring FILES: the root kid at the keyring version, parsed by the edge's own pin parser) and edge-node.env (node
 *     id, credential id, host paths, journal size — and NO DATABASE_URL / JWT_SECRET / SECRET_ENCRYPTION_KEY / secret);
 *   • the env file + the two files are accepted by the edge runtime's own parser (edgeNodeEnv);
 *   • refused BEFORE anything changes: an existing dir, --out with --bundle, no keyring, a bad keyring (no credential issued);
 *   • a secret on argv in any spelling (`--password=…`) is refused (N7, part).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import postgres from "postgres";
import bcrypt from "bcryptjs";
import { runEdgeCredentialCli, BUNDLE_FILES, type CliIo } from "./edge-node-credential";
import { runEdgeSigningKeyCli } from "./edge-signing-key";

const DB_URL = process.env.DATABASE_URL;
const DAU = `F2BUN-${Date.now()}`;
const PW = `adm-${DAU}-Pw!`;
const ids = { admin: 0, node: 0 };
let sql: ReturnType<typeof postgres>;
let dir = "";
let keyring = "";

async function cli(argv: string[], io: Partial<CliIo> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runEdgeCredentialCli(argv, { out: (l) => out.push(l), err: (l) => err.push(l), env: { EDGE_CRED_ADMIN_PASSWORD: PW }, ...io });
  return { code, out: out.join("\n"), err: err.join("\n") };
}
const credCount = async () => Number((await sql`SELECT count(*)::int AS n FROM edge_node_credentials WHERE "edgeNodeId" = ${ids.node}`)[0].n);

describe.skipIf(!DB_URL)("Đợt 10 F2 — edge node bundle (_test)", () => {
  beforeAll(async () => {
    expect(DB_URL).toMatch(/_test/);
    sql = postgres(DB_URL!, { max: 1, connect_timeout: 30, onnotice: () => {} });
    ids.admin = Number((await sql`INSERT INTO users ("openId", username, name, role, "isActive") VALUES (${`${DAU}-a`}, ${`${DAU}-a`}, 'bundle admin', 'admin', true) RETURNING id`)[0].id);
    await sql`INSERT INTO user_secrets ("userId", "passwordHash") VALUES (${ids.admin}, ${await bcrypt.hash(PW, 4)})`;
    ids.node = Number((await sql`INSERT INTO edge_nodes (code, name, status) VALUES (${"N-" + DAU}, 'bundle node', 'offline') RETURNING id`)[0].id);
    dir = mkdtempSync(path.join(os.tmpdir(), "f2-bundle-"));
    keyring = path.join(dir, "keyring");
    const r = await runEdgeSigningKeyCli(["generate", "--dir", keyring, "--actor", "x"], { out: () => {}, err: () => {}, env: {} }, { verifyAdmin: async () => ({ userId: ids.admin, name: "bundle admin" }), mirrorDb: null, audit: null });
    expect(r).toBe(0);
  }, 60_000);

  afterAll(async () => {
    if (ids.node) await sql`DELETE FROM edge_nodes WHERE id = ${ids.node}`.catch(() => undefined);
    await sql`DELETE FROM users WHERE id = ${ids.admin}`.catch(() => undefined); // audit rows may reference (WORM)
    await sql.end();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }, 60_000);

  it("★ refused BEFORE anything changes: secret on argv, --out with --bundle, no keyring, a bad keyring, an existing dir", async () => {
    const node = "N-" + DAU;
    const base = ["issue", "--node", node, "--actor", `${DAU}-a`, "--reason", "commission"];
    expect((await cli([...base, "--password=x"])).code).toBe(2);
    expect((await cli([...base, "--otp", "123456"])).code).toBe(2);
    expect((await cli([...base, "--bundle", path.join(dir, "b0"), "--out", path.join(dir, "x.cred"), "--keyring-dir", keyring])).code).toBe(2);
    expect((await cli([...base, "--bundle", path.join(dir, "b0")])).code).toBe(2); // no keyring
    const bad = path.join(dir, "badkeyring");
    mkdirSync(bad);
    writeFileSync(path.join(bad, "keyring.json"), "{}");
    const r = await cli([...base, "--bundle", path.join(dir, "b0"), "--keyring-dir", bad]);
    expect(r.code).toBe(1);
    expect(r.err).toMatch(/keyring refused/);
    mkdirSync(path.join(dir, "exists"));
    const e = await cli([...base, "--bundle", path.join(dir, "exists"), "--keyring-dir", keyring]);
    expect(e.code).toBe(1);
    expect(e.err).toMatch(/cannot create it/);
    expect(existsSync(path.join(dir, "b0"))).toBe(false);
    expect(await credCount()).toBe(0);
  });

  it("★ issue --bundle: cred (0600, only there) + pin from the keyring files + env with the ids, no central secret; the edge parser accepts it", async () => {
    const b = path.join(dir, "bundle1");
    const r = await cli(["issue", "--node", "N-" + DAU, "--actor", `${DAU}-a`, "--reason", "commission", "--bundle", b, "--keyring-dir", keyring, "--central-url", "https://central.example:3000", "--edge-dir", "/etc/avi-edge"]);
    expect(r.code, r.err).toBe(0);
    const token = readFileSync(path.join(b, BUNDLE_FILES.credential), "utf8").trim();
    expect(token).toMatch(/^edn_[0-9a-f]{12}\.[A-Za-z0-9_-]{43}$/);
    expect(r.out).not.toContain(token.split(".")[1]);
    if (process.platform !== "win32") expect(statSync(path.join(b, BUNDLE_FILES.credential)).mode & 0o777).toBe(0o600);
    const [row] = await sql`SELECT id, status FROM edge_node_credentials WHERE "edgeNodeId" = ${ids.node} AND status = 'active'`;
    // the pin = the keyring root at the keyring version, in the edge's pin format
    const { parseEdgeKeysetPin, readEdgeKeyring } = await import("../server/services/edge/edgeSigning");
    const pin = parseEdgeKeysetPin(JSON.parse(readFileSync(path.join(b, BUNDLE_FILES.pin), "utf8")));
    const kr = readEdgeKeyring(keyring);
    expect(pin).toMatchObject({ ok: true });
    expect((pin as { pin: { keyset: { version: number; keys: Array<{ kid: string }> } } }).pin.keyset.version).toBe(kr.version);
    expect((pin as { pin: { keyset: { keys: Array<{ kid: string }> } } }).pin.keyset.keys.map((k) => k.kid)).toEqual([kr.keys.find((k) => k.root)!.kid]);
    // the env: ids, host paths, journal; nothing secret, no central DB / secret variable
    const envText = readFileSync(path.join(b, BUNDLE_FILES.env), "utf8");
    const kv = Object.fromEntries(envText.split("\n").filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
    expect(kv).toEqual({
      EDGE_GATEWAY_NODE_CODE: "N-" + DAU,
      EDGE_CENTRAL_URL: "https://central.example:3000",
      EDGE_CENTRAL_NODE_ID: String(ids.node),
      EDGE_CENTRAL_CREDENTIAL_ID: String(row.id),
      EDGE_NODE_CREDENTIAL_HOST_FILE: "/etc/avi-edge/edge-node.cred",
      EDGE_KEYSET_PIN_HOST_FILE: "/etc/avi-edge/edge-keyset.json",
      EDGE_JOURNAL_MAX_BYTES: String(64 * 1024 * 1024),
    });
    expect(envText).not.toMatch(/DATABASE_URL\s*=|JWT_SECRET\s*=|SECRET_ENCRYPTION_KEY\s*=|edn_[0-9a-f]{12}\./);
    // the edge runtime's own parser accepts the bundle (container paths = the bundle files here)
    const { edgeNodeEnv } = await import("../server/services/edge/edgeGatewayRuntime");
    const parsed = await edgeNodeEnv({ ...kv, EDGE_NODE_CREDENTIAL_FILE: path.join(b, BUNDLE_FILES.credential), EDGE_KEYSET_PIN_FILE: path.join(b, BUNDLE_FILES.pin), EDGE_JOURNAL_DIR: path.join(dir, "journal") } as never);
    expect(parsed).toMatchObject({ nodeId: ids.node, credentialId: Number(row.id), centralUrl: "https://central.example:3000" });
  });

  it("★ rotate --bundle: a new bundle with the NEW credential id; the old one is revoked", async () => {
    const b = path.join(dir, "bundle2");
    const r = await cli(["rotate", "--node", "N-" + DAU, "--actor", `${DAU}-a`, "--reason", "quarterly", "--bundle", b, "--keyring-dir", keyring]);
    expect(r.code, r.err).toBe(0);
    const [act] = await sql`SELECT id FROM edge_node_credentials WHERE "edgeNodeId" = ${ids.node} AND status = 'active'`;
    expect(readFileSync(path.join(b, BUNDLE_FILES.env), "utf8")).toContain(`EDGE_CENTRAL_CREDENTIAL_ID=${act.id}\n`);
    expect(readFileSync(path.join(b, BUNDLE_FILES.env), "utf8")).toMatch(/# EDGE_CENTRAL_URL=/); // not given ⇒ a commented placeholder
    expect(await credCount()).toBe(2);
  });
});
