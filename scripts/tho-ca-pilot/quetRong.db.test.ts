/**
 * HA-6d — bộ quét rộng `mayQuetRongPostgres` trên PostgreSQL THẬT (CSDL `aoi_management_test`, tài khoản ứng dụng — KHÔNG owner `aoi`).
 *
 * CÁCH CHỨNG MINH: trong MỘT giao dịch (REPEATABLE READ, luôn ROLLBACK ở cuối, cùng MỘT kết nối) quét TRƯỚC, chèn đúng 1 hàng vào 7 bảng thật
 * (factories, workshops, production_lines, stations, machines, workstations, user_corporate_assignments), quét SAU qua CHÍNH `mayQuetRongPostgres`.
 * Ảnh chụp REPEATABLE READ nên tiến trình khác commit không lọt vào ⇒ `soSanhQuet` phải thấy ĐÚNG 7 bảng đổi, mỗi bảng +1, tổng +7, và với danh sách "trong thẻ" = 6 bảng nền thì
 * bảng ngoài thẻ là `user_corporate_assignments` (tái hiện đúng hình dạng TC-13 âm: 9 bảng trong thẻ + 1 ngoài thẻ — ca 10 bảng đầy đủ nằm ở chayMotViec.quetRong.test.ts với bộ quét giả).
 * Sau ROLLBACK, số hàng của 7 bảng PHẢI bằng lúc đầu (ca không để lại rác). KHÔNG DELETE, KHÔNG TRUNCATE, KHÔNG DDL.
 *
 * Mỗi lệnh đếm chạy trong SAVEPOINT riêng (một bảng không đọc được không làm hỏng cả giao dịch kiểm thử; ở lượt pilot thật mỗi câu là autocommit nên không cần).
 */
import { afterAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { mayQuetRongPostgres, type SqlDem } from "./mayDemPg";
import { quetTatCa, soSanhQuet, type MayQuet } from "./quetRong";

const URL_CSDL = process.env.DATABASE_URL;
const co = URL_CSDL !== undefined && /aoi_management_test/.test(URL_CSDL);
const ts = Date.now();
const BANG = ["factories", "workshops", "production_lines", "stations", "machines", "workstations", "user_corporate_assignments"] as const;
const TRONG_THE = new Set(["factories", "workshops", "production_lines", "stations", "machines", "workstations"]);

class HoanTac extends Error {}

describe.skipIf(!co)("mayQuetRongPostgres trên PG thật (giao dịch ROLLBACK)", () => {
  const sql = postgres(URL_CSDL ?? "postgresql://x@127.0.0.1:1/x", { max: 1, onnotice: () => undefined, idle_timeout: 5, connect_timeout: 10 });
  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  const demThang = async (b: string) => Number((await sql`select count(*)::text as n from ${sql(b)}`)[0]!.n);

  it("★★★ chèn 1 hàng vào 7 bảng trong giao dịch ⇒ quét rộng thấy ĐÚNG 7 bảng +1 (tổng +7), 1 bảng ngoài thẻ; sau ROLLBACK số hàng như cũ", async () => {
    const truocNgoai: Record<string, number> = {};
    for (const b of BANG) truocNgoai[b] = await demThang(b);
    const nguoiDung = await sql`select id from users order by id limit 1`;
    expect(nguoiDung.length, "cần ít nhất một người dùng trong _test để gán tập đoàn").toBe(1);

    let ketQua: ReturnType<typeof soSanhQuet> | null = null;
    let dsBang: string[] = [];
    let truoc: Awaited<ReturnType<typeof quetTatCa>> | null = null;
    try {
      await sql.begin("isolation level repeatable read read write", async (tx) => {
        const goc = mayQuetRongPostgres(tx as unknown as SqlDem);
        // mỗi câu đếm trong SAVEPOINT riêng; các câu liệt kê / đặt phiên đi thẳng
        const may: MayQuet = {
          lietKe: () => goc.lietKe(),
          dem: async (b) => {
            try {
              return await tx.savepoint(async (sp) => mayQuetRongPostgres(sp as unknown as SqlDem).dem(b));
            } catch {
              return null;
            }
          },
        };
        dsBang = await may.lietKe();
        truoc = await quetTatCa(may);
        const [f] = await tx`insert into factories (code, name) values (${`SQF_${ts}`}, 'quet rong') returning id`;
        const [w] = await tx`insert into workshops ("factoryId", code, name) values (${f!.id as number}, ${`SQW_${ts}`}, 'w') returning id`;
        const [l] = await tx`insert into production_lines ("workshopId", code, name) values (${w!.id as number}, ${`SQL_${ts}`}, 'l') returning id`;
        const [s] = await tx`insert into stations ("lineId", code, name, "orderIndex") values (${l!.id as number}, ${`SQS_${ts}`}, 's', 1) returning id`;
        await tx`insert into machines ("stationId", code, name, "machineType") values (${s!.id as number}, ${`SQM_${ts}`}, 'm', 'AOI')`;
        await tx`insert into workstations (code, name) values (${`SQWS_${ts}`}, 'ws')`;
        await tx`insert into user_corporate_assignments ("userId", "corporateCode") values (${nguoiDung[0]!.id as number}, ${`SQC_${ts}`})`;
        const sau = await quetTatCa(may);
        ketQua = soSanhQuet(truoc, sau, TRONG_THE);
        throw new HoanTac();
      });
    } catch (e) {
      if (!(e instanceof HoanTac)) throw e;
    }
    expect(ketQua).not.toBeNull();
    const k = ketQua!;
    expect(k.ok, k.lyDo ?? "").toBe(true);
    expect(k.doi.map((d) => d.bang)).toEqual([...BANG].sort());
    for (const d of k.doi) expect(d.chenh, d.bang).toBe(1);
    expect(k.tongChenh).toBe(7);
    expect(k.ngoaiThe).toEqual(["user_corporate_assignments"]);
    expect(k.soBang).toBeGreaterThan(100); // schema thật ~440 bảng
    for (const b of BANG) expect(k.khongDem, b).not.toContain(b);
    // liệt kê CHỈ bảng thường: có bảng thật, KHÔNG có VIEW (device_pending_stops là VIEW)
    expect(dsBang).toContain("machines");
    expect(dsBang).toContain("user_corporate_assignments");
    expect(dsBang).not.toContain("device_pending_stops");
    // ROLLBACK không để lại hàng nào
    for (const b of BANG) expect(await demThang(b), `${b} sau ROLLBACK`).toBe(truocNgoai[b]);
  }, 120_000);

  it("★★★ số quét từng bảng khớp `count(*)` độc lập (cùng ảnh chụp REPEATABLE READ); phiên quét được đặt CHỈ-ĐỌC và trần thời gian 15 s (đọc lại bằng current_setting trong cùng giao dịch)", async () => {
    let chenhLech: string[] = [];
    let soBang = 0;
    let docChiDoc = "";
    let docTran = "";
    try {
      await sql.begin("isolation level repeatable read read write", async (tx) => {
        const may = mayQuetRongPostgres(tx as unknown as SqlDem);
        const ds = await may.lietKe(); // đặt phiên ở đây
        soBang = ds.length;
        docChiDoc = String((await tx`select current_setting('default_transaction_read_only') as v`)[0]!.v);
        docTran = String((await tx`select current_setting('statement_timeout') as v`)[0]!.v);
        for (const b of ["machines", "factories", "workstations"]) {
          const a = await may.dem(b);
          const doc = Number((await tx`select count(*)::text as n from ${tx(b)}`)[0]!.n);
          if (a !== doc) chenhLech.push(`${b}: quét ${a} ≠ đếm ${doc}`);
        }
        throw new HoanTac();
      });
    } catch (e) {
      if (!(e instanceof HoanTac)) throw e;
    }
    expect(chenhLech).toEqual([]);
    expect(soBang).toBeGreaterThan(100);
    expect(docChiDoc).toBe("on");
    expect(docTran).toBe("15s");
  }, 120_000);

  it("★★★ đếm kèm schema: bảng TẠM cùng tên `factories` đứng trước public trong search_path (giao dịch ROLLBACK, bảng tạm ON COMMIT DROP) ⇒ dem('factories') vẫn là số hàng của public.factories, KHÔNG phải của bảng tạm", async () => {
    let thucPublic = -1;
    let bangTam = -1;
    let quet = -1;
    try {
      await sql.begin("read write", async (tx) => {
        thucPublic = Number((await tx`select count(*)::text as n from public.factories`)[0]!.n);
        await tx`set local search_path to pg_temp, public`;
        await tx`create temp table factories (id int) on commit drop`;
        await tx`insert into factories select g from generate_series(1, ${String(thucPublic + 1)}::int) g`;
        bangTam = Number((await tx`select count(*)::text as n from factories`)[0]!.n); // điều kiện đầu: tên trần đã bị bảng tạm che
        quet = (await mayQuetRongPostgres(tx as unknown as SqlDem).dem("factories")) ?? -2;
        throw new HoanTac();
      });
    } catch (e) {
      if (!(e instanceof HoanTac)) throw e;
    }
    expect(bangTam).toBe(thucPublic + 1);
    expect(quet).toBe(thucPublic);
  }, 60_000);

  it("★★★ phiên quét CHỈ-ĐỌC THẬT: sau khi bộ quét đặt phiên, một giao dịch mới INSERT vào bảng thật ⇒ lỗi 25006 (read_only_sql_transaction), không để lại hàng; luôn ROLLBACK; phiên được trả về như cũ", async () => {
    const truoc = await demThang("factories");
    let ma: unknown = null;
    try {
      await mayQuetRongPostgres(sql as unknown as SqlDem).lietKe(); // đặt default_transaction_read_only = on cho PHIÊN này
      await sql.begin(async (tx) => {
        await tx`insert into factories (code, name) values (${`SQRO_${ts}`}, 'phien chi doc')`;
        throw new HoanTac(); // nếu INSERT không bị chặn thì vẫn ROLLBACK, và ca đỏ vì không có mã 25006
      });
    } catch (e) {
      ma = (e as { code?: unknown }).code ?? (e instanceof HoanTac ? "KHONG-BI-CHAN" : String(e));
    } finally {
      await sql`reset default_transaction_read_only`;
      await sql`reset statement_timeout`;
    }
    expect(ma).toBe("25006");
    expect(await demThang("factories")).toBe(truoc);
  }, 60_000);

  it("★★ bangRls trên PG thật: câu truy vấn chạy được; mỗi bảng trả về QUẢ CÓ relrowsecurity bật và nằm trong danh sách bảng thường (không có VIEW)", async () => {
    let ds: string[] = [];
    let rls: string[] = [];
    let bat: boolean[] = [];
    try {
      await sql.begin("read write", async (tx) => {
        const may = mayQuetRongPostgres(tx as unknown as SqlDem);
        ds = await may.lietKe();
        rls = await may.bangRls!();
        for (const b of rls) bat.push(Boolean((await tx`select relrowsecurity from pg_class where relnamespace = 'public'::regnamespace and relname = ${b}`)[0]?.relrowsecurity));
        throw new HoanTac();
      });
    } catch (e) {
      if (!(e instanceof HoanTac)) throw e;
    }
    expect(rls.every((b) => ds.includes(b))).toBe(true);
    expect(bat.every((x) => x === true)).toBe(true);
    expect(bat).toHaveLength(rls.length);
  }, 60_000);
});
