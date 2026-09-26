/**
 * chonVatThe.unit.test.ts — sàng cho bảng tra `instanceId ↔ machineId`.
 *
 * ⚠ TÊN TỆP `*.unit.test.ts`.
 *
 * Vì sao đáng test: nhầm `batchId` (chỉ số trong lô) với `machineId` (id DB) là
 * lỗi CÂM — đúng ngẫu nhiên khi id máy tình cờ bằng chỉ số, sai ngay khi lọc bớt
 * máy. Không có test nào bắt được nó ở tầng UI vì màn vẫn chạy, chỉ chọn nhầm máy.
 */

import { describe, it, expect } from "vitest";
import {
  dungBangTra,
  mayTuInstance,
  instanceTuMay,
  apClick,
  apHover,
  instanceCanVeLai,
  mucNhanSang,
  TRANG_THAI_CHON_RONG,
} from "./chonVatThe";

describe("dungBangTra — hai chiều khớp nhau", () => {
  it("★ id máy KHÔNG bằng chỉ số instance: máy [101,102,103] tra đúng cả hai chiều", () => {
    const b = dungBangTra([101, 102, 103]);
    expect(mayTuInstance(b, 0)).toBe(101);
    expect(mayTuInstance(b, 2)).toBe(103);
    expect(instanceTuMay(b, 103)).toBe(2);
    expect(instanceTuMay(b, 101)).toBe(0);
  });

  it("★ sau khi LỌC bớt máy, chỉ số dịch nhưng tra vẫn đúng", () => {
    // Đây là ca làm lộ lỗi "coi batchId là machineId": lô đầy [10,11,12,13],
    // lô đã lọc chỉ còn [11,13] — instance 1 giờ là máy 13, không phải máy 1.
    const b = dungBangTra([11, 13]);
    expect(mayTuInstance(b, 1)).toBe(13);
    expect(instanceTuMay(b, 13)).toBe(1);
    expect(instanceTuMay(b, 10)).toBeNull();
  });

  it("lô rỗng: mọi tra cứu trả null, không ném", () => {
    const b = dungBangTra([]);
    expect(mayTuInstance(b, 0)).toBeNull();
    expect(instanceTuMay(b, 1)).toBeNull();
  });

  it("★ chỉ số ngoài phạm vi trả NULL, không trả 0 — 0 là machineId hợp lệ về kiểu", () => {
    const b = dungBangTra([7, 8]);
    expect(mayTuInstance(b, 2)).toBeNull();
    expect(mayTuInstance(b, -1)).toBeNull();
    expect(mayTuInstance(b, 1.5)).toBeNull();
    expect(mayTuInstance(b, null)).toBeNull();
    expect(mayTuInstance(b, undefined)).toBeNull();
  });

  it("id trùng lặp: lần xuất hiện ĐẦU thắng ở chiều máy→instance, cả hai chỉ số vẫn tra ngược đúng", () => {
    const b = dungBangTra([5, 6, 5]);
    expect(instanceTuMay(b, 5)).toBe(0);
    expect(mayTuInstance(b, 2)).toBe(5);
  });

  it("không giữ tham chiếu mảng của người gọi", () => {
    const nguon = [1, 2, 3];
    const b = dungBangTra(nguon);
    nguon.push(4);
    expect(b.mayTheoInstance.length).toBe(3);
  });
});

describe("apClick / apHover", () => {
  it("click máy mới → chọn nó", () => {
    expect(apClick(TRANG_THAI_CHON_RONG, 42).dangChon).toBe(42);
  });

  it("click LẠI máy đang chọn → bỏ chọn (toggle)", () => {
    expect(apClick({ dangChon: 42, dangHover: null }, 42).dangChon).toBeNull();
  });

  it("click chỗ trống → bỏ chọn", () => {
    expect(apClick({ dangChon: 42, dangHover: null }, null).dangChon).toBeNull();
  });

  it("★ click KHÔNG đụng hover, hover KHÔNG đụng chọn", () => {
    const sau = apClick({ dangChon: null, dangHover: 7 }, 42);
    expect(sau.dangHover).toBe(7);
    const sau2 = apHover({ dangChon: 42, dangHover: null }, 9);
    expect(sau2.dangChon).toBe(42);
  });

  it("hover cùng giá trị giữ NGUYÊN tham chiếu (chống re-render thừa)", () => {
    const tt = { dangChon: 1, dangHover: 2 };
    expect(apHover(tt, 2)).toBe(tt);
  });
});

describe("instanceCanVeLai — chỉ ghi màu cho instance THỰC SỰ đổi", () => {
  it("đổi chọn từ máy A sang máy B → đúng 2 instance cần vẽ lại", () => {
    const b = dungBangTra([100, 200, 300]);
    const ids = instanceCanVeLai(b, { dangChon: 100, dangHover: null }, { dangChon: 300, dangHover: null });
    expect(ids).toEqual([0, 2]);
  });

  it("máy đã bị lọc khỏi lô không sinh chỉ số rác", () => {
    const b = dungBangTra([100]);
    const ids = instanceCanVeLai(b, { dangChon: 999, dangHover: null }, { dangChon: 100, dangHover: null });
    expect(ids).toEqual([0]);
  });

  it("không đổi gì → mảng chỉ chứa instance đang chọn/hover, không trùng lặp", () => {
    const b = dungBangTra([10, 20]);
    const tt = { dangChon: 10, dangHover: 10 };
    expect(instanceCanVeLai(b, tt, tt)).toEqual([0]);
  });

  it("cả hai trạng thái rỗng → mảng rỗng", () => {
    expect(instanceCanVeLai(dungBangTra([1, 2]), TRANG_THAI_CHON_RONG, TRANG_THAI_CHON_RONG)).toEqual([]);
  });
});

describe("mucNhanSang", () => {
  it("đang chọn 0,4 · hover 0,2 · bình thường 0", () => {
    expect(mucNhanSang(1, { dangChon: 1, dangHover: null })).toBe(0.4);
    expect(mucNhanSang(1, { dangChon: null, dangHover: 1 })).toBe(0.2);
    expect(mucNhanSang(1, { dangChon: 2, dangHover: 3 })).toBe(0);
  });

  it("vừa chọn vừa hover → chọn thắng (không cộng dồn thành 0,6 trắng xoá)", () => {
    expect(mucNhanSang(1, { dangChon: 1, dangHover: 1 })).toBe(0.4);
  });
});
