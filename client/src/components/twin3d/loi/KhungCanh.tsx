/**
 * KhungCanh.tsx — `<Canvas>` + camera + đèn + `frameloop="demand"` + `dpr=[1,1.5]`.
 * Đây là cửa duy nhất vào WebGL của kit Twin 3D.
 *
 * ★ RB-5 — KHÔNG `<Environment>`, KHÔNG asset CDN nào.
 *   `CommandCenter.tsx:605-607` đã phải TỰ TAY gỡ `<Environment preset="night">`
 *   vì mạng nhà máy air-gap chặn CDN → khung đen. Đây là lỗi đã xảy ra THẬT, không
 *   phải rủi ro lý thuyết. Ánh sáng ở đây là HemisphereLight + DirectionalLight tự
 *   cân, y như `factory-scene/FactoryScene3D.tsx` đang làm.
 *
 * ★ RB-4 — chỉ MỘT canvas sống tại một thời điểm. `window.__soCanvas` đếm số
 *   canvas đang mount để e2e chứng minh; console.error khi > 1 để lỗi này KÊU
 *   thay vì âm thầm cạn WebGL context.
 *
 * ★ Chống vỡ — bắt `webglcontextlost`: `preventDefault()` rồi chờ
 *   `webglcontextrestored`. Không làm thì canvas ĐEN VĨNH VIỄN. Đây là chuyện *sẽ*
 *   xảy ra (hết VRAM, driver crash, tab ẩn lâu), không phải chuyện có thể xảy ra.
 *
 * ★ RB-6 — WebGLRenderer, KHÔNG WebGPU. three.js#30560 còn mở: WebGPU chậm hơn
 *   WebGL ~4× với nhiều mesh không-instanced trên iGPU — đúng hồ sơ máy của ta.
 */

import { Canvas, useThree, useFrame } from "@react-three/fiber";
import { useEffect, useRef, useState, type ReactNode } from "react";
import * as THREE from "three";

/** Trần DPR — §4 bảng ngân sách. Không nới, kể cả trên màn Retina. */
export const DPR_TRAN: [number, number] = [1, 1.5];

/** Hình dạng các cửa sổ đo mà e2e đọc. Khai một chỗ để test và mã không lệch nhau. */
export interface CuaSoDoTwin3d {
  /** Số `<KhungCanh>` đang mount. RB-4 đòi giá trị này ≤ 1. */
  __soCanvas?: number;
  /** `renderer.info.render` của khung vừa vẽ. §4: calls ≤ 150, triangles ≤ 500.000. */
  __thongKeVe?: {
    calls: number;
    triangles: number;
    /** Số lần mất WebGL context kể từ khi tải trang — 0 là bình thường. */
    matContext: number;
    /** Số lần context được khôi phục. */
    khoiPhuc: number;
  };
  /**
   * ★ Đợt 33 — tư thế camera SAU MỖI lần điều khiển dừng / tween kết thúc
   *   (`CanhVanHanh.camDoi`). Cửa sổ đo cho `?cam=` (Pareto #9): không có nó, cách
   *   duy nhất biết camera đã bay là so vị trí nhãn — gián tiếp và mù khi 0 nhãn.
   */
  __tuTheCamera?: { x: number; y: number; z: number; mucX: number; mucZ: number };
}

type WindowDo = Window & CuaSoDoTwin3d;

export interface KhungCanhProps {
  children: ReactNode;
  /** Vị trí camera ban đầu. Đặt MỘT LẦN — đổi prop sau không dời camera. */
  viTriCamera?: [number, number, number];
  fov?: number;
  far?: number;
  /** Màu nền cảnh. Truyền token đã phân giải, KHÔNG truyền `var(--…)`. */
  mauNen?: string;
  /** Cường độ đèn — chỉnh theo theme sáng/tối ở tầng gọi. */
  cuongDoBanCau?: number;
  cuongDoHuong?: number;
  /** Vị trí đèn hướng; mặc định suy từ bán kính cảnh. */
  viTriDenHuong?: [number, number, number];
  className?: string;
  /**
   * Chữ hiện khi mất WebGL context, ĐÃ qua `t()` ở tầng gọi.
   * Kit không gọi `t()` trực tiếp: nó còn được dùng ngoài cây i18n (Storybook,
   * e2e), và một `useTranslation()` ở đây biến mọi nơi dùng kit thành phụ thuộc
   * i18n. Khoá có sẵn: `twin3d.loi.matContext`.
   */
  chuMatContext?: string;
  /** Gọi khi mất/khôi phục context — để tầng trên hiện thông báo cho người dùng. */
  onMatContext?: () => void;
  onKhoiPhucContext?: () => void;
  "data-testid"?: string;
}

/**
 * ĐẾM canvas sống toàn cục (RB-4). Biến ở module scope chứ không ở state React:
 * hai `<KhungCanh>` là hai cây React khác nhau, không chia sẻ state được.
 */
let soCanvasDangSong = 0;

/**
 * Ba đèn TỐI ĐA (§4: "Đèn ≤ 3, không point-light shadow"). Hemisphere cho ánh
 * sáng nền dịu, Directional cho hình khối đọc được, Ambient nâng vùng tối.
 * KHÔNG shadow map realtime — bật lên là mất `frameloop="demand"` vì bóng phải
 * tính lại mỗi khung.
 */
function DenCoBan({
  cuongDoBanCau,
  cuongDoHuong,
  viTriDenHuong,
}: {
  cuongDoBanCau: number;
  cuongDoHuong: number;
  viTriDenHuong: [number, number, number];
}) {
  return (
    <>
      <hemisphereLight color="#ffffff" groundColor="#94a3b8" intensity={cuongDoBanCau} />
      <directionalLight position={viTriDenHuong} intensity={cuongDoHuong} castShadow={false} />
      <ambientLight intensity={0.3} />
    </>
  );
}

/**
 * Bơm `renderer.info.render` ra `window.__thongKeVe` SAU mỗi khung được vẽ.
 *
 * ⚠ Ưu tiên -1 để chạy SAU mọi `useFrame` khác trong cùng khung: đọc `info.render`
 * trước khi render xong cho ra số của khung TRƯỚC. Sai lệch một khung là đủ để
 * một phép đo "≤ 150 draw calls" báo đạt trên một cảnh chưa vẽ gì.
 */
function BomThongKe() {
  const gl = useThree((s) => s.gl);
  useFrame(() => {
    if (typeof window === "undefined") return;
    const w = window as WindowDo;
    const truoc = w.__thongKeVe;
    w.__thongKeVe = {
      calls: gl.info.render.calls,
      triangles: gl.info.render.triangles,
      matContext: truoc?.matContext ?? 0,
      khoiPhuc: truoc?.khoiPhuc ?? 0,
    };
  }, -1);
  return null;
}

/**
 * Bắt `webglcontextlost` / `webglcontextrestored` trên đúng phần tử canvas.
 *
 * `preventDefault()` trên `webglcontextlost` là dòng SỐNG CÒN: không gọi thì trình
 * duyệt KHÔNG BAO GIỜ phát `webglcontextrestored`, và canvas đen vĩnh viễn dù mọi
 * mã khôi phục đều đúng.
 */
function BatMatContext({
  onMat,
  onKhoiPhuc,
}: {
  onMat?: () => void;
  onKhoiPhuc?: () => void;
}) {
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);

  useEffect(() => {
    const canvas = gl.domElement;

    const khiMat = (e: Event) => {
      e.preventDefault(); // ★ không có dòng này thì không có khôi phục
      if (typeof window !== "undefined") {
        const w = window as WindowDo;
        w.__thongKeVe = {
          calls: w.__thongKeVe?.calls ?? 0,
          triangles: w.__thongKeVe?.triangles ?? 0,
          matContext: (w.__thongKeVe?.matContext ?? 0) + 1,
          khoiPhuc: w.__thongKeVe?.khoiPhuc ?? 0,
        };
      }
      onMat?.();
    };

    const khiKhoiPhuc = () => {
      if (typeof window !== "undefined") {
        const w = window as WindowDo;
        w.__thongKeVe = {
          calls: w.__thongKeVe?.calls ?? 0,
          triangles: w.__thongKeVe?.triangles ?? 0,
          matContext: w.__thongKeVe?.matContext ?? 0,
          khoiPhuc: (w.__thongKeVe?.khoiPhuc ?? 0) + 1,
        };
      }
      // Sau khi khôi phục, three cần dựng lại toàn bộ trạng thái GPU rồi vẽ.
      // `frameloop="demand"` nghĩa là không ai vẽ hộ — phải tự gọi.
      gl.resetState();
      invalidate();
      onKhoiPhuc?.();
    };

    canvas.addEventListener("webglcontextlost", khiMat, false);
    canvas.addEventListener("webglcontextrestored", khiKhoiPhuc, false);
    return () => {
      canvas.removeEventListener("webglcontextlost", khiMat);
      canvas.removeEventListener("webglcontextrestored", khiKhoiPhuc);
    };
  }, [gl, invalidate, onMat, onKhoiPhuc]);

  return null;
}

/** Đặt camera ban đầu ĐÚNG MỘT LẦN — đổi prop sau không giật camera của người dùng. */
function CameraBanDau({ viTri }: { viTri: [number, number, number] }) {
  const camera = useThree((s) => s.camera);
  const invalidate = useThree((s) => s.invalidate);
  const xong = useRef(false);
  useEffect(() => {
    if (xong.current) return;
    xong.current = true;
    camera.position.set(viTri[0], viTri[1], viTri[2]);
    camera.lookAt(0, 0, 0);
    invalidate();
  }, [camera, viTri, invalidate]);
  return null;
}

export function KhungCanh({
  children,
  viTriCamera = [30, 24, 30],
  fov = 45,
  far = 2000,
  mauNen = "#eef2f6",
  cuongDoBanCau = 1.1,
  cuongDoHuong = 1.3,
  viTriDenHuong = [40, 60, 25],
  className,
  chuMatContext,
  onMatContext,
  onKhoiPhucContext,
  "data-testid": testId = "khoi-canh-3d",
}: KhungCanhProps) {
  const [matContext, setMatContext] = useState(false);

  // RB-4 — đếm canvas sống. Cảnh báo TO khi > 1: nhiều canvas cùng lúc làm cạn
  // WebGL context và biểu hiện là canvas ĐEN, không phải một lỗi đọc được.
  useEffect(() => {
    soCanvasDangSong += 1;
    if (typeof window !== "undefined") (window as WindowDo).__soCanvas = soCanvasDangSong;
    if (soCanvasDangSong > 1) {
      console.error(
        `[twin3d] RB-4 vi phạm: ${soCanvasDangSong} <KhungCanh> đang sống cùng lúc. ` +
          "Chỉ MỘT canvas WebGL được phép mount tại một thời điểm.",
      );
    }
    return () => {
      soCanvasDangSong -= 1;
      if (typeof window !== "undefined") (window as WindowDo).__soCanvas = soCanvasDangSong;
    };
  }, []);

  return (
    <div
      className={className}
      data-testid={testId}
      style={{ position: "relative", width: "100%", height: "100%", minHeight: 320, background: mauNen }}
    >
      <Canvas
        frameloop="demand"
        dpr={DPR_TRAN}
        shadows={false}
        // ★ RB-6: WebGLRenderer mặc định. KHÔNG truyền `gl` WebGPU.
        gl={{
          antialias: true,
          powerPreference: "high-performance",
          // Cho phép trình duyệt hạ thay vì mất context khi tài nguyên eo hẹp.
          failIfMajorPerformanceCaveat: false,
        }}
        camera={{ fov, near: 0.1, far, position: viTriCamera }}
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.NoToneMapping;
          // Bóng đổ tắt hẳn: bật shadow map làm `demand` mất tác dụng (xem DenCoBan).
          gl.shadowMap.enabled = false;
        }}
      >
        <color attach="background" args={[mauNen]} />
        <DenCoBan
          cuongDoBanCau={cuongDoBanCau}
          cuongDoHuong={cuongDoHuong}
          viTriDenHuong={viTriDenHuong}
        />
        <CameraBanDau viTri={viTriCamera} />
        <BatMatContext
          onMat={() => {
            setMatContext(true);
            onMatContext?.();
          }}
          onKhoiPhuc={() => {
            setMatContext(false);
            onKhoiPhucContext?.();
          }}
        />
        <BomThongKe />
        {children}
      </Canvas>

      {/* Lớp phủ khi mất context — người dùng phải biết mình đang nhìn khung chết. */}
      {matContext ? (
        <div
          data-testid="canh-bao-mat-context"
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(15,23,42,0.55)",
            color: "#f8fafc",
            fontSize: 13,
            fontWeight: 600,
            pointerEvents: "none",
          }}
        >
          {chuMatContext ?? ""}
        </div>
      ) : null}
    </div>
  );
}

export default KhungCanh;
