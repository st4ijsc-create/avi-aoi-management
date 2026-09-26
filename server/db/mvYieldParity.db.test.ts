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
 * ── VÒNG SỬA 1/5 (đổi cấu trúc, không đổi số) ───────────────────────────────
 * Bản đầu tiên của file này so MV với bảng thô trên một cửa sổ NGÀY rộng
 * (MIN/MAX bucket_hour toàn cục) — và đỏ đều ở ca "SUM 4 cột"/"yield tổng"/
 * "từng máy", dù đo riêng cho thấy công thức SQL của MV ĐÚNG 100% (7.862/7.862
 * dòng khớp cả 4 cột lẫn yield_rate). Lý do đỏ: MV STALE trong môi trường
 * test (refresh cron `materializedViewRefreshService` chỉ chạy khi
 * `MATVIEW_REFRESH_ENABLED=true`, mặc định TẮT, và không khởi động trong
 * vitest), không phải công thức sai. Một cổng đỏ vĩnh viễn vì điều kiện vận
 * hành không liên quan thì không đo cái nó tuyên bố đo — bị tách lại thành
 * 4 ca theo đúng TRỤC đo, không theo "càng nhiều SELECT càng tốt":
 *
 *   CA A — CÔNG THỨC (chặn cứng, đây là cổng thật): trên các dòng MV mà
 *     4 cột đếm (total/ok/ng/ntf) KHỚP TUYỆT ĐỐI bảng thô ở cùng
 *     (machine_id, bucket_hour) — tức phần MV còn TƯƠI, không phụ thuộc
 *     staleness — `yield_rate` phải khớp `(ok+ntf)/total*100` (sai số
 *     ≤0.01pp, vì MV làm tròn 2 chữ số). Đây CHÍNH XÁC là câu hỏi "NTF có
 *     nằm ở vế PASS trong thân SQL của MV không", độc lập với độ tươi.
 *   CA B — chống tự thoả cho ca A: tập dòng-khớp phải đủ lớn (>1000) VÀ có
 *     NTF thật (SUM(ntf)>0) trong tập đó — nếu không có NTF nào,
 *     (ok+ntf)/total trùng ok/total và ca A không phân biệt được đúng với
 *     sai (một mệnh đề tự thoả kiểu khác: "khớp" nhưng không kiểm được gì).
 *   CA C — ĐỘ TƯƠI (ghi nhận qua console.warn, ngưỡng CHẶN rất rộng —
 *     matched/total > 0.5 — chỉ đỏ khi MV hỏng thật sự, không đỏ vì chưa
 *     refresh). KHÔNG canh công thức.
 *   CA D — CHẨN ĐOÁN (console.warn, KHÔNG chặn): dòng MV trỏ tới
 *     (machine_id, bucket_hour) mà bảng thô hiện có 0 hàng — bất thường
 *     đáng điều tra riêng (WORM: avi_app không có DELETE, nghi retention
 *     chạy bằng vai quyền cao hơn), KHÔNG phải hậu quả của test này.
 *
 * Số đo 2026-08-24 (DB test `aoi_management_test`): MV 7.930 dòng, tập
 * dòng-khớp (nền ca A/B) 7.862 dòng (99,14%), 68 dòng "biến mất" (ca D,
 * raw_total=0 cho khoá đó). Đột biến bắt buộc (bỏ NTF khỏi vế pass trong ca
 * A) → ca A ĐỎ; hoàn tác → xanh lại. Chi tiết đầy đủ + output hai lượt:
 * `.superpowers/sdd/2026-08-24-aoi-pha0-va-no-co-san/task-8-report.md`.
 */
import { describe, it, expect } from "vitest";
import { getDb } from "./connection";
import { sql } from "drizzle-orm";

type BucketRow = {
  machine_id: number;
  bucket_hour: string;
  mv_total: number;
  mv_ok: number;
  mv_ng: number;
  mv_ntf: number;
  mv_yield: number;
  raw_total: number;
  raw_ok: number;
  raw_ng: number;
  raw_ntf: number;
};

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

/**
 * MỘT truy vấn nền cho cả 4 ca: mỗi dòng MV (machine_id, bucket_hour) LEFT
 * JOIN với đúng khoá đó tính lại từ bảng thô (đi qua `public.to_factory_time`
 * để khớp múi giờ nhà máy — 0174). `raw_*` = 0 khi bảng thô hiện KHÔNG còn
 * hàng nào cho khoá đó (MV thấy trước đây, nay đã mất — ca D) hoặc khi bảng
 * thô có hàng nhưng số đếm khác MV (staleness một phần — không quan sát thấy
 * trong dữ liệu hiện tại, xem báo cáo task-8, nhưng công thức dưới vẫn đúng
 * nếu có).
 */
async function fetchBucketComparison(db: Awaited<ReturnType<typeof getDb>>): Promise<BucketRow[]> {
  return asRows<BucketRow>(
    await db!.execute(sql`
      SELECT
        mv.machine_id, mv.bucket_hour::text AS bucket_hour,
        mv.total::float AS mv_total, mv.ok::float AS mv_ok, mv.ng::float AS mv_ng, mv.ntf::float AS mv_ntf,
        mv.yield_rate::float AS mv_yield,
        COALESCE(rb.raw_total, 0) AS raw_total, COALESCE(rb.raw_ok, 0) AS raw_ok,
        COALESCE(rb.raw_ng, 0) AS raw_ng, COALESCE(rb.raw_ntf, 0) AS raw_ntf
      FROM hourly_yield_cache mv
      LEFT JOIN (
        SELECT
          pi."machineId" AS machine_id,
          date_trunc('hour', public.to_factory_time(pi."inspectionTime")) AS bucket_hour,
          COUNT(*)::float AS raw_total,
          COUNT(*) FILTER (WHERE pi."overallResult" = 'OK')::float AS raw_ok,
          COUNT(*) FILTER (WHERE pi."overallResult" = 'NG')::float AS raw_ng,
          COUNT(*) FILTER (WHERE pi."overallResult" = 'NTF')::float AS raw_ntf
        FROM product_inspections pi
        GROUP BY 1, 2
      ) rb ON rb.machine_id = mv.machine_id AND rb.bucket_hour = mv.bucket_hour
    `),
  );
}

/** Dòng MV mà 4 cột đếm khớp TUYỆT ĐỐI bảng thô hiện tại ở cùng khoá — phần "còn tươi". */
function matchedRows(rows: BucketRow[]): BucketRow[] {
  return rows.filter(
    (r) => r.mv_total === r.raw_total && r.mv_ok === r.raw_ok && r.mv_ng === r.raw_ng && r.mv_ntf === r.raw_ntf,
  );
}

describe("song hành MV hourly_yield_cache ↔ product_inspections (chỉ đọc, KHÔNG ghi DB)", () => {
  it("CA A — CÔNG THỨC: trên dòng-khớp (4 cột đếm khớp bảng thô), yield_rate = (ok+ntf)/total*100 — NTF ở vế PASS", async () => {
    const db = await requireDb();
    const rows = await fetchBucketComparison(db);
    const matched = matchedRows(rows).filter((r) => r.mv_total > 0);
    const bad = matched
      .map((r) => ({ r, expected: ((r.mv_ok + r.mv_ntf) / r.mv_total) * 100 }))
      .filter(({ r, expected }) => Math.abs(r.mv_yield - expected) > 0.01);
    const detail = bad
      .slice(0, 10)
      .map(
        ({ r, expected }) =>
          `machine_id=${r.machine_id} bucket=${r.bucket_hour}: mv_yield=${r.mv_yield} expected=${expected.toFixed(2)}`,
      )
      .join("; ");
    expect(
      bad.length,
      `${bad.length}/${matched.length} dòng-khớp lệch công thức yield_rate — ${detail}${bad.length > 10 ? " …" : ""}`,
    ).toBe(0);
  });

  it("CA B — chống tự thoả cho ca A: tập dòng-khớp đủ lớn (>1000) VÀ có NTF thật (SUM(ntf)>0)", async () => {
    const db = await requireDb();
    const rows = await fetchBucketComparison(db);
    const matched = matchedRows(rows);
    const ntfSum = matched.reduce((s, r) => s + r.mv_ntf, 0);
    expect(
      matched.length,
      `chỉ ${matched.length} dòng khớp (cần >1000) — MV có thể toàn bộ đã stale, ca A không đủ dữ liệu để có nghĩa`,
    ).toBeGreaterThan(1000);
    expect(
      ntfSum,
      `tập dòng-khớp (${matched.length} dòng) có SUM(ntf)=0 — (ok+ntf)/total trùng ok/total nên ca A KHÔNG PHÂN BIỆT được công thức đúng với công thức bỏ NTF (không có NTF nào trong dữ liệu để kiểm), lưới không chứng minh được gì`,
    ).toBeGreaterThan(0);
  });

  it("CA C — ĐỘ TƯƠI (ghi nhận qua console.warn, ngưỡng chặn RẤT RỘNG — không canh công thức)", async () => {
    const db = await requireDb();
    const rows = await fetchBucketComparison(db);
    const matched = matchedRows(rows);
    const matchRatio = rows.length > 0 ? matched.length / rows.length : 0;
    const sumMvTotal = rows.reduce((s, r) => s + r.mv_total, 0);
    const sumRawTotal = rows.reduce((s, r) => s + r.raw_total, 0);
    const sumDiffTotal = Math.abs(sumMvTotal - sumRawTotal);
    const rolledMvYield = sumMvTotal > 0 ? rows.reduce((s, r) => s + r.mv_yield * r.mv_total, 0) / sumMvTotal : 0;
    // Yield thô tính lại TRÊN ĐÚNG tập khoá mà MV có (không mở rộng ra bucket
    // MV chưa từng thấy) — đo mức trôi của những gì MV THỰC SỰ cố phản ánh.
    const rawOkNtfSum = rows.reduce((s, r) => s + r.raw_ok + r.raw_ntf, 0);
    const rawYieldOverMvKeys = sumRawTotal > 0 ? (rawOkNtfSum / sumRawTotal) * 100 : 0;
    const yieldDiffPp = Math.abs(rolledMvYield - rawYieldOverMvKeys);

    console.warn(
      `[MV freshness] mv_rows=${rows.length} matched=${matched.length} match_ratio=${(matchRatio * 100).toFixed(2)}% ` +
        `sum_diff_total=${sumDiffTotal} (mv=${sumMvTotal} raw=${sumRawTotal}) ` +
        `rolled_yield_mv=${rolledMvYield.toFixed(4)} raw_yield_over_mv_keys=${rawYieldOverMvKeys.toFixed(4)} yield_diff_pp=${yieldDiffPp.toFixed(4)}`,
    );

    expect(
      matchRatio,
      `tỉ lệ khớp ${(matchRatio * 100).toFixed(2)}% ≤ 50% — nghi MV hỏng thật sự (không chỉ chưa refresh); xem console.warn phía trên để có số liệu đầy đủ`,
    ).toBeGreaterThan(0.5);
  });

  it("CA D — CHẨN ĐOÁN (console.warn, KHÔNG chặn): dòng MV trỏ tới dữ liệu đã biến mất khỏi bảng thô", async () => {
    const db = await requireDb();
    const rows = await fetchBucketComparison(db);
    const vanished = rows.filter((r) => r.raw_total === 0);
    const sample = vanished
      .slice(0, 10)
      .map((r) => `machine_id=${r.machine_id} bucket=${r.bucket_hour} mv_total=${r.mv_total}`)
      .join("; ");

    console.warn(
      `[MV vanished] ${vanished.length}/${rows.length} dòng MV trỏ tới (machine_id,bucket_hour) mà bảng thô HIỆN CÓ 0 hàng — ` +
        `BẤT THƯỜNG (product_inspections là WORM, avi_app không có quyền DELETE, nên đây KHÔNG PHẢI do test này gây ra; nghi tiến ` +
        `trình dọn dẹp/retention chạy bằng vai quyền cao hơn avi_app). Cần điều tra riêng, ngoài phạm vi task này. Mẫu: ${sample}`,
    );

    // KHÔNG CHẶN theo yêu cầu — chỉ khẳng định phép đếm không âm/không lỗi truy vấn.
    expect(vanished.length, "đếm chẩn đoán ra số âm — lỗi truy vấn, không phải phát hiện thật").toBeGreaterThanOrEqual(0);
  });
});
