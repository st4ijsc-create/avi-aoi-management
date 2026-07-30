/**
 * Sprint 5 §4.4 — CỔNG CHẶN HỒI QUY.
 *
 * "Di trú toàn bộ router" chỉ là lời hứa nếu không có gì đo nó. Test này đếm số
 * chỗ còn ném `new TRPCError` trực tiếp (chưa qua appError) và so với một ngân
 * sách GIẢM DẦN. Mỗi đợt di trú hạ hằng số; test ĐỎ nếu số TĂNG ⇒ router mới
 * không thể lặng lẽ thêm nợ. Đợt cuối hạ về 0.
 *
 * ⚠ KHÔNG được nâng hằng số này để test xanh. Nếu bạn thấy mình sắp làm vậy:
 * bạn vừa thêm một câu lỗi không dịch được cho người dùng Việt Nam. Dùng
 * appError() thay vì new TRPCError().
 *
 * Số đo tại thời điểm tạo cổng (task 4, sau khi task 3 đã di trú kbIngestRouter.ts
 * + kbStudioRouter.ts, 13 chỗ): 1043 chỗ `new TRPCError` trong 117 file
 * (loại `.test.ts`). Tự đo lại bằng:
 *   grep -rno "new TRPCError" server/routers --include=*.ts | grep -v "\.test\.ts" | wc -l
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Hạ số này mỗi khi di trú xong một đợt. Không bao giờ nâng lên. */
const ALLOWED_LEGACY_THROWS = 938; // ← task 5 lô 1/6 (DB_UNAVAILABLE): 1043 - 105 = 938

const ROUTERS_DIR = dirname(fileURLToPath(import.meta.url));

function walkTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) { out.push(...walkTsFiles(full)); continue; }
    if (name.endsWith(".ts") && !name.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

function countLegacyThrows(): { total: number; byFile: Array<[string, number]> } {
  const byFile: Array<[string, number]> = [];
  let total = 0;
  for (const file of walkTsFiles(ROUTERS_DIR)) {
    const n = (readFileSync(file, "utf8").match(/new TRPCError\(/g) ?? []).length;
    if (n > 0) { byFile.push([file.replace(ROUTERS_DIR, ""), n]); total += n; }
  }
  byFile.sort((a, b) => b[1] - a[1]);
  return { total, byFile };
}

describe("phủ mã lỗi trong server/routers", () => {
  it(`còn tối đa ${ALLOWED_LEGACY_THROWS} chỗ ném TRPCError trực tiếp`, () => {
    const { total, byFile } = countLegacyThrows();
    if (total > ALLOWED_LEGACY_THROWS) {
      // In ra file nặng nhất để đợt sau biết bắt đầu từ đâu.
      console.error("[phủ mã lỗi] còn nợ ở:", byFile.slice(0, 15));
    }
    expect(total).toBeLessThanOrEqual(ALLOWED_LEGACY_THROWS);
  });

  it("ngân sách KHÔNG được nới rộng hơn thực tế — số dư thừa che mất nợ mới", () => {
    // Ngân sách phải bám SÁT số thật. Nếu nó cao hơn thực tế, ai đó thêm một
    // `new TRPCError` mới sẽ lọt qua cổng mà không ai biết — cổng hoá vô dụng.
    // (Sửa so với brief gốc: bản gốc assert `total >= 0`, luôn đúng, không
    // kiểm gì. Bám sát bằng `toBe` mới thật sự là ngân sách.)
    const { total } = countLegacyThrows();
    expect(ALLOWED_LEGACY_THROWS).toBe(total);
  });
});
