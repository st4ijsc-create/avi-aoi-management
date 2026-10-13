#!/usr/bin/env tsx
/**
 * doc 81 Đợt 10 task F2 — ruling R-10-s: mark which EDGE NODE owns a robot / OT adapter (design §2.12, mig 0374), or hand it
 * back to CENTRAL. Runs on the CENTRAL host (its DATABASE_URL). The change itself is D's `changeDeviceOwner` (one transaction:
 * WORM history `device_owner_changes` naming the actor, owner epoch bump, robot relock, unacknowledged STOPs carried; refused
 * while a job / write is in flight; R-10-am: a device is handed only to a node of ITS OWN factory).
 *
 * The admin is PROVEN, never self-asserted (the Đợt 9 F7 pattern of edge-node-credential.ts / edge-signing-key.ts):
 * `--actor <username>`, the account's password from a hidden prompt (or EDGE_OWNER_ADMIN_PASSWORD) and, with 2FA on, its current
 * code (prompt, or EDGE_OWNER_ADMIN_OTP) — verifyCredentialAdmin (bcrypt, lockout, audit, TOTP in the shared DB ledger, active
 * admin) BEFORE any write. A secret is NEVER taken from argv in any spelling (`--password=…`, `--otp …`, `--pass`, `--totp`,
 * `--secret`, …) and a free-text actor (`--by`, `--actor-user-id`) is refused. Every assign / release — done or refused — is an
 * audit_logs row (EDGE_DEVICE_OWNER_ASSIGN / _RELEASE, status success | failure) with the reason.
 *
 *   npx tsx scripts/edge-device-owner.ts assign  --robot 12   --node edge-line1 --actor admin.nguyen --reason "commission line 1"
 *   npx tsx scripts/edge-device-owner.ts assign  --adapter 7  --node edge-line1 --actor admin.nguyen --reason "commission line 1"
 *   npx tsx scripts/edge-device-owner.ts release --robot 12   --actor admin.nguyen --reason "gateway replaced"   (back to central)
 *   npx tsx scripts/edge-device-owner.ts list    [--node edge-line1]
 *
 * Release to central: the STOPs still owed to the device are executed by central (in this process right away when the robot /
 * OT control flags allow it, and in any case by the server's sweep within ≤ 10 s — R-10-w). The running server applies the new
 * owner live (pg NOTIFY device_owner_changed, reconcile ≤ 30 s). Exit codes: 0 done · 1 refused · 2 bad arguments.
 */
import { pathToFileURL } from "node:url";

export interface OwnerCliIo {
  out: (line: string) => void;
  err: (line: string) => void;
  /** a hidden prompt (password / 2FA code); null ⇒ no terminal to ask on */
  promptSecret?: (label: string) => Promise<string | null>;
  /** where EDGE_OWNER_ADMIN_PASSWORD / EDGE_OWNER_ADMIN_OTP are read (default process.env) */
  env?: NodeJS.ProcessEnv;
}
export type DeviceKind = "robot" | "adapter";
export interface OwnedDeviceRow {
  kind: DeviceKind;
  id: number;
  code: string | null;
  edgeNodeId: number | null;
  nodeCode: string | null;
  ownerEpoch: number;
}
export interface OwnerCliDeps {
  verifyAdmin?: (login: { username: string; password: string | null; otp: string | null }) => Promise<{ userId: number; name: string }>;
  changeOwner?: (a: { kind: DeviceKind; deviceId: number; toEdgeNodeId: number | null; actorUserId: number; actorName: string }) => Promise<import("../server/services/robot/deviceOwnershipService").ChangeOwnerResult>;
  /** the node id of a code (null ⇒ unknown) */
  nodeIdOf?: (code: string) => Promise<number | null>;
  audit?: (e: { action: string; actor: { userId: number; name: string }; status: "success" | "failure"; entityName: string; details: Record<string, unknown> }) => Promise<void>;
  listOwned?: (nodeCode: string | null) => Promise<OwnedDeviceRow[]>;
}

function argOf(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 && i + 1 < argv.length && !argv[i + 1].startsWith("--") ? argv[i + 1] : undefined;
}
const USAGE =
  "usage: edge-device-owner.ts assign (--robot ID | --adapter ID) --node CODE --actor ADMIN --reason TEXT | release (--robot ID | --adapter ID) --actor ADMIN --reason TEXT | list [--node CODE]";

/** Every argv spelling that would carry a secret or a self-asserted actor (refused before anything else). */
const SECRET_ARG = /^--(password|passwd|pass|pwd|otp|totp|2fa|secret|token)(=|$)/i;
const FREE_ACTOR_ARG = /^--(by|actor-user-id|actor-id|user-id)(=|$)/i;
const KNOWN = new Set(["--robot", "--adapter", "--node", "--actor", "--reason"]);

async function defaultNodeIdOf(code: string): Promise<number | null> {
  const { getDb } = await import("../server/db/connection");
  const { edgeNodes } = await import("../drizzle/schema");
  const { eq } = await import("drizzle-orm");
  const d = await getDb();
  if (!d) throw new Error("database unavailable");
  const [n] = await d.select({ id: edgeNodes.id }).from(edgeNodes).where(eq(edgeNodes.code, code)).limit(1);
  return n ? n.id : null;
}
async function defaultAudit(e: Parameters<NonNullable<OwnerCliDeps["audit"]>>[0]): Promise<void> {
  const { createAuditLog } = await import("../server/db/system");
  await createAuditLog({ userId: e.actor.userId, userName: e.actor.name, action: e.action, entityType: "edge_device_owner", entityName: e.entityName, details: e.details, status: e.status, ipAddress: "cli:edge-device-owner", userAgent: "edge-device-owner CLI" });
}
async function defaultListOwned(nodeCode: string | null): Promise<OwnedDeviceRow[]> {
  const { getDb } = await import("../server/db/connection");
  const { sql } = await import("drizzle-orm");
  const d = await getDb();
  if (!d) throw new Error("database unavailable");
  const r = (await d.execute(sql`
    SELECT 'robot' AS kind, r.id, r.code, r."edgeNodeId", n.code AS "nodeCode", r."ownerEpoch" FROM public.robots r LEFT JOIN public.edge_nodes n ON n.id = r."edgeNodeId"
     WHERE r."edgeNodeId" IS NOT NULL AND (${nodeCode}::text IS NULL OR n.code = ${nodeCode})
    UNION ALL
    SELECT 'adapter', a.id, a.code, a."edgeNodeId", n.code, a."ownerEpoch" FROM public.device_adapters a LEFT JOIN public.edge_nodes n ON n.id = a."edgeNodeId"
     WHERE a."edgeNodeId" IS NOT NULL AND (${nodeCode}::text IS NULL OR n.code = ${nodeCode})
    ORDER BY 1, 2`)) as unknown as Array<Record<string, unknown>> | { rows: Array<Record<string, unknown>> };
  const rows = Array.isArray(r) ? r : r.rows;
  return rows.map((x) => ({ kind: x.kind as DeviceKind, id: Number(x.id), code: (x.code as string | null) ?? null, edgeNodeId: x.edgeNodeId == null ? null : Number(x.edgeNodeId), nodeCode: (x.nodeCode as string | null) ?? null, ownerEpoch: Number(x.ownerEpoch) }));
}

/** R-10-am — the factory refusal texts of changeDeviceOwner (ownerFactoryRefusal). */
const CROSS_FACTORY = /belongs to factory|serves factory|has no factoryCode|has no factory|factory of .* could not be read/;

export async function runEdgeDeviceOwnerCli(argv: string[], io: OwnerCliIo, deps: OwnerCliDeps = {}): Promise<number> {
  const cmd = argv[0];
  if (!["assign", "release", "list"].includes(cmd ?? "")) {
    io.err(USAGE);
    return 2;
  }
  if (argv.some((a) => SECRET_ARG.test(a))) {
    io.err("a password / 2FA code is never taken from the command line (process list, shell history) — use the prompt or EDGE_OWNER_ADMIN_PASSWORD / EDGE_OWNER_ADMIN_OTP");
    return 2;
  }
  if (argv.some((a) => FREE_ACTOR_ARG.test(a))) {
    io.err("a self-asserted actor (--by / --actor-user-id) is refused: use --actor <admin username> — the password is asked (or EDGE_OWNER_ADMIN_PASSWORD)");
    return 2;
  }
  const unknown = argv.slice(1).filter((a, i, all) => a.startsWith("--") && !KNOWN.has(a) && !(i > 0 && KNOWN.has(all[i - 1])));
  if (unknown.length) {
    io.err(`unknown option(s): ${unknown.join(" ")} — ${USAGE}`);
    return 2;
  }
  const nodeCode = argOf(argv, "--node")?.trim() || null;

  if (cmd === "list") {
    const rows = await (deps.listOwned ?? defaultListOwned)(nodeCode);
    if (rows.length === 0) io.out(nodeCode ? `no device is owned by edge node "${nodeCode}"` : "no device is edge-owned (every robot / adapter is central)");
    for (const r of rows) io.out(`${r.kind}\t${r.id}\t${r.code ?? "-"}\tnode=${r.nodeCode ?? r.edgeNodeId}\townerEpoch=${r.ownerEpoch}`);
    return 0;
  }

  const robot = argOf(argv, "--robot");
  const adapter = argOf(argv, "--adapter");
  if ((robot === undefined) === (adapter === undefined)) {
    io.err(`exactly one of --robot ID | --adapter ID is required — ${USAGE}`);
    return 2;
  }
  const kind: DeviceKind = robot !== undefined ? "robot" : "adapter";
  const deviceId = Number(robot ?? adapter);
  if (!Number.isSafeInteger(deviceId) || deviceId <= 0) {
    io.err(`--${kind} must be a positive integer id`);
    return 2;
  }
  if (cmd === "assign" && !nodeCode) {
    io.err("assign needs --node CODE (the edge node that will own the device)");
    return 2;
  }
  if (cmd === "release" && nodeCode) {
    io.err("release hands the device back to CENTRAL — it takes no --node");
    return 2;
  }
  const actorName = argOf(argv, "--actor")?.trim() ?? "";
  if (!actorName || actorName.length > 200) {
    io.err("--actor ADMIN_USERNAME (an active admin; proven by password / 2FA) is required");
    return 2;
  }
  const reason = (argOf(argv, "--reason") ?? "").trim();
  if (reason.length < 3) {
    io.err("--reason TEXT (at least 3 characters) is required — it is recorded in the audit log");
    return 2;
  }

  // ── prove the admin BEFORE anything is read for a write or written (a refused login changes nothing) ─────────────
  const env = io.env ?? process.env;
  let actor: { userId: number; name: string };
  try {
    const password = env.EDGE_OWNER_ADMIN_PASSWORD || (io.promptSecret ? await io.promptSecret(`password of ${actorName}: `) : null);
    const otp = env.EDGE_OWNER_ADMIN_OTP || null;
    if (deps.verifyAdmin) actor = await deps.verifyAdmin({ username: actorName, password, otp });
    else {
      const m = await import("../server/services/edge/edgeNodeCredentials");
      try {
        actor = await m.verifyCredentialAdmin({ username: actorName, password, otp });
      } catch (err) {
        if (!(err instanceof m.EdgeCredentialError) || err.code !== "otpRequired" || otp || !io.promptSecret) throw err;
        actor = await m.verifyCredentialAdmin({ username: actorName, password, otp: await io.promptSecret("2FA code: ") });
      }
    }
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

  const action = cmd === "assign" ? "EDGE_DEVICE_OWNER_ASSIGN" : "EDGE_DEVICE_OWNER_RELEASE";
  const entityName = `${kind}:${deviceId}`;
  const audit = deps.audit ?? defaultAudit;
  const writeAudit = async (status: "success" | "failure", details: Record<string, unknown>) => {
    try {
      await audit({ action, actor, status, entityName, details: { kind, deviceId, toNode: nodeCode, reason, ...details } });
    } catch (err) {
      io.err(`WARNING: audit row not written (${(err as Error)?.message ?? err}) — device_owner_changes (WORM) still names the actor`);
    }
  };

  let toEdgeNodeId: number | null = null;
  if (cmd === "assign") {
    let nodeId: number | null;
    try {
      nodeId = await (deps.nodeIdOf ?? defaultNodeIdOf)(nodeCode!);
    } catch (err) {
      io.err(`failed: edge node "${nodeCode}" could not be read (${(err as Error)?.message ?? err}) — nothing was changed`);
      await writeAudit("failure", { outcome: "unavailable" });
      return 1;
    }
    if (nodeId === null) {
      io.err(`refused: edge node "${nodeCode}" is not registered — nothing was changed`);
      await writeAudit("failure", { outcome: "nodeNotFound" });
      return 1;
    }
    toEdgeNodeId = nodeId;
  }

  const change = deps.changeOwner ?? (await import("../server/services/robot/deviceOwnershipService")).changeDeviceOwner;
  // the WORM history (device_owner_changes.changedBy) names the proven admin AND the reason
  const r = await change({ kind, deviceId, toEdgeNodeId, actorUserId: actor.userId, actorName: `${actor.name} — ${reason}`.slice(0, 100) });
  if (!r.ok) {
    const crossFactory = r.reason === "refused" && CROSS_FACTORY.test(r.detail);
    if (crossFactory) {
      io.err(`refused (cross-factory, R-10-am): ${r.detail}`);
      io.err("a device is handed only to an edge node of ITS OWN factory — fix the device's station / line / workshop chain or the node's factoryCode, or choose a node of that factory. Nothing was changed.");
    } else if (r.reason === "refused") io.err(`refused: ${r.detail} — nothing was changed (wait for the in-flight job / write, or resolve its orphaned write intent first)`);
    else if (r.reason === "not_found") io.err(`refused: ${r.detail} — nothing was changed`);
    else io.err(`failed: ${r.detail} — nothing was changed`);
    await writeAudit("failure", { outcome: crossFactory ? "crossFactory" : r.reason, detail: r.detail });
    return 1;
  }
  await writeAudit("success", { outcome: "done", ownerEpoch: r.ownerEpoch, toEdgeNodeId: r.toEdgeNodeId, centralStops: r.centralStops ? { requestIds: r.centralStops.requestIds, outcome: r.centralStops.outcome, sent: r.centralStops.sent } : null });
  io.out(cmd === "assign" ? `${kind} ${deviceId} is now owned by edge node "${nodeCode}" (owner epoch ${r.ownerEpoch})` : `${kind} ${deviceId} is now owned by CENTRAL (owner epoch ${r.ownerEpoch})`);
  if (r.centralStops) {
    const s = r.centralStops;
    io.out(`owed STOP(s) ${s.requestIds.join(", ")}: ${s.notSent ? "NOT sent (central control off here) — left pending for the server's sweep" : `${s.outcome} (${s.sent})`}${s.ackErrors.length ? `; ack not written for ${s.ackErrors.join(", ")} (the sweep retries)` : ""}`);
  }
  if (kind === "robot") io.out(`the robot is LOCKED (ownerChanged) under its new owner — clear the motion lock there after checking it`);
  return 0;
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
    .then(() => runEdgeDeviceOwnerCli(process.argv.slice(2), { out: (l) => console.log(l), err: (l) => console.error(l), promptSecret: ttyHiddenPrompt }))
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(`edge-device-owner: ${(err as Error)?.message ?? err}`);
      process.exit(1);
    });
}
