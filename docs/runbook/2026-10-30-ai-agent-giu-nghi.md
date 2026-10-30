# Runbook — công tắc `AI_AGENT_GIU_NGHI` (tác nhân lập trình giữ suy luận)

> Áp dụng từ 2026-10-30 · chủ: do-model (đo) / dieu-phoi (vận hành) · bằng chứng: `docs/superpowers/reports/2026-10-27-dot11-0-do-nen.md` §5.6–§6

## Nó làm gì

Mỗi lượt của tác nhân lập trình (`/api/ai/agent/runs`, màn Thợ Cả) gửi lại model toàn bộ lịch sử. Khi công tắc BẬT, suy luận (đã che)
của các lượt assistant TRƯỚC đi kèm trong lịch sử (`reasoning_content`) và yêu cầu llama-server mang `chat_template_kwargs.preserve_thinking=true`
⇒ template Qwen3.6 dựng lại khối suy nghĩ cũ, model không phải nghĩ lại từ đầu mỗi lượt. Khi ngữ cảnh gần đầy, bộ nén lịch sử bỏ suy luận
của lượt CŨ trước tiên (trước khi rút gọn kết quả tool).

## Giá trị

| Giá trị env | Kết quả |
|---|---|
| vắng / rỗng / `1` / giá trị khác | **BẬT** (mặc định) |
| `0` · `false` · `off` · `no` (không phân biệt hoa thường, bỏ khoảng trắng) | TẮT — lịch sử gửi model như trước Đợt 11.0, từng byte |

Chỉ có hiệu lực ở lượt chạy GỐC của tác nhân phía MÁY CHỦ; extension VSCode tự đứng không đọc biến này (lõi mặc định TẮT).
**Agent CON (Đợt 11.8, `delegate`) KHÔNG đi qua công tắc**: vòng con gọi `chayVongAgent` bên trong lõi (`shared/agentCore/vongAgent.ts`, khối
giao việc) mà không truyền `giuNghiTrongLichSu` ⇒ con giữ hành vi cũ (bỏ suy luận khỏi lịch sử) bất kể giá trị env. Cố ý (dieu-phoi chốt với
tho-ca-agent 2026-10-31): bật cho con chỉ sau khi đo riêng.

## Số đo dẫn tới mặc định BẬT (2026-10-30, cùng dist 1ca7ab9ad, cùng :8091, ×3 mỗi phía)

| | TẮT | BẬT |
|---|---|---|
| agent-f (6 bài × 3) | 14/18 | 15/18 |
| G6 (A1, A2 × 3) | 6/6, trung vị 54,8 s | 6/6, trung vị 27,7 s |
| token ra (24 lượt chạy) | 939 130 | 417 864 (−55 %) |
| thời gian model | 4 863 s | 2 143 s (−56 %) |
| tokensIn | 7 738 994 | 8 049 269 (+4 %) |

## Khi nào tắt

- Lượt sau bám vào kết luận SAI của suy luận cũ (lặp lại cùng hướng sửa hỏng nhiều lượt liền).
- Lượt chạy dài chạm ngân sách ngữ cảnh nhanh hơn trước (dừng `het-token` tăng rõ).
- Model khác Qwen3.6 được gán cho vai trò `code.*` mà template của nó hiển thị `reasoning_content` sai.

Cách tắt: đặt `AI_AGENT_GIU_NGHI=0` trong môi trường tiến trình :3000 rồi khởi động lại (`npm start`). Không cần migration, không đổi dữ liệu.

## Kiểm cờ đang có hiệu lực (không đọc được env tiến trình Windows)

Dấu vết `ai_gateway_metrics` (`luotPhu='agent-luot'`): trong cùng `requestId`, xét các bước sau một lượt có ≥ 300 token suy luận —
`tokensIn` tăng ÍT HƠN `tokensOut` của lượt trước ⇒ suy luận đã bị bỏ khỏi lịch sử. Đo 2026-10-30: TẮT 90 % bước như vậy; BẬT 8 % (phần dư =
bộ nén lịch sử). Tỉ lệ cao trở lại khi đang BẬT ⇒ cờ không tới tiến trình (kiểm lại môi trường khởi động).
