/**
 * zFightingSan.unit.test.ts — PH-51: MẶT SÀN VÀ LƯỚI TRANH NHAU MỘT PIXEL.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * KHUYẾT TẬT — MỘT CENTIMET ĐẤU VỚI NỬA MÉT
 * ════════════════════════════════════════════════════════════════════════════
 * `San` (`CanhVanHanh.tsx`) đặt tấm sàn ở `y = -0.01` và `gridHelper` ở `y = 0`
 * — **cách nhau đúng 1 cm**. Khoảng cách ấy là thứ DUY NHẤT bảo đảm "lưới nằm
 * trên sàn". Nó chỉ có hiệu lực khi z-buffer còn phân biệt nổi 1 cm ở chỗ đó.
 *
 * Độ phân giải z-buffer 24 bit ở khoảng cách `z` (§7.2, cùng công thức mà
 * `loi/catCanh.ts` dùng để suy `near` từ `far`):
 *
 *     Δz ≈ z² × (1/near − 1/far) / (2²⁴ − 1)
 *
 * Với cảnh TẬP ĐOÀN đo được trên dữ liệu QATD (bán kính 1060,4 m ⇒
 * `catCanhTheoBanKinh` cho `near` = 0,5 / `far` = 12.478,5; các toà nằm quanh
 * `z ≈ 2005 m` — chính `camXa` đo sống của `qatd_admin`):
 *
 *     Δz ≈ 2005² × (1/0,5 − 1/12478,5) / 16.777.215 ≈ **0,48 m**
 *
 * tức bước z **lớn gấp ~48 lần** khe hở 1 cm. Hai mặt rơi vào CÙNG một nấc z ⇒
 * mặt nào thắng là chuyện của số dư làm tròn, và số dư ấy đổi theo góc nhìn.
 *
 * ★ Đây KHÔNG phải suy đoán: đo sống trên cổng 3064 (bundle dựng từ chính cây
 *   này), bóp RIÊNG `near` 0,5 → 0,1 — một nhiễu **ĐỘ SÂU THUẦN**, vì `near`/`far`
 *   chỉ nằm ở cột z của ma trận phối cảnh nên KHÔNG dịch một pixel nào của phép
 *   chiếu x/y (mọi đường lưới rơi đúng chỗ cũ, răng cưa lặp lại y hệt):
 *
 *   | vùng sàn thuần 3D          | % pixel ĐỔI BÊN THẮNG |
 *   |----------------------------|-----------------------|
 *   | tập đoàn, khung mặc định   | **42,20 %**           |
 *   | tập đoàn, nhìn xiên 83,7°  | 3,97 %                |
 *   | chụp 2 lần CÙNG bản dựng   | **0,00 %** (nhiễu 0)  |
 *   | ĐỐI CHỨNG: lưới nâng 5 m   | **0,30 %**            |
 *
 *   Dòng ĐỐI CHỨNG là thứ tách z-fighting khỏi **răng cưa lưới**: nâng lưới lên
 *   5 m làm z-fighting BẤT KHẢ mà GIỮ NGUYÊN mật độ lưới (ô 5 m trên sàn 1.060 m,
 *   đường lưới vẫn cách nhau ~2 px). Độ nhạy sụp từ 42,20 % xuống 0,30 % ⇒ con số
 *   ấy là hai mặt tranh nhau, không phải lưới quá dày.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ VÌ SAO BẢN VÁ LÀ `polygonOffset` CHỨ KHÔNG PHẢI NÂNG KHE HỞ
 * ════════════════════════════════════════════════════════════════════════════
 * Khe hở là một con số tính bằng **MÉT**; bước z là một con số tính bằng **MÉT
 * NHƯNG PHỤ THUỘC z²** — và `z` là khoảng cách camera, thứ người dùng đổi bằng
 * con lăn chuột. Một khe hở đủ ở khung mặc định (cần > 0,48 m) KHÔNG đủ ở trần
 * zoom (`camXa` đo được 8.975 m ⇒ cần > 9,6 m), và một khe hở đủ ở trần zoom là
 * một khe nhìn thấy được khi zoom vào. **Không hằng số mét nào đúng ở mọi nấc
 * zoom** — đó là lý do kỹ thuật, không phải sở thích.
 *
 * `polygonOffset` nói bằng ĐÚNG đơn vị của vấn đề: `units` đếm theo bước z nhỏ
 * nhất còn phân biệt được TẠI CHÍNH độ sâu ấy, nên nó tự co giãn theo `z`,
 * theo `near`/`far` và theo góc nghiêng (`factor` × độ dốc) mà không ai phải
 * chỉnh lại khi `catCanh.ts` đổi số.
 *
 * ĐO, KHÔNG SUY — cả ba ứng viên đều được dựng và đo trên cùng bundle:
 *   | ứng viên                            | % đổi bên thắng (tập đoàn, mặc định) | hệ quả khác |
 *   |-------------------------------------|--------------------------------------|-------------|
 *   | (chưa vá)                           | 42,20 %                              | —           |
 *   | (A) khe hở theo cỡ cảnh `canh/400`  | 0,34 %                               | **dịch đường bao tấm sàn** — 2.006 px liền khối đổi ở màn Máy |
 *   | (B) `polygonOffset` 1/1 ← CHỌN      | 0,34 %                               | 0 thay đổi hình học |
 *   | (C) lưới `depthTest:false`          | 0,00 %                               | **lưới vẽ ĐÈ lên khối máy và vòng an toàn** |
 * `polygonOffsetUnits` 4 cho ảnh **giống hệt** 1 (0,00 % lệch) ⇒ 1 là đủ.
 *
 * Lưới dưới đây ghim BA điều: phép tính vật lý (vì sao 1 cm không đủ), bản vá
 * có mặt ở đúng vật liệu sàn, và ứng viên (C) ĐÃ BỊ BÁC BỎ không được lẻn vào.
 */
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { docMaNguon } from "@shared/testing/docMaNguon";

import { catCanhTheoBanKinh } from "../loi/catCanh";

const GOC = resolve(__dirname, "../../../../..");
const TEP_SAN = resolve(GOC, "client/src/components/twin3d/van-hanh/CanhVanHanh.tsx");

/** Khe hở hình học giữa tấm sàn (`y = -0.01`) và `gridHelper` (`y = 0`), mét. */
const KHE_HO_SAN_LUOI_M = 0.01;

/** Số nấc của z-buffer 24 bit. */
const NAC_Z_24BIT = 2 ** 24 - 1;

/** Bước z nhỏ nhất còn phân biệt được ở khoảng cách `z` (§7.2). */
function buocZ(z: number, near: number, far: number): number {
  return (z * z * (1 / near - 1 / far)) / NAC_Z_24BIT;
}

describe("PH-51 — vì sao khe hở 1 cm KHÔNG giữ nổi lưới trên sàn", () => {
  it("ở cỡ tập đoàn, bước z lớn hơn khe hở hàng chục lần", () => {
    // Bán kính sa bàn tập đoàn QATD đo sống: 1060,4 m.
    const { near, far } = catCanhTheoBanKinh(1060.4);
    expect(near).toBe(0.5);
    expect(Math.round(far)).toBe(12479);

    // `camXa` đo sống của `qatd_admin` ở khung mặc định.
    const buoc = buocZ(2005.681, near, far);
    expect(buoc).toBeGreaterThan(0.4);
    expect(buoc).toBeLessThan(0.6);
    // Đây là con số làm khuyết tật tồn tại: khe hở nhỏ hơn bước z ~48 lần.
    expect(buoc / KHE_HO_SAN_LUOI_M).toBeGreaterThan(40);
  });

  it("ĐỐI CHỨNG DƯƠNG của chính phép tính: ở cảnh MÁY, khe hở 1 cm vẫn thừa sức", () => {
    // Không có đối chứng này thì `buocZ` chỉ cần trả một số to là lưới luôn xanh.
    const { near, far } = catCanhTheoBanKinh(20);
    expect(near).toBe(0.1);
    expect(far).toBe(2000);
    // `camXa` đo sống của màn Máy: 19,407 m.
    expect(buocZ(19.407, near, far)).toBeLessThan(KHE_HO_SAN_LUOI_M / 10);
  });

  it("KHÔNG hằng số MÉT nào đúng ở mọi nấc zoom — khe hở đủ ở khung mặc định thiếu ở trần zoom", () => {
    const { near, far } = catCanhTheoBanKinh(1060.4);
    const oKhungMacDinh = buocZ(2005.681, near, far);
    // `camXa` đo sống ở TRẦN ZOOM của cùng vai: 8975,024 m.
    const oTranZoom = buocZ(8975.024, near, far);
    expect(oTranZoom / oKhungMacDinh).toBeGreaterThan(15);
    // Đó là lý do bản vá phải nói bằng đơn vị BƯỚC Z, không bằng mét.
  });
});

describe("PH-51 — bản vá nằm ở vật liệu SÀN, và ứng viên đã bị bác bỏ không lẻn vào", () => {
  const nguon = () => docMaNguon(TEP_SAN);

  /** Thân hàm `San` — cắt theo hai mốc văn bản, để lưới không đo nhầm chỗ khác. */
  function thanSan(s: string): string {
    const dau = s.indexOf("function San(");
    expect(dau).toBeGreaterThan(-1);
    const cuoi = s.indexOf("\n}", dau);
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
    // Nếu ai đó vừa nâng khe hở vừa thêm polygonOffset thì hai cơ chế che nhau và
    // lần gỡ sau sẽ không ai biết cái nào đang gánh.
    expect(thanSan(nguon())).toContain("-0.01");
  });

  it("ỨNG VIÊN (C) BỊ BÁC BỎ: lưới KHÔNG được tắt depth-test (đo được: vẽ đè lên khối máy)", () => {
    const than = thanSan(nguon());
    expect(than).not.toContain("depthTest");
    expect(than).not.toContain("depthWrite");
  });
});
