// factory-scene — engine cảnh nhà máy dùng chung (2D mặc định + 3D toggle).
// Agent B (page) import từ đây; cả 2 component CÙNG props (FactorySceneProps).

export { FactoryScene2D, default as FactoryScene2DDefault } from "./FactoryScene2D";
// ★★★ Đợt 61 (QĐ-31): `FactoryScene3D` + `machineMesh` ĐÃ XOÁ — engine 3D đời cũ,
// đo được 0 chỗ dựng (mọi màn 3D nay chạy kit `twin3d/loi/CanhNhaMay`).
// `FactoryScene2D` (fallback 2D của `/factory-command`) và `sceneTypes`/`useOptionalTheme`
// (kit mới dùng lại) GIỮ NGUYÊN.

export type {
  FactorySceneProps,
  MachineNode,
  MachineStatus,
  OverlayMode,
} from "./sceneTypes";

export {
  STATUS_HEX,
  STATUS_LABEL_VI,
  overlayColorHex,
  oeeHex,
  resolveLayout,
  scenePalette,
} from "./sceneTypes";
