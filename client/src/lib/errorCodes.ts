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

/** Review round 1 (M-2) — reviewer dựng harness i18next THẬT tái hiện: khi một
 *  giá trị TỰ DO (không phải 1 trong 7 khoá từ điển ở trên — vd `lineName`,
 *  `productCode`, `validRoles`, do người dùng/admin đặt tên) tình cờ CHỨA cú
 *  pháp interpolation/nesting của i18next (`{{...}}` hoặc `$t(...)`), template
 *  nhiều-placeholder có thể lòi placeholder THẬT ra màn hình thô (vd
 *  `lineName = "{{maxConcurrent}}"` ⇒ "...chỉ hỗ trợ tối đa {{maxConcurrent}}
 *  lệnh..." không được thay số — placeholder thật bị "cướp chỗ"/không thay).
 *  KHÔNG phải lỗ injection (`skipOnVariables` đã chặn `$t()` chạy nesting từ
 *  biến, React tự escape HTML) — nhưng ĐÚNG lớp lỗi "hiện `{{}}` thô cho người
 *  dùng" mà cả file này tồn tại để diệt, nên vẫn phải chặn. Strip (loại bỏ)
 *  `{{` và `$t(` khỏi MỌI giá trị chuỗi KHÔNG phải khoá từ điển, trước khi giá
 *  trị đó được dùng ở BẤT KỲ lời gọi i18n.t nào (kể cả lời gọi lồng cho `reason`
 *  bên dưới — nếu chỉ làm sạch ở `out` cuối cùng mà không làm sạch trước khi
 *  truyền vào lời gọi lồng thì lỗ hổng vẫn còn nguyên ở đó). */
function sanitizeFreeParams(
  params: Record<string, string | number>,
): Record<string, string | number> {
  const dictKeys = new Set(Object.keys(PARAM_DICTIONARY_SPACE));
  const out: Record<string, string | number> = { ...params };
  for (const [key, value] of Object.entries(out)) {
    if (dictKeys.has(key)) continue; // khoá từ điển: xử lý riêng (dùng làm khoá tra, không hiện thẳng)
    if (typeof value === "string") {
      out[key] = value.replace(/\{\{/g, "").replace(/\$t\(/g, "");
    }
  }
  return out;
}

function localizeParams(params: Record<string, string | number> | undefined) {
  if (!params) return undefined;
  const sanitized = sanitizeFreeParams(params);
  const out: Record<string, string | number> = { ...sanitized };
  for (const [key, space] of Object.entries(PARAM_DICTIONARY_SPACE)) {
    const raw = out[key];
    if (typeof raw === "string") {
      // Task 5 (doc 71) — NỘI SUY LỒNG: một số khoá `errors.reason.*` tự mang
      // placeholder RIÊNG của nó (vd `errors.reason.insufficientCpkSamples` có
      // {{sampleCount}}/{{minSamples}} — số liệu động router truyền kèm `reason`,
      // không đi qua từ điển vì không phải danh từ enum). Trước đây lời gọi lồng
      // này chỉ truyền `{ defaultValue }`, nên placeholder con sẽ hiện THÔ
      // "{{sampleCount}}" thay vì con số thật — bug `{{reason}}` mà Task 3 từng sửa
      // tái phát ở cấp lồng. Truyền `sanitized` (params gốc ĐÃ làm sạch theo M-2 ở
      // trên, không phải `out` đang dở dang, để tránh phụ thuộc thứ tự
      // Object.entries ở trên) làm ngữ cảnh nội suy cho lời gọi lồng — an toàn cho
      // entity/operation/field/feature/action vì các mục đó là chuỗi thô không có
      // placeholder nào để bị ảnh hưởng.
      out[key] = i18n.t(`errors.${space}.${raw}`, { ...sanitized, defaultValue: raw });
    }
  }
  return out;
}

// Sprint 5 doc71 Task 6 (F8) — namespace DUY NHẤT dự án dùng (xem `defaultNS:
// 'translation'` ở client/src/i18n/index.ts; mọi addResourceBundle trong repo
// đều truyền 'translation'). Đọc từ i18n/index.ts, không đoán.
const NS = "translation";

export function translateAppError(
  appCode: string,
  params: Record<string, string | number> | undefined,
  fallback: string,
): string {
  // Sentinel: i18next trả về chính defaultValue khi khoá không tồn tại.
  const SENTINEL = " __missing__";

  // Task 6 (F8) — hồi quy do di trú: en/zh nạp bundle bằng `import()` ĐỘNG
  // (client/src/i18n/index.ts, `ensureLocale`/`lazyLocales`), và dự án cấu
  // hình `fallbackLng: 'vi'`. Trong cửa sổ chờ nạp (hoặc khi chunk lỗi vĩnh
  // viễn — mạng chập/offline), bundle 'translation' của NGÔN NGỮ ĐANG HOẠT
  // ĐỘNG chưa tồn tại. Nếu cứ gọi i18n.t() như bình thường, i18next rơi về
  // fallbackLng 'vi' (đã nạp từ trước qua loadVi(), main.tsx gate render trên
  // i18nReady) TRƯỚC KHI chạm SENTINEL/defaultValue của ta — trả nguyên CÂU
  // TIẾNG VIỆT cho người dùng đã chọn en/zh (vd "Không tìm thấy sản phẩm."
  // thay vì "Could not find product."). Mở rộng bất biến đã có của file này
  // ("thiếu KHOÁ ⇒ fallback") thành "thiếu BUNDLE ⇒ fallback": kiểm
  // hasResourceBundle TRƯỚC khi gọi t() lần nào.
  //
  // ⚠ ĐÍNH CHÍNH bản vá dở của phiên trước (bug khiến 3 test đỏ) — SAI CHỖ
  // NÀO: bản cũ đọc `i18n.resolvedLanguage` để suy ra "ngôn ngữ đang hoạt
  // động". Đọc thẳng mã nguồn i18next (node_modules/i18next/dist/cjs/i18next.js,
  // hàm `changeLanguage` → `setResolvedLanguage`): MỖI LẦN `changeLanguage()`
  // chạy, `resolvedLanguage` tự đi qua `this.languages` (chuỗi hierarchy, vd
  // ['en','vi']) và CHỐT vào ngôn ngữ ĐẦU TIÊN đã có `hasLanguageSomeTranslations`
  // — nếu bundle 'en' CHƯA nạp nhưng 'vi' đã nạp (đúng tình huống ta đang mô
  // phỏng), `resolvedLanguage` tự rơi về 'vi' NGAY TẠI THỜI ĐIỂM changeLanguage,
  // TRƯỚC KHI hàm này kịp kiểm tra gì cả — gate cũ đọc phải giá trị đã-rơi-về-vi
  // đó nên `hasResourceBundle('vi', NS)` luôn true, gate không bao giờ kích
  // hoạt, y hệt bug ban đầu (chỉ vòng qua một lớp gián tiếp). Ngược lại, việc
  // TRA CỨU thật của i18next (`Translator.resolve`, cùng file, dùng
  // `this.language` — KHÔNG phải `resolvedLanguage` — làm gốc cho
  // `toResolveHierarchy`) luôn theo `i18n.language`, tức ngôn ngữ NGƯỜI DÙNG
  // THẬT SỰ chọn, không bị "làm tròn" theo trạng thái nạp bundle. Vậy gate ở
  // đây phải soi đúng cùng nguồn `i18n.language` mà tra cứu thật sẽ dùng, không
  // phải bản đã-fallback-sẵn `resolvedLanguage`. Khi active lng chính là 'vi'
  // hoặc bundle của lng đó đã nạp xong, nhánh này không đổi hành vi hiện có.
  const activeLng = (i18n.language || "vi").split("-")[0];
  if (!i18n.hasResourceBundle(activeLng, NS)) {
    return fallback;
  }

  const localizedParams = localizeParams(params);

  // Task 5 (doc 71) — CÁCH CHỌN KHOÁ: i18next KHÔNG có "chỉ nội suy nếu tham số tồn
  // tại". Nếu ta thêm thẳng {{reason}} vào khoá OPERATION_FAILED/INVALID_VALUE/
  // PERMISSION_DENIED HIỆN CÓ thì mọi lời gọi appError() cũ (không truyền `reason`
  // — tuyệt đại đa số call site hôm nay) sẽ hiện chuỗi rỗng hoặc "{{reason}}" chưa
  // thay — một hồi quy TỆ HƠN hiện trạng. Nên: khoá gốc `errors.${appCode}` GIỮ
  // NGUYÊN VĂN, không đổi; thêm khoá SONG SONG `errors.${appCode}_WITH_REASON` có
  // {{reason}}. `params.reason` là chuỗi không rỗng ⇒ thử khoá `_WITH_REASON` TRƯỚC.
  //
  // Review round 1 (M-1) — ĐÍNH CHÍNH cơ chế rơi-về-SENTINEL: dự án cấu hình
  // `fallbackLng: 'vi'` (client/src/i18n/index.ts). Do đó nếu khoá `_WITH_REASON`
  // CÓ tồn tại ở vi nhưng THIẾU ở en/zh, i18next tự rơi về BẢN VI (qua fallbackLng)
  // TRƯỚC khi chạm tới `defaultValue`/SENTINEL của ta — tức người dùng en/zh vẫn
  // đọc được câu (bằng tiếng Việt, không phải khoá gốc, không phải chuỗi rỗng).
  // SENTINEL/rơi-về-khoá-gốc bên dưới CHỈ thật sự kích hoạt khi khoá
  // `_WITH_REASON` vắng mặt Ở CẢ vi (tức appCode đó CHƯA TỪNG có bản `_WITH_REASON`
  // nào — đúng trường hợp ta cố ý chừa cho các appCode chưa migrate). Hành vi thật
  // AN TOÀN HƠN mô tả cũ (an toàn ở 2 lớp: fallbackLng rồi mới tới khoá gốc), nhưng
  // vẫn giữ nhánh SENTINEL dưới đây làm lưới an toàn cuối cho đúng ca đó.
  //
  // Không có `_WITH_REASON` cho appCode này ở BẤT KỲ locale nào ⇒ lặng lẽ rơi tiếp
  // về khoá gốc — cùng bất biến "thiếu khoá ⇒ fallback, không sập" của cả file, chỉ
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
