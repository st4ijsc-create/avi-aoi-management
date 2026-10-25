/**
 * Factory Control Plane — SCOPED API-KEY management router (key "apiKey").
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Admin CRUD over the `api_keys` table that backs the Unified Machine API
 * (/api/v1). Lets an admin MINT a least-privilege key, edit its scopes/expiry,
 * enable/disable (revoke) and delete it.
 *
 * SECURITY (non-negotiable):
 *   • The plaintext key is generated server-side, shown ONCE in the `create`
 *     response, and NEVER stored or returned again. We persist only the SHA-256
 *     hash (REUSING server/api/v1/auth.ts hashApiKey — the SAME algorithm the auth
 *     middleware verifies against) + a short non-secret prefix for display.
 *   • `list` / `update` NEVER return keyHash or any plaintext.
 *
 * RBAC (module-level): admin_system / admin_users. Reads → canView; writes →
 * canCreate (create) / canEdit (update, revoke) / canDelete (delete). Fail-safe:
 * a missing DB throws a clean INTERNAL_SERVER_ERROR, never a silent grant.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { phamViKhoaMoiGhi, khoaApiGhi } from "./_cauHinhPhamVi";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { appError } from "../_core/appError";
import { router, protectedProcedure, adminProcedure } from "../_core/trpc";
import { requirePermission } from "../_core/accessControl";
import { getDb } from "../db";
import { apiKeys, users } from "../../drizzle/schema";
import { createAuditContext, logCrudOperationInTx } from "../services/auditTrailService";
import { apiKeyIdentityCols, isMigrationMissingError, readHoldersOfKeys } from "../services/orchestration/foe/runApiKeyIdentity"; // doc 81 Đợt 9 R1 (mig 0369)
import { hashApiKey } from "../api/v1/auth";
import { ALL_SCOPES, SCOPE_DESCRIPTIONS } from "../api/v1/scopes";

async function db() {
  const d = await getDb();
  if (!d) throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not connected");
  return d;
}

/** Validate a scope grant: each must be a known scope, a "<ns>:*" wildcard, or "*". */
const NAMESPACES = new Set(ALL_SCOPES.map((s) => s.split(":")[0]));
function isValidScopeGrant(s: string): boolean {
  if (s === "*") return true;
  if ((ALL_SCOPES as string[]).includes(s)) return true;
  if (s.endsWith(":*")) return NAMESPACES.has(s.slice(0, -2));
  return false;
}
const scopeSchema = z
  .array(z.string().min(1).max(64))
  .min(1, "At least one scope is required")
  .refine((arr) => arr.every(isValidScopeGrant), {
    message: "One or more scopes are not in the published scope vocabulary",
  });

/** Generate a strong random key + its display prefix. Format: `ak_<48 hex chars>`. */
function generateKey(): { plaintext: string; prefix: string } {
  const secret = randomBytes(24).toString("hex"); // 48 hex chars
  const plaintext = `ak_${secret}`;
  const prefix = `ak_${secret.slice(0, 6)}`; // non-secret, for display/identification
  return { plaintext, prefix };
}

/**
 * ★★ PHẠM VI TENANT (mig 0325) — BA trạng thái, khai TƯỜNG MINH.
 *
 * `scopes` ở trên nói *"khoá LÀM ĐƯỢC GÌ"*; ba ô dưới đây nói *"khoá THẤY ĐƯỢC GÌ"*.
 *   `null`      → CHƯA KHAI ⇒ `bi:read`/`export:read` bị 403 (mặc định của mọi khoá cũ)
 *   'factory'   → phải kèm ≥1 mã ⇒ chỉ nhà máy ấy
 *   'global'    → toàn cục, và hai mã phải để TRỐNG
 * Cùng ràng buộc với CHECK `api_keys_data_scope_mode_chk` ở CSDL — cố ý trùng: zod cho câu lỗi
 * đọc được, CHECK bịt mọi đường ghi khác (psql, script, một router tương lai quên kiểm).
 */
const tenantScopeSchema = z
  .object({
    dataScopeMode: z.enum(["factory", "global"]).nullish(),
    corporateCode: z.string().max(50).nullish(),
    factoryCode: z.string().max(50).nullish(),
  })
  .refine(
    (v) => {
      const corp = v.corporateCode?.trim() || null;
      const fac = v.factoryCode?.trim() || null;
      if (v.dataScopeMode === "factory") return corp !== null || fac !== null;
      // Cả 'global' lẫn CHƯA KHAI đều không được mang mã lơ lửng.
      return corp === null && fac === null;
    },
    {
      message:
        "Phạm vi 'factory' phải kèm mã tập đoàn hoặc mã nhà máy; phạm vi 'global' và phạm vi " +
        "chưa khai phải để trống cả hai mã.",
    },
  );

/** Chuẩn hoá ba ô về đúng hình dạng CSDL chấp nhận (chuỗi rỗng ⇒ NULL, không phải ""). */
function normalizeTenantScope(input: {
  dataScopeMode?: "factory" | "global" | null;
  corporateCode?: string | null;
  factoryCode?: string | null;
}) {
  const mode = input.dataScopeMode ?? null;
  if (mode !== "factory") return { dataScopeMode: mode, corporateCode: null, factoryCode: null };
  return {
    dataScopeMode: mode,
    corporateCode: input.corporateCode?.trim() || null,
    factoryCode: input.factoryCode?.trim() || null,
  };
}

/** Project a row to the SAFE shape (NEVER exposes keyHash). */
function publicRow(r: typeof apiKeys.$inferSelect) {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    keyPrefix: r.keyPrefix,
    scopes: Array.isArray(r.scopes) ? r.scopes : [],
    isActive: r.isActive,
    expiresAt: r.expiresAt,
    lastUsedAt: r.lastUsedAt,
    createdBy: r.createdBy,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    // mig 0325 — hiển thị để quản trị viên THẤY khoá nào chưa khai phạm vi.
    dataScopeMode: r.dataScopeMode,
    corporateCode: r.corporateCode,
    factoryCode: r.factoryCode,
  };
}

/**
 * doc 81 Đợt 9 task R1/R3 — "Issued to": the holder of each key with the user's name. The column is read through the narrow
 * projection (mig 0369 — not on the full-row `apiKeys` object, which the API v1 auth path reads); 0369 missing / DB error ⇒
 * every key `holderRecorded: false` (shown "not recorded"; orchestration runs of such keys are refused — fail-closed).
 */
async function withHolders<T extends { id: number }>(d: Awaited<ReturnType<typeof db>>, rows: T[]) {
  const holders = await readHoldersOfKeys(d, rows.map((r) => r.id));
  const ids = [...new Set([...holders.values()].filter((v): v is number => typeof v === "number"))];
  const names = ids.length
    ? await d.select({ id: users.id, name: users.name, isActive: users.isActive }).from(users).where(inArray(users.id, ids)).catch(() => null)
    : [];
  return rows.map((r) => {
    const holderUserId = holders.has(r.id) ? (holders.get(r.id) ?? null) : null;
    const u = holderUserId !== null && names ? names.find((n) => n.id === holderUserId) : undefined;
    return {
      ...r,
      holderRecorded: holders.has(r.id),
      holderUserId,
      holderName: u?.name ?? null,
      // R fix 1 (#5) — a deactivated / deleted holder makes the key's API runs owner-less (refused): flagged on the list.
      // null = not known (users not read); false = deactivated or no longer exists.
      holderActive: holderUserId === null ? null : names === null ? null : u ? u.isActive === true : false,
    };
  });
}

/** R fix 1 (#6) — the key row disappeared between the read and the locked update (deleted concurrently). */
class KeyVanished extends Error {}
/** R fix scan — the new holder does not exist / is not active (checked under a row lock in the transaction). */
class HolderInvalid extends Error {}

/**
 * doc 81 Đợt 9 R fix scan 2 (authorization TOCTOU) — the CALLER's admin status re-read INSIDE the caller's transaction, under
 * FOR SHARE on their users row: a demotion / deactivation that commits before this point is seen; one that tries to commit
 * after it waits for this transaction. The session role decided the route (adminProcedure / requirePermission); this re-check
 * decides the write. Anything but an existing, active role="admin" row ⇒ false (fail-closed).
 */
async function callerIsAdminNow(tx: { select: (...a: any[]) => any }, userId: number | undefined): Promise<boolean> {
  if (typeof userId !== "number" || !Number.isInteger(userId) || userId <= 0) return false;
  const [me] = await tx.select({ id: users.id, role: users.role, isActive: users.isActive }).from(users).where(eq(users.id, userId)).for("share");
  return !!me && me.role === "admin" && me.isActive === true;
}
const notAdminError = () =>
  appError(
    "FORBIDDEN",
    "PERMISSION_DENIED",
    { action: "adminAccess" },
    "Only an administrator can re-activate an API key, extend its expiry or change who it is issued to (it decides which runs may send machine / robot commands).",
  );

function toExpiry(v: string | Date | null | undefined): Date | null {
  if (v == null || v === "") return null;
  const d = v instanceof Date ? v : new Date(v);
  if (Number.isNaN(d.getTime())) {
    throw appError("BAD_REQUEST", "INVALID_VALUE", { field: "expiresAt" }, "Invalid expiresAt date");
  }
  return d;
}

export const apiKeyRouter = router({
  /** The published scope vocabulary (for the create dialog's multiselect). */
  scopes: protectedProcedure
    .use(requirePermission("admin_system", "canView"))
    .query(() =>
      ALL_SCOPES.map((s) => ({ scope: s, description: SCOPE_DESCRIPTIONS[s] })),
    ),

  /** List keys (newest first) — SAFE shape only (no hash, no plaintext). */
  list: protectedProcedure
    .use(requirePermission("admin_system", "canView"))
    .query(async () => {
      const d = await db();
      const rows = await d.select().from(apiKeys).orderBy(desc(apiKeys.createdAt));
      return withHolders(d, rows.map(publicRow)); // doc 81 Đợt 9 R3 — "Issued to"
    }),

  /**
   * Mint a new scoped key. Returns the PLAINTEXT key EXACTLY ONCE — it is not
   * stored and can never be retrieved again. Only the SHA-256 hash is persisted.
   */
  create: protectedProcedure
    .use(requirePermission("admin_system", "canCreate"))
    .input(
      z
        .object({
          name: z.string().min(1).max(255),
          description: z.string().max(2000).nullish(),
          scopes: scopeSchema,
          expiresAt: z.union([z.string(), z.date()]).nullish(),
        })
        .and(tenantScopeSchema),
    )
    .mutation(async ({ input, ctx }) => {
      await phamViKhoaMoiGhi(ctx, input, "apiKey"); // phạm vi khoá không rộng hơn người cấp (W14b)
      const d = await db();
      const { plaintext, prefix } = generateKey();
      const keyHash = hashApiKey(plaintext);
      const [row] = await d
        .insert(apiKeys)
        .values({
          name: input.name.trim(),
          description: input.description ?? null,
          keyHash,
          keyPrefix: prefix,
          scopes: input.scopes,
          isActive: true,
          expiresAt: toExpiry(input.expiresAt),
          createdBy: ctx.user?.id ?? null,
          // ⚠ KHÔNG mặc định 'global'. Khoá mới sinh ra CHƯA KHAI (`null`) trừ khi người tạo
          //   chọn tường minh — một mặc định "toàn cục cho tiện" ở đây sẽ vô hiệu hoá cả 0325.
          ...normalizeTenantScope(input),
        })
        .returning();
      // doc 81 Đợt 9 task R1 — the key is ISSUED TO its creator by default (api_keys.holderUserId, mig 0369; the history
      // trigger records it). Written through the narrow projection; a failure (0369 not applied) leaves the key WITHOUT a
      // holder ⇒ orchestration runs it starts are owner-less and refused (fail-closed) — said loudly, the key still works
      // for everything else.
      const creator = ctx.user?.id;
      if (typeof creator === "number" && creator > 0) {
        try {
          await d.transaction(async (tx) => {
            await tx.execute(sql`SELECT set_config('aoi.actor_user_id', ${String(creator)}, true), set_config('aoi.holder_change_reason', 'default = creator', true)`);
            await tx.update(apiKeyIdentityCols).set({ holderUserId: creator }).where(eq(apiKeyIdentityCols.id, row.id));
          });
        } catch (err) {
          console.error(`[apiKey] key ${row.id}: holder (issued to) not recorded — migration 0369 applied? ${(err as Error)?.message ?? err}`);
        }
      }
      const [withHolder] = await withHolders(d, [publicRow(row)]);
      // The plaintext is surfaced HERE ONLY — never persisted, never returned again.
      return { ...withHolder, plaintextKey: plaintext };
    }),

  /** Edit name/description/scopes/expiry/active flag. NEVER returns the hash. */
  update: protectedProcedure
    .use(requirePermission("admin_system", "canEdit"))
    .input(
      z
        .object({
          id: z.number().int().positive(),
          name: z.string().min(1).max(255).optional(),
          description: z.string().max(2000).nullish(),
          scopes: scopeSchema.optional(),
          expiresAt: z.union([z.string(), z.date()]).nullish(),
          isActive: z.boolean().optional(),
        })
        .and(tenantScopeSchema),
    )
    .mutation(async ({ input, ctx }) => {
      await khoaApiGhi(ctx, input.id); // khoá hiện có phải trong phạm vi người gọi (W14b)
      if (input.dataScopeMode !== undefined || input.corporateCode !== undefined || input.factoryCode !== undefined) {
        await phamViKhoaMoiGhi(ctx, input, "apiKey"); // phạm vi MỚI không rộng hơn người cấp
      }
      const d = await db();
      const newExp = input.expiresAt !== undefined ? toExpiry(input.expiresAt) : undefined;
      // doc 81 Đợt 9 R fix scan (ruling R-9-c: "an ADMIN re-activating the key restores it") — re-activating a disabled key or
      // EXTENDING its expiry gives its API-started orchestration runs their actuation back, so it is ADMIN-only (a holder of
      // admin_system canEdit alone gets FORBIDDEN). Disabling, shortening and every other edit are unchanged.
      // R fix scan 2 (TOCTOU) — decided on the key row LOCKED FOR UPDATE in the SAME transaction as the write (a concurrent
      // revoke / update / setHolder of this key waits, or is seen), the caller's admin status re-read in it too
      // (callerIsAdminNow), and the write is conditional on the locked state (isActive unchanged) — 0 rows ⇒ CONFLICT.
      return d.transaction(async (tx) => {
        const [existing] = await tx.select().from(apiKeys).where(eq(apiKeys.id, input.id)).for("update");
        if (!existing) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "apiKey" }, `API key ${input.id} not found`);
        const oldExp = existing.expiresAt ? new Date(existing.expiresAt) : null;
        const reactivates = input.isActive === true && existing.isActive !== true;
        const extends_ = newExp !== undefined && oldExp !== null && (newExp === null || newExp.getTime() > oldExp.getTime());
        if ((reactivates || extends_) && (ctx.user?.role !== "admin" || !(await callerIsAdminNow(tx, ctx.user?.id)))) throw notAdminError();

        const patch: Partial<typeof apiKeys.$inferInsert> = { updatedAt: new Date() };
        if (input.name !== undefined) patch.name = input.name.trim();
        if (input.description !== undefined) patch.description = input.description ?? null;
        if (input.scopes !== undefined) patch.scopes = input.scopes;
        if (input.isActive !== undefined) patch.isActive = input.isActive;
        if (newExp !== undefined) patch.expiresAt = newExp;
        // ⚠ Ba ô phạm vi luôn đi CÙNG NHAU. Vá lẻ một ô (chỉ `factoryCode`, giữ nguyên `mode`)
        //   sinh ra đúng hình dạng lệch mà CHECK cấm, và bắt người dùng nhận một lỗi CSDL thô
        //   thay vì một câu đọc được. Client gửi cả ba, hoặc không gửi ô nào.
        if (input.dataScopeMode !== undefined || input.corporateCode !== undefined || input.factoryCode !== undefined) {
          Object.assign(patch, normalizeTenantScope(input));
        }

        const [row] = await tx
          .update(apiKeys)
          .set(patch)
          .where(and(eq(apiKeys.id, input.id), eq(apiKeys.isActive, existing.isActive)))
          .returning();
        if (!row) {
          throw appError("CONFLICT", "OPERATION_FAILED", { operation: "updateApiKey" }, `API key ${input.id} changed while it was being updated — reload and retry.`);
        }
        return publicRow(row);
      });
    }),

  /**
   * doc 81 Đợt 9 task R1 — change who a key is ISSUED TO. ADMIN ONLY (adminProcedure — `admin_system` canEdit is not
   * enough). Every change is recorded twice, durably: the trigger writes api_key_holder_changes (from, to, acting admin,
   * reason) in the SAME transaction as the change (no history row ⇒ no change), and audit_logs gets an entry.
   * The new holder must be an existing, ACTIVE user. Changing the holder does NOT change the secret: every earlier holder
   * stays excluded from approving the runs this key starts — revoke and re-mint the key when it really changes hands.
   */
  setHolder: adminProcedure
    .input(
      z.object({
        id: z.number().int().positive(),
        holderUserId: z.number().int().positive(),
        reason: z.string().trim().min(3).max(500),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const d = await db();
      const actor = ctx.user?.id;
      if (typeof actor !== "number" || !Number.isInteger(actor) || actor <= 0) {
        // adminProcedure guarantees a user; anything else here is refused (fail-closed), never treated as allowed
        throw appError("FORBIDDEN", "PERMISSION_DENIED", { action: "adminAccess" }, "Only an administrator can change who an API key is issued to.");
      }
      let holderInvalid = false;
      let notAdmin = false;
      let keyName = "";
      // R fix 1 (#6) — the change, its trigger-written history row AND its audit_logs row are ONE transaction: an audit row
      // that cannot be written refuses the change. Errors are specific and carry no database text to the client (it is
      // logged server-side): the key vanished meanwhile ⇒ NOT_FOUND; migration 0369 missing ⇒ FEATURE_NOT_CONFIGURED
      // (apiKeyHolder); anything else ⇒ OPERATION_FAILED (changeApiKeyHolder) — nothing was changed in every case.
      let vanished = false;
      try {
        await d.transaction(async (tx) => {
          // R fix scan 2 — the key row is locked FOR UPDATE first (the SAME row lock `update` takes: the two never interleave),
          // then the caller's admin status is re-read under FOR SHARE, then the new holder (below).
          const [cur] = await tx
            .select({ id: apiKeyIdentityCols.id, name: apiKeyIdentityCols.name, holderUserId: apiKeyIdentityCols.holderUserId })
            .from(apiKeyIdentityCols)
            .where(eq(apiKeyIdentityCols.id, input.id))
            .for("update");
          if (!cur) {
            vanished = true;
            throw new KeyVanished();
          }
          keyName = String(cur.name ?? "");
          if (!(await callerIsAdminNow(tx, actor))) {
            notAdmin = true;
            throw new KeyVanished();
          }
          const before = (cur.holderUserId as number | null | undefined) ?? null;
          // R fix scan — the new holder is checked UNDER A ROW LOCK in the same transaction (FOR SHARE: a concurrent
          // deactivation waits or is seen): it must exist and be ACTIVE now. Otherwise nothing changes.
          const [holder] = await tx.select({ id: users.id, isActive: users.isActive }).from(users).where(eq(users.id, input.holderUserId)).for("share");
          if (!holder || holder.isActive !== true) {
            holderInvalid = true;
            throw new HolderInvalid();
          }
          await tx.execute(sql`SELECT set_config('aoi.actor_user_id', ${String(actor)}, true), set_config('aoi.holder_change_reason', ${input.reason}, true)`);
          const changed = await tx
            .update(apiKeyIdentityCols)
            .set({ holderUserId: input.holderUserId })
            .where(eq(apiKeyIdentityCols.id, input.id))
            .returning({ id: apiKeyIdentityCols.id });
          if (changed.length !== 1) {
            // belt and braces with the FOR UPDATE above: never record (audit) a change that did not happen
            vanished = true;
            throw new KeyVanished();
          }
          // R fix scan — the audit row is built by the SHARED builder (same fields + SEC_PLATFORM content hash as every CRUD
          // audit row) and written IN this transaction: it fails ⇒ the change fails; the change rolls back ⇒ no row.
          await logCrudOperationInTx(tx, createAuditContext({ user: ctx.user, req: ctx.req as never }), {
            action: "UPDATE",
            entityType: "api_key",
            entityId: input.id,
            entityName: keyName,
            details: {
              operation: "API_KEY_HOLDER_CHANGE",
              before: { holderUserId: before },
              after: { holderUserId: input.holderUserId },
              metadata: { reason: input.reason, docRef: "doc 81 Dot 9 R1" },
              affectedFields: ["holderUserId"],
            },
            status: "success",
          });
        });
      } catch (err) {
        if (notAdmin) throw notAdminError();
        if (holderInvalid || err instanceof HolderInvalid) {
          throw appError("BAD_REQUEST", "INVALID_VALUE", { field: "holderUserId" }, `User ${input.holderUserId} does not exist or is not active — nothing was changed.`);
        }
        if (vanished || err instanceof KeyVanished) {
          throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "apiKey" }, `API key ${input.id} not found`);
        }
        console.error(`[apiKey] setHolder key ${input.id}: not changed — ${(err as Error)?.message ?? err}`);
        if (isMigrationMissingError(err)) {
          throw appError(
            "PRECONDITION_FAILED",
            "FEATURE_NOT_CONFIGURED",
            { feature: "apiKeyHolder" },
            "Who an API key is issued to cannot be recorded: database migration 0369 is not applied (an administrator runs scripts/apply-migration-0369.mjs). Nothing was changed.",
          );
        }
        throw appError(
          "INTERNAL_SERVER_ERROR",
          "OPERATION_FAILED",
          { operation: "changeApiKeyHolder" },
          `Who API key ${input.id} is issued to could not be changed (database error) — nothing was changed. Retry.`,
        );
      }
      const [after] = await d.select().from(apiKeys).where(eq(apiKeys.id, input.id)).limit(1);
      if (!after) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "apiKey" }, `API key ${input.id} not found`);
      const [row] = await withHolders(d, [publicRow(after)]);
      return row;
    }),

  /** Revoke a key (isActive=false) — the auth middleware denies inactive keys. */
  revoke: protectedProcedure
    .use(requirePermission("admin_system", "canEdit"))
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      await khoaApiGhi(ctx, input.id);
      const d = await db();
      const [row] = await d
        .update(apiKeys)
        .set({ isActive: false, updatedAt: new Date() })
        .where(eq(apiKeys.id, input.id))
        .returning();
      if (!row) throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "apiKey" }, `API key ${input.id} not found`);
      return publicRow(row);
    }),

  /** Permanently delete a key row. */
  delete: protectedProcedure
    .use(requirePermission("admin_system", "canDelete"))
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input, ctx }) => {
      await khoaApiGhi(ctx, input.id);
      const d = await db();
      const removed = await d.delete(apiKeys).where(eq(apiKeys.id, input.id)).returning();
      if (removed.length === 0) {
        throw appError("NOT_FOUND", "ENTITY_NOT_FOUND", { entity: "apiKey" }, `API key ${input.id} not found`);
      }
      return { id: input.id, deleted: true };
    }),
});
