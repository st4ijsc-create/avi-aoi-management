import { describe, expect, it } from "vitest";
import { TRAN_CALL_ID, callIdCuaLuot, congDonCallId, loaiCallIdDaLuu } from "./soCallIdNgoai";

describe("congDonCallId", () => {
  it("cộng dồn theo thứ tự (KHÔNG ghi đè), khử trùng", () => {
    expect(congDonCallId([1, 2], [3, 2, 4])).toEqual([1, 2, 3, 4]);
  });
  it("giữ tối đa 50 id MỚI NHẤT", () => {
    const nhieu = Array.from({ length: 60 }, (_, i) => i + 1);
    const kq = congDonCallId([], nhieu);
    expect(kq).toHaveLength(TRAN_CALL_ID);
    expect(kq[0]).toBe(11);
    expect(kq[49]).toBe(60);
    expect(congDonCallId(kq, [61]).at(-1)).toBe(61);
    expect(congDonCallId(kq, [61])).toHaveLength(50);
  });
  it("bỏ id không phải số nguyên dương", () => {
    expect(congDonCallId([1], [0, -3, 2.5, Number.NaN, 7])).toEqual([1, 7]);
  });
});

describe("loaiCallIdDaLuu", () => {
  it("chỉ loại ĐÚNG các id đã gửi; id thêm vào giữa lúc lưu vẫn còn", () => {
    expect(loaiCallIdDaLuu([1, 2, 3, 4], [1, 2])).toEqual([3, 4]);
    expect(loaiCallIdDaLuu([1, 2], [])).toEqual([1, 2]);
    expect(loaiCallIdDaLuu([], [5])).toEqual([]);
  });
});

describe("callIdCuaLuot", () => {
  it("ưu tiên done.ngoaiCallIds; thiếu/rỗng ⇒ [vet.callId]; không có gì ⇒ []", () => {
    expect(callIdCuaLuot({ ngoaiCallIds: [4, 5], vet: { callId: 9 } })).toEqual([4, 5]);
    expect(callIdCuaLuot({ ngoaiCallIds: [], vet: { callId: 9 } })).toEqual([9]);
    expect(callIdCuaLuot({ vet: { callId: 9 } })).toEqual([9]);
    expect(callIdCuaLuot({ vet: null })).toEqual([]);
    expect(callIdCuaLuot({})).toEqual([]);
  });
});
