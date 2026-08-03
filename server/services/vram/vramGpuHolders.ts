import { execFile } from "node:child_process";
import { collectDescendants, type RawProcRow } from "./vramProcessProbe";

/**
 * Pha 2B Task 1 — AI ĐANG GIỮ GPU? (bản liệt kê DANH TÍNH, không phải bản liệt kê BYTE)
 *
 * ⚠⚠ ĐỌC TRƯỚC KHI DÙNG MODULE NÀY CHO BẤT CỨ PHÉP TÍNH NÀO: nó trả về **AI**, KHÔNG trả về
 * **BAO NHIÊU**. Trên máy WDDM này `nvidia-smi --query-compute-apps` trả `used_memory = [N/A]`
 * cho **mọi** dòng (đo được 15/15 ngày 2026-08-04). Vì vậy module này đủ để **TỪ CHỐI**, KHÔNG
 * đủ để **TRỪ** — ai đó "ước lượng" byte cho một PID ở đây rồi trừ khỏi nền là biến một trạng
 * thái mù CÓ TIẾNG thành một con số sai IM LẶNG, đúng lớp lỗi mà cả Pha 2B tồn tại để diệt.
 *
 * ─── VÌ SAO KHÔNG PHẢI "MỌI PID KHÔNG PHẢI CỦA TA ĐỀU LẠ" ───────────────────────────────────
 * Kế hoạch viết vậy, nhưng SỐ ĐO bác bỏ bản đọc nguyên văn. Cùng lệnh đó trên chính máy này liệt
 * kê **cả desktop**: `explorer.exe`, `SearchHost.exe`, `StartMenuExperienceHost.exe`, `Code.exe`,
 * `msedge.exe`, `msedgewebview2.exe` ×2, `Docker Desktop.exe`, `ShellExperienceHost.exe`,
 * `SystemSettings.exe`, `ApplicationFrameHost.exe`, `CrossDeviceResume.exe`, `Display Driver.exe`,
 * và một PID `[Insufficient Permissions]`. Tập "không phải của ta" vì thế **KHÔNG BAO GIỜ rỗng**
 * trên một máy Windows có người ngồi trước màn hình.
 *
 * Áp nguyên văn ⇒ nền KHÔNG BAO GIỜ chụp được ⇒ `attributable` vĩnh viễn `null` ⇒ theo §5.6c
 * `headroom` rơi về **chỉ-sổ**, tức nhánh **RỘNG RÃI NHẤT** của cả mô hình cưỡng chế, cộng thêm
 * việc giết luôn chuông đối chiếu của Pha 1. Nói cách khác: bản đọc nguyên văn làm hệ **KÉM an
 * toàn hơn** trong khi trông có vẻ nghiêm khắc hơn.
 *
 * ─── VỊ TỪ THẬT SỰ ĐƯỢC CÀI ────────────────────────────────────────────────────────────────
 * Lỗ mà `vramReconciler.ts` TỰ KHAI (khối "GIỚI HẠN ĐÃ BIẾT") không phải "desktop dùng GPU" —
 * nền sinh ra CHÍNH LÀ để hấp thụ thứ đó (Pha 1 I-1: máy sạch, app tắt, GPU đã dùng 1.090 MiB).
 * Lỗ đó là: **server khởi động lại trong khi TIẾN TRÌNH CON CỦA CHÍNH TA còn sống** (sidecar thị
 * giác 7,8 GB) ⇒ khối byte ĐÓ bị nuốt vào nền và không ai còn thấy nó. Nên:
 *
 *     MỒ CÔI = đang giữ GPU  ∧  chạy đúng ảnh thực thi mà CHÍNH TA được cấu hình để sinh ra
 *              ∧  KHÔNG nằm trong cây tiến trình của ta
 *
 * "Ảnh thực thi của ta" KHÔNG phải một danh sách đoán mò — nó lấy từ chính cấu hình đã khai:
 * `process.execPath` (node của ta), `LLAMA_SERVER_BIN` (sidecar thị giác), `LOCAL_TRAINER_CMD`,
 * `LLM_FINETUNE_CMD`, cộng mọi ảnh thực thi nằm TRONG thư mục ứng dụng (venv python, tool đóng
 * gói). Thêm một sidecar mới ⇒ khai biến môi trường của nó vào `ownExecutablePaths()`, nếu không
 * nó vô hình với cổng này.
 *
 * ⚠ PHẦN LỖ CÒN LẠI, NÓI THẲNG: một hộ tiêu thụ CUDA **của người khác** cỡ lớn (`ollama.exe`,
 * một job PyTorch ở terminal khác) vẫn bị hấp thụ vào nền y như trước. Phân biệt nó với
 * `explorer.exe` đòi **byte theo tiến trình**, mà `nvidia-smi` ở đây không cho. Bộ đếm PDH
 * (`vramProcessProbe`) CÓ số đó, nhưng dùng nó ở đây là **trộn hai thước** (ràng buộc Đ4: bộ đếm
 * theo tiến trình chỉ dùng cho CHÊNH LỆCH) và cần một ngưỡng mới — quyết định của chủ dự án,
 * không phải của task này. Cho tới lúc đó, `captureVramBaseline()` GHI TOÀN BỘ danh sách hộ vào
 * sự kiện `baseline` để lượt sau có DỮ LIỆU mà quyết thay vì đoán.
 */
export interface GpuHolder {
  readonly pid: number;
  /** Đường dẫn ảnh thực thi ĐÚNG NHƯ nvidia-smi trả về (có thể là `[Insufficient Permissions]`). */
  readonly name: string;
}

export interface GpuHolderCensus {
  /** Toàn bộ hộ đang giữ GPU, không lọc. */
  readonly holders: readonly GpuHolder[];
  /** Nằm trong cây tiến trình của ta ⇒ byte của chúng thuộc về sổ, không thuộc về nền. */
  readonly ours: readonly GpuHolder[];
  /** ⚠ Chạy ảnh thực thi CỦA TA nhưng NGOÀI cây ⇒ tàn dư của lượt chạy trước ⇒ CẤM chốt nền. */
  readonly orphans: readonly GpuHolder[];
  /** Của người khác (desktop, trình duyệt…) ⇒ đúng thứ nền sinh ra để hấp thụ. */
  readonly thirdParty: readonly GpuHolder[];
}

/** `pid, process_name` — một dòng CSV, KHÔNG header. Không bao giờ ném. */
export function parseComputeApps(raw: string): GpuHolder[] {
  const out: GpuHolder[] = [];
  for (const line of String(raw).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    // ⚠ Tách theo dấu phẩy ĐẦU TIÊN, không `split(",")`: đường dẫn Windows có khoảng trắng và
    // hoàn toàn có thể có dấu phẩy ("C:\Program Files\Foo, Inc\bar.exe").
    const comma = trimmed.indexOf(",");
    if (comma < 0) continue;
    const pid = Number.parseInt(trimmed.slice(0, comma).trim(), 10);
    if (!Number.isFinite(pid)) continue; // bao gồm cả dòng HEADER ("pid, process_name")
    const name = trimmed.slice(comma + 1).trim();
    if (name.length === 0) continue;
    out.push({ pid, name });
  }
  return out;
}

/**
 * Bảng tiến trình (pid/ppid) do PowerShell trả về. `null` = KHÔNG ĐỌC ĐƯỢC (khác hẳn "đọc được
 * và rỗng"): người gọi phải coi đó là "không phân loại được", không phải "không có ai".
 */
export function parseProcRows(rawJson: string): RawProcRow[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    return null;
  }
  // ⚠ `ConvertTo-Json` trả về MỘT OBJECT (không phải mảng) khi tập hợp chỉ có một phần tử.
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  const out: RawProcRow[] = [];
  for (const row of rows) {
    const r = row as { pid?: unknown; ppid?: unknown };
    if (typeof r?.pid === "number" && typeof r?.ppid === "number") out.push({ pid: r.pid, ppid: r.ppid });
  }
  return out.length > 0 ? out : null;
}

/** So khớp đường dẫn Windows: không phân biệt hoa/thường, `/` ≡ `\`. */
function norm(p: string): string {
  return p.trim().toLowerCase().replace(/\//g, "\\");
}

function baseName(p: string): string {
  const n = norm(p);
  const cut = n.lastIndexOf("\\");
  return cut < 0 ? n : n.slice(cut + 1);
}

/**
 * Danh sách ảnh thực thi mà HỆ NÀY được cấu hình để sinh ra. Đọc `process.env` TRỰC TIẾP mỗi lượt
 * (không cache ở module-load) — cùng lý do với `describeTopologyHint()` trong `vramReconciler`.
 *
 * ⚠ Người thêm sidecar MỚI: khai biến môi trường của nó ở đây. Thiếu một dòng ở đây nghĩa là
 * sidecar đó mồ côi mà cổng nền KHÔNG THẤY — im lặng, đúng lớp lỗi cổng này sinh ra để đóng.
 */
export function ownExecutablePaths(): string[] {
  const firstToken = (cmd: string | undefined) => (cmd ?? "").trim().split(/\s+/).filter(Boolean)[0];
  return [
    process.execPath, // node của ta: mọi tiến trình con chạy bằng node (kb:sync, kb:eval-gate…)
    process.env.LLAMA_SERVER_BIN, // sidecar thị giác — HỘ LỚN NHẤT HỆ (7,8 GB), đúng ca tự khai
    firstToken(process.env.LOCAL_TRAINER_CMD), // sidecar huấn luyện (trần 2 GIỜ)
    firstToken(process.env.LLM_FINETUNE_CMD), // sidecar tinh chỉnh LLM (trần 4 GIỜ)
  ].filter((p): p is string => typeof p === "string" && p.trim().length > 0);
}

export function classifyHolders(input: {
  holders: readonly GpuHolder[];
  procs: readonly RawProcRow[];
  roots: readonly number[];
  ownExecutables: readonly string[];
  appRoot?: string;
}): GpuHolderCensus {
  const { holders, procs, roots, ownExecutables, appRoot } = input;
  // ⚠ DÙNG LẠI cây tiến trình của Pha 2A — KHÔNG dựng đường thứ hai. Hai bản dựng cây song song
  // là đúng lớp lỗi "sổ song song" mà bốn pha trước đã trả giá.
  const ourTree = collectDescendants(procs, roots);
  const rootSet = new Set(roots);
  const exact = new Set(ownExecutables.map(norm));
  // Lệnh khai kiểu "python train.py" (không có đường dẫn) chỉ so được theo TÊN FILE.
  const bare = new Set(
    ownExecutables
      .filter((p) => !p.includes("\\") && !p.includes("/"))
      .map((p) => (norm(p).endsWith(".exe") ? norm(p) : `${norm(p)}.exe`)),
  );
  const root = appRoot ? norm(appRoot).replace(/\\+$/, "") : "";

  const isOurs = (name: string) => {
    const n = norm(name);
    if (exact.has(n)) return true;
    if (bare.has(baseName(n))) return true;
    return root.length > 0 && n.startsWith(`${root}\\`);
  };

  const ours: GpuHolder[] = [];
  const orphans: GpuHolder[] = [];
  const thirdParty: GpuHolder[] = [];
  for (const h of holders) {
    if (rootSet.has(h.pid) || ourTree.has(h.pid)) ours.push(h);
    else if (isOurs(h.name)) orphans.push(h);
    else thirdParty.push(h);
  }
  return { holders, ours, orphans, thirdParty };
}

const SMI_TIMEOUT_MS = 3000;
const PS_TIMEOUT_MS = 10_000;
const PROBE_ON_VALUES = new Set(["on", "true", "1", "yes", "enabled", "enable"]);
let warnedUnavailable = false;

/**
 * Công tắc — cùng khuôn `VRAM_PROCESS_PROBE` (Pha 2A Task 3): **danh sách BẬT**, biến KHÔNG ĐẶT
 * ⇒ BẬT (mặc định sản xuất), mọi giá trị khác (kể cả gõ sai) ⇒ TẮT. Một công tắc hỏng theo chiều
 * "vẫn chạy" là bẫy; hỏng theo chiều "tắt" thì lộ ra ngay ở nhánh mù CÓ TIẾNG.
 *
 * `vitest.setup.ts` đặt mặc định `off` cho CẢ bộ test: không ca đơn vị nào được sinh
 * `nvidia-smi`/`powershell.exe`, và không ca nào phụ thuộc vào việc máy chạy test đang mở
 * Chrome hay không. Test nào cần đường này thì `vi.mock("./vramGpuHolders")`.
 */
function scanDisabled(): boolean {
  const raw = process.env.VRAM_GPU_HOLDER_SCAN;
  if (raw === undefined) return false;
  return !PROBE_ON_VALUES.has(raw.trim().toLowerCase());
}

function run(cmd: string, args: string[], timeout: number): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      execFile(cmd, args, { timeout, maxBuffer: 8 * 1024 * 1024, windowsHide: true }, (err, stdout) => {
        resolve(err ? null : String(stdout ?? ""));
      });
    } catch {
      resolve(null); // `execFile` ném ĐỒNG BỘ (EACCES…) — telemetry không được làm ngã người gọi
    }
  });
}

const PS_PROC_TABLE = [
  "$ErrorActionPreference='Stop';",
  "Get-CimInstance Win32_Process|ForEach-Object{ @{ pid=[int]$_.ProcessId; ppid=[int]$_.ParentProcessId } }|",
  "ConvertTo-Json -Compress",
].join(" ");

/**
 * Liệt kê tiến trình đang giữ GPU và phân loại. `null` = **KHÔNG QUÉT ĐƯỢC** — người gọi phải coi
 * đó là "chưa xác minh", TUYỆT ĐỐI không phải "sạch".
 *
 * ⚠ CHỈ đọc bảng tiến trình khi THẬT SỰ CẦN (có hộ chạy ảnh thực thi của ta mà không phải chính
 * ta). Hai lý do, cả hai đều thực dụng: (1) mỗi lượt là một `powershell.exe` ~200 ms; (2) mọi lối
 * hỏng của lượt đọc đó đều đẩy hệ vào nhánh MÙ, mà mù = chỉ-sổ = nhánh rộng rãi nhất. Ít gọi hơn
 * ⇒ ít cơ hội mù hơn. Hệ quả đã cân nhắc: một tiến trình con của ta chạy ảnh thực thi CHƯA KHAI
 * sẽ rơi vào `thirdParty` (bị hấp thụ vào nền) — đúng hành vi TRƯỚC task này, không tệ hơn.
 *
 * KHÔNG BAO GIỜ ném.
 */
export async function readGpuHolders(roots: readonly number[]): Promise<GpuHolderCensus | null> {
  if (scanDisabled()) return null;
  const csv = await run(
    "nvidia-smi",
    ["--query-compute-apps=pid,process_name", "--format=csv,noheader"],
    SMI_TIMEOUT_MS,
  );
  if (csv === null) {
    if (!warnedUnavailable) {
      warnedUnavailable = true;
      console.warn(
        "[vram] KHÔNG liệt kê được tiến trình đang giữ GPU (nvidia-smi vắng/lỗi) — nền sẽ được ghi " +
          "là CHƯA XÁC MINH và cưỡng chế chạy MÙ (chỉ-sổ). Đây là mất phép ĐO, không phải bằng chứng sạch.",
      );
    }
    return null;
  }

  const holders = parseComputeApps(csv);
  const ownExecutables = ownExecutablePaths();
  const appRoot = process.cwd();
  const preliminary = classifyHolders({ holders, procs: [], roots, ownExecutables, appRoot });
  // Không hộ nào chạy ảnh thực thi của ta ngoài chính ta ⇒ không thể có mồ côi ⇒ khỏi đọc bảng
  // tiến trình. Đây là ca THƯỜNG (chỉ desktop đang giữ GPU).
  if (preliminary.orphans.length === 0) return preliminary;

  const json = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", PS_PROC_TABLE], PS_TIMEOUT_MS);
  const procs = json === null ? null : parseProcRows(json);
  if (procs === null) {
    // ⚠ CỐ Ý trả `null` (mù) thay vì tố cáo: không có cây tiến trình thì ta KHÔNG phân biệt được
    // "sidecar còn sống của CHÍNH lượt chạy này" với "tàn dư của lượt trước". Nêu tên nhầm sẽ đẩy
    // người trực đi tắt một tiến trình đang phục vụ sản xuất — hỏng nặng hơn hẳn việc thú nhận mù.
    console.warn(
      `[vram] có ${preliminary.orphans.length} tiến trình chạy ảnh thực thi của hệ đang giữ GPU nhưng ` +
        `KHÔNG đọc được bảng tiến trình để biết chúng có phải con của lượt chạy NÀY không — ghi nhận MÙ, ` +
        `không kết luận.`,
    );
    return null;
  }
  return classifyHolders({ holders, procs, roots, ownExecutables, appRoot });
}
