// server/services/specGateCayV2.ts
//
// ★★★ Khối B — Task 4 (B-5, **BG-92**): NỐI LẠI SPEC-GATE CHO ĐƯỜNG v2.
//
// ── Cái lỗ này vá gì (đo được, không phải giả thuyết) ────────────────────────
// Trước bản vá: trên MỌI đường v2 (cửa trực tiếp `submitInspectionTreeV2` và cửa
// ZIP `aoiPackageRouter.commit`), một linh kiện có `value` NGOÀI giới hạn đã dạy
// mà máy khai `OK` được hệ ghi thẳng là `OK`. Bo XẤU đi lọt. Và vì đó là năng lực
// **VẮNG MẶT** (không có lời gọi nào) chứ không phải lỗi logic, KHÔNG lưới nào đỏ.
// `evaluatePointResult` (`./pointResultEvaluator`, mặc định BẬT) còn ĐÚNG MỘT điểm
// gọi sản xuất: đường v1.x PHẲNG (`machineApiRouters.ts`). Cửa ZIP mất nó ở
// `df20b31c` (BG-85); `submitInspectionTreeV2` chưa bao giờ có.
//
// Trước Khối B thì KHÔNG THỂ nối: `evaluatePointResult` cần giới hạn của một
// `pointDefId`, còn cây v2 chỉ mang `componentExtId`. Task 2 (`ac8d5ab2`) đổ đầy
// `componentExtId`, Task 5 (`5eb881bb`) dựng chiều MÁY, Task 3 (`b7bdd013`) dựng
// phép tra `(captureExtId, componentExtId) → pointDefId` lọc **cả máy lẫn sản
// phẩm**. File này là hộ tiêu thụ của ánh xạ đó.
//
// ── ⛔ CÁI BẪY TRUNG TÂM: "TRA KHÔNG RA" KHÔNG PHẢI "ĐẠT" ────────────────────
// Đo 2026-09-03, vai `avi_app`:
//   current_database()=aoi_management       machine_template_versions=0  product_captures=0
//   current_database()=aoi_management_test  machine_template_versions=0  product_captures=0
//   `measurement_point_defs` hàng CÂY còn sống (captureRowId khác NULL, deletedAt NULL): 0 / 0
// ⇒ ngày bật, **100%** linh kiện sẽ TRA KHÔNG RA. Nếu cổng coi đó là "đạt" thì nó
// là **GIẤY VÔ CAN GIẢ**: xanh trong khi KHÔNG KIỂM GÌ — tệ hơn không có cổng, vì
// nó tạo niềm tin sai (đúng lớp đã đốt dự án này ở VRAM Pha 9).
//
// ⇒ BA TRẠNG THÁI, PHÂN BIỆT ĐƯỢC VÀ ĐẾM ĐƯỢC — và trạng thái thứ ba KHÔNG PHẢI
// trạng thái thứ nhất:
//   1. **ĐẠT**  (`dat`)          — tra ra bản dạy, bản dạy CÓ giới hạn, đã chấm, không vi phạm.
//   2. **TRƯỢT** (`truot`)       — có vi phạm thật. `haCap` = số lần OK bị hạ xuống NG.
//   3. **KHÔNG KẾT LUẬN ĐƯỢC** — hai nguồn, tách riêng vì hai nguyên nhân KHÁC NHAU:
//        · `chuaDay`      — không tra ra `pointDefId` (máy chưa dạy / linh kiện ngoài cây).
//        · `khongGioiHan` — tra RA rồi, nhưng không có cặp (giới hạn, trị đo) nào chấm được.
//   (+ `tatCong` — `POINT_LIMIT_EVAL_ENABLED=false`, cổng bị tắt, cũng KHÔNG phải "đạt".)
// Bất biến: `tong === dat + truot + chuaDay + khongGioiHan + tatCong` (lưới ghim).
//
// ⚠⚠ `chuaDay` ở đây KHÔNG tạo tín hiệu WORM thứ hai. Nhánh "chưa dạy" đã có sổ
// của Task 3 (`audit_logs.action='ingest.cay.component_chua_day'`, ghi trong CHÍNH
// transaction ghi bo, xem `ghiSoLechCayDay` ở `server/db/inspection.ts`) — file này
// chỉ ĐẾM LẠI trên cùng một bản đồ, không ghi thêm hàng audit nào.
//
// ── ⚠⚠⚠ NỢ ĐO ĐƯỢC KHI VIẾT FILE NÀY: HỢP ĐỒNG CÂY DẠY KHÔNG MANG GIỚI HẠN ───
// `server/contracts/machineTemplateContract.ts` → `componentTemplate` chỉ có
// `{id, componentName, description?, roi, templateImagePath?}`. `ghiComponent`
// (`server/db/cayDay.ts`) do đó KHÔNG ghi `lowerLimit`/`upperLimit`/`criteria`/
// bất kỳ cột giới hạn nào. ⇒ Một point-def sinh ra từ cây dạy của MÁY có **mọi cột
// giới hạn NULL**, và cổng này trả `khongGioiHan` cho nó — ĐÚNG, không phải "đạt".
// Giới hạn phải do KỸ SƯ soạn ở UI điểm đo (`onConflictDoUpdate.set` của
// `ghiComponent` KHÔNG đụng các cột giới hạn, nên lượt đẩy cây sau KHÔNG xoá mất
// giới hạn đã soạn — đã kiểm). Đây đúng bằng cách đường **v1.x** vận hành hôm nay.
// ⚠ Trị `lowerLimit`/`upperLimit` mà MÁY gửi kèm TỪNG KẾT QUẢ (`ComponentDaDich`)
// CỐ Ý KHÔNG được dùng làm nguồn giới hạn: máy khai `OK` cũng chính là máy khai
// giới hạn — chấm lời khai bằng chính lời khai là một cổng rỗng. Xem báo cáo Task 4.
//
// ── ⚠⚠⚠ KHỐI C TASK 6 (BG-97) — v2 CHẤM THEO BASE VARIANT ────────────────────
// v2 chấm theo BASE variant — hợp đồng v2 không mang `variantCode` nên không phân
// giải được variant; KHÔNG đếm per-bo được (không biết bo thuộc variant nào mà
// không thêm truy vấn) — lệch spec QĐ-2.6 phần "đếm", khai tại đây và trong báo cáo.
// Đo được (2026-09-03): `machineDataContractV2` (`server/contracts/machineDataContractV2.ts`)
// 0 trường `variantCode`; `cayDay.ts` (`ghiComponent`) 0 lần chạm `variantId` khi ghi
// điểm-đo từ cây dạy của máy ⇒ MỌI point-def sinh từ đường v2 đều là BASE
// (`variantId IS NULL`), và `traPointDefCapComponent` không lọc theo variant. Vì vậy
// `variant_point_overrides` (Task 6 v1, `apDungVariantPatch`) KHÔNG được áp ở đây —
// không phải quên nối, mà là hợp đồng v2 hôm nay không có gì để nối. Ngày hợp đồng
// mọc trường `variantCode`, cầu chì này phải đỏ (đo lại `machineDataContractV2`,
// `cayDay.ts`) trước khi coi v2 "chấm đúng variant".
import {
  evaluatePointResult,
  isPointLimitEvalEnabled,
  isUnitConvertEnabled,
  type MeasurementValues,
  type PointLimitSource,
} from "./pointResultEvaluator";
// ⚠ HAI hàm THUẦN, nhập TRỰC TIẾP module (không qua barrel `../db`) — đúng nguyên
// tắc Task 3 đã ghi vào mã: "hàm THUẦN đi thẳng module; hàm ĐỌC CSDL đi qua barrel
// để lưới mock được". Không tạo vòng: `db/cayDay.ts` và `db/inspection.ts` KHÔNG
// import ngược file này (đã kiểm bằng grep).
import { khoaCapComponent } from "../db/cayDay";
import { tachTriDo } from "../db/inspection";

/** Số mẫu linh kiện TRƯỢT giữ lại để chẩn đoán — đủ nhận ra mẫu, không đủ phình log. */
const SO_MAU_TRUOT = 20;

/**
 * Nhãn ghi vào `measurement_results.remark` cho hàng cấp component đã ĐI QUA cổng.
 *
 * ⚠ VÌ SAO PHẢI CÓ NHÃN Ở HÀNG, không chỉ đếm trong bộ nhớ: brief đòi ba trạng
 * thái **đếm được**, và phép đếm nghiệm thu là một `SELECT` trên đĩa. Không nhãn
 * thì "đã chấm và đạt" với "chưa kịp chấm gì" trông y hệt nhau trên bảng.
 * · TRƯỢT dùng tiền tố `Spec gate: ` **NGUYÊN VĂN như đường v1.x** (`machineApiRouters.ts`)
 *   ⇒ một câu `remark LIKE 'Spec gate%'` bắt được CẢ HAI đường, không phải hai câu.
 */
export const NHAN_CONG_DAT = "[SG:DAT]";
export const NHAN_CONG_KHONG_KET_LUAN = "[SG:KHONG_KL]";
/**
 * Tiền tố CHUNG hai đường — đo được: v1.x ghi `Spec gate v1: value 12.5 > max 10`
 * (có thẻ phiên bản cấu hình `vtag`), v2 ghi `Spec gate: …` (cây v2 không mang
 * `pointsConfigVersion`). Câu nghiệm thu là `remark LIKE 'Spec gate%'` — MỘT câu bắt
 * CẢ HAI đường. Hằng số này tồn tại để lưới không chép tay chuỗi đó.
 */
export const TIEN_TO_CONG_CHUNG = "Spec gate";
export const TIEN_TO_CONG_TRUOT = `${TIEN_TO_CONG_CHUNG}: `;
/** Trần `remark` — cùng con số đường v1.x cắt (`.slice(0, 480)`), cột là `text`. */
const TRAN_REMARK = 480;

/**
 * ★★★ I-4 (review Khối C lượt 9) — v2/ZIP không lưu "giới hạn nào đã chấm bo" (khác
 * v1.x có `gateConfigVersion`). Ghi BASIS chấm vào CHÍNH `remark` đã có sẵn
 * (KHÔNG thêm cột — `measurement_results` là hypertable nén, thêm cột tốn kém):
 * `[SG:DAT;v=<versionId>]` khi chấm bằng giới hạn TÁI DỰNG từ `measurement_point_versions`
 * (id hàng đó), `[SG:DAT;v=LIVE]` khi chấm theo giới hạn ĐANG SỐNG. `NHAN_CONG_DAT`
 * ("[SG:DAT]" trơn) VẪN tồn tại — caller không truyền `traVersionId` cho
 * `taoCongSpecCayV2` vẫn nhận nhãn cũ, không hồi quy.
 */
export function nhanCongDatTheoBasis(versionId: number | null | undefined): string {
  const basis = versionId === null || versionId === undefined ? "LIVE" : String(versionId);
  return `${NHAN_CONG_DAT.slice(0, -1)};v=${basis}]`;
}

/**
 * I-4 — vị từ "đây có phải nhãn ĐẠT không", chấp nhận CẢ HAI dạng: `[SG:DAT]` trơn
 * (caller cũ, chưa truyền `traVersionId`) và `[SG:DAT;v=<id|LIVE>]` (v2 SAU bản vá
 * này). Lưới/nơi đọc nên dùng hàm này thay vì so `=== NHAN_CONG_DAT` — so cứng sẽ
 * bỏ lọt hàng ĐẠT có basis kèm theo.
 */
export function laNhanCongDat(remark: string | null | undefined): boolean {
  if (remark == null) return false;
  return remark === NHAN_CONG_DAT || remark.startsWith(`${NHAN_CONG_DAT.slice(0, -1)};v=`);
}

/** Ba trạng thái + hai lý do "không kết luận", tất cả ĐẾM ĐƯỢC. */
export interface ThongKeSpecGate {
  /** `POINT_LIMIT_EVAL_ENABLED` — mặc định BẬT. Task này KHÔNG đổi mặc định đó. */
  batCong: boolean;
  /** Tổng linh kiện ĐI QUA cổng (mọi lá của cây, không phụ thuộc tra được hay không). */
  tong: number;
  /** TRẠNG THÁI 1 — đã chấm bằng giới hạn ĐÃ DẠY và KHÔNG vi phạm. */
  dat: number;
  /** TRẠNG THÁI 2 — có vi phạm thật (kể cả khi máy đã tự khai NG). */
  truot: number;
  /** Trong `truot`: số lần cổng HẠ một `OK` của máy xuống `NG`. Đây là bo xấu bị chặn. */
  haCap: number;
  /** TRẠNG THÁI 3a — KHÔNG tra ra `pointDefId`. Tín hiệu WORM là sổ Task 3, không phải ở đây. */
  chuaDay: number;
  /** TRẠNG THÁI 3b — tra RA bản dạy nhưng không chấm được gì (bản dạy chưa soạn giới hạn). */
  khongGioiHan: number;
  /** Trong `khongGioiHan`: cổng 1D bị BỎ vì đơn vị không quy đổi được (doc 51 P2 CASE #11). */
  lechDonVi: number;
  /** Cổng TẮT bằng cờ ⇒ không chấm gì. KHÔNG phải "đạt". */
  tatCong: number;
  /** Tối đa {@link SO_MAU_TRUOT} mẫu `captureId/componentId: vi phạm`. */
  mauTruot: string[];
}

/** Tra giới hạn ĐÃ DẠY của một linh kiện. `undefined` = CHƯA DẠY (khác với "dạy rồi mà rỗng"). */
export type TraGioiHanDaDay = (
  captureExtId: string,
  componentExtId: string,
) => PointLimitSource | undefined;

/** Lá cây v2.0 — đúng ba trường cổng cần. Cố ý KHÔNG nhận `lowerLimit`/`upperLimit` máy khai. */
export interface LaCanCham {
  componentId: string;
  result: "OK" | "NG";
  value: string | number | null;
}

/** Kết quả chấm một lá: verdict SAU cổng + ghi chú sẽ vào `measurement_results.remark`. */
export interface KetQuaChamLa {
  result: "OK" | "NG";
  ghiChu: string | null;
}

/**
 * Cổng spec cho MỘT lượt ingest. Có TRẠNG THÁI (bộ đếm) nhưng KHÔNG có I/O:
 * không DB, không đồng hồ, không số ngẫu nhiên — cùng đầu vào cho cùng đầu ra.
 */
export interface CongSpecCayV2 {
  cham(captureExtId: string, la: LaCanCham): KetQuaChamLa;
  readonly thongKe: ThongKeSpecGate;
}

/**
 * ★★★ I-4 (review Khối C lượt 9) — hộ tra "chấm bằng basis nào" cho MỘT khoá cấp
 * component: `measurement_point_versions.id` khi tái dựng từ lịch sử, `null`/
 * `undefined` khi chấm theo giới hạn ĐANG SỐNG (LIVE) — bao gồm cả trường hợp
 * cổng snapshot không chạy (cờ tắt) hoặc `traVersionId` không được truyền.
 */
export type TraVersionIdDaDung = (captureExtId: string, componentExtId: string) => number | null | undefined;

/**
 * ★★★ Dựng cổng. `traGioiHan` là hộ cung cấp giới hạn ĐÃ DẠY — bơm vào từ ngoài để
 * file này không chạm DB và lưới chấm được cổng mà không cần Postgres.
 *
 * ⚠ MONOTONIC — thừa kế nguyên vẹn từ `evaluatePointResult`: cổng chỉ HẠ `OK` xuống
 * `NG`, KHÔNG BAO GIỜ nâng `NG` lên `OK`. Bất biến này giữ đúng lời hứa của
 * `verdictXauHon` (`shared/rollupVerdict.ts`): không tín hiệu nào được làm NHẸ tín
 * hiệu kia — đo trên 42.431 bo lịch sử, số lần `NG→OK` là 0.
 *
 * `traVersionId` (I-4, tuỳ chọn — mặc định LUÔN "LIVE" khi không truyền, GIỮ NGUYÊN
 * hành vi `[SG:DAT]` cũ tới từng byte cho caller chưa nâng cấp) — khi có, nhãn ĐẠT
 * mang thêm basis: `[SG:DAT;v=<id>]` (tái dựng từ version đó) hoặc `[SG:DAT;v=LIVE]`
 * (chấm theo giới hạn đang sống). KHÔNG thêm cột DB (hypertable nén) — ghi vào
 * CHÍNH `remark` đã có sẵn.
 */
export function taoCongSpecCayV2(traGioiHan: TraGioiHanDaDay, traVersionId?: TraVersionIdDaDung): CongSpecCayV2 {
  const batCong = isPointLimitEvalEnabled();
  const quyDoiDonVi = isUnitConvertEnabled();
  const thongKe: ThongKeSpecGate = {
    batCong,
    tong: 0,
    dat: 0,
    truot: 0,
    haCap: 0,
    chuaDay: 0,
    khongGioiHan: 0,
    lechDonVi: 0,
    tatCong: 0,
    mauTruot: [],
  };

  return {
    thongKe,
    cham(captureExtId: string, la: LaCanCham): KetQuaChamLa {
      thongKe.tong += 1;

      // Cổng TẮT bằng cờ ⇒ verdict máy đi thẳng, và điều đó được ĐẾM (không im lặng).
      if (!batCong) {
        thongKe.tatCong += 1;
        return { result: la.result, ghiChu: null };
      }

      const gioiHan = traGioiHan(captureExtId, la.componentId);
      if (gioiHan === undefined) {
        // ⛔ TRẠNG THÁI 3a — KHÔNG KẾT LUẬN. Đây là dòng mà cả task này xoay quanh:
        // trả `{result: la.result}` mà KHÔNG đếm vào `dat` là khác biệt giữa "cổng
        // thật" và "giấy vô can giả". Hàng cho linh kiện này cũng không được ghi
        // (Task 3, `ghiCayKetQua`), nên không có `remark` nào để gắn.
        thongKe.chuaDay += 1;
        return { result: la.result, ghiChu: null };
      }

      // CÙNG phép tách trị đo mà HAI cột DB dùng (`measuredValue` / `measuredValueText`)
      // — không có bản thứ hai: `tachTriDo` là chính khối v1.x đã tách ra ở Task 3.
      const triDo: MeasurementValues = tachTriDo(la.value);
      const kq = evaluatePointResult(gioiHan, triDo, la.result, { convertUnits: quyDoiDonVi });

      if (kq.violations.length > 0) {
        thongKe.truot += 1;
        if (kq.overridden) thongKe.haCap += 1;
        if (thongKe.mauTruot.length < SO_MAU_TRUOT) {
          thongKe.mauTruot.push(`${captureExtId}/${la.componentId}: ${kq.violations.join("; ")}`);
        }
        return {
          // `evaluatePointResult` chỉ trả "NG" khi hạ cấp; "NTF" không thể xuất hiện
          // ở đây vì lá v2.0 chỉ có OK|NG (cờ `ntf` là cột RIÊNG, cổng không đụng tới).
          result: kq.result === "NG" ? "NG" : la.result,
          ghiChu: `${TIEN_TO_CONG_TRUOT}${kq.violations.join("; ")}`.slice(0, TRAN_REMARK),
        };
      }

      if (!kq.evaluated) {
        // ⛔ TRẠNG THÁI 3b — tra RA bản dạy nhưng không cặp (giới hạn, trị đo) nào
        // chấm được. Hôm nay đây là ca PHỔ BIẾN sau khi máy đẩy cây dạy, vì hợp đồng
        // cây dạy KHÔNG mang trường giới hạn nào (xem khối chú thích đầu file).
        thongKe.khongGioiHan += 1;
        if (kq.unitMismatch) thongKe.lechDonVi += 1;
        return {
          result: la.result,
          ghiChu: kq.unitMismatch
            ? `${NHAN_CONG_KHONG_KET_LUAN} lech don vi`
            : NHAN_CONG_KHONG_KET_LUAN,
        };
      }

      thongKe.dat += 1;
      if (kq.unitMismatch) thongKe.lechDonVi += 1;
      // I-4 — traVersionId KHÔNG được truyền (caller cũ) ⇒ giữ NGUYÊN nhãn cũ, tới
      // từng byte (không hồi quy). Có truyền ⇒ luôn gắn basis, kể cả LIVE.
      if (traVersionId === undefined) return { result: la.result, ghiChu: NHAN_CONG_DAT };
      return { result: la.result, ghiChu: nhanCongDatTheoBasis(traVersionId(captureExtId, la.componentId)) };
    },
  };
}

/**
 * Dựng cổng TỪ kết quả tra bản dạy của Task 3 (`traPointDefCapComponent` /
 * `db.traBanDayChoCay`). CẢ HAI cửa v2.0 gọi hàm này — một bản chép tay thứ hai
 * là cách hai cửa bắt đầu chấm theo hai bảng giới hạn khác nhau (đúng cách BG-42
 * ra đời).
 *
 * ⚠ `gioiHan` khoá bằng `khoaCapComponent` — **CÙNG khoá** với `banDo` của Task 3,
 * nên "tra ra pointDefId" và "tra ra giới hạn" KHÔNG THỂ lệch nhau: chúng là hai
 * cột của cùng một hàng, lấy trong cùng một `SELECT`, lọc cùng máy + cùng sản phẩm.
 */
export function congSpecTuBanDay(tra: {
  readonly gioiHan: ReadonlyMap<string, PointLimitSource>;
  /** I-4 — CÙNG khoá `gioiHan` (xem `KetQuaTraPointDef.gioiHanVersionId`, `server/db/cayDay.ts`). */
  readonly gioiHanVersionId: ReadonlyMap<string, number | null>;
}): CongSpecCayV2 {
  return taoCongSpecCayV2(
    (cap, comp) => tra.gioiHan.get(khoaCapComponent(cap, comp)),
    (cap, comp) => tra.gioiHanVersionId.get(khoaCapComponent(cap, comp)) ?? null,
  );
}
