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
  // Sprint 5 doc 71 Task 5 (F4) — không gian MỚI: chỉ dẫn hành động (nguyên nhân cụ
  // thể / bước tiếp theo) mà trước đây chỉ nằm trong `fallbackMessage` tiếng Việt
  // viết tay, mất hẳn khi router đã di trú sang appError() + câu i18n chuẩn (câu
  // chuẩn chỉ có {{operation}}/{{field}}, không có chỗ cho chi tiết). Khác 6 tham số
  // trên (đều là DANH TỪ enum cố định), `reason` là một CÂU/CỤM chỉ dẫn — xem
  // translateAppError() bên dưới để biết khi nào nó được nội suy.
  reason: "reason",
};

function localizeParams(params: Record<string, string | number> | undefined) {
  if (!params) return undefined;
  const out: Record<string, string | number> = { ...params };
  for (const [key, space] of Object.entries(PARAM_DICTIONARY_SPACE)) {
    const raw = out[key];
    if (typeof raw === "string") {
      // Task 5 (doc 71) — NỘI SUY LỒNG: một số khoá `errors.reason.*` tự mang
      // placeholder RIÊNG của nó (vd `errors.reason.insufficientCpkSamples` có
      // {{sampleCount}}/{{minSamples}} — số liệu động router truyền kèm `reason`,
      // không đi qua từ điển vì không phải danh từ enum). Trước đây lời gọi lồng
      // này chỉ truyền `{ defaultValue }`, nên placeholder con sẽ hiện THÔ
      // "{{sampleCount}}" thay vì con số thật — bug `{{reason}}` mà Task 3 từng sửa
      // tái phát ở cấp lồng. Truyền CẢ `params` GỐC (không phải `out` đang dở dang,
      // để tránh phụ thuộc thứ tự Object.entries ở trên) làm ngữ cảnh nội suy cho
      // lời gọi lồng — an toàn cho entity/operation/field/feature/action vì các mục
      // đó là chuỗi thô không có placeholder nào để bị ảnh hưởng.
      out[key] = i18n.t(`errors.${space}.${raw}`, { ...params, defaultValue: raw });
    }
  }
  return out;
}

export function translateAppError(
  appCode: string,
  params: Record<string, string | number> | undefined,
  fallback: string,
): string {
  // Sentinel: i18next trả về chính defaultValue khi khoá không tồn tại.
  const SENTINEL = " __missing__";
  const localizedParams = localizeParams(params);

  // Task 5 (doc 71) — CÁCH CHỌN KHOÁ: i18next KHÔNG có "chỉ nội suy nếu tham số tồn
  // tại". Nếu ta thêm thẳng {{reason}} vào khoá OPERATION_FAILED/INVALID_VALUE/
  // PERMISSION_DENIED HIỆN CÓ thì mọi lời gọi appError() cũ (không truyền `reason`
  // — tuyệt đại đa số call site hôm nay) sẽ hiện chuỗi rỗng hoặc "{{reason}}" chưa
  // thay — một hồi quy TỆ HƠN hiện trạng. Nên: khoá gốc `errors.${appCode}` GIỮ
  // NGUYÊN VĂN, không đổi; thêm khoá SONG SONG `errors.${appCode}_WITH_REASON` có
  // {{reason}}. `params.reason` là chuỗi không rỗng ⇒ thử khoá `_WITH_REASON`
  // TRƯỚC; nếu khoá đó CHƯA được định nghĩa cho appCode này (i18next rơi về
  // SENTINEL, vd một appCode chưa có bản `_WITH_REASON`) thì lặng lẽ rơi tiếp về
  // khoá gốc — cùng bất biến "thiếu khoá ⇒ fallback, không sập" của cả file, chỉ
  // khác ở chỗ "fallback" đầu tiên là khoá gốc (mất phần reason, câu vẫn đúng ngữ
  // pháp) trước khi mất luôn cả câu về `fallbackMessage`.
  const hasReason = typeof params?.reason === "string" && params.reason.trim().length > 0;
  if (hasReason) {
    const withReasonTranslated = i18n.t(`errors.${appCode}_WITH_REASON`, {
      ...localizedParams,
      defaultValue: SENTINEL,
    });
    if (typeof withReasonTranslated === "string" && withReasonTranslated !== SENTINEL) {
      return withReasonTranslated;
    }
  }

  const translated = i18n.t(`errors.${appCode}`, { ...localizedParams, defaultValue: SENTINEL });
  if (typeof translated !== "string" || translated === SENTINEL) return fallback;
  return translated;
}
