#!/usr/bin/env node
/**
 * scripts/kiem-di-san-ban.mjs — BG-127 (Khối C, "nợ còn mở", 2026-09-05).
 *
 * ⚠ CỔNG TIÊN QUYẾT: chạy trước khi bật `SPEC_GATE_SNAPSHOT_ENABLED` ở một DB
 * MỚI (chưa từng bật cờ này) — PHẢI = 0 rồi mới bật.
 *
 * ★★★ v2 (2026-09-05, review coordinator — Critical 1) — v1 của câu đếm này
 * (`d."variantId" IS NOT NULL`) SAI QUẦN THỂ: `recordVariantOverrideVersion`
 * (`server/db/product.ts`) LUÔN ghi `pointDefId = basePointDefId` — điểm nó ghi
 * vào LUÔN LÀ điểm BASE (`variantId IS NULL`, xem docblock tại chỗ khai
 * `basePointDefId`/`variantId` — `server/db/product.ts:397-398`), KHÔNG BAO GIỜ
 * là một điểm có `variantId IS NOT NULL` (đó là điểm variant TỰ THÊM — một quần
 * thể HOÀN TOÀN KHÁC). v1 vì vậy đếm SAI BẢNG và luôn trả 0 bất kể sự thật —
 * đúng lớp "cổng xanh vì mù" (đo được: chính lưới
 * `server/db/lienKetBoTrongBienThe.db.test.ts` tạo điểm KHÔNG `variantId` rồi
 * gọi thẳng hàm này, và không một hàng nào trong đó có `variantId IS NOT NULL`).
 *
 * WHERE ĐÚNG (v2): điểm BASE (`d."variantId" IS NULL`) có `changeReason` khớp
 * ĐÚNG chuỗi literal mà `recordVariantOverrideVersion` từng ghi TRƯỚC bản vá
 * NEW-3 (`02676ea2`). Đo lại bằng git history (không tin danh sách đoán) —
 * `git show 02676ea2^:server/routers/productVariantRouter.ts` (điểm gọi DUY
 * NHẤT của hàm này trước bản vá, xác nhận bằng
 * `git grep recordVariantOverrideVersion( 02676ea2^ -- server/`) cho thấy hàng
 * TRƯỚC bản vá luôn mang đúng MỘT dạng:
 *
 *     changeReason: `productVariant.setOverride (variant #${input.variantId})`
 *
 * — một template string có nội suy `variantId`, KHÔNG PHẢI một trong ba chuỗi
 * literal cố định.
 *
 * ── ĐỐI CHIẾU với 3 chuỗi literal ('productVariant.setOverride' /
 * '…setOverride(exclude)' / '…removeOverride', xác nhận bởi phiên -46 tại
 * `productVariantRouter.ts:481/555` HÔM NAY) ─────────────────────────────────
 * Ba chuỗi đó CÓ THẬT trong mã HIỆN HÀNH — nhưng đo bằng
 * `git merge-base --is-ancestor 02676ea2 3367b4b6` (✔ đúng) + `git show 3367b4b6
 * -- server/routers/productVariantRouter.ts` cho thấy CẢ BA chỉ xuất hiện ở
 * commit `3367b4b6` (NEW-4) — SAU `02676ea2` (NEW-3) đã gắn tiền tố. Ba đường
 * gọi đó (exclude/removeOverride, và override-với-literal-rút-gọn) vì vậy
 * KHÔNG BAO GIỜ ghi hàng thiếu tiền tố: `recordVariantOverrideVersion` (đã có
 * logic gắn `[VARIANT:<id>]` từ `02676ea2`) LUÔN bọc chúng thành ví dụ
 * `"[VARIANT:7] productVariant.setOverride"` trước khi ghi — ba chuỗi literal
 * đó chỉ là PHẦN HẬU TỐ sau tiền tố, không bao giờ đứng trơ trọi trong cột
 * `changeReason`. ⇒ Hai mô hình (regex legacy CỦA TÔI và ba-literal CỦA -46)
 * KHÔNG mâu thuẫn — chúng mô tả hai GIAI ĐOẠN khác nhau của cùng một call site:
 * -46 mô tả literal CALLER truyền vào `options.changeReason` (hậu tố, luôn có
 * tiền tố kèm theo từ `02676ea2` trở đi); tôi mô tả chuỗi THỰC SỰ NẰM TRONG
 * CỘT khi KHÔNG có tiền tố (chỉ xảy ra ở cửa sổ `fa2769a3..02676ea2`, một call
 * site duy nhất, dạng duy nhất). Regex bên dưới khớp CHÍNH XÁC dạng duy nhất
 * từng có thể ghi TRẦN (không tiền tố):
 * `^productVariant\.setOverride \(variant #\d+\)$`. Kèm `NOT LIKE '[VARIANT:%'`
 * cho chắc (phòng thủ kép, dù về logic đã loại trừ sẵn).
 *
 * `layChangeReasonBatThuongVungBienThe()` bên dưới là LƯỚI AN TOÀN bổ sung
 * (Important 3, coordinator): liệt kê MỌI `changeReason` chưa xếp được vào
 * "đã tag" hay "khớp regex legacy" trong vùng điểm đã dính variant-override —
 * kể cả nếu SAU NÀY xuất hiện một điểm gọi/literal thứ tư, script này KÊU
 * thay vì im lặng bỏ sót (đúng bài học "liệt kê thay vì lọc" — không tự động
 * cộng vào `di_san_ban`, chỉ cảnh báo để người xem lại).
 *
 * ⚠ GOTCHA riêng của FILE NÀY (đo được khi viết `kiem-di-san-ban.test.ts` —
 * xem chú thích tại `demDiSanBan`): backslash MỘT dấu trong một JS template
 * literal (`` `\.` ``/`` `\(` ``) bị JS ÂM THẦM RỤNG (không phải escape sequence
 * hợp lệ) — PHẢI viết `\\.`/`\\(`/`\\)` (backslash ĐÔI) để Postgres nhận đúng
 * MỘT backslash cho regex POSIX.
 *
 * Luật Đ-28: mọi số đo DB phải kèm `current_database()` — MỌI dòng output dưới
 * đây đều in nó.
 *
 * Test: `scripts/kiem-di-san-ban.test.ts` — import `demDiSanBan` trực tiếp
 * (không qua CLI), seed 1 ca dương (hàng legacy không tag) + 3 ca âm (tag
 * `[VARIANT:]` · base edit bình thường · điểm variant TỰ THÊM mang y hệt chuỗi
 * legacy — chính hình dạng mà v1 SAI đã đếm nhầm) trên DB test thật.
 *
 * Dùng:
 *   node scripts/kiem-di-san-ban.mjs                  # đọc DATABASE_URL từ .env
 *   node scripts/kiem-di-san-ban.mjs --db <url>        # trỏ DB khác
 *
 * Exit 0 khi đếm = 0 (an toàn bật cờ). Exit 1 khi > 0 (DỪNG — xử lý trước khi bật).
 */
import "dotenv/config";
import postgres from "postgres";
import { fileURLToPath } from "node:url";
import path from "node:path";

/**
 * Đếm "di sản bẩn" — hàng `measurement_point_versions` của một điểm BASE
 * (`variantId IS NULL`) mà `changeReason` khớp ĐÚNG dạng legacy
 * `recordVariantOverrideVersion` từng ghi TRƯỚC `02676ea2` (không tiền tố
 * `[VARIANT:]`). Nhận thẳng một client `postgres` (sql tagged-template) đã mở
 * kết nối — KHÔNG tự mở/đóng kết nối (để test dùng lại được kết nối của nó).
 * CHỈ `count(*)::int` — không đọc bất kỳ cột timestamp nào (postgres-js RAW
 * parse cột `timestamp` theo TZ của TIẾN TRÌNH, không phải TZ của DB — GOTCHA
 * cùng họ BG-96/99).
 *
 * @param {import('postgres').Sql} sql
 * @returns {Promise<number>}
 */
export async function demDiSanBan(sql) {
  // ⚠ GOTCHA đo được khi viết lưới cho CHÍNH hàm này (`kiem-di-san-ban.test.ts`):
  // regex KHÔNG được viết với một-backslash bên trong một template literal JS
  // (`` `...\.` ``) — `\.`/`\(`/`\)` không phải escape sequence hợp lệ của JS
  // nên JS ÂM THẦM RỤNG dấu backslash (ES spec: NonEscapeCharacter), gửi xuống
  // Postgres một regex KHÔNG hề có backslash nào (`(variant` mở một GROUP
  // không bao giờ đóng ⇒ `invalid regular expression: parentheses () not
  // balanced`, ném lỗi thẳng ở ca đầu — ca "dot only" ngắn hơn thì ÂM THẦM
  // SAI mà vẫn tình cờ trả đúng vì `.` không escape vẫn khớp một dấu chấm
  // thật). PHẢI dùng `\\.`/`\\(`/`\\)` (backslash ĐÔI trong JS) để JS thật sự
  // gửi đúng MỘT backslash xuống Postgres.
  const [{ n }] = await sql`
    SELECT count(*)::int AS n
    FROM measurement_point_versions v
    JOIN measurement_point_defs d ON d.id = v."pointDefId"
    WHERE d."variantId" IS NULL
      AND v."changeReason" ~ '^productVariant\\.setOverride \\(variant #[0-9]+\\)$'
      AND v."changeReason" NOT LIKE '[VARIANT:%'
  `;
  return n;
}

/**
 * ★★★ Cân nhắc rẻ (2026-09-05, theo góp ý coordinator, Important 3) — LƯỚI AN
 * TOÀN chống đúng lớp lỗi mà Critical 1 vừa vá thuộc về: "lọc thay vì liệt kê"
 * làm bộ dò MÙ với một literal changeReason legacy THỨ TƯ (hoặc thứ N) mà
 * không ai từng nghĩ tới khi viết regex ở `demDiSanBan`.
 *
 * Liệt kê MỌI `changeReason` KHÔNG rỗng trong lịch sử của các điểm ĐÃ BIẾT có
 * dính tới cơ chế variant-override — (a) có mặt trong `variant_point_overrides`
 * (override đang hiệu lực HÔM NAY) HOẶC (b) có ít nhất một hàng version đã
 * mang tiền tố `[VARIANT:]` (từng bị `recordVariantOverrideVersion` ghi vào,
 * dù override đó có còn hiệu lực hay không) — mà KHÔNG khớp tiền tố `[VARIANT:]`
 * VÀ KHÔNG khớp regex legacy đã biết ở `demDiSanBan`. Đây LÀ danh sách "chưa
 * biết đây là gì" — không tự động cộng vào `demDiSanBan` (không đủ bằng chứng
 * để khẳng định NÓ LÀ di sản bẩn, có thể chỉ là một base-edit bình thường VÔ
 * TÌNH đứng cùng điểm với một override cũ) — chỉ CẢNH BÁO để người vận hành tự
 * xem lại trước khi tin cổng này = xanh.
 *
 * ⚠ GIỚI HẠN: tập loại trừ ("đã biết là gì") suy TỪ HEAD hiện tại của
 * `server/db/product.ts`/`server/routers/productVariantRouter.ts`
 * (2026-09-05). Thêm một điểm gọi `recordVariantOverrideVersion` MỚI với
 * changeReason KHÁC hình dạng ⇒ phải cập nhật lại nhận định này (hàm KHÔNG tự
 * suy được điểm gọi mới trong tương lai — đây là danh sách "đo được HÔM NAY",
 * không phải một bất biến toán học).
 *
 * @param {import('postgres').Sql} sql
 * @returns {Promise<Array<{ reason: string; n: number }>>}
 */
export async function layChangeReasonBatThuongVungBienThe(sql) {
  return sql`
    SELECT v."changeReason" AS reason, count(*)::int AS n
    FROM measurement_point_versions v
    WHERE v."changeReason" IS NOT NULL
      AND v."pointDefId" IN (
        SELECT "basePointDefId" FROM variant_point_overrides
        UNION
        SELECT DISTINCT "pointDefId" FROM measurement_point_versions WHERE "changeReason" LIKE '[VARIANT:%'
      )
      AND v."changeReason" NOT LIKE '[VARIANT:%'
      AND v."changeReason" !~ '^productVariant\\.setOverride \\(variant #[0-9]+\\)$'
    GROUP BY v."changeReason"
    ORDER BY n DESC
  `;
}

function layDbUrlTuArgv() {
  const i = process.argv.indexOf("--db");
  if (i !== -1 && process.argv[i + 1]) return process.argv[i + 1];
  return process.env.DATABASE_URL;
}

const che = (u) => u.replace(/:[^:@]*@/, ":***@");

async function main() {
  const url = layDbUrlTuArgv();
  if (!url) {
    console.error("DỪNG: thiếu DATABASE_URL (env hoặc --db <url>).");
    process.exit(1);
    return;
  }

  const sql = postgres(url, { max: 1, connect_timeout: 30, onnotice: () => {} });
  try {
    const [{ db: tenDb }] = await sql`SELECT current_database() AS db`;
    console.log(`[current_database=${tenDb}] kiem-di-san-ban v2 (BG-127): ${che(url)}`);

    const n = await demDiSanBan(sql);
    console.log(`[current_database=${tenDb}] di_san_ban = ${n}`);

    // Important 3 (coordinator) — cảnh báo (KHÔNG chặn/không đổi exit code)
    // khi gặp changeReason chưa biết ở vùng điểm đã dính variant-override —
    // phòng literal thứ N mà regex ở `demDiSanBan` chưa biết tới.
    try {
      const la = await layChangeReasonBatThuongVungBienThe(sql);
      if (la.length > 0) {
        console.warn(
          `[current_database=${tenDb}] ⚠ CẢNH BÁO — ${la.length} changeReason CHƯA BIẾT ở vùng điểm đã dính variant-override ` +
            `(không tự tính vào di_san_ban — xem lại thủ công):`,
        );
        for (const r of la) console.warn(`  - "${r.reason}" ×${r.n}`);
      }
    } catch (err) {
      console.warn(`[current_database=${tenDb}] (bỏ qua cảnh báo phụ — không đọc được variant_point_overrides: ${err?.message ?? err})`);
    }

    if (n === 0) {
      console.log(`[current_database=${tenDb}] OK — 0 hàng bẩn. An toàn bật SPEC_GATE_SNAPSHOT_ENABLED ở DB này.`);
      await sql.end();
      process.exit(0);
      return;
    }
    console.error(
      `[current_database=${tenDb}] DỪNG — ${n} hàng bẩn (di sản NEW-3 chưa hồi tố). ` +
        `KHÔNG bật SPEC_GATE_SNAPSHOT_ENABLED trước khi xử lý các hàng này.`,
    );
    await sql.end();
    process.exit(1);
  } catch (err) {
    console.error("LỖI khi đếm di sản bẩn:", err?.message ?? err);
    await sql.end({ timeout: 5 }).catch(() => {});
    process.exit(1);
  }
}

// Chạy CHỈ khi gọi trực tiếp bằng `node scripts/kiem-di-san-ban.mjs` — import
// từ test (`demDiSanBan`) không kích hoạt kết nối/exit (cùng khuôn
// `scripts/fetch-models.mjs`).
const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main();
}
