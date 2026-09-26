/**
 * E1 (Sprint 5 §5) — BẤT BIẾN NGUỒN: mọi đường gán `timeframeHours` phải được canh
 * tính hữu hạn.
 *
 * ══════════════════════════════════════════════════════════════════════════════════
 * ⚠ VÌ SAO CẦN LƯỚI NÀY, KHI ĐÃ CÓ `predictiveMaintenanceService.rul.test.ts`
 * ══════════════════════════════════════════════════════════════════════════════════
 * Đo ngày 2026-08-21 bằng đột biến: **vô hiệu CẢ BA lớp guard** (`guard hội tụ` ở
 * `:541`, `Number.isFinite` ở `recommendedMaintenanceDate`, và ở
 * `predictedTimeframeHours`) — bộ test RUL vẫn **XANH 3/3**.
 *
 * Đó KHÔNG phải lỗi của bộ test đó: nó khoá HÀNH VI QUAN SÁT ĐƯỢC cho ba đầu vào thù
 * địch, và với những đầu vào ấy mã đi nhánh khác nên giá trị không hữu hạn không bao
 * giờ tới guard. Nói cách khác: **guard hội tụ hiện KHÔNG THỂ CHẠM TỚI** vì cả bốn nơi
 * gán đều đã tự canh. Nó là phòng vệ dư thừa cho *đường mới sau này* — đúng như
 * docstring của nó tự nói.
 *
 * Nhưng phòng vệ cho tương lai mà không ai canh thì tương lai đó không được bảo vệ:
 * ai thêm **đường gán thứ NĂM** không guard sẽ không làm đỏ bất cứ thứ gì, và lúc đó
 * `Math.round(-Infinity)` → `-Infinity`, `new Date(-Infinity)` → *Invalid Date* xuống
 * `recordMachineHealthSnapshot` — driver postgres-js/drizzle có thể ném `RangeError`.
 *
 * ⇒ Lưới này đọc MÃ NGUỒN thay vì chạy hàm, vì thứ cần canh là một **bất biến cấu
 *   trúc** ("không có đường gán nào không guard"), không phải một giá trị đầu ra.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const FILE = join(dirname(fileURLToPath(import.meta.url)), "predictiveMaintenanceService.ts");

/** Dòng GÁN cho `timeframeHours` (không tính khai báo `let`, không tính đọc). */
function dongGan(): Array<{ line: number; text: string }> {
  const out: Array<{ line: number; text: string }> = [];
  readFileSync(FILE, "utf8").split("\n").forEach((ln, i) => {
    const tr = ln.trim();
    if (tr.startsWith("//") || tr.startsWith("*") || tr.startsWith("/*")) return;
    // `timeframeHours = …` nhưng KHÔNG phải `let timeframeHours` và không phải `==`/`!=`
    if (!/\btimeframeHours\s*=(?!=)/.test(ln)) return;
    if (/\blet\s+timeframeHours/.test(ln)) return;
    out.push({ line: i + 1, text: tr });
  });
  return out;
}

describe("E1 — mọi đường gán `timeframeHours` phải canh tính hữu hạn", () => {
  it("cầu chì: phải THẤY đường gán, không thì lưới đang canh tập rỗng", () => {
    // Không có bước này, khẳng định dưới đây đúng một cách vô nghĩa (∀ trên tập rỗng)
    // — đúng lớp lỗi đã trả giá ở Pha 4 (glob rỗng ⇒ vitest im lặng, cổng khai xanh).
    expect(dongGan().length).toBeGreaterThanOrEqual(4);
  });

  it("★★★ KHÔNG đường gán nào thiếu canh hữu hạn", () => {
    const src = readFileSync(FILE, "utf8").split("\n");

    /**
     * Ngữ cảnh CỦA CHÍNH câu lệnh gán: dòng gán + các dòng thuộc điều kiện `if` bao
     * quanh nó. Dừng ngay khi gặp ranh giới câu lệnh trước (`;` cuối dòng, `}` đứng
     * một mình) hoặc comment.
     *
     * ⚠ Bản đầu lấy cứng 8 dòng phía trên và **ĐỘT BIẾN M1 SỐNG SÓT**: một đường gán
     * mới chèn ngay sau khối guard hội tụ được coi là "đã canh", vì cửa sổ 8 dòng nhìn
     * thấy `Number.isFinite` CỦA GUARD ĐÓ. Thước rộng quá thì nó chứng nhận cho thứ nó
     * không hề kiểm — đúng lớp lỗi "lượng từ tự thoả" của Pha 7.
     */
    const nganhCua = (line: number): string => {
      const acc = [src[line - 1]];
      for (let i = line - 2; i >= 0 && line - 1 - i <= 6; i--) {
        const tr = (src[i] ?? "").trim();
        if (tr === "" || tr === "}" || tr.endsWith(";") || tr.startsWith("//") || tr.startsWith("*") || tr.startsWith("/*")) break;
        acc.unshift(src[i]);
        if (/\bif\s*\(/.test(tr)) break; // đã tới đầu điều kiện
      }
      return acc.join("\n");
    };

    const khongCanh = dongGan().filter(({ line, text }) => {
      // Gán `null` luôn an toàn — chính là hành động mà guard thực hiện.
      if (/=\s*null\s*;?\s*$/.test(text)) return false;
      return !/Number\.isFinite/.test(nganhCua(line));
    });
    if (khongCanh.length) {
      console.error("[E1] đường gán KHÔNG canh hữu hạn:", khongCanh);
    }
    expect(khongCanh.map((x) => `${x.line}: ${x.text}`)).toEqual([]);
  });

  it("guard HỘI TỤ vẫn còn — lớp cuối trước Math.round()/new Date()", () => {
    // Ba nơi gán tự canh là "sâu" (mỗi nơi một lý do riêng). Guard hội tụ là chỗ DUY
    // NHẤT không phụ thuộc vào việc đọc-hiểu từng nhánh. Gỡ nó là gỡ lưới an toàn cho
    // mọi đường mới — nên nó phải có mặt, kể cả khi hôm nay không thể chạm tới.
    const src = readFileSync(FILE, "utf8");
    expect(src).toMatch(/if \(timeframeHours != null && !Number\.isFinite\(timeframeHours\)\) \{/);
    expect(src).toMatch(/rulMethod = "insufficient_data";/);
  });

  it("hai điểm ra CUỐI (`recommendedMaintenanceDate`, `predictedTimeframeHours`) vẫn tự canh", () => {
    // Bản vá thứ hai, ĐỘC LẬP với guard hội tụ — đúng ngay tại nơi `Math.round()` từng
    // "nuốt" -Infinity/NaN. Giữ cả hai là có chủ ý, không phải thừa.
    const src = readFileSync(FILE, "utf8");
    expect(src).toMatch(/const recommendedMaintenanceDate = timeframeHours != null && Number\.isFinite\(timeframeHours\)/);
    expect(src).toMatch(/predictedTimeframeHours: timeframeHours != null && Number\.isFinite\(timeframeHours\) \? Math\.round/);
  });
});
