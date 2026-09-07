/**
 * twin3d/loi — LÕI ENGINE dùng chung cho màn Thiết kế (`/twin-studio`) và màn
 * Vận hành (`/twin`), spec §6.1.
 *
 * Quy tắc nhập khẩu: màn hình import TỪ ĐÂY, không lặn vào từng tệp. Nhờ vậy đợt
 * sau đổi cấu trúc bên trong mà không phải sửa mọi màn.
 */

export { KhungCanh, DPR_TRAN, type KhungCanhProps, type CuaSoDoTwin3d } from "./KhungCanh";
export { CanhNhaMay, type CanhNhaMayProps } from "./CanhNhaMay";
export { LoBatchMay, type MayTrongLo, type LoBatchMayProps } from "./LoBatchMay";
export { LopNhan, type NhanTheGioi, type LopNhanProps, type WindowCoDo } from "./LopNhan";

export {
  taoDieuKhienQuay,
  noiInvalidate,
  khungHinhBaoTron,
  type CauHinhDieuKhien,
  type DieuKhienQuayDaNoi,
} from "./dieuKhienQuay";

export {
  locNhan,
  diemUuTienNhan,
  TRAN_NHAN_DOM,
  BAN_KINH_VA_CHAM_PX,
  type NhanUngVien,
  type NhanDuocVe,
  type KetQuaLocNhan,
} from "./locNhan";

export {
  TheoDoiMatDoKhungHinh,
  dacTinhCuaBac,
  docBacDaLuu,
  THANG_BAC,
  NGUONG_FPS_HA,
  NGUONG_FPS_NANG,
  CUA_SO_MS,
  KHOA_LUU_BAC,
  type BacChatLuong,
  type DacTinhBac,
} from "./matDoKhungHinh";

export {
  dungBangTra,
  mayTuInstance,
  instanceTuMay,
  apClick,
  apHover,
  instanceCanVeLai,
  mucNhanSang,
  TRANG_THAI_CHON_RONG,
  type BangTraLo,
  type TrangThaiChon,
} from "./chonVatThe";

export { taoVien, taoVienHopBao, giaiPhongVien, NGUONG_GOC_CANH } from "./vienNoiBat";

export {
  giaiPhongCay,
  giaiPhongMaterial,
  giaiPhongRenderTarget,
  SoTaiNguyen,
  type SoDaGiaiPhong,
} from "./giaiPhong";

export {
  hinhHocDonViTuMoTa,
  hinhHocHopBaoDonVi,
  maTranDatMay,
  demDinhVaChiSo,
} from "./hinhHocTuMoTa";

export {
  ModelErrorBoundary,
  type ModelErrorBoundaryProps,
} from "./ModelErrorBoundary";

export {
  LopModelMay,
  duongDanCungGoc,
  type MayCoModel,
  type LopModelMayProps,
} from "./ModelMay";
