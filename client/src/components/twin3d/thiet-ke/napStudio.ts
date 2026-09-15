/**
 * napStudio.ts — BỘ CHỌN "THIẾT KẾ CÁI GÌ" của màn `/twin-studio` (vá PH-14).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ VÌ SAO MODULE NÀY TỒN TẠI — QA LẦN 11 ĐO ĐƯỢC, KHÔNG PHẢI SUY ĐOÁN
 * ════════════════════════════════════════════════════════════════════════════
 * `TwinStudio.tsx` trước bản này nạp `toaNhaQ.data[0]` → `chiTietQ.data.tangs[0]`
 * — **hai chỉ số `[0]` viết cứng**, và `grep -cE "setToaNha|setTang|chon-toa-nha
 * |chon-tang"` trên tệp đó = **0**. Hậu quả đo được trên kịch bản tập đoàn
 * (4 toà × 7 tầng, `.qa-tapdoan/BANG-DE.md` ô 22):
 *
 *   · `dem-toa-nha` in *"Building: **4**"* nhưng màn chỉ có MỘT bộ chọn
 *     (`chon-nha-may`) — không ô chọn Toà, không ô chọn Tầng;
 *   · dải sức khoẻ in *"45 machines placed · **326 awaiting placement**"*;
 *   · 45 = ĐÚNG số máy của `twin_tang` id 81 (toà 1, tầng 1) trong DB
 *     ⇒ **326/371 máy (88 %) không thể xếp chỗ bằng màn thiết kế**.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ NĂNG LỰC NÀY ĐÃ TỒN TẠI Ở MÀN XEM — TÁI DÙNG, KHÔNG VIẾT LẠI
 * ════════════════════════════════════════════════════════════════════════════
 * Màn `/twin` đã vá ĐÚNG lỗi này ở Đợt 10 lô F (§11e.6 F1): `phanGiaiNap()` +
 * `BoChonNapUI`. Module ở đây **gọi thẳng `phanGiaiNap`** thay vì chép luật
 * sang tệp thứ hai — hai bản sao của cùng một luật là hai chỗ để chúng lệch
 * nhau, và lệch âm thầm (mỗi bên có test riêng, cả hai xanh).
 *
 * ⚠ ĐIỀU **KHÔNG** TÁI DÙNG, VÀ VÌ SAO: màn xem có HAI trục — "NẠP" (hỏi dữ
 *   liệu của cái nào) và "PHẠM VI" (`?pv=`, đang NHÌN cấp nào, quyết định camera
 *   + độ mờ + breadcrumb). Studio chỉ có trục NẠP: nó luôn đứng ở một mặt sàn để
 *   đặt máy, không có khái niệm "lùi ra xem cả tập đoàn". Kéo `PhamVi` sang đây
 *   là mang theo cả `phamViThuc()`/`daHaCap`/breadcrumb cho một màn không dùng
 *   tới chúng.
 *
 * ⚠ VÀ **KHÔNG** MỞ RỘNG `tangIds`: màn xem hỏi MỌI tầng của toà đang chọn (lô F
 *   mục F2, để phân biệt "ở tầng khác" với "chưa xếp chỗ"). Studio VẼ một mặt
 *   sàn và cho kéo-thả trên đó; hỏi nhiều tầng sẽ chồng máy của các tầng lên
 *   nhau trong cùng một cảnh. Nên `tangIdsHoi` ở đây là ĐÚNG MỘT tầng — giữ
 *   nguyên hợp đồng mà `XuongThietKe` đang có, chỉ khác ở chỗ **tầng nào** nay
 *   là một lựa chọn chứ không phải `[0]`.
 *
 * ★ Module THUẦN — không react, không trpc, không `window`. `vitest` chạy
 *   `environment: "node"` và chỉ thu `.unit.test.ts` (RB-8.1).
 */

import { phanGiaiNap, type MucChon, type YeuCauNap } from "../van-hanh/boChonNap";

/** Một hàng `factories` như `factory.list` trả về. */
export interface NhaMayTho {
  id: number;
  name?: string | null;
  code?: string | null;
}

/**
 * Một hàng `twin_toa_nha` như `twinCanh.danhSachToaNha` trả về.
 *
 * ⚠ `rongMm`/`sauMm` là `numeric(14,3)` ⇒ drizzle trả **STRING**. Xem
 *   {@link sanCuaTang} về vì sao `Number(...)` tường minh là bắt buộc.
 */
export interface ToaNhaTho {
  id: number;
  ma?: string | null;
  ten?: string | null;
  rongMm: string | number;
  sauMm: string | number;
}

/** Một hàng `twin_tang` như `twinCanh.chiTietToaNha` trả về (kèm trạng thái ảnh nền). */
export interface TangTho {
  id: number;
  capSo?: number | null;
  ten?: string | null;
  anhNenUrl?: string | null;
  tiLeMmMoiPx?: number | string | null;
  daHieuChuan?: boolean | null;
}

/** Hình sàn + trạng thái ảnh nền của TẦNG ĐANG CHỌN — đầu vào của `XuongThietKe`. */
export interface SanThietKe {
  tangId: number;
  rongMm: number;
  sauMm: number;
  anhNenUrl: string | null;
  tiLeMmMoiPx: number | null;
  daHieuChuan: boolean;
}

/** Toàn bộ thứ `TwinStudio` cần cho một lượt nạp. */
export interface NapThietKe {
  /** Mục cho ba ô chọn (`BoChonNapUI`). */
  mucNhaMay: MucChon[];
  mucToaNha: MucChon[];
  mucTang: MucChon[];
  nhaMayId: number | null;
  toaNhaId: number | null;
  tangId: number | null;
  /**
   * `tangIds` gửi lên `twinCanh.canhThietKe` — ĐÚNG MỘT tầng (xem docblock đầu
   * tệp), hoặc rỗng khi chưa có tầng nào.
   */
  tangIdsHoi: number[];
  /** `null` khi nhà máy chưa có toà/tầng — KHÔNG bịa ra một mặt sàn giả. */
  san: SanThietKe | null;
}

/** Dữ liệu thô của một lượt nạp: ba danh sách, mỗi cái từ một truy vấn. */
export interface DuLieuNap {
  nhaMay: readonly NhaMayTho[];
  /** Toà của nhà máy ĐANG CHỌN (`danhSachToaNha` đã keyed theo `factoryId`). */
  toaNha: readonly ToaNhaTho[];
  /** Tầng của toà ĐANG CHỌN (`chiTietToaNha` đã keyed theo `toaNhaId`). */
  tang: readonly TangTho[];
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* Nhãn cho ba ô chọn — không ô nào được rỗng                                  */
/* ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Nhãn rơi bậc `name → code → #id`.
 *
 * ★ Bậc cuối `#id` KHÔNG phải để cho đẹp: một `<option>` rỗng là một dòng người
 *   dùng không chọn lại được sau khi đã rời khỏi nó, và không phân biệt được với
 *   "đang tải". Id luôn có thật nên luôn nói được một câu đúng.
 */
export function mucNhaMayTu(ds: readonly NhaMayTho[]): MucChon[] {
  return ds.map((f) => ({ id: f.id, nhan: f.name || f.code || `#${f.id}` }));
}

/** Nhãn toà: `ten → ma → #id`. Khớp nguyên văn `TwinVanHanh.tsx` (một cách gọi tên). */
export function mucToaNhaTu(ds: readonly ToaNhaTho[]): MucChon[] {
  return ds.map((b) => ({ id: b.id, nhan: b.ten || b.ma || `#${b.id}` }));
}

/** Nhãn tầng: `ten → "Tầng <capSo>" → #id`. Khớp nguyên văn `TwinVanHanh.tsx`. */
export function mucTangTu(ds: readonly TangTho[]): MucChon[] {
  return ds.map((s) => ({
    id: s.id,
    nhan: s.ten || (s.capSo != null ? `Tầng ${s.capSo}` : `#${s.id}`),
  }));
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* Hình sàn của tầng đang chọn                                                  */
/* ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Ghép kích thước SÀN (của toà) với trạng thái ẢNH NỀN (của tầng).
 *
 * ★★★ `numeric(14,3)` về từ drizzle là **string**; `Number(...)` tường minh ở đây
 *   là bắt buộc. Cộng thẳng hai giá trị string sẽ NỐI CHUỖI ("38400" + "0" =
 *   "384000") — không throw, không lỗi nào nổ, và nhà xưởng to gấp mười lần.
 *
 * ★ Ảnh nền đọc từ chính hàng `twin_tang` mà `chiTietToaNha` đã trả (nó spread
 *   nguyên hàng). Gọi thêm một truy vấn cho cùng dữ liệu là mở đường cho hai chỗ
 *   hiện hai trạng thái hiệu chuẩn khác nhau — và người dùng không biết tin cái nào.
 */
export function sanCuaTang(toa: ToaNhaTho, tang: TangTho): SanThietKe {
  return {
    tangId: tang.id,
    rongMm: Number(toa.rongMm),
    sauMm: Number(toa.sauMm),
    anhNenUrl: tang.anhNenUrl ?? null,
    tiLeMmMoiPx:
      tang.tiLeMmMoiPx === null || tang.tiLeMmMoiPx === undefined
        ? null
        : Number(tang.tiLeMmMoiPx),
    daHieuChuan: tang.daHieuChuan === true,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* Phân giải một lượt nạp                                                       */
/* ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Phân giải "đang thiết kế nhà máy/toà/tầng nào" trên tập CÓ THẬT.
 *
 * ★★★ Luật phân giải là `phanGiaiNap()` của lô F, gọi nguyên xi ba lần — một id
 *   không có trong danh sách KHÔNG được im lặng dùng (`?toa=9999` sẽ cho một
 *   nhà máy TRỐNG, tức lời khai sai về thế giới), mà rơi về phần tử đầu. Rơi về
 *   phần tử đầu ở đây khác hẳn `[0]` viết cứng ở chỗ: **có một ô chọn để đi chỗ
 *   khác**.
 *
 * ⚠ Dây chuyền, không phải ba phép độc lập: `duLieu.toaNha` phải là toà của nhà
 *   máy đang chọn và `duLieu.tang` là tầng của toà đang chọn. Người gọi bảo đảm
 *   điều đó bằng chính `enabled`/khoá của hai truy vấn (`danhSachToaNha` keyed
 *   theo `factoryId`, `chiTietToaNha` keyed theo `toaNhaId`). Đó cũng là lý do
 *   đổi nhà máy tự động rơi về toà đầu của nhà máy MỚI: id toà cũ không còn
 *   trong danh sách mới.
 */
export function giaiNapThietKe(muon: YeuCauNap, duLieu: DuLieuNap): NapThietKe {
  const mucNhaMay = mucNhaMayTu(duLieu.nhaMay);
  const mucToaNha = mucToaNhaTu(duLieu.toaNha);
  const mucTang = mucTangTu(duLieu.tang);

  const nhaMayId = phanGiaiNap(
    { nhaMayId: muon.nhaMayId, toaNhaId: null, tangId: null },
    { nhaMay: mucNhaMay, toaNha: [], tang: [] },
  ).nhaMayId;
  const toaNhaId = phanGiaiNap(
    { nhaMayId: null, toaNhaId: muon.toaNhaId, tangId: null },
    { nhaMay: [], toaNha: mucToaNha, tang: [] },
  ).toaNhaId;
  const tangId = phanGiaiNap(
    { nhaMayId: null, toaNhaId: null, tangId: muon.tangId },
    { nhaMay: [], toaNha: [], tang: mucTang },
  ).tangId;

  const toa = duLieu.toaNha.find((b) => b.id === toaNhaId) ?? null;
  const tang = duLieu.tang.find((s) => s.id === tangId) ?? null;

  return {
    mucNhaMay,
    mucToaNha,
    mucTang,
    nhaMayId,
    toaNhaId,
    tangId,
    // "Chưa có tầng" ≠ "tầng số 0": rỗng là câu trả lời, không phải một phép đếm.
    tangIdsHoi: tangId === null ? [] : [tangId],
    san: toa && tang ? sanCuaTang(toa, tang) : null,
  };
}
