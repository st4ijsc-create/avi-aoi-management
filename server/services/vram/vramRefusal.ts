/**
 * ★★★ Pha 2B Task 4 — TỪ CHỐI TRUNG THỰC (§5.3). **CHƯA cưỡng chế gì cả**: file này dựng CÂU CHỮ
 * và CẤU TRÚC của lời từ chối; việc BẬT nằm ở Task 5.
 *
 *     VramRefusedError phải mang BỐN thứ:
 *     xin bao nhiêu · còn bao nhiêu · ai đang giữ gì · ai có thể nhường
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ RÀNG BUỘC LỚN NHẤT — CÂU LỖI KHÔNG ĐƯỢC HỨA NHIỀU HƠN DỮ LIỆU.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Ta chỉ nêu được *"ai đang giữ"* cho các hộ **ĐÃ NỐI SỔ**. Hôm nay là **15 điểm nối trên 160
 * dòng liệt kê** (`vramAllocationSites.ts`), và bản liệt kê đó **tự khai chỉ là CẬN DƯỚI** —
 * §5.6b chứng minh bằng đo rằng quyết định thành viên bằng mẫu quét là bài toán KHÔNG QUYẾT ĐỊNH
 * ĐƯỢC (lớp alias vẫn mở: một đột biến chỉ đổi tên biến đã đi lọt 10/10 xanh).
 *
 * ⇒ Vì thế **mọi** lời từ chối sinh ra ở đây đều mang một phần **"KHÔNG quy trách nhiệm được"**.
 * Đây không phải lời rào đón cho lịch sự: một câu nói *"các tiến trình đang giữ: A, B"* trong khi
 * C, D, E vô hình sẽ khiến người trực **đi giết nhầm** — và *"tuyên bố mạnh hơn mã"* đã là lớp
 * lỗi bị bắt **bảy lần** trong chuỗi này.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ BÀN GIAO (1) TỪ TASK 2 — `-Infinity` LÀ GIÁ TRỊ FAIL-CLOSED **HỢP LỆ** CỦA `computeHeadroom`.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Task này **IN SỐ**, nên nó **phải đọc `degradedReasons` TRƯỚC KHI IN**. Và ống dẫn sự kiện có
 * **hai bẫy im lặng đã đo được** (`drizzle/schema/vram.ts:43-48`):
 *   1. cột byte là `bigint(mode: "number")` ⇒ Postgres **từ chối** `"-Infinity"` ⇒ lượt `insert`
 *      ném ⇒ `vramEventLog` ghi theo LÔ nên **MẤT CẢ LÔ**;
 *   2. `detail` là `jsonb` ⇒ `JSON.stringify(-Infinity)` cho **`null`** — con số biến mất IM LẶNG.
 * ⇒ Bất biến của file này: **không một giá trị không hữu hạn nào rời khỏi đây** — không vào câu
 * chữ, không vào `params` của mã lỗi. Số không hữu hạn bị thay bằng `null` (cấu trúc) / `"?"`
 * (câu chữ) và **luôn kèm một cái tên**, không bao giờ bị bịa thành `0`.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ BÀN GIAO (2) TỪ TASK 3 — `unledgeredBytes` LÀ **ƯỚC LƯỢNG**, KHÔNG PHẢI SỐ ĐO.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Đính chính đã trả giá ba vòng: GGUF 30B `fileBytes` **17.690.497.440 B** vs `actualBytes` đo
 * được **17.511.354.368 B** ⇒ file **CAO HƠN 170,8 MiB** (cận **TRÊN** ở hộ chi phối ngân sách),
 * nhưng reranker **ngược lại 2,1 lần** ⇒ **KHÔNG có hệ số chung**. Và `unknownCount > 0` làm con
 * số ấy **mất tin cậy** chứ không phải "nhỏ đi": mọi hộ ONNX/sidecar/`gguf-context` đóng góp
 * **0 byte** vào `unledgeredBytes`, chúng **chỉ** hiện ở `unknownCount`.
 * ⇒ Ở đây `unknownCount > 0` **thắng mọi hình dạng khác** khi chọn câu cảnh báo, và câu đó nói
 * thẳng *"đừng dùng con số này để tính"*.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ QUY TẮC MANG SANG TỪ TASK 3 — *mỗi khi viết `?? <mặc_định>` cho một ĐƯỜNG RA, cái mặc định đó
 * là một **DÂY**, và dây thì phải có **LƯỚI***. File này **không có** một `?? <mặc_định>` nào trên
 * đường ra. Ô nguy hiểm nhất — *"có lượt cấp phát nào chạy ngoài sổ không"* — **không** mặc định
 * về `{ bytes: 0, unknownCount: 0 }`; nó là trường **BẮT BUỘC** kiểu `… | null`, và `null` nghĩa
 * **"CHƯA HỎI"**, hiện ra thành câu *"không biết lớn bao nhiêu"*. `tsc` chặn người gọi quên nó
 * (cùng cơ chế Task 2 dùng cho `baselineVerified`), và một ca test khoá đúng ngữ nghĩa `null`.
 *
 * ⚠ File này **thuần và đồng bộ**, và chỉ nhập **hằng số dữ liệu** + **kiểu**: `reserve()` phải
 * giữ ĐỒNG BỘ (ràng buộc 1) nên đường từ chối không được `await` bất cứ thứ gì.
 */
import type { VramPriority } from "./types";
import type { HeadroomDegradation } from "./vramHeadroom";
import type { AppErrorCode, AppErrorParams } from "../../_core/appErrorCodes";
/**
 * ⚠ VÌ SAO NHẬP HAI HẰNG SỐ NÀY THAY VÌ NHẬN QUA THAM SỐ: nhận qua tham số là dựng thêm một
 * **DÂY** (người gọi truyền nhầm/quên ⇒ câu lỗi khai một tỉ lệ bao phủ sai mà không lưới nào bắt).
 * Nhập thẳng thì con số trong câu **luôn** là con số của bản liệt kê hiện hành.
 * ⚠⚠ VÀ NÓ ĐƯỢC DÙNG ĐÚNG MỘT VAI: **lời cảnh báo về giới hạn hiểu biết**. Task 3 đã ghi rõ
 * *"Task 5 KHÔNG được dùng `WIRED_ALLOCATION_SITE_COUNT` như một BẢO ĐẢM"* — ở đây nó không bảo
 * đảm gì cả, nó nói ra rằng danh sách **không đầy đủ**. Hai chiều dùng ngược nhau hoàn toàn.
 * (`vramAllocationSites.ts` là module DỮ LIỆU thuần: không import, không tác dụng phụ.)
 */
import { KNOWN_ALLOCATION_SITE_ROW_COUNT, WIRED_ALLOCATION_SITE_COUNT } from "./vramAllocationSites";

const BYTES_PER_MIB = 1024 * 1024;

/** Một hộ đang giữ chỗ trong SỔ. ⚠ `bytes` có thể là ƯỚC LƯỢNG — xem `measured`. */
export interface VramHolderFact {
  readonly owner: string;
  readonly kind: string;
  /** Byte đang chiếm theo sổ. **Không bảo đảm hữu hạn** ở đầu vào; đầu ra đã được lọc. */
  readonly bytes: number;
  readonly priority: VramPriority;
  /**
   * `true` ⇔ con số này do một THƯỚC đẻ ra (`measureSource !== "none"`), `false` ⇔ ước lượng.
   * ⚠ Phải khai ra: một câu từ chối in "17.000 MiB" mà không nói đó là ước lượng là đang cho
   * người trực một độ chính xác không có thật (types.ts `VramLease.actualBytes`, ba nhóm/hai ô).
   */
  readonly measured: boolean;
}

/**
 * Trạng thái ống dẫn "cấp phát đã chạy NGOÀI SỔ" (`vramWiring.vramBeginFailureState()`).
 *
 * ⚠⚠ `null` nghĩa **"CHƯA HỎI"**, KHÔNG phải "không có lượt nào". Đây chính là chỗ một
 * `?? { bytes: 0, unknownCount: 0 }` sẽ biến một câu *"tôi không biết"* thành *"tôi đã kiểm và
 * không có gì"* — lớp lỗi đắt nhất của cả chuỗi này.
 */
export type VramUnledgeredFact = { readonly bytes: number; readonly unknownCount: number } | null;

export interface VramRefusalInput {
  /** Byte đang xin. */
  readonly requestedBytes: number;
  /** Ai đang xin (chủ sở hữu của lượt xin, không phải hộ đang giữ). */
  readonly owner: string;
  readonly priority: VramPriority;
  /** `HeadroomResult.headroomBytes`. ⚠ **CÓ THỂ `-Infinity`** — fail-closed hợp lệ (Task 2 C-1). */
  readonly headroomBytes: number;
  /** `HeadroomResult.degradedReasons` — phải đọc TRƯỚC khi in số. */
  readonly degradedReasons: readonly HeadroomDegradation[];
  /** `HeadroomResult.blind` — ⚠ là CHẶN TRÊN, KHÔNG phải trạng thái an toàn. */
  readonly blind: boolean;
  /** `HeadroomInput.ledgerTotalBytes` — sổ SỐNG đã dùng để tính chính `headroomBytes` này. */
  readonly ledgerTotalBytes: number;
  /** `HeadroomResult.usedBytes` = `max(ledgerTotalBytes, attributableBytes)`. */
  readonly usedBytes: number;
  readonly holders: readonly VramHolderFact[];
  readonly preemptable: readonly VramHolderFact[];
  /** ⚠ BẮT BUỘC CÓ MẶT (không optional): xem `VramUnledgeredFact`. */
  readonly unledgered: VramUnledgeredFact;
}

/**
 * HAI mã lỗi, KHÔNG phải một — và lý do là bàn giao (1), không phải khẩu vị đặt tên.
 *  • `VRAM_REFUSED` — dư địa là một SỐ: câu nói được *"còn bao nhiêu"*.
 *  • `VRAM_HEADROOM_UNKNOWN` — `headroomBytes` KHÔNG hữu hạn (`-Infinity` + `"invalid-input"`):
 *    hệ **từ chối để an toàn** mà **không biết** còn bao nhiêu. Một khuôn câu duy nhất có
 *    `{{availableMb}}` sẽ buộc ta hoặc in `-Infinity` (bẫy 1/2 của ống dẫn) hoặc bịa một con số.
 *    Đây đúng khuôn mà registry `APP_ERROR_CODES` đang dùng để tách `ENTITY_EXPIRED` khỏi
 *    `ENTITY_NOT_FOUND`: tình huống khác thì câu khác, không nhồi vào một mã.
 */
export type VramRefusalAppCode = "VRAM_REFUSED" | "VRAM_HEADROOM_UNKNOWN";

/**
 * Câu cảnh báo về **phần KHÔNG quy trách nhiệm được**, xếp theo mức nghiêm trọng GIẢM DẦN. Tên
 * chính là khoá `errors.reason.*` (khuôn Sprint 5 doc 71 Task 5 — camelCase, không phải câu viết
 * tay). Đúng MỘT khoá được chọn cho giao diện; câu máy chủ đầy đủ vẫn nằm ở `formatVramRefusal()`.
 */
export type VramRefusalCaveat =
  /** `unknownCount > 0` — có lượt chạy ngoài sổ mà **byte cũng không ước được** ⇒ ước lượng KHÔNG dùng được. */
  | "vramUnattributedUnreliable"
  /** MÙ (`blind`) hoặc **CHƯA HỎI** ống ngoài sổ ⇒ không biết phần ngoài sổ lớn bao nhiêu. */
  | "vramUnattributedUnknownExtent"
  /**
   * PHÁT HIỆN ĐƯỢC một khoản ngoài sổ — theo **một trong hai** đường: hiệu
   * `usedBytes − ledgerTotalBytes` (SỐ ĐO) **hoặc** `unledgeredBytes` (ƯỚC LƯỢNG).
   * ⚠ Tên cũ `vramUnattributedMeasured` đã ĐỔI (I-1): nó khai "đo được" trong khi nhánh này
   * cũng phục vụ một con số ƯỚC LƯỢNG — và câu nói sai loại số là đúng thứ §5.3 cấm.
   */
  | "vramUnattributedDetected"
  /** Sổ giải thích hết phần thiết bị ở nhịp gần nhất — nhưng sổ mới bao 15/160 dòng. */
  | "vramLedgerCoverageOnly";

export interface VramRefusalFacts {
  readonly appCode: VramRefusalAppCode;
  readonly owner: string;
  readonly priority: VramPriority;
  /** Xin bao nhiêu. `null` ⇔ đầu vào không hữu hạn (không bịa số). */
  readonly requestedBytes: number | null;
  /** Còn bao nhiêu. `null` ⇔ `headroomBytes` không hữu hạn ⇒ `appCode = VRAM_HEADROOM_UNKNOWN`. */
  readonly availableBytes: number | null;
  /** Ai đang giữ gì — **chỉ các hộ ĐÃ NỐI SỔ**. */
  readonly holders: readonly VramHolderFact[];
  /** Ai có thể nhường — mức THẤP HƠN mức đang xin. */
  readonly preemptable: readonly VramHolderFact[];
  /**
   * Tổng byte nhường được. `null` ⇔ **không cộng nổi** (tổng tràn thành `±Infinity`, dù từng số
   * hạng hữu hạn — M-1/M-2). Hộ có byte không dùng được bị bỏ khỏi phép cộng nhưng **vẫn được gọi
   * tên** trong `preemptable`.
   */
  readonly preemptableBytes: number | null;
  /** Phần thiết bị đang dùng mà sổ KHÔNG giải thích được. `null` ⇔ không đo được (mù/bẩn). */
  readonly unattributedBytes: number | null;
  /** ƯỚC LƯỢNG byte đã chạy ngoài sổ. `null` ⇔ CHƯA HỎI / không hữu hạn. */
  readonly unledgeredEstimateBytes: number | null;
  /** Số lượt ngoài sổ mà ngay cả byte cũng không ước được. `null` ⇔ CHƯA HỎI. */
  readonly unknownCount: number | null;
  readonly caveat: VramRefusalCaveat;
  readonly degradedReasons: readonly HeadroomDegradation[];
  readonly wiredSiteCount: number;
  readonly knownSiteRowCount: number;
}

/** Số dùng được cho phép cộng trừ byte. Cùng vị từ với `vramHeadroom.usable()`. */
function finiteOrNull(v: number): number | null {
  return Number.isFinite(v) ? v : null;
}

function mib(bytes: number | null): number | null {
  return bytes === null ? null : Math.round(bytes / BYTES_PER_MIB);
}

/** `"?"` chứ KHÔNG `"0"`: một ô trống nói thật, một số 0 bịa nói dối. */
function mibText(bytes: number | null): string {
  const m = mib(bytes);
  return m === null ? "?" : String(m);
}

function holderText(h: VramHolderFact): string {
  // `≈` = ước lượng chưa đo. Ký hiệu được GIẢI THÍCH ngay trong câu (xem `formatVramRefusal`) —
  // một ký hiệu không ai giải thích thì cũng là một câu hứa suông.
  return `${h.owner}${h.measured ? "=" : "≈"}${mibText(finiteOrNull(h.bytes))} MiB (${h.priority})`;
}

function holderListText(hs: readonly VramHolderFact[]): string {
  return hs.length === 0 ? "không có" : hs.map(holderText).join(", ");
}

/**
 * Dựng SỰ THẬT của một lời từ chối. **Thuần, đồng bộ, KHÔNG BAO GIỜ NÉM** — cùng lý do với
 * `computeHeadroom()`: đường này chạy bên trong `try` của `beginVramAllocation()`, mà `catch` ở đó
 * trả `NOOP_TICKET`; một cú ném ở đây sẽ biến "từ chối trung thực" thành "cấp phát ngoài sổ".
 */
export function buildVramRefusal(input: VramRefusalInput): VramRefusalFacts {
  const requestedBytes = finiteOrNull(input.requestedBytes);
  // ⚠ ĐỌC LÝ DO TRƯỚC KHI IN SỐ (bàn giao 1): `-Infinity` không hữu hạn ⇒ KHÔNG có "còn bao nhiêu".
  const availableBytes = finiteOrNull(input.headroomBytes);

  const ledgerTotal = finiteOrNull(input.ledgerTotalBytes);
  const used = finiteOrNull(input.usedBytes);
  // MÙ ⇒ `usedBytes` chỉ là sổ (CHẶN TRÊN của mọi headroom) ⇒ hiệu số không mang thông tin nào về
  // phần ngoài sổ. Trả `null` thay vì `0`: "không đo được" ≠ "đo được và bằng 0".
  const unattributedBytes =
    input.blind || ledgerTotal === null || used === null ? null : Math.max(0, used - ledgerTotal);

  const unledgeredEstimateBytes = input.unledgered === null ? null : finiteOrNull(input.unledgered.bytes);
  const unknownCount = input.unledgered === null ? null : finiteOrNull(input.unledgered.unknownCount);

  /**
   * ★ M-1/M-2 (review vòng 1) — LƯỚI PHẢI Ở TRÊN **TỔNG**, KHÔNG CHỈ TỪNG SỐ HẠNG. Bản trước
   * viết `(finiteOrNull(h.bytes) ?? 0)` cho từng hộ rồi cộng — mỗi số hạng hữu hạn mà TỔNG vẫn
   * tràn: reviewer đo hai hộ `1e308` ⇒ câu ra `"… tổng Infinity MiB."`, đúng hình dạng rơi vào
   * bẫy `bigint(mode:"number")` ⇒ MẤT CẢ LÔ sự kiện. Và cái `?? 0` ấy chính là **một cái DÂY**
   * theo đúng quy tắc Task 3 để lại. Nay: bỏ qua hộ có byte không dùng được (nó vẫn được GỌI TÊN
   * ở danh sách, chỉ không cộng được), rồi **lọc lần cuối trên TỔNG** ⇒ `null` = "không cộng nổi".
   */
  const preemptableBytes = finiteOrNull(
    input.preemptable.reduce((sum, h) => sum + (Number.isFinite(h.bytes) ? h.bytes : 0), 0),
  );

  /**
   * THỨ TỰ NÀY LÀ MỘT QUYẾT ĐỊNH, KHÔNG PHẢI TIỆN TAY:
   *  1. `unknownCount > 0` thắng TẤT CẢ — bàn giao (2): mọi hộ ONNX/sidecar/`gguf-context` đóng
   *     góp 0 byte vào `unledgeredBytes` và **chỉ** hiện ở đây. Câu này phải nói *"đừng dùng con
   *     số ước lượng để tính"*, và nó KHÔNG phụ thuộc `unattributedBytes` (có thể đang `null`).
   *  2. **KHÔNG BIẾT** — mù · chưa hỏi · **hoặc bất kỳ ô nào trong ba ô đó không dùng được**.
   *     ⚠ I-2 (review vòng 1): bản trước để `unattributedBytes === null` (đầu vào bẩn: `usedBytes`
   *     `+Infinity`, sổ `NaN`) **rơi thẳng xuống nhánh 4** ⇒ câu ra *"chưa phát hiện khoản nào"*
   *     trong khi sự thật là **KHÔNG BIẾT**. Đó là `null` bị đọc thành `0` — đúng lớp lỗi mà cả
   *     file này tồn tại để diệt, tái phát ngay trong file.
   *  3. **PHÁT HIỆN ĐƯỢC** một khoản ngoài sổ — theo **một trong hai** đường, và cả hai đều phải
   *     kích hoạt: (a) hiệu `usedBytes − ledgerTotalBytes` (SỐ ĐO), (b) `unledgeredBytes` (ƯỚC
   *     LƯỢNG của những lượt `beginVramAllocation()` hỏng).
   *     ⚠ I-1 (review vòng 1): bản trước chỉ nhìn (a) ⇒ hình dạng **thường gặp**
   *     `{bytes: 5.000 MiB, unknownCount: 0}` của `vramWiring.vramBeginFailureState()` cho ra câu
   *     *"chưa phát hiện khoản nào"* trong khi 5.242.880.000 byte **nằm ngay trong `facts`**.
   *     Câu của nhánh này vì thế **nêu CẢ HAI con số**, không chọn một.
   *  4. sổ giải thích hết — vẫn phải nói bản liệt kê là CẬN DƯỚI.
   */
  const khongBiet =
    input.blind ||
    input.unledgered === null ||
    unattributedBytes === null ||
    unledgeredEstimateBytes === null ||
    unknownCount === null;

  const caveat: VramRefusalCaveat =
    unknownCount !== null && unknownCount > 0
      ? "vramUnattributedUnreliable"
      : khongBiet
        ? "vramUnattributedUnknownExtent"
        : (unattributedBytes ?? 0) > 0 || (unledgeredEstimateBytes ?? 0) > 0
          ? "vramUnattributedDetected"
          : "vramLedgerCoverageOnly";

  return {
    appCode: availableBytes === null ? "VRAM_HEADROOM_UNKNOWN" : "VRAM_REFUSED",
    owner: input.owner,
    priority: input.priority,
    requestedBytes,
    availableBytes,
    holders: Object.freeze([...input.holders]),
    preemptable: Object.freeze([...input.preemptable]),
    preemptableBytes,
    unattributedBytes,
    unledgeredEstimateBytes,
    unknownCount,
    caveat,
    degradedReasons: Object.freeze([...input.degradedReasons]),
    wiredSiteCount: WIRED_ALLOCATION_SITE_COUNT,
    knownSiteRowCount: KNOWN_ALLOCATION_SITE_ROW_COUNT,
  };
}

/**
 * Đuôi chung của MỌI câu cảnh báo: bản liệt kê là **CẬN DƯỚI**. Tách ra một chỗ để không có
 * nhánh nào lỡ quên — *"danh sách trên là đầy đủ"* là điều file này tồn tại để không bao giờ nói.
 */
function coverageTail(facts: VramRefusalFacts): string {
  return (
    `Sổ mới bao ${facts.wiredSiteCount}/${facts.knownSiteRowCount} điểm cấp phát ĐÃ BIẾT, ` +
    `và chính bản liệt kê đó là CẬN DƯỚI (lớp alias chưa đóng) ⇒ danh sách "đang giữ" ở trên ` +
    `KHÔNG chắc đầy đủ.`
  );
}

function caveatText(facts: VramRefusalFacts): string {
  switch (facts.caveat) {
    case "vramUnattributedUnreliable":
      return (
        `${facts.unknownCount} lượt cấp phát đã chạy NGOÀI SỔ mà không ước được byte, nên phần ` +
        `thiết bị đang dùng KHÔNG ĐO ĐƯỢC; ước lượng ${mibText(facts.unledgeredEstimateBytes)} MiB ` +
        `là KHÔNG ĐÁNG TIN, đừng dùng nó để tính. ${coverageTail(facts)}`
      );
    case "vramUnattributedUnknownExtent":
      return (
        `hệ không đo được phần đang dùng ngoài sổ ở nhịp gần nhất, nên không biết nó lớn bao ` +
        `nhiêu. ${coverageTail(facts)}`
      );
    case "vramUnattributedDetected":
      // I-1 — NÊU CẢ HAI con số, và nói rõ con số nào là ĐO, con số nào là ƯỚC LƯỢNG. Chọn một
      // trong hai là để con số còn lại biến mất khỏi câu dù nó nằm ngay trong `facts`.
      return (
        `${mibText(facts.unattributedBytes)} MiB đang dùng trên thiết bị không thuộc về hộ nào ` +
        `trong sổ (số ĐO); và ${mibText(facts.unledgeredEstimateBytes)} MiB đã chạy ngoài sổ theo ` +
        `ƯỚC LƯỢNG. ${coverageTail(facts)}`
      );
    case "vramLedgerCoverageOnly": {
      const tail = coverageTail(facts);
      return `chưa phát hiện khoản nào ở nhịp gần nhất — nhưng ${tail.charAt(0).toLowerCase()}${tail.slice(1)}`;
    }
  }
}

/**
 * Câu máy chủ ĐẦY ĐỦ: đi vào `Error.message`, nhật ký, và `fallbackMessage` của mã lỗi (client cũ
 * + API `/v1` cho bên thứ ba đều đọc nó — xem `server/_core/appError.ts`).
 *
 * ⚠ Khác câu i18n cho người vận hành ở MỘT điểm có chủ đích: câu này mang **cả bốn** cảnh báo có
 * mặt, còn câu i18n chỉ mang **một** khoá `errors.reason.*` nghiêm trọng nhất — vì khuôn Sprint 5
 * có đúng một ô `{{reason}}`, và ta không phát minh khuôn mới.
 */
export function formatVramRefusal(facts: VramRefusalFacts): string {
  const head =
    facts.availableBytes === null
      ? `Không cấp được VRAM cho ${facts.owner} (mức ${facts.priority}): xin ` +
        `${mibText(facts.requestedBytes)} MiB, nhưng hệ KHÔNG tính được dư địa còn lại ` +
        `(lý do: ${facts.degradedReasons.join(", ") || "không rõ"}) nên từ chối để an toàn.`
      : `Không đủ VRAM cho ${facts.owner} (mức ${facts.priority}): xin ` +
        `${mibText(facts.requestedBytes)} MiB, còn ${mibText(facts.availableBytes)} MiB.`;

  const degraded =
    facts.availableBytes !== null && facts.degradedReasons.length > 0
      ? ` Con số này kém tin hơn bình thường (${facts.degradedReasons.join(", ")}).`
      : "";

  const holding =
    ` Đang giữ (chỉ các hộ ĐÃ NỐI SỔ; "≈" = ước lượng chưa đo): ${holderListText(facts.holders)}.`;

  const yielding =
    ` Có thể nhường (mức thấp hơn ${facts.priority}): ${holderListText(facts.preemptable)}` +
    (facts.preemptable.length === 0 ? "." : ` — tổng ${mibText(facts.preemptableBytes)} MiB.`);

  return `${head}${degraded}${holding}${yielding} Phần KHÔNG quy trách nhiệm được: ${caveatText(facts)}`;
}

/**
 * Nối vào hệ mã lỗi Sprint 5 — trả về **dữ liệu thuần**, KHÔNG dựng `TRPCError` ở đây.
 *
 * ⚠ CỐ Ý không import `@trpc/server`: cổng `ALLOWED_TRPC_ERROR_OUTSIDE_ROUTERS = 0`
 * (`server/routers/appErrorCoverage.test.ts`) đếm mọi lượt khởi tạo `TRPCError` trong toàn
 * `server/**` ngoài `routers/` — và nó đếm **KÝ TỰ**, nên ngay cả một ví dụ trong chú thích cũng
 * bị tính (đúng ca `masterDataIO.ts`/`voiceTranscription.ts` mà cổng đó tự ghi). Điểm gọi ở router
 * chỉ việc `appError("PRECONDITION_FAILED", appCode, params, fallbackMessage)`.
 *
 * ⚠ MỌI giá trị số trả về ĐÃ hữu hạn (bàn giao 1). Ô không có số dùng chuỗi `"?"` — nó đi vào câu
 * chữ, không đi vào cột byte của `vram_events`.
 */
export function vramRefusalAppError(facts: VramRefusalFacts): {
  readonly appCode: AppErrorCode;
  readonly params: AppErrorParams;
  readonly fallbackMessage: string;
} {
  const requestedMb = mib(facts.requestedBytes);
  const params: Record<string, string | number> = {
    owner: facts.owner,
    priority: facts.priority,
    // `"?"` khi đầu vào không hữu hạn — KHÔNG bịa `0`, và KHÔNG để `NaN` chạm cột byte của
    // `vram_events` (bẫy 1 của ống dẫn: `bigint(mode:"number")` từ chối ⇒ MẤT CẢ LÔ sự kiện).
    requestedMb: requestedMb === null ? "?" : requestedMb,
    // Hai danh sách đi qua KHÔNG GIAN TỪ ĐIỂN `errors.list.*` (client `localizeParams`): giá trị
    // tự do rơi về nguyên văn qua `defaultValue`, còn danh sách RỖNG dùng khoá `none` để hiện
    // thành "không có" ĐÚNG NGÔN NGỮ — thay vì một chỗ trống mà người đọc tự điền nghĩa.
    holders: facts.holders.length === 0 ? "none" : facts.holders.map(holderText).join(", "),
    preemptable: facts.preemptable.length === 0 ? "none" : facts.preemptable.map(holderText).join(", "),
    // M-1/M-2 — `?? 0` cũ là một DÂY: tổng KHÔNG cộng nổi (tràn) sẽ hiện thành "0 MiB nhường
    // được", tức nói NGƯỢC. `"?"` nói đúng: có ứng viên, nhưng không cộng được tổng.
    preemptableMb: mibText(facts.preemptableBytes),
    reason: facts.caveat,
    // I-3 — lời hạ giọng CÓ ĐIỀU KIỆN cho câu i18n: `trust` là khoá từ điển (`errors.trust.*`),
    // `trusted` là chuỗi RỖNG nên khuôn câu không đổi khi số đáng tin. Câu máy chủ đã có lời hạ
    // giọng này từ đầu; trước bản vá, đường i18n thì KHÔNG.
    trust: facts.degradedReasons.length > 0 ? "degraded" : "trusted",
    degradedReasons: facts.degradedReasons.join(", ") || "-",
    // Placeholder RIÊNG của các khoá `errors.reason.*` — luôn truyền đủ, kể cả khi khoá đang chọn
    // không cần tới: thiếu một placeholder là đẩy "{{unknownCount}}" thô ra màn hình (đúng lớp lỗi
    // mà cổng "reason→placeholder" của `appErrorParamsCoverage.test.ts` canh ở phía router).
    wiredSites: facts.wiredSiteCount,
    knownRows: facts.knownSiteRowCount,
    unattributedMb: mibText(facts.unattributedBytes),
    unledgeredMb: mibText(facts.unledgeredEstimateBytes),
    unknownCount: facts.unknownCount === null ? "?" : facts.unknownCount,
  };
  // ⚠ CHỈ có mặt ở nhánh `VRAM_REFUSED`: khuôn câu `VRAM_HEADROOM_UNKNOWN` KHÔNG có
  // `{{availableMb}}`, và bơm một ô "còn bao nhiêu" vào đó là mời người sau đi in nó.
  if (facts.availableBytes !== null) params.availableMb = mib(facts.availableBytes) as number;

  return {
    appCode: facts.appCode,
    params,
    fallbackMessage: formatVramRefusal(facts),
  };
}

/**
 * Từ chối trung thực (§5.3). Mang **bốn** thứ, KHÔNG phải một câu "hết bộ nhớ".
 *
 * ⚠ Đổi mặt tiếp xúc so với bản Pha 1 (ba tham số rời `requestedBytes/availableBytes/holders`):
 * bản đó **thiếu hẳn** vế *"ai có thể nhường"* — một trong bốn thứ §5.3 đòi — và không có chỗ nào
 * để nói phần KHÔNG quy trách nhiệm được. Bản Pha 1 chưa có điểm gọi sản xuất nào (`git grep`
 * `VramRefusedError`: chỉ chính nó), nên đổi ở đây không phá ai.
 */
export class VramRefusedError extends Error {
  constructor(public readonly facts: VramRefusalFacts) {
    super(formatVramRefusal(facts));
    this.name = "VramRefusedError";
  }
}
