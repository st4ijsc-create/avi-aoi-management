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

/**
 * Bảng tiến trình — `null` = KHÔNG ĐỌC ĐƯỢC (không có bằng chứng), khác hẳn "bảng rỗng".
 * ⚠ `readProcTableImpl` là seam cho ca I-2: nó cho một ca dựng **một sự kiện thứ hai xảy ra TRONG
 * cửa sổ `await`** của đúng lượt I/O chậm nhất chuỗi — thứ mà mọi ca "tuần tự, một hộ" không thấy.
 */
type ProcRow = { pid: number; ppid: number; cmdline: string; ctime: number };
const gpu = vi.hoisted(() => ({
  procs: null as null | { pid: number; ppid: number; cmdline: string; ctime: number }[],
  readProcTableImpl: null as null | (() => Promise<{ pid: number; ppid: number; cmdline: string; ctime: number }[] | null>),
}));
vi.mock("../services/vram/vramGpuHolders", () => ({
  readProcTable: async () => (gpu.readProcTableImpl === null ? gpu.procs : gpu.readProcTableImpl()),
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
  rowFromLease,
  sharedLedgerFact,
  sharedLedgerSelfKey,
  type SharedLeaseRow,
} from "../services/vram/vramSharedLedger";
// ★ I-2 / M-5 — bề rộng ô danh tính có MỘT chủ; ca dưới đọc CHÍNH hằng mà cả hai vế dùng.
import { VRAM_OWNER_MAX, VRAM_LEASE_KEY_MAX } from "../services/vram/vramColumnLimits";
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
/**
 * ⚠ I-1 — engineer ĐỦ DANH TÍNH (role-floor + 2FA) nhưng **KHÔNG có bit quyền** `machine_control`.
 * `checkPermission()` (`_core/accessControl.ts`) chỉ short-circuit cho `admin`; mọi role khác phải
 * có một hàng `permissions` cấp tường minh, và không ca nào ở đây cấp. Đây là **chiều đắt** của bộ
 * ca phân quyền: sàn DANH TÍNH một mình để lọt đúng người này vào thân thủ tục giết tiến trình.
 */
const engineer2fa = { id: 3, role: "engineer", name: "Eng", twoFactorEnabled: true };
const engineerNo2fa = { id: 4, role: "engineer", name: "Eng2", twoFactorEnabled: false };
const viewer = { id: 5, role: "viewer", name: "V", twoFactorEnabled: true };
const operator = { id: 6, role: "operator", name: "Op", twoFactorEnabled: true };

/**
 * ★★★ I-4 (review Task 1b) — `totpCode` nay **BẮT BUỘC** ở `input` của `preempt`/`releaseStale`
 * (`vramRouter.ts`), vì chính `.optional()` là thứ khiến `tsc` **ban phước** cho một lượt gỡ
 * `totpCode` khỏi điểm gọi client (đột biến R2). Lưới này chạy với cờ `ACTUATION_STEPUP_2FA`
 * **TẮT**, nên middleware step-up **pass-through** và mã dưới đây **không bao giờ được verify** —
 * nó chỉ thoả **hợp đồng zod**. ⚠ Đừng đọc nó thành *"các ca dưới có đi qua step-up"*: phép cưỡng
 * chế step-up nằm ở `vramStepUpFreshness.test.ts` và `deployStepUpFreshness.test.ts`.
 */
const OTP_HD = { totpCode: "000000" } as const;

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
  gpu.readProcTableImpl = null;
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

    await expect(caller(viewer).preempt({ ...OTP_HD, owner: "sidecar:vision" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller(viewer).releaseStale({ ...OTP_HD, leaseKey: "worker:999:1#lease-7" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller(viewer).retryDeferred({ owner: "cron:kb-sync" })).rejects.toMatchObject({ code: "FORBIDDEN" });

    expect(broker.snapshot().totalReservedBytes).toBe(truoc);
    expect(broker.snapshot().leases.some((l) => l.id === lease.id)).toBe(true);
  });

  it("★★ operator (không nằm trong ACTUATION_ROLES) ⇒ TỪ CHỐI lệnh phá huỷ", async () => {
    await expect(caller(operator).preempt({ ...OTP_HD, owner: "sidecar:vision" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("★★ engineer CHƯA bật 2FA ⇒ TỪ CHỐI (sàn 2FA của actuation)", async () => {
    await expect(caller(engineerNo2fa).preempt({ ...OTP_HD, owner: "sidecar:vision" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller(engineerNo2fa).retryDeferred({ owner: "cron:kb-sync" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("★★★ ĐỘT BIẾN GHIM (I-1): engineer + 2FA nhưng KHÔNG có bit quyền ⇒ TỪ CHỐI, không tới thân thủ tục", async () => {
    /**
     * Sàn DANH TÍNH (`deployProcedure`) trả lời *"anh có phải engineer không"*; nó KHÔNG trả lời
     * *"engineer NÀY có được điều khiển máy không"*. Bỏ `requirePermission` khỏi chuỗi ⇒ engineer
     * này đi thẳng vào được lệnh **giết tiến trình** ⇒ ca đỏ.
     */
    const lease = xinThat({ owner: "sidecar:vision", bytes: 7_825 * MIB, reclaimer: "vision-sidecar" });
    let goi = 0;
    sidecar.stop = async () => {
      goi += 1;
      return true;
    };

    await expect(caller(engineer2fa).preempt({ ...OTP_HD, owner: "sidecar:vision" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(caller(engineer2fa).releaseStale({ ...OTP_HD, leaseKey: "worker:999:1#lease-7" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(caller(engineer2fa).retryDeferred({ owner: "cron:kb-sync" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });

    expect(goi, "người thi hành KHÔNG được chạm tới khi thẩm quyền chưa qua").toBe(0);
    expect(broker.snapshot().leases.some((l) => l.id === lease.id)).toBe(true);
  });

  it("admin + 2FA ⇒ QUA cả sàn danh tính LẪN sàn thẩm quyền (tới được thân thủ tục)", async () => {
    const r = await caller(admin2fa).preempt({ ...OTP_HD, owner: "khong-co-ho-nao" });
    expect(r.outcome).toBe("refused");
    expect(r.reason).toBe("owner-not-in-local-ledger");
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// B. `preempt(owner)` — TỪ CHỐI CÓ LÝ DO, và KHÔNG ĐỤNG HỘ ĐANG BẬN
// ══════════════════════════════════════════════════════════════════════════════════════════════

describe("vramRouter.preempt — từ chối phải CÓ LÝ DO, không 'im lặng thành công'", () => {
  it("hộ KHÔNG có trong sổ cục bộ ⇒ refused + lý do, `freedBytes === 0`", async () => {
    const r = await caller().preempt({ ...OTP_HD, owner: "gguf:khong-ton-tai" });
    expect(r.outcome).toBe("refused");
    expect(r.reason).toBe("owner-not-in-local-ledger");
    expect(r.freedBytes).toBe(0);
    expect(r.reclaimed).toEqual([]);
  });

  it("★★★ hộ mức `production` ⇒ KHÔNG BAO GIỜ bị thu hồi, kể cả khi NHÀN RỖI", async () => {
    xinThat({ owner: "onnx:aoi-classifier", bytes: 2_000 * MIB, priority: "production", reclaimer: "gguf-idle-model" });
    const truoc = broker.snapshot().totalReservedBytes;

    const r = await caller().preempt({ ...OTP_HD, owner: "onnx:aoi-classifier" });

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

    const r = await caller().preempt({ ...OTP_HD, owner: "sidecar:vision" });

    expect(r.outcome).toBe("refused");
    expect(r.reason).toBe("busy-in-use");
    expect(goi, "người thi hành KHÔNG được chạm một hộ đang phục vụ").toBe(0);
    expect(broker.snapshot().totalReservedBytes).toBe(truoc);
  });

  it("hộ KHÔNG khai người thi hành ⇒ refused `no-reclaimer-declared` (đừng hứa lấy lại byte của nó)", async () => {
    xinThat({ owner: "gguf-backend:cuda", bytes: 500 * MIB });
    const r = await caller().preempt({ ...OTP_HD, owner: "gguf-backend:cuda" });
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

    const r = await caller().preempt({ ...OTP_HD, owner: "sidecar:vision" });

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

    const r = await caller().preempt({ ...OTP_HD, owner: "sidecar:vision" });

    expect(r.outcome).toBe("failed");
    expect(r.reason).toBe("no-bytes-freed");
    expect(r.freedBytes).toBe(0);
    expect(r.reclaimed, "không được liệt kê là đã thu hồi khi sổ chưa nhả").toEqual([]);
  });

  it("người thi hành khai THẤT BẠI ⇒ failed + lý do, giấy phép GIỮ NGUYÊN", async () => {
    const lease = xinThat({ owner: "sidecar:vision", bytes: 7_825 * MIB, priority: "interactive", reclaimer: "vision-sidecar" });
    sidecar.stop = async () => false;

    const r = await caller().preempt({ ...OTP_HD, owner: "sidecar:vision" });

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

    const r = await caller().preempt({ ...OTP_HD, owner: "sidecar:vision" });

    expect(r.outcome).toBe("failed");
    expect(r.reason).toBe("reclaimer-threw");
    expect(r.detail).toContain("cong 8081");
    expect(r.freedBytes).toBe(0);
  });

  it("★★★ ĐỘT BIẾN GHIM (C-1): hộ KHÁC nhả trong cửa sổ `await` ⇒ TUYỆT ĐỐI không khai `reclaimed` cho hộ CỦA MÌNH", async () => {
    /**
     * ══════════════════════════════════════════════════════════════════════════════════════════
     * Đây là ca mà bộ ca vòng 1 KHÔNG có: mọi ca cũ đều **tuần tự, một hộ, một lượt**, trong khi
     * phép đo lại đo **TỔNG** bắc qua một cửa sổ bất đồng bộ.
     * ══════════════════════════════════════════════════════════════════════════════════════════
     * Kịch bản THẬT, không dựng đứng: `llamaVisionSidecar` có idleTimer và `aiGgufEngine` có TTL —
     * cả hai nhả giấy phép **bất kỳ lúc nào**; và Agent hoàn toàn có thể bắn hai lệnh `preempt`
     * song song. Ở đây nạn nhân KHÔNG nhả (đúng chuỗi C-2 Pha 2B) trong khi hộ 17 GB nhả xong.
     * Đo theo TỔNG ⇒ `reclaimed` + `freedBytes 17.000 MiB` cho một giấy phép **còn nguyên trong sổ**.
     */
    const nanNhan = xinThat({
      owner: "sidecar:vision",
      bytes: 7_825 * MIB,
      priority: "interactive",
      reclaimer: "vision-sidecar",
    });
    const hoKhac = xinThat({ owner: "gguf:qwen30b", bytes: 17_000 * MIB, kind: "gguf-model", reclaimer: "gguf-idle-model" });
    sidecar.stop = async () => {
      broker.release(hoKhac); // ← hộ KHÁC nhả TRONG cửa sổ await
      return true; // ← nhưng nạn nhân thì KHÔNG
    };

    const r = await caller().preempt({ ...OTP_HD, owner: "sidecar:vision" });

    expect(r.outcome, "giấy phép của hộ này còn nguyên ⇒ KHÔNG được khai thành công").toBe("failed");
    expect(r.reason).toBe("no-bytes-freed");
    expect(r.freedBytes, "không được nhận byte của hộ khác").toBe(0);
    expect(r.leaseLeftLedger).toBe(false);
    expect(r.reclaimed).toEqual([]);
    // Bằng chứng thô: nạn nhân vẫn nằm trong sổ, đúng thứ lời khai phải khớp.
    expect(broker.snapshot().leases.some((l) => l.id === nanNhan.id)).toBe(true);
  });

  it("★★ (C-1) hộ của mình nhả THẬT + hộ khác cũng nhả ⇒ `freedBytes` KẸP theo hộ, không cộng byte người khác", async () => {
    const nanNhan = xinThat({
      owner: "sidecar:vision",
      bytes: 7_825 * MIB,
      priority: "interactive",
      reclaimer: "vision-sidecar",
    });
    const hoKhac = xinThat({ owner: "gguf:qwen30b", bytes: 17_000 * MIB, kind: "gguf-model", reclaimer: "gguf-idle-model" });
    sidecar.stop = async () => {
      broker.release(hoKhac);
      broker.release(nanNhan);
      return true;
    };

    const r = await caller().preempt({ ...OTP_HD, owner: "sidecar:vision" });

    expect(r.outcome).toBe("reclaimed");
    expect(r.leaseLeftLedger).toBe(true);
    expect(r.freedBytes, "tổng co 24.825 MiB nhưng hộ NÀY chỉ giữ 7.825 MiB").toBe(7_825 * MIB);
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

    const r = await caller().preempt({ ...OTP_HD, owner: ownerNhanNuoi(31337) });

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

    const r = await caller().releaseStale({ ...OTP_HD, leaseKey: row.leaseKey });

    expect(r.outcome).toBe("released");
    expect(r.reason).toBeNull();
    expect(r.freedBytes).toBe(17_000 * MIB);
    expect(r.rowKind).toBe("sibling-lease");
    // ★ M-2 — lệnh `delete` mới XẾP HÀNG; nói ra bằng dữ liệu thay vì để Agent tự suy.
    expect(r.durability).toBe("queued-for-shared-ledger");
    expect(r.unsyncedWritesAfter).toBeGreaterThan(0);
    expect(r.processKey).toBe("worker:999:1750000000000");
    // Bản sao đọc KHÔNG còn hàng đó — đúng ô mà `computeHeadroom()` đọc.
    expect(readSharedLedgerReplica()!.foreignLeases.map((x) => x.leaseKey)).not.toContain(row.leaseKey);
    const sau = sharedLedgerFact(Date.now())!;
    expect(truoc.foreignBytes - sau.foreignBytes).toBe(17_000 * MIB);
    // Lệnh xoá đi qua ĐÚNG hàng đợi mà `release()` dùng ⇒ ô "chưa gửi kịp" nhích lên.
    expect(sau.unsyncedWrites).toBeGreaterThan(truoc.unsyncedWrites);
  });

  it("★★★ ĐỘT BIẾN GHIM (I-2): một hàng KHÁC rời bản sao trong cửa sổ `readProcTable` ⇒ KHÔNG được cộng byte của nó", async () => {
    /**
     * `readProcTableSafe()` là lượt I/O CHẬM NHẤT của chuỗi (PowerShell/WMI — Pha 3 Task 4 đo được
     * nó trả `null` 4 lượt liên tiếp dưới tải). Nhịp đồng bộ hoàn toàn có thể công bố một bản sao
     * mới trong cửa sổ đó. Đo `foreignBytes` TRƯỚC/SAU ⇒ con số trộn HAI ảnh chụp.
     * Bằng chứng đúng nằm sẵn trong tay: `ma.bytes` — byte của **chính hàng vừa được chứng minh là MA**.
     */
    const ma = hangAnhEm();
    const hangKhac = hangAnhEm({
      leaseKey: "worker:777:1750000000000#lease-9",
      processKey: "worker:777:1750000000000",
      pid: 777,
      leaseId: "lease-9",
      owner: "gguf:embed",
      bytes: 5_000 * MIB,
    });
    publishSharedLedgerReplica([ma, hangKhac], Date.now(), "api:100:1750000000000");
    gpu.procs = [];
    // Trong ĐÚNG cửa sổ await của `readProcTable`, hàng 5.000 MiB rời bản sao vì lý do KHÔNG liên quan.
    gpu.readProcTableImpl = async (): Promise<ProcRow[]> => {
      publishSharedLedgerReplica([ma], Date.now(), "api:100:1750000000000");
      return [];
    };

    const r = await caller().releaseStale({ ...OTP_HD, leaseKey: ma.leaseKey });

    expect(r.outcome).toBe("released");
    expect(r.freedBytes, "byte của CHÍNH hàng này — không cộng 5.000 MiB của hàng khác").toBe(17_000 * MIB);
  });

  it("★★ (M-4) hàng NỀN dùng chung ⇒ released nhưng `freedBytes: 0`, và `rowKind` nói vì sao", async () => {
    const nen = hangAnhEm({
      leaseKey: "vram:baseline",
      processKey: "worker:999:1750000000000",
      owner: "reconciler:baseline",
      leaseId: "smi",
      refCount: 1,
      reclaimer: null,
      bytes: 2_000 * MIB,
    });
    publishSharedLedgerReplica([nen], Date.now(), "api:100:1750000000000");
    gpu.procs = [];

    const r = await caller().releaseStale({ ...OTP_HD, leaseKey: "vram:baseline" });

    expect(r.outcome).toBe("released");
    expect(r.rowKind).toBe("shared-baseline");
    // ⚠ `0` ở đây nghĩa "thước `foreignBytes` KHÔNG đo cái vừa xoá", không phải "không có gì xảy ra".
    expect(r.freedBytes).toBe(0);
  });

  it("★★★ chủ hàng CÒN SỐNG ⇒ refused, hàng GIỮ NGUYÊN, không byte nào đổi", async () => {
    const row = hangAnhEm();
    publishSharedLedgerReplica([row], Date.now(), "api:100:1750000000000");
    gpu.procs = [{ pid: 999, ppid: 1, cmdline: "node worker.js", ctime: ft(1_749_999_999_000) }];

    const r = await caller().releaseStale({ ...OTP_HD, leaseKey: row.leaseKey });

    expect(r.outcome).toBe("refused");
    expect(r.reason).toBe("process-not-proven-dead");
    expect(r.freedBytes).toBe(0);
    expect(readSharedLedgerReplica()!.foreignLeases.map((x) => x.leaseKey)).toContain(row.leaseKey);
  });

  it("★★ bảng tiến trình KHÔNG ĐỌC ĐƯỢC ⇒ refused (không bằng chứng ⇒ không xoá hàng của ai)", async () => {
    const row = hangAnhEm();
    publishSharedLedgerReplica([row], Date.now(), "api:100:1750000000000");
    gpu.procs = null;

    const r = await caller().releaseStale({ ...OTP_HD, leaseKey: row.leaseKey });

    expect(r.outcome).toBe("refused");
    expect(r.reason).toBe("process-not-proven-dead");
    expect(readSharedLedgerReplica()!.foreignLeases.map((x) => x.leaseKey)).toContain(row.leaseKey);
  });

  it("hàng CỦA CHÍNH TA ⇒ refused: sổ CỤC BỘ là chủ, không có người đọc thứ hai", async () => {
    const row = hangAnhEm({ leaseKey: "api:100:1750000000000#lease-1", processKey: "api:100:1750000000000" });
    publishSharedLedgerReplica([row], Date.now(), "api:100:1750000000000");
    gpu.procs = [];

    const r = await caller().releaseStale({ ...OTP_HD, leaseKey: row.leaseKey });

    expect(r.outcome).toBe("refused");
    expect(r.reason).toBe("own-row-local-ledger-is-authority");
  });

  it("khoá KHÔNG có trong bản sao ⇒ refused, nói rõ là không tìm thấy", async () => {
    publishSharedLedgerReplica([hangAnhEm()], Date.now(), "api:100:1750000000000");
    gpu.procs = [];
    const r = await caller().releaseStale({ ...OTP_HD, leaseKey: "worker:1:1#khong-co" });
    expect(r.outcome).toBe("refused");
    expect(r.reason).toBe("row-not-in-shared-ledger-replica");
  });

  it("CHƯA làm mới bản sao lần nào ⇒ refused `shared-ledger-never-refreshed` (≠ 'không có hàng nào')", async () => {
    gpu.procs = [];
    const r = await caller().releaseStale({ ...OTP_HD, leaseKey: "worker:999:1#lease-7" });
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

// ══════════════════════════════════════════════════════════════════════════════════════════════
// ★★★ I-2 (review TOÀN NHÁNH 2026-08-06) — **"DANH TÍNH ĐI THẲNG VÀO LỆNH" LÀ HỢP ĐỒNG HAI ĐẦU.**
//
// ⚠⚠⚠ VÌ SAO KHỐI NÀY TỒN TẠI: BỀ RỘNG `owner` HOÀN TOÀN KHÔNG CÓ LƯỚI.
// Đột biến **W2b** của reviewer — `owner.max(160)` → `.max(64)` — làm **cổng ĐẦY ĐỦ (100 file /
// 1692 ca) XANH TOÀN BỘ**. Khoảng 65–160 ký tự là **vùng mù tuyệt đối**: không một ca nào trong
// toàn nhánh ràng buộc bề rộng ô `owner` của **lệnh** với bề rộng mà **sổ chung** có thể phát ra.
// (Reviewer đo thêm: `.max(16)` mới đỏ — và đỏ vì **fixture tình cờ dài hơn 16**, không vì một luật.)
//
// ⚠ Kịch bản hỏng, không giả định: `owner` sản xuất dựng từ **đường dẫn tuyệt đối**
// (`ocrService.ts:384` `onnx-ocr:${modelPath}`). Khi nó vượt trần: mặt đọc phát ra danh tính
// **nguyên vẹn** (đúng N11) ⇒ nút *Thu hồi* **BẬT** (`vramDestructiveButtonDisabled` chỉ hỏi quyền
// + `isPending`, **không** hỏi độ dài); bấm ⇒ zod ném `BAD_REQUEST` **xác thực đầu vào** — không
// phải một `reason` nghiệp vụ, đúng thứ `vramRouter` vừa tuyên bố là không bao giờ xảy ra.
//
// ⇒ Bất biến: ***bề rộng mà LỆNH nhận PHẢI BẰNG bề rộng mà SỔ CHUNG ghi được*** — cả hai đọc
// `VRAM_OWNER_MAX` (`services/vram/vramColumnLimits.ts`), và ca dưới đi qua **đúng schema thật**
// của router bằng `createCaller()`, không dựng lại một zod thứ hai.
// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("★★★ I-2 — bề rộng ô DANH TÍNH: lệnh nhận đúng bằng cái sổ chung ghi được", () => {
  /** Lỗi của một lượt gọi, hoặc `null` nếu nó **không** ném. */
  const loi = (p: Promise<unknown>): Promise<unknown> => p.then(() => null, (e: unknown) => e);

  it("★★★ `owner` DÀI ĐÚNG BẰNG trần sổ chung ⇒ lệnh KHÔNG ném; nó trả DỮ LIỆU có `reason`", async () => {
    const owner = `onnx-ocr:${"d".repeat(VRAM_OWNER_MAX - "onnx-ocr:".length)}`;
    expect(owner.length).toBe(VRAM_OWNER_MAX);

    // ⚠ Đối chứng bên SỔ: đúng chuỗi ấy đi qua `rowFromLease()` mà **KHÔNG bị cắt** ⇒ nó là một
    //   danh tính mà mặt đọc THẬT SỰ có thể phát ra, không phải một chuỗi bịa cho vừa ca test.
    const lease = xinThat({ owner, bytes: 8 * MIB });
    // ★ Pha 6 Task 5 — `rowFromLease()` trả **hàng VÀ lời khai**. Ô BIÊN: dài ĐÚNG BẰNG trần ⇒
    //   `daCat` phải RỖNG (một chuỗi vừa khít **không** bị cắt).
    const { row: hang, daCat } = rowFromLease(lease, 8 * MIB, "role:1", Date.now());
    expect(hang.owner, "sổ chung phải ghi được danh tính này NGUYÊN VẸN").toBe(owner);
    expect(daCat, "dài ĐÚNG BẰNG trần ⇒ KHÔNG được khai là đã cắt").toEqual([]);

    const r = await caller().preempt({ ...OTP_HD, owner });
    expect(r.outcome, "một danh tính hợp lệ KHÔNG được biến thành lỗi xác thực").not.toBeUndefined();
    expect(r.reason, "từ chối NGHIỆP VỤ có lý do đọc được — đó là bằng chứng đã vào thân thủ tục").not.toBeUndefined();

    // Cùng trần cho lệnh KHÔNG phá huỷ — nó cũng nhận `owner` từ chính mặt đọc.
    const rd = await caller().retryDeferred({ owner });
    expect(rd.outcome).toBe("refused");
  });

  it("★★★ `owner` DÀI HƠN trần MỘT ký tự ⇒ TỪ CHỐI (trần của lệnh không được RỘNG hơn cột DB)", async () => {
    /**
     * ⚠ Chiều này cũng bắt buộc: nới router mà **không** nới cột chỉ **dời chỗ nói dối** — sổ chung
     * sẽ cắt âm thầm, hoặc Postgres ném `22001` và `requeueSharedLedgerWrites()` ném lại đúng hàng
     * độc ⇒ hỏng **VĨNH VIỄN**.
     */
    const qua = "x".repeat(VRAM_OWNER_MAX + 1);
    expect(await loi(caller().preempt({ ...OTP_HD, owner: qua })), "vượt trần cột DB phải bị chặn ở cửa").not.toBeNull();
    expect(await loi(caller().retryDeferred({ owner: qua }))).not.toBeNull();
  });

  it("★★★ HAI VẾ ĐỌC CÙNG MỘT HẰNG — sổ chung cắt ở ĐÚNG chỗ lệnh từ chối (không hai con số chép tay)", () => {
    const owner = "y".repeat(VRAM_OWNER_MAX + 40);
    const { row: hang, daCat } = rowFromLease(xinThat({ owner, bytes: 4 * MIB }), 4 * MIB, "role:1", Date.now());
    expect(hang.owner.length, "sổ chung cắt ĐÚNG tại trần").toBe(VRAM_OWNER_MAX);
    // ★ Pha 6 Task 5 — và lượt cắt ấy **được KHAI**, không im lặng như trước.
    expect(daCat, "vượt trần ⇒ phải gọi tên ĐÚNG ô bị cắt").toEqual(["owner"]);
    // Và chuỗi ĐÃ CẮT ấy phải đi ngược qua được LỆNH — nếu không, một hộ của tiến trình anh em sẽ
    // hiện trên mặt đọc với một danh tính mà **không lệnh nào nhận**.
    // ⚠ Đây là ô làm đột biến `.max(64)` ĐỎ: chuỗi dài 160 phải qua được cửa.
    return caller()
      .preempt({ ...OTP_HD, owner: hang.owner })
      .then((r) => {
        expect(r.outcome, "danh tính ĐÃ CẮT của sổ chung phải qua được cửa của lệnh").not.toBeUndefined();
      });
  });

  it("★★ `leaseKey` cũng có đối chứng ở tầng sổ (M-5: `.max(200)` trước đây không có vế nào)", () => {
    const dai = `${"p".repeat(300)}#lease-1`;
    const { row: hang, daCat } = rowFromLease(xinThat({ owner: "sidecar:vision", bytes: MIB }), MIB, dai, Date.now());
    expect(hang.leaseKey.length).toBe(VRAM_LEASE_KEY_MAX);
    // ★ Pha 6 Task 5 — `selfKey` 300 ký tự cắt CẢ BA ô, và cả ba đều phải được gọi tên.
    expect([...daCat].sort(), "MỌI ô bị cắt phải có tên trong lời khai").toEqual(["leaseKey", "processKey", "role"]);
  });
});
