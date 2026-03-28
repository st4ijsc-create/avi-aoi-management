import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Text, Box, Cylinder, PerspectiveCamera, Environment, Grid } from "@react-three/drei";
import { useRef, useState, Suspense } from "react";
import * as THREE from "three";
import type { FactoryData } from "@/types/factory";

interface Factory3DSceneProps {
  factories: FactoryData[];
  selectedFactory: FactoryData | null;
  onSelectFactory: (factory: FactoryData) => void;
}

function FactoryBuilding({ 
  factory, 
  position, 
  isSelected, 
  onClick 
}: { 
  factory: FactoryData; 
  position: [number, number, number]; 
  isSelected: boolean;
  onClick: () => void;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const [hovered, setHovered] = useState(false);

  useFrame((state) => {
    if (meshRef.current) {
      // Subtle floating animation
      meshRef.current.position.y = position[1] + Math.sin(state.clock.elapsedTime + position[0]) * 0.05;
      
      // Glow effect when selected or hovered
      if (isSelected || hovered) {
        meshRef.current.scale.lerp(new THREE.Vector3(1.05, 1.05, 1.05), 0.1);
      } else {
        meshRef.current.scale.lerp(new THREE.Vector3(1, 1, 1), 0.1);
      }
    }
  });

  const yieldColor = factory.stats.yieldRate >= 95 
    ? "#10b981" 
    : factory.stats.yieldRate >= 90 
      ? "#f59e0b" 
      : "#ef4444";

  return (
    <group position={position}>
      {/* Main building */}
      <mesh
        ref={meshRef}
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        onPointerOver={() => setHovered(true)}
        onPointerOut={() => setHovered(false)}
      >
        <boxGeometry args={[2, 1.2, 1.5]} />
        <meshStandardMaterial 
          color={isSelected ? "#06b6d4" : hovered ? "#0ea5e9" : "#334155"} 
          metalness={0.3}
          roughness={0.7}
        />
      </mesh>

      {/* Roof */}
      <mesh position={[0, 0.8, 0]}>
        <boxGeometry args={[2.2, 0.2, 1.7]} />
        <meshStandardMaterial color="#1e293b" metalness={0.5} roughness={0.5} />
      </mesh>

      {/* Chimney */}
      <Cylinder args={[0.1, 0.1, 0.6]} position={[0.7, 1.2, 0.4]}>
        <meshStandardMaterial color="#475569" />
      </Cylinder>

      {/* Status indicator light */}
      <mesh position={[0, 1.5, 0]}>
        <sphereGeometry args={[0.15]} />
        <meshStandardMaterial 
          color={yieldColor} 
          emissive={yieldColor}
          emissiveIntensity={0.5}
        />
      </mesh>

      {/* Factory name */}
      <Text
        position={[0, -1, 0]}
        fontSize={0.2}
        color="#ffffff"
        anchorX="center"
        anchorY="top"
      >
        {factory.name}
      </Text>

      {/* Stats */}
      <Text
        position={[0, -1.3, 0]}
        fontSize={0.15}
        color="#94a3b8"
        anchorX="center"
        anchorY="top"
      >
        {`Yield: ${factory.stats.yieldRate.toFixed(1)}%`}
      </Text>

      {/* Workshop indicators */}
      {factory.workshops.slice(0, 4).map((_, index) => (
        <Box
          key={index}
          args={[0.3, 0.5, 0.3]}
          position={[-0.6 + index * 0.4, -0.35, 0.9]}
        >
          <meshStandardMaterial color="#475569" />
        </Box>
      ))}
    </group>
  );
}

function Ground() {
  return (
    <>
      <Grid
        args={[50, 50]}
        cellSize={1}
        cellThickness={0.5}
        cellColor="#1e293b"
        sectionSize={5}
        sectionThickness={1}
        sectionColor="#334155"
        fadeDistance={50}
        fadeStrength={1}
        followCamera={false}
        infiniteGrid={true}
      />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow>
        <planeGeometry args={[100, 100]} />
        <meshStandardMaterial color="#0f172a" transparent opacity={0.8} />
      </mesh>
    </>
  );
}

function Scene({ factories, selectedFactory, onSelectFactory }: Factory3DSceneProps) {
  // Position factories in a circle
  const positions: [number, number, number][] = factories.map((_, index) => {
    const angle = (index / factories.length) * Math.PI * 2;
    const radius = 5;
    return [Math.cos(angle) * radius, 0.6, Math.sin(angle) * radius];
  });

  return (
    <>
      <PerspectiveCamera makeDefault position={[8, 6, 8]} fov={50} />
      <OrbitControls 
        enablePan={true}
        enableZoom={true}
        enableRotate={true}
        minDistance={5}
        maxDistance={20}
        maxPolarAngle={Math.PI / 2.2}
      />

      {/* Lighting */}
      <ambientLight intensity={0.4} />
      <directionalLight
        position={[10, 10, 5]}
        intensity={1}
        castShadow
        shadow-mapSize={[2048, 2048]}
      />
      <pointLight position={[-5, 5, -5]} intensity={0.5} color="#06b6d4" />

      {/* Environment */}
      <Environment preset="night" />
      <fog attach="fog" args={["#0a0a0f", 15, 40]} />

      {/* Ground */}
      <Ground />

      {/* Factories */}
      {factories.map((factory, index) => (
        <FactoryBuilding
          key={factory.id}
          factory={factory}
          position={positions[index]}
          isSelected={selectedFactory?.id === factory.id}
          onClick={() => onSelectFactory(factory)}
        />
      ))}

      {/* Center hub */}
      <mesh position={[0, 0.1, 0]}>
        <cylinderGeometry args={[1, 1.2, 0.2, 32]} />
        <meshStandardMaterial color="#1e293b" metalness={0.5} roughness={0.5} />
      </mesh>
      <Text
        position={[0, 0.3, 0]}
        fontSize={0.25}
        color="#06b6d4"
        anchorX="center"
        anchorY="bottom"
      >
        Tập đoàn
      </Text>

      {/* Connection lines - using Line component from drei */}
      {factories.map((_, index) => {
        const pos = positions[index];
        const points = [
          new THREE.Vector3(0, 0.1, 0),
          new THREE.Vector3(pos[0] * 0.7, 0.1, pos[2] * 0.7)
        ];
        return (
          <primitive
            key={`line-${index}`}
            object={new THREE.Line(
              new THREE.BufferGeometry().setFromPoints(points),
              new THREE.LineBasicMaterial({ color: "#06b6d4", opacity: 0.3, transparent: true })
            )}
          />
        );
      })}
    </>
  );
}

function LoadingFallback() {
  return (
    <mesh>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial color="#06b6d4" wireframe />
    </mesh>
  );
}

export default function Factory3DScene({ factories, selectedFactory, onSelectFactory }: Factory3DSceneProps) {
  return (
    <div className="w-full h-[600px] rounded-lg overflow-hidden bg-[#0a0a0f]">
      <Canvas shadows>
        <Suspense fallback={<LoadingFallback />}>
          <Scene 
            factories={factories} 
            selectedFactory={selectedFactory} 
            onSelectFactory={onSelectFactory} 
          />
        </Suspense>
      </Canvas>
    </div>
  );
}
