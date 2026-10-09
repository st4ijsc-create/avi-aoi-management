/**
 * doc 81 Đợt 4 Task D1 — DANH SÁCH TRẮNG DUY NHẤT của sở thích giao diện lưu phía server (`user_settings.uiPrefs`, mig 0365).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Một chỗ, hai bên đọc:
 *   • server — `userSettingsRouter.setUiPrefs` kiểm MỌI khoá của bản vá bằng `checkUiPrefsPatch` TRƯỚC khi ghi; một khoá
 *     lạ / một giá trị sai ⇒ BAD_REQUEST, KHÔNG ghi gì (cả bản vá bị bỏ);
 *   • client — `lib/uiPrefsSync.ts` chỉ đẩy lên các khoá qua được cùng hàm này (không gửi thứ server sẽ từ chối).
 *
 * Khoá hợp lệ (đúng hai họ):
 *   1. `showLabs` — boolean (sở thích "Hiện Labs", Đợt 3 Task 5; kho cục bộ: khoá `layoutKit:nav-labs:u<id>:show` "1"/"0").
 *   2. Bố cục WorkbenchShell — khoá ĐÚNG NHƯ `userLayoutKey(layoutId, userId, part)` sinh ra
 *      (`layoutKit:<layoutId>:u<userId>:<part>`), `part` ∈ {hpx, vpx, bottomCollapsed}:
 *        - `hpx`  = { left?: {px, pct}, right?: {px, pct} } — bề rộng panel trái/phải người dùng đã kéo;
 *        - `vpx`  = { bottom?: {px, pct} }                   — chiều cao panel dưới;
 *        - `bottomCollapsed` = boolean                        — lựa chọn gập panel dưới (R-2-l).
 *      `<userId>` trong khoá PHẢI là chính người gọi (không ghi được khoá mang id người khác).
 *      `split` (SplitListDetail — `autoSaveId` của thư viện, định dạng riêng của thư viện) KHÔNG đồng bộ.
 *
 * Giá trị: px hữu hạn trong [0, UI_PREF_PANEL_PX_MAX]; pct hữu hạn trong [0, 100]; không khoá con lạ.
 * Tổng `uiPrefs` sau khi gộp ≤ UI_PREFS_MAX_BYTES (đo bằng `octet_length(jsonb::text)` ở CSDL — cùng phép đo với CHECK của
 * mig 0365).
 *
 * File này KHÔNG import gì (client dùng lại được mà không kéo theo server).
 * ════════════════════════════════════════════════════════════════════════════
 */

/** Trần kích thước TỔNG của `user_settings.uiPrefs` (byte của `jsonb::text`). Cùng số với CHECK của mig 0365. */
export const UI_PREFS_MAX_BYTES = 16 * 1024;

/**
 * Trần px của một kích thước panel đã lưu. WorkbenchShell kẹp lại theo `minPx/maxPx` của trang lúc dùng (các trang hiện
 * khai tối đa 480 px); trần ở đây chỉ chặn giá trị vô lý (một panel không rộng hơn một màn 4K), không thay giới hạn trang.
 */
export const UI_PREF_PANEL_PX_MAX = 4096;

/** Khoá của sở thích "Hiện Labs" phía server. */
export const UI_PREF_SHOW_LABS = "showLabs";

/** layoutId + part của khoá cục bộ (`userLayoutKey`) mang sở thích "Hiện Labs". */
export const SHOW_LABS_LAYOUT_ID = "nav-labs";
export const SHOW_LABS_PART = "show";

/** Các `part` bố cục được đồng bộ. */
export const UI_PREF_LAYOUT_PARTS = ["hpx", "vpx", "bottomCollapsed"] as const;
export type UiPrefLayoutPart = (typeof UI_PREF_LAYOUT_PARTS)[number];

/**
 * Suy từ `userLayoutKey`: `layoutKit:${layoutId}:u${userId}:${part}`. layoutId: chữ/số/`-`/`_`, ≤ 64 ký tự (các trang
 * dùng "engineering", "ir-editor", "pou-studio", "orchestration-studio"…); userId: số nguyên dương.
 */
export const UI_PREF_LAYOUT_KEY_RE = /^layoutKit:([A-Za-z0-9][A-Za-z0-9_-]{0,63}):u([1-9][0-9]{0,9}):(hpx|vpx|bottomCollapsed)$/;

export type UiPrefsRejectReason = "notObject" | "unknownKey" | "otherUser" | "badValue" | "tooLarge";
export type UiPrefsCheck =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; key: string | null; reason: UiPrefsRejectReason };

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;

const inRange = (n: unknown, max: number): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= max;

function isStoredSize(v: unknown): boolean {
  if (!isPlainObject(v)) return false;
  const keys = Object.keys(v);
  if (keys.length !== 2 || !keys.includes("px") || !keys.includes("pct")) return false;
  return inRange(v.px, UI_PREF_PANEL_PX_MAX) && inRange(v.pct, 100);
}

function isSizesOf(v: unknown, sides: readonly string[]): boolean {
  if (!isPlainObject(v)) return false;
  return Object.entries(v).every(([side, s]) => sides.includes(side) && isStoredSize(s));
}

/** Phân loại MỘT khoá (không xét giá trị): `null` = không thuộc danh sách trắng. */
export function uiPrefKeyKind(key: string): { kind: "showLabs" } | { kind: "layout"; layoutId: string; userId: string; part: UiPrefLayoutPart } | null {
  if (key === UI_PREF_SHOW_LABS) return { kind: "showLabs" };
  const m = UI_PREF_LAYOUT_KEY_RE.exec(key);
  if (!m) return null;
  return { kind: "layout", layoutId: m[1], userId: m[2], part: m[3] as UiPrefLayoutPart };
}

/** Giá trị của một khoá ĐÃ biết loại có hợp lệ không. */
export function isValidUiPrefValue(key: string, value: unknown): boolean {
  const k = uiPrefKeyKind(key);
  if (!k) return false;
  if (k.kind === "showLabs" || k.part === "bottomCollapsed") return typeof value === "boolean";
  if (k.part === "hpx") return isSizesOf(value, ["left", "right"]);
  return isSizesOf(value, ["bottom"]);
}

/**
 * Kiểm một bản vá (`{ khoá: giá trị }`) cho người dùng `userId`. Lỗi đầu tiên ⇒ từ chối CẢ bản vá (không gộp một phần).
 * Trần kích thước ở đây đo `JSON.stringify` của chính bản vá (rẻ, trước khi chạm CSDL); trần của TỔNG sau gộp do CSDL đo.
 */
export function checkUiPrefsPatch(patch: unknown, userId: number | string): UiPrefsCheck {
  if (!isPlainObject(patch)) return { ok: false, key: null, reason: "notObject" };
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    const k = uiPrefKeyKind(key);
    if (!k) return { ok: false, key, reason: "unknownKey" };
    if (k.kind === "layout" && k.userId !== String(userId)) return { ok: false, key, reason: "otherUser" };
    if (!isValidUiPrefValue(key, value)) return { ok: false, key, reason: "badValue" };
    out[key] = value;
  }
  if (JSON.stringify(out).length > UI_PREFS_MAX_BYTES) return { ok: false, key: null, reason: "tooLarge" };
  return { ok: true, value: out };
}
