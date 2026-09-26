/**
 * ★★★ Pha 7 Task 3 — **MỘT BỘ SUY DUY NHẤT ĐỌC CỘT RA KHỎI ĐỐI TƯỢNG DRIZZLE.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠⚠ VÌ SAO FILE NÀY TỒN TẠI: **HAI BỘ SUY ĐỘC LẬP CANH HAI NỬA CỦA MỘT CÂU** (C-2, Pha 6)
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Bài học đã trả giá: khi hai phép canh **cùng một loại sự thật** được viết **hai lần ở hai phạm
 * vi**, cái **YẾU hơn** rốt cuộc canh nửa **NGUY HIỂM hơn**, và không ai phát hiện vì cả hai đều
 * xanh. Pha 6 Task 5 đã dựng phép neo *"bảng hằng phải KHỚP drizzle"* cho `vram_leases`
 * (`sharedLedgerIdentityCut.test.ts`, ∀-A). Task 3 phải làm **đúng việc ấy** cho `vram_events`.
 *
 * ⇒ Nên vòng lặp *"bóc cột ra khỏi đối tượng drizzle"* **chuyển về đây, MỘT chỗ**, và **cả hai**
 *   lưới nhập nó. Viết lại vòng lặp ấy lần thứ hai là tự đẻ ra đúng lớp lỗi C-2.
 *
 * ⚠ **NGUỒN ĐO là chính đối tượng drizzle sinh ra DDL** — không phải văn bản `.sql`, không phải
 *   một danh sách chép tay trong test. Đối tượng ấy là thứ `drizzle-kit` dùng để sinh migration,
 *   nên nó là bản mô tả gần cột thật nhất mà mã ứng dụng với tới được **không cần DB**.
 * ⚠ File này **KHÔNG có phụ thuộc nào** (cùng kỷ luật với `vramColumnLimits.ts`): nó bị nhập từ
 *   nhiều tầng, nên một phụ thuộc ở đây là một vòng nhập tiềm tàng.
 *
 * ⚠⚠ **BÀI HỌC PHA 7 TASK 9, GIỮ SỐNG Ở ĐÂY:** lọc `columnType === "PgVarchar"` **đúng** cho câu
 * hỏi *"bề rộng"* và **mù theo CẤU TẠO** với mọi cột không phải `varchar`. Vì thế module này phơi
 * **HAI** cửa — `cotVarchar()` (hỏi bề rộng) và `moiCot()` (hỏi sự tồn tại) — để lưới nào cần lượng
 * từ trên **MỌI kiểu** thì có sẵn cửa, thay vì phải copy vòng lặp rồi bỏ mất bộ lọc.
 */

/** Một cột đọc được từ đối tượng drizzle. `beRong` chỉ có nghĩa với `varchar`. */
export interface CotDrizzle {
  readonly ten: string;
  readonly kieu: string;
  readonly beRong: number | null;
}

/**
 * Bóc **mọi** cột ra khỏi một đối tượng bảng drizzle.
 *
 * ⚠ `as unknown as` chứ không `as`: `PgTableWithColumns` KHÔNG có index signature nên `tsc` từ chối
 *   phép ép một bước. Ép ở **đây, một lần** thay vì ở từng lưới.
 */
export function docCotDrizzle(bang: unknown): CotDrizzle[] {
  const ra: CotDrizzle[] = [];
  for (const [ten, cot] of Object.entries(bang as unknown as Record<string, unknown>)) {
    const c = cot as { columnType?: unknown; length?: unknown } | null | undefined;
    if (c === null || c === undefined || typeof c.columnType !== "string") continue;
    ra.push({ ten, kieu: c.columnType, beRong: typeof c.length === "number" ? c.length : null });
  }
  return ra;
}

/**
 * Cột `varchar` → **bề rộng khai trong drizzle**.
 *
 * ⚠ Chỉ nhận cột có `length` là **số**: một `varchar` không bề rộng (`varchar` trần) không có trần
 *   để so, và đưa nó vào bản đồ với `null` là mời một phép so sánh với `null` đi qua im lặng.
 */
export function cotVarchar(bang: unknown): Map<string, number> {
  const ra = new Map<string, number>();
  for (const c of docCotDrizzle(bang)) {
    if (c.kieu === "PgVarchar" && c.beRong !== null) ra.set(c.ten, c.beRong);
  }
  return ra;
}

/** Tên **MỌI** cột, **bất kể kiểu** — cửa dành cho lượng từ không được phép mù với `jsonb`/`bigint`. */
export function moiCot(bang: unknown): Set<string> {
  return new Set(docCotDrizzle(bang).map((c) => c.ten));
}
