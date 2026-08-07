/**
 * ★★★ Pha 6 Task 6 — **SỔ MÃ OTP ĐÃ TIÊU: CHỦ DUY NHẤT CỦA PHÉP XÁC MINH TOTP.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ VÌ SAO FILE NÀY TỒN TẠI
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Task 1/1b siết cửa sổ step-up **10 phút → ~90 s** (6,7×) bằng `requirePerCallFreshTotp`. Nhưng
 * `speakeasy.totp.verify` chạy `window: 1` (nhận cả nhịp trước, bù lệch đồng hồ) ⇒ **CÙNG một mã**
 * verify được trong ~90 s. Cửa sổ hẹp hơn **KHÔNG PHẢI** chống phát lại — nó cần một cơ chế KHÁC.
 *
 *   ***∀ lượt xác minh TOTP: một mã tiêu được ĐÚNG MỘT LẦN. Lượt thứ hai với CÙNG mã ⇒ TỪ CHỐI,
 *   kể cả khi mã ấy vẫn còn trong cửa sổ hợp lệ của `speakeasy`.***
 *
 * (Đây chính là RFC 6238 §5.2: *"the verifier MUST NOT accept the second attempt of the OTP after
 * the successful validation has been issued for the first OTP"*.)
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ MỘT CHỦ, KHÔNG HAI — VÀ ĐÓ LÀ LÝ DO FILE NÀY GIỮ LUÔN LƯỢT `speakeasy.totp.verify`
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Phép đếm Bước 2 tìm được **8 điểm xác minh TOTP** ở **4 file** — `_core/trpc.ts` (step-up cho cả
 * 7 `deployProcedure`), `_core/oauth.ts` (2FA lúc **đăng nhập**), `routers/twoFactorRouter.ts`
 * (`enable` · `disable` · `verify` · `regenerateBackupCodes`), `routers/userRouters.ts`
 * (`verify2FA` · `disable2FA`) — trong đó **hai cặp tuyến SONG SONG** làm cùng một việc
 * (`twoFactor.enable` ≡ `user.verify2FA`, `twoFactor.disable` ≡ `user.disable2FA`).
 * ⇒ Vá riêng đường step-up thì mã trộm bị chặn ở `vram.preempt` **nhưng vẫn tiêu được** ở
 * `twoFactor.disable` (**tắt luôn 2FA**) và `regenerateBackupCodes` (**đẻ 10 mã dự phòng**) — hai
 * đường **nguy hơn** cái vừa vá. Đúng lớp *"cái gì LIỆT KÊ thì luôn có phần tử thứ N+1"*.
 * ⇒ Nên bất biến **không liệt kê điểm gọi**. Nó nói: ***`speakeasy.totp.verify` chỉ được gọi ở
 * ĐÚNG file này***, và lưới `server/routers/totpReplayScan.test.ts` cưỡng chế câu ấy trên **toàn
 * `server/**`** bằng AST. Một điểm xác minh thứ chín sinh ra ở bất kỳ đâu ⇒ **ĐỎ**, không im lặng
 * đứng ngoài sổ.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ RÀNG BUỘC ĐÃ LẬT HÌNH DẠNG: MỘT LƯỢT GỌI XÁC MINH **CÙNG MỘT MÃ 2–3 LẦN**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Khối I-4 ở `_core/trpc.ts` đã đo: chuỗi thật của `vram.preempt` là
 * `requireFreshTotp` → `requirePerCallFreshTotp` (GỐC) → `requirePermission` →
 * `requirePerCallFreshTotp` (lần hai, `vramRouter.ts`) ⇒ **cache-miss = 3 lượt verify, cache-hit =
 * 2**, cho **MỘT** lượt bấm nút. Một cuốn sổ *"tiêu mã khi verify thành công"* viết ngây thơ sẽ
 * **TỰ CHẶN MÌNH** ở lượt verify thứ hai và giết **100 %** lệnh VRAM/deploy.
 * ⇒ Sổ nhận thêm tham số `luot` — **dấu của LƯỢT GỌI**, do middleware đầu tiên đúc ra và truyền
 * xuống bằng `next({ ctx })` (ngữ cảnh tRPC chỉ chảy **xuôi trong CHÍNH lượt gọi ấy**, không bao
 * giờ sang lượt khác, kể cả khi hai lượt đi chung một request HTTP gộp lô). Cùng `luot` ⇒ đây là
 * lượt verify thứ N của **cùng** một lượt gọi ⇒ cho qua. Khác `luot` ⇒ **PHÁT LẠI**.
 * ⚠ Đây **không** phải một cửa nới: `luot` không tới từ người gọi, không đọc được, không đoán
 * được; nó chỉ tồn tại trong bộ nhớ của một lượt gọi đang chạy.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ SỔ NẰM TRONG BỘ NHỚ — NÓ ĐỨNG TRÊN MỘT ĐIỀU KIỆN, VÀ ĐIỀU KIỆN ẤY ĐƯỢC CANH
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Brief cảnh báo topo `api`+`worker` (Pha 3 dựng sổ chung `vram_leases` **chính vì thế**) ⇒ sổ
 * trong bộ nhớ không chặn được lượt phát lại đi vào **tiến trình khác**. **Đã đo, không giả định:**
 *   • `.env` của hệ đang chạy **KHÔNG đặt `ROLE`** ⇒ all-in-one; đếm được **MỘT** tiến trình ứng
 *     dụng (`node dist/index.js`, PID 35216).
 *   • `ROLE=worker` **không bind HTTP** (`server/_core/index.ts:118-123` `return` **trước** mọi
 *     thiết lập express/socket/MQTT; `server/worker.ts` không dựng express) ⇒ tiến trình worker
 *     **không mount tRPC, không mount `/api/auth/verify-2fa`** ⇒ **không bao giờ** xác minh TOTP.
 *   • Bầu chủ nhiều bản sao (`WORKER_LEADER_ELECTION_ENABLED`, `.env.example:123-133`) chỉ dành
 *     cho vai trò **worker**; vai trò `api` không có khái niệm nhiều bản sao trong tài liệu.
 * ⇒ Trong **mọi** topo hệ hỗ trợ hôm nay có **ĐÚNG MỘT** tiến trình xác minh TOTP, nên sổ trong bộ
 * nhớ **đủ** đóng cổng ra.
 *
 * ⚠⚠ Nhưng *"an toàn là HỆ QUẢ của một thứ khác"* là đúng lăng kính đã năm lần bắt được lỗi ở
 * chuỗi pha này: ở đây an toàn của sổ là **hệ quả của topo triển khai**, không phải của cơ chế.
 * Nên điều kiện ấy **KHÔNG được để ngầm** — nó được canh ở **hai** tầng:
 *   • **lúc chạy** — `laTienTrinhPhucVuHttp()` dưới đây: `ROLE=worker` gọi tới hàm này là một lỗi
 *     lập trình, và nó **fail-closed + KÊU TO** thay vì âm thầm mở một cuốn sổ thứ hai;
 *   • **theo cấu trúc** — `server/routers/totpReplayScan.test.ts`:
 *     ***∀ file sản xuất gọi `verifyTotpOnce`: nó phải là một BỀ MẶT REQUEST*** (module tRPC, hoặc
 *     một file đăng ký route express). Một lượt gọi bò vào một dịch vụ nền/cron ⇒ **ĐỎ**.
 *
 * ⚠⚠⚠ **ĐO ĐƯỢC, VÀ NÓ BÁC BỎ MỘT PHÉP CANH TRỰC GIÁC:** bao đóng nhập (đệ quy, tĩnh + động) từ
 * `server/worker.ts` gồm **520 file** và **CÓ** `server/_core/trpc.ts` (⇒ có luôn file này). Tức
 * *"module không với tới được từ worker"* là một luật **SAI SỰ THẬT** nếu đem ra canh: worker
 * **nạp** `trpc.ts`, nó chỉ không bao giờ **chạy** một middleware nào vì không có request nào tới.
 * Phân biệt **NẠP** với **KÍCH HOẠT** chính là chỗ luật phải đứng — nên luật được viết trên *"ai
 * gọi"*, không trên *"ai nạp"*.
 *
 * ⇒ Ngày nào một đường xác minh TOTP thật sự chạy được ở tiến trình worker — hoặc ai đó chạy hai
 * bản sao `ROLE=api` — thì **lời giải đúng là chuyển sổ xuống DB (cần DDL ⇒ phải hỏi chủ dự án)**,
 * và hai phép canh trên là thứ nói ra điều đó thay vì để nó im lặng.
 *
 * ⚠ Đường **KHÔNG chọn** (và vì sao) — xem `.superpowers/sdd/2026-08-06-vram-pha6-backlog/
 * task-6-report.md` §"Hình dạng đã chọn".
 */
import speakeasy from "speakeasy";
import { randomUUID } from "node:crypto";

/**
 * Cửa sổ `speakeasy` — **1 nhịp trước/sau** để bù lệch đồng hồ. Giữ **nguyên** giá trị cũ của cả 8
 * điểm gọi: Task 6 **chỉ THU HẸP**, nó không đụng vào phép dung sai đồng hồ.
 */
export const TOTP_CUA_SO = 1;

/** Độ dài một nhịp TOTP (giây) — mặc định của `speakeasy`, viết ra để tính hạn sổ được kiểm chứng. */
const NHIP_GIAY = 30;

/**
 * Hạn của một mục trong sổ. Một mã của nhịp `T` còn verify được khi nhịp hiện tại ∈ {T−1, T, T+1}
 * ⇒ quãng sống tối đa kể từ lúc nó **có thể** được tiêu sớm nhất là `3 × 30 s = 90 s`. Cộng một
 * nhịp trượt ⇒ **120 s**. Giữ mục lâu hơn quãng ấy là thừa (mã đã tự hết hiệu lực); ngắn hơn là
 * **mở lại cửa phát lại**, nên con số này là một **cận dưới**, không phải một lựa chọn thẩm mỹ.
 */
export const TOTP_HAN_SO_MS = (2 * TOTP_CUA_SO + 1 + 1) * NHIP_GIAY * 1000;

export interface KetQuaTotp {
  /** Mã hợp lệ **VÀ** chưa bị tiêu bởi một lượt gọi khác ⇒ được đi tiếp. */
  readonly hopLe: boolean;
  /**
   * Mã **verify được** nhưng đã bị một lượt gọi KHÁC tiêu ⇒ đây là một lượt **PHÁT LẠI**.
   * Tách khỏi `hopLe === false` thuần tuý (mã sai/hết hạn) để người gọi nói đúng chuyện đã xảy ra
   * và để lưới phân biệt được *"chặn vì sổ"* với *"chặn vì mã hỏng"* — hai lý do, hai ca.
   */
  readonly phatLai: boolean;
}

interface MucSo {
  /** Thời điểm mục này hết ý nghĩa (epoch ms). */
  readonly hetHan: number;
  /** Dấu của LƯỢT GỌI đã tiêu mã. Cùng dấu ⇒ vẫn là lượt gọi ấy. */
  readonly luot: string;
}

/** `${userId}:${token}` → mục sổ. **Khoá có `userId`**: hai người dùng khác secret có thể tình cờ
 *  sinh cùng 6 số, và chặn nhầm người thứ hai là một lỗi có thật, không phải giả thuyết. */
const so = new Map<string, MucSo>();

/**
 * ⚠⚠ **SỔ TỰ DỌN — VÀ NÓ KHÔNG PHỤ THUỘC MỘT NHỊP HẸN GIỜ NÀO.**
 * Mỗi lượt ghi quét sạch mục quá hạn ⇒ **sổ không thể lớn lên nếu không có lượt ghi**, và mỗi lượt
 * ghi trả nó về đúng tập mục còn sống. Cận trên tự nhiên: một người dùng chỉ có **3** mã verify
 * được tại một thời điểm (`window: 1`), nên `|so| ≤ 3 × số người xác minh trong 120 s`.
 * ⚠ Quét theo `O(|so|)` mỗi lượt ghi là **cố ý**: `|so|` nhỏ theo cấu tạo, còn một ngưỡng
 * *"chỉ quét khi lớn hơn N"* sẽ để lại tới N mục chết nằm lì sau khi lưu lượng dừng — bị chặn thì
 * có bị chặn, nhưng nó biến một tính chất **chứng minh được** thành một hằng số phải tin.
 */
function donSo(nowMs: number): void {
  for (const [k, v] of so) if (v.hetHan <= nowMs) so.delete(k);
}

/**
 * Tiến trình này có phục vụ HTTP không? `ROLE=worker` ⇒ **KHÔNG** (`server/_core/index.ts` `return`
 * trước mọi thiết lập express; `server/worker.ts` không dựng express) ⇒ nó **không thể** nhận một
 * lượt xác minh TOTP nào. Mọi giá trị khác (`api`, rỗng/all-in-one, hoặc một chuỗi lạ mà
 * `index.ts` xử lý như all-in-one) ⇒ CÓ.
 */
function laTienTrinhPhucVuHttp(): boolean {
  return (process.env.ROLE ?? "").trim().toLowerCase() !== "worker";
}

/** Đã kêu chưa — kêu **một lần** cho mỗi tiến trình là đủ để điều tra, không làm ngập log. */
let daKeuSaiTienTrinh = false;

/**
 * Xác minh một mã TOTP **và tiêu nó**. Đây là **đường DUY NHẤT** được phép chạy
 * `speakeasy.totp.verify` trong `server/**` (cưỡng chế bằng `totpReplayScan.test.ts`).
 *
 * @param userId  chủ của mã — thành phần **bắt buộc** của khoá sổ.
 * @param secret  secret 2FA (base32) đã đọc từ `users.two_factor_secret`.
 * @param token   mã 6 số người gọi gửi lên.
 * @param luot    dấu của LƯỢT GỌI. Cùng `luot` ⇒ lượt verify thứ N của **cùng** một lượt gọi ⇒
 *                cho qua. Bỏ trống ⇒ mỗi lượt gọi là một lượt riêng (đúng cho mọi điểm gọi chỉ
 *                verify **một** lần / request).
 * @param nowMs   **chỉ dùng trong lưới** — điều khiển cả đồng hồ của `speakeasy` lẫn hạn của sổ,
 *                để các ca về hạn không phải `sleep` 120 giây thật.
 */
export function verifyTotpOnce(args: {
  userId: number;
  secret: string;
  token: string;
  luot?: string;
  nowMs?: number;
}): KetQuaTotp {
  const { userId, secret, token, luot } = args;
  const nowMs = args.nowMs ?? Date.now();

  /**
   * ⚠⚠ **ĐIỀU KIỆN MÀ SỔ TRONG BỘ NHỚ ĐỨNG TRÊN, VIẾT THÀNH MÃ CHẠY ĐƯỢC.** Sổ này chỉ đóng được
   * cổng ra khi **đúng MỘT** tiến trình xác minh TOTP. Hôm nay đúng vậy vì chỉ tiến trình phục vụ
   * HTTP mới nhận được một lượt xác minh. Nếu một ngày một đường xác minh chạy được ở tiến trình
   * worker thì **sẽ có hai cuốn sổ**, và phát lại mở lại — âm thầm. ⇒ fail-closed + KÊU TO, để
   * lượt hỏng ấy là một sự cố **nhìn thấy được**, không phải một lỗ hổng vô hình.
   */
  if (!laTienTrinhPhucVuHttp()) {
    if (!daKeuSaiTienTrinh) {
      daKeuSaiTienTrinh = true;
      console.error(
        "[TotpOnce] Một lượt xác minh TOTP chạy ở tiến trình KHÔNG phục vụ HTTP (ROLE=worker). " +
          "Sổ mã đã tiêu nằm trong bộ nhớ MỖI tiến trình ⇒ topo này làm mất phép chống phát lại. " +
          "Từ chối (fail-closed). Lời giải đúng: chuyển sổ xuống DB (cần DDL — hỏi chủ dự án).",
      );
    }
    return { hopLe: false, phatLai: false };
  }

  const hopLeTheoMa = speakeasy.totp.verify({
    secret,
    encoding: "base32",
    token,
    window: TOTP_CUA_SO,
    ...(args.nowMs === undefined ? {} : { time: Math.floor(nowMs / 1000) }),
  });
  // ⚠ Mã KHÔNG verify được thì **không ghi sổ**: nếu ghi, ai cũng bơm được số rác vào sổ mà không
  //   cần biết secret ⇒ sổ tự biến thành một bề mặt DoS.
  if (!hopLeTheoMa) return { hopLe: false, phatLai: false };

  const khoa = `${userId}:${token}`;
  const cu = so.get(khoa);
  if (cu !== undefined && cu.hetHan > nowMs) {
    if (luot !== undefined && cu.luot === luot) return { hopLe: true, phatLai: false };
    return { hopLe: false, phatLai: true };
  }

  so.set(khoa, { hetHan: nowMs + TOTP_HAN_SO_MS, luot: luot ?? randomUUID() });
  donSo(nowMs);
  return { hopLe: true, phatLai: false };
}

/** Đúc dấu cho một LƯỢT GỌI mới. Tách ra để người gọi không tự bịa một chuỗi đoán được. */
export function dauLuotGoiMoi(): string {
  return randomUUID();
}

/** Chỉ dùng trong lưới — số mục đang nằm trong sổ (bằng chứng của phép tự dọn). */
export function __soTotpSize(): number {
  return so.size;
}

/** Chỉ dùng trong lưới — trả sổ về rỗng để mỗi ca độc lập. */
export function __resetSoTotpChoTest(): void {
  so.clear();
}
