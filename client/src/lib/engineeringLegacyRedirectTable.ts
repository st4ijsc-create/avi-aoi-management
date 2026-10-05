/**
 * Doc 81 Đợt 2 Task 15 / Đợt 3 Task 5 — BẢNG URL cũ của module "Kỹ thuật & Điều khiển" (dữ liệu thuần, KHÔNG React/wouter).
 *
 * Final wave (doc 81 Đợt 3, M-4): tách khỏi `engineeringLegacyRedirects.tsx` để `navRecent.ts` (kho Ghim/Gần đây
 * "framework-free", dùng chung cho thanh bên và ⌘K) đọc được `canonicalNavHref` mà không kéo wouter/JSX vào. Hai nơi
 * nhập CÙNG một bảng: `engineeringLegacyRedirects.tsx` dựng `<Route>` chuyển hướng từ nó (và tái xuất mọi tên ở đây),
 * `navRecent.ts` chuẩn hoá lối tắt đã lưu bằng nó. Test: `engineeringLegacyRedirects.dom.test.tsx`, `navRecent.dom.test.tsx`.
 */

export interface LegacyRedirect {
  from: string;
  to: string;
  /** Tham số mặc định của đích — chỉ thêm khi URL cũ chưa mang tham số cùng tên. */
  add: Readonly<Record<string, string>>;
  /**
   * Đợt 3 Task 5 — CÙNG trang, chỉ đổi đường dẫn (không gộp/không chế độ khác) ⇒ lối tắt Ghim/Gần đây đã lưu URL cũ được
   * đọc như URL mới (`canonicalNavHref`, lib/navRecent.ts) thay vì âm thầm biến mất khỏi thanh bên.
   */
  rename?: true;
}

export const ENGINEERING_LEGACY_REDIRECTS: readonly LegacyRedirect[] = [
  { from: "/engineering-studio", to: "/engineering-home", add: { tab: "catalog" } },
  { from: "/engineering/studio", to: "/engineering-home", add: { tab: "catalog" } },
  { from: "/programming-copilot", to: "/engineering", add: { copilot: "scratch" } },
  // Đợt 3 Task 5 ([QĐ-3b]) — Fleet dời sang Labs: cùng trang, route mới; query cũ (?filter=deadlock, ?tab=, ?flyout=) đi tiếp.
  { from: "/fleet-orchestration", to: "/labs/fleet-orchestration", add: {}, rename: true },
];

/**
 * Đợt 3 Task 5 — đường dẫn MỚI của một URL đã đổi tên (`rename: true`), giữ query NGUYÊN VĂN; URL khác trả nguyên.
 * Dùng cho Ghim/Gần đây (lib/navRecent.ts) — KHÔNG dùng cho các URL đã gộp vào trang khác (Studio, Copilot).
 */
export function canonicalNavHref(href: string): string {
  const q = href.indexOf("?");
  const path = q < 0 ? href : href.slice(0, q);
  const hit = ENGINEERING_LEGACY_REDIRECTS.find((r) => r.rename === true && r.from === path);
  return hit ? hit.to + (q < 0 ? "" : href.slice(q)) : href;
}

/** Đích của một chuyển hướng: `to` + query cũ NGUYÊN VĂN + các tham số mặc định còn thiếu. */
export function legacyRedirectTarget(to: string, search: string, add: Readonly<Record<string, string>> = {}): string {
  const raw = search.startsWith("?") ? search.slice(1) : search;
  const have = new URLSearchParams(raw);
  const extra = new URLSearchParams();
  for (const [k, v] of Object.entries(add)) if (!have.has(k)) extra.set(k, v);
  const parts = [raw, extra.toString()].filter((x) => x !== "");
  return parts.length ? `${to}?${parts.join("&")}` : to;
}
