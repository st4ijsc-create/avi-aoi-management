/**
 * Wave 2 đường A — Task 3: chia kết quả đề xuất hàng loạt thành BA nhóm —
 * "gửi được" / "chưa nên đề xuất tự động" / "không lấy được khuyến nghị" — và
 * ánh xạ MỘT kết quả recommendForPoint (thô) sang dạng BatchSuggestItem mà
 * partitionBatch hiểu. Cũng chứa vòng gửi hàng loạt CÓ THỂ HUỶ
 * (runCancellableBatchSubmit), tách khỏi React để test được thuần tuý.
 *
 * Nguyên tắc TRUNG THỰC (bắt buộc theo kế hoạch Wave 2 đường A):
 *   - Điểm không đủ mẫu (sampleSize < ngưỡng tối thiểu, mặc định 300 —
 *     server/services/aiThresholdAdvisor.ts:37-40, `minSamples()`) PHẢI rơi
 *     vào nhóm `insufficient` (tên field TypeScript — KHÔNG đổi, xem Vòng sửa
 *     2) kèm lý do THẬT (lấy nguyên văn `note` do server tính), TUYỆT ĐỐI
 *     không bịa proposedLsl/proposedUsl/proposedNominal cho nó.
 *   - `needsReview` (server chỉ đặt khi `degraded===false` — tức ĐÃ ĐỦ mẫu,
 *     nhưng dữ liệu đo lệch xa giới hạn hiện tại, nghi sai đơn vị/cấu hình
 *     điểm đo, server/services/aiThresholdAdvisor.ts:72-75,409-418) CŨNG rơi
 *     vào field `insufficient` dù đủ mẫu: số liệu không đáng tin để tự động
 *     gửi hàng loạt mà không ai xem qua trước — cùng nguyên tắc chặn mà
 *     AIThresholdSuggestButton áp dụng cho đường đơn-điểm
 *     (`disabled={busy || needsReview}`, client/src/components/AIThresholdSuggestButton.tsx).
 *   - Vòng sửa 1 (review Task 3, Important #2) — lỗi HẠ TẦNG (mạng/tính toán/
 *     điểm không tìm thấy/trợ lý chưa bật) là BẢN CHẤT KHÁC với "chưa nên đề
 *     xuất tự động": một cái là "chờ thêm sản phẩm để có mẫu / kỹ sư xem lại
 *     cấu hình", cái kia là "hệ thống hỏng/tắt, thử lại đi" — người dùng cần
 *     phân biệt để biết phải làm gì. Nhóm này tách riêng thành `failed` (field
 *     `BatchSuggestItem.failed`), KHÔNG gộp chung vào `insufficient` nữa.
 *   - Vòng sửa 2 (review Task 3, Minor) — tiêu đề UI của field `insufficient`
 *     TỪNG là "Chưa đủ dữ liệu", SAI bản chất với needsReview (đủ mẫu, chỉ là
 *     đáng ngờ — một dòng needsReview vẫn hiện đúng số mẫu thật, ví dụ 900, mà
 *     tiêu đề phía trên lại nói "chưa đủ"). Sửa CÂU CHỮ hiển thị
 *     (`productModels.batchNeedsCautionHeading` = "Chưa nên đề xuất tự động")
 *     — KHÔNG đổi field TypeScript `insufficient` (đổi sẽ đụng partitionBatch +
 *     toàn bộ test, ngoài phạm vi review yêu cầu).
 */
export interface BatchSuggestItem {
  pointDefId: number;
  ok: boolean;
  sampleCount: number;
  reason?: string;
  proposedLsl?: number;
  proposedUsl?: number;
  proposedNominal?: number;
  /**
   * Chỉ có ý nghĩa khi `ok=false`. `true` ⇒ đây là lỗi HẠ TẦNG (mạng, tính
   * toán, điểm không tìm thấy, trợ lý chưa bật) — "không lấy được khuyến
   * nghị", KHÁC với thiếu-mẫu-thật (degraded) hay needsReview. partitionBatch
   * dùng field này để tách nhóm `failed` khỏi `insufficient`. Không set (hoặc
   * `false`) ⇒ về nhóm `insufficient` như trước (giữ tương thích ngược với 3
   * ca test gốc của brief — chúng không set field này).
   */
  failed?: boolean;
}

export interface BatchPartition {
  ready: BatchSuggestItem[];
  insufficient: BatchSuggestItem[];
  failed: BatchSuggestItem[];
}

export function partitionBatch(items: BatchSuggestItem[]): BatchPartition {
  const ready: BatchSuggestItem[] = [];
  const insufficient: BatchSuggestItem[] = [];
  const failed: BatchSuggestItem[] = [];
  for (const it of items ?? []) {
    if (it.ok) ready.push(it);
    else if (it.failed) failed.push(it);
    else insufficient.push(it);
  }
  return { ready, insufficient, failed };
}

/**
 * Hình dạng tối thiểu cần thiết từ trpc.aiThresholdAdvisor.recommendForPoint
 * (PointRecommendation thật ở server/services/aiThresholdAdvisor.ts). Khai
 * báo lại (thay vì `import type` từ server) để file này thuần logic, không
 * kéo theo phụ thuộc runtime nào — PointRecommendation thật vẫn khớp cấu
 * trúc (structural typing của TS), nên truyền thẳng response tRPC vào đây
 * là hợp lệ mà không cần ép kiểu.
 */
export interface AdvisorRecommendationLike {
  ok: boolean;
  disabled?: boolean;
  degraded?: boolean;
  needsReview?: boolean;
  sampleSize?: number;
  note?: string;
  recommended?: { lsl: number; usl: number; target: number };
}

/**
 * Ánh xạ MỘT kết quả recommendForPoint (thô, có thể null nếu chưa gọi xong)
 * sang BatchSuggestItem. `errorMessage` dành cho lỗi tầng gọi mạng
 * (utils.aiThresholdAdvisor.recommendForPoint.fetch bị reject) — ưu tiên cao
 * nhất vì khi đó `rec` không đáng tin (undefined/không tồn tại).
 *
 * Vòng sửa 1 — ba nhánh "không ready", KHÔNG còn gộp chung:
 *   1) `failed=true` — lỗi HẠ TẦNG: gọi mạng lỗi, không có response, server trả
 *      `ok:false` (điểm không tìm thấy / lỗi tính toán — server tự kèm "vui
 *      lòng thử lại" trong `note`), `disabled` (trợ lý chưa bật), hoặc thiếu
 *      hẳn `recommended` dù `ok:true` (hình dạng bất thường, không đáng tin).
 *      ⇒ "Không lấy được khuyến nghị" — gợi ý: THỬ LẠI.
 *   2) `failed` không set — CHƯA NÊN ĐỀ XUẤT TỰ ĐỘNG, và đây là HAI lý do khác
 *      nhau dù cùng một nhóm (Vòng sửa 2 — UI phải nói đúng cả hai, không chỉ
 *      "chưa đủ dữ liệu"): `degraded` (thiếu mẫu THẬT — sampleSize < ngưỡng)
 *      HOẶC `needsReview` (server chỉ đặt khi `degraded===false`, tức ĐÃ ĐỦ
 *      mẫu — nhưng dữ liệu lệch xa giới hạn hiện tại, nghi sai đơn vị/cấu hình,
 *      server/services/aiThresholdAdvisor.ts:72-75,409-418). `item.reason` vẫn
 *      là `rec.note` nguyên văn nên luôn đúng ở tầng dòng-chi-tiết; chỉ tiêu đề
 *      NHÓM từng nói sai (gộp cả hai thành "thiếu dữ liệu" trong khi một nửa
 *      lại đủ mẫu) — đã sửa ở BatchSuggestDialog (`batchNeedsCautionHeading`).
 *   3) `ok=true` — sẵn sàng gửi, số liệu lấy nguyên văn từ server.
 */
export function toBatchItem(
  pointDefId: number,
  rec: AdvisorRecommendationLike | null | undefined,
  errorMessage?: string,
): BatchSuggestItem {
  if (errorMessage) {
    return { pointDefId, ok: false, failed: true, sampleCount: 0, reason: errorMessage };
  }
  if (!rec) {
    return { pointDefId, ok: false, failed: true, sampleCount: 0 };
  }
  if (!rec.ok || rec.disabled || !rec.recommended) {
    return { pointDefId, ok: false, failed: true, sampleCount: rec.sampleSize ?? 0, reason: rec.note };
  }
  if (rec.degraded || rec.needsReview) {
    return { pointDefId, ok: false, sampleCount: rec.sampleSize ?? 0, reason: rec.note };
  }
  return {
    pointDefId,
    ok: true,
    sampleCount: rec.sampleSize ?? 0,
    proposedLsl: rec.recommended.lsl,
    proposedUsl: rec.recommended.usl,
    proposedNominal: rec.recommended.target,
  };
}

// ─── Vòng gửi hàng loạt CÓ THỂ HUỶ (Vòng sửa 1 — review Task 3, Important #1) ──

export interface SubmitOutcome {
  pointDefId: number;
  ok: boolean;
  error?: string;
}

export interface RunCancellableBatchSubmitOptions<T> {
  items: T[];
  getId: (item: T) => number;
  /** Gửi MỘT item. Ném lỗi ⇒ ghi nhận là outcome lỗi (không làm vòng lặp dừng). */
  send: (item: T) => Promise<void>;
  /** Đọc cờ huỷ tại thời điểm gọi (không phải snapshot một lần). */
  isCancelled: () => boolean;
  /** CHỈ được gọi khi CHƯA huỷ tại thời điểm item vừa xong — đây là nơi DUY
   *  NHẤT hàm này "chạm" ra ngoài (component dùng nó để setState tiến độ). */
  onProgress?: (done: number, total: number) => void;
  fallbackErrorMessage?: string;
  /**
   * F1 — dịch lỗi thành câu cho người dùng. Người GỌI truyền vào (thường là
   * `mapTrpcError`), vì file này CỐ Ý không import React/trpc/i18n để test được không
   * cần DOM — xem docblock đầu file. Kéo `mapTrpcError` vào đây sẽ lôi theo `sonner`,
   * `i18next` và `@trpc/client`, phá đúng tính chất khiến nó tách ra được.
   *
   * Không truyền ⇒ giữ hành vi cũ (`err.message` thô). Chỗ gọi trong repo đều truyền.
   */
  mapError?: (err: unknown) => string;
}

/**
 * Gửi tuần tự từng item, CÓ THỂ HUỶ giữa chừng — tách khỏi React/trpc để test
 * thuần tuý (không cần render component hay mock tRPC).
 *
 * Hợp đồng (đọc kỹ trước khi đổi — đây là chỗ sửa lỗi "kết quả lô cũ đè lên
 * phiên mới" mà review Task 3 phát hiện):
 *   - Kiểm tra `isCancelled()` TRƯỚC khi gửi từng item — đã huỷ thì ĐỪNG bắn
 *     thêm request cho lô đã bị bỏ (không tạo thêm bản ghi bất ngờ trong DB
 *     cho một phiên người dùng đã rời khỏi).
 *   - MỘT KHI đã gọi `send(item)` — request đã bay đi, CÓ THỂ đã tạo bản ghi
 *     thật trong DB phía server — hàm này LUÔN await cho xong và ghi nhận kết
 *     quả vào `results`. Không "quên" một request đã thực sự xảy ra chỉ vì bị
 *     huỷ ngay sau đó (không thể/không nên giả vờ nó chưa từng xảy ra).
 *   - Ngược lại, `onProgress` — thứ DUY NHẤT chạm tới state/hiển thị phía gọi
 *     — CHỈ được gọi khi CHƯA phát hiện huỷ tại đúng thời điểm đó. Người gọi
 *     do đó không bao giờ setState cho một phiên đã bị huỷ.
 *   - Trả về `cancelled: true` ngay khi phát hiện huỷ (trước khi gửi item kế
 *     tiếp, hoặc ngay sau khi item hiện tại xong). `results` vẫn được trả về
 *     ĐẦY ĐỦ dù `cancelled=true` (để log/best-effort làm mới cache), nhưng
 *     người gọi TUYỆT ĐỐI không được khẳng định con số nào từ nó ra UI khi
 *     `cancelled=true` (không setSubmitResults, không toast) — xem
 *     BatchSuggestDialog.handleSubmit.
 */
export async function runCancellableBatchSubmit<T>(
  opts: RunCancellableBatchSubmitOptions<T>,
): Promise<{ cancelled: boolean; results: SubmitOutcome[] }> {
  const { items, getId, send, isCancelled, onProgress, fallbackErrorMessage, mapError } = opts;
  const results: SubmitOutcome[] = [];
  for (let i = 0; i < items.length; i++) {
    if (isCancelled()) return { cancelled: true, results };
    const item = items[i];
    try {
      await send(item);
      results.push({ pointDefId: getId(item), ok: true });
    } catch (err: any) {
      // i18n-raw-ok: nhánh `err?.message` chỉ chạy khi người gọi KHÔNG truyền `mapError`
      // — giữ tương thích ngược cho các ca test thuần của file này. Mọi chỗ gọi trong
      // repo đều truyền `mapTrpcError`.
      results.push({ pointDefId: getId(item), ok: false, error: (mapError ? mapError(err) : err?.message) || fallbackErrorMessage || "Gửi thất bại" });
    }
    if (isCancelled()) return { cancelled: true, results };
    onProgress?.(i + 1, items.length);
  }
  return { cancelled: false, results };
}
