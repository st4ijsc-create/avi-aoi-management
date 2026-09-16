/**
 * LopSaBan.tsx — **SA BÀN QUY HOẠCH** của phạm vi tập đoàn (Task 20).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ LỚP NÀY THAY `LoBatchMay`, KHÔNG ĐỨNG CẠNH NÓ
 * ════════════════════════════════════════════════════════════════════════════
 * Ở cấp tập đoàn, **đơn vị vẽ** thôi là *máy* và thành *toà nhà*. Lý do là một
 * phép chia đã đo (xem docblock `saBanTapDoan` ở `canhTapDoan.ts`): khuôn viên
 * 2,24 km trên canvas 968 px = 2,3 m/px ⇒ máy rộng 2 m còn ~1 px, *dù khung ôm
 * vừa khít*. 1.108 khối 1 px là một vùng ĐEN; 12 khối ~47 px là một sa bàn.
 *
 * ⇒ `CanhVanHanh` render lớp này **thay cho** `LoBatchMay` + `LopNhan` +
 *   `LopCanhBao` khi `saBan` không rỗng. Vẽ cả hai là tự mâu thuẫn: nhãn máy
 *   lơ lửng trên một khối nhà mà người dùng không bấm được vào máy nào.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ MÀU: XÁM TRUNG TÍNH, PHÂN BIỆT BẰNG **ĐỘ SÁNG** — KHÔNG BẰNG SẮC (§10.1)
 * ════════════════════════════════════════════════════════════════════════════
 * Cám dỗ hiển nhiên là tô mỗi công ty một màu. Nhưng bảng màu có sắc của màn
 * này ĐÃ có nghĩa: đỏ = critical, hổ phách = warning, vàng = watch, lục =
 * healthy, xám = chưa rõ. Một toà nhà màu lục ở cạnh một toà màu hổ phách sẽ
 * được đọc là *trạng thái*, và đó là lời khai sai nặng hơn hẳn cái nó mua được.
 * Nên: biểu tượng toà **một màu xám duy nhất**, còn NHÓM được đọc bằng (a) khe
 * hở giữa cụm ≥ 3× khe trong cụm, (b) tấm nền cụm theo bậc độ sáng, (c) nhãn
 * mang TÊN công ty. Ba dấu hiệu, không cái nào mượn ý nghĩa của bảng trạng thái.
 *
 * ★ RB-5 — không `<Environment>`, không CDN. ★ RB-7 — geometry/material tự cấp
 *   phát đều `dispose()`. ★ `frameloop="demand"` — mọi thay đổi gọi `invalidate()`.
 * ★ RB-8.3 — lớp nằm trong cây Canvas nên **không gọi `t()`**: mọi chữ vào qua prop.
 */

import { Html } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

import { laCheDoDo } from "../loi/cheDoDo";
import { TAM_CANVAS, layVungCam } from "../loi/LopNhan";
import type { CuaSoDoTwin3d } from "../loi/KhungCanh";
import { DAY_NEN_CUM_M, type BieuTuongToaVe, type CumSaBanVe } from "./hopNhatCanh";

export interface LopSaBanProps {
  toa: readonly BieuTuongToaVe[];
  cum: readonly CumSaBanVe[];
  toi: boolean;
  /** Tắt nhãn (bậc `tat_nhan` của `matDoKhungHinh`) — khối vẫn vẽ. */
  tatNhan: boolean;
}

/** z-index lớp nhãn sa bàn — cùng bậc với `LopNhan` (dưới panel z-30 của G41). */
const Z_INDEX_NHAN: [number, number] = [20, 0];
const KIEU_LOP = { pointerEvents: "none", userSelect: "none" } as const;

/** Trượt tối đa (px) để né lớp phủ. Xa hơn thì nhãn rời khỏi thứ nó gọi tên. */
const TRUOT_TOI_DA = 40;

/** Tên nhóm để e2e/`__demSaBan` tìm đúng lớp này trong scene. */
export const TEN_NHOM_SA_BAN = "twin3d-sa-ban";

/**
 * Bậc độ sáng của tấm nền cụm. 4 bậc chứ không phải 8: quá 4 bậc thì hai bậc
 * cạnh nhau không phân biệt được bằng mắt, và trần nhà máy một lượt là 8 — nên
 * bậc được LẶP LẠI có chủ ý, vì khoảng cách mới là thứ tách cụm, không phải màu.
 */
const NEN_CUM_SANG = ["#cbd5e1", "#dbe2ea", "#b9c4d2", "#e7ecf1"] as const;
const NEN_CUM_TOI = ["#27364b", "#1f2c3e", "#2f4058", "#18222f"] as const;

/** 8 góc hộp đơn vị (nửa cạnh ±0,5) — dùng để chiếu bao hình biểu tượng ra px. */
const GOC_HOP: readonly (readonly [number, number, number])[] = [
  [-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [-0.5, 0.5, -0.5], [0.5, 0.5, -0.5],
  [-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [-0.5, 0.5, 0.5], [0.5, 0.5, 0.5],
];

interface HopPx {
  trai: number;
  phai: number;
  tren: number;
  duoi: number;
}

/** Bao hình MÀN HÌNH của một khối hộp trục-song-song. `null` = có góc sau lưng camera. */
function hopChieu(
  v: BieuTuongToaVe,
  camera: THREE.Camera,
  rong: number,
  cao: number,
  tam: THREE.Vector3,
): HopPx | null {
  let trai = Infinity;
  let phai = -Infinity;
  let tren = Infinity;
  let duoi = -Infinity;
  for (const [gx, gy, gz] of GOC_HOP) {
    tam.set(v.viTri.x + gx * v.co.rong, v.viTri.y + gy * v.co.cao, v.viTri.z + gz * v.co.sau);
    tam.project(camera);
    if (!Number.isFinite(tam.x) || !Number.isFinite(tam.y) || tam.z > 1) return null;
    const px = ((tam.x + 1) / 2) * rong;
    const py = ((1 - tam.y) / 2) * cao;
    if (px < trai) trai = px;
    if (px > phai) phai = px;
    if (py < tren) tren = py;
    if (py > duoi) duoi = py;
  }
  return { trai, phai, tren, duoi };
}

export function LopSaBan({ toa, cum, toi, tatNhan }: LopSaBanProps) {
  const refToa = useRef<THREE.InstancedMesh | null>(null);
  const refNen = useRef<THREE.InstancedMesh | null>(null);
  const invalidate = useThree((s) => s.invalidate);
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);

  const { hinhToa, vlToa, hinhNen, vlNen } = useMemo(() => {
    const g = new THREE.BoxGeometry(1, 1, 1);
    const m = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0.05 });
    const gn = new THREE.BoxGeometry(1, 1, 1);
    const mn = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0 });
    return { hinhToa: g, vlToa: m, hinhNen: gn, vlNen: mn };
  }, []);

  // ★ RB-7 — three KHÔNG tự thu hồi bộ nhớ GPU.
  useEffect(
    () => () => {
      hinhToa.dispose();
      vlToa.dispose();
      hinhNen.dispose();
      vlNen.dispose();
    },
    [hinhToa, vlToa, hinhNen, vlNen],
  );

  // ── Ma trận + màu của từng biểu tượng.
  useEffect(() => {
    const inst = refToa.current;
    if (!inst) return;
    const mt = new THREE.Matrix4();
    const mau = new THREE.Color(toi ? "#7e8ea4" : "#9aa8ba");
    toa.forEach((v, i) => {
      mt.compose(
        new THREE.Vector3(v.viTri.x, v.viTri.y, v.viTri.z),
        new THREE.Quaternion(),
        new THREE.Vector3(Math.max(0.01, v.co.rong), Math.max(0.01, v.co.cao), Math.max(0.01, v.co.sau)),
      );
      inst.setMatrixAt(i, mt);
      inst.setColorAt(i, mau);
    });
    inst.count = toa.length;
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    invalidate();
  }, [toa, toi, invalidate]);

  // ── Tấm nền từng cụm: mỏng, nằm ngay trên sàn.
  useEffect(() => {
    const inst = refNen.current;
    if (!inst) return;
    const mt = new THREE.Matrix4();
    const bang = toi ? NEN_CUM_TOI : NEN_CUM_SANG;
    cum.forEach((c, i) => {
      mt.compose(
        new THREE.Vector3(c.viTri.x, DAY_NEN_CUM_M / 2, c.viTri.z),
        new THREE.Quaternion(),
        new THREE.Vector3(Math.max(0.01, c.co.rong), DAY_NEN_CUM_M, Math.max(0.01, c.co.sau)),
      );
      inst.setMatrixAt(i, mt);
      inst.setColorAt(i, new THREE.Color(bang[c.chiSoCum % bang.length]));
    });
    inst.count = cum.length;
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    invalidate();
  }, [cum, toi, invalidate]);

  /*
   * ════════════════════════════════════════════════════════════════════════
   * NHÃN — ghi thẳng vào DOM qua `ref`, KHÔNG qua `setState`
   * ════════════════════════════════════════════════════════════════════════
   * Một `setState` trong `useFrame` render lại cây React MỖI KHUNG trong lúc
   * xoay camera; với `frameloop="demand"` đó là đúng thứ mà chế độ ấy sinh ra để
   * tránh. 12–35 nhãn là ít, và vị trí của chúng là **kết quả phép chiếu**, không
   * phải state của ứng dụng — ghi thẳng `style.transform` là phép rẻ nhất và
   * không kéo theo commit nào.
   */
  const oToaRef = useRef<(HTMLDivElement | null)[]>([]);
  const oCumRef = useRef<(HTMLDivElement | null)[]>([]);
  const hopRef = useRef<{ toaNhaId: number; factoryId: number; chiSoCum: number; hop: HopPx }[]>([]);
  /** Số nhãn THẬT SỰ hiện / bị lớp phủ DOM nuốt — hai con số, không một. */
  const demNhanRef = useRef({ ve: 0, an: 0 });
  const gl = useThree((s) => s.gl);

  const tinhLai = useMemo(() => {
    const tam = new THREE.Vector3();
    return () => {
      const rong = size.width;
      const cao = size.height;
      /*
       * ════════════════════════════════════════════════════════════════════
       * ★★★ LỚP PHỦ DOM NUỐT NHÃN — G41 / QA Đợt 32, LẦN THỨ HAI
       * ════════════════════════════════════════════════════════════════════
       * Bảng `Metrics`, hai panel bên và dải hợp nhất đều là DOM `z-30`, còn lớp
       * nhãn này `z-20`. Một nhãn rơi dưới chúng **được vẽ mà không ai đọc được**
       * — và nếu bộ đếm vẫn tính nó là "đang hiện" thì đó đúng là lời khai sai mà
       * §4 sinh ra để chặn. `layVungCam()` đọc bbox THẬT của mọi lớp tự khai
       * `data-che-nhan` (cùng hàm `LopNhan` dùng — không có bộ luật thứ hai).
       *
       * ⚠ Ẩn theo **TÂM** nhãn, không theo "giao nhau chút nào": một nhãn chạm
       *   mép panel vẫn đọc được nửa chữ, và ẩn nó đi là mất thông tin thật.
       */
      const vungCam = layVungCam(gl.domElement);
      const che = (x: number, y: number) =>
        vungCam.find((z) => x >= z.trai && x <= z.phai && y >= z.tren && y <= z.duoi) ?? null;
      /**
       * Nhãn bị che ⇒ thử TRƯỢT DỌC ra khỏi đúng lớp phủ ấy, tối đa `TRUOT_TOI_DA`.
       * Trượt xa hơn thì nhãn rời khỏi thứ nó gọi tên — một nhãn chỉ sai chỗ còn
       * tệ hơn một nhãn vắng mặt. Không chỗ nào thoát ⇒ trả `null` ⇒ ẩn + đếm.
       */
      const choDat = (x: number, y: number): number | null => {
        if (!che(x, y)) return y;
        for (const yMoi of [che(x, y)!.duoi + 6, che(x, y)!.tren - 6]) {
          if (Math.abs(yMoi - y) > TRUOT_TOI_DA) continue;
          if (yMoi < 0 || yMoi > cao) continue;
          if (!che(x, yMoi)) return yMoi;
        }
        return null;
      };
      let ve = 0;
      let an = 0;

      const hop: { toaNhaId: number; factoryId: number; chiSoCum: number; hop: HopPx }[] = [];
      toa.forEach((v, i) => {
        const h = hopChieu(v, camera, rong, cao, tam);
        const el = oToaRef.current[i];
        if (h) hop.push({ toaNhaId: v.toaNhaId, factoryId: v.factoryId, chiSoCum: v.chiSoCum, hop: h });
        if (!el) return;
        if (!h) {
          el.style.display = "none";
          return;
        }
        // Neo GIỮA mép trên của khối: nhãn ngồi trên nóc, không đè mặt đứng.
        const x = (h.trai + h.phai) / 2;
        const y = choDat(x, h.tren - 4);
        if (y === null) {
          el.style.display = "none";
          an += 1;
          return;
        }
        el.style.display = "";
        ve += 1;
        el.style.transform = `translate(-50%, -100%) translate(${x}px, ${y}px)`;
      });
      hopRef.current = hop;

      cum.forEach((c, i) => {
        const el = oCumRef.current[i];
        if (!el) return;
        tam.set(c.viTri.x, 0, c.viTri.z + c.co.sau / 2);
        tam.project(camera);
        if (!Number.isFinite(tam.x) || !Number.isFinite(tam.y) || tam.z > 1) {
          el.style.display = "none";
          return;
        }
        const px = ((tam.x + 1) / 2) * rong;
        const py = choDat(px, ((1 - tam.y) / 2) * cao + 6);
        if (py === null) {
          el.style.display = "none";
          an += 1;
          return;
        }
        el.style.display = "";
        ve += 1;
        el.style.transform = `translate(-50%, 0) translate(${px}px, ${py}px)`;
      });

      demNhanRef.current = { ve, an };
    };
  }, [toa, cum, camera, gl, size.width, size.height]);

  useFrame(tinhLai);

  /*
   * ★ CỬA SỔ ĐO — chỉ ở chế độ đo (build DEV hoặc `?do=1`), cùng khuôn
   *   `__demTuongTac`. Không có nó thì tiêu chí "mỗi biểu tượng ≥ 24 px" chỉ đo
   *   được bằng cách đoán từ toạ độ chiếu ở ngoài trang — đúng cách mà Task 19
   *   khai "3 cụm" trong khi ảnh vẫn đen.
   */
  useEffect(() => {
    if (!laCheDoDo() || typeof window === "undefined") return;
    const w = window as Window & CuaSoDoTwin3d;
    w.__demSaBan = {
      bieuTuong: () =>
        hopRef.current.map((v) => ({
          toaNhaId: v.toaNhaId,
          factoryId: v.factoryId,
          chiSoCum: v.chiSoCum,
          hop: { ...v.hop },
          rongPx: v.hop.phai - v.hop.trai,
          caoPx: v.hop.duoi - v.hop.tren,
          trongKhung:
            v.hop.phai > 0 && v.hop.duoi > 0 && v.hop.trai < size.width && v.hop.tren < size.height,
        })),
      soNhan: () =>
        tatNhan ? { ve: 0, an: 0, tong: 0 } : { ...demNhanRef.current, tong: toa.length + cum.length },
    };
    return () => {
      delete w.__demSaBan;
    };
  }, [size.width, size.height, tatNhan, toa.length, cum.length]);

  if (toa.length === 0) return null;

  return (
    <group name={TEN_NHOM_SA_BAN}>
      <instancedMesh ref={refNen} args={[hinhNen, vlNen, Math.max(1, cum.length)]} frustumCulled={false} />
      <instancedMesh ref={refToa} args={[hinhToa, vlToa, Math.max(1, toa.length)]} frustumCulled={false} />
      {tatNhan ? null : (
        <Html fullscreen calculatePosition={TAM_CANVAS} zIndexRange={Z_INDEX_NHAN} style={KIEU_LOP}>
          {/* ★ `data-testid` phải ở phần tử DOM BÊN TRONG `<Html>` — xem `LopNhan`. */}
          <div data-testid="lop-sa-ban" data-so-toa={toa.length} data-so-cum={cum.length}
            style={{ position: "relative", width: "100%", height: "100%" }}>
            {cum.map((c, i) => (
              <div
                key={`cum-${c.factoryId}`}
                ref={(el) => {
                  oCumRef.current[i] = el;
                }}
                data-testid="nhan-cum-sa-ban"
                data-factory-id={c.factoryId}
                style={{
                  position: "absolute",
                  left: 0,
                  top: 0,
                  padding: "2px 8px",
                  borderRadius: 4,
                  fontSize: 12,
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                  color: toi ? "#e2e8f0" : "#0f172a",
                  background: toi ? "rgba(15,23,42,0.72)" : "rgba(255,255,255,0.82)",
                }}
              >
                {c.nhan}
              </div>
            ))}
            {toa.map((v, i) => (
              <div
                key={`toa-${v.toaNhaId}`}
                ref={(el) => {
                  oToaRef.current[i] = el;
                }}
                data-testid="nhan-toa-sa-ban"
                data-toa-nha-id={v.toaNhaId}
                style={{
                  position: "absolute",
                  left: 0,
                  top: 0,
                  padding: "1px 6px",
                  borderRadius: 3,
                  fontSize: 11,
                  whiteSpace: "nowrap",
                  color: toi ? "#cbd5e1" : "#1e293b",
                  background: toi ? "rgba(15,23,42,0.6)" : "rgba(255,255,255,0.75)",
                }}
              >
                {v.nhan}
              </div>
            ))}
          </div>
        </Html>
      )}
    </group>
  );
}
