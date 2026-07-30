/**
 * Sprint 5 §4.3 — dịch mã lỗi máy chủ sang câu người đọc.
 *
 * Quy tắc BẤT BIẾN: thiếu khoá i18n ⇒ trả `fallback` (message máy chủ), TUYỆT
 * ĐỐI không hiện mã trần cho người dùng. Nhờ vậy client cũ + server mới, hoặc
 * mã vừa thêm mà chưa kịp dịch, đều không bao giờ tệ hơn hôm nay.
 */
import i18n from "i18next";

/** Sprint 5 §4.3 fix round 2 — mỗi tham số tự-do (không phải token kỹ thuật kiểu
 *  {{ext}}/{{url}}/{{limitMb}}) phải đi qua từ điển riêng của nó trước khi nội
 *  suy, giống hệt `entity`, nếu không câu sẽ tái phát bệnh `{{reason}}` mà Task 3
 *  từng sửa: người dùng en/zh đọc nguyên văn tiếng Việt (hoặc ngược lại) do server
 *  chỉ có MỘT chuỗi cho mọi ngôn ngữ. Mỗi khoá dưới đây có KHÔNG GIAN TỪ ĐIỂN
 *  riêng (`errors.<space>.*`) vì cùng một chữ có thể mang nghĩa khác nhau ở
 *  entity vs operation (vd "recipe" là thực thể, không phải hành động).
 *  Không đổi field-value → dùng nguyên văn (defaultValue) khi chưa có bản dịch —
 *  KHÔNG BAO GIỜ sập vì thiếu khoá, chỉ hiện thô (khoá camelCase) như trước nay. */
const PARAM_DICTIONARY_SPACE: Record<string, string> = {
  entity: "entity",
  parent: "entity",
  operation: "operation",
  field: "field",
  feature: "feature",
  action: "action",
};

function localizeParams(params: Record<string, string | number> | undefined) {
  if (!params) return undefined;
  const out: Record<string, string | number> = { ...params };
  for (const [key, space] of Object.entries(PARAM_DICTIONARY_SPACE)) {
    const raw = out[key];
    if (typeof raw === "string") {
      // defaultValue = chính nó ⇒ giá trị chưa có trong từ điển hiện nguyên văn.
      out[key] = i18n.t(`errors.${space}.${raw}`, { defaultValue: raw });
    }
  }
  return out;
}

export function translateAppError(
  appCode: string,
  params: Record<string, string | number> | undefined,
  fallback: string,
): string {
  const key = `errors.${appCode}`;
  // Sentinel: i18next trả về chính defaultValue khi khoá không tồn tại.
  const SENTINEL = " __missing__";
  const translated = i18n.t(key, { ...localizeParams(params), defaultValue: SENTINEL });
  if (typeof translated !== "string" || translated === SENTINEL) return fallback;
  return translated;
}
