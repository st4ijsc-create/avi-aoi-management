# Runbook — 8 công tắc lõi tác nhân Đợt 12 (harness học từ DeepSeek)

> Áp dụng từ 2026-10-31 · chủ: tho-ca-agent (mã) / do-model (A/B GPU) / dieu-phoi (vận hành) · kế hoạch: `docs/superpowers/specs/2026-10-31-harness-tho-ca-hoc-tu-deepseek.md`
> Dành cho: người vận hành và người bảo trì bật/tắt/kiểm các công tắc. Mọi công tắc đọc từ **môi trường tiến trình :3000** — đổi `.env` rồi **khởi động lại** (`npm start`).
> Không công tắc nào cần migration riêng (migration 0450 của `AI_AGENT_TIEP_TUC` đã áp DEV + `_test`). Mẫu ghi chú đầy đủ ở `.env.example` (mục "Đợt 12").

## Nguyên tắc chung

- **Vắng biến = hành vi cũ từng byte** (trừ `AI_AGENT_CUU_TRAN`, mặc định BẬT). Mỗi công tắc có test so byte yêu cầu gửi model.
- Chỉ **lượt GỐC phía máy chủ** (`/api/ai/agent/runs`, màn Thợ Cả); extension VSCode tự đứng không đọc các biến này. Agent con (`delegate`) chỉ hưởng khi nêu rõ ở từng mục.
- **Chưa có số đo GPU** cho 7 công tắc TẮT: đổi mặc định chỉ sau A/B trong cửa sổ GPU của do-model (agent-f + G6 không tụt, đo `cache_n`/`prompt_n` thật).
- Mỗi bước model của lượt gốc có sự kiện `buoc-do` trong sổ `ai_agent_runs.suKien` (băm system+tools, số tin, token ước lượng vs `vaoThat`, `cacheN`/`promptN`, `nen`, `nhacDaChen`, `cuuTran`) — nguồn chính để kiểm.

## Bảng nhanh

| Biến | Mặc định | Bật bằng | Làm gì (một dòng) |
|---|---|---|---|
| `AI_AGENT_CUU_TRAN` | **BẬT** | `0`/`false`/`off`/`no` = tắt | Tràn ngữ cảnh ⇒ nén mạnh + gọi lại một lần |
| `AI_AGENT_NEN_MOC` | tắt | số `0.3`–`0.65` (vd `0.5`) | Mỗi lần nén đi sâu tới mốc thấp ⇒ ít lần mất cache |
| `AI_AGENT_NEN_SO_THAT` | tắt | `1` | Quyết định nén bằng token THẬT của lượt trước |
| `AI_AGENT_DOC_TRUOC_KHI_GHI` | tắt | `1` | Không ghi/sửa tệp chưa đọc hoặc đã đổi từ lúc đọc |
| `AI_AGENT_TOOL_TIMEOUT` | tắt | `1` | Hạn giờ cho công cụ đọc/tìm |
| `AI_AGENT_CON_BAO_CAO` | tắt | `1` (cần `AI_AGENT_GIAO_VIEC=1`) | Agent con kết thúc bằng báo cáo có cấu trúc, đã kiểm |
| `AI_AGENT_DAU_RA_DAI` | tắt | `1` | Đầu ra tool dài lưu tệp riêng, đọc lại bằng `read_output` |
| `AI_AGENT_TIEP_TUC` | tắt | `1` | Lưu lịch sử mỗi bước + cho chủ lượt "tiếp tục" lượt gián đoạn |

## Từng công tắc

### 1. `AI_AGENT_CUU_TRAN` (H1.3) — mặc định BẬT
- **Làm gì:** llama-server trả "vượt cửa sổ ngữ cảnh" ⇒ lỗi mang mã `CONTEXT_OVERFLOW` (trước: `MODEL_LOI`, lượt chết). Lõi nén **mạnh** (bỏ mọi suy luận cũ, rút mọi kết quả tool trước bước cuối) rồi gọi lại **một** lần mỗi lượt, chỉ khi ước lượng thực sự giảm; vẫn tràn / không giảm được ⇒ dừng `loi-model` như cũ. Lỗi nạp model (`LLAMA_SERVER_DOWN`) không bị nhầm thành tràn.
- **Bật vì:** chỉ chạm đường trước đây lượt chết. **Tắt khi:** nghi nén mạnh làm model mất mạch (lượt cứu hay kết thúc `het-luot`).
- **Kiểm đang hiệu lực:** sự kiện `loi` mã `CONTEXT_OVERFLOW` kèm "compressing the context and retrying" rồi `buoc-do.cuuTran=true`; SQL ở mục "Kiểm bằng SQL" (cột `so_lan_cuu`).
- **Số đo:** test đầu–cuối (lượt hoàn thành sau 1 lần tràn); chưa có số GPU.

### 2. `AI_AGENT_NEN_MOC` (H1.1)
- **Làm gì:** khi lịch sử vượt 70 % ngân sách, nén tới `MOC` × ngân sách (thay vì chỉ vừa dưới 70 %). Ít lần sửa giữa lịch sử ⇒ ít lần mất cache tiền tố của llama.cpp. Ngoài khoảng `0.30–0.65` hoặc không phải số ⇒ bỏ qua (hành vi cũ).
- **Khi nào bật:** sau A/B (đề xuất `0.5`); lượt dài nhiều tool đọc lớn hưởng nhiều nhất. **Rủi ro:** model thấy ít kết quả cũ hơn ⇒ có thể đọc lại.
- **Kiểm:** `buoc-do.nen` khác `null` ít lần hơn (SQL `so_lan_nen`); `tokenSau` ≈ mốc × ngân sách. Đo thật: cột `cacheTokens`/`promptEvalTokens` (do-model).
- **Số đo (thước ngoại tuyến tất định, 64k × 80 bước, `vongAgent.thuocDoNen.test.ts`):** nén **68 → 17** lần; token phải xử lý lại **86 % → 26 %**.

### 3. `AI_AGENT_NEN_SO_THAT` (H1.2)
- **Làm gì:** ước lượng ngữ cảnh = `usage.vao + ra` của lượt trước (trừ suy luận nếu không giữ trong lịch sử) + ước lượng **chỉ phần thêm**; không có `usage` hợp lệ ⇒ bỏ neo, dùng ước lượng thuần (2,8 ký tự/token). Sửa việc ước lượng thuần bỏ sót system + schema công cụ (~3–4k token) và đếm thiếu mã/JSON/tiếng Việt.
- **Khi nào bật:** nếu `buoc-do` cho thấy `vaoThat` thường **lớn hơn** `tokenUoc` rõ rệt (nén trễ ⇒ nguy cơ tràn). Nên bật cùng `AI_AGENT_CUU_TRAN`.
- **Kiểm:** so `tokenUoc` với `vaoThat` trong `buoc-do`; với cờ bật, `nen.tokenTruoc` ≈ `vaoThat` + phần thêm.
- **Số đo (thước, hệ số token thật GIẢ ĐỊNH 1,4):** bước tràn cửa sổ **51/80 → 0/80**. Hệ số thật sẽ đọc từ `buoc-do` ở cửa sổ GPU.

### 4. `AI_AGENT_DOC_TRUOC_KHI_GHI` (H1.4)
- **Làm gì:** `write_file`/`edit_file` lên tệp **đã có** chỉ chạy khi lượt đã `read_file` tệp đó **và** nội dung đĩa không đổi từ lúc đọc (trừ bản chính lượt đề xuất). Từ chối: `CHUA_DOC_TEP` / `TEP_DA_DOI` kèm lời dặn đọc lại. Tạo tệp mới và sửa tiếp tệp vừa ghi không cần đọc lại. Bảo vệ chỉnh tay của người trong IDE (lớp riêng, bắt cả bản đã commit; hàng rào `FILE_DIRTY` cũ chỉ bắt thay đổi chưa commit).
- **Khi nào bật:** nhiều người sửa cùng repo trong lúc agent chạy. **Rủi ro:** thêm một bước `read_file` ở vài lượt (model nhỏ có thể lặp lỗi) ⇒ theo dõi G6/agent-f.
- **Kiểm:** `ket-qua-tool` có `ma` = `CHUA_DOC_TEP`/`TEP_DA_DOI` (SQL `so_ma`).
- **Số đo:** đột biến + test đĩa thật; chưa có số GPU.

### 5. `AI_AGENT_TOOL_TIMEOUT` (H1.5)
- **Làm gì:** hạn giờ mặc định cho công cụ **đọc/tìm**: `read_file` 15 s · `list_dir` 10 s · `find_files` 15 s · `grep` 30 s · `find_symbol` 15 s · `search_code` 60 s · `search_docs` 30 s · `lookup_api` 15 s ⇒ quá hạn trả `TOOL_TIMEOUT` (model tự thu hẹp truy vấn). Tool ghi/lệnh/`compile_st` không có hạn ở đây (chờ người duyệt không tính).
- **Khi nào bật:** thấy lượt kẹt lâu vì một tìm kiếm treo (chỉ mục đang dựng, truy hồi kẹt). **Rủi ro:** cắt nhầm tìm kiếm chậm-nhưng-sống (lần đầu `search_code` nạp mô hình nhúng).
- **Kiểm:** `ket-qua-tool.ma = TOOL_TIMEOUT` (SQL `so_ma`).
- **Số đo:** test thật; chưa có số GPU.

### 6. `AI_AGENT_CON_BAO_CAO` (H5.1) — cần `AI_AGENT_GIAO_VIEC=1`
- **Làm gì:** agent con kết thúc bằng công cụ `report` {status, summary, findings, files, evidence}; cha nhận **khối văn bản dựng từ báo cáo đã kiểm** (nhãn `[UNTRUSTED …]` cố định, không JSON thô, ≤ ~4000 ký tự). Mục ngoài tập đường con thực sự chạm ⇒ `[not touched by sub-agent]` (chỉ nghĩa "con không chạm tệp đó" — KHÔNG khẳng định trích dẫn đã được kiểm; kiểm trích dẫn thật còn trong backlog); `done` mà 0 bằng chứng từ tệp con chạm ⇒ `done (no evidence from files the sub-agent touched)`; đường có ký tự vô hình/đảo chiều bị loại; mọi chuỗi (kể cả đường) được quét câu dạng mệnh lệnh; `con-xong.trangThaiBaoCao` = done/partial/blocked (lyDo vẫn `hoan-thanh`). Byte model thấy đổi ⇒ chỉ khi cờ BẬT (mặc định TẮT); đường `..`/tuyệt đối bị loại; thẻ duyệt còn chờ của con bị đóng. `report` **không bao giờ** ở lượt gốc.
- **Khi nào bật:** khi đã dùng `delegate` và muốn cha nhận kết quả có cấu trúc thay chữ tự do 1500 ký tự.
- **Kiểm:** sự kiện `con-xong` có trường `baoCao` (SQL `so_con_bao_cao`); con không gọi `report` ⇒ cha thấy "(no structured report …)".
- **Số đo:** đột biến lõi/host; chưa có số GPU.

### 7. `AI_AGENT_DAU_RA_DAI` (H5.3)
- **Làm gì:** kết quả tool dài hơn 12 000 ký tự được lưu nguyên vẹn (đã che bí mật lần hai) ở thư mục tạm riêng **ngoài gốc dự án** (`<temp>/thoca-dau-ra/p<pid>-<t>-<nonce>/`); model thấy đầu+đuôi và mã `out-xxxxxxxx`, đọc phần cần bằng `read_output` (dòng/grep) thay vì chạy lại lệnh. Chỉ **chính lượt đó** đọc được (cha không đọc tệp con). Trần: 2 MB/tệp · 8 tệp & 16 MB/lượt · 64 MB tổng · TTL 2 giờ; dọn khi lượt/con xong; lúc khởi động quét thư mục của tiến trình khác khi nhịp `.nhip` im > 10 phút.
- **Windows:** mode `0o600`/`0o700` gần như vô hiệu; rào thật = ACL mặc định của thư mục temp tài khoản chạy máy chủ + tên không đoán được + model không thấy đường dẫn.
- **Khi nào bật:** lượt hay chạy test/build in nhiều ⇒ model chạy lại lệnh chỉ để xem phần giữa.
- **Kiểm:** kết quả tool có dòng `[full output saved as out-…]`; lời gọi `read_output` trong dòng thời gian; thư mục `thoca-dau-ra` có thư mục của tiến trình khi đang có lượt, **rỗng sau khi lượt xong**.
- **Số đo:** test đĩa thật + đột biến; chưa có số GPU.

### 8. `AI_AGENT_TIEP_TUC` (H5.4) — cần migration 0450 (đã áp)
- **Làm gì:** lượt GỐC lưu lịch sử gửi model (bỏ system, đã che bí mật, ≤ 400 tin/400 KB — vượt ⇒ xoá bản lưu) vào `ai_agent_run_lich_su` ở ranh giới an toàn (trước và sau tool). Thủ tục `aiAgent.tiepTucLuot({runId})` cho **chủ lượt** tạo lượt MỚI từ bản lưu của lượt `gian-doan`/`loi`/`huy`: tool dở nhận `[outcome unknown …]` (không tự chạy lại), kế hoạch đã duyệt và thẻ cũ KHÔNG mang sang, mỗi nguồn tiếp tục **một lần**. Lượt `xong` ⇒ xoá bản lưu; bản > 7 ngày bị dọn (tối đa mỗi giờ). Cột `tinNhan` bị ẩn khỏi vai MCP chỉ-đọc.
- **⚠ CHỈ bật SAU lô vá an toàn "không thừa hưởng tự trị" (đã có trong nhánh này):** lượt tiếp tục LUÔN chạy ở `sua` khi nguồn là `tu-dong` (mọi ghi/lệnh qua người duyệt; thủ tục trả `haTuDong:true` để UI nói rõ), và nhiễm của nguồn (sự kiện `ha-tu-tri`/`canh-bao-du-lieu` trong sổ ∪ cảnh báo nằm trong lịch sử đã lưu) được truyền vào lõi ⇒ nhãn "nguồn đáng ngờ" còn sống trên mọi thẻ duyệt. Không bật bản cũ hơn.
- **Khi nào bật:** muốn khôi phục lượt dài bị khởi động lại máy chủ/huỷ nhầm. **Lưu ý:** bản lưu chứa mã/câu hỏi người dùng (đã che bí mật) — cân nhắc chính sách lưu trữ.
- **Kiểm:** `SELECT count(*) FROM ai_agent_run_lich_su` tăng khi có lượt chạy; sau lượt `xong` hàng biến mất.
- **Số đo:** test DB thật (đua 8 lần bấm ⇒ 1 thắng, phạm vi chủ) + đột biến.

## Kiểm bằng SQL (DB `aoi_management`, đọc-chỉ; thay điều kiện lượt cho phù hợp)

```sql
-- số bước đo / số lần nén / số lần cứu tràn của lượt mới nhất
SELECT count(*) FILTER (WHERE e->'suKien'->>'loai' = 'buoc-do') AS so_buoc,
       count(*) FILTER (WHERE e->'suKien'->>'loai' = 'buoc-do' AND jsonb_typeof(e->'suKien'->'nen') = 'object') AS so_lan_nen,
       count(*) FILTER (WHERE e->'suKien'->>'loai' = 'buoc-do' AND (e->'suKien'->>'cuuTran') = 'true') AS so_lan_cuu
FROM ai_agent_runs r, jsonb_array_elements(r."suKien") e
WHERE r.id = (SELECT id FROM ai_agent_runs ORDER BY "createdAt" DESC LIMIT 1);

-- mã từ chối của H1.4 / H1.5
SELECT count(*) AS so_ma FROM ai_agent_runs r, jsonb_array_elements(r."suKien") e
WHERE e->'suKien'->>'loai' = 'ket-qua-tool' AND e->'suKien'->>'ma' IN ('CHUA_DOC_TEP','TEP_DA_DOI','TOOL_TIMEOUT');

-- agent con có báo cáo có cấu trúc
SELECT count(*) AS so_con_bao_cao FROM ai_agent_runs r, jsonb_array_elements(r."suKien") e
WHERE e->'suKien'->>'loai' = 'con-xong' AND e->'suKien' ? 'baoCao';

-- bản lưu tiếp tục đang giữ
SELECT count(*) AS so_ban_luu FROM ai_agent_run_lich_su;
```

(`ai_agent_runs.suKien` giữ tối đa 3 000 mục/lượt; riêng `buoc-do` được miễn cắt "giữa" với trần 400 bước.)

## Tắt khẩn

Đặt biến về giá trị tắt (bỏ biến, hoặc `0` cho `AI_AGENT_CUU_TRAN`) rồi khởi động lại. Không mất dữ liệu: `AI_AGENT_TIEP_TUC` tắt ⇒ bản lưu cũ nằm yên (dọn sau 7 ngày chỉ chạy khi cờ bật — xoá tay bằng `DELETE FROM ai_agent_run_lich_su` nếu cần); `AI_AGENT_DAU_RA_DAI` tắt ⇒ thư mục tạm của tiến trình hiện tại bị xoá khi tiến trình thoát; thư mục sót của tiến trình đã chết chỉ được quét lúc khởi động KHI cờ bật — xoá tay `<temp>/thoca-dau-ra` nếu cần.
