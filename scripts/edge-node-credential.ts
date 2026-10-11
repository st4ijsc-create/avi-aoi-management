#!/usr/bin/env tsx
/**
 * doc 81 Đợt 9 task S1/S5 — provision / rotate / revoke the per-node EDGE CREDENTIAL (mig 0370). Runs on the CENTRAL host
 * (its DATABASE_URL — the control-plane DB). Every change is made by a named ACTIVE ADMIN user (checked) with a reason, and is
 * recorded in the credential row itself (WORM identity) and in audit_logs — never with the secret.
 *
 *   npx tsx scripts/edge-node-credential.ts issue  --node edge-line1 --actor-user-id 1 --reason "commission line 1" --out /root/edge-line1.cred
 *   npx tsx scripts/edge-node-credential.ts rotate --node edge-line1 --actor-user-id 1 --reason "quarterly rotation" --out /root/edge-line1.cred
 *   npx tsx scripts/edge-node-credential.ts revoke --node edge-line1 --actor-user-id 1 --reason "gateway replaced"
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
}

function argOf(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
}

export async function runEdgeCredentialCli(argv: string[], io: CliIo): Promise<number> {
  const cmd = argv[0];
  const node = argOf(argv, "--node");
  const actor = Number(argOf(argv, "--actor-user-id"));
  const reason = argOf(argv, "--reason") ?? "";
  const outFile = argOf(argv, "--out");
  if (!["issue", "rotate", "revoke", "list"].includes(cmd ?? "") || !node) {
    io.err("usage: edge-node-credential.ts <issue|rotate|revoke|list> --node CODE [--actor-user-id N --reason TEXT] [--out FILE]");
    return 2;
  }
  if (cmd !== "list" && (!Number.isInteger(actor) || actor <= 0)) {
    io.err("--actor-user-id (an active admin user id) is required");
    return 2;
  }
  const m = await import("../server/services/edge/edgeNodeCredentials");
  let fd: number | null = null;
  try {
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  import("dotenv/config") // the central host's DATABASE_URL (only when run as a program — never when imported by a test)
    .then(() => runEdgeCredentialCli(process.argv.slice(2), { out: (l) => console.log(l), err: (l) => console.error(l) }))
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(`failed: ${(err as Error)?.message ?? err}`);
      process.exit(1);
    });
}
