/**
 * Digital Twin Center — T1 (doc 16 §11.2 / §15 T1, Khối 7).
 *
 * A professional 3D digital twin of ONE factory built on the scene-graph
 * (twin.sceneGraph): zones as floor regions, devices positioned per node.position,
 * each coloured by node.color (live status). Devices with a registered modelUri
 * load their glTF via drei <Gltf> (Suspense + fallback to a primitive coloured
 * block); devices without a model always render the block (glTF is progressive
 * enhancement — the page is useful with zero registered models).
 *
 * THREE MODES driven by the page:
 *   • LIVE     — when TWIN_LIVE_ENABLED (twin.status), join the `twin:{factoryId}`
 *                socket room and apply `twin:device` deltas (smooth lerp). When the
 *                flag is off / disconnected, fall back to refetching sceneGraph on a
 *                5s interval (polling-fallback note shown).
 *   • REPLAY   — historical scrubbing via twin.replay (date range + scrubber + play/
 *                pause + 0.5–4× speed), animating device positions/states along the
 *                timeline (mirrors CellTwinPlayer's rAF playback loop).
 *
 * Reuses the FactoryFloor3D three.js/@react-three/fiber/drei approach (OrbitControls,
 * lighting, grid floor, beacon + selection ring, hover/click). 100% read-only — no
 * device control. SCOPE: this page only; route added in App.tsx; no nav/i18n edits.
 */
import { Canvas, useFrame, type ThreeEvent } from "@react-three/fiber";
import { OrbitControls, PerspectiveCamera, Environment, Grid, Text, Gltf, Center, Resize } from "@react-three/drei";
import { Component, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as THREE from "three";
import { useTranslation } from "react-i18next";
import { Socket } from "socket.io-client";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../server/routers";
import { trpc } from "@/lib/trpc";
import { getSharedSocket, releaseSharedSocket } from "@/lib/socketManager";
import DashboardLayout from "@/components/DashboardLayout";
import { RelatedViews } from "@/components/RelatedViews";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useLocation } from "wouter";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Box, Factory, Cpu, Bot, Activity, AlertTriangle, ListChecks, RefreshCw, Info,
  Radio, History, Play, Pause, RotateCcw, Wifi, WifiOff, Eye, Tag, Boxes, Layers,
  ExternalLink,
} from "lucide-react";

// ── Typesafe shapes inferred from the twin router output ──────────────────────
type RouterOutputs = inferRouterOutputs<AppRouter>;
type SceneGraph = RouterOutputs["twin"]["sceneGraph"];
type DeviceNode = SceneGraph["devices"][number];
type ZoneNode = SceneGraph["zones"][number];
type ReplayResult = RouterOutputs["twin"]["replay"];

// Wire shape of the live `twin:device` socket event (server emitTwinDeviceDeltas).
interface TwinDeviceDelta {
  equipmentId: string; // "machine:<id>" | "robot:<id>" | "device:<id>"
  position?: { x: number; y: number; z?: number };
  state?: string;
  metric?: string;
  ts: number;
}
interface TwinDeviceEvent {
  factoryId: number;
  deltas: TwinDeviceDelta[];
  ts: number;
}

// Scene size that normalized 0–1 floor coords map onto (mirrors FactoryFloor3D).
const FLOOR_W = 40;
const FLOOR_D = 28;
const SPEEDS = [0.5, 1, 2, 4];

// Color for a normalized state, used when a delta/replay frame carries only a state
// string (the scene-graph already gives node.color which we prefer when present).
function stateColor(state?: string | null): string {
  switch ((state ?? "").toLowerCase()) {
    case "running":
    case "execute":
    case "active":
      return "#10b981";
    case "idle":
      return "#f59e0b";
    case "stopped":
    case "held":
    case "suspended":
      return "#f97316";
    case "aborted":
    case "error":
    case "fault":
    case "estop":
      return "#ef4444";
    case "offline":
      return "#64748b";
    default:
      return "#94a3b8";
  }
}

/** Project a device node.position into scene coords. Positions are best-effort:
 *  machines carry normalized 0–1 layout coords; robots carry world poses. We treat
 *  values in [0,1] as normalized floor coords, otherwise as already-scene-ish XY. */
function toScenePos(pos: { x: number; y: number; z?: number } | null, idx: number, n: number): [number, number, number] {
  if (pos && Number.isFinite(pos.x) && Number.isFinite(pos.y)) {
    const norm = pos.x >= 0 && pos.x <= 1 && pos.y >= 0 && pos.y <= 1;
    if (norm) return [(pos.x - 0.5) * FLOOR_W, 0.5, (pos.y - 0.5) * FLOOR_D];
    return [pos.x, typeof pos.z === "number" ? pos.z + 0.5 : 0.5, pos.y];
  }
  // Unplaced: lay out on a staging grid so it's still visible/clickable.
  const cols = Math.max(1, Math.ceil(Math.sqrt(n || 1)));
  const c = idx % cols, r = Math.floor(idx / cols);
  return [-FLOOR_W / 2 + 1.5 + c * 3, 0.5, FLOOR_D / 2 + 3 + r * 3];
}

// ── Live/derived per-device render state held in a ref (no re-render on lerp) ──
interface RenderState {
  // current (animated) scene position
  cur: THREE.Vector3;
  // target scene position (from scene-graph, live delta, or replay frame)
  target: THREE.Vector3;
  color: string;
  state: string;
}

// A primitive coloured block — the ALWAYS-WORKS body used both for unmodeled devices
// and as the Suspense/error fallback while/if a glTF is loading or fails to load.
function PrimitiveBody({
  isRobot, color, meshRef,
}: {
  isRobot: boolean;
  color: string;
  meshRef?: React.RefObject<THREE.Mesh | null>;
}) {
  return (
    <mesh ref={meshRef} castShadow>
      {isRobot ? <cylinderGeometry args={[0.45, 0.55, 1.1, 16]} /> : <boxGeometry args={[1.5, 1, 1.5]} />}
      <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.22} metalness={0.4} roughness={0.5} />
    </mesh>
  );
}

// Fall back GRACEFULLY when a registered model 404s / is malformed: a load error must
// not blank the whole Canvas — this device just renders its coloured block instead.
class ModelErrorBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

// ── One device: glTF when available (Suspense), else a coloured block ─────────
// Real assets come from the T1-a registry (equipment_3d_models). Our seeded glTFs are
// URDF-derived, so they are Z-up (URDF convention) and authored in METRES at true size.
// The scene is Y-up and each device occupies roughly a ~1.5-unit slot, so we (a) rotate
// −90° about X to map Z-up → Y-up and (b) Center + Resize the loaded document into a fixed
// height so ANY registered model — whatever its native scale — sits cleanly on the floor.
// `robot` models are stood up a touch smaller than machines. Purely presentational.
function GltfModel({ src, isRobot }: { src: string; isRobot: boolean }) {
  const fit = isRobot ? 1.1 : 1.6; // target height in scene units
  return (
    // <Gltf> caches the loaded document by src under the hood (drei useGLTF cache),
    // so the same model URI is not re-fetched per instance.
    <group rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.5, 0]}>
      <Resize height scale={fit}>
        <Center bottom>
          <Gltf src={src} />
        </Center>
      </Resize>
    </group>
  );
}

function DeviceObject({
  node, rs, selected, onSelect, onHover,
}: {
  node: DeviceNode;
  rs: RenderState;
  selected: boolean;
  onSelect: () => void;
  onHover: (hovering: boolean) => void;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const meshRef = useRef<THREE.Mesh>(null);
  const [hovered, setHovered] = useState(false);
  const isRobot = node.kind === "robot";

  useFrame(() => {
    if (!groupRef.current) return;
    // Smooth lerp toward the target position (live deltas / replay frames).
    rs.cur.lerp(rs.target, 0.18);
    groupRef.current.position.copy(rs.cur);
    const scale = selected || hovered ? 1.12 : 1;
    groupRef.current.scale.lerp(new THREE.Vector3(scale, scale, scale), 0.15);
    if (meshRef.current) {
      const mat = meshRef.current.material as THREE.MeshStandardMaterial;
      if (mat && mat.color) mat.color.set(rs.color);
      if (mat && mat.emissive) mat.emissive.set(rs.color);
    }
  });

  const handleClick = (e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); onSelect(); };
  const handleOver = (e: ThreeEvent<PointerEvent>) => { e.stopPropagation(); setHovered(true); onHover(true); };
  const handleOut = () => { setHovered(false); onHover(false); };

  return (
    <group ref={groupRef}>
      {/* Body: glTF if a model is registered, else a primitive block (always works).
          A load error (404 / malformed) degrades to the block via ModelErrorBoundary,
          so an unresolved model never blanks the scene — unmodeled devices are unaffected. */}
      {node.modelUri ? (
        <group onClick={handleClick} onPointerOver={handleOver} onPointerOut={handleOut}>
          <ModelErrorBoundary fallback={<PrimitiveBody isRobot={isRobot} color={rs.color} meshRef={meshRef} />}>
            <Suspense fallback={<PrimitiveBody isRobot={isRobot} color={rs.color} meshRef={meshRef} />}>
              <GltfModel src={node.modelUri} isRobot={isRobot} />
            </Suspense>
          </ModelErrorBoundary>
        </group>
      ) : (
        <group onClick={handleClick} onPointerOver={handleOver} onPointerOut={handleOut}>
          <PrimitiveBody isRobot={isRobot} color={rs.color} meshRef={meshRef} />
        </group>
      )}

      {/* status beacon */}
      <mesh position={[0, 1, 0]}>
        <sphereGeometry args={[0.13]} />
        <meshStandardMaterial color={rs.color} emissive={rs.color} emissiveIntensity={0.9} />
      </mesh>

      {/* selection ring */}
      {selected && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.49, 0]}>
          <ringGeometry args={[1.05, 1.3, 32]} />
          <meshBasicMaterial color="#06b6d4" side={THREE.DoubleSide} />
        </mesh>
      )}

      {(hovered || selected) && (
        <Text position={[0, -0.7, 0.9]} fontSize={0.24} color="#ffffff" anchorX="center" anchorY="top" outlineWidth={0.01} outlineColor="#000">
          {node.code}
        </Text>
      )}
    </group>
  );
}

/** Zones drawn as translucent floor regions. Safety / human-shared highlighted. */
function ZoneRegion({ zone, index }: { zone: ZoneNode; index: number }) {
  // bounds may be { x, y, w, h } in normalized coords; fall back to a tiled strip.
  const b = (zone.bounds ?? {}) as Record<string, number | undefined>;
  const hasBounds = [b.x, b.y, b.w, b.h].every((v) => typeof v === "number");
  const cx = hasBounds ? ((b.x! + b.w! / 2) - 0.5) * FLOOR_W : (-FLOOR_W / 2 + 6 + (index % 3) * 12);
  const cz = hasBounds ? ((b.y! + b.h! / 2) - 0.5) * FLOOR_D : (-FLOOR_D / 2 + 5 + Math.floor(index / 3) * 9);
  const w = hasBounds ? b.w! * FLOOR_W : 9;
  const d = hasBounds ? b.h! * FLOOR_D : 7;
  const danger = zone.zoneType === "human_shared" || zone.zoneType === "safety";
  const color = danger ? "#f43f5e" : zone.zoneType === "charging" ? "#22c55e" : "#38bdf8";
  return (
    <group position={[cx, -0.45, cz]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[w, d]} />
        <meshStandardMaterial color={color} transparent opacity={danger ? 0.18 : 0.1} side={THREE.DoubleSide} />
      </mesh>
      {/* zone border */}
      <lineSegments rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
        <edgesGeometry args={[new THREE.PlaneGeometry(w, d)]} />
        <lineBasicMaterial color={color} />
      </lineSegments>
      <Text position={[0, 0.05, -d / 2 + 0.6]} rotation={[-Math.PI / 2, 0, 0]} fontSize={0.42} color={color} anchorX="center" anchorY="middle">
        {zone.name}
      </Text>
    </group>
  );
}

function Floor() {
  return (
    <>
      <Grid args={[FLOOR_W + 12, FLOOR_D + 16]} cellSize={1} cellThickness={0.5} cellColor="#1e293b" sectionSize={5} sectionThickness={1} sectionColor="#334155" fadeDistance={70} fadeStrength={1} infiniteGrid />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.51, 0]} receiveShadow>
        <planeGeometry args={[FLOOR_W + 14, FLOOR_D + 18]} />
        <meshStandardMaterial color="#0f172a" transparent opacity={0.85} />
      </mesh>
    </>
  );
}

function LoadingFallback() {
  return <mesh><boxGeometry args={[1, 1, 1]} /><meshStandardMaterial color="#06b6d4" wireframe /></mesh>;
}

interface LayerToggles { robots: boolean; zones: boolean; labels: boolean }

function TwinScene({
  devices, zones, renderStates, layers, selectedId, onSelect, onHover,
}: {
  devices: DeviceNode[];
  zones: ZoneNode[];
  renderStates: Map<string, RenderState>;
  layers: LayerToggles;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onHover: (id: string | null) => void;
}) {
  const shown = useMemo(
    () => devices.filter((d) => (d.kind === "robot" ? layers.robots : true)),
    [devices, layers.robots],
  );
  const camDist = Math.max(20, FLOOR_W * 0.95);
  return (
    <>
      <PerspectiveCamera makeDefault position={[0, camDist * 0.85, camDist]} fov={50} />
      <OrbitControls enablePan enableZoom enableRotate minDistance={8} maxDistance={160} maxPolarAngle={Math.PI / 2.1} target={[0, 0, 0]} />
      <ambientLight intensity={0.55} />
      <directionalLight position={[18, 24, 12]} intensity={1.1} castShadow shadow-mapSize={[2048, 2048]} />
      <pointLight position={[-12, 10, -12]} intensity={0.4} color="#06b6d4" />
      <Environment preset="night" />
      <fog attach="fog" args={["#0a0a0f", camDist * 1.3, camDist * 3.2]} />
      <Floor />

      {layers.zones && zones.map((z, i) => <ZoneRegion key={z.id} zone={z} index={i} />)}

      {shown.map((d) => {
        const rs = renderStates.get(d.id);
        if (!rs) return null;
        return (
          <DeviceObject
            key={d.id}
            node={d}
            rs={rs}
            selected={selectedId === d.id}
            onSelect={() => onSelect(d.id)}
            onHover={(h) => onHover(h ? d.id : null)}
          />
        );
      })}

      {layers.labels && shown.map((d, i) => {
        const rs = renderStates.get(d.id);
        if (!rs) return null;
        const p = rs.target;
        return (
          <Text key={`lbl-${d.id}`} position={[p.x, 1.6, p.z]} fontSize={0.26} color="#94a3b8" anchorX="center" anchorY="bottom">
            {d.code}
          </Text>
        );
      })}
    </>
  );
}

// ── Date helpers for the replay range pickers ─────────────────────────────────
function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function DigitalTwinCenter() {
  const { t } = useTranslation();
  const [, setLocation] = useLocation();

  // ── Flag + scene-graph data ──
  const statusQ = trpc.twin.status.useQuery();
  const liveEnabled = statusQ.data?.enabled ?? false;

  const [factoryId, setFactoryId] = useState<number | null>(null);
  const [mode, setMode] = useState<"live" | "replay">("live");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [layers, setLayers] = useState<LayerToggles>({ robots: true, zones: true, labels: false });

  // Whether a live delta has actually arrived (else we're on the polling fallback).
  const [isStreaming, setIsStreaming] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  // Discover factories from the existing machine-status query (no nav/extra router).
  const factoriesQ = trpc.machineStatus.listWithStatus.useQuery(undefined, { staleTime: 30_000 });
  const factories = useMemo(() => {
    const m = new Map<number, { id: number; name: string }>();
    for (const r of (factoriesQ.data ?? []) as any[]) if (r.factory) m.set(r.factory.id, { id: r.factory.id, name: r.factory.name });
    return [...m.values()];
  }, [factoriesQ.data]);
  const activeFactoryId = factoryId ?? factories[0]?.id ?? null;

  // Scene graph — polled on a 5s interval ONLY when not actively streaming a live
  // delta (and only in live mode; replay drives positions from frames).
  const sceneQ = trpc.twin.sceneGraph.useQuery(
    { factoryId: activeFactoryId ?? 0 },
    {
      enabled: activeFactoryId != null,
      refetchInterval: mode === "live" && !isStreaming ? 5000 : false,
    },
  );
  const scene = sceneQ.data;
  const devices = useMemo<DeviceNode[]>(() => scene?.devices ?? [], [scene]);
  const zones = useMemo<ZoneNode[]>(() => scene?.zones ?? [], [scene]);

  // ── Per-device render state (positions/colors), mutated in place for lerping ──
  const renderStates = useRef<Map<string, RenderState>>(new Map());
  // Rebuild render-state targets whenever the scene graph changes (base layout).
  useEffect(() => {
    const next = new Map<string, RenderState>();
    devices.forEach((d, i) => {
      const [x, y, z] = toScenePos(d.position, i, devices.length);
      const prev = renderStates.current.get(d.id);
      next.set(d.id, {
        cur: prev ? prev.cur.clone() : new THREE.Vector3(x, y, z),
        target: new THREE.Vector3(x, y, z),
        color: d.color || stateColor(d.state),
        state: d.state,
      });
    });
    renderStates.current = next;
  }, [devices]);

  // ── LIVE socket: join twin:{factoryId}, apply twin:device deltas ──
  useEffect(() => {
    if (mode !== "live" || !liveEnabled || activeFactoryId == null) {
      setIsStreaming(false);
      return;
    }
    const socket = getSharedSocket();
    socketRef.current = socket;
    const join = () => socket.emit("subscribe", { twinFactoryId: activeFactoryId });

    const onDevice = (event: TwinDeviceEvent) => {
      if (event.factoryId !== activeFactoryId) return;
      setIsStreaming(true);
      const map = renderStates.current;
      let i = 0;
      for (const delta of event.deltas) {
        const rs = map.get(delta.equipmentId);
        if (!rs) { i++; continue; }
        if (delta.position) {
          const [x, y, z] = toScenePos(delta.position, i, map.size);
          rs.target.set(x, y, z);
        }
        if (delta.state) { rs.state = delta.state; rs.color = stateColor(delta.state); }
        i++;
      }
    };

    socket.on("connect", join);
    socket.on("twin:device", onDevice);
    if (socket.connected) join();

    return () => {
      socket.emit("unsubscribe", { twinFactoryId: activeFactoryId });
      socket.off("connect", join);
      socket.off("twin:device", onDevice);
      releaseSharedSocket();
      setIsStreaming(false);
    };
  }, [mode, liveEnabled, activeFactoryId]);

  // ── REPLAY state + playback loop (mirrors CellTwinPlayer rAF) ──
  const utils = trpc.useUtils();
  const [from, setFrom] = useState<string>(() => toLocalInput(new Date(Date.now() - 60 * 60 * 1000)));
  const [to, setTo] = useState<string>(() => toLocalInput(new Date()));
  const [replay, setReplay] = useState<ReplayResult | null>(null);
  const [replayLoading, setReplayLoading] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [frameIdx, setFrameIdx] = useState(0); // index into the unique timestamps

  // Unique ordered timestamps in the replay (each "frame" applies all snapshots at t).
  const replayTimes = useMemo(() => {
    if (!replay) return [];
    const set = new Set<number>();
    for (const s of replay.snapshots) set.add(s.timestamp);
    return [...set].sort((a, b) => a - b);
  }, [replay]);

  const playingRef = useRef(playing); playingRef.current = playing;
  const speedRef = useRef(speed); speedRef.current = speed;
  const idxRef = useRef(0); idxRef.current = frameIdx;
  const rafRef = useRef<number | null>(null);
  const accRef = useRef(0);
  const lastTsRef = useRef<number | null>(null);

  async function loadReplay() {
    if (activeFactoryId == null) return;
    setReplayLoading(true);
    setPlaying(false);
    try {
      const res = await utils.twin.replay.fetch({
        factoryId: activeFactoryId,
        from: new Date(from),
        to: new Date(to),
        step: 5,
      });
      setReplay(res as ReplayResult);
      setFrameIdx(0);
    } finally {
      setReplayLoading(false);
    }
  }

  // Apply replay frame at the current index onto the render-state targets.
  useEffect(() => {
    if (mode !== "replay" || !replay || replayTimes.length === 0) return;
    const tNow = replayTimes[Math.min(frameIdx, replayTimes.length - 1)];
    const map = renderStates.current;
    let i = 0;
    for (const snap of replay.snapshots) {
      if (snap.timestamp !== tNow) { i++; continue; }
      const rs = map.get(snap.equipmentId);
      if (!rs) { i++; continue; }
      if (snap.position) {
        const [x, y, z] = toScenePos(snap.position, i, map.size);
        rs.target.set(x, y, z);
      }
      if (snap.packMlState) { rs.state = snap.packMlState; rs.color = stateColor(snap.packMlState); }
      i++;
    }
  }, [mode, replay, replayTimes, frameIdx]);

  // Playback rAF loop — advances frameIdx by wall-clock × speed (one frame / ~step).
  useEffect(() => {
    if (mode !== "replay") return;
    const stepMs = (replay?.downsampledStepSec ?? 5) * 1000;
    const frame = (ts: number) => {
      if (!playingRef.current) { rafRef.current = null; return; }
      const last = lastTsRef.current ?? ts;
      lastTsRef.current = ts;
      accRef.current += (ts - last) * speedRef.current;
      // Advance one timeline frame each `stepMs` of (sped-up) wall clock.
      while (accRef.current >= stepMs) {
        accRef.current -= stepMs;
        const nextIdx = idxRef.current + 1;
        if (nextIdx >= replayTimes.length) { setPlaying(false); idxRef.current = replayTimes.length - 1; setFrameIdx(replayTimes.length - 1); rafRef.current = null; return; }
        idxRef.current = nextIdx;
        setFrameIdx(nextIdx);
      }
      rafRef.current = requestAnimationFrame(frame);
    };
    if (playing) { lastTsRef.current = null; accRef.current = 0; rafRef.current = requestAnimationFrame(frame); }
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); rafRef.current = null; };
  }, [playing, mode, replay, replayTimes.length]);

  // ── KPIs from the scene graph ──
  const kpi = useMemo(() => {
    let running = 0, idle = 0, down = 0, alarms = 0, tasks = 0, robots = 0;
    for (const d of devices) {
      if (d.kind === "robot") robots++;
      if (d.state === "running") running++;
      else if (d.state === "idle") idle++;
      else if (d.state === "aborted" || d.state === "estop" || d.state === "offline" || d.state === "stopped") down++;
      if (d.alarm) alarms++;
      if (d.activeTaskId != null) tasks++;
    }
    return { total: devices.length, running, idle, down, alarms, tasks, robots, models: devices.filter((d) => d.modelUri).length };
  }, [devices]);

  const selected = devices.find((d) => d.id === selectedId) ?? null;
  const hovered = devices.find((d) => d.id === hoverId) ?? null;

  return (
    <DashboardLayout>
      <div className="space-y-4 p-1">
        {/* ── PageHeader ── */}
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h1 className="text-xl font-semibold flex items-center gap-2">
              <Boxes className="h-5 w-5 text-primary" /> {t("twin.title", "Digital Twin Center")}
            </h1>
            <p className="text-sm text-muted-foreground">
              {t("twin.subtitle", "Live 3D twin of the factory scene-graph — zones, machines & robots coloured by real status. Replay history to investigate incidents.")}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Select value={activeFactoryId ? String(activeFactoryId) : undefined} onValueChange={(v) => { setFactoryId(Number(v)); setSelectedId(null); }}>
              <SelectTrigger className="w-[200px]"><SelectValue placeholder={t("twin.pickFactory", "Select factory")} /></SelectTrigger>
              <SelectContent>
                {factories.map((f) => <SelectItem key={f.id} value={String(f.id)}>{f.name}</SelectItem>)}
              </SelectContent>
            </Select>
            {/* mode toggle */}
            <div className="flex rounded-md border overflow-hidden">
              <Button size="sm" variant={mode === "live" ? "default" : "ghost"} className="rounded-none" onClick={() => setMode("live")}>
                <Radio className="h-4 w-4 mr-1" /> {t("twin.live", "Live")}
              </Button>
              <Button size="sm" variant={mode === "replay" ? "default" : "ghost"} className="rounded-none" onClick={() => setMode("replay")}>
                <History className="h-4 w-4 mr-1" /> {t("twin.replay", "Replay")}
              </Button>
            </div>
            <Button size="sm" variant="outline" onClick={() => sceneQ.refetch()}>
              <RefreshCw className={`h-4 w-4 mr-1 ${sceneQ.isFetching ? "animate-spin" : ""}`} /> {t("twin.refresh", "Refresh")}
            </Button>
          </div>
        </div>

        {/* U7 cross-links to the differentiated 2D what-if twin + panorama. */}
        <RelatedViews
          links={[
            { href: "/digital-twin", labelKey: "nav.digitalTwin", labelDefault: "2D Twin (what-if / WIP flow)" },
            { href: "/command-center", labelKey: "nav.commandCenter", labelDefault: "Command Center" },
          ]}
        />

        {/* ── Honest flag / connection banner ── */}
        {mode === "live" && (
          !liveEnabled ? (
            <Banner tone="amber" icon={<Info className="h-4 w-4 mt-0.5 shrink-0" />}>
              {t("twin.flagOff", "Live streaming is disabled (TWIN_LIVE_ENABLED off). Showing the scene-graph polled every 5s. Replay still works — it is read-only history.")}
            </Banner>
          ) : isStreaming ? (
            <Banner tone="emerald" icon={<Wifi className="h-4 w-4 mt-0.5 shrink-0" />}>
              {t("twin.streaming", "Live: receiving device deltas over twin:{{f}} — positions & states update in real time.", { f: activeFactoryId })}
            </Banner>
          ) : (
            <Banner tone="sky" icon={<WifiOff className="h-4 w-4 mt-0.5 shrink-0" />}>
              {t("twin.pollFallback", "Live enabled, but no device delta has arrived yet — polling the scene-graph every 5s as a fallback.")}
            </Banner>
          )
        )}
        {mode === "replay" && (
          <Banner tone="sky" icon={<History className="h-4 w-4 mt-0.5 shrink-0" />}>
            {t("twin.replayNote", "Replay is read-only history from TimescaleDB (downsampled). Pick a window, load, then scrub or play back the incident.")}
          </Banner>
        )}

        {/* ── KPI strip ── */}
        <div className="grid grid-cols-3 md:grid-cols-7 gap-3">
          <Kpi label={t("twin.devices", "Devices")} value={String(kpi.total)} icon={<Cpu className="h-4 w-4" />} />
          <Kpi label={t("twin.robots", "Robots")} value={String(kpi.robots)} icon={<Bot className="h-4 w-4" />} />
          <Kpi label={t("twin.running", "Running")} value={String(kpi.running)} cls="text-success" icon={<Activity className="h-4 w-4" />} />
          <Kpi label={t("twin.idle", "Idle")} value={String(kpi.idle)} cls="text-warning" />
          <Kpi label={t("twin.down", "Down/Off")} value={String(kpi.down)} cls="text-destructive" />
          <Kpi label={t("twin.alarms", "Alarms")} value={String(kpi.alarms)} cls={kpi.alarms ? "text-destructive" : undefined} icon={<AlertTriangle className="h-4 w-4" />} />
          <Kpi label={t("twin.activeTasks", "Active tasks")} value={String(kpi.tasks)} icon={<ListChecks className="h-4 w-4" />} />
        </div>

        {/* ── Controls bar (layer toggles) ── */}
        <div className="flex items-center gap-4 flex-wrap rounded-md border px-3 py-2 text-sm">
          <span className="flex items-center gap-1 text-muted-foreground"><Layers className="h-4 w-4" /> {t("twin.layers", "Layers")}</span>
          <LayerSwitch icon={<Bot className="h-3.5 w-3.5" />} label={t("twin.layerRobots", "Robots")} checked={layers.robots} onChange={(v) => setLayers((l) => ({ ...l, robots: v }))} />
          <LayerSwitch icon={<Box className="h-3.5 w-3.5" />} label={t("twin.layerZones", "Zones")} checked={layers.zones} onChange={(v) => setLayers((l) => ({ ...l, zones: v }))} />
          <LayerSwitch icon={<Tag className="h-3.5 w-3.5" />} label={t("twin.layerLabels", "Labels")} checked={layers.labels} onChange={(v) => setLayers((l) => ({ ...l, labels: v }))} />
          <span className="ml-auto text-xs text-muted-foreground">
            {kpi.models > 0
              ? t("twin.modelsLoaded", "{{n}} glTF model(s) registered", { n: kpi.models })
              : t("twin.noModels", "No 3D models registered yet — devices render as coloured blocks (glTF is progressive).")}
          </span>
        </div>

        {/* ── Replay timeline controls ── */}
        {mode === "replay" && (
          <Card>
            <CardContent className="py-3 space-y-3">
              <div className="flex items-end gap-3 flex-wrap">
                <div>
                  <Label className="text-xs text-muted-foreground">{t("twin.from", "From")}</Label>
                  <input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)}
                    className="block h-9 rounded-md border bg-background px-2 text-sm" />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">{t("twin.to", "To")}</Label>
                  <input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)}
                    className="block h-9 rounded-md border bg-background px-2 text-sm" />
                </div>
                <Button size="sm" onClick={loadReplay} disabled={replayLoading || activeFactoryId == null}>
                  <RefreshCw className={`h-4 w-4 mr-1 ${replayLoading ? "animate-spin" : ""}`} /> {t("twin.loadReplay", "Load replay")}
                </Button>
                <div className="flex items-center gap-1">
                  <Button size="sm" disabled={replayTimes.length === 0} onClick={() => setPlaying((p) => !p)}>
                    {playing ? <><Pause className="h-4 w-4 mr-1" />{t("twin.pause", "Pause")}</> : <><Play className="h-4 w-4 mr-1" />{t("twin.play", "Play")}</>}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => { setPlaying(false); setFrameIdx(0); }}>
                    <RotateCcw className="h-4 w-4 mr-1" />{t("twin.reset", "Reset")}
                  </Button>
                </div>
                <div className="flex items-center gap-1">
                  <Label className="text-xs text-muted-foreground">{t("twin.speed", "Speed")}</Label>
                  {SPEEDS.map((s) => (
                    <Button key={s} size="sm" variant={speed === s ? "default" : "outline"} className="px-2 h-7" onClick={() => setSpeed(s)}>{s}×</Button>
                  ))}
                </div>
              </div>
              {/* scrubber */}
              {replayTimes.length > 0 ? (
                <div className="space-y-1">
                  <Slider min={0} max={replayTimes.length - 1} step={1} value={[Math.min(frameIdx, replayTimes.length - 1)]} onValueChange={([v]) => { setPlaying(false); setFrameIdx(v); }} />
                  <div className="flex justify-between text-[11px] text-muted-foreground">
                    <span>{new Date(replayTimes[0]).toLocaleString()}</span>
                    <span className="text-foreground font-medium">
                      {t("twin.frame", "Frame")} {frameIdx + 1}/{replayTimes.length} · {new Date(replayTimes[Math.min(frameIdx, replayTimes.length - 1)]).toLocaleTimeString()}
                    </span>
                    <span>{new Date(replayTimes[replayTimes.length - 1]).toLocaleString()}</span>
                  </div>
                  <div className="text-[11px] text-muted-foreground">{replay?.note}</div>
                </div>
              ) : replay ? (
                <p className="text-sm text-muted-foreground">{t("twin.noFrames", "No telemetry in this window. Try a wider range or a factory with recorded device telemetry.")}</p>
              ) : null}
            </CardContent>
          </Card>
        )}

        {/* ── 3D scene + inspector ── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card className="lg:col-span-2">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Factory className="h-4 w-4" /> {scene?.factory?.name ?? t("twin.scene", "Factory scene")} — {devices.length} {t("twin.devicesLower", "devices")} · {zones.length} {t("twin.zonesLower", "zones")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {activeFactoryId == null ? (
                <div className="h-[560px] flex items-center justify-center text-muted-foreground text-sm">{t("twin.pickFactoryHint", "Select a factory to render its twin.")}</div>
              ) : sceneQ.isLoading ? (
                <div className="h-[560px] flex items-center justify-center text-muted-foreground">{t("twin.loading", "Loading scene-graph…")}</div>
              ) : devices.length === 0 ? (
                <div className="h-[560px] flex items-center justify-center text-muted-foreground text-sm">{t("twin.emptyScene", "No devices in this factory's scene-graph.")}</div>
              ) : (
                <div className="w-full h-[560px] rounded-lg overflow-hidden bg-[#0a0a0f] border">
                  <Canvas shadows onPointerMissed={() => setSelectedId(null)}>
                    <Suspense fallback={<LoadingFallback />}>
                      <TwinScene
                        devices={devices}
                        zones={zones}
                        renderStates={renderStates.current}
                        layers={layers}
                        selectedId={selectedId}
                        onSelect={setSelectedId}
                        onHover={setHoverId}
                      />
                    </Suspense>
                  </Canvas>
                </div>
              )}
              <div className="flex flex-wrap gap-3 mt-2 text-[11px] text-muted-foreground">
                <Legend color="#10b981" label={t("twin.lgRunning", "Running")} />
                <Legend color="#f59e0b" label={t("twin.lgIdle", "Idle")} />
                <Legend color="#f97316" label={t("twin.lgStopped", "Stopped/Held")} />
                <Legend color="#ef4444" label={t("twin.lgFault", "Fault/E-stop")} />
                <Legend color="#64748b" label={t("twin.lgOffline", "Offline")} />
                {hovered && <span className="ml-auto text-foreground">{hovered.name} · {hovered.state}</span>}
              </div>
            </CardContent>
          </Card>

          {/* inspector */}
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Eye className="h-4 w-4" /> {t("twin.inspect", "Inspect device")}</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {!selected ? (
                <p className="text-sm text-muted-foreground">{t("twin.inspectHint", "Click a device in the 3D scene to inspect its PackML state, alarm, active task and model.")}</p>
              ) : (
                <>
                  <div>
                    <div className="text-lg font-semibold flex items-center gap-2">
                      {selected.kind === "robot" ? <Bot className="h-4 w-4" /> : <Cpu className="h-4 w-4" />}
                      {selected.name}
                    </div>
                    <div className="text-xs text-muted-foreground font-mono">{selected.code} · {selected.kind} · #{selected.refId}</div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge style={{ background: selected.color || stateColor(selected.state) }} className="text-white capitalize">{selected.state}</Badge>
                    {selected.activeTaskId != null && <Badge variant="outline"><ListChecks className="h-3 w-3 mr-1" /> {t("twin.task", "Task")} #{selected.activeTaskId}</Badge>}
                    {selected.modelUri ? <Badge variant="secondary"><Boxes className="h-3 w-3 mr-1" /> {selected.modelKind ?? "gltf"}</Badge> : <Badge variant="outline">{t("twin.block", "block")}</Badge>}
                  </div>
                  {selected.alarm && (
                    <div className="rounded-md border border-red-300 bg-red-50 dark:bg-red-950/30 px-2 py-1.5 text-xs text-red-700 dark:text-red-300">
                      <AlertTriangle className="h-3.5 w-3.5 inline mr-1" />
                      <span className="font-mono">{selected.alarm.code}</span> · {selected.alarm.severity}
                      {selected.alarm.message ? ` — ${selected.alarm.message}` : ""}
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <Kpi label={t("twin.stationId", "Station")} value={selected.stationId != null ? `#${selected.stationId}` : "—"} />
                    <Kpi label={t("twin.position", "Position")} value={selected.position ? `${selected.position.x.toFixed(2)}, ${selected.position.y.toFixed(2)}` : t("twin.unplaced", "unplaced")} />
                  </div>
                  {selected.modelUri && (
                    <div className="text-[11px] text-muted-foreground break-all">
                      <span className="font-medium text-foreground">{t("twin.modelUri", "Model URI")}:</span> {selected.modelUri}
                    </div>
                  )}
                  {typeof selected.refId === "number" && (
                    <Button
                      size="sm"
                      className="w-full"
                      onClick={() => setLocation(selected.kind === "robot" ? `/robot/${selected.refId}` : `/machine/${selected.refId}`)}
                    >
                      <ExternalLink className="h-4 w-4 mr-1" /> {t("twin.openCockpit", "Open cockpit")}
                    </Button>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}

// ── Small presentational helpers ──────────────────────────────────────────────
function Kpi({ label, value, cls, icon }: { label: string; value: string; cls?: string; icon?: React.ReactNode }) {
  return (
    <div className="rounded-md border p-2">
      <div className="text-[10px] text-muted-foreground flex items-center gap-1">{icon}{label}</div>
      <div className={`text-lg font-semibold ${cls ?? ""}`}>{value}</div>
    </div>
  );
}
function Legend({ color, label }: { color: string; label: string }) {
  return <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm" style={{ background: color }} /> {label}</span>;
}
function LayerSwitch({ icon, label, checked, onChange }: { icon: React.ReactNode; label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 cursor-pointer select-none">
      <Switch checked={checked} onCheckedChange={onChange} />
      <span className="flex items-center gap-1 text-sm">{icon}{label}</span>
    </label>
  );
}
function Banner({ tone, icon, children }: { tone: "amber" | "emerald" | "sky"; icon: React.ReactNode; children: React.ReactNode }) {
  const cls =
    tone === "amber"
      ? "border-amber-300 bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-200"
      : tone === "emerald"
        ? "border-emerald-300 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-200"
        : "border-sky-300 bg-sky-50 dark:bg-sky-950/30 text-sky-800 dark:text-sky-200";
  return <div className={`rounded-md border px-3 py-2 text-xs flex items-start gap-2 ${cls}`}>{icon}<span>{children}</span></div>;
}
