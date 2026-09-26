import { describe, it, expect } from "vitest";
import {
  KHO_RONG,
  NGUONG_SONG_MS,
  apDung,
  dongHoHienThi,
  hopNhat,
  ketNoiTheoMoc,
  trangThaiTheoMay,
  type MocTrangThai,
} from "./khoTrangThai";
import type { MayVanHanh } from "./trungThucDuLieu";

/**
 * ★★★ ĐỢT 6 — GHIM §9.8 ("MỘT kho cho live và replay") VÀ G15 (ba trạng thái).
 *
 * Test quan trọng nhất của tệp này là `MOT DUONG` ở cuối: nó chứng minh live và
 * replay cho ra KẾT QUẢ GIỐNG HỆT khi cùng dữ liệu — không bằng lời khai
 * "chúng tôi dùng chung store", mà bằng cách chạy cả hai và so từng ô.
 */

const T = new Date("2026-09-07T10:00:00Z").getTime();

function may(id: number, trangThai: string | null, tuoiGiay: number | null): MayVanHanh {
  return {
    id,
    ma: `M-${id}`,
    ten: `May ${id}`,
    loaiMay: "aoi",
    trangThaiBaoCao: trangThai,
    thoiDiemDuLieu: tuoiGiay == null ? null : T - tuoiGiay * 1000,
    isActive: true,
    stationId: 1,
    lineId: 1,
  };
}

function moc(id: number, trangThai: string | null, tuoiGiay: number | null): MocTrangThai {
  return {
    machineId: id,
    trangThai,
    capNhatLuc: tuoiGiay == null ? null : T - tuoiGiay * 1000,
    isActive: true,
  };
}

describe("ketNoiTheoMoc — G15: BA (năm) trạng thái, không phải hai", () => {
  it("★★★ CHƯA kết nối và CHƯA từng nhận ⇒ `chua_ket_noi` (UI phải hiện `—`)", () => {
    expect(ketNoiTheoMoc(KHO_RONG, false, T)).toBe("chua_ket_noi");
  });

  it("★★★ ĐÃ kết nối nhưng CHƯA có gói ⇒ `dang_cho` — KHÁC `chua_ket_noi`", () => {
    // Đây đúng ô mà `isStreaming` một chiều của `useTwinStream` không có: cả hai
    // ca đều cho `isStreaming === false` nên UI không phân biệt được.
    expect(ketNoiTheoMoc(KHO_RONG, true, T)).toBe("dang_cho");
    expect(ketNoiTheoMoc(KHO_RONG, true, T)).not.toBe(ketNoiTheoMoc(KHO_RONG, false, T));
  });

  it("có gói còn mới ⇒ `truc_tiep`", () => {
    const kho = apDung(KHO_RONG, { may: [moc(1, "running", 5)], bayGio: T, nguon: "socket" });
    expect(ketNoiTheoMoc(kho, true, T + 1000)).toBe("truc_tiep");
  });

  it("★★★ có gói nhưng IM quá ngưỡng ⇒ `im_lang` — chiều mà cờ cũ KHÔNG có", () => {
    const kho = apDung(KHO_RONG, { may: [moc(1, "running", 5)], bayGio: T, nguon: "socket" });
    // Socket vẫn "connected" (daKetNoi = true) mà vẫn phải ra `im_lang`: SỐ
    // quyết định, không phải cờ transport tự khai.
    expect(ketNoiTheoMoc(kho, true, T + NGUONG_SONG_MS + 1)).toBe("im_lang");
  });

  it("ngay TẠI ngưỡng vẫn là `truc_tiep` (biên đóng)", () => {
    const kho = apDung(KHO_RONG, { may: [moc(1, "running", 5)], bayGio: T, nguon: "socket" });
    expect(ketNoiTheoMoc(kho, true, T + NGUONG_SONG_MS)).toBe("truc_tiep");
  });

  it("đang tua ⇒ `xem_lai`, thắng mọi trạng thái khác", () => {
    const kho = apDung(KHO_RONG, {
      may: [moc(1, "running", 5)], bayGio: T, nguon: "lich_su", mocXemLai: T - 3600_000,
    });
    expect(ketNoiTheoMoc(kho, true, T)).toBe("xem_lai");
    expect(ketNoiTheoMoc(kho, false, T)).toBe("xem_lai");
  });
});

describe("apDung — gói THAY THẾ, không merge", () => {
  it("★ máy biến mất khỏi gói thì biến mất khỏi kho", () => {
    // Merge sẽ giữ máy 2 lại vĩnh viễn với giá trị cũ — màn hình vẽ một cái máy
    // không còn ở đó nữa, và không gì kêu.
    let kho = apDung(KHO_RONG, { may: [moc(1, "running", 5), moc(2, "error", 5)], bayGio: T, nguon: "socket" });
    expect(kho.theoMay.size).toBe(2);
    kho = apDung(kho, { may: [moc(1, "running", 5)], bayGio: T + 1000, nguon: "socket" });
    expect(kho.theoMay.size).toBe(1);
    expect(kho.theoMay.has(2)).toBe(false);
  });

  it("gói RỖNG vẫn cập nhật `nhanLuc` — 'đo xong, không có máy nào' là một phép đo", () => {
    const kho = apDung(KHO_RONG, { may: [], bayGio: T, nguon: "socket" });
    expect(kho.theoMay.size).toBe(0);
    // Nếu gói rỗng không đặt `nhanLuc`, kho sẽ mãi ở `dang_cho` và UI khai
    // "chưa có dữ liệu" trong khi server vẫn phát đều — đúng lỗi G15 ở
    // broadcaster mà Đợt 6 đã vá phía server.
    expect(kho.nhanLuc).toBe(T);
    expect(ketNoiTheoMoc(kho, true, T)).toBe("truc_tiep");
  });
});

describe("hopNhat — kho là lớp PHỦ, không phải nguồn duy nhất", () => {
  it("kho rỗng ⇒ giữ nguyên nền (không xoá trắng cảnh lúc mới mở trang)", () => {
    const nen = [may(1, "running", 10), may(2, "stopped", 20)];
    expect(hopNhat(nen, KHO_RONG)).toEqual(nen);
  });

  it("máy KHÔNG có trong kho giữ nguyên giá trị nền", () => {
    const nen = [may(1, "running", 10), may(2, "stopped", 20)];
    const kho = apDung(KHO_RONG, { may: [moc(1, "error", 1)], bayGio: T, nguon: "socket" });
    const ra = hopNhat(nen, kho);
    expect(ra[0].trangThaiBaoCao).toBe("error");
    expect(ra[1].trangThaiBaoCao).toBe("stopped");
  });

  it("★ `capNhatLuc = null` từ kho KHÔNG bị quy về 0", () => {
    const nen = [may(1, "running", 10)];
    const kho = apDung(KHO_RONG, { may: [moc(1, "running", null)], bayGio: T, nguon: "socket" });
    expect(hopNhat(nen, kho)[0].thoiDiemDuLieu).toBeNull();
  });
});

describe("★★★ §9.8 — LIVE và REPLAY đi CÙNG MỘT ĐƯỜNG", () => {
  it("★★★ cùng dữ liệu ⇒ KẾT QUẢ GIỐNG HỆT, chỉ khác nhãn nguồn", () => {
    const nen = [may(1, "running", 0), may(2, "stopped", 0), may(3, null, null)];
    const goi = [moc(1, "running", 10), moc(2, "error", 400), moc(3, "running", null)];

    // Đường LIVE: gói tới từ socket, xét tuổi theo giờ hiện tại.
    const khoLive = apDung(KHO_RONG, { may: goi, bayGio: T, nguon: "socket" });
    const ttLive = trangThaiTheoMay(hopNhat(nen, khoLive), dongHoHienThi(khoLive, T));

    // Đường REPLAY: CÙNG gói, nhưng là ảnh lịch sử chụp lúc T.
    const khoReplay = apDung(KHO_RONG, { may: goi, bayGio: T, nguon: "lich_su", mocXemLai: T });
    const ttReplay = trangThaiTheoMay(hopNhat(nen, khoReplay), dongHoHienThi(khoReplay, T));

    // So TỪNG Ô, không so tổng: hai bản đồ cùng kích thước mà khác nội dung sẽ
    // lọt qua một phép so `.size` (bài học BG-127 — liệt kê phân bố, đừng đếm tổng).
    expect([...ttReplay.keys()].sort()).toEqual([...ttLive.keys()].sort());
    for (const [id, v] of ttLive) {
      expect(ttReplay.get(id)).toEqual(v);
    }
  });

  it("★★★ replay xét tuổi theo MỐC ĐANG XEM, không theo giờ hiện tại", () => {
    // Máy im lặng lúc T phải hiện y như nó đã hiện lúc T, chứ không phải
    // "cũ 3 tiếng" tính từ bây giờ.
    const nen = [may(1, "running", 0)];
    const khoReplay = apDung(KHO_RONG, {
      may: [moc(1, "running", 10)], bayGio: T, nguon: "lich_su", mocXemLai: T,
    });
    const bayGioThat = T + 3 * 3600_000; // ba tiếng sau
    const dongHo = dongHoHienThi(khoReplay, bayGioThat);
    expect(dongHo).toBe(T); // dùng mốc xem lại, KHÔNG dùng giờ hiện tại

    const tt = trangThaiTheoMay(hopNhat(nen, khoReplay), dongHo);
    // Tuổi 10 giây tại mốc xem ⇒ vẫn "tươi", KHÔNG phải `khong_ro`.
    expect(tt.get(1)!.trangThai).toBe("running");

    // ĐỐI CHỨNG: nếu ai đó dùng giờ hiện tại thay vì mốc xem, máy này thành
    // `khong_ro` — ô dưới bắt đúng bản cài đặt sai đó.
    const ttSai = trangThaiTheoMay(hopNhat(nen, khoReplay), bayGioThat);
    expect(ttSai.get(1)!.trangThai).toBe("khong_ro");
  });

  it("live KHÔNG có `mocXemLai` ⇒ đồng hồ là giờ hiện tại", () => {
    const kho = apDung(KHO_RONG, { may: [moc(1, "running", 5)], bayGio: T, nguon: "socket" });
    expect(dongHoHienThi(kho, T + 5000)).toBe(T + 5000);
  });

  it("★ NT-3 vẫn thắng trong replay: máy khai `running` mà dữ liệu quá 5 phút ⇒ `khong_ro`", () => {
    const nen = [may(1, "running", 0)];
    const kho = apDung(KHO_RONG, {
      may: [moc(1, "running", 400)], bayGio: T, nguon: "lich_su", mocXemLai: T,
    });
    const tt = trangThaiTheoMay(hopNhat(nen, kho), dongHoHienThi(kho, T));
    expect(tt.get(1)!.trangThai).toBe("khong_ro");
    expect(tt.get(1)!.daGhiDe).toBe(true);
  });
});
