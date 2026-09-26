# Pha 1 — Sổ cái & Báo động (module điều phối VRAM)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dựng sổ cái VRAM cho **cả sáu** hộ tiêu thụ GPU và báo động khi có kẻ cấp phát không xin phép — **không đổi một hành vi cấp phát nào**.

**Architecture:** Broker giữ sổ trong bộ nhớ và trả lời tức thì (không I/O). Đầu dò `nvidia-smi` chạy **nền**, chỉ để phát hiện lệch. Sáu điểm cấp phát **khai báo** giấy phép nhưng **chưa ai bị từ chối** — broker vẫn *tính* xem nó *sẽ* từ chối gì và ghi lại, để Pha 2 biết trước bán kính ảnh hưởng trước khi bật cưỡng chế.

**Tech Stack:** TypeScript · Node · Drizzle/PostgreSQL · vitest · `node-llama-cpp` · `onnxruntime-node`

**Spec:** `docs/superpowers/specs/2026-08-02-vram-broker-design.md`

## Global Constraints

- ⚠⚠ **PHA 1 KHÔNG ĐƯỢC ĐỔI HÀNH VI CẤP PHÁT.** Không xoá `enforceVramGuard()`, không xoá `ensureCapacity()`, không xoá `evictLRU()`. Chúng vẫn chạy y nguyên. Broker chỉ **quan sát**.
- ⚠⚠ **`reserve()` KHÔNG BAO GIỜ TỪ CHỐI ở Pha 1.** Nó trả `wouldRefuse: boolean` để ghi sổ, nhưng luôn cấp giấy phép.
- ⚠ **`reserve()` KHÔNG ĐƯỢC LÀM I/O.** Quyết định đọc sổ trong bộ nhớ. Đầu dò chỉ chạy ở reconciler nền. Có test riêng canh điều này.
- **Ngưỡng lệch khởi điểm: `512 MiB`.** Nhịp đối chiếu khởi điểm: `60 s`. Dự trữ an toàn: `1.024 MiB`. (spec §5.1, §6, §15)
- **`release()` phải BẤT BIẾN khi gọi nhiều lần.** Chứng minh bằng mutation test.
- **Mọi lưới an toàn phải được chứng minh bằng mutation test.** Đợt 2 vừa bắt một test "chống double-release" **xanh cả khi gỡ cờ idempotent**.
- **Assert giá trị chính xác (`toBe`), KHÔNG dùng `<=`.**
- **Bộ đếm giờ phải cách ly được trong test** — Đợt 2 Task 2 đo được `setInterval` unref'd của `aiGateway` **tự bắn, tự kết nối, tự ghi DB test**.
- Trần thiết bị **32.607 MiB**. Số đo nền: Coder-30B **19.077** · 4B **5.534** · embed **2.232** · FIM **2.188** · sidecar **7.825** · ONNX 1 session **+339** · cron **1.251** MiB.
- **Biên nhiễu thật là ±~25 MiB**, không phải ±10. **Nền `nvidia-smi` trôi ~103 MiB/ngày.** Không viết "khớp chính xác".
- Migration kế tiếp: **`drizzle/0310_vram_broker.sql`**. Schema đặt ở `drizzle/schema/vram.ts`, xuất qua `drizzle/schema/index.ts`.
- Test và comment viết **tiếng Việt**.
- ⚠ **KHÔNG dùng `tasklist`** — máy này trả **RỖNG khi có 8 `node.exe` chạy**. Dùng `nvidia-smi` về baseline (~1.070-1.190 MiB) + `netstat -ano | grep -E ":3000|:8081"`.
- ⚠ Sidecar thị giác là tiến trình `llama-server` **RIÊNG** ~7,8 GB, tự tắt sau 10 phút nhàn rỗi — nó thức lúc đo thì **mọi số sai nặng**.
- ⚠ **KHÔNG `git add -A` / `git add -u`** — cây có ~245 mục việc dở của người khác.
- ⚠ `.env` **không git-track** ⇒ `git checkout -- .env` **lỗi im lặng**. Ép biến qua **CLI** (`dotenv` để `override=false` nên CLI thắng).
- ⚠ `git worktree add` **TREO** trên repo này.
- `NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit` — lỗi **tiền tồn tại**: `client/src/pages/SessionManagement.tsx:195`.
- Cổng an toàn: `npm run kb:eval` giữ **151/151**.
- **Không push.**

## Cấu trúc file

| File | Trách nhiệm |
|---|---|
| `server/services/vram/types.ts` | Kiểu dùng chung + `VramRefusedError`. Không logic. |
| `server/services/vram/vramBroker.ts` | Sổ cái + `reserve`/`commit`/`release`/`heartbeat`/`snapshot`. **Không I/O.** |
| `server/services/vram/vramEventLog.ts` | Ghi nhật ký **bất đồng bộ, gom lô**. Cách ly được trong test. |
| `server/services/vram/vramEstimator.ts` | Ước lượng byte: **học từ lịch sử**, lùi về kích thước file, cuối cùng mới tới hằng số. |
| `server/services/vram/vramProbe.ts` | Sự thật thiết bị. Async, có đệm, timeout 3 s. |
| `server/services/vram/vramReconciler.ts` | So sổ vs thật, **báo động khi lệch**. Chạy nền. |
| `drizzle/schema/vram.ts` + `drizzle/0310_vram_broker.sql` | Bảng `vram_events`. |

**Không tạo thư mục `adapters/`** ở pha này: dây nối chỉ là ba lời gọi tại mỗi điểm cấp phát, một file chuyển tiếp sẽ là nhiễu. Pha 3 tách ra khi có chính sách thật.

---

### Task 1: Kiểu + sổ cái broker (chỉ khai báo, không từ chối)

**Files:**
- Create: `server/services/vram/types.ts`
- Create: `server/services/vram/vramBroker.ts`
- Test: `server/services/vram/vramBroker.test.ts`

**Interfaces:**
- Produces: `reserve(req): VramReserveResult` · `commit(lease, actualBytes): void` · `release(lease): void` · `heartbeat(lease): void` · `snapshot(): VramSnapshot` · `__resetBrokerForTests(): void`

- [ ] **Step 1: Viết test đỏ**

Tạo `server/services/vram/vramBroker.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { reserve, commit, release, snapshot, __resetBrokerForTests } from "./vramBroker";

const MIB = 1024 * 1024;

function req(owner: string, bytes: number, priority: "production" | "interactive" | "background" = "interactive") {
  return { owner, kind: "gguf-model" as const, estimatedBytes: bytes, priority };
}

describe("vramBroker — sổ cái", () => {
  beforeEach(() => __resetBrokerForTests());

  it("cấp giấy phép và cộng vào tổng đã cấp", () => {
    const r = reserve(req("gguf:A", 100 * MIB));
    expect(r.lease).not.toBeNull();
    expect(snapshot().totalReservedBytes).toBe(100 * MIB);
  });

  it("commit thay ước lượng bằng SỐ THẬT trong tổng", () => {
    const r = reserve(req("gguf:A", 100 * MIB));
    commit(r.lease!, 137 * MIB);
    expect(snapshot().totalReservedBytes).toBe(137 * MIB);
  });

  it("release trả chỗ", () => {
    const r = reserve(req("gguf:A", 100 * MIB));
    release(r.lease!);
    expect(snapshot().totalReservedBytes).toBe(0);
  });

  it("release HAI LẦN bằng release MỘT LẦN (bất biến)", () => {
    const a = reserve(req("gguf:A", 100 * MIB));
    const b = reserve(req("gguf:B", 50 * MIB));
    release(a.lease!);
    release(a.lease!);
    expect(snapshot().totalReservedBytes).toBe(50 * MIB);
    expect(snapshot().leases.length).toBe(1);
    expect(snapshot().leases[0].request.owner).toBe("gguf:B");
    void b;
  });

  it("PHA 1: KHÔNG BAO GIỜ từ chối, kể cả khi vượt trần", () => {
    reserve(req("gguf:A", 30_000 * MIB));
    const r = reserve(req("gguf:B", 30_000 * MIB));
    expect(r.lease).not.toBeNull();      // vẫn cấp
    expect(r.wouldRefuse).toBe(true);    // nhưng ghi nhận là SẼ từ chối ở Pha 2
  });

  it("wouldPreempt nêu ĐÚNG các giấy phép nền có thể nhường", () => {
    reserve(req("bg:kb-sync", 20_000 * MIB, "background"));
    reserve(req("prod:aoi", 10_000 * MIB, "production"));
    const r = reserve(req("gguf:big", 10_000 * MIB, "interactive"));
    expect(r.wouldRefuse).toBe(true);
    expect(r.wouldPreempt).toEqual(["bg:kb-sync"]);   // KHÔNG được nêu prod:aoi
  });

  it("reserve KHÔNG làm I/O — đầu dò không được gọi", async () => {
    const probe = await import("./vramProbe");
    const spy = vi.spyOn(probe, "readDeviceVram");
    reserve(req("gguf:A", 100 * MIB));
    expect(spy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Chạy test, xác nhận ĐỎ**

```bash
npx vitest run server/services/vram/vramBroker.test.ts
```
Kỳ vọng: **ĐỎ** — `Failed to resolve import "./vramBroker"`. Dán output.

- [ ] **Step 3: Viết `types.ts`**

```ts
/** Mức ưu tiên, xếp theo giá trị thật của nhà máy (spec §5.2). */
export type VramPriority = "production" | "interactive" | "background";

export type VramLeaseKind =
  | "gguf-model"
  | "gguf-context"
  | "gguf-embed-context"
  | "onnx-session"
  | "external-process";

/** Ước lượng đến từ đâu — để truy được chỗ nào còn dùng hằng số cấu hình. */
export type VramEstimateSource = "learned" | "file-size" | "config-default";

export interface VramReserveRequest {
  owner: string;
  kind: VramLeaseKind;
  estimatedBytes: number;
  priority: VramPriority;
  /** Bắt buộc cho external-process: thiếu nhịp quá hạn thì reconciler xác minh rồi thu hồi. */
  ttlMs?: number;
  estimateSource?: VramEstimateSource;
}

export interface VramLease {
  id: string;
  request: VramReserveRequest;
  acquiredAt: Date;
  /** null cho tới khi commit(). */
  actualBytes: number | null;
  lastHeartbeatAt: Date;
  released: boolean;
}

export interface VramReserveResult {
  /** Pha 1 luôn khác null. Pha 2 sẽ trả null kèm ném VramRefusedError. */
  lease: VramLease | null;
  /** Pha 2 SẼ từ chối lượt này không? Ghi vào nhật ký để biết bán kính trước khi bật cưỡng chế. */
  wouldRefuse: boolean;
  /** Owner của các giấy phép mà Pha 2 sẽ thu hồi để lấy chỗ. */
  wouldPreempt: string[];
}

export interface VramSnapshot {
  totalReservedBytes: number;
  leases: VramLease[];
}

/** Từ chối trung thực (Pha 2). Định nghĩa sẵn ở Pha 1 để mặt tiếp xúc ổn định. */
export class VramRefusedError extends Error {
  constructor(
    public readonly requestedBytes: number,
    public readonly availableBytes: number,
    public readonly holders: Array<{ owner: string; bytes: number; priority: VramPriority }>,
  ) {
    super(
      `Không đủ VRAM: xin ${Math.round(requestedBytes / 1024 / 1024)} MiB, ` +
        `còn ${Math.round(availableBytes / 1024 / 1024)} MiB. ` +
        `Đang giữ: ${holders.map((h) => `${h.owner}=${Math.round(h.bytes / 1024 / 1024)}MiB(${h.priority})`).join(", ")}`,
    );
    this.name = "VramRefusedError";
  }
}
```

- [ ] **Step 4: Viết `vramBroker.ts`**

```ts
import type {
  VramLease, VramReserveRequest, VramReserveResult, VramSnapshot, VramPriority,
} from "./types";

/** Trần thiết bị và dự trữ an toàn (spec §5.1). Đọc một lần, không I/O trên đường quyết định. */
const DEVICE_TOTAL_BYTES = Number(process.env.VRAM_DEVICE_TOTAL_MB ?? 32607) * 1024 * 1024;
const SAFETY_RESERVE_BYTES = Number(process.env.VRAM_SAFETY_RESERVE_MB ?? 1024) * 1024 * 1024;

const PRIORITY_RANK: Record<VramPriority, number> = { production: 3, interactive: 2, background: 1 };

const ledger = new Map<string, VramLease>();
let seq = 0;

/** Byte mà một giấy phép đang chiếm: số THẬT nếu đã commit, không thì ước lượng. */
function leaseBytes(l: VramLease): number {
  return l.actualBytes ?? l.request.estimatedBytes;
}

function totalReserved(): number {
  let sum = 0;
  for (const l of ledger.values()) sum += leaseBytes(l);
  return sum;
}

/**
 * Xin chỗ. **Pha 1: KHÔNG BAO GIỜ từ chối** — luôn trả giấy phép.
 * `wouldRefuse`/`wouldPreempt` là phán quyết BÓNG của Pha 2, chỉ để ghi sổ.
 * ⚠ Hàm này KHÔNG được làm I/O: quyết định đọc sổ trong bộ nhớ.
 */
export function reserve(request: VramReserveRequest): VramReserveResult {
  const headroom = DEVICE_TOTAL_BYTES - SAFETY_RESERVE_BYTES - totalReserved();
  const wouldRefuse = request.estimatedBytes > headroom;

  const wouldPreempt: string[] = [];
  if (wouldRefuse) {
    // Chỉ nhường được: mức THẤP HƠN mức đang xin, và đang không dùng (chưa commit thì coi là đang bận).
    const rank = PRIORITY_RANK[request.priority];
    const candidates = [...ledger.values()]
      .filter((l) => PRIORITY_RANK[l.request.priority] < rank)
      .sort((a, b) => a.acquiredAt.getTime() - b.acquiredAt.getTime());
    let freed = 0;
    for (const c of candidates) {
      if (freed >= request.estimatedBytes - headroom) break;
      wouldPreempt.push(c.request.owner);
      freed += leaseBytes(c);
    }
  }

  const lease: VramLease = {
    id: `lease-${++seq}`,
    request,
    acquiredAt: new Date(),
    actualBytes: null,
    lastHeartbeatAt: new Date(),
    released: false,
  };
  ledger.set(lease.id, lease);
  return { lease, wouldRefuse, wouldPreempt };
}

/** Ghi số THẬT sau khi cấp phát xong. Đây là nguồn của "harness tự sinh" (spec §7). */
export function commit(lease: VramLease, actualBytes: number): void {
  const live = ledger.get(lease.id);
  if (!live || live.released) return;
  live.actualBytes = actualBytes;
  live.lastHeartbeatAt = new Date();
}

/**
 * Trả chỗ. **BẤT BIẾN khi gọi nhiều lần** — cờ `released` là thứ bảo đảm điều đó.
 * ⚠ Gỡ cờ này ra thì test "release HAI LẦN" phải ĐỎ. Nếu nó vẫn xanh, test là lưới giả.
 */
export function release(lease: VramLease): void {
  const live = ledger.get(lease.id);
  if (!live || live.released) return;
  live.released = true;
  ledger.delete(lease.id);
}

export function heartbeat(lease: VramLease): void {
  const live = ledger.get(lease.id);
  if (live && !live.released) live.lastHeartbeatAt = new Date();
}

export function snapshot(): VramSnapshot {
  return { totalReservedBytes: totalReserved(), leases: [...ledger.values()] };
}

/** Chỉ dùng trong test. */
export function __resetBrokerForTests(): void {
  ledger.clear();
  seq = 0;
}
```

- [ ] **Step 5: Tạo `vramProbe.ts` tối thiểu để test import được**

```ts
/** Sự thật thiết bị. Task 3 sẽ viết đầy đủ. */
export async function readDeviceVram(): Promise<{ usedBytes: number; totalBytes: number } | null> {
  return null;
}
```

- [ ] **Step 6: Chạy test XANH**

```bash
npx vitest run server/services/vram/vramBroker.test.ts
NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit
```

- [ ] **Step 7: Mutation test — chứng minh lưới an toàn KHÔNG giả**

Tạm bỏ `live.released = true;` trong `release()`, chạy lại test.
Kỳ vọng: test *"release HAI LẦN bằng release MỘT LẦN"* **ĐỎ**. Dán output. Khôi phục, xác nhận `git diff` sạch.

⚠ Nếu nó **vẫn xanh** thì test là **lưới giả** — sửa test, đừng bỏ qua.

- [ ] **Step 8: Commit**

```bash
git add server/services/vram/types.ts server/services/vram/vramBroker.ts server/services/vram/vramProbe.ts server/services/vram/vramBroker.test.ts
git commit -m "feat(vram/pha1-1): sổ cái broker — chỉ khai báo, không từ chối"
```

---

### Task 2: Bảng `vram_events` + bộ ghi nhật ký bất đồng bộ

**Files:**
- Create: `drizzle/schema/vram.ts`
- Create: `drizzle/0310_vram_broker.sql`
- Modify: `drizzle/schema/index.ts`
- Create: `server/services/vram/vramEventLog.ts`
- Test: `server/services/vram/vramEventLog.test.ts`

**Interfaces:**
- Consumes: `VramLease`, `VramEstimateSource` từ `./types` (Task 1)
- Produces: `logVramEvent(e: VramEventInput): void` (không chờ) · `flushVramEvents(): Promise<number>` · `__setVramLogTimerEnabled(on: boolean): void`

- [ ] **Step 1: Viết test đỏ**

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";

describe("vramEventLog — ghi bất đồng bộ, cách ly được", () => {
  beforeEach(() => vi.resetModules());

  it("logVramEvent KHÔNG chờ DB — trả về ngay, chưa ghi gì", async () => {
    const insert = vi.fn();
    vi.doMock("../../db/connection", () => ({
      getDb: async () => ({ insert: () => ({ values: insert }) }),
    }));
    const { logVramEvent, __setVramLogTimerEnabled } = await import("./vramEventLog");
    __setVramLogTimerEnabled(false);
    logVramEvent({ event: "reserve", owner: "gguf:A", leaseKind: "gguf-model", priority: "interactive", estimatedBytes: 1024 });
    expect(insert).not.toHaveBeenCalled();
  });

  it("flush ghi hết hàng đợi rồi dọn", async () => {
    const insert = vi.fn(async () => undefined);
    vi.doMock("../../db/connection", () => ({
      getDb: async () => ({ insert: () => ({ values: insert }) }),
    }));
    const { logVramEvent, flushVramEvents, __setVramLogTimerEnabled } = await import("./vramEventLog");
    __setVramLogTimerEnabled(false);
    logVramEvent({ event: "reserve", owner: "gguf:A", leaseKind: "gguf-model", priority: "interactive", estimatedBytes: 1024 });
    logVramEvent({ event: "commit", owner: "gguf:A", leaseKind: "gguf-model", priority: "interactive", actualBytes: 2048 });
    expect(await flushVramEvents()).toBe(2);
    expect(insert).toHaveBeenCalledTimes(1);      // gom LÔ, không phải 2 lượt
    expect(await flushVramEvents()).toBe(0);      // đã dọn
  });

  it("BỘ ĐẾM GIỜ TẮT ĐƯỢC — không có timer nào sống sau khi tắt", async () => {
    const { __setVramLogTimerEnabled, __hasVramLogTimer } = await import("./vramEventLog");
    __setVramLogTimerEnabled(true);
    expect(__hasVramLogTimer()).toBe(true);
    __setVramLogTimerEnabled(false);
    expect(__hasVramLogTimer()).toBe(false);
  });

  it("DB hỏng KHÔNG được làm ngã người gọi", async () => {
    vi.doMock("../../db/connection", () => ({ getDb: async () => { throw new Error("db down"); } }));
    const { logVramEvent, flushVramEvents, __setVramLogTimerEnabled } = await import("./vramEventLog");
    __setVramLogTimerEnabled(false);
    logVramEvent({ event: "reserve", owner: "gguf:A", leaseKind: "gguf-model", priority: "interactive" });
    await expect(flushVramEvents()).resolves.toBe(0);
  });
});
```

- [ ] **Step 2: Chạy, xác nhận ĐỎ**

```bash
npx vitest run server/services/vram/vramEventLog.test.ts
```
Dán output đỏ.

- [ ] **Step 3: Viết schema `drizzle/schema/vram.ts`**

```ts
import { pgTable, serial, varchar, bigint, jsonb, timestamp, index } from "drizzle-orm/pg-core";

/**
 * Nhật ký chỉ-ghi-thêm cho module điều phối VRAM.
 * Sổ cái SỐNG nằm trong bộ nhớ tiến trình; bảng này là LỊCH SỬ —
 * cho Agent đọc (pha 4) và là dữ liệu trả lời Ư7 (bí ẩn CUDA).
 */
export const vramEvents = pgTable("vram_events", {
  id: serial("id").primaryKey(),
  // Luôn "vram" ở pha này. Một CỘT để sau thêm ram/cpu/disk, KHÔNG phải một framework.
  resourceKind: varchar("resourceKind", { length: 16 }).default("vram").notNull(),
  // reserve | commit | release | refuse | preempt | drift | adopt | defer | defer_exceeded
  event: varchar("event", { length: 24 }).notNull(),
  owner: varchar("owner", { length: 160 }).notNull(),
  leaseKind: varchar("leaseKind", { length: 32 }).notNull(),
  priority: varchar("priority", { length: 16 }).notNull(),
  estimatedBytes: bigint("estimatedBytes", { mode: "number" }),
  actualBytes: bigint("actualBytes", { mode: "number" }),
  // learned | file-size | config-default — truy được chỗ nào còn dùng hằng số.
  estimateSource: varchar("estimateSource", { length: 16 }),
  deviceUsedBytes: bigint("deviceUsedBytes", { mode: "number" }),
  ledgerTotalBytes: bigint("ledgerTotalBytes", { mode: "number" }),
  driftBytes: bigint("driftBytes", { mode: "number" }),
  // Pha 1: phán quyết BÓNG của Pha 2 — để biết bán kính trước khi bật cưỡng chế.
  wouldRefuse: varchar("wouldRefuse", { length: 8 }),
  detail: jsonb("detail"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => [
  index("vram_events_created_idx").on(table.createdAt),
  index("vram_events_owner_idx").on(table.owner),
]);
```

Thêm vào `drizzle/schema/index.ts`:

```ts
export * from "./vram";
```

- [ ] **Step 4: Viết migration `drizzle/0310_vram_broker.sql`**

```sql
CREATE TABLE IF NOT EXISTS "vram_events" (
  "id" serial PRIMARY KEY NOT NULL,
  "resourceKind" varchar(16) DEFAULT 'vram' NOT NULL,
  "event" varchar(24) NOT NULL,
  "owner" varchar(160) NOT NULL,
  "leaseKind" varchar(32) NOT NULL,
  "priority" varchar(16) NOT NULL,
  "estimatedBytes" bigint,
  "actualBytes" bigint,
  "estimateSource" varchar(16),
  "deviceUsedBytes" bigint,
  "ledgerTotalBytes" bigint,
  "driftBytes" bigint,
  "wouldRefuse" varchar(8),
  "detail" jsonb,
  "createdAt" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "vram_events_created_idx" ON "vram_events" ("createdAt");
CREATE INDEX IF NOT EXISTS "vram_events_owner_idx" ON "vram_events" ("owner");
```

⚠ Chạy migration bằng **owner `aoi`** (`avi_app` không có quyền DDL, lỗi `42501`).

- [ ] **Step 5: Viết `vramEventLog.ts`**

```ts
import type { VramEstimateSource, VramLeaseKind, VramPriority } from "./types";

export interface VramEventInput {
  event: string;
  owner: string;
  leaseKind: VramLeaseKind;
  priority: VramPriority;
  estimatedBytes?: number;
  actualBytes?: number;
  estimateSource?: VramEstimateSource;
  deviceUsedBytes?: number;
  ledgerTotalBytes?: number;
  driftBytes?: number;
  wouldRefuse?: boolean;
  detail?: Record<string, unknown>;
}

const FLUSH_MS = Number(process.env.VRAM_LOG_FLUSH_MS ?? 5000);
const QUEUE_MAX = Number(process.env.VRAM_LOG_QUEUE_MAX ?? 5000);

let queue: VramEventInput[] = [];
let timer: NodeJS.Timeout | null = null;

/** Xếp hàng rồi trả về NGAY. Không bao giờ chờ DB — đây nằm cạnh đường cấp phát. */
export function logVramEvent(e: VramEventInput): void {
  if (queue.length >= QUEUE_MAX) return;   // thà mất telemetry còn hơn phình bộ nhớ
  queue.push(e);
}

export async function flushVramEvents(): Promise<number> {
  if (queue.length === 0) return 0;
  const batch = queue;
  queue = [];
  try {
    const { getDb } = await import("../../db/connection");
    const db = await getDb();
    if (!db) return 0;
    const { vramEvents } = await import("../../../drizzle/schema/vram");
    await db.insert(vramEvents).values(
      batch.map((e) => ({
        event: e.event,
        owner: e.owner,
        leaseKind: e.leaseKind,
        priority: e.priority,
        estimatedBytes: e.estimatedBytes ?? null,
        actualBytes: e.actualBytes ?? null,
        estimateSource: e.estimateSource ?? null,
        deviceUsedBytes: e.deviceUsedBytes ?? null,
        ledgerTotalBytes: e.ledgerTotalBytes ?? null,
        driftBytes: e.driftBytes ?? null,
        wouldRefuse: e.wouldRefuse === undefined ? null : String(e.wouldRefuse),
        detail: e.detail ?? null,
      })),
    );
    return batch.length;
  } catch (err) {
    console.warn(`[vram] không ghi được ${batch.length} sự kiện: ${(err as Error)?.message ?? err}`);
    return 0;
  }
}

/**
 * ⚠ BÀI HỌC ĐỢT 2 TASK 2: `setInterval` unref'd của aiGateway RÒ vào bộ test,
 * tự bắn, tự kết nối và TỰ GHI DB TEST. Bộ đếm giờ ở đây phải TẮT ĐƯỢC tường minh.
 */
export function __setVramLogTimerEnabled(on: boolean): void {
  if (on && !timer) {
    timer = setInterval(() => { void flushVramEvents(); }, FLUSH_MS);
    timer.unref?.();
  } else if (!on && timer) {
    clearInterval(timer);
    timer = null;
  }
}

export function __hasVramLogTimer(): boolean {
  return timer !== null;
}
```

- [ ] **Step 6: Chạy test XANH + áp migration**

```bash
npx vitest run server/services/vram/vramEventLog.test.ts
NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit
```

⚠ Áp migration lên **cả** DB chính **và** DB test `aoi_management_test` — bài học Wave 4: không áp riêng thì test "xanh rỗng".

- [ ] **Step 7: Commit**

```bash
git add drizzle/schema/vram.ts drizzle/schema/index.ts drizzle/0310_vram_broker.sql server/services/vram/vramEventLog.ts server/services/vram/vramEventLog.test.ts
git commit -m "feat(vram/pha1-2): bảng vram_events + bộ ghi bất đồng bộ, tắt được timer"
```

---

### Task 3: Đầu dò thiết bị + bộ ước lượng tự học

**Files:**
- Create (viết đầy đủ, thay bản tối thiểu ở Task 1): `server/services/vram/vramProbe.ts`
- Create: `server/services/vram/vramEstimator.ts`
- Test: `server/services/vram/vramProbe.test.ts`, `server/services/vram/vramEstimator.test.ts`

**Interfaces:**
- Produces: `readDeviceVram(): Promise<{usedBytes, totalBytes} | null>` · `estimateBytesFor(owner, opts): Promise<{bytes, source}>` · `recordActual(owner, bytes): void`

- [ ] **Step 1: Viết test đỏ cho đầu dò**

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";

describe("vramProbe", () => {
  beforeEach(() => vi.resetModules());

  it("dùng getVramState native khi có", async () => {
    vi.doMock("./llamaHandle", () => ({
      getLlamaInstanceIfReady: () => ({ getVramState: async () => ({ used: 5, total: 10 }) }),
    }));
    const { readDeviceVram, __clearProbeCache } = await import("./vramProbe");
    __clearProbeCache();
    expect(await readDeviceVram()).toEqual({ usedBytes: 5, totalBytes: 10 });
  });

  it("lùi về nvidia-smi khi không có native", async () => {
    vi.doMock("./llamaHandle", () => ({ getLlamaInstanceIfReady: () => null }));
    vi.doMock("child_process", () => ({
      execFile: (_c: unknown, _a: unknown, _o: unknown, cb: (e: null, r: { stdout: string }) => void) =>
        cb(null, { stdout: "1200, 32607\n" }),
    }));
    const { readDeviceVram, __clearProbeCache } = await import("./vramProbe");
    __clearProbeCache();
    const v = await readDeviceVram();
    expect(v!.usedBytes).toBe(1200 * 1024 * 1024);
    expect(v!.totalBytes).toBe(32607 * 1024 * 1024);
  });

  it("KHÔNG có GPU thì trả null — KHÔNG được ném", async () => {
    vi.doMock("./llamaHandle", () => ({ getLlamaInstanceIfReady: () => null }));
    vi.doMock("child_process", () => ({
      execFile: (_c: unknown, _a: unknown, _o: unknown, cb: (e: Error) => void) => cb(new Error("ENOENT")),
    }));
    const { readDeviceVram, __clearProbeCache } = await import("./vramProbe");
    __clearProbeCache();
    expect(await readDeviceVram()).toBeNull();
  });

  it("có ĐỆM — hai lượt liên tiếp chỉ gọi nvidia-smi MỘT lần", async () => {
    const exec = vi.fn((_c: unknown, _a: unknown, _o: unknown, cb: (e: null, r: { stdout: string }) => void) =>
      cb(null, { stdout: "1200, 32607\n" }));
    vi.doMock("./llamaHandle", () => ({ getLlamaInstanceIfReady: () => null }));
    vi.doMock("child_process", () => ({ execFile: exec }));
    const { readDeviceVram, __clearProbeCache } = await import("./vramProbe");
    __clearProbeCache();
    await readDeviceVram();
    await readDeviceVram();
    expect(exec).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Viết test đỏ cho bộ ước lượng**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { estimateBytesFor, recordActual, __resetEstimatorForTests } from "./vramEstimator";

const MIB = 1024 * 1024;

describe("vramEstimator — tự học, thôi phụ thuộc hằng số", () => {
  beforeEach(() => __resetEstimatorForTests());

  it("chưa biết gì thì lùi về kích thước file, nguồn = file-size", async () => {
    const r = await estimateBytesFor("gguf:A", { fileBytes: 400 * MIB });
    expect(r.bytes).toBe(400 * MIB);
    expect(r.source).toBe("file-size");
  });

  it("không có file thì dùng hằng số cấu hình, nguồn = config-default", async () => {
    const r = await estimateBytesFor("sidecar:vision", { configDefaultBytes: 8192 * MIB });
    expect(r.bytes).toBe(8192 * MIB);
    expect(r.source).toBe("config-default");
  });

  it("SAU một lượt đo thật thì DÙNG SỐ THẬT, nguồn = learned", async () => {
    recordActual("gguf:A", 19_077 * MIB);
    const r = await estimateBytesFor("gguf:A", { fileBytes: 400 * MIB });
    expect(r.bytes).toBe(19_077 * MIB);
    expect(r.source).toBe("learned");
  });

  it("số thật MỚI thắng số thật CŨ", async () => {
    recordActual("gguf:A", 19_077 * MIB);
    recordActual("gguf:A", 19_071 * MIB);
    expect((await estimateBytesFor("gguf:A", {})).bytes).toBe(19_071 * MIB);
  });
});
```

- [ ] **Step 3: Chạy cả hai, xác nhận ĐỎ**

```bash
npx vitest run server/services/vram/vramProbe.test.ts server/services/vram/vramEstimator.test.ts
```
Dán output đỏ.

- [ ] **Step 4: Viết `llamaHandle.ts` (cầu nhỏ để test mock được)**

```ts
/**
 * Cầu nối tới thể hiện llama đang sống, tách riêng để đầu dò mock được trong test
 * mà không phải nạp cả aiGgufEngine (2.712 dòng).
 */
let handle: { getVramState?: () => Promise<{ used: number; total: number }> } | null = null;

export function setLlamaInstanceHandle(h: typeof handle): void { handle = h; }
export function getLlamaInstanceIfReady(): typeof handle { return handle; }
```

- [ ] **Step 5: Viết `vramProbe.ts` đầy đủ**

```ts
import { getLlamaInstanceIfReady } from "./llamaHandle";

const CACHE_MS = Number(process.env.VRAM_PROBE_CACHE_MS ?? 5000);
let cached: { at: number; value: { usedBytes: number; totalBytes: number } | null } | null = null;

/**
 * Sự thật thiết bị. ⚠ CHỈ gọi từ reconciler NỀN — KHÔNG BAO GIỜ từ đường cấp phát.
 * `nvidia-smi` mất tới ~3 s; comment aiGgufEngine.ts:372 ghi rằng bản ĐỒNG BỘ
 * từng ĐÓNG BĂNG toàn bộ xử lý request.
 */
export async function readDeviceVram(): Promise<{ usedBytes: number; totalBytes: number } | null> {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;

  const llama = getLlamaInstanceIfReady();
  if (llama && typeof llama.getVramState === "function") {
    try {
      const v = await llama.getVramState();
      if (v && v.total > 0) {
        cached = { at: Date.now(), value: { usedBytes: v.used, totalBytes: v.total } };
        return cached.value;
      }
    } catch { /* lùi về nvidia-smi */ }
  }

  try {
    const { execFile } = await import("child_process");
    const { promisify } = await import("util");
    const { stdout } = await promisify(execFile)(
      "nvidia-smi",
      ["--query-gpu=memory.used,memory.total", "--format=csv,noheader,nounits"],
      { timeout: 3000, windowsHide: true },
    );
    const line = String(stdout).split(/\r?\n/).find((l) => l.trim().length > 0) ?? "";
    const [used, total] = line.split(",").map((s) => parseInt(s.trim(), 10));
    if (Number.isFinite(used) && Number.isFinite(total) && total > 0) {
      cached = { at: Date.now(), value: { usedBytes: used * 1024 * 1024, totalBytes: total * 1024 * 1024 } };
      return cached.value;
    }
  } catch { /* máy không có GPU — telemetry vắng, KHÔNG phải lỗi */ }

  cached = { at: Date.now(), value: null };
  return null;
}

export function __clearProbeCache(): void { cached = null; }
```

- [ ] **Step 6: Viết `vramEstimator.ts`**

```ts
import type { VramEstimateSource } from "./types";

/** Số THẬT gần nhất đã quan sát cho mỗi owner. Đây là thứ làm harness tự sinh (spec §7). */
const learned = new Map<string, number>();

export function recordActual(owner: string, bytes: number): void {
  if (bytes > 0) learned.set(owner, bytes);
}

/**
 * Ba nấc, theo thứ tự tin cậy giảm dần:
 *   1. learned      — đã đo thật lượt trước ⇒ dùng luôn
 *   2. file-size    — kích thước file trên đĩa, xấp xỉ trọng số
 *   3. config-default — hằng số. ⚠ Cảnh báo, vì đây chính là thứ đã trôi 4 lần.
 */
export async function estimateBytesFor(
  owner: string,
  opts: { fileBytes?: number; configDefaultBytes?: number },
): Promise<{ bytes: number; source: VramEstimateSource }> {
  const known = learned.get(owner);
  if (known !== undefined) return { bytes: known, source: "learned" };
  if (opts.fileBytes !== undefined) return { bytes: opts.fileBytes, source: "file-size" };
  if (opts.configDefaultBytes !== undefined) {
    console.warn(`[vram] "${owner}" đang dùng HẰNG SỐ cấu hình — chưa có số đo thật.`);
    return { bytes: opts.configDefaultBytes, source: "config-default" };
  }
  return { bytes: 0, source: "config-default" };
}

export function __resetEstimatorForTests(): void { learned.clear(); }
```

- [ ] **Step 7: Chạy XANH + commit**

```bash
npx vitest run server/services/vram/
NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit
git add server/services/vram/vramProbe.ts server/services/vram/vramEstimator.ts server/services/vram/llamaHandle.ts server/services/vram/vramProbe.test.ts server/services/vram/vramEstimator.test.ts
git commit -m "feat(vram/pha1-3): đầu dò thiết bị có đệm + bộ ước lượng tự học ba nấc"
```

---

### Task 4: Đối chiếu và báo động — phần giá trị nhất của Pha 1

**Files:**
- Create: `server/services/vram/vramReconciler.ts`
- Test: `server/services/vram/vramReconciler.test.ts`

**Interfaces:**
- Consumes: `snapshot()` (Task 1) · `readDeviceVram()` (Task 3) · `logVramEvent()` (Task 2)
- Produces: `reconcileOnce(): Promise<VramReconcileResult>` · `startVramReconciler(): void` · `stopVramReconciler(): void` · `__hasReconcilerTimer(): boolean`

- [ ] **Step 1: Viết test đỏ**

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";

const MIB = 1024 * 1024;

describe("vramReconciler — bắt kẻ cấp phát không xin phép", () => {
  beforeEach(() => vi.resetModules());

  it("★ TEST QUAN TRỌNG NHẤT PHA 1: có kẻ cấp phát ngoài sổ ⇒ PHẢI báo động", async () => {
    // Sổ nói 20 GB. Thiết bị nói 28 GB. Lệch 8 GB = sidecar không xin phép.
    vi.doMock("./vramBroker", () => ({
      snapshot: () => ({ totalReservedBytes: 20_000 * MIB, leases: [] }),
    }));
    vi.doMock("./vramProbe", () => ({
      readDeviceVram: async () => ({ usedBytes: 28_000 * MIB, totalBytes: 32_607 * MIB }),
    }));
    const logged: Array<{ event: string; driftBytes?: number }> = [];
    vi.doMock("./vramEventLog", () => ({ logVramEvent: (e: { event: string; driftBytes?: number }) => logged.push(e) }));

    const { reconcileOnce } = await import("./vramReconciler");
    const r = await reconcileOnce();

    expect(r.driftBytes).toBe(8_000 * MIB);
    expect(r.alarm).toBe(true);
    expect(logged.map((l) => l.event)).toContain("drift");
  });

  it("lệch NHỎ hơn ngưỡng thì KHÔNG báo động (biên nhiễu ±25 MiB, nền trôi ~103 MiB/ngày)", async () => {
    vi.doMock("./vramBroker", () => ({ snapshot: () => ({ totalReservedBytes: 20_000 * MIB, leases: [] }) }));
    vi.doMock("./vramProbe", () => ({
      readDeviceVram: async () => ({ usedBytes: 20_100 * MIB, totalBytes: 32_607 * MIB }),
    }));
    vi.doMock("./vramEventLog", () => ({ logVramEvent: () => {} }));
    const { reconcileOnce } = await import("./vramReconciler");
    const r = await reconcileOnce();
    expect(r.driftBytes).toBe(100 * MIB);
    expect(r.alarm).toBe(false);
  });

  it("đầu dò trả null (máy không GPU) ⇒ IM LẶNG bỏ qua, KHÔNG báo động giả", async () => {
    vi.doMock("./vramBroker", () => ({ snapshot: () => ({ totalReservedBytes: 20_000 * MIB, leases: [] }) }));
    vi.doMock("./vramProbe", () => ({ readDeviceVram: async () => null }));
    vi.doMock("./vramEventLog", () => ({ logVramEvent: () => {} }));
    const { reconcileOnce } = await import("./vramReconciler");
    const r = await reconcileOnce();
    expect(r.alarm).toBe(false);
    expect(r.driftBytes).toBeNull();
  });

  it("bộ đếm giờ TẮT ĐƯỢC", async () => {
    vi.doMock("./vramBroker", () => ({ snapshot: () => ({ totalReservedBytes: 0, leases: [] }) }));
    vi.doMock("./vramProbe", () => ({ readDeviceVram: async () => null }));
    vi.doMock("./vramEventLog", () => ({ logVramEvent: () => {} }));
    const { startVramReconciler, stopVramReconciler, __hasReconcilerTimer } = await import("./vramReconciler");
    startVramReconciler();
    expect(__hasReconcilerTimer()).toBe(true);
    stopVramReconciler();
    expect(__hasReconcilerTimer()).toBe(false);
  });
});
```

- [ ] **Step 2: Chạy, xác nhận ĐỎ.** Dán output.

- [ ] **Step 3: Viết `vramReconciler.ts`**

```ts
import { snapshot } from "./vramBroker";
import { readDeviceVram } from "./vramProbe";
import { logVramEvent } from "./vramEventLog";

const DRIFT_THRESHOLD_BYTES = Number(process.env.VRAM_DRIFT_THRESHOLD_MB ?? 512) * 1024 * 1024;
const INTERVAL_MS = Number(process.env.VRAM_RECONCILE_INTERVAL_MS ?? 60_000);

export interface VramReconcileResult {
  driftBytes: number | null;
  alarm: boolean;
  ledgerTotalBytes: number;
  deviceUsedBytes: number | null;
}

let timer: NodeJS.Timeout | null = null;

/**
 * So sổ với thiết bị. Lệch quá ngưỡng ⇒ có kẻ cấp phát KHÔNG XIN PHÉP.
 *
 * Đây là phần giá trị nhất của Pha 1: sidecar 7,8 GB (Đợt 0), ONNX +339 và
 * cron +1.251 (Đợt 2) — cả ba từng cần một lượt review TOÀN NHÁNH mới lộ ra.
 * Với hàm này chúng lộ trong vài phút.
 */
export async function reconcileOnce(): Promise<VramReconcileResult> {
  const snap = snapshot();
  const device = await readDeviceVram();

  // Đầu dò hỏng hoặc máy không GPU ⇒ IM LẶNG bỏ qua.
  // KHÔNG được biến máy không-GPU thành máy báo động liên tục (spec §11).
  if (!device) {
    return { driftBytes: null, alarm: false, ledgerTotalBytes: snap.totalReservedBytes, deviceUsedBytes: null };
  }

  const drift = device.usedBytes - snap.totalReservedBytes;
  const alarm = Math.abs(drift) > DRIFT_THRESHOLD_BYTES;

  if (alarm) {
    const mib = (b: number) => Math.round(b / 1024 / 1024);
    console.warn(
      `[vram] LỆCH ${mib(drift)} MiB — sổ ${mib(snap.totalReservedBytes)}, thiết bị ${mib(device.usedBytes)}. ` +
        `Có hộ tiêu thụ cấp phát KHÔNG XIN PHÉP. Đang giữ: ` +
        (snap.leases.map((l) => `${l.request.owner}=${mib(l.actualBytes ?? l.request.estimatedBytes)}`).join(", ") || "(sổ rỗng)"),
    );
    logVramEvent({
      event: "drift",
      owner: "reconciler",
      leaseKind: "external-process",
      priority: "background",
      deviceUsedBytes: device.usedBytes,
      ledgerTotalBytes: snap.totalReservedBytes,
      driftBytes: drift,
      // Ảnh chụp TOÀN BỘ sổ lúc lệch — đây là dữ liệu Ư7 cần.
      detail: {
        leases: snap.leases.map((l) => ({
          owner: l.request.owner,
          kind: l.request.kind,
          priority: l.request.priority,
          bytes: l.actualBytes ?? l.request.estimatedBytes,
          committed: l.actualBytes !== null,
        })),
      },
    });
  }

  return { driftBytes: drift, alarm, ledgerTotalBytes: snap.totalReservedBytes, deviceUsedBytes: device.usedBytes };
}

export function startVramReconciler(): void {
  if (timer) return;
  timer = setInterval(() => { void reconcileOnce(); }, INTERVAL_MS);
  timer.unref?.();
}

export function stopVramReconciler(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}

export function __hasReconcilerTimer(): boolean { return timer !== null; }
```

- [ ] **Step 4: Chạy XANH**

```bash
npx vitest run server/services/vram/
```

- [ ] **Step 5: Mutation test — chứng minh báo động KHÔNG giả**

Tạm đổi `const alarm = Math.abs(drift) > DRIFT_THRESHOLD_BYTES;` thành `const alarm = false;`, chạy lại.
Kỳ vọng: test *"★ TEST QUAN TRỌNG NHẤT PHA 1"* **ĐỎ**. Dán output. Khôi phục, xác nhận `git diff` sạch.

- [ ] **Step 6: Commit**

```bash
git add server/services/vram/vramReconciler.ts server/services/vram/vramReconciler.test.ts
git commit -m "feat(vram/pha1-4): đối chiếu sổ vs thiết bị — báo động kẻ cấp phát không xin phép"
```

---

### Task 5: Nối SÁU hộ tiêu thụ trong tiến trình (chỉ khai báo)

**Files:**
- Modify: `server/services/aiGgufEngine.ts` — `loadGgufModel` (quanh `:690-720`), `getEmbeddingContext`, `ensureTextContext`
- Modify: `server/services/aiInferenceEngine.ts` — `getSession` (`:106`)
- Modify: `server/services/ai/ocrService.ts` — `getOnnxSession` (quanh `:296-317`)
- Modify: `server/services/aiReranker.ts` — `llama.loadModel` (`:361`)
- Test: `server/services/vram/wiring.inprocess.test.ts`

**Interfaces:**
- Consumes: `reserve/commit/release` (Task 1) · `estimateBytesFor/recordActual` (Task 3) · `logVramEvent` (Task 2)

⚠⚠ **KHÔNG đổi một hành vi nào.** `enforceVramGuard()`, `ensureCapacity()`, `evictLRU()` **vẫn chạy y nguyên**. Chỉ **thêm** ba lời gọi quanh mỗi điểm cấp phát.

⚠ **`aiReranker.ts:361` là hộ tiêu thụ THỨ SÁU** — nó gọi **thẳng** `llama.loadModel`, **không** qua `loadGgufModel`, nên **vô hình với `loadedModels` và `evictLRU`**. Hôm nay 0 MiB chỉ vì `RAG_RERANKER_GPU=false`. **Phải nối.**

- [ ] **Step 1: Viết test đỏ**

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { snapshot, __resetBrokerForTests } from "./vramBroker";

describe("dây nối trong tiến trình — mỗi điểm cấp phát để lại một giấy phép", () => {
  beforeEach(() => { __resetBrokerForTests(); vi.resetModules(); });

  it("loadGgufModel ghi giấy phép gguf-model kèm số THẬT sau khi nạp", async () => {
    vi.doMock("fs", () => ({
      existsSync: () => true,
      statSync: () => ({ size: 400 * 1024 * 1024 }),
      readFileSync: () => "",
      default: { existsSync: () => true, statSync: () => ({ size: 400 * 1024 * 1024 }), readFileSync: () => "" },
    }));
    vi.doMock("node-llama-cpp", () => ({
      getLlama: async () => ({
        loadModel: async () => ({
          createContext: async () => ({ dispose: async () => {} }),
          dispose: async () => {},
        }),
      }),
    }));
    const { loadGgufModel } = await import("../aiGgufEngine");
    await loadGgufModel({ modelPath: "Qwen3-Test.gguf" } as never);

    const owners = snapshot().leases.map((l) => l.request.owner);
    expect(owners.some((o) => o.startsWith("gguf:"))).toBe(true);
  });

  it("aiReranker (hộ tiêu thụ THỨ SÁU) cũng ghi giấy phép", async () => {
    vi.doMock("node-llama-cpp", () => ({
      getLlama: async () => ({ loadModel: async () => ({ dispose: async () => {} }) }),
    }));
    const { __loadRerankerModelForTests } = await import("../aiReranker");
    await __loadRerankerModelForTests();
    expect(snapshot().leases.some((l) => l.request.owner.startsWith("reranker:"))).toBe(true);
  });
});
```

⚠ Tên hàm và hình dạng mock ở trên **có thể SAI** — đọc mã thật rồi **sửa test cho khớp**, đừng sửa mã sản xuất cho khớp test. Xem `server/services/aiGgufEngine.embedNoTextCtx.test.ts` để lấy đúng quy ước mock của file này (đặc biệt **phải `vi.mock("fs")`**, nếu không `resolveModelPath()` ném trước khi chạm đích).

⚠ Nếu test viết xong mà **xanh ngay**, mock chưa chạm đúng chỗ — **sửa mock, đừng bỏ qua**.

⚠ `aiReranker` hiện **không xuất** hàm nạp riêng. Thêm một lối vào chỉ-cho-test (`__loadRerankerModelForTests`) **hoặc** đổi test sang gọi đường công khai — **chọn cách nào thì ghi rõ lý do trong báo cáo**.

- [ ] **Step 2: Chạy, xác nhận ĐỎ.** Dán output.

- [ ] **Step 3: Nối `loadGgufModel`**

Ngay **trước** `llama.loadModel(...)`:

```ts
// Pha 1 — CHỈ KHAI BÁO. Không đổi hành vi: enforceVramGuard/ensureCapacity vẫn chạy y nguyên.
const { reserve, commit, release } = await import("./vram/vramBroker");
const { estimateBytesFor, recordActual } = await import("./vram/vramEstimator");
const { logVramEvent } = await import("./vram/vramEventLog");
const vramOwner = `gguf:${modelId}`;
let fileBytes: number | undefined;
try { fileBytes = (await import("fs")).statSync(resolvedPath).size; } catch { /* không đọc được kích thước */ }
const est = await estimateBytesFor(vramOwner, { fileBytes });
const vramRes = reserve({
  owner: vramOwner,
  kind: "gguf-model",
  estimatedBytes: est.bytes,
  priority: "interactive",
  estimateSource: est.source,
});
logVramEvent({
  event: "reserve", owner: vramOwner, leaseKind: "gguf-model", priority: "interactive",
  estimatedBytes: est.bytes, estimateSource: est.source, wouldRefuse: vramRes.wouldRefuse,
  detail: { wouldPreempt: vramRes.wouldPreempt },
});
```

Ngay **sau** khi nạp xong (đo delta bằng đầu dò, **ngoài** đường quyết định):

```ts
// Ghi số THẬT — đây là nguồn làm harness tự sinh, thay cho bench.mjs (đã trôi 4 lần).
try {
  const { readDeviceVram, __clearProbeCache } = await import("./vram/vramProbe");
  __clearProbeCache();
  const after = await readDeviceVram();
  if (after && vramBefore) {
    const actual = after.usedBytes - vramBefore.usedBytes;
    if (actual > 0) {
      commit(vramRes.lease!, actual);
      recordActual(vramOwner, actual);
      logVramEvent({
        event: "commit", owner: vramOwner, leaseKind: "gguf-model", priority: "interactive",
        estimatedBytes: est.bytes, actualBytes: actual, estimateSource: est.source,
        deviceUsedBytes: after.usedBytes,
      });
    }
  }
} catch { /* telemetry hỏng KHÔNG được làm hỏng lượt nạp */ }
```

Trong `unloadGgufModel` gọi `release(...)` + `logVramEvent({ event: "release", ... })`.

⚠ **Bọc mọi lời gọi telemetry trong `try/catch`.** Pha 1 tuyệt đối không được làm hỏng đường cấp phát đang chạy tốt.

⚠ **Đo `vramBefore` bằng `readDeviceVram()` NGAY TRƯỚC `llama.loadModel`.** llama.cpp cấp phát compute buffer **LƯỜI, ở lượt suy luận đầu tiên** — nên số `commit` ở đây là **trọng số + context**, chưa gồm buffer suy luận. **Ghi rõ điều này trong comment**, nếu không người sau sẽ tưởng đó là tổng.

- [ ] **Step 4: Nối năm điểm còn lại theo đúng khuôn Step 3**

| Điểm | `owner` | `kind` | `priority` |
|---|---|---|---|
| `getEmbeddingContext` | `gguf-embed-ctx:${modelId}` | `gguf-embed-context` | `background` |
| `ensureTextContext` | `gguf-ctx:${modelId}` | `gguf-context` | `interactive` |
| `aiInferenceEngine.getSession` (`:106`) | `onnx:${model.code}` | `onnx-session` | `production` |
| `ai/ocrService.getOnnxSession` (`:296`) | `onnx-ocr:${modelPath}` | `onnx-session` | `production` |
| `aiReranker` (`:361`) | `reranker:${modelPath}` | `gguf-model` | `background` |

⚠ ONNX là `production` vì nó phục vụ **đường kiểm tra AOI** — tiền của nhà máy (spec §5.2).

- [ ] **Step 5: Khởi động reconciler + bộ đếm giờ nhật ký lúc boot**

Trong `server/_core/backgroundJobs.ts`, cạnh các job nền sẵn có:

```ts
const { startVramReconciler } = await import("../services/vram/vramReconciler");
const { __setVramLogTimerEnabled } = await import("../services/vram/vramEventLog");
startVramReconciler();
__setVramLogTimerEnabled(true);
console.log("[vram] sổ cái + đối chiếu đã bật (Pha 1 — CHỈ QUAN SÁT, không cưỡng chế).");
```

- [ ] **Step 6: Chạy XANH + hồi quy toàn bộ**

```bash
npx vitest run server/services/vram/ server/services/aiGgufEngine.test.ts server/services/aiGgufEngine.embedNoTextCtx.test.ts server/services/aiGgufEngine.refcountSlotReject.test.ts
NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit
npm run kb:eval
```

⚠ `kb:eval` phải giữ **151/151**. Tụt là **DỪNG NGAY, báo lại — KHÔNG nới ngưỡng.**

- [ ] **Step 7: Chứng minh KHÔNG đổi hành vi**

```bash
git diff --stat
```
Xác nhận: **không dòng nào bị xoá** khỏi `enforceVramGuard`/`ensureCapacity`/`evictLRU`; diff chỉ **thêm**. Dán `git diff` của `aiGgufEngine.ts` lọc bỏ phần thêm mới để chứng minh phần cũ **byte-identical**.

- [ ] **Step 8: Commit**

```bash
git add server/services/aiGgufEngine.ts server/services/aiInferenceEngine.ts server/services/ai/ocrService.ts server/services/aiReranker.ts server/_core/backgroundJobs.ts server/services/vram/wiring.inprocess.test.ts
git commit -m "feat(vram/pha1-5): nối sáu hộ tiêu thụ trong tiến trình — chỉ khai báo, không đổi hành vi"
```

---

### Task 6: Nối hai hộ tiêu thụ ngoài tiến trình (chỉ khai báo)

**Files:**
- Modify: `server/services/llamaVisionSidecar.ts` (spawn/kill sidecar)
- Modify: `server/services/kbSyncScheduler.ts` (`:232-297`, spawn `npm run kb:sync`)
- Test: `server/services/vram/wiring.outofprocess.test.ts`

**Interfaces:**
- Consumes: `reserve/commit/release/heartbeat` (Task 1)

⚠ **Người GIÁM SÁT xin giấy phép thay cho tiến trình con** — ta không sửa binary `llama-server`. Đây là thứ làm cách 1 khả thi (spec §3.1).

- [ ] **Step 1: Viết test đỏ**

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { snapshot, __resetBrokerForTests } from "./vramBroker";

describe("dây nối ngoài tiến trình — người giám sát xin thay", () => {
  beforeEach(() => { __resetBrokerForTests(); vi.resetModules(); });

  it("spawn sidecar ⇒ có giấy phép external-process kèm ttlMs", async () => {
    vi.doMock("child_process", () => ({ spawn: () => ({ pid: 4242, on: () => {}, stdout: { on: () => {} }, stderr: { on: () => {} }, kill: () => {} }) }));
    const { __startSidecarForTests } = await import("../llamaVisionSidecar");
    await __startSidecarForTests();
    const l = snapshot().leases.find((x) => x.request.owner.startsWith("sidecar:"));
    expect(l).toBeDefined();
    expect(l!.request.kind).toBe("external-process");
    expect(typeof l!.request.ttlMs).toBe("number");
  });

  it("kill sidecar ⇒ TRẢ giấy phép", async () => {
    vi.doMock("child_process", () => ({ spawn: () => ({ pid: 4242, on: () => {}, stdout: { on: () => {} }, stderr: { on: () => {} }, kill: () => {} }) }));
    const { __startSidecarForTests, __stopSidecarForTests } = await import("../llamaVisionSidecar");
    await __startSidecarForTests();
    await __stopSidecarForTests();
    expect(snapshot().leases.some((x) => x.request.owner.startsWith("sidecar:"))).toBe(false);
  });

  it("cron kb:sync xin giấy phép BACKGROUND", async () => {
    vi.doMock("child_process", () => ({ spawn: () => ({ pid: 5151, on: () => {}, stdout: { on: () => {} }, stderr: { on: () => {} }, kill: () => {} }) }));
    const { __runKbSyncForTests } = await import("../kbSyncScheduler");
    await __runKbSyncForTests();
    const l = snapshot().leases.find((x) => x.request.owner.startsWith("cron:kb-sync"));
    expect(l!.request.priority).toBe("background");
  });
});
```

⚠ Tên hàm và hình dạng mock **có thể SAI** — đọc mã thật rồi sửa test cho khớp. Nếu hai file chưa có lối vào test được, **thêm lối vào chỉ-cho-test** thay vì sửa cấu trúc thật.

- [ ] **Step 2: Chạy, xác nhận ĐỎ.** Dán output.

- [ ] **Step 3: Nối sidecar**

Ngay **trước** `spawn(...)`:

```ts
// Pha 1 — CHỈ KHAI BÁO. Người giám sát xin thay cho tiến trình con:
// ta KHÔNG sửa binary llama-server, ta sửa thứ khởi động nó.
const { reserve } = await import("./vram/vramBroker");
const { estimateBytesFor } = await import("./vram/vramEstimator");
const sidecarOwner = "sidecar:vision";
const est = await estimateBytesFor(sidecarOwner, {
  configDefaultBytes: Number(process.env.VRAM_SIDECAR_ESTIMATE_MB ?? 7825) * 1024 * 1024,
});
const sidecarLease = reserve({
  owner: sidecarOwner, kind: "external-process", estimatedBytes: est.bytes,
  priority: "interactive", estimateSource: est.source,
  ttlMs: Number(process.env.VRAM_SIDECAR_TTL_MS ?? 900_000),   // > 10 phút idle-timeout của sidecar
});
```

Trong đường tắt/tự-tắt: `release(sidecarLease)`. Trong vòng kiểm tra sức khoẻ sẵn có: `heartbeat(sidecarLease)`.

⚠ `7825` là **hằng số đo được Đợt 2**, dùng cho **lần đầu tiên** thôi — sau lượt `commit` đầu, bộ ước lượng dùng số thật. Sự kiện ghi `estimateSource: "config-default"` để truy được chỗ nào còn dựa vào hằng số.

- [ ] **Step 4: Nối cron `kb:sync`**

Cùng khuôn, `owner: "cron:kb-sync"`, `priority: "background"`, `configDefaultBytes` mặc định **1251 MiB** (số đo Đợt 2), `ttlMs` = trần thời lượng job.

`release()` trong `on("exit")` **và** `on("error")` — cả hai nhánh.

⚠ **Chưa** cài cơ chế hoãn (spec §5.4) ở Pha 1 — Pha 1 không từ chối ai nên chưa có gì để hoãn. Ghi một comment trỏ tới §5.4 để Pha 2 biết chỗ.

- [ ] **Step 5: Chạy XANH + commit**

```bash
npx vitest run server/services/vram/
NODE_OPTIONS=--max-old-space-size=8192 npx tsc --noEmit
git add server/services/llamaVisionSidecar.ts server/services/kbSyncScheduler.ts server/services/vram/wiring.outofprocess.test.ts
git commit -m "feat(vram/pha1-6): người giám sát xin giấy phép thay sidecar và cron"
```

---

### Task 7: Đo `aiReranker` bật GPU + trả lời Ư7 — CHỈ ĐO, CẤM VÁ

**Files:**
- Create: `docs/superpowers/reports/2026-08-02-vram-pha1-report.md`

⚠⚠ **KHÔNG SỬA MÃ SẢN XUẤT TRONG TASK NÀY.** Kể cả khi tìm ra cơ chế và thấy cách sửa hiển nhiên. Báo cáo Đợt 2 §5 ghi rõ *"không viết mã trước Ư7"*.

- [ ] **Step 1: Đo `aiReranker` với `RAG_RERANKER_GPU=true` (spec §15.4)**

```bash
RAG_RERANKER_GPU=true node --input-type=module -e "
  const { execFileSync } = await import('child_process');
  const smi = () => parseInt(execFileSync('nvidia-smi', ['--query-gpu=memory.used','--format=csv,noheader,nounits']).toString().trim().split('\n')[0], 10);
  console.log('nen', smi());
  const { getLlama } = await import('node-llama-cpp');
  const llama = await getLlama();
  const m = await llama.loadModel({ modelPath: process.env.RAG_RERANKER_MODEL_PATH, gpuLayers: -1 });
  console.log('sau nap', smi());
"
```

⚠ Ép biến qua **CLI**, **không** sửa `.env`. Trước mỗi lượt: `nvidia-smi` về baseline (~1.070-1.190 MiB) + `netstat -ano | grep -E ":3000|:8081"` trống. **Không dùng `tasklist`.** Sidecar phải **ngủ**.

Ghi **hai lượt** để có biên nhiễu. Đây là **hộ tiêu thụ thứ sáu**, chưa từng ai đo.

- [ ] **Step 2: Chạy Ư7 bằng chính nhật ký vừa dựng**

Ư7: *"trần một khối `cudaMalloc` đơn lẻ không ổn định giữa các lượt — có phải do trạng thái NGOÀI tiến trình?"*

Nay mỗi lượt cấp phát để lại một dòng `vram_events` kèm **ảnh chụp toàn bộ sổ**, nên câu hỏi *"lúc đó ai đang giữ gì"* trả lời được bằng SQL:

```sql
SELECT "createdAt", event, owner, "estimatedBytes", "actualBytes", "deviceUsedBytes", "driftBytes", detail
FROM vram_events ORDER BY "createdAt" DESC LIMIT 200;
```

⚠ **CHỈ ĐƯỢC TRÍCH `16.698,37 MiB` từ §5 báo cáo Đợt 2.** Mọi ngưỡng trung gian (8,2 / 8,9 / 10,9 / 13,6 / 15,6 / 16,3 GB) **ĐÃ BỊ RÚT** vì không tái hiện.

⚠ **Mọi phát biểu phủ định phải kèm phép thử ĐÃ CHẠY, cả hai chiều.** Lớp lỗi này đã mắc **ba lần** ở đúng câu hỏi này — lần gần nhất là một phép đối chứng **không đối chứng được**, vì **app tự nạp model nhúng ở ≈T+34 s**, nằm đúng giữa hai mốc đo. **Hỏi "hệ có tự làm gì trong lúc tôi chờ không?"** trước khi kết luận.

- [ ] **Step 3: Viết báo cáo**

`docs/superpowers/reports/2026-08-02-vram-pha1-report.md`, gồm:

1. **Số đo `aiReranker` bật GPU** (2 lượt) — hộ tiêu thụ thứ sáu, lần đầu có số.
2. **Phân bố `|lệch|`** từ `vram_events` ⇒ chốt ngưỡng thật, thay `512 MiB` khởi điểm (spec §15.1).
3. **`p50/p95` chi phí một lượt đầu dò** ⇒ chốt nhịp thật, thay `60 s` khởi điểm (spec §15.2).
4. **`estimateSource` còn `config-default` ở đâu** — chỗ nào vẫn dựa vào hằng số.
5. **Bao nhiêu lượt `wouldRefuse=true`, của ai** ⇒ **bán kính ảnh hưởng khi bật cưỡng chế ở Pha 2**.
6. **Ư7**: đã loại gì (kèm phép thử đã chạy) · khuôn quan sát mới · ứng viên còn lại kèm phép thử rẻ.
7. **Cổng ra Pha 1**: sổ có khớp thiết bị trong ngưỡng suốt 24 h không.

- [ ] **Step 4: Xác nhận không đụng mã sản xuất**

```bash
git status --porcelain
git diff --stat HEAD
```
Chỉ được có file báo cáo.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/reports/2026-08-02-vram-pha1-report.md
git commit -m "docs(vram/pha1-7): đo reranker bật GPU + Ư7 bằng nhật ký sổ cái"
```

---

## Self-Review

**1. Spec coverage**

| Mục spec | Task |
|---|---|
| §3.3 `vramBroker` | 1 |
| §3.3 `vramEventLog` + §9 mô hình dữ liệu | 2 |
| §3.3 `vramProbe` · §7 harness tự sinh | 3 |
| §3.3 `vramReconciler` · §6 đối chiếu & báo động | 4 |
| §3.2 "reserve không I/O" | 1 (test riêng), 3 |
| §4 vòng đời giấy phép | 1 |
| §5.1/§5.2 quyết định + ưu tiên (bóng) | 1 |
| §10 pha 1 "chỉ khai báo" | 5, 6 |
| §11 đầu dò hỏng ⇒ im lặng | 4 |
| §12 mutation test | 1 (Step 7), 4 (Step 5) |
| §15.1/§15.2 chốt ngưỡng & nhịp | 7 |
| §15.4 đo reranker bật GPU | 7 |
| §16 hộ tiêu thụ thứ sáu | 5 (nối), 7 (đo) |
| Ư7 | 7 |

**Cố ý ngoài phạm vi Pha 1** (thuộc Pha 2-4, spec §8/§10): xoá `enforceVramGuard`/`ensureCapacity`/`evictLRU` · gộp ba khoá in-flight · cơ chế hoãn §5.4 · `VramRefusedError` được ném thật · router tRPC cho Agent.

**2. Placeholder scan:** không có "TBD"/"TODO". Ba chỗ cố ý để người thi công quyết, đều kèm chỉ dẫn: Task 5 Step 1 (lối vào test cho `aiReranker` — ghi rõ chọn cách nào và vì sao) · Task 6 Step 1 (lối vào test cho hai file giám sát) · Task 7 Step 2 (giả thuyết Ư7 phải ghi là **giả thuyết kèm phép thử**, không phải kết luận).

**3. Type consistency:** `VramLease`/`VramReserveRequest`/`VramReserveResult`/`VramSnapshot`/`VramEstimateSource` định nghĩa ở Task 1, dùng nguyên tên ở 2-6. `reserve/commit/release/heartbeat/snapshot` nhất quán. `readDeviceVram()` khai ở Task 1 Step 5 (bản tối thiểu) rồi viết đầy đủ ở Task 3 — **cùng chữ ký**. `estimateBytesFor`/`recordActual` chỉ Task 3 định nghĩa, Task 5-6 dùng. `logVramEvent` Task 2, dùng ở 4-6. Tên bảng `vram_events` và tên cột khớp giữa `drizzle/schema/vram.ts` và `0310_vram_broker.sql`.
