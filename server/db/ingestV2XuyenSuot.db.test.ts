/**
 * server/db/ingestV2XuyenSuot.db.test.ts
 *
 * Pha 1C Task 4 (BG-26, task-4-brief.md + kế hoạch §Task 4
 * `docs/superpowers/plans/2026-08-29-aoi-pha1c-va-lo-du-lieu.md`) — NGHIỆM THU END-TO-END
 * THẬT cho đường NHẬN v2.0: gọi ĐÚNG thủ tục `submitInspection` (tRPC caller) trên DB THẬT,
 * KHÔNG mock `../db`, rồi `SELECT` lại — đóng lỗ NGHIỆM THU (không phải lỗ mã).
 *
 * ── Lỗ đóng ở đây ────────────────────────────────────────────────────────────────────────
 * Sau cả Pha 1B, KHÔNG một ca nào ghi payload v2.0 xuyên suốt vào DB THẬT:
 *   · `machineApiIngestCayV2.test.ts` — `vi.mock("../db")`, `persistInspectionAtomic` là MOCK.
 *   · `ingestCayKetQua.db.test.ts` — dựng header BẰNG TAY (gọi thẳng `persistInspectionAtomic`
 *     với `overallResult: cay.verdictLuuTru` do TEST tự gán), KHÔNG qua router.
 * Hệ quả đo được: `summaryCounts` và `ntfSource` — hai cột CHỈ router ghi (xem
 * `server/routers/machineApiRouters.ts` dòng ~3223/3225) — NULL trên 6/6 bo có cây trong DB
 * test trước file này. File này là chỗ ĐẦU TIÊN gọi `machineApiRouter.createCaller(...).
 * submitInspection(payload)` thật, trên DB thật, rồi SELECT lại — không mock, không dựng tay.
 *
 * ── SÁU MỆNH ĐỀ canh (task-4-brief.md) ──────────────────────────────────────────────────
 *   1. Payload v2.0 → ghi được qua router thật; SELECT lại thấy bo, `overallResult` đúng.
 *   2. `summaryCounts` khác NULL và khớp NGUYÊN VĂN `summary` máy gửi.
 *   3. `ntfSource` khác NULL khi cây có NTF (bubble từ component).
 *   4. Đủ BA cấp cây (`inspection_surfaces/positions/captures`) với số hàng ĐÚNG.
 *   5. `declaredMismatch` đúng ở GỐC và ở BA cấp cây.
 *      ⚠ `product_inspections` KHÔNG có cột `declaredMismatch` riêng ở gốc (xem
 *      `drizzle/schema/inspection.ts` — chỉ ba bảng cây có cột này, migration 0339). Mệnh đề
 *      "ở gốc" vì vậy được canh bằng HAI thứ khác nhau, không lẫn vào nhau:
 *        (a) HIỆU ỨNG persisted — SELECT `overallResult` phải phản ánh đúng "xấu nhất của
 *            (khai, cuộn)" (T1, `verdictXauHon`) — đây LÀ một SELECT thật.
 *        (b) giá trị `declaredMismatch` gốc tự nó — chỉ tồn tại trong bộ nhớ (`CayDaDich`,
 *            không có cột DB) — dùng `dichCayKetQua()` làm ORACLE tiền đề (giống hệt khuôn
 *            `ingestCayKetQua.db.test.ts` dòng 163-172 đã dùng cho board THẬT của nó), KHÔNG
 *            phải giá trị đang được canh chính (đường ghi DB là đối tượng canh chính ở (a)).
 *      Ba cấp con (surface/position/capture) CÓ cột DB → canh bằng SELECT thật, không qua
 *      oracle.
 *   6. Ba bản vá T1/T2 (bảng trong nhiệm vụ) — mỗi cái MỘT ca, đo bằng SELECT:
 *        · T1 hàng 1 (Đ-21/BG-22): máy khai NG + surfaces:[] (cây rỗng) ⇒ SELECT
 *          overallResult = "NG" (KHÔNG hạ cấp thành "OK" như hành vi trước Pha 1C).
 *        · T1 hàng 2 (Đ-22/BG-24): máy khai `ntf:true` cấp bo (header), cây hoàn toàn OK
 *          không NTF nào ⇒ SELECT overallResult = "NTF".
 *        · T2 (BG-23): CÙNG payload serial RỖNG gửi HAI lượt qua CÙNG thủ tục router thật ⇒
 *          SELECT đếm hàng = 1, không phải 2.
 *
 * ── WORM và dấu chân để lại (đọc TRƯỚC khi sửa file này) ────────────────────────────────
 * `product_inspections` bị REVOKE DELETE khỏi `avi_app` (migration 0279) — vai chạy lưới này
 * KHÔNG xoá được hàng đã ghi. File này vì vậy KHÔNG viết
 * `DELETE FROM product_inspections … .catch(() => {})` (đã đo 32 file test khác làm đúng thế
 * và tất cả là NO-OP CÂM — xem MEMORY / `ingestCayKetQua.db.test.ts`). Mỗi lượt chạy file này
 * để lại ĐÚNG SÁU hàng `product_inspections` vĩnh viễn: board OK (mệnh đề 1) · board CÂY
 * (mệnh đề 2/4/5a) · board NTF (mệnh đề 3) · board NG-RỖNG (mệnh đề 5b + 6 hàng T1-1) · board
 * HEADER-NTF (mệnh đề 6 hàng T1-2) · board DEDUP (mệnh đề 6 hàng T2 — HAI lượt gửi nhưng CHỈ
 * MỘT hàng nhờ chính điều đang được canh). Factory/workshop/line/station/machine dựng ở
 * `beforeAll` cũng để lại vĩnh viễn (khoá bởi FK RESTRICT `fk_product_inspections_machine`
 * từ sáu hàng trên — không xoá được machine dù machines tự nó không WORM). BA bảng cây
 * (`inspection_surfaces/positions/captures`) KHÔNG WORM — `avi_app` CÓ quyền DELETE (migration
 * 0339) — dọn sạch trong `afterAll` cho mọi board có cây thật.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import { machineApiRouter } from "../routers/machineApiRouters";
import type { TrpcContext } from "../_core/context";
import { machineDataContractV2 } from "../contracts/machineDataContractV2";
import { dichCayKetQua } from "../services/ingestCayKetQua";

const DB_URL = process.env.DATABASE_URL;
const RUN = `IVX${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 1e4)}`;
const API_KEY = `plain-${RUN}`;

process.env.MACHINE_SHARED_KEY_ALLOWED = "true"; // đường plaintext machines.apiKey — mặc định "deny" từ mig 0334

let sql: ReturnType<typeof postgres>;
const ids = { factory: 0, workshop: 0, line: 0, station: 0, machine: 0 };

function ctx(): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  } as TrpcContext;
}

function caller() {
  return machineApiRouter.createCaller(ctx());
}

function nhomDem(total: number, pass: number, ng: number, ntf: number) {
  return { total, pass, ng, ntf };
}

function isoStart(seq: number): string {
  return `2026-08-29T${String((seq % 20) + 1).padStart(2, "0")}:00:00.000`;
}
function isoEnd(seq: number): string {
  return `2026-08-29T${String((seq % 20) + 1).padStart(2, "0")}:00:05.000`;
}

/** Khuôn payload v2.0 gốc — mỗi ca chỉ override phần khác biệt (`over`). `seq` gắn vào
 * `machineProductIndex`/`productId`/`startedAt` để mỗi board có khoá khử trùng RIÊNG (trừ
 * ca T2 chủ đích gửi lại CÙNG payload). */
function payloadGoc(seq: number, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: "2.0",
    apiKey: API_KEY,
    identity: {
      station: `${RUN}-ST`, machine: `${RUN}-MC`, line: `${RUN}-LN`,
      plant: "P1", country: "VN", solutionName: "InspectProAOI", appVersion: "1.0.0",
    },
    productId: `${RUN}-PROD-${seq}`,
    serialNumber: `${RUN}-SN-${seq}`,
    overallResult: "OK",
    ntf: false,
    machineProductIndex: seq,
    startedAt: isoStart(seq),
    completedAt: isoEnd(seq),
    summary: {
      surfaces: nhomDem(0, 0, 0, 0),
      positions: nhomDem(0, 0, 0, 0),
      captures: nhomDem(0, 0, 0, 0),
      components: nhomDem(0, 0, 0, 0),
    },
    surfaces: [] as unknown[],
    ...over,
  };
}

/** Một surface/position/capture/component sạch, toàn OK — dùng cho board OK (mệnh đề 1). */
function cayMotNhanh(prefix: string): Record<string, unknown>[] {
  return [{
    name: "TOP", result: "OK", ntf: false,
    positions: [{
      positionId: "P1", result: "OK", ntf: false,
      captures: [{
        captureId: `${prefix}-C1`, result: "OK", ntf: false,
        components: [{ componentId: `${prefix}-COMP1`, result: "OK", ntf: false }],
      }],
    }],
  }];
}

const PREFIX_CAY = `${RUN}-CAY`;
/**
 * Cây 2 surface × 3 position × 4 capture, LỆCH CỐ Ý ở hai chỗ (mệnh đề 5a):
 *   · position P01 khai "NG" nhưng captures con của nó (rolled) đều "OK" ⇒ declaredMismatch=true.
 *   · capture C2 khai "NG" nhưng component con của nó "OK" ⇒ declaredMismatch=true.
 * Mọi nút khác khai KHỚP với cuộn ⇒ declaredMismatch=false — đối chứng chống "luôn true"/
 * "luôn false". Đếm tay: 2 surface / 3 position (P01,P02,P03) / 4 capture (C1..C4).
 */
function cayLech(): Record<string, unknown>[] {
  return [
    {
      name: "TOP", result: "OK", ntf: false,
      positions: [
        {
          positionId: "P01", result: "NG", ntf: false, // ⚠ lệch cố ý — cuộn từ capture ra OK
          captures: [
            { captureId: `${PREFIX_CAY}-C1`, result: "OK", ntf: false, components: [{ componentId: `${PREFIX_CAY}-COMP1`, result: "OK", ntf: false }] },
            { captureId: `${PREFIX_CAY}-C2`, result: "NG", ntf: false, components: [{ componentId: `${PREFIX_CAY}-COMP2`, result: "OK", ntf: false }] }, // ⚠ lệch cố ý
          ],
        },
        {
          positionId: "P02", result: "OK", ntf: false,
          captures: [
            { captureId: `${PREFIX_CAY}-C3`, result: "OK", ntf: false, components: [{ componentId: `${PREFIX_CAY}-COMP3`, result: "OK", ntf: false }] },
          ],
        },
      ],
    },
    {
      name: "BOTTOM", result: "OK", ntf: false,
      positions: [
        {
          positionId: "P03", result: "OK", ntf: false,
          captures: [
            { captureId: `${PREFIX_CAY}-C4`, result: "OK", ntf: false, components: [{ componentId: `${PREFIX_CAY}-COMP4`, result: "OK", ntf: false }] },
          ],
        },
      ],
    },
  ];
}

/** Đếm số hàng cây theo `inspectionId` — mỗi bảng đều mang CHÍNH cột `inspectionId` (soft-ref
 * sao xuống mọi cấp, `drizzle/schema/inspectionTree.ts`), không cần JOIN. */
async function demCay(inspectionId: number): Promise<{ surfaces: number; positions: number; captures: number }> {
  const [s] = await sql<{ c: number }[]>`SELECT count(*)::int AS c FROM inspection_surfaces WHERE "inspectionId" = ${inspectionId}`;
  const [p] = await sql<{ c: number }[]>`SELECT count(*)::int AS c FROM inspection_positions WHERE "inspectionId" = ${inspectionId}`;
  const [c] = await sql<{ c: number }[]>`SELECT count(*)::int AS c FROM inspection_captures WHERE "inspectionId" = ${inspectionId}`;
  return { surfaces: s.c, positions: p.c, captures: c.c };
}

type KetQuaSubmit = { success: true; inspectionId: number; duplicate?: boolean };

/** Board đã ghi trong `beforeAll` — mỗi `it()` chỉ SELECT, không ghi lại. */
const boards: Record<string, { id: number }> = {};
/** inspectionId của mọi board CÓ cây thật — dọn ba bảng cây trong `afterAll`. */
const boardIdsCoCay: number[] = [];

describe.skipIf(!DB_URL)("submitInspection v2.0 — nghiệm thu XUYÊN SUỐT trên DB THẬT (Pha 1C Task 4, BG-26)", () => {
  beforeAll(async () => {
    sql = postgres(DB_URL!, { max: 1, connect_timeout: 30, onnotice: () => {} });
    const one = async (q: Promise<Array<{ id: number | string }>>) => Number((await q)[0].id);

    ids.factory = await one(sql`INSERT INTO factories (code, name, "isActive") VALUES (${"F-" + RUN}, 'IVX factory', true) RETURNING id`);
    ids.workshop = await one(sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${ids.factory}, ${"W-" + RUN}, 'IVX ws') RETURNING id`);
    ids.line = await one(sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${ids.workshop}, ${"L-" + RUN}, 'IVX line') RETURNING id`);
    ids.station = await one(sql`INSERT INTO stations ("lineId", code, name) VALUES (${ids.line}, ${"S-" + RUN}, 'IVX station') RETURNING id`);
    ids.machine = await one(sql`
      INSERT INTO machines ("stationId", code, name, "machineType", "isActive", "apiKey")
      VALUES (${ids.station}, ${"M-" + RUN}, 'IVX machine', 'AOI', true, ${API_KEY}) RETURNING id`);

    const c = caller();

    // ── Board OK (mệnh đề 1) ──────────────────────────────────────────────────────────
    const payloadOk = payloadGoc(1, {
      serialNumber: `${RUN}-OK`,
      summary: {
        surfaces: nhomDem(1, 1, 0, 0), positions: nhomDem(1, 1, 0, 0),
        captures: nhomDem(1, 1, 0, 0), components: nhomDem(1, 1, 0, 0),
      },
      surfaces: cayMotNhanh(`${RUN}-OK`),
    });
    const rOk = (await c.submitInspection(payloadOk)) as KetQuaSubmit;
    boards.ok = { id: rOk.inspectionId };
    boardIdsCoCay.push(rOk.inspectionId);

    // ── Board CÂY (mệnh đề 2, 4, 5a) ──────────────────────────────────────────────────
    const payloadCay = payloadGoc(2, {
      serialNumber: PREFIX_CAY,
      summary: {
        surfaces: nhomDem(2, 2, 0, 0),
        positions: nhomDem(3, 2, 1, 0),
        captures: nhomDem(4, 3, 1, 0),
        components: nhomDem(4, 4, 0, 0),
      },
      surfaces: cayLech(),
    });
    const rCay = (await c.submitInspection(payloadCay)) as KetQuaSubmit;
    boards.cay = { id: rCay.inspectionId };
    boardIdsCoCay.push(rCay.inspectionId);

    // ── Board NTF (mệnh đề 3) — MỘT component `ntf=true`, mọi result="OK" ──────────────
    const prefixNtf = `${RUN}-NTF`;
    const payloadNtf = payloadGoc(3, {
      serialNumber: prefixNtf,
      summary: {
        surfaces: nhomDem(1, 1, 0, 0), positions: nhomDem(1, 1, 0, 0),
        captures: nhomDem(1, 1, 0, 0), components: nhomDem(1, 0, 0, 1),
      },
      surfaces: [{
        name: "TOP", result: "OK", ntf: false,
        positions: [{
          positionId: "P1", result: "OK", ntf: false,
          captures: [{
            captureId: `${prefixNtf}-C1`, result: "OK", ntf: false,
            components: [{ componentId: `${prefixNtf}-COMP1`, result: "OK", ntf: true }],
          }],
        }],
      }],
    });
    const rNtf = (await c.submitInspection(payloadNtf)) as KetQuaSubmit;
    boards.ntf = { id: rNtf.inspectionId };
    boardIdsCoCay.push(rNtf.inspectionId);

    // ── Board NG-RỖNG (mệnh đề 5b + 6 hàng T1-1, Đ-21/BG-22) ────────────────────────────
    const payloadNgRong = payloadGoc(4, {
      serialNumber: `${RUN}-NGRONG`,
      overallResult: "NG",
      ntf: false,
      surfaces: [], // cây RỖNG cố ý — máy khai NG nhưng không gửi chi tiết
    });
    const rNgRong = (await c.submitInspection(payloadNgRong)) as KetQuaSubmit;
    boards.ngRong = { id: rNgRong.inspectionId };
    // KHÔNG push boardIdsCoCay — surfaces:[] không tạo hàng cây nào để dọn.

    // ── Board HEADER-NTF (mệnh đề 6 hàng T1-2, Đ-22/BG-24) ──────────────────────────────
    // Cây hoàn toàn OK, KHÔNG NTF nào — NTF DUY NHẤT đến từ payload.ntf=true cấp bo (header),
    // KHÁC nguồn với board NTF ở trên (nguồn đó là component). ntfSource ở đây sẽ NULL (cuộn
    // từ cây không hề có NTF) — cố ý KHÔNG canh ntfSource trên board này, xem it() tương ứng.
    const prefixHdr = `${RUN}-HDRNTF`;
    const payloadHeaderNtf = payloadGoc(5, {
      serialNumber: prefixHdr,
      overallResult: "OK",
      ntf: true, // ← lời khai cấp bo, nguồn NTF THỨ HAI (Đ-22)
      summary: {
        surfaces: nhomDem(1, 1, 0, 0), positions: nhomDem(1, 1, 0, 0),
        captures: nhomDem(1, 1, 0, 0), components: nhomDem(1, 1, 0, 0),
      },
      surfaces: cayMotNhanh(prefixHdr),
    });
    const rHdr = (await c.submitInspection(payloadHeaderNtf)) as KetQuaSubmit;
    boards.headerNtf = { id: rHdr.inspectionId };
    boardIdsCoCay.push(rHdr.inspectionId);
  });

  afterAll(async () => {
    if (!sql) return;
    // Ba bảng cây — avi_app CÓ quyền DELETE (khác product_inspections, WORM). Xoá surface tự
    // CASCADE xuống position/capture (FK ON DELETE CASCADE, drizzle/schema/inspectionTree.ts).
    if (boardIdsCoCay.length > 0) {
      await sql`DELETE FROM inspection_surfaces WHERE "inspectionId" = ANY(${boardIdsCoCay})`;
    }
    // ⚠ product_inspections LÀ WORM (migration 0279) — CỐ Ý ĐỂ LẠI sáu hàng board (xem docblock
    // đầu file). KHÔNG viết DELETE FROM product_inspections rồi .catch(() => {}) ở đây.
    // Factory/workshop/line/station/machine bị khoá bởi FK RESTRICT từ các hàng đó — cũng để
    // lại vĩnh viễn, không dọn.
    await sql.end({ timeout: 5 });
  });

  it("cầu chì — nghiệm thu chạy bằng vai avi_app, KHÔNG phải superuser/bypass RLS", async () => {
    const [role] = await sql<{ who: string; rolsuper: boolean; rolbypassrls: boolean }[]>`
      SELECT current_user AS who, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
    expect(role.who).toBe("avi_app");
    expect(role.rolsuper, "chạy bằng superuser ⇒ WORM không có ý nghĩa gì").toBe(false);
    expect(role.rolbypassrls).toBe(false);
  });

  // ══ Mệnh đề 1 ═══════════════════════════════════════════════════════════════════════
  describe("mệnh đề 1 — payload v2.0 ghi được QUA ROUTER THẬT, SELECT lại thấy bo, overallResult đúng", () => {
    it("SELECT product_inspections theo id trả về ĐÚNG hàng vừa ghi", async () => {
      const [row] = await sql<{ overallResult: string; serialNumber: string; machineId: number }[]>`
        SELECT "overallResult", "serialNumber", "machineId" FROM product_inspections WHERE id = ${boards.ok.id}`;
      expect(row, "không tìm thấy hàng — submitInspection không ghi tới DB thật").toBeTruthy();
      expect(row.overallResult).toBe("OK");
      expect(row.serialNumber).toBe(`${RUN}-OK`);
      expect(row.machineId).toBe(ids.machine);
    });
  });

  // ══ Mệnh đề 2 ═══════════════════════════════════════════════════════════════════════
  describe("mệnh đề 2 — summaryCounts KHÁC NULL và khớp NGUYÊN VĂN summary máy gửi (lỗ NULL 6/6 trước file này)", () => {
    it("SELECT summaryCounts khớp toEqual với payload.summary đã gửi", async () => {
      const [row] = await sql<{ summaryCounts: unknown }[]>`
        SELECT "summaryCounts" FROM product_inspections WHERE id = ${boards.cay.id}`;
      expect(row, "không tìm thấy board CÂY").toBeTruthy();
      expect(row.summaryCounts, "summaryCounts NULL — đúng lỗ đang canh").not.toBeNull();
      expect(row.summaryCounts).toEqual({
        surfaces: nhomDem(2, 2, 0, 0),
        positions: nhomDem(3, 2, 1, 0),
        captures: nhomDem(4, 3, 1, 0),
        components: nhomDem(4, 4, 0, 0),
      });
    });
  });

  // ══ Mệnh đề 3 ═══════════════════════════════════════════════════════════════════════
  describe("mệnh đề 3 — ntfSource KHÁC NULL khi cây có NTF (bubble từ component, nguồn 'machine')", () => {
    it("SELECT ntfSource = 'machine' trên board có đúng MỘT component ntf=true", async () => {
      const [row] = await sql<{ ntfSource: string | null; overallResult: string }[]>`
        SELECT "ntfSource", "overallResult" FROM product_inspections WHERE id = ${boards.ntf.id}`;
      expect(row, "không tìm thấy board NTF").toBeTruthy();
      expect(row.ntfSource, "ntfSource NULL — đúng lỗ đang canh").not.toBeNull();
      expect(row.ntfSource).toBe("machine");
      // Bonus (không phải mệnh đề chính): verdict cũng phải cuộn ra NTF, không phải OK.
      expect(row.overallResult).toBe("NTF");
    });

    it("ĐỐI CHỨNG — board HEADER-NTF (NTF đến từ payload.ntf cấp bo, KHÔNG từ component) ⇒ ntfSource VẪN NULL (đúng, không phải lỗi)", async () => {
      // Cố ý KHÔNG gộp với ca trên: hai nguồn NTF độc lập (Đ-22) tạo hai hệ quả DB khác nhau.
      // cay.ntfSource chỉ mang giá trị khi CUỘN từ cây có NTF — payload.ntf=true (header) làm
      // verdictLuuTru="NTF" NHƯNG không đi qua ntfSource (không có NguồnNTF nào ở cây con).
      const [row] = await sql<{ ntfSource: string | null; overallResult: string }[]>`
        SELECT "ntfSource", "overallResult" FROM product_inspections WHERE id = ${boards.headerNtf.id}`;
      expect(row.overallResult).toBe("NTF");
      expect(row.ntfSource).toBeNull();
    });
  });

  // ══ Mệnh đề 4 ═══════════════════════════════════════════════════════════════════════
  describe("mệnh đề 4 — đủ BA CẤP CÂY với số hàng ĐÚNG (2 surface / 3 position / 4 capture)", () => {
    it("demCay(boards.cay.id) = {surfaces:2, positions:3, captures:4}", async () => {
      const dem = await demCay(boards.cay.id);
      expect(dem).toEqual({ surfaces: 2, positions: 3, captures: 4 });
    });
  });

  // ══ Mệnh đề 5 ═══════════════════════════════════════════════════════════════════════
  describe("mệnh đề 5 — declaredMismatch ĐÚNG ở BA CẤP (cột DB thật) và Ở GỐC (hiệu ứng SELECT + oracle thuần)", () => {
    it("5a — SELECT declaredMismatch ĐÚNG ở surface/position/capture (P01 và C2 lệch cố ý, còn lại khớp)", async () => {
      const surfaces = await sql<{ surfaceName: string; declaredMismatch: boolean }[]>`
        SELECT "surfaceName", "declaredMismatch" FROM inspection_surfaces
        WHERE "inspectionId" = ${boards.cay.id} ORDER BY "surfaceName"`;
      expect(surfaces.map((s) => ({ ten: s.surfaceName, lech: s.declaredMismatch }))).toEqual([
        { ten: "BOTTOM", lech: false },
        { ten: "TOP", lech: false }, // phái sinh — surface tự nó khai khớp cuộn (xem doc-comment SurfaceDaDich)
      ]);

      const positions = await sql<{ positionId: string; declaredMismatch: boolean }[]>`
        SELECT "positionId", "declaredMismatch" FROM inspection_positions
        WHERE "inspectionId" = ${boards.cay.id} ORDER BY "positionId"`;
      expect(positions.map((p) => ({ id: p.positionId, lech: p.declaredMismatch }))).toEqual([
        { id: "P01", lech: true }, // ⚠ lệch cố ý — khai NG, captures con cuộn ra OK
        { id: "P02", lech: false },
        { id: "P03", lech: false },
      ]);

      const captures = await sql<{ captureExtId: string; declaredMismatch: boolean }[]>`
        SELECT "captureExtId", "declaredMismatch" FROM inspection_captures
        WHERE "inspectionId" = ${boards.cay.id} ORDER BY "captureExtId"`;
      const byExt = Object.fromEntries(captures.map((c) => [c.captureExtId, c.declaredMismatch]));
      expect(byExt[`${PREFIX_CAY}-C1`]).toBe(false);
      expect(byExt[`${PREFIX_CAY}-C2`], "⚠ lệch cố ý — khai NG, component con OK").toBe(true);
      expect(byExt[`${PREFIX_CAY}-C3`]).toBe(false);
      expect(byExt[`${PREFIX_CAY}-C4`]).toBe(false);
    });

    it("5b — ở GỐC: không có cột DB riêng, canh bằng (a) hiệu ứng persisted overallResult THẬT + (b) oracle dichCayKetQua làm tiền đề", async () => {
      // (b) oracle THUẦN — không chạm DB, chỉ để CHỨNG MINH tiền đề "payload này THẬT SỰ lệch
      // ở gốc" không tự bịa: dùng lại ĐÚNG payload đã gửi cho board NG-RỖNG ở beforeAll.
      const payloadNgRong = payloadGoc(4, {
        serialNumber: `${RUN}-NGRONG`, overallResult: "NG", ntf: false, surfaces: [],
      });
      const cay = dichCayKetQua(machineDataContractV2.parse(payloadNgRong));
      expect(cay.declaredMismatch, "tiền đề: payload phải THẬT SỰ lệch ở gốc (khai NG, cuộn OK từ cây rỗng)").toBe(true);
      expect(cay.verdictLuuTru).toBe("NG");

      // (a) hiệu ứng THẬT — SELECT DB thật cho ĐÚNG board đó (không phải giá trị trả về của hàm).
      const [row] = await sql<{ overallResult: string }[]>`
        SELECT "overallResult" FROM product_inspections WHERE id = ${boards.ngRong.id}`;
      expect(row, "board NG-RỖNG không tồn tại trong DB").toBeTruthy();
      expect(row.overallResult, "lệch ở gốc phải THẮNG — cột phải là NG, không bị hạ thành OK").toBe("NG");
    });
  });

  // ══ Mệnh đề 6 ═══════════════════════════════════════════════════════════════════════
  describe("mệnh đề 6 — BA bản vá T1/T2, mỗi cái MỘT ca, đo bằng SELECT trên đường THẬT", () => {
    it("T1 hàng 1 (Đ-21/BG-22) — máy khai NG + surfaces:[] (cây rỗng) ⇒ SELECT overallResult = 'NG' (KHÔNG hạ thành OK)", async () => {
      const [row] = await sql<{ overallResult: string }[]>`
        SELECT "overallResult" FROM product_inspections WHERE id = ${boards.ngRong.id}`;
      expect(row.overallResult).toBe("NG");
    });

    it("T1 hàng 2 (Đ-22/BG-24) — máy khai ntf:true cấp bo (header), cây hoàn toàn OK ⇒ SELECT overallResult = 'NTF'", async () => {
      const [row] = await sql<{ overallResult: string }[]>`
        SELECT "overallResult" FROM product_inspections WHERE id = ${boards.headerNtf.id}`;
      expect(row.overallResult).toBe("NTF");
    });

    it("T2 (BG-23) — CÙNG payload serial RỖNG gửi HAI lượt qua CÙNG thủ tục router thật ⇒ SELECT đếm = 1, không phải 2", async () => {
      const IDX = 6;
      const payload = payloadGoc(IDX, { serialNumber: "", surfaces: [] });

      const truoc = await sql<{ c: number }[]>`
        SELECT count(*)::int AS c FROM product_inspections
        WHERE "machineId" = ${ids.machine} AND "machineProductIndex" = ${IDX}`;
      expect(truoc[0].c).toBe(0);

      const c = caller();
      const r1 = (await c.submitInspection(structuredClone(payload))) as KetQuaSubmit;
      expect(r1.success).toBe(true);
      expect(r1.duplicate).toBe(false);

      const r2 = (await c.submitInspection(structuredClone(payload))) as KetQuaSubmit;
      expect(r2.duplicate, "lượt 2 phải được nhận diện TRÙNG").toBe(true);
      expect(r2.inspectionId).toBe(r1.inspectionId);

      const sau = await sql<{ c: number }[]>`
        SELECT count(*)::int AS c FROM product_inspections
        WHERE "machineId" = ${ids.machine} AND "machineProductIndex" = ${IDX}`;
      expect(sau[0].c, "hai lượt gửi CÙNG payload không được tạo hai hàng").toBe(1);
    });
  });
});
