# AI Local — chọn model theo yêu cầu + kiểm định bởi AI bên ngoài + bài học (Đợt 10)

> Ngày: 2026-10-26 · Người viết: dieu-phoi · Trạng thái: **DUYỆT hướng** (chủ dự án trả lời Q1–Q4 cùng ngày) — mỗi phiên viết kế hoạch thực thi riêng, gửi dieu-phoi trước khi làm.
> Spec trước: `2026-10-20-ai-local-da-model-va-luong-tu-dong-design.md` (Đợt 7 đa model theo vai trò, Đợt 8 Luồng AI).

## 1. Yêu cầu của chủ dự án (nguyên ý)

1. Khi dùng AI Local, **chọn được model theo yêu cầu và ngữ cảnh**, ở mọi nơi gọi AI — đặc biệt trong AI Automation (Luồng, kiểu n8n): mỗi bước / mỗi yêu cầu chọn model hoặc nền tảng AI.
2. AI Local **kết hợp với các nền tảng AI khác qua tài khoản / API**. Khi AI Local làm xong, có thể yêu cầu AI mạnh hơn **kiểm định lại và chuẩn hoá**; AI Local **thu bài học** để nâng dần độ thông minh.

## 2. Quyết định của chủ dự án (2026-10-26)

| # | Câu hỏi | Trả lời |
|---|---|---|
| Q1 | Nhà cung cấp kết nối | Anthropic Claude · OpenAI · Google Gemini · endpoint tương thích OpenAI (tất cả) |
| Q2 | Dữ liệu ra ngoài | **Tự động trong Luồng được phép** (node Luồng tự gửi, không cần người bấm) — vẫn che dữ liệu nhạy cảm + trần chi phí |
| Q3 | Bài học | **AI ngoài đề xuất → người duyệt** mới thành bài học chung + câu kiểm thử; đo trước/sau |
| Q4 | Ô chọn model | Gồm cả model bên ngoài **khi admin đã bật** |

Ràng buộc giữ nguyên (không đổi bởi spec này): `AI_OT_CONTROL_ENABLED` TẮT; AI ngoài **không bao giờ** gửi lệnh tới thiết bị (chỉ đọc / trả lời / đề xuất); một llama-server 1×64k; tiêu chí ĐÚNG hơn NHANH; phạm vi nhà máy (ngoài phạm vi ≡ NOT_FOUND).

## 3. Hiện trạng (khảo sát 2026-10-26)

- **Định tuyến vai trò có sẵn** (`shared/aiRoles.ts`, `soModel/dinhTuyenVaiTro.ts`): flow > project > be-mat > tenant > global; khe nặng hoán đổi.
- **Ô chọn hiện có:** AICodingWorkspace chỉ `auto|code`; chat AI / bong bóng / lượt agent KHÔNG có; extension một cài đặt máy; Luồng có ô chữ tự do `vaiTro` trên 4 node `ai.*` (datalist 6 vai), `ai.agent` / `ai.sinh-ma` chỉ form JSON. **Lỗi:** `ai.agent` gọi `resolveLogicalModel(vaiTro)` bỏ phạm vi flow/be-mat + `khongDoiKhe` (`server/services/flow/nut/agent.ts:45`).
- **AI ngoài:** mã đám mây đã gỡ; bảng `aiApiKeys` (AES-GCM) không ai đọc; không có cờ dữ liệu ra; đường duy nhất hiện nay là node HTTP của Luồng (KHÔNG qua bộ che PII của cổng AI) ⇒ phải đóng đường vòng này cho đích là nhà cung cấp AI (§5.4).
- **Bài học:** `ai_coding_lessons` (theo người + dự án, ≤200, chèn vào user prompt); `ai_agent_feedback` xuất được nhưng không quay lại prompt; bộ vàng Studio chấm regex; không có pipeline fine-tune (G9 LoRA vẫn KHÔNG làm).

## 4. Phần A — Chọn model theo yêu cầu

**A1. Danh mục chọn được (máy chủ).** Thủ tục đọc `ai.danhMucModel` (không cần admin; cần `MOD_AI`) trả:
`[{ ma, loai: "auto" | "vai-tro" | "ho-so" | "ngoai", nhan, moTa, trangThai: "san-sang" | "can-doi-khe" | "tat", uocTinhDoiKheGiay?, nhaCungCap? }]`.
- `vai-tro`: 11 vai của `aiRoles`. `ho-so`: hồ sơ có ≥1 lượt đo + giấy phép rõ (cùng cổng `datGan`). `ngoai`: model của nhà cung cấp đã bật cho nhà máy người gọi (§5) — vắng nếu tắt.
- Không lộ đường dẫn tệp, cổng, khoá.

**A2. Một hợp đồng chọn cho mọi bề mặt.** Trường `chonModel?: string` (giá trị `ma` của A1; vắng / `auto` ⇒ hành vi hiện nay). Máy chủ:
- `vai-tro` ⇒ `dinhTuyenVaiTro({ vaiTro, phamVi, tinHieu })` như cũ (gán theo phạm vi vẫn thắng mặc định của vai).
- `ho-so` ⇒ dùng đúng hồ sơ đó (tầng 1 tường minh); không giữ khe ⇒ theo luật khe nặng hiện có (nền: chờ; tương tác: báo "cần đổi khe ~N s" và hỏi, không tự đổi khi khoá khe).
- `ngoai` ⇒ đi cổng AI ngoài (§5), không bao giờ đi llama-server.
- Giá trị lạ ⇒ `BAD_REQUEST` (không còn "chuỗi bất kỳ = tên GGUF").
- Mọi lượt ghi `vaiTro / model / nguon / nhaCungCap` vào vết như `ai.ts:70-92` hôm nay.

**A3. Bề mặt.** Ô chọn (Tự động · Vai trò · Hồ sơ Local · Model ngoài) trong: trang Chat AI + bong bóng, AICodingWorkspace (thay `auto|code`), lượt agent, extension VS Code (ô theo tin nhắn, mặc định = cài đặt hiện có), và **mọi node AI của Luồng** (`ai.llm/trich-xuat/phan-loai/tom-tat/agent/sinh-ma/tra-tri-thuc` + node mới §5.3) bằng dropdown từ A1 thay ô chữ tự do. Node Luồng lưu `chonModel` trong tham số (xuất/nhập giữa nhà máy: chỉ mang `ma`, không URL/khoá).

**A4. Sửa kèm:** `ai.agent` đi đúng phạm vi `{flowId, beMat:"luong"}` + `khongDoiKhe` như `ai.ts:45-47`; lệch cờ `vaiTroTacNhan` (chú thích nói TẮT, mã BẬT) — sửa chú thích theo mã.

## 5. Phần B — Cổng AI bên ngoài

**B1. Nhà cung cấp.** Một giao diện `NhaCungCapAi { goi(yeuCau): Promise<KetQua> }` với 4 bản cài: Anthropic (Messages API), OpenAI (Chat Completions/Responses), Gemini, OpenAI-compatible (URL tuỳ chọn). Không thêm SDK nặng nếu `fetch` đủ; nếu dùng SDK chính hãng thì ghim phiên bản. Model mặc định của mỗi nhà cung cấp là cấu hình, không cứng trong mã; với Anthropic dùng model mới nhất mà tài khoản có (hiện Claude Opus 5.5 / Sonnet 5.5).

**B2. Khoá và bật/tắt.**
- Khoá lưu ở `aiApiKeys` (AES-GCM có sẵn), theo **nhà máy**; chỉ admin tạo/xoay/thu hồi; không bao giờ trả khoá về client (chỉ 4 ký tự cuối).
- Cờ toàn hệ `AI_NGOAI_ENABLED` (mặc định TẮT) **và** bật theo nhà máy (bảng cấu hình, admin). Cả hai bật mới gọi được.
- Danh sách trắng host theo nhà cung cấp (api.anthropic.com, api.openai.com, generativelanguage.googleapis.com, URL khai cho loại tương thích), ghim IP như `mangAnToan.ts`.

**B3. Hàng rào dữ liệu ra (Q2 = tự động trong Luồng được phép).**
- MỌI lời gọi đi qua **bộ che** của cổng AI (PII, mật khẩu/khoá/token theo mẫu, IP nội bộ, email, số điện thoại, tên người dùng hệ thống) — che TRƯỚC khi rời máy, có test đột biến "bỏ che ⇒ đỏ".
- Phân loại nội dung theo nguồn: mã nguồn / câu hỏi kỹ thuật ⇒ cho phép; dữ liệu đo / sản xuất / thiết bị / khách hàng ⇒ cho phép **chỉ khi** nhà máy bật mục "dữ liệu vận hành" (mặc định TẮT, tách khỏi bật chung).
- Trần chi phí theo nhà máy / ngày / người dùng (token + ước tính tiền), vượt ⇒ từ chối rõ. Trần số lần gọi / phút.
- Sổ kiểm toán WORM `ai_external_calls` (nhà máy, người/luồng, nhà cung cấp, model, mục đích, số token, chi phí ước, băm nội dung đã che — không lưu nguyên văn trừ khi nhà máy bật lưu).
- Luồng: node gọi AI ngoài mang hạng `ngoai-ghi` (bật luồng cần quyền như node HTTP); chạy tự động không cần người bấm (Q2).

**B4. Đóng đường vòng.** Node HTTP / MCP của Luồng **từ chối** đích là host của nhà cung cấp AI đã biết (danh sách B2) — buộc đi cổng AI ngoài (có che + trần + sổ). Có test.

**B5. Node và nút.**
- Node Luồng mới `ai.kiem-dinh-ngoai`: đầu vào = câu hỏi gốc + câu trả lời / mã của AI Local (từ bước trước) + tiêu chí; đầu ra có cấu trúc `{ ketLuan: "dat" | "can-sua" | "sai", diem, banChuanHoa?, loi: [...], baiHocDeXuat: [{ noiDung, phamVi, viDu }] }` (JSON schema, kiểm hợp lệ, sai ⇒ lỗi rõ).
- Nút "Nhờ AI ngoài kiểm định" trên câu trả lời chat và trên diff của AICodingWorkspace / lượt agent (cùng hợp đồng, người bấm).
- Model ngoài chọn trực tiếp trong ô chọn A3 (Q4) — cùng hàng rào B3.

**B6. Bổ sung bắt buộc sau rà độc lập của kiem-dinh (2026-10-26, dieu-phoi duyệt nguyên khối):**
- **Bộ che hiện có KHÔNG đủ (đã đo):** `redactSecretsAndPII` (`aiSafety.ts:303`) không che JSON có khoá trong nháy, IP nội bộ, `user=`, MAC, tên khách; lách được bằng ký tự rộng-0 / chữ tách ⇒ bộ che MỚI duyệt cấu trúc JSON (che theo tên khoá + giá trị), chuẩn hoá NFKC + bỏ ký tự rộng-0; vector test gồm khoá mẫu đúng định dạng 4 nhà cung cấp; MỘT điểm che sau khi lắp xong toàn bộ yêu cầu (system, lịch sử, kết quả tool, schema, tên tệp); ảnh / tệp đính kèm cấm với model ngoài; che cả lời lỗi nhà cung cấp.
- **`aiApiKeys`** thiếu factoryId, enum thiếu anthropic/gemini, còn hàng mã hoá 'legacy' ⇒ factoryId NOT NULL, hàng cũ inactive / nhập lại.
- **Nhãn "dữ liệu vận hành" là taint theo item** truyền qua Set / Code / biểu thức `{{ }}` (mơ hồ ⇒ vận hành), không do node tự khai. `ai.agent` + model ngoài: phân loại từng lượt, loại MỌI tool ghi / điều khiển, phản hồi ngoài là UNTRUSTED với node sau.
- **Phạm vi:** khoá / cờ / trần theo nhà máy của CHỦ LUỒNG; luồng toàn cục ⇒ từ chối model ngoài; "auto" không bao giờ chọn model ngoài; kiểm cờ lúc GỌI; bật luồng có node ngoài ⇒ duyệt SoD + ghim phiên bản.
- **URL tương thích OpenAI:** https với host công cộng; nội bộ chỉ khi khai rõ host:cổng; metadata / link-local luôn cấm; chuẩn hoá hostname; vô hiệu proxy env; không theo chuyển hướng.
- **B4 chỉ là rào chống NHẦM**, không chống người có quyền sửa luồng: danh sách chặn mở rộng được (gồm aggregator + host tương thích đã khai), áp lúc lưu VÀ lúc gọi, gồm cả MCP / email / webhook.
- **Trần chi phí đặt-trước nguyên tử** (giữ chỗ rồi kết toán), retry vẫn tính, model không bảng giá ⇒ trần token / số lần, DB đếm hỏng ⇒ từ chối. Sổ WORM: hàng ý định TRƯỚC + hàng kết quả SAU; ghi sổ lỗi ⇒ không gọi.
- Thứ tự lô 10.3: bộ che + vector → cổng + sổ + trần (nhà cung cấp giả) → khoá / phạm vi → nhà cung cấp thật → B4.

## 6. Phần C — Bài học (Q3 = đề xuất → người duyệt)

**C1. Hàng chờ.** `baiHocDeXuat` của B5 vào bảng `ai_lesson_proposals` (nguồn: lượt kiểm định nào, nhà cung cấp, model; nội dung đã che; phạm vi đề xuất: người / dự án / **nhà máy**). Không bài nào tự áp dụng.

**C2. Duyệt.** Màn duyệt (kỹ sư AI / admin của nhà máy): sửa, chấp nhận, từ chối (lý do). Chấp nhận ⇒
- thành bài học (mở rộng `ai_coding_lessons` thêm phạm vi `nha-may` + loại `chung` ngoài lập trình, hoặc bảng anh em cùng hình — kế hoạch quyết, giữ ≤ N mỗi phạm vi, cùng bộ lọc rủi ro `codingLessonContext.ts:28-34`);
- **và** sinh một câu kiểm thử vào bộ vàng tương ứng (câu hỏi gốc + tiêu chí đạt từ `banChuanHoa`/`loi`).
- SoD: người tạo lượt kiểm định không tự duyệt bài học nhà máy của chính mình (trừ admin, có ghi).

**C3. Tiêm.** Dùng đường có sẵn `chonBaiHocChoPrompt` (user prompt, khối bọc, xếp hạng liên quan) cho mọi vai trò Local, không chỉ code; ngân sách token cố định (giữ "4k là điểm ngọt" của ngữ cảnh repo — bài học tính trong ngân sách).

**C4. Đo để chứng minh tiến bộ.** Mỗi bài học được duyệt gắn câu kiểm thử; lượt đo định kỳ (dùng khung `ai_model_eval_runs` / Studio) chạy bộ vàng CÓ và KHÔNG có bài học ⇒ báo tỉ lệ đạt trước/sau theo vai trò. Bài học không làm tăng điểm sau N lượt ⇒ đề xuất gỡ. Chấm bằng luật/regex như Studio; AI ngoài có thể chấm phụ nhưng KHÔNG là thước đo duy nhất.

**C5. Dữ liệu cho tương lai.** Cặp (câu hỏi, bản chuẩn hoá đã duyệt) xuất được (định dạng như `xuatBoDuLieu`) — chỉ lưu trữ, KHÔNG fine-tune ở đợt này.

## 7. Chia việc và thứ tự

| Lô | Nội dung | Phiên | Phụ thuộc |
|---|---|---|---|
| 10.1 | A1 danh mục + A2 hợp đồng `chonModel` + A4 sửa `ai.agent` | do-model (định tuyến) | — |
| 10.2 | A3 ô chọn ở chat / coding / agent / extension / mọi node Luồng | luong-ui | 10.1 |
| 10.3 | B1–B4 cổng AI ngoài (nhà cung cấp, khoá, cờ, che, trần, sổ WORM, đóng đường vòng) | do-model | — (song song 10.1) |
| 10.4 | B5 node `ai.kiem-dinh-ngoai` + nút kiểm định + model ngoài trong ô chọn | luong-ui | 10.2, 10.3 |
| 10.5 | C1–C5 hàng chờ, duyệt, tiêm, đo trước/sau | luong-ui (UI + Luồng) + do-model (đo) | 10.4 |
| — | Kiểm định độc lập mỗi lô (đặc biệt B3 che + B4 đường vòng + phạm vi nhà máy) | kiem-dinh | từng lô |

Migration: dải AI **0413–0416** (0407–0409 giữ cho do-model như cũ). SQL gửi dieu-phoi trước khi áp DEV.
Census: mọi thủ tục mới vào `phamViDocCensus` / `phamViGhiCensus` / `congGiayPhepAiCensus` (đo, có ngày); bảng mới có `factoryId` ⇒ phạm vi nhà máy.

## 8. Vận hành cần chủ dự án (sau khi mã sẵn sàng)

- Tạo khoá API cho từng nhà cung cấp trong màn quản trị (không qua `.env`, không gửi khoá qua phiên Claude nào).
- Bật `AI_NGOAI_ENABLED` + bật theo nhà máy; quyết riêng mục "dữ liệu vận hành" được ra ngoài hay không; đặt trần chi phí.

## 9. Giới hạn đã biết

- Che dữ liệu theo mẫu không bắt được mọi bí mật nghiệp vụ (tên dự án, công thức) — nhà máy chịu trách nhiệm bật "dữ liệu vận hành".
- Mức dữ liệu do CỔNG tự suy, người gọi không khai: nội dung do máy chủ ghép (ngữ cảnh KB, kết quả tool, số liệu, kết quả node) được phân loại tại điểm ghép; văn bản NGƯỜI DÙNG TỰ DÁN vào chat/lập trình và payload `kich-hoat.tay` do người chạy nhập được coi là `ky-thuat` — trách nhiệm của người dán/nhập (UI 10.4 ghi rõ khi chọn model ngoài). (Bổ sung 2026-10-26 theo rà kiem-dinh.)
- Taint theo LƯỢT, đơn điệu: một nhánh đọc dữ liệu vận hành làm CẢ lượt thành `van-hanh` (kể cả nhánh khác không dùng dữ liệu đó) — cái giá của việc `{{ }}` tham chiếu được mọi bước trước; ghi trong tài liệu node.
- Bộ che: đồng chữ ngoài bảng ánh xạ và tên vừa tạo trong 5 phút đệm có thể lọt — luật giá trị (định dạng khoá) vẫn bắt khoá thật.
- Kết luận của AI ngoài có thể sai ⇒ vì vậy bài học bắt buộc qua người duyệt và đo trước/sau.
- Chất lượng AI Local tăng nhờ bài học trong prompt có trần (ngân sách ngữ cảnh); tăng sâu hơn cần fine-tune — ngoài phạm vi (G9).
