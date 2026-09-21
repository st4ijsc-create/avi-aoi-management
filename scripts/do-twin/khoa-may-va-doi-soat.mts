#!/usr/bin/env -S npx tsx
/**
 * khoa-may-va-doi-soat.mts — **TRẢ MỘT DÒNG NỢ TRONG SỔ TRUY VẤN.**
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ CON SỐ ĐANG ĐƯỢC VIỆN DẪN, VÀ NÓ KHÔNG CÓ TRUY VẤN
 * ════════════════════════════════════════════════════════════════════════════
 * Hồ sơ đợt `0539a1823` ghi: *"**1.699/1.700** máy có khoá sống, đối soát **CẦN CẤP 0**"*.
 * Con số ấy được trích lại nhiều lần **mà không ai ghi lại truy vấn sinh ra nó** ⇒ nó đã rơi
 * vào đúng cái bẫy mà mục V-21(1) dạy:
 *
 * > **Bốn con số không có truy vấn thì không phải bằng chứng — nó là một tin đồn có chữ số
 * > thập phân.**
 *
 * Kịch bản này là truy vấn ấy, viết ra một lần cho xong.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★ ĐỊNH NGHĨA — phải viết ra, vì chính chỗ thiếu định nghĩa đã làm mất khả năng so sánh
 * ════════════════════════════════════════════════════════════════════════════
 * · **khoá sống**  := `machines.apiKey` khác `NULL` và khác rỗng (thực tế mọi khoá đều có
 *                     tiền tố `mach_`, kịch bản đếm luôn số khớp tiền tố để lộ nếu có khoá lạ).
 * · **cần cấp**    := máy `registrationStatus = 'approved'` **mà không có** khoá sống.
 *                     Đây mới là con số đáng lo: đã duyệt tức là đã hứa cho nó chạy.
 * · **không cần**  := máy chưa duyệt (`pending`/`rejected`) không có khoá — đúng như vậy.
 *
 * ⚠ Kịch bản **CHỈ ĐỌC**. Cấp khoá là một hành động vận hành có hậu quả thật (mỗi khoá là một
 *   danh tính được phép nói chuyện với hệ thống) — nó phải là một quyết định, không phải một
 *   hệ quả phụ của việc chạy một phép đo.
 */
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("Thiếu DATABASE_URL.");
  process.exit(1);
}
const sql = postgres(url, { max: 1, connect_timeout: 30, onnotice: () => {} });

try {
  const [t] = await sql<
    {
      tong: number; hoat_dong: number; duyet: number; cho: number; tu_choi: number;
      co_khoa: number; khoa_mach: number; can_cap: number; khoa_chua_duyet: number;
    }[]
  >`SELECT
      count(*)::int AS tong,
      count(*) FILTER (WHERE "isActive")::int AS hoat_dong,
      count(*) FILTER (WHERE "registrationStatus" = 'approved')::int AS duyet,
      count(*) FILTER (WHERE "registrationStatus" = 'pending')::int AS cho,
      count(*) FILTER (WHERE "registrationStatus" = 'rejected')::int AS tu_choi,
      count(*) FILTER (WHERE "apiKey" IS NOT NULL AND "apiKey" <> '')::int AS co_khoa,
      count(*) FILTER (WHERE "apiKey" LIKE 'mach\\_%')::int AS khoa_mach,
      count(*) FILTER (WHERE "registrationStatus" = 'approved'
                         AND ("apiKey" IS NULL OR "apiKey" = ''))::int AS can_cap,
      count(*) FILTER (WHERE "registrationStatus" <> 'approved'
                         AND "apiKey" IS NOT NULL AND "apiKey" <> '')::int AS khoa_chua_duyet
    FROM machines`;

  console.log("── ĐỐI SOÁT KHOÁ MÁY ──");
  console.log(`  tổng máy                 ${String(t.tong).padStart(6)}`);
  console.log(`    đang hoạt động         ${String(t.hoat_dong).padStart(6)}`);
  console.log(`    đã duyệt (approved)    ${String(t.duyet).padStart(6)}`);
  console.log(`    chờ duyệt / từ chối    ${String(t.cho).padStart(6)} / ${t.tu_choi}`);
  console.log(`  có KHOÁ SỐNG             ${String(t.co_khoa).padStart(6)}  (khớp tiền tố mach_: ${t.khoa_mach})`);
  console.log(`  ★ CẦN CẤP (duyệt mà KHÔNG có khoá)  ${String(t.can_cap).padStart(6)}`);
  console.log(`  ⚠ có khoá mà CHƯA duyệt             ${String(t.khoa_chua_duyet).padStart(6)}`);

  console.log("\n── ĐỐI CHIẾU VỚI CON SỐ ĐANG ĐƯỢC VIỆN DẪN ──");
  console.log(`  hồ sơ 0539a1823 ghi:  khoá sống 1.699/1.700 · CẦN CẤP 0`);
  console.log(`  đo hôm nay        :  khoá sống ${t.co_khoa}/${t.tong} · CẦN CẤP ${t.can_cap}`);
  if (t.co_khoa !== 1699 || t.can_cap !== 0) {
    console.log(
      "  ⇒ ❌ **KHÔNG KHỚP.** Con số cũ đã hết hạn kiểm chứng. Không kết luận được là\n" +
        "     'hồi quy' hay 'dữ liệu đã seed lại' — vì hồ sơ cũ **không ghi truy vấn** nên\n" +
        "     không có cách nào so cùng một định nghĩa. Đây đúng là cái giá của việc trích\n" +
        "     một con số mà không trích phép đo.",
    );
  } else {
    console.log("  ⇒ ✅ khớp.");
  }
  // Mã thoát PHẢN ÁNH ĐỐI SOÁT, không phản ánh "kịch bản chạy xong".
  process.exitCode = t.can_cap === 0 ? 0 : 1;
} catch (e) {
  console.error("LỖI:", String(e).slice(0, 300));
  process.exitCode = 2;
}
await sql.end();
