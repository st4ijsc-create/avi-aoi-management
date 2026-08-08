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
// ★ I-2 / M-5 (review TOÀN NHÁNH) — bề rộng ô danh tính có MỘT chủ; `vramRouter` đọc **cùng** hằng.
import { VRAM_LEASE_COLUMN_MAX, type VramLeaseColumn } from "./vramColumnLimits";
/**
 * ★ Pha 6 Task 5 — **PHÉP CẮT DUY NHẤT của repo**. `@shared/textSafety` là một module LÁ **không
 * phụ thuộc gì** (cùng hạng với `./vramColumnLimits`), nên nó KHÔNG phá kỷ luật "module lá" ở đầu
 * file — và nó là thứ duy nhất sinh ra cờ `daCat` **tại đúng chỗ cắt**.
 */
import { catChuoi } from "@shared/textSafety";

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
  /**
   * ★★★ Pha 7 Task 5 (B) — **CỜ "ĐÃ CẮT DANH TÍNH" ĐI CÙNG HÀNG, XUYÊN TIẾN TRÌNH.**
   *
   * ⚠⚠⚠ **BA GIÁ TRỊ** (cùng kỷ luật `TrangThaiTienTrinh`):
   *   • `null`         = **KHÔNG BIẾT** — người ghi hàng này chưa biết cột `identityTruncated`
   *                      (tiến trình cũ trong cửa sổ triển khai). **KHÔNG được đọc thành "sạch".**
   *   • `[]`           = người ghi **khai**: không cắt ô nào.
   *   • `["owner", …]` = đúng những ô đã bị cắt.
   *
   * ⚠⚠ VÌ SAO Ô NÀY PHẢI TỒN TẠI, đo được ở Pha 7 Bước 1: trước nó, lời khai `daCat` chỉ sống
   * trong `hangDaCat` — một `Set` **trong bộ nhớ NGƯỜI GHI**. Tiến trình **anh em** đọc đúng hàng
   * ấy thấy `owner` dài 160 và **không một ô nào** nói nó mất chữ (ca **B1**).
   * ⚠⚠ Và **KHÔNG suy ra được từ độ dài** (ca **B2**): một chuỗi dài **đúng bằng** trần thì
   * **không** bị cắt, một chuỗi dài hơn bị cắt **thành** trần ⇒ hai sự thật, **một** độ dài. Một
   * phép so `owner.length === 160` ở đầu đọc là **bản sao thứ hai của một vị từ**, và bản sao ấy
   * **SAI đúng ở ô biên** — cùng lỗi M-5 mà `catO()` đã ghi thành cảnh báo.
   *
   * ⚠⚠ KIỂU LÀ `string[]`, **KHÔNG PHẢI `VramLeaseColumn[]`** — và đó là một quyết định, không phải
   * một lượt buông lỏng: hàng này do **MỘT TIẾN TRÌNH KHÁC** ghi, có thể là **một phiên bản khác**
   * của chính mã này. Khai kiểu hẹp ở đây là **hứa hộ người khác** rằng họ chỉ ghi tên cột mà
   * *phiên bản CỦA TA* biết — một lời hứa ta không cưỡng chế được, và nó sẽ vỡ **im lặng** đúng
   * ngày ai đó thêm cột thứ chín. Đầu **GHI** (`rowFromLease`) vẫn hẹp: `VramLeaseColumn[]` gán
   * được vào `string[]`, nên chiều ta kiểm soát được thì vẫn được kiểm soát.
   */
  readonly identityTruncated: readonly string[] | null;
}

/**
 * ★★★ Pha 6 Task 5 (I-2, đầu THỨ BA) — **KẾT QUẢ MỘT LƯỢT DỰNG HÀNG: HÀNG **VÀ** LỜI KHAI.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ VÌ SAO ĐỔI KIỂU CHỨ KHÔNG THÊM MỘT CA TEST
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Pha 5 đóng đầu **ĐỌC** của I-2 (mặt hiển thị cắt-**có-khai**) và đầu **LỆNH** (`owner` là danh
 * tính ⇒ **không cắt**). Đầu **GHI** vẫn cắt **âm thầm**: `rowFromLease()` trả về một
 * `SharedLeaseRow` **trông y hệt** một hàng nguyên vẹn, nên **không một người gọi nào** — kể cả
 * người viết ra nó — có chỗ để biết danh tính hộ **anh em** vừa mất chữ.
 *
 * Một ca test không giải được lớp này: ca chỉ chứng minh **đường ta vừa đi** có khai; đường thứ ba
 * mà ai đó thêm vào ngày mai vẫn im lặng. Đổi KIỂU thì **phát biểu sai không viết ra được**: muốn
 * một `SharedLeaseRow` thì phải đi qua ô này, và muốn xếp một ý định `upsert` thì `tsc` đòi
 * `daCat`. (Kỷ luật đã dùng thành công 5 lần trong chuỗi pha — xem §Global Constraints Pha 5.)
 *
 * ⚠ `daCat` là **TÊN Ô**, không phải giá trị: một lời khai in ra chuỗi bị cắt là một lời khai **rò
 *   chính thứ vừa bị cắt** ra nhật ký/prompt (C-1 của Pha 5: `preview()` rò bí mật tới BA đích).
 * ⚠ Rỗng ⇔ **không ô nào bị cắt**. Ô dài **ĐÚNG BẰNG** trần **KHÔNG** có mặt ở đây.
 */
export interface SharedLeaseRowKetQua {
  readonly row: SharedLeaseRow;
  readonly daCat: readonly VramLeaseColumn[];
}

/**
 * Một Ý ĐỊNH GHI. Xếp hàng ĐỒNG BỘ trên đường quyết định, thi hành BẤT ĐỒNG BỘ sau đó.
 * ⚠ Hai biến thể, phân biệt bằng `op` — KHÔNG phải một object có `row?` optional: một
 * `{ op: "delete", row: undefined }` viết nhầm sẽ **không** bị `tsc` bắt, và một lượt xoá im lặng
 * là đúng thứ khối docstring "bằng chứng đã nhả" bên trên cấm.
 */
export type SharedLedgerWrite =
  | {
      readonly op: "upsert";
      readonly leaseKey: string;
      readonly row: SharedLeaseRow;
      /**
       * ★★★ Pha 6 Task 5 (I-2, đầu THỨ BA) — **LỜI KHAI ĐI KÈM Ý ĐỊNH GHI, KHÔNG PHẢI TUỲ CHỌN.**
       *
       * ⚠⚠ Ô này **bắt buộc** chính là bản vá: trước lượt này, người dựng hàng cắt `owner` rồi trả
       * về một `SharedLeaseRow` **trông y hệt một hàng không bị cắt** ⇒ hai điểm gọi xếp hàng ghi
       * mà **không có chỗ nào để biết**. Nay `tsc` không cho dựng một ý định `upsert` mà không nói
       * ra lượt cắt: khai `[]` cho một hàng bị cắt là một **lời nói dối viết ra được và ĐỌC ĐƯỢC**,
       * còn im lặng thì trước đây **không đọc được ở đâu cả**.
       */
      readonly daCat: readonly VramLeaseColumn[];
    }
  | { readonly op: "delete"; readonly leaseKey: string; readonly row?: undefined; readonly daCat?: undefined };

/**
 * ★★★ Pha 3 Task 3 (N-WB-1) — KHOÁ CỦA **HÀNG DÀNH RIÊNG** MANG NỀN DÙNG CHUNG.
 *
 * ⚠⚠ VÌ SAO MỘT HÀNG TRONG `vram_leases` CHỨ KHÔNG PHẢI MỘT BẢNG RIÊNG: Task 3 **KHÔNG được chạy
 * DDL** (migration 0312 đã áp lên cả hai DB; thêm bảng là một lượt DDL nữa). Bảng này đã có đúng
 * bốn thứ một cuộc bầu cần: **khoá chính** (loại trừ lẫn nhau), `processKey` (danh tính), `bytes`
 * (con số), `updatedAt` + chỉ mục (nhịp sống). Đánh đổi đã cân và phải khai: **ba ô bị dùng cho
 * nghĩa KHÁC** — xem `rowFromBaseline()`, nơi giữ **bản dịch DUY NHẤT**.
 *
 * ⚠ KHÔNG THỂ TRÙNG VỚI MỘT GIẤY PHÉP THẬT, và đó là tính chất CẤU TRÚC chứ không phải may:
 * `rowFromLease()` dựng `leaseKey = \`${selfKey}#${lease.id}\`` ⇒ **luôn chứa `#`**. Chuỗi dưới đây
 * **không có `#`** ⇒ không giấy phép nào sinh ra được nó. Ca `B-0` khoá tính chất này.
 */
export const SHARED_BASELINE_KEY = "vram:baseline";

/**
 * ★★★ NỀN DÙNG CHUNG — thứ mà **MỘT** tiến trình chụp và các tiến trình khác **ĐỌC**.
 *
 * ⚠ `atMs` là **mốc CÔNG BỐ GẦN NHẤT (nhịp sống)**, KHÔNG phải mốc chụp. Người chụp ghi lại hàng
 * này ở MỌI lượt đồng bộ (xem `vramSharedLedgerStore.chayMotLuot`), nên tuổi của nó trả lời
 * *"chủ nhân còn sống không"* — đúng câu hỏi mà một cuộc bầu cần — chứ không phải *"con số này đo
 * lúc nào"*. Nền là một đại lượng gần như HẰNG (desktop/compositor/hộ bên thứ ba), nên tuổi của
 * con số không phải rủi ro; **chủ nhân đã chết mà hàng còn nằm đó** mới là rủi ro.
 */
export interface SharedBaselineRecord {
  /** `${role}:${pid}:${bootMs}` của NGƯỜI CHỤP. */
  readonly processKey: string;
  /** PID của người chụp — lấy thẳng từ cột, không tách chuỗi lại lần thứ hai. */
  readonly pid: number;
  /** Nền THIẾT BỊ (byte) — đã trừ cả sổ cục bộ của người chụp LẪN byte anh em. */
  readonly bytes: number;
  /** THƯỚC đã dùng để chụp. Người đọc phải biết, nếu không là so hai thước (lệch 165-178 MiB). */
  readonly source: "native" | "smi";
  /** Người chụp có tuyên bố nền này ĐÃ XÁC MINH không. Người đọc KHÔNG được nâng cấp cờ này. */
  readonly verified: boolean;
  /** Mốc công bố gần nhất (`updatedAt`). */
  readonly atMs: number;
}

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
  /**
   * ★★★ Task 3 — HÀNG NỀN DÙNG CHUNG, đã TÁCH khỏi `foreignLeases`/`foreignBytes`.
   *
   * ⚠⚠ TÁCH LÀ BẮT BUỘC, KHÔNG PHẢI GỌN GÀNG: nền **KHÔNG PHẢI byte của anh em** — nó là byte của
   * desktop/hộ bên thứ ba, và nó đã bị TRỪ khỏi `attributable`. Để nó lọt vào `foreignBytes` là
   * cộng nó lần thứ hai vào vế SỔ ⇒ mọi lượt xin bị trừ oan đúng một lần nền (~1 GB), và tệ hơn:
   * `drift` lệch âm đúng bằng đó. Phép tách nằm ở **một chỗ duy nhất** (`publishSharedLedgerReplica`).
   * `null` = bảng chưa có hàng nền (chưa ai chụp / chưa ai công bố kịp).
   */
  readonly baseline: SharedBaselineRecord | null;
  /** Danh tính đã dùng để lọc — ghi lại để một lượt đổi danh tính không âm thầm đọc số cũ. */
  readonly selfKey: string;
  /**
   * ★ Pha 3 Task 4 — **TOÀN BỘ hàng đúng như lượt đọc trả về** (kể cả hàng của ta và hàng nền).
   *
   * ⚠ VÌ SAO PHẢI GIỮ: `loaiHangDaChungMinhLaMa()` cần dựng lại bản sao **thiếu đúng mấy hàng MA**,
   * và nó chỉ được phép dùng LẠI người dựng (`dungBanSao`) chứ không được viết bản thứ hai của
   * phép tách/cộng (ràng buộc 12). Không có ô này thì hàng của CHÍNH TA — thứ đã bị lọc khỏi
   * `foreignLeases` — sẽ **biến mất vĩnh viễn** sau lượt dọn đầu tiên.
   */
  readonly rows: readonly SharedLeaseRow[];
}

/**
 * Thứ mà đường quyết định (`applyEnforcement`) thật sự cần biết. `null` ⇔ **CHƯA LÀM MỚI LẦN NÀO**.
 * ⚠ Cùng kỷ luật với `VramUnledgeredFact`: `null` là *"chưa hỏi"*, KHÔNG phải *"đã kiểm, không có"*.
 */
export type SharedLedgerFact = {
  readonly foreignBytes: number;
  /**
   * ★★★ Pha 3 Task 5 (C) — **HỘ CỦA ANH EM, ĐỦ CHI TIẾT ĐỂ GỌI TÊN.** Đúng những hàng đã sinh ra
   * `foreignBytes` (cùng một lượt lọc, cùng một bản sao), nên câu từ chối không thể in ra một con
   * số và một danh sách đến từ hai thời điểm khác nhau.
   *
   * ⚠ VÌ SAO Ở ĐÂY CHỨ KHÔNG PHẢI ĐỂ NGƯỜI GỌI TỰ ĐỌC `readSharedLedgerReplica()`: `reserve()`
   * ĐỒNG BỘ và nó đã nhận `SharedLedgerFact` làm tham số — thêm một lượt đọc thứ hai là lấy hai vế
   * của cùng một sự thật ở hai thời điểm, đúng lớp lỗi "hai bản cài đặt song song trôi khỏi nhau".
   */
  readonly foreignHolders: readonly SharedLeaseRow[];
  readonly ageMs: number;
  /** Số lượt ghi CỦA TA chưa lên được sổ chung. `> 0` ⇒ anh em **không thấy** ta. */
  readonly unsyncedWrites: number;
  /** Số lượt đồng bộ HỎNG LIÊN TIẾP. `≥ 1` ⇒ tuổi sẽ KHÔNG tự trẻ lại. */
  readonly consecutiveFailures: number;
  /**
   * ★★★ Pha 6 Task 5 — Số hàng **CỦA TA** đang công bố dưới một **DANH TÍNH CỤT**.
   *
   * ⚠⚠ Đây là **chỗ lời khai tới được một người đọc**, và nó phải là một Ô TRẠNG THÁI chứ không
   * phải một dòng log: lượt cắt xảy ra **mỗi nhịp đồng bộ** (60 s) cho **cùng** một giấy phép, nên
   * một dòng log là một dòng lặp vô hạn rồi cuộn mất, còn một con số thì **đứng yên và đọc được**.
   * ⚠ KHÁC `unsyncedWrites` và **không được gộp**: `unsyncedWrites > 0` = *"anh em CHƯA THẤY ta"*;
   * ô này = *"anh em ĐANG THẤY ta, dưới một cái tên KHÔNG PHẢI tên ta"*. Hai sự cố khác nhau, hai
   * cách chữa khác nhau (đợi đồng bộ ↔ đổi thư mục model / nới cột).
   * ⚠ **KHÔNG** đi vào `applyEnforcement()`: một danh tính cụt **không làm sai một byte nào** của
   *   phép tính dư địa. Siết dư địa vì nó là bịa ra chính sách — đúng lớp lỗi *"an toàn là HỆ QUẢ
   *   của một thứ khác đang hỏng"*.
   */
  readonly truncatedIdentityWrites: number;
  /**
   * ★★★ Pha 7 Task 5 (B) — Số hàng trong sổ chung mà **KHÔNG AI BIẾT** danh tính có bị cắt hay
   * không: cột `identityTruncated` là `NULL`, tức **người ghi hàng ấy chưa biết cột này tồn tại**.
   *
   * ⚠⚠ VÌ SAO NÓ PHẢI LÀ MỘT Ô RIÊNG chứ không gộp vào ô trên, và cũng không im lặng: gộp vào
   * `truncatedIdentityWrites` là khai *"đã cắt"* cho một hàng ta **không biết**; bỏ qua nó là khai
   * *"sạch"* cho cùng hàng ấy. **Cả hai đều là bịa.** Đây đúng vế thứ ba của kỷ luật
   * `TrangThaiTienTrinh` (`"song" | "chet" | "khong-biet"`), và bỏ vế ấy là mở lại đúng cửa
   * fail-open mà cả lượt này sinh ra để đóng.
   * ⚠ `> 0` là **BÌNH THƯỜNG và TẠM THỜI** trong cửa sổ triển khai (migration đã áp, một tiến trình
   *   cũ còn sống). Nó phải về 0 sau khi mọi tiến trình đã lên bản mới. Đứng lì `> 0` ⇒ còn một
   *   tiến trình cũ đang ghi vào sổ chung.
   */
  readonly unknownIdentityRows: number;
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
    // ★ Task 5 (C) — ĐÚNG tập hàng đã sinh ra `foreignBytes` ngay trên. Hàng NỀN đã bị tách khỏi
    // `foreignLeases` từ Task 3 và nó KHÔNG được có mặt ở đây: nền không phải "hộ của anh em".
    foreignHolders: banSao.foreignLeases,
    // Đồng hồ chạy lùi / số bẩn ⇒ **tuổi âm** là vô nghĩa. Trả nguyên số cho `applyEnforcement`
    // (nó lấy TRẦN biên cho tuổi không đọc được — chiều CHẶT), KHÔNG kẹp về 0 ở đây.
    ageMs: tuoi,
    unsyncedWrites: soLuotGhiHong + demYDinhDoiByte(),
    consecutiveFailures: soLuotDongBoHongLienTiep,
    truncatedIdentityWrites: demDanhTinhBiCat() + demAnhEmBiCat(banSao),
    unknownIdentityRows: demAnhEmKhongBiet(banSao),
  };
}

/**
 * ★★★ Pha 7 Task 5 (B) — **HÀNG CỦA ANH EM ĐANG MANG MỘT DANH TÍNH CỤT.**
 *
 * ⚠⚠ VÌ SAO CỘNG VÀO CÙNG MỘT Ô với `demDanhTinhBiCat()` (hàng CỦA TA): câu hỏi mà người đọc — cả
 * người lẫn Agent — thật sự hỏi là ***"có bao nhiêu hàng trong sổ chung đang mang một cái tên
 * KHÔNG PHẢI tên thật"***, chứ không phải *"ai là người đã cắt"*. Trước Pha 7 ô này chỉ đếm hàng
 * của ta **vì đó là tất cả những gì tiến trình này BIẾT** — nay nó biết cả hàng anh em, nên phạm vi
 * của ô đi theo **sự thật**, không theo giới hạn cũ của phép đo.
 * ⚠ **KHÔNG đếm hai lần**: `publishSharedLedgerReplica()` đã lọc hàng của TA ra khỏi
 *   `foreignLeases`, nên hai tập **rời nhau** theo cấu tạo.
 * ⚠ `null` (KHÔNG BIẾT) **KHÔNG** được tính ở đây — nó đi vào `unknownIdentityRows`.
 */
function demAnhEmBiCat(bs: SharedLedgerReplica): number {
  return bs.foreignLeases.filter((r) => r.identityTruncated !== null && r.identityTruncated.length > 0).length;
}

/** Hàng anh em mà **người ghi chưa khai** (cột `NULL`) ⇒ **KHÔNG BIẾT**. Xem `unknownIdentityRows`. */
function demAnhEmKhongBiet(bs: SharedLedgerReplica): number {
  return bs.foreignLeases.filter((r) => r.identityTruncated === null).length;
}

/**
 * ★★★ Pha 6 Task 5 — **ĐẾM HÀNG, KHÔNG ĐẾM LƯỢT.**
 *
 * ⚠⚠ VÌ SAO KHÔNG PHẢI MỘT BỘ ĐẾM TĂNG DẦN, và đây là bài học **I-3 nguyên văn** chứ không phải lo
 * xa: `dungLaiTuSoCucBo()` dựng lại ý định `upsert` cho **MỌI** giấy phép còn sống ở **MỌI** lượt
 * đồng bộ (60 s). Một bộ đếm tăng dần sẽ leo mãi cho **cùng một** giấy phép ⇒ *"một cờ luôn bật là
 * một cờ không còn thông tin"*. Câu hỏi đúng là **"BAO NHIÊU HÀNG đang mang tên cụt"**, và câu trả
 * lời ấy tự về 0 khi giấy phép được nhả hoặc khi đường dẫn model ngắn lại.
 *
 * ⚠ Cùng khuôn `demYDinhDoiByte()`: **trạng thái ĐÃ GỬI** (`hangDaCat`) **hợp** với **ý định ĐANG
 * CHỜ** (`hangCho`), vì một lượt cắt vừa xếp hàng thì anh em chưa thấy nhưng ta **đã biết**, và
 * giấu nó tới nhịp sau là đúng thứ task này sinh ra để diệt.
 */
function demDanhTinhBiCat(): number {
  const bo = new Set(hangDaCat);
  for (const w of hangCho) {
    if (w.op === "delete" || w.daCat.length === 0) bo.delete(w.leaseKey);
    else bo.add(w.leaseKey);
  }
  return bo.size;
}

/**
 * Khoá của những hàng **ĐÃ LÊN sổ chung** với ít nhất một ô danh tính bị CẮT.
 * ⚠ Chỉ `noteSharedLedgerWritesApplied()` ghi — cùng kỷ luật `byteDaGui`: ghi trước lượt `apply()`
 * trót lọt là khai "anh em đang thấy" cho một hàng còn nằm trong hàng đợi.
 */
const hangDaCat = new Set<string>();

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
 * mục nào trong `byteDaGui` ⇒ `cu === undefined` ⇒ **vẫn đếm**. Chỉ những ý định thật sự không
 * đổi byte mới rơi ra ngoài.
 *
 * ⚠⚠ m-1 (review TOÀN NHÁNH) — **PHÉP ĐẾM CHỈ ĐỌC `byteDaGui`, KHÔNG ĐỌC BẢN SAO.** Bản trước dựng
 * một `Map` từ `banSao.foreignLeases` rồi **không bao giờ đọc nó**; người đọc sẽ tưởng byte đã công
 * bố của **anh em** tham gia phép đếm này. Không — câu hỏi ở đây là *"TA đã gửi được con số nào"*,
 * và bản sao **không** trả lời được nó (hàng của ta đã bị `publishSharedLedgerReplica()` lọc ra).
 * ⚠ Và `refCount` KHÔNG bị bỏ rơi: nó vẫn đi lên sổ chung ở lượt sync kế, và `vramWiring` nay hẹn
 * một lượt sync ngay sau khi đồng bộ `refCount` (nếu không, ô mà Task 5 đứng lên **cũ tới 60 s**).
 * Nó chỉ thôi **giả vờ là một sự cố đồng bộ**.
 */
function demYDinhDoiByte(): number {
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
    if (w.op === "delete") {
      byteDaGui.delete(w.leaseKey);
      // ★ Task 5 — hàng đã rời sổ thì nó thôi mang tên cụt; giữ lại là khai một sự cố đã hết.
      hangDaCat.delete(w.leaseKey);
      continue;
    }
    byteDaGui.set(w.leaseKey, w.row.bytes);
    // ★ Task 5 — LƯỢNG TỪ hai chiều: `daCat` rỗng phải **XOÁ** dấu, không chỉ "không thêm". Một
    //   giấy phép từng bị cắt rồi được công bố lại với danh tính đủ (đổi thư mục model) mà vẫn bị
    //   đếm là một cờ **không bao giờ tắt** — đúng lớp nhiễu I-3.
    if (w.daCat.length > 0) hangDaCat.add(w.leaseKey);
    else hangDaCat.delete(w.leaseKey);
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
  /**
   * ★★★ Task 3 — PHÉP TÁCH DUY NHẤT giữa "hàng nền" và "giấy phép". Đặt ở đây vì đây là chỗ
   * **mọi** người đọc đi qua, bất kể cổng thật (Drizzle) hay cổng giả (test): một phép lọc đặt
   * trong câu SQL của cổng thật sẽ KHÔNG có mặt ở cổng giả, và bộ ca sẽ canh một hình dạng dữ
   * liệu mà sản xuất không bao giờ thấy (ràng buộc 10 — lưới theo ĐƯỜNG THOÁT, không theo file).
   */
  banSao = dungBanSao(rows, atMs, selfKey);
  soLuotDongBoHongLienTiep = 0;
}

/** NGƯỜI DỰNG DUY NHẤT của một bản sao đọc. Thuần — không đụng bộ đếm hỏng, không I/O. */
function dungBanSao(
  rows: readonly SharedLeaseRow[],
  atMs: number,
  selfKey: string,
): SharedLedgerReplica {
  const hangNen = rows.find((r) => r.leaseKey === SHARED_BASELINE_KEY) ?? null;
  const ngoai = rows.filter((r) => r.leaseKey !== SHARED_BASELINE_KEY && r.processKey !== selfKey);
  let tong = 0;
  for (const r of ngoai) if (Number.isFinite(r.bytes) && r.bytes > 0) tong += r.bytes;
  return Object.freeze({
    atMs,
    foreignBytes: tong,
    foreignLeases: Object.freeze([...ngoai]),
    baseline: hangNen === null ? null : baselineFromRow(hangNen),
    selfKey,
    rows: Object.freeze([...rows]),
  });
}

/**
 * ★★★ Pha 3 Task 4 — **VỨT KHỎI BẢN SAO NHỮNG HÀNG VỪA ĐƯỢC CHỨNG MINH LÀ MA.**
 *
 * ⚠⚠ VÌ SAO BẮT BUỘC, VÀ NÓ ĐƯỢC TÌM RA BỞI **NGHIỆM THU SỐNG**, không phải bởi suy luận: lệnh
 * `delete` chỉ được **XẾP HÀNG** (nó phải thế — `reserve()` đồng bộ), nên nếu bản sao không được
 * dọn thì **chính nhịp vừa chứng minh hàng là MA** vẫn đem 17.000 MiB ma đó đi tính lệch. Số đo
 * của lượt nghiệm thu: `LỆCH −16.671 MiB` + `alarm = true` + một dòng `drift` vào DB, cho một khối
 * byte mà nhịp đó **vừa tự tay tuyên bố là không tồn tại**. Và tệ hơn: hàng `vram:baseline` của
 * đúng tiến trình đã chết đó vẫn được `captureVramBaseline()` **NHẬN NUÔI** (`baselineOrigin =
 * "adopted"`, nền đọc từ một tiến trình không còn tồn tại).
 * ⇒ *"Một nhịp không được vứt đi bằng chứng của chính nó"* — cùng lớp lỗi với `?? mặc_định` nuốt
 * một câu trả lời đã có.
 *
 * ⚠ KHÔNG chạm `soLuotDongBoHongLienTiep`: đây KHÔNG phải một lượt đọc thành công, và xoá chuỗi
 * hỏng ở đây là để một lượt DỌN che mất một DB đang hỏng (đúng lỗi mà `noteSharedLedgerSyncFailure`
 * ở `chayMotLuot` phải thêm một dòng để tránh).
 * ⚠ `atMs` GIỮ NGUYÊN: bản sao **không trẻ lại**. Ta chỉ biết một số hàng đã chết, không biết gì
 * mới về những hàng còn lại — làm trẻ nó là khai một phép đo chưa xảy ra.
 */
export function loaiHangDaChungMinhLaMa(leaseKeys: readonly string[]): void {
  if (banSao === null || leaseKeys.length === 0) return;
  const bo = new Set(leaseKeys);
  banSao = dungBanSao(
    banSao.rows.filter((r) => !bo.has(r.leaseKey)),
    banSao.atMs,
    banSao.selfKey,
  );
}

/**
 * Đọc NỀN DÙNG CHUNG. **ĐỒNG BỘ, không I/O** — cùng kỷ luật `readSharedLedgerReplica()`.
 * `null` = chưa làm mới lần nào **HOẶC** chưa ai công bố nền. Hai thứ đó KHÁC NHAU với người gọi
 * (`readSharedLedgerReplica() === null` phân biệt được), nên hàm này KHÔNG gộp chúng lại thành một
 * câu trả lời — nó chỉ trả về thứ đang có.
 */
export function readSharedBaseline(): SharedBaselineRecord | null {
  return banSao?.baseline ?? null;
}

/**
 * ★★★ NỀN **CỦA CHÍNH TA** ĐANG CÔNG BỐ — `null` ⇔ ta KHÔNG phải người chụp.
 *
 * ⚠ MỘT biến, MỘT người ghi (`vramReconciler.captureVramBaseline`), MỘT người đọc
 * (`vramSharedLedgerStore`) — đúng khuôn `MocCaiChet` của Task 1, để không đẻ ra bản sao thứ hai
 * của vị từ *"ai là người chụp nền"* (ràng buộc 12).
 * ⚠ Hàng này KHÔNG đi qua `enqueueSharedLedgerWrite()`: hàng đợi bị `drainSharedLedgerWrites()`
 * dọn sạch mỗi lượt và chỉ lệnh `delete` sống sót (`upsert` được dựng lại từ sổ CỤC BỘ), nên một ý
 * định `upsert` nền xếp hàng ở đó sẽ **bị nuốt im lặng**. Đặt ở một ô TRẠNG THÁI và cho lượt đồng
 * bộ dựng lại mỗi lần chính là **nhịp sống** mà cuộc bầu cần.
 */
let nenCuaTa: SharedBaselineRecord | null = null;

/** Chỉ `vramReconciler` gọi. `null` = thôi làm người chụp (đã nhường / đã đọc nền của người khác). */
export function publishOwnSharedBaseline(rec: SharedBaselineRecord | null): void {
  nenCuaTa = rec;
}

/** Chỉ `vramSharedLedgerStore` gọi — nguồn của hàng nền trong mỗi lô ghi. */
export function ownSharedBaseline(): SharedBaselineRecord | null {
  return nenCuaTa;
}

/**
 * ★★★ GIẤY THÔNG HÀNH: `SharedBaselineRecord` → MỘT HÀNG `vram_leases`. **BẢN DỊCH DUY NHẤT.**
 *
 * ⚠⚠ BA Ô ĐANG MANG NGHĨA KHÁC — đây là cái giá của việc KHÔNG chạy DDL, và nó phải được đọc to:
 *   | cột | nghĩa cho GIẤY PHÉP | nghĩa cho HÀNG NỀN |
 *   |---|---|---|
 *   | `leaseId`  | id giấy phép trong tiến trình | **THƯỚC** (`"native"` \| `"smi"`) |
 *   | `measured` | `bytes` do một THƯỚC đẻ ra | **`baselineVerified` của người chụp** |
 *   | `bytes`    | byte của giấy phép | **byte NỀN** |
 * `owner` cố định `"reconciler:baseline"` để đọc bảng bằng mắt là nhận ra ngay.
 * Ai đổi bảng này phải đổi `baselineFromRow()` ngay dưới — ca `B-1` khoá vòng đi-về.
 *
 * ⚠ `leaseKind`/`priority` là hai ô **KHÔNG mang tin**: chúng phải hợp lệ để `varchar` nhận, và
 * `"external-process"`/`"background"` là cặp trung tính nhất (không hộ nào thu hồi được hàng này —
 * `reclaimer: null`).
 */
export function rowFromBaseline(rec: SharedBaselineRecord): SharedLeaseRowKetQua {
  const [role = "all"] = rec.processKey.split(":");
  // ★ Task 5 — hàng NỀN cũng là một đường CẮT (`processKey` 96 · `role` 32) ⇒ nó cũng phải khai.
  //   Lượng từ là *"MỌI đường dựng hàng"*, không phải *"đường dựng GIẤY PHÉP"*.
  const daCat: VramLeaseColumn[] = [];
  return {
    daCat,
    row: {
      leaseKey: SHARED_BASELINE_KEY,
      processKey: catO("processKey", rec.processKey, daCat),
      pid: soHuuHan(rec.pid, 0),
      role: catO("role", role, daCat),
      leaseId: rec.source,
      owner: "reconciler:baseline",
      leaseKind: "external-process",
      priority: "background",
      // ⚠ Nền ÂM là vô nghĩa; `0` là giá trị dự phòng duy nhất KHÔNG BỊA (cùng kỷ luật `rowFromLease`).
      bytes: Math.max(0, soHuuHan(rec.bytes, 0)),
      measured: rec.verified,
      refCount: 1,
      reclaimer: null,
      acquiredAtMs: soHuuHan(rec.atMs, 0),
      updatedAtMs: soHuuHan(rec.atMs, 0),
      /** ★ Pha 7 Task 5 (B) — hàng NỀN cũng khai, cùng lý do và cùng vị trí (xem `rowFromLease`). */
      identityTruncated: Object.freeze([...daCat]),
    },
  };
}

/**
 * Chiều ngược lại. `null` ⇔ hàng KHÔNG đọc được thành một nền — và **`null` ở đây phải được người
 * gọi hiểu là "KHÔNG CÓ NỀN DÙNG CHUNG", tức đi chụp lấy, TUYỆT ĐỐI không phải "nền = 0"**.
 *
 * ⚠ Từ chối THẲNG một hàng có thước lạ thay vì đoán `"smi"`: thước sai làm phép so lệch 165-178
 * MiB **âm thầm**, còn từ chối thì người đọc tự đi chụp lấy một nền có thước ĐÚNG của mình.
 */
export function baselineFromRow(row: SharedLeaseRow): SharedBaselineRecord | null {
  if (row.leaseKey !== SHARED_BASELINE_KEY) return null;
  if (row.leaseId !== "native" && row.leaseId !== "smi") return null;
  if (!Number.isFinite(row.bytes) || row.bytes < 0) return null;
  if (!Number.isFinite(row.updatedAtMs)) return null;
  return {
    processKey: row.processKey,
    pid: Number.isFinite(row.pid) ? row.pid : 0,
    bytes: row.bytes,
    source: row.leaseId,
    verified: row.measured === true,
    atMs: row.updatedAtMs,
  };
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
): SharedLeaseRowKetQua {
  const [role = "all", pidText = "0"] = selfKey.split(":");
  const daCat: VramLeaseColumn[] = [];
  return {
    daCat,
    row: {
      leaseKey: catO("leaseKey", `${selfKey}#${lease.id}`, daCat),
      processKey: catO("processKey", selfKey, daCat),
      pid: soHuuHan(Number(pidText), 0),
      role: catO("role", role, daCat),
      leaseId: catO("leaseId", lease.id, daCat),
      owner: catO("owner", lease.request.owner, daCat),
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
      /**
       * ★ Pha 7 Task 5 (B) — lời khai đi **CÙNG HÀNG**, không chỉ đi cùng kiểu.
       * ⚠ ĐẶT **CUỐI CÙNG** có chủ ý: mọi lượt `catO()` ở trên phải chạy xong thì `daCat` mới đủ.
       * ⚠ **BẢN SAO ĐÔNG CỨNG**, không phải chính `daCat`: một tham chiếu chung sẽ để người gọi sửa
       *   lời khai của hàng qua mảng kia (và ngược lại) — hai người ghi cho **một** sự thật.
       */
      identityTruncated: Object.freeze([...daCat]),
    },
  };
}

function soHuuHan(v: number, mac: number): number {
  return Number.isFinite(v) ? Math.trunc(v) : mac;
}

/**
 * ★★★ M-1 (review vòng 1) — **CẮT ĐỘ RỘNG `varchar`. Bản trước chỉ lọc SỐ, và tiền lệ mà chính
 * docstring này viện dẫn (migration 0311) là một lỗi CHUỖI.**
 * ★★★ Pha 6 Task 5 (I-2, đầu THỨ BA) — **VÀ NAY NÓ KHAI RA LƯỢT CẮT.**
 *
 * `owner` là chuỗi **ĐỘNG lấy từ ĐƯỜNG DẪN TUYỆT ĐỐI**: `ocrService.ts:384` dựng
 * `onnx-ocr:${modelPath}`, `aiReranker.ts:503` dựng `reranker:${modelPath}`.
 *
 * ⚠⚠ **SỐ ĐO 2026-08-07, KHÔNG PHẢI SUY ĐOÁN** (Bước 1 của Task 5):
 *   • `max(length(owner))` **hiện tại** — `vram_leases` **54** / `vram_events` **54**, trần **160**;
 *   • `owner` sản xuất **dài nhất có thể** — **≥ 365**: một `modelPath` tuyệt đối **356 ký tự** đã
 *     được dựng THẬT trên máy này (12 nấc thư mục), và `LongPathsEnabled=1` ⇒ trần đường dẫn là
 *     **32.767**, không phải `MAX_PATH` 260. **365 / 160 = 2,28×.**
 * ⇒ Trần cột **không bao giờ** đuổi kịp trần đường dẫn. Nới cột chỉ **dời chỗ nói dối**; thứ đóng
 *   được lớp lỗi là **nói ra lượt cắt**.
 *
 * ⚠ VÀ HẬU QUẢ Ở ĐÂY NẶNG HƠN Ở `vram_events`: `22001` làm **mất cả lô**, rồi
 * `requeueSharedLedgerWrites()` **ném lại đúng hàng độc** ⇒ hỏng **VĨNH VIỄN**, `unsyncedWrites`
 * không bao giờ về 0, và chỉ **một** dòng cảnh báo (`keuMotLan` kêu một lần mỗi quãng hỏng). Tức
 * cơ chế thử-lại — thứ được dựng để chống mất dữ liệu — **biến một lỗi tạm thành một lỗi chết**.
 *
 * ⚠ CẮT chứ không VỨT: cùng kỷ luật `sanitizeVramEvent()` — *"vứt dòng đi là đổi một lỗi im lặng
 * lấy một lỗi im lặng khác"*. Và `sanitizeVramEvent()` cũng là **tiền lệ về hình dạng lời khai**:
 * nó đã ghi `detail.truncatedFields` từ trước; `vramSharedLedger` là chỗ **cuối cùng** còn im lặng.
 *
 * ⚠ **MỘT phép cắt duy nhất của repo** — `catChuoi()` ở `@shared/textSafety`. Hàm `cat()` cũ ở đây
 * là **bản sao thứ hai** và nó **không có cờ**; xoá nó là một phần của bản vá, không phải dọn dẹp.
 * Ai đổi độ rộng cột ở `drizzle/0312_vram_leases.sql` phải đổi `VRAM_LEASE_COLUMN_MAX` — và ca
 * `sharedLedgerIdentityCut.test.ts` khoá hai bên khớp nhau **theo lượng từ ∀ cột**, không theo một
 * danh sách viết tay.
 */
function catO(o: VramLeaseColumn, s: string, ra: VramLeaseColumn[]): string {
  const { cau, daCat } = catChuoi(s, VRAM_LEASE_COLUMN_MAX[o]);
  // ⚠ BIÊN: `catChuoi` khai `daCat` ⇔ `s.length > trần`. Một chuỗi dài **ĐÚNG BẰNG** trần
  //   **KHÔNG** bị cắt và **KHÔNG** được khai — phép so `cau.length === trần` ở đầu kia là bản sao
  //   thứ hai của vị từ, và bản sao ấy SAI đúng ở ô biên này (M-5).
  if (daCat) ra.push(o);
  return cau;
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
  // Task 5 (Pha 6) — cùng lý do: ca sau thừa kế "ta đang công bố một danh tính CỤT" của ca trước.
  hangDaCat.clear();
  // Task 3 — cùng lý do, và hậu quả nặng hơn: ca sau thừa kế "ta là NGƯỜI CHỤP NỀN" của ca trước ⇒
  // hai tiến trình cùng chụp, đúng lỗi task này sinh ra để diệt, ở một file test chẳng liên quan.
  nenCuaTa = null;
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
  return {
    foreignBytes: 0,
    foreignHolders: [],
    ageMs: 0,
    unsyncedWrites: 0,
    consecutiveFailures: 0,
    truncatedIdentityWrites: 0,
    unknownIdentityRows: 0,
  };
}

/**
 * Chỉ dùng trong test — đóng vai MỘT TIẾN TRÌNH KHÁC trên cùng một bảng. Không có nó thì "hai
 * tiến trình" chỉ dựng được bằng cách tự khai `foreignBytes` bằng tay, tức một lưới đi theo FILE
 * chứ không theo ĐƯỜNG THOÁT (ràng buộc 10, đã tái diễn SÁU lần).
 */
export function __setSharedLedgerSelfKeyForTests(key: string | null): void {
  selfKeyOverride = key;
}
