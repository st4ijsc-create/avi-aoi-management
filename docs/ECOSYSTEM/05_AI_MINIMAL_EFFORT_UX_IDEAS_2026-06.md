# Ý TƯỞNG: AI hỗ trợ tối đa — Kỹ thuật · Nhân viên · Quản lý, với "ít thao tác nhất"
### Thiết kế trải nghiệm "đẩy chứ không kéo" (proactive, push-not-pull) trên nền AI brain đã có
**Ngày:** 2026-06-27 · **Trạng thái:** ⏳ Ý tưởng — chờ chọn hướng triển khai

> Mục tiêu của anh/chị: **người dùng thao tác ít nhất có thể.** Nguyên tắc xuyên suốt: chuyển từ *người đi tìm thông tin* sang *AI mang việc đến tận nơi*; mỗi việc rút còn **1 chạm để duyệt** (vẫn giữ HITL). Mọi ý tưởng dưới đây **dựa trên building-block đã xây** (watcher, ai_insights, HITL propose→confirm, causal graph, PdM, anomaly, exec report, voice-input, SSE/andon, MachineAISummary).

---

## 0. Bốn cơ chế giảm thao tác (nền tảng cho mọi ý tưởng)

| Cơ chế | Trước (nhiều thao tác) | Sau (tối thiểu) | Building-block sẵn có |
|---|---|---|---|
| **Push thay vì Pull** | Mở app → vào trang → lọc → đọc | AI tự đẩy thông báo "cần bạn chú ý" | aiWatcher, ai_insights, SSE, andon, bulletin |
| **1-chạm duyệt** | Đọc → quyết → mở form → nhập → gửi | AI soạn sẵn đề xuất → bấm **Duyệt** | HITL propose→confirm, write-tools, causal graph |
| **Ngữ cảnh tự nhận** | Gõ tên máy/ca/sản phẩm | Quét QR/NFC máy / tự biết theo ca & phân công | machineId, phân công, MachineAISummary |
| **Nói thay vì gõ** | Gõ trên kiosk (tay bẩn/găng) | Bấm mic → nói | voice-input đã có trong chat |

---

## 1. ⭐ "AI Action Inbox" — hộp thư việc-cần-duyệt (đòn bẩy lớn nhất)

Một nơi duy nhất, **đẩy** mọi thứ AI muốn người dùng chú ý, mỗi mục có **nút hành động 1 chạm**:

```
┌── AI cần bạn chú ý (3) ───────────────────────────────┐
│ 🔴 Máy 5: cụm lỗi NG tăng (Pareto: "chân chì" 42%)     │
│    → AI đề xuất: hạ ngưỡng NG 5%→4%   [Duyệt] [Hỏi AI] │
│ 🟠 Máy 12: PdM rủi ro cao, ~6 ngày tới hỏng            │
│    → AI đề xuất: tạo lệnh bảo trì    [Duyệt] [Hoãn]    │
│ 🟢 Báo cáo ca sáng đã sẵn sàng        [Xem] [Bỏ qua]   │
└────────────────────────────────────────────────────────┘
```

- **Người dùng chỉ Duyệt/Hoãn** — không tìm, không nhập. Ghi vẫn qua HITL (propose→confirm đã có).
- Nguồn: watcher + anomaly + PdM + exec report → đẩy realtime qua SSE; gom vào 1 inbox theo vai trò & máy được phân công.
- Badge số trên thanh điều hướng + chuông → không cần mở app cũng biết.
- **Đây là thứ giảm thao tác nhiều nhất.** Khuyến nghị làm đầu tiên.

---

## 2. ⭐ "Today" — bản tin cá nhân hoá ngay khi đăng nhập

Đăng nhập xong, **không cần bấm gì**, thấy ngay 1 thẻ tóm tắt đúng vai trò:
- **Kỹ thuật viên:** "3 máy cần chú ý hôm nay" (xếp ưu tiên) + việc đề xuất.
- **Nhân viên/operator:** "Dây chuyền của bạn: 2 cảnh báo NG, máy 5 bất thường" + cách xử lý.
- **Quản lý:** "Ca này: OEE 78% (↓3%), top lỗi 'chân chì', 1 rủi ro PdM" — quản lý theo *ngoại lệ*, không phải quét dashboard.

Nguồn: gộp analytics tools + exec report + insight, sinh 1 lần lúc login. **0 thao tác để nắm tình hình.**

---

## 3. Theo từng vai trò — việc rút còn 1–2 chạm

### ① Kỹ thuật viên (maintenance)
- **PdM → lệnh bảo trì tự soạn:** AI phát hiện rủi ro → soạn sẵn work-order + hành động khuyến nghị (từ causal graph) → **1 chạm Duyệt**. Không mở form, không tra cứu.
- **Anomaly → RCA tự chạy sẵn:** khi có bất thường, AI tự chạy RCA (GraphRAG + đồ thị nhân-quả) và đính kèm *nguyên nhân khả dĩ + SOP* → kỹ thuật viên đọc, chạm để làm.
- **Quét QR/NFC trên máy → trợ lý mở đúng ngữ cảnh máy đó:** hỏi/ra lệnh không cần gõ tên máy.
- **Nói để ra lệnh:** "tăng ngưỡng NG máy 5 lên 5%" → thẳng tới confirm card (rảnh tay, đeo găng).
- **Playbook tự dẫn từng bước:** quy trình xử lý sự cố tự chuyển bước, chỉ xác nhận khi cần.

### ② Nhân viên / Operator
- **Cảnh báo AI hiện ngay trên màn dây chuyền** (đã có MachineAISummary) → biến thành *đẩy + hành động*: "Máy 5 bất thường → [Báo kỹ thuật] [Xem ảnh lỗi]".
- **NG → giải thích bằng lời tự động:** vision mô tả lỗi plain-language inline, không cần thao tác.
- **Báo sự cố 1 chạm:** bấm 1 nút → AI tự phân loại + định tuyến (Andon), không phải điền form.
- **AI tự quyết khi nào gọi kỹ thuật** thay vì operator phải tự phán đoán.

### ③ Quản lý
- **Báo cáo điều hành tự đẩy** (đã có) → gửi tới quản lý (thông báo/email), không phải vào lấy.
- **Quản lý theo ngoại lệ:** AI chỉ nổi lên thứ cần chú ý + khuyến nghị → không quét báo cáo.
- **Hỏi đáp gợi ý theo bối cảnh:** thay vì nghĩ câu hỏi, AI đề xuất "Vì sao yield máy 5 giảm?" dựa trên bất thường hiện tại → 1 chạm là có câu trả lời.

---

## 4. Lộ trình đề xuất (quick win → lớn dần)

| # | Hạng mục | Giảm thao tác | Công sức | Phụ thuộc |
|---|---|---|---|---|
| **1** | **AI Action Inbox** (push + 1-chạm duyệt) | ★★★★★ | M–L | watcher/insight/HITL đã có |
| **2** | **"Today" briefing** khi login | ★★★★☆ | M | analytics tools + exec report |
| **3** | **Đề xuất PdM/anomaly tự soạn → 1 chạm** (kỹ thuật) | ★★★★☆ | M | causal graph + write-tools |
| **4** | **Voice-first + QR/NFC ngữ cảnh máy** (hiện trường) | ★★★☆☆ | M | voice-input đã có |
| **5** | **Operator: báo sự cố 1 chạm + auto-route Andon** | ★★★☆☆ | S–M | andon đã có |
| **6** | **Quản lý theo ngoại lệ + đẩy báo cáo** | ★★★☆☆ | S–M | exec report đã có |

> Tất cả vẫn giữ **HITL** cho mọi hành động ghi (không nới lỏng an toàn) và **degrade trung thực** (thiếu dữ liệu → nói rõ, không bịa).

## 5. Chỉ số thành công
- Số thao tác trung bình để hoàn thành 1 việc (mở→làm→xong): mục tiêu **≤ 2 chạm** cho việc thường gặp.
- % việc do AI *đẩy* (vs người tự đi tìm): mục tiêu ≥ 70%.
- Thời gian từ "sự kiện xảy ra" → "người đúng được thông báo + có đề xuất": mục tiêu < 1 phút.
- % đề xuất AI được duyệt (đo độ hữu ích/đúng).

---

*(Bản ý tưởng — chưa thực thi. Chờ anh/chị chọn (các) hạng mục để triển khai theo lộ trình.)*
