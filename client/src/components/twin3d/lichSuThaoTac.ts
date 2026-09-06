/**
 * lichSuThaoTac.ts — Undo/Redo dạng COMMAND-PATTERN cho màn Thiết kế (§7.2 #9).
 *
 * ★★★ ĐÂY LÀ QUYẾT ĐỊNH KIẾN TRÚC, KHÔNG PHẢI TÍNH NĂNG.
 *   Spec §7.2 nói thẳng: "nhét sau rất đắt". Lý do cụ thể: một hệ đã lỡ lưu
 *   SNAPSHOT cả scene thì mọi lệnh ghi DB đều phải suy ra bằng cách DIFF hai
 *   snapshot, và diff đó không bao giờ biết được "người dùng đã kéo 40 lần hay
 *   1 lần" — tức là cả gộp-thao-tác lẫn API lưu-batch đều mất nền.
 *   Ở đây lưu LỆNH `{op, targets, truoc, sau}`: undo = ghi `truoc`,
 *   redo = ghi `sau`, và cùng cấu trúc đó ĐI THẲNG vào API lưu batch của §7.3.
 *
 * ★ Module THUẦN: không import three.js, không import react (vitest env "node").
 * ★ Tất định: không Math.random(), không Date.now() — kể cả cho `moc` thời gian
 *   của lệnh. Người gọi TỰ cấp `moc` (xem {@link ThaoTac.moc}); nếu module tự
 *   gọi `Date.now()` thì hai lần chạy cùng đầu vào cho hai stack khác nhau và
 *   test T1-kiểu (tất định) của cả đợt sụp.
 */

/** Số bước tối đa giữ trong stack undo (§7.2 #9: "Stack 50 bước"). */
export const GIOI_HAN_STACK = 50;

/**
 * Cửa sổ gộp mặc định, mili-giây (§7.2 #9: "gộp thao tác kéo liên tiếp").
 * Hai lệnh kéo trên CÙNG tập vật thể cách nhau dưới ngưỡng này là MỘT lệnh.
 * 700 ms là khoảng dừng tay tự nhiên giữa hai lần kéo có chủ đích — dưới đó
 * gần như chắc chắn là cùng một cử động chuột bị chia nhỏ bởi sự kiện `drag`.
 */
export const CUA_SO_GOP_MS = 700;

/**
 * Mã thao tác. `keo` là loại DUY NHẤT được gộp — mọi loại khác là một hành động
 * rời rạc do người dùng bấm ra, và gộp chúng thì Ctrl+Z sẽ huỷ nhiều hơn một
 * cái bấm, đúng lớp lỗi "undo ăn mất việc tôi vừa làm".
 */
export type MaThaoTac =
  | "keo" // kéo gizmo di chuyển — GỘP được
  | "xoay"
  | "coGian"
  | "canh" // align 6 hướng
  | "danDeu" // distribute
  | "nhanBan" // array tuyến tính / toả tròn
  | "them"
  | "xoa"
  | "khoa"
  | "raiTram" // §10C.4 — rải trạm dọc Line
  | "nanThangLine" // §10C.4 — nắn thẳng Line
  | "doiHuongLine"; // §10C.4 — đổi hướng Line

/**
 * Trạng thái của MỘT vật thể trong một lệnh. Nội dung để MỞ (`unknown` theo
 * khoá) vì lệnh phải chở được cả `twin_dat_cho` lẫn `twin_vat_the` — hai hình
 * dạng khác nhau — mà không buộc module này biết lược đồ DB.
 */
export type TrangThaiVatThe = Readonly<Record<string, unknown>>;

/** Một lệnh có thể hoàn tác. */
export interface ThaoTac {
  op: MaThaoTac;
  /** Khoá các vật thể bị lệnh này chạm, dạng "machine:42". */
  targets: readonly string[];
  /** Trạng thái TRƯỚC, theo khoá vật thể. Undo ghi lại đúng cái này. */
  truoc: Readonly<Record<string, TrangThaiVatThe>>;
  /** Trạng thái SAU. Redo ghi lại đúng cái này. */
  sau: Readonly<Record<string, TrangThaiVatThe>>;
  /**
   * Mốc thời gian (ms) do NGƯỜI GỌI cấp — dùng cho phép gộp. Vắng mặt thì
   * lệnh KHÔNG BAO GIỜ gộp: không có mốc thì không đo được "liên tiếp", và
   * gộp mù hai lệnh cách nhau 10 phút sẽ nuốt mất một bước undo.
   */
  moc?: number;
  /** Nhãn hiển thị trên menu Undo ("Hoàn tác: kéo 3 máy"). Không tham gia logic. */
  nhan?: string;
}

/** Ảnh chụp bất biến của lịch sử — kiểu trả về của mọi hàm trong module. */
export interface LichSu {
  readonly undo: readonly ThaoTac[];
  readonly redo: readonly ThaoTac[];
}

/** Kết quả một lần undo/redo: lịch sử mới + lệnh cần áp (null nếu không có). */
export interface KetQuaHoanTac {
  lichSu: LichSu;
  /** Lệnh vừa lấy ra. `null` khi stack rỗng. */
  thaoTac: ThaoTac | null;
  /**
   * Trạng thái người gọi phải GHI để hoàn tất. `undo` trả `thaoTac.truoc`,
   * `redo` trả `thaoTac.sau`. Tách ra để nơi gọi không phải tự nhớ chiều nào
   * lấy trường nào — nhớ nhầm chiều là lỗi câm hoàn hảo (nút hoạt động, dữ
   * liệu đi ngược).
   */
  canGhi: Readonly<Record<string, TrangThaiVatThe>> | null;
}

// ---------------------------------------------------------------------------
// Dựng và truy vấn
// ---------------------------------------------------------------------------

/** Lịch sử rỗng. */
export function lichSuRong(): LichSu {
  return { undo: [], redo: [] };
}

/**
 * Có gì để hoàn tác không?
 * ★ G8 — trả FALSE với `lichSuRong()` và với lịch sử vừa bị undo hết; TRUE
 *   ngay sau một `ghiThaoTac`. Cờ này gác trạng thái disabled của nút Undo.
 */
export function coTheHoanTac(ls: LichSu): boolean {
  return ls.undo.length > 0;
}

/**
 * Có gì để làm lại không?
 * ★ G8 — trả FALSE với `lichSuRong()`, và FALSE ngay sau một `ghiThaoTac` mới
 *   (vì thao tác mới XOÁ nhánh redo — xem {@link ghiThaoTac}); TRUE sau một
 *   `hoanTac` chưa bị thao tác mới ghi đè.
 */
export function coTheLamLai(ls: LichSu): boolean {
  return ls.redo.length > 0;
}

// ---------------------------------------------------------------------------
// Gộp
// ---------------------------------------------------------------------------

/** Hai tập khoá GIỐNG HỆT nhau (không kể thứ tự)? */
function cungTapTargets(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const tapA = new Set(a);
  if (tapA.size !== new Set(b).size) return false;
  for (const k of b) if (!tapA.has(k)) return false;
  return true;
}

/**
 * Hai lệnh có gộp được thành một không?
 *
 * Điều kiện, TẤT CẢ phải đúng:
 *   1. cả hai là `op = 'keo'` — chỉ kéo mới bị chia nhỏ bởi sự kiện chuột;
 *   2. cùng ĐÚNG tập `targets` — kéo máy A rồi kéo máy B là hai việc;
 *   3. cả hai có `moc`, và cách nhau ≤ `cuaSo` ms.
 *
 * ★ G8 — trả FALSE cho: hai lệnh `xoay`; hai lệnh `keo` khác targets; hai lệnh
 *   `keo` cùng targets cách nhau 5000 ms; lệnh thiếu `moc`. Trả TRUE cho hai
 *   lệnh `keo` cùng targets cách nhau 100 ms. Nếu cờ này luôn true thì toàn bộ
 *   phiên chỉnh sửa co lại thành MỘT bước undo; luôn false thì một cú kéo chuột
 *   sinh ra 40 bước undo và Ctrl+Z trở nên vô dụng.
 */
export function coTheGop(
  truoc: ThaoTac,
  sau: ThaoTac,
  cuaSo: number = CUA_SO_GOP_MS,
): boolean {
  if (truoc.op !== "keo" || sau.op !== "keo") return false;
  if (!cungTapTargets(truoc.targets, sau.targets)) return false;
  if (truoc.moc === undefined || sau.moc === undefined) return false;
  if (!Number.isFinite(truoc.moc) || !Number.isFinite(sau.moc)) return false;
  return sau.moc - truoc.moc >= 0 && sau.moc - truoc.moc <= cuaSo;
}

/**
 * Gộp hai lệnh kéo liên tiếp: giữ `truoc` của lệnh ĐẦU và `sau` của lệnh CUỐI.
 *
 * ⚠ Đây là chỗ dễ sai nhất của cả module. Lấy `truoc` của lệnh SAU sẽ làm undo
 *   chỉ lùi được một nấc của cú kéo — máy về giữa đường thay vì về chỗ cũ, và
 *   người dùng phải bấm Ctrl+Z 40 lần cho một cú kéo. Toàn bộ mục đích của phép
 *   gộp nằm ở việc `truoc` là của lệnh ĐẦU.
 */
export function gopThaoTac(truoc: ThaoTac, sau: ThaoTac): ThaoTac {
  return {
    op: truoc.op,
    targets: truoc.targets,
    truoc: truoc.truoc,
    sau: sau.sau,
    moc: sau.moc,
    nhan: truoc.nhan ?? sau.nhan,
  };
}

// ---------------------------------------------------------------------------
// Ghi / hoàn tác / làm lại
// ---------------------------------------------------------------------------

/**
 * Ghi một lệnh mới vào lịch sử.
 *
 * Ba việc, theo đúng thứ tự:
 *   1. GỘP nếu lệnh này nối tiếp lệnh trên đỉnh stack (xem {@link coTheGop});
 *   2. XOÁ nhánh redo — đây là ngữ nghĩa undo tuyến tính chuẩn: sau khi lùi lại
 *      rồi làm việc khác, "làm lại" cái cũ không còn nghĩa vì trạng thái nó
 *      định khôi phục đã không còn tồn tại;
 *   3. KẸP stack về {@link GIOI_HAN_STACK}, bỏ phần tử CŨ NHẤT (đáy stack).
 *
 * Lệnh gộp KHÔNG làm stack dài thêm — nó thay lệnh trên đỉnh.
 */
export function ghiThaoTac(
  ls: LichSu,
  thaoTac: ThaoTac,
  cuaSoGop: number = CUA_SO_GOP_MS,
): LichSu {
  const dinh = ls.undo[ls.undo.length - 1];
  if (dinh !== undefined && coTheGop(dinh, thaoTac, cuaSoGop)) {
    const undo = [...ls.undo.slice(0, -1), gopThaoTac(dinh, thaoTac)];
    return { undo, redo: [] };
  }
  const undo = [...ls.undo, thaoTac];
  return { undo: kepStack(undo), redo: [] };
}

/** Bỏ phần tử CŨ NHẤT khi vượt giới hạn. */
function kepStack(ds: readonly ThaoTac[]): ThaoTac[] {
  if (ds.length <= GIOI_HAN_STACK) return [...ds];
  return ds.slice(ds.length - GIOI_HAN_STACK);
}

/**
 * Hoàn tác một bước: lấy lệnh trên đỉnh undo, đẩy sang redo, trả về trạng thái
 * `truoc` để người gọi GHI.
 *
 * Stack rỗng trả về lịch sử NGUYÊN VẸN và `thaoTac = null` — không ném lỗi.
 * Ctrl+Z khi không có gì để hoàn tác là thao tác bình thường của người dùng,
 * không phải sự cố.
 */
export function hoanTac(ls: LichSu): KetQuaHoanTac {
  if (ls.undo.length === 0) {
    return { lichSu: ls, thaoTac: null, canGhi: null };
  }
  const thaoTac = ls.undo[ls.undo.length - 1];
  return {
    lichSu: {
      undo: ls.undo.slice(0, -1),
      redo: kepStack([...ls.redo, thaoTac]),
    },
    thaoTac,
    canGhi: thaoTac.truoc,
  };
}

/**
 * Làm lại một bước: lấy lệnh trên đỉnh redo, đẩy về undo, trả trạng thái `sau`.
 * Stack redo rỗng trả nguyên vẹn, `thaoTac = null`.
 */
export function lamLai(ls: LichSu): KetQuaHoanTac {
  if (ls.redo.length === 0) {
    return { lichSu: ls, thaoTac: null, canGhi: null };
  }
  const thaoTac = ls.redo[ls.redo.length - 1];
  return {
    lichSu: {
      undo: kepStack([...ls.undo, thaoTac]),
      redo: ls.redo.slice(0, -1),
    },
    thaoTac,
    canGhi: thaoTac.sau,
  };
}

/** Xoá sạch lịch sử — dùng sau khi Lưu thành công hoặc khi đổi tầng. */
export function xoaLichSu(): LichSu {
  return lichSuRong();
}

/**
 * Số vật thể đang có thay đổi CHƯA LƯU, suy ra từ stack undo.
 *
 * Đây là con số của chỉ báo "N thay đổi chưa lưu" ở §7.3. Đếm theo VẬT THỂ
 * DUY NHẤT chứ không theo số lệnh: kéo một máy 5 lần vẫn là 1 thay đổi cần
 * ghi, và câu "5 thay đổi chưa lưu" cho một máy sẽ làm người dùng đi tìm bốn
 * thứ không tồn tại.
 */
export function soVatTheDaDoi(ls: LichSu): number {
  const tap = new Set<string>();
  for (const t of ls.undo) for (const k of t.targets) tap.add(k);
  return tap.size;
}
