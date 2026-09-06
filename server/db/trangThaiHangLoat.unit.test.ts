import { describe, it, expect } from "vitest";
import { quyTuoiMay, quyUptime } from "./twinCanh";

/**
 * ★★★ ĐỢT 6 (§6.3 + NT-3/G15) — GHIM HAI QUYẾT ĐỊNH DO PHÉP ĐO ÉP RA.
 *
 * Cả hai đều KHÔNG hiển nhiên, và bản viết đầu của Đợt 6 đã làm SAI cả hai
 * trước khi đo. Test này tồn tại để bản sau không làm sai lại.
 */

/** Ảnh chụp SỐ THẬT đo trên `aoi_management` 2026-09-07 (SQL thô, đường độc lập). */
const DO_THAT = {
  /** 3 conveyor `operationStatus='running'`, nhịp tim chết 2026-07-17. */
  conveyorHbMay: "2026-07-17 00:13:29.987",
  conveyorHbBang: "2026-07-17 01:26:09.833",
  /** Log trạng thái của CHÍNH ba máy đó lại rất mới — đây là cái bẫy. */
  conveyorStatusLog: "2026-09-06 15:28:28.568511",
  bayGio: new Date("2026-09-07 00:00:00Z").getTime(),
};

describe("quyTuoiMay — mốc tươi là NHỊP TIM, không phải log trạng thái", () => {
  it("★★★ ba conveyor im lặng ~52 ngày PHẢI ra ~52 ngày, KHÔNG ra 0,4 ngày", () => {
    const { doTuoiGiay } = quyTuoiMay(
      { hbBang: DO_THAT.conveyorHbBang, hbMay: DO_THAT.conveyorHbMay },
      DO_THAT.bayGio,
    );
    expect(doTuoiGiay).not.toBeNull();
    const ngay = doTuoiGiay! / 86400;
    // Ghim KHOẢNG, không ghim số chính xác: test không được đỏ vì lệch giây.
    expect(ngay).toBeGreaterThan(50);
    expect(ngay).toBeLessThan(54);
  });

  it("★★★ ĐỐI CHỨNG — nếu ai đó trộn `machine_status_logs` vào, ô này ĐỎ", () => {
    // Đây là bản cài đặt SAI đã bị phép đo bác bỏ: `max` của cả ba nguồn.
    const sai = Math.max(
      new Date(DO_THAT.conveyorHbBang).getTime(),
      new Date(DO_THAT.conveyorHbMay).getTime(),
      new Date(DO_THAT.conveyorStatusLog).getTime(),
    );
    const ngaySai = (DO_THAT.bayGio - sai) / 86400000;
    // Bản sai cho ~0,4 ngày ⇒ máy chết 52 ngày trông như vừa gửi tín hiệu.
    expect(ngaySai).toBeLessThan(1);
    // Và bản ĐÚNG phải KHÁC hẳn bản sai — nếu hai bên bằng nhau thì test trên
    // không chứng minh gì (nó sẽ xanh với cả hai cài đặt).
    const dung = quyTuoiMay({ hbBang: DO_THAT.conveyorHbBang, hbMay: DO_THAT.conveyorHbMay }, DO_THAT.bayGio);
    expect(dung.doTuoiGiay! / 86400).toBeGreaterThan(ngaySai + 40);
  });

  it("★★★ CHƯA TỪNG báo cáo ⇒ null, TUYỆT ĐỐI không phải 0", () => {
    const kq = quyTuoiMay({ hbBang: null, hbMay: null }, DO_THAT.bayGio);
    expect(kq.capNhatLuc).toBeNull();
    expect(kq.doTuoiGiay).toBeNull();
    // `0` nói "vừa cập nhật xong" — câu nói dối mạnh nhất về máy im lặng vĩnh viễn.
    expect(kq.doTuoiGiay).not.toBe(0);
  });

  it("lấy nguồn MỚI NHẤT trong hai nguồn nhịp tim", () => {
    const cu = "2026-09-01 00:00:00Z";
    const moi = "2026-09-06 00:00:00Z";
    const a = quyTuoiMay({ hbBang: cu, hbMay: moi }, DO_THAT.bayGio);
    const b = quyTuoiMay({ hbBang: moi, hbMay: cu }, DO_THAT.bayGio);
    expect(a.capNhatLuc).toBe(b.capNhatLuc);
    expect(a.capNhatLuc).toBe(new Date(moi).getTime());
  });

  it("một nguồn null thì vẫn dùng nguồn còn lại", () => {
    const t = "2026-09-06 00:00:00Z";
    expect(quyTuoiMay({ hbBang: t, hbMay: null }, DO_THAT.bayGio).capNhatLuc).toBe(new Date(t).getTime());
    expect(quyTuoiMay({ hbBang: null, hbMay: t }, DO_THAT.bayGio).capNhatLuc).toBe(new Date(t).getTime());
  });

  it("ngày giờ RÁC bị loại, không thành NaN lọt xuống UI", () => {
    const kq = quyTuoiMay({ hbBang: "khong-phai-ngay", hbMay: null }, DO_THAT.bayGio);
    expect(kq.capNhatLuc).toBeNull();
    expect(kq.doTuoiGiay).toBeNull();
  });

  it("đồng hồ lệch (dữ liệu ở TƯƠNG LAI) ⇒ tuổi 0, không âm", () => {
    const tuongLai = DO_THAT.bayGio + 5000;
    expect(quyTuoiMay({ hbBang: new Date(tuongLai), hbMay: null }, DO_THAT.bayGio).doTuoiGiay).toBe(0);
  });
});

describe("quyUptime — cửa sổ rỗng là `null`, không phải 0%", () => {
  it("★ không có bản ghi nào ⇒ null (chưa đo), KHÔNG 0 (đã đo và chết hẳn)", () => {
    expect(quyUptime(undefined)).toBeNull();
    expect(quyUptime({ online: 0, offline: 0 })).toBeNull();
  });

  it("0% THẬT vẫn ra 0 — `null` không được nuốt mất ca chết hẳn", () => {
    // Ca dương của cờ trên: có đo, và kết quả thật sự là 0%.
    expect(quyUptime({ online: 0, offline: 3600 })).toBe(0);
  });

  it("tính đúng và làm tròn 1 chữ số", () => {
    expect(quyUptime({ online: 3600, offline: 0 })).toBe(100);
    expect(quyUptime({ online: 1, offline: 1 })).toBe(50);
    expect(quyUptime({ online: 2, offline: 1 })).toBe(66.7);
  });
});
