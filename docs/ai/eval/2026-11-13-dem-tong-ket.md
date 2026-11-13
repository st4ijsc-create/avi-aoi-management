# Đêm đo 13/11 — tổng kết (do-model)

Máy :3013 chạy trên `aoi_management_test` với vai `avi_app`; llama-server :8091 không khởi lại. Model là Qwen3.6-35B-A3B-UD-Q4_K_XL (ctx 65536). Đêm chạy từ 23:00:05 đến 23:59:59; máy được trả lúc 00:00 (:3013 tắt, khoá khe đã gỡ, worktree `_ai9_do_d` / `_ai9_do_e` không đổi).

Tóm tắt: không có hiệu ứng nào tách được ở cỡ mẫu này. T1 chưa nghiệm thu, NEN_MOC giữ 0.

## Thiết bị đo

- **Mốc thời gian (`moc-dem.mjs`):** từ 23:00:05 đến 23:41:52 có KHOANG_TRONG 0, tức máy không ngủ.
  - p1b (Phần 1, lượt 2–6, 23:42:06–23:59:59) chạy SAU khi moc-dem dừng nên **không có mốc**.
  - Bằng chứng thay thế là log `dem-13-11.log` liền mạch: lượt sau bắt đầu 7–8 s sau khi lượt trước thoát, mỗi lượt dài 2,5–4 phút (23:42:24 → 23:45:56 → 23:46:04 → 23:49:48 → 23:49:55 → 23:53:11 → 23:53:19 → 23:55:45 → 23:55:52 → 23:59:53).
- **Lỗi script (do-model):** `dem-11-11.sh` (chưa từng chạy) chép từ `dem-10-11.sh` nhưng thiếu dòng `eval "$(node -e '…co.json… export K=V')"` trong `khoi()`; `dem-13-11.sh` và `dem-13-11-p2.sh` chép tiếp lỗi đó.
  - run-eval ghi `co` từ env của chính nó (`locCo(process.env)`), nên báo cáo lượt 1 và báo cáo T1 có `co = {}`.
  - KIEM CO đỏ ⇒ Phần 1 tự dừng an toàn sau lượt 1; Phần 2 đỏ ở bước kiểm cuối nhưng dữ liệu đã ghi đủ.
  - Cờ thật của :3013 có trong dòng `co {…}` mà `may.mts khoi` in ra trong log; đây là bằng chứng thay thế cho hai báo cáo có `co` rỗng.
- **Bản sửa p1b (dieu-phoi duyệt, sha `dd3796f84c7f742b`):** diff với `dem-13-11.sh` đúng 3 dòng:
  1. Thêm dòng eval export (chép nguyên từ `dem-10-11.sh`).
  2. `l=0` → `l=1`.
  3. `for NM in 0 0.5 0.5 0 0 0.5` → `for NM in 0.5 0.5 0 0 0.5`.

  Trước khi chạy p1b đã thử khô KIEM CO và được 20/20 cờ; khi chạy, lượt 2–6 đều có KIEM CO "19 co, du".
- **KIEM DOTNET lượt 1** (chạy tay, chỉ đọc `_test`): 10 lệnh `dotnet build/test`, path1 0, 4 lệnh thoát 0 ⇒ SONG. Đây là nghiệm thu đầu tiên cho bản sửa ProgramFiles trong `may.mts` (xem `2026-11-11-dinh-chinh-csharp-agent-f.md`).
- **Token mỗi lượt: KHÔNG ĐO.** Trục H ghi `tokRa` null; `/metrics` của :8091 là số cộng dồn từ lúc khởi, không có mốc trước đêm.

## Phần 1 — C# agent-f (cs-dat-phong, cs-nhat-ky), mỗi lượt 1 mẫu/bài

Lượt 1 được xếp vào D0 theo cờ của `may.mts`, vì `co` trong báo cáo rỗng. `tong-dem` nhóm theo `bc.co` nên tách lượt 1 thành nhóm "undefined"; bảng dưới đã gộp tay.

| nhánh | lượt | cs-dat-phong | cs-nhat-ky | tổng (Wilson 95 %) |
|---|---|---|---|---|
| D0 (NEN_MOC=0) | 1, 4, 5 | 1/3 | 3/3 | 4/6 (30–90 %) |
| D (NEN_MOC=0.5) | 2, 3, 6 | 0/3 | 3/3 | 3/6 (19–81 %) |

- Fisher p = 1,000 ⇒ **chưa phân biệt được**.
- Dừng vì het-luot 3/12 lần: đặt phòng lượt 1 và 6, nhật ký lượt 3 (vẫn ĐẠT).
- Quyết định chu-du-an-HST: NEN_MOC giữ 0.

## Phần 2 — T1 tự kiểm mã (xen-ke, 18 mẫu ⇒ 9 mẫu/nhánh/bài, commit 20fa3bad1)

- Đủ 72/72 mẫu; mọi lần trượt là `TEST_DO`, tức test đã chạy và đỏ.
- Xong lúc 23:41 vì mốc 04:30 chỉ là trần.
- Thời gian mỗi mẫu 12,7–58,8 s, cùng chế độ với đêm 10/11 (H-cs2 26–39 s).
- Log :3013 có 72 dòng `[codingRepoContext]`, đúng một dòng mỗi mẫu.

| bài | BẬT | TẮT | Fisher p | nhánh BẬT |
|---|---|---|---|---|
| H-cs1 | 9/9 | 9/9 | 1,000 | sạch 9, thêm 2,0 s |
| H-cs2 | 9/9 | 6/9 | 0,206 | da-sua 4/9, thêm 5,0 s và ~2169 ký tự |
| H-py3 | 3/9 | 5/9 | 0,637 | sạch 9 |
| H-ts3 | 4/9 | 3/9 | 1,000 | da-sua 1/9 |
| tổng | 25/36 | 23/36 | | |

- **Giới hạn H-py3:** tự kiểm báo "sạch" 9/9 trong khi test đỏ 6/9 ⇒ ở bài này tín hiệu tự kiểm KHÔNG đáng tin (rủi ro "xanh sai").
  - Lệnh tự kiểm Python hiện tại là `python -I -m py_compile code.py` (`server/services/ai/tuKiemMa/bienDichMa.ts`, `ARGS_PYTHON`). Lệnh này chỉ kiểm cú pháp, không chạy mã, nên không bắt được lỗi logic hay ca biên.
  - C# dùng `dotnet build` (thư viện, không restore); TS dùng `tsc --noEmit`.
- H-cs2 là chỗ duy nhất tự kiểm thật sự sửa bài (lỗi biên dịch). Kết quả nghiêng về BẬT nhưng p = 0,21 ⇒ chưa đạt.
- Quyết định chu-du-an-HST: **T1 CHƯA nghiệm thu, không bật mặc định**; đo thêm chỉ ở C# (H-cs2 + một bài C#, ≥ 20 mẫu/nhánh) khi có đêm trống, sau HA-10 và HA-6b.
- Log :3013 có 18 dòng `[codingTool] PHỦ QUYẾT (viet-moi): heuristic=list_files · model=không tool`. Đó là bộ định tuyến tool quyết không gọi tool (~2 s mỗi lần), không phải lỗi.

## Lần đo sau

- Chụp `/metrics` của :8091 trước và sau mỗi lượt để có token mỗi lượt.
- Sửa `tong-dem` để nhóm theo cờ của `may.mts` khi `bc.co` rỗng, và ghi rõ nguồn cờ.
- Trước đêm đo, chạy khô KIEM CO; sha khớp bản đã duyệt chưa đủ.

## Tệp

- `2026-11-13-agent-f-cs-nm{0,0.5}-l{1..6}.{json,md}`: Phần 1, mỗi lượt một cặp tệp.
- `2026-11-13-t1-xen-ke.{json,md}`: Phần 2.
