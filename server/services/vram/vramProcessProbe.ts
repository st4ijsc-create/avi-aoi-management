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
    byPid.set(pid, (byPid.get(pid) ?? 0) + bytes);
    byLuid.set(luid, (byLuid.get(luid) ?? 0) + bytes);
    totalBytes += bytes;
  }
  return { totalBytes, byPid, byLuid, sampledAtMs: nowMs };
}

/**
 * ★★★ I-5 (re-review vòng 1) — **BIÊN LẮNG ~1,2 s CỦA `Get-Counter` LÀ ĐIỀU KIỆN ĐÚNG ĐẮN CỦA
 * PHÉP ĐO, KHÔNG PHẢI CHI PHÍ THỪA.** Đọc hết khối này trước khi tối ưu bất cứ thứ gì ở đây.
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
 * ~0,1 s **trong một dòng**. ĐỪNG. Bỏ `Get-CimInstance` thì được (chỉ cần khi phạm vi
 * `descendants` cần cây tiến trình); **KHÔNG đụng `Get-Counter`** cho tới khi độ trễ thật của bộ
 * đếm được ĐO TRỰC TIẾP và ghim thành hằng số của CHÍNH TA (`VRAM_MEASURE_SETTLE_MS`) thay vì
 * mượn biên nội tại của PDH — việc đó là **Task 6** của pha này, không phải một lượt tối ưu.
 */
const PS_SCRIPT = [
  "$ErrorActionPreference='Stop';",
  "$c=(Get-Counter '\\GPU Process Memory(*)\\Dedicated Usage').CounterSamples|",
  "ForEach-Object{ @{ i=$_.InstanceName; v=[double]$_.CookedValue } };",
  "$p=Get-CimInstance Win32_Process|ForEach-Object{ @{ pid=[int]$_.ProcessId; ppid=[int]$_.ParentProcessId } };",
  "@{counters=$c;procs=$p}|ConvertTo-Json -Depth 4 -Compress",
].join(" ");

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
