/**
 * 0326 — CỔNG canh THỐNG KÊ PLANNER của `measurement_results` × `product_inspections`.
 *
 * ── VÌ SAO CA KIỂM NÀY KHÔNG ĐO GIÂY ──────────────────────────────────────────────────────
 * Yêu cầu ban đầu là "xoá index ⇒ ca đo hiệu năng phải ĐỎ". Đã thử đặt ngưỡng theo đồng hồ và
 * ĐO ĐƯỢC RẰNG NÓ KHÔNG DÙNG ĐƯỢC trên CSDL test — nói ra thay vì ship một cái thước xanh sẵn:
 *
 *   phân bố THẬT (aoi_management)      : 157 369 hàng đo / 22 996 bản ghi kiểm = 6,84 hàng/kiểm,
 *                                        82,5% hàng đo là MỒ CÔI
 *   phân bố DỰNG SẴN (aoi_management_test): 29 309 / 31 715 = 0,92 hàng/kiểm, 2,7% mồ côi
 *
 * Bảng test nhỏ hơn 5 lần, mật độ hàng-đo-trên-mỗi-kiểm thấp hơn 7,4 lần, và tỷ lệ mồ côi thấp
 * hơn 30 lần. Chính cái đuôi dài hàng-không-khớp mới đẻ ra kế hoạch 184 giây, mà cái đuôi ấy
 * gần như KHÔNG TỒN TẠI trong dữ liệu dựng sẵn. Ở 29 k hàng cả bảng nằm gọn trong
 * shared_buffers: đo thật trên `aoi_management`, BỎ HẲN `idx_results_inspection` làm truy vấn
 * xuất NHANH LÊN (25,3 ms → 21,7 ms), tức một ngưỡng đồng hồ ở quy mô này sẽ chứng nhận VÔ CAN
 * cho đúng cái đột biến mà nó được dựng ra để bắt.
 *
 * Ngưỡng đồng hồ chỉ phân biệt được ở QUY MÔ THẬT. Đã dựng CSDL riêng `aoi_idxbench`
 * (5 000 000 hàng đo / 500 000 bản ghi kiểm / 755 MB, giữ nguyên tỷ lệ khớp 17,6%) và đo:
 *     tra theo lô inspection      : 1,134 ms  →  629,803 ms khi bỏ index  (chậm 555 lần)
 *     keyset trong một inspection : 0,126 ms  →   68,527 ms khi bỏ index  (chậm 544 lần)
 * Đó là bằng chứng cho việc GIỮ index. Nhưng nó không tái lập được trong bộ test, nên ở đây
 * canh bằng vị từ CẤU TRÚC — thứ đỏ được ở MỌI quy mô, kể cả bảng rỗng.
 *
 * ── CANH CÁI GÌ ───────────────────────────────────────────────────────────────────────────
 *   1. Index dẫn đầu bằng `inspectionId` còn tồn tại        (đột biến: DROP INDEX ⇒ đỏ)
 *   2. Thống kê planner đã nạp cho mọi bảng/chunk **CÓ DỮ LIỆU**
 *                                                          (đột biến: chunk có dữ liệu, chưa ANALYZE ⇒ đỏ)
 *   3. Ngưỡng autoanalyze 0.02 còn nguyên trên hai hypertable **và trên MỌI chunk**
 *                                                          (đột biến: RESET reloptions ⇒ đỏ)
 *
 * Mục 2 là mục QUAN TRỌNG NHẤT: `reltuples = -1` ("planner chưa biết gì") chính là trạng thái
 * đã sinh ra `Rows Removed by Join Filter: 2 997 964 925` và 184 122 ms trên đường xuất
 * `measurements.csv`. Chẩn đoán ban đầu đổ cho index thiếu; index chưa bao giờ thiếu.
 *
 * ── ★★ ĐÍNH CHÍNH 2026-08-18: VỊ TỪ ĐẦU CỦA MỤC 2 ĐÃ SAI ─────────────────────────────────
 * Bản đầu canh *"KHÔNG chunk nào có `reltuples < 0`"*. Vị từ ấy **không bao giờ xanh nổi trên
 * một repo mà bộ test có chèn dữ liệu kiểm**: Timescale sinh chunk MỚI theo thời gian, và một
 * chunk vừa sinh ra LUÔN mang `reltuples = -1` cho tới lượt autovacuum kế tiếp. Đã đo qua hai
 * lượt chạy suite đầy đủ: lượt 1 tố 9 chunk (`_hyper_11_186…`), lượt 2 tố 3 chunk KHÁC
 * (`_hyper_11_197…`) — tên đổi mỗi lượt, tức nó tố cáo chính hoạt động bình thường.
 *
 * Đo tiếp cả ba chunk bị tố thì **`relpages = 0`, 8 KB — chunk RỖNG**, và cả ba **đã mang sẵn**
 * `autovacuum_analyze_scale_factor=0.02`. Một chunk rỗng không thể đẻ ra sai số 3 tỉ hàng: cổng
 * đang đo một thứ KHÔNG LIÊN QUAN tới lớp lỗi mà chính nó đặt tên.
 *
 * ⚠ Cái giá của vị từ cũ không phải là "hơi ồn". Cách duy nhất làm nó xanh là chạy tay
 * `apply-migration-0326.mjs`, và lượt INSERT kế tiếp lại làm nó đỏ ⇒ nó **dạy người ta chạy một
 * lệnh để dập cổng** thay vì sửa hệ thống. Một cổng như thế còn tệ hơn không có cổng: nó tiêu
 * hết uy tín của mọi cổng bên cạnh. Nay mục 2 chỉ tố bảng/chunk **có dữ liệu thật** (> 1 trang),
 * và bất biến chống tái phát được chuyển sang mục 3 — reloption lan xuống TỪNG chunk, thứ mà
 * không lượt INSERT nào phá được (đo: 42/42 chunk trên cả hai CSDL đều mang).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";

const DB_URL = process.env.DATABASE_URL;
const HYPERTABLES = ["measurement_results", "product_inspections"] as const;

let sql: ReturnType<typeof postgres>;

describe.skipIf(!DB_URL)("0326 — thống kê planner cho measurement_results × product_inspections", () => {
  beforeAll(async () => {
    sql = postgres(DB_URL!, { max: 1, connect_timeout: 30, onnotice: () => {} });
  });

  afterAll(async () => {
    await sql?.end();
  });

  it("GIỮ index dẫn đầu bằng inspectionId (bỏ đi ⇒ chậm 555 lần ở 5 triệu hàng)", async () => {
    const rows = await sql<{ indexname: string; indexdef: string }[]>`
      SELECT indexname, indexdef FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'measurement_results'`;

    // "dẫn đầu bằng inspectionId" = cột ĐẦU TIÊN trong danh sách cột của index. Một index
    // (result, "inspectionId") KHÔNG phục vụ được tra-theo-inspection, nên không được tính.
    const leading = rows.filter((r) => {
      const cols = /\(([^)]*)\)/.exec(r.indexdef)?.[1] ?? "";
      return cols.split(",")[0]?.trim().replace(/"/g, "") === "inspectionId";
    });

    expect(
      leading.map((r) => r.indexname).sort(),
      `measurement_results phải có ít nhất một index dẫn đầu bằng "inspectionId". ` +
        `Đang có: ${rows.map((r) => r.indexname).join(", ") || "(không có index nào)"}`,
    ).toContain("idx_results_inspection");
  });

  it.each(HYPERTABLES)(
    "%s — thống kê planner đã nạp cho mọi bảng/chunk CÓ DỮ LIỆU",
    async (table) => {
      // ⚠ ĐIỀU KIỆN `pg_relation_size > 8192` KHÔNG PHẢI NỚI TAY — xem §"vì sao" ở docblock.
      // Một chunk vừa sinh ra LUÔN mang `reltuples = -1` cho tới lượt autovacuum kế tiếp; đó là
      // trạng thái BÌNH THƯỜNG và TỰ LÀNH, không phải lớp lỗi 184 giây. Chỉ chunk đã CÓ dữ liệu
      // (> 1 trang) mà vẫn không có thống kê mới là bệnh.
      const stale = await sql<{ relname: string; reltuples: string; sz: string }[]>`
        SELECT c.relname, c.reltuples::text AS reltuples,
               pg_size_pretty(pg_relation_size(c.oid)) AS sz
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind = 'r'
          AND c.reltuples < 0
          AND pg_relation_size(c.oid) > 8192
          AND (
            (n.nspname = 'public' AND c.relname = ${table})
            OR EXISTS (
              SELECT 1 FROM timescaledb_information.chunks ch
              WHERE ch.chunk_schema = n.nspname
                AND ch.chunk_name = c.relname
                AND ch.hypertable_name = ${table}
            )
          )`;

      expect(
        stale.map((r) => `${r.relname} (${r.sz})`),
        `reltuples = -1 trên một bảng/chunk ĐÃ CÓ DỮ LIỆU nghĩa là planner đang đoán mò. Đó chính ` +
          `xác là trạng thái đã sinh ra Nested Loop + Materialize với 2 997 964 925 hàng bị loại ` +
          `và 184 122 ms trên đường xuất measurements.csv. Chạy: ` +
          `node scripts/apply-migration-0326.mjs`,
      ).toEqual([]);
    },
  );

  /**
   * ★★ BẤT BIẾN THẬT chống tái phát — và là ca đã THAY THẾ vị từ sai ở trên.
   *
   * Vá một lần bằng ANALYZE chỉ đúng cho các chunk ĐANG CÓ. Thứ giữ cho chunk MAI SAU không rơi
   * lại vào "planner chưa biết gì" là reloption `autovacuum_analyze_scale_factor=0.02` **có lan
   * xuống từng chunk** — đã đo: 42/42 chunk trên cả hai CSDL đều mang nó. Ca này canh đúng điều
   * đó, và khác vị từ cũ ở chỗ nó **ổn định**: không lượt INSERT nào phá được.
   */
  it.each(HYPERTABLES)("%s — MỌI chunk kế thừa ngưỡng autoanalyze 0.02 (bảo đảm cho chunk mai sau)", async (table) => {
    const thieu = await sql<{ relname: string }[]>`
      SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN timescaledb_information.chunks ch
        ON ch.chunk_schema = n.nspname AND ch.chunk_name = c.relname
      WHERE ch.hypertable_name = ${table}
        AND coalesce(array_to_string(c.reloptions, ','), '') NOT LIKE '%autovacuum_analyze_scale_factor=0.02%'
      ORDER BY 1`;

    expect(
      thieu.map((r) => r.relname),
      `Chunk KHÔNG kế thừa ngưỡng 0.02 sẽ dùng mặc định 0.10 — với bảng nóng, thống kê mốc lặng ` +
        `lẽ rồi planner quay lại đoán mò. Chạy: node scripts/apply-migration-0326.mjs`,
    ).toEqual([]);
  });

  it.each(HYPERTABLES)("%s — giữ ngưỡng autoanalyze 0.02 (mặc định 0.10 quá lỏng cho bảng nóng)", async (table) => {
    const [row] = await sql<{ opts: string | null }[]>`
      SELECT array_to_string(reloptions, ',') AS opts
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = ${table}`;

    expect(
      row?.opts ?? "",
      `${table} mất reloptions autovacuum_analyze_scale_factor=0.02 — thống kê sẽ mốc lại lặng lẽ`,
    ).toContain("autovacuum_analyze_scale_factor=0.02");
  });

  it("đường xuất measurements.csv không còn rơi vào Nested Loop + Materialize", async () => {
    // Vị từ NGUYÊN VĂN của truy vấn xuất CŨ (exportRouter.ts §610-627). Ở quy mô test nó chạy
    // nhanh dù kế hoạch nào, nên ca này canh HÌNH DẠNG KẾ HOẠCH chứ không canh đồng hồ:
    // `Materialize` bên trong nested loop + `Join Filter` trên chính vị từ nối = đúng chữ ký
    // của kế hoạch 184 giây. Trên bảng rỗng/nhỏ planner chọn Hash/Merge Join ⇒ xanh; ca này
    // KHÔNG chứng minh được hiệu năng, chỉ chặn chữ ký hồi quy quay lại.
    const plan = await sql<{ "QUERY PLAN": string }[]>`
      EXPLAIN SELECT mr.id, pi."serialNumber"
      FROM measurement_results mr
      INNER JOIN product_inspections pi ON mr."inspectionId" = pi.id
      WHERE pi."inspectionTime" >= '2026-06-01'::timestamp
        AND pi."inspectionTime" <= '2026-08-01'::timestamp
        AND mr.id > 0
      ORDER BY mr.id ASC
      LIMIT 1000`;
    const text = plan.map((r) => r["QUERY PLAN"]).join("\n");

    const hasMaterialize = /Materialize/.test(text);
    const joinFilteredOnJoinKey = /Join Filter: \(mr\."inspectionId" = pi\.id\)/.test(text);

    expect(
      hasMaterialize && joinFilteredOnJoinKey,
      `Kế hoạch quay lại chữ ký hồi quy (Nested Loop + Materialize, khoá nối bị hạ xuống ` +
        `Join Filter). Kế hoạch đầy đủ:\n${text}`,
    ).toBe(false);
  });
});
