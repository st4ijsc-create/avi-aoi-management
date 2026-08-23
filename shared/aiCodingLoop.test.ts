/**
 * ★★★ doc 79 · VÒNG TỰ ĐỘNG — LƯỚI CHO **CẦU CHÌ**, chạy thẳng trên chính sách thuần.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ĐỘT BIẾN FILE NÀY PHẢI BẮT ĐƯỢC (đã chạy thật, xem báo cáo đợt):
 *   • bỏ TRẦN            (`quyetDinhTiep` không xét `luot >= tran`)         ⇒ §2 ĐỎ
 *   • bỏ DỪNG-KHÔNG-TIẾN-BỘ (bỏ nhánh `doKhongGiam || dauRaLap`)            ⇒ §3 ĐỎ
 *   • đổi HOẶC thành VÀ ở hai tín hiệu không-tiến-bộ                        ⇒ §3 ĐỎ (hai ca riêng)
 *   • `xanh` chỉ nhìn mã thoát (bỏ vế "số ca đỏ = 0")                       ⇒ §1 ĐỎ
 *   • bỏ chuẩn hoá thời gian chạy trước khi băm đầu ra                      ⇒ §3 ĐỎ (ca "cùng lỗi,
 *     khác thời gian chạy" — không có chuẩn hoá thì cầu chì thứ hai KHÔNG BAO GIỜ nổ)
 *
 * ⚠ Đây là chỗ DUY NHẤT phát biểu được các cầu chì ấy thành phép đo: bộ điều khiển vòng sống ở
 *   client (một cú bấm của người nằm GIỮA hai lượt, luồng SSE không chờ qua đó được), và một quyết
 *   định dừng nằm rải trong một component React là một quyết định không ai đo được.
 */
import { describe, it, expect } from "vitest";
import {
  TRAN_VONG_MAC_DINH,
  TRAN_VONG_TOI_DA,
  TRAN_VONG_TOI_THIEU,
  TRAN_LOI_VAO_PROMPT,
  bamChuoi,
  catLoiChoPrompt,
  chuanHoaDauRa,
  deXuatLapLai,
  docKetQuaTest,
  kepTranVong,
  ketLuanTest,
  quyetDinhTiep,
  type TrangThaiSauTest,
} from "./aiCodingLoop";

/** Trạng thái "lượt 1, chưa có gì để so" — mọi ca chỉ ghi đè phần nó đang đo. */
function nen(p: Partial<TrangThaiSauTest> = {}): TrangThaiSauTest {
  return {
    luot: 1, tran: 3, xanh: false, soDo: null, soDoTruoc: null,
    bamDauRa: null, bamDauRaTruoc: null, ...p,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("§1 — ĐỌC ĐẦU RA THẬT (bốn bộ chạy, và một bộ KHÔNG in số nào)", () => {
  it("★★★ `dotnet test` HỎNG — đọc đúng 2 đỏ / 4 xanh, và KHÔNG xanh", () => {
    const out = "Failed!  - Failed:     2, Passed:     4, Skipped:     0, Total:     6, Duration: 12 ms";
    const r = docKetQuaTest(out, 1);
    expect(r.soDo).toBe(2);
    expect(r.soXanh).toBe(4);
    expect(r.xanh).toBe(false);
  });

  it("★★★ `dotnet test` XANH — 0 đỏ / 6 xanh, mã thoát 0 ⇒ XANH", () => {
    const out = "Passed!  - Failed:     0, Passed:     6, Skipped:     0, Total:     6, Duration: 9 ms";
    const r = docKetQuaTest(out, 0);
    expect(r).toEqual({ xanh: true, soDo: 0, soXanh: 6 });
  });

  it("★★ `node --test` (tap) và (spec) — cùng cho ra 2 đỏ / 4 xanh", () => {
    const tap = "# tests 6\n# suites 0\n# pass 4\n# fail 2\n";
    const spec = "ℹ tests 6\nℹ suites 0\nℹ pass 4\nℹ fail 2\n";
    for (const out of [tap, spec]) {
      const r = docKetQuaTest(out, 1);
      expect(r.soDo, out).toBe(2);
      expect(r.soXanh, out).toBe(4);
    }
  });

  it("★★ `npx vitest run` — cả dạng có failed lẫn dạng toàn xanh", () => {
    expect(docKetQuaTest("Tests  2 failed | 4 passed (6)", 1).soDo).toBe(2);
    const xanh = docKetQuaTest("Tests  6 passed (6)", 0);
    expect(xanh.soDo).toBe(0);
    expect(xanh.xanh).toBe(true);
  });

  it("★★★ `tsc` (npm run check) KHÔNG in con số nào ⇒ `soDo=null`, và đó là câu trả lời ĐÚNG", () => {
    const r = docKetQuaTest("server/x.ts(10,3): error TS2339: Property 'a' does not exist.", 2);
    expect(r.soDo).toBeNull();
    expect(r.soXanh).toBeNull();
    expect(r.xanh).toBe(false);
    // Và khi tsc sạch: mã thoát 0, không số nào ⇒ VẪN phải là XANH (nếu không, vòng không bao giờ dừng nổi).
    expect(docKetQuaTest("", 0).xanh).toBe(true);
  });

  /**
   * ⚠⚠ FAIL-CLOSED. Một bộ chạy trả mã thoát 0 mà bảng tổng kết vẫn khai "Failed: 2" là MÂU THUẪN
   * (đã gặp với runner cấu hình sai `--no-build`). Báo "xong" rồi dừng vòng trên một hệ còn hỏng là
   * hỏng ÂM THẦM; coi là CHƯA xanh thì tệ nhất chỉ tốn thêm một lượt.
   */
  it("★★★ mã thoát 0 NHƯNG đầu ra khai còn ca đỏ ⇒ KHÔNG coi là xanh", () => {
    expect(docKetQuaTest("Failed: 2, Passed: 4", 0).xanh).toBe(false);
  });

  it("★★★ QUÁ HẠN ⇒ KHÔNG BAO GIỜ xanh (đầu ra là bản CẮT của một lệnh chưa xong)", () => {
    expect(docKetQuaTest("Passed!  - Failed: 0, Passed: 6", 0, true).xanh).toBe(false);
  });

  it("★ đầu ra null/rỗng + mã thoát null ⇒ không xanh, không số (không ném)", () => {
    expect(docKetQuaTest(null, null)).toEqual({ xanh: false, soDo: null, soXanh: null });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("§2 — TRẦN VÒNG LẶP (cầu chì thứ nhất)", () => {
  it("★★★ chạm trần ⇒ DỪNG với lý do `het_tran` — bỏ nhánh này thì vòng chạy vô hạn", () => {
    expect(quyetDinhTiep(nen({ luot: 3, tran: 3 }))).toEqual({ tiep: false, lyDo: "het_tran" });
  });

  it("★★ chưa chạm trần và CÓ tiến bộ ⇒ đi tiếp", () => {
    expect(quyetDinhTiep(nen({ luot: 1, tran: 3, soDo: 1, soDoTruoc: 2 }))).toEqual({ tiep: true, lyDo: null });
  });

  it("★★★ XANH ở đúng lượt cuối ⇒ lý do là `xanh`, KHÔNG phải `het_tran`", () => {
    expect(quyetDinhTiep(nen({ luot: 3, tran: 3, xanh: true })).lyDo).toBe("xanh");
  });

  it("★★★ trần kẹp về [1..5]; đầu vào méo ⇒ mặc định (một `.env` gõ sai không được làm chết vòng)", () => {
    expect(kepTranVong("9")).toBe(TRAN_VONG_TOI_DA);
    expect(kepTranVong("0")).toBe(TRAN_VONG_TOI_THIEU);
    expect(kepTranVong("-4")).toBe(TRAN_VONG_TOI_THIEU);
    expect(kepTranVong("4")).toBe(4);
    for (const xau of [undefined, null, "", "ba", NaN, Infinity, {}]) {
      expect(kepTranVong(xau), String(xau)).toBe(TRAN_VONG_MAC_DINH);
    }
    expect(TRAN_VONG_MAC_DINH).toBeLessThanOrEqual(TRAN_VONG_TOI_DA);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("§3 — KHÔNG TIẾN BỘ (cầu chì thứ hai) — BA tín hiệu, nối bằng HOẶC", () => {
  it("★★★ số ca đỏ KHÔNG GIẢM ⇒ DỪNG", () => {
    expect(quyetDinhTiep(nen({ luot: 1, tran: 5, soDo: 2, soDoTruoc: 2 })).lyDo).toBe("khong_tien_bo");
  });

  it("★★★ số ca đỏ TĂNG ⇒ DỪNG (bản sửa làm hỏng thêm — đi tiếp là đào sâu hơn)", () => {
    expect(quyetDinhTiep(nen({ luot: 1, tran: 5, soDo: 3, soDoTruoc: 2 })).lyDo).toBe("khong_tien_bo");
  });

  it("★★★ ĐẦU RA LẶP LẠI y hệt ⇒ DỪNG, KỂ CẢ khi không đọc được số ca nào (ca của `tsc`)", () => {
    const b = bamChuoi("error TS2339");
    const r = quyetDinhTiep(nen({ luot: 1, tran: 5, soDo: null, soDoTruoc: null, bamDauRa: b, bamDauRaTruoc: b }));
    expect(r.lyDo, "đếm-ca mù với tsc — nếu hai tín hiệu nối bằng VÀ thì vị từ này TỰ THOẢ").toBe("khong_tien_bo");
  });

  it("★★ CHỐNG VÁ QUÁ TAY — đầu ra KHÁC và số đỏ GIẢM ⇒ vẫn đi tiếp", () => {
    const r = quyetDinhTiep(nen({ luot: 1, tran: 5, soDo: 1, soDoTruoc: 2, bamDauRa: "a", bamDauRaTruoc: "b" }));
    expect(r).toEqual({ tiep: true, lyDo: null });
  });

  it("★★★ lượt ĐẦU (chưa có gì để so) KHÔNG được coi là 'không tiến bộ'", () => {
    expect(quyetDinhTiep(nen({ luot: 1, tran: 3, soDo: 2 })).tiep).toBe(true);
  });

  /**
   * ⚠⚠ CA NÀY CANH CHÍNH THIẾT BỊ ĐO. `dotnet test` in `Duration: 1912 ms` — hai lượt HỎNG Y HỆT
   * cho hai chuỗi khác nhau. Không chuẩn hoá ⇒ băm luôn khác ⇒ cầu chì thứ hai KHÔNG BAO GIỜ nổ
   * và ta có một hàng rào chỉ tồn tại trên giấy.
   */
  it("★★★ CÙNG lỗi, KHÁC thời gian chạy ⇒ vẫn nhận ra là LẶP LẠI", () => {
    const a = "Failed: 2, Passed: 4, Duration: 1912 ms\nAssert.Throws() Failure";
    const b = "Failed: 2, Passed: 4, Duration: 2043 ms\nAssert.Throws() Failure";
    expect(bamChuoi(chuanHoaDauRa(a))).toBe(bamChuoi(chuanHoaDauRa(b)));
    expect(bamChuoi(a)).not.toBe(bamChuoi(b)); // đối chứng: KHÔNG chuẩn hoá thì khác nhau
  });

  it("★★★ tín hiệu THỨ BA — model trả lại ĐÚNG bản diff vừa bị chứng minh là sai", () => {
    const noiDung = "public class A { }";
    expect(deXuatLapLai(bamChuoi(noiDung), bamChuoi(noiDung))).toBe(true);
    expect(deXuatLapLai(bamChuoi(noiDung), bamChuoi(`${noiDung} // khac`))).toBe(false);
    expect(deXuatLapLai(bamChuoi(noiDung), null), "lượt đầu không có gì để so").toBe(false);
  });

  it("★★ THỨ TỰ LÝ DO: vừa hết trần vừa giậm chân ⇒ nói 'không tiến bộ' (đắt giá hơn với người đọc)", () => {
    expect(quyetDinhTiep(nen({ luot: 3, tran: 3, soDo: 2, soDoTruoc: 2 })).lyDo).toBe("khong_tien_bo");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
describe("§4 — băm + cắt lỗi đưa vào prompt", () => {
  it("★ băm tất định, phân biệt được chuỗi khác nhau và chuỗi hoán vị", () => {
    expect(bamChuoi("abc")).toBe(bamChuoi("abc"));
    expect(bamChuoi("abc")).not.toBe(bamChuoi("abd"));
    expect(bamChuoi("ab")).not.toBe(bamChuoi("ba"));
    expect(bamChuoi("")).toBe(bamChuoi(""));
  });

  it("★★★ đầu ra dài bị CẮT về trần, giữ ĐẦU và CUỐI, và KHAI số ký tự bỏ giữa", () => {
    const s = `DAU${"x".repeat(20_000)}CUOI`;
    const c = catLoiChoPrompt(s);
    expect(c.length).toBeLessThan(TRAN_LOI_VAO_PROMPT + 200);
    expect(c.startsWith("DAU")).toBe(true);
    expect(c.endsWith("CUOI")).toBe(true);
    expect(c).toContain("bỏ qua");
  });

  it("★ đầu ra ngắn đi qua NGUYÊN VĂN (không cắt, không thêm gì)", () => {
    expect(catLoiChoPrompt("ngan")).toBe("ngan");
    expect(catLoiChoPrompt(null)).toBe("");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════════════════
// ★★★ 2026-08-23 · UX LÔ 1 (C2-i) — §5: DÒNG KẾT LUẬN "CHẮC MỚI NÓI" (`ketLuanTest`)
// ═══════════════════════════════════════════════════════════════════════════════════════════
/**
 * ĐỘT BIẾN PHẢI BẮT ĐƯỢC:
 *   • nói "✅" khi mã thoát ≠ 0 dù đếm ra 0 đỏ (mâu thuẫn)  ⇒ ca "mâu thuẫn ⇒ im lặng" ĐỎ
 *   • nói kết luận cho `tsc` (không có con số)              ⇒ ca "tsc ⇒ null" ĐỎ
 *   • bỏ vế `hetGio` (bản cắt được khai là PASS)            ⇒ ca "hết giờ ⇒ im lặng" ĐỎ
 *   • đảo chiều: "❌" đòi thêm mã thoát ≠ 0                  ⇒ ca "2 đỏ + mã thoát 0" ĐỎ
 */
describe("§5 — `ketLuanTest`: chắc mới nói, mâu thuẫn thì im lặng", () => {
  it("★★★ dotnet HỎNG (2 đỏ / 4 xanh) ⇒ ❌ chắc chắn, BẤT KỂ mã thoát", () => {
    const out = "Failed! - Failed: 2, Passed: 4, Skipped: 0, Total: 6";
    expect(ketLuanTest(out, 1)).toEqual({ xanh: false, soDo: 2, soXanh: 4 });
    // mã thoát 0 mà vẫn khai Failed: 2 — con số thắng: 2 ca đỏ là 2 ca đỏ.
    expect(ketLuanTest(out, 0)).toEqual({ xanh: false, soDo: 2, soXanh: 4 });
  });

  it("★★★ dotnet XANH (0 đỏ / 6 xanh, mã thoát 0) ⇒ ✅", () => {
    expect(ketLuanTest("Passed! - Failed: 0, Passed: 6, Total: 6", 0)).toEqual({ xanh: true, soDo: 0, soXanh: 6 });
  });

  it("★★ vitest: `Tests  2 failed | 4 passed (6)` ⇒ ❌ 2/6; `Tests  6 passed (6)` + mã 0 ⇒ ✅", () => {
    expect(ketLuanTest("Tests  2 failed | 4 passed (6)", 1)).toEqual({ xanh: false, soDo: 2, soXanh: 4 });
    expect(ketLuanTest("Tests  6 passed (6)", 0)).toEqual({ xanh: true, soDo: 0, soXanh: 6 });
  });

  it("★★★ MÂU THUẪN (0 đỏ đếm được nhưng mã thoát ≠ 0 / hết giờ) ⇒ null — KHÔNG nói dối '✅'", () => {
    expect(ketLuanTest("Passed! - Failed: 0, Passed: 6", 1)).toBeNull();
    expect(ketLuanTest("Passed! - Failed: 0, Passed: 6", 0, true)).toBeNull();
    expect(ketLuanTest("Passed! - Failed: 0, Passed: 6", null)).toBeNull();
  });

  it("★★★ `tsc` (không in con số nào) ⇒ null — mã thoát đã có ở dòng đầu textSummary, đừng đoán thêm", () => {
    expect(ketLuanTest("src/a.ts(3,1): error TS2304: Cannot find name 'x'.", 2)).toBeNull();
    expect(ketLuanTest("", 0)).toBeNull();
    expect(ketLuanTest(null, 0)).toBeNull();
  });
});
