/**
 * zFightingSanNhaMay.unit.test.ts — PH-52: `/factory-command` CÙNG LỚP LỖI,
 * NHƯNG **KHÔNG CÙNG BẢN VÁ** — và đó là kết luận của phép đo, không của khẩu vị.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * KHUYẾT TẬT
 * ════════════════════════════════════════════════════════════════════════════
 * `NoiDungCanh` (`CanhNhaMay.tsx`) đặt tấm sàn ở `y = -0.02` và drei `<Grid>` ở
 * `y = 0` — khe hở **2 cm**. Đo sống trên cổng 3077 (bundle dựng từ chính cây
 * này, Chromium `--use-angle=default --enable-gpu --ignore-gpu-blocklist` =
 * ANGLE/GPU thật; canvas 634×529), thước **"lưới vẽ ĐỦ"** (% pixel vùng sàn thuần
 * khác với oracle lưới-tắt-depth-test):
 *
 *   | vùng                                   | TRƯỚC   | SAU    |
 *   |----------------------------------------|---------|--------|
 *   | FCTD-E tập đoàn, nhìn xiên             | 96,34 % | 0,00 % |
 *   | FCNM-E một nhà máy, nhìn xiên          | 56,32 % | 0,00 % |
 *   | FCTD-A/B tập đoàn, khung mặc định      |  0,00 % | 0,00 % |
 *   | FCNM-A/B một nhà máy, khung mặc định   |  0,00 % | 0,00 % |
 *   | chụp 2 lần CÙNG bản dựng (nhiễu đo)    | **0,00 %** ở cả 6 vùng |
 *
 * 96,34 % nghĩa là: **nghiêng camera xuống thì TOÀN BỘ lưới sàn biến mất** — mặt
 * sàn thành một tấm đen phẳng. Không phải loang lổ, mà mất hẳn.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ VÌ SAO `polygonOffset` (bản vá PH-51) **KHÔNG** MUA ĐƯỢC GÌ Ở ĐÂY
 * ════════════════════════════════════════════════════════════════════════════
 * `<Grid infiniteGrid>` của drei nhân toạ độ đỉnh với `1 + fadeDistance`
 * (`@react-three/drei/core/Grid.js`). Với `args = banKinh*4` và
 * `fadeDistance = banKinh*5`, tấm lưới rộng `banKinh*4 × (1 + banKinh*5)` — ở cỡ
 * tập đoàn QATD (`banKinh` = 410 m) là **3,36 TRIỆU mét**, trong khi `far` chỉ
 * 8.200 m. Một tứ giác như thế vắt qua cả `near` lẫn `far`; độ sâu nội suy của nó
 * sai **hàng mét**. `polygonOffset` đếm theo MỘT bước z nên không với tới.
 *
 *   | ứng viên                              | FCTD-E  | FCNM-E  |
 *   |---------------------------------------|---------|---------|
 *   | (chưa vá)                             | 96,34 % | 56,32 % |
 *   | sàn `polygonOffset` 1/1 (cách PH-51)  | 96,34 % | 56,32 % |
 *   | lưới `polygonOffset` −1/−1            | 96,34 % | 56,32 % |
 *   | lưới `polygonOffset` −8/−8            | 96,34 % | 31,69 % |
 *   | thu nhỏ tấm lưới (bỏ `infiniteGrid`)  |  0,49 % |  0,00 % ⚠ |
 *   | **sàn `depthWrite: false` ← CHỌN**    |  0,00 % |  0,00 % |
 *
 * ⚠ Thu nhỏ tấm lưới chữa khung xiên nhưng **làm hỏng khung mặc định** ở cỡ một
 *   nhà máy (0 % → 43,60 % và 52,76 %): hết sai-vì-tấm-khổng-lồ thì lộ ra
 *   z-fighting cổ điển (khe 2 cm vs bước z 7,5 cm). Nó đổi khuyết tật lấy khuyết
 *   tật. `depthWrite: false` bỏ hẳn cuộc tranh chấp nên không phụ thuộc bước z.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ HAI ĐIỀU PHẢI GHI THẲNG VỀ CHÍNH THIẾT BỊ ĐO
 * ════════════════════════════════════════════════════════════════════════════
 * 1. Thước "đổi bên thắng" (bóp riêng `near`) của PH-51 **KHÔNG DÙNG ĐƯỢC** cho
 *    khung xiên của màn này. Lý lẽ của PH-51 — "`near`/`far` chỉ nằm ở cột z nên
 *    không dịch pixel nào" — chỉ đúng khi tam giác KHÔNG bị cắt. Tấm lưới 3,36
 *    triệu mét thì bị cắt, và vị trí đỉnh cắt phụ thuộc `near`. Đo được: cho CẢ
 *    HAI bên tắt depth-test của lưới (không thể còn tranh chấp độ sâu) rồi chỉ
 *    đổi `near` — vùng FCTD-E vẫn đổi **96,34 %**. Tức ở đó thước tự-bác-bỏ.
 *    Ở 5 vùng còn lại phép thử ấy cho **0,00 %** nên thước vẫn hợp lệ.
 * 2. Hai oracle ĐỘC LẬP (lưới tắt depth-test · sàn tắt depth-write) cho ảnh
 *    **giống nhau 0,00 %** ở cả 6 vùng ⇒ oracle không phải là biến của phép đo.
 *
 * Hazard đã đo: tắt `depthWrite` của sàn KHÔNG mở ra vật nào bị lộ. Toàn khung
 * hình đổi 0,00 % ở khung mặc định (cả hai cỡ cảnh); ở khung zoom sâu vào giữa lô
 * máy đổi 4,72 % và **toàn bộ** phần đổi nằm trên mặt sàn HỞ, 0 pixel trên khối máy.
 */
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { docMaNguon } from "@shared/testing/docMaNguon";

import { nearTheoFar } from "./catCanh";

const GOC = resolve(__dirname, "../../../../..");
const TEP = resolve(GOC, "client/src/components/twin3d/loi/CanhNhaMay.tsx");

/** Số nấc của z-buffer 24 bit. */
const NAC_Z_24BIT = 2 ** 24 - 1;

/** Bước z nhỏ nhất còn phân biệt được ở khoảng cách `z` (§7.2). */
function buocZ(z: number, near: number, far: number): number {
  return (z * z * (1 / near - 1 / far)) / NAC_Z_24BIT;
}

/** Đo sống trên dữ liệu QATD, vai `qatd_admin`, `/factory-command` ở chế độ 3D. */
const TAP_DOAN = { banKinh: 409.995, far: 8199.902, camXa: 1199.094 };
const MOT_NHA_MAY = { banKinh: 148.647, far: 2972.937, camXa: 434.741 };

/** Khe hở hình học giữa tấm sàn (`y = -0.02`) và drei `<Grid>` (`y = 0`), mét. */
const KHE_HO_SAN_LUOI_M = 0.02;

describe("PH-52 · `/factory-command` — cỡ tấm lưới `infiniteGrid`, thứ làm bản vá PH-51 vô dụng", () => {
  it("`far` của màn này ĐÚNG là `max(2000, banKinh × 20)` — hai cỡ cảnh đo sống", () => {
    // Khẳng định KÍCH THƯỚC ĐẦU VÀO: nếu công thức `far` đổi thì mọi số dưới đây
    // phải đo lại. `far` cũng chính là dấu vân tay mà harness dùng để biết nó có
    // đang chụp nhầm cỡ cảnh hay không.
    expect(Math.max(2000, TAP_DOAN.banKinh * 20)).toBeCloseTo(TAP_DOAN.far, 1);
    expect(Math.max(2000, MOT_NHA_MAY.banKinh * 20)).toBeCloseTo(MOT_NHA_MAY.far, 1);
    expect(nearTheoFar(TAP_DOAN.far)).toBeCloseTo(0.41, 3);
    expect(nearTheoFar(MOT_NHA_MAY.far)).toBeCloseTo(0.149, 3);
  });

  it("tấm lưới rộng hàng TRIỆU mét — lớn hơn `far` hàng trăm lần", () => {
    // drei: `args` × (1 + fadeDistance) khi `infiniteGrid`. Đây là con số làm cho
    // độ sâu của lưới sai hàng mét, tức làm cho `polygonOffset` (một bước z) vô dụng.
    const rongTam = TAP_DOAN.banKinh * 4 * (1 + TAP_DOAN.banKinh * 5);
    expect(rongTam).toBeGreaterThan(3_000_000);
    expect(rongTam / TAP_DOAN.far).toBeGreaterThan(300);
  });

  it("ĐỐI CHỨNG DƯƠNG: ở cỡ MỘT NHÀ MÁY, bước z vẫn lớn hơn khe hở ⇒ khe 2 cm tự nó cũng không đủ", () => {
    // Không có ca này thì lưới đang ngầm khai "chỉ tại tấm lưới khổng lồ", trong
    // khi phép đo nói: thu tấm lưới về cỡ lành mạnh thì z-fighting CỔ ĐIỂN lộ ra
    // (0 % → 43,60 %). Hai nguyên nhân chồng lên nhau, và bản vá phải trị cả hai.
    const buoc = buocZ(MOT_NHA_MAY.camXa, nearTheoFar(MOT_NHA_MAY.far), MOT_NHA_MAY.far);
    expect(buoc).toBeGreaterThan(KHE_HO_SAN_LUOI_M);
    expect(buoc / KHE_HO_SAN_LUOI_M).toBeGreaterThan(3);
  });
});

describe("PH-52 · `/factory-command` — bản vá nằm ở vật liệu SÀN, và lưới KHÔNG bị đụng", () => {
  const nguon = () => docMaNguon(TEP);

  /** Lát cắt sàn + `<Grid>` — cắt theo hai mốc văn bản để không đo nhầm chỗ khác. */
  function latCatSan(s: string): string {
    const dau = s.indexOf("<mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]}>");
    expect(dau).toBeGreaterThan(-1);
    const cuoi = s.indexOf("/>", s.indexOf("<Grid", dau));
    expect(cuoi).toBeGreaterThan(dau);
    return s.slice(dau, cuoi);
  }

  it("đối chứng dương: lát cắt CÓ cả tấm sàn lẫn drei `<Grid>`", () => {
    // Nếu hai mốc văn bản trượt, mọi khẳng định dưới đây thành xanh-trên-tập-rỗng.
    const lat = latCatSan(nguon());
    expect(lat).toContain("<planeGeometry");
    expect(lat).toContain("<Grid");
    expect(lat).toContain("infiniteGrid");
    expect(lat.length).toBeGreaterThan(200);
  });

  it("vật liệu sàn khai `depthWrite` — và nó phải là FALSE", () => {
    const lat = latCatSan(nguon());
    const vatLieu = lat.slice(lat.indexOf("<meshStandardMaterial"), lat.indexOf("</mesh>"));
    expect(vatLieu).toContain("depthWrite");
    // Hằng `SAN_GHI_DO_SAU` mang docblock giải thích; giá trị phải là false.
    expect(nguon()).toMatch(/const SAN_GHI_DO_SAU = false;/);
  });

  it("khe hở hình học 2 cm GIỮ NGUYÊN — bản vá thêm hàng rào, không thay hàng rào", () => {
    // Vừa nâng khe hở vừa tắt depthWrite thì hai cơ chế che nhau và lần gỡ sau
    // sẽ không ai biết cái nào đang gánh.
    expect(latCatSan(nguon())).toContain("position={[0, -0.02, 0]}");
  });

  it("★ LƯỚI KHÔNG ĐƯỢC TẮT DEPTH — nếu tắt thì lưới vẽ ĐÈ khối máy (PH-51 đã đo)", () => {
    // Đây là đường phân giới giữa bản vá và ứng viên (C) bị bác bỏ: thứ bị tắt là
    // SÀN, không phải lưới. Lưới vẫn so độ sâu nên máy vẫn che được lưới.
    const lat = latCatSan(nguon());
    const luoi = lat.slice(lat.indexOf("<Grid"));
    expect(luoi).not.toContain("depthTest");
    expect(luoi).not.toContain("depthWrite");
    expect(luoi).not.toContain("renderOrder");
  });

  it("ỨNG VIÊN BỊ BÁC BỎ: KHÔNG được lẻn `polygonOffset` vào vật liệu sàn màn này", () => {
    // Đo được: 96,34 % → 96,34 %. Để lại nó là để lại một hàng rào mua 0 pixel mà
    // lần đọc sau sẽ tưởng đang gánh việc.
    expect(latCatSan(nguon())).not.toContain("polygonOffset");
  });
});
