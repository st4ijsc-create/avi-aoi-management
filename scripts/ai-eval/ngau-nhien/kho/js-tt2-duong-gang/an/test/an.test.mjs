import { test } from "node:test";
import assert from "node:assert/strict";
import { lapLich } from "../src/lichDuAn.mjs";

const o = (batDau, ketThuc, batDauMuon, ketThucMuon, duTru) => ({ batDau, ketThuc, batDauMuon, ketThucMuon, duTru });
const tv = (ma, thoiLuong, truoc = []) => ({ ma, thoiLuong, truoc });

test("danh sách rỗng", () => {
  assert.deepEqual(lapLich([]), { tongThoiGian: 0, lich: {}, duongGang: [] });
});

test("mạng 7 tác vụ: đủ năm trường của mọi tác vụ", () => {
  const kq = lapLich([
    tv("K", 2), tv("L", 4), tv("M", 3, ["K"]), tv("N", 1, ["K", "L"]),
    tv("O", 5, ["M"]), tv("P", 2, ["N", "M"]), tv("Q", 1, ["O", "P"]),
  ]);
  assert.deepEqual(kq, {
    tongThoiGian: 11,
    lich: {
      K: o(0, 2, 0, 2, 0), L: o(0, 4, 3, 7, 3), M: o(2, 5, 2, 5, 0), N: o(4, 5, 7, 8, 3),
      O: o(5, 10, 5, 10, 0), P: o(5, 7, 8, 10, 3), Q: o(10, 11, 10, 11, 0),
    },
    duongGang: ["K", "M", "O", "Q"],
  });
});

test("hai nhánh găng như nhau ⇒ chọn tác vụ kế ĐỨNG TRƯỚC trong đầu vào", () => {
  const a = lapLich([tv("A", 2), tv("B", 3, ["A"]), tv("C", 3, ["A"]), tv("D", 1, ["B", "C"])]);
  assert.equal(a.tongThoiGian, 6);
  assert.deepEqual(a.duongGang, ["A", "B", "D"]);
  const b = lapLich([tv("A", 2), tv("C", 3, ["A"]), tv("B", 3, ["A"]), tv("D", 1, ["B", "C"])]);
  assert.deepEqual(b.duongGang, ["A", "C", "D"]);
});

test("nhiều điểm đầu găng ⇒ chọn điểm đầu đứng trước trong đầu vào", () => {
  assert.deepEqual(lapLich([tv("X", 5), tv("Y", 5), tv("Z", 0, ["X", "Y"])]).duongGang, ["X", "Z"]);
  assert.deepEqual(lapLich([tv("Y", 5), tv("X", 5), tv("Z", 0, ["X", "Y"])]).duongGang, ["Y", "Z"]);
});

test("tác vụ thời lượng 0 (mốc) nằm trên đường găng", () => {
  const kq = lapLich([tv("M", 0), tv("N", 4, ["M"]), tv("P", 0, ["N"])]);
  assert.deepEqual(kq, {
    tongThoiGian: 4,
    lich: { M: o(0, 0, 0, 0, 0), N: o(0, 4, 0, 4, 0), P: o(4, 4, 4, 4, 0) },
    duongGang: ["M", "N", "P"],
  });
});

test("tác vụ rời rạc: dự trữ tính tới tổng thời gian", () => {
  const kq = lapLich([tv("A", 2), tv("B", 5)]);
  assert.deepEqual(kq, { tongThoiGian: 5, lich: { A: o(0, 2, 3, 5, 3), B: o(0, 5, 0, 5, 0) }, duongGang: ["B"] });
});

test("chu trình: thông điệp và thuộc tính chuTrinh theo quy tắc", () => {
  const vong = (ds, thongDiep, chuTrinh) => {
    assert.throws(() => lapLich(ds), (e) => {
      assert.ok(e instanceof Error);
      assert.equal(e.message, thongDiep);
      assert.deepEqual(e.chuTrinh, chuTrinh);
      return true;
    });
  };
  vong([tv("A", 1), tv("B", 1, ["A", "D"]), tv("C", 1, ["B"]), tv("D", 1, ["C"])], "chu trình: B -> D -> C -> B", ["B", "D", "C"]);
  // bắt đầu từ E (không nằm trên vòng), đi vào vòng ở B, xoay để bắt đầu bằng C (đứng trước B trong đầu vào)
  vong([tv("E", 1, ["B"]), tv("C", 1, ["B"]), tv("B", 1, ["C"])], "chu trình: C -> B -> C", ["C", "B"]);
  vong([tv("X", 1, ["X"])], "chu trình: X -> X", ["X"]);
});

test("thứ tự kiểm lỗi: trùng mã → thời lượng → phụ thuộc lạ → chu trình", () => {
  assert.throws(() => lapLich([tv("A", -1), tv("A", 1)]), { message: "trùng mã: A" });
  for (const x of [-1, 1.5, "3", NaN, undefined]) {
    assert.throws(() => lapLich([tv("B", 1), tv("A", x)]), (e) => e instanceof RangeError && e.message === "thời lượng không hợp lệ: A");
  }
  assert.throws(() => lapLich([tv("A", 1, ["A"]), tv("B", 1, ["Q"])]), { message: "phụ thuộc lạ: B cần Q" });
});

test("truoc vắng mặt = không phụ thuộc; phụ thuộc lặp; đầu vào không bị sửa", () => {
  const ds = Object.freeze([
    Object.freeze({ ma: "A", thoiLuong: 2 }),
    Object.freeze({ ma: "B", thoiLuong: 1, truoc: Object.freeze(["A", "A"]) }),
  ]);
  const kq = lapLich(ds);
  assert.deepEqual(kq, { tongThoiGian: 3, lich: { A: o(0, 2, 0, 2, 0), B: o(2, 3, 2, 3, 0) }, duongGang: ["A", "B"] });
});

test("chuỗi 20.000 tác vụ không tràn ngăn xếp", () => {
  const ds = [];
  let tong = 0;
  for (let i = 0; i < 20000; i++) {
    ds.push(tv(`T${i}`, i % 3, i ? [`T${i - 1}`] : []));
    tong += i % 3;
  }
  ds.push(tv("Phu", 1, ["T0"]));
  const t0 = Date.now();
  const kq = lapLich(ds);
  assert.ok(Date.now() - t0 < 5000, "quá chậm");
  assert.equal(kq.tongThoiGian, tong);
  assert.equal(kq.duongGang.length, 20000);
  assert.equal(kq.duongGang[19999], "T19999");
  assert.deepEqual(kq.lich.Phu, o(0, 1, tong - 1, tong, tong - 1));
});
