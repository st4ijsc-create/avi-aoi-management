# Runbook — ghi lượt agent thật (cửa sổ GPU) và phát lại không GPU (Đợt 12 H4.2)

> Chủ: do-model (ghi, đóng gói, lưới phát lại) · dieu-phoi (khởi động lại :3000) · thiết kế
> `docs/superpowers/specs/2026-10-31-h4-2-ghi-phat-lai-luot-agent.md` · mã `server/services/ai/agent/ghiLuotModel.ts`,
> `server/testing/phatLaiLuot.ts`, `scripts/ai-eval/phat-lai/dongGoi.ts`, `server/testing/phatLaiFixture.test.ts`.

## Bản thô là dữ liệu NHẠY CẢM

`<thư mục>/<runId>.jsonl` chứa NGUYÊN VĂN system prompt, kết quả tool, suy luận của model — CHƯA che. Vì vậy:

1. **Chỉ bật trong cửa sổ đo**: dieu-phoi khởi động lại :3000 với `AI_GHI_LUOT_DIR=D:/DO-AI/ghi-luot` (biến môi trường tiến trình, không sửa
   `.env`), ghi xong khởi động lại KHÔNG có biến. Khi đang bật, nhật ký máy chủ có một dòng cảnh báo "ĐANG GHI NGUYÊN VĂN …".
2. **Thư mục ngoài cây mã**: bộ ghi TỪ CHỐI (bỏ qua, có cảnh báo) thư mục tương đối, thư mục nằm trong thư mục làm việc của tiến trình (gốc
   repo) hoặc trong bất kỳ gốc dự án hộp cát đã khai — so bằng đường THẬT (junction / symlink không lách được).
3. **Quyền**: thư mục tạo 0700, tệp 0600 (POSIX). Windows: quyền thật là ACL của `D:/DO-AI` — chỉ tài khoản chạy máy chủ.
4. **Không che lúc ghi** (phát lại cần nguyên văn) — che ở bước ĐÓNG GÓI.
5. **Xoá bản thô ngay sau khi đóng gói thành công** (`tmp/do-nen-11/dong-goi-b.sh` tự xoá); bản đóng gói hỏng (còn mẫu cấm / quá trần) được
   GIỮ để người xem tay, rồi xoá tay sau khi xem.

## Trình tự cửa sổ (tối B)

1. dieu-phoi: :3000 với `AI_GHI_LUOT_DIR=D:/DO-AI/ghi-luot` + `AI_REPO_SANDBOX_ROOTS=<giá trị .env>;phatlai-f=Phat lai agent-f|D:\SOURCES\avi-aoi-management\sandbox-projects\agent-f`.
2. do-model: `bash tmp/do-nen-11/ghi-b.sh` (6 bài agent-f × 1, dự án `phatlai-f`, khoá khe, `git status sandbox-projects/agent-f` rỗng cuối).
3. dieu-phoi: khởi động lại :3000 KHÔNG có `AI_GHI_LUOT_DIR`.
4. do-model: `bash tmp/do-nen-11/dong-goi-b.sh <runId>=<bài> …` ⇒ `server/testing/fixtures/phat-lai/*.json.gz` (≤ 2 MB/tệp, ≤ 10 MB tổng),
   xoá bản thô; `npx vitest run server/testing/phatLaiFixture.test.ts` phải xanh; commit fixture.

## Đọc kết quả phát lại

- Xanh = harness (lõi, cắt suy luận, gom tool call, hộp cát, sổ, sự kiện) hành xử y như lúc ghi.
- Đỏ "phát lại LỆCH ở lượt n: <trường>" = byte gửi model đã đổi. Cố ý (đổi lời nhắc / nén / công cụ) ⇒ A/B ở cửa sổ GPU rồi ghi lại fixture;
  không cố ý ⇒ hồi quy harness.
- Phát lại KHÔNG đo chất lượng model, và ở chế độ mặc định KHÔNG so system prompt (bài học / ngữ cảnh dự án theo người dùng khác nhau giữa lúc
  ghi và lúc phát).
