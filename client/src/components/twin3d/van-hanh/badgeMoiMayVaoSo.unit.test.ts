/**
 * badgeMoiMayVaoSo.unit.test.ts — ★★★ ĐỢT 55 (B): **MỌI** máy có cảnh báo, không phải máy 18.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * LỖ ĐO MÀ QA LẦN 9 VỪA LỘ (G134) — CHỈ MỞ MỘT MÁY NÊN ĐẾM THIẾU
 * ════════════════════════════════════════════════════════════════════════════
 * QA lần 8 và Đợt 53 khung toàn bộ lỗi "badge đè nhãn" quanh **một** URL: `/twin/may/18`.
 * QA lần 9 (Đợt 54) hỏi DB thay vì hỏi trí nhớ và tìm ra máy **23 (SIM-L2-ROBOT)** cũng có
 * `andon_events` chưa `resolved`, và trên bản TRƯỚC vá nó chồng **2 057 px² = 52 %** @1600 và
 * **1 573 px² = 40 %** @1280 — **NẶNG HƠN máy 18** (1 584 px² = 35 % · 744 px² = 17 %).
 * Bản vá `hopManHinh` là bản vá CƠ CHẾ nên nó đóng luôn cả ca chưa ai từng mở; nhưng **lưới
 * vẫn chỉ nhìn một máy**. Một lưới chỉ nhìn một máy sẽ im lặng đúng như hai đợt trước đã im.
 *
 * ⇒ Tệp này thay "máy cứng 18" bằng **tập máy SUY TỪ DỮ LIỆU** và biến G136 ("badge VẼ ==
 *   badge VÀO SỔ") từ một phép đo thủ công trên trình duyệt thành **BẤT BIẾN tự động**.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ TẬP MÁY LẤY TỪ ĐÂU — ĐO, KHÔNG ĐOÁN (`.qa-dot55/andon-may.json`, 2026-09-12)
 * ════════════════════════════════════════════════════════════════════════════
 * Vị từ dùng ĐÚNG vị từ của `andon.active` (`server/routers/andonRouter.ts:356` —
 * `isNull(andonEvents.resolvedAt)`), chạy bằng SQL thô (đường ĐỘC LẬP với tRPC, BG-127):
 *
 *     select * from andon_events where "resolvedAt" is null
 *
 * ⇒ **7 hàng / 6 máy**: 1 (SIM-L1-SPI) · 2 (SIM-L1-AOI, **HAI** hàng: 22 yellow + 25 red) ·
 *   3 (SIM-L1-AVI) · 4 (SIM-L1-ICT) · 18 (SIM-L2-CONVEYOR) · 23 (SIM-L2-ROBOT).
 *   `andon_events` tổng 7 hàng, số hàng `status='raised'` = **0** — `status` KHÔNG phải vị từ:
 *   cả 7 hàng đều `acknowledged`. Lưới nào lọc theo `status='raised'` sẽ thấy **0 máy** và im.
 * ⇒ Giao với máy ĐANG ĐỨNG trong cảnh (`twin_dat_cho.loaiThucThe='machine'`, 41 máy,
 *   `.qa-dot55/pham-vi.json`) = **cả 6** — không máy nào rơi ngoài cảnh.
 * ⇒ Đợt 54 báo "trong 12 máy của twin chỉ có 18 và 23": đó là 12 máy CAMERA THẤY ở `/twin`
 *   cho vai đo, không phải 12 máy của cảnh. Ở màn Máy `/twin/may/<id>` cả 6 đều vẽ badge.
 *
 * Toạ độ đặt chỗ THẬT của 6 máy: `.qa-dot55/dat-cho-may.json` (đọc `twin_dat_cho`).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * HAI TẦNG ĐO
 * ════════════════════════════════════════════════════════════════════════════
 * TẦNG 1 — BẤT BIẾN (không phải danh sách): với MỌI máy mà `dungCanhBao3D` neo được badge,
 *          và với MỌI thế đứng của badge (trong khung / kẹp cả 4 rìa), số badge VẼ phải BẰNG
 *          số hộp VÀO SỔ, và **tập machineId** hai bên phải TRÙNG KHỚP.
 * TẦNG 2 — SỐ THẬT: hình học `getBoundingClientRect` chép nguyên từ màn đã hỏng, cho **cả
 *          máy 18 lẫn máy 23**, ở **cả hai viewport**. 4 ca, mỗi ca một con số QA đã đo.
 *
 * Ablation hai chiều nằm ngay trong tệp: đường sổ CŨ (`map(u => u.hop).filter(...)`) phải làm
 * cả 4 ca ĐỎ trở lại đúng con số cũ; đường sổ MỚI (`map(u => u.hopManHinh)`) phải cho 0 px².
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { mmSangScene } from "../heToaDo";
import { hopNhan, locNhan, type HinhChuNhat, type NhanUngVien } from "../loi/locNhan";
import { dungCanhBao3D, type AndonVao, type MayDeNeo } from "./hopNhatCanh";
import { hopBadge, locBadge, type BadgeUngVien, type KetQuaLocBadge } from "./locBadge";

/* ═══════════════════════════════════════════════════════════════════════════ */
/* Dụng cụ đo ĐỘC LẬP với cả hai thuật toán                                    */
/* ═══════════════════════════════════════════════════════════════════════════ */

function dienTichGiao(a: HinhChuNhat, b: HinhChuNhat): number {
  const w = Math.max(0, Math.min(a.phai, b.phai) - Math.max(a.trai, b.trai));
  const h = Math.max(0, Math.min(a.duoi, b.duoi) - Math.max(a.tren, b.tren));
  return w * h;
}

/** Đường ghi sổ TRƯỚC bản vá Đợt 53 — badge kẹp rìa (`hop = null`) rơi khỏi sổ. */
const soCu = (kq: KetQuaLocBadge): HinhChuNhat[] =>
  kq.ve.map((u) => u.hop).filter((h): h is HinhChuNhat => h !== null);

/** Đường ghi sổ SAU bản vá Đợt 53 — `hopManHinh` luôn có. */
const soMoi = (kq: KetQuaLocBadge): HinhChuNhat[] => kq.ve.map((u) => u.hopManHinh);

/**
 * ★★★ SỔ PHẢI ĐƯỢC CHỌN BỞI MÃ SẢN PHẨM, KHÔNG PHẢI BỞI TEST (G20 + G139).
 *
 * ⚠ Bản nháp đầu của tệp này gọi thẳng `soMoi(kq)` rồi so `so.length === kq.ve.length`. Phép
 *   so ấy **KHÔNG THỂ SAI**: hai vế cùng sinh từ một `map` viết trong chính tệp test. Thiết bị
 *   đo không biết kêu thì con số 0 nó in ra không chứng minh gì.
 *
 * Vì vậy: bóc **đối số thứ ba** của `ghiHopDaVe(gl.domElement, LOP_BADGE, …)` ra khỏi
 * `LopCanhBao.tsx` (mã ĐANG CHẠY) và tra bảng dưới đây để lấy hàm tương ứng. Không `eval`,
 * không `new Function` — chỉ TRA BẢNG, nên chuỗi đọc từ đĩa không bao giờ được thực thi.
 *   · khớp `hopManHinh`  ⇒ dùng `soMoi`  ⇒ bất biến XANH.
 *   · khớp bản cũ        ⇒ dùng `soCu`   ⇒ bất biến **ĐỎ** (vẽ 7 / vào sổ 0) — đúng điều phải xảy ra.
 *   · không khớp bảng    ⇒ ca "đường ghi sổ LẠ" ĐỎ, buộc người đổi mã phải khai vào đây.
 */
const NGUON_LOP_CANH_BAO = readFileSync(
  resolve(__dirname, "../../../..", "src/components/twin3d/van-hanh/LopCanhBao.tsx"),
  "utf8",
);
/**
 * ⚠ `LopCanhBao` gọi `ghiHopDaVe` HAI chỗ: nhánh "không cảnh báo nào" ghi `[]` (đúng), và
 *   nhánh chính ghi sổ thật. Bản nháp của tôi bắt nhầm chỗ thứ nhất và lưới nổ "đường ghi sổ
 *   LẠ: []" — lấy MỌI lần gọi rồi bỏ lần ghi rỗng, và ghim "còn ĐÚNG MỘT" để không bắt nhầm lần nữa.
 */
const MOI_LAN_GHI_SO = [
  ...NGUON_LOP_CANH_BAO.matchAll(/ghiHopDaVe\(\s*gl\.domElement,\s*LOP_BADGE,\s*([\s\S]*?),?\s*\);/g),
].map((m) => m[1].replace(/\s+/g, " ").trim());
const GHI_SO_THAT = MOI_LAN_GHI_SO.filter((e) => e !== "[]");
/** Biểu thức ghi sổ NGUYÊN VĂN của nhánh chính, đã chuẩn hoá khoảng trắng để tra bảng ổn định. */
const BIEU_THUC_GHI_SO = GHI_SO_THAT[0] ?? "";

const BANG_DUONG_GHI_SO: ReadonlyMap<string, (kq: KetQuaLocBadge) => HinhChuNhat[]> = new Map([
  ["kq.ve.map((u) => u.hopManHinh)", soMoi],
  ["kq.ve.map((u) => u.hop).filter((h) => h !== null)", soCu],
  ["kq.ve.map((u) => u.hop).filter((h): h is HinhChuNhat => h !== null)", soCu],
]);

const soTheoSanPham = (kq: KetQuaLocBadge): HinhChuNhat[] => {
  const f = BANG_DUONG_GHI_SO.get(BIEU_THUC_GHI_SO);
  if (!f) throw new Error(`Đường ghi sổ LẠ trong LopCanhBao.tsx: ${JSON.stringify(BIEU_THUC_GHI_SO)}`);
  return f(kq);
};

/* ═══════════════════════════════════════════════════════════════════════════ */
/* DỮ LIỆU ĐO ĐƯỢC — 7 hàng andon chưa resolved, chép nguyên từ DB dev          */
/* ═══════════════════════════════════════════════════════════════════════════ */

/** `.qa-dot55/andon-may.json` — 7 hàng, `resolvedAt is null`, 2026-09-12. */
const ANDON_DANG_MO: readonly AndonVao[] = [
  { id: 21, machineId: 1, state: "red", status: "acknowledged" },
  { id: 22, machineId: 2, state: "yellow", status: "acknowledged" },
  { id: 25, machineId: 2, state: "red", status: "acknowledged" },
  { id: 23, machineId: 3, state: "call", status: "acknowledged" },
  { id: 24, machineId: 4, state: "call", status: "acknowledged" },
  { id: 11, machineId: 18, state: "yellow", status: "acknowledged" },
  { id: 12, machineId: 23, state: "yellow", status: "acknowledged" },
];

/** `.qa-dot55/dat-cho-may.json` — `twin_dat_cho` THẬT của đúng 6 máy trên (mm). */
const DAT_CHO_THAT: readonly {
  machineId: number;
  ma: string;
  xMm: number;
  yMm: number;
  zMm: number;
  caoMm: number;
}[] = [
  { machineId: 1, ma: "SIM-L1-SPI", xMm: 5450, yMm: 11600, zMm: 0, caoMm: 1500 },
  { machineId: 2, ma: "SIM-L1-AOI", xMm: 7950, yMm: 8800, zMm: 0, caoMm: 1500 },
  { machineId: 3, ma: "SIM-L1-AVI", xMm: 10450, yMm: 8800, zMm: 0, caoMm: 1500 },
  { machineId: 4, ma: "SIM-L1-ICT", xMm: 12950, yMm: 8800, zMm: 0, caoMm: 1800 },
  { machineId: 18, ma: "SIM-L2-CONVEYOR", xMm: 17950, yMm: 14800, zMm: 0, caoMm: 1800 },
  { machineId: 23, ma: "SIM-L2-ROBOT", xMm: 30450, yMm: 14800, zMm: 0, caoMm: 1800 },
];

/** Máy để neo — dựng qua `mmSangScene` (hàm SẢN PHẨM), không hoán vị trục bằng tay. */
const MAY_DE_NEO: readonly MayDeNeo[] = DAT_CHO_THAT.map((d) => ({
  machineId: d.machineId,
  viTri: mmSangScene({ xMm: d.xMm, yMm: d.yMm, zMm: d.zMm }),
  kichThuocMm: { caoMm: d.caoMm },
}));

const MA_THEO_MAY = new Map(DAT_CHO_THAT.map((d) => [d.machineId, d.ma]));

/* ═══════════════════════════════════════════════════════════════════════════ */
/* TẦNG 1 — BẤT BIẾN: VẼ == VÀO SỔ, cho MỌI máy có cảnh báo                    */
/* ═══════════════════════════════════════════════════════════════════════════ */

const KHUNG = { rong: 1000, cao: 324 };

/**
 * Năm thế đứng của badge trên màn — thế `giữa khung` là badge bình thường, bốn thế `kẹp rìa`
 * là badge mà `LopCanhBao` đã KẸP về mép vì alarm chiếu ra ngoài khung (§10.3 luật 3,
 * `ngoaiKhung`). Chính thế `kẹp rìa` là thế đã làm sổ nói dối suốt 6 đợt.
 */
const THE_DUNG = [
  { ten: "giữa khung", ngoaiKhung: false, x: (i: number) => 120 + i * 140, y: (_i: number) => 160 },
  { ten: "kẹp rìa TRÊN", ngoaiKhung: true, x: (i: number) => 120 + i * 140, y: (_i: number) => 8.5 },
  { ten: "kẹp rìa DƯỚI", ngoaiKhung: true, x: (i: number) => 120 + i * 140, y: (_i: number) => KHUNG.cao - 8.5 },
  { ten: "kẹp rìa TRÁI", ngoaiKhung: true, x: (_i: number) => 42, y: (i: number) => 40 + i * 40 },
  { ten: "kẹp rìa PHẢI", ngoaiKhung: true, x: (_i: number) => KHUNG.rong - 42, y: (i: number) => 40 + i * 40 },
] as const;

/** Chiếu mỗi cảnh báo đã neo thành MỘT badge ứng viên ở thế đứng cho trước. */
function ungVienTheoThe(the: (typeof THE_DUNG)[number]): {
  badge: BadgeUngVien[];
  mayCuaBadge: Map<number, number>;
} {
  const neo = dungCanhBao3D(ANDON_DANG_MO, MAY_DE_NEO, MA_THEO_MAY);
  const badge: BadgeUngVien[] = neo.map((c, i) => ({
    id: c.id,
    x: the.x(i),
    y: the.y(i),
    diemUuTien: 1000 - i,
    ngoaiKhung: the.ngoaiKhung,
    rongPx: 84,
    caoPx: 17,
  }));
  return { badge, mayCuaBadge: new Map(neo.map((c) => [c.id, c.machineId])) };
}

describe("★★★ Đợt 55 (B) — tập máy có cảnh báo SUY TỪ DỮ LIỆU, không phải hằng số '18'", () => {
  it("★★★ THIẾT BỊ ĐO TỰ KHAI: đường ghi sổ đọc được từ `LopCanhBao.tsx` và NẰM TRONG bảng", () => {
    // Nếu ca này đỏ, mọi con số bên dưới nói về một đường ghi sổ mà lưới không biết mặt.
    expect(MOI_LAN_GHI_SO.length).toBeGreaterThan(0);
    expect(GHI_SO_THAT).toHaveLength(1); // đúng MỘT nhánh ghi sổ thật
    expect(BANG_DUONG_GHI_SO.has(BIEU_THUC_GHI_SO)).toBe(true);
    // …và hôm nay nó phải là đường ĐÃ VÁ. Ai hạ nó về bản cũ thì ca này nói ra TÊN đường mới.
    expect(BIEU_THUC_GHI_SO).toBe("kq.ve.map((u) => u.hopManHinh)");
  });

  it("★★★ TIỀN ĐỀ (G5): tập máy khác rỗng, CÓ CẢ 18 VÀ 23, và đúng 6 máy / 7 cảnh báo", () => {
    const may = [...new Set(ANDON_DANG_MO.map((a) => a.machineId as number))].sort((a, b) => a - b);
    expect(ANDON_DANG_MO).toHaveLength(7);
    expect(may).toEqual([1, 2, 3, 4, 18, 23]);
    // Hai máy mà QA lần 9 đo thật phải NẰM TRONG — nếu ai đó rút gọn fixture, ca này kêu.
    expect(may).toContain(18);
    expect(may).toContain(23);
    // Một máy có thể có NHIỀU cảnh báo (máy 2 có 2) ⇒ "đếm máy" ≠ "đếm badge".
    expect(ANDON_DANG_MO.filter((a) => a.machineId === 2)).toHaveLength(2);
  });

  it("★★★ `dungCanhBao3D` neo được badge cho ĐỦ 7 cảnh báo của 6 máy (không máy nào rơi ngoài cảnh)", () => {
    const neo = dungCanhBao3D(ANDON_DANG_MO, MAY_DE_NEO, MA_THEO_MAY);
    expect(neo).toHaveLength(7);
    expect([...new Set(neo.map((c) => c.machineId))].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 18, 23]);
    // Neo nằm TRÊN NÓC máy: y (độ cao) phải lớn hơn y mặt sàn của chính máy ấy.
    for (const c of neo) {
      const m = MAY_DE_NEO.find((x) => x.machineId === c.machineId)!;
      expect(c.viTri.y).toBeGreaterThan(m.viTri.y);
    }
  });

  for (const the of THE_DUNG) {
    it(`★★★ BẤT BIẾN G136 — thế "${the.ten}": badge VẼ == badge VÀO SỔ, và TRÙNG tập machineId`, () => {
      const { badge, mayCuaBadge } = ungVienTheoThe(the);
      const kq = locBadge(badge, { khungCanvas: KHUNG, doiCho: true, tran: 99 });

      // Tiền đề: phép đo phải có gì để đo. Sổ rỗng vì "không badge nào được vẽ" là ĐẠT GIẢ.
      expect(kq.ve.length).toBeGreaterThan(0);

      const so = soTheoSanPham(kq);
      expect(so).toHaveLength(kq.ve.length); // ← VẼ == VÀO SỔ, con số (sổ do SẢN PHẨM chọn)

      // …và TRÙNG DANH TÍNH, không chỉ trùng số lượng: mỗi hộp trong sổ phải là hộp
      // của đúng badge đã vẽ (một sổ đúng số nhưng sai máy vẫn là sổ nói dối).
      const mayDaVe = new Set(kq.ve.map((u) => mayCuaBadge.get(u.id)!));
      const mayCoHop = new Set(
        kq.ve.filter((u) => so.includes(u.hopManHinh)).map((u) => mayCuaBadge.get(u.id)!),
      );
      expect([...mayCoHop].sort((a, b) => a - b)).toEqual([...mayDaVe].sort((a, b) => a - b));

      // Hai máy QA lần 9 đo thật phải có mặt trong tập VẼ ở mọi thế đứng.
      expect(mayDaVe.has(18)).toBe(true);
      expect(mayDaVe.has(23)).toBe(true);

      // Hộp trong sổ phải là hộp THẬT: tâm trùng toạ độ vẽ, diện tích > 0.
      for (const u of kq.ve) {
        expect(u.hopManHinh.phai - u.hopManHinh.trai).toBeGreaterThan(0);
        expect(u.hopManHinh.duoi - u.hopManHinh.tren).toBeGreaterThan(0);
        expect((u.hopManHinh.trai + u.hopManHinh.phai) / 2).toBeCloseTo(u.x, 6);
        expect((u.hopManHinh.tren + u.hopManHinh.duoi) / 2).toBeCloseTo(u.y, 6);
      }
    });
  }

  it("★★★ ABLATION (chiều ÂM, mọi thế đứng): đường sổ CŨ ⇒ 4 thế kẹp rìa MẤT TRẮNG sổ", () => {
    const bang = THE_DUNG.map((the) => {
      const { badge } = ungVienTheoThe(the);
      const kq = locBadge(badge, { khungCanvas: KHUNG, doiCho: true, tran: 99 });
      return { ten: the.ten, ve: kq.ve.length, moi: soTheoSanPham(kq).length, cu: soCu(kq).length };
    });

    // Chiều DƯƠNG: bản đang chạy — mọi thế đứng đều vẽ == vào sổ.
    for (const r of bang) expect(r.moi).toBe(r.ve);

    // Chiều ÂM: bản cũ — badge kẹp rìa biến mất khỏi sổ ở ĐÚNG 4 thế kẹp rìa.
    const thieu = bang.filter((r) => r.cu < r.ve);
    expect(thieu.map((r) => r.ten)).toEqual([
      "kẹp rìa TRÊN",
      "kẹp rìa DƯỚI",
      "kẹp rìa TRÁI",
      "kẹp rìa PHẢI",
    ]);
    for (const r of thieu) expect(r.cu).toBe(0); // mất TRẮNG, không phải mất một phần
    // Thế "giữa khung" KHÔNG lộ lỗi — đúng lý do lỗi câm suốt 6 đợt ở `/twin` và Line.
    expect(bang[0].cu).toBe(bang[0].ve);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════ */
/* TẦNG 2 — SỐ THẬT: máy 18 VÀ máy 23, hai viewport, hình học chép từ màn hỏng  */
/* ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Hình học `getBoundingClientRect` quy về GỐC CANVAS.
 *   · máy 18: `.qa-dot53/probe/truoc/tong.json` (dist 3053, vai `e2e_tai_loE`).
 *   · máy 23: `.qa-dot54/nb-Z/tong.json` (dist 3054, cùng vai) — **bản TRƯỚC vá**.
 * `px2` là con số QA đo được trên ảnh; nó là ĐỐI CHỨNG cho chính giáo cụ này.
 */
interface CaThat {
  may: number;
  vp: string;
  khung: { rong: number; cao: number };
  nhan: NhanUngVien;
  badge: BadgeUngVien;
  px2: number;
}

const CA_THAT: readonly CaThat[] = [
  {
    may: 18,
    vp: "1600x900",
    khung: { rong: 1000, cao: 324 },
    // page nhãn (694,132)→(882,156) · badge (716,145)→(861,162) · canvas (288,125)
    nhan: { khoa: "may:18", x: 500, y: 31, khoangCachMet: 0, rongPx: 188, caoPx: 24 },
    badge: { id: 11, x: 500.5, y: 28.5, diemUuTien: 1002, ngoaiKhung: true, rongPx: 144, caoPx: 17 },
    px2: 1584,
  },
  {
    may: 18,
    vp: "1280x720",
    khung: { rong: 680, cao: 280 },
    // page nhãn (638,150)→(826,174) · badge (556,145)→(700,162) · canvas (288,125)
    nhan: { khoa: "may:18", x: 444, y: 49, khoangCachMet: 0, rongPx: 188, caoPx: 24 },
    badge: { id: 11, x: 340, y: 28.5, diemUuTien: 1002, ngoaiKhung: true, rongPx: 144, caoPx: 17 },
    px2: 744,
  },
  {
    may: 23,
    vp: "1600x900",
    khung: { rong: 1000, cao: 324 },
    // page nhãn (706,140)→(870,164) · badge (728,145)→(849,162) · canvas (288,125)
    nhan: { khoa: "may:23", x: 500, y: 39, khoangCachMet: 0, rongPx: 164, caoPx: 24 },
    badge: { id: 12, x: 500.5, y: 28.5, diemUuTien: 1002, ngoaiKhung: true, rongPx: 121, caoPx: 17 },
    px2: 2057,
  },
  {
    may: 23,
    vp: "1280x720",
    khung: { rong: 680, cao: 280 },
    // page nhãn (546,134)→(710,158) · badge (568,145)→(689,162) · canvas (288,125)
    nhan: { khoa: "may:23", x: 340, y: 33, khoangCachMet: 0, rongPx: 164, caoPx: 24 },
    badge: { id: 12, x: 340.5, y: 28.5, diemUuTien: 1002, ngoaiKhung: true, rongPx: 121, caoPx: 17 },
    px2: 1573,
  },
];

function nhanSauKhiNhuong(ca: CaThat, so: readonly HinhChuNhat[]) {
  return locNhan([ca.nhan], {
    khungCanvas: ca.khung,
    vungCam: so,
    xepTang: true,
    xepTangXuong: true,
    doiNgang: true,
  });
}

describe("★★★ Đợt 55 (B) — SỐ THẬT cho CẢ máy 18 VÀ máy 23, hai viewport (4 ca)", () => {
  for (const ca of CA_THAT) {
    it(`ĐỐI CHỨNG SỐ ĐO — máy ${ca.may} @${ca.vp}: giáo cụ tái hiện ĐÚNG ${ca.px2} px² QA đo được`, () => {
      expect(dienTichGiao(hopNhan(ca.nhan), hopBadge(ca.badge))).toBe(ca.px2);
    });

    it(`★★★ KẾT CỤC — máy ${ca.may} @${ca.vp}: sổ nhận hopManHinh ⇒ 0 px², nhãn KHÔNG bị giấu`, () => {
      const kqBadge = locBadge([ca.badge], { khungCanvas: ca.khung, doiCho: true });
      const so = soTheoSanPham(kqBadge);
      expect(so).toHaveLength(1); // VẼ 1 == VÀO SỔ 1 (sổ do SẢN PHẨM chọn)

      const kqNhan = nhanSauKhiNhuong(ca, so);
      expect(kqNhan.ve).toHaveLength(1);
      expect(kqNhan.soBiChe).toBe(0);
      expect(dienTichGiao(kqNhan.ve[0].hop, hopBadge(ca.badge))).toBe(0);
      // Dời không được đổi một lỗi lấy một lỗi: nhãn vẫn TRỌN trong canvas.
      expect(kqNhan.ve[0].hop.tren).toBeGreaterThanOrEqual(0);
      expect(kqNhan.ve[0].hop.duoi).toBeLessThanOrEqual(ca.khung.cao);
    });

    it(`★★★ ABLATION (chiều ngược) — máy ${ca.may} @${ca.vp}: sổ CŨ rỗng ⇒ chồng quay lại ĐÚNG ${ca.px2} px²`, () => {
      const kqBadge = locBadge([ca.badge], { khungCanvas: ca.khung, doiCho: true });
      const so = soCu(kqBadge);
      expect(so).toHaveLength(0); // chính chỗ mất dữ kiện

      const kqNhan = nhanSauKhiNhuong(ca, so);
      expect(kqNhan.ve[0].tang).toBe(0); // không nhường vì không biết badge tồn tại
      expect(dienTichGiao(kqNhan.ve[0].hop, hopBadge(ca.badge))).toBe(ca.px2);
    });
  }

  it("★★★ TỔNG KẾT ABLATION HAI CHIỀU trên cả 4 ca — 0/4 px² sau vá · 4/4 ĐỎ khi gỡ hopManHinh", () => {
    const sauVa: number[] = [];
    const khiGo: number[] = [];
    for (const ca of CA_THAT) {
      const kq = locBadge([ca.badge], { khungCanvas: ca.khung, doiCho: true });
      sauVa.push(dienTichGiao(nhanSauKhiNhuong(ca, soTheoSanPham(kq)).ve[0].hop, hopBadge(ca.badge)));
      khiGo.push(dienTichGiao(nhanSauKhiNhuong(ca, soCu(kq)).ve[0].hop, hopBadge(ca.badge)));
    }
    expect(sauVa).toEqual([0, 0, 0, 0]);
    expect(khiGo).toEqual(CA_THAT.map((c) => c.px2));
    // Máy 23 NẶNG HƠN máy 18 ở cả hai viewport — số này là lý do lưới một-máy nguy hiểm.
    expect(khiGo[2]).toBeGreaterThan(khiGo[0]);
    expect(khiGo[3]).toBeGreaterThan(khiGo[1]);
  });
});
