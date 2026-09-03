/**
 * Doc 27 Đợt 2 / W2-C — INSPECTION INGEST STORE-AND-FORWARD (disk-backed WAL).
 * Gaps C3 (P0) + R11 + C5-partial.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * PROBLEM: `machineApi.submitInspection` (machineApiRouters.ts) inserts the
 * inspection + measurement rows DIRECTLY. If the DB is down/degraded the mutation
 * throws, the machine client gets an error and — depending on the vendor client —
 * the result AND its base64 defect images are lost forever. The existing WAL
 * (server/services/ot/storeForward.ts) only covers `ot_telemetry` rows.
 *
 * FIX (additive, flag-gated): when the submit pipeline fails with a TRANSIENT
 * error (DB unreachable / insert threw — NOT an auth/validation error), the FULL
 * submission payload (incl. inline base64 images) is appended to a durable local
 * WAL (append-only JSONL + in-memory mirror), the machine is ACKed with
 * `{ success:true, queued:true, submissionId }`, and a background worker replays
 * the payload through the SAME pipeline once the DB recovers.
 *
 * IDEMPOTENCY (exactly-once):
 *   • submission key = sha256(machine-identity | serialNumber | inspectionTime |
 *     overallResult | measurementCount). The router stamps `inspectionTime` at
 *     receive-time when the machine omitted it, so the key is stable across a
 *     WAL replay of the same received payload.
 *   • a machine-side retry of the SAME submission while it is queued dedupes
 *     in-memory (queuedKeys) — one WAL entry, one ACK.
 *   • before replaying, the backfill consults (a) the applied-key ledger and
 *     (b) an injected DB existence check (machineId + serialNumber +
 *     inspectionTime on product_inspections) — so a submission that ALSO landed
 *     live (machine retried directly after DB recovery) is never double-inserted.
 *   • a live-path success marks its key applied, guarding the crash-replay case.
 *
 * ── 2026-08-29 (WAL cho cây v2.0, §QĐ-WAL-A) — HAI HỌ KHOÁ, MỘT ĐIỂM ĐIỀU PHỐI ──
 * The formula above collides on v2.0 tree payloads: `serialNumber` empty is a
 * VALID shape in v2.0 ("empty if the machine hasn't scanned yet") and v2.0
 * carries `surfaces` — never `measurements` — so `measurementCount` is always 0.
 * Two GENUINELY DIFFERENT v2.0 boards, same station, same `inspectionTime`, both
 * empty serial ⇒ SAME key with this formula ⇒ the second board would be silently
 * swallowed as a "duplicate". `bufferSubmission`/`restoreInspectionWal` therefore
 * never call `computeSubmissionKey` directly — they go through
 * `dungKhoaGuiTheoHinhDang`, which dispatches BY SHAPE (`laHinhDangCayV2`, not the
 * optional `schemaVersion` field): v2.0 payloads key off `dungKhoaKhuTrungV2()`
 * (`server/contracts/machineDataContract.ts` — identity+productId+startedAt, not
 * serial-dependent); v1.x payloads keep this exact formula, unchanged.
 * `submitInspectionTreeV2` (`machineApiRouters.ts`) now also buffers on a
 * TRANSIENT failure and ACKs `{success:true, queued:true, submissionId}`, same
 * contract as the v1.x path below.
 *
 * ── 2026-08-29 (WAL cho cây v2.0, Task 2, §QĐ-WAL-B) — PHÁT LẠI ĐÚNG ĐƯỜNG ──────────
 * `ensureInspectionWalWired` (`machineApiRouters.ts`) nay CŨNG dispatch theo hình dạng
 * (`laHinhDangCayV2`, cùng vị từ mà `dungKhoaGuiTheoHinhDang` dùng ở trên): payload cây
 * v2.0 phát lại qua `submitInspectionTreeV2` (dichCayKetQua → persistInspectionAtomic
 * với `opts.cay`) — CHUỖI RIÊNG của nó, KHÔNG bị ép qua `processInspectionSubmission`
 * (đường v1.x — không hiểu `surfaces`, sẽ ghi được header rồi ÂM THẦM bỏ mất cả ba cấp
 * cây). Đây là gốc rễ đã đóng — TRƯỚC bản vá này một mục v2.0 xếp hàng thành công
 * (§QĐ-WAL-A) vẫn KHÔNG rút được: nó nằm an toàn trên đĩa (không mất) nhưng phát lại
 * qua v1.x cứ ghi thiếu mãi. Dedup khi phát lại cũng theo hình dạng:
 * `inspectionAlreadyPersistedV2` (machineApiRouters.ts) tra bảng LEDGER
 * `inspection_idempotency_keys` theo `dungKhoaKhuTrungV2()` — v1.x giữ nguyên
 * `inspectionAlreadyPersisted` (machineId+serialNumber+inspectionTime).
 *
 * BOUNDS (never grow unbounded, never drop silently): max entries + max age +
 * max bytes; on overflow the OLDEST entries are dropped — counted + warned.
 * PERMANENTLY invalid payloads (auth/validation TRPCErrors, Postgres 22xxx data-
 * exception / 23xxx constraint-violation on replay — `isPermanentSubmitError`,
 * BG-40) go to a dead-letter JSONL file instead of poisoning the queue.
 *
 * ── 2026-08-29 (BG-40 ⛔) — TRẦN `attempts` + BỎ CHẶN-ĐẦU-HÀNG ────────────────────
 * Hai lỗ mà bản vá này đóng, CẢ HAI đều nằm bên trong lời hứa BOUNDS ở trên:
 *   • `isPermanentSubmitError` TRƯỚC ĐÂY chỉ nhận `TRPCError` — mọi lỗi Postgres
 *     (kể cả `22001`/`23505`, không-retry-được) rơi vào nhánh TẠM THỜI, khiến câu
 *     "never drop silently" đúng NGHĨA ĐEN nhưng không đúng THỰC TẾ: mục đó không
 *     bị vứt, nhưng cũng không bao giờ rút được — nằm chờ 72h.
 *   • `backfillInspections` `break` thoát CẢ VÒNG khi gặp lỗi tạm thời ở ĐẦU hàng
 *     ⇒ một mục kẹt (dù xếp đúng hay xếp nhầm) chặn đứng MỌI mục lành xếp sau nó
 *     (đo THẬT: 1 bo độc + 4 bo lành, 20 lượt rút ⇒ `drained=0` cả 20 lượt).
 * Sửa: (1) mở rộng phân loại sang lớp SQLSTATE 22xxx/23xxx (không đụng ranh giới
 * kết nối/timeout — vẫn TẠM THỜI, chống mất bo khi DB chỉ chớp nháy); (2) TRẦN
 * `INSPECTION_STORE_FORWARD_MAX_ATTEMPTS` (mặc định 20) — vượt trần ⇒ dead-letter
 * CÓ GHI NHẬN thay vì chờ evictAged/evictBounds vứt câm; (3) vòng rút quét THEO CHỈ
 * SỐ thay vì neo `queue[0]` — một mục tạm-thời-lỗi bị bỏ qua trong CÙNG lượt (không
 * `break`), các mục lành phía sau vẫn được thử, ngân sách `drainBatch()` có sẵn vẫn
 * chặn trần tổng công việc mỗi tick. Chi tiết + lưới chứng minh:
 * `inspectionStoreForwardKhongChanDauHang.test.ts`.
 *
 * ── 2026-08-30 (BG-40 vòng sửa 2 ⛔) — REVIEW BÁC BỎ HAI LỜI KHAI CỦA VÒNG 1 ──────────
 * (2) và (3) ở trên có LỖ MỚI, đo THẬT (không suy từ đọc mã), xem
 * `inspectionStoreForwardKhongChanDauHang.test.ts` phần "vòng sửa 2":
 *   • C-1 — `budget` giảm ở CẢ nhánh tạm thời ⇒ với `drainBatch()`=50, một hàng ≥50 mục
 *     CÙNG lỗi tạm thời khiến CHỈ 50 mục đầu mỗi tick được tăng `attempts` — phần đuôi
 *     hàng đứng ở `attempts=0` VĨNH VIỄN, còn 50 mục đầu chạm trần đếm-lượt sau ~83 phút
 *     và bị dead-letter VÌ MỘT LỖI THUẦN TẠM THỜI (đo: 200 mục lỗi `08006`, 25 lượt ⇒
 *     `deadLettered=50, chưa-thử=100`). Sửa: `budget` nay CHỈ giảm khi có CÔNG VIỆC
 *     THẬT (thành công hoặc dead-letter) — nhánh tạm thời không tốn ngân sách, nên MỖI
 *     tick quét hết hàng đợi hiện có, không mục nào đứng ở `attempts=0`. Và trần đổi từ
 *     ĐẾM LƯỢT sang ĐO THỜI GIAN (`maxStuckMs`, xem doc-comment tại chỗ khai) vì số lượt
 *     gọi không tỷ lệ thuận với thời gian thật.
 *   • C-2 — `break` ở nhánh `dedupFn` ném lỗi (bước "(b) DB existence dedupe") vẫn còn
 *     nguyên — LÝ DO viện dẫn ("lỗi ở đây = DB tự nó hỏng, dùng chung cho mọi mục") SAI:
 *     `dedupFn` có thể ném vì lý do RIÊNG của một payload (v1.x: `inspectionTime` rác ⇒
 *     `new Date()` invalid ⇒ `RangeError`; v2.0: `laHinhDangCayV2` chỉ hỏi
 *     `Array.isArray(surfaces)` ⇒ true cho payload thiếu `identity` ⇒
 *     `dungKhoaKhuTrungV2` huỷ tay). Đo: 1 payload làm `dedupFn` ném + 4 bo lành, 30 lượt
 *     ⇒ `drained=0` cả 30 lượt. Sửa: nhánh `(b)` nay xử lý GIỐNG HỆT nhánh `processFn`
 *     (permanent ⇒ dead-letter ngay; không phân biệt được rẻ ⇒ coi như lỗi RIÊNG của
 *     payload đó — không `break`, không chặn mục sau, vẫn chịu trần `maxStuckMs`).
 * Dead-letter CHƯA có giao diện nào hiển thị (BG-36, đang mở) — 101 mục từng nằm 6 tuần
 * không ai biết. `maybeAlertDeadLetter()` (dưới) phát WARN định kỳ (tối đa 1 lần/5 phút,
 * cùng nhịp `maybeAlertDepth`) khi `metrics.deadLettered > 0`, TRONG PHIÊN CHẠY hiện tại
 * — đây KHÔNG phải cảnh báo bền vững qua restart (metrics là in-memory); một giao diện
 * đọc trực tiếp `deadLetterFile()` vẫn là việc CHƯA làm (BG-36).
 *
 * ── 2026-08-31 (Pha 1E Task 1 — BG-64 + BG-66 + BG-67 ⛔) — REVIEW LƯỢT 5 BÁC BỎ "MỐC SON"
 * VÒNG SỬA 2, BA LỖ MỚI, CẢ BA LÀ HẬU QUẢ CỦA CHÍNH CÁC BẢN VÁ TRƯỚC ────────────────────────
 * Bài học chi phối cả ba: **một bản vá đúng ở chỗ nó nhắm, rồi mở một chiều khác.** Trước khi
 * viết mã sửa, câu hỏi bắt buộc: "bản vá này chuyển thứ gì từ lớp nào sang lớp nào, và ai đang
 * phụ thuộc vào phân lớp cũ?"
 *
 * BG-64 — `isPermanentSubmitError` bỏ sót đúng lớp nguy hiểm nhất. Commit `1c3c74ef` (BG-52)
 * thêm `.max()` cho `metaJsonSchema` (cửa ZIP, `aoiPackageRouter.ts`) — ĐÚNG, chặn payload quá
 * cỡ sớm hơn. Nhưng nó CHUYỂN lỗi chuỗi-quá-cỡ từ tầng Postgres (`22001`, đã VĨNH VIỄN — đúng)
 * sang tầng Zod (`ZodError` ném THẲNG từ `metaJsonSchema.parse()`, gọi tay — KHÔNG đi qua
 * `.input()`/`createInputMiddleware` của tRPC nên KHÔNG được bọc `TRPCError(BAD_REQUEST)`, vốn
 * đã nằm trong `PERMANENT_TRPC_CODES`). `isPermanentSubmitError` TRƯỚC bản vá này chỉ biết hai
 * lớp (`TRPCError` theo code cố định, SQLSTATE 22/23xxx) — một `ZodError` trần không khớp lớp
 * nào ⇒ TẠM THỜI ⇒ "hai nửa của cùng một commit cắn nhau": nửa thêm `.max()` làm chốt chặn ĐẾM
 * (dead-letter sau N lần) tại `aoiPackageRouter.commit` (BG-52) **yếu đi** đúng cho lớp payload
 * nó sinh ra để chặn. Cùng lỗ, hai biểu hiện khác: JSZip lỗi archive hỏng (`JSZip.loadAsync`,
 * KHÔNG có class lỗi riêng — plain `Error`, xem `node_modules/jszip/lib/{zipEntries,zipEntry,
 * load}.js`) và `JSON.parse` lỗi cú pháp (`metaContent` không phải JSON hợp lệ) — CẢ HAI đều
 * KHÔNG BAO GIỜ thành công khi thử lại NGUYÊN VĂN cùng byte, nhưng trước bản vá này đều rơi
 * TẠM THỜI. Sửa: `isPermanentSubmitError` nay còn nhận diện (đi bộ `.cause` như lớp SQLSTATE ở
 * trên, không viết bộ đi-bộ thứ hai) — `err instanceof ZodError`, `err instanceof SyntaxError`,
 * và thông điệp lỗi JSZip khớp `CORRUPT_ARCHIVE_MESSAGE` (chữ ký lấy TỪ MÃ NGUỒN JSZip thật, xem
 * `isPermanentPayloadShapeError`). ⚠ CHỐNG SIẾT QUÁ (mệnh đề 2, `task-1-brief.md`): KHÔNG đụng
 * ranh giới lỗi kết nối — `ECONNREFUSED`/`08006`/`57P03` không khớp bất kỳ lớp nào ở trên, vẫn
 * TẠM THỜI. `isPermanentSubmitError` được TÁI DÙNG ở `aoiPackageRouter.commit` (cửa ZIP, BG-52)
 * — bản vá NÀY (ở tầng hàm dùng chung) đổi hành vi CỬA ĐÓ mà không sửa file đó (đúng ranh giới
 * task, xem `task-1-brief.md`); ai đang phụ thuộc phân lớp CŨ ("JSZip/JSON hỏng ⇒ tạm thời") là
 * `aoiPackageZipChotChanRetry.test.ts` §2 — file đó tự khai đây là "giới hạn ĐÃ BIẾT", nay lỗ
 * đã đóng Ở TẦNG HÀM, phần cập nhật lại kỳ vọng của bài test đó thuộc Task 2 (BG-65+68, file
 * `aoiPackageRouter.ts` không thuộc phạm vi Task 1).
 *
 * BG-66 — `maxStuckMs` (vòng sửa 2) đo từ lúc XẾP HÀNG (`enqueuedAt`), không đo "kẹt". Một mục
 * nằm im 25h chưa từng được `backfillInspections()` chạm tới (`attempts=0`, KHÔNG phải do nó
 * bền — do tiến trình đứng/bảo trì) rồi gặp lỗi TẠM THỜI ở lượt đầu tiên bị dead-letter NGAY vì
 * `Date.now() - enqueuedAt` đã vượt 24h — dù nó CHƯA HỀ được thử lần nào. Kịch bản thật: tắt
 * bảo trì cuối tuần → `restoreInspectionWal` khôi phục nguyên `enqueuedAt` từ đĩa (đúng, đó là
 * lúc nó xếp hàng thật) → tick đầu sau khởi động gặp lỗi tạm thời → MỌI mục nằm quá 24h TRƯỚC
 * KHI có cơ hội retry nào đều chết CÙNG LÚC — WAL biến thành máy vứt bo ĐÚNG khi nó vừa được
 * đánh thức để cứu bo. Ai phụ thuộc phân lớp cũ ("khoảng thời gian bền = khoảng thời gian nằm
 * trong hàng đợi"): KHÔNG ai — đây thuần là lỗi phép đo của vòng sửa trước, không ai cố ý dựa
 * vào nó. Sửa: mốc dùng để so với `maxStuckMs()` đổi từ `enqueuedAt` sang `WalEntry.lanHongDauMs`
 * — dấu thời gian của LẦN HỎNG ĐẦU TIÊN qua `backfillInspections` (KHÔNG phải lần buffer/enqueue
 * — buffer là do LIVE PATH hỏng, backfill là chuyện KHÁC). `lanHongDauMs` là `undefined` cho một
 * mục CHƯA TỪNG hỏng qua backfill (không có đồng hồ nào chạy — mệnh đề 3), được set MỘT LẦN ở
 * lần hỏng đầu (không dịch chuyển ở các lần hỏng liên tiếp sau — mới đo được "kẹt LIÊN TỤC bao
 * lâu"), và không tồn tại (⇒ đồng hồ RESET) cho một entry MỚI sau khi entry CŨ (nếu có) đã thành
 * công (thành công luôn `removeAt` khỏi hàng đợi — một entry mới, dù cùng máy/cùng seri, luôn
 * bắt đầu với đồng hồ trống, không kế thừa thời gian đã trôi của một đợt trước đã khép lại).
 * Được PERSIST vào file mirror (không chỉ in-memory) để sống sót qua restart — nếu không, một
 * mục ĐANG kẹt thật (đã hỏng nhiều lần, gần chạm trần) sẽ bị "ân xá" oan mỗi lần tiến trình khởi
 * động lại, hoãn vô thời hạn cảnh báo dead-letter cho một mục có payload thật sự có vấn đề.
 *
 * BG-67 — một tick `backfillInspections()` quét TOÀN hàng đợi hiện có, không có trần nào ngoài
 * `budget` (`drainBatch()`, mặc định 50) — nhưng `budget` (từ vòng sửa 2, C-1) CHỈ giảm khi có
 * CÔNG VIỆC THẬT (thành công hoặc dead-letter); một hàng đợi TOÀN lỗi tạm thời không giảm
 * `budget` bao giờ ⇒ vòng quét đi hết `queue.length`. Đo THẬT: 20.000 mục = 40.000 lời gọi DB
 * (`dedupFn`+`processFn`) TRONG MỘT TICK — 137ms nếu cả hai hàm chạy trong bộ nhớ, nhưng với
 * ECONNREFUSED thật (~12,9ms/lượt đo được) ⇒ ~518 giây; với DB "hố đen" (gói tin rơi lặng im,
 * `connect_timeout=30s`, không refuse ngay) ⇒ 40.000 × 30s ≈ 333 GIỜ MỘT TICK — suốt thời gian
 * đó `draining=true` khiến MỌI lượt gọi `backfillInspections()` khác (kể cả rút cơ hội từ đường
 * ingest LIVE khi nó tự phát hiện DB đã hồi) trả về ngay, làm 0 việc. Đây là hậu quả TRỰC TIẾP
 * của vòng sửa 2: vòng 1 (BG-40 việc 3) có một trần quét (tái dùng `drainBatch()` làm trần quét
 * LUÔN — SAI, gây đói hàng đuôi khi có ≥50 mục lỗi tạm thời ở đầu hàng: C-1); vòng sửa 2 GỠ trần
 * đó (đổi `budget` thành chỉ đếm việc-có-hậu-quả) để đóng C-1, và KHÔNG đo lại chi phí quét —
 * "phí tổn bị chặn trần bởi đúng ngân sách đã tồn tại sẵn" (chú thích vòng 1) không còn đúng.
 * Ai đang phụ thuộc phân lớp cũ ("scan không cần trần riêng, `budget` là đủ"): chính vòng sửa 2
 * — lời giải thích của nó cho việc gỡ trần dựa trên tiền đề mà nó vừa phá (budget-giảm-mọi-
 * nhánh). Sửa: hai trần TÁCH BIỆT — `budget` (thao-tác-CÓ-HẬU-QUẢ mỗi tick, không đổi) và
 * `maxScanPerTick()` (mục ĐƯỢC CHẠM — dù có hậu quả hay không — mỗi tick, MỚI). Để không đói
 * hàng đuôi khi `maxScanPerTick() < queue.length` (đúng lỗi C-1 đã bắt vòng 1, KHÔNG được tái
 * diễn dưới tên khác), vị trí quét NHỚ giữa các tick qua con trỏ xoay vòng module-level
 * `scanCursor` — tick sau tiếp tục từ chỗ tick trước dừng (mod độ dài hàng đợi hiện tại), không
 * bao giờ luôn bắt đầu lại từ đầu mảng. Qua ĐỦ SỐ TICK, mọi mục đều được chạm — "quét hết theo
 * lượt" (nhiều tick) THAY vì "quét hết trong MỘT tick" (đúng thứ gây ra BG-67).
 *
 * HONESTY: with the flag OFF every entry point is a no-op → behaviour is exactly
 * as before (throw on DB failure). The process/dedup functions are INJECTED so
 * tests exercise buffer/backfill/idempotency without a live DB.
 * ════════════════════════════════════════════════════════════════════════════
 */
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { TRPCError } from "@trpc/server";
import { ZodError } from "zod";
// Doc 2026-08-29 (WAL cho cây v2.0, §QĐ-WAL-A) — khoá gửi RIÊNG cho payload hình dạng
// cây v2.0 + vị từ nhận diện hình dạng. Cả hai sống ở module hợp đồng LÁ
// (`server/contracts/machineDataContract.ts`, KHÔNG import gì từ `routers/`), nên import
// TĨNH ở đây không tạo vòng với `machineApiRouters.ts` (file đó import NGƯỢC LẠI từ module
// này ở cấp module — xem `dungKhoaGuiTheoHinhDang` bên dưới để hiểu VÌ SAO không đặt điều
// phối khoá ở `machineApiRouters.ts`).
import { dungKhoaKhuTrungV2, laHinhDangCayV2 } from "../../contracts/machineDataContract";
import type { MachineDataContractV2 } from "../../contracts/machineDataContractV2";

/**
 * The buffered payload is the raw `submitInspection` input (plus the resolved
 * credential when the machine authenticated via Authorization header). Kept
 * structurally typed here to avoid a value-level import cycle with the router.
 *
 * 2026-08-29 (WAL cho cây v2.0) — this ALSO stands in for a v2.0 tree payload
 * (`MachineDataContractV2`): it has no `measurements` (index signature absorbs
 * its `surfaces`/`identity`/`productId` instead) and `serialNumber`/`overallResult`
 * are both present, just narrower-typed (`overallResult: "OK"|"NG"`, no "NTF").
 * Structural compatibility is intentional — see `dungKhoaGuiTheoHinhDang` below.
 */
export interface BufferedSubmission {
  machineCode?: string;
  apiKey?: string;
  serialNumber: string;
  inspectionTime?: string;
  overallResult: string;
  measurements?: unknown[];
  [key: string]: unknown;
}

// ── flag ────────────────────────────────────────────────────────────────────

/**
 * Read at call time so config toggles / tests take effect. Dedicated flag with
 * fallback to the OT store-forward master switch (one "production profile"
 * switch covers both durability layers — doc 27 §11 hạng mục 2.3).
 */
export function inspectionStoreForwardEnabled(): boolean {
  const own = process.env.INSPECTION_STORE_FORWARD_ENABLED;
  if (own === "true" || own === "1") return true;
  if (own === "false" || own === "0") return false;
  return (
    process.env.OT_STORE_FORWARD_ENABLED === "true" ||
    process.env.OT_STORE_FORWARD_ENABLED === "1"
  );
}

// ── config (env-driven; honest defaults) ────────────────────────────────────

function walFile(): string {
  const p = process.env.INSPECTION_STORE_FORWARD_FILE?.trim();
  return path.resolve(p && p.length > 0 ? p : "./data/inspection-store-forward.jsonl");
}

function deadLetterFile(): string {
  return walFile().replace(/\.jsonl$/, "") + ".dead.jsonl";
}

function envInt(name: string, fallback: number): number {
  const n = parseInt(process.env[name] || "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Max buffered entries before the OLDEST are dropped (counted, never silent). */
function maxEntries(): number {
  return envInt("INSPECTION_STORE_FORWARD_MAX", 20000);
}

/** Max age (ms) an entry may live before it is dropped on the next sweep. 72h default. */
function maxAgeMs(): number {
  return envInt("INSPECTION_STORE_FORWARD_MAX_AGE_MS", 72 * 60 * 60 * 1000);
}

/** Max approximate WAL bytes (payloads carry base64 images). 512 MiB default. */
function maxBytes(): number {
  return envInt("INSPECTION_STORE_FORWARD_MAX_BYTES", 512 * 1024 * 1024);
}

/** How many entries to replay per backfill call (bounded work per attempt). */
function drainBatch(): number {
  return envInt("INSPECTION_STORE_FORWARD_DRAIN_BATCH", 50);
}

/**
 * ── 2026-08-30 (BG-40 vòng sửa 2, C-1) — TRẦN GẮN THỜI GIAN, KHÔNG GẮN SỐ LƯỢT ──────
 * Bản vòng 1 dùng `attempts >= 20` (đếm LƯỢT) làm điều kiện dead-letter — review toàn
 * nhánh BÁC BỎ bằng phép đo THẬT: 200 mục CÙNG lỗi tạm thời (`08006` mất kết nối, không
 * mục nào có payload hỏng), 25 lượt rút ⇒ `deadLettered=50, soMucChuaDuocThuLanNao=100,
 * soLanThu_SN000=20` (dead-letter record). Gốc rễ ĐÔI: (a) `budget` (=`drainBatch()`=50)
 * TRƯỚC ĐÂY giảm ở CẢ nhánh tạm thời ⇒ chỉ 50 mục ĐẦU hàng mỗi tick được tăng `attempts`
 * (150 mục sau đứng ở 0 vĩnh viễn — xem `backfillInspections`, đã sửa: budget nay CHỈ
 * giảm khi có công việc THẬT); (b) SỐ LƯỢT gọi `backfillInspections()` KHÔNG tỷ lệ thuận
 * với THỜI GIAN THẬT (interval nền lùi-mũ 15s→5 phút NGOÀI đời thật, nhưng gọi tay/gọi
 * dồn trong test có thể chạy hàng chục lượt trong vài mili-giây) ⇒ đếm LƯỢT trả lời SAI
 * câu hỏi thật sự cần trả lời: "DB gián đoạn từng phần 4 giờ thì vứt bao nhiêu bo?" —
 * với 20 lượt-đếm-mù đó, ~83 phút (interval lùi-mũ mặc định) là đủ để vứt oan một mục
 * CHỈ đang chờ DB hồi phục — cửa sổ bền THẬT tụt từ lời hứa 72h (`maxAgeMs`) xuống ~83
 * phút.
 *
 * Sửa: trần đổi sang ĐO THỜI GIAN THẬT đã trôi kể từ lúc xếp hàng (`Date.now() -
 * entry.enqueuedAt`), không phải đếm số lần gọi. Mặc định 24h: xa TRÊN mọi gián đoạn
 * "dài nhưng còn cứu được" trong thực tế vận hành (câu hỏi bắt buộc phải trả lời "0 bo
 * bị vứt" cho một lần gián đoạn 4 giờ — 24h > 4h, an toàn), và xa DƯỚI 72h (`maxAgeMs`)
 * để vẫn có một điểm GHI NHẬN sớm hơn hẳn trước khi `evictAged` vứt câm không lý do.
 * `attempts` VẪN được tăng ở mỗi lượt thất bại (chỉ để quan sát/ghi log — không còn là
 * điều kiện quyết định dead-letter).
 */
function maxStuckMs(): number {
  return envInt("INSPECTION_STORE_FORWARD_MAX_STUCK_MS", 24 * 60 * 60 * 1000);
}

/**
 * ── 2026-08-31 (BG-67 ⛔) — TRẦN QUÉT, TÁCH KHỎI `budget` (trần thao-tác-CÓ-HẬU-QUẢ) ──────────
 * `budget` (vòng sửa 2) CHỈ giảm khi một mục có kết quả THẬT (thành công/dead-letter) — một
 * hàng đợi TOÀN lỗi tạm thời không giảm `budget` bao giờ, nên vòng quét đi hết `queue.length`
 * KHÔNG TRẦN. Đo THẬT: 20.000 mục = 40.000 lời gọi DB (`dedupFn`+`processFn`) TRONG MỘT TICK;
 * với DB "hố đen" (`connect_timeout=30s`) ⇒ ~333 GIỜ một tick, suốt thời gian đó `draining=true`
 * chặn MỌI lượt `backfillInspections()` khác. `maxScanPerTick()` giới hạn SỐ MỤC ĐƯỢC CHẠM (dù
 * có hậu quả hay không) mỗi tick — ĐỘC LẬP với `budget`. Mặc định 2.000: đủ lớn để KHÔNG phá
 * mệnh đề 7 (200 mục lỗi tạm thời phải được thử ĐỦ mỗi tick — vòng sửa 2 vừa đạt, xem
 * `inspectionStoreForwardKhongChanDauHang.test.ts`, V2-1), đủ nhỏ để 20.000 mục KHÔNG còn ra
 * 40.000 lời gọi trong một tick. Để không đói hàng đuôi khi `maxScanPerTick() < queue.length`
 * (đúng lỗi C-1 đã bắt ở vòng 1 dưới tên "trần đếm-lượt" — KHÔNG được tái diễn dưới tên khác),
 * vị trí quét NHỚ giữa các tick qua con trỏ xoay vòng `scanCursor` (xem `backfillInspections`).
 */
function maxScanPerTick(): number {
  return envInt("INSPECTION_STORE_FORWARD_MAX_SCAN_PER_TICK", 2000);
}

/** Warn loudly when the queue depth reaches this (repeated at most every 5 min). */
function alertDepth(): number {
  return envInt("INSPECTION_STORE_FORWARD_ALERT_DEPTH", 500);
}

// ── WAL state (in-memory queue is source of truth; file mirror for restart) ──

interface WalEntry {
  /** Idempotency key (see computeSubmissionKey). */
  key: string;
  enqueuedAt: number;
  /** Số lần phát lại TẠM THỜI thất bại — CHỈ để quan sát/ghi log. Điều kiện dead-letter
   * là THỜI GIAN KẸT LIÊN TỤC so với `maxStuckMs()` (xem `lanHongDauMs` — BG-66, KHÔNG
   * còn tính từ `enqueuedAt`), KHÔNG phải số này (BG-40 vòng sửa 2, C-1 — đếm lượt bị
   * bác bỏ vì không tỷ lệ thuận với thời gian thật). */
  attempts: number;
  /** ── 2026-08-31 (BG-66 ⛔) — mốc THỜI GIAN của LẦN HỎNG ĐẦU TIÊN qua `backfillInspections`
   * (KHÔNG phải `enqueuedAt` — mục nằm hàng đợi lâu nhưng CHƯA TỪNG được thử không "kẹt").
   * `undefined` = mục này CHƯA từng hỏng qua backfill — KHÔNG có đồng hồ nào chạy (mệnh đề 3,
   * `task-1-brief.md`). Set MỘT LẦN ở lần hỏng đầu (không dịch chuyển ở các lần hỏng liên tiếp
   * sau — mới đo được "kẹt LIÊN TỤC bao lâu", mệnh đề 4). Một entry MỚI (sau khi entry cũ đã
   * `removeAt` vì thành công) luôn bắt đầu `undefined` — đồng hồ RESET tự nhiên, không kế thừa
   * thời gian đã trôi của đợt trước (mệnh đề 5). Được PERSIST vào file mirror để sống sót qua
   * restart (nếu không, một mục ĐANG kẹt thật sẽ được "ân xá" oan mỗi lần tiến trình khởi động
   * lại). */
  lanHongDauMs?: number;
  /** Approximate serialized size (for the byte bound). */
  bytes: number;
  payload: BufferedSubmission;
}

const queue: WalEntry[] = [];
const queuedKeys = new Set<string>();
let queueBytes = 0;

/** Keys CONFIRMED persisted (live path or backfill). Bounded FIFO ledger. */
const appliedKeys = new Set<string>();
const appliedOrder: string[] = [];
const APPLIED_LEDGER_MAX = 100000;

// ── honest metrics ───────────────────────────────────────────────────────────

export interface InspectionStoreForwardMetrics {
  buffered: number;
  backfilled: number;
  deduped: number;
  deadLettered: number;
  droppedOverflow: number;
  droppedAge: number;
  droppedBytes: number;
  lastBackfillAt: string | null;
  lastBufferedAt: string | null;
}

const metrics: InspectionStoreForwardMetrics = {
  buffered: 0,
  backfilled: 0,
  deduped: 0,
  deadLettered: 0,
  droppedOverflow: 0,
  droppedAge: 0,
  droppedBytes: 0,
  lastBackfillAt: null,
  lastBufferedAt: null,
};

// ── injected pipeline (router wires the real submit path; tests mock it) ─────

/**
 * Re-run the FULL submit pipeline for a buffered payload. Throws on failure.
 *
 * ★★★ Task 5 (BG-97 → BG-99, spec QĐ-2) — second param `meta.enqueuedAt`: the moment
 * THIS entry was queued (`WalEntry.enqueuedAt`, persisted verbatim in the WAL file —
 * survives a restart via `restoreInspectionWal`). The v2.0 tree wiring
 * (`ensureInspectionWalWired`, machineApiRouters.ts) threads it through as
 * `submitInspectionTreeV2`'s `opts.serverReceivedAt`, so a replay grades the board
 * against the limits live AT ENQUEUE TIME, not at replay time — the machine's own
 * declared `completedAt`/`startedAt` is no longer trusted as the gate anchor (spec
 * QĐ-2: machine clocks are not trustworthy, see `assessClockSkew`). Optional so every
 * OTHER `setProcessFn` caller (v1.x path, tests) stays source-compatible unchanged.
 */
export type ProcessFn = (
  payload: BufferedSubmission,
  meta?: { enqueuedAt?: Date },
) => Promise<{ inspectionId: number }>;
/** Return true when this submission ALREADY has a persisted inspection row. */
export type DedupFn = (payload: BufferedSubmission) => Promise<boolean>;

let processFn: ProcessFn = async () => {
  throw new Error("[InspectionSF] process fn not wired (call setProcessFn)");
};
let dedupFn: DedupFn = async () => false;

export function setProcessFn(fn: ProcessFn): void {
  processFn = fn;
}
export function setDedupFn(fn: DedupFn): void {
  dedupFn = fn;
}

// ── idempotency key ──────────────────────────────────────────────────────────

/**
 * submission id = machine identity + serial + timestamp hash (doc 27 W2-C).
 * The raw apiKey never appears in the key — only a sha256 fingerprint prefix.
 * overallResult + measurement count are folded in as a collision guard for
 * clients that omit inspectionTime on two different boards of the same serial.
 */
export function computeSubmissionKey(payload: BufferedSubmission): string {
  const machineIdentity = payload.machineCode?.trim()
    ? `mc:${payload.machineCode.trim()}`
    : payload.apiKey
      ? `ak:${createHash("sha256").update(payload.apiKey).digest("hex").slice(0, 16)}`
      : "anon";
  const material = [
    machineIdentity,
    payload.serialNumber ?? "",
    payload.inspectionTime ?? "",
    payload.overallResult ?? "",
    String(Array.isArray(payload.measurements) ? payload.measurements.length : 0),
  ].join("|");
  return createHash("sha256").update(material).digest("hex");
}

/**
 * §QĐ-WAL-A (`docs/superpowers/plans/2026-08-29-aoi-wal-cho-cay-v2.md`) — điều phối
 * khoá gửi THEO HÌNH DẠNG payload (`laHinhDangCayV2`), KHÔNG theo trường `schemaVersion`
 * khai báo (trường đó `optional()` — máy có thể không gửi, xem doc-comment tại chỗ khai
 * `laHinhDangCayV2`).
 *
 * `computeSubmissionKey` (ngay phía trên) băm `serialNumber | inspectionTime |
 * overallResult | measurements.length`. HAI thành phần cuối là hàng rào chống đụng độ
 * cho client bỏ trống `inspectionTime` — nhưng hàng rào đó KHÔNG chắn được payload
 * v2.0: `serialNumber` RỖNG là HỢP LỆ ở v2.0 (tài liệu máy: "rỗng nếu máy chưa gửi"),
 * và payload v2.0 mang `surfaces` — KHÔNG có `measurements` ⇒ `measurements.length`
 * luôn là 0. ⇒ Hai bo v2.0 KHÁC NHAU, cùng trạm, cùng `inspectionTime`, cả hai serial
 * rỗng, cùng `overallResult` ⇒ TRÙNG KHOÁ theo công thức v1 ⇒ WAL nuốt bo thứ hai và
 * coi là bản sao — MẤT DỮ LIỆU do chính cơ chế chống mất dữ liệu (chứng minh live bằng
 * ca đỏ/xanh ở `walCayV2.test.ts`, không suy đoán từ đọc mã).
 *
 * Payload v2.0 dùng `dungKhoaKhuTrungV2()` (`server/contracts/machineDataContract.ts`)
 * — dựng từ `identity` (7 trường BẮT BUỘC) + `productId` + `startedAt`, KHÔNG phụ thuộc
 * serial, đã chứng minh tất định + không đụng độ ranh giới trường (Pha 1C Task 2, lưới
 * `server/db/ingestV2KhuTrung.db.test.ts`). Payload v1.x GIỮ NGUYÊN `computeSubmissionKey`
 * — chống hồi quy, đường cũ không đổi hành vi (mệnh đề 3, task-1-brief.md).
 *
 * Gọi TỪ bên trong `bufferSubmission`/`restoreInspectionWal` (không phải tại nơi gọi) để
 * MỌI đường enqueue — kể cả restore từ file WAL sau khi restart — cùng dùng đúng MỘT
 * điểm quyết định, không thể vô tình gọi `computeSubmissionKey` trực tiếp cho payload v2.0.
 */
export function dungKhoaGuiTheoHinhDang(payload: BufferedSubmission): string {
  if (laHinhDangCayV2(payload)) {
    return dungKhoaKhuTrungV2(payload as unknown as MachineDataContractV2);
  }
  return computeSubmissionKey(payload);
}

// ── error classification (transient → buffer; permanent → throw/dead-letter) ─

const PERMANENT_TRPC_CODES = new Set([
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "BAD_REQUEST",
  "CONFLICT",
  "PRECONDITION_FAILED",
  "PAYLOAD_TOO_LARGE",
  "UNPROCESSABLE_CONTENT",
  "TOO_MANY_REQUESTS",
]);

/**
 * ── 2026-08-29 (BG-40 ⛔) — LỚP SQLSTATE KHÔNG-RETRY-ĐƯỢC ─────────────────────────
 * TRƯỚC bản vá này, `isPermanentSubmitError` chỉ nhận diện `TRPCError` — MỌI lỗi
 * Postgres (kể cả `22001` chuỗi quá dài, `23505` vi phạm ràng buộc) rơi vào nhánh
 * TRANSIENT ⇒ nằm đệm mãi mãi, máy nhận `{success:true, queued:true}` và không bao
 * giờ gửi lại. Đo THẬT trên mã cũ (1 bo độc code=22001 + 4 bo lành, 20 lượt rút):
 * `drained=0` ở CẢ 20 lượt — 4 bo lành không được thử lấy một lần (xem
 * `inspectionStoreForwardKhongChanDauHang.test.ts`).
 *
 * Hai lớp SQLSTATE dưới đây KHÔNG BAO GIỜ thành công khi thử lại NGUYÊN VĂN payload:
 *   22xxx — data exception (chuỗi quá dài, sai kiểu, tràn số…)
 *   23xxx — integrity constraint violation (unique/FK/not-null/check…)
 * ⚠ CHỐNG SIẾT QUÁ (mệnh đề 2, task-1-brief.md): lỗi kết nối/timeout dùng SQLSTATE
 * lớp KHÁC hẳn — 08xxx (connection exception), 53xxx (insufficient resources),
 * 57Pxx (admin shutdown / cannot connect now) — hoặc hoàn toàn KHÔNG có SQLSTATE
 * (`ECONNREFUSED`/`ETIMEDOUT` là mã lỗi của Node, không phải Postgres). Không cái
 * nào khớp `/^(22|23)/` ⇒ vẫn TRANSIENT. Xếp nhầm một kết nối chớp nháy thành "vĩnh
 * viễn" là MẤT BO — đúng thứ WAL này sinh ra để chống, nên biên này KHÔNG được nới.
 */
const PERMANENT_SQLSTATE_PREFIX = /^(22|23)\d{3}$/;

/**
 * Đi bộ err → err.cause → ... tìm SQLSTATE lớp 22xxx/23xxx. postgres.js đặt `code`
 * THẲNG trên lỗi driver thô; drizzle-orm ≥0.44 bọc trong `DrizzleQueryError` (message
 * bắt đầu "Failed query: ...") mang mã thật ở `.cause` — CÙNG kiểu đi bộ với
 * `isUniqueViolation`/`isMissingTable`/`isMissingColumn` (`server/_core/dbErrors.ts`),
 * không chế lại một lần nữa.
 */
function isPermanentDbSqlState(err: unknown): boolean {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && current; depth++) {
    if (typeof current !== "object") break;
    const e = current as { code?: unknown; cause?: unknown };
    if (typeof e.code === "string" && PERMANENT_SQLSTATE_PREFIX.test(e.code)) return true;
    current = e.cause;
  }
  return false;
}

/**
 * ── 2026-08-31 (BG-64 ⛔) — LỚP "HÌNH DẠNG PAYLOAD KHÔNG BAO GIỜ ĐỌC ĐƯỢC" ─────────────────
 * Chữ ký lấy TỪ MÃ NGUỒN JSZip thật (`node_modules/jszip/lib/{zipEntries,zipEntry,load}.js`),
 * không đoán: `"Corrupted zip : CRC32 mismatch"`, `"Corrupted zip or bug: unexpected signature"`,
 * `"Can't find end of central directory : ..."`, `"Corrupted zip: can't find end of central
 * directory"`, `"Corrupted zip: can't find the ZIP64 end of central directory..."`,
 * `"Corrupted zip: missing N bytes"`, `"Bug or corrupted zip : didn't get enough information..."`,
 * `"Corrupted zip : compression ... unknown..."`, `"Encrypted zip are not supported"`. JSZip
 * KHÔNG có class lỗi riêng (mọi lỗi trên đều `new Error(...)` trần) nên chỉ còn cách nhận diện
 * qua chữ ký thông điệp — cố ý HẸP (không match "zip" trần chung chung) để không vô tình nuốt
 * một lỗi mạng/storage tình cờ nhắc tới "zip".
 */
const CORRUPT_ARCHIVE_MESSAGE = /corrupted zip|central directory|encrypted zip are not supported/i;

/**
 * ── 2026-08-31 (BG-64 ⛔) — Ba chế độ hỏng PHỔ BIẾN NHẤT của một payload không cái nào được
 * `isPermanentSubmitError` (bản TRƯỚC bản vá này) nhận ra: **quá cỡ** (`ZodError` — commit
 * `1c3c74ef`/BG-52 thêm `.max()` cho `metaJsonSchema`, chặn SỚM HƠN Postgres nên chuỗi quá cỡ
 * giờ ném `ZodError` TRẦN từ `metaJsonSchema.parse()` gọi tay, KHÔNG qua `.input()` nên KHÔNG
 * được tRPC bọc `TRPCError(BAD_REQUEST)` — vốn đã VĨNH VIỄN từ trước), **nén hỏng** (JSZip, xem
 * `CORRUPT_ARCHIVE_MESSAGE`), **JSON hỏng** (`JSON.parse(metaContent)` ném `SyntaxError` chuẩn
 * của V8 khi bytes không phải JSON hợp lệ). Cả ba: thử lại NGUYÊN VĂN cùng byte KHÔNG BAO GIỜ
 * thành công — đúng định nghĩa VĨNH VIỄN, y hệt lý do SQLSTATE 22/23xxx ở trên. Đi bộ `.cause`
 * giống `isPermanentDbSqlState` (không viết bộ đi-bộ thứ hai) vì tRPC/middleware có thể bọc lỗi
 * gốc ở `.cause` trước khi nó tới đây.
 */
function isPermanentPayloadShapeError(err: unknown): boolean {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && current; depth++) {
    if (current instanceof ZodError) return true;
    if (current instanceof SyntaxError) return true;
    if (current instanceof Error && CORRUPT_ARCHIVE_MESSAGE.test(current.message)) return true;
    if (typeof current !== "object") break;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * A PERMANENT error means retrying the same payload can never succeed
 * (bad credentials / validation / Postgres 22xxx data-exception / 23xxx
 * constraint-violation / oversized-or-corrupt payload — BG-64) — it must be
 * surfaced to the caller (live path) or dead-lettered (replay), never left in
 * the queue. Everything else (connection errors, timeouts, TRPC
 * INTERNAL_SERVER_ERROR) is TRANSIENT — CHỐNG SIẾT QUÁ: không đụng ranh giới
 * này, xếp nhầm một lỗi kết nối thành vĩnh viễn là MẤT BO khi DB chỉ chớp nháy.
 */
export function isPermanentSubmitError(err: unknown): boolean {
  if (err instanceof TRPCError && PERMANENT_TRPC_CODES.has(err.code)) return true;
  if (isPermanentDbSqlState(err)) return true;
  return isPermanentPayloadShapeError(err);
}

// ── file mirror (append-only JSONL rewrite; memory is the truth) ─────────────

let fileDirty = false;

function entryToLine(e: WalEntry): string {
  // BG-66: `lanHongDauMs` đi kèm khi có (JSON.stringify tự bỏ field `undefined`) — một mục
  // CHƯA từng hỏng qua backfill không ghi field này xuống đĩa, giữ đúng "không có đồng hồ chạy".
  return JSON.stringify({
    key: e.key,
    enqueuedAt: e.enqueuedAt,
    attempts: e.attempts,
    lanHongDauMs: e.lanHongDauMs,
    payload: e.payload,
  });
}

async function flushFile(): Promise<void> {
  if (!fileDirty) return;
  fileDirty = false;
  const file = walFile();
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const lines = queue.map(entryToLine).join("\n");
    await fs.writeFile(file, lines.length ? lines + "\n" : "", "utf8");
  } catch (err) {
    fileDirty = true; // retry on next flush; memory remains the source of truth
    console.warn("[InspectionSF] WAL file flush failed:", (err as Error)?.message || err);
  }
}

/** Restore the buffer from the WAL file mirror (call once on process start). */
export async function restoreInspectionWal(): Promise<number> {
  let raw: string;
  try {
    raw = await fs.readFile(walFile(), "utf8");
  } catch {
    return queue.length; // no file yet
  }
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      const parsed = JSON.parse(t) as {
        key?: string;
        enqueuedAt?: number;
        attempts?: number;
        lanHongDauMs?: number;
        payload?: BufferedSubmission;
      };
      if (!parsed.payload) continue;
      const key =
        typeof parsed.key === "string" ? parsed.key : dungKhoaGuiTheoHinhDang(parsed.payload);
      if (queuedKeys.has(key) || appliedKeys.has(key)) continue;
      const bytes = t.length;
      // BG-66: khôi phục `lanHongDauMs` NGUYÊN VĂN (không suy ra từ `enqueuedAt`) — một mục
      // đang kẹt thật (đã hỏng nhiều lần trước khi tiến trình dừng) giữ đúng đồng hồ của nó
      // qua restart; một mục CHƯA từng hỏng (field vắng mặt trên đĩa) khôi phục `undefined`.
      queue.push({
        key,
        enqueuedAt: parsed.enqueuedAt ?? Date.now(),
        attempts: parsed.attempts ?? 0,
        lanHongDauMs: typeof parsed.lanHongDauMs === "number" ? parsed.lanHongDauMs : undefined,
        bytes,
        payload: parsed.payload,
      });
      queuedKeys.add(key);
      queueBytes += bytes;
    } catch {
      /* skip corrupt line */
    }
  }
  if (queue.length > 0) {
    console.warn(`[InspectionSF] restored ${queue.length} buffered inspection submission(s) from WAL`);
  }
  return queue.length;
}

// ── applied ledger ────────────────────────────────────────────────────────────

export function markSubmissionApplied(key: string): void {
  if (appliedKeys.has(key)) return;
  appliedKeys.add(key);
  appliedOrder.push(key);
  if (appliedOrder.length > APPLIED_LEDGER_MAX) {
    const evict = appliedOrder.splice(0, appliedOrder.length - APPLIED_LEDGER_MAX);
    for (const k of evict) appliedKeys.delete(k);
  }
}

export function isSubmissionQueuedOrApplied(key: string): boolean {
  return queuedKeys.has(key) || appliedKeys.has(key);
}

// ── eviction (bounded, counted, warned — never silent) ───────────────────────

function dropFront(reason: "age" | "overflow" | "bytes"): void {
  const e = queue.shift();
  if (!e) return;
  queuedKeys.delete(e.key);
  queueBytes -= e.bytes;
  fileDirty = true;
  if (reason === "age") metrics.droppedAge += 1;
  else if (reason === "overflow") metrics.droppedOverflow += 1;
  else metrics.droppedBytes += 1;
}

function evictAged(): void {
  const cutoff = Date.now() - maxAgeMs();
  let dropped = 0;
  while (queue.length > 0 && queue[0].enqueuedAt < cutoff) {
    dropFront("age");
    dropped += 1;
  }
  if (dropped > 0) {
    console.warn(`[InspectionSF] dropped ${dropped} submission(s) past max age (total aged-drop=${metrics.droppedAge})`);
  }
}

function evictBounds(): void {
  let dropped = 0;
  while (queue.length > maxEntries()) {
    dropFront("overflow");
    dropped += 1;
  }
  let droppedBytes = 0;
  while (queue.length > 1 && queueBytes > maxBytes()) {
    dropFront("bytes");
    droppedBytes += 1;
  }
  if (dropped > 0 || droppedBytes > 0) {
    console.warn(
      `[InspectionSF] BUFFER OVERFLOW — dropped ${dropped + droppedBytes} oldest submission(s) ` +
        `(cap=${maxEntries()} entries / ${maxBytes()} bytes; total overflow-drop=${metrics.droppedOverflow + metrics.droppedBytes})`,
    );
  }
}

let lastDepthAlertAt = 0;

function maybeAlertDepth(): void {
  if (queue.length < alertDepth()) return;
  const now = Date.now();
  if (now - lastDepthAlertAt < 5 * 60 * 1000) return;
  lastDepthAlertAt = now;
  console.error(
    `[InspectionSF] ALERT — inspection WAL depth ${queue.length} ≥ ${alertDepth()} ` +
      `(bytes≈${queueBytes}). DB has been unreachable for a while; investigate before the buffer bounds evict data.`,
  );
}

let lastDeadLetterAlertAt = 0;

/**
 * BG-40 vòng sửa 2, mục 4 (C-1 review) — dead-letter CHƯA có giao diện nào hiển thị
 * (BG-36, đang mở): review đo THẬT trên máy này — `data/inspection-store-forward.dead.jsonl`
 * có 101 mục, 7,4 MB, tất cả "UNAUTHORIZED: Invalid API key", KHÔNG ai chạm suốt 6 TUẦN.
 * WARN định kỳ (tối đa 1 lần/5 phút, cùng nhịp `maybeAlertDepth`) khi còn dead-letter
 * TRONG PHIÊN CHẠY hiện tại (`metrics.deadLettered` là bộ đếm in-memory, RESET khi tiến
 * trình khởi động lại — đây KHÔNG phải cảnh báo bền vững qua nhiều phiên). Một giao diện
 * đọc trực tiếp `deadLetterFile()` (đếm dòng, không cần tải cả file vào RAM) vẫn là việc
 * CHƯA làm — BG-36 còn mở, cố tình KHÔNG giả vờ đã đóng ở đây.
 */
function maybeAlertDeadLetter(): void {
  if (metrics.deadLettered === 0) return;
  const now = Date.now();
  if (now - lastDeadLetterAlertAt < 5 * 60 * 1000) return;
  lastDeadLetterAlertAt = now;
  console.error(
    `[InspectionSF] ALERT — ${metrics.deadLettered} submission(s) đã dead-letter kể từ lúc tiến trình khởi ` +
      `động (file=${deadLetterFile()}). CHƯA có giao diện nào hiển thị các mục này (BG-36, đang mở) — kiểm ` +
      `tra thủ công.`,
  );
}

// ── enqueue ───────────────────────────────────────────────────────────────────

/**
 * Buffer a submission that could not be persisted. Idempotent: a payload whose
 * key is already queued (machine-side retry while DB is down) or already applied
 * returns `duplicate: true` without a second entry. No-op when the flag is off.
 */
export async function bufferSubmission(
  payload: BufferedSubmission,
): Promise<{ buffered: boolean; duplicate: boolean; key: string }> {
  const key = dungKhoaGuiTheoHinhDang(payload);
  if (!inspectionStoreForwardEnabled()) return { buffered: false, duplicate: false, key };
  evictAged();
  if (queuedKeys.has(key) || appliedKeys.has(key)) {
    return { buffered: false, duplicate: true, key };
  }
  const line = JSON.stringify({ key, enqueuedAt: Date.now(), attempts: 0, payload });
  const entry: WalEntry = { key, enqueuedAt: Date.now(), attempts: 0, bytes: line.length, payload };
  queue.push(entry);
  queuedKeys.add(key);
  queueBytes += entry.bytes;
  metrics.buffered += 1;
  metrics.lastBufferedAt = new Date().toISOString();
  fileDirty = true;
  evictBounds();
  await flushFile();
  const stillQueued = queuedKeys.has(key);
  console.warn(
    `[InspectionSF] buffered inspection submission (serial=${payload.serialNumber}, key=${key.slice(0, 12)}…); ` +
      `queue=${queue.length} bytes≈${queueBytes}${stillQueued ? "" : " (immediately evicted by bounds!)"}`,
  );
  maybeAlertDepth();
  return { buffered: stillQueued, duplicate: false, key };
}

// ── dead-letter ───────────────────────────────────────────────────────────────

async function deadLetter(entry: WalEntry, err: unknown): Promise<void> {
  metrics.deadLettered += 1;
  const line = JSON.stringify({
    key: entry.key,
    deadAt: new Date().toISOString(),
    attempts: entry.attempts,
    error: err instanceof Error ? `${(err as TRPCError).code ?? err.name}: ${err.message}` : String(err),
    payload: entry.payload,
  });
  try {
    await fs.mkdir(path.dirname(deadLetterFile()), { recursive: true });
    await fs.appendFile(deadLetterFile(), line + "\n", "utf8");
  } catch (e) {
    console.error("[InspectionSF] dead-letter append failed:", (e as Error)?.message || e);
  }
  console.error(
    `[InspectionSF] DEAD-LETTERED submission ${entry.key.slice(0, 12)}… (serial=${entry.payload.serialNumber}): ` +
      `${err instanceof Error ? err.message : err} → ${deadLetterFile()}`,
  );
}

type KetQuaXuLyLoiPhatLai = "deadLetter" | "conKet";

/**
 * ── 2026-08-30 (BG-40 vòng sửa 2) — MỘT ĐƯỜNG XỬ LÝ LỖI DÙNG CHUNG CHO CẢ `processFn`
 * VÀ `dedupFn` ──────────────────────────────────────────────────────────────────────
 * C-2 (review): nhánh `dedupFn` ném lỗi TRƯỚC ĐÂY `break` cả vòng với lý do "DB tự nó
 * hỏng, dùng chung cho mọi mục" — SAI: `dedupFn` có thể ném vì lý do RIÊNG của MỘT
 * payload (v1.x: `inspectionTime` rác ⇒ `new Date()` invalid ⇒ `RangeError`; v2.0:
 * `laHinhDangCayV2` chỉ hỏi `Array.isArray(surfaces)` ⇒ true cho payload thiếu
 * `identity` ⇒ `dungKhoaKhuTrungV2` huỷ tay). Không phân biệt được rẻ giữa "DB hỏng
 * chung" và "payload này hỏng riêng" ⇒ coi như hỏng RIÊNG (an toàn hơn: mục sau vẫn
 * chạy) — nên `dedupFn` ném lỗi nay đi ĐÚNG con đường mà `processFn` ném lỗi đã đi:
 * VĨNH VIỄN (`isPermanentSubmitError`) ⇒ dead-letter ngay, không tăng `attempts`;
 * ngược lại ⇒ tăng `attempts` (chỉ để quan sát/log) rồi dead-letter NẾU đã kẹt quá
 * `maxStuckMs()` kể từ LẦN HỎNG ĐẦU TIÊN (`lanHongDauMs` — BG-66, KHÔNG còn tính từ
 * lúc xếp hàng), còn chưa thì vẫn ở lại — người gọi (vòng `backfillInspections`)
 * chịu trách nhiệm KHÔNG `break`, thử mục kế tiếp.
 */
async function xuLyLoiPhatLai(entry: WalEntry, err: unknown): Promise<KetQuaXuLyLoiPhatLai> {
  if (isPermanentSubmitError(err)) {
    await deadLetter(entry, err);
    return "deadLetter";
  }

  entry.attempts += 1;
  // BG-66 ⛔ — mốc "kẹt" là LẦN HỎNG ĐẦU TIÊN qua backfill, KHÔNG phải `enqueuedAt`. Một mục
  // nằm hàng đợi lâu nhưng CHƯA TỪNG được thử (`lanHongDauMs` còn `undefined`) không có đồng
  // hồ nào chạy cho tới NGAY LÚC NÀY — set một lần, không dịch chuyển ở các lần hỏng sau.
  if (entry.lanHongDauMs === undefined) {
    entry.lanHongDauMs = Date.now();
  }
  fileDirty = true;

  const tuoiMs = Date.now() - entry.lanHongDauMs;
  if (tuoiMs >= maxStuckMs()) {
    const gioKet = (maxStuckMs() / 3_600_000).toFixed(1);
    console.warn(
      `[InspectionSF] mục KẸT QUÁ ${gioKet}h liên tục (kể từ LẦN HỎNG ĐẦU TIÊN, không phải lúc ` +
        `xếp hàng — BG-66) (key=${entry.key.slice(0, 12)}…, serial=${entry.payload.serialNumber}, ` +
        `đã thử ${entry.attempts} lượt) — chuyển dead-letter thay vì đệm vô thời hạn`,
    );
    await deadLetter(
      entry,
      new Error(
        `kẹt quá ${gioKet}h liên tục kể từ lần hỏng đầu tiên (đã thử ${entry.attempts} lượt) — lỗi ` +
          `gần nhất: ${(err as Error)?.message || err}`,
      ),
    );
    return "deadLetter";
  }

  console.warn(
    `[InspectionSF] backfill still failing (attempt ${entry.attempts}, key=${entry.key.slice(0, 12)}…): ` +
      `${(err as Error)?.message || err} — giữ trong hàng đợi, thử mục kế tiếp (không chặn đầu hàng)`,
  );
  return "conKet";
}

// ── backfill (replay oldest-first through the real pipeline, idempotent) ─────

let draining = false;
/** BG-67 ⛔ — con trỏ quét XOAY VÒNG, nhớ giữa các tick (xem `maxScanPerTick`). Chỉ số vào
 * mảng `queue` HIỆN TẠI tại thời điểm tick TIẾP THEO bắt đầu — không phải chỉ số "tuyệt đối"
 * bất biến (mảng co/giãn giữa các tick do enqueue/dead-letter/drain), nên được lấy `% queue.length`
 * mỗi lần dùng. Mục đích DUY NHẤT: khi `maxScanPerTick() < queue.length`, tick SAU tiếp tục
 * quét từ chỗ tick TRƯỚC dừng thay vì luôn bắt đầu lại từ đầu mảng — nếu không, những mục ở
 * ĐUÔI hàng đợi không bao giờ được chạm (đúng lỗi C-1 đã bắt ở vòng 1 dưới tên "trần đếm-lượt",
 * tái diễn dưới tên "trần quét" nếu thiếu con trỏ này). */
let scanCursor = 0;

export async function backfillInspections(): Promise<{
  enabled: boolean;
  drained: number;
  deduped: number;
  deadLettered: number;
  remaining: number;
}> {
  if (!inspectionStoreForwardEnabled()) {
    return { enabled: false, drained: 0, deduped: 0, deadLettered: 0, remaining: queue.length };
  }
  if (draining) {
    return { enabled: true, drained: 0, deduped: 0, deadLettered: 0, remaining: queue.length };
  }
  draining = true;
  evictAged();
  let drained = 0;
  let deduped = 0;
  let deadLettered = 0;
  try {
    let budget = drainBatch();
    // ── BG-40 việc 3 + vòng sửa 2 (C-1) — quét THEO CHỈ SỐ, `budget` CHỈ giảm khi có
    // CÔNG VIỆC THẬT ─────────────────────────────────────────────────────────────────
    // Vòng 1: `budget` giảm ở MỌI nhánh kể cả tạm-thời — review BÁC BỎ bằng phép đo
    // thật: 200 mục CÙNG lỗi tạm thời, `drainBatch()`=50 ⇒ chỉ 50 mục ĐẦU hàng mỗi tick
    // được tăng `attempts` (150 mục sau đứng ở 0 vĩnh viễn), rồi 50 mục đó chạm trần
    // đếm-lượt và bị dead-letter VÌ MỘT LỖI THUẦN TẠM THỜI (đo: 25 lượt ⇒
    // `deadLettered=50, chưa-thử=100`). Sửa: `budget` nay CHỈ giảm khi một mục bị GỠ
    // khỏi hàng đợi vì có kết quả THẬT (thành công HOẶC dead-letter) — mục còn tạm-thời
    // (ở lại hàng đợi) KHÔNG tốn ngân sách. `budget` vẫn có tác dụng: giới hạn số THAO
    // TÁC CÓ TÁC DỤNG PHỤ THẬT (ghi DB thành công / ghi file dead-letter) mỗi tick,
    // tránh dồn cục một lượt phục hồi lớn — đúng mục đích ban đầu của nó.
    //
    // ── BG-67 ⛔ — TRẦN QUÉT (`maxScanPerTick`) TÁCH KHỎI `budget` ──────────────────────
    // Vòng sửa 2 làm `budget` hết còn chặn số mục ĐƯỢC CHẠM (chỉ chặn số mục CÓ HẬU QUẢ)
    // ⇒ với một hàng đợi TOÀN lỗi tạm thời, vòng quét đi hết `queue.length` — 20.000 mục
    // = 40.000 lời gọi DB MỘT TICK (đo THẬT, xem docblock đầu file). `gioiHanQuet` chặn
    // TỔNG SỐ MỤC được chạm (`daQuet`) mỗi tick, không phân biệt có hậu quả hay không —
    // ĐỘC LẬP với `budget`. `i` bắt đầu từ `scanCursor` (không phải luôn từ 0) và XOAY
    // VÒNG (`% queue.length`) để tick sau tiếp tục đúng chỗ tick trước dừng — nếu không,
    // với `maxScanPerTick() < queue.length`, các mục ở ĐUÔI hàng đợi (append liên tục ở
    // cuối mảng) sẽ KHÔNG BAO GIỜ được chạm — tái diễn đúng lỗi đói-hàng-đuôi C-1 dưới
    // một cái tên khác.
    // `Math.min(..., queue.length)` — KHÔNG chỉ `maxScanPerTick()` trần: nếu hàng đợi NHỎ
    // HƠN trần quét (vd 200 mục, trần mặc định 2.000), thiếu điều kiện này con trỏ xoay
    // vòng sẽ LẶP LẠI quanh cùng những mục đó nhiều lần TRONG MỘT TICK cho tới khi chạm
    // `gioiHanQuet` — biến MỘT tick thành N tick dồn lại (tăng `attempts` nhiều lần oan cho
    // cùng một lượt gọi `backfillInspections()`, tự đo bắt được: 1 mục, trần mặc định 2.000
    // ⇒ `attempts` nhảy thẳng lên 2.000 sau đúng MỘT lượt gọi thay vì 1). Chốt tại kích
    // thước hàng đợi LÚC BẮT ĐẦU tick — mục mới enqueue xen giữa (bufferSubmission gọi
    // đồng thời) đợi tick sau, không cần quét ngay trong tick đang chạy.
    const gioiHanQuet = Math.min(maxScanPerTick(), queue.length);
    let daQuet = 0;
    let i = queue.length > 0 ? scanCursor % queue.length : 0;
    while (daQuet < gioiHanQuet && budget > 0 && queue.length > 0) {
      if (i >= queue.length) i = 0; // mảng vừa co lại (removeAt) — vòng lại đầu mảng
      const entry = queue[i];
      daQuet += 1;

      // (a) ledger dedupe — live path already persisted it (or a prior replay did).
      if (appliedKeys.has(entry.key)) {
        removeAt(i, entry);
        deduped += 1;
        continue;
      }

      // (b) DB existence dedupe — BG-40 vòng sửa 2 (C-2): KHÔNG còn `break` khi
      // `dedupFn` ném — xử lý qua `xuLyLoiPhatLai` GIỐNG HỆT nhánh `processFn` bên
      // dưới (xem doc-comment tại `xuLyLoiPhatLai`).
      let exists = false;
      try {
        exists = await dedupFn(entry.payload);
      } catch (err) {
        const ket = await xuLyLoiPhatLai(entry, err);
        if (ket === "deadLetter") {
          removeAt(i, entry);
          deadLettered += 1;
          budget -= 1;
        } else {
          i += 1;
        }
        continue;
      }
      if (exists) {
        markSubmissionApplied(entry.key);
        removeAt(i, entry);
        deduped += 1;
        continue;
      }

      try {
        // Task 5 (BG-99) — mốc XẾP HÀNG của MỤC NÀY, không phải đồng hồ lúc phát lại
        // (xem docblock `ProcessFn`).
        await processFn(entry.payload, { enqueuedAt: new Date(entry.enqueuedAt) });
      } catch (err) {
        const ket = await xuLyLoiPhatLai(entry, err);
        if (ket === "deadLetter") {
          removeAt(i, entry);
          deadLettered += 1;
          budget -= 1;
        } else {
          i += 1;
        }
        continue;
      }

      markSubmissionApplied(entry.key);
      removeAt(i, entry);
      drained += 1;
      budget -= 1;
    }
    // BG-67: lưu vị trí cho tick sau — `% queue.length` phòng thủ (queue có thể rỗng đúng
    // lúc dừng, hoặc co lại đúng bằng `i`).
    scanCursor = queue.length > 0 ? i % queue.length : 0;
  } finally {
    draining = false;
  }

  if (drained > 0) {
    metrics.backfilled += drained;
    metrics.lastBackfillAt = new Date().toISOString();
  }
  if (deduped > 0) metrics.deduped += deduped;
  if (drained > 0 || deduped > 0 || deadLettered > 0) {
    await flushFile();
    console.log(
      `[InspectionSF] backfilled ${drained} submission(s) (${deduped} deduped, ${deadLettered} dead-lettered); queue=${queue.length}`,
    );
  } else {
    await flushFile(); // persist attempt counters
  }
  maybeAlertDeadLetter();
  return { enabled: true, drained, deduped, deadLettered, remaining: queue.length };
}

/**
 * Gỡ mục tại chỉ số `i` khỏi hàng đợi (BG-40 việc 3 — thay `removeHead`/`queue.shift()`
 * vì vòng rút nay quét theo chỉ số, không neo cứng vào đầu mảng). `splice` giữ nguyên
 * thứ tự tương đối của các mục còn lại — mục kế thừa tự trượt vào đúng chỉ số `i`.
 */
function removeAt(i: number, expected: WalEntry): void {
  if (queue[i] !== expected) return; // phòng thủ — không xảy ra khi rút đơn luồng
  queue.splice(i, 1);
  queuedKeys.delete(expected.key);
  queueBytes -= expected.bytes;
  fileDirty = true;
}

// ── background worker (interval + exponential backoff while the DB is down) ──

let workerTimer: NodeJS.Timeout | null = null;
let consecutiveFailures = 0;

function baseIntervalMs(): number {
  return envInt("INSPECTION_STORE_FORWARD_INTERVAL_MS", 15000);
}
function maxIntervalMs(): number {
  return envInt("INSPECTION_STORE_FORWARD_MAX_INTERVAL_MS", 5 * 60 * 1000);
}

async function workerTick(): Promise<void> {
  workerTimer = null;
  try {
    const r = await backfillInspections();
    // Backoff only while there IS work that cannot drain (DB still down).
    consecutiveFailures = r.remaining > 0 && r.drained === 0 && r.deduped === 0 && r.deadLettered === 0
      ? consecutiveFailures + 1
      : 0;
  } catch (err) {
    consecutiveFailures += 1;
    console.warn("[InspectionSF] backfill worker tick failed:", (err as Error)?.message || err);
  }
  scheduleNext();
}

function scheduleNext(): void {
  if (workerTimer) return;
  const delay = Math.min(baseIntervalMs() * Math.pow(2, Math.min(consecutiveFailures, 6)), maxIntervalMs());
  workerTimer = setTimeout(() => void workerTick(), delay);
  workerTimer.unref?.();
}

/** Start the periodic backfill worker (idempotent; no-op when the flag is off). */
export function startInspectionBackfillWorker(): void {
  if (!inspectionStoreForwardEnabled() || workerTimer) return;
  scheduleNext();
  console.log(
    `[InspectionSF] backfill worker started (interval=${baseIntervalMs()}ms, WAL=${walFile()}, ` +
      `bounds=${maxEntries()} entries/${maxBytes()} bytes/${maxAgeMs()}ms)`,
  );
}

export function stopInspectionBackfillWorker(): void {
  if (workerTimer) {
    clearTimeout(workerTimer);
    workerTimer = null;
  }
}

/**
 * One-call startup init (wired from server bootstrap): binds the REAL submit
 * pipeline + dedup check (dynamic import → no module-load cycle), restores the
 * WAL from disk, starts the worker. Safe no-op when the flag is off.
 *
 * ── 2026-08-29 (WAL cho cây v2.0, Task 3 hotfix) — GỌI CHUNG `ensureInspectionWalWired`,
 * KHÔNG TỰ CHÉP LẠI PHÉP DISPATCH ─────────────────────────────────────────────────────────
 * TRƯỚC bản vá này, hàm này tự `setProcessFn`/`setDedupFn` thẳng vào
 * `processInspectionSubmission`/`inspectionAlreadyPersisted` (v1.x CỨNG) — một BẢN THỨ HAI của
 * phép dispatch, độc lập với `ensureInspectionWalWired` (`machineApiRouters.ts`, dispatch THEO
 * HÌNH DẠNG mà Task 2 dựng cho đường LIVE). Vì hàm này chạy Ở BOOT — TRƯỚC bất kỳ lượt
 * `submitInspection` LIVE nào (lượt live là nơi DUY NHẤT trước đây gọi
 * `ensureInspectionWalWired`) — một mục v2.0 còn trên đĩa từ trước khi khởi động lại có thể bị
 * `backfillInspections()` rút qua ĐÚNG đường v1.x này TRƯỚC KHI có lượt live nào kịp rewire lại
 * cho đúng: ghi được header rồi ÂM THẦM bỏ mất cả ba cấp cây — TÁI DIỄN đúng lớp lỗi §QĐ-WAL-B
 * (Task 2 đã đóng ở đường live) qua cửa BOOT. `.env` của repo này đặt
 * `INSPECTION_STORE_FORWARD_ENABLED=true` — không phải rủi ro chỉ-trên-giấy (phát hiện bởi
 * `ghiInspectionWalScan.ts`/`ghiInspectionWalCensus.test.ts`, Task 3).
 *
 * Sửa bằng cách gọi THẲNG `ensureInspectionWalWired()` (nay export) — MỘT điểm điều phối duy
 * nhất cho CẢ HAI đường (boot và live), đúng kỷ luật đã nêu ở docblock của hàm đó. Mệnh đề BOOT
 * (không gọi live trước khi gọi hàm này) canh ở `server/db/walCayV2PhatLai.db.test.ts`.
 */
export async function initInspectionStoreForward(): Promise<void> {
  if (!inspectionStoreForwardEnabled()) return;
  const router = await import("../../routers/machineApiRouters");
  router.ensureInspectionWalWired();
  await restoreInspectionWal();
  startInspectionBackfillWorker();
}

// ── status ────────────────────────────────────────────────────────────────────

export interface InspectionStoreForwardStatus extends InspectionStoreForwardMetrics {
  enabled: boolean;
  bufferedCount: number;
  bufferedBytes: number;
  maxEntries: number;
  maxAgeMs: number;
  maxBytes: number;
  /** BG-40 vòng sửa 2 — trần THỜI GIAN (ms) kẹt liên tục kể từ LẦN HỎNG ĐẦU TIÊN (BG-66)
   * trước khi dead-letter một mục còn tạm thời (không phải trần đếm lượt, không còn tính
   * từ lúc xếp hàng — xem doc-comment ở `maxStuckMs()`). */
  maxStuckMs: number;
  /** BG-67 — trần SỐ MỤC được chạm (dedupFn/processFn) mỗi tick, TÁCH khỏi `budget`
   * (trần thao-tác-CÓ-HẬU-QUẢ, không lộ ra status vì đã có sẵn qua hành vi `drained+
   * deadLettered`). Xem doc-comment ở `maxScanPerTick()`. */
  maxScanPerTick: number;
  walFile: string;
  deadLetterFile: string;
}

export function getInspectionStoreForwardStatus(): InspectionStoreForwardStatus {
  return {
    enabled: inspectionStoreForwardEnabled(),
    bufferedCount: queue.length,
    bufferedBytes: queueBytes,
    maxEntries: maxEntries(),
    maxAgeMs: maxAgeMs(),
    maxBytes: maxBytes(),
    maxStuckMs: maxStuckMs(),
    maxScanPerTick: maxScanPerTick(),
    walFile: walFile(),
    deadLetterFile: deadLetterFile(),
    ...metrics,
  };
}

export function bufferedInspectionCount(): number {
  return queue.length;
}

// ── test / maintenance helpers ────────────────────────────────────────────────

export function _resetInspectionStoreForward(): void {
  stopInspectionBackfillWorker();
  queue.length = 0;
  queuedKeys.clear();
  queueBytes = 0;
  appliedKeys.clear();
  appliedOrder.length = 0;
  metrics.buffered = 0;
  metrics.backfilled = 0;
  metrics.deduped = 0;
  metrics.deadLettered = 0;
  metrics.droppedOverflow = 0;
  metrics.droppedAge = 0;
  metrics.droppedBytes = 0;
  metrics.lastBackfillAt = null;
  metrics.lastBufferedAt = null;
  fileDirty = false;
  draining = false;
  scanCursor = 0;
  consecutiveFailures = 0;
  lastDepthAlertAt = 0;
  processFn = async () => {
    throw new Error("[InspectionSF] process fn not wired (call setProcessFn)");
  };
  dedupFn = async () => false;
}
