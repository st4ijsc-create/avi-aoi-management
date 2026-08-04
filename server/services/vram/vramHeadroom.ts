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
 * ⇒ **Mọi đường sinh `blind` là một đường VÔ HIỆU HOÁ lớp bảo vệ** — đã đếm **11** đường **bên
 * trong** `reconcileOnce()`, cộng đường thứ **12** do chính Task 2 đẻ ra: **chưa có nhịp nào chạy**
 * (`readLastReconcileTick() === null`, xem `HeadroomInput.tickPresent`). Đường 12 là đường **dài
 * nhất về thời lượng** — dài hơn cả lease `local-trainer` ttl 2 giờ. Đây cũng là lý do Task 1
 * **chụp-và-đánh-dấu** thay vì **từ chối**: một nền NHIỄM vẫn CHẶT HƠN chỉ-sổ.
 *
 * ⇒ Hàm này vì thế **không im lặng** ở trạng thái suy biến: `blind`, `baselineVerified`, `trusted`
 * và `degradedReasons` là những thứ hệ **BIẾT** và **NÓI RA ĐƯỢC**. Chính sách "mù thì chặt hơn"
 * là của **Task 5** — task này không quyết thay, nhưng **phải làm cho nó khả thi**, và đó là toàn
 * bộ lý do bốn trường kia tồn tại.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ C-1 (review Task 2) — VÌ SAO `computeHeadroom()` **KHÔNG BAO GIỜ NÉM**.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Bản đầu của task này NÉM khi đầu vào vô nghĩa (`NaN` từ một `.env` hỏng). **Động cơ đúng** — một
 * `NaN` làm `estimated > headroom` thành `false` cho MỌI lượt xin, tức cưỡng chế **tắt im lặng**,
 * đúng lớp lỗi ràng buộc 9 cấm. **Nhưng vị trí sai, và review chứng minh hậu quả TỆ HƠN thứ nó
 * phòng:**
 *   • toàn thân `beginVramAllocation()` nằm trong một `try`, và `vramWiring.ts` kết bằng
 *     `catch { … return NOOP_TICKET; }` — **nuốt mọi ngoại lệ**;
 *   • `broker.reserve()` được gọi **bên trong** cái `try` đó, và `vramBroker.reserve()` **tạo
 *     lease ở CUỐI hàm** ⇒ một cú ném xảy ra **TRƯỚC** `ledger.set`.
 *   ⇒ Ném = **cưỡng chế tắt im lặng CỘNG một khối byte không vào sổ**. Vế `L` hụt ⇒ `max(L, A)`
 *     mất vế `L` ⇒ headroom **phóng đại cho mọi lượt xin sau**. `NaN` mà không ném thì ít nhất
 *     **sổ vẫn đúng**.
 *
 * ⇒ Nguyên tắc *"thà hỏng ồn còn hơn sai lặng"* giữ nguyên, nhưng dời chỗ:
 *   • **đường nóng** (`computeHeadroom`): KHÔNG ném — suy biến **FAIL-CLOSED CÓ TÊN**:
 *     `headroomBytes = -Infinity` (từ chối mọi lượt xin, KHÔNG dùng `NaN` vì mọi so sánh với
 *     `NaN` đều `false` = tắt cưỡng chế) + `degradedReasons` chứa `"invalid-input"`. Không nhánh
 *     nào mất giấy phép, và Task 4 **nói ra được** lý do.
 *   • **boot**: `assertHeadroomPolicy()` (cuối file) NÉM — nhưng **đọc docstring của nó trước khi
 *     tin**: hôm nay **chưa có vị trí nào trong repo nằm ngoài mọi `try`** để đặt lời gọi đó.
 *
 * ⚠⚠ HẠ GIỌNG, ĐÚNG PHẠM VI (re-review) — bản trước viết *"không còn đường nào mà cưỡng chế tắt VÀ
 * sổ hụt cùng lúc"*. **Nói quá.** Câu đúng: **Task 2 không CÒN ĐẺ RA đường đó.** Lớp hỏng cũ vẫn
 * còn nguyên và **không thuộc phạm vi Task 2**: `catch` của `vramWiring` vẫn `return NOOP_TICKET`
 * (bản vá chỉ thêm TIẾNG, **không đổi luồng**), `reserve()` vẫn `ledger.set` ở **cuối**, và **ba
 * lệnh vẫn ném được TRƯỚC đó** — `await import("./vramBroker" | "./vramEstimator" | "./vramEventLog")`
 * ở đầu `beginVramAllocation()`. ⇒ **Ba cửa ấy nay CÓ TIẾNG, KHÔNG phải ĐÃ ĐÓNG.**
 */

export interface HeadroomInput {
  /** Trần cấp phát (BYTE). Phải **> 0** — xem `assertHeadroomPolicy()`. Chính sách của Task 5. */
  readonly ceilingBytes: number;
  /**
   * Tổng sổ (BYTE). ⚠ Phải là sổ **SỐNG** (`snapshot().totalReservedBytes` tại thời điểm quyết
   * định), KHÔNG phải `ledgerTotalBytes` của tick cũ — xem `HeadroomPolicy.ledgerTotalBytes`.
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
   * ⚠ Giới hạn đã biết: `tsc` chặn **QUÊN**, không chặn **KHAI BỪA** (`baselineVerified: true` viết
   * tay vẫn qua cửa). Lối chống duy nhất là đi qua `headroomInputFromTick()`.
   *
   * ⚠ `false` KHÔNG có nghĩa "bẩn" và KHÔNG được suy ra con số nào từ nó — nó nghĩa **KHÔNG BIẾT
   * nền có nuốt byte của kẻ khác không**. Dưới topology `api`+`worker` nó là **VĨNH VIỄN false** ở
   * **cả hai** tiến trình (vai trò anh em luôn rơi vào `peers`, và `peers` tắt cờ) — đó là **câu
   * trả lời đúng theo thiết kế**, KHÔNG phải một lỗi chờ sửa. ⇒ Tuyệt đối đừng thiết kế chính sách
   * kiểu "chỉ chạy tốt khi đã xác minh".
   */
  readonly baselineVerified: boolean;
  /**
   * ★★ I-2 (review Task 2) — CÓ NHỊP ĐỐI CHIẾU NÀO ĐÃ CHẠY CHƯA.
   *
   * ⚠ VÌ SAO KHÔNG SUY RA ĐƯỢC TỪ `attributableBytes === null`: hai trạng thái rất khác nhau cùng
   * cho `null`, và ràng buộc 10 đòi đối xử khác nhau:
   *   • **`tickPresent: false`** — *chưa có nhịp nào* (`readLastReconcileTick() === null`): tiến
   *     trình không chạy reconciler, và **60 giây đầu của MỌI vai trò**. Suy biến **CẤU TRÚC**,
   *     KHÔNG tự lành.
   *   • **`tickPresent: true` + `attributableBytes === null`** — *có nhịp, nhưng nhịp đó không
   *     tính được* (đầu dò hỏng, resample, ngắt mạch, nền chưa chụp): suy biến **TẠM THỜI**, lành
   *     ở nhịp sau.
   * Gộp hai thứ đó là bắt Task 5 đối xử với "không bao giờ có số" y như "nhịp này chưa có số".
   * ⚠ Review đã CHỨNG MINH khoảng trống này bằng một đột biến **SỐNG SÓT 302/302** trên bản trước
   * (hợp nhất hai trạng thái mà không ca nào đỏ). Đừng gộp lại.
   */
  readonly tickPresent: boolean;
}

/**
 * Vế nào THẮNG phép `max()`, tức con số nào đang chịu lực:
 *  • `"ledger-only"` — MÙ: không có `attributable` để so, chỉ còn sổ (**CHẶN TRÊN**);
 *  • `"attributable"` — thiết bị thấy NHIỀU HƠN sổ ⇒ có khoản ngoài sổ đang làm hẹp dư địa;
 *  • `"ledger"` — sổ ≥ thiết bị ⇒ sổ đã GIẢI THÍCH HẾT phần thiết bị (gồm cả cửa sổ đặt cọc của
 *    lease đang nạp). Hoà (`L === A`) thuộc về đây: không có khoản ngoài sổ nào.
 */
export type HeadroomBasis = "ledger-only" | "attributable" | "ledger";

/**
 * Vì sao lượt tính này KHÔNG đáng tin bằng một lượt bình thường. Có TÊN để Task 4/5 nói ra được,
 * và **phân biệt được MỨC** (I-2). Thứ tự trong `degradedReasons` là thứ tự khai báo dưới đây:
 *  • `"invalid-input"` — trần/đệm/sổ/`attributable` không phải số dùng được (C-1). **FAIL-CLOSED**;
 *  • `"no-tick"` — CHƯA CÓ NHỊP NÀO (cấu trúc, không tự lành);
 *  • `"probe-blind"` — có nhịp nhưng nhịp đó không tính được `attributable` (tạm thời, lành nhịp sau);
 *  • `"unverified-baseline"` — có số, nhưng nền chưa xác minh (N2-4).
 */
export type HeadroomDegradation = "invalid-input" | "no-tick" | "probe-blind" | "unverified-baseline";

export interface HeadroomResult {
  /**
   * Dư địa còn lại (BYTE). **CÓ THỂ ÂM** và **KHÔNG BAO GIỜ được kẹp về 0**: âm nghĩa là đã vượt
   * trần, và độ lớn của phần âm chính là thứ câu từ-chối-trung-thực (Task 4) phải nói ra —
   * "thiếu bao nhiêu", không phải "hết chỗ".
   * ⚠ `-Infinity` ⇔ `degradedReasons` chứa `"invalid-input"`: dư địa **không xác định được**, hệ
   * từ chối mọi lượt xin. Task 4 phải đọc LÝ DO chứ không in con số đó ra cho người dùng.
   *
   * ⚠⚠ N-2 (re-review) — BÀN GIAO CỨNG CHO TASK 3/4: `-Infinity` hôm nay **không chảy tới đâu**
   * (ba hàm của file này chưa có điểm gọi sản xuất nào). Nhưng ống dẫn sự kiện có **HAI BẪY**, và
   * cả hai đều hỏng IM LẶNG — đúng thứ Task 3 sinh ra để diệt:
   *   1. các cột byte của `vram_events` là `bigint(mode: "number")` ⇒ Postgres **từ chối**
   *      `"-Infinity"` ⇒ lượt `insert` ném ⇒ `vramEventLog` nuốt và **MẤT CẢ LÔ** sự kiện, không
   *      chỉ dòng hỏng (nó ghi theo lô);
   *   2. `detail` là `jsonb` ⇒ `JSON.stringify(-Infinity)` cho **`null`**, tức con số biến mất mà
   *      không ai biết nó từng là gì.
   * ⇒ Chỗ nào ghi `headroomBytes` xuống DB **phải** kiểm `Number.isFinite()` trước và ghi lý do
   * (`"invalid-input"`) thay cho con số — đừng để một giá trị hợp lệ về ngữ nghĩa giết cả lô nhật ký.
   */
  readonly headroomBytes: number;
  readonly basis: HeadroomBasis;
  /** `true` ⇔ không có `attributable` dùng được. ⚠ Là CHẶN TRÊN, không phải trạng thái an toàn. */
  readonly blind: boolean;
  /** Nguyên văn cờ của tick (N2-4) — đi vào thì phải đi ra được, nếu không nó lại vô hình. */
  readonly baselineVerified: boolean;
  /**
   * `degradedReasons.length === 0`. Đây là MỘT chỗ duy nhất để Task 5 treo chính sách **CHẶT HƠN**
   * (đệm lớn hơn / từ chối lượt xin lớn / hạ trần), thay vì mỗi điểm gọi tự ghép các cờ và ghép sai.
   * ⚠ `trusted === false` **KHÔNG** được hiểu là "cấm mọi thứ" — hệ vẫn phải chạy được; nó nghĩa
   * "con số này mua được ít lòng tin hơn bình thường". **MỨC** nằm ở `degradedReasons`.
   */
  readonly trusted: boolean;
  /**
   * Danh sách lý do (rỗng ⇔ `trusted`), **đông cứng** và thứ tự cố định để so trực tiếp được.
   *
   * ⚠ N-5 (re-review) — VÌ SAO CHỖ NÀY `Object.freeze` mà `VramReconcileResult` chỉ `readonly`:
   * hai thứ khác nhau về hình dạng, không phải hai mức kỷ luật tuỳ hứng. Mảng này **PHẲNG và nhỏ**,
   * dựng mới mỗi lượt gọi ⇒ `freeze` là **toàn phần** và gần như miễn phí. `VramReconcileResult`
   * thì **lồng nhau** (`leases[]`, `measureSourceSplit`, `detail`…) ⇒ `Object.freeze` trên nó chỉ
   * đông cứng **tầng ngoài**, tức mua một cảm giác an toàn SAI trong khi tầng trong vẫn sửa được;
   * `readonly` phủ **mọi trường ở mọi điểm tiêu thụ** lúc biên dịch, và mọi điểm tiêu thụ hôm nay
   * đều nằm trong `server/services/vram/**` **không chỗ nào ép kiểu** (`git grep "as any"` /
   * `"as VramReconcileResult"` trong thư mục đó: **rỗng**). Muốn đồng nhất thì phải `deepFreeze`
   * trên đường nóng mỗi nhịp — một quyết định hiệu năng + hành vi, không phải một lượt dọn dẹp.
   */
  readonly degradedReasons: readonly HeadroomDegradation[];
  /**
   * `max(ledgerTotalBytes, attributableBytes)` — con số ĐÃ TRỪ khỏi trần. Xuất ra để câu từ chối
   * và nhật ký dựng lại được phép tính mà không phải tin một con số vô danh.
   */
  readonly usedBytes: number;
}

/** Số dùng được cho phép cộng trừ byte: hữu hạn. (`null` được xử riêng, không đi qua đây.) */
function usable(v: number): boolean {
  return Number.isFinite(v);
}

/**
 * Tính dư địa theo §5.6c. **Thuần, đồng bộ, KHÔNG BAO GIỜ NÉM** (lý do đầy đủ ở khối C-1 đầu file:
 * một cú ném trên đường `reserve()` bị `vramWiring` nuốt và làm mất luôn giấy phép).
 *
 * Đầu vào vô nghĩa ⇒ **FAIL-CLOSED CÓ TÊN**: `headroomBytes = -Infinity` + lý do `"invalid-input"`.
 * Muốn hỏng TO và SỚM thì gọi `assertHeadroomPolicy()` lúc nạp cấu hình — đó là chỗ được phép ném.
 */
export function computeHeadroom(input: HeadroomInput): HeadroomResult {
  // M-6 — một biến cục bộ khử cả hai lượt ép kiểu `as number` của bản trước, đúng chỗ dễ đọc nhầm nhất.
  const attributable = input.attributableBytes;
  // MÙ = không có số dùng được. `null` (không tính được) và một số HỎNG (`NaN` từ đầu dò) đều phải
  // rơi vào đây: một `NaN` lọt xuống `Math.max` sẽ nuốt cả vế sổ và cho headroom `NaN`.
  const blind = attributable === null || !usable(attributable);

  const invalidInput =
    !usable(input.ceilingBytes) ||
    // M-1 — `VRAM_CEILING_MB=` (để TRỐNG) ⇒ `Number("") === 0` ⇒ lọt `isFinite` ⇒ headroom âm
    // khổng lồ ⇒ TỪ CHỐI 100% lượt xin, IM LẶNG, toàn hệ AI chết. Chiều fail-closed, nhưng vẫn
    // đúng lớp lỗi `.env` mà C-1 sinh ra để diệt ⇒ phải CÓ TÊN.
    input.ceilingBytes <= 0 ||
    !usable(input.ledgerTotalBytes) ||
    !usable(input.safetyReserveBytes) ||
    // Đệm ÂM là phép CỘNG dư địa — nới đúng chiều nguy hiểm. Không có ca dùng hợp lệ nào.
    input.safetyReserveBytes < 0 ||
    (attributable !== null && !usable(attributable));

  /**
   * ⚠⚠ HAI DÒNG DƯỚI LÀ TOÀN BỘ CÔNG THỨC. Đọc khối đầu file trước khi đổi bất cứ ký tự nào —
   * đặc biệt: `max` KHÔNG được thành `+` (đếm hai lần) và nhánh `blind` KHÔNG được thành
   * `attributableBytes ?? 0` (một `0` giả sẽ khai rằng ta ĐÃ ĐO và thiết bị TRỐNG, xoá luôn cả
   * `blind` lẫn cơ hội để Task 5 chạy chặt hơn — trong khi sự thật là ta KHÔNG BIẾT GÌ).
   */
  const usedBytes = blind ? input.ledgerTotalBytes : Math.max(input.ledgerTotalBytes, attributable);
  const headroomBytes = invalidInput
    ? // KHÔNG dùng `NaN`: mọi so sánh với `NaN` đều `false` ⇒ cưỡng chế TẮT im lặng (C-1).
      // `-Infinity` từ chối mọi lượt xin một cách TẤT ĐỊNH, và `"invalid-input"` nói ra vì sao.
      Number.NEGATIVE_INFINITY
    : // KHÔNG kẹp về 0: vượt trần phải trả về ÂM, và độ lớn phần âm là thông tin của câu từ chối.
      input.ceilingBytes - usedBytes - input.safetyReserveBytes;

  const basis: HeadroomBasis = blind ? "ledger-only" : attributable > input.ledgerTotalBytes ? "attributable" : "ledger";

  const degradedReasons: HeadroomDegradation[] = [];
  if (invalidInput) degradedReasons.push("invalid-input");
  // I-2 — HAI MỨC KHÁC NHAU, không được gộp: "chưa bao giờ có số" (cấu trúc) vs "nhịp này không
  // có số" (tạm thời, lành ở nhịp sau).
  if (blind) degradedReasons.push(input.tickPresent ? "probe-blind" : "no-tick");
  if (!input.baselineVerified) degradedReasons.push("unverified-baseline");

  return {
    headroomBytes,
    basis,
    blind,
    baselineVerified: input.baselineVerified,
    trusted: degradedReasons.length === 0,
    // M-2 — `readonly` chỉ là kiểu, không chặn `push` lúc chạy. Đông cứng để không ai bơm thêm lý
    // do vào bản tóm tắt mà Task 4 sẽ dán thẳng vào câu từ chối.
    degradedReasons: Object.freeze(degradedReasons),
    usedBytes,
  };
}

/**
 * Hình dạng TỐI THIỂU mà `computeHeadroom` cần từ một nhịp đối chiếu. `VramReconcileResult` khớp
 * kiểu này theo cấu trúc — CỐ Ý không `import type` từ `./vramReconciler` để file này không kéo
 * theo một module có I/O và trạng thái toàn cục (xem "không import gì" ở đầu file).
 * ⚠ M-4: **neo biên dịch** cho phép khớp đó nằm ở phía `vramReconciler.ts` (nơi được phép import
 * cả hai) — tìm `HeadroomTickFields` ở đó. Không có neo ấy thì Task 1 đổi tên trường vẫn build xanh
 * và chỉ file test này đỏ.
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
   * cái cửa mà cưỡng chế sinh ra để đóng.
   *
   * ★★ ĐÂY LÀ THỨ KHOÁ LẠI PHẦN LỚN NHẤT CỦA RỦI RO "TICK CŨ" (I-3, review Task 2). Gọi `A₀` là
   * `attributable` đo lúc `atMs`, `A*` là giá trị thật lúc quyết định: phần `A* − A₀` **do CHÍNH TA
   * cấp phát** đã được `reserve()` đặt cọc vào sổ **ngay lập tức và đồng bộ** ⇒ vế `L` **vẫn bắt
   * được nó**. Phần KHÔNG bắt được chỉ còn là mức tăng của **hộ NGOÀI SỔ** (145/159 dòng chưa nối)
   * kể từ `atMs`. Đọc sổ từ tick là tự tay vứt bỏ lá chắn này.
   */
  readonly ledgerTotalBytes: number;
}

/**
 * Ghép ô tick gần nhất + chính sách thành đầu vào của `computeHeadroom`. Thuần, đồng bộ, không ném.
 *
 * ⚠ `tick === null` (CHƯA có nhịp nào) ⇒ `tickPresent: false` ⇒ lý do **`"no-tick"`**, KHÁC hẳn
 * `"probe-blind"`. Ca này **có thật và thường trực**: 60 giây đầu của mọi vai trò, và **vĩnh viễn**
 * ở tiến trình nào không chạy reconciler.
 *
 * ⚠⚠ HÀM NÀY KHÔNG HẾT HẠN TICK, và ngưỡng tuổi của Task 5 **PHẢI KHÔNG đi qua
 * `attributableBytes = null`** (I-3 — hệ quả ngược đời, phải nhận trước khi chọn ngưỡng):
 *   • một tick CŨ **vẫn có số** ⇒ `blind: false`, `trusted` có thể `true` ⇒ nó **không** tắt lớp
 *     bảo vệ, nó **khai một con số có thể sai kèm dấu ĐÁNG TIN**. Đó là một **phạm trù RIÊNG**,
 *     KHÔNG phải một đường `blind` (đường `blind` thứ 12 là `tickPresent: false`, không phải cái này);
 *   • chiều nguy hiểm của nó là **LỎNG HƠN** (thiết bị đã chiếm thêm mà số chưa biết); chiều
 *     "chặt hơn" chỉ xảy ra khi thiết bị NHẢ bớt, và ca đó tự lành trong ≤ 1 nhịp;
 *   • vì `max(L, A) ≥ L`, **"quá hạn ⇒ vứt `A` ⇒ `null`" là phép LÀM LỎNG** (tự nâng headroom lên
 *     chặn TRÊN) — tức phản ứng với *"số của tôi có thể đã cũ"* bằng *"vậy coi như thiết bị trống"*.
 *   ⇒ Chính sách hết hạn ĐÚNG: **GIỮ số, CỘNG một biên theo tuổi** (spec §5.6c đã chỉ vật liệu:
 *   *"biên bằng tốc độ cấp phát lớn nhất quan sát được trong một tick"*) **rồi hạ `trusted`**.
 *   `readLastReconcileTick()` trả kèm `atMs` và `consecutiveFailures` để làm đúng việc đó.
 */
export function headroomInputFromTick(tick: HeadroomTickFields | null, policy: HeadroomPolicy): HeadroomInput {
  return {
    ceilingBytes: policy.ceilingBytes,
    safetyReserveBytes: policy.safetyReserveBytes,
    ledgerTotalBytes: policy.ledgerTotalBytes,
    attributableBytes: tick === null ? null : tick.attributableBytes,
    // Không có tick ⇒ KHÔNG có bằng chứng nào về nền ⇒ `false`. Mặc định phải là "chưa xác minh",
    // không bao giờ là "coi như đã xác minh".
    baselineVerified: tick === null ? false : tick.baselineVerified,
    // I-2 — thông tin mà CHỈ chỗ này biết. Vứt nó đi là xoá ranh giới giữa "không bao giờ có số"
    // và "nhịp này không có số".
    tickPresent: tick !== null,
  };
}

/**
 * ★★ C-1 — CỔNG CẤU HÌNH, và là **chỗ DUY NHẤT trong module này được phép NÉM**.
 *
 * Mục tiêu: `.env` hỏng thì lộ ra **TO và SỚM** (lớp "hỏng SỚM"), thay vì đợi tới lượt xin đầu tiên.
 *
 * ⚠⚠⚠ N-1 (re-review) — **KHÔNG CÓ VỊ TRÍ NÀO TRONG REPO HÔM NAY ĐẠT ĐƯỢC LỚP ĐÓ. ĐỌC HẾT TRƯỚC
 * KHI ĐẶT LỜI GỌI.** Bản trước của chính docstring này khuyến nghị *"mức module của `vramBroker`
 * hoặc khối bật VRAM lúc boot"*. **CẢ HAI ĐỀU BỊ NUỐT**, và đó là tài liệu SAI về một lưới:
 *   • **mức module `vramBroker`** chính là chỗ đã được chứng minh là bị nuốt: điểm nhập của nó nằm
 *     ở `await import("./vramBroker")` **bên trong `try` của `beginVramAllocation()`**, và `catch`
 *     ở đó trả `NOOP_TICKET`. Hôm nay nó *"có vẻ chạy"* chỉ vì I-1 vừa kéo `vramReconciler` (import
 *     TĨNH `vramBroker`) lên đường boot — một **TAI NẠN THỨ TỰ IMPORT**, không phải một thiết kế;
 *     đổi thứ tự import là mất, mà không lưới nào bắt.
 *   • **khối bật VRAM lúc boot** — cả hai điểm (`index.ts` trước nhánh rẽ `ROLE`, và đầu
 *     `runWorkerProcess()`) đều là `try { … } catch { console.error(…) }`, cố ý như vậy từ Pha 1
 *     (*"telemetry không bao giờ được làm hỏng boot"*).
 *
 * ⇒ **Trạng thái thật: lớp "không hỏng SAI" CÓ THẬT (fail-closed có tên trong `computeHeadroom`);
 * lớp "hỏng SỚM" hiện KHÔNG đạt được ở đâu cả.** Muốn có nó, Task 5 phải chọn một cách **đứng ngoài
 * mọi `try`** và nói rõ mình chọn gì — ứng viên: một `import` **TĨNH** ở mức module của điểm vào
 * (`server/_core/index.ts` / `server/worker.ts`), nơi lỗi nạp module nổ trước khi bất kỳ `try` nào
 * tồn tại; hoặc một lượt kiểm cấu hình ở đường khởi chạy **không** bọc `try`. Đây là **quyết định
 * của Task 5** (nó sở hữu cấu hình trần/đệm), và Task 2 **không được** tự dựng cấu hình đó.
 *
 * ⚠ Vì vậy: gọi hàm này là **bổ sung**, không phải điều kiện. Dù KHÔNG ai gọi, `computeHeadroom()`
 * vẫn fail-closed CÓ TÊN — hai lớp phục vụ hai mục tiêu khác nhau, và hôm nay chỉ có một lớp chạy.
 */
export function assertHeadroomPolicy(policy: {
  readonly ceilingBytes: number;
  readonly safetyReserveBytes: number;
}): void {
  if (!usable(policy.ceilingBytes) || policy.ceilingBytes <= 0) {
    throw new TypeError(
      `[vram] cấu hình cưỡng chế hỏng: trần = ${String(policy.ceilingBytes)} byte (phải là số hữu hạn > 0). ` +
        `Nguồn thường gặp: VRAM_CEILING_MB để TRỐNG ⇒ Number("") === 0 ⇒ dư địa âm ⇒ TỪ CHỐI 100% lượt xin; ` +
        `hoặc một chuỗi hỏng ⇒ NaN ⇒ mọi so sánh false ⇒ cưỡng chế TẮT. Sửa cấu hình, đừng bắt đường nóng đoán.`,
    );
  }
  if (!usable(policy.safetyReserveBytes) || policy.safetyReserveBytes < 0) {
    throw new TypeError(
      `[vram] cấu hình cưỡng chế hỏng: đệm an toàn = ${String(policy.safetyReserveBytes)} byte ` +
        `(phải là số hữu hạn ≥ 0). Một đệm ÂM là phép CỘNG dư địa — nới đúng chiều nguy hiểm.`,
    );
  }
}
