/**
 * ★★★ Pha 2B Task 7 (§8) — **MỘT NGƯỜI ĐỌC DUY NHẤT** cho bốn biến trần đã tồn tại từ trước broker.
 *
 * Yêu cầu gốc của chủ dự án cho cả pha này: *"tất cả AI Local cần được điều phối thay vì tự do hoạt
 * động mà không có một người quản lý"*. Bốn biến dưới đây **giữ nguyên tên** (người vận hành đã đặt
 * chúng trong `.env`), nhưng từ task này chúng **không còn bốn người đọc rải rác ở bốn file** — mỗi
 * biến có đúng một chỗ được `process.env` chạm tới, và nghĩa của nó được khai ở đúng chỗ đó.
 *
 * | Biến | TRƯỚC (ai đọc, làm gì) | TỪ TASK 7 |
 * |---|---|---|
 * | `GGUF_VRAM_GUARD_PCT` | `aiGgufEngine.enforceVramGuard()` — phản ứng SAU khi đã ở 90%, **không biết sắp nạp bao nhiêu** | **TRẦN của broker**: `reserve()` biết kích thước TRƯỚC |
 * | `GGUF_MAX_VRAM_MB` | `aiGgufEngine.ensureCapacity()` — đuổi khi `getVramState().used` vượt | **TRẦN của broker** (byte) |
 * | `GGUF_MAX_LOADED_MODELS` | `aiGgufEngine.ensureCapacity()` — đếm `loadedModels.size` | **chính sách ĐẾM của broker** (đếm giấy phép `gguf-model` trong SỔ) |
 * | `AI_SESSION_CACHE_MAX` | `aiInferenceEngine` (LRU ONNX) — `ocrService` thì **KHÔNG CÓ TRẦN NÀO** | trần dùng chung cho **cả hai** kho phiên ONNX |
 *
 * ⚠⚠ ĐỌC LƯỜI + NHỚ, KHÔNG PHẢI `const` MỨC MODULE, và đó là một quyết định: `vramBroker` được
 * nhập rất sớm (đường boot), còn hơn hai chục bộ test đặt các biến này TRONG `beforeEach` rồi
 * `vi.resetModules()`. Một `const` mức module đọc `process.env` lúc nhập sẽ khoá cứng giá trị của
 * lượt nhập ĐẦU TIÊN — đúng lớp "cấu hình có vẻ đã đổi mà cơ chế không đổi" mà cả pha này diệt.
 * `__resetVramCapsForTests()` xoá bộ nhớ đệm.
 *
 * ⚠ ĐƠN VỊ: mọi hàm trả **BYTE** (ràng buộc toàn cục), trừ hai hàm khai rõ là ĐẾM/PHẦN TRĂM.
 * ⚠ Đ4 — trần theo BYTE (`GGUF_VRAM_GUARD_PCT`, `GGUF_MAX_VRAM_MB`) và trần theo ĐẾM
 * (`GGUF_MAX_LOADED_MODELS`) là **HAI THƯỚC** và **KHÔNG BAO GIỜ** được cộng/so với nhau. Chúng
 * cũng đi qua hai cửa khác nhau trong `reserve()`, mỗi cửa một lý do từ chối riêng.
 */

/** Không đặt / đặt rác ⇒ mặc định. Số hợp lệ ⇒ dùng. Cắt về số nguyên. */
function soNguyenTuEnv(ten: string, macDinh: number, toiThieu: number, toiDa: number): number {
  const raw = process.env[ten];
  if (raw === undefined) return macDinh;
  const n = Number(String(raw).trim());
  if (!Number.isFinite(n)) return macDinh;
  const v = Math.floor(n);
  return v >= toiThieu && v <= toiDa ? v : macDinh;
}

let nho: {
  guardPct: number;
  maxVramBytes: number;
  maxLoadedModels: number;
  sessionCacheMax: number;
  safetyReserveBytes: number;
} | null = null;

const MIB = 1024 * 1024;

function doc() {
  if (nho) return nho;
  nho = {
    /**
     * B0.1 cũ: *"trước khi nạp model thứ N, nếu VRAM đang dùng ≥ PCT% tổng thì ĐUỔI"* — rồi
     * **nạp tiếp dù không đuổi được ai**. Nghĩa mới: **TRẦN CỨNG** của broker, và broker biết
     * **kích thước sắp xin** nên nó chặn TRƯỚC lượt nạp thay vì phát hiện SAU khi đã ở 90%.
     * `100` = TẮT (bản cũ ép về 90 ở giá trị này — âm thầm biến "tôi muốn tắt" thành "vẫn bật";
     * nay `100` là một lựa chọn HỢP LỆ và có nghĩa).
     *
     * ⚠⚠ **MẶC ĐỊNH ĐỔI 90 → 100, VÀ ĐÂY LÀ MỘT SAI LỆCH CÓ CHỦ ĐÍCH SO VỚI BẢN CŨ — khai thẳng:**
     * `90` với nghĩa CŨ (ngưỡng phản ứng, hậu quả duy nhất là một lượt đuổi) và `90` với nghĩa MỚI
     * (trần cứng, hậu quả là TỪ CHỐI) **không phải cùng một con số**. Giữ `90` làm mặc định là lặng
     * lẽ cắt **3.261 MiB** khỏi ngân sách của MỌI máy, chồng lên `VRAM_SAFETY_RESERVE_MB` vốn đã
     * đứng thay chỗ nền thiết bị — tức bịa thêm một biên an toàn thứ hai **không đo được**, đúng
     * thứ Task 5 đã từ chối làm khi nó không nâng trần biên-theo-tuổi ("*nâng trần = khoá thêm VRAM
     * ở MỌI tiến trình; hạ tốc độ = bịa một con số không đo được*").
     * ⇒ Trần BYTE hôm nay do `computeHeadroom` + `VRAM_SAFETY_RESERVE_MB` + phụ phí suy giảm giữ,
     * và cả ba đều **chặt hơn** guard cũ (guard cũ chưa bao giờ từ chối ai). Ai muốn thêm một sàn
     * phần trăm CỨNG thì đặt `GGUF_VRAM_GUARD_PCT=90` **tường minh** và nhận đúng hậu quả đó.
     */
    guardPct: soNguyenTuEnv("GGUF_VRAM_GUARD_PCT", 100, 1, 100),
    /** Trần mềm theo MB. `0` = TẮT (mặc định) — giữ đúng ngữ nghĩa cũ. */
    maxVramBytes: soNguyenTuEnv("GGUF_MAX_VRAM_MB", 0, 0, Number.MAX_SAFE_INTEGER) * MIB,
    /** Trần theo SỐ MODEL GGUF thường trú. Mặc định 2 — y như bản cũ. */
    maxLoadedModels: soNguyenTuEnv("GGUF_MAX_LOADED_MODELS", 2, 1, 1024),
    /** Trần LRU cho kho phiên ONNX. Mặc định 5 — y như bản cũ của `aiInferenceEngine`. */
    sessionCacheMax: soNguyenTuEnv("AI_SESSION_CACHE_MAX", 5, 1, 1024),
    /**
     * ★★★ M-3 (review TOÀN NHÁNH) — **Ô ĐỆM AN TOÀN, DỜI TỪ `const` MỨC MODULE CỦA `vramBroker`.**
     *
     * Task 7 chuyển bốn biến trần sang đọc-lười-có-nhớ với lý do ghi ở đầu file này (*"một `const`
     * mức module khoá cứng giá trị của lượt nhập ĐẦU TIÊN"*), nhưng bỏ lại đúng ô này — **ô đi
     * THẲNG vào công thức §5.6c** (`headroom = trần − đệm − Σ sổ`), tức ô có ảnh hưởng trực tiếp
     * nhất tới việc một lượt xin được cấp hay bị TỪ CHỐI. Cùng lớp, khác chỗ.
     * ⚠ `0` HỢP LỆ và có nghĩa: người vận hành tắt hẳn đệm. Bản cũ (`Number(env ?? 1024)`) để một
     * giá trị RÁC thành `NaN` rồi đẩy `NaN` thẳng vào phép trừ — nay rác về mặc định.
     */
    safetyReserveBytes: soNguyenTuEnv("VRAM_SAFETY_RESERVE_MB", 1024, 0, 1024 * 1024) * MIB,
  };
  /**
   * ★★★ I-1 (review TOÀN NHÁNH) — **LÀM HẬU QUẢ HIỆN RA, ĐÚNG MỘT LẦN MỖI TIẾN TRÌNH.**
   *
   * Câu biện minh ở trên (*"ai muốn sàn phần trăm CỨNG thì đặt tường minh và nhận đúng hậu quả
   * đó"*) đã đúng về nguyên tắc và SAI trên thực tế: `.env` của repo này **đã đặt** `=90` từ thời
   * nghĩa CŨ, và ba task sau đó tính mọi con số nghiệm thu như thể không có nó — **−3.261 MiB
   * không ai nhận ra suốt cả pha**. Một lựa chọn tường minh mà hậu quả của nó im lặng thì không
   * phải một lựa chọn tường minh; đây là chỗ rẻ nhất để nó thôi im.
   *
   * ⚠ ĐỒNG BỘ và ĐÚNG MỘT LẦN: `doc()` có bộ nhớ đệm nên khối này chạy ở lượt đọc trần ĐẦU TIÊN
   * của tiến trình. Không `await`, không I/O — `reserve()` phải giữ đồng bộ (ràng buộc 1).
   * ⚠ KHÔNG ném và KHÔNG đổi con số: nó chỉ NÓI. Một cảnh báo làm hỏng đường nạp model là đổi một
   * vấn đề im lặng lấy một vấn đề ồn ào hơn nhưng tệ hơn.
   */
  if (nho.guardPct < 100) {
    console.warn(
      `[vram] ⚠ GGUF_VRAM_GUARD_PCT=${nho.guardPct} — đây là TRẦN CỨNG của broker (hậu quả: TỪ ` +
        `CHỐI cấp phát), KHÔNG còn là ngưỡng phản ứng "evict rồi vẫn nạp" của bản cũ. Nó cắt ` +
        `${100 - nho.guardPct}% trần thiết bị, CHỒNG LÊN VRAM_SAFETY_RESERVE_MB và các đơn vị ` +
        `mất-tin-cậy. Bỏ biến này nếu bạn chỉ định giữ hành vi cũ (xem vramCaps.ts + .env).`,
    );
  }
  return nho;
}

/** Phần trăm trần thiết bị được phép dùng (1…100). `100` = tắt. ⚠ KHÔNG phải byte. */
export function ggufVramGuardPct(): number {
  return doc().guardPct;
}

/** Trần mềm theo BYTE. `0` = tắt. */
export function ggufMaxVramBytes(): number {
  return doc().maxVramBytes;
}

/**
 * Trần theo ĐẾM số model GGUF thường trú. ⚠ KHÔNG phải byte — Đ4.
 *
 * ⚠⚠ M-2 (review TOÀN NHÁNH) — **DÂN SỐ CỦA TRẦN NÀY RỘNG HƠN Ý ĐỊNH BAN ĐẦU CỦA NGƯỜI VẬN HÀNH,
 * VÀ ĐIỀU ĐÓ CHƯA TỪNG ĐƯỢC NÓI RA.** Bản cũ (`aiGgufEngine.ensureCapacity`) đếm `loadedModels.size`
 * — chỉ model SINH CHỮ. Broker đếm **mọi giấy phép `kind: "gguf-model"` trong sổ**, và một hộ nữa
 * lọt vào: `reranker:<modelPath>` (`aiReranker.ts`). Hộ đó
 *   • xin giấy phép **kể cả khi chạy CPU** (`RAG_RERANKER_GPU=false` — mặc định của `.env`),
 *   • giữ nó **suốt đời tiến trình**,
 *   • `refCount` đứng nguyên `1` (không ai gọi `noteRefCount`) và **không khai `reclaimer`**
 *     ⇒ không nhàn rỗi, không thu hồi được, không bao giờ nhường khe.
 * ⇒ `GGUF_MAX_LOADED_MODELS=N` trên thực tế là **N−1 model sinh chữ** khi reranker mode=gguf bật.
 * Việc SỬA dân số là ĐÚNG (bản cũ đếm thiếu một hộ có thật), nhưng **giá trị cấu hình của người
 * vận hành chưa được hiệu chỉnh lại** — đó là quyết định của họ, không phải của mã, nên ở đây chỉ
 * NÓI RA. `.env` đã được chú thích tương ứng.
 */
export function ggufMaxLoadedModels(): number {
  return doc().maxLoadedModels;
}

/**
 * Đệm an toàn (BYTE) giữ lại khỏi dư địa: `headroom = trần − đệm − Σ giấy phép` (§5.6c).
 * ⚠ KHÔNG phải "nền desktop" — xem khối docstring ở `vramBroker.deviceUsableBytes()`/`reserve()`.
 * ⚠ M-3: đọc LƯỜI + nhớ, KHÔNG `const` mức module (lý do ở `safetyReserveBytes` trong `doc()`).
 */
export function safetyReserveBytes(): number {
  return doc().safetyReserveBytes;
}

/** Trần LRU cho kho phiên ONNX (`aiInferenceEngine` + `ai/ocrService`). ⚠ KHÔNG phải byte. */
export function sessionCacheMax(): number {
  return doc().sessionCacheMax;
}

/**
 * Trần BYTE **HIỆU LỰC** của thiết bị: mọi trần đều chỉ được làm hệ CHẶT HƠN, không bao giờ nới.
 * `min()` chứ không phải một phép chọn — thêm một trần bất kỳ thì con số chỉ NHỎ ĐI (cùng bất biến
 * với `applyEnforcement`: *"thêm một lý do thì dư địa chỉ nhỏ đi"*).
 *
 * ⚠ `deviceTotalBytes` không hữu hạn / ≤ 0 ⇒ trả NGUYÊN nó, không nhân/không `min`: một phép nhân
 * trên `NaN`/`Infinity` chỉ đẻ thêm một giá trị không hữu hạn nữa và giấu mất chỗ hỏng gốc.
 * `computeHeadroom()` đã có nhánh fail-closed CÓ TÊN cho đầu vào không hữu hạn.
 */
export function usableCeilingBytes(deviceTotalBytes: number): number {
  if (!Number.isFinite(deviceTotalBytes) || deviceTotalBytes <= 0) return deviceTotalBytes;
  const c = doc();
  let tran = deviceTotalBytes;
  if (c.guardPct < 100) tran = Math.min(tran, Math.floor((deviceTotalBytes * c.guardPct) / 100));
  if (c.maxVramBytes > 0) tran = Math.min(tran, c.maxVramBytes);
  return tran;
}

/** Chỉ dùng trong test. */
export function __resetVramCapsForTests(): void {
  nho = null;
}
