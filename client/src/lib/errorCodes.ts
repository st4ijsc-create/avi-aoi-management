/**
 * Sprint 5 §4.3 — dịch mã lỗi máy chủ sang câu người đọc.
 *
 * Quy tắc BẤT BIẾN: thiếu khoá i18n ⇒ trả `fallback` (message máy chủ), TUYỆT
 * ĐỐI không hiện mã trần cho người dùng. Nhờ vậy client cũ + server mới, hoặc
 * mã vừa thêm mà chưa kịp dịch, đều không bao giờ tệ hơn hôm nay.
 */
import i18n from "i18next";

/** Thực thể trong `params.entity` được dịch qua `errors.entity.*` trước khi nội
 *  suy, để "Không tìm thấy sản phẩm" chứ không phải "Không tìm thấy product". */
function localizeParams(params: Record<string, string | number> | undefined) {
  if (!params) return undefined;
  const out: Record<string, string | number> = { ...params };
  for (const key of ["entity", "parent"]) {
    const raw = out[key];
    if (typeof raw === "string") {
      // defaultValue = chính nó ⇒ thực thể chưa có trong từ điển hiện nguyên văn.
      out[key] = i18n.t(`errors.entity.${raw}`, { defaultValue: raw });
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
