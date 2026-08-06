/**
 * Sprint 5 §4.3 — dịch mã lỗi máy chủ sang câu người đọc.
 *
 * Quy tắc BẤT BIẾN: thiếu khoá i18n ⇒ trả `fallback` (message máy chủ), TUYỆT
 * ĐỐI không hiện mã trần cho người dùng. Nhờ vậy client cũ + server mới, hoặc
 * mã vừa thêm mà chưa kịp dịch, đều không bao giờ tệ hơn hôm nay.
 */
import i18n from "i18next";
/** ★ C-1 (review TOÀN NHÁNH Pha 4) — thân hàm làm sạch ở `shared/` để CẢ `server/` với tới được.
 *  Xem khối docstring dài ở chỗ tái xuất bên dưới. */
import { stripInterpolationSyntax } from "@shared/textSafety";

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
  // Pha 4 Task 3 — hai không gian MỚI cho phần "released" của lệnh `vram.releaseStale`
  // (`server/services/vram/vramCommands.ts`). Cùng khuôn `trust`/`list` ở trên: giá trị
  // là một KHOÁ (kebab-case, đúng literal của `rowKind`/`durability` trong kiểu TS),
  // không phải dữ liệu tự do — tra `errors.vramRowKind.*`/`errors.vramDurability.*`.
  rowKind: "vramRowKind",
  durability: "vramDurability",
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
 *
 * ══════════════════════════════════════════════════════════════════════════════════════
 * ★★★ C-1 (review TOÀN NHÁNH Pha 4) — **THÂN HÀM ĐÃ DỜI XUỐNG `shared/textSafety.ts`.**
 * ══════════════════════════════════════════════════════════════════════════════════════
 * Luật *"mọi giá trị đi vào câu chữ phải qua CÙNG hàm này"* được phát biểu cho CẢ REPO,
 * nhưng cổng canh nó **chỉ quét `client/src`** — nên khi Task 4 dựng một bề mặt câu chữ
 * mới ở `server/services/aiLocalTools/vramTools.ts` (nối `owner` của tiến trình ANH EM
 * thẳng vào **prompt LLM**), hàm này **không với tới được** từ đó: `server/` mà nhập
 * `errorCodes.ts` là kéo cả `i18next` sang. Một bất biến XUYÊN NGANG thì **đóng gói là
 * công cụ sai**. ⇒ Thân hàm ở `@shared/textSafety`; dòng dưới **TÁI XUẤT** nó nên mọi
 * lời gọi/ca kiểm nhập từ `./errorCodes` không đổi một chữ. **KHÔNG viết lại thân hàm ở
 * đây** — đó là bản sao thứ hai, đúng thứ khối trên tồn tại để cấm.
 * ⚠ `import` + `export {}` (KHÔNG phải `export … from`): file này còn **tự dùng** hàm ở
 * `sanitizeAllParams()` và ở tám hàm `translateVram*`, nên nó phải nằm trong phạm vi cục bộ.
 */
export { stripInterpolationSyntax };

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

// ══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ Pha 4 Task 3 — CÂU CHỮ CHO MẶT ĐỌC (`vramReadModel.ts`) + MẶT LỆNH (`vramCommands.ts`)
// ══════════════════════════════════════════════════════════════════════════════════════════════
/**
 * Hai hạng người đọc CÙNG một câu: người vận hành (*"chuyện gì xảy ra, tôi làm gì tiếp"*) và AI
 * Agent (*"lệnh này thi hành được không, và VÌ SAO không"*). Dịch thẳng mã (`owner-not-in-local-
 * ledger` → "chủ sở hữu không có trong sổ cục bộ") là THẤT BẠI: nó lặp lại mã bằng tiếng Việt mà
 * không nói *hộ đó do tiến trình khác giữ, phải ra lệnh ở tiến trình đó* — mọi câu dưới đây viết
 * theo yêu cầu đó, không phải theo kiểu "dịch định danh". Xem `errorCodes.vramCommands.unit.test.ts`
 * cho ca kiểm nội dung (không chỉ "không rỗng").
 *
 * ⚠⚠⚠ KHÔNG HÀM LÀM SẠCH THỨ HAI (ràng buộc 1, Pha 2B trả giá cho lỗi này). Mọi tham số TỰ DO
 * (`owner`/`host`/`leaseKey`/`processKey`) đi vào `translateAppError()` dưới đây qua ĐÚNG con đường
 * đã có: `localizeParams()` → `sanitizeAllParams()` → `stripInterpolationSyntax()` (bất động,
 * `S(S(x)) === S(x)`, xoá cả lớp ký tự `[{}$]`) — không đường thứ hai. Riêng `detail` (bàn giao M-5
 * từ Task 2 — `VramPreemptCommandResult.detail` là "câu thô của người thi hành ... CHƯA LÀM SẠCH
 * cho i18n") KHÔNG đi qua template i18n vì nó chỉ có mặt ở MỘT nhánh của MỘT outcome (không phải
 * một placeholder cố định trong mọi bản dịch); nó được nối SAU câu chính bằng ĐÚNG cùng
 * `stripInterpolationSyntax()` đã export — KHÔNG một hàm cắt/thay-thế nào khác được viết ở đây.
 * ⚠⚠ `owner`/`leaseKey`/`processKey`/`host` KHÔNG BAO GIỜ bị cắt ngắn (ràng buộc 3) — làm sạch chỉ
 * xoá `{`/`}`/`$`, không đụng độ dài; đó là DANH TÍNH Agent truyền thẳng lại vào lệnh kế tiếp.
 *
 * ⚠⚠⚠ ĐÍNH CHÍNH (review vòng 1, I-2) — phát biểu "không đường thứ hai" ở trên **ĐÃ TỪNG SAI** ở
 * NẤC FALLBACK: `translateAppError(appCode, params, fallback)` trả **`fallback` NGUYÊN VĂN** khi
 * khoá thiếu ở `activeLng` (vd bundle en/zh hỏng vĩnh viễn — offline, xem lịch sử F8 dưới
 * `translateAppError`), và `fallback` **KHÔNG** đi qua `localizeParams`/`sanitizeAllParams`. Bản đầu
 * dựng `fallback` bằng \`${r.outcome}: ${r.owner}\` — `owner` THÔ. Nay MỌI chuỗi `fallback` truyền
 * cho `translateAppError()` trong file này đều bọc `stripInterpolationSyntax()` tại điểm dựng —
 * ĐÚNG cùng hàm, không hàm thứ hai — để lời tuyên bố "không đường thứ hai" **đúng thật**, không chỉ
 * đúng ở nấc thường.
 *
 * ⚠⚠⚠ ĐÍNH CHÍNH (review vòng 1, C-1/I-1) — MỘT LỚP LỖI: tham số đặt **CÓ ĐIỀU KIỆN**
 * (`if (x !== null) params.x = x`) trong khi khuôn câu dùng `{{x}}` **VÔ ĐIỀU KIỆN** ⇒ thiếu tham
 * số ⇒ i18next (mặc định `skipOnVariables: true`) **GIỮ NGUYÊN** `{{x}}` thô — nó chỉ chặn NESTING
 * từ biến, không tự điền rỗng cho placeholder thiếu. Bản đầu phạm lỗi này ở CẢ NĂM chỗ:
 * `unknownCount` (`translateVramEstimateUsable`, tới được thật — `vramReadModel.ts`:
 * `estimateUsable = false` ngay khi `unknownCount === null` = "CHƯA HỎI"), `processKey`/`rowKind`/
 * `durability` (`translateVramReleaseStaleCommand`), `host` (`translateVramRetryDeferredCommand`).
 * Repo đã có ĐÚNG quy ước cho lớp này (`server/services/vram/vramRefusal.ts:695`:
 * `unknownCount: facts.unknownCount === null ? "?" : facts.unknownCount`, kèm comment nói thẳng
 * *"thiếu một placeholder là đẩy `{{unknownCount}}` thô ra màn hình"*) — nay DÙNG LẠI đúng quy ước
 * đó qua `paramOrUnknown()` dưới đây, KHÔNG đẻ quy ước thứ hai. LUÔN gán tham số (không bao giờ
 * `if (x !== null) params.x = x`) cho MỌI ô mà khuôn câu tham chiếu.
 *
 * 23 mã kết cục (đọc từ `vramCommands.ts` bằng `git grep`), mỗi mã một trong bốn hình dạng:
 *   • VĂN BẢN của `errors.reason.*` (16: 7 preempt + 4 releaseStale + 5 retryDeferred) — không gian
 *     `reason` ĐÃ CÓ (dùng chung với `errors.reason.*` của Pha 2B/doc71, không gian thứ hai);
 *   • VĂN BẢN của không gian MỚI (`errors.vramRowKind.*` × 2, `errors.vramDurability.*` × 1);
 *   • CHỌN appCode (`reclaimed`/`failed`/`retry-armed` — 3, xem `translateVram*Command` dưới);
 *   • chính `scope: "this-process-only"` (1) — `VRAM_FIELD_SCOPE_THIS_PROCESS_ONLY`, DÙNG CHUNG
 *     giữa `VramCommandScope.scope` (cả ba lệnh) và `VramAgentDeferView.scope` (mặt đọc).
 * `"refused"`/`"released"` KHÔNG có mặt trong 23 mã — chúng là NHÃN OUTCOME chung, câu thật nằm ở
 * `reason` (refused) hoặc `rowKind`+`durability` (released); một câu "refused" trần không nói gì
 * hơn chữ "refused", nên không có khoá riêng cho nó.
 *
 * ⚠⚠⚠ C-2 (review vòng 1) — "23/23 có bản dịch" KHÔNG được canh bằng một danh sách chép tay: đột
 * biến thêm `| "reclaimer-timed-out"` vào `VramPreemptCommandReason` (`vramCommands.ts`) mà KHÔNG
 * dịch đã lọt qua MỌI cổng (93/93 · key-parity 4/4 · `i18n:check` 0 · `tsc` 0), ra câu
 * `"…THẤT BẠI: reclaimer-timed-out"` — đúng lớp lỗi "dịch định danh" mà cả task này tồn tại để
 * diệt. Cổng vét cạn (`Record<Union, true>` bằng `import type` 3 union này) nay sống ở
 * `errorCodes.vramCommands.unit.test.ts` — ĐÓ mới là nguồn thật của "23", không phải file này.
 */

/** ★★★ C-1/I-1 (review vòng 1) — dùng lại ĐÚNG quy ước `? "?" :` của `vramRefusal.ts:695` cho MỌI
 *  tham số nullable đi vào một khuôn câu dùng nó vô điều kiện. Không đẻ quy ước thứ hai. */
function paramOrUnknown(value: string | number | null): string | number {
  return value === null ? "?" : value;
}

/** `hostedHere: boolean | null` → khoá appCode. JSON không có khoá boolean, và `null` KHÔNG được
 *  đọc thành `false` (Task 1 C-1) — ba nhánh, ba khoá, không suy ra bằng phép so đơn giản. */
function hostedHereAppCode(hostedHere: boolean | null): string {
  return hostedHere === null
    ? "VRAM_FIELD_HOSTED_HERE_UNKNOWN"
    : hostedHere
      ? "VRAM_FIELD_HOSTED_HERE_TRUE"
      : "VRAM_FIELD_HOSTED_HERE_FALSE";
}

/** `scope: "this-process-only"` — DÙNG CHUNG giữa mọi kết quả lệnh (`VramCommandScope.scope`) và
 *  khối `defer` của mặt đọc (`VramAgentDeferView.scope`): CÙNG MỘT Ý NGHĨA, một hàm, một khoá. */
export function translateVramScope(scope: "this-process-only"): string {
  return translateAppError("VRAM_FIELD_SCOPE_THIS_PROCESS_ONLY", undefined, scope);
}

/** `hostedHere` — DÙNG CHUNG giữa mặt đọc (`VramAgentDeferHostView.hostedHere`) và lệnh
 *  `retryDeferred` (`VramRetryDeferredCommandResult.hostedHere`): CÙNG MỘT Ý NGHĨA, một hàm. */
export function translateVramHostedHere(hostedHere: boolean | null): string {
  return translateAppError(hostedHereAppCode(hostedHere), undefined, String(hostedHere));
}

/** `unattributed.holderListIsLowerBound` — LUÔN `true`; câu tĩnh, không tham số (xem docstring gốc
 *  ở `vramReadModel.ts`: một Agent đọc danh sách rỗng thành "card trống" là đúng lớp lỗi này chặn). */
export function translateVramHolderListIsLowerBound(): string {
  return translateAppError("VRAM_FIELD_HOLDER_LIST_LOWER_BOUND", undefined, "holder list is a lower bound");
}

/** `unledgered.estimateKind`/`unknownCount`/`estimateUsable` — MỘT câu nói cả hai điều cùng lúc:
 *  đây là ước lượng, VÀ nó có đáng tin để tính hay không. Không tách hai câu vì Task 1 đã khoá
 *  "bốn ô này dựng CÙNG MỘT CHỖ, MỘT LẦN — không có đường nào để ai đó gửi `estimateBytes` ra ngoài
 *  mà bỏ quên lời cảnh báo đi kèm nó"; câu chữ giữ đúng kỷ luật đó. */
export function translateVramEstimateUsable(estimateUsable: boolean, unknownCount: number | null): string {
  if (estimateUsable) return translateAppError("VRAM_FIELD_ESTIMATE_USABLE", undefined, "estimate (usable)");
  // ★ C-1 (review vòng 1) — LUÔN gán (khuôn câu dùng {{unknownCount}} VÔ ĐIỀU KIỆN); `null` ("CHƯA
  // HỎI", vramReadModel.ts) đi qua paramOrUnknown() ⇒ "?" thay vì để i18next giữ nguyên "{{unknownCount}}".
  return translateAppError(
    "VRAM_FIELD_ESTIMATE_UNUSABLE",
    { unknownCount: paramOrUnknown(unknownCount) },
    "estimate (unreliable)",
  );
}

/**
 * ★★★ Pha 5 Task 5 (N11) — **CÂU KHAI "ĐÃ CẮT TẠI NGUỒN" CHO MỘT Ô HIỂN THỊ.**
 *
 * Mặt đọc (`server/services/vram/vramReadModel.ts`) cắt các ô **CÂU CHỮ** (`unledgered.lastReason`,
 * `defer.hosts[].status.lastRefusalMessage`) ở trần 400 và mang cờ đi cùng câu. Người đọc **phải**
 * nói ra điều đó: một câu lỗi bị cắt mà trông như trọn vẹn sẽ dẫn người trực đi chẩn đoán sai.
 *
 * ⚠ Trả về `""` khi **không có gì để khai** (`null`, hoặc chưa bị cắt) — chuỗi rỗng ở đây là câu
 * trả lời ĐÚNG, không phải một ô thiếu.
 * ⚠ Hàm này **KHÔNG** render `text`: `text` là **dữ liệu**, panel render thẳng (React tự escape);
 * đây chỉ là **câu chữ**, và câu chữ thì luôn đi qua lớp dịch (kỷ luật của `VramBrokerPanel`).
 */
export function translateVramTruncatedNotice(
  x: { readonly text: string; readonly truncated: boolean; readonly rawLength: number } | null | undefined,
): string {
  if (x === null || x === undefined || !x.truncated) return "";
  return translateAppError(
    "VRAM_FIELD_TEXT_TRUNCATED_AT_SOURCE",
    { kept: x.text.length, total: x.rawLength },
    `… [truncated at the source, kept ${x.text.length}/${x.rawLength}]`,
  );
}

/** `nonFiniteFields` — mảng RỖNG là một câu trả lời thật ("không ô nào bị chặn"), không phải im
 *  lặng; mảng có phần tử là câu fail-closed HỢP LỆ (xem docstring `vramReadModel.ts`), không phải
 *  dữ liệu thiếu. `path`/`was` đi qua `params` ⇒ tự động sạch qua `sanitizeAllParams`. */
export function translateVramNonFiniteFields(
  fields: readonly { readonly path: string; readonly was: string }[],
): string {
  if (fields.length === 0) {
    return translateAppError("VRAM_FIELD_NON_FINITE_NONE", undefined, "no fields blocked");
  }
  const joined = fields.map((f) => `${f.path}=${f.was}`).join(", ");
  return translateAppError(
    "VRAM_FIELD_NON_FINITE_PRESENT",
    { count: fields.length, fields: joined },
    `${fields.length} field(s) blocked`,
  );
}

// ── BA LỆNH CỦA AGENT (`vramCommands.ts`) — mỗi hàm CHỌN appCode theo `outcome`, đẩy `reason` (nếu
// có) làm tham số TỪ ĐIỂN (không gian `reason` đã có) để `translateAppError()` tự chọn biến thể
// `_WITH_REASON`. KHÔNG import kiểu từ `server/**` (file này bundle vào client) — hình dạng đầu vào
// khai LỎNG, khớp đủ trường mà `vramCommands.ts` phơi ra. ────────────────────────────────────────
//
// ★ M-4 (review vòng 1) — 3 khoá GỐC `VRAM_CMD_*_FAILED`/`VRAM_CMD_*_REFUSED` (không `_WITH_REASON`,
// vd khi gọi với `reason: null`) là NHÁNH PHÒNG THỦ: `kq.failure`/`kq.refusal` LUÔN non-null ở nhánh
// tương ứng trong mã sản xuất hôm nay (`vramCommands.ts:126-131`, `vramReconciler.ts:1616-1678`,
// `kbSyncScheduler.ts:1955-1986`) — nên các khoá này CHƯA từng tới được bằng dữ liệu thật. Giữ lại
// có chủ đích (rẻ, và là lưới THẬT nếu bất biến "reason luôn non-null khi thất bại" vỡ trong tương
// lai) — ĐỪNG đọc chúng thành "hệ có thể trả lời mơ hồ", chúng chỉ tồn tại cho một tổ hợp
// kiểu-hợp-lệ-nhưng-không-tới-được (kiểu `VramPreemptCommandForI18n` khai LỎNG ở trên không ép được
// điều này ở tầng biên dịch).

export interface VramPreemptCommandForI18n {
  readonly outcome: "reclaimed" | "failed" | "refused";
  readonly reason: string | null;
  readonly owner: string;
  readonly detail: string | null;
  /**
   * ★ M-3 (review vòng 1) — BẮT BUỘC, kể cả khi `outcome !== "reclaimed"` (đơn giản hoá điểm gọi:
   * `VramPreemptCommandResult.freedBytes` LUÔN là `number`, không `| null`, ở mọi outcome). Khi
   * `outcome === "reclaimed"`, `freedBytes === 0` chọn khoá RIÊNG giải thích đúng cơ chế đua thay vì
   * dán lời cảnh báo đó vào MỌI lượt thu hồi thành công (kể cả lượt bình thường, `freedBytes > 0`).
   */
  readonly freedBytes: number;
  /**
   * ★★★ M-5 nửa sau (Task 4) — **ĐỌC, KHÔNG ĐO.** Nguồn duy nhất là `vramPreempt.catCau()`
   * (`VramPreemptCommandResult.detailTruncated`). ⚠⚠ **CẤM** thay ô này bằng `r.detail.length === 400`
   * ở đây: một bất biến hai người viết là đúng lớp lỗi đã đẻ ba Critical trong chuỗi pha này, và
   * phép so ấy còn SAI cho một câu dài **đúng 400** ký tự (chưa cắt mà bị khai là đã cắt).
   * ⚠ BẮT BUỘC (không optional): một `?: boolean` sẽ để mọi điểm gọi cũ âm thầm khai "chưa cắt".
   */
  readonly detailTruncated: boolean;
}

/** `vram.preempt` → câu người đọc được. `detail` (M-5, CHUỖI THÔ) làm sạch bằng ĐÚNG
 *  `stripInterpolationSyntax` rồi nối SAU câu chính — xem khối ràng buộc đầu phần Task 3. */
export function translateVramPreemptCommand(r: VramPreemptCommandForI18n): string {
  const params: Record<string, string | number> = { owner: r.owner };
  if (r.reason !== null) params.reason = r.reason;
  const appCode =
    r.outcome === "reclaimed"
      ? r.freedBytes === 0
        ? "VRAM_CMD_PREEMPT_RECLAIMED_ZERO_BYTES" // ★ M-3 — bằng chứng leaseLeftLedger vẫn đúng, nói vì sao freedBytes=0
        : "VRAM_CMD_PREEMPT_RECLAIMED"
      : r.outcome === "failed"
        ? "VRAM_CMD_PREEMPT_FAILED"
        : "VRAM_CMD_PREEMPT_REFUSED";
  // ★ I-2 (review vòng 1) — `fallback` KHÔNG đi qua localizeParams/sanitizeAllParams
  // (translateAppError trả nó NGUYÊN VĂN khi khoá thiếu ở activeLng); làm sạch tại điểm dựng.
  const sentence = translateAppError(appCode, params, `${r.outcome}: ${stripInterpolationSyntax(r.owner)}`);
  if (r.detail === null) return sentence;
  /**
   * ★ M-5 nửa sau (Task 4) — câu ghép PHẢI nói ra rằng `detail` đã bị cắt, nếu không người đọc (và
   * Agent) sẽ coi một câu cụt là câu ĐẦY ĐỦ rồi kết luận sai về nguyên nhân. Mẩu chữ đi qua ĐÚNG
   * `translateAppError()` (ba locale), không phải một chuỗi viết tay.
   */
  const detail = stripInterpolationSyntax(r.detail);
  const suffix = r.detailTruncated
    ? ` ${translateAppError("VRAM_CMD_PREEMPT_DETAIL_TRUNCATED", undefined, "(truncated)")}`
    : "";
  return `${sentence} — ${detail}${suffix}`;
}

export interface VramReleaseStaleCommandForI18n {
  readonly outcome: "released" | "refused";
  readonly reason: string | null;
  readonly leaseKey: string;
  readonly processKey: string | null;
  readonly rowKind: "sibling-lease" | "shared-baseline" | null;
  readonly durability: string | null;
}

/** `vram.releaseStale` → câu người đọc được. */
export function translateVramReleaseStaleCommand(r: VramReleaseStaleCommandForI18n): string {
  // ★ I-1 (review vòng 1) — LUÔN gán ba ô này (khuôn `…_RELEASED` dùng cả ba VÔ ĐIỀU KIỆN); kiểu
  // export CỐ Ý khai LỎNG (không import kiểu server) nên `tsc` không đỡ được — `paramOrUnknown()`
  // là lưới RUN-TIME cho đúng lớp lỗi mà C-1 vừa vá.
  const params: Record<string, string | number> = {
    leaseKey: r.leaseKey,
    processKey: paramOrUnknown(r.processKey),
    rowKind: paramOrUnknown(r.rowKind),
    durability: paramOrUnknown(r.durability),
  };
  if (r.reason !== null) params.reason = r.reason;
  const appCode = r.outcome === "released" ? "VRAM_CMD_RELEASE_STALE_RELEASED" : "VRAM_CMD_RELEASE_STALE_REFUSED";
  // ★ I-2 — fallback làm sạch tại điểm dựng, cùng lý do đã ghi ở `translateVramPreemptCommand`.
  return translateAppError(appCode, params, `${r.outcome}: ${stripInterpolationSyntax(r.leaseKey)}`);
}

export interface VramRetryDeferredCommandForI18n {
  readonly outcome: "retry-armed" | "refused";
  readonly reason: string | null;
  readonly owner: string;
  readonly host: string | null;
}

/** `vram.retryDeferred` → câu người đọc được. */
export function translateVramRetryDeferredCommand(r: VramRetryDeferredCommandForI18n): string {
  // ★ I-1 — LUÔN gán `host` (khuôn `…_ARMED` dùng `{{host}}` VÔ ĐIỀU KIỆN); xem lý do ở
  // `translateVramReleaseStaleCommand`.
  const params: Record<string, string | number> = { owner: r.owner, host: paramOrUnknown(r.host) };
  if (r.reason !== null) params.reason = r.reason;
  const appCode = r.outcome === "retry-armed" ? "VRAM_CMD_RETRY_DEFERRED_ARMED" : "VRAM_CMD_RETRY_DEFERRED_REFUSED";
  // ★ I-2 — fallback làm sạch tại điểm dựng.
  return translateAppError(appCode, params, `${r.outcome}: ${stripInterpolationSyntax(r.owner)}`);
}
