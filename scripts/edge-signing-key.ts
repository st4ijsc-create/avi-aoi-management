#!/usr/bin/env tsx
/**
 * doc 81 Đợt 10 task A (design §2.13, D9) — manage CENTRAL's edge signing key. Runs on the central host (its DATABASE_URL).
 * The PRIVATE key only ever goes to a NEW file created with mode 0600 (an existing file is refused, never overwritten) — it is
 * never printed, logged or stored in the DB. The DB (`edge_auth_signing_keys`, mig 0373) gets the PUBLIC key, its status and,
 * for every key after the first, an ENDORSEMENT signed by the currently active key — so a DB writer alone can never add a key
 * that edges will trust (edgeSigning.buildEdgeKeyset follows only verified endorsements).
 *
 *   npx tsx scripts/edge-signing-key.ts generate --out /etc/avi/edge-signing.pem --by "admin.nguyen"
 *       first key ⇒ the GENESIS (provisioning root, active); later keys ⇒ `next`, endorsed by the active key read from
 *       --endorser-file (default EDGE_SIGNING_KEY_FILE)
 *   npx tsx scripts/edge-signing-key.ts rotate --activate <kid> --by "…"   next → active (publish; both keys active)
 *   npx tsx scripts/edge-signing-key.ts rotate --retire <kid> --by "…"     active → retired (never the genesis root)
 *   npx tsx scripts/edge-signing-key.ts list
 *   npx tsx scripts/edge-signing-key.ts pin --out edge-keyset.json         the provisioning pin (root only, mode 0444)
 *
 * ROTATION (design §2.13): generate (next) → rotate --activate (both active) → wait ≥ 2 config cycles (edges fetch the new
 * keyset) → point EDGE_SIGNING_KEY_FILE of EVERY central instance at the new file and restart them → rotate --retire the
 * previous signer (kept in the keyset until auth TTL + skew). The genesis root stays active: replacing it = re-provisioning
 * every edge with a new pin (a root compromise needs that anyway).
 * Exit codes: 0 done · 1 refused · 2 bad arguments.
 */
import { closeSync, existsSync, openSync, unlinkSync, writeSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { and, asc, eq } from "drizzle-orm";

export interface SigningKeyCliIo {
  out: (line: string) => void;
  err: (line: string) => void;
  env?: NodeJS.ProcessEnv;
}
/** A drizzle handle (the db or a transaction) — tests pass a transaction they roll back. */
export interface SigningKeyCliDeps {
  db?: any;
}

function argOf(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length && !argv[i + 1].startsWith("--") ? argv[i + 1] : undefined;
}

/** Create `file` NEW (refuses an existing one) with `mode`, write `text`. */
function writeNewFile(file: string, text: string, mode: number): void {
  const fd = openSync(file, "wx", mode);
  try {
    writeSync(fd, text);
  } finally {
    closeSync(fd);
  }
}

export async function runEdgeSigningKeyCli(argv: string[], io: SigningKeyCliIo, deps: SigningKeyCliDeps = {}): Promise<number> {
  const cmd = argv[0];
  const env = io.env ?? process.env;
  if (!["generate", "rotate", "list", "pin"].includes(cmd ?? "")) {
    io.err("usage: edge-signing-key.ts <generate --out FILE --by NAME [--endorser-file FILE] | rotate (--activate|--retire) KID --by NAME | list | pin --out FILE>");
    return 2;
  }
  if (argv.some((a) => /^--(private|key-pem|pem)/.test(a))) {
    io.err("a private key is never taken from the command line");
    return 2;
  }
  const by = argOf(argv, "--by")?.trim() ?? "";
  if ((cmd === "generate" || cmd === "rotate") && (!by || by.length > 100)) {
    io.err("--by NAME (who does this, recorded with the key) is required");
    return 2;
  }
  const out = argOf(argv, "--out");
  if ((cmd === "generate" || cmd === "pin") && !out) {
    io.err("--out FILE is required");
    return 2;
  }
  if (out && existsSync(out)) {
    io.err(`${out} already exists — refused (a key / pin file is never overwritten)`);
    return 1;
  }
  const activate = argOf(argv, "--activate");
  const retire = argOf(argv, "--retire");
  if (cmd === "rotate" && (!activate === !retire)) {
    io.err("rotate needs exactly one of --activate KID | --retire KID");
    return 2;
  }

  const sg = await import("../server/services/edge/edgeSigning");
  const { edgeAuthSigningKeys: K } = await import("../server/services/edge/edgeControlSchema");
  const d = deps.db ?? (await (await import("../server/db/connection")).getDb());
  if (!d) {
    io.err("no database (DATABASE_URL) — refused");
    return 1;
  }
  const rows = async () => (await d.select().from(K).orderBy(asc(K.notBefore), asc(K.kid))) as Array<typeof K.$inferSelect>;
  const isRoot = (r: { endorsedByKid: string | null }) => r.endorsedByKid === null;

  if (cmd === "list") {
    const all = await rows();
    if (all.length === 0) io.out("no edge signing keys");
    for (const r of all) {
      io.out(
        `${r.kid}  ${r.status.padEnd(7)}  notBefore ${new Date(r.notBefore).toISOString()}  ${r.retiredAt ? `retired ${new Date(r.retiredAt).toISOString()}  ` : ""}` +
          `${isRoot(r) ? "ROOT (genesis)" : `endorsed by ${r.endorsedByKid}`}  by ${r.createdBy}`,
      );
    }
    return 0;
  }

  if (cmd === "pin") {
    const roots = (await rows()).filter((r) => isRoot(r) && r.status === "active");
    if (roots.length !== 1) {
      io.err(`expected exactly one active genesis key, found ${roots.length} — refused`);
      return 1;
    }
    const pin = sg.edgePinnedKeyset([{ kid: roots[0].kid, publicKeyPem: roots[0].publicKeyPem, notBefore: new Date(roots[0].notBefore).getTime() }]);
    writeNewFile(out!, JSON.stringify(pin, null, 2) + "\n", 0o444);
    io.out(`pin written: ${out} (root ${roots[0].kid}) — copy it next to each edge's credential file (read-only)`);
    return 0;
  }

  if (cmd === "generate") {
    const actives = (await rows()).filter((r) => r.status === "active");
    let endorser: import("../server/services/edge/edgeSigning").EdgeSigningKey | null = null;
    if (actives.length > 0) {
      const endorserFile = argOf(argv, "--endorser-file") ?? env.EDGE_SIGNING_KEY_FILE;
      if (!endorserFile) {
        io.err("an active key exists: --endorser-file (the active key's file, default EDGE_SIGNING_KEY_FILE) is required to endorse the new key");
        return 2;
      }
      try {
        endorser = sg.loadEdgeSigningKey({ EDGE_SIGNING_KEY_FILE: endorserFile });
      } catch (err) {
        io.err(`endorser key unreadable: ${(err as Error).message}`);
        return 1;
      }
      if (!endorser || !actives.some((r) => r.kid === endorser!.kid)) {
        io.err("the endorser key is not an ACTIVE key in edge_auth_signing_keys — refused");
        return 1;
      }
    }
    const gen = sg.generateEdgeSigningKey();
    const notBefore = new Date();
    const identity = { kid: gen.key.kid, publicKeyPem: gen.key.publicKeyPem, notBefore };
    const endorsementSig = endorser ? sg.endorseEdgeKey(endorser, identity) : null;
    writeNewFile(out!, gen.privateKeyPem, 0o600);
    try {
      await d.insert(K).values({
        kid: gen.key.kid,
        publicKeyPem: gen.key.publicKeyPem,
        status: endorser ? "next" : "active",
        notBefore,
        createdBy: by,
        endorsedByKid: endorser?.kid ?? null,
        endorsementSig,
      });
    } catch (err) {
      try {
        unlinkSync(out!);
      } catch {
        /* nothing more to do */
      }
      io.err(`the public key could not be recorded (${(err as Error).message}) — the new key file was removed`);
      return 1;
    }
    io.out(`${endorser ? "next" : "GENESIS (active)"} key ${gen.key.kid} written to ${out} (mode 0600)${endorser ? `, endorsed by ${endorser.kid}` : ""}`);
    io.out(gen.key.publicKeyPem.trim());
    return 0;
  }

  // rotate
  const all = await rows();
  const kid = (activate ?? retire)!;
  const row = all.find((r) => r.kid === kid);
  if (!row) {
    io.err(`no key ${kid}`);
    return 1;
  }
  if (activate) {
    if (row.status !== "next") {
      io.err(`key ${kid} is ${row.status}, not next — refused`);
      return 1;
    }
    const endorserRow = all.find((r) => r.kid === row.endorsedByKid);
    if (!endorserRow || !sg.verifyEdgeKeyEndorsement(row, endorserRow.publicKeyPem)) {
      io.err(`key ${kid}: its endorsement does not verify — refused`);
      return 1;
    }
    await d.update(K).set({ status: "active" }).where(and(eq(K.kid, kid), eq(K.status, "next")));
    io.out(`key ${kid} is active (published). After ≥ 2 config cycles point EDGE_SIGNING_KEY_FILE of every central instance at it, restart, then retire the previous signer (by ${by}).`);
    return 0;
  }
  if (row.status !== "active") {
    io.err(`key ${kid} is ${row.status}, not active — refused`);
    return 1;
  }
  if (isRoot(row)) {
    io.err(`key ${kid} is the genesis root pinned by every edge — it is replaced only by re-provisioning (new pin), never retired here`);
    return 1;
  }
  if (all.filter((r) => r.status === "active" && r.kid !== kid).length === 0) {
    io.err("refused: no other active key would remain");
    return 1;
  }
  await d.update(K).set({ status: "retired", retiredAt: new Date() }).where(and(eq(K.kid, kid), eq(K.status, "active")));
  io.out(`key ${kid} retired (kept in the keyset until auth TTL + skew) by ${by}`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runEdgeSigningKeyCli(process.argv.slice(2), { out: (l) => console.log(l), err: (l) => console.error(l) })
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(`edge-signing-key: ${(err as Error)?.message ?? err}`);
      process.exit(1);
    });
}
