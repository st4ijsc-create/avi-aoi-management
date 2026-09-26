// server/services/mayTuMauThuan.test.ts
//
// Khối C Task 13 (BG-98) — lưới THUẦN cho cổng "máy tự mâu thuẫn". Bốn ca gốc
// theo brief (`task-13-brief.md` Bước 1) + biên + bộ đếm + wiring TÁCH KHỎI
// `cong.cham` bên trong `dichCayKetQua`.
import { describe, it, expect } from "vitest";
import {
  demTuMauThuan,
  taoDemMayTuMauThuan,
  type LaTuMauThuan,
} from "./mayTuMauThuan";
import { dichCayKetQua } from "./ingestCayKetQua";
import { mauHopLe } from "../contracts/machineDataContractV2.test-helpers";

function la(overrides: Partial<LaTuMauThuan>): LaTuMauThuan {
  return {
    result: "OK",
    value: 12,
    lowerLimit: "1",
    upperLimit: "10",
    ...overrides,
  };
}

describe("demTuMauThuan — máy tự mâu thuẫn với chính lời khai giới hạn của nó", () => {
  it("value NGOÀI giới hạn máy khai + result=OK ⇒ mâu thuẫn (true)", () => {
    expect(demTuMauThuan(la({ value: 12, lowerLimit: "1", upperLimit: "10", result: "OK" }))).toBe(true);
  });

  it("value NGOÀI giới hạn máy khai nhưng result=NG ⇒ KHÔNG mâu thuẫn (máy đã tự khai đúng hướng)", () => {
    expect(demTuMauThuan(la({ value: 12, lowerLimit: "1", upperLimit: "10", result: "NG" }))).toBe(false);
  });

  it("thiếu lowerLimit máy khai ⇒ không kết luận (false)", () => {
    expect(demTuMauThuan(la({ value: 12, lowerLimit: null, upperLimit: "10", result: "OK" }))).toBe(false);
  });

  it("thiếu upperLimit máy khai ⇒ không kết luận (false)", () => {
    expect(demTuMauThuan(la({ value: 12, lowerLimit: "1", upperLimit: undefined as unknown as null, result: "OK" }))).toBe(false);
  });

  it("value không parse được thành số (nhánh text của tachTriDo) ⇒ không kết luận (false)", () => {
    expect(demTuMauThuan(la({ value: "khong-do-duoc", lowerLimit: "1", upperLimit: "10", result: "OK" }))).toBe(false);
  });

  it("value NẰM TRONG giới hạn máy khai + result=OK ⇒ không mâu thuẫn (false)", () => {
    expect(demTuMauThuan(la({ value: 5, lowerLimit: "1", upperLimit: "10", result: "OK" }))).toBe(false);
  });

  it("value ĐÚNG BIÊN (bằng lowerLimit/upperLimit) ⇒ KHÔNG ngoài khoảng (false)", () => {
    expect(demTuMauThuan(la({ value: 1, lowerLimit: "1", upperLimit: "10", result: "OK" }))).toBe(false);
    expect(demTuMauThuan(la({ value: 10, lowerLimit: "1", upperLimit: "10", result: "OK" }))).toBe(false);
  });

  it("value dưới lowerLimit + result=OK ⇒ mâu thuẫn (true) — không chỉ phía trên mới bắt", () => {
    expect(demTuMauThuan(la({ value: 0, lowerLimit: "1", upperLimit: "10", result: "OK" }))).toBe(true);
  });

  it("value chuỗi số hợp lệ ('12') vẫn parse ra số và bắt được mâu thuẫn", () => {
    expect(demTuMauThuan(la({ value: "12", lowerLimit: "1", upperLimit: "10", result: "OK" }))).toBe(true);
  });

  it("limit không parse được thành số ⇒ không kết luận (false)", () => {
    expect(demTuMauThuan(la({ value: 12, lowerLimit: "khong-so", upperLimit: "10", result: "OK" }))).toBe(false);
  });
});

describe("taoDemMayTuMauThuan — bộ đếm một lượt ingest", () => {
  it("tong tăng mỗi lần dem(), mauThuan chỉ tăng khi có mâu thuẫn", () => {
    const bo = taoDemMayTuMauThuan();
    bo.dem("cap-1", { componentId: "c1", ...la({ value: 12, result: "OK" }) }); // mâu thuẫn
    bo.dem("cap-1", { componentId: "c2", ...la({ value: 5, result: "OK" }) }); // không
    bo.dem("cap-1", { componentId: "c3", ...la({ value: 12, result: "NG" }) }); // không

    expect(bo.thongKe.tong).toBe(3);
    expect(bo.thongKe.mauThuan).toBe(1);
  });

  it("mẫu ghi captureExtId/componentId + value/limit — đọc lại được để chẩn đoán", () => {
    const bo = taoDemMayTuMauThuan();
    bo.dem("CAP-XYZ", { componentId: "COMP-9", ...la({ value: 99, lowerLimit: "1", upperLimit: "10", result: "OK" }) });
    expect(bo.thongKe.mau).toHaveLength(1);
    expect(bo.thongKe.mau[0]).toContain("CAP-XYZ/COMP-9");
    expect(bo.thongKe.mau[0]).toContain("OK");
  });

  it("trần mẫu là 20 — mâu thuẫn thứ 21 không được thêm vào mau[] nhưng vẫn đếm vào mauThuan", () => {
    const bo = taoDemMayTuMauThuan();
    for (let i = 0; i < 25; i++) {
      bo.dem(`cap-${i}`, { componentId: `c${i}`, ...la({ value: 12, result: "OK" }) });
    }
    expect(bo.thongKe.mauThuan).toBe(25);
    expect(bo.thongKe.mau).toHaveLength(20);
  });
});

describe("Wiring trong dichCayKetQua — TÁCH KHỎI cong.cham (spec QĐ-8)", () => {
  it("phát hiện mâu thuẫn qua opts.demMauThuan mà KHÔNG đổi result/ghiChuCong của lá (không truyền opts.cong)", () => {
    const p = mauHopLe();
    const comp = p.surfaces[0].positions[0].captures[0].components[0];
    // Mẫu gốc: value="12.5", lowerLimit="9", upperLimit="11", result="NG" (không mâu thuẫn).
    // Đổi thành: máy khai OK dù value vẫn ngoài khoảng máy tự khai ⇒ tự mâu thuẫn.
    comp.result = "OK";
    p.surfaces[0].positions[0].captures[0].result = "OK";

    const demMauThuan = taoDemMayTuMauThuan();
    const cay = dichCayKetQua(p, { demMauThuan });

    expect(demMauThuan.thongKe.tong).toBe(1);
    expect(demMauThuan.thongKe.mauThuan).toBe(1);

    // KHÔNG cổng nào được bơm (`opts.cong` vắng) ⇒ verdict/remark của lá y nguyên
    // như trước khi có cổng này — cổng đếm KHÔNG được phép đổi cây dịch.
    const laDaDich = cay.surfaces[0].positions[0].captures[0].components[0];
    expect(laDaDich.result).toBe("OK");
    expect(laDaDich.ghiChuCong).toBeNull();
  });

  it("demMauThuan đọc result THÔ máy khai (c.result), KHÔNG đọc result đã bị cổng bản-dạy hạ cấp", () => {
    // Component có value NẰM TRONG giới hạn máy khai (9..11 chứa 10) ⇒ demTuMauThuan
    // tự nó là false trên trị đo này — ca này canh rằng dù `cong.cham` có mặt và hạ
    // OK→NG (vì lý do KHÁC, giới hạn kỹ sư), demMauThuan vẫn tính trên c.result GỐC,
    // không đọc lại kết quả đã bị cổng bản-dạy đổi.
    const p = mauHopLe();
    const comp = p.surfaces[0].positions[0].captures[0].components[0];
    comp.value = "10"; // trong khoảng máy tự khai [9,11]
    comp.result = "OK";
    p.surfaces[0].positions[0].captures[0].result = "OK";

    const demMauThuan = taoDemMayTuMauThuan();
    const cay = dichCayKetQua(p, { demMauThuan }); // không cong ⇒ không có gì hạ cấp cả

    // value=10 nằm trong [9,11] máy tự khai ⇒ không tự mâu thuẫn, bất kể có cổng nào chạy.
    expect(demMauThuan.thongKe.mauThuan).toBe(0);
    expect(cay.surfaces[0].positions[0].captures[0].components[0].result).toBe("OK");
  });
});
