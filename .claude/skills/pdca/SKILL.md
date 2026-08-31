---
name: pdca
description: Use when improving an existing feature/module that already "works" — runs a measured PDCA cycle (Plan-Do-Check-Act) that starts by validating the measurement system, measures user-visible OUTCOMES instead of mechanisms, proves causality by ablation, and Paretos root causes before fixing anything. Use when asked to "cải tiến", "improve", "làm tốt hơn", "PDCA", "tối ưu module X", or when a feature passes all its tests but nobody has measured whether it actually delivers.
---

# PDCA — cải tiến bằng phép đo, không bằng ý tưởng

Vòng Plan-Do-Check-Act, siết lại bằng những gì dự án này **đã trả giá để học**.

**Công bố khi bắt đầu:** "Dùng skill PDCA để cải tiến <X>. Bắt đầu bằng nắm hiện trạng, chưa sửa gì."

## Nguyên tắc cái

> **Lưới xanh không phải bằng chứng tính năng chạy được.**

Đã đo trong dự án này: một module có **373 ca lưới xanh** cho tính năng mà **model chưa từng được
cho biết là tồn tại** (tuân thủ giao thức đo được **0/11**). Sau khi vá, tuân thủ lên **91%** —
nhưng tỉ lệ **thành công đầu-cuối chỉ 54,5%**. Chỉ số thay thế **thổi phồng gần gấp đôi**.

Vì vậy PDCA ở đây **luôn** bắt đầu bằng đo, và **luôn** đo kết cục người dùng nhận được.

---

## Bước 0 (MSA) — KIỂM HỆ ĐO TRƯỚC KHI ĐO

★★★ **Bắt buộc. Không được bỏ.** Cải tiến dựa trên hệ đo sai thì mọi kết luận sau đó đều treo.

Đã xảy ra thật: server chạy cổng 3000 là bundle build lúc **00:29**, mã nguồn mới nhất **17:59** —
lệch **17,5 tiếng**. Một ngày đo live, kể cả một chẩn đoán gốc rễ, **chạy trên bản không khớp mã nguồn**.

Trước khi tin bất kỳ con số nào, kiểm tra:

- [ ] **Thứ đang chạy có phải thứ vừa sửa không?** So dấu thời gian bundle/`dist` với commit mã
      nguồn mới nhất. Cả server **lẫn** artifact client (`dist/`, `.vsix`).
- [ ] **Phép đo có tự thoả không?** Đọc kết quả bằng **đường độc lập** với đường vừa ghi. (Đã dính:
      đọc lại bằng chính API vừa ghi rồi kết luận "tệp không đổi" từ `"" === ""`.)
- [ ] **Có ai đang sửa dở vùng này không?** `git status` vùng liên quan. Vùng bẩn của tiến trình
      khác ⇒ **ghi lại, KHÔNG đụng**.
- [ ] ★★★ **Có CACHE nào ở giữa không?** Đã dính: `answerCache` TTL **10 phút** không phân biệt
      nguồn gọi ⇒ hai lượt đo liên tiếp **trông như hai mẫu độc lập nhưng là một cache-hit**. Cache
      vô hiệu hoá đúng kỹ thuật "chạy ≥2 lượt để loại nhiễu" mà skill này khuyên dùng. Tìm mọi lớp
      đệm trên đường đo (bộ nhớ tiến trình, HTTP, CDN, memo hoá) và **vô hiệu hoặc restart giữa các
      mẫu**. Bằng chứng mẫu độc lập: thời gian lượt sau **không** rơi đột ngột xuống gần 0.

Ghi vào báo cáo trạng thái hệ đo **trước và sau**, để chứng minh nó đã đổi thật.

---

## P — Nắm hiện trạng, rồi mới đặt chỉ tiêu

1. **Liệt kê chỉ số đang có, và gọi đúng tên chúng.** Số ca lưới, tỉ lệ tuân thủ giao thức, số lỗi
   đã vá — phần lớn là **chỉ số THAY THẾ**. Ghi rõ cái nào là thay thế.
2. **Tìm chỉ số KẾT CỤC còn thiếu.** Câu hỏi luôn đúng: *"người dùng có nhận được thứ họ yêu cầu
   không?"* Nếu chưa ai đo ⇒ **đó chính là chỉ tiêu của vòng này**.
3. **Nêu giả thuyết gốc rễ**, và đánh dấu giả thuyết nào dựa trên phép đo **đáng ngờ** (xem Bước 0).

---

## D — Đo đường cơ sở trên tác vụ THẬT

- **≥10 tác vụ thật**, đủ đa dạng để chạm các đường mã khác nhau, cộng **ít nhất một đối chứng an
  toàn** (tác vụ **kỳ vọng bị từ chối** — nếu nó lọt, đó là phát hiện lớn nhất của vòng).
- Chạy qua **đúng đường mã sản phẩm**, không gọi tắt API rồi tự diễn giải.
- **Chấm theo KẾT CỤC, không theo cơ chế.** Bốn rổ:
  **ĐẠT** (nhận đúng thứ yêu cầu) · **SAI** (có phản hồi nhưng sai/bịa/không dùng được) ·
  **HỎNG** (lỗi/treo/không có gì xảy ra) · **CHẶN-ĐÚNG** (bị từ chối và đó là hành vi đúng).
- ★★★ **Lưu output THÔ từng tác vụ ra tệp riêng**: đề bài · toàn văn phản hồi · kết cục quan sát
  được · phán quyết · **một câu vì sao**. Người yêu cầu phải **tự đếm lại được**. Tóm tắt không
  thay được thô.
- ★ Phán quyết nên **suy ra từ tín hiệu đã ghi**, đừng khai thẳng. ("vòng 1 có chứa chuỗi X? KHÔNG
  ⇒ do đó C" tốt hơn "phán quyết: C".)

**Một tác vụ treo là DỮ LIỆU, không phải lý do dừng.** Ghi là treo, đo tiếp.

---

## C — Pareto, và chứng minh nhân quả bằng ABLATION

**Pareto trước, sửa sau.** Mọi tác vụ SAI/HỎNG ⇒ truy tới gốc, **nhóm lại**, xếp giảm dần theo số
tác vụ. Vòng này **không vá lung tung**; mục tiêu là **biết nên vá cái gì trước**.

★★★ **ABLATION là thứ làm con số đáng tin.** Sau khi vá và thấy chỉ số lên, **gỡ đúng bản vá đó
ra**, chạy lại một tập con, xác nhận chỉ số **tụt về đường cơ sở**, rồi hoàn nguyên.

Đã đo: 0/11 → vá → 10/11 → **gỡ đúng 2 dòng** → **0/5**. Không có ablation thì 10/11 chỉ là một
lời khai đẹp — nó có thể đến từ bất cứ đâu.

Nguyên tắc song sinh, cho mọi lưới mới: **phá một điều kiện trong mã thật ⇒ phép đo phải chuyển
ĐỎ ⇒ hoàn nguyên.** Phép đo không chứng minh được là nó đo thật thì chưa phải bằng chứng.

⚠ **Phòng thủ nhiều lớp có thể che đột biến của chính nó**: gỡ lớp trong mà lưới vẫn xanh nhờ lớp
ngoài ⇒ lớp trong đang rỗng mà không ai biết. Đột biến phải nhắm **từng lớp**.

---

## A — Chuẩn hoá thứ rẻ và chắc, để lại phần còn lại

- Chỉ vá nguyên nhân **rõ ràng, nhỏ, trong phạm vi mình sở hữu**. Còn lại ⇒ vòng sau, kèm **điều
  kiện mã chính xác** đã xác định được.
- ★★★ **Vá xong phải kiểm NHÁNH KIA** của chính chỗ vừa vá. Đã dính: bản vá khẳng định một luật
  nhưng chỉ cài trên **một nhánh** — nhánh thất bại có kiểm, nhánh thành công thì không.
- ★★★ **Bản vá đẻ hồi quy là chuyện thường**: một bản vá trong dự án này làm hỏng một đường khác
  hoàn toàn. Sau khi vá, hỏi *"bản vá này còn chạm đường nào nữa?"* rồi **đo đường đó**.
- **Cập nhật artifact đã build** (`dist/`, `.vsix`, server bundle) — nếu không, thứ đã ship **không
  phải** thứ vừa đo. Tốt hơn: thêm một ca **khẳng định trên bundle đã build**.
- Ghi vòng sau: **cái chưa xác minh phải ghi thẳng**, đừng để người đọc suy ra là đã xong.

---

## Cờ đỏ — thấy là dừng

| Ý nghĩ | Sự thật |
|---|---|
| "Lưới xanh hết rồi, module chạy tốt" | Lưới đo **cơ chế phía ta**. Chưa ai đo phía kia có hiểu không. |
| "Số đẹp quá, xong rồi" | Chưa ablation thì chưa biết số đến từ đâu. |
| "Số xấu quá, chỉnh đề bài cho dễ hơn" | **Số xấu là kết quả THÀNH CÔNG.** Nó vừa mua cho bạn một sự thật. |
| "Đo trước rồi, khỏi đo lại" | Hệ đo có thể đã cũ 17 tiếng. Kiểm Bước 0. |
| "Vừa đo vừa vá cho nhanh" | Vá giữa chừng làm hỏng phép đo. Đo xong hẵng vá. |
| "Gốc rễ rõ rồi, khỏi kiểm" | Hai chẩn đoán gốc rễ trong dự án này bị phép đo bác bỏ. |
| "Tất cả xanh ngay lần đầu" | Đáng ngờ hơn đáng mừng. Kiểm xem phép đo có chạy thật không. |

---

## Định dạng báo cáo

1. **Bước 0 (MSA)** — trạng thái hệ đo trước/sau, kèm bằng chứng
2. **Hiện trạng** — chỉ số đang có, **đánh dấu cái nào là thay thế**
3. **Đường cơ sở** — ĐẠT/SAI/HỎNG/CHẶN-ĐÚNG trên N, **đường dẫn tệp thô**
4. **Pareto** — nguyên nhân × số tác vụ, giảm dần
5. **Đã vá + ABLATION** — chỉ số trước/sau/sau-khi-gỡ-vá
6. **CÒN MỞ** — cái chưa xác minh, nói thẳng
7. **Vòng sau** — nguyên nhân tiếp theo kèm điều kiện mã chính xác

Con số phải **khớp tệp thô**. Người đọc phải tự đếm lại được.
