/**
 * ArticulatedRobot — doc 24 Wave-1 T1.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Renders a robot as an ARTICULATED link chain posed by a live/replay joint-angle
 * vector, instead of a block sliding in XY. Given a kinematic model + a joint vector,
 * it runs the client-side forward kinematics (client/src/lib/kinematics.ts — a faithful
 * port of the server FK so client & server agree on any joint vector), then draws one
 * capsule/cylinder link between consecutive joint origins plus a small joint sphere.
 *
 * SMOOTH MOTION: the target joint vector is interpolated toward per frame (a joint-space
 * lerp mirroring the existing position lerp in DigitalTwinCenter), so streamed/replayed
 * angles animate rather than snap. FK is recomputed from the interpolated angles each
 * frame — cheap for a 4–6-DOF chain.
 *
 * SCALE: the sample chains are authored in MILLIMETRES (server convention). We normalize
 * the whole arm by its own reach so it occupies roughly a fixed scene height regardless
 * of model, matching the ~1.5-unit device slot the twin uses. Purely presentational.
 *
 * This component owns ONLY the articulated body; the caller (DeviceObject) still provides
 * the group transform (scene position), the status beacon, the selection ring, and the
 * click/hover handlers. Material colours are 3D chrome (raw hex is fine here).
 * ════════════════════════════════════════════════════════════════════════════
 */
import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { forwardKinematics, type KinematicModel, type LinkPose } from "@/lib/kinematics";

// Reuse a few scratch objects across frames (avoid per-frame allocation in useFrame).
const _mat = new THREE.Matrix4();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _mid = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _quat = new THREE.Quaternion();

/**
 * Convert an FK link pose (column-major mm) → a scene-space origin, scaled by
 * `scale` (mm→scene) and re-axised Z-up (URDF/DH) → Y-up (scene). We map
 * (x, y, z)_mm → (x, z, -y)_scene * scale so the arm stands up on the floor.
 */
function poseOrigin(pose: LinkPose, scale: number, out: THREE.Vector3): THREE.Vector3 {
  _mat.fromArray(pose.world);
  out.setFromMatrixPosition(_mat);
  return out.set(out.x * scale, out.z * scale, -out.y * scale);
}

/** Live colour source — a stable object whose `.color` is mutated in place by the page. */
export interface ColorSource {
  color: string;
}

/** Apply a hex colour to a mesh's standard material (colour + emissive), if present. */
function applyColor(mesh: THREE.Mesh | null, color: string): void {
  if (!mesh) return;
  const mat = mesh.material as THREE.MeshStandardMaterial;
  if (mat?.color) mat.color.set(color);
  if (mat?.emissive) mat.emissive.set(color);
}

/** A single link rendered as a thin cylinder between two scene points. */
function LinkSegment({ from, to, colorSource, radius }: { from: THREE.Vector3; to: THREE.Vector3; colorSource: ColorSource; radius: number }) {
  const ref = useRef<THREE.Mesh>(null);
  // Position/orient the unit-Y cylinder to span from→to; positions come from the shared
  // origin vectors the parent updates in its own useFrame. Colour is re-applied live.
  useFrame(() => {
    const mesh = ref.current;
    if (!mesh) return;
    _a.copy(from);
    _b.copy(to);
    const len = _a.distanceTo(_b);
    _mid.addVectors(_a, _b).multiplyScalar(0.5);
    mesh.position.copy(_mid);
    _dir.subVectors(_b, _a);
    if (len > 1e-6) {
      _dir.normalize();
      _quat.setFromUnitVectors(_up, _dir);
      mesh.quaternion.copy(_quat);
      mesh.scale.set(1, Math.max(len, 1e-4), 1);
    }
    applyColor(mesh, colorSource.color);
  });
  return (
    <mesh ref={ref} castShadow>
      {/* unit-height cylinder; scaled to the link length on Y each frame */}
      <cylinderGeometry args={[radius, radius, 1, 12]} />
      <meshStandardMaterial emissiveIntensity={0.16} metalness={0.55} roughness={0.45} />
    </mesh>
  );
}

interface ArticulatedRobotProps {
  model: KinematicModel;
  /** Target joint vector (radians/mm). Interpolated toward each frame. */
  jointsRef: React.MutableRefObject<number[]>;
  /** Stable object whose `.color` is updated in place (live status colour). */
  colorSource: ColorSource;
}

/**
 * The articulated body. `jointsRef.current` is the TARGET joint vector (updated by the
 * page from scene-graph / live deltas / replay frames); this component keeps its own
 * animated vector and lerps it toward the target every frame, then re-runs FK and moves
 * the link/joint meshes. The number of links is fixed by the model (stable hook count).
 */
export default function ArticulatedRobot({ model, jointsRef, colorSource }: ArticulatedRobotProps) {
  // mm→scene scale: normalize by the arm's reach so it fits ~1.6 scene units tall.
  const scale = useMemo(() => {
    const rest = forwardKinematics(model, new Array(model.dof).fill(0));
    let reach = 1;
    for (const p of rest) {
      const o = poseOrigin(p, 1, _a);
      reach = Math.max(reach, o.length());
    }
    // Add the base link length; target ~1.6 units for the fully-extended reach.
    return 1.6 / Math.max(reach, 1);
  }, [model]);

  // Animated joint vector (lerped toward the target each frame).
  const animated = useRef<number[]>(new Array(model.dof).fill(0));
  // Per-link scene origins (index 0 = base origin, then one per joint).
  const originsRef = useRef<THREE.Vector3[]>(
    Array.from({ length: model.joints.length + 1 }, () => new THREE.Vector3()),
  );

  // Link radius scales gently down the chain so the arm tapers (presentational).
  const radii = useMemo(
    () => model.joints.map((_, i) => Math.max(0.045, 0.14 - i * 0.014)),
    [model],
  );

  useFrame(() => {
    const target = jointsRef.current;
    const cur = animated.current;
    // Joint-space lerp toward the target (mirrors the 0.18 position lerp).
    for (let i = 0; i < cur.length; i++) {
      const tv = typeof target[i] === "number" ? target[i] : 0;
      cur[i] += (tv - cur[i]) * 0.18;
    }
    // Recompute FK from the interpolated angles and update the shared origin vectors.
    const poses = forwardKinematics(model, cur);
    const origins = originsRef.current;
    origins[0].set(model.base ? model.base[12] * scale : 0, model.base ? model.base[14] * scale : 0, model.base ? -model.base[13] * scale : 0);
    for (let i = 0; i < poses.length; i++) {
      poseOrigin(poses[i], scale, origins[i + 1]);
    }
  });

  const origins = originsRef.current;

  return (
    <group>
      {/* base plinth so the arm has a visible mount */}
      <BasePlinth colorSource={colorSource} />
      {/* one link segment per joint: origins[i] (parent) → origins[i+1] (this joint) */}
      {model.joints.map((_joint, i) => (
        <LinkSegment key={`link-${i}`} from={origins[i]} to={origins[i + 1]} colorSource={colorSource} radius={radii[i]} />
      ))}
      {/* joint spheres at each frame origin */}
      {model.joints.map((_joint, i) => (
        <JointNode key={`joint-${i}`} originRef={origins[i + 1]} colorSource={colorSource} radius={Math.max(0.05, radii[i] * 1.15)} />
      ))}
    </group>
  );
}

/** The fixed base mount (colour re-applied live). */
function BasePlinth({ colorSource }: { colorSource: ColorSource }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(() => applyColor(ref.current, colorSource.color));
  return (
    <mesh ref={ref} position={[0, -0.42, 0]} castShadow>
      <cylinderGeometry args={[0.28, 0.34, 0.16, 20]} />
      <meshStandardMaterial emissiveIntensity={0.1} metalness={0.5} roughness={0.5} />
    </mesh>
  );
}

/** A small sphere pinned to a shared origin vector (updated in the parent's useFrame). */
function JointNode({ originRef, colorSource, radius }: { originRef: THREE.Vector3; colorSource: ColorSource; radius: number }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(() => {
    if (ref.current) {
      ref.current.position.copy(originRef);
      applyColor(ref.current, colorSource.color);
    }
  });
  return (
    <mesh ref={ref} castShadow>
      <sphereGeometry args={[radius, 14, 14]} />
      <meshStandardMaterial emissiveIntensity={0.28} metalness={0.6} roughness={0.4} />
    </mesh>
  );
}
