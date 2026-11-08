/**
 * socketPhamVi0435.db.test.ts — ★★★ F5 đầy đủ: di trú 0435 (`socket_pham_vi`) trên `_test`, CHỈ ĐỌC + giao dịch HOÀN TÁC (không một hàng nào được
 * commit; ca ROLLBACK_KHONG_GIAO_THONG_BAO commit đúng một `SELECT pg_notify(...)` đối chứng — không ghi bảng).
 *
 *   (a) catalog: 8 trigger trên 6 bảng, AFTER ROW, đúng sự kiện / cột `UPDATE OF` / có WHEN / gọi `public.socket_pham_vi_notify`, đang bật;
 *   (b) quyền hàm: `socket_pham_vi_payload` avi_app EXECUTE được (theo thiết kế), không PUBLIC; `socket_pham_vi_notify` không ai EXECUTE;
 *   (c) hành vi hàm tải trọng = bảng ca dùng chung `scripts/migration0435Cases.json` (cùng bảng mà apply-migration-0435.mjs kiểm);
 *   (d) ĐỘT BIẾN chạy được bằng vai ứng dụng: thân hàm đọc TỪ TỆP di trú, dựng bản sao trong `pg_temp` (trong giao dịch hoàn tác) — bản
 *       NGUYÊN VĂN qua hết bảng ca (tệp = hành vi đã áp), bản ĐỘT BIẾN "UPDATE không đổi gì vẫn trả tải trọng" / "phiên false→true cũng bắn" /
 *       "chỉ userId MỚI" bị bảng ca BẮT.
 * Chạy bằng vai ứng dụng (`getDb()`, KHÔNG owner `aoi`), mọi câu trong `db.transaction` ném ROLLBACK ở cuối. Không DELETE / TRUNCATE.
 * ⚠ Cần 0435 đã áp lên `_test` (`node scripts/apply-migration-0435.mjs --test-only`).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { sql } from "drizzle-orm";
import { getDb } from "../db/connection";

const GOC = process.cwd();
const SQL_0435 = readFileSync(resolve(GOC, "drizzle/0435_socket_pham_vi.sql"), "utf8");
const CA: Array<[string, string, string, unknown, unknown, Record<string, unknown> | null]> = JSON.parse(
  readFileSync(resolve(GOC, "scripts/migration0435Cases.json"), "utf8"),
).cases;

const HOAN_TAC = new Error("hoan-tac-0435");
async function trongGiaoDichHoanTac<T>(f: (tx: { execute: (q: unknown) => Promise<unknown> }) => Promise<T>): Promise<T> {
  const db = await getDb();
  if (!db) throw new Error("cần CSDL _test");
  let out: T | undefined;
  try {
    await db.transaction(async (tx) => {
      out = await f(tx as never);
      throw HOAN_TAC;
    });
  } catch (e) {
    if (e !== HOAN_TAC) throw e;
  }
  return out as T;
}
const hang = (r: unknown): any[] => (Array.isArray(r) ? r : ((r as { rows?: unknown[] })?.rows ?? []));

/** Chạy bảng ca trên hàm `ten` (đủ tiền tố lược đồ); trả các ca SAI. */
async function chayBangCa(tx: { execute: (q: unknown) => Promise<unknown> }, ten: string): Promise<string[]> {
  const sai: string[] = [];
  for (const [nhan, bang, op, cu, moi, mong] of CA) {
    const r = hang(
      await tx.execute(
        sql`SELECT ${sql.raw(ten)}(${bang}, ${op}, ${cu === null ? null : JSON.stringify(cu)}::text::jsonb, ${moi === null ? null : JSON.stringify(moi)}::text::jsonb) AS p`,
      ),
    );
    const p = r[0]?.p ?? null;
    if (mong === null) {
      if (p !== null) sai.push(`${nhan}: muốn NULL, được ${p}`);
      continue;
    }
    if (typeof p !== "string") {
      sai.push(`${nhan}: muốn ${JSON.stringify(mong)}, được NULL`);
      continue;
    }
    if (/tok-BI-MAT|hash-bi-mat|Ten Bi Mat|sessionToken/.test(p)) sai.push(`${nhan}: tải trọng mang giá trị hàng: ${p}`);
    const o = JSON.parse(p) as Record<string, unknown>;
    if (Object.keys(o).some((k) => !["u", "s", "all"].includes(k))) sai.push(`${nhan}: khoá lạ: ${p}`);
    if (JSON.stringify(o) !== JSON.stringify(mong)) sai.push(`${nhan}: muốn ${JSON.stringify(mong)}, được ${p}`);
  }
  return sai;
}

/** Thân `CREATE OR REPLACE FUNCTION public.socket_pham_vi_payload … $$;` lấy NGUYÊN VĂN từ tệp di trú. */
function hamTaiTrongTuTep(): string {
  const m = /CREATE OR REPLACE FUNCTION public\.socket_pham_vi_payload\([\s\S]*?\$\$;/.exec(SQL_0435);
  if (!m) throw new Error("không tìm thấy hàm tải trọng trong 0435");
  return m[0];
}
const banSao = (than: string, ten: string) => than.replace("CREATE OR REPLACE FUNCTION public.socket_pham_vi_payload(", `CREATE FUNCTION pg_temp.${ten}(`);

describe("★★★ 0435 socket_pham_vi — catalog, quyền, hành vi (hoàn tác)", () => {
  it("(a) 8 trigger / 6 bảng: AFTER ROW, sự kiện, UPDATE OF, WHEN, hàm, đang bật", async () => {
    const r = await trongGiaoDichHoanTac(async (tx) =>
      hang(
        await tx.execute(sql`
          SELECT t.tgname AS ten, c.relname AS bang, t.tgtype::int AS kieu, t.tgenabled AS bat, t.tgqual IS NOT NULL AS co_when, p.proname AS ham,
                 COALESCE((SELECT array_agg(a.attname::text ORDER BY a.attname::text) FROM pg_attribute a
                            WHERE a.attrelid = t.tgrelid AND a.attnum = ANY (t.tgattr::int2[])), ARRAY[]::text[]) AS cot
            FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_proc p ON p.oid = t.tgfoid
           WHERE NOT t.tgisinternal AND t.tgname LIKE 'trg_socket_pham_vi%' ORDER BY t.tgname`),
      ),
    );
    const ev = (k: number) => [["DELETE", 8], ["INSERT", 4], ["UPDATE", 16]].filter(([, b]) => (k & (b as number)) !== 0).map(([e]) => e).join("+");
    expect(r.map((x) => `${x.ten}|${x.bang}|${ev(x.kieu)}|${(x.kieu & 1) === 1 ? "ROW" : "STMT"}|${(x.kieu & 66) === 0 ? "AFTER" : "?"}|${x.cot.join(",")}|${x.co_when}|${x.ham}|${x.bat}`)).toEqual([
      "trg_socket_pham_vi_factories|factories|UPDATE|ROW|AFTER|code,corporateCode|true|socket_pham_vi_notify|O",
      "trg_socket_pham_vi_permissions|permissions|DELETE+INSERT+UPDATE|ROW|AFTER||false|socket_pham_vi_notify|O",
      "trg_socket_pham_vi_sessions_del|user_sessions|DELETE|ROW|AFTER||false|socket_pham_vi_notify|O",
      "trg_socket_pham_vi_sessions_upd|user_sessions|UPDATE|ROW|AFTER|isActive|true|socket_pham_vi_notify|O",
      "trg_socket_pham_vi_uca|user_corporate_assignments|DELETE+INSERT+UPDATE|ROW|AFTER||false|socket_pham_vi_notify|O",
      "trg_socket_pham_vi_ufa|user_factory_assignments|DELETE+INSERT+UPDATE|ROW|AFTER||false|socket_pham_vi_notify|O",
      "trg_socket_pham_vi_users_del|users|DELETE|ROW|AFTER||false|socket_pham_vi_notify|O",
      "trg_socket_pham_vi_users_upd|users|UPDATE|ROW|AFTER|isActive,passwordInvalidBefore,role|true|socket_pham_vi_notify|O",
    ]);
  });

  it("(b) quyền hàm: payload IMMUTABLE, avi_app EXECUTE, không PUBLIC; notify không ai EXECUTE; search_path ghim", async () => {
    const r = await trongGiaoDichHoanTac(async (tx) =>
      hang(
        await tx.execute(sql`
          SELECT p.proname AS ten, p.provolatile AS bien, p.prosecdef AS definer, p.proconfig AS cfg,
                 has_function_privilege(current_user, p.oid, 'EXECUTE') AS app, has_function_privilege('public', p.oid, 'EXECUTE') AS pub
            FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.proname IN ('socket_pham_vi_payload', 'socket_pham_vi_notify') ORDER BY p.proname`),
      ),
    );
    expect(r.map((x) => `${x.ten}:${x.bien}:${x.definer}:${x.app}:${x.pub}:${JSON.stringify(x.cfg)}`)).toEqual([
      'socket_pham_vi_notify:v:false:false:false:["search_path=pg_catalog, public, pg_temp"]',
      'socket_pham_vi_payload:i:false:true:false:["search_path=pg_catalog, public, pg_temp"]',
    ]);
  });

  it("(c) hàm tải trọng ĐÃ ÁP qua hết bảng ca (mọi bảng × thao tác, UPDATE không đổi ⇒ NULL, phiên chỉ true→false, userId cũ + mới, không giá trị hàng)", async () => {
    const sai = await trongGiaoDichHoanTac((tx) => chayBangCa(tx, "public.socket_pham_vi_payload"));
    expect(CA.length).toBeGreaterThanOrEqual(31);
    expect(sai).toEqual([]);
  });

  it("(d) bản sao NGUYÊN VĂN từ tệp (pg_temp) qua hết bảng ca; ba ĐỘT BIẾN bị bảng ca BẮT", async () => {
    const than = hamTaiTrongTuTep();
    const ketQua = await trongGiaoDichHoanTac(async (tx) => {
      const out: Record<string, string[]> = {};
      const thu = async (ten: string, dotBien: (s: string) => string) => {
        const goc = banSao(than, ten);
        const t = dotBien(goc);
        if (ten !== "f5_nguyen_van" && t === goc) throw new Error(`đột biến ${ten} không đổi gì (mẫu thay không khớp tệp)`);
        await tx.execute(sql.raw(t));
        out[ten] = await chayBangCa(tx, `pg_temp.${ten}`);
      };
      await thu("f5_nguyen_van", (s) => s);
      // UPDATE users không đổi cột quan trọng VẪN trả tải trọng
      await thu("f5_db_khong_doi", (s) => s.replace("RETURN jsonb_build_object('u', jsonb_build_array((p_new->>'id')::int))::text;\n    END IF;\n    RETURN NULL;", "RETURN jsonb_build_object('u', jsonb_build_array((p_new->>'id')::int))::text;\n    END IF;\n    RETURN jsonb_build_object('u', jsonb_build_array((COALESCE(p_new, p_old)->>'id')::int))::text;"));
      // phiên false→true cũng bắn
      await thu("f5_db_phien", (s) => s.replace("(p_old->>'isActive')::boolean IS TRUE AND (p_new->>'isActive')::boolean IS NOT TRUE", "(p_old->>'isActive') IS DISTINCT FROM (p_new->>'isActive')"));
      // chỉ userId MỚI (mất userId cũ khi đổi chủ hàng)
      await thu("f5_db_chi_moi", (s) => s.replace("ARRAY[(p_old->>'userId')::int, (p_new->>'userId')::int]", "ARRAY[COALESCE((p_new->>'userId')::int, (p_old->>'userId')::int)]"));
      return out;
    });
    expect(ketQua.f5_nguyen_van).toEqual([]);
    expect(ketQua.f5_db_khong_doi.length, "đột biến 'UPDATE không đổi vẫn bắn' SỐNG SÓT").toBeGreaterThan(0);
    expect(ketQua.f5_db_phien.length, "đột biến 'phiên false→true' SỐNG SÓT").toBeGreaterThan(0);
    expect(ketQua.f5_db_chi_moi.length, "đột biến 'chỉ userId mới' SỐNG SÓT").toBeGreaterThan(0);
  });
});

describe("★★★ ROLLBACK_KHONG_GIAO_THONG_BAO — bằng chứng của miễn trừ COMMIT ⇒ NOTIFY (nguoiDungTest.census MIEN_COMMIT_NOTIFY)", () => {
  /**
   * Tài liệu Postgres (NOTIFY): "if a NOTIFY is executed inside a transaction, the notify events are not delivered until and unless the
   * transaction is committed". Đo trên `_test` bằng một LISTEN THẬT (client NOTIFY riêng của connection.ts): một lượt ghi KÍCH trigger 0435
   * trong giao dịch HOÀN TÁC ⇒ KHÔNG thông báo nào tới; đối chứng DƯƠNG: một NOTIFY đã commit (không ghi hàng nào) ⇒ tới. Không hàng nào được
   * commit (INSERT nằm trong giao dịch hoàn tác; NOTIFY đối chứng không ghi bảng).
   */
  it("một lượt ghi bị HOÀN TÁC không giao thông báo nào tới LISTEN thật; NOTIFY đã commit thì tới", async () => {
    const { getNotifyClient } = await import("../db/connection");
    const nc = getNotifyClient() as unknown as {
      listen(ch: string, fn: (p: string) => void, onlisten?: () => void): Promise<{ unlisten: () => Promise<unknown> }>;
    } | null;
    expect(nc, "cần client NOTIFY của _test").not.toBeNull();
    const nhan: number[][] = [];
    const sub = await nc!.listen("socket_pham_vi", (p: string) => {
      try {
        const o = JSON.parse(p) as { u?: number[] };
        if (Array.isArray(o.u)) nhan.push(o.u);
      } catch {
        /* nhịp tim / tải trọng khác */
      }
    });
    try {
      const uid = 2_000_000_000 + Math.floor(Math.random() * 100_000_000);
      const daGhi = await trongGiaoDichHoanTac(async (tx) =>
        hang(
          await tx.execute(
            sql`INSERT INTO permissions ("userId", category, "moduleName", "canView") VALUES (${uid}, 'dashboard', ${`f5rb${uid}`}, true) RETURNING "userId" AS u`,
          ),
        ),
      );
      expect(daGhi.map((r) => Number(r.u)), "lượt ghi KÍCH trigger phải thật sự chạy (rồi bị hoàn tác)").toEqual([uid]);
      const db = await getDb();
      await db!.execute(sql`SELECT pg_notify('socket_pham_vi', ${JSON.stringify({ u: [uid + 1] })})`); // đối chứng: NOTIFY đã commit
      const bd = Date.now();
      while (!nhan.some((u) => u.includes(uid + 1)) && Date.now() - bd < 5_000) await new Promise((r) => setTimeout(r, 50));
      expect(nhan.some((u) => u.includes(uid + 1)), "đối chứng dương: NOTIFY đã commit phải tới").toBe(true);
      await new Promise((r) => setTimeout(r, 300));
      expect(nhan.some((u) => u.includes(uid)), "lượt ghi HOÀN TÁC KHÔNG được giao thông báo").toBe(false);
    } finally {
      await sub.unlisten().catch(() => undefined);
    }
  });
});
