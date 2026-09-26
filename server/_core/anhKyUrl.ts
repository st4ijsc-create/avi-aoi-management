/**
 * ★★★ URL ẢNH KÝ HMAC NGẮN HẠN — **CHỦ DUY NHẤT** của phép ký/kiểm cho các lối vào ảnh.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * VÌ SAO MODULE NÀY TỒN TẠI
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Trình duyệt cùng origin tự gửi cookie phiên cho `<img src="/uploads/…">`, nên phía web một
 * middleware phiên là đủ. **App di động thì KHÔNG**: `<Image source={{uri}}>` của React Native
 * không mang cookie và không mang header tuỳ biến — đo được ở
 * `FactoryAlertSystem/src/services/imageService.ts:52-70` (ghép chuỗi trần) và
 * `stationService.ts:1445-1458` (chỉ `/reference-image-file` mới được gắn khoá).
 * ⇒ Kênh DUY NHẤT còn lại cho app là **query string**. Đây chính là khuôn đã có tiền lệ trong repo:
 *   `server/_core/factoryAlertDownloadToken.ts` (tải APK — Android DownloadManager cũng không mang
 *   cookie). Module này là anh em của nó, khác ở chỗ ràng buộc theo **ĐƯỜNG DẪN** thay vì
 *   `version/filename`, vì tập tệp ảnh là mở còn tập APK là đóng.
 *
 * ⚠ Ký và kiểm **HOÀN TOÀN CỤC BỘ** (`node:crypto`). Không một byte nào rời máy chủ — ràng buộc
 *   "nhà máy không có internet" giữ nguyên.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ `pv` (MỤC) LÀ Ô **CÓ TẢI TRỌNG**, KHÔNG PHẢI TRANG TRÍ — và đây là chỗ dễ tự lừa nhất
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Cám dỗ đầu tiên là nhét "phạm vi nhà máy của người ký" vào chữ ký cho *có vẻ* chặt. Nhưng lúc
 * KIỂM, bộ kiểm **không có gì để đối chiếu ô ấy với** — muốn đối chiếu thì phải phân giải lại tệp →
 * nhà máy, đúng cái phép tra cứu đắt mà URL ký sinh ra để tránh. Một ô không ai kiểm được là một
 * **cái đồng hồ không kim**: nó làm chữ ký DÀI HƠN chứ không CHẶT HƠN, và lớp lỗi ấy đã trả giá
 * nhiều lần trong repo này.
 *
 * ⇒ `pv` ở đây mang **MỤC ĐÍCH** (`"anh"` | `"zip"`), và mỗi tuyến **khẳng định mục nó chờ đợi**.
 *   Nhờ vậy ô này ĐO ĐƯỢC: một vé cấp để xem ảnh **không** mở được tuyến tải ZIP, và đột biến
 *   "bỏ phép so mục" làm lưới ĐỎ (`anhKyUrl.test.ts` §4). Tính chất an ninh thật vẫn là
 *   **đường dẫn + hạn + chữ ký**; `pv` là phép **phân tách miền** chồng lên trên, có kiểm được.
 *
 * ⚠ Chữ ký phủ **ĐƯỜNG DẪN, KHÔNG phủ query**: app đang tự thêm `?w=200&q=60` để xin ảnh thu nhỏ
 *   (`FactoryAlertSystem/.../panelParts.tsx:433-447`, `gallery.tsx:34-38`,
 *   `ImageViewerModal.tsx:153-161`). Phủ cả query sẽ làm mọi vé chết ngay khi app đổi bề rộng ảnh —
 *   một bản vá "chặt hơn" mà chức năng đã chết. `w`/`q` đã được kẹp biên ở nơi dùng và không chọn
 *   được TỆP nào, nên để chúng ngoài chữ ký không mở thêm cửa nào.
 *
 * Định dạng: `<đường dẫn>?exp=<epoch giây>&pv=<mục>&sig=<hmac hex>`
 *   hmac = HMAC_SHA256(bí mật, `v1:${đườngDẫn}:${exp}:${mục}`)
 *
 * Env:
 *  - `ANH_KY_SECRET` (khoá riêng; lùi về `SESSION_SECRET` → `JWT_SECRET` → `MASTER_API_KEY` →
 *    một giá trị dev có ghi tên rõ ràng — cùng quy ước với `factoryAlertDownloadToken.ts`)
 *  - `ANH_KY_TTL_SECONDS` (mặc định 900 = 15 phút, kẹp 60..86400)
 */
import { createHmac, timingSafeEqual } from "node:crypto";

const PHIEN_BAN = "v1";

/**
 * MỤC ĐÍCH của một vé. Tuyến nào kiểm vé thì khẳng định đúng mục của mình.
 *
 * ⚠ `switch` ở nơi dùng phải VÉT CẠN: thêm một mục thứ ba mà quên quyết định tuyến nào nhận nó
 *   thì `tsc` phải đỏ, chứ không được lặng lẽ rơi vào một nhánh "cho qua".
 */
export type MucKyAnh = "anh" | "zip";

function biMatKy(): string {
  return (
    process.env.ANH_KY_SECRET ||
    process.env.SESSION_SECRET ||
    process.env.JWT_SECRET ||
    process.env.MASTER_API_KEY ||
    "dev-anh-ky-secret-change-me"
  );
}

/** Hạn sống của một vé, tính bằng giây. Kẹp 60..86400 để một cấu hình sai không đẻ vé vĩnh viễn. */
export function hanKySeconds(): number {
  const v = Number(process.env.ANH_KY_TTL_SECONDS);
  if (!Number.isFinite(v) || v <= 0) return 15 * 60;
  return Math.min(Math.max(Math.floor(v), 60), 24 * 60 * 60);
}

/**
 * Chuẩn hoá đường dẫn trước khi ký/kiểm.
 *
 * ⚠⚠ HAI ĐẦU PHẢI GỌI CÙNG HÀM NÀY. Lúc ký, đường dẫn đến từ CSDL ở dạng đã giải mã
 * (`/uploads/inspections/142/R105.jpg`); lúc kiểm, nó đến từ `req.originalUrl` ở dạng **có thể đã
 * mã hoá phần trăm** (dấu cách → `%20`, chữ có dấu → `%C3%A1`). Không chuẩn hoá ⇒ mọi tệp có ký tự
 * cần mã hoá sẽ **luôn** trượt chữ ký, và triệu chứng là "ảnh nào cũng xem được trừ vài ảnh" —
 * một lỗi cực khó lần ra từ phía người dùng.
 *
 * ⚠ `decodeURIComponent` NÉM với chuỗi `%` lạc (ví dụ tên tệp có `100%.jpg`); lùi về chuỗi thô là
 *   đúng chiều: hai đầu vẫn khớp nhau, và không có lối thoát nào mở ra.
 */
export function duongDanChuanHoa(raw: string): string {
  const khongQuery = raw.split("?")[0] ?? "";
  try {
    return decodeURIComponent(khongQuery);
  } catch {
    return khongQuery;
  }
}

function kyTho(duongDan: string, exp: number, muc: MucKyAnh): string {
  return createHmac("sha256", biMatKy())
    .update(`${PHIEN_BAN}:${duongDan}:${exp}:${muc}`)
    .digest("hex");
}

/**
 * Cấp một vé cho ĐÚNG một đường dẫn + ĐÚNG một mục.
 *
 * @param duongDan đường dẫn tuyệt đối trên máy chủ, ví dụ `/uploads/inspections/142/R105.jpg`.
 *   Query (nếu người gọi lỡ truyền vào) bị cắt bỏ — chữ ký không phủ query, xem docblock đầu file.
 * @returns chuỗi URL đã gắn `?exp=&pv=&sig=`, dùng thẳng được cho `<Image source={{uri}}>`.
 */
export function kyDuongDanAnh(duongDan: string, muc: MucKyAnh, nowMs: number = Date.now()): string {
  const dd = duongDanChuanHoa(duongDan);
  const exp = Math.floor(nowMs / 1000) + hanKySeconds();
  const sig = kyTho(dd, exp, muc);
  return `${dd}?exp=${exp}&pv=${encodeURIComponent(muc)}&sig=${sig}`;
}

/**
 * Ký một giá trị `imageUrl` đọc từ CSDL — **chỉ khi nó là đường dẫn nội bộ**.
 *
 * ⚠ Cột `imageUrl`/`referenceImageUrl` không thuần nhất: phần lớn là `/uploads/…` hoặc
 * `/api/aoi/image/…`, nhưng có hàng mang URL TUYỆT ĐỐI (`http://…`, di sản từ chế độ lưu trữ
 * `forge`) và có hàng mang `data:`. Ký một URL tuyệt đối là vô nghĩa **và có hại**: bộ kiểm ở đầu
 * kia so với `req.baseUrl + req.path` (một đường dẫn), nên vé sẽ không bao giờ khớp — ta sẽ tự tay
 * làm hỏng đúng những ảnh đang chạy được.
 */
export function kyNeuLaDuongDanNoiBo(url: string, muc: MucKyAnh): string {
  if (!url.startsWith("/")) return url;
  return kyDuongDanAnh(url, muc);
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// KÝ CẢ MỘT THÂN PHẢN HỒI — chống khuôn "N+1 chép tay"
// ══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Tiền tố của những đường dẫn mà **cổng ảnh thật sự canh** (`thuMoCongAnh(…, "anh", …)`).
 *
 * ⚠ ĐO ĐƯỢC, KHÔNG SUY RA. Hai tiền tố này là hai chỗ duy nhất trong repo có một lượt kiểm vé đứng
 *   trước byte ảnh — cả hai gắn ở `_core/index.ts`: middleware tĩnh của thư mục `uploads`, và
 *   tuyến phục vụ ảnh theo gói AOI (`/api/aoi/image/:packageId/:fileName`). Ký một tiền tố thứ ba
 *   mà không có bộ kiểm tương ứng chỉ làm URL DÀI HƠN chứ không mở được gì — đúng lớp lỗi "đồng hồ
 *   không kim" mà docblock đầu file đã đặt tên.
 *
 * ⚠ Cố ý KHÔNG viết nguyên văn biểu thức gắn tuyến (`app.use(…)`/`app.get(…)`) trong chú thích này:
 *   `xacThucBeMatRest.test.ts §6b` đếm điểm gắn tuyến theo **VĂN BẢN** nên khớp cả trong chú thích,
 *   và một chú thích sẽ làm file này bị khai nhầm là "file gắn tuyến Express thẳng" — nó không gắn
 *   tuyến nào. (Chính lưới ấy đã ghi sẵn hai dương tính giả cùng loại.)
 *
 * ⚠ `/api/aoi/image/…` có mặt ở đây vì cột `measurement_results.imageUrl` **không thuần nhất**:
 *   `aoiPackageRouter` ghi giá trị dạng ấy vào đúng cột mà `/uploads/…` cũng dùng (đo trên
 *   `aoi_management`: `ai_image_embeddings.imageUrl` đang giữ 600 giá trị `/uploads/` **và** 390
 *   giá trị `/api/`). Một bộ ký chỉ nhìn `/uploads/` sẽ bỏ sót đúng những hàng ấy.
 */
const TIEN_TO_CO_CONG_ANH = ["/uploads/", "/api/aoi/image/"] as const;

/** Chuỗi này có phải một đường dẫn ảnh nội bộ **có cổng canh** không. */
export function laDuongDanCoCongAnh(v: string): boolean {
  return TIEN_TO_CO_CONG_ANH.some((t) => v.startsWith(t));
}

/**
 * Độ sâu tối đa khi đi vào thân phản hồi.
 *
 * ⚠ Không phải phép tối ưu mà là **cầu chì**: thân phản hồi của repo này sâu nhất khoảng 5 tầng
 *   (`data.points[].images.ngImages[].imageUrl`). Một cấu trúc sâu hơn 12 tầng gần như chắc chắn là
 *   một đối tượng KHÔNG phải DTO lọt vào — dừng lại và trả nguyên còn hơn đi mãi.
 */
const DO_SAU_TOI_DA = 12;

function dequyKy(v: unknown, muc: MucKyAnh, daTham: WeakSet<object>, doSau: number): unknown {
  if (typeof v === "string") return laDuongDanCoCongAnh(v) ? kyDuongDanAnh(v, muc) : v;
  if (v === null || typeof v !== "object") return v;
  if (doSau >= DO_SAU_TOI_DA) return v;
  if (daTham.has(v)) return v;

  if (Array.isArray(v)) {
    daTham.add(v);
    return v.map((x) => dequyKy(x, muc, daTham, doSau + 1));
  }

  // ⚠⚠ CHỈ đi vào **object THUẦN**. Đây là ràng buộc an toàn quan trọng nhất của hàm này, không
  //    phải một phép tối ưu:
  //    • `Date`, `Buffer`, `Decimal` — đi vào sẽ **phá hình dạng** (một `Date` biến thành `{}`).
  //    • đối tượng SQL của drizzle (`ResolvedDataScope.filter`) có **tham chiếu vòng**; repo này đã
  //      bị nó giết superjson và `tsc` KHÔNG bắt được. `WeakSet` ở trên chặn vòng vô hạn, nhưng
  //      phép lọc nguyên mẫu này mới là thứ khiến ta **không bao giờ chạm vào nó ngay từ đầu**.
  const nguyenMau = Object.getPrototypeOf(v);
  if (nguyenMau !== Object.prototype && nguyenMau !== null) return v;

  daTham.add(v);
  const ra: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    ra[k] = dequyKy(x, muc, daTham, doSau + 1);
  }
  return ra;
}

/**
 * ★★★ Ký **mọi** đường dẫn ảnh nội bộ nằm bất kỳ đâu trong một thân phản hồi.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * VÌ SAO KÝ Ở **BIÊN PHẢN HỒI** CHỨ KHÔNG Ở TỪNG TRƯỜNG
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Ký từng trường (`imageUrl: kyNeuLaDuongDanNoiBo(r.imageUrl, "anh")`) là khuôn **"N+1 chép tay"**:
 * nó đúng đúng vào ngày viết, rồi người sau thêm một nhánh thứ hai vào cùng tuyến và trường mới
 * lặng lẽ ra ngoài ở dạng thô. Đo được ngay trong repo này: `/api/external/stations/:id/inspection-points`
 * dựng `allPoints` từ **HAI** vòng lặp riêng biệt (điểm-qua-máy và điểm-qua-workstation), mỗi vòng
 * chép lại `referenceImageUrl: p.referenceImageUrl` một lần. Ký ở biên phủ cả hai — và phủ luôn
 * nhánh thứ ba nếu có ai thêm.
 *
 * ⚠ Đây **KHÔNG** phải bộ ký thứ hai: nó gọi đúng `kyDuongDanAnh` ở trên. Chủ của phép ký vẫn là
 *   một, hàm này chỉ quyết định *đi tới đâu* trong thân phản hồi.
 *
 * ⚠ **LUỸ ĐẲNG**: `kyDuongDanAnh` cắt query trước khi ký, nên ký lại một URL đã ký cho ra một URL
 *   ký hợp lệ duy nhất. Gọi thừa trên một thân đã ký từng trường không làm hỏng gì.
 *
 * ⚠ **KHÔNG sửa tại chỗ**: trả về một cấu trúc mới. Người gọi có thể vẫn đang giữ đối tượng gốc để
 *   ghi log hoặc để so khớp.
 *
 * ⚠⚠ **KHÔNG được dùng cho các tuyến mà client GỬI NGƯỢC giá trị ấy về làm KHOÁ KHỚP.** Đo được:
 *   `annotationRouters` chạy `WHERE "imageUrl" = ${input.imageUrl}` (10 chỗ) và
 *   `db/aiSegmentation.ts:40` chạy `eq(defectSegmentations.imageUrl, filter.imageUrl)` — client
 *   nhận `imageUrl` rồi gửi lại đúng chuỗi ấy. Ký giá trị phát ra sẽ làm phép so **không bao giờ
 *   khớp nữa**, và triệu chứng là chú thích ảnh lặng lẽ mất chứ không phải một lỗi nhìn thấy được.
 *   Đây là cùng lớp lỗi với "`col.header` vừa là nhãn vừa là khoá khớp file Excel" trong sổ tay repo.
 */
export function kyAnhTrongThan<T>(than: T, muc: MucKyAnh): T {
  return dequyKy(than, muc, new WeakSet<object>(), 0) as T;
}

/** Lý do một vé bị từ chối — **chỉ để ghi log**; tuyến trả về một câu chung, không tiết lộ nhánh nào trượt. */
export type LyDoTruotChuKy = "thieu" | "sai-dinh-dang" | "het-han" | "sai-muc" | "sai-chu-ky";

export type KetQuaKiemChuKy =
  | { readonly ok: true }
  | { readonly ok: false; readonly lyDo: LyDoTruotChuKy };

/**
 * Kiểm một vé trên đường dẫn đang được yêu cầu.
 *
 * ⚠ `mucMongDoi` là tham số **BẮT BUỘC**, không có mặc định: một mặc định sẽ biến phép phân tách
 *   miền thành thứ người viết tuyến mới có thể quên mà không thấy gì đỏ.
 *
 * ⚠ So chữ ký bằng `timingSafeEqual`, và **so độ dài TRƯỚC** vì `timingSafeEqual` ném khi hai
 *   buffer khác độ dài.
 */
export function kiemChuKyAnh(
  duongDanYeuCau: string,
  q: { exp?: unknown; pv?: unknown; sig?: unknown },
  mucMongDoi: MucKyAnh,
  nowMs: number = Date.now(),
): KetQuaKiemChuKy {
  const sig = typeof q.sig === "string" ? q.sig : undefined;
  const expRaw = typeof q.exp === "string" ? q.exp : undefined;
  const pv = typeof q.pv === "string" ? q.pv : undefined;
  if (!sig || !expRaw || !pv) return { ok: false, lyDo: "thieu" };

  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || !Number.isInteger(exp)) return { ok: false, lyDo: "sai-dinh-dang" };

  // ⚠ Mục được so TRƯỚC hạn và TRƯỚC chữ ký: một vé `zip` gõ vào tuyến ảnh phải bị từ chối vì
  //   ĐÚNG lý do ấy, kể cả khi nó còn hạn và chữ ký hoàn toàn hợp lệ.
  if (pv !== mucMongDoi) return { ok: false, lyDo: "sai-muc" };

  if (Math.floor(nowMs / 1000) > exp) return { ok: false, lyDo: "het-han" };

  const dd = duongDanChuanHoa(duongDanYeuCau);
  const mongDoi = kyTho(dd, exp, mucMongDoi);
  if (sig.length !== mongDoi.length) return { ok: false, lyDo: "sai-chu-ky" };
  try {
    const khop = timingSafeEqual(Buffer.from(sig, "utf8"), Buffer.from(mongDoi, "utf8"));
    return khop ? { ok: true } : { ok: false, lyDo: "sai-chu-ky" };
  } catch {
    return { ok: false, lyDo: "sai-chu-ky" };
  }
}
