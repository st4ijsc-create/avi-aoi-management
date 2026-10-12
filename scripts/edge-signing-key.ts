#!/usr/bin/env tsx
/**
 * doc 81 Đợt 10 task A (design §2.13, D9; fix scan 2 ruling R-10-c) — manage CENTRAL's edge signing KEYRING. Runs on the
 * central host. TRUST COMES FROM THE FILES ONLY: the keyring directory (--dir, default EDGE_SIGNING_KEY_DIR) holds one private
 * key per key, `<kid>.pem` (created new, mode 0600 — never printed, never in the DB), and `keyring.json` (status, root flag,
 * version). generate / rotate / pin read and write ONLY these files; the published keyset (edgeSigning.buildEdgeKeysetFromKeyring)
 * and the provisioning pin come from them. The DB table `edge_auth_signing_keys` is an audit / distribution MIRROR, written
 * with the OWNER connection (MIGRATION_DB_URL, else DATABASE_URL as MIGRATION_DB_USER / MIGRATION_DB_PASSWORD — avi_app has
 * SELECT only); `list` compares it with the files and flags every difference — a row planted in the DB is reported
 * "MIRROR-ONLY (untrusted, ignored)" and is never pinned or published. A mirror write failure never changes the files
 * (a warning; `list` shows the gap).
 *
 *   npx tsx scripts/edge-signing-key.ts generate --dir /etc/avi/edge-keys --by "admin.nguyen"   first key ⇒ ROOT (active);
 *                                                                                                later ⇒ next
 *   npx tsx scripts/edge-signing-key.ts rotate --dir … --activate <kid> --by "…"   next → active (published; both active)
 *   npx tsx scripts/edge-signing-key.ts rotate --dir … --retire <kid> --by "…"     active → retired (never the root)
 *   npx tsx scripts/edge-signing-key.ts list --dir …                                files + mirror comparison
 *   npx tsx scripts/edge-signing-key.ts pin --dir … --out edge-keyset.json          provisioning pin (root only, mode 0444)
 *
 * ROTATION: generate (next) → rotate --activate (both active) → wait ≥ 2 config cycles → point EDGE_SIGNING_KEY_FILE of
 * every central instance at `<dir>/<new kid>.pem`, restart → rotate --retire the previous signer. The root stays active;
 * replacing it = re-provisioning every edge with a new pin. Exit codes: 0 done · 1 refused · 2 bad arguments.
 */
import { closeSync, existsSync, mkdirSync, openSync, writeSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export interface SigningKeyCliIo {
  out: (line: string) => void;
  err: (line: string) => void;
  env?: NodeJS.ProcessEnv;
}
/** `mirrorDb`: a drizzle handle that may write edge_auth_signing_keys (the owner); null ⇒ no mirror (files only). */
export interface SigningKeyCliDeps {
  mirrorDb?: any | null;
  now?: () => number;
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

export async function runEdgeSigningKeyCli(argv: string[], io: SigningKeyCliIo, deps: SigningKeyCliDeps = {}): Promise<number> {
  const cmd = argv[0];
  const env = io.env ?? process.env;
  const now = deps.now ?? Date.now;
  if (!["generate", "rotate", "list", "pin"].includes(cmd ?? "")) {
    io.err("usage: edge-signing-key.ts <generate --dir DIR --by NAME | rotate --dir DIR (--activate|--retire) KID --by NAME | list --dir DIR | pin --dir DIR --out FILE>");
    return 2;
  }
  if (argv.some((a) => /^--(private|key-pem|pem)/.test(a))) {
    io.err("a private key is never taken from the command line");
    return 2;
  }
  const dir = argOf(argv, "--dir") ?? env.EDGE_SIGNING_KEY_DIR;
  if (!dir) {
    io.err("--dir DIR (the keyring directory, or EDGE_SIGNING_KEY_DIR) is required");
    return 2;
  }
  const by = argOf(argv, "--by")?.trim() ?? "";
  if ((cmd === "generate" || cmd === "rotate") && (!by || by.length > 100)) {
    io.err("--by NAME (who does this, recorded in the mirror) is required");
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

  // ── the mirror (audit / distribution only) ────────────────────────────────────────────────────────────────────────
  let mirror: { db: any; end: () => Promise<void> } | null = null;
  if (deps.mirrorDb !== undefined) mirror = deps.mirrorDb ? { db: deps.mirrorDb, end: async () => {} } : null;
  else if (cmd !== "pin") mirror = await defaultMirrorDb(env).catch(() => null);
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
          .values({ kid: k.kid, publicKeyPem: k.publicKeyPem, status: k.status === "retired" ? "active" : k.status, notBefore: new Date(k.notBefore), createdBy: by || "edge-signing-key" })
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

  try {
    if (cmd === "list") {
      for (const k of keyring!.keys) io.out(`${k.kid}  ${k.status.padEnd(7)}  ${k.root ? "ROOT  " : ""}notBefore ${new Date(k.notBefore).toISOString()}${k.retiredAt ? `  retired ${new Date(k.retiredAt).toISOString()}` : ""}`);
      io.out(`keyring version ${keyring!.version} (files: ${dir})`);
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
      io.out(`pin written: ${out} (root ${pin.keys[0].kid}, from the keyring files) — copy it next to each edge's credential file (read-only)`);
      return 0;
    }

    if (cmd === "generate") {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      const gen = sg.generateEdgeSigningKey();
      const t = now();
      const isRoot = !keyring;
      writeNewFile(path.join(dir, `${gen.key.kid}.pem`), gen.privateKeyPem, 0o600);
      const entry = { kid: gen.key.kid, publicKeyPem: gen.key.publicKeyPem, status: (isRoot ? "active" : "next") as "active" | "next", notBefore: t, retiredAt: null, root: isRoot };
      const next = { v: 1 as const, version: (keyring?.version ?? 0) + 1, updatedAt: t, keys: [...(keyring?.keys ?? []), entry] };
      sg.writeEdgeKeyring(dir, next);
      sg.readEdgeKeyring(dir); // re-validate what was written
      await mirrorWrite(next);
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
    const next = { v: 1 as const, version: keyring!.version + 1, updatedAt: t, keys };
    sg.writeEdgeKeyring(dir, next);
    sg.readEdgeKeyring(dir);
    await mirrorWrite(next);
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runEdgeSigningKeyCli(process.argv.slice(2), { out: (l) => console.log(l), err: (l) => console.error(l) })
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(`edge-signing-key: ${(err as Error)?.message ?? err}`);
      process.exit(1);
    });
}
