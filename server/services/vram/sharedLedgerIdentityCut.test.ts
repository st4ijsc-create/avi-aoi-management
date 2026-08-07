/**
 * ★★★ Pha 6 Task 5 — **I-2, ĐẦU THỨ BA: SỔ CHUNG THÔI CẮT `owner` ÂM THẦM.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ SỐ ĐO CỦA BƯỚC 1 (2026-08-07) — NÓ QUYẾT ĐỊNH ĐƯỜNG ĐI, KHÔNG PHẢI KHẨU VỊ
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * | đại lượng | số | nguồn |
 * |---|---|---|
 * | `max(length(owner))` **hiện tại** | **54** | `vram_leases` (n=4) và `vram_events` (n=4.507) |
 * | **trần** | **160** | `information_schema` = `drizzle/schema/vram.ts` = `VRAM_OWNER_MAX` |
 * | `owner` **dài nhất có thể** | **≥ 365** | file THẬT, `modelPath` 356 ký tự, `LongPathsEnabled=1` |
 *
 * `owner` sản xuất dựng từ **ĐƯỜNG DẪN TUYỆT ĐỐI** (`ocrService.ts:384` `onnx-ocr:${modelPath}` ·
 * `aiReranker.ts:503` `reranker:${modelPath}`) ⇒ trần thật của nó là trần đường dẫn của **HĐH**
 * (32.767 khi `LongPathsEnabled=1`), **không** một hằng nào của repo. **365 / 160 = 2,28×.**
 *
 * ⇒ **VÌ SAO KHÔNG NỚI CỘT** (đường KHÔNG chọn, và lý do): không tồn tại bề rộng `varchar` nào
 *   đuổi kịp trần đường dẫn, nên nới cột chỉ **DỜI CHỖ NÓI DỐI** — hệ vẫn cắt, vẫn im lặng, chỉ
 *   xa hơn một quãng. Cộng thêm: nới cột là **DDL** (cấm ở §Global Constraints, cần chủ dự án
 *   duyệt) và theo `vramColumnLimits.ts` nó buộc đổi **ba** chỗ cùng lúc (cột · hằng · ca khoá bề
 *   rộng) trên **hai** DB; và vì I-2 của Pha 5 ràng *"bề rộng LỆNH nhận = bề rộng SỔ ghi được"*,
 *   nới cột còn tự động nới ô `z.string().max()` của lệnh phá huỷ — rộng hơn mà **không đổi được
 *   một bit nào** của lớp lỗi.
 * ⇒ **ĐƯỜNG ĐÃ CHỌN: ĐỔI KIỂU.** `rowFromLease()`/`rowFromBaseline()` trả `{ row, daCat }`, và
 *   `SharedLedgerWrite.upsert` **đòi** `daCat` ⇒ một lượt cắt **không viết ra im lặng được nữa**.
 *   Lời khai đi tiếp tới `SharedLedgerFact.truncatedIdentityWrites` → `ledger.foreign` của mặt đọc.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ LƯỢNG TỪ: BỐN LUẬT DƯỚI ĐÂY ĐỀU LÀ **"VỚI MỌI"**, KHÔNG PHẢI **"TỒN TẠI"**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Bài học đã trả giá **mười ba** lần: *"cái gì LIỆT KÊ thì luôn có phần tử thứ N+1"*. Nên file này
 * **không** có ca nào tên *"owner bị cắt thì khai"* rồi dừng. Nó phát biểu:
 *
 *   **∀-A** MỌI cột `varchar` của `vram_leases` **trong `drizzle/schema/vram.ts`** có ĐÚNG một mục
 *           ở `VRAM_LEASE_COLUMN_MAX`, với ĐÚNG con số — và ngược lại. (nguồn ĐO: chính đối tượng
 *           drizzle sinh ra DDL, không phải một danh sách chép tay ở đây)
 *   **∀-B** MỌI ô của `VRAM_LEASE_COLUMN_MAX` được **PHÂN LOẠI** vào đúng một trong hai vế —
 *           *cắt được* (có người lái) hoặc *union đóng* (kèm LÝ DO). Cột thứ chín ⇒ **chưa phân
 *           loại** ⇒ ĐỎ. (khuôn "ba vế" của `vramReadModel.drift.test.ts`, đã đo được tác dụng)
 *   **∀-C** Với MỌI ô cắt được: vượt trần ⇒ `daCat` **gọi đúng tên nó**; **ĐÚNG BẰNG** trần ⇒
 *           `daCat` **KHÔNG** chứa nó và giá trị **NGUYÊN VẸN** (ô BIÊN — Pha 5 Task 5 từng thiếu
 *           đúng ca này). Và `daCat` là **BẰNG** tập ô quá trần, không phải "chứa".
 *   **∀-D** MỌI ô chuỗi của hàng phát ra ≤ bề rộng cột của nó (`22001` làm **mất cả lô**, rồi
 *           `requeueSharedLedgerWrites()` ném lại đúng hàng độc ⇒ hỏng **VĨNH VIỄN**).
 *
 * ⚠ Và một luật ĐƯỜNG THOÁT (ràng buộc 10 — lưới đi theo **đường thoát**, không theo file): lời
 *   khai phải tới được `sharedLedgerFact()` qua **`reserve()` + `syncSharedLedger()` THẬT**, không
 *   phải qua một lượt gọi `rowFromLease()` trần trụi.
 * ⚠ **KHÔNG BẮT NHẦM**: mặt LỆNH giữ `owner` **NGUYÊN VẸN** (N11 — *"`owner` là DANH TÍNH trên mặt
 *   LỆNH, KHÔNG được cắt ngắn ở đó"*), và một hộ có danh tính ngắn **không** bị khai là đã cắt.
 */
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { catChuoi } from "@shared/textSafety";
import { VRAM_LEASE_COLUMN_MAX, type VramLeaseColumn } from "./vramColumnLimits";
import { __resetBrokerForTests, release, reserve, snapshot } from "./vramBroker";
import type { VramDecisionContext } from "./vramBroker";
import {
  __resetSharedLedgerForTests, __setSharedLedgerSelfKeyForTests, readSharedLedgerReplica,
  rowFromBaseline, rowFromLease, sharedLedgerFact,
} from "./vramSharedLedger";
import type { SharedLeaseRow } from "./vramSharedLedger";
import {
  __resetSharedLedgerStoreForTests, __setSharedLedgerGatewayForTests, syncSharedLedger,
} from "./vramSharedLedgerStore";
import type { SharedLedgerGateway } from "./vramSharedLedgerStore";
import { __resetDecisionTickForTests, publishDecisionTick, __tickFieldsForTests } from "./vramTickCell";
import type { VramLease } from "./types";

const MIB = 1024 * 1024;
const NOW = 1_700_000_000_000;

/** Bảng `vram_leases` GIẢ — cùng khuôn `sharedLedger.test.ts`, một bảng đóng vai "thế giới ngoài". */
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

function bayGio(): number {
  return readSharedLedgerReplica()?.atMs ?? NOW;
}

function ctx(): VramDecisionContext {
  const now = bayGio();
  return {
    tick: { ...__tickFieldsForTests(0, true), atMs: now, consecutiveFailures: 0 },
    unledgered: { bytes: 0, unknownCount: 0 },
    sharedLedger: sharedLedgerFact(now),
    nowMs: now,
  };
}

/**
 * Một giấy phép dựng THẲNG (không qua `reserve()`) — cần thiết cho ∀-C, vì `lease.id` do
 * `vramBroker` cấp (`lease-1`) và ca này phải lái được **cả** `leaseId` lẫn `leaseKey`.
 * ⚠ Đây KHÔNG phải một đường thoát thứ hai: `rowFromLease()` là **cửa vào DUY NHẤT** của bảng và
 *   ca `ĐƯỜNG THOÁT` bên dưới đi qua `reserve()` + `syncSharedLedger()` thật.
 */
function giayPhep(over: { id?: string; owner?: string } = {}): VramLease {
  return {
    id: over.id ?? "lease-1",
    request: {
      owner: over.owner ?? "sidecar:vision",
      kind: "external-process",
      estimatedBytes: 8 * MIB,
      priority: "background",
    },
    acquiredAt: new Date(NOW),
    actualBytes: null,
    measureFailed: false,
    lastHeartbeatAt: new Date(NOW),
    released: false,
    refCount: 1,
  };
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// ∀-B — BẢN PHÂN LOẠI. Mỗi ô của `VRAM_LEASE_COLUMN_MAX` nằm ở ĐÚNG MỘT trong hai vế dưới đây.
// ══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Vế MỘT — ô **CẮT ĐƯỢC**: có một chuỗi tự do lái nó. `lai(n)` dựng một lượt gọi `rowFromLease()`
 * mà ô ấy nhận **đúng `n` ký tự**; ô còn lại giữ giá trị bình thường.
 *
 * ⚠ Người lái phải làm ô ấy dài **CHÍNH XÁC** `n`, nếu không ca BIÊN đo nhầm thứ khác.
 */
const O_CAT_DUOC: Readonly<Record<string, (n: number) => { row: SharedLeaseRow; daCat: readonly VramLeaseColumn[] }>> = {
  owner: (n) => rowFromLease(giayPhep({ owner: "o".repeat(n) }), MIB, "api:1:b", NOW),
  leaseId: (n) => rowFromLease(giayPhep({ id: "i".repeat(n) }), MIB, "api:1:b", NOW),
  // `processKey` = `selfKey` nguyên vẹn. ⚠ Phải giữ `role` (đoạn trước `:` đầu) NGẮN, nếu không
  //   người lái đẩy HAI ô qua trần cùng lúc và ca "khai BẰNG, không THỪA" đo nhầm thứ.
  processKey: (n) => rowFromLease(giayPhep(), MIB, `r:${"k".repeat(n - 2)}`, NOW),
  // `role` = đoạn TRƯỚC dấu `:` đầu tiên của `selfKey`.
  role: (n) => rowFromLease(giayPhep(), MIB, `${"r".repeat(n)}:1:b`, NOW),
  // `leaseKey` = `${selfKey}#${lease.id}` ⇒ lái bằng `lease.id`, trừ đi phần `selfKey` + `#`.
  leaseKey: (n) => rowFromLease(giayPhep({ id: "d".repeat(n - "api:1:b#".length) }), MIB, "api:1:b", NOW),
};

/**
 * Vế HAI — ô **KHÔNG cắt được**, kèm LÝ DO đọc được (một danh sách không lý do là một danh sách
 * miễn trừ — khuôn `CANH_NAY_KHONG_DUNG_NOI` của `vramReadModel.drift.test.ts`).
 */
const O_UNION_DONG: readonly { readonly o: string; readonly viSao: string }[] = [
  { o: "leaseKind", viSao: "`VramLeaseKind` là union ĐÓNG — `tsc` chặn mọi giá trị ngoài tập, dài nhất 19 ký tự" },
  { o: "priority", viSao: "`VramPriority` là union ĐÓNG — dài nhất 11 ký tự (`interactive`)" },
  { o: "reclaimer", viSao: "`VramReclaimerId | null` là union ĐÓNG — dài nhất 17 ký tự (`gguf-idle-model`)" },
];

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

describe("★★★ Task 5 / ∀-A — bề rộng cột: bảng hằng phải KHỚP drizzle, ĐỦ và KHÔNG THỪA", () => {
  it("★★★ MỌI cột `varchar` của `vram_leases` có ĐÚNG một mục ở `VRAM_LEASE_COLUMN_MAX`, ĐÚNG con số", async () => {
    /**
     * ⚠⚠ NGUỒN ĐO là **chính đối tượng drizzle** sinh ra DDL, không phải văn bản `.sql` và cũng
     * không phải một danh sách chép tay ở đây. Thêm một cột `varchar` thứ chín vào bảng mà quên
     * `VRAM_LEASE_COLUMN_MAX` ⇒ ca này ĐỎ **ngay**, chứ không phải sau một `22001` mất cả lô.
     */
    const { vramLeases } = await import("../../../drizzle/schema/vram");
    const tuDrizzle = new Map<string, number>();
    for (const [ten, cot] of Object.entries(vramLeases as Record<string, unknown>)) {
      const c = cot as { columnType?: string; length?: number };
      if (c?.columnType === "PgVarchar" && typeof c.length === "number") tuDrizzle.set(ten, c.length);
    }
    expect(tuDrizzle.size, "bộ đọc drizzle không thấy cột `varchar` nào — nó đã hỏng?").toBeGreaterThanOrEqual(8);

    const thieu = [...tuDrizzle.keys()].filter((k) => !(k in VRAM_LEASE_COLUMN_MAX));
    expect(thieu.join(" · "), "cột `varchar` của bảng KHÔNG có bề rộng trong `VRAM_LEASE_COLUMN_MAX`").toBe("");

    const thua = Object.keys(VRAM_LEASE_COLUMN_MAX).filter((k) => !tuDrizzle.has(k));
    expect(thua.join(" · "), "hằng khai một cột KHÔNG CÒN trong bảng ⇒ nó đang canh một thứ không tồn tại").toBe("");

    const lech = [...tuDrizzle].filter(([k, n]) => VRAM_LEASE_COLUMN_MAX[k as VramLeaseColumn] !== n);
    expect(
      lech.map(([k, n]) => `${k}: drizzle=${n} hằng=${VRAM_LEASE_COLUMN_MAX[k as VramLeaseColumn]}`).join("\n"),
      "bề rộng cột và hằng đã TRÔI khỏi nhau ⇒ sổ chung cắt ở một chỗ, Postgres ném ở chỗ khác",
    ).toBe("");
  });
});

describe("★★★ Task 5 / ∀-B — MỌI ô được PHÂN LOẠI: cắt-được hoặc union-đóng-có-lý-do", () => {
  it("★★★ không ô nào CHƯA PHÂN LOẠI, không ô nào ở CẢ HAI vế, không vế nào khai một ô đã chết", () => {
    const catDuoc = new Set(Object.keys(O_CAT_DUOC));
    const dong = new Set(O_UNION_DONG.map((x) => x.o));
    const moiO = new Set(Object.keys(VRAM_LEASE_COLUMN_MAX));

    const chuaKhai = [...moiO].filter((o) => !catDuoc.has(o) && !dong.has(o));
    expect(
      chuaKhai.join(" · "),
      "ô của `vram_leases` CHƯA được phân loại ⇒ một đường cắt có thể tồn tại mà không luật nào chạm tới",
    ).toBe("");

    const caHai = [...catDuoc].filter((o) => dong.has(o));
    expect(caHai.join(" · "), "một ô vừa CẮT-ĐƯỢC vừa UNION-ĐÓNG là một bản khai tự mâu thuẫn").toBe("");

    const daChet = [...catDuoc, ...dong].filter((o) => !moiO.has(o));
    expect(daChet.join(" · "), "bản khai giữ một ô KHÔNG CÒN trong bảng hằng").toBe("");

    // ⚠ Vế "không cắt được" phải có LÝ DO — không lý do thì nó là một danh sách miễn trừ.
    expect(O_UNION_DONG.filter((x) => x.viSao.trim().length < 10).map((x) => x.o).join(" · ")).toBe("");
  });

  it("★★ vế UNION-ĐÓNG phải ĐÚNG SỰ THẬT: hàng thật phát ra ba ô ấy ngắn hơn trần rất nhiều", () => {
    /** ⚠ Một lý do viết ra mà không ai đo lại là một lý do sẽ sai lặng lẽ. */
    const { row } = rowFromLease(giayPhep(), MIB, "api:1:b", NOW);
    for (const { o } of O_UNION_DONG) {
      const v = (row as unknown as Record<string, unknown>)[o];
      if (v === null) continue;
      expect(typeof v, `${o} phải là chuỗi hoặc null`).toBe("string");
      expect(String(v).length, `${o} phải NGẮN HƠN trần — nếu không, "union đóng" là lý do sai`).toBeLessThan(
        VRAM_LEASE_COLUMN_MAX[o as VramLeaseColumn],
      );
    }
  });
});

describe("★★★ Task 5 / ∀-C — vượt trần ⇒ KHAI; ĐÚNG BẰNG trần ⇒ KHÔNG khai (ô BIÊN)", () => {
  it("★★★ ĐỎ TRƯỚC BẢN VÁ — với MỌI ô cắt được: vượt trần ⇒ `daCat` gọi ĐÚNG TÊN nó", () => {
    for (const [o, lai] of Object.entries(O_CAT_DUOC)) {
      const tran = VRAM_LEASE_COLUMN_MAX[o as VramLeaseColumn];
      const { row, daCat } = lai(tran + 1);
      expect(daCat, `${o} vượt trần MỘT ký tự ⇒ phải được KHAI, không im lặng`).toContain(o);
      expect(String((row as unknown as Record<string, unknown>)[o]).length, `${o} phải bị cắt ĐÚNG tại trần`).toBe(tran);
    }
  });

  it("★★★ Ô BIÊN — với MỌI ô cắt được: dài ĐÚNG BẰNG trần ⇒ KHÔNG khai, và giá trị NGUYÊN VẸN", () => {
    /**
     * ⚠⚠ Pha 5 Task 5 **thiếu đúng ca này**. Vị từ sai điển hình là `cau.length === trần ⇒ đã cắt`:
     * nó khai nhầm cho một chuỗi vừa khít. `catChuoi()` hỏi `tho.length > toiDa`, tức hỏi **đầu
     * vào**, và đó là lý do phép cắt phải sinh cờ **tại chỗ cắt** chứ không đo lại ở đầu kia.
     */
    for (const [o, lai] of Object.entries(O_CAT_DUOC)) {
      const tran = VRAM_LEASE_COLUMN_MAX[o as VramLeaseColumn];
      const { row, daCat } = lai(tran);
      expect(daCat, `${o} dài ĐÚNG BẰNG trần ⇒ KHÔNG được khai là đã cắt`).not.toContain(o);
      expect(String((row as unknown as Record<string, unknown>)[o]).length, `${o} phải NGUYÊN VẸN ở ô biên`).toBe(tran);
    }
    // …và biên dưới một ký tự cũng vậy.
    for (const [o, lai] of Object.entries(O_CAT_DUOC)) {
      const tran = VRAM_LEASE_COLUMN_MAX[o as VramLeaseColumn];
      expect(lai(tran - 1).daCat, `${o} ngắn hơn trần ⇒ KHÔNG khai`).not.toContain(o);
    }
  });

  it("★★★ `daCat` là **BẰNG** tập ô quá trần, không phải 'chứa' — một lượt khai THỪA cũng là nói dối", () => {
    /**
     * ⚠ Lượng từ hai chiều. Một bản cài đặt khai **mọi** ô ở mọi lượt sẽ qua được ca "phải chứa"
     * bên trên, và người trực sẽ đọc một báo động luôn bật — đúng lớp nhiễu I-3.
     */
    for (const [o, lai] of Object.entries(O_CAT_DUOC)) {
      const tran = VRAM_LEASE_COLUMN_MAX[o as VramLeaseColumn];
      const { daCat } = lai(tran + 1);
      // `leaseKey` bị lái CHUNG với `leaseId` (nó ghép từ `selfKey` + `lease.id`), nên chấp nhận
      // đúng hai ô ấy đi cùng nhau; mọi ô khác thì phải là MỘT.
      const chapNhan = o === "leaseKey" ? new Set(["leaseKey", "leaseId"]) : new Set([o]);
      const thua = daCat.filter((x) => !chapNhan.has(x));
      expect(thua.join(" · "), `lái ${o} quá trần KHÔNG được khai kèm ô khác`).toBe("");
    }
    // Không ô nào quá trần ⇒ lời khai RỖNG.
    expect(rowFromLease(giayPhep(), MIB, "api:1:b", NOW).daCat, "hàng bình thường ⇒ KHÔNG khai gì").toEqual([]);
  });

  it("★★ phép cắt là `catChuoi()` của `@shared/textSafety` — KHÔNG một hàm thứ hai", () => {
    /**
     * ⚠ Hỏi bằng **HÀNH VI trên cả một dải**, không bằng phép so chuỗi mã nguồn: nếu ai đó viết
     * lại một hàm cắt riêng thì hoặc nó trùng `catChuoi` (vô hại), hoặc nó lệch ở một điểm nào đó
     * trong dải này và ca ĐỎ.
     */
    const tran = VRAM_LEASE_COLUMN_MAX.owner;
    for (const n of [0, 1, tran - 2, tran - 1, tran, tran + 1, tran + 2, tran * 3]) {
      const s = "z".repeat(n);
      const mong = catChuoi(s, tran);
      const { row, daCat } = rowFromLease(giayPhep({ owner: s || "x" }), MIB, "api:1:b", NOW);
      if (n === 0) continue; // `owner` rỗng không phải một yêu cầu hợp lệ (`z.string().min(1)`)
      expect(row.owner, `n=${n}`).toBe(mong.cau);
      expect(daCat.includes("owner"), `n=${n}`).toBe(mong.daCat);
    }
  });
});

describe("★★★ Task 5 / ∀-D — hàng phát ra KHÔNG BAO GIỜ vượt bề rộng cột (22001 = mất CẢ LÔ)", () => {
  it("★★★ MỌI ô chuỗi của hàng ≤ trần, kể cả khi MỌI nguồn đều quá dài cùng lúc", () => {
    const { row, daCat } = rowFromLease(
      giayPhep({ owner: `onnx-ocr:${"d".repeat(400)}`, id: "i".repeat(400) }),
      MIB,
      `${"r".repeat(60)}:1:${"b".repeat(300)}`,
      NOW,
    );
    for (const [k, v] of Object.entries(row)) {
      if (typeof v !== "string") continue;
      const tran = VRAM_LEASE_COLUMN_MAX[k as VramLeaseColumn];
      expect(tran, `ô chuỗi \`${k}\` của hàng KHÔNG có bề rộng khai báo`).toBeTypeOf("number");
      expect(v.length, `${k} vượt \`varchar(${tran})\` ⇒ Postgres 22001 ⇒ MẤT CẢ LÔ`).toBeLessThanOrEqual(tran);
    }
    // …và mọi ô thật sự bị cắt đều được gọi tên.
    expect([...daCat].sort()).toEqual(["leaseId", "leaseKey", "owner", "processKey", "role"]);
    // CẮT chứ không VỨT — phần đầu vẫn nhận ra được.
    expect(row.owner.startsWith("onnx-ocr:"), "cắt chứ không vứt: đầu chuỗi phải còn").toBe(true);
  });

  it("★★ hàng NỀN cũng đi qua cửa cắt-có-khai (đường dựng hàng THỨ HAI, đừng bỏ quên)", () => {
    const goc = { pid: 9, bytes: 1024, source: "native" as const, verified: true, atMs: NOW };
    expect(rowFromBaseline({ ...goc, processKey: "worker:9:boot-x" }).daCat).toEqual([]);
    const dai = rowFromBaseline({ ...goc, processKey: `${"r".repeat(40)}:9:${"b".repeat(200)}` });
    expect([...dai.daCat].sort(), "hàng nền cắt `processKey`+`role` ⇒ phải khai cả hai").toEqual(["processKey", "role"]);
    expect(dai.row.processKey.length).toBe(VRAM_LEASE_COLUMN_MAX.processKey);
    expect(dai.row.role.length).toBe(VRAM_LEASE_COLUMN_MAX.role);
  });
});

describe("★★★ Task 5 / ĐƯỜNG THOÁT — lời khai phải tới được người đọc, không chỉ tới `tsc`", () => {
  /** `owner` đúng hình dạng sản xuất, dài **365** — con số đo được ở Bước 1. */
  const OWNER_365 = `reranker:${"C:\\Users\\Admin\\models\\".repeat(14)}bge-reranker-v2-m3-Q8_0.gguf`;

  it("★★★ `reserve()` + `syncSharedLedger()` THẬT ⇒ `truncatedIdentityWrites > 0` (trước đây: 0, im lặng)", async () => {
    expect(OWNER_365.length, "fixture phải vượt trần THẬT, không phải một chuỗi bịa cho vừa ca").toBeGreaterThan(
      VRAM_LEASE_COLUMN_MAX.owner,
    );
    __setSharedLedgerSelfKeyForTests("api:1:boot-a");
    const r = reserve(
      { owner: OWNER_365, kind: "gguf-model", estimatedBytes: 64 * MIB, priority: "background" },
      ctx(),
    );
    expect(r.lease, "ca này cần một giấy phép ĐƯỢC CẤP").not.toBeNull();
    await syncSharedLedger();

    const that = sharedLedgerFact(bayGio());
    expect(that, "phải có bản sao sau một lượt đồng bộ").not.toBeNull();
    expect(that!.truncatedIdentityWrites, "sổ chung đang công bố MỘT danh tính CỤT ⇒ phải nói ra").toBe(1);

    // …và hàng thật trên "bảng" đúng là hàng bị cắt.
    const hang = [...bang.rows.values()].find((x) => x.owner.startsWith("reranker:"));
    expect(hang, "hàng phải lên được bảng").toBeTruthy();
    expect(hang!.owner.length).toBe(VRAM_LEASE_COLUMN_MAX.owner);

    // ⚠ KHÔNG BẮT NHẦM (N11): sổ CỤC BỘ — thứ mặt LỆNH và mặt ĐỌC dùng — giữ danh tính NGUYÊN VẸN.
    const cucBo = snapshot().leases.find((l) => l.id === r.lease!.id);
    expect(cucBo!.request.owner, "danh tính trên mặt LỆNH phải NGUYÊN VẸN — chỉ bản CÔNG BỐ mới cắt").toBe(OWNER_365);
    expect(cucBo!.request.owner.length).toBe(OWNER_365.length);
  });

  it("★★★ ĐỐI CHỨNG DƯƠNG — `owner` sản xuất HÔM NAY (54 ký tự) ⇒ `truncatedIdentityWrites === 0`", async () => {
    /** ⚠ Không có ca này thì một bản vá khai "đã cắt" cho **mọi** hàng cũng xanh. */
    const owner = "reranker:D:\\SOURCES\\16.AI\\bge-reranker-v2-m3-Q8_0.gguf";
    expect(owner.length, "đúng số đo `max(length(owner))` của Bước 1").toBe(54);
    __setSharedLedgerSelfKeyForTests("api:1:boot-a");
    reserve({ owner, kind: "gguf-model", estimatedBytes: 64 * MIB, priority: "background" }, ctx());
    await syncSharedLedger();
    expect(sharedLedgerFact(bayGio())!.truncatedIdentityWrites, "54/160 ⇒ KHÔNG cắt ⇒ KHÔNG khai").toBe(0);
  });

  it("★★★ TỰ TẮT — giấy phép được NHẢ ⇒ ô về 0 (đếm HÀNG đang công bố, không đếm LƯỢT)", async () => {
    __setSharedLedgerSelfKeyForTests("api:1:boot-a");
    const r = reserve({ owner: OWNER_365, kind: "gguf-model", estimatedBytes: 64 * MIB, priority: "background" }, ctx());
    await syncSharedLedger();
    expect(sharedLedgerFact(bayGio())!.truncatedIdentityWrites).toBe(1);

    /**
     * ⚠⚠ Đây là ca chống lớp nhiễu I-3 nguyên văn: `dungLaiTuSoCucBo()` dựng lại ý định `upsert`
     * cho MỌI giấy phép sống ở MỌI nhịp 60 s. Một bộ đếm TĂNG DẦN sẽ leo mãi cho cùng một giấy
     * phép ⇒ *"một cờ luôn bật là một cờ không còn thông tin"*.
     */
    await syncSharedLedger();
    await syncSharedLedger();
    expect(sharedLedgerFact(bayGio())!.truncatedIdentityWrites, "ba nhịp, MỘT hàng ⇒ vẫn là 1").toBe(1);

    release(r.lease!);
    await syncSharedLedger();
    expect(sharedLedgerFact(bayGio())!.truncatedIdentityWrites, "hàng đã rời sổ ⇒ ô phải TẮT").toBe(0);
  });

  it("★★ mặt ĐỌC phát ra ô ấy — lời khai đi hết đường tới `ledger.foreign`", async () => {
    __setSharedLedgerSelfKeyForTests("api:1:boot-a");
    reserve({ owner: OWNER_365, kind: "gguf-model", estimatedBytes: 64 * MIB, priority: "background" }, ctx());
    await syncSharedLedger();

    const { buildVramAgentState } = await import("./vramReadModel");
    const st = await buildVramAgentState();
    expect(st.ledger.foreign.known, "ca này cần một bản sao đã làm mới").toBe(true);
    if (!st.ledger.foreign.known) return;
    expect(
      st.ledger.foreign.truncatedIdentityWrites,
      "ô `daCat` chỉ sống trong kiểu thì KHÔNG AI THẤY — nó phải ra tới mặt đọc",
    ).toBe(1);
  });
});
