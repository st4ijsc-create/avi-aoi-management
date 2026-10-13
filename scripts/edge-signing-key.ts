#!/usr/bin/env tsx
/**
 * doc 81 Đợt 10 task A (design §2.13, D9; fix scan 2 ruling R-10-c) — manage CENTRAL's edge signing KEYRING. Runs on the
 * central host. TRUST COMES FROM THE FILES ONLY: the keyring directory (--dir, default EDGE_SIGNING_KEY_DIR) holds one private
 * key per key, `<kid>.pem` (created new, mode 0600 — never printed, never in the DB), and `keyring.json` (status, root flag,
 * version, history). generate / rotate / pin read and write ONLY these files; the published keyset
 * (edgeSigning.buildEdgeKeysetFromKeyring) and the provisioning pin come from them. The DB table `edge_auth_signing_keys` is an
 * audit / distribution MIRROR, written with the OWNER connection (MIGRATION_DB_URL, else DATABASE_URL as MIGRATION_DB_USER /
 * MIGRATION_DB_PASSWORD — avi_app has SELECT only); `list` compares it with the files and flags every difference — a row
 * planted in the DB is reported "MIRROR-ONLY (untrusted, ignored)" and is never pinned or published. A mirror / audit write
 * failure never changes the files (a warning; `list` shows the gap).
 *
 * fix review 1 (I7) — every change is made by a PROVEN active admin, never a free-text name: `--actor <admin username>`, the
 * account's password and, with 2FA on, its current code — doc 81 Đợt 10 F2 round 3 (R-10-bl, N7): ONLY from a hidden TTY prompt
 * or PIPED STDIN (line 1 password, line 2 the 2FA code) through scripts/edgeAdminLogin.ts; EDGE_SIGNING_ADMIN_PASSWORD / _OTP are
 * REFUSED (exit 2), never read — verifyCredentialAdmin (the web login's own checks: bcrypt, lockout,
 * audit, TOTP, active admin), the Đợt 9 F7 pattern of edge-node-credential.ts. The proof comes BEFORE any file is written; a
 * refused login changes nothing. The actor is recorded in keyring.json `history` ({version, action, kid, actorUserId,
 * actorName, at}) on generate AND rotate (and prune), and as an audit_logs row through the owner connection. `--by` is gone.
 * fix review 1 (M5) — the keyring holds at most 16 keys (the keyset's cap): `generate` at the cap first PRUNES the oldest
 * RETIRED keys retired ≥ 24 h ago (never the root, never an active / next key); if none qualify it refuses.
 *
 *   npx tsx scripts/edge-signing-key.ts generate --dir /etc/avi/edge-keys --actor admin.nguyen   first key ⇒ ROOT (active);
 *                                                                                                  later ⇒ next
 *   npx tsx scripts/edge-signing-key.ts rotate --dir … --activate <kid> --actor admin.nguyen   next → active (both active)
 *   npx tsx scripts/edge-signing-key.ts rotate --dir … --retire <kid> --actor admin.nguyen     active → retired (never the root)
 *   npx tsx scripts/edge-signing-key.ts list --dir …                                            files + mirror comparison
 *   npx tsx scripts/edge-signing-key.ts pin --dir … --out edge-keyset.json --actor admin.nguyen  provisioning pin (root only,
 *                                                                                                  at the keyring version; 0444)
 *
 * ROTATION: generate (next) → rotate --activate (both active) → wait ≥ 2 config cycles → point EDGE_SIGNING_KEY_FILE of
 * every central instance at `<dir>/<new kid>.pem`, restart → rotate --retire the previous signer. The root stays active;
 * replacing it = re-provisioning every edge with a new pin. Exit codes: 0 done · 1 refused · 2 bad arguments.
 */
import { closeSync, existsSync, mkdirSync, openSync, writeSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { proveAdminWith, readAdminSecrets, setSecretEnv, stdinReader } from "./edgeAdminLogin";

export interface SigningKeyCliIo {
  out: (line: string) => void;
  err: (line: string) => void;
  /** a hidden prompt (password / 2FA code); null ⇒ no terminal to ask on */
  promptSecret?: (label: string) => Promise<string | null>;
  /** Đợt 10 F2 round 3 (N7): piped stdin — line 1 password, line 2 optional 2FA code; null ⇒ stdin is a terminal */
  readStdin?: () => Promise<string | null>;
  /** where EDGE_SIGNING_KEY_DIR is read (default process.env); the refused secret variables are checked here */
  env?: NodeJS.ProcessEnv;
}
/** N7 — a secret in an environment variable is REFUSED (exit 2), not read. */
export const REFUSED_SECRET_ENV = ["EDGE_SIGNING_ADMIN_PASSWORD", "EDGE_SIGNING_ADMIN_OTP"] as const;
export interface AdminProof {
  userId: number;
  name: string;
}
export interface SigningKeyAuditEntry {
  action: string;
  actor: AdminProof;
  details: Record<string, unknown>;
}
/**
 * `mirrorDb`: a drizzle handle that may write edge_auth_signing_keys (the owner); null ⇒ no mirror (files only).
 * `verifyAdmin`: the admin proof (default: edgeNodeCredentials.verifyCredentialAdmin — tests inject a fake).
 * `audit`: the audit row writer (default: createAuditLog through the mirror's owner connection; none ⇒ a warning).
 */
export interface SigningKeyCliDeps {
  mirrorDb?: any | null;
  now?: () => number;
  verifyAdmin?: (login: { username: string; password: string | null; otp: string | null }) => Promise<AdminProof>;
  audit?: ((e: SigningKeyAuditEntry) => Promise<void>) | null;
}

function argOf(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length && !argv[i + 1].startsWith("--") ? argv[i + 1] : undefined;
}
function writeNewFile(file: string, text: string, mode: number): void {
  const fd = openSync(file, "wx", mode);
  try {
    writeSync(fd, text);
  } finally {
    closeSync(fd);
  }
}

/** The owner connection for the mirror (never avi_app — it has SELECT only). null when no DB is configured. */
async function defaultMirrorDb(env: NodeJS.ProcessEnv): Promise<{ db: any; end: () => Promise<void> } | null> {
  const base = env.MIGRATION_DB_URL || env.DATABASE_URL;
  if (!base) return null;
  const u = new URL(base);
  if (!env.MIGRATION_DB_URL) {
    u.username = env.MIGRATION_DB_USER ?? "aoi";
    u.password = env.MIGRATION_DB_PASSWORD ?? "aoi";
  }
  const postgres = (await import("postgres")).default;
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const client = postgres(u.toString(), { max: 1, onnotice: () => {} });
  return { db: drizzle(client), end: () => client.end({ timeout: 5 }) };
}

/** The Đợt 9 F7 proof (verifyCredentialAdmin); secrets from the TTY prompt or piped stdin only (N7); a missing 2FA code is asked once on a TTY. */
async function proveAdmin(actorName: string, io: SigningKeyCliIo, deps: SigningKeyCliDeps): Promise<AdminProof> {
  const secrets = await readAdminSecrets(io, actorName);
  const verify = deps.verifyAdmin ?? (async (l: { username: string; password: string | null; otp: string | null }) => (await import("../server/services/edge/edgeNodeCredentials")).verifyCredentialAdmin(l));
  return proveAdminWith(verify, io, actorName, secrets);
}

export async function runEdgeSigningKeyCli(argv: string[], io: SigningKeyCliIo, deps: SigningKeyCliDeps = {}): Promise<number> {
  const cmd = argv[0];
  const env = io.env ?? process.env;
  const now = deps.now ?? Date.now;
  if (!["generate", "rotate", "list", "pin"].includes(cmd ?? "")) {
    io.err("usage: edge-signing-key.ts <generate --dir DIR --actor ADMIN | rotate --dir DIR (--activate|--retire) KID --actor ADMIN | list --dir DIR | pin --dir DIR --out FILE --actor ADMIN>");
    return 2;
  }
  if (argv.some((a) => /^--(private|key-pem|pem)/.test(a))) {
    io.err("a private key is never taken from the command line");
    return 2;
  }
  // fix review 3 (R-10-aa N5): EVERY spelling — `--by X`, `--by=X`, `--password=…`, `--otp=…`, `--pass…` — is refused: a secret
  // never comes from argv (process list, shell history), and a free-text actor never replaces the proven admin
  if (argv.some((x) => /^--by(=|$)/i.test(x))) {
    io.err("--by (a free-text name) is no longer accepted, in any form: use --actor <admin username> — the password is asked on the terminal or read from piped stdin");
    return 2;
  }
  if (argv.some((x) => /^--(password|passwd|pass|pwd|otp|totp|2fa|secret)(=|$)/i.test(x))) {
    io.err("a password / 2FA code is never taken from the command line (process list, shell history) — type it at the prompt, or pipe it on stdin (line 1 password, line 2 2FA code)");
    return 2;
  }
  const leaked = setSecretEnv(env, REFUSED_SECRET_ENV);
  if (leaked.length) {
    io.err(`${leaked.join(" / ")} is set — a secret in an environment variable is refused (unset it): type the password at the prompt, or pipe it on stdin (line 1 password, line 2 2FA code)`);
    return 2;
  }
  const dir = argOf(argv, "--dir") ?? env.EDGE_SIGNING_KEY_DIR;
  if (!dir) {
    io.err("--dir DIR (the keyring directory, or EDGE_SIGNING_KEY_DIR) is required");
    return 2;
  }
  const writes = cmd !== "list";
  const actorName = argOf(argv, "--actor")?.trim() ?? "";
  if (writes && (!actorName || actorName.length > 200)) {
    io.err("--actor ADMIN_USERNAME (an active admin; proven by password / 2FA) is required");
    return 2;
  }
  const out = argOf(argv, "--out");
  if (cmd === "pin" && !out) {
    io.err("--out FILE is required");
    return 2;
  }
  if (out && existsSync(out)) {
    io.err(`${out} already exists — refused (a pin file is never overwritten)`);
    return 1;
  }
  const activate = argOf(argv, "--activate");
  const retire = argOf(argv, "--retire");
  if (cmd === "rotate" && !activate === !retire) {
    io.err("rotate needs exactly one of --activate KID | --retire KID");
    return 2;
  }

  const sg = await import("../server/services/edge/edgeSigning");
  const hasKeyring = existsSync(path.join(dir, sg.EDGE_KEYRING_FILE));
  let keyring: import("../server/services/edge/edgeSigning").EdgeKeyring | null = null;
  if (hasKeyring) {
    try {
      keyring = sg.readEdgeKeyring(dir);
    } catch (err) {
      io.err(`keyring refused: ${(err as Error).message}`);
      return 1;
    }
  } else if (cmd !== "generate") {
    io.err(`no keyring in ${dir} (run generate first)`);
    return 1;
  }

  // ── I7: PROVE the admin before ANY file is written (a refused login changes nothing, leaves no file) ─────────────────
  let actor: AdminProof | null = null;
  if (writes) {
    try {
      actor = await proveAdmin(actorName, io, deps);
    } catch (err) {
      const code = (err as { code?: string })?.code;
      io.err(`refused${code ? ` (${code})` : ""}: ${(err as Error)?.message ?? err} — nothing was changed`);
      return 1;
    }
    if (!actor || !Number.isSafeInteger(actor.userId) || actor.userId <= 0) {
      io.err("refused: the admin proof returned no user — nothing was changed");
      return 1;
    }
    io.out(`admin verified: ${actor.name} (user ${actor.userId})`);
  }

  // ── the mirror (audit / distribution only) ────────────────────────────────────────────────────────────────────────
  let mirror: { db: any; end: () => Promise<void> } | null = null;
  if (deps.mirrorDb !== undefined) mirror = deps.mirrorDb ? { db: deps.mirrorDb, end: async () => {} } : null;
  else mirror = await defaultMirrorDb(env).catch(() => null);
  const { edgeAuthSigningKeys: K } = await import("../server/services/edge/edgeControlSchema");
  const mirrorWrite = async (kr: import("../server/services/edge/edgeSigning").EdgeKeyring): Promise<void> => {
    if (!mirror) {
      io.err("WARNING: no mirror DB — the files are updated; run `list` once a DB is reachable");
      return;
    }
    try {
      for (const k of kr.keys) {
        await mirror.db
          .insert(K)
          .values({ kid: k.kid, publicKeyPem: k.publicKeyPem, status: k.status === "retired" ? "active" : k.status, notBefore: new Date(k.notBefore), createdBy: `user:${actor!.userId} ${actor!.name}`.slice(0, 128) })
          .onConflictDoNothing();
        await mirror.db
          .update(K)
          .set({ status: k.status, retiredAt: k.retiredAt === null ? null : new Date(k.retiredAt) })
          .where((await import("drizzle-orm")).eq(K.kid, k.kid));
      }
    } catch (err) {
      io.err(`WARNING: mirror not updated (${(err as Error).message}) — the files (the source of trust) are updated`);
    }
  };
  const audit = async (action: string, details: Record<string, unknown>): Promise<void> => {
    try {
      if (deps.audit !== undefined) {
        if (deps.audit) await deps.audit({ action, actor: actor!, details });
        else io.err(`WARNING: no audit writer — ${action} recorded in keyring.json history only`);
        return;
      }
      if (!mirror) {
        io.err(`WARNING: no DB — ${action} recorded in keyring.json history only`);
        return;
      }
      const { createAuditLog } = await import("../server/db/system");
      await createAuditLog({ userId: actor!.userId, userName: actor!.name, action, entityType: "edge_signing_key", entityName: String(details.kid ?? ""), details }, mirror.db);
    } catch (err) {
      io.err(`WARNING: audit row not written (${(err as Error).message}) — keyring.json history holds the actor`);
    }
  };
  type Hist = import("../server/services/edge/edgeSigning").EdgeKeyringHistoryEntry;
  const hist = (version: number, action: Hist["action"], kid: string, at: number): Hist => ({ version, action, kid, actorUserId: actor!.userId, actorName: actor!.name.slice(0, 200) || `user ${actor!.userId}`, at });

  try {
    if (cmd === "list") {
      for (const k of keyring!.keys) io.out(`${k.kid}  ${k.status.padEnd(7)}  ${k.root ? "ROOT  " : ""}notBefore ${new Date(k.notBefore).toISOString()}${k.retiredAt ? `  retired ${new Date(k.retiredAt).toISOString()}` : ""}`);
      io.out(`keyring version ${keyring!.version} (files: ${dir})`);
      for (const h of keyring!.history ?? []) io.out(`history v${h.version} ${h.action} ${h.kid} by user ${h.actorUserId} (${h.actorName}) at ${new Date(h.at).toISOString()}`);
      if (!mirror) {
        io.out("mirror: not reachable");
        return 0;
      }
      const rows = (await mirror.db.select().from(K)) as Array<{ kid: string; publicKeyPem: string; status: string }>;
      const files = new Map(keyring!.keys.map((k) => [k.kid, k]));
      let diffs = 0;
      for (const r of rows) {
        const f = files.get(r.kid);
        if (!f) {
          diffs++;
          io.out(`MIRROR-ONLY (untrusted, ignored): ${r.kid} (${r.status}) — not in the keyring files; never pinned or published`);
        } else if (f.publicKeyPem.trim() !== r.publicKeyPem.trim() || f.status !== r.status) {
          diffs++;
          io.out(`MISMATCH: ${r.kid} files=${f.status} mirror=${r.status}${f.publicKeyPem.trim() !== r.publicKeyPem.trim() ? " (public key differs!)" : ""}`);
        }
      }
      for (const k of keyring!.keys) if (!rows.some((r) => r.kid === k.kid)) {
        diffs++;
        io.out(`NOT MIRRORED: ${k.kid}`);
      }
      io.out(diffs === 0 ? "mirror: consistent with the files" : `mirror: ${diffs} difference(s) — the FILES are authoritative`);
      return 0;
    }

    if (cmd === "pin") {
      const pin = sg.edgePinFromKeyring(keyring!);
      writeNewFile(out!, JSON.stringify(pin, null, 2) + "\n", 0o444);
      await audit("EDGE_SIGNING_KEY_PIN", { kid: pin.keyset.keys[0].kid, keyringVersion: pin.keyset.version, out });
      io.out(`pin written: ${out} (root ${pin.keyset.keys[0].kid}, keyring version ${pin.keyset.version}, from the keyring files) — copy it next to each edge's credential file (read-only)`);
      return 0;
    }

    if (cmd === "generate") {
      const t = now();
      const isRoot = !keyring;
      // M5 — at the cap, prune the oldest long-retired keys first (never the root / an active / a next key), else refuse
      let base = keyring;
      let pruned: string[] = [];
      if (base) {
        const p = sg.pruneEdgeKeyring(base, { nowMs: t, room: 1 });
        if (!p.ok) {
          io.err(`refused: ${p.reason} — nothing was changed`);
          return 1;
        }
        base = p.keyring;
        pruned = p.pruned;
      }
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      const gen = sg.generateEdgeSigningKey();
      writeNewFile(path.join(dir, `${gen.key.kid}.pem`), gen.privateKeyPem, 0o600);
      const version = (keyring?.version ?? 0) + 1;
      const entry = { kid: gen.key.kid, publicKeyPem: gen.key.publicKeyPem, status: (isRoot ? "active" : "next") as "active" | "next", notBefore: t, retiredAt: null, root: isRoot };
      const history = [...(keyring?.history ?? []), ...pruned.map((kid) => hist(version, "prune", kid, t)), hist(version, "generate", gen.key.kid, t)];
      const next = { v: 1 as const, version, updatedAt: t, keys: [...(base?.keys ?? []), entry], history };
      sg.writeEdgeKeyring(dir, next);
      sg.readEdgeKeyring(dir); // re-validate what was written
      await mirrorWrite(next);
      for (const kid of pruned) await audit("EDGE_SIGNING_KEY_PRUNE", { kid, keyringVersion: version });
      await audit("EDGE_SIGNING_KEY_GENERATE", { kid: gen.key.kid, keyringVersion: version, root: isRoot });
      if (pruned.length) io.out(`pruned retired key(s) ${pruned.join(", ")} (keyring cap ${sg.EDGE_KEYRING_MAX_KEYS})`);
      io.out(`${isRoot ? "ROOT (active)" : "next"} key ${gen.key.kid} written to ${path.join(dir, `${gen.key.kid}.pem`)} (mode 0600); keyring version ${next.version}`);
      io.out(gen.key.publicKeyPem.trim());
      return 0;
    }

    // rotate (files only)
    const kid = (activate ?? retire)!;
    const k = keyring!.keys.find((x) => x.kid === kid);
    if (!k) {
      io.err(`no key ${kid} in the keyring files`);
      return 1;
    }
    const t = now();
    let keys = keyring!.keys;
    if (activate) {
      if (k.status !== "next") {
        io.err(`key ${kid} is ${k.status}, not next — refused`);
        return 1;
      }
      keys = keys.map((x) => (x.kid === kid ? { ...x, status: "active" as const } : x));
    } else {
      if (k.status !== "active") {
        io.err(`key ${kid} is ${k.status}, not active — refused`);
        return 1;
      }
      if (k.root) {
        io.err(`key ${kid} is the ROOT pinned by every edge — it is replaced only by re-provisioning (new pin), never retired here`);
        return 1;
      }
      keys = keys.map((x) => (x.kid === kid ? { ...x, status: "retired" as const, retiredAt: t } : x));
    }
    const version = keyring!.version + 1;
    const next = { v: 1 as const, version, updatedAt: t, keys, history: [...(keyring!.history ?? []), hist(version, activate ? "activate" : "retire", kid, t)] };
    sg.writeEdgeKeyring(dir, next);
    sg.readEdgeKeyring(dir);
    await mirrorWrite(next);
    await audit(activate ? "EDGE_SIGNING_KEY_ACTIVATE" : "EDGE_SIGNING_KEY_RETIRE", { kid, keyringVersion: version });
    io.out(
      activate
        ? `key ${kid} is active (published, keyring version ${next.version}). After ≥ 2 config cycles point EDGE_SIGNING_KEY_FILE of every central instance at ${path.join(dir, `${kid}.pem`)}, restart, then retire the previous signer.`
        : `key ${kid} retired (kept in the keyset until auth TTL + skew; keyring version ${next.version})`,
    );
    return 0;
  } finally {
    if (mirror && deps.mirrorDb === undefined) await mirror.end().catch(() => undefined);
  }
}

/** A hidden prompt on the controlling terminal (nothing echoed); no terminal ⇒ null (then only the environment can answer). */
function ttyHiddenPrompt(label: string): Promise<string | null> {
  const stdin = process.stdin;
  if (!stdin.isTTY || typeof stdin.setRawMode !== "function") return Promise.resolve(null);
  return new Promise((resolve) => {
    process.stderr.write(label);
    let value = "";
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    const done = (v: string | null) => {
      stdin.removeListener("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stderr.write("\n");
      resolve(v);
    };
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n" || ch === "\u0004") return done(value);
        if (ch === "\u0003") return done(null); // Ctrl+C: no answer
        if (ch === "\u007f" || ch === "\b") value = value.slice(0, -1);
        else value += ch;
      }
    };
    stdin.on("data", onData);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  import("dotenv/config") // the central host's DATABASE_URL (only when run as a program — never when imported by a test)
    .then(() => runEdgeSigningKeyCli(process.argv.slice(2), { out: (l) => console.log(l), err: (l) => console.error(l), promptSecret: ttyHiddenPrompt, readStdin: stdinReader() }))
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(`edge-signing-key: ${(err as Error)?.message ?? err}`);
      process.exit(1);
    });
}
