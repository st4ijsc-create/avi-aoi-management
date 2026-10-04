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
import { Redirect, Route, useRouter } from "wouter";

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
