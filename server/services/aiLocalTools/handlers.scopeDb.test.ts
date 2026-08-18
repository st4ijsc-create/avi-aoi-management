/**
 * ★★★ 2026-08-18 (nhóm B #1) — **PHẠM VI DỮ LIỆU CỦA `get_factory_stats` / `get_ng_compare`,
 * ĐO TRÊN CSDL THẬT.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ VÌ SAO CA NÀY PHẢI CHẠM CSDL THẬT, KHÔNG ĐƯỢC LÀ MOCK.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Thứ đang được canh là một **mệnh đề WHERE**. Một `db` giả chỉ ghi lại xem `where()` được gọi với
 * cái gì — nó **không phát biểu được** câu hỏi duy nhất quan trọng: *"hàng của nhà máy KHÁC có ra
 * khỏi truy vấn không?"*. Repo này đã đếm đúng lớp lỗi ấy nhiều lần (một bộ lọc "có mặt" mà vẫn
 * không lọc: `or()` rỗng trả `undefined` ⇒ KHÔNG có WHERE ⇒ thấy TẤT CẢ, và mọi lưới mock đều
 * xanh). Ở đây hai nhà máy được GIEO THẬT với **TÊN phân biệt được**, rồi ta hỏi: tên nhà máy B có
 * lọt vào kết quả của người chỉ được gán nhà máy A hay không.
 *
 * ⚠ `get_factory_stats` rò **TÊN nhà máy**, không chỉ số — tức lộ cấu trúc tổ chức. Nên ca âm ở
 * đây khẳng định trên **chuỗi textSummary NGUYÊN VĂN** (thứ thật sự đi vào prompt của LLM), không
 * chỉ trên mảng `data`.
 *
 * ⚠ MỘT THỨ DUY NHẤT bị chặn: `checkPermission` (cổng RBAC) — vì file này đo **PHẠM VI**, không đo
 * quyền, và bắt lưới phụ thuộc vào bảng `permissions` của DB test là làm nó bất định. Bộ phân giải
 * phạm vi (`getUserAssignmentCodes` → `user_factory_assignments`) là **HÀNG THẬT**, đọc **hàng gieo
 * thật**. `clearAssignmentCache()` được gọi giữa các ca vì bộ nhớ đệm 30 giây của nó sẽ khiến ca
 * sau đọc phạm vi của ca trước.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import postgres from "postgres";

// ── Chặn DUY NHẤT cổng RBAC; mọi thứ khác (phân giải phạm vi, drizzle, CSDL) là hàng thật. ──
const H = vi.hoisted(() => ({ choQua: true }));
vi.mock("../../_core/accessControl", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../_core/accessControl")>();
  return { ...actual, checkPermission: async () => H.choQua };
});

import { clearAssignmentCache } from "../../_core/accessControl";
import { getFactoryStats, getNgCompare } from "./handlers";

const DB_URL = process.env.DATABASE_URL;
const RUN = `bsc_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
const CODE_A = `SCOPEA_${RUN}`;
const CODE_B = `SCOPEB_${RUN}`;
/** TÊN cố ý khác hẳn nhau + duy nhất: đây là thứ ca âm đi tìm trong chuỗi kết quả. */
const NAME_A = `Nhà máy PHẠM-VI-A ${RUN}`;
const NAME_B = `Nhà máy BÍ-MẬT-B ${RUN}`;

/** Ba danh tính. `role` KHÔNG phải "admin" ⇒ đi qua đúng đường phân giải phạm vi thật. */
const U_A = { userId: 900_001, role: "engineer" };
const U_ZERO = { userId: 900_002, role: "supervisor" };
const U_ADMIN = { userId: 900_003, role: "admin" };

let sql: ReturnType<typeof postgres>;
let idA: number;
let idB: number;

/** Hôm nay − n ngày, đúng 12:00 để không dính biên múi giờ của `startOfDay`. */
function ngayTruoc(n: number): Date {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return d;
}

describe.skipIf(!DB_URL)("★★★ nhóm B #1 — phạm vi dữ liệu của tool AI, trên CSDL THẬT", () => {
  beforeAll(async () => {
    sql = postgres(DB_URL!, { max: 1, connect_timeout: 30, onnotice: () => {} });

    const [fa] = await sql`INSERT INTO factories (code, name) VALUES (${CODE_A}, ${NAME_A}) RETURNING id`;
    const [fb] = await sql`INSERT INTO factories (code, name) VALUES (${CODE_B}, ${NAME_B}) RETURNING id`;
    idA = Number(fa.id);
    idB = Number(fb.id);

    // machineId phải KHÁC nhau giữa hai nhà máy: `uq_stats_machine_date` là (machineId, date).
    // Gieo cả kỳ NÀY (hôm nay) và kỳ TRƯỚC (35 ngày trước) để `get_ng_compare` có cả hai vế.
    const hangGieo: Array<[number, number, number, Date, number, number]> = [
      [idA, 990_001, 990_001, ngayTruoc(0), 100, 10],
      [idA, 990_001, 990_001, ngayTruoc(35), 100, 5],
      [idB, 990_002, 990_002, ngayTruoc(0), 500, 250],
      [idB, 990_002, 990_002, ngayTruoc(35), 500, 100],
    ];
    for (const [fid, mid, wid, date, total, ng] of hangGieo) {
      await sql`
        INSERT INTO daily_statistics ("machineId", "factoryId", "workshopId", date, "totalCount", "okCount", "ngCount", "ntfCount")
        VALUES (${mid}, ${fid}, ${wid}, ${date}, ${total}, ${total - ng}, ${ng}, 0)
      `;
    }

    await sql`INSERT INTO user_factory_assignments ("userId", "factoryCode") VALUES (${U_A.userId}, ${CODE_A})`;
    // U_ZERO: CỐ Ý không gieo dòng nào — đây là "tài khoản 0 gán".
  });

  afterAll(async () => {
    await sql`DELETE FROM daily_statistics WHERE "factoryId" IN (${idA}, ${idB})`;
    await sql`DELETE FROM user_factory_assignments WHERE "userId" IN (${U_A.userId}, ${U_ZERO.userId}, ${U_ADMIN.userId})`;
    await sql`DELETE FROM factories WHERE code IN (${CODE_A}, ${CODE_B})`;
    await sql.end();
    clearAssignmentCache();
  });

  beforeEach(() => {
    H.choQua = true;
    clearAssignmentCache();
  });

  // ───────────────────────────────────────────────────────────────────────────────────────────
  it("★★★ CẦU CHÌ: dữ liệu của CẢ HAI nhà máy đều có thật và ĐỌC ĐƯỢC (nếu không, mọi ca âm dưới đây là chân lý rỗng)", async () => {
    const r = await getFactoryStats.handler!({ days: 2, __authCtx: U_ADMIN });
    const codes = r.data.map((d) => d.factoryCode);
    expect(codes, "hàng gieo phải tới được — nếu không, ca âm bên dưới xanh vì KHÔNG CÓ GÌ để rò").toContain(CODE_A);
    expect(codes).toContain(CODE_B);
  });

  // ── CHIỀU ÂM 1: A không thấy B — kể cả TÊN ─────────────────────────────────────────────────
  it("★★★ ÂM — người được gán A KHÔNG thấy nhà máy B, và KHÔNG thấy cả TÊN của B", async () => {
    const r = await getFactoryStats.handler!({ days: 2, __authCtx: U_A });

    expect(r.data.map((d) => d.factoryCode)).toEqual([CODE_A]);
    expect(r.data.map((d) => d.factoryId)).toEqual([idA]);
    // ⚠ Khẳng định trên CHUỖI: `textSummary` là thứ thật sự đi vào prompt của LLM. Một bản vá
    // chỉ lọc `data` mà vẫn dựng câu tóm tắt từ nguồn khác sẽ ĐỎ ở đây.
    expect(r.textSummary).toContain(NAME_A);
    expect(r.textSummary, "TÊN nhà máy B rò ra ⇒ lộ cấu trúc tổ chức").not.toContain(NAME_B);
    expect(r.textSummary).not.toContain(CODE_B);
    expect(JSON.stringify(r), "mã HOẶC tên của B lọt vào BẤT KỲ ô nào của kết quả").not.toContain(CODE_B);
    expect(JSON.stringify(r)).not.toContain(NAME_B);
  });

  it("★★★ ÂM — `get_ng_compare` của A KHÔNG cộng sản lượng của B", async () => {
    const r = await getNgCompare.handler!({ period: "month", __authCtx: U_A });
    // Kỳ này của A: 100 sp / 10 NG. Nếu B (500/250) bị cộng vào thì total ≥ 600.
    expect(r.data.current.total).toBe(100);
    expect(r.data.current.ng).toBe(10);
    expect(r.note).toBeUndefined();
  });

  // ── CHIỀU ÂM 2: 0 gán ⇒ TỪ CHỐI TRUNG THỰC ────────────────────────────────────────────────
  it("★★★ ÂM — tài khoản 0 GÁN nhận TỪ CHỐI TRUNG THỰC, không phải một kết quả rỗng", async () => {
    for (const [ten, r] of [
      ["get_factory_stats", await getFactoryStats.handler!({ days: 2, __authCtx: U_ZERO })],
      ["get_ng_compare", await getNgCompare.handler!({ period: "month", __authCtx: U_ZERO })],
    ] as const) {
      expect(r.note, `${ten}: phải tự khai lý do bằng một mã CÓ CẤU TRÚC`).toBe("PERMISSION_DENIED");
      expect(r.textSummary, `${ten}: phải nói tài khoản CHƯA ĐƯỢC GÁN`).toMatch(/chưa được gán/i);
      /**
       * ⚠⚠ ĐÂY LÀ CA CỐT LÕI CỦA "TỪ CHỐI TRUNG THỰC". Câu *"không có nhà máy nào"* là một **lời
       * khai SAI VỀ THẾ GIỚI**: hệ thống CÓ nhà máy (ca cầu chì ở trên vừa chứng minh), người hỏi
       * chỉ không được gán cái nào. Nghe câu ấy, người vận hành sẽ đi tìm lỗi ở đúng chỗ không có
       * lỗi — hoặc kết luận nhà máy đã bị xoá.
       */
      expect(r.textSummary, `${ten}: nói SAI về thế giới`).not.toMatch(/không có nhà máy nào/i);
      expect(r.textSummary, `${ten}: giả vờ hệ thống hết số liệu`).not.toMatch(/không có dữ liệu|chưa có dữ liệu/i);
    }
  });

  it("★★★ ÂM — tài khoản 0 GÁN không nhận về MỘT BYTE dữ liệu nào của A hay B", async () => {
    const r = await getFactoryStats.handler!({ days: 2, __authCtx: U_ZERO });
    expect(r.data).toEqual([]);
    expect(JSON.stringify(r)).not.toContain(NAME_A);
    expect(JSON.stringify(r)).not.toContain(NAME_B);

    const c = await getNgCompare.handler!({ period: "month", __authCtx: U_ZERO });
    expect(c.data.current.total).toBe(0);
    expect(c.data.previous.total).toBe(0);
  });

  // ── CHIỀU DƯƠNG 1: admin thấy TOÀN BỘ ─────────────────────────────────────────────────────
  it("★★★ DƯƠNG — admin vẫn thấy CẢ HAI nhà máy (lưới chống 'vá an ninh bằng cách chặn tất cả mọi người')", async () => {
    const r = await getFactoryStats.handler!({ days: 2, __authCtx: U_ADMIN });
    const codes = r.data.map((d) => d.factoryCode);
    expect(codes).toContain(CODE_A);
    expect(codes).toContain(CODE_B);
    expect(r.textSummary).toContain(NAME_B);
    expect(r.note).toBeUndefined();
    // Admin KHÔNG được gắn ghi chú phạm vi — vì không có phạm vi nào được áp.
    expect(r.textSummary).not.toMatch(/phạm vi:/i);

    const c = await getNgCompare.handler!({ period: "month", __authCtx: U_ADMIN });
    expect(c.data.current.total, "admin phải cộng cả A (100) lẫn B (500)").toBeGreaterThanOrEqual(600);
  });

  // ── CHIỀU DƯƠNG 2: A vẫn thấy ĐỦ A ────────────────────────────────────────────────────────
  it("★★★ DƯƠNG — người được gán A vẫn nhận ĐỦ số liệu của A (không bị vá quá tay)", async () => {
    const r = await getFactoryStats.handler!({ days: 2, __authCtx: U_A });
    const a = r.data.find((d) => d.factoryCode === CODE_A);
    expect(a, "A phải còn nguyên").toBeTruthy();
    expect(a!.total).toBe(100);
    expect(a!.ng).toBe(10);
    expect(a!.ngRate).toBe(10);
    expect(a!.factoryName).toBe(NAME_A);
    // Kết quả nói RÕ nó là một phạm vi thu hẹp — một tổng "toàn hệ thống" và một tổng "nhà máy
    // của tôi" trông giống hệt nhau nếu không ghi ra.
    expect(r.textSummary).toMatch(/phạm vi: 1 nhà máy/i);
  });

  // ── ĐỘT BIẾN CÓ TÊN: `scope = resolved` nguyên khối / bỏ nhánh isGlobal ────────────────────
  it("★★ `factoryIdsInScope` NÉM khi bị gọi với phạm vi TOÀN CỤC (rẽ nhánh isGlobal là BẮT BUỘC, không phải tuỳ chọn)", async () => {
    const { factoryIdsInScope } = await import("../../_core/aiAnalyticsScope");
    await expect(
      factoryIdsInScope({ isGlobal: true, factoryCodes: [], corporateCodes: [] }),
    ).rejects.toThrow(/TOÀN CỤC/i);
  });

  it("★★ kết quả của tool tuần tự hoá được bằng JSON (không mang tham chiếu VÒNG của drizzle)", () => {
    // ⚠ Lớp lỗi đo được 2026-08-17: `resolveDataScope` trả CẢ `filter` (đối tượng SQL, vòng);
    // `{...scope}` ⇒ superjson chết `Converting circular structure to JSON` ⇒ 500 cho mọi người
    // dùng, và `tsc` KHÔNG bắt được. Ở đây ta ĐO chứ không tin.
    return Promise.all([
      getFactoryStats.handler!({ days: 2, __authCtx: U_A }),
      getNgCompare.handler!({ period: "month", __authCtx: U_A }),
      getFactoryStats.handler!({ days: 2, __authCtx: U_ZERO }),
    ]).then((rs) => {
      for (const r of rs) expect(() => JSON.stringify(r)).not.toThrow();
    });
  });
});
