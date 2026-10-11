/**
 * doc 81 Đợt 4 fix round 1 (ruling R-4-f) — WHO owns an orchestration run started through API v1.
 *
 * A run started by a non-user principal used to have `startedBy = NULL`, and the four-eyes rule ("approved by someone
 * other than the run owner") then accepted ANY approver — including the person holding the key (review I1).
 * doc 81 Đợt 9 task R1 (owner decision 2026-10-12, option A) — the owner is now the human the key is ISSUED TO
 * (`api_keys."holderUserId"`, mig 0369; defaults to the creator, changed only by an admin, every change recorded), when that
 * user exists and is active. Anything else (master key, OAuth/machine principal, key without holder, inactive holder,
 * 0369 not applied, DB error) ⇒ null ⇒ the run is owner-less and its OT/robot steps are refused
 * (FOE_GATE_REQUIRED(ownerUnknown)). The key's creator and every earlier holder are excluded from approving that run by
 * foeGateApproval.deriveRunApprovalIdentity (read from the DB, not from here). Never throws.
 */
import { sql } from "drizzle-orm";
import type { ApiPrincipal } from "./auth";

export async function apiKeyOwnerUserId(principal: Pick<ApiPrincipal, "kind" | "apiKeyId"> | null | undefined): Promise<number | null> {
  try {
    const keyId = apiKeyIdOf(principal);
    if (keyId === null) return null;
    const { getDb } = await import("../../db/connection");
    const d = await getDb();
    if (!d) return null;
    const r = (await d.execute(sql`
      SELECT u.id FROM api_keys k JOIN users u ON u.id = k."holderUserId"
       WHERE k.id = ${keyId} AND u."isActive" = true`)) as unknown;
    const rows = (Array.isArray(r) ? r : ((r as { rows?: unknown[] })?.rows ?? [])) as Array<{ id: number | string }>;
    const id = rows[0] ? Number(rows[0].id) : NaN;
    return Number.isInteger(id) && id > 0 ? id : null;
  } catch {
    return null;
  }
}

/** doc 81 Đợt 9 R1 — the API key id of an AUTHENTICATED api-key principal (never from a body); anything else ⇒ null. */
export function apiKeyIdOf(principal: Pick<ApiPrincipal, "kind" | "apiKeyId"> | null | undefined): number | null {
  if (!principal || principal.kind !== "api-key") return null;
  const keyId = principal.apiKeyId;
  return typeof keyId === "number" && Number.isInteger(keyId) && keyId > 0 ? keyId : null;
}
