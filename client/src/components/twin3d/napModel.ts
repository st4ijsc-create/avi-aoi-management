/**
 * napModel.ts — GIẢI PHÂN GIẢI + BỘ NHỚ ĐỆM model glTF theo từng thiết bị (#4).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ SPEC GHI SAI TÊN TỆP — `boNhoModel.ts` KHÔNG TỒN TẠI, VÀ KHÔNG NÊN TẠO
 * ════════════════════════════════════════════════════════════════════════════
 * §11c.3 đo được: spec đặt đích của #4 là `boNhoModel.ts`, tệp đó không có ở cả
 * client lẫn server. §11g nhắc lại và giao cho lô này TỰ CHỌN kiến trúc.
 *
 * Chọn KHÔNG dựng `boNhoModel.ts` vì bộ đệm đã có rồi: `mucChiTiet.ts` mang
 * `BoDemGlbLru` (trần cứng 8 GLB, chính sách LRU tất định, trả khoá bị đẩy ra
 * cho `dispose()` theo RB-7) cùng `chonMucChiTiet` bốn bậc. Dựng một bộ đệm thứ
 * hai bên cạnh nó là đúng lớp lỗi G12 ("hai bản cài đặt, hiếm khi chỉ lệch một
 * chỗ") — và cái lệch ở đây sẽ là TRẦN 8, tức ngân sách §4.
 *
 * Tệp này vì thế chỉ làm ba việc mà `mucChiTiet.ts` cố ý không làm:
 *   1. GIẢI PHÂN GIẢI ba cấp (máy → chủng loại → không có) — §10B.2.
 *   2. Quy một danh sách máy + bảng model thành đầu vào `MayChoLod` (`coModel`).
 *   3. Bắc cầu từ kết quả LRU sang lệnh nạp/thả cho tầng three.
 *
 * ★ MODULE THUẦN: không import three, không import react. Phần chạm three nằm
 *   ở `loi/ModelMay.tsx`; phần quyết định nằm ở đây và test được không cần WebGL.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ GIẢI PHÂN GIẢI PHẢI KHỚP `pickBestModel` CỦA SERVER, KHÔNG ĐƯỢC KHÁC
 * ════════════════════════════════════════════════════════════════════════════
 * `server/services/twin/modelRegistry.ts:57 pickBestModel` đã cài đúng thứ tự
 * §10B.2 (machineId > equipmentId > equipmentClass, tie-break theo version rồi
 * id). Bản ở đây làm việc trên MỘT DANH SÁCH ĐÃ TẢI (`twin.models.list`) để
 * cảnh 3D không phải gọi `resolve` 43 lần — nhưng nó phải cho CÙNG kết quả.
 *
 * ⚠ Điểm dễ lệch nhất và đã cố ý sao đúng: hàng cấp CHỦNG LOẠI chỉ được tính
 *   khi `machineId == null && equipmentId == null`. Bỏ điều kiện đó thì một
 *   hàng gán cho máy #7 (mà cũng có `equipmentClass='AOI'`) sẽ được đem dùng
 *   cho CẢ 14 máy AOI — model của một máy lặng lẽ tràn sang mọi máy cùng loại.
 */

import {
  BoDemGlbLru,
  TRAN_GLB_DONG_THOI,
  chonMucChiTiet,
  type CauHinhLod,
  type KetQuaChonMucChiTiet,
  type MayChoLod,
} from "./mucChiTiet";
import type { DiemScene } from "./heToaDo";

/**
 * Một hàng `equipment_3d_models` ở dạng client cần. Tên trường giữ NGUYÊN tên
 * cột — đổi tên ở tầng này chỉ tạo thêm một bảng ánh xạ để trôi.
 */
export interface HangModel {
  id: number;
  modelUri: string;
  machineId?: number | null;
  equipmentId?: string | null;
  equipmentClass?: string | null;
  version?: number | null;
  status?: string | null;
  conversionStatus?: string | null;
}

/** Máy cần biết dùng model nào. */
export interface MayCanModel {
  machineId: number;
  /** `machines.machineType` — cấp CHỦNG LOẠI của §10B.2. */
  loaiMay?: string | null;
}

/** Ba cấp của §10B.2. `khoi` = rơi về khối thủ tục 7 hình. */
export type CapGan = "may" | "chung_loai" | "khoi";

export interface ModelDaChon {
  cap: CapGan;
  /** null khi `cap === "khoi"` — không có model nào để nạp. */
  modelUri: string | null;
  /** id hàng registry đã chọn; null khi rơi về khối. */
  modelId: number | null;
}

/**
 * Một hàng có tài sản dùng được không.
 *
 * ★ Sao đúng `isModelRenderable` của server: `status='active'` VÀ có `modelUri`
 *   VÀ `conversionStatus` thuộc {ready, external}. Một hàng `pending` là lời hứa
 *   về một tệp CHƯA CÓ — nạp nó cho ra 404 và một máy vô hình.
 */
export function modelDungDuoc(m: HangModel): boolean {
  if ((m.status ?? "active") !== "active") return false;
  if (!m.modelUri) return false;
  const cs = m.conversionStatus ?? "ready";
  return cs === "ready" || cs === "external";
}

/** So hai ứng viên cùng cấp: version cao thắng, hoà thì id lớn thắng. */
function totHon(a: HangModel, b: HangModel): boolean {
  const va = a.version ?? 1;
  const vb = b.version ?? 1;
  if (va !== vb) return va > vb;
  return a.id > b.id;
}

/**
 * Chọn model cho MỘT máy theo ba cấp §10B.2.
 *
 * Ưu tiên từ HẸP đến RỘNG: gán đúng máy này → gán cho cả chủng loại → không có.
 */
export function chonModelChoMay(may: MayCanModel, bang: readonly HangModel[]): ModelDaChon {
  let capMay: HangModel | null = null;
  let capLoai: HangModel | null = null;

  for (const m of bang) {
    if (!modelDungDuoc(m)) continue;
    if (m.machineId != null && m.machineId === may.machineId) {
      if (capMay === null || totHon(m, capMay)) capMay = m;
      continue;
    }
    // ★ Điều kiện `machineId == null && equipmentId == null` — xem docblock đầu tệp.
    if (
      may.loaiMay != null &&
      m.equipmentClass != null &&
      m.equipmentClass === may.loaiMay &&
      m.machineId == null &&
      m.equipmentId == null
    ) {
      if (capLoai === null || totHon(m, capLoai)) capLoai = m;
    }
  }

  if (capMay) return { cap: "may", modelUri: capMay.modelUri, modelId: capMay.id };
  if (capLoai) return { cap: "chung_loai", modelUri: capLoai.modelUri, modelId: capLoai.id };
  return { cap: "khoi", modelUri: null, modelId: null };
}

/** Bảng tra machineId → model đã chọn, dựng MỘT LẦN cho cả cảnh. */
export function banDoModel(
  may: readonly MayCanModel[],
  bang: readonly HangModel[],
): Map<number, ModelDaChon> {
  const ra = new Map<number, ModelDaChon>();
  for (const m of may) ra.set(m.machineId, chonModelChoMay(m, bang));
  return ra;
}

/** Khoá LRU của một máy. Một chỗ duy nhất — hai cách đặt khoá là hai bộ đệm. */
export function khoaModel(machineId: number): string {
  return `machine:${machineId}`;
}

/** machineId ngược lại từ khoá; null nếu khoá không đúng khuôn. */
export function mayTuKhoa(khoa: string): number | null {
  const m = khoa.match(/^machine:(\d+)$/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

export interface MayTrongCanh {
  machineId: number;
  loaiMay?: string | null;
  /** Vị trí SCENE (mét) — xem `heToaDo.ts`. */
  viTri: DiemScene;
  ngoaiKhungNhin?: boolean;
}

export interface KeHoachNap {
  /** Kết quả LOD đầy đủ — để UI hiện lý do và e2e đọc `demTheoBac`. */
  lod: KetQuaChonMucChiTiet;
  /** URI cần nạp lần này, theo machineId. Chỉ máy ở bậc L0 có mặt. */
  canNap: Map<number, string>;
  /** machineId vừa bị đẩy khỏi bộ đệm — người gọi PHẢI `dispose()` (RB-7). */
  canTha: number[];
  /** machineId vẽ bằng khối thủ tục (mọi bậc khác L0, hoặc không có model). */
  veKhoi: number[];
}

/**
 * Một lượt: LOD → LRU → danh sách nạp/thả.
 *
 * ★★★ ĐÂY LÀ CHỖ #4 THẬT SỰ ĐƯỢC GIAO. `mucChiTiet.ts` biết bậc và biết trần,
 *   `chonModelChoMay` biết dùng file nào — nhưng trước hàm này KHÔNG có chỗ nào
 *   nối hai thứ đó, nên cả hai module đứng yên (đúng lớp lỗi L-1 của §11c.2:
 *   "hàm được viết đúng, có test, và không ai gọi").
 *
 * ⚠ `boDem` bị SỬA TẠI CHỖ (nó mang trạng thái LRU giữa các lượt). Hàm không
 *   thuần theo nghĩa đó và nói thẳng ở đây, thay vì để người đọc phát hiện khi
 *   thấy hai lượt gọi liên tiếp cho kết quả khác nhau.
 */
export function lapKeHoachNap(
  may: readonly MayTrongCanh[],
  banDo: Map<number, ModelDaChon>,
  viTriCamera: DiemScene,
  boDem: BoDemGlbLru,
  cauHinh: CauHinhLod = {},
): KeHoachNap {
  const dauVaoLod: MayChoLod[] = may.map((m) => ({
    khoa: khoaModel(m.machineId),
    viTri: m.viTri,
    // ★ Máy KHÔNG có model không bao giờ được xếp L0 — nó sẽ chiếm một suất
    //   trong trần 8 mà chẳng vẽ thêm gì (docblock của `MayChoLod.coModel`).
    coModel: (banDo.get(m.machineId)?.modelUri ?? null) !== null,
    ngoaiKhungNhin: m.ngoaiKhungNhin,
  }));

  const lod = chonMucChiTiet(dauVaoLod, viTriCamera, cauHinh);
  const kq = boDem.capNhat(lod.khoaL0);

  const canNap = new Map<number, string>();
  for (const khoa of lod.khoaL0) {
    const id = mayTuKhoa(khoa);
    if (id === null) continue;
    const uri = banDo.get(id)?.modelUri ?? null;
    if (uri !== null) canNap.set(id, uri);
  }

  const canTha: number[] = [];
  for (const khoa of kq.daDay) {
    const id = mayTuKhoa(khoa);
    if (id !== null) canTha.push(id);
  }

  const veKhoi = may.map((m) => m.machineId).filter((id) => !canNap.has(id));

  return { lod, canNap, canTha, veKhoi };
}

/**
 * Tạo một bộ đệm mới với trần §4. Bọc lại để mọi nơi nhận CÙNG trần mặc định
 * mà không phải nhớ hằng số.
 */
export function taoBoDemModel(tran: number = TRAN_GLB_DONG_THOI): BoDemGlbLru {
  return new BoDemGlbLru(tran);
}

export { TRAN_GLB_DONG_THOI };
