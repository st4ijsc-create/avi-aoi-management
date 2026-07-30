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
const ALLOWED_LEGACY_THROWS = 795; // ← task 6 lô 1/9 (ENTITY_NOT_FOUND đợt 2): 834 - 39 = 795

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

  it("không còn chuỗi 'Database not available' thô nào bị NÉM (throw) trong router", () => {
    // Task 5 đợt 1 (§4.5 đợt 1) đã di trú toàn bộ 209 chỗ `throw new
    // TRPCError({ code, message: "Database not available"/"DB not
    // available"/"Database not connected"/"...unavailable" })` sang
    // appError(code, "DB_UNAVAILABLE", undefined, message).
    //
    // ⚠ Regex SIẾT theo ngữ cảnh `new TRPCError({...` (không chỉ khớp
    // `message:` trần) — khác bản brief gốc. Lý do: server/routers/alertRouters.ts:53
    // có `return { breached, currentValue, message: "Database not available" }`
    // — đây là GIÁ TRỊ TRẢ VỀ của evaluateAlertSetting (đọc bởi scheduler +
    // endpoint test thủ công), KHÔNG phải lỗi ném ra, nên bị loại khỏi đợt di
    // trú (đổi nó là đổi kiểu trả về/hành vi, ngoài phạm vi "một mã, một
    // chuỗi, cơ học"). Regex trần `message:\s*["'\`](Database|DB) ...` sẽ báo
    // dương tính giả ở đúng dòng đó. Regex dưới đây chỉ bắt khi "message:" nằm
    // trong context `new TRPCError({` (bán kính 120 ký tự) — đúng thứ Step 7
    // muốn kiểm: throw thô còn sót, không phải bất kỳ field "message" nào.
    //
    // appError(..., "Database not available") truyền chuỗi ở vị trí tham số
    // thứ 4 dạng gọi hàm — không có "message:" — nên cũng không bị bắt nhầm.
    const rawThrowRe = /new TRPCError\(\{[\s\S]{0,120}?message:\s*["'`](?:Database|DB) (?:not available|not connected|unavailable)["'`]/gi;
    let hits = 0;
    const offenders: string[] = [];
    for (const file of walkTsFiles(ROUTERS_DIR)) {
      const src = readFileSync(file, "utf8");
      const n = (src.match(rawThrowRe) ?? []).length;
      if (n > 0) { hits += n; offenders.push(file.replace(ROUTERS_DIR, "")); }
    }
    if (hits > 0) console.error("[phủ mã lỗi] còn throw thô ở:", offenders);
    expect(hits).toBe(0);
  });
});
