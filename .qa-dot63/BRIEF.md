# Đợt 63 — lưới xanh nhờ TRẠNG THÁI ĐĨA: test đọc mã nguồn rồi so chuỗi có `\n` cứng

Bạn là agent XÂY — worktree `D:/SOURCES/_twin_wt`, nhánh `feat/twin-3d-trung-tam`. KHÔNG làm trong `D:/SOURCES/avi-aoi-management` (phiên khác đang dùng; cổng 3000 của họ là bản merge — không chạm).

**Phát hiện từ phiên bạn khác, tôi đã xác minh độc lập:** hai ca test xanh trên worktree này **chỉ vì tệp trên đĩa đang là LF** (do công cụ ghi ra). Trên một bản `git checkout` sạch của Windows (`core.autocrlf=true`, `.gitattributes` rỗng ⇒ `w/crlf`), chúng **ĐỎ**:
- `client/src/components/twin3d/van-hanh/badgeKepRiaDeNhan.unit.test.ts:195` — `toMatch(/\n {2}hopManHinh: HinhChuNhat;\n/)` trên nội dung đọc từ đĩa.
- `client/src/components/twin3d/van-hanh/manMayNoiVaoTrang.unit.test.ts:154` — `toBe("const khungNhin = useMemo(...);")` trên một dòng cắt từ tệp.

Blob trong git giống nhau ở cả hai worktree; **chỉ trạng thái đĩa khác**. Tức lưới đang chứng nhận thứ nó không kiểm.

## 0. Cây
- HEAD kỳ vọng `5b67a1b4` hoặc + N commit `docs(...)` (G121); khác ⇒ `.qa-dot63/00-head-XONG.txt` + DỪNG.
- Cổng riêng **3063** nếu cần (cấm 3000/3001/3008/5173/8080/3047…3062). **3001 (PID 14228) / 3008 (PID 29676) là server chủ dự án — KHÔNG kill, KHÔNG chạm `dist/`.**
- **KHÔNG sửa `.gitattributes`, KHÔNG chạy renormalize** — đó là quyết định repo-wide của chủ sở hữu (ghi vào sổ nợ, mục 4).
- DB dev chỉ đọc. 5 ảnh `test-results/` giữ md5. `.qa-dot47/` 103 tệp 0 byte — không đụng. Không `cmd > "$f"` (G130). Commit theo mục bằng pathspec; `.qa-dot63/<bước>-XONG.txt`; không im lặng > 10′.

## 1. TÁI HIỆN trước, đừng tin lời khai (kể cả của tôi)
Dựng một bản **checkout sạch kiểu Windows** vào thư mục tạm (ví dụ `git worktree add` hoặc `git clone` cục bộ rồi `git config core.autocrlf true` + checkout lại, hoặc `git -c core.autocrlf=true checkout-index -a --prefix=...`), xác nhận `git ls-files --eol` cho ra `w/crlf`, rồi chạy đúng hai ca ấy ⇒ **phải ĐỎ**. Ghi lệnh + đầu ra vào `.qa-dot63/1-tai-hien-XONG.txt`. Nếu **không** tái hiện được ⇒ DỪNG, báo tôi (có thể phép đo của tôi sai).

## 2. Quét toàn bộ lớp lỗi (G110 — đừng vá đúng 2 ca)
Đếm và phân loại **mọi** test đọc tệp nguồn từ đĩa rồi so nội dung: `client/src`, `server`, `e2e`, `scripts` (tôi đếm thô: **288 tệp** dùng `readFileSync`, 84 trong `client/src`). Phân loại:
- **(A) dễ vỡ**: so sánh có chứa `\n`, `\r`, hoặc cắt dòng/`split("\n")`/`toMatch` với ký tự xuống dòng, hoặc `toBe` một dòng nguyên văn.
- **(B) an toàn**: chỉ `toContain("chuỗi không xuống dòng")`, đếm số lần, regex không đụng EOL.
Bảng kết quả vào báo cáo: tệp · dòng · loại · lý do.

## 3. Vá — một chỗ, không rải rác
Thêm **một helper dùng chung** (ví dụ `client/src/test-utils/docMaNguon.ts` hoặc nơi đã có sẵn tiện ích test — tìm trước, đừng tạo trùng): đọc tệp **và chuẩn hoá `\r\n` → `\n`**; chuyển **mọi ca nhóm (A)** sang dùng nó. Không đổi một assertion nào về **nội dung**; chỉ bỏ phụ thuộc EOL.
**Ablation bắt buộc, hai cây:**
| | cây LF (worktree này) | cây CRLF (mục 1) |
|---|---|---|
| trước vá | xanh | **đỏ** (≥ 2 ca) |
| sau vá | xanh | **xanh** |
Nếu sau vá cây CRLF vẫn đỏ ở ca nào ⇒ ca đó còn phụ thuộc EOL, xử tiếp hoặc nói rõ.

## 4. Sổ nợ cho chủ sở hữu (chỉ GHI)
`.qa-dot63/NO.md`: đề xuất `.gitattributes` `* text=auto eol=lf` + `git add --renormalize .` — **lợi** (hết hẳn lớp lỗi này, CI Windows/Linux như nhau) vs **hại** (một commit chạm rất nhiều tệp, đụng mọi nhánh đang mở, có thể gây xung đột cho phiên khác). Kèm số: bao nhiêu tệp sẽ đổi EOL, bao nhiêu tệp hiện `w/crlf` trong repo chính sau merge (phiên kia đo: **191/225 tệp twin3d**).

## Hồi quy + cổng đóng
`vitest twin3d` ≥ **109 tệp / 2 539** trên cây LF · **và** chạy trên cây CRLF ở mục 1, ghi cả hai số · `check` 0 · `check:tests` ≤ 27 · `i18n:check` 0 · `lint:tokens` Δ0 · phạm vi 17 tệp/437 ca · DB/md5/cổng.
Báo cáo 7 mục: cây · 1 tái hiện (lệnh + đầu ra) · 2 bảng phân loại (A)/(B) · 3 vá + bảng ablation hai cây · 4 sổ nợ `.gitattributes` · 5 brief tôi SAI ở đâu (đếm) + lỗi của chính bạn · 6 còn mở · 7 cổng đóng phiên.
