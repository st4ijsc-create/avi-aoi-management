/**
 * canhTapDoan.ts — CẢNH PHẠM VI **TẬP ĐOÀN**: chọn nhà máy để nạp, và dời chỗ
 * từng khối nhà máy vào một khuôn viên chung (Task 19, Giai đoạn 6).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ VÌ SAO MODULE NÀY TỒN TẠI — MỘT LỜI KHAI HẠN CHẾ ĐÃ HẾT HẠN
 * ════════════════════════════════════════════════════════════════════════════
 * `boChonNap.phamViThuc()` ra đời ở Đợt 10 lô F với một lý do đo được: thủ tục
 * `twinCanh.canhThietKe` khi ấy nhận **ĐÚNG MỘT** `factoryId`, nên `?pv=tapdoan`
 * mà khai "Tập đoàn" là nói dối — lô F chọn hạ cấp và **nói thẳng lý do** trên
 * màn thay vì hạ cấp im lặng.
 *
 * Task 18 (`40f04457`) mở hợp đồng ấy: `canhThietKe` nay nhận `factoryIds` (≤ 8)
 * và `tangIds` (≤ 300), lọc phạm vi TỪNG mã. Từ khoảnh khắc đó, câu *"Phạm vi
 * Tập đoàn chưa nạp được nhiều nhà máy cùng lúc"* trở thành **lời khai sai theo
 * chiều ngược** — sản phẩm nói dối về chính năng lực nó vừa có. Module này là
 * nửa còn lại: phía trình duyệt thật sự nạp và vẽ nhiều khối nhà máy.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ HAI VIỆC, VÀ VÌ SAO CHÚNG Ở CÙNG MỘT TỆP
 * ════════════════════════════════════════════════════════════════════════════
 *   1. {@link nhaMayDeNap} — *hỏi dữ liệu của những nhà máy nào*, kèm trần và
 *      phần bị cắt (cắt thì phải KÊU, cùng khuôn `tangIdsDeHoi`).
 *   2. {@link khuonVienTapDoan} — *đặt các khối ấy ở đâu trong cảnh*.
 *
 * Hai việc này dính nhau bằng một bất biến: **tập nhà máy được nạp quyết định
 * kích thước khuôn viên**, và kích thước khuôn viên quyết định sàn/camera. Tách
 * ra hai tệp thì lần đầu ai đó đổi trần, một nửa sẽ quên.
 *
 * ★ Module THUẦN — không react, không three, không `window`, không đọc DOM.
 *   `vitest` chạy `environment: "node"` và chỉ thu `.unit.test.ts` (RB-8.1).
 */

import type { CapPhamVi } from "./duongDanTwin";

/* ═══════════════════════════════════════════════════════════════════════════ */
/* 1. CHỌN NHÀ MÁY ĐỂ NẠP                                                      */
/* ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Trần số nhà máy một lượt hỏi.
 *
 * ⚠⚠ **PHẢI KHỚP `factoryIds: z.array(...).min(1).max(8)`** ở
 *   `server/routers/twinCanhRouter.ts` (thủ tục `canhThietKe` **và**
 *   `toaNhaTangNhieuNhaMay` — hai thủ tục phục vụ đúng một lượt vẽ nên chúng
 *   dùng chung con số này). Nới một bên thì Zod ném `BAD_REQUEST` và cảnh trắng;
 *   hạ một bên thì client tự cắt sớm hơn cần. Đây là hằng CÓ TÊN chính vì thế —
 *   để lưới đo được GIÁ TRỊ, không phải đếm chính tả một dòng mã.
 *
 * Căn cứ của con số 8 (thiết kế §6.2, đo được, không phải số đẹp): 3 nhà máy
 * QATD = 10 câu SQL / 25 ms / 55 KB gzip ở đường cổng gộp, và **số câu không
 * tăng theo số nhà máy**. 8 ≈ 3.000 máy ≈ 150 KB gzip — *trần của cái đã đo,
 * nhân hơn hai lần*. Trần đặt ở ĐƠN VỊ NGƯỜI DÙNG HIỂU (số nhà máy) chứ không ở
 * số máy: một trần theo số máy sẽ cắt giữa một nhà máy và vẽ nửa nhà máy mà
 * không ai biết.
 */
export const TRAN_NHA_MAY_MOT_LUOT = 8;

/** Kết quả chọn nhà máy: cái GỬI ĐI, và cái BỊ BỎ LẠI — vế hai không được giấu. */
export interface NhaMayDeNap {
  /** Mã nhà máy thật sự gửi lên server (≤ `tran`, đã khử trùng, tăng dần). */
  gui: number[];
  /** Tổng số nhà máy CẦN hỏi, trước khi cắt. */
  tong: number;
  /** Số nhà máy bị bỏ lại. `0` = không cắt gì. */
  biCat: number;
  /** Trần đang áp — trả ra để giao diện nêu con số THẬT, không hằng hoá lần hai. */
  tran: number;
  /**
   * `true` = lượt nạp này là **cảnh khuôn viên** (mọi nhà máy trong phạm vi, mọi
   * toà, mọi tầng). `false` = cảnh một tầng của một toà như trước.
   *
   * ⚠ Đây KHÔNG suy được từ `gui.length === 1`: người chỉ được gán một nhà máy
   *   mở `?pv=tapdoan` vẫn phải thấy **cả nhà máy đó** (4 toà × 7 tầng), chứ
   *   không phải một tầng. Lẫn hai thứ này chính là cách N2 của thiết kế §9 bị
   *   khai láo — "một cụm" cũng là kết quả khi tính năng gộp **chưa bật**.
   */
  gopKhuonVien: boolean;
}

/**
 * Chọn tập nhà máy để nạp cho một lượt xem.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ LUẬT: PHẠM VI TẬP ĐOÀN NẠP **MỌI NHÀ MÁY ĐÃ QUA HÀNG RÀO**, KHÔNG PHẢI
 *     "MỌI NHÀ MÁY CÓ THẬT"
 * ════════════════════════════════════════════════════════════════════════════
 * `dsTrongPhamVi` là danh sách `factory.list` trả về — tức con số **ĐÃ QUA**
 * `resolveTenantFactoryScope`. Client KHÔNG lọc lại phạm vi ở đây và cũng không
 * được phép: hàng rào nằm ở server (`traCayPhanCapNhieuNhaMay` BB-1), và một bộ
 * lọc thứ hai ở client là bộ luật thứ hai — đúng lớp lỗi
 * `mqttOeeRouters.getScopeLabels` (hai bộ suy độc lập canh hai nửa một câu).
 *
 * ⇒ Hệ quả có chủ ý: vai được gán **một** nhà máy mở `?pv=tapdoan` nhận
 *   `gui = [nhà máy đó]` và `gopKhuonVien = true`. Họ thấy **một** khối, và đó
 *   là câu ĐÚNG với thế giới của họ (xem docblock `phamViThuc` ở `boChonNap.ts`
 *   về phép đo lại 2026-09-07).
 *
 * ⚠ Cắt vì vượt trần **phải trả về số bị cắt**, không `slice` câm. `slice` không
 *   kêu: phần dư biến mất và màn hiện một tập đoàn thiếu một phần, không lỗi,
 *   không banner — chính lớp lỗi mà `tangIdsDeHoi` đã phải vá ở trục tầng.
 *
 * ⚠ Trần `<= 0` được coi là "không cắt": một trần 0 làm cảnh trắng trong im
 *   lặng, tức đúng lỗi này ở dạng nặng hơn.
 *
 * @param capYeuCau  cấp phạm vi NGƯỜI DÙNG yêu cầu (từ URL), chưa qua hạ cấp
 * @param dsTrongPhamVi mã nhà máy `factory.list` trả về (đã qua hàng rào tenant)
 * @param nhaMayDangChon nhà máy đang chọn ở ô Nhà máy; `null` khi chưa phân giải
 */
export function nhaMayDeNap(
  capYeuCau: CapPhamVi,
  dsTrongPhamVi: readonly number[],
  nhaMayDangChon: number | null,
  tran: number = TRAN_NHA_MAY_MOT_LUOT,
): NhaMayDeNap {
  const tranThuc = !Number.isFinite(tran) || tran <= 0 ? Number.POSITIVE_INFINITY : tran;

  if (capYeuCau !== "tapDoan") {
    return {
      gui: nhaMayDangChon === null ? [] : [nhaMayDangChon],
      tong: nhaMayDangChon === null ? 0 : 1,
      biCat: 0,
      tran,
      gopKhuonVien: false,
    };
  }

  // Khử trùng + sắp tăng dần: thứ tự PHẢI ổn định theo MÃ, không theo thứ tự
  // mảng `factory.list` trả về. Khối nhà máy được rải theo chỉ số trong danh
  // sách này (xem `khuonVienTapDoan`), nên một thứ tự đổi theo lượt tải sẽ làm
  // cảnh nhảy chỗ giữa hai lần F5 — đúng lỗi §10C.6 mà §11e.6 đã ghi.
  const ds = [...new Set(dsTrongPhamVi)].filter((n) => Number.isInteger(n) && n > 0).sort((a, b) => a - b);
  const tong = ds.length;
  if (tong === 0) {
    return { gui: [], tong: 0, biCat: 0, tran, gopKhuonVien: false };
  }
  const gui = tong <= tranThuc ? ds : ds.slice(0, tranThuc);
  return {
    gui,
    tong,
    biCat: tong - gui.length,
    tran,
    gopKhuonVien: true,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* 2. KHUÔN VIÊN — ĐẶT CÁC KHỐI NHÀ MÁY Ở ĐÂU                                  */
/* ═══════════════════════════════════════════════════════════════════════════ */

/** Toà nhà như `twinCanh.toaNhaTangNhieuNhaMay` trả về (numeric đã quy về số). */
export interface ToaNhaKhuonVien {
  id: number;
  factoryId: number;
  viTriXMm?: number | string | null;
  viTriYMm?: number | string | null;
  viTriZMm?: number | string | null;
  rongMm?: number | string | null;
  sauMm?: number | string | null;
}

/** Toà nhà SAU khi dời về hệ toạ độ khuôn viên — hình dạng `gocToaTheoTang` nhận. */
export interface ToaNhaDaDoi {
  id: number;
  factoryId: number;
  viTriXMm: number;
  viTriYMm: number;
  viTriZMm: number;
}

/** Bao hình (AABB) của một nhà máy trong mặt bằng khuôn viên, đơn vị mm. */
export interface KhoiNhaMay {
  factoryId: number;
  xMm: number;
  yMm: number;
  rongMm: number;
  sauMm: number;
  /** Số toà nhà góp vào bao hình này — tiền đề chống "bao hình của tập rỗng". */
  soToa: number;
}

export interface KhuonVien {
  /** Toà nhà đã dời; góc trái-dưới của khuôn viên nằm ở `(0, 0)`. */
  toaNha: ToaNhaDaDoi[];
  /** Bao hình từng nhà máy SAU khi dời, theo mã nhà máy tăng dần. */
  khoi: KhoiNhaMay[];
  /** Bề rộng (trục X) và bề sâu (trục Y) của cả khuôn viên, mm. */
  rongMm: number;
  sauMm: number;
  /**
   * `true` ⇒ **vị trí đang là tạm sinh**, không phải toạ độ thật trong CSDL.
   * Giao diện PHẢI nói ra điều này. Im lặng dời một nhà máy đang có toạ độ thật
   * là nói dối; im lặng để chúng chồng nhau cũng là nói dối (thiết kế §5.3).
   */
  daRaiLuoi: boolean;
  /** Số cặp bao hình GIAO NHAU **trước** khi rải. `0` = dữ liệu tự đủ. */
  soCapChong: number;
}

/** Khe hở giữa hai khối khi phải rải lưới — 50 m, đủ để mắt tách được hai cụm. */
export const KHE_HO_KHOI_MM = 50_000;

const soMm = (gt: number | string | null | undefined): number => {
  if (gt === null || gt === undefined) return 0;
  const n = typeof gt === "number" ? gt : Number(gt);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Dời từng khối nhà máy vào một khuôn viên chung.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ D-1 LÀM NỀN, LƯỚI CHỈ LÀ LỐI THOÁT KHI ĐO ĐƯỢC LÀ CHỒNG (thiết kế §5.3)
 * ════════════════════════════════════════════════════════════════════════════
 * Toạ độ `twin_dat_cho.viTriXMm/YMm` là toạ độ **TRONG TẦNG** — mọi toà đều bắt
 * đầu từ 0. Số hạng duy nhất phân biệt hai toà là `twin_toa_nha.viTriXMm/YMm`,
 * và cột ấy **đã có thật, đã điền** (Task 17c đã nối nó vào cảnh qua
 * `gocToaTheoTang`). Nên phép dời chỗ mặc định là **dùng chính dữ liệu ấy**, cộng
 * một phép tịnh tiến chung để góc khuôn viên về `(0,0)` — sàn của `CanhVanHanh`
 * trải từ `0` tới `rongM/sauM` (`San` đặt tâm ở `[rongM/2, …, sauM/2]`), nên gốc
 * phải là GÓC chứ không phải tâm.
 *
 * ⚠⚠ **KHÔNG rải lưới vô điều kiện.** Bộ sinh dữ liệu đo (`sinh-tap-doan.mjs`)
 *   nướng sẵn bước cụm 1 km vào `twin_toa_nha.viTriXMm`, nên một lưới cố định
 *   chồng lên nó sẽ **cộng hai lần** và ba khối cách nhau `bước + 1 km`. Đó đúng
 *   là lỗi §10C.6 mà §11e.6 ghi lại ("bước lưới 400 m làm 4 khối 3 km lồng vào
 *   nhau"), chỉ theo chiều ngược. Kế hoạch Task 17c cũng cảnh báo nguyên văn
 *   điều này.
 *
 * ⇒ Luật: **đo trước, rải sau.** Tính bao hình từng nhà máy từ dữ liệu thật; chỉ
 *   khi có ít nhất một CẶP giao nhau mới rải cả tập lên một lưới một chiều theo
 *   mã nhà máy tăng dần — và khi ấy `daRaiLuoi = true` để màn nói ra rằng vị trí
 *   là tạm sinh. Đây là ca CÓ THẬT trong CSDL hôm nay: `SIM-FAC` có một toà ở
 *   `(0,0)`, nên hai nhà máy kiểu ấy cùng vào một cảnh sẽ chồng khít.
 *
 * ⚠ Rải thì **đặt lại** gốc mỗi nhà máy về `i * bước`, KHÔNG cộng thêm vào offset
 *   cũ. Cộng thêm là giữ nguyên khoảng cách sai của dữ liệu và thêm một khoảng
 *   nữa lên trên.
 *
 * ⚠ Toà thiếu `rongMm/sauMm` ⇒ bao hình của nó là một ĐIỂM (rộng 0), không phải
 *   một kích thước bịa ra. "Chưa biết" không được biến thành "biết rồi, bằng N".
 *
 * @returns `null` khi không có toà nào — *không* một khuôn viên rỗng kích thước
 *   0, vì `sanRongM` đọc từ đây và một sàn 0 × 0 là cảnh trắng không lời giải
 *   thích. Người gọi phải phân biệt "chưa tải xong" với "đã tải, 0 toà".
 */
export function khuonVienTapDoan(
  toaNhas: readonly ToaNhaKhuonVien[],
  kheHoMm: number = KHE_HO_KHOI_MM,
): KhuonVien | null {
  if (toaNhas.length === 0) return null;

  // ── Bao hình THẬT của từng nhà máy, theo mã tăng dần (thứ tự ổn định).
  const theoNhaMay = new Map<number, KhoiNhaMay>();
  for (const b of toaNhas) {
    const x = soMm(b.viTriXMm);
    const y = soMm(b.viTriYMm);
    const w = soMm(b.rongMm);
    const s = soMm(b.sauMm);
    const cu = theoNhaMay.get(b.factoryId);
    if (!cu) {
      theoNhaMay.set(b.factoryId, {
        factoryId: b.factoryId,
        xMm: x,
        yMm: y,
        rongMm: w,
        sauMm: s,
        soToa: 1,
      });
      continue;
    }
    const traiMoi = Math.min(cu.xMm, x);
    const duoiMoi = Math.min(cu.yMm, y);
    const phaiMoi = Math.max(cu.xMm + cu.rongMm, x + w);
    const trenMoi = Math.max(cu.yMm + cu.sauMm, y + s);
    cu.xMm = traiMoi;
    cu.yMm = duoiMoi;
    cu.rongMm = phaiMoi - traiMoi;
    cu.sauMm = trenMoi - duoiMoi;
    cu.soToa += 1;
  }
  const khoiThat = [...theoNhaMay.values()].sort((a, b) => a.factoryId - b.factoryId);

  // ── Đếm cặp bao hình GIAO NHAU. Chạm mép (phải === trái) KHÔNG tính là chồng.
  let soCapChong = 0;
  for (let i = 0; i < khoiThat.length; i += 1) {
    for (let j = i + 1; j < khoiThat.length; j += 1) {
      const a = khoiThat[i];
      const b = khoiThat[j];
      const giaoX = a.xMm < b.xMm + b.rongMm && b.xMm < a.xMm + a.rongMm;
      const giaoY = a.yMm < b.yMm + b.sauMm && b.yMm < a.yMm + a.sauMm;
      if (giaoX && giaoY) soCapChong += 1;
    }
  }
  const daRaiLuoi = soCapChong > 0;

  // ── Chỗ dời của TỪNG nhà máy.
  const doiTheoNhaMay = new Map<number, { xMm: number; yMm: number }>();
  if (daRaiLuoi) {
    const buoc = Math.max(...khoiThat.map((k) => k.rongMm), 0) + Math.max(kheHoMm, 0);
    khoiThat.forEach((k, i) => {
      // ĐẶT LẠI gốc về `i * bước`, không cộng dồn lên offset cũ.
      doiTheoNhaMay.set(k.factoryId, { xMm: i * buoc - k.xMm, yMm: -k.yMm });
    });
  } else {
    const gocX = Math.min(...khoiThat.map((k) => k.xMm));
    const gocY = Math.min(...khoiThat.map((k) => k.yMm));
    for (const k of khoiThat) doiTheoNhaMay.set(k.factoryId, { xMm: -gocX, yMm: -gocY });
  }

  // ── Áp chỗ dời.
  const toaNha: ToaNhaDaDoi[] = toaNhas.map((b) => {
    const d = doiTheoNhaMay.get(b.factoryId) ?? { xMm: 0, yMm: 0 };
    return {
      id: b.id,
      factoryId: b.factoryId,
      viTriXMm: soMm(b.viTriXMm) + d.xMm,
      viTriYMm: soMm(b.viTriYMm) + d.yMm,
      // ★ Z KHÔNG dời: `twin_dat_cho.viTriZMm` đã là cao độ TUYỆT ĐỐI trong toà
      //   (bằng `twin_tang.caoDoMm`), nên chồng tầng vốn đã đúng (thiết kế §5.1).
      viTriZMm: soMm(b.viTriZMm),
    };
  });
  const khoi: KhoiNhaMay[] = khoiThat.map((k) => {
    const d = doiTheoNhaMay.get(k.factoryId) ?? { xMm: 0, yMm: 0 };
    return { ...k, xMm: k.xMm + d.xMm, yMm: k.yMm + d.yMm };
  });

  return {
    toaNha,
    khoi,
    rongMm: Math.max(...khoi.map((k) => k.xMm + k.rongMm), 0),
    sauMm: Math.max(...khoi.map((k) => k.yMm + k.sauMm), 0),
    daRaiLuoi,
    soCapChong,
  };
}
