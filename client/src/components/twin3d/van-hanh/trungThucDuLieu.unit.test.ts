/**
 * Test của `trungThucDuLieu.ts` — NT-3 / §9.5.
 *
 * ★★★ CA DƯƠNG CỦA BỘ TEST NÀY LÀ DỮ LIỆU THẬT CỦA DB NÀY (luật G5).
 *   Đo 2026-09-06 bằng SQL thô: 42 máy `isActive`, **0 tươi / 0 cũ / 42 không
 *   rõ**, trong đó **3 máy khai `running`** với `lastHeartbeat` từ 2026-07-17.
 *   Nghĩa là phép đo "máy running có được tô xanh không" KHÔNG phải giả thuyết —
 *   nó là trạng thái mặc định của môi trường dev, và một bản cài đặt ngây thơ sẽ
 *   vẽ 3 ô xanh trên một nhà máy đã im lặng gần hai tháng.
 *
 * ⇒ Test `running + tim đập 2 tháng trước ⇒ khong_ro` bên dưới là ca dương có
 *   thật, không phải ca dựng.
 */
import { describe, it, expect } from "vitest";
import { mauChoTrangThai } from "../mauTrangThai";
import {
  NGUONG_CU_MS,
  NGUONG_TUOI_MS,
  demTheoTrangThai,
  demTheoTuoi,
  doiSoatCanh,
  hienSo,
  nhanDoTuoi,
  thoiDiemDuLieuMoiNhat,
  tsTrangThaiTuIssues,
  trangThaiHienThi,
  type MayVanHanh,
} from "./trungThucDuLieu";

const BAY_GIO = Date.parse("2026-09-06T12:00:00.000Z");

function may(sua: Partial<MayVanHanh> = {}): MayVanHanh {
  return {
    id: 1,
    ma: "AOI-01",
    ten: "AOI 01",
    loaiMay: "AOI",
    trangThaiBaoCao: "running",
    thoiDiemDuLieu: BAY_GIO - 1_000,
    isActive: true,
    stationId: 1,
    lineId: 1,
    ...sua,
  };
}

describe("trangThaiHienThi — ★★★ trục sống còn của NT-3", () => {
  it("dữ liệu tươi (<60s) ⇒ giữ nguyên trạng thái máy khai", () => {
    const tt = trangThaiHienThi(may({ thoiDiemDuLieu: BAY_GIO - 30_000 }), BAY_GIO);
    expect(tt).toEqual({ trangThai: "running", tuoi: "tuoi", daGhiDe: false });
  });

  it("dữ liệu cũ (60s–5ph) ⇒ vẫn giữ trạng thái, nhưng đánh dấu tuổi 'cu'", () => {
    const tt = trangThaiHienThi(may({ thoiDiemDuLieu: BAY_GIO - 120_000 }), BAY_GIO);
    expect(tt.trangThai).toBe("running");
    expect(tt.tuoi).toBe("cu");
  });

  it("★★★ CA DƯƠNG THẬT — máy khai 'running' với tim đập 2 THÁNG trước ⇒ khong_ro, KHÔNG xanh", () => {
    // Đây chính xác là 3 máy trong DB dev (`max(lastHeartbeat)` = 2026-07-17).
    const timDapThang7 = Date.parse("2026-07-17T00:13:29.996Z");
    const tt = trangThaiHienThi(may({ trangThaiBaoCao: "running", thoiDiemDuLieu: timDapThang7 }), BAY_GIO);
    expect(tt.trangThai).toBe("khong_ro");
    expect(tt.daGhiDe).toBe(true);

    // Và luật phải đi TỚI TẬN MÀU — không dừng ở một chuỗi trạng thái.
    const mau = mauChoTrangThai(tt.trangThai);
    expect(mau.hoaTiet).toBe("gach_cheo");
    expect(mau.token).not.toBe(mauChoTrangThai("running").token);
  });

  it("★ chưa TỪNG báo cáo (lastHeartbeat null) ⇒ khong_ro, và daGhiDe=false", () => {
    // 2/42 máy của DB này. Không ghi đè lên cái gì vì máy chưa khai gì.
    const tt = trangThaiHienThi(may({ trangThaiBaoCao: null, thoiDiemDuLieu: null }), BAY_GIO);
    expect(tt.trangThai).toBe("khong_ro");
    expect(tt.daGhiDe).toBe(false);
  });

  it("★ isActive=false THẮNG cả tuổi dữ liệu ⇒ ngung_khai_thac, không phải khong_ro", () => {
    // Máy ngừng khai thác KHÔNG "mất tín hiệu" — nó không còn phải gửi tín hiệu
    // nào. Xếp vào khong_ro sẽ đẻ một cảnh báo giả mỗi ngày.
    const tt = trangThaiHienThi(
      may({ isActive: false, trangThaiBaoCao: "running", thoiDiemDuLieu: null }),
      BAY_GIO,
    );
    expect(tt.trangThai).toBe("ngung_khai_thac");
    expect(mauChoTrangThai(tt.trangThai).doMo).toBeCloseTo(0.35);
  });

  it("★ CHIỀU NGƯỢC — luật không nới bừa: máy error tươi vẫn là error, không bị nuốt thành khong_ro", () => {
    const tt = trangThaiHienThi(may({ trangThaiBaoCao: "error", thoiDiemDuLieu: BAY_GIO }), BAY_GIO);
    expect(tt.trangThai).toBe("error");
    expect(mauChoTrangThai(tt.trangThai).laBatThuong).toBe(true);
  });

  it("biên chính xác tại 60s và 5 phút", () => {
    const tai60 = trangThaiHienThi(may({ thoiDiemDuLieu: BAY_GIO - NGUONG_TUOI_MS }), BAY_GIO);
    expect(tai60.tuoi).toBe("cu");
    const tai5ph = trangThaiHienThi(may({ thoiDiemDuLieu: BAY_GIO - NGUONG_CU_MS }), BAY_GIO);
    expect(tai5ph.tuoi).toBe("cu");
    const qua5ph = trangThaiHienThi(may({ thoiDiemDuLieu: BAY_GIO - NGUONG_CU_MS - 1 }), BAY_GIO);
    expect(qua5ph.tuoi).toBe("khong_ro");
  });

  it("trạng thái LẠ (enum nở thêm giá trị) rơi về khong_ro, KHÔNG về running", () => {
    const tt = trangThaiHienThi(may({ trangThaiBaoCao: "trang_thai_moi_toanh" }), BAY_GIO);
    expect(mauChoTrangThai(tt.trangThai).token).toBe(mauChoTrangThai("khong_ro").token);
  });
});

describe("tsTrangThaiTuIssues — ★★★ HỒI QUY: lỗi giả-tươi bắt được trên trình duyệt thật", () => {
  it("★★★ CA DƯƠNG — một ANDON mới KHÔNG được làm máy trông như vừa gửi tín hiệu", () => {
    // Đây chính xác là lỗi đo được 2026-09-06: raise andon id=25 lên máy 2 làm ô
    // "tươi" nhảy 0→1 và máy 2 hiện "16s", trong khi SQL thô nói nó im lặng từ
    // 2026-09-03. `andon.raisedAt` KHÔNG phải thời điểm đo trạng thái.
    const m = tsTrangThaiTuIssues(
      [{ kind: "andon", machineId: 2, ageMinutes: 0.2 }],
      BAY_GIO,
    );
    expect(m.get(2)).toBeUndefined();

    // Và hệ quả phải đi tới tận trạng thái hiển thị: KHÔNG có ts ⇒ khong_ro.
    const tt = trangThaiHienThi(
      may({ id: 2, trangThaiBaoCao: "idle", thoiDiemDuLieu: m.get(2) ?? null }),
      BAY_GIO,
    );
    expect(tt.trangThai).toBe("khong_ro");
  });

  it("★ CHIỀU NGƯỢC — `offline` MANG thời điểm đo thật, phải được nhận", () => {
    // Nếu hàm lọc sạch mọi thứ thì nó "đúng" một cách vô dụng.
    const m = tsTrangThaiTuIssues([{ kind: "offline", machineId: 7, ageMinutes: 3 }], BAY_GIO);
    expect(m.get(7)).toBe(BAY_GIO - 3 * 60_000);
  });

  it("bốn loại issue KHÔNG mang ts trạng thái đều bị loại", () => {
    for (const kind of ["andon", "alarm", "pdm", "workorder"]) {
      expect(tsTrangThaiTuIssues([{ kind, machineId: 1, ageMinutes: 0 }], BAY_GIO).size).toBe(0);
    }
  });

  it("nhiều issue offline cùng máy ⇒ lấy MỚI NHẤT", () => {
    const m = tsTrangThaiTuIssues(
      [
        { kind: "offline", machineId: 5, ageMinutes: 60 },
        { kind: "offline", machineId: 5, ageMinutes: 2 },
      ],
      BAY_GIO,
    );
    expect(m.get(5)).toBe(BAY_GIO - 2 * 60_000);
  });

  it("ageMinutes rác / machineId thiếu ⇒ bỏ qua, KHÔNG ném", () => {
    const m = tsTrangThaiTuIssues(
      [
        { kind: "offline", machineId: null, ageMinutes: 1 },
        { kind: "offline", machineId: 3, ageMinutes: NaN },
        { kind: "offline", machineId: 4 },
      ],
      BAY_GIO,
    );
    expect(m.size).toBe(0);
  });
});

describe("demTheoTuoi / demTheoTrangThai", () => {
  it("★ tái hiện ĐÚNG phân bố đo được của DB dev: 42 máy, 0 tươi, 42 không rõ", () => {
    const timDapCu = Date.parse("2026-09-03T17:39:51.478Z");
    const ds = Array.from({ length: 42 }, (_, i) =>
      may({ id: i + 1, thoiDiemDuLieu: i < 40 ? timDapCu : null, trangThaiBaoCao: i < 3 ? "running" : "stopped" }),
    );
    const d = demTheoTuoi(ds, BAY_GIO);
    expect(d).toEqual({ tuoi: 0, cu: 0, khongRo: 42, ngungKhaiThac: 0, tong: 42 });

    // ★ Đối chiếu bằng MÔ HÌNH RỜI (BG-127): đếm theo TRẠNG THÁI phải cho cùng
    //   kết luận với đếm theo TUỔI — 0 máy nào được hiển thị là `running`.
    const theoTt = demTheoTrangThai(ds, BAY_GIO);
    expect(theoTt.running ?? 0).toBe(0);
    expect(theoTt.khong_ro).toBe(42);
  });

  it("máy ngừng khai thác được tách riêng, không lẫn vào khongRo", () => {
    const ds = [may({ id: 1, isActive: false }), may({ id: 2, thoiDiemDuLieu: null })];
    expect(demTheoTuoi(ds, BAY_GIO)).toEqual({
      tuoi: 0, cu: 0, khongRo: 1, ngungKhaiThac: 1, tong: 2,
    });
  });

  it("danh sách rỗng ⇒ mọi ô 0 và tong 0 (không ném)", () => {
    expect(demTheoTuoi([], BAY_GIO).tong).toBe(0);
    expect(demTheoTrangThai([], BAY_GIO)).toEqual({});
  });
});

describe("thoiDiemDuLieuMoiNhat — ★★★ NT-3.2", () => {
  it("là max(timestamp) của DỮ LIỆU, không phải thời điểm render", () => {
    const ds = [
      may({ id: 1, thoiDiemDuLieu: 1000 }),
      may({ id: 2, thoiDiemDuLieu: 5000 }),
      may({ id: 3, thoiDiemDuLieu: 3000 }),
    ];
    // Giá trị KHÔNG phụ thuộc `bayGio` — đó là toàn bộ điểm của NT-3.2.
    expect(thoiDiemDuLieuMoiNhat(ds)).toBe(5000);
  });

  it("bỏ qua máy chưa từng báo cáo, nhưng 0 máy nào báo cáo ⇒ null (hiện '—')", () => {
    expect(thoiDiemDuLieuMoiNhat([may({ thoiDiemDuLieu: null }), may({ thoiDiemDuLieu: 7 })])).toBe(7);
    expect(thoiDiemDuLieuMoiNhat([may({ thoiDiemDuLieu: null })])).toBeNull();
    expect(thoiDiemDuLieuMoiNhat([])).toBeNull();
  });
});

describe("doiSoatCanh — NT-3.3, thuốc chống model drift", () => {
  it("khớp hoàn toàn ⇒ không lệch", () => {
    const ds = [may({ id: 1 }), may({ id: 2 })];
    const kq = doiSoatCanh(ds, [1, 2]);
    expect(kq.lech).toBe(false);
    expect(kq.soMayDb).toBe(2);
    expect(kq.soNodeCanh).toBe(2);
  });

  it("★ máy có trong DB mà THIẾU chỗ trên mặt bằng ⇒ banner vàng", () => {
    const kq = doiSoatCanh([may({ id: 1 }), may({ id: 2 }), may({ id: 3 })], [1]);
    expect(kq.thieuTrenMatBang).toEqual([2, 3]);
    expect(kq.lech).toBe(true);
  });

  it("★ đặt chỗ MỒ CÔI (trỏ vào máy đã ngừng) — ca đo được của DB này (1 hàng)", () => {
    const kq = doiSoatCanh([may({ id: 1 }), may({ id: 9, isActive: false })], [1, 9]);
    expect(kq.datChoMoCoi).toEqual([9]);
    expect(kq.lech).toBe(true);
    // Máy ngừng khai thác KHÔNG bị tính là "thiếu trên mặt bằng".
    expect(kq.thieuTrenMatBang).toEqual([]);
  });

  it("★★★ HAI CHIỀU CÙNG LÚC — hai sai số KHÔNG được triệt tiêu nhau", () => {
    // Đây là lý do phải so theo TẬP HỢP id chứ không so theo con số đếm (BG-127):
    // 1 máy thiếu chỗ + 1 chỗ mồ côi cho ra TỔNG bằng nhau, và một phép so tổng
    // sẽ báo "khớp" trên một mặt bằng vừa thiếu vừa thừa.
    const kq = doiSoatCanh([may({ id: 1 }), may({ id: 2 }), may({ id: 9, isActive: false })], [1, 9]);
    expect(kq.soMayDb).toBe(2); // máy sống: 1, 2
    expect(kq.soNodeCanh).toBe(1); // chỉ máy 1 vừa sống vừa có chỗ
    expect(kq.thieuTrenMatBang).toEqual([2]);
    expect(kq.datChoMoCoi).toEqual([9]);
    expect(kq.lech).toBe(true);
  });

  it("kết quả TẤT ĐỊNH — id luôn sắp tăng dần bất kể thứ tự đầu vào", () => {
    const kq = doiSoatCanh([may({ id: 5 }), may({ id: 2 }), may({ id: 9 })], []);
    expect(kq.thieuTrenMatBang).toEqual([2, 5, 9]);
  });
});

describe("hienSo — ★ NT-3.5 đếm RỖNG khác đếm 0", () => {
  it("đang tải / null / undefined ⇒ '—', KHÔNG phải '0'", () => {
    expect(hienSo(null)).toBe("—");
    expect(hienSo(undefined)).toBe("—");
    expect(hienSo(5, true)).toBe("—");
    expect(hienSo(NaN)).toBe("—");
  });

  it("★ số 0 THẬT vẫn hiện '0' — đã đo và kết quả là không có cái nào", () => {
    expect(hienSo(0)).toBe("0");
    expect(hienSo(42)).toBe("42");
  });
});

describe("nhanDoTuoi", () => {
  it("trả số giây và cờ đỏ khi quá 60 giây", () => {
    expect(nhanDoTuoi(BAY_GIO - 12_000, BAY_GIO)).toEqual({ giay: 12, do: false });
    expect(nhanDoTuoi(BAY_GIO - 90_000, BAY_GIO)).toEqual({ giay: 90, do: true });
  });

  it("chưa từng có dữ liệu ⇒ giay null + đỏ (UI hiện '—')", () => {
    expect(nhanDoTuoi(null, BAY_GIO)).toEqual({ giay: null, do: true });
  });

  it("★ đồng hồ client chạy TRƯỚC server ⇒ kẹp về 0, không hiện 'cập nhật -3 giây trước'", () => {
    expect(nhanDoTuoi(BAY_GIO + 3_000, BAY_GIO).giay).toBe(0);
  });
});
