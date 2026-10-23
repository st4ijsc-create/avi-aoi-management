# Thiết kế chi tiết K12 · K13 · K14 — Lưu đồ điều khiển, Nhà máy ảo 3D, Thư viện thiết bị (+ hiệu năng 3D)

- Ngày: 2026-10-23 · Trạng thái: **CHỜ CHỦ DỰ ÁN DUYỆT** — chưa viết mã sản phẩm, chưa tạo migration.
- Nối tiếp [2026-10-23-scada-phan-tich-chi-tiet.md](2026-10-23-scada-phan-tich-chi-tiet.md) (K1–K11, S0–S7). Hai tài liệu dùng chung quy ước: bảng mới `snake_case` + `timestamptz`, mỗi khối một cờ `*_ENABLED` mặc định OFF, migration chỉ thêm (trừ §5.2 — có kế hoạch riêng).
- Dải migration đề xuất cho khối này: **0450–0469** (K1–K11 giữ 0430–0449).

**Chủ dự án đã quyết (hội thoại 2026-10-23):**
1. PLC chính: **Mitsubishi, Delta, Inovance**. Trải nghiệm tham chiếu: **CODESYS** (SFC/CFC).
2. Mô phỏng phải **như Factory I/O**: nhà máy lắp ghép, theo đúng mã và đúng thiết bị đã chọn, không phải cảnh cố định.
3. Người tạo thiết bị mới: **kỹ sư nội bộ nhà máy** (không có hãng ngoài gửi gói vào ⇒ không cần "chợ gói", vẫn cần duyệt + ký).
4. Ba nguyên mẫu đã được duyệt **về hướng**: Xưởng Lưu Đồ PLC (lưu đồ + mô phỏng + xuất hãng), Nhà máy ảo 3D, Xưởng thiết bị. Nguyên mẫu là bản thử, **không** dùng lại mã.

**Nguồn và mức tin cậy:** khảo sát mã bằng tác nhân đọc (tệp:dòng), các điểm then chốt tôi tự kiểm lại (✔). Nghiên cứu hãng PLC và công cụ mô phỏng từ tài liệu hãng/chuẩn, mục chưa xác minh ghi **[chưa kiểm]**.

---

## 1. Kiến trúc chung của ba khối

```
                 ┌────────────── K14 THƯ VIỆN THIẾT BỊ ──────────────┐
                 │ gói có phiên bản: mô hình · khớp · HÀNH VI · CỔNG │
                 │ · mẫu giao thức · ký hiệu HMI · cảnh báo · kiểm thử│
                 └──────┬───────────────┬────────────────┬───────────┘
                        │ cổng I/O      │ hành vi        │ ký hiệu/cảnh báo/mẫu tag
        ┌───────────────▼──┐   ┌────────▼─────────┐   ┌──▼───────────────────────┐
        │ K12 LƯU ĐỒ        │   │ K13 NHÀ MÁY ẢO   │   │ SCADA (K1 kênh, K4 cảnh   │
        │ bước/điều kiện →  │◄─►│ cảnh lắp ghép,   │   │ báo, K6 mimic, K9 OPC UA) │
        │ ST + gói xuất hãng│I/O│ bộ chạy hành vi  │   └───────────────────────────┘
        └────────┬─────────┘ảo └────────┬─────────┘
                 │ nguồn điều khiển      │ I/O ảo
     ┌───────────┼───────────────────────┼──────────────────────────┐
     │ (a) bộ thông dịch lưu đồ  (b) MATIEC chạy chính mã ST  (c) PLC thật │
     └──────────────────────────────────────────────────────────────┘
```

Ba nguyên tắc bất biến:
1. **Cổng I/O là hợp đồng duy nhất.** Lưu đồ, nhà máy ảo, SCADA, cảnh báo, ký hiệu HMI chỉ nối vào tên cổng của gói. Đổi giao thức/hãng PLC không đổi hợp đồng.
2. **Một bộ chạy hành vi** (behavior runtime) dùng chung cho hộp cát Xưởng thiết bị và nhà máy ảo — hai chỗ không được có hai cài đặt khác nhau.
3. **Không đường ghi mới.** Mọi lệnh tới thiết bị thật vẫn đi `dispatch()` / đường edge đã thiết kế (K5). Mô phỏng không bao giờ ghi thiết bị thật; gói "nối thiết bị thật" chỉ cho phép *gán* cổng vào tag thật, việc ghi vẫn qua cổng an toàn.

---

## 2. K12 — Lưu đồ điều khiển (không gõ lệnh)

### 2.1 Hiện trạng đã kiểm

| Thành phần | Có | Thiếu / lỗi |
|---|---|---|
| Mô hình POU (`server/services/programming/iec61131/pouModel.ts`) | LAD/FBD/SFC/ST, Zod, kiểu IEC cơ bản | biến **không khai được kiểu FB** (TON/CTU) — chỉ kiểu cơ bản; SFC không có thời lượng ⇒ không biểu diễn L/D; không có rẽ nhánh song song |
| Sinh ST (`pouToSt.ts`) | SFC → `CASE` state machine; FB có trạng thái tự sinh instance | SFC **chỉ qualifier N** (S/R/P/L/D ⇒ chú thích "UNSUPPORTED", `:282-286`) |
| PLCopen XML (`plcopenXml.ts`) | xuất/nhập TC6 v2.01 cả 4 ngôn ngữ | nhập tệp **CODESYS có biến FB** hỏng: `readTypeName` lấy `derived` làm tên kiểu ⇒ Zod từ chối cả tệp (`:449-455`) |
| Trình soạn (`PouStudio.tsx`, `PouCanvas.tsx`) | canvas xyflow LAD/FBD/SFC, inspector | nút **không kéo được**, không nối dây tự do; hành động bước là **ô gõ ST**; biến gõ tự do (không chọn tag) |
| Lưu đồ kéo thả (`IrEditor`, `ir/irModel.ts`) | khối move/grip/set_output/wait/if/loop/PID/counter/FB | **chỉ dịch sang URScript/ROS2** (robot), mô hình tuần tự chặn, `renderExpr` ra cú pháp Python |
| Mô phỏng | LD: một chu kỳ quét boolean; ST/POU: "xem trước cấu trúc" | **không có mô phỏng chạy thật** trong sản phẩm; MATIEC chỉ có ở bộ chấm AI (`scripts/ai-eval/ngau-nhien/lib/st-matiec/`) |
| Nạp | đường duyệt `programmingService` (validate→build→sim→HITL→deploy) | `openplcDeployGuard` **luôn thất bại** (chủ ý); không có host OpenPLC |
| Liên kết tag | `program_symbols` (tên, địa chỉ tự do) | **không có khoá ngoại tới `device_tags` / cổng gói**; `ProgramSource.symbols` không được điền khi build |
| Hãng | adapter Mitsubishi = bảng recipe ghi D/M qua dispatcher (không phải dự án GX Works) | **0** dòng mã Delta/Inovance |

### 2.2 Mục tiêu · không mục tiêu

- **G12.1** Kỹ sư vẽ quy trình tuần tự (bước → điều kiện → hành động) bằng chọn/kéo, **không gõ ST**, cho 3 hãng chính.
- **G12.2** Mô phỏng ngay trên lưu đồ: bước đang chạy sáng, thời gian bước, biểu đồ tín hiệu, giả lập lỗi — nối với nhà máy ảo K13.
- **G12.3** Sinh **gói giao cho phần mềm hãng** (không tự nạp PLC thương mại): đúng định dạng nhập được của từng họ PLC.
- **G12.4** Giám sát online: khi PLC thật chạy, lưu đồ hiện bước hiện hành từ giá trị tag sống (SCADA live cache).
- **NG** Không thay CODESYS/GX Works; không sinh logic an toàn (E-stop/SIL); không tự nạp xuống PLC thương mại; không hỗ trợ motion/high-speed counter của hãng ở bản đầu.

### 2.3 Mô hình "lưu đồ" — mở rộng SFC của `pouModel`, không tạo mô hình thứ ba

Lý do *(quyết định của tôi)*: SFC là chuẩn lưu đồ PLC quốc tế, `pouToSt` + `plcopenXml` + linter đã có. Mô hình IR robot là tuần tự chặn — sai bản chất cho chu kỳ quét PLC.

Mở rộng (chỉ thêm, Zod `discriminatedUnion`, bản ghi cũ vẫn hợp lệ):

```ts
// Hành động có kiểu, thay cho actionText ST tự do (actionText vẫn giữ làm "lối thoát" cho chuyên gia)
type SfcAction =
  | { kind: "coil";    qualifier: "N" | "S" | "R" | "P"; target: SignalRef }          // bật/tắt đầu ra
  | { kind: "assign";  qualifier: "N" | "P"; target: SignalRef; value: Literal | SignalRef }
  | { kind: "counter"; op: "inc" | "reset"; counter: string }                        // thực hiện khi VÀO bước
  | { kind: "timer";   name: string; preset: string /* T#2S */ }                       // hẹn giờ có tên dùng lại được
  | { kind: "st";      qualifier: "N" | "P"; text: string };                          // lối thoát (chỉ quyền kỹ sư)

type Condition =                                   // điều kiện chuyển — cây, không phải chuỗi ST
  | { kind: "signal";  ref: SignalRef; eq: boolean }
  | { kind: "compare"; ref: SignalRef; op: "<" | "<=" | ">" | ">=" | "="; value: number }
  | { kind: "stepTime"; atLeast: string }           // T#600MS
  | { kind: "counter"; counter: string; atLeast: number }
  | { kind: "all" | "any"; of: Condition[] }
  | { kind: "not"; of: Condition };

type SignalRef = { symbol: string }   // lưu đồ chỉ biết TÊN tín hiệu hình thức; gán vào đâu là việc của "bộ gán" (§2.3a)
interface SfcStepX { name; initial?; actions: SfcAction[]; watchdog?: string /* T#3S */; comment? }
interface SfcTransitionX { from; to; priority: number; condition: Condition }   // thứ tự ưu tiên tường minh
interface FlowChart { steps; transitions; stopRule?: { condition: Condition; to: string; resetLatches: true } }
```

- **Tương thích bản ghi cũ:** discriminated union mới KHÔNG tự nhận bản ghi cũ (`{qualifier, actionText}` không có `kind`; `condition` là chuỗi ST). Thêm bước tiền xử lý trong Zod `preprocess`: hành động cũ ⇒ `{kind:"st", qualifier, text}` (biến thể `st` nhận đủ N/S/R/P/L/D để không làm hỏng bản cũ; L/D vẫn bị linter chặn khi sinh mã); điều kiện chuỗi ⇒ `{kind:"st", text}` thêm vào `Condition`. Dev hiện có 0 artifact SFC nên rủi ro thấp, nhưng vẫn giữ tiền xử lý.
- `pouModel` thêm kiểu biến `{ fb: string }` — **danh sách mở**: kiểm theo bảng `STD_FB` sẵn có trong `stParser.ts` (TON, TOF, TP, CTU, CTD, CTUD, R_TRIG, F_TRIG, SR, RS) ∪ tên FB người dùng khai trong cùng dự án. Đổi `pouVar.type` thành hợp `IecType | {fb}` lan tới `iecTypeCategory`, bộ in biến và `pouToSt` (đang ép kiểu `as unknown as PouVar["type"]`) — tính vào công V4. Sửa `readTypeName` đọc `<derived name=…>`; FB lạ ngoài danh sách ⇒ nhập được dưới dạng `{fb}` + cảnh báo, không làm hỏng cả tệp.

#### 2.3a Gán tín hiệu — một chỗ, có phiên bản *(quyết định của tôi)*
- Lưu đồ chỉ chứa **tín hiệu hình thức** (`symbol`). Danh sách tín hiệu hình thức được **chụp vào artifact** khi lưu phiên bản (bất biến cùng artifact) — không dựa vào `program_symbols` (thuộc dự án, đổi được, đang 0 hàng).
- Gán tín hiệu → đích nằm ở bảng mới, có phiên bản, theo **đích**:
```sql
CREATE TABLE program_bindings (
  id serial PRIMARY KEY, artifact_id integer NOT NULL REFERENCES program_artifacts(id),
  target_kind varchar(8) NOT NULL CHECK (target_kind IN ('scene','plant')),
  target_id integer NOT NULL,                 -- sim_scenes.id | production_lines.id
  version integer NOT NULL, map jsonb NOT NULL, -- { symbol: { item|machineId, port } | { deviceTagId } }
  created_by integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (artifact_id, target_kind, target_id, version)
);
```
- Địa chỉ hãng (X0/%IX0.0) khi xuất: lấy từ `device_tags.address` của bộ gán `plant`; nếu chưa có máy thật thì từ bảng phân bổ địa chỉ mặc định theo họ PLC (§2.5). Build ghi `bindingId` vào `program_builds` ⇒ dựng lại được y hệt.
- Mẫu quy trình (template) = một `FlowChart` có tham số (tên tín hiệu hình thức) — băng tải, start/stop interlock, chiết rót, gắp‑đặt, đèn tháp. Áp mẫu ⇒ người dùng gán tham số vào cổng thật.

### 2.4 Sinh mã (lowering) — mở rộng `pouToSt`

Mẫu đã chạy được trong nguyên mẫu 1 (giữ nguyên ngữ nghĩa):
```
VaoBuoc := Buoc <> BuocTruoc;  BuocTruoc := Buoc;
TgBuoc(IN := NOT VaoBuoc, PT := T#24H);                  (* thời gian trong bước *)
IF VaoBuoc THEN CASE Buoc OF … (* S/R/counter/P khi vào bước *) END_CASE; END_IF;
IF <stopRule> THEN Buoc := <đầu>; <xoá giữ> ELSE CASE Buoc OF … IF/ELSIF theo priority … END_CASE; END_IF;
<đầu ra> := <giữ> OR (Buoc = i) OR …;                    (* N gom thành OR một lần — không "double coil" *)
CanhBaoQuaGio := (Buoc = i AND TgBuoc.ET > T#…) OR …;
```
- `BuocTruoc` khởi tạo **−1** (khác mọi chỉ số bước) để hành động "khi vào bước" của bước đầu chạy ở chu kỳ quét đầu tiên.
- Thời gian trong ST so sánh bằng `TIME` nguyên (ms), sinh hằng `T#…MS` — tránh cộng dồn TIME kiểu `T#993ms+T#7ms` (MATIEC có lỗi so sánh dạng này, đã ghi ở bench).
- Qualifier S/R qua biến `_Giu`; P qua cờ `VaoBuoc`; counter qua `VaoBuoc`. L/D: **chưa** (khai báo lỗi linter rõ ràng).
- Linter thêm: bước không có đường ra, bước không tới được, điều kiện thời gian che điều kiện sau, đầu ra bị N ở bước này mà R ở bước khác, tín hiệu chưa gán.

### 2.5 Gói giao cho phần mềm hãng (handoff)

| Họ PLC | Phần mềm | Nền CODESYS? | Tệp sinh ra | Cách đưa vào | Mức chắc |
|---|---|---|---|---|---|
| CODESYS gốc | CODESYS V3.5 | — | PLCopen XML TC6 v2.01 (ST POU + biến FB `derived`) | Project → Import PLCopenXML | tài liệu hãng; CODESYS tự nói chỉ nhận **một phần** chuẩn |
| Inovance AM400/600, AC700/800 | InoProShop | có | như trên | menu kế thừa CODESYS | **[chưa kiểm]** tài liệu Inovance |
| Delta AX‑3/AX‑8 | DIADesigner‑AX | có (V3.5) | như trên | như trên | **[chưa kiểm]** tài liệu Delta |
| Mitsubishi iQ‑F FX5, iQ‑R | GX Works3 | không | **CSV nhãn toàn cục** (cột khớp theo tiêu đề) + **thân ST để dán** | Global Label → Edit → Import File; dán ST | CSV: sổ tay SH‑081215ENG; tên FB TON và tên cột theo phiên bản **[chưa kiểm]** |
| Mitsubishi FX3 (dự án Simple) | GX Works2 | không | **step‑ladder STL** (phương ngữ FX: `STL/SET/OUT/ANI`, `M8002`, timer gốc 100 ms) | chế độ List | **[chưa kiểm]** trên máy |
| Delta AS200/300 | ISPSoft V3 | không | **CSV ký hiệu** (Class, Identifier, Address, Type) + thân ST | nhập bảng ký hiệu; dán ST | **[chưa kiểm]** |
| Delta DVP | WPLSoft/ISPSoft | không | STL phương ngữ Delta (`TMR/CNT`, `M1002`) | chế độ Instruction | **[chưa kiểm]** |
| Inovance H3U/H5U/Easy | AutoShop | không | STL phương ngữ FX (H5U có thể có LiteST tuỳ firmware **[chưa kiểm]**) | IL editor | **[chưa kiểm]** |

- Bộ dịch STL dùng chung một backend cho FX/Delta/Inovance H, khác nhau ở bảng phương ngữ (`TMR` vs `OUT T`, `M1002` vs `M8002`). Ưu tiên điều kiện bằng chuỗi `ANI` các điều kiện trước (đã có trong nguyên mẫu 1).
- Bảng địa chỉ theo họ: CODESYS `%IX0.0/%QX0.0` · FX/Inovance H/DVP `X0..X7,X10` hệ 8 · Delta AS `X0.0` · iQ‑R X/Y hệ 16.
- Mỗi gói kèm `README` (bảng I/O, ảnh lưu đồ, ghi chú an toàn) — lưu thành `program_artifacts` + `program_builds.outputRef`.
- Lưu ý kiểu: `program_builds."adapterKind"` là pg enum `programmingkindenum` NOT NULL ⇒ các loại xuất hãng (`handoff-plcopen`, `handoff-gxw3`, `handoff-isp`, `handoff-stl-fx`, `handoff-stl-delta`) cần V1 (bỏ enum) **hoặc** migration `ADD VALUE` trước V5.
- **Nghiệm thu bắt buộc:** nhập thử **mỗi định dạng một lần trên phần mềm thật** trước khi bật cho người dùng (cần bản quyền/máy cài — xem Q8).
- Tuỳ chọn sau: GX Works3 Open Interface (DLL lấy từ Mitsubishi) để nhập/xuất tự động.

### 2.6 Mô phỏng và giám sát

| Nguồn điều khiển | Dùng khi | Cài đặt |
|---|---|---|
| (a) **Bộ thông dịch lưu đồ** | soạn và thử nhanh | chạy trong Web Worker của K13, cùng chu kỳ quét 10–20 ms; ngữ nghĩa phải **trùng** ST đã sinh (kiểm bằng test so sánh: cùng kịch bản I/O ⇒ cùng vết bước) |
| (b) **MATIEC chạy chính mã ST** | chứng minh *mã* đúng trước khi giao hãng | chỉ tái dùng bước `iec2c` → gcc của bench `st-matiec`; **bộ chạy chu kỳ là việc mới**: `main.c` riêng chạy vòng lặp, mỗi lần nhận một khung I/O qua stdin, chạy **đúng một** chu kỳ quét trên đồng hồ ảo, trả khung đầu ra (lockstep với bộ chạy K13). Docker `--network none`, giới hạn RAM/pids. MATIEC là GPL‑3.0 ⇒ **không đóng gói kèm sản phẩm**: là thành phần tuỳ chọn do vận hành cài (ảnh Docker dựng từ mã nguồn công khai, không dựa ảnh cục bộ `avi-openplc-bench`). Thiếu ⇒ nguồn (b) tắt, ghi rõ trên giao diện. |
| (c) **PLC thật / simulator hãng** | nghiệm thu ảo (virtual commissioning) | K13 phơi I/O ảo bằng **Modbus TCP server** (+ OPC UA server sau); PLC đọc/ghi qua vùng nhớ truyền thông. Giới hạn thật: PLC bình thường dùng I/O vật lý ⇒ chương trình PLC cần **lớp ánh xạ I/O** (chế độ mô phỏng đọc thanh ghi thay vì X/Y). Phải ghi rõ trong hướng dẫn (Q7). |

- Giám sát online: biến `Buoc` + `TgBuoc` của chương trình được khai làm kênh (K1) ⇒ lưu đồ sáng bước theo `scada:delta` (K3/K6). Không ghi gì xuống PLC từ màn này.

### 2.7 Giao diện (từ nguyên mẫu 1 đã duyệt)
Lưu đồ dọc bước–điều kiện; ô thuộc tính chọn từ danh sách; mẫu quy trình; nhà máy ảo cạnh lưu đồ; tab biểu đồ tín hiệu / mã ST / xuất hãng / bảng địa chỉ; thử gây lỗi; giám sát quá giờ bước. Đặt ở `/engineering/luu-do` (route cụ thể để người xây chọn), dùng lại `PouCanvas` (xyflow) cho phần vẽ.

### 2.8 Nghiệm thu K12
- Vẽ lại mẫu "phân loại hộp" từ trống < 15 phút, 0 dòng ST gõ tay.
- Cùng 20 kịch bản I/O: vết bước của (a) bộ thông dịch **trùng khớp** (b) MATIEC chạy ST sinh ra.
- 8 định dạng xuất: mỗi định dạng nhập thành công trên phần mềm hãng (ảnh chụp + phiên bản phần mềm lưu vào hồ sơ nghiệm thu).
- Nhập PLCopen XML do CODESYS xuất (có TON/CTU) ⇒ không lỗi.
- Linter bắt đủ 5 lỗi mẫu (đột biến biết trước).

---

## 3. K13 — Nhà máy ảo 3D (kiểu Factory I/O)

### 3.1 Hiện trạng đã đo (2026-10-23)
- Twin 3D hiện có là **màn giám sát tốt** (điểm 4/5) nhưng **không có chuyển động, hành vi, cảm biến, sản phẩm, ánh xạ I/O** (điểm sẵn sàng nhà máy ảo 1/5). Spec twin chủ ý loại vật lý/động học.
- Rapier chỉ chạy ở server (kiểm quỹ đạo robot, cờ OFF). `/twin` không nạp GLB nào; mọi máy là khối thủ tục. GLB là khối kín — chưa có cơ chế gắn bộ phận vào tín hiệu.
- Dùng lại được: khung cảnh dùng chung `loi/KhungCanh.tsx`, hệ toạ độ mm `heToaDo.ts`, nhập CAD (OCCT worker), `BatchedMesh`, phiên bản bố cục `twin_ban_ghi`.

### 3.2 Mô hình dữ liệu cảnh

*(Quyết định của tôi: cảnh ảo **tách** khỏi twin vận hành — twin là sự thật của nhà máy, cảnh ảo là bản nháp thử nghiệm; có nút "Sao chép line thật sang cảnh ảo".)*

```sql
-- 0450_nha_may_ao.sql
CREATE TABLE sim_scenes (
  id serial PRIMARY KEY, name varchar(128) NOT NULL, factory_id integer, line_id integer,   -- phạm vi quyền
  source varchar(16) NOT NULL DEFAULT 'blank',          -- blank | copy_of_line | template
  controller jsonb NOT NULL DEFAULT '{"kind":"flow"}',  -- flow(programArtifactId) | matiec(buildId) | plc(adapterId)
  settings jsonb NOT NULL DEFAULT '{}',                 -- tốc độ, trọng lực, seed ngẫu nhiên
  version integer NOT NULL DEFAULT 1, created_by integer NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sim_scene_items (
  id serial PRIMARY KEY, scene_id integer NOT NULL REFERENCES sim_scenes(id) ON DELETE CASCADE,
  package_version_id integer NOT NULL REFERENCES device_package_versions(id),   -- ghim đúng phiên bản gói (K14)
  name varchar(128) NOT NULL,
  x_mm numeric(14,3) NOT NULL, y_mm numeric(14,3) NOT NULL, z_mm numeric(14,3) NOT NULL,   -- cùng kiểu twin_dat_cho
  quat_x double precision NOT NULL, quat_y double precision NOT NULL, quat_z double precision NOT NULL, quat_w double precision NOT NULL,
  params jsonb NOT NULL DEFAULT '{}',                   -- ghi đè tham số gói cho riêng vật này (chiều dài băng tải …)
  port_map jsonb NOT NULL DEFAULT '{}'                  -- cổng → tín hiệu I/O ảo
);
CREATE TABLE sim_runs (                                  -- mỗi lần chạy: để phát lại và so sánh
  id bigserial PRIMARY KEY, scene_id integer NOT NULL REFERENCES sim_scenes(id) ON DELETE CASCADE, scene_version integer NOT NULL,
  controller jsonb NOT NULL, started_by integer NOT NULL, started_at timestamptz NOT NULL DEFAULT now(),
  duration_ms integer, faults jsonb, kpi jsonb,          -- đúng/sai phân loại, nhịp, kẹt…
  trace_ref text                                         -- tệp vết tín hiệu (nén) để phát lại
);
```

- "Sao chép line thật sang cảnh ảo": máy chưa có gói dùng **gói tĩnh mặc định của lớp** (§4.6a) ⇒ `package_version_id` luôn có giá trị.

### 3.3 Bộ chạy mô phỏng (engine)
- **Một mã nguồn chạy được ở cả trình duyệt và Node** (gói TS thuần trong `shared/`, không DOM, không React). *(Quyết định của tôi.)*
  - Nguồn (a) lưu đồ: chạy trong **Web Worker** của trình duyệt.
  - Nguồn (b) MATIEC, (c) PLC thật, và **kiểm thử gói khi gửi duyệt**: chạy trong **worker_threads trên máy chủ** (máy chủ là nơi có tin cậy). Trình duyệt chỉ vẽ, nhận trạng thái qua Socket.IO ~30 khung/s — vẽ không cần 10 ms. Trễ vòng ≤ 50 ms (§3.7) là giữa bộ chạy máy chủ và PLC, cùng phía máy chủ.
  - `tests_passed_at` của gói chỉ do **máy chủ** ghi (chạy lại kịch bản khi gửi duyệt); kết quả hộp cát ở trình duyệt chỉ là xem trước.
- Bước cố định **10 ms**, tách khỏi khung hình: luồng chính chỉ vẽ.
- **Ưu tiên động học** (kinematic-first): cơ cấu chấp hành đặt vị trí trực tiếp theo hành vi (xác định, rẻ). **Rapier (WASM) trong worker** chỉ cho *sản phẩm* (hộp trên băng tải, rơi vào thùng, bị kẹp) — cơ cấu là vật thể kinematic.
- Cảm biến: tia (raycast), vùng tiệm cận (overlap), khoảng cách; lọc theo thuộc tính sản phẩm (cao/thấp, màu, mã).
- Trạng thái gửi về luồng chính mỗi khung bằng `Float32Array` chuyển nhượng (vị trí/quaternion theo chỉ số), không qua React state.
- Thời gian: tạm dừng, một nhịp, ×0,5…×4; seed ngẫu nhiên cố định ⇒ chạy lại cho cùng kết quả.
- Ghi vết tín hiệu mỗi nhịp ⇒ **phát lại và tua** đồng bộ cả lưu đồ, biểu đồ tín hiệu và cảnh 3D (học MELSOFT Gemini).
- Giả lập lỗi: kẹt cảm biến 0/1, xi lanh kẹt giữa hành trình, băng tải trượt, mất truyền thông, kẹt sản phẩm — khai trong gói (hành vi `FaultInjector`) hoặc chung.

### 3.4 Bus I/O ảo và ba nguồn điều khiển
- Bảng I/O ảo của cảnh: tín hiệu `X*/Y*/D*` (tên tuỳ hãng) ↔ cổng các vật (`port_map`), xuất/nhập CSV (học Factory I/O).
- Nguồn (a)/(b)/(c) như §2.6. Nguồn (c) cần **máy chủ thiết bị ảo**: Modbus TCP server (thư viện `modbus-serial` đã có phần server) bind `127.0.0.1` hoặc mạng thử nghiệm riêng, không bao giờ trên mạng sản xuất; cờ `SIM_DEVICE_SERVER_ENABLED`, OFF.

### 3.5 Hiển thị và hiệu năng (ngân sách bắt buộc)
| Chỉ số | Ngân sách |
|---|---|
| Cảnh 200 vật + 500 sản phẩm | ≥ 55 fps trung vị, p95 khung ≤ 20 ms, không khung > 50 ms trong 30 s |
| Lệnh vẽ | ≤ 150/khung (instancing theo mô hình gói; sản phẩm 1 `InstancedMesh`/loại) |
| Nạp cảnh | ≤ 3 s tới khung đầu (GLB nén meshopt + KTX2, tải trước 8 mô hình gần nhất) |
| Bộ nhớ | không tăng > 10 % sau 10 phút chạy |
| Nhãn | một lớp phủ, vị trí tính 1 lần/khung từ bộ đệm hình chữ nhật (không `getBoundingClientRect` lặp) |
| React | 0 lần render lại cây React do mô phỏng (dữ liệu chạy qua ref/store ngoài React) |

### 3.6 Giao diện (từ nguyên mẫu 2 đã duyệt)
Khung 3D lớn + ngăn bên (Lưu đồ / Ánh xạ I/O / Linh kiện); kéo thả bắt lưới; xoay 90° (bản thật: gizmo xoay + bắt góc 15° dùng lại `GizmoBienDoi`); bảng tín hiệu; kết quả (đúng/sai/rơi sàn); thử gây lỗi; chọn nguồn điều khiển.

### 3.7 Nghiệm thu K13
- Dựng lại cảnh "phân loại hộp" của nguyên mẫu 2 từ gói thư viện < 20 phút; chạy 10 phút: 100 % phân loại đúng với lưu đồ đúng; dời cảm biến "hộp cao" 1 m ⇒ tỉ lệ sai tăng (đo được).
- Cùng cảnh, cùng seed, chạy 2 lần ⇒ vết tín hiệu giống hệt.
- Nguồn (b): kết quả KPI trùng nguồn (a) trên 20 kịch bản.
- Nguồn (c): PLC thật (hoặc OpenPLC bench) đọc/ghi I/O ảo qua Modbus TCP, độ trễ vòng ≤ 50 ms trên LAN thử nghiệm.
- Đạt mọi ngân sách §3.5 (đo bằng harness, đột biến "bỏ instancing" phải làm đỏ phép đo).

---

## 4. K14 — Thư viện thiết bị (gói thiết bị + Xưởng thiết bị)

### 4.1 Hiện trạng đã kiểm
- Loại máy là **pg enum** `machinetypeenum` (24 giá trị) ✔; thêm một loại = migration không gỡ được + ~14 chỗ sửa bắt buộc trong ~13 tệp. Lần thêm WELDER/IOT thật: **38 tệp, +1.802 dòng** (`9da2e946e`) ✔.
- Cùng danh sách bị **chép tay ~9 nơi** và đã lệch: `machineRecipeRouter.ts:155` chỉ 17 giá trị ⇒ **từ chối tạo recipe** cho MOUNTER/REFLOW/WELDER/IoT… ✔ (lỗi thật); `machineTypeEnum.f2.test.ts` vẫn kỳ vọng 21.
- `device_types` có kế thừa, SemVer, CR duyệt (`governanceService`) nhưng **runtime không đọc** (`getCapabilitiesForMachine` chỉ dùng hồ sơ trong mã).
- Pg enum cũng khoá: `otProtocolEnum` (plugin giao thức mới không lưu được adapter), `robotVendorEnum`, `programmingKindEnum`, khoá chính `twin_kich_thuoc_loai`.
- Thiếu hẳn: mẫu tag theo loại, thư viện ký hiệu HMI, gói nhập/xuất. Thư viện vật thể Studio là danh sách viết cứng.
- Dùng lại được: governance `device_types`; khung plugin ký Ed25519 (`pluginSignature`, `pluginConformance`); `mappingAsCode` (diff/chạy thử/áp); đường STEP/URDF; `equipment_3d_models` theo lớp.

### 4.2 Điều kiện tiên quyết — bỏ pg enum cho khoá mở rộng (làm ĐẦU TIÊN)

| Enum | Bảng dùng | Thay bằng |
|---|---|---|
| `machinetypeenum` | `machines`, `machine_recipes`, `process_results`, `process_result_daily`, PK `twin_kich_thuoc_loai` (đã kiểm catalog: không view/policy/hàm/default nào phụ thuộc) | `varchar(32)` (khớp khai báo đang lệch sẵn trong `drizzle/schema/twin3d.ts`) + kiểm theo **lớp thiết bị** = `device_types.typeKey` đã công bố (§4.3a) |
| `otProtocolEnum` | `device_adapters.protocol` | `varchar(32)` + kiểm theo `driverRegistry` lúc ghi |
| `robotVendorEnum`, `programmingKindEnum` | `robots`, `program_*` | `varchar` + registry |

Kế hoạch an toàn: (1) migration `ALTER COLUMN … TYPE varchar(32) USING col::text` từng bảng (viết lại bảng dưới khoá độc quyền ⇒ cửa sổ bảo trì; chỉ mục tự dựng lại), có CHECK tạm bằng danh sách hiện tại; **giữ** kiểu `machinetypeenum` tới khi sửa xong các script/test đang ép `::machinetypeenum` hoặc đọc `pg_enum` (`scripts/sinh-tai-twin.ts`, `edgeResolution.dot10.db.test.ts`, `robotStopDegradedAuth.dot10.db.test.ts`…), rồi mới `DROP TYPE`; (2) `MACHINE_TYPES` + `machine.listTypes` **đã có** — việc thật là chuyển các bản chép tay còn lại (recipe router 17 giá trị, `FALLBACK_MACHINE_TYPES`, union client, `sinh-tai-twin`, `hinhKhoiMay`…) sang đọc từ đó; (3) census test: grep AST mọi `z.enum([` chứa ≥ 5 mã loại máy ⇒ đỏ; (4) sửa luôn enum rẽ nhánh của recipe router.

#### 4.3a "Lớp thiết bị" là gì *(quyết định của tôi)*
- **Lớp** = `device_types.typeKey` đã công bố (cây kế thừa, lệnh, trạng thái) — do quy trình duyệt `device_types` sẵn có tạo. `machines.machineType` (varchar sau V1) giữ đúng giá trị lớp lá; `machines.device_type_key` đã đóng dấu từ doc 56 tiếp tục dùng.
- **Gói** thuộc về đúng một lớp (`device_packages.device_class`). Công bố gói **không** tạo lớp mới; lớp mới đi đường duyệt `device_types` (sau V1: 0 migration).
- Thứ tự ưu tiên năng lực của một máy: `machines.capabilities` (ghi đè riêng máy) > manifest gói mà máy ghim > hồ sơ lớp `device_types` > mặc định trong mã.
- `getCapabilitiesForMachine` hiện **đồng bộ, không truy DB**, ~20 nơi gọi ⇒ không đổi chữ ký: thêm **bộ đệm trong RAM** các manifest đã công bố, nạp lúc khởi động và làm mới khi có sự kiện `device_package.published` (qua event bus/fan-out). Đây là thay đổi **không chỉ thêm** — cần chủ dự án duyệt riêng (Q9) và chạy trên bản sao DB trước.

### 4.3 Gói thiết bị — dữ liệu

```sql
-- 0451_thu_vien_thiet_bi.sql
CREATE TABLE device_packages (                      -- một loại thiết bị
  id serial PRIMARY KEY, package_key varchar(96) UNIQUE NOT NULL,   -- noibo.may-dan-nhan
  name varchar(128) NOT NULL, device_class varchar(64) NOT NULL,     -- lớp trong device_types (kế thừa lệnh/trạng thái)
  owner_factory_id integer, created_by integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE device_package_versions (              -- BẤT BIẾN sau khi công bố
  id serial PRIMARY KEY, package_id integer NOT NULL REFERENCES device_packages(id),
  version varchar(32) NOT NULL, status varchar(16) NOT NULL,          -- draft|review|published|deprecated|retired
  manifest jsonb NOT NULL,                                           -- §4.4
  surface_hash char(64) NOT NULL,                                    -- băm "mặt công khai"
  live_bindable boolean NOT NULL DEFAULT false,
  tests_passed_at timestamptz, signed_by integer, signature text,    -- Ed25519 như plugin
  published_at timestamptz, created_by integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (package_id, version)
);
CREATE TABLE device_package_assets (                -- tệp: GLB, va chạm, ảnh, tài liệu, nguồn gốc (STEP/IODD/URDF)
  id serial PRIMARY KEY, version_id integer NOT NULL REFERENCES device_package_versions(id),
  role varchar(24) NOT NULL, uri text NOT NULL, sha256 char(64) NOT NULL, bytes integer NOT NULL
);
CREATE TABLE device_package_approvals (
  id serial PRIMARY KEY, version_id integer NOT NULL, approver_id integer NOT NULL, role varchar(32) NOT NULL,
  decision varchar(8) NOT NULL, comment text, at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (version_id, approver_id)
);
ALTER TABLE machines ADD COLUMN device_package_version_id integer REFERENCES device_package_versions(id);   -- máy thật ghim phiên bản gói (nullable)
-- device_package_approvals.version_id REFERENCES device_package_versions(id)
-- trigger 1: chặn UPDATE manifest/surface_hash/version khi status <> 'draft'
-- trigger 2: chặn INSERT/UPDATE/DELETE device_package_assets của phiên bản đã rời 'draft' (tệp cũng bất biến; sha256 nằm trong phần được ký)
```

### 4.4 Manifest (JSON, có `schemaVersion`)
```jsonc
{
  "schemaVersion": 1,
  "identity": { "key": "noibo.may-dan-nhan", "version": "1.2.0", "name": "Máy dán nhãn", "class": "PACKAGING", "vendor": "…", "model": "…" },
  "geometry": { "visual": "asset:visual.glb", "collision": [{ "node": "Than_may", "shape": "box", "size": [0.5,1.05,0.45] }], "units": "m" },
  "joints":   [{ "node": "Tay_dan", "type": "prismatic", "axis": "z", "min": 0, "max": 0.25 }, { "node": "Con_lan", "type": "continuous", "axis": "x" }],
  "behaviors":[{ "id": "b1", "kind": "LinearAxis", "joint": "Tay_dan", "mode": "bangbang", "time": 0.6, "ports": { "cmd": "b1_cmd", "ext": "b1_ext", "ret": "b1_ret" } }],
  "ports":    [{ "key": "b1_cmd", "name": "Lệnh đẩy ra", "dir": "out", "type": "BOOL", "unit": null, "actuationLevel": 3 }],
  "protocols":{ "modbus": { "coilBase": "${goc}+0", "diBase": "${goc}+0" }, "slmp": { "…": "…" }, "opcua": { "browse": "${may}/${port}" } },
  "hmi":      { "symbol": "asset:symbol.svg", "hooks": { "Tay_dan": { "translate": "b1_ext" } } },
  "alarms":   [{ "key": "B1_TIMEOUT", "condition": { "watchdog": "b1_cmd→b1_ext", "ms": 1100 }, "priority": "high", "text": { "vi": "…", "en": "…" } }],
  "tests":    [{ "name": "ra hết", "set": { "b1_cmd": true }, "expect": { "b1_ext": true }, "withinMs": 1100 }],
  "provenance": { "imported": ["iodd:…"], "edited": ["ports[0].name"] }
}
```
- **Mặt công khai** = khoá cổng + chiều + kiểu + đơn vị, tên khớp, khoá cảnh báo, tham số. `surface_hash` băm phần này.
- `actuationLevel` của cổng RA dùng **cùng thang L7/K5** (1 dừng … 5 chuyển động/an toàn) ⇒ cổng ghi mức ≥ 4 đòi OTP như K5.

### 4.5 Bộ hành vi cơ bản (bộ chạy dùng chung K13 + hộp cát)
| # | Hành vi | Tham số | Cổng |
|---|---|---|---|
| 1 | LinearAxis | hành trình, tốc độ/gia tốc, kiểu bang‑bang/servo | cmd hoặc targetPos · ext/ret/actPos/inPos |
| 2 | RotaryAxis | giới hạn/liên tục, tốc độ, chia độ | run/dir/targetAngle · actAngle |
| 3 | ConveyorSurface | nút bề mặt, hướng, tốc độ, đảo chiều, tích luỹ | run/rev/speedSP · actSpeed |
| 4 | Gripper | vùng kẹp, thời gian, hút/kẹp | close · gripped/partPresent |
| 5 | PresenceSensor | tia/vùng/khoảng cách, lọc, NO/NC, trễ | out / distance |
| 6 | VisionTrigger | vùng nhìn, thời gian xử lý, luật kết quả | trigger · busy/ok/code |
| 7 | Indicator | đèn/đèn tháp/còi/chữ | on/color/text |
| 8 | Source / Sink | mẫu sản phẩm, nhịp/theo lệnh | spawn · count |
| 9 | Stopper / Diverter | biến thể 1/2 chặn/gạt luồng | raise/divert |
| 10 | Logic | đếm/hẹn giờ/latch nhỏ | nội bộ |
| 11 | ValveFlowTank | van on/off/tỉ lệ, lưu lượng bậc 1, mức bồn | open/SP · level/flow/hi/lo |
| 12 | RobotArm | chuỗi URDF + IK + tư thế đặt tên | goPose#/target · inPos/busy |
| 13 | MotorDrive | dốc tốc độ, run/fault/ready | run/freqSP · ready/fault/actFreq |
| 14 | FaultInjector | kẹt, cảm biến kẹt, quá hành trình, mất truyền thông | inject# (chỉ thử nghiệm) |

Lối thoát cho hành vi phức tạp: FMU (FMI 3.0) biên dịch WASM, chạy hộp cát có ngân sách CPU, không mạng/tệp — **giai đoạn sau**, không trong bản đầu.

### 4.6a Thư viện khởi đầu
- **Hình học thủ tục được phép** trong manifest: `geometry.visual` nhận `asset:*.glb` **hoặc** `procedural:<hình>` (tái dùng 7 hình của `hinhKhoiMay.ts` + khối cơ bản hộp/trụ/băng). Gói khởi đầu (băng tải, cảm biến quang, xi lanh, chặn, gạt, nguồn/điểm thu, thùng, đèn tháp, tủ nút) dùng hình thủ tục — không chờ ai cung cấp GLB.
- Mỗi lớp lá có sẵn **một gói tĩnh mặc định** (hình thủ tục của lớp, 0 hành vi, 0 cổng) do migration seed tạo ⇒ mọi máy thật có gói để "sao chép line sang cảnh ảo".

### 4.6 Xưởng thiết bị (trang quản lý — từ nguyên mẫu 3 đã duyệt)
Bảy bước: Thư viện → Mô hình → Bộ phận chuyển động → Hành vi → Cổng I/O & giao thức → Chạy thử → Kiểm tra & công bố.
- Nguồn tạo: **nhân bản loại có sẵn** (cách thường dùng nhất) · nhập GLB · nhập STEP/IGES (đổi GLB bằng đường OCCT sẵn có) · URDF (robot) · IODD/GSDML (điền cổng + mẫu tag) · AASX/AML (giai đoạn sau).
- Chuẩn hoá: đơn vị (mm → m), trục, gốc toạ độ; tự sinh LOD + khối va chạm; giới hạn polygon theo `kiemTraAsset`.
- Chạy thử = hộp cát dùng **bộ chạy K13**; kịch bản tự sinh từ hành vi + kịch bản tay; phải đạt trước khi gửi duyệt.
- Kiểm tự động: cổng chưa dùng, bộ phận gắn khớp không tồn tại, khớp sai kiểu với hành vi, tên trùng, thiếu cổng VÀO, ngân sách hình học.

### 4.7 Quản trị
- **Quyền:** hệ quyền chỉ có 5 hành động (canView/Create/Edit/Delete/Export) và không có vai "kỹ sư điều khiển" ⇒ dùng **hai module**: `device_library` (xem/tạo/sửa) và `device_library_approve` (`canEdit` = được duyệt). Duyệt cần vai engineer/supervisor/admin **và** quyền `device_library_approve`, **khác người tạo**. Gói `live_bindable` cần **2 người duyệt khác nhau**, trong đó ít nhất một người có thêm quyền `machine_control.canEdit` (người được phép điều khiển thiết bị).
- **Ký số** *(quyết định của tôi)*: khoá riêng **của từng cài đặt** (một máy chủ/nhà máy) giữ ở máy chủ (tệp khoá ngoài DB, đường dẫn qua biến môi trường); chữ ký phát hiện sửa trực tiếp DB/tệp sau khi công bố. Người duyệt được ghi ở `device_package_approvals`, không ký riêng. Chuyển gói giữa nhà máy (sau này) ⇒ bảng khoá công khai tin cậy; hiện chỉ một nhà máy nên chưa làm.
- **Phiên bản:** máy (ảo và thật) ghim `id@version`; công bố tự so mặt công khai: đổi hình/tài liệu ⇒ VÁ; thêm cổng tuỳ chọn ⇒ NHỎ; bỏ/đổi cổng/đơn vị/tên khớp ⇒ LỚN + **bản đồ chuyển đổi** bắt buộc. Nâng cấp từng máy có xem trước diff và hoàn tác.
- **Vòng đời:** nháp → chờ duyệt → công bố → ngừng dùng (ẩn khỏi bảng, máy cũ vẫn chạy) → thu hồi (cấm đặt mới).
- **Ký số:** băm tệp + Ed25519 khi công bố (tái dùng `pluginSignature`); máy chủ từ chối gói sai chữ ký.
- **Nguồn gốc:** lưu nguyên tệp IODD/GSDML/STEP vào `device_package_assets` role `source`; manifest ghi trường nào nhập, trường nào sửa tay.

### 4.8 Ai dùng gói (nối vào thiết kế SCADA)
| Nơi dùng | Lấy gì từ gói |
|---|---|
| K13 nhà máy ảo | mô hình, khớp, hành vi, cổng |
| K12 lưu đồ | bộ chọn tín hiệu = cổng; mẫu quy trình theo lớp thiết bị |
| K1 kênh SCADA | đặt máy thật ⇒ **tự sinh `device_tags`** từ mẫu giao thức (`channel_kind` theo chiều cổng, `actuation_level` từ cổng) |
| K4 cảnh báo | `scada_alarm_defs` sinh từ `alarms` của gói |
| K6 mimic | ký hiệu SVG + điểm gắn động |
| Twin 3D | `equipment_3d_models` phân giải theo gói của máy |
| Capability | `getCapabilitiesForMachine` đọc gói (lệnh/trạng thái từ `device_types` lớp cha) — đóng lỗ "governance không tới runtime" |

### 4.9 Nghiệm thu K14
- Tạo "máy dán nhãn" từ GLB, đặt vào nhà máy ảo và vào một máy thật (sim) **0 dòng mã, < 60 phút**, tự sinh đủ tag + cảnh báo + ký hiệu.
- Sau §4.2: thêm một lớp thiết bị mới **0 migration**; census enum rẽ nhánh = 0; recipe tạo được cho mọi loại máy.
- Bỏ một cổng rồi công bố ⇒ bị chặn nếu không tăng LỚN; máy cũ ghim bản cũ vẫn chạy; nâng cấp giữ dây của cổng không đổi.
- Gói sửa tay sau ký ⇒ máy chủ từ chối.
- Người tạo tự duyệt ⇒ bị chặn; gói `live_bindable` 1 người duyệt ⇒ chưa công bố.

---

## 5. Hiệu năng 3D — đánh giá và việc cần làm

### 5.1 Đo thật (2026-10-23, bản đang chạy :3000, RTX 5090)
| Màn | Khung 3D đầu | FPS xoay 5 s | Khung chậm nhất |
|---|---|---|---|
| `/twin` (41 máy) | 1,2 s | 56 | 50 ms |
| line / máy / `/twin-studio` | 1,3–1,7 s | 60 | 17 ms |

Lõi 3D đã tốt (vẽ theo yêu cầu, 4–8 lệnh vẽ, không rò bộ nhớ). **Thủ phạm giật = bão thông báo**: 220–343 toast critical mỗi lần tải ⇒ CPU 100 % > 60 s, 3D còn 10–19 fps, khung 818 ms. Gốc rễ: adapter Redis của Socket.IO dùng khoá chung `socket.io` cho mọi tiến trình ⇒ tin từ môi trường khác (CSDL test) đổ vào :3000. **Đã vá** (commit `2abddc3fb`, đã gộp `main` và triển khai :3000 lúc ~15:31 ngày 23/10). Số đo sau vá: xem §5.3.

### 5.2 Việc còn lại (xếp theo tác dụng)
| # | Việc | Bằng chứng | Ngày công |
|---|---|---|---|
| H1 | ~~Gộp + triển khai bản vá bão thông báo~~ (xong 23/10); đo lại FPS mọi màn | §5.1 | 0,5 |
| H1b | `server/_core/offlineMonitor.ts:78` phát lại `machine:offline_alert` tới phòng `admin` **mỗi chu kỳ cho mọi máy chưa "đã gửi"** — khi dịch vụ thông báo chưa cấu hình thì không bao giờ đánh dấu ⇒ đo được **3.400 tin/75 s** (~1.700 mỗi đợt/phút) vào socket của mọi admin; client không có ai nghe sự kiện này. Sửa: chỉ phát một lần mỗi đợt offline (nhớ theo `log.id`). **Phiên điều phối đã giao phiên `luong-ui` vá (23/10).** | đo Redis 23/10 | 0,5 |
| H2 | `/corporate-layout` (`Factory3DScene.tsx`) và tab 3D cockpit (`MachineCockpit.tsx:308`, `RobotCockpit.tsx:334`): `frameloop="demand"`, tắt bóng, dpr ≤ 1,5, HDR cục bộ — hoặc thay `/corporate-layout` bằng cảnh tập đoàn (spec twin Đợt 7 đã hứa) | đọc mã | 2 |
| H3 | Nhãn: `layVungCam()` gọi 3–4 lần/khung với `getBoundingClientRect` ⇒ tính 1 lần/khung từ bộ đệm `ResizeObserver` | `LopNhan.tsx:566`, `LopCanhBao.tsx:375` | 1,5 |
| H4 | Tách `TwinVanHanh.tsx` (5.073 dòng, 108 hook) thành phần con đăng ký đúng lát dữ liệu | đọc mã | 3 |
| H5 | GLB: meshopt + KTX2 khi tải lên, tải trước 8 mô hình gần camera, bộ giải Draco tự lưu (không CDN) | không có nén/tải trước | 2 |
| H6 | Bộ điều tốc FPS (`matDoKhungHinh.ts`) đặt lại cửa sổ khi > 200 ms không có khung (tránh tự hạ chất lượng oan) | đọc mã, **[chưa kiểm]** | 0,5 |
| H7 | Harness đo hiệu năng trong CI cho mọi màn 3D (ngân sách §3.5), có đột biến kiểm | — | 2 |
| H8 | `/twin` vẫn tụt **18–27 fps ở một số góc camera** (khung điển hình 33,4 ms = lỡ 1 nhịp làm tươi, tối đa 184 ms) dù **không có toast và gần như không có việc JS** ⇒ nghi giới hạn GPU/điền điểm ảnh (lớp phủ trong suốt phủ cả sàn như vùng “ouit”, vòng andon, khử răng cưa). Việc: đo GPU tại `cam=10.46,5.57,53.02` và `cam=13.81,19.41,49.48`, thử tắt từng lớp phủ (ablation) để tìm thủ phạm trước khi sửa. **Ghi backlog; khi làm phải đo bằng Performance trace GPU (overdraw), không đoán.** | đo 23/10 sau vá | 1,5 |

### 5.3 Đo lại sau bản vá bão thông báo (23/10, ~15:40, :3000 bản `b8c023e57`)
| Chỉ số | Trước vá | Sau vá |
|---|---|---|
| Toast mỗi lần tải trang | 220–343 (bắt đầu ở 10–35 s) | **0** trên `/twin`, `/twin/line/1`, `/twin-studio` (bộ đếm đã kiểm bằng toast giả 0→3) |
| Luồng chính bận | ~100 % hơn 60 s | 18 % trong 10 s đầu (khởi động), sau đó **~0 %** |
| `/twin` xoay | 10–19 fps, khung 818 ms | **59–60 fps** ở đa số góc nhìn (khung tệ nhất 17 ms); **18–27 fps ở một số góc** — không do toast (H8) |
| Kênh Redis khoá mới (40 s) | — | 0 tin của môi trường khác (không còn F-B10CMD/edge node lạ); còn ~3.400 tin/75 s `machine:offline_alert` do chính :3000 phát (H1b) |

---

## 6. Lộ trình và ước lượng (ngày công, 1 kỹ sư + trợ lý AI, ±30 %)

| Đợt | Nội dung | Phụ thuộc | Ngày công |
|---|---|---|---|
| **V0** | H1b, H2, H3, H6, H8 (mượt ngay) | — | 6 |
| **V1** | K14 §4.2 bỏ pg enum + một nguồn sự thật + sửa recipe | duyệt Q9 | 8–10 |
| **V2** | K14 lõi gói (bảng, manifest, phiên bản, duyệt, ký) + 6 hành vi đầu (1,2,3,5,7,8) + bộ chạy K13 trong worker | V1 | 22–26 |
| **V3** | K13 cảnh ảo: soạn, I/O ảo, tua/phát lại, lỗi, ngân sách hiệu năng, H4–H5, H7 | V2 | 20–25 |
| **V4** | K12 lưu đồ: mở rộng SFC, bộ chọn tag, lowering, linter, giao diện, nguồn (a) | V2 (bộ chạy) | 18–22 |
| **V5** | K12 xuất 8 định dạng hãng + nghiệm thu trên phần mềm thật | V4, **V1** (enum `programmingkindenum`), Q8 | 10–12 |
| **V6** | Xưởng thiết bị đầy đủ (7 bước) + nhập STEP/URDF/IODD/GSDML + hành vi 4,6,9–14 | V2 | 25–30 |
| **V7** | Bộ chạy phía máy chủ (worker_threads) + nguồn (b) MATIEC với bộ chạy chu kỳ mới + nguồn (c) máy chủ Modbus ảo; giám sát online lưu đồ | V3, V4, K3 | 17–20 |
| **V8** | Nối K14 vào SCADA: tự sinh tag/cảnh báo/ký hiệu khi đặt máy thật; capability đọc gói | V2, K1, K4, K6 | 8–10 |

**Tổng K12–K14 + hiệu năng ≈ 133–160 ngày công.** Cộng K1–K11 (§D bản phân tích, ≈ 119–125) ⇒ toàn chương trình ≈ **252–285 ngày công** ≈ 12–13 tháng một người, hoặc ≈ 5–6 tháng với 2–3 luồng song song sau V2.

Thứ tự đề xuất: **V0 → V1 → V2** (nền chung) rồi chạy song song **V3 ∥ V4 ∥ V6**, sau đó V5, V7, V8. Lộ trình S0–S7 của SCADA (kết nối → lệnh → cảnh báo → màn hình) chạy song song luồng riêng; điểm giao duy nhất là V8.

Mỗi đợt: TDD, đột biến kiểm lưới, cờ OFF mặc định, chạy dev trước, báo cáo tách LOGIC · DỮ LIỆU · VẬN HÀNH, migration xin phép trước khi áp, không xoá tệp khi chưa hỏi.

---

## 7. Quyết định tôi tự đưa ra (cần bạn xem lại)
1. Lưu đồ = **mở rộng SFC của `pouModel`**, không dùng mô hình IR robot.
2. Cảnh nhà máy ảo **tách** khỏi twin vận hành, có nút sao chép line thật sang.
3. Bộ chạy mô phỏng **ưu tiên động học**; vật lý Rapier chỉ cho sản phẩm; chạy trong Web Worker.
4. Manifest gói là **định dạng nội bộ JSON**; AASX/AutomationML/NodeSet chỉ là nhập/xuất.
5. FMU để giai đoạn sau.
6. Gói "nối thiết bị thật" cần 2 người duyệt; cổng RA mang `actuationLevel` cùng thang L7/K5.
7. Dải migration 0450–0469.

## 8. Câu hỏi chờ chủ dự án
- **Q7 — Nghiệm thu ảo với PLC thật.** PLC thật thường đọc I/O vật lý; muốn nó điều khiển nhà máy ảo, chương trình PLC cần một **lớp ánh xạ I/O** (chế độ mô phỏng đọc thanh ghi Modbus/SLMP thay cho X/Y). Bạn chấp nhận yêu cầu này với chương trình PLC của nhà máy không? (Nếu không, nguồn (c) chỉ dùng cho OpenPLC/simulator.)
- **Q8 — Phần mềm hãng để nghiệm thu xuất mã.** Nhà máy có sẵn (bản quyền + máy cài) GX Works2/3, ISPSoft/WPLSoft, DIADesigner‑AX, AutoShop, InoProShop, CODESYS không? Thiếu cái nào thì định dạng đó chỉ được ghi "chưa kiểm" và tắt mặc định.
- **Q9 — Duyệt riêng việc bỏ pg enum (§4.2).** Đây là thay đổi kiểu cột trên các bảng lớn (`machines`, `device_adapters`…), không chỉ thêm. Đề xuất: làm trên bản sao DB, đo, rồi áp dev trong cửa sổ bảo trì.

## 9. Kiểm tra độc lập (2026-10-23)
Một người đọc độc lập (vai kỹ sư xây dựng, đối chiếu mã + catalog DB chỉ đọc) nêu 6 câu hỏi và 12 chỗ sai/không chạy được. Đã xử lý:
- **Tự quyết, ghi vào tài liệu:** nơi chạy bộ mô phỏng (§3.3: một mã chạy cả trình duyệt và máy chủ; kiểm thử gói chỉ máy chủ ghi) · gán tín hiệu một chỗ có phiên bản (§2.3a `program_bindings`) · "lớp thiết bị" = `device_types.typeKey` và thứ tự ưu tiên năng lực (§4.3a) · thư viện khởi đầu dùng hình thủ tục + gói tĩnh mặc định mỗi lớp (§4.6a) · MATIEC là thành phần tuỳ chọn, bộ chạy chu kỳ lockstep là việc mới (§2.6) · khoá ký theo cài đặt (§4.7).
- **Sửa chỗ sai:** tiền xử lý tương thích bản ghi SFC cũ · danh sách FB mở + lan kiểu · `BuocTruoc = −1` · `adapterKind` là enum ⇒ V5 phụ thuộc V1 · bench MATIEC chỉ chạy 1 chu kỳ ⇒ +5 ngày V7 · toạ độ dùng cột số như `twin_dat_cho` · thêm FK + trigger bất biến cho tệp gói · enum: đúng danh sách bảng, `varchar(32)`, giữ kiểu tới khi sửa script/test · `MACHINE_TYPES`/`listTypes` đã có · `getCapabilitiesForMachine` đồng bộ ⇒ bộ đệm RAM · quyền "duyệt" = module riêng · H1 đã xong.
