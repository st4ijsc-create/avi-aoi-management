/**
 * doc 81 Đợt 3b final wave — Ruling R-3b-c: `?next=` của trang đăng nhập chỉ nhận đường NỘI BỘ tương đối (cùng luật
 * `safeInternalPath` của chuông thông báo). Trước: `startsWith("/")` ⇒ `?next=//evil.example` / `?next=/\evil.example` đi
 * thẳng vào `window.location.href` sau đăng nhập (open redirect). Không qua được ⇒ `null` ⇒ trang dùng đích theo vai.
 */
import { safeInternalPath } from "@shared/internalPath";

export function loginNextPath(search: string): string | null {
  return safeInternalPath(new URLSearchParams(search).get("next"));
}
