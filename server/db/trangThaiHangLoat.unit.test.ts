import { describe, it, expect } from "vitest";
import { quyTuoiMay, quyUptime, chonNguonMocTuoi } from "./twinCanh";

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

/**
 * ★★★ ĐỢT 6 VÁ THƯỜNG-4 — GHIM "MỐC TƯƠI CHỈ DÙNG NHỊP TIM".
 *
 * ⚠ VÙNG MÙ QA ĐO ĐƯỢC 2026-09-07: 14 test trên đây đều xanh, nhưng chúng chỉ
 * gọi `quyTuoiMay` — hàm KHÔNG BAO GIỜ THẤY `machine_status_logs`. Việc CHỌN
 * nguồn nằm ở chỗ gọi trong `traTrangThaiHangLoat`, và không test nào với tới.
 * QA tiêm đúng vào đó (`max(status_log, heartbeat)`) ⇒ **14/14 VẪN XANH**.
 *
 * ⇒ Phép chọn nguồn nay là `chonNguonMocTuoi` (hàm thuần, export), chỗ gọi đi
 *   qua nó, và các ô dưới đây import ĐÚNG nó. Tiêm "trộn status_log" vào hàm
 *   đó ⇒ các ô này ĐỎ.
 */
describe("chonNguonMocTuoi — mốc tươi CHỈ nhịp tim, KHÔNG trộn status_log", () => {
  it("★★★ `statusLogTs` MỚI HƠN vẫn bị VỨT ĐI — đây là ô QA tiêm mà 14/14 mù", () => {
    // Đúng số thật của 3 conveyor: nhịp tim chết 2026-07-17, log trạng thái
    // 2026-09-06. Nếu ai trộn status_log vào, ô này ĐỎ ngay.
    const chon = chonNguonMocTuoi({
      hbBang: DO_THAT.conveyorHbBang,
      hbMay: DO_THAT.conveyorHbMay,
      statusLogTs: DO_THAT.conveyorStatusLog,
    });
    expect(chon.hbBang).toBe(DO_THAT.conveyorHbBang);
    expect(chon.hbMay).toBe(DO_THAT.conveyorHbMay);
    // Và KHÔNG ô nào của kết quả mang mốc log trạng thái.
    expect(Object.values(chon)).not.toContain(DO_THAT.conveyorStatusLog);
  });

  it("★★★ NỐI ĐẦU-CUỐI — chọn nguồn rồi quy tuổi PHẢI ra ~52 ngày, KHÔNG ra 0,4", () => {
    // Đây là câu trả lời cho đúng lỗi G19: 3 băng tải im lặng 51,7 ngày bị báo
    // thành 0,4 ngày. Ô này đi HẾT đường mà mã sản phẩm đi.
    const { doTuoiGiay } = quyTuoiMay(
      chonNguonMocTuoi({
        hbBang: DO_THAT.conveyorHbBang,
        hbMay: DO_THAT.conveyorHbMay,
        statusLogTs: DO_THAT.conveyorStatusLog,
      }),
      DO_THAT.bayGio,
    );
    const ngay = doTuoiGiay! / 86400;
    expect(ngay).toBeGreaterThan(45);   // sự thật: im lặng ~52 ngày
    expect(ngay).toBeLessThan(60);
  });

  it("★★★ ĐỐI CHỨNG — nếu trộn status_log thì tuổi tụt xuống <1 ngày (bản SAI)", () => {
    // Ghim KHOẢNG CÁCH giữa bản đúng và bản sai. Nếu hai bên bằng nhau thì hai
    // ô trên không chứng minh gì — chúng sẽ xanh với cả hai cài đặt.
    const saiMoc = Math.max(
      new Date(DO_THAT.conveyorHbBang).getTime(),
      new Date(DO_THAT.conveyorHbMay).getTime(),
      new Date(DO_THAT.conveyorStatusLog).getTime(),
    );
    const ngaySai = (DO_THAT.bayGio - saiMoc) / 86400000;
    expect(ngaySai).toBeLessThan(1);

    const dung = quyTuoiMay(
      chonNguonMocTuoi({
        hbBang: DO_THAT.conveyorHbBang,
        hbMay: DO_THAT.conveyorHbMay,
        statusLogTs: DO_THAT.conveyorStatusLog,
      }),
      DO_THAT.bayGio,
    );
    expect(dung.doTuoiGiay! / 86400).toBeGreaterThan(ngaySai + 40);
  });

  it("★★★ CHỈ CÓ status_log, KHÔNG nhịp tim ⇒ `null` (CHƯA TỪNG báo cáo)", () => {
    // Ca nguy hiểm nhất: một máy chỉ có log trạng thái. Trộn status_log vào sẽ
    // biến nó thành "vừa cập nhật"; luật đúng nói "chưa từng gửi nhịp tim".
    const kq = quyTuoiMay(
      chonNguonMocTuoi({ hbBang: null, hbMay: null, statusLogTs: DO_THAT.conveyorStatusLog }),
      DO_THAT.bayGio,
    );
    expect(kq.capNhatLuc).toBeNull();
    expect(kq.doTuoiGiay).toBeNull();
  });

  it("`statusLogTs` VẮNG MẶT không đổi gì — hai nguồn nhịp tim giữ nguyên", () => {
    const co = chonNguonMocTuoi({ hbBang: "2026-09-01", hbMay: "2026-09-02", statusLogTs: "2026-09-06" });
    const khong = chonNguonMocTuoi({ hbBang: "2026-09-01", hbMay: "2026-09-02" });
    expect(co).toEqual(khong);
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

/* ═══════════════════════════════════════════════════════════════════════════ */
/* ★★★ ĐỢT 38 (Pareto #2 QA Đợt 37) — ẢNH LỊCH SỬ VÀ KHO LIVE NÓI CÙNG MỘT TỪ ĐIỂN                              */
/* ═══════════════════════════════════════════════════════════════════════════ */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/*
 * Đợt 6 ánh xạ `online → running` / `offline → stopped` từ hàng log (`nhatKyRaTrangThaiCanh`). QA Đợt 37 D-4 đo:
 * máy 14 im lặng 54 ngày ⇒ live `offline` mà tua-tại-bây-giờ khai `running 3,2 ngày`; chèn log `online` `now()`
 * ⇒ `running 1 s`. Hàng log là SỰ KIỆN CHUYỂN, không phải tín hiệu sống (G105). Phép thuần nay ở
 * `services/trangThaiMayTuoi.ts` (`trangThaiLichSuTaiMoc`, lưới riêng); lưới NÀY ghim CHỖ GỌI trong `twinCanh.ts`
 * (G16: có hàm chưa đủ, phải nối vào đúng chỗ) — đọc nguồn, bỏ chú thích.
 */
describe("Đợt 38 — twinCanh.ts nối vào MỘT từ điển (`mapMachineStatus` / `trangThaiLichSuTaiMoc`)", () => {
  const SRC = readFileSync(resolve(__dirname, "twinCanh.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  const than = (ten: string) => {
    const i = SRC.indexOf(`export async function ${ten}(`);
    expect(i, ten).toBeGreaterThan(-1);
    return SRC.slice(i, SRC.indexOf("\nexport ", i + 10));
  };

  it("★★★ `traTrangThaiHangLoat` (kho twin/socket) ra `trangThai` qua `mapMachineStatus(` với log + nhịp tim, KHÔNG còn `operationStatus` thô", () => {
    const t = than("traTrangThaiHangLoat");
    expect(t).toMatch(/trangThai: mapMachineStatus\(/);
    expect(t).toContain("nhipTimTs: capNhatLuc");
    expect(t).not.toMatch(/trangThai: bosung\?\.operationStatus/);
  });

  it("★★★ `traAnhLichSu` (tua lại) đọc NHỊP TIM ≤ mốc từ `machine_heartbeats` + `machines.lastHeartbeat`, qua `chonNguonMocTuoi` và `trangThaiLichSuTaiMoc(`", () => {
    const t = than("traAnhLichSu");
    expect(t).toContain("FROM machine_heartbeats");
    // câu nhịp tim phải CẮT TẠI MỐC (không nhìn trộm tương lai): sau `FROM machine_heartbeats` có `"timestamp" <= ${moc.toISOString()}`
    const iHb = t.indexOf("FROM machine_heartbeats");
    expect(t.slice(iHb, iHb + 300)).toContain('"timestamp" <= ${moc.toISOString()}');
    expect(t).toContain("lastHeartbeat: machines.lastHeartbeat");
    expect(t).toContain("chonNguonMocTuoi({");
    expect(t).toMatch(/trangThai: trangThaiLichSuTaiMoc\(/);
    expect(t).toContain("quyTuoiMay(nguonMoc, mocMs)");
  });

  it("★ ĐỐI CHỨNG — `nhatKyRaTrangThaiCanh` (ánh xạ từ log) KHÔNG còn tồn tại; hai câu thô đều mang `AT TIME ZONE 'UTC'` (G104)", () => {
    expect(SRC).not.toContain("nhatKyRaTrangThaiCanh");
    const t = than("traAnhLichSu");
    expect((t.match(/AT TIME ZONE 'UTC'/g) ?? []).length).toBe(2);
  });

  it("`LICH_SU_LA_XAP_XI` vẫn được khai (NT-4: replay chỉ dựng được KẾT NỐI)", () => {
    expect(SRC).toContain("export const LICH_SU_LA_XAP_XI = true;");
  });
});
