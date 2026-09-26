/**
 * ★★★ **CHỦ DUY NHẤT** của câu hỏi *"đường dẫn `/uploads/**` này thuộc nhà máy NÀO?"*
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * LỖ ĐƯỢC ĐÓNG (đo 2026-08-18)
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `_congAnh.ts` đóng phần **XÁC THỰC** cho `/uploads/**`: không có phiên/vé/khoá thì không đọc
 * được byte nào. Nhưng nó **KHÔNG** đóng phần **UỶ QUYỀN** — một tài khoản hợp lệ của nhà máy A
 * đoán đúng đường dẫn vẫn tải được ảnh của nhà máy B. Đo được: `supervisor1` tải được ảnh nhà máy B.
 *
 * `express.static` phục vụ BYTE TỆP; nó không đi qua một lượt đọc bảng nào, nên **không có bản ghi
 * nào để gắn cổng SQL vào**. Trục duy nhất còn lại là **CHÍNH ĐƯỜNG DẪN**. May mắn đo được:
 * *mọi* thư mục mang dữ liệu tenant đã sẵn khoá phân giải ở **hai đoạn đầu** ⇒ **KHÔNG phải di trú
 * một tệp nào**.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ★★★ ĐIỀU TRA DÂN SỐ HAI GỐC — và **TIỀN ĐỀ CỦA BRIEF SAI Ở ĐÂY**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Brief nói *"`LOCAL_STORAGE_DIR=/uploads` nhưng thư mục thật là `./uploads` (58.957 tệp)"*.
 * **Sai.** Trên Windows `path.resolve("/uploads")` cho **`<ổ đĩa hiện tại>:\uploads`**, tức
 * `D:\uploads` — một thư mục **KHÁC** và **CÓ THẬT** (2.033 tệp). Đó mới là gốc đang được
 * `express.static` phục vụ hôm nay. `./uploads` (58.957 tệp) chỉ được phục vụ ở bản triển khai
 * **không** đặt `LOCAL_STORAGE_DIR` (nhánh `path.join(process.cwd(), "uploads")`).
 * ⇒ Bộ phân loại này phải phủ **HỢP của cả hai** bản điều tra, không phải cái nào một mình:
 *
 *   ┌──────────────────────┬──────────────┬─────────────┬──────────────────────────────────────┐
 *   │ thư mục              │ `./uploads`  │ `D:\uploads`│ hình dạng                            │
 *   ├──────────────────────┼──────────────┼─────────────┼──────────────────────────────────────┤
 *   │ inspections/         │ 56.527       │ 2.002       │ `inspections/<id>/<tệp>`             │
 *   │ aoi-cache/           │ 2.261        │ 0           │ `aoi-cache/<packageId>/<tệp>`        │
 *   │ measurement-points/  │ 108          │ 9           │ `measurement-points/<id>/<tệp>`      │
 *   │ aoi/                 │ 30           │ 0           │ 6 đoạn (CŨ) **và** 10 đoạn (MỚI)     │
 *   │ machines/            │ 4            │ 4           │ `machines/<id>/<tệp>`                │
 *   │ product-models/      │ 5            │ 0           │ `product-models/<id>/<tệp>`          │
 *   │ report-artifacts/    │ 0            │ **13**      │ ⚠ KHÔNG có trong bảng của brief      │
 *   │ exports/             │ 0            │ **1**       │ ⚠ KHÔNG có trong bảng của brief      │
 *   │ temp/                │ 0            │ **1**       │ ⚠ `temp` ≠ `tmp` — hai tên khác nhau │
 *   │ models · *-releases  │ ~19          │ 3           │ tác tạo, KHÔNG thuộc tenant          │
 *   └──────────────────────┴──────────────┴─────────────┴──────────────────────────────────────┘
 *
 * ⚠⚠ `report-artifacts/` và `exports/` **MANG dữ liệu tenant** và brief bỏ sót cả hai. Chúng đã có
 * một tuyến CÓ uỷ quyền (`/api/reports/artifacts/:id/download`, lọc theo `viewer`), nên đường
 * `/uploads/report-artifacts/…` là một **lối đi vòng qua chính cổng ấy**. Chúng vào nhánh
 * `tuyenRieng` = **TỪ CHỐI có tên**, không phải "tác tạo" và cũng không phải "hình dạng lạ".
 * (Đo: `grep -rn "uploads/exports|uploads/report-artifacts" client/ server/ FactoryAlertSystem/`
 *  ⇒ **0** người gọi ⇒ từ chối không làm hỏng màn hình nào.)
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ **BA TẦNG, THỨ TỰ CÓ TẢI TRỌNG** — đảo thứ tự là mở lại một cửa
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  **1. TRAVERSAL — chặn cho MỌI lối vào, kể cả vé ký và master key.** Một `..` không thoát khỏi
 *     một nhà máy, nó thoát khỏi **cả thư mục gốc**; không có phạm vi nào để bàn. Và không một
 *     đường dẫn hợp lệ nào trong CSDL chứa `..` (đo: 1.996/1.996 `measurement_results.imageUrl`
 *     đúng khuôn `/uploads/inspections/<số>/<tệp>`), nên chặn ở đây **không thể** làm hỏng gì.
 *
 *  **2. PHẠM VI `null` ⇒ ĐI THẲNG.** `machineIdsChoLoiVao` trả `null` cho vé ký · master key ·
 *     vai toàn quyền, và `_congAnh.ts` đã ghi thành luật: *"`null` = không áp cổng nào ⇒ nơi gọi
 *     **không được** thêm cổng nào"*. Đây là chiều DƯƠNG chống vá quá tay, và nó cũng là thứ giữ
 *     cho ứng dụng di động sống: một vé ký trên `aoi-cache/AOI-INS-…` vẫn phục vụ được **dù**
 *     `inspection_packages` rỗng (đo trên `aoi_management`: **0 hàng**).
 *
 *  **3. PHÂN TÍCH HÌNH DẠNG** — chỉ tới đây mới có một phạm vi để so.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ **CÁI GIÁ ĐÃ ĐO, VÀ NÓ KHÔNG NHỎ: 1.996/1.996 ẢNH SẼ BỊ TỪ CHỐI TRÊN CSDL HÔM NAY**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `product_inspections` có 22.996 hàng (id 54.751…95.302). Nhưng **129.770/157.369** hàng
 * `measurement_results` là MỒ CÔI — `inspectionId` của chúng trỏ tới những hàng đã bị xoá. Và
 * **cả 1.996** hàng còn mang `imageUrl` đều nằm trong nhóm mồ côi ấy (id 86.045…88.040).
 * ⇒ `inspections/<id>` **không phân giải được cho một tệp nào đang có trên đĩa của CSDL này**.
 *
 * Đây là ca *"hình dạng ĐÚNG, khoá KHÔNG tra được"*, và nó có **mã RIÊNG**
 * (`image_path_unresolved`), **không** gộp vào `image_factory_scope_denied`: người vận hành phải
 * phân biệt được *"ảnh của nhà máy khác"* với *"bản ghi đã bị xoá, tệp thành rác"*. Gộp hai thứ ấy
 * là bắt họ đi tìm một lỗi phân quyền không tồn tại.
 * ⚠ Vẫn **TỪ CHỐI** chứ không cho qua: một tệp không truy được về nhà máy là một tệp không chiếu
 *   được về ai — cho qua ở đây đúng bằng việc không có cổng nào. Và hệ quả THẬT bằng 0: cả 1.996
 *   ảnh ấy **đã** không hiện được ở bất kỳ màn nào (`/api/inspection/:id/images` tra
 *   `product_inspections` trước ⇒ **404** cho đúng những id ấy).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * NHỚ ĐỆM — **SỰ KIỆN** nhớ lâu, **QUYỀN** nhớ ngắn (hai thứ khác nhau, hai TTL khác nhau)
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * *"Lần kiểm 87.323 chạy trên máy 12"* là một **SỰ KIỆN đã đóng băng** (`product_inspections` là
 * bảng WORM) ⇒ nhớ 10 phút, và một màn 20 ảnh cùng lần kiểm chỉ tốn **1** truy vấn.
 * *"Người dùng 7 được xem những máy nào"* là một **QUYỀN** ⇒ đã nhớ 30 giây ở `_congAnh.ts`, và
 * module này **không** nhớ lại lần thứ hai. Trộn hai TTL vào một là biến nhớ đệm thành cửa hậu.
 *
 * ⚠ **Nhớ đệm cả lượt TRẬT** (giá trị `null`) với TTL ngắn hơn: nếu không, một kẻ đếm `1..N` trên
 *   `inspections/<id>` sẽ tạo đúng N lượt truy vấn — một cổng an ninh tự tay mở đường DoS.
 */
import type { LoiVaoAnh } from "./_congAnh";
import {
  MA_TU_CHOI_PHAM_VI_ANH,
  machineIdsChoLoiVao,
  mayTrongPhamViAnh,
  nhaMayIdsChoLoiVao,
  sanPhamTrongPhamViAnh,
} from "./_congAnh";

// ══════════════════════════════════════════════════════════════════════════════════════════════
// MÃ MÁY-ĐỌC-ĐƯỢC — **0 dòng im lặng là nói dối**
// ══════════════════════════════════════════════════════════════════════════════════════════════

/** Đường dẫn chứa `..`, đường tuyệt đối, `\`, byte NUL, ký tự điều khiển… — chặn cho MỌI lối vào. */
export const MA_DUONG_DAN_XAU = "image_path_traversal_rejected";

/** Hình dạng KHÔNG khớp một khuôn nào đã biết ⇒ fail-closed. */
export const MA_HINH_DANG_LA = "image_path_shape_unknown";

/** Hình dạng ĐÚNG nhưng khoá không tra được (bản ghi đã xoá / gói chưa commit). */
export const MA_KHONG_PHAN_GIAI = "image_path_unresolved";

/** Tệp CÓ chủ tenant nhưng đã có tuyến uỷ quyền RIÊNG — đường `/uploads` là lối đi vòng. */
export const MA_CO_TUYEN_RIENG = "image_path_has_dedicated_route";

// ══════════════════════════════════════════════════════════════════════════════════════════════
// TẦNG 1 — CHUẨN HOÁ + CHỐNG TRAVERSAL
// ══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * ⚠ Một tệp CÓ THẬT ở gốc `D:\uploads` (`aoi-test-standalone.html`) và vài tệp phẳng ở
 * `models/`/`gguf-models/`. Nên "độ sâu tối thiểu 2" **không** phải một tiền đề đúng.
 */
const DOAN_TOI_DA = 24;

export type KetQuaChuanHoa =
  | { readonly ok: true; readonly doan: readonly string[] }
  | { readonly ok: false; readonly ma: typeof MA_DUONG_DAN_XAU; readonly lyDo: string };

/**
 * Cắt `/uploads` (nếu còn), giải mã, rồi **từ chối** mọi thứ không phải một chuỗi đoạn hiền lành.
 *
 * ⚠⚠ Giải mã **TRƯỚC** khi soi `..`, và đó là toàn bộ vấn đề: `%2e%2e%2f` là `../` sau một lượt
 *    `decodeURIComponent`. Một bộ lọc soi chuỗi THÔ sẽ cho nó đi qua, rồi `express.static` giải mã
 *    và mở đúng cái cửa vừa "được canh". Đây là hình dạng cổ điển nhất của một cổng giả.
 *
 * ⚠ `decodeURIComponent` **NÉM** với `%` lạc (tên tệp `100%.jpg` có thật trong repo này —
 *   `anhKyUrl.duongDanChuanHoa` đã ghi bẫy ấy). Ở đó lùi về chuỗi thô là đúng (hai đầu vẫn khớp
 *   nhau); ở ĐÂY thì **KHÔNG**: một chuỗi không giải mã được là một chuỗi ta không biết nó trỏ đâu
 *   ⇒ **TỪ CHỐI**. Hai quyết định ngược nhau cho hai câu hỏi khác nhau, cố ý.
 *   Giá đo được: 0 tệp trong cả hai gốc có `%` trong tên.
 *
 * ⚠ Giải mã **MỘT LẦN**, không lặp tới điểm bất động: `%252e%252e` giải một lần ra `%2e%2e` — một
 *   chuỗi KHÔNG chứa `..`, và `express.static` cũng chỉ giải mã một lần, nên nó cũng không thấy
 *   `..`. Giải mã hai lần ở đây sẽ **từ chối** một tệp tên `%2e%2e` hoàn toàn hợp lệ mà tầng dưới
 *   phục vụ được — tức tự đẻ ra một lỗi "chặt hơn" làm hỏng chức năng. Bám ĐÚNG số lượt giải mã
 *   của tầng phục vụ là luật ở đây.
 */
export function chuanHoaDuongDanTai(raw: string): KetQuaChuanHoa {
  const xau = (lyDo: string): KetQuaChuanHoa => ({ ok: false, ma: MA_DUONG_DAN_XAU, lyDo });

  if (typeof raw !== "string" || raw.length === 0) return xau("empty path");
  if (raw.length > 2048) return xau("path too long");

  const khongQuery = raw.split("?")[0] ?? "";
  let giaiMa: string;
  try {
    giaiMa = decodeURIComponent(khongQuery);
  } catch {
    return xau("malformed percent-encoding");
  }

  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(giaiMa)) return xau("control character");
  if (giaiMa.includes("\\")) return xau("backslash (Windows separator) is never a valid segment");

  const doan = giaiMa.split("/").filter((s, i) => !(i === 0 && s === ""));
  if (doan.length === 0) return xau("empty path");
  if (doan.length > DOAN_TOI_DA) return xau("too many segments");
  // Người gọi có thể đưa cả `/uploads/x/y` lẫn `/x/y` (bên trong `app.use("/uploads", …)` express
  // đã cắt tiền tố). Nhận cả hai, chuẩn hoá về MỘT.
  if (doan[0] === "uploads") doan.shift();
  if (doan.length === 0) return xau("empty path");

  for (const d of doan) {
    if (d === "") return xau("empty segment (// or trailing /)");
    if (d === "." || d === "..") return xau("dot segment");
    if (d.length > 255) return xau("segment too long");
    // ⚠⚠ ĐO ĐƯỢC BỞI LƯỚI, KHÔNG SUY RA: bản đầu chỉ soi ĐẦU chuỗi (`/^[A-Za-z]:/` trên cả đường
    //    dẫn), nên `/uploads/C:/Windows/win.ini` đi lọt — sau khi cắt tiền tố `uploads`, đoạn `C:`
    //    nằm ở GIỮA. `path.resolve(root, "C:/…")` trên Windows nhảy sang **ổ đĩa khác**, tức một
    //    lượt thoát gốc hoàn chỉnh. Phép soi phải ở TỪNG ĐOẠN, không ở đầu chuỗi.
    if (/^[A-Za-z]:/.test(d)) return xau(`segment '${d}' looks like a Windows drive specifier`);
  }
  return { ok: true, doan };
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// TẦNG 3 — HÌNH DẠNG
// ══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Thư mục **KHÔNG thuộc tenant**, khai **TƯỜNG MINH**.
 *
 * ⚠ Khai tường minh chứ không để rơi vào nhánh mặc định: một thư mục mới xuất hiện dưới `uploads/`
 *   phải làm cổng ĐỎ, chứ không được thừa hưởng lời phán "chắc là tác tạo" của những cái đã biết.
 *
 * ⚠ `temp` **và** `tmp` — hai tên KHÁC nhau, cả hai đều tồn tại thật ở hai gốc khác nhau. Brief chỉ
 *   khai `tmp/`; thiếu `temp/` thì mọi tệp tạm ở `D:\uploads\temp` bị từ chối.
 *
 * ⚠ `models/machine-<id>-<ts>.glb` (đo được ở `D:\uploads\models`) **có** mang một `machineId`
 *   trong TÊN TỆP. Nó vẫn ở nhóm tác tạo theo đúng lời khai của brief, và đây là chỗ ghi lại rằng
 *   nó **có thể** siết thêm sau — nhưng siết bây giờ sẽ làm gãy `WorkshopLayoutEditor` (mô hình 3D
 *   của máy được nạp cho cả sơ đồ nhà xưởng), nên đó là một quyết định sản phẩm, không phải một
 *   lượt trả nợ tự quyết.
 */
const THU_MUC_TAC_TAO: ReadonlySet<string> = new Set([
  "models",
  "mqtt-releases",
  "factory-alert-releases",
  "gguf-models",
  "tmp",
  "temp",
  "test-temp",
]);

/**
 * Tệp CÓ chủ tenant nhưng **đã có tuyến uỷ quyền riêng** ⇒ đường `/uploads` là lối đi vòng.
 * Xem khối điều tra dân số ở đầu file: 13 + 1 tệp, **0** người gọi trong toàn repo.
 */
const THU_MUC_TUYEN_RIENG: ReadonlySet<string> = new Set(["report-artifacts", "exports"]);

/** Tệp phẳng ở NGAY gốc — đo được đúng một cái. */
const TEP_GOC_TAC_TAO: ReadonlySet<string> = new Set(["aoi-test-standalone.html"]);

export type HinhDangDuongDan =
  | { readonly kieu: "tacTao"; readonly nhom: string }
  | { readonly kieu: "tuyenRieng"; readonly nhom: string }
  | { readonly kieu: "theoMay"; readonly machineId: number }
  | { readonly kieu: "theoLanKiem"; readonly inspectionId: number }
  | { readonly kieu: "theoGoi"; readonly packageId: string }
  | { readonly kieu: "theoDiemDo"; readonly pointId: number }
  | { readonly kieu: "theoSanPham"; readonly productModelId: number }
  | { readonly kieu: "theoMaMay"; readonly machineCode: string }
  | { readonly kieu: "theoMaNhaMay"; readonly factoryCodeDoan: string }
  | { readonly kieu: "la"; readonly lyDo: string };

/** `"123"` → `123`; mọi thứ khác (kể cả `"12.0"`, `"+1"`, `"1e3"`) → `null`. */
function soNguyenDuong(s: string): number | null {
  if (!/^[0-9]{1,12}$/.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/**
 * ĐỘ SÂU của đường ghi MỚI: `aoi/<corp>/<fac>/<ws>/<line>/<mc>/yyyy/mm/dd/<tệp>` = **10** đoạn.
 * ĐỘ SÂU của đường ghi CŨ:  `aoi/<mc>/yyyy/mm/dd/<tệp>`                         = **6** đoạn.
 *
 * ⚠ Hằng số này là điều kiện để phép so tiền tố `O(1)` phát biểu được: `khoaLuuTruGoi`
 * (`phamViGhiMay.ts`) thay `corporateCode` NULL bằng đoạn `_no-corp` **tường minh** đúng để độ sâu
 * không đổi. Hai khuôn có độ sâu khác nhau ⇒ phân biệt được **không cần một truy vấn nào**.
 */
const SAU_AOI_MOI = 10;
const SAU_AOI_CU = 6;

/** Vị trí đoạn `factoryCode` trong khuôn MỚI (0-based): `aoi`(0) `corp`(1) **`fac`(2)**. */
const VI_TRI_MA_NHA_MAY = 2;

/**
 * Phân loại một đường dẫn ĐÃ chuẩn hoá. **Thuần tuý** — không chạm CSDL, không chạm `process.env`.
 *
 * ⚠ Mọi khuôn "thư mục/khoá/tệp" đòi **ĐÚNG 3 đoạn**, không phải "≥ 3". Một `inspections/12/a/b.png`
 *   không phải hình dạng đã biết; nhận nó bằng cách chỉ đọc `doan[1]` là tự nới khuôn cho một cấu
 *   trúc chưa ai đo, và fail-closed là chỗ duy nhất an toàn để đứng.
 */
export function hinhDangCuaDuongDan(doan: readonly string[]): HinhDangDuongDan {
  const goc = doan[0] ?? "";

  if (doan.length === 1) {
    return TEP_GOC_TAC_TAO.has(goc)
      ? { kieu: "tacTao", nhom: goc }
      : { kieu: "la", lyDo: `unknown top-level file '${goc}'` };
  }

  if (THU_MUC_TAC_TAO.has(goc)) return { kieu: "tacTao", nhom: goc };
  if (THU_MUC_TUYEN_RIENG.has(goc)) return { kieu: "tuyenRieng", nhom: goc };

  const khoa = doan[1] ?? "";
  const baDoan = doan.length === 3;

  switch (goc) {
    case "inspections": {
      if (!baDoan) return { kieu: "la", lyDo: "inspections/ expects exactly <id>/<file>" };
      const id = soNguyenDuong(khoa);
      return id === null
        ? { kieu: "la", lyDo: `inspections/ key '${khoa}' is not a positive integer` }
        : { kieu: "theoLanKiem", inspectionId: id };
    }
    case "measurement-points": {
      if (!baDoan) return { kieu: "la", lyDo: "measurement-points/ expects exactly <id>/<file>" };
      const id = soNguyenDuong(khoa);
      return id === null
        ? { kieu: "la", lyDo: `measurement-points/ key '${khoa}' is not a positive integer` }
        : { kieu: "theoDiemDo", pointId: id };
    }
    case "machines": {
      if (!baDoan) return { kieu: "la", lyDo: "machines/ expects exactly <id>/<file>" };
      const id = soNguyenDuong(khoa);
      return id === null
        ? { kieu: "la", lyDo: `machines/ key '${khoa}' is not a positive integer` }
        : { kieu: "theoMay", machineId: id };
    }
    case "product-models": {
      if (!baDoan) return { kieu: "la", lyDo: "product-models/ expects exactly <id>/<file>" };
      const id = soNguyenDuong(khoa);
      return id === null
        ? { kieu: "la", lyDo: `product-models/ key '${khoa}' is not a positive integer` }
        : { kieu: "theoSanPham", productModelId: id };
    }
    case "aoi-cache": {
      if (!baDoan) return { kieu: "la", lyDo: "aoi-cache/ expects exactly <packageId>/<file>" };
      return khoa.length > 0 && khoa.length <= 120
        ? { kieu: "theoGoi", packageId: khoa }
        : { kieu: "la", lyDo: "aoi-cache/ packageId is empty or over-long" };
    }
    case "aoi": {
      // ⚠ Hai khuôn phân biệt bằng ĐỘ SÂU — xem `SAU_AOI_MOI` / `SAU_AOI_CU`.
      if (doan.length === SAU_AOI_MOI) {
        const fac = doan[VI_TRI_MA_NHA_MAY] ?? "";
        return fac.length > 0
          ? { kieu: "theoMaNhaMay", factoryCodeDoan: fac }
          : { kieu: "la", lyDo: "aoi/ (new layout) has an empty factory segment" };
      }
      if (doan.length === SAU_AOI_CU) {
        return khoa.length > 0
          ? { kieu: "theoMaMay", machineCode: khoa }
          : { kieu: "la", lyDo: "aoi/ (legacy layout) has an empty machine-code segment" };
      }
      return {
        kieu: "la",
        lyDo: `aoi/ depth ${doan.length} matches neither the legacy (${SAU_AOI_CU}) nor the current (${SAU_AOI_MOI}) layout`,
      };
    }
    default:
      return { kieu: "la", lyDo: `unknown top-level directory '${goc}'` };
  }
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// NHỚ ĐỆM SỰ KIỆN (đường dẫn → khoá tenant). ⚠ KHÔNG nhớ đệm PHÁN QUYẾT.
// ══════════════════════════════════════════════════════════════════════════════════════════════

/** Sự kiện đã đóng băng (`product_inspections` là bảng WORM) — nhớ lâu. */
const TTL_TRUNG_MS = Number.parseInt(process.env.ANH_UY_QUYEN_TTL_MS ?? "600000", 10) || 600_000;
/** Lượt TRẬT — nhớ ngắn, chỉ đủ để dập một lượt đếm `1..N`. */
const TTL_TRUOT_MS = 30_000;
/** Chặn trên số mục: 56.527 tệp trên đĩa ⇒ một Map không chặn là một lượt rò bộ nhớ có thật. */
const TRAN_MUC = Number.parseInt(process.env.ANH_UY_QUYEN_TRAN ?? "20000", 10) || 20_000;

/** `null` = đã tra và **KHÔNG có** (nhớ trật), khác hẳn "chưa tra". */
type MucNhoDem = { hetHan: number; may: number | null; sanPham: number | null };

const nhoDem = new Map<string, MucNhoDem>();

/** Số lượt CHẠM CSDL — thước để phép đo chi phí trước/sau là một SỐ, không phải một lời hứa. */
let soLuotTruyVan = 0;

export function thongKeNhoDemAnh(): { truyVan: number; muc: number } {
  return { truyVan: soLuotTruyVan, muc: nhoDem.size };
}

/** Chỉ dùng trong lưới — một ca không được kế thừa nhớ đệm của ca trước. */
export function xoaNhoDemUyQuyenAnh(): void {
  nhoDem.clear();
  soLuotTruyVan = 0;
}

function docNhoDem(khoa: string): MucNhoDem | undefined {
  const m = nhoDem.get(khoa);
  if (m === undefined) return undefined;
  if (m.hetHan <= Date.now()) {
    nhoDem.delete(khoa);
    return undefined;
  }
  return m;
}

function ghiNhoDem(khoa: string, may: number | null, sanPham: number | null): MucNhoDem {
  // Map giữ thứ tự CHÈN ⇒ mục cũ nhất đứng đầu. Đuổi theo lô để không phải sắp xếp gì.
  if (nhoDem.size >= TRAN_MUC) {
    let can = Math.max(1, Math.floor(TRAN_MUC / 10));
    for (const k of nhoDem.keys()) {
      nhoDem.delete(k);
      if (--can <= 0) break;
    }
  }
  const trung = may !== null || sanPham !== null;
  const m: MucNhoDem = { hetHan: Date.now() + (trung ? TTL_TRUNG_MS : TTL_TRUOT_MS), may, sanPham };
  nhoDem.set(khoa, m);
  return m;
}

/**
 * Một hình dạng CẦN CSDL → `{ may, sanPham }`.
 *
 * ⚠ CSDL vắng ⇒ `{null,null}` và **KHÔNG** ghi nhớ đệm: nhớ một lượt trật do sự cố hạ tầng sẽ kéo
 *   sự cố ấy dài thêm đúng bằng TTL, sau khi CSDL đã sống lại.
 */
async function khoaTenantCuaHinhDang(
  hd: HinhDangDuongDan,
): Promise<{ may: number | null; sanPham: number | null }> {
  const trong = { may: null, sanPham: null };

  let khoa: string;
  switch (hd.kieu) {
    case "theoLanKiem":
      khoa = `ins:${hd.inspectionId}`;
      break;
    case "theoGoi":
      khoa = `pkg:${hd.packageId}`;
      break;
    case "theoDiemDo":
      khoa = `mp:${hd.pointId}`;
      break;
    case "theoMaMay":
      khoa = `mc:${hd.machineCode}`;
      break;
    default:
      return trong;
  }

  const cu = docNhoDem(khoa);
  if (cu !== undefined) return { may: cu.may, sanPham: cu.sanPham };

  const { getDb } = await import("../db/connection");
  const database = await getDb();
  if (!database) return trong;

  const { eq } = await import("drizzle-orm");
  const schema = await import("../../drizzle/schema");
  soLuotTruyVan += 1;

  let may: number | null = null;
  let sanPham: number | null = null;
  switch (hd.kieu) {
    case "theoLanKiem": {
      const r = await database
        .select({ machineId: schema.productInspections.machineId })
        .from(schema.productInspections)
        .where(eq(schema.productInspections.id, hd.inspectionId))
        .limit(1);
      may = r[0]?.machineId ?? null;
      break;
    }
    case "theoGoi": {
      const r = await database
        .select({ machineId: schema.inspectionPackages.machineId })
        .from(schema.inspectionPackages)
        .where(eq(schema.inspectionPackages.packageId, hd.packageId))
        .limit(1);
      may = r[0]?.machineId ?? null;
      break;
    }
    case "theoDiemDo": {
      // ⚠⚠ HAI TRỤC vì `measurement_point_defs.machineId` là NULLABLE (đo: 25/110 có máy). Điểm đo
      //    gắn máy chiếu thẳng qua máy; điểm đo KHÔNG gắn máy thuộc một sản phẩm DÙNG CHUNG và phải
      //    chiếu qua hợp-BA-đường. Đây đúng là luật `_congAnh.ts` đã dùng cho tuyến REST cùng dữ
      //    liệu — cố ý **một** luật, không phải bản thứ hai.
      const r = await database
        .select({
          machineId: schema.measurementPointDefs.machineId,
          productModelId: schema.measurementPointDefs.productModelId,
        })
        .from(schema.measurementPointDefs)
        .where(eq(schema.measurementPointDefs.id, hd.pointId))
        .limit(1);
      may = r[0]?.machineId ?? null;
      sanPham = may === null ? (r[0]?.productModelId ?? null) : null;
      break;
    }
    case "theoMaMay": {
      // ⚠ KHÔNG lọc `isActive`: một máy đã ngừng vẫn phải cho CHỦ của nó xem lại ảnh cũ. Lọc ở đây
      //   sẽ biến mọi lượt gỡ máy thành một lượt xoá ảnh — bản vá xanh mà chức năng đã chết.
      const r = await database
        .select({ id: schema.machines.id })
        .from(schema.machines)
        .where(eq(schema.machines.code, hd.machineCode))
        .limit(1);
      may = r[0]?.id ?? null;
      break;
    }
    default:
      break;
  }
  ghiNhoDem(khoa, may, sanPham);
  return { may, sanPham };
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// BẢN ĐỒ `đoạn đường dẫn` → `factories.id` — cho phép so tiền tố O(1) của khuôn `aoi/` MỚI
// ══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * `doanDuongDan()` (`phamViGhiMay.ts`) **làm mất thông tin**: `A/B` và `A-B` cùng ra `A-B`. Nên bản
 * đồ này phải phát hiện VA CHẠM và **fail-closed** cho đoạn va chạm, thay vì bốc bừa một nhà máy.
 * ⚠ Đo trên `aoi_management` (3 nhà máy) và `aoi_management_test` (1.282): xem lưới —
 *   va chạm được ĐẾM chứ không được giả định bằng 0.
 *
 * ⚠ Vì sao chiếu về `factories.id` chứ không so MÃ với `getUserAssignmentCodes`: so mã là **luật
 *   thứ hai** cho cùng một câu hỏi, và bản lỏng hơn sẽ quyết định ai thấy gì. Chiếu về `id` rồi hỏi
 *   `idsTrongPhamVi("factory", …)` là đúng MỘT luật — cùng luật mà cả cây phân cấp đang dùng, và nó
 *   đã tự lo giúp cả tài khoản chỉ được gán theo **TẬP ĐOÀN** (`resolveTenantFactoryScope` trải
 *   `corporateCodes` ra `factories.id`), nên đoạn `<corp>` trên đường dẫn không cần một luật riêng.
 */
const VA_CHAM = -1;
let banDoNhaMay: { hetHan: number; map: ReadonlyMap<string, number> } | null = null;

export function xoaBanDoNhaMayAnh(): void {
  banDoNhaMay = null;
}

async function layBanDoNhaMay(): Promise<ReadonlyMap<string, number>> {
  if (banDoNhaMay !== null && banDoNhaMay.hetHan > Date.now()) return banDoNhaMay.map;

  const { getDb } = await import("../db/connection");
  const database = await getDb();
  if (!database) return new Map();

  const schema = await import("../../drizzle/schema");
  const { doanDuongDan } = await import("../routers/phamViGhiMay");
  soLuotTruyVan += 1;
  const rows = await database
    .select({ id: schema.factories.id, code: schema.factories.code })
    .from(schema.factories);

  const map = new Map<string, number>();
  for (const r of rows) {
    const seg = doanDuongDan(r.code);
    const cu = map.get(seg);
    if (cu !== undefined && cu !== r.id) map.set(seg, VA_CHAM);
    else if (cu === undefined) map.set(seg, r.id);
  }
  banDoNhaMay = { hetHan: Date.now() + TTL_TRUNG_MS, map };
  return map;
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// CỬA DUY NHẤT
// ══════════════════════════════════════════════════════════════════════════════════════════════

export type KetQuaUyQuyenAnh =
  | { readonly ok: true; readonly hinhDang: HinhDangDuongDan["kieu"] | "khongApCong" }
  | {
      readonly ok: false;
      readonly ma: 403;
      readonly than: {
        success: false;
        code: string;
        scopeApplied: boolean;
        message: string;
      };
    };

/**
 * ⚠ `scopeApplied` là **BOOLEAN**, và nó nói *"lượt gọi NÀY có bị áp cổng phạm vi không"*.
 *   Nhánh traversal trả `false` vì lượt từ chối ấy **không** đến từ phạm vi — nó đến từ hình dạng
 *   đường dẫn, và một `true` ở đó là lời khai SAI (cùng luật đã ghi ở `_congAnh.phamViDaApAnh`:
 *   nhãn `no_factory_assignment` nói về TÀI KHOẢN, đừng gắn cho một VÉ hay một ĐƯỜNG DẪN).
 */
function tuChoi(ma: string, scopeApplied: boolean, moTa: string): KetQuaUyQuyenAnh {
  return {
    ok: false,
    ma: 403,
    than: {
      success: false,
      code: ma,
      scopeApplied,
      message:
        `${ma}: ${moTa}. The request is refused instead of being answered with another factory's ` +
        `bytes or a silent empty response.`,
    },
  };
}

/**
 * Cờ HOÀN NGUYÊN **riêng** cho tầng uỷ quyền.
 *
 * ⚠ Vì sao KHÔNG dùng chung `ANH_CONG_MO`: hai tầng có hai lớp rủi ro khác nhau. Bật xác thực làm
 *   hỏng client **chưa gửi chứng thực** (đếm được, đã đo). Bật uỷ quyền làm hỏng ảnh của **người
 *   dùng hợp lệ** khi một hình dạng không phân giải được — và ở CSDL hôm nay con số ấy là
 *   1.996/1.996. Gộp hai tầng vào một công tắc nghĩa là đường lùi duy nhất cho sự cố tầng hai là
 *   **tắt luôn tầng một**, tức mở lại cả cái lỗ vừa đóng. Hai công tắc, hai đường lùi.
 *
 * Mặc định **BẬT** (cưỡng chế) khi `ANH_CONG_MO=false`: người đã quyết định đóng cổng thì không
 * phải nhớ thêm một biến thứ hai. `ANH_UY_QUYEN_MO=true` là lối lùi.
 */
export function uyQuyenAnhMo(): boolean {
  const v = (process.env.ANH_UY_QUYEN_MO ?? "false").trim().toLowerCase();
  return v === "true" || v === "1";
}

/**
 * ★ **CỬA DUY NHẤT**: đường dẫn này có được lối vào này đọc không.
 *
 * @param duongDanTai đường dẫn dưới gốc `uploads` (nhận cả dạng còn tiền tố `/uploads`).
 */
export async function uyQuyenDuongDanAnh(
  loiVao: LoiVaoAnh,
  duongDanTai: string,
): Promise<KetQuaUyQuyenAnh> {
  // ── TẦNG 1: traversal — chặn cho MỌI lối vào, kể cả vé ký/master key ────────────────────────
  const ch = chuanHoaDuongDanTai(duongDanTai);
  if (!ch.ok) return tuChoi(ch.ma, false, `path is not a plain relative upload path (${ch.lyDo})`);

  if (uyQuyenAnhMo()) return { ok: true, hinhDang: "khongApCong" };

  // ── TẦNG 2: phạm vi `null` ⇒ KHÔNG áp cổng nào (chiều DƯƠNG chống vá quá tay) ───────────────
  const idsMay = await machineIdsChoLoiVao(loiVao);
  if (idsMay === null) return { ok: true, hinhDang: "khongApCong" };

  // ── TẦNG 3: hình dạng ──────────────────────────────────────────────────────────────────────
  const hd = hinhDangCuaDuongDan(ch.doan);
  const moTa = ch.doan.join("/");

  switch (hd.kieu) {
    case "tacTao":
      // Chiều DƯƠNG: nhóm tác tạo vẫn tải được cho MỌI tài khoản đã xác thực.
      return { ok: true, hinhDang: "tacTao" };

    case "tuyenRieng":
      return tuChoi(
        MA_CO_TUYEN_RIENG,
        true,
        `'${moTa}' is tenant data served by a dedicated authorized route ` +
          `(uploads/${hd.nhom} → /api/reports/artifacts/:id/download); the raw /uploads path bypasses it`,
      );

    case "la":
      return tuChoi(MA_HINH_DANG_LA, true, `'${moTa}' matches no known upload layout (${hd.lyDo})`);

    case "theoMay":
      return (await mayTrongPhamViAnh(loiVao, hd.machineId))
        ? { ok: true, hinhDang: "theoMay" }
        : tuChoi(MA_TU_CHOI_PHAM_VI_ANH, true, `machine '${hd.machineId}' (path '${moTa}')`);

    case "theoSanPham":
      return (await sanPhamTrongPhamViAnh(loiVao, hd.productModelId))
        ? { ok: true, hinhDang: "theoSanPham" }
        : tuChoi(MA_TU_CHOI_PHAM_VI_ANH, true, `product model '${hd.productModelId}' (path '${moTa}')`);

    case "theoMaNhaMay": {
      // ★ O(1): không một truy vấn nào cho MỖI ảnh — chỉ một bản đồ 3 hàng nhớ 10 phút.
      const map = await layBanDoNhaMay();
      const fid = map.get(hd.factoryCodeDoan);
      if (fid === undefined || fid === VA_CHAM) {
        return tuChoi(
          MA_KHONG_PHAN_GIAI,
          true,
          fid === VA_CHAM
            ? `factory segment '${hd.factoryCodeDoan}' is AMBIGUOUS — two factory codes sanitise to it`
            : `factory segment '${hd.factoryCodeDoan}' matches no factory (path '${moTa}')`,
        );
      }
      // ⚠ `nhaMayIdsChoLoiVao` (NHỚ ĐỆM 30 s, cùng chủ với tập máy) chứ **KHÔNG** gọi thẳng
      //   `idsTrongPhamVi("factory", …)`: bản đầu gọi thẳng và đo được **3.054 µs/ảnh** — nó chạy
      //   một `SELECT … FROM factories WHERE code IN (…)` MỖI LƯỢT, tức lời khai "O(1), 0 truy vấn"
      //   là SAI. Xem docblock của `nhaMayIdsChoLoiVao`.
      const idsNhaMay = await nhaMayIdsChoLoiVao(loiVao);
      return idsNhaMay === null || idsNhaMay.includes(fid)
        ? { ok: true, hinhDang: "theoMaNhaMay" }
        : tuChoi(MA_TU_CHOI_PHAM_VI_ANH, true, `factory '${hd.factoryCodeDoan}' (path '${moTa}')`);
    }

    case "theoLanKiem":
    case "theoGoi":
    case "theoDiemDo":
    case "theoMaMay": {
      const { may, sanPham } = await khoaTenantCuaHinhDang(hd);
      if (may !== null) {
        return (await mayTrongPhamViAnh(loiVao, may))
          ? { ok: true, hinhDang: hd.kieu }
          : tuChoi(MA_TU_CHOI_PHAM_VI_ANH, true, `machine '${may}' (path '${moTa}')`);
      }
      if (sanPham !== null) {
        return (await sanPhamTrongPhamViAnh(loiVao, sanPham))
          ? { ok: true, hinhDang: hd.kieu }
          : tuChoi(MA_TU_CHOI_PHAM_VI_ANH, true, `product model '${sanPham}' (path '${moTa}')`);
      }
      // ⚠ Mã RIÊNG — xem khối "cái giá đã đo" ở đầu file. Đây là *"bản ghi không còn"*, KHÔNG phải
      //   *"nhà máy khác"*, và người vận hành phải đọc ra được sự khác nhau ấy.
      return tuChoi(
        MA_KHONG_PHAN_GIAI,
        true,
        `'${moTa}' has a known shape but its tenant key resolves to no row ` +
          `(deleted inspection / uncommitted package / renamed machine)`,
      );
    }
  }
}
