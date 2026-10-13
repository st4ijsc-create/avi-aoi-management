#!/usr/bin/env tsx
/**
 * doc 81 Đợt 9 task S1/S5 — provision / rotate / revoke the per-node EDGE CREDENTIAL (mig 0370). Runs on the CENTRAL host
 * (its DATABASE_URL — the control-plane DB). Every change is made by an ACTIVE ADMIN user with a reason, and is recorded in
 * the credential row itself (WORM identity) and in audit_logs — never with the secret.
 *
 * doc 81 Đợt 9 final wave F7 — the admin is PROVEN, never self-asserted: `--actor <username>`, then the account's password
 * and, when the account has 2FA on, its current authenticator code — the web login's own checks (lockout, audit). The old
 * `--actor-user-id N` (anyone holding DATABASE_URL could name any admin) is refused.
 * doc 81 Đợt 10 F2 round 2 (N7, N8, D14): the password / code come ONLY from a hidden TTY prompt or PIPED STDIN (line 1 password,
 * line 2 the 2FA code) — EDGE_CRED_ADMIN_PASSWORD / _OTP are REFUSED (exit 2), argv spellings too; a wrong / replayed 2FA code
 * is audited `login_2fa` and counted into the account lockout (verifyCredentialAdmin); `register-node --node CODE --factory CODE
 * [--lines L1,L2] [--name TEXT]` registers a node (admin only — no self-registration, D14), factory and lines validated.
 *
 *   npx tsx scripts/edge-node-credential.ts issue  --node edge-line1 --actor admin.nguyen --reason "commission line 1" --out /root/edge-line1.cred
 *   npx tsx scripts/edge-node-credential.ts rotate --node edge-line1 --actor admin.nguyen --reason "quarterly rotation" --out /root/edge-line1.cred
 *   npx tsx scripts/edge-node-credential.ts revoke --node edge-line1 --actor admin.nguyen --reason "gateway replaced"
 *   npx tsx scripts/edge-node-credential.ts list   --node edge-line1
 *
 * The secret is shown ONCE: with `--out FILE` it is written to that file only (created new, mode 0600 — an existing file is
 * refused, never overwritten), otherwise printed once on stdout. Write it OUTSIDE the repo checkout, move it to the edge host
 * (outside any checkout, mode 600 — docs/EDGE_GATEWAY.md section 8.2) and delete the local copy. Exit codes: 0 done · 1 refused (not admin, node unknown, already active, …) · 2 bad arguments.
 *
 * doc 81 Đợt 10 task F2 — the NODE BUNDLE (design §2.13 "the bundle writes the keyset pin"; R-10-ad env): with
 * `--bundle DIR` (issue / rotate) the CLI creates a NEW directory DIR (mode 0700, never an existing one) holding everything one
 * edge node needs and nothing else — no DATABASE_URL, no JWT_SECRET, no SECRET_ENCRYPTION_KEY:
 *   edge-node.cred   the credential (0600, the secret's only copy),
 *   edge-keyset.json the keyset PIN (0444) built from the central KEYRING FILES (--keyring-dir or EDGE_SIGNING_KEY_DIR; R-10-c:
 *                    trust from the files only, never from the DB),
 *   edge-node.env    the non-secret environment for deploy/edge/docker-compose.edge.yml: EDGE_GATEWAY_NODE_CODE, EDGE_CENTRAL_URL
 *                    (--central-url), EDGE_CENTRAL_NODE_ID, EDGE_CENTRAL_CREDENTIAL_ID, EDGE_NODE_CREDENTIAL_HOST_FILE +
 *                    EDGE_KEYSET_PIN_HOST_FILE (where the two files will live ON THE EDGE HOST: --edge-dir, default /etc/avi-edge),
 *                    EDGE_JOURNAL_MAX_BYTES (--journal-max-bytes, default 64 MiB; EDGE_JOURNAL_DIR is fixed in the compose file).
 * The keyring is read and the pin built BEFORE the admin proof and the issue (a bad keyring changes nothing); a refused issue
 * removes the empty directory.
 *   npx tsx scripts/edge-node-credential.ts issue --node edge-line1 --actor admin.nguyen --reason "commission line 1" \
 *       --bundle /root/edge-line1-bundle --keyring-dir /etc/avi/edge-keys --central-url https://central.example:3000
 * A secret is never taken from argv in ANY spelling (`--password=…`, `--otp …`, `--pass`, `--totp`, …) — Đợt 10 F2 (N7, part).
 */
import { openSync, writeSync, closeSync, unlinkSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { proveAdminWith, readAdminSecrets, setSecretEnv, stdinReader } from "./edgeAdminLogin";

export interface CliIo {
  out: (line: string) => void;
  err: (line: string) => void;
  /** a hidden prompt (password / 2FA code); null ⇒ no terminal to ask on */
  promptSecret?: (label: string) => Promise<string | null>;
  /** Đợt 10 F2 round 2 (N7): piped stdin — line 1 password, line 2 optional 2FA code; null ⇒ stdin is a terminal */
  readStdin?: () => Promise<string | null>;
  /** the environment (default process.env): EDGE_SIGNING_KEY_DIR; the refused secret variables are checked here */
  env?: NodeJS.ProcessEnv;
}
/** N7 — a secret in an environment variable is REFUSED (exit 2), not read. */
export const REFUSED_SECRET_ENV = ["EDGE_CRED_ADMIN_PASSWORD", "EDGE_CRED_ADMIN_OTP"] as const;

function argOf(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
}

/** The bundle file names (inside --bundle DIR); the compose file maps them to /run/secrets/*. */
export const BUNDLE_FILES = { credential: "edge-node.cred", pin: "edge-keyset.json", env: "edge-node.env" } as const;
const DEFAULT_EDGE_DIR = "/etc/avi-edge";
const DEFAULT_JOURNAL_MAX_BYTES = 64 * 1024 * 1024;
/** Every argv spelling that would carry a secret (refused before anything else). */
const SECRET_ARG = /^--(password|passwd|pass|pwd|otp|totp|2fa|secret|token|credential)(=|$)/i;

export async function runEdgeCredentialCli(argv: string[], io: CliIo): Promise<number> {
  const cmd = argv[0];
  const node = argOf(argv, "--node");
  const actorName = argOf(argv, "--actor");
  const reason = argOf(argv, "--reason") ?? "";
  const outFile = argOf(argv, "--out");
  if (!["issue", "rotate", "revoke", "list", "register-node"].includes(cmd ?? "") || !node) {
    io.err("usage: edge-node-credential.ts <issue|rotate|revoke|list|register-node> --node CODE [--actor ADMIN_USERNAME --reason TEXT] [--out FILE | --bundle DIR --keyring-dir DIR [--central-url URL] [--edge-dir PATH] [--journal-max-bytes N]] | register-node --node CODE --factory CODE [--lines L1,L2] [--name TEXT] --actor ADMIN --reason TEXT");
    return 2;
  }
  if (argv.some((a) => /^--(actor-user-id|actor-id|user-id|by)(=|$)/i.test(a))) {
    io.err("a self-asserted actor (--actor-user-id / --by) is not accepted: use --actor <admin username> — the password is asked on the terminal or read from piped stdin");
    return 2;
  }
  if (argv.some((a) => SECRET_ARG.test(a))) {
    io.err("a password / 2FA code is never taken from the command line (process list, shell history) — type it at the prompt, or pipe it on stdin (line 1 password, line 2 2FA code)");
    return 2;
  }
  if (cmd !== "list" && !actorName) {
    io.err("--actor (an active admin's username) is required");
    return 2;
  }
  const env = io.env ?? process.env;
  // Đợt 10 F2 round 2 (N7): the password / code never come from an environment variable (shell history, child processes, .env)
  const leaked = setSecretEnv(env, REFUSED_SECRET_ENV);
  if (leaked.length) {
    io.err(`${leaked.join(" / ")} is set — a secret in an environment variable is refused (unset it): type the password at the prompt, or pipe it on stdin (line 1 password, line 2 2FA code)`);
    return 2;
  }
  // D14 — register-node: its own arguments, validated before the admin proof
  const factory = argOf(argv, "--factory")?.trim() ?? "";
  const lineCodes = (argOf(argv, "--lines") ?? "").split(",").map((l) => l.trim()).filter(Boolean);
  if (cmd === "register-node" && (!factory || factory.startsWith("--"))) {
    io.err("register-node needs --factory CODE (a node without a factory is given no device and no run)");
    return 2;
  }
  // ── doc 81 Đợt 10 F2 — the node bundle: validated and its pin BUILT before anything else (no write, no DB) ─────────────
  const bundleDir = argOf(argv, "--bundle");
  let bundle: { dir: string; pinText: string; pinInfo: string; centralUrl: string | null; edgeDir: string; journalMaxBytes: number } | null = null;
  if (bundleDir !== undefined) {
    if (cmd !== "issue" && cmd !== "rotate") {
      io.err("--bundle is for issue / rotate only");
      return 2;
    }
    if (outFile) {
      io.err("--bundle and --out are exclusive (the bundle holds the credential file)");
      return 2;
    }
    const keyringDir = argOf(argv, "--keyring-dir") ?? env.EDGE_SIGNING_KEY_DIR;
    if (!keyringDir) {
      io.err("--bundle needs the central signing KEYRING directory (--keyring-dir DIR or EDGE_SIGNING_KEY_DIR) — the pin comes from the keyring files only");
      return 2;
    }
    const centralUrl = argOf(argv, "--central-url") ?? null;
    if (centralUrl !== null) {
      let u: URL | null = null;
      try {
        u = new URL(centralUrl);
      } catch {
        u = null;
      }
      if (!u || (u.protocol !== "https:" && u.protocol !== "http:") || u.username || u.password) {
        io.err("--central-url must be an http(s) URL without credentials (e.g. https://central.example:3000)");
        return 2;
      }
    }
    const edgeDir = (argOf(argv, "--edge-dir") ?? DEFAULT_EDGE_DIR).replace(/[\\/]+$/, "");
    if (!edgeDir || /[\s"'$`]/.test(edgeDir)) {
      io.err("--edge-dir must be a plain absolute path on the edge host (no spaces / quotes)");
      return 2;
    }
    const jm = argOf(argv, "--journal-max-bytes");
    const journalMaxBytes = jm === undefined ? DEFAULT_JOURNAL_MAX_BYTES : Number(jm);
    if (!Number.isSafeInteger(journalMaxBytes) || journalMaxBytes < 1024 * 1024) {
      io.err("--journal-max-bytes must be an integer ≥ 1048576 (1 MiB)");
      return 2;
    }
    try {
      const sg = await import("../server/services/edge/edgeSigning");
      const pin = sg.edgePinFromKeyring(sg.readEdgeKeyring(keyringDir));
      bundle = { dir: bundleDir, pinText: JSON.stringify(pin, null, 2) + "\n", pinInfo: `root ${pin.keyset.keys[0].kid}, keyring version ${pin.keyset.version}`, centralUrl, edgeDir, journalMaxBytes };
    } catch (err) {
      io.err(`keyring refused (${(err as Error)?.message ?? err}) — nothing was changed`);
      return 1;
    }
  }
  const m = await import("../server/services/edge/edgeNodeCredentials");
  let fd: number | null = null;
  let bundleCreated = false;
  try {
    // final wave F7 — prove the admin BEFORE anything else (a refused login changes nothing, leaves no file)
    let actor = 0;
    if (cmd !== "list") {
      // N7 — TTY prompt, else piped stdin (line 1 password, line 2 2FA code); a missing code is asked once on a TTY only
      const secrets = await readAdminSecrets(io, actorName!);
      const verified = await proveAdminWith((l) => m.verifyCredentialAdmin(l), io, actorName!, secrets);
      actor = verified.userId;
      io.out(`admin verified: ${verified.name} (user ${verified.userId})`);
    }
    if (cmd === "register-node") {
      const r = await m.registerEdgeNode({ nodeCode: node, factoryCode: factory, lineCodes, name: argOf(argv, "--name") ?? null, actorUserId: actor, reason });
      io.out(r.created ? `registered edge node "${node}" (id ${r.nodeId}) in factory ${factory}${lineCodes.length ? `, lines ${lineCodes.join(",")}` : ""} — issue its credential + bundle next` : `edge node "${node}" (id ${r.nodeId}) is already registered with exactly this factory and lines — unchanged`);
      return 0;
    }
    if (cmd === "list") {
      for (const c of await m.listNodeCredentials(node)) {
        io.out(`${c.id}\t${c.keyPrefix}\t${c.status}\tcreatedBy=${c.createdBy ?? "-"}\t${c.createdAt?.toISOString?.() ?? c.createdAt}\trevokedAt=${c.revokedAt ? new Date(c.revokedAt).toISOString() : "-"}\t${c.revokeReason ?? ""}`);
      }
      return 0;
    }
    if (cmd === "revoke") {
      const r = await m.revokeNodeCredential({ nodeCode: node, actorUserId: actor, reason });
      io.out(`revoked credential ${r.credentialId} of node "${node}" — the node can no longer pull, claim or report`);
      return 0;
    }
    // the bundle directory is created NEW (never an existing one) BEFORE the credential is issued
    if (bundle) {
      try {
        mkdirSync(bundle.dir, { mode: 0o700 });
        bundleCreated = true;
        fd = openSync(path.join(bundle.dir, BUNDLE_FILES.credential), "wx", 0o600);
      } catch {
        io.err(`--bundle ${bundle.dir}: cannot create it (it exists, or the parent is not writable) — nothing was changed`);
        if (bundleCreated) rmSync(bundle.dir, { recursive: true, force: true });
        return 1;
      }
    }
    // refuse an existing --out BEFORE changing anything (the secret would otherwise exist nowhere)
    if (outFile) {
      try {
        fd = openSync(outFile, "wx", 0o600);
      } catch {
        io.err(`--out ${outFile}: cannot create it (it exists, or the folder is not writable) — nothing was changed`);
        return 1;
      }
    }
    const issued = cmd === "issue" ? await m.issueNodeCredential({ nodeCode: node, actorUserId: actor, reason }) : await m.rotateNodeCredential({ nodeCode: node, actorUserId: actor, reason });
    if (fd !== null && bundle) {
      const written = fd;
      fd = null;
      bundleCreated = false; // issued: the bundle now holds the secret's only copy — never deleted by the error path
      writeSync(written, `${issued.token}\n`);
      closeSync(written);
      writeFileSync(path.join(bundle.dir, BUNDLE_FILES.pin), bundle.pinText, { mode: 0o444, flag: "wx" });
      const envLines = [
        `# edge node bundle — node "${node}", credential ${issued.credentialId} (${issued.keyPrefix}), keyset pin: ${bundle.pinInfo}`,
        "# generated by scripts/edge-node-credential.ts (doc 81 Dot 10). NO secret in this file: the credential is edge-node.cred.",
        "# The edge holds no DATABASE_URL, JWT_SECRET or SECRET_ENCRYPTION_KEY (docs/EDGE_GATEWAY.md section 8).",
        `EDGE_GATEWAY_NODE_CODE=${node}`,
        bundle.centralUrl ? `EDGE_CENTRAL_URL=${bundle.centralUrl}` : "# EDGE_CENTRAL_URL=https://central.example:3000   (set it: --central-url was not given)",
        `EDGE_CENTRAL_NODE_ID=${issued.nodeId}`,
        `EDGE_CENTRAL_CREDENTIAL_ID=${issued.credentialId}`,
        `EDGE_NODE_CREDENTIAL_HOST_FILE=${bundle.edgeDir}/${BUNDLE_FILES.credential}`,
        `EDGE_KEYSET_PIN_HOST_FILE=${bundle.edgeDir}/${BUNDLE_FILES.pin}`,
        `EDGE_JOURNAL_MAX_BYTES=${bundle.journalMaxBytes}`,
        "",
      ];
      writeFileSync(path.join(bundle.dir, BUNDLE_FILES.env), envLines.join("\n"), { mode: 0o644, flag: "wx" });
      io.out(`${cmd === "issue" ? "issued" : "rotated"} credential ${issued.credentialId} (${issued.keyPrefix}) of node "${node}" — bundle written to ${bundle.dir}: ${BUNDLE_FILES.credential} (secret, 0600), ${BUNDLE_FILES.pin} (${bundle.pinInfo}), ${BUNDLE_FILES.env}`);
      io.out(`move the bundle to the edge host under ${bundle.edgeDir} (mode 700, owned by the gateway's user), then delete it here`);
    } else if (fd !== null) {
      const written = fd;
      fd = null; // issued: from here on the file is the secret's only copy — never deleted by the error path
      writeSync(written, `${issued.token}\n`);
      closeSync(written);
      io.out(`${cmd === "issue" ? "issued" : "rotated"} credential ${issued.credentialId} (${issued.keyPrefix}) of node "${node}" — secret written to ${outFile} (only there)`);
    } else {
      io.out(`${cmd === "issue" ? "issued" : "rotated"} credential ${issued.credentialId} (${issued.keyPrefix}) of node "${node}" — the secret, shown ONCE:`);
      io.out(issued.token);
    }
    return 0;
  } catch (err) {
    if (fd !== null && bundle) {
      closeSync(fd);
      fd = null;
    }
    if (bundleCreated && bundle) rmSync(bundle.dir, { recursive: true, force: true }); // nothing was issued: no empty bundle left
    if (fd !== null && outFile) {
      closeSync(fd);
      unlinkSync(outFile); // nothing was issued: no empty secret file is left behind
    }
    if (err instanceof m.EdgeCredentialError) {
      io.err(`refused (${err.code}): ${err.message}`);
      return 1;
    }
    io.err(`failed: ${(err as Error)?.message ?? err}`);
    return 1;
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
    .then(() => runEdgeCredentialCli(process.argv.slice(2), { out: (l) => console.log(l), err: (l) => console.error(l), promptSecret: ttyHiddenPrompt, readStdin: stdinReader() }))
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(`failed: ${(err as Error)?.message ?? err}`);
      process.exit(1);
    });
}
