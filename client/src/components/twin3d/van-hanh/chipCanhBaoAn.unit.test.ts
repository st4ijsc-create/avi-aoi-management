/**
 * chipCanhBaoAn.unit.test.ts — ĐỢT 49 (mục D): BADGE BỊ GIẤU PHẢI CÓ CHỈ BÁO, và ngân sách
 * dời chỗ của badge đủ rộng để bớt phải giấu.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * KẾT CỤC ĐƯỢC CANH (QA lần 7 mục 4.2)
 * ════════════════════════════════════════════════════════════════════════════
 * `/twin`@1280: `tong 7 · ve 5 · soAn 2 · biChe 2` — HAI cảnh báo bị giấu vì chạm lớp phủ DOM,
 * và chỉ báo duy nhất là thuộc tính `data-so-an` (chỉ DOM đọc được; panel trái vẫn liệt kê 7).
 * Chip đáy canvas đếm TÊN MÁY ẩn, không đếm cảnh báo. Người vận hành đếm 5 badge và tin đó là
 * tất cả — NT-3 (*"không có dữ liệu ≠ bình thường"*) bị vi phạm ở đúng lớp quan trọng nhất.
 *
 * ⚠ G122: "chữ đọc được từ DOM" chưa bao giờ đủ — chip "còn N tên bị ẩn" đã 22 đợt không ai
 *   NHÌN THẤY. Nên sàng này chỉ canh phần LOGIC + NỐI DÂY; phần "nhìn thấy được" do e2e/
 *   `thigiac47` đo bằng bbox trong canvas. Hai phép đo, hai tầng, không thay nhau.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { SO_BUOC_DOI_CHO, locBadge, type BadgeUngVien } from "./locBadge";
import { ghiSoAn, docSoAn, xoaSoAn, LOP_BADGE } from "../loi/hopDaVe";

const doc = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const LOP_NHAN = doc("client/src/components/twin3d/loi/LopNhan.tsx");
const LOP_CANH_BAO = doc("client/src/components/twin3d/van-hanh/LopCanhBao.tsx");
const CANH_VAN_HANH = doc("client/src/components/twin3d/van-hanh/CanhVanHanh.tsx");
const TWIN_VAN_HANH = doc("client/src/pages/TwinVanHanh.tsx");
const TWIN_LINE = doc("client/src/pages/TwinLine.tsx");

describe("D.1 — ngân sách dời chỗ badge", () => {
  it("★★★ SO_BUOC_DOI_CHO tăng 3 → 6 (ngân sách, không phải vô hạn)", () => {
    expect(SO_BUOC_DOI_CHO).toBe(6);
  });

  it("★★★ badge bị lớp phủ chắn CẢ HÀNG và CẢ CỘT quanh neo ⇒ dời CHÉO thay vì bị giấu", () => {
    const khungCanvas = { rong: 1000, cao: 700 };
    const b: BadgeUngVien = {
      id: 1,
      x: 300,
      y: 300,
      diemUuTien: 1,
      rongPx: 60,
      caoPx: 20,
      ngoaiKhung: false,
      uuTienTuyetDoi: false,
    };
    // Chắn đúng hàng ngang (mọi x) và đúng cột dọc (mọi y) đi qua neo ⇒ 4 hướng thẳng đều tắc.
    const vungCam = [
      { trai: 0, phai: 1000, tren: 286, duoi: 314 },
      { trai: 266, phai: 334, tren: 0, duoi: 700 },
    ];
    const khongDoi = locBadge([b], { khungCanvas, vungCam });
    expect(khongDoi.ve).toHaveLength(0);
    expect(khongDoi.soBiChe).toBe(1);

    const coDoi = locBadge([b], { khungCanvas, vungCam, doiCho: true });
    expect(coDoi.ve).toHaveLength(1);
    expect(coDoi.ve[0].doiCho).toBe(true);
    // Ô đã dời phải THẬT SỰ ngoài mọi vùng cấm (không phải "dời cho có").
    const h = coDoi.ve[0].hop!;
    for (const v of vungCam) {
      expect(h.trai < v.phai && v.trai < h.phai && h.tren < v.duoi && v.tren < h.duoi).toBe(false);
    }
    // Và là CHÉO: lệch cả hai trục so với neo.
    expect(coDoi.ve[0].x).not.toBe(300);
    expect(coDoi.ve[0].y).not.toBe(300);
  });

  it("badge KHÔNG bị chắn vẫn đứng đúng neo (ngân sách rộng hơn không làm badge trôi vô cớ)", () => {
    const kq = locBadge(
      [{ id: 9, x: 400, y: 200, diemUuTien: 1, rongPx: 60, caoPx: 20, ngoaiKhung: false, uuTienTuyetDoi: false }],
      { khungCanvas: { rong: 1000, cao: 700 }, doiCho: true },
    );
    expect(kq.ve[0].doiCho).toBe(false);
    expect(kq.ve[0].x).toBe(400);
    expect(kq.soDoiCho).toBe(0);
  });
});

describe("D.2 — sổ SỐ dùng chung (một cụm chip, không hai cụm chồng nhau)", () => {
  it("ghi/đọc/xoá theo khoá canvas; chưa ai ghi ⇒ 0", () => {
    const canvasA = {};
    const canvasB = {};
    expect(docSoAn(canvasA, LOP_BADGE)).toBe(0);
    ghiSoAn(canvasA, LOP_BADGE, 2);
    expect(docSoAn(canvasA, LOP_BADGE)).toBe(2);
    expect(docSoAn(canvasB, LOP_BADGE), "sổ của canvas khác KHÔNG dùng chung").toBe(0);
    ghiSoAn(canvasA, LOP_BADGE, 0);
    expect(docSoAn(canvasA, LOP_BADGE), "ghi 0 và chưa ai ghi cùng nghĩa").toBe(0);
    xoaSoAn(canvasA, LOP_BADGE);
    expect(docSoAn(canvasA, LOP_BADGE)).toBe(0);
  });

  it("★★★ `LopCanhBao` GHI số (kể cả 0) và DỌN khi unmount — chip không in số của cảnh đã chết", () => {
    expect(LOP_CANH_BAO).toMatch(/ghiSoAn\(gl\.domElement, LOP_BADGE, an\)/);
    expect(LOP_CANH_BAO).toMatch(/xoaSoAn\(gl\.domElement, LOP_BADGE\)/);
  });

  it("★★★ `LopNhan` ĐỌC số ấy và vẽ chip TRONG CÙNG cụm `cum-chip-nhan` (không dựng cụm thứ hai)", () => {
    expect(LOP_NHAN).toMatch(/const soAnBadge = docSoAn\(gl\.domElement, LOP_BADGE\)/);
    expect(LOP_NHAN).toMatch(/data-testid="chip-canh-bao-bi-an"\s+data-so=\{soCanhBaoAn\}/);
    // Chip mới nằm giữa `cum-chip-nhan` và `chip-nhan-bi-an` ⇒ cùng một cụm đáy canvas.
    const iCum = LOP_NHAN.indexOf('data-testid="cum-chip-nhan"');
    const iMoi = LOP_NHAN.indexOf('data-testid="chip-canh-bao-bi-an"');
    const iTen = LOP_NHAN.indexOf('data-testid="chip-nhan-bi-an"');
    expect(iCum).toBeGreaterThan(-1);
    expect(iMoi).toBeGreaterThan(iCum);
    expect(iTen).toBeGreaterThan(iMoi);
    // Alarm đứng TRÊN tên máy: chip sự cố ngoài khung → chip cảnh báo ẩn → chip tên ẩn.
    expect(LOP_NHAN.indexOf('data-testid="chip-su-co-ngoai-khung"')).toBeLessThan(iMoi);
  });

  it("★★★ chip chỉ render khi CÓ CHỮ ĐÃ DỊCH và số > 0 (không có chuỗi rác khi chưa nối)", () => {
    expect(LOP_NHAN).toMatch(/\(chuCanhBaoAn && soCanhBaoAn > 0\)/);
  });

  it("★★★ lớp nhãn KHÔNG được `return null` khi chỉ còn chip cảnh báo — nếu không chip câm", () => {
    expect(LOP_NHAN).toMatch(
      /if \(tat \|\| \(hienThi\.length === 0 && soAn === 0 && soSuCoNgoai === 0 && soCanhBaoAn === 0\)\) return null;/,
    );
  });
});

describe("D.3 — NỐI DÂY đủ bốn chặng (G5: prop 'có mặt' mà không bao giờ tới nơi)", () => {
  it("★★★ `CanhVanHanh` khai prop, đưa vào `PropsHam`, vào `hamRef`, và truyền xuống `<LopNhan`", () => {
    expect(CANH_VAN_HANH).toMatch(/chuCanhBaoAn\?: \(n: number\) => string;/);
    expect(CANH_VAN_HANH).toMatch(/\| "chuCanhBaoAn"/);
    // hai lần: khởi tạo ref + gán lại mỗi render.
    expect(CANH_VAN_HANH.match(/chuCanhBaoAn: props\.chuCanhBaoAn,/g)?.length).toBe(2);
    expect(CANH_VAN_HANH).toMatch(/chuCanhBaoAn=\{coChuCanhBaoAn \? chuCanhBaoAnOnDinh : undefined\}/);
    expect(CANH_VAN_HANH).toMatch(/chuCanhBaoAn=\{props\.chuCanhBaoAn\}/);
  });

  it("★★★ CẢ HAI trang gọi `t()` ở tầng trang (RB-8.3 — cảnh không gọi `t()`)", () => {
    for (const [ten, src] of [
      ["TwinVanHanh", TWIN_VAN_HANH],
      ["TwinLine", TWIN_LINE],
    ] as const) {
      expect(src, ten).toMatch(/chuCanhBaoAn=\{\(n\) =>?\s*\n?\s*t\("twin3d\.vanHanh\.canhBaoBiAn"/);
    }
  });

  it("★★★ khoá i18n có ĐỦ vi/en/zh và giữ nguyên chỗ nội suy `{{n}}`", () => {
    for (const lg of ["vi", "en", "zh"]) {
      const j = JSON.parse(doc(`client/src/i18n/locales/${lg}.json`));
      const chu = j.twin3d.vanHanh.canhBaoBiAn as string;
      expect(typeof chu, lg).toBe("string");
      expect(chu, lg).toContain("{{n}}");
    }
  });
});

describe("Đợt 49 — nhánh `tat`/0 nhãn phải DỌN SỔ HỘP (hộp vô hình không được cướp click)", () => {
  it("★★★ `tinhLai` xoá `hopDaVeRef` và `hopKhoiRef` trước khi return ở nhánh tắt nhãn", () => {
    const i = LOP_NHAN.indexOf("if (tat || nhan.length === 0) {");
    expect(i, "nhánh tắt nhãn phải còn tồn tại").toBeGreaterThan(-1);
    const than = LOP_NHAN.slice(i, LOP_NHAN.indexOf("return;", i));
    expect(than).toContain("hopDaVeRef.current = []");
    expect(than).toContain("hopKhoiRef.current = []");
  });

  it("★★★ `khiBam` NHƯỜNG khi điểm bấm nằm trong hình chiếu khối của máy KHÁC", () => {
    expect(LOP_NHAN).toMatch(/const deKhoiMayKhac = hopKhoiRef\.current\.some\(/);
    expect(LOP_NHAN).toMatch(/k\.machineId !== trung\.machineId/);
    // Nhường = KHÔNG stopPropagation và KHÔNG gọi onChonNhan — phải đứng TRƯỚC cả hai.
    const iN = LOP_NHAN.indexOf("if (deKhoiMayKhac) return;");
    const iS = LOP_NHAN.indexOf("ev.stopPropagation();", iN);
    const iC = LOP_NHAN.indexOf("onChonNhanRef.current?.(trung.machineId)", iN);
    expect(iN).toBeGreaterThan(-1);
    expect(iS).toBeGreaterThan(iN);
    expect(iC).toBeGreaterThan(iS);
  });
});
