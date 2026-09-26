/**
 * ★★★ 2026-08-18 — **PHẠM VI NHÀ MÁY của `publicProductApiRouter` trên CSDL THẬT.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * VÌ SAO PHẢI CHẠM CSDL THẬT — VÀ VÌ SAO PHẢI DỰNG **HAI** NHÀ MÁY
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Cổng phạm vi ở đây là SQL thô lồng bốn tầng truy vấn phụ (`product_machine_mappings` ∪
 * `measurement_point_defs` ∪ `product_inspections` → `machines → stations → production_lines →
 * workshops`). Một lưới giả lập `getDb` KHÔNG phát biểu được `42P01` / `42809` / sai tên cột —
 * chỉ Postgres nói được. Và trên `aoi_management(_test)` **mọi** máy đều thuộc nhà máy 1
 * (`SIM-FAC`, đo 2026-08-18: 41/41), nên chiều ÂM *"A không thấy dữ liệu của B"* là **không đo
 * được** ở đó: báo một lượt dương thành "bằng chứng chặn" là đúng lớp lỗi thước-xanh-giả.
 *
 * ⚠⚠ **ÂM ĐỐI XỨNG là bắt buộc, không phải cho đủ bộ.** Mỗi ca chặn đều có ca sinh đôi ở chiều
 * ngược (B thấy đúng của B). Không có nó thì một bản vá hỏng kiểu *"luôn trả về nhà máy 1"* sẽ
 * XANH ở mọi ca chặn — vì A tình cờ luôn thắng.
 *
 * ⚠⚠ **§ĐỘT BIẾN ở cuối file là điều kiện để mọi ca trên có nghĩa.** Nó ép
 * `factoryIdCanThuHep` trả `null` (= "không áp cổng nào") — tái dựng **CHÍNH XÁC** hình dạng lỗi
 * cũ, nơi `validateAccess` phân giải ra máy rồi nơi gọi vứt danh tính đi — và đòi các ca kia
 * ĐỎ trở lại. Một cổng không đột biến được thì xanh **không chứng minh gì**.
 *
 * ⚠ DỌN DẸP: `product_inspections` là bảng **WORM** — vai `avi_app` chỉ có SELECT/INSERT/UPDATE
 * (đã kiểm `role_table_grants`), và nó có FK `ON DELETE RESTRICT` tới `machines`. Nên hàng kiểm
 * không xoá được, và máy/trạm/chuyền/xưởng/nhà-máy của lượt này cũng không. Dọn bằng đúng quyền
 * được cấp: TẮT máy + đẩy hàng ra khỏi mọi cửa sổ, rồi mới THỬ xoá và nuốt lỗi. Mọi phép đếm
 * dưới đây vì thế bám vào **mã có tiền tố `RUN` duy nhất**, không bao giờ vào số tuyệt đối của bảng.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import postgres from "postgres";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 90_000 });

const DB_URL = process.env.DATABASE_URL;
const RUN = `PPS${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 1e3)}`;

const KEY_A = `ppsA_${RUN}`;
const KEY_B = `ppsB_${RUN}`;
const MCODE_A = `${RUN}_MA`.slice(0, 50);
const MCODE_B = `${RUN}_MB`.slice(0, 50);
const STCODE_A = `${RUN}_SA`.slice(0, 50);
const STCODE_B = `${RUN}_SB`.slice(0, 50);

/** Ba sản phẩm của A, mỗi cái nối bằng **một đường KHÁC NHAU** — xem lý do ở ca `listProducts`. */
const PA_MAP = `${RUN}_PA_MAP`;
const PA_MPD = `${RUN}_PA_MPD`;
const PA_INSP = `${RUN}_PA_INSP`;
const PB_MAP = `${RUN}_PB_MAP`;
const PB_INSP = `${RUN}_PB_INSP`;

/** Mã điểm đo DÙNG CHUNG cho cả hai nhà máy — `(productModelId, code)` mới là khoá, `code` thì không. */
const PT_CHUNG = "PT1";
/** Điểm đo của B **KHÔNG gắn máy nào** — đạn cho lối lùi "tra theo `code` toàn hệ". */
const PT_MO_COI_B = `${RUN}_FB`.slice(0, 50);

const ANH = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

/**
 * ⚠ `vitest.setup.ts` chỉ ép `DATABASE_URL`; nó KHÔNG nạp `MASTER_API_KEY` từ `.env`. Đọc thẳng
 * `process.env.MASTER_API_KEY` ở đây từng cho `undefined` ⇒ zod `.refine` từ chối input TRƯỚC khi
 * chạm `validateAccess`, và ca "toàn cục" khi ấy ĐỎ vì một lý do chẳng liên quan gì tới phạm vi.
 * Nên khoá được ĐẶT tường minh cho lượt chạy (và trả lại nguyên trạng ở `afterAll`).
 * `isValidMasterKey` đọc `process.env` tại thời điểm gọi (`getSecretSync`), nên cách này hiệu lực.
 */
const MASTER = process.env.MASTER_API_KEY || `pps-master-${RUN}`;
const MASTER_CU = process.env.MASTER_API_KEY;

let sql: ReturnType<typeof postgres>;
const id = {
  facA: 0, facB: 0, wsA: 0, wsB: 0, lineA: 0, lineB: 0, stA: 0, stB: 0, machA: 0, machB: 0,
  paMap: 0, paMpd: 0, paInsp: 0, pbMap: 0, pbInsp: 0,
  pdA: 0, pdB: 0, pdMoCoiB: 0, pdMpdA: 0,
  inspA: 0, inspB: 0,
};

/** Chạy một lệnh dọn, nuốt lỗi — WORM/FK có thể chặn, đã có đường dọn thay thế. */
async function safe(run: () => Promise<unknown>): Promise<void> {
  try { await run(); } catch { /* xem docblock §DỌN DẸP */ }
}

const CTX = { user: null } as never;

/** Router THẬT (không mock) — mỗi lần gọi đi qua đúng đồ thị nhập của sản phẩm. */
const goi = async () => (await import("./publicProductApiRouter")).publicProductApiRouter.createCaller(CTX);

/** Bắt lỗi của một lời gọi và trả về `{ code, message }` — `null` nếu KHÔNG ném. */
async function loiCua(fn: () => Promise<unknown>): Promise<{ code: string; message: string } | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    const err = e as { code?: string; message?: string };
    return { code: String(err.code ?? ""), message: String(err.message ?? "") };
  }
}

describe.skipIf(!DB_URL)("phạm vi nhà máy của publicProductApiRouter — CSDL THẬT, hai nhà máy", () => {
  beforeAll(async () => {
    process.env.MASTER_API_KEY = MASTER;
    sql = postgres(DB_URL!, { max: 1, connect_timeout: 30, onnotice: () => {} });
    const one = async (q: Promise<Array<{ id: number | string }>>) => Number((await q)[0].id);

    // ── Hai cây phân cấp HOÀN TOÀN RỜI NHAU ──────────────────────────────────────────────────
    id.facA = await one(sql`INSERT INTO factories (code, name, "isActive") VALUES (${RUN + "_FA"}, 'PPS factory A', true) RETURNING id`);
    id.facB = await one(sql`INSERT INTO factories (code, name, "isActive") VALUES (${RUN + "_FB"}, 'PPS factory B', true) RETURNING id`);
    id.wsA = await one(sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${id.facA}, ${RUN + "_WA"}, 'wsA') RETURNING id`);
    id.wsB = await one(sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${id.facB}, ${RUN + "_WB"}, 'wsB') RETURNING id`);
    id.lineA = await one(sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${id.wsA}, ${RUN + "_LA"}, 'lineA') RETURNING id`);
    id.lineB = await one(sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${id.wsB}, ${RUN + "_LB"}, 'lineB') RETURNING id`);
    id.stA = await one(sql`INSERT INTO stations ("lineId", code, name) VALUES (${id.lineA}, ${STCODE_A}, 'stA') RETURNING id`);
    id.stB = await one(sql`INSERT INTO stations ("lineId", code, name) VALUES (${id.lineB}, ${STCODE_B}, 'stB') RETURNING id`);
    id.machA = await one(sql`INSERT INTO machines ("stationId", code, name, "machineType", "apiKey", "isActive")
                             VALUES (${id.stA}, ${MCODE_A}, 'machA', 'AOI', ${KEY_A}, true) RETURNING id`);
    id.machB = await one(sql`INSERT INTO machines ("stationId", code, name, "machineType", "apiKey", "isActive")
                             VALUES (${id.stB}, ${MCODE_B}, 'machB', 'AOI', ${KEY_B}, true) RETURNING id`);

    // ── Sản phẩm ─────────────────────────────────────────────────────────────────────────────
    const mkProd = (code: string) => one(sql`
      INSERT INTO product_models (code, name, "lifecycleStatus", "isActive", "referenceImageUrl")
      VALUES (${code}, ${"PPS " + code}, 'active', true, ${ANH}) RETURNING id`);
    id.paMap = await mkProd(PA_MAP);
    id.paMpd = await mkProd(PA_MPD);
    id.paInsp = await mkProd(PA_INSP);
    id.pbMap = await mkProd(PB_MAP);
    id.pbInsp = await mkProd(PB_INSP);

    // ── ĐƯỜNG 1: product_machine_mappings ────────────────────────────────────────────────────
    await sql`INSERT INTO product_machine_mappings ("productModelId", "machineId", "isActive") VALUES (${id.paMap}, ${id.machA}, true)`;
    await sql`INSERT INTO product_machine_mappings ("productModelId", "machineId", "isActive") VALUES (${id.pbMap}, ${id.machB}, true)`;

    // ── ĐƯỜNG 2: measurement_point_defs."machineId" ──────────────────────────────────────────
    const mkPoint = (productModelId: number, machineId: number | null, code: string) => one(sql`
      INSERT INTO measurement_point_defs ("productModelId", "machineId", code, name, "measurementType",
                                          "positionX", "positionY", "isActive", "referenceImageUrl")
      VALUES (${productModelId}, ${machineId}, ${code}, ${"pt " + code}, 'DIMENSION', 10, 10, true, ${ANH}) RETURNING id`);
    id.pdMpdA = await mkPoint(id.paMpd, id.machA, `${RUN}_MPA`);
    // Điểm đo cho hai ca theo TRẠM. ⚠ CÙNG `code` ở hai nhà máy — có chủ ý: `code` KHÔNG duy nhất
    // toàn hệ (chỉ mục là `(productModelId, code)`), nên một cổng đọc theo `code` mà quên nhà máy
    // sẽ trả nhầm hàng của bên kia, và ca "lối lùi mồ côi" bên dưới bắt đúng chuyện đó.
    id.pdA = await mkPoint(id.paMap, id.machA, PT_CHUNG);
    id.pdB = await mkPoint(id.pbMap, id.machB, PT_CHUNG);
    id.pdMoCoiB = await mkPoint(id.pbMap, null, PT_MO_COI_B);

    // ── ĐƯỜNG 3: product_inspections ─────────────────────────────────────────────────────────
    const mkInsp = (machineId: number, productModelId: number, sn: string) => one(sql`
      INSERT INTO product_inspections ("machineId", "productModelId", "serialNumber", "overallResult",
                                       "originalResult", "inspectionTime")
      VALUES (${machineId}, ${productModelId}, ${sn}, 'OK', 'OK', NOW() - interval '1 hour') RETURNING id`);
    await mkInsp(id.machA, id.paInsp, `${RUN}-SN-A0`);
    await mkInsp(id.machB, id.pbInsp, `${RUN}-SN-B0`);
    id.inspA = await mkInsp(id.machA, id.paMap, `${RUN}-SN-A1`);
    id.inspB = await mkInsp(id.machB, id.pbMap, `${RUN}-SN-B1`);

    // Ảnh đo THỰC TẾ — nguồn của `getPointImagesByStation` và `getPointStatsByStation`.
    await sql`INSERT INTO measurement_results ("inspectionId", "pointDefId", result, "measuredValue", "imageUrl")
              VALUES (${id.inspA}, ${id.pdA}, 'OK', 1.0, ${"data:image/png;base64,AAAA-" + RUN + "-A"})`;
    await sql`INSERT INTO measurement_results ("inspectionId", "pointDefId", result, "measuredValue", "imageUrl")
              VALUES (${id.inspB}, ${id.pdB}, 'NG', 9.0, ${"data:image/png;base64,AAAA-" + RUN + "-B"})`;
  });

  afterAll(async () => {
    if (MASTER_CU === undefined) delete process.env.MASTER_API_KEY;
    else process.env.MASTER_API_KEY = MASTER_CU;
    if (!sql) return;
    // TẮT máy trước (xoá bị FK RESTRICT của `product_inspections` chặn) — máy còn sống sẽ bị các
    // lượt chạy khác (`getAllMachinesOEELive`, đội thiết bị…) nhặt lại và làm nhiễu phép đếm của họ.
    await safe(() => sql`UPDATE machines SET "isActive" = false, "apiKey" = NULL WHERE id IN ${sql([id.machA, id.machB])}`);
    await safe(() => sql`UPDATE product_inspections SET "inspectionTime" = '1990-01-01T00:00:00Z'
                         WHERE "serialNumber" LIKE ${RUN + "-SN-%"}`);
    await safe(() => sql`DELETE FROM measurement_results WHERE "inspectionId" IN ${sql([id.inspA, id.inspB])}`);
    await safe(() => sql`DELETE FROM product_inspections WHERE "serialNumber" LIKE ${RUN + "-SN-%"}`);
    await safe(() => sql`DELETE FROM measurement_point_defs WHERE "productModelId" IN
                         ${sql([id.paMap, id.paMpd, id.paInsp, id.pbMap, id.pbInsp])}`);
    await safe(() => sql`DELETE FROM product_machine_mappings WHERE "machineId" IN ${sql([id.machA, id.machB])}`);
    await safe(() => sql`DELETE FROM product_models WHERE code LIKE ${RUN + "%"}`);
    await safe(() => sql`DELETE FROM machines WHERE id IN ${sql([id.machA, id.machB])}`);
    await safe(() => sql`DELETE FROM stations WHERE id IN ${sql([id.stA, id.stB])}`);
    await safe(() => sql`DELETE FROM production_lines WHERE id IN ${sql([id.lineA, id.lineB])}`);
    await safe(() => sql`DELETE FROM workshops WHERE id IN ${sql([id.wsA, id.wsB])}`);
    await safe(() => sql`DELETE FROM factories WHERE id IN ${sql([id.facA, id.facB])}`);
    await sql.end();
  });

  // ════════════════════════════════════════════════════════════════════════════════════════════
  // 1. listProducts — DƯƠNG, ÂM, ÂM ĐỐI XỨNG, và TOÀN CỤC
  // ════════════════════════════════════════════════════════════════════════════════════════════

  const ma = async (arg: Record<string, unknown>): Promise<string[]> => {
    const r = await (await goi()).listProducts({ search: RUN, limit: 100, ...arg } as never);
    return (r.data as Array<{ code: string }>).map((p) => p.code).sort();
  };

  it("★★★ listProducts — A thấy ĐỦ BA đường liên kết của A và KHÔNG thấy gì của B", async () => {
    // ⚠ Ba sản phẩm của A cố ý nối bằng BA đường KHÁC NHAU. Nếu cả ba cùng nối bằng
    //   `product_machine_mappings` thì bỏ hai nhánh còn lại của vị từ vẫn ra đúng 3 — tức hai
    //   phần ba cái cổng KHÔNG được lưới nào canh, và một lượt "vá quá tay thành chặn nhầm" sẽ
    //   lọt qua trong im lặng.
    expect(await ma({ machineCode: MCODE_A })).toEqual([PA_INSP, PA_MAP, PA_MPD].sort());
  });

  it("★★★ listProducts — ÂM ĐỐI XỨNG: B ra đúng của B (loại khả năng 'A tình cờ luôn thắng')", async () => {
    expect(await ma({ machineCode: MCODE_B })).toEqual([PB_INSP, PB_MAP].sort());
  });

  it("listProducts — khoá API (BÍ MẬT) cho ra ĐÚNG CÙNG tập với mã máy (một trục, hai lối vào)", async () => {
    expect(await ma({ apiKey: KEY_A })).toEqual(await ma({ machineCode: MCODE_A }));
    expect(await ma({ apiKey: KEY_B })).toEqual(await ma({ machineCode: MCODE_B }));
  });

  it("listProducts — `scopeApplied` nói ĐÚNG SỰ THẬT (0 dòng im lặng là nói dối)", async () => {
    const r = await (await goi()).listProducts({ machineCode: MCODE_A, search: RUN, limit: 100 } as never);
    expect(r.scopeApplied).toBe(true);
  });

  // ════════════════════════════════════════════════════════════════════════════════════════════
  // 2. Bốn thủ tục tra-theo-KHOÁ: phải NÉM, không được trả rỗng
  // ════════════════════════════════════════════════════════════════════════════════════════════

  it("★★★ getProductByCode — A đọc được của A; hỏi sản phẩm của B thì bị TỪ CHỐI (không phải rỗng)", async () => {
    const ok = await (await goi()).getProductByCode({ machineCode: MCODE_A, code: PA_MAP } as never);
    expect(ok.data.product.code).toBe(PA_MAP);

    const loi = await loiCua(async () => (await goi()).getProductByCode({ machineCode: MCODE_A, code: PB_MAP } as never));
    expect(loi?.code).toBe("FORBIDDEN");
    // Mã MÁY-ĐỌC-ĐƯỢC phải có mặt trong câu: cửa REST `/api/public/**` KHÔNG chở `appCode` ra ngoài.
    expect(loi?.message).toContain("machine_factory_scope_denied");
  });

  it("getProductByCode — ÂM ĐỐI XỨNG: B đọc được của B, bị chặn ở của A", async () => {
    const ok = await (await goi()).getProductByCode({ machineCode: MCODE_B, code: PB_MAP } as never);
    expect(ok.data.product.code).toBe(PB_MAP);
    expect((await loiCua(async () => (await goi()).getProductByCode({ machineCode: MCODE_B, code: PA_MAP } as never)))?.code).toBe("FORBIDDEN");
  });

  it("getProductById — cùng luật khi tra theo ID (id là khoá TOÀN CỤC, không mang nhà máy)", async () => {
    expect((await (await goi()).getProductById({ machineCode: MCODE_A, id: id.paMap } as never)).data.product.code).toBe(PA_MAP);
    expect((await loiCua(async () => (await goi()).getProductById({ machineCode: MCODE_A, id: id.pbMap } as never)))?.code).toBe("FORBIDDEN");
  });

  it("getMeasurementPoints — điểm đo đi theo phán quyết của SẢN PHẨM", async () => {
    const ok = await (await goi()).getMeasurementPoints({ machineCode: MCODE_A, productCode: PA_MAP } as never);
    expect(ok.total).toBeGreaterThan(0);
    expect((await loiCua(async () => (await goi()).getMeasurementPoints({ machineCode: MCODE_A, productCode: PB_MAP } as never)))?.code).toBe("FORBIDDEN");
  });

  it("getProductImage — cổng đứng TRƯỚC lượt đọc ảnh, không phải sau", async () => {
    const ok = await (await goi()).getProductImage({ machineCode: MCODE_A, productCode: PA_MAP } as never);
    expect(ok.data.imageUrl).toBe(ANH);
    const loi = await loiCua(async () => (await goi()).getProductImage({ machineCode: MCODE_A, productCode: PB_MAP } as never));
    // ⚠ Đòi ĐÚNG `FORBIDDEN`: nếu cổng bị đặt SAU khối "sản phẩm không có ảnh" thì lỗi sẽ là
    //   `NOT_FOUND`, và câu trả lời ấy đã lộ ra rằng sản phẩm của B CÓ hay KHÔNG có ảnh.
    expect(loi?.code).toBe("FORBIDDEN");
  });

  it("★★ getPointImage — lối `pointId` (bỏ qua hoàn toàn nhánh `productCode`) cũng bị chặn", async () => {
    const ok = await (await goi()).getPointImage({ machineCode: MCODE_A, pointId: id.pdA } as never);
    expect(ok.data.pointId).toBe(id.pdA);
    const loi = await loiCua(async () => (await goi()).getPointImage({ machineCode: MCODE_A, pointId: id.pdB } as never));
    expect(loi?.code).toBe("FORBIDDEN");
    expect(loi?.message).toContain("machine_factory_scope_denied");
  });

  // ════════════════════════════════════════════════════════════════════════════════════════════
  // 3. Hai thủ tục theo TRẠM
  // ════════════════════════════════════════════════════════════════════════════════════════════

  it("★★★ getPointStatsByStation — A đọc trạm của A; trạm của B bị TỪ CHỐI (không phải 0 dòng)", async () => {
    const ok = await (await goi()).getPointStatsByStation({ machineCode: MCODE_A, stationCode: STCODE_A } as never);
    expect(ok.scopeApplied).toBe(true);
    expect(ok.data.length).toBeGreaterThan(0);

    const loi = await loiCua(async () => (await goi()).getPointStatsByStation({ machineCode: MCODE_A, stationCode: STCODE_B } as never));
    expect(loi?.code).toBe("FORBIDDEN");
    expect(loi?.message).toContain("machine_factory_scope_denied");
  });

  it("getPointStatsByStation — ÂM ĐỐI XỨNG: B đọc trạm của B, bị chặn ở trạm của A", async () => {
    expect((await (await goi()).getPointStatsByStation({ machineCode: MCODE_B, stationCode: STCODE_B } as never)).data.length).toBeGreaterThan(0);
    expect((await loiCua(async () => (await goi()).getPointStatsByStation({ machineCode: MCODE_B, stationCode: STCODE_A } as never)))?.code).toBe("FORBIDDEN");
  });

  it("★★ getPointStatsByStation — trạm ĐÚNG nhà máy + `productCode` của nhà máy KHÁC vẫn bị chặn", async () => {
    // Lối lùi "pointDefs theo productModelId" đọc `measurement_point_defs` KHÔNG qua `machineId`,
    // nên chặn ở mức trạm là CHƯA ĐỦ — đây là cái cổng thứ hai của chính thủ tục ấy.
    const loi = await loiCua(async () =>
      (await goi()).getPointStatsByStation({ machineCode: MCODE_A, stationCode: STCODE_A, productCode: PB_MAP } as never));
    expect(loi?.code).toBe("FORBIDDEN");
  });

  it("★★★ getPointImagesByStation — A chỉ thấy ảnh đo của A", async () => {
    const r = await (await goi()).getPointImagesByStation({
      machineCode: MCODE_A, stationCode: STCODE_A, pointCode: PT_CHUNG,
    } as never);
    expect(r.point?.id).toBe(id.pdA);
    expect(r.data.map((x: { imageUrl: string }) => x.imageUrl)).toEqual([`data:image/png;base64,AAAA-${RUN}-A`]);
  });

  it("getPointImagesByStation — ÂM ĐỐI XỨNG: B ra đúng ảnh của B (cùng `pointCode`, hàng KHÁC)", async () => {
    const r = await (await goi()).getPointImagesByStation({
      machineCode: MCODE_B, stationCode: STCODE_B, pointCode: PT_CHUNG,
    } as never);
    expect(r.point?.id).toBe(id.pdB);
    expect(r.data.map((x: { imageUrl: string }) => x.imageUrl)).toEqual([`data:image/png;base64,AAAA-${RUN}-B`]);
  });

  it("★★★ getPointImagesByStation — LỐI LÙI tra theo `code` TOÀN HỆ không còn kéo được điểm đo của B", async () => {
    // `pdMoCoiB` thuộc sản phẩm của B và KHÔNG gắn máy nào ⇒ nhánh "theo máy của trạm" trượt, và
    // luồng rơi vào lối lùi vốn chỉ lọc `code` + `isActive`. Đó là lượt đọc RỘNG NHẤT của router.
    const loi = await loiCua(async () => (await goi()).getPointImagesByStation({
      machineCode: MCODE_A, stationCode: STCODE_A, pointCode: PT_MO_COI_B,
    } as never));
    expect(loi?.code).toBe("NOT_FOUND");

    // ⚠ Chiều DƯƠNG bắt buộc: hàng ấy CÓ THẬT và tra được — nếu không, ca trên sẽ xanh vì dữ liệu
    //   không tồn tại chứ không vì cái cổng, tức một lời khai đúng về THỨ KHÁC.
    const toanCuc = await (await goi()).getPointImagesByStation({
      masterKey: MASTER, stationCode: STCODE_A, pointCode: PT_MO_COI_B,
    } as never);
    expect(toanCuc.point?.id).toBe(id.pdMoCoiB);
  });

  // ════════════════════════════════════════════════════════════════════════════════════════════
  // 4. masterKey = TOÀN CỤC TƯỜNG MINH
  // ════════════════════════════════════════════════════════════════════════════════════════════

  it("★★ masterKey — KHÔNG bị thu hẹp, và đó là một QUYẾT ĐỊNH CÓ TÊN (`kieu: 'toanCuc'`)", async () => {
    const codes = await ma({ masterKey: MASTER });
    expect(codes).toEqual([PA_INSP, PA_MAP, PA_MPD, PB_INSP, PB_MAP].sort());
    const r = await (await goi()).listProducts({ masterKey: MASTER, search: RUN, limit: 100 } as never);
    expect(r.scopeApplied).toBe(false);
    // Chiều dương thứ hai: khoá toàn cục đọc được sản phẩm của CẢ HAI bên qua đường tra-theo-khoá.
    expect((await (await goi()).getProductByCode({ masterKey: MASTER, code: PB_MAP } as never)).data.product.code).toBe(PB_MAP);
  });

  it("masterKey SAI vẫn bị chặn ở cửa (bản vá phạm vi không được nới lỏng phép xác thực)", async () => {
    expect((await loiCua(async () => (await goi()).listProducts({ masterKey: "sai-be-bet", limit: 10 } as never)))?.code).toBe("UNAUTHORIZED");
  });

  // ════════════════════════════════════════════════════════════════════════════════════════════
  // 4b. ★★★ TUYẾN **EXPRESS** `reference-image-file` — LỖ THỨ CHÍN, nay có lưới TỰ ĐỘNG
  // ════════════════════════════════════════════════════════════════════════════════════════════
  /**
   * ⚠⚠⚠ **CÁI Ô NÀY CHỨNG MINH GÌ — VÀ KHÔNG CHỨNG MINH GÌ.** Đọc trước khi tin nó.
   *
   * `GET /api/public/products/:productCode/reference-image-file` (`server/_core/index.ts`) là lỗ
   * **THỨ CHÍN**: cùng dữ liệu, cùng người gọi, cùng ba chứng thực như 8 thủ tục ở trên, nhưng đi
   * bằng Express nên **không** nằm trong bản điều tra dân số tRPC. Nó đã được vá bằng đúng hai hàm
   * ở đây (`phamViNhaMayCuaMay` → `factoryIdCanThuHep` → `sanPhamTrongNhaMay`), và cho tới hôm nay
   * bằng chứng duy nhất là **một lượt gọi HTTP THỦ CÔNG** — tức một cổng sẽ mục ngay khi không ai
   * nhớ.
   *
   * ✔ CHỨNG MINH: **PHÁN QUYẾT** mà tuyến ấy dựa vào là đúng trên CSDL thật, hai nhà máy, **có ÂM
   *   ĐỐI XỨNG** (A không thấy của B **và** B ra đúng của B). Đây là phép so đắt nhất trong chuỗi
   *   — nó chạm Postgres, nên nó nói được cả `42P01`/`42809`/sai tên cột.
   * ✘ **KHÔNG** chứng minh gì ở tầng **HTTP**: nó không mở socket, không đi qua Express, không
   *   phát biểu về mã trạng thái 403 hay `Content-Type`. Nó cũng KHÔNG chứng minh rằng handler
   *   **có gọi** chuỗi này.
   * ⇒ Vế còn thiếu ấy do một lưới KHÁC canh: `phamViTuyenCensus.test.ts` §6 đọc chính cây cú pháp
   *   của handler và đòi danh tính phải đi vào một lượt đọc **không phải bộ phân giải** (BẬC 3).
   *   Đã đo: vô hiệu hoá đúng dòng `sanPhamTrongNhaMay(…)` trong handler ⇒ ô §6 ấy **ĐỎ**.
   *   Hai lưới cộng lại ≈ hành vi của tuyến, TRỪ tầng HTTP. Tầng HTTP vẫn là việc của người.
   */
  const quyetDinhTuyenAnh = async (
    machineCode: string,
    productCode: string,
  ): Promise<{ factoryId: number | null; choPhep: boolean }> => {
    const { phamViNhaMayCuaMay, factoryIdCanThuHep, sanPhamTrongNhaMay } = await import("./publicProductScope");
    const { getMachineByCode, getProductModelByCode } = await import("../db");
    const machine = await getMachineByCode(machineCode);
    if (!machine) throw new Error(`fixture hỏng: không thấy máy ${machineCode}`);
    const factoryId = factoryIdCanThuHep(await phamViNhaMayCuaMay(machine));
    const product = await getProductModelByCode(productCode);
    if (!product) throw new Error(`fixture hỏng: không thấy sản phẩm ${productCode}`);
    // ⚠ CHÉP ĐÚNG mệnh đề của handler, kể cả nhánh `factoryId === null` (khoá toàn cục).
    return { factoryId, choPhep: factoryId === null || (await sanPhamTrongNhaMay(product.id, factoryId)) };
  };

  it("★★★ reference-image-file — máy của A KHÔNG lấy được ảnh mẫu sản phẩm của B", async () => {
    const kq = await quyetDinhTuyenAnh(MCODE_A, PB_MAP);
    expect(kq.factoryId, "phạm vi phải phân giải ra ĐÚNG nhà máy A").toBe(id.facA);
    expect(kq.choPhep, "đây chính là lượt 200·image/png đã đo được TRƯỚC bản vá").toBe(false);
  });

  it("★★★ reference-image-file — ÂM ĐỐI XỨNG: B lấy được của B, và A lấy được của A", async () => {
    // Không có cặp này thì một bản vá hỏng kiểu "chặn tất cả" cũng XANH ở ca trên.
    expect((await quyetDinhTuyenAnh(MCODE_B, PB_MAP)).choPhep).toBe(true);
    expect((await quyetDinhTuyenAnh(MCODE_A, PA_MAP)).choPhep).toBe(true);
    // …và chiều ngược của ca chặn: B cũng không với sang được của A.
    expect((await quyetDinhTuyenAnh(MCODE_B, PA_MAP)).choPhep).toBe(false);
  });

  it("reference-image-file — CẢ BA đường liên kết của A đều mở được (chống vá quá tay)", async () => {
    for (const code of [PA_MAP, PA_MPD, PA_INSP]) {
      expect((await quyetDinhTuyenAnh(MCODE_A, code)).choPhep, `A phải mở được ${code}`).toBe(true);
    }
  });

  // ════════════════════════════════════════════════════════════════════════════════════════════
  // 5. ★★★ ĐỘT BIẾN — gỡ mệnh đề tenant, mọi ca trên PHẢI đỏ trở lại
  // ════════════════════════════════════════════════════════════════════════════════════════════

  describe("§ĐỘT BIẾN — không có ô này thì mọi ca trên xanh KHÔNG chứng minh gì", () => {
    /**
     * Đột biến được chọn là `factoryIdCanThuHep → () => null`, tức **"không áp cổng nào"**. Nó tái
     * dựng CHÍNH XÁC hình dạng lỗi cũ: `validateAccess` vẫn phân giải ra máy, nhưng nơi gọi không
     * dùng danh tính ấy để lọc. Mọi thứ khác (xác thực, truy vấn, hình dạng trả về) giữ nguyên,
     * nên nếu ba lời khai dưới đây KHÔNG lật thì cổng chưa bao giờ là thứ đang chặn.
     */
    const goiDotBien = async () => {
      vi.resetModules();
      vi.doMock("./publicProductScope", async (goc) => ({
        ...(await (goc as () => Promise<Record<string, unknown>>)()),
        factoryIdCanThuHep: () => null,
      }));
      const m = await import("./publicProductApiRouter");
      return m.publicProductApiRouter.createCaller(CTX);
    };

    afterAll(() => {
      vi.doUnmock("./publicProductScope");
      vi.resetModules();
    });

    it("★★★ đột biến ÁP ĐƯỢC và ba lời khai LẬT: danh sách rò · tra-theo-khoá thôi từ chối · trạm mở toang", async () => {
      const caller = await goiDotBien();

      // (a) danh sách: A nay thấy CẢ sản phẩm của B — đúng lỗ cũ.
      const r = await caller.listProducts({ machineCode: MCODE_A, search: RUN, limit: 100 } as never);
      const codes = (r.data as Array<{ code: string }>).map((p) => p.code).sort();
      expect(codes, "ĐỘT BIẾN KHÔNG ÁP ĐƯỢC — mọi ca xanh phía trên vô nghĩa").toEqual(
        [PA_INSP, PA_MAP, PA_MPD, PB_INSP, PB_MAP].sort(),
      );
      expect(r.scopeApplied).toBe(false);

      // (b) tra theo khoá: không còn ném.
      const sp = await caller.getProductByCode({ machineCode: MCODE_A, code: PB_MAP } as never);
      expect(sp.data.product.code).toBe(PB_MAP);

      // (c) theo trạm: trạm của B trả dữ liệu cho máy của A.
      const st = await caller.getPointStatsByStation({ machineCode: MCODE_A, stationCode: STCODE_B } as never);
      expect(st.success).toBe(true);
      expect(st.scopeApplied).toBe(false);
    });
  });
});
