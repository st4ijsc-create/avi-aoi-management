/**
 * ★★★ 2026-09-03 · ĐỢT E2 — **DANH SÁCH KÝ HIỆU (outline) cho Trình xem** của `/ai-coding-workspace`.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * VÌ SAO REGEX, VÀ VÌ SAO ĐÓ KHÔNG PHẢI SỰ CẨU THẢ
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Một outline ĐÚNG nghĩa cần AST cho từng ngôn ngữ (ts/tsx/cs/py…). Trang này không có tầng ấy ở
 * client, và kéo một parser cho mỗi ngôn ngữ vào bundle là cái giá không tương xứng với việc
 * "nhảy tới hàm". Ta chọn regex **HẸP**, và cái hẹp ấy được phát biểu thành một luật:
 *
 *   ⚠⚠ **THÀ THIẾU CÒN HƠN TRỎ SAI.** Một mục outline trỏ nhầm dòng làm người đọc mất niềm tin vào
 *   CẢ danh sách; một mục thiếu chỉ khiến họ cuộn tay như trước. Nên mọi khuôn ở đây đòi ký hiệu
 *   đứng ở ĐẦU DÒNG (cho phép thụt lề), đòi từ khoá khai báo NGUYÊN VẸN, và **không đoán** thân
 *   hàm, không nhận lời gọi.
 *
 * ⚠ Không nhận `const x = 1` (biến thường): outline đầy biến vô nghĩa thì mất tác dụng điều hướng.
 *   Chỉ nhận `const X = (…) =>` / `= function` — tức HÀM viết bằng const.
 * ⚠ Dòng nằm trong chuỗi/chú thích VẪN có thể lọt (regex không hiểu ngữ cảnh). Đó là giới hạn KHAI
 *   RA, và là lý do mục outline chỉ ĐIỀU HƯỚNG (cuộn tới dòng), không dùng cho quyết định nào.
 */

export interface KyHieu {
  /** Tên ký hiệu, đúng như trong mã. */
  ten: string;
  /** Loại — giữ ÍT loại để không bịa phân biệt mà regex không thấy được. */
  loai: "ham" | "lop" | "kieu" | "hang";
  /** Dòng 1-based — nối thẳng vào `dongMucTieu` của Trình xem (cùng cơ chế cuộn của panel Vấn đề). */
  dong: number;
}

/** Trần số ký hiệu — một danh sách 2.000 mục không phải outline, nó là một tệp thứ hai. */
export const TRAN_KY_HIEU = 300;

/** Đuôi tệp DỮ LIỆU: không có ký hiệu mã ⇒ trả rỗng thay vì bịa mục từ chuỗi. */
const DUOI_DU_LIEU = new Set(["json", "md", "txt", "csv", "yml", "yaml", "lock"]);

/** Mỗi khuôn một dòng, mỗi dòng một lý do. `^\s*` cho thụt lề (phương thức trong lớp). */
const KHUON: ReadonlyArray<{ re: RegExp; loai: KyHieu["loai"] }> = [
  { re: /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s+([A-Za-z_$][\w$]*)/, loai: "ham" },
  { re: /^\s*(?:export\s+)?(?:const|let)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s+)?(?:function\b|\([^)]*\)\s*(?::[^=]+)?=>|[A-Za-z_$][\w$]*\s*=>)/, loai: "ham" },
  { re: /^\s*(?:export\s+)?(?:default\s+)?(?:public\s+|internal\s+|abstract\s+|sealed\s+|partial\s+)*class\s+([A-Za-z_$][\w$]*)/, loai: "lop" },
  { re: /^\s*(?:export\s+)?(?:declare\s+)?(?:interface|type|enum)\s+([A-Za-z_$][\w$]*)/, loai: "kieu" },
  { re: /^\s*(?:public\s+|internal\s+|abstract\s+|sealed\s+|partial\s+)*(?:struct|record)\s+([A-Za-z_$][\w$]*)/, loai: "kieu" },
  { re: /^\s*(?:async\s+)?def\s+([A-Za-z_][\w]*)/, loai: "ham" },
  { re: /^\s*(?:export\s+)?const\s+([A-Z][A-Z0-9_]{2,})\s*(?::|=)/, loai: "hang" },
];

/**
 * Trích ký hiệu theo THỨ TỰ DÒNG. THUẦN, không chạm DOM — lưới hỏi thẳng từng khuôn.
 * ⚠ Một dòng khớp NHIỀU khuôn chỉ sinh MỘT mục (khuôn ĐẦU thắng): thứ tự mảng `KHUON` vì thế là
 *   một quyết định — hàm đứng trước hằng, nên `export const FOO = () => {}` là "ham".
 */
export function trichKyHieu(noiDung: string, duongDan = ""): KyHieu[] {
  if (typeof noiDung !== "string" || noiDung === "") return [];
  const duoi = duongDan.toLowerCase().split(".").pop() ?? "";
  if (DUOI_DU_LIEU.has(duoi)) return [];

  const ket: KyHieu[] = [];
  const dong = noiDung.split(/\r?\n/);
  for (let i = 0; i < dong.length && ket.length < TRAN_KY_HIEU; i++) {
    const d = dong[i]!;
    if (d.length > 400) continue; // dòng khổng lồ (bundle/minified) không phải mã người đọc
    for (const k of KHUON) {
      const m = k.re.exec(d);
      if (m?.[1]) {
        ket.push({ ten: m[1], loai: k.loai, dong: i + 1 });
        break;
      }
    }
  }
  return ket;
}
