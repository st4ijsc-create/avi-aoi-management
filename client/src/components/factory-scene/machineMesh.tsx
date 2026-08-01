// machineMesh.tsx — dựng hình khối low-poly THEO machineType bằng geometry primitive (D9).
// KHÔNG tải file GLB ngoài. Mỗi shape gộp (merge) thành 1 BufferGeometry để INSTANCING:
// tất cả máy cùng shape = 1 draw call. Geometry chuẩn hoá trong hộp đơn vị
// (x,z ∈ [-0.5,0.5], y ∈ [0,1]) → instance scale theo width/height/depth thật.

import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { ShapeKey } from "./sceneTypes";

/** Tạo box đã dịch/định vị trong hộp đơn vị. */
function box(
  w: number,
  h: number,
  d: number,
  x = 0,
  y = 0,
  z = 0,
): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
}

/** Tạo cylinder đứng (trục Y) đã định vị. */
function cyl(
  rTop: number,
  rBot: number,
  h: number,
  x = 0,
  y = 0,
  z = 0,
  seg = 12,
): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(rTop, rBot, h, seg);
  g.translate(x, y, z);
  return g;
}

/** Ghép nhiều mảnh + xoá attribute thừa để merge không lỗi (giữ position/normal/uv). */
function assemble(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  for (const p of parts) {
    // Chuẩn hoá attribute: chỉ giữ 3 attr chuẩn để mergeGeometries không kén.
    for (const name of Object.keys(p.attributes)) {
      if (name !== "position" && name !== "normal" && name !== "uv") {
        p.deleteAttribute(name);
      }
    }
  }
  const merged = mergeGeometries(parts, false) ?? parts[0];
  for (const p of parts) if (p !== merged) p.dispose();
  merged.computeVertexNormals();
  return merged;
}

/** Thân máy cơ sở: bệ + tủ. Dùng lại cho nhiều shape. */
function baseCabinet(bodyH = 0.72): THREE.BufferGeometry[] {
  return [
    box(0.94, 0.08, 0.94, 0, 0.04, 0), // bệ chân
    box(0.86, bodyH, 0.86, 0, 0.08 + bodyH / 2, 0), // tủ chính
  ];
}

function buildAOI(): THREE.BufferGeometry {
  return assemble([
    ...baseCabinet(0.6),
    box(0.7, 0.28, 0.7, 0, 0.82, 0), // đầu quang học
    box(0.18, 0.12, 0.18, 0, 1.02, 0), // camera trên
    box(0.5, 0.06, 0.5, 0, 0.66, 0), // băng tải qua máy
  ]);
}

function buildAVI(): THREE.BufferGeometry {
  return assemble([
    ...baseCabinet(0.64),
    box(0.5, 0.34, 0.5, 0, 0.9, 0), // buồng camera
    cyl(0.09, 0.11, 0.22, 0, 1.14, 0, 12), // ống kính
    box(0.62, 0.05, 0.62, 0, 0.7, 0),
  ]);
}

function buildSMT(): THREE.BufferGeometry {
  return assemble([
    ...baseCabinet(0.5),
    box(0.9, 0.24, 0.62, 0, 0.7, 0), // thân dài
    box(0.3, 0.3, 0.5, -0.28, 0.95, 0), // gantry head
    box(0.12, 0.5, 0.12, 0.34, 0.9, 0.3), // cột feeder
    box(0.12, 0.5, 0.12, 0.34, 0.9, -0.3),
  ]);
}

function buildRobot(): THREE.BufferGeometry {
  return assemble([
    cyl(0.42, 0.46, 0.14, 0, 0.07, 0, 16), // đế tròn
    cyl(0.22, 0.24, 0.34, 0, 0.31, 0, 12), // trụ xoay
    box(0.16, 0.52, 0.16, 0.02, 0.66, 0), // cánh tay 1
    box(0.4, 0.14, 0.14, 0.22, 0.9, 0), // cánh tay 2 vươn ngang
    box(0.12, 0.12, 0.12, 0.44, 0.9, 0), // cổ tay/kẹp
  ]);
}

function buildConveyor(): THREE.BufferGeometry {
  return assemble([
    box(0.98, 0.14, 0.5, 0, 0.4, 0), // mặt băng
    box(0.98, 0.1, 0.06, 0, 0.5, 0.24), // rào cạnh
    box(0.98, 0.1, 0.06, 0, 0.5, -0.24),
    cyl(0.05, 0.05, 0.5, -0.42, 0.18, 0, 8), // con lăn
    cyl(0.05, 0.05, 0.5, 0.42, 0.18, 0, 8),
  ]);
}

function buildCNC(): THREE.BufferGeometry {
  return assemble([
    ...baseCabinet(0.78),
    box(0.9, 0.5, 0.9, 0, 0.55, 0), // buồng gia công
    box(0.34, 0.4, 0.04, 0, 0.55, 0.46), // cửa kính
    cyl(0.06, 0.06, 0.3, 0, 1.05, 0, 10), // trục chính
  ]);
}

function buildOven(): THREE.BufferGeometry {
  return assemble([
    box(0.96, 0.1, 0.6, 0, 0.05, 0),
    box(0.96, 0.62, 0.56, 0, 0.42, 0), // thân lò dài
    box(0.2, 0.36, 0.58, -0.5, 0.42, 0), // cửa vào
    box(0.2, 0.36, 0.58, 0.5, 0.42, 0), // cửa ra
    cyl(0.05, 0.05, 0.28, 0.2, 0.9, 0, 8), // ống khói
    cyl(0.05, 0.05, 0.28, -0.2, 0.9, 0, 8),
  ]);
}

function buildBox(): THREE.BufferGeometry {
  return assemble([
    ...baseCabinet(0.78),
    box(0.5, 0.1, 0.5, 0, 0.92, 0), // nắp
  ]);
}

const BUILDERS: Record<ShapeKey, () => THREE.BufferGeometry> = {
  aoi: buildAOI,
  avi: buildAVI,
  smt: buildSMT,
  robot: buildRobot,
  conveyor: buildConveyor,
  cnc: buildCNC,
  oven: buildOven,
  box: buildBox,
};

const cache = new Map<ShapeKey, THREE.BufferGeometry>();

/** Lấy geometry đã dựng+cache cho 1 shape. Dùng chung mọi instance cùng loại. */
export function getMachineGeometry(shape: ShapeKey): THREE.BufferGeometry {
  let g = cache.get(shape);
  if (!g) {
    g = (BUILDERS[shape] ?? buildBox)();
    cache.set(shape, g);
  }
  return g;
}
