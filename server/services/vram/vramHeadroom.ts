/**
 * ★★★ Pha 2B Task 2 — HÀM QUYẾT ĐỊNH của mô hình cưỡng chế §5.6c. **CHƯA cưỡng chế gì cả**:
 * task này chỉ dựng phép tính và nguồn số cho nó; việc BẬT nằm ở Task 5.
 *
 *     headroom = ceilingBytes − max(ledgerTotalBytes, attributableBytes) − safetyReserveBytes
 *
 * File này CỐ Ý **không import gì** (kể cả `./vramBroker`, `./vramReconciler`). Hai lý do, cả hai
 * đã trả giá ở pha trước:
 *   • `reserve()` là **ĐỒNG BỘ** — tính đồng bộ đó **LÀ** lá chắn cấu trúc từ Pha 1, không phải
 *     một tối ưu hiệu năng — nên đường quyết định không được `await` bất cứ thứ gì;
 *   • 43 file test thay CẢ module `./vramBroker` bằng bản giả chỉ khai vài export. Một hàm thuần
 *     không phụ thuộc thì không đẻ thêm bề mặt mock nào cho ai.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ `max()` CHỨ KHÔNG `+` — VÀ NÓ ĐANG GÁNH BA VAI, KHÔNG PHẢI MỘT. ĐỌC HẾT TRƯỚC KHI SỬA.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *   1. **Không đếm hai lần.** Sổ đã ĐẶT CỌC ước lượng của lease đang nạp ngay từ `reserve()`, mà
 *      trọng số của chính lease đó cũng đang lên thiết bị dần dần (đo được: `nvidia-smi = 18.115
 *      MiB` khi lease 30B vẫn `pending`). Cộng hai vế là trừ MỘT khối 17 GB thành HAI ⇒ hệ tự
 *      nhốt mình dưới trần và từ chối những lượt xin hoàn toàn hợp lệ.
 *   2. **Tự nuốt khoản báo thiếu 128 MiB** (spec §5.6c): sổ hụt bao nhiêu thì `attributable` che
 *      bấy nhiêu ⇒ Pha 2B **không cần** giải xong câu "bộ đệm lười hay cửa sổ cắt ngọn" trước khi
 *      bật cưỡng chế.
 *   3. ★★★ **NÓ ĐANG LÀ LƯỚI ĐỠ CHO MỘT KHOẢN NỢ CÒN MỞ (N2-2, mang sang từ Pha 2A).** Đường ĐO
 *      vẫn bị hệ điều hành CẤP LẠI PID lừa ở chiều **PID cha** ⇒ tập `seen` bị bắt sai ⇒ có đường
 *      dẫn tới `commit(0)` + `recordActual(0)` ⇒ `learned = 0`. Một `learned = 0` chỉ đầu độc vế
 *      **`ledgerTotal`** (sổ khai 0 byte cho một model 17 GB); vế **`attributable`** vẫn thấy mức
 *      dùng THẬT của thiết bị, và `max()` lấy vế lớn hơn.
 *      ⇒ **GỠ `max()` (đổi thành chỉ đọc sổ, hoặc thành `+`) là biến khoản nợ đó thành một đường
 *      OOM.** An toàn của lượt nạp kế tiếp hôm nay đang đứng trên đúng phép `max` này.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ ĐÍNH CHÍNH BẮT BUỘC BIẾT: `blind` **KHÔNG PHẢI** SUY BIẾN AN TOÀN.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Ràng buộc toàn cục 10 (10 bản đầu) viết *"đầu dò hỏng / đối chiếu mù ⇒ suy biến AN TOÀN: rơi về
 * chỉ-sổ"*. **SAI, và sai theo hướng ru ngủ.** Chứng minh bằng số học, không bằng khẩu vị: vì
 * `max(L, A) ≥ L` với MỌI `A`, nên
 *
 *      headroom(A = null)  =  trần − L − đệm   ≥   trần − max(L, A) − đệm  =  headroom(A bất kỳ)
 *
 * tức **`attributable = null` là CHẶN TRÊN của mọi headroom**. Rơi về chỉ-sổ ⇒ dư địa **lớn nhất
 * có thể**, trong khi sổ mới nối **14/159** dòng ⇒ hệ mất tầm nhìn với gần như cả tấm card.
 * ⇒ **Mọi đường sinh `blind` là một đường VÔ HIỆU HOÁ lớp bảo vệ** (đã đếm 11 đường; đường tệ nhất
 * không phải đầu dò hỏng mà là lease `sidecar:local-trainer` **ttl 2 GIỜ, đang bật, cố ý không
 * commit** ⇒ mù hàng giờ). Đây cũng là lý do Task 1 **chụp-và-đánh-dấu** thay vì **từ chối**: một
 * nền NHIỄM vẫn CHẶT HƠN chỉ-sổ.
 *
 * ⇒ Hàm này vì thế **không im lặng** ở trạng thái suy biến: `blind`, `baselineVerified`, `trusted`
 * và `degradedReasons` là những thứ hệ **BIẾT** và **NÓI RA ĐƯỢC**. Chính sách "mù thì chặt hơn"
 * là của **Task 5** — task này không quyết thay, nhưng **phải làm cho nó khả thi**, và đó là toàn
 * bộ lý do bốn trường kia tồn tại.
 */

export interface HeadroomInput {
  /** Trần cấp phát (BYTE). Chính sách của Task 5 — hàm này không đọc cấu hình. */
  readonly ceilingBytes: number;
  /**
   * Tổng sổ (BYTE). ⚠ Phải là sổ **SỐNG** (`snapshot().totalReservedBytes` tại thời điểm quyết
   * định), KHÔNG phải `ledgerTotalBytes` của tick cũ — xem `headroomInputFromTick()`.
   */
  readonly ledgerTotalBytes: number;
  /**
   * `deviceUsedBytes − baselineUsedBytes` của nhịp đối chiếu gần nhất (BYTE), hoặc `null` khi
   * **KHÔNG TÍNH ĐƯỢC** (chưa có nền · đầu dò hỏng · lượt resample/ngắt mạch · chưa có nhịp nào).
   * ⚠ `null` là **CHẶN TRÊN**, không phải "an toàn" — xem khối đính chính ở đầu file.
   * ⚠ Có thể ÂM một cách hợp lệ (nền chốt lúc còn tàn dư, rồi tàn dư chết). `max()` xử đúng ca đó:
   * sổ thắng, dư địa KHÔNG bị nới.
   */
  readonly attributableBytes: number | null;
  /** Đệm an toàn (BYTE), luôn ≥ 0. Chính sách của Task 5. */
  readonly safetyReserveBytes: number;
  /**
   * ★★★ N2-4 — BÀN GIAO CỨNG TỪ TASK 1. `VramReconcileResult.baselineVerified`: nền hiện tại đã
   * được xác minh là không có mã của hệ đang giữ GPU ngoài cây tiến trình hay chưa.
   *
   * ⚠ VÌ SAO NÓ BẮT BUỘC CÓ MẶT Ở ĐÂY, dù công thức §5.6c không dùng tới nó: tới hết Task 1, cờ
   * này **CHƯA CÓ NGƯỜI TIÊU THỤ NÀO** ngoài `server/services/vram/**` — nó phát hiện đúng, ghi sổ
   * đúng, kêu đúng, nhưng **chưa có ai ĐỔI QUYẾT ĐỊNH vì nó**, tức Task 1 mới dựng một cái đồng hồ
   * không kim. Bắt nó thành trường **BẮT BUỘC** của đầu vào là cách duy nhất khiến người gọi
   * (Task 5) không thể "quên" nó một cách im lặng — trình biên dịch sẽ chặn.
   *
   * ⚠ `false` KHÔNG có nghĩa "bẩn" và KHÔNG được suy ra con số nào từ nó — nó nghĩa **KHÔNG BIẾT
   * nền có nuốt byte của kẻ khác không**. Dưới topology `api`+`worker` (đường khởi chạy mà
   * `backgroundJobs.ts:11` chỉ định) nó là **VĨNH VIỄN false** — đó là **câu trả lời đúng theo
   * thiết kế** (mỗi vai trò một sổ riêng; sổ chung là Pha 3), KHÔNG phải một lỗi chờ sửa. ⇒ Tuyệt
   * đối đừng thiết kế chính sách kiểu "chỉ chạy tốt khi đã xác minh".
   */
  readonly baselineVerified: boolean;
}

/**
 * Vế nào THẮNG phép `max()`, tức con số nào đang chịu lực:
 *  • `"ledger-only"` — MÙ: không có `attributable` để so, chỉ còn sổ (**CHẶN TRÊN**);
 *  • `"attributable"` — thiết bị thấy NHIỀU HƠN sổ ⇒ có khoản ngoài sổ đang làm hẹp dư địa;
 *  • `"ledger"` — sổ ≥ thiết bị ⇒ sổ đã GIẢI THÍCH HẾT phần thiết bị (gồm cả cửa sổ đặt cọc của
 *    lease đang nạp). Hoà (`L === A`) thuộc về đây: không có khoản ngoài sổ nào.
 */
export type HeadroomBasis = "ledger-only" | "attributable" | "ledger";

/** Vì sao lượt tính này KHÔNG đáng tin bằng một lượt bình thường. Có TÊN để Task 4/5 nói ra được. */
export type HeadroomDegradation = "blind" | "unverified-baseline";

export interface HeadroomResult {
  /**
   * Dư địa còn lại (BYTE). **CÓ THỂ ÂM** và **KHÔNG BAO GIỜ được kẹp về 0**: âm nghĩa là đã vượt
   * trần, và độ lớn của phần âm chính là thứ câu từ-chối-trung-thực (Task 4) phải nói ra —
   * "thiếu bao nhiêu", không phải "hết chỗ".
   */
  readonly headroomBytes: number;
  readonly basis: HeadroomBasis;
  /** `true` ⇔ `attributableBytes === null`. ⚠ Là CHẶN TRÊN, không phải trạng thái an toàn. */
  readonly blind: boolean;
  /** Nguyên văn cờ của tick (N2-4) — đi vào thì phải đi ra được, nếu không nó lại vô hình. */
  readonly baselineVerified: boolean;
  /**
   * `!blind && baselineVerified`. Đây là MỘT chỗ duy nhất để Task 5 treo chính sách **CHẶT HƠN**
   * (đệm lớn hơn / từ chối lượt xin lớn / hạ trần), thay vì phải tự ghép hai cờ và ghép sai.
   * ⚠ `trusted === false` **KHÔNG** được hiểu là "cấm mọi thứ" — hệ vẫn phải chạy được; nó nghĩa
   * "con số này mua được ít lòng tin hơn bình thường".
   */
  readonly trusted: boolean;
  /** Danh sách lý do (rỗng ⇔ `trusted`). Thứ tự cố định để test/nhật ký so được trực tiếp. */
  readonly degradedReasons: readonly HeadroomDegradation[];
  /**
   * `max(ledgerTotalBytes, attributableBytes)` — con số ĐÃ TRỪ khỏi trần. Xuất ra để câu từ chối
   * và nhật ký dựng lại được phép tính mà không phải tin một con số vô danh.
   */
  readonly usedBytes: number;
}

function assertFinite(name: string, v: number): void {
  if (!Number.isFinite(v)) {
    throw new TypeError(
      `[vram] computeHeadroom: "${name}" phải là SỐ hữu hạn (nhận: ${String(v)}). ` +
        `Một NaN đi qua đây sẽ cho headroom = NaN, mà MỌI so sánh với NaN đều false ⇒ cưỡng chế ` +
        `TẮT IM LẶNG (đúng lớp lỗi ràng buộc 9 cấm). Nguồn thường gặp: Number(process.env.…) của ` +
        `một chuỗi hỏng — hãy kiểm cấu hình MỘT LẦN lúc nạp module, đừng để nó tới đường nóng.`,
    );
  }
}

/**
 * Tính dư địa theo §5.6c. **Thuần và đồng bộ** — không I/O, không đồng hồ, không trạng thái.
 *
 * @throws TypeError nếu có đầu vào không hữu hạn, hoặc `safetyReserveBytes < 0`. Ném là CÓ CHỦ Ý:
 *   một đệm ÂM **nới** dư địa và một `NaN` **tắt** cưỡng chế — cả hai đều hỏng theo chiều nguy
 *   hiểm và cả hai đều IM LẶNG. Người gọi phải kiểm cấu hình lúc nạp, không phải mỗi lượt xin.
 */
export function computeHeadroom(input: HeadroomInput): HeadroomResult {
  assertFinite("ceilingBytes", input.ceilingBytes);
  assertFinite("ledgerTotalBytes", input.ledgerTotalBytes);
  assertFinite("safetyReserveBytes", input.safetyReserveBytes);
  if (input.attributableBytes !== null) assertFinite("attributableBytes", input.attributableBytes);
  if (input.safetyReserveBytes < 0) {
    throw new TypeError(
      `[vram] computeHeadroom: "safetyReserveBytes" âm (${input.safetyReserveBytes}) — một đệm an ` +
        `toàn âm là phép CỘNG dư địa, tức nới đúng chiều nguy hiểm. Không có ca dùng hợp lệ nào.`,
    );
  }

  const blind = input.attributableBytes === null;

  /**
   * ⚠⚠ HAI DÒNG DƯỚI LÀ TOÀN BỘ CÔNG THỨC. Đọc khối đầu file trước khi đổi bất cứ ký tự nào —
   * đặc biệt: `max` KHÔNG được thành `+` (đếm hai lần) và nhánh `blind` KHÔNG được thành
   * `attributableBytes ?? 0` (một `0` giả sẽ khai rằng ta ĐÃ ĐO và thiết bị TRỐNG, xoá luôn cả
   * `blind` lẫn cơ hội để Task 5 chạy chặt hơn — trong khi sự thật là ta KHÔNG BIẾT GÌ).
   */
  const usedBytes = blind ? input.ledgerTotalBytes : Math.max(input.ledgerTotalBytes, input.attributableBytes as number);
  // KHÔNG kẹp về 0: vượt trần phải trả về ÂM, và độ lớn phần âm là thông tin của câu từ chối.
  const headroomBytes = input.ceilingBytes - usedBytes - input.safetyReserveBytes;

  const basis: HeadroomBasis = blind
    ? "ledger-only"
    : (input.attributableBytes as number) > input.ledgerTotalBytes
      ? "attributable"
      : "ledger";

  const degradedReasons: HeadroomDegradation[] = [];
  if (blind) degradedReasons.push("blind");
  if (!input.baselineVerified) degradedReasons.push("unverified-baseline");

  return {
    headroomBytes,
    basis,
    blind,
    baselineVerified: input.baselineVerified,
    trusted: degradedReasons.length === 0,
    degradedReasons,
    usedBytes,
  };
}

/**
 * Hình dạng TỐI THIỂU mà `computeHeadroom` cần từ một nhịp đối chiếu. `VramReconcileResult` khớp
 * được kiểu này theo cấu trúc — CỐ Ý không `import type` từ `./vramReconciler` để file này không
 * kéo theo một module có I/O và trạng thái toàn cục (xem lý do "không import gì" ở đầu file).
 */
export interface HeadroomTickFields {
  readonly attributableBytes: number | null;
  readonly baselineVerified: boolean;
}

export interface HeadroomPolicy {
  readonly ceilingBytes: number;
  readonly safetyReserveBytes: number;
  /**
   * ⚠ SỔ **SỐNG**, đọc đồng bộ tại thời điểm quyết định (`snapshot().totalReservedBytes`).
   * KHÔNG lấy `tick.ledgerTotalBytes`: tick có thể cũ tới trọn một nhịp (**60 s là độ trễ cưỡng
   * chế THẬT**, spec §5.6c), và mọi lượt `reserve()` xảy ra trong khoảng đó sẽ VÔ HÌNH — tức đúng
   * cái cửa mà cưỡng chế sinh ra để đóng. Sổ là thứ DUY NHẤT ta có chính xác và đồng bộ; dùng bản
   * cũ của nó là tự vứt đi ưu thế đó.
   */
  readonly ledgerTotalBytes: number;
}

/**
 * Ghép ô tick gần nhất + chính sách thành đầu vào của `computeHeadroom`. Thuần, đồng bộ.
 *
 * ⚠ `tick === null` (CHƯA có nhịp nào) ⇒ mù + chưa xác minh. Ca này **có thật và thường trực**,
 * không phải lý thuyết: dưới topology `api`+`worker`, `startVramReconciler()` chỉ chạy ở vai trò
 * chạy scheduler (`backgroundJobs.ts`), nên ở tiến trình `api` ô tick **rỗng vĩnh viễn** ⇒ cưỡng
 * chế ở đó chạy mù mãi mãi. Hàm này không giấu điều đó đi — nó trả về đúng trạng thái mù, để
 * Task 5 buộc phải xử lý.
 *
 * ⚠ HÀM NÀY KHÔNG HẾT HẠN TICK. "Tick cũ bao lâu thì hết đáng tin" là **chính sách của Task 5**
 * (`readLastReconcileTick()` trả kèm `atMs` để làm việc đó). Đặt một ngưỡng ở đây là chôn một
 * hằng số không ai canh vào giữa một hàm thuần.
 */
export function headroomInputFromTick(tick: HeadroomTickFields | null, policy: HeadroomPolicy): HeadroomInput {
  return {
    ceilingBytes: policy.ceilingBytes,
    safetyReserveBytes: policy.safetyReserveBytes,
    ledgerTotalBytes: policy.ledgerTotalBytes,
    attributableBytes: tick?.attributableBytes ?? null,
    // Không có tick ⇒ KHÔNG có bằng chứng nào về nền ⇒ `false`. Mặc định phải là "chưa xác minh",
    // không bao giờ là "coi như đã xác minh".
    baselineVerified: tick?.baselineVerified ?? false,
  };
}
