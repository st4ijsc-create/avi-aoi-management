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
import { randomUUID, createHash } from "node:crypto";
import { sql } from "drizzle-orm";

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

/**
 * ★★★ Pha 7 Task 5 — **KHOÁ CỦA MỘT MỤC SỔ.** `sha256(\`${userId}:${token}\`)`.
 *
 * ⚠⚠ VÌ SAO BĂM chứ không lưu mã 6 số: lý do thứ nhất là một **tính chất CẤU TRÚC** — bề rộng của
 * một digest là **32 byte cố định theo cấu tạo**, nên `22001` ("value too long") là điều **KHÔNG
 * THỂ**, khác hẳn một `varchar(N)` mà ta phải *"chọn đủ rộng"* rồi một ngày phát hiện chưa đủ (đúng
 * bài học migration 0311 và `vram_leases.owner`). Lý do thứ hai: không đưa một mã OTP **còn hiệu
 * lực** vào bảng và vào log truy vấn.
 * ⚠ `userId` nằm **TRONG** chuỗi được băm, nên hai người dùng tình cờ sinh cùng 6 số cho **hai**
 * digest khác nhau — và nó **cũng** là một cột của khoá chính. Hai lớp, cùng một lý do.
 */
function bam(userId: number, token: string): Buffer {
  return createHash("sha256").update(`${userId}:${token}`).digest();
}

/**
 * ★★★ **CỬA DUY NHẤT XUỐNG SỔ.** Trả `null` ⇔ **không hỏi được DB** — người gọi phải đọc là
 * *"KHÔNG BIẾT"*, tuyệt đối không phải *"mã này chưa ai tiêu"*.
 *
 * ⚠⚠⚠ **MỘT CÂU, KHÔNG PHẢI HAI.** Một cặp `SELECT` rồi `INSERT` là một **TOCTOU** — đúng cái cửa
 * mà hai tiến trình `ROLE=api` đi lọt, tức đúng lỗ **A3** mà cả lượt này sinh ra để đóng.
 * `ON CONFLICT DO UPDATE` **khoá hàng**, nên hai lượt đồng thời **xếp hàng** và kẻ thua đọc được
 * `luot` của kẻ thắng.
 *
 * Phán quyết là **một phép so duy nhất**, và nó khớp một-một với bản trong bộ nhớ trước đây:
 *   • trả về **= `luot` của ta** ⇒ ta vừa **chèn mới**, hoặc vừa **thu lại** một mục **quá hạn**,
 *     hoặc đây là **lượt verify thứ N của CÙNG lượt gọi** ⇒ cho qua;
 *   • trả về **≠ `luot` của ta** ⇒ một **lượt gọi KHÁC** đang giữ mã và mục **còn sống** ⇒ PHÁT LẠI.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ★★★★ Pha 9 · **NỬA CÒN LẠI CỦA I-3 — ĐỒNG HỒ CỦA SỔ LÀ ĐỒNG HỒ CỦA **DB**, KHÔNG PHẢI CỦA
 * NGƯỜI GỌI.**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Nợ khai ở Pha 7 (docstring `donSo`) nói đúng lời giải: *"đưa đồng hồ của sổ xuống DB — `expiresAt`
 * **ghi** bằng `now()` của Postgres và cả hai phép so (`tieuMaTrongSo` **và** `donSo`) đọc cùng đồng
 * hồ ấy"*. Lượt này trả **trọn** món nợ ấy, cho **cả hai** hàm cùng lúc.
 *
 * ⚠⚠⚠ **VÌ SAO PHẢI ĐI CÙNG NHAU, KHÔNG VÁ MỘT NỬA** — đo được khi thử vá riêng `tieuMaTrongSo`:
 *    ghi `expiresAt` bằng đồng hồ DB trong khi `donSo` vẫn so bằng đồng hồ NGƯỜI GỌI ⇒ một lưới
 *    lái đồng hồ +1h **xoá ngay** mục vừa ghi của chính nó (`real+120s <= real+3600s`), và ca
 *    *"đỉnh nhiều mục"* thấy đỉnh = **1**. Hai đồng hồ dưới một bất biến là **đúng lớp lỗi** mà cả
 *    chuỗi pha này đang trả nợ — nên `nowMs` bị **gỡ khỏi CHỮ KÝ** của cả hai hàm, không phải
 *    "được khuyên là đừng dùng".
 *
 * **BẤT BIẾN NAY NEO ĐƯỢC** (`totpLedgerDurable.test.ts` §I-3b):
 *   ***Một lượt gọi với đồng hồ lệch KHÔNG đổi được kết quả của người khác, và KHÔNG kéo dài/rút
 *   ngắn hiệu lực của chính mã mình.***
 *   · vế *"người khác"*: khoá sổ là `(userId, tokenHash)` và `donSo` giới hạn theo `userId` (I-3);
 *   · vế *"chính mình"*: `expiresAt` **và** cả hai phép so nay đọc `now()` của Postgres ⇒ `nowMs`
 *     **không có đường nào** chạm tới sổ. Nó chỉ còn lái đồng hồ của `speakeasy`.
 *
 * ⚠ `excluded."expiresAt"` giữ nguyên ở nhánh thu-lại: giá trị ấy nay **cũng** do DB tính (xem
 *   `hanMoi()`), nên hai vế của `CASE` đọc **cùng một** đồng hồ.
 */
async function tieuMaTrongSo(
  userId: number,
  tokenHash: Buffer,
  luot: string,
): Promise<string | null> {
  const db = await layDb();
  if (db === null) return null;
  const { totpConsumed } = await import("../../drizzle/schema/auth");
  const rows = await db
    .insert(totpConsumed)
    .values({ userId, tokenHash, luot, expiresAt: hanMoi() })
    .onConflictDoUpdate({
      target: [totpConsumed.userId, totpConsumed.tokenHash],
      set: {
        // ⚠ `totpConsumed.<cot>` trong nhánh `DO UPDATE` render thành `"totp_consumed"."<cot>"` —
        //   tức **hàng ĐANG CÓ**; `excluded."<cot>"` là hàng ta vừa định chèn. Đúng hai vế cần.
        luot: sql`CASE WHEN ${totpConsumed.expiresAt} <= ${dongHoSo()} THEN excluded."luot" ELSE ${totpConsumed.luot} END`,
        expiresAt: sql`CASE WHEN ${totpConsumed.expiresAt} <= ${dongHoSo()} THEN excluded."expiresAt" ELSE ${totpConsumed.expiresAt} END`,
      },
    })
    .returning({ luot: totpConsumed.luot });
  return rows[0]?.luot ?? null;
}

/**
 * **ĐỒNG HỒ DUY NHẤT CỦA SỔ** — `now()` của Postgres, quy về UTC.
 *
 * ⚠ `AT TIME ZONE 'UTC'` là **bắt buộc**: `now()` trả `timestamptz`, còn cột là `timestamp`
 *   **không** múi giờ (drizzle ghi `Date` bằng UTC). Thiếu nó, phép so lệch đúng bằng offset của
 *   máy chủ — một lỗi **im lặng** chỉ hiện ra ngoài UTC.
 *   ✅ Đo được ở lượt này: `SHOW TimeZone` = `Etc/UTC` trên cả hai DB, nên hôm nay offset là 0 —
 *   nhưng đó là một **cấu hình**, không phải một bất biến, nên phép quy đổi **ở lại**.
 * ⚠ **KHÔNG truyền một `Date` vào `sql\`…\``** (bài học Bước 5): tham số của một mảnh `sql` thô đi
 *   **thẳng** xuống gói `postgres` (v3) và ném `ERR_INVALID_ARG_TYPE: … Received an instance of
 *   Date`. Nay không còn tham số thời gian nào để truyền — đó chính là điểm của lượt vá.
 */
function dongHoSo() {
  return sql`(now() AT TIME ZONE 'UTC')`;
}

/** Hạn của một mục MỚI, tính **trong DB**: `now() + TOTP_HAN_SO_MS`. */
function hanMoi() {
  return sql`(${dongHoSo()} + make_interval(secs => ${TOTP_HAN_SO_MS / 1000}))`;
}

/**
 * ⚠⚠ **SỔ TỰ DỌN — VÀ NÓ VẪN KHÔNG PHỤ THUỘC MỘT NHỊP HẸN GIỜ NÀO.**
 *
 * Đây là **bản dịch một-một** của `donSo()` cũ (bản trong bộ nhớ quét `Map` sau mỗi `so.set()`).
 * Tính chất được giữ **nguyên vẹn và vẫn chứng minh được**: ***bảng không thể lớn lên nếu không có
 * một lượt ghi, và mỗi lượt ghi trả nó về đúng tập mục còn sống.*** Cận trên vẫn là
 * `3 × (số người xác minh trong 120 s)` vì một người chỉ có 3 mã verify được cùng lúc (`window: 1`).
 *
 * ⚠ **AI CHẠY: chính lượt xác minh.** BAO LÂU MỘT LẦN: **mỗi lượt được CHẤP NHẬN** — tức đúng lúc
 *   bảng **có thể to thêm**. Lượt bị chặn (phát lại) **không** dọn: nó không thêm hàng nào.
 * ⚠⚠ **KHÔNG CRON, và đây là một quyết định có lý do đo được:** một cron sống ở `ROLE=worker`. Đặt
 *   phép dọn ở đó là làm **sức khoẻ của sổ** thành **hệ quả của một tiến trình KHÁC còn sống** —
 *   đúng lăng kính *"an toàn là HỆ QUẢ của một thứ khác đang hỏng"*, thứ đã bắt được lỗi **sáu**
 *   lần trong chuỗi pha này. Cộng: worker **không phục vụ HTTP** nên nó không bao giờ biết sổ đang
 *   bận hay rảnh.
 * ⚠ **KHÔNG ngưỡng "chỉ dọn khi > N"**: nó để lại tới N mục chết nằm lì sau khi lưu lượng dừng, và
 *   biến một tính chất **chứng minh được** thành một hằng số phải tin.
 * ⚠ Lượt dọn hỏng **KHÔNG** làm hỏng lượt xác minh: mã đã được phán quyết xong trước đó. Nuốt lỗi
 *   ở đây là đúng — nhưng **kêu**, để một sổ đang phình không im lặng.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ Pha 7 / review TOÀN NHÁNH **I-3** — **DỌN RÁC THÔI CHẠM HÀNG CỦA NGƯỜI KHÁC.**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Bản trước chạy `DELETE FROM totp_consumed WHERE expiresAt <= <nowMs>` — **KHÔNG giới hạn theo
 * `userId`**, với `nowMs` do **người gọi** cấp. Đo được (probe, DB test thật):
 *
 *     [PROBE] A tiêu mã: hopLe=true · sổ của A = 1
 *     [PROBE] B verify ở +1h : sổ của A = 0        ← 0 nghĩa là bị XOÁ
 *     [PROBE] A PHÁT LẠI mã đã tiêu: hopLe=true phatLai=false
 *
 * ⇒ **Một lượt xác minh của người dùng B với đồng hồ đi trước xoá sạch mục của người dùng A, và
 *   ngay sau đó A phát lại được CHÍNH mã đã tiêu.** Đây đúng lỗ **A2/A3** mà bảng `totp_consumed`
 *   (mig 0313) được sinh ra để đóng — một **lỗi SẢN PHẨM**, không chỉ một lỗi test.
 * Hệ quả thứ hai, đo được ở cổng: vitest chạy các file test **SONG SONG** và `totpLedgerDurable`
 * lái đồng hồ `NOW = Date.now() + 1h`, nên mỗi lượt verify của nó **quét sạch** sổ của mọi file
 * khác ⇒ §Cổng kiểm chung **đỏ KHÔNG TẤT ĐỊNH** (ba lượt chạy, ba tập ca đỏ khác nhau).
 *
 * ⚠ Pha 7 đã đóng đúng nửa này cho `__soTotpSize`/`__resetSoTotpChoTest` (xem docstring của chúng)
 *   và **bỏ quên `donSo`** — cái DUY NHẤT chạy trên **đường sản phẩm**.
 *
 * ✅ **NỢ ẤY ĐÃ TRẢ (Pha 9, chủ dự án duyệt).** Câu cũ ở đây là: *"lượt dọn vẫn lái bằng `nowMs` của
 *    người gọi … lời giải trọn vẹn là đưa đồng hồ của sổ xuống DB … `tieuMaTrongSo` cũng lái bằng
 *    `nowMs` ở nhánh thu-lại — cùng một nợ, cùng một lời giải"*. Lượt này làm đúng thế, cho **cả
 *    hai** hàm cùng lúc: `nowMs` bị **gỡ khỏi chữ ký** của cả `tieuMaTrongSo` lẫn hàm này, và mọi
 *    phép so đọc `dongHoSo()` = `now()` của Postgres.
 *    ⚠ Vá một nửa là **tệ hơn không vá**: đo được khi thử — ghi `expiresAt` bằng đồng hồ DB mà vẫn
 *      so bằng đồng hồ người gọi ⇒ một lưới lái đồng hồ +1h **xoá ngay** mục vừa ghi của chính nó.
 *    ⚠ `nowMs` **vẫn còn** ở `verifyTotpOnce` — nhưng nay nó chỉ lái đồng hồ của `speakeasy`, và
 *      `totpLedgerDurable.test.ts` §I-3b ghim rằng nó **không** với tới sổ được nữa (AST + hành vi).
 */
async function donSo(userId: number): Promise<void> {
  try {
    const db = await layDb();
    if (db === null) return;
    const { totpConsumed } = await import("../../drizzle/schema/auth");
    /**
     * ⚠⚠⚠ **MỘT MẢNH `sql` THÔ, KHÔNG `and()`/`eq()` — VÀ ĐÂY LÀ MỘT BÀI HỌC ĐÃ TRẢ GIÁ.**
     * Bản đầu của bản vá I-3 viết `and(eq(totpConsumed.userId, userId), lte(…))`. Đo được:
     * `server/routers/totpReplay.test.ts:65-68` chạy `vi.mock("drizzle-orm", …)` **thay `eq`/`and`**
     * bằng bộ dựng vị từ của `FakeDb`. Lượt `await import("drizzle-orm")` **trong hàm này** nhận
     * bản ĐÃ MOCK ⇒ mệnh đề `WHERE` thành một đối tượng lạ, `DELETE` **khớp 0 hàng** — **KHÔNG ném,
     * KHÔNG kêu**. Ca *"sổ phải tự dọn: còn ĐÚNG 1 mục"* đỏ với `expected 6 to be 1`, và nếu ai đó
     * đọc vội thì đây trông y hệt một lỗi của phép dọn.
     * ⇒ Lớp *"an toàn là HỆ QUẢ của một thứ khác"*: tính đúng của câu này từng phụ thuộc vào việc
     *   **file test nào tình cờ KHÔNG mock symbol nào**. Một mảnh `sql` thô không có phụ thuộc ấy.
     * ⚠ `sql` và `lte` hiện **không** bị mock ở file kia (`{ ...actual, eq, and, desc }`) — nhưng
     *   đó lại đúng là loại điều kiện ngầm vừa nói, nên ta không dựa vào nó nữa.
     */
    await db
      .delete(totpConsumed)
      .where(
        sql`${totpConsumed.userId} = ${userId} AND ${totpConsumed.expiresAt} <= ${dongHoSo()}`,
      );
  } catch (e) {
    console.warn(
      `[TotpOnce] Lượt TỰ DỌN sổ mã đã tiêu HỎNG (${(e as Error)?.message ?? String(e)}). ` +
        `Phép xác minh KHÔNG bị ảnh hưởng, nhưng bảng \`totp_consumed\` sẽ phình nếu chuyện này lặp lại.`,
    );
  }
}

/** Kết nối DB, hoặc `null` nếu chưa có. ⚠ **KHÔNG nhớ `null`**: DB có thể lên sau. */
async function layDb() {
  const { getDb } = await import("../db/connection");
  return await getDb();
}

/**
 * Tiến trình này có phục vụ HTTP không? `ROLE=worker` ⇒ **KHÔNG** (`server/_core/index.ts` `return`
 * trước mọi thiết lập express; `server/worker.ts` không dựng express) ⇒ nó **không thể** nhận một
 * lượt xác minh TOTP nào. Mọi giá trị khác (`api`, rỗng/all-in-one, hoặc một chuỗi lạ mà
 * `index.ts` xử lý như all-in-one) ⇒ CÓ.
 *
 * ⚠⚠⚠ **LÝ DO CỦA HÀNG RÀO NÀY ĐÃ ĐỔI Ở PHA 7 — ĐỌC KỸ, ĐỪNG XOÁ NHẦM.**
 * Trước Pha 7 nó đứng đây vì *"sổ nằm trong bộ nhớ MỖI tiến trình"* — một lý do mà lượt này **đã
 * làm cho SAI**: sổ nay ở DB, dùng chung, nên một lượt verify ở worker **cũng** an toàn về mặt
 * phát lại. Giữ một hàng rào với một lý do đã chết là đúng lớp *"hàng rào không ai canh"*, nên lý
 * do được **viết lại**, không phải giữ nguyên:
 *   ***Một lượt xác minh TOTP chạy ở tiến trình không phục vụ HTTP là một LỖI LẬP TRÌNH*** —
 *   worker không mount tRPC, không mount `/api/auth/verify-2fa`, nên **không request nào routing
 *   tới đó được**. Một lượt gọi tới đây nghĩa là ai đó vừa nối một đường xác minh vào một chỗ
 *   không có người dùng ở đầu kia (một cron, một dịch vụ nền) — và đó là chuyện phải **kêu to**,
 *   không phải chuyện âm thầm cho qua.
 * ⚠ Nó bổ sung cho `totpReplayScan.test.ts` (*"∀ file gọi `verifyTotpOnce` phải là một BỀ MẶT
 *   REQUEST"*) — một canh **lúc chạy**, một canh **theo cấu trúc**.
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
 * @param secret  secret 2FA (base32) đã đọc từ `user_secrets.twoFactorSecret` (Pha 7 Task 9 / 9c
 *                dời nó khỏi `users`; migration `0315` đã BỎ hẳn cột cũ ⇒ tên cũ nay là một
 *                lý do ĐÃ CHẾT — xem lăng kính ở `laTienTrinhPhucVuHttp()` dưới đây).
 * @param token   mã 6 số người gọi gửi lên.
 * @param luot    dấu của LƯỢT GỌI. Cùng `luot` ⇒ lượt verify thứ N của **cùng** một lượt gọi ⇒
 *                cho qua. Bỏ trống ⇒ mỗi lượt gọi là một lượt riêng (đúng cho mọi điểm gọi chỉ
 *                verify **một** lần / request).
 * @param nowMs   **chỉ dùng trong lưới**, và **CHỈ điều khiển đồng hồ của `speakeasy`** — để một ca
 *                đúc/kiểm mã ở một nhịp bất kỳ mà không phải chờ thật.
 *                ⚠⚠ Pha 9: nó **KHÔNG còn** chạm tới sổ. `expiresAt` và cả hai phép so hạn đọc
 *                `now()` của **Postgres** (xem `dongHoSo()`), nên một đồng hồ lệch không kéo dài
 *                hay rút ngắn được hiệu lực của bất kỳ mục nào — kể cả mục của chính người gọi.
 *                Muốn thử nghiệm một mục **đã quá hạn**, lưới phải **làm già hàng trong DB**
 *                (`UPDATE … SET "expiresAt" = now() - interval '…'`), không phải nói dối về giờ.
 */
export async function verifyTotpOnce(args: {
  userId: number;
  secret: string;
  token: string;
  luot?: string;
  nowMs?: number;
}): Promise<KetQuaTotp> {
  const { userId, secret, token, luot } = args;
  const nowMs = args.nowMs ?? Date.now();

  /** ⚠ Xem docstring `laTienTrinhPhucVuHttp()` — LÝ DO đã đổi ở Pha 7, hàng rào thì giữ. */
  if (!laTienTrinhPhucVuHttp()) {
    if (!daKeuSaiTienTrinh) {
      daKeuSaiTienTrinh = true;
      console.error(
        "[TotpOnce] Một lượt xác minh TOTP chạy ở tiến trình KHÔNG phục vụ HTTP (ROLE=worker). " +
          "Tiến trình này không mount tRPC và không mount `/api/auth/verify-2fa` ⇒ không request " +
          "nào routing tới đây được ⇒ đây là một LỖI LẬP TRÌNH (một cron/dịch vụ nền vừa được nối " +
          "vào một đường xác minh). Từ chối (fail-closed).",
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

  /**
   * ⚠ `luot ?? randomUUID()` — **đúc dấu TRƯỚC lượt ghi**, giữ nguyên ngữ nghĩa bản cũ: người gọi
   * không khai `luot` thì mỗi lượt gọi là một lượt riêng, nên lượt thứ hai với cùng mã là PHÁT LẠI.
   */
  const cuaTa = luot ?? randomUUID();

  let giuBoi: string | null;
  try {
    giuBoi = await tieuMaTrongSo(userId, bam(userId, token), cuaTa);
  } catch (e) {
    /**
     * ⚠⚠⚠ **FAIL-CLOSED, VÀ ĐÂY LÀ MỘT QUYẾT ĐỊNH CÓ CHỦ Ý — KHÔNG PHẢI MỘT `catch` CHO ĐỦ.**
     * Sổ không đọc được mà vẫn **cho qua** là **fail-open**: đúng lúc ta mất khả năng phát hiện
     * phát lại thì ta lại nới cửa. Cái giá phải trả và phải nói ra: một sự cố DB kéo theo **không
     * ai đăng nhập 2FA được và không lệnh deploy/VRAM nào chạy được**. Đó là đánh đổi ĐÚNG cho một
     * cơ chế chống phát lại, nhưng nó phải **kêu đúng tên**, không nấp sau một câu "mã không hợp lệ".
     */
    console.error(
      `[TotpOnce] SỔ MÃ ĐÃ TIÊU KHÔNG HỎI ĐƯỢC (${(e as Error)?.message ?? String(e)}). ` +
        `TỪ CHỐI mọi lượt xác minh TOTP (fail-closed) — vì cho qua lúc này là mở lại cửa PHÁT LẠI. ` +
        `Kiểm bảng \`totp_consumed\` (migration 0313) và kết nối DB.`,
    );
    return { hopLe: false, phatLai: false };
  }

  // `null` = không có DB ⇒ **KHÔNG BIẾT**, và "không biết" ở một cơ chế chống phát lại là TỪ CHỐI.
  if (giuBoi === null) {
    console.error(
      "[TotpOnce] Không có kết nối DB ⇒ sổ mã đã tiêu KHÔNG hỏi được ⇒ TỪ CHỐI (fail-closed).",
    );
    return { hopLe: false, phatLai: false };
  }

  // Một lượt gọi KHÁC đang giữ mã và mục còn sống ⇒ PHÁT LẠI.
  if (giuBoi !== cuaTa) return { hopLe: false, phatLai: true };

  // Ta vừa chèn mới / thu lại một mục quá hạn ⇒ đúng lúc bảng CÓ THỂ to thêm ⇒ dọn.
  // ⚠ I-3: dọn **của chính người vừa ghi**, không phải toàn bảng — xem docstring `donSo`.
  await donSo(userId);
  return { hopLe: true, phatLai: false };
}

/** Đúc dấu cho một LƯỢT GỌI mới. Tách ra để người gọi không tự bịa một chuỗi đoán được. */
export function dauLuotGoiMoi(): string {
  return randomUUID();
}

/**
 * Chỉ dùng trong lưới — số mục đang nằm trong sổ (bằng chứng của phép tự dọn).
 *
 * ⚠⚠⚠ **`userIds` LÀ BẮT BUỘC VỀ TINH THẦN, CÙNG LÝ DO VỚI `__resetSoTotpChoTest`.** Từ Pha 7 sổ là
 * một **BẢNG DÙNG CHUNG** và vitest chạy **các file test SONG SONG**, nên một phép đếm **toàn bảng**
 * đang đo cả hàng của **file khác**. Đo được ở Bước 7: `totpReplay` đòi *"còn ĐÚNG 1 mục"* và thấy
 * **2** vì `totpLedgerDurable` đang chạy cùng lúc. ⇒ Người gọi phải khai người dùng của mình.
 */
export async function __soTotpSize(userIds?: readonly number[]): Promise<number> {
  const db = await layDb();
  if (db === null) return 0;
  const { totpConsumed } = await import("../../drizzle/schema/auth");
  const { inArray } = await import("drizzle-orm");
  const q = db.select({ luot: totpConsumed.luot }).from(totpConsumed);
  const rows =
    userIds === undefined || userIds.length === 0
      ? await q
      : await q.where(inArray(totpConsumed.userId, [...userIds]));
  return rows.length;
}

/**
 * Chỉ dùng trong lưới — trả sổ về rỗng để mỗi ca độc lập.
 *
 * ⚠⚠⚠ **`userIds` KHÔNG PHẢI MỘT TIỆN NGHI — NÓ CHỐNG MỘT LỖI CHÉO GIỮA CÁC FILE TEST.** Từ Pha 7
 * sổ là một **BẢNG DÙNG CHUNG**, không còn là một `Map` cấp module. Vitest chạy **các file test
 * song song**, nên một lượt `DELETE` toàn bảng ở file A có thể rơi **vào giữa** một ca của file B —
 * xoá đúng mục mà B vừa ghi, và biến một lượt phát lại **đáng bị chặn** thành một lượt **được cho
 * qua**. Đó là một ca **XANH SAI**, thứ tệ hơn một ca đỏ.
 * ⇒ Mọi người gọi **phải khai người dùng của mình**. Bỏ trống là xoá cả bảng — giữ lại chỉ cho
 *   những lượt dọn toàn cục có chủ đích, và **không** nên dùng trong một file test.
 */
export async function __resetSoTotpChoTest(userIds?: readonly number[]): Promise<void> {
  const db = await layDb();
  if (db === null) return;
  const { totpConsumed } = await import("../../drizzle/schema/auth");
  const { inArray } = await import("drizzle-orm");
  if (userIds === undefined || userIds.length === 0) {
    await db.delete(totpConsumed);
    return;
  }
  // ⚠ `inArray()`, KHÔNG `sql\`col = ANY(${jsArray})\`` — cái sau cho 500 `42809`
  //   (GOTCHA đã trả giá ở 10 điểm gọi, memory `drizzle-any-array-antipattern`).
  await db.delete(totpConsumed).where(inArray(totpConsumed.userId, [...userIds]));
}
