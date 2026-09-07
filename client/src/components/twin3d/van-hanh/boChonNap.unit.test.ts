/**
 * boChonNap.unit.test.ts — Đợt 10 lô F, mục F1/F2/F3.
 *
 * ★★★ MỖI KHỐI TEST ĐÍNH KÈM PHÉP ĐO ĐÃ LÀM CHO NÓ SỐNG LẠI ĐƯỢC.
 *   Lô E đo trên DB thật: 4 nhà máy × 549 máy, banner khai đúng 373. Ở đây ta
 *   tái lập CHÍNH tỉ lệ đó bằng số (176/187/186) để test biết KÊU trên ca dương
 *   đã biết — một chỉ báo không kêu được trên ca dương thì cổng xanh của nó
 *   không chứng minh gì (G5/G32).
 */
import { describe, it, expect } from "vitest";

import {
  phanGiaiNap,
  phamViThuc,
  tapDoiSoatTheoNap,
  yeuCauBiBoQua,
  type MucChon,
  type TapCoSan,
} from "./boChonNap";

const m = (id: number): MucChon => ({ id, nhan: `#${id}` });

const SAN: TapCoSan = {
  nhaMay: [m(1), m(18), m(20)],
  toaNha: [m(3), m(4)],
  tang: [m(7), m(8), m(9)],
};

describe("phanGiaiNap", () => {
  it("URL vắng cả ba ô ⇒ phần tử ĐẦU của từng cấp (hành vi cũ, nay có lối ra)", () => {
    expect(phanGiaiNap({ nhaMayId: null, toaNhaId: null, tangId: null }, SAN)).toEqual({
      nhaMayId: 1,
      toaNhaId: 3,
      tangId: 7,
    });
  });

  it("★ id hợp lệ trong danh sách ⇒ ĐƯỢC TÔN TRỌNG (đây là F1: có lối vào)", () => {
    expect(phanGiaiNap({ nhaMayId: 18, toaNhaId: 4, tangId: 9 }, SAN)).toEqual({
      nhaMayId: 18,
      toaNhaId: 4,
      tangId: 9,
    });
  });

  it("★★★ ĐẦU RA KHÁC ĐẦU VÀO — G32: phép biến đổi đồng nhất bị loại trừ", () => {
    // Nếu hàm này chỉ trả về `[0]` bất kể yêu cầu (đúng lỗi lô E đo được) thì
    // hai lời gọi dưới đây phải cho CÙNG kết quả. Chúng phải KHÁC nhau.
    const a = phanGiaiNap({ nhaMayId: 1, toaNhaId: 3, tangId: 7 }, SAN);
    const b = phanGiaiNap({ nhaMayId: 20, toaNhaId: 4, tangId: 9 }, SAN);
    expect(a).not.toEqual(b);
    expect(b.tangId).toBe(9);
  });

  it("id KHÔNG có trong danh sách ⇒ rơi về phần tử đầu (KHÔNG gửi id ma lên server)", () => {
    expect(phanGiaiNap({ nhaMayId: 999, toaNhaId: 999, tangId: 999 }, SAN)).toEqual({
      nhaMayId: 1,
      toaNhaId: 3,
      tangId: 7,
    });
  });

  it("danh sách RỖNG ⇒ null, KHÔNG bịa ra id 0 hay 1", () => {
    const rong: TapCoSan = { nhaMay: [], toaNha: [], tang: [] };
    expect(phanGiaiNap({ nhaMayId: 5, toaNhaId: 5, tangId: 5 }, rong)).toEqual({
      nhaMayId: null,
      toaNhaId: null,
      tangId: null,
    });
  });

  it("ba ô ĐỘC LẬP — một ô hỏng không kéo hai ô kia về mặc định", () => {
    expect(phanGiaiNap({ nhaMayId: 18, toaNhaId: 999, tangId: 9 }, SAN)).toEqual({
      nhaMayId: 18,
      toaNhaId: 3,
      tangId: 9,
    });
  });
});

describe("yeuCauBiBoQua — nói THẲNG khi link cũ trỏ vào thứ đã mất", () => {
  it("mọi id được tôn trọng ⇒ false", () => {
    const yc = { nhaMayId: 18, toaNhaId: 4, tangId: 9 };
    expect(yeuCauBiBoQua(yc, phanGiaiNap(yc, SAN))).toBe(false);
  });

  it("★ một id bị bỏ ⇒ true (người dùng phải biết mình KHÔNG xem thứ đã gửi)", () => {
    const yc = { nhaMayId: null, toaNhaId: null, tangId: 4242 };
    expect(yeuCauBiBoQua(yc, phanGiaiNap(yc, SAN))).toBe(true);
  });

  it("URL không yêu cầu gì ⇒ false, KHÔNG phải 'bị bỏ qua'", () => {
    const yc = { nhaMayId: null, toaNhaId: null, tangId: null };
    expect(yeuCauBiBoQua(yc, phanGiaiNap(yc, SAN))).toBe(false);
  });
});

describe("★★★ tapDoiSoatTheoNap — F2: 373 MÁY BỊ KHAI SAI LÀ 'CHƯA XẾP CHỖ'", () => {
  /*
   * Tái lập CHÍNH ca dương lô E đo được: 549 máy trải 176 / 187 / 186 trên ba
   * tầng, chỉ tầng[0] được nạp. Banner cũ khai 187+186 = 373.
   */
  const may = Array.from({ length: 549 }, (_, i) => i + 1);
  const tang1 = may.slice(0, 176); // 176
  const tang2 = may.slice(176, 363); // 187
  const tang3 = may.slice(363); // 186
  const baTang = [...tang1, ...tang2, ...tang3];

  it("★★★ CA DƯƠNG — mọi máy ĐỀU có chỗ, đang xem tầng 1: banner KHÔNG được khai 373", () => {
    const kq = tapDoiSoatTheoNap(may, tang1, baTang, true);
    // Chỉ 176 máy của tầng đang hiện vào phép đối soát.
    expect(kq.idMay).toHaveLength(176);
    // Đúng 187+186 = 373 máy có nhãn RIÊNG "ở tầng khác" — KHÔNG phải "chưa xếp chỗ".
    expect(kq.soNgoaiLuotNap).toBe(373);
    expect(kq.idMay.some((id) => id > 176)).toBe(false);
  });

  it("★ ĐỔI SANG TẦNG 2 ⇒ tập đối soát ĐỔI THEO (G32: đầu ra khác đầu vào)", () => {
    const t1 = tapDoiSoatTheoNap(may, tang1, baTang, true);
    const t2 = tapDoiSoatTheoNap(may, tang2, baTang, true);
    expect(t1.idMay).not.toEqual(t2.idMay);
    expect(t2.idMay).toHaveLength(187);
    expect(t2.soNgoaiLuotNap).toBe(176 + 186);
  });

  it("★★★ ABLATION lô E — dồn 549 máy vào MỘT tầng ⇒ 0 máy ngoài lượt nạp", () => {
    // Lô E chứng minh nhân quả đúng bằng phép này trên trình duyệt thật:
    // dồn 1 tầng ⇒ banner biến mất; trải 176/187/186 ⇒ trở lại đúng 373.
    const kq = tapDoiSoatTheoNap(may, may, may, true);
    expect(kq.soNgoaiLuotNap).toBe(0);
    expect(kq.idMay).toHaveLength(549);
  });

  it("máy CHƯA có chỗ ở đâu cả VẪN phải vào banner khi mọi toà đã hỏi", () => {
    // 5 máy: 1-3 trên tầng này, 4-5 không có chỗ ở đâu.
    const kq = tapDoiSoatTheoNap([1, 2, 3, 4, 5], [1, 2, 3], [1, 2, 3], true);
    expect(kq.idMay).toEqual([1, 2, 3, 4, 5]);
    expect(kq.soNgoaiLuotNap).toBe(0);
  });

  it("★ CÒN TOÀ CHƯA HỎI ⇒ máy không rõ chỗ bị giữ ngoài (khai 'chưa đo', không khai sai)", () => {
    const kq = tapDoiSoatTheoNap([1, 2, 3, 4, 5], [1, 2, 3], [1, 2, 3], false);
    expect(kq.idMay).toEqual([1, 2, 3]);
    expect(kq.soNgoaiLuotNap).toBe(2);
  });

  it("★ MÁY Ở TẦNG KHÁC không bao giờ vào banner, dù `moiToaDaHoi` thế nào", () => {
    for (const moi of [true, false]) {
      const kq = tapDoiSoatTheoNap([1, 2, 3], [1], [1, 2, 3], moi);
      expect(kq.idMay).toEqual([1]);
      expect(kq.soNgoaiLuotNap).toBe(2);
    }
  });

  it("tập máy rỗng ⇒ rỗng, không ném", () => {
    expect(tapDoiSoatTheoNap([], [], [], true)).toEqual({ idMay: [], soNgoaiLuotNap: 0 });
  });
});

describe("★★★ phamViThuc — F3: `?pv=tapdoan` ĐANG NÓI DỐI", () => {
  it("★ CA DƯƠNG lô E — 4 nhà máy có thật, nạp 1 ⇒ HẠ CẤP và khai rõ", () => {
    const kq = phamViThuc({ cap: "tapDoan", id: null }, 4, 1);
    expect(kq.pv.cap).toBe("nhaMay");
    expect(kq.daHaCap).toBe(true);
    expect(kq.capYeuCau).toBe("tapDoan");
  });

  it("★ ĐỐI CHỨNG — tập đoàn một nhà máy: 'Tập đoàn' là câu ĐÚNG, KHÔNG hạ", () => {
    const kq = phamViThuc({ cap: "tapDoan", id: null }, 1, 1);
    expect(kq.pv.cap).toBe("tapDoan");
    expect(kq.daHaCap).toBe(false);
  });

  it("★★★ NGHIỆM THU §10C.6 mà lô E đo được là ĐANG HỎNG: tạo nhà máy thứ hai PHẢI đổi hành vi", () => {
    // Nếu hàm này bỏ qua `soNhaMayCoThat` (một cài đặt luôn-đúng, G8) thì hai
    // lời gọi này cho cùng kết quả. Chúng phải KHÁC.
    const mot = phamViThuc({ cap: "tapDoan", id: null }, 1, 1);
    const hai = phamViThuc({ cap: "tapDoan", id: null }, 2, 1);
    expect(mot.daHaCap).not.toBe(hai.daHaCap);
  });

  /*
   * ════════════════════════════════════════════════════════════════════════
   * ★★★ ĐO LẠI 2026-09-07 — LỜI KHAI LÔ E ("4 nhà máy, chỉ hiện 1") LÀ **SAI**
   * ════════════════════════════════════════════════════════════════════════
   * Lô E kết luận `?pv=tapdoan` nói dối vì "1.592 máy của 3 nhà máy khác vắng
   * mặt". Đo lại trên DB thật bằng tài khoản lô E đã dùng:
   *
   *   `e2e_tai_loE` id=21075, role=**supervisor** (KHÔNG phải admin)
   *   `user_factory_assignments` → `factoryCode = ['SIM-FAC']` → `factoryIds=[1]`
   *
   * `factory.list` (`hierarchyRouters.ts`) gọi `db.getFactories({userId, userRole})`
   * → `resolveTenantFactoryScope` (`reportAggregators.ts`): vai không-admin có
   * `filter` ⇒ chiếu mã gán xuống `factories.id` ⇒ **1 nhà máy**. Vậy với NGƯỜI
   * DÙNG ĐÓ, `factories.length === 1` và "Tập đoàn = 1 nhà máy" là câu **ĐÚNG**.
   *
   * ⇒ Hàng rào tenant CHẠY ĐÚNG. Cái lô E nhìn thấy không phải lỗi phạm vi mà là
   *   **hàng rào tenant đang làm đúng việc của nó**. `phamViThuc` nhận
   *   `soNhaMayCoThat = factories.length` — tức con số ĐÃ QUA hàng rào — nên nó
   *   không hạ cấp, và đó là hành vi đúng.
   *
   * ⚠ BẪY G9 mà phép đo này suýt dính: câu đếm đầu tiên viết
   *   `a."factoryId"` — cột đó KHÔNG TỒN TẠI (bảng dùng `factoryCode`, chiếu qua
   *   MÃ chứ không qua id). Một câu `left join ... on a."factoryId"=f.id` sẽ ra
   *   0 hàng và "chứng minh" người dùng không được gán nhà máy nào — đúng lớp
   *   BG-127 (mù cấu trúc). Postgres báo `42703` nên nó nổ; nếu lược đồ có sẵn
   *   một cột tên `factoryId` vô nghĩa thì phép đo đã im lặng cho ra số SAI.
   */
  it("★★★ ĐO LẠI F3 — người dùng CHỈ được gán 1 nhà máy: 'Tập đoàn' KHÔNG bị hạ", () => {
    // `factories.length` mà màn nhận ĐÃ qua hàng rào tenant ⇒ 1, không phải 4.
    const kq = phamViThuc({ cap: "tapDoan", id: null }, 1, 1);
    expect(kq.daHaCap).toBe(false);
    expect(kq.pv.cap).toBe("tapDoan");
  });

  it("★ nhưng người dùng ĐA-NHÀ-MÁY nạp 1 ⇒ VẪN hạ (hàng rào rộng ra thì lời khai phải đổi)", () => {
    // Đây là nửa kia của phép đo: nếu ai đó gán thêm nhà máy cho tài khoản,
    // `factory.list` trả 2 và màn PHẢI đổi hành vi. Cặp hai ca này là thứ phân
    // biệt "hàng rào chạy đúng" với "hàm luôn trả false" (G8).
    expect(phamViThuc({ cap: "tapDoan", id: null }, 2, 1).daHaCap).toBe(true);
  });

  it("mọi cấp KHÁC tapDoan đi qua nguyên vẹn", () => {
    for (const cap of ["nhaMay", "tang", "line", "may"] as const) {
      const kq = phamViThuc({ cap, id: 5 }, 4, 1);
      expect(kq.pv).toEqual({ cap, id: 5 });
      expect(kq.daHaCap).toBe(false);
    }
  });
});
