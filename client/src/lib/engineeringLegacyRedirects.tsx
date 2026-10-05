/**
 * Doc 81 Đợt 2 Task 15 — URL cũ của module "Kỹ thuật & Điều khiển" chuyển hướng, GIỮ NGUYÊN query.
 *
 * - `/engineering-studio` (launcher danh mục, doc 59) ⇒ `/engineering-home`: Studio gộp vào Hub thành chế độ
 *   danh mục (`?tab=catalog`).
 * - `/programming-copilot` (trang Copilot riêng, doc 34 P3) ⇒ `/engineering`: chế độ scratch của IDE
 *   (`?copilot=scratch` — panel Copilot trong layout, chưa cần mở dự án).
 * - `/engineering/studio`: cách viết trong task-15-brief (chưa từng là route thật) — cùng đích với Studio.
 *
 * Luật (test: `engineeringLegacyRedirects.dom.test.tsx`):
 * - chuỗi query cũ được chép NGUYÊN VĂN (không mã hoá lại, giữ thứ tự và tham số lặp);
 * - tham số mặc định của đích chỉ được THÊM khi chưa có — không bao giờ ghi đè tham số người dùng mang theo;
 * - chuyển hướng là REPLACE (Back không quay lại URL cũ để rồi bị đẩy đi lần nữa).
 * App.tsx dựng các `<Route>` này bằng CHÍNH `engineeringLegacyRoutes()` — test dựng cùng hàm.
 */
import type { ReactNode } from "react";
import { Redirect, Route, useLocation, useRouter } from "wouter";

export interface LegacyRedirect {
  from: string;
  to: string;
  /** Tham số mặc định của đích — chỉ thêm khi URL cũ chưa mang tham số cùng tên. */
  add: Readonly<Record<string, string>>;
}

export const ENGINEERING_LEGACY_REDIRECTS: readonly LegacyRedirect[] = [
  { from: "/engineering-studio", to: "/engineering-home", add: { tab: "catalog" } },
  { from: "/engineering/studio", to: "/engineering-home", add: { tab: "catalog" } },
  { from: "/programming-copilot", to: "/engineering", add: { copilot: "scratch" } },
];

/** Đích của một chuyển hướng: `to` + query cũ NGUYÊN VĂN + các tham số mặc định còn thiếu. */
export function legacyRedirectTarget(to: string, search: string, add: Readonly<Record<string, string>> = {}): string {
  const raw = search.startsWith("?") ? search.slice(1) : search;
  const have = new URLSearchParams(raw);
  const extra = new URLSearchParams();
  for (const [k, v] of Object.entries(add)) if (!have.has(k)) extra.set(k, v);
  const parts = [raw, extra.toString()].filter((x) => x !== "");
  return parts.length ? `${to}?${parts.join("&")}` : to;
}

export function LegacyQueryRedirect({ to, add }: { to: string; add?: Readonly<Record<string, string>> }) {
  // Query THÔ của router (không qua `useSearch`, vốn `decodeURI` — %20 ⇒ dấu cách): chép nguyên văn.
  const router = useRouter();
  const search = router.searchHook(router);
  return <Redirect to={legacyRedirectTarget(to, search, add)} replace />;
}

/** Các `<Route>` chuyển hướng — gọi TRONG `<Switch>` của App.tsx (Switch của wouter làm phẳng mảng con). */
export function engineeringLegacyRoutes() {
  return ENGINEERING_LEGACY_REDIRECTS.map((r) => (
    <Route key={r.from} path={r.from}>
      <LegacyQueryRedirect to={r.to} add={r.add} />
    </Route>
  ));
}

// ── Doc 81 Đợt 3 Task 1 — chuyển hướng theo TAB: một tab của trang cũ dời sang trang khác ───────────────────────
//
// `/equipment-integration?tab=recipes|history` ⇒ `/recipes?tab=versions|history` (phiên bản recipe và lịch sử nạp dời
// sang Recipes; Integration bỏ hai tab đó). Route `/equipment-integration` vẫn là trang thật cho các tab còn lại, nên
// không thể là một `<Route>` chuyển hướng: trang cũ bọc nội dung bằng `LegacyTabRedirectGate`.
// Luật (test: `engineeringLegacyRedirects.dom.test.tsx`): như trên — query cũ chép NGUYÊN VĂN, chỉ GIÁ TRỊ của `tab`
// được thay (mọi lần xuất hiện của `tab` gộp về một, tại vị trí đầu tiên), REPLACE.

export interface LegacyTabRedirect {
  from: string;
  tab: string;
  to: string;
  tabTo: string;
}

export const ENGINEERING_LEGACY_TAB_REDIRECTS: readonly LegacyTabRedirect[] = [
  { from: "/equipment-integration", tab: "recipes", to: "/recipes", tabTo: "versions" },
  { from: "/equipment-integration", tab: "history", to: "/recipes", tabTo: "history" },
];

/** Khoá của một cặp `k=v` trong query thô (giải mã như URLSearchParams: `+` ⇒ dấu cách). */
function rawKey(part: string): string {
  const k = part.split("=", 1)[0].replace(/\+/g, " ");
  try {
    return decodeURIComponent(k);
  } catch {
    return k;
  }
}

/** Đích: `to` + query cũ NGUYÊN VĂN, riêng `tab` mang giá trị mới. */
export function legacyTabRedirectTarget(to: string, search: string, tabTo: string): string {
  const raw = search.startsWith("?") ? search.slice(1) : search;
  const out: string[] = [];
  let replaced = false;
  for (const part of raw.split("&")) {
    if (part === "") continue;
    if (rawKey(part) === "tab") {
      if (!replaced) out.push(`tab=${encodeURIComponent(tabTo)}`);
      replaced = true;
      continue;
    }
    out.push(part);
  }
  if (!replaced) out.unshift(`tab=${encodeURIComponent(tabTo)}`);
  return `${to}?${out.join("&")}`;
}

/** Chuyển hướng theo tab áp cho `from` với query `search` (giá trị `tab` theo URLSearchParams — lần đầu), hoặc null. */
export function findLegacyTabRedirect(from: string, search: string): LegacyTabRedirect | null {
  const tab = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search).get("tab");
  return ENGINEERING_LEGACY_TAB_REDIRECTS.find((r) => r.from === from && r.tab === tab) ?? null;
}

/** Bọc nội dung trang `from`: `?tab=` đã dời ⇒ REPLACE sang đích (giữ query); còn lại ⇒ dựng trang như thường. */
export function LegacyTabRedirectGate({ from, children }: { from: string; children: ReactNode }) {
  const router = useRouter();
  const [path] = useLocation();
  const search = router.searchHook(router);
  // Chỉ khi ĐANG ở `from` (sau khi chuyển, cổng còn mount một nhịp ở đích thì không chuyển lại).
  const hit = path === from ? findLegacyTabRedirect(from, search) : null;
  if (hit) return <Redirect to={legacyTabRedirectTarget(hit.to, search, hit.tabTo)} replace />;
  return <>{children}</>;
}
