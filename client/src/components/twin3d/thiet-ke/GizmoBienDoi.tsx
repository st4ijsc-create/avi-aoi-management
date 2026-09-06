/**
 * GizmoBienDoi.tsx — `TransformControls` cho màn Thiết kế (§7.2 công cụ #1-#5).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ RB-1 — `scene.add(controls.getHelper())`, KHÔNG `scene.add(controls)`
 * ════════════════════════════════════════════════════════════════════════════
 * Kiểm chứng lại trên `node_modules` của CHÍNH repo này (three r182), không
 * trích tài liệu:
 *   `node_modules/three/examples/jsm/controls/TransformControls.js`
 *     · `class TransformControls extends Controls`      ← KHÔNG còn là Object3D
 *     · `getHelper() { return this._root; }`            ← trả TransformControlsRoot
 *
 * Hệ quả nếu viết sai: `scene.add(controls)` KHÔNG ném lỗi trong r182 (r3f/three
 * chỉ bỏ qua đối tượng không phải Object3D ở một số đường), gizmo **không hiện**,
 * và không có gì trên console để lần theo. Đó là lý do cổng ra của đợt này đòi
 * một ẢNH CHỤP chứ không đòi một unit test: không phép đo tĩnh nào phân biệt
 * được hai dòng đó.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ RB-2 — KHÔNG `setRotationSnap()`; snap TUYỆT ĐỐI trong `objectChange`
 * ════════════════════════════════════════════════════════════════════════════
 * `setTranslationSnap` snap theo lưới THẾ GIỚI (tuyệt đối) nên dùng được.
 * `setRotationSnap` snap TƯƠNG ĐỐI với góc hiện tại: máy ở 8° với bước 15° đi
 * 8° → 23° → 38°, KHÔNG BAO GIỜ chạm 15°. Vá bằng cách bắt `objectChange` và
 * ghi đè `object.rotation.y` bằng {@link gocSauXoay} (uỷ quyền cho
 * `snapGocTuyetDoi` của `hinhHocCanChinh.ts` — 69 test, đừng viết lại).
 *
 * ⚠ Ta CỐ TÌNH không gọi `setTranslationSnap` của three dù nó đúng, mà tự snap
 *   trong cùng handler: bước lưới và ngữ nghĩa ĐẢO-bằng-Ctrl phải đi qua MỘT
 *   đường duy nhất. Hai đường snap song song (three lo tịnh tiến, ta lo xoay)
 *   nghĩa là Ctrl chỉ đảo được một nửa, và người dùng thấy "Ctrl thoát snap khi
 *   xoay nhưng không thoát khi kéo".
 *
 * ★ RB-3 — `frameloop="demand"`: `controls.addEventListener('change', invalidate)`.
 *   Thiếu dòng đó thì kéo gizmo KHÔNG VẼ LẠI, và biểu hiện là "gizmo bị đơ".
 * ★ RB-7 — `dispose()` + `detach()` trong cleanup; helper gỡ khỏi scene.
 */

import { useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import { mmSangMet } from "../heToaDo";
import {
  BUOC_GOC_MAC_DINH_DO,
  BUOC_LUOI_MAC_DINH_MM,
} from "../hinhHocCanChinh";
import {
  coTrucHienThi,
  gocSauXoay,
  viTriSauKeo,
  type CheDoGizmo,
  type TrucKhoa,
} from "./gizmoNoiLogic";

export interface GizmoBienDoiProps {
  /** Object3D đang được gắn gizmo. `null` = không hiện gizmo. */
  vatThe: THREE.Object3D | null;
  cheDo: CheDoGizmo;
  /** Snap đang bật trong thanh công cụ (Ctrl sẽ ĐẢO giá trị này). */
  snapBat: boolean;
  buocLuoiMm?: number;
  buocGocDo?: number;
  trucKhoa?: TrucKhoa;
  /** OrbitControls phải TẮT khi đang kéo gizmo, nếu không camera quay theo chuột. */
  orbitRef?: React.MutableRefObject<OrbitControls | null>;
  /**
   * Gọi khi kéo XONG (`mouseUp`), KHÔNG gọi mỗi khung.
   * Toạ độ trả về theo hệ SCENE (mét) và góc theo ĐỘ — người gọi quy sang mm/DB.
   */
  onXong?: (kq: {
    viTri: { x: number; y: number; z: number };
    gocYDo: number;
    tiLe: { x: number; y: number; z: number };
  }) => void;
  /** Gọi khi bắt đầu/kết thúc kéo — để tầng trên khoá tương tác khác. */
  onDangKeo?: (dangKeo: boolean) => void;
}

/**
 * Cửa sổ đo cho e2e: bằng chứng gizmo ĐÃ được gắn vào scene bằng `getHelper()`.
 *
 * ★ Vì sao cần: ảnh chụp chứng minh có gizmo trên màn hình, nhưng nó không nói
 *   được gizmo đến từ `getHelper()` hay từ một mesh tự vẽ. Cờ này ghi lại CHÍNH
 *   XÁC cái gì đã vào scene, nên hai phép đo (ảnh + cờ) là hai mô hình rời nhau
 *   theo đúng luật G3/BG-127.
 */
export interface CuaSoDoGizmo {
  __gizmo?: {
    /** true khi `scene.add(controls.getHelper())` đã chạy. */
    daGanHelper: boolean;
    /**
     * Tên lớp của thứ ĐÃ được add.
     *
     * ⚠⚠ ĐO ĐƯỢC 2026-09-06 — **CHỈ BÁO NÀY KHÔNG DÙNG ĐỂ NGHIỆM THU ĐƯỢC.**
     * Trên bản `npm run build` (production), minifier ĐỔI TÊN LỚP: giá trị thật
     * đo được là `"Fj"`, không phải `"TransformControlsRoot"`. Một test khẳng
     * định chuỗi đó sẽ ĐỎ trên bản dựng ĐÚNG và XANH trên bản dev — tức nó đo
     * BUNDLER chứ không đo RB-1. Giữ lại để chẩn đoán bằng mắt, KHÔNG assert.
     * Chỉ báo thay thế: {@link helperLaObject3D} + {@link helperTrongScene}.
     */
    tenLopHelper: string;
    /** `controls instanceof THREE.Object3D` — RB-1 nói phải là FALSE ở r182. */
    controlsLaObject3D: boolean;
    /**
     * ★★★ CHỈ BÁO NGHIỆM THU RB-1 #1 — `getHelper()` trả về một Object3D THẬT.
     * Không phụ thuộc tên lớp nên minifier không chạm tới được.
     */
    helperLaObject3D: boolean;
    /**
     * ★★★ CHỈ BÁO NGHIỆM THU RB-1 #2 — helper ĐANG NẰM TRONG scene graph
     * (`helper.parent === scene`). Đây là điều `scene.add(controls)` KHÔNG bao
     * giờ đạt được: `controls` không phải Object3D nên nó không có `parent`, và
     * chính vì thế gizmo không hiện mà không lỗi nào nổ.
     */
    helperTrongScene: boolean;
    /** Số con của helper — gizmo + plane. 0 nghĩa là helper rỗng, không vẽ gì. */
    soConHelper: number;
    cheDo: string;
    /** Số lần handler snap xoay đã chạy — chứng minh đường vá RB-2 có sống. */
    soLanSnapGoc: number;
    /** Góc (độ) sau lần snap gần nhất. */
    gocSnapCuoiDo: number | null;
  };
}

type WindowDoGizmo = Window & CuaSoDoGizmo;

function ghiCuaSo(sua: Partial<NonNullable<CuaSoDoGizmo["__gizmo"]>>): void {
  if (typeof window === "undefined") return;
  const w = window as WindowDoGizmo;
  w.__gizmo = {
    daGanHelper: false,
    tenLopHelper: "",
    controlsLaObject3D: false,
    helperLaObject3D: false,
    helperTrongScene: false,
    soConHelper: 0,
    cheDo: "",
    soLanSnapGoc: 0,
    gocSnapCuoiDo: null,
    ...w.__gizmo,
    ...sua,
  };
}

export function GizmoBienDoi({
  vatThe,
  cheDo,
  snapBat,
  buocLuoiMm = BUOC_LUOI_MAC_DINH_MM,
  buocGocDo = BUOC_GOC_MAC_DINH_DO,
  trucKhoa = null,
  orbitRef,
  onXong,
  onDangKeo,
}: GizmoBienDoiProps) {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const invalidate = useThree((s) => s.invalidate);

  const controlsRef = useRef<TransformControls | null>(null);
  // Giá trị "sống" đọc trong handler. Dùng ref chứ không phải closure: listener
  // được đăng ký MỘT LẦN, nên đọc trực tiếp prop trong đó sẽ khoá cứng giá trị
  // của lần render đầu — bật snap sau đó không có tác dụng, và không lỗi nào nổ.
  const thamSo = useRef({ snapBat, buocLuoiMm, buocGocDo });
  thamSo.current = { snapBat, buocLuoiMm, buocGocDo };
  const giuCtrl = useRef(false);
  const onXongRef = useRef(onXong);
  onXongRef.current = onXong;
  const onDangKeoRef = useRef(onDangKeo);
  onDangKeoRef.current = onDangKeo;

  // ── Dựng controls MỘT LẦN cho mỗi camera/canvas ──────────────────────────
  useEffect(() => {
    const controls = new TransformControls(camera, gl.domElement);
    controlsRef.current = controls;

    // ★★★ RB-1 — DÒNG QUAN TRỌNG NHẤT CỦA CẢ TỆP.
    const helper = controls.getHelper();
    scene.add(helper);

    ghiCuaSo({
      daGanHelper: true,
      // Chẩn đoán bằng mắt thôi — minifier đổi tên lớp, xem docblock kiểu.
      tenLopHelper: helper.constructor?.name ?? "",
      // Ở three r182 giá trị này là FALSE — đó chính là nội dung của RB-1.
      controlsLaObject3D: (controls as unknown) instanceof THREE.Object3D,
      // ★★★ Hai chỉ báo NGHIỆM THU, không phụ thuộc tên lớp.
      helperLaObject3D: helper instanceof THREE.Object3D,
      helperTrongScene: helper.parent === scene,
      soConHelper: helper.children.length,
      cheDo,
    });

    // ★ RB-3 — nối invalidate. Không có dòng này thì kéo gizmo không vẽ lại.
    const khiDoi = () => invalidate();
    controls.addEventListener("change", khiDoi);

    // Tắt OrbitControls khi đang kéo gizmo — nếu không, một cú kéo vừa dời máy
    // vừa quay camera và người dùng mất phương hướng hoàn toàn.
    // ⚠ `value` khai là `unknown` trong kiểu event của three r182 (không phải
    // `boolean`), nên ép về boolean TẠI ĐÂY thay vì khai sai chữ ký — khai sai
    // là lỗi biên dịch, còn ép ngầm ở chỗ dùng thì im lặng.
    const khiKeoDoi = (e: { value: unknown }) => {
      const dangKeo = e.value === true;
      if (orbitRef?.current) orbitRef.current.enabled = !dangKeo;
      onDangKeoRef.current?.(dangKeo);
      if (!dangKeo) {
        const o = controls.object;
        if (o) {
          onXongRef.current?.({
            viTri: { x: o.position.x, y: o.position.y, z: o.position.z },
            gocYDo: (o.rotation.y * 180) / Math.PI,
            tiLe: { x: o.scale.x, y: o.scale.y, z: o.scale.z },
          });
        }
      }
      invalidate();
    };
    controls.addEventListener("dragging-changed", khiKeoDoi);

    /**
     * ★★★ RB-2 — bản vá snap. Chạy sau MỖI biến đổi do gizmo gây ra.
     *
     * Thứ tự trong hàm này có ý nghĩa: đọc góc THẬT của object → snap TUYỆT ĐỐI
     * → ghi lại. Không cộng dồn delta, không đọc góc trước-khi-kéo. Chính phép
     * "đọc giá trị hiện tại rồi làm tròn về lưới cố định" mới cho ra tính tuyệt
     * đối; mọi biến thể dùng delta đều tái tạo lỗi tương đối của three.
     */
    const khiObjectDoi = () => {
      const o = controls.object;
      if (!o) return;
      const { snapBat: sb, buocLuoiMm: bl, buocGocDo: bg } = thamSo.current;
      const ctrl = giuCtrl.current;

      if (controls.mode === "translate") {
        // Snap trên hệ MÉT của scene: bước mm quy sang mét một lần ở đây.
        const buocMet = mmSangMet(bl);
        const moi = viTriSauKeo(
          { x: o.position.x, y: o.position.y, z: o.position.z },
          sb,
          ctrl,
          buocMet,
        );
        o.position.set(moi.x, moi.y, moi.z);
      } else if (controls.mode === "rotate") {
        const gocDo = (o.rotation.y * 180) / Math.PI;
        const moiDo = gocSauXoay(gocDo, sb, ctrl, bg);
        o.rotation.y = (moiDo * Math.PI) / 180;
        // Máy đứng trên sàn: chỉ xoay quanh trục đứng. Hai trục kia luôn về 0,
        // nếu không một cú kéo lệch làm máy nghiêng và không ai chỉnh lại được
        // bằng chuột.
        o.rotation.x = 0;
        o.rotation.z = 0;
        if (typeof window !== "undefined") {
          const w = window as WindowDoGizmo;
          ghiCuaSo({
            soLanSnapGoc: (w.__gizmo?.soLanSnapGoc ?? 0) + 1,
            gocSnapCuoiDo: moiDo,
          });
        }
      }
      invalidate();
    };
    controls.addEventListener("objectChange", khiObjectDoi);

    const phimXuong = (e: KeyboardEvent) => {
      if (e.key === "Control") giuCtrl.current = true;
    };
    const phimLen = (e: KeyboardEvent) => {
      if (e.key === "Control") giuCtrl.current = false;
    };
    window.addEventListener("keydown", phimXuong);
    window.addEventListener("keyup", phimLen);

    return () => {
      // ★ RB-7 — dọn TRIỆT ĐỂ. three không tự thu hồi bộ nhớ GPU, và màn này
      // mount/unmount theo tab nên rò rỉ tích luỹ rất nhanh.
      window.removeEventListener("keydown", phimXuong);
      window.removeEventListener("keyup", phimLen);
      controls.removeEventListener("change", khiDoi);
      controls.removeEventListener("dragging-changed", khiKeoDoi);
      controls.removeEventListener("objectChange", khiObjectDoi);
      controls.detach();
      scene.remove(helper);
      controls.dispose();
      controlsRef.current = null;
      if (orbitRef?.current) orbitRef.current.enabled = true;
      ghiCuaSo({ daGanHelper: false, tenLopHelper: "", helperTrongScene: false });
    };
  }, [camera, gl, scene, invalidate, orbitRef, cheDo]);

  // ── Gắn / gỡ vật thể ─────────────────────────────────────────────────────
  useEffect(() => {
    const c = controlsRef.current;
    if (!c) return;
    if (vatThe) c.attach(vatThe);
    else c.detach();
    invalidate();
  }, [vatThe, invalidate]);

  // ── Chế độ W/E/R ─────────────────────────────────────────────────────────
  useEffect(() => {
    const c = controlsRef.current;
    if (!c) return;
    c.mode = cheDo;
    ghiCuaSo({ cheDo });
    invalidate();
  }, [cheDo, invalidate]);

  // ── Khoá trục ────────────────────────────────────────────────────────────
  useEffect(() => {
    const c = controlsRef.current;
    if (!c) return;
    const co = coTrucHienThi(trucKhoa);
    c.showX = co.x;
    c.showY = co.y;
    c.showZ = co.z;
    invalidate();
  }, [trucKhoa, invalidate]);

  /**
   * ★★★ KHÔNG gọi `c.setRotationSnap(...)` ở bất kỳ đâu — RB-2.
   *   `setTranslationSnap` cũng để `null` tường minh: snap tịnh tiến đã do
   *   handler `objectChange` lo, và bật cả hai sẽ snap HAI LẦN với hai ngữ nghĩa
   *   Ctrl khác nhau.
   */
  useEffect(() => {
    const c = controlsRef.current;
    if (!c) return;
    c.setTranslationSnap(null);
    c.setRotationSnap(null);
    c.setScaleSnap(null);
  }, [snapBat, buocLuoiMm, buocGocDo]);

  return null;
}

export default GizmoBienDoi;
