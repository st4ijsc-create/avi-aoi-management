/**
 * ★★★ mig 0325 — PHẠM VI TENANT CHO KHOÁ API + FAIL-CLOSED cho khoá CHƯA KHAI.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════
 * LỖ ĐÃ ĐO (trước bản vá này)
 * ══════════════════════════════════════════════════════════════════════════════════════════
 * `api_keys.scopes` trả lời *"khoá này LÀM ĐƯỢC GÌ"*. Nó CHƯA BAO GIỜ trả lời *"khoá này THẤY
 * ĐƯỢC GÌ"* — bảng có 14 cột, không cột nào mang tenant (đo 2026-08-17 trên `aoi_management`).
 * ⇒ bất kỳ khoá nào có `bi:read`/`export:read` đều kéo được số của TOÀN BỘ nhà máy.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════
 * BA TRẠNG THÁI — và vì sao lưới này đo cả ba, không phải hai
 * ══════════════════════════════════════════════════════════════════════════════════════════
 *   CHƯA KHAI (`dataScopeMode IS NULL`) ⇒ 403 + câu nói ĐÚNG lý do.
 *   MỘT NHÀ MÁY (`'factory'`)           ⇒ chỉ nhà máy ấy, và VẪN ĐỦ nhà máy ấy.
 *   TOÀN CỤC TƯỜNG MINH (`'global'`)    ⇒ tất cả.
 * Bỏ trạng thái thứ ba đi thì "chưa khai" và "được cấp toàn cục" thành MỘT — đúng lớp lỗi
 * `or()` rỗng vừa vá tuần này (giá trị VẮNG MẶT bị đọc thành "không lọc").
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════
 * ⚠⚠ DỮ LIỆU DỰNG SẴN PHẢI CÓ HÌNH DẠNG THẬT — có HÀNG MỒ CÔI
 * ══════════════════════════════════════════════════════════════════════════════════════════
 * Tuần này đã có một lưới 138 ca XANH vì dữ liệu dựng sẵn không chứa hình dạng có thật trong
 * sản xuất. Nên trước khi viết lưới này, hình dạng thật được ĐO:
 *     `aoi_management`      → 22.995 hàng ('SIM'/'SIM-FAC') + **1 hàng NULL/NULL** = 22.996
 *     `aoi_management_test` → 7.093 hàng NULL/NULL trong tổng số
 * ⇒ **Hàng mang mã tenant NULL là hình dạng CÓ THẬT, không phải ca biên tưởng tượng** — và nó
 * chính là toàn bộ khác biệt giữa hai mốc đối chứng 22.996 (toàn cục) và 22.995 (`SIM-FAC`).
 * Một bộ dữ liệu chỉ gồm "hàng của A" và "hàng của B" sẽ XANH với một bản vá dùng `<>` (khác
 * nhà máy) thay vì `=` (đúng nhà máy) — vì `factoryCode <> 'A'` loại được B nhưng KHÔNG loại
 * được NULL. Nên lưới này luôn có một hàng mồ côi, và luôn đo nó ở cả hai chiều.
 *
 * HAI CHIỀU cho mọi tuyến:
 *   ÂM   — khoá A không thấy hàng của B, không thấy hàng MỒ CÔI, khoá chưa khai không thấy gì.
 *   DƯƠNG— khoá A vẫn thấy ĐỦ hàng của A (chống vá quá tay); khoá toàn cục thấy TẤT CẢ kể cả
 *          hàng mồ côi (chống chặn nhầm khoá toàn cục tường minh).
 *
 * Lưới chạy trên CSDL test THẬT, qua HTTP THẬT, với `resolvePrincipal` THẬT — không mock bộ
 * phân giải phạm vi, vì thứ cần chứng minh chính là SQL sinh ra từ nó có tới nơi hay không.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import { type AddressInfo } from "node:net";

vi.hoisted(() => {
  // Bộ giới hạn nhịp của /api/export mặc định 10 lượt/5 phút/principal — lưới này gọi nhiều
  // hơn thế trên cùng một khoá, và một ca ĐỎ vì 429 sẽ là một lời khai SAI về phạm vi.
  process.env.EXPORT_RATE_LIMIT_PER_5MIN = "10000";

  // ★★★ 2026-08-18 — GHIM `hourly_yield_cache` VỀ TRẠNG THÁI CŨ. Đây là một QUẢ BOM HẸN GIỜ
  // đã nổ thật, không phải phòng xa:
  //
  //   `queryInspectionsDaily` đọc MV `hourly_yield_cache` khi MV còn TƯƠI — nhưng CHỈ cho khoá
  //   toàn cục (MV không mang cột tenant nên không thu hẹp được). "Còn tươi" = tuổi của mốc
  //   `db_feature_status.matview_refresh_qw` < 2 × `MATVIEW_REFRESH_INTERVAL_MS` (mặc định 5 phút
  //   ⇒ ngưỡng 10 phút). Mốc ấy do BẤT KỲ tiến trình nào chạm vào CSDL dùng chung ghi ra.
  //
  //   Hậu quả đo được: cùng một lưới, cùng một mã nguồn — chạy RIÊNG thì XANH, chạy CHUNG với
  //   `cachedStatistics.mv.test.ts` (hoặc chỉ cần một máy chủ thật vừa chạy trong 10 phút qua)
  //   thì ca "khoá TOÀN CỤC thấy A + B + mồ côi + lai" ĐỎ với **0** thay vì 5 — vì MV có thật,
  //   có tươi, nhưng KHÔNG chứa cửa sổ 2044 mà lưới này vừa dựng.
  //
  // ⚠ Ngưỡng 1ms ⇒ mốc luôn "quá cũ" ⇒ luôn đi TRUY VẤN SỐNG. Đây KHÔNG phải giả lập bộ phân
  // giải phạm vi (thứ mà lưới này tồn tại để đo, và cố ý không mock); nó ghim một núm chọn NGUỒN
  // dữ liệu chẳng liên quan gì tới tenant, để phép đo phạm vi không phụ thuộc vào việc ai vừa
  // chạy gì trong mười phút trước. Nhánh MV-tươi được đo RIÊNG ở mục 2c.
  process.env.MATVIEW_REFRESH_INTERVAL_MS = "1";
});

import * as dbApi from "../../db";
import { getDb } from "../../db/connection";
import {
  apiKeys,
  corporates,
  factories,
  oeeMetrics,
  productInspections,
  type InsertMeasurementResult,
} from "../../../drizzle/schema";
import { eq, inArray, sql } from "drizzle-orm";
import { hashApiKey } from "../v1/auth";
import {
  GLOBAL_TENANT_SCOPE,
  UNDECLARED_TENANT_SCOPE,
  inspectionTenantFilter,
  isTenantScopeDeclared,
  tenantCodeScopeOf,
  tenantScopeFromRow,
  tenantScopeLabels,
  TENANT_SCOPE_UNDECLARED_MESSAGE,
} from "../v1/apiKeyScope";
import { createBiRouter, TENANT_SCOPABLE_DATASETS, BI_DATASETS } from "./biRouter";
import { createExportRouter } from "./exportRouter";

const ts = Date.now();
const CORP_A = `AKS_CORP_A_${ts}`;
const FAC_A = `AKS_FAC_A_${ts}`;
/** Nhà máy THỨ HAI của cùng tập đoàn A — chỉ tồn tại để một khoá cấp TẬP ĐOÀN phủ >1 nhà máy. */
const FAC_A2 = `AKS_FAC_A2_${ts}`;
const CORP_B = `AKS_CORP_B_${ts}`;
const FAC_B = `AKS_FAC_B_${ts}`;
/** Mã nhà máy KHÔNG có hàng `factories` nào — dùng để đo nhánh TỪ CHỐI của phép chiếu mã→id. */
const FAC_GHOST = `AKS_FAC_GHOST_${ts}`;
/**
 * ★★★ HÌNH DẠNG THẬT: nhà máy có `code` nhưng `corporateCode` **NULL**.
 *
 * Đo được 2026-08-18 trên CSDL thật: `aoi_management` có **0/3** hàng `factories` mang
 * `corporateCode`, `aoi_management_test` có **33/1177** — trong khi `product_inspections` thì mang
 * đủ cả hai mã (22.995 hàng `SIM`/`SIM-FAC`). Một khoá khai CẢ HAI mã là chuyện bình thường, và
 * nếu phép chiếu mã→`factories.id` đòi khớp CẢ HAI thì trên bản triển khai thật nó ra 0 nhà máy
 * ⇒ `machine_oee`/`shift` chết với mọi khoá. Ca dưới đây neo đúng hình dạng ấy.
 */
const FAC_NULLCORP = `AKS_FAC_NC_${ts}`;

/**
 * Cửa sổ riêng của LƯỢT CHẠY NÀY — mỗi lượt một ngày khác nhau, ở tương lai xa.
 *
 * ⚠ VÌ SAO KHÔNG DÙNG MỘT CỬA SỔ CỐ ĐỊNH RỒI DỌN SAU. Đo được khi dựng lưới này:
 * `product_inspections` là WORM (doc48 R1) — vai `avi_app` bị `42501 permission denied for
 * table product_inspections` khi DELETE. Nên hàng dựng sẵn KHÔNG dọn được, và một cửa sổ cố
 * định sẽ tích luỹ hàng của mọi lượt trước: lượt đầu tiên của file này ĐỎ đúng vì thế (khoá
 * toàn cục đếm ra 13 thay vì 6). Cửa sổ theo `ts` khiến mỗi lượt có một khoảng thời gian
 * KHÔNG giao với bất kỳ lượt nào khác, nên phép đếm là tuyệt đối chứ không phải chênh lệch.
 */
const RUN_DAY = new Date(2044, 0, 1 + (Math.floor(ts / 1000) % 9000));
const pad = (n: number) => String(n).padStart(2, "0");
const dayStr = `${RUN_DAY.getFullYear()}-${pad(RUN_DAY.getMonth() + 1)}-${pad(RUN_DAY.getDate())}`;
const WIN_FROM = `${dayStr}T00:00:00.000Z`;
const WIN_TO = `${dayStr}T23:59:59.000Z`;
const INSPECTED_AT = new Date(`${dayStr}T03:00:00Z`);

/** Khoá thô (chỉ tồn tại trong tiến trình test; CSDL chỉ giữ SHA-256). */
const KEY_UNDECLARED = `ak_test_undeclared_${ts}`;
const KEY_FACTORY_A = `ak_test_factory_a_${ts}`;
const KEY_FACTORY_B = `ak_test_factory_b_${ts}`;
/** Khoá cấp TẬP ĐOÀN — chỉ khai `corporateCode`, phủ CẢ HAI nhà máy của A. */
const KEY_CORP_A = `ak_test_corp_a_${ts}`;
/** Khoá khai một mã nhà máy KHÔNG tồn tại trong bảng `factories`. */
const KEY_GHOST = `ak_test_ghost_${ts}`;
/** Khoá khai CẢ HAI mã, nhưng hàng `factories` tương ứng có `corporateCode` NULL (hình dạng THẬT). */
const KEY_NULLCORP = `ak_test_nullcorp_${ts}`;
const KEY_GLOBAL = `ak_test_global_${ts}`;

let factoryAId: number;
let factoryBId: number;
let machineA: number;
let machineB: number;
let machineNC: number;
let productModelId: number;
/** `measurement_results.pointDefId` là NOT NULL (đo khi dựng lưới: 23502 trên chunk hypertable). */
let pointDefId: number;
let server: Server | undefined;
let baseUrl: string;
const createdKeyIds: number[] = [];
const createdInspectionIds: number[] = [];

/**
 * Số bản ghi kiểm dựng sẵn — đối chứng cứng, không suy từ chính đáp ứng.
 *
 * ★★★ `cross` (2026-08-18): một hàng mang `factoryCode = FAC_A` nhưng `corporateCode = CORP_B`.
 * KHÔNG phải ca biên tưởng tượng — không ràng buộc nào trên `product_inspections` bắt hai mã
 * phải khớp nhau, và cùng lớp lỗi ("hàng mang mã của nhà máy KHÁC") đã cắn thật ở
 * `daily_statistics` tuần này.
 *
 * ⚠ Nó tồn tại vì một lý do ĐO ĐƯỢC: `getShiftReport` có SẴN đường lọc theo `factoryId` (chỉ so
 * `factoryCode`). Nếu bộ dữ liệu chỉ có "hàng của A" và "hàng của B" thì việc GỠ mệnh đề
 * `tenantScope` khỏi `getShiftReport` sẽ KHÔNG làm đỏ ca nào — đường `factoryId` một mình đã cho
 * cùng kết quả. Hàng `cross` là toàn bộ khác biệt giữa phép AND-hai-mã (đúng) và phép lọc một
 * mã (nới). Nó cũng bắt luôn đột biến AND→OR ở `tenantCodeInspectionFilter`.
 */
const SEEDED = { factoryA: 3, factoryB: 2, orphan: 1, cross: 1, nullCorp: 2 } as const;
const SEEDED_ALL =
  SEEDED.factoryA + SEEDED.factoryB + SEEDED.orphan + SEEDED.cross + SEEDED.nullCorp;
/** Số dòng đo NG dựng sẵn (defect_pareto đếm theo `measurement_results`). */
const SEEDED_NG = { factoryA: 2, factoryB: 3, orphan: 1, cross: 0, nullCorp: 0 } as const;
const SEEDED_NG_ALL =
  SEEDED_NG.factoryA + SEEDED_NG.factoryB + SEEDED_NG.orphan + SEEDED_NG.cross + SEEDED_NG.nullCorp;
/**
 * Số hàng `oee_metrics` dựng sẵn trong cửa sổ, theo máy.
 *
 * ⚠ Dataset `machine_oee` GỘP theo (ngày × máy), và cửa sổ của lượt chạy này chỉ dài MỘT ngày ⇒
 * mỗi máy ra ĐÚNG MỘT dòng bất kể có bao nhiêu hàng nguồn. Vì thế phép đếm dòng KHÔNG nhìn thấy
 * hàng nguồn; cột `total_count` (một SUM) mới nhìn thấy. Cả hai đều được canh — đếm dòng bắt
 * "máy của nhà máy khác lọt vào", còn tổng bắt "gộp nhầm hàng của máy khác vào cùng một dòng".
 */
const SEEDED_OEE = { machineA: 2, machineB: 1, machineNC: 1 } as const;
/** Dòng sau khi GỘP (một ngày × một máy). */
const OEE_ROWS = { machineA: 1, machineB: 1, machineNC: 1 } as const;
/** `totalCount` của mỗi hàng nguồn — để tổng của một dòng đã gộp đếm ngược ra số hàng nguồn. */
const OEE_TOTAL_PER_ROW = 100;

async function mkInspection(
  machineId: number,
  corporateCode: string | null,
  factoryCode: string | null,
  tag: string,
  ngCount: number,
): Promise<number> {
  const id = await dbApi.createProductInspection({
    machineId,
    productModelId,
    serialNumber: `SN_AKS_${tag}_${ts}`,
    overallResult: ngCount > 0 ? "NG" : "OK",
    originalResult: ngCount > 0 ? "NG" : "OK",
    inspectionTime: INSPECTED_AT,
    corporateCode,
    factoryCode,
  });
  createdInspectionIds.push(id);
  if (ngCount > 0) {
    await dbApi.createMeasurementResults(
      Array.from({ length: ngCount }, () => ({
        inspectionId: id,
        pointDefId,
        result: "NG",
      })) satisfies InsertMeasurementResult[],
    );
  }
  return id;
}

async function mkKey(
  name: string,
  plaintext: string,
  scope: { dataScopeMode: string | null; corporateCode: string | null; factoryCode: string | null },
): Promise<void> {
  const conn = await getDb();
  const [row] = await conn!
    .insert(apiKeys)
    .values({
      name: `${name}_${ts}`,
      keyHash: hashApiKey(plaintext),
      keyPrefix: plaintext.slice(0, 12),
      scopes: ["bi:read", "export:read"],
      isActive: true,
      dataScopeMode: scope.dataScopeMode,
      corporateCode: scope.corporateCode,
      factoryCode: scope.factoryCode,
    })
    .returning({ id: apiKeys.id });
  createdKeyIds.push(row.id);
}

async function get(path: string, key: string): Promise<{ status: number; body: any; text: string }> {
  const res = await fetch(`${baseUrl}${path}`, { headers: { "X-API-Key": key } });
  const text = await res.text();
  let body: any = null;
  try {
    body = JSON.parse(text);
  } catch {
    /* CSV / stream */
  }
  return { status: res.status, body, text };
}

const biPath = (dataset: string, extra = "") =>
  `/api/bi/datasets/${dataset}?from=${WIN_FROM}&to=${WIN_TO}${extra}`;
const exportPath = (name: string, extra = "") =>
  `/api/export/${name}?from=${WIN_FROM}&to=${WIN_TO}${extra}`;

/** Tổng cột `total` của các dòng thuộc một máy (inspections_daily gộp theo ngày × máy). */
const totalFor = (rows: any[], machineId: number): number =>
  rows.filter((r) => Number(r.machine_id) === machineId).reduce((s, r) => s + Number(r.total), 0);

beforeAll(async () => {
  const conn0 = await getDb();
  // ★★★ 2026-08-18 — HAI NHÀ MÁY THẬT, hai chuỗi phân cấp RIÊNG.
  //
  // Bản trước của lưới này đặt CẢ HAI máy dưới CÙNG một trạm của MỘT nhà máy `AKSF_…`, và mã
  // tenant trên bản ghi kiểm (`AKS_FAC_A_…`) KHÔNG ứng với hàng `factories` nào. Điều đó đủ cho
  // hai dataset chạy thẳng trên `product_inspections`, nhưng KHÔNG đủ cho `machine_oee` (đi qua
  // `machines → stations → production_lines → workshops → factories`) và `shift` (chiếu mã→id).
  // Nếu giữ nguyên, hai dataset ấy sẽ luôn trả rỗng cho khoá A và ca vẫn "xanh" một cách vô nghĩa.
  await conn0!.insert(corporates).values([
    { code: CORP_A, name: "AKS corp A" },
    { code: CORP_B, name: "AKS corp B" },
  ]);
  factoryAId = await dbApi.createFactory({ code: FAC_A, corporateCode: CORP_A, name: "AKS fac A" });
  factoryBId = await dbApi.createFactory({ code: FAC_B, corporateCode: CORP_B, name: "AKS fac B" });
  // Nhà máy thứ hai của tập đoàn A — KHÔNG có máy, KHÔNG có dữ liệu. Nó chỉ làm cho một khoá
  // cấp TẬP ĐOÀN phủ 2 nhà máy, tức nhánh "mơ hồ" của `shift` trở thành đo được.
  await dbApi.createFactory({ code: FAC_A2, corporateCode: CORP_A, name: "AKS fac A2" });
  // ★ Nhà máy mang `corporateCode` NULL — hình dạng CHIẾM ĐA SỐ trên CSDL thật (xem `FAC_NULLCORP`).
  const factoryNCId = await dbApi.createFactory({ code: FAC_NULLCORP, name: "AKS fac NULLCORP" });

  const workshopA = await dbApi.createWorkshop({ factoryId: factoryAId, code: `AKSWA_${ts}`, name: "AKS ws A" });
  const lineA = await dbApi.createProductionLine({ workshopId: workshopA, code: `AKSLA_${ts}`, name: "AKS line A" });
  const stationA = await dbApi.createStation({ lineId: lineA, code: `AKSSA_${ts}`, name: "AKS st A", orderIndex: 1 });
  const workshopB = await dbApi.createWorkshop({ factoryId: factoryBId, code: `AKSWB_${ts}`, name: "AKS ws B" });
  const lineB = await dbApi.createProductionLine({ workshopId: workshopB, code: `AKSLB_${ts}`, name: "AKS line B" });
  const stationB = await dbApi.createStation({ lineId: lineB, code: `AKSSB_${ts}`, name: "AKS st B", orderIndex: 1 });

  const workshopNC = await dbApi.createWorkshop({ factoryId: factoryNCId, code: `AKSWNC_${ts}`, name: "AKS ws NC" });
  const lineNC = await dbApi.createProductionLine({ workshopId: workshopNC, code: `AKSLNC_${ts}`, name: "AKS line NC" });
  const stationNC = await dbApi.createStation({ lineId: lineNC, code: `AKSSNC_${ts}`, name: "AKS st NC", orderIndex: 1 });

  machineA = await dbApi.createMachine({
    stationId: stationA, code: `AKSMA_${ts}`, name: "AKS machine A", machineType: "AOI", apiKey: `aks_ma_${ts}`,
  });
  machineB = await dbApi.createMachine({
    stationId: stationB, code: `AKSMB_${ts}`, name: "AKS machine B", machineType: "AOI", apiKey: `aks_mb_${ts}`,
  });
  machineNC = await dbApi.createMachine({
    stationId: stationNC, code: `AKSMNC_${ts}`, name: "AKS machine NC", machineType: "AOI", apiKey: `aks_mnc_${ts}`,
  });
  productModelId = await dbApi.createProductModel({
    code: `AKSP_${ts}`, name: "AKS product", imageWidth: 1000, imageHeight: 800,
  });
  pointDefId = await dbApi.createMeasurementPointDef({
    productModelId, code: `AKSPT_${ts}`, name: "AKS point", measurementType: "VISUAL", positionX: 10, positionY: 10,
  });

  // ── Nhà máy A trên MÁY A: 3 bản ghi kiểm, 2 dòng đo NG ──────────────────────────────────
  await mkInspection(machineA, CORP_A, FAC_A, "A1", 2);
  await mkInspection(machineA, CORP_A, FAC_A, "A2", 0);
  await mkInspection(machineA, CORP_A, FAC_A, "A3", 0);

  // ── HÀNG MỒ CÔI cũng nằm trên MÁY A: KHÔNG mã tenant nào ────────────────────────────────
  // ⚠ Cố ý đặt CÙNG MÁY với nhà máy A: nếu bộ lọc phạm vi bị thay bằng một phép lọc theo MÁY
  //   (một đột biến rất dễ viết và rất khó thấy), ca này ĐỎ ngay — máy A vẫn đúng nhưng hàng
  //   mồ côi lọt vào phạm vi của khoá A. Đây là hình dạng đo được thật: 1/22.996 hàng trên
  //   `aoi_management`, 7.093 hàng trên `aoi_management_test`.
  await mkInspection(machineA, null, null, "ORPHAN", 1);

  // ── HÀNG LAI: đúng nhà máy A, SAI tập đoàn (xem docblock `SEEDED.cross`) ─────────────────
  await mkInspection(machineA, CORP_B, FAC_A, "CROSS", 0);

  // ── Nhà máy B trên MÁY B: 2 bản ghi kiểm, 3 dòng đo NG ──────────────────────────────────
  await mkInspection(machineB, CORP_B, FAC_B, "B1", 3);
  await mkInspection(machineB, CORP_B, FAC_B, "B2", 0);

  // ── Nhà máy `corporateCode` NULL trên MÁY NC: 2 bản ghi kiểm mang ĐỦ hai mã ──────────────
  await mkInspection(machineNC, CORP_A, FAC_NULLCORP, "NC1", 0);
  await mkInspection(machineNC, CORP_A, FAC_NULLCORP, "NC2", 0);

  // ── `oee_metrics`: bảng KHÔNG có cột tenant nào; phạm vi CHỈ đến từ chuỗi phân cấp của máy.
  const mkOee = (machineId: number, machineCode: string, hour: number) => ({
    machineId, machineCode,
    timestamp: new Date(`${dayStr}T${pad(hour)}:00:00Z`),
    availability: 9000, performance: 9500, quality: 9900, oee: 8464,
    plannedTime: 480, runTime: 430, idealCycleTime: 30,
    totalCount: 100, goodCount: 99, rejectCount: 1,
  });
  await conn0!.insert(oeeMetrics).values([
    mkOee(machineA, `AKSMA_${ts}`, 2),
    mkOee(machineA, `AKSMA_${ts}`, 4),
    mkOee(machineB, `AKSMB_${ts}`, 2),
    mkOee(machineNC, `AKSMNC_${ts}`, 2),
  ]);

  await mkKey("aks_undeclared", KEY_UNDECLARED, { dataScopeMode: null, corporateCode: null, factoryCode: null });
  await mkKey("aks_factory_a", KEY_FACTORY_A, { dataScopeMode: "factory", corporateCode: CORP_A, factoryCode: FAC_A });
  await mkKey("aks_factory_b", KEY_FACTORY_B, { dataScopeMode: "factory", corporateCode: CORP_B, factoryCode: FAC_B });
  await mkKey("aks_corp_a", KEY_CORP_A, { dataScopeMode: "factory", corporateCode: CORP_A, factoryCode: null });
  await mkKey("aks_ghost", KEY_GHOST, { dataScopeMode: "factory", corporateCode: null, factoryCode: FAC_GHOST });
  await mkKey("aks_nullcorp", KEY_NULLCORP, { dataScopeMode: "factory", corporateCode: CORP_A, factoryCode: FAC_NULLCORP });
  await mkKey("aks_global", KEY_GLOBAL, { dataScopeMode: "global", corporateCode: null, factoryCode: null });

  const app = express();
  app.use("/api/bi", createBiRouter());
  app.use("/api/export", createExportRouter());
  const s = createServer(app);
  server = s;
  await new Promise<void>((resolve) => s.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
});

afterAll(async () => {
  const s = server;
  if (s) await new Promise<void>((resolve) => s.close(() => resolve()));
  const conn = await getDb();
  // ⚠ CHỈ dọn `api_keys`. `product_inspections` là WORM (doc48 R1): vai `avi_app` nhận
  //   `42501 permission denied` khi DELETE — đó là lý do cửa sổ thời gian được sinh theo `ts`
  //   thay vì cố định. Đừng thêm lệnh xoá ở đây; nó sẽ ném và làm ĐỎ cả file vì một lý do
  //   không liên quan gì tới phạm vi.
  if (conn && createdKeyIds.length) await conn.delete(apiKeys).where(inArray(apiKeys.id, createdKeyIds));
});

// ══════════════════════════════════════════════════════════════════════════════════════════
// 0. Dữ liệu dựng sẵn có ĐÚNG hình dạng đã khai không (đo trước khi đo bất cứ thứ gì khác)
// ══════════════════════════════════════════════════════════════════════════════════════════

describe("dữ liệu dựng sẵn phản ánh hình dạng THẬT", () => {
  it("có hàng của A, của B, MỘT hàng MỒ CÔI và MỘT hàng LAI (đúng nhà máy, sai tập đoàn)", async () => {
    const conn = await getDb();
    const rows = await conn!
      .select({
        id: productInspections.id,
        corporateCode: productInspections.corporateCode,
        factoryCode: productInspections.factoryCode,
      })
      .from(productInspections)
      .where(inArray(productInspections.id, createdInspectionIds));

    expect(rows.length).toBe(SEEDED_ALL);
    expect(rows.filter((r) => r.factoryCode === FAC_A && r.corporateCode === CORP_A).length).toBe(SEEDED.factoryA);
    expect(rows.filter((r) => r.factoryCode === FAC_B).length).toBe(SEEDED.factoryB);
    // ⚠ Ca NEO cho toàn bộ file: mất hàng này thì mọi ca "khoá A không thấy mồ côi" bên dưới
    //   trở thành vô nghĩa mà vẫn XANH.
    expect(rows.filter((r) => r.factoryCode === null && r.corporateCode === null).length).toBe(SEEDED.orphan);
    // ⚠ Ca NEO thứ hai: hàng LAI là toàn bộ khác biệt giữa AND-hai-mã và lọc-một-mã.
    expect(rows.filter((r) => r.factoryCode === FAC_A && r.corporateCode === CORP_B).length).toBe(SEEDED.cross);
  });

  it("hai máy nằm ở HAI nhà máy khác nhau, và `oee_metrics` có hàng cho cả hai", async () => {
    const conn = await getDb();
    // ⚠ Nếu cả hai máy lại rơi vào cùng một nhà máy thì mọi ca `machine_oee` bên dưới sẽ XANH
    //   mà không chứng minh gì — cổng phân cấp không có gì để loại.
    expect(factoryAId).not.toBe(factoryBId);
    const facRows = await conn!
      .select({ id: factories.id, code: factories.code, corporateCode: factories.corporateCode })
      .from(factories)
      .where(inArray(factories.code, [FAC_A, FAC_A2, FAC_B, FAC_NULLCORP, FAC_GHOST]));
    expect(facRows.length).toBe(4); // FAC_GHOST cố ý KHÔNG được tạo
    expect(facRows.filter((r) => r.corporateCode === CORP_A).length).toBe(2); // ⇒ khoá cấp tập đoàn MƠ HỒ
    expect(facRows.some((r) => r.code === FAC_GHOST)).toBe(false); // mã ma KHÔNG có hàng nào
    // ★ HÌNH DẠNG THẬT: hàng `factories` KHÔNG mang `corporateCode` (0/3 trên `aoi_management`).
    expect(facRows.find((r) => r.code === FAC_NULLCORP)?.corporateCode).toBeNull();

    const oeeRows = await conn!
      .select({ machineId: oeeMetrics.machineId })
      .from(oeeMetrics)
      .where(inArray(oeeMetrics.machineId, [machineA, machineB, machineNC]));
    expect(oeeRows.filter((r) => Number(r.machineId) === machineA).length).toBe(SEEDED_OEE.machineA);
    expect(oeeRows.filter((r) => Number(r.machineId) === machineB).length).toBe(SEEDED_OEE.machineB);
    expect(oeeRows.filter((r) => Number(r.machineId) === machineNC).length).toBe(SEEDED_OEE.machineNC);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════
// 1. Bộ phân giải phạm vi — thuần, không CSDL
// ══════════════════════════════════════════════════════════════════════════════════════════

describe("apiKeyScope — ba trạng thái phân biệt được", () => {
  it("hàng CHƯA KHAI đọc thành mode null, KHÔNG phải toàn cục", () => {
    const scope = tenantScopeFromRow({ dataScopeMode: null, corporateCode: null, factoryCode: null });
    expect(scope.mode).toBeNull();
    expect(isTenantScopeDeclared(scope)).toBe(false);
  });

  it("CHỈ 'global' cho ra 'không lọc'; CHƯA KHAI cho ra vị từ TỪ CHỐI (không phải undefined)", () => {
    // ⚠ Ca này NEO thẳng vào giá trị trả về, không chỉ canh kết quả truy vấn. Đây chính xác là
    //   lớp lỗi `or()` rỗng: `undefined` = "không có mệnh đề WHERE" = THẤY TẤT CẢ. Nếu ai đó
    //   đổi nhánh chưa-khai thành `return undefined` thì ca này ĐỎ mà không cần tới CSDL.
    expect(inspectionTenantFilter(GLOBAL_TENANT_SCOPE)).toBeUndefined();
    expect(inspectionTenantFilter(UNDECLARED_TENANT_SCOPE)).toBeDefined();
    expect(inspectionTenantFilter(undefined)).toBeDefined();
    expect(inspectionTenantFilter({ mode: "factory", corporateCode: null, factoryCode: FAC_A })).toBeDefined();
  });

  it("'factory' KHÔNG có mã nào = lời khai RỖNG ⇒ coi như chưa khai (fail-closed)", () => {
    const scope = tenantScopeFromRow({ dataScopeMode: "factory", corporateCode: null, factoryCode: null });
    expect(scope.mode).toBeNull();
    expect(inspectionTenantFilter(scope)).toBeDefined();
  });

  it("mode lạ (dữ liệu lệch ghi bằng psql) rơi về CHƯA KHAI, không rơi về toàn cục", () => {
    expect(tenantScopeFromRow({ dataScopeMode: "GLOBAL", corporateCode: null, factoryCode: null }).mode).toBeNull();
    expect(tenantScopeFromRow({ dataScopeMode: "*", corporateCode: null, factoryCode: null }).mode).toBeNull();
    expect(tenantScopeFromRow(null).mode).toBeNull();
  });

  it("nhãn ra ngoài CHỈ có ba ô — không bao giờ mang `filter`", () => {
    for (const scope of [GLOBAL_TENANT_SCOPE, UNDECLARED_TENANT_SCOPE, { mode: "factory" as const, corporateCode: CORP_A, factoryCode: FAC_A }]) {
      const labels = tenantScopeLabels(scope);
      expect(Object.keys(labels).sort()).toEqual(["scopeApplied", "scopeEmptyReason", "scopeMessage"]);
      expect("filter" in labels).toBe(false);
      // Chứng minh nó SERIALISE được — `filter` của drizzle có tham chiếu vòng và sẽ ném ở đây.
      expect(() => JSON.stringify(labels)).not.toThrow();
    }
    expect(tenantScopeLabels(GLOBAL_TENANT_SCOPE).scopeApplied).toBe(false);
    expect(tenantScopeLabels({ mode: "factory", corporateCode: null, factoryCode: FAC_A }).scopeApplied).toBe(true);
  });

  // ── ★★★ 2026-08-18 — TRỤC PHẠM VI THỨ HAI (mã tenant tường minh) ────────────────────────
  it("`tenantCodeScopeOf`: chỉ 'global' cho ra undefined; chưa khai cho ra lời khai RỖNG", () => {
    // ⚠ Ca NEO cùng hình dạng với `inspectionTenantFilter` ở trên. `undefined` ở đây nghĩa là
    //   "KHÔNG truyền `tenantScope`" = không lọc; nếu ai đó đổi nhánh chưa-khai thành
    //   `undefined` thì mọi bộ tổng hợp sẽ chạy KHÔNG mệnh đề nào — đúng lớp lỗi `or()` rỗng.
    expect(tenantCodeScopeOf(GLOBAL_TENANT_SCOPE)).toBeUndefined();
    expect(tenantCodeScopeOf(UNDECLARED_TENANT_SCOPE)).toEqual({});
    expect(tenantCodeScopeOf(undefined)).toEqual({});
    expect(tenantCodeScopeOf({ mode: "factory", corporateCode: CORP_A, factoryCode: FAC_A })).toEqual({
      corporateCode: CORP_A,
      factoryCode: FAC_A,
    });
  });

  it("`tenantCodeInspectionFilter`: lời khai RỖNG ⇒ vị từ TỪ CHỐI, KHÔNG phải undefined", async () => {
    const { tenantCodeInspectionFilter } = await import("../../_core/tenantCodeScope");
    // Kiểu trả về đã là `SQL` (không có `| undefined`), nhưng một ca chạy vẫn cần: kiểu không
    // ngăn được ai đó viết `return undefined as any` để "sửa" một lỗi tsc.
    expect(tenantCodeInspectionFilter({})).toBeDefined();
    expect(tenantCodeInspectionFilter(null)).toBeDefined();
    expect(tenantCodeInspectionFilter({ factoryCode: FAC_A })).toBeDefined();
  });

  it("câu từ chối nói ĐÚNG lý do và KHÔNG nói 'không có dữ liệu' (vi/en/zh)", () => {
    expect(TENANT_SCOPE_UNDECLARED_MESSAGE.vi).toContain("chưa được gán phạm vi nhà máy");
    expect(TENANT_SCOPE_UNDECLARED_MESSAGE.vi).not.toContain("không có dữ liệu");
    expect(TENANT_SCOPE_UNDECLARED_MESSAGE.en).toContain("no factory scope");
    expect(TENANT_SCOPE_UNDECLARED_MESSAGE.en.toLowerCase()).not.toContain("no data");
    expect(TENANT_SCOPE_UNDECLARED_MESSAGE.zh).toContain("工厂范围");
    expect(TENANT_SCOPE_UNDECLARED_MESSAGE.zh).not.toContain("没有数据");
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════
// 2. /api/bi — ba trạng thái qua HTTP thật
// ══════════════════════════════════════════════════════════════════════════════════════════

describe("/api/bi — fail-closed + phạm vi", () => {
  it("khoá CHƯA KHAI → 403 với câu nói đúng lý do (không 200-rỗng, không 500)", async () => {
    for (const path of ["/api/bi/datasets", biPath("inspections_daily")]) {
      const r = await get(path, KEY_UNDECLARED);
      expect(r.status).toBe(403);
      expect(r.body.error.code).toBe("tenant_scope_undeclared");
      expect(r.body.error.message).toContain("chưa được gán phạm vi nhà máy");
      expect(r.text).not.toContain("không có dữ liệu");
      expect(r.body.error.details.message_en).toBeTruthy();
      expect(r.body.error.details.message_zh).toBeTruthy();
    }
  });

  it("khoá nhà máy A: inspections_daily → CHỈ A, VẪN ĐỦ A, KHÔNG có mồ côi, KHÔNG có B", async () => {
    const r = await get(biPath("inspections_daily"), KEY_FACTORY_A);
    expect(r.status).toBe(200);
    expect(totalFor(r.body.rows, machineA)).toBe(SEEDED.factoryA); // đủ A, và mồ côi bị loại
    expect(totalFor(r.body.rows, machineB)).toBe(0); // không thấy B
    expect(r.body.scopeApplied).toBe(true);
    expect(r.body.tenantScope).toEqual({ mode: "factory", corporateCode: CORP_A, factoryCode: FAC_A });
  });

  it("khoá TOÀN CỤC TƯỜNG MINH: thấy A + B + hàng MỒ CÔI + hàng LAI", async () => {
    const r = await get(biPath("inspections_daily"), KEY_GLOBAL);
    expect(r.status).toBe(200);
    expect(totalFor(r.body.rows, machineA)).toBe(SEEDED.factoryA + SEEDED.orphan + SEEDED.cross);
    expect(totalFor(r.body.rows, machineB)).toBe(SEEDED.factoryB);
    expect(r.body.scopeApplied).toBe(false);
    expect(r.body.tenantScope.mode).toBe("global");
  });

  it("★ ÂM ĐỐI XỨNG: khoá B ra số của RIÊNG B (loại khả năng 'A tình cờ luôn thắng')", async () => {
    const r = await get(biPath("inspections_daily"), KEY_FACTORY_B);
    expect(r.status).toBe(200);
    expect(totalFor(r.body.rows, machineB)).toBe(SEEDED.factoryB);
    expect(totalFor(r.body.rows, machineA)).toBe(0);
  });

  it("defect_pareto theo cùng ba chiều (truy vấn raw ĐÃ GỠ BÍ DANH — không 42P01)", async () => {
    const undeclared = await get(biPath("defect_pareto"), KEY_UNDECLARED);
    expect(undeclared.status).toBe(403);

    const a = await get(biPath("defect_pareto"), KEY_FACTORY_A);
    expect(a.status).toBe(200);
    const aCount = a.body.rows.reduce((s: number, r: any) => s + Number(r.count), 0);
    expect(aCount).toBe(SEEDED_NG.factoryA);

    const g = await get(biPath("defect_pareto"), KEY_GLOBAL);
    expect(g.status).toBe(200);
    const gCount = g.body.rows.reduce((s: number, r: any) => s + Number(r.count), 0);
    expect(gCount).toBe(SEEDED_NG_ALL);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════
// 2b. ★★★ 2026-08-18 — BỐN DATASET VỪA MỞ. Mỗi cái đo ba chiều: A / B / toàn cục.
//
// Trước lượt này cả bốn trả **403 `dataset_not_tenant_scopable`** cho khoá phạm vi-nhà-máy. Ca
// "403" cũ vì thế bị THAY, không bị giữ lại — giữ nó sẽ là canh đúng cái hành vi vừa bị xoá.
// ══════════════════════════════════════════════════════════════════════════════════════════

describe("/api/bi — bốn dataset vừa mở, ba chiều mỗi cái", () => {
  it("hằng số khai đủ SÁU dataset, và đúng bằng danh mục (không có tên nào lọt/thiếu)", () => {
    expect([...TENANT_SCOPABLE_DATASETS].sort()).toEqual(BI_DATASETS.map((d) => d.name).sort());
  });

  /** Tổng một cột số trên mọi dòng của đáp ứng. */
  const sumCol = (rows: any[], col: string): number =>
    rows.reduce((s, r) => s + Number(r[col] ?? 0), 0);

  it("machine_oee: A chỉ thấy máy A, B chỉ thấy máy B, toàn cục thấy cả hai", async () => {
    const a = await get(biPath("machine_oee"), KEY_FACTORY_A);
    expect(a.status).toBe(200);
    expect(a.body.rows.length).toBe(OEE_ROWS.machineA);
    expect(a.body.rows.every((r: any) => Number(r.machine_id) === machineA)).toBe(true);
    // ⚠ Tổng đếm ngược ra SỐ HÀNG NGUỒN — phép đếm dòng một mình không thấy được chúng.
    expect(sumCol(a.body.rows, "total_count")).toBe(SEEDED_OEE.machineA * OEE_TOTAL_PER_ROW);

    // ★ ÂM ĐỐI XỨNG — B ra số của riêng B.
    const b = await get(biPath("machine_oee"), KEY_FACTORY_B);
    expect(b.status).toBe(200);
    expect(b.body.rows.length).toBe(OEE_ROWS.machineB);
    expect(b.body.rows.every((r: any) => Number(r.machine_id) === machineB)).toBe(true);
    expect(sumCol(b.body.rows, "total_count")).toBe(SEEDED_OEE.machineB * OEE_TOTAL_PER_ROW);

    const g = await get(biPath("machine_oee"), KEY_GLOBAL);
    expect(g.status).toBe(200);
    expect(g.body.rows.length).toBe(OEE_ROWS.machineA + OEE_ROWS.machineB + OEE_ROWS.machineNC);
    expect(sumCol(g.body.rows, "total_count")).toBe(
      (SEEDED_OEE.machineA + SEEDED_OEE.machineB + SEEDED_OEE.machineNC) * OEE_TOTAL_PER_ROW,
    );
  });

  it("yield_by_product: A=3, B=2, toàn cục=TẤT CẢ (kể cả mồ côi và hàng lai)", async () => {
    const a = await get(biPath("yield_by_product"), KEY_FACTORY_A);
    expect(a.status).toBe(200);
    expect(sumCol(a.body.rows, "total")).toBe(SEEDED.factoryA);

    const b = await get(biPath("yield_by_product"), KEY_FACTORY_B);
    expect(b.status).toBe(200);
    // ⚠ Khoá B khai `CORP_B + FAC_B` ⇒ hàng LAI (`CORP_B` + `FAC_A`) KHÔNG được lọt vào.
    expect(sumCol(b.body.rows, "total")).toBe(SEEDED.factoryB);

    const g = await get(biPath("yield_by_product"), KEY_GLOBAL);
    expect(sumCol(g.body.rows, "total")).toBe(SEEDED_ALL);
  });

  it("defect_category: A=2 NG, B=3 NG, toàn cục=6 NG", async () => {
    const a = await get(biPath("defect_category"), KEY_FACTORY_A);
    expect(a.status).toBe(200);
    expect(sumCol(a.body.rows, "count")).toBe(SEEDED_NG.factoryA);

    const b = await get(biPath("defect_category"), KEY_FACTORY_B);
    expect(b.status).toBe(200);
    expect(sumCol(b.body.rows, "count")).toBe(SEEDED_NG.factoryB);

    const g = await get(biPath("defect_category"), KEY_GLOBAL);
    expect(sumCol(g.body.rows, "count")).toBe(SEEDED_NG_ALL);
  });

  it("shift: A=3, B=2, toàn cục=TẤT CẢ — và hàng LAI KHÔNG lọt vào A", async () => {
    const a = await get(biPath("shift"), KEY_FACTORY_A);
    expect(a.status).toBe(200);
    // ⚠ 3, KHÔNG phải 4. `getShiftReport` có sẵn đường lọc theo `factoryId` (chỉ so `factoryCode`)
    //   và đường ấy MỘT MÌNH sẽ cho 4 — hàng LAI mang đúng `FAC_A`. Con số 3 chứng minh mệnh đề
    //   `tenantScope` (AND hai mã) thật sự có mặt trong câu truy vấn.
    expect(sumCol(a.body.rows, "total")).toBe(SEEDED.factoryA);

    const b = await get(biPath("shift"), KEY_FACTORY_B);
    expect(b.status).toBe(200);
    expect(sumCol(b.body.rows, "total")).toBe(SEEDED.factoryB);

    const g = await get(biPath("shift"), KEY_GLOBAL);
    expect(sumCol(g.body.rows, "total")).toBe(SEEDED_ALL);
  });

  it("★ shift — mã KHÔNG chiếu được sang nhà máy nào ⇒ 403 có mã, KHÔNG 200-rỗng", async () => {
    const r = await get(biPath("shift"), KEY_GHOST);
    expect(r.status).toBe(403);
    expect(r.body.code).toBe("tenant_scope_factory_unresolved");
    expect(r.body.matchedFactories).toBe(0);
    expect(r.body.resolution).toBe("no_match");
    // ⚠ Câu từ chối KHÔNG được đọc thành "ca này không sản xuất gì".
    expect(r.body.error).toContain("lỗi CẤU HÌNH KHOÁ");
    expect(r.text).not.toContain("không có dữ liệu");
  });

  it("★ shift — khoá cấp TẬP ĐOÀN phủ 2 nhà máy ⇒ 403 MƠ HỒ (cửa sổ ca là của từng nhà máy)", async () => {
    const r = await get(biPath("shift"), KEY_CORP_A);
    expect(r.status).toBe(403);
    expect(r.body.code).toBe("tenant_scope_factory_ambiguous");
    expect(r.body.matchedFactories).toBe(2);
    expect(r.body.error).toContain("2 nhà máy");
  });

  it("★ khoá cấp TẬP ĐOÀN VẪN đọc được các dataset khác (không chặn quá tay)", async () => {
    // Chiều DƯƠNG: 403 ở trên phải là RIÊNG của `shift`, không phải một cổng chặn cả khoá.
    const y = await get(biPath("yield_by_product"), KEY_CORP_A);
    expect(y.status).toBe(200);
    // Lọc theo HÀNG: `product_inspections."corporateCode" = CORP_A` ⇒ 3 hàng của nhà máy A + 2
    // hàng của nhà máy NC (chúng cũng mang CORP_A). Hàng LAI mang `CORP_B` nên KHÔNG thuộc CORP_A.
    expect(y.body.rows.reduce((s: number, r: any) => s + Number(r.total), 0)).toBe(
      SEEDED.factoryA + SEEDED.nullCorp,
    );

    // ⚠⚠ BẤT ĐỐI XỨNG CÓ THẬT, ghi ra thay vì giấu: `machine_oee` chỉ thấy MÁY A, không thấy máy
    //    NC — vì nó phải đi qua bảng `factories`, mà hàng `FAC_NULLCORP` KHÔNG mang `corporateCode`
    //    nên không thuộc tập nhà máy của CORP_A. Cùng một khoá, hai con số phạm vi khác nhau.
    //    Nguồn gốc là DỮ LIỆU (`factories.corporateCode` bỏ trống — 0/3 trên CSDL thật), không
    //    phải logic; và độ lệch nghiêng về phía ĐÓNG (thiếu một máy), không về phía RÒ.
    //    Vá đúng chỗ = điền `factories.corporateCode`, KHÔNG phải nới cổng ở đây.
    const o = await get(biPath("machine_oee"), KEY_CORP_A);
    expect(o.status).toBe(200);
    expect(o.body.rows.length).toBe(OEE_ROWS.machineA);
    expect(sumCol(o.body.rows, "total_count")).toBe(SEEDED_OEE.machineA * OEE_TOTAL_PER_ROW);
  });

  it("★ khoá GHOST: các dataset khác trả RỖNG (fail-closed), không trả số toàn cục", async () => {
    for (const ds of ["inspections_daily", "defect_pareto", "yield_by_product", "defect_category"]) {
      const r = await get(biPath(ds), KEY_GHOST);
      expect(r.status, `${ds} phải 200-rỗng chứ không 500`).toBe(200);
      expect(r.body.rows.length, `${ds} rò dữ liệu cho một mã nhà máy KHÔNG tồn tại`).toBe(0);
    }
    // ⚠ `machine_oee` KHÔNG nằm trong vòng lặp trên: nguồn của nó (`oee_metrics`) không mang cột
    //   tenant, nên "không chiếu được sang nhà máy nào" ≠ "nhà máy này không có số liệu". Một
    //   trang rỗng ở đây là lời khai SAI ⇒ nó phải TỪ CHỐI, xem ca riêng bên dưới.
    const oee = await get(biPath("machine_oee"), KEY_GHOST);
    expect(oee.status).toBe(403);
    expect(oee.body.code).toBe("tenant_scope_factory_unresolved");
    expect(oee.body.error).toContain("lỗi CẤU HÌNH KHOÁ");
  });

  it("★ HÌNH DẠNG THẬT: `factories.corporateCode` NULL vẫn phải chiếu được (0/3 trên CSDL thật)", async () => {
    // ⚠ Ca CHỐNG-HỒI-QUY cho một bản vá suýt chết khi ra đời. Nếu phép chiếu mã→id đòi khớp CẢ
    //   HAI mã thì ca này ĐỎ với 403 `tenant_scope_factory_unresolved` — và đó chính xác là điều
    //   sẽ xảy ra với MỌI khoá trên `aoi_management` (0/3 hàng factories mang corporateCode).
    const o = await get(biPath("machine_oee"), KEY_NULLCORP);
    expect(o.status, `403 ở đây = tính năng chết trên bản triển khai thật`).toBe(200);
    expect(o.body.rows.length).toBe(OEE_ROWS.machineNC);
    expect(o.body.rows.every((r: any) => Number(r.machine_id) === machineNC)).toBe(true);

    const s = await get(biPath("shift"), KEY_NULLCORP);
    expect(s.status).toBe(200);
    expect(sumCol(s.body.rows, "total")).toBe(SEEDED.nullCorp);
  });

  it("★ khoá A hỏi ?factoryId của nhà máy KHÁC trên shift → 403 xung đột (không ghi đè im lặng)", async () => {
    const r = await get(biPath("shift", `&factoryId=${factoryBId}`), KEY_FACTORY_A);
    expect(r.status).toBe(403);
    expect(r.body.code).toBe("tenant_scope_conflict");

    // Chiều DƯƠNG: hỏi ĐÚNG nhà máy của mình thì vẫn chạy.
    const ok = await get(biPath("shift", `&factoryId=${factoryAId}`), KEY_FACTORY_A);
    expect(ok.status).toBe(200);
    expect(ok.body.rows.reduce((s: number, r2: any) => s + Number(r2.total), 0)).toBe(SEEDED.factoryA);
  });

  // ══════════════════════════════════════════════════════════════════════════════════════
  // 2c. ★★★ MV `hourly_yield_cache` TƯƠI — khoá phạm vi-nhà-máy vẫn KHÔNG được đọc nó.
  //
  // Nhánh này lộ ra vì lưới ĐỎ thật (xem `vi.hoisted`), và hoá ra nó CHƯA TỪNG được đo: ở mọi
  // lượt chạy trước, MV tình cờ đang cũ nên `if (!tenantFilter)` không bao giờ được thử thách.
  // Một cổng chưa từng bị thử thách không phải một cổng — nó là một dòng mã.
  //
  // MV gộp sẵn theo (bucket_hour, machine_id) và KHÔNG mang cột tenant nào. Nếu khoá nhà máy
  // đọc được nó, đáp ứng sẽ là số của TẤT CẢ nhà máy dán nhãn MỘT nhà máy — một con số SAI, tệ
  // hơn cả 403.
  // ══════════════════════════════════════════════════════════════════════════════════════
  it("★ MV TƯƠI: khoá nhà máy vẫn ra số SỐNG của riêng mình, khoá toàn cục thì đọc MV", async () => {
    const conn = await getDb();
    // Ghi mốc "vừa làm tươi" NGAY BÂY GIỜ. Bắt buộc phải tự ghi: nếu mốc vắng thì
    // `getMvFreshness()` trả null và ca này sẽ XANH mà KHÔNG hề chạm nhánh cần đo.
    await conn!.execute(sql`
      INSERT INTO db_feature_status ("feature", "status", "detail")
      VALUES ('matview_refresh_qw', 'ok', ${JSON.stringify({ lastRefreshMs: Date.now(), intervalMs: 300000 })})
      ON CONFLICT ("feature") DO UPDATE SET "status" = 'ok', "detail" = EXCLUDED."detail"
    `);
    const saved = process.env.MATVIEW_REFRESH_INTERVAL_MS;
    process.env.MATVIEW_REFRESH_INTERVAL_MS = String(365 * 24 * 3600 * 1000); // mốc luôn TƯƠI
    try {
      // ⚠ CHỨNG MINH nhánh thật sự đã đổi: khoá TOÀN CỤC nay đọc MV, mà MV không chứa cửa sổ
      //   2044 của lượt này ⇒ 0 dòng. Nếu ca này ra 5 thì MV vẫn bị coi là cũ, và toàn bộ ca
      //   dưới đây không chứng minh được gì — nên nó phải được khẳng định TRƯỚC.
      const g = await get(biPath("inspections_daily"), KEY_GLOBAL);
      expect(g.status).toBe(200);
      expect(totalFor(g.body.rows, machineA), "MV vẫn đang bị coi là CŨ ⇒ ca này vô nghĩa").toBe(0);

      // ★ Điều thật sự cần canh: khoá nhà máy A KHÔNG đi qua MV, nên vẫn ra đúng 3 hàng SỐNG
      //   của riêng A (không phải 0 của MV, và tuyệt đối không phải số gộp toàn cục).
      const a = await get(biPath("inspections_daily"), KEY_FACTORY_A);
      expect(a.status).toBe(200);
      expect(totalFor(a.body.rows, machineA)).toBe(SEEDED.factoryA);
      expect(totalFor(a.body.rows, machineB)).toBe(0);

      const b = await get(biPath("inspections_daily"), KEY_FACTORY_B);
      expect(totalFor(b.body.rows, machineB)).toBe(SEEDED.factoryB);
      expect(totalFor(b.body.rows, machineA)).toBe(0);
    } finally {
      if (saved === undefined) delete process.env.MATVIEW_REFRESH_INTERVAL_MS;
      else process.env.MATVIEW_REFRESH_INTERVAL_MS = saved;
    }
  });

  it("khoá CHƯA KHAI vẫn 403 trên CẢ SÁU dataset (mở phạm vi không nới fail-closed)", async () => {
    for (const d of BI_DATASETS) {
      const r = await get(biPath(d.name), KEY_UNDECLARED);
      expect(r.status, d.name).toBe(403);
      expect(r.body.error.code, d.name).toBe("tenant_scope_undeclared");
    }
  });

  it("đáp ứng KHÔNG mang trường `filter` ở bất kỳ trạng thái nào", async () => {
    for (const key of [KEY_FACTORY_A, KEY_GLOBAL]) {
      for (const path of ["/api/bi/datasets", biPath("inspections_daily")]) {
        const r = await get(path, key);
        expect(r.status).toBe(200);
        // ⚠ Lỗi vòng JSON không lộ ra ở `tsc` và không lộ ra ở 220 ca test — nó chỉ lộ khi gọi
        //   HTTP thật (2026-08-17: `dashboard.getStats` 500 cho MỌI người dùng). Đo trên CHUỖI
        //   THÔ, không trên đối tượng đã phân giải: một `filter` lọt ra sẽ hoặc xuất hiện ở đây,
        //   hoặc làm chết `res.json` và ca này ĐỎ vì status 500.
        expect(r.text).not.toContain('"filter"');
        expect("filter" in r.body).toBe(false);
      }
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════
// 3. /api/export — ba trạng thái qua HTTP thật
// ══════════════════════════════════════════════════════════════════════════════════════════

describe("/api/export — fail-closed + phạm vi", () => {
  it("khoá CHƯA KHAI → 403 với câu nói đúng lý do", async () => {
    for (const p of [exportPath("inspections.json"), exportPath("measurements.json"), exportPath("yield.json")]) {
      const r = await get(p, KEY_UNDECLARED);
      expect(r.status).toBe(403);
      expect(r.body.code).toBe("tenant_scope_undeclared");
      expect(r.body.error).toContain("chưa được gán phạm vi nhà máy");
      expect(r.text).not.toContain("không có dữ liệu");
    }
  });

  it("inspections.json: khoá A → CHỈ A và ĐỦ A; khoá toàn cục → A + B + mồ côi + lai", async () => {
    const a = await get(exportPath("inspections.json"), KEY_FACTORY_A);
    expect(a.status).toBe(200);
    expect(a.body.count).toBe(SEEDED.factoryA);
    expect(a.body.rows.every((r: any) => r.factoryCode === FAC_A && r.corporateCode === CORP_A)).toBe(true);

    const g = await get(exportPath("inspections.json"), KEY_GLOBAL);
    expect(g.status).toBe(200);
    expect(g.body.count).toBe(SEEDED_ALL);
    expect(g.body.rows.some((r: any) => r.factoryCode === null)).toBe(true); // hàng mồ côi CÓ mặt
    expect(g.body.rows.some((r: any) => r.factoryCode === FAC_B)).toBe(true);
  });

  it("measurements.json: khoá A → chỉ dòng đo của A; khoá toàn cục → tất cả", async () => {
    const a = await get(exportPath("measurements.json"), KEY_FACTORY_A);
    expect(a.status).toBe(200);
    expect(a.body.count).toBe(SEEDED_NG.factoryA);
    expect(a.body.rows.every((r: any) => Number(r.machineId) === machineA)).toBe(true);

    const g = await get(exportPath("measurements.json"), KEY_GLOBAL);
    expect(g.status).toBe(200);
    expect(g.body.count).toBe(SEEDED_NG_ALL);
  });

  it("khoá A hỏi factoryCode của B → 403 xung đột (không ghi đè im lặng, không rỗng im lặng)", async () => {
    const r = await get(exportPath("inspections.json", `&factoryCode=${FAC_B}`), KEY_FACTORY_A);
    expect(r.status).toBe(403);
    expect(r.body.code).toBe("tenant_scope_conflict");
    expect(r.body.error).toContain(FAC_A);
    expect(r.body.error).toContain(FAC_B);
  });

  it("khoá A hỏi ĐÚNG factoryCode của mình → vẫn đủ dữ liệu A (không chặn quá tay)", async () => {
    const r = await get(exportPath("inspections.json", `&factoryCode=${FAC_A}`), KEY_FACTORY_A);
    expect(r.status).toBe(200);
    expect(r.body.count).toBe(SEEDED.factoryA);
  });

  // ★★★ 2026-08-18 — ba dataset TỔNG HỢP nay THU HẸP ĐƯỢC. Ca "403" cũ bị THAY, không giữ lại.
  it("yield.json: A=3, B=2, toàn cục=TẤT CẢ", async () => {
    const sum = (body: any) => body.rows.reduce((s: number, r: any) => s + Number(r.total), 0);
    const a = await get(exportPath("yield.json"), KEY_FACTORY_A);
    expect(a.status).toBe(200);
    expect(sum(a.body)).toBe(SEEDED.factoryA);

    const b = await get(exportPath("yield.json"), KEY_FACTORY_B);
    expect(b.status).toBe(200);
    expect(sum(b.body)).toBe(SEEDED.factoryB);

    const g = await get(exportPath("yield.json"), KEY_GLOBAL);
    expect(g.status).toBe(200);
    expect(sum(g.body)).toBe(SEEDED_ALL);
  });

  it("defect-pareto.json: A=2 NG, B=3 NG, toàn cục=6 NG", async () => {
    const sum = (body: any) => body.rows.reduce((s: number, r: any) => s + Number(r.count), 0);
    expect(sum((await get(exportPath("defect-pareto.json"), KEY_FACTORY_A)).body)).toBe(SEEDED_NG.factoryA);
    expect(sum((await get(exportPath("defect-pareto.json"), KEY_FACTORY_B)).body)).toBe(SEEDED_NG.factoryB);
    expect(sum((await get(exportPath("defect-pareto.json"), KEY_GLOBAL)).body)).toBe(SEEDED_NG_ALL);
  });

  it("oee.json: A chỉ máy A, B chỉ máy B, toàn cục cả hai", async () => {
    const total = (body: any) => body.rows.reduce((s: number, r: any) => s + Number(r.total_count), 0);
    const a = await get(exportPath("oee.json"), KEY_FACTORY_A);
    expect(a.status).toBe(200);
    expect(a.body.rows.length).toBe(OEE_ROWS.machineA);
    expect(a.body.rows.every((r: any) => Number(r.machine_id) === machineA)).toBe(true);
    expect(total(a.body)).toBe(SEEDED_OEE.machineA * OEE_TOTAL_PER_ROW);

    const b = await get(exportPath("oee.json"), KEY_FACTORY_B);
    expect(b.body.rows.length).toBe(OEE_ROWS.machineB);
    expect(b.body.rows.every((r: any) => Number(r.machine_id) === machineB)).toBe(true);

    const g = await get(exportPath("oee.json"), KEY_GLOBAL);
    expect(g.body.rows.length).toBe(OEE_ROWS.machineA + OEE_ROWS.machineB + OEE_ROWS.machineNC);
    expect(total(g.body)).toBe(
      (SEEDED_OEE.machineA + SEEDED_OEE.machineB + SEEDED_OEE.machineNC) * OEE_TOTAL_PER_ROW,
    );
  });

  it("khoá GHOST: yield/defect-pareto RỖNG; oee TỪ CHỐI (nguồn không có cột tenant)", async () => {
    for (const ds of ["yield.json", "defect-pareto.json"]) {
      const r = await get(exportPath(ds), KEY_GHOST);
      expect(r.status, ds).toBe(200);
      expect(r.body.rows.length, ds).toBe(0);
    }
    const oee = await get(exportPath("oee.json"), KEY_GHOST);
    expect(oee.status).toBe(403);
    expect(oee.body.code).toBe("tenant_scope_factory_unresolved");
  });

  it("CSV cũng theo phạm vi (đường luồng, không phải đường JSON)", async () => {
    const a = await get(exportPath("inspections.csv"), KEY_FACTORY_A);
    expect(a.status).toBe(200);
    expect(a.text).toContain(FAC_A);
    expect(a.text).not.toContain(FAC_B);
    // 1 dòng tiêu đề + 3 dòng dữ liệu + 1 DÒNG CHỨNG NHẬN (2026-08-18, chống cắt-im-lặng)
    expect(a.text.trim().split("\n").length).toBe(1 + SEEDED.factoryA + 1);
    expect(a.text.trim().split("\n").at(-1)).toBe(`# EXPORT_COMPLETE rows=${SEEDED.factoryA}`);

    const g = await get(exportPath("inspections.csv"), KEY_GLOBAL);
    expect(g.text).toContain(FAC_B);
    expect(g.text.trim().split("\n").length).toBe(1 + SEEDED_ALL + 1);
    expect(g.text.trim().split("\n").at(-1)).toBe(`# EXPORT_COMPLETE rows=${SEEDED_ALL}`);
  });
});

// ══════════════════════════════════════════════════════════════════════════════════════════
// 4. Ràng buộc CSDL — hàng lệch không vào được (lớp phòng vệ thứ hai của 0325)
// ══════════════════════════════════════════════════════════════════════════════════════════

/**
 * ⚠ drizzle GÓI lỗi driver: `err.message` chỉ là `"Failed query: …"`. SQLSTATE và tên ràng
 * buộc nằm ở `err.cause`. Một ca canh `err.message` sẽ ĐỎ ngay cả khi ràng buộc chạy đúng —
 * và tệ hơn, một ca canh "có ném là được" sẽ XANH với BẤT KỲ lỗi nào (kể cả lỗi cú pháp).
 * Nên phải đi xuống `cause` và đọc đúng tên ràng buộc. (Cùng bài học `isMissingTable` phải
 * walk `err.cause`.)
 */
async function expectCheckViolation(run: () => Promise<unknown>): Promise<void> {
  let caught: unknown;
  try {
    await run();
  } catch (err) {
    caught = err;
  }
  expect(caught, "phải bị TỪ CHỐI, nhưng câu INSERT đã thành công").toBeDefined();
  const chain: string[] = [];
  for (let e: any = caught; e; e = e.cause) chain.push(String(e?.constraint_name ?? ""), String(e?.message ?? ""));
  expect(chain.join(" | ")).toMatch(/api_keys_data_scope_mode_chk/);
}

describe("mig 0325 — ràng buộc CHECK cưỡng chế thật", () => {
  // ⚠ BỐN hình dạng lệch, không phải một. Bản ĐẦU của ràng buộc (chuỗi `OR`) chỉ chặn được ①;
  //   ②③④ LỌT vì logic ba giá trị của SQL (`NULL = 'factory'` là NULL, và CHECK chỉ từ chối
  //   khi biểu thức là FALSE). Chính ca ② dưới đây đã bắt lỗi ấy ở lượt chạy đầu tiên.
  const bad: Array<[string, Record<string, unknown>]> = [
    ["① ('factory', NULL, NULL) — lời khai RỖNG", { dataScopeMode: "factory" }],
    ["② (NULL, <mã>, NULL) — mã lơ lửng khi chưa khai", { corporateCode: CORP_A }],
    ["③ ('global', NULL, <mã>) — toàn cục mang mã trang trí", { dataScopeMode: "global", factoryCode: FAC_A }],
    ["④ ('GLOBAL', …) — mode lạ, không nằm trong từ vựng", { dataScopeMode: "GLOBAL" }],
  ];
  for (const [label, patch] of bad) {
    it(`từ chối ${label}`, async () => {
      const conn = await getDb();
      await expectCheckViolation(() =>
        conn!.insert(apiKeys).values({
          name: `aks_bad_${label.slice(0, 1)}_${ts}`,
          keyHash: `aks_bad_hash_${label.slice(0, 1)}_${ts}`,
          scopes: ["bi:read"],
          isActive: false,
          ...patch,
        }),
      );
    });
  }

  it("chấp nhận cả ba hình dạng HỢP LỆ (không siết quá tay)", async () => {
    const conn = await getDb();
    const ids: number[] = [];
    for (const [i, patch] of [
      {},
      { dataScopeMode: "global" },
      { dataScopeMode: "factory", factoryCode: FAC_A },
    ].entries()) {
      const [row] = await conn!
        .insert(apiKeys)
        .values({
          name: `aks_ok_${i}_${ts}`,
          keyHash: `aks_ok_hash_${i}_${ts}`,
          scopes: ["bi:read"],
          isActive: false,
          ...patch,
        })
        .returning({ id: apiKeys.id });
      ids.push(row.id);
    }
    expect(ids.length).toBe(3);
    await conn!.delete(apiKeys).where(inArray(apiKeys.id, ids));
  });

  it("mọi khoá có trước 0325 đều là CHƯA KHAI (mặc định fail-closed, không backfill 'global')", async () => {
    const conn = await getDb();
    const rows = await conn!
      .select({ id: apiKeys.id, mode: apiKeys.dataScopeMode })
      .from(apiKeys)
      .where(eq(apiKeys.isActive, true));
    const declared = rows.filter((r) => r.mode !== null).map((r) => r.id).sort();
    // ĐÚNG hai khoá đã khai — cả hai đều do lưới này dựng. Nếu migration lỡ backfill 'global'
    // cho hàng cũ thì ca này ĐỎ với đúng danh sách id đã bị cấp quyền nhầm.
    expect(declared).toEqual(createdKeyIds.slice(1).sort());
  });
});
