/**
 * ★★★ 2026-08-18 — **ĐƯỜNG GHI: mã tenant suy từ MÁY, trên CSDL THẬT, HAI NHÀ MÁY.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * VÌ SAO PHẢI CHẠM CSDL THẬT — VÀ VÌ SAO PHẢI DỰNG **HAI** NHÀ MÁY
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * Cái được canh ở đây là một chuỗi bốn chặng (`machine → station → line → workshop → factory`)
 * cộng một lượt INSERT thật vào `product_inspections`. Một lưới giả lập `getDb` không phát biểu
 * được "hàng ĐÃ GHI mang mã nào" — nó chỉ phát biểu được "hàm đã được gọi", và repo này đã trả
 * giá nhiều lần cho đúng khoảng cách ấy.
 *
 * ⚠⚠ **ÂM ĐỐI XỨNG là bắt buộc, không phải cho đủ bộ.** Trên `aoi_management(_test)` mọi máy có
 * sẵn đều thuộc nhà máy 1 (`SIM-FAC`), nên một bản vá hỏng kiểu *"luôn trả về nhà máy 1"* sẽ
 * XANH ở mọi ca chặn — vì A tình cờ luôn thắng. Mỗi ca chặn dưới đây vì thế có ca sinh đôi ở
 * chiều ngược (B khai của B ⇒ **PHẢI NHẬN**), và chiều dương ấy cũng chính là lưới chống **vá
 * quá tay**: một bản vá "từ chối tất" sẽ ĐỎ ngay.
 *
 * ⚠⚠ **§ĐỘT BIẾN ở cuối file là điều kiện để mọi ca trên có nghĩa.** Ba đột biến tái dựng CHÍNH
 * XÁC ba hình dạng lỗi: (a) bỏ phép đối chiếu, (b) cho NULL đi qua thay vì từ chối, (c) từ chối
 * cả máy khai ĐÚNG. Một cổng không đột biến được thì xanh **không chứng minh gì**.
 *
 * ⚠ DỌN DẸP: `product_inspections` là bảng WORM + có FK `ON DELETE RESTRICT` tới `machines`. Dọn
 * bằng đúng quyền được cấp: đẩy hàng ra khỏi mọi cửa sổ thời gian + tắt máy, rồi mới THỬ xoá và
 * nuốt lỗi. Mọi phép đếm bám vào **tiền tố `RUN` duy nhất**, không bao giờ vào số tuyệt đối.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import postgres from "postgres";
// ── Xác thực: KHAI BÁO TƯỜNG MINH, không mượn mặc định ───────────────────────────
// Các ca trong file này đo LOGIC INGEST (gate, phân loại lỗi, phạm vi ghi…), không đo
// xác thực. Từ 2026-08-22 (mig 0334) hai đường yếu mặc định `deny`, nên nền mà chúng
// vẫn ngầm dựa vào không còn nữa.
//
// ⚠ Một bộ test mượn mặc định ngầm là một bộ test sẽ NÓI DỐI vào ngày mặc định đổi:
// nó đỏ vì một lý do hoàn toàn khác thứ nó đang canh, và người đọc kết quả sẽ đi sửa
// nhầm chỗ. Khai ra đây thì mỗi file tự nói mình đang đứng trên nền nào.
//
// Đường MẠNH (khoá `mk_` riêng từng máy) có test riêng, KHÔNG bị nới ở đây:
//   server/routers/machineApiBatchIngest.test.ts
process.env.MACHINE_SHARED_KEY_ALLOWED = "true";
process.env.MACHINE_CODE_ONLY_ALLOWED = "true";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 90_000 });

const DB_URL = process.env.DATABASE_URL;
const RUN = `PGM${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 1e3)}`;

const MCODE_A = `${RUN}_MA`.slice(0, 50);
const MCODE_B = `${RUN}_MB`.slice(0, 50);
const FAC_A = `${RUN}_FA`.slice(0, 50);
const FAC_B = `${RUN}_FB`.slice(0, 50);
const WS_A = `${RUN}_WA`.slice(0, 50);
const WS_B = `${RUN}_WB`.slice(0, 50);
const LINE_A = `${RUN}_LA`.slice(0, 50);
const LINE_B = `${RUN}_LB`.slice(0, 50);
const ST_A = `${RUN}_SA`.slice(0, 50);
const ST_B = `${RUN}_SB`.slice(0, 50);
/** Tập đoàn CHỈ gắn cho A — B cố ý KHÔNG có, để đo nhánh "lời khai không kiểm chứng được". */
const CORP_A = `${RUN}_CA`.slice(0, 50);

let sql: ReturnType<typeof postgres>;
const id = { facA: 0, facB: 0, wsA: 0, wsB: 0, lineA: 0, lineB: 0, stA: 0, stB: 0, machA: 0, machB: 0 };

async function safe(run: () => Promise<unknown>): Promise<void> {
  try { await run(); } catch { /* xem docblock §DỌN DẸP */ }
}

/** Đường ingest THẬT (không mock) — mỗi lượt đi qua đúng đồ thị nhập của router máy. */
const nopBo = async (mCode: string, sn: string, khai: Record<string, unknown> = {}) => {
  const { processInspectionSubmission } = await import("./machineApiRouters");
  return processInspectionSubmission({
    machineCode: mCode,
    serialNumber: sn,
    overallResult: "OK",
    inspectionTime: new Date("2026-08-18T03:00:00Z").toISOString(),
    measurements: [],
    ...khai,
  } as never);
};

/** Bắt lỗi của một lời gọi — `null` nếu KHÔNG ném. */
async function loiCua(fn: () => Promise<unknown>): Promise<{ code: string; message: string } | null> {
  try {
    await fn();
    return null;
  } catch (e) {
    const err = e as { code?: string; message?: string };
    return { code: String(err.code ?? ""), message: String(err.message ?? "") };
  }
}

/** Hàng ĐÃ GHI — nguồn sự thật duy nhất của mọi ca dưới đây. */
async function hangCua(sn: string) {
  const r = await sql`
    SELECT "corporateCode", "factoryCode", "workshopCode", "lineCode", "stageCode"
    FROM product_inspections WHERE "serialNumber" = ${sn} LIMIT 1`;
  return r[0] as
    | { corporateCode: string | null; factoryCode: string | null; workshopCode: string | null; lineCode: string | null; stageCode: string | null }
    | undefined;
}

describe.skipIf(!DB_URL)("đường GHI: mã tenant suy từ máy — CSDL THẬT, hai nhà máy", () => {
  beforeAll(async () => {
    sql = postgres(DB_URL!, { max: 1, connect_timeout: 30, onnotice: () => {} });
    const one = async (q: Promise<Array<{ id: number | string }>>) => Number((await q)[0].id);

    await sql`INSERT INTO corporates (code, name) VALUES (${CORP_A}, 'PGM corp A') ON CONFLICT (code) DO NOTHING`;
    // ⚠ A CÓ tập đoàn, B KHÔNG — hai nhánh khác nhau của luật `corporateCode`, cả hai đều được đo.
    id.facA = await one(sql`INSERT INTO factories (code, name, "corporateCode", "isActive") VALUES (${FAC_A}, 'PGM factory A', ${CORP_A}, true) RETURNING id`);
    id.facB = await one(sql`INSERT INTO factories (code, name, "isActive") VALUES (${FAC_B}, 'PGM factory B', true) RETURNING id`);
    id.wsA = await one(sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${id.facA}, ${WS_A}, 'wsA') RETURNING id`);
    id.wsB = await one(sql`INSERT INTO workshops ("factoryId", code, name) VALUES (${id.facB}, ${WS_B}, 'wsB') RETURNING id`);
    id.lineA = await one(sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${id.wsA}, ${LINE_A}, 'lineA') RETURNING id`);
    id.lineB = await one(sql`INSERT INTO production_lines ("workshopId", code, name) VALUES (${id.wsB}, ${LINE_B}, 'lineB') RETURNING id`);
    id.stA = await one(sql`INSERT INTO stations ("lineId", code, name) VALUES (${id.lineA}, ${ST_A}, 'stA') RETURNING id`);
    id.stB = await one(sql`INSERT INTO stations ("lineId", code, name) VALUES (${id.lineB}, ${ST_B}, 'stB') RETURNING id`);
    id.machA = await one(sql`INSERT INTO machines ("stationId", code, name, "machineType", "isActive")
                             VALUES (${id.stA}, ${MCODE_A}, 'machA', 'AOI', true) RETURNING id`);
    id.machB = await one(sql`INSERT INTO machines ("stationId", code, name, "machineType", "isActive")
                             VALUES (${id.stB}, ${MCODE_B}, 'machB', 'AOI', true) RETURNING id`);
  });

  beforeEach(async () => {
    // Chuỗi phân cấp được nhớ đệm theo máy — một ca đột biến phải đọc lại CSDL, không đọc bộ nhớ.
    (await import("./phamViGhiMay"))._xoaBoNhoTenant();
    delete process.env.INGEST_TENANT_DERIVE_ENABLED;
  });

  afterAll(async () => {
    if (!sql) return;
    await safe(() => sql`DELETE FROM inspection_packages WHERE "packageId" LIKE ${RUN + "-%"}`);
    await safe(() => sql`UPDATE machines SET "isActive" = false WHERE id IN ${sql([id.machA, id.machB])}`);
    await safe(() => sql`UPDATE product_inspections SET "inspectionTime" = '1990-01-01T00:00:00Z'
                         WHERE "serialNumber" LIKE ${RUN + "-%"}`);
    await safe(() => sql`DELETE FROM measurement_results WHERE "inspectionId" IN
                         (SELECT id FROM product_inspections WHERE "serialNumber" LIKE ${RUN + "-%"})`);
    await safe(() => sql`DELETE FROM product_inspections WHERE "serialNumber" LIKE ${RUN + "-%"}`);
    await safe(() => sql`DELETE FROM machines WHERE id IN ${sql([id.machA, id.machB])}`);
    await safe(() => sql`DELETE FROM stations WHERE id IN ${sql([id.stA, id.stB])}`);
    await safe(() => sql`DELETE FROM production_lines WHERE id IN ${sql([id.lineA, id.lineB])}`);
    await safe(() => sql`DELETE FROM workshops WHERE id IN ${sql([id.wsA, id.wsB])}`);
    await safe(() => sql`DELETE FROM factories WHERE id IN ${sql([id.facA, id.facB])}`);
    await safe(() => sql`DELETE FROM corporates WHERE code = ${CORP_A}`);
    await sql.end();
  });

  // ════════════════════════════════════════════════════════════════════════════════════════════
  // 1. CHIỀU DƯƠNG — máy khai ĐÚNG mã của chính nó VẪN nộp được (chống vá quá tay)
  // ════════════════════════════════════════════════════════════════════════════════════════════

  it("★★★ DƯƠNG — máy A khai ĐÚNG bốn mã của chính nó ⇒ NHẬN, và hàng mang mã SUY RA", async () => {
    const sn = `${RUN}-DUONG-A`;
    const r = await nopBo(MCODE_A, sn, {
      companyCode: CORP_A, factoryCode: FAC_A, workshopCode: WS_A, lineCode: LINE_A, stageCode: "AOI",
    });
    expect((r as { success: boolean }).success).toBe(true);
    expect(await hangCua(sn)).toEqual({
      corporateCode: CORP_A, factoryCode: FAC_A, workshopCode: WS_A, lineCode: LINE_A, stageCode: "AOI",
    });
  });

  it("★★★ DƯƠNG — máy KHÔNG khai mã nào ⇒ vẫn NHẬN, và hàng vẫn ĐỦ MÃ (không một ô NULL)", async () => {
    // Đây là ca đóng đường hỏng #1: trước bản vá, một máy quên gửi mã ⇒ hàng NULL/NULL.
    const sn = `${RUN}-DUONG-TRONG`;
    await nopBo(MCODE_B, sn);
    const h = await hangCua(sn);
    expect(h?.factoryCode).toBe(FAC_B);
    expect(h?.workshopCode).toBe(WS_B);
    expect(h?.lineCode).toBe(LINE_B);
  });

  // ════════════════════════════════════════════════════════════════════════════════════════════
  // 2. ÂM + ÂM ĐỐI XỨNG — khai mã của nhà máy KHÁC ⇒ TỪ CHỐI, ở CẢ HAI CHIỀU
  // ════════════════════════════════════════════════════════════════════════════════════════════

  it("★★★ ÂM — máy của A khai `factoryCode` của B ⇒ TỪ CHỐI kèm mã máy-đọc-được", async () => {
    const sn = `${RUN}-AM-A-KHAI-B`;
    const loi = await loiCua(() => nopBo(MCODE_A, sn, { factoryCode: FAC_B }));
    expect(loi?.code).toBe("FORBIDDEN");
    expect(loi?.message).toContain("machine_tenant_claim_mismatch");
    expect(loi?.message).toContain(MCODE_A);
    // ⚠ Từ chối phải là từ chối THẬT: không hàng nào được nằm lại.
    expect(await hangCua(sn)).toBeUndefined();
  });

  it("★★★ ÂM ĐỐI XỨNG — máy của B khai `factoryCode` của A ⇒ TỪ CHỐI; khai của B ⇒ NHẬN", async () => {
    const loi = await loiCua(() => nopBo(MCODE_B, `${RUN}-AM-B-KHAI-A`, { factoryCode: FAC_A }));
    expect(loi?.code).toBe("FORBIDDEN");
    expect(loi?.message).toContain("machine_tenant_claim_mismatch");
    expect(await hangCua(`${RUN}-AM-B-KHAI-A`)).toBeUndefined();

    const sn = `${RUN}-DUONG-B`;
    await nopBo(MCODE_B, sn, { factoryCode: FAC_B });
    expect((await hangCua(sn))?.factoryCode).toBe(FAC_B);
  });

  it("ÂM — `workshopCode` và `lineCode` cũng bị đối chiếu, không chỉ `factoryCode`", async () => {
    const l1 = await loiCua(() => nopBo(MCODE_A, `${RUN}-AM-WS`, { workshopCode: WS_B }));
    expect(l1?.message).toContain("machine_tenant_claim_mismatch");
    expect(l1?.message).toContain("workshopCode");
    const l2 = await loiCua(() => nopBo(MCODE_A, `${RUN}-AM-LINE`, { lineCode: LINE_B }));
    expect(l2?.message).toContain("lineCode");
  });

  it("khai LỆCH HOA-THƯỜNG không phải là khai của nhà máy khác ⇒ NHẬN, ghi dạng CHUẨN", async () => {
    // Một máy gõ `'run_fa'` thay vì `'RUN_FA'` là lỗi chính tả, không phải máy của nhà máy khác;
    // bắt nó dừng dây chuyền không mua được gì. An toàn vẫn nguyên vì giá trị GHI là bản SUY RA.
    const sn = `${RUN}-HOA-THUONG`;
    await nopBo(MCODE_A, sn, { factoryCode: FAC_A.toLowerCase() });
    expect((await hangCua(sn))?.factoryCode).toBe(FAC_A);
  });

  // ════════════════════════════════════════════════════════════════════════════════════════════
  // 3. `corporateCode` — HAI nhánh, vì nó KHÔNG suy được như ba trục kia
  // ════════════════════════════════════════════════════════════════════════════════════════════

  it("★★ corporateCode — nhà máy CÓ mã tập đoàn: khai khác ⇒ TỪ CHỐI", async () => {
    const loi = await loiCua(() => nopBo(MCODE_A, `${RUN}-AM-CORP`, { companyCode: `${RUN}_KHAC` }));
    expect(loi?.code).toBe("FORBIDDEN");
    expect(loi?.message).toContain("corporateCode");
  });

  it("★★ corporateCode — nhà máy KHÔNG có mã tập đoàn: lời khai bị BỎ (cột NULL), KHÔNG ném", async () => {
    // Từ chối ở đây sẽ bắt cả đội máy ngừng nộp để đổi lấy đúng con số 0 về rủi ro:
    // `corporateCode` NULL kèm `factoryCode` THẬT là an toàn ở cả hai bảng
    // (`app_tenant_allows` chỉ mở khi CẢ HAI đối số NULL).
    const sn = `${RUN}-CORP-BO`;
    await nopBo(MCODE_B, sn, { companyCode: `${RUN}_BIA` });
    const h = await hangCua(sn);
    expect(h?.corporateCode).toBeNull();
    expect(h?.factoryCode).toBe(FAC_B); // ⚠ vẫn ghi được — không phải một lượt từ chối trá hình
  });

  // ════════════════════════════════════════════════════════════════════════════════════════════
  // 4. KHÔNG PHÂN GIẢI ĐƯỢC ⇒ TỪ CHỐI, KHÔNG lưu NULL
  // ════════════════════════════════════════════════════════════════════════════════════════════

  it("★★★ chuỗi phân cấp GÃY ⇒ TỪ CHỐI `machine_tenant_unresolved`, KHÔNG bao giờ trả mã rỗng", async () => {
    const { macTenantChoGhi } = await import("./phamViGhiMay");
    const loi = await loiCua(() =>
      macTenantChoGhi({ id: -424242, code: `${RUN}_MO_COI`, stationId: 2147483000 }, {}),
    );
    expect(loi?.code).toBe("FORBIDDEN");
    expect(loi?.message).toContain("machine_tenant_unresolved");
    expect(loi?.message).toContain(`${RUN}_MO_COI`);
  });

  // ════════════════════════════════════════════════════════════════════════════════════════════
  // 5. `stageCode` — KHÔNG suy được, và đó là KẾT LUẬN (đo được), không phải bỏ sót
  // ════════════════════════════════════════════════════════════════════════════════════════════

  it("stageCode đi NGUYÊN VĂN — nó không phải một nút phân cấp nên không có gì để đối chiếu", async () => {
    const sn = `${RUN}-STAGE`;
    await nopBo(MCODE_A, sn, { stageCode: "KHONG-PHAI-TRAM-NAO-CA" });
    expect((await hangCua(sn))?.stageCode).toBe("KHONG-PHAI-TRAM-NAO-CA");
  });

  // ════════════════════════════════════════════════════════════════════════════════════════════
  // 6. ĐƯỜNG LƯU TỆP do máy chủ sinh — và TỆP CŨ vẫn phục vụ được
  // ════════════════════════════════════════════════════════════════════════════════════════════

  it("★★ khoá lưu trữ mang ĐỦ tiền tố tenant theo thứ tự tập-đoàn → nhà-máy → xưởng → chuyền → máy", async () => {
    const { maTenantCuaMay, khoaLuuTruGoi } = await import("./phamViGhiMay");
    const chuoi = await maTenantCuaMay({ id: id.machA, code: MCODE_A, stationId: id.stA });
    const khoa = khoaLuuTruGoi(chuoi, "goi-01", new Date("2026-08-18T00:00:00Z"));
    expect(khoa.startsWith(`aoi/${CORP_A}/${FAC_A}/${WS_A}/${LINE_A}/${MCODE_A}/`)).toBe(true);
    expect(khoa.endsWith("/goi-01.zip")).toBe(true);
  });

  it("★★ nhà máy KHÔNG có tập đoàn ⇒ đoạn `_no-corp` TƯỜNG MINH (độ sâu đường dẫn là HẰNG SỐ)", async () => {
    // Một đoạn rỗng sẽ cho `aoi//FAC/...` và làm phép so TIỀN TỐ của lượt uỷ quyền đọc ảnh sai lệch.
    const { maTenantCuaMay, khoaLuuTruGoi, DOAN_KHONG_TAP_DOAN } = await import("./phamViGhiMay");
    const chuoi = await maTenantCuaMay({ id: id.machB, code: MCODE_B, stationId: id.stB });
    const khoa = khoaLuuTruGoi(chuoi, "goi-02");
    expect(khoa.startsWith(`aoi/${DOAN_KHONG_TAP_DOAN}/${FAC_B}/`)).toBe(true);
    expect(khoa).not.toContain("//");
    expect(khoa.split("/").length).toBe(khoaLuuTruGoi(
      { ...chuoi, corporateCode: "X" }, "goi-02").split("/").length);
  });

  it("★★★ presign THẬT sinh khoá mang tiền tố tenant, và hàng gói ghi đúng khoá ấy", async () => {
    const { aoiPackageRouter } = await import("./aoiPackageRouter");
    const goi = aoiPackageRouter.createCaller({ user: null } as never);
    const pkgId = `${RUN}-PKG-MOI`;
    const r = (await goi.presign({ machineCode: MCODE_A, inspectionId: pkgId, sizeBytes: 1234 })) as {
      objectKey?: string;
    };
    expect(r.objectKey?.startsWith(`aoi/${CORP_A}/${FAC_A}/${WS_A}/${LINE_A}/${MCODE_A}/`)).toBe(true);
    const [hang] = await sql`SELECT "storageKey" FROM inspection_packages WHERE "packageId" = ${pkgId}`;
    expect((hang as { storageKey: string }).storageKey).toBe(r.objectKey);
  });

  it("★★★ GÓI CŨ giữ NGUYÊN khoá cũ — presign lại KHÔNG dựng lại đường dẫn theo luật mới", async () => {
    // Đây là bằng chứng RUNTIME cho lời hứa "tệp cũ còn phục vụ được": một gói đã tồn tại với
    // khoá kiểu CŨ (`aoi/<machineCode>/…`) phải được trả về NGUYÊN VĂN. Nếu presign dựng lại khoá
    // theo luật mới, mọi byte đã nằm ở đường cũ trở thành không tìm lại được.
    const pkgId = `${RUN}-PKG-CU`;
    const khoaCu = `aoi/${MCODE_A}/2020/01/01/${pkgId}.zip`;
    await sql`INSERT INTO inspection_packages ("machineId","packageId","storageKey","status","machineCode")
              VALUES (${id.machA}, ${pkgId}, ${khoaCu}, 'pending', ${MCODE_A})`;
    const { aoiPackageRouter } = await import("./aoiPackageRouter");
    const goi = aoiPackageRouter.createCaller({ user: null } as never);
    const r = (await goi.presign({ machineCode: MCODE_A, inspectionId: pkgId, sizeBytes: 99 })) as {
      objectKey?: string;
    };
    expect(r.objectKey).toBe(khoaCu);
    const [hang] = await sql`SELECT "storageKey" FROM inspection_packages WHERE "packageId" = ${pkgId}`;
    expect((hang as { storageKey: string }).storageKey).toBe(khoaCu);
  });

  it("★★ TỆP CŨ vẫn phục vụ được: khoá được ĐỌC TỪ HÀNG, không bao giờ dựng lại từ chuỗi phân cấp", async () => {
    // Bằng chứng ở đây là bằng chứng về MÃ NGUỒN, và nó phải là bằng chứng: nếu một ngày nào đó
    // đường đọc bắt đầu tự dựng lại khoá, mọi gói đã tải lên trước hôm nay biến mất trong im lặng.
    const src = (await import("node:fs")).readFileSync("server/routers/aoiPackageRouter.ts", "utf8");
    // Khoá chỉ được SINH ở đúng MỘT chỗ (thủ tục `presign`) — hai chỗ sinh là hai bản luật.
    expect(src.split("khoaLuuTruGoi(").length - 1).toBe(1);
    // Mọi đường đọc bám vào `pkg.storageKey` của CHÍNH hàng đó.
    expect(src).toContain("storageGet(pkg.storageKey)");
    expect(src).toContain("path.join(uploadsRoot, pkg.storageKey)");
  });

  // ════════════════════════════════════════════════════════════════════════════════════════════
  // 7. CỜ HOÀN NGUYÊN — phải THỰC SỰ hoàn nguyên (nếu không nó là một lời hứa suông)
  // ════════════════════════════════════════════════════════════════════════════════════════════

  it("INGEST_TENANT_DERIVE_ENABLED=false ⇒ trả lại HÀNH VI CŨ (lời khai đi thẳng vào cột)", async () => {
    process.env.INGEST_TENANT_DERIVE_ENABLED = "false";
    try {
      const sn = `${RUN}-CO-TAT`;
      await nopBo(MCODE_A, sn, { factoryCode: FAC_B }); // khai của B, cờ tắt ⇒ KHÔNG bị chặn
      expect((await hangCua(sn))?.factoryCode).toBe(FAC_B);
    } finally {
      delete process.env.INGEST_TENANT_DERIVE_ENABLED;
    }
  });
});
