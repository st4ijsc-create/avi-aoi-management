/**
 * ★★★ Pha 3 Task 2 — LƯỚI ĐI THEO **ĐƯỜNG THOÁT**, KHÔNG THEO FILE (ràng buộc toàn cục 10).
 *
 * ⚠⚠ VÌ SAO FILE NÀY PHẢI TỒN TẠI RIÊNG, và vì sao `sharedLedger.test.ts` KHÔNG đủ:
 * bộ ca kia gọi thẳng `vramBroker.reserve()` và **tự truyền** `ctx.sharedLedger`. Nó chứng minh
 * *cơ chế* đúng, nhưng **không nói một chữ nào** về việc mã sản xuất có thật sự đọc ô ấy không.
 * Đây đúng lớp lỗi đã tái diễn **SÁU lần** trong chuỗi này, gần nhất ở chính Task 1 (vô hiệu
 * `setLeaseRefCount` ⇒ 559/559 VẪN XANH, vì hai nửa lưới đứng hai đầu sợi dây mà không nửa nào đi
 * qua dây).
 *
 * ⇒ Ca dưới đây đi **HẾT** đường thật, không một mắt xích nào bị thay:
 *   bảng `vram_leases` (giả — biên của thế giới ngoài, cùng hạng `fs`/`fetch`)
 *     → `syncSharedLedger()`  → ô thật `vramSharedLedger`
 *     → `beginVramAllocation()` (mã sản xuất) → `sharedLedgerFact()` → `broker.reserve()`
 *     → `VramRefusedError` NÉM RA.
 * Không ca nào tự đặt `foreignBytes`, không ticket giả, không số do ca test tự khai.
 *
 * ⚠ MỘT THẾ HỆ, KHÔNG `vi.resetModules()` — GOTCHA của Task 1: nhà máy `vi.mock` không đi theo
 * vòng đời `resetModules()`, và ô sổ chung là **trạng thái mức module**; hai thế hệ thì ô mà
 * `syncSharedLedger()` ghi vào KHÔNG phải ô mà `vramWiring` đọc, và ca sẽ xanh/đỏ vì lý do sai.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetBrokerForTests, snapshot } from "./vramBroker";
import { __resetSharedLedgerForTests, __setSharedLedgerSelfKeyForTests } from "./vramSharedLedger";
import type { SharedLeaseRow, SharedLedgerWrite } from "./vramSharedLedger";
import {
  __resetSharedLedgerStoreForTests, __setSharedLedgerGatewayForTests, syncSharedLedger,
} from "./vramSharedLedgerStore";
import type { SharedLedgerGateway } from "./vramSharedLedgerStore";
import { __resetDecisionTickForTests, publishDecisionTick } from "./vramTickCell";
import { beginVramAllocation } from "./vramWiring";
import { formatVramRefusal, VramRefusedError } from "./vramRefusal";

const MIB = 1024 * 1024;
/** Ràng buộc 7 — fixture đủ lớn để phân biệt. Khối 30B. */
const KHOI_30B = 17_000 * MIB;
const ANH_EM = "worker:99999:boot-khac";

/** Bảng dùng chung GIẢ. Nội dung do ca test đặt = "tiến trình anh em đã ghi gì vào đó". */
const bang = { rows: [] as SharedLeaseRow[] };

const gateway: SharedLedgerGateway = {
  async apply(writes: readonly SharedLedgerWrite[]) {
    for (const w of writes) {
      const i = bang.rows.findIndex((r) => r.leaseKey === w.leaseKey);
      if (w.op === "delete") {
        if (i >= 0) bang.rows.splice(i, 1);
      } else if (i >= 0) bang.rows[i] = w.row;
      else bang.rows.push(w.row);
    }
  },
  async selectAll() {
    return [...bang.rows];
  },
};

function hangCuaAnhEm(bytes: number): SharedLeaseRow {
  return {
    leaseKey: `${ANH_EM}#lease-1`,
    processKey: ANH_EM,
    pid: 99999,
    role: "worker",
    leaseId: "lease-1",
    owner: "gguf:qwen30b@worker",
    leaseKind: "gguf-model",
    priority: "interactive",
    bytes,
    measured: true,
    refCount: 1,
    reclaimer: null,
    acquiredAtMs: Date.now() - 1000,
    updatedAtMs: Date.now() - 1000,
  };
}

beforeEach(() => {
  bang.rows = [];
  __resetBrokerForTests();
  __resetSharedLedgerForTests();
  __resetSharedLedgerStoreForTests();
  __resetDecisionTickForTests();
  __setSharedLedgerGatewayForTests(gateway);
  __setSharedLedgerSelfKeyForTests("api:1:boot-toi");
  // Ô tick SẠCH: mọi phụ phí KHÁC bằng 0 ⇒ thứ duy nhất đổi được kết cục là sổ chung.
  publishDecisionTick({ attributableBytes: 0, baselineVerified: true }, Date.now());
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterAll(() => {
  __setSharedLedgerGatewayForTests(null);
  __resetSharedLedgerStoreForTests();
  __resetSharedLedgerForTests();
  __resetBrokerForTests();
  __resetDecisionTickForTests();
});

const xin = (bytes: number) => ({
  owner: "gguf:coder@api",
  kind: "gguf-model" as const,
  priority: "interactive" as const,
  fileBytes: bytes,
});

describe("Pha 3 Task 2 — ĐƯỜNG SẢN XUẤT đọc ô sổ chung THẬT", () => {
  it("★★★ W-1 — anh em giữ 17.000 MiB ⇒ `beginVramAllocation()` NÉM `VramRefusedError`", async () => {
    bang.rows = [hangCuaAnhEm(KHOI_30B)];
    await syncSharedLedger();

    // 17.000 MiB nữa KHÔNG vừa khi anh em đã giữ 17.000 MiB trên card 32.607 MiB.
    await expect(
      beginVramAllocation(xin(KHOI_30B)),
      "đường sản xuất PHẢI thấy giấy phép của tiến trình anh em",
    ).rejects.toBeInstanceOf(VramRefusedError);

    expect(snapshot().leases.length, "bị từ chối ⇒ KHÔNG có giấy phép cục bộ nào được mở").toBe(0);
  });

  it("★★★ W-2 — ĐỐI CHỨNG: bảng RỖNG ⇒ đúng lượt xin đó được CẤP (ca W-1 đo đúng thứ nó nói)", async () => {
    bang.rows = [];
    await syncSharedLedger();

    const ve = await beginVramAllocation(xin(KHOI_30B));
    expect(snapshot().leases.length, "không ai giữ gì ⇒ phải cấp").toBe(1);
    ve.release();
  });

  it("★★★ W-3 — câu TỪ CHỐI gọi tên số của anh em, không giấu nó vào một con số chung", async () => {
    bang.rows = [hangCuaAnhEm(KHOI_30B)];
    await syncSharedLedger();

    const err = await beginVramAllocation(xin(KHOI_30B)).then(
      () => null,
      (e: unknown) => e as VramRefusedError,
    );
    expect(err).toBeInstanceOf(VramRefusedError);
    // `usedBytes = max(sổ, attributable)`; sổ nay GỒM CẢ anh em ⇒ con số người trực đọc phải ≥ 17.000 MiB.
    expect(err!.facts.unattributedBytes ?? 0).toBeLessThanOrEqual(0);
    expect(
      err!.facts.availableBytes ?? Number.POSITIVE_INFINITY,
      "dư địa in ra phải là dư địa ĐÃ TRỪ phần của anh em",
    ).toBeLessThan(32_607 * MIB - KHOI_30B);

    /**
     * ★★★ M-6 (review vòng 1) — **CÂU CHỮ PHẢI GỌI TÊN PHẦN CỦA ANH EM.** `holders` của B **RỖNG**
     * trong khi dư địa của nó bị trừ 17.825.792.000 B; câu rào đón *"chỉ các hộ ĐÃ NỐI SỔ"* nói về
     * **điểm cấp phát chưa nối**, KHÔNG về **tiến trình khác** ⇒ người trực đọc *"còn X MiB, đang
     * giữ: (không có)"* rồi kết luận **con số dư địa SAI** và đi tìm lỗi ở chỗ không có lỗi.
     */
    expect(err!.facts.foreignLedgerBytes, "sự thật từ chối phải MANG con số của anh em").toBe(KHOI_30B);
    expect(err!.facts.holders, "và danh sách hộ CỤC BỘ đúng là RỖNG — đó chính là vấn đề").toEqual([]);
    const cau = formatVramRefusal(err!.facts);
    expect(cau, "câu từ chối phải NÓI RA rằng có tiến trình khác").toMatch(/TIẾN TRÌNH KHÁC/);
    expect(cau).toContain("17000 MiB");
  });

  it("★★★ W-4 — giấy phép của TA đi RA sổ chung qua đúng đường sản xuất (nửa còn lại của 'một sổ')", async () => {
    bang.rows = [];
    await syncSharedLedger();

    const ve = await beginVramAllocation(xin(5_000 * MIB));
    await syncSharedLedger();
    expect(bang.rows.length, "anh em phải THẤY được giấy phép của ta").toBe(1);
    expect(bang.rows[0]!.owner).toBe("gguf:coder@api");
    expect(bang.rows[0]!.processKey).toBe("api:1:boot-toi");

    // ⚠⚠ Và lượt NHẢ phải phát lệnh xoá TỪ CHÍNH `release()` — không đợi ai đó thấy hàng biến mất.
    ve.release();
    await syncSharedLedger();
    expect(bang.rows.length, "release() phải RÚT hàng khỏi sổ chung").toBe(0);
  });

  it("★★★ W-5 — NHỊP 60 s làm mới bản sao đọc (đây là chỗ '60 s' trở thành một con số THẬT)", async () => {
    bang.rows = [hangCuaAnhEm(KHOI_30B)];
    const { readSharedLedgerReplica } = await import("./vramSharedLedger");
    expect(readSharedLedgerReplica(), "trước nhịp: chưa làm mới lần nào").toBeNull();

    /**
     * ⚠ Gọi ĐÚNG hàm mà `setInterval(…, INTERVAL_MS)` gọi — không gọi `syncSharedLedger()` thẳng.
     * Đây là dây nối duy nhất giữa sổ chung và cái đồng hồ 60 s; đứt nó thì bản sao đọc **không
     * bao giờ tự làm mới** và cả cơ chế lùi về Pha 2B trong im lặng.
     * ⚠ Nhịp có thể NÉM vì đầu dò (bộ ca này cố ý không giả `vramProbe`) — không sao: lượt đồng bộ
     * nằm trong `finally`, tức được bắn **kể cả khi nhịp ném**. Đó chính là điều ca này khoá lại.
     * ⚠ `vi.waitFor` chứ không phải đọc thẳng: lượt đồng bộ được **bắn-rồi-đi** (không `await`) để
     * thời lượng nhịp đối chiếu không buộc vào độ trễ DB — xem khối docstring ở `__runReconcileTick`.
     */
    const { __runReconcileTick } = await import("./vramReconciler");
    await __runReconcileTick().catch(() => {});

    await vi.waitFor(() => expect(readSharedLedgerReplica()).not.toBeNull());
    expect(readSharedLedgerReplica()!.foreignBytes).toBe(KHOI_30B);
  });
});
