import { describe, it, expect } from "vitest";
// ★★★ G20 — import CHÍNH module giao hàng. Xoá sạch `phuUns.ts` ⇒ lưới này ĐỎ.
import { trangThaiTuUns, mocTuUns, mocTuAnhChupUns } from "./phuUns";

/**
 * §11 #50 — UNS stream ISA-95 di trú sang `/twin`.
 *
 * Hai luật mà lưới này ghim, cả hai đều là chỗ dễ làm sai và cả hai đều IM LẶNG
 * khi sai:
 *   1. `ts` của UNS là MỐC ĐO, không phải lúc gói tới. Lấy `Date.now()` làm mọi
 *      máy trông như vừa cập nhật (NT-3.4).
 *   2. `state` lạ ⇒ `null` (⇒ `khong_ro`), KHÔNG rơi về `stopped`.
 */
describe("trangThaiTuUns — PackML → khoá mauTrangThai", () => {
  it("★★★ `health = offline` THẮNG mọi `state`", () => {
    // Thiết bị mất kết nối có thể còn mang `state` cuối nó kịp gửi. Vẽ EXECUTE
    // cho một máy đã offline = "tag Quality=Good khi timestamp ngừng tiến".
    expect(trangThaiTuUns({ state: "EXECUTE", health: "offline" })).toBe("offline");
  });

  it("nhóm chạy → `running`", () => {
    for (const s of ["EXECUTE", "STARTING", "RUNNING", "PRODUCING", "PROCESSING"]) {
      expect(trangThaiTuUns({ state: s })).toBe("running");
    }
  });

  it("nhóm chờ → `idle`; nhóm dừng → `idle` (Đợt 38: CÙNG từ điển chỉ huy `stopped→idle` với server, không còn `stopped` riêng)", () => {
    for (const s of ["IDLE", "STANDBY", "READY"]) expect(trangThaiTuUns({ state: s })).toBe("idle");
    for (const s of ["STOPPED", "HELD", "ABORTED", "COMPLETE"]) {
      expect(trangThaiTuUns({ state: s })).toBe("idle");
    }
    // ĐỐI CHỨNG: không nơi nào trong hàm còn sinh ra `stopped` — hai chữ cho một trạng thái là lớp lỗi QA Đợt 37 đo.
    for (const s of ["IDLE", "STOPPED", "HELD", "ABORTED", "COMPLETE", "OFFLINE", "EXECUTE", "RUNNING"]) {
      expect(trangThaiTuUns({ state: s })).not.toBe("stopped");
    }
  });

  it("hoa/thường và khoảng trắng không đổi kết quả", () => {
    expect(trangThaiTuUns({ state: "  execute " })).toBe("running");
  });

  it("★★★ `state` LẠ ⇒ `null`, TUYỆT ĐỐI không phải `stopped`", () => {
    /*
     * ĐỐI CHỨNG có chủ đích: một trạng thái không nhận ra nghĩa là ta KHÔNG HIỂU
     * thiết bị đang nói gì — khác hẳn với biết chắc nó đã dừng. Quy về `stopped`
     * sẽ vẽ một máy đang chạy thành máy đã dừng, và không gì kêu.
     */
    expect(trangThaiTuUns({ state: "WARP_SPEED" })).toBeNull();
    expect(trangThaiTuUns({ state: "" })).toBeNull();
    expect(trangThaiTuUns({})).toBeNull();
  });
});

describe("mocTuUns — `ts` là MỐC ĐO, không phải lúc gói tới (NT-3.4)", () => {
  it("ISO hợp lệ → ms epoch", () => {
    expect(mocTuUns("2026-09-07T00:00:00.000Z")).toBe(Date.parse("2026-09-07T00:00:00.000Z"));
  });

  it("★★★ thiếu/hỏng ⇒ `null`, KHÔNG phải `Date.now()` và KHÔNG phải 0", () => {
    /*
     * `Date.now()` ở đây là lời khai bịa về độ tươi; `0` nghĩa là 1970 và sẽ
     * làm máy rơi vào `khong_ro` vì "cũ 56 năm" — cũng sai, chỉ sai kiểu khác.
     */
    expect(mocTuUns(null)).toBeNull();
    expect(mocTuUns(undefined)).toBeNull();
    expect(mocTuUns("khong-phai-ngay")).toBeNull();
  });
});

describe("mocTuAnhChupUns — quy về `MocTrangThai` của kho dùng chung", () => {
  it("★★★ ảnh chụp KHÔNG có `machineId` bị BỎ QUA, không đoán", () => {
    // Đoán sai sẽ tô trạng thái của thiết bị A lên thiết bị B.
    const ra = mocTuAnhChupUns(
      [{ state: "EXECUTE", ts: "2026-09-07T00:00:00Z" }, { machineId: 7, state: "IDLE", ts: "2026-09-07T00:00:00Z" }],
      new Map(),
    );
    expect(ra).toHaveLength(1);
    expect(ra[0].machineId).toBe(7);
  });

  it("★★★ `isActive` KHÔNG suy từ UNS — lấy từ bảng nền", () => {
    /*
     * UNS nói về TÍN HIỆU thiết bị; `isActive` là quyết định KHAI THÁC của con
     * người. Suy cái này từ cái kia sẽ làm máy mất mạng vài phút tự khai là
     * "đã ngừng khai thác".
     */
    const ra = mocTuAnhChupUns(
      [{ machineId: 1, state: "OFFLINE", ts: "2026-09-07T00:00:00Z" }],
      new Map([[1, false]]),
    );
    expect(ra[0].isActive).toBe(false);
    // …và máy KHÔNG có trong bảng nền mặc định CÒN khai thác ("chưa biết" ≠ "đã ngừng").
    const ra2 = mocTuAnhChupUns([{ machineId: 99, state: "IDLE", ts: "2026-09-07T00:00:00Z" }], new Map());
    expect(ra2[0].isActive).toBe(true);
  });

  it("mang đủ ba ô mà `apDung()` cần, và `capNhatLuc` đến TỪ `ts`", () => {
    const ts = "2026-09-06T10:30:00.000Z";
    const [m] = mocTuAnhChupUns([{ machineId: 3, state: "EXECUTE", ts }], new Map([[3, true]]));
    expect(m).toEqual({
      machineId: 3,
      trangThai: "running",
      capNhatLuc: Date.parse(ts),
      isActive: true,
    });
  });

  it("★★★ ĐỐI CHỨNG — `ts` hỏng KHÔNG được biến thành mốc tươi", () => {
    const [m] = mocTuAnhChupUns([{ machineId: 3, state: "EXECUTE", ts: "rac" }], new Map());
    // `null` ⇒ `trangThaiHienThi` xếp `khong_ro`. Nếu ô này ra một số gần
    // `Date.now()` thì một máy chưa từng báo cáo sẽ tự khai là vừa chạy xong.
    expect(m.capNhatLuc).toBeNull();
  });
});
