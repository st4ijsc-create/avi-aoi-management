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
import { datNhanSaBan, type CoNhanPx } from "./datNhanSaBan";
import {
  DAY_NEN_CUM_M,
  MAU_BIEU_TUONG_TOA,
  NEN_CUM_SANG,
  NEN_CUM_TOI,
  type BieuTuongToaVe,
  type CumSaBanVe,
} from "./hopNhatCanh";

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

/** Cỡ hộp chữ khi CHƯA đo được (jsdom không dựng bố cục) — `datNhanSaBan` hiểu là "thiếu dữ kiện". */
const CO_CHUA_DO: CoNhanPx = { rong: 0, cao: 0 };

/**
 * Đo cỡ hộp chữ cho những nhãn CÒN THIẾU cỡ. Hàm module (không dựng lại mỗi
 * render) và chỉ đụng `ref` — gọi được từ trong vòng khung.
 */
function doConThieu(els: (HTMLDivElement | null)[], kho: CoNhanPx[]): void {
  for (let i = 0; i < els.length; i += 1) {
    const el = els[i];
    if (!el) continue;
    const cu = kho[i];
    if (cu && cu.cao > 0) continue;
    // Nhãn đang bị ẩn không có bố cục ⇒ mở tạm; lượt đặt ngay sau sẽ ghi lại `display`.
    if (el.offsetWidth === 0) el.style.display = "";
    if (el.offsetWidth > 0) kho[i] = { rong: el.offsetWidth, cao: el.offsetHeight };
  }
}

/** Tên nhóm để e2e/`__demSaBan` tìm đúng lớp này trong scene. */
export const TEN_NHOM_SA_BAN = "twin3d-sa-ban";

/*
 * ★★★ BẢNG MÀU DỜI SANG `hopNhatCanh.ts` — xem docblock ở đó.
 *   Lý do dời: từ lượt này bản **2D** (`CanhVanHanh2D.tsx`) cũng vẽ sa bàn, và
 *   hai bảng màu song song là cách hai chế độ tách nhau lần nữa mà không lưới
 *   nào bắt được (cả hai vẫn xanh, chỉ khác sắc trên màn). Giá trị KHÔNG đổi một
 *   ký tự — ablation gỡ bản vá phải cho ra đúng ảnh cũ.
 */

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

/**
 * Bao hình MÀN HÌNH của một khối hộp trục-song-song. `null` = có góc sau lưng camera.
 *
 * ★ Tham số là HÌNH DẠNG (`viTri` + `co`), không phải `BieuTuongToaVe`: từ bản vá
 *   NHÃN-CỤM, tấm nền CỤM cũng cần bao hình của nó để nhãn cụm có chỗ xê dịch theo
 *   trục ngang. Nhận hình dạng thì không phải đúc một `BieuTuongToaVe` giả.
 */
function hopChieu(
  v: { viTri: { x: number; y: number; z: number }; co: { rong: number; cao: number; sau: number } },
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
    const mau = new THREE.Color(toi ? MAU_BIEU_TUONG_TOA.toi : MAU_BIEU_TUONG_TOA.sang);
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
  /**
   * Nhãn hiện / bị ẩn, và **ẩn VÌ SAO** — ba con số, không một.
   *
   * ★★★ `anNgoaiKhung` sinh ra từ một phép đo: ở vai `qatd_admin` (5 nhà máy,
   *   khuôn viên 30,8 km) `soNhan()` trả `{ve:0, an:0, tong:19}` trong khi **cả
   *   19 nhãn đều `display:none`** và canvas ĐEN HOÀN TOÀN — vì nhánh "không
   *   chiếu được" ẩn nhãn mà KHÔNG cộng vào `an`. Một bộ đếm nói "0 nhãn bị ẩn"
   *   giữa lúc giấu 19 nhãn là đúng lớp lời khai sai mà bộ đếm này sinh ra để
   *   chặn. Từ bản vá: `ve + an === tong` LUÔN đúng, và `an` tách làm hai lý do.
   */
  const demNhanRef = useRef({ ve: 0, anVungCam: 0, anNgoaiKhung: 0 });
  /**
   * Cỡ HỘP CHỮ (px) của từng nhãn — đo MỘT LẦN mỗi khi dữ liệu/chủ đề đổi, không
   * đo trong `useFrame`: đọc `offsetWidth` xen giữa các lượt ghi `style.transform`
   * là ép trình duyệt tính lại bố cục ở mỗi nhãn (layout thrash) trong đúng vòng
   * lặp mà `frameloop="demand"` tồn tại để giữ rẻ.
   */
  const coNhanRef = useRef<{ toa: CoNhanPx[]; cum: CoNhanPx[] }>({ toa: [], cum: [] });
  const gl = useThree((s) => s.gl);

  /*
   * ★★★ ĐO LƯỜI, KHÔNG ĐO TRONG `useEffect` — và đây là một lỗi ĐÃ MẮC RỒI SỬA.
   *   Bản đầu đo cỡ chữ trong một `useEffect` phụ thuộc `[toa, cum, …]`. Nó chạy
   *   khi `oToaRef`/`oCumRef` còn RỖNG: `<Html>` của drei dựng nút chứa trong
   *   `useLayoutEffect` của CHÍNH nó rồi mới `createPortal`, nên các `<div>` nhãn
   *   (và `ref` của chúng) gắn ở một lượt commit SAU effect này — effect không
   *   bao giờ chạy lại vì `toa`/`cum` không đổi.
   *   Hậu quả đo được: `co = {0,0}` ⇒ hộp chữ suy biến thành MỘT ĐIỂM ⇒ phép
   *   trượt đặt TÂM ở `che.duoi + 6` thay vì `che.duoi + 6 + cao/2`, tức lại đúng
   *   khuyết tật cũ: `qatd_giamdoc` 3D "Toà 1" còn bị thẻ phủ **16,7 %**,
   *   `qatd_kythuat` "Công ty A" **22,7 %**. Mọi ô lưới vẫn xanh vì không lưới
   *   nào chạy được `<Html>` của drei.
   * ⇒ Đo NGAY TRONG vòng khung, nhưng chỉ cho nhãn còn thiếu cỡ, và ĐỌC THÀNH
   *   MỘT LƯỢT TRƯỚC khi ghi `style` — không xen kẽ đọc/ghi (layout thrash).
   */
  // Dữ liệu/chủ đề đổi ⇒ BỎ cỡ đã lưu (chữ và cỡ chữ có thể khác). Không đọc bố cục ở đây.
  useEffect(() => {
    coNhanRef.current = { toa: [], cum: [] };
    invalidate();
  }, [toa, cum, toi, tatNhan, invalidate]);

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
       *
       * ★★★ LUẬT CHỌN CHỖ DỜI SANG `datNhanSaBan.ts` — và đó KHÔNG phải dọn dẹp.
       *   Luật cũ ở đây kiểm che trên **ĐIỂM NEO** (đáy nhãn) rồi trượt đáy xuống
       *   `che.duoi + 6`; hộp chữ cao 18,5 px vì thế vẫn nằm TRÊN thẻ. Đo ở
       *   `qatd_giamdoc` 3D, khung mặc định: hai nhãn "Toà 1"/"Toà 3" bị thẻ
       *   `Metrics` phủ **65,4 %** và **67,6 %** trong khi `soNhan()` đếm chúng là
       *   "vẽ". Luật mới kiểm **TÂM HỘP CHỮ** và thử thêm ứng viên theo CẢ HAI
       *   trục — cần thiết vì `panel-trai`/`panel-phai` cao suốt khung, nơi mọi
       *   phép trượt DỌC đều bất lực (đo: `qatd_kythuat` 2D 0/2 tên công ty).
       *   Dùng chung với bản 2D để hai chế độ không có hai bộ luật.
       */
      const vungCam = layVungCam(gl.domElement);
      const khung = { rong, cao };
      // Lượt ĐỌC bố cục, trọn vẹn, TRƯỚC mọi lượt ghi `style` phía dưới.
      doConThieu(oToaRef.current, coNhanRef.current.toa);
      doConThieu(oCumRef.current, coNhanRef.current.cum);
      let ve = 0;
      let anVungCam = 0;
      let anNgoaiKhung = 0;
      /*
       * ════════════════════════════════════════════════════════════════════
       * ★★★ NHÃN ĐÃ ĐẶT CŨNG LÀ VÙNG CẤM — HAZARD DO CHÍNH BẢN VÁ NÀY SINH RA
       * ════════════════════════════════════════════════════════════════════
       * Bản vá cứu được các nhãn trước đây bị lớp phủ nuốt, và chính vì thế nó
       * thả thêm nhãn vào cảnh. Đo bằng mắt trên ảnh `qatd_quanly-3d-canvas.png`
       * rồi đo bằng số: cặp nhãn ĐÈ NHAU có dính TÊN CÔNG TY tăng **1 → 5**, hai
       * cặp nặng nhất chồng **437 px²** (`qatd_quanly` "Công ty A" × "Toà 3" và
       * `qatd_congnhan` "Công ty C" × "Toà 3"). Tức bản vá cứu nhãn toà bằng đúng
       * thứ nó tồn tại để bảo vệ: cái tên công ty.
       *
       * ⇒ Đặt CỤM TRƯỚC, TOÀ SAU, và mỗi nhãn đã đặt trở thành vùng cấm của nhãn
       *   sau. Thứ tự là một QUYẾT ĐỊNH: ở cấp tập đoàn, "cụm nào thuộc công ty
       *   nào" là câu hỏi màn này sinh ra để trả lời, còn tên toà là chi tiết.
       *   Nhãn toà không còn chỗ thì ẩn — và vẫn được ĐẾM RA.
       */
      const daDat: HopPx[] = [];
      const ghiDaDat = (d: { x: number; y: number }, co: CoNhanPx) => {
        if (!(co.rong > 0) || !(co.cao > 0)) return;
        daDat.push({
          trai: d.x - co.rong / 2,
          phai: d.x + co.rong / 2,
          tren: d.y - co.cao / 2,
          duoi: d.y + co.cao / 2,
        });
      };

      cum.forEach((c, i) => {
        const el = oCumRef.current[i];
        if (!el) return;
        tam.set(c.viTri.x, 0, c.viTri.z + c.co.sau / 2);
        tam.project(camera);
        if (!Number.isFinite(tam.x) || !Number.isFinite(tam.y) || tam.z > 1) {
          el.style.display = "none";
          anNgoaiKhung += 1;
          return;
        }
        /*
         * Neo là mép TRƯỚC-GIỮA của tấm nền — MỘT ĐIỂM. Truyền thẳng điểm ấy thì
         * mọi ứng viên đều nằm trên cùng một cột x, nên khi lớp phủ chắn theo chiều
         * ngang thì không còn chỗ nào để thử. Nên: giữ ĐÚNG điểm neo làm tâm, và
         * mượn BỀ RỘNG CHIẾU của chính tấm nền làm biên xê dịch ngang.
         * ⇒ ứng viên `duoi-giua` rơi đúng chỗ luật cũ đặt (`đỉnh nhãn = điểm + 6`),
         *   nên cảnh KHÔNG dời một pixel nào khi không bị che; bề rộng chỉ có tác
         *   dụng ở các ứng viên dự phòng.
         */
        const px = ((tam.x + 1) / 2) * rong;
        const py = ((1 - tam.y) / 2) * cao;
        const hopNen = hopChieu(
          { viTri: { x: c.viTri.x, y: DAY_NEN_CUM_M / 2, z: c.viTri.z }, co: { rong: c.co.rong, cao: DAY_NEN_CUM_M, sau: c.co.sau } },
          camera,
          rong,
          cao,
          tam,
        );
        const nuaRong = hopNen ? (hopNen.phai - hopNen.trai) / 2 : 0;
        const diem: HopPx = { trai: px - nuaRong, phai: px + nuaRong, tren: py, duoi: py };
        const coCum = coNhanRef.current.cum[i] ?? CO_CHUA_DO;
        const d = datNhanSaBan(diem, coCum, vungCam, khung, "duoi");
        if (d === null) {
          el.style.display = "none";
          anVungCam += 1;
          return;
        }
        el.style.display = "";
        ve += 1;
        ghiDaDat(d, coCum);
        el.style.transform = `translate(-50%, -50%) translate(${d.x}px, ${d.y}px)`;
      });

      const hop: { toaNhaId: number; factoryId: number; chiSoCum: number; hop: HopPx }[] = [];
      toa.forEach((v, i) => {
        const h = hopChieu(v, camera, rong, cao, tam);
        const el = oToaRef.current[i];
        if (h) hop.push({ toaNhaId: v.toaNhaId, factoryId: v.factoryId, chiSoCum: v.chiSoCum, hop: h });
        if (!el) return;
        if (!h) {
          el.style.display = "none";
          anNgoaiKhung += 1;
          return;
        }
        // Neo GIỮA mép trên của khối: nhãn ngồi trên nóc, không đè mặt đứng.
        const coToa = coNhanRef.current.toa[i] ?? CO_CHUA_DO;
        const d = datNhanSaBan(h, coToa, [...vungCam, ...daDat], khung, "tren");
        if (d === null) {
          el.style.display = "none";
          anVungCam += 1;
          return;
        }
        el.style.display = "";
        ve += 1;
        ghiDaDat(d, coToa);
        el.style.transform = `translate(-50%, -50%) translate(${d.x}px, ${d.y}px)`;
      });
      hopRef.current = hop;
      demNhanRef.current = { ve, anVungCam, anNgoaiKhung };
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
      soNhan: () => {
        if (tatNhan) return { ve: 0, an: 0, anVungCam: 0, anNgoaiKhung: 0, tong: 0 };
        const { ve, anVungCam, anNgoaiKhung } = demNhanRef.current;
        return { ve, an: anVungCam + anNgoaiKhung, anVungCam, anNgoaiKhung, tong: toa.length + cum.length };
      },
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
