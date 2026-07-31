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

// Task 6 round 2 (F8, Important — reviewer) — MỌI lời gọi `i18n.t()`/`i18n.exists()`
// trong file này (kể cả lời gọi LỒNG cho `errors.<space>.*`/`errors.reason.*` bên
// dưới) phải truyền CẢ HAI option này, không được thiếu option nào:
//   - `lng: activeLng` — ép tra cứu vào ĐÚNG ngôn ngữ người dùng đang chọn, không
//     để i18next tự suy ra từ `this.language`/`resolvedLanguage` nội bộ (round 1 đã
//     lộ bug đúng ở chỗ dựa vào `resolvedLanguage` — một giá trị i18next TỰ "làm
//     tròn" theo trạng thái nạp bundle, xem lịch sử ở cuối file).
//   - `fallbackLng: false` — CHẶN chuỗi fallback (`fallbackLng: 'vi'` ở
//     `client/src/i18n/index.ts`) CHO RIÊNG lời gọi này. Xác minh bằng đọc thẳng
//     `node_modules/i18next/dist/cjs/i18next.js`, `LanguageUtil.toResolveHierarchy`:
//     `const fallbackCodes = this.getFallbackCodes((fallbackCode === false ? [] :
//     fallbackCode) || this.options.fallbackLng || [], code);` — truyền
//     `fallbackLng: false` khiến `fallbackCodes = []`, nên hierarchy tra cứu (dùng
//     bởi CẢ `t()` lẫn `exists()`, cùng đi qua `Translator.resolve()`) chỉ còn ĐÚNG
//     `activeLng`, không còn đường nào rơi được về `vi`.
// Gộp cả hai, `defaultValue`/SENTINEL kích hoạt ĐÚNG NHƯ THIẾT KẾ GỐC của file này
// (dòng đầu file) mỗi khi khoá không tồn tại Ở ĐÚNG ngôn ngữ đang tra — bất kể lý do
// là "cả bundle chưa nạp" hay "bundle nạp đủ nhưng thiếu đúng khoá đó" (hai lớp con
// của CÙNG một bất biến "thiếu khoá ⇒ fallback", xem lịch sử round 1/2 ở cuối file).
function localizeParams(
  params: Record<string, string | number> | undefined,
  activeLng: string,
) {
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
      //
      // Task 6 round 2 (F8, Important) — `lng`/`fallbackLng: false` BẮT BUỘC ở
      // ĐÚNG lời gọi lồng này: khi khoá `errors.reason.<raw>` chỉ dịch ở `vi`
      // (chưa kịp thêm en/zh), thiếu 2 option này sẽ khiến lời gọi lồng lặng lẽ
      // trả câu CHỈ DẪN TIẾNG VIỆT trong khi câu chính (khung `_WITH_REASON` bên
      // dưới) vẫn đúng tiếng Anh — ca "câu chính đúng, phần lý do lồng sai ngôn
      // ngữ" mà reviewer round 2 chỉ đích danh. `defaultValue: raw` GIỮ NGUYÊN
      // (không đổi) — không liên quan SENTINEL, đây là quy tắc "hiện thô khoá
      // camelCase khi chưa dịch" đã có từ trước Task 5/6, không phải cùng bất
      // biến "thiếu khoá appCode ⇒ fallback máy chủ".
      out[key] = i18n.t(`errors.${space}.${raw}`, {
        ...sanitized,
        lng: activeLng,
        fallbackLng: false,
        defaultValue: raw,
      });
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

  // ── Lịch sử 2 vòng sửa F8 (doc71 Task 6) — đọc để hiểu VÌ SAO cơ chế dưới đây
  // được chọn, không phải chỉ để biết NÓ LÀM GÌ ──
  //
  // Round 1: bug hồi quy do di trú — en/zh nạp bundle bằng `import()` ĐỘNG
  // (client/src/i18n/index.ts), dự án cấu hình `fallbackLng: 'vi'`. Trong cửa sổ
  // chờ nạp (hoặc chunk lỗi vĩnh viễn — offline), gọi `i18n.t()` như bình thường
  // sẽ rơi về `vi` (đã nạp trước qua `loadVi()`) TRƯỚC KHI chạm SENTINEL — trả
  // nguyên CÂU TIẾNG VIỆT cho người dùng en/zh. Bản vá round-1 ĐẦU TIÊN (một
  // phiên trước) thêm cổng `if (!i18n.hasResourceBundle(activeLng, NS))
  // return fallback` — nhưng đọc `i18n.resolvedLanguage` để suy ra `activeLng`,
  // và `resolvedLanguage` tự "làm tròn" về `vi` ngay tại thời điểm
  // `changeLanguage()` khi bundle đích chưa nạp (đọc thẳng
  // `node_modules/i18next/dist/cjs/i18next.js`, `setResolvedLanguage()`) — gate
  // luôn thấy `hasResourceBundle('vi', NS) === true`, không bao giờ kích hoạt.
  // Sửa: đổi sang đọc `i18n.language` (ngôn ngữ NGƯỜI DÙNG thật sự chọn, không bị
  // ảnh hưởng bởi trạng thái nạp bundle — khớp với `this.language` mà
  // `Translator.resolve()` dùng để tra cứu thật).
  //
  // Round 2 (Important — reviewer): cổng `hasResourceBundle` ở round 1 chỉ trả
  // lời "ngôn ngữ này có bundle nạp CHƯA" (đúng/sai TOÀN CỤC), không trả lời
  // "khoá `errors.<appCode>` NÀY có tồn tại trong bundle đó không" (đúng/sai TỪNG
  // KHOÁ). Bundle `en` nạp ĐẦY ĐỦ (hàng nghìn khoá khác) mà vẫn thiếu ĐÚNG một
  // khoá `errors.<appCode>` (mã lỗi mới, chỉ kịp dịch ở `vi`) ⇒
  // `hasResourceBundle('en', NS)` vẫn `true`, gate cho đi qua, rồi `i18n.t()`
  // lại rơi về `vi` qua `fallbackLng` — CÙNG lớp lỗi F8, khác cơ chế kích hoạt.
  // Sửa TẬN GỐC (không vá thêm lớp thứ 3): bỏ hẳn cổng `hasResourceBundle` — nó
  // chỉ là một trường hợp CON của vấn đề tổng quát hơn ("khoá này tồn tại Ở ĐÚNG
  // activeLng, không qua fallback, hay không" — khi bundle rỗng hoàn toàn thì
  // MỌI khoá trong đó dĩ nhiên cũng "không tồn tại", nên cùng cơ chế chặn-
  // fallback-tại-lời-gọi-t() bắt được CẢ hai lớp bằng ĐÚNG MỘT cơ chế, không cần
  // 2 tầng kiểm tra riêng biệt dễ lệch nhau — bài học trực tiếp từ chính bug
  // `resolvedLanguage` ở round 1). Chặn tại nguồn: mọi lời gọi `i18n.t()` dưới
  // đây (VÀ lời gọi lồng trong `localizeParams` ở trên) đều truyền
  // `{ lng: activeLng, fallbackLng: false }` — SENTINEL kích hoạt ĐÚNG NHƯ THIẾT
  // KẾ BAN ĐẦU của file này (dòng đầu file) bất kể lý do thiếu khoá là gì.
  const activeLng = (i18n.language || "vi").split("-")[0];

  const localizedParams = localizeParams(params, activeLng);

  // Task 5 (doc 71) — CÁCH CHỌN KHOÁ: i18next KHÔNG có "chỉ nội suy nếu tham số tồn
  // tại". Nếu ta thêm thẳng {{reason}} vào khoá OPERATION_FAILED/INVALID_VALUE/
  // PERMISSION_DENIED HIỆN CÓ thì mọi lời gọi appError() cũ (không truyền `reason`
  // — tuyệt đại đa số call site hôm nay) sẽ hiện chuỗi rỗng hoặc "{{reason}}" chưa
  // thay — một hồi quy TỆ HƠN hiện trạng. Nên: khoá gốc `errors.${appCode}` GIỮ
  // NGUYÊN VĂN, không đổi; thêm khoá SONG SONG `errors.${appCode}_WITH_REASON` có
  // {{reason}}. `params.reason` là chuỗi không rỗng ⇒ thử khoá `_WITH_REASON` TRƯỚC.
  //
  // ⚠ ĐÃ LỖI THỜI (giữ lại có chủ đích để không lặp lại sai lầm) — comment gốc của
  // Task 5/round-1 review từng nói: "khoá `_WITH_REASON` thiếu ở en/zh nhưng có ở vi
  // ⇒ i18next tự rơi về BẢN VI qua fallbackLng, người dùng vẫn đọc được câu (bằng
  // tiếng Việt) — hành vi đó được xem là AN TOÀN HƠN, một lưới an toàn phụ." Round 2
  // xác định đó CHÍNH LÀ một thực thể khác của bug F8 (câu tiếng Việt lọt ra cho
  // người dùng en/zh), không phải "an toàn hơn". `fallbackLng: false` bên dưới cố ý
  // TẮT hẳn lưới an toàn phụ đó — khi `_WITH_REASON` thiếu ở activeLng, SENTINEL
  // kích hoạt ngay, rơi tiếp về khoá gốc `errors.${appCode}` CÙNG activeLng (không
  // còn cửa nào rơi sang vi) — khoá gốc hôm nay đã parity 3 locale (xem cổng key-
  // parity mới ở `appErrorParamsCoverage.test.ts`) nên vẫn ra câu ĐÚNG NGÔN NGỮ,
  // chỉ mất phần reason — đúng bất biến "thiếu khoá ⇒ fallback nhẹ hơn, không đổi
  // ngôn ngữ" của cả file.
  //
  // Không có `_WITH_REASON` cho appCode này ở activeLng ⇒ lặng lẽ rơi tiếp về khoá
  // gốc — cùng bất biến "thiếu khoá ⇒ fallback, không sập" của cả file, chỉ khác ở
  // chỗ nấc "fallback" đầu tiên là khoá gốc CÙNG NGÔN NGỮ (mất phần reason, câu vẫn
  // đúng ngữ pháp, đúng ngôn ngữ) trước khi mất luôn cả câu về `fallbackMessage`
  // (tiếng Anh máy chủ, nấc cuối).
  const hasReason = typeof params?.reason === "string" && params.reason.trim().length > 0;
  if (hasReason) {
    const withReasonTranslated = i18n.t(`errors.${appCode}_WITH_REASON`, {
      ...localizedParams,
      lng: activeLng,
      fallbackLng: false,
      defaultValue: SENTINEL,
    });
    if (typeof withReasonTranslated === "string" && withReasonTranslated !== SENTINEL) {
      return withReasonTranslated;
    }
  }

  const translated = i18n.t(`errors.${appCode}`, {
    ...localizedParams,
    lng: activeLng,
    fallbackLng: false,
    defaultValue: SENTINEL,
  });
  if (typeof translated !== "string" || translated === SENTINEL) return fallback;
  return translated;
}
