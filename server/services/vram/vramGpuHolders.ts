import { execFile } from "node:child_process";
import { collectDescendants, type RawProcRow } from "./vramProcessProbe";

/**
 * Pha 2B Task 1 — AI ĐANG GIỮ GPU? (bản liệt kê DANH TÍNH, không phải bản liệt kê BYTE)
 *
 * ⚠⚠ ĐỌC TRƯỚC KHI DÙNG MODULE NÀY CHO BẤT CỨ PHÉP TÍNH NÀO: nó trả về **AI**, KHÔNG trả về
 * **BAO NHIÊU**. Trên máy WDDM này `nvidia-smi --query-compute-apps` trả `used_memory = [N/A]`
 * cho **mọi** dòng (đo được 15/15 ngày 2026-08-04). Module này vì thế chỉ đủ để **ĐÁNH DẤU
 * NGHI NGỜ**, KHÔNG đủ để **TRỪ**. Ai đó "ước lượng" byte cho một PID ở đây rồi trừ khỏi nền là
 * biến một trạng thái mù CÓ TIẾNG thành một con số sai IM LẶNG — đúng lớp lỗi cả Pha 2B tồn tại
 * để diệt.
 *
 * ─── VÌ SAO KHÔNG PHẢI "MỌI PID KHÔNG PHẢI CỦA TA ĐỀU LẠ" ───────────────────────────────────
 * Kế hoạch Pha 2B viết vậy, nhưng SỐ ĐO bác bỏ bản đọc nguyên văn. Cùng lệnh đó trên chính máy
 * này liệt kê **cả desktop**: `explorer.exe`, `SearchHost.exe`, `StartMenuExperienceHost.exe`,
 * `Code.exe`, `msedge.exe`, `msedgewebview2.exe` ×2, `Docker Desktop.exe`, `ShellExperienceHost.exe`,
 * `SystemSettings.exe`, `ApplicationFrameHost.exe`, `CrossDeviceResume.exe`, `Display Driver.exe`,
 * và một PID `[Insufficient Permissions]`. Tập "không phải của ta" vì thế **KHÔNG BAO GIỜ rỗng**
 * trên một máy Windows có người ngồi trước màn hình.
 *
 * ⚠ LÝ DO MẠNH NHẤT (review vòng 1 chỉ ra, mạnh hơn lý do bản đầu của task này nêu): vì
 * `headroom = trần − max(ledgerTotal, attributable)` và `max(L, A) ≥ L`, **`attributable = null`
 * (chỉ-sổ) là CHẶN TRÊN của mọi headroom**. Mọi đường đẩy hệ vào `null` vì thế **KHÔNG làm hệ
 * nghiêm khắc hơn — nó làm hệ nghiêm khắc BẰNG 0**. Bản đọc nguyên văn ⇒ nền không bao giờ chụp
 * được ⇒ `attributable` vĩnh viễn `null` ⇒ cưỡng chế **lỏng nhất có thể, ở mọi cấu hình, mãi mãi**.
 *
 * ─── VỊ TỪ THẬT SỰ ĐƯỢC CÀI ────────────────────────────────────────────────────────────────
 * Lỗ mà `vramReconciler.ts` TỰ KHAI không phải "desktop dùng GPU" — nền sinh ra CHÍNH LÀ để hấp
 * thụ thứ đó (Pha 1 I-1: máy sạch, app tắt, GPU đã dùng 1.090 MiB). Lỗ đó là: **server khởi động
 * lại trong khi TIẾN TRÌNH CON CỦA CHÍNH TA còn sống** (sidecar thị giác 7,8 GB).
 *
 *     MỒ CÔI = đang giữ GPU  ∧  chạy đúng thứ CHÍNH TA được cấu hình để sinh ra
 *              ∧  KHÔNG nằm trong cây tiến trình của ta
 *              ∧  KHÔNG phải ANH EM ĐANG SỐNG của cùng một lượt khởi chạy   ← C-1, review vòng 1
 *
 * ⚠⚠ VẾ THỨ BA LÀ BẮT BUỘC, KHÔNG PHẢI TINH CHỈNH (C-1). `package.json` có `start` =
 * `node dist/index.js` và `start:worker` = `node dist/worker.js`: **hai tiến trình ANH EM**, và
 * `backgroundJobs.ts` cho **cả hai** vai trò gọi `startVramReconciler()`. Anh em chạy đúng
 * `process.execPath` và **ngoài cây tiến trình của nhau** ⇒ nếu chỉ có hai vế đầu, mỗi vai trò sẽ
 * gọi vai trò kia là "mồ côi", đánh dấu nền KHÔNG XÁC MINH **vĩnh viễn**, và bảo người trực
 * `Stop-Process` một **tiến trình sản xuất đang sống**.
 *
 * ⚠ VÀ VẾ THỨ HAI PHẢI HẸP (I-3, review vòng 1): bản đầu so khớp cả **TÊN FILE TRẦN** để đỡ ca
 * `LOCAL_TRAINER_CMD=python tools/trainer/train.py` (`.env:259`). Hệ quả: **mọi** `python.exe` giữ
 * GPU trên máy bị gọi là "của ta" — job của người khác bị vu là mồ côi, và người trực được khuyên
 * đi giết nó. Nay so khớp chỉ theo: **đường dẫn đầy đủ đã khai** · **ảnh thực thi trong thư mục
 * ứng dụng** · **dòng lệnh chứa thư mục ứng dụng** · **dòng lệnh chứa chữ ký lệnh đã khai**
 * (`tools/trainer/train.py`). Hai lối sau phủ trọn ca `python` trần mà không đụng ai khác:
 * `localSidecarTrainer.jobRootDir()` = `process.cwd()/uploads/training/jobs/<id>` — **tuyệt đối,
 * nằm trong thư mục ứng dụng** — nên dòng lệnh của trainer luôn mang dấu vết đó.
 *
 * ⚠ PHẦN LỖ CÒN LẠI, NÓI THẲNG: một hộ tiêu thụ CUDA **của người khác** cỡ lớn (`ollama.exe`) vẫn
 * bị hấp thụ vào nền. Ba đường đóng nó đã ghi ở `task-1-report.md` (mục Pha 3), gồm cả việc dùng
 * bộ đếm PDH làm **vị từ boolean** — Đ4 cấm TRỘN HAI THƯỚC **TRONG MỘT PHÉP TÍNH**, và một vị từ
 * boolean không có số nào băng qua ranh giới, nên đó là một **quyết định chưa lấy**, không phải
 * một điều cấm hiển nhiên.
 */
export interface GpuHolder {
  readonly pid: number;
  /** Đường dẫn ảnh thực thi ĐÚNG NHƯ nvidia-smi trả về (có thể là `[Insufficient Permissions]`). */
  readonly name: string;
}

export interface GpuHolderCensus {
  /** Toàn bộ hộ đang giữ GPU, không lọc. `ours ∪ siblings ∪ orphans ∪ thirdParty` = tập này. */
  readonly holders: readonly GpuHolder[];
  /** Nằm trong cây tiến trình của ta ⇒ byte của chúng thuộc về sổ, không thuộc về nền. */
  readonly ours: readonly GpuHolder[];
  /**
   * C-1 — VAI TRÒ ANH EM ĐANG SỐNG của cùng một lượt khởi chạy (`api` ⇄ `worker`): chung tổ tiên
   * còn sống với ta. KHÔNG phải mồ côi, và TUYỆT ĐỐI không được khuyên người trực tắt.
   * ⚠ Byte của anh em vẫn nằm ngoài sổ CỦA TIẾN TRÌNH NÀY (mỗi vai trò một sổ riêng — xem
   * `describeTopologyHint()`); sổ chung là Pha 3. Ở đây chúng chỉ được miễn khỏi cáo buộc "tàn dư".
   */
  readonly siblings: readonly GpuHolder[];
  /** ⚠ Chạy thứ của ta, ngoài cây, KHÔNG phải anh em sống ⇒ tàn dư lượt chạy TRƯỚC ⇒ nền NHIỄM. */
  readonly orphans: readonly GpuHolder[];
  /** Của người khác (desktop, trình duyệt…) ⇒ đúng thứ nền sinh ra để hấp thụ. */
  readonly thirdParty: readonly GpuHolder[];
}

/** Một dòng bảng tiến trình. `cmdline` có thể rỗng (tiến trình ta không đủ quyền đọc). */
export interface ProcTableRow extends RawProcRow {
  readonly cmdline: string;
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
 * Bảng tiến trình do PowerShell trả về.
 *
 * ⚠ M-2 (review vòng 1) — `null` CHỈ có nghĩa **KHÔNG PARSE ĐƯỢC**. Một bảng parse được nhưng
 * RỖNG trả về `[]`. Bản trước gộp hai thứ đó vào cùng `null`, tức gán ngữ nghĩa "đầu dò hỏng" cho
 * một câu trả lời hợp lệ — người gọi mất khả năng phân biệt "không đọc được" với "đọc được và
 * không có gì". (Ở Windows bảng rỗng là bất khả thi, nên người gọi vẫn từ chối kết luận ở cả hai
 * ca — nhưng nó từ chối vì HAI lý do KHÁC NHAU, và nói ra được lý do nào.)
 */
export function parseProcTable(rawJson: string): ProcTableRow[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    return null;
  }
  // ⚠ `ConvertTo-Json` trả về MỘT OBJECT (không phải mảng) khi tập hợp chỉ có một phần tử.
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  const out: ProcTableRow[] = [];
  for (const row of rows) {
    const r = row as { pid?: unknown; ppid?: unknown; cmd?: unknown };
    if (typeof r?.pid === "number" && typeof r?.ppid === "number") {
      out.push({ pid: r.pid, ppid: r.ppid, cmdline: typeof r.cmd === "string" ? r.cmd : "" });
    }
  }
  return out;
}

/** So khớp đường dẫn Windows: không phân biệt hoa/thường, `/` ≡ `\`. */
function norm(p: string): string {
  return p.trim().toLowerCase().replace(/\//g, "\\");
}

/**
 * C-1 — chuỗi TỔ TIÊN còn sống của một tiến trình, GIỚI HẠN ĐỘ SÂU.
 *
 * ⚠⚠ ĐỘ SÂU LÀ ĐÁNH ĐỔI CÓ HAI ĐẦU, ĐỪNG NỚI MÀ KHÔNG ĐỌC HẾT ĐOẠN NÀY:
 *   • sâu QUÁ ⇒ tổ tiên chung trở thành cái vỏ (`cmd.exe`, `Code.exe`, `explorer.exe`) mà MỌI thứ
 *     người dùng khởi chạy đều nằm dưới ⇒ mọi hộ đều thành "anh em" ⇒ cổng này mù hoàn toàn;
 *   • nông QUÁ ⇒ hai vai trò do hai người giám sát khác nhau khởi chạy không tìm thấy neo chung ⇒
 *     anh em SỐNG bị gọi là mồ côi (đúng lỗi C-1).
 * `2` phủ đúng hình dạng ĐANG CÓ trong `package.json`: một người giám sát (`pm2`/`npm`/Docker)
 * sinh cả hai vai trò ⇒ **chung cha** (độ sâu 1), và `tsx watch` chèn thêm một tầng ⇒ độ sâu 2.
 * Ca "hai terminal riêng" KHÔNG có neo chung ở bất kỳ độ sâu hợp lý nào — nó được xử ở chỗ khác:
 * câu cảnh báo của `vramReconciler` NÓI RÕ có thể là anh em sống và CẤM tự ý tắt khi `ROLE` bật.
 */
const ANCESTOR_DEPTH = 2;

export function collectAncestors(procs: readonly RawProcRow[], pid: number, maxDepth = ANCESTOR_DEPTH): Set<number> {
  const parentOf = new Map<number, number>();
  for (const row of procs) parentOf.set(row.pid, row.ppid);
  const out = new Set<number>();
  let cur = pid;
  for (let i = 0; i < maxDepth; i++) {
    const parent = parentOf.get(cur);
    // pid ≤ 4 là System/Idle của Windows — neo vào đó thì cả máy là "anh em".
    if (parent === undefined || parent <= 4 || out.has(parent)) break;
    out.add(parent);
    cur = parent;
  }
  return out;
}

/**
 * Biến môi trường khai ẢNH THỰC THI mà hệ này được cấu hình để sinh ra.
 *
 * ⚠⚠ I-2 (review vòng 1) — DANH SÁCH NÀY LÀ MỘT VỊ TỪ AN TOÀN, KHÔNG PHẢI DANH SÁCH TIỆN TAY.
 * Thiếu một tên ở đây = mồ côi của hộ đó **vô hình** với cổng. `WHISPER_BIN` đã lọt ở bản đầu:
 * whisper.cpp dựng với CUDA là hộ tiêu thụ THẬT (chính `vramAllocationSites.ts:239` gọi tên nó
 * như vậy), `wired:false`, đường dẫn `C:/tools/…` **ngoài** thư mục ứng dụng nên lưới `appRoot`
 * không đỡ, và nó cách một dấu `#` trong `.env:738` với `VIDEO_INGEST_ENABLED=true` ngay trên.
 * ⇒ `reconciler.baselinePids.test.ts` có một ca ĐỐI CHIẾU danh sách này với mọi biến `*_BIN`/`*_CMD`
 * mà `KNOWN_ALLOCATION_SITES` nêu đích danh; thêm hộ mới mà quên khai ⇒ ca đó ĐỎ.
 */
export const OWN_EXECUTABLE_ENV_VARS = [
  "LLAMA_SERVER_BIN", // sidecar thị giác — HỘ LỚN NHẤT HỆ (7,8 GB), đúng ca tự khai ở reconciler
  "LOCAL_TRAINER_CMD", // sidecar huấn luyện (trần 2 GIỜ)
  "LLM_FINETUNE_CMD", // sidecar tinh chỉnh LLM (trần 4 GIỜ)
  "WHISPER_BIN", // I-2 — whisper.cpp CUDA, đường dẫn ngoài thư mục ứng dụng
  "PLUGIN_SIDECAR_CMD", // sidecar plugin: lệnh TUỲ Ý do cấu hình quyết
] as const;

/** Token đầu của một lệnh, CHỈ khi nó là ĐƯỜNG DẪN (có dấu gạch) — xem I-3 ở docstring đầu file. */
function firstTokenIfPath(cmd: string | undefined): string | undefined {
  const first = (cmd ?? "").trim().split(/\s+/).filter(Boolean)[0];
  if (!first) return undefined;
  return first.includes("\\") || first.includes("/") ? first : undefined;
}

/** Phần SAU token đầu của một lệnh (vd. `tools/trainer/train.py`) — chữ ký nhận dạng dòng lệnh. */
function commandSignature(cmd: string | undefined): string | undefined {
  const rest = (cmd ?? "").trim().split(/\s+/).filter(Boolean).slice(1).join(" ");
  return rest.length > 0 ? rest : undefined;
}

export function ownExecutablePaths(): string[] {
  const out = [process.execPath]; // node của ta: mọi tiến trình con chạy bằng node + MỌI vai trò anh em
  for (const key of OWN_EXECUTABLE_ENV_VARS) {
    const raw = process.env[key];
    if (!raw || raw.trim().length === 0) continue;
    // `*_BIN` là đường dẫn; `*_CMD` là lệnh — chỉ lấy token đầu KHI nó là đường dẫn (I-3).
    const p = key.endsWith("_CMD") ? firstTokenIfPath(raw) : raw.trim();
    if (p) out.push(p);
  }
  return out;
}

/** Chữ ký dòng lệnh của các sidecar khai bằng `*_CMD` — lối nhận dạng thay cho tên file trần (I-3). */
export function ownCommandSignatures(): string[] {
  const out: string[] = [];
  for (const key of OWN_EXECUTABLE_ENV_VARS) {
    if (!key.endsWith("_CMD")) continue;
    const sig = commandSignature(process.env[key]);
    if (sig) out.push(sig);
  }
  return out;
}

export function classifyHolders(input: {
  holders: readonly GpuHolder[];
  procs: readonly ProcTableRow[] | readonly RawProcRow[];
  roots: readonly number[];
  ownExecutables: readonly string[];
  appRoot?: string;
  commandSignatures?: readonly string[];
}): GpuHolderCensus {
  const { holders, procs, roots, ownExecutables, appRoot, commandSignatures = [] } = input;
  // ⚠ DÙNG LẠI cây tiến trình của Pha 2A — KHÔNG dựng đường thứ hai. Hai bản dựng cây song song
  // là đúng lớp lỗi "sổ song song" mà bốn pha trước đã trả giá.
  const ourTree = collectDescendants(procs, roots);
  const rootSet = new Set(roots);
  // C-1 — NEO ANH EM: tổ tiên còn sống của ta. Một hộ có tổ tiên chung với ta là vai trò khác của
  // CÙNG lượt khởi chạy, không phải tàn dư của lượt trước.
  const ourAnchors = new Set<number>();
  for (const r of roots) for (const a of collectAncestors(procs, r)) ourAnchors.add(a);

  const exact = new Set(ownExecutables.map(norm));
  const root = appRoot ? norm(appRoot).replace(/\\+$/, "") : "";
  const sigs = commandSignatures.map(norm).filter((s) => s.length > 0);
  const cmdlineOf = new Map<number, string>();
  for (const row of procs) {
    const c = (row as ProcTableRow).cmdline;
    if (typeof c === "string" && c.length > 0) cmdlineOf.set(row.pid, norm(c));
  }

  // ⚠ I-3 — KHÔNG so khớp theo TÊN FILE TRẦN. Bốn lối dưới đây đều đòi một dấu vết CỦA RIÊNG HỆ
  // NÀY (đường dẫn đã khai / thư mục ứng dụng / chữ ký lệnh đã khai), nên `python.exe` của người
  // khác KHÔNG thể lọt vào.
  const runsOurCode = (h: GpuHolder) => {
    const n = norm(h.name);
    if (exact.has(n)) return true;
    if (root.length > 0 && n.startsWith(`${root}\\`)) return true;
    const cmd = cmdlineOf.get(h.pid);
    if (!cmd) return false;
    if (root.length > 0 && cmd.includes(root)) return true;
    return sigs.some((s) => cmd.includes(s));
  };

  const ours: GpuHolder[] = [];
  const siblings: GpuHolder[] = [];
  const orphans: GpuHolder[] = [];
  const thirdParty: GpuHolder[] = [];
  for (const h of holders) {
    if (rootSet.has(h.pid) || ourTree.has(h.pid)) {
      ours.push(h);
      continue;
    }
    if (!runsOurCode(h)) {
      thirdParty.push(h);
      continue;
    }
    // C-1 — chung tổ tiên CÒN SỐNG ⇒ vai trò anh em của cùng lượt khởi chạy, KHÔNG phải tàn dư.
    const anchors = collectAncestors(procs, h.pid);
    if ([...anchors].some((a) => ourAnchors.has(a))) siblings.push(h);
    else orphans.push(h);
  }
  return { holders, ours, siblings, orphans, thirdParty };
}

const SMI_TIMEOUT_MS = 3000;
const PS_TIMEOUT_MS = 10_000;
const PROBE_ON_VALUES = new Set(["on", "true", "1", "yes", "enabled", "enable"]);
let warnedUnavailable = false;

/**
 * Công tắc — cùng khuôn `VRAM_PROCESS_PROBE` (Pha 2A Task 3): **danh sách BẬT**, biến KHÔNG ĐẶT
 * ⇒ BẬT (mặc định sản xuất), mọi giá trị khác (kể cả gõ sai) ⇒ TẮT.
 *
 * ⚠⚠ M-4 (review vòng 1) — BẤT ĐỐI XỨNG CÓ CHỦ Ý, VÀ NÓ CÓ GIÁ: `vitest.setup.ts` đặt mặc định
 * `off` cho CẢ bộ test (nếu không, kết quả test phụ thuộc vào việc máy đang mở Chrome hay không —
 * đo được 15 hộ desktop). Hệ quả phải nói thẳng: **chuỗi thật `nvidia-smi → parseComputeApps →
 * classifyHolders` KHÔNG có lưới hồi quy nào** — 257+ ca xanh không chứng minh gì về nó. Bằng
 * chứng duy nhất là **nghiệm thu sống** (ghi ở `task-1-report.md` §6). Ai đổi cờ `nvidia-smi`, đổi
 * định dạng đầu ra, hay đổi `PS_PROC_TABLE`: **bộ test sẽ KHÔNG bắt được**. Muốn có lưới thì phải
 * chạy có chủ đích `VRAM_GPU_HOLDER_SCAN=on` trên máy có GPU.
 */
function scanDisabled(): boolean {
  const raw = process.env.VRAM_GPU_HOLDER_SCAN;
  if (raw === undefined) return false;
  return !PROBE_ON_VALUES.has(raw.trim().toLowerCase());
}

function run(cmd: string, args: string[], timeout: number): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      execFile(cmd, args, { timeout, maxBuffer: 16 * 1024 * 1024, windowsHide: true }, (err, stdout) => {
        resolve(err ? null : String(stdout ?? ""));
      });
    } catch {
      resolve(null); // `execFile` ném ĐỒNG BỘ (EACCES…) — telemetry không được làm ngã người gọi
    }
  });
}

/**
 * ⚠ M-3 (review vòng 1) — `powershell.exe` ghi cứng là ĐÚNG **vì** lời gọi đã bị rào nền tảng ở
 * `readGpuHolders()` (`process.platform !== "win32"` ⇒ `null`). `Win32_Process` là WMI, chỉ tồn
 * tại trên Windows; trên nền tảng khác thì không phải "đổi tên shell" mà là **phải viết một đường
 * liệt kê khác hẳn** (`/proc`, `ps`). Rào tường minh + `null` (= chưa xác minh) trung thực hơn một
 * lời gọi chắc chắn thất bại.
 */
const PS_PROC_TABLE = [
  "$ErrorActionPreference='Stop';",
  "Get-CimInstance Win32_Process|ForEach-Object{ @{ pid=[int]$_.ProcessId; ppid=[int]$_.ParentProcessId; cmd=[string]$_.CommandLine } }|",
  "ConvertTo-Json -Compress",
].join(" ");

function warnOnce(msg: string): void {
  if (warnedUnavailable) return;
  warnedUnavailable = true;
  console.warn(msg);
}

/**
 * Liệt kê tiến trình đang giữ GPU và phân loại. `null` = **KHÔNG QUÉT ĐƯỢC** — người gọi phải coi
 * đó là "chưa xác minh", TUYỆT ĐỐI không phải "sạch".
 *
 * ⚠ M-1 (review vòng 1 GIỮ NGUYÊN quyết định; ghi lý do lại đây để người sau khỏi "tối ưu") —
 * **CỐ Ý KHÔNG dùng lại `vramProcessProbe.readProcessVram()`** dù nó cũng đọc `Win32_Process`.
 * Hai lý do, cả hai là lý do AN TOÀN chứ không phải sở thích: (1) nó kéo theo `Get-Counter` với
 * biên lắng **~1,2 s** (xem `PS_SCRIPT` ở file đó) cho một câu hỏi không cần byte nào; (2) nó trả
 * về **byte PDH theo tiến trình**, tức đặt một thước KHÁC ngay cạnh chỗ đang tính nền bằng
 * `nvidia-smi` — mồi cho một vi phạm Đ4 mà người sau chỉ cần "dọn dẹp" một dòng là sập vào. Thứ
 * DÙNG LẠI ở đây là `collectDescendants` — cây tiến trình, không phải phép đo.
 *
 * KHÔNG BAO GIỜ ném.
 */
export async function readGpuHolders(roots: readonly number[]): Promise<GpuHolderCensus | null> {
  if (scanDisabled()) return null;
  if (process.platform !== "win32") {
    warnOnce(
      `[vram] không liệt kê được tiến trình giữ GPU trên nền tảng "${process.platform}" ` +
        "(đường quét hiện chỉ có bản Windows: nvidia-smi + Win32_Process) — nền sẽ được ghi là CHƯA XÁC MINH.",
    );
    return null;
  }
  const csv = await run(
    "nvidia-smi",
    ["--query-compute-apps=pid,process_name", "--format=csv,noheader"],
    SMI_TIMEOUT_MS,
  );
  if (csv === null) {
    warnOnce(
      "[vram] KHÔNG liệt kê được tiến trình đang giữ GPU (nvidia-smi vắng/lỗi) — nền sẽ được ghi " +
        "là CHƯA XÁC MINH. Đây là mất phép ĐO, không phải bằng chứng sạch.",
    );
    return null;
  }

  const holders = parseComputeApps(csv);
  const ownExecutables = ownExecutablePaths();
  const commandSignatures = ownCommandSignatures();
  const appRoot = process.cwd();
  const rootSet = new Set(roots);
  // Không hộ nào ngoài chính ta ⇒ khỏi bảng tiến trình (không cần cây, tổ tiên, hay dòng lệnh).
  if (!holders.some((h) => !rootSet.has(h.pid))) {
    return classifyHolders({ holders, procs: [], roots, ownExecutables, appRoot, commandSignatures });
  }

  const json = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", PS_PROC_TABLE], PS_TIMEOUT_MS);
  const procs = json === null ? null : parseProcTable(json);
  if (procs === null || procs.length === 0) {
    // ⚠ CỐ Ý trả `null` (chưa xác minh) thay vì đoán: không có bảng tiến trình thì ta không phân
    // biệt được "anh em ĐANG SỐNG" với "tàn dư lượt trước" (C-1) — và nêu tên nhầm sẽ đẩy người
    // trực đi tắt một tiến trình đang phục vụ sản xuất.
    console.warn(
      `[vram] KHÔNG đọc được bảng tiến trình (${json === null ? "powershell lỗi/timeout" : "bảng RỖNG — bất thường"}) ` +
        "⇒ không phân loại được hộ đang giữ GPU. Ghi nhận CHƯA XÁC MINH, không kết luận.",
    );
    return null;
  }
  return classifyHolders({ holders, procs, roots, ownExecutables, appRoot, commandSignatures });
}
