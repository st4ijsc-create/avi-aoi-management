/**
 * badgeKepRiaDeNhan.unit.test.ts — ★★★ ĐỢT 53 (QA lần 8, SAI #1): BADGE BỊ KẸP RÌA VẪN PHẢI VÀO SỔ `hopDaVe`.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * KẾT CỤC NGƯỜI DÙNG BỊ HỎNG
 * ════════════════════════════════════════════════════════════════════════════
 * Ở `/twin/may/18` — màn Máy của một máy ĐANG CÓ CẢNH BÁO MỞ — badge cảnh báo đè lên NHÃN TÊN MÁY
 * `1 584 px² = 35 %` @1600×900 và `744 px² = 17 %` @1280×720, vi lẫn en (4/4 ca, QA Đợt 52
 * `.qa-dot52/nhanbadge/tong.json`). Badge z-index 30 nằm TRÊN nhãn z-index 20 ⇒ tên máy bị cắt chữ.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ GỐC RỄ — ĐO TỪ CƠ CHẾ, KHÔNG TỪ LINH CẢM (`.qa-dot53/probe/truoc/tong.json`)
 * ════════════════════════════════════════════════════════════════════════════
 * Giả thuyết trong brief: *"màn Máy KHÔNG CÓ chính sách tránh nhau giữa `lop-nhan` và `lop-canh-bao`"*.
 * Phép đo BÁC BỎ giả thuyết ấy: ba màn dùng CHUNG `<CanhVanHanh>` nên chính sách có đủ ở cả ba.
 *
 *   | màn            | `__demBadge.ve` | `__demNhan.soHopBadge` | cặp chồng |
 *   |----------------|----------------:|-----------------------:|----------:|
 *   | `/twin`        |               7 |                  **7** |         0 |
 *   | `/twin/line/2` |               2 |                  **2** |         0 |
 *   | `/twin/may/18` |               1 |                  **0** |     **1** |
 *
 * Lớp nhãn ở màn Máy nhận **0** hộp badge trong khi lớp badge vẽ **1**. Vì sao: badge ấy có
 * `data-ngoai-khung="1"` (neo alarm chiếu ra ngoài mép ⇒ `LopCanhBao` KẸP nó về rìa, §10.3 luật 3),
 * mà `locBadge` trả `hop = null` cho badge ngoài khung và `LopCanhBao` cũ ghi sổ bằng
 * `kq.ve.map(u => u.hop).filter(h => h !== null)` ⇒ **badge bị kẹp rìa biến mất khỏi sổ**.
 *
 * `hop = null` là ĐÚNG cho câu hỏi *"có tính khi khử chồng badge×badge không?"* (badge kẹp rìa
 * chồng nhau là hành vi spec YÊU CẦU). Nó SAI cho câu hỏi *"badge này che pixel của lớp khác
 * không?"* — hai câu hỏi khác nhau đi chung một trường suốt 6 đợt. ⇒ trường mới `hopManHinh`,
 * LUÔN có, là thứ đi vào sổ `hopDaVe`.
 *
 * ⚠ Vì sao `/twin` và Line không lộ: hôm nay không badge nào của hai màn ấy bị kẹp rìa. Lỗi CÂM
 *   cho tới khi một alarm trôi ra ngoài mép — tức nó vẫn đang rình ở hai màn kia.
 *
 * TẦNG 1 (hành vi, thuần): `locBadge` + `locNhan` dựng lại ĐÚNG hình học đo được trên màn thật.
 * TẦNG 2 (chỗ nối, văn bản): `LopCanhBao` phải ghi `hopManHinh` và KHÔNG được lọc null trở lại.
 * TẦNG 3 (thị giác, ngoài tệp này): trạng thái `may/co-canh-bao` mới trong lưới 22 trạng thái.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { hopNhan, locNhan, type NhanUngVien } from "../loi/locNhan";
import { hopBadge, locBadge, type BadgeUngVien } from "./locBadge";

/** Diện tích giao của hai hộp, px² — dụng cụ đo ĐỘC LẬP với cả hai thuật toán. */
function dienTichGiao(
  a: { trai: number; phai: number; tren: number; duoi: number },
  b: { trai: number; phai: number; tren: number; duoi: number },
): number {
  const w = Math.max(0, Math.min(a.phai, b.phai) - Math.max(a.trai, b.trai));
  const h = Math.max(0, Math.min(a.duoi, b.duoi) - Math.max(a.tren, b.tren));
  return w * h;
}

/*
 * ════════════════════════════════════════════════════════════════════════════
 * HÌNH HỌC THẬT — chép từ `getBoundingClientRect` trên dist 3053, `/twin/may/18`, vai `e2e_tai_loE`
 * (`.qa-dot53/probe/truoc/tong.json`). Toạ độ quy về GỐC CANVAS (canvas ở (288,125), 1000×324).
 * ════════════════════════════════════════════════════════════════════════════
 */
const KHUNG_1600 = { rong: 1000, cao: 324 };
/** Nhãn `SIM-L2-CONVEYOR · Không rõ`: page (694,132)→(882,156) ⇒ local (406,7)→(594,31). Neo = giữa cạnh DƯỚI. */
const NHAN_MAY_18: NhanUngVien = {
  khoa: "may:18",
  x: 500,
  y: 31,
  khoangCachMet: 0,
  rongPx: 188,
  caoPx: 24,
};
/** Badge `badge-canh-bao-11` ĐÃ KẸP RÌA: page (716,145)→(861,162) ⇒ local (428,20)→(573,37). Neo = TÂM. */
const BADGE_11: BadgeUngVien = {
  id: 11,
  x: 500.5,
  y: 28.5,
  diemUuTien: 1002,
  ngoaiKhung: true,
  rongPx: 144,
  caoPx: 17,
};

describe("★★★ Đợt 53 — badge KẸP RÌA phải đi vào sổ hộp chung (gốc rễ SAI #1 của QA lần 8)", () => {
  it("★★★ ĐỐI CHỨNG SỐ ĐO: hình học chép từ màn thật tái hiện ĐÚNG 1 584 px² mà QA đo được", () => {
    // Nếu con số này lệch, mọi kết luận bên dưới nói về một màn hình KHÁC màn hình đã hỏng.
    expect(dienTichGiao(hopNhan(NHAN_MAY_18), hopBadge(BADGE_11))).toBe(1584);
  });

  it("★★★ `locBadge` trả `hopManHinh` CÓ THẬT cho badge ngoài khung (trong khi `hop` vẫn null)", () => {
    const kq = locBadge([BADGE_11], { khungCanvas: KHUNG_1600, doiCho: true });
    expect(kq.ve).toHaveLength(1);
    // `hop = null` giữ nguyên hợp đồng §10.3 luật 3: badge kẹp rìa MIỄN khử chồng badge×badge.
    expect(kq.ve[0].hop).toBeNull();
    // …nhưng nó CHIẾM pixel, và pixel ấy phải nói ra được.
    expect(kq.ve[0].hopManHinh).toEqual(hopBadge(BADGE_11));
  });

  it("BẤT BIẾN (không phải danh sách): MỌI badge được vẽ đều có `hopManHinh` — ngoài khung, dời chỗ hay không", () => {
    const kq = locBadge(
      [
        BADGE_11,
        { id: 1, x: 100, y: 100, diemUuTien: 9, rongPx: 80, caoPx: 18 },
        { id: 2, x: 104, y: 100, diemUuTien: 8, rongPx: 80, caoPx: 18 },
        { id: 3, x: 900, y: 300, diemUuTien: 7, rongPx: 80, caoPx: 18, uuTienTuyetDoi: true },
      ],
      { khungCanvas: KHUNG_1600, doiCho: true },
    );
    expect(kq.ve.length).toBeGreaterThanOrEqual(3);
    for (const v of kq.ve) {
      expect(v.hopManHinh).toBeTruthy();
      expect(v.hopManHinh.phai).toBeGreaterThan(v.hopManHinh.trai);
      expect(v.hopManHinh.duoi).toBeGreaterThan(v.hopManHinh.tren);
      // Hộp thật phải TRÙNG toạ độ vẽ (x,y là TÂM badge) — không phải một hộp nào khác.
      expect((v.hopManHinh.trai + v.hopManHinh.phai) / 2).toBeCloseTo(v.x, 6);
      expect((v.hopManHinh.tren + v.hopManHinh.duoi) / 2).toBeCloseTo(v.y, 6);
      // Badge KHÔNG ngoài khung: `hop` và `hopManHinh` là MỘT (không được đẻ ra hai sự thật).
      if (!v.ngoaiKhung) expect(v.hopManHinh).toEqual(v.hop);
    }
  });

  it("★★★ KẾT CỤC: sổ nhận `hopManHinh` ⇒ nhãn tên máy DỜI XUỐNG, chồng = 0 px² và nhãn KHÔNG bị giấu", () => {
    const kqBadge = locBadge([BADGE_11], { khungCanvas: KHUNG_1600, doiCho: true });
    // Đúng cách `LopCanhBao` ghi sổ sau bản vá — không `filter` nào có thể làm rỗng nó.
    const soHopDaVe = kqBadge.ve.map((u) => u.hopManHinh);
    expect(soHopDaVe).toHaveLength(1);

    const kqNhan = locNhan([NHAN_MAY_18], {
      khungCanvas: KHUNG_1600,
      vungCam: soHopDaVe,
      xepTang: true,
      xepTangXuong: true,
      doiNgang: true,
    });

    expect(kqNhan.ve).toHaveLength(1); // KHÔNG giấu nhãn để chữa chồng lấn.
    expect(kqNhan.soBiChe).toBe(0);
    expect(dienTichGiao(kqNhan.ve[0].hop, hopBadge(BADGE_11))).toBe(0);
    // Dời XUỐNG (tầng âm): phía trên đã hết chỗ trong canvas (neo sát mép trên).
    expect(kqNhan.ve[0].tang).toBeLessThan(0);
    // Nhãn vẫn nằm TRỌN trong canvas — dời không được đổi một lỗi lấy một lỗi.
    expect(kqNhan.ve[0].hop.tren).toBeGreaterThanOrEqual(0);
    expect(kqNhan.ve[0].hop.duoi).toBeLessThanOrEqual(KHUNG_1600.cao);
  });

  it("★★★ ABLATION (chiều ngược): sổ RỖNG như bản cũ ⇒ chồng quay lại ĐÚNG 1 584 px²", () => {
    // Bản CŨ: `kq.ve.map(u => u.hop).filter(h => h !== null)` ⇒ [] vì badge ngoài khung.
    const soCu = locBadge([BADGE_11], { khungCanvas: KHUNG_1600, doiCho: true })
      .ve.map((u) => u.hop)
      .filter((h): h is NonNullable<typeof h> => h !== null);
    expect(soCu).toHaveLength(0); // chính chỗ mất dữ kiện

    const kqNhan = locNhan([NHAN_MAY_18], {
      khungCanvas: KHUNG_1600,
      vungCam: soCu,
      xepTang: true,
      xepTangXuong: true,
      doiNgang: true,
    });
    expect(kqNhan.ve[0].tang).toBe(0);
    expect(dienTichGiao(kqNhan.ve[0].hop, hopBadge(BADGE_11))).toBe(1584);
  });

  it("@1280×720 (canvas 680×280) — cùng bản vá, cùng kết cục 0 px²", () => {
    const khung = { rong: 680, cao: 280 };
    // page: nhãn (638,150)→(826,174) · badge (556,145)→(700,162) · canvas (288,125)
    const nhan: NhanUngVien = { khoa: "may:18", x: 444, y: 49, khoangCachMet: 0, rongPx: 188, caoPx: 24 };
    const badge: BadgeUngVien = { id: 11, x: 340, y: 28.5, diemUuTien: 1002, ngoaiKhung: true, rongPx: 144, caoPx: 17 };
    expect(dienTichGiao(hopNhan(nhan), hopBadge(badge))).toBe(744); // = số QA đo được

    const so = locBadge([badge], { khungCanvas: khung, doiCho: true }).ve.map((u) => u.hopManHinh);
    const kq = locNhan([nhan], { khungCanvas: khung, vungCam: so, xepTang: true, xepTangXuong: true, doiNgang: true });
    expect(kq.ve).toHaveLength(1);
    expect(dienTichGiao(kq.ve[0].hop, hopBadge(badge))).toBe(0);
  });
});

describe("★★★ Đợt 53 — CHỖ NỐI: `LopCanhBao` ghi `hopManHinh` vào sổ `hopDaVe` (khuôn `lopCanhBaoNoiVaoCanvas`)", () => {
  const GOC = resolve(__dirname, "../../../..");
  const LOP_CANH_BAO = readFileSync(resolve(GOC, "src/components/twin3d/van-hanh/LopCanhBao.tsx"), "utf8");
  const LOC_BADGE = readFileSync(resolve(GOC, "src/components/twin3d/van-hanh/locBadge.ts"), "utf8");

  it("ghi sổ bằng `u.hopManHinh`", () => {
    expect(LOP_CANH_BAO).toMatch(
      /ghiHopDaVe\(\s*gl\.domElement,\s*LOP_BADGE,\s*kq\.ve\.map\(\(u\) => u\.hopManHinh\),?\s*\)/,
    );
  });

  it("★ KHÔNG còn phép LỌC null trên đường vào sổ — chính nó đã ném badge kẹp rìa ra khỏi sổ", () => {
    expect(LOP_CANH_BAO).not.toMatch(/ghiHopDaVe\([\s\S]{0,200}?filter\(/);
    expect(LOP_CANH_BAO).not.toMatch(/kq\.ve\.map\(\(u\) => u\.hop\)/);
  });

  it("`hopManHinh` là trường BẮT BUỘC của `BadgeDuocVe` (không `?`) — không thể quên điền ở một nhánh", () => {
    expect(LOC_BADGE).toMatch(/\n {2}hopManHinh: HinhChuNhat;\n/);
  });
});
