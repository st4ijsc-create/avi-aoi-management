# Pha 1.5 — Gỡ chặn Pha 2 (module điều phối VRAM)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gỡ **bảy điều kiện chặn** mà cổng ra Pha 1 dựng lên, để sổ cái đủ sạch cho Pha 2 cưỡng chế trên số của nó.

**Architecture:** Ba lỗi làm chuông kêu oan đều là **lỗi đo, không phải lỗi hệ**: hai cái thước khác nhau (~170 MiB), backend CUDA không vào sổ được (~430 MiB), và cửa sổ giữa `reserve()` và `commit()` (tới −16 GiB). Sửa cả ba rồi mới đo lại ngưỡng. Sau đó chạy Ư0 — nay khả thi vì backend đã nhìn thấy được.

**Tech Stack:** TypeScript · Node · Drizzle/PostgreSQL · vitest · `node-llama-cpp` · `nvidia-smi`

**Spec:** `docs/superpowers/specs/2026-08-02-vram-broker-design.md` · **Báo cáo Pha 1** (nguồn của 7 điều kiện): `docs/superpowers/reports/2026-08-02-vram-pha1-report.md` §9

## Global Constraints

- ⚠⚠ **VẪN KHÔNG ĐƯỢC CƯỠNG CHẾ.** `reserve()` **không bao giờ từ chối** ở Pha 1.5. Không xoá `enforceVramGuard()`, `ensureCapacity()`, `evictLRU()`. Cưỡng chế là **Pha 2**.
- ⚠⚠ **KHÔNG VÁ BÍ ẨN CUDA.** Ư7 đã trả lời *"trần KHÔNG tất định"*; §7.6 báo cáo Pha 1 nói rõ **chạy Ư0 TRƯỚC khi viết mã** cho đường vòng "chạm backend sớm". Task 2 chỉ **quan sát** `getLlama()`, **không đổi thời điểm gọi nó**.
- ⚠ **`reserve()` phải giữ ĐỒNG BỘ và KHÔNG I/O** — tính đồng bộ là lá chắn cấu trúc (`vramBroker.ts` chỉ có đúng một `import type`).
- ⚠ **Telemetry KHÔNG BAO GIỜ được ném.** Dùng lại khuôn `vramWiring.ts` (try/catch vòng ngoài + `commitMeasured` + `release` + cả lượt `import()`).
- **`release()` chỉ nhả SAU khi thiết bị đã nhả**; nơi không chứng minh được phải khai `releaseProof: "unverified"` (kỷ luật viết ở đầu `vramWiring.ts`).
- **Mọi lưới an toàn phải được chứng minh bằng ĐỘT BIẾN.** Pha 1 bắt **bốn** lưới giả, một trong đó do chính người thi công tự bắt.
- ⚠ `vi.resetModules()` **KHÔNG gỡ `vi.doMock`** ⇒ phải `doUnmock` tường minh; chạy kèm `--sequence.shuffle.tests`.
- ⚠ `"child_process"` và `"node:child_process"` **gộp cùng một khoá mock Vitest**.
- **Assert giá trị chính xác (`toBe`), KHÔNG `<=`.** Test và comment viết **tiếng Việt**.
- Cổng: `npm run kb:eval` **151/151** · `npx vitest run server/services/vram/` **93/93 trở lên** · `tsc` lỗi **tiền tồn tại**: `client/src/pages/SessionManagement.tsx:195`.
- ⚠ **KHÔNG `git add -A`/`-u`** — cây có đúng **245 mục** việc dở của người khác; kiểm lại sau commit.
- ⚠ **KHÔNG dùng `tasklist`** — máy trả **RỖNG khi có 8 `node.exe`**. Dùng `nvidia-smi` (nền **996-2.112 MiB**) + `netstat -ano | grep -E ":3000|:8081"`.
- ⚠ Sidecar thị giác ~7,8 GB tự tắt sau **10 phút** nhàn rỗi — thức lúc đo ⇒ số sai nặng.
- ⚠ `.env` **không git-track**; `.env.example` **thì có** (đã có 13 biến `VRAM_*`). Ép biến qua **CLI**.
- ⚠ **Số duy nhất được trích từ §5 Đợt 2: `16.698,37 MiB`.** Mọi ngưỡng trung gian **ĐÃ BỊ RÚT**.
- **Không push.**

## Cấu trúc file

| File | Đổi gì |
|---|---|
| `server/services/vram/vramProbe.ts` | trả thêm `source: "native" \| "smi"` (Task 1) |
| `server/services/vram/vramReconciler.ts` | nền ghi nhớ thước; đổi thước ⇒ chụp lại; băng dung sai cho lease chưa commit (Task 1, 3); nhãn tiến trình (Task 4) |
| `server/services/vram/types.ts` | thêm `VramLeaseKind = "gguf-backend"` (Task 2) |
| `server/services/aiGgufEngine.ts` | giấy phép quanh `getLlama()` (Task 2) |
| `server/_core/backgroundJobs.ts` · `server/_core/index.ts` | bật nhật ký ở **mọi** vai trò (Task 4) |
| `docs/superpowers/reports/2026-08-03-vram-pha1-5-report.md` | **Tạo** — số đo Task 5, 6 |

---

### Task 1: Một thước duy nhất

**Files:**
- Modify: `server/services/vram/vramProbe.ts`
- Modify: `server/services/vram/vramReconciler.ts`
- Test: `server/services/vram/vramProbe.test.ts`, `server/services/vram/vramReconciler.test.ts`

**Interfaces:**
- Produces: `readDeviceVram()` / `readDeviceVramUncached()` → `Promise<{ usedBytes: number; totalBytes: number; source: "native" | "smi" } | null>`

**Bối cảnh:** `startVramReconciler()` chụp nền ở `backgroundJobs.ts` **TRƯỚC** khi `getLlama()` gắn handle (`aiGgufEngine.ts:359-360`) ⇒ nền đo bằng **`nvidia-smi`**, mọi phép so sau đó dùng **`getVramState`**. Hai thước lệch **165-178 MiB** — đủ một mình đẩy lệch qua ngưỡng 512.

- [ ] **Step 1: Viết test đỏ**

Thêm vào `vramProbe.test.ts`:

```ts
it("báo rõ ĐÃ ĐO BẰNG THƯỚC NÀO — native", async () => {
  vi.doMock("./llamaHandle", () => ({
    getLlamaInstanceIfReady: () => ({ getVramState: async () => ({ used: 5, total: 10 }) }),
  }));
  const { readDeviceVramUncached } = await import("./vramProbe");
  expect((await readDeviceVramUncached())!.source).toBe("native");
});

it("báo rõ ĐÃ ĐO BẰNG THƯỚC NÀO — smi", async () => {
  vi.doMock("./llamaHandle", () => ({ getLlamaInstanceIfReady: () => null }));
  vi.doMock("child_process", () => ({
    execFile: (_c: unknown, _a: unknown, _o: unknown, cb: (e: null, r: { stdout: string }) => void) =>
      cb(null, { stdout: "1200, 32607\n" }),
  }));
  const { readDeviceVramUncached } = await import("./vramProbe");
  expect((await readDeviceVramUncached())!.source).toBe("smi");
});
```

Thêm vào `vramReconciler.test.ts`:

```ts
const MIB = 1024 * 1024;

it("★ ĐỔI THƯỚC ⇒ nền bị HUỶ và chụp lại, KHÔNG so hai thước với nhau", async () => {
  let src: "native" | "smi" = "smi";
  vi.doMock("./vramBroker", () => ({
    snapshot: () => ({ totalReservedBytes: 0, leases: [] }),
    leaseBytes: (l: { actualBytes: number | null }) => l.actualBytes ?? 0,
  }));
  vi.doMock("./vramProbe", () => ({
    readDeviceVram: async () => ({ usedBytes: 1000 * MIB, totalBytes: 32607 * MIB, source: src }),
  }));
  vi.doMock("./vramEventLog", () => ({ logVramEvent: () => {} }));

  const { captureVramBaseline, reconcileOnce } = await import("./vramReconciler");
  expect(await captureVramBaseline()).toBe(1000 * MIB);   // nền theo thước "smi"

  src = "native";                                          // handle vừa được gắn
  const r = await reconcileOnce();
  expect(r.baselineResampled).toBe(true);                  // nền phải được chụp LẠI
  expect(r.alarm).toBe(false);                             // và KHÔNG được báo động
});
```

- [ ] **Step 2: Chạy, xác nhận ĐỎ**

```bash
npx vitest run server/services/vram/vramProbe.test.ts server/services/vram/vramReconciler.test.ts
```
Kỳ vọng: `expected undefined to be 'native'` và `expected undefined to be true`. Dán output.

- [ ] **Step 3: Thêm `source` vào đầu dò**

Trong `probeOnce()`, nhánh native trả `{ usedBytes: v.used, totalBytes: v.total, source: "native" }`; nhánh `nvidia-smi` trả `… source: "smi"`. Cập nhật kiểu trả về của `readDeviceVram`, `readDeviceVramUncached` và đệm.

- [ ] **Step 4: Reconciler ghi nhớ thước và chụp lại khi đổi**

```ts
let baselineSource: "native" | "smi" | null = null;

// trong reconcileOnce(), NGAY SAU khi có `device`:
if (baselineCaptured && baselineSource !== null && device.source !== baselineSource) {
  // Hai thước lệch 165-178 MiB (báo cáo Pha 1 §3.4). So nền của thước này với số
  // của thước kia là tạo ra một khoản lệch GIẢ không bao giờ tự hết.
  console.warn(
    `[vram] ĐỔI THƯỚC ${baselineSource} → ${device.source} — huỷ nền cũ và chụp lại, ` +
      `không so hai thước với nhau.`,
  );
  baselineCaptured = false;
  baselineUsedBytes = null;
  baselineSource = null;
  const re = await captureVramBaseline();
  return { …, baselineResampled: true, alarm: false, driftBytes: null, … };
}
```
Trong `captureVramBaseline()`, sau khi ghim: `baselineSource = device.source;` và đưa `source` vào `detail` của sự kiện `baseline`. Thêm `baselineResampled: boolean` vào `VramReconcileResult`. `__resetVramBaselineForTests()` phải reset cả `baselineSource`.

- [ ] **Step 5: Chạy XANH + đột biến**

```bash
npx vitest run server/services/vram/
npx vitest run server/services/vram/ --sequence.shuffle.tests
```
Đột biến: bỏ nhánh `device.source !== baselineSource` ⇒ test *"★ ĐỔI THƯỚC"* **phải đỏ**. Dán output, hoàn nguyên, xác nhận `git diff` sạch.

- [ ] **Step 6: Commit**

```bash
git add server/services/vram/vramProbe.ts server/services/vram/vramReconciler.ts server/services/vram/vramProbe.test.ts server/services/vram/vramReconciler.test.ts
git commit -m "fix(vram/pha1.5-1): một thước duy nhất — đổi thước thì chụp lại nền"
```

---

### Task 2: Backend CUDA vào sổ

**Files:**
- Modify: `server/services/vram/types.ts`
- Modify: `server/services/aiGgufEngine.ts` (`getLlama()`, quanh `:340-365`)
- Test: `server/services/vram/wiring.backend.test.ts` (**mới**)

**Interfaces:**
- Consumes: `beginVramAllocation(...)` từ `./vram/vramWiring` (khuôn Task 5 Pha 1)
- Produces: `VramLeaseKind` thêm `"gguf-backend"`; giấy phép `owner: "cuda-backend"`

**Bối cảnh:** `getLlama()` cấp phát **~430 MiB** (đo 3 lượt: +431/+430/+431) và **không đường nào vào sổ được** — đây là khoản lớn nhất trong sàn cấu trúc làm ngưỡng 512 vô dụng.

⚠⚠ **CHỈ QUAN SÁT.** **KHÔNG đổi thời điểm gọi `getLlama()`**, không thêm lượt gọi sớm, không đổi tham số. Ư0 chưa chạy — mọi thay đổi *thời điểm* là vá bí ẩn CUDA khi chưa hiểu nó.

- [ ] **Step 1: Viết test đỏ**

Tạo `server/services/vram/wiring.backend.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { snapshot, __resetBrokerForTests } from "./vramBroker";

describe("backend CUDA — khoản ~430 MiB lớn nhất của sàn cấu trúc", () => {
  beforeEach(() => { __resetBrokerForTests(); vi.resetModules(); });

  it("★ getLlama() ghi giấy phép gguf-backend ở mức PRODUCTION", async () => {
    vi.doMock("node-llama-cpp", () => ({
      getLlama: async () => ({ getVramState: async () => ({ used: 1, total: 2 }) }),
    }));
    const { getLlama } = await import("../aiGgufEngine");
    await getLlama();
    const l = snapshot().leases.find((x) => x.request.owner === "cuda-backend");
    expect(l).toBeDefined();
    expect(l!.request.kind).toBe("gguf-backend");
    expect(l!.request.priority).toBe("production");
  });

  it("gọi getLlama() HAI LẦN chỉ ghi MỘT giấy phép (backend là singleton)", async () => {
    vi.doMock("node-llama-cpp", () => ({
      getLlama: async () => ({ getVramState: async () => ({ used: 1, total: 2 }) }),
    }));
    const { getLlama } = await import("../aiGgufEngine");
    await getLlama();
    await getLlama();
    expect(snapshot().leases.filter((x) => x.request.owner === "cuda-backend").length).toBe(1);
  });
});
```

⚠ Tên hàm xuất khẩu và hình dạng mock **có thể SAI** — đọc `aiGgufEngine.ts` rồi **sửa test cho khớp mã thật**. Xem `server/services/vram/wiring.inprocess.test.ts` để lấy đúng quy ước mock của file này.

- [ ] **Step 2: Chạy, xác nhận ĐỎ.** Dán output.

- [ ] **Step 3: Thêm kind**

`server/services/vram/types.ts`:
```ts
export type VramLeaseKind =
  | "gguf-backend"          // backend CUDA của getLlama() — ~430 MiB, singleton cả tiến trình
  | "gguf-model" | "gguf-context" | "gguf-embed-context"
  | "onnx-session"
  | "external-process";
```

- [ ] **Step 4: Nối giấy phép quanh `getLlama()`**

Trong `getLlama()` của `aiGgufEngine.ts`, **bọc đúng lượt khởi tạo thật** (nhánh đã có `llamaInstance` thì trả về ngay, **không** xin giấy phép lần hai):

```ts
// Pha 1.5 Task 2 — backend CUDA là khoản ~430 MiB lớn nhất của "sàn cấu trúc" mà Pha 1
// đo được nhưng KHÔNG đưa vào sổ được. Chỉ QUAN SÁT: thời điểm gọi getLlama() KHÔNG ĐỔI.
// ⚠ Backend là SINGLETON cả tiến trình ⇒ không có đường release; khai releaseProof
// "unverified" là sai ngữ nghĩa — nó không bao giờ được nhả, và đó là đúng.
const { beginVramAllocation } = await import("./vram/vramWiring");
const ticket = await beginVramAllocation({
  owner: "cuda-backend",
  kind: "gguf-backend",
  priority: "production",
});
llamaInstance = await getLlamaLib({ gpu: "auto" });
await ticket.commitMeasured();
```

⚠ Đặt `beginVramAllocation` **ngay trước** lượt `getLlama` thật của thư viện và `commitMeasured()` **ngay sau** — đó là cách duy nhất delta đo được là của backend chứ không của thứ khác.

- [ ] **Step 5: Chạy XANH + đột biến**

```bash
npx vitest run server/services/vram/
npm run kb:eval
```
Đột biến: bỏ `beginVramAllocation` ⇒ ca ★ **phải đỏ**. Hoàn nguyên.

- [ ] **Step 6: Commit**

```bash
git add server/services/vram/types.ts server/services/aiGgufEngine.ts server/services/vram/wiring.backend.test.ts
git commit -m "fix(vram/pha1.5-2): backend CUDA ~430 MiB vào sổ — chỉ quan sát, không đổi thời điểm"
```

---

### Task 3: Cửa sổ chưa-commit thôi sinh báo động

**Files:**
- Modify: `server/services/vram/vramReconciler.ts`
- Test: `server/services/vram/vramReconciler.test.ts`

**Interfaces:**
- Consumes: `snapshot()` (có `leases[].actualBytes: number | null`)

**Bối cảnh:** `reserve()` cộng **ước lượng** vào sổ **trước khi** VRAM vật lý tăng; `commitMeasured()` mãi sau khi nạp xong. Với 30B khoảng đó **11-43 giây** ⇒ lệch **−16.335 MiB**. Đây là nguồn `p95` của phân bố Pha 1.

**Nguyên tắc:** lease **chưa commit** = *"đã xin, chưa cấp phát xong"* ⇒ nó nới **chỉ phía ÂM**, không nới phía dương. Kẻ cấp phát chui vẫn phải bị bắt.

- [ ] **Step 1: Viết test đỏ**

```ts
const MIB = 1024 * 1024;
const lease = (owner: string, est: number, actual: number | null) => ({
  id: owner, request: { owner, kind: "gguf-model", estimatedBytes: est, priority: "interactive" },
  actualBytes: actual, acquiredAt: new Date(), lastHeartbeatAt: new Date(), released: false,
});

it("★ đang nạp 30B (chưa commit) ⇒ lệch ÂM KHÔNG báo động", async () => {
  vi.doMock("./vramBroker", () => ({
    snapshot: () => ({ totalReservedBytes: 17_000 * MIB, leases: [lease("gguf:30B", 17_000 * MIB, null)] }),
    leaseBytes: (l: { actualBytes: number | null; request: { estimatedBytes: number } }) =>
      l.actualBytes ?? l.request.estimatedBytes,
  }));
  vi.doMock("./vramProbe", () => ({
    readDeviceVram: async () => ({ usedBytes: 1_000 * MIB, totalBytes: 32_607 * MIB, source: "smi" }),
  }));
  vi.doMock("./vramEventLog", () => ({ logVramEvent: () => {} }));
  const { captureVramBaseline, reconcileOnce } = await import("./vramReconciler");
  await captureVramBaseline();
  const r = await reconcileOnce();
  expect(r.alarm).toBe(false);
  expect(r.pendingBytes).toBe(17_000 * MIB);
});

it("★ băng dung sai CHỈ nới phía ÂM — kẻ cấp phát chui vẫn bị bắt khi đang nạp", async () => {
  vi.doMock("./vramBroker", () => ({
    snapshot: () => ({ totalReservedBytes: 17_000 * MIB, leases: [lease("gguf:30B", 17_000 * MIB, null)] }),
    leaseBytes: (l: { actualBytes: number | null; request: { estimatedBytes: number } }) =>
      l.actualBytes ?? l.request.estimatedBytes,
  }));
  // nền 1.000; thiết bị 9.000 ⇒ 8.000 MiB do ai đó cấp phát mà KHÔNG xin phép
  vi.doMock("./vramProbe", () => ({
    readDeviceVram: async () => ({ usedBytes: 9_000 * MIB, totalBytes: 32_607 * MIB, source: "smi" }),
  }));
  vi.doMock("./vramEventLog", () => ({ logVramEvent: () => {} }));
  const { captureVramBaseline, reconcileOnce } = await import("./vramReconciler");
  vi.doMock("./vramProbe", () => ({
    readDeviceVram: async () => ({ usedBytes: 1_000 * MIB, totalBytes: 32_607 * MIB, source: "smi" }),
  }));
  await captureVramBaseline();
  const r = await reconcileOnce();
  expect(r.alarm).toBe(true);
});
```

⚠ Hai ca trên cần nền khác nhau ⇒ nếu mock không cho đổi giữa chừng, **sửa mock** (ví dụ biến `let used` đóng trong closure), **đừng sửa mã sản xuất cho khớp test**.

- [ ] **Step 2: Chạy, xác nhận ĐỎ.** Dán output.

- [ ] **Step 3: Thêm băng dung sai một phía**

```ts
// Lease CHƯA commit nghĩa là "đã xin, CHƯA cấp phát xong" ⇒ VRAM vật lý chưa có.
// Nó nới dung sai CHỈ phía ÂM. Nới cả hai phía sẽ làm mù chính thứ module này sinh ra
// để bắt: một kẻ cấp phát chui đúng lúc hệ đang nạp model.
const pendingBytes = snap.leases
  .filter((l) => l.actualBytes === null)
  .reduce((s, l) => s + l.request.estimatedBytes, 0);

const drift = attributable - committedBytes;
const alarm = drift > DRIFT_THRESHOLD_BYTES || drift < -(DRIFT_THRESHOLD_BYTES + pendingBytes);
```
Thêm `pendingBytes: number` vào `VramReconcileResult` và vào `detail` của sự kiện `drift`.

- [ ] **Step 4: Chạy XANH + đột biến**

Đột biến: đổi `-(DRIFT_THRESHOLD_BYTES + pendingBytes)` thành `-DRIFT_THRESHOLD_BYTES` ⇒ ca ★ đầu **phải đỏ**; đổi thành `drift > DRIFT_THRESHOLD_BYTES + pendingBytes` (nới cả hai phía) ⇒ ca ★ thứ hai **phải đỏ**. Dán cả hai. Hoàn nguyên.

- [ ] **Step 5: Commit**

```bash
git add server/services/vram/vramReconciler.ts server/services/vram/vramReconciler.test.ts
git commit -m "fix(vram/pha1.5-3): lease chưa commit nới dung sai CHỈ phía âm"
```

---

### Task 4: Quyết tường minh về `ROLE=api`

**Files:**
- Modify: `server/_core/index.ts` (quanh `:5198-5205`)
- Modify: `server/_core/backgroundJobs.ts` (khối VRAM `:132-140`)
- Modify: `server/services/vram/vramReconciler.ts` (nhãn tiến trình trong cảnh báo)
- Test: `server/services/vram/roleTopology.test.ts` (**mới**)

**Bối cảnh:** `ROLE=api` bỏ qua `startBackgroundSchedulers()` ⇒ **không** nhật ký, **không** đối chiếu, **không** nền — nhưng `beginVramAllocation()` **vẫn chạy** và tiến trình **vẫn warm 30B**. Hàng đợi phình tới `VRAM_LOG_QUEUE_MAX` (5000) rồi **rơi im lặng**.

**Quyết định (controller, ghi vào mã):** **mọi vai trò BẬT nhật ký; CHỈ vai trò chạy scheduler mới ĐỐI CHIẾU.**
Lý do: sổ là **của riêng từng tiến trình**, không có sổ chung (sổ chung là Pha 3). Hai tiến trình cùng đối chiếu trên **một thiết bị** thì mỗi bên thấy bên kia là "cấp phát chui" — biến chuông thành nhiễu. Nhưng **sự kiện thì phải tới DB từ mọi vai trò**, nếu không Pha 2 sẽ chốt ngưỡng trên nửa dữ liệu.

- [ ] **Step 1: Viết test đỏ**

Tạo `server/services/vram/roleTopology.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";

describe("ROLE=api — nhật ký BẬT, đối chiếu TẮT", () => {
  beforeEach(() => vi.resetModules());

  it("★ cảnh báo lệch phải NÊU khả năng tiến trình anh em khi hệ tách vai trò", async () => {
    process.env.ROLE = "worker";
    const { describeTopologyHint } = await import("./vramReconciler");
    expect(describeTopologyHint()).toMatch(/tiến trình anh em|api/i);
  });

  it("vai trò all-in-one (ROLE không đặt) thì KHÔNG nêu tiến trình anh em", async () => {
    delete process.env.ROLE;
    const { describeTopologyHint } = await import("./vramReconciler");
    expect(describeTopologyHint()).toBe("");
  });
});
```

- [ ] **Step 2: Chạy, xác nhận ĐỎ.** Dán output.

- [ ] **Step 3: Bật nhật ký ở mọi vai trò**

Trong `server/_core/index.ts`, **ngoài** khối `if (SERVER_ROLE === "api")`, thêm một lượt bật nhật ký chạy cho **mọi** vai trò:

```ts
// Pha 1.5 Task 4 — sổ là của RIÊNG từng tiến trình; đối chiếu chỉ hợp lệ ở tiến trình
// chạy scheduler. Nhưng SỰ KIỆN phải tới DB từ MỌI vai trò, nếu không Pha 2 sẽ chốt
// ngưỡng trên nửa dữ liệu. Hàng đợi 5000 mục rơi im lặng khi không có ai xả.
void import("../services/vram/vramEventLog")
  .then((m) => m.__setVramLogTimerEnabled(true))
  .catch(() => { /* telemetry không được làm hỏng boot */ });
```
Trong `backgroundJobs.ts`, khối VRAM giữ nguyên `startVramReconciler()` và **bỏ** lượt `__setVramLogTimerEnabled(true)` trùng (nó nay bật ở tầng trên; hàm đã idempotent nên để lại cũng vô hại — **chọn một, ghi rõ lý do**).

- [ ] **Step 4: Cảnh báo nêu đúng khả năng**

Trong `vramReconciler.ts`:

```ts
/** Nhãn cho biết hệ có đang chạy nhiều tiến trình giữ VRAM không (báo cáo Pha 1 §9). */
export function describeTopologyHint(): string {
  const role = process.env.ROLE ?? "";
  if (role !== "api" && role !== "worker") return "";
  return " ⚠ Hệ đang tách vai trò api/worker — mỗi tiến trình có sổ RIÊNG, nên khoản lệch này " +
    "có thể là của tiến trình anh em chứ không phải kẻ lạ. Sổ chung là Pha 3.";
}
```
Nối `describeTopologyHint()` vào **cuối** câu cảnh báo lệch **dương** (nhánh `drift > 0`). **Không** nối vào nhánh âm — lệch âm là giấy phép treo của **chính tiến trình này**.

- [ ] **Step 5: Chạy XANH + kiểm LIVE**

```bash
npx vitest run server/services/vram/
ROLE=api npm run dev 2>&1 | grep -i "vram" | head -20
```
Kỳ vọng: có dòng sự kiện được xả, **không** có dòng chụp nền/đối chiếu. Dán output. Dừng app, `nvidia-smi` về nền, `netstat` cổng trống.

- [ ] **Step 6: Commit**

```bash
git add server/_core/index.ts server/_core/backgroundJobs.ts server/services/vram/vramReconciler.ts server/services/vram/roleTopology.test.ts
git commit -m "fix(vram/pha1.5-4): mọi vai trò ghi nhật ký, chỉ scheduler đối chiếu"
```

---

### Task 5: Nghiệm thu LIVE ba hộ mới + đo hai trainer + chốt lại ngưỡng — CHỈ ĐO

**Files:**
- Create: `docs/superpowers/reports/2026-08-03-vram-pha1-5-report.md`

⚠⚠ **KHÔNG SỬA MÃ SẢN XUẤT.** Script đo tạm phải **xoá sau**; `git status --porcelain` về đúng **245** (trừ file báo cáo).

- [ ] **Step 1: Nghiệm thu cổng eval `cron:kb-eval-gate`**

Ép chạy `runKbSyncNow()` (hoặc gọi thẳng đường cổng eval) rồi truy vấn:

```sql
SELECT event, owner, "estimatedBytes", "actualBytes", "estimateSource", "createdAt"
FROM vram_events WHERE owner LIKE 'cron:%' ORDER BY "createdAt" DESC LIMIT 20;
```
**Phải thấy** `reserve` rồi `release` cho `cron:kb-eval-gate`, đúng vòng đời tiến trình con. Ghi cả số `nvidia-smi` trước/trong/sau.

- [ ] **Step 2: ĐO THẬT hai tiến trình Python**

Đặt `LOCAL_TRAINER_CMD` và `LLM_FINETUNE_CMD` **qua CLI**, chạy một job nhỏ nhất có thể, đo `nvidia-smi` trước/đỉnh/sau. **≥2 lượt mỗi cái.**
⚠ Ước lượng hiện tại (**6.144 MiB** từ docstring; kích-thước-file cho QLoRA) **chưa phải số đo** — đây là lượt biến nó thành số đo.
⚠ Nếu môi trường không chạy nổi (thiếu torch/CUDA/dataset) thì **nói thẳng là KHÔNG ĐO ĐƯỢC** và ghi rõ thiếu gì — **đừng suy ra một con số rồi gắn nhãn "đã đo"**. Đặt `VRAM_TRAINER_ESTIMATE_MB` / `VRAM_FINETUNE_ESTIMATE_MB` theo số đo được; không đo được thì **giữ nguyên và ghi lý do**.

- [ ] **Step 3: Đo lại phân bố lệch trên mã ĐÃ SẠCH**

Lấy mẫu `reconcileOnce()` 1 s/lượt trọn vòng đời (như Pha 1 §3.2), **≥35 mẫu**, ở **hai** trạng thái: nghỉ · có model GGUF thường trú.
Báo cáo: **p50 / p90 / p95 / max**, tỉ lệ báo động, và **so với Pha 1** (536 / 664 / 738,6 / 882,4).
⚠ Sổ **vẫn** không tự sinh nổi phân bố (`drift` chỉ ghi khi đã vượt ngưỡng) ⇒ đo ngoài, **và nói rõ đó vẫn là hạn chế chưa gỡ**.

- [ ] **Step 4: Chốt ngưỡng và nhịp**

Đề xuất `VRAM_DRIFT_THRESHOLD_MB` mới **dựa trên phân bố vừa đo**, kèm lý do. Nếu sau ba task sửa mà sàn **vẫn** trên 512 thì **nói thẳng**, nêu khoản nào còn lại và nó là lỗi đo hay lỗi hệ.
Nhịp: chi phí đầu dò đo được ở Pha 1 là **p50 62,9 ms** (`nvidia-smi`) / **0,00 ms** (native) ⇒ **không phải ràng buộc**; đề xuất nhịp theo nhu cầu phát hiện, không theo chi phí.

- [ ] **Step 5: Chạy 24 h**

Bật hệ ở cấu hình all-in-one, để **≥24 h** có ít nhất một lượt cron 03:00 (kèm cổng eval). Truy vấn phân bố `drift` thật từ `vram_events`. **Đây là điều kiện chặn số 4 và 6.**
⚠ Nếu không đủ thời gian trong phiên thì **nói thẳng là CHƯA CHẠY**, ghi lại **thủ tục chính xác** để người sau chạy — **đừng công bố cổng ra là ĐẠT khi chưa có 24 h**.

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/reports/2026-08-03-vram-pha1-5-report.md
git commit -m "docs(vram/pha1.5-5): nghiệm thu ba hộ mới, đo hai trainer, chốt lại ngưỡng"
```

---

### Task 6: Ư0 — ratchet. CHỈ ĐO, CẤM VÁ

**Files:**
- Modify: `docs/superpowers/reports/2026-08-03-vram-pha1-5-report.md` (thêm mục "Ư0")

⚠⚠⚠ **KHÔNG SỬA MÃ SẢN XUẤT, kể cả khi tìm ra cơ chế và thấy cách sửa hiển nhiên.** Đường vòng "chạm backend sớm" **có thể chỉ là một trường hợp riêng của Ư0 viết sai** (báo cáo Pha 1 §7.6). Biến nó thành mã khi chưa hiểu là **đổi một lỗi ồn ào lấy một lỗi im lặng**.

**Ư0:** *"một cấp phát CUDA nhỏ đi trước mới mở được cấp phát lớn"* — hạng ★★, **ứng viên số một**.

**Vì sao nay đo được:** Task 2 đưa backend `~430 MiB` vào sổ ⇒ lần đầu tiên `prior` phản ánh **cấp phát GPU thật**, không chỉ "cấp phát đã vào sổ". Chính chỗ mù đã làm thí nghiệm 12 lượt của Pha 1 **không phân biệt được gì**.

- [ ] **Step 1: Dựng hai nhánh trên CÙNG nền**

Cả hai chạy trên `npm run dev:worker` (log 79 dòng vs 305), **N ≥ 12 mỗi nhánh**:
- **Nhánh A** — để nguyên: `getLlama()` chạy như hiện tại rồi nạp khối `16.698,37 MiB`.
- **Nhánh B** — chèn **một cấp phát nhỏ** (ví dụ model 0,6B) **sau** `getLlama()` và **trước** khối lớn.

Mỗi lượt **phải in**: `nvidia-smi` ngay **trước và sau** `getLlama()` (dấu vết backend ~430 MiB) **và** ảnh chụp sổ ngay trước lượt cấp phát lớn.

- [ ] **Step 2: So sánh có thống kê**

Fisher exact cho hai tỉ lệ. **Nêu p.** Pha 1 đã đặt mốc: 3/12 ở nhánh worker để nguyên.
⚠ **Nếu hai nhánh không phân biệt được** thì viết đúng thế — **đừng gọi là "đã loại"**. Pha 1 đã mắc lỗi *"kết luận rộng hơn phép thử"* **năm lần** ở đúng câu hỏi này.

- [ ] **Step 3: Kiểm điều kiện ĐỦ hay CẦN**

`aiGgufEngine.ts:1398-1400` ghi một phép đo **3/3** đúng chiều ratchet-như-điều-kiện-**ĐỦ**. Hai câu khác nhau:
- **CẦN**: không có cấp phát nhỏ đi trước thì **luôn** hỏng;
- **ĐỦ**: có cấp phát nhỏ đi trước thì **luôn** được.
**Nói rõ phép thử của bạn trả lời câu nào**, và đừng trả lời câu kia.

- [ ] **Step 4: Viết mục "Ư0"**

Gồm: **(i)** thiết kế hai nhánh + N + nền · **(ii)** bảng kết quả từng lượt kèm `nvidia-smi` quanh `getLlama()` · **(iii)** Fisher exact + p · **(iv)** phán quyết: CẦN / ĐỦ / **không phân biệt được** · **(v)** nếu Ư0 sống: **hệ quả cho Pha 2** — đường vòng có nên thành mã không, và **điều kiện gì phải đúng trước**.

- [ ] **Step 5: Xác nhận không đụng mã**

```bash
git status --porcelain
git diff --stat HEAD -- server/ client/ drizzle/ scripts/ shared/
```
Phải rỗng ở nhóm mã. Script đo tạm đã xoá. Cây về **245** (trừ báo cáo).

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/reports/2026-08-03-vram-pha1-5-report.md
git commit -m "docs(vram/pha1.5-6): Ư0 ratchet — đo trên sổ đã thấy backend CUDA"
```

---

## Self-Review

**1. Spec coverage — bảy điều kiện chặn của §9:**

| Điều kiện | Task |
|---|---|
| 1. Một thước duy nhất | 1 |
| 2. Backend CUDA vào sổ | 2 |
| 3. Cửa sổ chưa-commit không báo động | 3 |
| 4. Chốt lại ngưỡng rồi mới chạy 24 h | 5 (Step 3-5) |
| 5. Quyết tường minh `ROLE=api` | 4 |
| 6. Nghiệm thu ≥1 đêm thật có `kb:sync` + cổng eval | 5 (Step 1, 5) |
| 7. ĐO THẬT hai tiến trình Python | 5 (Step 2) |
| **+ Ư0** (§7.6: chạy trước khi viết mã Pha 2) | 6 |

**Cố ý ngoài phạm vi** (thuộc Pha 2/3): cưỡng chế + `VramRefusedError` ném thật · cơ chế hoãn §5.4 · sổ chung xuyên tiến trình · xoá `enforceVramGuard`/`ensureCapacity`/`evictLRU` · vá `gpuLayers: -1` của reranker · `evictEmbeddingSessionCache` không người gọi · hai cửa `return` im lặng anh em của I-2 · `releaseProof` chưa có lưới.

**2. Placeholder scan:** không có "TBD". Ba chỗ cố ý để người thi công quyết, đều kèm chỉ dẫn khi gặp: Task 2 Step 1 (tên hàm/mock có thể sai — sửa test, không sửa mã) · Task 4 Step 3 (bật nhật ký ở một tầng hay hai — chọn một, ghi lý do) · Task 5 Step 2/5 (không đo được / chưa đủ 24 h thì **nói thẳng**, cấm suy ra số rồi gắn nhãn "đã đo").

**3. Type consistency:** `source: "native" | "smi"` khai ở Task 1, dùng ở Task 3 (mock đầu dò). `baselineResampled` (Task 1) và `pendingBytes` (Task 3) đều là trường mới của `VramReconcileResult` — hai task, một kiểu, không đụng nhau. `"gguf-backend"` chỉ Task 2 thêm. `describeTopologyHint()` chỉ Task 4. `beginVramAllocation()` / `commitMeasured()` / `releaseProof` giữ nguyên chữ ký từ Pha 1.

---

### Task 7: T5-1 — nền thôi nuốt model đang nạp

> **Thêm sau khi Task 5 (chỉ-đo) tìm ra lỗi này. Không có trong kế hoạch gốc.**

**Files:**
- Modify: `server/services/vram/vramReconciler.ts` (`captureVramBaseline()`)
- Test: `server/services/vram/vramReconciler.test.ts`

**Bối cảnh:** `captureVramBaseline()` tính `nền = raw − Σ(actualBytes của lease ĐÃ COMMIT)`. Lease **đang nạp** (`pending`) đóng góp **0**, **trong khi byte của nó ĐÃ nằm trong `raw`** ⇒ nền nuốt trọn model đang nạp. Đo được: `priorBaseline 978 → baseline 17.891 MiB`, `drift = −16.700 MiB`, **alarm 100% mọi nhịp, không bao giờ tự lành**.

⚠⚠ **HAI đường gọi, CẢ HAI đều dính** — bản vá chỉ chạm một là **KHÔNG ĐẠT**:
- **(a)** `startVramReconciler():660` — lượt chụp **ĐẦU** lúc boot, đua với `warmUpOllamaModels()` (`setTimeout(2000)`, `index.ts:4931` → `:5229` cách **298 dòng**, **không** cổng `GGUF_WARM_DEEP_MODEL_ON_BOOT`). **Chưa dựng lại LIVE — suy từ mã.**
- **(b)** `reconcileOnce():439` và `:513` — nhánh **resample**. **ĐÃ ĐO, tái hiện 2/2.**

⚠ **Tiền đề docstring `:90-93` SAI**: đo `nvidia-smi = 18.115 MiB` khi lease vẫn `pending` ⇒ *"chưa commit"* chỉ nghĩa **sổ chưa theo kịp**, **không** nghĩa thiết bị còn trống.

- [ ] **Step 1: Viết test đỏ cho CẢ HAI đường**

```ts
const MIB = 1024 * 1024;
const pendingLease = (owner: string, est: number) => ({
  id: owner, request: { owner, kind: "gguf-model", estimatedBytes: est, priority: "interactive" },
  actualBytes: null, measureFailed: false, acquiredAt: new Date(), lastHeartbeatAt: new Date(), released: false,
});

it("★★ (a) chụp nền LẦN ĐẦU khi model đang nạp ⇒ KHÔNG nuốt 17 GB vào nền", async () => {
  vi.doMock("./vramBroker", () => ({
    snapshot: () => ({ totalReservedBytes: 17_000 * MIB, leases: [pendingLease("gguf:30B", 17_000 * MIB)] }),
    leaseBytes: (l: any) => l.actualBytes ?? l.request.estimatedBytes,
  }));
  vi.doMock("./vramProbe", () => ({
    readDeviceVram: async () => ({ usedBytes: 17_900 * MIB, totalBytes: 32_607 * MIB, source: "smi" }),
  }));
  vi.doMock("./vramEventLog", () => ({ logVramEvent: () => {} }));
  const { captureVramBaseline } = await import("./vramReconciler");
  const base = await captureVramBaseline();
  expect(base).not.toBe(17_900 * MIB);          // KHÔNG được nuốt cả 17,9 GB
  expect(base === null || base <= 1_000 * MIB).toBe(true);
});

it("★★ (b) nhánh RESAMPLE khi model đang nạp ⇒ cũng KHÔNG nuốt", async () => {
  // cùng mock, nhưng đi qua reconcileOnce() với thước đổi từ "smi" sang "native"
});
```

⚠ Chữ ký/hình dạng mock **có thể sai** — đọc mã thật, **sửa test cho khớp**.

- [ ] **Step 2: Chạy, xác nhận ĐỎ.** Dán output.

- [ ] **Step 3: Sửa**

Hướng gợi ý (**bạn quyết, ghi rõ lý do**): **từ chối chụp nền khi còn lease `pending` thuộc lớp sẽ commit** — nằm **bên trong hàm** nên phủ **cả hai** đường theo cấu trúc, cùng khuôn lá chắn `if (raw < committedBytes)` đã có.

⚠⚠ **Câu hỏi bắt buộc trả lời trước khi viết**: *"nếu LUÔN có lease pending thì nền không bao giờ chụp được?"* Điều kiện "còn pending" **quá rộng** — hộ `external-process` **cố ý không bao giờ commit** (cron 30 phút, trainer tới `sidecarTimeoutMs()`). Chụp nền không được ⇒ `baselineRequired && baselineUsedBytes === null` ⇒ **trả `alarm:false` IM LẶNG vĩnh viễn** — đúng lớp lỗi EXP-1 phải dựng ngắt mạch để diệt.
⇒ **Phần thu hẹp phải ĐO, không suy đoán.**

- [ ] **Step 4: Chạy XANH + đột biến**

Đột biến: quay lại `raw − Σ actualBytes` ⇒ **cả hai** ca ★★ phải đỏ. Hoàn nguyên.

- [ ] **Step 5: Nghiệm thu LIVE đường (a)** — chưa ai dựng lại được. Làm chậm boot có kiểm soát (hoặc hạ `GGUF_WARM_DELAY_MS`) để warm thắng đua, **đòi ca ĐỎ trước khi vá**, rồi xác nhận sau khi vá. Nếu **không dựng được**, nói thẳng và ghi lý do.

- [ ] **Step 6: Commit**

```bash
git add server/services/vram/vramReconciler.ts server/services/vram/vramReconciler.test.ts
git commit -m "fix(vram/pha1.5-7): nền thôi nuốt model đang nạp — đóng CẢ HAI đường"
```

---

### Task 8: C-1 — sổ commit thôi cộng trùng

> **Thêm sau khi review Task 7 tái hiện được. Không có trong kế hoạch gốc.**

**Files:**
- Modify: `server/services/vram/vramWiring.ts` (`beginVramAllocation` / `commitMeasured`)
- Test: `server/services/vram/wiring.doubleCount.test.ts` (**mới**)

**Bối cảnh:** `vramWiring.ts:168` đọc `beforeUsed` và `:241` tính `const actual = after.usedBytes - beforeUsed;` — **cả hai đầu đo đọc `used` TOÀN THIẾT BỊ**. Mọi lượt cấp phát rơi vào khoảng `before→after` của một giấy phép bị quy **trọn vẹn** cho giấy phép đó ⇒ hai cửa sổ chồng nhau ⇒ **cùng một khối byte ghi HAI LẦN**.

**Đã tái hiện** (broker + wiring thật): `thiết bị = 5.000 MiB · Σ actualBytes = 8.000 MiB [A=4000, B=4000]`. Khớp ca LIVE `thiết bị 8.445 < đã commit 9.797`.

⚠ **Có thật, không giả định**: `GGUF_MAX_CONCURRENCY=4`, **6 nơi gọi do HTTP điều khiển**, log LIVE hiện **hai lease `gguf-model` pending cùng lúc**. `aiGgufEngine.ts:2756-2762`: *"4 lượt tuần tự 654 MiB; đồng thời 2.430 MiB"*.

⚠ **Biến thể tệ hơn, KHÔNG tự lành**: một **tiến trình con** (kb-sync / vision / trainer) cấp phát trong cửa sổ đo của một giấy phép trong-tiến-trình ⇒ giấy phép đó **nuốt byte của con vĩnh viễn** vào `actualBytes`; con thoát, thiết bị tụt, **sổ không tụt**.

⚠⚠ **Vì sao chặn Pha 2**: Pha 2 từ chối/thu hồi trên `headroom = trần − reserve − Σ leaseBytes`, mà `leaseBytes()` trả `actualBytes` sau commit ⇒ **từ chối nạp và ĐUỔI MODEL ĐANG CHẠY trên byte ma**.

- [ ] **Step 1: Viết test đỏ**

```ts
it("★★ hai cửa sổ đo CHỒNG NHAU ⇒ tổng sổ KHÔNG được vượt delta thiết bị thật", async () => {
  // thiết bị: 1000 → (A xin) → 3000 → (B xin) → 5000 ; delta THẬT = 4000
  // A và B mỗi bên thấy after−before = 4000 ⇒ sổ 8000 nếu còn lỗi
  const tA = await beginVramAllocation({ owner: "gguf:A", kind: "gguf-model", priority: "interactive" });
  const tB = await beginVramAllocation({ owner: "gguf:B", kind: "gguf-model", priority: "interactive" });
  await tA.commitMeasured();
  await tB.commitMeasured();
  const total = snapshot().leases.reduce((s, l) => s + (l.actualBytes ?? 0), 0);
  expect(total).toBeLessThanOrEqual(4000 * MIB);   // KHÔNG được là 8000
});
```
⚠ Chữ ký/mock **có thể sai** — đọc mã thật, sửa test cho khớp. Xem `wiring.inprocess.test.ts` để lấy quy ước.

- [ ] **Step 2: Chạy, xác nhận ĐỎ.** Dán output.

- [ ] **Step 3: Sửa**

⚠⚠ **NGUYÊN TẮC BẤT DI BẤT DỊCH: KHÔNG BỊA SỐ.** Khi không đo sạch được thì **khai `measureFailed`**, đừng chia tỉ lệ, đừng ước lượng bù. Cả chương trình này dựng trên *"một ước lượng sai ĐƯỢC GẮN CỜ rẻ hơn một ước lượng sai ĐƯỢC TIN."*

Ba hướng, **bạn chọn và ghi rõ lý do**:
- **(c) Phát hiện chồng lấn ⇒ `markMeasureFailed()`** — trung thực: *"không cô lập được phép đo này"*. Cùng ngữ nghĩa `measureFailed` sẵn có, cùng đường tự lành (Task 3 đã dựng).
- **(a) Tuần tự hoá phép đo** — chỉ một giấy phép được "đang đo" tại một thời điểm. Sạch nhất về số, nhưng **nối tiếp đường cấp phát** ⇒ hỏi ngay: có khoá chéo với `withGgufSlot` không? có làm chậm đường nóng không?
- **(a)+(c)** — tuần tự khi rẻ, khai hỏng khi không.

⚠⚠ **Hai câu hỏi bắt buộc trả lời trước khi viết** (Pha 1.5 đã trả **7 vòng sửa** cho chúng):
1. **"Nếu nhánh mới này kích hoạt SAI thì bao lâu nó tự lành?"**
2. **"Tôi vừa kiểm một đường — đường KIA có đi qua đúng chỗ này không?"**

⚠ Và: **tiến trình con cấp phát trong cửa sổ đo** thì phát hiện chồng lấn **trong tiến trình** *không thấy được*. Nói rõ phạm vi bản vá phủ tới đâu — **đừng tuyên bố rộng hơn**.

- [ ] **Step 4: Chạy XANH + đột biến**

Đột biến: vô hiệu phát hiện chồng lấn ⇒ ca ★★ **phải đỏ**. Hoàn nguyên.

- [ ] **Step 5: Commit**

```bash
git add server/services/vram/vramWiring.ts server/services/vram/wiring.doubleCount.test.ts
git commit -m "fix(vram/pha1.5-8): sổ commit thôi cộng trùng khi hai cửa sổ đo chồng nhau"
```
