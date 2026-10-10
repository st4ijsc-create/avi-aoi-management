/**
 * doc 81 Đợt 4 Task C1 — MỘT luật gỡ ghim DỪNG cho cả client lẫn server.
 * Oracle: server phải dùng CHÍNH hàm của `shared/` (đồng nhất tham chiếu), và vài vector viết tay theo docblock.
 */
import { describe, expect, it } from "vitest";
import { lyDoGoStopPinKhiSuaTag as luatChung } from "./stopPinTagRule";
import { lyDoGoStopPinKhiSuaTag as luatServer } from "../server/services/ot/stopPin";

const ghim = {
  stopValue: true, writable: true, isEnabled: true, address: "DB1.DBX0.0", dataType: "bool", adapterId: 7, scale: "1", offset: "0",
};

describe("C1 — luật gỡ ghim dùng chung (shared/stopPinTagRule.ts)", () => {
  it("★ server KHÔNG có bản cài đặt thứ hai: export của stopPin.ts là CHÍNH hàm của shared", () => {
    expect(luatServer).toBe(luatChung);
  });

  it("vector: tag không ghim ⇒ null dù đổi gì", () => {
    expect(luatChung({ ...ghim, stopValue: null }, { writable: false, address: "X" })).toBeNull();
  });
  it("vector: thôi writable / tắt / đổi địa chỉ, kiểu, adapter, scale, offset ⇒ đúng nguồn", () => {
    expect(luatChung(ghim, { writable: false })).toBe("tag_not_writable");
    expect(luatChung(ghim, { isEnabled: false })).toBe("tag_disabled");
    expect(luatChung(ghim, { address: "DB1.DBX0.1" })).toBe("tag_redefined");
    expect(luatChung(ghim, { dataType: "int" })).toBe("tag_redefined");
    expect(luatChung(ghim, { adapterId: 8 })).toBe("tag_redefined");
    expect(luatChung(ghim, { scale: 2 })).toBe("tag_redefined");
    expect(luatChung(ghim, { offset: 5 })).toBe("tag_redefined");
  });
  it("vector: đổi tagKey/unit, gửi lại cùng giá trị (scale ô trống ≡ 1, offset ô trống ≡ 0) ⇒ GIỮ ghim", () => {
    expect(luatChung(ghim, { tagKey: "doi_ten", unit: "-" })).toBeNull();
    expect(luatChung(ghim, { ...ghim, scale: null, offset: null })).toBeNull();
    expect(luatChung(ghim, { isEnabled: true, writable: true })).toBeNull();
  });
  it("trường vắng trên hàng đang ghim ⇒ coi như không đạt (hỏi/gỡ, không im lặng giữ)", () => {
    expect(luatChung({ stopValue: 1 }, { isEnabled: true })).toBe("tag_not_writable");
  });
});
