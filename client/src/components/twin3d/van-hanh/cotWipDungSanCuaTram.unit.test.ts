/**
 * cotWipDungSanCuaTram.unit.test.ts — **CỘT WIP PHẢI ĐỨNG TRÊN SÀN CỦA TRẠM, KHÔNG Ở CỐT 0.**
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ KHUYẾT TẬT — ĐO SỐNG, `/twin/line/526` (chuyền nằm trên TẦNG 3)
 * ════════════════════════════════════════════════════════════════════════════
 * `OngWip` đặt tâm trụ ở `(w.x, cao/2, w.z)` — tức **đáy ở `y = 0` tuyệt đối** — còn `CotWip`
 * thì không có trường nào cho chiều đứng để mà truyền. Hậu quả đo được bằng phép chiếu lại từ
 * chính camera của cảnh:
 *
 *   | khung | lệch DỌC | lệch trên màn (trung vị) | đứng đúng chỗ |
 *   |---|---|---|---|
 *   | 1280×720  | **16,6 m** | **111,3 px** (max 163,8) | **0/39** |
 *   | 1920×1080 | **16,6 m** | **239,7 px** (max 358,3) | **0/39** |
 *
 * Xa hơn một ô lưới, nên người vận hành đọc *"trạm này đang ùn"* từ một cây cột đứng dưới
 * **một cái máy khác**. Và nó câm hoàn toàn: không lỗi, không cảnh báo.
 *
 * ★ Chuỗi bị đứt ở BỐN chỗ, mỗi chỗ đều "hợp lệ" khi nhìn riêng:
 *     ① `dungHinhLine` suy tâm trạm từ máy nhưng viết cứng `y: 0`;
 *     ② trang bỏ `y` khi dựng `tamTram` (`{ x, z }`);
 *     ③ `TinhWip`/`CotWip` không có trường nào cho chiều đứng;
 *     ④ `OngWip` đặt đáy ở 0.
 *   Vá một chỗ là không đủ — đó là lý do tệp này kiểm CẢ BỐN, mỗi chỗ một ca.
 */
import { describe, expect, it } from "vitest";

import { dungHinhLine } from "./canhLine";
import { bboxKemCotWip, tinhWipLine } from "./manLine";
import { CAO_MOI_WIP_M, CAO_TOI_DA_M, cotWip } from "./wipTram";
import { TI_LE_CAO_COT_TREN_MAY, thangCotWipSoDo } from "./soDoLine";

const TANG_3 = 16.6;

function mayO(id: number, x: number, z: number, y = TANG_3) {
  return { machineId: id, viTri: { x, y, z } };
}

describe("① dungHinhLine — tâm trạm suy từ máy mang CAO ĐỘ của máy", () => {
  const tram = [{ id: 7, lineId: 1, thuTu: 1 }];
  const may = [mayO(101, 10, 5), mayO(102, 12, 5)];
  const thuocVe = [
    { id: 101, lineId: 1, stationId: 7 },
    { id: 102, lineId: 1, stationId: 7 },
  ];

  it("★★★ máy ở tầng 3 ⇒ tâm trạm ở tầng 3, KHÔNG ở 0", () => {
    const hl = dungHinhLine(1, tram, may, thuocVe, [], { boQuaDatCho: true })!;
    expect(hl.tram[0].tam.y).toBeCloseTo(TANG_3, 9);
  });

  it("★★★ CA NGHỊCH — máy ở cốt 0 thì tâm trạm cũng 0 (không cộng một hằng số bừa)", () => {
    const hl = dungHinhLine(1, tram, [mayO(101, 10, 5, 0)], [thuocVe[0]], [], {
      boQuaDatCho: true,
    })!;
    expect(hl.tram[0].tam.y).toBeCloseTo(0, 9);
  });

  it("★★★ CÓ đặt chỗ: MẶT BẰNG theo đặt chỗ, CAO ĐỘ theo MÁY (hai nguồn, có lý do)", () => {
    // `viTriZMm` của đặt chỗ là CHIỀU CAO và nó CHƯA cộng gốc toà nhà (nợ Task 17c),
    // nên lấy nó làm cao độ là đặt cột vào một hệ toạ độ khác với hệ của máy.
    const datCho = [
      { loaiThucThe: "station", thucTheId: 7, viTriXMm: 99_000, viTriYMm: 88_000, viTriZMm: 0 },
    ];
    const hl = dungHinhLine(1, tram, may, thuocVe, datCho)!;
    expect(hl.tram[0].tam.x).toBeCloseTo(99, 9); // mặt bằng: đặt chỗ
    expect(hl.tram[0].tam.z).toBeCloseTo(88, 9);
    expect(hl.tram[0].tam.y).toBeCloseTo(TANG_3, 9); // cao độ: MÁY
  });

  it("★ trạm KHÔNG có máy nào ⇒ vẫn dùng trọn đặt chỗ (không có gì tốt hơn để lấy)", () => {
    const datCho = [
      { loaiThucThe: "station", thucTheId: 7, viTriXMm: 99_000, viTriYMm: 88_000, viTriZMm: 3_000 },
    ];
    const hl = dungHinhLine(1, tram, [], [], datCho)!;
    expect(hl.tram[0].tam).toEqual({ x: 99, y: 3, z: 88 });
  });
});

describe("② + ③ tinhWipLine → cotWip — cao độ đi HẾT chuỗi, không rụng giữa đường", () => {
  const tram = [{ id: 7, lineId: 1, thuTu: 1, ma: "S7", ten: "Trạm 7" }];

  it("★★★ `tamTram` mang `y` ⇒ `cotWip` trả cột có đáy ở tầng 3", () => {
    const tw = tinhWipLine({
      lineId: 1,
      tram,
      tamTram: new Map([[7, { x: 10, y: TANG_3, z: 5 }]]),
      daDo: true,
      soTheoTram: new Map([[7, 12]]),
    });
    expect(tw[0].y).toBeCloseTo(TANG_3, 9);
    const cot = cotWip(tw);
    expect(cot).toHaveLength(1);
    expect(cot[0].y).toBeCloseTo(TANG_3, 9);
    expect(cot[0].cao).toBeGreaterThan(0);
  });

  it("★★★ CA NGHỊCH — `tamTram` KHÔNG có `y` ⇒ 0, giữ nguyên hành vi cũ (không ném, không NaN)", () => {
    const tw = tinhWipLine({
      lineId: 1,
      tram,
      tamTram: new Map([[7, { x: 10, z: 5 }]]),
      daDo: true,
      soTheoTram: new Map([[7, 12]]),
    });
    expect(tw[0].y).toBe(0);
    expect(cotWip(tw)[0].y).toBe(0);
  });

  it("★ `y` RÁC ⇒ 0, không để `NaN` chảy xuống ma trận vẽ (một NaN = cột biến mất, câm)", () => {
    const cot = cotWip([
      { stationId: 7, ma: "S7", ten: "T7", thuTu: 1, soWip: 5, x: 1, z: 2, y: Number.NaN },
    ]);
    expect(cot[0].y).toBe(0);
    expect(Number.isFinite(cot[0].y)).toBe(true);
  });
});

describe("④ bboxKemCotWip — hộp bao theo `y..y+cao`, không theo `0..cao`", () => {
  const bboxMay = { minX: 0, maxX: 10, minY: TANG_3, maxY: TANG_3 + 1.8, minZ: 0, maxZ: 4 };

  it("★★★ cột trên tầng 3 KHÔNG kéo hộp bao xuống cốt 0", () => {
    const hb = bboxKemCotWip(bboxMay, [{ x: 5, y: TANG_3, z: 2, cao: 3 }]);
    expect(hb.minY).toBeCloseTo(TANG_3, 9);
    expect(hb.maxY).toBeCloseTo(TANG_3 + 3, 9);
  });

  it("★★★ CA NGHỊCH — cột KHÔNG có `y` vẫn tính từ 0 (hành vi cũ, không đổi lặng lẽ)", () => {
    const hb = bboxKemCotWip(bboxMay, [{ x: 5, z: 2, cao: 3 }]);
    expect(hb.minY).toBeCloseTo(0, 9);
  });

  it("★ không cột nào ⇒ trả NGUYÊN bbox máy", () => {
    expect(bboxKemCotWip(bboxMay, [])).toEqual(bboxMay);
  });
});

describe("⑤ thangCotWipSoDo — cột WIP theo thang của THẾ GIỚI SƠ ĐỒ", () => {
  const may = (cao: number) => ({
    machineId: 1,
    khoi: "tram_chung" as const,
    kichThuocMm: { rongMm: 1200, sauMm: 800, caoMm: cao * 1000 },
    viTri: { x: 0, y: TANG_3, z: 0 },
    gocXoayRad: 0,
    mau: "#22c55e",
  });

  it("★★★ trần suy từ CHIỀU CAO MÁY, không phải hằng 6 m của bố cục dải", () => {
    const t = thangCotWipSoDo([may(1.8)]);
    expect(t.caoToiDaM).toBeCloseTo(1.8 * TI_LE_CAO_COT_TREN_MAY, 9);
    expect(t.caoToiDaM).toBeLessThan(CAO_TOI_DA_M);
  });

  it("★★★ TỈ SỐ trần/mỗi-WIP GIỮ NGUYÊN ⇒ ánh xạ chỉ đổi ĐƠN VỊ, không đổi hình dạng", () => {
    const t = thangCotWipSoDo([may(1.8)]);
    expect((t.caoToiDaM as number) / (t.caoMoiWipM as number)).toBeCloseTo(
      CAO_TOI_DA_M / CAO_MOI_WIP_M,
      9,
    );
  });

  it("★★★ CA NGHỊCH — máy CAO hơn ⇒ thang cao hơn (không phải một hằng số mới)", () => {
    const thap = thangCotWipSoDo([may(1.8)]);
    const cao = thangCotWipSoDo([may(5)]);
    expect(cao.caoToiDaM as number).toBeGreaterThan(thap.caoToiDaM as number);
  });

  it("★★★ tập RỖNG / cao độ rác ⇒ `{}` (dùng mặc định), KHÔNG trả 0", () => {
    // Thang 0 làm MỌI cột biến mất, và màn hình trông y hệt "chuyền không có WIP".
    expect(thangCotWipSoDo([])).toEqual({});
    expect(thangCotWipSoDo([may(0)])).toEqual({});
  });

  it("★★★ `cotWip` DÙNG thang được truyền — trạm nào cao hơn trạm nào KHÔNG đổi", () => {
    const tram = [
      { stationId: 1, ma: "A", ten: "A", thuTu: 1, soWip: 4, x: 0, z: 0, y: TANG_3 },
      { stationId: 2, ma: "B", ten: "B", thuTu: 2, soWip: 12, x: 1, z: 0, y: TANG_3 },
    ];
    const mac = cotWip(tram);
    const sd = cotWip(tram, undefined, thangCotWipSoDo([may(1.8)]));
    expect(sd[0].cao).toBeLessThan(mac[0].cao);
    // …và TỈ SỐ giữa hai trạm y hệt (chưa chạm trần ở cả hai thang).
    expect(sd[1].cao / sd[0].cao).toBeCloseTo(mac[1].cao / mac[0].cao, 9);
  });

  it("★ thang RÁC ⇒ rơi về mặc định, không ra cột cao 0/NaN", () => {
    const tram = [{ stationId: 1, ma: "A", ten: "A", thuTu: 1, soWip: 4, x: 0, z: 0, y: 0 }];
    for (const rac of [{ caoMoiWipM: 0 }, { caoMoiWipM: Number.NaN }, { caoToiDaM: -3 }]) {
      const c = cotWip(tram, undefined, rac);
      expect(c[0].cao).toBeCloseTo(Math.min(CAO_TOI_DA_M, 4 * CAO_MOI_WIP_M), 9);
    }
  });
});
