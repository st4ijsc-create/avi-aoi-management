/**
 * ★★★ Pha 9 nhóm A · **A6 — CHỦ DUY NHẤT của *"phân giải danh tính cho một tuyến REST"*.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ VÌ SAO MODULE NÀY TỒN TẠI — MỘT NHÁNH `if` ĐÃ VIẾT SẴN MÀ **KHÔNG BAO GIỜ CHẠY**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * `sdk.authenticateRequest` **NÉM** khi không xác thực được; nó không bao giờ trả `null`. Nhưng sáu
 * tuyến REST viết:
 *
 *     const user = await sdk.authenticateRequest(req);
 *     if (!user) { res.status(401).json(…); return; }   // ← MÃ CHẾT, không đời nào chạy
 *     …
 *   } catch (err) { res.status(500).json({ error: err.message }); }   // ← lượt ném rơi VÀO ĐÂY
 *
 * ⇒ Fail-closed **ĐÚNG CHIỀU** (không ai vào được), nhưng mã trạng thái **SAI**: một yêu cầu thiếu
 *   cookie nhận **500 Internal Server Error** thay vì **401**. Hệ quả thật, không lý thuyết:
 *   client không phân biệt được *"tôi cần đăng nhập lại"* với *"máy chủ hỏng"*, mọi bảng theo dõi
 *   lỗi 5xx bị nhiễm, và thông điệp ngoại lệ nội bộ bị bắn ra ngoài trong `err.message`.
 *
 * **ĐO ĐƯỢC** (gọi THẬT từng tuyến, không cookie — `xacThucBeMatRest.test.ts`): **6** bề mặt trả
 * 500. ⚠ Brief khai **2**; phép đếm thật gấp **ba**. Đừng tin một danh sách viết tay.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ VÌ SAO HÀM NÀY **KHÔNG** TỰ GỬI THÂN PHẢN HỒI
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Hai họ tuyến đang có **hai hợp đồng thân khác nhau** (`{error}` vs `{success:false,error}`), và
 * client của chúng đã đọc theo hai hình dạng ấy. Gộp thân về một chủ là **đổi hợp đồng API** — một
 * quyết định sản phẩm, không phải một lượt trả nợ an ninh. ⇒ Chủ này sở hữu đúng **một** thứ:
 * *"lượt xác thực hỏng ⇒ một PHÁN QUYẾT, KHÔNG ném"*; người gọi giữ nguyên thân của mình và nay
 * nhánh `if (!xacThuc.ok)` **có thật sự chạy**.
 * ⚠ M-4 đổi hình dạng phán quyết `User | null` → `KetQuaXacThucRest` (xem khối M-4 dưới): `null`
 *   chỉ mang được **một bit**, mà lối ra của điểm chung có **ba lớp** mã trạng thái. `thanTuChoiRest()`
 *   dựng **hai ô** (`error` + `code`) để người gọi bọc vào đúng hợp đồng thân của mình.
 *
 * ⚠⚠ BÀI HỌC `xacThucNoiBo` ĐƯỢC ÁP DỤNG: gộp về một chủ là đúng, **nhưng chủ ấy không được ghim
 *    cứng một đường dẫn / một danh sách tuyến**. Hàm này nhận `req` bất kỳ và không biết gì về
 *    đường dẫn nào — nên một tuyến REST **ở một file chưa tồn tại** dùng được nó ngay.
 *
 * ⚠ **KHÔNG nuốt lỗi theo chiều MỞ**: mọi lượt ném (phiên rác · `SESSION_NOT_IN_LEDGER` ·
 *   `MUST_CHANGE_PASSWORD`) đều bị **TỪ CHỐI** ⇒ người gọi dừng. Fail-closed giữ nguyên; chỉ **mã
 *   trạng thái** được sửa.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ★★★★ Review TOÀN NHÁNH Pha 9 · **M-4 — `catch { return null }` GỘP MỌI NGUYÊN NHÂN VỀ 401.**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * A6 sửa **500 → 401** và đó là lượt vá đúng. Nhưng hợp đồng `User | null` chỉ có **hai** trạng
 * thái, trong khi lối ra của `sdk.authenticateRequest` có **BỐN LOẠI** phán quyết khác nhau — và
 * C-1 của lượt trước vừa thêm loại thứ tư vào đúng cái `catch` ấy. **Đếm lại bằng cách đọc mã**
 * (`server/_core/sdk.ts`), không bằng brief:
 *
 *   | nguyên nhân (thứ tự chạy trong `xacThucTho`)              | ném                        | mã ĐÚNG |
 *   |-----------------------------------------------------------|----------------------------|---------|
 *   | cookie thiếu/rác ⇒ `"Invalid session cookie"`              | `ForbiddenError`           | **401** |
 *   | `SESSION_NOT_IN_LEDGER` / `"Session has been revoked"`     | `ForbiddenError`           | **401** |
 *   | `"Failed to sync user info"` / `"User not found"`          | `ForbiddenError`           | **401** |
 *   | `ACCOUNT_DISABLED` (C-1, `chanNeuTaiKhoanBiTat`)           | `ForbiddenError`           | **403** |
 *   | `MUST_CHANGE_PASSWORD` (Pha 8 T1, `chanNeuPhaiDoiMatKhau`) | `ForbiddenError`           | **403** |
 *   | DB không với tới (`db.phaiDoiMatKhau` nấc, …)              | **KHÔNG** `HttpError`      | **500** |
 *
 * ⇒ **BA lớp, không một lớp.** Vì sao mỗi lớp phải khác nhau — và đây là hệ quả THẬT, không lý
 *   thuyết:
 *   · **401 nghĩa là *"đăng nhập lại thì vào được"***. Trả 401 cho một tài khoản **đã bị vô hiệu
 *     hoá** hay một người **đang bị buộc đổi mật khẩu** là **bảo họ làm đúng cái việc KHÔNG cứu
 *     được họ** — và client (`useAIStream`, `useKbChatStream`) sẽ đá họ về màn đăng nhập, nơi
 *     `authService` từ chối họ **lần nữa** bằng một câu khác. Một vòng lặp không lối ra.
 *   · **500 cho một sự cố DB là câu TRUNG THỰC**: gộp nó vào 401 là dán nhãn *"lỗi của bạn"* lên
 *     một sự cố của máy chủ, và **giấu** sự cố ấy khỏi mọi bảng theo dõi 5xx — đúng lớp lỗi mà A6
 *     vừa vá theo chiều ngược lại.
 * ⚠ **Fail-closed KHÔNG đổi một ly**: cả ba lớp đều là *"dừng, không đi tiếp"*. Lượt vá này chỉ
 *   thêm **thông tin**, không thêm **cửa**. Ô đối chứng: `xacThucBeMatRest.test.ts` §3.
 * ⚠ **Chuỗi người dùng THẤY đi qua i18n**: thân phản hồi mang một **mã máy-đọc-được** (`code`),
 *   client tra `errors.<code>` qua `translateAppError`. Bốn mã đều **đã có** trong
 *   `server/_core/appErrorCodes.ts` **và** trong cả ba locale — lượt này **không** đẻ khoá mới,
 *   và **không** sinh một câu tiếng Anh cứng nào ở tầng máy chủ.
 */
import type { Request } from "express";
import type { User } from "../../drizzle/schema";
import { HttpError } from "@shared/_core/errors";
import type { AppErrorCode } from "../_core/appErrorCodes";
import { sdk } from "../_core/sdk";

/** Lý do một lượt xác thực REST bị từ chối — **mã máy-đọc-được**, khoá i18n là `errors.<mã>`. */
export type LyDoTuChoiRest = Extract<
  AppErrorCode,
  "AUTH_REQUIRED" | "MUST_CHANGE_PASSWORD" | "ACCOUNT_DISABLED" | "DB_UNAVAILABLE"
>;

/** Mã trạng thái HTTP của mỗi lý do. ⚠ `Map`, KHÔNG object literal — xem GOTCHA ở `quetDiemXacThuc`. */
const MA_CUA_LY_DO: ReadonlyMap<LyDoTuChoiRest, 401 | 403 | 500> = new Map([
  ["AUTH_REQUIRED", 401],
  ["MUST_CHANGE_PASSWORD", 403],
  ["ACCOUNT_DISABLED", 403],
  ["DB_UNAVAILABLE", 500],
] as const);

export type KetQuaXacThucRest =
  | { readonly ok: true; readonly user: User }
  | { readonly ok: false; readonly ma: 401 | 403 | 500; readonly lyDo: LyDoTuChoiRest };

/**
 * Phân loại một lượt ném của `sdk.authenticateRequest`.
 *
 * ⚠⚠ Nhận diện bằng **CHUỖI DẤU trong thông điệp**, và đó là một lựa chọn đã cân nhắc: cả năm phán
 *    quyết đều là `ForbiddenError` (⇒ `statusCode === 403` cho **tất cả**), nên `statusCode`
 *    **không** phân biệt được chúng. `sdk.ts` cố ý nhét `MUST_CHANGE_PASSWORD:` / `ACCOUNT_DISABLED:`
 *    vào đầu thông điệp *"để lượt gỡ lỗi phân biệt được"* — lượt này biến chú thích ấy thành một
 *    **hợp đồng được canh**: `xacThucBeMatRest.test.ts` §8 gọi **chính hai phép chặn thật** và đọc
 *    lại phân loại, nên đổi chuỗi ở `sdk.ts` mà quên chỗ này ⇒ **ĐỎ**.
 * ⚠ **Mặc định là 401**, không phải 500: một `HttpError` là một phán quyết CÓ CHỦ Ý của tầng xác
 *   thực; chỉ thứ **không phải** `HttpError` mới là *"máy chủ hỏng"*.
 */
function phanLoai(err: unknown): LyDoTuChoiRest {
  if (!(err instanceof HttpError)) return "DB_UNAVAILABLE";
  const msg = String(err.message ?? "");
  if (msg.includes("MUST_CHANGE_PASSWORD")) return "MUST_CHANGE_PASSWORD";
  if (msg.includes("ACCOUNT_DISABLED")) return "ACCOUNT_DISABLED";
  return "AUTH_REQUIRED";
}

/**
 * Phân giải *"yêu cầu này là ai"* cho một tuyến REST.
 *
 * @returns `{ok:true,user}` khi xác thực được; `{ok:false, ma, lyDo}` khi KHÔNG. Người gọi
 *   **phải** `res.status(ma)` rồi dừng — nhánh ấy là mã SỐNG.
 */
export async function thuXacThucRest(req: Request | unknown): Promise<KetQuaXacThucRest> {
  try {
    return { ok: true, user: await sdk.authenticateRequest(req as Request) };
  } catch (err) {
    const lyDo = phanLoai(err);
    return { ok: false, ma: MA_CUA_LY_DO.get(lyDo) ?? 401, lyDo };
  }
}

/**
 * Thân JSON của một lượt từ chối — **chỉ hai ô**, và người gọi tự bọc theo hợp đồng của mình
 * (`{error}` vs `{success:false,error}` — xem khối *"vì sao hàm này không tự gửi thân"* ở trên).
 *
 * ⚠ `error` **giữ nguyên `"Unauthorized"`** cho lớp 401 — lớp phổ biến nhất, và mọi client cũ đang
 *   hiển thị đúng chuỗi ấy. Ô **`code`** là thứ MỚI, và là thứ client bản địa hoá.
 */
export function thanTuChoiRest(kq: Extract<KetQuaXacThucRest, { ok: false }>): {
  error: string;
  code: LyDoTuChoiRest;
} {
  const ANH = new Map<LyDoTuChoiRest, string>([
    ["AUTH_REQUIRED", "Unauthorized"],
    ["MUST_CHANGE_PASSWORD", "Password change required"],
    ["ACCOUNT_DISABLED", "Account disabled"],
    ["DB_UNAVAILABLE", "Authentication backend unavailable"],
  ]);
  return { error: ANH.get(kq.lyDo) ?? "Unauthorized", code: kq.lyDo };
}
