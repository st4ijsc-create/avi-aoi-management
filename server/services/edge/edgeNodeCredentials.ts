/**
 * doc 81 Đợt 9 task S1 (owner decision 2026-10-12, mig 0370) — the PER-NODE EDGE CREDENTIAL.
 *
 * Token: `edn_<12 hex>.<43 base64url>` — the part before the dot is the public lookup prefix (unique), the part after it is
 * 256 random bits. Only SHA-256(token) is stored (`edge_node_credentials.secretHash`): with 256 bits of entropy a fast hash
 * is the right one (no dictionary to slow down). The plaintext is returned ONCE by issue / rotate and never stored, logged
 * or audited (audit rows carry the prefix only).
 *
 *   • ISSUE  — only when the node has no active credential (the partial unique index enforces "at most one active").
 *   • ROTATE — in ONE transaction: the active row is revoked (reason "rotated"), the new one inserted with rotatedFromId.
 *              No overlap window: the old secret stops working at the commit (the edge must be given the new one).
 *   • REVOKE — terminal (trigger). A node with no active credential cannot authenticate at all.
 * Who: an ACTIVE ADMIN user (checked here; the row records createdBy / revokedBy). Reason ≥ 3 chars. doc 81 Đợt 9 final wave
 * F7 — the operator CLI never takes a self-asserted actor id: it PROVES the admin with verifyCredentialAdmin (the web login's
 * own password check — bcrypt, lockout, audit — plus the account's TOTP when 2FA is on) and passes only that verified id.
 * Every change is recorded twice: in the credential row itself (WORM identity, trigger) and in audit_logs.
 *
 *   • RETIRE (doc 81 Đợt 12 O, mig 0378 — retireEdgeNode) — terminal for the NODE: every active credential revoked and the node
 *              marked retired in one transaction, refused while it still owns a device / has an open STOP or lock request / a
 *              non-terminal run; the DB then refuses any new credential, device, run or claim for it. Never deleted.
 *
 * AUTHENTICATION (authenticateEdgeNodeToken): malformed / unknown prefix / revoked / hash mismatch / node gone / any DB
 * error ⇒ null (the route answers the SAME 401 for all of them — no oracle about which prefixes exist). The comparison is
 * constant-time over the two hashes. Never throws.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../../db/connection";
import { edgeNodes, users } from "../../../drizzle/schema";
import { edgeNodeCredentials } from "./edgeExecutionSchema";

export const EDGE_NODE_TOKEN_RE = /^(edn_[0-9a-f]{12})\.([A-Za-z0-9_-]{43})$/;

/** SHA-256 hex of a whole token (credential or claim token). */
export function hashEdgeSecret(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Constant-time equality of two hex digests (false on any length / format mismatch). */
export function sameDigest(a: string | null | undefined, b: string | null | undefined): boolean {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== 64 || b.length !== 64) return false;
  const x = Buffer.from(a, "hex");
  const y = Buffer.from(b, "hex");
  return x.length === 32 && y.length === 32 && timingSafeEqual(x, y);
}

function mintNodeToken(): { token: string; keyPrefix: string; secretHash: string } {
  const keyPrefix = `edn_${randomBytes(6).toString("hex")}`;
  const token = `${keyPrefix}.${randomBytes(32).toString("base64url")}`;
  return { token, keyPrefix, secretHash: hashEdgeSecret(token) };
}

export interface EdgeNodePrincipal {
  credentialId: number;
  nodeId: number;
  nodeCode: string;
  factoryCode: string | null;
}

/** Resolve a presented token to its node. null for EVERY failure (see header). Never throws, never logs the token. */
export async function authenticateEdgeNodeToken(token: unknown): Promise<EdgeNodePrincipal | null> {
  try {
    if (typeof token !== "string") return null;
    const m = EDGE_NODE_TOKEN_RE.exec(token.trim());
    if (!m) return null;
    const d = await getDb();
    if (!d) return null;
    const [row] = await d
      .select({
        id: edgeNodeCredentials.id,
        secretHash: edgeNodeCredentials.secretHash,
        status: edgeNodeCredentials.status,
        nodeId: edgeNodes.id,
        nodeCode: edgeNodes.code,
        factoryCode: edgeNodes.factoryCode,
      })
      .from(edgeNodeCredentials)
      .innerJoin(edgeNodes, eq(edgeNodes.id, edgeNodeCredentials.edgeNodeId))
      .where(eq(edgeNodeCredentials.keyPrefix, m[1]))
      .limit(1);
    // the hash is compared even for a missing / revoked row's absence of one (same work, same answer)
    const ok = sameDigest(hashEdgeSecret(token.trim()), row?.secretHash ?? "0".repeat(64));
    if (!row || !ok || row.status !== "active") return null;
    void d.update(edgeNodeCredentials).set({ lastUsedAt: new Date() }).where(eq(edgeNodeCredentials.id, row.id)).catch(() => undefined);
    return { credentialId: row.id, nodeId: row.nodeId, nodeCode: row.nodeCode, factoryCode: row.factoryCode ?? null };
  } catch {
    return null;
  }
}

export class EdgeCredentialError extends Error {
  constructor(
    public readonly code: "notAdmin" | "notVerified" | "otpRequired" | "reasonRequired" | "nodeNotFound" | "activeExists" | "noActive" | "dbUnavailable" | "invalidInput" | "nodeRetired" | "retireBlocked" | "nodeBusy" | "migrationMissing",
    message: string,
    /** doc 81 Đợt 12 O — retireBlocked: the DB guard's list of blockers (ids), for a caller that shows it apart from the message */
    public readonly blockers?: string,
  ) {
    super(message);
    this.name = "EdgeCredentialError";
  }
}

/** A login presented to the operator CLI (never from argv: the password / code come from the TTY or the environment). */
export interface AdminLogin {
  username: string | null | undefined;
  password: string | null | undefined;
  /** the account's current TOTP code — required when its 2FA is on */
  otp?: string | null;
}

/**
 * doc 81 Đợt 9 final wave F7 (final review M7) — PROVE the admin behind a credential change (no self-asserted actor):
 *   • username + password through `verifyCredentials` — the SAME check `POST /api/auth/login` runs (bcrypt over user_secrets,
 *     the shared lockout counter, an audit row for every attempt; a disabled / locked / password-less account is refused);
 *   • 2FA on ⇒ the account's current TOTP code, consumed once (`verifyTotpOnce`, the one TOTP verifier); missing ⇒ "otpRequired",
 *     wrong / replayed ⇒ "notVerified"; the 2FA state unreadable ⇒ refused (fail-closed);
 *   • then an ACTIVE ADMIN (role re-checked by id in checkActorAndNode as well).
 * Every refusal is an EdgeCredentialError; there is no path that returns an id without a proof. Never logs the password / code.
 */
export async function verifyCredentialAdmin(login: AdminLogin): Promise<{ userId: number; name: string }> {
  const username = typeof login.username === "string" ? login.username.trim() : "";
  const password = typeof login.password === "string" ? login.password : "";
  if (!username || !password) throw new EdgeCredentialError("notVerified", "An admin username and password are required (the password from the prompt or EDGE_CRED_ADMIN_PASSWORD — never on the command line).");
  const [{ verifyCredentials, LoginError }, { get2FAStatus }] = await Promise.all([import("../../_core/authService"), import("../../db/auth")]);
  const req = { ip: "cli:edge-node-credential", socket: { remoteAddress: "cli:edge-node-credential" }, headers: { "user-agent": "edge-node-credential CLI" } };
  let user: { id: number; role: unknown; isActive?: boolean | null; name?: string | null };
  try {
    user = (await verifyCredentials(username, password, req as never)) as typeof user;
  } catch (err) {
    if (err instanceof LoginError) throw new EdgeCredentialError("notVerified", `Admin login refused (${err.code}).`);
    throw new EdgeCredentialError("dbUnavailable", "The admin login could not be checked (database).");
  }
  let twoFa: Awaited<ReturnType<typeof get2FAStatus>>;
  try {
    twoFa = await get2FAStatus(user.id);
  } catch {
    twoFa = null;
  }
  if (!twoFa) throw new EdgeCredentialError("dbUnavailable", "The admin's 2FA state could not be read — refused.");
  if (twoFa.twoFactorEnabled) {
    const otp = typeof login.otp === "string" ? login.otp.trim() : "";
    if (!otp) throw new EdgeCredentialError("otpRequired", "This admin has 2FA on: the current authenticator code is required (prompt or EDGE_CRED_ADMIN_OTP).");
    if (!twoFa.twoFactorSecret) throw new EdgeCredentialError("notVerified", "2FA is on but has no secret — refused.");
    const { verifyTotpOnce } = await import("../../_core/totpOnce");
    const r = await verifyTotpOnce({ userId: user.id, secret: twoFa.twoFactorSecret, token: otp });
    // SCADA R1a Task 16 — the per-user failed-TOTP counter (inside verifyTotpOnce, shared with the web): locked ⇒ refused with the
    // minutes left (never the attempts left), the code was not checked so it is not counted again here; counter unreadable ⇒ refused.
    if (r.ma === "TOTP_TAM_KHOA") {
      // fix round 1 (minor 6) — a CLI attempt refused by the lock is still a failed CLI 2FA attempt: audit it + count it into the
      // account lockout BEFORE throwing, like a wrong code (the web lock alone would let a CLI loop retry forever without trace).
      await recordCliTotpFailure(user as { id: number; name?: string | null; loginAttempts?: number | null }, "totp_locked");
      const { phutConLai } = await import("../../_core/totpKhoaSai");
      throw new EdgeCredentialError("notVerified", `2FA is temporarily locked after too many wrong codes — try again in ${phutConLai(r.conLaiMs)} minute(s).`);
    }
    if (r.ma === "TOTP_KHONG_KIEM_DUOC") throw new EdgeCredentialError("dbUnavailable", "The 2FA code could not be checked (database) — refused.");
    if (!r.hopLe) {
      await recordCliTotpFailure(user as { id: number; name?: string | null; loginAttempts?: number | null }, r.phatLai ? "replayed_code" : "wrong_code");
      throw new EdgeCredentialError("notVerified", r.phatLai ? "That 2FA code was already used — wait for the next one." : "Wrong 2FA code.");
    }
  }
  if (user.isActive === false || String(user.role) !== "admin") {
    throw new EdgeCredentialError("notAdmin", "Only an active admin user may issue, rotate or revoke an edge node credential.");
  }
  return { userId: user.id, name: user.name ?? `user ${user.id}` };
}

/**
 * doc 81 Đợt 10 F2 round 2 — Đợt 9 final-wave N8: a WRONG / REPLAYED TOTP at the operator CLI is (1) audited `login_2fa` failure,
 * like the web 2FA step, and (2) COUNTED INTO THE ACCOUNT LOCKOUT. verifyCredentials resets the counter on a correct password, so
 * without this every invocation was a fresh, unbounded TOTP guess for someone holding the password. The count continues from the
 * value read BEFORE that reset (the returned user row): attempts = previous + 1; at MAX_LOGIN_ATTEMPTS the account is locked for
 * LOCKOUT_MINUTES — the same constants as the password check. Best effort (a failed write never turns the refusal into a pass).
 */
async function recordCliTotpFailure(user: { id: number; name?: string | null; loginAttempts?: number | null }, reason: "wrong_code" | "replayed_code" | "totp_locked"): Promise<void> {
  const [{ MAX_LOGIN_ATTEMPTS, LOCKOUT_MINUTES }, { updateUserLoginAttempts }, { createAuditLog }] = await Promise.all([
    import("../../_core/authService"),
    import("../../db/auth"),
    import("../../db/system"),
  ]);
  const attempts = Math.max(0, Number(user.loginAttempts ?? 0)) + 1;
  const lockedUntil = attempts >= MAX_LOGIN_ATTEMPTS ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000) : null;
  try {
    await updateUserLoginAttempts(user.id, attempts, lockedUntil);
  } catch (err) {
    console.error(`[EdgeCredential] could not count a failed CLI 2FA attempt for user ${user.id}: ${(err as Error)?.message ?? err}`);
  }
  try {
    await createAuditLog({
      userId: user.id,
      userName: user.name ?? null,
      action: "login_2fa",
      entityType: "auth",
      status: "failure",
      ipAddress: "cli:edge-operator",
      userAgent: "edge operator CLI",
      details: { reason, channel: "cli", attempt: attempts, locked: lockedUntil !== null },
    });
  } catch (err) {
    console.error(`[EdgeCredential] could not audit a failed CLI 2FA attempt for user ${user.id}: ${(err as Error)?.message ?? err}`);
  }
}

/**
 * doc 81 Đợt 10 F2 round 2 — decision D14: an edge node is REGISTERED by a proven admin only (no self-registration; the v2 gateway
 * never registers itself). Creates the edge_nodes row with its factory and lines, validated against the hierarchy: the factory
 * code must exist; every line code must be a production line OF THAT FACTORY. An existing node with the SAME factory and lines
 * ⇒ "unchanged" (idempotent); with a different one ⇒ refused (a factory / line change of a node that may own devices is not made
 * here — release its devices first, then change it deliberately). Audited (EDGE_NODE_REGISTER, success / failure).
 */
export async function registerEdgeNode(input: { nodeCode: string; factoryCode: string; lineCodes: string[]; name?: string | null; actorUserId: number; reason: string; protocolVersion?: number }): Promise<{ nodeId: number; created: boolean; upgraded?: boolean }> {
  const reason = String(input.reason ?? "").trim();
  if (reason.length < 3) throw new EdgeCredentialError("reasonRequired", "A reason (at least 3 characters) is required.");
  const code = String(input.nodeCode ?? "").trim();
  const factoryCode = String(input.factoryCode ?? "").trim();
  const lines = [...new Set((input.lineCodes ?? []).map((l) => String(l).trim()).filter(Boolean))].sort();
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(code)) throw new EdgeCredentialError("invalidInput", "The node code must be 1–128 characters of letters, digits, '.', '_' or '-'.");
  if (!factoryCode) throw new EdgeCredentialError("invalidInput", "A factory code is required (a node without a factory is given no device and no run).");
  // doc 81 Đợt 11 R-11-p — a node is created on protocol v2; v1 cannot execute since Đợt 10 (R-10-l); an EXPLICIT protocolVersion 2 upgrades an existing v1 node
  if (input.protocolVersion !== undefined && input.protocolVersion !== 2) throw new EdgeCredentialError("invalidInput", "Protocol 1 is refused: v1 nodes cannot execute since Đợt 10 (R-10-l) — nodes are registered on protocol 2.");
  const d = await db();
  const [actor] = await d.select({ id: users.id, role: users.role, isActive: users.isActive, name: users.name }).from(users).where(eq(users.id, Number(input.actorUserId))).limit(1);
  if (!actor || actor.isActive === false || String(actor.role) !== "admin") throw new EdgeCredentialError("notAdmin", "Only an active admin user may register an edge node.");
  const actorName = actor.name ?? `user ${actor.id}`;
  const auditRow = async (status: "success" | "failure", details: Record<string, unknown>) => {
    const { createAuditLog } = await import("../../db/system");
    await createAuditLog({ userId: actor.id, userName: actorName, action: "EDGE_NODE_REGISTER", entityType: "edge_node", entityName: code, status, details: { factoryCode, lineCodes: lines, reason, ...details } });
  };
  const { sql: q } = await import("drizzle-orm");
  const rowsOf = (r: unknown) => (Array.isArray(r) ? r : ((r as { rows?: unknown[] })?.rows ?? [])) as Array<Record<string, unknown>>;
  const fac = rowsOf(await d.execute(q`SELECT id FROM public.factories WHERE code = ${factoryCode}`));
  if (fac.length !== 1) {
    await auditRow("failure", { outcome: "unknownFactory" });
    throw new EdgeCredentialError("invalidInput", `Factory "${factoryCode}" does not exist.`);
  }
  if (lines.length > 0) {
    const found = rowsOf(
      await d.execute(q`SELECT l.code FROM public.production_lines l JOIN public.workshops w ON w.id = l."workshopId"
                         WHERE w."factoryId" = ${Number(fac[0].id)} AND l.code IN (${q.join(lines.map((l) => q`${l}`), q`, `)})`),
    ).map((r) => String(r.code));
    const missing = lines.filter((l) => !found.includes(l));
    if (missing.length) {
      await auditRow("failure", { outcome: "linesNotInFactory", missing });
      throw new EdgeCredentialError("invalidInput", `Line(s) ${missing.join(", ")} are not production lines of factory "${factoryCode}".`);
    }
  }
  const [existing] = await d.select({ id: edgeNodes.id, factoryCode: edgeNodes.factoryCode, lines: edgeNodes.assignedLineCodes }).from(edgeNodes).where(eq(edgeNodes.code, code)).limit(1);
  if (existing) {
    // doc 81 Đợt 12 O — a RETIRED node's code is never registered again (its row stays as evidence; mig 0378 freezes it)
    const retired = await readNodeRetirement(d as unknown as RawExec, { id: existing.id });
    if (retired?.retiredAt) {
      await auditRow("failure", { outcome: "retired", nodeId: existing.id, retiredAt: retired.retiredAt });
      throw new EdgeCredentialError("nodeRetired", `Edge node "${code}" was retired on ${retired.retiredAt} — its code is never registered again (register a new code).`);
    }
    const same = (existing.factoryCode ?? "") === factoryCode && JSON.stringify([...(existing.lines ?? [])].sort()) === JSON.stringify(lines);
    if (!same) {
      await auditRow("failure", { outcome: "registeredDifferently", nodeId: existing.id });
      throw new EdgeCredentialError("activeExists", `Edge node "${code}" is already registered (factory ${existing.factoryCode ?? "none"}, lines ${(existing.lines ?? []).join(",") || "none"}) — not changed here.`);
    }
    if (input.protocolVersion === 2) {
      const upd = rowsOf(await d.execute(q`UPDATE public.edge_nodes SET "protocolVersion" = 2 WHERE id = ${existing.id} AND "protocolVersion" = 1 RETURNING id`));
      if (upd.length === 1) {
        await auditRow("success", { outcome: "upgradedToV2", nodeId: existing.id, from: 1, to: 2 });
        return { nodeId: existing.id, created: false, upgraded: true };
      }
    }
    return { nodeId: existing.id, created: false };
  }
  const [ins] = await d.insert(edgeNodes).values({ code, name: (input.name ?? "").trim() || code, factoryCode, assignedLineCodes: lines, status: "offline" }).returning({ id: edgeNodes.id });
  await d.execute(q`UPDATE public.edge_nodes SET "protocolVersion" = 2 WHERE id = ${ins.id}`);
  await auditRow("success", { outcome: "created", nodeId: ins.id, protocolVersion: 2 });
  return { nodeId: ins.id, created: true };
}

interface ChangeInput {
  nodeCode: string;
  actorUserId: number;
  reason: string;
}

async function db() {
  const d = await getDb();
  if (!d) throw new EdgeCredentialError("dbUnavailable", "Database unavailable.");
  return d;
}

async function checkActorAndNode(input: ChangeInput): Promise<{ nodeId: number; actorName: string }> {
  const reason = String(input.reason ?? "").trim();
  if (reason.length < 3) throw new EdgeCredentialError("reasonRequired", "A reason (at least 3 characters) is required.");
  const d = await db();
  const actorId = Number(input.actorUserId);
  const [actor] = Number.isInteger(actorId) && actorId > 0
    ? await d.select({ id: users.id, role: users.role, isActive: users.isActive, name: users.name }).from(users).where(eq(users.id, actorId)).limit(1)
    : [];
  if (!actor || actor.isActive === false || String(actor.role) !== "admin") {
    throw new EdgeCredentialError("notAdmin", "Only an active admin user may issue, rotate or revoke an edge node credential.");
  }
  const [node] = await d.select({ id: edgeNodes.id }).from(edgeNodes).where(eq(edgeNodes.code, String(input.nodeCode ?? "").trim())).limit(1);
  if (!node) throw new EdgeCredentialError("nodeNotFound", `Edge node "${input.nodeCode}" is not registered.`);
  // doc 81 Đợt 12 O — a retired node is given no credential again (the DB refuses it too: mig 0378)
  const retired = await readNodeRetirement(d as unknown as RawExec, { id: node.id });
  if (retired?.retiredAt) throw new EdgeCredentialError("nodeRetired", `Edge node "${input.nodeCode}" was retired on ${retired.retiredAt} — it is given no credential again.`);
  return { nodeId: node.id, actorName: actor.name ?? `user ${actor.id}` };
}

async function audit(action: string, input: ChangeInput, actorName: string, details: Record<string, unknown>): Promise<void> {
  const { createAuditLog } = await import("../../db/system");
  await createAuditLog({
    userId: input.actorUserId,
    userName: actorName,
    action,
    entityType: "edge_node",
    entityName: input.nodeCode,
    details: { ...details, reason: input.reason.trim() }, // never the token
  });
}

export interface IssuedCredential {
  credentialId: number;
  nodeId: number;
  keyPrefix: string;
  /** The plaintext — shown ONCE to the operator; never stored or logged. */
  token: string;
}

/** Issue the first credential of a node (refused while one is active: rotate instead). */
export async function issueNodeCredential(input: ChangeInput): Promise<IssuedCredential> {
  const { nodeId, actorName } = await checkActorAndNode(input);
  const d = await db();
  const minted = mintNodeToken();
  const row = await d.transaction(async (tx) => {
    const [active] = await tx
      .select({ id: edgeNodeCredentials.id })
      .from(edgeNodeCredentials)
      .where(and(eq(edgeNodeCredentials.edgeNodeId, nodeId), eq(edgeNodeCredentials.status, "active")))
      .limit(1);
    if (active) throw new EdgeCredentialError("activeExists", `Edge node "${input.nodeCode}" already has an active credential — rotate or revoke it.`);
    const [ins] = await tx
      .insert(edgeNodeCredentials)
      .values({ edgeNodeId: nodeId, keyPrefix: minted.keyPrefix, secretHash: minted.secretHash, status: "active", createdBy: input.actorUserId })
      .returning({ id: edgeNodeCredentials.id });
    return ins;
  });
  await audit("EDGE_NODE_CREDENTIAL_ISSUE", input, actorName, { nodeId, credentialId: row.id, keyPrefix: minted.keyPrefix });
  return { credentialId: row.id, nodeId, keyPrefix: minted.keyPrefix, token: minted.token };
}

/** Rotate: revoke the active credential and issue a new one, atomically (no overlap window). */
export async function rotateNodeCredential(input: ChangeInput): Promise<IssuedCredential & { revokedCredentialId: number }> {
  const { nodeId, actorName } = await checkActorAndNode(input);
  const d = await db();
  const minted = mintNodeToken();
  const out = await d.transaction(async (tx) => {
    const [active] = await tx
      .select({ id: edgeNodeCredentials.id })
      .from(edgeNodeCredentials)
      .where(and(eq(edgeNodeCredentials.edgeNodeId, nodeId), eq(edgeNodeCredentials.status, "active")))
      .for("update")
      .limit(1);
    if (!active) throw new EdgeCredentialError("noActive", `Edge node "${input.nodeCode}" has no active credential to rotate — issue one.`);
    await tx
      .update(edgeNodeCredentials)
      .set({ status: "revoked", revokedAt: new Date(), revokedBy: input.actorUserId, revokeReason: `rotated: ${input.reason.trim()}` })
      .where(and(eq(edgeNodeCredentials.id, active.id), eq(edgeNodeCredentials.status, "active")));
    const [ins] = await tx
      .insert(edgeNodeCredentials)
      .values({ edgeNodeId: nodeId, keyPrefix: minted.keyPrefix, secretHash: minted.secretHash, status: "active", createdBy: input.actorUserId, rotatedFromId: active.id })
      .returning({ id: edgeNodeCredentials.id });
    return { newId: ins.id, oldId: active.id };
  });
  await audit("EDGE_NODE_CREDENTIAL_ROTATE", input, actorName, { nodeId, credentialId: out.newId, revokedCredentialId: out.oldId, keyPrefix: minted.keyPrefix });
  return { credentialId: out.newId, nodeId, keyPrefix: minted.keyPrefix, token: minted.token, revokedCredentialId: out.oldId };
}

/** Revoke the node's active credential (terminal). The node can no longer pull, claim or report. */
export async function revokeNodeCredential(input: ChangeInput): Promise<{ credentialId: number; nodeId: number }> {
  const { nodeId, actorName } = await checkActorAndNode(input);
  const d = await db();
  const revoked = await d
    .update(edgeNodeCredentials)
    .set({ status: "revoked", revokedAt: new Date(), revokedBy: input.actorUserId, revokeReason: input.reason.trim() })
    .where(and(eq(edgeNodeCredentials.edgeNodeId, nodeId), eq(edgeNodeCredentials.status, "active")))
    .returning({ id: edgeNodeCredentials.id });
  if (revoked.length === 0) throw new EdgeCredentialError("noActive", `Edge node "${input.nodeCode}" has no active credential.`);
  await audit("EDGE_NODE_CREDENTIAL_REVOKE", input, actorName, { nodeId, credentialId: revoked[0].id });
  return { credentialId: revoked[0].id, nodeId };
}

/** The credentials of a node, newest first — never the hash. */
export async function listNodeCredentials(nodeCode: string) {
  const d = await db();
  return d
    .select({
      id: edgeNodeCredentials.id,
      keyPrefix: edgeNodeCredentials.keyPrefix,
      status: edgeNodeCredentials.status,
      createdBy: edgeNodeCredentials.createdBy,
      createdAt: edgeNodeCredentials.createdAt,
      rotatedFromId: edgeNodeCredentials.rotatedFromId,
      revokedAt: edgeNodeCredentials.revokedAt,
      revokedBy: edgeNodeCredentials.revokedBy,
      revokeReason: edgeNodeCredentials.revokeReason,
      lastUsedAt: edgeNodeCredentials.lastUsedAt,
    })
    .from(edgeNodeCredentials)
    .innerJoin(edgeNodes, eq(edgeNodes.id, edgeNodeCredentials.edgeNodeId))
    .where(eq(edgeNodes.code, nodeCode))
    .orderBy(desc(edgeNodeCredentials.id));
}

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// doc 81 Đợt 12 task O — RETIRE a node (mig 0378). Never a delete: WORM evidence references the row (FK ON DELETE RESTRICT).
// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

type RawExec = { execute: (q: import("drizzle-orm").SQL) => Promise<unknown> };
const rowsOfRaw = (r: unknown) => (Array.isArray(r) ? r : ((r as { rows?: unknown[] })?.rows ?? [])) as Array<Record<string, unknown>>;
const isoOf = (v: unknown): string | null => (v == null ? null : v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString());

export interface NodeRetirement {
  nodeId: number;
  code: string;
  /** ISO time of the retirement; null = not retired (or mig 0378 not applied: the columns are read through to_jsonb) */
  retiredAt: string | null;
  retiredBy: number | null;
  retireReason: string | null;
}

/**
 * The retirement state of ONE node (by id or code); null = no such node. Read through to_jsonb(row) so it answers "not retired"
 * on a DB without mig 0378 instead of failing (the edge_nodes drizzle object never carries these columns — 0368 lesson).
 */
export async function readNodeRetirement(d: RawExec, where: { id?: number; code?: string }): Promise<NodeRetirement | null> {
  const { sql: q } = await import("drizzle-orm");
  const cond = where.id !== undefined ? q`n.id = ${Number(where.id)}` : q`n.code = ${String(where.code ?? "").trim()}`;
  const [r] = rowsOfRaw(
    await d.execute(q`SELECT n.id, n.code, to_jsonb(n) ->> 'retiredAt' AS "retiredAt", to_jsonb(n) ->> 'retiredBy' AS "retiredBy", to_jsonb(n) ->> 'retireReason' AS "retireReason"
                        FROM public.edge_nodes n WHERE ${cond} LIMIT 1`),
  );
  if (!r) return null;
  return {
    nodeId: Number(r.id),
    code: String(r.code),
    retiredAt: r.retiredAt ? isoOf(r.retiredAt) : null,
    retiredBy: r.retiredBy != null ? Number(r.retiredBy) : null,
    retireReason: r.retireReason != null ? String(r.retireReason) : null,
  };
}

/** The retirement of a node by code (operator CLI `list`); null = unknown node. */
export async function nodeRetirementByCode(nodeCode: string): Promise<NodeRetirement | null> {
  return readNodeRetirement((await db()) as unknown as RawExec, { code: nodeCode });
}

let retirePauseForTests: (() => Promise<void>) | null = null;
/** TEST ONLY — called inside the retirement transaction right after the node row is locked (L-7 / race tests). */
export function _setRetirePauseForTests(fn: (() => Promise<void>) | null): void {
  retirePauseForTests = fn;
}

/** fix 1 (review O-R3) — how long a retirement waits for a row lock (node / credential) before it answers nodeBusy. */
export const RETIRE_LOCK_TIMEOUT_MS = 5000;
let retireLockTimeoutMs: number | null = null;
/** TEST ONLY — a shorter lock_timeout for the retirement transaction (null = RETIRE_LOCK_TIMEOUT_MS). */
export function _setRetireLockTimeoutMsForTests(ms: number | null): void {
  retireLockTimeoutMs = ms;
}

export interface RetiredNode {
  nodeId: number;
  revokedCredentialIds: number[];
  retiredAt: string;
}

/**
 * RETIRE an edge node, as an ACTIVE ADMIN with a reason (the CLI proves the admin — verifyCredentialAdmin; the tRPC procedure is
 * admin-only and passes the session user). ONE transaction, under `SET LOCAL lock_timeout` (RETIRE_LOCK_TIMEOUT_MS — it never
 * hangs behind a device assignment or a rotation in flight: 55P03 ⇒ nodeBusy, nothing changed):
 *   1. lock the node's ACTIVE credential rows, then the node row — both FOR NO KEY UPDATE (fix 1, O-R3): the same order as
 *      rotate (credential, then node), so the two never deadlock; NO KEY so the FK KEY SHARE of a claim / step authorisation on
 *      the credential, and of a STOP request on the node (L-7), is never delayed;
 *   2. revoke EVERY active credential (reason "retired: <reason>");
 *   3. set retiredBy / retireReason (the DB stamps retiredAt itself; status offline). The DB guard (mig 0378,
 *      edge_node_retire_guard) REFUSES that while the node owns a robot / adapter, has an unacknowledged STOP or lock / clear
 *      request, or a non-terminal run — its message NAMES every blocker; the whole transaction (the revocations too) is then
 *      rolled back: nothing changes.
 * The row is never deleted. Audited EDGE_NODE_RETIRE — success and EVERY refusal (fix 1, O-R6: notAdmin and dbUnavailable too).
 * Refusals: EdgeCredentialError notAdmin · reasonRequired · nodeNotFound · nodeRetired (already) · retireBlocked (the DB's own
 * refusal text) · nodeBusy · dbUnavailable · migrationMissing (R-12-e M-7: mig 0378 not applied).
 */
export async function retireEdgeNode(input: ChangeInput): Promise<RetiredNode> {
  const reason = String(input.reason ?? "").trim();
  if (reason.length < 3) throw new EdgeCredentialError("reasonRequired", "A reason (at least 3 characters) is required.");
  const code = String(input.nodeCode ?? "").trim();
  const d = await db();
  const actorId = Number(input.actorUserId);
  const [actor] = Number.isInteger(actorId) && actorId > 0
    ? await d.select({ id: users.id, role: users.role, isActive: users.isActive, name: users.name }).from(users).where(eq(users.id, actorId)).limit(1)
    : [];
  // the audit row names whoever asked — the refused actor too (fix 1, O-R6)
  const auditRetire = async (status: "success" | "failure", details: Record<string, unknown>) => {
    try {
      const { createAuditLog } = await import("../../db/system");
      await createAuditLog({
        userId: actor?.id ?? null,
        userName: actor ? (actor.name ?? `user ${actor.id}`) : null,
        action: "EDGE_NODE_RETIRE",
        entityType: "edge_node",
        entityName: code,
        status,
        details: { ...details, reason },
      });
    } catch (err) {
      console.error(`[EdgeCredential] could not audit the retirement of node "${code}" (${status}): ${(err as Error)?.message ?? err}`);
    }
  };
  if (!actor || actor.isActive === false || String(actor.role) !== "admin") {
    const err = new EdgeCredentialError("notAdmin", "Only an active admin user may retire an edge node.");
    await auditRetire("failure", { outcome: err.code, refusal: err.message, actorUserId: Number.isFinite(actorId) ? actorId : null });
    throw err;
  }
  const { sql: q } = await import("drizzle-orm");
  const { isEdgeControlRefusal } = await import("./edgeControlSchema");
  const lockMs = Math.max(50, Math.floor(retireLockTimeoutMs ?? RETIRE_LOCK_TIMEOUT_MS));
  let out: RetiredNode;
  try {
    out = await d.transaction(async (tx) => {
      await tx.execute(q`SELECT set_config('lock_timeout', ${`${lockMs}ms`}, true)`);
      const [node] = rowsOfRaw(await tx.execute(q`SELECT id FROM public.edge_nodes WHERE code = ${code}`));
      if (!node) throw new EdgeCredentialError("nodeNotFound", `Edge node "${code}" is not registered.`);
      const nodeId = Number(node.id);
      await tx.execute(q`SELECT id FROM public.edge_node_credentials WHERE "edgeNodeId" = ${nodeId} AND status = 'active' ORDER BY id FOR NO KEY UPDATE`);
      const [locked] = rowsOfRaw(await tx.execute(q`SELECT to_jsonb(n) ->> 'retiredAt' AS "retiredAt" FROM public.edge_nodes n WHERE n.id = ${nodeId} FOR NO KEY UPDATE`));
      if (locked?.retiredAt) throw new EdgeCredentialError("nodeRetired", `Edge node "${code}" is already retired (since ${isoOf(locked.retiredAt)}).`);
      if (retirePauseForTests) await retirePauseForTests();
      const revoked = rowsOfRaw(
        await tx.execute(q`UPDATE public.edge_node_credentials SET status = 'revoked', "revokedAt" = now(), "revokedBy" = ${actor.id}, "revokeReason" = ${`retired: ${reason}`}
                           WHERE "edgeNodeId" = ${nodeId} AND status = 'active' RETURNING id`),
      ).map((r) => Number(r.id));
      const [row] = rowsOfRaw(
        await tx.execute(q`UPDATE public.edge_nodes SET "retiredAt" = now(), "retiredBy" = ${actor.id}, "retireReason" = ${reason}, status = 'offline', "updatedAt" = now()
                           WHERE id = ${nodeId} RETURNING "retiredAt"`),
      );
      return { nodeId, revokedCredentialIds: revoked.sort((a, b) => a - b), retiredAt: isoOf(row.retiredAt)! };
    });
  } catch (err) {
    if (err instanceof EdgeCredentialError) {
      await auditRetire("failure", { outcome: err.code, refusal: err.message });
      throw err;
    }
    const cause = (err as { cause?: unknown })?.cause ?? err;
    const sqlCode = (cause as { code?: unknown })?.code ?? (err as { code?: unknown })?.code;
    if (isEdgeControlRefusal(err)) {
      // the DB guard (mig 0378) names every blocker; nothing was changed (the revocations were rolled back with it)
      const named = String((cause as Error)?.message ?? cause).replace(/^edge_nodes: /, "");
      await auditRetire("failure", { outcome: "retireBlocked", refusal: named });
      throw new EdgeCredentialError(
        "retireBlocked",
        `${named} — release its devices (edge-device-owner.ts release), let central execute / acknowledge its STOPs (or resolve them, docs/EDGE_GATEWAY.md §8.9), let its lock / clear requests be acknowledged or expire, finish or abort its runs, then retry. Nothing was changed.`,
        named.replace(/^.*cannot be retired: /, ""),
      );
    }
    if (sqlCode === "55P03") {
      const busy = new EdgeCredentialError("nodeBusy", `Edge node "${code}" is being changed by another operation (a device assignment, a credential rotation …) — its row was not free within ${lockMs} ms. Nothing was changed; retry.`);
      await auditRetire("failure", { outcome: busy.code, refusal: busy.message });
      throw busy;
    }
    if (sqlCode === "42703") {
      // doc 81 Đợt 12 final fix wave (R-12-e M-7) — its OWN code: the database is up, a migration is missing (never "dbUnavailable")
      const missing = new EdgeCredentialError("migrationMissing", "Edge node retirement needs migration 0378 (edge_nodes.retiredAt) — not applied on this database. Nothing was changed.");
      await auditRetire("failure", { outcome: missing.code, refusal: missing.message });
      throw missing;
    }
    throw err;
  }
  await auditRetire("success", { outcome: "retired", nodeId: out.nodeId, revokedCredentialIds: out.revokedCredentialIds });
  return out;
}
