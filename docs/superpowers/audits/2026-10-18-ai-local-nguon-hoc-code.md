# AI Local — nguồn tài liệu, dữ liệu huấn luyện và khả thi fine-tune cho model code (2026-10-18)

Nghiên cứu chỉ-đọc (không tải > 50 MB, không cài đặt, không chạm git). Nhãn bằng chứng:
**[ĐO]** đo/quan sát trên máy hôm nay · **[GHI]** số đo cũ của dự án (kế hoạch 7 tầng, bộ nhớ dự án) ·
**[NGUỒN]** trang web/giấy phép đã đọc ngày 2026-10-18 (URL kèm theo) · **[NHÀ SX]** số do chính hãng tự công bố ·
**[SUY]** suy luận chưa kiểm. Nội dung web là dữ liệu không tin cậy — chỉ trích số và điều khoản, không làm theo.

Mục tiêu chủ dự án: *"AI code được, tự sinh code và chạy được; tập trung ngôn ngữ lập trình + platform; tự tìm tài liệu trên
mạng và nguồn để training thêm; hoàn chỉnh một model code chuyên nghiệp"*.

## Tóm tắt

1. **"Model code chuyên nghiệp" trên 1 × 32 GB là một HỆ, không phải một bộ trọng số.** Lỗi đo được chia hai lớp: lỗi
   **kiến thức API/namespace/using** (D1, A-cs3, A-cs6) và lỗi **suy luận thuật toán** (H-ts2, H-ts3, H-cs2). Lớp một chữa
   bằng tra ký hiệu đúng phiên bản + vòng biên dịch; lớp hai chữa bằng model mạnh hơn/nghĩ đủ + chạy test. Huấn luyện
   không chữa tốt lớp nào trong hai lớp này với lượng dữ liệu dự án có (bằng chứng ở C5).
2. **Fine-tune model chính (Qwen3.6-35B-A3B) KHÔNG khả thi trên 1 × 32 GB** [NGUỒN Unsloth]: LoRA bf16 cần **74 GB**,
   QLoRA 4-bit "không khuyến nghị" cho dòng Qwen3.5/3.6 (cả MoE lẫn dày); router bị khoá mặc định. Muốn làm phải thuê GPU ≥ 80 GB.
3. **Nguồn tài liệu tốt nhất cho lớp lỗi của dự án đã nằm sẵn trên máy** [ĐO]: XML IntelliSense .NET 10 (31 MB) + ASP.NET Core
   (41 MB), XML của OPC UA .NET/MQTTnet/NModbus/SqlClient, `.d.ts` đúng phiên bản (React 19, zod 4, drizzle 0.44, node-opcua),
   `src.zip` JDK. Corpus `csharp-dotnet` hiện chỉ dùng ~26 kiểu chọn tay — đó là lý do A-cs6 (`SqlBulkCopyOptions`) trượt cả hai nhánh.
4. **Tài liệu web chính thức hầu hết dùng được cho RAG nội bộ** (MIT/PSF/BSD/PostgreSQL/CC-BY 4.0 kèm ghi nguồn; MDN CC-BY-SA).
   **Hạn chế**: tài liệu Java SE của Oracle, docset Dash/Zeal (Kapeli cấm), đặc tả OPC UA (thoả thuận v1.15 cấm lưu vào hệ truy hồi
   nếu không xin phép — dù chính site phát hành bản JSONL "cho RAG"), đặc tả Modbus (chưa kiểm được), trợ giúp CODESYS/Beckhoff.
5. **Dữ liệu huấn luyện công khai không có thứ dự án cần**: không có bộ C#/.NET, PLC/ST, PowerShell hay tiếng Việt nào dùng được.
   Bộ sạch giấy phép nhất là họ NVIDIA CC BY 4.0 (OpenCodeReasoning-2, Open-SWE-Traces, Nemotron-SWE-v1) — nhưng Qwen3.x gần như
   chắc đã ăn dữ liệu cùng loại [SUY].
6. **Thứ tự khuyến nghị** (mục D): ① chỉ mục ký hiệu từ tài liệu cục bộ + tra theo lỗi biên dịch (0 tải, S) → ② bộ đo API mới
   theo nền tảng của dự án viết TRƯỚC → ③ nạp tài liệu web chính thức theo miền, có cổng miền → ④ vòng sinh-dữ-liệu-có-kiểm
   (biên dịch/test) làm tài sản cho mọi bước sau → ⑤ thí nghiệm LoRA FIM 1,5B trên mã repo (rẻ, đo được) → ⑥ đo lại model mới
   (Qwen3.8-27B effort thấp, Muse Glimmer-30B) → ⑦ LoRA model chính chỉ khi cổng 5.5 đạt và thuê GPU.

## 0. Điểm xuất phát — số đo của chính dự án quyết định hướng đi

| Sự thật đã đo | Nguồn | Hệ quả cho câu hỏi "học thêm" |
|---|---|---|
| Trục H bộ khó 12 × 3: 27–30/36 (75–83 %), nhiễu ±3 | [GHI] kế hoạch §5 | Model nền đã mạnh; mọi cải tiến phải vượt nhiễu ±3 mới tính |
| Ba bài trượt ổn định tháng 9 (`H-ts2`, `H-ts3`, `H-cs2`) là lỗi **suy luận thuật toán** | [GHI] G9 audit 2026-09-21 | LoRA trên mã repo không chữa được loại lỗi này ⇒ G9 đóng |
| Lỗi D1 = thiếu `using System.Data;`, không phải sai API; truy hồi top‑K theo **câu hỏi** lấy 0/12 đoạn System.Data | [GHI] R1/R2B | Thứ model thiếu chỉ lộ trong **mã nháp** ⇒ truy hồi theo ký hiệu trong mã + bộ bổ sung using tất định (21→34/35 khối biên dịch) |
| Corpus `csharp-dotnet` A/B: tác dụng thật lặp lại ở **một** bài (A-cs3 `SqlDbType` 2/9 → 8/9); tổng thể 1/3 lượt "nâng"; corpus thiếu `SqlBulkCopyOptions` ⇒ A-cs6 trượt cả hai nhánh | [GHI] Đợt 5 | Tài liệu chỉ giúp khi **đúng miền + có đúng trang**; phủ thiếu = 0 tác dụng |
| Ngữ cảnh repo 0 / 4k / 8k ⇒ 75 / 86 / 75 % | [GHI] tiêu chí model | Nhồi nhiều hơn không tốt hơn; ngữ cảnh lạc hại |
| Bảng phản hồi `ai_agent_feedback` = 0 hàng | [GHI] Đợt 5 | Điều kiện mở LoRA 5.5 (≥ ~2.000 cặp duyệt) còn rất xa |

## 0b. Kiểm kê: tài liệu API ĐÃ NẰM SẴN trên máy (không cần tải) [ĐO]

| Nguồn cục bộ | Đường dẫn | Kích thước | Đang dùng? |
|---|---|---|---|
| XML IntelliSense .NET 10.0.10 (107 tệp) | `C:\Program Files\dotnet\packs\Microsoft.NETCore.App.Ref\10.0.10\ref\net10.0\*.xml` | 31 MB | Chỉ ~16 kiểu ADO.NET (`tao-tham-chieu-api-dotnet.mjs`) |
| XML ASP.NET Core 10.0.10 (247 tệp) | `…\Microsoft.AspNetCore.App.Ref\10.0.10\ref\net10.0\*.xml` | 41 MB | Không |
| WindowsDesktop.App.Ref, NETStandard.Library.Ref | `C:\Program Files\dotnet\packs\` | — | Không |
| Microsoft.Data.SqlClient 5.2.2 XML | `~\.nuget\packages\microsoft.data.sqlclient\5.2.2\lib\net8.0\` | 1,8 MB | ~10 kiểu |
| OPC UA .NET Standard 1.5.378 (Core/Client/Server/Types… XML) | `~\.nuget\packages\opcfoundation.netstandard.opc.ua.*\1.5.378.156\lib\net10.0\` | Core 2,1 MB | Không |
| MQTTnet 5.2 XML · NModbus 3.0.83 XML | `~\.nuget\packages\mqttnet\…`, `nmodbus\…` | 72 KB · 124 KB | Không |
| JDK 26.0.1 / 17 `lib\src.zip` (nguồn kèm javadoc) | `C:\Program Files\Java\jdk-26.0.1\lib\src.zip` | 46 MB nén | Không |
| TypeScript 5.9.3 `lib.*.d.ts` (102 tệp) + `@types/node`, `@types/react` | `node_modules\typescript\lib`, `node_modules\@types\*` | 23 MB + 2,6 MB | Không (chỉ qua chỉ mục repo) |
| `.d.ts` thư viện dự án đúng phiên bản: React 19.2, zod 4.3, drizzle-orm 0.44, express 4.22, node-opcua 2.173, mqtt 5.15, modbus-serial | `node_modules\…` | vài MB mỗi gói | Không |
| Dự án C# dùng đúng các gói OPC UA/MQTT/Modbus | `tools/machine-simulator/src/St4i.EdgeCore/St4i.EdgeCore.csproj` | — | — |

Ý nghĩa: lớp lỗi đo được (sai namespace/API, thiếu using) cần **tài liệu tham chiếu ký hiệu đúng PHIÊN BẢN đang cài**.
Nguồn tốt nhất cho việc đó không ở trên mạng mà ở chính máy: XML IntelliSense, `.d.ts`, `src.zip` — đúng phiên bản
từng byte, giấy phép đi kèm gói đã được dự án chấp nhận khi cài. Đây là bằng chứng [ĐO] cho kích thước/vị trí; việc
nó giúp được bao nhiêu là [SUY] cho tới khi đo A/B.

## A. Tài liệu cho RAG theo ngôn ngữ / platform [NGUỒN — đọc 2026-10-18]

Kích thước: "repo" = trường `size` của GitHub API (gồm lịch sử git, không phải thứ cần nạp); "thư mục docs" = nội dung đo qua
trees API. Phần lớn chỉ cần **sparse checkout** thư mục tài liệu, không cần cả repo. Phán quyết = dùng làm bản sao nội bộ +
ngữ cảnh RAG, KHÔNG phát hành lại ra ngoài.

### A1. Ngôn ngữ và nền tảng

| Nguồn | URL | Giấy phép → phán quyết RAG nội bộ | Định dạng | Cỡ | Cập nhật |
|---|---|---|---|---|---|
| **.NET ref pack (IntelliSense XML)** | nuget.org `Microsoft.NETCore.App.Ref`, `Microsoft.AspNetCore.App.Ref` (đã có trên máy) | MIT (nuspec) → **OK** | XML doc theo ID (`T:System.Data.DataTable`) | 7,3 MB nupkg · 31,8 MB XML (109 tệp) | theo bản vá .NET (đã tự cập nhật cùng SDK) |
| **.NET API reference đầy đủ** | github.com/dotnet/dotnet-api-docs `xml/` | CC BY 4.0 + MIT cho mã → **OK, ghi nguồn** | ECMA XML, mỗi kiểu một tệp, có namespace + assembly + ví dụ | xml/ 699 MB, 13.707 tệp (lọc theo namespace dùng thật) | git pull |
| .NET khái niệm · ASP.NET Core | github.com/dotnet/docs · dotnet/AspNetCore.Docs | CC BY 4.0 / MIT → **OK, ghi nguồn** | Markdown | repo 1,01 GB · 869 MB | git pull (sparse) |
| Python | github.com/python/cpython `Doc/`; docs.python.org/3/archives/ | PSF License v2 (mã trong tài liệu: 0BSD) → **OK** (giữ ghi chú bản quyền) | reST; zip HTML/text | Doc/ 27,4 MB · zip HTML 24 MB | sparse pull / archive theo bản |
| MDN (JS, Web API) | github.com/mdn/content `files/en-us` | Văn: CC BY-SA 2.5; mã từ 2010-08-20: CC0 → **OK, ghi nguồn** (share-alike chỉ ràng buộc khi phát hành lại) | Markdown | 108,8 MB, 16.209 tệp | sparse pull |
| Node.js API | github.com/nodejs/node `doc/api` | MIT → **OK** | Markdown | 4,8 MB, 70 tệp | sparse theo tag phát hành |
| TypeScript handbook | github.com/microsoft/TypeScript-Website `packages/documentation` | CC BY 4.0 / MIT → **OK, ghi nguồn**; DefinitelyTyped MIT | Markdown | repo 260 MB | git pull |
| React | github.com/reactjs/react.dev `src/content` | CC BY 4.0 → **OK, ghi nguồn** | MDX | repo 198 MB | git pull |
| Java — OpenJDK | `src.zip` trong JDK (đã có trên máy); github.com/openjdk/jdk | GPL-2.0 + Classpath Exception; dùng nội bộ không phát sinh nghĩa vụ phân phối → **OK có lưu ý** | Java + javadoc trong chú thích | src.zip 46 MB | theo bản JDK |
| Java — Oracle API docs | docs.oracle.com/en/java/javase | Spec license: chỉ "internal evaluation", không quyền sửa → **HẠN CHẾ** (cắt đoạn + nhúng vector có thể coi là sửa) | HTML | — | — |
| C++ — cppreference | github.com/PeterFeicht/cppreference-doc/releases (bản fork v20250209) | CC BY-SA 3.0 + GFDL [chưa kiểm — trang bản quyền 404] → **OK, ghi nguồn** | HTML | tar.xz 6,65 MB | bản lưu chính thức dừng 2019 |
| C++ — Microsoft | github.com/MicrosoftDocs/cpp-docs | CC BY 4.0 / MIT → **OK, ghi nguồn** | Markdown | repo 418 MB | git pull |
| Go | github.com/golang/go (doc comment trong `src`), golang/website; `go doc -all` | BSD-3 → **OK** | doc comment; Markdown | src 136 MB (đa phần mã) | git pull |
| Rust | github.com/rust-lang/book `src`; `rustup component add rust-docs` | MIT / Apache-2.0 → **OK** | Markdown; HTML ngoại tuyến | book 72 MB | git pull / rustup |
| T-SQL | github.com/MicrosoftDocs/sql-docs (nhánh `live`) `docs/t-sql` | CC BY 4.0 / MIT → **OK, ghi nguồn** | Markdown | repo 1,35 GB (sparse `docs/t-sql`) | sparse pull |
| PostgreSQL | github.com/postgres/postgres `doc/src/sgml` | PostgreSQL License (nói rõ phủ "documentation") → **OK** | DocBook SGML | 12,7 MB, 482 tệp | pull theo nhánh REL |
| PowerShell | github.com/MicrosoftDocs/PowerShell-Docs `reference/` | CC BY 4.0 / MIT → **OK, ghi nguồn** | Markdown | 56,4 MB, 3.206 tệp | git pull |
| DevDocs (bộ chuẩn hoá) | github.com/freeCodeCamp/devdocs | Ứng dụng MPL-2.0; mỗi bộ tài liệu giữ giấy phép riêng | HTML chuẩn hoá + chỉ mục JSON | repo 34 MB | — tiện nhưng khó truy giấy phép ngược ⇒ không ưu tiên |
| Dash/Zeal docset | github.com/Kapeli/feeds | Kapeli cấm dùng docset trong ứng dụng bên thứ ba → **KHÔNG DÙNG** | — | — | — |

### A2. Tự động hoá công nghiệp

| Nguồn | URL | Giấy phép → phán quyết | Ghi chú |
|---|---|---|---|
| Đặc tả OPC UA | reference.opcfoundation.org (+ `/ai-help`: Markdown, **JSONL cắt sẵn cho RAG**, máy chủ MCP `/mcp`) | Trang ai-help ghi "Best for: loading into a vector database, building a local RAG pipeline" nhưng **không ghi điều khoản**; thoả thuận đặc tả v1.15 chỉ cho sao chép nội bộ "để triển khai" và cấm lưu vào "information storage and retrieval systems" khi chưa xin phép → **HẠN CHẾ cho tới khi OPC Foundation xác nhận bằng văn bản** | Mâu thuẫn trong chính nguồn — hỏi trước, đừng suy ra quyền |
| SDK OPC UA | OPCFoundation/UA-.NETStandard (MIT 1.00) · open62541 (MPL-2.0) · node-opcua (MIT) | **OK** | XML doc của gói .NET đã có trên máy (Core 2,1 MB) |
| MQTT 3.1.1 / 5.0 | docs.oasis-open.org/mqtt/mqtt/v5.0/os/mqtt-v5.0-os.html | Thông báo OASIS: được sao chép, tác phẩm phái sinh giải thích được phép nếu giữ thông báo; không sửa văn bản → **OK, giữ nguyên văn + thông báo** | 1,4 MB HTML |
| Mosquitto / Paho | eclipse-mosquitto, eclipse-paho | EPL-2.0 hoặc BSD-3 (EDL) → **OK** | — |
| MQTTnet · NModbus · modbus-serial · mqtt.js | gói đã cài | theo giấy phép gói (MIT) [SUY — chưa đọc từng LICENSE] | XML/`.d.ts` có trên máy |
| Đặc tả Modbus | modbus.org/modbus-specifications | PDF sau trang click-through, **điều khoản chưa kiểm được** → coi là HẠN CHẾ | Giao thức miễn phí bản quyền ≠ được sao chép tài liệu |
| IEC 61131-3 / ST | chuẩn IEC (trả phí); trợ giúp CODESYS, Beckhoff InfoSys | Không thấy điều khoản tái sử dụng → **HẠN CHẾ** | Đường sạch: OpenPLC_v3 (GPL-3.0) làm mã mẫu + **tự viết thẻ tham chiếu ST nội bộ** (dự án đã có OpenPLC bench) |

### A3. Bài học thiết kế RAG rút từ số đo dự án + tài liệu
- **Truy hồi theo CÂU HỎI không tìm ra thứ model thiếu** [GHI: D1 0/12 đoạn System.Data]. Tài liệu ngoài khớp: De-Hallucinator
  (Eghbali & Pradel, arXiv 2401.01701 v3, 2024-06-19) truy hồi tham chiếu API **từ bản nháp của model**, lặp lại — recall dùng
  API đúng +23,9–61,0 %, sửa thêm 63,2 % test hỏng vì bịa API [NGUỒN]. CodeRAG-Bench (Wang và cs., NAACL Findings 2025):
  truy hồi giúp nhưng có giới hạn — bộ truy hồi khó lấy đúng ngữ cảnh khi ít trùng từ vựng, bộ sinh dùng ngữ cảnh chưa tốt [NGUỒN].
  DocPrompting (ICLR 2023): tài liệu giúp với hàm/thư viện **chưa thấy** khi huấn luyện, cập nhật kho không cần huấn luyện lại [NGUỒN].
- ⇒ Tra theo **ký hiệu chính xác** (tên kiểu/thành viên lấy từ mã nháp hoặc thông báo lỗi biên dịch) bằng chỉ mục khoá-giá trị,
  không qua ngưỡng cosine — tránh hẳn vấn đề hai cụm điểm chồng nhau (ngưỡng 0,44) [SUY dựa trên GHI].
- **Đúng PHIÊN BẢN quan trọng hơn đủ rộng** [SUY]: model biết zod 3 / React 18 / .NET 6 từ dữ liệu huấn luyện; dự án chạy zod 4.3,
  React 19.2, .NET 10. Tài liệu sinh từ gói đang cài đúng phiên bản theo định nghĩa.
- **Cổng miền bắt buộc** [GHI]: corpus lạc đề làm tụt (A/B corpus "hại 1 bài"; ngữ cảnh 8k < 4k). Mỗi corpus gắn ngôn ngữ/nền tảng,
  chỉ bật khi tác vụ thuộc miền đó.

## B. Dữ liệu huấn luyện code (SFT / suy luận / sửa lỗi / agentic) [NGUỒN — thẻ dataset Hugging Face đọc 2026-10-18]

Giấy phép dưới đây là điều khoản ghi trên thẻ dataset, không phải tư vấn pháp lý. "Sinh bởi GPT/Claude" = dù thẻ ghi
MIT/Apache, dữ liệu vẫn kéo theo điều khoản dịch vụ của nhà cung cấp model sinh ra nó (cấm dùng để huấn luyện model cạnh tranh).

### B1. An toàn nhất cho dùng nội bộ có tính thương mại

| Dataset (huggingface.co/datasets/…) | Giấy phép | Cỡ | Ngôn ngữ | Loại | Ghi chú chất lượng |
|---|---|---|---|---|---|
| `nvidia/OpenCodeReasoning-2` | CC BY 4.0 | 2,5 M mẫu / 49 GB | Python 1,4 M · C++ 1,17 M | vết suy luận R1 + phê bình QwQ | khử nhiễm test CodeContests/Codeforces |
| `nvidia/OpenCodeReasoning` | CC BY 4.0 (kiểm thêm giấy phép nguồn đề TACO/APPS/CodeContests) | 735 K / 28 K đề | Python | vết suy luận | — |
| `nvidia/OpenCodeInstruct` | CC BY 4.0, thẻ ghi "commercial" | ~5 M / 6,4 GB | chủ yếu Python | chỉ dẫn | arXiv 2504.04030 |
| `nvidia/Open-SWE-Traces` (v1.0 06/2026 → v1.2 09/2026) | CC BY 4.0 (+ MIT/Apache/BSD thành phần), "ready for commercial use" | 677.813 hàng / 61,9 GB | 9 ngôn ngữ (Python, Go, Java, TS, PHP…; C# chưa xác nhận) | quỹ đạo agent (OpenHands/SWE-agent) | sinh bởi MiniMax, Qwen3.6-27B, Qwen3.8-27B, DeepSeek-V4-Flash; đã lọc vết "hack git" |
| `nvidia/Nemotron-SWE-v1` | CC BY 4.0 (+ một phần BSD-3), "commercial" | 59 K / 11 GB | Python | quỹ đạo OpenHands (Qwen3-Coder-480B) | đề từ SWE-Gym, R2E-Gym |
| `microsoft/rStar-Coder` | CC BY 4.0 | 418 K đề / 473 GB | Python | suy luận + test | Qwen2.5-7B LiveCodeBench 17,4 → 57,3 % (theo thẻ) |
| `open-thoughts/OpenThoughts3-1.2M` | Apache-2.0 | 250 K phần code | Python | vết QwQ-32B | OpenThinker3-7B LCB 51,7 |
| `inclusionAI/Ling-Coder-SFT` | Apache-2.0 | 4,5–5 M / 6,3 GB | 20+ ngôn ngữ, EN/ZH | chỉ dẫn | đã khử nhiễm |
| `OpenCoder-LLM/opc-sft-stage2` | MIT (stage2 dùng lại Magicoder-Evol ⇒ có phần GPT-4) | 436 K / 0,5 GB | đa, nặng Python | chỉ dẫn | tập con giáo dục kiểm bằng trình biên dịch/test |
| `bigcode/self-oss-instruct-sc2-exec-filter-50k` | ODC-BY | 50,7 K / 90 MB | Python | chỉ dẫn tự sinh (StarCoder2) | **lọc bằng thực thi** — đúng tinh thần "chạy được" |
| `nebius/SWE-rebench-V2` | CC BY 4.0 + giấy phép từng repo | 32.079 tác vụ | 20 ngôn ngữ **có C#, TS, JS, Java, Go, Rust, C++** | môi trường chạy được (cho RL/đo) | thẻ cảnh báo: chỉ loại repo SWE-bench, chưa lọc benchmark khác |
| `R2E-Gym/R2E-Gym-Subset` · `SWE-Gym/SWE-Gym` (tác vụ) | Apache-2.0 · MIT | 4.578 · 2.438 | Python | môi trường | quỹ đạo OpenHands kèm SWE-Gym: KHÔNG giấy phép, gpt-4o sinh ⇒ tránh |
| `gretelai/synthetic_text_to_sql` · `b-mc2/sql-create-context` | Apache-2.0 · CC BY 4.0 | 106 K · 78,6 K | SQL (không rõ phương ngữ) | text-to-SQL | không phải T-SQL/PostgreSQL riêng |
| `bigcode/commitpackft` | giấy phép **theo từng mẫu** (13 loại, có agpl-3.0, lgpl-2.1, "unknown") | 702.062 / 1,58 GB | **C# 9.346** · TS 5.868 · SQL 2.069 · PowerShell 991 · Python 56.025 | commit = chỉ dẫn + diff, do người viết | phải lọc bỏ agpl/lgpl/unknown trước khi dùng |

### B2. Tránh hoặc phải gắn cờ
- **KodCode-V1 / -SFT-R1**: CC BY-NC 4.0 — **phi thương mại**.
- Gắn MIT/Apache nhưng là **đầu ra OpenAI**: Magicoder-OSS-Instruct-75K (gpt-3.5), Magicoder-Evol-Instruct-110K /
  evol-codealpaca-v1 (GPT-4), m-a-p/Code-Feedback, CodeFeedback-Filtered-Instruction.
- Quỹ đạo SWE-smith (Claude 3.7 Sonnet sinh) · quỹ đạo OpenHands của SWE-Gym (gpt-4o, không giấy phép).
- Llama-Nemotron-Post-Training, nebius/SWE-agent-trajectories: kéo nghĩa vụ giấy phép Llama.
- `bigcode/the-stack-v2`: gated, tải hàng loạt cần thoả thuận Software Heritage, phải tôn trọng yêu cầu rút (opt-out) ⇒ không thực tế cho LoRA nhỏ.

### B3. Khoảng trống (không có dữ liệu công khai đáng dùng)
- **C#/.NET**: không có bộ chỉ dẫn C# công khai nào nhắm lớp lỗi "sai namespace/API, thiếu using" — các bộ trên HF quá nhỏ
  (vài trăm hàng) hoặc không giấy phép. commitpackft có 9,3 K commit C# (người viết, giấy phép trộn).
- **Tiếng Việt**: không có bộ code-instruction tiếng Việt có giấy phép + kiểm chất lượng; ứng viên duy nhất
  (`PeterPaker123/vietnamese-code-dataset`, 8,9 K) không giấy phép và có đáp án sai nhìn thấy được.
- **PLC/ST (IEC 61131-3), PowerShell**: không tìm thấy bộ chỉ dẫn được tuyển + có giấy phép. Agents4PLC/LLM4PLC không phát hành
  dữ liệu có giấy phép rõ.
- **Suy luận [SUY]**: Qwen3.x gần như chắc đã được huấn luyện trên dữ liệu chưng cất cùng loại (R1/QwQ, SWE traces) ⇒ LoRA nhỏ
  trên các bộ công khai khó thêm gì và có thể làm tụt; nếu làm phải đo trên bài giữ lại trước/sau.
- ⇒ Con đường sạch nhất cho lớp lỗi C# của dự án: **tự sinh cặp có kiểm biên dịch** (model cục bộ viết → `dotnet build`/test làm
  bộ chấm → giữ cái qua; ghi lại cặp sửa "CS0246/CS1061 → thêm `using X;`/đổi API"). Dữ liệu do mình sở hữu, đúng phiên bản .NET 10.

## C. Khả thi fine-tune trên 1 × RTX 5090 32 GB

### C1. MoE 30–35B-A3B (model chính và Qwen3-Coder-30B)
| Sự kiện | Số | Nguồn |
|---|---|---|
| Qwen3.5-35B-A3B LoRA bf16 | **74 GB VRAM** (27B dày: 56 GB; 9B: 22 GB) | [NGUỒN] unsloth.ai/docs/models/qwen3.5/fine-tune (không ghi ngày; đọc 2026-10-18) |
| QLoRA 4-bit Qwen3.5 | "not recommended … no matter MoE or dense"; MoE QLoRA vướng giới hạn bitsandbytes | cùng trang |
| Qwen3.6 | không có hướng dẫn riêng, trỏ về hướng dẫn Qwen3.5 | unsloth.ai/docs/models/qwen3.6 |
| Router | "Router-layer fine-tuning is disabled by default for stability" | cùng trang; unsloth.ai/docs/basics/faster-moe (2026-02) |
| Qwen3-30B-A3B QLoRA (thế hệ 2025) | 17,5 GB, max_seq 2.048 | unsloth.ai/blog/qwen3 (2025-05-02) — cùng hãng nay khuyên không QLoRA MoE |
| Blackwell / RTX 50 | hỗ trợ qua CUDA ≥ 12.8 + torch cu128; Windows khuyến nghị Docker, WSL2 chạy được | hướng dẫn Blackwell + cài Windows của Unsloth |

**Kết luận C1:** LoRA model chính trên máy này = **không khả thi** theo chính nhà cung cấp công cụ. QLoRA Qwen3-Coder-30B có thể
vừa 32 GB nhưng (a) trái khuyến nghị, (b) chưa có số đo 2026 trên 5090, (c) nó là model yếu hơn hẳn trên bộ đo dự án
(31 % vs 83 % [GHI]) — huấn luyện để đuổi model đang có là sai hướng. Nếu cổng 5.5 đạt: thuê 1 GPU ≥ 80 GB (H100/A100 80 GB)
cho LoRA bf16, mang adapter về.

### C2. Model dày 7–14B coder
QLoRA tối thiểu (Unsloth): 8B ≈ 6 GB, 14B ≈ 8,5 GB, 32B ≈ 26 GB; 8B rank 32 vừa ~78k ngữ cảnh trên 24 GB [NGUỒN
docs.unsloth.ai requirements/benchmarks]. Qwen2.5-Coder-14B QLoRA trên 32 GB với ngữ cảnh 16–32k là thoải mái [SUY]; vài nghìn
mẫu × 1–3 epoch cỡ giờ chứ không phải ngày [SUY]. **Nhưng** một 14B dày đã tinh chỉnh khó vượt Qwen3.6-35B-A3B nghĩ 12k trên
bộ H — không có kịch bản nào trong dự án cần model thứ ba cỡ này (Q5: giữ 1 server) ⇒ không khuyến nghị.

### C3. FIM 1,5B trên mã của chính repo — thí nghiệm huấn luyện duy nhất đáng làm sớm
- Bằng chứng ngoài: Sourcegraph (arXiv 2412.16589, 12/2024) tinh chỉnh model hoàn thành mã với ví dụ khó + ngữ cảnh: lợi lớn hơn
  ở model nhỏ, A/B trực tuyến tăng tỉ lệ chấp nhận, không thêm trễ (tóm tắt không cho số) [NGUỒN]. Code2LoRA (06/2026): LoRA theo
  repo đạt 63,8–66,2 % khớp chính xác hoàn thành assertion [NGUỒN — trang tổng hợp, chưa đọc bản gốc]. Capstone Berkeley 2023
  (Refact + CodeLlama trên mã công ty): có lợi nhưng điểm hữu ích trung vị 3/7 [NGUỒN]. Không tìm thấy số đo công khai của
  Tabby/Continue/JetBrains.
- Phù hợp dự án: model nhỏ (1,6 GB q8), VRAM huấn luyện vài GB, rủi ro thấp (chỉ ghost-text), **đã có thước** `scripts/ai-eval/fim`
  (nền: dòng đầu đúng 43,8 % base vs 37,5 % Instruct, p50 142 ms [GHI]). Quy ước dự án (tên tiếng Việt không dấu, `phamViTuyen`,
  drizzle `inArray()`…) đúng là loại tri thức LoRA dạy được — khác G9 (lỗi thuật toán) [SUY].
- Cách đo đúng: tách theo THỜI GIAN (huấn luyện trên mã tới commit X, đo trên tệp/đoạn thay đổi SAU X) để không rò; mẫu FIM ở
  `chamFim.ts`; báo cả dòng đầu đúng + khớp chính xác + p50.

### C4. Phục vụ LoRA bằng llama.cpp
- Máy có b9814: `--lora`, `--lora-scaled` [ĐO]. Bản master còn `--lora-init-without-apply`, `GET/POST /lora-adapters`, chọn
  adapter theo request; **request khác cấu hình LoRA không được gộp batch** [NGUỒN README server].
- `convert_lora_to_gguf.py` hỗ trợ adapter MoE từ PR #8332 (2024) [NGUỒN]; adapter chỉ nạp trên ĐÚNG model gốc đã huấn luyện;
  có báo cáo bên thứ ba bộ chuyển cũ gán sai kiến trúc `qwen35` → `qwen3` [chưa kiểm]. Không tìm thấy báo cáo LoRA Qwen3-MoE chạy
  trọn đầu-cuối [chưa kiểm].
- An toàn hơn: gộp adapter (HF) → `convert_hf_to_gguf` → `llama-quantize` (có trên máy [ĐO]); kiểm lại chat template/EOS sau xuất.
  Rollback = giữ GGUF cũ, đổi model qua API Đợt 6 (đã có `/props` + sinh thử).

### C5. Rủi ro và bằng chứng "huấn luyện kiến thức vs truy hồi"
- **Fine-tuning or Retrieval?** (Ovadia và cs., EMNLP 2024, arXiv 2312.05934): RAG thắng fine-tune không giám sát cả với kiến thức
  cũ lẫn mới; fine-tune chỉ "ngấm" một sự kiện khi thấy nhiều cách diễn đạt của nó [NGUỒN].
- **CodeUpdateArena** (Liu và cs., arXiv 2407.06249, 2024): tinh chỉnh trên docstring API mới gần như không giúp; tinh chỉnh trên
  **ví dụ chương trình dùng API mới** hiệu quả hơn [NGUỒN — qua bản tóm tắt, chưa đọc bảng số gốc].
- **LoRA Learns Less and Forgets Less** (Biderman và cs., TMLR 2024): LoRA học ít hơn full fine-tune nhưng quên ít hơn; với
  instruction-tuning code đánh đổi tốt hơn [NGUỒN].
- Router MoE: huấn luyện router không kèm loss cân bằng có thể sụp về một expert ⇒ công cụ khoá router [NGUỒN].
- Dữ liệu nhỏ (2–10k) dễ quá khớp ⇒ bộ giữ lại phải viết TRƯỚC khi huấn luyện (luật dự án).
- ⇒ Với lớp lỗi API: **truy hồi đúng ký hiệu > huấn luyện**. Nếu sau này có LoRA, dữ liệu phải là cặp *chương trình dùng API đã
  biên dịch/test qua*, không phải văn bản tài liệu.

### C6. Phương án không cần huấn luyện — model mới (tính tới 10/2026)
Gần như toàn bộ là số **[NHÀ SX]**; chênh ≤ 4 điểm nằm trong sai khác giữa các harness.

| Model | Loại · Q4 | SWE-bench Verified | Khác | Giấy phép · ngày | Ghi chú cho dự án |
|---|---|---|---|---|---|
| Qwen3.6-35B-A3B (đang dùng) | MoE 3B active · 22,4 GB [ĐO] | 73,4 [NHÀ SX] / 70,1 (harness NVIDIA, chưa mở được bảng) | TB2.0 51,5 · LCB 80,4 | Apache-2.0 · 04/2026 | H 83–86 % [GHI]; ctx 64k vừa VRAM |
| Qwen3.8-27B | dày + MTP · Q4_K_M ≈ 17 GB | chưa công bố | SWE-Pro 61,7 · TB2.1 73,0 · LCB v6 90,3 | Apache-2.0 · 2026-08-14 | **Dự án ĐÃ đo** [GHI 2026-09-22]: nghĩ BẬT 29/36 = 81 % (dưới 83 %, trong nhiễu), 73 s/bài, 6/15 lượt không đóng khối mã; template ép effort `xhigh`; **effort thấp CHƯA đo**; bản dày ~32k ctx là trần VRAM |
| Qwen3.6-27B | dày · ~18 GB | 77,2 | TB2.0 59,3 · LCB 83,9 | Apache-2.0 · 04/2026 | Dự án đo M nghĩ BẬT 83–92 %, ~82 s/bài [GHI] |
| Muse Glimmer-30B (Meta) | dày · ~17–20 GB | 76,0 | SWE-Pro 51,2 | Apache-2.0 · 2026-08-10 | chỉ có đánh giá của Meta; hỗ trợ llama.cpp **chưa kiểm** |
| Devstral Small 2 | dày 24B | 68,0 | — | Apache-2.0 · 12/2025 | Dự án đo 47 % [GHI] |
| GLM-4.7-Flash | MoE 30B-A3B | 59,2 | LCB 64,0 | MIT | dưới model hiện tại |
| Qwen3-Coder-30B-A3B (trong kho) | MoE · 17,7 GB [ĐO] | ~51,6 [chưa kiểm] | — | Apache-2.0 · 07/2025 | Dự án đo 31 % [GHI] |
| Nemotron 3.5 Lightning | MoE 30B-A3B hybrid Mamba | 51,6 | TB2.1 24,6 | OpenMDW 1.1 · 2026-08-11 | dưới model hiện tại |
| gpt-oss-20b | MoE ~12 GB | 52,4 (NVIDIA) / 34,0 (bảng GLM) | — | Apache-2.0 | minh hoạ harness đổi số tới 18 điểm |

Nguồn: thẻ HF Qwen/Qwen3.8-27B, Qwen/Qwen3.6-27B, zai-org/GLM-4.7-Flash; mistral.ai (Devstral 2); datanorth.ai (Muse Glimmer);
blogs.nvidia.com (2026-08-11); unsloth.ai/docs/models/qwen3.6 — đọc 2026-10-18. Không xác định được bản phát hành mở nào
trong 10/09–13/10/2026.

**Giải mã suy đoán:** b9814 có `--spec-type … draft-mtp, ngram-simple, ngram-mod, ngram-cache` [ĐO]. MTP trên MoE 35B-A3B chỉ
1,15–1,25× (Unsloth) — khớp B5 của dự án (+9 %, tụt 4 bài ⇒ bác) [GHI]. n-gram hợp lượt "viết lại tệp" của agent, chưa có số
llama.cpp cho code [NGUỒN gián tiếp: vLLM/LMCache]. Theo tiêu chí ĐÚNG hơn NHANH: ưu tiên thấp, chỉ bật nếu H không đổi.

## D. Khuyến nghị theo thứ tự ưu tiên

Luật chung (từ bộ nhớ dự án): bộ bài giữ lại viết TRƯỚC khi sửa; ≥ 3 lượt; A/A đo nhiễu; báo cả số bài cụt; không gộp số sau khi
thấy dữ liệu; cổng do số đo đặt.

| # | Việc | Chi phí | Lợi ích kỳ vọng | Cách đo (thước của dự án) | Bằng chứng |
|---|---|---|---|---|---|
| 1 | **Chỉ mục ký hiệu từ tài liệu CỤC BỘ**: sinh `knowledge/api-ref/` tự động từ TOÀN BỘ XML ref pack .NET 10 + ASP.NET Core + XML gói NuGet dự án dùng (SqlClient, OPC UA, MQTTnet, NModbus) + `.d.ts` các gói `package.json` (zod, drizzle-orm, express, react, node-opcua, mqtt, modbus-serial) + javadoc trong `src.zip`. Thay `dotnet-using.json` chọn tay (20 KB) bằng bảng kiểu→namespace đầy đủ. Tra **chính xác theo tên** (khoá-giá trị), không qua cosine. | S (0 tải; mở rộng `tao-tham-chieu-api-dotnet.mjs`) | Lấp lỗ phủ kiểu A-cs6 (`SqlBulkCopyOptions` có sẵn trong XML SqlClient); mở rộng R2B (21→34/35 khối) sang mọi namespace | `tasks-api` 6 × 3 + A/A (biên ±2); bộ ngoại tuyến 35 khối C# (biên dịch được) | GHI + ĐO (tồn tại tệp); hiệu quả = SUY |
| 2 | **Vòng "lỗi biên dịch → tra ký hiệu → sửa"** trong chế độ agent: thông báo CS0246/CS0103/CS1061/CS1503 (C#), TS2305/TS2339/TS2724 (TS) → tra chỉ mục #1 → đưa chữ ký + namespace đúng vào lượt sửa. Đây là De-Hallucinator làm tất định. | S–M | Đánh trúng lớp lỗi API/using mà truy hồi theo câu hỏi bỏ sót | `tasks-api` (C#) + bộ TS mới; F × 3 không tụt; H × 3 không tụt quá ±3 | NGUỒN (De-Hallucinator) + GHI (D1) |
| 3 | **Viết bộ đo API theo nền tảng của dự án TRƯỚC khi nạp gì thêm**: `tasks-api-ts` (zod 4, drizzle 0.44 `inArray`, React 19, express), `tasks-api-ot` (OPC UA .NET Client, MQTTnet 5, NModbus, node-opcua), `tasks-api-sql` (T-SQL qua `tsql-check`, PostgreSQL), PowerShell. Mỗi bài có test chạy được, ≥ 2 bài "API ít phổ biến". | S–M | Không có thước thì không chứng minh được tài liệu nào giúp (cổng Đợt 5 đang CHƯA ĐẠT vì chỉ 1 bài hưởng lợi) | kiểm thước fake-ok/fake-bad như các bộ hiện có | GHI |
| 4 | **Nạp tài liệu web chính thức theo miền** (sparse checkout, giữ URL nguồn từng đoạn để ghi nguồn): danh sách tải ở D2. Mỗi corpus một miền, chỉ bật khi tác vụ thuộc miền (cổng miền). | M (tải vài trăm MB, nhúng) | Lợi ở câu hỏi khái niệm/cách dùng (Hỏi), ít ở sinh mã thuần [SUY] | Studio Eval mã A/B corpus + A/A; bộ vàng có câu **ngoài corpus cùng miền** (bài học ngưỡng 0,44) | GHI + NGUỒN |
| 5 | **Vòng sinh dữ liệu có kiểm** ("data flywheel"): mỗi lượt agent/eval qua biên dịch + test → lưu cặp (yêu cầu, mã cuối, lỗi trung gian, bản sửa) vào bộ xuất 5.1; thêm bộ tự sinh bài C#/TS từ chỉ mục #1 (mỗi kiểu/API ít dùng → một bài + test), giữ cái qua. Có thể lấy đề từ `SWE-rebench-V2` (C#/TS, CC BY 4.0) làm môi trường đo. | M | Tài sản bắt buộc cho mọi LoRA về sau (cổng 5.5 cần ≥ 2.000 cặp); đồng thời là bài đo mới | đếm cặp đạt/tuần; tỉ lệ cặp có lỗi API | NGUỒN (cách KodCode/rStar lọc bằng test) + SUY |
| 6 | **Thí nghiệm LoRA FIM** Qwen2.5-Coder-1.5B base trên mã repo (Unsloth trong WSL2/Docker — cần chủ dự án duyệt cài đặt), xuất gộp → GGUF q8_0. | S–M (vài giờ GPU, phải dừng llama-server chính khi huấn luyện) | Ghost-text đúng quy ước dự án; khiêm tốn theo tài liệu ngoài | `scripts/ai-eval/fim` tách theo thời gian; nền dòng đầu 43,8 %; p50 ≤ 300 ms | NGUỒN + GHI; lợi = SUY |
| 7 | **Đo lại model mới thay vì huấn luyện**: (a) Qwen3.8-27B với effort thấp hơn (`chat_template_kwargs`) — mục "chưa đo" còn mở; (b) Muse Glimmer-30B nếu llama.cpp hỗ trợ. | M (tải 17–20 GB/model; GPU bận ~1 ngày/model) | Chỉ đổi nếu H × 3 vượt 83–86 % ngoài nhiễu và A2/F/V-dot4 không tụt | H 12 × 3, A2 × 12, F × 3, V-dot4 21 × 3, `tasks-api` | GHI + NHÀ SX |
| 8 | **LoRA model chính** — chỉ khi cổng 5.5 đạt (≥ ~2.000 cặp duyệt + lỗi "quy ước/API dự án" chiếm phần đáng kể sau khi #1–#2 chạy). Thuê GPU ≥ 80 GB; dữ liệu = cặp chương trình đã kiểm từ #5 (+ ≤ 10–20 % dữ liệu chung CC BY 4.0 chống quên); router khoá; phục vụ gộp-rồi-lượng-tử hoá. | L | Không rõ; rủi ro tụt H | bộ giữ lại viết trước; H/A2/F/V-dot4 không tụt; rollback qua API đổi model | NGUỒN + SUY |
| 9 | Giải mã suy đoán n-gram (`--spec-type ngram-mod`) cho lượt agent viết lại tệp | S | Tốc độ (không phải ưu tiên) | tok/s + H × 3 không đổi | ĐO (cờ có) + SUY |

**Không khuyến nghị:** LoRA model chính trên máy hiện tại (C1); fine-tune trên văn bản tài liệu API (C5); dùng Magicoder/
evol-codealpaca/Code-Feedback/KodCode cho bất kỳ mục đích huấn luyện nào (B2); nạp docset Dash, tài liệu Java Oracle, đặc tả
OPC UA/Modbus khi chưa có xác nhận giấy phép; dịch tài liệu sang tiếng Việt để nạp (vòng 14 đã cho ròng ÂM khi đổi bản dịch;
đường dịch câu hỏi Việt→Anh hiện có là đủ) [GHI].

### D2. Danh sách tải cho bước tiếp theo (chưa tải gì — mục > 50 MB cần chủ dự án duyệt)

| Ưu tiên | Thứ cần lấy | URL / lệnh | Giấy phép | Cỡ thực nạp |
|---|---|---|---|---|
| 0 (có sẵn) | XML .NET 10 + ASP.NET Core + NuGet dự án; `.d.ts` node_modules; JDK `src.zip` | đường dẫn ở §0b | MIT / theo gói / GPL-2.0+CE | ~75 MB XML + vài chục MB |
| 1 | .NET API reference (lọc namespace dùng thật: System.Data*, System.Net*, System.Text.Json, System.IO, System.Threading*, Microsoft.Data.SqlClient, Microsoft.AspNetCore.*, Microsoft.EntityFrameworkCore nếu dùng) | `git clone --filter=blob:none --sparse https://github.com/dotnet/dotnet-api-docs` rồi `sparse-checkout set xml/System.Data…` | CC BY 4.0 / MIT | chọn lọc ≪ 699 MB |
| 1 | PostgreSQL docs | `https://github.com/postgres/postgres` sparse `doc/src/sgml` (nhánh REL đúng bản DB dev) | PostgreSQL License | 12,7 MB |
| 1 | T-SQL | `https://github.com/MicrosoftDocs/sql-docs` sparse `docs/t-sql` | CC BY 4.0 / MIT | phần nhỏ của 1,35 GB |
| 1 | PowerShell reference | `https://github.com/MicrosoftDocs/PowerShell-Docs` sparse `reference/7.5` (+ `5.1`) | CC BY 4.0 / MIT | ≤ 56 MB |
| 2 | Node.js API | `https://github.com/nodejs/node` sparse `doc/api` theo tag bản Node đang chạy | MIT | 4,8 MB |
| 2 | TypeScript handbook · React | `microsoft/TypeScript-Website` `packages/documentation` · `reactjs/react.dev` `src/content` | CC BY 4.0 (+MIT) | vài chục MB |
| 2 | Python docs | `https://docs.python.org/3/archives/` (zip text) hoặc `python/cpython` sparse `Doc/` | PSF v2 / 0BSD | 24–27 MB |
| 2 | MDN (JS + Web API) | `https://github.com/mdn/content` sparse `files/en-us/web/javascript`, `files/en-us/web/api` | CC BY-SA 2.5 / CC0 | phần của 108 MB |
| 2 | ASP.NET Core khái niệm | `https://github.com/dotnet/AspNetCore.Docs` sparse `aspnetcore/` | CC BY 4.0 / MIT | phần của 869 MB |
| 3 | MQTT 5.0 / 3.1.1 | `https://docs.oasis-open.org/mqtt/mqtt/v5.0/os/mqtt-v5.0-os.html` | OASIS (nguyên văn + thông báo) | 1,4 MB |
| 3 | C++ | `https://github.com/MicrosoftDocs/cpp-docs` sparse; cppreference fork `PeterFeicht/cppreference-doc` release | CC BY 4.0 · CC BY-SA 3.0 | 6,65 MB (cppref) |
| 3 | Go · Rust | `go doc -all <pkg>` (cần cài Go); `rust-lang/book` `src` | BSD-3 · MIT/Apache | nhỏ |
| chờ | Đặc tả OPC UA JSONL | `https://reference.opcfoundation.org/ai-help` | **xin xác nhận OPC Foundation trước** | theo đặc tả |
| chờ (chỉ khi mở #8) | dữ liệu chung chống quên | `nvidia/OpenCodeReasoning-2` (lấy tập con C++/Python), `nvidia/Open-SWE-Traces` | CC BY 4.0 | 49 GB / 62 GB toàn bộ — chỉ lấy tập con |
| chờ (#5) | môi trường bài C#/TS | `nebius/SWE-rebench-V2` | CC BY 4.0 + giấy phép từng repo | lọc C#/TS |

Mọi đoạn nạp phải mang `sourceRef` = URL gốc + giấy phép để ghi nguồn được khi hiển thị trích dẫn; cập nhật = `git pull` theo
lịch (cron hiện có của KB) và nạp lại bằng `deleteCorpus` + nạp (bài học "nạp lại cùng sourceRef nhân đôi") [GHI].

## Phụ lục — kiểm trên máy: llama.cpp b9814 [ĐO]
`llama-server.exe --version` = 9814 (487a6cc16). `--help` có `--lora FNAME` (nhiều adapter, phẩy), `--lora-scaled FNAME:SCALE`,
`--spec-type none,draft-simple,draft-eagle3,draft-mtp,ngram-simple,ngram-map-k,ngram-map-k4v,ngram-mod,ngram-cache`.
Thư mục `D:\SOURCES\16.AI\llama-cuda` có `llama-quantize.exe`, KHÔNG có `convert_lora_to_gguf.py` (script Python nằm trong
repo nguồn llama.cpp). Kho GGUF: Qwen3.6-35B-A3B UD-Q4_K_XL 22,4 GB · Qwen3-Coder-30B-A3B 17,7 GB · Qwen3-30B-A3B-2507 17,7 GB ·
qwen2.5-coder-1.5b q8_0 1,6 GB · Qwen2.5-Coder-1.5B-Instruct Q4 0,99 GB.

## Nguồn chính (đọc 2026-10-18)
- Giấy phép tài liệu: github.com/mdn/content/blob/main/LICENSE.md · docs.python.org/3/download.html (+ `Doc/license.rst`) ·
  oracle.com/java/javase/terms/license/java21speclicense.html · oracle.com/technetwork/java/redist-137594.html ·
  en.cppreference.com/w/Cppreference:Archives · opcfoundation.org/license/specifications/1.15/ · reference.opcfoundation.org/ai-help ·
  modbus.org/modbus-specifications · docs.oasis-open.org/mqtt/mqtt/v5.0/os/mqtt-v5.0-os.html · github.com/Kapeli/feeds ·
  github.com/freeCodeCamp/devdocs · LICENSE/LICENSE-CODE của dotnet/docs, dotnet/dotnet-api-docs, AspNetCore.Docs,
  MicrosoftDocs/sql-docs, PowerShell-Docs, cpp-docs, TypeScript-Website, react.dev; COPYRIGHT của postgres/postgres,
  rust-lang/book; nuspec Microsoft.NETCore.App.Ref; GitHub API `repos/*` (cỡ, SPDX).
- Dataset: thẻ HF `nvidia/OpenCodeReasoning(-2)`, `nvidia/OpenCodeInstruct`, `nvidia/Open-SWE-Traces`, `nvidia/Nemotron-SWE-v1`,
  `nvidia/Llama-Nemotron-Post-Training-Dataset`, `OpenCoder-LLM/opc-sft-stage1|2`, `ise-uiuc/Magicoder-*`,
  `bigcode/commitpackft`, `bigcode/the-stack-v2`, `m-a-p/Code(Feedback)*`, `SWE-Gym/SWE-Gym`, `SWE-bench/SWE-smith*`,
  `nebius/SWE-rebench(-V2)`, `R2E-Gym/R2E-Gym-Subset`, `KodCode/KodCode-V1`, `microsoft/rStar-Coder`,
  `open-thoughts/OpenThoughts3-1.2M`, `inclusionAI/Ling-Coder-SFT`, `gretelai/synthetic_text_to_sql`, `b-mc2/sql-create-context`,
  `PeterPaker123/vietnamese-code-dataset`.
- Fine-tune: unsloth.ai/docs/models/qwen3.5/fine-tune · unsloth.ai/docs/models/qwen3.6 · unsloth.ai/docs/basics/faster-moe ·
  unsloth.ai/blog/qwen3 · docs.unsloth.ai (requirements, benchmarks, Blackwell, Windows) · raw README server llama.cpp ·
  arXiv 2412.16589 (Sourcegraph) · github.com/danbider/lora-tradeoffs (Biderman 2024) · arXiv 2312.05934 (Ovadia, EMNLP 2024) ·
  arXiv 2407.06249 (CodeUpdateArena) · arXiv 2401.01701 v3 (De-Hallucinator) · arXiv 2406.14497 (CodeRAG-Bench) ·
  iclr.cc/virtual/2023/oral/12584 (DocPrompting).
- Model: huggingface.co/Qwen/Qwen3.8-27B · Qwen/Qwen3.6-27B · zai-org/GLM-4.7-Flash · mistral.ai/fr/news/devstral-2-vibe-cli ·
  datanorth.ai (Muse Glimmer) · blogs.nvidia.com/blog/local-ai-open-source-models-agents-nemotron/ (2026-08-11).
