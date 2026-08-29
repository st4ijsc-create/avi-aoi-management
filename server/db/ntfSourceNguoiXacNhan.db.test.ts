/**
 * server/db/ntfSourceNguoiXacNhan.db.test.ts
 *
 * Pha 1D Task 4, VIỆC 1 (BG-41) — `updateProductInspectionNTF` (server/db/
 * inspection.ts) set `overallResult:"NTF"` + `ntfConfirmedBy/At/ntfReason` khi
 * NGƯỜI xác nhận NTF nhưng KHÔNG hề chạm `ntfSource`.
 *
 * ── Số đo TRƯỚC bản vá (task-4-brief.md) ─────────────────────────────────────
 * 119 bo có `ntfConfirmedAt` khác NULL; 119/119 trong số đó có `ntfSource =
 * NULL`; 0 hàng trong TOÀN BẢNG có `ntfSource ∈ {'human','both'}`. Pha 1C
 * Task 5 vừa vá chiều NGƯỢC lại (NTF khai ở cấp bo ghi `ntfSource='machine'`) —
 * bản vá đó lo đếm THIẾU. Nhưng nó mở ra chiều ĐẾM THỪA: một bo v2.0 đã mang
 * `ntfSource='machine'`, sau đó NGƯỜI xác nhận NTF ⇒ cột VẪN khai `'machine'`
 * ⇒ `WHERE ntfSource='machine'` đếm cả bo do người đánh dấu.
 *
 * BA mệnh đề canh (đo bằng SELECT trên DB THẬT sau khi gọi
 * `updateProductInspectionNTF`, không phải giá trị hàm trả về — hàm này
 * `void`):
 *   1. `ntfSource` NULL (chưa có nguồn)     → 'human'  sau khi người xác nhận.
 *   2. `ntfSource` 'machine' (đường v2.0)   → 'both'   sau khi người xác nhận.
 *   3. `ntfSource` 'human' (người xác nhận lần hai) → vẫn 'human'.
 *
 * ĐỘT BIẾN BẮT BUỘC: bỏ nhánh gán `ntfSource` khỏi `.set(...)` trong
 * `updateProductInspectionNTF` → cả BA mệnh đề trên phải ĐỎ (cột đứng yên ở
 * giá trị TRƯỚC lệnh gọi thay vì chuyển đúng theo bảng ba chuyển tiếp); hoàn
 * tác → xanh lại.
 *
 * ── WORM — đọc TRƯỚC khi sửa file này ───────────────────────────────────────
 * `product_inspections` bị REVOKE DELETE khỏi `avi_app` (migration 0279) — vai
 * chạy lưới này (DATABASE_URL trong .env dùng `avi_app`) KHÔNG xoá được hàng
 * đã ghi. File này KHÔNG viết `DELETE FROM product_inspections … .catch(() =>
 * {})` (32 file test khác làm vậy và tất cả là NO-OP CÂM). Ba hàng
 * `product_inspections` file này tạo ra (một cho mỗi chuyển tiếp) bị để lại
 * VĨNH VIỄN. Các bảng phụ trợ (factory/workshop/line/station/machine) không
 * WORM nhưng bị khoá bởi FK RESTRICT từ `product_inspections` nên cũng để lại
 * vĩnh viễn — không dọn trong `afterAll`, đúng khuôn `reportAggregators.db.test.ts`.
 */
import { describe, it, expect, beforeAll } from "vitest";
import postgres from "postgres";
import { updateProductInspectionNTF } from "./inspection";

const DB_URL = process.env.DATABASE_URL;
const RUN = `NSX${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 1e4)}`;
const CONFIRM_USER_ID = 1; // ntfConfirmedBy KHÔNG có FK (drizzle/schema/inspection.ts:57) — số bất kỳ hợp lệ.

let sql: ReturnType<typeof postgres>;
let machineId = 0;
const inspIds: { rong: number; may: number; nguoi: number } = { rong: 0, may: 0, nguoi: 0 };

describe.skipIf(!DB_URL)("BG-41: updateProductInspectionNTF ghi ntfSource đúng ba chuyển tiếp", () => {
  beforeAll(async () => {
    sql = postgres(DB_URL!, { max: 1, connect_timeout: 30, onnotice: () => {} });

    const [f] = await sql`INSERT INTO factories (code, name) VALUES (${"F-" + RUN}, 'BG-41 factory') RETURNING id`;
    const [w] = await sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${f.id}, ${"W-" + RUN}, 'BG-41 workshop') RETURNING id`;
    const [l] = await sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${w.id}, ${"L-" + RUN}, 'BG-41 line') RETURNING id`;
    const [s] = await sql`INSERT INTO stations ("lineId", code, name) VALUES (${l.id}, ${"S-" + RUN}, 'BG-41 station') RETURNING id`;
    const [m] = await sql`INSERT INTO machines ("stationId", code, name, "machineType") VALUES (${s.id}, ${"M-" + RUN}, 'BG-41 machine', 'AOI') RETURNING id`;
    machineId = m.id;

    // Ba bo khởi tạo overallResult='NG' (trạng thái điển hình TRƯỚC khi người xác
    // nhận NTF) với ba ntfSource khởi điểm khác nhau: NULL, 'machine', 'human'.
    const mkInsp = async (serial: string, ntfSourceKhoiDiem: string | null) => {
      const [r] = await sql`
        INSERT INTO product_inspections
          ("machineId", "serialNumber", "overallResult", "originalResult", "inspectionTime", "ntfSource")
        VALUES (${machineId}, ${serial}, 'NG', 'NG', ${new Date()}, ${ntfSourceKhoiDiem})
        RETURNING id`;
      return r.id as number;
    };
    inspIds.rong = await mkInsp(`SN-${RUN}-RONG`, null);
    inspIds.may = await mkInsp(`SN-${RUN}-MAY`, "machine");
    inspIds.nguoi = await mkInsp(`SN-${RUN}-NGUOI`, "human");
  });

  it("mệnh đề 1: ntfSource NULL (chưa có nguồn) → 'human' sau khi người xác nhận", async () => {
    await updateProductInspectionNTF(inspIds.rong, CONFIRM_USER_ID, "BG-41 test — chưa có nguồn");
    const [row] = await sql`SELECT "ntfSource", "overallResult" FROM product_inspections WHERE id = ${inspIds.rong}`;
    expect(row.ntfSource, `SELECT thật trả ntfSource=${JSON.stringify(row.ntfSource)}`).toBe("human");
    expect(row.overallResult).toBe("NTF");
  });

  it("mệnh đề 2: ntfSource 'machine' (đường v2.0) → 'both' sau khi người xác nhận", async () => {
    await updateProductInspectionNTF(inspIds.may, CONFIRM_USER_ID, "BG-41 test — đã có machine");
    const [row] = await sql`SELECT "ntfSource", "overallResult" FROM product_inspections WHERE id = ${inspIds.may}`;
    expect(row.ntfSource, `SELECT thật trả ntfSource=${JSON.stringify(row.ntfSource)}`).toBe("both");
    expect(row.overallResult).toBe("NTF");
  });

  it("mệnh đề 3: ntfSource 'human' (người xác nhận LẦN HAI) → vẫn 'human'", async () => {
    await updateProductInspectionNTF(inspIds.nguoi, CONFIRM_USER_ID, "BG-41 test — xác nhận lần hai");
    const [row] = await sql`SELECT "ntfSource", "overallResult" FROM product_inspections WHERE id = ${inspIds.nguoi}`;
    expect(row.ntfSource, `SELECT thật trả ntfSource=${JSON.stringify(row.ntfSource)}`).toBe("human");
    expect(row.overallResult).toBe("NTF");
  });
});
