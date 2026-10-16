# shared/agentCore — lõi agent dùng chung (THUẦN)

Thiết kế: `docs/superpowers/specs/2026-10-14-ai-local-dot1-loi-agent-design.md` §2–§3. Không import `server/`, `client/`,
`vscode`, `node:*`; không đọc env/đĩa/mạng (lưới `thuan.test.ts`).

## Thay đổi / tinh chỉnh so với hợp đồng §3 (và lý do)

1. **`WireToolCall`/`WireTool` định nghĩa lại trong `kieu.ts`** (không import `nativeToolCalls.ts` vì lõi phải thuần). Cùng
   hình OpenAI; `congCu.test.ts` gán chéo kiểu với bản của server và chạy `timGioiHanGrammar` trên `CONG_CU`.
2. **`GoiModel`/`BoThucThi`/`GioiHanVong` nằm ở `kieu.ts`** (spec đặt ở `vongAgent.ts`) — `index.ts` xuất lại tất cả.
3. **`GoiModel` thêm mảnh `{loai:"cho", phiaTruoc}`** ⇒ lõi phát `dang-cho-model` (spec có sự kiện nhưng không có nguồn).
4. **`GioiHanVong.nganSachNguCanhToken`** (mặc định 65 536, Q5) — cần cho ngưỡng nén 70 %. Mặc định khác:
   `tokenRaToiDa` 120 000 (spec không nêu), `kyTuQuanSatToiDa` 12 000, 30 lượt, 20 phút.
5. **`chayVongAgent` thêm `ngonNgu?` (mặc định `vi`) và `uocLuongToken?`** (server truyền `uocLuongSoToken`; mặc định cùng
   công thức 2,8 ký tự/token để extension tự đứng được).
6. **System prompt + ngữ cảnh dự án gộp MỘT tin `system`** (chat template Qwen chỉ nhận system ở đầu). Tin `system` trong
   `lichSu` bị bỏ.
7. **Nhãn rút gọn tiếng Anh**: `[compacted: <tool> <đường> — <n> chars; …]` thay cho `[đã rút gọn: …]` — prompt và tool đều
   tiếng Anh. Kết quả nén được GIỮ trong `tinNhan` (ổn định tiền tố cho cache KV).
8. **Lịch sử luôn hợp lệ**: lời gọi không chạy vì vòng dừng (huỷ / hết giờ / hết token / lặp lại / mệnh lệnh trong dữ liệu)
   nhận tin `tool` tổng hợp `[not executed: …]` / `[interrupted: …]` để `tinNhan` trả về dùng tiếp được.
9. **Hết token** = cộng dồn `usage.ra`; model không trả usage ⇒ ước lượng từ chữ + nghĩ đã stream. Hết giờ kiểm ở ranh giới
   lượt, trước mỗi tool và sau mỗi mảnh stream (đồng hồ tiêm, không đặt timer) — chờ duyệt dài do TTL của bộ thực thi lo.
10. **Lỗi model tạm thời**: thử lại tối đa 1 lần **mỗi lượt** (lỗi có `tamThoi === true`, lớp `LoiModel`). Stream kết thúc
    không có mảnh `xong` = lỗi tạm thời (không coi là hoàn thành).
11. **`menh-lenh-trong-du-lieu`**: bộ thực thi trả `ma: "MENH_LENH_TRONG_DU_LIEU"` (`MA_MENH_LENH_TRONG_DU_LIEU`) ⇒ vòng dừng.
12. **`todo_write` luôn được phơi** (lõi tự thêm nếu bộ thực thi không khai) và xử lý trong vòng, không qua `boThucThi.chay`.
13. **`kiemThamSo` khoan dung có kiểm soát**: bỏ khoá lạ; ép số/boolean dạng chuỗi; bóc rào ```json; `edits` mã hoá kép
    (chuỗi JSON) và dạng phẳng `{path, old_string, new_string}` được chuẩn hoá thành `edits[]`. Tool ngoài bộ 10 chỉ bị đòi
    là JSON object. "Lặp lại" so trên tham số ĐÃ chuẩn hoá (khoá sắp xếp).
14. **`apDungEdits`**: khớp nguyên văn trước; không thấy và old_string có xuống dòng ⇒ khớp với `\r?\n` (CRLF/LF đều được);
    `new_string` ghi theo kiểu xuống dòng trội của tệp; byte ngoài vùng thay giữ nguyên (cả tệp lẫn lộn).
15. Khi vòng kết thúc (mọi lý do), signal trong truyền cho model/bộ thực thi bị abort để dọn việc còn treo.
