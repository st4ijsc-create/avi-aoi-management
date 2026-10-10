/**
 * doc 81 Đợt 4 fix round 1 (ruling R-4-f) — WHO owns an orchestration run started through API v1.
 *
 * A run started by a non-user principal used to have `startedBy = NULL`, and the four-eyes rule ("approved by someone
 * other than the run owner") then accepted ANY approver — including the person holding the key (review I1). The owner
 * is now the human who created the API key (`api_keys.createdBy`, set by apiKeyRouter at mint time), when that user
 * exists and is active. Anything else (master key, OAuth/machine principal, key without creator, DB error) ⇒ null ⇒
 * the run is owner-less and its OT/robot steps are refused (FOE_GATE_REQUIRED(ownerUnknown)). Never throws.
 */
import { sql } from "drizzle-orm";
import type { ApiPrincipal } from "./auth";

export async function apiKeyOwnerUserId(principal: Pick<ApiPrincipal, "kind" | "apiKeyId"> | null | undefined): Promise<number | null> {
  try {
    if (!principal || principal.kind !== "api-key") return null;
    const keyId = principal.apiKeyId;
    if (typeof keyId !== "number" || !Number.isInteger(keyId) || keyId <= 0) return null;
    const { getDb } = await import("../../db/connection");
    const d = await getDb();
    if (!d) return null;
    const r = (await d.execute(sql`
      SELECT u.id FROM api_keys k JOIN users u ON u.id = k."createdBy"
       WHERE k.id = ${keyId} AND u."isActive" = true`)) as unknown;
    const rows = (Array.isArray(r) ? r : ((r as { rows?: unknown[] })?.rows ?? [])) as Array<{ id: number | string }>;
    const id = rows[0] ? Number(rows[0].id) : NaN;
    return Number.isInteger(id) && id > 0 ? id : null;
  } catch {
    return null;
  }
}
