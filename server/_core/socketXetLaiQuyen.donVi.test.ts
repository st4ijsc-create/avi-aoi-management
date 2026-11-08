/**
 * socketXetLaiQuyen.donVi.test.ts — F5 đầy đủ: phần THUẦN của bộ nhận `socket_pham_vi` (không socket, không DB).
 *   • đọc tải trọng: đúng ba hình dạng của 0435; mọi thứ khác ⇒ `hong` (nơi gọi xử lý như "all");
 *   • dấu vân tay quyền: đổi khi một bit đổi / một hàng hết hạn; không đổi theo thứ tự hàng;
 *   • danh sách bộ nhớ đệm theo người: đủ năm bộ (kiểm kê), không trùng.
 */
import { describe, expect, it } from "vitest";
import { BO_NHO_THEO_NGUOI, docThongBaoPhamVi, phongKiemNguoi, phongKiemPhien, vanTayQuyen } from "./socketXetLaiQuyen";

describe("docThongBaoPhamVi", () => {
  it("ba hình dạng hợp lệ (đúng như hàm tải trọng 0435 dựng)", () => {
    expect(docThongBaoPhamVi('{"u": [5]}')).toEqual({ loai: "u", u: [5] });
    expect(docThongBaoPhamVi('{"u": [5, 6, 5]}')).toEqual({ loai: "u", u: [5, 6] });
    expect(docThongBaoPhamVi('{"s": 9, "u": [5]}')).toEqual({ loai: "s", s: 9, u: [5] });
    expect(docThongBaoPhamVi('{"all":1}')).toEqual({ loai: "all" });
  });
  it("mọi hình dạng khác ⇒ hong (không bao giờ ném)", () => {
    for (const raw of [
      undefined, 5, "", "x", "[]", "null", "{}", '{"all":true}', '{"all":2}', '{"u":[]}', '{"u":[0]}', '{"u":[-1]}', '{"u":[1.5]}', '{"u":["5"]}',
      '{"u":5}', '{"s":9}', '{"s":0,"u":[5]}', '{"s":"9","u":[5]}', '{"u":[5],"token":"t"}', '{"u":[5],"all":1}', '{"hb":1}',
      `{"u":[${"1,".repeat(1000)}1]}`, "x".repeat(9000), '{"u":[2147483648]}',
    ]) {
      expect(docThongBaoPhamVi(raw).loai, String(raw).slice(0, 40)).toBe("hong");
    }
  });
});

describe("vanTayQuyen", () => {
  const bayGio = Date.parse("2026-11-02T12:00:00Z");
  const a = { moduleName: "andon", canView: true, canEdit: false };
  const b = { moduleName: "machine_status", canView: true, canEdit: true };
  it("không đổi theo thứ tự hàng; đổi khi một bit đổi / thêm / bớt hàng", () => {
    const g = vanTayQuyen([a, b], bayGio);
    expect(vanTayQuyen([b, a], bayGio)).toBe(g);
    expect(vanTayQuyen([a, { ...b, canEdit: false }], bayGio)).not.toBe(g);
    expect(vanTayQuyen([a], bayGio)).not.toBe(g);
    expect(vanTayQuyen([], bayGio)).toBe("");
  });
  it("hàng HẾT HẠN = không bit nào (một quyền hết hạn trong lúc nối đổi dấu vân tay mà không cần lượt ghi)", () => {
    const conHan = { ...b, expiresAt: new Date(bayGio + 60_000) };
    const truoc = vanTayQuyen([conHan], bayGio);
    const sau = vanTayQuyen([conHan], bayGio + 120_000);
    expect(sau).not.toBe(truoc);
    expect(sau).toBe("machine_status:00000");
  });
});

describe("phòng điều khiển + bộ nhớ đệm", () => {
  it("tên phòng", () => {
    expect(phongKiemNguoi(7)).toBe("kiem:user:7");
    expect(phongKiemPhien(9)).toBe("kiem:phien:9");
  });
  it("đủ năm bộ nhớ đệm theo người (kiểm kê F5 đầy đủ), không trùng", () => {
    expect(BO_NHO_THEO_NGUOI.map((b) => b.ten)).toEqual([
      "accessControl.assignmentCache", "authSessionCache", "robotStopAuthMemo", "aiAgentPhamVi", "_congAnh.nhoDemPhamVi",
    ]);
  });
});
