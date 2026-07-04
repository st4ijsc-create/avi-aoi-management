/**
 * U1 (doc 26 §2.2/§3.2) — Ngữ cảnh golden-thread đi theo khi chuyển trang.
 *
 * Nguồn CHÍNH là DEEP-LINK query param (robust, chia sẻ được, sống sót qua reload) —
 * chuẩn hoá tên tham số dùng chung cho cả module "Kỹ thuật & Điều khiển":
 *   ?projectId=<number>   → programming project  (Engineering / IR / POU)
 *   ?ref=<workflowRef>    → orchestration workflow (→ Cell Twin / RF Test Cell)
 *   ?machineId=<number>   → thiết bị
 * Store `lastSelected` (EngineeringContext) chỉ là FALLBACK khi URL không có query.
 *
 * File này chỉ chứa helper THUẦN (không React) để dễ test và tái dùng ở mọi trang.
 */

export interface DeepLinkParams {
  projectId: number | null;
  ref: string | null;
  machineId: number | null;
}

/** Số nguyên dương hợp lệ, ngược lại null. */
function toPosInt(v: string | null): number | null {
  if (v == null || v.trim() === "") return null;
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Parse chuỗi search (vd "?projectId=3&ref=line-a" HOẶC "projectId=3&ref=line-a" —
 * wouter `useSearch` trả về không có dấu "?") thành params đã chuẩn hoá.
 */
export function parseDeepLink(search: string): DeepLinkParams {
  const raw = search.startsWith("?") ? search.slice(1) : search;
  const sp = new URLSearchParams(raw);
  const ref = sp.get("ref");
  return {
    projectId: toPosInt(sp.get("projectId")),
    machineId: toPosInt(sp.get("machineId")),
    ref: ref && ref.trim() !== "" ? ref : null,
  };
}

/**
 * Ghép query param (bỏ giá trị null/rỗng) vào path để tạo cross-link MANG ngữ cảnh.
 * Giữ hành vi cũ: không có param nào hợp lệ → trả về path trơn như trước.
 */
export function withParams(
  path: string,
  params: Record<string, string | number | null | undefined>,
): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v == null) continue;
    const s = String(v).trim();
    if (s === "") continue;
    sp.set(k, s);
  }
  const qs = sp.toString();
  return qs ? `${path}?${qs}` : path;
}
