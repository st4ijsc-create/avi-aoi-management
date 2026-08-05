/** Mức ưu tiên, xếp theo giá trị thật của nhà máy (spec §5.2). */
export type VramPriority = "production" | "interactive" | "background";

export type VramLeaseKind =
  /**
   * Pha 1.5 Task 2 — backend CUDA của `getLlama()`, ~430 MiB/thể hiện.
   *
   * ⚠ I-1 (review TOÀN NHÁNH) — bản trước ghi *"singleton cả tiến trình"*: **SAI**. Singleton là
   * `aiGgufEngine.llamaInstance`, KHÔNG phải lớp giấy phép này. Tiến trình có **HAI** thể hiện
   * backend ĐỘC LẬP: `cuda-backend` (`aiGgufEngine`) và `cuda-backend:reranker` (`aiReranker`
   * gọi thẳng `getLlama()` trên backend riêng của nó). Người sau đọc "singleton" rồi giả định
   * "chỉ cần cộng một khoản 430 MiB" sẽ tính thiếu đúng một backend — đó là cách I-1 lọt qua
   * TÁM lượt review.
   */
  | "gguf-backend"
  | "gguf-model"
  | "gguf-context"
  | "gguf-embed-context"
  | "onnx-session"
  | "external-process";

/**
 * Ước lượng đến từ đâu — để truy được chỗ nào còn dùng hằng số cấu hình.
 * `"unknown"` (review round 1, Task 3): KHÔNG có learned, KHÔNG có file, KHÔNG có hằng số
 * cấu hình nào — khác "config-default" (có hằng số, chỉ là chưa đo thật). Tách riêng để
 * Task 7 đọc `estimateSource` không bị chỉ sai địa chỉ "chỗ nào còn dùng hằng số".
 *
 * `"fallback-after-measure-failure"` (Pha 2A Task 4, T5-15): con số trong `actualBytes` KHÔNG đến
 * từ phép đo nào — nó là ƯỚC LƯỢNG DỰ PHÒNG được chốt sổ SAU khi phép đo hỏng, cho một khối byte
 * mà điểm gọi CHẮC CHẮN là đang tồn tại (hôm nay: backend CUDA, 452.595.712 byte đo được giống hệt
 * ở 5/5 tiến trình trên hai thước độc lập). ⚠ Nấc này KHÔNG BAO GIỜ đi qua `vramEstimator`: nó
 * không được sinh bởi `estimateBytesFor()` và cũng KHÔNG được nạp vào nấc `learned` — xem
 * `vramBroker.commitFallback()`.
 * ⚠ Cột DB `vram_events.estimateSource` phải đủ rộng cho chuỗi 30 ký tự này (migration 0311).
 */
export type VramEstimateSource =
  | "learned"
  | "file-size"
  | "config-default"
  | "unknown"
  | "fallback-after-measure-failure";

/**
 * Pha 2A Task 3 — CÁI THƯỚC nào đã đẻ ra con số `actualBytes`. Ghi vào giấy phép VÀ vào sự kiện
 * để về sau truy được "số này đến từ thước nào", chứ không phải đoán theo ngày commit.
 *
 * ⚠⚠ Đ4 (ràng buộc toàn cục 2) — HAI GIÁ TRỊ ĐẦU LÀ HAI THƯỚC KHÁC NHAU, TUYỆT ĐỐI KHÔNG TRỘN:
 * số TUYỆT ĐỐI của bộ đếm `\GPU Process Memory` luôn cao hơn `nvidia-smi`/`getVramState`
 * **+505…+511 MiB**. Bộ đếm chỉ dùng cho CHÊNH LỆCH trong một cửa sổ. Trường này tồn tại đúng để
 * một phép so sánh trộn thước trở nên NHÌN THẤY ĐƯỢC trong dữ liệu (`measureSource` khác nhau ⇒
 * hai số không so được với nhau), không phải để tiện gộp.
 *
 * - `"process-delta"` — `after − before` trên bộ đếm THEO TIẾN TRÌNH (`vramProcessProbe`). Đây là
 *   nguồn DUY NHẤT của `actualBytes` do `vramWiring` sinh ra kể từ Pha 2A.
 * - `"device-delta"` — `after − before` trên `used` TOÀN THIẾT BỊ (`vramProbe`). Nguồn của mọi
 *   bản ghi TRƯỚC Pha 2A, và là mặc định của `commit()` khi người gọi không khai nguồn. Đường đo
 *   của `vramWiring` KHÔNG còn sinh ra giá trị này nữa.
 * - `"none"` — không có phép đo nào thành công (đầu dò null, cửa sổ không cô lập được, delta âm).
 *   Đi kèm `measureFailed = true`; `actualBytes` đứng nguyên `null`.
 */
export type VramMeasureSource = "device-delta" | "process-delta" | "none";

/**
 * ★★★ Pha 2B Task 7 (§8) — **AI ĐI LẤY LẠI ĐƯỢC KHỐI BYTE NÀY**, khai bởi ĐIỂM GỌI.
 *
 * ⚠⚠ VÌ SAO KHAI THEO ĐIỂM GỌI, KHÔNG SUY THEO `kind` — và đây là một LỖI CÓ THẬT vừa bắt được,
 * không phải một lo xa: vị từ của Task 5 viết `kind === "gguf-model" && refCount === 0`, và
 * `aiReranker` cũng xin giấy phép `kind: "gguf-model"` (`aiReranker.ts:480`) **cho một model nạp
 * thẳng qua backend riêng của nó** — nó KHÔNG nằm trong `loadedModels`, nên `evictLRU()` (người thi
 * hành DUY NHẤT hôm đó) **không với tới**. Tức câu từ chối đã cộng model của reranker vào *"tổng
 * nhường được"* trong khi không cơ chế nào lấy lại được nó: **HỨA NGƯỢC**, đúng lớp lỗi mà chính
 * `reclaimable` được đẻ ra để diệt. Suy theo `kind` là suy theo HÌNH DẠNG; chỉ điểm gọi mới biết
 * **ai** dọn được khối byte của nó.
 *
 * ⚠ Không khai ⇒ **KHÔNG ai thu hồi được** (mặc định AN TOÀN theo chiều câu chữ: không hứa).
 *
 * Mỗi giá trị BẮT BUỘC có đúng một người thi hành trong `vramPreempt.NGUOI_THI_HANH` — bảng đó là
 * `Record<VramReclaimerId, …>` nên thêm một giá trị ở đây mà quên người thi hành là **lỗi `tsc`**,
 * không phải một lời hứa suông chạy được tới sản xuất.
 */
export type VramReclaimerId =
  /** `aiGgufEngine.unloadGgufModel()` — dispose THẬT trọng số + context, rồi mới nhả sổ. */
  | "gguf-idle-model"
  /** `llamaVisionSidecar.stopSidecar()` — SIGTERM/SIGKILL tiến trình con (`releaseProof: "process-exit"`). */
  | "vision-sidecar"
  /**
   * ★★★ Pha 3 Task 5 (A) — **HỘ NGOÀI TIẾN TRÌNH.** `vramReconciler.thuHoiHoNhanNuoi(pid)` —
   * giết ĐÚNG PID của một sidecar **MỒ CÔI đã được nhận nuôi** (Task 4), rồi **xác minh bằng
   * THIẾT BỊ** (`nvidia-smi --query-compute-apps` không còn liệt kê PID đó) trước khi nhả sổ.
   *
   * ⚠⚠ ĐÂY LÀ NGƯỜI THI HÀNH DUY NHẤT VỚI TỚI ĐƯỢC MỘT TIẾN TRÌNH **KHÔNG PHẢI CON CỦA TA**, và
   * dân số của nó **hẹp một cách CÓ CẤU TRÚC**: chỉ giấy phép mang dấu `#nhan-nuoi-pid=N` trong
   * `owner` (do **một** người ghi: `vramAdoption.ownerNhanNuoi()`) mới dịch ra được một PID, nên
   * không có đường nào để nó chạm vào sidecar CỦA CHÍNH TA (`MocCaiChet` lo hộ đó — ranh giới
   * 543 ms của Task 1) hay vào một tiến trình anh em **còn sống**.
   *
   * ⚠ Task 4 CỐ Ý để trống ô `reclaimer` của giấy phép nhận nuôi và ghi rõ lý do: khai
   * `"vision-sidecar"` là **HỨA NGƯỢC** — `stopSidecar()` chỉ giết được `proc` của chính tiến
   * trình này. Món nợ đó được trả ở ĐÂY, bằng một người thi hành THẬT, không bằng một cái nhãn.
   */
  | "orphan-pid";

export interface VramReserveRequest {
  owner: string;
  kind: VramLeaseKind;
  estimatedBytes: number;
  priority: VramPriority;
  /** Bắt buộc cho external-process: thiếu nhịp quá hạn thì reconciler xác minh rồi thu hồi. */
  ttlMs?: number;
  estimateSource?: VramEstimateSource;
  /**
   * ★ Task 7 — ai THI HÀNH được lượt thu hồi hộ này. Xem `VramReclaimerId`.
   * ⚠ Khai ở đây KHÔNG có nghĩa "được phép thu hồi" (quyền là `coTheNhuong()` — §5.2), mà là
   * "CÓ NGƯỜI làm được". Hai câu hỏi khác nhau, cố ý hai ô khác nhau.
   */
  reclaimer?: VramReclaimerId;
}

export interface VramLease {
  id: string;
  request: VramReserveRequest;
  acquiredAt: Date;
  /**
   * null cho tới khi `commit()`.
   *
   * ⚠⚠ Pha 2A Task 4 (T5-15) — `actualBytes !== null` KHÔNG CÒN đồng nghĩa "đã đo được".
   * `commitFallback()` cũng điền ô này bằng một ƯỚC LƯỢNG DỰ PHÒNG (kèm `measureFailed: true` và
   * `measureSource: "none"`). Ai cần "con số này có phải SỐ ĐO không" phải hỏi `measureSource`
   * (`"none"` = không thước nào đẻ ra nó), KHÔNG được suy ra từ `actualBytes !== null`.
   * Ba nhóm, đọc bằng HAI trường:
   *   • `null`                              → chưa có số nào (đang nạp, hoặc đo hỏng chưa dự phòng)
   *   • `!== null` + `measureSource !== "none"` → SỐ ĐO của đúng thước đó
   *   • `!== null` + `measureSource === "none"` → ƯỚC LƯỢNG DỰ PHÒNG (T5-15), và `fallbackReason`
   *     nói VÌ SAO. Hai câu hỏi khác nhau, hai ô khác nhau: `measureSource` trả lời *"thước nào đẻ
   *     ra con số"* (dùng cho phép tách theo thước, Đ4/I-4), `fallbackReason` trả lời *"con số này
   *     có phải dự phòng không, vì sao"* (dùng cho nhật ký). Hôm nay hai ô luôn khớp nhau; đừng
   *     "dọn dẹp" bằng cách bỏ một ô — chúng sẽ tách nhau ngay khi có một thước thứ ba.
   */
  actualBytes: number | null;
  /**
   * I-2 (review TOÀN NHÁNH) — phép ĐO đã chạy nhưng cho kết quả VÔ NGHĨA (delta âm), nên
   * `actualBytes` sẽ KHÔNG BAO GIỜ được điền và giấy phép này giữ ƯỚC LƯỢNG vĩnh viễn.
   *
   * ⚠ Bắt buộc phải TÁCH khỏi `actualBytes === null`: hai trạng thái đó trông giống hệt nhau
   * nhưng nghĩa NGƯỢC nhau. `actualBytes === null` + cờ này TẮT = "đang cấp phát dở, số thật
   * sắp tới" (tự lành trong vài giây). `actualBytes === null` + cờ này BẬT = "đã đo, đo hỏng,
   * số này đứng mãi" (KHÔNG tự lành). Gộp hai thứ lại là lý do câu cảnh báo lệch ÂM của
   * `vramReconciler` từng chỉ người trực đi SAI hướng: nó gọi một giấy phép đo-hỏng là
   * "ứng viên số một (chưa commit)" và người trực ngồi đợi một thứ không bao giờ tới.
   */
  measureFailed?: boolean;
  /**
   * Pha 2A Task 3 — thước đã sinh ra `actualBytes` hiện tại. `undefined` = chưa commit lần nào.
   * ⚠ Đ4: KHÔNG được so `actualBytes` của hai giấy phép có `measureSource` khác nhau.
   */
  measureSource?: VramMeasureSource;
  /**
   * ★ Pha 2A Task 4 (T5-15), review vòng 1 (I-2 × M-3) — LÝ DO phải chốt sổ bằng ƯỚC LƯỢNG DỰ
   * PHÒNG. `undefined` = con số trong `actualBytes` KHÔNG phải dự phòng (hoặc chưa có số nào).
   *
   * ⚠ VÌ SAO LÀ TRƯỜNG RIÊNG, KHÔNG PHẢI GHI ĐÈ `request.estimateSource` (M-3): bản đầu của Task 4
   * ghi `"fallback-after-measure-failure"` đè lên đó và làm HAI việc sai cùng lúc — (a) **xoá xuất
   * xứ ước lượng GỐC** (`file-size`/`config-default`/`unknown`), thứ Task 7 đọc để trả lời "chỗ nào
   * còn dựa hằng số"; (b) **mutate object của người gọi** — `reserve()` lưu `request` theo THAM
   * CHIẾU, nên lời gọi đó sửa luôn object nằm ngoài sổ. Hai sự thật khác nhau thì hai ô khác nhau.
   *
   * ⚠ Đây cũng là nơi `reason` của `commitFallback()` được lưu, thay vì bốc hơi sau lời gọi: sự
   * kiện `release` (và mọi chỗ đọc sổ SỐNG) nhờ nó mà nói được "số này là ước lượng, và vì sao".
   */
  fallbackReason?: string;
  lastHeartbeatAt: Date;
  released: boolean;
  /**
   * ★★★ Pha 2B Task 5 (§5.2) — SỐ NGƯỜI ĐANG DÙNG khối byte này. `0` = **NHÀN RỖI** ⇒ được phép
   * thu hồi. Mọi giá trị khác = **ĐANG DÙNG**.
   *
   * ⚠⚠ MẶC ĐỊNH LÀ `1`, KHÔNG PHẢI `0`, và đó là một quyết định an toàn chứ không phải một chi
   * tiết: `reserve()` mở giấy phép cho một lượt cấp phát **sắp chạy** — thứ đang-được-dùng theo
   * đúng nghĩa đen. Một mặc định `0` biến MỌI giấy phép vừa mở thành ứng viên bị thu hồi ngay
   * trong lúc nó đang nạp 17 GB lên card.
   *
   * ⚠ Ai khai `0` phải CHẮC CHẮN khối byte đó không có người dùng. Hôm nay có đúng MỘT người khai:
   * `aiGgufEngine` đồng bộ `LoadedModel.refCount` (bộ đếm mà `evictLRU()` cũ đã dùng làm điều
   * kiện đuổi) sang đây. Xem `vramBroker.setLeaseRefCount()`.
   */
  refCount: number;
}

export interface VramReserveResult {
  /**
   * ★ Pha 2B Task 5 — `null` = **ĐÃ TỪ CHỐI**. Từ đây đây là một kết cục CÓ THẬT trên đường sản
   * xuất, không còn là chỗ dành sẵn: `vramWiring.beginVramAllocation()` dựng `VramRefusedError`
   * từ `refusal` và **NÉM**, thay vì trả một giấy phép rỗng rồi để lượt cấp phát chạy ngoài sổ.
   */
  lease: VramLease | null;
  /**
   * Lượt này CÓ bị từ chối không. ⚠ Từ Task 5, đây KHÔNG còn là phán quyết BÓNG: nó luôn bằng
   * `lease === null`. Giữ tên cũ vì nhật ký `vram_events.wouldRefuse` (và mọi câu truy vấn Pha 1)
   * đọc đúng ô này — đổi tên là làm gãy chuỗi số liệu trước/sau khi bật cưỡng chế.
   */
  wouldRefuse: boolean;
  /** Owner của các giấy phép có thể nhường chỗ (§5.2). Xem `vramBroker.preemptCandidates()`. */
  wouldPreempt: string[];
}

export interface VramSnapshot {
  totalReservedBytes: number;
  leases: VramLease[];
}

/**
 * ★ Pha 2B Task 4 — `VramRefusedError` **ĐÃ CHUYỂN NHÀ** sang `./vramRefusal`.
 *
 * Bản Pha 1 sống ở đây và nhận ba tham số rời (`requestedBytes`, `availableBytes`, `holders`).
 * Nó **thiếu hẳn một trong bốn thứ §5.3 đòi** — *"ai có thể nhường"* — và không có chỗ nào để nói
 * ra **phần KHÔNG quy trách nhiệm được** (sổ mới nối 15/160 dòng, và bản liệt kê ấy là CẬN DƯỚI).
 * Một câu từ chối liệt kê "A, B" trong khi C, D, E vô hình khiến người trực đi **giết nhầm**.
 *
 * Việc chuyển nhà cũng đúng chỗ theo phân vai của chính file này: đây là nơi giữ **kiểu dùng
 * chung, không logic**, còn dựng câu chữ + lọc số không hữu hạn là HÀNH VI. Bản Pha 1 chưa có
 * điểm gọi sản xuất nào (`git grep VramRefusedError` chỉ ra chính nó), nên không phá ai.
 */

/**
 * ★★★ Pha 4 Task 1 — **HAI UNION NỀN ĐÃ DỜI XUỐNG ĐÂY TỪ `vramReconciler`.**
 *
 * Lý do là một ràng buộc cấu trúc, không phải sắp xếp cho gọn: từ Pha 4, `vramTickCell` — **module LÁ,
 * không nhập gì** — mang luôn hai ô chẩn đoán của nền (xem `VramDecisionTickFields`), nên nó cần hai
 * kiểu này. Kéo `vramReconciler` (một module có I/O, đồng hồ, trạng thái toàn cục) vào đường nhập
 * của ô quyết định là đúng thứ `vramTickCell.ts` được dựng ra để tránh. `import type` bị xoá sạch lúc
 * biên dịch, và file này **thuần kiểu** — không thêm một byte runtime nào.
 * ⚠ `vramReconciler` **xuất lại** hai tên này để mọi điểm nhập cũ không phải đổi một dòng.
 */
/** Xem `VramReconcileResult.baselineOrigin`. */
export type BaselineOrigin = "local" | "captured" | "adopted";

/**
 * ★★★ Pha 3 Task 3, QUYẾT ĐỊNH 2 — VÌ SAO NỀN KHÔNG ĐÁNG TIN. Xem
 * `VramReconcileResult.baselineUnverifiedReasons` và `lyDoNenKhongTin()`.
 */
export type VramBaselineDistrustReason =
  /** Chưa có lượt chụp/nhận nào trong tiến trình này — KHÔNG phải "nền sạch". */
  | "chua-chup-nen"
  /** Không liệt kê được tiến trình đang giữ GPU ⇒ **không biết** có tàn dư hay không. */
  | "khong-quet-duoc-ho-giu-gpu"
  /** Có TÀN DƯ của lượt chạy trước giữ GPU — byte của nó không quy trách nhiệm được cho ai. */
  | "co-tan-du-giu-gpu"
  /**
   * ★★★ VỊ TỪ THAY CHO VẾ `peers` CŨ. Có vai trò ANH EM trên card **mà byte của họ CHƯA được tính**
   * — tức sổ chung không đọc được (`baselineOrigin === "local"`, không ai thắng bầu) **hoặc** sổ
   * chung đọc được nhưng **KHÔNG có một hàng nào của ai khác** (anh em đang giữ card mà im lặng).
   *
   * ⚠⚠ VÌ SAO VẾ `peers` CŨ PHẢI CHẾT: nó hạ cờ **chỉ vì có anh em**, và lý do của nó là *"nền đã
   * NUỐT byte của họ"* — mà **chính Task 3 vừa xoá bỏ tình trạng đó** (nền do MỘT tiến trình chụp,
   * byte anh em nằm ở `attributable`; nghiệm thu sống: nền **1.234.386.944** thay vì
   * **9.444.524.032**, `drift = 0`). Giữ nguyên vế cũ trong topo `api`+`worker` là biến cờ thành
   * **hằng số `false`** kèm **1.024 MiB phạt thường trực** — mất dư địa VÀ mất thông tin, đúng lớp
   * lỗi I-3 mà Task 2 đã phải sửa một lần cho `shared-ledger-unsynced`.
   *
   * ⚠ VÀ VÌ SAO KHÔNG **BỎ HẲN** VẾ ĐÓ: `census.peers` vẫn là câu trả lời DUY NHẤT cho *"có ai khác
   * của hệ đang ở trên card không"*. Cái đổi là **câu hỏi thứ hai** — *"byte của họ đã được tính
   * chưa"* — và câu đó nay **có nguồn** (sổ chung). Hai câu, hai nguồn, không nguồn nào đoán byte
   * (`nvidia-smi` trả `used_memory=[N/A]`, ràng buộc không đổi).
   */
  | "anh-em-tren-card-chua-duoc-tinh"
  /** Nền ĐỌC ĐƯỢC của người khác đã cũ hơn một chu kỳ làm mới bản sao. */
  | "nen-nhan-nuoi-qua-cu"
  /** Người chụp tự khai nền của họ CHƯA xác minh — người đọc KHÔNG được nâng cấp lời khai đó. */
  | "nguoi-chup-khai-chua-xac-minh";
