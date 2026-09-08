/**
 * duongDanTwin.ts — DEEP-LINK hai chiều của màn Vận hành (§9.4).
 *
 * Mã hoá trạng thái cảnh vào query string để câu "anh xem chỗ này giúp em" trở
 * thành MỘT ĐƯỜNG LINK — mẫu *saved viewpoint* mà mọi hệ chuyên nghiệp đều có:
 *
 *   /twin?pv=line:1&chon=machine:42&cam=45.2,18,-30.5,0.8,120&lop=nhiet,wip&tg=…
 *         pv  = phạm vi        chon = vật thể chọn      cam = camera
 *         lop = lớp đang bật   tg   = mốc thời gian (chế độ tua)
 *
 * ★ Module THUẦN — không three, không react, không `window`. `vitest` chạy
 *   `environment: "node"` và chỉ thu `.unit.test.ts` (RB-8.1), nên toàn bộ luật
 *   phân tích/ghép chuỗi phải nằm ở đây thì mới canh được bằng test.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ NGUYÊN TẮC: URL LÀ ĐẦU VÀO KHÔNG TIN ĐƯỢC
 * ════════════════════════════════════════════════════════════════════════════
 * Người dùng dán link từ chat, từ email, từ bản ghi cũ sau khi cấp phạm vi đã
 * đổi tên. Nên MỌI hàm đọc ở đây phải trả về một trạng thái DÙNG ĐƯỢC với đầu
 * vào rác, KHÔNG ném lỗi: một `?pv=line:abc` phải rơi về phạm vi mặc định chứ
 * không làm trắng màn hình. Ngược lại, nó KHÔNG được lặng lẽ "sửa" thành một
 * thứ trông hợp lệ — `docPhamVi("line:abc")` trả `null`, và tầng gọi hiện cảnh
 * mặc định. Phân biệt "không có tham số" với "tham số hỏng" là việc của tầng
 * gọi, nên hai ca đó trả hai giá trị khác nhau (xem `docTrangThaiUrl`).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★ replaceState vs pushState (§9.4)
 * ════════════════════════════════════════════════════════════════════════════
 * Xoay camera sinh ra HÀNG TRĂM sự kiện mỗi giây. Đẩy từng cái vào history biến
 * nút Back của trình duyệt thành vô dụng (bấm 200 lần mới ra khỏi trang). Nên:
 *   • camera đổi        → `replaceState` (ghi đè, không thêm mục lịch sử)
 *   • phạm vi / chọn đổi → `pushState`   (thêm mục — Back quay lại cấp trước)
 * `kieuGhiLichSu()` là nơi DUY NHẤT quyết định điều đó, để hai chỗ gọi không
 * lệch nhau.
 */

/** Năm cấp phạm vi (§10C.2). `tapDoan` là cấp cao nhất, `may` là thấp nhất. */
export type CapPhamVi = "tapDoan" | "nhaMay" | "tang" | "line" | "may";

/** Loại vật thể chọn được trên cảnh — khớp `twin_dat_cho.loaiThucThe` + `line`. */
export type LoaiVatThe = "machine" | "station" | "line" | "workshop" | "factory";

/**
 * Một phạm vi đã phân giải: cấp + id của thực thể mang cấp đó.
 * `tapDoan` không có id (chỉ có một tập đoàn) nên `id` là `null`.
 */
export interface PhamVi {
  cap: CapPhamVi;
  id: number | null;
}

/** Vật thể đang chọn. */
export interface VatTheChon {
  loai: LoaiVatThe;
  id: number;
}

/**
 * Tư thế camera đủ để khôi phục đúng góc nhìn.
 * Năm số: vị trí (x,y,z) + mục ngắm nằm trên mặt sàn (mucX, mucZ).
 *
 * ⚠ KHÔNG lưu quaternion camera. OrbitControls suy hướng từ (vị trí → mục
 *   ngắm), nên lưu quaternion sinh ra nguồn sự thật thứ hai và hai bên lệch
 *   nhau ngay lần `controls.update()` đầu tiên.
 */
export interface TuTheCamera {
  x: number;
  y: number;
  z: number;
  mucX: number;
  mucZ: number;
}

/**
 * LỰA CHỌN NẠP — nhà máy / toà / tầng đang được HỎI DỮ LIỆU (Đợt 10 lô F).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ VÌ SAO KHÔNG DÙNG `pv` CHO VIỆC NÀY
 * ════════════════════════════════════════════════════════════════════════════
 * `pv` (§10C.2) là "đang NHÌN cấp nào" — nó điều khiển camera và độ mờ. Ba ô ở
 * đây là "đang HỎI dữ liệu của cái nào" — chúng điều khiển `tangIds` gửi lên
 * `twinCanh.canhThietKe`. Hai trục ĐỘC LẬP: `pv=line:1` vẫn phải nạp cả tầng
 * chứa line đó (người vận hành cần thấy hàng xóm để định vị), và `pv=machine:42`
 * không được làm mất phần còn lại của tầng.
 *
 * Nhét cả hai vào `pv` thì mỗi lần người dùng bấm một máy là đổi luôn tập dữ
 * liệu được nạp — một truy vấn mạng cho mỗi cú click, và cảnh chớp về rỗng.
 *
 * ★ Không có ô nào cho `line`: line KHÔNG phải một đơn vị nạp. Nó là bộ lọc
 *   phạm vi (QĐ-12 §10C.1) và dữ liệu của nó đã nằm trong tầng chứa nó.
 */
export interface LuaChonNapUrl {
  /** `factories.id`. `null` = tham số vắng/hỏng ⇒ tầng gọi tự chọn. */
  nm: number | null;
  /** `twin_toa_nha.id`. */
  toa: number | null;
  /** `twin_tang.id`. */
  tang: number | null;
}

/** Toàn bộ trạng thái mã hoá được vào URL. */
export interface TrangThaiTwinUrl {
  /** `null` = tham số vắng hoặc hỏng; tầng gọi dùng mặc định của nó. */
  phamVi: PhamVi | null;
  chon: VatTheChon | null;
  cam: TuTheCamera | null;
  /** Tên các lớp phủ đang bật. Mảng RỖNG khác `null`: xem `docLop`. */
  lop: string[] | null;
  /** Mốc thời gian chế độ tua, ms epoch. `null` = chế độ live. */
  tg: number | null;
  /** Ba ô "nạp cái gì" (§11e.6 F1) — xem {@link LuaChonNapUrl}. */
  nap: LuaChonNapUrl;
  /**
   * ★★★ F4 — HAI PANEL BÊN ĐANG THU (`?thu=trai,phai`).
   *
   * Đo được trên trình duyệt thật (Playwright, 1280×720, 2026-09-07): khung
   * `man-twin-van-hanh` rộng **968 px** (viewport 1280 − sidebar vỏ 264 − đệm
   * `p-6` 2×24). Panel trái `w-72` = 288 và panel phải `w-80` = 320 ⇒ **608 px,
   * tức 63 %** bề ngang, để canvas đúng **360 px**. Trên toàn viewport, 3D
   * chiếm 360×416 / 1280×720 = **16,9 %**.
   *
   * ⇒ Thu panel là cách DUY NHẤT trả lại phần lớn diện tích cho 3D mà KHÔNG
   *   phá §9.9 (mọi hành động phải làm được từ DOM thật): panel không bị XOÁ,
   *   nó thu lại và mở ra được bằng một nút có `aria-expanded`.
   * ★ Vào URL vì đây là một lựa chọn xem, cùng hạng với camera — nhưng ghi
   *   `replace` chứ không `push`: thu/mở một panel không phải "đi tới chỗ khác".
   */
  thu: string[];
}

/**
 * Tên panel thu được. Danh sách ĐÓNG — cùng lý do với `LOP_HOP_LE`.
 *
 * ★★★ `"kpi"` (Đợt 11 lô J, §11 #16) DÙNG LẠI ĐÚNG KHOÁ `thu=` NÀY, KHÔNG THÊM
 *   KHOÁ QUERY MỚI — và đó là một luật (G40), không phải tiết kiệm ký tự. Màn
 *   `/twin` đã có bốn người ghi vào query string (`pv`, `chon`/`xem`, `cam`,
 *   `nm/toa/tang`). Một khoá thứ năm kiểu `?kpi=0` sẽ có bộ đọc riêng, bộ ghi
 *   riêng, và luật hợp nhất riêng — tức là chỗ thứ năm để hai lượt ghi đè nhau.
 *   Ở đây `docThu`/`ghiThu` đã là MỘT bộ đọc-ghi tất định cho cả danh sách.
 *
 * ★ Hệ quả ngữ nghĩa CÓ CHỦ Ý: vắng mặt = **đang mở**. Bảng KPI vì vậy mặc định
 *   HIỆN (yêu cầu #6: số liệu phải đọc được trên cảnh 3D), và `?thu=kpi` là
 *   đường tắt cho "cảnh 3D sạch không chữ".
 *
 * ★★★ `"moPhong"` (Đợt 19 lô X, §11 #30/#35) DÙNG LẠI ĐÚNG KHOÁ NÀY — G40 lần
 *   thứ hai, cùng lý do đã ghi ở trên cho `"kpi"`. Danh sách là ĐÓNG ở CẢ hai
 *   chiều (`docThu` lọc theo nó, `ghiThu` sắp thứ tự theo nó), nên **quên thêm
 *   tên vào đây thì `?thu=moPhong` bị NUỐT trong im lặng**: URL ghi ra đúng, đọc
 *   lại ra rỗng, ngăn tự mở lại sau F5 và không lỗi nào nổ. Đúng lớp G67 "tính
 *   năng chết ở tầng ĐẦU TIÊN là KIỂU/DANH SÁCH", nên tên phải vào đây TRƯỚC.
 */
export const PANEL_THU_DUOC: readonly string[] = ["trai", "phai", "kpi", "moPhong"];

/**
 * Một THAY ĐỔI trạng thái URL — khác `Partial<TrangThaiTwinUrl>` ở ô `nap`.
 *
 * ★ `nap` ở đây là **Partial**, vì "đổi nhà máy" là một thao tác hợp lệ mà
 *   không nói gì về toà/tầng (và chính sự VẮNG MẶT của hai khoá kia là tín hiệu
 *   để `tronTrangThaiUrl` xoá chúng — xem chú thích trong hàm đó). Ở
 *   `TrangThaiTwinUrl` thì ba ô luôn có mặt, vì đó là trạng thái ĐÃ ĐỌC.
 */
export type ThayDoiTwinUrl = Omit<Partial<TrangThaiTwinUrl>, "nap"> & {
  nap?: Partial<LuaChonNapUrl>;
};

/** Ánh xạ cấp phạm vi → tiền tố dùng trong URL. Một chỗ, không chép tay. */
const TIEN_TO_CAP: Readonly<Record<CapPhamVi, string>> = {
  tapDoan: "tapdoan",
  nhaMay: "factory",
  tang: "tang",
  line: "line",
  may: "machine",
};

/** Bảng tra ngược, dựng từ chính bảng xuôi để hai chiều không thể lệch nhau. */
const CAP_TU_TIEN_TO: Readonly<Record<string, CapPhamVi>> = Object.fromEntries(
  (Object.keys(TIEN_TO_CAP) as CapPhamVi[]).map((c) => [TIEN_TO_CAP[c], c]),
);

/** Mọi loại vật thể hợp lệ — dùng để KIỂM, không để đoán. */
const LOAI_HOP_LE: readonly LoaiVatThe[] = [
  "machine",
  "station",
  "line",
  "workshop",
  "factory",
];

/**
 * Tên lớp phủ hợp lệ. Danh sách ĐÓNG là cố ý: một `?lop=<script>` hay một tên
 * lớp đã bị xoá ở phiên bản sau không được đi tiếp vào trạng thái ứng dụng.
 */
export const LOP_HOP_LE: readonly string[] = [
  "nhan",
  "canhBao",
  "wip",
  "dongChay",
  "tuoi",
  "ngungKhaiThac",
];

/** Số nguyên dương từ chuỗi; `null` với mọi thứ khác (kể cả `"1.5"`, `"-2"`, `"1e3"`). */
function soNguyenDuong(s: string): number | null {
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/**
 * Số thực hữu hạn từ chuỗi. Chặn `NaN`/`Infinity` — một `cam=NaN,…` lọt vào
 * `camera.position` cho ra ma trận NaN và cảnh TRẮNG XOÁ không lỗi (đúng lớp
 * lỗi chia-cho-0 của G11).
 */
function soThuc(s: string): number | null {
  if (s.trim() === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Đọc `pv=` → phạm vi. `null` khi vắng, sai khuôn, hoặc id không hợp lệ.
 *
 * `tapdoan` là cấp DUY NHẤT không cần id (`pv=tapdoan`); mọi cấp khác bắt buộc
 * có id dương (`pv=line:1`). `pv=line` (thiếu id) là hỏng, không phải "line nào
 * cũng được" — im lặng chọn một line bất kỳ là nói dối về thứ người dùng gửi.
 */
export function docPhamVi(raw: string | null | undefined): PhamVi | null {
  if (raw == null) return null;
  const s = raw.trim();
  if (s === "") return null;

  const [tienTo, phanId, ...du] = s.split(":");
  if (du.length > 0) return null;

  const cap = CAP_TU_TIEN_TO[tienTo];
  if (cap === undefined) return null;

  if (cap === "tapDoan") {
    // Chấp nhận `tapdoan` trần; `tapdoan:5` là sai khuôn (tập đoàn không mang id ở đây).
    return phanId === undefined ? { cap, id: null } : null;
  }
  if (phanId === undefined) return null;
  const id = soNguyenDuong(phanId);
  return id === null ? null : { cap, id };
}

/** Ghi phạm vi → chuỗi `pv`. Nghịch đảo của {@link docPhamVi}. */
export function ghiPhamVi(pv: PhamVi): string {
  const tienTo = TIEN_TO_CAP[pv.cap];
  return pv.cap === "tapDoan" ? tienTo : `${tienTo}:${pv.id}`;
}

/** Đọc `chon=` → vật thể chọn. Cùng luật chặt chẽ như {@link docPhamVi}. */
export function docVatTheChon(raw: string | null | undefined): VatTheChon | null {
  if (raw == null) return null;
  const s = raw.trim();
  if (s === "") return null;
  const [loai, phanId, ...du] = s.split(":");
  if (du.length > 0 || phanId === undefined) return null;
  if (!(LOAI_HOP_LE as readonly string[]).includes(loai)) return null;
  const id = soNguyenDuong(phanId);
  return id === null ? null : { loai: loai as LoaiVatThe, id };
}

/** Ghi vật thể chọn → chuỗi `chon`. */
export function ghiVatTheChon(v: VatTheChon): string {
  return `${v.loai}:${v.id}`;
}

/**
 * Đọc `cam=` → tư thế camera. Đúng NĂM số, mọi số hữu hạn, nếu không trả `null`.
 *
 * ⚠ TẤT CẢ HOẶC KHÔNG. Một camera thiếu một thành phần không phải "camera một
 *   phần" — nó là dữ liệu hỏng, và lấp chỗ trống bằng 0 đặt camera vào gốc toạ
 *   độ (thường là trong lòng đất) mà không ai biết vì sao.
 */
export function docCamera(raw: string | null | undefined): TuTheCamera | null {
  if (raw == null) return null;
  const phan = raw.split(",");
  if (phan.length !== 5) return null;
  const so = phan.map(soThuc);
  if (so.some((v) => v === null)) return null;
  const [x, y, z, mucX, mucZ] = so as number[];
  return { x, y, z, mucX, mucZ };
}

/** Số chữ số thập phân khi ghi camera vào URL. */
export const SO_LE_CAMERA = 2;

/**
 * Ghi camera → chuỗi `cam`. Làm tròn 2 chữ số: URL ngắn, và quan trọng hơn —
 * `replaceState` chỉ chạy khi chuỗi THẬT SỰ đổi, nên cắt bớt nhiễu float ở đây
 * làm giảm hẳn số lần ghi history lúc camera gần như đứng yên.
 */
export function ghiCamera(c: TuTheCamera): string {
  const l = (n: number) => Number(n.toFixed(SO_LE_CAMERA)).toString();
  return [c.x, c.y, c.z, c.mucX, c.mucZ].map(l).join(",");
}

/**
 * Đọc `lop=` → danh sách lớp bật.
 *
 * ★ PHÂN BIỆT BA CA, không phải hai:
 *   • tham số VẮNG      → `null`  ⇒ tầng gọi dùng bộ lớp MẶC ĐỊNH
 *   • `lop=` (rỗng)     → `[]`    ⇒ người dùng đã TẮT HẾT, phải tôn trọng
 *   • `lop=wip,rác`     → `["wip"]` ⇒ giữ phần hợp lệ, bỏ phần rác
 * Gộp ca 1 và ca 2 lại làm "tắt hết mọi lớp" trở thành trạng thái KHÔNG chia sẻ
 * được qua link, vì nó luôn bị hiểu thành "dùng mặc định".
 */
export function docLop(raw: string | null | undefined): string[] | null {
  if (raw == null) return null;
  if (raw.trim() === "") return [];
  const ra: string[] = [];
  for (const phan of raw.split(",")) {
    const ten = phan.trim();
    if (LOP_HOP_LE.includes(ten) && !ra.includes(ten)) ra.push(ten);
  }
  return ra;
}

/** Ghi danh sách lớp → chuỗi `lop`, thứ tự theo {@link LOP_HOP_LE} để TẤT ĐỊNH. */
export function ghiLop(lop: readonly string[]): string {
  return LOP_HOP_LE.filter((l) => lop.includes(l)).join(",");
}

/**
 * Đọc `tg=` → mốc thời gian (ms epoch), `null` khi vắng/hỏng ⇒ chế độ LIVE.
 *
 * Nhận ISO-8601 (`2026-09-06T14:30`) — dạng người đọc được, dán vào chat vẫn
 * hiểu. `Date.parse` trả `NaN` với chuỗi rác nên ca hỏng tự rơi về `null`.
 */
export function docThoiGian(raw: string | null | undefined): number | null {
  if (raw == null || raw.trim() === "") return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : null;
}

/** Ghi mốc thời gian → chuỗi ISO. */
export function ghiThoiGian(ms: number): string {
  return new Date(ms).toISOString();
}

/**
 * Đọc TOÀN BỘ trạng thái từ một query string (`?pv=…&chon=…` hoặc `pv=…&chon=…`).
 *
 * Không bao giờ ném. Mọi ô hỏng độc lập nhau: một `cam` rác không được làm mất
 * `pv` hợp lệ đi cùng nó — người gửi link vẫn tới đúng phạm vi, chỉ mất góc nhìn.
 */
export function docTrangThaiUrl(queryString: string): TrangThaiTwinUrl {
  const sp = new URLSearchParams(
    queryString.startsWith("?") ? queryString.slice(1) : queryString,
  );
  return {
    phamVi: docPhamVi(sp.get("pv")),
    chon: docVatTheChon(sp.get("chon")),
    cam: docCamera(sp.get("cam")),
    lop: docLop(sp.get("lop")),
    tg: docThoiGian(sp.get("tg")),
    nap: docLuaChonNap(sp),
    thu: docThu(sp.get("thu")),
  };
}

/**
 * Đọc `thu=` → danh sách panel đang thu. Tên lạ bị BỎ, không làm hỏng cả ô —
 * cùng luật với `docLop`. Vắng ⇒ `[]` (mở cả hai), KHÔNG phải `null`: ở đây
 * không có "bộ mặc định" nào khác ngoài "mở cả hai", nên hai ca trùng nhau và
 * tách chúng ra chỉ thêm một trạng thái không ai dùng.
 */
export function docThu(raw: string | null | undefined): string[] {
  if (raw == null || raw.trim() === "") return [];
  const ra: string[] = [];
  for (const phan of raw.split(",")) {
    const t = phan.trim();
    if (PANEL_THU_DUOC.includes(t) && !ra.includes(t)) ra.push(t);
  }
  return ra;
}

/** Ghi danh sách panel thu → chuỗi, thứ tự theo `PANEL_THU_DUOC` (TẤT ĐỊNH). */
export function ghiThu(thu: readonly string[]): string {
  return PANEL_THU_DUOC.filter((p) => thu.includes(p)).join(",");
}

/**
 * Đọc ba ô nạp. Mỗi ô ĐỘC LẬP: một `?toa=abc` hỏng không được làm mất `?nm=3`
 * hợp lệ đi cùng — người mở link vẫn tới đúng nhà máy, chỉ mất lựa chọn toà.
 *
 * ⚠ KHÔNG có ca "id âm rơi về 1": `soNguyenDuong` trả `null` và tầng gọi rơi về
 *   phần tử đầu của danh sách THẬT. Sửa `-1` thành `1` là bịa ra một id có thể
 *   tồn tại và trỏ vào một nhà máy khác hẳn.
 */
export function docLuaChonNap(sp: URLSearchParams): LuaChonNapUrl {
  const oSo = (k: string): number | null => {
    const v = sp.get(k);
    return v === null ? null : soNguyenDuong(v.trim());
  };
  return { nm: oSo("nm"), toa: oSo("toa"), tang: oSo("tang") };
}

/**
 * Ghi trạng thái → query string (KHÔNG kèm `?`).
 *
 * ★ Ô `null`/`undefined` bị BỎ HẲN khỏi URL thay vì ghi chuỗi rỗng: URL ngắn,
 *   và `docTrangThaiUrl(ghiTrangThaiUrl(x))` cho lại đúng `x` (tính khứ hồi mà
 *   test canh). Ngoại lệ CÓ CHỦ Ý là `lop: []` — nó ghi ra `lop=` để giữ được ba
 *   ca của `docLop`.
 *
 * Thứ tự tham số CỐ ĐỊNH (pv, chon, cam, lop, tg) để cùng một trạng thái luôn
 * cho cùng một chuỗi — điều kiện để so sánh "URL có đổi không" bằng phép so
 * chuỗi rẻ tiền thay vì phải phân tích lại.
 */
export function ghiTrangThaiUrl(tt: Partial<TrangThaiTwinUrl>): string {
  const sp = new URLSearchParams();
  if (tt.phamVi) sp.set("pv", ghiPhamVi(tt.phamVi));
  if (tt.chon) sp.set("chon", ghiVatTheChon(tt.chon));
  if (tt.cam) sp.set("cam", ghiCamera(tt.cam));
  if (tt.lop != null) sp.set("lop", ghiLop(tt.lop));
  if (tt.tg != null) sp.set("tg", ghiThoiGian(tt.tg));
  if (tt.nap) {
    if (tt.nap.nm != null) sp.set("nm", String(tt.nap.nm));
    if (tt.nap.toa != null) sp.set("toa", String(tt.nap.toa));
    if (tt.nap.tang != null) sp.set("tang", String(tt.nap.tang));
  }
  // `thu: []` KHÔNG ghi ra: "mở cả hai" là mặc định, và một `?thu=` rỗng trong
  // mọi URL chia sẻ chỉ làm nhiễu mà không mang thông tin nào.
  if (tt.thu != null && tt.thu.length > 0) sp.set("thu", ghiThu(tt.thu));
  return sp.toString();
}

/**
 * Trộn thay đổi vào một query string SẴN CÓ, giữ nguyên mọi tham số lạ.
 *
 * ⚠ Vì sao phải giữ tham số lạ: `/twin` không sở hữu độc quyền query string —
 *   `useFilterBar()` của design system cũng ghi vào đó, và các công cụ theo dõi
 *   gắn `utm_*`. Ghi đè cả chuỗi sẽ lặng lẽ nuốt trạng thái của thành phần khác.
 *
 * Truyền `null` cho một khoá để XOÁ nó (`{ chon: null }` = bỏ chọn).
 */
export function tronTrangThaiUrl(
  queryStringHienTai: string,
  thayDoi: ThayDoiTwinUrl,
): string {
  const sp = new URLSearchParams(
    queryStringHienTai.startsWith("?") ? queryStringHienTai.slice(1) : queryStringHienTai,
  );
  const dat = (khoa: string, gt: string | null) => {
    if (gt === null) sp.delete(khoa);
    else sp.set(khoa, gt);
  };
  if ("phamVi" in thayDoi) dat("pv", thayDoi.phamVi ? ghiPhamVi(thayDoi.phamVi) : null);
  if ("chon" in thayDoi) dat("chon", thayDoi.chon ? ghiVatTheChon(thayDoi.chon) : null);
  if ("cam" in thayDoi) dat("cam", thayDoi.cam ? ghiCamera(thayDoi.cam) : null);
  if ("lop" in thayDoi) dat("lop", thayDoi.lop != null ? ghiLop(thayDoi.lop) : null);
  if ("tg" in thayDoi) dat("tg", thayDoi.tg != null ? ghiThoiGian(thayDoi.tg) : null);
  /*
   * ★★★ ĐỔI MỘT CẤP NẠP PHẢI XOÁ CÁC CẤP DƯỚI — nếu không, URL tự mâu thuẫn.
   *
   * Chọn nhà máy khác mà giữ nguyên `?toa=7&tang=9` thì hai id đó trỏ vào toà/
   * tầng của nhà máy CŨ. `phanGiaiNap` sẽ không tìm thấy chúng và rơi về phần
   * tử đầu — tức hành vi vẫn đúng, NHƯNG URL trên thanh địa chỉ khai một thứ
   * mà màn hình hiện một thứ khác, và người dùng copy đúng cái URL sai đó đi
   * gửi. Nên xoá tại nguồn thay vì trông cậy vào phép rơi-về ở tầng dưới.
   *
   * ⚠ Chỉ xoá khi khoá CẤP TRÊN có mặt trong `thayDoi` mà cấp dưới KHÔNG có:
   *   một lượt đặt cả ba ô cùng lúc (khôi phục từ link) phải giữ nguyên cả ba.
   */
  if (thayDoi.nap) {
    const n = thayDoi.nap;
    if ("nm" in n) dat("nm", n.nm != null ? String(n.nm) : null);
    if ("toa" in n) dat("toa", n.toa != null ? String(n.toa) : null);
    if ("tang" in n) dat("tang", n.tang != null ? String(n.tang) : null);
    if ("nm" in n && !("toa" in n)) sp.delete("toa");
    if (("nm" in n || "toa" in n) && !("tang" in n)) sp.delete("tang");
  }
  if ("thu" in thayDoi) {
    const t = thayDoi.thu;
    dat("thu", t != null && t.length > 0 ? ghiThu(t) : null);
  }
  return sp.toString();
}

/** Cách ghi vào history của trình duyệt. */
export type KieuGhiLichSu = "push" | "replace";

/**
 * §9.4 — quyết định `pushState` hay `replaceState` cho một thay đổi.
 *
 * ĐỔI PHẠM VI hoặc ĐỔI VẬT THỂ CHỌN là "đi tới một chỗ khác" ⇒ `push`, để nút
 * Back của trình duyệt quay lại cấp trước (đúng kỳ vọng của người dùng, và là
 * đường đi lên rẻ nhất bên cạnh breadcrumb).
 *
 * Mọi thứ còn lại (camera, lớp, mốc thời gian) là "vẫn ở chỗ đó, nhìn khác đi"
 * ⇒ `replace`. Camera một mình sinh hàng trăm sự kiện mỗi giây; đẩy vào history
 * làm nút Back mất tác dụng hoàn toàn.
 */
export function kieuGhiLichSu(thayDoi: ThayDoiTwinUrl): KieuGhiLichSu {
  // ★ `nap` cũng là "đi tới chỗ khác": đổi tầng/toà/nhà máy thay TOÀN BỘ dữ
  //   liệu trên màn. Nút Back phải quay lại được tầng vừa xem — và khác camera
  //   ở chỗ nó sinh MỘT sự kiện mỗi lần bấm, không phải hàng trăm mỗi giây.
  return "phamVi" in thayDoi || "chon" in thayDoi || "nap" in thayDoi ? "push" : "replace";
}

/**
 * Phạm vi suy ra từ vật thể vừa chọn, khi người dùng click trên cảnh.
 *
 * Click một MÁY không tự động tụt xuống phạm vi `may` (camera sẽ nhảy sát vào
 * máy mỗi lần lỡ tay click) — nó chỉ CHỌN. Hàm này chỉ dùng cho thao tác
 * "đi tới" tường minh (double-click, nút "Bay tới", click dải Line).
 */
export function phamViChoVatThe(v: VatTheChon): PhamVi {
  switch (v.loai) {
    case "machine":
      return { cap: "may", id: v.id };
    case "line":
      return { cap: "line", id: v.id };
    case "factory":
      return { cap: "nhaMay", id: v.id };
    // Trạm và xưởng KHÔNG có cấp phạm vi riêng (§10C.2 chỉ có 5 cấp). Trạm thuộc
    // về phạm vi Line của nó, nhưng lineId không suy được từ mình id trạm ở đây
    // — nên giữ nguyên cấp hiện tại là việc của tầng gọi; ta trả về cấp `tang`
    // như mẫu số chung an toàn nhất (nhìn thấy cả trạm lẫn hàng xóm của nó).
    case "station":
    case "workshop":
      return { cap: "tang", id: null };
  }
}
