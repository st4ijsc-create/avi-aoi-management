# Pha 2A — Đo đúng khi có đồng thời, và liệt kê đủ đường cấp phát

> **Cho người thực thi bằng agent:** BẮT BUỘC DÙNG SUB-SKILL `superpowers:subagent-driven-development`. Các bước dùng cú pháp checkbox (`- [ ]`).

**Mục tiêu:** Làm cho `actualBytes` **đo được kể cả khi hai lượt nạp chồng nhau**, và lập **bản liệt kê đầy đủ** mọi đường cấp phát VRAM — hai điều kiện mà spec §10 và §5.6 đặt làm cổng vào cưỡng chế.

**Kiến trúc:** Thêm một đầu dò **theo tiến trình** (bộ đếm hiệu năng Windows, đã kiểm khả thi — báo cáo `docs/superpowers/reports/2026-08-03-t511-per-process-feasibility.md`) đứng cạnh đầu dò toàn thiết bị sẵn có, **không thay thế nó**. Đầu dò mới chỉ dùng để tính **chênh lệch** của một cây tiến trình; đầu dò cũ vẫn lo đối chiếu và báo động. Thêm một **khoá nạp duy nhất toàn tiến trình** để cửa sổ đo không lồng nhau bên trong một PID — thứ bộ đếm không tách được.

**Pha 2A KHÔNG đổi hành vi cấp phát.** Không có lượt xin nào bị từ chối thêm. Cưỡng chế nằm ở Pha 2B, viết sau, **dựa trên bản liệt kê mà Task 5 sinh ra**.

**Tech Stack:** TypeScript · Node 24 · Vitest · PowerShell (PDH counters) · node-llama-cpp · Drizzle/Postgres

## Global Constraints

Sao nguyên văn từ spec `docs/superpowers/specs/2026-08-02-vram-broker-design.md`. Mọi task đều bị ràng buộc bởi mục này.

1. **KHÔNG viết lại `server/services/aiGgufEngine.ts` (2.712 dòng).** Chỉ rút phần sở hữu bộ nhớ ra. Ba hàm `withGgufSlot` · `withGgufSlotGenerator` · `ensureTextContext` giữ nguyên ngữ nghĩa.
2. **Đ4 — TUYỆT ĐỐI KHÔNG TRỘN HAI THƯỚC.** Số **tuyệt đối** của bộ đếm luôn cao hơn `nvidia-smi` **+505…+511 MiB**. Bộ đếm chỉ được dùng cho **chênh lệch trong một cửa sổ**. Không có đường nào mà một con số từ bộ đếm được so sánh, cộng, hay trừ với một con số từ `nvidia-smi` hoặc `getVramState`.
3. **Ngưỡng lệch `512 MiB`, nhịp đối chiếu `60_000 ms`** — hai hằng số này đã chốt bằng đo, **không đổi trong pha này**.
4. **Đơn vị nội bộ luôn là BYTE.** MiB chỉ xuất hiện ở câu log và câu cảnh báo. Bộ đếm PDH trả **byte** — không nhân chia gì thêm.
5. **Mọi lưới an toàn phải được chứng minh bằng đột biến**: cố ý làm hỏng mã, chạy test, thấy **đúng** test đỏ, khôi phục. Không có bước này thì lưới coi như chưa có.
6. **Vị từ dùng chung**: task nào đổi **dân số** đầu vào của một vị từ dùng chung phải **liệt kê tất cả nơi tiêu thụ** vị từ đó và kiểm lại **từng nơi**. Áp riêng cho `holdsUncommittedBytes()` và `isLoadingLease()`.
7. **Fixture phải đủ lớn để phân biệt.** Ca kiểm thử về nhầm lẫn kích thước phải dùng số cỡ **17.000 MiB**, không dùng số cỡ 600 MiB.
8. **Đầu dò hỏng không được làm chết máy.** Máy không GPU / không PowerShell / bộ đếm vắng ⇒ trả `null`, ghi log một lần, hệ **vẫn chạy**.

---

## Cấu trúc file

| File | Trách nhiệm |
|---|---|
| `server/services/vram/vramProcessProbe.ts` | **MỚI.** Đọc bộ đếm PDH, dựng cây tiến trình, cộng byte theo cây. Thuần I/O + parse. |
| `server/services/vram/vramProcessProbe.test.ts` | **MỚI.** Test parse trên dữ liệu mẫu cố định, không cần GPU. |
| `server/services/vram/vramMeasureLock.ts` | **MỚI.** Khoá nạp duy nhất toàn tiến trình bao quanh cửa sổ đo, có trần chờ. |
| `server/services/vram/vramMeasureLock.test.ts` | **MỚI.** |
| `server/services/vram/vramWiring.ts` | **SỬA.** Đường đo `beginVram`/`commitMeasured` chuyển sang đầu dò theo tiến trình; bọc khoá. |
| `server/services/vram/types.ts` | **SỬA.** Thêm `VramMeasureSource`, mở rộng `VramEstimateSource`. |
| `server/services/vram/vramBroker.ts` | **SỬA.** `commit()` nhận nguồn đo; đường trả phép dự phòng cho T5-15. |
| `docs/superpowers/reports/2026-08-03-vram-pha2a-report.md` | **MỚI.** Bằng chứng đo, bản liệt kê. |

---

### Task 1: Đầu dò VRAM theo tiến trình

**Files:**
- Create: `server/services/vram/vramProcessProbe.ts`
- Test: `server/services/vram/vramProcessProbe.test.ts`

**Interfaces:**
- Consumes: không có (file độc lập, chỉ import `node:child_process`).
- Produces:
```ts
export interface VramProcessSample {
  readonly totalBytes: number;
  readonly byPid: ReadonlyMap<number, number>;
  readonly byLuid: ReadonlyMap<string, number>;
  readonly sampledAtMs: number;
}
export interface RawProcRow { readonly pid: number; readonly ppid: number }
export function collectDescendants(procs: readonly RawProcRow[], roots: readonly number[]): Set<number>;
export function parseProcessCounters(rawJson: string, roots: readonly number[], nowMs: number): VramProcessSample | null;
export function readProcessVram(roots: readonly number[]): Promise<VramProcessSample | null>;
```

**Bối cảnh đã đo — đừng đo lại:**
- Tên instance có dạng `pid_2056_luid_0x00000000_0x00016d43_phys_0`.
- WDDM ⇒ `nvidia-smi --query-compute-apps=…,used_memory` trả `[N/A]`. **Không dùng đường đó.**
- Bộ đếm thấy cả ba đường cấp phát của llama.cpp; backend đọc **431,6 MiB** giống hệt ở 5/5 tiến trình.
- Đ2: `spawn("npm", …, { shell: true })` ⇒ PID cấp phát là **cháu**, phải cộng theo cây.
- Đ3: máy có **4 LUID**. Quyết định của pha này: **cộng tất cả LUID cho các PID đích**, đồng thời **ghi lại chi tiết theo LUID** trong `byLuid` để chẩn đoán về sau. Tiến trình node chạy CUDA không cấp phát trên iGPU, nên phép cộng thô đúng; `byLuid` là bằng chứng để phát hiện nếu điều đó đổi.

- [ ] **Bước 1: Viết test parse thất bại trước**

```ts
import { describe, expect, it } from "vitest";
import { collectDescendants, parseProcessCounters } from "./vramProcessProbe";

const RAW = JSON.stringify({
  counters: [
    { i: "pid_100_luid_0x00000000_0x00016d43_phys_0", v: 17_512_000_000 },
    { i: "pid_200_luid_0x00000000_0x00016d43_phys_0", v: 1_193_000_000 },
    { i: "pid_300_luid_0x00000000_0x00016d43_phys_0", v: 900_000_000 },
    { i: "pid_100_luid_0x00000000_0x0000abcd_phys_0", v: 4_000_000 },
    { i: "khong-dung-dinh-dang", v: 999 },
  ],
  procs: [
    { pid: 100, ppid: 1 },
    { pid: 200, ppid: 100 },
    { pid: 300, ppid: 1 },
  ],
});

describe("collectDescendants", () => {
  it("gom con va chau, khong gom tien trinh khong lien quan", () => {
    const set = collectDescendants([{ pid: 100, ppid: 1 }, { pid: 200, ppid: 100 }, { pid: 250, ppid: 200 }, { pid: 300, ppid: 1 }], [100]);
    expect([...set].sort((a, b) => a - b)).toEqual([100, 200, 250]);
  });

  it("khong treo khi cay tien trinh co vong", () => {
    const set = collectDescendants([{ pid: 10, ppid: 11 }, { pid: 11, ppid: 10 }], [10]);
    expect([...set].sort((a, b) => a - b)).toEqual([10, 11]);
  });
});

describe("parseProcessCounters", () => {
  it("cong theo CAY tien trinh, khong chi rieng pid goc", () => {
    const s = parseProcessCounters(RAW, [100], 1_000)!;
    // 100 tren hai LUID + 200 la con cua 100; 300 KHONG thuoc cay
    expect(s.totalBytes).toBe(17_512_000_000 + 4_000_000 + 1_193_000_000);
    expect(s.byPid.get(300)).toBeUndefined();
  });

  it("giu chi tiet theo LUID de chan doan", () => {
    const s = parseProcessCounters(RAW, [100], 1_000)!;
    expect(s.byLuid.get("0x00000000_0x00016d43")).toBe(17_512_000_000 + 1_193_000_000);
    expect(s.byLuid.get("0x00000000_0x0000abcd")).toBe(4_000_000);
  });

  it("bo qua dong sai dinh dang thay vi nem", () => {
    expect(parseProcessCounters(RAW, [100], 1_000)).not.toBeNull();
  });

  it("tra null khi JSON hong", () => {
    expect(parseProcessCounters("{khong phai json", [100], 1_000)).toBeNull();
  });

  it("tra mau 0 byte khi cay tien trinh khong dung GPU", () => {
    const s = parseProcessCounters(RAW, [999], 1_000)!;
    expect(s.totalBytes).toBe(0);
  });
});
```

- [ ] **Bước 2: Chạy để thấy đỏ**

Chạy: `npx vitest run server/services/vram/vramProcessProbe.test.ts`
Kỳ vọng: FAIL — không tìm thấy module.

- [ ] **Bước 3: Viết hàm thuần**

```ts
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
```

- [ ] **Bước 4: Chạy để thấy xanh**

Chạy: `npx vitest run server/services/vram/vramProcessProbe.test.ts`
Kỳ vọng: PASS, 7 ca.

- [ ] **Bước 5: Thêm lớp I/O**

Một lần `execFile` duy nhất lấy **cả hai** tập dữ liệu — vì mỗi lần spawn `powershell.exe` tốn ~760 ms, gọi hai lần là lãng phí gấp đôi.

```ts
const PS_SCRIPT = [
  "$ErrorActionPreference='Stop';",
  "$c=(Get-Counter '\\GPU Process Memory(*)\\Dedicated Usage').CounterSamples|",
  "ForEach-Object{ @{ i=$_.InstanceName; v=[double]$_.CookedValue } };",
  "$p=Get-CimInstance Win32_Process|ForEach-Object{ @{ pid=[int]$_.ProcessId; ppid=[int]$_.ParentProcessId } };",
  "@{counters=$c;procs=$p}|ConvertTo-Json -Depth 4 -Compress",
].join(" ");

const PROBE_TIMEOUT_MS = 10_000;
let warnedUnavailable = false;

export function readProcessVram(roots: readonly number[]): Promise<VramProcessSample | null> {
  if (roots.length === 0) return Promise.resolve(null);
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
```

- [ ] **Bước 6: Nghiệm thu SỐNG — bắt buộc, không được bỏ**

Viết script tạm trong scratchpad: sinh một tiến trình node nạp `GGUF_EMBEDDING_MODEL`, gọi `readProcessVram([childPid])` trước và sau, in `D` và `D/F` với `F` = kích thước file model.

⚠ **Cạm bẫy đã trả giá: KHÔNG nối ống stdio vào tiến trình con** — nó làm con đứng im đúng dòng trước `getLlama()` (2/2 lượt, 306 s) và **giả dạng đúng hiện tượng đang nghiên cứu**. Cho con ghi log ra **file**.
⚠ Dọn tiến trình bằng `nvidia-smi --query-compute-apps=pid --format=csv` rồi `Stop-Process` **đúng PID**. **Không quét mù theo tên** — có 8 `node.exe` chạy, quét mù giết luôn runner.

Điều kiện đạt: `D/F` nằm trong khoảng **0,95–1,05**. Ghi số thật vào báo cáo. Nếu trượt, **BLOCKED**, không tự nới điều kiện.

- [ ] **Bước 7: Commit**

```bash
git add server/services/vram/vramProcessProbe.ts server/services/vram/vramProcessProbe.test.ts
git commit -m "feat(vram/pha2a): dau do VRAM theo tien trinh — go cong T5-11"
```

---

### Task 2: Khoá nạp duy nhất toàn tiến trình (điều kiện Đ1)

**Files:**
- Create: `server/services/vram/vramMeasureLock.ts`
- Test: `server/services/vram/vramMeasureLock.test.ts`

**Interfaces:**
- Consumes: không.
- Produces:
```ts
export interface MeasureWindowResult<T> { readonly value: T; readonly measurable: boolean }
export function withMeasureWindow<T>(fn: () => Promise<T>, waitBudgetMs?: number): Promise<MeasureWindowResult<T>>;
export function measureWindowDepth(): number;
export function __resetMeasureLockForTests(): void;
```

**Vì sao cần:** bộ đếm trả **một** số cho mỗi PID. `inFlightLoads` khoá **theo `modelId`** (`aiGgufEngine.ts` quanh dòng 199 và 791) nên hai model **khác nhau** vẫn nạp song song **trong cùng một tiến trình**, và bộ đếm không tách được. Khoá này nối tiếp hoá **cửa sổ đo**, không phải toàn bộ việc nạp.

**Đây KHÔNG phải khoá thứ tư cùng loại với ba khoá in-flight.** Ba khoá kia chống **làm trùng việc cho cùng một model**; khoá này nối tiếp **hai model khác nhau**. Chúng bổ sung nhau: in-flight khử trùng lặp trước, khoá này xếp hàng phần còn lại. Ghi rõ điều này trong docstring.

**Liveness — bắt buộc:** chờ vô hạn là chặn người dùng. Hết ngân sách chờ thì **chạy tiếp KHÔNG đo** (`measurable: false`), không ném lỗi và không huỷ lượt nạp. Đây đúng khuôn "hoãn có đáy và có tiếng" của spec §5.4.

`DEFAULT_WAIT_BUDGET_MS = 180_000` — trên lượt nạp dài nhất quan sát được (120 s) một biên **1,5×**.

- [ ] **Bước 1: Viết test thất bại trước**

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { __resetMeasureLockForTests, measureWindowDepth, withMeasureWindow } from "./vramMeasureLock";

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

describe("withMeasureWindow", () => {
  beforeEach(() => { __resetMeasureLockForTests(); });

  it("hai luot KHONG bao gio chong nhau", async () => {
    const nhatKy: string[] = [];
    let moKhoaA!: () => void;
    const a = withMeasureWindow(async () => {
      nhatKy.push("A vao");
      await new Promise<void>((r) => { moKhoaA = r; });
      nhatKy.push("A ra");
      return "a";
    });
    await tick();
    const b = withMeasureWindow(async () => { nhatKy.push("B vao"); return "b"; });
    await tick();
    expect(nhatKy).toEqual(["A vao"]); // B con xep hang
    moKhoaA();
    await Promise.all([a, b]);
    expect(nhatKy).toEqual(["A vao", "A ra", "B vao"]);
  });

  it("bao dat do duoc khi khong tranh chap", async () => {
    const r = await withMeasureWindow(async () => 7);
    expect(r).toEqual({ value: 7, measurable: true });
  });

  it("het ngan sach cho thi VAN CHAY, chi mat phep do", async () => {
    let moKhoaA!: () => void;
    const a = withMeasureWindow(async () => { await new Promise<void>((r) => { moKhoaA = r; }); return "a"; });
    await tick();
    const b = await withMeasureWindow(async () => "b", 0);
    expect(b).toEqual({ value: "b", measurable: false });
    moKhoaA();
    await a;
  });

  it("ham nem VAN nha khoa — khong khoa chet", async () => {
    await expect(withMeasureWindow(async () => { throw new Error("vo"); })).rejects.toThrow("vo");
    expect(measureWindowDepth()).toBe(0);
    const r = await withMeasureWindow(async () => "sau do");
    expect(r.measurable).toBe(true);
  });

  it("luot chay khong do KHONG giu khoa cua nguoi khac", async () => {
    let moKhoaA!: () => void;
    const a = withMeasureWindow(async () => { await new Promise<void>((r) => { moKhoaA = r; }); return "a"; });
    await tick();
    await withMeasureWindow(async () => "b", 0);   // bo qua khoa
    await tick();
    expect(measureWindowDepth()).toBe(1);          // van chi co A giu
    moKhoaA();
    await a;
  });
});
```

- [ ] **Bước 2: Chạy để thấy đỏ**

Chạy: `npx vitest run server/services/vram/vramMeasureLock.test.ts`
Kỳ vọng: FAIL — không tìm thấy module.

- [ ] **Bước 3: Cài đặt**

```ts
const DEFAULT_WAIT_BUDGET_MS = 180_000;

let dangGiu = false;
const hangCho: Array<() => void> = [];

export interface MeasureWindowResult<T> { readonly value: T; readonly measurable: boolean }

export function measureWindowDepth(): number { return dangGiu ? 1 : 0; }

export function __resetMeasureLockForTests(): void {
  dangGiu = false;
  hangCho.length = 0;
}

function nhaKhoa(): void {
  const tiepTheo = hangCho.shift();
  if (tiepTheo) { tiepTheo(); return; }
  dangGiu = false;
}

function giuKhoa(waitBudgetMs: number): Promise<boolean> {
  if (!dangGiu) { dangGiu = true; return Promise.resolve(true); }
  return new Promise<boolean>((resolve) => {
    let xong = false;
    const hen = setTimeout(() => {
      if (xong) return;
      xong = true;
      const i = hangCho.indexOf(danhDau);
      if (i >= 0) hangCho.splice(i, 1);
      resolve(false);           // het ngan sach: chay tiep, KHONG do
    }, waitBudgetMs);
    const danhDau = () => {
      if (xong) { nhaKhoa(); return; }  // da bo cuoc — chuyen luot ngay
      xong = true;
      clearTimeout(hen);
      resolve(true);
    };
    hangCho.push(danhDau);
  });
}

/**
 * Noi tiep hoa CUA SO DO trong mot tien trinh.
 *
 * KHONG cung loai voi ba khoa in-flight (`inFlightLoads`,
 * `embeddingContextInFlight`, `textContextInFlight`): ba khoa do chong LAM TRUNG
 * VIEC cho CUNG mot model. Khoa nay noi tiep HAI MODEL KHAC NHAU, vi bo dem
 * `\GPU Process Memory` tra MOT so cho moi PID va khong tach duoc hai khoi
 * trong cung tien trinh (dieu kien D1, spec §10).
 *
 * Het ngan sach cho => VAN CHAY, chi mat phep do (`measurable: false`).
 * Chan nguoi dung de giu phep do la danh doi sai.
 */
export async function withMeasureWindow<T>(
  fn: () => Promise<T>,
  waitBudgetMs: number = DEFAULT_WAIT_BUDGET_MS,
): Promise<MeasureWindowResult<T>> {
  const doDuoc = await giuKhoa(waitBudgetMs);
  if (!doDuoc) return { value: await fn(), measurable: false };
  try {
    return { value: await fn(), measurable: true };
  } finally {
    nhaKhoa();
  }
}
```

- [ ] **Bước 4: Chạy để thấy xanh**

Chạy: `npx vitest run server/services/vram/vramMeasureLock.test.ts`
Kỳ vọng: PASS, 5 ca.

- [ ] **Bước 5: Chứng minh lưới bằng đột biến — bắt buộc**

Ba đột biến, mỗi cái chạy test rồi khôi phục. Ghi vào báo cáo **tên ca đỏ** của từng cái.

| # | Đột biến | Ca phải đỏ |
|---|---|---|
| M1 | Bỏ `finally`, gọi `nhaKhoa()` ngay sau `await fn()` | "ham nem VAN nha khoa" |
| M2 | Trong `giuKhoa`, đổi `if (!dangGiu)` thành `if (true)` | "hai luot KHONG bao gio chong nhau" |
| M3 | Ở nhánh hết giờ, trả `true` thay vì `false` | "het ngan sach cho thi VAN CHAY" |

Nếu một đột biến **không** làm test nào đỏ, lưới đó chưa tồn tại — viết thêm ca trước khi đi tiếp.

- [ ] **Bước 6: Commit**

```bash
git add server/services/vram/vramMeasureLock.ts server/services/vram/vramMeasureLock.test.ts
git commit -m "feat(vram/pha2a): khoa nap duy nhat toan tien trinh — dieu kien D1"
```

---

### Task 3: Nối đầu dò theo tiến trình vào đường đo

**Files:**
- Modify: `server/services/vram/vramWiring.ts`
- Modify: `server/services/vram/types.ts`
- Modify: `server/services/vram/vramBroker.ts`
- Test: `server/services/vram/wiring.processProbe.test.ts` (tạo mới)

**Interfaces:**
- Consumes: `readProcessVram`, `VramProcessSample` (Task 1); `withMeasureWindow`, `MeasureWindowResult` (Task 2).
- Produces: `VramMeasureSource = "device-delta" | "process-delta" | "none"` trong `types.ts`; `commit()` của broker nhận thêm `measureSource`.

**Trạng thái hiện tại cần đọc trước khi sửa:** `vramWiring.ts` đang đo bằng `after − before` trên `used` **toàn thiết bị**, có một `Map` cửa sổ chồng lấn; khi hai cửa sổ giao nhau thì gọi `markMeasureFailed()` và **return trước** `broker.commit()` và `estimator.recordActual()`. Đọc kỹ **cả năm** nhánh thoát đang đóng cửa sổ — mọi nhánh đều phải giữ nguyên tính chất đó.

**Việc phải làm:**
1. Cửa sổ đo bọc trong `withMeasureWindow`. `measurable === false` ⇒ giữ nguyên hành vi cũ: `markMeasureFailed()`, **không** `commit`, **không** `recordActual`.
2. Với hộ **trong tiến trình**, hai đầu đo dùng `readProcessVram([process.pid])`.
3. Với hộ **ngoài tiến trình**, dùng `readProcessVram([<pid gốc>])` — Task 1 đã cộng theo cây (Đ2).
4. Ghi `measureSource` vào sự kiện, để về sau phân biệt được số nào đến từ thước nào.
5. ⚠ **Đ4**: không có đường nào so số của bộ đếm với số của `nvidia-smi`. Reconciler và baseline **giữ nguyên** đầu dò toàn thiết bị. Chỉ `actualBytes` đổi nguồn.

- [ ] **Bước 1: Viết test thất bại trước**

```ts
import { describe, expect, it, vi } from "vitest";

// Ca ★★ QUAN TRONG NHAT: hai luot nap chong nhau trong HAI tien trinh
// => hai con so RIENG, moi con dung model tuong ung.
// Fixture dung so co 17.000 MiB (rang buoc toan cuc 7).
it("hai luot chong nhau cho hai so RIENG BIET", async () => {
  const MODEL_LON = 17_512_000_000;
  const MODEL_NHO = 2_542_000_000;
  // dau do theo tien trinh tra so theo PID; dau do toan thiet bi chi co MOT tong
  // => truoc Task 3, ca nay bat buoc do vi ca hai luot deu measureFailed.
  // Sau Task 3: ca hai commit dung so cua minh.
  // (Implementer viet ban gia cho readProcessVram theo khuon cac test wiring san co.)
  expect(MODEL_LON).toBeGreaterThan(MODEL_NHO * 5);
});
```

⚠ Ca trên là **khung**, không phải bản cuối. Implementer phải viết đầy đủ theo khuôn bản giả đã dùng trong `wiring.doubleCount.test.ts` và `wiring.backend.test.ts` — đọc hai file đó trước. **Bản giả `getLlama()` phải cache theo tham số như thật**; thiếu điều đó thì ca song song đo một thế giới không tồn tại và **giấu mất lease ma cần bắt**.

Ngoài ca ★★, phải có:
- đầu dò theo tiến trình trả `null` ⇒ `markMeasureFailed()`, **không** commit, **không** recordActual;
- `measurable === false` (hết ngân sách chờ) ⇒ y hệt trên;
- `measureSource` xuất hiện đúng trong sự kiện đã ghi;
- **không** đường nào cộng/trừ số bộ đếm với số `nvidia-smi` (kiểm bằng đọc mã, ghi kết luận vào báo cáo).

- [ ] **Bước 2: Chạy để thấy đỏ** — `npx vitest run server/services/vram/wiring.processProbe.test.ts`

- [ ] **Bước 3: Sửa `types.ts`**

```ts
export type VramMeasureSource = "device-delta" | "process-delta" | "none";
```

- [ ] **Bước 4: Sửa `vramWiring.ts` và `vramBroker.ts`** theo 5 điểm trên.

- [ ] **Bước 5: Chạy TOÀN BỘ test vram** — `npx vitest run server/services/vram/`
Kỳ vọng: tất cả xanh. Đây là điểm dễ vỡ nhất của pha: đường đo cũ có **năm** nhánh thoát.

- [ ] **Bước 6: Chạy lại có xáo thứ tự** — `npx vitest run server/services/vram/ --sequence.shuffle.tests`
Kỳ vọng: vẫn xanh. Test rò trạng thái toàn cục sẽ lộ ở đây.

- [ ] **Bước 7: Nghiệm thu SỐNG — hai lượt nạp CỐ Ý chồng nhau**

Nạp model lớn ở một tiến trình, model nhỏ ở tiến trình khác, cửa sổ lồng nhau. Kỳ vọng: **hai** bản ghi `actualBytes` riêng, mỗi bản sai lệch **< 5%** so với kích thước file model tương ứng. Ghi số thật vào báo cáo.

Đây **chính là bằng chứng gỡ cổng T5-11**. Không có nó thì cổng chưa gỡ, dù test đơn vị có xanh.

- [ ] **Bước 8: Commit**

```bash
git add server/services/vram/
git commit -m "feat(vram/pha2a): actualBytes do bang dau do theo tien trinh — luot chong nhau khong con measureFailed"
```

---

### Task 4: T5-15 — giấy phép backend không được kẹt vĩnh viễn

**Files:**
- Modify: `server/services/vram/vramBroker.ts`
- Modify: `server/services/vram/vramWiring.ts`
- Test: `server/services/vram/wiring.backendStuck.test.ts` (tạo mới)

**Triệu chứng cần vá:** giấy phép `gguf-backend` **không có đường trả ở nhánh thành công** — đúng như thiết kế, vì backend CUDA sống suốt đời tiến trình. Nhưng nếu giấy phép đó bị gắn `measureFailed`, thì `actualBytes` **vĩnh viễn `null`**, nên `holdsUncommittedBytes()` **vĩnh viễn đúng**, nên `captureVramBaseline()` **vĩnh viễn bị chặn**, và sau `BASELINE_BLOCKED_ALARM_MS = 300_000` hệ báo động **không bao giờ tự lành**. Xấu nhất không phải "nên khởi động lại" mà là **"bắt buộc khởi động lại"**.

**Cách vá:** cho phép chốt sổ bằng **ước lượng dự phòng** khi phép đo hỏng nhưng khối byte chắc chắn đang tồn tại. Backend CUDA là ca lý tưởng: nó đã đo được **431,6 MiB giống hệt ở 5/5 tiến trình** trên hai thước độc lập.

- Thêm `VramEstimateSource` giá trị `"fallback-after-measure-failure"`.
- Broker nhận `commitFallback(leaseId, bytes, reason)`: đặt `actualBytes`, **không** gọi `estimator.recordActual()` (không được đầu độc nấc `learned` — đúng lý do C-1 đã tách hai việc này).
- Ghi sự kiện riêng, câu log nêu rõ đây là số **ước lượng**, không phải số đo.

⚠ **Ràng buộc toàn cục 6 áp ở đây.** Task này đổi **dân số** lease có `actualBytes === null`. Phải liệt kê **mọi** nơi tiêu thụ `holdsUncommittedBytes()` và `isLoadingLease()` rồi kiểm **từng nơi** — tối thiểu: `pendingBytes`, câu cảnh báo hướng lệch, lá chắn HOÃN của baseline, và `blockingOwners`. Ghi bảng "vị từ → nơi tiêu thụ → đã kiểm" vào báo cáo. Đây đúng lớp lỗi đã tái diễn **ba lần liên tiếp**.

- [ ] **Bước 1: Viết test thất bại trước** — dựng lease `gguf-backend` bị `measureFailed`, chạy `captureVramBaseline()`, khẳng định nó **bị chặn**; rồi `commitFallback`, khẳng định nó **chụp được** và **không** có báo động.
- [ ] **Bước 2: Chạy để thấy đỏ.**
- [ ] **Bước 3: Cài đặt `commitFallback` + gọi nó ở đường backend khi `measurable === false` hoặc đầu dò trả `null`.**
- [ ] **Bước 4: Chạy toàn bộ test vram, thấy xanh.**
- [ ] **Bước 5: Đột biến** — cho `commitFallback` gọi luôn `estimator.recordActual()`; ca chống đầu độc `learned` phải đỏ. Khôi phục.
- [ ] **Bước 6: Commit** — `fix(vram/pha2a): T5-15 — giay phep backend do hong khong con chan baseline vinh vien`

---

### Task 5: Bản liệt kê đầy đủ đường cấp phát (spec §5.6)

**Files:**
- Create: `server/services/vram/vramAllocationSites.ts`
- Test: `server/services/vram/vramAllocationSites.test.ts`
- Create: `docs/superpowers/reports/2026-08-03-vram-pha2a-report.md`

**Đây là task sinh ra đầu vào cho Pha 2B.** Chất lượng của nó quyết định chất lượng của cưỡng chế.

**Quét theo HAI trục độc lập, rồi đối chiếu:**

| Trục | Cách quét |
|---|---|
| **Lời gọi** | `git grep` cho `getLlama` · `loadModel` · `createContext` · `InferenceSession` · `onnxruntime` · `spawn(` trong `server/` và `scripts/`. Với mỗi kết quả: có đi qua broker không? |
| **Tiến trình** | Trên máy đang chạy thật: `nvidia-smi --query-compute-apps=pid,process_name --format=csv` lấy mẫu **nhiều thời điểm**, **bắt buộc gồm cửa sổ 03:00** khi `cron:kb-sync` chạy. |

**Mọi chênh lệch giữa hai bản là một hộ tiêu thụ chưa biết** — phải truy đến **tên file và số dòng**, không được bỏ qua.

**Lịch sử bắt buộc đọc trước khi tin bản liệt kê của mình:** hộ tiêu thụ bị sót ở **cả bốn** đợt trước — sidecar thị giác 7,8 GB lọt qua 7 task + 7 review; ONNX và cron ở Đợt 2; hộ thứ 7 rồi 8/10/11 ở Pha 1, trong đó **một hộ được sinh ra cách 143 dòng phía trên đúng đoạn mã vừa nối, cờ đang bật trong `.env`, chạy 03:00 mỗi đêm**. Nếu bản liệt kê của bạn "sạch ngay lần đầu", **hãy nghi ngờ chính nó**.

**Sản phẩm:**

```ts
/**
 * So diem cap phat VRAM da noi vao broker.
 * Test do khi ai do them diem moi ma khong khai bao.
 * ⚠ DEM BANG `git grep`, dem lai TU DAU moi lan. Con so nay DA SAI HAI LAN
 *   lien tiep khi dem bang cach cong don trong dau.
 */
export const WIRED_ALLOCATION_SITE_COUNT = /* so dem duoc */ 0;
export const KNOWN_ALLOCATION_SITES: readonly { file: string; symbol: string; wired: boolean; note: string }[] = [];
```

- [ ] **Bước 1: Quét trục LỜI GỌI, ghi bảng thô vào báo cáo.**
- [ ] **Bước 2: Quét trục TIẾN TRÌNH, gồm mẫu trong cửa sổ cron.** Nếu không lấy được mẫu 03:00, **nói thẳng là chưa lấy được** — không suy đoán.
- [ ] **Bước 3: Đối chiếu hai bảng. Mỗi chênh lệch truy đến file:dòng.**
- [ ] **Bước 4: Viết `vramAllocationSites.ts` + test khoá con số.**
- [ ] **Bước 5: Chạy test, thấy xanh.**
- [ ] **Bước 6: Đột biến** — thêm một điểm cấp phát giả vào một file `server/`; test phải đỏ. Khôi phục.
- [ ] **Bước 7: Viết báo cáo Pha 2A** — số đo Task 1/3, bảng vị từ Task 4, bản liệt kê Task 5, và **mục "những điều pha này KHÔNG nói được"**.
- [ ] **Bước 8: Commit** — `feat(vram/pha2a): ban liet ke day du duong cap phat — dau vao cho Pha 2B`

---

## Điều kiện ra của Pha 2A

| # | Điều kiện | Cách kiểm |
|---|---|---|
| 1 | Hai lượt nạp **chồng nhau** cho **hai** `actualBytes` riêng, sai < 5% so kích thước file | nghiệm thu sống Task 3 bước 7 |
| 2 | Không đường nào trộn số bộ đếm với số `nvidia-smi` | đọc mã, kết luận trong báo cáo |
| 3 | Lease backend đo hỏng **không** chặn baseline vĩnh viễn | test Task 4 |
| 4 | Bản liệt kê đường cấp phát **có con số khoá bằng test** | test Task 5 |
| 5 | Toàn bộ test vram xanh, kể cả `--sequence.shuffle.tests` | Task 3 bước 6 |
| 6 | `npm run check` và `npx vitest run` không hồi quy | trước khi push |

**Pha 2A KHÔNG tuyên bố điều gì về cưỡng chế.** Nếu một điều kiện không đạt, ghi thẳng là không đạt — tiền lệ đã có: Pha 1 công bố cổng ra **chưa đạt**, và đó là kết quả đúng.
