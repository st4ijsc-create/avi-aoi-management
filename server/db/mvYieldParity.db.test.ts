/**
 * Task 8 (doc `2026-08-24-aoi-pha0-va-no-co-san`) — `hourly_yield_cache` MV
 * PARITY, REAL-DB integration test. Quy ước NTF = PASS trong final yield
 * (migration 0174 §"CANONICAL final-yield math"; 0235 giữ nguyên công thức
 * cho continuous aggregate). Trước file này, KHÔNG phép đo nào chạy qua thân
 * SQL thật của MV — `server/cachedStatistics.mv.test.ts` mock `execute()`
 * hoàn toàn.
 *
 * RÀNG BUỘC CỨNG: `product_inspections` là bảng WORM — vai `avi_app` (vai mà
 * test chạy, xem vitest.setup.ts) KHÔNG có quyền DELETE. File này CHỈ SELECT:
 * không INSERT/UPDATE/DELETE, và ĐẶC BIỆT không REFRESH MATERIALIZED VIEW
 * (dù kỹ thuật REFRESH không đụng WORM table, yêu cầu gốc cấm rõ ràng).
 *
 * Cửa sổ so sánh: lấy MIN(bucket_hour)/MAX(bucket_hour)+1h từ chính MV làm
 * biên (thay vì một khoảng NGÀY tuỳ ý) — bucket_hour = date_trunc('hour',
 * to_factory_time(inspectionTime)) nên phía bảng thô PHẢI đi qua đúng hàm
 * SQL `public.to_factory_time()` (0174) để khớp múi giờ nhà máy, không phải
 * so trực tiếp `inspectionTime` (UTC) với `bucket_hour` (giờ nhà máy).
 *
 * ⚠ PHÁT HIỆN KHI DỰNG LƯỚI NÀY (đo trên DB test `aoi_management_test`,
 * 2026-08-24): MV này KHÔNG có cơ chế tự làm tươi trong vòng đời vitest —
 * `materializedViewRefreshService` (chu kỳ 5 phút) chỉ chạy khi app Express
 * thật khởi động, và test này bị cấm tự REFRESH. `db_feature_status` (feature
 * `matview_refresh_qw`) ghi lần refresh thật gần nhất lúc `2026-08-22T14:22:20Z`
 * — khoảng 2 ngày trước lúc đo. Vì `product_inspections` là WORM (chỉ INSERT,
 * không DELETE qua `avi_app`) và các suite `*.db.test.ts` khác liên tục ghi
 * thêm hàng qua nhiều lượt chạy kể từ đó, bảng thô đã phình to hơn ảnh chụp MV
 * — MV lúc đo có 7.930 dòng (machine_id × bucket_hour) nhưng chỉ 7.862
 * (99,14%) khớp đúng cả 4 cột (total/ok/ng/ntf) với truy vấn trực tiếp trên
 * bảng thô HIỆN TẠI cùng khoá; 68 dòng còn lại trỏ tới (machine_id,
 * bucket_hour) mà bảng thô hiện KHÔNG còn hàng nào (raw_total=0 — các
 * bucket_hour đó rơi vào những mốc dữ liệu giả lập ngày cổ/tương lai như
 * 2003, 2016, 2019 thấy trong MIN/MAX(bucket_hour) của MV — bị dọn bởi một
 * tiến trình có quyền cao hơn `avi_app` [vd. TimescaleDB retention theo
 * `dataRetentionService`], KHÔNG phải do test này, vì `avi_app` không có
 * DELETE). Trên đúng 7.862 dòng còn đồng bộ, `yield_rate` khớp công thức
 * (ok+ntf)/total*100 làm tròn 2 chữ số ở CẢ 7.862/7.862 (0 lỗi công thức) —
 * tức công thức SQL của MV (NTF ở vế PASS) đúng 100% ở nơi dữ liệu còn tươi;
 * sai lệch tổng mà ca 2/3/4 dưới đây báo ĐỎ phản ánh MV CŨ (staleness), không
 * phải lỗi công thức. Các ca dưới đây CỐ Ý giữ đòi hỏi khớp tuyệt đối/dung
 * sai chặt (đúng như yêu cầu gốc) để ĐỎ trung thực khi MV lệch dữ liệu thô —
 * xem `.superpowers/sdd/2026-08-24-aoi-pha0-va-no-co-san/task-8-report.md`
 * để có số liệu đầy đủ, bằng chứng, và khuyến nghị (refresh MV — ngoài phạm
 * vi test này — trước khi coi ca 2-4 là "đã kiểm chứng xanh" cho một lượt
 * merge/release).
 */
import { describe, it, expect } from "vitest";
import { getDb } from "./connection";
import { sql } from "drizzle-orm";

function asRows<T = Record<string, unknown>>(res: unknown): T[] {
  if (Array.isArray(res)) return res as T[];
  const rows = (res as { rows?: unknown })?.rows;
  return Array.isArray(rows) ? (rows as T[]) : [];
}

async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("không có DB test — chạy: node scripts/setup-test-db.mjs");
  return db;
}

/** MIN/MAX(bucket_hour) từ chính MV — biên cửa sổ dùng chung cho ca 2-4. */
async function getMvWindow(db: Awaited<ReturnType<typeof getDb>>) {
  const [w] = asRows<{ min_bucket: Date; max_bucket: Date }>(
    await db!.execute(sql`SELECT MIN(bucket_hour) AS min_bucket, MAX(bucket_hour) AS max_bucket FROM hourly_yield_cache`),
  );
  return w;
}

describe("song hành MV hourly_yield_cache ↔ product_inspections (chỉ đọc, KHÔNG ghi DB)", () => {
  it("mệnh đề KHÔNG tự thoả — MV và bảng thô phải có dữ liệu để các ca dưới có nghĩa", async () => {
    const db = await requireDb();
    const [mvRow] = asRows<{ n: number }>(await db.execute(sql`SELECT count(*)::int AS n FROM hourly_yield_cache`));
    const [rawRow] = asRows<{ n: number }>(await db.execute(sql`SELECT count(*)::int AS n FROM product_inspections`));
    expect(mvRow.n, "hourly_yield_cache RỖNG ⇒ mọi ca so sánh bên dưới tự thoả, phép đo vô nghĩa").toBeGreaterThan(0);
    expect(rawRow.n, "product_inspections RỖNG ⇒ mọi ca so sánh bên dưới tự thoả, phép đo vô nghĩa").toBeGreaterThan(0);
  });

  it("SUM 4 cột đếm (total/ok/ng/ntf) khớp giữa MV và bảng thô trên cùng cửa sổ giờ mà MV bao phủ", async () => {
    const db = await requireDb();
    const [mv] = asRows<{ total: number; ok: number; ng: number; ntf: number; min_bucket: Date; max_bucket: Date }>(
      await db.execute(sql`
        SELECT
          SUM(total)::float AS total, SUM(ok)::float AS ok, SUM(ng)::float AS ng, SUM(ntf)::float AS ntf,
          MIN(bucket_hour) AS min_bucket, MAX(bucket_hour) AS max_bucket
        FROM hourly_yield_cache
      `),
    );
    const [raw] = asRows<{ total: number; ok: number; ng: number; ntf: number }>(
      await db.execute(sql`
        SELECT
          COUNT(*)::float AS total,
          COUNT(*) FILTER (WHERE pi."overallResult" = 'OK')::float AS ok,
          COUNT(*) FILTER (WHERE pi."overallResult" = 'NG')::float AS ng,
          COUNT(*) FILTER (WHERE pi."overallResult" = 'NTF')::float AS ntf
        FROM product_inspections pi
        WHERE public.to_factory_time(pi."inspectionTime") >= ${mv.min_bucket}
          AND public.to_factory_time(pi."inspectionTime") < (${mv.max_bucket}::timestamp + interval '1 hour')
      `),
    );
    const msg = `MV{total=${mv.total},ok=${mv.ok},ng=${mv.ng},ntf=${mv.ntf}} vs RAW{total=${raw.total},ok=${raw.ok},ng=${raw.ng},ntf=${raw.ntf}}`;
    expect(Number(raw.total), `total lệch — ${msg}`).toBe(Number(mv.total));
    expect(Number(raw.ok), `ok lệch — ${msg}`).toBe(Number(mv.ok));
    expect(Number(raw.ng), `ng lệch — ${msg}`).toBe(Number(mv.ng));
    expect(Number(raw.ntf), `ntf lệch — ${msg}`).toBe(Number(mv.ntf));
  });

  it("YIELD tổng: yield_rate của MV cuộn lên (trọng số theo total) khớp (ok+ntf)/total*100 từ bảng thô — NTF nằm ở vế PASS", async () => {
    const db = await requireDb();
    const [mv] = asRows<{ rolled_yield: number; min_bucket: Date; max_bucket: Date }>(
      await db.execute(sql`
        SELECT
          SUM(yield_rate::float * total::float) / NULLIF(SUM(total::float), 0) AS rolled_yield,
          MIN(bucket_hour) AS min_bucket, MAX(bucket_hour) AS max_bucket
        FROM hourly_yield_cache
      `),
    );
    const [raw] = asRows<{ yield: number }>(
      await db.execute(sql`
        SELECT
          (SUM(CASE WHEN pi."overallResult" IN ('OK', 'NTF') THEN 1 ELSE 0 END)::float
           / NULLIF(COUNT(*), 0)::float) * 100 AS yield
        FROM product_inspections pi
        WHERE public.to_factory_time(pi."inspectionTime") >= ${mv.min_bucket}
          AND public.to_factory_time(pi."inspectionTime") < (${mv.max_bucket}::timestamp + interval '1 hour')
      `),
    );
    const diff = Math.abs(Number(mv.rolled_yield) - Number(raw.yield));
    expect(
      diff,
      `MV rolled_yield=${mv.rolled_yield} vs raw (ok+ntf)/total*100=${raw.yield} — lệch ${diff.toFixed(4)}pp (trần 0.01pp)`,
    ).toBeLessThanOrEqual(0.01);
  });

  it("TỪNG machine_id: tổng `total` của MV khớp count từ bảng thô trong cùng cửa sổ", async () => {
    const db = await requireDb();
    const win = await getMvWindow(db);
    const rows = asRows<{ machine_id: number; mv_total: number; raw_total: number }>(
      await db.execute(sql`
        SELECT mv.machine_id, mv.mv_total, COALESCE(raw.raw_total, 0) AS raw_total
        FROM (SELECT machine_id, SUM(total)::float AS mv_total FROM hourly_yield_cache GROUP BY machine_id) mv
        LEFT JOIN (
          SELECT pi."machineId" AS machine_id, COUNT(*)::float AS raw_total
          FROM product_inspections pi
          WHERE public.to_factory_time(pi."inspectionTime") >= ${win.min_bucket}
            AND public.to_factory_time(pi."inspectionTime") < (${win.max_bucket}::timestamp + interval '1 hour')
          GROUP BY pi."machineId"
        ) raw ON raw.machine_id = mv.machine_id
      `),
    );
    const mismatches = rows.filter((r) => Number(r.mv_total) !== Number(r.raw_total));
    const detail = mismatches
      .slice(0, 20)
      .map((r) => `machine_id=${r.machine_id}: MV=${r.mv_total} raw=${r.raw_total}`)
      .join("; ");
    expect(
      mismatches.length,
      `${mismatches.length}/${rows.length} máy lệch tổng total — ${detail}${mismatches.length > 20 ? " …" : ""}`,
    ).toBe(0);
  });
});
