/**
 * F12 (nhóm C 2026-08-14) — CỔNG BỔ SUNG cho nhãn tiếng Việt lọt sang bản en/zh.
 *
 * ══════════════════════════════════════════════════════════════════════════════════
 * ⚠ ĐỌC TRƯỚC — VÌ SAO FILE NÀY KHÔNG PHẢI BẢN SAO CỦA `scripts/i18n-check.mjs`
 * ══════════════════════════════════════════════════════════════════════════════════
 * Dự án ĐÃ CÓ một cổng i18n đầy đủ (`npm run i18n:check`) với hai file nền, trong đó
 * `i18n-baseline-tran.json` là TRẦN mà `--update-baseline` không bao giờ ghi được.
 * Cổng đó đã phủ nhánh *"khoá `t()` vắng ở cả ba locale"* — **đừng viết lại nó ở đây**.
 *
 * File này chỉ canh hai thứ mà cổng kia **về cấu tạo không thể** canh:
 *
 * (1) **Chuỗi tiếng Việt TRẦN** — không đi qua `t()` nên KHÔNG CÓ KHOÁ nào để quét.
 *     Mọi công cụ dựa trên khoá đều mù với nó theo định nghĩa.
 *
 * (2) **Khoá có ở `vi.json` nhưng thiếu ở `en.json`/`zh.json`** — so FILE VỚI FILE,
 *     không so theo tham chiếu trong mã. `i18n-check.mjs` dựng tập khoá từ mã nguồn
 *     nên mù với hai khuôn tham chiếu có thật trong repo này:
 *       · `t(\`settings.machineType_\${type}\`)`  — template literal có biến
 *       · `{ labelKey: "deviceHub.tabs.oee" }`    — khoá lưu như DỮ LIỆU rồi mới `t(labelKey)`
 *     Lượt chạy đầu tiên của chính phép so này bắt được **4 khoá** mà cổng kia chưa
 *     bao giờ thấy (2 khuôn trên, mỗi khuôn 2 khoá) — bằng chứng nó không thừa.
 *
 * ── LỚP LỖI ĐANG CANH ────────────────────────────────────────────────────────────
 * i18next luôn trả `defaultValue` khi không tra được khoá, nên một nhãn thiếu khoá
 * hiện TIẾNG VIỆT ở mọi ngôn ngữ — không lỗi, không cảnh báo, cổng xanh. Pha 6 đã trả
 * giá đúng lớp này: 30 nhãn `vramBroker.*` vắng cả ba locale, người dùng `en`/`zh` mở
 * `/ai-brain` thấy 30 nhãn tiếng Việt gồm HAI NÚT PHÁ HUỶ, mà `i18n:check` khai xanh
 * suốt năm lượt.
 *
 * ⚠ KHÔNG được nâng ngân sách để cổng xanh. Nâng nó nghĩa là bạn vừa thêm một nhãn
 *   mà người dùng en/zh sẽ đọc bằng tiếng Việt.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { demHinhDangBa } from "../../../scripts/viStringScan.mjs";

/**
 * Hạ số này mỗi khi di trú xong một đợt. KHÔNG BAO GIỜ nâng lên.
 *
 * 610 → 410 (2026-08-16): đã di trú **toàn bộ 200 chuỗi trên 39 file màn VẬN HÀNH**
 * — số nhãn mà người vận hành đọc mỗi ca nay bằng 0.
 *
 * ⚠ 410 CÒN LẠI KHÔNG PHẢI SỐ DƯ TUỲ Ý — nó là chính xác 8 file `ApiDocs`
 * (`pages/ApiDocs.tsx` 192 · `components/apiDocs/*` 218). Nội dung ở đó là **tài liệu
 * tham chiếu API cho bên tích hợp**, dạng `factory.list - Danh sách nhà máy`: tên
 * tuyến bằng tiếng Anh + mô tả bằng tiếng Việt. Đó là tài liệu, không phải nhãn giao
 * diện, nên chủ dự án chốt để lại (2026-08-16). Xem `ALLOWED_RAW_VI_APIDOCS` bên dưới:
 * nợ này bị GIAM trong thư mục ApiDocs, thêm chuỗi trần ở bất kỳ đâu khác vẫn ĐỎ.
 */
const ALLOWED_RAW_VI_STRINGS = 410;

/**
 * Trần riêng cho nhóm ApiDocs. Tồn tại để hai con số không thể bù trừ cho nhau:
 * nếu ai đó dịch bớt ApiDocs mà thêm nhãn trần vào màn vận hành, tổng vẫn 410 và
 * cổng trên sẽ xanh — chính là lớp lỗi "ngân sách tự thoả" đã trả giá ở Pha 7.
 */
const ALLOWED_RAW_VI_APIDOCS = 410;

const CLIENT_SRC = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LOCALES = resolve(CLIENT_SRC, "i18n/locales");

const CHU_VIET =
  /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i;

function walkTsx(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === "locales") continue; // file dịch, không phải mã
      out.push(...walkTsx(full));
    } else if (/\.tsx$/.test(name) && !/\.test\./.test(name)) {
      out.push(full);
    }
  }
  return out;
}

function flatten(obj: unknown, prefix = "", out: Record<string, unknown> = {}) {
  if (!obj || typeof obj !== "object") return out;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object") flatten(v, key, out);
    else out[key] = v;
  }
  return out;
}

const doc = (lg: string) =>
  flatten(JSON.parse(readFileSync(join(LOCALES, `${lg}.json`), "utf8")));

/**
 * Chuỗi tiếng Việt trần trong JSX text hoặc thuộc tính hướng-người-dùng.
 * Comment KHÔNG tính — comment tiếng Việt là chuyện tốt, không phải nợ.
 */
function demChuoiTran(): { total: number; byFile: Array<[string, number]> } {
  const THUOC_TINH =
    /\b(placeholder|title|label|aria-label|description|alt|tooltip)\s*=\s*["'`][^"'`]*/;
  const byFile: Array<[string, number]> = [];
  let total = 0;

  for (const file of walkTsx(CLIENT_SRC)) {
    const lines = readFileSync(file, "utf8").split("\n");
    let inBlock = false;
    let n = 0;
    for (const ln of lines) {
      const tr = ln.trim();
      if (inBlock) { if (tr.includes("*/")) inBlock = false; continue; }
      // ⚠ `{/*` cũng phải tính là mở khối. Bỏ sót nó, một comment JSX NHIỀU DÒNG có
      // chữ Việt sẽ bị đếm thành nợ — và tệ hơn, bộ di trú tự động sẽ SỬA VÀO COMMENT.
      // Đúng chuyện đó đã xảy ra ở `DashboardLayout.tsx` lượt 2026-08-16.
      if (tr.startsWith("/*") || tr.startsWith("{/*")) { inBlock = !tr.includes("*/"); continue; }
      if (tr.startsWith("//") || tr.startsWith("*")) continue;
      if (!CHU_VIET.test(ln)) continue;

      if (/>[^<>{}]*[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ][^<>{}]*</i.test(ln)) { n++; continue; }
      const attr = ln.match(THUOC_TINH);
      if (attr && CHU_VIET.test(attr[0])) { n++; continue; }
    }
    if (n) { byFile.push([file.replace(CLIENT_SRC, ""), n]); total += n; }
  }
  byFile.sort((a, b) => b[1] - a[1]);
  return { total, byFile };
}

/** Nhóm tài liệu tham chiếu API — cố ý ngoài phạm vi di trú, xem chú thích trần. */
const LA_APIDOCS = /ApiDocs|apiDocs|api-docs/i;

describe("F12 — chuỗi tiếng Việt TRẦN (cổng theo-khoá không thấy được)", () => {
  it(`tối đa ${ALLOWED_RAW_VI_STRINGS} chuỗi hướng-người-dùng chưa qua t()`, () => {
    const { total, byFile } = demChuoiTran();
    if (total > ALLOWED_RAW_VI_STRINGS) {
      console.error("[F12] còn nợ ở:", byFile.slice(0, 15));
    }
    expect(total).toBeLessThanOrEqual(ALLOWED_RAW_VI_STRINGS);
  });

  it("ngân sách phải bám SÁT số thật — số dư che mất nợ mới", () => {
    expect(ALLOWED_RAW_VI_STRINGS).toBe(demChuoiTran().total);
  });

  // ⚠ Hai phép đo dưới đây là thứ khiến trần 410 KHÔNG phải một cái bao tải.
  // Thiếu chúng, một nhãn trần mới ở màn vận hành có thể núp sau việc ai đó
  // tình cờ dịch bớt ApiDocs, và tổng vẫn đúng 410.
  it("màn VẬN HÀNH phải bằng 0 — mọi chuỗi trần ngoài ApiDocs đều là nợ MỚI", () => {
    const { byFile } = demChuoiTran();
    const vanHanh = byFile.filter(([f]) => !LA_APIDOCS.test(f));
    if (vanHanh.length) console.error("[F12] nhãn trần MỚI ngoài ApiDocs:", vanHanh);
    expect(vanHanh).toEqual([]);
  });

  it(`nhóm ApiDocs không được phình quá ${ALLOWED_RAW_VI_APIDOCS}`, () => {
    const { byFile } = demChuoiTran();
    const apiDocs = byFile.filter(([f]) => LA_APIDOCS.test(f)).reduce((s, [, n]) => s + n, 0);
    expect(apiDocs).toBeLessThanOrEqual(ALLOWED_RAW_VI_APIDOCS);
  });
});

/**
 * ══════════════════════════════════════════════════════════════════════════════════
 * HÌNH DẠNG THỨ BA — string literal tiếng Việt trong BIỂU THỨC (không phải `>text<`,
 * không phải `attr="text"`).
 * ══════════════════════════════════════════════════════════════════════════════════
 * ⚠ CÁCH TÌM RA NÓ MỚI LÀ ĐIỀU ĐÁNG GHI. `demChuoiTran()` khai **0 nợ ở màn vận hành**
 * và cả ba cổng đều xanh. Rồi lượt nghiệm thu BẰNG MẮT mở `/` với trình duyệt ngôn ngữ
 * `en` và thấy một dải băng tiếng Việt chạy ngang đầu MỌI màn:
 *
 *     {!netUp ? "Mất kết nối mạng — …" : "Mất kết nối thời gian thực — …"}
 *
 * Chuỗi nằm ở hai NHÁNH TERNARY nên nó không mang hình dạng nào trong hai hình dạng
 * cổng biết đọc. Cổng không sai số — nó đo một hình dạng mà lỗi này không có.
 * ⇒ Bài học: một cổng tĩnh xanh chỉ chứng minh "không còn thứ TÔI BIẾT CÁCH NHÌN".
 *   Nghiệm thu bằng mắt không phải bước làm cho đẹp; nó là bước duy nhất có thể
 *   phát hiện một hình dạng chưa ai nghĩ tới.
 *
 * ⚠ 914 KHÔNG PHẢI SỐ NỢ ĐÃ THẨM ĐỊNH — nó là số ĐÓNG BĂNG. Đã lấy mẫu và biết chắc
 *   trong đó có những thứ **không được dịch**:
 *     · `ApiDocs`: `name: "Nhà máy Bắc Ninh"` — dữ liệu JSON MẪU trong tài liệu API
 *     · `BulkImportDialog`: `findCol("code", "mã", "ma", …)` — BÍ DANH CỘT tiếng Việt
 *       để khớp file Excel người dùng nhập; dịch chúng là làm HỎNG chức năng nhập
 *     · `FirstRunTour` / `FactoryConfigAudit`: `{ key: "…", fallback: "…" }` — đã có
 *       khoá i18n đi kèm, chuỗi Việt chỉ là lưới an toàn, đúng khuôn
 *   Việc phân loại 914 mục này là hạng mục RIÊNG (F13), chưa làm. Cổng dưới đây chỉ
 *   giữ cho nó KHÔNG PHÌNH THÊM trong lúc chờ.
 */
/**
 * 914 → 770: lọc bốn KHUÔN ĐÃ ĐÚNG ra khỏi phép đếm (xem `LA_KHUON_DUNG`) và bỏ
 * comment cuối dòng. 144 mục kia chưa bao giờ là nợ — con số 914 đã nói quá.
 * 770 → 652: F13 lô 1 — nhãn điều hướng + 6 hub đi qua `t()`, 167 khoá × 3 locale.
 * 652 → 619: F13 lô 2 — bản đồ trạng thái/enum của CommandCenter + MasterData.
 *
 * ★★ 623 → 500 (2026-08-18): **KHÔNG di trú thêm chuỗi nào — THƯỚC ĐANG ĐẾM SAI 123 mục.**
 * Bộ đếm chạy THEO TỪNG DÒNG, nên hai khuôn mà chính docblock trên đã khai là ĐÚNG lại bị
 * tính là nợ chỉ vì chúng xuống dòng:
 *
 *   (c) `t(` trải nhiều dòng — 107 mục. Nhánh miễn trừ cũ (`/\bt\s*\(/`) chỉ thấy khoá và
 *       chuỗi mặc định khi chúng CÙNG một dòng:
 *           t(
 *             "vramBroker.subtitle",
 *             "Đọc từ chính phép ghép mà reserve() chạy — …",   ← bị đếm là nợ
 *           )
 *   (d) cặp `labelKey:` / `labelDefault:` tách hai dòng — 21 mục. Dòng 222 khai khuôn
 *       `{ labelKey: "…", fallback: "…" }` là đúng, nhưng `LA_KHUON_DUNG` đòi cùng dòng.
 *
 * ⚠ CÁCH PHÁT HIỆN — đáng ghi hơn con số. Cổng ĐỎ ở 623 và một agent quy lỗi cho hai file
 * màn hình. Đọc thẳng vào những dòng bị tố thì KHÔNG CÓ mục nào ở đó: lời khai sai. Đếm lại
 * bằng cách so từng file với bản HEAD ra 3 file / 6 mục, và cả 6 đều nằm trong hai khuôn
 * trên. Tức con số 623 chưa bao giờ là số nợ — **cái phình lên là sai số của thiết bị đo.**
 *
 * ★ VÌ SAO 500 CHỨ KHÔNG PHẢI 495 — bản vá này suýt tự đào một lỗ. Miễn trừ (c) nguy hiểm ở
 * một chỗ: `t()` còn nhận đối số NỘI SUY, nên `t("khoá", { ten: "Nhà máy" })` cũng được miễn
 * trong khi "Nhà máy" là chuỗi trần thật. Lượt ĐỘT BIẾN đã đo đúng điều đó: bản vá đầu (495)
 * để lọt hoàn toàn một chuỗi Việt nhét vào object nội suy — cổng vẫn xanh. Nên (c) không
 * miễn dòng mang hình dạng thuộc tính object (`LA_THUOC_TINH_OBJECT`), và 5 dòng ở
 * `lineView/LineCommandBar.tsx` quay lại được đếm.
 *
 * ⚠ 5 dòng ấy KHÔNG phải lỗi — chúng là `t(khoá, {…}[c])`, object được index rồi mới truyền
 * vào nên vẫn ở vị trí mặc định. Nhưng chúng KHÔNG PHÂN BIỆT ĐƯỢC với đối số nội suy nếu chỉ
 * nhìn theo dòng, mà một cái thước phải chọn: hoặc bỏ sót nội suy thật, hoặc đếm dôi 5 mục
 * lành. **Chọn đếm dôi.** Một thước hơi chặt làm phiền người viết; một thước có lỗ thì im
 * lặng — và mọi bài học đắt nhất của repo này đều đến từ vế thứ hai. (Sáu chuỗi ấy trùng
 * nguyên văn `vi.json`; bỏ hẳn default thì mất lưới an toàn cho khuôn khoá-template mà
 * `i18n-check.mjs` vốn mù, nên để nguyên và tính là nợ.)
 *
 * ⚠ Vì sao hạ hẳn xuống 500 chứ không giữ 619 cho "có chỗ thở": 619 sau khi vá thước là
 * 119 ô trống KHÔNG tương ứng với bất kỳ chuỗi nào. Đó đúng là khuôn "ngân sách tự thoả"
 * đã trả giá ở Pha 7 — nợ mới lẻn vào tận 119 mục mà cổng vẫn xanh. Nên ca "bám SÁT" dưới
 * đây đòi BẰNG ĐÚNG, cùng kỷ luật với `ALLOWED_RAW_VI_STRINGS` của hình dạng 1.
 */
/**
 * ⚠ 2026-08-21: số này TĂNG 234 → 240 mà KHÔNG có nợ mới. Thước đo vừa chính xác hơn.
 *
 * Luật cũ: *"dòng nào có `t(` thì bỏ qua CẢ DÒNG"* — đúng cho `t("khoá", "mặc định")`,
 * nhưng làm một dòng di trú MỘT PHẦN tàng hình vĩnh viễn:
 *     cond ? "Tăng" : cond2 ? t("k.giam", "Giảm") : t("k.onDinh", "Ổn định")
 * Chuỗi "Tăng" còn nguyên tiếng Việt mà cả dòng đã được miễn đếm. Bộ di trú tự đào
 * lỗ cho chính nó, và cổng khai xanh. Nay `goBoTCalls` gỡ thân `t(...)` rồi mới hỏi
 * "còn chữ Việt không" ⇒ 6 chuỗi trước đây vô hình hiện ra.
 *
 * Đây là cùng loại sự kiện với lượt 2026-08-18 (thước đếm DÔI 123 mục), chỉ ngược
 * dấu. Quy tắc "KHÔNG BAO GIỜ nâng" áp cho việc nâng để CHE NỢ; sửa thiết bị đo rồi
 * ghi lại số thật thì ngược lại — đó chính là điều quy tắc bảo vệ.
 */
const FROZEN_SHAPE3 = 57;

/**
 * ⚠ Bộ đếm hình-3 nay nằm ở `scripts/viStringScan.mjs` — MỘT nguồn sự thật.
 *
 * Trước đây logic này có bản sao trong scratchpad và hai bên ĐÃ lệch thật: bản sao
 * khai **623**, cổng khai **500** — chênh đúng 123 mục, vì bản sao thiếu phép miễn
 * trừ `t(` trải nhiều dòng thêm ở lượt 2026-08-18. Ai tin bản sao sẽ đi "sửa" 123
 * mục vốn đã đúng. Kế hoạch F12 đã cảnh báo trước điều này; giờ nó được cưỡng chế
 * bằng CẤU TRÚC chứ không bằng lời dặn.
 */

describe("F12 — hình dạng THỨ BA (bắt được nhờ nghiệm thu bằng mắt, không phải nhờ cổng)", () => {
  it(`không được phình quá ${FROZEN_SHAPE3} — đóng băng, KHÔNG phải mục tiêu`, () => {
    const { total, byFile } = demHinhDangBa();
    if (total > FROZEN_SHAPE3) console.error("[F12/hình-3] phình ở:", byFile.slice(0, 10));
    expect(total).toBeLessThanOrEqual(FROZEN_SHAPE3);
  });

  /**
   * Cùng kỷ luật với ca "bám SÁT" của hình dạng 1 (`ALLOWED_RAW_VI_STRINGS`): một cái
   * chốt chỉ siết được nếu số dư KHÔNG tồn tại. Chính 124 ô dư sinh ra từ sai số thiết
   * bị đo ở trên là bằng chứng — nợ mới có thể lẻn vào tận 124 mục mà cổng vẫn xanh.
   * Di trú xong một đợt thì ca này ĐỎ và bắt hạ số; đó là hành vi mong muốn.
   */
  it("ngân sách hình-3 phải bám SÁT số thật — số dư che mất nợ mới", () => {
    expect(FROZEN_SHAPE3).toBe(demHinhDangBa().total);
  });

  /**
   * ★ Canh chính THIẾT BỊ ĐO. Phép theo dõi `t(` nhiều dòng dựa trên đếm ngoặc; nếu nó
   * lạc, độ sâu không về 0 và cả phần đuôi file được miễn trừ trong im lặng — cổng sẽ
   * XANH HƠN mà không ai biết vì sao. Trần `TRAN_DONG_TRONG_MOT_T` chặn việc đó, và ca
   * này khẳng định trần CHƯA BAO GIỜ phải ra tay: chạm trần = phép đếm đang lạc thật.
   */
  it("phép theo dõi `t(` nhiều dòng KHÔNG được lạc — 0 lần chạm trần", () => {
    expect(demHinhDangBa().chamTran).toBe(0);
  });
});

describe("F12 — parity FILE-VỚI-FILE (bổ sung cho i18n-check.mjs, không thay thế)", () => {
  it("khoá có ở vi thì PHẢI có ở en và zh — bất biến, KHÔNG phải ngân sách", () => {
    // Đây là phép so file-với-file. `i18n-check.mjs` dựng tập khoá từ THAM CHIẾU
    // TRONG MÃ nên mù với khoá ghép động (`machineType_${type}`) và khoá lưu như dữ
    // liệu (`labelKey: "..."`). Lượt chạy đầu bắt được 4 khoá thuộc đúng hai khuôn đó.
    const vi = doc("vi"), en = doc("en"), zh = doc("zh");
    const thieu = Object.keys(vi).filter((k) => en[k] === undefined || zh[k] === undefined);
    expect(thieu).toEqual([]);
  });
});
