# Doc 34 — Quick-start: Trợ lý AI Lập trình Tự động hóa (ở đâu & dùng thế nào)

Rà soát frontend thực tế 2026-07-06. App live `http://localhost:3000` · gateway `/v1` OK · role Admin thấy tất cả.
4 tính năng nằm ở 3 nơi khác nhau — đây là đường đi chính xác.

---

## 1) Trợ lý Lập trình (AI sinh/giải thích mã — TRONG APP)
**Menu (2 chỗ — chọn chỗ nào cũng được):**
- **Nhóm “AI”** (icon ✨) → mục **“Không gian AI”** → **“Trợ lý Lập trình”**  ← dễ tìm nhất, tìm “AI” là thấy.
- Hoặc nhóm **“Kỹ thuật & Điều khiển (Nâng cao)”** → mục **“Soạn thảo & Lập trình”** → **“Trợ lý Lập trình”**.
**URL trực tiếp:** `http://localhost:3000/programming-copilot`
*(Đã bỏ nhãn “beta” — tính năng đã chạy thật.)*

**Dùng:**
1. Chọn **Loại chương trình**: Structured Text / Ladder / POU / IR-flow / Zmotion Basic / Mitsubishi (MELSEC) / Techman.
2. Chọn **Chế độ**: Sinh mã · Hoàn thiện · Dịch · Rà soát · Giải thích.
3. (Tùy chọn) chọn **Hãng** (Mitsubishi/Delta/Omron/Fanuc/UR/Zmotion) để bám đúng manual.
4. Gõ yêu cầu (tiếng Việt hoặc Anh), ví dụ: *“Viết hàm ST tính trung bình trượt 10 mẫu”*.
5. Bấm **Tạo mã** → xem: mã sinh ra + **badge validation** (xanh = hợp lệ; đỏ = lỗi kèm chi tiết) + **Nguồn** (manual hãng + số trang) → **Copy** / **Áp dụng**.

> ⚠️ AI chỉ **hiển thị/đề xuất** — không nạp xuống thiết bị. Bạn rà soát + mô phỏng trước khi dùng thật. Yêu cầu mã **an toàn (E-stop/interlock/SIL)** sẽ bị **từ chối** (đúng thiết kế).
> Ghi chú: **POU** nên soạn ở **Xưởng lập trình** (canvas LAD/FBD/SFC); copilot mạnh nhất ở ST/Ladder/IR/Zmotion/MELSEC/Techman.

**Cũng có ngay trong editor:** nhóm trên → **“Xưởng lập trình thiết bị”** (`/engineering`) → mở/tạo một project → cuộn xuống thẻ **“Trợ lý AI”** (✨, bấm để mở) → *Áp dụng* chèn thẳng mã vào editor.

---

## 2) Hỏi AI kèm ẢNH (đọc sơ đồ ladder / HMI / datasheet / màn lỗi)
**Ở đâu:** nút **bong bóng AI nổi** (góc dưới bên phải MỌI trang) — hoặc trang **`/ai-chat`**.

**Dùng:**
1. Mở chat → trong ô nhập có nút **📷 “Đính kèm ảnh”** (bấm chọn file) **HOẶC dán ảnh (Ctrl+V)**.
2. Gõ câu hỏi, ví dụ *“Khối ladder này làm gì, có lỗi gì?”* hoặc *“Mã lỗi AL.32 trên servo nghĩa là gì?”*.
3. Gửi → AI **Qwen3-VL** đọc ảnh + tra manual (RAG) → trả lời; hiện thẻ **“Ảnh đã đọc (VL)”**.
   Ảnh: PNG/JPG/WEBP ≤ 6MB.

---

## 3) VS Code + Continue (autocomplete + chat NGAY TRONG IDE)
Gateway đã bật (`http://localhost:3000/v1`).
1. Cài extension **Continue** trong VS Code.
2. Copy `.continue/config.json` (trong repo này) → `~/.continue/config.json` (hoặc `%USERPROFILE%\.continue\config.json`).
3. Thay `REPLACE_WITH_OPENAI_GATEWAY_API_KEY` bằng giá trị **`OPENAI_GATEWAY_API_KEY`** trong file `.env`.
4. Dùng: gõ mã ST/URScript → **gợi ý autocomplete** (FIM, model Qwen2.5-Coder); mở Continue chat → hỏi/sửa mã bằng model 30B local.
Chi tiết: [`CONTINUE_VSCODE_SETUP.md`](CONTINUE_VSCODE_SETUP.md).

---

## 4) Điểm vào gom sẵn
- **Trung tâm AI:** `http://localhost:3000/ai-hub` — mọi thẻ AI (có *Trợ lý Lập trình*, AI Brain, Technician Copilot…).
- **Trợ lý Kỹ thuật (RCA):** `/technician-copilot` · **AI Brain (model dashboard):** `/ai-brain`.

## Không thấy menu?
- Đảm bảo đang ở **chế độ menu Nâng cao** (Admin mặc định là Advanced) — nếu menu bị rút gọn, bật lại chế độ đầy đủ.
- Đã **restart app** sau khi đổi `.env` (cần thiết để nạp cờ mới: gateway/copilot/FIM).
- Dùng URL trực tiếp ở trên nếu tìm menu chưa ra.
