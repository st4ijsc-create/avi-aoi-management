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
 *     NGHI NGỜ = đang giữ GPU  ∧  chạy đúng thứ CHÍNH TA được cấu hình để sinh ra
 *                ∧  KHÔNG nằm trong cây tiến trình của ta
 *
 *     …rồi TÁCH LÀM HAI, và **chỉ để chọn CÂU NÓI**, không để chọn mức an toàn:
 *       • **VAI TRÒ ANH EM** (`peers`) — dòng lệnh mang một ĐIỂM VÀO đã khai (`dist/worker.js`…),
 *         hoặc là con trực tiếp của một vai trò như thế ⇒ tiến trình ĐANG PHỤC VỤ, sổ RIÊNG.
 *         **KHÔNG BAO GIỜ khuyên tắt.**
 *       • **TÀN DƯ** (`orphans`) — phần còn lại ⇒ sidecar mất chủ ⇒ khuyên tắt THEO ĐÚNG PID.
 *
 * ⚠⚠⚠ RE-REVIEW VÒNG 1 (A + D) — **TÁCH MỨC AN TOÀN KHỎI MỨC CHẨN ĐOÁN.** Bản trước suy quan hệ
 * từ **HÌNH DẠNG CÂY TIẾN TRÌNH** (neo tổ tiên, `ANCESTOR_DEPTH`), và nó hỏng ở CẢ HAI ĐẦU:
 *   • (A) `ppid` lấy nguyên văn ⇒ khi Windows **cấp lại PID** của một launcher đã chết — đúng vòng
 *     lặp kill→restart mà cổng này sinh ra để bắt — một tàn dư THẬT bị xếp là anh em, nền đóng dấu
 *     `verified = TRUE`, và **không lượt quét nào tự sửa nữa**. Bắt sót để lại một cảnh báo; bắt
 *     quá tay để lại một **con số sai ĐƯỢC TIN** — tệ hơn hẳn.
 *   • (D) đường khởi chạy mà `backgroundJobs.ts` **ghi chính thức** (`npm run start:worker`
 *     alongside) chèn `cmd.exe` + `npm-cli` + `cross-env` ⇒ neo chung ở **độ sâu 3-5**; ở độ sâu 2
 *     anh em ĐANG SỐNG vẫn bị vu là tàn dư. Nới độ sâu thì neo chạm `Code.exe`/`explorer.exe` —
 *     đổi bắt-sót lấy bắt-quá-tay.
 *
 * ⇒ **CẢ CƠ CHẾ NEO TỔ TIÊN ĐÃ BỊ GỠ** (`ANCESTOR_DEPTH` không còn tồn tại — một hằng số chịu lực
 * mà không ca test nào ràng được ở cả hai chiều thì coi như chưa có). Thay bằng hai thứ ĐO ĐƯỢC:
 *   1. **ĐIỂM VÀO ĐÃ KHAI** (`ROLE_ENTRYPOINT_MARKERS`, có lưới đối chiếu với `package.json`);
 *   2. **QUAN HỆ CHA-CON MỘT BƯỚC, có `CreationDate` làm chứng** (`ctime(cha) ≤ ctime(con)`) —
 *      đúng liều thuốc reviewer chỉ định cho (A), và đủ cho MỌI sidecar vì tất cả đều `spawn()`
 *      TRỰC TIẾP từ tiến trình vai trò.
 *
 * ⇒ **VÀ QUAN TRỌNG NHẤT — MỨC AN TOÀN KHÔNG CÒN PHỤ THUỘC VÀO PHÉP PHÂN LOẠI NÀY.**
 * `baselineVerified` tắt khi **`orphans` HOẶC `peers` khác rỗng**, tức khi có BẤT KỲ mã nào của hệ
 * đang giữ GPU ngoài cây tiến trình này. Phân loại sai (cả hai chiều) chỉ đổi CÂU NÓI, **không thể**
 * đẻ ra một con số sai được TIN — lối hỏng của (A) bị đóng bằng CẤU TRÚC, không bằng độ chính xác
 * của một vị từ. Đây là điều kiện để phần còn lại được phép là suy đoán tốt nhất có thể.
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
   * C-1 — VAI TRÒ ANH EM ĐANG PHỤC VỤ (`api` ⇄ `worker` ⇄ `edge`), nhận ra bằng **ĐIỂM VÀO đã
   * khai trong dòng lệnh**, hoặc là **con trực tiếp** của một tiến trình như thế. TUYỆT ĐỐI không
   * được khuyên người trực tắt: `backgroundJobs.ts` ghi chính thức rằng topology này là cách chạy
   * được chỉ định, nên "tắt nó đi" là lời khuyên phá sản xuất.
   *
   * ⚠ Byte của anh em vẫn nằm NGOÀI sổ của tiến trình này (mỗi vai trò một sổ riêng — xem
   * `describeTopologyHint()`; sổ chung là Pha 3) ⇒ nó **VẪN LÀM `baselineVerified` TẮT**. Ngăn này
   * chỉ đổi CÂU NÓI, không đổi mức an toàn — xem khối (A)+(D) ở đầu file.
   */
  readonly peers: readonly GpuHolder[];
  /** ⚠ Chạy thứ của ta, ngoài cây, KHÔNG phải vai trò anh em ⇒ tàn dư lượt trước ⇒ nền NHIỄM. */
  readonly orphans: readonly GpuHolder[];
  /** Của người khác (desktop, trình duyệt…) ⇒ đúng thứ nền sinh ra để hấp thụ. */
  readonly thirdParty: readonly GpuHolder[];
}

/** Một dòng bảng tiến trình. `cmdline` có thể rỗng (tiến trình ta không đủ quyền đọc). */
export interface ProcTableRow extends RawProcRow {
  readonly cmdline: string;
  /**
   * ★ (A) re-review vòng 1 — `Win32_Process.CreationDate` đổi ra số (FILETIME UTC). `0` = KHÔNG
   * ĐỌC ĐƯỢC (thiếu quyền) và phải được đối xử như **không có bằng chứng**, không phải "rất cũ".
   *
   * ⚠ VÌ SAO BẮT BUỘC: PID trên Windows **được cấp lại**. Không có mốc tạo, quan hệ "cha-con" chỉ
   * là một con số trùng nhau — và nó trùng ĐÚNG LÚC nguy hiểm nhất: vòng lặp kill→restart chính là
   * lúc PID của tiến trình vừa chết được cấp cho tiến trình mới.
   */
  readonly ctime: number;
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
    const r = row as { pid?: unknown; ppid?: unknown; cmd?: unknown; ct?: unknown };
    if (typeof r?.pid === "number" && typeof r?.ppid === "number") {
      out.push({
        pid: r.pid,
        ppid: r.ppid,
        cmdline: typeof r.cmd === "string" ? r.cmd : "",
        ctime: typeof r.ct === "number" && Number.isFinite(r.ct) && r.ct > 0 ? r.ct : 0,
      });
    }
  }
  return out;
}

/** So khớp đường dẫn Windows: không phân biệt hoa/thường, `/` ≡ `\`. */
function norm(p: string): string {
  return p.trim().toLowerCase().replace(/\//g, "\\");
}

/**
 * ★★★ (D) re-review vòng 1 — ĐIỂM VÀO CỦA CÁC VAI TRÒ, khai TƯỜNG MINH.
 *
 * Đây là thứ thay thế cho cơ chế "neo tổ tiên" đã bị gỡ. Nhận ra một vai trò anh em bằng **thứ nó
 * đang CHẠY** (dòng lệnh chứa điểm vào) thay vì bằng **chỗ nó nằm trong cây tiến trình**: hình dạng
 * cây phụ thuộc `npm`/`cross-env`/`tsx`/Docker và đo được là 1→5 tầng, còn điểm vào thì KHÔNG đổi
 * dù ai khởi chạy nó bằng cách gì.
 *
 * ⚠ THÊM VAI TRÒ MỚI mà quên khai ở đây ⇒ vai trò đó bị vu là "tàn dư" và người trực được khuyên
 * tắt một tiến trình đang phục vụ. `reconciler.baselinePids.test.ts` có LƯỚI đối chiếu danh sách
 * này với `package.json` (`start*`/`dev*`) — quên là ĐỎ.
 */
export const ROLE_ENTRYPOINT_MARKERS = [
  "dist\\index.js",
  "dist\\worker.js",
  "dist\\edgegatewaymain.js",
  "server\\_core\\index.ts",
  "server\\worker.ts",
  "server\\edge\\edgegatewaymain.ts",
] as const;

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

/**
 * ⚠ m-6 (re-review vòng 1) — `cmdline.includes(appRoot)` TRẦN là một biến thể HẸP của I-3: một
 * tiến trình của người khác chỉ cần ĐỌC một file trong thư mục ứng dụng (`python doc.py
 * D:\…\avi-aoi-management\data\x.csv`) là bị nhận vơ. Nay đòi thêm: đường dẫn đó phải trỏ vào một
 * thư mục mà CHÍNH TA sinh tiến trình con từ đó. `uploads\` phủ `jobRootDir()`
 * (`<appRoot>/uploads/training/jobs/<id>`), ba cái còn lại phủ mã và công cụ.
 */
const APP_SUBDIR_MARKERS = ["uploads\\", "dist\\", "server\\", "tools\\", "scripts\\"] as const;

/**
 * ★★★ (A) re-review vòng 1, MỞ RỘNG — CẮT MỌI LIÊN KẾT CHA-CON KHÔNG CÓ BẰNG CHỨNG, **TRƯỚC** khi
 * dựng cây.
 *
 * ⚠⚠ PHÁT HIỆN KHI VIẾT CA TEST CHO (A), VÀ NÓ NẶNG HƠN CHỖ REVIEWER CHỈ: PID được cấp lại không
 * chỉ đánh lừa phép "con của vai trò" — nó đánh lừa **cả `collectDescendants()`**. Một tàn dư mang
 * `ppid` trùng số với tiến trình CỦA TA sẽ bị xếp thẳng vào `ours`, mà `ours` **KHÔNG tắt cờ
 * `baselineVerified`** ⇒ đúng lối hỏng (A) mô tả (nền nhiễm được TIN), chỉ khác cửa vào và không
 * có ngăn nào để lộ ra.
 *
 * ⇒ Bằng chứng phải áp ở NGUỒN: một liên kết `ppid` chỉ được giữ khi CẢ HAI mốc tạo đọc được VÀ
 * `ctime(cha) ≤ ctime(con)`. Không có bằng chứng ⇒ KHÔNG có liên kết (đặt `ppid = 0`, một PID
 * không tồn tại). Hệ quả đã cân nhắc: một tiến trình con THẬT mà ta không đọc được mốc tạo sẽ rơi
 * khỏi `ours` — nhưng nó rơi vào `peers`/`orphans`, tức **tắt cờ verified**, tức phía AN TOÀN.
 */
function pruneUnprovenParentLinks(procs: readonly ProcTableRow[]): ProcTableRow[] {
  const byPid = new Map<number, ProcTableRow>();
  for (const r of procs) byPid.set(r.pid, r);
  return procs.map((r) => {
    const parent = byPid.get(r.ppid);
    const proven = parent !== undefined && r.ctime > 0 && parent.ctime > 0 && parent.ctime <= r.ctime;
    return proven ? r : { ...r, ppid: 0 };
  });
}

export function classifyHolders(input: {
  holders: readonly GpuHolder[];
  /**
   * ⚠ CỐ Ý KHÔNG nhận `RawProcRow` (chỉ pid/ppid): thiếu `ctime` thì mọi liên kết cha-con đều là
   * một con số trùng nhau, và `pruneUnprovenParentLinks()` sẽ cắt sạch — im lặng biến `ours` thành
   * rỗng. Bắt lỗi ở KIỂU rẻ hơn nhiều so với bắt bằng một lượt nghiệm thu sống.
   */
  procs: readonly ProcTableRow[];
  roots: readonly number[];
  ownExecutables: readonly string[];
  appRoot?: string;
  commandSignatures?: readonly string[];
  roleMarkers?: readonly string[];
}): GpuHolderCensus {
  const {
    holders,
    procs,
    roots,
    ownExecutables,
    appRoot,
    commandSignatures = [],
    roleMarkers = ROLE_ENTRYPOINT_MARKERS,
  } = input;
  // ⚠ DÙNG LẠI cây tiến trình của Pha 2A — KHÔNG dựng đường thứ hai. Hai bản dựng cây song song
  // là đúng lớp lỗi "sổ song song" mà bốn pha trước đã trả giá.
  // ⚠ (A) — cắt liên kết KHÔNG CÓ BẰNG CHỨNG trước khi dựng cây, xem `pruneUnprovenParentLinks()`.
  // Làm ở đây (thay vì sửa `collectDescendants`) để KHÔNG đụng vào đường đo của `vramProcessProbe`.
  const provenProcs = pruneUnprovenParentLinks(procs);
  const ourTree = collectDescendants(provenProcs, roots);
  const rootSet = new Set(roots);

  const exact = new Set(ownExecutables.map(norm));
  const root = appRoot ? norm(appRoot).replace(/\\+$/, "") : "";
  const sigs = commandSignatures.map(norm).filter((s) => s.length > 0);
  const markers = roleMarkers.map(norm).filter((s) => s.length > 0);
  const rowOf = new Map<number, ProcTableRow>();
  for (const row of procs) {
    const r = row as ProcTableRow;
    rowOf.set(r.pid, { pid: r.pid, ppid: r.ppid, cmdline: norm(r.cmdline ?? ""), ctime: r.ctime ?? 0 });
  }
  const cmdOf = (pid: number) => rowOf.get(pid)?.cmdline ?? "";

  // ⚠ I-3 — KHÔNG so khớp theo TÊN FILE TRẦN. Mọi lối dưới đây đều đòi một dấu vết CỦA RIÊNG HỆ
  // NÀY (đường dẫn đã khai / ảnh thực thi trong thư mục ứng dụng / dòng lệnh trỏ vào thư mục con
  // của ứng dụng / chữ ký lệnh đã khai / điểm vào vai trò), nên `python.exe` của người khác KHÔNG
  // thể lọt vào.
  const runsOurCode = (h: GpuHolder) => {
    const n = norm(h.name);
    if (exact.has(n)) return true;
    if (root.length > 0 && n.startsWith(`${root}\\`)) return true;
    const cmd = cmdOf(h.pid);
    if (!cmd) return false;
    if (root.length > 0 && APP_SUBDIR_MARKERS.some((s) => cmd.includes(`${root}\\${s}`))) return true;
    if (sigs.some((s) => cmd.includes(s))) return true;
    return markers.some((m) => cmd.includes(m));
  };

  /** Dòng lệnh mang một ĐIỂM VÀO vai trò đã khai ⇒ tiến trình này đang PHỤC VỤ. */
  const isRoleProcess = (pid: number) => {
    const cmd = cmdOf(pid);
    return cmd.length > 0 && markers.some((m) => cmd.includes(m));
  };

  /**
   * ★ (A) — CON TRỰC TIẾP của một vai trò, có `CreationDate` LÀM CHỨNG.
   *
   * Một bước duy nhất là ĐỦ vì mọi sidecar đều `spawn()` thẳng từ tiến trình vai trò
   * (`llamaVisionSidecar` · `localSidecarTrainer` · `aiLlmFinetuneSidecar` · `kbSyncScheduler`).
   * ⚠ Hai vế `ctime` là BẮT BUỘC: thiếu chúng, một PID được cấp lại (đúng vòng lặp kill→restart)
   * đủ để một tàn dư nhận nhầm một "cha" chưa từng sinh ra nó. `0` = không đọc được mốc tạo ⇒
   * KHÔNG có bằng chứng ⇒ KHÔNG cấp tư cách anh em (chỉ đổi câu nói, không đổi mức an toàn).
   */
  const isChildOfRole = (h: GpuHolder) => {
    const me = rowOf.get(h.pid);
    if (!me) return false;
    const parent = rowOf.get(me.ppid);
    if (!parent || !isRoleProcess(parent.pid)) return false;
    if (me.ctime <= 0 || parent.ctime <= 0) return false;
    return parent.ctime <= me.ctime;
  };

  const ours: GpuHolder[] = [];
  const peers: GpuHolder[] = [];
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
    if (isRoleProcess(h.pid) || isChildOfRole(h)) peers.push(h);
    else orphans.push(h);
  }
  return { holders, ours, peers, orphans, thirdParty };
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
  "Get-CimInstance Win32_Process|ForEach-Object{ @{ pid=[int]$_.ProcessId; ppid=[int]$_.ParentProcessId;",
  "cmd=[string]$_.CommandLine;",
  // ★ (A) — mốc TẠO, thứ duy nhất phân biệt "cha thật" với "PID được cấp lại". `0` khi không đọc
  // được (thiếu quyền) — người đọc phải hiểu là KHÔNG CÓ BẰNG CHỨNG, không phải "rất cũ".
  "ct=$(if($_.CreationDate){[long]$_.CreationDate.ToFileTimeUtc()}else{0}) } }|",
  "ConvertTo-Json -Compress",
].join(" ");

function warnOnce(msg: string): void {
  if (warnedUnavailable) return;
  warnedUnavailable = true;
  console.warn(msg);
}

let warnedBareDeclarations = false;
/**
 * ★ m-5 (re-review vòng 1) — MỘT KHAI BÁO **VÔ HÌNH** PHẢI KÊU, KHÔNG ĐƯỢC IM.
 *
 * `nvidia-smi` luôn trả **đường dẫn đầy đủ**, nên một biến `*_BIN` khai bằng **tên trần**
 * (`WHISPER_BIN=whisper-cli.exe`, dựa vào `PATH`) sẽ **không bao giờ khớp** — hộ đó vô hình với
 * cổng, và lưới I-2 cũng không thấy vì tên biến VẪN có mặt trong danh sách. Đó đúng là "khai cho
 * có" — tệ hơn không khai, vì nó tạo cảm giác đã phủ.
 *
 * ⚠ KHÔNG "sửa" bằng cách so khớp theo tên file: đó là quay lại đúng I-3 (mọi `python.exe` của
 * người khác thành của ta). Lối đúng là NÓI RA để người vận hành khai đường dẫn tuyệt đối.
 */
function warnAboutBareExecutableDeclarations(ownExecutables: readonly string[]): void {
  if (warnedBareDeclarations) return;
  const bare = ownExecutables.filter((p) => !p.includes("\\") && !p.includes("/"));
  if (bare.length === 0) return;
  warnedBareDeclarations = true;
  console.warn(
    `[vram] ${bare.length} ảnh thực thi được khai bằng TÊN TRẦN (${bare.join(", ")}) — nvidia-smi luôn trả ` +
      "ĐƯỜNG DẪN ĐẦY ĐỦ nên khai kiểu này KHÔNG BAO GIỜ khớp: tàn dư của hộ đó sẽ vô hình với cổng nền. " +
      "Khai bằng đường dẫn TUYỆT ĐỐI trong .env.",
  );
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
 * ⚠ m-3 (re-review vòng 1) — CHI PHÍ THẬT, ĐO LẠI, KHÔNG PHẢI SỐ TÔI ĐOÁN Ở VÒNG TRƯỚC:
 * `nvidia-smi` **56-62 ms** + `powershell.exe` (Win32_Process) **316-341 ms** ⇒ **≈ 380-400 ms**
 * mỗi lượt quét. Và câu "đôi khi mới cần PowerShell" của bản trước SAI: trên máy có desktop **luôn
 * có** hộ ngoài `roots` (đo được 15), nên lượt PowerShell là **LUÔN LUÔN**; lối tắt bên dưới chỉ
 * cứu được máy headless không ai giữ GPU.
 * ⇒ Chi phí này chỉ trả **cho tới khi nền được XÁC MINH** — sau đó `captureVramBaseline()` thoát ở
 * dòng đầu và không lượt quét nào chạy nữa.
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
  warnAboutBareExecutableDeclarations(ownExecutables);
  // Không hộ nào ngoài chính ta ⇒ khỏi bảng tiến trình. ⚠ Trên máy có desktop nhánh này KHÔNG BAO
  // GIỜ chạy (đo được 15 hộ) — xem m-3 ở docstring.
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
