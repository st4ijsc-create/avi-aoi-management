# B2 — phân tích SAU khi chạy (do-model 03/11)

Bảng số: `B2-bang.md` (sinh bởi `chayB2.ts`, commit kịch bản b52140371 + ngoại lệ đăng ký trước 1cf018f74). Kịch bản KHÔNG sửa sau khi chạy.
Phần dưới chỉ PHÂN LOẠI các ô lệch giữa phán quyết chính thức (RuSTy) và OIP; mọi kết luận "do OIP" đều có ca dò riêng (chương trình 1–3 dòng).

## Mẫu số
30 đề · 30 lời giải mẫu · 30 đột biến `sai` · 288 lời giải model (PLC-v1-ab-kiem-q36-27b-{1,2}, 24 đề × 2 nhánh × 3 lượt × 2 báo cáo) ·
9 108 kiểm.

## Thước (mẫu + đột biến)
- Mẫu: 28/30 ĐẠT; 2 từ chối TẬP CON (tt8, ud8 — `TIME_TO_LINT`, đã đăng ký trước). Không mẫu nào trượt hành vi (ngoại lệ tv1 an-fb0 b1–2
  đã bỏ theo đăng ký trước).
- Đột biến: 26/30 TRƯỢT; 2 ĐẠT đều là ngoại lệ đã đăng ký (tt9 sai#0 khối phụ không phủ; tv9 sai#0 CTD kẹp 0 của OIP); 2 từ chối tập con.

## Lời giải model — chính thức × OIP

| | OIP đạt | OIP trượt | từ chối tập con | từ chối khác |
|---|---|---|---|---|
| chính thức ĐẠT (187) | 150 | 8 | 28 | 1 |
| chính thức TRƯỢT (101) | 2 | 53 | 2 | 44 |

Đồng thuận (đạt/đạt + trượt/trượt-hoặc-từ-chối-khác): 150 + 53 + 44 = 247 / 288 = 85,8 %; loại 30 dòng tập con (tt8 / ud8 / tv6 dùng LINT):
247 / 258 = 95,7 %. (rà kiem-dinh) Con số này GỘP 44 dòng "chính thức trượt × OIP từ chối biên dịch" — cùng kết luận "không đạt" nhưng OIP từ
chối biên dịch KHÔNG phải bằng chứng HÀNH VI; đồng thuận thuần hành vi (cả hai đều chạy được): đạt/đạt 150 + trượt/trượt 53 = 203 / (150 + 8 + 2 + 53)
= 203 / 213 = 95,3 %.

### Ô chính thức ĐẠT × OIP trượt (8) — CẢ 8 do lệch ngữ nghĩa OIP, KHÔNG phải lỗi model bộ test chính thức bỏ sót
1. **tt2-co-gian-tuong-tu ×4** — `THO / 27648.0` với `THO : INT`: OIP ép hằng REAL về INT và chia NGUYÊN (13824 / 27648.0 = **0**); IEC ed3 / RuSTy nới
   INT ⇒ REAL (= 0,5). Ca dò: `r := t / 27648.0` ⇒ 0, `r := INT_TO_REAL(t) / 27648.0` ⇒ 0,5. Lời giải đúng chuẩn bị OIP chấm sai.
2. **tv4-tre-tat-quat ×4** — `TOF` với `PT := T#0s` khi `DUNG_KHAN`: OIP trễ MỘT lần quét mới hạ Q (cùng lớp với ngoại lệ đã đăng ký tv1 —
   bộ định thời PT = 0 của OIP), nên lần nhả sau đó đo ET từ mốc khác ⇒ `QUAT` còn TRUE, `CON_LAI` = 40 thay vì 0.

### Ô chính thức ĐẠT × OIP từ chối khác (1)
- **tv8-xung-khoi-dong** — `cannot bind TP output 'Q' into function-block output 'Q'`: gán thẳng đầu ra khối con vào đầu ra FB bằng `=>` — hợp lệ
  IEC, OIP từ chối (giới hạn OIP).

### Ô chính thức TRƯỢT × OIP đạt (2) — không phải OIP "dễ dãi"
- **ud2-den-giao-thong** (chính thức 47/49): 2 test trượt nằm ở 5 kiểm của khối phụ `NhapNhay` mà kịch bản KHÔNG phủ (ghi trong `nguon`).
- **tv2-dem-san-pham** (chính thức: `KHONG_THAY_TONG_KET_TEST`, mã thoát 1 — **SUY LUẬN** (không có log RuSTy trong báo cáo): RuSTy không biên
  dịch / chạy được): OIP biên dịch và chạy đủ 30 kiểm đạt — có thể là khác phương ngữ trình dịch, chưa xác nhận.

### Ô chính thức TRƯỢT × OIP từ chối khác (44)
Lỗi biên dịch trên OIP ở lời giải cũng trượt chính thức (vd `unexpected 'REAL' in expression`) — hai bên cùng kết luận "không đạt".

## Kết luận cho quyết định "đưa điểm hành vi OIP vào bộ chấm chính"
- OIP KHÔNG bắt thêm lỗi thật nào mà bộ test chính thức bỏ sót trên 288 lời giải này (ô ĐẠT × trượt = 8, cả 8 là lệch ngữ nghĩa OIP).
- Ba lệch ngữ nghĩa của OIP làm SAI phán quyết với lời giải đúng chuẩn: (a) INT / hằng REAL ⇒ chia nguyên; (b) TON / TOF với PT = 0 trễ một lần
  quét; (c) CTD kẹp CV ở 0. Thêm hai giới hạn: không LINT / `TIME_TO_LINT`; không gán `=>` đầu ra khối con vào đầu ra FB.
- ⇒ ĐỀ XUẤT: KHÔNG đưa điểm hành vi OIP vào bộ chấm chính lúc này. Giữ OIP làm công cụ đối chiếu (chạy được không cần Docker); nếu muốn dùng
  làm điểm chính thì cần (1) báo / vá ba lệch ngữ nghĩa ở upstream (dự án MIT, "early development") hoặc vá cục bộ có ghim, và (2) mở rộng kịch bản
  cho khối phụ + biên (kiem-dinh đo: 86,7 % đột biến tự sinh bị bắt; bài yếu tt7, tt9, tt3, ud9).
- Quyết định là của dieu-phoi / chủ dự án (hợp đồng B2 điều 3).
