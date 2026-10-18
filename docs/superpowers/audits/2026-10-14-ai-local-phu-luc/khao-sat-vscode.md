# Khảo sát extension VSCode "AI Local (ST4I)" — đối chiếu mục tiêu "như Claude Code / Copilot, sửa trực tiếp dự án"

Ngày: 2026-10-14 · Phạm vi: `vscode-extension/` (src ≈ 9.700 dòng mã + 64 tệp test) + các endpoint server nó gọi.
Chế độ: CHỈ ĐỌC. Không mở VSCode thật, không build/đóng gói, không chạm server :3000 / llama-server :8091.

Quy ước nhãn bằng chứng:
- **[ĐO]** — tôi tự đo/đọc trong phiên này (lệnh + kết quả, hoặc file:line).
- **[KHAI]** — số liệu trong tài liệu dự án, tôi KHÔNG đo lại.
- **[SUY]** — suy luận từ mã/cấu hình, chưa có phép đo.

---

## 0. Phép đo trong phiên này

| Việc | Lệnh | Kết quả |
|---|---|---|
| Bản đã cài | `code --list-extensions --show-versions` | `st4i.avi-ai-local@0.1.0`, `anthropic.claude-code@2.1.296`. **Không có GitHub Copilot** (chỉ có `github.vscode-github-actions`) ⇒ so sánh Copilot dựa trên kiến thức sản phẩm [SUY], không đọc được manifest. |
| VSIX ↔ dist ↔ bản cài | giải nén `avi-ai-local-0.1.0.vsix` vào scratchpad, `sha256sum` | `extension.js` của VSIX = `dist/extension.js` = bản cài trong `%USERPROFILE%\.vscode\extensions\st4i.avi-ai-local-0.1.0` = `9e50b1f5…505e096` [ĐO]. `package.json` VSIX = repo (byte-đúng); bản cài khác duy nhất khoá `__metadata`, `contributes` trùng khớp [ĐO]. |
| dist ↔ src mới nhất | so `sourcesContent` trong `dist/extension.js.map` với `src/**` hiện tại | 64 tệp nguồn trong bundle: **57 giống hệt, 7 chỉ khác EOL** (CRLF↔LF — mtime 2026-09-14 = đợt "merge về một mối" chuẩn hoá `eol=lf`), **0 khác nội dung**; 0 tệp nguồn không vào bundle [ĐO]. Commit cuối chạm `vscode-extension/` là `3b9ce8605` (2026-09-06 11:16), dist build 11:12, VSIX 11:13 — khớp. ⇒ **VSIX KHỚP mã nguồn hiện tại.** |
| Test đơn vị | `npx vitest run vscode-extension/src` (từ gốc repo; `vitest.setup.ts` chỉ đặt `DATABASE_URL` sang DB `_test`, không kết nối) | **64/64 tệp, 965/965 ca PASS**, 5,3 s [ĐO]. |
| Typecheck | `npx tsc --noEmit -p vscode-extension` | sạch, exit 0 [ĐO]. |
| Không chạy | `npm run test-that` (mở VSCode thật), build, package | theo ràng buộc. |

---

## 1. Kiến trúc — ai làm gì

```
┌──────────────── WEBVIEW (htmlBang.ts, 872 dòng) ────────────────┐
│ textarea · "@" gợi ý tệp · nút đính kèm · ô mức quyền · nút Dừng │
│ hiển thị TEXT THUẦN (textContent +=), KHÔNG markdown             │
│ thẻ duyệt GHI TỆP (Xem diff / Ghi / Huỷ) · thẻ duyệt CHẠY LỆNH   │
└───────────────▲──────────── postMessage ─────────────────────────┘
                │
┌───────────────┴──── EXTENSION HOST (bangChat.ts 2.057 dòng + loi/ + mang/) ─────────────┐
│ • gom ngữ cảnh: tệp đang mở + vùng chọn (≤24.000 ký tự), @tệp/đính kèm (doc_tep ≤64 KB)  │
│ • DẠY giao thức văn bản ```avi-tool``` vào `question` (chỉ chế độ LOCAL)                 │
│ • VÒNG TÁC NHÂN client: đọc trả lời → tách khối avi-tool → chạy tool cục bộ → hỏi lại    │
│   (≤3 vòng, 1 yêu cầu đọc/vòng): doc_tep · liet_ke · grep (vscode.workspace.fs/findFiles)│
│ • MCP client stdio (spawn mỗi lượt gọi), chạy 6 lệnh allowlist (spawn shell:false)       │
│ • ĐIỂM GHI DUY NHẤT apBanVa.ts: WorkspaceEdit.replace(toàn văn) + doc.save()             │
│ • SecretStorage (cookie) · workspaceState (lịch sử 50 hội thoại, bộ nhớ dài hạn, mức quyền)│
└───────────────▲──────────── HTTP + cookie phiên (LAN, không TLS) ────────────────────────┘
                │
┌───────────────┴──── SERVER :3000 ─────────────────────────────────────────────────────────┐
│ /api/auth/login · tRPC auth.me · repoWorkspace.listProjects                               │
│ POST /api/ai/local-kb/stream  (context.route="vscode")                                     │
│   ├─ LOCAL  (codingMode:false) → streamAnswer nhánh KB-QA: RAG kho LẬP TRÌNH (tài liệu hãng│
│   │         + Studio), KHÔNG tool server, prompt "NGUYÊN TẮC TRẢ LỜI" (chỉ dựa ngữ cảnh),  │
│   │         maxTokens 900, tắt nghĩ, temp 0.15, history ≤12 tin                            │
│   └─ SERVER (codingMode:true, projectId) → streamCodingAnswer: tool chạy trên HỘP CÁT     │
│             SERVER (read_file/list_files/grep_repo; apply_diff/run_command = HITL)          │
│ tRPC aiCopilot.batDauApDungOClient / chotApDungOClient (sổ kiểm toán ghi-trước-chốt-sau)  │
│ tRPC aiCopilot.confirmAction / cancelAction (duyệt đề xuất SERVER)                         │
│ (KHÔNG dùng) /v1/completions (FIM) · /v1/chat/completions (native tools, sau cờ)           │
└───────────────▲───────────────────────────────────────────────────────────────────────────┘
                │ planInference → model router
┌───────────────┴──── llama-server :8091 (Qwen3.6-35B-A3B, 1 slot, 64k) / in-process Qwen3-4B ┐
│ Câu LOCAL luôn >700 ký tự (giáo cụ ≈1,7k) ⇒ "hard" ⇒ model mặc định 35B [SUY từ           │
│ aiModelRouter.ts:357 easy≤160/hard>700]                                                    │
└────────────────────────────────────────────────────────────────────────────────────────────┘
```

**Ba câu hỏi quyết định "sửa trực tiếp dự án":**

1. **Model được gọi từ đâu?** LUÔN từ server (`mang/dongSse.ts:42` → `/api/ai/local-kb/stream`). Extension không có kênh model nào khác, không gọi llama-server trực tiếp [ĐO].
2. **Ai quyết định đọc tệp nào?**
   - LOCAL: **model** quyết định (phát khối `avi-tool`), **extension** thực thi trên workspace máy dev (`bangChat.ts:1253-1318`, `mang/toolCucBo.ts`). Server không biết chuỗi `avi-tool` (0 khớp trong `server/` [ĐO qua Grep `de_xuat_sua`]).
   - SERVER: server tự chọn và chạy tool trên thư mục hộp cát đã đăng ký (`AI_REPO_SANDBOX_ROOTS`, hiện gồm chính repo `D:\SOURCES\avi-aoi-management` + 2 demo [ĐO .env]); extension chỉ một vòng (`bangChat.ts:1251`).
3. **Tệp được ghi bằng API nào?**
   - LOCAL: `vscode.WorkspaceEdit.replace(toàn bộ tài liệu)` + `vscode.workspace.applyEdit` + `TextDocument.save()` — `ui/apBanVa.ts:160-168`, `:406`; có undo Ctrl+Z trong editor; census đếm đúng 1 điểm ghi [ĐO].
   - SERVER: `node:fs` phía server qua `confirmAction` → `apply_diff` trong hộp cát; extension không chạm đĩa [ĐO `bangChat.ts:2024-2026`, `mang/duyetGhi.ts:73`].
   - Không có API tạo/xoá/đổi tên tệp nào ở extension (`apBanVa.ts:86-89` nói thẳng "KHÔNG tạo tệp mới") [ĐO].

---

## 2. Bảng danh mục kiểm 12 mục

| # | Hạng mục | Kết luận | Bằng chứng |
|---|---|---|---|
| 1 | Chat thanh bên | **Một phần** | Có: webview ở secondary sidebar/activitybar (`package.json` viewsContainers; `extension.ts:280-288`), streaming SSE (`bangChat.ts:1197-1226`), huỷ giữa chừng (`dungVongHienTai` `:1024`, AbortSignal), chat mới/lịch sử QuickPick + tự khôi phục (`:938`, `:980`, `:824`; `khoHoiThoai.ts:59,68` trần 50 hội thoại/500k ký tự). **Không**: markdown (`htmlBang.ts:689,701` dùng `textContent`), khối mã có nút chép/chèn/áp dụng (0 khớp clipboard/insert). |
| 2 | Ghost-text inline completion | **Không** | 0 lần `registerInlineCompletionItemProvider` [ĐO Grep]. Spec §2/§11 "HOÃN" vì "model vài phút/lượt". Trong khi server ĐÃ cấu hình `GGUF_FIM_MODEL=Qwen2.5-Coder-1.5B` + `AI_CODE_ROUTER_ENABLED=true` và có `/v1/completions` (`openaiGateway.ts`, Bearer tĩnh) [ĐO .env]. |
| 3 | Sửa inline vùng chọn | **Một phần** | `aviAiLocal.suaDoanChon`, phím `ctrl+alt+k` (không phải Ctrl+I) — `extension.ts:98-179`. Luồng: InputBox → bơm câu hỏi vào panel chat → model trả `de_xuat_sua_doan` → thẻ duyệt → diff tab riêng → "Ghi vào workspace". **Không** diff tại chỗ trong editor, không chấp nhận/bác theo hunk, ghi thay TOÀN VĂN tệp. Tỉ lệ hiện thẻ: 1/5 (2026-09-04) → **5/5** sau Việc 2 phía server (task-v10, 2026-09-05, harness vscode giả + server thật) [KHAI]. |
| 4 | Agent mode | **Một phần (mỏng)** | Có: tự đọc/liệt kê/grep (3 tool), ≤3 vòng (`shared/aiCodingLoop.ts:51` `TRAN_VONG_MAC_DINH = 3`), "mỗi lượt CHỈ MỘT khối" (`dayGiaoThucDoc.ts:115`), báo tiến độ "vòng n/3". Chạy lệnh: 6 lệnh cố định có thẻ duyệt (`lenhChoPhep.ts:53-59`: git status/diff, npm run check, npx vitest run <p>, dotnet build/test <p>). **Không**: sửa NHIỀU tệp (chỉ đề xuất đầu tiên — `bangChat.ts:1578-1584`), tạo/xoá/đổi tên tệp, đưa kết quả lệnh về model (`:1960-1978` chỉ `postMessage` cho người; `this.lichSu` không nhận — `:1384` là chỗ push duy nhất), đọc diagnostics (0 `getDiagnostics`), lặp tới khi build/test xanh, kế hoạch/todo. ⚠ Ở chat THƯỜNG, tool GHI **không hề được dạy** (mục 3.1). |
| 5 | Duyệt thay đổi | **Một phần** | Diff native `vscode.diff` (`diffDeXuat.ts:64,81`; LOCAL: trái = tệp thật trên đĩa). Chặn xung đột băm + bộ đệm bẩn + EOL lẫn lộn + kiểm toán TRƯỚC/SAU (`apBanVa.ts:22-54`). **Không**: theo hunk, nhiều tệp, "chấp nhận tất cả", checkpoint/hoàn tác theo lượt (chỉ Ctrl+Z của editor trên tệp đó). |
| 6 | Ngữ cảnh | **Một phần** | Có: tệp đang mở + vùng chọn (`bangChat.ts:634-662`), @tệp + đính kèm (`:491-540`, trần 5.000 gợi ý), che bí mật + cấm `.env`/khoá (`nguCanh.ts:12-33`), trần khai rõ (24k ký tự; 64 KB/tệp; grep ≤4.000 tệp, ≤1 MB/tệp, 200 kết quả — `docCucBo.ts:49-55`, `toolCucBo.ts:111-120`). **Không**: @folder/@symbol/@workspace, problems, git diff (chỉ qua `chay_lenh`, kết quả không về model), terminal output, index ngữ nghĩa (chỉ grep chuỗi). |
| 7 | Slash / chỉ dẫn dự án / bộ nhớ | **Một phần (yếu)** | Không slash command, không đọc CLAUDE.md / AGENTS.md / copilot-instructions.md (0 khớp [ĐO]). Bộ nhớ dài hạn có: lệnh "Nhớ điều này" + bảng xem/xoá (`khoBoNho.ts`, trần 200 mục), chèn vào mọi câu LOCAL; AI tự đề xuất nhớ **0/5** [KHAI H4-H6]. |
| 8 | Chọn model / nghĩ / token | **Không** | Không ô chọn model hay chế độ nghĩ; server tắt nghĩ cho kb-qa (`aiLocalKnowledgeService.ts:1990`). Thanh ngữ cảnh đếm lượt/ký tự/tệp, tự khai "KHÔNG PHẢI số token" (`htmlBang.ts:256-266`). |
| 9 | Quyền | **Có** | Ba mức Chỉ đọc / Hỏi trước khi ghi (mặc định) / Tự ghi (`mucQuyen.ts`), chặn THẬT ở bước 0 điểm ghi (`apBanVa.ts:185-187`), fail-closed. Allowlist lệnh cấu trúc argv + `shell:false`; lệnh LUÔN hỏi kể cả "Tự ghi" (`bangChat.ts:1788-1799`). Hàng rào ghi: giải symlink, trong workspace, cấm `.git/**`, `.vscode/tasks.json|launch.json`, `*.code-workspace` (`chanGhi.ts`). `serverUrl`/`mcpServers` `scope: machine`. |
| 10 | MCP client / tool cục bộ | **Có (một phần về độ tin)** | MCP stdio `initialize`→`tools/list`/`tools/call`, duyệt lần đầu, trần 15 s / 2 MB (`mcpClient.ts:39-41`); bắt tay thật 13 tool [KHAI H4]. Model gọi MCP đúng 2/3 [KHAI H6]. Tool cục bộ: 3 đọc + 6 lệnh. |
| 11 | Quick fix / CodeLens / giải thích / test / doc / commit msg / review | **Không** | 0 `registerCodeActionsProvider`/`registerCodeLensProvider`, không lệnh giải thích/tạo test/commit message/review [ĐO Grep + manifest 10 lệnh]. |
| 12 | Vận hành | **Một phần** | Có: đăng nhập cookie (SecretStorage), kiểm phiên `auth.me`, 401 ⇒ xoá cookie, lỗi mạng ⇒ nút "Mở Settings" (`loiKetNoiMayChu.ts`), đổi máy chủ, cài `.vsix` offline. **Không**: 2FA (`extension.ts:34-38`), chạy khi server mất (model + sổ kiểm toán đều ở server — `bangChat.ts:1881-1890` cấm ghi khi chưa đăng nhập), cập nhật tự động, i18n giao diện (chuỗi tiếng Việt cứng; `uiLanguage` chỉ đổi ngôn ngữ TRẢ LỜI), telemetry. README lỗi thời: vẫn nói "Đợt A — CHỈ ĐỌC, chưa có đường ghi" và "Ba lệnh" (`README.md:8-19,39-47,76-77`) trong khi manifest có 10 lệnh và đường ghi đầy đủ — README này được đóng vào VSIX. |

---

## 3. Phát hiện chính (ngoài bảng)

### 3.1 [ĐO] Chat thường ở chế độ LOCAL KHÔNG THỂ đề xuất sửa tệp
- `yeuCau.ts:103-109`: giáo cụ chèn cho LOCAL không-Cmd+K là `dungVanBanDayGiaoThucDoc()` — chỉ dạy `doc_tep`/`liet_ke`/`grep` và "viết THẲNG mã trong câu trả lời" (`dayGiaoThucDoc.ts:95-125`).
- Chuỗi `de_xuat_sua`/`de_xuat_sua_doan` xuất hiện trong mã không-test DUY NHẤT ở `cauHoiSuaChon.ts:50` (Cmd+K) và trong parser (`deXuatCucBo.ts`). Server không dạy (0 khớp).
- ⇒ `xuLyDeXuatCucBo(traLoiCuoi)` (`bangChat.ts:1403`) chạy trên mọi câu trả lời chat, nhưng model không được dạy cú pháp ⇒ đường ghi từ chat thường thực tế CHẾT. Đường ghi sống duy nhất ở LOCAL là Cmd+K (một đoạn chọn, một tệp). Câu trả lời chat có mã thì là text thuần, không nút áp dụng ⇒ người dùng phải tự chép tay.

### 3.2 [ĐO] Kênh model của LOCAL là đường hỏi-đáp TRI THỨC, không phải đường lập trình
- `codingMode: dv.cheDo.loai === "server"` (`yeuCau.ts:99`) ⇒ LOCAL vào `streamAnswer` nhánh KB-QA.
- Prompt gốc mang "NGUYÊN TẮC TRẢ LỜI: 1. Chỉ trả lời dựa trên ngữ cảnh… 2. … trả lời chính xác 'Tôi không có thông tin…'" (`aiLocalKnowledgeService.ts:1924-1929`) — extension phải dùng câu "GHI ĐÈ" để giành lại (`dayGiaoThucDoc.ts:31-62` ghi rõ đo 1/11 → 10/11).
- `maxTokens` = `KB_QA_NUM_PREDICT_VSCODE ?? 900` (`:619-620`), tự khai ≈ 2.400–2.700 ký tự (`:595-598`); tắt nghĩ (`:1990`); temp 0.15. ⇒ [SUY] `de_xuat_sua` (viết lại TOÀN VĂN tệp) không thể dùng cho tệp > ~2,5k ký tự — câu trả lời bị cắt giữa JSON, parser trả `[]`, không thẻ nào hiện. Cmd+K bị cùng trần cho `thayThe`.
- Giao thức văn bản tự chế thay vì tool-calling gốc; server ĐÃ có `/v1/chat/completions` hỗ trợ `tools` gốc (sau cờ, `openaiGateway.ts:77-255`) nhưng là Bearer tĩnh dùng chung, không danh tính người dùng.

### 3.3 [ĐO] Không có vòng khép kín "sửa → chạy → đọc lỗi → sửa"
- Kết quả `chay_lenh` chỉ hiện cho người (`bangChat.ts:1969-1978`); không vào lịch sử, không thành lượt hỏi kế. `dayLenhDoc.ts` lại dạy model "để tự kiểm tra công việc của mình" — lời hứa với model không khớp hành vi.
- Lệnh, ghi tệp, đề xuất nhớ đều chỉ xử lý SAU vòng lặp, chỉ phần tử ĐẦU TIÊN (`:1403-1413`, `:1578`, `:1747-1752`).

### 3.4 [ĐO] Chế độ SERVER bỏ im lặng đề xuất `run_command` của server
- `deXuatGhi.ts:18`: `if (pa.tool !== "apply_diff") return null;` ⇒ `pending_action` của `run_command` không bao giờ thành thẻ duyệt; người dùng chỉ thấy câu tóm tắt dạng token. Chế độ SERVER cũng chỉ một vòng (`bangChat.ts:1251`).
- Ghi chú: trên CHÍNH máy này, server và VSCode cùng máy và repo đã đăng ký hộp cát ⇒ chế độ SERVER thực chất sửa đúng tệp của repo đang mở (qua `node:fs` phía server, không có undo editor) [SUY từ `.env`]. Đây là đường có tool server đầy đủ hơn LOCAL, nhưng chỉ đúng khi dev ngồi trên box AI — trái với giả định "server ở box khác" của spec §2.

### 3.5 [SUY — chưa đo] Che dữ liệu phía server có thể bị ghi ngược xuống tệp
- Server đưa model `plan.safeText` = `redactSecretsAndPII(question)` (`aiLocalKnowledgeService.ts:1938`), che email → `[REDACTED_EMAIL]`, số điện thoại VN, `password: '…'` → `[REDACTED_SECRET]` (`ai/aiSafety.ts:296-393`).
- Cmd+K trên đoạn chứa các chuỗi đó ⇒ model chỉ thấy bản đã che ⇒ `thayThe` có thể mang `[REDACTED_…]` ⇒ được ghép và ghi toàn văn. Extension không có phép chặn chuỗi `REDACTED` nào (0 khớp). Lưới đỡ duy nhất: người duyệt nhìn diff. Chính `extension.ts:118-122` đã nhận ra đúng lớp lỗi này ở phía extension ("model sẽ 'sửa' đúng văn bản đã bị che … ghi RÁC đè lên tệp thật") nhưng chưa tính tới lớp che của server.

### 3.6 [KHAI + SUY] Số đo đầu-cuối đã cũ
- Lần nghiệm thu đầu-cuối gần nhất: 6/11 tác vụ ĐẠT (H4, 2026-09-04), đa số là tác vụ ĐỌC/giải thích; Cmd+K 5/5 thẻ (V10, 2026-09-05) [KHAI].
- Extension đứng yên từ 2026-09-06, nhưng server đã đổi nhiều sau đó (PDCA KB vòng 5–15: dịch truy vấn, cổng lạc đề — đã loại trừ `route==="vscode"` ở `:3241`, `:3821` [ĐO] —, Đợt 1–12 engineering…). Chưa có lần đo lại nào ⇒ tỉ lệ thật hiện tại KHÔNG BIẾT [SUY].

### 3.7 Điểm mạnh thật (để không đánh giá lệch)
- Kỷ luật an toàn hiếm thấy: một điểm ghi có census, kiểm toán ghi-trước-chốt-sau trung thực ba trạng thái, chống TOCTOU, chặn symlink/junction, EOL lẫn lộn fail-closed, chặn tệp gây thực thi (`.git/hooks`, tasks.json), chống tiêm lệnh bằng kiến trúc (kết quả tool không bao giờ bị quét lại), allowlist argv. 965 ca đơn vị xanh + bộ host thật (`test-real-host/suite`: kích hoạt lệnh, diff provider, EOL/BOM, multi-root, ghi đĩa thật, thanh bên).
- Nhưng chất lượng thi công cao đang phục vụ một bề mặt chức năng hẹp: rất nhiều lớp rào quanh MỘT đề xuất MỘT tệp mỗi lượt.

---

## 4. So sánh trực tiếp

Cột Claude Code dựa trên manifest bản cài 2.1.296 [ĐO: lệnh accept/rejectProposedDiff, accept/rejectProposedHunk, insertAtMention, newConversation, reopenClosedSession, createWorktree, sessions list, installPlugin; cấu hình initialPermissionMode, allowDangerouslySkipPermissions, respectGitIgnore, autosave, attachOpenFile…] + kiến thức sản phẩm [SUY]. Cột Copilot: kiến thức sản phẩm [SUY] — không cài trên máy.

| Năng lực | GitHub Copilot | Claude Code (VSCode) | AI Local (ST4I) |
|---|---|---|---|
| Ghost-text khi gõ | Có (lõi sản phẩm) | Không (không phải trọng tâm) | **Không** |
| Chat thanh bên + markdown + khối mã có nút | Có | Có | Text thuần, không nút |
| Sửa inline (Ctrl+I / Cmd+K) diff tại chỗ | Có, hunk tại chỗ | Qua diff đề xuất, accept/reject hunk tại con trỏ | Ctrl+Alt+K → panel → diff tab, cả tệp |
| Agent đọc/tìm nhiều tệp | Có (tool gốc, workspace index) | Có (Read/Grep/Glob, không giới hạn vòng cứng thấp) | 3 vòng × 1 đọc/vòng, grep chuỗi |
| Sửa NHIỀU tệp / tạo / xoá / đổi tên | Có | Có | **Không** (1 tệp/lượt, chỉ tệp đã có) |
| Chạy terminal + đọc kết quả, lặp tới xanh | Có | Có (Bash, đọc output, lặp) | 6 lệnh cố định, **kết quả không về model** |
| Đọc diagnostics / problems | Có | Có (qua MCP IDE) | Không |
| Duyệt: hunk / chấp nhận tất cả / checkpoint | Có (keep/undo theo lượt) | Có (hunk, rewind/checkpoint) | 1 tệp, cả tệp, không checkpoint |
| Chỉ dẫn dự án (instructions file) | `.github/copilot-instructions.md`, AGENTS.md | CLAUDE.md | Không (có "bộ nhớ dài hạn" thủ công) |
| Slash command / prompt tuỳ chỉnh | Có | Có (+ skills, plugins) | Không |
| Chọn model / chế độ nghĩ / token | Có | Có | Không |
| Chế độ quyền | Có | Có (initialPermissionMode) | **Có, chặt hơn** (3 mức, chặn ở điểm ghi) |
| MCP client | Có | Có | Có (stdio, duyệt lần đầu) |
| Quick fix / CodeLens / commit msg / review | Có | Một phần (review, commit qua agent) | Không |
| Offline / on-prem / không internet | Không | Không | **Có (lợi thế duy nhất không thể thay thế)** |
| Kiểm toán ghi phía server | Không | Không | **Có** |

---

## 5. Khoảng trống ưu tiên

### P0 — chặn trực tiếp mục tiêu "sửa trực tiếp dự án như Copilot/Claude Code"

| # | Khoảng trống | Vì sao chặn | Bằng chứng |
|---|---|---|---|
| P0-1 | Chat thường LOCAL không dạy tool GHI ⇒ không có đường sửa tệp từ chat | Mục tiêu cốt lõi là "bảo nó sửa, nó sửa"; hiện chỉ Cmd+K trên một đoạn chọn mới ghi được | `yeuCau.ts:103-109`; `dayGiaoThucDoc.ts:95-125`; grep `de_xuat_sua` chỉ ở `cauHoiSuaChon.ts:50` |
| P0-2 | Một đề xuất / một tệp / không tạo-xoá-đổi tên | Mọi tác vụ thật (thêm tính năng, refactor, sinh test) chạm ≥2 tệp và tạo tệp mới | `bangChat.ts:1578-1584`; `apBanVa.ts:86-89` |
| P0-3 | Không vòng khép kín (kết quả lệnh không về model, không diagnostics, 3 vòng × 1 đọc) | "Agent mode" = lặp tới khi build/test xanh; thiếu vế quan sát thì không phải agent | `bangChat.ts:1960-1978`; `aiCodingLoop.ts:51`; `dayGiaoThucDoc.ts:115`; 0 `getDiagnostics` |
| P0-4 | Kênh model sai mục đích: KB-QA, trần 900 token, tắt nghĩ, giao thức văn bản | Không viết lại được tệp >~2,5k ký tự; model phải "đấu" với luật RAG của server; tuân thủ giao thức dao động (T01 1/3) | `aiLocalKnowledgeService.ts:615-620, 1921-1939, 1984-1991`; `yeuCau.ts:96-100` |
| P0-5 | Không ghost-text | Lõi của Copilot; hạ tầng FIM đã có ở server (`GGUF_FIM_MODEL`, `/v1/completions`) nên lý do hoãn của spec (§2 "vài phút/lượt") đã lỗi thời [SUY] | 0 `registerInlineCompletionItemProvider`; `.env:738-739` |

### P1 — làm trải nghiệm kém xa chuẩn, hoặc rủi ro đúng-sai

| # | Khoảng trống | Vì sao | Bằng chứng |
|---|---|---|---|
| P1-1 | Không markdown, không nút chép/chèn/áp dụng khối mã | Câu trả lời có mã (đường duy nhất chat thường "sinh" mã) phải chép tay | `htmlBang.ts:689,701` |
| P1-2 | Inline edit không tại chỗ, không hunk, ghi toàn văn | Kém Ctrl+I của Copilot; sửa 3 dòng mà diff/ghi cả tệp | `extension.ts:177-178`; `apBanVa.ts:165-167` |
| P1-3 | Ngữ cảnh nghèo: không @folder/@symbol/@workspace, problems, git diff, terminal, index ngữ nghĩa, tệp chỉ dẫn dự án, slash | Model không "thấy" dự án như Copilot/Claude Code ⇒ hỏi lại/đọc sai | mục 6, 7 bảng trên |
| P1-4 | SERVER mode bỏ im lặng `run_command`; một vòng | Đường mạnh hơn (tool server) lại hụt nửa HITL | `deXuatGhi.ts:18`; `bangChat.ts:1251` |
| P1-5 | [SUY] Che `[REDACTED_…]` phía server có thể bị ghi ngược xuống tệp qua Cmd+K | Ghi dữ liệu sai lên mã thật; chỉ người duyệt diff đỡ | `aiLocalKnowledgeService.ts:1938`; `aiSafety.ts:296-393`; 0 khớp `REDACTED` trong extension |
| P1-6 | Mọi thứ phụ thuộc server (model + sổ kiểm toán); không 2FA | Server tắt = extension chết hẳn kể cả ghi; tài khoản 2FA không dùng được | `bangChat.ts:1881-1890`; `extension.ts:34-38` |
| P1-7 | Số đầu-cuối đã cũ (06/09) trong khi server đổi nhiều | Không ai biết tỉ lệ thật hôm nay | mục 3.6 |

### P2 — hoàn thiện
- README lỗi thời trong VSIX (`README.md:8-19, 39-47, 76-77`).
- Không chọn model/chế độ nghĩ/hiển thị token thật.
- UI không i18n, không telemetry, không cập nhật tự động.
- Không CodeAction "hỏi AI sửa lỗi", CodeLens, giải thích/tạo test/tạo tài liệu, commit message, review.
- Lời dạy `chay_lenh` hứa "tự kiểm tra công việc" nhưng model không thấy kết quả (`dayLenhDoc.ts`).
- Phím Ctrl+Alt+K thay vì Ctrl+I quen thuộc.

---

## 6. Điểm hoàn thiện

**Cách tính:** 12 hạng mục, trọng số theo tầm quan trọng với mục tiêu ("như Copilot/Claude Code, sửa trực tiếp dự án"); mỗi hạng mục chấm độ phủ 0–1 theo các ý con trong đề bài (có = 1, một phần = tỉ lệ ý con đạt, không = 0). Chỉ chấm độ PHỦ tính năng (đọc mã), không cộng điểm cho chất lượng an toàn và không trừ điểm cho tỉ lệ tuân thủ model (xem dòng hiệu chỉnh).

| # | Hạng mục | Trọng số | Độ phủ | Điểm | Ghi chú chấm |
|---|---|---:|---:|---:|---|
| 1 | Chat | 10 | 0,55 | 5,5 | stream, huỷ, lịch sử, chat mới có; markdown, nút khối mã không |
| 2 | Ghost-text | 12 | 0 | 0 | |
| 3 | Inline edit | 10 | 0,5 | 5,0 | có lệnh + diff + chấp nhận/bác; không tại chỗ/hunk |
| 4 | Agent mode | 20 | 0,15 | 3,0 | chỉ đọc nhiều bước; ghi 1 tệp; lệnh không khép vòng |
| 5 | Duyệt thay đổi | 10 | 0,35 | 3,5 | diff native, chống xung đột; không hunk/nhiều tệp/checkpoint |
| 6 | Ngữ cảnh | 8 | 0,4 | 3,2 | tệp mở, chọn, @tệp, trần; thiếu 6/10 nguồn |
| 7 | Slash/chỉ dẫn/bộ nhớ | 5 | 0,25 | 1,25 | chỉ bộ nhớ thủ công |
| 8 | Model/nghĩ/token | 3 | 0,1 | 0,3 | chỉ đếm ký tự |
| 9 | Quyền | 5 | 0,9 | 4,5 | mạnh nhất |
| 10 | MCP/tool cục bộ | 4 | 0,7 | 2,8 | |
| 11 | CodeAction/CodeLens/… | 6 | 0 | 0 | |
| 12 | Vận hành | 7 | 0,5 | 3,5 | đăng nhập/lỗi mạng/vsix tốt; 2FA, update, i18n, telemetry, offline-khi-mất-server không |
| | **Tổng** | **100** | | **≈ 32,6** | |

**Kết luận: ≈ 33 % độ phủ tính năng** so với mục tiêu.

Hiệu chỉnh theo kết cục (tham khảo, [KHAI]): e2e 6/11 ≈ 55 % trên tác vụ chủ yếu ĐỌC; với tác vụ "sửa trực tiếp dự án", đường sống duy nhất là Cmd+K một đoạn (5/5 hiện thẻ, chưa đo tỉ lệ ĐÚNG sau ghi) ⇒ năng lực sửa-dự-án thực tế còn thấp hơn con số 33 % (ước lượng 15–25 % [SUY]).

Đánh giá chất lượng thi công (riêng, không cộng vào điểm): cao — 965/965 ca xanh, tsc sạch, VSIX khớp nguồn, kỷ luật an toàn và trung thực lời khai vượt Copilot/Claude Code ở mảng kiểm toán/HITL.

---

## 7. Gợi ý hướng (không thuộc yêu cầu, ghi để tham chiếu)
1. Đổi kênh LOCAL sang một route lập trình riêng (không qua KB-QA) với tool-calling gốc + trần token lớn + cho nghĩ; hoặc dùng `streamCodingAnswer` với "tool do client thực thi" (cầu hai chiều — spec §3 đã loại, nên cân nhắc lại khi có số).
2. Đề xuất ghi dạng search/replace theo khối thay vì toàn văn; cho nhiều đề xuất/lượt + tạo tệp; duyệt theo tệp/hunk.
3. Đưa kết quả `chay_lenh` + `getDiagnostics` về làm lượt kế; nâng trần vòng có ngân sách.
4. InlineCompletionItemProvider gọi FIM sẵn có (cần cơ chế xác thực theo người dùng thay Bearer tĩnh).
5. Markdown + nút áp dụng khối mã đi qua đúng `apBanVa`.
6. Đo lại e2e trên server hiện tại trước khi vá thêm (bước 0 PDCA).

## 8. Tệp liên quan
- Extension: `D:\SOURCES\avi-aoi-management\vscode-extension\src\extension.ts`, `src\ui\bangChat.ts`, `src\ui\apBanVa.ts`, `src\ui\htmlBang.ts`, `src\ui\diffDeXuat.ts`, `src\loi\yeuCau.ts`, `src\loi\dayGiaoThucDoc.ts`, `src\loi\cauHoiSuaChon.ts`, `src\loi\deXuatCucBo.ts`, `src\loi\deXuatGhi.ts`, `src\loi\lenhChoPhep.ts`, `src\loi\dayLenhDoc.ts`, `src\loi\mucQuyen.ts`, `src\loi\chanGhi.ts`, `src\loi\nguCanh.ts`, `src\mang\toolCucBo.ts`, `src\mang\mcpClient.ts`, `src\mang\dongSse.ts`, `package.json`, `README.md`, `avi-ai-local-0.1.0.vsix`.
- Server: `D:\SOURCES\avi-aoi-management\server\routes\aiLocalKnowledgeApi.ts` (route `/api/ai/local-kb/stream` dòng 508), `server\services\aiLocalKnowledgeService.ts` (615-620, 1885-1991, 2813-2824, 3496-3590, 3783-3788), `server\services\aiCopilotActions.ts` (1378-1560), `server\routers\aiCopilotRouter.ts` (137-170), `server\routes\openaiGateway.ts`, `server\services\aiModelRouter.ts` (357, 543-574), `server\services\ai\aiSafety.ts`, `shared\aiCodingLoop.ts:51`.
- Tài liệu nền đã đối chiếu: `docs\superpowers\specs\2026-08-28-vscode-extension-ai-local-design.md`, `docs\superpowers\plans\2026-09-03-vscode-extension-dot-g-h-ket-qua.md`, `docs\superpowers\specs\2026-09-04-ai-local-danh-gia-hien-trang-va-lo-trinh.md`, `.superpowers\sdd\2026-09-03-vscode-extension-dot-g\task-v10-report.md`.
