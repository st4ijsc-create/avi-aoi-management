/**
 * doc 81 Đợt 4 Task D1 — đọc/gộp `user_settings.uiPrefs` (mig 0365) của MỘT người dùng.
 *
 * Cột KHÔNG khai vào drizzle schema (`drizzle/schema/dashboard.ts#userSettings`): `select().from(userSettings)` (index.ts
 * /api/user/preferences, `getUserSettings`) liệt kê MỌI cột đã khai ⇒ trên DB chưa áp 0365 (dev — chủ dự án quyết lúc
 * áp) cả trang cài đặt người dùng sẽ hỏng 42703 (bài học 0361; khuôn 0363 `pending_epoch`). Chỉ file này đọc/ghi cột,
 * bằng SQL thô; DB chưa áp ⇒ đọc = `{}` (`available:false`), ghi = `unavailable` (không hỏng gì khác).
 *
 * Gộp (fix 1, doc 81 Đợt 4 Task D1): MỘT giao dịch khoá HÀNG của người dùng (`SELECT … FOR UPDATE`, hàng được tạo trước
 * bằng `INSERT … ON CONFLICT DO NOTHING`) ⇒ các lượt ghi của cùng người dùng chạy NỐI TIẾP, không mất lượt nào (hai tab ghi
 * hai khoá cùng lúc ⇒ giữ CẢ HAI). Trong khoá: `hiện_tại ∪ bản_vá`, rồi nếu tổng > 16 KB ⇒ BỎ khoá BỐ CỤC dùng CŨ NHẤT
 * (không bao giờ `showLabs`, không bao giờ khoá của chính bản vá) tới khi vừa — sổ ghi lại thứ tự dùng là khoá NỘI BỘ
 * `__order` (mảng khoá bố cục, cũ → mới) nằm trong cùng cột: không bao giờ rời server (đọc lọc theo danh sách trắng),
 * client không ghi được (không thuộc danh sách trắng). Không vừa ngay cả khi đã bỏ hết ⇒ `tooLarge`, giao dịch HOÀN TÁC
 * (không ghi gì, kể cả hàng vừa tạo). CHECK của 0365 là lớp thứ hai (23514 ⇒ `tooLarge`).
 * Vì sao bỏ khoá thay vì từ chối: khi chạm trần mọi lượt ghi sau đều BAD_REQUEST ⇒ tài khoản kẹt vĩnh viễn, im lặng (review
 * D minor 5). Khoá bị bỏ vẫn nằm trong localStorage của máy có nó (bộ đệm) — mất đồng bộ của panel ÍT dùng nhất, không mất gì
 * đang dùng.
 * Bản vá PHẢI đã qua `checkUiPrefsPatch` (router) — file này không kiểm danh sách trắng lần nữa.
 */
import { sql } from "drizzle-orm";
import { getDb } from "./connection";
import { UI_PREFS_MAX_BYTES, isValidUiPrefValue, uiPrefKeyKind } from "@shared/uiPrefs";

/** Khoá NỘI BỘ: thứ tự dùng của khoá bố cục (cũ → mới). Không thuộc danh sách trắng ⇒ không vào/ra qua API. */
export const UI_PREFS_ORDER_KEY = "__order";

export type UiPrefs = Record<string, unknown>;

function pgCode(e: unknown): string | undefined {
  const err = e as { code?: string; cause?: { code?: string } } | null | undefined;
  return err?.code ?? err?.cause?.code;
}

const isObj = (v: unknown): v is UiPrefs => !!v && typeof v === "object" && !Array.isArray(v);
const isLayoutKey = (k: string) => uiPrefKeyKind(k)?.kind === "layout";

/**
 * Chỉ các khoá hợp lệ CỦA `userId` (một hàng lỡ có rác — SQL tay — không rời server): bỏ khoá ngoài danh sách trắng, giá trị
 * sai, khoá NỘI BỘ `__order`, và (fix 1 #8) khoá bố cục mang id người khác.
 */
function sach(raw: unknown, userId: number): UiPrefs {
  if (!isObj(raw)) return {};
  const out: UiPrefs = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!isValidUiPrefValue(k, v)) continue;
    const kind = uiPrefKeyKind(k);
    if (kind?.kind === "layout" && kind.userId !== String(userId)) continue;
    out[k] = v;
  }
  return out;
}

/** Chuỗi `jsonb::text` của Postgres (`{"k": v, "k2": [a, b]}`) — ước lượng byte TRƯỚC khi hỏi CSDL. */
export function jsonbTextBytes(v: unknown): number {
  const t = (x: unknown): string => {
    if (Array.isArray(x)) return "[" + x.map(t).join(", ") + "]";
    if (isObj(x)) return "{" + Object.entries(x).map(([k, y]) => JSON.stringify(k) + ": " + t(y)).join(", ") + "}";
    return JSON.stringify(x);
  };
  return Buffer.byteLength(t(v), "utf8");
}

/**
 * Kế hoạch gộp THUẦN (kiểm được không cần CSDL): `hiện_tại ∪ bản_vá`, thứ tự dùng cập nhật (khoá bố cục của bản vá thành
 * MỚI NHẤT, theo thứ tự trong bản vá), rồi bỏ khoá bố cục CŨ NHẤT không thuộc bản vá tới khi `measure` ≤ `cap`.
 * Khoá bố cục có trong hàng mà sổ thứ tự không biết (hàng cũ) ⇒ coi là CŨ NHẤT. null = không vừa dù đã bỏ hết.
 */
export async function planUiPrefsMerge(
  stored: unknown,
  patch: UiPrefs,
  userId: number,
  measure: (o: UiPrefs) => number | Promise<number> = jsonbTextBytes,
  cap: number = UI_PREFS_MAX_BYTES,
): Promise<{ next: UiPrefs; evicted: string[] } | null> {
  const cur = sach(stored, userId);
  const rawOrder = isObj(stored) && Array.isArray(stored[UI_PREFS_ORDER_KEY]) ? (stored[UI_PREFS_ORDER_KEY] as unknown[]) : [];
  let order = [...new Set(rawOrder.filter((k): k is string => typeof k === "string" && k in cur && isLayoutKey(k)))];
  const chuaBiet = Object.keys(cur).filter((k) => isLayoutKey(k) && !order.includes(k)).sort();
  order = [...chuaBiet, ...order].filter((k) => !(k in patch)).concat(Object.keys(patch).filter(isLayoutKey));
  const merged: UiPrefs = { ...cur, ...patch };
  const evicted: string[] = [];
  const build = (): UiPrefs => ({ ...merged, [UI_PREFS_ORDER_KEY]: order });
  while ((await measure(build())) > cap) {
    const victim = order.find((k) => !(k in patch));
    if (!victim) return null;
    delete merged[victim];
    order = order.filter((k) => k !== victim);
    evicted.push(victim);
  }
  return { next: build(), evicted };
}

export async function readUiPrefs(userId: number): Promise<{ prefs: UiPrefs; available: boolean }> {
  const d = await getDb();
  if (!d) return { prefs: {}, available: false };
  try {
    const rows = (await d.execute(sql`SELECT "uiPrefs" AS p FROM user_settings WHERE "userId" = ${userId} LIMIT 1`)) as unknown as Array<{ p: unknown }>;
    return { prefs: sach(rows[0]?.p, userId), available: true };
  } catch (e) {
    if (pgCode(e) === "42703") return { prefs: {}, available: false };
    throw e;
  }
}

export type MergeUiPrefsResult = { ok: true; prefs: UiPrefs; evicted: string[] } | { ok: false; reason: "tooLarge" | "unavailable" };

const HOAN_TAC = Symbol("uiPrefs-rollback");

export async function mergeUiPrefs(userId: number, patch: UiPrefs): Promise<MergeUiPrefsResult> {
  const d = await getDb();
  if (!d) return { ok: false, reason: "unavailable" };
  try {
    return await d.transaction(async (tx) => {
      await tx.execute(sql`INSERT INTO user_settings ("userId") VALUES (${userId}) ON CONFLICT ("userId") DO NOTHING`);
      const rows = (await tx.execute(
        sql`SELECT "uiPrefs" AS p FROM user_settings WHERE "userId" = ${userId} FOR UPDATE`,
      )) as unknown as Array<{ p: unknown }>;
      // Ước lượng bằng JS (rẻ); con số CSDL là trọng tài cuối: còn vượt ⇒ bỏ thêm theo phép đo của CSDL.
      const doCsdl = async (o: UiPrefs) => {
        const js = jsonbTextBytes(o);
        if (js > UI_PREFS_MAX_BYTES) return js;
        const [r] = (await tx.execute(sql`SELECT octet_length((${JSON.stringify(o)})::jsonb::text) AS n`)) as unknown as Array<{ n: number | string }>;
        return Number(r.n);
      };
      const plan = await planUiPrefsMerge(rows[0]?.p, patch, userId, doCsdl);
      if (!plan) throw HOAN_TAC;
      const out = (await tx.execute(sql`
        UPDATE user_settings SET "uiPrefs" = ${JSON.stringify(plan.next)}::jsonb, "updatedAt" = now()
         WHERE "userId" = ${userId} RETURNING "uiPrefs" AS p`)) as unknown as Array<{ p: unknown }>;
      return { ok: true as const, prefs: sach(out[0]?.p, userId), evicted: plan.evicted };
    });
  } catch (e) {
    if (e === HOAN_TAC) return { ok: false, reason: "tooLarge" };
    const code = pgCode(e);
    if (code === "23514") return { ok: false, reason: "tooLarge" };
    if (code === "42703") return { ok: false, reason: "unavailable" };
    throw e;
  }
}
