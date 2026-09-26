/**
 * Lưới MODULE cho `manMay.ts` — **một nửa** của phép đo (G93).
 *
 * Nửa này chứng minh *"hàm đúng khi được gọi đúng"*. Nó **KHÔNG** chứng minh
 * trang gọi bằng đối số nào — đó là việc của `manMayNoiVaoTrang.unit.test.ts`.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import * as manMay from "./manMay";
import {
  HE_SO_NOI_KHUNG_MAY,
  idMayTuDuongDan,
  khungNhinMay,
  lineCuaMayTheoTram,
  lyDoMoManMay,
  cauChoLyDoManMay,
  mayHangXom,
  mucTieuTrongCanh,
  phamViCuaManMay,
  tomTatMay,
} from "./manMay";
import { idLineTuDuongDan } from "./manLine";
import { trongPhamVi, HE_SO_CAO, HE_SO_LUI, KHOANG_CACH_TOI_DA_CAP_MAY } from "./phamViCanh";
import { HAN_KHAI_SUC_KHOE_MS, type KhaiSucKhoe } from "./sucKhoeMay";
import { cauChoLyDoNgan, lyDoNganNhung } from "./nhungTaiCho";
import { HO_NHAN_MAY, neoTrenNoc } from "./hopNhatCanh";

/* ══════════════════════════════════════════════════════════════════════════ */
/* Mẫu dùng chung                                                              */
/* ══════════════════════════════════════════════════════════════════════════ */

const TRAM = [
  { id: 21, lineId: 2, thuTu: 1, ma: "S21", ten: "Trạm 1" },
  { id: 22, lineId: 2, thuTu: 2, ma: "S22", ten: "Trạm 2" },
  { id: 31, lineId: 3, thuTu: 1, ma: "S31", ten: "Trạm chuyền 3" },
];

const MAY = [
  { id: 7, stationId: 21, lineId: 2 },
  { id: 8, stationId: 22, lineId: 2 },
  { id: 9, stationId: 31, lineId: 3 },
  // Không trạm, không chuyền — máy "mồ côi".
  { id: 10, stationId: null, lineId: null },
  // Chưa gán trạm nhưng ĐÃ khai chuyền 2.
  { id: 11, stationId: null, lineId: 2 },
  // MÂU THUẪN: khai chuyền 2 nhưng trạm 31 thuộc chuyền 3 ⇒ TRẠM thắng.
  { id: 12, stationId: 31, lineId: 2 },
];

/* ══════════════════════════════════════════════════════════════════════════ */
/* ① `idMayTuDuongDan` — CÙNG LUẬT với chuyền, MỘT cài đặt                     */
/* ══════════════════════════════════════════════════════════════════════════ */

describe("★★★ ① idMayTuDuongDan — uỷ thác `idLineTuDuongDan`, không chép lại (G12)", () => {
  const MAU = ["7", "11", "abc", "", "0x2", "2e3", "2.5", "+2", "0", "-2", " 7 ", undefined, null];

  it("★★★ đối chiếu TỪNG mẫu với `idLineTuDuongDan` — ai tách hai hàm ra sẽ ĐỎ ở đây", () => {
    for (const m of MAU) {
      expect(idMayTuDuongDan(m), `mẫu ${JSON.stringify(m)}`).toBe(idLineTuDuongDan(m));
    }
  });

  it("số nguyên dương ⇒ số; rác ⇒ `null` (KHÔNG `NaN`, G37)", () => {
    expect(idMayTuDuongDan("7")).toBe(7);
    expect(idMayTuDuongDan(" 7 ")).toBe(7);
    expect(idMayTuDuongDan("abc")).toBeNull();
    expect(idMayTuDuongDan("0x2")).toBeNull();
    expect(idMayTuDuongDan("0")).toBeNull();
    expect(idMayTuDuongDan(undefined)).toBeNull();
  });

  it("★ ĐỐI CHỨNG — bộ đo BIẾT KÊU: không phải mọi thứ đều `null`", () => {
    expect(idMayTuDuongDan("114")).toBe(114);
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */
/* ② `phamViCuaManMay` — khớp nối `trongPhamVi`, đo bằng GIÁ TRỊ                */
/* ══════════════════════════════════════════════════════════════════════════ */

describe("★★★ ② phamViCuaManMay — máy ĐÍCH trong, HÀNG XÓM ngoài (pha 72 %)", () => {
  /** Máy đích 7 và hàng xóm 8: CÙNG chuyền 2, CÙNG tầng 28 (tầng duy nhất của CSDL). */
  const dich = { machineId: 7, stationId: 21, lineId: 2, workshopId: null, factoryId: 1, tangId: 28 };
  const hangXom = { ...dich, machineId: 8, stationId: 22 };

  it("máy đích ⇒ trong phạm vi; hàng xóm cùng chuyền ⇒ NGOÀI", () => {
    expect(trongPhamVi(dich, phamViCuaManMay(7))).toBe(true);
    expect(trongPhamVi(hangXom, phamViCuaManMay(7))).toBe(false);
  });

  it("★★★ ĐỘT BIẾN ① `cap:'may'` → `cap:'line'` làm hàng xóm thành TRONG — máy đích hết nổi bật, câm", () => {
    expect(trongPhamVi(hangXom, { cap: "line", id: 2 })).toBe(true); // ← sai, và câm
    expect(trongPhamVi(hangXom, phamViCuaManMay(7))).toBe(false); // ← đúng
  });

  it("★★★ ĐỘT BIẾN ② `id: machineId` → `id: null` ⇒ `trongPhamVi` TRUE vô điều kiện", () => {
    expect(trongPhamVi(hangXom, { cap: "may", id: null })).toBe(true); // ← sai
    expect(trongPhamVi(hangXom, phamViCuaManMay(7))).toBe(false); // ← đúng
  });

  it("★ ĐỐI CHỨNG — không trả hằng: id đi theo tham số", () => {
    expect(phamViCuaManMay(7)).toEqual({ cap: "may", id: 7 });
    expect(phamViCuaManMay(114)).toEqual({ cap: "may", id: 114 });
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */
/* ③ `lineCuaMayTheoTram` — TRẠM thắng `lineId` khai                            */
/* ══════════════════════════════════════════════════════════════════════════ */

describe("★★★ ③ lineCuaMayTheoTram — trạm có khoá ngoại thắng giá trị đã suy", () => {
  it("qua trạm ⇒ chuyền của trạm", () => {
    expect(lineCuaMayTheoTram(7, MAY, TRAM)).toBe(2);
    expect(lineCuaMayTheoTram(9, MAY, TRAM)).toBe(3);
  });

  it("★★★ MÂU THUẪN ⇒ trạm thắng: máy 12 khai chuyền 2, trạm 31 nói chuyền 3", () => {
    expect(lineCuaMayTheoTram(12, MAY, TRAM)).toBe(3);
  });

  it("★ chưa gán trạm mà khai chuyền ⇒ VẪN có chuyền (không khai thiếu đường ra)", () => {
    expect(lineCuaMayTheoTram(11, MAY, TRAM)).toBe(2);
  });

  it("mồ côi / không tìm thấy ⇒ `null`", () => {
    expect(lineCuaMayTheoTram(10, MAY, TRAM)).toBeNull();
    expect(lineCuaMayTheoTram(99, MAY, TRAM)).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */
/* ④ `mayHangXom` — máy đích + cùng chuyền, KHÔNG cả nhà máy, KHÔNG một mình     */
/* ══════════════════════════════════════════════════════════════════════════ */

describe("★★★ ④ mayHangXom — định vị bằng hàng xóm, không bằng cả nhà máy (F2)", () => {
  const ids = (xs: { id: number }[]) => xs.map((m) => m.id).sort((a, b) => a - b);

  it("máy đích + mọi máy cùng chuyền (kể cả máy chưa gán trạm nhưng khai đúng chuyền)", () => {
    expect(ids(mayHangXom(7, MAY, TRAM))).toEqual([7, 8, 11]);
  });

  it("★★★ KHÔNG lọt máy chuyền khác — 9 và 12 (trạm 31) không được đứng cạnh máy 7", () => {
    const kq = ids(mayHangXom(7, MAY, TRAM));
    expect(kq).not.toContain(9);
    expect(kq).not.toContain(12);
    expect(kq).not.toContain(10);
  });

  it("★★★ máy đích LUÔN có mặt — máy mồ côi 10 ra `[10]`, không ra `[]`", () => {
    /*
     * ★ `mayCuaLine(null, …)` trả `[]`. Tin nó thì máy đích biến mất khỏi chính
     *   màn của nó — một màn Máy không có máy, không lỗi nào nổ.
     */
    expect(ids(mayHangXom(10, MAY, TRAM))).toEqual([10]);
  });

  it("máy mâu thuẫn 12 ⇒ hàng xóm theo TRẠM (chuyền 3): [9, 12]", () => {
    expect(ids(mayHangXom(12, MAY, TRAM))).toEqual([9, 12]);
  });

  it("★★★ máy đích KHÔNG có trong tập ⇒ `[]` — trang rẽ nhánh L-5, không vẽ hàng xóm của một máy không tồn tại", () => {
    expect(mayHangXom(99, MAY, TRAM)).toEqual([]);
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */
/* ⑤ `mucTieuTrongCanh`                                                         */
/* ══════════════════════════════════════════════════════════════════════════ */

describe("⑤ mucTieuTrongCanh — khối đã dựng của máy đích, hoặc `null` khi chưa đặt chỗ", () => {
  const mayVe = [{ machineId: 7 }, { machineId: 8 }];
  it("tìm thấy ⇒ chính khối ấy; không ⇒ `null`", () => {
    expect(mucTieuTrongCanh(mayVe, 8)).toBe(mayVe[1]);
    expect(mucTieuTrongCanh(mayVe, 99)).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */
/* ⑥ `khungNhinMay` — camera GẦN, và Z KHÔNG PHẢI ĐỘ CAO                         */
/* ══════════════════════════════════════════════════════════════════════════ */

describe("★★★ ⑥ khungNhinMay — orbit ≤ 8 m quanh MỘT máy, `y` là độ cao", () => {
  const khoi = {
    machineId: 7,
    viTri: { x: 3, y: 0, z: 5 },
    kichThuocMm: { rongMm: 1200, caoMm: 1800, sauMm: 800 },
  };

  it("`null` ⇒ `null` — máy chưa đặt chỗ thì GIỮ camera, không bay tới Infinity (G8)", () => {
    expect(khungNhinMay(null)).toBeNull();
  });

  it("★★★ mục nhìn = TÂM khối: x/z là tâm đáy, **y = nửa chiều cao** (bẫy hoán vị trục)", () => {
    const k = khungNhinMay(khoi)!;
    expect(k).not.toBeNull();
    expect(k.muc[0]).toBeCloseTo(3, 6);
    expect(k.muc[2]).toBeCloseTo(5, 6);
    /*
     * ★★★ Nếu ai đó "sửa" thành `{ x, y: viTri.z, z: viTri.y }`, mục nhìn rơi
     *   xuống `y = 5 + 0.9` hoặc `0.9` ở trục sai — camera nhìn vào một điểm
     *   dưới sàn hoặc bên cạnh, cảnh vẫn vẽ, không gì nổ. Ca này là chỗ nó KÊU.
     */
    expect(k.muc[1]).toBeCloseTo(0.9, 6);
  });

  it("camera ĐỨNG TRÊN mục nhìn và cách mục nhìn dưới trần 8 m theo từng trục", () => {
    const k = khungNhinMay(khoi)!;
    expect(k.viTri[1]).toBeGreaterThan(k.muc[1]);
    for (let i = 0; i < 3; i += 1) {
      expect(Math.abs(k.viTri[i] - k.muc[i])).toBeLessThanOrEqual(KHOANG_CACH_TOI_DA_CAP_MAY);
    }
  });

  it("★ máy KHỔNG LỒ (20 m) vẫn bị trần 8 m kẹp — không lùi ra xa như cấp Line", () => {
    const to = { ...khoi, kichThuocMm: { rongMm: 20_000, caoMm: 20_000, sauMm: 20_000 } };
    const k = khungNhinMay(to)!;
    for (let i = 0; i < 3; i += 1) {
      expect(Math.abs(k.viTri[i] - k.muc[i])).toBeLessThanOrEqual(KHOANG_CACH_TOI_DA_CAP_MAY + 1e-9);
    }
  });

  /* ── Nón FOV: cả máy LẪN nhãn nóc phải lọt khung — lỗi ẢNH bắt được ──── */

  /** FOV DỌC của `KhungCanh` (độ). Ghim bằng văn bản ở ca cuối, không đoán. */
  const FOV_DOC = 45;
  const goc = (k: { viTri: number[]; muc: number[] }, p: number[]) => {
    const v = [k.muc[0] - k.viTri[0], k.muc[1] - k.viTri[1], k.muc[2] - k.viTri[2]];
    const w = [p[0] - k.viTri[0], p[1] - k.viTri[1], p[2] - k.viTri[2]];
    const dot = v[0] * w[0] + v[1] * w[1] + v[2] * w[2];
    const nv = Math.hypot(...v);
    const nw = Math.hypot(...w);
    return (Math.acos(dot / (nv * nw)) * 180) / Math.PI;
  };
  const dinhKhoi = (() => {
    const { x, y, z } = khoi.viTri;
    const r = khoi.kichThuocMm.rongMm / 2000;
    const c = khoi.kichThuocMm.caoMm / 1000;
    const s = khoi.kichThuocMm.sauMm / 2000;
    const ds: number[][] = [];
    for (const dx of [-r, r]) for (const dy of [0, c]) for (const dz of [-s, s]) ds.push([x + dx, y + dy, z + dz]);
    return ds;
  })();
  const nhanNoc = (() => {
    const n = neoTrenNoc({ machineId: 7, viTri: khoi.viTri, kichThuocMm: { caoMm: khoi.kichThuocMm.caoMm } }, HO_NHAN_MAY);
    return [n.x, n.y, n.z];
  })();

  it("★★★ 8 đỉnh khối + điểm nhãn nóc đều lệch trục nhìn < 22,5° — cả máy lẫn tên lọt nón FOV 45°", () => {
    const k = khungNhinMay(khoi)!;
    for (const d of dinhKhoi) expect(goc(k, d), `đỉnh ${d.join(",")}`).toBeLessThan(FOV_DOC / 2);
    expect(goc(k, nhanNoc), "nhãn trên nóc").toBeLessThan(FOV_DOC / 2);
  });

  it("★★★ ĐỐI CHỨNG — hệ số 1 (bản đầu) đẩy nhãn nóc RA NGOÀI nón: chính lỗi ảnh nghiệm thu bắt được", () => {
    /*
     * 2026-09-09, `dist`, 1600×900, máy 14: khối bị cắt nóc, `LopNhan` ẩn nhãn tên,
     * chip "1 more names hidden" hiện — màn mất 1/3 thứ neo của §15.6.1.
     */
    const k1 = khungNhinMay(khoi, 1)!;
    expect(goc(k1, nhanNoc)).toBeGreaterThan(FOV_DOC / 2);
  });

  it("★ cấp `may` THẬT (`HE_SO_LUI.may`/`HE_SO_CAO.may`), không phải `line` — đo bằng giá trị", () => {
    /*
     * Sau khi thêm bước lùi + kẹp 8 m, đột biến `khungNhinCho(bbox, "line")` không
     * còn bị ca "máy khổng lồ" bắt (kẹp che mất). Ca này đo TỈ LỆ lùi/cao ở hệ số 1.
     */
    const k1 = khungNhinMay(khoi, 1)!;
    expect(k1.viTri[1] - k1.muc[1]).toBeCloseTo(k1.banKinh * HE_SO_CAO.may, 9);
    expect(k1.viTri[0] - k1.muc[0]).toBeCloseTo(k1.banKinh * HE_SO_LUI.may, 9);
    expect(HE_SO_CAO.may).not.toBe(HE_SO_CAO.line);
  });

  it("★ lùi thêm KHÔNG đổi mục nhìn và KHÔNG đổi hướng — chỉ đổi khoảng cách", () => {
    const k1 = khungNhinMay(khoi, 1)!;
    const k = khungNhinMay(khoi)!;
    expect(k.muc).toEqual(k1.muc);
    for (let i = 0; i < 3; i += 1) {
      expect(k.viTri[i] - k.muc[i]).toBeCloseTo((k1.viTri[i] - k1.muc[i]) * HE_SO_NOI_KHUNG_MAY, 9);
    }
    expect(HE_SO_NOI_KHUNG_MAY).toBeGreaterThan(1);
  });

  it("★ FOV 45 là số THẬT của `KhungCanh` — đọc văn bản, không kế thừa", () => {
    const nguon = readFileSync(resolve(__dirname, "../loi/KhungCanh.tsx"), "utf8");
    expect(nguon).toMatch(/fov = 45\b/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */
/* ⑦ `tomTatMay` — chip (B), honest-null, hạng qua `hangSucKhoe`                */
/* ══════════════════════════════════════════════════════════════════════════ */

describe("★★★ ⑦ tomTatMay — `null` KHÁC `0`, hạn 24h thắng điểm", () => {
  const BAY_GIO = 1_700_000_000_000;
  const MAY_7 = { id: 7, ma: "M-007", ten: "AOI 7", loaiMay: "AOI" };
  const khai = (k: Partial<KhaiSucKhoe>): KhaiSucKhoe => ({
    machineId: 7,
    diem: null,
    nguyCo: null,
    mucKhan: null,
    mocMs: BAY_GIO - 1000,
    ...k,
  });

  it("chưa có danh tính ⇒ `null`", () => {
    expect(tomTatMay(null, [], BAY_GIO)).toBeNull();
  });

  it("★★★ KHÔNG có lời khai ⇒ `chua_do`, `diem = null` — KHÔNG `0`", () => {
    const kq = tomTatMay(MAY_7, [], BAY_GIO)!;
    expect(kq).toMatchObject({ ma: "M-007", loaiMay: "AOI", hangSucKhoe: "chua_do", diem: null });
  });

  it("lời khai còn hạn, 31 điểm ⇒ `nguy_kich`, điểm 31", () => {
    const kq = tomTatMay(MAY_7, [khai({ diem: 31 })], BAY_GIO)!;
    expect(kq).toMatchObject({ hangSucKhoe: "nguy_kich", diem: 31 });
  });

  it("★★★ lời khai QUÁ 24 GIỜ ⇒ `het_han` — nhưng ĐIỂM vẫn giữ nguyên văn để chip nói '31 % · quá hạn'", () => {
    const kq = tomTatMay(MAY_7, [khai({ diem: 31, mocMs: BAY_GIO - HAN_KHAI_SUC_KHOE_MS - 1 })], BAY_GIO)!;
    expect(kq.hangSucKhoe).toBe("het_han");
    expect(kq.diem).toBe(31);
  });

  it("`CRITICAL` nâng lên `nguy_kich` bất kể điểm (BG-127: hai phép đo độc lập)", () => {
    const kq = tomTatMay(MAY_7, [khai({ diem: 90, mucKhan: "CRITICAL" })], BAY_GIO)!;
    expect(kq.hangSucKhoe).toBe("nguy_kich");
  });

  it("★ lời khai của MÁY KHÁC không được mượn", () => {
    const kq = tomTatMay(MAY_7, [khai({ machineId: 8, diem: 10 })], BAY_GIO)!;
    expect(kq).toMatchObject({ hangSucKhoe: "chua_do", diem: null });
  });

  it("★★★ G91 — chip KHÔNG có `ng24h`/WIP/đếm chạy-dừng: danh sách khoá ĐÓNG", () => {
    const kq = tomTatMay(MAY_7, [], BAY_GIO)!;
    expect(Object.keys(kq).sort()).toEqual(
      ["ma", "ten", "loaiMay", "hangSucKhoe", "diem", "nguyCo", "mucKhan", "mocMs"].sort(),
    );
    /*
     * ★ `NG 24h`: §15.6.1 ⁽²⁾ đo được `product_inspections` 2.880/2.880
     *   `factoryCode` NULL, và `NganXuLy` đã hiện `getMachineStats`. Một chip thứ
     *   hai là D-5. WIP/chạy-dừng là câu hỏi cấp Line, không phải cấp Máy.
     */
    expect("ng24h" in kq).toBe(false);
    expect("soWip" in kq).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */
/* ⑧ `lyDoMoManMay` — BA lý do L-5, uỷ thác, không nhánh im lặng thứ tư          */
/* ══════════════════════════════════════════════════════════════════════════ */

describe("★★★ ⑧ lyDoMoManMay — uỷ thác `lyDoNganNhung`, cùng thứ tự kiểm; Đợt 34 (D) tách `chuaGanNhaMay`", () => {
  /*
   * ★ Đợt 34 (D): ca "vắng + phạm vi RỖNG" ĐỔI kỳ vọng `thieuQuyen` → `chuaGanNhaMay`. Đo DB thật:
   *   `operator1` có quyền `machine_status` nhưng 0 hàng `user_factory_assignments` — câu "You do not
   *   have permission" là sai bản chất (họ không thiếu quyền, họ chưa được gán). Cập nhật có lý do,
   *   không "nới": tên cũ vẫn tồn tại cho ca THIẾU QUYỀN THẬT (server `FORBIDDEN`).
   */
  const ca = [
    { ten: "đang tải ⇒ mo", canh: { idTrongTam: [], phamViRong: false, dangTai: true }, mong: "mo" },
    { ten: "có trong tập ⇒ mo", canh: { idTrongTam: [7, 8], phamViRong: false }, mong: "mo" },
    { ten: "vắng + phạm vi RỖNG ⇒ chuaGanNhaMay (Đợt 34 D — trước: thieuQuyen)", canh: { idTrongTam: [], phamViRong: true }, mong: "chuaGanNhaMay" },
    { ten: "vắng + có phạm vi ⇒ ngoaiPhamVi", canh: { idTrongTam: [8], phamViRong: false }, mong: "ngoaiPhamVi" },
  ] as const;

  /** Ánh xạ tên của `lyDoNganNhung` (đường NganNhung) → tên ở màn Máy — MỘT chỗ khai, test ghim. */
  const anhXa = (ly: string | null) => (ly === "thieuQuyen" ? "chuaGanNhaMay" : (ly ?? "mo"));

  for (const c of ca) {
    it(c.ten, () => {
      expect(lyDoMoManMay(7, c.canh)).toBe(c.mong);
      // ★ Đối chiếu với nguồn luật — cùng THỨ TỰ KIỂM; chỉ khác TÊN ở ca phạm-vi-rỗng (ánh xạ trên).
      expect(lyDoMoManMay(7, c.canh)).toBe(anhXa(lyDoNganNhung({ loai: "machine", id: 7 }, c.canh)));
    });
  }

  it("★★★ chưa-gán-nhà-máy THẮNG ngoài-phạm-vi khi cả hai đúng — hai câu, hai hành động", () => {
    expect(lyDoMoManMay(7, { idTrongTam: [], phamViRong: true })).toBe("chuaGanNhaMay");
  });

  it("★★★ Đợt 34 (D) — `thieuQuyen` THẬT (server FORBIDDEN) THẮNG cả `chuaGanNhaMay` lẫn `ngoaiPhamVi`", () => {
    expect(lyDoMoManMay(7, { idTrongTam: [], phamViRong: true, thieuQuyen: true })).toBe("thieuQuyen");
    expect(lyDoMoManMay(7, { idTrongTam: [8], phamViRong: false, thieuQuyen: true })).toBe("thieuQuyen");
  });

  /*
   * ★★★ ĐỢT 40 (QA Đợt 39 Pareto #1) — ĐỔI HỢP ĐỒNG CÓ LÝ DO ĐO ĐƯỢC, không "nới": Đợt 34 ghim "thieuQuyen KHÔNG
   *   thắng `mo`" (máy có trong tập / đang tải ⇒ vẫn mở). QA Đợt 39 đo vai CHỈ `analytics_oee` + gán SIM-FAC
   *   (`.qa-dot39/qd18/D-1600x900.json`): `canhThietKe` 200 (cổng hình học `quyenDocHinhHoc`) nên máy 14 CÓ
   *   trong `idTrongTam`, `overview` 403 ⇒ `thieuQuyen: true` — và màn Máy VẼ canvas + cockpit "Machine not
   *   found" cho một lỗi 403, trong khi Line cùng vai nói `thieuQuyen` đúng (`lyDoMoManLine` xét thiếu quyền
   *   TRƯỚC). Một `FORBIDDEN` là kết cục cuối (`retry: false`), không phải "chưa biết".
   */
  it("★★★ Đợt 40 — `thieuQuyen` THẬT thắng CẢ `mo` (có trong tập / đang tải) — cùng thứ tự với `lyDoMoManLine`", () => {
    expect(lyDoMoManMay(7, { idTrongTam: [7], phamViRong: false, thieuQuyen: true })).toBe("thieuQuyen");
    expect(lyDoMoManMay(7, { idTrongTam: [], phamViRong: false, dangTai: true, thieuQuyen: true })).toBe("thieuQuyen");
    // Đối chứng: KHÔNG `thieuQuyen` thì hai ca ấy vẫn mở như trước — bản vá không chặn ai thừa.
    expect(lyDoMoManMay(7, { idTrongTam: [7], phamViRong: false, thieuQuyen: false })).toBe("mo");
    expect(lyDoMoManMay(7, { idTrongTam: [], phamViRong: false, dangTai: true })).toBe("mo");
  });

  it("★★★ Đợt 34 (D) — `cauChoLyDoManMay`: câu mới cho `chuaGanNhaMay`, ba câu cũ UỶ THÁC `cauChoLyDoNgan` (G12)", () => {
    const moi = cauChoLyDoManMay("chuaGanNhaMay");
    expect(moi.khoa).toBe("twin3d.may.chuaGanNhaMay");
    expect(moi.duPhong).toMatch(/chưa được gán nhà máy/);
    expect(moi.duPhong).not.toMatch(/quyền/); // câu này KHÔNG được nhắc chữ "quyền" — đó là cả điểm của (D)
    for (const ly of ["ngoaiPhamVi", "thieuQuyen"] as const) {
      expect(cauChoLyDoManMay(ly)).toEqual(cauChoLyDoNgan(ly));
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */
/* ⑨ ★★★ G91 — BỀ MẶT CÔNG KHAI ĐÓNG: KHÔNG WIP, KHÔNG đường tâm, KHÔNG đếm      */
/* ══════════════════════════════════════════════════════════════════════════ */

describe("★★★ ⑨ G91 — `manMay` chỉ xuất đúng 10 hàm + 4 hằng; thêm WIP/đếm ở đây là lặp G12", () => {
  it("danh sách export ĐÓNG (Đợt 34 D: +`cauChoLyDoManMay` · Đợt 35 #4: +bố cục khối cảnh ⑩)", () => {
    expect(Object.keys(manMay).sort()).toEqual(
      [
        "HE_SO_NOI_KHUNG_MAY",
        "idMayTuDuongDan",
        "phamViCuaManMay",
        "lineCuaMayTheoTram",
        "mayHangXom",
        "mucTieuTrongCanh",
        "khungNhinMay",
        "tomTatMay",
        "lyDoMoManMay",
        "cauChoLyDoManMay",
        // ⑩ Đợt 35 — chiều cao khối cảnh theo phần còn lại (bất biến cockpit > cảnh ở 720).
        "SAN_KHOI_CANH_MAY_PX",
        "TRAN_KHOI_CANH_MAY_PX",
        "TI_LE_KHOI_CANH_MAY",
        "chieuCaoKhoiCanhMay",
        // ⑪ Đợt 45 (mục 6) — sàn mềm 280 khi bố cục cho phép (QA Đợt 44: 259 @1280 "thấp").
        "SAN_MEM_KHOI_CANH_MAY_PX",
      ].sort(),
    );
  });
});
