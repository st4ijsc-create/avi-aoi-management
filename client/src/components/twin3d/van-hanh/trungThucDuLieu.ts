/**
 * trungThucDuLieu.ts — §9.5 / NT-3: **KHÔNG CÓ DỮ LIỆU ≠ BÌNH THƯỜNG**.
 *
 * Đây là điều kiện SỐNG CÒN của màn Vận hành, không phải một tính năng phụ. Cạm
 * bẫy chết người nhất của mọi HMI: tag vẫn `Quality=Good` trong khi timestamp
 * ngừng tiến; màn hình vẫn vẽ số cuối cùng, badge vẫn xanh, không alarm nào nổ,
 * và người vận hành tin rằng nhà máy đang chạy.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ VÌ SAO MODULE NÀY KHÔNG PHẢI LÝ THUYẾT — SỐ ĐO CỦA CHÍNH DB NÀY
 * ════════════════════════════════════════════════════════════════════════════
 * Đo 2026-09-06 trên `aoi_management` (SQL thô, đường độc lập với tRPC):
 *
 *   42 máy `isActive`:  0 tươi · 0 cũ · **40 quá 5 phút** · 2 CHƯA TỪNG báo cáo
 *   `operationStatus`:  39 `stopped` · **3 `running`**
 *   `max(lastHeartbeat)` của nhóm `running` = **2026-07-17** (gần hai tháng trước)
 *
 * Nghĩa là: một bản cài đặt ngây thơ đọc `operationStatus` rồi tô màu sẽ vẽ **3
 * máy XANH ĐANG CHẠY** trên một nhà máy mà **không máy nào còn gửi tín hiệu**.
 * Ba ô xanh đó là toàn bộ lớp lỗi mà NT-3 sinh ra để chặn, và ở DB này nó KHÔNG
 * phải rủi ro lý thuyết — nó là trạng thái mặc định.
 *
 * ⇒ `trangThaiHienThi()` cho `khong_ro` THẮNG mọi trạng thái được báo cáo. Việc
 *   đó đã được `mauTrangThai.mauTheoTuoi` cưỡng chế ở tầng màu; module này cưỡng
 *   chế cùng luật ở tầng DỮ LIỆU, để cả bảng DOM, dải cảnh báo và ô đếm cũng
 *   không thể nói khác cảnh 3D.
 *
 * ★ Module THUẦN (RB-8.1): không three, không react, không `Date.now()` ẩn —
 *   `bayGio` luôn là THAM SỐ, nên test tất định và không phụ thuộc đồng hồ máy.
 */

import { mucTuoi, NGUONG_CU_MS, NGUONG_TUOI_MS, type MucTuoi } from "../mauTrangThai";
/**
 * ★ G12 — DÙNG LẠI phép rút đơn vị của `moPhongLogic.ts`, không viết bản thứ hai.
 *   `moPhongLogic` KHÔNG import ngược tệp này (nó chỉ import `./wipTram`), nên
 *   cạnh nhập này không tạo chu trình. Kiểm bằng `npm run build` (esbuild sẽ
 *   báo chu trình ESM), không bằng lời hứa.
 */
import { nhanTuoi, type TuoiDaRut } from "./moPhongLogic";

/**
 * ★ T-3 — ngưỡng ba mức tươi (NT-3.3), ms. **RE-EXPORT**, không khai lại.
 *
 * Trước đây hai con số này được viết lần thứ hai ở đây, song song với số ma
 * thuật trong `mauTrangThai.mucTuoi()`. Hai bản sao chỉ đồng ý tới lần sửa đầu
 * tiên, và khi lệch thì KHÔNG nổ — chỉ âm thầm cho cảnh 3D và ô đếm nói khác
 * nhau về cùng một máy. Giờ chỉ còn MỘT nơi khai (`../mauTrangThai`), tệp này
 * chuyền tiếp để các call site cũ không phải đổi đường import.
 */
export { NGUONG_CU_MS, NGUONG_TUOI_MS };

/**
 * Một máy như màn Vận hành cần biết. Cố ý KHÔNG dùng `MachineNode` của
 * `factory-scene` — bộ đó mang tập trạng thái khác (`running|idle|down|offline|
 * maintenance`) và KHÔNG mang dấu thời gian dữ liệu, tức là thiếu đúng thứ NT-3
 * cần. Xem docblock `CanhNhaMay.tsx` về việc vì sao hai hệ trạng thái không
 * được nối thẳng vào nhau.
 */
export interface MayVanHanh {
  id: number;
  ma: string;
  ten: string;
  loaiMay: string;
  /** `machines.operationStatus` — giá trị ĐƯỢC BÁO CÁO, chưa xét tuổi. */
  trangThaiBaoCao: string | null;
  /**
   * `machines.lastHeartbeat` (ms epoch) — thời điểm DỮ LIỆU, không phải thời
   * điểm render. `null` = CHƯA TỪNG báo cáo (2/42 máy của DB này).
   */
  thoiDiemDuLieu: number | null;
  isActive: boolean;
  stationId: number | null;
  lineId: number | null;
}

/** Trạng thái SAU khi đã xét tuổi dữ liệu và cờ khai thác. */
export interface TrangThaiHienThi {
  /** Khoá cho `mauTrangThai.mauChoTrangThai` — đã gồm `khong_ro`/`ngung_khai_thac`. */
  trangThai: string;
  tuoi: MucTuoi;
  /** true khi giá trị hiển thị KHÁC giá trị máy tự khai (để UI giải thích được). */
  daGhiDe: boolean;
}

/**
 * ★★★ HÀM TRUNG TÂM CỦA NT-3.
 *
 * Thứ tự ưu tiên KHÔNG được đổi:
 *   1. `isActive = false` → `ngung_khai_thac` (mờ 35%, KHÔNG màu trạng thái).
 *      Máy đã ngừng khai thác không "mất tín hiệu" — nó không còn phải gửi tín
 *      hiệu nào. Xếp nó vào `khong_ro` sẽ đẻ ra một cảnh báo giả mỗi ngày.
 *   2. tuổi > 5 phút (hoặc chưa từng có) → `khong_ro`, xám gạch chéo.
 *   3. còn lại → chính giá trị máy khai.
 *
 * `daGhiDe` cho UI nói được câu *"máy khai `running`, nhưng dữ liệu 2 tháng
 * tuổi"* thay vì lặng lẽ đổi màu — người vận hành phải thấy được sự bất đồng,
 * vì chính sự bất đồng đó mới là thông tin.
 */
export function trangThaiHienThi(may: MayVanHanh, bayGio: number): TrangThaiHienThi {
  if (!may.isActive) {
    return { trangThai: "ngung_khai_thac", tuoi: "khong_ro", daGhiDe: true };
  }
  const tuoi = mucTuoi(may.thoiDiemDuLieu, bayGio);
  if (tuoi === "khong_ro") {
    return {
      trangThai: "khong_ro",
      tuoi,
      // Ghi đè THẬT chỉ khi máy có khai một trạng thái — máy chưa từng báo cáo
      // gì thì `khong_ro` không ghi đè lên cái gì cả.
      daGhiDe: may.trangThaiBaoCao != null,
    };
  }
  return { trangThai: may.trangThaiBaoCao ?? "khong_ro", tuoi, daGhiDe: false };
}

/**
 * ★★★ LỌC NGUỒN DẤU THỜI GIAN — bản vá một lỗi NT-3 ĐO ĐƯỢC trên trình duyệt.
 *
 * `factoryCommand.overview` trả `issues[]` với ô `ageMinutes`, và cám dỗ là lấy
 * bất kỳ ô nào làm "tuổi dữ liệu". Nghiệm thu thật 2026-09-06 cho thấy hậu quả:
 * RAISE một andon lên máy 2 làm ô "tươi" nhảy 0 → 1 và máy đó hiện `16s`, trong
 * khi SQL thô nói nó im lặng từ 2026-09-03. **Một cảnh báo mới làm máy trông như
 * vừa gửi tín hiệu.**
 *
 * Đọc tại nguồn (`server/services/factoryCommandService.ts`), chỉ MỘT loại mang
 * thời điểm ĐO TRẠNG THÁI:
 *   `andon`     :342 → tuổi của `andon_events.raisedAt`      ✗
 *   `alarm`     :355 → tuổi của `createdAt`                  ✗
 *   `pdm`       :373 → tuổi bản ghi health                   ✗
 *   `workorder` :390 → tuổi của `scheduledFor`               ✗
 *   `offline`   :404 → `machine_status_logs."timestamp"`     ✓
 *
 * Hàm này là chỗ DUY NHẤT biết luật đó, để không nơi nào chép lại sai.
 */
export const LOAI_ISSUE_MANG_TS_TRANG_THAI = "offline";

export function tsTrangThaiTuIssues(
  issues: readonly { kind?: string; machineId?: number | null; ageMinutes?: number }[],
  bayGio: number,
): Map<number, number> {
  const m = new Map<number, number>();
  for (const iss of issues) {
    if (iss.kind !== LOAI_ISSUE_MANG_TS_TRANG_THAI) continue;
    if (iss.machineId == null || typeof iss.ageMinutes !== "number") continue;
    if (!Number.isFinite(iss.ageMinutes)) continue;
    const ts = bayGio - iss.ageMinutes * 60_000;
    const cu = m.get(iss.machineId);
    if (cu === undefined || ts > cu) m.set(iss.machineId, ts);
  }
  return m;
}

/** Đếm theo mức tươi — nguồn cho khối "TƯƠI DỮ LIỆU" ở panel trái (§9.1). */
export interface DemTuoi {
  tuoi: number;
  cu: number;
  khongRo: number;
  ngungKhaiThac: number;
  tong: number;
}

export function demTheoTuoi(ds: readonly MayVanHanh[], bayGio: number): DemTuoi {
  const d: DemTuoi = { tuoi: 0, cu: 0, khongRo: 0, ngungKhaiThac: 0, tong: ds.length };
  for (const m of ds) {
    const tt = trangThaiHienThi(m, bayGio);
    if (tt.trangThai === "ngung_khai_thac") d.ngungKhaiThac += 1;
    else if (tt.tuoi === "tuoi") d.tuoi += 1;
    else if (tt.tuoi === "cu") d.cu += 1;
    else d.khongRo += 1;
  }
  return d;
}

/** Đếm theo trạng thái hiển thị (ĐÃ xét tuổi) — khối "TỔNG QUAN" ở panel trái. */
export function demTheoTrangThai(
  ds: readonly MayVanHanh[],
  bayGio: number,
): Record<string, number> {
  const ra: Record<string, number> = {};
  for (const m of ds) {
    const { trangThai } = trangThaiHienThi(m, bayGio);
    ra[trangThai] = (ra[trangThai] ?? 0) + 1;
  }
  return ra;
}

/**
 * ★★★ NT-3.2 — "Cập nhật lần cuối" là `max(timestamp)` của DỮ LIỆU NỀN,
 * **KHÔNG** phải thời điểm render trang.
 *
 * Riêng phân biệt này diệt cả một lớp bug "giả tươi": trang vừa render xong thì
 * mọi thứ trông mới, kể cả dữ liệu từ hôm qua. Hàm nhận thẳng danh sách máy nên
 * KHÔNG có đường nào để một `Date.now()` lọt vào chỗ này.
 *
 * Trả `null` khi KHÔNG máy nào từng báo cáo — và `null` phải hiện là `—`, không
 * phải "vừa xong" (NT-3.5).
 */
export function thoiDiemDuLieuMoiNhat(ds: readonly MayVanHanh[]): number | null {
  let max: number | null = null;
  for (const m of ds) {
    if (m.thoiDiemDuLieu == null) continue;
    if (max === null || m.thoiDiemDuLieu > max) max = m.thoiDiemDuLieu;
  }
  return max;
}

/**
 * Kết quả ĐỐI SOÁT giữa DB và cảnh 3D (NT-3.3) — thuốc chống *model drift*.
 * Bố cục thật đổi mà twin không đổi thì banner phải KÊU.
 */
export interface KetQuaDoiSoat {
  /** Số máy `isActive` trong DB. */
  soMayDb: number;
  /** Số máy thật sự có node trong cảnh (có đặt chỗ, đang hiện). */
  soNodeCanh: number;
  /** Máy có trong DB mà KHÔNG có chỗ trên mặt bằng. */
  thieuTrenMatBang: number[];
  /** Đặt chỗ trỏ vào máy không còn `isActive` — ô `datChoMoCoi` của Đợt 4. */
  datChoMoCoi: number[];
  /** true ⇒ hiện banner vàng. */
  lech: boolean;
}

/**
 * Đối soát mỗi lần nạp cảnh (NT-3.3).
 *
 * ⚠ HAI CHIỀU, không phải một:
 *   • máy có trong DB mà thiếu chỗ  → mặt bằng THIẾU (banner "N máy chưa xếp chỗ")
 *   • chỗ trỏ vào máy đã ngừng      → mặt bằng THỪA  (ô `datChoMoCoi`)
 * Chỉ đo một chiều thì một mặt bằng vừa thiếu vừa thừa vẫn có thể cho ra "khớp"
 * vì hai sai số triệt tiêu nhau trong phép so TỔNG. Nên ở đây so theo TẬP HỢP
 * id, không so theo con số đếm — đúng bài học BG-127 (liệt kê phân bố, đừng chỉ
 * đếm tổng).
 */
export function doiSoatCanh(
  may: readonly MayVanHanh[],
  idCoDatCho: readonly number[],
): KetQuaDoiSoat {
  const tapDatCho = new Set(idCoDatCho);
  const thieuTrenMatBang: number[] = [];
  const datChoMoCoi: number[] = [];
  const idSong = new Set<number>();

  for (const m of may) {
    if (m.isActive) {
      idSong.add(m.id);
      if (!tapDatCho.has(m.id)) thieuTrenMatBang.push(m.id);
    }
  }
  for (const id of tapDatCho) {
    if (!idSong.has(id)) datChoMoCoi.push(id);
  }

  thieuTrenMatBang.sort((a, b) => a - b);
  datChoMoCoi.sort((a, b) => a - b);

  return {
    soMayDb: idSong.size,
    soNodeCanh: [...tapDatCho].filter((id) => idSong.has(id)).length,
    thieuTrenMatBang,
    datChoMoCoi,
    lech: thieuTrenMatBang.length > 0 || datChoMoCoi.length > 0,
  };
}

/**
 * ★ NT-3.5 — ĐẾM RỖNG KHÁC ĐẾM BẰNG 0.
 *
 * `dangTai` hoặc `chuaDo` ⇒ `"—"`. Một ô hiện `0` nói *"đã đo, và kết quả là
 * không có cái nào"*; hiện `—` nói *"chưa đo được"*. Hai câu đó dẫn tới hai hành
 * động khác nhau của người vận hành, nên không được trộn.
 *
 * Tái dùng quy ước `WipLineBalance.tsx:110-127`.
 */
export function hienSo(giaTri: number | null | undefined, dangTai = false): string {
  if (dangTai || giaTri == null || !Number.isFinite(giaTri)) return "—";
  return String(giaTri);
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* ★★★ CHẶN-2 (Đợt 5) — TRUY VẤN BỊ TỪ CHỐI KHÔNG ĐƯỢC HIỆN THÀNH `0`         */
/* ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Một truy vấn của màn Vận hành, rút về ĐÚNG hai bit mà tầng trình bày cần.
 *
 * ⚠ Cố ý KHÔNG nhận cả object query của react-query: module này thuần (RB-8.1)
 * và phải test được ở `environment: "node"`. Tầng trang bóc `isLoading`/`isError`
 * ra rồi truyền vào — đó cũng là chỗ ĐÃ thiếu và sinh ra chính lỗi này.
 */
export interface TinhTrangTruyVan {
  /** Tên đường dẫn tRPC, ví dụ `"andon.active"`. Hiện NGUYÊN VĂN trong banner. */
  ten: string;
  dangTai: boolean;
  loi: boolean;
  /** Mã lỗi tRPC (`error.data.code`), dùng để tách 403 khỏi lỗi mạng. */
  ma?: string | null;
  /**
   * ★★★ `enabled: false` — truy vấn CHƯA TỪNG CHẠY.
   *
   * Ca này ĐO ĐƯỢC và câm hơn cả 403: với `maint1`, `factory.list` trả `[]` kèm
   * **HTTP 200** (không phải 403), nên `factoryId` ở lại `null` và `canhQ`/
   * `overviewQ` bị `enabled: false` — không bao giờ chạy. react-query để
   * `isLoading=false`, `isError=false`, dữ liệu `undefined` ⇒ mọi ô đếm rơi về
   * `0` và trông y hệt một nhà máy đã đo xong và rỗng thật.
   *
   * "Chưa hỏi" KHÔNG phải "đã hỏi và được trả lời 0". Cờ này giữ hai câu đó tách
   * nhau, y như `chuaDo` giữ 403 tách khỏi 0.
   */
  chuaChay?: boolean;
}

/** Mã tRPC nghĩa là "đã tới server, server TỪ CHỐI vì quyền". */
export const MA_TU_CHOI = "FORBIDDEN";

export interface KetQuaChuaDo {
  /** `true` khi có BẤT KỲ truy vấn nào chưa cho ra số dùng được. */
  chuaDo: boolean;
  /** Tên các truy vấn bị server TỪ CHỐI (403). Rỗng khi không có. */
  biTuChoi: string[];
  /** Tên các truy vấn lỗi vì lý do KHÁC 403 (mạng, 500…). */
  loiKhac: string[];
}

/**
 * ★★★ VÌ SAO HÀM NÀY TỒN TẠI — lỗi ĐO ĐƯỢC, không phải phòng xa.
 *
 * `hienSo(giaTri, dangTai)` ĐÃ đúng từ đầu: nó trả `—` khi `dangTai`. Nhưng tầng
 * trang chỉ truyền `isLoading` vào, KHÔNG truyền `isError`. Hậu quả đo được bằng
 * tài khoản `maint1` (không có quyền `andon.active`): truy vấn trả 403,
 * `andonRows` rơi về `[]`, `andonRows.length` là `0`, `isLoading` đã `false`
 * ⇒ màn hình in **"Cảnh báo (0)"**.
 *
 * `0` ở đó là một LỜI KHAI SAI VỀ THẾ GIỚI, không phải một ô trống: nó nói
 * *"đã kiểm tra, nhà máy KHÔNG có cảnh báo nào"* với một người thực ra **không
 * được phép nhìn thấy cảnh báo nào cả**. Người trực ca đọc `0` rồi đi về. Đây
 * đúng lớp lỗi mà cả module NT-3 này sinh ra để chặn — chỉ khác là lần này
 * nguồn im lặng không phải cái máy, mà là CỔNG QUYỀN.
 *
 * ⇒ Lỗi và đang-tải PHẢI gộp chung về một bit `chuaDo`, vì với tầng hiển thị
 *   chúng nói CÙNG một câu: "con số này chưa có nghĩa". Nhưng banner thì phải
 *   tách 403 khỏi lỗi mạng, vì hai cái dẫn tới hai hành động khác nhau của
 *   người dùng (xin quyền vs. thử lại).
 */
export function gopTinhTrang(ds: readonly TinhTrangTruyVan[]): KetQuaChuaDo {
  const biTuChoi: string[] = [];
  const loiKhac: string[] = [];
  let chuaDo = false;
  for (const q of ds) {
    if (q.dangTai) chuaDo = true;
    // Chưa chạy ⇒ chưa đo. Không nêu tên: không ai bị TỪ CHỐI, nên đổ lỗi cho
    // truy vấn này sẽ gửi người dùng đi xin một quyền mà họ không thiếu.
    if (q.chuaChay) chuaDo = true;
    if (q.loi) {
      chuaDo = true;
      if (q.ma === MA_TU_CHOI) biTuChoi.push(q.ten);
      else loiKhac.push(q.ten);
    }
  }
  return { chuaDo, biTuChoi, loiKhac };
}

/**
 * Nhãn "cập nhật N trước" + cờ có nên tô đỏ không (NT-3.2: đỏ khi > 60 giây).
 *
 * Trả về các mảnh SỐ, không trả chuỗi đã dịch: `t()` thuộc về tầng component
 * (RB-8.3), và một module thuần gọi `useTranslation` là không test được ở
 * `environment: "node"`.
 */
export interface NhanDoTuoi {
  /** `null` khi chưa từng có dữ liệu ⇒ UI hiện `—`. */
  giay: number | null;
  do: boolean;
  /**
   * Tuổi ĐÃ RÚT về `{so, donVi}` — `null` khi chưa từng có dữ liệu.
   *
   * ════════════════════════════════════════════════════════════════════════
   * ★★★ VÌ SAO THÊM Ô NÀY — MỘT SỐ ĐO, KHÔNG PHẢI MỘT Ý THÍCH
   * ════════════════════════════════════════════════════════════════════════
   * Ảnh tự chụp Đợt 23 (`.qa-dot23/M1-nhan-thu-ca-hai.png`) in nguyên văn
   * **"Updated 1572061s ago"** trên thanh công cụ. 1.572.061 giây = **18,2
   * ngày**, và không người vận hành nào đọc được điều đó từ bảy chữ số. Đây
   * là **GIÂY SỐNG** — đơn vị đúng cho `< 60 s` (nhịp làm mới của màn) nhưng
   * vô nghĩa từ vài giờ trở lên.
   *
   * ★ G72 — module thuần trả **dữ liệu có cấu trúc**, KHÔNG phát văn xuôi.
   *   `nhanTuoi` (`moPhongLogic.ts:387`) đã đúng khuôn ấy và đã trả giá cho
   *   bài học *"(17 ngày ago)"*; ô này **uỷ thác thẳng cho nó** (G12) thay vì
   *   viết phép rút đơn vị thứ hai. Hai bản rút đơn vị trong một màn là đúng
   *   cách để chúng lệch nhau mà không ai biết.
   *
   * ⚠ `giay` GIỮ NGUYÊN, không bỏ: `data-giay` là thứ e2e/nghiệm thu đọc để
   *   lấy SỐ THÔ, và đổi nó là làm mù thiết bị đo của chính mình.
   */
  rut: TuoiDaRut | null;
  /**
   * Dữ liệu CŨ tới mức không còn đáng tin (> {@link NGUONG_CU_MS}).
   *
   * ★★★ G30 — HẠN HIỆU LỰC CHƯA PHỦ HẾT CHỖ. `do` (đỏ khi > 60 s) chỉ nói
   * *"hơi cũ"*; nó KHÔNG phân biệt 61 giây với 18 ngày, nên một giá trị 18
   * ngày tuổi hiện ra **trông y như bình thường, chỉ đỏ hơn chút**. `NganXuLy`
   * đã có badge `duLieuQuaCu` cho đúng ca này (`NganXuLy.tsx:300`) nhưng
   * thanh công cụ nền thì KHÔNG — cùng một sự thật, hai câu trả lời khác nhau
   * trên cùng một màn. Ô này là thứ để thanh công cụ nói cùng câu.
   */
  quaCu: boolean;
}

export function nhanDoTuoi(
  thoiDiemDuLieu: number | null,
  bayGio: number,
): NhanDoTuoi {
  if (thoiDiemDuLieu == null) return { giay: null, do: true, rut: null, quaCu: true };
  // `Math.max(0, …)` vì đồng hồ client có thể chạy TRƯỚC đồng hồ server vài
  // giây; một nhãn "cập nhật -3 giây trước" làm người đọc nghi ngờ cả màn hình.
  const tuoiMs = Math.max(0, bayGio - thoiDiemDuLieu);
  const giay = Math.round(tuoiMs / 1000);
  return {
    giay,
    do: bayGio - thoiDiemDuLieu > NGUONG_TUOI_MS,
    // ★ `nhanTuoi` trả `null` cho tuổi < 1 phút ⇒ KHÔNG, nó trả `{so:0,donVi:"phut"}`.
    //   Tầng vẽ tự chọn: dưới 60 s thì in GIÂY (còn đọc được), từ đó dùng `rut`.
    rut: nhanTuoi(tuoiMs),
    quaCu: tuoiMs > NGUONG_CU_MS,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* ★★★ ĐỢT 23 M4 — ĐỘ TUỔI ĐỌC ĐƯỢC (một chỗ, hai người gọi)                  */
/* ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Đổi {@link NhanDoTuoi} thành đoạn chữ ĐỘ DÀI THỜI GIAN đã dịch — `"45s"`,
 * `"12 phút"`, `"18 ngày"`. KHÔNG kèm chữ "trước"/"ago": khuôn câu là việc của
 * người gọi (`capNhatTruoc`), nếu không ta lặp đúng lỗi *"(17 ngày ago)"*.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ VÌ SAO HÀM NÀY NHẬN `t` TRONG KHI `nhanTuoi` TỪ CHỐI NHẬN `t`
 * ════════════════════════════════════════════════════════════════════════════
 * `nhanTuoi` là phép RÚT ĐƠN VỊ — logic thuần, phải test được ở
 * `environment: "node"` mà không có i18next. Hàm này là phép GHÉP CHỮ — nó
 * KHÔNG quyết định gì, chỉ chọn khoá dịch theo `donVi` đã rút sẵn. Nhận `t`
 * làm tham số (chứ không gọi `useTranslation` bên trong) giữ nó vẫn thuần và
 * vẫn test được: test truyền vào một `t` giả và đọc thẳng khoá được chọn.
 *
 * ⚠ Dưới 60 giây in GIÂY, không rút về "0 phút". `nhanTuoi(30_000)` trả
 *   `{so: 0, donVi: "phut"}` — đúng theo hợp đồng của nó, nhưng in ra
 *   *"0 phút trước"* thì SAI NGHĨA với một màn làm mới mỗi 30 giây: người đọc
 *   sẽ tưởng dữ liệu đứng im. Ngưỡng này là {@link NGUONG_TUOI_MS}, cùng hằng
 *   số quyết định `do` — hai câu trả lời của một dòng không được dùng hai mốc.
 *
 * ★ Người gọi: `TwinVanHanh.tsx` (thanh công cụ nền) và `NganXuLy.tsx` (ngăn
 *   chi tiết máy). Trước Đợt 23 hai chỗ tự ghép chữ riêng và **cùng in giây
 *   sống**; gộp về một hàm để chúng không thể lệch nhau lần nữa (G12).
 */
export function nhanTuoiDocDuoc(
  n: NhanDoTuoi,
  t: (khoa: string, macDinh: string, tuyChon?: Record<string, unknown>) => string,
): string {
  if (n.giay == null) return "—";
  // Dưới ngưỡng "hơi cũ" ⇒ giây vẫn là đơn vị đúng và đọc được.
  if (n.giay * 1000 <= NGUONG_TUOI_MS || n.rut == null) {
    return t("twin3d.vanHanh.donViGiay", "{{n}}s", { n: n.giay });
  }
  // ★ DÙNG LẠI đúng ba khoá `twin3d.moPhong.donVi.*` mà `NganMoPhong` đã dùng
  //   cho `nhanTuoi` — có sẵn ở CẢ BA locale (en/vi/zh). Đẻ bộ khoá thứ hai cho
  //   cùng ba đơn vị là cách chắc chắn để chúng dịch lệch nhau.
  return t(`twin3d.moPhong.donVi.${n.rut.donVi}`, "{{n}}", { n: n.rut.so });
}
