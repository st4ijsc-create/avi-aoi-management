/**
 * buocLuoi.unit.test.ts — LƯỚI CHO BƯỚC LƯỚI SÀN THEO MÀN HÌNH (PH-54).
 *
 * Trọng tâm không phải "hàm trả đúng số" mà là BA BẤT BIẾN mà bản vá bán:
 *  ① ô ≥ 8 px ở MỌI khoảng cách — không phải ở ba mẫu tôi tình cờ đo;
 *  ② không bao giờ làm lưới DÀY hơn bản đang chạy (sàn = bước gốc);
 *  ③ trễ một chiều: làm thưa NGAY, làm dày CHẬM ⇒ ① không vỡ ở khung chuyển nấc.
 */
import { describe, it, expect } from "vitest";
import {
  O_TOI_THIEU_PX,
  O_TOI_THIEU_CUA_LUOI,
  buocThucTheoSoO,
  THANG_BUOC,
  thangTran,
  pxTrenMet,
  buocLuoiTheoManHinh,
  buocKeTiep,
  khoangCachToiDiemNgam,
  DEM_LAM_DAY,
} from "./buocLuoi";

/** Năm cảnh THẬT, số đo sống trên `ca088198` (`.qa-tapdoan/ph54/tho/do-nen.json`). */
const CANH_THAT = [
  { ten: "fc-tapdoan", caoPx: 529, buocGoc: 2, dMin: 4, dMax: 2049.975 },
  { ten: "fc-motnhamay", caoPx: 529, buocGoc: 2, dMin: 4, dMax: 743.234 },
  { ten: "twin-tapdoan", caoPx: 489, buocGoc: 5, dMin: 563.773, dMax: 8975.024 },
  { ten: "twin-motnhamay", caoPx: 489, buocGoc: 5, dMin: 42.4, dMax: 918.601 },
  { ten: "studio", caoPx: 251, buocGoc: 1, dMin: 42.687, dMax: 365.199 },
];
const FOV = 45;

describe("thangTran — thang bản đồ 1/2/5/10", () => {
  it("trả nấc nhỏ nhất ≥ x", () => {
    expect(thangTran(1)).toBe(1);
    expect(thangTran(1.0001)).toBe(2);
    expect(thangTran(2)).toBe(2);
    expect(thangTran(2.3)).toBe(5);
    expect(thangTran(27.18)).toBe(50);
  });
  it("bội nhảy giữa hai nấc liền kề KHÔNG QUÁ 2,5 — đây là thứ chặn TRÊN dải px", () => {
    for (let i = 1; i < THANG_BUOC.length; i += 1)
      expect(THANG_BUOC[i] / THANG_BUOC[i - 1]).toBeLessThanOrEqual(2.5 + 1e-9);
  });
});

describe("★ BẤT BIẾN ① — ô ≥ 8 px ở MỌI khoảng cách trong dải zoom thật", () => {
  for (const c of CANH_THAT) {
    it(`${c.ten}: quét 400 nấc d ∈ [${c.dMin}, ${c.dMax}]`, () => {
      let xauNhat = Infinity;
      for (let i = 0; i <= 400; i += 1) {
        const d = c.dMin * (c.dMax / c.dMin) ** (i / 400); // quét ĐỀU theo log
        const b = buocLuoiTheoManHinh({ d, caoPx: c.caoPx, fovDoc: FOV, buocGoc: c.buocGoc });
        const o = b * pxTrenMet(c.caoPx, d, FOV);
        xauNhat = Math.min(xauNhat, o);
      }
      expect(xauNhat).toBeGreaterThanOrEqual(O_TOI_THIEU_PX);
    });
  }
});

describe("★ ĐỐI CHỨNG DƯƠNG — lưới phải BIẾT KÊU trên bản CHƯA VÁ", () => {
  it("bước HẰNG (cách cũ) TỤT dưới 8 px ở 4/5 màn — nếu ca này xanh thì lưới trên vô nghĩa", () => {
    const hong = CANH_THAT.filter((c) => {
      const oMacDinh = c.buocGoc * pxTrenMet(c.caoPx, c.dMax, FOV);
      return oMacDinh < O_TOI_THIEU_PX;
    });
    expect(hong.length).toBe(5); // ở TRẦN ZOOM cả 5 màn đều hỏng khi bước là hằng
  });
});

describe("★ BẤT BIẾN ② — chỉ làm THƯA, không bao giờ làm DÀY", () => {
  for (const c of CANH_THAT) {
    it(`${c.ten}: bước luôn ≥ bước gốc ${c.buocGoc} m`, () => {
      for (let i = 0; i <= 200; i += 1) {
        const d = c.dMin * (c.dMax / c.dMin) ** (i / 200);
        expect(buocLuoiTheoManHinh({ d, caoPx: c.caoPx, fovDoc: FOV, buocGoc: c.buocGoc }))
          .toBeGreaterThanOrEqual(c.buocGoc);
      }
    });
  }
  it("ở zoom rất gần, bước TRẢ VỀ ĐÚNG bước gốc (diện mạo hôm nay không đổi)", () => {
    expect(buocLuoiTheoManHinh({ d: 20, caoPx: 489, fovDoc: FOV, buocGoc: 5 })).toBe(5);
  });
});

describe("★ BẤT BIẾN ③ — trễ MỘT CHIỀU", () => {
  const nen = { caoPx: 489, fovDoc: FOV, buocGoc: 5 };

  /**
   * ★★★ 2026-09-17 — RANH GIỚI SUY TỪ HẰNG, KHÔNG VIẾT CỨNG SỐ 8.
   *
   * Ba chỗ dưới đây từng viết thẳng `(nac * 489) / (8 * 2 * tan(fov/2))`. Con số
   * `8` ấy **là chính `O_TOI_THIEU_PX`** — nhưng chép tay. Chủ đợt thử nâng hằng
   * lên 10 (agent đo được là "miễn phí": nó nâng đúng hai ca sát ngưỡng 8,59→17,2
   * và 8,30→16,6, tám ca kia y nguyên) và **hai ca ở đây ĐỎ** — không phải vì sản
   * phẩm sai, mà vì ranh giới trong LƯỚI không đi theo hằng.
   *
   * Một phép đo mà hằng số của nó chép tay thì nó **đo một thế giới khác** với
   * thứ nó định canh, ngay khi ai đó đổi hằng. Đây đúng lớp lỗi đợt này đã gặp ở
   * `HE_SO_LUI` (ô T-2 phải đo `lui` ĐỘC LẬP từ hình học rồi mới so với hằng).
   *
   * ★ Giữ cho ô còn sức: hàm này **không đọc lại** cách tính của sản phẩm, nó
   *   dựng lại công thức từ đầu (`nac·caoPx / (O·2·tan(fov/2))`) và chỉ mượn
   *   **một** hằng. Nếu sản phẩm đổi công thức thì ô vẫn kêu.
   */
  const dRanhCua = (nac: number) =>
    (nac * nen.caoPx) / (O_TOI_THIEU_PX * 2 * Math.tan((FOV / 2 / 180) * Math.PI));
  it("cần thưa hơn ⇒ đổi NGAY (không được trễ, kẻo một khung hình có ô < 8 px)", () => {
    const b = buocKeTiep(5, { ...nen, d: 2005.681 });
    expect(b).toBe(50);
  });
  it("cần dày hơn ⇒ KHÔNG đổi ngay khi vừa chớm qua ranh giới", () => {
    // d sao cho `thangTran` vừa rơi xuống nấc dưới, nhưng chưa vượt đệm
    const dRanh = dRanhCua(20); // ô = O_TOI_THIEU_PX px đúng ở bước 20
    const ngayDuoi = dRanh * 0.999;
    expect(buocLuoiTheoManHinh({ ...nen, d: ngayDuoi })).toBe(20);
    expect(buocKeTiep(50, { ...nen, d: ngayDuoi })).toBe(50); // giữ nấc cũ, chưa vào hẳn
  });
  it("cuộn thêm một quãng THẬT thì mới làm dày", () => {
    const dRanh = dRanhCua(20);
    expect(buocKeTiep(50, { ...nen, d: dRanh / (DEM_LAM_DAY * 1.2) })).toBeLessThan(50);
  });
  it("★ KHÔNG NHẤP NHÁY: rung ±0,5 % quanh MỌI ranh giới không lật bước lần nào", () => {
    let buoc: number | null = null;
    let doi = 0;
    for (const nac of [2, 5, 10, 20, 50, 100]) {
      const dRanh = dRanhCua(nac);
      for (let i = 0; i < 60; i += 1) {
        const d = dRanh * (1 + (i % 2 === 0 ? 0.005 : -0.005));
        const moi = buocKeTiep(buoc, { ...nen, d });
        if (buoc != null && moi !== buoc) doi += 1;
        buoc = moi;
      }
    }
    // rung quanh 6 ranh giới ⇒ tối đa 6 lần đổi HỢP LỆ (đi qua nấc), không được nhiều hơn
    expect(doi).toBeLessThanOrEqual(6);
  });
});

describe("khoangCachToiDiemNgam — điểm ngắm trên sàn, không phải gốc toạ độ", () => {
  it("nhìn thẳng xuống: d = độ cao", () => {
    expect(khoangCachToiDiemNgam({ x: 0, y: 100, z: 0 }, { x: 0, y: -1, z: 0 })).toBeCloseTo(100, 6);
  });
  it("target ở gốc ⇒ TRÙNG `|camera.position|` (nên số đo của thước hình học vẫn đúng)", () => {
    const p = { x: 60, y: 60, z: 60 };
    const r = Math.hypot(p.x, p.y, p.z);
    const h = { x: -p.x / r, y: -p.y / r, z: -p.z / r }; // nhìn về gốc
    expect(khoangCachToiDiemNgam(p, h)).toBeCloseTo(r, 4);
  });
  it("nhìn NGANG đường chân trời KHÔNG cho ra vô cực (bị kẹp)", () => {
    const d = khoangCachToiDiemNgam({ x: 0, y: 50, z: 0 }, { x: 1, y: -1e-9, z: 0 });
    expect(Number.isFinite(d)).toBe(true);
    expect(d).toBeLessThanOrEqual(50 * 4 + 1e-6);
  });
});

describe("★★★ ⑤ LƯỢNG TỬ HOÁ về số ô nguyên — sai số phải rơi về PHÍA AN TOÀN", () => {
  /**
   * ⚠ Ô này lấp một khoảng trống agent PH-54 **tự khai**: *"`lamTron` chưa có
   * lưới đơn vị — chỉ được xác nhận qua số sống (50,495 ≥ 50; 212,08 ≥ 200)"*.
   * Hai con số ấy đúng chiều, nhưng hai mẫu không phải một bất biến.
   *
   * ★ Vì sao nó quan trọng: `gridHelper` nhận một SỐ Ô NGUYÊN, nên bước THẬT là
   *   `canh / soO`, không phải bước mà thang màn hình vừa chọn. Làm tròn gần nhất
   *   sẽ cho bước thật **nhỏ hơn** bước đã chọn ⇒ ô trên màn tụt **dưới** ngưỡng
   *   ⇒ bất biến ① bị phá **ở đúng chỗ không ai nhìn**.
   *
   * ★ Biểu thức này từng **chép nguyên văn ở HAI tệp cảnh** (đã đối chiếu: giống
   *   hệt từng ký tự). Đã gom về `buocThucTheoSoO`; ô này ghim nó.
   */
  const CANH = [37, 110, 673, 1_060.4, 2_240, 28_920]; // cạnh sàn THẬT đã đo trong đợt

  it("★ bước thật LUÔN ≥ bước được chọn — quét 6 cạnh × 40 bước", () => {
    let soLan = 0;
    for (const canh of CANH) {
      const buocGoc = canh / Math.max(4, Math.round(canh / 5));
      for (let i = 1; i <= 40; i += 1) {
        const b = (canh / 4) * (i / 40); // trải từ rất mịn tới chạm trần 4 ô
        if (b === buocGoc) continue;
        const thuc = buocThucTheoSoO(canh, buocGoc, b);
        expect(thuc, `canh=${canh} b=${b}`).toBeGreaterThanOrEqual(b);
        soLan += 1;
      }
    }
    // KÍCH THƯỚC đầu vào khẳng định TRƯỚC kết cục: một vòng lặp rỗng sẽ xanh giả.
    expect(soLan).toBeGreaterThan(200);
  });

  it("★ ĐỐI CHỨNG BIẾT KÊU — làm tròn GẦN NHẤT thì bất biến VỠ", () => {
    // Cùng dữ liệu, chỉ đổi `floor` thành `round`: phải tìm được ca bước thật < b.
    const ganNhat = (canh: number, b: number) => canh / Math.max(4, Math.round(canh / b));
    let soCaVo = 0;
    for (const canh of CANH) {
      for (let i = 1; i <= 40; i += 1) {
        const b = (canh / 4) * (i / 40);
        if (ganNhat(canh, b) < b - 1e-9) soCaVo += 1;
      }
    }
    expect(soCaVo, "nếu 0 thì phép đo này không phân biệt được hai cách làm tròn").toBeGreaterThan(
      0,
    );
  });

  it("★ đường KHÔNG-LÀM-THƯA trả về đúng bước cũ — bản vá không đụng thứ nó không sửa", () => {
    for (const canh of CANH) {
      const buocGoc = canh / Math.max(4, Math.round(canh / 5));
      expect(buocThucTheoSoO(canh, buocGoc, buocGoc)).toBe(buocGoc);
    }
  });

  it("★ sàn 4 ô — lưới không bao giờ thưa tới mức không còn là lưới", () => {
    const canh = 1_060.4;
    const buocGoc = canh / Math.max(4, Math.round(canh / 5));
    // bước lớn hơn cả tấm sàn ⇒ vẫn phải còn đúng 4 ô
    const thuc = buocThucTheoSoO(canh, buocGoc, canh * 10);
    expect(canh / thuc).toBeCloseTo(O_TOI_THIEU_CUA_LUOI, 9);
  });
});
