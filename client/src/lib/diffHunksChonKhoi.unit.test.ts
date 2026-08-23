/**
 * ★★★ ĐỢT 3 (2026-08-23) — LƯỚI cho BỘ VỊ TỪ CHỌN KHỐI dùng chung client ↔ server
 * (`keHoachKhoiDuyet` · `chieuTheoChiSoKhoi` · `chiSoGuiLenServer`).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * LỚP HẬU QUẢ ĐANG CANH
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Ba hàm này là chỗ lựa chọn của người duyệt biến thành BYTE TRÊN ĐĨA — server gọi đúng chúng trong
 * `confirmAction` (import thẳng từ file này, không có bản sao thứ hai). Sai một chỉ số, nuốt một id
 * lạ, hay hai đầu dây dựng hai kế hoạch KHÁC nhau ⇒ khối được ghi KHÔNG phải khối được duyệt — và
 * không có lỗi nào được ném ra. Vì thế mọi mệnh đề chiếu ở đây so TỪNG KÝ TỰ (`toBe` toàn chuỗi)
 * với một ORACLE VIẾT TAY, không sinh kỳ vọng bằng chính hàm đang đo.
 *
 * ĐỘT BIẾN PHẢI BẮT ĐƯỢC (đã chạy — xem báo cáo đợt):
 *   • bỏ kiểm TRÙNG/NGOÀI KHOẢNG trong `chieuTheoChiSoKhoi`  ⇒ §2 ĐỎ
 *   • cho tập RỖNG đi qua (chiếu ra bản gốc)                 ⇒ §2 ĐỎ
 *   • `chiSoGuiLenServer` trả mảng đầy đủ thay vì `null`      ⇒ §3 ĐỎ (mất đường cũ từng-byte)
 *   • `keHoachKhoiDuyet` thả nổi luật EOL                     ⇒ §4 ĐỎ
 */
import { describe, it, expect } from "vitest";
import {
  chieuTheoChiSoKhoi,
  chiSoGuiLenServer,
  computeHunkPlan,
  detectEol,
  keHoachKhoiDuyet,
  normalizeEol,
} from "./diffHunks";

/** Ba khối thay đổi tách rời bởi dòng giữ nguyên ⇒ đúng 3 khối, chỉ số 0/1/2 từ trên xuống. */
const GOC = "a1\ngiu\nb1\ngiu\nc1\n";
const SUA = "a2\ngiu\nb2\ngiu\nc2\n";
/** Oracle viết tay cho tập {0,2}: khối giữa GIỮ NGUYÊN. */
const ORACLE_0_2 = "a2\ngiu\nb1\ngiu\nc2\n";

describe("§1 — chiếu tập con: đúng TỪNG KÝ TỰ, không phụ thuộc thứ tự gửi", () => {
  it("★★★ {0,2} ⇒ oracle viết tay; {2,0} (đảo thứ tự) ⇒ CÙNG kết quả, chiSo trả về đã sắp", () => {
    const plan = keHoachKhoiDuyet(GOC, SUA);
    expect(plan.hunks.length).toBe(3);
    for (const dau of [[0, 2], [2, 0]]) {
      const r = chieuTheoChiSoKhoi(plan, dau);
      expect(r.ok, JSON.stringify(dau)).toBe(true);
      if (r.ok) {
        expect(r.text).toBe(ORACLE_0_2);
        expect(r.chiSo).toEqual([0, 2]);
        expect(r.tong).toBe(3);
      }
    }
  });

  it("★★★ chọn ĐỦ mọi khối ⇒ đúng bằng `plan.modified` từng ký tự (khớp đường áp-tất-cả cũ)", () => {
    const plan = keHoachKhoiDuyet(GOC, SUA);
    const r = chieuTheoChiSoKhoi(plan, [0, 1, 2]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.text).toBe(plan.modified);
  });

  it("★ CRLF được giữ NGUYÊN VĂN khi hai phía cùng CRLF (không có bước chuẩn hoá ngầm)", () => {
    const goc = "a1\r\ngiu\r\nb1\r\n";
    const sua = "a2\r\ngiu\r\nb2\r\n";
    const plan = keHoachKhoiDuyet(goc, sua);
    expect(plan.hunks.length).toBe(2);
    const r = chieuTheoChiSoKhoi(plan, [1]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.text).toBe("a1\r\ngiu\r\nb2\r\n");
  });
});

describe("§2 — id lạ / trùng / rỗng / không nguyên ⇒ TỪ CHỐI CÓ MÃ, không âm thầm lọc", () => {
  const plan = keHoachKhoiDuyet(GOC, SUA);

  it("★★★ tập RỖNG ⇒ NO_HUNKS_SELECTED (không phải 'chiếu ra bản gốc rồi ghi y nguyên')", () => {
    const r = chieuTheoChiSoKhoi(plan, []);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.ma).toBe("NO_HUNKS_SELECTED");
  });

  it("★★★ ngoài khoảng / âm / trùng / không nguyên / không phải số ⇒ HUNK_IDS_INVALID, từng ca một", () => {
    for (const xau of [[3], [-1], [0, 0], [0.5], ["1"], [Number.NaN], [0, 99]]) {
      const r = chieuTheoChiSoKhoi(plan, xau as readonly unknown[]);
      expect(r.ok, JSON.stringify(xau)).toBe(false);
      if (!r.ok) expect(r.ma, JSON.stringify(xau)).toBe("HUNK_IDS_INVALID");
    }
  });
});

describe("§3 — `chiSoGuiLenServer`: chọn đủ ⇒ null (đường cũ), tập con ⇒ chỉ số đã sắp, rỗng ⇒ []", () => {
  const plan = keHoachKhoiDuyet(GOC, SUA);
  const ids = plan.hunks.map((h) => h.id);

  it("★★★ chọn đủ ⇒ `null` — client KHÔNG gửi trường nào, server đi nguyên đường cũ từng byte", () => {
    expect(chiSoGuiLenServer(plan, ids)).toBeNull();
  });

  it("★★ tập con ⇒ đúng chỉ số theo VỊ TRÍ trong plan (không theo thứ tự Iterable đưa vào)", () => {
    expect(chiSoGuiLenServer(plan, [ids[2], ids[0]])).toEqual([0, 2]);
  });

  it("★ rỗng ⇒ `[]` nguyên vẹn — hàm không 'lịch sự hộ'; server mới là nơi từ chối NO_HUNKS_SELECTED", () => {
    expect(chiSoGuiLenServer(plan, [])).toEqual([]);
  });
});

describe("§4 — kế hoạch CHUẨN là hàm TẤT ĐỊNH của (original, modified) — hai đầu dây một kế hoạch", () => {
  it("★★★ gọi hai lần ⇒ cùng id từng khối (client đánh số và server đánh số trỏ CÙNG khối)", () => {
    const a = keHoachKhoiDuyet(GOC, SUA);
    const b = keHoachKhoiDuyet(GOC, SUA);
    expect(a.hunks.map((h) => h.id)).toEqual(b.hunks.map((h) => h.id));
  });

  it("★★★ lệch EOL (gốc CRLF · sửa LF) ⇒ tự khớp EOL: nhiều khối thật thay vì MỘT khối nuốt cả tệp, và bản chiếu đủ = bản modified đã khớp EOL", () => {
    const goc = "a1\r\ngiu\r\nb1\r\n";
    const sua = "a2\ngiu\nb2\n"; // model trả LF cho buffer CRLF — ca thật trên Windows
    expect(detectEol(goc)).not.toBe(detectEol(sua));
    const plan = keHoachKhoiDuyet(goc, sua);
    expect(plan.eolMatched).toBe(true);
    expect(plan.hunks.length).toBe(2);
    const r = chieuTheoChiSoKhoi(plan, [0, 1]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.text).toBe(normalizeEol(sua, "\r\n"));
    // Chống tự thoả: KHÔNG khớp EOL thì đúng là một khối nuốt cả tệp — luật ghim có tác dụng đo được.
    expect(computeHunkPlan(goc, sua, {}).hunks.length).toBe(1);
  });
});
