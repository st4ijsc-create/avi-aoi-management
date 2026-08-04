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
  drainSharedLedgerWrites, noteSharedLedgerSyncFailure, publishSharedLedgerReplica,
  requeueSharedLedgerWrites, rowFromLease, sharedLedgerSelfKey,
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
  dangDongBo = chayMotLuot().finally(() => {
    dangDongBo = null;
  });
  return dangDongBo;
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

  let ghiHong = false;
  if (writes.length > 0) {
    try {
      await gw.apply(writes);
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
    out.push({ op: "upsert", leaseKey: key, row: rowFromLease(l, leaseBytes(l), selfKey, nowMs) });
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
            })),
          )
          .onConflictDoUpdate({
            target: vramLeases.leaseKey,
            set: {
              bytes: sqlExcluded("bytes"),
              measured: sqlExcluded("measured"),
              refCount: sqlExcluded("refCount"),
              reclaimer: sqlExcluded("reclaimer"),
              updatedAt: sqlExcluded("updatedAt"),
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
