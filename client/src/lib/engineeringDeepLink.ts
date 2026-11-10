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
 *
 * Hành vi:
 * - Bỏ null / undefined, bỏ chuỗi rỗng và chuỗi toàn khoảng trắng.
 * - Cắt khoảng trắng hai đầu giá trị chuỗi trước khi ghép.
 * - Chuyển số thành chuỗi (vd 5 → "5", 3.14 → "3.14").
 * - Mã hoá ký tự đặc biệt bằng URLSearchParams.
 * - Path rỗng + param → "?key=value"; path rỗng + không param → "".
 * - Path "/" + param → "/?key=value".
 * - Path đã có query → tham số mới ghép bằng "&"; khoá trùng thì giá trị mới
 *   thay giá trị cũ tại lần xuất hiện ĐẦU TIÊN; các tham số cũ KHÔNG bị thay
 *   thì giữ NGUYÊN VĂN (khoá, giá trị, cách mã hoá — không giải mã rồi mã hoá lại;
 *   "%20" cũ vẫn là "%20").
 * - Path có "#fragment" → query đứng trước "#", fragment giữ nguyên văn.
 * - Path có cả "?" lẫn "#" → query đã ghép đứng trước "#", fragment giữ nguyên.
 * - Không có tham số hợp lệ nào → trả về path nguyên văn từng byte.
 * - Ca biên: path kết thúc bằng "?" trống → không ra "?&" hay "??";
 *   path kết thúc bằng "#" trống → giữ "#" ở cuối;
 *   tham số cũ không có dấu "=" giữ nguyên văn.
 */
export function withParams(
  path: string,
  params: Record<string, string | number | null | undefined>,
): string {
  // 1. Thu thập các tham số hợp lệ
  const newParams: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) {
    if (v == null) continue;
    const s = String(v).trim();
    if (s === "") continue;
    newParams[k] = s;
  }

  // 2. Không có tham số hợp lệ → trả về path nguyên văn
  if (Object.keys(newParams).length === 0) {
    return path;
  }

  // 3. Tách fragment (nếu có)
  const hashIdx = path.indexOf("#");
  const fragment = hashIdx !== -1 ? path.slice(hashIdx) : "";
  const pathWithoutFragment = hashIdx !== -1 ? path.slice(0, hashIdx) : path;

  // 4. Tách query cũ (nếu có)
  const qIdx = pathWithoutFragment.indexOf("?");
  let existingQs = "";
  let basePath = pathWithoutFragment;

  if (qIdx !== -1) {
    basePath = pathWithoutFragment.slice(0, qIdx);
    existingQs = pathWithoutFragment.slice(qIdx + 1);
  }

  // 5. Parse query cũ thành mảng các cặp (giữ nguyên văn, giữ thứ tự, giữ bản lặp)
  //    Mỗi phần tử: { key, text: "key=value" hoặc "key", value: "value" hoặc undefined }
  const existingEntries: Array<{ key: string; text: string; value: string | undefined }> = [];
  if (existingQs !== "") {
    const pairs = existingQs.split("&");
    for (const pair of pairs) {
      const eqIdx = pair.indexOf("=");
      if (eqIdx === -1) {
        // param không có "=": giữ nguyên văn
        existingEntries.push({ key: pair, text: pair, value: undefined });
      } else {
        const key = pair.slice(0, eqIdx);
        const value = pair.slice(eqIdx + 1);
        existingEntries.push({ key, text: pair, value });
      }
    }
  }

  // 6. Ghép query mới: thay thế khoá trùng (ở lần xuất hiện ĐẦU TIÊN),
  //    bỏ các bản lặp sau của cùng khoá đó; các khoá không trùng giữ nguyên.
  const newKeys = new Set(Object.keys(newParams));
  const replacedKeys = new Set<string>();
  const resultPairs: string[] = [];

  for (const entry of existingEntries) {
    // Nếu khoá này đã được thay thế ở lần xuất hiện trước → bỏ qua (continue)
    if (replacedKeys.has(entry.key)) {
      continue;
    }
    if (newKeys.has(entry.key)) {
      // Khoá trùng, lần đầu → thay bằng giá trị mới (mã hoá bằng URLSearchParams)
      const sp = new URLSearchParams();
      sp.set(entry.key, newParams[entry.key]);
      resultPairs.push(sp.toString());
      replacedKeys.add(entry.key);
      newKeys.delete(entry.key);
    } else {
      // Khoá không trùng → giữ nguyên văn
      resultPairs.push(entry.text);
    }
  }

  // Thêm các khoá mới chưa có trong query cũ
  for (const key of newKeys) {
    const sp = new URLSearchParams();
    sp.set(key, newParams[key]);
    resultPairs.push(sp.toString());
  }

  // 7. Ghép lại: basePath + ? + qs + fragment
  const newQs = resultPairs.join("&");
  return `${basePath}?${newQs}${fragment}`;
}
