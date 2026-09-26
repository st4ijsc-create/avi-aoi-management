/**
 * zFightingSanStudio.unit.test.ts — PH-52: MÀN STUDIO CÙNG KHUYẾT TẬT PH-51.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * KHUYẾT TẬT
 * ════════════════════════════════════════════════════════════════════════════
 * `San` (`CanhThietKe.tsx`) đặt tấm sàn ở `y = -0.01` và `gridHelper` ở `y = 0`
 * — **khe hở 1 cm**, đúng cặp số PH-51 đã chứng minh là không đủ ở `CanhVanHanh`.
 *
 * ★★★ Ở ĐÂY THƯỚC "ĐỔI BÊN THẮNG" GẦN NHƯ MÙ — VÀ ĐÓ LÀ ĐIỀU PHẢI GHI LẠI.
 * Studio là cảnh nhỏ (`far` = 2000, `near` = 0,1, `camXa` đo sống 117,054 m), bước
 * z ở đó chỉ ~0,08 cm — **nhỏ hơn** khe hở 1 cm. Theo phép tính thì lưới phải
 * thắng, và thước "đổi bên thắng" quả thật chỉ đọc 2,37 %. Nhưng đo bằng thước
 * "lưới vẽ ĐỦ" thì **59,21 %** pixel vùng sàn thiếu lưới. Hai điều đó chỉ cùng
 * đúng nếu lưới **thua ỔN ĐỊNH**: không phải hai mặt thay nhau thắng theo góc
 * nhìn, mà là đường lưới bị nuốt đều đều.
 *
 * ⇒ Lưới dưới đây KHÔNG khẳng định "bước z lớn hơn khe hở" (ở Studio thì không),
 *   nó ghim ba thứ khác: (1) `camXa` đổi 3,1 lần trong tầm zoom nên **không hằng
 *   số mét nào** đúng ở mọi nấc — lý do bản vá phải nói bằng bước z; (2) bản vá
 *   nằm đúng ở vật liệu sàn; (3) ứng viên đã bị PH-51 bác bỏ không lẻn vào.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * SỐ ĐO SỐNG (cổng 3077, Chromium `--use-angle=default --enable-gpu
 * --ignore-gpu-blocklist` = ANGLE/GPU thật, KHÔNG SwiftShader; canvas 540×251)
 * ════════════════════════════════════════════════════════════════════════════
 *   | vùng sàn thuần 3D    | thước "lưới vẽ đủ" TRƯỚC | SAU    | thước "đổi bên thắng" |
 *   |----------------------|--------------------------|--------|-----------------------|
 *   | ST-A khung mặc định  | 59,21 %                  | 0,00 % | 2,37 % → 0,00 %       |
 *   | ST-B khung mặc định  | 60,47 %                  | 1,78 % | 2,87 % → 0,03 %       |
 *   | ST-E nhìn xiên       | 34,96 %                  | 0,63 % | 0,18 % → 0,00 %       |
 *   | ST-F trần zoom       |  1,02 %                  | 0,30 % | 0,49 % → 0,01 %       |
 *   | chụp 2 lần CÙNG bản dựng (nhiễu thiết bị đo)    | **0,00 %** ở cả 4 vùng   |
 *   | ĐỐI CHỨNG lưới nâng 5 m + cùng nhiễu            | 0,00 / 0,03 / 0,00 / 0,03 % |
 *
 * Dư 1,78 / 0,63 / 0,30 % ở cột SAU bằng ĐÚNG mức hai oracle độc lập lệch nhau,
 * nên nó là sai số của oracle chứ không phải lưới còn bị ăn.
 */
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { docMaNguon } from "@shared/testing/docMaNguon";

import { catCanhTheoBanKinh, nearTheoFar } from "../loi/catCanh";

const GOC = resolve(__dirname, "../../../../..");
const TEP_SAN = resolve(GOC, "client/src/components/twin3d/thiet-ke/CanhThietKe.tsx");

/** Khe hở hình học giữa tấm sàn (`y = -0.01`) và `gridHelper` (`y = 0`), mét. */
const KHE_HO_SAN_LUOI_M = 0.01;

/** Số nấc của z-buffer 24 bit. */
const NAC_Z_24BIT = 2 ** 24 - 1;

/** Bước z nhỏ nhất còn phân biệt được ở khoảng cách `z` (§7.2). */
function buocZ(z: number, near: number, far: number): number {
  return (z * z * (1 / near - 1 / far)) / NAC_Z_24BIT;
}

/** `camXa` đo sống của Studio trên dữ liệu QATD: khung mặc định và trần zoom. */
const CAM_XA_MAC_DINH_M = 117.054;
const CAM_XA_TRAN_ZOOM_M = 365.199;

/**
 * `far` của Studio KHÔNG đi qua `farTheoBanKinh`: `CanhThietKe` tự tính
 * `max(2000, max(rộng, sâu) × 8)` rồi `KhungCanh` suy `near` từ nó. Đo sống trên
 * dữ liệu QATD: `far` = 2000, `near` = 0,1 ⇒ mặt sàn Studio ≤ 250 m.
 */
const FAR_STUDIO_DO_SONG = 2000;

describe("PH-52 · Studio — vì sao KHÔNG hằng số mét nào đóng được ở mọi nấc zoom", () => {
  it("cặp `near`/`far` của Studio đúng là cặp của cảnh nhỏ", () => {
    // Ghim ở đây để nếu ai đổi `catCanh.ts` thì mọi con số dưới phải đo lại.
    expect(nearTheoFar(FAR_STUDIO_DO_SONG)).toBe(0.1);
  });

  it("bước z đổi ~9,7 lần chỉ trong tầm zoom của CHÍNH màn này", () => {
    const near = nearTheoFar(FAR_STUDIO_DO_SONG);
    const oMacDinh = buocZ(CAM_XA_MAC_DINH_M, near, FAR_STUDIO_DO_SONG);
    const oTranZoom = buocZ(CAM_XA_TRAN_ZOOM_M, near, FAR_STUDIO_DO_SONG);
    expect(oTranZoom / oMacDinh).toBeGreaterThan(9);
    expect(oTranZoom / oMacDinh).toBeLessThan(11);
    // Đó là lý do bản vá phải nói bằng đơn vị BƯỚC Z, không bằng mét.
  });

  it("★ GHI THẲNG: ở Studio bước z NHỎ HƠN khe hở — nên phép tính KHÔNG giải thích được khuyết tật", () => {
    // Không có ca này thì lưới đang ngầm khai "cùng nguyên nhân với PH-51", mà
    // số đo nói khác: 59,21 % lưới bị ăn TRONG KHI bước z chỉ bằng ~8 % khe hở.
    const buoc = buocZ(CAM_XA_MAC_DINH_M, nearTheoFar(FAR_STUDIO_DO_SONG), FAR_STUDIO_DO_SONG);
    expect(buoc).toBeLessThan(KHE_HO_SAN_LUOI_M);
    // Thứ đóng được khuyết tật ở đây là PHÉP ĐO, không phải phép tính.
  });

  it("ĐỐI CHỨNG DƯƠNG của chính `buocZ`: ở cỡ tập đoàn nó PHẢI vượt khe hở", () => {
    // Nếu thiếu ca này thì `buocZ` chỉ cần luôn trả một số bé là ca trên luôn xanh.
    const { near, far } = catCanhTheoBanKinh(1060.4);
    expect(buocZ(2005.681, near, far) / KHE_HO_SAN_LUOI_M).toBeGreaterThan(40);
  });
});

describe("PH-52 · Studio — bản vá nằm ở vật liệu SÀN, ứng viên bị bác bỏ không lẻn vào", () => {
  const nguon = () => docMaNguon(TEP_SAN);

  /**
   * Thân hàm `San` — cắt theo hai mốc văn bản, để lưới không đo nhầm chỗ khác.
   *
   * ⚠ Mốc cuối là `"\n}\n"` (một dòng CHỈ có dấu `}`), KHÔNG phải `"\n}"`: chữ ký
   *   của `San` ở tệp này huỷ-cấu-trúc nhiều dòng nên có `\n}: {` và `\n}) {` nằm
   *   TRƯỚC thân hàm — mốc `"\n}"` cắt ngay ở chữ ký và mọi khẳng định sau đó chạy
   *   trên một lát cắt rỗng. Chính ca "đối chứng dương" dưới đây đã bắt được.
   */
  function thanSan(s: string): string {
    const dau = s.indexOf("function San(");
    expect(dau).toBeGreaterThan(-1);
    const cuoi = s.indexOf("\n}\n", dau);
    expect(cuoi).toBeGreaterThan(dau);
    return s.slice(dau, cuoi);
  }

  it("đối chứng dương: lát cắt thân `San` CÓ cả tấm sàn lẫn `gridHelper`", () => {
    // Nếu hai mốc văn bản trượt, mọi khẳng định dưới đây thành xanh-trên-tập-rỗng.
    const than = thanSan(nguon());
    expect(than).toContain("<planeGeometry");
    expect(than).toContain("<gridHelper");
    expect(than.length).toBeGreaterThan(200);
  });

  it("vật liệu sàn khai `polygonOffset` — đẩy sàn ra sau ĐÚNG MỘT bước z", () => {
    const than = thanSan(nguon());
    const vatLieu = than.slice(than.indexOf("<meshStandardMaterial"), than.indexOf("</mesh>"));
    expect(vatLieu).toContain("polygonOffset");
    expect(vatLieu).toContain("polygonOffsetFactor");
    expect(vatLieu).toContain("polygonOffsetUnits");
  });

  it("khe hở hình học 1 cm GIỮ NGUYÊN — bản vá thêm hàng rào, không thay hàng rào", () => {
    // Vừa nâng khe hở vừa thêm polygonOffset thì hai cơ chế che nhau và lần gỡ
    // sau sẽ không ai biết cái nào đang gánh.
    expect(thanSan(nguon())).toContain("-0.01");
  });

  it("ỨNG VIÊN (C) BỊ BÁC BỎ: lưới KHÔNG được tắt depth-test (PH-51 đo được: vẽ đè khối máy)", () => {
    const than = thanSan(nguon());
    expect(than).not.toContain("depthTest");
    expect(than).not.toContain("depthWrite");
  });
});
