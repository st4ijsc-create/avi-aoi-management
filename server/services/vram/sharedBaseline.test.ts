/**
 * ★★★ Pha 3 Task 3 (N-WB-1) — **NỀN DÙNG CHUNG**: một tiến trình CHỤP, những tiến trình khác ĐỌC.
 *
 * Triệu chứng gốc (review toàn nhánh Pha 2B, nguyên văn): `api` và `worker` **cùng chụp nền trên
 * MỘT thiết bị** ⇒ nền của `api` **nuốt 17 GB của anh em**, và phản ứng duy nhất là 1.024 MiB.
 *
 * ⚠⚠ KHUÔN CỦA BỘ CA — ĐỌC TRƯỚC KHI THÊM CA MỚI (ràng buộc 10: **lưới đi theo ĐƯỜNG THOÁT, không
 * theo FILE**, đã tái diễn MƯỜI lần):
 *   • hai tiến trình được **DỰNG THẬT**: một bảng `vram_leases` giả dùng chung, `__reset*ForTests()`
 *     để đổi "bộ nhớ", `__setSharedLedgerSelfKeyForTests()` để đổi "tôi là ai";
 *   • **KHÔNG ca nào tự đặt `foreignBytes`, `baselineUsedBytes` hay `drift` bằng tay.** Mọi con số
 *     đi qua `reserve()` → `syncSharedLedger()` → `captureVramBaseline()` → `reconcileOnce()`;
 *   • mọi khẳng định đọc **đúng object mã sản xuất gửi đi** (`VramReconcileResult`), không đọc một
 *     bản sao do test dựng.
 *
 * ⚠ FIXTURE PHẢI KHÁC NHAU **ĐÚNG Ở CHIỀU ĐANG KIỂM** (bài học I-2 của Task 2, nơi hai đột biến
 * sống sót 590/590 vì cả năm cặp fixture đều khác VAI TRÒ): ở đây chiều đang kiểm là **hai VẾ**
 * (nền và sổ), nên các ca lõi được dựng để **mỗi vế sai một mình đều cho một con số SAI KHÁC NHAU**
 * — `+17 GB` (quy trách sai) nếu chỉ sửa vế nền, `−17 GB` (trừ hai lần) nếu chỉ sửa vế sổ.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const MIB = 1024 * 1024;
/** Ràng buộc 7 — fixture đủ lớn để phân biệt: khối 30B của tiến trình ANH EM. */
const KHOI_30B = 17_000 * MIB;
/** Nền THẬT của máy (desktop/compositor) — đúng thứ nền sinh ra để hấp thụ. */
const DESKTOP = 1_000 * MIB;
const CEILING = 32_607 * MIB;

/** Thiết bị — biến “thế giới ngoài”, đổi theo kịch bản. */
let thietBiUsedBytes = DESKTOP;
let thietBiSource: "native" | "smi" = "smi";

vi.mock("./vramProbe", () => ({
  readDeviceVram: async () => ({
    usedBytes: thietBiUsedBytes,
    totalBytes: CEILING,
    source: thietBiSource,
  }),
  __clearProbeCache: () => {},
}));

type Holder = { pid: number; name: string };
let hoGiuGpu: {
  holders: Holder[]; ours: Holder[]; peers: Holder[]; orphans: Holder[]; thirdParty: Holder[];
} | null = null;

vi.mock("./vramGpuHolders", () => ({
  readGpuHolders: async () => hoGiuGpu,
}));

import {
  __resetBrokerForTests, commit, reserve, snapshot,
} from "./vramBroker";
import type { VramDecisionContext } from "./vramBroker";
import { applyEnforcement } from "./vramEnforcement";
import { computeHeadroom } from "./vramHeadroom";
import {
  SHARED_BASELINE_KEY, __resetSharedLedgerForTests, __setSharedLedgerSelfKeyForTests,
  baselineFromRow, ownSharedBaseline, readSharedBaseline, readSharedLedgerReplica, rowFromBaseline,
  sharedLedgerFact, sharedLedgerSelfKey,
} from "./vramSharedLedger";
import type { SharedLeaseRow } from "./vramSharedLedger";
import {
  __resetSharedLedgerStoreForTests, __setSharedLedgerGatewayForTests, syncSharedLedger,
} from "./vramSharedLedgerStore";
import type { SharedLedgerGateway } from "./vramSharedLedgerStore";
import {
  __resetVramBaselineForTests, captureVramBaseline, reconcileOnce, sharedBaselineStaleMs,
  sharedBaselineTtlMs,
} from "./vramReconciler";
import { __resetDecisionTickForTests } from "./vramTickCell";
import { distrustUnitBytes } from "./vramEnforcement";

/** Bảng `vram_leases` GIẢ — MỘT bảng, NHIỀU tiến trình. Đây là "thế giới ngoài". */
class BangDungChung implements SharedLedgerGateway {
  rows = new Map<string, SharedLeaseRow>();
  async apply(writes: readonly { op: string; row?: SharedLeaseRow; leaseKey?: string }[]): Promise<void> {
    for (const w of writes) {
      if (w.op === "upsert" && w.row) this.rows.set(w.row.leaseKey, w.row);
      else if (w.op === "delete" && w.leaseKey) this.rows.delete(w.leaseKey);
    }
  }
  async selectAll(): Promise<readonly SharedLeaseRow[]> {
    return [...this.rows.values()];
  }
}

let bang: BangDungChung;

const DESK: Holder[] = [{ pid: 7824, name: "C:\\Windows\\explorer.exe" }];
const ANH_EM: Holder = { pid: 4711, name: "C:\\Program Files\\nodejs\\node.exe" };

function censusSach() {
  return { holders: [...DESK], ours: [], peers: [], orphans: [], thirdParty: [...DESK] };
}
function censusCoAnhEm() {
  return { holders: [ANH_EM, ...DESK], ours: [], peers: [ANH_EM], orphans: [], thirdParty: [...DESK] };
}

/**
 * ĐỔI TIẾN TRÌNH — bộ nhớ khác, danh tính khác, **CÙNG một bảng**. Đây là chỗ duy nhất dựng nên
 * "hai tiến trình"; không ca nào được mô phỏng tiến trình thứ hai bằng cách tự khai một con số.
 */
function chuyenTienTrinh(selfKey: string): void {
  __resetBrokerForTests();
  __resetSharedLedgerForTests();
  __resetSharedLedgerStoreForTests();
  __resetVramBaselineForTests();
  __resetDecisionTickForTests();
  __setSharedLedgerGatewayForTests(bang);
  __setSharedLedgerSelfKeyForTests(selfKey);
}

function xin(owner: string, bytes: number) {
  return { owner, kind: "gguf-model" as const, estimatedBytes: bytes, priority: "interactive" as const };
}

beforeEach(() => {
  bang = new BangDungChung();
  thietBiUsedBytes = DESKTOP;
  thietBiSource = "smi";
  hoGiuGpu = censusSach();
  delete process.env.VRAM_SHARED_BASELINE_STALE_MS;
  chuyenTienTrinh("worker:1001:boot-a");
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  __setSharedLedgerGatewayForTests(null);
  __resetSharedLedgerStoreForTests();
  __resetSharedLedgerForTests();
  __resetBrokerForTests();
  __resetVramBaselineForTests();
  __resetDecisionTickForTests();
  delete process.env.VRAM_SHARED_BASELINE_STALE_MS;
  vi.restoreAllMocks();
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("B. HAI VẾ TRONG MỘT LƯỢT — nền KHÔNG nuốt byte anh em, sổ CÓ cộng byte anh em", () => {
  /**
   * ★★★ CA LÕI. Đây là ca **duy nhất** cần đọc để hiểu cả task, và nó được dựng để **mỗi vế sai
   * một mình đều ĐỎ với một con số khác nhau**:
   *
   *   | mã | nền | vế sổ | `baselineUsedBytes` | `driftBytes` |
   *   |---|---|---|---|---|
   *   | HÔM NAY (Pha 2B) | nuốt anh em | không cộng | **18.000 MiB** | 0 (nhưng đổ oan ngay khi anh em ĐỘNG) |
   *   | chỉ sửa vế NỀN   | trừ anh em  | không cộng | 1.000 MiB | **+17.000 MiB** ⇒ *"cấp phát KHÔNG XIN PHÉP"* |
   *   | chỉ sửa vế SỔ    | nuốt anh em | có cộng     | 18.000 MiB | **−17.000 MiB** (trừ hai lần) |
   *   | ĐÚNG (Task 3)    | trừ anh em  | có cộng     | **1.000 MiB** | **0** |
   */
  it("★★★ B-2 — anh em ĐANG giữ 17.000 MiB lúc ta chụp: nền = 1.000 MiB (nền THẬT), lệch = 0", async () => {
    // ── Tiến trình A: giữ 17.000 MiB và CÔNG BỐ ────────────────────────────────────────────
    const a = reserve(xin("gguf:30B@A", KHOI_30B), ctxTrong());
    expect(a.lease, "A phải được cấp trên card trống").not.toBeNull();
    commit(a.lease!.id, KHOI_30B);
    await syncSharedLedger();

    // ── Tiến trình B: sổ CỤC BỘ rỗng, thiết bị đang có CẢ desktop LẪN khối của A ───────────
    chuyenTienTrinh("api:2002:boot-b");
    hoGiuGpu = censusCoAnhEm();
    thietBiUsedBytes = DESKTOP + KHOI_30B;
    await syncSharedLedger();
    expect(sharedLedgerFact(Date.now())!.foreignBytes, "B phải THẤY khối của A").toBe(KHOI_30B);
    expect(snapshot().totalReservedBytes, "sổ CỤC BỘ của B rỗng").toBe(0);

    const nen = await captureVramBaseline();
    // ★ VẾ NỀN: nền là 1.000 MiB — nền THẬT của máy — chứ KHÔNG phải 18.000 MiB đã nuốt anh em.
    expect(nen, "nền KHÔNG được nuốt 17.000 MiB của anh em").toBe(DESKTOP);

    const r = await reconcileOnce();
    // ★ VẾ SỔ: byte anh em ĐÃ được cộng vào vế sổ — đọc thẳng ô mà mã sản xuất gửi đi.
    expect(r.baselineOrigin).toBe("captured");
    expect(r.foreignLedgerBytes).toBe(KHOI_30B);
    // ★ HAI VẾ KHỚP ⇒ lệch 0, KHÔNG báo động, KHÔNG quy trách nhiệm cho ai.
    expect(r.driftBytes, "hai vế khớp ⇒ lệch phải bằng 0").toBe(0);
    expect(r.alarm).toBe(false);
    expect(r.attributableBytes, "phần quy được cho HỆ = đúng khối anh em đang giữ").toBe(KHOI_30B);
  });

  /**
   * ★★★ Đây là ca dựng lại **đúng triệu chứng nguyên văn**: nền chụp lúc anh em rảnh, rồi anh em
   * nạp model. Trước Task 3, `drift = +17.000 MiB` và nhánh `drift > 0` gọi nó là *"cấp phát
   * KHÔNG XIN PHÉP"* — **quy trách nhiệm SAI cho một hộ hợp lệ**; người trực đi tìm một kẻ không
   * tồn tại.
   */
  it("★★★ B-3 — anh em nạp 17.000 MiB SAU khi ta đã chụp nền ⇒ KHÔNG báo động, KHÔNG gọi ai là 'cấp phát chui'", async () => {
    // A chưa giữ gì; B chụp nền trên một card chỉ có desktop.
    chuyenTienTrinh("api:2002:boot-b");
    await syncSharedLedger();
    expect(await captureVramBaseline()).toBe(DESKTOP);
    expect((await reconcileOnce()).baselineOrigin).toBe("captured");

    // A nạp 17.000 MiB và công bố (một tiến trình khác, cùng bảng).
    const banSaoCuaB = { ...bang.rows };
    void banSaoCuaB;
    chuyenTienTrinh("worker:1001:boot-a");
    const a = reserve(xin("gguf:30B@A", KHOI_30B), ctxTrong());
    commit(a.lease!.id, KHOI_30B);
    await syncSharedLedger();

    // B quay lại: thiết bị nay 18.000 MiB, nhưng nền của B vẫn là 1.000 MiB (đúng).
    chuyenTienTrinh("api:2002:boot-b");
    hoGiuGpu = censusCoAnhEm();
    thietBiUsedBytes = DESKTOP + KHOI_30B;
    await syncSharedLedger();
    await captureVramBaseline();
    const r = await reconcileOnce();

    expect(r.baselineUsedBytes).toBe(DESKTOP);
    expect(r.foreignLedgerBytes).toBe(KHOI_30B);
    expect(r.driftBytes, "khối 17 GB là của anh em, ĐÃ có trong vế sổ ⇒ lệch 0").toBe(0);
    expect(r.alarm, "KHÔNG được đổ oan cho một hộ hợp lệ").toBe(false);
  });

  /**
   * ★★ Vế còn lại của cùng một bất biến: một khoản cấp phát **THẬT SỰ** ngoài mọi cuốn sổ vẫn phải
   * lộ ra. Không có ca này thì "sửa lệch về 0" có thể đạt được bằng cách làm chuông CÂM.
   */
  it("★★ B-4 — hộ NGOÀI MỌI CUỐN SỔ vẫn bị bắt: 2.000 MiB không ai khai ⇒ báo động LỆCH DƯƠNG", async () => {
    chuyenTienTrinh("api:2002:boot-b");
    await syncSharedLedger();
    await captureVramBaseline();

    // Một hộ lạ chiếm 2.000 MiB — không sổ nào (cục bộ lẫn chung) khai nó.
    thietBiUsedBytes = DESKTOP + 2_000 * MIB;
    const r = await reconcileOnce();
    expect(r.driftBytes).toBe(2_000 * MIB);
    expect(r.alarm, "chuông vẫn phải kêu cho khoản NGOÀI mọi cuốn sổ").toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("C. MỘT NGƯỜI CHỤP — những người khác ĐỌC", () => {
  it("★★★ C-1 — tiến trình thứ hai KHÔNG tự chụp: nó ĐỌC nền của người chụp và THÔI công bố", async () => {
    // A chụp và công bố.
    await syncSharedLedger();
    expect(await captureVramBaseline()).toBe(DESKTOP);
    expect(ownSharedBaseline(), "A là NGƯỜI CHỤP ⇒ có nền để công bố").not.toBeNull();
    await syncSharedLedger();
    const hangNen = bang.rows.get(SHARED_BASELINE_KEY);
    expect(hangNen, "hàng nền phải có mặt trong bảng dùng chung").toBeDefined();
    expect(hangNen!.processKey).toBe("worker:1001:boot-a");

    // B lên. Thiết bị y nguyên.
    chuyenTienTrinh("api:2002:boot-b");
    await syncSharedLedger();
    expect(readSharedBaseline()?.processKey, "B phải THẤY hàng nền của A").toBe("worker:1001:boot-a");

    const nen = await captureVramBaseline();
    const r = await reconcileOnce();
    expect(nen).toBe(DESKTOP);
    // ★ ĐỌC, KHÔNG CHỤP — đây là dòng phân biệt "một người chụp" với "hai người cùng chụp".
    expect(r.baselineOrigin, "B phải ĐỌC nền của A, KHÔNG tự chụp").toBe("adopted");
    expect(ownSharedBaseline(), "B KHÔNG được công bố nền của mình").toBeNull();

    await syncSharedLedger();
    expect(
      bang.rows.get(SHARED_BASELINE_KEY)!.processKey,
      "hàng nền vẫn thuộc về NGƯỜI CHỤP — B không được giành",
    ).toBe("worker:1001:boot-a");
    expect(
      [...bang.rows.keys()].filter((k) => k === SHARED_BASELINE_KEY).length,
      "ĐÚNG MỘT hàng nền trên cả cụm",
    ).toBe(1);
  });

  /**
   * ★★★ **KHÔNG AI THẮNG BẦU** — brief đòi ghi rõ, và đây là chỗ dễ hỏng nhất: rơi về `attributable
   * = null` là **NỚI LỎNG** (`max(L,A) ≥ L` ⇒ chỉ-sổ là CHẶN TRÊN của mọi dư địa), không phải an
   * toàn. Trạng thái đúng là: **VẪN có số**, chế độ `"local"`, và **CÓ TIẾNG**.
   */
  it("★★★ C-2 — KHÔNG có sổ chung ⇒ KHÔNG ai thắng bầu: vẫn có nền (chế độ 'local'), KHÔNG âm thầm về nhánh rộng", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    // KHÔNG một lượt `syncSharedLedger()` nào ⇒ bản sao đọc `null` ⇒ không có cuộc bầu nào.
    expect(readSharedLedgerReplica(), "chưa hỏi sổ chung lần nào").toBeNull();
    hoGiuGpu = censusCoAnhEm();
    thietBiUsedBytes = DESKTOP + KHOI_30B;

    const nen = await captureVramBaseline();
    const r = await reconcileOnce();

    // ★ CÓ SỐ — tuyệt đối không `null`.
    expect(nen, "không có sổ chung ⇒ vẫn chụp, theo công thức CỤC BỘ (Pha 2B)").toBe(DESKTOP + KHOI_30B);
    expect(r.attributableBytes, "KHÔNG được rơi về chỉ-sổ (nhánh RỘNG NHẤT)").not.toBeNull();
    // ★ CHẾ ĐỘ ĐƯỢC KHAI, và vế sổ KHÔNG cộng byte anh em (nền đã nuốt ⇒ cộng là TRỪ HAI LẦN).
    expect(r.baselineOrigin).toBe("local");
    expect(r.foreignLedgerBytes).toBe(0);
    expect(r.driftBytes, "chế độ local: hai vế vẫn khớp với NHAU (y hệt Pha 2B)").toBe(0);
    // ★ CÓ TIẾNG — im lặng ở đây là "âm thầm rơi về nhánh rộng".
    expect(
      warnSpy.mock.calls.map((c) => String(c[0] ?? "")).join("\n"),
      "phải nói rõ nền đang chụp CỤC BỘ và đã nuốt byte anh em",
    ).toMatch(/SỔ CHUNG CHƯA ĐỌC ĐƯỢC/);
    // ★ …và cờ xác minh vẫn TẮT vì thấy vai trò anh em (cơ chế Pha 2B giữ nguyên).
    expect(r.baselineVerified).toBe(false);
  });

  /**
   * ★★ Đường NÂNG CẤP: một tiến trình đã chụp ở chế độ `"local"` (đúng lúc chưa có sổ chung) phải
   * tự chuyển sang chế độ chung ngay nhịp đầu đọc được sổ — nếu không, 17 GB nằm trong nền cho tới
   * lúc khởi động lại.
   */
  it("★★ C-3 — nền 'local' được CHỤP LẠI đúng một lần khi sổ chung lên, rồi THÔI (không chụp lại mỗi nhịp)", async () => {
    hoGiuGpu = censusCoAnhEm();
    thietBiUsedBytes = DESKTOP + KHOI_30B;
    // Nhịp 1: chưa có sổ chung.
    await captureVramBaseline();
    expect((await reconcileOnce()).baselineOrigin).toBe("local");

    // Anh em công bố khối của mình vào bảng (một tiến trình khác).
    const tam = sharedLedgerSelfKey();
    chuyenTienTrinh("worker:1001:boot-a");
    const a = reserve(xin("gguf:30B@A", KHOI_30B), ctxTrong());
    commit(a.lease!.id, KHOI_30B);
    await syncSharedLedger();
    void tam;

    // Quay lại tiến trình đang ở chế độ `local` — dựng lại nó bằng đúng đường đi của nhịp 1.
    chuyenTienTrinh("api:2002:boot-b");
    hoGiuGpu = censusCoAnhEm();
    await captureVramBaseline(); // chưa sync ⇒ vẫn `local`
    expect((await reconcileOnce()).baselineOrigin).toBe("local");
    expect((await reconcileOnce()).baselineUsedBytes).toBe(DESKTOP + KHOI_30B);

    // Nhịp sau: sổ chung đọc được ⇒ NÂNG CẤP.
    await syncSharedLedger();
    await captureVramBaseline();
    const r = await reconcileOnce();
    expect(r.baselineOrigin, "phải nâng cấp sang chế độ chung").toBe("captured");
    expect(r.baselineUsedBytes, "nền nay là nền THẬT").toBe(DESKTOP);

    /**
     * ★★★ VÀ ĐÂY LÀ NỬA QUAN TRỌNG HƠN: **KHÔNG chụp lại ở nhịp kế.** Chụp lại mỗi nhịp thì mọi
     * khoản cấp phát chui bị hấp thụ vào nền ngay nhịp sau và `drift` MẤT HẲN khả năng phát hiện
     * — đúng lớp "cơ chế phòng vệ mới vô hiệu hoá cơ chế cũ" đã tái diễn ba lần.
     */
    thietBiUsedBytes = DESKTOP + KHOI_30B + 2_000 * MIB; // một hộ lạ xuất hiện
    await captureVramBaseline();
    const r2 = await reconcileOnce();
    expect(r2.baselineUsedBytes, "nền KHÔNG được chụp lại (nếu chụp lại nó sẽ nuốt hộ lạ)").toBe(DESKTOP);
    expect(r2.driftBytes).toBe(2_000 * MIB);
    expect(r2.alarm).toBe(true);
  });

  it("★★ C-4 — hàng nền QUÁ HẠN (chủ nhân coi như đã chết) ⇒ tiến trình đọc GIÀNH lại vai người chụp", async () => {
    await syncSharedLedger();
    await captureVramBaseline();
    await syncSharedLedger();
    expect(bang.rows.get(SHARED_BASELINE_KEY)!.processKey).toBe("worker:1001:boot-a");

    chuyenTienTrinh("api:2002:boot-b");
    // "Thế giới ngoài": hàng nền đã nằm đó lâu hơn hạn — chủ nhân không còn nhịp sống nào.
    const cu = bang.rows.get(SHARED_BASELINE_KEY)!;
    bang.rows.set(SHARED_BASELINE_KEY, {
      ...cu,
      updatedAtMs: Date.now() - sharedBaselineTtlMs() - 1_000,
    });
    await syncSharedLedger();

    await captureVramBaseline();
    const r = await reconcileOnce();
    expect(r.baselineOrigin, "hàng quá hạn ⇒ KHÔNG đọc số của một tiến trình đã chết").toBe("captured");
    expect(ownSharedBaseline()?.processKey, "B nay là NGƯỜI CHỤP").toBe("api:2002:boot-b");
    await syncSharedLedger();
    expect(
      bang.rows.get(SHARED_BASELINE_KEY)!.processKey,
      "hàng nền phải CHUYỂN CHỦ — thiếu cột danh tính trong ON CONFLICT thì nó kẹt ở chủ cũ",
    ).toBe("api:2002:boot-b");
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("D. DUNG SAI CHO BẢN SAO CŨ, và `baselineVerified` là VỊ TỪ DÙNG CHUNG", () => {
  /**
   * ⚠ Bản sao đọc chỉ được làm mới **theo nhịp reconciler**, nên MỌI hàng nền đọc được đều "cũ" tới
   * một chu kỳ. Không có dung sai thì cờ xác minh TẮT VĨNH VIỄN ở mọi tiến trình đọc — và *một cờ
   * luôn bật là một cờ không còn thông tin* (bài học I-3 của Task 2).
   */
  it("★★★ D-1 — nền đọc được, bản sao cũ ≤ 60 s ⇒ GIỮ cờ xác minh; cũ hơn ⇒ HẠ cờ (không hạ CON SỐ)", async () => {
    await syncSharedLedger();
    await captureVramBaseline();
    await syncSharedLedger();
    expect(bang.rows.get(SHARED_BASELINE_KEY)!.measured, "A khai nền ĐÃ XÁC MINH").toBe(true);

    // (a) bản sao TƯƠI.
    chuyenTienTrinh("api:2002:boot-b");
    await syncSharedLedger();
    await captureVramBaseline();
    const tuoi = await reconcileOnce();
    expect(tuoi.baselineOrigin).toBe("adopted");
    expect(tuoi.baselineVerified, "trong dung sai ⇒ giữ nguyên lời khai của người chụp").toBe(true);

    // (b) hàng nền cũ hơn dung sai (nhưng CHƯA quá hạn) — "thế giới ngoài" đổi.
    chuyenTienTrinh("api:2002:boot-b");
    const cu = bang.rows.get(SHARED_BASELINE_KEY)!;
    bang.rows.set(SHARED_BASELINE_KEY, {
      ...cu,
      updatedAtMs: Date.now() - sharedBaselineStaleMs() - 5_000,
    });
    await syncSharedLedger();
    await captureVramBaseline();
    const cuHon = await reconcileOnce();
    expect(cuHon.baselineOrigin, "vẫn ĐỌC — chưa quá hạn").toBe("adopted");
    expect(cuHon.baselineVerified, "quá dung sai ⇒ HẠ cờ").toBe(false);
    expect(cuHon.baselineUsedBytes, "…nhưng KHÔNG hạ CON SỐ (bỏ số là NỚI dư địa)").toBe(DESKTOP);
  });

  /**
   * ★★★ RÀNG BUỘC 4 CỦA BRIEF — `baselineVerified` là **VỊ TỪ DÙNG CHUNG với `applyEnforcement`**.
   * Ca này đi qua **đúng đường sản xuất** (`computeHeadroom` → `applyEnforcement`) và khoá bằng SỐ:
   * hạ cờ phải làm dư địa hiệu lực nhỏ đi **đúng một đơn vị mất-tin-cậy**, không phải "được ghi ra
   * đâu đó". Đổi cờ ở một nơi mà quên nơi kia là đúng lớp lỗi đã tái diễn BA lần.
   */
  it("★★★ D-2 — cờ xác minh của nền ĐỌC ĐƯỢC đi thẳng vào `applyEnforcement` (đo bằng BYTE)", async () => {
    await syncSharedLedger();
    await captureVramBaseline();
    await syncSharedLedger();

    async function duDiaHieuLuc(lamCu: boolean): Promise<number> {
      chuyenTienTrinh("api:2002:boot-b");
      const cu = bang.rows.get(SHARED_BASELINE_KEY)!;
      bang.rows.set(SHARED_BASELINE_KEY, {
        ...cu,
        updatedAtMs: lamCu ? Date.now() - sharedBaselineStaleMs() - 5_000 : Date.now(),
      });
      await syncSharedLedger();
      await captureVramBaseline();
      const r = await reconcileOnce();
      const now = readSharedLedgerReplica()!.atMs;
      const headroom = computeHeadroom({
        deviceTotalBytes: CEILING,
        ledgerTotalBytes: r.ledgerTotalBytes,
        attributableBytes: r.attributableBytes,
        tickPresent: true,
        tickAgeMs: 0,
        tickFailureStreak: 0,
        // ★ ĐỌC ĐÚNG Ô MÀ MÃ SẢN XUẤT GỬI ĐI — không tự đặt cờ.
        baselineVerified: r.baselineVerified,
        safetyReserveBytes: 0,
      });
      return applyEnforcement({
        headroom,
        unledgered: { bytes: 0, unknownCount: 0 },
        sharedLedger: sharedLedgerFact(now),
        nowMs: now,
      }).effectiveHeadroomBytes;
    }

    const tuoi = await duDiaHieuLuc(false);
    const cu = await duDiaHieuLuc(true);
    expect(cu, "cờ hạ ⇒ hệ CHẶT HƠN đúng một đơn vị mất-tin-cậy").toBe(tuoi - distrustUnitBytes());
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
describe("E. HÀNG NỀN KHÔNG PHẢI MỘT GIẤY PHÉP", () => {
  it("★★★ E-1 — hàng nền TUYỆT ĐỐI không được cộng vào `foreignBytes` (cộng vào là trừ nền HAI LẦN)", async () => {
    await syncSharedLedger();
    await captureVramBaseline();
    await syncSharedLedger();

    chuyenTienTrinh("api:2002:boot-b");
    await syncSharedLedger();
    expect(bang.rows.size, "bảng chỉ có ĐÚNG hàng nền (A không giữ giấy phép nào)").toBe(1);
    const ban = readSharedLedgerReplica()!;
    expect(ban.baseline, "hàng nền phải đi ra ở ô RIÊNG").not.toBeNull();
    expect(ban.foreignBytes, "…và KHÔNG được lẫn vào byte của anh em").toBe(0);
    expect(ban.foreignLeases, "…cũng không được nằm trong danh sách giấy phép").toEqual([]);
  });

  it("★★ E-2 — khoá hàng nền KHÔNG THỂ trùng một giấy phép thật (giấy phép luôn chứa '#')", async () => {
    reserve(xin("gguf:30B@A", KHOI_30B), ctxTrong());
    await syncSharedLedger();
    await captureVramBaseline();
    await syncSharedLedger();
    expect(SHARED_BASELINE_KEY.includes("#"), "khoá hàng nền KHÔNG chứa '#'").toBe(false);
    for (const k of bang.rows.keys()) {
      if (k === SHARED_BASELINE_KEY) continue;
      expect(k, "mọi khoá GIẤY PHÉP đều là `${processKey}#${leaseId}`").toContain("#");
    }
  });

  it("★★ E-3 — bản dịch hàng nền đi-về là ĐỒNG NHẤT, và một hàng có thước lạ bị TỪ CHỐI (không đoán)", () => {
    const goc = {
      processKey: "worker:9:boot-x", pid: 9, bytes: DESKTOP,
      source: "native" as const, verified: true, atMs: 1_700_000_000_000,
    };
    expect(baselineFromRow(rowFromBaseline(goc))).toEqual(goc);
    const thuocLa = { ...rowFromBaseline(goc), leaseId: "guess" };
    expect(baselineFromRow(thuocLa), "thước lạ ⇒ KHÔNG có nền dùng chung, KHÔNG đoán 'smi'").toBeNull();
    const byteHong = { ...rowFromBaseline(goc), bytes: Number.NaN };
    expect(baselineFromRow(byteHong)).toBeNull();
  });

  /**
   * ⚠ `?? mặc_định` LÀ MỘT DÂY — dây phải có LƯỚI (ràng buộc 4). Hai mép: số rác ⇒ mặc định
   * (KHÔNG thành 0 = mọi nền đọc được lập tức "cũ" ⇒ cờ tắt vĩnh viễn), số hợp lệ ⇒ dùng.
   */
  it("★★ E-4 — dung sai đọc `.env` MỖI lượt, số rác về mặc định 60 s, và hạn = 3× dung sai", () => {
    delete process.env.VRAM_SHARED_BASELINE_STALE_MS;
    expect(sharedBaselineStaleMs()).toBe(60_000);
    expect(sharedBaselineTtlMs()).toBe(180_000);
    process.env.VRAM_SHARED_BASELINE_STALE_MS = "rác";
    expect(sharedBaselineStaleMs()).toBe(60_000);
    process.env.VRAM_SHARED_BASELINE_STALE_MS = "0";
    expect(sharedBaselineStaleMs(), "0 là một dung sai VÔ NGHĨA ⇒ mặc định").toBe(60_000);
    process.env.VRAM_SHARED_BASELINE_STALE_MS = "10000";
    expect(sharedBaselineStaleMs()).toBe(10_000);
    expect(sharedBaselineTtlMs()).toBe(30_000);
  });
});

/** Ngữ cảnh quyết định TRỐNG — chỉ để `reserve()` chạy được ở tiến trình đang dựng dữ liệu. */
function ctxTrong(): VramDecisionContext {
  const now = Date.now();
  return {
    tick: { attributableBytes: 0, baselineVerified: true, atMs: now, consecutiveFailures: 0 },
    unledgered: { bytes: 0, unknownCount: 0 },
    sharedLedger: sharedLedgerFact(now),
    nowMs: now,
  };
}
