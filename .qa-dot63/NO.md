# SỔ NỢ — `.gitattributes` (Đợt 63). CHỈ GHI, KHÔNG LÀM.

> Quyết định repo-wide ⇒ thuộc quyền chủ sở hữu. Đợt 63 **không** tạo `.gitattributes`,
> **không** chạy `git add --renormalize`. Dưới đây là đề xuất + **số đo thật**, để chủ
> sở hữu quyết bằng dữ kiện chứ không bằng linh cảm.

## 1. Đề xuất

```gitattributes
* text=auto eol=lf
```

kèm một lần `git add --renormalize .`.

## 2. Vì sao — cơ chế, không phải khẩu hiệu

| | đo được |
|---|---|
| `.gitattributes` trong repo | **KHÔNG CÓ** (`git ls-files \| grep gitattributes` → rỗng) |
| `core.autocrlf` | `true`, nguồn `C:/Program Files/Git/etc/gitconfig` (mức **HỆ THỐNG**) |
| ⇒ mọi `git clone`/`checkout` sạch trên Windows | ra **CRLF** |

Hệ quả đã tái hiện (Đợt 63, mục 1): 2 ca lưới XANH trên worktree đang làm việc và **ĐỎ**
trên bản checkout sạch — **cùng commit, cùng blob, chỉ khác trạng thái đĩa**. Tức lưới
chứng nhận thứ nó không kiểm. Lớp lỗi này còn rình ở mọi lưới đọc-văn-bản khác.

Thêm một dấu hiệu: worktree `_twin_wt` hiện **LẪN** EOL — 5 142 `w/crlf`, 2 228 `w/lf`,
17 `w/mixed`. Cùng một repo, cùng một commit, hai tệp cạnh nhau khác EOL, tuỳ công cụ nào
ghi sau cùng. Không ai kiểm soát được điều đó bằng kỷ luật tay.

## 3. LỢI

- Xoá **hẳn** lớp lỗi "lưới xanh nhờ trạng thái đĩa" — không phải vá từng tệp mãi mãi
  (Đợt 63 mới vá được 25/313 tệp ứng viên; phần còn lại chỉ là "chưa dính", không phải "miễn nhiễm").
- CI Linux và máy dev Windows đo **cùng một byte**. Hiện tại không.
- Hết `w/mixed` (17 tệp đang lẫn EOL trong CÙNG một tệp).
- `git diff` hết nhiễu toàn-tệp khi một công cụ đổi EOL.

## 4. HẠI — ĐO ĐƯỢC, VÀ NHỎ HƠN NHIỀU SO VỚI LO NGẠI

Đo trên bản clone CRLF dùng một lần (KHÔNG chạm repo chính), tại commit `92ed9e21`:

| phép đo | kết quả |
|---|---|
| blob văn bản trong chỉ số | **7 390 / 7 390 đã là `i/lf`** · `i/crlf` = 0 · `i/mixed` = 0 |
| `git add --renormalize .` stage bao nhiêu tệp | **0** |
| ⇒ commit sẽ chạm | **đúng 1 tệp** — chính `.gitattributes` (1 dòng) |
| `git status` trên cây đang CRLF sau khi thêm `.gitattributes` | **0 tệp báo "đã đổi"** |
| tệp trên ĐĨA sẽ lật CRLF→LF ở lần checkout kế | **7 390** |

⇒ **Lo ngại trong brief ("một commit chạm rất nhiều tệp, đụng mọi nhánh đang mở, có thể
gây xung đột cho phiên khác") KHÔNG khớp số đo.** Nội dung trong git đã 100 % LF rồi;
`.gitattributes` chỉ đổi cách git **trải ra đĩa**, không đổi thứ đã commit. Không có
xung đột merge nào sinh ra, không nhánh nào phải rebase.

Cái giá thật, nhỏ hơn nhưng có thật:
1. **Mtime churn một lần**: lần checkout/`git checkout -- .` kế tiếp viết lại 7 390 tệp ⇒
   vite/tsc/vitest mất cache, một lần build lại đầy đủ trên MỌI worktree (hiện có 8).
2. **Cửa sổ lẫn lộn**: worktree đang mở giữ CRLF trên đĩa cho tới khi checkout lại. Trong
   cửa sổ đó vẫn LẪN EOL như bây giờ — không tệ hơn, nhưng cũng chưa tốt hơn.
3. Công cụ nào đang **cần** CRLF phải được miễn trừ tường minh. ĐÃ KIỂM: repo có **12 tệp**
   dạng này — `*.bat` ×4 (gradlew.bat, build-apk.bat, fix-gradle.bat, setup-windows.bat),
   `*.cmd` ×1, `*.ps1` ×6, `*.sln` ×1. Dòng miễn trừ đề nghị:
   `*.bat text eol=crlf` · `*.cmd text eol=crlf` · `*.ps1 text eol=crlf` · `*.sln text eol=crlf`.
   (`gradlew.bat` mà thành LF là hỏng build Android — đây là rủi ro thật DUY NHẤT tìm được.)

## 5. Đề nghị thứ tự (nếu chủ sở hữu duyệt)

1. Liệt kê tệp buộc phải CRLF (`*.bat`, `*.cmd`, `*.ps1`?) → thêm dòng miễn trừ.
2. Chọn thời điểm KHÔNG có phiên nào đang chạy bộ test dài (churn mtime).
3. Commit `.gitattributes` (1 tệp) + `git add --renormalize .` (đo lại: dự kiến 0 tệp).
4. Mỗi worktree: `git checkout -- .` hoặc `git rm --cached -r . && git reset --hard`.
5. Đo lại `git ls-files --eol | awk '{print $2}' | sort | uniq -c` — kỳ vọng 0 `w/crlf`, 0 `w/mixed`.
6. Chạy `vitest twin3d` xác nhận vẫn 109/2 539.

## 6. Ghi chú phạm vi phép đo

Số ở mục 4 đo trên **một nhánh** (`feat/twin-3d-trung-tam`, `92ed9e21`). Blob dùng chung
cả repo nên rất khó có nhánh nào mang `i/crlf`, nhưng **tôi chưa đo các nhánh khác** —
nếu muốn chắc: `git ls-files --eol` trên từng nhánh đang mở trước khi áp.

Con số "191/225 tệp twin3d `w/crlf` trong repo chính" mà phiên khác đo là trạng thái
**ĐĨA** của worktree ấy; ở `_twin_wt` cùng phạm vi đo được **109 `w/crlf` / 118 `w/lf` /
2 `w/mixed` trên 229 tệp**. Hai con số khác nhau không mâu thuẫn — chúng đo hai cái đĩa
khác nhau, và đó chính là vấn đề.
