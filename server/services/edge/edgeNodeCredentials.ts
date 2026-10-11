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
    public readonly code: "notAdmin" | "notVerified" | "otpRequired" | "reasonRequired" | "nodeNotFound" | "activeExists" | "noActive" | "dbUnavailable",
    message: string,
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
    if (!r.hopLe) throw new EdgeCredentialError("notVerified", r.phatLai ? "That 2FA code was already used — wait for the next one." : "Wrong 2FA code.");
  }
  if (user.isActive === false || String(user.role) !== "admin") {
    throw new EdgeCredentialError("notAdmin", "Only an active admin user may issue, rotate or revoke an edge node credential.");
  }
  return { userId: user.id, name: user.name ?? `user ${user.id}` };
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
