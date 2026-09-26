import { describe, it, expect } from "vitest";
import {
  BOI_NGHEN,
  CAO_MOI_WIP_M,
  CAO_TOI_DA_M,
  HAN_KHAI_NGHEN_MS,
  NHIP_CHAM_NHAT_MS,
  NHIP_NHANH_NHAT_MS,
  WIP_TOI_THIEU_DE_NGHEN,
  conHieuLuc,
  cotWip,
  laNghen,
  nhipTuCanBang,
  trungViWip,
  xepHangWip,
  type TinhWip,
} from "./wipTram";

/**
 * ★★★ §11 #61 + #32 + #36 — VÁ L-2 CỦA ĐỢT 7.
 *
 * Đợt 7 đo được: `wip={[]}` viết cứng nghĩa là lớp phủ WIP qua `check`, qua
 * `build`, qua 994 test mà **chưa vẽ một pixel nào**, và *"không test nào trong
 * 994 test truyền một `wip` KHÁC RỖNG"*.
 *
 * Nên MỌI ca dưới đây đi bằng **dữ liệu KHÁC RỖNG** (G5). Ca rỗng có mặt đúng
 * hai lần và cả hai đều là ĐỐI CHỨNG — để chứng minh rằng cái xanh ở trên KHÔNG
 * phải là cái xanh mà tập rỗng cũng cho.
 */

/** Một chuyền 5 trạm; trạm 3 nghẽn thật (12 WIP so với trung vị 4). */
const BAY_GIO = 1_800_000_000_000;
/** Lời khai vừa mới sinh — còn hạn. */
const KHAI_TUOI = (id: number | null) => ({
  nghenTheoServer: id,
  mocKhai: BAY_GIO - 60_000,
  bayGio: BAY_GIO,
});
/** Lời khai 16 ngày tuổi — ĐÚNG con số đo được trên DB thật ở nghiệm thu Đợt 8. */
const KHAI_CU = (id: number | null) => ({
  nghenTheoServer: id,
  mocKhai: BAY_GIO - 16 * 24 * 60 * 60 * 1000,
  bayGio: BAY_GIO,
});

const CHUYEN: TinhWip[] = [
  { stationId: 1, ma: "ST-01", ten: "Nạp liệu", thuTu: 1, soWip: 4, x: 0, z: 0 },
  { stationId: 2, ma: "ST-02", ten: "Dán keo", thuTu: 2, soWip: 3, x: 5, z: 0 },
  { stationId: 3, ma: "ST-03", ten: "AOI", thuTu: 3, soWip: 12, x: 10, z: 0 },
  { stationId: 4, ma: "ST-04", ten: "Hàn", thuTu: 4, soWip: 5, x: 15, z: 0 },
  { stationId: 5, ma: "ST-05", ten: "Đóng gói", thuTu: 5, soWip: 4, x: 20, z: 0 },
];

describe("trungViWip — TRUNG VỊ, không phải trung bình", () => {
  it("chuyền 5 trạm [4,3,12,5,4] ⇒ trung vị 4", () => {
    expect(trungViWip(CHUYEN)).toBe(4);
  });

  it("★★★ chính trạm nghẽn KHÔNG được kéo mốc lên che chính nó", () => {
    // Trung bình của [4,3,12,5,4] = 5,6. Với trung bình, ngưỡng nghẽn là 11,2 —
    // trạm 12 WIP vẫn lọt, nhưng chỉ vừa vặn. Đẩy nghẽn lên 40 thì trung bình
    // thành 11,2 ⇒ ngưỡng 22,4 và 40 vẫn nghẽn... nhưng một trạm 20 WIP thì
    // KHÔNG, dù nó gấp 5 lần phần còn lại. Trung vị không có chế độ hỏng đó.
    const cucDoan = CHUYEN.map((t) => (t.stationId === 3 ? { ...t, soWip: 400 } : t));
    expect(trungViWip(cucDoan)).toBe(4); // vẫn 4 — miễn nhiễm giá trị cực đại
    const tb = cucDoan.reduce((a, t) => a + (t.soWip ?? 0), 0) / cucDoan.length;
    expect(tb).toBeGreaterThan(80); // trung bình đã bị kéo lên hơn 20 lần
  });

  it("số lượng CHẴN ⇒ trung bình hai giá trị giữa", () => {
    const bon: TinhWip[] = CHUYEN.slice(0, 4);
    // [4,3,12,5] sắp thành [3,4,5,12] ⇒ (4+5)/2 = 4,5
    expect(trungViWip(bon)).toBe(4.5);
  });

  it("★ trạm CHƯA ĐO ĐƯỢC không tham gia trung vị", () => {
    const comMot = [...CHUYEN, { stationId: 9, ma: "ST-09", ten: "Mới", thuTu: 9, soWip: null, x: 25, z: 0 }];
    expect(trungViWip(comMot)).toBe(4); // y hệt khi chưa thêm
  });

  it("ĐỐI CHỨNG — không mẫu nào ⇒ `null`, KHÔNG phải 0", () => {
    expect(trungViWip([])).toBeNull();
    expect(trungViWip([{ ...CHUYEN[0], soWip: null }])).toBeNull();
  });
});

describe("laNghen — nút thắt là chuyện SO SÁNH", () => {
  it("★★★ 12 WIP với trung vị 4 ⇒ NGHẼN (12 ≥ 2×4)", () => {
    expect(laNghen(12, 4)).toBe(true);
  });

  it("★★★ 5 WIP với trung vị 4 ⇒ KHÔNG nghẽn — bận không phải nghẽn", () => {
    expect(laNghen(5, 4)).toBe(false);
    expect(laNghen(BOI_NGHEN * 4 - 1, 4)).toBe(false);
    expect(laNghen(BOI_NGHEN * 4, 4)).toBe(true); // đúng biên
  });

  it("★★★ chuyền chạy nhẹ: 2 WIP với trung vị 1 vượt bội số MÀ VẪN không nghẽn", () => {
    // Thiếu sàn `WIP_TOI_THIEU_DE_NGHEN`, cả màn hình đỏ vào giờ nghỉ và người
    // vận hành học cách phớt lờ chỉ báo.
    expect(2).toBeGreaterThanOrEqual(BOI_NGHEN * 1); // bội số ĐÃ đạt
    expect(laNghen(2, 1)).toBe(false); // nhưng sàn chặn lại
    expect(laNghen(WIP_TOI_THIEU_DE_NGHEN, 1)).toBe(true); // đúng sàn thì qua
  });

  it("★★★ CHƯA ĐO ĐƯỢC không bao giờ bị tô đỏ (NT-3)", () => {
    expect(laNghen(null, 4)).toBe(false);
    expect(laNghen(999, null)).toBe(false);
  });

  it("★★★ server đã khai nút thắt ⇒ lời khai của server THẮNG suy luận client", () => {
    // Trạm 3 có 12 WIP (client sẽ tự suy là nghẽn), nhưng server nói trạm 5.
    expect(laNghen(12, 4, { ...KHAI_TUOI(5), stationId: 3 })).toBe(false);
    expect(laNghen(1, 4, { ...KHAI_TUOI(5), stationId: 5 })).toBe(true);
  });

  it("★ server KHÔNG khai (`null`) ⇒ rơi về suy luận WIP, không phải rơi về `false`", () => {
    expect(laNghen(12, 4, { ...KHAI_TUOI(null), stationId: 3 })).toBe(true);
  });
});

describe("cotWip — hình học cột 3D (#61)", () => {
  it("★★★ chuyền THẬT 5 trạm ⇒ 5 cột, KHÔNG phải mảng rỗng", () => {
    const cot = cotWip(CHUYEN);
    expect(cot).toHaveLength(5);
    // Đây chính là điều `wip={[]}` không bao giờ tạo ra được.
    expect(cot.length).toBeGreaterThan(0);
  });

  it("chiều cao tỉ lệ với số WIP", () => {
    const cot = cotWip(CHUYEN);
    expect(cot[0].cao).toBeCloseTo(4 * CAO_MOI_WIP_M, 6);
    expect(cot[2].cao).toBeCloseTo(12 * CAO_MOI_WIP_M, 6);
    expect(cot[2].cao).toBeGreaterThan(cot[0].cao);
  });

  it("★ toạ độ đi thẳng từ tâm trạm — cột phải đứng ĐÚNG chỗ trạm", () => {
    const cot = cotWip(CHUYEN);
    expect(cot[2]).toMatchObject({ x: 10, z: 0 });
  });

  it("★★★ đúng MỘT cột mang cờ nghẽn, và là trạm 3", () => {
    const cot = cotWip(CHUYEN);
    expect(cot.filter((c) => c.nghen)).toHaveLength(1);
    expect(cot[2].nghen).toBe(true);
    expect(cot[0].nghen).toBe(false);
  });

  it("★★★ trần chiều cao — 400 WIP KHÔNG dựng cột 100 m xuyên trần", () => {
    const kep = CHUYEN.map((t) => (t.stationId === 3 ? { ...t, soWip: 400 } : t));
    const cot = cotWip(kep);
    expect(cot[2].cao).toBe(CAO_TOI_DA_M);
    expect(400 * CAO_MOI_WIP_M).toBeGreaterThan(CAO_TOI_DA_M); // trần thật sự có tác dụng
  });

  it("★★★ trạm CHƯA ĐO ĐƯỢC bị BỎ, không dựng cột cao 0", () => {
    // Một cột dí sát sàn trông y hệt "trạm trống" ⇒ bịa câu trả lời "0".
    const comMot: TinhWip[] = [
      ...CHUYEN,
      { stationId: 9, ma: "ST-09", ten: "Chưa đo", thuTu: 9, soWip: null, x: 25, z: 0 },
    ];
    const cot = cotWip(comMot);
    expect(cot).toHaveLength(5);
    expect(cot.some((c) => c.x === 25)).toBe(false);
  });

  it("★ trạm đo được và bằng 0 cũng không có cột (không có gì để vẽ)", () => {
    const cot = cotWip(CHUYEN.map((t) => (t.stationId === 2 ? { ...t, soWip: 0 } : t)));
    expect(cot).toHaveLength(4);
  });

  it("★★★ server khai nút thắt trạm 1 ⇒ cột trạm 1 đỏ, trạm 3 (12 WIP) KHÔNG", () => {
    const cot = cotWip(CHUYEN, KHAI_TUOI(1));
    expect(cot[0].nghen).toBe(true);
    expect(cot[2].nghen).toBe(false);
    expect(cot.filter((c) => c.nghen)).toHaveLength(1);
  });

  it("ĐỐI CHỨNG — đầu vào rỗng ⇒ rỗng (và chỉ ca này mới được rỗng)", () => {
    expect(cotWip([])).toEqual([]);
  });
});

describe("xepHangWip — bảng 2D song song, điều kiện §11.5", () => {
  it("★★★ chuyền THẬT ⇒ 5 dòng có SỐ, không phải chỉ có màu", () => {
    const bang = xepHangWip(CHUYEN);
    expect(bang).toHaveLength(5);
    expect(bang.map((d) => d.soWip)).toEqual([4, 3, 12, 5, 4]);
  });

  it("★★★ giữ NGUYÊN thứ tự dòng chảy — dải Line là bản đồ, không phải bảng xếp hạng", () => {
    const bang = xepHangWip(CHUYEN);
    expect(bang.map((d) => d.thuTu)).toEqual([1, 2, 3, 4, 5]);
  });

  it("★★★ hạng trả lời 'hơn bao nhiêu' bằng SỐ: trạm 3 hạng 1, trạm 2 hạng cuối", () => {
    const bang = xepHangWip(CHUYEN);
    expect(bang.find((d) => d.stationId === 3)?.hang).toBe(1);
    expect(bang.find((d) => d.stationId === 4)?.hang).toBe(2);
    expect(bang.find((d) => d.stationId === 2)?.hang).toBe(5);
  });

  it("★ bằng nhau ⇒ CÙNG hạng (trạm 1 và 5 đều 4 WIP)", () => {
    const bang = xepHangWip(CHUYEN);
    expect(bang.find((d) => d.stationId === 1)?.hang).toBe(3);
    expect(bang.find((d) => d.stationId === 5)?.hang).toBe(3);
  });

  it("★★★ trạm CHƯA ĐO ĐƯỢC nhận `hang: null`, KHÔNG bị xếp bét", () => {
    // Xếp nó hạng cuối là khẳng định nó ít WIP nhất — điều ta không biết.
    const comMot: TinhWip[] = [
      ...CHUYEN,
      { stationId: 9, ma: "ST-09", ten: "Chưa đo", thuTu: 9, soWip: null, x: 25, z: 0 },
    ];
    const bang = xepHangWip(comMot);
    const moi = bang.find((d) => d.stationId === 9)!;
    expect(moi.hang).toBeNull();
    expect(moi.soWip).toBeNull();
    expect(moi.nghen).toBe(false);
    // và nó KHÔNG đẩy hạng của ai khác đi
    expect(bang.find((d) => d.stationId === 3)?.hang).toBe(1);
  });

  it("★★★ §11.5 — 3D và 2D PHẢI khai cùng một trạm là nghẽn", () => {
    // Hai bản cài đặt rời sẽ lệch (G12). Đây là phép đo chống lệch đó.
    const cot = cotWip(CHUYEN);
    const bang = xepHangWip(CHUYEN);
    const nghen3D = CHUYEN.filter((_, i) => cot[i]?.nghen).map((t) => t.stationId);
    const nghen2D = bang.filter((d) => d.nghen).map((d) => d.stationId);
    expect(nghen2D).toEqual([3]);
    expect(nghen3D).toEqual(nghen2D);
  });

  it("★★★ §11.5 dưới lời khai của SERVER — hai bề mặt vẫn khớp", () => {
    const cot = cotWip(CHUYEN, KHAI_TUOI(4));
    const bang = xepHangWip(CHUYEN, KHAI_TUOI(4));
    expect(bang.filter((d) => d.nghen).map((d) => d.stationId)).toEqual([4]);
    expect(cot.filter((c) => c.nghen)).toHaveLength(1);
    expect(cot[3].nghen).toBe(true);
  });
});

describe("nhipTuCanBang — #36, nhịp THẬT chứ không phải độ trễ ACK lệnh", () => {
  it("★★★ nhịp 12 s/chiếc đi thẳng qua — mũi tên CHẠY", () => {
    expect(nhipTuCanBang(12_000)).toBe(12_000);
  });

  it("★★★ chưa đo được ⇒ `null` ⇒ mũi tên ĐỨNG YÊN, không bịa tốc độ", () => {
    expect(nhipTuCanBang(null)).toBeNull();
    expect(nhipTuCanBang(undefined)).toBeNull();
    expect(nhipTuCanBang(0)).toBeNull();
    expect(nhipTuCanBang(-5)).toBeNull();
    expect(nhipTuCanBang(Number.NaN)).toBeNull();
    expect(nhipTuCanBang(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it("★★★ nhịp chậm hơn 2 phút ⇒ `null` (đứng hẳn), KHÔNG phải bò chậm", () => {
    // Mũi tên bò chậm hơn mắt phân biệt được sẽ bị đọc là "đang chạy".
    expect(nhipTuCanBang(NHIP_CHAM_NHAT_MS)).toBe(NHIP_CHAM_NHAT_MS);
    expect(nhipTuCanBang(NHIP_CHAM_NHAT_MS + 1)).toBeNull();
    expect(nhipTuCanBang(600_000)).toBeNull();
  });

  it("★ nhịp phi lý nhanh bị kẹp lên sàn, không cho mũi tên nhoè thành vệt", () => {
    expect(nhipTuCanBang(3)).toBe(NHIP_NHANH_NHAT_MS);
  });

  it("★★★ ĐỐI CHỨNG G7 — độ trễ ACK lệnh (80 ms) KHÔNG được đọc như nhịp chuyền", () => {
    // Spec §11 #36 chỉ `commandLog.avgDurations` = avg(ackedAt − sentAt) theo
    // LOẠI LỆNH. Một chuyền 12 s/chiếc mà lệnh ack 80 ms sẽ cho mũi tên chạy
    // nhanh gấp 150 lần sự thật. Test này ghim khoảng cách đó thành SỐ.
    const nhipThat = nhipTuCanBang(12_000)!;
    const doTreAck = nhipTuCanBang(80)!;
    expect(nhipThat / doTreAck).toBeGreaterThan(50);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/* ★★★ HẠN DÙNG CỦA LỜI KHAI SERVER — VÁ LỖI BẮT ĐƯỢC BẰNG MẮT Ở ĐỢT 8         */
/* ═══════════════════════════════════════════════════════════════════════════ */

describe("★★★ conHieuLuc — 'có thẩm quyền hơn' KHÔNG có nghĩa 'đúng mãi mãi'", () => {
  it("★★★ vừa đo xong ⇒ còn hạn", () => {
    expect(conHieuLuc(BAY_GIO - 60_000, BAY_GIO)).toBe(true);
  });

  it("★★★ đúng biên 8 giờ ⇒ CÒN hạn; quá một mili giây ⇒ HẾT", () => {
    expect(conHieuLuc(BAY_GIO - HAN_KHAI_NGHEN_MS, BAY_GIO)).toBe(true);
    expect(conHieuLuc(BAY_GIO - HAN_KHAI_NGHEN_MS - 1, BAY_GIO)).toBe(false);
  });

  it("★★★ KHÔNG BIẾT tuổi ⇒ KHÔNG tin — mặc định 'cứ tin' chính là lỗi đã đo", () => {
    expect(conHieuLuc(null, BAY_GIO)).toBe(false);
    expect(conHieuLuc(undefined, BAY_GIO)).toBe(false);
    expect(conHieuLuc(Number.NaN, BAY_GIO)).toBe(false);
  });
});

describe("★★★ TÁI HIỆN LỖI THẬT — Line 1 SIM-FAC, bản ghi 16 ngày tuổi", () => {
  /**
   * Dữ liệu ĐO ĐƯỢC trên DB dev tại nghiệm thu Đợt 8:
   *   `wip_tracking` sống: trạm 1 = 3.152, mười một trạm còn lại 118…174.
   *   `line_balance_metrics` mới nhất của Line 1: `periodStart` 2026-08-21
   *   (16 ngày 18 giờ trước), `bottleneckStationId` = **10** (trạm có 124 WIP).
   */
  const LINE1: TinhWip[] = [
    [1, 3152], [2, 171], [3, 174], [4, 160], [5, 146], [6, 143],
    [7, 139], [8, 135], [9, 127], [10, 124], [11, 118], [12, 118],
  ].map(([id, n]) => ({
    stationId: id, ma: `SIM-L1-${id}`, ten: `Trạm ${id}`, thuTu: id, soWip: n, x: id * 3, z: 0,
  }));

  it("★★★ trung vị của Line 1 là 141 — trạm 1 gấp hơn 22 lần", () => {
    const tv = trungViWip(LINE1)!;
    expect(tv).toBe(141);
    expect(3152 / tv).toBeGreaterThan(22);
  });

  it("★★★ LỖI ĐÃ VÁ: lời khai 16 ngày KHÔNG được tô đỏ trạm 124 WIP", () => {
    // Trước khi vá: cột đỏ nằm ở trạm 10 (124 WIP) còn trạm 1 (3.152 WIP) vẽ
    // màu bình thường ⇒ người vận hành đi chữa đúng cái trạm KHÔNG hỏng.
    const bang = xepHangWip(LINE1, KHAI_CU(10));
    const doTram = bang.filter((d) => d.nghen).map((d) => d.stationId);
    expect(doTram).not.toContain(10);
    expect(doTram).toEqual([1]); // rơi về suy luận WIP sống — đúng trạm đang ngập
  });

  it("★★★ ĐỐI CHỨNG: cùng lời khai đó nhưng CÒN TƯƠI thì VẪN thắng", () => {
    // Chứng minh bản vá không phải là "bỏ luôn lời khai server" — nó chỉ kiểm hạn.
    const bang = xepHangWip(LINE1, KHAI_TUOI(10));
    expect(bang.filter((d) => d.nghen).map((d) => d.stationId)).toEqual([10]);
  });

  it("★★★ HAI bề mặt vẫn khớp dưới lời khai HẾT HẠN (§11.5 + G12)", () => {
    const cot = cotWip(LINE1, KHAI_CU(10));
    const bang = xepHangWip(LINE1, KHAI_CU(10));
    const nghen3D = LINE1.filter((_, i) => cot[i]?.nghen).map((t) => t.stationId);
    const nghen2D = bang.filter((d) => d.nghen).map((d) => d.stationId);
    expect(nghen3D).toEqual([1]);
    expect(nghen3D).toEqual(nghen2D);
  });

  it("★★★ trạm 1 chạm TRẦN chiều cao — 3.152 WIP không dựng cột 788 m", () => {
    const cot = cotWip(LINE1, KHAI_CU(10));
    expect(cot[0].cao).toBe(CAO_TOI_DA_M);
    expect(3152 * CAO_MOI_WIP_M).toBeGreaterThan(700); // nếu không có trần
  });
});
