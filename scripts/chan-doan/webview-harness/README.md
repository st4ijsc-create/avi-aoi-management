# webview-harness — dựng webview của extension AI Local NGOÀI VSCode để kiểm trải nghiệm (2026-10-24)

Dùng đúng `vscode-extension/src/ui/htmlBang.ts` (HTML+JS thật của khung chat) với `acquireVsCodeApi` giả và biến màu VSCode Dark+ giả; mô phỏng tin của extension host bằng `window.__gui({loai:…})`.
Các tệp trỏ đường tuyệt đối `D:/SOURCES/_ai9_qa/...` và thư mục tạm — sửa cho khớp máy trước khi chạy.
1. `node node_modules/tsx/dist/cli.mjs gen.ts <thuMucRa>` (cần `mau.md`) ⇒ `webview.raw.html` + `mau.cay.json`; 2. `node mk.mjs` ⇒ `harness.html` (bỏ CSP, thêm mock); 3. `node srv.mjs` (cổng 3017); 4. `node run1.cjs <thuMuc>` (stream thô → ag_md, ảnh chụp) · `run2.cjs` (paste/drop + CSS) · `run3.cjs` (thẻ duyệt, lỗi, cuộn khi stream).
Giới hạn: KHÔNG thay thế VSCode thật (không có QuickPick, diff native, device flow, model thật).
