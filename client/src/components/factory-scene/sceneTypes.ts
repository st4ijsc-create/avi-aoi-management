// sceneTypes.ts — kiểu dữ liệu + bảng màu + auto-layout dùng CHUNG cho FactoryScene2D & FactoryScene3D.
// Không phụ thuộc three/react — chỉ logic thuần để test/tái dùng được ở cả 2D (SVG) lẫn 3D (WebGL).

/** Trạng thái máy — khớp hợp đồng tRPC factoryCommand.overview */
export type MachineStatus =
  | "running"
  | "idle"
  | "down"
  | "offline"
  | "maintenance";

/** Lớp phủ màu (overlay) người dùng chọn để "đọc" nhà máy theo góc nhìn khác nhau */
export type OverlayMode = "status" | "oee" | "ng" | "energy";

/** Một máy trong cảnh — CHÍNH XÁC theo hợp đồng liên agent (Agent A/B/C). */
export interface MachineNode {
  id: number;
  code: string;
  name: string;
  machineType: string;
  lineId: number | null;
  lineName: string | null;
  status: MachineStatus;
  oeePercent: number | null;
  positionX: number;
  positionY: number;
  positionZ: number;
  width: number;
  height: number;
  depth: number;
  rotation: number; // radian, quay quanh trục Y (3D) / trục Z (2D top-down)
  andonActive: boolean;
  pdmRiskHigh: boolean;
}

/** Props CHUNG cho cả FactoryScene2D và FactoryScene3D (cùng chữ ký để hoán đổi). */
export interface FactorySceneProps {
  machines: MachineNode[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  overlay: OverlayMode;
  /** Khi đổi → camera (3D) bay tới máy / (2D) cuộn-zoom tới máy. */
  focusId: number | null;
  /** Ép theme; nếu bỏ trống, component tự đọc ThemeContext. */
  theme?: "light" | "dark";
  className?: string;
}

/* ------------------------------------------------------------------ */
/* Bảng màu trạng thái (đồng bộ 2D/3D)                                  */
/* ------------------------------------------------------------------ */

export const STATUS_HEX: Record<MachineStatus, string> = {
  running: "#22c55e", // xanh lá — đang chạy
  idle: "#f59e0b", // hổ phách — chờ
  down: "#ef4444", // đỏ — dừng lỗi
  offline: "#64748b", // xám — mất kết nối
  maintenance: "#3b82f6", // xanh dương — bảo trì
};

export const STATUS_LABEL_VI: Record<MachineStatus, string> = {
  running: "Đang chạy",
  idle: "Chờ",
  down: "Dừng lỗi",
  offline: "Ngoại tuyến",
  maintenance: "Bảo trì",
};

/** Nội suy tuyến tính giữa 2 màu hex (#rrggbb) theo t∈[0,1]. */
export function lerpHex(a: string, b: string, t: number): string {
  const clamp = Math.max(0, Math.min(1, t));
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ar = (pa >> 16) & 255,
    ag = (pa >> 8) & 255,
    ab = pa & 255;
  const br = (pb >> 16) & 255,
    bg = (pb >> 8) & 255,
    bb = pb & 255;
  const r = Math.round(ar + (br - ar) * clamp);
  const g = Math.round(ag + (bg - ag) * clamp);
  const bl = Math.round(ab + (bb - ab) * clamp);
  return `#${((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1)}`;
}

/** Màu OEE liên tục: đỏ(≤50) → hổ phách(70) → xanh(≥90). null → xám. */
export function oeeHex(oee: number | null): string {
  if (oee == null) return "#64748b";
  const v = Math.max(0, Math.min(100, oee));
  if (v <= 70) return lerpHex("#ef4444", "#f59e0b", (v - 50) / 20);
  return lerpHex("#f59e0b", "#22c55e", (v - 70) / 20);
}

/**
 * Màu overlay của MỘT máy. THẬT — không bịa số:
 * - status: theo trạng thái.
 * - oee: gradient theo oeePercent (null=xám honest).
 * - ng: nêu bật rủi ro chất lượng/sự cố (andon>pdm>down), còn lại làm mờ.
 * - energy: KHÔNG có số điện thật → biểu thị định tính theo trạng thái tiêu thụ
 *   (chạy=ấm, chờ=mát, tắt=xám). Đây là proxy trực quan, không phải kWh bịa.
 */
export function overlayColorHex(m: MachineNode, overlay: OverlayMode): string {
  switch (overlay) {
    case "oee":
      return oeeHex(m.oeePercent);
    case "ng":
      if (m.andonActive) return "#ef4444";
      if (m.status === "down") return "#f97316";
      if (m.pdmRiskHigh) return "#eab308";
      return "#334155"; // mờ — không có vấn đề chất lượng
    case "energy":
      if (m.status === "running") return "#fb923c"; // ấm — đang tiêu thụ
      if (m.status === "idle" || m.status === "maintenance") return "#38bdf8"; // mát — chờ
      return "#475569"; // tắt/ngoại tuyến
    case "status":
    default:
      return STATUS_HEX[m.status] ?? STATUS_HEX.offline;
  }
}

/* ------------------------------------------------------------------ */
/* Palette nền cảnh theo theme                                         */
/* ------------------------------------------------------------------ */

export interface ScenePalette {
  background: string;
  floor: string;
  gridCell: string;
  gridSection: string;
  fog: string;
  labelBg: string;
  labelFg: string;
  labelBorder: string;
}

export function scenePalette(theme: "light" | "dark"): ScenePalette {
  return theme === "dark"
    ? {
        background: "#0b0f14",
        floor: "#0f172a",
        gridCell: "#1e293b",
        gridSection: "#334155",
        fog: "#0b0f14",
        labelBg: "rgba(15,23,42,0.92)",
        labelFg: "#e2e8f0",
        labelBorder: "rgba(148,163,184,0.25)",
      }
    : {
        background: "#eef2f6",
        floor: "#e2e8f0",
        gridCell: "#cbd5e1",
        gridSection: "#94a3b8",
        fog: "#eef2f6",
        labelBg: "rgba(255,255,255,0.94)",
        labelFg: "#0f172a",
        labelBorder: "rgba(100,116,139,0.3)",
      };
}

/* ------------------------------------------------------------------ */
/* Auto-layout: vị trí + khung bao để framing camera                    */
/* ------------------------------------------------------------------ */

export interface PlacedMachine {
  node: MachineNode;
  x: number; // toạ độ thế giới (mét)
  y: number; // đáy máy nằm trên sàn (y=0) trừ khi positionY set
  z: number;
  w: number;
  h: number;
  d: number;
}

export interface SceneLayout {
  placed: PlacedMachine[];
  byId: Map<number, PlacedMachine>;
  center: [number, number, number];
  radius: number; // bán kính khung bao — dùng đặt camera
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
}

const DEFAULT_W = 2.2;
const DEFAULT_H = 1.6;
const DEFAULT_D = 2.2;
const COL_GAP = 4; // khoảng cách máy trong 1 line
const ROW_GAP = 6; // khoảng cách giữa các line

/**
 * Sinh layout: dùng positionX/Z thật nếu ≠0; nếu (x==0 && z==0) → xếp lưới
 * theo lineId (mỗi line 1 hàng) + index (snap grid). Deterministic.
 */
export function resolveLayout(machines: MachineNode[]): SceneLayout {
  // Thứ tự line theo lần xuất hiện đầu tiên (ổn định).
  const lineOrder: (number | null)[] = [];
  const perLineCount = new Map<number | null, number>();

  const placed: PlacedMachine[] = machines.map((node) => {
    const w = node.width > 0 ? node.width : DEFAULT_W;
    const h = node.height > 0 ? node.height : DEFAULT_H;
    const d = node.depth > 0 ? node.depth : DEFAULT_D;

    const hasPos = node.positionX !== 0 || node.positionZ !== 0;
    let x: number;
    let z: number;
    if (hasPos) {
      x = node.positionX;
      z = node.positionZ;
    } else {
      const key = node.lineId;
      if (!lineOrder.includes(key)) lineOrder.push(key);
      const row = lineOrder.indexOf(key);
      const col = perLineCount.get(key) ?? 0;
      perLineCount.set(key, col + 1);
      x = col * COL_GAP;
      z = row * ROW_GAP;
    }
    const y = node.positionY > 0 ? node.positionY : 0;
    return { node, x, y, z, w, h, d };
  });

  // Căn giữa toàn cụm về gốc để camera/orbit đẹp.
  let minX = Infinity,
    maxX = -Infinity,
    minZ = Infinity,
    maxZ = -Infinity;
  for (const p of placed) {
    minX = Math.min(minX, p.x - p.w / 2);
    maxX = Math.max(maxX, p.x + p.w / 2);
    minZ = Math.min(minZ, p.z - p.d / 2);
    maxZ = Math.max(maxZ, p.z + p.d / 2);
  }
  if (!isFinite(minX)) {
    minX = maxX = minZ = maxZ = 0;
  }
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;

  // Dời về tâm gốc.
  for (const p of placed) {
    p.x -= cx;
    p.z -= cz;
  }
  const halfX = (maxX - minX) / 2;
  const halfZ = (maxZ - minZ) / 2;
  const radius = Math.max(6, Math.hypot(halfX, halfZ) + 3);

  const byId = new Map<number, PlacedMachine>();
  for (const p of placed) byId.set(p.node.id, p);

  return {
    placed,
    byId,
    center: [0, 0, 0],
    radius,
    bounds: {
      minX: minX - cx,
      maxX: maxX - cx,
      minZ: minZ - cz,
      maxZ: maxZ - cz,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Nhóm hình khối theo machineType (để instancing 3D)                   */
/* ------------------------------------------------------------------ */

export type ShapeKey =
  | "aoi"
  | "avi"
  | "smt"
  | "robot"
  | "conveyor"
  | "cnc"
  | "oven"
  | "box";

/** Ánh xạ machineType (chuỗi tuỳ ý) → khoá hình khối low-poly. */
export function shapeKeyFor(machineType: string): ShapeKey {
  const t = (machineType || "").toLowerCase();
  if (t.includes("aoi")) return "aoi";
  if (t.includes("avi") || t.includes("vision") || t.includes("inspect"))
    return "avi";
  if (t.includes("smt") || t.includes("mount") || t.includes("placer"))
    return "smt";
  if (t.includes("robot") || t.includes("arm") || t.includes("cobot"))
    return "robot";
  if (t.includes("convey") || t.includes("belt") || t.includes("transfer"))
    return "conveyor";
  if (t.includes("cnc") || t.includes("mill") || t.includes("lathe"))
    return "cnc";
  if (t.includes("oven") || t.includes("reflow") || t.includes("furnace"))
    return "oven";
  return "box";
}
