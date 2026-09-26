/**
 * ════════════════════════════════════════════════════════════════════════════════════════════
 * ★★★ G4-A VIỆC 1 — **LỚP ①: KHÔNG AI GỬI `language`, VÀ MÁY CHỦ MẶC ĐỊNH TIẾNG ANH.**
 * ════════════════════════════════════════════════════════════════════════════════════════════
 *
 * Lỗ này có **hai nửa**, và vá một nửa thì nửa kia vẫn giữ nguyên hành vi sai:
 *   (a) `AIReportsPage.handleGenerate` gửi `{startDate, endDate}` cho **cả bốn tab** — không ô
 *       `language` nào;
 *   (b) `reportParamsSchema` khai `.default("en")`.
 * ⇒ Trong một nhà máy Việt Nam, **mọi** lượt bấm "Tạo báo cáo" là một lượt xin tiếng Anh, và
 *   người dùng **không có bề mặt nào** để chọn khác.
 *
 * ⚠⚠ §2 CANH NỬA (a) BẰNG MỘT **LƯỢNG TỪ TRÊN MÃ NGUỒN TRANG**, không bằng bốn ca liệt kê.
 * Hình dạng THẬT của lỗi là *"một ô thiếu, lặp lại y hệt ở cả bốn tab"* — tức lỗi của **cách viết**,
 * không của một tab cụ thể. Một lưới liệt kê bốn tab sẽ xanh vào ngày ai đó thêm tab thứ năm.
 * §2 hỏi: *"MỌI lượt `.mutate(...)` của trang có mang `language` không?"*.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { reportParamsSchema } from "./aiReportRouter";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GOC = path.resolve(HERE, "../..");
const TRANG = path.join(GOC, "client/src/pages/AIReportsPage.tsx");

const NGAY = { startDate: "2026-01-01", endDate: "2026-01-31" };

// ═══════════════════════════════════════════════════════════════════════════════════════════
// §1 — LƯỢC ĐỒ ĐANG CHẠY (hỏi bằng safeParse, không bằng regex trên mã nguồn)
// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("§1 — lược đồ tham số báo cáo", () => {
  it("KHÔNG khai `language` ⇒ mặc định **vi**, không phải `en`", () => {
    const r = reportParamsSchema.safeParse(NGAY);
    expect(r.success).toBe(true);
    expect(r.success && r.data.language).toBe("vi");
  });

  it("chấp nhận cả ba mã của hệ i18n — `zh` KHÔNG được bị từ chối", () => {
    // ⚠ Đây là nửa lỗ mà bản vá lớp ① tự đẻ ra nếu quên: trang nay GỬI ngôn ngữ giao diện, nên
    //   một phiên tiếng Trung sẽ gửi "zh"; enum hai giá trị cũ sẽ trả 400 BAD_REQUEST.
    for (const l of ["vi", "en", "zh"] as const) {
      const r = reportParamsSchema.safeParse({ ...NGAY, language: l });
      expect(r.success, `lược đồ TỪ CHỐI "${l}"`).toBe(true);
      expect(r.success && r.data.language).toBe(l);
    }
  });

  it("vẫn TỪ CHỐI một mã ngoài ba mã đã khai (không nới thành `z.string()`)", () => {
    expect(reportParamsSchema.safeParse({ ...NGAY, language: "fr" }).success).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// §2 — TRANG PHẢI GỬI `language` Ở **MỌI** LƯỢT GỌI
// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("§2 — AIReportsPage gửi ngôn ngữ giao diện, cho MỌI tab", () => {
  const src = fs.readFileSync(TRANG, "utf8");

  it("thiết bị đo còn nhìn thấy trang (cầu chì chống 'xanh trên file rỗng/đổi tên')", () => {
    expect(src.length).toBeGreaterThan(2000);
    expect(src).toContain("handleGenerate");
  });

  it("MỌI lượt `.mutate(x)` của trang dùng một biến CÓ ô `language`", () => {
    // Bắt tên biến truyền vào từng `.mutate(...)`. Lỗi cũ có hình dạng: bốn lượt `mutate(params)`
    // với `params` thiếu ô — nên phép kiểm phải đi từ **lượt gọi** ngược về **định nghĩa**.
    const bien = [...src.matchAll(/\.mutate\(\s*([A-Za-z_$][\w$]*)\s*\)/g)].map((m) => m[1]!);
    expect(bien.length, "không tìm thấy lượt `.mutate(` nào — lưới đang đo một trang khác").toBeGreaterThanOrEqual(4);
    for (const ten of new Set(bien)) {
      const khai = src.match(new RegExp(`const\\s+${ten}\\s*=\\s*\\{[\\s\\S]*?\\n\\s*\\};`));
      expect(khai, `không tìm thấy khai báo của \`${ten}\``).not.toBeNull();
      expect(khai![0], `\`${ten}\` truyền cho .mutate() KHÔNG có ô \`language\``).toContain("language:");
    }
  });

  it("ngôn ngữ lấy từ i18n ĐANG CHẠY, không phải một hằng số", () => {
    expect(src).toMatch(/language:\s*ngonNguBaoCao\(i18n\.language\)/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// §3 — QUY CHUẨN MÃ NGÔN NGỮ: mã vùng và mã lạ
// ═══════════════════════════════════════════════════════════════════════════════════════════
/**
 * `ngonNguBaoCao` sống trong một file `.tsx` của client (không import được từ đây mà không kéo cả
 * React). Lưới này khoá **luật** của nó bằng cách đối chiếu mã nguồn — và quan trọng hơn, khoá
 * **hướng rơi**: một mã lạ phải rơi về `vi`, KHÔNG phải `en`. Rơi về `en` chính là hình dạng của
 * lỗi vừa vá, chỉ khác chỗ đứng.
 */
describe("§3 — quy chuẩn mã ngôn ngữ rơi về `vi`, không phải `en`", () => {
  const src = fs.readFileSync(TRANG, "utf8");
  const than = src.match(/function ngonNguBaoCao\([\s\S]*?\n\}/)?.[0] ?? "";

  it("hàm quy chuẩn tồn tại và xử lý mã vùng (`vi-VN`, `zh-CN`)", () => {
    expect(than, "không tìm thấy `ngonNguBaoCao`").not.toBe("");
    expect(than).toContain('startsWith("en")');
    expect(than).toContain('startsWith("zh")');
  });

  it("nhánh RƠI VỀ là `vi` — dòng `return` cuối cùng không được là `en`", () => {
    const cuoi = [...than.matchAll(/return\s+"(vi|en|zh)"/g)].at(-1)?.[1];
    expect(cuoi, `nhánh rơi về đang là "${cuoi}"`).toBe("vi");
  });
});
