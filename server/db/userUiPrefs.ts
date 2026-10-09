/**
 * doc 81 Đợt 4 Task D1 — đọc/gộp `user_settings.uiPrefs` (mig 0365) của MỘT người dùng.
 *
 * Cột KHÔNG khai vào drizzle schema (`drizzle/schema/dashboard.ts#userSettings`): `select().from(userSettings)` (index.ts
 * /api/user/preferences, `getUserSettings`) liệt kê MỌI cột đã khai ⇒ trên DB chưa áp 0365 (dev — chủ dự án quyết lúc
 * áp) cả trang cài đặt người dùng sẽ hỏng 42703 (bài học 0361; khuôn 0363 `pending_epoch`). Chỉ file này đọc/ghi cột,
 * bằng SQL thô; DB chưa áp ⇒ đọc = `{}` (`available:false`), ghi = `unavailable` (không hỏng gì khác).
 *
 * Gộp: `uiPrefs || bản_vá` trong MỘT câu `INSERT … ON CONFLICT DO UPDATE` — nguyên tử, không đọc-sửa-ghi (hai tab ghi hai
 * khoá khác nhau cùng lúc ⇒ giữ CẢ HAI). Trần tổng kích thước kiểm TRONG cùng câu (`WHERE octet_length(...) <= trần`):
 * vượt ⇒ 0 hàng ⇒ `tooLarge`, không ghi gì. CHECK của 0365 là lớp thứ hai (23514 ⇒ cũng `tooLarge`).
 * Bản vá PHẢI đã qua `checkUiPrefsPatch` (router) — file này không kiểm danh sách trắng lần nữa.
 */
import { sql } from "drizzle-orm";
import { getDb } from "./connection";
import { UI_PREFS_MAX_BYTES, isValidUiPrefValue } from "@shared/uiPrefs";

export type UiPrefs = Record<string, unknown>;

function pgCode(e: unknown): string | undefined {
  const err = e as { code?: string; cause?: { code?: string } } | null | undefined;
  return err?.code ?? err?.cause?.code;
}

/** Chỉ trả các khoá hợp lệ (một hàng lỡ có rác — SQL tay — không rời server). */
function sach(raw: unknown): UiPrefs {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: UiPrefs = {};
  for (const [k, v] of Object.entries(raw as UiPrefs)) if (isValidUiPrefValue(k, v)) out[k] = v;
  return out;
}

export async function readUiPrefs(userId: number): Promise<{ prefs: UiPrefs; available: boolean }> {
  const d = await getDb();
  if (!d) return { prefs: {}, available: false };
  try {
    const rows = (await d.execute(sql`SELECT "uiPrefs" AS p FROM user_settings WHERE "userId" = ${userId} LIMIT 1`)) as unknown as Array<{ p: unknown }>;
    return { prefs: sach(rows[0]?.p), available: true };
  } catch (e) {
    if (pgCode(e) === "42703") return { prefs: {}, available: false };
    throw e;
  }
}

export type MergeUiPrefsResult = { ok: true; prefs: UiPrefs } | { ok: false; reason: "tooLarge" | "unavailable" };

export async function mergeUiPrefs(userId: number, patch: UiPrefs): Promise<MergeUiPrefsResult> {
  const d = await getDb();
  if (!d) return { ok: false, reason: "unavailable" };
  const json = JSON.stringify(patch);
  try {
    const rows = (await d.execute(sql`
      INSERT INTO user_settings ("userId", "uiPrefs") VALUES (${userId}, ${json}::jsonb)
      ON CONFLICT ("userId") DO UPDATE
        SET "uiPrefs" = user_settings."uiPrefs" || EXCLUDED."uiPrefs", "updatedAt" = now()
        WHERE octet_length((user_settings."uiPrefs" || EXCLUDED."uiPrefs")::text) <= ${UI_PREFS_MAX_BYTES}
      RETURNING "uiPrefs" AS p`)) as unknown as Array<{ p: unknown }>;
    if (rows.length === 0) return { ok: false, reason: "tooLarge" };
    return { ok: true, prefs: sach(rows[0].p) };
  } catch (e) {
    const code = pgCode(e);
    if (code === "23514") return { ok: false, reason: "tooLarge" };
    if (code === "42703") return { ok: false, reason: "unavailable" };
    throw e;
  }
}
