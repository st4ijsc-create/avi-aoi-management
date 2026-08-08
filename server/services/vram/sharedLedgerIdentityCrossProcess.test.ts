/**
 * ★★★ Pha 7 Task 5 (B) — **CỜ "ĐÃ CẮT DANH TÍNH" ĐI QUA BIÊN TIẾN TRÌNH.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ CÂU MÀ FILE NÀY KHOÁ, VÀ VÌ SAO NÓ KHÔNG PHẢI CÂU MÀ PHA 6 ĐÃ KHOÁ
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Pha 6 Task 5 khoá: *"tiến trình GHI biết nó vừa cắt"* (`truncatedIdentityWrites` dựng từ
 * `hangDaCat`, một `Set` **trong bộ nhớ NGƯỜI GHI**). Bước 1 của Pha 7 đo được rằng câu ấy
 * **dừng ở biên tiến trình**:
 *   • **B1** — tiến trình **anh em** đọc đúng hàng ấy: `owner` dài 160, và **KHÔNG một ô nào**
 *     của hàng nói nó đã mất chữ;
 *   • **B3** — mặt đọc của anh em khai `truncatedIdentityWrites = 0` **trong khi đang nhìn** một
 *     hàng cụt.
 * Nay luật là: ***∀ người đọc một hàng đã bị cắt — kể cả một TIẾN TRÌNH KHÁC — người ấy BIẾT.***
 *
 * ⚠⚠ **BA GIÁ TRỊ, KHÔNG PHẢI HAI.** `null` = KHÔNG BIẾT (người ghi là bản CŨ) ≠ `[]` = khai không
 * cắt. Ép `null` về `[]` là khai *"tên thật"* cho một hàng ta không có bằng chứng gì — đúng
 * fail-open mà cả lượt này sinh ra để đóng, chỉ dời lên một tầng.
 *
 * ⚠ FILE **TÁCH RIÊNG** khỏi lưới mục (A): đã đo ở Bước 1 rằng `vi.resetModules()` của mục A làm
 *   lượt `await import("./vramBroker")` **muộn** trong `dungLaiTuSoCucBo()` nhận một bản sao module
 *   **mới, sổ RỖNG** ⇒ mục B đo nhầm thứ. Hai mục, hai file.
 */
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { VRAM_LEASE_COLUMN_MAX } from "./vramColumnLimits";
import { __resetBrokerForTests, reserve } from "./vramBroker";
import type { VramDecisionContext } from "./vramBroker";
import {
  __resetSharedLedgerForTests, __setSharedLedgerSelfKeyForTests, readSharedLedgerReplica,
  rowFromLease, sharedLedgerFact,
} from "./vramSharedLedger";
import type { SharedLeaseRow } from "./vramSharedLedger";
import {
  __resetSharedLedgerStoreForTests, __setSharedLedgerGatewayForTests, syncSharedLedger,
} from "./vramSharedLedgerStore";
import type { SharedLedgerGateway } from "./vramSharedLedgerStore";
import { __resetDecisionTickForTests, publishDecisionTick, __tickFieldsForTests } from "./vramTickCell";

const MIB = 1024 * 1024;
const NOW = 1_700_000_000_000;

/** `owner` đúng hình dạng sản xuất (`reranker:` + đường dẫn tuyệt đối), **vượt trần**. */
const OWNER_QUA_TRAN = `reranker:${"C:\\Users\\Admin\\models\\".repeat(14)}bge-reranker-v2-m3-Q8_0.gguf`;
/** `owner` sản xuất HÔM NAY — 54 ký tự, **không** vượt trần. Nền của mọi ca "không bắt nhầm". */
const OWNER_NGAN = "reranker:D:\\SOURCES\\16.AI\\bge-reranker-v2-m3-Q8_0.gguf";

/**
 * Bảng `vram_leases` GIẢ — **sống qua cả hai "tiến trình"**, đúng vai "thế giới ngoài".
 * ⚠ Nó chỉ lưu và trả lại `SharedLeaseRow`, **không diễn giải gì** — nên một ô mới của hàng đi qua
 *   đây **tự động**, và ca này đo đúng cái đường thoát thật đi qua.
 */
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

const bayGio = (): number => readSharedLedgerReplica()?.atMs ?? NOW;
function ctx(): VramDecisionContext {
  const now = bayGio();
  return {
    tick: { ...__tickFieldsForTests(0, true), atMs: now, consecutiveFailures: 0 },
    unledgered: { bytes: 0, unknownCount: 0 },
    sharedLedger: sharedLedgerFact(now),
    nowMs: now,
  };
}

/** Dựng lại toàn bộ trạng thái **trong bộ nhớ** nhưng GIỮ nguyên bảng ⇒ đúng mô hình "tiến trình anh em". */
function tienTrinhAnhEm(key: string): void {
  __resetBrokerForTests();
  __resetSharedLedgerForTests();
  __setSharedLedgerGatewayForTests(bang);
  __setSharedLedgerSelfKeyForTests(key);
  publishDecisionTick(__tickFieldsForTests(0, true), NOW);
}

beforeEach(() => {
  bang = new BangDungChung();
  __resetBrokerForTests();
  __resetSharedLedgerForTests();
  __resetSharedLedgerStoreForTests();
  __resetDecisionTickForTests();
  __setSharedLedgerGatewayForTests(bang);
  publishDecisionTick(__tickFieldsForTests(0, true), NOW);
});

afterEach(() => {
  __setSharedLedgerGatewayForTests(null);
  __resetSharedLedgerStoreForTests();
  __resetSharedLedgerForTests();
  __resetBrokerForTests();
  __resetDecisionTickForTests();
  __setSharedLedgerSelfKeyForTests(null);
});

/** A ghi một giấy phép có `owner` cho trước, rồi đồng bộ. Trả lại hàng đã lên bảng. */
async function aGhi(owner: string): Promise<SharedLeaseRow> {
  __setSharedLedgerSelfKeyForTests("api:1001:boot-a");
  const r = reserve({ owner, kind: "gguf-model", estimatedBytes: 64 * MIB, priority: "background" }, ctx());
  expect(r.lease, "ca này cần một giấy phép được cấp").not.toBeNull();
  await syncSharedLedger();
  const hang = [...bang.rows.values()].find((x) => x.leaseKey.startsWith("api:1001:boot-a#"));
  expect(hang, "hàng của A phải lên được bảng").toBeTruthy();
  return hang!;
}

/**
 * ★★★ **ĐƯỜNG THOÁT THẬT TỚI AGENT** — registry → handler → `textSummary`, đúng chuỗi mà LLM nhận.
 * ⚠ KHÔNG gọi `tomTat()` trực tiếp: nó **không được export**, và quan trọng hơn — Agent **chỉ nhận
 *   `textSummary`** (`aiLocalKnowledgeService`, đã đo hai lần). Một ca gọi hàm nội bộ sẽ đi theo
 *   FILE chứ không theo ĐƯỜNG THOÁT (ràng buộc 10, đã tái diễn nhiều lần).
 */
async function tomTatAgent(lang: "vi" | "en" | "zh" = "vi"): Promise<string> {
  await import("../aiLocalTools/vramTools"); // đăng ký tool
  const { getTool } = await import("../aiLocalTools/toolRegistry");
  const t = getTool("get_vram_state");
  if (!t || typeof t.handler !== "function") throw new Error("get_vram_state CHƯA đăng ký trong toolRegistry");
  const r = (await t.handler({ __authCtx: { userId: 7, role: "admin" }, lang })) as { textSummary: string };
  return r.textSummary;
}

describe("★★★ (B) Bước 7 / ĐỘT BIẾN — anh em ĐỌC ĐƯỢC cờ (B1 · B3 nay phải XANH)", () => {
  it("★★★ B1 — hàng anh em MANG lời khai, không chỉ hàng của người ghi", async () => {
    expect(OWNER_QUA_TRAN.length).toBeGreaterThan(VRAM_LEASE_COLUMN_MAX.owner);
    await aGhi(OWNER_QUA_TRAN);
    expect(sharedLedgerFact(bayGio())!.truncatedIdentityWrites, "A biết nó vừa công bố tên cụt").toBe(1);

    tienTrinhAnhEm("worker:2002:boot-b");
    await syncSharedLedger();

    const hang = readSharedLedgerReplica()!.foreignLeases.find((x) => x.owner.startsWith("reranker:"));
    expect(hang, "B phải thấy hàng của A").toBeTruthy();
    expect(hang!.owner.length, "hàng trên bảng đúng là hàng đã bị cắt").toBe(VRAM_LEASE_COLUMN_MAX.owner);
    expect(
      hang!.identityTruncated,
      "hàng anh em phải MANG lời khai — đây là toàn bộ điểm của Pha 7 Task 5 (B)",
    ).toEqual(["owner"]);
  });

  it("★★★ B3 — mặt đọc của ANH EM khai `truncatedIdentityWrites > 0` cho một hàng CỤT", async () => {
    await aGhi(OWNER_QUA_TRAN);
    tienTrinhAnhEm("worker:2002:boot-b");
    await syncSharedLedger();

    const that = sharedLedgerFact(bayGio())!;
    expect(that.truncatedIdentityWrites, "B đang NHÌN một hàng cụt ⇒ nó phải NÓI RA").toBe(1);
    expect(that.unknownIdentityRows, "hàng do một tiến trình BẢN MỚI ghi ⇒ KHÔNG phải 'không biết'").toBe(0);
  });

  it("★★★ lời khai đi hết ĐƯỜNG THOÁT tới mặt đọc của anh em (`ledger.foreign.holders[]`)", async () => {
    await aGhi(OWNER_QUA_TRAN);
    tienTrinhAnhEm("worker:2002:boot-b");
    await syncSharedLedger();

    const { buildVramAgentState } = await import("./vramReadModel");
    const st = await buildVramAgentState();
    expect(st.ledger.foreign.known).toBe(true);
    if (!st.ledger.foreign.known) return;
    expect(st.ledger.foreign.truncatedIdentityWrites).toBe(1);
    const ho = st.ledger.foreign.holders.find((h) => h.owner.startsWith("reranker:"));
    expect(ho, "hộ anh em phải có mặt trên mặt đọc").toBeTruthy();
    expect(
      ho!.identityTruncated,
      "ô `identityTruncated` chỉ sống trong DB thì KHÔNG AI THẤY — nó phải ra tới mặt đọc",
    ).toEqual(["owner"]);
  });

  it("★★★ ĐƯỜNG THOÁT TỚI **AGENT** — `textSummary` nói ra, không chỉ `data.state`", async () => {
    /**
     * ⚠⚠ Đây là đường **THẬT SỰ NGUY HIỂM** (đo lại ở Bước 5): `vramTools.tomTat()` gộp
     * `localHolders` với `foreign.holders` và đưa `owner` của **cả hai** vào `textSummary`; chính
     * docstring của `vramTools` nói *"`owner` là DANH TÍNH mà Agent lấy từ mặt đọc rồi truyền
     * THẲNG vào `vram.preempt`"*. Agent **chỉ nhận `textSummary`** — một ô nằm trong `data.state`
     * thì nó **không bao giờ thấy**.
     */
    await aGhi(OWNER_QUA_TRAN);
    tienTrinhAnhEm("worker:2002:boot-b");
    await syncSharedLedger();

    const cau = await tomTatAgent();
    expect(cau, "Agent phải được CẢNH BÁO rằng chuỗi này không phải tên đầy đủ").toContain("DANH TÍNH ĐÃ BỊ CẮT");
    expect(cau, "và phải biết ĐỪNG dùng nó làm tham số lệnh").toMatch(/ĐỪNG dùng nó làm tham số/);
  });
});

describe("★★★ (B) Bước 6 / ĐỐI CHỨNG DƯƠNG — KHÔNG BẮT NHẦM", () => {
  it("★★★ `owner` NGẮN (54) ⇒ cờ là `[]`, và mặt đọc khai 0", async () => {
    expect(OWNER_NGAN.length).toBe(54);
    const hang = await aGhi(OWNER_NGAN);
    expect(hang.identityTruncated, "54/160 ⇒ KHÔNG cắt ⇒ khai RỖNG, không phải `null`").toEqual([]);

    tienTrinhAnhEm("worker:2002:boot-b");
    await syncSharedLedger();
    const that = sharedLedgerFact(bayGio())!;
    expect(that.truncatedIdentityWrites, "không có gì bị cắt ⇒ 0").toBe(0);
    expect(that.unknownIdentityRows, "người ghi ĐÃ khai ⇒ KHÔNG phải 'không biết'").toBe(0);
  });

  it("★★★ Ô BIÊN — `owner` dài ĐÚNG BẰNG trần ⇒ **KHÔNG** khai là đã cắt", () => {
    /**
     * ⚠⚠ Đây là ca **B2** của Bước 1, giữ nguyên: một chuỗi dài **đúng bằng** trần thì **không** bị
     * cắt, còn một chuỗi dài hơn bị cắt **thành** đúng độ dài ấy ⇒ **hai sự thật, MỘT độ dài**.
     * Bất kỳ ai vá lại bằng `owner.length === 160` sẽ **SAI đúng ở ca này**.
     */
    const dungTran = "o".repeat(VRAM_LEASE_COLUMN_MAX.owner);
    const bien = rowFromLease(
      {
        id: "lease-1",
        request: { owner: dungTran, kind: "gguf-model", estimatedBytes: MIB, priority: "background" },
        acquiredAt: new Date(NOW), actualBytes: null, measureFailed: false,
        lastHeartbeatAt: new Date(NOW), released: false, refCount: 1,
      },
      MIB, "api:1:b", NOW,
    );
    expect(bien.row.owner, "đúng bằng trần ⇒ giá trị NGUYÊN VẸN").toBe(dungTran);
    expect(bien.row.identityTruncated, "đúng bằng trần ⇒ KHÔNG khai là đã cắt").toEqual([]);

    const qua = rowFromLease(
      {
        id: "lease-1",
        request: {
          owner: "o".repeat(VRAM_LEASE_COLUMN_MAX.owner + 1),
          kind: "gguf-model", estimatedBytes: MIB, priority: "background",
        },
        acquiredAt: new Date(NOW), actualBytes: null, measureFailed: false,
        lastHeartbeatAt: new Date(NOW), released: false, refCount: 1,
      },
      MIB, "api:1:b", NOW,
    );
    expect(qua.row.owner.length, "dài hơn một ký tự ⇒ bị cắt THÀNH đúng trần").toBe(dungTran.length);
    expect(qua.row.identityTruncated, "…và ĐÚNG ca này phải khai").toEqual(["owner"]);
  });

  it("★★ hàng của CHÍNH TA không bị đếm hai lần (hai tập RỜI NHAU theo cấu tạo)", async () => {
    await aGhi(OWNER_QUA_TRAN);
    // Vẫn là tiến trình A: hàng của ta bị `publishSharedLedgerReplica()` lọc khỏi `foreignLeases`.
    await syncSharedLedger();
    expect(
      sharedLedgerFact(bayGio())!.truncatedIdentityWrites,
      "MỘT hàng cụt ⇒ ĐÚNG 1, không phải 2 (ô của ta + ô đọc từ bảng)",
    ).toBe(1);
    expect(readSharedLedgerReplica()!.foreignLeases.length, "hàng của TA không nằm trong `foreignLeases`").toBe(0);
  });
});

describe("★★★ (B) VẾ THỨ BA — `null` là KHÔNG BIẾT, KHÔNG phải 'sạch'", () => {
  it("★★★ hàng do một tiến trình BẢN CŨ ghi (cột `NULL`) ⇒ `unknownIdentityRows`, KHÔNG vào ô 'đã cắt'", async () => {
    /**
     * Mô phỏng đúng cửa sổ triển khai: migration đã áp, một tiến trình **chưa lên bản mới** vẫn
     * đang ghi ⇒ cột `identityTruncated` của hàng nó là `NULL`.
     */
    const hangCu: SharedLeaseRow = {
      leaseKey: "api:9999:boot-cu#lease-7",
      processKey: "api:9999:boot-cu",
      pid: 9999, role: "api", leaseId: "lease-7",
      owner: "o".repeat(VRAM_LEASE_COLUMN_MAX.owner), // trông y hệt một hàng đã bị cắt
      leaseKind: "gguf-model", priority: "background",
      bytes: 64 * MIB, measured: false, refCount: 1, reclaimer: null,
      acquiredAtMs: NOW, updatedAtMs: NOW,
      identityTruncated: null, // ← người ghi CHƯA BIẾT cột này
    };
    bang.rows.set(hangCu.leaseKey, hangCu);

    tienTrinhAnhEm("worker:2002:boot-b");
    await syncSharedLedger();

    const that = sharedLedgerFact(bayGio())!;
    expect(that.unknownIdentityRows, "phải NÓI RA rằng ta không biết").toBe(1);
    expect(
      that.truncatedIdentityWrites,
      "KHÔNG được khai 'đã cắt' cho một hàng ta không có bằng chứng — đó là bịa theo chiều kia",
    ).toBe(0);
  });

  it("★★★ ĐƯỜNG THOÁT — vế 'KHÔNG BIẾT' tới được cả mặt đọc LẪN `textSummary` của Agent", async () => {
    const hangCu: SharedLeaseRow = {
      leaseKey: "api:9999:boot-cu#lease-7", processKey: "api:9999:boot-cu",
      pid: 9999, role: "api", leaseId: "lease-7", owner: OWNER_NGAN,
      leaseKind: "gguf-model", priority: "background",
      bytes: 64 * MIB, measured: false, refCount: 1, reclaimer: null,
      acquiredAtMs: NOW, updatedAtMs: NOW, identityTruncated: null,
    };
    bang.rows.set(hangCu.leaseKey, hangCu);
    tienTrinhAnhEm("worker:2002:boot-b");
    await syncSharedLedger();

    const { buildVramAgentState } = await import("./vramReadModel");
    const st = await buildVramAgentState();
    expect(st.ledger.foreign.known).toBe(true);
    if (!st.ledger.foreign.known) return;
    expect(st.ledger.foreign.unknownIdentityRows, "mặt đọc phải mang vế thứ ba").toBe(1);
    expect(
      st.ledger.foreign.holders.find((h) => h.leaseKey === hangCu.leaseKey)!.identityTruncated,
      "và nó phải là `null` ở TỪNG HÀNG, không bị ép về `[]`",
    ).toBeNull();

    const cau = await tomTatAgent();
    expect(cau, "Agent phải biết nó KHÔNG BIẾT").toContain("KHÔNG BIẾT");
  });
});

describe("★★★ (B) MẶT NGƯỜI — nút phá huỷ KHÔNG gửi được một danh tính CỤT", () => {
  it("★★★ hộ ANH EM không bao giờ mang `reclaimable-here` ⇒ nút *Thu hồi* KHÔNG render cho nó", async () => {
    /**
     * ⚠⚠⚠ **ĐÍNH CHÍNH MỘT CÂU TÔI VIẾT SAI Ở BƯỚC 2** (báo cáo §2.3(i)). Tôi đã khai rằng mặt
     * NGƯỜI đang bơm một danh tính cụt vào `preempt.mutate` vì `VramBrokerPanel` **GỘP** hai danh
     * sách. Phép đọc lại ở Bước 5 cho thấy **câu ấy SAI**: nút chỉ render trong nhánh
     * `h.reclaim.kind === "reclaimable-here"`, và `hoAnhEm()` **theo cấu tạo** chỉ sinh ra
     * `declared-by-owner-process` hoặc `no-reclaimer`. ⇒ Mặt NGƯỜI **không** đi đường đó.
     *
     * ⇒ Ca này khoá **tính chất cấu trúc** ấy để nó không lặng lẽ mất đi: ngày ai đó cho hộ anh em
     *   một `reclaimable-here`, nút sẽ render và **lúc đó** danh tính cụt mới thật sự đi vào lệnh.
     * ⚠ Đường **THẬT SỰ** phơi nhiễm là mặt **AGENT** — đã khoá ở ca `textSummary` bên trên.
     */
    await aGhi(OWNER_QUA_TRAN);
    tienTrinhAnhEm("worker:2002:boot-b");
    await syncSharedLedger();

    const { buildVramAgentState } = await import("./vramReadModel");
    const st = await buildVramAgentState();
    expect(st.ledger.foreign.known).toBe(true);
    if (!st.ledger.foreign.known) return;

    const cutMaCoNut = st.ledger.foreign.holders.filter(
      (h) => h.reclaim.kind === "reclaimable-here" && (h.identityTruncated === null || h.identityTruncated.length > 0),
    );
    expect(
      cutMaCoNut.map((h) => h.owner).join(" · "),
      "một hộ có danh tính KHÔNG-BIẾT-LÀ-THẬT mà lại render được nút phá huỷ ⇒ lệnh sẽ nhận một " +
        "cái tên không phải tên của ai cả",
    ).toBe("");
  });

  it("★★ hộ CỤC BỘ luôn khai `[]` — sổ cục bộ giữ `owner` NGUYÊN VẸN (N11)", async () => {
    await aGhi(OWNER_QUA_TRAN);
    const { buildVramAgentState } = await import("./vramReadModel");
    const st = await buildVramAgentState();
    const cucBo = st.ledger.localHolders.find((h) => h.owner.startsWith("reranker:"));
    expect(cucBo, "hộ cục bộ phải có mặt").toBeTruthy();
    expect(cucBo!.owner, "mặt LỆNH giữ danh tính NGUYÊN VẸN — chỉ bản CÔNG BỐ mới cắt").toBe(OWNER_QUA_TRAN);
    expect(cucBo!.identityTruncated, "…nên hộ cục bộ khai RỖNG").toEqual([]);
  });
});
