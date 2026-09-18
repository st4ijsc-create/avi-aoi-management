/**
 * CanhVanHanh.tsx — cảnh 3D của màn Vận hành `/twin`.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ RB-4 — ĐÂY LÀ NƠI DUY NHẤT CỦA MÀN VẬN HÀNH DỰNG `<KhungCanh>`
 * ════════════════════════════════════════════════════════════════════════════
 * `KhungCanh` là cửa duy nhất vào WebGL của kit, và nó tự `console.error` khi
 * `window.__soCanvas > 1`. Component này KHÔNG được đặt trong một nhánh điều
 * kiện có thể dựng thêm bản thứ hai; bản 2D thay thế nó (không đứng cạnh nó).
 *
 * ★ RB-3 — `taoDieuKhienQuay` nhận `invalidate` là tham số BẮT BUỘC.
 * ★ RB-5 — không `<Environment>`, không CDN. Đèn do `KhungCanh` lo.
 * ★ RB-7 — mọi geometry/material tự cấp phát đều `dispose()` trong cleanup.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ NT-2 — KHÔNG CÓ NÚT NÀO TRÊN 3D
 * ════════════════════════════════════════════════════════════════════════════
 * Cảnh này chỉ ĐỊNH VỊ và CHỌN. Mọi hành động (ack, tạo phiếu, gán KTV) nằm ở
 * `NganXuLy` — bề mặt 2D tuân ISA-101. Đừng thêm nút nổi trên máy 3D: đó chính
 * là chế độ hỏng mà quy tắc "No 3D graphical objects" của ASM sinh ra để phòng.
 *
 * ★★★ ĐỢT 47 (QA Đợt 46 N2) — "CHỌN" TRÊN CẢNH CHƯA TỪNG CHẠY SUỐT 46 ĐỢT: bấm/rê máy
 *   trên `/twin` và `/twin/line/2` không phản ứng. Gốc rễ ở kit (`LoBatchMay.tsx`
 *   docblock: R3F 9.5 `swapInstances` bỏ rơi handler khi `<primitive object>` đổi lô),
 *   không ở lớp ổn định-hàm/memo của tệp này — ablation 6 mốc commit (Đợt 33 → 45) cho
 *   cùng chữ ký chết (`.qa-dot47/ablation-commit.log`). Tệp này thêm: con trỏ `pointer`
 *   khi rê máy, bấm NHÃN cũng chọn (`LopNhan.onChonNhan`), và `LopCanhBao` chạy trước
 *   `LopNhan` (N5 — một ngân sách hình chữ nhật). Lưới: `e2e/twin-dot47-bam-canh.spec.ts`.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ §10.3 — BADGE ALARM VẼ Ở KHÔNG GIAN MÀN HÌNH
 * ════════════════════════════════════════════════════════════════════════════
 * Badge KHÔNG phải sprite trong thế giới: phối cảnh sẽ thu nhỏ một badge P1 ở xa
 * thành không đọc nổi. Nó được `LopCanhBao` chiếu ra pixel và vẽ bằng DOM cỡ cố
 * định, và alarm bị hình học che sẽ NỔI LÊN RÌA màn hình kèm mũi tên — luật 3
 * của §10.3 ("góc camera không bao giờ được che một alarm đang hoạt động").
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useThree, useFrame } from "@react-three/fiber";
import { useOnDinhTheoGiaTri } from "./onDinhTheoGiaTri";
import * as THREE from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import { useOptionalTheme } from "@/components/factory-scene/useOptionalTheme";

import {
  KhungCanh,
  farTheoBanKinh,
  khoangCachZoomXaNhat,
  LoBatchMay,
  LopNhan,
  TRANG_THAI_CHON_RONG,
  taoDieuKhienQuay,
  type CuaSoDoTwin3d,
  type MayTrongLo,
  type NhanTheGioi,
  type TrangThaiChon,
} from "../loi";
import { giaiMauCanh, mauChoTrangThai } from "../mauTrangThai";
import { mauHex, mauThree } from "./mauThree";
import type { KhungNhin, HopCanvas } from "./phamViCanh";
import { TWEEN_DOI_CAP_MS, khungNhinVaoVung, vungDungCanvas } from "./phamViCanh";
import { layVungCam } from "../loi/LopNhan";
import { useBuocLuoi } from "../loi/useBuocLuoi";
import { buocThucTheoSoO } from "../loi/buocLuoi";
import type { DiemScene } from "../heToaDo";
import { LopCanhBao, type CanhBaoTheGioi } from "./LopCanhBao";
import { DongChayLine, type DiemDongChay } from "./DongChayLine";
import type { VienDeMay } from "./sucKhoeMay";
import { LopVung } from "../thiet-ke/LopVung";
import type { VungVe } from "../thiet-ke/vungAnToan";
import { LopSaBan } from "./LopSaBan";
import type { BieuTuongToaVe, CumSaBanVe } from "./hopNhatCanh";

export interface CanhVanHanhProps {
  may: MayTrongLo[];
  nhan: NhanTheGioi[];
  canhBao: CanhBaoTheGioi[];
  /** Đường tâm Line + hướng — chỉ có ở phạm vi Line (§10C.3). */
  dongChay: DiemDongChay | null;
  /** Cột WIP theo trạm — chỉ có ở phạm vi Line (§10C.3). */
  wip: readonly { x: number; z: number; cao: number; nghen: boolean }[];
  /**
   * ★★★ A-4 (§14.5.1, mục G-1) — VÒNG VIỀN SỨC KHOẺ quanh ĐẾ máy.
   *
   * KÊNH THỊ GIÁC RIÊNG, không dùng chung với A-1 (màu thân). Một máy *đang chạy*
   * mà *sức khoẻ 55%* phải đọc được là **thân xanh + viền hổ phách**; nếu A-4
   * cũng tô thân thì một trong hai sự thật bị nuốt.
   *
   * Mặc định `[]` ⇒ lớp `return null`, không cấp phát gì. Nhưng ★ đó cũng đúng
   * là chế độ hỏng G5 mà `wip` đã mắc một lần (`wip={[]}` viết cứng ⇒ lớp chạy
   * qua 994 test mà chưa vẽ pixel nào) — nên `noiLoD.dom.test.tsx`-kiểu test của
   * lớp này phải khẳng định trên tập KHÁC RỖNG.
   */
  vienSucKhoe?: readonly VienDeMay[];
  /**
   * ★★★ A-6 (§14.5.1, mục G-4) — VÙNG AN TOÀN / CHIA SẺ VỚI NGƯỜI, khối trong suốt.
   *
   * ════════════════════════════════════════════════════════════════════════
   * ★★★ TÁI DÙNG `LopVung` CỦA MÀN THIẾT KẾ — KHÔNG VIẾT BẢN THỨ HAI (G12)
   * ════════════════════════════════════════════════════════════════════════
   * `thiet-ke/LopVung.tsx` + `thiet-ke/vungAnToan.ts` (49 test) đã giải trọn bài
   * toán khó của A-6: bẫy hoán vị trục (`Shape` nằm trên X–Y, sàn nằm trên X–Z
   * ⇒ quên xoay −90° cho ra một tấm ván DỰNG ĐỨNG giữa xưởng mà **không có gì
   * nổ**), điểm đặt nhãn nằm trong vùng lõm, RB-7 dispose.
   *
   * Chép nó sang `van-hanh/` để "màn Vận hành có bản riêng" là đúng thứ G12 cấm,
   * và cái giá đã đo được: hai bản cài đặt hiếm khi chỉ lệch MỘT chỗ. Nên lớp
   * này `import` thẳng qua ranh giới thư mục — ranh giới đó là về **quyền ghi**
   * (thiết kế sửa được, vận hành chỉ đọc), không phải về hình học.
   *
   * ★ VẬN HÀNH CHỈ ĐỌC: `onChon` KHÔNG được truyền xuống. Màn Thiết kế cho chọn
   *   vùng để sửa; ở đây vùng là **bối cảnh**, và một cú bấm trúng vùng phải rơi
   *   xuống máy phía dưới chứ không cướp lấy selection (NT-2 — cảnh vận hành chỉ
   *   ĐỊNH VỊ và CHỌN MÁY).
   *
   * ★ NGÂN SÁCH: mỗi vùng là 1 mesh + 1 `<Html>`. Số vùng an toàn của một xưởng
   *   đếm bằng ĐƠN VỊ, không bằng chục (đo được 2026-09-08: `twin_vat_the` có
   *   **0 hàng `loai='vung'`** trên toàn hệ) — nên nó không đe doạ trần 30 nhãn
   *   của §4 như nhãn máy. `tatNhan` vẫn được chuyển tiếp để bậc `tat_nhan` của
   *   `matDoKhungHinh` tắt được cả nhãn vùng.
   */
  vung?: readonly VungVe[];
  machineIdChon: number | null;
  onChonMay: (machineId: number | null) => void;
  /** Khung nhìn đích; đổi giá trị ⇒ camera TWEEN tới (500 ms, §10C.2). */
  khungNhin: KhungNhin | null;
  sanRongM: number;
  sanSauM: number;
  tatNhan: boolean;
  /**
   * ★ ĐỢT 23 M1 — chỉ hiện nhãn máy **bất thường**. Chuyển thẳng xuống
   * `LopNhan`; đo được 45 ứng viên chỉ còn 8 nhãn vì khử chồng, nên cần một
   * chính sách chọn thay vì chỉ một con số trần.
   */
  chiNhanBatThuong?: boolean;
  /** Chữ ĐÃ dịch cho chip "còn N tên bị ẩn" (RB-8.3 — cảnh không gọi `t()`). */
  chuNhanAn?: (n: number) => string;
  /** ★ Đợt 45 (mục 4) — chữ ĐÃ dịch cho chip khi chỉ-nhãn-bất-thường bật (lý do ẩn = chính sách). */
  chuNhanAnTheoChinhSach?: (n: number) => string;
  /** ★ Đợt 35 (Pareto #5) — chữ ĐÃ dịch cho chip "N sự cố ngoài khung" (máy bất thường ngoài frustum). */
  chuSuCoNgoaiKhung?: (n: number) => string;
  /** ★ Đợt 49 (mục D) — chữ ĐÃ dịch cho chip "còn N cảnh báo ẩn" (badge bị lớp phủ che / hết chỗ). */
  chuCanhBaoAn?: (n: number) => string;
  chuMatContext: string;
  ariaLabel: string;
  /**
   * ★★★ TASK 20 — SA BÀN QUY HOẠCH: biểu tượng TOÀ NHÀ **thay cho** khối máy.
   *
   * Không rỗng ⇒ cảnh vẽ {@link LopSaBan} và **bỏ** `LoBatchMay`/`LopNhan`/
   * `LopCanhBao`/vòng sức khoẻ/vùng an toàn. Đây là điều kiện, không phải tuỳ
   * chọn thẩm mỹ: ở 2,3 m/px một máy còn ~1 px (xem `saBanTapDoan`), nên vẽ cả
   * hai lớp cho ra một sa bàn có 1.108 hạt bụi và 30 cái nhãn máy lơ lửng trên
   * những toà nhà mà bấm vào không chọn được máy nào.
   *
   * ⚠ Rỗng (mặc định) ⇒ **không một byte nào của cảnh cũ đổi** — đó là điều kiện
   *   để `/twin` một nhà máy còn là đối chứng âm của Task 20.
   */
  saBan?: readonly BieuTuongToaVe[];
  /** Ô cụm (một nhà máy) của sa bàn — nền + nhãn công ty. */
  saBanCum?: readonly CumSaBanVe[];
  /** Báo camera vừa đổi — tầng trên ghi vào URL bằng `replaceState` (§9.4). */
  onCameraDoi?: (viTri: THREE.Vector3, muc: THREE.Vector3) => void;
  /**
   * ★ Đợt 35 (Pareto #4) — sàn chiều cao khung, chuyển thẳng xuống `KhungCanh.sanCaoPx`.
   * Chỉ màn Máy truyền (`SAN_KHOI_CANH_MAY_PX`); bỏ trống ⇒ mặc định 320 của kit.
   */
  sanCaoPx?: number;
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* Điều khiển + tween đổi cấp                                                  */
/* ═══════════════════════════════════════════════════════════════════════════ */

/**
 * OrbitControls + tween camera khi đổi phạm vi.
 *
 * ★ RB-3 — `noiInvalidate` nằm sẵn trong `taoDieuKhienQuay`, nên xoay chuột luôn
 *   yêu cầu vẽ lại. Nhưng TWEEN thì `frameloop="demand"` KHÔNG tự biết: nó là
 *   animation do ta chạy, không do người dùng chạm. Nên `useFrame` dưới đây gọi
 *   `invalidate()` mỗi khung *trong lúc còn tween* — thiếu dòng đó camera sẽ
 *   "nhảy" một bước rồi đứng im cho tới khi ai đó chạm chuột.
 */
function DieuKhien({
  khungNhin,
  banKinhToiDa,
  controlsRef,
  onCameraDoi,
}: {
  khungNhin: KhungNhin | null;
  banKinhToiDa: number;
  controlsRef: React.MutableRefObject<OrbitControls | null>;
  onCameraDoi: (viTri: THREE.Vector3, muc: THREE.Vector3) => void;
}) {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);

  /** Trạng thái tween. `null` = không tween. */
  const tween = useRef<{
    tuViTri: THREE.Vector3;
    denViTri: THREE.Vector3;
    tuMuc: THREE.Vector3;
    denMuc: THREE.Vector3;
    batDau: number;
  } | null>(null);

  useEffect(() => {
    const { controls, huy } = taoDieuKhienQuay(camera, gl.domElement, invalidate, {
      khoangCachToiThieu: 1.5,
      // ★ PH-50b — CÙNG một hằng với `farTheoBanKinh`: `far` được suy TỪ con số này,
      //   nên hai thứ không trôi khỏi nhau được nữa (`loi/catCanh.ts`).
      khoangCachToiDa: khoangCachZoomXaNhat(banKinhToiDa),
    });
    controlsRef.current = controls;
    // Báo camera đổi để tầng trên ghi vào URL (`replaceState`, §9.4).
    const bao = () => onCameraDoi(camera.position, controls.target);
    controls.addEventListener("end", bao);
    return () => {
      controls.removeEventListener("end", bao);
      controlsRef.current = null;
      huy();
    };
  }, [camera, gl, invalidate, banKinhToiDa, controlsRef, onCameraDoi]);

  // Khởi động tween mỗi khi khung nhìn đích đổi.
  useEffect(() => {
    const controls = controlsRef.current;
    if (!khungNhin || !controls) return;
    tween.current = {
      tuViTri: camera.position.clone(),
      denViTri: new THREE.Vector3(...khungNhin.viTri),
      tuMuc: controls.target.clone(),
      denMuc: new THREE.Vector3(...khungNhin.muc),
      batDau: performance.now(),
    };
    invalidate();
  }, [khungNhin, camera, controlsRef, invalidate]);

  useFrame(() => {
    const tw = tween.current;
    const controls = controlsRef.current;
    // ★★★ RB-3b (Lô U, Đợt 16) — QUÁN TÍNH ĐÒI `update()` MỖI KHUNG, KỂ CẢ KHI
    // KHÔNG TWEEN. Trước bản vá này thân hàm `return` ngay khi `tween` rỗng —
    // tức `controls.update()` CHỈ chạy trong lúc đổi phạm vi. Mà `enableDamping`
    // thì luôn bật: mỗi `update()` chỉ áp 8% cú chuột, phần dư 92% chờ lần sau
    // (three r182, OrbitControls.js:617-618, 701-704). Không tween ⇒ không ai
    // gọi ⇒ phần dư bị vứt ⇒ camera khựng lại khi nhả chuột.
    //
    // Đây đúng là điều kiện kích hoạt của chữ *"thi thoảng"*: quán tính chỉ
    // chạy trơn trong lúc còn tween đổi phạm vi, mọi lúc khác thì cụt.
    if (!controls) return;
    if (!tw) {
      // `update()` tự phát `change` (⇒ `invalidate`) chỉ khi camera còn dịch
      // quá `_EPS` (OrbitControls.js:812-815), nên vòng này TỰ TẮT khi camera
      // đứng yên — `frameloop="demand"` vẫn được tôn trọng.
      controls.update();
      return;
    }
    const t = Math.min(1, (performance.now() - tw.batDau) / TWEEN_DOI_CAP_MS);
    // ease-out cubic — dừng êm, không phanh gấp ở cuối.
    const e = 1 - (1 - t) ** 3;
    camera.position.lerpVectors(tw.tuViTri, tw.denViTri, e);
    controls.target.lerpVectors(tw.tuMuc, tw.denMuc, e);
    controls.update();
    // ★ Bắt buộc với `frameloop="demand"`: tween là animation của TA.
    invalidate();
    if (t >= 1) {
      tween.current = null;
      onCameraDoi(camera.position, controls.target);
    }
  });

  return null;
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* Sàn                                                                          */
/* ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Sàn xám trung tính (§10.1: "sàn, tường, cột: xám trung tính, phân biệt nhau
 * bằng độ sáng, không bằng sắc"). Cả ba màu đổi theo theme cùng nhau — giữ một
 * màu sáng ở theme tối biến mặt sàn thành tấm trắng chói hơn cả lỗi ban đầu.
 */
/** Xoay mặt sàn nằm ngang — hằng module (★ Đợt 40: không literal mỗi render). */
const XOAY_SAN: [number, number, number] = [-Math.PI / 2, 0, 0];

/**
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ PH-51 — MỘT CENTIMET ĐẤU VỚI NỬA MÉT: SÀN VÀ LƯỚI TRANH NHAU PIXEL
 * ════════════════════════════════════════════════════════════════════════════
 * Tấm sàn ở `y = -0.01`, `gridHelper` ở `y = 0` — **cách nhau đúng 1 cm**. Khe
 * hở ấy là thứ DUY NHẤT bảo đảm "lưới nằm trên sàn", và nó chỉ có hiệu lực khi
 * z-buffer còn phân biệt nổi 1 cm ở chỗ đó. Ở cỡ TẬP ĐOÀN thì không:
 *
 *     Δz ≈ z² × (1/near − 1/far) / (2²⁴ − 1)
 *        ≈ 2005² × (1/0,5 − 1/12478,5) / 16.777.215 ≈ **0,48 m**
 *
 * tức bước z lớn gấp ~48 lần khe hở. Hai mặt rơi vào CÙNG một nấc z ⇒ mặt nào
 * thắng là chuyện của số dư làm tròn, mà số dư ấy đổi theo góc nhìn.
 *
 * ★ ĐO chứ không suy (cổng 3064, bundle dựng từ chính cây này). Bóp RIÊNG `near`
 *   0,5 → 0,1 là một nhiễu **ĐỘ SÂU THUẦN** — `near`/`far` chỉ nằm ở cột z của ma
 *   trận phối cảnh nên KHÔNG dịch một pixel nào của phép chiếu x/y: mọi đường lưới
 *   rơi đúng chỗ cũ, răng cưa lặp lại y hệt. Pixel nào đổi màu thì đổi vì phép so
 *   độ sâu lật.
 *
 *   | vùng sàn thuần 3D, tập đoàn | TRƯỚC   | SAU    |
 *   |-----------------------------|---------|--------|
 *   | khung mặc định              | 42,20 % | 0,34 % |
 *   | nhìn xiên 83,7°             |  3,97 % | 0,00 % |
 *   | chụp 2 lần CÙNG bản dựng    |  0,00 % (nhiễu thiết bị đo) |
 *   | ĐỐI CHỨNG lưới nâng 5 m     |  0,30 % (mức sàn vật lý)    |
 *
 *   Dòng ĐỐI CHỨNG tách z-fighting khỏi **răng cưa lưới**: nâng lưới 5 m làm
 *   z-fighting bất khả mà GIỮ NGUYÊN mật độ lưới (ô 5 m trên sàn 1.060 m, đường
 *   lưới vẫn cách nhau ~2 px). Độ nhạy sụp 42,20 % → 0,30 % ⇒ thứ đo được là hai
 *   mặt tranh nhau, không phải lưới quá dày.
 *
 * ★★★ VÌ SAO `polygonOffset` CHỨ KHÔNG PHẢI NÂNG KHE HỞ
 * Khe hở tính bằng MÉT; bước z cũng bằng mét NHƯNG tỉ lệ `z²`, mà `z` là thứ
 * người dùng đổi bằng con lăn chuột. Khe hở đủ ở khung mặc định (cần > 0,48 m)
 * KHÔNG đủ ở trần zoom (`camXa` đo được 8.975 m ⇒ cần > 9,6 m); khe hở đủ ở trần
 * zoom lại là một khe NHÌN THẤY ĐƯỢC khi zoom vào. **Không hằng số mét nào đúng ở
 * mọi nấc zoom.** `polygonOffset` nói bằng đúng đơn vị của vấn đề: `units` đếm
 * theo bước z nhỏ nhất còn phân biệt được TẠI CHÍNH độ sâu ấy, nên nó tự co giãn
 * theo `z`, theo `near`/`far` (`loi/catCanh.ts` đổi số cũng không phải chỉnh lại)
 * và theo góc nghiêng qua `factor` × độ dốc.
 *
 * ★ Hai ứng viên kia bị BÁC BỎ BẰNG SỐ, không bằng khẩu vị:
 *   · khe hở theo cỡ cảnh (`canh/400`): cùng 0,34 % nhưng **dịch đường bao tấm
 *     sàn** — 2.006 px liền khối đổi ở màn Máy, vì hạ sàn là đổi HÌNH HỌC.
 *   · lưới `depthTest:false` + `renderOrder`: 0,00 % nhưng **lưới vẽ đè lên khối
 *     máy và vòng an toàn** (1,77 % khung hình màn Nhà máy đổi; thấy rõ bằng mắt).
 * ★ `polygonOffsetUnits` 4 cho ảnh GIỐNG HỆT 1 (0,00 % lệch) ⇒ 1 là đủ, không
 *   trả thêm để mua 0 pixel.
 * ⚠ Khe hở 1 cm GIỮ NGUYÊN: đây là hàng rào THỨ HAI, không phải bản thay thế —
 *   hai cơ chế che nhau thì lần gỡ sau không ai biết cái nào đang gánh.
 *
 * Lưới: `zFightingSan.unit.test.ts`.
 */
const SAN_DAY_SAU_HE_SO = 1;
const SAN_DAY_SAU_DON_VI = 1;

function San({ rongM, sauM, toi }: { rongM: number; sauM: number; toi: boolean }) {
  const canh = Math.max(rongM, sauM, 10);
  /**
   * ★★★ PH-54 — SỐ Ô KHÔNG CÒN TỈ LỆ VỚI CỠ SÀN, MÀ THEO **MÀN HÌNH**.
   *
   * Trước: `soO = max(4, round(canh/5))` ⇒ ô ~5 m, và vì `soO` đi theo `canh` nên
   * sàn tập đoàn 1.060 m sinh **212 ô** — ở khung mặc định mỗi ô rộng **1,47 px**
   * (đo sống). Đó không còn là một cái lưới, đó là một tấm dither: nó không cho
   * cảm giác tỉ lệ nào, chỉ thêm nhiễu và tốn đỉnh.
   *
   * `buocGoc` giữ nguyên biểu thức cũ nên ở mọi nấc zoom mà lưới hôm nay ĐÃ đủ to
   * (`/twin` một nhà máy, khung mặc định: 27,75 px) bản vá trả về ĐÚNG số ô cũ —
   * `soOGoc` được dùng lại nguyên vẹn, không phải tính lại bằng đường khác.
   */
  const soOGoc = Math.max(4, Math.round(canh / 5));
  const buocGoc = canh / soOGoc;
  const lamTron = useCallback(
    (b: number) => buocThucTheoSoO(canh, buocGoc, b),
    [canh, buocGoc],
  );
  const buoc = useBuocLuoi(buocGoc, { lamTron });
  const soO = Math.max(4, Math.round(canh / buoc));
  return (
    <group>
      <mesh rotation={XOAY_SAN} position={[rongM / 2, -0.01, sauM / 2]}>
        <planeGeometry args={[rongM, sauM]} />
        <meshStandardMaterial
          color={toi ? "#1e293b" : "#e2e8f0"}
          polygonOffset
          polygonOffsetFactor={SAN_DAY_SAU_HE_SO}
          polygonOffsetUnits={SAN_DAY_SAU_DON_VI}
        />
      </mesh>
      <gridHelper
        args={[canh, soO, toi ? "#475569" : "#94a3b8", toi ? "#334155" : "#cbd5e1"]}
        position={[rongM / 2, 0, sauM / 2]}
      />
    </group>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* Màu token → THREE.Color — RE-EXPORT, cài đặt ở `mauThree.ts`                 */
/* ═══════════════════════════════════════════════════════════════════════════ */

/**
 * ★★★ ĐÃ RÚT RA `mauThree.ts` (Đợt 8 lô D) — ĐÂY CHỈ CÒN LÀ CỬA TƯƠNG THÍCH.
 *
 * Lô A viết bản vá oklch→RGB ngay trong tệp này vì phạm vi tệp của nó, và tự
 * khai đúng: cùng lỗi còn ở `DongChayLine.tsx`, ở đường vào `LoBatchMay`
 * (`TwinVanHanh.tsx`, **84 warning** đếm được) và ở `phaVeNen()`
 * (`phamViCanh.ts`, "mờ 12%" của §10C **chưa từng có hiệu lực**).
 *
 * Chép bản vá sang bốn chỗ = bốn bản cài đặt sẽ lệch nhau ở lần sửa đầu tiên
 * (G12). Nên nó nằm ở `./mauThree` và MỌI người tiêu thụ import từ đó.
 * Re-export ở đây giữ nguyên các call site cũ + test G20 của lô A
 * (`mauThree.dom.test.tsx` import từ chính tệp giao hàng này).
 */
export { mauHex, mauThree };

/* ═══════════════════════════════════════════════════════════════════════════ */
/* Ống WIP theo trạm — §10C.3 mục 2                                            */
/* ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Mỗi trạm một cột đứng, cao theo số WIP đang chờ. Trạm nghẽn → cột cao + màu
 * cảnh báo. Đây là cách đọc nút thắt bằng MẮT trong 2 giây.
 *
 * Vẽ bằng MỘT `InstancedMesh` (1 draw call cho cả 12 cột) — 12 mesh rời tốn 12
 * draw call chỉ để vẽ 12 hình trụ giống hệt nhau.
 */
function OngWip({ wip }: { wip: CanhVanHanhProps["wip"] }) {
  const ref = useRef<THREE.InstancedMesh | null>(null);
  const invalidate = useThree((s) => s.invalidate);

  const { hinh, chatLieu } = useMemo(() => {
    // Trụ đơn vị cao 1, tâm ở giữa → dịch lên nửa chiều cao khi đặt.
    const g = new THREE.CylinderGeometry(0.18, 0.18, 1, 8);
    const m = new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.75 });
    return { hinh: g, chatLieu: m };
  }, []);

  // ★ RB-7 — three KHÔNG tự thu hồi bộ nhớ GPU.
  useEffect(() => () => {
    hinh.dispose();
    chatLieu.dispose();
  }, [hinh, chatLieu]);

  useEffect(() => {
    const inst = ref.current;
    if (!inst) return;
    const mt = new THREE.Matrix4();
    const mauNghen = mauThree("--warning", "#f59e0b");
    const mauThuong = mauThree("--info", "#3b82f6");
    wip.forEach((w, i) => {
      const cao = Math.max(0.05, w.cao);
      mt.compose(
        new THREE.Vector3(w.x, cao / 2, w.z),
        new THREE.Quaternion(),
        new THREE.Vector3(1, cao, 1),
      );
      inst.setMatrixAt(i, mt);
      inst.setColorAt(i, w.nghen ? mauNghen : mauThuong);
    });
    inst.count = wip.length;
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    invalidate();
  }, [wip, invalidate]);

  if (wip.length === 0) return null;
  return <instancedMesh ref={ref} args={[hinh, chatLieu, Math.max(1, wip.length)]} frustumCulled={false} />;
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* A-4 — VÒNG VIỀN SỨC KHOẺ (§14.5.1, mục G-1 / F-15)                          */
/* ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Vòng viền quanh ĐẾ máy, tô theo hạng sức khoẻ.
 *
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ NGÂN SÁCH — MỘT `InstancedMesh` = **1 DRAW CALL** cho MỌI vòng
 * ════════════════════════════════════════════════════════════════════════════
 * §14.5.0: nhãn 3D tốn **1 draw call MỖI nhãn** và trần đọc-được là 30; màu trên
 * thân tốn **0** vì đã nằm trong `BatchedMesh`. Vòng viền là thứ ba: nó KHÔNG
 * miễn phí như màu thân, nhưng nó gộp được — 43 vòng (hay 240) vẫn là **1** call
 * vì cùng hình học cùng material, chỉ khác ma trận và màu instance.
 *
 * Đo được trước lô này: cảnh 240 máy = **3 draw calls**, trần §4 là 150.
 * Lớp này đưa 3 → **4**. Đó là cái giá đã biết và nói ra, khác hẳn với việc neo
 * 43 nhãn troika (3 → 46) cho cùng một thông tin.
 *
 * ★ Vì sao `RingGeometry` chứ không `TorusGeometry`: ring là hình PHẲNG nằm trên
 *   sàn (xoay -90° quanh X), nên nó không bao giờ che thân máy dù camera ở đâu.
 *   Torus nhô lên khỏi sàn và ở góc nhìn thấp sẽ cắt ngang chân máy.
 *
 * ★ RB-7 — geometry và material tự cấp phát ⇒ `dispose()` trong cleanup.
 * ★ `frameloop="demand"`: mọi thay đổi phải gọi `invalidate()`, nếu không lớp
 *   này cập nhật buffer rồi đứng im cho tới khi ai đó chạm chuột (đúng bẫy đã
 *   ghi ở `DieuKhien`).
 */
/**
 * Hằng rỗng ỔN ĐỊNH cho `vienSucKhoe` khi người gọi không truyền.
 *
 * ★ `?? []` viết thẳng trong thân component sinh một mảng MỚI mỗi lần render,
 *   làm `useEffect([vien])` của lớp chạy lại mỗi khung và gọi `invalidate()` —
 *   tức là biến `frameloop="demand"` thành vòng lặp vô hạn im lặng. Đây là bẫy
 *   đã trả giá ở lớp khác của kit, ghi ra để không ai "dọn" dòng này đi.
 */
const EMPTY_VIEN: readonly VienDeMay[] = [];

/** Hằng rỗng ổn định cho `vung` — cùng lý do như {@link EMPTY_VIEN}. */
const EMPTY_VUNG: readonly VungVe[] = [];

/** Hằng rỗng ổn định cho sa bàn (Task 20) — cùng lý do như {@link EMPTY_VIEN}. */
const EMPTY_SA_BAN: readonly BieuTuongToaVe[] = [];
const EMPTY_SA_BAN_CUM: readonly CumSaBanVe[] = [];
const EMPTY_DIEM_SA_BAN: readonly DiemScene[] = [];

/* ══════════════════════════════════════════════════════════════════════════ */
/* ★★★ PH-46/47 — SA BÀN ĐẶT VÀO **VÙNG CANVAS CÒN DÙNG ĐƯỢC**                  */
/* ══════════════════════════════════════════════════════════════════════════ */
/*
 * ── Khuyết tật ─────────────────────────────────────────────────────────────
 * Task 20 dựng được sa bàn; phép đo của chính nó phơi ra hậu quả của việc khung
 * nhìn căn nội dung vào TÂM CANVAS THÔ (`.qa-tapdoan/t21-truoc.json`, vai
 * `qatd_giamdoc`, 1280×720, khung MẶC ĐỊNH):
 *   · thẻ `Metrics` [232,59 → 470,279] phủ TRỌN cụm QATD-A ⇒ **2/3** tên công
 *     ty đọc được — hỏng đúng thứ sa bàn sinh ra để làm;
 *   · **193/341** cột sa bàn nằm dưới lớp phủ ⇒ dùng **39,5 %** dải canvas.
 * Tâm canvas thô ở màn này nằm đúng dưới thẻ `Metrics`, nên "căn giữa" là căn
 * vào chỗ bị che.
 *
 * ── Vì sao sửa Ở TRONG CẢNH chứ không ở trang ──────────────────────────────
 * Thử đầu tiên tính khung nhìn ở `TwinVanHanh.tsx` rồi truyền
 * `khungNhin={khungNhinCanh}` xuống — và làm **ĐỎ hai ca đang xanh** của
 * `cuaVaoTwin.unit.test.ts` (Đợt 36 + Đợt 38/G110: *mọi* trang dựng
 * `<CanhVanHanh` phải truyền đúng bản ổn định `khungNhin={khungNhin}`). Bất
 * biến ấy vẫn ĐÚNG và không có lý do nào để nới nó ra vì một tính năng; cái sai
 * là chỗ đặt phép tính. Trong cây Canvas thì kích thước canvas (`useThree.size`)
 * và vùng cấm (`layVungCam`) đã có sẵn, và `TwinVanHanh.tsx` KHÔNG đổi một byte.
 *
 * ── Vì sao không dịch bằng một khoảng bù cố định ───────────────────────────
 * Ba panel bật/tắt được (`?thu=trai,phai,kpi`) và thẻ KPI tự đổi cỡ khi số về.
 * Đo được: dải ngang dùng được là **488 px** khi mở panel và **968 px** khi thu.
 * Một hằng số sẽ đúng ở trạng thái này và sai ở trạng thái kia.
 */

/**
 * 8 đỉnh mỗi biểu tượng toà + 4 góc mỗi tấm nền cụm — **tập điểm THẬT SỰ ĐƯỢC
 * VẼ**, không phải bbox của chúng.
 *
 * ★★★ Khác biệt ấy đã BÁC BỎ bản đầu của khối này: 8 đỉnh bbox sa bàn QATD cho
 *   tỉ lệ rộng/cao trên màn **1,86**, còn 12 biểu tượng thật đo được **2,91** —
 *   bbox lấp đầy cả Ô TRỐNG của lưới cụm 2×2 và dựng một "tháp 42 m" ở góc
 *   không có toà nào. Camera khớp theo tỉ lệ sai làm sa bàn NHỎ ĐI (168 px)
 *   thay vì to lên. Bắt được bằng `.qa-tapdoan/_t21-sim.mts` chạy TRƯỚC khi
 *   dựng bản, không phải bằng ảnh.
 */
function diemVeSaBan(
  toa: readonly BieuTuongToaVe[],
  cum: readonly CumSaBanVe[],
): readonly DiemScene[] {
  if (toa.length === 0) return EMPTY_DIEM_SA_BAN;
  const ra: DiemScene[] = [];
  for (const v of toa)
    for (const x of [v.viTri.x - v.co.rong / 2, v.viTri.x + v.co.rong / 2])
      for (const y of [v.viTri.y - v.co.cao / 2, v.viTri.y + v.co.cao / 2])
        for (const z of [v.viTri.z - v.co.sau / 2, v.viTri.z + v.co.sau / 2]) ra.push({ x, y, z });
  for (const c of cum)
    for (const x of [c.viTri.x - c.co.rong / 2, c.viTri.x + c.co.rong / 2])
      for (const z of [c.viTri.z - c.co.sau / 2, c.viTri.z + c.co.sau / 2]) ra.push({ x, y: 0, z });
  return ra;
}

/**
 * Khoá GIÁ TRỊ của (VÙNG DÙNG ĐƯỢC + khung nhìn gốc).
 *
 * ★★★ KHOÁ THEO **VÙNG ĐÃ SUY RA**, KHÔNG THEO DANH SÁCH LỚP PHỦ THÔ — và đây
 *   là một hazard do CHÍNH bản vá này sinh ra, bắt được bằng phép đo H2
 *   (`.qa-tapdoan/t21-hazard-*.json`). Bản đầu khoá theo bbox của MỌI lớp phủ,
 *   nên viên `cum-trang-thai-du-lieu` chỉ cần đổi chữ ("Updated 2 h ago" →
 *   "3 h ago") là bbox rộng thêm vài px ⇒ khoá đổi ⇒ khung nhìn dựng lại ⇒
 *   `DieuKhien` tween lại và **vứt cú xoay tay của người dùng** — trong khi
 *   viên ấy không chạm một pixel nào của vùng dùng được (nó không cắt suốt
 *   chiều nào). Khoá theo `vungDungCanvas` làm phép dựng lại chỉ xảy ra khi
 *   vùng THẬT SỰ đổi: thu/mở panel, đổi cỡ cửa sổ.
 */
function khoaVungVaKhung(
  rongPx: number,
  caoPx: number,
  vung: HopCanvas | null,
  kn: KhungNhin | null,
): string {
  const a = vung ? `${vung.trai},${vung.tren},${vung.phai},${vung.duoi}` : "-";
  const b = kn ? `${kn.viTri.map((v) => v.toFixed(3)).join(",")}|${kn.muc.map((v) => v.toFixed(3)).join(",")}` : "";
  return `${rongPx}x${caoPx}|${a}|${b}`;
}

/**
 * Khung nhìn ĐEM CHO `DieuKhien`: có sa bàn ⇒ đặt sa bàn vào vùng canvas còn
 * dùng được; không có sa bàn ⇒ trả NGUYÊN `khungNhin` và không làm gì cả.
 *
 * ⚠ `diem.length === 0` phải thoát ở dòng ĐẦU của `useFrame`: bốn cấp phạm vi
 *   kia và hai màn Line/Máy dùng chung component này, và đối chứng âm của đợt
 *   này là "/twin MỘT nhà máy giống BYTE bản chuẩn Task 19". Không một phép đo
 *   DOM nào được chạy trên đường ấy.
 *
 * ⚠ `setState` trong `useFrame` — nhưng CHỈ khi khoá giá trị đổi (thu/mở panel,
 *   thẻ KPI lớn lên khi số về, đổi cỡ cửa sổ). Đứng yên ⇒ 0 lần, nên bất biến
 *   "idle 0 khung/40 s" (Đợt 40 T4) không bị mua mất.
 */
function useKhungNhinVungDung(
  khungNhin: KhungNhin | null,
  diem: readonly DiemScene[],
): KhungNhin | null {
  const gl = useThree((s) => s.gl);
  const size = useThree((s) => s.size);
  const invalidate = useThree((s) => s.invalidate);
  const [daKhop, datDaKhop] = useState<KhungNhin | null>(null);
  const khoaRef = useRef("");

  /* Đầu vào đổi ⇒ XIN một khung để `useFrame` dưới đây đo lại (`frameloop="demand"`). */
  useEffect(() => {
    if (diem.length === 0) {
      khoaRef.current = "";
      datDaKhop(null);
      return;
    }
    invalidate();
  }, [diem, khungNhin, size.width, size.height, invalidate]);

  useFrame(() => {
    if (diem.length === 0 || khungNhin === null) return;
    const phu: HopCanvas[] = layVungCam(gl.domElement).map((h) => ({
      trai: Math.round(h.trai),
      phai: Math.round(h.phai),
      tren: Math.round(h.tren),
      duoi: Math.round(h.duoi),
    }));
    const vung = vungDungCanvas(size.width, size.height, phu);
    const khoa = khoaVungVaKhung(size.width, size.height, vung, khungNhin);
    if (khoa === khoaRef.current) return;
    khoaRef.current = khoa;
    datDaKhop(
      vung === null
        ? khungNhin
        : khungNhinVaoVung(diem, khungNhin, { rongPx: size.width, caoPx: size.height }, vung),
    );
  });

  return diem.length === 0 ? khungNhin : daKhop;
}

function LopVienSucKhoe({ vien }: { vien: readonly VienDeMay[] }) {
  const ref = useRef<THREE.InstancedMesh | null>(null);
  const invalidate = useThree((s) => s.invalidate);

  const { hinh, chatLieu } = useMemo(() => {
    /*
     * Vành ĐƠN VỊ: bán kính ngoài 1, trong 0,82 ⇒ bề dày 18% bán kính. Scale
     * theo `banKinhM` lúc đặt, nên một hình học phục vụ mọi cỡ máy.
     *
     * ★ 48 phân đoạn: dưới ~32 vòng trông thành đa giác ở cận cảnh; trên 64 thì
     *   thêm đỉnh mà mắt không phân biệt được. Đây là hình học DÙNG CHUNG cho
     *   mọi instance nên chi phí trả MỘT lần, không nhân theo số máy.
     */
    const g = new THREE.RingGeometry(0.82, 1, 48);
    // Nằm ngang trên sàn. `RingGeometry` sinh ra ở mặt phẳng XY.
    g.rotateX(-Math.PI / 2);
    const m = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
      // ★ `depthWrite: false` — vòng nằm SÁT sàn; ghi depth sẽ gây z-fighting
      //   nhấp nháy với mặt sàn ở góc camera thấp.
      depthWrite: false,
    });
    return { hinh: g, chatLieu: m };
  }, []);

  // ★ RB-7 — three KHÔNG tự thu hồi bộ nhớ GPU.
  useEffect(
    () => () => {
      hinh.dispose();
      chatLieu.dispose();
    },
    [hinh, chatLieu],
  );

  useEffect(() => {
    const inst = ref.current;
    if (!inst) return;
    const mt = new THREE.Matrix4();
    const mau = new THREE.Color();
    vien.forEach((v, i) => {
      const r = Math.max(0.05, v.banKinhM);
      mt.compose(
        // ★ NHÍCH LÊN KHỎI SÀN. Đặt đúng y=0 cho z-fighting với mặt sàn ngay cả
        //   khi đã tắt `depthWrite` ở một số GPU. 12 mm — đủ để tách, đủ nhỏ để
        //   vẫn đọc là "vòng trên sàn" chứ không phải "vòng lơ lửng".
        new THREE.Vector3(v.x, 0.012, v.z),
        new THREE.Quaternion(),
        new THREE.Vector3(r, 1, r),
      );
      inst.setMatrixAt(i, mt);
      /*
       * ★★★ `motNhat` (lời khai HẾT HẠN) làm NHẠT MÀU, không đổi sang màu khác.
       *   Hạng `het_han` đã có màu xám riêng từ `mauVienSucKhoe`; việc nhạt thêm
       *   là lớp tín hiệu THỨ HAI cho cùng một sự thật, và nó cần thiết vì xám
       *   nhạt trên nền xám sáng (§14.7.1) là cặp dễ lẫn nhất trong bảng màu.
       */
      mau.set(v.mau);
      if (v.motNhat) mau.lerp(new THREE.Color("#ffffff"), 0.35);
      inst.setColorAt(i, mau);
    });
    inst.count = vien.length;
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    invalidate();
  }, [vien, invalidate]);

  if (vien.length === 0) return null;
  return (
    <instancedMesh
      ref={ref}
      args={[hinh, chatLieu, Math.max(1, vien.length)]}
      frustumCulled={false}
      // ★ `renderOrder` — vẽ SAU sàn, TRƯỚC máy. Vòng trong suốt phải hoà với
      //   sàn phía dưới nó, nhưng không được đè lên thân máy phía trên.
      renderOrder={1}
      // Vòng là CHỈ BÁO, không phải đích bấm: chọn máy vẫn đi qua `LoBatchMay`.
      // Không đặt `raycast` rỗng ở đây thì một vòng lớn sẽ nuốt cú bấm vào máy
      // bên cạnh — và người dùng bấm máy A lại chọn trúng máy B.
      raycast={() => null}
    />
  );
}

/* ═══════════════════════════════════════════════════════════════════════════ */
/* Nội dung cảnh                                                                */
/* ═══════════════════════════════════════════════════════════════════════════ */

function NoiDung(props: CanhVanHanhProps & { toi: boolean }) {
  const {
    may,
    nhan,
    canhBao,
    dongChay,
    wip,
    machineIdChon,
    onChonMay,
    khungNhin,
    sanRongM,
    sanSauM,
    tatNhan,
    toi,
  } = props;
  const chiNhanBatThuong = props.chiNhanBatThuong ?? false;
  const chuNhanAn = props.chuNhanAn;
  const vienSK = props.vienSucKhoe ?? EMPTY_VIEN;
  const vungAT = props.vung ?? EMPTY_VUNG;
  const saBan = props.saBan ?? EMPTY_SA_BAN;
  const saBanCum = props.saBanCum ?? EMPTY_SA_BAN_CUM;
  /** ★ Task 20 — sa bàn THAY cảnh máy, không đứng cạnh (xem docblock prop `saBan`). */
  const veSaBan = saBan.length > 0;
  /* ★ PH-46/47 — xem docblock `useKhungNhinVungDung`. Không sa bàn ⇒ hai dòng này
     trả hằng rỗng + chính `khungNhin`, không một phép đo DOM nào chạy. */
  const diemSaBan = useMemo(() => diemVeSaBan(saBan, saBanCum), [saBan, saBanCum]);
  const khungNhinVe = useKhungNhinVungDung(khungNhin, diemSaBan);

  const controlsRef = useRef<OrbitControls | null>(null);
  const [chon, setChon] = useState<TrangThaiChon>(TRANG_THAI_CHON_RONG);

  // Đồng bộ selection TỪ NGOÀI vào (click ở danh sách DOM / deep-link) — điều
  // kiện của §9.9 "selection 3D ↔ focus DOM đồng bộ HAI CHIỀU".
  useEffect(() => {
    setChon((cu) => ({ ...cu, dangChon: machineIdChon }));
  }, [machineIdChon]);

  const banKinh = Math.max(sanRongM, sanSauM, 10);

  const khiChon = useCallback(
    (id: number | null) => {
      setChon((cu) => ({ ...cu, dangChon: id }));
      onChonMay(id);
    },
    [onChonMay],
  );

  const khiHover = useCallback((id: number | null) => {
    setChon((cu) => ({ ...cu, dangHover: id }));
  }, []);

  /**
   * ★ Đợt 47 (N2) — CON TRỎ `pointer` khi rê lên máy. Trước đợt này KHÔNG dòng nào của
   *   màn Vận hành đặt cursor (chỉ `CanhNhaMay.tsx:317` của `/factory-command` có), nên
   *   "cursor luôn `auto`" của QA Đợt 46 đo đúng — máy bấm được mà không có dấu hiệu nào
   *   nói thế. Rời máy ⇒ trả về mặc định (không đổi cách cảnh trông khi không rê).
   *
   * ★ Đợt 49 (mục F) — CHƯA THỐNG NHẤT với `CanhNhaMay.tsx:317` (`"grab"` khi không rê), CÓ LÝ DO:
   *   `CanhNhaMay` chỉ có MỘT người gọi là `FactoryCommandView` (`/factory-command`) — màn cũ,
   *   ngoài phạm vi được sửa. Còn kéo cả hai màn về `"grab"` là đổi hành vi đã nghiệm thu ở đây
   *   (e2e T1b + K7e đo "rời máy ⇒ KHÔNG pointer"; `"grab"` cũng không pointer nên lưới vẫn xanh —
   *   tức lưới KHÔNG canh được hướng này) mà không có phép đo nào nói bên nào đúng. Ghi ra chỗ
   *   lệch thay vì chọn bừa một bên rồi gọi đó là "thống nhất".
   */
  const gl = useThree((s) => s.gl);
  useEffect(() => {
    gl.domElement.style.cursor = chon.dangHover != null ? "pointer" : "";
    return () => {
      gl.domElement.style.cursor = "";
    };
  }, [chon.dangHover, gl]);

  const onCameraDoiNgoai = props.onCameraDoi;
  const camDoi = useCallback(
    (viTri: THREE.Vector3, muc: THREE.Vector3) => {
      // ★ Đợt 33 — cửa sổ đo `__tuTheCamera` (xem `CuaSoDoTwin3d` ở KhungCanh.tsx):
      //   ghi cho MỌI màn, kể cả màn không truyền `onCameraDoi` (Line/Máy).
      (window as Window & CuaSoDoTwin3d).__tuTheCamera = {
        x: viTri.x,
        y: viTri.y,
        z: viTri.z,
        mucX: muc.x,
        mucZ: muc.z,
      };
      onCameraDoiNgoai?.(viTri, muc);
    },
    [onCameraDoiNgoai],
  );

  return (
    <>
      <DieuKhien
        khungNhin={khungNhinVe}
        banKinhToiDa={banKinh}
        controlsRef={controlsRef}
        onCameraDoi={camDoi}
      />
      <San rongM={sanRongM} sauM={sanSauM} toi={toi} />
      {/*
        ★★★ TASK 20 — SA BÀN **THAY** CẢNH MÁY, không đứng cạnh nó.
        Lý lẽ đầy đủ ở docblock prop `saBan` và ở `LopSaBan.tsx`: ở 2,3 m/px một
        khối máy còn ~1 px, nên vẽ thêm 1.108 khối chỉ thêm nhiễu, còn `LopNhan`/
        `LopCanhBao` sẽ dán nhãn MÁY lên mặt những toà nhà không bấm được.
        ⚠ Nhánh `false` phải là cây CŨ Y NGUYÊN — đối chứng âm của Task 20 là
          "/twin một nhà máy không đổi một ô nào".
      */}
      {veSaBan ? (
        <LopSaBan toa={saBan} cum={saBanCum} toi={toi} tatNhan={tatNhan} />
      ) : (
        <>
      {/* ★ A-6 — VÙNG AN TOÀN, sát sàn nhất, dưới cả vòng sức khoẻ. Nó là NỀN
          bối cảnh ("chỗ này chia sẻ với người"), không phải chỉ báo về một máy.
          ★ KHÔNG truyền `onChon`: vận hành chỉ đọc, cú bấm thuộc về máy. */}
      <LopVung vung={vungAT} tatNhan={tatNhan} />
      {/* ★ A-4 TRƯỚC `LoBatchMay`: vòng nằm dưới chân máy, phải vẽ trước để thân
          máy đè lên phần vòng bị che — đúng thứ tự vật lý của cảnh. */}
      <LopVienSucKhoe vien={vienSK} />
      <LoBatchMay may={may} chon={chon} onChon={khiChon} onHover={khiHover} />
      {dongChay ? <DongChayLine dongChay={dongChay} /> : null}
      <OngWip wip={wip} />
      {/*
        ★★★ Đợt 47 (N5) — `LopCanhBao` ĐỨNG TRƯỚC `LopNhan`: hai lớp cùng `useFrame` ưu tiên 0
          ⇒ chạy theo thứ tự trong cây. Badge (alarm) chọn chỗ trước và ghi hộp vào sổ
          `hopDaVe`; nhãn đọc sổ đó làm vùng cấm thêm ⇒ MỘT ngân sách hình chữ nhật, không
          hai bộ khử chồng độc lập (QA Đợt 46: nhãn đè badge tới 1.819 px²). Đảo hai dòng
          này là nhãn đọc hộp badge của KHUNG TRƯỚC. z-index DOM không phụ thuộc thứ tự này
          (badge z 30, nhãn z 20 — khai tường minh).
      */}
      <LopCanhBao canhBao={canhBao} />
      <LopNhan
        nhan={nhan}
        dangChon={chon.dangChon}
        dangHover={chon.dangHover}
        tat={tatNhan}
        chiNhanBatThuong={chiNhanBatThuong}
        chuNhanAn={chuNhanAn}
        chuNhanAnTheoChinhSach={props.chuNhanAnTheoChinhSach}
        chuSuCoNgoaiKhung={props.chuSuCoNgoaiKhung}
        /* ★ Đợt 49 (D) — chip "còn N cảnh báo ẩn" (số do `LopCanhBao` ghi sổ chung ở cùng khung). */
        chuCanhBaoAn={props.chuCanhBaoAn}
        /* ★★★ Đợt 49 (A) — CÙNG mảng `may` đã đưa cho `LoBatchMay`: nhãn né hình chiếu thân máy KHÁC.
           Một nguồn, hai người đọc — chép tay danh sách máy sang đây là cách chắc chắn để hai nơi
           lệch nhau một máy rồi im lặng (G5). Bỏ prop này = bản GỠ VÁ của ablation mục A. */
        khoiMay={may}
        /* ★ Đợt 47 (N2) — bấm lên NHÃN cũng chọn máy (nhãn pointer-events:none, LopNhan tự hit-test hộp thật). */
        onChonNhan={khiChon}
      />
        </>
      )}
    </>
  );
}

/**
 * ════════════════════════════════════════════════════════════════════════════
 * ★★★ ĐỢT 40 (QA Đợt 39 Pareto #4) — "ĐỔI THAM CHIẾU ⇔ ĐỔI GIÁ TRỊ" CHO TOÀN BỘ CẢNH, MỘT CHỖ
 * ════════════════════════════════════════════════════════════════════════════
 * Đọc từ cơ chế (`.qa-dot39/nguon-khung/*.json`, `phan-tich-nguon-khung-*.txt`): 9–15 trong 13–19 commit R3F/40 s
 * của mỗi màn là `Canvas` re-render (`p4{onCreated}`) vì TRANG re-render (phản hồi poll `andon.active` 20 s,
 * `anToanRobot` 20 s, `overview+sucKhoeMay` 30 s, `machineDetail` 10 s, `aiInbox.count`…) — dữ liệu cảnh Y NGUYÊN.
 * Mỗi lần `<Canvas>` render, R3F `configure()` gọi `setSize` của store ⇒ `set` ⇒ `subscribe ⇒ invalidate`
 * (bundle `vendor-three-*.js:4019:79808`) ⇒ **một khung vẽ cho một re-render không mang byte nào**.
 *
 * `frameloop="demand"` chỉ có nghĩa khi "đổi tham chiếu" ⇔ "đổi giá trị" (`onDinhTheoGiaTri.ts`, Đợt 38 — áp
 * cho `mayVe`/`cotWip`/`khungNhin` ở TRANG). Nhưng làm ở trang là làm theo DANH SÁCH: `nhan`, `canhBao`,
 * `vienSucKhoe` (deps `bayGio`), `vung`, `dongChay` (literal `{ diem, nhipMs }` ở hai chỗ gọi), bốn callback
 * inline (`chuNhanAn`, `chuSuCoNgoaiKhung`, `onChonMay` ở màn Máy, `onCameraDoi`) đều lọt. Đây là BẤT BIẾN đặt
 * ở CỬA VÀO cảnh: mọi prop dữ liệu ghim theo GIÁ TRỊ (`JSON.stringify` — dữ liệu cảnh là số/chuỗi thuần, ≤ 43 máy,
 * rẻ hơn một khung vẽ), mọi prop hàm đi qua trampoline ổn định đọc `ref` mới nhất — rồi `React.memo` phần thân.
 * Thêm một prop dữ liệu mới vào `CanhVanHanhProps` mà quên ghim ⇒ `CanhVanHanhOnDinh` KHÔNG nhận được nó ⇒ tsc đỏ
 * (kiểu `Props` được liệt kê tường minh dưới đây), không phải lặng lẽ vẽ thừa.
 *
 * ⚠ Vì sao KHÔNG bỏ `bayGio` khỏi deps `vienSucKhoeCanh` ở trang (brief Đợt 40 đề nghị): `vienSucKhoe()` dùng
 *   `bayGio` để hạ hạng lời khai HẾT HẠN (`het_han`/`motNhat`); bỏ dep là đóng băng phép hết hạn — một hồi quy
 *   trung thực dữ liệu đội lốt tối ưu. Tính lại thì rẻ; chỉ cần KHÔNG lan tham chiếu mới khi giá trị y nguyên.
 */
type PropsDuLieu = Pick<
  CanhVanHanhProps,
  | "may"
  | "nhan"
  | "canhBao"
  | "dongChay"
  | "wip"
  | "vienSucKhoe"
  | "vung"
  | "khungNhin"
  | "saBan"
  | "saBanCum"
>;
type PropsHam = Pick<
  CanhVanHanhProps,
  | "onChonMay"
  | "onCameraDoi"
  | "chuNhanAn"
  | "chuNhanAnTheoChinhSach"
  | "chuSuCoNgoaiKhung"
  | "chuCanhBaoAn"
>;

/** Khoá giá trị của một prop dữ liệu — `undefined` và `null` phân biệt (bỏ trống ≠ tắt). */
function khoaGiaTri(v: unknown): string {
  // Chuoi canh cho `undefined` khong the trung voi JSON.stringify (JSON string luon co dau ngoac kep).
  return v === undefined ? "@undefined" : JSON.stringify(v);
}

export function CanhVanHanh(props: CanhVanHanhProps) {
  // ── Prop dữ liệu: cùng khoá ⇒ cùng tham chiếu (bản THÔ tính ở trang mỗi render — rẻ). ──
  const may = useOnDinhTheoGiaTri(props.may, khoaGiaTri(props.may));
  const nhan = useOnDinhTheoGiaTri(props.nhan, khoaGiaTri(props.nhan));
  const canhBao = useOnDinhTheoGiaTri(props.canhBao, khoaGiaTri(props.canhBao));
  const dongChay = useOnDinhTheoGiaTri(props.dongChay, khoaGiaTri(props.dongChay));
  const wip = useOnDinhTheoGiaTri(props.wip, khoaGiaTri(props.wip));
  const vienSucKhoe = useOnDinhTheoGiaTri(props.vienSucKhoe, khoaGiaTri(props.vienSucKhoe));
  const vung = useOnDinhTheoGiaTri(props.vung, khoaGiaTri(props.vung));
  const khungNhin = useOnDinhTheoGiaTri(props.khungNhin, khoaGiaTri(props.khungNhin));
  // ★ Task 20 — sa bàn cũng là prop DỮ LIỆU: bỏ quên hai dòng này thì mỗi nhịp
  //   poll dựng mảng mới cùng giá trị ⇒ `useEffect([toa])` của `LopSaBan` nạp lại
  //   buffer + `invalidate()` ⇒ `frameloop="demand"` thành vòng lặp im lặng.
  const saBan = useOnDinhTheoGiaTri(props.saBan, khoaGiaTri(props.saBan));
  const saBanCum = useOnDinhTheoGiaTri(props.saBanCum, khoaGiaTri(props.saBanCum));

  // ── Prop hàm: trampoline ổn định đọc bản MỚI NHẤT — tầng ngoài luôn render nên `ref` luôn tươi. ──
  // ★ Đợt 45 (mục 4) — G5 đo được: thêm prop hàm ở `CanhVanHanhProps` mà KHÔNG thêm vào ba chỗ dưới ⇒ prop
  //   "có mặt" nhưng không bao giờ tới `LopNhan` (chip vẫn in câu cũ). Lưới `chinhSachNhan.unit.test.ts` ghim.
  const hamRef = useRef<PropsHam>({
    onChonMay: props.onChonMay,
    onCameraDoi: props.onCameraDoi,
    chuNhanAn: props.chuNhanAn,
    chuNhanAnTheoChinhSach: props.chuNhanAnTheoChinhSach,
    chuSuCoNgoaiKhung: props.chuSuCoNgoaiKhung,
    chuCanhBaoAn: props.chuCanhBaoAn,
  });
  hamRef.current = {
    onChonMay: props.onChonMay,
    onCameraDoi: props.onCameraDoi,
    chuNhanAn: props.chuNhanAn,
    chuNhanAnTheoChinhSach: props.chuNhanAnTheoChinhSach,
    chuSuCoNgoaiKhung: props.chuSuCoNgoaiKhung,
    chuCanhBaoAn: props.chuCanhBaoAn,
  };
  const onChonMay = useCallback((id: number | null) => hamRef.current.onChonMay(id), []);
  const onCameraDoi = useCallback(
    (viTri: THREE.Vector3, muc: THREE.Vector3) => hamRef.current.onCameraDoi?.(viTri, muc),
    [],
  );
  // `undefined` phải GIỮ là `undefined` (chip "còn N tên bị ẩn" chỉ hiện khi có chữ) — không bọc thành hàm rỗng.
  const coChuNhanAn = props.chuNhanAn !== undefined;
  const coChuNhanAnTheoChinhSach = props.chuNhanAnTheoChinhSach !== undefined;
  const coChuSuCo = props.chuSuCoNgoaiKhung !== undefined;
  const chuNhanAnOnDinh = useCallback((n: number) => hamRef.current.chuNhanAn?.(n) ?? "", []);
  const chuNhanAnTheoChinhSachOnDinh = useCallback(
    (n: number) => hamRef.current.chuNhanAnTheoChinhSach?.(n) ?? "",
    [],
  );
  const chuSuCoOnDinh = useCallback((n: number) => hamRef.current.chuSuCoNgoaiKhung?.(n) ?? "", []);
  // ★ Đợt 49 (D) — G5: prop mới phải qua ĐỦ BA chỗ (kiểu `PropsHam`, `hamRef`, trampoline + chỗ
  //   truyền xuống). Thiếu một chỗ ⇒ prop "có mặt" mà không bao giờ tới `LopNhan`; Đợt 45 đã dính.
  const coChuCanhBaoAn = props.chuCanhBaoAn !== undefined;
  const chuCanhBaoAnOnDinh = useCallback((n: number) => hamRef.current.chuCanhBaoAn?.(n) ?? "", []);

  return (
    <CanhVanHanhOnDinh
      may={may}
      nhan={nhan}
      canhBao={canhBao}
      dongChay={dongChay}
      wip={wip}
      vienSucKhoe={vienSucKhoe}
      vung={vung}
      khungNhin={khungNhin}
      saBan={saBan}
      saBanCum={saBanCum}
      machineIdChon={props.machineIdChon}
      onChonMay={onChonMay}
      onCameraDoi={onCameraDoi}
      chuNhanAn={coChuNhanAn ? chuNhanAnOnDinh : undefined}
      chuNhanAnTheoChinhSach={coChuNhanAnTheoChinhSach ? chuNhanAnTheoChinhSachOnDinh : undefined}
      chuSuCoNgoaiKhung={coChuSuCo ? chuSuCoOnDinh : undefined}
      chuCanhBaoAn={coChuCanhBaoAn ? chuCanhBaoAnOnDinh : undefined}
      sanRongM={props.sanRongM}
      sanSauM={props.sanSauM}
      tatNhan={props.tatNhan}
      chiNhanBatThuong={props.chiNhanBatThuong}
      chuMatContext={props.chuMatContext}
      ariaLabel={props.ariaLabel}
      sanCaoPx={props.sanCaoPx}
    />
  );
}

/** Thân cảnh — chỉ render lại khi một prop ĐỔI THAM CHIẾU, mà tầng ngoài đã bảo đảm "đổi tham chiếu ⇔ đổi giá trị". */
const CanhVanHanhOnDinh = memo(function CanhVanHanhOnDinh(props: CanhVanHanhProps) {
  const theme = useOptionalTheme();
  const toi = theme === "dark";
  const banKinh = Math.max(props.sanRongM, props.sanSauM, 10);

  /**
   * ★ §10.4 — nền cảnh lấy từ token `--background`, KHÔNG hardcode. 3D phải đúng
   *   ở CẢ HAI theme; một nền cứng sẽ đúng ở một theme và sai ở theme kia.
   */
  //
  // ★★★ Qua `mauHex` chứ KHÔNG `giaiMauCanh` trần: token này là `oklch()`, và
  //   `KhungCanh` đưa thẳng chuỗi vào `<color/>`. Trước bản vá, nền cảnh ra
  //   **TRẮNG** ở theme tối — thấy được bằng mắt ở nghiệm thu Đợt 8.
  const mauNen = mauHex("--background", toi ? "#0f172a" : "#f8fafc");
  // ★ Đợt 40 — hai mảng theo `banKinh`: memo để `KhungCanh` không nhận mảng mới mỗi render.
  const viTriCamera = useMemo<[number, number, number]>(
    () => [banKinh * 1.4, banKinh * 0.9, banKinh * 1.4],
    [banKinh],
  );
  const viTriDenHuong = useMemo<[number, number, number]>(
    () => [banKinh, banKinh * 1.4, banKinh * 0.6],
    [banKinh],
  );

  return (
    <KhungCanh
      viTriCamera={viTriCamera}
      mauNen={mauNen}
      far={farTheoBanKinh(banKinh)}
      cuongDoBanCau={toi ? 0.9 : 1.1}
      cuongDoHuong={toi ? 1.0 : 1.3}
      viTriDenHuong={viTriDenHuong}
      chuMatContext={props.chuMatContext}
      sanCaoPx={props.sanCaoPx}
      data-testid="khoi-canh-3d"
    >
      <NoiDung {...props} toi={toi} />
    </KhungCanh>
  );
});

export default CanhVanHanh;

/** Re-export để trang không phải nhớ hai đường nhập. */
export { mauChoTrangThai };
