/**
 * ★★★ Pha 7 Task 9 (9a) — **LƯỢNG TỪ TRÊN TRỤC "BỀ RỘNG":**
 * ***∀ giá trị `bamMaDuPhong()` sinh ra: `length` ≤ bề rộng khai của `backup_codes.code`.***
 * (Tự khai `Pha 5` để `server/services/vram/vramPha5Gate.test.ts` kéo file này vào lượng từ
 *  *"mọi lưới tự khai một pha phải được §Cổng kiểm chung phủ"*.)
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ LỖ ĐÃ ĐO ĐƯỢC, KHÔNG PHẢI LO XA
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Task 8a để lại **một** đường ghi mã dự phòng: `twoFactorRouter` → `bamMaDuPhong()` → bcrypt PHC
 * dài **60**. Cột nhận nó rộng **20**. Đo được trên `aoi_management`, trong một giao dịch đã
 * ROLLBACK:
 *
 *     22001  value too long for type character varying(20)   (routine: varchar)
 *
 * ⇒ Từ lúc Task 8a xoá đường plaintext cho tới migration `0314`, **không ai** nhận được mã dự
 * phòng. Bằng chứng khớp: **8/8** tài khoản bật 2FA mà bảng `backup_codes` có **0 hàng**.
 * Và nó hỏng ở chỗ **đắt nhất**: `enable`/`regenerateBackupCodes` là đường **vào lại** khi mất
 * thiết bị 2FA.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ VÌ SAO ĐÂY LÀ MỘT LƯỢNG TỪ, KHÔNG PHẢI MỘT CON SỐ
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `varchar(255)` (QĐ-2 của chủ dự án) phủ bcrypt (60), argon2id (~97), scrypt (~101). Nhưng **255
 * vẫn là một lời hứa hình DANH SÁCH** — và lớp *"cái gì LIỆT KÊ thì luôn có phần tử thứ N+1"* đã
 * tái diễn **MƯỜI SÁU** lần. Nên ô §1 dưới đây **KHÔNG** viết tay số 60 và **KHÔNG** viết tay số
 * 255: nó đọc bề rộng từ `getTableColumns(backupCodes)` và độ dài từ **một lượt băm THẬT**. Đổi
 * `VONG_BAM`, đổi thuật toán băm, hay thu hẹp cột — bất kỳ cái nào — đều làm ô ấy ĐỎ.
 *
 * ⚠ §2 là vế **KHÔNG suy ra được từ mã**: drizzle khai 255 mà **DB thật** còn 20 thì `tsc` xanh,
 *   mọi ô đơn vị xanh, và `22001` chỉ xuất hiện **lúc chạy trên hệ thật** — đúng hình dạng của lỗ
 *   này. Nên §2 **ghi thật một hàng** vào DB test rồi dọn.
 */
import { describe, it, expect } from "vitest";
import { getTableColumns } from "drizzle-orm";
import { backupCodes } from "../../drizzle/schema";
import { bamMaDuPhong, sinhMaDuPhong, khopMaDuPhong } from "./backupCodeSecret";

/** Bề rộng khai của một cột `varchar` trong drizzle — **suy ra**, không chép tay. */
function beRongKhai(): number | undefined {
  const c = getTableColumns(backupCodes).code as unknown as { length?: number };
  return c.length;
}

describe("★★★ Task 9 §1 (9a) — ∀ mã đã băm phải VỪA bề rộng khai của `backup_codes.code`", () => {
  it("★★★ cầu chì — đọc được bề rộng khai, và nó là một SỐ (undefined ⇒ mọi ô dưới là chân lý rỗng)", () => {
    const w = beRongKhai();
    expect(
      typeof w,
      "không đọc được `length` của cột `code` từ drizzle — cột đã đổi sang `text`?\n" +
        "⚠ `text` làm `22001` bất khả THEO CẤU TẠO, nhưng cũng làm luật ∀ này MẤT VẾ SO SÁNH ⇒ RỖNG.\n" +
        "  Nếu đó là một quyết định có chủ ý (QĐ-2 chọn `varchar(255)`), nó phải được NÓI RA ở đây.",
    ).toBe("number");
    expect(w!).toBeGreaterThan(0);
  });

  it("★★★ ∀ — 32 lượt băm THẬT đều vừa bề rộng khai (không viết tay 60, không viết tay 255)", async () => {
    const w = beRongKhai()!;
    const daiNhat: { ma: string; dai: number } = { ma: "", dai: 0 };
    for (let i = 0; i < 32; i++) {
      const daBam = await bamMaDuPhong(sinhMaDuPhong());
      if (daBam.length > daiNhat.dai) {
        daiNhat.dai = daBam.length;
        daiNhat.ma = daBam;
      }
    }
    expect(
      daiNhat.dai,
      `hash dài ${daiNhat.dai} ký tự > bề rộng khai varchar(${w}) ⇒ mọi lượt ghi mã dự phòng sẽ ` +
        `ném 22001 LÚC CHẠY (đo được: đúng lỗi ấy với varchar(20) trước migration 0314).\n` +
        `  Nới cột, đừng cắt hash.`,
    ).toBeLessThanOrEqual(w);
    // Cầu chì ngược: một hash rỗng/quá ngắn nghĩa là `bamMaDuPhong` đã thôi băm thật.
    expect(daiNhat.dai, "hash quá ngắn — `bamMaDuPhong()` còn băm thật không?").toBeGreaterThanOrEqual(50);
  });

  it("★★ ĐỐI CHỨNG DƯƠNG — luồng băm/đối chiếu VẪN CHẠY (bản vá bề rộng không làm hỏng phép khớp)", async () => {
    const tho = sinhMaDuPhong();
    const daBam = await bamMaDuPhong(tho);
    expect(await khopMaDuPhong(tho, daBam), "mã vừa sinh không khớp lại chính nó").toBe(true);
    expect(await khopMaDuPhong(tho.toLowerCase(), daBam), "chuẩn hoá HOA đã hỏng").toBe(true);
    expect(await khopMaDuPhong("KHONGPHAI", daBam), "một mã SAI vẫn khớp ⇒ phép đối chiếu đã chết").toBe(false);
  });
});

describe("★★★ Task 9 §2 (9a) — DB THẬT: một hash 60 ký tự GHI ĐƯỢC vào `backup_codes.code`", () => {
  it("★★★ ghi được, đọc lại nguyên vẹn, rồi dọn (ô này ĐỎ khi migration 0314 CHƯA áp)", async () => {
    const { getDb } = await import("../db/connection");
    const db = await getDb();
    if (!db) {
      throw new Error(
        "không có DB test ⇒ ô này KHÔNG được im lặng bỏ qua: lỗ 9a chỉ hiện ra ở tầng DB.\n" +
          "  Dựng DB test: `node scripts/setup-test-db.mjs`.",
      );
    }
    const { sql } = await import("drizzle-orm");
    const daBam = await bamMaDuPhong(sinhMaDuPhong());

    // ⚠ `userId` cố ý là một số KHÔNG tồn tại: `backup_codes` **không** có khoá ngoại tới `users`
    //   (nợ CÓ TRƯỚC, đã khai ở §2.8 báo cáo Task 9 — KHÔNG vá ở lượt này). Nếu một ngày FK được
    //   thêm thì ô này ĐỎ, và đó là một câu ĐÚNG cần đọc, không phải một phiền toái.
    const idGia = -987654;
    try {
      await db.execute(
        sql`INSERT INTO backup_codes ("userId", code, "isUsed") VALUES (${idGia}, ${daBam}, false)`,
      );
      const doc = await db.execute(
        sql`SELECT code, length(code) AS dai FROM backup_codes WHERE "userId" = ${idGia}`,
      );
      const hang = (doc as unknown as Array<{ code: string; dai: number }>)[0];
      expect(hang, "ghi xong mà đọc lại không thấy hàng").toBeTruthy();
      expect(hang!.code, "giá trị bị CẮT NGẮN khi lưu ⇒ mã dự phòng sẽ không bao giờ khớp").toBe(daBam);
      expect(Number(hang!.dai)).toBe(daBam.length);
    } finally {
      await db.execute(sql`DELETE FROM backup_codes WHERE "userId" = ${idGia}`);
    }
  });
});
