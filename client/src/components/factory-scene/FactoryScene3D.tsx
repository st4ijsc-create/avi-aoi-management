// FactoryScene3D.tsx — engine cảnh nhà máy 3D MƯỢT + chuyên nghiệp.
//
// Chống-giật (root cause đã audit ở bản cũ):
//  • frameloop="demand" + invalidate() có chủ đích → 0 fps khi tĩnh (không render 60fps vô ích).
//  • InstancedMesh: N máy cùng loại = 1 draw call; màu per-instance (setColorAt) theo overlay.
//  • KHÔNG useFrame toàn scene; chỉ 2 vòng lặp có điều kiện: (a) camera fly-to lúc bay,
//    (b) beacon Andon/PdM khi CÓ máy cảnh báo. Hết điều kiện → ngừng invalidate → đứng im.
//  • shadows={false} + ContactShadows bake 1 lần (frames={1}); dpr cap [1,2] + AdaptiveDpr.
//  • Nhãn máy giới hạn (LOD): chỉ selected/hover/Andon/PdM, hoặc khi zoom gần mới hiện tất cả.

import { Canvas, useThree, useFrame, type ThreeEvent } from "@react-three/fiber";
import {
  OrbitControls,
  Grid,
  ContactShadows,
  Html,
  AdaptiveDpr,
} from "@react-three/drei";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import * as THREE from "three";
import { useOptionalTheme } from "./useOptionalTheme";
import { getMachineGeometry } from "./machineMesh";
import {
  type FactorySceneProps,
  type PlacedMachine,
  type ShapeKey,
  overlayColorHex,
  resolveLayout,
  scenePalette,
  shapeKeyFor,
  STATUS_LABEL_VI,
} from "./sceneTypes";

/** Ref tối giản của OrbitControls (tránh phụ thuộc kiểu three-stdlib). */
interface OrbitLike {
  target: THREE.Vector3;
  update: () => void;
  object: THREE.Camera;
}

const WHITE = new THREE.Color("#ffffff");

/* ------------------------------------------------------------------ */
/* Một nhóm máy cùng shape = 1 InstancedMesh (1 draw call)             */
/* ------------------------------------------------------------------ */

function InstancedGroup({
  shape,
  items,
  overlay,
  selectedId,
  hoveredId,
  onSelect,
  onHover,
}: {
  shape: ShapeKey;
  items: PlacedMachine[];
  overlay: FactorySceneProps["overlay"];
  selectedId: number | null;
  hoveredId: number | null;
  onSelect: (id: number) => void;
  onHover: (id: number | null) => void;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const invalidate = useThree((s) => s.invalidate);
  const geom = useMemo(() => getMachineGeometry(shape), [shape]);
  const count = items.length;

  // Đặt ma trận (vị trí/xoay/scale) — chỉ chạy lại khi hình học đổi.
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const dummy = new THREE.Object3D();
    items.forEach((p, i) => {
      dummy.position.set(p.x, p.y, p.z);
      dummy.rotation.set(0, p.node.rotation || 0, 0);
      dummy.scale.set(p.w, p.h, p.d);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    invalidate();
  }, [items, invalidate]);

  // Đặt màu per-instance theo overlay + nhấn sáng selected/hover.
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const c = new THREE.Color();
    items.forEach((p, i) => {
      c.set(overlayColorHex(p.node, overlay));
      if (p.node.id === selectedId) c.lerp(WHITE, 0.4);
      else if (p.node.id === hoveredId) c.lerp(WHITE, 0.2);
      mesh.setColorAt(i, c);
    });
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    invalidate();
  }, [items, overlay, selectedId, hoveredId, invalidate]);

  return (
    <instancedMesh
      ref={ref}
      // key qua count ở component cha đảm bảo remount khi số lượng đổi.
      args={[geom, undefined as unknown as THREE.Material, count]}
      frustumCulled={false}
      onClick={(e: ThreeEvent<MouseEvent>) => {
        e.stopPropagation();
        if (e.instanceId != null && items[e.instanceId])
          onSelect(items[e.instanceId].node.id);
      }}
      onPointerMove={(e: ThreeEvent<PointerEvent>) => {
        e.stopPropagation();
        if (e.instanceId != null && items[e.instanceId])
          onHover(items[e.instanceId].node.id);
      }}
      onPointerOut={() => onHover(null)}
    >
      <meshStandardMaterial
        color="#ffffff"
        metalness={0.15}
        roughness={0.62}
      />
    </instancedMesh>
  );
}

/* ------------------------------------------------------------------ */
/* Beacon Andon/PdM — vài quả cầu phát sáng nhấp nháy (chỉ khi có)      */
/* ------------------------------------------------------------------ */

interface BeaconItem {
  id: number;
  x: number;
  y: number;
  z: number;
  color: string;
}

function Beacons({ items }: { items: BeaconItem[] }) {
  const groupRef = useRef<THREE.Group>(null);
  const invalidate = useThree((s) => s.invalidate);

  // Kick vòng lặp khi danh sách beacon đổi.
  useEffect(() => {
    if (items.length) invalidate();
  }, [items, invalidate]);

  // Throttle nhịp pulse ~12fps (QA4d-2): trước đây invalidate() MỖI frame khi có
  // beacon → 3D chạy 60fps liên tục trên TV 24/7 (nhà máy luôn có ≥1 andon/pdm).
  const lastPulseRef = useRef(0);
  useFrame(({ clock }) => {
    const g = groupRef.current;
    if (!g || items.length === 0) return;
    const t = clock.getElapsedTime();
    if (t * 1000 - lastPulseRef.current < 80) return; // ~12fps thay vì 60fps
    lastPulseRef.current = t * 1000;
    const pulse = 0.5 + 0.5 * Math.sin(t * 4.2);
    for (const child of g.children) {
      const mesh = child as THREE.Mesh;
      const mat = mesh.material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = 0.7 + pulse * 1.8;
      mesh.scale.setScalar(0.9 + pulse * 0.35);
    }
    invalidate(); // duy trì nhịp (đã throttle) CHỈ khi còn beacon
  });

  if (items.length === 0) return null;
  return (
    <group ref={groupRef}>
      {items.map((b) => (
        <mesh key={b.id} position={[b.x, b.y, b.z]}>
          <sphereGeometry args={[0.16, 12, 12]} />
          <meshStandardMaterial
            color={b.color}
            emissive={b.color}
            emissiveIntensity={1}
            toneMapped={false}
          />
        </mesh>
      ))}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Camera fly-to (easing tự viết, không cần maath)                     */
/* ------------------------------------------------------------------ */

function CameraRig({
  byId,
  focusId,
  controlsRef,
}: {
  byId: Map<number, PlacedMachine>;
  focusId: number | null;
  controlsRef: React.MutableRefObject<OrbitLike | null>;
}) {
  const invalidate = useThree((s) => s.invalidate);
  const flying = useRef(false);
  const destPos = useRef(new THREE.Vector3());
  const destTarget = useRef(new THREE.Vector3());

  useEffect(() => {
    if (focusId == null) return;
    const p = byId.get(focusId);
    if (!p) return;
    destTarget.current.set(p.x, p.y + p.h * 0.5, p.z);
    const dist = Math.max(5, (p.w + p.h + p.d) * 1.6);
    destPos.current.set(p.x + dist, p.y + p.h + dist * 0.7, p.z + dist);
    flying.current = true;
    invalidate();
  }, [focusId, byId, invalidate]);

  useFrame(({ camera }) => {
    if (!flying.current) return;
    const ctrl = controlsRef.current;
    camera.position.lerp(destPos.current, 0.12); // easeOut ~0.12/frame
    if (ctrl) {
      ctrl.target.lerp(destTarget.current, 0.12);
      ctrl.update();
    }
    if (camera.position.distanceTo(destPos.current) < 0.12) {
      flying.current = false;
      camera.position.copy(destPos.current);
      if (ctrl) {
        ctrl.target.copy(destTarget.current);
        ctrl.update();
      }
    } else {
      invalidate();
    }
  });

  return null;
}

/* ------------------------------------------------------------------ */
/* Nhãn máy (Html) — theme-aware, giới hạn số lượng (LOD)              */
/* ------------------------------------------------------------------ */

function MachineLabels({
  placed,
  ids,
  palette,
}: {
  placed: PlacedMachine[];
  ids: Set<number>;
  palette: ReturnType<typeof scenePalette>;
}) {
  const shown = placed.filter((p) => ids.has(p.node.id)).slice(0, 60);
  return (
    <>
      {shown.map((p) => (
        <Html
          key={p.node.id}
          position={[p.x, p.y + p.h + 0.45, p.z]}
          center
          distanceFactor={14}
          zIndexRange={[10, 0]}
          style={{ pointerEvents: "none", userSelect: "none" }}
        >
          <div
            style={{
              padding: "2px 8px",
              borderRadius: 6,
              fontSize: 12,
              fontWeight: 600,
              whiteSpace: "nowrap",
              background: palette.labelBg,
              color: palette.labelFg,
              border: `1px solid ${palette.labelBorder}`,
              boxShadow: "0 2px 6px rgba(0,0,0,0.25)",
            }}
          >
            {p.node.code}
            <span style={{ opacity: 0.6, fontWeight: 400 }}>
              {" · "}
              {STATUS_LABEL_VI[p.node.status]}
            </span>
          </div>
        </Html>
      ))}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Nội dung cảnh (trong Canvas)                                        */
/* ------------------------------------------------------------------ */

function SceneContents({
  machines,
  selectedId,
  onSelect,
  overlay,
  focusId,
  theme,
}: Required<Omit<FactorySceneProps, "className">>) {
  const palette = scenePalette(theme);
  const controlsRef = useRef<OrbitLike | null>(null);
  const invalidate = useThree((s) => s.invalidate);
  const [hoveredId, setHoveredId] = useState<number | null>(null);
  const [zoomNear, setZoomNear] = useState(false);

  const layout = useMemo(() => resolveLayout(machines), [machines]);

  // Gom máy theo shape để instancing.
  const groups = useMemo(() => {
    const map = new Map<ShapeKey, PlacedMachine[]>();
    for (const p of layout.placed) {
      const k = shapeKeyFor(p.node.machineType);
      const arr = map.get(k);
      if (arr) arr.push(p);
      else map.set(k, [p]);
    }
    return Array.from(map.entries());
  }, [layout]);

  // Beacon cho máy Andon (đỏ) / PdM rủi ro cao (hổ phách).
  const beacons = useMemo<BeaconItem[]>(() => {
    const out: BeaconItem[] = [];
    for (const p of layout.placed) {
      if (p.node.andonActive)
        out.push({ id: p.node.id, x: p.x, y: p.y + p.h + 0.55, z: p.z, color: "#ef4444" });
      else if (p.node.pdmRiskHigh)
        out.push({ id: p.node.id, x: p.x, y: p.y + p.h + 0.55, z: p.z, color: "#f59e0b" });
    }
    return out;
  }, [layout]);

  // Tập nhãn hiển thị: selected ∪ hover ∪ Andon ∪ PdM, hoặc TẤT CẢ khi zoom gần.
  const labelIds = useMemo(() => {
    if (zoomNear) return new Set(layout.placed.map((p) => p.node.id));
    const s = new Set<number>();
    if (selectedId != null) s.add(selectedId);
    if (hoveredId != null) s.add(hoveredId);
    for (const b of beacons) s.add(b.id);
    return s;
  }, [zoomNear, layout, selectedId, hoveredId, beacons]);

  // Đổi theme/overlay/selected → yêu cầu vẽ lại 1 khung.
  useEffect(() => {
    invalidate();
  }, [theme, overlay, selectedId, invalidate]);

  // Con trỏ pointer khi hover máy.
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    gl.domElement.style.cursor = hoveredId != null ? "pointer" : "grab";
  }, [hoveredId, gl]);

  // Cập nhật zoomNear theo khoảng cách camera (throttle bằng timestamp).
  const lastCheck = useRef(0);
  const onControlsChange = () => {
    const now = performance.now();
    if (now - lastCheck.current < 120) return;
    lastCheck.current = now;
    const ctrl = controlsRef.current;
    if (!ctrl) return;
    const d = ctrl.object.position.distanceTo(ctrl.target);
    const near = d < Math.max(10, layout.radius * 0.8);
    setZoomNear((prev) => (prev === near ? prev : near));
  };

  const camStart = layout.radius * 1.8;

  return (
    <>
      <color attach="background" args={[palette.background]} />
      <fog attach="fog" args={[palette.fog, layout.radius * 2.4, layout.radius * 6]} />

      {/* Ánh sáng studio nhẹ — KHÔNG shadow map realtime, KHÔNG HDR ngoài. */}
      <hemisphereLight
        color={theme === "dark" ? "#8fa4c0" : "#ffffff"}
        groundColor={theme === "dark" ? "#0b0f14" : "#c8d2de"}
        intensity={theme === "dark" ? 0.9 : 1.1}
      />
      <directionalLight
        position={[layout.radius, layout.radius * 1.4, layout.radius * 0.6]}
        intensity={theme === "dark" ? 1.0 : 1.3}
      />
      <ambientLight intensity={theme === "dark" ? 0.25 : 0.35} />

      {/* Sàn + lưới. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]} receiveShadow={false}>
        <planeGeometry args={[layout.radius * 8, layout.radius * 8]} />
        <meshStandardMaterial color={palette.floor} roughness={1} metalness={0} />
      </mesh>
      <Grid
        position={[0, 0, 0]}
        args={[layout.radius * 4, layout.radius * 4]}
        cellSize={2}
        cellThickness={0.6}
        cellColor={palette.gridCell}
        sectionSize={10}
        sectionThickness={1}
        sectionColor={palette.gridSection}
        fadeDistance={layout.radius * 5}
        fadeStrength={1.2}
        infiniteGrid
      />

      {/* Bóng đổ tiếp xúc — bake 1 lần (tĩnh, không tốn mỗi frame). */}
      <ContactShadows
        position={[0, 0.01, 0]}
        scale={layout.radius * 4}
        far={6}
        blur={2.4}
        opacity={theme === "dark" ? 0.55 : 0.35}
        frames={1}
        color={theme === "dark" ? "#000000" : "#334155"}
      />

      {/* Máy: mỗi shape 1 InstancedMesh. */}
      {groups.map(([shape, items]) => (
        <InstancedGroup
          key={`${shape}:${items.length}`}
          shape={shape}
          items={items}
          overlay={overlay}
          selectedId={selectedId}
          hoveredId={hoveredId}
          onSelect={onSelect}
          onHover={setHoveredId}
        />
      ))}

      <Beacons items={beacons} />
      <MachineLabels placed={layout.placed} ids={labelIds} palette={palette} />

      <CameraRig byId={layout.byId} focusId={focusId} controlsRef={controlsRef} />

      <OrbitControls
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ref={controlsRef as any}
        makeDefault
        enableDamping
        dampingFactor={0.08}
        maxPolarAngle={Math.PI / 2.15}
        minDistance={4}
        maxDistance={layout.radius * 5}
        onChange={onControlsChange}
        // Vị trí camera khởi tạo qua target mặc định; đặt qua camera prop ở Canvas.
      />

      <AdaptiveDpr pixelated />

      {/* Đặt camera ban đầu 1 lần. */}
      <InitialCamera position={[camStart, camStart * 0.8, camStart]} />
    </>
  );
}

/** Đặt vị trí camera ban đầu đúng 1 lần (tránh giật khi re-render). */
function InitialCamera({ position }: { position: [number, number, number] }) {
  const camera = useThree((s) => s.camera);
  const invalidate = useThree((s) => s.invalidate);
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    camera.position.set(position[0], position[1], position[2]);
    camera.lookAt(0, 0, 0);
    invalidate();
  }, [camera, position, invalidate]);
  return null;
}

/* ------------------------------------------------------------------ */
/* Component xuất khẩu                                                  */
/* ------------------------------------------------------------------ */

export function FactoryScene3D(props: FactorySceneProps) {
  const ctxTheme = useOptionalTheme();
  const theme = props.theme ?? ctxTheme;
  const palette = scenePalette(theme);

  return (
    <div
      className={props.className}
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        minHeight: 320,
        background: palette.background,
      }}
    >
      <Canvas
        frameloop="demand"
        dpr={[1, 2]}
        shadows={false}
        gl={{ antialias: true, powerPreference: "high-performance" }}
        camera={{ fov: 45, near: 0.1, far: 2000, position: [30, 24, 30] }}
      >
        <SceneContents
          machines={props.machines}
          selectedId={props.selectedId}
          onSelect={props.onSelect}
          overlay={props.overlay}
          focusId={props.focusId}
          theme={theme}
        />
      </Canvas>
    </div>
  );
}

export default FactoryScene3D;
