# B2 — chấm HÀNH VI (OIP, AST walker) song song phán quyết chính thức (RuSTy) — 2026-11-03

Mẫu số: **30 đề** · **30 lời giải mẫu** · **30 đột biến sai** · **288 lời giải model** (PLC-v1-ab-kiem-q36-27b-1.json, PLC-v1-ab-kiem-q36-27b-2.json) · tổng kiểm theo kịch bản 9108.
Kịch bản đăng ký trước (băm từng tệp trong `B2-ket-qua.json`). Không đổi điểm chính thức Đợt 9.

## Thước: lời giải mẫu + đột biến
| | n | OIP đạt | OIP trượt | OIP từ chối (tập con) | OIP từ chối (khác) | ví dụ |
|---|---|---|---|---|---|---|
| mẫu (phải ĐẠT) | 30 | 28 | 0 | 2 | 0 | `st-tt8-doc-tang-giam` mau — hien-thi: bien-dich: unknown function 'TIME_TO_LINT'<br>`st-ud8-pi-chong-bao-hoa` mau — hien-thi: bien-dich: unknown function 'TIME_TO_LINT' |
| đột biến (phải TRƯỢT) | 30 | 2 | 26 | 2 | 0 | `st-tt9-dong-goi-bit` sai#0<br>`st-tv9-dem-xuong` sai#0 |

## Lời giải model: chính thức (RuSTy) × OIP
| chính thức \ OIP | đạt | trượt hành vi | từ chối: tập con OIP (KHÔNG tính model trượt) | từ chối: khác (biên dịch / kiểu — OIP chặt hơn?) |
|---|---|---|---|---|
| ĐẠT (187) | 150<br>`st-tt1-bo-phieu-2oo3` PLC-v1-ab-kiem-q36-27b-1#bat#l1<br>`st-tt1-bo-phieu-2oo3` PLC-v1-ab-kiem-q36-27b-1#tat#l1<br>`st-tt1-bo-phieu-2oo3` PLC-v1-ab-kiem-q36-27b-1#bat#l2 | 8<br>`st-tt2-co-gian-tuong-tu` PLC-v1-ab-kiem-q36-27b-1#tat#l1 — hien-thi b0 13824 thang 0..100 => 50: GIA_TRI ky=50 thuc=0<br>`st-tt2-co-gian-tuong-tu` PLC-v1-ab-kiem-q36-27b-1#tat#l3 — hien-thi b0 13824 thang 0..100 => 50: GIA_TRI ky=50 thuc=0<br>`st-tv4-tre-tat-quat` PLC-v1-ab-kiem-q36-27b-1#bat#l2 — an-fb b24 t=300 nha sau khi bo lenh => tat: QUAT ky=false thuc=true | 28<br>`st-tt8-doc-tang-giam` PLC-v1-ab-kiem-q36-27b-1#bat#l1 — hien-thi: bien-dich: LINT is not supported: 64-bit integers need exact arithmetic a JS number cannot provide; <br>`st-tt8-doc-tang-giam` PLC-v1-ab-kiem-q36-27b-1#tat#l1 — hien-thi: bien-dich: LINT is not supported: 64-bit integers need exact arithmetic a JS number cannot provide; <br>`st-tt8-doc-tang-giam` PLC-v1-ab-kiem-q36-27b-1#bat#l2 — hien-thi: bien-dich: LINT is not supported: 64-bit integers need exact arithmetic a JS number cannot provide;  | 1<br>`st-tv8-xung-khoi-dong` PLC-v1-ab-kiem-q36-27b-2#bat#l1 — hien-thi: bien-dich: cannot bind TP output 'Q' into function-block output 'Q' |
| TRƯỢT (101) | 2<br>`st-tv2-dem-san-pham` PLC-v1-ab-kiem-q36-27b-2#tat#l1<br>`st-ud2-den-giao-thong` PLC-v1-ab-kiem-q36-27b-2#bat#l2 | 53<br>`st-tv1-chong-doi` PLC-v1-ab-kiem-q36-27b-1#bat#l3 — an-fb b10 t=190 nhieu bat 1 chu ky: Q ky=false thuc=true<br>`st-tv2-dem-san-pham` PLC-v1-ab-kiem-q36-27b-1#bat#l1 — an-fb b12 lo 2 du: SO_LO ky=2 thuc=4<br>`st-tv4-tre-tat-quat` PLC-v1-ab-kiem-q36-27b-1#bat#l1 — an-fb b0 t=0 khong lenh => tat: CON_LAI ky=0 thuc=50 | 2<br>`st-tv6-dem-gio-chay` PLC-v1-ab-kiem-q36-27b-1#bat#l3 — hien-thi: bien-dich: unknown function 'TIME_TO_LINT'<br>`st-tv6-dem-gio-chay` PLC-v1-ab-kiem-q36-27b-2#bat#l2 — hien-thi: bien-dich: unknown function 'TIME_TO_LINT' | 44<br>`st-tt2-co-gian-tuong-tu` PLC-v1-ab-kiem-q36-27b-1#bat#l2 — hien-thi: bien-dich: unexpected 'REAL' in expression<br>`st-tt2-co-gian-tuong-tu` PLC-v1-ab-kiem-q36-27b-1#tat#l2 — hien-thi: bien-dich: unexpected 'REAL' in expression<br>`st-tt2-co-gian-tuong-tu` PLC-v1-ab-kiem-q36-27b-1#bat#l3 — hien-thi: bien-dich: unexpected 'REAL' in expression |

## Ngoại lệ ĐĂNG KÝ TRƯỚC (kiem-dinh rà đáp án, `ngoai-le-dang-ky.json` — ghi trước khi chạy)
| bài | loại | phạm vi | dòng bị ảnh hưởng (mẫu / sai / model) | lý do |
|---|---|---|---|---|
| `st-tv1-chong-doi` | ngu-nghia-oip | an-fb0 b1,2 | 1 / 1 / 11 | TON PT=T#0ms trên OIP: lần quét đầu IN=TRUE cho Q=FALSE (ET=0), lần quét sau mới TRUE; test ẩn (IEC/RuSTy) đòi Q lên NGAY trong cùng chu kỳ ⇒ mọi lời giải đúng trượt bước này trên OIP. Bỏ khỏi phán quyết OIP (vẫn hiện riêng). |
| `st-tv9-dem-xuong` | ngu-nghia-oip | sai#0 | 0 / 1 / 0 | CTD của OIP KẸP CV ở 0 (xung CD khi CV=0 không đếm âm); CTD chuẩn (RuSTy) đếm xuống âm ⇒ đột biến sai#0 (`suon.Q AND ctdTon.CV > 0` → `suon.Q`) VÔ HÌNH với OIP dù kịch bản chép đủ. Không tính là 'OIP không bắt'. |
| `st-tt9-dong-goi-bit` | khong-phu | sai#0 | 0 / 1 / 0 | đột biến sai#0 nằm ở khối PHỤ MoGoiBit mà kịch bản bỏ (20 kiểm của khối phụ không biểu diễn được) ⇒ kịch bản yếu hơn test ẩn theo thiết kế. |
| `st-tt8-doc-tang-giam` | tap-con-oip | cả bài | 1 / 1 / 12 | lời giải mẫu dùng TIME_TO_LINT (64 bit) ⇒ OIP 'unknown function TIME_TO_LINT' — tập con OIP, không tính model trượt. |
| `st-ud8-pi-chong-bao-hoa` | tap-con-oip | cả bài | 1 / 1 / 12 | như st-tt8 (TIME_TO_LINT). |

Bước ngoại lệ ngữ nghĩa ĐÃ BỎ khỏi phán quyết OIP ở bảng trên (vẫn ghi `lechNgoaiLe` trong JSON); đột biến dính ngoại lệ đếm trong cột OIP như thường nhưng KHÔNG đọc là "OIP không bắt".

Ô cần đọc kỹ: **chính thức ĐẠT × OIP trượt** (bộ test chính thức bỏ sót hành vi? hoặc kịch bản/OIP khác ngữ nghĩa) và **chính thức TRƯỢT × OIP đạt** (bộ test chính thức chặt hơn kịch bản rút gọn, hoặc lỗi môi trường RuSTy).
