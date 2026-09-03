/**
 * server/services/specGateCayV2.test.ts
 *
 * ★★★ I-4 (review Khối C lượt 9) — v2/ZIP không lưu "giới hạn nào đã chấm bo"
 * (khác v1.x có `gateConfigVersion`). Lưới THUẦN (không DB) cho phần ghi BASIS
 * vào `measurement_results.remark`: `nhanCongDatTheoBasis`, `laNhanCongDat`, và
 * `taoCongSpecCayV2` khi được truyền `traVersionId`. Bằng chứng end-to-end (DB
 * thật, cả ba đường v2 — trực tiếp/WAL/ZIP) sống ở `server/db/specGateCayV2.db.test.ts`
 * (mệnh đề 7/7B/8) và `server/db/congRaKhoiC.db.test.ts` (mệnh đề 3 · BẬT/TẮT).
 */
import { describe, it, expect } from "vitest";
import {
  taoCongSpecCayV2,
  nhanCongDatTheoBasis,
  laNhanCongDat,
  NHAN_CONG_DAT,
} from "./specGateCayV2";
import type { PointLimitSource } from "./pointResultEvaluator";

describe("I-4 — nhanCongDatTheoBasis (thuần)", () => {
  it("versionId là số ⇒ [SG:DAT;v=<id>]", () => {
    expect(nhanCongDatTheoBasis(42)).toBe("[SG:DAT;v=42]");
  });
  it("null/undefined ⇒ [SG:DAT;v=LIVE]", () => {
    expect(nhanCongDatTheoBasis(null)).toBe("[SG:DAT;v=LIVE]");
    expect(nhanCongDatTheoBasis(undefined)).toBe("[SG:DAT;v=LIVE]");
  });
});

describe("I-4 — laNhanCongDat (thuần)", () => {
  it("nhận CẢ HAI dạng: trơn cũ và có basis", () => {
    expect(laNhanCongDat(NHAN_CONG_DAT)).toBe(true);
    expect(laNhanCongDat("[SG:DAT;v=LIVE]")).toBe(true);
    expect(laNhanCongDat("[SG:DAT;v=123]")).toBe(true);
  });
  it("KHÔNG khớp nhãn khác (TRƯỢT/KHÔNG_KL/null)", () => {
    expect(laNhanCongDat("Spec gate: value 12 > max 10")).toBe(false);
    expect(laNhanCongDat("[SG:KHONG_KL]")).toBe(false);
    expect(laNhanCongDat(null)).toBe(false);
    expect(laNhanCongDat(undefined)).toBe(false);
  });
});

describe("I-4 — taoCongSpecCayV2 với traVersionId (thuần, mô phỏng cả hai trạng thái cờ)", () => {
  const GIOI_HAN: PointLimitSource = { lowerLimit: "1", upperLimit: "10" };
  const traGioiHan = () => GIOI_HAN;

  it("KHÔNG truyền traVersionId (caller cũ) ⇒ giữ NGUYÊN nhãn [SG:DAT] trơn — không hồi quy", () => {
    const cong = taoCongSpecCayV2(traGioiHan);
    const kq = cong.cham("cap-1", { componentId: "comp-1", result: "OK", value: "5" });
    expect(kq.ghiChu).toBe(NHAN_CONG_DAT);
  });

  it("★★★ mô phỏng cờ BẬT — traVersionId trả về một id thật ⇒ remark mang ĐÚNG id đó", () => {
    const cong = taoCongSpecCayV2(traGioiHan, () => 777);
    const kq = cong.cham("cap-1", { componentId: "comp-1", result: "OK", value: "5" });
    expect(kq.ghiChu).toBe("[SG:DAT;v=777]");
  });

  it("★★★ mô phỏng cờ TẮT — traVersionId trả về null (không tái dựng) ⇒ remark mang LIVE", () => {
    const cong = taoCongSpecCayV2(traGioiHan, () => null);
    const kq = cong.cham("cap-1", { componentId: "comp-1", result: "OK", value: "5" });
    expect(kq.ghiChu).toBe("[SG:DAT;v=LIVE]");
  });

  it("traVersionId khác nhau THEO TỪNG khoá capture/component (không phải một giá trị cố định cho cả bo)", () => {
    const cong = taoCongSpecCayV2(traGioiHan, (cap, comp) => (comp === "comp-A" ? 111 : null));
    const a = cong.cham("cap-1", { componentId: "comp-A", result: "OK", value: "5" });
    const b = cong.cham("cap-1", { componentId: "comp-B", result: "OK", value: "5" });
    expect(a.ghiChu).toBe("[SG:DAT;v=111]");
    expect(b.ghiChu).toBe("[SG:DAT;v=LIVE]");
  });

  it("traVersionId KHÔNG được gọi cho linh kiện TRƯỢT/KHÔNG_KL (chỉ áp cho nhánh ĐẠT)", () => {
    let soLanGoi = 0;
    const traVersionId = () => { soLanGoi++; return 1; };
    const cong = taoCongSpecCayV2(traGioiHan, traVersionId);
    const truot = cong.cham("cap-1", { componentId: "comp-1", result: "OK", value: "99" }); // ngoài [1;10]
    expect(truot.ghiChu).toContain("Spec gate");
    expect(soLanGoi, "không cần basis cho một điểm TRƯỢT — không kết luận 'đạt' bằng gì cả").toBe(0);
  });
});
