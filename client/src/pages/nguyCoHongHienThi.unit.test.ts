/**
 * PH-39 — BA TRẠNG THÁI của ô "Failure risk" trên màn máy.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * LỖI ĐO ĐƯỢC (QA tập đoàn 2026-09-15 — ảnh `.qa-tapdoan/anh/DE-D1-kythuat.png`)
 * ════════════════════════════════════════════════════════════════════════════
 * Trên CÙNG một khung hình, cách nhau khoảng 300 điểm ảnh:
 *     chip twin  : "Health 40 % · critical"
 *     ô cockpit  : "Failure risk 0 %"
 * Con số `0` ấy không đến từ một phép đo — `computeFailureRisk` không có đặc
 * trưng nào đủ dữ liệu nên rơi về mặc định `0 / LOW` (xem
 * `server/services/predictiveMaintenanceChuaDuDuLieu.test.ts`). Màn in ra
 * "KHÔNG có nguy cơ" trong khi thứ nó biết là "CHƯA BIẾT có nguy cơ hay không".
 *
 * ════════════════════════════════════════════════════════════════════════════
 * KHUÔN TÁI DÙNG (tìm khuôn sẵn có trước khi tự nghĩ)
 * ════════════════════════════════════════════════════════════════════════════
 * · `trungThucDuLieu.ts` NT-3.5 (`hienSo`) — "ĐẾM RỖNG KHÁC ĐẾM BẰNG 0": ô chưa
 *   đo in `—`, không in `0`. Chính module ấy sinh ra từ lỗi "Cảnh báo (0)".
 * · `alarmKpiEmptyState.ts` (`pickOccurrenceLogNotice`) — hàm THUẦN trả một
 *   nhãn phân biệt, tầng component mới dịch ra chữ; và "server cũ chưa trả
 *   trường này ⇒ KHÔNG BỊA lý do".
 * Module `nguyCoHongHienThi.ts` là hai khuôn ấy áp cho ô nguy cơ hỏng.
 *
 * ⚠ jsdom KHÔNG có bộ dựng bố cục ⇒ lưới này đo NGHĨA (nhãn nào cho dữ kiện
 *   nào), không đo hình học.
 */
import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { docMaNguon } from "@shared/testing/docMaNguon";
import { nhanNguyCoHong } from "./nguyCoHongHienThi";

const GOC = resolve(__dirname, "..", "..", "..");

describe("nhanNguyCoHong — ba trạng thái, KHÔNG gộp về 0", () => {
  it("★★★ CÓ SỐ THẬT — nguồn đọc được + riskMethod 'measured' ⇒ { kind: 'so' }", () => {
    expect(
      nhanNguyCoHong({ available: true, failureRisk: 73, riskMethod: "measured" }),
    ).toEqual({ kind: "so", phanTram: 73 });
  });

  it("★★★ 0 ĐO ĐƯỢC vẫn là SỐ — máy khoẻ có đủ dữ liệu phải in '0 %', không in '—'", () => {
    expect(
      nhanNguyCoHong({ available: true, failureRisk: 0, riskMethod: "measured" }),
    ).toEqual({ kind: "so", phanTram: 0 });
  });

  it("★★★ CHƯA ĐỦ DỮ LIỆU — riskMethod 'insufficient_data' ⇒ KHÔNG BAO GIỜ ra { kind: 'so' }", () => {
    const n = nhanNguyCoHong({ available: true, failureRisk: 0, riskMethod: "insufficient_data" });
    expect(n).toEqual({ kind: "chuaDuDuLieu" });
    // Đây chính là ca đã in "0 %" trên ảnh QA.
    expect(n.kind).not.toBe("so");
  });

  it("CHƯA ĐỦ DỮ LIỆU thắng cả khi server lỡ gửi kèm một con số khác 0", () => {
    expect(
      nhanNguyCoHong({ available: true, failureRisk: 42, riskMethod: "insufficient_data" }),
    ).toEqual({ kind: "chuaDuDuLieu" });
  });

  it("KHÔNG ĐỌC ĐƯỢC — mục sức khoẻ `available: false` (nguồn tắt / lỗi / ngoài phạm vi)", () => {
    expect(
      nhanNguyCoHong({ available: false, failureRisk: null, riskMethod: null }),
    ).toEqual({ kind: "chuaDocDuoc" });
  });

  it("KHÔNG ĐỌC ĐƯỢC — riskMethod 'unavailable' (không có cơ sở dữ liệu)", () => {
    expect(
      nhanNguyCoHong({ available: true, failureRisk: 0, riskMethod: "unavailable" }),
    ).toEqual({ kind: "chuaDocDuoc" });
  });

  it("KHÔNG ĐỌC ĐƯỢC — chưa có gì cả (undefined / null)", () => {
    expect(nhanNguyCoHong(undefined)).toEqual({ kind: "chuaDocDuoc" });
    expect(nhanNguyCoHong(null)).toEqual({ kind: "chuaDocDuoc" });
  });

  it("'measured' mà số lại thiếu / không hữu hạn ⇒ chuaDocDuoc, KHÔNG in NaN", () => {
    expect(nhanNguyCoHong({ available: true, failureRisk: null, riskMethod: "measured" }))
      .toEqual({ kind: "chuaDocDuoc" });
    expect(nhanNguyCoHong({ available: true, failureRisk: Number.NaN, riskMethod: "measured" }))
      .toEqual({ kind: "chuaDocDuoc" });
  });

  it("server CŨ chưa trả `riskMethod` ⇒ giữ nguyên hành vi cũ (có số thì in số), KHÔNG BỊA lý do", () => {
    expect(nhanNguyCoHong({ available: true, failureRisk: 12 })).toEqual({ kind: "so", phanTram: 12 });
    expect(nhanNguyCoHong({ available: true, failureRisk: null })).toEqual({ kind: "chuaDocDuoc" });
  });
});

describe("chỗ NỐI — màn máy phải THỰC SỰ dùng module này (G5: hàm đúng mà không ai gọi = chưa vá)", () => {
  // ⚠ G150 — đọc mã nguồn từ đĩa phải chuẩn hoá EOL.
  const COCKPIT = docMaNguon(resolve(GOC, "client/src/pages/MachineCockpit.tsx"));
  const HEALTH = docMaNguon(resolve(GOC, "client/src/pages/MachineHealthMonitoring.tsx"));

  it("đọc được mã nguồn thật (không rỗng) — chống lưới tự thoả trên chuỗi rỗng", () => {
    expect(COCKPIT.length).toBeGreaterThan(10_000);
    expect(HEALTH.length).toBeGreaterThan(10_000);
  });

  it("MachineCockpit.tsx nhập và gọi `nhanNguyCoHong`", () => {
    expect(COCKPIT).toContain("nguyCoHongHienThi");
    expect(COCKPIT).toContain("nhanNguyCoHong(");
  });

  it("MachineCockpit.tsx KHÔNG còn in thẳng `failureRisk` qua fmtPct ở dải KPI", () => {
    expect(COCKPIT).not.toContain("fmtPct(d.health.value?.failureRisk ?? null)");
  });

  it("MachineHealthMonitoring.tsx không còn suy chỉ số sức khoẻ từ `dataPoints > 0`", () => {
    expect(HEALTH).not.toContain("r.dataPoints > 0 ? clampPct(100 - r.failureRisk) : null");
    expect(HEALTH).toContain("nhanNguyCoHong(");
  });
});
