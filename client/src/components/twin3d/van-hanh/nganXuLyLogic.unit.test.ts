/**
 * Test của `nganXuLyLogic.ts` — §9.2 / §9.3.
 *
 * ★★★ BÁNH CÓC QUAN TRỌNG NHẤT của tệp này là bài kiểm TÊN MODULE QUYỀN.
 *   Lượt viết đầu tiên của bảng §9.3 đoán hai tên (`traceability`,
 *   `production_view`) — cả hai không tồn tại. Một tên module sai KHÔNG ném lỗi:
 *   `hasPermission` chỉ trả `false`, nên nút lặng lẽ biến mất với mọi người dùng
 *   không-admin và không phép đo nào kêu. Test dưới đây đối chiếu từng tên với
 *   `PERMISSION_MODULES` THẬT, nên lớp lỗi đó không thể tái diễn im lặng.
 */
import { describe, it, expect } from "vitest";
import { isValidPermissionModule } from "@shared/permissions";
import {
  docStatsAoi,
  MOC_AN_TAM_GIO,
  QUYEN_RONG,
  TRAN_AN_TAM_GIO,
  dangAnTam,
  hanAnTam,
  hanhDongBamDuoc,
  hanhDongChoVatThe,
  nutDieuHuongCho,
  nutSuaBoTri,
  type CanhBaoDangMo,
  type LoaiDich,
  type QuyenXuLy,
  nguoiGanDuoc,
} from "./nganXuLyLogic";

const BAY_GIO = Date.parse("2026-09-06T12:00:00.000Z");

const QUYEN_DU: QuyenXuLy = {
  ackAlarm: true,
  anTamAlarm: true,
  taoPhieu: true,
  suaPhieu: true,
};

function canhBao(sua: Partial<CanhBaoDangMo> = {}): CanhBaoDangMo {
  return {
    id: 1,
    mucDo: "red",
    trangThai: "raised",
    tieuDe: "Andon SIM-L1-SPI",
    raisedAt: BAY_GIO - 60_000,
    machineId: 1,
    ...sua,
  };
}

describe("hanhDongChoVatThe — ★ quyền quyết định ẨN, tình huống quyết định DISABLE", () => {
  it("đủ quyền + có cảnh báo chưa ack ⇒ mọi hành động bấm được", () => {
    const ds = hanhDongChoVatThe({ quyen: QUYEN_DU, machineId: 1, canhBao: [canhBao()] });
    expect(hanhDongBamDuoc(ds).sort()).toEqual(
      ["ack", "anTam", "datUuTien", "ganKyThuat", "ghiChu", "taoPhieu"].sort(),
    );
  });

  it("★★★ KHÔNG quyền ⇒ duocPhep=false ⇒ component ẨN HẲN, không disable", () => {
    // Một nút xám vẫn nói "chức năng này thuộc về bạn" — sai với người KHÔNG BAO
    // GIỜ có quyền.
    const ds = hanhDongChoVatThe({ quyen: QUYEN_RONG, machineId: 1, canhBao: [canhBao()] });
    expect(ds.every((h) => !h.duocPhep)).toBe(true);
    expect(hanhDongBamDuoc(ds)).toEqual([]);
  });

  it("★ ba cổng quyền ĐỘC LẬP — đo đúng topo của 4 tài khoản thật", () => {
    // operator1(48): CÓ andon/canEdit, KHÔNG machine_status/canCreate.
    const operator = hanhDongChoVatThe({
      quyen: { ackAlarm: true, anTamAlarm: false, taoPhieu: false, suaPhieu: false },
      machineId: 1,
      canhBao: [canhBao()],
    });
    expect(hanhDongBamDuoc(operator).sort()).toEqual(["ack", "ghiChu"]);

    // engineer1(51): CÓ machine_status/canCreate ⇒ tạo phiếu được.
    const engineer = hanhDongChoVatThe({
      quyen: { ackAlarm: true, anTamAlarm: true, taoPhieu: true, suaPhieu: true },
      machineId: 1,
      canhBao: [],
    });
    // Không có cảnh báo ⇒ ack bị chặn, nhưng TẠO PHIẾU vẫn bấm được (bảo trì
    // phòng ngừa là ca dùng chính đáng, không cần alarm).
    expect(hanhDongBamDuoc(engineer).sort()).toEqual(["datUuTien", "ganKyThuat", "taoPhieu"]);
  });

  it("★ chưa chọn máy ⇒ mọi hành động bị chặn với lý do 'chua_chon_may'", () => {
    const ds = hanhDongChoVatThe({ quyen: QUYEN_DU, machineId: null, canhBao: [] });
    expect(hanhDongBamDuoc(ds)).toEqual([]);
    expect(ds.every((h) => h.lyDoChan === "chua_chon_may")).toBe(true);
  });

  it("★ cảnh báo ĐÃ ack ⇒ nút ack bị chặn 'da_ack', nhưng ẨN TẠM vẫn được (ISA-18.2)", () => {
    // shelve KHÁC acknowledge — một alarm đã ack vẫn có thể cần ẩn tạm.
    const ds = hanhDongChoVatThe({
      quyen: QUYEN_DU,
      machineId: 1,
      canhBao: [canhBao({ trangThai: "acknowledged" })],
    });
    expect(ds.find((h) => h.ma === "ack")?.lyDoChan).toBe("da_ack");
    expect(ds.find((h) => h.ma === "anTam")?.lyDoChan).toBeNull();
  });

  it("không có cảnh báo nào ⇒ nhóm canhBao bị chặn 'khong_co_canh_bao'", () => {
    const ds = hanhDongChoVatThe({ quyen: QUYEN_DU, machineId: 1, canhBao: [] });
    for (const ma of ["ack", "anTam", "ghiChu"] as const) {
      expect(ds.find((h) => h.ma === ma)?.lyDoChan).toBe("khong_co_canh_bao");
    }
  });

  it("★ CHIỀU NGƯỢC — có nhiều cảnh báo, chỉ MỘT chưa ack thì ack vẫn mở", () => {
    const ds = hanhDongChoVatThe({
      quyen: QUYEN_DU,
      machineId: 1,
      canhBao: [canhBao({ id: 1, trangThai: "acknowledged" }), canhBao({ id: 2, trangThai: "raised" })],
    });
    expect(ds.find((h) => h.ma === "ack")?.lyDoChan).toBeNull();
  });
});

describe("hanAnTam — ★ ẩn tạm CÓ HẠN (ISA-18.2)", () => {
  it("mốc hợp lệ cho ra thời điểm bung đúng", () => {
    expect(hanAnTam(1, BAY_GIO)).toBe(BAY_GIO + 3_600_000);
    expect(hanAnTam(24, BAY_GIO)).toBe(BAY_GIO + 24 * 3_600_000);
  });

  it("★★★ số giờ KHÔNG hợp lệ ⇒ null, KHÔNG kẹp về trần", () => {
    // Kẹp âm thầm biến một lượt nhập sai thành lượt shelve HỢP LỆ mà người dùng
    // không hề định, và vết kiểm toán ghi một con số không ai gõ.
    expect(hanAnTam(0, BAY_GIO)).toBeNull();
    expect(hanAnTam(-5, BAY_GIO)).toBeNull();
    expect(hanAnTam(9999, BAY_GIO)).toBeNull();
    expect(hanAnTam(NaN, BAY_GIO)).toBeNull();
    expect(hanAnTam(Infinity, BAY_GIO)).toBeNull();
  });

  it("mọi mốc cho sẵn đều nằm trong trần — không mốc nào là suppress đội lốt shelve", () => {
    for (const gio of MOC_AN_TAM_GIO) {
      expect(gio).toBeGreaterThan(0);
      expect(gio).toBeLessThanOrEqual(TRAN_AN_TAM_GIO);
      expect(hanAnTam(gio, BAY_GIO)).not.toBeNull();
    }
  });

  it("dangAnTam khớp ngữ nghĩa `isShelvedNow` của server (shelvedUntil > now)", () => {
    expect(dangAnTam(BAY_GIO + 1, BAY_GIO)).toBe(true);
    expect(dangAnTam(BAY_GIO, BAY_GIO)).toBe(false); // đã hết hạn đúng lúc
    expect(dangAnTam(BAY_GIO - 1, BAY_GIO)).toBe(false);
    expect(dangAnTam(null, BAY_GIO)).toBe(false);
    expect(dangAnTam(undefined, BAY_GIO)).toBe(false);
  });
});

describe("nutDieuHuongCho — §9.3", () => {
  const MOI_LOAI: LoaiDich[] = ["machine", "station", "line", "workshop", "factory"];

  it("★★★ BÁNH CÓC — MỌI tên module quyền phải TỒN TẠI trong PERMISSION_MODULES", () => {
    // Một tên sai không ném lỗi: `hasPermission` chỉ trả false, nên nút lặng lẽ
    // biến mất với mọi người dùng không-admin. Đây là phép đo duy nhất bắt được.
    for (const loai of MOI_LOAI) {
      for (const nut of nutDieuHuongCho(loai, 1)) {
        expect(
          isValidPermissionModule(nut.quyen),
          `module quyền "${nut.quyen}" (nút ${nut.khoaNhan}, loại ${loai}) KHÔNG tồn tại`,
        ).toBe(true);
      }
    }
    expect(isValidPermissionModule(nutSuaBoTri().quyen)).toBe(true);
  });

  it("★ CHIỀU NGƯỢC — bánh cóc trên biết KÊU trên một tên bịa", () => {
    // Nếu `isValidPermissionModule` luôn trả true thì bài kiểm trên vô dụng.
    expect(isValidPermissionModule("traceability")).toBe(false);
    expect(isValidPermissionModule("production_view")).toBe(false);
  });

  it("mọi loại vật thể đều có ít nhất một nút — không loại nào là ngõ cụt", () => {
    for (const loai of MOI_LOAI) {
      expect(nutDieuHuongCho(loai, 42).length).toBeGreaterThan(0);
    }
  });

  it("★ href MANG THEO ĐÚNG id — chỗ dễ quên nhất của bảng điều hướng", () => {
    expect(nutDieuHuongCho("machine", 42).find((n) => n.href.startsWith("/machine/"))?.href).toBe("/machine/42");
    expect(nutDieuHuongCho("machine", 42).find((n) => n.href.startsWith("/history"))?.href).toBe(
      "/history?machineId=42",
    );
    expect(nutDieuHuongCho("line", 3).find((n) => n.href.startsWith("/wip"))?.href).toBe(
      "/wip-dashboard?lineId=3",
    );
    expect(nutDieuHuongCho("station", 5)[0].href).toBe("/station-analysis/5");
    expect(nutDieuHuongCho("factory", 4)[0].href).toBe("/corporate-dashboard?factoryId=4");
  });

  it("★ /machine-health là REDIRECT ⇒ nút trỏ THẲNG tới đích, không nhảy hai lần", () => {
    const nut = nutDieuHuongCho("machine", 1).find((n) => n.khoaNhan.endsWith("sucKhoeMay"));
    expect(nut?.href).toBe("/device-monitor?tab=health");
  });

  it("mọi href bắt đầu bằng '/' — không có href tương đối lọt vào", () => {
    for (const loai of MOI_LOAI) {
      for (const nut of nutDieuHuongCho(loai, 1)) {
        expect(nut.href.startsWith("/")).toBe(true);
      }
    }
  });
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/* ★★★ T-4 — DANH SÁCH GÁN KHÔNG ĐƯỢC CHỨA TÀI KHOẢN ĐÃ VÔ HIỆU HOÁ           */
/* ═══════════════════════════════════════════════════════════════════════════ */

describe("nguoiGanDuoc — §9.2 lọc tài khoản đã vô hiệu hoá", () => {
  it("★ loại tài khoản `isActive: false` — phiếu gán cho người đã nghỉ là phiếu KHÔNG AI NHẬN", () => {
    const ra = nguoiGanDuoc([
      { id: 1, name: "Còn làm", isActive: true },
      { id: 2, name: "Đã nghỉ", isActive: false },
      { id: 3, name: "Còn làm 2", isActive: true },
    ]);
    expect(ra.map((u) => u.id)).toEqual([1, 3]);
  });

  it("★ `isActive` VẮNG MẶT ⇒ GIỮ — undefined là 'không trả về', không phải 'đã tắt'", () => {
    // Suy ngược lại sẽ làm dropdown rỗng sạch khi hợp đồng server đổi hình, và
    // rỗng-vì-đọc-nhầm trông y hệt rỗng-vì-không-có-ai.
    expect(nguoiGanDuoc([{ id: 1, name: "A" }]).map((u) => u.id)).toEqual([1]);
    expect(nguoiGanDuoc([{ id: 1, name: "A", isActive: null }]).map((u) => u.id)).toEqual([1]);
  });

  it("null / undefined / rỗng ⇒ mảng rỗng, không ném", () => {
    expect(nguoiGanDuoc(null)).toEqual([]);
    expect(nguoiGanDuoc(undefined)).toEqual([]);
    expect(nguoiGanDuoc([])).toEqual([]);
  });

  it("★ MỌI người đều bị vô hiệu hoá ⇒ rỗng, KHÔNG rơi về 'hiện hết'", () => {
    // Ca đối chứng: một bản vá cẩu thả kiểu "lọc, nhưng nếu rỗng thì trả nguyên
    // danh sách" sẽ xanh ở test đầu mà vẫn hiện người đã nghỉ đúng lúc quan trọng.
    expect(nguoiGanDuoc([
      { id: 1, name: "Nghỉ 1", isActive: false },
      { id: 2, name: "Nghỉ 2", isActive: false },
    ])).toEqual([]);
  });

  it("giữ nguyên thứ tự và giữ nguyên các ô khác của bản ghi", () => {
    const ra = nguoiGanDuoc([
      { id: 9, name: "Chín", username: "u9", isActive: true },
      { id: 2, name: "Hai", username: "u2", isActive: true },
    ]);
    expect(ra).toEqual([
      { id: 9, name: "Chín", username: "u9", isActive: true },
      { id: 2, name: "Hai", username: "u2", isActive: true },
    ]);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/* ★★★ §11 #60 (Đợt 8 lô D) — `docStatsAoi`: BA TRẠNG THÁI, KHÔNG PHẢI HAI     */
/* ═══════════════════════════════════════════════════════════════════════════ */

describe("★★★ #60 `docStatsAoi` — 'chưa đo được' ≠ 'đo được 0' ≠ '0 %'", () => {
  /** Hàng như `dashboard.getMachineStats` thật trả về. */
  const HANG_THAT = {
    total: 1200, ok: 1150, ng: 40, ntf: 10,
    yieldRate: 96.67, fpy: 94.5, firstPass: 1134, firstTotal: 1200,
  };

  it("★★★ CA DƯƠNG — hàng THẬT khác rỗng ⇒ số đi qua nguyên vẹn (G5)", () => {
    // ★ G5: một ca chỉ đo tập rỗng sẽ xanh y hệt khi hàm bị moi ruột.
    const s = docStatsAoi(HANG_THAT, true);
    expect(s.total).toBe(1200);
    expect(s.ok).toBe(1150);
    expect(s.ng).toBe(40);
    expect(s.ntf).toBe(10);
    expect(s.yieldRate).toBe(96.67);
    expect(s.fpy).toBe(94.5);
    expect(s.mauRong).toBe(false);
  });

  it("★★★ CHƯA ĐO ĐƯỢC (đang tải / 403) ⇒ MỌI ô `null`, KHÔNG một ô nào là 0", () => {
    for (const [ten, hang, daDo] of [
      ["đang tải", undefined, false],
      ["lỗi/403", undefined, true],
      ["null", null, true],
      ["có dữ liệu nhưng chưa success", HANG_THAT, false],
    ] as const) {
      const s = docStatsAoi(hang, daDo);
      expect(s, `${ten}: total`).toHaveProperty("total", null);
      expect(s.ok, `${ten}: ok`).toBeNull();
      expect(s.ng, `${ten}: ng`).toBeNull();
      expect(s.ntf, `${ten}: ntf`).toBeNull();
      expect(s.yieldRate, `${ten}: yield`).toBeNull();
      expect(s.mauRong, `${ten}: mauRong`).toBe(false);
    }
  });

  it("★★★ ĐO ĐƯỢC MẪU RỖNG ⇒ đếm là 0 THẬT, nhưng tỉ lệ là `null` (0/0 ≠ 0 %)", () => {
    // Đây là ca mà một bản cài đặt ngây thơ sẽ in "Yield 0 %" — người vận hành
    // đọc thành "máy đang hỏng nặng" trong khi sự thật là "chưa kiểm chiếc nào".
    const s = docStatsAoi({ total: 0, ok: 0, ng: 0, ntf: 0, yieldRate: 0, fpy: 0 }, true);
    expect(s.total).toBe(0);
    expect(s.ok).toBe(0);
    expect(s.ng).toBe(0);
    expect(s.mauRong).toBe(true);
    expect(s.yieldRate).toBeNull();
    expect(s.fpy).toBeNull();
  });

  it("★★★ HAI CA NÀY PHẢI PHÂN BIỆT ĐƯỢC — nếu bằng nhau thì #60 chở 0 bit", () => {
    const chuaDo = docStatsAoi(undefined, false);
    const mauRong = docStatsAoi({ total: 0, ok: 0, ng: 0, ntf: 0, yieldRate: 0 }, true);
    expect(chuaDo.total).not.toBe(mauRong.total); // null vs 0
    expect(chuaDo.mauRong).not.toBe(mauRong.mauRong);
  });

  it("★★★ HỢP ĐỒNG HỎNG HÌNH (thiếu `total`) ⇒ coi là CHƯA ĐO, không coi là 0", () => {
    // `undefined` qua `Number()` ra `NaN`, và `NaN` hiển thị ra màn hình như một
    // con số thật. Ca này chặn đúng đường đó.
    const s = docStatsAoi({ ok: 5, ng: 1 } as never, true);
    expect(s.total).toBeNull();
    expect(s.ok).toBeNull();
    expect(Number.isNaN(s.total as unknown as number)).toBe(false);
  });

  it("★★★ KHÔNG TỰ TÍNH LẠI `yieldRate` — server là nguồn sự thật DUY NHẤT (G12)", () => {
    // Server dùng `finalYield({ok, ntf, total})` với NTF tính là PASS (quyết
    // định #4). Nếu client tự tính `ok/total` thì hàng này ra 50, không phải 75.
    const s = docStatsAoi({ total: 100, ok: 50, ng: 25, ntf: 25, yieldRate: 75 }, true);
    expect(s.yieldRate).toBe(75);
    expect(s.yieldRate).not.toBe(50);
  });

  it("★ giá trị KHÔNG HỮU HẠN (NaN/Infinity) rơi về `null`, không lọt ra UI", () => {
    const s = docStatsAoi({ total: 10, ok: NaN, ng: Infinity, ntf: 3, yieldRate: NaN }, true);
    expect(s.ok).toBe(0); // `null ?? 0` — đếm hỏng về 0, hợp lý cho một BỘ ĐẾM
    expect(s.ng).toBe(0);
    expect(s.ntf).toBe(3);
    expect(s.yieldRate).toBeNull(); // nhưng TỈ LỆ hỏng thì `null`, không 0 %
  });
});
