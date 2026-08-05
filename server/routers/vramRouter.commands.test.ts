/**
 * ★★★ Pha 4 Task 2 — **ROUTER RA LỆNH.** Ba lệnh, một kỷ luật: **không khai thành công khi byte
 * chưa nhả**, và **không hành động thay cho một tiến trình mà ta không quan sát được**.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ ĐÂY LÀ LỆNH GIẾT ĐƯỢC TIẾN TRÌNH — VÀ ĐƯỜNG PHÁ HUỶ ĐÃ TỪNG GIẾT NHẦM RỒI BÁO THÀNH CÔNG
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Pha 3 vá một Critical đúng ở đây: đường phá huỷ **không hỏi `ctime`**, nên nó tắt "cái tiến trình
 * đang MANG số N hôm nay"; sau lượt giết, phép kiểm bằng chứng thoả **rỗng tuếch** (pid mới không
 * phải compute-app) ⇒ log khai *"nvidia-smi XÁC NHẬN"*. ⇒ Bộ ca dưới đây bắt lệnh của Agent đi qua
 * **đúng** `broker` → `preemptStepForOwner()` → `NGUOI_THI_HANH` → `thuHoiHoNhanNuoi()`; và ca
 * `orphan-pid` **ghim `process.kill` bằng spy**: một đường thứ hai viết tay sẽ chạm spy đó (hoặc
 * khai `reclaimed` cho một khối byte chưa rời sổ) ⇒ ĐỎ.
 *
 * ⚠ LƯỚI ĐI THEO ĐƯỜNG THOÁT (ràng buộc 5): mọi ca gọi **router THẬT** qua `createCaller()`, dựng
 * trạng thái bằng **đúng những ô mã sản xuất ghi vào** (`broker.reserve()`,
 * `publishSharedLedgerReplica()`), rồi đọc **đúng object mã sản xuất gửi đi**. Không ca nào tự đặt
 * một con số rồi khẳng định lại chính con số đó; `freedBytes` luôn được so với **sổ**.
 *
 * ⚠ `vi.mock("../services/llamaVisionSidecar")` thay **đúng người thi hành LÁ** (`stopSidecar`), là
 * chỗ duy nhất trong chuỗi chạm tới một tiến trình thật. Mọi mắt xích còn lại — quyền nhường, khả
 * năng thu hồi, phép đo `freedBytes`, cách dựng câu trả lời — đều là mã sản xuất.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { MockInstance } from "vitest";

// Middleware kiểm toán ghi DB fire-and-forget cho MỌI mutation — tắt trước khi `trpc.ts` nạp.
vi.hoisted(() => {
  process.env.AUDIT_ALL_MUTATIONS = "false";
});

/** Người thi hành LÁ của hộ `vision-sidecar`. Hành vi đổi theo từng ca (đúng bốn kết cục thật). */
const sidecar = vi.hoisted(() => ({ stop: null as null | (() => Promise<boolean>) }));
vi.mock("../services/llamaVisionSidecar", () => ({
  stopSidecar: async () => (sidecar.stop === null ? false : sidecar.stop()),
  isVisionSidecarAvailable: () => false,
  getVisionSidecarConfig: () => null,
}));

/** Bảng tiến trình — `null` = KHÔNG ĐỌC ĐƯỢC (không có bằng chứng), khác hẳn "bảng rỗng". */
const gpu = vi.hoisted(() => ({
  procs: null as null | { pid: number; ppid: number; cmdline: string; ctime: number }[],
}));
vi.mock("../services/vram/vramGpuHolders", () => ({
  readProcTable: async () => gpu.procs,
  readGpuHolders: async () => null,
  readComputeApps: async () => null,
}));

vi.mock("../services/vram/vramEventLog", () => ({
  logVramEvent: () => {},
  flushVramEvents: async () => 0,
  sanitizeVramEvent: (e: unknown) => e,
  __setVramLogTimerEnabled: () => {},
  __hasVramLogTimer: () => false,
  __vramDroppedEventCount: () => 0,
}));

import { vramRouter } from "./vramRouter";
import * as broker from "../services/vram/vramBroker";
import {
  __resetSharedLedgerForTests,
  __setSharedLedgerSelfKeyForTests,
  publishSharedLedgerReplica,
  readSharedLedgerReplica,
  sharedLedgerFact,
  sharedLedgerSelfKey,
  type SharedLeaseRow,
} from "../services/vram/vramSharedLedger";
import { __resetDecisionTickForTests } from "../services/vram/vramTickCell";
import { __resetVramDeferForTests } from "../services/vram/vramDefer";
import { ownerNhanNuoi } from "../services/vram/vramAdoption";
import type { VramLease } from "../services/vram/types";

const MIB = 1024 * 1024;

/** FILETIME UTC (100 ns từ 1601) của một mốc Unix ms — đúng thứ `Win32_Process.CreationDate` cho. */
function ft(unixMs: number): number {
  return (unixMs + 11_644_473_600_000) * 10_000;
}

const admin2fa = { id: 1, role: "admin", name: "Admin", twoFactorEnabled: true };
const engineer2fa = { id: 3, role: "engineer", name: "Eng", twoFactorEnabled: true };
const engineerNo2fa = { id: 4, role: "engineer", name: "Eng2", twoFactorEnabled: false };
const viewer = { id: 5, role: "viewer", name: "V", twoFactorEnabled: true };
const operator = { id: 6, role: "operator", name: "Op", twoFactorEnabled: true };

function caller(user: unknown = admin2fa) {
  return vramRouter.createCaller({
    user,
    req: { ip: "127.0.0.1", headers: {} },
    res: {},
    sessionToken: "t",
  } as never);
}

/**
 * Đi qua ĐÚNG đường thoát: một lượt `reserve()` thật ghi vào sổ cục bộ.
 *
 * ⚠ `refCount` MẶC ĐỊNH của một giấy phép mới là **1 = ĐANG DÙNG** (`vramBroker` :949). Ở sản xuất
 * `aiGgufEngine`/`llamaVisionSidecar` hạ nó về 0 qua `setLeaseRefCount()` khi hộ rảnh — nên ca nào
 * muốn một hộ NHÀN RỖI phải đi qua **đúng bộ đếm đó**, không phải một cờ thứ hai.
 */
function xinThat(req: {
  owner: string;
  bytes: number;
  priority?: "background" | "interactive" | "production";
  kind?: "gguf-model" | "external-process";
  reclaimer?: "gguf-idle-model" | "vision-sidecar" | "orphan-pid";
  refCount?: number;
}): VramLease {
  const out = broker.reserve(
    {
      owner: req.owner,
      kind: req.kind ?? "external-process",
      estimatedBytes: req.bytes,
      priority: req.priority ?? "background",
      ...(req.reclaimer === undefined ? {} : { reclaimer: req.reclaimer }),
    },
    { tick: null, unledgered: null, sharedLedger: null, nowMs: Date.now() },
  );
  if (out.lease === null) throw new Error("ca này cần một giấy phép ĐƯỢC CẤP");
  if (!broker.setLeaseRefCount(out.lease.id, req.refCount ?? 0)) {
    throw new Error("bộ đếm dùng của SỔ phải nhận được — nếu không ca này đo nhầm thứ");
  }
  return out.lease;
}

function hangAnhEm(over: Partial<SharedLeaseRow> = {}): SharedLeaseRow {
  return {
    leaseKey: "worker:999:1750000000000#lease-7",
    processKey: "worker:999:1750000000000",
    pid: 999,
    role: "worker",
    leaseId: "lease-7",
    owner: "gguf:qwen30b",
    leaseKind: "gguf-model",
    priority: "background",
    bytes: 17_000 * MIB,
    measured: true,
    refCount: 0,
    reclaimer: "gguf-idle-model",
    acquiredAtMs: 1,
    updatedAtMs: 1,
    ...over,
  };
}

let killSpy: MockInstance<(pid: number, signal?: string | number | undefined) => true>;

beforeEach(() => {
  broker.__resetBrokerForTests();
  __resetSharedLedgerForTests();
  __resetDecisionTickForTests();
  __resetVramDeferForTests();
  sidecar.stop = null;
  gpu.procs = null;
  // ⚠⚠ GHIM ĐƯỜNG PHÁ HUỶ: lệnh của Agent KHÔNG được chạm `process.kill` từ một đường viết tay.
  killSpy = vi.spyOn(process, "kill").mockImplementation(() => true as never);
});
afterEach(() => {
  killSpy.mockRestore();
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// A. PHÂN QUYỀN — role-floor + 2FA, theo đúng khuôn `deployProcedure`/`actuationProcedure`
// ══════════════════════════════════════════════════════════════════════════════════════════════

describe("vramRouter — PHÂN QUYỀN là BẮT BUỘC (lệnh giết được tiến trình)", () => {
  it("★★★ viewer ⇒ TỪ CHỐI cả ba lệnh (role-floor), và KHÔNG một byte nào đổi", async () => {
    const lease = xinThat({ owner: "sidecar:vision", bytes: 7_825 * MIB, reclaimer: "vision-sidecar" });
    const truoc = broker.snapshot().totalReservedBytes;

    await expect(caller(viewer).preempt({ owner: "sidecar:vision" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller(viewer).releaseStale({ leaseKey: "worker:999:1#lease-7" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller(viewer).retryDeferred({ owner: "cron:kb-sync" })).rejects.toMatchObject({ code: "FORBIDDEN" });

    expect(broker.snapshot().totalReservedBytes).toBe(truoc);
    expect(broker.snapshot().leases.some((l) => l.id === lease.id)).toBe(true);
  });

  it("★★ operator (không nằm trong ACTUATION_ROLES) ⇒ TỪ CHỐI lệnh phá huỷ", async () => {
    await expect(caller(operator).preempt({ owner: "sidecar:vision" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("★★ engineer CHƯA bật 2FA ⇒ TỪ CHỐI (sàn 2FA của actuation)", async () => {
    await expect(caller(engineerNo2fa).preempt({ owner: "sidecar:vision" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller(engineerNo2fa).retryDeferred({ owner: "cron:kb-sync" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("engineer + 2FA ⇒ QUA cổng quyền (tới được thân thủ tục)", async () => {
    const r = await caller(engineer2fa).preempt({ owner: "khong-co-ho-nao" });
    expect(r.outcome).toBe("refused");
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// B. `preempt(owner)` — TỪ CHỐI CÓ LÝ DO, và KHÔNG ĐỤNG HỘ ĐANG BẬN
// ══════════════════════════════════════════════════════════════════════════════════════════════

describe("vramRouter.preempt — từ chối phải CÓ LÝ DO, không 'im lặng thành công'", () => {
  it("hộ KHÔNG có trong sổ cục bộ ⇒ refused + lý do, `freedBytes === 0`", async () => {
    const r = await caller().preempt({ owner: "gguf:khong-ton-tai" });
    expect(r.outcome).toBe("refused");
    expect(r.reason).toBe("owner-not-in-local-ledger");
    expect(r.freedBytes).toBe(0);
    expect(r.reclaimed).toEqual([]);
  });

  it("★★★ hộ mức `production` ⇒ KHÔNG BAO GIỜ bị thu hồi, kể cả khi NHÀN RỖI", async () => {
    xinThat({ owner: "onnx:aoi-classifier", bytes: 2_000 * MIB, priority: "production", reclaimer: "gguf-idle-model" });
    const truoc = broker.snapshot().totalReservedBytes;

    const r = await caller().preempt({ owner: "onnx:aoi-classifier" });

    expect(r.outcome).toBe("refused");
    expect(r.reason).toBe("production-never-preempted");
    expect(r.freedBytes).toBe(0);
    // Hộ KHÔNG bị đụng — sổ y nguyên.
    expect(broker.snapshot().totalReservedBytes).toBe(truoc);
    expect(sidecar.stop).toBeNull();
  });

  it("★★★ hộ ĐANG BẬN (`refCount > 0`) ⇒ KHÔNG bị đụng, và người thi hành KHÔNG được gọi", async () => {
    xinThat({
      owner: "sidecar:vision",
      bytes: 7_825 * MIB,
      priority: "interactive",
      reclaimer: "vision-sidecar",
      refCount: 1, // ĐANG phục vụ một request thị giác
    });
    let goi = 0;
    sidecar.stop = async () => {
      goi += 1;
      return true;
    };
    const truoc = broker.snapshot().totalReservedBytes;

    const r = await caller().preempt({ owner: "sidecar:vision" });

    expect(r.outcome).toBe("refused");
    expect(r.reason).toBe("busy-in-use");
    expect(goi, "người thi hành KHÔNG được chạm một hộ đang phục vụ").toBe(0);
    expect(broker.snapshot().totalReservedBytes).toBe(truoc);
  });

  it("hộ KHÔNG khai người thi hành ⇒ refused `no-reclaimer-declared` (đừng hứa lấy lại byte của nó)", async () => {
    xinThat({ owner: "gguf-backend:cuda", bytes: 500 * MIB });
    const r = await caller().preempt({ owner: "gguf-backend:cuda" });
    expect(r.outcome).toBe("refused");
    expect(r.reason).toBe("no-reclaimer-declared");
    expect(r.freedBytes).toBe(0);
  });
});

describe("vramRouter.preempt — BẰNG CHỨNG: không khai thành công khi byte CHƯA NHẢ", () => {
  it("★★★ người thi hành nhả THẬT ⇒ `reclaimed` + `freedBytes` = ĐÚNG khối byte rời SỔ", async () => {
    const lease = xinThat({ owner: "sidecar:vision", bytes: 7_825 * MIB, priority: "interactive", reclaimer: "vision-sidecar" });
    sidecar.stop = async () => {
      broker.release(lease); // đúng việc `proc.on("exit")` làm ở sản xuất
      return true;
    };

    const r = await caller().preempt({ owner: "sidecar:vision" });

    expect(r.outcome).toBe("reclaimed");
    expect(r.reason).toBeNull();
    expect(r.freedBytes).toBe(7_825 * MIB);
    expect(r.reclaimed).toEqual(["sidecar:vision"]);
    expect(r.failed).toEqual([]);
    expect(r.reclaimer).toBe("vision-sidecar");
    expect(broker.snapshot().leases.some((l) => l.id === lease.id)).toBe(false);
  });

  it("★★★ ĐỘT BIẾN GHIM: người thi hành khai `true` nhưng SỔ KHÔNG ĐỔI ⇒ **failed**, KHÔNG phải reclaimed", async () => {
    // Đây đúng chuỗi C-2 của Pha 2B: `stopSidecar` khai `true` vô điều kiện ⇒ giết 7,8 GB mà lượt
    // xin VẪN hỏng. `freedBytes = 0` ⇒ tuyệt đối không được khai thành công.
    xinThat({ owner: "sidecar:vision", bytes: 7_825 * MIB, priority: "interactive", reclaimer: "vision-sidecar" });
    sidecar.stop = async () => true; // KHÔNG nhả sổ

    const r = await caller().preempt({ owner: "sidecar:vision" });

    expect(r.outcome).toBe("failed");
    expect(r.reason).toBe("no-bytes-freed");
    expect(r.freedBytes).toBe(0);
    expect(r.reclaimed, "không được liệt kê là đã thu hồi khi sổ chưa nhả").toEqual([]);
  });

  it("người thi hành khai THẤT BẠI ⇒ failed + lý do, giấy phép GIỮ NGUYÊN", async () => {
    const lease = xinThat({ owner: "sidecar:vision", bytes: 7_825 * MIB, priority: "interactive", reclaimer: "vision-sidecar" });
    sidecar.stop = async () => false;

    const r = await caller().preempt({ owner: "sidecar:vision" });

    expect(r.outcome).toBe("failed");
    expect(r.reason).toBe("reclaimer-returned-false");
    expect(r.freedBytes).toBe(0);
    expect(r.failed).toEqual(["sidecar:vision"]);
    expect(broker.snapshot().leases.some((l) => l.id === lease.id)).toBe(true);
  });

  it("người thi hành NÉM ⇒ failed `reclaimer-threw` + câu thô (đã cắt), KHÔNG ném ra API", async () => {
    xinThat({ owner: "sidecar:vision", bytes: 7_825 * MIB, priority: "interactive", reclaimer: "vision-sidecar" });
    sidecar.stop = async () => {
      throw new Error("cong 8081 khong phan hoi");
    };

    const r = await caller().preempt({ owner: "sidecar:vision" });

    expect(r.outcome).toBe("failed");
    expect(r.reason).toBe("reclaimer-threw");
    expect(r.detail).toContain("cong 8081");
    expect(r.freedBytes).toBe(0);
  });

  it("★★★ ĐỘT BIẾN GHIM: hộ `orphan-pid` phải đi qua ĐƯỜNG ĐÃ VÁ — không `process.kill` viết tay", async () => {
    /**
     * Giấy phép mang dấu nhận nuôi nhưng tiến trình này **chưa đứng tên PID đó** (`leaseNhanNuoi`
     * rỗng) ⇒ `thuHoiHoNhanNuoi()` trả `false` **trước khi gửi bất kỳ tín hiệu nào**. Một đường
     * thứ hai viết tay (`process.kill(pid)` + `release()`) sẽ: chạm spy, và khai `reclaimed` cho
     * một khối byte mà không bằng chứng thiết bị nào xác nhận — đúng Critical của Pha 3.
     */
    const lease = xinThat({
      owner: ownerNhanNuoi(31337),
      bytes: 7_825 * MIB,
      priority: "interactive",
      reclaimer: "orphan-pid",
    });
    const truoc = broker.snapshot().totalReservedBytes;

    const r = await caller().preempt({ owner: ownerNhanNuoi(31337) });

    expect(r.outcome).toBe("failed");
    expect(r.freedBytes).toBe(0);
    expect(killSpy, "KHÔNG được giết một PID mà ta không chứng minh được là của mình").not.toHaveBeenCalled();
    expect(broker.snapshot().totalReservedBytes).toBe(truoc);
    expect(broker.snapshot().leases.some((l) => l.id === lease.id)).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// C. `releaseStale(leaseKey)` — CHỈ dọn hàng ĐÃ CHỨNG MINH LÀ MA
// ══════════════════════════════════════════════════════════════════════════════════════════════

describe("vramRouter.releaseStale — bằng chứng CHẾT là điều kiện, không phải lời khai của người gọi", () => {
  beforeEach(() => {
    __setSharedLedgerSelfKeyForTests("api:100:1750000000000");
  });

  it("★★★ chủ hàng ĐÃ CHẾT (vắng khỏi bảng tiến trình) ⇒ released + `freedBytes` = byte RỜI bản sao", async () => {
    const row = hangAnhEm();
    publishSharedLedgerReplica([row], Date.now(), "api:100:1750000000000");
    gpu.procs = []; // bảng đọc ĐƯỢC, và pid 999 KHÔNG có trong đó ⇒ chết
    const truoc = sharedLedgerFact(Date.now())!;

    const r = await caller().releaseStale({ leaseKey: row.leaseKey });

    expect(r.outcome).toBe("released");
    expect(r.reason).toBeNull();
    expect(r.freedBytes).toBe(17_000 * MIB);
    expect(r.processKey).toBe("worker:999:1750000000000");
    // Bản sao đọc KHÔNG còn hàng đó — đúng ô mà `computeHeadroom()` đọc.
    expect(readSharedLedgerReplica()!.foreignLeases.map((x) => x.leaseKey)).not.toContain(row.leaseKey);
    const sau = sharedLedgerFact(Date.now())!;
    expect(truoc.foreignBytes - sau.foreignBytes).toBe(17_000 * MIB);
    // Lệnh xoá đi qua ĐÚNG hàng đợi mà `release()` dùng ⇒ ô "chưa gửi kịp" nhích lên.
    expect(sau.unsyncedWrites).toBeGreaterThan(truoc.unsyncedWrites);
  });

  it("★★★ chủ hàng CÒN SỐNG ⇒ refused, hàng GIỮ NGUYÊN, không byte nào đổi", async () => {
    const row = hangAnhEm();
    publishSharedLedgerReplica([row], Date.now(), "api:100:1750000000000");
    gpu.procs = [{ pid: 999, ppid: 1, cmdline: "node worker.js", ctime: ft(1_749_999_999_000) }];

    const r = await caller().releaseStale({ leaseKey: row.leaseKey });

    expect(r.outcome).toBe("refused");
    expect(r.reason).toBe("process-not-proven-dead");
    expect(r.freedBytes).toBe(0);
    expect(readSharedLedgerReplica()!.foreignLeases.map((x) => x.leaseKey)).toContain(row.leaseKey);
  });

  it("★★ bảng tiến trình KHÔNG ĐỌC ĐƯỢC ⇒ refused (không bằng chứng ⇒ không xoá hàng của ai)", async () => {
    const row = hangAnhEm();
    publishSharedLedgerReplica([row], Date.now(), "api:100:1750000000000");
    gpu.procs = null;

    const r = await caller().releaseStale({ leaseKey: row.leaseKey });

    expect(r.outcome).toBe("refused");
    expect(r.reason).toBe("process-not-proven-dead");
    expect(readSharedLedgerReplica()!.foreignLeases.map((x) => x.leaseKey)).toContain(row.leaseKey);
  });

  it("hàng CỦA CHÍNH TA ⇒ refused: sổ CỤC BỘ là chủ, không có người đọc thứ hai", async () => {
    const row = hangAnhEm({ leaseKey: "api:100:1750000000000#lease-1", processKey: "api:100:1750000000000" });
    publishSharedLedgerReplica([row], Date.now(), "api:100:1750000000000");
    gpu.procs = [];

    const r = await caller().releaseStale({ leaseKey: row.leaseKey });

    expect(r.outcome).toBe("refused");
    expect(r.reason).toBe("own-row-local-ledger-is-authority");
  });

  it("khoá KHÔNG có trong bản sao ⇒ refused, nói rõ là không tìm thấy", async () => {
    publishSharedLedgerReplica([hangAnhEm()], Date.now(), "api:100:1750000000000");
    gpu.procs = [];
    const r = await caller().releaseStale({ leaseKey: "worker:1:1#khong-co" });
    expect(r.outcome).toBe("refused");
    expect(r.reason).toBe("row-not-in-shared-ledger-replica");
  });

  it("CHƯA làm mới bản sao lần nào ⇒ refused `shared-ledger-never-refreshed` (≠ 'không có hàng nào')", async () => {
    gpu.procs = [];
    const r = await caller().releaseStale({ leaseKey: "worker:999:1#lease-7" });
    expect(r.outcome).toBe("refused");
    expect(r.reason).toBe("shared-ledger-never-refreshed");
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// D. `retryDeferred(owner)` — BÀN GIAO CỨNG TỪ TASK 1: KHÔNG hành động như thể ta biết
// ══════════════════════════════════════════════════════════════════════════════════════════════

describe("vramRouter.retryDeferred — phạm vi QUAN SÁT phải NÓI RA, không im lặng thành công", () => {
  it("★★★ ĐỘT BIẾN GHIM: hộ KHÔNG chủ trì ở tiến trình này ⇒ NÓI THẲNG, không im lặng thành công", async () => {
    const r = await caller().retryDeferred({ owner: "cron:kb-sync" });

    expect(r.outcome).toBe("refused");
    expect(r.reason).toBe("host-not-running-in-this-process");
    expect(r.hostedHere).toBe(false);
    expect(r.scope).toBe("this-process-only");
    expect(r.observedFromProcessKey).toBe(sharedLedgerSelfKey());
    // Vết BỀN xuyên tiến trình phải được chỉ ra — ô trong bộ nhớ KHÔNG trả lời được câu của cả cụm.
    expect(r.durableTrace).toBe("vram_events(defer|defer_exceeded|preempt)");
  });

  it("★★★ hộ đi qua `vramDefer` ⇒ KHÔNG có cơ chế đánh thức từ ngoài, và `hostedHere` là KHÔNG XÁC ĐỊNH ĐƯỢC", async () => {
    const r = await caller().retryDeferred({ owner: "sidecar:local-trainer" });

    expect(r.outcome).toBe("refused");
    expect(r.reason).toBe("no-retry-mechanism-for-this-host");
    expect(r.host).toBe("sidecar:local-trainer");
    expect(r.hostedHere, "5 hộ vramDefer: không cơ chế nào trả lời câu 'có chạy ở đây không'").toBeNull();
  });

  it("★★ hộ có `owner` ĐỘNG vẫn phân giải đúng (cùng vị từ với mặt ĐỌC)", async () => {
    const r = await caller().retryDeferred({ owner: "gguf-embed-ctx:qwen3-embed" });
    expect(r.host).toBe("gguf-embed-ctx");
    expect(r.reason).toBe("no-retry-mechanism-for-this-host");
  });

  it("`owner` KHÔNG thuộc hộ `background` nào ⇒ refused, `host === null`", async () => {
    const r = await caller().retryDeferred({ owner: "gguf:qwen30b" });
    expect(r.outcome).toBe("refused");
    expect(r.reason).toBe("unknown-background-host");
    expect(r.host).toBeNull();
  });
});
