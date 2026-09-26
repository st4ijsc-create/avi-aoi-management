/**
 * Khối B — Task 2 (B-2): PHÉP KIỂM **THUẦN** cho cây dạy, chạy ở CỬA
 * `machineApiRouter.submitMachineTemplate` NGAY SAU `authenticateMachine` và
 * TRƯỚC mọi lượt ghi.
 *
 * ⚠ VÌ SAO KHÔNG ĐẶT TRONG HỢP ĐỒNG ZOD: `machineTemplateContract` khai HÌNH
 * DẠNG (một cây như thế nào thì gọi là một cây). Những phép kiểm ở đây khai
 * ĐIỀU KIỆN GHI ĐƯỢC — chúng chỉ đúng vì ĐƯỜNG GHI hội tụ theo những khoá cụ
 * thể, và vì cột `measurement_point_defs.code` chỉ chứa được 50 ký tự. Một cửa
 * khác (ví dụ một cửa "xoá bản dạy" tường minh) có quyền chấp nhận cây rỗng mà
 * không phải nới hợp đồng.
 *
 * ⚠ HÀM THUẦN, KHÔNG I/O: gọi được trong lưới đơn vị không cần CSDL, và không có
 * đường nào để ai đó lỡ đặt một tác dụng phụ TRƯỚC xác thực vào đây (I-4).
 */
import type { MachineTemplate } from "../contracts/machineTemplateContract";

/**
 * Trần độ dài `componentExtId` **ĐO ĐƯỢC**, không phải chọn:
 * `measurement_point_defs.code` là **varchar(50)** (NOT NULL) và đường ghi dùng
 * `componentExtId` LÀM `code` (xem `server/db/cayDay.ts` — `code` là cột NOT NULL
 * duy nhất không có gì khác để điền mà vẫn giữ được tính duy nhất).
 * Hợp đồng cho `componentExtId` tới **64** (khớp cột `componentExtId` varchar(64)).
 * ⇒ Khoảng **51..64 ký tự** hợp lệ với hợp đồng nhưng vỡ `[22001]` ở cột `code`,
 * và thông điệp Postgres KHÔNG nêu tên linh kiện nào. Chặn tại đây, nêu tên.
 * Mẫu máy thật: id dài nhất **36** ký tự (UUID) ⇒ siết này không từ chối mẫu nào.
 */
export const TRAN_MA_DIEM_DO = 50;

/**
 * Trần số linh kiện MỘT lượt đẩy. Hợp đồng KHÔNG giới hạn độ dài mảng nào ⇒ một
 * lượt đẩy là một transaction có số lệnh INSERT do NGƯỜI GỬI quyết định.
 * ⚠ Đây là một con số CHỌN, không phải đo: mẫu máy thật có **16** linh kiện; 20.000
 * là ~1.250 lần mẫu thật — đủ rộng để không ai gặp trong vận hành, đủ hẹp để một
 * payload dị dạng không giữ một transaction mở vô hạn.
 */
export const TRAN_SO_COMPONENT_MOI_LUOT = 20_000;

export interface KetQuaKiemTraCayDay {
  /** Danh sách lỗi, RỖNG = ghi được. Mỗi lỗi là một câu tiếng Việt nêu ĐÚNG chỗ. */
  readonly loi: readonly string[];
  readonly soSurface: number;
  readonly soPosition: number;
  readonly soCapture: number;
  readonly soComponent: number;
}

/** Gom các phần tử xuất hiện ≥2 lần, giữ nguyên thứ tự gặp đầu. */
function timTrung(danhSach: readonly string[]): string[] {
  const dem = new Map<string, number>();
  for (const x of danhSach) dem.set(x, (dem.get(x) ?? 0) + 1);
  return [...dem.entries()].filter(([, n]) => n > 1).map(([k]) => k);
}

/**
 * ★★★ BỐN phép kiểm trùng khoá — mỗi phép tương ứng ĐÚNG một khoá hội tụ của
 * đường ghi. Không có chúng, một payload trùng khoá **hội tụ vào chính nó**:
 * hai phần tử cùng khoá ghi đè nhau trong CÙNG một lượt, hệ nhận 2 nhưng lưu 1,
 * và không lỗi nào được ném — đúng lớp "mất dữ liệu IM LẶNG".
 *
 * | Khoá kiểm                    | Vì sao PHẢI duy nhất                                    |
 * |------------------------------|---------------------------------------------------------|
 * | `surfaceName` toàn cây       | `uq_product_surfaces_model_may_name` (productModelId, **machineId**, surfaceName) — Task 5 (0347) thêm chiều máy; trong MỘT payload của MỘT máy thì phạm vi kiểm không đổi |
 * | `positionId` trong mỗi surface | `uq_product_positions_surface_posid`                   |
 * | `capture.id` trong mỗi position | `uq_product_captures_position_extid`                  |
 * | `component.id` **TOÀN CÂY**  | (a) `uq_point_defs_cay_may_code` (Task 5, 0347) — `code` = `componentExtId`, duy nhất theo **(productModelId, variant, machineId)**, KHÔNG theo capture; (b) Task 4 tra `pointDefId` **từ `componentExtId`** — trùng id ⇒ join RA HAI HÀNG, verdict lấy hàng nào là ngẫu nhiên. |
 *
 * ⚠ Task 5 (0347) — index (a) TRƯỚC đây là `uq_point_defs_product_variant_code`,
 * KHÔNG có chiều máy. Hai máy dạy CÙNG sản phẩm với CÙNG bộ UUID linh kiện (clone
 * bản dạy từ máy A sang máy B) sẽ vỡ `23505` ở đó. Nay hàng CÂY đi index riêng có
 * `COALESCE("machineId",0)`, còn `uq_point_defs_product_variant_code` thu về đúng
 * hàng PHẲNG (`captureRowId IS NULL`) — nghĩa cũ giữ nguyên cho 100% hàng đang sống.
 *
 * ⚠ Ba khoá đầu chỉ cần duy nhất TRONG PHẠM VI CHA; riêng `component.id` phải duy
 * nhất TOÀN CÂY — phạm vi RỘNG HƠN chỗ nó được ghi. Đây không phải phòng thủ dư:
 * `measurement_results.componentExtId` (phía kết quả) không mang `captureRowId`
 * nào để thu hẹp, nên toàn-cây là phạm vi join THẬT của Task 4.
 */
export function kiemTraCayDay(cay: MachineTemplate): KetQuaKiemTraCayDay {
  const loi: string[] = [];

  const tenSurface: string[] = [];
  const maComponentToanCay: string[] = [];
  let soPosition = 0;
  let soCapture = 0;
  let soComponent = 0;

  for (const surface of cay.surfaces) {
    tenSurface.push(surface.surfaceName);
    const maPosition: string[] = [];

    for (const position of surface.positions) {
      soPosition += 1;
      maPosition.push(position.positionId);
      const maCapture: string[] = [];

      for (const capture of position.captures) {
        soCapture += 1;
        maCapture.push(capture.id);

        for (const component of capture.components) {
          soComponent += 1;
          maComponentToanCay.push(component.id);
          if (component.id.length > TRAN_MA_DIEM_DO) {
            loi.push(
              `component id "${component.id}" dài ${component.id.length} ký tự, quá trần ` +
                `${TRAN_MA_DIEM_DO} của cột measurement_point_defs.code varchar(50) (hợp đồng cho tới 64 ` +
                `vì cột componentExtId là varchar(64) — hai cột KHÁC sức chứa).`,
            );
          }
        }
      }

      for (const trung of timTrung(maCapture)) {
        loi.push(
          `capture id "${trung}" xuất hiện nhiều lần trong position "${position.positionId}" ` +
            `(surface "${surface.surfaceName}") — đường ghi hội tụ theo (positionRowId, captureExtId) ` +
            `nên hai capture trùng id sẽ ghi đè nhau IM LẶNG.`,
        );
      }
    }

    for (const trung of timTrung(maPosition)) {
      loi.push(
        `positionId "${trung}" xuất hiện nhiều lần trong surface "${surface.surfaceName}" — ` +
          `đường ghi hội tụ theo (surfaceRowId, positionId) nên hai position trùng mã sẽ ghi đè nhau IM LẶNG.`,
      );
    }
  }

  for (const trung of timTrung(tenSurface)) {
    loi.push(
      `surfaceName "${trung}" xuất hiện nhiều lần trong cây — CSDL chỉ có unique index ` +
        `(productModelId, surfaceName) (KHÔNG có index nào trên surfaceExtId), nên hai mặt trùng tên ` +
        `sẽ ghi đè nhau IM LẶNG.`,
    );
  }

  for (const trung of timTrung(maComponentToanCay)) {
    loi.push(
      `component id "${trung}" xuất hiện nhiều lần trong CÂY — id linh kiện phải duy nhất TOÀN CÂY: ` +
        `nó vừa là measurement_point_defs.code (duy nhất theo productModelId), vừa là khoá Task 4 dùng ` +
        `để tra bản dạy từ kết quả (measurement_results.componentExtId).`,
    );
  }

  if (cay.surfaces.length === 0) {
    loi.push(
      `cây dạy RỖNG (surfaces: []) — TỪ CHỐI. Một lượt đẩy rỗng không phân biệt được với một lần ` +
        `xuất hỏng, và đường ghi xoá mềm linh kiện theo từng capture CÓ TRONG payload; nhận cây rỗng ` +
        `là mở đường cho một payload hỏng làm rỗng bản dạy. Muốn xoá bản dạy thì cần một cửa tường minh, ` +
        `không phải một cây rỗng.`,
    );
  }

  if (soComponent > TRAN_SO_COMPONENT_MOI_LUOT) {
    loi.push(
      `cây dạy có ${soComponent} linh kiện, quá trần ${TRAN_SO_COMPONENT_MOI_LUOT} của MỘT lượt đẩy ` +
        `(cả cây ghi trong MỘT transaction).`,
    );
  }

  return {
    loi,
    soSurface: cay.surfaces.length,
    soPosition,
    soCapture,
    soComponent,
  };
}
