#!/usr/bin/env tsx
/**
 * doc 81 Đợt 9 task S1/S5 — provision / rotate / revoke the per-node EDGE CREDENTIAL (mig 0370). Runs on the CENTRAL host
 * (its DATABASE_URL — the control-plane DB). Every change is made by an ACTIVE ADMIN user with a reason, and is recorded in
 * the credential row itself (WORM identity) and in audit_logs — never with the secret.
 *
 * doc 81 Đợt 9 final wave F7 — the admin is PROVEN, never self-asserted: `--actor <username>`, then the account's password
 * (hidden prompt on a terminal, else EDGE_CRED_ADMIN_PASSWORD — never on the command line) and, when the account has 2FA on,
 * its current authenticator code (prompt, else EDGE_CRED_ADMIN_OTP) — the web login's own checks (lockout, audit). The old
 * `--actor-user-id N` (anyone holding DATABASE_URL could name any admin) is refused.
 *
 *   npx tsx scripts/edge-node-credential.ts issue  --node edge-line1 --actor admin.nguyen --reason "commission line 1" --out /root/edge-line1.cred
 *   npx tsx scripts/edge-node-credential.ts rotate --node edge-line1 --actor admin.nguyen --reason "quarterly rotation" --out /root/edge-line1.cred
 *   npx tsx scripts/edge-node-credential.ts revoke --node edge-line1 --actor admin.nguyen --reason "gateway replaced"
 *   npx tsx scripts/edge-node-credential.ts list   --node edge-line1
 *
 * The secret is shown ONCE: with `--out FILE` it is written to that file only (created new, mode 0600 — an existing file is
 * refused, never overwritten), otherwise printed once on stdout. Write it OUTSIDE the repo checkout, move it to the edge host
 * (outside any checkout, mode 600 — docs/EDGE_GATEWAY.md section 8.2) and delete the local copy. Exit codes: 0 done · 1 refused (not admin, node unknown, already active, …) · 2 bad arguments.
 */
import { openSync, writeSync, closeSync, unlinkSync } from "node:fs";
import { pathToFileURL } from "node:url";

export interface CliIo {
  out: (line: string) => void;
  err: (line: string) => void;
  /** a hidden prompt (password / 2FA code); null ⇒ no terminal to ask on */
  promptSecret?: (label: string) => Promise<string | null>;
  /** where EDGE_CRED_ADMIN_PASSWORD / EDGE_CRED_ADMIN_OTP are read (default process.env) */
  env?: NodeJS.ProcessEnv;
}

function argOf(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
}

export async function runEdgeCredentialCli(argv: string[], io: CliIo): Promise<number> {
  const cmd = argv[0];
  const node = argOf(argv, "--node");
  const actorName = argOf(argv, "--actor");
  const reason = argOf(argv, "--reason") ?? "";
  const outFile = argOf(argv, "--out");
  if (!["issue", "rotate", "revoke", "list"].includes(cmd ?? "") || !node) {
    io.err("usage: edge-node-credential.ts <issue|rotate|revoke|list> --node CODE [--actor ADMIN_USERNAME --reason TEXT] [--out FILE]");
    return 2;
  }
  if (argv.includes("--actor-user-id")) {
    io.err("--actor-user-id is no longer accepted (a self-asserted id): use --actor <admin username> — the password is asked (or EDGE_CRED_ADMIN_PASSWORD)");
    return 2;
  }
  if (argv.includes("--password") || argv.includes("--otp")) {
    io.err("a password / 2FA code is never taken from the command line (process list, shell history) — use the prompt or EDGE_CRED_ADMIN_PASSWORD / EDGE_CRED_ADMIN_OTP");
    return 2;
  }
  if (cmd !== "list" && !actorName) {
    io.err("--actor (an active admin's username) is required");
    return 2;
  }
  const m = await import("../server/services/edge/edgeNodeCredentials");
  const env = io.env ?? process.env;
  let fd: number | null = null;
  try {
    // final wave F7 — prove the admin BEFORE anything else (a refused login changes nothing, leaves no file)
    let actor = 0;
    if (cmd !== "list") {
      const password = env.EDGE_CRED_ADMIN_PASSWORD || (io.promptSecret ? await io.promptSecret(`password of ${actorName}: `) : null);
      let verified: { userId: number; name: string };
      try {
        verified = await m.verifyCredentialAdmin({ username: actorName, password, otp: env.EDGE_CRED_ADMIN_OTP || null });
      } catch (err) {
        if (!(err instanceof m.EdgeCredentialError) || err.code !== "otpRequired" || env.EDGE_CRED_ADMIN_OTP || !io.promptSecret) throw err;
        // 2FA on and no code given yet: ask once (the password is checked again with it — one proof, one call)
        const otp = await io.promptSecret("2FA code: ");
        verified = await m.verifyCredentialAdmin({ username: actorName, password, otp });
      }
      actor = verified.userId;
      io.out(`admin verified: ${verified.name} (user ${verified.userId})`);
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
    if (fd !== null) {
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
    .then(() => runEdgeCredentialCli(process.argv.slice(2), { out: (l) => console.log(l), err: (l) => console.error(l), promptSecret: ttyHiddenPrompt }))
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(`failed: ${(err as Error)?.message ?? err}`);
      process.exit(1);
    });
}
