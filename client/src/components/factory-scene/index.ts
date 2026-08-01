// factory-scene — engine cảnh nhà máy dùng chung (2D mặc định + 3D toggle).
// Agent B (page) import từ đây; cả 2 component CÙNG props (FactorySceneProps).

export { FactoryScene2D, default as FactoryScene2DDefault } from "./FactoryScene2D";
export { FactoryScene3D, default as FactoryScene3DDefault } from "./FactoryScene3D";

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
