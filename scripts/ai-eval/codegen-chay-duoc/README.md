# Bộ đo "SINH ĐƯỢC MÃ **CHẠY ĐƯỢC**" — hai trục, bốn ngôn ngữ, ba dự án thật

Sinh ra từ audit `docs/superpowers/audits/2026-09-21-ai-local-lap-trinh-audit.md`; mở rộng 2026-09-22.
Trả lời đúng một câu hỏi, và trả lời bằng **máy chạy test**, không bằng người đọc mã:

> *Model/đường ống này có sinh ra mã **chạy được** không?*

---

## Vì sao HAI TRỤC

Chủ dự án nêu (2026-09-21): *"với các model mới cần thay harness hoặc cập nhật code, nên đo theo
hiện tại có khi không phù hợp."* Đúng — và nếu không tách, ta sẽ **đo cái harness rồi đổ lỗi cho model**.

| Trục | Lệnh | Đo cái gì |
|---|---|---|
| **M — model thuần** | `--config raw --raw-url …` | model trên harness CỦA NÓ (chat template, ctx, trần token riêng) |
| **H — đường sản phẩm** | `--config pipeline` | `/api/ai/local-kb/stream` thật: RAG + vòng tool + repo context |

**`H − M` = giá trị (hoặc NỢ) của đường ống ta**, tách khỏi giới hạn model. Đo 2026-09-22 trên
Qwen3.6-27B: **M = 83 %, H = 8 %** trước bản vá G18 — 10/12 lượt chết vì trần token của đường ống,
không vì model. Sau G18: H = 67 %. Không tách hai trục thì "model dốt" và "đường ống bóp" là một.

---

## LUẬT SỐ 1 — CON SỐ KHÔNG CÓ SỐ BÀI CỤT LÀ CON SỐ CHƯA XONG

Model **biết nghĩ** viết cả chuỗi `<think>` vào trần token trước khi phát ký tự mã đầu tiên.
Trần hẹp ⇒ bài **cụt** ⇒ trượt ⇒ **con số THẤP GIẢ**. Đã cắn **ba lần** trong hai ngày:

| Model | Trần hẹp ⇒ số giả | Trần đủ ⇒ số thật |
|---|---|---|
| Qwen3.8-27B | 4k ⇒ 22 % (7/9 cụt) | 12k ⇒ 67 % |
| Qwen3.6-27B | 4k ⇒ 2/12 (10/12 cụt) | 16k ⇒ 83 % (0 cụt) |
| Qwen3.8-27B | 16k ⇒ 75 % (7/36 cụt) | **32k** ⇒ 81 % (0 cụt; 5 bài chạy lại kết thúc ≤15.761 tok — lần này không chạm trần) |

Runner in `genTok`; `so-sanh.mjs` in `tok/bài`. **Mọi báo cáo phải ghi `cụt N/M`; N ≠ 0 ⇒ chặn dưới.**
Dưới tiêu chí *"đúng trước nhanh"* của chủ dự án, đây là kiểu sai nguy hiểm nhất: loại oan model tốt nhất.

Trần phần cứng cho model DÀY 27B trên RTX 5090 32 GB: ctx/slot **32.768** (65k không đủ VRAM với KV f16)
⇒ `max_tokens` tối đa ≈ 32.768 − prompt − 256. Tính bằng `/tokenize` thật, đừng đoán (prompt dài nhất
của bộ khó = 195 token ⇒ 32.253).

## Hai trục NGHĨ — `--khong-nghi`

Model biết nghĩ có **hai** con số, và một con số đơn lẻ luôn giấu một trong hai:

| Cấu hình | Trả lời câu hỏi |
|---|---|
| nghĩ BẬT + trần rộng (`--max-tokens 16000`) | trần CHẤT LƯỢNG của model |
| nghĩ TẮT + trần hẹp (`--khong-nghi --max-tokens 2500`) | thứ dùng được trong vòng lặp lập trình |

`--khong-nghi` gửi `chat_template_kwargs: { enable_thinking: false }` — đường chính thống của llama-server.
**KHÔNG** chèn `/no_think` vào prompt: template Qwen3.6/3.8 không có nhánh ấy ⇒ hỏng trong im lặng.
Kiểm template có đọc cờ không: header GGUF nằm ở ~10,9 MB — đọc **≥48 MB** (đọc 6 MB kết luận sai).

---

## KIỂM THƯỚC ĐO TRƯỚC — bắt buộc, không phải tuỳ chọn

```bash
node scripts/ai-eval/codegen-chay-duoc/run.mjs --tasks tasks-hard.json --fake fake-hard.json --config fake-ok   # PHẢI 12/12
node scripts/ai-eval/codegen-chay-duoc/run.mjs --tasks tasks-hard.json --fake fake-hard.json --config fake-bad  # PHẢI 0/12
```

`fake-ok` nạp lời giải **đúng**, `fake-bad` nạp lời giải **sai nhưng VẪN BIÊN DỊCH ĐƯỢC**.
Không thoả 12/12 và 0/12 ⇒ **bộ đo hỏng, vứt mọi số của lượt đó.** Đây là thứ phân biệt một phép đo
HÀNH VI với một phép đo CÚ PHÁP. Khi thêm bài mới, `fake-bad` **phải trượt** — H-cpp2 từng lọt vì với
chu trình *thuần* Kahn trả rỗng một cách tình cờ; phải thêm ca "chu trình LẪN thành phần sắp được".

## CỔNG SỨC KHOẺ — canh ĐÚNG endpoint đang đo

Runner kiểm sức khoẻ **trước VÀ sau** mỗi lượt; không khoẻ ⇒ `exit 2`, không sinh số. Cổng theo URL:
`:8091/health` (llama-server) hoặc `:11434/api/tags` (Ollama — Devstral chỉ chạy được ở đây vì llama.cpp
b9814 không nạp `mistral3` có tháp thị giác). Lý do có cổng: `llama-server` từng **chết giữa chừng** và
4 vòng đo suýt được báo cáo là *"0/9, 79 lượt OOM"* — hiện vật của công cụ.

---

## Chạy

```bash
# đăng nhập lấy vé (một lần)
curl -s -X POST http://127.0.0.1:3000/api/auth/login -H "Content-Type: application/json" \
  -d '{"username":"<user>","password":"<pass>"}' -c tmp/audit-ai/ck.txt

# đổi model trên :8091 — MỘT đường, kết thúc bằng phép dò sức khoẻ THÀNH CÔNG (không phải "đã gọi lệnh")
powershell -NoProfile -File scripts/ai-eval/codegen-chay-duoc/doi-model.ps1 -Model "D:\SOURCES\16.AI\<model>.gguf" -Ctx 32768
#   ⚠ -Ctx: MoE 30B-A3B gánh 65536; model DÀY 27B dùng 32768 (KV f16 ở 65k nuốt hết VRAM).

# trục M — model thuần, hai trục nghĩ
node scripts/ai-eval/codegen-chay-duoc/run.mjs --tasks tasks-hard.json --config raw --max-tokens 16000 --label M-<nhãn>-1
node scripts/ai-eval/codegen-chay-duoc/run.mjs --tasks tasks-hard.json --config raw --khong-nghi --max-tokens 2500 --label M-<nhãn>nt-1
#   Ollama: thêm --raw-url http://127.0.0.1:11434/v1/chat/completions --model devstral-small-2:latest

# trục H — đường sản phẩm
node scripts/ai-eval/codegen-chay-duoc/run.mjs --tasks tasks-hard.json --config pipeline --label H-<nhãn>-1

# bảng so sánh — gom nhiều lượt, in KÈM số lượt; khớp <nhãn><số>.json (không nuốt nhãn anh em)
node scripts/ai-eval/codegen-chay-duoc/so-sanh.mjs M-coder12- M-q36moe- M-q36- M-q38-
node scripts/ai-eval/codegen-chay-duoc/so-sanh.mjs --truc H H-q36-truoc- H-q36-sau-

# ba dự án THẬT (C#+SQL Server · C#+SQL Server · PostgreSQL+React/Node)
node scripts/ai-eval/codegen-chay-duoc/duan.mjs --label duan-1
```

Tham số `run.mjs`: `--tasks` · `--config raw|pipeline|fake-ok|fake-bad` · `--fake` · `--raw-url` · `--model` · `--sampling hien-tai|chinh-hang` (B2 2026-09-22, trục M: `hien-tai` = 0,2/0,9 như mọi báo cáo cũ; `chinh-hang` = model card Qwen3.6 — nghĩ 0,6/0,95/20/min_p 0/presence 0, không nghĩ 0,7/0,8/20/0/1,5; cùng bộ số với `server/services/ai/hoSoSampling.ts` cho trục H qua `AI_SAMPLING_PROFILE`) ·
`--max-tokens` · `--khong-nghi` · `--effort low|medium|high|xhigh` (Qwen3.8: template mặc định **xhigh** — lý do nó nghĩ 7.252 tok/bài) · `--only <id,…|lang>` · `--label` · `--cookie`.
Báo cáo JSON: `reports/<label>.json`. **Nhãn luôn kết thúc bằng số lượt** (`-1`, `-2`, …) để `so-sanh.mjs` gom được.

## Bộ bài

| Bộ | n | Dùng khi |
|---|---|---|
| `tasks.json` | 11 (5 TS · 3 Py · 3 C#) | hàm thuần — **ĐÃ BÃO HOÀ**, không còn phân định được đỉnh; chỉ còn làm lưới hồi quy |
| `tasks-hard.json` | **12** (3 TS · 3 Py · 3 C# · **3 C++**) | LRU+TTL · gộp khoảng · topo+chu trình (TS: **nhỏ nhất theo từ điển + đúng nút TRONG chu trình**) · rate-limit · SemVer · CSV RFC4180 · ring buffer · biểu thức · ca UTC · **C++: cửa sổ trượt biên MỞ · topo+chu trình · biểu thức chia cắt-về-0** |
| `duan.mjs` | 3 đơn hàng | **hiện vật có biên dịch/phân tích được không**: T-SQL qua ScriptDom (offline) · PostgreSQL cục bộ, lược đồ tạm · `dotnet build` · `node --check`/esbuild |

| `tasks-api2.json` | **30** (4 TS-thư viện · 4 React · 5 OT-Node · 6 OT-.NET · 6 SQL · 5 PowerShell) | **API theo nền tảng dự án**, đúng phiên bản trên máy: zod 4 · drizzle 0.44 · React 19.2 · node-opcua · MQTT.js/MQTTnet 5 · modbus-serial/NModbus · OPC UA .NET · PostgreSQL 18 · SQL Server 2025 · PowerShell 5.1 — xem mục riêng bên dưới |
| `tasks-api.json` | **6** (6 C#) | **nặng API ngoài** (ADO.NET / `Microsoft.Data.SqlClient` 5.2.2 ghim trong `cs-template`): đọc `DbDataReader` theo TÊN cột + NULL · `SqlConnectionStringBuilder` · `SqlParameter` DECIMAL(18,2) + `DBNull` · nhiều tập kết quả (`NextResult`) · `DataTable` ràng buộc · `SqlBulkCopy` ánh xạ cột. Thiết kế để corpus kiểu `csharp-dotnet` (Training Studio "Eval mã") có chỗ TÁC DỤNG — bộ khó chỉ 2/12 bài nhận đoạn ≥ 0,44 |

C++ đi qua **CMake → MSVC** (`cpp-template/`): CMake tự dò MSVC qua registry, không cần `vcvars64`.
Máy này: msys2 có nhưng **chưa cài toolchain**; MSVC 14.51 (VS 2026) có đủ.

⚠ `duan.mjs` ghim **Postgres cục bộ** (`aoi@127.0.0.1:5434`) + lược đồ tạm `DROP … CASCADE`. Bản đầu đọc
`DATABASE_URL` từ `.env` — trỏ tới **Supabase từ xa** — tức DDL do model sinh chạy lên một DB không nằm trên
máy này. Không hại là MAY MẮN, không phải thiết kế. Đích chấm bài phải **dùng xong vứt được**.

## `tasks-api2.json` — bộ đo API THEO NỀN TẢNG DỰ ÁN (2026-10-18)

Sinh ra từ khuyến nghị #3 của `docs/superpowers/audits/2026-10-18-ai-local-nguon-hoc-code.md`: viết thước **trước** khi
nạp thêm tài liệu, để chứng minh được tài liệu nào giúp. Đo đúng lớp lỗi đã thấy ở model: **sai namespace/API, thiếu
using/import, gọi thành viên không tồn tại, dùng API đời cũ** (MQTTnet v4, zod 3, React trước 19, ConvertFrom-Json của
PowerShell 7…). Mỗi bài bắt dùng API THẬT của **đúng phiên bản có trên máy đo**; nơi hành vi của API mới khác cách làm
cũ, bài kiểm ghim chính chỗ khác đó (Suspense fallback, effect bị dọn khi `<Activity hidden>`, `z.encode` trên codec,
chuỗi `z.prettifyError`, số `ReadRequest`/`CreateMonitoredItemsRequest` máy chủ OPC UA nhận, số lệnh FC16…).

**30 bài · 6 nhóm** (≥ 4/nhóm). Kiểm thước 2026-10-18: **fake-ok 30/30 · fake-bad 0/30** (cả `run.mjs` lẫn `api2/kiem-thuoc.mjs`;
mọi fake-bad CHẠY được và trượt đúng ở khẳng định nhắm tới — đã đọc lý do từng bài).

```bash
node scripts/ai-eval/codegen-chay-duoc/api2/kiem-thuoc.mjs                 # đóng gói lại + fake-ok 100 % / fake-bad 0 % (≈ 35 s, song song 3)
node scripts/ai-eval/codegen-chay-duoc/run.mjs --tasks tasks-api2.json --config fake-ok   # PHẢI 30/30
node scripts/ai-eval/codegen-chay-duoc/run.mjs --tasks tasks-api2.json --config fake-bad  # PHẢI 0/30
node scripts/ai-eval/codegen-chay-duoc/run.mjs --tasks tasks-api2.json --config raw --max-tokens 16000 --only ot-dotnet --label M-<nhãn>-api2-1
```
`--only` nhận id, `lang` hoặc **nhóm** (`ts-thu-vien` · `react` · `ot-node` · `ot-dotnet` · `sql` · `powershell`). Studio "Eval mã" thấy
bộ này qua tên `tasks-api2` (đọc thư mục; chạy cả bộ — bộ lọc `ngonNgu` của router chỉ nhận ts/py/cs/cpp, giao diện không dùng nó).

**Nguồn sự thật = `api2/bai/<id>/`** (`bai.json` · `de.md` đề · `test.*` bài kiểm ẨN · `ok.*` lời giải mẫu · `bad.*` lời giải sai
chạy được). `tasks-api2.json` + `fake-api2.json` là tệp SINH bởi `api2/dong-goi.mjs` — sửa nguồn, đừng sửa JSON.

### Trình chấm mới trong `cham.mjs` (bài cũ không đổi lệnh — hồi quy fake-ok/fake-bad của `tasks`/`tasks-hard`/`tasks-api` giữ 100 %/0 %)

| `lang` | Lời giải | Chạy | Đích dùng-xong-vứt |
|---|---|---|---|
| `ts` (+ `kem`, `pg`, `thoatCuong`) | `sol.ts` | `node --experimental-transform-types --test [--test-force-exit]` | máy chủ OT giả **in-process** trong bài kiểm; `pg: true` ⇒ cụm PostgreSQL riêng, URL qua `PG_URL` |
| `tsx` | `sol.tsx` | esbuild (gói repo) bóc JSX `automatic` ⇒ `node --test` trên jsdom | — |
| `cs` (+ `csproj`, `kem`) | `Sol.cs` | `dotnet run`; `csproj: api2/cs-ot/p.csproj` = khuôn OT | MQTTnet.Server / slave NModbus in-process |
| `pgsql` | `sol.sql` | `node --test` + postgres.js | **cụm PostgreSQL riêng mỗi lượt** (`api2/pg.mjs`) |
| `tsql` | `sol.sql` | `dotnet run` + `api2/kem/TroTsql.cs` (SqlClient) | **LocalDB riêng `AiEvalApi2`**, CSDL `ev_…` tệp trong thư mục bài, DROP sau lượt |
| `ps1` | `sol.ps1` (ghi UTF-8 **có BOM**) | `powershell.exe` 5.1 `-File t.ps1`, assert tự viết (Pester máy này 3.4 — không dùng) | — |

Vì sao KHÔNG dùng CSDL `_test` của repo (`vitest.setup.ts` ép `…_test`): `aoi` là chủ CSDL ấy và bài kiểm tích hợp khác dùng
chung nó — SQL do model sinh có thể DROP bảng của người khác. Cụm PG riêng: `initdb` một lần vào khuôn `%TEMP%/ai-eval-pg-mau-<bản>`
(≈ 4 s), mỗi lượt chép khuôn + `pg_ctl start` cổng ngẫu nhiên 127.0.0.1, `trust`, fsync tắt; runner dừng cụm trong `finally`
(kể cả khi bài kiểm bị giết vì quá giờ). Bin: `AI_EVAL_PG_BIN` ⇒ `C:/Program Files/PostgreSQL/{18,17,16,15}/bin`.
T-SQL chạy THẬT thay vì `tsql-check`: ScriptDom chỉ biết cú pháp — gọi hàm không tồn tại vẫn "OK", tức mù đúng lớp lỗi cần đo.

### Bài và phiên bản thư viện (đo trên máy 2026-10-18)

| id | nhóm | API/điểm bẫy | Phiên bản |
|---|---|---|---|
| A2-ts1 | ts-thu-vien | `z.strictObject` · `superRefine` · **`z.prettifyError`** (chỉ v4) | zod 4.3.6 |
| A2-ts2 | ts-thu-vien | **`z.codec` · `z.decode`/`z.encode`** · `z.iso.datetime({offset})` (≥ 4.1) | zod 4.3.6 |
| A2-ts3 | ts-thu-vien | `pgTable` ánh xạ cột · `inArray` · `count()` ra number | drizzle-orm 0.44.7 · postgres 3.4.9 · PG 18.4 |
| A2-ts4 | ts-thu-vien | `onConflictDoUpdate` cộng dồn nguyên tử · `returning` + `xmax = 0` | drizzle-orm 0.44.7 · postgres 3.4.9 · PG 18.4 |
| A2-rx1 | react | `useActionState` + `<form action>` (pending, tự reset) | react / react-dom 19.2.4 · @testing-library/react 16.3.3 · jsdom 30.0.1 |
| A2-rx2 | react | **`use(promise)`** phải suspend | như trên |
| A2-rx3 | react | **`<Activity>`** (ổn định 19.2): giữ state, DỌN effect khi ẩn | như trên |
| A2-rx4 | react | **`useEffectEvent`** (ổn định 19.2) | như trên |
| A2-on1 | ot-node | `OPCUAClient` · `session.read` gộp MỘT yêu cầu · `connectionStrategy` · StatusCode | node-opcua 2.174.0 |
| A2-on2 | ot-node | `ClientSubscription` · `ClientMonitoredItem` (không thăm dò) | node-opcua 2.174.0 |
| A2-on3 | ot-node | `session.call` · `Variant`/`DataType.Double` cho số nguyên | node-opcua 2.174.0 |
| A2-on4 | ot-node | `connectAsync` · Last Will retain · `publishAsync` QoS1 · `endAsync` | mqtt 5.15.1 · broker aedes 0.51.3 (**chỉ MQTT 3.1.1**) |
| A2-on5 | ot-node | `connectTCP` · `setID` · float32 **CDAB** · trần **125** thanh ghi/lệnh | modbus-serial 8.0.25 |
| A2-oc1 | ot-dotnet | **`MqttClientFactory`** (v5) · MQTT 5 user property/content type · PUBACK `NoMatchingSubscribers` | MQTTnet + MQTTnet.Server 5.2.0.1603 |
| A2-oc2 | ot-dotnet | `SubscribeAsync` · `ConvertPayloadToString` (payload `ReadOnlySequence` ở v5) · hết hạn ⇒ `TimeoutException` | MQTTnet 5.2.0.1603 |
| A2-oc3 | ot-dotnet | `ModbusFactory().CreateMaster(TcpClient)` (không phải NModbus4) · chia ≤ 125 | NModbus 3.0.83 |
| A2-oc4 | ot-dotnet | `WriteMultipleRegisters` (MỘT FC16) + `WriteSingleCoil` · bù hai | NModbus 3.0.83 |
| A2-oc5 | ot-dotnet | `ReadValueIdCollection` · `Attributes.Value` · `StatusCode.IsBad/IsUncertain` · `ServiceResultException` | OPCFoundation.NetStandard.Opc.Ua.Client/Core 1.5.378.156 |
| A2-oc6 | ot-dotnet | **`ExpandedNodeId.ToNodeId` + `NamespaceTable`** | OPCFoundation.NetStandard.Opc.Ua.Core 1.5.378.156 |
| A2-pg1 | sql | `DISTINCT ON` · `FILTER` · chia numeric | PostgreSQL 18.4 |
| A2-pg2 | sql | `generate_series` · **`date_bin`** · khung trống | PostgreSQL 18.4 |
| A2-pg3 | sql | PL/pgSQL `RETURNS TABLE` trùng tên cột · `ON CONFLICT` · `ERRCODE '22023'` | PostgreSQL 18.4 |
| A2-ms1 | sql | `STRING_AGG … WITHIN GROUP` (không nhận DISTINCT) | SQL Server 2025 LocalDB 17.0.4025 · SqlClient 5.2.2 |
| A2-ms2 | sql | `OPENJSON … WITH` · `MERGE` · `OUTPUT $action` · so sánh có NULL | như trên |
| A2-ms3 | sql | **`GENERATE_SERIES` · `DATE_BUCKET`** (2022+) | như trên |
| A2-ps1 | powershell | `ConvertFrom-Json` 5.1 (không `-AsHashtable`) · đọc UTF-8 không BOM | Windows PowerShell 5.1.26100 |
| A2-ps2 | powershell | `Import-Csv -Delimiter -Encoding` · `Measure-Object` trả `[double]` | như trên |
| A2-ps3 | powershell | `TcpClient.ConnectAsync().Wait(ms)` · rò đầu ra pipeline | như trên (.NET Framework 4.8) |
| A2-ps4 | powershell | `XmlDocument.Load` + `XmlNamespaceManager` · NodeSet2 OPC UA | như trên |
| A2-ps5 | powershell | `SupportsShouldProcess` · `$PSCmdlet.ShouldProcess` · `-WhatIf` | như trên |

**In đậm** = API ít phổ biến/mới (≥ 2 bài mỗi nền tảng có).

### Giới hạn đã biết

- **Chưa có số model nào** (lượt dựng thước không được gây tải GPU). Như mọi bộ mới: ≥ 3 lượt, đo A/A biên nhiễu riêng trước
  khi kết luận corpus giúp hay không; báo `cụt N/M`.
- aedes 0.51 chỉ nói **MQTT 3.1.1** ⇒ MQTT 5 chỉ đo ở phía .NET (A2-oc1/oc2); đề A2-on4 nói rõ điều này.
- OPC UA .NET (oc5/oc6) đo **mô hình đối tượng ngoại tuyến**, không có máy chủ OPC UA .NET in-process (dựng chứng chỉ +
  ApplicationConfiguration quá nặng cho một bài); đường mạng OPC UA thật đo ở phía node-opcua (on1–on3).
- `tsql` cần SQL Server LocalDB (không cần admin) và chạy dưới **cùng tài khoản Windows** với tiến trình chấm (LocalDB theo
  người dùng) — Studio trên :3000 phải chạy bằng tài khoản ấy. `pgsql`/`pg: true` cần bin PostgreSQL trên máy.
- React chạy trên **jsdom**, không phải trình duyệt; node-opcua client tự tạo PKI của nó trong hồ sơ người dùng lần đầu.
- Bài kiểm đo HÀNH VI: lời giải dùng API khác mà cho đúng hành vi vẫn ĐẠT (vd ref thay `useEffectEvent`) — chỉ những chỗ
  hành vi khác nhau mới ghim API. A2-ps3 có ca địa chỉ không định tuyến (`10.255.255.1`) phụ thuộc mạng: bị từ chối nhanh
  hay hết hạn đều phải ra `$false` trong < 3 s.
- Khuôn `api2/cs-ot/p.csproj` ghim đúng bản trong `%USERPROFILE%\.nuget\packages` ⇒ restore không cần mạng; máy khác thiếu
  gói ⇒ restore sẽ tải (hoặc trượt nếu ngoại tuyến) — kiểm thước sẽ lộ ngay.

## Đường cơ sở đã đo — bộ KHÓ 12 bài, 3 lượt, RTX 5090, llama.cpp b9814

Xếp theo **tính đúng đắn** (tiêu chí chủ dự án 2026-09-22: *"đúng trước nhanh"*). Cụt = số bài chạm trần.

| Trục M · model thuần | Chạy được | Cụt | ms/bài | ghi chú |
|---|---|---|---|---|
| **Qwen3.6-35B-A3B** · nghĩ BẬT 16k | **30/36 = 83 %** | 0 | 30.346 | MoE 3B hoạt động; `qwen35moe` nạp được; giải H-ts3 3/3 |
| Qwen3.6-35B-A3B · nghĩ BẬT 16k · sampling **chính hãng** (`--sampling chinh-hang`, B2 A/B 2026-09-22) | 28/36 = 78 % | 1 | 35.647 | chặn dưới (H-py3 cụt @16k); +10 % tok/bài (6.257 vs 5.665); +H-cs3 +H-py3 nhưng −H-cpp3 −H-cs2 −H-ts3 (3/3 → 1/3) ⇒ **không ≥ cũ, mặc định giữ `hien-tai`** |

Chuỗi cấu hình đường ống cùng ngày (H, 12 × 3, cùng model): B1 25/36 → **B4 `--reasoning-budget 12000` 27/36** (0 G5‑D) → **B3 ctx 64k
31/36 = 86 %** (`H-q36moe-64k-`, mặc định mới) → B5 MTP `draft-mtp n_max=2` 27/36 (−4 bài, nhanh 9 %) ⇒ **không dùng MTP**.

Trục H cùng A/B (đường ống thật, `AI_SAMPLING_PROFILE` trong `.env` + restart): `hien-tai` sau B1 **25/36 = 69 %**
(`H-q36moe-b1-`) · `chinh-hang` **24/36 = 67 %** (`H-q36moe-ch-`, H-ts3 3/3 → 0/3 cùng chiều M) ⇒ hai trục cùng nói
"không tốt hơn" ⇒ **B2 đóng: giữ `hien-tai`**. Nền trước B1 (`H-moe-`): 27/36 = 75 %; chênh −2 bài sau B1 là nhiễu 3 lượt
(5 bài đổi chiều, đường sinh mã không đổi yêu cầu) + G19 (H-cs3 bị cầu chì grep nuốt, đã vá).
| **Qwen3.6-27B** · nghĩ BẬT 16k | **30/36 = 83 %** | 0 | 79.826 | bằng MoE về đúng, chậm 2,6× |
| **Qwen3.8-27B** · nghĩ BẬT, ghép công bằng (7 id @16k + 5 id cụt @32k) | **29/36 = 81 %** | 0 | 73.135 | 5 id chạy lại @32k: 9/15, max 15.761 tok, 0 cụt; **6/15 không phát khối mã** dù không cụt; H-cs2 0/3 |
| Qwen3.8-27B · nghĩ BẬT 16k (số gốc) | 27/36 = 75 % | **7** | 109.578 | chặn dưới — đã thay bằng hàng trên |
| Qwen3.6-27B · nghĩ TẮT 2.5k | 26/36 = 72 % | 0 | 12.844 | |
| Qwen3.8-27B · nghĩ TẮT 2.5k | 26/36 = 72 % | 0 | 8.580 | |
| Qwen3.6-35B-A3B · nghĩ TẮT 2.5k | 25/36 = 69 % | 1 | 5.342 | |
| Devstral Small 2 (Ollama) · bộ 12 | 17/36 = 47 % | 0 | 5.035 | chỉ chạy trên Ollama (`mistral3` có thị giác, b9814 không nạp); không có chế độ nghĩ; C++ 3/9, TS 3/9 |
| Qwen3-Coder-30B-A3B *(đang dùng)* | 11/36 = 31 % | 0 | 1.702 | không nghĩ |

| Trục H · đường ống, Qwen3.6-27B nghĩ BẬT | Chạy được | Lượt chết vì đường ống (G5-D) |
|---|---|---|
| trước G18 (trần `MAX_TOKENS_SINH = 3_000`) | 1/12 = 8 % | 10/12 |
| sau G18 (trần theo lớp model, thử lại 1 lần) | 24/36 = 67 % | 0/36 |

Khoảng cách H 67 % ↔ M 83 % là chi phí đường ống (ngữ cảnh repo + persona) — **chưa vá**, đã ghi.

Bài **không** model nào giải: không còn (H-ts3 từng là bài ấy — MoE có nghĩ giải 3/3).
Bài ổn định khó nhất: H-cs2 (biểu thức C#), H-py3 (CSV RFC4180), H-ts3.

### `tasks-api` — kiểm thước, nhiễu, giới hạn (2026-10-17)

```bash
node scripts/ai-eval/codegen-chay-duoc/run.mjs --tasks tasks-api.json --config fake-ok  --label kt-api-ok-1   # PHẢI 6/6
node scripts/ai-eval/codegen-chay-duoc/run.mjs --tasks tasks-api.json --config fake-bad --label kt-api-bad-1  # PHẢI 0/6
```
`fake-api.json` tự cặp theo tên (`tasks-<x>.json` ⇔ `fake-<x>.json`). Mỗi `fake-bad` biên dịch được và sai đúng MỘT
điều đặc tả nói rõ (đọc theo vị trí cột · thiếu `ApplicationIntent` · gán `null` C# thay `DBNull` · bỏ tập kết quả đầu ·
thiếu `Unique` · đảo chiều ánh xạ).

- ⚠ **CHƯA có số đo nhiễu riêng.** Biên ±3/36 là của `tasks-hard` (12 bài, 4 ngôn ngữ); 6 bài C# nặng API có thể dao
  động khác. Lượt A/B duy nhất (Studio, corpus `csharp-dotnet`, × 3): TẮT 14/18 → BẬT 13/18, 18/18 lượt nhận đoạn.
- **Cách đo nhiễu: A/A** — hai nhánh CÙNG tắt corpus, ≥ 3 lượt, ghi `max |chênh|`. Ở Studio: thủ tục
  `kbStudio.batDauEvalMa` nhận `doiChung: true` (nhánh BẬT vẫn truy hồi để đánh dấu "bài có đoạn" nhưng prompt = prompt
  TẮT; hàng hiện nhãn "A/A đối chứng"). Ở dòng lệnh: chạy cùng cấu hình ≥ 3 lần (`--label X-1`, `X-2`, `X-3`) rồi
  `so-sanh.mjs X-`.
- `A-cs6` đọc trường riêng `_copyOptions` của `SqlBulkCopy` bằng phản chiếu (không có API công khai đọc `KeepIdentity`)
  ⇒ gắn với `Microsoft.Data.SqlClient` 5.2.2; đổi phiên bản gói ⇒ chạy lại kiểm thước trước khi tin số.
- Bài nào cũng là C# ⇒ không dùng để so ngôn ngữ; dùng để đo "corpus API có giúp mã gọi API đúng không".

### Studio "Eval mã" — HAI THƯỚC (2026-10-17)

Kết luận chính tính trên **tập con** cặp (bài, lần lặp) mà nhánh BẬT thật sự nhận ≥ 1 đoạn ≥ 0,44; biên ⌈n×3/36⌉ trên n
lượt của tập con; tập con < 6 lượt ⇒ "không đủ bài có đoạn". Thước toàn bộ vẫn hiển thị. Lý do (đo được, cổng Đợt 5):
`tasks-hard` × 3 toàn bộ 25 → 27/36 (+2) nhưng chỉ 6/36 lượt nhận đoạn, trên đó 3 → 2/6 (−1) — +2 đến hoàn toàn từ bài
có prompt hai nhánh y hệt, tức nhiễu thuần. Xem `server/services/kbStudioEvalMa.ts#tongHopEvalMa`.

## Thêm một model mới — checklist

1. Đọc header GGUF **≥48 MB**: kiến trúc, tháp thị giác, template có `enable_thinking`. `mistral3` có thị giác
   ⇒ b9814 không nạp ⇒ dùng Ollama.
2. `doi-model.ps1` với `-Ctx` đúng lớp (MoE 65536 · dày 32768). Kết quả phải là `SAN SANG`, không phải "đã chạy lệnh".
3. Trục M **cả hai trục nghĩ**, ≥3 lượt mỗi trục. Ghi `cụt`; ≠ 0 ⇒ nâng trần (tới trần phần cứng) rồi đo lại.
4. So bằng `so-sanh.mjs` trên **cùng tệp bài**. **Không** so với số benchmark của nhà phát hành.
5. Model thắng ⇒ đo **trục H** trên chính nó. M cao mà H thấp = đường ống bóp, không phải model kém.
