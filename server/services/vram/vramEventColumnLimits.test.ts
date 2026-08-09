/**
 * ★★★ Pha 7 Task 3 — **`VARCHAR_LIMITS` THÔI LÀ MỘT DANH SÁCH VIẾT TAY.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ NỢ ĐÓNG Ở ĐÂY, VÀ VÌ SAO NÓ NẶNG HƠN VẺ NGOÀI
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Pha 6 Task 5 neo `vram_leases` vào drizzle bằng **hai lượng từ hai chiều** (thiếu cột ⇒ đỏ ·
 * thừa mục ⇒ đỏ) và **KHÔNG** làm cho `vram_events` — bảng **ghi nhiều dòng nhất** của module.
 * `vramEventLog.ts` giữ một bảng bề rộng **chép tay** kèm câu *"Ai đổi schema phải đổi bảng này"*:
 * một lời **nhờ vả**, không phải một luật. Tiền lệ đã trả giá thật: `estimateSource` từng là
 * `varchar(16)` trong khi `"fallback-after-measure-failure"` dài **30** ⇒ `22001` ⇒ vì
 * `flushVramEvents()` ghi **MỘT LÔ nhiều dòng**, **MẤT TOÀN BỘ LÔ**, và lỗi chỉ đi ra một dòng
 * `console.warn` (migration 0311).
 *
 * ⇒ **ĐẢO LƯỢNG TỪ**, đừng thêm dòng thứ sáu vào danh sách. Lớp *"cái gì LIỆT KÊ thì luôn có phần
 *   tử thứ N+1"* đã tái diễn **MƯỜI SÁU** lần; lời giải mỗi lần là **suy ra từ một nguồn CÓ ĐO**.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ BỐN LUẬT DƯỚI ĐÂY ĐỀU LÀ **"VỚI MỌI"**, KHÔNG PHẢI **"TỒN TẠI"**
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *   **∀-A** MỌI cột `varchar` của `vram_events` **trong `drizzle/schema/vram.ts`** được **PHÂN
 *           LOẠI** vào ĐÚNG MỘT trong hai vế: *có bề rộng khai* (⇒ ĐÚNG một mục ở
 *           `VARCHAR_LIMITS`, với **ĐÚNG con số của drizzle**) hoặc *không có chuỗi tự do nào lái
 *           được* (⇒ **KHÔNG** ở `VARCHAR_LIMITS`, kèm **LÝ DO**). Cột thứ tám ⇒ **chưa phân loại**
 *           ⇒ ĐỎ. Và **chiều ngược**: một mục ở hằng **không có cột thật** ⇒ ĐỎ.
 *   **∀-B** Vế *"không lái được"* phải **ĐÚNG SỰ THẬT — ĐO LẠI**, không phải chỉ viết ra: với đầu
 *           vào **cực đại**, hàng `INSERT` THẬT **hoặc** không mang khoá ấy **hoặc** mang một chuỗi
 *           **ngắn hơn** trần cột.
 *   **∀-C** MỌI ô của `VARCHAR_LIMITS` có **người lái** trong lưới này (không có ⇒ bản phân loại là
 *           trang trí), và với MỌI ô ấy: vượt trần ⇒ hàng phát ra bị cắt **ĐÚNG TẠI** trần và
 *           `detail.truncatedFields` **gọi đúng tên nó**; **ĐÚNG BẰNG** trần ⇒ **KHÔNG** khai, giá
 *           trị **NGUYÊN VẸN** (ô BIÊN — Pha 5 Task 5 từng thiếu đúng ca này).
 *   **∀-D** Với đầu vào **cực đại**, MỌI ô chuỗi của hàng `INSERT` ≤ bề rộng cột của nó, và tập
 *           `truncatedFields` **BẰNG** tập ô quá trần — không phải *"chứa"*.
 *
 * ⚠ Và một luật ĐƯỢC ĐO TRÊN **ĐƯỜNG THOÁT THẬT**: mọi khẳng định về "hàng" ở đây lấy từ
 *   `logVramEvent()` → `flushVramEvents()` → đối số `.values()` — tức **đúng cái đi tới Postgres**,
 *   **không** từ một lượt gọi `sanitizeVramEvent()` trần trụi. Bài học *"lưới đi theo ĐƯỜNG THOÁT,
 *   không theo FILE"* đã tái diễn mười một lần; và ở đây nó có răng thật, vì phép cắt nằm ở
 *   `sanitizeVramEvent()` còn **ánh xạ cột** lại nằm ở `flushVramEvents()` — hai chỗ khác nhau, và
 *   chỉ chỗ thứ hai mới quyết định cột nào **thật sự** nhận chuỗi.
 *
 * ⚠ **KHÔNG ĐỔI HÀNH VI.** `sanitizeVramEvent()` **đã** khai `truncatedFields` từ Pha 2B Task 3;
 *   lượt này **chỉ neo lượng từ**. Không một hằng nào của `vramEventLog.ts` bị sửa con số.
 *
 * ⚠ **KHÔNG BẮT NHẦM**: một sự kiện bình thường (mọi ô ngắn) ⇒ hàng **KHÔNG** có `truncatedFields`,
 *   và `detail` do người gọi đưa vào **còn nguyên**.
 */
import { describe, expect, it, vi } from "vitest";
import { cotVarchar, moiCot } from "./drizzleCotDoc";
import type { VramEventInput } from "./vramEventLog";
import type { VramEstimateSource, VramLeaseKind, VramPriority } from "./types";

/** Một sự kiện "bình thường" — mọi ô ngắn hơn trần rất nhiều. */
const NEN: VramEventInput = {
  event: "reserve",
  owner: "gguf:A",
  leaseKind: "gguf-model",
  priority: "interactive",
  estimatedBytes: 1024,
};

/**
 * Nạp một bản `vramEventLog` SẠCH kèm một cửa DB giả **bắt lấy đối số `.values()`**.
 *
 * ⚠ `vi.resetModules()` là bắt buộc: `queue` và bộ đếm `soSuKienBiVut` là **trạng thái module**;
 *   dùng lại một bản đã nạp là để hàng của ca trước rò sang ca sau.
 */
async function napLog(): Promise<{
  logVramEvent: (e: VramEventInput) => void;
  flushVramEvents: () => Promise<number>;
  daGhi: Record<string, unknown>[];
}> {
  vi.resetModules();
  const daGhi: Record<string, unknown>[] = [];
  vi.doMock("../../db/connection", () => ({
    getDb: async () => ({
      insert: () => ({
        values: async (rows: Record<string, unknown>[]) => {
          daGhi.push(...rows);
        },
      }),
    }),
  }));
  const mod = await import("./vramEventLog");
  mod.__setVramLogTimerEnabled(false);
  return { logVramEvent: mod.logVramEvent, flushVramEvents: mod.flushVramEvents, daGhi };
}

/**
 * Hàng **THẬT** mà `flushVramEvents()` đưa cho drizzle cho đúng một sự kiện.
 *
 * ⚠ Khẳng định `ghi === 1` là **cầu chì**: `flushVramEvents()` **nuốt mọi lỗi** và trả `0`, nên
 *   không có nó thì một lượt hỏng biến mọi ca dưới thành **chân lý rỗng trên một hàng `undefined`**.
 */
async function hangGhiThat(e: VramEventInput): Promise<Record<string, unknown>> {
  const { logVramEvent, flushVramEvents, daGhi } = await napLog();
  logVramEvent(e);
  const ghi = await flushVramEvents();
  expect(ghi, "lượt ghi lô KHÔNG thành công ⇒ mọi khẳng định dưới là chân lý rỗng").toBe(1);
  expect(daGhi.length, "cửa DB giả không nhận được hàng nào").toBe(1);
  return daGhi[0] as Record<string, unknown>;
}

/** `detail.truncatedFields` của một hàng, đã tách lấy **TÊN Ô** (`"owner: 300>160"` ⇒ `"owner"`). */
function oDaCat(hang: Record<string, unknown>): string[] {
  const d = hang.detail as Record<string, unknown> | null | undefined;
  const ds = d?.truncatedFields;
  if (ds === undefined) return [];
  expect(Array.isArray(ds), "`truncatedFields` phải là mảng").toBe(true);
  return (ds as string[]).map((s) => s.split(":")[0]!.trim()).sort();
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// ∀-A — BẢN PHÂN LOẠI. Mỗi cột `varchar` của `vram_events` nằm ở ĐÚNG MỘT trong hai vế.
// ══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Vế MỘT — ô **CÓ NGƯỜI LÁI**: tồn tại một chuỗi tự do của `VramEventInput` đẩy ô ấy tới **đúng
 * `n` ký tự**. Mọi ô ở đây **phải** có mặt ở `VARCHAR_LIMITS`, và ngược lại (ca ∀-C dưới).
 *
 * ⚠ Ba ô cuối là **union ĐÓNG** ở tầng `tsc`, nhưng vẫn **có bề rộng khai** — cố ý: `logVramEvent()`
 *   là cửa vào của **mọi** điểm sản xuất, kể cả những chỗ dựng giá trị **động** (`detail.reason`
 *   ghép chuỗi, `estimateSource` từ cấu hình). Một union đóng ở `tsc` **không** chặn được một `any`
 *   đi qua biên module, và cái giá của việc sai là **mất cả lô**.
 */
const O_CO_NGUOI_LAI: Readonly<Record<string, (n: number) => VramEventInput>> = {
  event: (n) => ({ ...NEN, event: "e".repeat(n) }),
  owner: (n) => ({ ...NEN, owner: "o".repeat(n) }),
  leaseKind: (n) => ({ ...NEN, leaseKind: "k".repeat(n) as VramLeaseKind }),
  priority: (n) => ({ ...NEN, priority: "p".repeat(n) as VramPriority }),
  estimateSource: (n) => ({ ...NEN, estimateSource: "s".repeat(n) as VramEstimateSource }),
};

/**
 * Vế HAI — cột **KHÔNG có chuỗi tự do nào lái được**, kèm LÝ DO đọc được. Một danh sách không lý do
 * là một danh sách **miễn trừ** (khuôn `CANH_NAY_KHONG_DUNG_NOI` của `vramReadModel.drift.test.ts`).
 *
 * ⚠ Lý do ở đây **KHÔNG được tin** — ca ∀-B đo lại từng dòng trên hàng `INSERT` thật.
 */
const O_KHONG_LAI_DUOC: readonly { readonly o: string; readonly viSao: string }[] = [
  {
    o: "resourceKind",
    viSao:
      "`VramEventInput` KHÔNG có ô này và `flushVramEvents()` KHÔNG phát ra khoá ấy ⇒ giá trị do " +
      "Postgres điền (`DEFAULT 'vram'`, 4 ký tự / trần 16). Không đường nào của ứng dụng lái được nó.",
  },
  {
    o: "wouldRefuse",
    viSao:
      "`VramEventInput.wouldRefuse` là **boolean**; hàng phát ra `String(boolean)` ⇒ dài nhất 5 " +
      "(`false`) trên trần 8, hoặc `null`. Union đóng ở tầng KIỂU, không phải một lời hứa.",
  },
];

describe("★★★ Pha 7 Task 3 / ∀-A — `VARCHAR_LIMITS` phải KHỚP drizzle: ĐỦ, KHÔNG THỪA, ĐÚNG SỐ", () => {
  it("★★★ cầu chì — bộ đọc drizzle thấy đủ cột (0 cột ⇒ mọi khẳng định dưới là chân lý rỗng)", async () => {
    const { vramEvents } = await import("../../../drizzle/schema/vram");
    expect(cotVarchar(vramEvents).size, "bộ đọc không thấy cột `varchar` nào — nó đã hỏng?").toBeGreaterThanOrEqual(7);
    expect(moiCot(vramEvents).size, "bộ đọc không thấy cột nào — nó đã hỏng?").toBeGreaterThanOrEqual(14);
    const { VARCHAR_LIMITS } = await import("./vramEventLog");
    expect(VARCHAR_LIMITS.length, "bảng bề rộng rỗng ⇒ phép cắt không tồn tại").toBeGreaterThanOrEqual(5);
  });

  it("★★★ MỌI cột `varchar` của `vram_events` được PHÂN LOẠI vào ĐÚNG MỘT vế (cột thứ tám ⇒ ĐỎ)", async () => {
    const { vramEvents } = await import("../../../drizzle/schema/vram");
    const { VARCHAR_LIMITS } = await import("./vramEventLog");
    const tuDrizzle = cotVarchar(vramEvents);
    const khai = new Set(VARCHAR_LIMITS.map(([k]) => String(k)));
    const khongLai = new Set(O_KHONG_LAI_DUOC.map((x) => x.o));

    const chuaPhanLoai = [...tuDrizzle.keys()].filter((c) => !khai.has(c) && !khongLai.has(c));
    expect(
      chuaPhanLoai.join(" · "),
      "cột `varchar` của `vram_events` CHƯA được phân loại ⇒ một chuỗi quá trần có thể tới Postgres " +
        "mà không luật nào chạm tới, và `22001` làm MẤT CẢ LÔ (tiền lệ migration 0311)",
    ).toBe("");

    const caHai = [...khai].filter((c) => khongLai.has(c));
    expect(caHai.join(" · "), "một cột vừa CÓ-NGƯỜI-LÁI vừa KHÔNG-LÁI-ĐƯỢC là một bản khai tự mâu thuẫn").toBe("");

    // ⚠ Vế "không lái được" phải có LÝ DO — không lý do thì nó là một danh sách miễn trừ.
    expect(
      O_KHONG_LAI_DUOC.filter((x) => x.viSao.trim().length < 40).map((x) => x.o).join(" · "),
      "một dòng miễn trừ KHÔNG LÝ DO",
    ).toBe("");
  });

  it("★★★ CHIỀU NGƯỢC — mọi mục của `VARCHAR_LIMITS` là cột THẬT, với ĐÚNG bề rộng của drizzle", async () => {
    const { vramEvents } = await import("../../../drizzle/schema/vram");
    const { VARCHAR_LIMITS } = await import("./vramEventLog");
    const tuDrizzle = cotVarchar(vramEvents);

    const khongCoCot = VARCHAR_LIMITS.map(([k]) => String(k)).filter((k) => !tuDrizzle.has(k));
    expect(
      khongCoCot.join(" · "),
      "hằng khai một cột KHÔNG CÒN (hoặc CHƯA CÓ) trong bảng ⇒ nó đang canh một thứ không tồn tại",
    ).toBe("");

    const lech = VARCHAR_LIMITS.filter(([k, n]) => tuDrizzle.get(String(k)) !== n);
    expect(
      lech.map(([k, n]) => `${String(k)}: hằng=${n} drizzle=${tuDrizzle.get(String(k))}`).join("\n"),
      "bề rộng cột và hằng đã TRÔI khỏi nhau ⇒ bộ làm sạch cắt ở một chỗ, Postgres ném ở chỗ khác",
    ).toBe("");

    // …và vế "không lái được" cũng không được khai một cột đã chết.
    const daChet = O_KHONG_LAI_DUOC.map((x) => x.o).filter((c) => !tuDrizzle.has(c));
    expect(daChet.join(" · "), "bản khai giữ một cột KHÔNG CÒN trong bảng").toBe("");
  });

  /**
   * ⚠⚠ Cùng bài học **Pha 7 Task 9** đã trả giá ở `vram_leases`: lọc `PgVarchar` **đúng** cho câu
   * hỏi *"bề rộng"* và **mù theo CẤU TẠO** với mọi cột khác kiểu. Nên có thêm một lượng từ trên
   * **MỌI KIỂU**: một cột thứ mười lăm sinh ra mà `flushVramEvents()` **không ghi** và cũng **không
   * ai khai là do DB sinh** ⇒ ĐỎ — chứ không phải một cột `NULL` vĩnh viễn mà không ai biết.
   */
  it("★★★ ∀ cột (MỌI KIỂU) của `vram_events`: hoặc hàng INSERT ghi nó, hoặc DO DB SINH có lý do", async () => {
    const { vramEvents } = await import("../../../drizzle/schema/vram");
    const cotDb = moiCot(vramEvents);
    const hang = await hangGhiThat(NEN);

    /** Cột **DO DB SINH** — ứng dụng cố ý không ghi. Danh sách nhỏ, mỗi dòng một lý do. */
    const doDbSinh: Readonly<Record<string, string>> = {
      id: "`serial` — khoá chính do Postgres cấp; ứng dụng ghi vào đây là tự đẻ ra tranh chấp.",
      createdAt: "`DEFAULT now()` — mốc thời gian phải là của **máy chủ DB**, không của tiến trình ghi.",
      resourceKind: "`DEFAULT 'vram'` — một CỘT để sau thêm ram/cpu/disk, không phải một ô người gọi lái.",
    };

    const khongAiGhi = [...cotDb].filter((c) => !(c in hang) && !(c in doDbSinh));
    expect(
      khongAiGhi.join(" · "),
      "cột của `vram_events` KHÔNG được hàng INSERT ghi và cũng KHÔNG được khai là do DB sinh ⇒ " +
        "nó sẽ là NULL vĩnh viễn, im lặng (đúng lớp lỗi mà Pha 7 Task 9 đóng ở `vram_leases`)",
    ).toBe("");

    const oThua = Object.keys(hang).filter((o) => !cotDb.has(o));
    expect(
      oThua.join(" · "),
      "hàng INSERT mang một ô KHÔNG CÓ cột thật ⇒ drizzle sẽ ném, và `flushVramEvents()` NUỐT lỗi ấy",
    ).toBe("");

    const khaiThua = Object.keys(doDbSinh).filter((c) => !cotDb.has(c));
    expect(khaiThua.join(" · "), "bản khai 'do DB sinh' giữ một cột không còn trong bảng").toBe("");
  });
});

describe("★★★ Pha 7 Task 3 / ∀-B — vế 'KHÔNG LÁI ĐƯỢC' phải ĐÚNG SỰ THẬT (đo trên hàng INSERT)", () => {
  it("★★★ với đầu vào CỰC ĐẠI: mọi cột vế hai hoặc VẮNG khỏi hàng, hoặc NGẮN HƠN trần", async () => {
    const { vramEvents } = await import("../../../drizzle/schema/vram");
    const tuDrizzle = cotVarchar(vramEvents);
    /** Đầu vào cực đại: **mọi** ô chuỗi tự do dài 10.000, và `wouldRefuse` ở nhánh chuỗi DÀI hơn. */
    const hang = await hangGhiThat({
      event: "e".repeat(10_000),
      owner: "o".repeat(10_000),
      leaseKind: "k".repeat(10_000) as VramLeaseKind,
      priority: "p".repeat(10_000) as VramPriority,
      estimateSource: "s".repeat(10_000) as VramEstimateSource,
      wouldRefuse: false, // `"false"` = 5 ký tự, dài hơn `"true"`
    });

    for (const { o } of O_KHONG_LAI_DUOC) {
      const tran = tuDrizzle.get(o);
      expect(tran, `${o} phải là một cột \`varchar\` có bề rộng`).toBeTypeOf("number");
      if (!(o in hang)) continue; // vắng khỏi hàng ⇒ Postgres điền DEFAULT, không đường nào lái
      const v = hang[o];
      if (v === null) continue;
      expect(typeof v, `${o} phải là chuỗi hoặc null`).toBe("string");
      expect(
        String(v).length,
        `${o} phải NGẮN HƠN trần — nếu không, "không lái được" là một lý do SAI và cột này cần bề rộng khai`,
      ).toBeLessThan(tran as number);
    }
  });

  it("★★ ĐỐI CHỨNG DƯƠNG — `resourceKind` thật sự VẮNG khỏi hàng, `wouldRefuse` thật sự là `String(boolean)`", async () => {
    /** ⚠ Một lý do viết ra mà không ai đo lại là một lý do sẽ sai lặng lẽ. */
    expect(Object.keys(await hangGhiThat(NEN)), "hàng KHÔNG được mang `resourceKind`").not.toContain("resourceKind");
    expect((await hangGhiThat({ ...NEN, wouldRefuse: true })).wouldRefuse).toBe("true");
    expect((await hangGhiThat({ ...NEN, wouldRefuse: false })).wouldRefuse).toBe("false");
    expect((await hangGhiThat(NEN)).wouldRefuse, "không khai ⇒ `null`, KHÔNG phải chuỗi `\"undefined\"`").toBeNull();
  });
});

describe("★★★ Pha 7 Task 3 / ∀-C — vượt trần ⇒ CẮT + KHAI; ĐÚNG BẰNG trần ⇒ KHÔNG khai (ô BIÊN)", () => {
  it("★★★ MỌI ô của `VARCHAR_LIMITS` phải có NGƯỜI LÁI ở lưới này (thiếu ⇒ bản phân loại là trang trí)", async () => {
    const { VARCHAR_LIMITS } = await import("./vramEventLog");
    const thieuNguoiLai = VARCHAR_LIMITS.map(([k]) => String(k)).filter((k) => !(k in O_CO_NGUOI_LAI));
    expect(
      thieuNguoiLai.join(" · "),
      "một ô có bề rộng khai mà lưới KHÔNG lái được ⇒ phép cắt của nó chưa bao giờ được chạy thử",
    ).toBe("");
    const laiCaiDaChet = Object.keys(O_CO_NGUOI_LAI).filter((k) => !VARCHAR_LIMITS.some(([c]) => String(c) === k));
    expect(laiCaiDaChet.join(" · "), "lưới lái một ô KHÔNG CÒN trong bảng hằng").toBe("");
  });

  it("★★★ với MỌI ô có bề rộng: vượt trần MỘT ký tự ⇒ cắt ĐÚNG TẠI trần và `truncatedFields` gọi ĐÚNG TÊN", async () => {
    const { VARCHAR_LIMITS } = await import("./vramEventLog");
    for (const [k, tran] of VARCHAR_LIMITS) {
      const o = String(k);
      const hang = await hangGhiThat(O_CO_NGUOI_LAI[o]!(tran + 1));
      expect(String(hang[o]).length, `${o} phải bị cắt ĐÚNG tại trần`).toBe(tran);
      // ⚠ **BẰNG**, không phải "chứa": khai thừa một tên là một lời khai sai theo chiều kia.
      expect(oDaCat(hang), `${o} vượt trần MỘT ký tự ⇒ phải được KHAI, và CHỈ nó`).toEqual([o]);
    }
  });

  it("★★★ Ô BIÊN — với MỌI ô có bề rộng: dài ĐÚNG BẰNG trần ⇒ KHÔNG khai, giá trị NGUYÊN VẸN", async () => {
    /**
     * ⚠⚠ Pha 5 Task 5 **thiếu đúng ca này**. Vị từ sai điển hình là `v.length === trần ⇒ đã cắt`:
     * nó khai nhầm cho một chuỗi vừa khít, và một lời khai sai làm người đọc nhật ký đi tìm dữ
     * liệu đã mất **không hề mất**.
     */
    const { VARCHAR_LIMITS } = await import("./vramEventLog");
    for (const [k, tran] of VARCHAR_LIMITS) {
      const o = String(k);
      const vao = O_CO_NGUOI_LAI[o]!(tran);
      const hang = await hangGhiThat(vao);
      expect(String(hang[o]).length, `${o} dài đúng bằng trần thì KHÔNG được đụng tới`).toBe(tran);
      expect(hang[o], `${o} phải NGUYÊN VẸN`).toBe((vao as unknown as Record<string, unknown>)[o]);
      expect(oDaCat(hang), `${o} vừa khít trần ⇒ KHÔNG được khai là đã cắt`).toEqual([]);
    }
  });
});

describe("★★★ Pha 7 Task 3 / ∀-D — hàng INSERT KHÔNG BAO GIỜ vượt bề rộng cột (22001 = mất CẢ LÔ)", () => {
  it("★★★ đầu vào cực đại ⇒ MỌI ô chuỗi của hàng ≤ bề rộng cột, và `truncatedFields` BẰNG tập ô quá trần", async () => {
    const { vramEvents } = await import("../../../drizzle/schema/vram");
    const { VARCHAR_LIMITS } = await import("./vramEventLog");
    const tuDrizzle = cotVarchar(vramEvents);
    const hang = await hangGhiThat({
      event: "e".repeat(10_000),
      owner: "o".repeat(10_000),
      leaseKind: "k".repeat(10_000) as VramLeaseKind,
      priority: "p".repeat(10_000) as VramPriority,
      estimateSource: "s".repeat(10_000) as VramEstimateSource,
      wouldRefuse: false,
    });

    const qua: string[] = [];
    for (const [o, v] of Object.entries(hang)) {
      if (typeof v !== "string") continue;
      const tran = tuDrizzle.get(o);
      expect(tran, `hàng mang một chuỗi ở ô \`${o}\` mà cột ấy KHÔNG phải \`varchar\` có bề rộng`).toBeTypeOf("number");
      if (String(v).length > (tran as number)) qua.push(`${o}: ${String(v).length}>${tran}`);
    }
    expect(qua.join(" · "), "một ô chuỗi vượt bề rộng cột ⇒ `22001` ⇒ MẤT CẢ LÔ, im lặng").toBe("");

    expect(
      oDaCat(hang),
      "`truncatedFields` phải BẰNG tập ô có bề rộng khai — thiếu một tên là một lượt cắt IM LẶNG",
    ).toEqual(VARCHAR_LIMITS.map(([k]) => String(k)).sort());
  });

  it("★★ KHÔNG BẮT NHẦM — sự kiện bình thường: KHÔNG `truncatedFields`, và `detail` người gọi còn NGUYÊN", async () => {
    const hang = await hangGhiThat({ ...NEN, detail: { site: "test", nested: { n: 7 } } });
    const d = hang.detail as Record<string, unknown>;
    expect(d, "`detail` phải đi tới hàng").toBeTruthy();
    expect("truncatedFields" in d, "không ô nào quá trần ⇒ KHÔNG được khai đã cắt").toBe(false);
    expect(d.site).toBe("test");
    expect(d.nested).toEqual({ n: 7 });
    // …và các ô chuỗi đi qua NGUYÊN VẸN.
    expect(hang.event).toBe(NEN.event);
    expect(hang.owner).toBe(NEN.owner);
    expect(hang.leaseKind).toBe(NEN.leaseKind);
    expect(hang.priority).toBe(NEN.priority);
  });
});
