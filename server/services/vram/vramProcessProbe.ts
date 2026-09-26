import { execFile } from "node:child_process";

const INSTANCE_RE = /^pid_(\d+)_luid_(0x[0-9a-f]+)_(0x[0-9a-f]+)_phys_\d+$/i;

export interface VramProcessSample {
  readonly totalBytes: number;
  readonly byPid: ReadonlyMap<number, number>;
  readonly byLuid: ReadonlyMap<string, number>;
  readonly sampledAtMs: number;
}
export interface RawProcRow { readonly pid: number; readonly ppid: number }

export function collectDescendants(procs: readonly RawProcRow[], roots: readonly number[]): Set<number> {
  const childrenOf = new Map<number, number[]>();
  for (const row of procs) {
    const list = childrenOf.get(row.ppid);
    if (list) list.push(row.pid);
    else childrenOf.set(row.ppid, [row.pid]);
  }
  const seen = new Set<number>();
  const stack = [...roots];
  while (stack.length > 0) {
    const pid = stack.pop()!;
    if (seen.has(pid)) continue; // cat vong, khong treo
    seen.add(pid);
    for (const child of childrenOf.get(pid) ?? []) stack.push(child);
  }
  return seen;
}

export function parseProcessCounters(rawJson: string, roots: readonly number[], nowMs: number): VramProcessSample | null {
  let parsed: { counters?: unknown; procs?: unknown };
  try {
    parsed = JSON.parse(rawJson) as typeof parsed;
  } catch {
    return null;
  }
  const counters = Array.isArray(parsed.counters) ? parsed.counters : [];
  const procsRaw = Array.isArray(parsed.procs) ? parsed.procs : [];
  const procs: RawProcRow[] = [];
  for (const row of procsRaw) {
    const r = row as { pid?: unknown; ppid?: unknown };
    if (typeof r.pid === "number" && typeof r.ppid === "number") procs.push({ pid: r.pid, ppid: r.ppid });
  }
  const wanted = collectDescendants(procs, roots);

  const byPid = new Map<number, number>();
  const byLuid = new Map<string, number>();
  let totalBytes = 0;
  for (const row of counters) {
    const c = row as { i?: unknown; v?: unknown };
    if (typeof c.i !== "string" || typeof c.v !== "number" || !Number.isFinite(c.v)) continue;
    const m = INSTANCE_RE.exec(c.i);
    if (!m) continue;
    const pid = Number(m[1]);
    if (!wanted.has(pid)) continue;
    const bytes = Math.max(0, Math.round(c.v));
    const luid = `${m[2].toLowerCase()}_${m[3].toLowerCase()}`;
    // ⚠⚠ M-4 (review TOÀN NHÁNH) — **`byPid` CỘNG GỘP MỌI LUID**, tức mọi ADAPTER. `byLuid` được
    // tính đầy đủ ngay dưới nhưng **KHÔNG NƠI NÀO ĐỌC** (`vramWiring.readScopeBytes()` chỉ dùng
    // `byPid`/`totalBytes`). Trên máy MỘT adapter điều đó vô hại và đó là máy phát triển hôm nay
    // (i7-12700**KF** — không iGPU — + một RTX 5090). Trên máy HAI GPU (hoặc CPU có iGPU, hoặc một
    // card thứ hai), hiệu số `after − before` TRỘN hai thiết bị mà `measureFailed` vẫn `false`:
    // đúng lớp "sai LẶNG LẼ" của C-1, chỉ khác trục. Và `vramBroker` đã bắt đúng lớp lỗi "hằng số
    // của MỘT máy" một lần rồi.
    // ⇒ **ĐIỀU KIỆN VÀO CƯỠNG CHẾ PHA 2B** (giữ hoãn cho merge, chi phí vá gần bằng 0 vì số đã
    // được tính sẵn): hoặc `readScopeBytes()` đọc `byLuid` của ĐÚNG adapter mà `vramProbe` đang
    // đo, hoặc đầu dò TỪ CHỐI đo (trả `null`) khi thấy > 1 LUID. Không được commit một hiệu số
    // trộn thiết bị rồi khai là `process-delta`.
    byPid.set(pid, (byPid.get(pid) ?? 0) + bytes);
    byLuid.set(luid, (byLuid.get(luid) ?? 0) + bytes);
    totalBytes += bytes;
  }
  /**
   * ⚠ M-5 (review TOÀN NHÁNH) — `sampledAtMs` LÀ **TRƯỜNG CHẾT**, và phải nói ra thay vì để người
   * sau tưởng nó là một hàng rào độ tươi. Nó là `Date.now()` **LÚC PARSE** (không phải
   * `$_.Timestamp` của mẫu PDH), và **không nơi nào trong repo đọc nó**.
   * ⇒ GIỮ HOÃN cho merge (nó không sai, nó chỉ chưa có việc), nhưng đây là **ĐIỀU KIỆN VÀO PHA
   * 2B**: hoặc nối nó vào một hàng rào "mẫu ÔI" thật (đầu dò treo/xếp hàng, `powershell.exe` chậm
   * ⇒ kết quả về muộn — lớp đó CÓ THẬT và đáng bắt), hoặc XOÁ nó. Một ô dữ liệu không ai đọc mà
   * mang cái tên nghe như một bảo đảm là bẫy.
   * ⚠ ĐỪNG gọi việc đó là "vá I-5": dấu thời gian đo tuổi của **MẪU**, không đo tuổi của **GIÁ
   * TRỊ** — xem cảnh báo dài ở docstring `ScopeReading` trong `vramWiring.ts`.
   */
  return { totalBytes, byPid, byLuid, sampledAtMs: nowMs };
}

/**
 * ★★★ I-5 → **ĐÃ ĐÓNG BỞI TASK 6.** Khối này giữ lại lịch sử vì nó giải thích vì sao cửa sổ đo
 * từng đúng mà không ai biết tại sao. **Trạng thái hôm nay đã KHÁC — đọc mục "SAU TASK 6" ở cuối
 * khối trước khi hành động theo bất cứ câu nào ở giữa.**
 *
 * *(Nguyên văn I-5, re-review vòng 1: "biên lắng ~1,2 s của `Get-Counter` là ĐIỀU KIỆN ĐÚNG ĐẮN của
 * phép đo, không phải chi phí thừa".)*
 *
 * PHÂN RÃ CHI PHÍ MỘT LƯỢT ĐỌC (đo được, không ước):
 *   • khởi động `powershell.exe`      ~110 ms
 *   • **`Get-Counter`               ~1.200 ms**  ← biên lắng, xem dưới
 *   • `Get-CimInstance Win32_Process`  ~200 ms
 *   ⇒ ~1,5 s mỗi đầu đo, ~3,1 s mỗi cửa sổ đo.
 *
 * BIÊN 1.200 ms ĐẾN TỪ ĐÂU: `-SampleInterval` mặc định của `Get-Counter` là 1 giây — nó thu một
 * mẫu, CHỜ một giây, rồi thu lại. Đo trực tiếp: PDH trả mẫu ở **t₀ + 1.299 / 1.304 / 1.352 ms**
 * (3 lượt) ⇒ biên lắng thực tế **1,30–1,35 s**, lớn hơn cả mốc ≥800 ms mà chính tác giả T5-11 tự
 * áp cho phép đo này. **KHÔNG AI THIẾT KẾ ĐIỀU ĐÓ** — nó là tác dụng phụ, không ghi ở đâu, và
 * trước dòng chú thích này không có test nào canh.
 *
 * ⚠⚠ VÌ SAO HẠ NÓ XUỐNG LÀ NGUY HIỂM — và nguy hiểm IM LẶNG: `vramWiring.readScopeBytes()` chỉ
 * phân biệt được "bộ đếm KHÔNG CÓ khoá của ta" (⇒ `seen === false` ⇒ chặn), **không** phân biệt
 * được "bộ đếm CÓ khoá nhưng số đã CŨ". Bộ đếm trễ làm cửa sổ đo **BỊ DỊCH**: phần cấp phát rơi
 * vào khoảng trễ cuối bị mất khỏi hiệu số. Trễ hoàn toàn ⇒ hai đầu đo giống hệt nhau ⇒
 * `actual === 0` với `seen === true` ⇒ **commit 0 + `recordActual(0)`** ⇒ nấc `learned = 0` sống
 * tới hết đời tiến trình ⇒ ở Pha 2B là dư địa VÔ HẠN, tức OOM. **Không ca test nào đỏ.**
 *
 * ⚠ CẠM BẪY CỤ THỂ ĐANG CHỜ NGƯỜI SẬP (nói thẳng để khỏi ai sập): mục tồn đọng "bỏ
 * `Get-CimInstance` để 3,1 s → ~1 s" **được ước trên số SAI** — thực tế chỉ rút ~200 ms/lượt
 * (~13 %). Người cầm mục đó sẽ nhìn ngay sang 1,2 giây còn lại và cắt `-SampleInterval` xuống
 * ~0,1 s **trong một dòng**.
 *
 * ─── ★★★ SAU TASK 6 (2026-08-04) — BIÊN ĐÃ THUỘC VỀ TA; CỔNG TỐI ƯU **CHƯA** MỞ SẴN ──────────
 *
 * Điều Task 6 đã làm xong: biên lắng **ĐÃ THÀNH HẰNG SỐ CỦA TA** (`VRAM_MEASURE_SETTLE_MS` ngay
 * bên dưới), được `vramWiring.commitMeasured()` `await` trước đầu đo SAU, và được
 * `wiring.settle.test.ts` canh bằng ca đỏ. Cửa sổ đo **không còn phụ thuộc CÂM** vào biên nội tại
 * của `Get-Counter` — nếu ai đó gỡ biên đó, ít nhất còn 250 ms **được khai báo** ở lại.
 *
 * ⚠⚠ **ĐIỀU TASK 6 KHÔNG LÀM XONG — ĐỌC KỸ TRƯỚC KHI COI ĐÂY LÀ GIẤY PHÉP HẠ BIÊN.**
 * Phép đo cho số 0 ms **CHỈ trên đường đã đo**: `node-llama-cpp` / GGUF / CUDA, ba cỡ model
 * (0,6B · 4B · 30B), một máy (RTX 5090), một driver. Nó **KHÔNG phủ**:
 *   • **ONNX Runtime (DirectML/CUDA)** — `aiInferenceEngine`, `aiImageEmbedding`. ⚠ Đây là đường
 *     **AOI SẢN XUẤT** (`onnx-session`), và nó là đường **chưa đo**;
 *   • **sidecar `spawn()`** — `llamaVisionSidecar`, `localSidecarTrainer`, `aiLlmFinetuneSidecar`
 *     (phạm vi `descendants`: khoá bộ đếm của tiến trình con phải KỊP XUẤT HIỆN);
 *   • máy / GPU / driver khác, hoặc máy đang tải nặng.
 *
 * ⇒ **HẠ `-SampleInterval` LÀ RÚT BIÊN THẬT TỪ ~1.450 ms XUỐNG 250 ms — 5,8 LẦN — VÀ RÚT TRÊN CẢ
 *   BA NHÓM ĐƯỜNG Ở TRÊN CÙNG LÚC.** Không được làm chỉ vì đọc thấy số 0 ở dưới: số 0 đó không
 *   nói gì về chúng. **Chỉ được hạ SAU KHI đo lại trên ĐÚNG đường sắp bị ảnh hưởng**, theo giao
 *   thức ghi ở `VRAM_MEASURE_SETTLE_MS`.
 *
 *   ⚠ Đây đúng hình dạng cái bẫy mà Task 6 sinh ra để tháo, chỉ dời lên một tầng: trước là một
 *   biên tình cờ không ai biết; nếu viết cổng rộng hơn bằng chứng thì thành một **giấy phép** hạ
 *   biên rộng hơn bằng chứng. Nên câu ở đây là "chưa mở", không phải "nay được phép".
 *
 * ⇒ ĐƯỢC PHÉP NGAY, KHÔNG CẦN ĐO LẠI: **bỏ `Get-CimInstance`** (~200 ms/lượt) — nó chỉ cần cho
 *   phạm vi `descendants`, và nó KHÔNG phải nguồn của biên lắng.
 *
 * ⚠ VÀ DÙ ĐO LẠI XONG: **dòng `await awaitMeasureSettle()` trong `commitMeasured()` PHẢI Ở LẠI.**
 * Nó là biên duy nhất thuộc về ta và là biên duy nhất có ca test canh. Gỡ `Get-Counter` mà gỡ
 * luôn nó là dựng lại đúng lỗ I-5, lần này KHÔNG còn thứ gì che.
 */
const PS_SCRIPT = [
  "$ErrorActionPreference='Stop';",
  "$c=(Get-Counter '\\GPU Process Memory(*)\\Dedicated Usage').CounterSamples|",
  "ForEach-Object{ @{ i=$_.InstanceName; v=[double]$_.CookedValue } };",
  "$p=Get-CimInstance Win32_Process|ForEach-Object{ @{ pid=[int]$_.ProcessId; ppid=[int]$_.ParentProcessId } };",
  "@{counters=$c;procs=$p}|ConvertTo-Json -Depth 4 -Compress",
].join(" ");

/**
 * ★★★ PHA 2A TASK 6 — BIÊN LẮNG **CỦA TA**. Đọc khối này TRƯỚC khi đụng `PS_SCRIPT` ở trên.
 *
 * **Vấn đề mà hằng số này đóng lại (I-5):** cửa sổ đo chỉ đúng khi bộ đếm đã phản ánh ĐỦ lượt cấp
 * phát tại thời điểm đầu đo SAU. Trước Task 6, điều đó đúng **nhờ tác dụng phụ**: `-SampleInterval`
 * mặc định của `Get-Counter` chèn ~1,2 s vào MỖI lượt đọc. Không ai thiết kế, không ghi ở đâu,
 * không ca test nào canh — nên một lượt tối ưu chi phí gỡ được nó **trong một dòng**, im lặng.
 *
 * ─── SỐ ĐO (Task 6, 2026-08-04) ──────────────────────────────────────────────────────────────
 * Giao thức: nạp model thật trong một tiến trình con, lấy mẫu bộ đếm **LIÊN TỤC** từ tiến trình
 * khác bằng PDH P/Invoke **giữ handle ấm** (`pdh.dll` — CHÍNH thư viện `Get-Counter` dùng), chi
 * phí trung vị **0,018 ms/mẫu**, nhịp lấy mẫu thực **~0,04–0,1 ms**. Mốc "lượt cấp phát xong" =
 * thời điểm `llama.loadModel()` trả về, quan sát bằng file mốc mà đầu dò `Test-Path` trong CÙNG
 * vòng lặp lấy mẫu ⇒ mốc và bộ đếm dùng MỘT đồng hồ, KHÔNG có sai lệch đồng hồ liên tiến-trình.
 *
 * ⚠ M-3 — MỐC ĐÓ **KHÔNG** ĐÚNG BẰNG ĐIỂM `commitMeasured()` CỦA MỌI ĐƯỜNG SẢN XUẤT, nói cho
 * đúng: với model SINH CHỮ, `aiGgufEngine.ts` còn `createContext()` (cấp phát KV-cache) SAU
 * `loadModel()` rồi mới `commitMeasured()` (`:904` → `:916`). Điểm đo của phép đo này vì thế **SỚM
 * HƠN** điểm sản xuất ở đường đó ⇒ nếu có sai lệch thì nó làm kết quả **BI QUAN HƠN** sự thật (đo
 * ở điểm sớm hơn thì bộ đếm có ít thời gian hơn để đuổi kịp). Kết luận "bộ đếm đi TRƯỚC" vì thế
 * an toàn theo đúng hướng; con số 429–7.140 ms là CẬN DƯỚI của khoảng dẫn trước, không phải cận trên.
 *
 *   • **8/8 lượt** (0,6B ×3 · 4B ×2 · 30B ×3, 0 lượt hỏng phải thử lại): bộ đếm đã đạt **100,0000 %**
 *     giá trị cuối **TRƯỚC** khi lượt cấp phát trả về. Nó ĐI TRƯỚC **429,5 / 460,6 / 480,2 / 962,2 /
 *     1.017,5 / 6.571,8 / 6.881,1 / 7.140,3 ms** — **chưa lượt nào đi SAU**.
 *     ⇒ **YÊU CẦU ĐO ĐƯỢC TẠI ĐIỂM SẢN XUẤT = 0 ms.**
 *   • Cơ chế giải thích vì sao: `\GPU Process Memory\Dedicated Usage` đếm **lượt CẤP PHÁT**
 *     (`cudaMalloc`), không đếm lượt CHÉP xong. llama.cpp cấp phát buffer trước rồi mới chép
 *     host→device, nên bộ đếm lên hết TRONG lúc lượt nạp còn đang chạy.
 *   • Độ trễ của bộ đếm với một sự kiện có thời điểm biết TỪ BÊN NGOÀI (giết tiến trình đang giữ
 *     17,5 GB): bắt đầu tụt sau **7,1–9,5 ms**, về 0 sau **27,3–120,9 ms**.
 *     ⇒ **QUAN SÁT LỚN NHẤT VỀ ĐỘ TRỄ CỦA CHÍNH BỘ ĐẾM: 121 ms** — đây là số chống lưng cho
 *     `VRAM_MEASURE_SETTLE_SAFETY_MS`, KHÔNG phải con số 0 ở trên.
 *   • Bộ đếm KHÔNG được làm mới theo nhịp đồng hồ thô: hai giá trị KHÁC NHAU quan sát được cách
 *     nhau **0,127 ms** (min qua 8 lượt) ⇒ chu kỳ làm mới của nguồn < 0,13 ms.
 *   • ĐỐI CHỨNG, **đếm cho đúng** (M-6 — bản trước gộp hai lượt CÙNG MỘT THƯỚC rồi gọi là "xác
 *     nhận thứ ba"): `delta` đo ở đây trùng **tới từng byte** với nghiệm thu sống Task 3
 *     (1.193.291.776 / 17.511.354.368), và nền backend đọc được **452.595.712 B ở 8/8 lượt** =
 *     đúng `CUDA_BACKEND_FALLBACK_BYTES`.
 *     ⚠ Nhưng cả Task 3 lẫn Task 6 đều đọc **CÙNG MỘT bộ đếm** `\GPU Process Memory\Dedicated
 *     Usage`, chỉ khác **đường truy cập** (`Get-Counter` qua `powershell.exe` vs PDH P/Invoke
 *     handle ấm). Vậy nên đây là **lượt khảo sát thứ BA nhưng mới là thước ĐỘC LẬP thứ HAI**:
 *     thước độc lập duy nhất còn lại là `nvidia-smi`/`getVramState` ở Pha 1 (+431/+430/+431 MiB).
 *     Điều nó chứng minh: đường truy cập và cách lấy mẫu KHÔNG làm lệch con số. Điều nó **KHÔNG**
 *     chứng minh: bản thân bộ đếm nói đúng sự thật của thiết bị.
 *
 * ⚠⚠ **HẰNG SỐ NÀY KHÔNG PHẢI THỨ CÓ THỂ HẠ BẰNG SUY LUẬN.** Nó chống lưng cho một lớp lỗi CÂM:
 * bộ đếm trễ ⇒ cửa sổ đo BỊ DỊCH ⇒ `actual === 0` với `seen === true` ⇒ `commit(0)` +
 * `recordActual(0)` ⇒ nấc `learned = 0` sống tới hết đời tiến trình ⇒ ở Pha 2B là dư địa VÔ HẠN,
 * tức OOM. Muốn hạ thì **đo lại** theo đúng giao thức trên rồi sửa CẢ hằng số lẫn sàn trong
 * `wiring.settle.test.ts`; đừng sửa một mình hằng số.
 *
 * ⚠ **CỐ Ý KHÔNG cho ép bằng biến môi trường** — khác `VRAM_MEASURE_WAIT_MS` (Task 3). Ngân sách
 * chờ khoá là câu hỏi VẬN HÀNH ("chờ bao lâu thì thôi"), hạ nó chỉ làm mất phép đo và có nhánh
 * `measure-window-not-exclusive` khai ra. Biên lắng là câu hỏi VẬT LÝ về bộ đếm, và hạ nó làm phép
 * đo **SAI mà vẫn tự khai là đúng**. Một công tắc cho phép đặt `0` chính là cái bẫy này ở dạng
 * được chống lưng bởi tài liệu.
 */
export const VRAM_COUNTER_SETTLE_MEASURED_MS = 0;

/**
 * Biên an toàn CHỦ ĐỘNG cộng thêm cho những đường cấp phát mà Task 6 **KHÔNG đo** (xem §4 báo cáo):
 * ONNX Runtime (DirectML/CUDA), `spawn()` sidecar `llama-server.exe`, máy/driver/GPU khác. Đây là
 * một PHÁN ĐOÁN được ghi tên, không phải số đo — tách khỏi `…_MEASURED_MS` chính là để người sau
 * biết phần nào có thước chống lưng và phần nào không.
 */
export const VRAM_MEASURE_SETTLE_SAFETY_MS = 250; // = 2,07× quan sát 121 ms ở trên

/** Biên lắng áp dụng trước ĐẦU ĐO SAU. Đơn vị: ms (ràng buộc toàn cục: mọi hằng số có đơn vị ở tên). */
export const VRAM_MEASURE_SETTLE_MS = VRAM_COUNTER_SETTLE_MEASURED_MS + VRAM_MEASURE_SETTLE_SAFETY_MS;

/**
 * CHỜ cho bộ đếm phản ánh đủ lượt cấp phát vừa xong. Gọi NGAY TRƯỚC đầu đo SAU, BÊN TRONG cửa sổ
 * đo (nếu chờ ngoài cửa sổ thì một lượt cấp phát khác chen vào đúng khoảng chờ và làm bẩn hiệu số
 * — đúng lớp lỗi mà khoá nối tiếp sinh ra để diệt).
 *
 * ⚠ M-4 — `.unref()` MẤT NHIỀU HƠN "MỘT PHÉP ĐO", nói đủ để người sau không phải tự phát hiện.
 * Nếu hẹn giờ này là thứ DUY NHẤT còn giữ vòng lặp sự kiện, tiến trình thoát và lời hứa **không
 * bao giờ giải** ⇒ `commitMeasured()` dừng giữa chừng, và mất theo **cả phần đuôi của nó**:
 * `broker.commit()` KHÔNG chạy · `estimator.recordActual()` KHÔNG chạy · **`closeWindow()` KHÔNG
 * chạy** (cửa sổ đo + khoá nối tiếp không được nhả) · không sự kiện `commit` lẫn `measure_failed`
 * nào vào nhật ký ⇒ giấy phép đứng `actualBytes: null, measureFailed: false`, đúng "nhánh thoát
 * thứ BẢY" mà `chotSoBangDuPhong()` đã khai là KHÔNG cứu được.
 *
 * ⚠ VẪN GIỮ `.unref()`, và đây là lý do: mọi thứ vừa liệt kê đều là trạng thái **TRONG BỘ NHỚ của
 * một tiến trình đang chết** — khoá rò, cửa sổ rò, sổ dở dang đều biến mất cùng nó. Vế đối lập
 * thì không vô hại như vậy: một hẹn giờ có `ref` **giữ tiến trình sống thêm tới 250 ms ở MỖI lượt
 * cấp phát đang bay**, tức telemetry giành quyền quyết định lúc nào tiến trình được thoát. Đó là
 * ranh giới "telemetry chỉ QUAN SÁT" mà module này tự cấm mình vượt.
 *
 * ⚠ Hàm nằm ở ĐÂY chứ không ở `vramWiring.ts` có chủ ý: biên lắng là thuộc tính của BỘ ĐẾM, nên nó
 * phải ở cạnh `PS_SCRIPT`. Hệ quả kỹ thuật cũng đúng hướng — mọi `wiring.*.test.ts` đã
 * `vi.mock("./vramProcessProbe")` nên chúng phải KHAI báo một bản giả cho hàm này, tức phụ thuộc
 * "đường đo có chờ lắng" trở nên NHÌN THẤY ĐƯỢC trong từng bộ test thay vì ẩn.
 */
export function awaitCounterSettle(ms: number = VRAM_MEASURE_SETTLE_MS): Promise<void> {
  if (!(ms > 0)) return Promise.resolve();
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    (t as unknown as { unref?: () => void }).unref?.();
  });
}

const PROBE_TIMEOUT_MS = 10_000;
let warnedUnavailable = false;

/**
 * ⚠ M-3 (review vòng 1) — DANH SÁCH **BẬT**, KHÔNG PHẢI DANH SÁCH TẮT. Đây là danh sách các giá
 * trị làm đầu dò CHẠY; mọi giá trị khác (kể cả gõ sai) đều TẮT.
 *
 * Bản trước làm ngược — chỉ nhận `off|false|0` là tắt — nên `VRAM_PROCESS_PROBE=disabled` (hay
 * `no`, `OFF ` có khoảng trắng, chuỗi rỗng) làm đầu dò **âm thầm VẪN BẬT**. Một công tắc vận hành
 * hỏng theo chiều "vẫn chạy" là bẫy: người vận hành tin là đã tắt, hệ vẫn sinh `powershell.exe`
 * mỗi lượt cấp phát, và không có dấu hiệu nào cho biết mình gõ sai. Đảo logic là cách DUY NHẤT
 * đóng hẳn lớp lỗi đó thay vì đuổi theo từng biến thể chính tả.
 */
const PROBE_ON_VALUES = new Set(["on", "true", "1", "yes", "enabled", "enable"]);

/**
 * Pha 2A Task 3 — CÔNG TẮC của đầu dò. Biến **KHÔNG ĐẶT ⇒ BẬT** (mặc định sản xuất, không đổi
 * hành vi); đặt bất cứ giá trị nào KHÔNG thuộc `PROBE_ON_VALUES` ⇒ đầu dò trả `null` NGAY, không
 * sinh tiến trình con nào.
 *
 * VÌ SAO CẦN, và vì sao đây KHÔNG phải "mã biết mình đang bị test":
 *   • Mỗi lượt đọc tốn **~1,5 s** (110 ms boot + 1.200 ms `Get-Counter` + 200 ms `Get-CimInstance`
 *     — xem khối chú thích ở `PS_SCRIPT`). Đó là cái giá HỢP LÝ cho một lượt nạp model thật
 *     (10-60 s) và VÔ LÝ cho bất cứ thứ gì khác.
 *   • Ràng buộc toàn cục 8 vốn đã đòi "máy không GPU / không PowerShell / bộ đếm vắng ⇒ trả null,
 *     hệ vẫn chạy". Công tắc này là cùng một đường thoát, chỉ do người vận hành bật thay vì do
 *     môi trường quyết định — dùng được khi bộ đếm PDH treo trên một máy cụ thể.
 *   • `vitest.setup.ts` đặt mặc định `off` cho TOÀN BỘ bộ test: không test đơn vị nào được phép
 *     sinh `powershell.exe`. Bộ test nào CẦN đường đo (`server/services/vram/wiring.*.test.ts`)
 *     đều `vi.mock("./vramProcessProbe")` — bản giả THAY CẢ MODULE nên công tắc này không đụng
 *     tới chúng. Nghĩa là: công tắc không hề biết gì về test; test chỉ dùng lại nó.
 *
 * ⚠ HỆ QUẢ khi tắt: `actualBytes` KHÔNG BAO GIỜ được ghi — mọi lượt commit thành `measureFailed`
 * và sổ giữ ƯỚC LƯỢNG. Đó là mất phép đo, không phải mất an toàn (đúng khuôn "một ước lượng sai
 * ĐƯỢC GẮN CỜ rẻ hơn một ước lượng sai ĐƯỢC TIN").
 */
function probeDisabled(): boolean {
  const raw = process.env.VRAM_PROCESS_PROBE;
  if (raw === undefined) return false; // không đặt ⇒ BẬT (mặc định sản xuất)
  return !PROBE_ON_VALUES.has(raw.trim().toLowerCase());
}

export function readProcessVram(roots: readonly number[]): Promise<VramProcessSample | null> {
  if (roots.length === 0) return Promise.resolve(null);
  if (probeDisabled()) return Promise.resolve(null);
  return new Promise((resolve) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", PS_SCRIPT],
      { timeout: PROBE_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024, windowsHide: true },
      (err, stdout) => {
        if (err) {
          if (!warnedUnavailable) {
            warnedUnavailable = true;
            console.warn(`[VRAM] dau do theo tien trinh khong dung duoc (${err.message}) — quay ve danh dau measureFailed`);
          }
          resolve(null);
          return;
        }
        resolve(parseProcessCounters(stdout, roots, Date.now()));
      },
    );
  });
}
