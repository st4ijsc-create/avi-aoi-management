/**
 * ★★★ Pha 3 Task 2 — NỬA **BẤT ĐỒNG BỘ** của sổ chung: thi hành lượt ghi, rồi làm mới bản sao đọc.
 *
 * Cặp với `vramSharedLedger.ts` (nửa ĐỒNG BỘ, module lá). Tách hai file là **điều kiện**, không
 * phải gọn gàng — xem khối docstring ở đó: `vramBroker` đọc ô lá trên đường quyết định, nên ô lá
 * không được kéo theo một dòng I/O nào.
 *
 * ⚠⚠ HÀM NÀY **KHÔNG BAO GIỜ NÉM** ra ngoài. Nó chạy ở hai chỗ:
 *   • nhịp reconciler 60 s (`vramReconciler.__runReconcileTick()`) — ném ở đó là đánh hỏng cả nhịp
 *     đối chiếu, tức đổi một lỗi sổ chung lấy một lỗi cưỡng chế;
 *   • ngay sau một lượt ghi cục bộ (`scheduleSharedLedgerSync()`) — ném ở đó là một
 *     `unhandledRejection` giết tiến trình dưới `--unhandled-rejections=strict`.
 * Hỏng thì **ĐẾM + KÊU + GIỮ Ý ĐỊNH GHI ĐỂ THỬ LẠI**, không nuốt im lặng (ca C-1/C-2/C-3).
 *
 * ⚠ `getDb()` trả `null` (test không cấu hình DB, cài đặt không DB) ⇒ **KHÔNG phải một lượt hỏng**:
 * hệ chạy như Pha 2B (mỗi tiến trình một sổ), bản sao đọc giữ nguyên `null` ⇒ đường quyết định
 * thấy `"shared-ledger-unasked"` và **chặt hơn**. Đó là chiều đúng: không có sổ chung thì không
 * được giả vờ là có.
 */
import {
  SHARED_BASELINE_KEY, drainSharedLedgerWrites, noteSharedLedgerSyncFailure, ownSharedBaseline,
  publishSharedLedgerReplica, noteSharedLedgerWritesApplied, requeueSharedLedgerWrites,
  rowFromBaseline, rowFromLease, sharedLedgerSelfKey, sharedLedgerUnsyncedCount,
} from "./vramSharedLedger";
import type { SharedLeaseRow, SharedLedgerWrite } from "./vramSharedLedger";

/**
 * BIÊN CỦA THẾ GIỚI NGOÀI. Cùng hạng với `fs`/`child_process`/`fetch` mà bộ test Pha 2B đã giả:
 * một cổng hẹp, hai phương thức, không rò chi tiết Drizzle ra ngoài.
 */
export interface SharedLedgerGateway {
  /** Áp một LÔ ý định ghi. Ném ⇒ cả lô coi như CHƯA ghi (người gọi trả lại hàng đợi). */
  apply(writes: readonly SharedLedgerWrite[]): Promise<void>;
  /** Đọc toàn bộ sổ chung. Ném ⇒ bản sao đọc GIỮ NGUYÊN số cũ (không về null). */
  selectAll(): Promise<readonly SharedLeaseRow[]>;
}

let gatewayOverride: SharedLedgerGateway | null = null;
let daKeuHong = false;
let dangDongBo: Promise<void> | null = null;
let henGio: NodeJS.Timeout | null = null;
let batDongBo = false;

/** Chỉ dùng trong test — cắm một bảng `vram_leases` giả. `null` ⇒ về gateway THẬT. */
export function __setSharedLedgerGatewayForTests(g: SharedLedgerGateway | null): void {
  gatewayOverride = g;
  daKeuHong = false;
}

/**
 * ★★★ MỘT LƯỢT ĐỒNG BỘ: **GHI TRƯỚC, ĐỌC SAU**, và thứ tự đó là một điều kiện.
 *
 * Đọc trước rồi ghi sau thì bản sao đọc vừa xuất bản đã **thiếu chính lượt ghi vừa rồi** — tức
 * tiến trình này tự làm mình mù về chính mình trong một chu kỳ.
 *
 * ⚠ **CHỐNG CHẠY CHỒNG**: hai lượt gọi song song (nhịp 60 s + lượt hẹn sau một lần ghi) mà cùng
 * `drainSharedLedgerWrites()` sẽ chia đôi hàng đợi và lượt xuất bản sau có thể GHI ĐÈ bằng số cũ
 * hơn. Lượt thứ hai **dùng chung** promise của lượt đang chạy.
 */
export async function syncSharedLedger(): Promise<void> {
  if (dangDongBo) return dangDongBo;
  dangDongBo = chayCoHanGio().finally(() => {
    dangDongBo = null;
    /**
     * ★ M-4 (review vòng 1) — **TÁI VŨ TRANG NHỊP HẸN.** `scheduleSharedLedgerSync()` no-op khi có
     * hẹn đang chờ, và lượt hẹn đó tự xoá `henGio` **TRƯỚC** khi gọi ⇒ một ý định xếp hàng ngay
     * *sau* lúc lượt sync bắt đầu sẽ **lỡ cả lượt đang chạy lẫn lượt hẹn**, rồi **không ai hẹn
     * lại** ⇒ cửa sổ HÀNG MA thường gặp là **tới 60 s**, không phải 250 ms như §8.5 hàm ý.
     * ⇒ Xong một lượt mà hàng đợi vẫn còn ý định thì hẹn tiếp. Không phải vòng lặp bận: chỉ hẹn
     * khi THẬT SỰ còn việc, và `enqueue` gộp theo `leaseKey` nên hàng đợi hữu hạn.
     */
    if (batDongBo && sharedLedgerUnsyncedCount() > 0) scheduleSharedLedgerSync();
  });
  return dangDongBo;
}

/**
 * ★★★ I-1 (review vòng 1) — **HẠN GIỜ, VÌ "DB TREO" KHÁC "DB NÉM" VÀ TRƯỚC ĐÓ KHÔNG AI CANH.**
 *
 * Toàn bộ họ ca `C-*` mô phỏng hỏng bằng **NÉM**. Một lượt **TREO** (Postgres nhận TCP nhưng không
 * trả · pool 25 kết nối cạn nên câu truy vấn **xếp hàng trong JS**, nơi `statement_timeout` chưa
 * áp · `DB_STATEMENT_TIMEOUT_MS=0`) đi một đường hoàn toàn khác, và mọi cơ chế phòng vệ đều **im**:
 *
 *   1. không ai ném ⇒ `noteSharedLedgerSyncFailure()` **không chạy** ⇒ `consecutiveFailures` đứng
 *      `0` ⇒ nhánh `"shared-ledger-stale"` theo *"đang hỏng liên tiếp"* **không bật**;
 *   2. `keuMotLan()` **không chạy** ⇒ **không một dòng cảnh báo nào**;
 *   3. `dangDongBo` **không bao giờ** về `null` ⇒ **mọi** lượt sync sau đó — kể cả nhịp 60 s — trả
 *      lại đúng lời hứa treo ấy và **không làm gì**;
 *   4. ⇒ lệnh `delete` của `release()` nằm lại hàng đợi **VÔ THỜI HẠN** ⇒ anh em trừ dư địa cho
 *      7,8/17 GB **đã nhả**, vĩnh viễn. Đó đúng **HÀNG MA** mà ca `C-4` sinh ra để chống, qua một
 *      cửa `C-4` không đi qua.
 *
 * ⇒ Quá hạn được **ĐẾM NHƯ MỘT LƯỢT HỎNG** (`noteSharedLedgerSyncFailure()` + `keuMotLan()`), tức
 * chế độ TREO rơi vào đúng cơ chế mà `C-1`/`C-4` đã canh. Đây là toàn bộ ý nghĩa của lượt vá: không
 * phải "cho nhanh hơn" mà là **đưa một chế độ hỏng vô hình vào một đường đã có người canh**.
 *
 * ⚠ Lượt treo **KHÔNG bị huỷ** (không huỷ được một truy vấn đã bay). Ta chỉ thôi CHỜ nó. Nếu nó về
 * muộn, `.catch()` nuốt — và lượt sync kế tiếp dựng lại ý định ghi từ sổ CỤC BỘ nên không mất gì.
 */
async function chayCoHanGio(): Promise<void> {
  let hen: NodeJS.Timeout | null = null;
  const quaHan = new Promise<"qua-han">((resolve) => {
    hen = setTimeout(() => resolve("qua-han"), syncTimeoutMs());
    hen.unref?.();
  });
  try {
    const ketQua = await Promise.race([chayMotLuot().then(() => "xong" as const), quaHan]);
    if (ketQua === "qua-han") {
      keuMotLan(
        new Error(
          `lượt đồng bộ QUÁ HẠN ${syncTimeoutMs()} ms (DB TREO, không ném) — ý định ghi còn ` +
            `${sharedLedgerUnsyncedCount()} mục trong hàng đợi`,
        ),
      );
      noteSharedLedgerSyncFailure();
    }
  } catch {
    /* `chayMotLuot()` đã tự đếm + tự kêu ở mọi nhánh của nó */
  } finally {
    if (hen) clearTimeout(hen);
  }
}

/**
 * Hạn của MỘT lượt đồng bộ. Mặc định **120.000 ms = HAI chu kỳ nhịp** — cùng lý lẽ với
 * `TICK_STALE_AFTER_MS`: một chu kỳ chậm là bình thường, hai chu kỳ nghĩa là nguồn đã hỏng.
 * ⚠ Đọc `.env` MỖI lượt (không đóng băng lúc nạp module) — cùng khuôn `distrustUnitBytes()`.
 * ⚠ `?? <mặc_định>` là một DÂY: lưới của nó là ca `I-1b` (hạn RÁC ⇒ vẫn dùng mặc định, KHÔNG
 * thành một phép đo tức thời) — đúng bài học `stopWaitMs()` của Task 1.
 */
export function syncTimeoutMs(): number {
  const n = Number(process.env.VRAM_SHARED_LEDGER_SYNC_TIMEOUT_MS);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 120_000;
}

async function chayMotLuot(): Promise<void> {
  const selfKey = sharedLedgerSelfKey();
  const nowMs = Date.now();
  let gw: SharedLedgerGateway | null;
  try {
    gw = await layGateway();
  } catch (err) {
    keuMotLan(err);
    noteSharedLedgerSyncFailure();
    return;
  }
  // Không có DB ⇒ KHÔNG phải lượt hỏng: hệ chạy như Pha 2B, và bản sao đọc `null` làm hệ CHẶT HƠN.
  if (gw === null) return;

  /**
   * ★★★ Ý ĐỊNH GHI = SỔ CỤC BỘ, DỰNG LẠI MỖI LƯỢT — không chỉ là hàng đợi delta.
   *
   * ⚠ ĐÂY LÀ CHỖ TRẢ LỜI CA E-3: giấy phép của TA bị xoá khỏi bảng (một lượt dọn dẹp, một tiến
   * trình khác nhầm, một lượt mất kết nối giữa chừng) thì lượt đồng bộ sau **GHI LẠI**. Sổ CỤC BỘ
   * là chủ về giấy phép của chính tiến trình này; bảng chỉ là bản công bố.
   * ⚠ Và nó KHÔNG mâu thuẫn với "bằng chứng nhả phải là lượt ghi tường minh": lượt `delete` vẫn
   * đến từ `vramBroker.release()` (hàng đợi), và giấy phép đã nhả thì **không còn trong sổ cục bộ**
   * nên lượt dựng lại này không hồi sinh nó.
   */
  const hangDoi = drainSharedLedgerWrites();
  const xoa = hangDoi.filter((w) => w.op === "delete");
  const daXoa = new Set(xoa.map((w) => w.leaseKey));
  const tuSoCucBo = await dungLaiTuSoCucBo(selfKey, nowMs, daXoa);
  const writes: SharedLedgerWrite[] = [...xoa, ...tuSoCucBo];

  /**
   * ★★★ Pha 3 Task 3 — NHỊP SỐNG CỦA NGƯỜI CHỤP NỀN. Chỉ tiến trình đang GIỮ vai người chụp
   * (`ownSharedBaseline() !== null`) mới ghi hàng này, và nó ghi lại ở **MỌI** lượt đồng bộ.
   *
   * ⚠ `updatedAtMs` lấy `nowMs` của lượt này (không phải mốc chụp) — đó chính là nhịp sống: người
   * đọc đo tuổi hàng để biết **chủ nhân còn sống không**. Nếu ghi mốc chụp, một tiến trình chết
   * sau khi chụp sẽ để lại một hàng "mãi mãi mới" và không ai giành lại được vai người chụp.
   * ⚠ Đứng SAU `tuSoCucBo`: hai tập khoá rời nhau (`SHARED_BASELINE_KEY` không chứa `#`), nên thứ
   * tự không đổi kết quả — nhưng đặt cuối cho người đọc thấy ngay nó KHÔNG phải một giấy phép.
   */
  const nen = ownSharedBaseline();
  if (nen !== null) {
    // ★ Pha 6 Task 5 — hàng NỀN cũng đi qua cửa cắt-có-khai (`processKey` 96 · `role` 32).
    const { row, daCat } = rowFromBaseline({ ...nen, atMs: nowMs });
    writes.push({ op: "upsert", leaseKey: SHARED_BASELINE_KEY, row, daCat });
  }

  let ghiHong = false;
  if (writes.length > 0) {
    try {
      await gw.apply(writes);
      // ★ I-3 — ghi nhận CHỈ SAU khi lô đã lên thật: ô `byteDaGui` là thứ phân biệt "ý định đổi
      // byte" với "ý định lặp lại con số cũ". Ghi trước là khai "anh em đã thấy" cho một con số
      // còn nằm trong hàng đợi.
      noteSharedLedgerWritesApplied(writes);
    } catch (err) {
      // ⚠ TRẢ LẠI hàng đợi rồi mới kêu: một lượt ghi bị vứt để lại hàng MA (delete hỏng) hoặc làm
      // anh em tính THIẾU byte (upsert hỏng) — cả hai đều im lặng nếu không giữ ý định lại.
      requeueSharedLedgerWrites(writes);
      keuMotLan(err);
      noteSharedLedgerSyncFailure();
      ghiHong = true;
    }
  }

  /**
   * ⚠⚠ VẪN ĐỌC KỂ CẢ KHI GHI HỎNG, và đây là một ĐIỀU KIỆN chứ không phải một tối ưu.
   *
   * Bản đầu `return` ngay sau lượt ghi hỏng, và hậu quả đo được (ca C-1): ở một tiến trình **chưa
   * từng đọc thành công lần nào**, bản sao đọc đứng nguyên `null` ⇒ `sharedLedgerFact()` trả `null`
   * ⇒ ô `unsyncedWrites` **KHÔNG CÓ CHỖ NÀO ĐỂ HIỆN RA**. Cờ "chưa đồng bộ" tồn tại trong bộ nhớ mà
   * không một người đọc nào thấy — đúng nghĩa *"ghi hỏng IM LẶNG"* mà brief cấm.
   * (Hệ vẫn chặt hơn nhờ `"shared-ledger-unasked"`, nhưng nó nói SAI LÝ DO: "chưa hỏi" thay vì
   * "đã hỏi và DB đang từ chối ta".)
   *
   * ⚠ Hai chiều hỏng ĐỘC LẬP: một DB cho đọc mà từ chối ghi (quyền, bảng thiếu, đĩa đầy) là ca
   * THẬT — và ở đó đọc được vẫn tốt hơn mù.
   */
  try {
    const rows = await gw.selectAll();
    publishSharedLedgerReplica(rows, Date.now(), selfKey);
    // ⚠ `publishSharedLedgerReplica()` xoá chuỗi hỏng LIÊN TIẾP. Lượt ghi vẫn đang hỏng ⇒ đếm lại,
    // nếu không thì một lượt đọc trót lọt sẽ **xoá dấu vết** của một lượt ghi đang hỏng.
    if (ghiHong) noteSharedLedgerSyncFailure();
    else daKeuHong = false;
  } catch (err) {
    keuMotLan(err);
    noteSharedLedgerSyncFailure();
  }
}

/** Dựng lại ý định `upsert` cho MỌI giấy phép còn sống trong sổ cục bộ. */
async function dungLaiTuSoCucBo(
  selfKey: string,
  nowMs: number,
  daXoa: ReadonlySet<string>,
): Promise<SharedLedgerWrite[]> {
  // ⚠ Nhập MUỘN: `vramSharedLedgerStore` được `vramReconciler` nhập, còn `vramBroker` là module mà
  // 43 file test thay bằng bản giả. Một lượt nhập TĨNH `snapshot` ở đầu file kéo bản THẬT vào
  // những file đó (`leaseBytes` đã là nhập tĩnh vì nó thuần và bộ test giả `vramBroker` cũng khai).
  const { snapshot, leaseBytes } = await import("./vramBroker");
  const out: SharedLedgerWrite[] = [];
  for (const l of snapshot().leases) {
    if (l.released) continue;
    const key = `${selfKey}#${l.id}`;
    // Một lượt `delete` VỪA XẾP HÀNG thắng: giấy phép đó đang trên đường rời sổ.
    if (daXoa.has(key)) continue;
    // ★ Pha 6 Task 5 — điểm gọi THỨ HAI của `rowFromLease()`, và là điểm chạy **mỗi nhịp 60 s**:
    //   không mang `daCat` theo thì lời khai chết ngay ở đường đi thường xuyên nhất.
    const { row, daCat } = rowFromLease(l, leaseBytes(l), selfKey, nowMs);
    out.push({ op: "upsert", leaseKey: key, row, daCat });
  }
  return out;
}

let gatewayThat: SharedLedgerGateway | null | undefined;

async function layGateway(): Promise<SharedLedgerGateway | null> {
  if (gatewayOverride !== null) return gatewayOverride;
  if (gatewayThat !== undefined) return gatewayThat;
  /**
   * ⚠⚠ DƯỚI VITEST: **KHÔNG tự đi mở kết nối DB.** Đây là một hàng rào ĐO ĐƯỢC, không phải một
   * lượt né tránh:
   *
   *   • `__runReconcileTick()` chạy ở rất nhiều file test (bất cứ ca nào gọi `startVramReconciler`),
   *     và nhánh này kéo `server/db/connection` + drizzle + `pg` vào **đồ thị biến đổi của Vite**
   *     cho từng file đó. Đo được: 4/8 lượt `--sequence.shuffle.tests` ĐỎ ở
   *     `vramHeadroom.test.ts` với `AssertionError: expected null not to be null` tại
   *     `vi.waitFor(readLastReconcileTick() !== null)` — **hết 1.423 ms** trong khi nhịp lẽ ra
   *     xong sau vài mili giây. Nhật ký lượt đỏ có đúng dòng `[Database] Connecting to PostgreSQL`
   *     do chính nhánh này sinh ra.
   *   • Và đây đúng GOTCHA đã trả giá ở Đợt trước: *"`setInterval` unref'd của `aiGateway` RÒ vào
   *     bộ test, tự bắn, tự kết nối và **TỰ GHI VÀO DB TEST**"*. Một lượt ghi ngầm vào
   *     `aoi_management_test` từ một file test chẳng liên quan là thứ không ai gỡ được lúc 3 giờ sáng.
   *
   * ⚠ Hàng rào này **KHÔNG** làm cơ chế thành mã chết trong test: mọi ca thật sự canh sổ chung đều
   * **CẮM GATEWAY tường minh** (`__setSharedLedgerGatewayForTests`) và đi qua `gatewayOverride`
   * ngay dòng đầu — 25 ca của `sharedLedger*.test.ts` chạy hết đường thật trên một bảng dùng chung.
   * ⚠ ĐIỀU NÓ KHÔNG BẢO ĐẢM, và phải khai: **bản cài đặt Drizzle bên dưới KHÔNG có ca test nào**
   * (nó cũng chưa chạy được — bảng `vram_leases` chưa migrate). Xem §7 báo cáo Task 2.
   */
  if (process.env.VITEST) return null;
  const { getDb } = await import("../../db/connection");
  const db = await getDb();
  if (!db) return null; // ⚠ KHÔNG nhớ `null`: DB có thể lên sau. Nhớ là tự khoá mình ngoài sổ chung.
  const { vramLeases } = await import("../../../drizzle/schema/vram");
  const { inArray, sql } = await import("drizzle-orm");
  /** `excluded."<col>"` của `ON CONFLICT DO UPDATE` — một lượt `upsert` là một lượt ghi ĐÈ. */
  const sqlExcluded = (col: string) => sql.raw(`excluded."${col}"`);
  gatewayThat = {
    async apply(writes) {
      const xoa = writes.filter((w) => w.op === "delete").map((w) => w.leaseKey);
      if (xoa.length > 0) {
        // ⚠ `inArray()`, KHÔNG `sql\`col = ANY(${jsArray})\`` — cái sau cho 500 `42809`
        // (GOTCHA đã trả giá ở 10 điểm gọi, xem memory `drizzle-any-array-antipattern`).
        await db.delete(vramLeases).where(inArray(vramLeases.leaseKey, xoa));
      }
      const them = writes.flatMap((w) => (w.op === "upsert" ? [w.row] : []));
      if (them.length > 0) {
        await db
          .insert(vramLeases)
          .values(
            them.map((r) => ({
              leaseKey: r.leaseKey,
              processKey: r.processKey,
              pid: r.pid,
              role: r.role,
              leaseId: r.leaseId,
              owner: r.owner,
              leaseKind: r.leaseKind,
              priority: r.priority,
              bytes: r.bytes,
              measured: r.measured,
              refCount: r.refCount,
              reclaimer: r.reclaimer,
              acquiredAt: new Date(r.acquiredAtMs),
              updatedAt: new Date(r.updatedAtMs),
              /**
               * ★ Pha 7 Task 5 (B) — lời khai cắt danh tính **đi cùng hàng xuống DB**.
               * ⚠ `?? []` chứ **KHÔNG** `?? null`: hàng do **tiến trình NÀY** dựng luôn đi qua
               *   `rowFromLease`/`rowFromBaseline`, tức nó **luôn biết** — nên một `null` ở đây là
               *   không thể, và ghi `null` sẽ là tự khai "ta không biết" về chính lời khai của ta.
               *   `NULL` chỉ được sinh ra bởi một tiến trình **CŨ** (chưa có cột), và đó đúng là
               *   thứ `unknownIdentityRows` phải nhìn thấy.
               */
              identityTruncated: r.identityTruncated ?? [],
            })),
          )
          .onConflictDoUpdate({
            target: vramLeases.leaseKey,
            set: {
              /**
               * ★★★ Task 3 — BỐN CỘT DANH TÍNH PHẢI NẰM TRONG DANH SÁCH NÀY, và đây KHÔNG phải
               * "cho đủ": hàng `vram:baseline` là **một khoá DÙNG CHUNG giữa các tiến trình**, nên
               * một lượt CHUYỂN VAI người chụp là một lượt đổi `processKey`/`pid`/`role`/`leaseId`
               * trên đúng hàng đó. Thiếu chúng thì người chụp mới ghi được `bytes` nhưng bảng vẫn
               * khai chủ nhân CŨ ⇒ mọi tiến trình đọc thấy một chủ nhân đã chết ⇒ **không ai giành
               * lại được vai**, và cuộc bầu kẹt vĩnh viễn ở một hàng ma.
               * ⚠ Với GIẤY PHÉP thường thì bốn cột này nằm SẴN trong `leaseKey`
               * (`${processKey}#${leaseId}`) nên lượt ghi đè là **đồng nhất** — không đổi hành vi.
               * ⚠ `acquiredAt` CỐ Ý vắng mặt: nó là mốc GỐC, ghi đè nó là xoá dấu vết.
               */
              processKey: sqlExcluded("processKey"),
              pid: sqlExcluded("pid"),
              role: sqlExcluded("role"),
              leaseId: sqlExcluded("leaseId"),
              owner: sqlExcluded("owner"),
              bytes: sqlExcluded("bytes"),
              measured: sqlExcluded("measured"),
              refCount: sqlExcluded("refCount"),
              reclaimer: sqlExcluded("reclaimer"),
              updatedAt: sqlExcluded("updatedAt"),
              /**
               * ★ Pha 7 Task 5 (B) — **PHẢI có trong danh sách ghi đè.** Thiếu nó thì một hàng
               * từng bị cắt (đường dẫn model dài) rồi sau đó **hết bị cắt** (đổi sang thư mục
               * ngắn) vẫn mang lời khai CŨ vĩnh viễn — một cờ **luôn bật là một cờ không còn
               * thông tin**, đúng lớp nhiễu I-3 mà `demDanhTinhBiCat()` được viết ra để tránh.
               */
              identityTruncated: sqlExcluded("identityTruncated"),
            },
          });
      }
    },
    async selectAll() {
      const rows = await db.select().from(vramLeases);
      return rows.map((r) => ({
        leaseKey: r.leaseKey,
        processKey: r.processKey,
        pid: r.pid,
        role: r.role,
        leaseId: r.leaseId,
        owner: r.owner,
        leaseKind: r.leaseKind as SharedLeaseRow["leaseKind"],
        priority: r.priority as SharedLeaseRow["priority"],
        bytes: Number(r.bytes),
        measured: r.measured,
        refCount: r.refCount,
        reclaimer: (r.reclaimer ?? null) as SharedLeaseRow["reclaimer"],
        acquiredAtMs: r.acquiredAt.getTime(),
        updatedAtMs: r.updatedAt.getTime(),
        /**
         * ★★★ Pha 7 Task 5 (B) — **BA GIÁ TRỊ ĐI QUA ĐÂY NGUYÊN VẸN, KHÔNG ÉP VỀ HAI.**
         * ⚠⚠ `?? null` **KHÔNG** phải `?? []`: cột `NULL` nghĩa là *"người ghi hàng này chưa biết
         *   cột ấy"* — ép nó thành `[]` là khai **"đã kiểm, không cắt gì"** thay cho một tiến trình
         *   chưa từng nói câu đó. Đó đúng bằng việc đặt `DEFAULT '[]'` ở DDL, thứ chủ dự án đã
         *   duyệt là **KHÔNG làm**, chỉ dời chỗ nói dối từ DB lên đây.
         * ⚠ Lọc phần tử không phải chuỗi: cột là `jsonb` nên một hàng do tay người sửa có thể mang
         *   `{"a":1}` hay `[1,2]`. Giá trị lạ ⇒ **`null` (KHÔNG BIẾT)**, không phải `[]`.
         */
        identityTruncated: docCoCat(r.identityTruncated),
      }));
    },
  };
  return gatewayThat;
}

/**
 * ⚠ KÊU **MỘT LẦN** mỗi quãng hỏng, không mỗi lượt: nhịp 60 s × một bảng chưa có = một dòng
 * `console.warn` mỗi phút cho tới hết đời tiến trình, và một cảnh báo lặp vô hạn là một cảnh báo
 * bị lọc bỏ. Cờ được đặt lại ở lượt đồng bộ THÀNH CÔNG tiếp theo.
 */
/**
 * ★★★ Pha 7 Task 5 (B) — **BẢN DỊCH DUY NHẤT: cột `jsonb` → lời khai BA GIÁ TRỊ.**
 *
 * ⚠⚠ `null` ra `null` (**KHÔNG BIẾT**), mảng chuỗi ra mảng chuỗi (**đã khai**), **mọi thứ khác
 * cũng ra `null`** — không phải `[]`. Vì `[]` là một **LỜI KHẲNG ĐỊNH** (*"tôi đã kiểm, không cắt
 * gì"*), và ta không được nói câu ấy thay cho một hàng mà ta không đọc nổi.
 * ⚠ Đây là chỗ **DUY NHẤT** dịch cột này; đừng viết bản thứ hai ở người gọi.
 */
function docCoCat(v: unknown): readonly string[] | null {
  if (v === null || v === undefined) return null;
  if (!Array.isArray(v)) return null;
  if (!v.every((x) => typeof x === "string")) return null;
  return Object.freeze([...(v as string[])]);
}

function keuMotLan(err: unknown): void {
  if (daKeuHong) return;
  daKeuHong = true;
  console.warn(
    `[vram] ⚠ SỔ CHUNG (\`vram_leases\`) KHÔNG ĐỒNG BỘ ĐƯỢC: ${(err as Error)?.message ?? String(err)}. ` +
      `Giấy phép của tiến trình này VẪN có hiệu lực CỤC BỘ, nhưng tiến trình anh em KHÔNG THẤY nó ` +
      `⇒ hai bên có thể cùng tưởng card còn trống. Đường quyết định đã được gắn cờ ` +
      `\`shared-ledger-unsynced\` và tự CHẶT HƠN; kiểm bảng \`vram_leases\` (migration 0312) và DB.`,
  );
}

/**
 * Làm mới **sau mỗi lượt ghi của chính tiến trình này** (brief Task 2). Gộp nhiều lượt gọi liên
 * tiếp vào MỘT lần chạy: một lượt nạp model bắn `reserve` + `commit` + vài `setLeaseRefCount` trong
 * vài trăm ms, và ba lượt đi DB cho cùng một trạng thái cuối là lãng phí thuần.
 *
 * ⚠ `unref()` — bộ đếm giờ này KHÔNG được giữ tiến trình sống (bài học `aiGateway` rò vào bộ test).
 */
export function scheduleSharedLedgerSync(delayMs = 250): void {
  if (!batDongBo || henGio) return;
  henGio = setTimeout(() => {
    henGio = null;
    void syncSharedLedger();
  }, delayMs);
  henGio.unref?.();
}

/**
 * ★★ CÔNG TẮC của lượt đồng bộ TỰ ĐỘNG (nhịp hẹn sau mỗi lượt ghi). Bật bởi
 * `vramReconciler.startVramReconciler()` — tức bởi **đường boot của sản xuất**, không phải bởi một
 * biến môi trường mặc định TẮT.
 *
 * ⚠⚠ VÌ SAO PHẢI CÓ, và vì sao nó KHÔNG phải một cờ "tính năng": không có nó, MỌI file test chạm
 * `reserve()` sẽ đẻ ra một bộ đếm giờ 250 ms rồi tự đi mở kết nối DB test và ghi vào đó — đúng
 * GOTCHA `aiGateway` đã đo được ở Đợt trước (*"setInterval unref'd tự bắn, tự kết nối và TỰ GHI VÀO
 * DB TEST"*). `syncSharedLedger()` gọi TAY thì vẫn chạy bất kể công tắc: nhịp reconciler 60 s không
 * đi qua đây.
 */
/**
 * ⚠⚠ M-7 (review vòng 1) — **RÀNG BUỘC CẤU TRÚC PHẢI KHAI: VIỆC CÔNG BỐ RA SỔ CHUNG BỊ KHOÁ SAU
 * `startVramReconciler()`.** Cả HAI đường gọi `syncSharedLedger()` đều phụ thuộc nó — nhịp đối
 * chiếu (`vramReconciler.__runReconcileTick()`) và công tắc này. ⇒ Một tiến trình Node **cấp phát
 * VRAM mà KHÔNG bật đối chiếu** sẽ xếp hàng ý định ghi và **KHÔNG BAO GIỜ gửi đi**: 17 GB của nó
 * **vô hình** với anh em — chiều **KHÔNG an toàn**.
 *
 * ⚠ Dân số đó **HÔM NAY RỖNG**, và đó là lý do đây là một ràng buộc chứ không phải một lỗi đang
 * sống: quét `beginVramAllocation` trong `scripts/` và `tools/` cho **0 kết quả**; 22 file có điểm
 * gọi đều nằm trong `server/`; và `server/_core/index.ts` bật đối chiếu **TRƯỚC** nhánh rẽ `ROLE`
 * nên mọi vai trò đều bật. ⇒ Ai thêm một điểm cấp phát VRAM ở một tiến trình mới (script CLI, cron
 * riêng, worker phụ) **phải gọi `startVramReconciler()`**, nếu không tiến trình đó là một hộ tiêu
 * thụ VÔ HÌNH — đúng loại hộ mà Đợt 0 tốn cả một pha để đếm cho đủ.
 *
 * ⚠⚠⚠ RÀNG BUỘC THỨ HAI, CÙNG HẠNG — **MỘT DATABASE = MỘT THIẾT BỊ GPU** (I-2, review TOÀN NHÁNH).
 * Bảng `vram_leases` **không có cột host/device** và hàng `vram:baseline` là **MỘT hàng cho cả DB**
 * (xem đầu `drizzle/0312_vram_leases.sql`). `foreignBytes` cộng thẳng byte của mọi hàng không phải
 * của mình, **không hỏi chúng nằm trên card nào**. ⇒ Hai máy dùng chung một Postgres thì nền của
 * card A bị đọc làm nền của card B và dư địa mỗi bên bị trừ cho byte nằm trên card KHÁC — và
 * **không cơ chế nào của Pha 3 phát hiện được**: đó không phải một lệch đo được, đó là một phép
 * cộng sai DÂN SỐ. Hôm nay vô hại (một máy, `api`/`worker`/all-in-one); nối site hoặc `edge` thứ
 * hai thì **PHẢI thêm chiều thiết bị TRƯỚC** (`deviceKey` = host + UUID GPU, vào khoá chính, vào
 * hàng nền, và vào phép lọc của `vramSharedLedger.dungBanSao()`).
 */
export function enableSharedLedgerSync(on: boolean): void {
  batDongBo = on;
  if (!on && henGio) {
    clearTimeout(henGio);
    henGio = null;
  }
}

/** Công tắc có đang bật không — ca test đọc trực tiếp, không suy đoán qua tác dụng phụ. */
export function __sharedLedgerSyncEnabled(): boolean {
  return batDongBo;
}

/** Chỉ dùng trong test. */
export function __resetSharedLedgerStoreForTests(): void {
  if (henGio) clearTimeout(henGio);
  henGio = null;
  dangDongBo = null;
  daKeuHong = false;
  batDongBo = false;
  gatewayThat = undefined;
}
