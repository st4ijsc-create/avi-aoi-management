/**
 * ★★★ Pha 5 — vá review TOÀN NHÁNH, **I-2 / M-5: BỀ RỘNG CỦA MỘT Ô DANH TÍNH CHỈ ĐƯỢC CÓ MỘT CHỦ.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ VÌ SAO FILE NÀY TỒN TẠI: HAI NGƯỜI GHI, KHÔNG AI ĐỐI CHIẾU
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * *"Danh tính đi thẳng vào lệnh"* (`VramBrokerPanel.tsx` — `owner` của mặt đọc được truyền **nguyên
 * vẹn** vào `preempt.mutate`) là một hợp đồng **HAI ĐẦU**. Pha 5 đóng đầu **ĐỌC** (N11: không cắt
 * trường danh tính) và bỏ đầu **LỆNH**: trần `160` được **chép tay ở hai file**
 * — `vramSharedLedger.cat(lease.request.owner, 160)` và `vramRouter` `z.string().max(160)` — nên
 * không một ca nào trong toàn nhánh ràng buộc hai con số ấy với nhau.
 *
 * Đo được (đột biến **W2b** của reviewer): hạ router xuống `.max(64)` ⇒ **cổng ĐẦY ĐỦ 100 file /
 * 1692 ca XANH TOÀN BỘ**. Khoảng 65–160 ký tự là **vùng mù tuyệt đối**.
 *
 * ⚠ Và đây không phải một khả năng lý thuyết: `owner` sản xuất là chuỗi **ĐỘNG lấy từ ĐƯỜNG DẪN
 * TUYỆT ĐỐI** — `ocrService.ts:384` dựng `onnx-ocr:${modelPath}` (~57 ký tự hôm nay), `aiReranker`
 * dựng `reranker:${modelPath}`. Chính repo đã viết ra ngòi nổ (`vramSharedLedger.ts`, docstring của
 * `cat()`): *"Một lượt đổi thư mục model là đủ vượt `varchar(160)`."*
 * Khi `owner` > trần: mặt đọc phát ra danh tính **nguyên vẹn** ⇒ nút *Thu hồi* **BẬT**; bấm ⇒ zod
 * ném `BAD_REQUEST` **xác thực đầu vào**, **không** phải một `reason` nghiệp vụ — trong khi
 * `vramRouter` vừa tuyên bố *"mọi lượt TỪ CHỐI NGHIỆP VỤ trả về DỮ LIỆU có `reason`, KHÔNG ném"*.
 *
 * ⚠⚠ **NGUỒN SỰ THẬT LÀ CỘT DB, KHÔNG PHẢI KHẨU VỊ.** Hai hằng dưới đây là bề rộng `varchar` của
 * `drizzle/0312_vram_leases.sql`. **Nới một trong hai mà không nới cột là dời chỗ nói dối**: sổ
 * chung sẽ nhận `22001` và `requeueSharedLedgerWrites()` ném lại đúng hàng độc ⇒ hỏng **VĨNH VIỄN**.
 * Muốn nới thì phải có một lượt DDL có chủ dự án duyệt, và đổi **cả ba** chỗ cùng lúc (cột · hằng ·
 * ca khoá bề rộng).
 *
 * ⚠ File này **KHÔNG có phụ thuộc nào** — cố ý: nó được cả tầng sổ (`vramSharedLedger`) lẫn tầng
 * router (`vramRouter`) nhập, nên một phụ thuộc ở đây là một vòng nhập tiềm tàng.
 */

/**
 * Bề rộng tối đa của ô **danh tính hộ tiêu thụ** (`vram_leases.owner` — `varchar(160)`).
 *
 * Đọc bởi: `vramSharedLedger.rowFromLease()` (cắt khi GHI) và `vramRouter.preempt/retryDeferred`
 * (từ chối khi NHẬN). Hai vế **phải** là cùng một con số, nếu không sổ chung sẽ cắt âm thầm một
 * danh tính mà lệnh vẫn nhận, hoặc lệnh sẽ từ chối một danh tính mà sổ chung phát ra được.
 */
export const VRAM_OWNER_MAX = 160;

/** Bề rộng tối đa của khoá giấy phép (`vram_leases.lease_key` — `varchar(200)`). */
export const VRAM_LEASE_KEY_MAX = 200;

/** Bề rộng tối đa của khoá tiến trình (`vram_leases.process_key` — `varchar(96)`). */
export const VRAM_PROCESS_KEY_MAX = 96;
