/**
 * Sprint 5 doc71 Task 6 (F8) — hồi quy do di trú: en/zh nạp bundle bằng
 * `import()` ĐỘNG (client/src/i18n/index.ts, `lazyLocales`/`ensureLocale`),
 * và `fallbackLng: 'vi'`. Trong cửa sổ chờ nạp (hoặc khi chunk lỗi vĩnh viễn —
 * mạng chập/offline), bundle 'translation' của ngôn ngữ đang hoạt động CHƯA
 * tồn tại (`i18n.hasResourceBundle('en','translation') === false`). i18next
 * lúc đó KHÔNG rơi thẳng về `defaultValue`/SENTINEL của `translateAppError` mà
 * rơi về BẢN DỊCH TIẾNG VIỆT qua `fallbackLng` TRƯỚC — nên `translateAppError`
 * tưởng "đã dịch" và trả nguyên câu tiếng Việt cho người dùng đã chọn en/zh,
 * KHÔNG bao giờ rơi tiếp về `fallback` (message tiếng Anh của server). Trước
 * di trú mọi lỗi hiện thẳng `err.message` (tiếng Anh) nên đường này chưa từng
 * tồn tại — đây là hồi quy MỚI của chính sprint này.
 *
 * Test dựng lại ĐÚNG cơ chế thật bằng i18next THẬT (KHÔNG stub `i18n.t`):
 * nạp bundle vi ĐẦY ĐỦ (giống `loadVi()` ở app thật — main.tsx gate render
 * trên `i18nReady` nên vi luôn nạp xong trước khi người dùng tương tác), rồi
 * dùng `removeResourceBundle('en','translation')` (API CÔNG KHAI của i18next,
 * đúng như brief yêu cầu) để mô phỏng ĐÚNG khoảnh khắc bundle en CHƯA (hoặc
 * không còn) tồn tại trong khi active language đã là 'en' — chính là cửa sổ
 * chờ `ensureLocale()` đang await `import()` động, hoặc trường hợp chunk lỗi
 * vĩnh viễn (offline, catch nuốt lỗi, không bao giờ addResourceBundle).
 *
 * Lưu ý kỹ thuật: import "../i18n" đăng ký listener `languageChanged` thật
 * (gọi `ensureLocale` nền, tự import() thật `en.json`/`zh.json`). Ta KHÔNG
 * dựa vào tốc độ của import() nền đó (sẽ flaky) — thay vào đó gọi
 * `removeResourceBundle` NGAY TRƯỚC `translateAppError`, cùng tick, không có
 * `await` xen giữa hai lời gọi đồng bộ này. Nhờ run-to-completion của JS, dù
 * tác vụ nạp nền có chạy xong lúc nào, `removeResourceBundle` luôn là lệnh
 * cuối cùng thay đổi trạng thái bundle trước khi `translateAppError` (hàm
 * đồng bộ, không await) đọc nó — test không bao giờ bất định (flaky).
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";

import { translateAppError } from "./errorCodes";

import "../i18n";
import i18n from "i18next";

const localeJson = (rel: string) => JSON.parse(readFileSync(new URL(rel, import.meta.url), "utf8"));

beforeAll(async () => {
  // vi luôn nạp trước, giống loadVi() thật ở app (main.tsx await i18nReady
  // trước khi render lần đầu) — đây KHÔNG phải phần đang bị mô phỏng "chưa nạp".
  i18n.addResourceBundle("vi", "translation", localeJson("../i18n/locales/vi.json"), true, true);
});

describe("translateAppError — F8: bundle en/zh CHƯA nạp xong (hồi quy do di trú sprint này)", () => {
  it("active lng='en' nhưng bundle en CHƯA có ⇒ KHÔNG được rơi về câu tiếng Việt qua fallbackLng", async () => {
    await i18n.changeLanguage("en");
    // Mô phỏng ĐÚNG cửa sổ chờ nạp / chunk lỗi vĩnh viễn: bundle en chưa/không
    // còn tồn tại. Gọi removeResourceBundle NGAY TRƯỚC translateAppError (xem
    // giải thích run-to-completion ở đầu file) để test không phụ thuộc tốc độ
    // import() thật.
    i18n.removeResourceBundle("en", "translation");
    expect(i18n.hasResourceBundle("en", "translation")).toBe(false);

    const out = translateAppError(
      "ENTITY_NOT_FOUND",
      { entity: "product" },
      "Could not find product.",
    );

    // Bug F8 (TRƯỚC fix): i18next rơi về fallbackLng 'vi' (đã nạp) TRƯỚC khi
    // chạm SENTINEL/defaultValue của translateAppError ⇒ trả "Không tìm thấy
    // sản phẩm." — đúng câu tiếng Việt mà người dùng chọn 'en' KHÔNG được thấy.
    expect(out).not.toContain("Không tìm thấy");
    expect(out).not.toContain("sản phẩm");
    expect(out).toBe("Could not find product.");
  });

  it("chunk lỗi vĩnh viễn (offline, catch nuốt lỗi) ⇒ giống hệt trường hợp trên, vẫn phải rơi về fallback", async () => {
    await i18n.changeLanguage("en");
    i18n.removeResourceBundle("en", "translation");

    const out = translateAppError(
      "OPERATION_FAILED",
      { operation: "rescheduleProductionOrder" },
      "Could not reschedule order.",
    );

    expect(out).toBe("Could not reschedule order.");
  });

  it("có `reason` (lời gọi t() LỒNG của Task 5, errors.reason.* + _WITH_REASON) + bundle en CHƯA có ⇒ gate phải chặn TRƯỚC CẢ lời gọi lồng, không chỉ câu chính — nếu không sẽ ra ca 'câu chính đúng tiếng Anh nhưng reason lại tiếng Việt'", async () => {
    await i18n.changeLanguage("en");
    i18n.removeResourceBundle("en", "translation");
    expect(i18n.hasResourceBundle("en", "translation")).toBe(false);

    // `localizeParams()` (errorCodes.ts) sẽ gọi i18n.t('errors.reason.dryRunNotPassed', ...)
    // LỒNG bên trong translateAppError, TRƯỚC khi build khoá `_WITH_REASON` —
    // nếu gate chỉ chặn ở lời gọi t() cuối cùng mà không chặn từ đầu hàm, lời
    // gọi lồng này vẫn chạy khi bundle en chưa nạp và rơi về bản dịch vi của
    // `errors.reason.dryRunNotPassed` ("Chạy bước 3 (Dry-run) trước..."),
    // trong khi câu ngoài lại đúng là `fallback` tiếng Anh — hỏng NỬA câu.
    const out = translateAppError(
      "OPERATION_FAILED",
      { operation: "rescheduleProductionOrder", reason: "dryRunNotPassed" },
      "Could not reschedule order.",
    );

    expect(out).toBe("Could not reschedule order.");
    expect(out).not.toContain("Dry-run");
    expect(out).not.toContain("bước 3");
  });

  it("active lng='zh' (namespace 'translation' đúng như defaultNS cấu hình), bundle zh CHƯA có ⇒ vẫn phải rơi về fallback", async () => {
    await i18n.changeLanguage("zh");
    i18n.removeResourceBundle("zh", "translation");
    expect(i18n.hasResourceBundle("zh", "translation")).toBe(false);

    const out = translateAppError(
      "ENTITY_NOT_FOUND",
      { entity: "product" },
      "找不到产品。",
    );

    expect(out).not.toContain("Không tìm thấy");
    expect(out).not.toContain("sản phẩm");
    expect(out).toBe("找不到产品。");
  });

  it("locale đang hoạt động CHÍNH LÀ vi ⇒ hành vi KHÔNG đổi, vẫn dịch bình thường qua vi (đường thường không bị hỏng)", async () => {
    await i18n.changeLanguage("vi");
    const out = translateAppError(
      "ENTITY_NOT_FOUND",
      { entity: "product" },
      "Could not find product.",
    );
    expect(out).toBe("Không tìm thấy sản phẩm.");
  });

  it("SAU KHI bundle en đã nạp xong (mô phỏng ensureLocale hoàn tất) ⇒ dịch lại bình thường bằng en, không còn rơi về fallback lẫn tiếng Việt", async () => {
    await i18n.changeLanguage("en");
    // Mô phỏng ensureLocale() ĐÃ addResourceBundle thật xong — chiều NGƯỢC của bug.
    i18n.addResourceBundle("en", "translation", localeJson("../i18n/locales/en.json"), true, true);
    expect(i18n.hasResourceBundle("en", "translation")).toBe(true);

    const out = translateAppError(
      "ENTITY_NOT_FOUND",
      { entity: "product" },
      "Could not find product.",
    );
    expect(out).toBe("Could not find product.");
    expect(out).not.toContain("sản phẩm");
  });
});

/**
 * Task 6 round 2 (F8, Important — reviewer) — ĐÍNH CHÍNH round 1: `hasResourceBundle`
 * chỉ trả lời "ngôn ngữ này có bundle nạp CHƯA" (đúng-hay-sai TOÀN CỤC), KHÔNG trả lời
 * "khoá `errors.<appCode>` NÀY có tồn tại trong bundle đó không" (đúng-hay-sai TỪNG
 * KHOÁ). Bundle `en` có thể nạp ĐẦY ĐỦ (hàng nghìn khoá khác) mà vẫn THIẾU đúng một
 * khoá `errors.<appCode>` cụ thể (khoá đó chỉ tồn tại ở `vi.json`, chưa dịch sang
 * en/zh — hoàn toàn có thể xảy ra khi 6 task còn lại của sprint này thêm mã lỗi mới).
 * `i18n.hasResourceBundle('en','translation')` trả `true` (bundle CÓ nạp), nên cổng
 * round 1 (đọc `i18n.language` + `hasResourceBundle`) cho đi qua — nhưng
 * `i18n.t('errors.<appCode>', ...)` vẫn KHÔNG kích SENTINEL: `Translator.resolve()`
 * (`node_modules/i18next/dist/cjs/i18next.js`) duyệt CẢ chuỗi `toResolveHierarchy(lng,
 * fallbackLng)` CHO TỪNG KHOÁ RIÊNG LẺ — không quan tâm bundle "tổng thể" đã nạp hay
 * chưa — nên vẫn lặng lẽ rơi về bản dịch `vi` qua `fallbackLng`. Đây là lớp lỗi F8
 * NGUYÊN VẸN, chỉ khác cơ chế kích hoạt (thiếu-khoá-đơn-lẻ thay vì cả-bundle-chưa-nạp).
 *
 * Test dựng bundle `en` "thật" (nạp từ `en.json` thật, có đủ mọi khoá khác) rồi CHỈ
 * xoá đúng MỘT khoá đang tra — mô phỏng đúng tình huống: bản dịch cho appCode/reason
 * mới chưa kịp thêm vào en/zh khi router đã dùng appCode đó.
 */
describe("translateAppError — F8 round 2: bundle NẠP ĐỦ nhưng THIẾU đúng 1 khoá errors.<appCode> (Important — reviewer)", () => {
  it("bundle en nạp đủ (mọi khoá khác) nhưng THIẾU đúng errors.ENTITY_NOT_FOUND ⇒ vẫn phải rơi về fallback, không được lấy câu vi qua fallbackLng", async () => {
    await i18n.changeLanguage("en");
    // XOÁ SẠCH bundle en trước — các test TRƯỚC trong CÙNG file này (vd "SAU KHI bundle
    // en đã nạp xong") đã `addResourceBundle` en ĐẦY ĐỦ; `addResourceBundle(..., deep:
    // true, overwrite: true)` chỉ GHI ĐÈ/GỘP các khoá có trong object mới, KHÔNG xoá khoá
    // cũ vắng mặt trong object mới — nếu không xoá sạch trước, `delete` bên dưới vô
    // nghĩa (khoá vẫn còn nguyên từ lần nạp đầy đủ trước đó, test xanh giả).
    i18n.removeResourceBundle("en", "translation");
    const enFull = localeJson("../i18n/locales/en.json") as { errors?: Record<string, unknown> };
    // Xoá ĐÚNG khoá đang tra, giữ nguyên mọi khoá khác (kể cả errors.entity.product) —
    // mô phỏng "bản dịch câu appCode chưa kịp thêm" chứ không phải "cả bundle rỗng".
    delete enFull.errors?.ENTITY_NOT_FOUND;
    i18n.addResourceBundle("en", "translation", enFull, true, true);
    expect(i18n.hasResourceBundle("en", "translation")).toBe(true); // bundle CÓ nạp — khác round 1

    const out = translateAppError(
      "ENTITY_NOT_FOUND",
      { entity: "product" },
      "Could not find product.",
    );

    // Bug F8 round 2 (TRƯỚC fix): cổng round 1 chỉ soi hasResourceBundle (true) nên
    // cho qua; i18n.t() rơi về bản vi qua fallbackLng ⇒ "Không tìm thấy sản phẩm."
    expect(out).not.toContain("Không tìm thấy");
    expect(out).not.toContain("sản phẩm");
    expect(out).toBe("Could not find product.");
  });

  it("có `reason` (lời gọi t() LỒNG của Task 5) + bundle en nạp đủ nhưng THIẾU đúng errors.reason.dryRunNotPassed ⇒ nhánh lồng cũng KHÔNG được lấy câu vi qua fallbackLng", async () => {
    await i18n.changeLanguage("en");
    // Xoá sạch bundle en trước — cùng lý do đã ghi ở test trên (addResourceBundle deep-
    // merge không xoá khoá cũ vắng mặt trong object mới).
    i18n.removeResourceBundle("en", "translation");
    const enFull = localeJson("../i18n/locales/en.json") as {
      errors?: { reason?: Record<string, unknown> };
    };
    // OPERATION_FAILED_WITH_REASON GIỮ NGUYÊN ở en (mới chỉ thiếu bản dịch reason con) —
    // đúng kịch bản thật: thêm khoá reason mới mà quên dịch, câu khung vẫn còn nguyên.
    delete enFull.errors?.reason?.dryRunNotPassed;
    i18n.addResourceBundle("en", "translation", enFull, true, true);
    expect(i18n.hasResourceBundle("en", "translation")).toBe(true);

    const out = translateAppError(
      "OPERATION_FAILED",
      { operation: "rescheduleProductionOrder", reason: "dryRunNotPassed" },
      "Could not reschedule order.",
    );

    // Bug F8 round 2 ở nhánh LỒNG (TRƯỚC fix): errors.reason.dryRunNotPassed rơi về
    // bản vi "Chạy bước 3 (Dry-run) trước, hoặc nhờ admin ký với lý do override." qua
    // fallbackLng — câu chính (khung _WITH_REASON, vẫn còn ở en) trộn với phần lý do
    // tiếng Việt, đúng ca "câu chính đúng tiếng Anh, phần lý do lại tiếng Việt".
    expect(out).not.toContain("Chạy bước 3");
    expect(out).not.toContain("Dry-run) trước");
    expect(out).not.toContain("admin ký với lý do");
  });
});
