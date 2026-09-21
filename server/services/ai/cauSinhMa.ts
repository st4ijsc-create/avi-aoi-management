/**
 * ★★★ G2b (audit 2026-09-21 · P11) — VỊ TỪ "CÂU NÀY YÊU CẦU SINH MÃ".
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * VÌ SAO CẦN VỊ TỪ NÀY — VÀ VÌ SAO NÓ ĐỨNG RIÊNG
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `streamCodingAnswer` có một ngã rẽ (mục 2.4, 2026-08-23):
 *
 *     if (answer.trim() !== "" && laCauCanSuyLuan(question)) { …đưa kết quả tool LẠI cho model… }
 *     yield { type: "token", token: answer };   // ← ngược lại: DUMP nguyên văn kết quả tool
 *
 * `laCauCanSuyLuan` phủ *giải thích · vì sao · so sánh · có lỗi gì · dấu hỏi cuối câu*. Nó **KHÔNG**
 * phủ câu **SINH MÃ**. Hệ quả đo được (bộ bài KHÓ 9 câu, mỗi câu có test thực thi):
 *
 *   • *"Viết TypeScript: export class BoNhoLRU<K,V> …"* — không dấu hỏi, không động từ giải thích
 *     ⇒ `laCauCanSuyLuan` = false ⇒ vòng tool trót gọi `read_file` và **nguyên văn
 *     `server/services/aiLocalTools/toolRegistry.ts` (26.004 byte) trở thành CÂU TRẢ LỜI**.
 *   • 6/9 bài trả về **0 khối mã**; đường ống đạt **0 %** trong khi model THUẦN đạt 44–56 %.
 *   • Xảy ra y hệt với model chat ⇒ lỗi CÓ SẴN, không do đổi model (G1).
 *
 * ⇒ Bản vá KHÔNG nới `laCauCanSuyLuan` (vị từ ấy trả lời câu hỏi KHÁC: "có cần suy luận không").
 *   Nó thêm một vị từ ANH EM, cùng hình dạng, cùng kiểu lưới: *"câu này có đòi MÃ không"*.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ĐÁNH ĐỔI SÓT / THỪA — CÓ CHỦ Ý, LỆCH VỀ PHÍA GỌI MODEL
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *   • THỪA (câu đọc tệp bị coi là sinh mã): model diễn giải thay vì dump ⇒ chậm hơn ~vài giây,
 *     **vẫn đúng**. Thẻ `tool` đã phát trước đó nên người dùng KHÔNG mất nội dung thật.
 *   • SÓT  (câu sinh mã bị bỏ qua): người xin một lớp LRU **nhận về một tệp lạ của repo**.
 * Hai vế KHÔNG cùng hạng ⇒ vị từ lệch về phía bắt.
 *
 * ⚠ Đường NHANH vẫn được giữ: *"đọc file X"*, *"liệt kê thư mục Y"*, *"grep Z"* KHÔNG mang động từ
 *   sinh mã nào ⇒ vị từ trả `false` ⇒ dump tức thì y như cũ. `cauSinhMa.test.ts` canh đúng điều đó.
 */

/** Bỏ dấu tiếng Việt + thường hoá. Tự chứa: `intentClassifier.ts` không xuất hàm tương đương. */
function boDauThuong(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase();
}

/**
 * Động từ SINH MÃ. Cố ý KHÔNG có "doc"/"liet ke"/"grep"/"xem" — đó là các câu ĐỌC TƯỜNG MINH mà
 * đường nhanh (dump) đang phục vụ đúng, và bản vá này không được phép làm chúng chậm đi.
 */
const DONG_TU_VI =
  /(^|[^a-z])(viet|tao|sinh|cai dat|hien thuc|trien khai|refactor|tai cau truc|toi uu lai|chuyen doi|bo sung|them)([^a-z]|$)/;
const DONG_TU_EN =
  /(^|[^a-z])(write|create|implement|generate|refactor|rewrite|scaffold|add)([^a-z]|$)/i;
const DONG_TU_ZH = /(写|編写|编写|创建|实现|生成|重构|改写)/;

/**
 * Hiện vật MÃ — dùng làm vế XÁC NHẬN cho các động từ mơ hồ ("them", "add", "tao" có thể là
 * "thêm một máy vào danh sách"). Động từ RÕ RÀNG ("viet", "implement", "refactor"…) không cần vế này.
 */
const HIEN_VAT_MA =
  /(^|[^a-z])(ham|lop|class|function|method|phuong thuc|component|module|interface|type|struct|enum|hook|service|endpoint|api|unit test|test|script|chuong trinh|thuat toan|regex|query)([^a-z]|$)/;

/** Động từ đủ RÕ để một mình nó đã đòi mã. */
const DONG_TU_RO_VI = /(^|[^a-z])(viet|hien thuc|cai dat|trien khai|refactor|tai cau truc)([^a-z]|$)/;
const DONG_TU_RO_EN = /(^|[^a-z])(write|implement|refactor|rewrite|scaffold)([^a-z]|$)/i;

/**
 * `true` ⇔ câu này yêu cầu SINH RA MÃ (chứ không phải xem/liệt kê nội dung có sẵn).
 * Hàm THUẦN: không env, không giờ, không I/O.
 */
export function laCauSinhMa(question: string): boolean {
  const q = boDauThuong(question);
  // Xin một khối mã là dấu hiệu KHÔNG thể nhầm, bất kể động từ.
  if (/(khoi ma|code block|chi tra ve.*ma|only .*code block)/.test(q)) return true;
  if (DONG_TU_RO_VI.test(q) || DONG_TU_RO_EN.test(q)) return true;
  if (DONG_TU_ZH.test(question)) return true;
  // Động từ mơ hồ ⇒ cần thêm một hiện vật mã trong câu.
  const moHo = DONG_TU_VI.test(q) || DONG_TU_EN.test(q);
  return moHo && HIEN_VAT_MA.test(q);
}
