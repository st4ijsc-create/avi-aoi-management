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
 * ⇒ **MỨC AN TOÀN KHÔNG PHỤ THUỘC VÀO VIỆC CHIA `peers` ⇄ `orphans`** — nhưng CHỈ ĐÚNG TRONG PHẠM
 * VI ĐÓ, và N2-2 (re-review vòng 2) bắt đúng chỗ câu này từng viết RỘNG HƠN MÃ. Phạm vi chính xác:
 *
 *   | Ngăn | Tắt cờ `baselineVerified`? | Cái gì bảo đảm |
 *   |---|---|---|
 *   | `peers` / `orphans` | **CÓ (cả hai)** | dòng gán DUY NHẤT ở `vramReconciler.ts` (`orphans === 0 && peers === 0`) ⇒ chia nhầm giữa hai ngăn này chỉ đổi CÂU NÓI |
 *   | `ours` | không | **BẰNG CHỨNG `ctime`**: `pruneUnprovenParentLinks()` đòi cha có mặt trong bảng VÀ `ctime(cha) ≤ ctime(con)` ⇒ PID cấp lại không lọt vào được (tính chất CẤU TRÚC) |
 *   | `thirdParty` | không | **CHỈ có `runsOurCode()` không BẮT SÓT** — không có lưới cấu trúc nào đỡ |
 *
 * ⚠⚠ Ô cuối là biên MỎNG NHẤT của cả cổng, và nó đã HỞ một lần thật (N2-1: `exact` chưa từng được
 * so với token đầu của dòng lệnh ⇒ một hộ `[Insufficient Permissions]` chạy đúng `LLAMA_SERVER_BIN`
 * rơi vào `thirdParty` ⇒ nền nuốt 7,8 GB và được đóng dấu TIN). Ai thêm một đường sinh tiến trình
 * mới: **bắt sót ở `runsOurCode()` KHÔNG kêu**, nó âm thầm trả cờ TIN. Đó là lý do có lưới I-2
 * (biến môi trường) và lưới `package.json` (điểm vào) — và là lý do đừng siết `APP_SUBDIR_MARKERS`
 * hay `runsOurCode()` mà không thêm ca canh (N2-3).
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
/**
 * ★★★ GỐC RỄ THẬT của sự cố hộ ma — đo LIVE 2026-08-19. **KHÔNG phải "powershell lỗi/timeout".**
 *
 * `ConvertTo-Json` của Windows PowerShell 5.1 **KHÔNG thoát ký tự điều khiển thô** nằm trong chuỗi.
 * Chỉ cần MỘT tiến trình trên máy có ký tự điều khiển trong `CommandLine` là cả khối JSON 122 KB
 * thành không hợp lệ ⇒ `JSON.parse` ném (*"Bad control character in string literal … position
 * 83902"*, ký tự thủ phạm **U+001A**, đo trực tiếp) ⇒ `parseProcTable` trả `null` ⇒ `readProcTable`
 * trả `null` ⇒ bộ quét hộ ma **mù 100% số nhịp, IM LẶNG, suốt 2 ngày** (66 dòng cảnh báo trong
 * `app14.log`, 0 lượt quét thành công).
 *
 * ⚠ VÌ SAO CHẨN ĐOÁN TRƯỚC ĐÓ TRƯỢT: hỏng **phụ thuộc DỮ LIỆU đang chạy trên máy**, không phụ
 * thuộc mã. Phép đo "cùng lệnh chạy từ một tiến trình Node khác cho 413–467 ms, 0 lỗi" KHÔNG bác
 * bỏ được gì — nó đo `run()` (quả thật chạy xong và trả 122 KB chữ), chứ **không** đo `JSON.parse`.
 * *Cái được đo không phải cái đang hỏng.* Cùng lớp lỗi với "lưới xanh vì lý do sai".
 *
 * ⚠ ĐÃ THỬ VÀ ĐO LÀ KHÔNG ĂN: lọc phía PowerShell bằng `-replace '[\x00-\x1F]'` — U+001A vẫn lọt
 * (vị trí ném 83902 → 83897). Nên việc lọc nằm Ở ĐÂY, nơi có lưới đơn vị tất định canh.
 *
 * VÌ SAO XOÁ THẲNG LÀ AN TOÀN: ký tự điều khiển thô là **BẤT HỢP LỆ** bên trong chuỗi JSON — một
 * ký tự điều khiển hợp lệ luôn được mã hoá `` (6 ký tự, không đụng tới). Ngoài chuỗi chúng
 * chỉ có thể là khoảng trắng định dạng. Nên xoá chúng khỏi văn bản thô KHÔNG mất dữ liệu hợp lệ
 * nào. `cmdline` chỉ dùng để so khớp đường dẫn (`norm()`).
 */
export function loBoKyTuDieuKhienTho(rawJson: string): string {
  // eslint-disable-next-line no-control-regex
  return rawJson.replace(/[\u0000-\u001F]/g, "");
}

export function parseProcTable(rawJson: string): ProcTableRow[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    // Lượt hai: bỏ ký tự điều khiển thô rồi thử lại. KHÔNG thử-lại-mù — chỉ đúng một lớp hỏng đã
    // đo được, và nếu vẫn ném thì vẫn trả `null` (người gọi ghi lý do).
    try {
      parsed = JSON.parse(loBoKyTuDieuKhienTho(rawJson));
    } catch {
      return null;
    }
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

/**
 * N2-1 — ẢNH THỰC THI của một dòng lệnh Windows, HIỂU DẤU NHÁY.
 * `"C:\Program Files\x\y.exe" -m z` ⇒ `c:\program files\x\y.exe` (KHÔNG phải `"c:\program`).
 * Chuỗi vào đã được `norm()` (thường hoá + `/`→`\`), nên kết quả cũng đã chuẩn hoá.
 */
function firstCommandToken(cmd: string): string | undefined {
  const t = cmd.trim();
  if (t.startsWith('"')) {
    const end = t.indexOf('"', 1);
    return end > 1 ? t.slice(1, end) : undefined;
  }
  const sp = t.indexOf(" ");
  const first = sp < 0 ? t : t.slice(0, sp);
  return first.length > 0 ? first : undefined;
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
    /**
     * ★★★ N2-1 (re-review vòng 2) — ẢNH THỰC THI CÒN ĐẾN TỪ **TOKEN ĐẦU CỦA DÒNG LỆNH**, và bỏ
     * qua nguồn đó là để hở đúng biên nguy hiểm nhất.
     *
     * ⚠ KỊCH BẢN ĐO ĐƯỢC TRÊN CHÍNH MÁY NÀY: `nvidia-smi` trả `[Insufficient Permissions]` ở cột
     * tên cho một hộ (1/15 hộ, có ca parse riêng cho nó) — nhưng `Win32_Process` **vẫn đọc được
     * dòng lệnh**, và dòng lệnh đó bắt đầu bằng ĐÚNG `LLAMA_SERVER_BIN`. Thiếu ba dòng dưới đây
     * thì hộ đó rơi vào `thirdParty`, mà `thirdParty` **KHÔNG tắt cờ `baselineVerified`** ⇒ nền
     * nuốt trọn **7,8 GB** của sidecar thị giác **VÀ được đóng dấu TIN**. Đó đúng là kịch bản mà
     * cả cổng này sinh ra để bắt, hỏng vì bằng chứng mạnh nhất trong tay bị vứt chỉ do nó đến từ
     * nguồn khác.
     *
     * ⚠ `firstCommandToken()` phải hiểu DẤU NHÁY: `"C:\Program Files\…\llama-server.exe" -m …`
     * tách theo khoảng trắng sẽ cho `"c:\program` — một chuỗi vô nghĩa, và lỗ vẫn còn nguyên.
     */
    const exe = firstCommandToken(cmd);
    if (exe && exact.has(exe)) return true;
    if (exe && root.length > 0 && exe.startsWith(`${root}\\`)) return true;
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

/**
 * ★★★ Pha 10 Task 3 — **LÝ DO LƯỢT CHẠY NGOÀI HỎNG, GIỮ LẠI THAY VÌ VỨT ĐI.**
 *
 * ⚠⚠ VÌ SAO Ô NÀY PHẢI TỒN TẠI — ĐÂY LÀ CHỖ HAI NGÀY CHẨN ĐOÁN BỊ ĐỐT: `run()` nuốt `err` thành
 * `null`, nên khi `readProcTable()` hỏng **100% số nhịp trong tiến trình sản xuất** (đo trên
 * `app13.log` ngày 2026-08-19: 20+ nhịp liên tiếp), tất cả những gì còn lại là một dòng
 * *"powershell lỗi/timeout"* — một câu **gộp hai nguyên nhân khác hẳn nhau vào một chữ**, và
 * không có `code`, không có `stderr`, không có mã thoát. Hậu quả đo được: cùng lệnh y nguyên chạy
 * từ một tiến trình Node khác trên cùng máy cho **413–467 ms, 0 lỗi** — tức bằng chứng để phân
 * biệt "lệnh sai" với "môi trường của TIẾN TRÌNH ĐÓ sai" **đã bị vứt đi ngay tại nguồn**.
 *
 * `null` từ `run()` là câu trả lời ĐÚNG cho người gọi (không có bằng chứng ⇒ không kết luận). Ô
 * này KHÔNG đổi điều đó — nó chỉ thôi ném đi **lý do**, thứ mà người trực cần và mã quyết định
 * không được đọc.
 */
export interface LoiChayNgoai {
  readonly cmd: string;
  /** `err.code` (`ENOENT`/`ETIMEDOUT`/`EACCES`…), hoặc `exit:<mã>` khi tiến trình chạy mà trả khác 0. */
  readonly ma: string;
  /** `true` ⇔ Node tự giết vì QUÁ HẠN — phân biệt hẳn với "lệnh không chạy được". */
  readonly quaHan: boolean;
  readonly message: string;
  /** Cắt ngắn: đây là chẩn đoán, không phải nhật ký đầy đủ. */
  readonly stderr: string;
  readonly atMs: number;
}

let loiChayCuoi: LoiChayNgoai | null = null;

/** Lý do lượt chạy ngoài HỎNG gần nhất. `null` ⇔ chưa lượt nào hỏng trong tiến trình này. */
export function lanChayNgoaiHongCuoi(): LoiChayNgoai | null {
  return loiChayCuoi;
}

/** Chỉ dùng trong test. */
export function __resetLoiChayNgoaiForTests(): void {
  loiChayCuoi = null;
}

/** Một dòng người đọc được, cho log. `null` ⇒ chuỗi rỗng (không bịa ra một lý do). */
export function moTaLoiChayNgoai(l: LoiChayNgoai | null): string {
  if (l === null) return "";
  const duoi = l.stderr.length > 0 ? ` · stderr: ${l.stderr}` : "";
  return `${l.cmd} → ${l.ma}${l.quaHan ? " (QUÁ HẠN, Node tự giết)" : ""}: ${l.message}${duoi}`;
}

function ghiLoiChay(cmd: string, err: unknown, stderr: unknown): void {
  const e = err as NodeJS.ErrnoException & { killed?: boolean; code?: unknown };
  // ⚠ `code` của `execFile` mang HAI kiểu: chuỗi (`"ENOENT"`) khi KHÔNG chạy được, và SỐ (mã
  // thoát) khi chạy được mà trả khác 0. Gộp hai thứ đó vào một chuỗi là xoá đúng ranh giới mà
  // người chẩn đoán cần — nên chúng được gắn nhãn khác nhau.
  const raw = e?.code;
  const ma = typeof raw === "number" ? `exit:${raw}` : typeof raw === "string" && raw.length > 0 ? raw : "khong-ro";
  loiChayCuoi = {
    cmd,
    ma,
    quaHan: e?.killed === true,
    message: String(e?.message ?? err).slice(0, 300).replace(/\s+/g, " ").trim(),
    stderr: String(stderr ?? "").slice(0, 300).replace(/\s+/g, " ").trim(),
    atMs: Date.now(),
  };
}

function run(cmd: string, args: string[], timeout: number): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      execFile(cmd, args, { timeout, maxBuffer: 16 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
        if (err) {
          ghiLoiChay(cmd, err, stderr);
          resolve(null);
          return;
        }
        resolve(String(stdout ?? ""));
      });
    } catch (err) {
      ghiLoiChay(cmd, err, ""); // `execFile` ném ĐỒNG BỘ (EACCES…) — telemetry không được làm ngã người gọi
      resolve(null);
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
  // ⚠ ĐỪNG lọc ký tự điều khiển ở ĐÂY — đã thử `-replace '[\x00-\x1F]'` và **ĐO ĐƯỢC LÀ KHÔNG ĂN**
  // (U+001A vẫn lọt, vị trí ném gần như không đổi: 83902 → 83897). Việc lọc nằm ở `parseProcTable`
  // phía Node, nơi có lưới đơn vị tất định canh nó. Xem khối ★★★ ở đó.
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
/**
 * ★★★ Pha 3 Task 5 (A) — **BẰNG CHỨNG THIẾT BỊ, CỬA HẸP NHẤT.** `nvidia-smi
 * --query-compute-apps=pid,process_name` và **không gì khác** (không PowerShell, không phân loại).
 * `null` = **KHÔNG ĐỌC ĐƯỢC** — người gọi PHẢI hiểu là *"không có bằng chứng"*.
 *
 * ⚠⚠ VÌ SAO TÁCH RA, VÀ VÌ SAO NGƯỜI THU HỒI DÙNG ĐÚNG CỬA NÀY CHỨ KHÔNG PHẢI BẢNG TIẾN TRÌNH:
 * Task 1 đo được **ba mốc khác nhau** trên cùng một cái chết của một tiến trình CUDA — mã thoát
 * ~16 ms · `nvidia-smi` về nền **≤33 ms** · handle của Node báo `"exit"` ~560 ms. Câu hỏi mà
 * `preempt()` phải trả lời là *"**BYTE** đã nhả chưa"*, KHÔNG phải *"tiến trình đã chết chưa"* —
 * hai câu hỏi lệch nhau **543 ms** trên chính hộ 7,8 GB. Danh sách compute-app là câu trả lời
 * TRỰC TIẾP cho câu hỏi thứ nhất: PID vắng mặt ở đây ⇔ thiết bị không còn ghi nhận nó chiếm bộ
 * nhớ. Dùng `readProcTable()` (Win32_Process) ở đó là trả lời câu hỏi THỨ HAI — và còn đắt gấp
 * ~7 lần (316-1.500 ms so với 56-62 ms).
 *
 * ⚠ CÙNG CÔNG TẮC `VRAM_GPU_HOLDER_SCAN` — tắt quét là tắt luôn khả năng chứng minh, và
 * `thuHoiHoNhanNuoi()` sẽ khai **thất bại trung thực** thay vì đoán.
 * ⚠ KHÔNG rào theo nền tảng (khác `readGpuHolders`): `nvidia-smi` có trên mọi nền tảng có driver
 * NVIDIA; chỉ `Win32_Process` mới là thứ chỉ Windows có.
 *
 * KHÔNG BAO GIỜ ném.
 */
export async function readComputeApps(): Promise<GpuHolder[] | null> {
  if (scanDisabled()) return null;
  const csv = await run(
    "nvidia-smi",
    ["--query-compute-apps=pid,process_name", "--format=csv,noheader"],
    SMI_TIMEOUT_MS,
  );
  return csv === null ? null : parseComputeApps(csv);
}

export async function readGpuHolders(roots: readonly number[]): Promise<GpuHolderCensus | null> {
  if (scanDisabled()) return null;
  if (process.platform !== "win32") {
    warnOnce(
      `[vram] không liệt kê được tiến trình giữ GPU trên nền tảng "${process.platform}" ` +
        "(đường quét hiện chỉ có bản Windows: nvidia-smi + Win32_Process) — nền sẽ được ghi là CHƯA XÁC MINH.",
    );
    return null;
  }
  const holders = await readComputeApps();
  if (holders === null) {
    warnOnce(
      "[vram] KHÔNG liệt kê được tiến trình đang giữ GPU (nvidia-smi vắng/lỗi) — nền sẽ được ghi " +
        "là CHƯA XÁC MINH. Đây là mất phép ĐO, không phải bằng chứng sạch.",
    );
    return null;
  }

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

  const procs = await readProcTable();
  if (procs === null || procs.length === 0) {
    // ⚠ CỐ Ý trả `null` (chưa xác minh) thay vì đoán: không có bảng tiến trình thì ta không phân
    // biệt được "anh em ĐANG SỐNG" với "tàn dư lượt trước" (C-1) — và nêu tên nhầm sẽ đẩy người
    // trực đi tắt một tiến trình đang phục vụ sản xuất.
    console.warn(
      `[vram] KHÔNG đọc được bảng tiến trình (${procs === null ? "powershell lỗi/timeout" : "bảng RỖNG — bất thường"}) ` +
        "⇒ không phân loại được hộ đang giữ GPU. Ghi nhận CHƯA XÁC MINH, không kết luận." +
        // ★ Pha 10 Task 3 — LÝ DO THẬT, không còn bị nuốt ở `run()`. Không có nó thì dòng này chỉ
        // nói "hỏng" mà không nói hỏng VÌ SAO, và một sự cố 2 ngày không để lại manh mối nào.
        (procs === null && lanChayNgoaiHongCuoi() !== null
          ? ` LÝ DO: ${moTaLoiChayNgoai(lanChayNgoaiHongCuoi())}`
          : ""),
    );
    return null;
  }
  return classifyHolders({ holders, procs, roots, ownExecutables, appRoot, commandSignatures });
}

/**
 * ★★★ Pha 3 Task 4 — BẢNG TIẾN TRÌNH, TÁCH RA THÀNH MỘT CỬA RIÊNG. `null` = **KHÔNG ĐỌC ĐƯỢC**
 * (nền tảng khác Windows · `powershell.exe` lỗi/quá hạn · JSON không parse được), và người gọi
 * PHẢI hiểu đó là *"không có bằng chứng"*, TUYỆT ĐỐI không phải *"không có tiến trình nào"*.
 *
 * ⚠ VÌ SAO TÁCH: `vramAdoption` cần **`CreationDate` của MỌI tiến trình** để trả lời *"tiến trình
 * đứng tên hàng này còn sống không"* — một câu hỏi hoàn toàn độc lập với *"ai đang giữ GPU"*.
 * Trước Task 4, bảng này chỉ tồn tại bên trong `readGpuHolders()` và **chỉ được đọc khi có hộ
 * ngoài `roots` đang giữ GPU** (lối tắt ở trên) — tức đúng những lượt cần dọn hàng MA nhất (hộ đã
 * chết, không còn giữ GPU) lại là những lượt không có bảng. Một cửa riêng, MỘT bản cài đặt, hai
 * người gọi.
 *
 * ⚠ CHI PHÍ ĐO ĐƯỢC: `powershell.exe` (Win32_Process) **316-341 ms** mỗi lượt. Người gọi phải tự
 * quyết định có đáng gọi không — module này KHÔNG đặt bộ đệm: một bộ đệm ở đây sẽ trả lời
 * *"tiến trình X còn sống"* bằng dữ liệu cũ, và đó đúng là câu hỏi mà một câu trả lời cũ làm hỏng
 * (xoá nhầm hàng của một tiến trình vừa khởi động ⇒ anh em tính THIẾU byte ⇒ NỚI dư địa).
 *
 * KHÔNG BAO GIỜ ném.
 */
export async function readProcTable(): Promise<ProcTableRow[] | null> {
  /**
   * ⚠⚠ CÙNG CÔNG TẮC với `readGpuHolders()`, và đây là một ĐIỀU KIỆN chứ không phải sự nhất quán
   * cho đẹp: `vitest.setup.ts` đặt `VRAM_GPU_HOLDER_SCAN=off` cho CẢ bộ test, và không có dòng này
   * thì **mọi** file test chạm `__runReconcileTick()` sẽ nổ một `powershell.exe` **316-341 ms**
   * ngay giữa nhịp đối chiếu. Đo được ngay lần chạy đầu: 5/653 rồi 1/653 ĐỎ dưới
   * `--sequence.shuffle.tests` ở `vramHeadroom.test.ts` (`vi.waitFor(readLastReconcileTick())`) —
   * đúng lớp liên đới "thời lượng nhịp buộc vào một vòng I/O" mà Task 2 đã tốn ba bước để cắt.
   * ⚠ HỆ QUẢ PHẢI KHAI: tắt công tắc là tắt LUÔN việc dọn hàng MA và nhận nuôi — cùng đánh đổi
   * với việc tắt cổng nền, và cùng một biến để người vận hành chỉ phải nhớ một thứ.
   */
  if (scanDisabled()) return null;
  if (process.platform !== "win32") return null;
  const json = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", PS_PROC_TABLE], PS_TIMEOUT_MS);
  if (json === null) return null; // `run()` ĐÃ ghi lý do vào `loiChayCuoi`.

  /**
   * ★★★ ĐƯỜNG CÂM CUỐI CÙNG — đo được LIVE 2026-08-19 sau khi Task 3 nối lý do vào dòng cảnh báo.
   *
   * Task 3 vá `run()` thôi nuốt `err`, và dòng cảnh báo ở `readGpuHolders()` in `LÝ DO:` khi
   * `lanChayNgoaiHongCuoi() !== null`. Nhưng nhật ký sản xuất **vẫn không có `LÝ DO:` nào** —
   * nghĩa là `loiChayCuoi` RỖNG, tức `run()` **KHÔNG hề hỏng**: powershell chạy xong, trả chữ, và
   * thứ hỏng là `JSON.parse` bên trong `parseProcTable` — đường thoát DUY NHẤT còn lại trả `null`
   * mà không ghi một byte chẩn đoán nào. Đúng lớp lỗi vừa vá, chỉ dịch sang hàm bên cạnh.
   *
   * ⚠ Vì sao điều này giải thích được nghịch lý của Task 3 ("cùng lệnh chạy từ Node khác cho
   * 413–467 ms, 0 lỗi"): lượt chạy ngoài đó đo `run()`, KHÔNG đo `parseProcTable`. Hai phép đo
   * khác nhau, và cái được đo không phải cái đang hỏng.
   *
   * Ghi vào CHÍNH `loiChayCuoi` (không đẻ ô thứ hai): dòng cảnh báo + `moTaLoiChayNgoai()` đã nối
   * sẵn, nên chẩn đoán ra được ngay mà không thêm một mắt xích nào có thể quên nối lần nữa.
   */
  const rows = parseProcTable(json);
  if (rows === null) {
    loiChayCuoi = {
      cmd: "powershell.exe (Win32_Process)",
      ma: "json-khong-phan-tich-duoc",
      quaHan: false,
      message: `powershell CHẠY XONG (${json.length} ký tự) nhưng JSON.parse ném ⇒ bảng tiến trình không dùng được`,
      // Đầu chuỗi là chỗ lộ nguyên nhân thật (BOM, banner, cảnh báo PS in trước JSON, UTF-16…).
      stderr: `đầu ra: ${JSON.stringify(json.slice(0, 160))}`,
      atMs: Date.now(),
    };
  }
  return rows;
}
