/**
 * ★★★ 2026-08-18 — **PHẠM VI GHI: mã tenant SUY TỪ MÁY ĐÃ XÁC THỰC, không lấy từ JSON.**
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * LỖ ĐÃ ĐO. `machineApiRouters.processInspectionSubmission` đóng dấu `corporateCode` /
 * `factoryCode` / `workshopCode` / `lineCode` vào `product_inspections` **THẲNG từ `input.*`**
 * (`z.string().optional()` — không đối chiếu gì), và `aoiPackageRouter.commit` làm y hệt với
 * `metaData?.factoryCode || metaData?.factory || null`. Chính repo này đã cấm đúng khuôn ấy ở
 * `server/db/reportAggregators.ts`: *"Danh tính … CẤM lấy từ `input`: một `input.userId` là lời
 * TỰ KHAI của người gọi, nó biến bộ lọc tenant thành một ô chọn trên giao diện của kẻ tấn công."*
 *
 * Hai đường hỏng, và **chúng KHÔNG cùng hình dạng** — đo trên `aoi_management` 2026-08-18:
 *
 *  1. **Gửi mã của nhà máy KHÁC.** `getAccessFilterConditions` lọc
 *     `corporateCode IN (…) OR factoryCode IN (…)`; một máy khai `factoryCode='NHA-MAY-B'` nộp
 *     bản ghi kiểm THẲNG vào phạm vi xem của nhà máy B. Đây là lỗ THẬT, ở cả hai trục.
 *
 *  2. **Không gửi mã.** ⚠ Bản mô tả nhiệm vụ nói hàng NULL/NULL sẽ *"MỌI nhà máy đều thấy"* sau
 *     mig 0327. Điều đó **ĐÚNG cho `inspection_packages`** (`relrowsecurity = true`, vị từ
 *     `app_tenant_allows("factoryCode", NULL)` ⇒ hai đối số NULL ⇒ nhánh 0327 cho `TRUE` ⇒ hiện
 *     ra với mọi tenant; đo được 160/160 gói trong `aoi_management_test` đang là NULL) và **SAI
 *     cho `product_inspections`**: bảng ấy `relrowsecurity = false` — nó KHÔNG có một chính sách
 *     RLS nào. Hàng NULL/NULL ở đó không "chia cho tất cả"; nó rơi ra ngoài **cả hai** vế của
 *     `OR` ⇒ **biến mất khỏi mọi báo cáo bị thu hẹp**. Vẫn phải chặn, nhưng vì lý do NGƯỢC LẠI:
 *     mất dữ liệu, không phải rò dữ liệu. Ghi ra đây vì một bản vá dựa trên lý do sai sẽ được
 *     "tối ưu" đi bởi người đọc sau.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ★★★ **NĂM TRƯỜNG, BỐN LUẬT KHÁC NHAU** — mỗi luật là một SỐ ĐO, không phải một lựa chọn
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *
 *  ┌───────────────┬─────────────────────────────┬──────────────────────────────────────────────┐
 *  │ trường        │ suy từ đâu                  │ đo trên `aoi_management` (22.996 bản ghi)     │
 *  ├───────────────┼─────────────────────────────┼──────────────────────────────────────────────┤
 *  │ factoryCode   │ `factories.code`            │ suy được 22.996/22.996 · khai lệch **0**      │
 *  │ workshopCode  │ `workshops.code`            │ khai lệch **0**                               │
 *  │ lineCode      │ `production_lines.code`     │ khai lệch **0**                               │
 *  │ corporateCode │ `factories."corporateCode"` │ ⚠ suy ra **NULL 22.996/22.996** — xem dưới    │
 *  │ stageCode     │ **KHÔNG SUY ĐƯỢC**          │ ⚠ không phải một nút phân cấp — xem dưới     │
 *  └───────────────┴─────────────────────────────┴──────────────────────────────────────────────┘
 *
 * ⚠⚠ **`corporateCode` KHÔNG suy được như ba trường kia, và bản mô tả nhiệm vụ đã nói SAI chỗ
 * này.** Bảng `corporates` **RỖNG** (0 hàng) và cả 3 hàng `factories` đều có
 * `corporateCode IS NULL`, trong khi **22.995/22.996** bản ghi kiểm đang mang `'SIM'`. Nếu cứ
 * "suy rồi ghi đè" thì mọi hàng mới mất `'SIM'` — tức bản vá chống rò rỉ tự tay **xoá một trục
 * tenant** khỏi dữ liệu. Luật ở đây vì thế là:
 *   • nhà máy CÓ `corporateCode` ⇒ đó là sự thật, khai khác ⇒ **TỪ CHỐI**;
 *   • nhà máy KHÔNG có ⇒ lời khai **không kiểm chứng được ⇒ BỎ** (ghi NULL) + cảnh báo nêu tên
 *     máy. KHÔNG từ chối, vì `corporateCode` NULL kèm `factoryCode` THẬT là an toàn ở cả hai
 *     bảng (`app_tenant_allows` chỉ mở khi **cả hai** đối số NULL), nên từ chối ở đây là bắt cả
 *     đội máy ngừng nộp để đổi lấy đúng con số 0 về rủi ro.
 *   • và migration **0329** trám gốc: điền `corporates`/`factories."corporateCode"` từ chính dữ
 *     liệu đã có, để giá trị SUY RA bằng đúng giá trị đang được khai ⇒ 0 hàng đổi nghĩa.
 *
 * ⚠⚠ **`stageCode` KHÔNG PHẢI trục tenant và KHÔNG suy được.** Đo: giá trị của nó là
 * `AVI · FCT · SPI · AOI · ICT` (4.599 hàng mỗi loại) — nhãn CÔNG ĐOẠN của máy, không phải một
 * nút trong `factories → workshops → production_lines → stations`. Bảng `line_stages` **rỗng**;
 * `stageCode` không khớp `stations.code` (0/22.995), không khớp `stations.name` (0), không khớp
 * `machines.code` (0). Không một chính sách RLS nào và không một mệnh đề nào của
 * `getAccessFilterConditions` nhắc tới nó. ⇒ Nó ở lại **NGUYÊN VĂN lời khai của máy**, và đó là
 * kết luận chứ không phải bỏ sót: "suy" nó ra khỏi tên trạm là bịa một quan hệ không tồn tại.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * ⚠ BA BẪY CỦA REPO NÀY, ĐỀU ĐƯỢC NÉ TẠI ĐÂY
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 *  1. **Lỗi vòng JSON** — `MacTenantGhi` chỉ mang chuỗi/số. KHÔNG có ô `filter` nào (một
 *     `ResolvedDataScope` mang SQL drizzle có tham chiếu vòng ⇒ superjson chết, và `tsc` KHÔNG
 *     bắt được vì TS chỉ cấm thuộc tính thừa với *object literal*).
 *  2. **CSDL sập ≠ chuỗi gãy.** `FORBIDDEN` nằm trong `PERMANENT_TRPC_CODES`
 *     (`inspectionStoreForward`), nên một lượt từ chối KHÔNG bị đẩy vào WAL — đúng ý. Nhưng nếu
 *     lúc CSDL sập ta cũng ném `FORBIDDEN` thì mọi bo mạch của một lần chớp mạng bị **từ chối
 *     vĩnh viễn** thay vì được đệm lại. Nên `maTenantCuaMay` hỏi `getDb()` TRƯỚC và ném
 *     `INTERNAL_SERVER_ERROR/DB_UNAVAILABLE` (TRANSIENT ⇒ vào WAL) cho ca ấy.
 *  3. **Đường ingest là đường NÓNG NHẤT** (một lô tới 200 bo qua cùng một máy). Chuỗi phân cấp
 *     được nhớ đệm theo `machineId` với TTL ngắn — xem `TTL_MS`.
 *
 * ⚠ **0 DÒNG IM LẶNG LÀ NÓI DỐI.** Mọi lượt từ chối mang mã máy-đọc-được trong CHÍNH câu chữ
 * (cửa REST `/api/public/**` và `/api/machine/**` trả `{success:false, error: message}` —
 * `shape.data.appCode` KHÔNG đi qua cửa ấy, nên client Android/C#/Python chỉ còn câu chữ để bám).
 * Tiền lệ: `dataset_not_tenant_scopable` (`api/export/biRouter.ts`), `SCOPE_MISMATCH`
 * (`publicProductScope.ts`), `external_factory_scope_denied` (`routes/_phamViNgoai.ts`).
 */
import { appError } from "../_core/appError";
import * as db from "../db";
import { chuoiPhanCapCuaTram } from "./publicProductScope";

/** Máy khai một mã tenant KHÁC mã suy ra từ chính bản ghi máy của nó. */
export const MA_LECH_KHAI = "machine_tenant_claim_mismatch";

/** Không đi hết được `machine → station → line → workshop → factory` (CSDL VẪN SỐNG). */
export const MA_KHONG_SUY_DUOC = "machine_tenant_unresolved";

/** Chuỗi tenant đã phân giải của một máy — chỉ mã, không đối tượng SQL (bẫy 1). */
export interface MaTenantCuaMay {
  readonly factoryId: number;
  readonly machineCode: string;
  readonly corporateCode: string | null;
  readonly factoryCode: string;
  readonly workshopCode: string;
  readonly lineCode: string;
  readonly stationCode: string;
}

/** Lời TỰ KHAI trong JSON — nhận đủ, dùng làm ĐỐI CHIẾU, không bao giờ dùng làm giá trị. */
export interface MaTenantKhai {
  readonly corporateCode?: string | null;
  readonly factoryCode?: string | null;
  readonly workshopCode?: string | null;
  readonly lineCode?: string | null;
}

/**
 * Bốn giá trị SẼ ĐƯỢC ĐÓNG DẤU. `undefined` = bỏ trống cột (drizzle ⇒ NULL).
 *
 * ⚠ Hình dạng này cố ý **KHÔNG THỂ QUÊN**: nơi gọi trải bốn ô ra thẳng đối tượng insert, không
 * phải nhớ viết một `if (cờ)` ở từng ô. Khi cờ TẮT, chính bốn ô này mang lại lời khai gốc — nên
 * đường gọi chỉ có MỘT hình dạng ở cả hai chế độ.
 */
export interface MacTenantGhi {
  readonly corporateCode: string | undefined;
  readonly factoryCode: string | undefined;
  readonly workshopCode: string | undefined;
  readonly lineCode: string | undefined;
  /** `undefined` khi cờ TẮT ⇒ nơi dựng đường lưu tệp phải lùi về khuôn cũ. */
  readonly chuoi: MaTenantCuaMay | undefined;
  readonly nguon: "suy" | "khai";
}

/**
 * Cờ HOÀN NGUYÊN, mặc định **BẬT** theo số đo (0 hàng bị từ chối trên `aoi_management`).
 *
 * ⚠ Đặt `INGEST_TENANT_DERIVE_ENABLED=false` là **MỞ LẠI ĐÚNG CÁI LỖ NÀY** — nó tồn tại chỉ để
 * một sự cố ingest ban đêm có đường lùi trong 5 giây, không phải để tắt cho tiện.
 */
export function suyMaTenantBat(): boolean {
  return (process.env.INGEST_TENANT_DERIVE_ENABLED ?? "true").toLowerCase() !== "false";
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// BỘ NHỚ ĐỆM theo MÁY (bẫy 3)
// ══════════════════════════════════════════════════════════════════════════════════════════════

const TTL_MS = Number.parseInt(process.env.INGEST_TENANT_CACHE_TTL_MS ?? "60000", 10) || 60_000;
const boNho = new Map<number, { luc: number; chuoi: MaTenantCuaMay }>();

/** Chỉ dùng trong kiểm thử: một máy vừa bị dời trạm phải được đọc lại ngay. */
export function _xoaBoNhoTenant(): void {
  boNho.clear();
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// PHÂN GIẢI
// ══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * `machines` → chuỗi mã tenant. **NÉM** khi không đi hết được (xem bẫy 2 cho phép phân biệt
 * "CSDL sập" với "chuỗi gãy" — hai lớp lỗi có hai số phận WAL hoàn toàn khác nhau).
 */
export async function maTenantCuaMay(machine: {
  id: number;
  code: string;
  stationId: number | null;
}): Promise<MaTenantCuaMay> {
  const nho = boNho.get(machine.id);
  if (nho && Date.now() - nho.luc < TTL_MS) return nho.chuoi;

  // BẪY 2 — hỏi CSDL trước. `db.getStationById` nuốt "CSDL sập" thành `undefined`, và
  // `undefined` ở đây sẽ thành một lượt từ chối VĨNH VIỄN cho một sự cố TẠM THỜI.
  // ⚠ Lấy `getDb` từ BARREL `../db` (không từ `../db/connection`): cả bốn phép tra cứu của chuỗi
  // đi qua đúng MỘT mặt module, nên một lưới đơn vị `vi.mock("../db")` điều khiển được toàn bộ —
  // trộn hai mặt lại sẽ cho ra "cửa CSDL là giả nhưng cửa kết nối là thật", một trạng thái không
  // ai suy được từ tệp kiểm thử.
  const database = await db.getDb();
  if (!database) {
    throw appError("INTERNAL_SERVER_ERROR", "DB_UNAVAILABLE", undefined, "Database not available");
  }

  const station = machine.stationId != null ? await db.getStationById(machine.stationId) : undefined;
  const chuoi = station ? await chuoiPhanCapCuaTram(station, true) : null;
  if (!station || !chuoi || !chuoi.nhaMay) {
    throw appError(
      "FORBIDDEN",
      "SCOPE_MISMATCH",
      { entity: "machine", parent: "factory" },
      `${MA_KHONG_SUY_DUOC}: machine '${machine.code}' cannot be resolved to a factory ` +
        `(machine → station → line → workshop → factory chain is broken). The submission is ` +
        `REFUSED instead of being stored with empty tenant codes, because a row with no tenant ` +
        `code is either shared with every factory (inspection_packages, RLS) or invisible to ` +
        `every scoped report (product_inspections). Fix the machine's station assignment.`,
    );
  }

  const ket: MaTenantCuaMay = {
    factoryId: chuoi.factoryId,
    machineCode: machine.code,
    corporateCode: chuoi.nhaMay.corporateCode,
    factoryCode: chuoi.nhaMay.code,
    workshopCode: chuoi.workshopCode,
    lineCode: chuoi.lineCode,
    stationCode: station.code,
  };
  boNho.set(machine.id, { luc: Date.now(), chuoi: ket });
  return ket;
}

/**
 * Chuẩn hoá một lời khai để ĐỐI CHIẾU. `''`/khoảng trắng = KHÔNG khai (không phải khai rỗng).
 *
 * ⚠ So sánh KHÔNG phân biệt hoa-thường là có chủ ý: một máy gửi `'sim-fac'` thay vì `'SIM-FAC'`
 * là lỗi CHÍNH TẢ, không phải máy của nhà máy khác — bắt nó dừng dây chuyền không mua được gì.
 * An toàn vẫn nguyên vẹn vì giá trị ĐƯỢC GHI luôn là bản SUY RA (dạng chuẩn), không phải lời khai.
 */
function chuan(x: string | null | undefined): string | null {
  const t = x?.trim();
  return t ? t.toUpperCase() : null;
}

/**
 * Đối chiếu lời khai với chuỗi suy ra. Lệch ⇒ **TỪ CHỐI** kèm mã máy-đọc-được.
 *
 * ⚠ `corporateCode` có luật RIÊNG (xem bảng năm-trường ở đầu file): chỉ đối chiếu khi nhà máy
 * THỰC SỰ mang một mã tập đoàn. Nhà máy không mang mã ⇒ lời khai bị BỎ, có cảnh báo, không ném.
 */
export function doiChieuKhai(suy: MaTenantCuaMay, khai: MaTenantKhai): void {
  const cap: Array<[truc: string, khaiVal: string | null | undefined, suyVal: string | null]> = [
    ["factoryCode", khai.factoryCode, suy.factoryCode],
    ["workshopCode", khai.workshopCode, suy.workshopCode],
    ["lineCode", khai.lineCode, suy.lineCode],
    ["corporateCode", khai.corporateCode, suy.corporateCode],
  ];
  for (const [truc, khaiVal, suyVal] of cap) {
    const k = chuan(khaiVal);
    if (k === null) continue; // không khai ⇒ không có gì để mâu thuẫn
    const s = chuan(suyVal);
    if (s === null) {
      // Chỉ xảy ra với `corporateCode` (ba trục kia đã được `maTenantCuaMay` bảo đảm khác null).
      console.warn(
        `[phamViGhiMay] ${MA_LECH_KHAI}/unverifiable — machine='${suy.machineCode}' declares ` +
          `${truc}='${String(khaiVal).trim()}' but factory '${suy.factoryCode}' carries no ${truc}. ` +
          `The claim is DROPPED (column stays NULL): an unverifiable tenant claim is exactly the ` +
          `self-declaration this gate removes. Fix it by setting factories."${truc}", not by ` +
          `letting the machine assert it.`,
      );
      continue;
    }
    if (k !== s) {
      throw appError(
        "FORBIDDEN",
        "SCOPE_MISMATCH",
        { entity: "inspection", parent: "factory" },
        `${MA_LECH_KHAI}: machine '${suy.machineCode}' is registered under ${truc}='${suyVal}' ` +
          `but this submission declares ${truc}='${String(khaiVal).trim()}'. The submission is ` +
          `REFUSED rather than filed into another factory's scope. Either the machine's ` +
          `configuration or its station assignment is wrong — one of them must be corrected.`,
      );
    }
  }
}

/**
 * ★ CỬA DUY NHẤT của đường GHI: phân giải + đối chiếu + trả đúng bốn ô sẽ đóng dấu.
 *
 * Cờ TẮT ⇒ trả lại **nguyên văn lời khai** (`nguon: "khai"`), tức đúng hành vi trước bản vá.
 */
export async function macTenantChoGhi(
  machine: { id: number; code: string; stationId: number | null },
  khai: MaTenantKhai,
): Promise<MacTenantGhi> {
  if (!suyMaTenantBat()) {
    return {
      corporateCode: khai.corporateCode?.trim() || undefined,
      factoryCode: khai.factoryCode?.trim() || undefined,
      workshopCode: khai.workshopCode?.trim() || undefined,
      lineCode: khai.lineCode?.trim() || undefined,
      chuoi: undefined,
      nguon: "khai",
    };
  }
  const suy = await maTenantCuaMay(machine);
  doiChieuKhai(suy, khai);
  return {
    corporateCode: suy.corporateCode ?? undefined,
    factoryCode: suy.factoryCode,
    workshopCode: suy.workshopCode,
    lineCode: suy.lineCode,
    chuoi: suy,
    nguon: "suy",
  };
}

// ══════════════════════════════════════════════════════════════════════════════════════════════
// ĐƯỜNG LƯU TỆP do MÁY CHỦ tự sinh
// ══════════════════════════════════════════════════════════════════════════════════════════════

/** Đoạn thay cho `corporateCode` NULL. Phải KHÁC RỖNG để độ sâu đường dẫn là HẰNG SỐ. */
export const DOAN_KHONG_TAP_DOAN = "_no-corp";

/**
 * Một đoạn đường dẫn an toàn. Mã là `varchar(50)` do người vận hành nhập, nên nó **có thể** chứa
 * `/`, `..`, khoảng trắng. Một đoạn rỗng sau khi lọc ⇒ `_` (không bao giờ trả `''`: hai dấu `/`
 * liền nhau làm phép so TIỀN TỐ ở lượt uỷ quyền đọc ảnh sau này sai lệch).
 */
export function doanDuongDan(x: string | null | undefined): string {
  const s = (x ?? "").trim().replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^\.+|\.+$/g, "");
  return s.length > 0 ? s.slice(0, 64) : "_";
}

/**
 * ★★★ Khoá lưu trữ gói AOI, **do máy chủ sinh** theo chuỗi phân cấp đã suy:
 *
 *   `aoi/<corporateCode>/<factoryCode>/<workshopCode>/<lineCode>/<machineCode>/yyyy/mm/dd/<id>.zip`
 *
 * Mục đích ĐO ĐƯỢC: lượt uỷ quyền đọc ảnh sau này chỉ còn là **một phép so tiền tố đường dẫn**
 * (`O(1)`, không một truy vấn nào cho mỗi ảnh), thay vì phải tra ngược gói → máy → nhà máy.
 *
 * ⚠ **TỆP CŨ KHÔNG BỊ ĐỤNG TỚI.** Khoá được sinh **một lần** ở `presign` rồi ghi vào
 * `inspection_packages."storageKey"`; mọi đường ĐỌC (`aoiPackageRouter.getImage/downloadZip`,
 * `/api/aoi/image/:packageId/:fileName`, `/api/aoi/download/:packageId`) đều đọc `pkg.storageKey`
 * của CHÍNH hàng đó và **không bao giờ dựng lại đường dẫn**. Gói cũ giữ khoá cũ
 * (`aoi/<machineCode>/yyyy/mm/dd/…`) và vẫn phục vụ được từng byte.
 */
export function khoaLuuTruGoi(chuoi: MaTenantCuaMay, packageId: string, luc = new Date()): string {
  const yyyy = luc.getFullYear();
  const mm = String(luc.getMonth() + 1).padStart(2, "0");
  const dd = String(luc.getDate()).padStart(2, "0");
  const corp = chuoi.corporateCode ? doanDuongDan(chuoi.corporateCode) : DOAN_KHONG_TAP_DOAN;
  return (
    `aoi/${corp}/${doanDuongDan(chuoi.factoryCode)}/${doanDuongDan(chuoi.workshopCode)}/` +
    `${doanDuongDan(chuoi.lineCode)}/${doanDuongDan(chuoi.machineCode)}/` +
    `${yyyy}/${mm}/${dd}/${doanDuongDan(packageId)}.zip`
  );
}
