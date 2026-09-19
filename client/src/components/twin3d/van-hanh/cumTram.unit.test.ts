/**
 * cumTram.unit.test.ts — HÌNH HỌC CỦA BIỂU TƯỢNG CỤM TRẠM.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * KẾT CỤC ĐƯỢC CANH
 * ════════════════════════════════════════════════════════════════════════════
 * Lý do tồn tại của cả HM-1: ở `/twin` FUYU-F @1280×720 khung mặc định, **0/130** khối máy đạt
 * ngưỡng bấm WCAG 24×24 px (cạnh trung vị 3,23 × 4,74 px). Biểu tượng cụm phải đạt ngưỡng ấy
 * **theo cấu tạo** — nên ca quan trọng nhất trong tệp này là ca dựng lại đúng tư thế camera đã
 * đo trên trình duyệt thật rồi đòi mọi biểu tượng vượt ngưỡng.
 *
 * ★ Và có CA NGHỊCH cho từng luật: một bản cài "luôn phóng to hết cỡ" cũng thoả "đạt ngưỡng",
 *   nên phải có ca đòi biểu tượng KHÔNG teo dưới cỡ máy thật, và ca đòi cỡ GIẢM khi camera lại
 *   gần. Thiếu chúng thì lưới xanh cho cả một hằng số bừa.
 */
import { describe, it, expect } from "vitest";

import { NGUONG_CANH_NHO_PX, canhNhoTrenManPx, coThatToiThieuM } from "./nguongDonViVe";
import { cumThanhHopVe, demCapChongNhau, dungCumTram, gopTheoLine, type MayDeGopCum } from "./cumTram";

const CAO_CANVAS = 489;   // đo được: canvas cao 489 px ở khung nhìn 1280×720
const FOV = 45;
const may = (
  machineId: number,
  lineId: number | null,
  x: number,
  z: number,
  batThuong = false,
): MayDeGopCum => ({
  machineId, lineId, viTri: { x, y: 0, z },
  kichThuocMm: { rongMm: 1000, caoMm: 1800, sauMm: 1000 },
  batThuong,
});

describe("gộp theo line", () => {
  it("★ gom đúng khoá, và thứ tự ỔN ĐỊNH (line tăng dần, `null` xếp CUỐI)", () => {
    const ds = [may(1, 7, 0, 0), may(2, null, 5, 5), may(3, 2, 1, 1), may(4, 7, 2, 2)];
    const khoa = [...gopTheoLine(ds).keys()];
    expect(khoa).toEqual([2, 7, null]);
    expect(gopTheoLine(ds).get(7)!.map((m) => m.machineId)).toEqual([1, 4]);
  });

  it("★★★ máy CHƯA GÁN LINE gom thành MỘT cụm `null` — không rải mỗi máy một cụm, không nhét vào line nào", () => {
    const ds = [may(1, null, 0, 0), may(2, null, 90, 90), may(3, 5, 1, 1)];
    const cum = dungCumTram(ds, { x: 300, y: 120, z: 300 }, CAO_CANVAS, { fovDo: FOV });
    const roi = cum.find((c) => c.lineId === null)!;
    expect(roi.soMay).toBe(2);
    expect(cum.filter((c) => c.lineId === null)).toHaveLength(1);
    // …và sự thật bị thay được giữ lại: hai máy cách nhau 90 m ⇒ vùng thật RỘNG, nói ra chứ không giấu.
    expect(roi.thatRongM).toBeCloseTo(90, 6);
    expect(roi.thatSauM).toBeCloseTo(90, 6);
  });

  it("tập RỖNG ⇒ mảng rỗng, KHÔNG phải một cụm đại diện 0 máy", () => {
    expect(dungCumTram([], { x: 0, y: 10, z: 0 }, CAO_CANVAS)).toEqual([]);
  });
});

describe("cỡ biểu tượng — suy ngược từ ngưỡng bấm", () => {
  it("★★★ KẾT CỤC: dựng lại tư thế camera đã đo trên `/twin` ⇒ MỌI biểu tượng đạt ≥ 24 px", () => {
    // Tư thế đo được (`.qa-v2/tho-v6`): camera (361,2 · 136,0 · 350,2), canvas cao 489 px.
    const camera = { x: 361.2, y: 136.0, z: 350.2 };
    // 6 line × 20 máy, rải quanh tâm sa bàn — cùng vùng mà 176 khối thật đang nằm.
    const ds: MayDeGopCum[] = [];
    for (let l = 0; l < 6; l++)
      for (let i = 0; i < 20; i++) ds.push(may(l * 100 + i, l, 80 + l * 18, 80 + i * 4));
    const cum = dungCumTram(ds, camera, CAO_CANVAS, { fovDo: FOV });
    expect(cum).toHaveLength(6);
    for (const c of cum) {
      const px = canhNhoTrenManPx(
        { kichThuocMm: { rongMm: c.rongM * 1000, caoMm: c.caoM * 1000 }, viTri: c.viTri },
        camera, FOV, CAO_CANVAS,
      );
      expect(px).toBeGreaterThanOrEqual(NGUONG_CANH_NHO_PX - 1e-6);
    }
  });

  it("★★★ ĐỐI CHỨNG: chính tập máy ấy vẽ TỪNG MÁY thì KHÔNG máy nào đạt — đó là lý do có bậc cụm", () => {
    const camera = { x: 361.2, y: 136.0, z: 350.2 };
    const ds: MayDeGopCum[] = [];
    for (let l = 0; l < 6; l++)
      for (let i = 0; i < 20; i++) ds.push(may(l * 100 + i, l, 80 + l * 18, 80 + i * 4));
    const dat = ds.filter(
      (m) => canhNhoTrenManPx({ kichThuocMm: m.kichThuocMm, viTri: m.viTri }, camera, FOV, CAO_CANVAS) >= NGUONG_CANH_NHO_PX,
    );
    expect(dat).toHaveLength(0);
  });

  it("★★★ CA NGHỊCH — biểu tượng KHÔNG teo dưới cỡ máy thật: cụm toàn máy 30 m vẫn ≥ 30 m", () => {
    const to: MayDeGopCum[] = [0, 1, 2].map((i) => ({
      machineId: i, lineId: 1, viTri: { x: i * 2, y: 0, z: 0 },
      kichThuocMm: { rongMm: 30_000, caoMm: 30_000, sauMm: 30_000 },
    }));
    // Camera RẤT gần ⇒ ngưỡng px đòi cỡ tối thiểu rất nhỏ; vế "trung vị cỡ máy" phải thắng.
    const cum = dungCumTram(to, { x: 0, y: 5, z: 20 }, CAO_CANVAS, { fovDo: FOV });
    expect(cum[0].rongM).toBeGreaterThanOrEqual(30);
    expect(cum[0].caoM).toBeGreaterThanOrEqual(30);
  });

  it("★★★ CA NGHỊCH — camera lại GẦN thì cỡ tối thiểu GIẢM (không phải hằng số thế giới)", () => {
    const ds = [may(1, 1, 0, 0), may(2, 1, 4, 0)];
    const xa = dungCumTram(ds, { x: 0, y: 200, z: 400 }, CAO_CANVAS, { fovDo: FOV })[0];
    const gan = dungCumTram(ds, { x: 0, y: 20, z: 40 }, CAO_CANVAS, { fovDo: FOV })[0];
    expect(gan.rongM).toBeLessThan(xa.rongM);
    // …nhưng cả hai vẫn đạt ngưỡng trên màn — đó mới là bất biến, cỡ mét chỉ là phương tiện.
    for (const [c, cam] of [[xa, { x: 0, y: 200, z: 400 }], [gan, { x: 0, y: 20, z: 40 }]] as const) {
      const px = canhNhoTrenManPx(
        { kichThuocMm: { rongMm: c.rongM * 1000, caoMm: c.caoM * 1000 }, viTri: c.viTri }, cam, FOV, CAO_CANVAS,
      );
      expect(px).toBeGreaterThanOrEqual(NGUONG_CANH_NHO_PX - 1e-6);
    }
  });

  it("★ canvas cao gấp đôi ⇒ cùng ngưỡng px đòi cỡ thật NHỎ đi một nửa (phép nghịch đúng chiều)", () => {
    const a = coThatToiThieuM(24, 300, FOV, 489);
    const b = coThatToiThieuM(24, 300, FOV, 978);
    expect(b / a).toBeCloseTo(0.5, 9);
  });
});

describe("cụm mang theo đủ thông tin mà vòng 2/3 chứng minh người vận hành đang mất", () => {
  it("★★★ đếm ĐÚNG số máy và số máy bất thường, và KHÔNG mất máy nào", () => {
    const ds = [
      may(1, 3, 0, 0, true), may(2, 3, 2, 0), may(3, 3, 4, 0, true),
      may(4, 9, 40, 40), may(5, 9, 42, 40, true),
    ];
    const cum = dungCumTram(ds, { x: 200, y: 80, z: 200 }, CAO_CANVAS, { fovDo: FOV });
    const tongMay = cum.reduce((s, c) => s + c.soMay, 0);
    const tongBt = cum.reduce((s, c) => s + c.soBatThuong, 0);
    expect(tongMay).toBe(5);                       // ← bất biến "không mất máy nào"
    expect(tongBt).toBe(3);
    expect(cum.find((c) => c.lineId === 3)!.soBatThuong).toBe(2);
    expect(cum.find((c) => c.lineId === 9)!.soBatThuong).toBe(1);
    // machineIds phải là HỢP RỜI và phủ hết — để bấm vào cụm còn biết mở cái gì.
    const hop = cum.flatMap((c) => c.machineIds).sort((a, b) => a - b);
    expect(hop).toEqual([1, 2, 3, 4, 5]);
  });

  /*
   * ★★★ CA NÀY TỪNG GHIM ĐIỀU NGƯỢC LẠI, và bản thân nó là một bài học.
   *
   * Tôi viết `viTri.y = caoM/2` kèm chú thích *"nếu không nó lún nửa thân"* — suy từ trực giác
   * "tâm khối" mà KHÔNG đọc phía tiêu thụ. Quy ước của cảnh là ĐÁY: `MayTrongLo.viTri` khai
   * *"Vị trí ĐÁY máy trên sàn"*, và `neoTrenNoc()` cộng TRỌN `caoMm` để lên nóc. Đặt tâm vào đó
   * là biểu tượng **nổi lên** nửa thân — đúng ngược điều tôi sợ.
   * ⇒ Lưới cũ xanh vì nó ghim chính cái sai của tôi. Một lưới viết cùng lúc với mã, từ cùng một
   *   giả định, không kiểm được giả định ấy — phải đối chiếu với NGƯỜI TIÊU THỤ.
   */
  it("★★★ biểu tượng dùng quy ước ĐÁY như `MayTrongLo`, và nằm đúng TẦNG của thành viên", () => {
    const tren: MayDeGopCum[] = [1, 2].map((i) => ({
      machineId: i, lineId: 1, viTri: { x: i * 2, y: 12.5, z: 0 },
      kichThuocMm: { rongMm: 1000, caoMm: 1800, sauMm: 1000 },
    }));
    const cum = dungCumTram(tren, { x: 100, y: 50, z: 100 }, CAO_CANVAS, { fovDo: FOV })[0];
    expect(cum.viTri.y).toBeCloseTo(12.5, 9);          // ← đáy, ở đúng cao độ sàn tầng 2
    expect(cum.viTri.y).not.toBeCloseTo(cum.caoM / 2, 3);
  });

  it("★ máy ở sàn `y = 0` ⇒ đáy cụm cũng 0 (ca nghịch: không tự ý nâng lên)", () => {
    const cum = dungCumTram([may(1, 1, 0, 0)], { x: 100, y: 50, z: 100 }, CAO_CANVAS, { fovDo: FOV })[0];
    expect(cum.viTri.y).toBe(0);
  });

  it("★ tâm cụm là TÂM HỘP BAO của thành viên, không phải máy đầu tiên", () => {
    const cum = dungCumTram([may(1, 1, 0, 0), may(2, 1, 10, 20)], { x: 300, y: 100, z: 300 }, CAO_CANVAS, { fovDo: FOV })[0];
    expect(cum.viTri.x).toBeCloseTo(5, 9);
    expect(cum.viTri.z).toBeCloseTo(10, 9);
  });
});

describe("chồng lấn — đo được, KHÔNG tự sửa", () => {
  it("★★★ hai cụm sát nhau bị phóng to thì CHỒNG, và hàm đếm phải nói ra", () => {
    // Hai line cách nhau 2 m, camera xa ⇒ cỡ tối thiểu lớn hơn 2 m rất nhiều ⇒ chắc chắn chồng.
    const ds = [may(1, 1, 0, 0), may(2, 2, 2, 0)];
    const cum = dungCumTram(ds, { x: 0, y: 200, z: 400 }, CAO_CANVAS, { fovDo: FOV });
    expect(cum).toHaveLength(2);
    expect(cum[0].rongM).toBeGreaterThan(2);
    expect(demCapChongNhau(cum)).toBe(1);
  });

  it("★ CA NGHỊCH — hai cụm cách xa thì KHÔNG đếm là chồng (nếu không con số vô nghĩa)", () => {
    const ds = [may(1, 1, 0, 0), may(2, 2, 400, 400)];
    const cum = dungCumTram(ds, { x: 0, y: 60, z: 60 }, CAO_CANVAS, { fovDo: FOV });
    expect(demCapChongNhau(cum)).toBe(0);
  });

  it("một cụm đơn độc ⇒ 0 cặp (không tự chồng chính mình)", () => {
    const cum = dungCumTram([may(1, 1, 0, 0)], { x: 0, y: 60, z: 60 }, CAO_CANVAS, { fovDo: FOV });
    expect(demCapChongNhau(cum)).toBe(0);
  });
});

describe("đổi cụm thành hộp cho `LoBatchMay` — dùng lại lớp vẽ đã có, không dựng lớp thứ hai", () => {
  const ds = [may(11, 3, 0, 0, true), may(12, 3, 2, 0), may(13, 9, 40, 40)];
  const cam = { x: 200, y: 80, z: 200 };

  it("★★★ id hộp là ÂM — không bao giờ trùng id máy thật (dương), kể cả khi lineId trùng chỉ số", () => {
    const { hop } = cumThanhHopVe(dungCumTram(ds, cam, CAO_CANVAS, { fovDo: FOV }), () => "#fff");
    expect(hop).toHaveLength(2);
    for (const h of hop) expect(h.machineId).toBeLessThan(0);
    // …và đôi một khác nhau: hai cụm cùng id là hai đích bấm không phân biệt được.
    expect(new Set(hop.map((h) => h.machineId)).size).toBe(hop.length);
  });

  it("★★★ TRA BẢNG chứ không giải mã số: `theoId` phải dẫn ngược về đúng cụm", () => {
    const cum = dungCumTram(ds, cam, CAO_CANVAS, { fovDo: FOV });
    const { hop, theoId } = cumThanhHopVe(cum, () => "#fff");
    for (const h of hop) {
      const c = theoId.get(h.machineId);
      expect(c).toBeDefined();
      expect(c!.machineIds.length).toBe(c!.soMay);
    }
    expect(theoId.get(hop[0].machineId)!.lineId).toBe(3);
    expect(theoId.get(hop[1].machineId)!.lineId).toBe(9);
  });

  it("★ cỡ hộp đổi ĐÚNG đơn vị (mét → mm) và vị trí giữ nguyên ĐÁY", () => {
    const cum = dungCumTram(ds, cam, CAO_CANVAS, { fovDo: FOV });
    const { hop } = cumThanhHopVe(cum, () => "#fff");
    expect(hop[0].kichThuocMm.rongMm).toBeCloseTo(cum[0].rongM * 1000, 6);
    expect(hop[0].kichThuocMm.caoMm).toBeCloseTo(cum[0].caoM * 1000, 6);
    expect(hop[0].viTri).toEqual(cum[0].viTri);
  });

  it("★ hàm màu được TIÊM và thật sự được gọi cho từng cụm (không phải màu cứng)", () => {
    const cum = dungCumTram(ds, cam, CAO_CANVAS, { fovDo: FOV });
    const { hop } = cumThanhHopVe(cum, (c) => (c.soBatThuong > 0 ? "#ff0000" : "#00ff00"));
    expect(hop[0].mau).toBe("#ff0000");   // line 3 có 1 máy bất thường
    expect(hop[1].mau).toBe("#00ff00");   // line 9 không có
  });

  it("tập rỗng ⇒ không hộp nào, bảng tra rỗng", () => {
    const { hop, theoId } = cumThanhHopVe([], () => "#fff");
    expect(hop).toEqual([]);
    expect(theoId.size).toBe(0);
  });
});
