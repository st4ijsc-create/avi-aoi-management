/**
 * ★★★ **CHỦ DUY NHẤT** của câu hỏi *"lượt gọi này có được đọc BYTE ẢNH không?"*
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * LỖ ĐƯỢC ĐÓNG (đo 2026-08-18, đọc từng dòng thân handler — không suy từ tên)
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `app.use("/uploads", express.static(uploadsRoot))` (`server/_core/index.ts`) phục vụ thư mục ảnh
 * kiểm THÔ của **mọi nhà máy** mà không một middleware xác thực nào đứng trước. Cùng với năm tuyến
 * ảnh REST cũng không có phép xác thực nào, hệ quả đo được: `/api/inspection/:id/images` nhận **số
 * nguyên TUẦN TỰ** rồi tra thẳng `product_inspections` ⇒ ai ở trong mạng nhà máy chỉ cần đếm
 * `1..N` là gom được số serial + ảnh của **mọi** nhà máy. Không cần một chứng thực nào.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * BA LỐI VÀO, **CẢ BA CÓ TÊN** — không lối nào là `undefined` rơi vào nhánh mặc định
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  1. **`chuKy`** — vé HMAC ngắn hạn trên đúng đường dẫn ấy (`_core/anhKyUrl.ts`). Dành cho app di
 *     động: `<Image source={{uri}}>` của React Native **không** mang cookie và **không** mang
 *     header tuỳ biến, nên query string là kênh duy nhất còn lại.
 *  2. **`nguoiDung`** — phiên cookie `app_session_id`, phân giải qua `thuXacThucRest`. Đây là lối
 *     của trình duyệt, và nó **tự động** vì `<img src="/uploads/…">` cùng origin luôn kèm cookie.
 *  3. **`toanCuc`** — `x-master-key` **CHỈ QUA HEADER**.
 *     ⚠ Cố ý KHÔNG nhận `?masterKey=`: repo đã deprecate kênh ấy (`validateExternalAuth`,
 *       `server/_core/index.ts`) vì khoá rò qua log/URL, và mở lại nó ở đây sẽ là **kênh chứng
 *       thực thứ hai đi ngược quyết định cũ** — đúng lớp lỗi "phòng vệ mới vô hiệu hoá phòng vệ
 *       cũ". App di động không cần nó: câu trả lời cho app là **vé ký** (lối 1).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ VÌ SAO LỐI `chuKy` **KHÔNG** ĐI QUA PHÉP KIỂM PHẠM VI LẦN THỨ HAI
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Vé được cấp bởi một tuyến **ĐÃ xác thực và ĐÃ kiểm phạm vi** (`/api/inspection/:id/images` chỉ
 * cấp vé sau khi đã xác nhận người hỏi thấy được lần kiểm ấy). Vé ràng buộc vào **ĐÚNG MỘT đường
 * dẫn** + **ĐÚNG MỘT mục** + **một hạn**. Kiểm phạm vi lần hai ở đây sẽ đòi phân giải ngược
 * tệp → bản ghi → máy → nhà máy cho **từng byte ảnh** — đúng phép tra cứu đắt mà vé sinh ra để
 * tránh, và với `/uploads` thì nó **không phân giải được** (xem khối "thứ KHÔNG siết được").
 * ⇒ Tính chất an ninh của lối 1 là: *"người cầm vé đã được ai đó có quyền trao đúng tệp này, trong
 *   15 phút"*. Nói đúng như thế, không nói hơn.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ CỜ `ANH_CONG_MO` — VÌ SAO MẶC ĐỊNH VẪN **MỞ**, VÀ ĐÓ KHÔNG PHẢI SỰ NHÚT NHÁT
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Đây là **đổi hợp đồng API đang được dùng**. Phép đo người gọi (grep `client/`,
 * `FactoryAlertSystem/`, `tools/`, `scripts/`, `test-*.mjs`) cho ra:
 *
 *   | lối vào                              | trình duyệt `client/` | app RN `FactoryAlertSystem/` |
 *   |--------------------------------------|-----------------------|------------------------------|
 *   | `/uploads/**`                        | ✅ cookie tự động      | 💥 **VỠ** (≥13 điểm render)  |
 *   | `/api/inspection/:id/images`         | — không gọi           | 💥 **VỠ** (2 màn)            |
 *   | `/api/aoi/image/:pkg/:file`          | ✅ cookie tự động      | 💥 **VỠ** (gián tiếp)        |
 *   | `/api/aoi/download/:pkg`             | ✅ cookie tự động      | — không gọi                  |
 *
 * Các APK **đã phát ra hiện trường** không có bản vá của lượt này. Bật cưỡng chế ngay = làm hỏng
 * ứng dụng đang chạy được, và brief đặt *"không làm hỏng ứng dụng đang chạy"* là **ưu tiên số một**.
 * ⇒ Toàn bộ cơ chế được dựng, được canh bằng lưới, và cách chỗ bật đúng **một biến môi trường**.
 *   `ANH_CONG_MO=false` ⇒ cưỡng chế. Quyết định *khi nào* bật thuộc về chủ dự án, không phải agent.
 *
 * ⚠ HAI tuyến **KHÔNG** nằm sau cờ và đã cưỡng chế **ngay**:
 *   `/api/measurement-point/:id/reference-image` và `/api/product-model/:id/reference-images`.
 *   Người gọi DUY NHẤT đo được là `test-android-api.mjs`, và nó **đã gửi sẵn `X-API-Key`**. Siết
 *   hai tuyến này không làm vỡ một client nào — nên để chúng sau cờ là trì hoãn vô cớ.
 */
import type { Request } from "express";
import type { PhamViNguoiXem } from "../db/hierarchy";
import { isValidMasterKey } from "../_core/masterKey";
import { kiemChuKyAnh, type MucKyAnh } from "../_core/anhKyUrl";
import { thanTuChoiRest, thuXacThucRest } from "./_xacThucRest";

/** Mã MÁY-ĐỌC-ĐƯỢC của một lượt từ chối vì phạm vi trên các lối vào ẢNH. */
export const MA_TU_CHOI_PHAM_VI_ANH = "image_factory_scope_denied";

/**
 * Cưỡng chế đang BẬT hay chưa.
 *
 * ⚠ Mặc định `"true"` = **MỞ** (hành vi cũ, không vỡ client nào) — cùng quy ước và cùng lý do với
 *   `FACTORY_ALERT_DOWNLOAD_OPEN` (`_core/factoryAlertDownloadToken.ts:52`), tiền lệ đã có trong
 *   repo cho đúng tình huống "đội thiết bị ngoài hiện trường chưa kịp cập nhật".
 */
export function congAnhMo(): boolean {
  const v = (process.env.ANH_CONG_MO ?? "true").trim().toLowerCase();
  return v !== "false" && v !== "0";
}

/** Lối vào đã được xác lập cho một lượt gọi. **Cả ba nhánh có tên.** */
export type LoiVaoAnh =
  | { readonly kieu: "chuKy" }
  | { readonly kieu: "nguoiDung"; readonly userId: number; readonly userRole: string }
  | { readonly kieu: "toanCuc" };

export type KetQuaCongAnh =
  | { readonly ok: true; readonly loiVao: LoiVaoAnh }
  | {
      readonly ok: false;
      readonly ma: 401 | 403 | 500;
      readonly than: { error: string; code: string };
    };

/**
 * Mở cổng cho một lượt gọi, theo thứ tự RẺ → ĐẮT.
 *
 * ⚠ Thứ tự có ý nghĩa đo được: vé ký và master key là phép so chuỗi thuần (không chạm CSDL), còn
 *   `thuXacThucRest` là một lượt đọc bảng. Đặt phiên lên trước sẽ bắt **mọi** byte ảnh của app di
 *   động phải trả giá một truy vấn — trên một màn ảnh 20 điểm đo đó là 20 truy vấn thừa.
 *
 * @param duongDanDayDu đường dẫn tuyệt đối như client gõ vào (`req.originalUrl` đã cắt query).
 *   ⚠ **KHÔNG** dùng `req.path` khi middleware được gắn qua `app.use("/uploads", …)`: bên trong
 *   `req.path` đã bị cắt mất tiền tố `/uploads`, mà chữ ký lại phủ đường dẫn ĐẦY ĐỦ ⇒ mọi vé sẽ
 *   trượt. Người gọi tự dựng và truyền vào để sai lầm ấy không diễn đạt được ở đây.
 */
export async function thuMoCongAnh(
  req: Request,
  muc: MucKyAnh,
  duongDanDayDu: string,
): Promise<KetQuaCongAnh> {
  // ── Lối 1: vé ký ngắn hạn (app di động) ────────────────────────────────────────────────────
  const chuKy = kiemChuKyAnh(duongDanDayDu, req.query ?? {}, muc);
  if (chuKy.ok) return { ok: true, loiVao: { kieu: "chuKy" } };

  // ── Lối 3: master key, CHỈ QUA HEADER (xem docblock đầu file) ──────────────────────────────
  const headerKey = req.header("x-master-key") || req.header("X-Master-Key");
  if (headerKey && isValidMasterKey(headerKey)) {
    return { ok: true, loiVao: { kieu: "toanCuc" } };
  }

  // ── Lối 2: phiên cookie (trình duyệt) ──────────────────────────────────────────────────────
  const xacThuc = await thuXacThucRest(req);
  if (xacThuc.ok) {
    return {
      ok: true,
      loiVao: {
        kieu: "nguoiDung",
        userId: xacThuc.user.id,
        userRole: typeof xacThuc.user.role === "string" ? xacThuc.user.role : "user",
      },
    };
  }

  // ⚠ Thân giữ nguyên hợp đồng `{error, code}` của `thanTuChoiRest` — client cũ đã đọc `error`,
  //   `code` là ô MỚI để bản địa hoá. **0 dòng im lặng**: không trả 404, không trả ảnh rỗng.
  return { ok: false, ma: xacThuc.ma, than: thanTuChoiRest(xacThuc) };
}

/**
 * `undefined` = KHÔNG áp cổng phạm vi nào; ngược lại là phạm vi để truyền xuống
 * `machineIdsTrongPhamVi`.
 *
 * ⚠ `switch` VÉT CẠN có chủ ý: thêm một lối vào thứ tư mà quên quyết định phạm vi của nó ⇒ `tsc`
 *   đỏ **ngay tại đây**, chứ không lặng lẽ rơi vào `return undefined` (= "không lọc" = đúng cái lỗ
 *   module này đi đóng). Cùng khuôn với `_phamViNgoai.nguoiXemCuaPhamVi`.
 */
export function nguoiXemCuaLoiVao(loiVao: LoiVaoAnh): PhamViNguoiXem | undefined {
  switch (loiVao.kieu) {
    case "chuKy":
      return undefined;
    case "toanCuc":
      return undefined;
    case "nguoiDung":
      return { userId: loiVao.userId, userRole: loiVao.userRole };
  }
}

/**
 * Phạm vi có THẬT SỰ được áp cho lượt gọi này không.
 *
 * ⚠ Đây là `boolean`. **KHÔNG** được thay bằng nhãn `no_factory_assignment`: nhãn ấy nói về một
 *   **tài khoản NGƯỜI DÙNG chưa được gán nhà máy**, còn hai nhánh `chuKy`/`toanCuc` là một VÉ và
 *   một KHOÁ — gắn nhãn tài khoản cho chúng là một lời khai SAI. (Tiền lệ: `publicProductScope`,
 *   `_phamViNgoai` ràng buộc (3).)
 */
export function phamViDaApAnh(loiVao: LoiVaoAnh): boolean {
  return loiVao.kieu === "nguoiDung";
}

/**
 * Thân JSON của một lượt TỪ CHỐI vì phạm vi (HTTP **403**).
 *
 * ⚠ 403 chứ không phải 404 hay 200-rỗng: trả "không tồn tại" cho một bản ghi CÓ TỒN TẠI là một lời
 * khai sai chỉ đổi chiều — người vận hành sẽ đi tạo lại bản ghi trùng, hoặc đi tìm lỗi ở chỗ không
 * có lỗi. Tiền lệ: `publicProductScope.tuChoiNgoaiPhamVi`, `_phamViNgoai.thanTuChoiPhamViNgoai`,
 * `api/export/biRouter.dataset_not_tenant_scopable`.
 *
 * ⚠ `scopeApplied: true` luôn đúng ở đây theo cấu tạo: chỉ nhánh `nguoiDung` mới tới được lượt từ
 *   chối vì phạm vi (hai nhánh kia trả `undefined` ⇒ không có cổng nào để trượt).
 */
export function thanTuChoiPhamViAnh(
  thucThe: string,
  moTa: string,
): { success: false; code: string; scopeApplied: true; message: string } {
  return {
    success: false,
    code: MA_TU_CHOI_PHAM_VI_ANH,
    scopeApplied: true,
    message:
      `${MA_TU_CHOI_PHAM_VI_ANH}: ${thucThe} '${moTa}' is outside the factories assigned to the ` +
      `calling account. The request is refused instead of being answered with unfiltered data ` +
      `or a silent empty result.`,
  };
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// NHỚ ĐỆM tập máy trong phạm vi
// ══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * ⚠ Vì sao có nhớ đệm: `machineIdsTrongPhamVi` chạy chuỗi `machines → stations → production_lines
 * → workshops` mỗi lần gọi. Một màn ảnh của app hỏi 20 ảnh liên tiếp ⇒ 20 lượt JOIN giống hệt nhau
 * cho cùng một người trong cùng một giây.
 *
 * ⚠⚠ TTL **ngắn** (30 giây) và đó là một lựa chọn có hệ quả: nhớ đệm phép PHÂN QUYỀN nghĩa là một
 * lượt thu hồi gán nhà máy chỉ có hiệu lực sau tối đa 30 giây. Dài hơn thì tiện hơn nhưng biến
 * nhớ đệm thành một cửa hậu có hạn dùng; ngắn hơn thì mất tác dụng. 30 giây là khoảng mà một thao
 * tác quản trị vẫn "có cảm giác tức thì" còn một màn ảnh vẫn chỉ tốn một truy vấn.
 *
 * ⚠ Khoá nhớ đệm gồm **CẢ `userRole`**: cùng một `userId` đổi vai là đổi phạm vi, và một khoá chỉ
 *   theo `userId` sẽ phục vụ phạm vi CŨ cho vai MỚI.
 */
const TTL_NHO_DEM_MS = 30_000;
const nhoDemPhamVi = new Map<string, { hetHan: number; ids: number[] | null }>();

/** Xoá nhớ đệm — **chỉ dùng trong lưới**, để một ca không kế thừa phạm vi của ca trước. */
export function xoaNhoDemPhamViAnh(): void {
  nhoDemPhamVi.clear();
}

/**
 * Tập `machines.id` mà lối vào này được phép thấy.
 *
 * `null` = không áp cổng nào (vé ký / master key / vai toàn quyền) ⇒ nơi gọi **không được** thêm
 * cổng nào (chiều DƯƠNG chống vá quá tay).
 * `[]`   = phạm vi RỖNG (tài khoản chưa được gán nhà máy) ⇒ nơi gọi phải từ chối, KHÔNG phải "quên
 *          lọc".
 */
export async function machineIdsChoLoiVao(loiVao: LoiVaoAnh): Promise<number[] | null> {
  const nguoiXem = nguoiXemCuaLoiVao(loiVao);
  if (!nguoiXem) return null;

  const khoa = `${nguoiXem.userId}:${nguoiXem.userRole}`;
  const now = Date.now();
  const cu = nhoDemPhamVi.get(khoa);
  if (cu && cu.hetHan > now) return cu.ids;

  const { machineIdsTrongPhamVi } = await import("../db/hierarchy");
  const ids = await machineIdsTrongPhamVi(nguoiXem);
  nhoDemPhamVi.set(khoa, { hetHan: now + TTL_NHO_DEM_MS, ids });
  return ids;
}

/**
 * Một máy CỤ THỂ có nằm trong phạm vi của lối vào này không.
 *
 * ⚠ `machineId` `null`/`undefined` ⇒ **`false`** (fail-closed). Một bản ghi ảnh không truy được về
 *   máy là một bản ghi không chiếu được về nhà máy; đoán "chắc là được" ở đây là mở đúng cái cửa
 *   mà module này đi đóng.
 */
export async function mayTrongPhamViAnh(
  loiVao: LoiVaoAnh,
  machineId: number | null | undefined,
): Promise<boolean> {
  const ids = await machineIdsChoLoiVao(loiVao);
  if (ids === null) return true;
  if (machineId == null || !Number.isFinite(machineId)) return false;
  return ids.includes(machineId);
}

/**
 * ★★★ Một **SẢN PHẨM** có nằm trong phạm vi của lối vào này không.
 *
 * ⚠⚠ TIỀN ĐỀ CỦA BRIEF **SAI** ở đúng chỗ này: `product_models` **KHÔNG có cột nhà máy nào** (đã
 * kiểm cả `drizzle/schema/product.ts` lẫn `information_schema` — ghi ở `publicProductScope.ts:28`).
 * Sản phẩm là dữ liệu chủ **DÙNG CHUNG**, nên "so tiền tố đường dẫn" hay "đọc `factoryId` của sản
 * phẩm" đều không diễn đạt được. Phải chiếu qua **HỢP của BA đường** liên kết máy, và cả ba đều
 * load-bearing (đo trên `aoi_management`: 30/1/41 sản phẩm chiếu ra theo từng đường).
 *
 * ⚠ Cố ý dùng lại ĐÚNG ba đường của `publicProductScope.congSanPhamTrongNhaMay` — hai phép kiểm
 *   cho cùng một câu hỏi là cách chúng lệch nhau, và **bản lỏng hơn** sẽ quyết định ai thấy gì.
 *   Khác biệt duy nhất: ở đây trục là tập `machines.id` (đã có sẵn, đã nhớ đệm) thay vì một
 *   `factoryId` đơn lẻ — người dùng có thể được gán NHIỀU nhà máy.
 *
 * ⚠⚠ `inArray()` chứ **KHÔNG** `sql\`col = ANY(${mangJs})\``: khuôn ANY-mảng-JS làm drizzle kết
 *   xuất một tham số mảng mà Postgres từ chối với `42809` ⇒ **500**. Lớp lỗi này đã có tên riêng
 *   trong sổ tay repo ("Drizzle ANY-array antipattern").
 *
 * ⚠ CSDL vắng ⇒ `false` (fail-closed), KHÔNG phải `true`.
 */
export async function sanPhamTrongPhamViAnh(
  loiVao: LoiVaoAnh,
  productModelId: number | null | undefined,
): Promise<boolean> {
  const ids = await machineIdsChoLoiVao(loiVao);
  if (ids === null) return true;
  if (ids.length === 0) return false;
  if (productModelId == null || !Number.isFinite(productModelId)) return false;

  const { getDb } = await import("../db/connection");
  const database = await getDb();
  if (!database) return false;

  const { productMachineMappings, measurementPointDefs, productInspections } = await import(
    "../../drizzle/schema"
  );
  const { and, eq, inArray, isNotNull } = await import("drizzle-orm");

  const duong1 = await database
    .select({ id: productMachineMappings.id })
    .from(productMachineMappings)
    .where(
      and(
        eq(productMachineMappings.productModelId, productModelId),
        inArray(productMachineMappings.machineId, ids),
      ),
    )
    .limit(1);
  if (duong1.length > 0) return true;

  const duong2 = await database
    .select({ id: measurementPointDefs.id })
    .from(measurementPointDefs)
    .where(
      and(
        eq(measurementPointDefs.productModelId, productModelId),
        isNotNull(measurementPointDefs.machineId),
        inArray(measurementPointDefs.machineId, ids),
      ),
    )
    .limit(1);
  if (duong2.length > 0) return true;

  const duong3 = await database
    .select({ id: productInspections.id })
    .from(productInspections)
    .where(
      and(
        eq(productInspections.productModelId, productModelId),
        inArray(productInspections.machineId, ids),
      ),
    )
    .limit(1);
  return duong3.length > 0;
}
