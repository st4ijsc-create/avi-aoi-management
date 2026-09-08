/**
 * sucKhoeMay.unit.test.ts — ghim A-4 (§14.5.1, mục G-1 / F-15).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ TIỀN ĐỀ G5 PHẢI ĐƯỢC KHAI TRƯỚC — TẬP ĐẦU VÀO KHÁC RỖNG
 * ════════════════════════════════════════════════════════════════════════════
 * Bốn luật cùng họ G5/G6/G7/G10 đều cho cổng xanh MÀ KHÔNG ĐO GÌ: đo trên tập
 * rỗng · nhánh không ai đi · đếm đầu vào ≠ đầu ra · chỉ báo bị chỉ định nhầm.
 * Nên mọi khối dưới đây mở đầu bằng một `expect` chứng minh **nhánh đang test
 * thật sự có mẫu đi qua**, trước khi khẳng định gì về kết quả.
 *
 * ★ Số liệu dùng làm mẫu lấy từ phép đo THẬT trên `machine_health_history`
 *   (2026-09-08, 180.800 hàng): miền điểm [55…100], enum bốn mức, 6/43 máy dưới
 *   60 điểm, 21/43 dưới 80, 1/43 máy có lời khai cũ hơn 24h.
 */

import { describe, expect, it } from "vitest";

import {
  BAN_KINH_VIEN_TOI_THIEU_M,
  HAN_KHAI_SUC_KHOE_MS,
  MOI_MUC_KHAN,
  NGUONG_CANH,
  NGUONG_NGUY_KICH,
  NGUONG_THEO_DOI,
  banKinhVien,
  conHanSucKhoe,
  hangSucKhoe,
  laBatThuongSucKhoe,
  mauVienSucKhoe,
  tomTatSucKhoe,
  vienSucKhoe,
  xepHangSucKhoe,
  type ChoDatVien,
  type HangSucKhoe,
  type KhaiSucKhoe,
} from "./sucKhoeMay";

const BAY_GIO = Date.parse("2026-09-08T09:40:00.000Z");
const PHUT = 60_000;
const GIO = 60 * PHUT;

function khai(p: Partial<KhaiSucKhoe> & { machineId: number }): KhaiSucKhoe {
  return {
    diem: 95,
    nguyCo: 0,
    mucKhan: "LOW",
    mocMs: BAY_GIO - PHUT,
    ...p,
  };
}

function cho(machineId: number, x = 0, z = 0): ChoDatVien {
  return { machineId, viTri: { x, z }, kichThuocMm: { rong: 1200, sau: 800 } };
}

/* ═══════════════════════════════════════════════════════════════════════════ */
describe("G30 — hạn hiệu lực của lời khai sức khoẻ", () => {
  it("★ tiền đề: hạn là 24h, KHÁC hạn nút thắt 8h — hai nhịp sinh khác nhau", () => {
    expect(HAN_KHAI_SUC_KHOE_MS).toBe(24 * GIO);
    expect(HAN_KHAI_SUC_KHOE_MS).not.toBe(8 * GIO);
  });

  it("mốc null ⇒ KHÔNG tin — lời khai không dấu thời gian thì không kiểm được hạn", () => {
    expect(conHanSucKhoe(null, BAY_GIO)).toBe(false);
    expect(conHanSucKhoe(undefined, BAY_GIO)).toBe(false);
    expect(conHanSucKhoe(Number.NaN, BAY_GIO)).toBe(false);
    expect(conHanSucKhoe(Number.POSITIVE_INFINITY, BAY_GIO)).toBe(false);
  });

  it("★ hai chiều quanh ranh giới — chứ không chỉ chiều 'còn hạn'", () => {
    // Ngay TRONG hạn.
    expect(conHanSucKhoe(BAY_GIO - HAN_KHAI_SUC_KHOE_MS + 1, BAY_GIO)).toBe(true);
    // Đúng ranh giới ⇒ vẫn tin (`<=`).
    expect(conHanSucKhoe(BAY_GIO - HAN_KHAI_SUC_KHOE_MS, BAY_GIO)).toBe(true);
    // Quá hạn 1 ms ⇒ hết.
    expect(conHanSucKhoe(BAY_GIO - HAN_KHAI_SUC_KHOE_MS - 1, BAY_GIO)).toBe(false);
  });

  it("máy im lặng 18 ngày (ca THẬT đo được: máy cũ nhất 2026-08-21) ⇒ hết hạn", () => {
    const mocThat = Date.parse("2026-08-21T07:22:12.288Z");
    expect(BAY_GIO - mocThat).toBeGreaterThan(HAN_KHAI_SUC_KHOE_MS);
    expect(conHanSucKhoe(mocThat, BAY_GIO)).toBe(false);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════ */
describe("hangSucKhoe — phân hạng", () => {
  it("★ tiền đề G5: bốn ngưỡng RỜI NHAU và tăng dần, nếu không mọi hạng dưới là nhánh chết", () => {
    expect(NGUONG_NGUY_KICH).toBeLessThan(NGUONG_CANH);
    expect(NGUONG_CANH).toBeLessThan(NGUONG_THEO_DOI);
  });

  it("★ mỗi hạng CÓ ít nhất một mẫu đi qua — không hạng nào là nhánh không ai đi", () => {
    const thu: Record<string, KhaiSucKhoe> = {
      nguy_kich: khai({ machineId: 1, diem: 55 }),
      canh: khai({ machineId: 2, diem: 70 }),
      theo_doi: khai({ machineId: 3, diem: 85 }),
      khoe: khai({ machineId: 4, diem: 95 }),
      chua_do: khai({ machineId: 5, diem: null, nguyCo: null, mucKhan: null }),
      het_han: khai({ machineId: 6, diem: 70, mocMs: BAY_GIO - 25 * GIO }),
    };
    const ra = new Set<HangSucKhoe>();
    for (const [mong, k] of Object.entries(thu)) {
      const h = hangSucKhoe(k, BAY_GIO);
      expect(h).toBe(mong);
      ra.add(h);
    }
    // Đầu ra RỜI NHAU: 6 mẫu ⇒ 6 hạng khác nhau, không cái nào trùng.
    expect(ra.size).toBe(6);
  });

  it("★★★ HẠN TRƯỚC, ĐIỂM SAU — máy 31 điểm với lời khai 18 ngày ra `het_han`, KHÔNG ra `nguy_kich`", () => {
    const cu = khai({ machineId: 7, diem: 31, mucKhan: "CRITICAL", mocMs: BAY_GIO - 18 * 24 * GIO });
    // Tiền đề: nếu chỉ nhìn điểm thì đây CHẮC CHẮN là nguy kịch.
    expect(hangSucKhoe({ ...cu, mocMs: BAY_GIO }, BAY_GIO)).toBe("nguy_kich");
    // Nhưng hạn thắng.
    expect(hangSucKhoe(cu, BAY_GIO)).toBe("het_han");
  });

  it("★ `chua_do` ≠ `het_han` — hai tình huống, hai hành động khác nhau (NT-3)", () => {
    const chuaDo = khai({ machineId: 8, diem: null, nguyCo: null, mucKhan: null, mocMs: null });
    const hetHan = khai({ machineId: 9, diem: 70, mocMs: BAY_GIO - 25 * GIO });
    expect(hangSucKhoe(chuaDo, BAY_GIO)).toBe("chua_do");
    expect(hangSucKhoe(hetHan, BAY_GIO)).toBe("het_han");
    expect(hangSucKhoe(chuaDo, BAY_GIO)).not.toBe(hangSucKhoe(hetHan, BAY_GIO));
  });

  it("★ CRITICAL nâng hạng bất kể điểm — hai phép đo độc lập, lấy cái nghiêm trọng hơn", () => {
    // Đo được: có hàng CRITICAL trong khi miền điểm chỉ xuống tới 55 (>60).
    const k = khai({ machineId: 10, diem: 88, mucKhan: "CRITICAL" });
    // Tiền đề: nếu chỉ theo điểm thì 88 là `theo_doi`.
    expect(hangSucKhoe({ ...k, mucKhan: "LOW" }, BAY_GIO)).toBe("theo_doi");
    expect(hangSucKhoe(k, BAY_GIO)).toBe("nguy_kich");
  });

  it("HIGH/MEDIUM KHÔNG nâng hạng — chỉ CRITICAL, và điều đó phải nói ra được", () => {
    for (const m of ["LOW", "MEDIUM", "HIGH"] as const) {
      expect(hangSucKhoe(khai({ machineId: 11, diem: 88, mucKhan: m }), BAY_GIO)).toBe("theo_doi");
    }
    expect(MOI_MUC_KHAN).toEqual(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
  });

  it("điểm 0 KHÔNG bị lẫn với `null` — 0 là 'hỏng nặng', null là 'chưa đo' (NT-3.5)", () => {
    expect(hangSucKhoe(khai({ machineId: 12, diem: 0 }), BAY_GIO)).toBe("nguy_kich");
    expect(hangSucKhoe(khai({ machineId: 13, diem: null, nguyCo: null, mucKhan: null }), BAY_GIO)).toBe(
      "chua_do",
    );
  });
});

/* ═══════════════════════════════════════════════════════════════════════════ */
describe("§14.5.0/§14.5.2 — NGÂN SÁCH NHÃN", () => {
  it("★★★ CHỈ `nguy_kich` giành nhãn — nếu `canh` cũng giành, riêng A-4 ăn 21/30 chỗ", () => {
    expect(laBatThuongSucKhoe("nguy_kich")).toBe(true);
    for (const h of ["canh", "theo_doi", "khoe", "chua_do", "het_han"] as const) {
      expect(laBatThuongSucKhoe(h)).toBe(false);
    }
  });

  it("★ ca THẬT đo được: 43 máy, 6 dưới 60 và 21 dưới 80 ⇒ số nhãn A-4 = 6, KHÔNG phải 21", () => {
    // Dựng lại đúng hình dạng phân bố đã đo, không phải một tập tuỳ ý.
    const ds: KhaiSucKhoe[] = [];
    for (let i = 1; i <= 43; i += 1) {
      /*
       * i=1…6  → 55,56,57,58,59,55 — SÁU máy strictly < 60 (sàn miền đo được là 55)
       * i=7…21 → 70               — MƯỜI LĂM máy trong [60,80)
       * i=22…43→ 90               — hai mươi hai máy ≥ 80
       * ⇒ dưới 60 = 6 · dưới 80 = 21, khớp phép đo thật.
       *
       * ★ Hai lần trước tôi viết `55+i` rồi `54+i` và cả hai đều LỆCH (61 và 60
       *   không < 60). Chính `expect` tiền đề ngay dưới đây bắt được — đó đúng là
       *   việc của nó, và là lý do tiền đề G5 không phải nghi thức thừa.
       */
      const diem = i <= 6 ? 55 + ((i - 1) % 5) : i <= 21 ? 70 : 90;
      ds.push(khai({ machineId: i, diem }));
    }
    // Tiền đề: tập mẫu KHỚP phép đo thật.
    expect(ds.filter((k) => (k.diem ?? 0) < 60).length).toBe(6);
    expect(ds.filter((k) => (k.diem ?? 0) < 80).length).toBe(21);

    const soNhan = ds.filter((k) => laBatThuongSucKhoe(hangSucKhoe(k, BAY_GIO))).length;
    expect(soNhan).toBe(6);
    expect(soNhan).toBeLessThanOrEqual(30); // trần §4
  });
});

/* ═══════════════════════════════════════════════════════════════════════════ */
describe("mauVienSucKhoe — độ bão hoà dành cho bất thường (§14.7.1 / ASM)", () => {
  it("★★★ `khoe` KHÔNG có viền — 43 vòng xanh lá làm 6 vòng đỏ khó thấy hơn", () => {
    expect(mauVienSucKhoe("khoe")).toBeNull();
    expect(mauVienSucKhoe("chua_do")).toBeNull();
  });

  it("★ tiền đề: bốn hạng CÓ màu, và bốn màu RỜI NHAU (không hạng nào lẫn hạng nào)", () => {
    const co = (["nguy_kich", "canh", "theo_doi", "het_han"] as const).map((h) => mauVienSucKhoe(h));
    expect(co.every((m) => typeof m === "string" && m.length > 0)).toBe(true);
    expect(new Set(co).size).toBe(4);
  });

  it("≤ 7 mã màu (§10.2 / ISA-101) — tổng mã màu A-4 dùng", () => {
    const tap = new Set(
      (["nguy_kich", "canh", "theo_doi", "khoe", "chua_do", "het_han"] as const)
        .map((h) => mauVienSucKhoe(h))
        .filter((m): m is string => m != null),
    );
    expect(tap.size).toBeLessThanOrEqual(7);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════ */
describe("banKinhVien — vòng phải BAO TRỌN máy ở mọi hướng xoay", () => {
  it("★★★ dùng nửa ĐƯỜNG CHÉO, không nửa cạnh — máy 2400×600 xoay 45° vẫn không bị cắt", () => {
    const r = banKinhVien(2400, 600);
    const nuaCanhLon = 2400 / 2 / 1000; // 1,2 m — bản sai sẽ ra số này
    const nuaCheo = Math.sqrt(2400 ** 2 + 600 ** 2) / 2 / 1000; // ≈ 1,237 m
    expect(r).toBeGreaterThan(nuaCanhLon);
    expect(r).toBeGreaterThan(nuaCheo);
  });

  it("máy rất nhỏ vẫn có vòng bấm được — sàn bán kính", () => {
    expect(banKinhVien(1, 1)).toBe(BAN_KINH_VIEN_TOI_THIEU_M);
    expect(banKinhVien(0, 0)).toBe(BAN_KINH_VIEN_TOI_THIEU_M);
  });

  it("số rác không làm vỡ hình học (NaN/âm ⇒ về sàn, không ra NaN)", () => {
    expect(Number.isFinite(banKinhVien(Number.NaN, 800))).toBe(true);
    expect(Number.isFinite(banKinhVien(-500, -500))).toBe(true);
    expect(banKinhVien(-500, -500)).toBe(BAN_KINH_VIEN_TOI_THIEU_M);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════ */
describe("vienSucKhoe — quy ra hình học", () => {
  const ds: KhaiSucKhoe[] = [
    khai({ machineId: 1, diem: 55 }), // nguy_kich
    khai({ machineId: 2, diem: 70 }), // canh
    khai({ machineId: 3, diem: 85 }), // theo_doi
    khai({ machineId: 4, diem: 95 }), // khoe   ⇒ KHÔNG vẽ
    khai({ machineId: 5, diem: 70, mocMs: BAY_GIO - 25 * GIO }), // het_han
  ];
  const chos = [cho(1), cho(2), cho(3), cho(4), cho(5)];

  it("★ tiền đề G5: đầu vào KHÁC RỖNG và chứa CẢ hạng được vẽ LẪN hạng bị bỏ", () => {
    expect(ds.length).toBeGreaterThan(0);
    const hangs = new Set(ds.map((k) => hangSucKhoe(k, BAY_GIO)));
    expect(hangs.has("khoe")).toBe(true); // có mẫu bị bỏ
    expect(hangs.has("nguy_kich")).toBe(true); // có mẫu được vẽ
  });

  it("★★★ chỉ trả vòng CÓ MÀU — 5 máy vào, 4 vòng ra, máy khoẻ vắng mặt", () => {
    const v = vienSucKhoe(ds, chos, BAY_GIO);
    expect(v).toHaveLength(4);
    expect(v.map((x) => x.machineId)).toEqual([1, 2, 3, 5]);
    expect(v.find((x) => x.machineId === 4)).toBeUndefined();
  });

  it("viền hết hạn được đánh dấu MỜ — không đọc nhầm thành số sống", () => {
    const v = vienSucKhoe(ds, chos, BAY_GIO);
    expect(v.find((x) => x.machineId === 5)?.motNhat).toBe(true);
    expect(v.find((x) => x.machineId === 1)?.motNhat).toBe(false);
  });

  it("máy đang ẨN (ngoài phạm vi) KHÔNG được vẽ vòng", () => {
    const an = chos.map((c) => (c.machineId === 1 ? { ...c, hien: false } : c));
    const v = vienSucKhoe(ds, an, BAY_GIO);
    expect(v.map((x) => x.machineId)).toEqual([2, 3, 5]);
  });

  it("máy CÓ lời khai mà KHÔNG có chỗ đặt bị bỏ im lặng — không có toạ độ thì không có chỗ vẽ", () => {
    const v = vienSucKhoe(ds, [cho(1)], BAY_GIO);
    expect(v).toHaveLength(1);
    expect(v[0].machineId).toBe(1);
  });

  it("★ TẤT ĐỊNH — đảo thứ tự đầu vào cho đầu ra y hệt (khuôn `locNhan`)", () => {
    const xuoi = vienSucKhoe(ds, chos, BAY_GIO);
    const nguoc = vienSucKhoe([...ds].reverse(), [...chos].reverse(), BAY_GIO);
    expect(nguoc).toEqual(xuoi);
  });

  it("lời khai TRÙNG machineId — bản SAU thắng, và số vòng KHÔNG nhân đôi", () => {
    const trung = [...ds, khai({ machineId: 1, diem: 95 })];
    const v = vienSucKhoe(trung, chos, BAY_GIO);
    // máy 1 giờ là `khoe` ⇒ biến mất; tổng còn 3.
    expect(v.map((x) => x.machineId)).toEqual([2, 3, 5]);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════ */
describe("§11.5 — BẢNG 2D SONG SONG dùng CHUNG phép phân hạng (G12)", () => {
  const ds: KhaiSucKhoe[] = [
    khai({ machineId: 1, diem: 95 }),
    khai({ machineId: 2, diem: 55 }),
    khai({ machineId: 3, diem: 70 }),
    khai({ machineId: 4, diem: 58 }),
  ];

  it("★★★ 3D tô đỏ máy nào thì bảng 2D xếp đúng máy đó lên đầu — không hai bản cài đặt", () => {
    const v = vienSucKhoe(ds, [cho(1), cho(2), cho(3), cho(4)], BAY_GIO);
    const bang = xepHangSucKhoe(ds, [1, 2, 3, 4], BAY_GIO);

    const doTren3D = v.filter((x) => x.hang === "nguy_kich").map((x) => x.machineId).sort();
    const doTrenBang = bang.filter((r) => r.hang === "nguy_kich").map((r) => r.machineId).sort();
    // Tiền đề: tập KHÁC RỖNG — nếu rỗng thì phép so này không đo gì (G5).
    expect(doTren3D.length).toBeGreaterThan(0);
    expect(doTrenBang).toEqual(doTren3D);
  });

  it("tệ nhất lên đầu; trong cùng hạng thì điểm thấp hơn lên trước", () => {
    const bang = xepHangSucKhoe(ds, [1, 2, 3, 4], BAY_GIO);
    expect(bang.map((r) => r.machineId)).toEqual([2, 4, 3, 1]);
  });

  it("★ bảng 2D KHÔNG lọc `khoe` — chỗ để đọc kỹ, khác chỗ để liếc", () => {
    const bang = xepHangSucKhoe(ds, [1, 2, 3, 4], BAY_GIO);
    expect(bang).toHaveLength(4);
    expect(bang.some((r) => r.hang === "khoe")).toBe(true);
  });

  it("máy chưa xếp bố cục vẫn có trong bảng, kèm cờ `coTrenCanh=false`", () => {
    const bang = xepHangSucKhoe(ds, [1, 2], BAY_GIO);
    expect(bang).toHaveLength(4);
    expect(bang.find((r) => r.machineId === 3)?.coTrenCanh).toBe(false);
    expect(bang.find((r) => r.machineId === 1)?.coTrenCanh).toBe(true);
  });

  it("★ thứ tự TẤT ĐỊNH khi hoà — đảo đầu vào không làm bảng nhảy", () => {
    const a = xepHangSucKhoe(ds, [1, 2, 3, 4], BAY_GIO);
    const b = xepHangSucKhoe([...ds].reverse(), [1, 2, 3, 4], BAY_GIO);
    expect(b.map((r) => r.machineId)).toEqual(a.map((r) => r.machineId));
  });
});

/* ═══════════════════════════════════════════════════════════════════════════ */
describe("tomTatSucKhoe — G9: ĐƠN VỊ CỦA CON SỐ", () => {
  const ds: KhaiSucKhoe[] = [
    khai({ machineId: 1, diem: 55 }),
    khai({ machineId: 2, diem: 70 }),
    khai({ machineId: 3, diem: 95 }),
    khai({ machineId: 4, diem: null, nguyCo: null, mucKhan: null }), // chua_do
  ];

  it("★★★ `soKhongCoKhai` ≠ `chua_do` — hai đại lượng khác nhau, trộn là nói dối", () => {
    // Máy 5 có mặt trên cảnh nhưng KHÔNG có hàng nào trong tập lời khai.
    const tt = tomTatSucKhoe(ds, [1, 2, 3, 4, 5], BAY_GIO);
    // Tiền đề: cả HAI nhánh đều có mẫu — nếu một nhánh rỗng thì phép so vô nghĩa.
    expect(tt.chua_do).toBe(1); // máy 4: có hàng, mọi cột NULL
    expect(tt.soKhongCoKhai).toBe(1); // máy 5: không có hàng nào
    expect(tt.chua_do).not.toBe(tt.chua_do + tt.soKhongCoKhai);
  });

  it("★★★ BG-127 — ĐỐI CHIẾU TỔNG: sáu hạng + soKhongCoKhai == tongTrenCanh", () => {
    const ids = [1, 2, 3, 4, 5, 6];
    const tt = tomTatSucKhoe(ds, ids, BAY_GIO);
    const tong =
      tt.nguy_kich + tt.canh + tt.theo_doi + tt.khoe + tt.chua_do + tt.het_han + tt.soKhongCoKhai;
    expect(tt.tongTrenCanh).toBe(ids.length);
    expect(tong).toBe(tt.tongTrenCanh);
  });

  it("★ mẫu số được KHAI RA — không ai phải tự đoán '6/?' nghĩa là gì", () => {
    const tt = tomTatSucKhoe(ds, [1, 2, 3], BAY_GIO);
    expect(tt.tongTrenCanh).toBe(3);
    // Lời khai về 4 máy, nhưng chỉ 3 máy trên cảnh ⇒ mẫu số là 3, không phải 4.
    expect(ds.length).toBe(4);
  });

  it("cảnh RỖNG ⇒ mọi ô 0 và tổng 0 — không chia cho 0, không NaN", () => {
    const tt = tomTatSucKhoe(ds, [], BAY_GIO);
    expect(tt.tongTrenCanh).toBe(0);
    expect(tt.soKhongCoKhai).toBe(0);
    expect(Object.values(tt).every((n) => Number.isFinite(n))).toBe(true);
  });
});
