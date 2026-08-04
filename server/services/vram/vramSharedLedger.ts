/**
 * ★★★ Pha 3 Task 2 — SỔ CHUNG, NỬA ĐỒNG BỘ. **Module LÁ: không import gì ngoài KIỂU, không I/O.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ RÀNG BUỘC QUYẾT ĐỊNH TOÀN BỘ THIẾT KẾ: `reserve()` PHẢI GIỮ **ĐỒNG BỘ**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Tính đồng bộ **LÀ** lá chắn cấu trúc từ Pha 1 (xem docstring `vramBroker.reserve()`), không phải
 * một tối ưu hiệu năng. Nên sổ chung được tách làm **hai nửa**, và file này là nửa ĐỒNG BỘ:
 *
 *   • **ĐỌC** — một **bản sao đọc** trong bộ nhớ (`banSao`), đọc bằng `readSharedLedgerReplica()`:
 *     thuần, đồng bộ, không tác dụng phụ. Làm mới theo nhịp reconciler (60 s) **và** sau mỗi lượt
 *     ghi của chính tiến trình này.
 *   • **GHI** — `enqueueSharedLedgerWrite()` chỉ **xếp hàng** (một lượt `push` vào mảng). Lượt
 *     `INSERT`/`DELETE` thật do `vramSharedLedgerStore.syncSharedLedger()` chạy **SAU** khi đã
 *     quyết. Ghi hỏng ⇒ giấy phép **vẫn có hiệu lực cục bộ**, nhưng phải **gắn cờ chưa đồng bộ**
 *     (`unsyncedWrites`) và **CÓ TIẾNG** (`vramSharedLedgerStore` kêu).
 *
 * ⚠⚠ **60 s LÀ ĐỘ TRỄ CƯỠNG CHẾ THẬT XUYÊN TIẾN TRÌNH — PHẢI KHAI, KHÔNG ĐƯỢC GIẤU.** Một tiến
 * trình vừa mở giấy phép 17.000 MiB thì tiến trình anh em **có thể mất tới một chu kỳ đồng bộ** mới
 * thấy. Trong cửa sổ đó hai bên cùng tưởng card còn trống. Đây KHÔNG phải một khuyết tật ngẫu
 * nhiên: nó là **cái giá của việc giữ `reserve()` đồng bộ**, và cách trả giá là
 * `sharedLedgerFact().ageMs` đi thẳng vào `applyEnforcement()` thành một **biên byte** + một **lý
 * do** người trực đọc được (`shared-ledger-stale`).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ BẢN SAO ĐỌC CŨ LÀ **PHẠM TRÙ THỨ BA** (bài học Pha 2B, `vramEnforcement.ts`)
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Nó **KHÔNG phải `blind`** — nó CÓ số. Nhưng số **có thể sai**. Chính sách đúng là **GIỮ số +
 * CỘNG một biên theo tuổi** rồi hạ `trusted`; **TUYỆT ĐỐI KHÔNG** đi qua `null`/`0`. Vì
 * `headroom = trần − max(L, A) − đệm` và `max(L, A) ≥ L`, hạ `foreignBytes` về 0 là **NỚI LỎNG**
 * dư địa đúng bằng khối byte anh em đang giữ — tức phản ứng với *"số của tôi có thể đã cũ"* bằng
 * *"vậy coi như anh em không giữ gì"*. Đó là chiều sai của ràng buộc toàn cục 8.
 *
 * ⇒ HAI trạng thái, và chúng KHÁC NHAU (đừng gộp):
 *   • `readSharedLedgerReplica() === null` — **CHƯA LÀM MỚI LẦN NÀO trong tiến trình này**. Không
 *     phải "không có ai khác". Lý do `"shared-ledger-unasked"`, phụ phí **2 đơn vị** (cấu trúc,
 *     KHÔNG tự lành — cùng hạng với `"no-tick"`).
 *   • `!== null` với `ageMs` lớn — **CÓ số, số cũ**. Giữ nguyên `foreignBytes`, cộng biên theo
 *     tuổi (có TRẦN), thêm `"shared-ledger-stale"`.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ BẰNG CHỨNG "ĐÃ NHẢ" **KHÔNG BAO GIỜ** ĐƯỢC LÀ *"HÀNG BIẾN KHỎI BẢN SAO ĐỌC"* (Task 1)
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Task 1 đo được: `kill(pid,0)` **SỚM GIẢ** (mã thoát đóng dấu ~16 ms, `nvidia-smi` về nền ≤33 ms,
 * Node phát `"exit"` ~560 ms) ⇒ có một cửa sổ ~0,5 s *"thiết bị đã nhả mà sổ vẫn khai còn giữ"*.
 * Hệ quả cho file này là **CẤM một chiều suy luận**, không phải một tối ưu:
 *
 *   > Lệnh ghi NHẢ phải phát **TỪ CHÍNH nhánh `exit`/`error`** — tức từ `vramBroker.release()`,
 *   > thứ mà `vramWiring.release()` gọi trong `proc.on("exit")`. **KHÔNG ĐƯỢC** kết luận "đã nhả"
 *   > từ việc một hàng biến mất khỏi bản sao đọc: đó là **hiệu số của một bản sao CŨ**, đúng hình
 *   > dạng lỗi T5-11 đã tốn cả một pha để gỡ.
 *
 * Và chiều ngược lại cũng phải đúng: **sổ CỤC BỘ là chủ về giấy phép của chính tiến trình này.**
 * Hàng của ta biến mất khỏi bảng (ai đó dọn, một lượt mất kết nối, một tiến trình khác nhầm) ⇒ ta
 * **GHI LẠI**, không ⇒ *"chắc mình nhả rồi"*. Có ca `E-2`/`E-3` khoá cả hai chiều.
 *
 * ⚠ VÌ SAO LÀ MODULE LÁ (cùng lý do với `vramTickCell.ts`, và lý do đó đã trả giá):
 *   1. **VÒNG NHẬP** — `vramBroker` đọc ô này trên đường quyết định; nếu ô này kéo theo DB thì
 *      `vramBroker` (module ai cũng nhập) kéo theo cả tầng I/O.
 *   2. **BỀ MẶT MOCK** — 43 file test thay cả module `./vramBroker`. Một ô lá không đẻ thêm bề mặt.
 *   3. **LÁ CHẮN ĐỒNG BỘ** — không có gì để `await` thì không ai `await` nhầm.
 */
import type { VramLease, VramLeaseKind, VramPriority, VramReclaimerId } from "./types";

/**
 * MỘT HÀNG của sổ chung — hình dạng đúng bằng bảng `vram_leases` (migration 0312).
 *
 * ⚠ MỌI Ô SỐ Ở ĐÂY PHẢI HỮU HẠN. Cột byte là `bigint` ⇒ một `NaN`/`Infinity` đi tới đó thành chuỗi
 * `"NaN"` trên dây và Postgres ném `22P02`; vì lượt ghi là MỘT LÔ nhiều hàng, một hàng hỏng làm
 * **mất cả lô** — đúng tiền lệ `estimateSource` `varchar(16)` của migration 0311. Hàng rào nằm ở
 * `vramSharedLedgerStore.rowFromLease()` (cửa vào DUY NHẤT), không rải ở từng điểm gọi.
 */
export interface SharedLeaseRow {
  /** `${processKey}#${leaseId}` — KHOÁ CHÍNH. `leaseId` chỉ duy nhất TRONG một tiến trình. */
  readonly leaseKey: string;
  /** `${role}:${pid}:${bootId}` — xem `sharedLedgerSelfKey()` để biết vì sao có `bootId`. */
  readonly processKey: string;
  readonly pid: number;
  readonly role: string;
  readonly leaseId: string;
  readonly owner: string;
  readonly leaseKind: VramLeaseKind;
  readonly priority: VramPriority;
  /** `actualBytes ?? estimatedBytes` — cùng công thức `vramBroker.leaseBytes()`, đã lọc hữu hạn. */
  readonly bytes: number;
  /** `true` ⇔ `bytes` do một THƯỚC đẻ ra. Xem `types.VramLease.actualBytes` (ba nhóm, hai ô). */
  readonly measured: boolean;
  readonly refCount: number;
  /** `null` ⇔ điểm gọi KHÔNG khai người thi hành ⇒ **không ai thu hồi được** hộ này. */
  readonly reclaimer: VramReclaimerId | null;
  readonly acquiredAtMs: number;
  readonly updatedAtMs: number;
}

/**
 * Một Ý ĐỊNH GHI. Xếp hàng ĐỒNG BỘ trên đường quyết định, thi hành BẤT ĐỒNG BỘ sau đó.
 * ⚠ Hai biến thể, phân biệt bằng `op` — KHÔNG phải một object có `row?` optional: một
 * `{ op: "delete", row: undefined }` viết nhầm sẽ **không** bị `tsc` bắt, và một lượt xoá im lặng
 * là đúng thứ khối docstring "bằng chứng đã nhả" bên trên cấm.
 */
export type SharedLedgerWrite =
  | { readonly op: "upsert"; readonly leaseKey: string; readonly row: SharedLeaseRow }
  | { readonly op: "delete"; readonly leaseKey: string; readonly row?: undefined };

/** Ảnh chụp sổ chung mà đường quyết định ĐỌC. Thuần dữ liệu, đông cứng. */
export interface SharedLedgerReplica {
  /** `Date.now()` lúc lượt làm mới KẾT THÚC — con số để đo TUỔI. */
  readonly atMs: number;
  /**
   * Σ byte của các hàng **KHÔNG PHẢI của tiến trình này**.
   * ⚠ Loại hàng của chính ta ra là BẮT BUỘC, không phải tối ưu: sổ cục bộ đã đếm chúng rồi, cộng
   * lần nữa là **đếm hai lần** đúng khối byte của mình (ca A-3).
   */
  readonly foreignBytes: number;
  readonly foreignLeases: readonly SharedLeaseRow[];
  /** Danh tính đã dùng để lọc — ghi lại để một lượt đổi danh tính không âm thầm đọc số cũ. */
  readonly selfKey: string;
}

/**
 * Thứ mà đường quyết định (`applyEnforcement`) thật sự cần biết. `null` ⇔ **CHƯA LÀM MỚI LẦN NÀO**.
 * ⚠ Cùng kỷ luật với `VramUnledgeredFact`: `null` là *"chưa hỏi"*, KHÔNG phải *"đã kiểm, không có"*.
 */
export type SharedLedgerFact = {
  readonly foreignBytes: number;
  readonly ageMs: number;
  /** Số lượt ghi CỦA TA chưa lên được sổ chung. `> 0` ⇒ anh em **không thấy** ta. */
  readonly unsyncedWrites: number;
  /** Số lượt đồng bộ HỎNG LIÊN TIẾP. `≥ 1` ⇒ tuổi sẽ KHÔNG tự trẻ lại. */
  readonly consecutiveFailures: number;
} | null;

/**
 * ⚠ TRẦN HÀNG ĐỢI GHI. Cùng chính sách với `vramEventLog.QUEUE_MAX`: thà mất một phần telemetry
 * còn hơn phình bộ nhớ khi DB gián đoạn kéo dài. Nhưng ở đây hậu quả NẶNG HƠN nhật ký (mất một
 * hàng sổ chung = anh em tính thiếu byte), nên cửa vứt **đếm và kêu**, và ô `unsyncedWrites` giữ
 * số đó cho tới khi thật sự đồng bộ được.
 */
const QUEUE_MAX = 10_000;

let banSao: SharedLedgerReplica | null = null;
let hangCho: SharedLedgerWrite[] = [];
let soLuotGhiHong = 0;
let soLuotDongBoHongLienTiep = 0;
let selfKeyOverride: string | null = null;
let selfKeyCache: string | null = null;

/**
 * Mốc khởi động của TIẾN TRÌNH này. Có mặt trong `processKey` vì **PID được HĐH CẤP LẠI**: một
 * `worker` chết rồi một tiến trình khác nhận đúng PID đó sẽ "kế thừa" giấy phép của người đã chết
 * và sổ chung sẽ khai một khối byte không tồn tại. Đây đúng nợ N2-2 của Pha 2A (PID cấp lại ⇒ tập
 * `seen` sai ⇒ `commit(0)` cho một model 17 GB), chỉ khác chỗ đứng.
 */
const BOOT_MS = Date.now();

/**
 * DANH TÍNH của tiến trình này trong sổ chung: `${role}:${pid}:${bootMs}`.
 *
 * ⚠ Đọc `process.env.ROLE` **mỗi lượt tính lần đầu**, không đóng băng lúc nạp module — cùng khuôn
 * `describeTopologyHint()`: bộ test đổi `ROLE` giữa các ca bằng `vi.resetModules()`.
 */
export function sharedLedgerSelfKey(): string {
  if (selfKeyOverride !== null) return selfKeyOverride;
  if (selfKeyCache === null) {
    selfKeyCache = `${process.env.ROLE || "all"}:${process.pid}:${BOOT_MS}`;
  }
  return selfKeyCache;
}

/**
 * Đọc bản sao. **ĐỒNG BỘ, không I/O, không tác dụng phụ** — gọi được từ trong `reserve()`.
 * `null` = **CHƯA làm mới lần nào trong tiến trình này** ⇒ người đọc PHẢI hiểu là **ĐANG MÙ về
 * anh em**, TUYỆT ĐỐI không phải "không có tiến trình nào khác giữ gì".
 */
export function readSharedLedgerReplica(): SharedLedgerReplica | null {
  return banSao;
}

/**
 * Dạng mà đường quyết định tiêu thụ. **MỘT bản cài đặt duy nhất** của phép quy đổi
 * bản-sao → sự-thật; `vramWiring` và bộ test đều gọi hàm này, không ai tự dựng object bằng tay
 * (ràng buộc 12: bản sao thứ hai của một vị từ thì không viết ra được).
 */
export function sharedLedgerFact(nowMs: number): SharedLedgerFact {
  if (banSao === null) return null;
  const tuoi = nowMs - banSao.atMs;
  return {
    foreignBytes: banSao.foreignBytes,
    // Đồng hồ chạy lùi / số bẩn ⇒ **tuổi âm** là vô nghĩa. Trả nguyên số cho `applyEnforcement`
    // (nó lấy TRẦN biên cho tuổi không đọc được — chiều CHẶT), KHÔNG kẹp về 0 ở đây.
    ageMs: tuoi,
    unsyncedWrites: soLuotGhiHong + demYDinhDoiByte(),
    consecutiveFailures: soLuotDongBoHongLienTiep,
  };
}

/**
 * ★★★ I-3 (review vòng 1) — **CHỈ ĐẾM Ý ĐỊNH LÀM ĐỔI SỐ BYTE MÀ ANH EM ĐỌC.**
 *
 * ⚠⚠ VÌ SAO KHÔNG PHẢI `hangCho.length`, và đây là một lỗi ĐANG SỐNG chứ không phải lo xa:
 * `llamaVisionSidecar` gọi `noteRefCount()` **mỗi lượt request thị giác vào/ra**, `aiGgufEngine`
 * tương tự cho GGUF ⇒ trên một `worker` **đang phục vụ**, hàng đợi có ≥ 1 ý định gần như liên tục.
 * Với phép đếm cũ, **MỌI** quyết định `reserve()` mang `"shared-ledger-unsynced"` ⇒ `trusted:false`
 * **thường trực** + **−1.024 MiB thường trực**. *Một cờ luôn bật là một cờ không còn thông tin* —
 * đúng lớp NHIỄU mà Wave 3/4 tốn hai đợt để dập (52 cảnh báo ACTIVE → 6).
 *
 * ⇒ Vị từ đúng là hẹp hơn hẳn: **"anh em có đang đọc một con số BYTE sai vì ta chưa gửi kịp không"**.
 *   • `delete` — **LUÔN đếm.** Chưa gửi được ⇒ anh em còn thấy một **HÀNG MA** và trừ dư địa cho
 *     byte đã nhả. Đây là chiều hỏng nặng nhất (xem `C-4`).
 *   • `upsert` có `bytes` **KHÁC** con số đã công bố — đếm. Điển hình: `commit()` thay ước lượng
 *     bằng số ĐO.
 *   • `upsert` có `bytes` **BẰNG** con số đã công bố — **KHÔNG đếm.** Đó là một lượt bump
 *     `refCount`/`measured`: nó **không đổi một byte nào** trong phép tính dư địa của anh em.
 *
 * ⚠ ĐIỀU NÀY **KHÔNG** LÀM HỆ LỎNG ĐI Ở CHIỀU NGUY HIỂM: một giấy phép MỚI chưa công bố không có
 * hàng nào trong bản sao ⇒ `daCongBo === undefined` ⇒ **vẫn đếm**. Chỉ những ý định thật sự không
 * đổi byte mới rơi ra ngoài.
 * ⚠ Và `refCount` KHÔNG bị bỏ rơi: nó vẫn đi lên sổ chung ở lượt sync kế, và `vramWiring` nay hẹn
 * một lượt sync ngay sau khi đồng bộ `refCount` (nếu không, ô mà Task 5 đứng lên **cũ tới 60 s**).
 * Nó chỉ thôi **giả vờ là một sự cố đồng bộ**.
 */
function demYDinhDoiByte(): number {
  const daCongBo = new Map<string, number>();
  if (banSao !== null) for (const r of banSao.foreignLeases) daCongBo.set(r.leaseKey, r.bytes);
  // ⚠ Hàng CỦA TA đã bị `publishSharedLedgerReplica()` lọc khỏi `foreignLeases`, nên bản sao KHÔNG
  // đủ để trả lời "ta đã công bố bao nhiêu". Ô riêng bên dưới giữ đúng con số ĐÃ GỬI THÀNH CÔNG.
  let n = 0;
  for (const w of hangCho) {
    if (w.op === "delete") { n += 1; continue; }
    const cu = byteDaGui.get(w.leaseKey);
    if (cu === undefined || cu !== w.row.bytes) n += 1;
  }
  return n;
}

/**
 * Byte **ĐÃ GỬI THÀNH CÔNG** lên sổ chung cho từng giấy phép CỦA TA. Không có ô này thì không có
 * cách nào phân biệt *"ý định làm đổi byte"* với *"ý định lặp lại đúng con số cũ"* — và mọi lượt
 * bump `refCount` lại thành một sự cố đồng bộ (I-3).
 * ⚠ Chỉ `vramSharedLedgerStore` ghi, và **chỉ SAU khi `gw.apply()` trót lọt**: ghi trước là khai
 * "anh em đã thấy" cho một con số còn nằm trong hàng đợi.
 */
const byteDaGui = new Map<string, number>();

/** Xác nhận một lô ý định đã LÊN được sổ chung. Chỉ `vramSharedLedgerStore` gọi. */
export function noteSharedLedgerWritesApplied(writes: readonly SharedLedgerWrite[]): void {
  for (const w of writes) {
    if (w.op === "delete") byteDaGui.delete(w.leaseKey);
    else byteDaGui.set(w.leaseKey, w.row.bytes);
  }
}

/**
 * XUẤT BẢN một lượt làm mới. **Chỉ `vramSharedLedgerStore` được gọi** (cùng kỷ luật với
 * `publishDecisionTick`): ai gọi từ đường đọc là đưa I/O trở lại đúng chỗ Pha 1 đã dọn đi.
 *
 * ⚠ `selfKey` là THAM SỐ, không đọc lại `sharedLedgerSelfKey()` bên trong: hai vế của phép lọc
 * (danh tính lúc SELECT và danh tính lúc cộng) phải đến từ **một lượt đọc duy nhất**.
 * ⚠ Hàng có `bytes` KHÔNG HỮU HẠN bị **bỏ khỏi phép cộng nhưng GIỮ trong danh sách**: cùng kỷ luật
 * với `vramRefusal.preemptableBytes` — một hộ có số hỏng vẫn phải được **gọi tên**.
 */
export function publishSharedLedgerReplica(
  rows: readonly SharedLeaseRow[],
  atMs: number,
  selfKey: string,
): void {
  const ngoai = rows.filter((r) => r.processKey !== selfKey);
  let tong = 0;
  for (const r of ngoai) if (Number.isFinite(r.bytes) && r.bytes > 0) tong += r.bytes;
  banSao = Object.freeze({
    atMs,
    foreignBytes: tong,
    foreignLeases: Object.freeze([...ngoai]),
    selfKey,
  });
  soLuotDongBoHongLienTiep = 0;
}

/**
 * Lượt đồng bộ NÉM — **KHÔNG đè lên bản sao** (số cũ vẫn là số tốt nhất ta có) nhưng phải ĐẾM:
 * tuổi của bản sao đứng yên theo lượt hỏng, nên chỉ nhìn `atMs` thì "chưa tới hạn" và "đã hỏng 5
 * lần" trông giống hệt nhau (bài học M-5 của ô tick).
 */
export function noteSharedLedgerSyncFailure(): number {
  return ++soLuotDongBoHongLienTiep;
}

/**
 * Xếp một ý định ghi. **ĐỒNG BỘ, không I/O** — gọi được từ trong `reserve()`/`release()`.
 * ⚠ M-2 (review vòng 1) — **O(n), KHÔNG PHẢI O(1)** như câu cũ ở đây nói (`findIndex`). `n` bị chặn
 * bởi số giấy phép SỐNG (mỗi lượt sync `drain` sạch rồi dựng lại từ sổ cục bộ) nên thực tế n ≲ chục;
 * `QUEUE_MAX` chỉ chạm được khi sync hỏng liên tục **và** số lease bùng nổ. Không đổi tính đồng bộ —
 * nhưng một docstring nói quá là chỗ người sau dựng giả định lên, nên sửa cho đúng.
 * ⚠ Gộp theo `leaseKey`: một giấy phép bị `commit()` rồi `setLeaseRefCount()` rồi `release()`
 * trong cùng một cửa sổ đồng bộ chỉ cần **trạng thái CUỐI**. Không gộp thì hàng đợi phình theo số
 * lượt suy luận, và lượt ghi cuối vẫn thắng — tức tốn băng thông cho không.
 */
export function enqueueSharedLedgerWrite(w: SharedLedgerWrite): void {
  const cu = hangCho.findIndex((x) => x.leaseKey === w.leaseKey);
  if (cu >= 0) {
    hangCho[cu] = w;
    return;
  }
  if (hangCho.length >= QUEUE_MAX) {
    // Cửa VỨT — đếm vào đúng ô mà đường quyết định đọc, để nó KHÔNG im lặng.
    soLuotGhiHong += 1;
    return;
  }
  hangCho.push(w);
}

/** Lấy hết hàng đợi hiện tại (và dọn). Chỉ `vramSharedLedgerStore` gọi. */
export function drainSharedLedgerWrites(): SharedLedgerWrite[] {
  const b = hangCho;
  hangCho = [];
  return b;
}

/**
 * Lô ghi HỎNG — **TRẢ LẠI ĐẦU HÀNG ĐỢI để thử lại**, và đếm.
 *
 * ⚠ VỨT ĐI LÀ SAI CHIỀU: một lượt `delete` bị vứt để lại một hàng MA trong sổ chung, và anh em sẽ
 * trừ dư địa cho một khối byte đã nhả — vĩnh viễn, cho tới khi tiến trình kia khởi động lại. Một
 * lượt `upsert` bị vứt thì ngược lại: anh em tính THIẾU byte ta đang giữ. Cả hai đều im lặng nếu
 * không có ô `unsyncedWrites`.
 * ⚠ Ý định MỚI HƠN luôn thắng: nếu trong lúc lô kia đang bay đã có một ý định khác cho cùng
 * `leaseKey` thì lô cũ **không được ghi đè** nó (`release()` sau `commit()` là đường thường).
 */
export function requeueSharedLedgerWrites(batch: readonly SharedLedgerWrite[]): void {
  const moiHon = new Set(hangCho.map((w) => w.leaseKey));
  const giuLai = batch.filter((w) => !moiHon.has(w.leaseKey));
  hangCho = [...giuLai, ...hangCho];
  // Quá trần ⇒ cắt ĐUÔI (ý định CŨ nhất), và đếm phần bị cắt vào ô mà đường quyết định đọc:
  // một lượt cắt im lặng ở đây là đúng thứ `unsyncedWrites` sinh ra để chống.
  if (hangCho.length > QUEUE_MAX) {
    soLuotGhiHong += hangCho.length - QUEUE_MAX;
    hangCho.length = QUEUE_MAX;
  }
}

/**
 * Số ý định ghi đang chờ + số đã bị vứt — **phép đếm THÔ**, dùng cho việc *"còn việc để gửi không"*
 * (nhịp hẹn lại của `syncSharedLedger`). ⚠ KHÁC `SharedLedgerFact.unsyncedWrites`, thứ chỉ đếm ý
 * định **làm đổi byte** (I-3): hai câu hỏi khác nhau thì hai phép đếm khác nhau.
 */
export function sharedLedgerUnsyncedCount(): number {
  return soLuotGhiHong + hangCho.length;
}

/**
 * ★★★ GIẤY PHÉP SỐNG → MỘT HÀNG SỔ CHUNG. **Bản cài đặt DUY NHẤT** — `vramBroker` (lúc xếp hàng)
 * và `vramSharedLedgerStore` (lúc ghi) đều gọi hàm này.
 *
 * ⚠⚠ `bytes` là **THAM SỐ, không tự tính**: công thức `actualBytes ?? estimatedBytes` sống ở
 * `vramBroker.leaseBytes()` và chỉ được có MỘT bản (chú thích tại chỗ: *"hai bản cài đặt song song
 * của CÙNG một công thức là đúng lớp lỗi khiến `bench.mjs` từng sai bốn lần"*). Chép nó vào đây để
 * tránh một lượt import là đổi một vòng nhập lấy một bản sao vị từ — đắt hơn nhiều.
 *
 * ⚠ MỌI Ô SỐ ĐƯỢC LỌC HỮU HẠN TẠI ĐÂY, và đây là **cửa vào DUY NHẤT** của bảng: một `NaN` tới cột
 * `bigint` làm Postgres ném `22P02`, và vì lượt ghi là MỘT LÔ nhiều hàng, một hàng hỏng làm **mất
 * cả lô** (đúng tiền lệ `22001` của migration 0311). `0` là giá trị dự phòng duy nhất KHÔNG BỊA;
 * `measured: false` đi kèm nói rõ nó không phải số đo.
 */
export function rowFromLease(
  lease: VramLease,
  bytes: number,
  selfKey: string,
  nowMs: number,
): SharedLeaseRow {
  const [role = "all", pidText = "0"] = selfKey.split(":");
  return {
    leaseKey: cat(`${selfKey}#${lease.id}`, 200),
    processKey: cat(selfKey, 96),
    pid: soHuuHan(Number(pidText), 0),
    role: cat(role, 32),
    leaseId: cat(lease.id, 64),
    owner: cat(lease.request.owner, 160),
    leaseKind: lease.request.kind,
    priority: lease.request.priority,
    bytes: soHuuHan(bytes, 0),
    // Xem `types.VramLease.actualBytes` — BA nhóm, đọc bằng HAI trường. `measureSource === "none"`
    // là ƯỚC LƯỢNG DỰ PHÒNG, KHÔNG phải số đo, nên nó cũng cho `false`.
    measured:
      lease.actualBytes !== null && lease.measureSource !== undefined && lease.measureSource !== "none",
    refCount: soHuuHan(lease.refCount, 1),
    reclaimer: lease.request.reclaimer ?? null,
    acquiredAtMs: soHuuHan(lease.acquiredAt.getTime(), nowMs),
    updatedAtMs: soHuuHan(nowMs, 0),
  };
}

function soHuuHan(v: number, mac: number): number {
  return Number.isFinite(v) ? Math.trunc(v) : mac;
}

/**
 * ★★★ M-1 (review vòng 1) — **CẮT ĐỘ RỘNG `varchar`. Bản trước chỉ lọc SỐ, và tiền lệ mà chính
 * docstring này viện dẫn (migration 0311) là một lỗi CHUỖI.**
 *
 * `owner` là chuỗi **ĐỘNG lấy từ ĐƯỜNG DẪN TUYỆT ĐỐI**: `ocrService` dựng `onnx-ocr:${modelPath}`,
 * `aiReranker` dựng `reranker:${modelPath}`. Với `GGUF_MODELS_DIR=D:/SOURCES/16.AI` hôm nay là ~54
 * ký tự — **vừa**. Một lượt đổi thư mục model là đủ vượt `varchar(160)`.
 *
 * ⚠ VÀ HẬU QUẢ Ở ĐÂY NẶNG HƠN Ở `vram_events`: `22001` làm **mất cả lô**, rồi
 * `requeueSharedLedgerWrites()` **ném lại đúng hàng độc** ⇒ hỏng **VĨNH VIỄN**, `unsyncedWrites`
 * không bao giờ về 0, và chỉ **một** dòng cảnh báo (`keuMotLan` kêu một lần mỗi quãng hỏng). Tức
 * cơ chế thử-lại — thứ được dựng để chống mất dữ liệu — **biến một lỗi tạm thành một lỗi chết**.
 *
 * ⚠ CẮT chứ không VỨT: cùng kỷ luật `sanitizeVramEvent()` — *"vứt dòng đi là đổi một lỗi im lặng
 * lấy một lỗi im lặng khác"*. Ai đổi độ rộng cột ở `drizzle/0312_vram_leases.sql` phải đổi các con
 * số ở đây (ca `M-1` khoá hai bảng khớp nhau).
 */
function cat(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max);
}

/** Chỉ dùng trong test. */
export function __resetSharedLedgerForTests(): void {
  banSao = null;
  hangCho = [];
  soLuotGhiHong = 0;
  soLuotDongBoHongLienTiep = 0;
  selfKeyOverride = null;
  selfKeyCache = null;
  // I-3 — không xoá thì ca sau KẾ THỪA "đã gửi bao nhiêu byte" của ca trước, và một ý định ĐỔI BYTE
  // thật sẽ bị đếm nhầm là "lặp lại con số cũ" ⇒ cờ chưa-đồng-bộ tự mù.
  byteDaGui.clear();
}

/**
 * Chỉ dùng trong test — sự thật của một sổ chung **VỪA LÀM MỚI XONG và KHÔNG CÓ ANH EM NÀO**.
 *
 * ⚠⚠ ĐÂY LÀ MỘT LỜI KHAI, KHÔNG PHẢI MỘT TIỆN ÍCH: mọi bộ ca có TRƯỚC Pha 3 canh những thứ khác
 * (sổ cái, câu từ chối, đo lường) và **không** canh sổ chung; đưa chúng một ô này là nói *"trong
 * ca này, sổ chung không phải biến số"* — cùng khuôn `ctxSachChoCaCu()` đã dùng cho ô tick ở Pha
 * 2B. Bộ ca THẬT SỰ canh sổ chung (`sharedLedger.test.ts`) **không dùng hàm này**: nó đọc ô thật
 * bằng `sharedLedgerFact()` sau một lượt `syncSharedLedger()` (ràng buộc 10 — lưới đi theo ĐƯỜNG
 * THOÁT, không theo file).
 *
 * ⚠ MỘT bản định nghĩa duy nhất: năm file test tự viết `{ foreignBytes: 0, ageMs: 0, … }` là năm
 * bản sao sẽ trôi khỏi nhau ngay khi `SharedLedgerFact` thêm một ô.
 */
export function __freshSharedLedgerFactForTests(): SharedLedgerFact {
  return { foreignBytes: 0, ageMs: 0, unsyncedWrites: 0, consecutiveFailures: 0 };
}

/**
 * Chỉ dùng trong test — đóng vai MỘT TIẾN TRÌNH KHÁC trên cùng một bảng. Không có nó thì "hai
 * tiến trình" chỉ dựng được bằng cách tự khai `foreignBytes` bằng tay, tức một lưới đi theo FILE
 * chứ không theo ĐƯỜNG THOÁT (ràng buộc 10, đã tái diễn SÁU lần).
 */
export function __setSharedLedgerSelfKeyForTests(key: string | null): void {
  selfKeyOverride = key;
}
