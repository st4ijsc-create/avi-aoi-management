/**
 * LopNhan.tsx — lớp nhãn HTML chiếu từ 3D, CAP CỨNG 30 nhãn DOM (§4).
 *
 * Vì sao chiếu tay thay vì dùng `<Html>` của drei cho từng máy: `<Html>` tạo một
 * portal DOM + một `Object3D` cho MỖI nhãn và tự chiếu trong `useFrame`. Với 43
 * máy đó là 43 portal chạy mỗi khung — mà điều ta cần lại là **cull xuống 30**.
 * Ở đây một `<Html>` DUY NHẤT giữ toàn bộ lớp nhãn ở toạ độ màn hình, và
 * `locNhan.ts` (thuần, có test) quyết định 30 cái nào được vẽ.
 *
 * Quyết định lọc nằm HẾT trong `locNhan.ts`; tệp .tsx này chỉ chiếu toạ độ và
 * vẽ div. Nhờ vậy luật ưu tiên (chọn > bất thường > hover > gần) test được trong
 * node, còn phần không test được (chiếu ma trận) không chứa quyết định nào.
 */

import { Html } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";

import {
  demCapChongLap,
  demNhanDeKhoiMayKhac,
  locNhan,
  TRAN_NHAN_DOM,
  demDuoiChoChip,
  type HinhChuNhat,
  type NhanUngVien,
  uocLuongRongNhanPx,
} from "./locNhan";
import { LOP_BADGE, docHopDaVe, docSoAn } from "./hopDaVe";
import { laBam, lechPx } from "./phanBietBamKeo";
import { laCheDoDo } from "./cheDoDo";
import type { MayTrongLo } from "./LoBatchMay";
import type { CuaSoDoTwin3d } from "./KhungCanh";

/**
 * ★★★ ĐỢT 35 (Pareto #5) — VÙNG CẤM LẤY TỪ DOM THẬT, MỖI KHUNG ĐƯỢC VẼ.
 *
 * Mọi lớp phủ DOM đè lên canvas (Metrics `BangKpiNoi`, ngăn Mô phỏng, panel
 * trái/phải của `/twin`, chip máy…) tự khai bằng thuộc tính `data-che-nhan`.
 * Hàm này đọc bbox THẬT của chúng, quy về gốc canvas, bỏ cái không đè canvas
 * (hidden ⇒ 0×0; panel thu ⇒ `w-0`). Không hằng, không danh sách testid.
 *
 * QA Đợt 32: nhãn máy nằm DƯỚI Metrics/panel che 72–100 % — "vẽ rồi" mà không ai
 * đọc được, và `__demNhan.ve` vẫn đếm nó là một nhãn hiện.
 */
export const THUOC_TINH_CHE_NHAN = "data-che-nhan";

/**
 * ★ Đợt 31 — lớp `fullscreen` neo vào TÂM canvas (xem docblock tại chỗ dùng). ★ Đợt 40 — hằng module.
 * ★ Đợt 47 — EXPORT: `LopCanhBao` dùng CÙNG hàm. Đo được (`.qa-dot47/run-probe-lop47.log`): lớp badge lệch canvas
 *   (−57,−96) ở `/twin` 1600 — đúng con số Đợt 31 của nhãn — và (−443,−142) ở Line 1600, vì Đợt 31 chỉ vá lớp nhãn
 *   (G110: cùng kit, màn thứ ba không quét). MỌI `<Html fullscreen>` của kit phải đi qua hằng này.
 */
export const TAM_CANVAS = (
  _el: unknown,
  _camera: unknown,
  size: { width: number; height: number },
): [number, number] => [size.width / 2, size.height / 2];
/** z-index của lớp nhãn drei (G41: bảng KPI/ngăn dùng z-30 để nổi trên 20). */
const Z_INDEX_NHAN: [number, number] = [20, 0];
/** Lớp nhãn là chỉ báo, không nhận chuột — `pointer-events: none` để kéo xoay camera xuyên qua. */
const KIEU_LOP_NHAN = { pointerEvents: "none", userSelect: "none" } as const;

export function layVungCam(canvas: HTMLCanvasElement | null | undefined): HinhChuNhat[] {
  if (!canvas || typeof document === "undefined") return [];
  const cv = canvas.getBoundingClientRect();
  if (cv.width <= 0 || cv.height <= 0) return [];
  const ra: HinhChuNhat[] = [];
  for (const el of document.querySelectorAll<HTMLElement>(`[${THUOC_TINH_CHE_NHAN}]`)) {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    const hop = { trai: r.left - cv.left, phai: r.right - cv.left, tren: r.top - cv.top, duoi: r.bottom - cv.top };
    if (hop.phai <= 0 || hop.duoi <= 0 || hop.trai >= cv.width || hop.tren >= cv.height) continue;
    ra.push(hop);
  }
  return ra;
}

/** Một nhãn trước khi chiếu — vị trí ở KHÔNG GIAN THẾ GIỚI (mét). */
export interface NhanTheGioi {
  khoa: string;
  machineId: number;
  /** Điểm neo nhãn, thường là đỉnh máy + một khoảng hở. */
  viTri: { x: number; y: number; z: number };
  /** Dòng chính — mã máy. */
  ma: string;
  /** Dòng phụ — nhãn trạng thái đã qua `t()`. */
  phu?: string;
  batThuong?: boolean;
}

export interface LopNhanProps {
  nhan: NhanTheGioi[];
  dangChon: number | null;
  dangHover: number | null;
  /** Tắt hẳn lớp nhãn (bậc `tat_nhan` của matDoKhungHinh). */
  tat?: boolean;
  tranNhan?: number;
  /**
   * ★ ĐỢT 23 M1 — chỉ hiện nhãn của máy **bất thường** (+ máy đang chọn).
   * Chuyển thẳng xuống `locNhan`; xem docblock `CauHinhLocNhan.chiNhanBatThuong`.
   */
  chiNhanBatThuong?: boolean;
  /**
   * Chữ ĐÃ QUA `t()` cho chip "còn N tên bị ẩn". Nhận `{n}` đã thay sẵn.
   *
   * ★ RB-8.3 — component trong cây Canvas KHÔNG gọi `t()`; tầng trên dịch rồi
   *   truyền xuống, đúng khuôn `LopCanhBao`/`NganXuLy` đã dùng.
   * `undefined` ⇒ KHÔNG render chip (người gọi chưa nối — không có chuỗi rác).
   */
  chuNhanAn?: (n: number) => string;
  /**
   * ★ Đợt 45 (mục 4) — chữ ĐÃ QUA `t()` cho chip khi `chiNhanBatThuong` BẬT: tên bị ẩn
   *   là do CHÍNH SÁCH người dùng chọn (nay là mặc định), không phải do chật chỗ — chip
   *   phải nói đúng lý do ("chỉ tên máy bất thường · N tên khác ẩn"), không dùng câu
   *   "còn N tên bị ẩn" như thể màn thiếu chỗ. `undefined` ⇒ rơi về `chuNhanAn`.
   */
  chuNhanAnTheoChinhSach?: (n: number) => string;
  /**
   * ★★★ Đợt 35 (Pareto #5) — chữ ĐÃ QUA `t()` cho chip "N sự cố ngoài khung":
   * máy bất thường (andon/error) nằm ngoài frustum. QA Đợt 32 `raised/`: andon
   * `raised` trên máy ngoài khung ⇒ KHÔNG một dấu hiệu nào. `undefined` ⇒ không chip.
   */
  chuSuCoNgoaiKhung?: (n: number) => string;
  /**
   * ★★★ ĐỢT 49 (mục D) — chữ ĐÃ QUA `t()` cho chip **"còn N cảnh báo ẩn"**.
   *
   * Đo được `/twin`@1280 (QA lần 7, 4.2): `tong 7 · ve 5 · soAn 2 · biChe 2` — hai cảnh báo bị
   * GIẤU và màn không có chỉ báo nào; chip cũ chỉ nói về TÊN MÁY. NT-3 (*"không có dữ liệu ≠
   * bình thường"*) áp cho alarm còn gắt hơn cho tên. Số lấy từ sổ chung do `LopCanhBao` ghi ở
   * cùng khung (`docSoAn`), nên chip nằm TRONG cụm chip đã nghiệm thu "trong canvas, không bị
   * che" (G122) thay vì dựng một cụm thứ hai đè lên nó.
   * `undefined` ⇒ KHÔNG render chip (người gọi chưa nối — không có chuỗi rác).
   */
  chuCanhBaoAn?: (n: number) => string;
  /**
   * ★★★ ĐỢT 49 (mục A) — KHỐI 3D của MỌI máy đang vẽ, để nhãn **không đè thân máy KHÁC**.
   *
   * Kết cục đo được (QA Đợt 48): bấm TÂM KHỐI máy 246 ở `/twin`@1600 mở `/twin/may/1`, bấm tâm
   * khối máy 23 ở Line@1280 mở `/twin/may/21` — vì `khiBam` dưới đây nhận điểm nằm trong hộp
   * nhãn của máy khác và `stopPropagation()`. Nhãn bấm được là ĐÚNG (Đợt 47 N5); nhãn nằm ĐÈ
   * thân máy khác là sai. Truyền `may` của cùng cảnh ⇒ `locNhan` coi hình chiếu khối máy khác
   * là VÙNG TRÁNH MỀM. Bỏ trống ⇒ hành vi Đợt 47 y nguyên (bản GỠ VÁ của ablation mục A).
   *
   * ⚠ Đây là `MayTrongLo` NGUYÊN VẸN của `LoBatchMay`, KHÔNG phải một danh sách chép tay: chép
   *   tay là cách chắc chắn để hai nơi lệch nhau một máy rồi không ai biết (G5).
   */
  khoiMay?: readonly MayTrongLo[];
  /**
   * ★★★ Đợt 47 (N2) — BẤM LÊN NHÃN cũng chọn máy.
   *
   * Nhãn là chỉ báo `pointer-events: none` THEO THIẾT KẾ (kéo xoay camera phải xuyên
   * qua nó — `KIEU_LOP_NHAN`). Nên "bấm nhãn" về mặt DOM là bấm CANVAS tại điểm nhãn
   * đang che; mà nhãn neo trên nóc + khoảng hở nên raycast ở đó có thể trượt khỏi
   * hình học máy. Lớp này giữ hộp THẬT của từng nhãn đã vẽ và nghe `click` trên chính
   * canvas: một cú BẤM (không phải kéo — `phanBietBamKeo`) rơi vào hộp nhãn ⇒ gọi
   * hàm này với `machineId` của nhãn và chặn `click` nổi lên khung R3F (nhãn nằm TRÊN
   * máy phía sau về thị giác ⇒ nhãn thắng, không điều hướng hai lần). Không truyền ⇒
   * không gắn listener nào (`/factory-command` giữ nguyên hành vi).
   */
  onChonNhan?: (machineId: number) => void;
}

interface NhanDaChieu {
  khoa: string;
  machineId: number;
  x: number;
  y: number;
  ma: string;
  phu?: string;
  batThuong: boolean;
  dangChon: boolean;
}

/** Chiếu 1 điểm thế giới → pixel canvas. Trả `null` khi ở sau lưng camera. */
function chieu(
  diem: THREE.Vector3,
  camera: THREE.Camera,
  rong: number,
  cao: number,
): { x: number; y: number } | null {
  const v = diem.clone().project(camera);
  // z > 1 nghĩa là sau mặt phẳng xa / sau lưng camera → không chiếu được.
  if (!Number.isFinite(v.x) || !Number.isFinite(v.y) || v.z > 1) return null;
  return { x: ((v.x + 1) / 2) * rong, y: ((1 - v.y) / 2) * cao };
}

/** 8 góc của hộp đơn vị, hệ cục bộ của khối máy (nửa cạnh ±0,5 — `hinhHocDonViTuMoTa`). */
const GOC_HOP_DON_VI: readonly (readonly [number, number, number])[] = [
  [-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [-0.5, 0.5, -0.5], [0.5, 0.5, -0.5],
  [-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [-0.5, 0.5, 0.5], [0.5, 0.5, 0.5],
];

/**
 * ★★★ ĐỢT 49 (mục A) — HÌNH CHIẾU MÀN HÌNH (AABB) của KHỐI 3D một máy.
 *
 * Dùng ĐÚNG phép đặt của `maTranDatMay` (`hinhHocTuMoTa.ts:105`): tâm ở
 * `(x, y + cao/2, z)`, xoay quanh trục đứng `gocXoayRad`, tỉ lệ = kích thước mét. Viết lại ở đây
 * chứ không gọi `maTranDatMay` vì ta cần 8 GÓC chứ không cần ma trận, và vì hàm này chạy mỗi
 * khung: tránh dựng `Object3D` tạm 43 lần/khung.
 *
 * ⚠ Trả `null` khi BẤT KỲ góc nào ở sau lưng camera: một hộp có góc sau lưng camera chiếu ra
 *   hình chữ nhật LẬT (toạ độ nhảy sang phía đối diện) — dùng nó làm vùng tránh thì nhãn né một
 *   cái bóng không tồn tại. Không đo được thì không cấm, chứ không đoán.
 */
export function hopChieuKhoiMay(
  m: Pick<MayTrongLo, "viTri" | "kichThuocMm" | "gocXoayRad">,
  camera: THREE.Camera,
  rong: number,
  cao: number,
  tam = new THREE.Vector3(),
): HinhChuNhat | null {
  const rM = m.kichThuocMm.rongMm / 1000;
  const cM = m.kichThuocMm.caoMm / 1000;
  const sM = m.kichThuocMm.sauMm / 1000;
  const cosG = Math.cos(m.gocXoayRad);
  const sinG = Math.sin(m.gocXoayRad);
  let trai = Infinity;
  let phai = -Infinity;
  let tren = Infinity;
  let duoi = -Infinity;
  for (const [gx, gy, gz] of GOC_HOP_DON_VI) {
    const lx = gx * rM;
    const ly = gy * cM;
    const lz = gz * sM;
    // Xoay quanh Y rồi tịnh tiến về tâm khối.
    tam.set(
      m.viTri.x + lx * cosG + lz * sinG,
      m.viTri.y + cM / 2 + ly,
      m.viTri.z - lx * sinG + lz * cosG,
    );
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

export function LopNhan({
  nhan,
  dangChon,
  dangHover,
  tat = false,
  tranNhan = TRAN_NHAN_DOM,
  chiNhanBatThuong = false,
  chuNhanAn,
  chuNhanAnTheoChinhSach,
  chuSuCoNgoaiKhung,
  chuCanhBaoAn,
  khoiMay,
  onChonNhan,
}: LopNhanProps) {
  // ★ Đợt 45 — một chỗ chọn câu cho chip: theo chính sách khi bật (và có câu), không thì câu chật chỗ.
  const chuChipAn = chiNhanBatThuong && chuNhanAnTheoChinhSach ? chuNhanAnTheoChinhSach : chuNhanAn;
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  /** ★ Đợt 47 — hộp THẬT (đã xếp tầng, kích thước đo được) của các nhãn đang vẽ, cho phép bấm-lên-nhãn. */
  const hopDaVeRef = useRef<{ machineId: number; hop: HinhChuNhat }[]>([]);
  /** ★ Đợt 49 (A) — hình chiếu khối 3D từng máy ở KHUNG VỪA TÍNH; cửa sổ đo đọc đúng thứ bộ lọc đã dùng. */
  const hopKhoiRef = useRef<{ khoa: string; machineId: number; hop: HinhChuNhat }[]>([]);
  const khoiTamRef = useRef(new THREE.Vector3());
  const onChonNhanRef = useRef(onChonNhan);
  onChonNhanRef.current = onChonNhan;
  const coOnChonNhan = onChonNhan !== undefined;

  useEffect(() => {
    if (!coOnChonNhan) return;
    const canvas = gl.domElement;
    let xuong: { x: number; y: number; t: number } | null = null;
    const bayGio = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
    const khiXuong = (ev: PointerEvent) => {
      if (ev.button !== 0) return;
      xuong = { x: ev.clientX, y: ev.clientY, t: bayGio() };
    };
    const khiBam = (ev: MouseEvent) => {
      const d = xuong;
      xuong = null;
      if (!d || !laBam({ lechPx: lechPx(d, { x: ev.clientX, y: ev.clientY }), ms: bayGio() - d.t })) return;
      const r = canvas.getBoundingClientRect();
      const x = ev.clientX - r.left;
      const y = ev.clientY - r.top;
      const trung = hopDaVeRef.current.find(
        (v) => x >= v.hop.trai && x <= v.hop.phai && y >= v.hop.tren && y <= v.hop.duoi,
      );
      if (!trung) return;
      /*
       * ══════════════════════════════════════════════════════════════════════
       * ★★★ ĐỢT 49 (mục A) — NHÃN KHÔNG ĐƯỢC CƯỚP CLICK CỦA **KHỐI MÁY KHÁC**
       * ══════════════════════════════════════════════════════════════════════
       * Đợt 47 cho nhãn thắng "máy phía sau" vì nhãn nằm TRÊN về thị giác. Điều đó đúng khi
       * máy phía sau là CHÍNH máy của nhãn (nhãn neo trên nóc nó). QA lần 7 đo được vế còn
       * lại: sau khi xoay camera, nhãn máy A trôi lên THÂN máy B; người dùng nhắm vào thân B,
       * bấm, và mở A — `/twin`@1600 máy 246 ⇒ `/twin/may/1`; Line@1280 máy 23 ⇒ `/twin/may/21`;
       * census 13 lượt/212 tâm, bấm thử 2/2 ra máy của nhãn.
       *
       * `locNhan` (vùng tránh mềm) làm giảm số chỗ đè, nhưng hợp đồng của nó là *"hết chỗ thì
       * GIỮ nhãn"* — nên vẫn còn chỗ đè, và ở đúng những chỗ ấy cú bấm vẫn sai. Hình học một
       * mình không đóng được kết cục; quyền ƯU TIÊN phải nói ra ở chỗ quyết định.
       *
       * Luật: điểm bấm nằm trong hộp nhãn A **và** trong hình chiếu khối của một máy B ≠ A ⇒
       * NHƯỜNG. Không `stopPropagation`, không gọi `onChonNhan`; cú click đi tiếp tới R3F,
       * raycast chọn đúng thứ người dùng đang nhìn. Nhãn vẫn bấm được ở mọi chỗ nó KHÔNG đè
       * thân máy khác (Đợt 47 N5 nguyên vẹn — e2e T1c/K7f canh điều đó).
       *
       * ⚠ Dùng hộp chiếu (AABB) chứ không raycast lại: hộp là thứ `locNhan` vừa dùng ở CÙNG
       *   khung này, nên quyết định nhường và quyết định xếp chỗ không bao giờ nói khác nhau.
       *   AABB rộng hơn khối thật một chút ⇒ nhường hơi sớm, và nhường sớm là phía an toàn:
       *   mất một lối tắt (bấm nhãn) chứ không mở nhầm máy.
       */
      const deKhoiMayKhac = hopKhoiRef.current.some(
        (k) =>
          k.machineId !== trung.machineId &&
          x >= k.hop.trai &&
          x <= k.hop.phai &&
          y >= k.hop.tren &&
          y <= k.hop.duoi,
      );
      if (deKhoiMayKhac) return;
      // Nhãn thắng máy phía sau: chặn `click` nổi lên div bọc canvas nơi R3F đang nghe (`events.connected`).
      ev.stopPropagation();
      onChonNhanRef.current?.(trung.machineId);
    };
    canvas.addEventListener("pointerdown", khiXuong);
    canvas.addEventListener("click", khiBam);
    return () => {
      canvas.removeEventListener("pointerdown", khiXuong);
      canvas.removeEventListener("click", khiBam);
    };
  }, [gl, coOnChonNhan]);
  const [hienThi, setHienThi] = useState<NhanDaChieu[]>([]);
  /** Số tên KHÔNG đọc được ở khung hiện tại — nguồn của chip "còn N bị ẩn". */
  const [soAn, setSoAn] = useState(0);
  /** ★ Đợt 35 — số máy BẤT THƯỜNG ngoài khung nhìn — nguồn của chip "N sự cố ngoài khung". */
  const [soSuCoNgoai, setSoSuCoNgoai] = useState(0);
  /** ★ Đợt 45 — đệm dưới (px) để cụm chip đáy-giữa nhô lên trên lớp phủ chạm mép dưới canvas. */
  const [demDuoiPx, setDemDuoiPx] = useState(0);
  /** ★ Đợt 49 (D) — số CẢNH BÁO bị giấu, do `LopCanhBao` ghi vào sổ chung ở cùng khung. */
  const [soCanhBaoAn, setSoCanhBaoAn] = useState(0);
  const tamRef = useRef(new THREE.Vector3());
  const chuKyRef = useRef("");
  /**
   * Kích thước THẬT của từng nhãn, đo bằng `getBoundingClientRect` sau khi div
   * đã render, nhớ theo `khoa`.
   *
   * ★ Vì sao ĐO chứ không ƯỚC LƯỢNG từ độ dài chuỗi: bề rộng phụ thuộc font đang
   * tải, `zoom` trình duyệt, và chuỗi `phu` đã qua `t()` (tiếng Việt có dấu rộng
   * hơn tiếng Anh cùng số ký tự). Ước lượng theo ký tự chính là cách sinh ra một
   * con số CÓ VẺ đúng mà không ai đo — đúng lớp lỗi mà bản vá này đang sửa.
   *
   * ★ Vì sao nhớ được qua các khung: mã máy của một `khoa` không đổi, nên bề rộng
   * cũng không đổi. Khung đầu tiên của một nhãn mới dùng trị suy đoán của
   * `locNhan`; từ khung sau đã có số đo thật.
   */
  const coNhanRef = useRef(new Map<string, { rongPx: number; caoPx: number }>());

  const tinhLai = useCallback(() => {
    if (tat || nhan.length === 0) {
      if (hienThi.length !== 0) setHienThi([]);
      if (soAn !== 0) setSoAn(0);
      if (soSuCoNgoai !== 0) setSoSuCoNgoai(0);
      return;
    }

    const ungVien: NhanUngVien[] = [];
    const theoKhoa = new Map<string, NhanTheGioi>();

    for (const n of nhan) {
      const p = tamRef.current.set(n.viTri.x, n.viTri.y, n.viTri.z);
      const kc = camera.position.distanceTo(p);
      const mh = chieu(p, camera, size.width, size.height);
      theoKhoa.set(n.khoa, n);
      const co = coNhanRef.current.get(n.khoa);
      ungVien.push({
        khoa: n.khoa,
        x: mh?.x ?? 0,
        y: mh?.y ?? 0,
        khoangCachMet: kc,
        // Số đo THẬT khi đã có; thiếu thì ƯỚC LƯỢNG THEO CHỮ (Đợt 38) — không dùng 150 px của nhãn cũ,
        // vì nhãn chưa từng vẽ sẽ "rộng 150" mãi ⇒ chồng ⇒ không vẽ ⇒ không bao giờ được đo (tự khoá).
        rongPx: co?.rongPx ?? uocLuongRongNhanPx(n.phu ? `${n.ma} · ${n.phu}` : n.ma),
        caoPx: co?.caoPx,
        dangChon: n.machineId === dangChon,
        batThuong: n.batThuong === true,
        hover: n.machineId === dangHover,
        // Ngoài khung: sau lưng camera, hoặc NEO ngoài mép canvas.
        // ★ Đợt 35 — bỏ biên ±10 %: nhãn neo ngoài canvas là nhãn vẽ ngoài canvas,
        //   không ai đọc được; đếm vào "bị giấu" chứ không vẽ nửa chừng.
        ngoaiKhung:
          mh === null || mh.x < 0 || mh.x > size.width || mh.y < 0 || mh.y > size.height,
      });
    }

    // ★ Đợt 35 — vùng cấm = bbox THẬT của lớp phủ DOM, quy về gốc canvas (xem `layVungCam`).
    const vungCam = layVungCam(gl.domElement);
    // ★ Đợt 45 (mục 4) — chip đáy-giữa phải NHÔ LÊN TRÊN lớp phủ chạm mép dưới canvas (thanh tua `/twin`
    //   z-30 che chip ⇒ "còn N tên bị ẩn" chưa bao giờ nhìn thấy được trên `/twin` — chỉ DOM đọc được).
    //   4d: chỉ lớp phủ NGANG QUA TÂM canvas mới đẩy (panel trái/phải top-0 bottom-0 KHÔNG — `demDuoiChoChip`).
    //   Tính TRƯỚC khi cộng hộp badge: chip chỉ né lớp phủ DOM.
    const demDuoi = demDuoiChoChip(vungCam, size.width, size.height);
    const soLopPhuDom = vungCam.length;
    // ★ Đợt 47 (N5) — hộp BADGE đã vẽ ở khung này (`LopCanhBao` chạy TRƯỚC trong cùng khung, ghi sổ `hopDaVe`)
    //   CỘNG VÀO vùng cấm: MỘT ngân sách hình chữ nhật cho nhãn + badge, không phải hai bộ khử chồng độc lập
    //   (QA Đợt 46: nhãn đè badge 344–1.819 px²). Badge là alarm nên badge giữ chỗ, nhãn nhường — và nhường
    //   bằng cách ĐẨY TẦNG (`locNhan` Đợt 47), không phải biến mất.
    const soAnBadge = docSoAn(gl.domElement, LOP_BADGE);
    const hopBadge = docHopDaVe(gl.domElement, LOP_BADGE);
    for (const h of hopBadge) vungCam.push(h);
    setDemDuoiPx((cu) => (cu === demDuoi ? cu : demDuoi));
    // ★★★ Đợt 49 (A) — hình chiếu KHỐI 3D từng máy = vùng tránh MỀM (xem `CauHinhLocNhan.hopKhoiMay`).
    //   Khoá phải TRÙNG `khoa` của nhãn cùng máy, nếu không khối của chính máy lại thành vùng tránh
    //   của nhãn nó — máy không có nhãn dùng khoá `khoi:<id>` không đụng ai.
    const khoaTheoMay = new Map<number, string>();
    for (const n of nhan) khoaTheoMay.set(n.machineId, n.khoa);
    const hopKhoiMay: { khoa: string; machineId: number; hop: HinhChuNhat }[] = [];
    if (khoiMay) {
      for (const m of khoiMay) {
        if (m.hien === false) continue;
        const h = hopChieuKhoiMay(m, camera, size.width, size.height, khoiTamRef.current);
        if (h) hopKhoiMay.push({ khoa: khoaTheoMay.get(m.machineId) ?? `khoi:${m.machineId}`, machineId: m.machineId, hop: h });
      }
    }
    hopKhoiRef.current = hopKhoiMay;
    const kq = locNhan(ungVien, {
      tranNhan,
      chiNhanBatThuong,
      khungCanvas: { rong: size.width, cao: size.height },
      vungCam,
      // ★ Đợt 49 (A) — nhãn né thân máy KHÁC (mềm: hết chỗ thì giữ nhãn, đếm `soDeKhoiMayKhac`).
      hopKhoiMay,
      // ★ Đợt 49 (A+C) — dọc hết đường thì dời NGANG trước khi bỏ (mục C: 3/6 nhãn bất thường @1600 chưa hiện).
      doiNgang: true,
      // ★ Đợt 35 — xếp tầng nhãn chồng (12 nóc máy cùng hàng sau khi khớp khung ⇒ 7/12 bị bỏ nếu không).
      xepTang: true,
      // ★ Đợt 38 — lên hết đường (panel Metrics đè ngay trên hàng máy @1280) thì đẩy XUỐNG trước khi bỏ.
      xepTangXuong: true,
    });

    // Cửa sổ đo cho e2e (§13.2). Ghi CẢ khi 0 nhãn — "không đo được" phải khác
    // "đo được 0", nếu không thì test đọc `undefined` rồi coi như đạt.
    if (typeof window !== "undefined") {
      (window as WindowCoDo).__demNhan = {
        ve: kq.ve.length,
        tong: kq.tongUngVien,
        ngoaiKhung: kq.soNgoaiKhung,
        chongLap: kq.soBiChongLap,
        vuotTran: kq.soVuotTran,
        tran: tranNhan,
        // ★ ĐỢT 23 M1 — số tên NGƯỜI DÙNG KHÔNG ĐỌC ĐƯỢC. `ve` một mình không
        //   trả lời được câu đó: `ve=8` nghe như đủ, trong khi 37 cái tên khác
        //   đã bị giấu im lặng.
        biGiau: kq.soBiGiau,
        // ★ Đợt 35 — ba đại lượng mới: hộp thò mép, bị lớp phủ che, và SỰ CỐ ngoài frustum.
        vuotMep: kq.soVuotMep,
        biChe: kq.soBiChe,
        // ★ Đợt 49 (A) — hai đại lượng KHÁC NHAU, cố ý để cạnh nhau: `deKhoiKhac` là lời khai của
        //   thuật toán ("phải dùng phương án chót"), `deKhoiKhacDoLai` là đếm lại từ KẾT QUẢ.
        //   Lệch nhau ⇒ một trong hai sai; đó là điều ta muốn nghe, không phải điều muốn giấu.
        deKhoiKhac: kq.soDeKhoiMayKhac,
        deKhoiKhacDoLai: demNhanDeKhoiMayKhac(kq.ve, hopKhoiMay),
        soHopKhoi: hopKhoiMay.length,
        soVungCam: vungCam.length,
        soLopPhuDom,
        soHopBadge: hopBadge.length,
        suCoNgoaiKhung: kq.soBatThuongNgoaiKhung,
        // ★ Số CẶP nhãn CÒN chồng nhau trong tập được vẽ — đại lượng KHÁC với
        // `chongLap` (số nhãn BỊ LOẠI). Chính chỗ lẫn hai đại lượng này làm bộ
        // đếm cũ khai 0 trong khi màn thật có 5 cặp chồng. Đại lượng này phải
        // luôn = 0; e2e đối chiếu nó với `getBoundingClientRect`.
        capConChong: demCapChongLap(
          kq.ve.map((v) => ({
            x: v.x,
            y: v.y,
            ...(coNhanRef.current.get(v.khoa) ?? {}),
          })),
        ),
      };
    }

    // Chỉ setState khi TẬP nhãn thực sự đổi. Không có bước này, mỗi khung xoay
    // camera lại đẩy một mảng mới vào React → re-render 60 lần/giây, đúng thứ
    // `frameloop="demand"` sinh ra để tránh.
    // ★ `soBiGiau` ĐI VÀO CHỮ KÝ: nếu không, xoay camera làm số nhãn bị giấu
    //   đổi mà chip vẫn in số cũ — một con số CÓ VẺ đúng, đúng lớp lỗi đợt này
    //   đang vá. Cùng lý do `ve` đã nằm trong chữ ký.
    // ★ Đợt 35 — `soBatThuongNgoaiKhung` cũng ĐI VÀO CHỮ KÝ: xoay camera đưa máy
    //   sự cố ra/vào khung phải đổi chip ngay, không chờ tập nhãn đổi.
    // ★ Đợt 47 — hộp thật của tập được vẽ, cho bấm-lên-nhãn. Ghi TRƯỚC cửa chữ ký: hộp đổi theo tầng/kích thước
    //   đo được dù tập nhãn và toạ độ làm tròn không đổi.
    hopDaVeRef.current = kq.ve.map((v) => ({ machineId: theoKhoa.get(v.khoa)!.machineId, hop: v.hop }));

    const chuKy =
      `${kq.soBiGiau}#${kq.soBatThuongNgoaiKhung}#${soAnBadge}#` +
      kq.ve.map((v) => `${v.khoa}:${Math.round(v.x)}:${Math.round(v.y)}`).join("|");
    if (chuKy === chuKyRef.current) return;
    chuKyRef.current = chuKy;
    setSoAn(kq.soBiGiau);
    setSoSuCoNgoai(kq.soBatThuongNgoaiKhung);
    setSoCanhBaoAn(soAnBadge);

    setHienThi(
      kq.ve.map((v) => {
        const g = theoKhoa.get(v.khoa)!;
        return {
          khoa: v.khoa,
          machineId: g.machineId,
          x: v.x,
          y: v.y,
          ma: g.ma,
          phu: g.phu,
          batThuong: g.batThuong === true,
          dangChon: g.machineId === dangChon,
        };
      }),
    );
  }, [
    nhan,
    camera,
    gl,
    size.width,
    size.height,
    dangChon,
    dangHover,
    tat,
    tranNhan,
    chiNhanBatThuong,
    khoiMay,
    hienThi.length,
    soAn,
    soSuCoNgoai,
    soCanhBaoAn,
  ]);

  /**
   * ★★★ ĐỢT 49 (mục A) — CỬA SỔ ĐO: hộp THẬT của nhãn đã vẽ + hình chiếu khối từng máy, của CÙNG
   * một khung. QA Đợt 48 phải suy hộp nhãn từ DOM và không có hộp khối nào để so — nên "nhãn đè
   * khối máy khác" chỉ đo được gián tiếp qua TÂM máy (13/212). Hai hàm này cho census đếm ĐÚNG
   * đại lượng bản vá hứa: số cặp (nhãn máy A ∩ khối máy B, A≠B) và diện tích giao.
   * Chỉ gắn ở `laCheDoDo()`; sản phẩm không đổi.
   */
  useEffect(() => {
    if (typeof window === "undefined" || !laCheDoDo()) return;
    const w = window as Window & CuaSoDoTwin3d;
    const cua = w.__demTuongTac ?? (w.__demTuongTac = {});
    cua.hopNhanDaVe = () => hopDaVeRef.current.map((v) => ({ machineId: v.machineId, hop: { ...v.hop } }));
    cua.hopKhoiMay = () => hopKhoiRef.current.map((v) => ({ machineId: v.machineId, hop: { ...v.hop } }));
    return () => {
      delete cua.hopNhanDaVe;
      delete cua.hopKhoiMay;
    };
  }, []);

  // Chiếu lại mỗi khung ĐƯỢC VẼ. Với `frameloop="demand"` đây KHÔNG phải 60fps:
  // hàm chỉ chạy khi có ai đó gọi `invalidate()` (xoay camera, đổi dữ liệu).
  useFrame(tinhLai);

  if (tat || (hienThi.length === 0 && soAn === 0 && soSuCoNgoai === 0 && soCanhBaoAn === 0)) return null;

  /*
   * ════════════════════════════════════════════════════════════════════════
   * ★★★ ĐỢT 31 — LỚP `fullscreen` PHẢI NEO VÀO TÂM CANVAS, KHÔNG VÀO HÌNH
   *     CHIẾU CỦA CHÍNH `<Html>` (gốc toạ độ cảnh)
   * ════════════════════════════════════════════════════════════════════════
   * drei `Html` (10.7.7, `web/Html.js:178`) với `fullscreen` đặt lớp ở
   * `top: -h/2, left: -w/2` QUANH điểm `calculatePosition(el, camera, size)`,
   * mặc định = hình chiếu của `<Html>` này — tức gốc (0,0,0) của cảnh. Lớp chỉ
   * trùng canvas khi gốc ấy tình cờ chiếu đúng TÂM canvas. Mọi `left/top` của
   * từng nhãn ở dưới được tính từ phép chiếu riêng theo `size` ⇒ chúng là toạ
   * độ TRONG CANVAS, và chỉ đúng khi lớp = canvas.
   *
   * Đo được 2026-09-09 (`dist`, 1600×900, `e2e_tai_loE`, bbox DOM thật):
   *   /twin           lớp (231,111) vs canvas (288,207) ⇒ 13/13 nhãn LỆCH (−57,−96) px
   *                   khỏi máy của nó — "trong khung" nhưng không ở trên máy
   *   /twin/line/2    lớp (−496,−322) ⇒ 3/3 nhãn đo được có y ÂM — ngoài màn
   *   /twin/may/14    lớp (386,5) vs canvas (288,125) ⇒ nhãn nóc y=34, ngoài khung
   * Ở cả ba màn `soNhan`/`toBeVisible()`/`__demNhan` đều XANH — chỉ bbox + ảnh
   * bắt được (G41). ⇒ Trả về TÂM canvas để lớp = canvas, ở mọi tư thế camera.
   */
  return (
    <Html
      fullscreen
      // ★ Đợt 40 — ba prop là HẰNG MODULE (không literal mỗi render): `Html` là ForwardRef trong cây R3F, prop hàm/
      //   đối tượng mới mỗi render là một "đổi props" ở mọi commit (`ForwardRef{calculatePosition,zIndexRange,style}`
      //   13–19×/40 s trong `.qa-dot39/nguon-khung/*.json`).
      calculatePosition={TAM_CANVAS}
      zIndexRange={Z_INDEX_NHAN}
      style={KIEU_LOP_NHAN}
    >
      {/* ★ `data-testid` phải nằm trên phần tử DOM BÊN TRONG `<Html>`, KHÔNG trên
          chính `<Html>`. R3F coi mọi prop lạ trên phần tử trong cây Canvas là
          ĐƯỜNG DẪN thuộc tính three.js và tách theo dấu `-`, nên `data-testid`
          thành `data.testid` → ném "Cannot set data-testid. Ensure it is an
          object before setting testid" và ErrorBoundary nuốt cả cảnh.
          Đo được: `npm run check` XANH với lỗi này (kiểu JSX của `<Html>` nhận
          prop tuỳ ý) — chỉ mở màn thật mới bắt ra. */}
      <div
        data-testid="lop-nhan-twin3d"
        style={{ position: "relative", width: "100%", height: "100%" }}
      >
        {/*
          ★★★ ĐỢT 23 M1 — CHIP "CÒN N TÊN BỊ ẨN".
          Đo được trước bản này: 45 ứng viên → **8 nhãn**, 37 bị loại, và màn
          KHÔNG nói gì. Một người vận hành đọc 8 cái tên sẽ tin đó là tất cả.
          Chip này là phép **KHAI BÁO SỰ THIẾU** — cùng luật NT-3 mà cả màn đã
          theo: *không có dữ liệu ≠ bình thường*, ở đây là *không có nhãn ≠
          không có máy*.
          ★ `pointer-events:none` như mọi thứ trong lớp này: nó là chỉ báo,
            không phải nút. Đổi mật độ nhãn là việc của thanh công cụ.
        */}
        {(chuNhanAn && soAn > 0) ||
        (chuSuCoNgoaiKhung && soSuCoNgoai > 0) ||
        (chuCanhBaoAn && soCanhBaoAn > 0) ? (
          <div
            data-testid="cum-chip-nhan"
            data-dem-duoi-px={demDuoiPx}
            /* ★ Đợt 45 (4b/4c) — neo bằng `top` TÍNH TỪ `size.height` (như mọi nhãn), KHÔNG `bottom`: đo được
               (`bbox-go-4.json`) cụm chip nằm ở y = mép trên canvas − 8 (bị dải hợp nhất z-30 che) — `bottom`
               tính theo hộp chứa của drei `<Html fullscreen>` (top −h/2 + translate) chứ không theo canvas thật;
               `top` từ `size` là hệ toạ độ nhãn đã nghiệm thu (E5/D-1 "lớp trùng canvas"). */
            style={{
              position: "absolute",
              left: "50%",
              top: size.height - 8 - demDuoiPx,
              transform: "translate(-50%, -100%)",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 4,
            }}
          >
            {/*
              ★★★ ĐỢT 35 (Pareto #5) — CHIP "N SỰ CỐ NGOÀI KHUNG" — NT-2 cho FRUSTUM.
              QA Đợt 32 `raised/`: andon `raised` trên máy 14, camera nhìn 6/12 máy ⇒
              máy sự cố ở ngoài khung và màn KHÔNG nói gì. Chip này khai báo sự thiếu
              đúng như chip nhãn ẩn — nhưng nó là ALARM, nên đứng TRÊN và viền đỏ.
              `pointer-events:none` như cả lớp: chỉ báo, không phải nút.
            */}
            {chuSuCoNgoaiKhung && soSuCoNgoai > 0 ? (
              <div
                data-testid="chip-su-co-ngoai-khung"
                data-so={soSuCoNgoai}
                style={{
                  padding: "2px 8px",
                  borderRadius: 999,
                  fontSize: 11,
                  fontWeight: 700,
                  whiteSpace: "nowrap",
                  background: "var(--destructive, #ef4444)",
                  color: "var(--destructive-foreground, #fff)",
                  border: "1px solid var(--destructive, #ef4444)",
                }}
              >
                {chuSuCoNgoaiKhung(soSuCoNgoai)}
              </div>
            ) : null}
            {/*
              ★★★ ĐỢT 49 (mục D) — CHIP "CÒN N CẢNH BÁO ẨN".
              Đo `/twin`@1280 (QA lần 7): `tong 7 · ve 5 · soAn 2 · biChe 2` — hai cảnh báo bị
              GIẤU vì chạm lớp phủ DOM, và chỉ báo duy nhất là thuộc tính `data-so-an` mà chỉ
              DOM đọc được. Chip nhãn bên dưới nói về TÊN MÁY, không nói về alarm; người vận
              hành đếm 5 badge và tin đó là tất cả. Đứng NGAY DƯỚI chip "sự cố ngoài khung" vì
              cùng loại khai báo (alarm không nhìn thấy được) và TRÊN chip tên máy vì alarm
              quan trọng hơn tên. Viền đỏ, nền trung tính: nó nói về alarm nhưng bản thân nó
              không phải một alarm mới.
            */}
            {chuCanhBaoAn && soCanhBaoAn > 0 ? (
              <div
                data-testid="chip-canh-bao-bi-an"
                data-so={soCanhBaoAn}
                style={{
                  padding: "2px 8px",
                  borderRadius: 999,
                  fontSize: 11,
                  fontWeight: 700,
                  whiteSpace: "nowrap",
                  background: "var(--muted, rgba(15,23,42,0.78))",
                  color: "var(--destructive, #ef4444)",
                  border: "1px solid var(--destructive, #ef4444)",
                }}
              >
                {chuCanhBaoAn(soCanhBaoAn)}
              </div>
            ) : null}
            {chuChipAn && soAn > 0 ? (
              <div
                data-testid="chip-nhan-bi-an"
                data-so-an={soAn}
                data-theo-chinh-sach={chiNhanBatThuong ? "1" : "0"}
                style={{
                  padding: "2px 8px",
                  borderRadius: 999,
                  fontSize: 11,
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                  background: "var(--muted, rgba(15,23,42,0.78))",
                  color: "var(--muted-foreground, #e2e8f0)",
                  border: "1px solid var(--border, rgba(100,116,139,0.35))",
                }}
              >
                {chuChipAn(soAn)}
              </div>
            ) : null}
          </div>
        ) : null}
        {hienThi.map((n) => (
          <div
            key={n.khoa}
            data-testid="nhan-may-twin3d"
            data-machine-id={n.machineId}
            /* ★ Đo kích thước THẬT ngay khi div gắn vào DOM và nhớ theo `khoa`.
               Khung sau, `locNhan` khử chồng lấp bằng bbox thật thay vì trị suy
               đoán. Ghi vào ref (không setState) nên KHÔNG gây re-render vòng. */
            ref={(el) => {
              if (!el) return;
              const r = el.getBoundingClientRect();
              if (r.width > 0 && r.height > 0) {
                const cu = coNhanRef.current.get(n.khoa);
                coNhanRef.current.set(n.khoa, { rongPx: r.width, caoPx: r.height });
                // ★ Đợt 47 — số đo THẬT khác trị đã dùng (khung đầu là ước lượng) ⇒ xin MỘT khung để khử chồng
                //   tính lại trên số thật. Với `frameloop="demand"` không ai xin hộ; hội tụ sau một khung (số
                //   đo không đổi ⇒ không xin nữa).
                if (!cu || Math.abs(cu.rongPx - r.width) > 0.5 || Math.abs(cu.caoPx - r.height) > 0.5) invalidate();
              }
            }}
            style={{
              position: "absolute",
              left: n.x,
              top: n.y,
              transform: "translate(-50%, -100%)",
              padding: "2px 8px",
              borderRadius: 6,
              fontSize: 12,
              fontWeight: 600,
              whiteSpace: "nowrap",
              background: "var(--card, rgba(255,255,255,0.94))",
              color: "var(--card-foreground, #0f172a)",
              border: `1px solid ${
                n.batThuong
                  ? "var(--destructive, #ef4444)"
                  : n.dangChon
                    ? "var(--primary, #3b82f6)"
                    : "var(--border, rgba(100,116,139,0.3))"
              }`,
              boxShadow: "0 2px 6px rgba(0,0,0,0.25)",
            }}
          >
            {n.ma}
            {n.phu ? (
              <span style={{ opacity: 0.6, fontWeight: 400 }}>{` · ${n.phu}`}</span>
            ) : null}
          </div>
        ))}
      </div>
    </Html>
  );
}

/** Hình dạng cửa sổ đo `window.__demNhan` — e2e đọc đúng các khoá này. */
export interface WindowCoDo extends Window {
  __demNhan?: {
    ve: number;
    tong: number;
    ngoaiKhung: number;
    /** Số nhãn BỊ LOẠI vì chồng bbox lên một nhãn ưu tiên cao hơn. */
    chongLap: number;
    vuotTran: number;
    tran: number;
    /** ★ Đợt 23 M1 — tổng số tên bị giấu (ngoài khung + chồng + trần + lọc + vượt mép + bị che). */
    biGiau: number;
    /** ★ Đợt 35 — hộp nhãn thò ra mép canvas (neo trong, hộp ngoài) ⇒ không vẽ. */
    vuotMep: number;
    /** ★ Đợt 35 — hộp nhãn đè lên lớp phủ DOM `[data-che-nhan]` ⇒ không vẽ. */
    biChe: number;
    /**
     * ★ Đợt 35 — số vùng cấm ở khung này. ★ Đợt 47 — = lớp phủ DOM + hộp badge đã vẽ (`soLopPhuDom` +
     * `soHopBadge`); 0 ⇒ màn chưa đánh dấu lớp phủ nào VÀ không có badge.
     */
    /** ★ Đợt 49 (A) — số nhãn ĐÃ VẼ còn đè khối máy khác, theo lời khai của `locNhan`. */
    deKhoiKhac: number;
    /** ★ Đợt 49 (A) — ĐẾM LẠI từ kết quả bằng `demNhanDeKhoiMayKhac`. Phải bằng `deKhoiKhac`. */
    deKhoiKhacDoLai: number;
    /** ★ Đợt 49 (A) — số khối máy chiếu được ở khung này (0 = người gọi không truyền `khoiMay`). */
    soHopKhoi: number;
    soVungCam: number;
    /** ★ Đợt 47 (N5) — riêng số lớp phủ DOM (`[data-che-nhan]`) — con số Đợt 35 của `soVungCam`. */
    soLopPhuDom: number;
    /** ★ Đợt 47 (N5) — số hộp BADGE đã vẽ mà lớp nhãn nhận làm vùng cấm thêm (sổ `hopDaVe`). */
    soHopBadge: number;
    /** ★ Đợt 35 — số máy BẤT THƯỜNG ngoài frustum — nguồn của chip "N sự cố ngoài khung". */
    suCoNgoaiKhung: number;
    /**
     * Số CẶP nhãn CÒN chồng nhau trong tập ĐƯỢC VẼ — phải luôn 0.
     * ⚠ KHÁC `chongLap`: đây là đầu ra (còn chồng), kia là đầu vào (bị loại).
     */
    capConChong: number;
  };
}

export default LopNhan;
