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

/**
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ PH-48 — NHÃN CỦA THẺ `Metrics` KHI TẬP ĐO LÀ **NHIỀU NHÀ MÁY**
 * ════════════════════════════════════════════════════════════════════════════
 * Đo được (`.qa-tapdoan/anh/t21-sau/qatd_giamdoc-2-canvas.png`): ở `?pv=tapdoan`
 * thẻ `Metrics` in `"371 machines / Công ty A · Toà 1 · Tầng 1"` trong khi cảnh
 * nói về **ba** công ty và `dem-may` = 1.108. Hai nửa của khuyết tật ấy:
 *   · MẪU SỐ sai — vá ở server (PH-45, `overview` nhận `factoryIds`);
 *   · NHÃN sai — `nhanPhamViKpi` dựng từ BA Ô CHỌN (nhà máy · toà · tầng), và ba
 *     ô ấy chỉ mô tả được **một** nhà máy. Vá mẫu số mà giữ nhãn cũ là đổi chiều
 *     nói dối: con số nói ba, chữ nói một.
 *
 * ⇒ Ở cấp Tập đoàn, nhãn nói **TÊN CỦA TỪNG NHÀ MÁY ĐANG NẠP** — đúng tập mà mẫu
 *   số đếm trên. Không phải "Tập đoàn" (một tính từ: người đọc không biết nó gồm
 *   mấy nhà máy, và nó vẫn đúng khi chỉ nạp được một), không phải một con số
 *   ("3 nhà máy": nói SỐ LƯỢNG chứ không nói TẬP, nên vẫn hợp với một tập khác).
 *
 * ★ **0 khoá i18n mới** — mọi mảnh ở đây là DỮ LIỆU (tên nhà máy do người dùng
 *   đặt, đã nằm sẵn trong `mucNhaMay`), cùng luật RB-8.3 mà `nhanPhamViKpi` đang
 *   theo. Dấu nối `" · "` là CÙNG dấu nhãn ấy đang dùng, không phải dấu thứ hai.
 *
 * ⚠ Mã không tra được tên bị BỎ, không thay bằng `#id`: nhãn là thứ người đọc
 *   dùng để nhận ra nhà máy, và `#41` không nhận ra được gì. Bỏ hết ⇒ `null` ⇒
 *   `BangKpiNoi` không in dòng nhãn nào (NT-3.5: rỗng khác 0).
 *
 * Hàm THUẦN, giữ nguyên thứ tự `gui`, không sửa đầu vào.
 */
export function nhanTapNhaMay(
  gui: readonly number[],
  muc: readonly { id: number; nhan: string }[],
): string | null {
  const ten: string[] = [];
  for (const id of gui) {
    const t = muc.find((m) => m.id === id)?.nhan;
    if (t) ten.push(t);
  }
  return ten.length > 0 ? ten.join(" · ") : null;
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* 2. KHUÔN VIÊN — ĐẶT CÁC KHỐI NHÀ MÁY Ở ĐÂU                                  */
/* ═══════════════════════════════════════════════════════════════════════════ */

/** Toà nhà như `twinCanh.toaNhaTangNhieuNhaMay` trả về (numeric đã quy về số). */
export interface ToaNhaKhuonVien {
  id: number;
  factoryId: number;
  /**
   * Mã/tên như CSDL ghi — **nhãn** của biểu tượng trên sa bàn (Task 20).
   *
   * ⚠ Bỏ trống ⇒ {@link saBanTapDoan} trả chuỗi RỖNG, không bịa `"Toà #12"`:
   *   một nhãn bịa nhìn y hệt nhãn thật và không ai biết nó là bịa. Người gọi
   *   (trang) tự quyết định câu dự phòng vì chỉ ở đó mới gọi được `t()`.
   */
  ma?: string | null;
  ten?: string | null;
  viTriXMm?: number | string | null;
  viTriYMm?: number | string | null;
  viTriZMm?: number | string | null;
  rongMm?: number | string | null;
  sauMm?: number | string | null;
  caoMm?: number | string | null;
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

/* ═══════════════════════════════════════════════════════════════════════════ */
/* 3. SA BÀN QUY HOẠCH — ĐỔI **ĐƠN VỊ VẼ** Ở CẤP TẬP ĐOÀN (Task 20)            */
/* ═══════════════════════════════════════════════════════════════════════════ */

/**
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ VÌ SAO TỰ-KHỚP-KHUNG KHÔNG CỨU ĐƯỢC — PHÉP ĐO, KHÔNG PHẢI CẢM TÍNH
 * ════════════════════════════════════════════════════════════════════════════
 * Task 19 vẽ đúng 1.108 máy của ba nhà máy, ngân sách dưới trần cả bốn ô — và
 * màn hình vẫn **gần như ĐEN** (`.qa-tapdoan/anh/t19-sau/qatd_giamdoc-2-canvas.png`,
 * panel khai `Machines 1108`). Gốc rễ là một phép chia:
 *
 *   khuôn viên QATD rộng **2.240 m** · canvas rộng **968 px** ⇒ **2,3 m / pixel**
 *   ⇒ một máy rộng ~2 m còn **~1 px** — *dù khung ôm vừa khít*.
 *
 * Tức đây là vấn đề **TỈ LỆ**, không phải vấn đề khung: không có khung nhìn nào
 * làm 1 px thành 24 px. Đối chứng đã đo: cuộn vào 16 nấc thì cảnh **hiện ra**
 * (`t19-nhin-sau/2-cuon-16.png`) — WebGL vẽ đủ, mắt không đọc nổi.
 *
 * ⇒ Lối thoát duy nhất: **vẽ ÍT vật thể hơn và TO hơn**. Ở cấp tập đoàn, đơn vị
 *   vẽ thôi là *máy* và thành *toà nhà*: 3 công ty × 4 toà = **12 biểu tượng**.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ THỨ PHẢI ĐÚNG LÀ **QUAN HỆ**, KHÔNG PHẢI TOẠ ĐỘ (chủ dự án chốt 2026-09-16)
 * ════════════════════════════════════════════════════════════════════════════
 * Nguyên văn: *"không nhất thiết phải vẽ đúng tỉ lệ kích thước của từng toà nhà,
 * chỉ cần hiển thị dạng biểu tượng 3D, và hiển thị giống kiểu sa bàn quy hoạch
 * với mật độ và kích thước nhẹ phù hợp"*. Vậy ràng buộc còn lại là:
 *   · toà nào thuộc nhà máy nào — **một cụm = một nhà máy**, không lẫn;
 *   · các cụm **tách bạch** nhau, đọc được là ba cụm chứ không phải một vệt.
 *
 * ★★★ RÀNG BUỘC TRUNG THỰC (của dự án, không được bỏ): khi vị trí là **sơ đồ**
 *   chứ không phải toạ độ thật, giao diện **PHẢI NÓI RA**. Vì thế hàm này trả về
 *   {@link SaBanTapDoan.laSoDo} = `true` **luôn luôn** và giữ lại
 *   {@link SaBanTapDoan.thatRongMm}/`thatSauMm` — kích thước THẬT của khuôn viên
 *   — để banner nêu được CẢ HAI con số ("thật 2.240 m → sa bàn 629 m") thay vì
 *   một câu chung chung. Một banner chỉ *thỉnh thoảng* nói thật là nửa sự thật.
 */

/** Bề rộng/bề sâu TỐI THIỂU của một biểu tượng toà (mm) — 20 m. */
export const BIEU_TUONG_TOI_THIEU_MM = 20_000;

/** Chiều cao TỐI THIỂU của một biểu tượng toà (mm) — 6 m, đủ để thấy là khối. */
export const BIEU_TUONG_CAO_TOI_THIEU_MM = 6_000;

/** Khe giữa hai toà TRONG một cụm = 20 % cạnh ô, sàn dưới 10 m. */
export const KHE_TRONG_CUM_TI_LE = 0.2;
export const KHE_TRONG_CUM_TOI_THIEU_MM = 10_000;

/**
 * Khe giữa hai CỤM = 60 % cạnh cụm, và **luôn ≥ 3 lần** khe trong cụm.
 *
 * ⚠ Hai con số này không phải thẩm mỹ: nếu khe giữa cụm không LỚN HƠN HẲN khe
 *   trong cụm thì mắt (và mọi phép gom theo khe hở) đọc 12 toà thành một lưới
 *   đều, và "ba cụm" biến mất. Tỉ lệ 3× là ngưỡng để phép gom-theo-khe-hở còn
 *   phân biệt được — nó là một hợp đồng với PHÉP ĐO, không chỉ với con mắt.
 */
export const KHE_GIUA_CUM_TI_LE = 0.6;
export const KHE_GIUA_CUM_TOI_THIEU_LAN = 3;

/** Một biểu tượng toà nhà trên sa bàn — ĐƠN VỊ VẼ ở cấp tập đoàn. */
export interface BieuTuongToa {
  toaNhaId: number;
  factoryId: number;
  /** Cụm thứ mấy (0-based, theo mã nhà máy TĂNG DẦN — ổn định giữa hai lần tải). */
  chiSoCum: number;
  /** Tên/mã như CSDL ghi; RỖNG khi CSDL không có — người gọi tự lo câu dự phòng. */
  ten: string;
  ma: string;
  /** Góc trái-dưới của biểu tượng trên mặt bằng sa bàn (mm, hệ đã dời về `(0,0)`). */
  xMm: number;
  yMm: number;
  rongMm: number;
  sauMm: number;
  caoMm: number;
}

/** Ô chứa một cụm (một nhà máy) trên sa bàn — nền cụm + chỗ đặt nhãn cụm. */
export interface OCumSaBan {
  factoryId: number;
  chiSoCum: number;
  xMm: number;
  yMm: number;
  rongMm: number;
  sauMm: number;
  soToa: number;
}

/**
 * Sa bàn = một {@link KhuonVien} (để `gocToaTheoTang`/sàn/khung nhìn dùng y
 * nguyên đường cũ) **cộng** danh sách biểu tượng và hai con số của sự thật.
 */
export interface SaBanTapDoan extends KhuonVien {
  bieuTuong: BieuTuongToa[];
  oCum: OCumSaBan[];
  /** LUÔN `true`: ở cấp tập đoàn vị trí trên cảnh là SƠ ĐỒ, không phải toạ độ thật. */
  laSoDo: true;
  /** Bề rộng/bề sâu THẬT của khuôn viên (mm) — cái mà sa bàn đã thay thế. */
  thatRongMm: number;
  thatSauMm: number;
  /**
   * ★★★ PH-50 — CỠ CHUNG của MỌI biểu tượng (mm). Từ PH-50, **mặt bằng** của
   * biểu tượng là ƯỚC LỆ: mọi toà vẽ cùng một cỡ, và cỡ ấy là **trung vị của
   * chính tập đang xem**. Trả ra ĐÚNG hai con số này (thay vì để giao diện tự
   * đọc `bieuTuong[0]`) vì banner phải nêu được CON SỐ, và vì một phép suy thứ
   * hai ở tầng trên là bộ luật thứ hai — đúng lớp lỗi đợt này đã vá năm lần.
   */
  bieuTuongRongMm: number;
  bieuTuongSauMm: number;
  /**
   * Cạnh (rộng **hoặc** sâu) nhỏ nhất / lớn nhất THẬT trong tập, mm. Đây là cái
   * mà `bieuTuongRongMm/SauMm` đã THAY — giữ lại để màn nói được *đã thay cái
   * gì*, thay vì chỉ nói *đây là biểu tượng*. `lon/nho` chính là tỉ số mà bố cục
   * cũ đem chia vào từng biểu tượng (78,13 ở `qatd_admin`).
   */
  thatCanhNhoNhatMm: number;
  thatCanhLonNhatMm: number;
}

/** Tuỳ chọn bố cục — để lưới đo được GIÁ TRỊ thay vì đếm chính tả một dòng mã. */
export interface TuyChonSaBan {
  kheHoMm?: number;
  bieuTuongToiThieuMm?: number;
}

const kepDuong = (n: number, san: number): number => (Number.isFinite(n) && n > san ? n : san);

/**
 * Trung vị của một dãy số — **thống kê BỀN**, dùng làm cỡ biểu tượng chung.
 *
 * ⚠ Vì sao trung vị chứ không phải trung bình: một toà 3.000 m kéo trung bình
 *   của 14 toà lên 322 m (gấp 2,9 lần trung vị), tức ngoại lai vẫn thắng — chỉ
 *   là thắng ít hơn. Trung vị KHÔNG bị một ngoại lai kéo, và với dãy mà mọi
 *   phần tử bằng nhau thì trung vị **đúng bằng phần tử ấy** — đó chính là bất
 *   biến làm bốn vai QATD không đổi một pixel nào (xem docblock `saBanTapDoan`).
 *
 * ⚠ Dãy RỖNG trả `0`: người gọi đã chặn `toaNhas.length === 0` trước đó, nhưng
 *   một `Math.max()` trên tập rỗng trả `-Infinity` và lặng lẽ đầu độc cả bố cục
 *   — lớp lỗi ấy phải chết ở đây, không phải ở ba chỗ dùng.
 */
function trungVi(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const giua = s.length >> 1;
  return s.length % 2 === 1 ? s[giua] : (s[giua - 1] + s[giua]) / 2;
}

/**
 * Xếp mọi toà nhà của phạm vi thành **sa bàn quy hoạch**.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ HÀM NÀY GỌI {@link khuonVienTapDoan} TRƯỚC, VÀ ĐÓ LÀ CHỦ Ý
 * ════════════════════════════════════════════════════════════════════════════
 * Sa bàn vứt **vị trí** thật, nhưng nó KHÔNG được vứt *phép đo* về dữ liệu thật:
 * `soCapChong` (mấy cặp nhà máy chồng nhau trong CSDL) và `thatRongMm/thatSauMm`
 * (khuôn viên thật rộng bao nhiêu) là hai sự thật mà banner phải nêu được. Tính
 * chúng ở đây bằng chính hàm đã có lưới thay vì viết lại phép đo lần hai (G12).
 *
 * ────────────────────────────────────────────────────────────────────────────
 * BỐ CỤC — hai tầng lưới, cả hai theo **mã tăng dần** nên ổn định giữa hai F5:
 *   ① ô đơn vị = cạnh LỚN NHẤT trong toàn tập (mọi biểu tượng chung một lưới,
 *      nên một nhà máy có toà to không đẩy nhà máy bên cạnh lệch hàng);
 *   ② trong một cụm: lưới `ceil(√n)` cột — `n` = số toà của cụm ĐÔNG NHẤT, để
 *      mọi cụm có cùng hình dạng ô và đọc được là những khối cùng cỡ;
 *   ③ giữa các cụm: lại `ceil(√số cụm)` cột, khe giữa cụm ≥ 3× khe trong cụm.
 *
 * ⚠ Toà thiếu `rongMm/sauMm` ⇒ biểu tượng lấy **kích thước tối thiểu**, KHÔNG
 *   lấy 0. Đây là chỗ khác hẳn `khuonVienTapDoan` (ở đó "chưa biết" phải thành
 *   một ĐIỂM để bao hình không nói dối về diện tích): sa bàn không nói gì về
 *   diện tích — nó là BIỂU TƯỢNG, và một biểu tượng rộng 0 px thì người dùng
 *   mất luôn toà nhà khỏi màn hình mà không một dòng nào báo. Cả lớp nói-xấp-xỉ
 *   này được `laSoDo` khai ra MỘT LƯỢT, thay vì im lặng từng chỗ.
 *
 * ⚠ `viTriZMm` GIỮ NGUYÊN (không dời): cao độ đã tuyệt đối trong toà và tầng
 *   chồng lên nhau vốn đã đúng (thiết kế §5.1) — cùng bất biến với `khuonVienTapDoan`.
 *
 * @returns `null` khi không có toà nào — cùng lý do với `khuonVienTapDoan`.
 */
export function saBanTapDoan(
  toaNhas: readonly ToaNhaKhuonVien[],
  tuyChon: TuyChonSaBan = {},
): SaBanTapDoan | null {
  const that = khuonVienTapDoan(toaNhas, tuyChon.kheHoMm);
  if (that === null) return null;

  const toiThieu = kepDuong(tuyChon.bieuTuongToiThieuMm ?? BIEU_TUONG_TOI_THIEU_MM, 1);

  // ── Nhóm theo nhà máy (mã tăng dần), trong nhóm theo id toà tăng dần.
  const nhom = new Map<number, ToaNhaKhuonVien[]>();
  for (const b of toaNhas) {
    const ds = nhom.get(b.factoryId);
    if (ds) ds.push(b);
    else nhom.set(b.factoryId, [b]);
  }
  const maNhaMay = [...nhom.keys()].sort((a, b) => a - b);
  for (const ma of maNhaMay) {
    (nhom.get(ma) ?? []).sort((a, b) => a.id - b.id);
  }

  /*
   * ════════════════════════════════════════════════════════════════════════
   * ★★★ ① CỠ BIỂU TƯỢNG — ĐỒNG CỠ THEO **TRUNG VỊ** (PH-50, chủ dự án chốt)
   * ════════════════════════════════════════════════════════════════════════
   * Bản trước lấy **cạnh LỚN NHẤT TOÀN TẬP** làm ô đơn vị và để mỗi biểu tượng
   * giữ cỡ thật trong ô ấy. Phép chia mà cách đó ép vào từng biểu tượng:
   *
   *   bề rộng px của biểu tượng nhỏ nhất = 72,3 / (cạnh lớn nhất ÷ cạnh nhỏ nhất)
   *
   * (72,3 px = hằng của chính bố cục này ở 5 cụm × 4 toà, @1280×720 — nó KHÔNG
   * phụ thuộc cỡ tuyệt đối, chỉ phụ thuộc TỈ SỐ.) Ở vai `qatd_admin` tỉ số ấy
   * là **78,13** (một toà `FUYU-F` 3.000 m đứng cạnh 12 toà QATD 110 m và một
   * toà SIM 38,4 m) ⇒ **0,9 px**; đo sống được **1,2 px**, khuôn viên **28.920 m**,
   * và 3D **đen hoàn toàn** vì cả cảnh rơi ra ngoài mặt phẳng `far` của camera.
   * ⇒ Không khung nhìn nào bù được: 24 px đòi tỉ số ≤ 3,0 ở 2D và ≤ 1,9 ở 3D,
   *   mà dữ liệu thật cho 78.
   *
   * Chủ dự án chốt (2026-09-16, nhắc lại 2026-09-17): *"không nhất thiết phải vẽ
   * đúng tỉ lệ kích thước của từng toà nhà, chỉ cần hiển thị dạng biểu tượng 3D"*.
   * ⇒ Tỉ số := **1**. Mọi biểu tượng MỘT CỠ.
   *
   * ★★★ CỠ ẤY LÀ TRUNG VỊ CỦA CHÍNH TẬP ĐANG XEM — KHÔNG phải một hằng, và
   *   khác biệt ấy là cả bản vá:
   *   · mọi toà trong tập BẰNG NHAU ⇒ trung vị = chính cỡ ấy ⇒ sa bàn **không
   *     đổi một số nào**. Bốn vai QATD rơi đúng vào trường hợp này (12/12 toà đo
   *     được là 110.000 × 80.000 mm), và chúng đã được nghiệm thu BẰNG MẮT ở
   *     `c41892bc` — một hằng cố định sẽ làm cả bốn đổi hình.
   *   · một ngoại lai KHÔNG kéo được trung vị (khác `Math.max`, và khác cả trung
   *     bình: trung bình của tập admin là 322 m, gấp 2,9 lần trung vị).
   *
   * ⚠ **CHIỀU CAO GIỮ NGUYÊN SỐ THẬT.** Chỉ MẶT BẰNG là ước lệ. Cao 8/25/42 m
   *   trên mặt bằng 110 × 80 m vẫn đọc được và vẫn là thông tin thật — nên banner
   *   phải nói đúng chừng ấy ("mặt bằng vẽ cùng cỡ"), không được nói quá thành
   *   "kích thước là ước lệ". Nói quá cũng là một lời khai sai, chỉ lệch chiều.
   *
   * ⚠ Kẹp sàn TRƯỚC rồi mới lấy trung vị: kẹp sau thì một tập toàn toà thiếu số
   *   đo cho trung vị 0 và mọi biểu tượng biến mất — đúng lỗi mà `BIEU_TUONG_
   *   TOI_THIEU_MM` sinh ra để chặn.
   */
  const rongDaKep = toaNhas.map((b) => kepDuong(soMm(b.rongMm), toiThieu));
  const sauDaKep = toaNhas.map((b) => kepDuong(soMm(b.sauMm), toiThieu));
  const oRong = trungVi(rongDaKep);
  const oSau = trungVi(sauDaKep);
  const coCua = (b: ToaNhaKhuonVien) => ({
    rongMm: oRong,
    sauMm: oSau,
    caoMm: kepDuong(soMm(b.caoMm), BIEU_TUONG_CAO_TOI_THIEU_MM),
  });
  const kheToa = Math.max(KHE_TRONG_CUM_TI_LE * Math.max(oRong, oSau), KHE_TRONG_CUM_TOI_THIEU_MM);

  // ── ② Lưới TRONG cụm, dựng theo cụm ĐÔNG NHẤT (mọi cụm cùng hình dạng ô).
  const toaNhieuNhat = Math.max(...maNhaMay.map((ma) => (nhom.get(ma) ?? []).length));
  const cot = Math.max(1, Math.ceil(Math.sqrt(toaNhieuNhat)));
  const hang = Math.max(1, Math.ceil(toaNhieuNhat / cot));
  const cumRong = cot * oRong + (cot - 1) * kheToa;
  const cumSau = hang * oSau + (hang - 1) * kheToa;

  // ── ③ Lưới GIỮA các cụm.
  const kheCum = Math.max(
    KHE_GIUA_CUM_TI_LE * Math.max(cumRong, cumSau),
    KHE_GIUA_CUM_TOI_THIEU_LAN * kheToa,
  );
  const cotCum = Math.max(1, Math.ceil(Math.sqrt(maNhaMay.length)));
  const hangCum = Math.max(1, Math.ceil(maNhaMay.length / cotCum));

  /*
   * Viền quanh sa bàn = ĐÚNG một khe trong cụm. Không phải trang trí: `San` của
   * `CanhVanHanh` trải đúng từ `0` tới `rongM`, nên biểu tượng sát mép sẽ đứng
   * NGAY trên đường biên tấm sàn và trông như bị cắt.
   *
   * ⚠ Viền là bề rộng BỊ TRỪ khỏi ngân sách pixel của biểu tượng: lấy `kheCum/2`
   *   (thử đầu tiên) làm sa bàn QATD rộng thêm 9 % và tỉ số đọc-được tụt từ
   *   16,3 % xuống 14,2 %. Một viền đẹp mắt trả bằng đúng thứ Task 20 đi mua.
   */
  const vien = kheToa;

  const bieuTuong: BieuTuongToa[] = [];
  const oCum: OCumSaBan[] = [];
  maNhaMay.forEach((maNM, iCum) => {
    const cua = nhom.get(maNM) ?? [];
    const cumX = vien + (iCum % cotCum) * (cumRong + kheCum);
    const cumY = vien + Math.floor(iCum / cotCum) * (cumSau + kheCum);
    oCum.push({
      factoryId: maNM,
      chiSoCum: iCum,
      xMm: cumX,
      yMm: cumY,
      rongMm: cumRong,
      sauMm: cumSau,
      soToa: cua.length,
    });
    cua.forEach((b, iToa) => {
      const co = coCua(b);
      const oX = cumX + (iToa % cot) * (oRong + kheToa);
      const oY = cumY + Math.floor(iToa / cot) * (oSau + kheToa);
      bieuTuong.push({
        toaNhaId: b.id,
        factoryId: b.factoryId,
        chiSoCum: iCum,
        ten: typeof b.ten === "string" ? b.ten : "",
        ma: typeof b.ma === "string" ? b.ma : "",
        // Toà nhỏ hơn ô ⇒ đặt GIỮA ô: dồn về một góc làm lưới trông vỡ hàng.
        xMm: oX + (oRong - co.rongMm) / 2,
        yMm: oY + (oSau - co.sauMm) / 2,
        rongMm: co.rongMm,
        sauMm: co.sauMm,
        caoMm: co.caoMm,
      });
    });
  });

  // ── Toà đã dời: gốc của toạ độ TRONG TẦNG chính là góc trái-dưới biểu tượng.
  const viTriTheoToa = new Map(bieuTuong.map((v) => [v.toaNhaId, v]));
  const toaNha: ToaNhaDaDoi[] = toaNhas.map((b) => {
    const v = viTriTheoToa.get(b.id);
    return {
      id: b.id,
      factoryId: b.factoryId,
      viTriXMm: v ? v.xMm : 0,
      viTriYMm: v ? v.yMm : 0,
      viTriZMm: soMm(b.viTriZMm),
    };
  });

  // ── Bao hình từng nhà máy TRÊN SA BÀN (khít theo biểu tượng, không theo ô).
  const khoi: KhoiNhaMay[] = maNhaMay.map((maNM) => {
    const cua = bieuTuong.filter((v) => v.factoryId === maNM);
    const trai = Math.min(...cua.map((v) => v.xMm));
    const duoi = Math.min(...cua.map((v) => v.yMm));
    const phai = Math.max(...cua.map((v) => v.xMm + v.rongMm));
    const tren = Math.max(...cua.map((v) => v.yMm + v.sauMm));
    return {
      factoryId: maNM,
      xMm: trai,
      yMm: duoi,
      rongMm: phai - trai,
      sauMm: tren - duoi,
      soToa: cua.length,
    };
  });

  return {
    toaNha,
    khoi,
    rongMm: cotCum * cumRong + (cotCum - 1) * kheCum + 2 * vien,
    sauMm: hangCum * cumSau + (hangCum - 1) * kheCum + 2 * vien,
    // Sa bàn LUÔN là vị trí tạm sinh — không còn "chỉ khi đo được là chồng".
    daRaiLuoi: true,
    // ★ Con số của DỮ LIỆU THẬT, giữ nguyên từ `khuonVienTapDoan` (không tính lại).
    soCapChong: that.soCapChong,
    bieuTuong,
    oCum,
    laSoDo: true,
    thatRongMm: that.rongMm,
    thatSauMm: that.sauMm,
    // ★ PH-50 — cỡ ƯỚC LỆ đang dùng, và cái NÓ ĐÃ THAY. Hai vế đi cùng nhau:
    //   nêu mỗi vế đầu là khoe biểu tượng mà giấu mất việc đã bỏ thông tin gì.
    bieuTuongRongMm: oRong,
    bieuTuongSauMm: oSau,
    thatCanhNhoNhatMm: Math.min(...rongDaKep, ...sauDaKep),
    thatCanhLonNhatMm: Math.max(...rongDaKep, ...sauDaKep),
  };
}
