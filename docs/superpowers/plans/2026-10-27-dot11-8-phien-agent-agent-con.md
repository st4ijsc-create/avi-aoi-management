# Đợt 11.8 — Phiên · Agent · Agent con (Thợ Cả)

Nhánh `feat/tho-ca-agent` (worktree `_ai_agent_wt`, từ main ed456ea28). Người lập: tho-ca-agent. Trạng thái: **KẾ HOẠCH — chưa viết mã, chờ dieu-phoi + kiem-dinh duyệt.**
Nguồn: yêu cầu dieu-phoi 2026-10-27 (spec lô 11.8 chưa vào file spec; spec cha nêu UX-C05/C06/C09 ở dòng 63, 81). Tên hiển thị "Thợ Cả"; mã định danh giữ nguyên.

## 0. Hiện trạng đã đo (đọc mã, chưa chạy)

- Vòng agent DUY NHẤT: `shared/agentCore/vongAgent.ts::chayVongAgent` (THUẦN — lưới `thuan.test.ts`: không import server/client/vscode/node). 16 công cụ ở `congCu.ts` (`TEN_CONG_CU`, `LOAI_CONG_CU`, `congCuTheoCheDo`, `kiemThamSo`). `todo_write` xử lý TRONG vòng, không qua `boThucThi.chay`.
- Host máy chủ: `quanLyLuotChay.ts` (sổ `ai_agent_runs`, SSE, `chonModel`, hạn mức), `boThucThiMayChu.ts` (allowlist lệnh, checkpoint, duyệt qua `pending_action`, quét chỉ thị nhúng). Host VS Code: `vscode-extension/src`, lịch sử `workspaceState` (`khoHoiThoai.ts`, trần 50).
- Kho phiên máy chủ ĐÃ CÓ cho lập trình: `ai_coding_sessions` (mig 0333, khoá `userId × projectId`, `turns` jsonb qua `locLuot()` — bất biến "không mang thẻ duyệt"), `server/db/aiCodingSessions.ts` (mọi hàm `userId` bắt buộc). Chat có kho riêng. Agent lưu ở `ai_agent_runs`.
- Sự kiện `dang-cho-model {phiaTruoc}` ĐÃ có trong lõi + stream ⇒ UX-D09 chỉ còn là nối ra UI/SSE (việc luong-ui).
- Lõi nén ngữ cảnh ở 70 %, cảnh báo UI 85 % (spec muốn 80 %).
- CHƯA có: định nghĩa agent đặt tên, agent con, phiên thống nhất web↔VS Code.

## 1. Quyết định thiết kế (cần duyệt)

**D1. Agent con = công cụ thứ 17 `delegate` (tên hiển thị "giao việc"), xử lý TRONG lõi** như `todo_write` nhưng đệ quy gọi chính `chayVongAgent` — KHÔNG thêm vòng thứ hai, lõi vẫn thuần. Tham số: `agent` (tên định nghĩa, enum động hoặc `generic`), `task` (≤ 4 000 ký tự), `tools?` (tập con, chỉ được THU HẸP). Loại công cụ mới `"giao"`; có ở `sua`/`tu-dong`/`hoi` (con của `hoi` bị ép chỉ-đọc).
**D2. Bao đóng an toàn (bất biến, có test + đột biến):**
 1. `congCuCon ⊆ congCuCha` (giao với bộ cha ĐANG phơi theo chế độ) và **không chứa `delegate` nếu độ sâu = trần** (mặc định trần 1; cấu hình tối đa 2).
 2. `cheDoCon ≤ cheDoCha` theo thứ tự `hoi < sua < tu-dong`; `tu-dong` của con chỉ khi cha `tu-dong` VÀ chưa `haTuTri`; con thừa hưởng `haTuTri`/`nguonDangNgo` của cha (một chiều).
 3. Con dùng CHÍNH `boThucThi` của cha bọc bộ lọc tên ⇒ mọi ghi/lệnh của con vẫn qua `can-duyet` → `pending_action` → NGƯỜI duyệt; con **không có đường tự duyệt**. Sự kiện con gắn `{con: <id>, cha: <id>, sau: n}` để UI hiện lồng.
 4. Huỷ cha ⇒ `AbortSignal` con = signal trong của cha (lõi đã abort signal trong khi kết thúc ⇒ dọn con).
 5. Trần riêng của con: `soLuotToiDa` ≤ min(12, còn lại của cha), `tokenRaToiDa` ≤ 1/3 còn lại của cha, `msToiDa` ≤ thời gian còn lại; token con CỘNG vào cha.
 6. Về cha CHỈ có TÓM TẮT (`≤ 1 500` ký tự: câu trả lời cuối của con + danh sách tệp đổi + mã dừng). Lịch sử/quan sát của con KHÔNG vào ngữ cảnh cha (đây là lợi ích giảm đỉnh ngữ cảnh). Tóm tắt là DỮ LIỆU — đi qua cùng đường quét chỉ thị nhúng (`scanUntrustedContent`) như kết quả công cụ.
 7. **Tuần tự**: lõi chờ con xong rồi mới tiếp (1 khe GPU, `-np 1`); cấm 2 `delegate` cùng một lượt model chạy song song — lời gọi thứ hai trở đi trong cùng lượt chạy nối đuôi (tuần tự), không `Promise.all`.
 8. Con không `remember` (đề xuất nhớ chỉ từ cha) và không `todo_write` ghi đè kế hoạch của cha (kế hoạch con không phát `ke-hoach`).
**D3. Sổ kiểm toán nối cha–con:** thêm cột vào `ai_agent_runs` (`parent_run_id uuid null`, `depth smallint default 0`, `agent_name text null`) — mỗi lượt con là MỘT hàng sổ riêng (id riêng, cùng user/project/factory), `tomTat` + token riêng; thẻ duyệt của con mang `runId` con ⇒ truy ngược cha. Phạm vi nhà máy/người dùng giữ nguyên (mọi truy vấn vẫn `userId`).
**D4. Định nghĩa agent:** tệp `.thoca/agents/<tên>.md` trong repo dự án — front-matter YAML (`name`, `description`, `tools: [..]` tập con tên công cụ, `model` = chuỗi `chonModel` hợp lệ hoặc `auto`, `approval: hoi|sua` — KHÔNG có `tu-dong`, `max_turns?`) + thân = lời dặn (≤ 6 000 ký tự). Bộ phân tích THUẦN ở `shared/agentCore/dinhNghiaAgent.ts`; máy chủ đọc qua hộp cát đường đã có (`tepQuyUocAgent.ts` — che bí mật, trần, đường tương đối), ⚠ ĐÃ SỬA ở §7-M2: thân tệp là CHỈ THỊ từ nguồn KHÔNG TIN CẬY, không phải dữ liệu. Khai trên web (D4b) lưu bảng `ai_agent_defs` (người × dự án) — **để cuối lô, cắt được** nếu thiếu thời gian. Bốn agent mẫu nhúng sẵn làm mặc định khi repo không có tệp: `kham-pha` (chỉ-đọc), `viet-test`, `review` (chỉ-đọc + đề xuất), `plc` (compile_st + lookup_api + search_docs, chỉ-đọc/sua).
**D5. Phiên thống nhất:** mở rộng `ai_coding_sessions` THAY VÌ bảng mới: thêm `kind text check in ('chat','coding','agent') default 'coding'`, `source text ('web','vscode')`, `pinned_run_ids`/`run_id` cho phiên agent, `parent_session_id` (nhân bản/nối tiếp sau tóm tắt), `context_pct smallint`. Chat web chuyển dần sang kho này (đọc cả kho cũ — không di trú dữ liệu cũ trong lô này). `locLuot()` ở cả cửa ghi lẫn đọc GIỮ NGUYÊN. API tRPC: `list / get / rename / duplicate / delete / appendTurns` — **userId từ `ctx.user.id`**, mọi câu có `eq(userId)`; phạm vi `projectId` là ID.
 VS Code: đồng bộ phiên qua cùng tRPC (extension 0.4.0 đã nói tRPC); `workspaceState` thành bộ nhớ đệm ngoại tuyến. Phối hợp luong-ui cho UI.
**D6. Ngữ cảnh ≥ 80 % (UX-C06):** hạ ngưỡng cảnh báo 85→80 % (hằng số dùng chung). Khi đạt: lõi phát sự kiện mới `de-xuat-tom-tat-phien` {tomTat, duong:"NOTES.md"}; host KHÔNG tự ghi — ghi qua `write_file/edit_file` thường ⇒ thẻ duyệt diff NGƯỜI duyệt; sau khi duyệt, tạo phiên mới (`parent_session_id`) mang tóm tắt làm lịch sử mở đầu. Tóm tắt do model sinh (cùng khe; chạy tuần tự sau lượt hiện tại).
**D7. Hàng chờ (UX-D09):** không đổi lõi; bảo đảm `dang-cho-model` chảy qua SSE + tRPC `aiAgent.trangThaiHangCho` (số người phía trước, đo từ broker khe) — thin, luong-ui hiển thị.

## 2. Migration — DẢI ĐÃ CẤP 0440–0442 (dieu-phoi 2026-10-27; 0420–0429 KHÔNG dùng)
Đổi tên: `0440_ai_phien_hop_nhat.sql`, `0441_ai_agent_runs_cha_con.sql`, (T12) `0442_ai_agent_defs.sql`. Viết tay idempotent theo khuôn `scripts/apply-migration-*.mjs`; DDL owner `aoi`, nghiệm thu bằng `avi_app`; áp `_test` tự do; **gửi SQL cho dieu-phoi TRƯỚC khi áp DEV**.

(Bản xin dải gốc:)
Cần **1–2 file**: `0420_ai_phien_hop_nhat.sql` (cột kind/source/parent_session_id/context_pct + CHECK) và `0421_ai_agent_runs_cha_con.sql` (cột cha–con + chỉ mục `parent_run_id`); nếu làm D4b thêm `0422_ai_agent_defs.sql`. Xin dieu-phoi dải **0420–0422** (AI báo còn 0419; lô scada/kiem-dinh có 0421 "thiết bị đo theo nhà máy" — XIN XÁC NHẬN không trùng). DDL bằng owner `aoi`, áp `aoi_management` và `_test`; idempotent.

## 3. Nhiệm vụ (mỗi nhiệm vụ: test đỏ → mã → xanh → đột biến đỏ → commit pathspec)

| # | Nội dung | Tệp chính |
|---|---|---|
| T1 | Phân tích định nghĩa agent (THUẦN): front-matter, kiểm tập con công cụ, từ chối `approval: tu-dong`, trần thân, 4 agent mẫu | `shared/agentCore/dinhNghiaAgent.ts` + test |
| T2 | Công cụ `delegate`: schema (không `pattern`/`maxLength` — grammar llama.cpp), `LOAI_CONG_CU`, `kiemThamSo`, lời nhắc hệ thống (quy tắc khi nào giao việc) | `congCu.ts`, `loiNhac.ts` + test |
| T3 | Lõi: xử lý `delegate` đệ quy — bao đóng D2.1–D2.8 (con ⊆ cha, chế độ ≤, độ sâu, trần, tuần tự, huỷ lan, chỉ tóm tắt) | `vongAgent.ts` (+ `agentCon.ts` tách) + test |
| T4 | Sự kiện lồng `con-bat-dau / con-xong` + gắn nhãn `cha/sau` vào sự kiện con; luật `thuan.test.ts` giữ | `kieu.ts`, `vongAgent.ts` |
| T5 | Migration 0440/0441 + schema Drizzle + `aiAgentRuns.ts` (ghi `parent_run_id/depth/agent_name`); sổ nối cha–con | `drizzle/`, `server/db/aiAgentRuns.ts` |
| T6 | Host máy chủ: nạp định nghĩa agent (hộp cát, che bí mật), dựng `boThucThiCon`, `chonModel` của con (qua `giaiChonModelLuotChay`, KHÔNG nâng quyền), ghi sổ con, thẻ duyệt con mang runId con | `quanLyLuotChay.ts`, `boThucThiMayChu.ts`, loader mới |
| T7 | Phiên: mở rộng `aiCodingSessions.ts` (kind/source/parent), `duplicate`/`rename`/`delete`, router tRPC; test PHẠM VI hai tài khoản trên DB thật + đột biến bỏ `eq(userId)` | `server/db/`, router, `aiCodingSessionScope.test.ts` mẫu |
| T8 | Phiên agent: gắn `ai_agent_runs` ↔ phiên (tiếp tục = nạp `turns`, KHÔNG nạp thẻ duyệt cũ) | `quanLyLuotChay.ts` |
| T9 | Ngưỡng 80 % + tóm tắt sang NOTES.md qua đường ghi có duyệt + mở phiên mới | `vongAgent.ts`, host, `loiNhac.ts` |
| T10 | Hàng chờ: tRPC trạng thái + SSE giữ `dang-cho-model` | host |
| T11 | Extension: đồng bộ phiên qua tRPC, bộ lọc 17 công cụ, hiển thị cha–con tối thiểu (phối hợp luong-ui — họ giữ UI, tôi giữ hợp đồng/`yeuCau.ts`) | `vscode-extension/src/loi` |
| T12 | (cắt được) Khai agent trên web: bảng + router | mig 0422 |
| T13 | Lưới/cổng: agent-f + G6 không tụt (do-model độc quyền GPU ⇒ tôi chỉ chuẩn bị bộ bài, xin do-model chạy); đo đỉnh ngữ cảnh tác vụ dài có/không `delegate` bằng bộ giả lập model tất định | `scripts/ai-eval` |
| T14 | Census + tsc toàn cây (12 GB) + `i18n:check` + `appErrorParamsCoverage`; cập nhật README lõi mục 27+ | — |

Thứ tự: T1 → T2 → T3/T4 → T5 → T6 → T7/T8 → T9/T10 → T11 → T13/T14 (T12 sau cùng, tuỳ).

## 4. Bất biến an toàn cần chứng minh (đột biến bắt buộc)
1. Con không gọi được công cụ ngoài bộ cha (đột biến: bỏ phép giao ⇒ test đỏ).
2. Con ghi/chạy lệnh ⇒ luôn `can-duyet` (đột biến: cho con tự `da-duyet` ⇒ đỏ); `tu-dong` của con không vượt cha, `haTuTri` lan xuống.
3. Chỉ thị nhúng trong tóm tắt con bị quét, hạ tự trị cha (đột biến: bỏ quét tóm tắt ⇒ đỏ).
4. Huỷ cha ⇒ con dừng, không còn lời gọi model/công cụ mồ côi.
5. Độ sâu vượt trần ⇒ `delegate` không được phơi / bị từ chối có mã.
6. Định nghĩa agent không nâng quyền: `approval`/`tools` ngoài tập con bị từ chối; thân tệp là dữ liệu (kèm chỉ thị nhúng trong `.thoca/agents/*.md` ⇒ không đổi chế độ).
7. Phiên: mọi hàm `userId` bắt buộc; hai người không thấy phiên của nhau; phiên không mang thẻ duyệt.
8. `thuan.test.ts` xanh (lõi vẫn thuần); census `TEN_CONG_CU` (có `boThucThiMayChu.khongTuGanCo.census`) được cập nhật có chủ đích — con KHÔNG nằm trong tập tự gán cờ.

## 4b. Quyết định đã duyệt (dieu-phoi 2026-10-27)
Q2 `delegate` sau cờ `AI_AGENT_GIAO_VIEC` mặc định TẮT; test cờ tắt ⇒ danh sách công cụ + hành vi y hệt hiện tại (đột biến bật ngầm ⇒ đỏ). Q3 độ sâu 1 (tối đa 2). Q4 T12 cắt được. Thân tệp agent quét chỉ thị nhúng; tệp agent không tin cậy, chỉ thu hẹp quyền. Phơi `delegate` ở extension = lô luong-ui SAU khi máy chủ xong (T11 chỉ còn đồng bộ phiên). Bắt đầu T1 sau khi kiem-dinh không có điều kiện BẮT BUỘC chặn.

## 5. Rủi ro / câu hỏi mở
- **R1** Thêm công cụ thứ 17 làm đổi grammar + tập thử của agent-f/G6 ⇒ nếu `delegate` làm model gọi sai/thừa, tụt cổng. Giảm: chỉ phơi `delegate` khi (a) agent có định nghĩa hoặc (b) cờ `AI_AGENT_GIAO_VIEC=1` (mặc định TẮT cho tới khi do-model đo xong); lời nhắc chỉ nêu khi phơi. Cổng "không tụt" đo với cờ TẮT và BẬT.
- **R2** Con chạy tuần tự trên cùng khe ⇒ thời gian tăng; trần 20 phút của cha tính cả con. Đỉnh ngữ cảnh giảm nhưng tổng token có thể tăng — báo cả hai số.
- **R3** Chat web chuyển sang kho hợp nhất đụng luong-ui (UI đang 10.4b): tôi giữ tầng dữ liệu + tRPC, họ gọi; xin chốt hợp đồng tRPC (D5) TRƯỚC khi họ nối.
- **Q1** Dải migration 0420–0422 (xem §2). **Q2** Có chấp nhận mặc định TẮT cờ giao việc (R1)? **Q3** Độ sâu trần mặc định 1 (cấu hình ≤ 2) — đồng ý? **Q4** D4b (khai trên web) cắt khỏi lô nếu thiếu thời gian — đồng ý?

## 6. Không làm
Không chạm :8091/GPU; không push; không full suite; không sửa `.env`; không di trú dữ liệu chat cũ; không cho `tu-dong` trong định nghĩa agent.

## 7. SỬA ĐỔI THEO RÀ ĐỘC LẬP (kiem-dinh 2026-10-27; dieu-phoi xác nhận làm hết trước T1) — GHI ĐÈ mọi chỗ mâu thuẫn ở trên

**M1 Model con.** `model:` trong tệp định nghĩa và tham số `delegate` chỉ nhận `auto`, model cục bộ (`vai-tro:`/`ho-so:` cục bộ) hoặc đúng model của cha. Chuỗi `ngoai:…` ⇒ từ chối LÚC PHÂN TÍCH (mã `MODEL_NGOAI_CAM`). Cha đang dùng model ngoài ⇒ KHÔNG phơi `delegate` ở v1 (cổng ở host + lõi nhận cờ `choPhepGiaoViec` do host tính).
**M2 Thân tệp = CHỈ THỊ không tin cậy.** (a) Tin-lần-đầu theo BĂM: băm SHA-256 nội dung (đã chuẩn hoá EOL) lưu theo người×dự án (bảng nhỏ `ai_agent_def_trust`, mig 0441 cùng tệp hoặc 0442 nếu cắt T12 thì dùng 0442 cho bảng này); định nghĩa chưa từng được người này xác nhận ⇒ `delegate` trả lỗi `DINH_NGHIA_CHUA_TIN` + sự kiện cho UI hiện nội dung đầy đủ để người đọc & xác nhận (tRPC `xacNhanDinhNghia`); đổi nội dung ⇒ băm khác ⇒ hỏi lại. (b) chế độ hiệu lực của con = min(cha, `approval` khai); thiếu `approval` ⇒ `hoi`; con từ tệp repo KHÔNG BAO GIỜ `tu-dong` dù cha `tu-dong`. (c) tệp repo trùng tên agent dựng sẵn ⇒ bị bỏ + ghi cảnh báo; mọi sự kiện/UI mang nhãn nguồn bất biến `dungSan | tuRepo`. (d) `name` khớp `^[a-z][a-z0-9-]{0,31}$` VÀ bằng tên tệp; chặn `..`, symlink/junction, hoa-thường Windows (so sánh sau `realpath` + lowercase), trần số tệp (≤ 16) và kích thước (≤ 8 KB/tệp); `description` ≤ 200 ký tự, chỉ vào lời nhắc của cha trong khối UNTRUSTED; enum `agent` của schema do máy chủ dựng từ TÊN đã kiểm, không nhúng mô tả vào schema.
**M3 Phân tích front-matter an toàn.** Tự viết bộ phân tích GIỚI HẠN (`khoá: giá trị` + danh sách phẳng `- x` / `[a,b]`); không YAML đầy đủ ⇒ không anchor/alias/thẻ/`<<`; từ chối khoá lạ, trần độ sâu 1, trần số dòng/ký tự. Test độc: alias lồng (billion-laughs), `!!python`, khoá lặp, khoá lạ, thân khổng lồ, CRLF, BOM.
**M4 Huỷ cha ⇒ thẻ duyệt con.** Khi lượt cha huỷ/kết thúc: mọi `pending_action` còn `cho` của hậu duệ bị đóng (`bi-huy`) ngay; đường DUYỆT kiểm lại lúc duyệt: lượt sở hữu thẻ còn sống VÀ (nếu là con) tổ tiên còn sống VÀ thẻ thuộc lượt của chính người duyệt (`userId`); sai ⇒ từ chối, KHÔNG thực thi ghi/lệnh. Test hai tài khoản + duyệt-sau-huỷ.
**M5 Nhiễm hai chiều.** `nguonDangNgo`/`haTuTri` con phát hiện ⇒ HỢP lên cha (cha hạ tự trị cho phần còn lại). Tóm tắt con LUÔN bọc nhãn UNTRUSTED khi vào ngữ cảnh cha (không phụ thuộc quét bắt được hay không).
**M6 Trần khuếch đại.** Ngoài độ sâu: ≤ 4 con/lượt chạy cha, ≤ 2 `delegate` hợp lệ/lượt model, tổng lượt model của cây ≤ `soLuotToiDa` của cha (con ăn vào ngân sách cha, không cộng thêm), tổng token ra của cây ≤ `tokenRaToiDa` cha, tổng thời gian ≤ `msToiDa` cha. Vượt ⇒ lỗi CÓ MÃ (`GIAO_VIEC_QUA_TRAN_*`) trả model, không hạ âm thầm. Census AST: không `Promise.all`/`allSettled` bao quanh `delegate`.
**M7 Ép con ⊆ cha LÚC THỰC THI.** Mọi `tool_call` của con tra bộ tên của con trước khi gọi `boThucThi` (ngoài bộ ⇒ kết quả lỗi, không gọi). `delegate` do model bịa khi cờ `AI_AGENT_GIAO_VIEC` tắt hoặc ở độ sâu trần ⇒ bị từ chối như tool lạ; `tools?` tham số chỉ THU HẸP (giao với bộ cha ĐANG phơi, tính lúc thực thi chứ không tin schema).
**M8 Phiên hợp nhất.** (a) Mọi truy vấn lọc `kind` + `userId` (+ `projectId` với `coding`); kiểm khoá duy nhất/chỉ mục hiện có (userId×projectId) — nếu ràng buộc/`ON CONFLICT` cũ làm phiên chat/agent đè phiên coding thì đổi khoá thành (userId, kind, projectId, id). (b) `pinned_run_ids`, `run_id`, `parent_session_id` kiểm thuộc CHÍNH userId (+ cùng dự án) lúc GHI và lúc ĐỌC/join; test hai tài khoản cho cả ba cột + đột biến bỏ kiểm. (c) `appendTurns`: trần byte + số lượt, `expectedVersion` (cột `version int`; lệch ⇒ `CONFLICT`), `locLuot` giữ ở ghi VÀ đọc. (d) `delete` KHÔNG xoá `ai_agent_runs` (sổ kiểm toán; chỉ gỡ liên kết).
**M9 Provenance.** Kho phiên do CLIENT ghi ⇒ nạp `turns` làm lịch sử lượt agent máy chủ chỉ giữ vai `user`/`assistant` (đúng `locLichSu`); mọi kết quả công cụ/thẻ duyệt bị bỏ; nếu lượt agent về sau dùng model ngoài thì lịch sử phiên coi `van-hanh` + UNTRUSTED (cùng quy tắc 10.4b).
**NÊN (nhận hết):** N1 dải 0440–0442 (đã cấp). N2 id sự kiện con có tiền tố `con:<runIdCon>:`; con KHÔNG phát được `xong`/`da-duyet`/`ke-hoach` cho cha (lõi bọc `phat` của con, lọc loại sự kiện); token con cộng vào cha. N3 NOTES.md: tóm tắt do model sinh sau khi đọc dữ liệu không tin ⇒ quét + diff đầy đủ cho người duyệt + khi nạp lại làm `tepQuyUoc` gắn nhãn không tin. N4 `trangThaiHangCho` chỉ trả số, kiểm quyền người gọi, không id/người khác. N5 đột biến cha `hoi` mà con `sua`; con `tu-dong` khi cha đã `haTuTri`. N6 cờ đọc ở máy chủ, client không ghi được; tắt ⇒ không phơi, không nêu trong lời nhắc, `kiemThamSo` từ chối. N7 extension: host lọc 17 công cụ, không thực thi tool lạ (phơi `delegate` ở extension = lô luong-ui sau).
**Đột biến bổ sung vào §4:** nhiễm ngược con→cha · huỷ cha không đóng thẻ con · duyệt sau huỷ vẫn chạy · `ngoai:` trong định nghĩa/`delegate` · thiếu `approval` ⇒ không phải `hoi` · repo trùng tên dựng sẵn · tên `..`/symlink · YAML alias · vượt trần số con · tool ngoài bộ con được thực thi · `delegate` khi cờ tắt · ghim run/phiên cha của người khác · truy vấn thiếu `kind` · appendTurns không kiểm phiên bản · token con không cộng cha · con giả `xong` của cha · định nghĩa chưa tin vẫn chạy · băm đổi không hỏi lại.
**Tác động thứ tự:** T1 gồm M1–M3 (bộ phân tích + băm + tên); thêm T1b (bảng tin-cậy + xác nhận) sau T5. Tên migration: 0440 phiên hợp nhất, 0441 cha–con + `ai_agent_def_trust`, 0442 (T12, cắt được).
