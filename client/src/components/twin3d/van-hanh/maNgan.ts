/**
 * maNgan.ts — RÚT TIỀN TỐ CHUNG khỏi một tập mã (trạm/máy) để hiện NGẮN ở nơi chật — KHÔNG cắt chữ.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ ĐỢT 38 (Pareto #7 QA Đợt 37) — SỐ ĐO, KHÔNG PHẢI SỞ THÍCH
 * ════════════════════════════════════════════════════════════════════════════
 * Đo `/twin/line/2` ở 1280×720 (`.qa-dot38/truoc/p7-line-2-1280x720.json`):
 *   · dải trạm: 12 ô cần **969 px**, `ol` có **944** ⇒ cuộn ngang 25 px; các `li` bị ép co nên ô đè lên mũi tên kề
 *     (Δx 74–76 px trong khi ô rộng 80–119 px) — nhìn thì "tên trạm bị cắt";
 *   · nhãn 3D: 12 nóc máy cách nhau ~60 px, nhãn "SIM-L2-CONVEYOR · Unknown" rộng 144–191 px ⇒ declutter giấu
 *     **5/12** ("5 more names hidden"); ở 1600×900 là 1/12.
 * Cả 12 mã trạm lẫn 12 mã máy của chuyền cùng mang tiền tố `SIM-L2-`. Ở màn CHỈ-CÓ-chuyền-này (breadcrumb + tiêu đề
 * đã nói "Line 2") bảy ký tự ấy lặp 12 lần mà không mang thêm thông tin. Rút nó đi là cách duy nhất vừa **không cắt
 * tên** (`truncate`/ellipsis là câu SAI: người đọc không biết mình đang thiếu gì) vừa **không nhồi thêm thanh cuộn**.
 *
 * ★ LUẬT — hàm THUẦN, test được trong node (`maNgan.unit.test.ts`):
 *   1. Chỉ rút khi có ≥ 2 mã và MỌI mã chia cùng tiền tố. Một mã lạc loài ⇒ **không rút gì cả** — không rút "gần đúng".
 *   2. Tiền tố cắt TẠI ranh giới ngăn cách (`-` `_` `/` `.` khoảng trắng), giữ cả dấu: `SIM-L2-CO…` ⇒ `SIM-L2-`.
 *      Cắt giữa một từ (`SPI`/`SCREW` ⇒ `S`) là bịa ra một ranh giới không có ⇒ trả rỗng.
 *   3. Phần còn lại của MỌI mã phải khác rỗng — một mã trùng hệt tiền tố sẽ mất tên.
 *   4. Nơi hiện mã ngắn PHẢI in tiền tố đã rút ở cùng bề mặt (`DaiLine` in ở đầu dải, `dai-line-tien-to`) và giữ mã
 *      đầy đủ ở `title`/`data-ma`/danh sách — rút để ĐỌC ĐƯỢC, không phải để giấu.
 */

/** Ký tự được coi là ranh giới giữa các phần của một mã. */
const NGAN_CACH = /[-_./ ]/;

/**
 * Tiền tố chung của một tập mã, cắt tại ranh giới ngăn cách (giữ dấu). `""` khi không rút được (xem luật 1–3).
 */
export function tienToChung(ma: readonly string[]): string {
  if (ma.length < 2) return "";
  let p = ma[0];
  for (const m of ma) {
    let k = 0;
    while (k < p.length && k < m.length && p[k] === m[k]) k += 1;
    p = p.slice(0, k);
    if (p.length === 0) return "";
  }
  // Lùi về ranh giới ngăn cách gần nhất (giữ dấu). `cat < 1`: không có ranh giới, hoặc ranh giới ở ngay đầu ⇒ không rút.
  let cat = -1;
  for (let i = p.length - 1; i >= 0; i -= 1) {
    if (NGAN_CACH.test(p[i])) {
      cat = i;
      break;
    }
  }
  if (cat < 1) return "";
  const tienTo = p.slice(0, cat + 1);
  // Luật 3 — mọi phần còn lại phải khác rỗng.
  if (ma.some((m) => m.length <= tienTo.length)) return "";
  return tienTo;
}

/** Mã sau khi rút tiền tố; trả nguyên mã khi tiền tố rỗng, không khớp, hoặc rút xong sẽ rỗng. */
export function rutTienTo(ma: string, tienTo: string): string {
  if (!tienTo || !ma.startsWith(tienTo) || ma.length <= tienTo.length) return ma;
  return ma.slice(tienTo.length);
}
