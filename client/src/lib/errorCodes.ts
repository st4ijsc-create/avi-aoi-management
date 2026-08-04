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
 *  Không đổi field-value → hiện nguyên văn khi chưa có bản dịch — KHÔNG BAO GIỜ sập
 *  vì thiếu khoá, chỉ hiện thô (khoá camelCase) như trước nay.
 *  ⚠ ĐÍNH CHÍNH (C-1, Pha 2B Task 4 vòng sửa 1): cơ chế "hiện nguyên văn" trước đây
 *  làm bằng `defaultValue: raw` — nay KHÔNG còn, vì `defaultValue` là một TEMPLATE
 *  và đó chính là bề mặt tiêm. Hành vi giữ y nguyên; đường đi đổi (SENTINEL rồi trả
 *  `raw` thẳng, không cho nó chạm bộ diễn giải). Xem `localizeParams`. */
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
  // Pha 2B Task 4 (§5.3 — từ chối trung thực VRAM) — không gian MỚI `errors.list.*`,
  // cho những tham số là DANH SÁCH ĐỘNG có thể RỖNG (`holders` = ai đang giữ VRAM,
  // `preemptable` = ai có thể nhường). Hai tính chất, và chính chỗ giao nhau của
  // chúng là lý do phải có không gian riêng:
  //   • giá trị THẬT là chuỗi tự do do máy chủ ghép ("gguf-model:x=17000 MiB
  //     (production), …") — không có khoá dịch nào, nên nó hiện NGUYÊN VĂN, đúng
  //     như 6 khoá trên khi chưa dịch (qua SENTINEL, KHÔNG qua `defaultValue` —
  //     xem C-1 ở `stripInterpolationSyntax`/`localizeParams`);
  //   • giá trị RỖNG lại là một Ý NGHĨA phải dịch: máy chủ gửi khoá `"none"` ⇒
  //     `errors.list.none` ⇒ "không có"/"none"/"无". Nếu để chuỗi rỗng đi thẳng vào
  //     câu, người vận hành đọc "Có thể nhường: ." và tự điền nghĩa — đúng lớp lỗi
  //     "câu lỗi hứa/nói mập mờ hơn dữ liệu" mà §5.3 tồn tại để diệt.
  // ⚠ Hai tên tham số, MỘT không gian — cùng khuôn `entity`/`parent` ở trên.
  holders: "list",
  preemptable: "list",
  // Pha 2B Task 4 vòng sửa 1 (I-3) — không gian `errors.trust.*`: HAI khoá,
  // `trusted` (chuỗi RỖNG) và `degraded` (câu hạ giọng, tự mang `{{degradedReasons}}`).
  // i18next KHÔNG có "chỉ nội suy nếu có tham số", nên đây là cách duy nhất trong
  // khuôn hiện có để một câu i18n mang được lời hạ giọng CÓ ĐIỀU KIỆN. Trước bản vá
  // này, `{{degraded}}` được truyền nhưng KHÔNG khuôn `VRAM_REFUSED*` nào dùng ⇒ người
  // vận hành đọc "còn 1200 MiB" như một số CỨNG đúng lúc hệ tự khai nó KÉM TIN.
  trust: "trust",
};

/**
 * ★★★ C-1 (review vòng 1, Pha 2B Task 4) — ĐÓNG **LỚP**, KHÔNG VÁ THÊM MẪU.
 *
 * Bản trước làm sạch bằng **thay thế MẪU** (`{{` → ``, `$t(` → ``). Reviewer chạy
 * **3/3 biến thể tự huỷ đều SỐNG**, vì một lượt quét thay-thế **không quét lại**:
 *
 * | Vào | Sau "làm sạch" | Hậu quả |
 * |---|---|---|
 * | `{$t({availableMb}}`                     | `{{availableMb}}`  | cướp placeholder thật ⇒ in `1200` |
 * | `$$t(t(errors.generic)`                  | `$t(errors.generic)` | nối nội dung khoá i18n bất kỳ |
 * | `$$t(t(errors.VRAM_REFUSED_WITH_REASON)` | tự tham chiếu       | **`i18n.t()` KHÔNG TRẢ VỀ** — treo tiến trình > 8 phút |
 *
 * Biến thể thứ ba là **một đường TREO TIẾN TRÌNH**, không chỉ hiển thị sai. Và bề mặt
 * là THẬT, không lý thuyết: `gguf:${modelId}` / `reranker:${modelPath}`
 * (`aiGgufEngine.ts:950,986,1168,1680,3035`; `aiReranker.ts:472,523`) ⇐ id model trong
 * DB, `.env`, tên tệp `.gguf`.
 *
 * ⇒ Cách chữa **theo cấu trúc**, không theo mẫu: **xoá cả một LỚP KÝ TỰ**. Mọi cú pháp
 * mà i18next nhận diện — `{{…}}` (nội suy), `}}`, `$t(…)` (lồng khoá) — đều **bắt buộc**
 * chứa ít nhất một trong ba ký tự `{`, `}`, `$`. Xoá sạch ba ký tự đó thì:
 *   • **KHÔNG cú pháp nào còn dựng được** — không phải "chưa gặp mẫu nào", mà là không
 *     tồn tại đường dựng;
 *   • phép làm sạch **BẤT ĐỘNG** (`S(S(x)) === S(x)`): kết quả không còn ký tự nào để
 *     lượt sau bắt được ⇒ **payload tự huỷ mất hẳn cơ chế**. Đây chính là tính chất mà
 *     review đòi phải có ca kiểm riêng, và nó được kiểm TRỰC TIẾP trên hàm này.
 * Giá phải trả: một tên chủ sở hữu có `{`/`}`/`$` sẽ mất đúng mấy ký tự đó. Đổi lại là
 * đóng một đường **treo tiến trình** — không có phép cân nào khác.
 *
 * ⚠ CỐ Ý export: ca kiểm biến thể tự-tham-chiếu phải chứng minh **TIỀN ĐIỀU KIỆN**
 * (chuỗi đã sạch ba ký tự) **TRƯỚC KHI** render. Một vòng lặp/đệ quy ĐỒNG BỘ trong
 * `i18n.t()` thì `timeout` của vitest **không cắt được** — nó chỉ treo runner. Kiểm hàm
 * thuần trước, render sau, là cách duy nhất chạy được biến thể đó mà không treo.
 */
export function stripInterpolationSyntax(value: string): string {
  return value.replace(/[{}$]/g, "");
}

/** Review round 1 (M-2) — reviewer dựng harness i18next THẬT tái hiện: khi một
 *  giá trị TỰ DO (không phải 1 trong 7 khoá từ điển ở trên — vd `lineName`,
 *  `productCode`, `validRoles`, do người dùng/admin đặt tên) tình cờ CHỨA cú
 *  pháp interpolation/nesting của i18next (`{{...}}` hoặc `$t(...)`), template
 *  nhiều-placeholder có thể lòi placeholder THẬT ra màn hình thô (vd
 *  `lineName = "{{maxConcurrent}}"` ⇒ "...chỉ hỗ trợ tối đa {{maxConcurrent}}
 *  lệnh..." không được thay số — placeholder thật bị "cướp chỗ"/không thay).
 *  ⚠⚠ HAI ĐÍNH CHÍNH ĐO ĐƯỢC (Pha 2B Task 4 + vòng sửa 1) cho khối M-2 gốc:
 *
 *  (1) Câu *"KHÔNG phải lỗ injection — `skipOnVariables` đã chặn `$t()` chạy
 *      nesting từ biến"* ĐÚNG cho tham số **TỰ DO** (giá trị đi vào chỗ nội suy)
 *      nhưng **SAI cho khoá TỪ ĐIỂN**: `raw` từng được truyền làm `defaultValue`,
 *      tức nó là **TEMPLATE** (chuỗi `res` đi vào `extendTranslation()`), và
 *      `skipOnVariables` không phủ template. Reviewer chạy đối chứng: cùng payload
 *      đặt ở `owner` (tự do) thì nesting TẮT; đặt ở `holders` (từ điển) thì nesting
 *      CHẠY. ⇒ Với khoá từ điển, đây ĐÚNG là một lỗ nội suy.
 *      Đóng bằng **hai lớp độc lập** (đọc `stripInterpolationSyntax` ở trên và
 *      `localizeParams` bên dưới): dữ liệu **không bao giờ** còn nằm trong
 *      `defaultValue`, VÀ không bao giờ còn chứa ký tự dựng được cú pháp.
 *
 *  (2) Phép "làm sạch theo MẪU" của cả M-2 lẫn bản vá đầu của Task 4 **không đóng
 *      được LỚP** — payload TỰ HUỶ tái tạo cú pháp SAU khi đã quét (3/3 biến thể
 *      sống, một biến thể treo tiến trình > 8 phút). Nay là **xoá LỚP KÝ TỰ**,
 *      bất động, áp cho **MỌI** giá trị chuỗi — tự do LẪN khoá từ điển (khoá từ
 *      điển cũng hiện thẳng ra màn hình khi chưa có bản dịch, nên vế *"dùng làm
 *      khoá tra, không hiện thẳng"* của bản gốc là SAI). */
function sanitizeAllParams(
  params: Record<string, string | number>,
): Record<string, string | number> {
  const out: Record<string, string | number> = { ...params };
  for (const [key, value] of Object.entries(out)) {
    if (typeof value === "string") out[key] = stripInterpolationSyntax(value);
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
  const sanitized = sanitizeAllParams(params);
  const out: Record<string, string | number> = { ...sanitized };
  // C-1 lớp 1 — SENTINEL RIÊNG cho lời gọi lồng: `raw` (dữ liệu) KHÔNG BAO GIỜ được
  // truyền làm `defaultValue` nữa. `defaultValue` là chuỗi `res` đi vào
  // `extendTranslation()`, tức một TEMPLATE — đó chính là bề mặt mà lỗ tiêm đi qua.
  // Nay khoá thiếu ⇒ i18next trả SENTINEL ⇒ ta trả `raw` NGUYÊN VĂN, không cho nó
  // chạm bộ diễn giải một lần nào. Hành vi với 6 khoá enum cũ không đổi (chúng là
  // camelCase, không có gì để nội suy) — ca test khoá lại điều đó.
  const DICT_SENTINEL = " __missing_dict__";
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
      // ngữ" mà reviewer round 2 chỉ đích danh.
      //
      // ⚠ C-1 (vòng sửa 1) — `defaultValue` nay là SENTINEL, KHÔNG phải `raw`. Quy
      // tắc "hiện thô khoá camelCase khi chưa dịch" GIỮ NGUYÊN về hành vi (dòng dưới
      // trả đúng `raw`), chỉ khác ở chỗ `raw` không còn đi qua bộ diễn giải.
      const translated = i18n.t(`errors.${space}.${raw}`, {
        ...sanitized,
        lng: activeLng,
        fallbackLng: false,
        defaultValue: DICT_SENTINEL,
      });
      out[key] = typeof translated === "string" && translated !== DICT_SENTINEL ? translated : raw;
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
