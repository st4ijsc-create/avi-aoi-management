/**
 * server/db/ingestCayKetQua.db.test.ts
 *
 * Pha 1B Task 5 (BG-11 ⛔, §3.6) — lưới ghi THẬT cho `ghiCayKetQua` (server/db/inspection.ts)
 * trên DB test cô lập, bằng vai `avi_app` (KHÔNG phải `aoi`) — DATABASE_URL của repo này đã
 * là `avi_app` (.env), vitest.setup chỉ đổi TÊN DB sang `<db>_test`, KHÔNG đổi vai.
 *
 * NĂM mệnh đề phải canh (task-5-brief.md + báo cáo, mệnh đề 5 do brief bổ sung — Task 4 mới
 * chứng minh `dichCayKetQua` cho ra `verdictLuuTru: "NTF"` ở bộ nhớ; mệnh đề này chứng minh
 * giá trị đó ĐI TỚI ĐƯỢC cột `product_inspections.overallResult` qua đường ghi thật):
 *   1. Ghi một bo có cây → đếm ĐÚNG số hàng ở cả ba bảng cây.
 *   2. Ghi LẠI CÙNG một bo → số hàng KHÔNG TĂNG (BG-11 — trước migration 0340 việc này sinh
 *      2/2/2; đột biến bắt buộc bên dưới bỏ ON CONFLICT để tự chứng minh lưới đỏ được).
 *   3. `measurement_results.inspectionCaptureRowId` trỏ ĐÚNG `inspection_captures(id)`,
 *      KHÔNG trỏ `product_captures` (hai dãy id chồng khoảng — BG-8).
 *   4. Xoá surface (cha của position/capture trong CÙNG cây, FK CASCADE thật giữa ba bảng
 *      này) → position/capture con biến mất theo, không mồ côi.
 *   5. Payload mọi `result="OK"` + MỘT component `ntf=true` ⇒ cột
 *      `product_inspections.overallResult` THẬT SỰ là `"NTF"` (lỗ 6,55% — QĐ-BG7).
 *
 * ── WORM và dấu chân để lại (đọc TRƯỚC khi sửa file này) ─────────────────────────────────
 * `product_inspections` là bảng WORM: migration 0279 REVOKE DELETE khỏi `avi_app` (UPDATE vẫn
 * còn, chỉ DELETE bị thu). Vì vậy KHÔNG viết `DELETE FROM product_inspections` rồi
 * `.catch(() => {})` — đó là dọn dẹp NO-OP CÂM (đo được 32 file test khác đang làm đúng thế).
 * Chiến lược ở đây tách BẠCH hai lớp mệnh đề:
 *   · Mệnh đề 1/2/4 chỉ đụng BA BẢNG CÂY (inspection_surfaces/positions/captures) — `avi_app`
 *     CÓ quyền DELETE trên cả ba (migration 0339). `inspectionId` dùng ở đây là id RESERVE
 *     bằng chính `reserveInspectionId()` (product_inspections_id_seq) nhưng KHÔNG BAO GIỜ
 *     insert vào `product_inspections` — hợp lệ theo đúng thiết kế "soft ref, để gap OK" đã
 *     ghi trong doc-comment của `reserveInspectionId`, và tránh mọi va chạm id với hàng thật.
 *     Dọn sạch 100% trong `afterAll`.
 *   · Mệnh đề 3/5 CẦN một hàng `product_inspections` THẬT (mệnh đề 5 canh chính giá trị cột
 *     đó) — ghi qua `persistInspectionAtomic({..., cay})`, đúng đường sản xuất thật. Hàng này
 *     KHÔNG xoá được (WORM) nên CỐ Ý để lại VĨNH VIỄN — đây là lựa chọn (a) trong hai lối đi
 *     hợp lệ mà task nêu, dùng CHUNG một board cho cả hai mệnh đề để chỉ để lại ĐÚNG MỘT hàng.
 *     `measurement_results` (mệnh đề 3 tạo thêm) KHÔNG WORM — dọn được, dọn trong `afterAll`.
 *   · Máy dùng cho board thật là máy ĐÃ CÓ SẴN trên DB test (KHÔNG dựng máy mới): nếu dựng máy
 *     mới, hàng inspection để lại sẽ khoá luôn `machines.id` đó (FK RESTRICT
 *     fk_product_inspections_machine) — và kéo theo cả station/line/workshop/factory phía
 *     trên không xoá được nữa. Tái dùng máy sẵn có giữ dấu chân để lại ở ĐÚNG MỘT hàng.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { getDb } from "./connection";
import { ghiCayKetQua, persistInspectionAtomic, reserveInspectionId } from "./inspection";
import { dichCayKetQua, type CayDaDich } from "../services/ingestCayKetQua";
import { machineDataContractV2 } from "../contracts/machineDataContractV2";
import { mauHopLe } from "../contracts/machineDataContractV2.test-helpers";

const DB_URL = process.env.DATABASE_URL;
const RUN = `GCK${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
const THOI_DIEM = new Date("2026-08-26T10:00:00.000Z");

let sql: ReturnType<typeof postgres>;
const ids = { machine: 0, product: 0, point: 0 };
/** inspectionId RESERVE nhưng KHÔNG BAO GIỜ insert vào product_inspections — chỉ dùng làm
 * soft-ref cho ba bảng cây (mệnh đề 1/2). Dọn hết trong afterAll bằng DELETE trên chính bảng
 * cây (avi_app CÓ quyền DELETE ở đó — khác product_inspections). */
const fakeInspectionIds: number[] = [];
let measurementResultRowId: number | undefined;
/** Board THẬT dùng CHUNG cho mệnh đề 3 và 5 — chỉ MỘT hàng product_inspections bị để lại
 * vĩnh viễn (WORM, xem header file). */
let boThat: { id: number; cay: CayDaDich } | null = null;

/**
 * Cây 2 surface × 3 position × 4 capture — cố ý LỆCH số ở cả ba cấp để mệnh đề 1 không
 * tự-thoả với một cây 1/1/1 (một cài đặt sai "luôn ghi đúng 1 hàng mỗi bảng" vẫn có thể qua
 * lọt một cây phẳng).
 */
function xayCayMau(prefix: string): ReturnType<typeof mauHopLe> {
  const p = mauHopLe();
  p.serialNumber = prefix;
  p.surfaces[0].name = "TOP";
  p.surfaces[0].positions[0].positionId = "P01";
  p.surfaces[0].positions[0].captures[0].captureId = `${prefix}-c1`;
  p.surfaces[0].positions[0].captures[0].components[0].componentId = `${prefix}-comp1`;
  p.surfaces[0].positions[0].captures.push({
    captureId: `${prefix}-c2`, captureName: "Cap2", index: 1, result: "OK", ntf: false,
    components: [{ componentId: `${prefix}-comp2`, result: "OK", ntf: false }],
  });
  p.surfaces[0].positions.push({
    positionId: "P02", positionNumber: 2, result: "OK", ntf: false,
    captures: [{
      captureId: `${prefix}-c3`, result: "OK", ntf: false,
      components: [{ componentId: `${prefix}-comp3`, result: "OK", ntf: false }],
    }],
  });
  p.surfaces.push({
    name: "BOTTOM", result: "OK", ntf: false,
    positions: [{
      positionId: "P03", positionNumber: 1, result: "OK", ntf: false,
      captures: [{
        captureId: `${prefix}-c4`, result: "OK", ntf: false,
        components: [{ componentId: `${prefix}-comp4`, result: "OK", ntf: false }],
      }],
    }],
  });
  return p;
}

/**
 * Payload cho mệnh đề 5 — ĐÚNG như brief đòi: mọi `result="OK"` (mọi cấp, kể cả payload
 * gốc), MỘT component duy nhất mang cờ `ntf=true` (result của chính nó VẪN "OK" — chỉ cờ
 * ntf bật). `rollupVerdict` cuộn cờ ntf THÔ từ lá lên (KHÔNG đọc `ntf` khai ở capture/
 * position/surface — chỉ đọc của component) nên KHÔNG cần bật `ntf` khai ở các cấp trên;
 * việc bubble lên `cay.rolledNtf=true` chứng minh đúng cơ chế cuộn, không phải copy cờ khai.
 */
function xayCayMauNtf(prefix: string): ReturnType<typeof mauHopLe> {
  const p = mauHopLe();
  p.serialNumber = prefix;
  p.overallResult = "OK";
  p.ntf = false;
  p.surfaces[0].result = "OK";
  p.surfaces[0].ntf = false;
  p.surfaces[0].positions[0].result = "OK";
  p.surfaces[0].positions[0].ntf = false;
  p.surfaces[0].positions[0].captures[0].result = "OK";
  p.surfaces[0].positions[0].captures[0].ntf = false;
  p.surfaces[0].positions[0].captures[0].components[0].componentId = `${prefix}-comp-ntf`;
  p.surfaces[0].positions[0].captures[0].components[0].result = "OK";
  p.surfaces[0].positions[0].captures[0].components[0].ntf = true;
  return p;
}

/** Đếm số hàng cây theo `inspectionId`, join xuống từ `inspection_surfaces`. */
async function demCay(inspectionId: number): Promise<{ surfaces: number; positions: number; captures: number }> {
  const [s] = await sql<{ c: number }[]>`
    SELECT count(*)::int AS c FROM inspection_surfaces WHERE "inspectionId" = ${inspectionId}`;
  const [p] = await sql<{ c: number }[]>`
    SELECT count(*)::int AS c FROM inspection_positions ip
    JOIN inspection_surfaces s ON s.id = ip."surfaceRowId"
    WHERE s."inspectionId" = ${inspectionId}`;
  const [c] = await sql<{ c: number }[]>`
    SELECT count(*)::int AS c FROM inspection_captures ic
    JOIN inspection_positions ip ON ip.id = ic."positionRowId"
    JOIN inspection_surfaces s ON s.id = ip."surfaceRowId"
    WHERE s."inspectionId" = ${inspectionId}`;
  return { surfaces: s.c, positions: p.c, captures: c.c };
}

describe.skipIf(!DB_URL)("ghiCayKetQua — ghi cây kết quả 3 cấp + khử trùng (Pha 1B Task 5, BG-11)", () => {
  beforeAll(async () => {
    sql = postgres(DB_URL!, { max: 1, connect_timeout: 30, onnotice: () => {} });

    const [anyMachine] = await sql<{ id: number }[]>`SELECT id FROM machines ORDER BY id LIMIT 1`;
    if (!anyMachine) {
      throw new Error(
        "ingestCayKetQua.db.test: DB test không có sẵn máy nào để tái dùng cho board THẬT " +
          "(mệnh đề 3/5) — chạy node scripts/setup-test-db.mjs / seed tối thiểu trước.",
      );
    }
    ids.machine = anyMachine.id;

    const [p] = await sql<{ id: number }[]>`
      INSERT INTO product_models (code, name) VALUES (${"P-" + RUN}, 'GCK product') RETURNING id`;
    ids.product = p.id;
    const [pt] = await sql<{ id: number }[]>`
      INSERT INTO measurement_point_defs ("productModelId", code, name, "measurementType", "positionX", "positionY")
      VALUES (${ids.product}, ${"PT-" + RUN}, 'GCK point', 'DIMENSION', 10, 20) RETURNING id`;
    ids.point = pt.id;

    // ── Board THẬT dùng chung cho mệnh đề 3 và 5 ─────────────────────────────────────
    const payload = machineDataContractV2.parse(xayCayMauNtf(`${RUN}-BOTHAT`));
    const cay = dichCayKetQua(payload);
    // Tiền điều kiện chống tự-thoả: nếu Task 4 hỏng, mệnh đề 5 xanh giả vì cay.verdictLuuTru
    // đã sai NGAY TỪ ĐẦU (không phải vì đường ghi DB đúng).
    if (cay.verdictLuuTru !== "NTF") {
      throw new Error(
        `ingestCayKetQua.db.test: tiền điều kiện hỏng — dichCayKetQua(payload NTF) trả ` +
          `verdictLuuTru="${cay.verdictLuuTru}", kỳ vọng "NTF". Board THẬT không dựng được.`,
      );
    }
    const boId = await reserveInspectionId();
    const res = await persistInspectionAtomic(
      {
        id: boId,
        machineId: ids.machine,
        serialNumber: `${RUN}-BOTHAT`,
        inspectionTime: THOI_DIEM,
        overallResult: cay.verdictLuuTru, // ← đúng dây nối mệnh đề 5 canh: verdictLuuTru → cột DB
        originalResult: payload.overallResult, // "OK" — cái máy khai gốc, giữ nguyên cho audit
      },
      [],
      { cay },
    );
    boThat = { id: res.id, cay };
  });

  afterAll(async () => {
    if (!sql) return;
    // Ba bảng cây — avi_app CÓ quyền DELETE (khác product_inspections). Xoá surface tự CASCADE
    // xuống position/capture của TỪNG board giả (mệnh đề 1/2). Mệnh đề 4 tự dọn board riêng
    // của nó ngay trong ca (không cần lặp lại ở đây).
    if (fakeInspectionIds.length > 0) {
      await sql`DELETE FROM inspection_surfaces WHERE "inspectionId" = ANY(${fakeInspectionIds})`;
    }
    // measurement_results KHÔNG WORM — dọn được (mệnh đề 3).
    if (measurementResultRowId !== undefined) {
      await sql`DELETE FROM measurement_results WHERE id = ${measurementResultRowId}`;
    }
    // Cây của `boThat` CŨNG dọn được — `inspectionId` chỉ là soft-ref, ba bảng cây KHÔNG bị
    // WORM chặn (chỉ product_inspections mới bị). Dọn tới đây để dấu chân để lại VĨNH VIỄN
    // thu hẹp về ĐÚNG MỘT hàng (header) thay vì cả header lẫn cây của nó.
    if (boThat) {
      await sql`DELETE FROM inspection_surfaces WHERE "inspectionId" = ${boThat.id}`;
    }
    // ⚠ product_inspections LÀ WORM (migration 0279: REVOKE DELETE FROM avi_app) — CỐ Ý ĐỂ
    // LẠI hàng `boThat` (dùng chung mệnh đề 3+5). KHÔNG viết DELETE FROM product_inspections
    // rồi .catch(() => {}) ở đây — xem header file.
    await sql`DELETE FROM measurement_point_defs WHERE id = ${ids.point}`;
    await sql`DELETE FROM product_models WHERE id = ${ids.product}`;
    await sql.end({ timeout: 5 });
  });

  it("cầu chì — nghiệm thu chạy bằng vai avi_app, KHÔNG phải superuser/bypass RLS", async () => {
    const [role] = await sql<{ who: string; rolsuper: boolean; rolbypassrls: boolean }[]>`
      SELECT current_user AS who, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
    expect(role.who).toBe("avi_app");
    expect(role.rolsuper, "chạy bằng superuser ⇒ WORM (mệnh đề 3/5) không có ý nghĩa gì").toBe(false);
    expect(role.rolbypassrls).toBe(false);
  });

  // ── Mệnh đề 1 ────────────────────────────────────────────────────────────────────────
  it("mệnh đề 1 — ghi MỘT bo có cây → đếm ĐÚNG số hàng ở cả ba bảng cây", async () => {
    const inspectionId = await reserveInspectionId();
    fakeInspectionIds.push(inspectionId);
    const cay = dichCayKetQua(machineDataContractV2.parse(xayCayMau(`${RUN}-M1`)));

    const db = await getDb();
    if (!db) throw new Error("không có DB test — chạy: node scripts/setup-test-db.mjs");
    await db.transaction(async (tx) => {
      await ghiCayKetQua(tx, inspectionId, THOI_DIEM, cay);
    });

    const dem = await demCay(inspectionId);
    // Đúng bằng số node cay THẬT SỰ có — chống tự-thoả với hằng số cứng.
    const soPositionCay = cay.surfaces.flatMap((s) => s.positions).length;
    const soCaptureCay = cay.surfaces.flatMap((s) => s.positions.flatMap((p) => p.captures)).length;
    expect(dem).toEqual({ surfaces: cay.surfaces.length, positions: soPositionCay, captures: soCaptureCay });
    // Và khớp con số đã đếm tay trên chính xayCayMau (2 surface, 3 position, 4 capture).
    expect(dem).toEqual({ surfaces: 2, positions: 3, captures: 4 });
  });

  // ── Mệnh đề 2 ────────────────────────────────────────────────────────────────────────
  it("mệnh đề 2 (BG-11) — ghi LẠI CÙNG một bo → số hàng KHÔNG TĂNG", async () => {
    const inspectionId = await reserveInspectionId();
    fakeInspectionIds.push(inspectionId);
    const cay = dichCayKetQua(machineDataContractV2.parse(xayCayMau(`${RUN}-M2`)));

    const db = await getDb();
    if (!db) throw new Error("không có DB test — chạy: node scripts/setup-test-db.mjs");

    await db.transaction(async (tx) => { await ghiCayKetQua(tx, inspectionId, THOI_DIEM, cay); });
    const truoc = await demCay(inspectionId);

    // Ghi LẠI — mô phỏng máy gửi lại / retry mạng (hành vi "replay = duplicate" đã ghi
    // nhận ở doc 61), ĐÚNG cùng inspectionId + cay.
    await db.transaction(async (tx) => { await ghiCayKetQua(tx, inspectionId, THOI_DIEM, cay); });
    const sau = await demCay(inspectionId);

    expect(sau, "số hàng SAU lượt ghi thứ hai phải bằng số hàng TRƯỚC — không nhân đôi").toEqual(truoc);
    expect(sau).toEqual({ surfaces: 2, positions: 3, captures: 4 }); // không phải 4/6/8
  });

  // ── Mệnh đề 4 ────────────────────────────────────────────────────────────────────────
  it("mệnh đề 4 — xoá surface (cha) → position/capture con biến mất theo CASCADE, không mồ côi", async () => {
    const inspectionId = await reserveInspectionId();
    const cay = dichCayKetQua(machineDataContractV2.parse(xayCayMau(`${RUN}-M4`)));

    const db = await getDb();
    if (!db) throw new Error("không có DB test — chạy: node scripts/setup-test-db.mjs");
    await db.transaction(async (tx) => { await ghiCayKetQua(tx, inspectionId, THOI_DIEM, cay); });

    const truoc = await demCay(inspectionId);
    expect(truoc.surfaces).toBeGreaterThan(0);
    expect(truoc.positions).toBeGreaterThan(0);
    expect(truoc.captures).toBeGreaterThan(0);

    // Xoá CHỈ surface — position/capture PHẢI biến mất theo FK CASCADE thật (không phải vì
    // app code dọn hộ): inspection_positions.surfaceRowId và inspection_captures.positionRowId
    // đều khai ON DELETE CASCADE (drizzle/schema/inspectionTree.ts).
    await sql`DELETE FROM inspection_surfaces WHERE "inspectionId" = ${inspectionId}`;

    const sau = await demCay(inspectionId);
    expect(sau, "còn sót position/capture sau khi xoá surface cha ⇒ MỒ CÔI").toEqual({
      surfaces: 0, positions: 0, captures: 0,
    });
    // Board này tự dọn xong ở trên — KHÔNG push vào fakeInspectionIds (tránh DELETE thừa vô hại
    // nhưng vô nghĩa trong afterAll).
  });

  // ── Mệnh đề 3 ────────────────────────────────────────────────────────────────────────
  it("mệnh đề 3 (BG-8) — measurement_results.inspectionCaptureRowId trỏ ĐÚNG inspection_captures(id), KHÔNG trỏ product_captures", async () => {
    if (!boThat) throw new Error("board THẬT (beforeAll) chưa dựng được — xem log beforeAll");

    const [cap] = await sql<{ id: number; ext: string }[]>`
      SELECT ic.id AS id, ic."captureExtId" AS ext
      FROM inspection_captures ic
      JOIN inspection_positions ip ON ip.id = ic."positionRowId"
      JOIN inspection_surfaces s ON s.id = ip."surfaceRowId"
      WHERE s."inspectionId" = ${boThat.id}
      ORDER BY ic.id LIMIT 1`;
    expect(cap, "board THẬT (mệnh đề 5) không có capture nào — ghiCayKetQua đã không chạy đúng").toBeTruthy();

    const [mr] = await sql<{ id: number }[]>`
      INSERT INTO measurement_results ("inspectionId", "pointDefId", result, "inspectionCaptureRowId")
      VALUES (${boThat.id}, ${ids.point}, 'OK', ${cap.id}) RETURNING id`;
    measurementResultRowId = mr.id;

    // Đi ĐÚNG con đường FK thật (JOIN qua inspectionCaptureRowId), không chỉ so sánh số id.
    const [noiKhop] = await sql<{ id: number; ext: string }[]>`
      SELECT c.id AS id, c."captureExtId" AS ext
      FROM measurement_results m
      JOIN inspection_captures c ON c.id = m."inspectionCaptureRowId"
      WHERE m.id = ${mr.id}`;
    expect(noiKhop.id).toBe(cap.id);
    expect(noiKhop.ext).toBe(cap.ext);

    // Đối chứng ÂM: hai dãy id chồng khoảng (BG-8) — nếu id này TÌNH CỜ cũng tồn tại bên
    // product_captures (cây CẤU HÌNH, sequence riêng), captureExtId của nó phải KHÁC, chứng
    // minh FK thật sự phân giải sang inspection_captures chứ không lẫn sang product_captures.
    const trungBenCauHinh = await sql<{ ext: string }[]>`
      SELECT "captureExtId" AS ext FROM product_captures WHERE id = ${cap.id}`;
    if (trungBenCauHinh.length > 0) {
      expect(trungBenCauHinh[0].ext).not.toBe(cap.ext);
    }
  });

  // ── Mệnh đề 5 ────────────────────────────────────────────────────────────────────────
  it("mệnh đề 5 (QĐ-BG7, lỗ 6,55%) — mọi result=OK + MỘT component ntf=true ⇒ cột overallResult THẬT là 'NTF'", async () => {
    if (!boThat) throw new Error("board THẬT (beforeAll) chưa dựng được — xem log beforeAll");

    // Tiền đề của payload — đúng hình dạng brief mô tả.
    expect(boThat.cay.rolledResult).toBe("OK"); // không NG nào trong cây
    expect(boThat.cay.rolledNtf).toBe(true); // cờ ntf bubbled từ ĐÚNG một component
    expect(boThat.cay.verdictLuuTru).toBe("NTF"); // cầu nối Task 1 áp cho verdict gốc

    // Giá trị THẬT nằm trong cột DB — không phải giá trị tính lại ở bộ nhớ.
    const [row] = await sql<{ overallResult: string }[]>`
      SELECT "overallResult" FROM product_inspections WHERE id = ${boThat.id}`;
    expect(row, "hàng board THẬT không tồn tại trong DB — persistInspectionAtomic đã không ghi").toBeTruthy();
    expect(row.overallResult).toBe("NTF");
  });
});
