/**
 * ★★★ 2026-08-18 (điều tra dân số phạm vi đọc · §D tuyến Express) — **CHỦ DUY NHẤT của
 * *"một lượt gọi `/api/external/**` được nhìn thấy nhà máy nào"*.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ VÌ SAO MODULE NÀY TỒN TẠI THAY VÌ BA DÒNG CHÉP VÀO MỖI TUYẾN
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `validateExternalAuth` (`server/_core/index.ts:1643`) nhận **HAI** loại người gọi vào cùng một
 * cửa, và mọi tuyến phía sau nó đối xử với cả hai như nhau:
 *
 *   1. **`x-master-key`** — `isValidMasterKey` so `timingSafeEqual` với ĐÚNG MỘT giá trị của cả
 *      bản triển khai. Không có bảng nào buộc một master key vào một nhà máy ⇒ **không tồn tại
 *      nhà máy nào để thu hẹp về**. Đây là TOÀN CỤC TƯỜNG MINH, cùng kết luận đã ghi ở
 *      `server/routers/publicProductScope.ts` và `api/export/exportRouter.reportScopeAxisOf`.
 *   2. **`Authorization: Bearer <token>`** — một NGƯỜI DÙNG có thật, có gán nhà máy, và
 *      middleware đặt `req.externalUser`. Đây là hình dạng danh tính mà `PhamViNguoiXem`
 *      (`server/db/hierarchy.ts:140`) sinh ra để phục vụ.
 *
 * ⇒ Đo được ngày 2026-08-18: **26** tuyến `/api/external/**` GET chạm dữ liệu tenant, và
 *   `req.externalUser` chỉ được đọc ở **4** chỗ (hai trong số đó là POST). Nghĩa là một người dùng
 *   của nhà máy A, đăng nhập hợp lệ qua `/api/external/auth/login`, đọc được **toàn bộ** đội máy,
 *   trạm, cảnh báo và số liệu kiểm của mọi nhà máy khác.
 *
 * ⚠⚠ Vì sao là MỘT CHỦ: phép ánh xạ *"người gọi ngoài → phạm vi"* mà chép vào 26 tuyến là 26 bản
 *    luật, và **bản lỏng nhất sẽ quyết định ai thấy gì** (đúng lý lẽ đã ghi ở
 *    `publicProductScope.sanPhamTrongNhaMay` và `_congLoopback.ts`).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ BỐN RÀNG BUỘC CỦA REPO NÀY, ĐỀU ĐƯỢC GIỮ TẠI ĐÂY
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  1. **KHÔNG BAO GIỜ trả/spread `ResolvedDataScope`.** Nó mang ô `filter` là SQL drizzle có tham
 *     chiếu vòng (`PgTable → PgSerial → table`) ⇒ `Converting circular structure to JSON`, và
 *     `tsc` KHÔNG bắt được (chỉ cấm thuộc tính thừa với *object literal*). Kiểu ở đây chỉ mang
 *     **một số và một chuỗi**, nên lỗi ấy **không diễn đạt được**.
 *  2. **`undefined` không bao giờ là một nhánh mặc định.** `nguoiXemCuaPhamVi` là `switch` VÉT
 *     CẠN: thêm một lối vào thứ ba vào `validateExternalAuth` mà quên quyết định phạm vi của nó
 *     ⇒ `tsc` đỏ **ngay tại đây**, chứ không lặng lẽ rơi vào `return undefined` (= "không lọc" =
 *     đúng cái lỗ module này đi đóng).
 *  3. **`scopeApplied` là một BOOLEAN, không phải nhãn `no_factory_assignment`.** Nhãn ấy nói về
 *     một **tài khoản NGƯỜI DÙNG chưa được gán nhà máy**; ở đây nhánh `toanCuc` là một KHOÁ, và
 *     gắn nhãn tài khoản cho một khoá là một lời khai SAI. (Tiền lệ: `publicProductScope`.)
 *  4. **0 dòng im lặng là nói dối.** Tuyến trả DANH SÁCH phải kèm `scopeApplied` để phía gọi phân
 *     biệt *"nhà máy tôi không có gì"* với *"tôi vừa bị thu hẹp"*; tuyến tra theo KHOÁ phải
 *     **403 có mã máy-đọc-được**, không phải 404 (404 nói "không tồn tại" về một thứ CÓ TỒN TẠI).
 */
import type { PhamViNguoiXem } from "../db/hierarchy";

/** Mã MÁY-ĐỌC-ĐƯỢC của một lượt từ chối vì phạm vi trên cụm `/api/external/**`. */
export const MA_NGOAI_PHAM_VI_REST = "external_factory_scope_denied";

/**
 * Phạm vi của **NGƯỜI GỌI** một tuyến đứng sau `validateExternalAuth`.
 *
 * Hai nhánh, **cả hai CÓ TÊN** — không nhánh nào là `undefined` rơi vào mặc định.
 */
export type PhamViGoiNgoai =
  | { readonly kieu: "toanCuc" }
  | { readonly kieu: "nguoiDung"; readonly userId: number; readonly userRole: string };

/** Nhánh toàn cục, đặt tên một lần để nơi gọi không viết object literal rải rác. */
export const PHAM_VI_NGOAI_TOAN_CUC: PhamViGoiNgoai = { kieu: "toanCuc" };

/**
 * Đọc phạm vi của người gọi từ `req`.
 *
 * ⚠ CHỈ đọc `req.externalUser` — thứ do **máy chủ** đặt sau khi đối chiếu vé (`sdk.verifySession`
 * + `getUserByOpenId` + ba phép chặn). **CẤM** đọc `req.query`/`req.body`: một `?factoryId=` là
 * lời TỰ KHAI của người gọi, đúng thứ mà cả bản điều tra dân số này tồn tại để bắt.
 *
 * ⚠ Không có `externalUser` ⇒ lượt gọi ấy đã qua nhánh `x-master-key` (đó là nhánh DUY NHẤT còn
 * lại của `validateExternalAuth`; mọi lượt khác đã bị nó chặn bằng 401 trước khi tới đây).
 */
export function phamViGoiNgoai(req: unknown): PhamViGoiNgoai {
  const u = (req as { externalUser?: { id?: unknown; role?: unknown } } | null)?.externalUser;
  const id = typeof u?.id === "number" && Number.isFinite(u.id) ? u.id : null;
  if (id === null) return PHAM_VI_NGOAI_TOAN_CUC;
  return { kieu: "nguoiDung", userId: id, userRole: typeof u?.role === "string" ? u.role : "user" };
}

/**
 * `undefined` = **KHÔNG áp cổng nào** (toàn cục tường minh); ngược lại là phạm vi người xem để
 * truyền thẳng xuống `db.getMachines` / `db.getStations` / `machineIdsTrongPhamVi`.
 *
 * ⚠ `switch` VÉT CẠN có chủ ý — xem ràng buộc (2) ở đầu file.
 */
export function nguoiXemCuaPhamVi(pv: PhamViGoiNgoai): PhamViNguoiXem | undefined {
  switch (pv.kieu) {
    case "toanCuc":
      return undefined;
    case "nguoiDung":
      return { userId: pv.userId, userRole: pv.userRole };
  }
}

/**
 * Phạm vi có THẬT SỰ được áp cho lượt gọi này không — ô mà tuyến trả danh sách gắn vào thân JSON.
 *
 * ⚠ Đây là `boolean`, KHÔNG phải nhãn `no_factory_assignment` — xem ràng buộc (3) ở đầu file.
 */
export function phamViDaAp(pv: PhamViGoiNgoai): boolean {
  return pv.kieu === "nguoiDung";
}

/**
 * Thân JSON của một lượt TỪ CHỐI vì phạm vi trên cụm `/api/external/**` (HTTP **403**).
 *
 * ⚠ Vì sao 403 chứ không phải 404 hay 200-rỗng: trả "không tồn tại" cho một bản ghi CÓ TỒN TẠI là
 * một lời khai sai chỉ đổi chiều — người vận hành sẽ đi tạo lại một bản ghi trùng, hoặc đi tìm lỗi
 * ở chỗ không có lỗi. Tiền lệ trong repo: `publicProductScope.tuChoiNgoaiPhamVi` và
 * `api/export/biRouter.dataset_not_tenant_scopable`.
 */
export function thanTuChoiPhamViNgoai(
  thucThe: string,
  moTa: string,
): { success: false; code: string; message: string } {
  return {
    success: false,
    code: MA_NGOAI_PHAM_VI_REST,
    message:
      `${MA_NGOAI_PHAM_VI_REST}: ${thucThe} '${moTa}' is outside the factories assigned to the ` +
      `calling account. The request is refused instead of being answered with unfiltered data ` +
      `or a silent empty result.`,
  };
}
