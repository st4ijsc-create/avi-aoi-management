import { readFileSync, writeFileSync } from "node:fs";
const F = "client/src/components/twin3d/loi/index.ts";
let s = readFileSync(F, "utf8");
const cu = `export { KhungCanh, DPR_TRAN, SAN_CAO_KHUNG_CANH_PX, type KhungCanhProps, type CuaSoDoTwin3d } from "./KhungCanh";`;
const moi = `export {
  KhungCanh,
  DongBoCatCanh,
  DPR_TRAN,
  SAN_CAO_KHUNG_CANH_PX,
  type KhungCanhProps,
  type CuaSoDoTwin3d,
} from "./KhungCanh";

/** ★ PH-50b — mặt phẳng cắt của camera: \`far\` suy từ bán kính cảnh, \`near\` suy từ \`far\`. */
export {
  catCanhTheoBanKinh,
  farTheoBanKinh,
  khoangCachZoomXaNhat,
  nearTheoFar,
  FAR_TOI_THIEU_M,
  HE_SO_DEM_FAR,
  HE_SO_ZOOM_XA_NHAT,
  KHOANG_CACH_ZOOM_XA_NHAT_TOI_THIEU_M,
  NEAR_TOI_DA_M,
  NEAR_TOI_THIEU_M,
  TRAN_TI_LE_FAR_TREN_NEAR,
} from "./catCanh";`;
if (!s.includes(cu)) throw new Error("index");
s = s.replace(cu, moi);
writeFileSync(F, s, "utf8");
console.log("ok");
