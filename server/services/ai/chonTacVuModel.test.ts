import { describe, it, expect } from "vitest";
import { chonTacVuModel, locTacVuNguoiChon } from "./chonTacVuModel";

describe("locTacVuNguoiChon — danh sách TRẮNG cho một trường CLIENT-KHAI", () => {
  it("nhận đúng 3 giá trị hợp lệ", () => {
    expect(locTacVuNguoiChon("auto")).toBe("auto");
    expect(locTacVuNguoiChon("fast")).toBe("fast");
    expect(locTacVuNguoiChon("code")).toBe("code");
  });

  it("★ mọi thứ khác ⇒ 'auto' (fail-safe, không để chuỗi lạ thành một task router chưa biết)", () => {
    for (const x of ["chat", "CODE", "thinking", "", " code ", "1", null, undefined, 7, {}, []]) {
      expect(locTacVuNguoiChon(x)).toBe("auto");
    }
  });
});

describe("chonTacVuModel — người chọn thắng env, env là MẶC ĐỊNH CỦA HỆ", () => {
  it("★★ người chọn 'code' ⇒ 'code', bất kể env (đổi model KHÔNG cần khởi động lại)", () => {
    expect(chonTacVuModel("code", undefined)).toBe("code");
    expect(chonTacVuModel("code", "chat")).toBe("code");
    expect(chonTacVuModel("code", "code")).toBe("code");
  });

  it("★★ người chọn 'fast' ⇒ 'fast', bất kể env", () => {
    expect(chonTacVuModel("fast", "code")).toBe("fast");
    expect(chonTacVuModel("fast", undefined)).toBe("fast");
  });

  it("★ 'auto' ⇒ theo env — HÀNH VI CŨ Y NGUYÊN cho ai chưa dùng bộ chọn", () => {
    expect(chonTacVuModel("auto", "code")).toBe("code");
    expect(chonTacVuModel("auto", "chat")).toBe("chat");
    expect(chonTacVuModel("auto", undefined)).toBe("chat");
  });

  it("★ không gửi gì ⇒ y hệt 'auto' (tương thích ngược tuyệt đối)", () => {
    expect(chonTacVuModel(undefined, "code")).toBe(chonTacVuModel("auto", "code"));
    expect(chonTacVuModel(undefined, undefined)).toBe(chonTacVuModel("auto", undefined));
  });

  it("★ giá trị RÁC từ client ⇒ rơi về mặc định hệ, KHÔNG ném, KHÔNG lọt xuống router", () => {
    expect(chonTacVuModel("thinking", "code")).toBe("code");
    expect(chonTacVuModel("<script>", "chat")).toBe("chat");
    expect(chonTacVuModel({ a: 1 }, "code")).toBe("code");
  });

  it("★ đầu ra LUÔN nằm trong miền router hiểu", () => {
    const mien = new Set(["chat", "code", "fast"]);
    for (const c of ["auto", "fast", "code", "rác", null, 9]) {
      for (const e of ["code", "chat", undefined]) {
        expect(mien.has(chonTacVuModel(c, e))).toBe(true);
      }
    }
  });
});
