/**
 * doc 60 (menu-depth B) — shared nav favorites + recent store. Reads/writes the SAME
 * localStorage keys the CommandPalette (⌘K) uses, so pinning a page in the sidebar and
 * the palette stay in sync without cross-importing a page component (critic). Framework-
 * free (no React) → the sidebar QuickAccess block + the palette both consume it.
 */
// Final wave (M-4) — bảng THUẦN (.ts), không qua engineeringLegacyRedirects.tsx (wouter + JSX): giữ lời hứa framework-free.
import { canonicalNavHref } from "./engineeringLegacyRedirectTable";

export const NAV_RECENT_KEY = "nav-recent";
export const NAV_FAVORITES_KEY = "nav-favorites";
const RECENT_MAX = 5;
const FAVORITES_MAX = 12;

function readHrefList(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((h): h is string => typeof h === "string") : [];
  } catch {
    return [];
  }
}

function writeHrefList(key: string, list: string[]) {
  try {
    localStorage.setItem(key, JSON.stringify(list));
  } catch {
    /* storage unavailable — ignore */
  }
}

/**
 * Doc 81 Đợt 3 Task 5 — lối tắt đã lưu bằng URL ĐỔI TÊN (vd /fleet-orchestration ⇒ /labs/fleet-orchestration) đọc như URL
 * mới (giữ query), bỏ trùng, giữ thứ tự — không thì mục đã ghim âm thầm biến mất (chỉ href khớp mục nav mới được vẽ).
 */
function canonicalList(list: string[]): string[] {
  return [...new Set(list.map(canonicalNavHref))];
}

export function readRecent(): string[] {
  return canonicalList(readHrefList(NAV_RECENT_KEY));
}

export function readFavorites(): string[] {
  return canonicalList(readHrefList(NAV_FAVORITES_KEY));
}

export function isFavorite(href: string): boolean {
  return readFavorites().includes(href);
}

/** Toggle a favorite; returns the new favorites list. Emits a same-tab event so the
 * sidebar can re-render immediately (localStorage 'storage' only fires cross-tab). */
export function toggleFavorite(href: string): string[] {
  const cur = readFavorites();
  const next = cur.includes(href) ? cur.filter((h) => h !== href) : [href, ...cur].slice(0, FAVORITES_MAX);
  writeHrefList(NAV_FAVORITES_KEY, next);
  try {
    window.dispatchEvent(new CustomEvent("nav-favorites-changed"));
  } catch {
    /* non-browser — ignore */
  }
  return next;
}

export function pushRecentHref(href: string): void {
  const next = [href, ...readRecent().filter((h) => h !== href)].slice(0, RECENT_MAX);
  writeHrefList(NAV_RECENT_KEY, next);
}
