/**
 * ★★★ 2026-08-18 (nhóm B #4) — **`aiTimeSeries.analyzeMetric` KHÔNG CÒN QUÉT `daily_statistics`
 * TOÀN CỤC.** Đo trên CSDL THẬT (vitest.setup.ts đã đổi `DATABASE_URL` sang `<db>_test`).
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Trước bản vá, thủ tục này là `protectedProcedure` TRẦN: cổng duy nhất của nó là *"đã đăng
 * nhập"*. Nó gộp `SUM(totalCount/okCount/ngCount)` theo NGÀY trên **toàn bộ** `daily_statistics`
 * rồi trả về một chuỗi thời gian — tức bất kỳ tài khoản nào cũng đọc được sản lượng và tỉ lệ NG
 * của **mọi nhà máy** trong hệ, chỉ khác là dưới dạng biểu đồ thay vì bảng.
 *
 * ⚠ VÌ SAO CHẠM CSDL THẬT: thứ được canh là một **mệnh đề WHERE** trên một bảng ĐÃ CÓ `factoryId`
 * NOT NULL. Một `db` giả chỉ nói được "hàm đã được gọi", không nói được *"hàng của nhà máy khác có
 * ra khỏi truy vấn không"* — mà chính đó là câu hỏi. Hai nhà máy được GIEO THẬT với **con số phân
 * biệt được**, rồi ta đọc tổng ở đầu ra.
 *
 * ⚠ CHỈ chặn tầng TRA CỨU GÁN (`db/auth`, đã có lưới riêng) — router, phân giải phạm vi, truy vấn,
 * drizzle, CSDL đều là hàng THẬT.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import postgres from "postgres";

/**
 * ⚠⚠ CHẶN Ở **TẦNG TRA CỨU GÁN** (`db/auth`), KHÔNG ở `accessControl.getUserAssignmentCodes`.
 *
 * Bản nháp đầu chặn `getUserAssignmentCodes` bằng `{...actual, getUserAssignmentCodes: mock}` — và
 * lưới **BẮT ĐƯỢC RẰNG NÓ SAI**: `resolveDataScope` nằm CÙNG module nên nó gọi **bản gốc trong
 * module**, không gọi bản đã chặn. Hậu quả đo được: bộ lọc đi theo phạm vi GIẢ (A) trong khi ba ô
 * NHÃN đi theo phạm vi THẬT (rỗng) ⇒ một đáp ứng **tự mâu thuẫn**. Chặn thấp hơn một tầng làm cả
 * hai đường cùng đọc một sự thật, đúng như lúc chạy thật.
 */
const mockFactoryAssignments = vi.fn();
const mockCorporateAssignments = vi.fn();
vi.mock("../db/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../db/auth")>();
  return {
    ...actual,
    getUserFactoryAssignments: (...a: unknown[]) => mockFactoryAssignments(...a),
    getUserCorporateAssignments: (...a: unknown[]) => mockCorporateAssignments(...a),
  };
});

import { clearAssignmentCache } from "../_core/accessControl";

function gan(opts: { factoryCodes?: string[] }) {
  mockFactoryAssignments.mockResolvedValue((opts.factoryCodes ?? []).map((factoryCode) => ({ factoryCode })));
  mockCorporateAssignments.mockResolvedValue([]);
  clearAssignmentCache(); // bộ nhớ đệm 30 giây, khoá theo userId — không được để ca trước rò sang.
}

const DB_URL = process.env.DATABASE_URL;
const RUN = `ts4_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
const CODE_A = `TS4A_${RUN}`;
const CODE_B = `TS4B_${RUN}`;

const ctxFor = (id: number, role: string) => ({ user: { id, role } }) as never;

let sql: ReturnType<typeof postgres>;
let idA: number;
let idB: number;

/** Tổng `inspection_count` mà một người gọi thật sự nhìn thấy trong chuỗi thời gian trả về. */
function tongNhinThay(r: { dataPoints: Array<{ value: number }> }): number {
  return r.dataPoints.reduce((s, p) => s + Number(p.value), 0);
}

/**
 * ⚠ NỬA ĐÊM, và luôn ở QUÁ KHỨ. Bản nháp đầu gieo lúc 12:00 của "hôm nay" — mà `analyzeMetric`
 * chặn trên `date <= endDate` với `endDate = new Date()`; chạy lưới lúc 06:00 sáng thì **cả một
 * ngày gieo rơi ra ngoài** và tổng lệch đúng một ngày. Đúng lớp lỗi "phép đo sai vì biên thời
 * gian", không phải lỗi sản phẩm — nên sửa ở lưới.
 */
function ngayTruoc(n: number): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return d;
}

describe.skipIf(!DB_URL)("★★★ nhóm B #4 — analyzeMetric bị giới hạn theo factoryId, trên CSDL THẬT", () => {
  beforeAll(async () => {
    sql = postgres(DB_URL!, { max: 1, connect_timeout: 30, onnotice: () => {} });
    const [fa] = await sql`INSERT INTO factories (code, name) VALUES (${CODE_A}, ${"TS4 A " + RUN}) RETURNING id`;
    const [fb] = await sql`INSERT INTO factories (code, name) VALUES (${CODE_B}, ${"TS4 B " + RUN}) RETURNING id`;
    idA = Number(fa.id);
    idB = Number(fb.id);

    // 5 NGÀY khác nhau (đủ > 3 điểm cho mọi nhánh phân tích), mỗi ngày: A = 10, B = 1000.
    // Con số cách nhau hai bậc ⇒ "có lẫn dữ liệu của B không" đọc thẳng ra từ tổng, không cần suy.
    for (let i = 1; i <= 5; i++) {
      const d = ngayTruoc(i);
      await sql`
        INSERT INTO daily_statistics ("machineId", "factoryId", "workshopId", date, "totalCount", "okCount", "ngCount", "ntfCount")
        VALUES (${970_001}, ${idA}, ${970_001}, ${d}, 10, 9, 1, 0)`;
      await sql`
        INSERT INTO daily_statistics ("machineId", "factoryId", "workshopId", date, "totalCount", "okCount", "ngCount", "ntfCount")
        VALUES (${970_002}, ${idB}, ${970_002}, ${d}, 1000, 500, 500, 0)`;
    }
  });

  afterAll(async () => {
    await sql`DELETE FROM daily_statistics WHERE "factoryId" IN (${idA}, ${idB})`;
    await sql`DELETE FROM factories WHERE code IN (${CODE_A}, ${CODE_B})`;
    await sql.end();
  });

  beforeEach(() => {
    mockFactoryAssignments.mockReset();
    mockCorporateAssignments.mockReset();
    clearAssignmentCache();
  });

  const caller = async (id: number, role: string) =>
    (await import("./aiTimeSeriesRouter")).aiTimeSeriesRouter.createCaller(ctxFor(id, role));

  const doiSo = { metric: "inspection_count", period: "7d", analysisType: "analyze" } as const;

  it("★★★ CẦU CHÌ: admin (toàn cục) THẤY cả A lẫn B — nếu không, mọi ca âm dưới đây là chân lý rỗng", async () => {
    // role "admin" ⇒ `getUserAssignmentCodes` ngắn mạch, không đọc bảng gán.
    gan({});
    const r = await (await caller(970_101, "admin")).analyzeMetric(doiSo);
    // 5 ngày × (10 + 1000) = 5.050 (có thể cộng thêm hàng sẵn có của DB test ⇒ dùng ≥).
    expect(tongNhinThay(r), "hàng gieo của B phải TỚI ĐƯỢC qua đường này").toBeGreaterThanOrEqual(5_050);
    expect(r.scopeApplied, "admin không bị áp bộ lọc phạm vi").toBe(false);
    expect(r.scopeEmptyReason).toBeNull();
  });

  it("★★★ ÂM — người chỉ được gán A KHÔNG nhìn thấy sản lượng của B", async () => {
    gan({ factoryCodes: [CODE_A] });
    const r = await (await caller(970_102, "engineer")).analyzeMetric(doiSo);
    // Đúng 5 ngày × 10 = 50. Một hàng nào của B lọt vào thì con số này nhảy lên hàng nghìn.
    expect(tongNhinThay(r)).toBe(50);
    expect(r.dataPoints.every((p) => Number(p.value) === 10)).toBe(true);
    expect(r.scopeApplied, "phải TỰ KHAI rằng đã áp phạm vi").toBe(true);
  });

  it("★★★ DƯƠNG — người được gán A vẫn nhận ĐỦ 5 điểm dữ liệu của A (không bị vá quá tay)", async () => {
    gan({ factoryCodes: [CODE_A] });
    const r = await (await caller(970_103, "engineer")).analyzeMetric(doiSo);
    expect(r.dataPoints.length).toBe(5);
    expect(r.summary).toMatch(/EWMA analysis/);
  });

  it("★★★ DƯƠNG — người được gán CẢ HAI nhà máy thấy CẢ HAI (phạm vi là một TẬP, không phải một mã)", async () => {
    gan({ factoryCodes: [CODE_A, CODE_B] });
    const r = await (await caller(970_104, "supervisor")).analyzeMetric(doiSo);
    // 5 ngày × 1010 = 5.050 — chứng minh bản vá KHÔNG thu về đúng một nhà máy như
    // `firstFactoryCodeInScope` (thứ sẽ cắt mất nửa dữ liệu hợp lệ của người này).
    expect(tongNhinThay(r)).toBe(5_050);
  });

  it("★★★ ÂM — tài khoản 0 GÁN nhận TỪ CHỐI TRUNG THỰC (không phải một biểu đồ rỗng)", async () => {
    gan({ factoryCodes: [] });
    const c = await caller(970_105, "supervisor");
    await expect(c.analyzeMetric(doiSo)).rejects.toMatchObject({ code: "FORBIDDEN" });

    // ⚠ Câu chữ là một phần của hợp đồng: nó phải nói tài khoản CHƯA ĐƯỢC GÁN, và tuyệt đối
    // không được nói "không có nhà máy nào" (lời khai SAI về thế giới — ca cầu chì ở trên vừa
    // chứng minh hệ thống CÓ nhà máy) hay "không có dữ liệu" (đổ lỗi cho hệ thống).
    const loi = await c.analyzeMetric(doiSo).catch((e: unknown) => e as Error);
    expect(String((loi as Error).message)).toMatch(/chưa được gán/i);
    expect(String((loi as Error).message)).not.toMatch(/không có nhà máy nào/i);
    expect(String((loi as Error).message)).not.toMatch(/không có dữ liệu|chưa có dữ liệu/i);
  });

  it("★★★ đáp ứng TUẦN TỰ HOÁ ĐƯỢC — không mang `filter` (đối tượng SQL có tham chiếu VÒNG) của `resolveDataScope`", async () => {
    /**
     * ⚠⚠ ĐÂY LÀ ĐỘT BIẾN "`scope = resolved` NGUYÊN KHỐI". `resolveDataScope` trả về CẢ `filter`;
     * `{...resolved}` sẽ nhét nó vào đáp ứng và superjson chết `Converting circular structure to
     * JSON` ⇒ **500 cho mọi người dùng** — một lỗi mà `tsc` KHÔNG bắt được và 220 ca đơn vị cũng
     * không, chỉ lộ khi gọi HTTP thật (đo được 2026-08-17 trên `dashboard.getStats`).
     */
    gan({ factoryCodes: [CODE_A] });
    const r = await (await caller(970_106, "engineer")).analyzeMetric(doiSo);
    expect(Object.hasOwn(r as object, "filter"), "`filter` lọt vào đáp ứng").toBe(false);
    expect(() => JSON.stringify(r)).not.toThrow();
    // Ba ô nhãn phải CÓ MẶT — chúng là thứ duy nhất phân biệt "phạm vi rỗng" với "dây chuyền sạch".
    expect(r).toMatchObject({ scopeApplied: expect.any(Boolean), scopeEmptyReason: null });
  });

  it("★★ mọi nhánh analysisType đều mang nhãn phạm vi (không có nhánh nào nói dối bằng cách im lặng)", async () => {
    gan({ factoryCodes: [CODE_A] });
    const c = await caller(970_107, "engineer");
    for (const analysisType of ["analyze", "forecast", "anomaly", "decompose", "changepoints"] as const) {
      const r = await c.analyzeMetric({ ...doiSo, analysisType });
      expect(r.scopeApplied, analysisType).toBe(true);
      expect(Object.hasOwn(r as object, "scopeMessage"), analysisType).toBe(true);
    }
  });
});
