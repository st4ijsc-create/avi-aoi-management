/**
 * chipTenBiChe.unit.test.ts — PDCA VÒNG 3 (2026-09-19): **TÊN MÁY HỎNG BỊ CHÍNH PANEL CỦA TA
 * CHE THÌ MÀN PHẢI NÓI RA** — và phải nói TÁCH KHỎI con số "ẩn theo chính sách".
 *
 * ════════════════════════════════════════════════════════════════════════════
 * KẾT CỤC ĐƯỢC CANH — đo trên trình duyệt thật, `/twin` FUYU-F, nhịp tim tươi
 * ════════════════════════════════════════════════════════════════════════════
 * Chế độ mặc định là *chỉ-nhãn-bất-thường*, nên ứng viên sau lọc chính sách ĐÚNG là máy đang
 * hỏng. Đo được, cùng một cảnh, chỉ đổi khung nhìn:
 *
 *   @1280×720   lớp phủ ăn 70,8 % canvas → `tong 182 · lọc chính sách 163 · ứng viên 19 ·
 *               vẽ 1 · biChe 18`   ⇒ đối chiếu SQL: **24** máy trong khung đang
 *               `down/error/maintenance` mà chỉ **1** máy có tên trên cảnh
 *   @1920×1080  lớp phủ 47,3 %                       → `vẽ 15 · biChe 1`
 *
 * Và nó THUẬN NGHỊCH — thu hai panel bằng chính `nut-thu-trai`/`nut-thu-phai`:
 *   phủ 70,8 % → 26,9 % → 70,8 % · máy bất thường có tên **1/24 → 7/24 → 1/24**
 * ⇒ nút thắt là DIỆN TÍCH lớp phủ, và người vận hành có sẵn một hành động để gỡ.
 *
 * Bản cũ khai MỘT con số (`soBiGiau` = 181) gộp hai chuyện đòi hai hành động khác nhau:
 *   · 163 tên ẩn **theo CHÍNH SÁCH** (máy bình thường — cố ý không đặt tên) ⇒ đổi bậc mật độ
 *   · 18 tên bị **LỚP PHỦ DOM CHE** (máy đang hỏng) ⇒ thu panel / nới khung
 * Người vận hành đọc "181 tên khác bị ẩn", hiểu đó là chính sách, rồi yên tâm — trong khi 18
 * cái tên bị giấu là tên máy hỏng. Đúng lớp lỗi mà Đợt 49 đã vá MỘT TẦNG TRÊN cho alarm
 * (`chipCanhBaoAn.unit.test.ts`): *"chip nhãn nói về TÊN MÁY, không nói về alarm"*.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ HAI TẦNG, KHÔNG THAY NHAU (G122)
 * ════════════════════════════════════════════════════════════════════════════
 * Tệp này canh LOGIC (`locNhan` thật, không mô phỏng) + NỐI DÂY năm chặng. Phần "người có
 * NHÌN THẤY không" do phép đo trình duyệt lo — `chip-ten-bi-che` đã nghiệm thu @1280 (số 18,
 * khớp `__demNhan.biChe`), thu panel ⇒ 10, @1920 ⇒ 1, thu panel ở 1920 ⇒ chip **biến mất**.
 * Ablation đã chứng minh phép đo ấy biết kêu: gỡ ĐÚNG MỘT trong năm chặng (chỗ truyền xuống
 * `<LopNhan>`) ⇒ chip mất hẳn **trong khi `tsc` vẫn xanh** — đúng bẫy G5.
 */

import { describe, it, expect } from "vitest";
import { resolve } from "node:path";

import { locNhan, type NhanUngVien } from "../loi/locNhan";
import { docMaNguon } from "@shared/testing/docMaNguon";

const doc = (p: string) => docMaNguon(resolve(process.cwd(), p));
const LOP_NHAN = doc("client/src/components/twin3d/loi/LopNhan.tsx");
const CANH_VAN_HANH = doc("client/src/components/twin3d/van-hanh/CanhVanHanh.tsx");
const TWIN_VAN_HANH = doc("client/src/pages/TwinVanHanh.tsx");
const TWIN_LINE = doc("client/src/pages/TwinLine.tsx");

/** Một ứng viên nhãn tối thiểu, neo tại (x,y) trong khung 1000×700. */
function ungVien(khoa: string, x: number, y: number, batThuong = true): NhanUngVien {
  return { khoa, x, y, diemUuTien: 1, ngoaiKhung: false, batThuong } as NhanUngVien;
}

describe("V3.1 — `soBiChe` là một đại lượng RIÊNG, không lẫn vào lọc chính sách", () => {
  it("★★★ lớp phủ chắn mọi tầng quanh neo ⇒ nhãn không vẽ được VÀ được quy gốc là `soBiChe`", () => {
    const khungCanvas = { rong: 1000, cao: 700 };
    // Chắn cả một dải ngang RỘNG quanh neo: mọi tầng trên/dưới/trái/phải đều rơi vào vùng cấm.
    const vungCam = [{ trai: 0, phai: 1000, tren: 0, duoi: 700 }];
    const kq = locNhan([ungVien("m1", 500, 350)], { khungCanvas, vungCam, chiNhanBatThuong: true });
    expect(kq.ve).toHaveLength(0);
    expect(kq.soBiChe).toBe(1);
    // …và KHÔNG bị quy nhầm sang một nguyên nhân khác — mỗi nguyên nhân một hành động khác.
    expect(kq.soBiChongLap).toBe(0);
    expect(kq.soVuotTran).toBe(0);
    expect(kq.soNgoaiKhung).toBe(0);
  });

  it("đối chứng dương — KHÔNG có lớp phủ ⇒ chính nhãn ấy vẽ được và `soBiChe` = 0", () => {
    const khungCanvas = { rong: 1000, cao: 700 };
    const kq = locNhan([ungVien("m1", 500, 350)], { khungCanvas, vungCam: [], chiNhanBatThuong: true });
    expect(kq.ve).toHaveLength(1);
    expect(kq.soBiChe).toBe(0);
  });

  it("★★★ `soBiChe` KHÔNG gộp với tên ẩn theo chính sách — hai con số phải tách được", () => {
    const khungCanvas = { rong: 1000, cao: 700 };
    const vungCam = [{ trai: 0, phai: 1000, tren: 0, duoi: 700 }];
    // 1 máy BẤT THƯỜNG (bị che) + 3 máy BÌNH THƯỜNG (bị chính sách loại).
    const kq = locNhan(
      [ungVien("hong", 500, 350, true), ungVien("ok1", 100, 100, false), ungVien("ok2", 200, 200, false), ungVien("ok3", 300, 300, false)],
      { khungCanvas, vungCam, chiNhanBatThuong: true },
    );
    expect(kq.soBiChe).toBe(1);
    // `soBiGiau` gộp CẢ BỐN — đó chính là con số mà chip cũ khai, và vì sao nó không đủ.
    expect(kq.soBiGiau).toBe(4);
    expect(kq.soBiGiau).toBeGreaterThan(kq.soBiChe);
  });
});

describe("V3.2 — chip `chip-ten-bi-che` và điều kiện render", () => {
  it("★★★ chip đọc `soTenBiChe` lấy từ `kq.soBiChe`, KHÔNG từ `soBiGiau`", () => {
    expect(LOP_NHAN).toMatch(/setSoTenBiChe\(kq\.soBiChe\)/);
    expect(LOP_NHAN).toMatch(/data-testid="chip-ten-bi-che"\s+data-so=\{soTenBiChe\}/);
  });

  it("★★★ CHỈ hiện ở bậc chỉ-nhãn-bất-thường — ở bậc mọi-tên con số này là tên máy BÌNH THƯỜNG", () => {
    expect(LOP_NHAN).toMatch(/\(chuTenBiChe && chiNhanBatThuong && soTenBiChe > 0\)/);
  });

  it("★★★ đứng TRONG cụm chip đã nghiệm thu, TRÊN chip tên-bị-ẩn (cùng chủ đề, khác nguyên nhân)", () => {
    const iCum = LOP_NHAN.indexOf('data-testid="cum-chip-nhan"');
    const iChe = LOP_NHAN.indexOf('data-testid="chip-ten-bi-che"');
    const iTen = LOP_NHAN.indexOf('data-testid="chip-nhan-bi-an"');
    expect(iCum).toBeGreaterThan(-1);
    expect(iChe).toBeGreaterThan(iCum);
    expect(iChe).toBeLessThan(iTen);
  });

  it("★★★ lớp nhãn KHÔNG `return null` khi chỉ còn MỖI chip này — nếu không chip câm", () => {
    expect(LOP_NHAN).toMatch(/soCanhBaoAn === 0 && soTenBiChe === 0/);
  });

  it("về RỖNG thì số phải được xoá — chip không in số của một cảnh đã chết", () => {
    expect(LOP_NHAN).toMatch(/if \(soTenBiChe !== 0\) setSoTenBiChe\(0\)/);
  });
});

describe("V3.3 — NỐI DÂY đủ NĂM chặng (G5: prop 'có mặt' mà không bao giờ tới `LopNhan`)", () => {
  it("★★★ `CanhVanHanh`: khai prop · vào `PropsHam` · vào `hamRef` (2 chỗ) · trampoline · truyền xuống", () => {
    expect(CANH_VAN_HANH).toMatch(/chuTenBiChe\?: \(n: number\) => string;/);
    expect(CANH_VAN_HANH).toMatch(/\| "chuTenBiChe"/);
    // `hamRef` có HAI chỗ (khởi tạo + gán lại mỗi lượt render) — thiếu chỗ thứ hai thì chữ
    // đóng băng ở lượt đầu và không ai thấy, vì trampoline đọc qua ref.
    expect(CANH_VAN_HANH.match(/chuTenBiChe: props\.chuTenBiChe,/g)?.length).toBe(2);
    expect(CANH_VAN_HANH).toMatch(/const chuTenBiCheOnDinh = useCallback/);
    expect(CANH_VAN_HANH).toMatch(/chuTenBiChe=\{coChuTenBiChe \? chuTenBiCheOnDinh : undefined\}/);
    // ★ Chặng bị ABLATION gỡ ra để chứng minh phép đo biết kêu: chỗ truyền xuống `<LopNhan>`.
    expect(CANH_VAN_HANH).toMatch(/chuTenBiChe=\{props\.chuTenBiChe\}/);
  });

  it("★★★ CẢ HAI trang dựng cảnh đều nối, và nối bằng CÙNG một khoá i18n", () => {
    expect(TWIN_VAN_HANH).toMatch(/chuTenBiChe=\{\(n\) =>/);
    expect(TWIN_VAN_HANH).toMatch(/twin3d\.vanHanh\.tenBiChe/);
    expect(TWIN_LINE).toMatch(/chuTenBiChe=\{\(n\) =>/);
    expect(TWIN_LINE).toMatch(/twin3d\.vanHanh\.tenBiChe/);
  });
});
