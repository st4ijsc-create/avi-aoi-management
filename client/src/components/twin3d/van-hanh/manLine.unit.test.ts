/**
 * Lưới MODULE cho `manLine.ts` — **một nửa** của phép đo (G93).
 *
 * Nửa này chứng minh *"hàm đúng khi được gọi đúng"*. Nó **KHÔNG** chứng minh
 * trang gọi bằng đối số nào — đó là việc của `manLineNoiVaoTrang.unit.test.ts`,
 * và Đợt 29 đã đo được rằng **ba đột biến ở chỗ gọi sống sót cả 1.998 test**
 * khi chỉ có nửa này.
 */

import { describe, expect, it } from "vitest";

import {
  hangDaiLine,
  idLineTuDuongDan,
  mayCuaLine,
  tinhWipLine,
  tomTatLine,
} from "./manLine";
import { HAN_KHAI_NGHEN_MS } from "./wipTram";

/* ══════════════════════════════════════════════════════════════════════════ */
/* ① `idLineTuDuongDan`                                                        */
/* ══════════════════════════════════════════════════════════════════════════ */

describe("★★★ idLineTuDuongDan — NaN là lớp lỗi G37, phải thành `null`", () => {
  it("số nguyên dương ⇒ số", () => {
    expect(idLineTuDuongDan("2")).toBe(2);
    expect(idLineTuDuongDan("11")).toBe(11);
  });

  it("★★★ chuỗi rác ⇒ `null`, KHÔNG `NaN` — NaN cho ra chuyền RỖNG mà không lỗi nào nổ", () => {
    expect(idLineTuDuongDan("abc")).toBeNull();
    expect(idLineTuDuongDan("")).toBeNull();
    expect(idLineTuDuongDan(undefined)).toBeNull();
    expect(idLineTuDuongDan(null)).toBeNull();
  });

  it("★★★ bốn chuỗi mà `Number()` NHẬN nhưng người dùng KHÔNG gõ ⇒ `null`", () => {
    // Cả bốn đều lọt nếu chỉ kiểm `Number.isFinite(Number(s))`.
    expect(idLineTuDuongDan("0x2")).toBeNull();
    expect(idLineTuDuongDan("2e3")).toBeNull();
    expect(idLineTuDuongDan("2.5")).toBeNull();
    expect(idLineTuDuongDan("+2")).toBeNull();
  });

  it("★ 0 và số âm ⇒ `null` — `production_lines.id` là serial, nguyên DƯƠNG", () => {
    expect(idLineTuDuongDan("0")).toBeNull();
    expect(idLineTuDuongDan("-2")).toBeNull();
  });

  it("★ khoảng trắng hai đầu được cắt (URL có thể mang %20)", () => {
    expect(idLineTuDuongDan(" 2 ")).toBe(2);
  });

  it("★ ĐỐI CHỨNG — bộ đo này BIẾT KÊU: nó KHÔNG trả `null` cho mọi thứ", () => {
    expect(idLineTuDuongDan("7")).not.toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */
/* ② `mayCuaLine`                                                              */
/* ══════════════════════════════════════════════════════════════════════════ */

const TRAM_2 = [
  { id: 21, lineId: 2, thuTu: 1, ma: "S21", ten: "Trạm 1" },
  { id: 22, lineId: 2, thuTu: 2, ma: "S22", ten: "Trạm 2" },
  { id: 31, lineId: 3, thuTu: 1, ma: "S31", ten: "Trạm khác chuyền" },
];

describe("★★★ mayCuaLine — TRẠM là nguồn có khoá ngoại, `lineId` trên máy là suy ra", () => {
  it("máy qua trạm của line ⇒ nhận", () => {
    const may = [{ id: 1, stationId: 21 }, { id: 2, stationId: 22 }, { id: 3, stationId: 31 }];
    expect(mayCuaLine(2, may, TRAM_2).map((m) => m.id)).toEqual([1, 2]);
  });

  it("★★★ TRẠM THẮNG `lineId` khi hai bên MÂU THUẪN — cả hai chiều", () => {
    const may = [
      // khai thuộc line 2 nhưng trạm 31 thuộc line 3 ⇒ KHÔNG nhận
      { id: 1, stationId: 31, lineId: 2 },
      // khai thuộc line 9 nhưng trạm 21 thuộc line 2 ⇒ NHẬN
      { id: 2, stationId: 21, lineId: 9 },
    ];
    expect(mayCuaLine(2, may, TRAM_2).map((m) => m.id)).toEqual([2]);
  });

  it("★ máy CHƯA gán trạm mà khai đúng `lineId` ⇒ VẪN nhận (không khai thiếu máy)", () => {
    const may = [{ id: 5, stationId: null, lineId: 2 }];
    expect(mayCuaLine(2, may, TRAM_2).map((m) => m.id)).toEqual([5]);
  });

  it("★ máy trỏ tới trạm KHÔNG CÓ trong danh sách ⇒ rơi về `lineId` khai", () => {
    // Trạm 99 không nằm trong `TRAM_2` (chưa tải xong / khác tầng).
    const may = [{ id: 6, stationId: 99, lineId: 2 }, { id: 7, stationId: 99, lineId: 3 }];
    expect(mayCuaLine(2, may, TRAM_2).map((m) => m.id)).toEqual([6]);
  });

  it("★★★ `lineId = null` ⇒ mảng RỖNG, không phải toàn bộ máy", () => {
    const may = [{ id: 1, stationId: 21 }];
    expect(mayCuaLine(null, may, TRAM_2)).toEqual([]);
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */
/* ③ `tinhWipLine` — honest-null                                               */
/* ══════════════════════════════════════════════════════════════════════════ */

describe("★★★ tinhWipLine — `null` KHÁC `0`, và khác biệt ấy là toàn bộ vấn đề", () => {
  const tamTram = new Map([
    [21, { x: 1, z: 2 }],
    [22, { x: 3, z: 4 }],
  ]);

  it("★★★ ĐÃ ĐO + trạm vắng mặt ⇒ **0 THẬT**", () => {
    const kq = tinhWipLine({
      lineId: 2,
      tram: TRAM_2,
      tamTram,
      daDo: true,
      soTheoTram: new Map([[21, 7]]),
    });
    expect(kq.map((t) => [t.stationId, t.soWip])).toEqual([
      [21, 7],
      [22, 0],
    ]);
  });

  it("★★★ CHƯA ĐO ⇒ mọi `soWip` là `null` — kể cả trạm CÓ trong bảng số", () => {
    const kq = tinhWipLine({
      lineId: 2,
      tram: TRAM_2,
      tamTram,
      daDo: false,
      soTheoTram: new Map([[21, 7]]),
    });
    expect(kq.every((t) => t.soWip === null)).toBe(true);
  });

  it("★ toạ độ lấy từ `tamTram`; trạm chưa có ⇒ (0,0) chứ không biến mất", () => {
    const kq = tinhWipLine({
      lineId: 2,
      tram: TRAM_2,
      tamTram: new Map([[21, { x: 1, z: 2 }]]),
      daDo: true,
      soTheoTram: new Map(),
    });
    expect(kq.find((t) => t.stationId === 21)).toMatchObject({ x: 1, z: 2 });
    expect(kq.find((t) => t.stationId === 22)).toMatchObject({ x: 0, z: 0 });
  });

  it("★ chỉ trạm CỦA LINE, sắp theo `thuTu` (chiều DÒNG CHẢY, không phải thứ tự DB)", () => {
    const tram = [
      { id: 22, lineId: 2, thuTu: 9, ma: "S22", ten: "b" },
      { id: 21, lineId: 2, thuTu: 1, ma: "S21", ten: "a" },
      { id: 31, lineId: 3, thuTu: 1, ma: "S31", ten: "khác" },
    ];
    const kq = tinhWipLine({ lineId: 2, tram, tamTram, daDo: true, soTheoTram: new Map() });
    expect(kq.map((t) => t.stationId)).toEqual([21, 22]);
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */
/* ④ `hangDaiLine` — bản 2D SONG SONG, KHÔNG tính lại `nghen`                  */
/* ══════════════════════════════════════════════════════════════════════════ */

describe("★★★ hangDaiLine — §11.5: 2D và 3D KHÔNG THỂ lệch, vì cùng một nguồn", () => {
  const trangThai = new Map([
    [1, "running"],
    [2, "stopped"],
  ]);

  it("★★★ `nghen`/`hang` BÊ NGUYÊN từ `bangWip` — không có phép tính thứ hai", () => {
    const kq = hangDaiLine({
      lineId: 2,
      tram: TRAM_2,
      may: [{ id: 1, stationId: 21 }],
      trangThaiTheoMay: trangThai,
      bangWip: [
        { stationId: 21, soWip: 99, nghen: true, hang: 1 },
        { stationId: 22, soWip: 3, nghen: false, hang: 2 },
      ],
    });
    expect(kq.find((h) => h.id === 21)).toMatchObject({ nghen: true, hang: 1, soWip: 99 });
    expect(kq.find((h) => h.id === 22)).toMatchObject({ nghen: false, hang: 2, soWip: 3 });
  });

  it("★★★ trạm KHÔNG có dòng trong `bangWip` ⇒ `soWip: null`, KHÔNG `0`", () => {
    const kq = hangDaiLine({
      lineId: 2,
      tram: TRAM_2,
      may: [],
      trangThaiTheoMay: trangThai,
      bangWip: [],
    });
    expect(kq.every((h) => h.soWip === null)).toBe(true);
    // ★ `nghen` mặc định `false` (không tô đỏ khi chưa biết), `hang` là `null`.
    expect(kq.every((h) => h.nghen === false && h.hang === null)).toBe(true);
  });

  it("★ `soMay` đếm máy CỦA TRẠM; trạm không máy ⇒ 0 và trạng thái `khong_ro`", () => {
    const kq = hangDaiLine({
      lineId: 2,
      tram: TRAM_2,
      may: [
        { id: 1, stationId: 21 },
        { id: 2, stationId: 21 },
      ],
      trangThaiTheoMay: trangThai,
      bangWip: [],
    });
    expect(kq.find((h) => h.id === 21)).toMatchObject({ soMay: 2, trangThai: "running" });
    // ★★★ Trạm rỗng KHÔNG được khai `running` — "không có máy" ≠ "đang chạy".
    expect(kq.find((h) => h.id === 22)).toMatchObject({ soMay: 0, trangThai: "khong_ro" });
  });

  it("★ chỉ trạm CỦA LINE — trạm chuyền 3 không lọt vào dải chuyền 2", () => {
    const kq = hangDaiLine({
      lineId: 2,
      tram: TRAM_2,
      may: [],
      trangThaiTheoMay: trangThai,
      bangWip: [],
    });
    expect(kq.map((h) => h.id)).toEqual([21, 22]);
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */
/* ⑤ `tomTatLine` — hạn 8 giờ + tổng honest-null                               */
/* ══════════════════════════════════════════════════════════════════════════ */

describe("★★★ tomTatLine — lời khai HẾT HẠN không được bác một phép đo SỐNG", () => {
  const BAY_GIO = 1_700_000_000_000;
  const wipDayDu = [
    { stationId: 21, ma: "a", ten: "a", thuTu: 1, soWip: 4, x: 0, z: 0 },
    { stationId: 22, ma: "b", ten: "b", thuTu: 2, soWip: 6, x: 0, z: 0 },
  ];

  it("★ lời khai CÒN HẠN ⇒ nút thắt hiện", () => {
    const kq = tomTatLine([{ id: 1 }], TRAM_2, wipDayDu, {
      nghenTheoServer: 22,
      mocKhai: BAY_GIO - 1000,
      bayGio: BAY_GIO,
    });
    expect(kq.tramNghen).toBe(22);
  });

  it("★★★ lời khai QUÁ 8 GIỜ ⇒ `null` — Đợt 8 đo được bản 16 ngày tô đỏ SAI trạm", () => {
    const kq = tomTatLine([{ id: 1 }], TRAM_2, wipDayDu, {
      nghenTheoServer: 22,
      mocKhai: BAY_GIO - HAN_KHAI_NGHEN_MS - 1,
      bayGio: BAY_GIO,
    });
    expect(kq.tramNghen).toBeNull();
  });

  it("★★★ lời khai KHÔNG có dấu thời gian ⇒ `null` — không kiểm được hạn thì KHÔNG tin", () => {
    const kq = tomTatLine([{ id: 1 }], TRAM_2, wipDayDu, {
      nghenTheoServer: 22,
      mocKhai: null,
      bayGio: BAY_GIO,
    });
    expect(kq.tramNghen).toBeNull();
  });

  it("★ tổng WIP cộng đúng khi MỌI trạm đã đo", () => {
    const kq = tomTatLine([{ id: 1 }], TRAM_2, wipDayDu, {
      nghenTheoServer: null,
      mocKhai: BAY_GIO,
      bayGio: BAY_GIO,
    });
    expect(kq.tongWip).toBe(10);
  });

  it("★★★ MỘT trạm chưa đo ⇒ tổng là `null`, KHÔNG phải tổng của phần đã đo", () => {
    const kq = tomTatLine(
      [{ id: 1 }],
      TRAM_2,
      [wipDayDu[0], { ...wipDayDu[1], soWip: null }],
      { nghenTheoServer: null, mocKhai: BAY_GIO, bayGio: BAY_GIO },
    );
    // ★ Nếu ở đây ra `4` thì màn khai "chuyền có 4 chiếc" trong khi ta chỉ đo
    //   được một nửa số trạm — nhỏ hơn sự thật và KHÔNG nói ra điều đó.
    expect(kq.tongWip).toBeNull();
  });

  it("★ cỡ chuyền lấy từ độ dài mảng — không suy, không đoán", () => {
    const kq = tomTatLine([{ id: 1 }, { id: 2 }, { id: 3 }], TRAM_2, [], {
      nghenTheoServer: null,
      mocKhai: null,
      bayGio: BAY_GIO,
    });
    expect(kq).toMatchObject({ soMay: 3, soTram: 3 });
  });
});

/* ══════════════════════════════════════════════════════════════════════════ */
/* ⑥ ★★★ G91 — CÁI KHÔNG LÀM ĐƯỢC, VIẾT THÀNH TEST                            */
/* ══════════════════════════════════════════════════════════════════════════ */

describe("★★★ G91 — `manLine` KHÔNG đếm chạy/dừng: `tinhKpiNoi` làm việc đó (G12)", () => {
  it("★★★ `TomTatLine` KHÔNG có ô `chay`/`dung`/`chuaRo`", async () => {
    const kq = tomTatLine([{ id: 1 }], [], [], {
      nghenTheoServer: null,
      mocKhai: null,
      bayGio: 0,
    });
    /*
     * ★★★ VÌ SAO ĐÂY LÀ MỘT LƯỚI, KHÔNG PHẢI MỘT DÒNG CHÚ THÍCH.
     *   Bản đầu của `manLine.ts` CÓ ba ô ấy và so trạng thái bằng chuỗi
     *   `"chay"`/`"dung"` — trong khi từ vựng thật của hợp đồng là
     *   `"running"`/`"down"`/`"idle"`/`"offline"` (`kpiNoiLogic.ts:146`,
     *   `mauTrangThai.ts:73-87`). Ba ô cùng ra **0** và **không lỗi nào nổ**:
     *   màn khai "chuyền không có máy nào chạy" trên một chuyền đang chạy.
     *   Lưới này giữ cửa đóng — ai thêm lại một bản đếm thứ hai sẽ ĐỎ ngay.
     */
    expect(Object.keys(kq).sort()).toEqual(["soMay", "soTram", "tongWip", "tramNghen"].sort());
    expect("chay" in kq).toBe(false);

    // ★ Và nguồn đếm THẬT tồn tại, có thể import — không phải một lời hứa suông.
    const { tinhKpiNoi } = await import("./kpiNoiLogic");
    const kpi = tinhKpiNoi([
      { id: 1, status: "running", oeePercent: null, andonActive: false, pdmRiskHigh: false },
      { id: 2, status: "down", oeePercent: null, andonActive: false, pdmRiskHigh: false },
    ]);
    expect(kpi.o.find((o) => o.khoa === "dangChay")?.giaTri).toBe(1);
    expect(kpi.o.find((o) => o.khoa === "dungLoi")?.giaTri).toBe(1);
  });
});
