/**
 * FactoryFloor3D — L4 "plant view" 3D scene for ONE factory.
 *
 * Renders machines as 3D blocks laid out by production line, coloured by LIVE
 * status (digital shadow). Hover + click to drill down. Reuses the same
 * three.js / react-three stack as Factory3DScene but at the machine level.
 *
 * Pure presentational: it receives already-resolved machine nodes + a selection
 * callback. No data fetching, no control — colour reflects real telemetry status.
 */
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Text, PerspectiveCamera, Environment, Grid } from "@react-three/drei";
import { useMemo, useRef, useState, Suspense } from "react";
import * as THREE from "three";
// doc 44 G5.12 — PHÂN LOẠI trạng thái đi qua nguồn canonical DUY NHẤT.
import { statusTone, type SemanticTone } from "@/lib/canonicalStatusColor";

export interface MachineNode {
  id: number;
  code: string;
  name: string;
  machineType: string;
  latestStatus: string; // 'online' | 'offline' | ...
  heartbeatStatus: string; // 'running' | 'idle' | 'stopped' | ...
  uptimePercent: number;
  line: { id: number; name: string; code: string };
  /** Real floor-plan coordinates, normalized 0–1 (null = not placed yet). */
  layoutPositionX?: number | string | null;
  layoutPositionY?: number | string | null;
  /** Extra transform: rotation (deg) + footprint (scene units). */
  layout?: { x?: number; y?: number; rotationDeg?: number; footprintW?: number; footprintD?: number } | null;
}

const COL_GAP = 2.4;
const ROW_GAP = 3.2;
// Scene size the normalized 0–1 floor coordinates map onto.
const FLOOR_W = 34;
const FLOOR_D = 24;

function num(v: unknown): number {
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : NaN;
}

/**
 * doc 44 G5.12 — WebGL cần giá trị màu THREE parse được (không đọc oklch token);
 * vì vậy giữ bảng hex CỤC BỘ cho 3D (xấp xỉ token index.css), NHƯNG việc PHÂN LOẠI
 * trạng thái → tông đi qua nguồn canonical (statusTone) — 1 nguồn logic thống nhất.
 */
const TONE_HEX_3D: Record<SemanticTone, string> = {
  success: "#10b981", // ~ --success
  info: "#06b6d4",    // ~ --info (cyan)
  warning: "#f59e0b", // ~ --warning
  danger: "#ef4444",  // ~ --destructive
  neutral: "#94a3b8", // ~ --muted-foreground
};

/** Live status → colour (digital shadow — phân loại qua canonical, hex chỉ để WebGL render). */
export function statusColor(m: { latestStatus: string; heartbeatStatus: string }): string {
  // Mất kết nối = "down" (danger/đỏ) để KHÔNG giấu sự cố trên sơ đồ nhà máy.
  if (m.latestStatus !== "online") return TONE_HEX_3D[statusTone("down")];
  if (m.heartbeatStatus === "idle") return TONE_HEX_3D[statusTone("idle")];       // → neutral (ISA-101)
  if (m.heartbeatStatus === "stopped") return TONE_HEX_3D[statusTone("stopped")]; // → warning
  return TONE_HEX_3D[statusTone("running")];                                       // → success
}
export function statusLabel(m: { latestStatus: string; heartbeatStatus: string }): string {
  if (m.latestStatus !== "online") return "Offline";
  if (m.heartbeatStatus === "idle") return "Idle";
  if (m.heartbeatStatus === "stopped") return "Stopped";
  return "Running";
}

function MachineBlock({
  machine, position, selected, staged, onClick,
}: { machine: MachineNode; position: [number, number, number]; selected: boolean; staged?: boolean; onClick: () => void }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const [hovered, setHovered] = useState(false);
  const color = statusColor(machine);
  const running = machine.latestStatus === "online" && machine.heartbeatStatus !== "idle" && machine.heartbeatStatus !== "stopped";
  const fw = num(machine.layout?.footprintW); const fd = num(machine.layout?.footprintD);
  const w = fw > 0 ? fw : 1.5; const d = fd > 0 ? fd : 1.5;
  const rotY = (num(machine.layout?.rotationDeg) || 0) * (Math.PI / 180);

  useFrame((state) => {
    if (!meshRef.current) return;
    const target = selected || hovered ? 1.12 : 1;
    meshRef.current.scale.lerp(new THREE.Vector3(target, target, target), 0.15);
    const mat = meshRef.current.material as THREE.MeshStandardMaterial;
    // running machines breathe; idle/down are steady
    mat.emissiveIntensity = running ? 0.45 + Math.sin(state.clock.elapsedTime * 3 + position[0]) * 0.25 : 0.15;
  });

  return (
    <group position={position} rotation={[0, rotY, 0]}>
      <mesh
        ref={meshRef}
        castShadow
        onClick={(e) => { e.stopPropagation(); onClick(); }}
        onPointerOver={(e) => { e.stopPropagation(); setHovered(true); }}
        onPointerOut={() => setHovered(false)}
      >
        <boxGeometry args={[w, 1, d]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.2} metalness={0.4} roughness={0.5} transparent={!!staged} opacity={staged ? 0.45 : 1} />
      </mesh>
      {/* heading marker (front face) so rotation is visible */}
      <mesh position={[0, 0, d / 2 + 0.08]}>
        <boxGeometry args={[w * 0.5, 0.25, 0.16]} />
        <meshStandardMaterial color="#e2e8f0" emissive="#94a3b8" emissiveIntensity={0.2} />
      </mesh>
      {/* status beacon */}
      <mesh position={[0, 0.85, 0]}>
        <sphereGeometry args={[0.13]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.9} />
      </mesh>
      {/* selection ring */}
      {selected && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.49, 0]}>
          <ringGeometry args={[1.05, 1.25, 32]} />
          <meshBasicMaterial color="#06b6d4" side={THREE.DoubleSide} />
        </mesh>
      )}
      <Text position={[0, -0.7, 0.8]} fontSize={0.22} color={hovered || selected ? "#ffffff" : "#cbd5e1"} anchorX="center" anchorY="top">
        {machine.code}
      </Text>
    </group>
  );
}

function Floor({ width, depth }: { width: number; depth: number }) {
  return (
    <>
      <Grid args={[Math.max(40, width + 8), Math.max(40, depth + 8)]} cellSize={1} cellThickness={0.5} cellColor="#1e293b" sectionSize={5} sectionThickness={1} sectionColor="#334155" fadeDistance={60} fadeStrength={1} infiniteGrid />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.51, 0]} receiveShadow>
        <planeGeometry args={[width + 10, depth + 10]} />
        <meshStandardMaterial color="#0f172a" transparent opacity={0.85} />
      </mesh>
    </>
  );
}

interface Layout { machine: MachineNode; pos: [number, number, number]; staged: boolean }

function Scene({ machines, selectedId, onSelect }: { machines: MachineNode[]; selectedId: number | null; onSelect: (m: MachineNode) => void }) {
  const { layouts, lineLabels, width, depth } = useMemo(() => {
    const layouts: Layout[] = [];
    const unplaced: MachineNode[] = [];
    // Machines with REAL floor coords (0–1) are placed at their actual position.
    for (const m of machines) {
      const px = num(m.layoutPositionX), py = num(m.layoutPositionY);
      if (px >= 0 && px <= 1 && py >= 0 && py <= 1) {
        layouts.push({ machine: m, pos: [(px - 0.5) * FLOOR_W, 0.5, (py - 0.5) * FLOOR_D], staged: false });
      } else unplaced.push(m);
    }
    // Machines without coords are staged (semi-transparent) on a strip in front — drag them in the editor.
    const cols = Math.max(1, Math.ceil(Math.sqrt(unplaced.length || 1)));
    unplaced.forEach((m, i) => {
      const c = i % cols, r = Math.floor(i / cols);
      layouts.push({ machine: m, pos: [-FLOOR_W / 2 + 1.2 + c * COL_GAP, 0.5, FLOOR_D / 2 + 3 + r * ROW_GAP], staged: true });
    });
    // Line labels at each line's centroid (real positions).
    const byLine = new Map<number, { name: string; xs: number; zs: number; n: number }>();
    for (const l of layouts) {
      const lid = l.machine.line.id;
      if (!byLine.has(lid)) byLine.set(lid, { name: l.machine.line.name, xs: 0, zs: 0, n: 0 });
      const e = byLine.get(lid)!; e.xs += l.pos[0]; e.zs += l.pos[2]; e.n++;
    }
    const lineLabels = [...byLine.values()].map((e) => ({ name: e.name, x: e.xs / e.n, z: e.zs / e.n }));
    return { layouts, lineLabels, width: FLOOR_W, depth: FLOOR_D + (unplaced.length ? 8 : 0) };
  }, [machines]);

  const camDist = Math.max(12, width * 0.8, depth * 1.1);
  return (
    <>
      <PerspectiveCamera makeDefault position={[0, camDist * 0.85, camDist]} fov={50} />
      <OrbitControls enablePan enableZoom enableRotate minDistance={6} maxDistance={120} maxPolarAngle={Math.PI / 2.1} target={[0, 0, 0]} />
      <ambientLight intensity={0.5} />
      <directionalLight position={[15, 20, 10]} intensity={1.1} castShadow shadow-mapSize={[2048, 2048]} />
      <pointLight position={[-10, 8, -10]} intensity={0.4} color="#06b6d4" />
      <Environment preset="night" />
      <fog attach="fog" args={["#0a0a0f", camDist * 1.2, camDist * 3]} />
      <Floor width={width} depth={depth} />
      {/* line labels at centroids */}
      {lineLabels.map((l, i) => (
        <Text key={i} position={[l.x, 1.8, l.z]} fontSize={0.34} color="#38bdf8" anchorX="center" anchorY="middle">
          {l.name}
        </Text>
      ))}
      {layouts.map((l) => (
        <MachineBlock key={l.machine.id} machine={l.machine} position={l.pos} selected={selectedId === l.machine.id} staged={l.staged} onClick={() => onSelect(l.machine)} />
      ))}
    </>
  );
}

function LoadingFallback() {
  return <mesh><boxGeometry args={[1, 1, 1]} /><meshStandardMaterial color="#06b6d4" wireframe /></mesh>;
}

export default function FactoryFloor3D({ machines, selectedId, onSelect }: { machines: MachineNode[]; selectedId: number | null; onSelect: (m: MachineNode) => void }) {
  return (
    <div className="w-full h-[560px] rounded-lg overflow-hidden bg-[#0a0a0f] border">
      <Canvas shadows>
        <Suspense fallback={<LoadingFallback />}>
          <Scene machines={machines} selectedId={selectedId} onSelect={onSelect} />
        </Suspense>
      </Canvas>
    </div>
  );
}
